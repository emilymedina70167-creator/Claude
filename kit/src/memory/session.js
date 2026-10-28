// 在学习台里上课（docs/learner-memory-spec.md 第 2 批）里不碰 DOM 的部分，有测试：
// - 每节课一个 session：编号、这节课的数据放在 sessions/{编号}/ 下面（scopeDb），课堂的代码照旧写 steps、class_turns……
// - 证据：作答、动作、学生说的话、附的图都写进 evidence（和 answers / events 是同一条写入路径，学习台里不再另写 answers / events）
// - 课堂里的 Claude 能写的只有 observations 和 slips（记录的样子在这里，写之前 assertWrite 拦一道）
// - memory_read：课堂里的 Claude 按集合和编号查记忆库（只读）
import { COLLECTIONS, MEMORY_COLLECTIONS, assertWrite, toDate } from './schema.js';

// 课堂自己的数据：放进 sessions/{编号}/ 下面，每节课分开（编号一样的段 b1、轮次 000001 不会撞）
// report：下课时页面算的课后报告（report.js），sessions/{编号}/report/main
// 学习台里的实时黑板（kind: live）还有 talk、ops、ops_done、lint、meta（黑板现状 meta/now 等）；自学单元（kind: unit）的课件在 unit/main。
// 学习台自己的 meta（memcheck、ledger）不经过 scopeDb，不会被换走
export const SESSION_SCOPED = ['steps', 'class_pages', 'class_turns', 'pack', 'uploads', 'report', 'talk', 'ops', 'ops_done', 'lint', 'meta', 'unit'];
// 一节课是哪一种：课堂（课堂里的 Claude 讲，页面开）、实时黑板（对话里的 Claude 一块板一块板写，它开）、自学单元（一次写完的课件）
export const SESSION_KINDS = { class: '课堂', live: '实时黑板', unit: '自学单元' };
export const kindOf = (doc) => (SESSION_KINDS[doc?.kind] ? doc.kind : 'class');
const SID_RE = /^c-\d{8}-\d+$/;
export const isSessionId = (s) => SID_RE.test(String(s || ''));

/** 新的一节课的编号：c-20261027-1，同一天第二节 c-20261027-2 */
export function sessionId(date, taken = []) {
  const day = String(date).replace(/-/g, '');
  const used = new Set((taken || []).map(String));
  let n = 1;
  while (used.has(`c-${day}-${n}`)) n++;
  return `c-${day}-${n}`;
}

/**
 * 把数据库包一层：SESSION_SCOPED 里的集合换成 sessions/{sid}/ 下面的（读和写都换），写进去的文档带上 session 字段；
 * 别的集合（记忆库、evidence……）原样。课堂的代码不用知道自己在学习台里。
 */
