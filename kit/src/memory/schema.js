// 学习台的记忆库（docs/learner-memory-spec.md）：分哪几类、每一类谁能写、编号怎么起、复现到期怎么算、log 怎么记。
// 纯函数，不碰 DOM，有测试（tests/memory.test.js）。页面写数据库前用 canWrite 拦一道（课堂里的 Claude 只能写观察和自己的失误），
// 自检（check.js）照这里的字段和规则查对话里的 Claude 写进来的东西。
//
// 四种角色：chat（对话里的 Claude，用 ArtifactData 写）、class（课堂里的 Claude）、page（页面自己的代码）、
// me（我自己：在页面上点了「确认」、自己改、撤销。docs/desk-plan.md 第 4 节）。
// 课堂里的 Claude 改记忆分三档（memo.js）：直接写（偏好、它的失误、观察）用 class；我确认才写（错题、弱点、复现组、位置）
// 由我点「确认」时以 me 的身份写进去（log 里 by 还是 class，note 写我哪天确认的）；掌握、规则只能提议。
// 两种性质：history（只增不改：写错了追加一条更正）、state（可以改，每次改都在 log 里记一条）；meta 是页面自己的。

export const ROLES = ['chat', 'class', 'page', 'me'];
export const ROLE_TEXT = { chat: '对话里的 Claude', class: '课堂里的 Claude', page: '页面', me: '我（在页面上点的）' };
// 写进去以后多久之内还能撤销（docs/desk-plan.md 4.3；我还没定，先和自检提醒保留的天数一样）
export const UNDO_DAYS = 7;

// 日期一律写成 YYYY-MM-DD（按我这边的本地日期）
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s) => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && toDate(s) === s;

/**
 * 每一类：label（中文名）、kind、writers（谁能写）、id（编号的规则，说明 + 正则）、
 * required（必填字段）、enums（只能取这些值）、dates（日期字段）、refs（字段 → 指向哪一类）、tracked（状态类里改了要记 log 的字段）。
 */
