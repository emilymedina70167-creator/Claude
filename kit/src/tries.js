// 作答的次数：全部会判对错的组件同一个规矩（tests/tries.test.js）。
//   「看答案」检查三次没对才出（视觉第 4 批起的规矩；以前的老组件是两次，2026-11-21 统一成新的）。
//   同一个错答案连着再交不算新的一次：上一次的提示还在，次数不涨、不记新的作答（学生手抖多点一下、
//   或者没看懂提示又点一下，不该把「一次就对」「第几次对」算乱）。只拦错的：对的、页面判不了的照常。
export const REVEAL_TRIES = 3;
export const canReveal = (n) => n >= REVEAL_TRIES;

export function sameWrong() {
  let last = null;
  return {
    // 这一次交的（sig：能代表这次作答的一串字）是不是和上一次交的一样、上一次是错的
    repeat: (sig) => last !== null && String(sig) === last,
    // 交完记下：错了记住它，对了 / 判不了清掉
    after: (sig, ok) => { last = ok === false ? String(sig) : null; },
  };
}
