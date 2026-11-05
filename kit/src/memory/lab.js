// 云端教研室（docs/lab-plan.md）里不碰 DOM、不碰数据库的部分，有测试（tests/memory-lab.test.js）。
//
// 分工：学习台（页面）按工作单 meta/workorder 把要做的活写成**工作单子** lab_brief/{编号}——每一张自带完整的说明和材料
// （这节课的记录、报告、记忆、组件写法、教材），云端的教研室不用懂学习台的代码、不用有仓库，读一张写一份回答
// lab_inbox/{随便的编号} 就行。页面看到回答，用和课堂同一套的读法（parseOutput、parseMemoLines、parsePrep）读懂，
// 写进去之前照样过守卫（author: 'lab'，对不上的暂存），读的结果写回执 lab_inbox_log/{同一个编号}，教研室下次先看回执。
//
// 为什么材料由页面拼：拼提示词的函数（transcriptText、reportText、memoryDigest、prepPrompt、closingPrompt）都在学习台里，
// 云端再写一份就会和课堂、首页的不一样；页面拼好，教研室看到的和课堂里的 Claude 看到的是同一份东西。
// 只拼工作单里最要紧的几张（LAB_CAPS），每张有指纹（key），材料变了才重拼，平时打开首页什么都不写。
import { fencesOf, withId } from './drills.js';
import { similarity, slipsToFold } from './memo.js';
import { spaceOfId, subjectOf } from './space.js';
import { memoryDigest } from './digest.js';
import { transcriptText } from './debrief.js';
import { reportText } from './report.js';
import { closingPrompt, MEMO_DOC } from '../class/prompt.js';
import { componentDoc } from '../subject.js';

export const LAB_VERSION = 2; // 单子的写法变了就加一：学习台打开时照新写法重拼（收件箱先按旧单子收完）
// 一晚最多做几张（价值高的先）：补收尾的课最值，出新题其次，备课一科一张
export const LAB_CAPS = { backfill: 2, newproblems: 3, probe: 2, prep: 3 };
export const BRIEF_MAX = 600 * 1024; // 一张工作单子最多多大（数据库一条文档放得下；备课带的教材最大）
const PROBLEMS_N = 3;

const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const enc = new TextEncoder();
export const bytesOf = (s) => enc.encode(String(s ?? '')).length;

/** 工作单子的编号：kind-ref（ref 里的斜杠、逗号换掉） */
export const briefId = (item) => `${item.kind}-${String(item.ref)}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);

// 一个字符串的短指纹（FNV-1a）：材料变了才重拼、教研室的回答对不上新的材料就作废
export function hashOf(s) {
  let h = 0x811c9dc5;
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/**
 * 工作单里哪几项要拼成单子：只做教研室能做的三种（补收尾、出新题、备课；好久没测的弱点也是出新题），
 * 每种最多 LAB_CAPS 张，价值高的先（工作单本来就按价值排好了）
 */
export function labPicks(items = []) {
  const n = {};
  const out = [];
  for (const it of items || []) {
    if (!it || !(it.kind in LAB_CAPS)) continue;
    n[it.kind] = (n[it.kind] || 0) + 1;
    if (n[it.kind] <= LAB_CAPS[it.kind]) out.push(it);
  }
  return out;
}

/* ---------------- 单子里共用的话 ---------------- */

const HEAD = `你是学习台的教研室：课外、事后替学生的学习台做活的 Claude。学生在 iPad 上的学习台里由「课堂里的 Claude」上课；你不上课，只把课后该补的补上。
你写的东西学习台会照原样存进学生的记忆库（一个字都不改），所以每一句都要有这节课记录里的依据；写之前学习台的守卫会逐字核你引的原话、轮次、板上编号、证据编号，对不上的先暂存、不进学生的记忆。
提到学生时写「学生」，不用「他」「她」。不要客套，不要解释你在做什么，只按最后「回答的格式」写。`;

const TOOLS_NOTE = '你所在的环境有命令行（Python、Node 都能用）：题目的每一个答案、每一个数，写之前都自己算一遍核对，算不出来的题不出。';

/* ---------------- 补收尾：没写小结的课 ---------------- */

/**
 * 一节没收尾的课（下课时没写成小结、或者挂着没下课）：事后照这节课的完整记录写小结和整理单。
 * closing：classroom.js 下课时用的那份 closingPrompt（页面拼好传进来，和课堂里的一字不差）；
 * transcript：debrief.js 的 transcriptText；memory：digest.js 的 memoryDigest 的文字
 */
export function backfillBrief({ session = {}, transcript = '', memory = '', closing = '' } = {}) {
  return `${HEAD}

