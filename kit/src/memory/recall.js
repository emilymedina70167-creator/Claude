// 记忆点（docs/review-plan.md）里不碰 DOM 的部分，有测试（tests/memory-recall.test.js）。
//
// 为什么：复现组管的是「会不会做」（方法、机制），一组好几个点，隔几天出一道新题测；可有些东西是要**背**的——
// 定义原文、哪种排序稳定、复杂度、表里的一格、系动词有哪些——要一条一条地隔几天想一遍，想不起来就从头隔。
// 原来没有地方单独记这种东西，复现组按组排期太粗，「练一练」又是原题（按我的规则不算复现）。
//
// - 一条记忆点：问法 q、标准答案 a、挂哪一块 block、档位 tier（1 → 3 → 7 → 14 → 30 天，和复现组同一套）、上次 last、
//   没想起几次 lapses。课堂里的 Claude 用 memo 的 recall 写（默写没写出的、讲过要背的），我也能自己加。
// - 每天想一遍：首页「要记的」，各科到期的混在一起，一次最多 RECALL_N 条；先自己写出来，再看答案，自己点
//   想起来了（升一档；30 天那档也想起来了就算记牢了，不再排）/ 模糊（档位不动，隔同样的天数再来）/ 没想起（回到 1 天）。
//   页面不调用 Claude；每一次记一条证据（src: recall，带写的什么），掌握不看它（掌握按做题算）。
import { REVIEW_TIERS, nextTier, toDate, addDays, daysBetween, isDate } from './schema.js';
import { spaceOfId, SPACES } from './space.js';

export const RECALL_N = 20; // 一次最多想几条（到期的多了排到明天，不一下子压过来）
export const RECALL_CAP = 300; // 一科还在排的最多几条（再多是记得太碎了：并掉、停掉一些）
export const RATINGS = {
  got: { label: '想起来了', hint: '写出来的和答案意思一样' },
  vague: { label: '模糊', hint: '想起一部分、或者想了很久' },
  miss: { label: '没想起', hint: '写不出、或者写错了' },
};

const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const LIVE = new Set(['active', undefined, null, '']);
export const isLive = (d) => !!d && LIVE.has(d.status);

/** 一条记忆点是哪一科：写了 space 用它，不然按挂的块（没挂块的算数学） */
export const recallSpace = (d) => (SPACES[d?.space] ? d.space : spaceOfId(d?.block || ''));

/** 什么时候到期：last + tier 天；还没想过（没有 last）就是今天 */
export function recallDue(d, today = toDate(Date.now())) {
  const tier = REVIEW_TIERS.includes(Number(d?.tier)) ? Number(d.tier) : REVIEW_TIERS[0];
  const due = d?.last && isDate(d.last) ? addDays(d.last, tier) : today;
  return { due, days: daysBetween(today, due) };
}

/**
 * 今天要想一遍的：到期的（过期的、今天的），没想起过几次的、过期久的在前，挨着的尽量不同块。
 * 返回 { items: [记忆点], total（到期一共几条）, bySpace: { math: n, … }, next（下一条什么时候到期，没有到期的时候用）}
 */
export function recallToday(list = [], { today = toDate(Date.now()), n = RECALL_N } = {}) {
  const live = (list || []).filter(isLive).map((d) => ({ d, ...recallDue(d, today) }));
  const due = live.filter((x) => x.days <= 0).sort((a, b) => (Number(b.d.lapses) || 0) - (Number(a.d.lapses) || 0) || a.days - b.days || String(a.d.id).localeCompare(String(b.d.id), undefined, { numeric: true }));
  const bySpace = {};
  for (const x of due) { const k = recallSpace(x.d); bySpace[k] = (bySpace[k] || 0) + 1; }
  const later = live.filter((x) => x.days > 0).sort((a, b) => a.days - b.days)[0];
  return { items: spread(due.slice(0, n).map((x) => x.d)), total: due.length, bySpace, next: later ? later.due : null };
}

// 挨着的两条尽量不同块（同一块的连着想，后一条常常被前一条提醒了）
function spread(items) {
  const left = [...items];
  const out = [];
  while (left.length) {
    const prev = out.at(-1)?.block;
    const i = left.findIndex((x) => !prev || x.block !== prev);
    out.push(left.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

/**
 * 我点了一个结果 → 这一条要改成什么（patch），和一句话（写进 log 的 note、给我看的）。
 * got：升一档（30 天那档再想起来：记牢了，status: done）；vague：档位不动；miss：回 1 天、lapses + 1
 */
export function rateRecall(d, rating, { today = toDate(Date.now()) } = {}) {
  if (!RATINGS[rating]) throw new Error(`结果只能是 ${Object.keys(RATINGS).join(' / ')}`);
  const tier = REVIEW_TIERS.includes(Number(d?.tier)) ? Number(d.tier) : REVIEW_TIERS[0];
  const top = REVIEW_TIERS.at(-1);
  if (rating === 'got') {
    if (tier === top && d?.last) return { patch: { last: today, result: 'got', status: 'done' }, note: `想起来了：隔 ${top} 天还记得，算记牢了` };
    const t = nextTier(tier, true);
    return { patch: { tier: t, last: today, result: 'got' }, note: `想起来了：下次 ${t} 天后` };
  }
  if (rating === 'vague') return { patch: { tier, last: today, result: 'vague' }, note: `模糊：还是 ${tier} 天后再想一遍` };
  return { patch: { tier: REVIEW_TIERS[0], last: today, result: 'miss', lapses: (Number(d?.lapses) || 0) + 1 }, note: '没想起：明天再来' };
}

/** 写的和答案像不像（只是给我看的提示，不替我判）：去掉标点空白后一样就算「写得和答案一样」 */
export function sameText(typed, answer) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/\$/g, '').replace(/[\s\p{P}\p{S}]+/gu, '');
  const a = norm(typed), b = norm(answer);
  return !!a && a === b;
}

/** 首页「要记的」那一行：各科几条（数学 5、408 3） */
export const spaceCounts = (bySpace = {}) => Object.keys(SPACES).filter((k) => bySpace[k]).map((k) => `${SPACES[k].label} ${bySpace[k]}`).join('、');

/** 给课堂 Claude 的一行（记忆摘要「要记的」那一节）：编号、问法 → 答案、没想起几次 */
export const recallLine = (d, today = toDate(Date.now())) => {
  const due = recallDue(d, today);
  return `- ${d.id} ${cut(d.q, 80)} → ${cut(d.a, 80)}（${d.result ? `第 ${d.tier || 1} 天那档${due.days <= 0 ? '，到期了' : ''}` : '还没想过'}${Number(d.lapses) ? `，没想起过 ${d.lapses} 次` : ''}）`;
};

export const nextRecallId = (list) => `K${Math.max(0, ...(list || []).map((d) => Number(/^K(\d+)$/.exec(String(d.id))?.[1]) || 0)) + 1}`;

/** 一次想一遍的证据（src: recall）：只记想的是哪一条、写了什么、结果；不进掌握 */
export function recallEvidence(d, { typed = '', rating, at = Date.now() } = {}) {
  return {
    id: `ev-${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: 'recall', src: 'recall', at, comp: String(d.id), q: cut(d.q, 200), text: cut(typed, 600), rating,
    ...(d.block ? { block: String(d.block) } : {}),
  };
}
