// 抢跑（docs/smart-plan.md 第 1 批）：学生多半会说的下一句，在学生还在看板的时候先发给课堂 Claude。
// 学生真说了、而且这一刻要发的整份内容（说明、黑板现状、记忆、对话）和抢跑发的一字不差，就直接用抢跑的结果；
// 差一点就丢掉、照常调用。回的话仍然是老师对着这一刻写的，不是预制——只是提前开工。丢掉的那次多花额度（usage.js 记成 spec）。
// 纯函数，有测试（tests/class-spec.test.js）；调用和接上在 classroom.js。

export const SPEC_SAY = { start: '开始上课。', next: '继续。' };
// 一轮讲完以后等一会儿再抢跑：这一轮的记忆（memo）写回来、版面量好、后台摘要写完，内容才稳（不稳就白跑一次）
export const SPEC_DELAY = 2500;

/**
 * 现在该不该抢跑、抢哪一句：'开始上课。' | '继续。' | null。
 * s：{ on, available, busy, ended, started, liveTurns（没作废的记录条数）, pending（还有等老师回的那一条）, queued（排着没发的话 / 动作 / 图）,
 *      drafts（板上没交的草稿）, ink（没发的板书）, waiting（当前板上还没做的题）, beatsLeft（这一轮还有没播的拍子）, away（在看旧板）, compacting }
 */
export function specFor(s = {}) {
  if (!s.on || !s.available || s.busy || s.ended || s.compacting) return null;
  if (s.queued || s.drafts || s.ink) return null;
  if (!s.started) return s.liveTurns ? null : SPEC_SAY.start;
  // 学生还有题要做、拍子没播完（「继续」只走下一拍，不调用）、在翻旧板：多半不会马上点继续
  if (s.pending || s.waiting || s.beatsLeft || s.away) return null;
  return SPEC_SAY.next;
}

/**
 * 这一次调用的「指纹」：整份输入原样，只有版面的估算数（「高约 549」「一屏能看约 580」「宽约 870 像素」）不算——
 * 学生一点按钮，底部那条换成「在想」，量出来的可用高度就差十来像素（2026-11-04 试出来的），这不改变老师该写什么；
 * 放不放得下这类结论是字（「学生要往下滑一下」），照样要一样。带图的轮不抢跑（图每次是新的）
 */
export function specKey(turns, images = 0) {
  if (images) return null;
  return JSON.stringify((turns || []).map((t) => [t.role, String(t.content ?? '').replace(/约\s?\d+(?:\.\d+)?/g, '约#')]));
}

/** 两份指纹第一处不同的地方，前后各留一点（记在没用上的那条记录里，查原因用）：「…抢跑的… ⟂ …这一刻的…」 */
export function specDiff(a, b, around = 60) {
  const x = String(a ?? ''), y = String(b ?? '');
  if (x === y) return '';
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  const from = Math.max(0, i - around);
  return `${x.slice(from, i + around)} ⟂ ${y.slice(from, i + around)}`;
}
