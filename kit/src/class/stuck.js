// 察觉卡住（纯函数，有测试 tests/class-stuck.test.js）：当前板上有题等着学生做，学生却很久没有任何动静
//（没点、没写、没打字），就提醒课堂 Claude 轻轻问一句。可能是卡住了，也可能在纸上算，所以只问、不讲答案。
// 一轮只提醒一次：学生动了、或者 Claude 又说了话，才重新计时。

export const STUCK_MS = 4 * 60 * 1000;

/**
 * 现在该不该提醒。
 *   now / lastActive：现在、学生最后一次有动静的时间（毫秒）
 *   waiting：当前板上还没作答的组件（[{ id, kind, seg }]），没有就不提醒（学生只是在看讲解）
 *   nudged：这一轮已经提醒过；enabled：学生在「⋯」里关掉了就不提醒；busy：Claude 正在讲；hidden：页面在后台
 */
export function shouldNudge({ now, lastActive, waiting = [], nudged = false, enabled = true, busy = false, hidden = false, started = true, limit = STUCK_MS }) {
  if (!enabled || nudged || busy || hidden || !started) return false;
  if (!waiting.length) return false;
  return now - lastActive >= limit;
}

/** 发给课堂 Claude 的那一行 */
export function stuckText({ minutes, waiting = [] }) {
  const what = waiting.slice(0, 2).map((w) => `${w.seg ? `${w.seg} 里的 ` : ''}${w.kind || '组件'} ${w.id}`).join('、');
  return `[动作] 学生在当前板上 ${minutes} 分钟没有动静${what ? `（${what} 还没作答）` : ''}：可能卡住了，也可能在纸上算。`;
}
