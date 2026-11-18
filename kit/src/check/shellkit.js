// 外壳（shell.js）里不碰 DOM 的几样小判断（整体审查查出来的几处，tests/check-review.test.js）
export const TICK_MAX = 2000; // 两次 tick 之间最多算多久：iPad 熄屏时定时器停住，亮屏后的第一下不能把整段熄屏都算进限时
export const CLICK_GUARD = 450; // 换屏以后这么久内的点不算（连点两下「想不出来」不放弃下一道）
export const LOCK_STALE = 6000; // 别的标签页的心跳这么久没更新就当它关了

/** 这一下 tick 算多少毫秒 */
export const tickMs = (last, now) => Math.max(0, Math.min(TICK_MAX, (Number(now) || 0) - (Number(last) || 0)));

/** 画面的键：键一样就不重画（输入框里的字不丢）；补讲在写 / 写好了是两屏 */
export function screenKey(v = {}) {
  const t = v.show === 'teach' ? `:${v.teach?.text === null ? 'writing' : 'ready'}` : '';
  return `${v.show}:${v.id || ''}${t}`;
}

/** 换屏以后太快的那一下点（第二下点到了新的一屏上） */
export const tooSoon = (shownAt, now) => (Number(now) || 0) - (Number(shownAt) || 0) < CLICK_GUARD;

/** 这次检验现在归哪个标签页：别的页心跳还新鲜 → 'other'，不然 'mine' */
export function lockState(stored, me, now) {
  if (!stored || stored.id === me) return 'mine';
  return (Number(now) || 0) - (Number(stored.at) || 0) < LOCK_STALE ? 'other' : 'mine';
}