export const COLLECTIONS = {
  rules: {
    label: '规则', kind: 'state', writers: ['chat'],
    id: { re: /^rule-[A-Za-z0-9_-]+$/, eg: 'rule-01、rule-redline-3' },
    required: ['cat', 'text', 'since', 'source'],
    enums: { status: ['active', 'void'] },
    dates: ['since'],
    refs: { voidedBy: 'rules' },
    tracked: ['text', 'status'],
  },
  profile: {
    // 课堂里的 Claude 只能直接写 topic 是「讲法」「习惯」的（memo.js 拦着）；撤销时 status 改成 void
    label: '我（和教学有关的）', kind: 'state', writers: ['chat', 'class', 'me'],
    id: { re: /^p-[A-Za-z0-9_-]+$/, eg: 'p-goal、p-device' },
    required: ['topic', 'text'],
    enums: { status: ['active', 'void'] },
    dates: ['since'],
    tracked: [],
  },
  curriculum: {
    label: '课程地图', kind: 'state', writers: ['chat'],
    id: { re: /^L\d+(?:\.\d+){0,2}$/, eg: 'L2（讲）、L2.2（节）、L2.2.1（块）' },
    required: ['title'],
    enums: { level: ['lecture', 'section', 'block'] },
    refs: { parent: 'curriculum', requires: 'curriculum' },
    tracked: [],
  },
  evidence: {
    label: '证据', kind: 'history', writers: ['page'],
    id: { re: /^ev-[A-Za-z0-9_-]+$/, eg: '页面自动编号' },
    required: ['kind', 'at'],
    refs: { block: 'curriculum', session: 'sessions' },
    tracked: [],
  },
  observations: {
    label: '课堂观察', kind: 'history', writers: ['class', 'page', 'me'],
    id: { re: /^ob-[A-Za-z0-9_-]+$/, eg: '页面自动编号' },
    required: ['kind', 'text', 'at'],
    enums: { kind: ['note', 'summary', 'proposal'] },
    refs: { block: 'curriculum', session: 'sessions', corrects: 'observations' },
    tracked: [],
  },
  errors: {
    label: '错题档案', kind: 'history', writers: ['chat', 'me'],
    id: { re: /^L\d+-T?\d+$/, eg: 'L2-07、L2-T03' },
    required: ['source', 'q', 'mine', 'step', 'cause', 'date'],
    dates: ['date'],
    refs: { weakness: 'weaknesses', block: 'curriculum', corrects: 'errors' },
    tracked: [],
  },
  weaknesses: {
    label: '弱点表', kind: 'state', writers: ['chat', 'me'],
    id: { re: /^W\d+$/, eg: 'W19' },
    required: ['title', 'scope', 'level'],
    enums: { scope: ['通用', '链条', '局部'], level: ['L0', 'L1', 'L2', 'L3'], status: ['active', 'closed', 'void'] },
    dates: ['last'],
    refs: { errors: 'errors', blocks: 'curriculum' },
    tracked: ['level', 'scope', 'status'],
  },
  mastery: {
    label: '掌握状态', kind: 'state', writers: ['chat'],
    id: { re: /^L\d+(?:\.\d+){0,2}(?:#[A-Za-z0-9_-]+)?$/, eg: 'L2.2.1（一块）、L2.2.1#tr（块里的一个知识点）' },
    required: ['state'],
    enums: { state: ['未学', '讲过', '基础题过', '复现通过', '掉了'] },
    // 所在的块（block，不写就是编号 # 前面那段）在 check.js 里单独查
    tracked: ['state', 'tier'],
  },
  reviews: {
    label: '复现组', kind: 'state', writers: ['chat', 'me'],
    id: { re: /^R\d+$/, eg: 'R3' },
    required: ['title', 'tier'],
    // paused：我暂停了（不算到期）；done：停掉了；void：撤销了的新组
    enums: { status: ['active', 'paused', 'done', 'void'] },
    dates: ['last'],
    refs: { weaknesses: 'weaknesses', blocks: 'curriculum' },
    tracked: ['tier', 'last', 'result'],
  },
  position: {
    label: '当前位置', kind: 'state', writers: ['chat', 'me'],
    id: { re: /^now$/, eg: '只有一条：now' },
    required: ['block', 'next'],
    refs: { block: 'curriculum' },
    tracked: ['block'],
  },
  slips: {
    label: '教学失误', kind: 'history', writers: ['chat', 'class', 'me'],
    id: { re: /^S-[A-Za-z0-9_-]+$/, eg: 'S-1027-1' },
    required: ['by', 'date', 'text'],
    enums: { by: ['chat', 'class'] },
    dates: ['date'],
    refs: { session: 'sessions', corrects: 'slips' },
    tracked: [],
  },
  sessions: {
    label: '每节课', kind: 'state', writers: ['page'],
    id: { re: /^c-[A-Za-z0-9_-]+$/, eg: '页面自动编号' },
    required: ['date'],
    dates: ['date'],
    refs: { block: 'curriculum' },
    tracked: [],
  },
  // 改动单（docs/desk-plan.md 4.1）：课堂里的 Claude 每一条要改记忆的（memo 块），和我在页面上自己改的，都先记一条。
  // 直接写的那档马上执行（status: done）；我确认才写的那档等我点（open → done / rejected）；撤销了是 undone。
  // 记着改了哪一类哪一条（coll、target）、改成什么（data / patch）、为什么（reason、basis），撤销按它回退
  pending: {
    label: '改动单', kind: 'state', writers: ['class', 'page', 'me'],
    id: { re: /^pd-[A-Za-z0-9_-]+$/, eg: '页面自动编号' },
    required: ['kind', 'coll', 'op', 'status', 'at'],
    enums: { op: ['add', 'update'], status: ['open', 'done', 'rejected', 'undone'], tier: ['direct', 'confirm', 'me'], by: ['class', 'me'] },
    refs: { session: 'sessions' },
    tracked: ['status'],
  },
};

export const MEMORY_COLLECTIONS = Object.keys(COLLECTIONS);

/** role 能不能写 coll。meta 是页面自己的；不在记忆库里的集合（课堂的 steps、answers……）不归这里管，照旧放行 */
export function canWrite(role, coll) {
  if (coll === 'meta') return role === 'page';
  const c = COLLECTIONS[coll];
  if (!c) return true;
  return c.writers.includes(role);
}

/** 写之前拦一道：不许写时抛出中文原因（课堂里的 Claude 想改弱点、宣布掌握之类，代码层面就拦住） */
export function assertWrite(role, coll) {
  if (canWrite(role, coll)) return;
  const c = COLLECTIONS[coll];
  const who = ROLE_TEXT[role] || role;
  const owners = (c?.writers || []).map((r) => ROLE_TEXT[r]).join('、');
  throw new Error(`${who}不能写 ${coll}（${c?.label || coll}）：这一类只有${owners}能写${role === 'class' ? '。看到的情况写进 observations（kind: proposal），由对话里的 Claude 采纳' : ''}`);
}

// —— 日期 ——

/** Date 或时间戳 → 本地日期 YYYY-MM-DD；已经是 YYYY-MM-DD 的字符串原样 */
export function toDate(d) {
  if (typeof d === 'string' && DATE_RE.test(d)) {
    const t = new Date(`${d}T00:00:00Z`);
    return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
  }
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/** YYYY-MM-DD 加几天（按日历算，不受时区、夏令时影响） */
export function addDays(date, n) {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** 两个日期差几天：b - a */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// —— 复现组：档位 1 → 3 → 7 → 14 → 30 天 ——

export const REVIEW_TIERS = [1, 3, 7, 14, 30];

/** 过了：升一档（30 天那档过了还是 30 天）；没过：回到 1 天 */
export function nextTier(tier, passed) {
  if (!passed) return REVIEW_TIERS[0];
  const i = REVIEW_TIERS.indexOf(Number(tier));
  return REVIEW_TIERS[Math.min(REVIEW_TIERS.length - 1, i < 0 ? 0 : i + 1)];
}

/**
 * 一个复现组什么时候到期（页面算，不手填）：上次做的日期 + 档位天数。还没做过（没有 last）就是今天。
 * 返回 { due, days（离今天还有几天，负数是过期了几天）, state: 'overdue' | 'today' | 'later' } 或 { error }
 */
export function reviewDue(r, today) {
  const tier = Number(r?.tier);
  if (!REVIEW_TIERS.includes(tier)) return { error: `档位 tier 只能是 ${REVIEW_TIERS.join(' / ')}（天）` };
  if (r.last !== undefined && r.last !== null && r.last !== '' && !isDate(r.last)) return { error: 'last 要写成 YYYY-MM-DD' };
  const due = r.last ? addDays(r.last, tier) : today;
  const days = daysBetween(today, due);
  return { due, days, state: days < 0 ? 'overdue' : days === 0 ? 'today' : 'later' };
}

/** 全部复现组按到期先后排（过期的在最前）；停掉的、暂停的、撤销了的不算 */
export function dueList(reviews, today) {
  return (reviews || []).filter((r) => r && !['done', 'paused', 'void'].includes(r.status)).map((r) => ({ id: String(r.id), title: String(r.title || ''), ...reviewDue(r, today) }))
    .filter((x) => !x.error).sort((a, b) => a.days - b.days || (a.id > b.id ? 1 : -1));
}

// —— log：状态类每次改都记一条 ——

/**
 * 一条 log：{ date, by, field, from, to, basis: [证据 / 错题 id], note }。
 * 状态类的文档带 log 数组，最新的在最后。
 */
export function logEntry({ date, by, field, from, to, basis = [], note = '' }) {
  const e = { date: toDate(date ?? Date.now()), by, field, from: from ?? null, to: to ?? null, basis: [...basis] };
  if (note) e.note = note;
  return e;
}

/**
 * 改一条状态类的文档：patch 里和原来不一样的字段各记一条 log（依据一样）。返回新的文档（不改原来的）。
 * meta：{ date, by, basis, note }
 */
export function applyChange(doc, patch, meta) {
  const next = { ...doc };
  const log = Array.isArray(doc?.log) ? [...doc.log] : [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'log' || same(doc?.[k], v)) continue;
    log.push(logEntry({ ...meta, field: k, from: doc?.[k], to: v }));
    next[k] = v;
  }
  next.log = log;
  return next;
}

/** 这个字段最近一次记在 log 里的那条（没有就是 undefined） */
export function lastLog(doc, field) {
  const log = Array.isArray(doc?.log) ? doc.log : [];
  for (let i = log.length - 1; i >= 0; i--) if (log[i]?.field === field) return log[i];
  return undefined;
}

export function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
