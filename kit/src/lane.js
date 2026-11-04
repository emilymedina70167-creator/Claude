// 调用让路（docs/smart-plan.md 第 0 节）：平台给一个人同时只跑两三个调用，多的排队。
// 后台的活（对话太长时的摘要，以后的复盘、观察、审板）不许挤占讲课：
// - fg（讲课、抢跑、下课小结）：马上发，不排队；
// - bg（后台）：讲课的调用在跑时不开新的，同时最多 bgMax 个，按先来后到。
// 已经在跑的后台调用不打断（打断了白花），讲课的那个照样能拿到第二个位子。
// 不碰 DOM，有测试（tests/lane.test.js）。

export function createLane({ bgMax = 1 } = {}) {
  let fg = 0;
  let bg = 0;
  const waiting = []; // [{ fn, resolve, reject, signal, onAbort }]

  function pump() {
    while (fg === 0 && bg < bgMax && waiting.length) {
      const job = waiting.shift();
      if (job.signal) job.signal.removeEventListener('abort', job.onAbort);
      bg++;
      let p;
      try { p = Promise.resolve(job.fn()); } catch (e) { p = Promise.reject(e); }
      p.then(job.resolve, job.reject).finally(() => { bg--; pump(); });
    }
  }

  /** kind：'fg' | 'bg'；fn 返回 Promise。signal：排队时被取消就不发，直接 reject { code: 'cancelled' } */
  function run(kind, fn, { signal } = {}) {
    if (kind !== 'bg') {
      fg++;
      let p;
      try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
      return p.finally(() => { fg--; pump(); });
    }
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject({ code: 'cancelled', message: '还没发就取消了' }); return; }
      const job = { fn, resolve, reject, signal };
      job.onAbort = () => {
        const i = waiting.indexOf(job);
        if (i >= 0) { waiting.splice(i, 1); reject({ code: 'cancelled', message: '还没发就取消了' }); }
      };
      signal?.addEventListener('abort', job.onAbort, { once: true });
      waiting.push(job);
      pump();
    });
  }

  return { run, get state() { return { fg, bg, waiting: waiting.length }; } };
}

// 整个页面共用一条（ai.js、课堂的模拟老师都走它）
export const lane = createLane();
