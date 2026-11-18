// 第九轮 Task 1：截图给老师（静下来后台拍、要的时候拿最新一张、超时兜底）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitEdge, snapNote, createSnapper } from '../kit/src/stage/snap.js';

test('fitEdge：长边缩到 1024，不放大', () => {
  const a = fitEdge({ w: 1180, h: 820 });
  assert.equal(a.w, 1024);
  assert.equal(a.h, 712);
  assert.ok(Math.abs(a.k - 1024 / 1180) < 1e-9);
  assert.deepEqual(fitEdge({ w: 800, h: 600 }), { w: 800, h: 600, k: 1 });
});

test('snapNote 三种句子', () => {
  assert.equal(snapNote({ ok: true, ageMs: 200 }), '[画面] 附了一张这一刻的画面图（先看图再写）');
  assert.equal(snapNote({ ok: true, ageMs: 3400 }), '[画面] 附了一张 3 秒前的画面图（先看图再写）');
  assert.equal(snapNote({ ok: false, reason: '超时' }), '[画面] 这一轮没截到图（超时）：下面是字画的版面');
});

// 假时钟：setTimeout 换成手动推进
function clock() {
  let now = 0;
  const jobs = [];
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const j = { at: now + ms, fn }; jobs.push(j); return j; },
    clearTimeout: (j) => { const i = jobs.indexOf(j); if (i >= 0) jobs.splice(i, 1); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        jobs.sort((a, b) => a.at - b.at);
        const j = jobs[0];
        if (!j || j.at > end) break;
        jobs.shift();
        now = j.at;
        j.fn();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      }
      now = end;
      await Promise.resolve(); await Promise.resolve();
    },
  };
}
const fakeCanvas = (n) => ({ width: 1180, height: 820, n, toBlob: (cb) => cb({ size: 1000 + n, n }) });

test('静下来 600 毫秒才拍；拍的时候又变了再拍一次', async () => {
  const c = clock();
  let calls = 0;
  const s = createSnapper({ root: {} }, { render: async () => fakeCanvas(++calls), timer: c });
  s.dirty();
  await c.advance(500);
  assert.equal(calls, 0);
  await c.advance(200);
  assert.equal(calls, 1);
  assert.equal(s.latest().blob.n, 1);
  s.dirty();
  await c.advance(700);
  assert.equal(calls, 2);
});

test('fresh：没新变化直接给最新的；有新变化等新的；一直等不到 500 毫秒后给旧的', async () => {
  const c = clock();
  let calls = 0, hang = false;
  const s = createSnapper({ root: {} }, { render: () => (hang ? new Promise(() => {}) : Promise.resolve(fakeCanvas(++calls))), timer: c });
  s.dirty(); await c.advance(700);
  const p1 = s.fresh(500);
  await c.advance(0);
  assert.equal((await p1).blob.n, 1);
  s.dirty();
  const p2 = s.fresh(500);
  await c.advance(10);
  assert.equal((await p2).blob.n, 2, '有变化：当场拍一张新的');
  hang = true;
  s.dirty();
  const p3 = s.fresh(500);
  await c.advance(600);
  assert.equal((await p3).blob.n, 2, '拍不出来：给旧的那张');
});

test('render 抛错：latest 是 null、不抛', async () => {
  const c = clock();
  const s = createSnapper({ root: {} }, { render: async () => { throw new Error('坏了'); }, timer: c });
  s.dirty(); await c.advance(700);
  assert.equal(s.latest(), null);
  const r = await s.fresh(500);
  assert.equal(r, null);
  assert.match(s.lastError(), /坏了/);
});
