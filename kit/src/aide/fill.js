// 首页补学生卡（docs/superpowers/specs/2026-11-13-aide-design.md 5.1 第 3 条）：卡一开始全是空的，首页后台一块一块补，
// 补完为止；以后原始记录变了（新的错题、弱点又出现）卡就过时，也在这里重写。每晚的教研室按章做合并（memory/lab.js 的 card 单子）。
// 纯函数，有测试（tests/aide-fill.test.js）。调用在 aide/aidedesk.js。
import { spaceOfId } from '../memory/space.js';
import { cardParts, cardStale, parseCard, CARD_SECTIONS, CARD_MAX } from './card.js';
import { splitAfter } from './after.js';
import { crossId } from './schema.js';

export const CARD_HEAD = '你在给学生的学习台写一张学生卡';
const CROSS_MIN = 3; // 一科有这么多张块的卡以后才写跨块卡（太少看不出跨块的习惯）

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const cmpId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const isBlock = (d) => (d.level || (String(d.id).split('.').length === 3 ? 'block' : '')) === 'block' && d.status !== 'void';

/**
 * 要写（没有卡、有记录）或要重写（过时了）的块：下一节要用的（near）> 有错题或弱点的 > 别的，同一档按块编号；
 * 跨块卡在这一科有 CROSS_MIN 张卡以后、它比这一科最新的卡旧（或没有）时排在最后
 */
export function fillQueue(mem = {}, cards = [], { space = '', near = [] } = {}) {
  const have = new Map(list(cards).map((c) => [String(c.id), c]));
  const nearSet = new Set(list(near).map(String));
  const blocks = list(mem.curriculum).filter((d) => d?.id && isBlock(d) && spaceOfId(String(d.id)) === space).map((d) => String(d.id));
  const todo = [];
  for (const b of blocks) {
    const parts = cardParts(b, mem);
    if (!parts.length) continue; // 一条记录都没有的块：没东西可写
    const c = have.get(b);
    if (c && !cardStale(c, mem)) continue;
    const rank = nearSet.has(b) ? 0 : parts.some((p) => p.startsWith('e:') || p.startsWith('w:')) ? 1 : 2;
    todo.push({ b, rank });
  }
  const out = todo.sort((x, y) => x.rank - y.rank || cmpId(x.b, y.b)).map((x) => x.b);
  const mine = [...have.values()].filter((c) => c.block && spaceOfId(String(c.block)) === space);
  const cross = have.get(crossId(space));
  if (mine.length >= CROSS_MIN && (!cross || mine.some((c) => (c.at || 0) > (cross.at || 0)))) out.push(crossId(space));
  return out;
}

const rules = () => [
  `- 每行「段名｜内容（出处）」，段名只能是 ${CARD_SECTIONS.filter((x) => x !== '讲法').join(' / ')}（讲法由页面按证据算，你不写）。第一行一定是「概括｜」一句话（这一块学生现在的情况）。`,
  '- 出处写错题编号、弱点编号、课的编号 #轮（比如 c-20261102-1#12）；原话加「」，要在记忆或课的记录里一字不差找得到。出处对不上的那一行学习台直接删掉。',
  '- 同一个误解只写一句，后面列所有出处；原话只留最要紧的一两句；没有依据的不写；提到学生写「学生」。',
  `- 整张不超过 ${CARD_MAX} 字节（大约 600 个汉字）；有旧卡就整张重写得更准，不要在旧卡后面追加。`,
  '- 只输出卡的行，不要别的字。',
];

/** 补一张块的卡。raw：memoryDigest 以这一块开课时的那份全文（tools: false）；old：旧卡的字；exam：这一块的考情（可以空） */
export function cardPrompt({ block = '', title = '', scope = '', raw = '', old = '', exam = '' } = {}) {
  return [
    `${CARD_HEAD}：块 ${block}${title ? ` ${title}` : ''}。学生卡是给以后上这一块（和挨着的块）的老师看的：一张卡就知道学生在这一块懂了什么、怎么错的、说过什么、下次先测什么。`,
    scope ? `这一块的范围：${scope}` : '',
    '',
    '## 学习台记忆里和这一块有关的全部原文',
    raw || '（没有）',
    exam ? `\n## 这一块在考试里\n${exam}` : '',
    old ? `\n## 旧卡\n${old}` : '',
    '',
    '## 要求',
    ...rules(),
  ].filter((x) => x !== '').join('\n');
}

