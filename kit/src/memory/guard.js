// 守卫（docs/guard-plan.md）：每一条要写进记忆库的内容（错题、弱点、观察、失误、守则、复现组、要记的、位置、复盘……）
// 写进去之前过六道检查。Claude 写的话一个字不改，只判断它能不能收、收下要不要挂提醒、要不要先暂存。纯函数，有测试
// （tests/memory-guard.test.js），真数据的量法在 tools/guard-audit.mjs。
//
// 不碰上课的速度：只在写进记忆库那一刻跑（memo 块执行时、下课以后、首页、云端），几毫秒，不调用 Claude。
import { COLLECTIONS } from './schema.js';
import { validateWrite } from './writer.js';
import { similarity } from './memo.js';
import { spaceOfId } from './space.js';

export const GUARD_VERSION = 1;

/**
 * 谁写的：class 课堂里的 Claude（当场看着作答写，最准）；lab 云端教研室 / 首页后台事后写的；page 页面代码；chat 开发那边；me 我。
 * strict：对不上的先暂存（事后写的没有当场的上下文，更容易张冠李戴）
 */
export const AUTHORS = { class: { strict: false }, lab: { strict: true }, page: { strict: false }, chat: { strict: false }, me: { strict: false } };

/** 每一类里是 Claude 写的话的字段（原话、轮次、组件就在这些字段里找） */
// 会重复记的几类（掌握、位置是一块一条、一科一条，说法相近不算重复）
const DEDUP = new Set(['errors', 'weaknesses', 'observations', 'slips', 'lessons', 'reviews', 'recall', 'profile', 'rules']);
// 依据里像编号的：没有空格，不超过 60 个字，不是一句话
const isIdLike = (t) => /^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,59}$/.test(t);

export const TEXT_FIELDS = {
  errors: ['q', 'mine', 'cause', 'step'],
  weaknesses: ['title', 'note', 'why'],
  observations: ['text'],
  slips: ['text', 'lesson'],
  lessons: ['text', 'why', 'recent'],
  reviews: ['title', 'content', 'note', 'why'],
  recall: ['q', 'a'],
  position: ['next', 'debts', 'content'],
  profile: ['text'],
  rules: ['text'],
  mastery: ['note'],
  debrief: ['text', 'basis', 'how', 'where', 'q', 'what', 'advice'],
};

// —— 文字的规范化：不管空格、大小写、全角半角、各种引号破折号（原话照抄时常见的差别）——
const FULL = { '，': ',', '。': '.', '：': ':', '；': ';', '！': '!', '？': '?', '（': '(', '）': ')', '【': '[', '】': ']', '“': '"', '”': '"', '‘': "'", '’': "'", '「': '"', '」': '"', '『': '"', '』': '"', '—': '-', '–': '-', '～': '~', '、': ',' };
export function normText(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[，。：；！？（）【】“”‘’「」『』—–～、]/g, (c) => FULL[c] || c)
    .replace(/\\[a-zA-Z]+/g, '') // 公式命令（\hl、\text…）不算字
    .replace(/[\s$*_`{}]+/g, '')
    .toLowerCase();
}

/** 一段字里的二字组（判断「大体是不是同一句」用） */
const grams = (t) => { const s = normText(t); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
/** a 的二字组有多少落在 b 里（0～1）：a 是不是 b 的一部分（不要求一字不差） */
export function containment(a, b) {
  const A = grams(a);
  if (!A.size) return 1;
  const B = b instanceof Set ? b : grams(b);
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / A.size;
}

/**
 * 一节课的「记录」：每一轮的话（学生的、老师的，板书指令也在老师那一轮的原文里）、每一条作答（题面、学生写的、对的答案）。
 * turns：class_turns；evidence：这节课的证据。返回 { all（规范化后拼起来）, bySeq, comps }
 */
export function buildCorpus({ turns = [], evidence = [] } = {}) {
  const bySeq = new Map();
  const comps = new Set();
  const parts = [];
  for (const t of turns || []) {
    if (!t) continue;
    // 老师那一轮里的 memo 块、计划块不算「记录」：它们就是要核的东西本身（memo 里编的原话，在 memo 里当然找得到）
    const said = String(t.text || '').replace(/(`{3,})\s*board\s+(memo|plan)\b[\s\S]*?(\1|$)/g, '');
    const txt = [said, t.say, ...(Array.isArray(t.actions) ? t.actions.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))) : [])].filter(Boolean).join('\n');
    const n = normText(txt);
    if (Number.isFinite(Number(t.seq))) bySeq.set(Number(t.seq), n);
    parts.push(n);
    // 板上的组件、段的编号：board 指令里的 id=…、组件块里的 id: …、boardOps 里记的
    for (const m of String(t.text || '').matchAll(/\bid\s*[=:]\s*"?([A-Za-z0-9_-]{1,40})/g)) comps.add(m[1]);
    for (const op of t.boardOps || []) if (op?.id) comps.add(String(op.id));
  }
  for (const e of evidence || []) {
    if (!e) continue;
    if (e.comp) comps.add(String(e.comp));
    if (e.step) comps.add(String(e.step));
    parts.push(normText([e.q, e.value, e.text, e.expected, e.transcript, e.answer, e.say, e.detail && JSON.stringify(e.detail)].filter(Boolean).join('\n')));
  }
  return { all: parts.join('\n'), bySeq, comps, turns: bySeq.size, empty: !parts.length };
}

