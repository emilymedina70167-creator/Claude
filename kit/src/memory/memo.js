// 课堂里的 Claude 改记忆（docs/desk-plan.md 第 4 节）。纯函数，不碰 DOM、不碰数据库，有测试（tests/memory-memo.test.js）。
//
// 写法：不用工具（每调一次工具平台就多跑一整轮），写在它这一轮的输出里，和黑板指令一样：
//   ````board memo
//   error q="求 A²" mine="ααᵀββᵀ" step="第 1 步换括号" cause="把 βᵀα 当矩阵" weakness=W19 basis=q-b5
//   pref topic=讲法 text="先看图再推公式" basis=say
//   slip text="一次出了两道题" lesson="一块板一件事"
//   lesson id=T-3 again="b7 又一次没讲就出题"
//   ````
// 一行一条。学习台自己管自己（docs/autonomy-plan.md）：课堂里的 Claude 就是学习台的管理者。页面读懂后按档处理：
//   直接写（direct）：偏好（profile）、失误（slips）、教学守则（lessons）、观察 / 提议 / 待办（observations）、
//                     错题（errors）、弱点（weaknesses）、复现组（reviews）、下一节从哪接（position）、规则（rules）——
//                     写完我想看就在下课那行小字、「管理」里看，不对就撤销（2026-11-03：我是来学习的，不要一条条确认）
//   不收：掌握（mastery）——页面按证据算了直接写（我的红线：课堂不能宣布掌握）
//   confirm 档留着兼容以前留下、还开着的改动单
// 不冗杂（docs/autonomy-plan.md 第 4 节）：新弱点、复现组、偏好、规则和已有的几乎一样就不收（similarity），每一类有条数上限（CAPS），
// 到了上限新的不收、下课整理时先合并（status=merged into=…）。
// 每一条先变成一张改动单（pending）。直接写的马上执行；我确认才写的等我在页面上点「确认」（能先改再确认）或「不要」。
// 写进去以后 UNDO_DAYS 天内能撤销：状态类按改动单记下的旧值退回去（退回也记 log），历史类追加一条作废的更正，原条不动。
// 我在页面上自己改（偏好、错题标已解决、复现组暂停）也走同一条路（tier: me），一样能撤销。
import { COLLECTIONS, UNDO_DAYS, assertWrite, applyChange, nextTier, toDate, daysBetween, same } from './schema.js';
import { tokenize } from '../tokens.js';
import { courseOf, prefixOf, positionId, spaceOfId, spaceOfDoc, sharedFor } from './space.js';
// 提到学生不用「他」「她」（和 digest.js 的 neutral 一样；不 import digest.js，免得互相引用）
const neutralText = (t) => String(t ?? '').replace(/(?<![其吉利])[他她](?![们人])/g, '学生');
import { recallSpace, nextRecallId, RECALL_CAP } from './recall.js';
import { isTeach } from './session.js';

export const MEMO_KINDS = {
  pref: { tier: 'direct', coll: 'profile', label: '偏好' },
  slip: { tier: 'direct', coll: 'slips', label: '失误' },
  lesson: { tier: 'direct', coll: 'lessons', label: '守则' },
  note: { tier: 'direct', coll: 'observations', label: '观察' },
  propose: { tier: 'direct', coll: 'observations', label: '提议' },
  todo: { tier: 'direct', coll: 'observations', label: '待办' },
  error: { tier: 'direct', coll: 'errors', label: '错题' },
  weakness: { tier: 'direct', coll: 'weaknesses', label: '弱点' },
  review: { tier: 'direct', coll: 'reviews', label: '复现组' },
  position: { tier: 'direct', coll: 'position', label: '下一节' },
  rule: { tier: 'direct', coll: 'rules', label: '规则' },
  // 要反复记的一条（recall.js）：页面每天让学生自己想一遍，一条一条排期
  recall: { tier: 'direct', coll: 'recall', label: '记忆点' },
  // 这节课改讲别的块（学生临时改了计划）：页面改 sessions 和之后证据挂的块，不进改动单（classroom.js 先拿出来，blockSwitch 查）
  block: { tier: 'page', coll: 'sessions', label: '这节课的块' },
};
// 不收的：拒绝时告诉它为什么
const NOT_YOURS = { mastery: '掌握状态由页面按证据算（课堂不能宣布掌握），你不写；看到的情况写成 note', rules: '写 rule（单数）' };
// 偏好的 topic 写什么都行；这两种最常见（课堂里看得出来的讲法、习惯）
export const PREF_TOPICS = ['讲法', '习惯'];
// 要写依据的几种：依据是证据（规则的依据通常是 say：学生说的那句话），结论才站得住
const NEED_BASIS = new Set(['pref', 'propose', 'error', 'weakness', 'review', 'rule']);
const LIST_KEYS = new Set(['basis', 'about', 'errors', 'blocks', 'weaknesses', 'debts', 'first', 'slips']);
// 一科最多几条守则（没退役的）：再多就要先合并，守则不会越积越多
export const LESSONS_MAX = 20;
// 规则的分类（和学生的项目指令一样）
export const RULE_CATS = ['红线', '掌握', '检验', '来源', '讲解', '细则', '教法', '黑板'];
// 每一类在用的最多几条（弱点、复现组按科，偏好、规则全科共用）：到了上限新的不收，下课整理时先合并。
// 2026-11-03 量的真数据：弱点 数学 20 / 408 11 / 英语 3，复现组 12 / 6 / 2，偏好 27，规则 68（docs/autonomy-plan.md）
export const CAPS = { weaknesses: 20, reviews: 12, profile: 30, rules: 70, lessons: LESSONS_MAX };
// 一节课里每一种新加的最多几条（2026-11-03 我说：别一丁点小事都记、别反复累加）。11/2 那节课记了 27 条观察（多是把作答复述一遍，
// 页面本来就自动记了每一次作答）、27 条失误、同一个毛病 5 道错题。到了就不收，告诉它挑要紧的、并进已有的
// 记忆点一节课最多 8 条：只记真要背的（定义原文、结论、表里的一格），会推出来的不记
export const SESSION_CAPS = { note: 3, propose: 2, slip: 3, error: 5, todo: 5, pref: 3, rule: 3, weakness: 3, review: 2, recall: 8 };
// 列表字段最多几项（欠账、复现组的题）：新的放后面，最老的挤掉，不越堆越长
export const LIST_CAPS = { debts: 5, first: 3, content: 6 };
// 和已有的一条比「像不像」：守则、失误、观察、待办、错题这类句子长，0.3 就算同一件事
const ALIKE = 0.3;

// 还在用的（没合并、没关、没作废、没退役）
const LIVE = { weaknesses: ['active'], reviews: ['active', 'paused'], profile: ['active'], rules: ['active'], lessons: ['active'] };
/** coll 里这一科（共用的几类不分科）还在用的几条 */
export function liveDocs(mem = {}, coll, space = '') {
  const docs = (Array.isArray(mem[coll]) ? mem[coll] : []).filter((d) => d && (LIVE[coll] || ['active']).includes(d.status || 'active'));
  if (!space) return docs;
  if (coll === 'weaknesses' || coll === 'reviews') return docs.filter((d) => spaceOfDoc(coll, d, mem) === space);
  return sharedFor(docs, space, mem);
}
/** 到了上限的几类：[{ coll, n, max }]（下课整理时要先合并） */
export function overCaps(mem = {}, space = '') {
  return Object.entries(CAPS).map(([coll, max]) => ({ coll, n: liveDocs(mem, coll, ['weaknesses', 'reviews', 'lessons'].includes(coll) ? space : '').length, max })).filter((x) => x.n >= x.max);
}
// 新的一条和已有的哪一条几乎一样（拦照抄；换个说法的重复靠下课时合并）
function nearest(text, docs, field = 'text') {
  return docs.map((d) => ({ d, s: similarity(text, d[field]) })).sort((x, y) => y.s - x.s)[0] || null;
}
// 板放不下页面量得出来、会自动分屏，不用课堂 Claude 记成失误（2026-11-02 一节课 27 条失误里 20 条是这个，把真正的教学失误挤掉了）
const LAYOUT_SLIP = /超出一屏|一屏(?:放|装)不下|放不下一屏|上下滚|要滚动|往下滚/;
/** 这条失误只是在说板放不下（去掉讲放不下的那几句，剩下的没什么了） */
export function layoutOnly(text) {
  const rest = String(text || '').split(/[。；;，,\n]/).filter((c) => !LAYOUT_SLIP.test(c) && !/高约|约\s*\d{3,4}|一屏/.test(c)).join('');
  return LAYOUT_SLIP.test(String(text || '')) && rest.replace(/[\s\p{P}\p{S}a-z0-9]/giu, '').length < 12;
}
// 守则「又犯一次」记最近几次的经过
const RECENT_MAX = 3;

const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const newId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
// 列表：逗号、顿号隔开；欠账、先收的题这种句子用分号隔开
const splitList = (v, key) => String(v ?? '').split(['debts', 'first'].includes(key) ? /[;；]/ : /[,，、;；]/).map((x) => x.trim()).filter(Boolean);

/* ---------------- 读：memo 块的每一行 ---------------- */

/**
 * memo 块的内容 → { entries: [{ kind, attrs, line }], errors: [原因] }。只看写法（认不认识这一种、key=value 写得对不对），
 * 记忆里有没有这些编号在 planEntry 里查。
 */