/** 跨块卡：这一科每张卡的「概括」那一行，找跨块的思维习惯、通用弱点 */
export function crossPrompt({ space = '', firsts = [], old = '', weaknesses = '' } = {}) {
  return [
    `${CARD_HEAD}：这一科（${space}）的跨块卡。下面是这一科每张学生卡的第一行（概括）。找出在好几块里都出现的思维习惯、通用的弱点（比如「题目给定下标从 0 仍按从 1 数」），每条写在哪几块出现过。`,
    '',
    '## 每张卡的概括',
    ...list(firsts).map((f) => `- ${f.id}：${f.line}`),
    weaknesses ? `\n## 这一科影响面是「通用」的弱点\n${weaknesses}` : '',
    old ? `\n## 旧的跨块卡\n${old}` : '',
    '',
    '## 要求',
    ...rules(),
  ].filter((x) => x !== '').join('\n');
}

/* ---------------- 每晚的教研室：按章合并学生卡（memory/lab.js 的 card 单子） ---------------- */

/** 块所在的章：块编号去掉最后两段（DS-L8.2.1 → DS-L8，L2.1.4 → L2） */
export const chapterOf = (block) => String(block || '').split('.')[0];
const CHAPTER_MIN = 3; // 一章有这么多张卡才值得合并（同一个误解常常散在几块里）

/**
 * 工作单里的「card」项：一章有 CHAPTER_MIN 张卡、而且有一张在这一章上次合并（卡上的 labAt）以后又写过。
 * key 是这一章每张卡的版本（at）拼起来：变了单子就重拼
 */
export function cardWork(cards = []) {
  const by = new Map();
  for (const c of list(cards)) if (c?.block) { const ch = chapterOf(c.block); if (!by.has(ch)) by.set(ch, []); by.get(ch).push(c); }
  const items = [];
  for (const [ch, cs] of by) {
    if (cs.length < CHAPTER_MIN) continue;
    const merged = Math.max(0, ...cs.map((c) => Number(c.labAt) || 0));
    if (!cs.some((c) => (Number(c.at) || 0) > merged)) continue;
    const space = spaceOfId(cs[0].block);
    items.push({ kind: 'card', space, ref: `${space}-${ch}`, title: `${ch} 的 ${cs.length} 张学生卡`, why: '这一章的卡上次合并以后又写过', value: 35, cost: '一次 Opus 5.5（读这一章的卡和原始记录，合并说同一件事的）', key: cs.map((c) => `${c.id}:${c.at || 0}`).sort().join(','), blocks: cs.map((c) => c.block).sort(cmpId) });
  }
  return items;
}

/** 教研室的单子：这一章每张卡 + 它引的原始记录（memoryDigest 以那一块开的全文，页面拼好），整章一起重写 */
export function cardBrief({ head = '', space = '', chapter = '', cards = [] } = {}) {
  return [
    head,
    '',
    `## 这一张单子：合并 ${chapter}（${space}）这一章的学生卡`,
    `学生卡是学习台给以后上课的老师看的：每块一张，一张卡就知道学生在这一块懂了什么、怎么错的。下面是这一章的 ${list(cards).length} 张卡和每块的原始记录。`,
    '要做的：同一个误解、同一个习惯散在好几张卡里的，留在最该在的那一块，别的卡写一句「见 某块」；写错的、过时的（后来做对了的）改掉；每张卡整张重写。',
    '',
    ...list(cards).flatMap((c) => [`### ${c.id} 现在的卡`, c.text || '（还没有）', `### ${c.id} 的原始记录`, c.raw || '（没有）', '']),
    '## 要求',
    ...rules(),
    '',
    '## 回答的格式',
    '每张要改的卡一节：一行 `## 卡 块编号`，下面是这张卡的行。没改的卡不写。',
  ].join('\n');
}

/** 读教研室的回答：{ cards: { 块: { lines, problems } }, problems }（只收单子里给了的卡） */
export function parseCardReply(text, { ids = new Set() } = {}) {
  const cards = {};
  const problems = [];
  for (const [id, t] of Object.entries(splitAfter(text).cards)) {
    if (!ids.has(id)) { problems.push(`单子里没有卡 ${id}，不收`); continue; }
    cards[id] = parseCard(t);
  }
  return { cards, problems };
}
