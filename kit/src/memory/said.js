// 话的账（第十一轮，docs/superpowers/specs/2026-11-14-round11-design.md 6.2）：我在课上打的每一句话都有去处——
// 记成「我的要求」（asks）的哪一条、关于我、只管这一节、或者不用记和为什么。理解交给 Claude，兜底交给这里的代码：
// 每句都要有去处、引的编号要真有、原话由页面从证据抄。纯函数，有测试（tests/memory-said.test.js、tests/memory-asks.test.js）。

/** 下一个要求的编号：A-1、A-2…（接着已有的最大号，作废了的也占号） */
export function nextAskId(asks = []) {
  const n = Math.max(0, ...asks.map((a) => Number(String(a?.id || '').match(/^A-(\d+)$/)?.[1] || 0)));
  return `A-${n + 1}`;
}
