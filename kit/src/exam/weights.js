// 410 分的权重（docs/exam-plan.md 第五节）：一部分的分照旧按大纲分到这一部分、再按课程地图分到章；章里的块不再平分，
// 按真题的期望分值（statsCache 的 blockPerYear：平均每年几分）：份额 = 0.3 × (1 / 块数) + 0.7 × (这一块的期望分 / 这一章所有块的期望分之和)。
// 两项都是比例、加起来是 1；没考过的块至少拿到平均那份的三成；这一章一块都没考过（或还没有真题入库）照旧平分。
// 纯函数，有测试（tests/exam-weights.test.js）。

/** { 块: 份额 }，加起来是 1 */
export function blockWeights({ blocks = [], expected = {} } = {}) {
  const n = blocks.length;
  if (!n) return {};
  const e = blocks.map((b) => Math.max(0, Number(expected?.[b]) || 0));
  const sum = e.reduce((s, x) => s + x, 0);
  return Object.fromEntries(blocks.map((b, i) => [b, sum > 0 ? 0.3 / n + (0.7 * e[i]) / sum : 1 / n]));
}