## 这一张：补写一节课的小结和整理单

这节课（${session.id}，${session.date || ''}，${session.title || session.block || ''}）${session.status === 'closed' ? '学生直接下了课' : '挂着没下课，已经好几个小时没有动静'}，课堂里的 Claude 没来得及写小结和整理单。下面是这节课的完整记录（每一轮学生做了什么、说了什么，老师写了什么）和学生的记忆。你照下课时课堂里的 Claude 会做的那样写。

和课堂里不一样的几条（守卫按这几条查）：
- 你是事后写的：页面会在你新加的错题、观察、失误上标「事后补写」，你不用写；
- 引学生的原话要一字不差地从下面的记录里抄（带上第几轮，比如「#43 学生说「……」」）；记录里没有的话不要写成引号里的原话；
- 课堂里的 Claude 已经记过的（下面记忆里有的）不再记；以前的错题、弱点的话不要改写（要改只能改状态，或者写 \`doubt=\` 说明理由）；
- basis= 写下面报告里的组件 id 或证据 id；
- 这节课没讲完、没有证据的就不写，宁可少写。

### 学生的记忆（课堂里的 Claude 上课时带着的同一份）

${memory || '（没有）'}

### 这节课的记录

${transcript || '（没有存下每一轮）'}

### memo 块的写法（课堂里的 Claude 上课时带着的同一份；「上课时」「这一轮」的话按事后补写理解）

${MEMO_DOC}

### 下课时课堂里的 Claude 收到的要求（照着写）

${closing}

## 回答的格式

先写小结正文（四点），再写一个 \`\`\`\`board memo\`\`\`\` 块当整理单（四个反引号，和课堂里一样）。不要写别的。`;
}

/** 读补收尾的回答：小结正文 + memo 块的条目。parseOutput、parseMemoLines 由调用的地方传（protocol.js 依赖 DOM 无关，但避免循环引用） */
export function parseBackfill(text, { parseOutput }) {
  const out = parseOutput(String(text ?? ''), { final: true });
  const memos = out.ops.filter((o) => o.op === 'memo');
  const summary = out.segments.filter((x) => x.type === 'speech').map((x) => x.text).join('\n\n').trim();
  const problems = [];
  if (summary.length < 40) problems.push('小结太短（或者没写）');
  if (!memos.length) problems.push('没有整理单（memo 块）');
  const entries = memos.flatMap((o) => o.entries || []);
  const errors = memos.flatMap((o) => o.errors || []).concat(out.rejected.map((r) => r.error));
  return { summary, entries, errors, problems };
}

/* ---------------- 出新题：复现组、好久没测的弱点 ---------------- */

/**
 * target：{ kind: 'review' | 'weakness', id, title, blocks, content?, level? }；originals：题库里这几块的原题（drills，带 md）；
 * errors：挂着的错题（原文）；docs：要用到的组件的完整写法（页面按原题用的组件 + 常用的取好）；blockInfo：课程地图里这几块的标题和范围
 */
export function problemsBrief({ target = {}, originals = [], errors = [], docs = '', blockInfo = '', memory = '', subject = '', n = PROBLEMS_N } = {}) {
  const what = target.kind === 'review'
    ? `复现组「${target.title}」到期了，可题库里只有课上的原题（原题做对不算复现通过：学生记得答案，不等于会做）。要 ${n} 道**新题**：同一个机制、换数换情境，学生没见过。`
    : `弱点「${target.title}」（${target.level || ''}）好久没测了。要 ${n} 道**探题**：能直接看出这个毛病还在不在（会的人一次做对，有这个毛病的人会掉进去）。`;
  const math = !/英语/.test(subject);
  const weakLine = target.weaknesses?.length ? `\n这一组挂着的弱点：${target.weaknesses.join('；')}。题要能看出这几个毛病还在不在。\n` : '';
  return `${HEAD}

## 这一张：出 ${n} 道新题

${what}
${weakLine}
要求：
- 每道题是学习台的一个组件（下面有写法），页面自己判分，所以一定要用页面判得了分的写法（answer、practice、quiz、steps，或者演示组件当练习题 \`practice use:\`）；
${math ? `- 答案不要手写数字：用 \`let\` 定义数，答案写成用它们算的式子（\`answer: A*x\`、\`\\calc{…}\`），或组件自己算的（practice 的 \`type: custom\` 模板、\`use:\` 演示组件），页面会把答案再算一遍；${TOOLS_NOTE}\n` : `- ${TOOLS_NOTE.replace('题目的每一个答案、每一个数', '每道题的答案')}\n`}- 和下面的原题不能一样（换数、换句子、换情境），也不要三道一个样；从易到难；
- 每道题前面写一行「针对：……」说清它在测什么（给学生做完以后看）；
- 题面里不要写答案，不要写「这道题考……」。