export function parseMemoLines(body) {
  const entries = [];
  const errors = [];
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.trim().replace(/^[-*]\s+/, '');
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const toks = tokenize(line);
    const head = toks[0];
    const kind = head && !head.key ? head.value.toLowerCase() : '';
    if (!kind) { errors.push(`「${cut(line, 40)}」：开头要写这一条是什么（${Object.keys(MEMO_KINDS).join(' / ')}）`); continue; }
    if (NOT_YOURS[kind]) { errors.push(`「${cut(line, 40)}」：${NOT_YOURS[kind]}`); continue; }
    if (!MEMO_KINDS[kind]) { errors.push(`「${cut(line, 40)}」：不认识「${head.value}」，只认 ${Object.keys(MEMO_KINDS).join(' / ')}`); continue; }
    const attrs = {};
    const stray = [];
    for (const t of toks.slice(1)) {
      if (!t.key) { stray.push(t.value); continue; }
      attrs[t.key] = LIST_KEYS.has(t.key) ? [...(attrs[t.key] || []), ...splitList(t.value, t.key)] : t.value;
    }
    if (stray.length) { errors.push(`「${cut(line, 40)}」：「${cut(stray.join(' '), 20)}」不是 key=value（有空格的值要加引号）`); continue; }
    entries.push({ kind, attrs, line: cut(line, 300) });
  }
  return { entries, errors };
}

/* ---------------- 依据 ---------------- */

/**
 * basis 里的每一项找到实在的东西：证据 id（ev-…）、记忆里的编号（错题、弱点、观察……）、
 * 黑板上的组件 id 或段 id（换成这节课里那个组件 / 那一段的全部证据）、say（学生最近说的那句话）。
 * ctx：{ evidence（这节课的证据）, mem（记忆库各类的数组）}。返回 { ids, missing }
 */
