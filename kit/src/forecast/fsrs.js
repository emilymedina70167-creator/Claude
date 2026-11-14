// 记得住多少 R：间隔重复里公开的记忆模型 FSRS-5（spec 6.2）。参数和公式照 ts-fsrs 4.7.1 的公开算法和默认参数
// （在大量真实复习记录上训练出来的），不自己编；只用按天的复习（不开短期）。
// 一块当一张卡：隔了至少一天以后第一次碰到这一块的那道题算一次复习，做对是 Good、失手是 Again。纯函数。
import { BLOCK_S_X } from './priors.js';
// 日期 → 第几天（UTC），记住：首页一次算几万次天数差，每次 Date.parse 两个字符串太慢
const DAYS = new Map();
function dayNum(d) {
  let n = DAYS.get(d);
  if (n === undefined) { n = Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000); DAYS.set(d, n); }
  return n;
}
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);

/** ts-fsrs 4.7.1 的 default_w（FSRS-5，19 个） */
export const W = Object.freeze([0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621]);
const DECAY = -0.5;
const FACTOR = 19 / 81; // 让 t = S 时 R 正好是 0.9
const AGAIN = 1, GOOD = 3, EASY = 4;
const clampD = (d) => Math.min(10, Math.max(1, d));

/** 隔 days 天、稳定度 S 时还记得的概率；负的天数当 0 */
export function retrievability(days, S) {
  const t = Math.max(0, Number(days) || 0);
  return Math.pow(1 + (FACTOR * t) / S, DECAY);
}

const d0 = (g) => W[4] - Math.exp(W[5] * (g - 1)) + 1;

/** 第一次学：ok → Good，否则 Again */
export function firstState(ok) {
  const g = ok ? GOOD : AGAIN;
  return { S: W[g - 1], D: clampD(d0(g)) };
}

/** 隔 days 天复习一次 */
export function review(state, ok, days) {
  const { S, D } = state;
  const g = ok ? GOOD : AGAIN;
  const R = retrievability(days, S);
  // 难度：往中间拉一点（FSRS-5 的线性阻尼 + 均值回归）
  const dd = D - W[6] * (g - 3) * ((10 - D) / 9);
  const nextD = clampD(W[7] * d0(EASY) + (1 - W[7]) * dd);
  const nextS = ok
    ? S * (Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) + 1)
    : Math.min(S, W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R)));
  return { S: nextS, D: nextD };
}

/** 一串按天的复习 [{ day, ok }] 走一遍；没有就是 null（从没在学习台学过） */
export function memoryOf(reviews = []) {
  const rs = [...reviews].filter((r) => r && r.day).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  let m = null;
  for (const r of rs) m = step(m, r);
  return m;
}

/** 在已有的记忆上再走一次复习（null 是第一次学）：一块的作答按时间排好时，一路往下走，不用每次从头算 */
export function step(m, r) {
  if (!m) return { ...firstState(!!r.ok), last: r.day };
  return { ...review(m, !!r.ok, daysBetween(m.last, r.day)), last: r.day };
}

/** 到 day 那天还记得几成；mem 为 null 返回 1（遗忘已经含在底子的先验里）。x 只乘在算 R 用的 S 上 */
export function rOn(mem, day, { x = BLOCK_S_X } = {}) {
  if (!mem) return 1;
  return retrievability(daysBetween(mem.last, day), mem.S * x);
}