export function scopeDb(db, sid) {
  const scoped = (path) => SESSION_SCOPED.includes(String(path).split('/')[0]);
  const fix = (path) => (scoped(path) ? `sessions/${sid}/${path}` : path);
  // 用 Proxy 转发、方法绑在原对象上：真数据库的引用可能用私有字段，换了 this 就不能用
  const wrap = (target, over) => new Proxy(target, {
    get(t, k) {
      if (k in over) return over[k];
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const docRef = (ref) => wrap(ref, { set: (data, ...rest) => ref.set({ ...data, session: sid }, ...rest) });
  return {
    doc: (path) => (scoped(path) ? docRef(db.doc(fix(path))) : db.doc(path)),
    collection: (path) => {
      if (!scoped(path)) return db.collection(path);
      const c = db.collection(fix(path));
      return wrap(c, { doc: (id) => docRef(c.doc(id)) });
    },
    _clear: db._clear?.bind(db),
    _dump: db._dump?.bind(db),
  };
}

/**
 * 只读的数据库（「以前的课」翻看黑板时用）：读照旧，写（set / update / delete / add）什么都不做。
 * 翻看时作答、刷新恢复都不会改到那节课的记录。
 */
export function readOnlyDb(db) {
  const nop = () => Promise.resolve();
  const wrap = (target, over) => new Proxy(target, {
    get(t, k) {
      if (k in over) return over[k];
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const docRef = (ref) => wrap(ref, { set: nop, update: nop, delete: nop });
  return {
    doc: (path) => docRef(db.doc(path)),
    collection: (path) => { const c = db.collection(path); return wrap(c, { doc: (id) => docRef(c.doc(id)), add: nop }); },
  };
}

const newId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

/**
 * 一条作答（sync.js 的 toAnswer 出来的）或一个动作（events 那样的）→ evidence 里的一条。
 * 组件的 id 原来叫 block（作答记录里），在证据里改叫 comp：evidence 的 block 是课程地图的块。
 * ctx：{ session, block（这节课的块）, point（这一段练的知识点，可选）, turn（这时课堂进行到第几轮：最近一轮的 seq，报告和时间线按它对齐课堂记录）}
 */
export function toEvidence(src, rec, ctx = {}) {
  const { id: _, block: comp, ...rest } = rec || {};
  const kind = src === 'event' ? String(rec?.type || 'event') : String(rec?.kind || 'answer');
  return {
    ...rest,
    id: `ev-${newId()}`,
    src,
    kind,
    comp: comp ?? null,
    session: ctx.session || null,
    block: ctx.block || null,
    tags: evidenceTags(ctx),
    ...turnOf(ctx),
    at: rec?.at || Date.now(),
  };
}

const turnOf = (ctx) => (Number.isFinite(ctx?.turn) && ctx.turn > 0 ? { turn: ctx.turn } : {});

/** 知识点标签：这节课的块，加上这一段的知识点（和 mastery 的编号一样写成 块#名字） */
export function evidenceTags({ block, point } = {}) {
  if (!block) return [];
  return point ? [block, `${block}#${point}`] : [block];
}

/** evidence 里的一条 → 课堂刷新后重放用的样子（作答记录 / 动作，组件 id 放回 block） */
export function fromEvidence(doc) {
  const { comp, block: _b, tags: _t, src, ...rest } = doc || {};
  if (src === 'event') return { kind: 'event', rec: { ...rest, type: rest.type ?? rest.kind, block: comp ?? null } };
  if (src === 'record') return { kind: 'record', rec: { ...rest, block: comp ?? null } };
  return { kind: 'other', rec: { ...rest, block: comp ?? null } };
}

/** 学生在输入框里说的话、附的图：也是证据（kind: say / photo） */
export function sayEvidence(text, ctx = {}, images = []) {
  const t = String(text || '').trim();
  return {
    id: `ev-${newId()}`, src: 'say', kind: images.length && !t ? 'photo' : 'say',
    text: t.length > 2000 ? t.slice(0, 1999) + '…' : t, images: images.map(String),
    comp: null, session: ctx.session || null, block: ctx.block || null, tags: evidenceTags(ctx), at: Date.now(),
  };
}

/**
 * 下课那一刻还没提交的草稿（drafts.js 的 draftsIn）：记一条证据（kind: draft），免得「写了一半」丢掉。
 * d：{ step（段）, block（组件 id）, kind（组件）, title, label（第几步）, text }
 */
export function draftEvidence(d, ctx = {}) {
  const t = String(d?.text || '').trim();
  return {
    id: `ev-${newId()}`, src: 'draft', kind: 'draft', comp: d?.block ?? null, step: d?.step ?? null, compKind: String(d?.kind || ''),
    title: String(d?.title || '').slice(0, 200), label: String(d?.label || ''), text: t.length > 2000 ? t.slice(0, 1999) + '…' : t,
    session: ctx.session || null, block: ctx.block || null, tags: evidenceTags(ctx), ...turnOf(ctx), at: Date.now(),
  };
}

// 补记（学习台首页）：在学习台外面做的（纸上、Notability、外部对话里）。verdict：对 / 错 / 不会，不标就是空
export const MANUAL_VERDICTS = ['对', '错', '不会'];

/** 补记的一条证据（src: manual）：不属于哪节课，跟着下一节课的课后报告一起看 */
export function manualEvidence({ text = '', images = [], block = null, verdict = '' } = {}) {
  const t = String(text || '').trim();
  const v = MANUAL_VERDICTS.includes(verdict) ? verdict : '';
  if (!t && !images.length) throw new Error('写一句话或者贴一张图');
  return {
    id: `ev-${newId()}`, src: 'manual', kind: 'manual', text: t.length > 4000 ? t.slice(0, 3999) + '…' : t, images: images.map(String),
    ...(v ? { verdict: v, ok: v === '对' ? true : v === '错' ? false : null, ...(v === '不会' ? { giveup: true } : {}) } : {}),
    comp: null, session: null, block: block || null, tags: evidenceTags({ block }), at: Date.now(),
  };
}

/** 课堂里的 Claude 记的观察（kind: note / proposal / summary）。写之前拦一道：课堂里的 Claude 只能写 observations */
export function observationRecord({ kind = 'note', text, about = [], session, block, turn, verify }, role = 'class') {
  assertWrite(role, 'observations');
  const k = COLLECTIONS.observations.enums.kind.includes(kind) ? kind : 'note';
  return {
    id: `ob-${newId()}`, kind: k, text: String(text || '').trim().slice(0, 8000), about: (about || []).map(String).slice(0, 20),
    session: session || null, block: block || null, at: Date.now(), by: 'class', ...(turn ? { turn } : {}), ...(verify ? { verify } : {}),
  };
}

/** 课堂里的 Claude 记它自己的教学失误（slips，by: class） */
export function slipRecord({ text, lesson = '', session }, n = 1) {
  assertWrite('class', 'slips');
  const day = toDate(Date.now());
  return {
    id: `S-${String(session || day).replace(/^c-/, '')}-${n}`, by: 'class', date: day,
    text: String(text || '').trim().slice(0, 2000), ...(lesson ? { lesson: String(lesson).trim().slice(0, 1000) } : {}), session: session || null,
  };
}

// —— memory_read：课堂里的 Claude 查记忆库（只读）——

const READABLE = MEMORY_COLLECTIONS.filter((c) => c !== 'pending');
export const MEMORY_READ_MAX = 12 * 1024; // 一次最多返回多少（太多的截掉，告诉它再缩小）

/**
 * 在页面手里的记忆（各类的数组）里查。input：{ collection, id?, block? }。
 * 写了 id：那一条（全文）；没写：这一类的条目（写了 block 只要挨着这块的），每条一行摘要。
 * evidence 不在这里查（条数多，页面去数据库里按 block / session 查），返回 { needDb: true }。
 */
export function memoryRead(mem, input = {}) {
  const coll = String(input.collection || '').trim();
  if (!READABLE.includes(coll)) throw new Error(`collection 只能是 ${READABLE.join(' / ')}`);
  if (coll === 'evidence') return { needDb: true };
  // 一次取好几条（目录里挑好的编号）：每调用一次课堂 Claude 要多跑一整轮，所以鼓励一次取够
  const many = [...new Set([...(Array.isArray(input.ids) ? input.ids : String(input.ids ?? '').split(/[,，\s]+/)), input.id].map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 20);
  // 以前的课：报告在 sessions/{编号}/report 下面，页面去数据库里取
  if (coll === 'sessions') {
    if (!many.length) throw new Error('sessions 要写课的编号（id 或 ids），比如 c-20261027-1');
    return { needDb: true, ids: many };
  }
  const docs = (Array.isArray(mem?.[coll]) ? mem[coll] : []).filter((d) => d && d.id !== undefined);
  if (many.length > 1) {
    const found = many.map((x) => docs.find((d) => String(d.id) === x)).filter(Boolean);
    const missing = many.filter((x) => !docs.some((d) => String(d.id) === x));
    return clip({ collection: coll, docs: found, ...(missing.length ? { missing } : {}) });
  }
  const id = many[0] || '';
  if (id) {
    const d = docs.find((x) => String(x.id) === id);
    if (!d) throw new Error(`${coll} 里没有 ${id}${docs.length ? `（有：${docs.slice(0, 12).map((x) => x.id).join('、')}${docs.length > 12 ? '……' : ''}）` : '（这一类还是空的）'}`);
    return clip({ collection: coll, doc: d });
  }
  const block = String(input.block ?? '').trim();
  const inBlock = (d) => !block || [d.block, d.id, ...(Array.isArray(d.blocks) ? d.blocks : [])].some((b) => String(b || '').split('#')[0] === block || String(b || '').startsWith(`${block}.`));
  const rows = docs.filter(inBlock).map((d) => ({ id: d.id, ...summaryOf(coll, d) }));
  return clip({ collection: coll, count: rows.length, items: rows });
}

function summaryOf(coll, d) {
  const pick = { rules: ['cat', 'text', 'status'], profile: ['topic', 'text'], curriculum: ['level', 'title', 'scope'], errors: ['source', 'q', 'weakness', 'block', 'date'], weaknesses: ['title', 'scope', 'level', 'last', 'errors', 'status'], mastery: ['state', 'tier'], reviews: ['title', 'tier', 'last', 'result'], position: ['block', 'next', 'debts'], slips: ['by', 'date', 'text', 'lesson'], observations: ['kind', 'text', 'session', 'at'] }[coll] || [];
  return Object.fromEntries(pick.filter((k) => d[k] !== undefined).map((k) => [k, typeof d[k] === 'string' && d[k].length > 300 ? d[k].slice(0, 299) + '…' : d[k]]));
}

function clip(out) {
  const s = JSON.stringify(out);
  if (s.length <= MEMORY_READ_MAX) return out;
  if (out.docs) {
    const docs = [...out.docs];
    while (docs.length > 1 && JSON.stringify({ ...out, docs }).length > MEMORY_READ_MAX - 200) docs.pop();
    const rest = out.docs.slice(docs.length).map((d) => d.id);
    return { ...out, docs, ...(rest.length ? { more: rest, note: `一次放不下，还有 ${rest.join('、')}：要的话再取一次` } : {}) };
  }
  if (out.items) {
    const items = [...out.items];
    while (items.length > 1 && JSON.stringify({ ...out, items }).length > MEMORY_READ_MAX - 200) items.pop();
    return { ...out, items, more: out.items.length - items.length, note: '太多了，只给了前面的；写 id 查一条，或者写 block 缩小' };
  }
  // 一条就太长（比如文稿原文）：给截短的原文
  return { collection: out.collection, id: out.doc?.id, text: JSON.stringify(out.doc).slice(0, MEMORY_READ_MAX - 200) + '…', note: '这一条太长，截掉了后面' };
}