### 这几块讲的是什么

${blockInfo || '（课程地图里没写）'}

### 挂着的错题（学生真错过的，题要冲着它出）

${errors.length ? errors.map((e) => `- ${e.id}：${cut(e.q || '', 160)}　学生写的：${cut(e.mine || '', 120)}　原因：${cut(e.cause || '', 160)}`).join('\n') : '（没有）'}

### 题库里的原题（不要照抄）

${originals.length ? originals.slice(0, 4).map((d) => `#### ${d.id}\n\n${String(d.md || '').slice(0, 4000)}`).join('\n\n') : '（没有）'}

### 学生的记忆（节选）

${memory || '（没有）'}

### 组件的写法

${docs}

## 回答的格式

每道题一段，段头一行 \`=== 题 1\`、\`=== 题 2\`……；段里先一行 \`针对：……\`，再写组件（要用到的 \`let\` 块写在同一段里、组件前面）。组件的 \`id:\` 随便写，页面会换成题库编号。不要写别的。`;
}

/**
 * 读出新题的回答：[{ n, why, md, kind, fences }]；problems：整体的问题。
 * 每道题的组件编号换成题库编号 d-lab-{单子}-{第几题}（再出一次同一张单子会盖掉同一个编号，不会越堆越多）
 */
export function parseProblems(text, { brief = '', block = null, target = {}, at = Date.now() } = {}) {
  const parts = String(text ?? '').replace(/\r\n?/g, '\n').split(/^===\s*题\s*(\d+)\s*$/m);
  const out = [];
  const problems = [];
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    const body = parts[i + 1] || '';
    const why = body.match(/^\s*针对\s*[:：]\s*(.+)$/m)?.[1]?.trim() || '';
    const fences = fencesOf(body);
    const lets = fences.filter((f) => f.lang === 'let');
    const main = fences.filter((f) => f.lang !== 'let');
    if (!main.length) { problems.push(`题 ${n}：没有组件`); continue; }
    if (main.length > 1) problems.push(`题 ${n}：一段里有 ${main.length} 个组件，只收第一个`);
    const id = `d-lab-${brief}-${n}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
    const md = [...lets.map((f) => f.raw), withId(main[0], id)].join('\n\n');
    const sp = block ? spaceOfId(String(block)) : '';
    out.push({
      id, n, why, kind: main[0].lang,
      doc: {
        block, kind: main[0].lang, md, q: cut(why, 160), title: cut(target.title || '', 80), src: 'lab', by: 'lab',
        ...(target.kind === 'review' ? { review: String(target.id) } : target.kind === 'weakness' ? { weakness: String(target.id) } : {}),
        ...(sp ? { space: sp } : {}), status: 'active', at,
      },
    });
  }
  if (!out.length && !problems.length) problems.push('回的不是题（没有「=== 题 1」这样的段）');
  return { items: out, problems };
}

// 页面核题之前先看的（不碰 DOM）：数学、408 的 answer 手写了数字却没有 let / \calc，页面没法再算一遍，不收
const COMPUTED = /\\calc\{|^\s*```+\s*let\b|^\s*let\s+\w+\s*=|type\s*:\s*custom|^\s*use\s*:/m;
export function problemLint(item, { subject = '' } = {}) {
  const md = String(item?.doc?.md || '');
  const errs = [];
  if (bytesOf(md) > 12 * 1024) errs.push('太长了（一道题不超过 12 KB）');
  if (!/英语/.test(subject) && item.kind === 'answer' && /^\s*answer\s*[:：]\s*[-\d.\s/,;()[\]]+$/m.test(md) && !COMPUTED.test(md)) errs.push('答案是手写的数字，页面没法再算一遍：用 let 块和 \\calc 写');
  return errs;
}

/** 和题库里已有的几乎一样（照抄原题、两道新题一个样）：不收 */
export function twinOf(item, drills = []) {
  const body = (md) => String(md || '').replace(/^\s*id\s*[:：].*$/gm, '');
  const mine = body(item?.doc?.md);
  return (drills || []).find((d) => d && d.id !== item.id && d.status !== 'void' && similarity(body(d.md), mine) >= 0.9) || null;
}

/* ---------------- 备课 ---------------- */

/** 备课：prompt 就是学习台首页「让 Claude 备课」发的那一份（planview.js 的 prepInput 拼的），前后加几句教研室的话 */
export function prepBrief({ prompt = '', block = '', title = '' } = {}) {
  return `${HEAD}

## 这一张：给下一节课备课（${title || block}）

学生下一节要上这一块，还没有备好的教案。下面是学习台首页「让 Claude 备课」时发的完整要求和材料，照着写；你有充分的时间，把教材原文读细、把每道题自己做一遍（${TOOLS_NOTE.slice(TOOLS_NOTE.indexOf('：') + 1)}）。

## 要求和材料

${prompt}

## 回答的格式

照上面要求里写的格式回答，不要写别的。`;
}

/* ---------------- 拼材料（学习台和 tools/lab.mjs 共用） ---------------- */

/** 单子材料的指纹：没变就不重拼；变了教研室照旧的回答作废。mem：记忆库；packs：{ 科: { main } } */
export function srcOf(item, mem = {}, packs = {}) {
  const find = (c, id) => (mem[c] || []).find((x) => String(x.id) === String(id)) || {};
  if (item.kind === 'backfill') { const s = find('sessions', item.ref); return [s.id, s.status, s.endedAt, s.report?.items, s.report?.activeMs].join('|'); }
  if (item.kind === 'newproblems') { const r = find('reviews', item.ref); return [r.id, r.last, r.tier, list(r.blocks).join(','), list(r.errors).join(',')].join('|'); }
  if (item.kind === 'probe') { const w = find('weaknesses', item.ref); return [w.id, w.level, w.status, list(w.blocks).join(','), list(w.errors).join(',')].join('|'); }
  if (item.kind === 'prep') { const p = (mem.position || []).find((x) => String(x.block) === String(item.ref)) || {}; return [item.ref, p.next, item.space, packs[item.space]?.main?.at || ''].join('|'); }
  return '';
}

/** 补收尾的单子：session 带 id；turns：这节课的 class_turns；rep：课后报告（没有就 null）。什么记录都没有时返回 null */
export function backfillMaterial(mem, s, { turns = [], rep = null } = {}) {
  if (!s || (!turns.length && !rep)) return null;
  const sp = s.space || spaceOfId(String(s.block || ''));
  const memory = memoryDigest(mem, { block: s.block || '', space: sp, session: s.id, tools: false, budget: 24 * 1024 }).text;
  const closing = closingPrompt({ report: rep ? reportText(rep) : '（这节课没有算出课后报告：整理单按记录写，basis 写组件 id。）', review: s.review, opening: s.opening, slips: slipsToFold(mem, sp) });
  return { prompt: backfillBrief({ session: s, transcript: transcriptText(turns), memory, closing }), ctx: { session: s.id, block: s.block || null, space: sp } };
}

/** 出新题 / 探题的单子：item 是工作单的一项（newproblems：复现组；probe：弱点）；docs：组件说明的全文（COMPONENT_DOCS） */
export function problemsMaterial(mem, item, { docs = '' } = {}) {
  const isReview = item.kind === 'newproblems';
  const t = (mem[isReview ? 'reviews' : 'weaknesses'] || []).find((x) => String(x.id) === String(item.ref));
  if (!t) return null;
  const blocks = list(t.blocks).map(String);
  if (!blocks.length) return null;
  const subject = subjectOf(blocks[0]);
  const originals = (mem.drills || []).filter((d) => d && d.status !== 'void' && blocks.includes(String(d.block || '')));
  // 冲着真错过的出：挂在它上面的错题；复现组还看它挂的弱点上的错题；都没有时用这几块里没解决的
  const weak = isReview ? list(t.weaknesses).map((id) => (mem.weaknesses || []).find((w) => String(w.id) === String(id))).filter(Boolean) : [t];
  const errIds = new Set([...list(t.errors), ...weak.flatMap((w) => list(w.errors))].map(String));
  const live = (mem.errors || []).filter((e) => e && !e.corrects && e.status !== 'void');
  let errors = live.filter((e) => errIds.has(String(e.id)));
  if (!errors.length) errors = live.filter((e) => blocks.includes(String(e.block || '')) && !e.resolved);
  errors = errors.slice(-6);
  // 组件写法：原题用的组件 + 出题常用的几个，取完整写法（课堂里按需取的那份）
  const names = [...new Set([...originals.map((d) => d.kind), 'answer', 'practice', 'quiz', 'steps'].filter(Boolean))].slice(0, 7);
  const docText = names.map((n) => { const d = componentDoc(docs, n, subject); return d ? `#### ${n}\n\n${d}` : ''; }).filter(Boolean).join('\n\n');
  const blockInfo = blocks.map((b) => { const c = (mem.curriculum || []).find((x) => x.id === b); return c ? `- ${b} ${c.title || ''}${c.scope ? `：${String(c.scope).slice(0, 400)}` : ''}` : `- ${b}`; }).join('\n');
  // 记忆只要讲给学生的那几节（关于学生、学到哪、掌握）：开头叫课堂 Claude 写 memo 的话、最后的目录对出题没用
  const full = memoryDigest(mem, { block: blocks[0], space: spaceOfId(blocks[0]), tools: false, budget: 10 * 1024 }).text;
  const memory = full.slice(Math.max(0, full.indexOf('## ')), full.includes('\n## 目录') ? full.indexOf('\n## 目录') : undefined).trim();
  const target = { kind: isReview ? 'review' : 'weakness', id: String(t.id), title: t.title || String(t.id), blocks, level: t.level, weaknesses: weak.filter((w) => w !== t).map((w) => `${w.id} ${w.title || ''}`) };
  return { prompt: problemsBrief({ target, originals, errors, docs: docText, blockInfo, memory, subject }), ctx: { target, block: blocks[0], subject } };
}

/** 一张单子写进 lab_brief 的样子 */
export function briefDoc(item, got, src, now = Date.now()) {
  return { kind: item.kind, ref: String(item.ref), space: item.space || '', title: String(item.title || '').slice(0, 120), why: String(item.why || '').slice(0, 200), value: item.value || 0, prompt: got.prompt, ctx: got.ctx, src, key: hashOf(`${src}|${LAB_VERSION}`), v: LAB_VERSION, at: now };
}

/* ---------------- 收件箱 ---------------- */

/**
 * 一份回答要不要收、对得上哪张单子。inbox：lab_inbox 的一条；brief：lab_brief 里同编号的那张（没有就是 null）。
 * 返回 { ok, why }：单子已经没了（活做完了、过时了）、指纹对不上（材料变了）都不收
 */
export function checkReply(inbox = {}, brief = null) {
  if (!inbox.brief) return { ok: false, why: '回答里没写是哪一张单子（brief）' };
  if (!brief) return { ok: false, why: `单子 ${inbox.brief} 已经没了（这件事做完了，或者不用做了）` };
  if (inbox.key && brief.key && inbox.key !== brief.key) return { ok: false, why: '这张单子的材料变了（学生又上了课、或者已经有人做了），按新的单子重做' };
  if (typeof inbox.text !== 'string' || inbox.text.trim().length < 20) return { ok: false, why: '回答是空的' };
  return { ok: true, why: '' };
}

/** 回执：给教研室下次看（收了几条、哪几条没收和原因） */
export function receipt({ inbox = {}, brief = null, result = 'ok', took = {}, rejected = [], held = 0, notes = [], now = Date.now() } = {}) {
  return {
    brief: String(inbox.brief || ''), kind: brief?.kind || inbox.kind || '', ref: brief?.ref || '', result,
    took, held, rejected: list(rejected).slice(0, 20).map((r) => ({ line: cut(r.line || r.n || '', 160), error: cut(r.error || r, 300) })),
    notes: list(notes).slice(0, 10).map((x) => cut(x, 300)), at: now, v: LAB_VERSION,
  };
}

/** 回执一行给我看（管理页「后方」） */
export function receiptLine(r = {}) {
  const k = { backfill: '补收尾', newproblems: '出新题', probe: '探题', prep: '备课' }[r.kind] || r.kind || '';
  const took = Object.entries(r.took || {}).filter(([, v]) => v).map(([c, v]) => `${{ summary: '小结', memo: '整理单', drills: '题', pack: '教案' }[c] || c} ${v}`).join('、');
  const bad = r.result === 'stale' || r.result === 'error' ? `没收：${r.notes?.[0] || ''}` : '';
  return `${k}　${took || ''}${r.held ? `　暂存 ${r.held}` : ''}${r.rejected?.length ? `　没收 ${r.rejected.length}` : ''}${bad ? `　${bad}` : ''}`.trim();
}
