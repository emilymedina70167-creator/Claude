// 判分、传图、复测几处共用的小判断（整体审查查出来的几处，tests/check-review.test.js）
export const UPLOAD_WAIT = 10000; // 一张图最多等多久

/** 页面里的 Claude 用谁：claude.ai 里是真的（ai），?dev 才用模拟老师；都没有就不判（待核，不拿模拟的冒充） */
export const callerFor = ({ dev = false, ai = null } = {}) => (dev ? 'mock' : ai?.call ? 'ai' : null);

/** 几张图一起传，每张最多等 ms；传不上、超时、图是空的都是 null */
export function uploadAll(blobs = [], upload, { ms = UPLOAD_WAIT } = {}) {
  return Promise.all(blobs.map((b) => {
    if (!b) return Promise.resolve(null);
    let timer;
    return Promise.race([
      Promise.resolve().then(() => upload(b)).catch(() => null),
      new Promise((res) => { timer = setTimeout(() => res(null), ms); }),
    ]).then((x) => { clearTimeout(timer); return x || null; });
  }));
}

/** 能不能判：手写的题手上要有整页图，或者另外打了字；拿不到就不判（待核），不让页面里的 Claude 只看文字猜 */
export function canJudge(answer = {}, images = []) {
  if (!answer?.ink) return true;
  return images.length > 0 || !!String(answer.text || '').trim();
}

/** 复测每块过没过：没出题的块（缺新题、题被拿掉）不记；待核的 ok 是 null；一次过（成功）是 true，别的 false */
export function retestResults(absorbs = {}, retests = []) {
  return retests.filter((r) => absorbs[r.block]?.state).map((r) => ({ block: r.block, days: r.days, ok: absorbs[r.block].state === '成功' ? true : absorbs[r.block].state === '待核' ? null : false }));
}