export function resolveBasis(tokens, { evidence = [], mem = {} } = {}) {
  const ids = [];
  const missing = [];
  const evs = (evidence || []).filter((e) => e && e.id);
  const memIds = new Set();
  for (const c of ['errors', 'weaknesses', 'observations', 'reviews', 'mastery', 'evidence', 'slips']) for (const d of mem[c] || []) if (d?.id) memIds.add(String(d.id));
  for (const raw of tokens || []) {
    const t = String(raw).trim();
    if (!t) continue;
    if (evs.some((e) => e.id === t) || memIds.has(t)) { ids.push(t); continue; }
    if (/^(say|说|学生说的)$/i.test(t)) {
      const s = evs.filter((e) => e.src === 'say').sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      if (s) ids.push(s.id); else missing.push(t);
      continue;
    }
    // 一问一答的活板：L12 指第 12 行那一问，同一行的第二个控件（L12.2）、数变了重新打开再答的（L12#2）都算
    const talkRow = /^L\d+$/.test(t);
    const hit = evs.filter((e) => e.comp === t || e.step === t || (talkRow && /^[.#]/.test(String(e.comp ?? '').slice(t.length)) && String(e.comp ?? '').startsWith(t))).sort((a, b) => (a.at || 0) - (b.at || 0));
    if (hit.length) ids.push(...hit.map((e) => e.id));
    else missing.push(t);
  }
  return { ids: [...new Set(ids)].slice(0, 20), missing };
}

/**
 * 下课时要归纳的失误：这一科（和不分科）还没归纳进守则、没作废的，全部（最早的在前，最多 max 条）。
 * 返回一段文字，放进 closingPrompt；没有就是空串
 */
export function slipsToFold(mem = {}, space = '', { max = 40 } = {}) {
  const gone = voidedIds(mem);
  const absorbed = absorbedSlips(mem.lessons);
  const left = sharedFor(mem.slips, space, mem).filter((x) => x && x.id && !x.corrects && !gone.has(`slips/${x.id}`) && !absorbed.has(String(x.id)))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  if (!left.length) return '';
  const rows = left.slice(-max).map((x) => `- ${x.id}（${x.date || ''}）${cut(x.text, 220)}${x.lesson ? ` → ${cut(x.lesson, 120)}` : ''}`);
  return neutralText(`【还没归纳进守则的教学失误（${left.length} 条${left.length > max ? `，这里列最近的 ${max} 条` : ''}）】\n${rows.join('\n')}`);
}

// 每一科每上几节课，下课整理时顺带合并一次重复的记忆（不另外调用 Claude，docs/autonomy-plan.md 第 4 节）
export const TIDY_EVERY = 5;

/**
 * 这节课下课时要不要顺带整理（合并重复的弱点、复现组、关于学生的记录）：这一科上完的课（算上这一节）凑够 TIDY_EVERY 节，
 * 或者某一类到了上限（overCaps）。返回原因（中文），不用整理返回 ''。sid：这节课的编号
 */
export function tidyDue(mem = {}, space = '', sid = '') {
  const over = overCaps(mem, space);
  if (over.length) return `${over.map((x) => `${COLLECTIONS[x.coll]?.label || x.coll}到了上限（${x.n} / ${x.max}）`).join('、')}`;
  const done = (Array.isArray(mem.sessions) ? mem.sessions : []).filter((x) => x && x.id !== sid && isTeach(x) && x.status === 'closed' && spaceOfDoc('sessions', x, mem) === space).length;
  return (done + 1) % TIDY_EVERY === 0 ? `这一科上完第 ${done + 1} 节了（每 ${TIDY_EVERY} 节整理一次）` : '';
}

/**
 * 整理用的目录：这一科还在用的弱点、复现组，关于学生的记录（全科共用的），一条一行。放进下课的提示词，让课堂里的 Claude 合并重复的。
 * 规则不列（前面记忆里已经有全文），守则在「归纳教学失误」那段里管
 */
export function tidyText(mem = {}, space = '') {
  const w = liveDocs(mem, 'weaknesses', space).sort((a, b) => cmpNum(a.id, b.id));
  const r = liveDocs(mem, 'reviews', space).sort((a, b) => cmpNum(a.id, b.id));
  const p = liveDocs(mem, 'profile', space);
  const rows = [];
  if (w.length) rows.push(`弱点（${w.length} / ${CAPS.weaknesses}）`, ...w.map((x) => `- ${x.id} ${cut(x.title, 90)}［${x.scope || ''} ${x.level || ''}${(x.errors || []).length ? `，${x.errors.length} 道错题` : ''}${x.last ? `，最近 ${x.last}` : ''}］`));
  if (r.length) rows.push(`复现组（${r.length} / ${CAPS.reviews}）`, ...r.map((x) => `- ${x.id} ${cut(x.title, 70)}${x.family ? `［${cut(x.family, 30)}］` : ''}（第 ${x.tier || 1} 天那档${x.result ? `，上次${x.result}` : ''}${x.status === 'paused' ? '，学生暂停了' : ''}${(x.weaknesses || []).length ? `，盯 ${x.weaknesses.join('、')}` : ''}）`));
  if (p.length) rows.push(`关于学生（${p.length} / ${CAPS.profile}）`, ...p.map((x) => `- ${x.id}［${cut(x.topic, 12)}］${cut(x.text, 90)}`));
  return rows.join('\n');
}
const cmpNum = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/**
 * 这节课改讲别的块：memo 的 block id=EN-L1.1.1。查一下课程地图里有没有、是不是同一科。
 * 返回 { block } 或 { error }。2026-11-02 学生临时要从头学，整节课的作答都记在了原来那块（第三章）下面
 */
export function blockSwitch(entry, { mem = {}, block = '', space = '' } = {}) {
  const id = String(entry?.attrs?.id || entry?.attrs?.block || '').trim();
  if (!id) return { error: '写 block id=块的编号（课程地图里的，比如 EN-L1.1.1）' };
  if (id === block) return { error: `这节课已经是 ${id} 了` };
  const cur = Array.isArray(mem.curriculum) ? mem.curriculum : [];
  if (cur.length && !cur.some((d) => String(d.id) === id)) return { error: `课程地图里没有 ${id}：从记忆目录的「课程地图」里挑编号` };
  // 没块开的课按这节课记的科比（英语里没选块开课，不能换到线代的块上去）
  const here = block ? spaceOfId(block) : space;
  if (here && here !== spaceOfId(id)) return { error: `${id} 不是这一科的` };
  return { block: id };
}

/* ---------------- 编号 ---------------- */

const lectureOf = (block) => /^(?:[A-Z]{2}-)?L(\d+)/.exec(String(block || ''))?.[1] || '';
const maxNum = (ids, re) => Math.max(0, ...ids.map((id) => Number(re.exec(String(id))?.[1]) || 0));

/** 下一个错题编号：同一讲里最大的号 + 1（L2-07 → L2-08；检验题 L2-T03 另算） */
export function nextErrorId(errors, block) {
  const l = lectureOf(block) || '0';
  const pre = `${prefixOf(courseOf(block))}L${l}-`; // 分科：DS-L2-03 和线代的 L2-03 各编各的
  const n = maxNum((errors || []).map((e) => e.id), new RegExp(`^${pre}(\\d+)$`)) + 1;
  return `${pre}${String(n).padStart(2, '0')}`;
}
export const nextWeaknessId = (ws) => `W${maxNum((ws || []).map((w) => w.id), /^W(\d+)$/) + 1}`;
export const nextReviewId = (rs) => `R${maxNum((rs || []).map((r) => r.id), /^R(\d+)$/) + 1}`;
export const nextLessonId = (ls) => `T-${maxNum((ls || []).map((l) => l.id), /^T-(\d+)$/) + 1}`;

/**
 * 两段中文像不像：去掉标点空白后两个字一组，算重合的比例（Jaccard）。新守则和已有的一条太像时拒绝，
 * 让它改写那一条或者记「又犯一次」，不然同一件事会换个说法记好几遍
 */
export function similarity(a, b) {
  const grams = (t) => { const s = String(t || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}
export const SIMILAR = 0.45; // 只拦几乎照抄的；换个说法的重复靠下课时合并和条数上限

/** 一科里还在用的守则（没退役、没作废的） */
export const activeLessons = (lessons, space) => (lessons || []).filter((l) => l && (l.status || 'active') === 'active' && (!space || !l.space || l.space === space));

/** 已经归纳进守则的失误编号（守则的 slips，退役了的守则也算：它们被并进了别的守则） */
export function absorbedSlips(lessons) {
  const out = new Set();
  for (const l of lessons || []) if (l && l.status !== 'void') for (const x of Array.isArray(l.slips) ? l.slips : []) out.add(String(x));
  return out;
}
/** 失误的编号：S-日期-节-第几条（S-20261027-1-2），和课堂工具 slip_note 一样 */
export function nextSlipId(slips, session, date) {
  const pre = `S-${String(session || date || '').replace(/^c-/, '')}-`;
  const n = Math.max(0, ...(slips || []).map((x) => String(x.id)).filter((id) => id.startsWith(pre)).map((id) => Number(id.slice(pre.length)) || 0)) + 1;
  return `${pre}${n}`;
}

/* ---------------- 一条 → 改动 ---------------- */

/**
 * 一条 memo → 要做的改动 { kind, tier, coll, op, target, data | patch, reason, basis, label }，或者 { error }。
 * ctx：{ mem, evidence（这节课的）, session, block（这节课的块）, date }。
 * 这里把编号、字段、取值、依据都查一遍；查不过的不进改动单，原因写进 [系统] 提醒让它改。
 */
export function planEntry(entry, ctx = {}) {
  const { kind, attrs: a } = entry;
  const spec = MEMO_KINDS[kind];
  if (!spec) return { error: `不认识「${kind}」` };
  const mem = ctx.mem || {};
  const date = ctx.date || toDate(Date.now());
  // 哪一科：有块按块；没块（新的一科还没选块就开了课）按这节课记下的科，不一律当数学
  const spaceHere = (blk) => (blk ? spaceOfId(blk) : ctx.space || spaceOfId(''));
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);
  const find = (c, id) => get(c).find((d) => String(d.id) === String(id));
  const { ids: basis, missing } = resolveBasis(a.basis, ctx);
  // 依据里有找不到的（多半是讲解的段：上面没有作答，就没有证据）：还有别的依据、或者这一类本来不用依据，就去掉找不到的照记，
  // 不整条拒掉——2026-11-02 那节课下课时 position 因为 basis=b32 找不到整条没记，下一节从哪接就丢了
  if (missing.length && (NEED_BASIS.has(kind) && !basis.length)) return { error: `basis 里的 ${missing.join('、')} 找不到（写证据 id、记忆里的编号、黑板上的组件 id 或段 id，或者 say 指学生刚说的话）` };
  // 整理（合并、作废、停掉、退役）和改偏好的说法不用依据；新的结论、改证据级要
  const tidy = ['merged', 'void', 'retired', 'done'].includes(a.status);
  if (NEED_BASIS.has(kind) && !basis.length && !tidy && !(kind === 'pref' && a.id)) return { error: `${spec.label}要写依据：basis=组件 id / 证据 id / say（没有依据的结论不记）` };
  const reason = cut(a.reason || a.why || '', 300);
  // missingBasis：写了但找不到、被去掉的依据（守卫看：编了一个没有的证据编号是要提醒的）
  const base = { kind, tier: spec.tier, coll: spec.coll, basis, reason, label: spec.label, ...(missing.length ? { missingBasis: missing } : {}) };
  const enumOk = (coll, field, v) => v === undefined || COLLECTIONS[coll].enums?.[field]?.includes(v);
  const sid = ctx.session || null;
  // 这节课已经新加了几条这一种（applyMemo 里同一块先写的也算：它们已经进了手上的副本）
  if (sid && SESSION_CAPS[kind] && !a.id) {
    const mine = { note: () => get('observations').filter((o) => o.session === sid && o.kind === 'note'), propose: () => get('observations').filter((o) => o.session === sid && o.kind === 'proposal'),
      todo: () => get('observations').filter((o) => o.session === sid && o.kind === 'todo'), slip: () => get('slips').filter((x) => x.session === sid), error: () => get('errors').filter((x) => x.session === sid && !x.corrects),
      pref: () => get('profile').filter((x) => String(x.source || '').includes(sid)), rule: () => get('rules').filter((x) => String(x.source || '').includes(sid)),
      weakness: () => get('weaknesses').filter((x) => x.session === sid), review: () => get('reviews').filter((x) => x.session === sid), recall: () => get('recall').filter((x) => x.session === sid) }[kind];
    const n = mine ? mine().length : 0;
    if (n >= SESSION_CAPS[kind]) return { error: `这节课已经记了 ${n} 条${spec.label}（一节课最多 ${SESSION_CAPS[kind]} 条）：只记下一节课会因为它做得不一样的；同一件事并进已有的那条` };
  }
  // 和已有的一条说的是同一件事：不另记
  const alike = (text, docs, field = 'text') => { const t = String(text || ''); if (t.length < 6) return null; const hit = docs.map((d) => ({ d, s: similarity(t, d[field]) })).sort((x, y) => y.s - x.s)[0]; return hit && hit.s >= ALIKE ? hit.d : null; };

  switch (kind) {
    case 'pref': {
      // 关于学生的事（讲法、习惯、目标……）：新的一条、改写已有的一条（id + text）、并掉（status=merged into=…）、不要了（status=void why=…）
      const old = a.id ? find('profile', a.id) : null;
      if (a.id && !old) return { error: `关于学生的记录里没有 ${a.id}：新的一条不写 id` };
      if (old) {
        if ((old.status || 'active') !== 'active') return { error: `${old.id} 已经${old.status === 'merged' ? `并进了 ${old.into || '别的一条'}` : '不用了'}` };
        const patch = {};
        if (a.status) {
          if (!['merged', 'void'].includes(a.status)) return { error: 'status 只能写 merged（并进别的一条，写 into=）或 void（不用了，写 why=）' };
          if (a.status === 'merged') {
            const to = find('profile', a.into);
            if (!to || a.into === old.id || (to.status || 'active') !== 'active') return { error: `into=${a.into || ''} 要写一条还在用的别的偏好` };
            patch.into = a.into;
          } else if (!a.why) return { error: '不用了要写 why=' };
          patch.status = a.status;
          if (a.why) patch.why = cut(a.why, 200);
          return { ...base, op: 'update', target: old.id, patch };
        }
        if (a.text && cut(a.text, 600) !== old.text) patch.text = cut(a.text, 600);
        if (a.topic && a.topic !== old.topic) patch.topic = cut(a.topic, 20);
        if (!Object.keys(patch).length) return { error: `${old.id} 没有要改的：改说法写 text="…"，并掉写 status=merged into=…` };
        return { ...base, op: 'update', target: old.id, patch };
      }
      if (!a.topic || !a.text) return { error: `偏好要写 topic（${PREF_TOPICS.join(' / ')}、目标……）和 text` };
      const live = liveDocs(mem, 'profile');
      const near = nearest(a.text, live);
      if (near && near.s >= SIMILAR) return { error: `和 ${near.d.id}（${cut(near.d.text, 40)}）说的是同一件事：改写那一条（pref id=${near.d.id} text="…"），不新加` };
      if (live.length >= CAPS.profile) return { error: `关于学生的已经有 ${live.length} 条（最多 ${CAPS.profile}）：先把重复的并掉（pref id=… status=merged into=…）` };
      return { ...base, op: 'add', target: `p-c${newId()}`, data: { topic: cut(a.topic, 20), text: cut(a.text, 600), since: date, source: `课堂 ${sid || ''}`.trim(), basis, status: 'active', ...(a.space && ['math', 'cs', 'en'].includes(a.space) ? { space: a.space } : {}) } };
    }
    case 'todo': {
      // 课上被问到教案以外的内容：不现场查教材补讲（会多跑轮），记下来下次备课补
      if (!a.text) return { error: '待办要写 text（学生问了什么、要补什么）' };
      const dupT = alike(a.text, get('observations').filter((o) => o.kind === 'todo' && o.status !== 'done' && !o.void));
      if (dupT) return { error: `已经有一条一样的待办（${cut(dupT.text, 30)}），不另记` };
      return { ...base, op: 'add', target: `ob-${newId()}`, data: { kind: 'todo', text: cut(a.text, 600), status: 'open', session: sid, block: a.block || ctx.block || null, at: Date.now(), by: 'class' } };
    }
    case 'rule': {
      // 规则：学生在课上定下的、改了的（「以后都……」）。要学生在页面上点确认才写：每一轮都整段带着，写错一条每节课都受影响
      const old = a.id ? find('rules', a.id) : null;
      if (a.id && !old) return { error: `规则里没有 ${a.id}：新的一条不写 id` };
      if (a.cat && !RULE_CATS.includes(a.cat)) return { error: `cat 只能是 ${RULE_CATS.join(' / ')}` };
      if (a.for && !['class', 'both', 'chat'].includes(a.for)) return { error: 'for 只能是 class（只给课堂）/ both' };
      if (a.space && !['math', 'cs', 'en'].includes(a.space)) return { error: 'space 只能是 math / cs / en（只管一科时写）' };
      if (old) {
        if (old.status === 'void') return { error: `${old.id} 已经作废了` };
        const patch = {};
        if (a.status) {
          if (a.status !== 'void') return { error: 'status 只能写 void（作废，写 why=，被新的一条取代就写 by=新规则的编号）' };
          if (!a.why) return { error: '作废规则要写 why=' };
          patch.status = 'void';
          patch.note = cut(a.why, 200);
          if (a.by) patch.voidedBy = a.by;
          return { ...base, op: 'update', target: old.id, patch };
        }
        if (a.text && cut(a.text, 800) !== old.text) patch.text = cut(a.text, 800);
        for (const k of ['cat', 'for', 'space']) if (a[k] && a[k] !== old[k]) patch[k] = a[k];
        if (!Object.keys(patch).length) return { error: `${old.id} 没有要改的` };
        return { ...base, op: 'update', target: old.id, patch };
      }
      if (!a.text) return { error: '新规则要写 text（学生定下的做法，照原话的意思写）' };
      const live = liveDocs(mem, 'rules');
      const near = nearest(a.text, live);
      if (near && near.s >= SIMILAR) return { error: `和 ${near.d.id}（${cut(near.d.text, 40)}）说的是同一件事：改写那一条（rule id=${near.d.id} text="…"），不新加` };
      if (live.length >= CAPS.rules) return { error: `规则已经有 ${live.length} 条（最多 ${CAPS.rules}）：先把重复的改写成一条、另一条作废（rule id=… status=void why=… by=…）` };
      const n = maxNum(get('rules').map((r) => r.id), /^rule-c(\d+)$/) + 1;
      return { ...base, op: 'add', target: `rule-c${n}`, data: { cat: a.cat || '教法', text: cut(a.text, 800), since: date, source: `课堂 ${sid || ''} 学生定的`.replace(/\s+/g, ' '), status: 'active', ...(a.for ? { for: a.for } : {}), ...(a.space ? { space: a.space } : {}), basis } };
    }
    case 'slip': {
      if (!a.text) return { error: '失误要写 text' };
      if (layoutOnly(a.text)) return { error: '板放不下页面量得出来（稍长学生会上下滑），不用记成失误（讲法、出题、判分上的失误照记）' };
      {
        const space = spaceHere(ctx.block);
        const l = alike(`${a.text} ${a.lesson || ''}`, activeLessons(get('lessons'), space).map((x) => ({ ...x, t: `${x.text} ${x.why || ''}` })), 't');
        if (l) return { error: `这是守则 ${l.id}（${cut(l.text, 30)}）说的事：写 lesson id=${l.id} again="这次怎么犯的"，不另记失误` };
        const gone = voidedIds(mem);
        const absorbed = absorbedSlips(get('lessons'));
        const s = alike(a.text, sharedFor(get('slips'), space, mem).filter((x) => !x.corrects && !gone.has(`slips/${x.id}`) && !absorbed.has(String(x.id))));
        if (s) return { error: `和 ${s.id}（${cut(s.text, 30)}）是同一件事，已经记过了：下课时归纳进守则` };
      }
      return { ...base, op: 'add', target: nextSlipId(get('slips'), sid, date), data: { by: 'class', date, text: cut(a.text, 1000), ...(a.lesson ? { lesson: cut(a.lesson, 500) } : {}), session: sid, ...(basis.length ? { basis } : {}) } };
    }
    case 'lesson': {
      // 守则：新的一条（text），改写已有的一条（id + text / slips），又犯一次（id + again），并掉（id + status=retired into=…）
      const space = spaceHere(ctx.block);
      const slips = a.slips || [];
      for (const x of slips) if (!find('slips', x)) return { error: `slips 里的 ${x} 在教学失误里没有（写「还没归纳的失误」里列着的编号）` };
      const old = a.id ? find('lessons', a.id) : null;
      if (a.id && !old) return { error: `教学守则里没有 ${a.id}：新的一条不写 id（页面自动编号）` };
      if (old) {
        if ((old.status || 'active') !== 'active') return { error: `${old.id} 已经${old.status === 'retired' ? `并进了 ${old.into || '别的守则'}` : '作废了'}，改那一条` };
        const patch = {};
        if (a.status) {
          if (a.status !== 'retired') return { error: 'status 只能写 retired（并进别的守则、或者不用了）' };
          if (a.into) {
            const to = find('lessons', a.into);
            if (!to || a.into === old.id || (to.status || 'active') !== 'active') return { error: `into=${a.into} 要写一条还在用的别的守则` };
            patch.into = a.into;
          } else if (!a.why) return { error: '退役一条守则要写 into=（并进哪一条）或者 why=（为什么不用了）' };
          patch.status = 'retired';
          if (a.why) patch.retiredWhy = cut(a.why, 200);
          return { ...base, op: 'update', target: old.id, patch };
        }
        if (a.text) {
          const t = cut(a.text, 400);
          if (t !== old.text) patch.text = t;
        }
        if (a.why) patch.why = cut(a.why, 200);
        if (a.topic) patch.topic = cut(a.topic, 20);
        const addS = slips.filter((x) => !(old.slips || []).includes(x));
        if (addS.length) patch.slips = [...(old.slips || []), ...addS];
        const again = a.again ? cut(a.again, 160) : '';
        const more = addS.length + (again ? 1 : 0);
        if (more) patch.hits = (Number(old.hits) || 1) + more;
        if (again) patch.recent = [...(Array.isArray(old.recent) ? old.recent : []), `${date.slice(5)} ${again}`].slice(-RECENT_MAX);
        if (!Object.keys(patch).length) return { error: `${old.id} 没有要改的：又犯了写 again="…"，改写写 text="…"，归纳失误写 slips=…` };
        patch.last = date;
        return { ...base, op: 'update', target: old.id, patch };
      }
      if (!a.text) return { error: '新守则要写 text（下次照着就能做的动作）' };
      if (a.again || a.status) return { error: 'again、status 要写 id=（哪一条守则）' };
      const act = activeLessons(get('lessons'), space);
      const near = act.map((l) => ({ l, s: similarity(a.text, l.text) })).sort((x, y) => y.s - x.s)[0];
      if (near && near.s >= SIMILAR) return { error: `和 ${near.l.id}（${cut(near.l.text, 40)}）说的是同一件事：改写那一条（lesson id=${near.l.id} text="…" slips=…），或者记又犯一次（again="…"），不新加` };
      if (act.length >= LESSONS_MAX) return { error: `这一科的守则已经有 ${act.length} 条（最多 ${LESSONS_MAX}）：先把意思重复的合并（lesson id=… status=retired into=…），再加新的` };
      return { ...base, op: 'add', target: nextLessonId(get('lessons')), data: { text: cut(a.text, 400), ...(a.why ? { why: cut(a.why, 200) } : {}), ...(a.topic ? { topic: cut(a.topic, 20) } : {}), slips, hits: Math.max(1, slips.length), since: date, last: date, status: 'active', by: 'class', source: `课堂 ${sid || ''}`.trim(), ...(space ? { space } : {}) } };
    }
    case 'note':
    case 'propose': {
      if (!a.text) return { error: `${spec.label}要写 text` };
      // 观察只记以后用得上的：作答本身页面已经记了（每一次作答、对错、用时），不复述
      const dup = alike(a.text, get('observations').filter((o) => (o.session === sid || o.block === ctx.block) && ['note', 'proposal'].includes(o.kind) && !o.void));
      if (dup) return { error: `和已经记的一条观察（${cut(dup.text, 30)}）说的是同一件事，不另记` };
      return { ...base, op: 'add', target: `ob-${newId()}`, data: { kind: kind === 'propose' ? 'proposal' : 'note', text: cut(a.text, 2000), about: (a.about || []).slice(0, 20), session: sid, block: ctx.block || null, at: Date.now(), by: 'class', ...(basis.length ? { basis } : {}) } };
    }
    case 'error': {
      // 题面、学生的答案没写：从依据里那次作答补上
      const rec = (ctx.evidence || []).filter((e) => basis.includes(e.id) && e.src === 'record').at(-1);
      const q = a.q || rec?.q || '';
      // 选择题的记录没有 value：错选过的选项就是学生的答案（2026-11-02 qz-b29 的错题因为这个没记上）
      const picks = Array.isArray(rec?.wrong) && rec.wrong.length ? `先选了 ${rec.wrong.join('、')}${rec.ok ? '，后来才选对' : ''}` : '';
      const mine = a.mine || rec?.value || rec?.last || rec?.text || picks || '';
      for (const [k, v] of [['q', q], ['mine', mine], ['step', a.step], ['cause', a.cause]]) if (!v) return { error: `错题要写 ${k}${k === 'q' || k === 'mine' ? '（或者 basis 写那道题的组件 id，页面从作答里补）' : ''}` };
      const block = a.block || ctx.block || null;
      let id = a.id;
      if (id && !COLLECTIONS.errors.id.re.test(id)) return { error: `错题编号「${id}」不对，像 L2-07；不写 id 页面自动编` };
      if (id && find('errors', id)) return { error: `错题 ${id} 已经有了：错题只增不改，换一个新编号，或者不写 id` };
      if (a.weakness && !find('weaknesses', a.weakness)) return { error: `weakness=${a.weakness} 在弱点表里没有` };
      if (block && get('curriculum').length && !find('curriculum', block)) return { error: `block=${block} 在课程地图里没有` };
      // 同一个毛病一节课只记一道代表性的：这个弱点这节课已经挂了一道错题，就去改弱点（又犯了 → level=L0），不再加
      if (a.weakness && sid) {
        const same = get('errors').find((x) => x.session === sid && !x.corrects && x.weakness === a.weakness);
        if (same) return { error: `${a.weakness} 这节课已经记了一道错题（${same.id}）：同一个毛病只记一道，又犯了就改弱点（weakness id=${a.weakness} level=L0），不再加错题` };
      }
      // 同一道题（同一个组件的同一步）已经记过、没作废：不另记一条
      const evs = ctx.evidence || [];
      const keyOf = (eid) => { const e = evs.find((x) => x.id === eid); return e && e.comp ? `${e.comp}|${e.step ?? ''}` : ''; };
      const keys = new Set(basis.map(keyOf).filter(Boolean));
      if (keys.size) {
        const gone = voidedIds(mem);
        const dup = get('errors').find((x) => !x.corrects && !gone.has(`errors/${x.id}`) && (x.evidence || []).some((eid) => keys.has(keyOf(eid))));
        if (dup) return { error: `这道题已经记过 ${dup.id}：同一道题不另记；又错了说明弱点没修好，改弱点（weakness id=… level=L0 errors=${dup.id}）` };
      }
      {
        const gone = voidedIds(mem);
        const solved = resolvedErrors(mem);
        const dupE = alike(`${q} ${a.cause}`, get('errors').filter((x) => !x.corrects && !gone.has(`errors/${x.id}`) && !solved.has(String(x.id)) && (!block || x.block === block)).map((x) => ({ ...x, t: `${x.q || ''} ${x.cause || ''}` })), 't');
        if (dupE) return { error: `和错题 ${dupE.id}（${cut(dupE.cause || dupE.q, 30)}）是同一道题、同一个错：不另记；又错了就改弱点` };
      }
      id ||= nextErrorId(get('errors'), block);
      return { ...base, op: 'add', target: id, data: { source: cut(a.source || `课堂 ${sid || ''}`, 120), q: cut(q, 800), mine: cut(mine, 400), step: cut(a.step, 200), cause: cut(a.cause, 300), ...(a.weakness ? { weakness: a.weakness } : {}), ...(block ? { block } : {}), evidence: basis.filter((x) => x.startsWith('ev-')), date, session: sid } };
    }
    case 'weakness': {
      const old = a.id ? find('weaknesses', a.id) : null;
      for (const [f, v] of [['level', a.level], ['scope', a.scope], ['status', a.status]]) if (!enumOk('weaknesses', f, v) || v === 'void') return { error: `${f} 只能是 ${COLLECTIONS.weaknesses.enums[f].filter((x) => x !== 'void').join(' / ')}` };
      const errs = a.errors || [];
      for (const e of errs) if (!find('errors', e)) return { error: `errors 里的 ${e} 在错题档案里没有（这一轮新记的错题，写在 error 行的 weakness= 上挂）` };
      if (old) {
        if (['merged', 'void'].includes(old.status)) return { error: `${old.id} 已经${old.status === 'merged' ? `并进了 ${old.into || '别的一条'}` : '作废了'}` };
        const patch = {};
        if (a.status === 'merged') {
          const to = find('weaknesses', a.into);
          if (!to || a.into === old.id || ['merged', 'void', 'closed'].includes(to.status)) return { error: `into=${a.into || ''} 要写一条还在用的别的弱点` };
          return { ...base, op: 'update', target: old.id, patch: { status: 'merged', into: a.into, last: date } };
        }
        if (a.level && a.level !== old.level) patch.level = a.level;
        if (a.scope && a.scope !== old.scope) patch.scope = a.scope;
        if (a.status && a.status !== old.status) patch.status = a.status;
        if (a.title) patch.title = cut(a.title, 120);
        const addE = errs.filter((e) => !(old.errors || []).includes(e));
        if (addE.length) patch.errors = [...(old.errors || []), ...addE];
        const addB = (a.blocks || []).filter((b) => !(old.blocks || []).includes(b));
        if (addB.length) patch.blocks = [...(old.blocks || []), ...addB];
        // 只写了依据（同一个弱点这节课又出现了）：记下又出现、依据接上，不当成「没有要改的」拒掉
        if (!Object.keys(patch).length && basis.length) {
          const had = Array.isArray(old.basis) ? old.basis : [];
          const more = basis.filter((x) => !had.includes(x));
          if (more.length) { patch.basis = [...had, ...more].slice(-30); patch.last = date; }
        }
        if (!Object.keys(patch).length) return { error: `${a.id} 没有要改的（level / scope / status / errors / blocks 都和现在一样）` };
        patch.last = date;
        return { ...base, op: 'update', target: old.id, patch };
      }
      if (a.id && !COLLECTIONS.weaknesses.id.re.test(a.id)) return { error: `弱点编号「${a.id}」不对，像 W19；新弱点不写 id 页面自动编` };
      if (a.id) return { error: `弱点表里没有 ${a.id}：新弱点不写 id（页面自动编），要改的写已有的编号` };
      if (!a.title || !a.scope || !a.level) return { error: '新弱点要写 title、scope（通用 / 链条 / 局部）、level（L0～L3）' };
      {
        const space = spaceHere(a.blocks?.[0] || ctx.block);
        const live = liveDocs(mem, 'weaknesses', space);
        const near = nearest(a.title, live, 'title');
        if (near && near.s >= SIMILAR) return { error: `和 ${near.d.id}（${cut(near.d.title, 40)}）是同一个弱点：改那一条（weakness id=${near.d.id} level=… errors=…），不新加` };
        if (live.length >= CAPS.weaknesses) return { error: `这一科的弱点已经有 ${live.length} 条（最多 ${CAPS.weaknesses}）：先把重复的并掉（weakness id=… status=merged into=…）、修好的关掉，再加新的` };
      }
      return { ...base, op: 'add', target: nextWeaknessId(get('weaknesses')), data: { title: cut(a.title, 120), scope: a.scope, level: a.level, last: date, errors: errs, blocks: a.blocks?.length ? a.blocks : ctx.block ? [ctx.block] : [], status: 'active', basis, ...(sid ? { session: sid } : {}), ...(ctx.block || ctx.space ? { space: spaceHere(ctx.block) } : {}) } };
    }
    case 'review': {
      const old = a.id ? find('reviews', a.id) : null;
      if (a.id && !old) return { error: `复现组里没有 ${a.id}：新的一组不写 id（页面自动编）` };
      if (old) {
        if (['merged', 'void', 'done'].includes(old.status)) return { error: `${old.id} 已经${old.status === 'merged' ? `并进了 ${old.into || '别的一组'}` : old.status === 'done' ? '停掉了' : '作废了'}` };
        if (a.status) {
          if (a.status === 'merged') {
            const to = find('reviews', a.into);
            if (!to || a.into === old.id || ['merged', 'void', 'done'].includes(to.status)) return { error: `into=${a.into || ''} 要写一组还在用的别的复现组` };
            return { ...base, op: 'update', target: old.id, patch: { status: 'merged', into: a.into } };
          }
          if (a.status === 'done') {
            if (!a.why) return { error: '停掉一组要写 why=（比如盯的弱点都修好了）' };
            return { ...base, op: 'update', target: old.id, patch: { status: 'done', why: cut(a.why, 200) } };
          }
          return { error: 'status 只能写 merged（并进别的一组，写 into=）或 done（停掉，写 why=）；暂停由学生在页面上点' };
        }
        const patch = {};
        if (a.add) {
          const was = Array.isArray(old.content) ? old.content : old.content ? [String(old.content)] : [];
          if (was.some((c) => similarity(c, a.add) >= ALIKE)) return { error: `${old.id} 里已经有一样的题了，不另加` };
          patch.content = [...was, cut(a.add, 300)].slice(-LIST_CAPS.content);
        }
        if (a.result) {
          const passed = /^(过|通过|pass|ok|对)$/i.test(a.result);
          if (!passed && !/^(没过|不过|fail|没通过|错)$/i.test(a.result)) return { error: 'result 写「过」或「没过」' };
          patch.result = passed ? '过' : '没过';
          patch.tier = nextTier(old.tier, passed);
          patch.last = date;
        }
        for (const k of ['weaknesses', 'blocks']) {
          const add = (a[k] || []).filter((x) => !(old[k] || []).includes(x));
          if (add.length) patch[k] = [...(old[k] || []), ...add];
        }
        if (!Object.keys(patch).length) return { error: `${a.id} 没有要改的：加题写 add="…"，判结果写 result=过 / 没过` };
        return { ...base, op: 'update', target: old.id, patch };
      }
      if (!a.title) return { error: '新复现组要写 title（还有 family、content、weaknesses、blocks）' };
      {
        const space = spaceHere(a.blocks?.[0] || ctx.block);
        const live = liveDocs(mem, 'reviews', space);
        const near = nearest(`${a.title} ${a.family || ''}`, live.map((r) => ({ ...r, tf: `${r.title || ''} ${r.family || ''}` })), 'tf');
        if (near && near.s >= SIMILAR) return { error: `和 ${near.d.id}（${cut(near.d.title, 40)}）是同一组：往那一组加题（review id=${near.d.id} add="…"），不新开` };
        if (live.length >= CAPS.reviews) return { error: `这一科的复现组已经有 ${live.length} 组（最多 ${CAPS.reviews}）：先把同一机制族的并掉（review id=… status=merged into=…）` };
      }
      for (const w of a.weaknesses || []) if (!find('weaknesses', w)) return { error: `weaknesses 里的 ${w} 在弱点表里没有` };
      // 新的一组：从明天开始（档位 1 天，last 是今天）
      return { ...base, op: 'add', target: nextReviewId(get('reviews')), data: { title: cut(a.title, 120), ...(a.family ? { family: cut(a.family, 120) } : {}), content: a.content ? [cut(a.content, 300)] : [], weaknesses: a.weaknesses || [], blocks: a.blocks?.length ? a.blocks : ctx.block ? [ctx.block] : [], tier: 1, last: date, status: 'active', ...(sid ? { session: sid } : {}), ...(ctx.block || ctx.space ? { space: spaceHere(ctx.block) } : {}) } };
    }
    case 'recall': {
      // 要反复记的一条：q 问法、a 标准答案、block 挂哪一块（不写就是这节课的块）。从明天开始排（当天刚讲的不测）
      const old = a.id ? find('recall', a.id) : null;
      if (a.id && !old) return { error: `记忆点里没有 ${a.id}：新的一条不写 id（页面自动编）` };
      const curIds = new Set(get('curriculum').map((d) => String(d.id)));
      if (a.block && curIds.size && !curIds.has(String(a.block))) return { error: `课程地图里没有 ${a.block}：block 写块的编号，不写就挂这节课的块` };
      if (old) {
        if (old.status === 'void') return { error: `${old.id} 已经不要了` };
        if (a.status) {
          if (a.status !== 'void') return { error: 'status 只能写 void（这条不用记了，写 why=）；记牢没有由学生每天想的结果定' };
          return { ...base, op: 'update', target: old.id, patch: { status: 'void', why: cut(a.why || '', 200) } };
        }
        const patch = {};
        if (a.q) patch.q = cut(a.q, 300);
        if (a.a) patch.a = cut(a.a, 600);
        if (a.block) patch.block = String(a.block);
        if (!Object.keys(patch).length) return { error: `${a.id} 没有要改的：改问法写 q="…"，改答案写 a="…"，不要了写 status=void why="…"` };
        return { ...base, op: 'update', target: old.id, patch };
      }
      if (!a.q || !a.a) return { error: '新的记忆点要写 q="问法" 和 a="标准答案"（一条只问一件事；答案写成学生能对着检查的样子）' };
      const blk = String(a.block || ctx.block || '');
      const space = spaceHere(blk);
      const live = get('recall').filter((d) => (d.status || 'active') === 'active' && recallSpace(d) === space);
      const near = nearest(a.q, live, 'q');
      if (near && near.s >= SIMILAR) return { error: `和 ${near.d.id}（${cut(near.d.q, 40)}）是同一条：要改问法、答案写 recall id=${near.d.id} q="…" a="…"，不另加` };
      if (live.length >= RECALL_CAP) return { error: `这一科的记忆点已经有 ${live.length} 条（最多 ${RECALL_CAP}）：记得太碎了，先把重复的停掉（recall id=… status=void why="…"）` };
      return { ...base, op: 'add', target: nextRecallId(get('recall')), data: { q: cut(a.q, 300), a: cut(a.a, 600), ...(blk ? { block: blk } : {}), tier: 1, last: date, lapses: 0, status: 'active', space, ...(basis.length ? { basis } : {}), ...(sid ? { session: sid } : {}) } };
    }
    case 'position': {
      // 每科一条「下一节从哪接」：按这节课的块是哪一科
      const pid = positionId(spaceHere(a.block || ctx.block));
      const old = find('position', pid);
      const patch = {};
      if (a.next) patch.next = cut(a.next, 400);
      if (a.block) {
        if (get('curriculum').length && !find('curriculum', a.block)) return { error: `block=${a.block} 在课程地图里没有` };
        patch.block = a.block;
      }
      // 欠账、先收的题：整张换掉（不是往上加），最多几条；写得越长越没人看
      if (a.debts) patch.debts = a.debts.map((x) => cut(x, 80)).slice(0, LIST_CAPS.debts);
      if (a.first) patch.first = a.first.map((x) => cut(x, 120)).slice(0, LIST_CAPS.first);
      if (!Object.keys(patch).length) return { error: 'position 要写 next（下一节从哪接），可以加 block、debts、first' };
      if (old) {
        for (const k of Object.keys(patch)) if (same(old[k], patch[k])) delete patch[k];
        if (!Object.keys(patch).length) return { error: 'position 和现在的一样，不用改' };
        return { ...base, op: 'update', target: pid, patch };
      }
      if (!patch.block && !ctx.block) return { error: '还没有 position：第一次要写 block' };
      return { ...base, op: 'add', target: pid, data: { block: patch.block || ctx.block, next: patch.next || '', ...(patch.debts ? { debts: patch.debts } : {}), ...(patch.first ? { first: patch.first } : {}), log: [] } };
    }
    default:
      return { error: `不认识「${kind}」` };
  }
}

/* ---------------- 改动单 ---------------- */

/** 一个改动 → 一张改动单（pending）。by：class（课堂里的 Claude 写的）/ me（我自己改的） */
export function pendingRecord(change, { session = null, turn = null, by = 'class', line = '' } = {}) {
  const { kind, tier, coll, op, target, data, patch, reason, basis, label } = change;
  return {
    id: `pd-${newId()}`, kind, tier: by === 'me' ? 'me' : tier, by, coll, op, target, ...(data ? { data } : {}), ...(patch ? { patch } : {}),
    reason: reason || '', basis: basis || [], label: label || '', ...(line ? { line } : {}),
    session, ...(turn ? { turn } : {}), status: 'open', at: Date.now(), log: [],
  };
}

const logMeta = (pd, date, note) => ({ date, by: ['me', 'page', 'chat', 'lab'].includes(pd.by) ? pd.by : 'class', basis: (pd.basis || []).filter(Boolean), note });

/**
 * 执行一张改动单（直接写的那档马上执行；我确认才写的，我点「确认」时执行）。
 * mem：记忆库各类的数组（拿现在的那条）；edits：我在「改」里改过的字段（盖在 data / patch 上）。
 * 返回 { writes: [{ coll, id, doc }]（要 set 的文档，写之前已按角色拦过）, pd（新的改动单）}。查不过时抛出中文原因。
 */
export function applyPending(pd, mem = {}, { date = toDate(Date.now()), edits = null, now = Date.now() } = {}) {
  if (pd.status !== 'open') throw new Error(pd.status === 'done' ? '已经写进去了' : pd.status === 'rejected' ? '已经不要了' : '已经撤销了');
  // 谁的名义写：直接写那档是课堂里的 Claude（页面算的掌握、练习结果是页面）；要我确认的、我自己改的是我
  const role = pd.tier === 'direct' ? (pd.by === 'page' ? 'page' : 'class') : 'me';
  assertWrite(role, pd.coll);
  const docs = Array.isArray(mem[pd.coll]) ? mem[pd.coll] : [];
  const old = docs.find((d) => String(d.id) === String(pd.target));
  const note = pd.tier === 'confirm' ? `${pd.by === 'page' ? '页面按证据算的，' : pd.by === 'chat' ? '开发那边整理的，' : ''}我确认于 ${date}` : pd.tier === 'me' ? '我在学习台上改的' : pd.by === 'page' ? '页面按证据算的' : pd.by === 'lab' ? `教研室事后补 ${pd.session || ''}`.trim() : `课堂 ${pd.session || ''}`.trim();
  const isState = COLLECTIONS[pd.coll].kind === 'state';
  let doc, applied;
  if (pd.op === 'add') {
    // 编号固定的状态类（掌握的编号就是块）撤销过一次会留下一条 void 的：重新加时接着那条写（log 留着），
    // 不然撤销一次这一块以后永远加不上（页面每次算出来都撞号，什么都写不进去）
    const revive = old && isState && old.status === 'void' && !old.corrects;
    if (old && !revive) throw new Error(`${pd.coll} 里已经有 ${pd.target} 了`);
    const data = { ...pd.data, ...(edits || {}) };
    // 新的一条状态类：把带档位、证据级的字段从无到有记一笔 log，自检和以后的撤销都看得到是谁、哪天定的
    doc = isState ? { ...data, ...(revive && data.status === undefined ? { status: 'active' } : {}), log: [...(revive ? old.log || [] : []), ...(data.log || []), ...COLLECTIONS[pd.coll].tracked.filter((f) => data[f] !== undefined).map((f) => ({ ...logMeta(pd, date, note), field: f, from: revive ? old[f] ?? null : null, to: data[f], ref: pd.id }))] } : data;
    applied = null;
  } else {
    if (!old) throw new Error(`${pd.coll} 里没有 ${pd.target} 了`);
    const patch = { ...pd.patch, ...(edits || {}) };
    const { id: _, ...rest } = old;
    const next = applyChange(rest, patch, logMeta(pd, date, note));
    // 这次加的 log 记上改动单的编号：撤销时按它找
    next.log = next.log.map((e, i) => (i >= (rest.log || []).length ? { ...e, ref: pd.id } : e));
    doc = next;
    applied = Object.keys(patch).filter((k) => !same(old[k], patch[k])).map((k) => ({ field: k, from: old[k] ?? null, to: patch[k] }));
  }
  const npd = { ...pd, ...(edits ? { edited: edits } : {}), status: 'done', doneAt: now, ...(applied ? { applied } : {}), log: [...(pd.log || []), { date, by: role, field: 'status', from: 'open', to: 'done', basis: [] }] };
  return { writes: [{ coll: pd.coll, id: String(pd.target), doc }, { coll: 'pending', id: pd.id, doc: strip(npd) }], pd: npd };
}

/** 我点了「不要」：改动单留着（标成 rejected），课后还看得到 */
export function rejectPending(pd, { date = toDate(Date.now()), now = Date.now(), note = '' } = {}) {
  if (pd.status !== 'open') throw new Error('只有等确认的才能不要');
  const npd = { ...pd, status: 'rejected', rejectedAt: now, ...(note ? { note } : {}), log: [...(pd.log || []), { date, by: 'me', field: 'status', from: 'open', to: 'rejected', basis: [] }] };
  return { writes: [{ coll: 'pending', id: pd.id, doc: strip(npd) }], pd: npd };
}

/** 还能不能撤销：写进去了、没超过 UNDO_DAYS 天 */
export function canUndo(pd, today = toDate(Date.now())) {
  if (pd?.status !== 'done' || !pd.doneAt) return false;
  return daysBetween(toDate(pd.doneAt), today) < UNDO_DAYS;
}

/**
 * 撤销一张已经写进去的改动单。状态类：新加的一条改成 status: void（偏好、弱点、复现组），改过的字段退回旧值（都记 log）；
 * 历史类（错题、失误、观察）：原条不动，追加一条作废的更正（corrects 指向原条）。
 * 后来又被别人改过的字段不退（不然会把后来的改动冲掉），抛出原因。
 */
export function undoPending(pd, mem = {}, { date = toDate(Date.now()), now = Date.now() } = {}) {
  if (!canUndo(pd, date)) throw new Error(pd?.status === 'done' ? `写进去超过 ${UNDO_DAYS} 天了，不能撤：要改在课上说，或者在「我改记忆」里改` : '这一条没有写进去，不用撤');
  assertWrite('me', pd.coll);
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);
  const cur = get(pd.coll).find((d) => String(d.id) === String(pd.target));
  if (!cur) throw new Error(`${pd.coll} 里没有 ${pd.target} 了`);
  const meta = { date, by: 'me', basis: [], note: `撤销 ${pd.id}` };
  const { id: _, ...rest } = cur;
  const writes = [];
  if (COLLECTIONS[pd.coll].kind === 'state') {
    let patch;
    if (pd.op === 'add') {
      if (pd.coll === 'position') throw new Error('当前位置只有一条，撤销请改「下一节」');
      patch = { status: 'void' };
    } else {
      patch = {};
      for (const a of pd.applied || []) {
        if (!same(cur[a.field], a.to)) throw new Error(`${pd.target} 的 ${a.field} 后来又改过了，不能撤`);
        patch[a.field] = a.from;
      }
    }
    writes.push({ coll: pd.coll, id: String(pd.target), doc: applyChange(rest, patch, meta) });
  } else {
    // 历史类：追加一条作废的更正
    const fix = voidCorrection(pd.coll, cur, get(pd.coll), { date, pd });
    writes.push({ coll: pd.coll, id: fix.id, doc: strip(fix) });
  }
  const npd = { ...pd, status: 'undone', undoneAt: now, log: [...(pd.log || []), { date, by: 'me', field: 'status', from: 'done', to: 'undone', basis: [] }] };
  writes.push({ coll: 'pending', id: pd.id, doc: strip(npd) });
  return { writes, pd: npd };
}

// 历史类的作废更正：新编号，corrects 指向原条，void: true；必填字段照抄原条（自检照样过）
function voidCorrection(coll, orig, all, { date, pd }) {
  const note = `撤销：我在学习台上撤了这一条（${date}${pd ? `，改动单 ${pd.id}` : ''}）`;
  if (coll === 'errors') {
    const { id: _, log: _l, ...rest } = orig;
    return { ...rest, id: nextErrorId(all, orig.block || orig.id), corrects: String(orig.id), void: true, note, date };
  }
  if (coll === 'slips') return { id: `${String(orig.id)}-x`, by: orig.by, date, text: `（作废）${orig.text}`, corrects: String(orig.id), void: true, note, ...(orig.session ? { session: orig.session } : {}) };
  return { id: `ob-${newId()}`, kind: 'note', text: `（作废）${cut(orig.text, 200)}`, corrects: String(orig.id), void: true, note, at: Date.now(), by: 'me', ...(orig.session ? { session: orig.session } : {}) };
}

/** 被作废的条目（status: void，或者有一条 void 的更正指向它）、并进别的一条的（status: merged）：摘要、页面列表都不再当真 */
export function voidedIds(mem = {}) {
  const out = new Set();
  for (const c of ['errors', 'slips', 'observations', 'profile', 'weaknesses', 'reviews', 'lessons', 'mastery', 'recall']) {
    for (const d of mem[c] || []) {
      if (!d) continue;
      if (d.status === 'void' || d.status === 'merged') out.add(`${c}/${d.id}`);
      if (d.void && d.corrects) { out.add(`${c}/${d.corrects}`); out.add(`${c}/${d.id}`); }
    }
  }
  return out;
}

/* ---------------- 我自己改（tier: me）---------------- */

/**
 * 我在学习台上改记忆：偏好的文字、错题标已解决（追加一条更正，不改原条）、复现组暂停 / 恢复。
 * 返回一张 tier: me 的改动单（status: open），交给 applyPending 执行（一样能撤销）。
 */
export function meChange(what, mem = {}, args = {}) {
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);
  const date = args.date || toDate(Date.now());
  if (what === 'pref') {
    const p = get('profile').find((d) => d.id === args.id);
    if (!p) throw new Error(`没有 ${args.id}`);
    const text = String(args.text || '').trim();
    if (!text) throw new Error('写点什么');
    if (text === p.text) throw new Error('和原来一样');
    return pendingRecord({ kind: 'pref', tier: 'me', coll: 'profile', op: 'update', target: p.id, patch: { text: cut(text, 600) }, label: '偏好', reason: '我改的' }, { by: 'me' });
  }
  if (what === 'lesson' || what === 'lesson-retire') {
    const l = get('lessons').find((d) => d.id === args.id);
    if (!l) throw new Error(`没有 ${args.id}`);
    if (what === 'lesson-retire') return pendingRecord({ kind: 'lesson', tier: 'me', coll: 'lessons', op: 'update', target: l.id, patch: { status: 'retired', retiredWhy: '我说不用了' }, label: '守则', reason: '我改的' }, { by: 'me' });
    const text = String(args.text || '').trim();
    if (!text) throw new Error('写点什么');
    if (text === l.text) throw new Error('和原来一样');
    return pendingRecord({ kind: 'lesson', tier: 'me', coll: 'lessons', op: 'update', target: l.id, patch: { text: cut(text, 400) }, label: '守则', reason: '我改的' }, { by: 'me' });
  }
  if (what === 'resolve') {
    const e = get('errors').find((d) => d.id === args.id);
    if (!e) throw new Error(`没有 ${args.id}`);
    const { id: _, log: _l, ...rest } = e;
    return pendingRecord({ kind: 'error', tier: 'me', coll: 'errors', op: 'add', target: nextErrorId(get('errors'), e.block || e.id), data: { ...rest, corrects: e.id, resolved: true, date, note: `我标了已解决（${date}）${args.note ? `：${cut(args.note, 200)}` : ''}` }, label: '错题已解决', reason: '我标的' }, { by: 'me' });
  }
  if (what === 'pause' || what === 'resume') {
    const r = get('reviews').find((d) => d.id === args.id);
    if (!r) throw new Error(`没有 ${args.id}`);
    const to = what === 'pause' ? 'paused' : 'active';
    if ((r.status || 'active') === to) throw new Error(what === 'pause' ? '已经暂停了' : '没有暂停');
    return pendingRecord({ kind: 'review', tier: 'me', coll: 'reviews', op: 'update', target: r.id, patch: { status: to }, label: what === 'pause' ? '暂停复现组' : '恢复复现组', reason: '我改的' }, { by: 'me' });
  }
  // 我自己加一条要记的（学习台外面看到的、自己想背的）；不用记了的停掉
  if (what === 'recall-add') {
    const q = String(args.q || '').trim();
    const a = String(args.a || '').trim();
    if (!q || !a) throw new Error('问法和答案都要写');
    const block = String(args.block || '');
    const space = block ? spaceOfId(block) : (args.space || 'math');
    const near = nearest(q, get('recall').filter((d) => (d.status || 'active') === 'active' && recallSpace(d) === space), 'q');
    if (near && near.s >= SIMILAR) throw new Error(`已经有一条差不多的了：${cut(near.d.q, 40)}`);
    return pendingRecord({ kind: 'recall', tier: 'me', coll: 'recall', op: 'add', target: nextRecallId(get('recall')), data: { q: cut(q, 300), a: cut(a, 600), ...(block ? { block } : {}), tier: 1, last: date, lapses: 0, status: 'active', space }, label: '记忆点', reason: '我自己加的' }, { by: 'me' });
  }
  if (what === 'recall-void') {
    const k = get('recall').find((d) => d.id === args.id);
    if (!k) throw new Error(`没有 ${args.id}`);
    if (k.status === 'void') throw new Error('已经不用记了');
    return pendingRecord({ kind: 'recall', tier: 'me', coll: 'recall', op: 'update', target: k.id, patch: { status: 'void', why: '我说不用记了' }, label: '记忆点', reason: '我改的' }, { by: 'me' });
  }
  throw new Error(`不认识「${what}」`);
}

/** 已经标了已解决的错题（有一条 resolved 的更正指向它，而且那条更正没被撤销） */
export function resolvedErrors(mem = {}) {
  const gone = voidedIds(mem);
  return new Set((mem.errors || []).filter((e) => e?.resolved && e.corrects && !gone.has(`errors/${e.id}`)).map((e) => String(e.corrects)));
}

/* ---------------- 给人看 ---------------- */

/**
 * 一张改动单一句话：「错题 L2-08：把 βᵀα 当矩阵」。nameOf(coll, id)：给我看时把编号换成名字（弱点、复现组、守则、偏好的标题），
 * 不给就照旧写编号（发给课堂里的 Claude 的那份要编号）
 */
// 标题会按 Markdown 画：不截在公式中间（$ 落单了就成了原始 LaTeX）
const cutM = (x, n) => { let c = cut(x, n); if (c.endsWith('…') && ((c.match(/(?<!\\)\$/g) || []).length) % 2) c = `${c.slice(0, c.lastIndexOf('$')).trimEnd()}…`; return c; };
export function pendingTitle(pd, nameOf = null) {
  const d = pd.data || {}, p = pd.patch || {};
  const nm = (coll, id) => { const t = nameOf ? nameOf(coll, id) : ''; return t ? `「${cutM(t, 24)}」` : String(id ?? ''); };
  const me = () => nm(pd.coll, pd.target);
  const FIELD = { level: '证据级', scope: '影响面', status: '状态', errors: '挂的错题', blocks: '相关的块', title: '标题' };
  const what = {
    pref: () => (p.status === 'merged' ? `${me()} 并进 ${nm('profile', p.into)}` : p.status === 'void' ? `${me()} 不用了` : `${d.topic ? `［${d.topic}］` : ''}${d.text || p.text || ''}`),
    todo: () => d.text,
    rule: () => (pd.op === 'add' ? `［${d.cat || ''}］${d.text}` : p.status === 'void' ? `作废一条：${p.note || ''}` : p.text ? `改成：${p.text}` : p.space ? `只给${{ math: '数学', cs: '408', en: '英语' }[p.space] || p.space}的课` : '改了'),
    slip: () => d.text,
    lesson: () => (pd.op === 'add' ? d.text : p.status === 'retired' ? `${me()} ${p.into ? `并进 ${nm('lessons', p.into)}` : '不用了'}` : p.text ? `改写：${p.text}` : p.recent ? `${me()} 又犯一次：${String(p.recent.at(-1)).slice(6)}` : `${me()} 归纳了 ${(p.slips || []).length} 条失误`),
    note: () => d.text,
    propose: () => d.text,
    error: () => (d.resolved ? `${nameOf ? '一道错题' : d.corrects} 已解决` : `${nameOf ? '' : `${pd.target}：`}${d.cause || d.q || ''}`),
    weakness: () => (pd.op === 'add' ? `${nameOf ? '' : `${pd.target} `}${d.title}（${d.scope}，${d.level}）` : p.status === 'merged' ? `${me()} 并进 ${nm('weaknesses', p.into)}` : `${me()} ${Object.entries(p).filter(([k]) => k !== 'last' && !(nameOf && k === 'errors')).map(([k, v]) => `${nameOf ? FIELD[k] || k : k} → ${Array.isArray(v) ? (nameOf && k === 'blocks' ? v.map((b) => nm('curriculum', b)).join('、') : v.join('、')) : v}`).join('，') || (nameOf && p.errors ? '多挂了一道错题' : '')}`),
    review: () => (pd.op === 'add' ? `${nameOf ? '' : `${pd.target} `}${d.title}` : `${me()} ${p.status ? ({ paused: '暂停', merged: `并进 ${nm('reviews', p.into)}`, done: `停掉：${p.why || ''}` }[p.status] || '恢复') : p.result ? `${p.result}，下次 ${p.tier} 天后` : p.content ? `加题：${p.content.at(-1)}` : '改了'}`),
    recall: () => (pd.op === 'add' ? `${d.q} → ${d.a}` : p.status === 'void' ? `${me()} 不用记了${p.why ? `：${p.why}` : ''}` : p.result ? `${me()} ${{ got: '想起来了', vague: '模糊', miss: '没想起' }[p.result] || ''}` : `${me()} 改成：${p.q || ''}${p.a ? ` → ${p.a}` : ''}`),
    position: () => p.next || d.next || (p.block ? `学到 ${nm('curriculum', p.block)}` : '改了'),
    mastery: () => { const st = p.state || d.state; const t = p.tier ?? d.tier; return `${nm('curriculum', String(pd.target).split('#')[0])}${String(pd.target).includes('#') ? ` ${String(pd.target).split('#')[1]}` : ''} → ${st}${st === '复现通过' && t ? `（第 ${t} 天那档）` : ''}`; },
  }[pd.kind];
  return `${pd.label || MEMO_KINDS[pd.kind]?.label || pd.kind}${!nameOf && pd.op === 'update' && !['weakness', 'review', 'lesson', 'mastery', 'rule', 'pref'].includes(pd.kind) ? ` ${pd.target}` : ''}：${cutM(what ? what() : '', 80)}`;
}

/**
 * 等确认的改动单分批：同一次来的（开发那边整理的一批、页面算的掌握、同一节课提的）凑够 min 条就合成一组，
 * 首页「待确认」一组一行，「全部确认 / 全部不要」一次点完，不用一条条翻（2026-11-03 一次整理规则 33 条，首页长得翻不完）。
 * 返回 [{ key, label, items }]，单独的那几条 label 是空的、items 只有一条；顺序照原来的
 */
export function groupPending(pds = [], { min = 3 } = {}) {
  const keyOf = (p) => (p.by === 'chat' ? 'chat' : p.by === 'page' ? `page|${p.kind}` : p.by === 'me' ? 'me' : `class|${p.session || ''}`);
  const buckets = new Map();
  for (const p of pds) { const k = keyOf(p); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(p); }
  const out = [];
  const seen = new Set();
  for (const p of pds) {
    const k = keyOf(p);
    const list = buckets.get(k);
    if (list.length < min) { out.push({ key: p.id, label: '', items: [p] }); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    const sess = /^class\|c-(\d{4})(\d{2})(\d{2})/.exec(k);
    const label = k === 'chat' ? (list.every((x) => x.kind === 'rule') ? '整理规则' : '开发那边整理的')
      : k.startsWith('page|') ? (p.kind === 'mastery' ? '页面按证据算的掌握' : '页面算的')
      : sess ? `${Number(sess[2])} 月 ${Number(sess[3])} 日那节课提的` : '课堂里提的';
    out.push({ key: k, label, items: list });
  }
  return out;
}

/** 这一轮记了什么（板顶那句话下面的小字）：「记下了：偏好 1 条；待你确认：错题 1 条」 */
export function memoLine(pds = []) {
  // 只数和学生有关的（错题、弱点、复现组……）；老师自己的失误、守则、观察合成一句「老师的笔记」
  const TEACHER = new Set(['slip', 'lesson', 'note', 'propose']);
  const count = (list) => {
    const mine = list.filter((p) => !TEACHER.has(p.kind));
    const own = list.length - mine.length;
    return [countBy(mine), own ? `老师的笔记 ${own} 条` : ''].filter(Boolean).join('、');
  };
  const countBy = (list) => {
    const m = new Map();
    for (const p of list) m.set(p.label || MEMO_KINDS[p.kind]?.label || p.kind, (m.get(p.label || MEMO_KINDS[p.kind]?.label || p.kind) || 0) + 1);
    return [...m].map(([k, n]) => `${k} ${n} 条`).join('、');
  };
  const done = pds.filter((p) => p.status === 'done' && p.tier === 'direct');
  const open = pds.filter((p) => p.status === 'open');
  const ok = pds.filter((p) => p.status === 'done' && p.tier !== 'direct');
  const parts = [];
  if (done.length) parts.push(`记下了：${count(done)}`);
  if (open.length) parts.push(`待你确认：${count(open)}`);
  if (ok.length) parts.push(`你确认了：${count(ok)}`);
  const gone = pds.filter((p) => p.status === 'rejected' || p.status === 'undone').length;
  if (gone) parts.push(`没要 / 撤了 ${gone} 条`);
  return parts.join('；');
}

const strip = (d) => { const { id: _, ...rest } = d || {}; return rest; };