// 引号里的字算「引的原话」的时候：紧挨着轮次（#43）或者「原话 / 写 / 说 / 答 / 回 / 打 / 标 / 选」这类词。
// 别的引号多半是起名字（「后面那块是在补充前面，就判宾补」是给一种误解起的名字），不按原话核对
const CITE_BEFORE = /(#\d+|第\s*\d+\s*轮|原话|原文|(写|说|答|回|打|标|选|问|填)(了|过|着|成|出|答|的是)?|抗议|抱怨|反问|吐槽|爆发|喊)\s*[:：]?\s*$/;
const QUOTE_RE = /「([^」]{2,200})」|“([^”]{2,200})”|"([^"\n]{4,200})"/g;

/** 一段字里的引号：[{ quote, cited, turn }]（turn：紧挨着的 #43） */
export function findQuotes(text) {
  const s = String(text ?? '');
  const out = [];
  for (const m of s.matchAll(QUOTE_RE)) {
    const quote = m[1] ?? m[2] ?? m[3];
    const before = s.slice(Math.max(0, m.index - 24), m.index);
    // 前面不远处有轮次（#45 标题又写着「…」、#77 qz-b29「…」、#59 爆发：「…」），中间没有别的引号：也是引原话
    const adjacent = CITE_BEFORE.test(before);
    const cited = adjacent || /#\d+[^「」"“”#]{0,22}$/.test(before);
    const tm = before.match(/#(\d+)[^#]*$/);
    out.push({ quote, cited, adjacent, turn: tm ? Number(tm[1]) : null });
  }
  return out;
}

/** 指的轮次：#43、第 43 轮 */
export const turnRefs = (text) => [...String(text ?? '').matchAll(/#(\d{1,4})\b|第\s*(\d{1,4})\s*轮/g)].map((m) => Number(m[1] ?? m[2]));

/** 指的组件、段：b12、ps-b26r、qz-b10、ex-b11、cj-b18（课堂里的编号习惯） */
export const compRefs = (text) => [...new Set([...String(text ?? '').matchAll(/(?<![A-Za-z0-9_-])((?:[a-z]{1,4}-)?b\d{1,3}[a-z]?)(?![A-Za-z0-9_-])/g)].map((m) => m[1]))];

/** 一条里 Claude 写的话（按这一类的字段，数组、对象展开成一段） */
export function textOf(coll, doc) {
  const fields = TEXT_FIELDS[coll] || ['text'];
  const flat = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(flat).join('\n') : typeof v === 'object' ? Object.values(v).map(flat).join('\n') : String(v));
  return fields.map((f) => flat(doc?.[f])).filter(Boolean).join('\n');
}

/** 这一条原来是谁写的：我改过的（log 里有 me）算我的；否则 by 字段、log 里最早那一条、挂着课的算课堂 */
export function authorOf(doc) {
  if (!doc) return '';
  const log = Array.isArray(doc.log) ? doc.log : [];
  if (log.some((e) => e?.by === 'me')) return 'me';
  if (doc.by) return String(doc.by);
  if (log[0]?.by) return String(log[0].by);
  return doc.session ? 'class' : '';
}

const lastOk = (e) => (typeof e?.ok === 'boolean' ? e.ok : null);

/**
 * 守一条候选。cand：{ coll, id, doc（写成的整份，不带 id）, before（原来的，没有就是新加）, author, session, basis（这次的依据 id） }
 * ctx：{ mem（记忆库各类的数组）, corpus（这节课的 buildCorpus；没有就不核原话）, now }
 * ctx.allComps：所有课的板上编号（buildCorpus 的 comps 合起来），指了别的课的题时用
 * 返回 { verdict: 'accept' | 'flag' | 'hold' | 'reject', checks: [{ gate, level: 'info' | 'warn' | 'fail', code, msg }] }
 */
export function guardCandidate(cand, ctx = {}) {
  const { coll, id, doc = {}, before = null, author = 'class', session = null } = cand;
  const mem = ctx.mem || {};
  const corpus = ctx.corpus || null;
  const checks = [];
  const add = (gate, level, code, msg) => checks.push({ gate, level, code, msg });
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);

  // 1. 格式（记忆库的那几类）
  if (COLLECTIONS[coll]) for (const m of validateWrite(`${coll}/${id}`, doc)) add('format', 'fail', 'schema', m);

  // 2. 证据
  const allIds = new Set();
  for (const c of ['evidence', 'errors', 'weaknesses', 'observations', 'reviews', 'mastery', 'slips', 'lessons', 'recall', 'sessions', 'drills']) for (const d of get(c)) if (d?.id) allIds.add(String(d.id));
  // 依据里像编号的（没有空格、不长）必须找得到；写成一段话的（以前对话里记的「旧记录：……」、复盘里「#43 学生原话……」）
  // 不是编号，按文字核（里面的原话、轮次在下面查）
  const tokens = [...new Set([...(cand.basis || []), ...list(doc.basis), ...list(doc.evidence)].map(String))];
  const basis = tokens.filter(isIdLike);
  const missing = basis.filter((b) => !allIds.has(b));
  if (missing.length) add('evidence', 'fail', 'basis-missing', `依据 ${missing.slice(0, 4).join('、')} 在记忆库里找不到`);
  // 写了、但找不到被去掉的依据（memo.js 的 planEntry 去掉的，那一条照记）：像编号的要提醒（多半是编出来的证据编号）
  const dropped = list(cand.missingBasis).map(String).filter(isIdLike);
  if (dropped.length) add('evidence', 'warn', 'basis-dropped', `写的依据 ${dropped.slice(0, 4).join('、')} 这节课里没有，没算进去`);
  if (session) {
    const evs = get('evidence');
    const other = basis.map((b) => evs.find((e) => String(e.id) === b)).filter((e) => e?.session && e.session !== session);
    const sStart = Number(get('sessions').find((s) => s.id === session)?.startedAt) || Infinity;
    const later = other.filter((e) => Number(e.at) > sStart);
    if (later.length) add('evidence', 'warn', 'basis-later', `依据 ${later.map((e) => e.id).slice(0, 3).join('、')} 是这节课以后别的课的作答`);
  }
  const text = textOf(coll, doc);
  // 只有存着这节课每一轮的记录时才核原话、轮次、板上编号（只有证据没有轮次的课，老师的话核不了，不冤枉它）
  if (corpus && corpus.turns && session) {
    // 建议、开场题是写给下一节老师照着做的（「问『它 + 什么？』」是叫老师这么问），里面的引号不是引原话：只核挨着轮次的
    const prescriptive = coll === 'debrief' && (doc.advice || doc.q || doc.what);
    // 这一条挂着的记忆（归纳守则的 slips=、挂的错题、about=、依据里的记忆编号）里的话也算出处：
    // 下课归纳守则时引的是以前别的课记的失误原文，那几句本来就不在这节课的记录里
    const refIds = new Set([...list(doc.slips), ...list(doc.errors), ...list(doc.about), ...list(doc.weakness), ...list(cand.basis), ...list(doc.basis)].map(String));
    const refAll = refIds.size ? ['slips', 'errors', 'weaknesses', 'observations', 'lessons', 'reviews'].flatMap((c) => get(c).filter((d) => refIds.has(String(d.id))).map((d) => normText(textOf(c, d)))).join('\n') : '';
    for (const q of findQuotes(text)) {
      if (!q.cited || (prescriptive && !(q.adjacent && q.turn != null))) continue;
      // 原话中间省略了一段（「cat with owner … operant conditioning」）：每一截都要找得到
      const pieces = q.quote.split(/…+|\.{3,}/).map(normText).filter((x) => x.length >= 2);
      if (!pieces.length) continue;
      const turnText = q.turn != null ? corpus.bySeq.get(q.turn) : null;
      if (pieces.every((x) => turnText?.includes(x) || corpus.all.includes(x) || refAll.includes(x))) continue;
      // 一字不差找不到：大体对得上（照抄时漏了几个字、换了标点）只算提醒里的轻的
      const close = containment(q.quote, corpus.all) >= 0.85;
      // 大体对得上（缩写了几个字、换了标点）只记一笔；找不到才是提醒
      add('evidence', close ? 'info' : 'warn', close ? 'quote-loose' : 'quote-miss', `${close ? '引的原话和记录里的不完全一样' : '引的原话在这节课的记录里找不到'}：「${cut(q.quote, 40)}」${q.turn != null ? `（#${q.turn}）` : ''}`);
    }
    const maxSeq = Math.max(0, ...corpus.bySeq.keys());
    const badTurns = [...new Set(turnRefs(text))].filter((n) => !corpus.bySeq.has(n));
    if (badTurns.length) add('evidence', 'warn', 'turn-missing', `指的轮次 ${badTurns.slice(0, 4).map((n) => `#${n}`).join('、')} 这节课里没有（一共 ${maxSeq} 轮）`);
    const badComps = compRefs(text).filter((c) => !corpus.comps.has(c));
    // 这节课里没有、别的课里有（下一节课记上一节的题）：说一声就行
    const elsewhere = badComps.filter((c) => ctx.allComps?.has(c));
    const nowhere = badComps.filter((c) => !ctx.allComps?.has(c));
    if (nowhere.length) add('evidence', 'warn', 'comp-missing', `指的板上编号 ${nowhere.slice(0, 4).join('、')} 哪节课里都没有`);
    if (elsewhere.length) add('evidence', 'info', 'comp-other', `指的板上编号 ${elsewhere.slice(0, 4).join('、')} 是别的课里的`);
  }
  // 错题的「我写的」要对得上它挂的作答（不是老师替学生编的）
  if (coll === 'errors' && doc.mine && list(doc.evidence).length) {
    const evs = list(doc.evidence).map((x) => get('evidence').find((e) => String(e.id) === String(x))).filter(Boolean);
    const said = evs.map((e) => [e.value, e.text, e.transcript, e.answer, e.say].filter(Boolean).join('\n')).join('\n');
    if (said && containment(doc.mine, said) < 0.5) add('evidence', 'warn', 'mine-mismatch', `「我写的」和挂的作答对不上：${cut(doc.mine, 40)}`);
  }

  // 4. 归属：课堂当场写的、我改过的，别人不能改它的话
  if (before) {
    const owner = authorOf(before);
    const changedText = normText(textOf(coll, before)) !== normText(textOf(coll, doc));
    if (changedText && (owner === 'me' || owner === 'class') && (author === 'lab' || author === 'page')) add('owner', 'fail', 'not-yours', `这条是${owner === 'me' ? '我自己改过的' : '课堂里当场写的'}，${author === 'lab' ? '事后写的' : '页面'}不能改它的话（要改挂「有疑问」）`);
  }
  if (author === 'lab' && session && !doc.backfill && ['observations', 'slips', 'errors'].includes(coll) && !before) add('owner', 'warn', 'backfill', '事后替这节课写的，要标 backfill');

  // 5. 一致：几乎一样的已经有了；和已有结论、证据矛盾
  if (!before && text && DEDUP.has(coll)) {
    const sp = doc.space || (doc.block ? spaceOfId(String(doc.block)) : '');
    const twin = get(coll).find((o) => String(o.id) !== String(id) && o.status !== 'void' && o.status !== 'merged' && (!sp || !o.space || o.space === sp) && similarity(textOf(coll, o), text) >= 0.6);
    if (twin) add('consistency', 'fail', 'duplicate', `和已有的 ${twin.id} 几乎一样`);
  }
  if (coll === 'weaknesses' && (doc.status === 'closed' || doc.level === 'L3')) {
    const blocks = list(doc.blocks).map(String);
    const since = doc.last || '';
    const bad = get('evidence').filter((e) => blocks.includes(String(e.block)) && lastOk(e) === false && (!since || toDay(e.at) > since));
    if (bad.length) add('consistency', 'warn', 'contradicts-evidence', `标成修好了，但 ${since || '之前'} 以后这几块还有 ${bad.length} 次做错`);
  }
  if (coll === 'reviews' && /^过/.test(String(doc.result || '')) && session) {
    const blocks = list(doc.blocks).map(String);
    const bad = get('evidence').filter((e) => e.session === session && blocks.includes(String(e.block)) && lastOk(e) === false);
    if (bad.length) add('consistency', 'warn', 'contradicts-evidence', `记了复现「过」，但这节课这几块有 ${bad.length} 次做错`);
  }
  // 提到学生用了「他」「她」：只提醒（发给 Claude 时 digest.js 会换成「学生」，原话不改）
  if (/[他她](?!们)/.test(text) && /学生|老师|课/.test(text)) add('consistency', 'info', 'pronoun', '提到学生写了「他 / 她」（发给 Claude 时会换成「学生」）');

  const fails = checks.filter((c) => c.level === 'fail');
  const warns = checks.filter((c) => c.level === 'warn'); // info 只记进审计，不影响收不收
  const verdict = fails.length ? 'reject' : warns.length ? (AUTHORS[author]?.strict ? 'hold' : 'flag') : 'accept';
  return { verdict, checks };
}

function list(v) { return Array.isArray(v) ? v : v == null || v === '' ? [] : [v]; }
function cut(s, n) { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}…` : s; }
function toDay(at) { const d = new Date(Number(at) || 0); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

/** 挂在那一条上的记号（挂提醒、暂存时）：哪几道看出了什么，不含 info */
export function guardMark(g, now = Date.now()) {
  return { v: GUARD_VERSION, at: now, verdict: g.verdict, checks: g.checks.filter((c) => c.level !== 'info').map(({ gate, code, msg }) => ({ gate, code, msg })) };
}

/** 给写的那个 Claude 看的原因（一行）：拒收、暂存时用 */
export function guardReason(g) {
  const main = g.checks.filter((c) => c.level === 'fail');
  const list = (main.length ? main : g.checks.filter((c) => c.level === 'warn')).map((c) => c.msg);
  return `守卫：${list.slice(0, 3).join('；')}`;
}

/** 审计日志的一条（guard_log/{id}）：谁写的、哪一条、结论、看出了什么、原来那一行 */
export function guardLog(g, { coll, id, session = null, author = 'class', line = '', closing = false, now = Date.now() } = {}) {
  const lid = `gl-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return { id: lid, doc: { at: now, coll, target: String(id), session, author, verdict: g.verdict, closing: !!closing, ...(line ? { line: String(line).slice(0, 400) } : {}), checks: g.checks.map(({ gate, level, code, msg }) => ({ gate, level, code, msg })) } };
}

/**
 * 守一份复盘（debrief.js 读出来的，首页后台事后写的：author lab）。每一条误解、节奏、习惯、建议、开场题各守一遍：
 * 对不上的挪进 held（下一节的记忆摘要、首页、备课都不用它，我在「以前的课」里能看见），挂提醒的照用、记在 guard 里。
 * 返回 { debrief（改好的，Claude 写的话不动）, held: 条数, flagged: 条数 }
 */
export function guardDebrief(debrief, { session, mem = {}, corpus = null, allComps = null, now = Date.now() } = {}) {
  if (!debrief) return { debrief, held: 0, flagged: 0 };
  const out = { ...debrief };
  const held = [];
  let flagged = 0;
  const one = (part, item, i) => {
    const doc = typeof item === 'string' ? { advice: item } : item;
    const g = guardCandidate({ coll: 'debrief', id: `${session}.${part}${i}`, doc, author: 'lab', session }, { mem, corpus, allComps });
    if (g.verdict === 'hold' || g.verdict === 'reject') { held.push({ part, item, guard: guardMark(g, now) }); return null; }
    if (g.verdict === 'flag') { flagged++; return typeof item === 'string' ? item : { ...item, guard: guardMark(g, now) }; }
    return item;
  };
  for (const part of ['mis', 'pace', 'habit', 'advice']) if (Array.isArray(out[part])) out[part] = out[part].map((x, i) => one(part, x, i)).filter((x) => x !== null);
  if (out.opening) { const o = one('opening', out.opening, 0); if (o === null) delete out.opening; else out.opening = o; }
  out.held = [...(Array.isArray(debrief.held) ? debrief.held : []), ...held];
  out.guard = { v: GUARD_VERSION, at: now, held: held.length, flagged };
  return { debrief: out, held: held.length, flagged };
}
