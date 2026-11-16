import test from 'node:test';
import assert from 'node:assert/strict';
import { tilesOf, eyeNote, createBoardEye } from '../kit/src/class/boardeye.js';

test('一块板切成几张：一屏一张，最多两张，再长的标出来', () => {
  assert.deepEqual(tilesOf({ w: 1180, h: 600 }, { viewH: 700 }), { scale: 1, tiles: [{ y: 0, h: 600 }], more: false });
  assert.deepEqual(tilesOf({ w: 1180, h: 710 }, { viewH: 700 }).tiles.length, 1); // 只多出一点点
  const two = tilesOf({ w: 1180, h: 1050 }, { viewH: 700 });
  assert.deepEqual(two.tiles, [{ y: 0, h: 700 }, { y: 700, h: 350 }]);
  assert.equal(two.more, false);
  const long = tilesOf({ w: 1180, h: 3600 }, { viewH: 700 });
  assert.equal(long.tiles.length, 2);
  assert.equal(long.more, true);
  // 竖屏：一屏比宽高，按高缩
  const tall = tilesOf({ w: 820, h: 2000 }, { viewH: 1600, maxEdge: 1280 });
  assert.equal(tall.scale, 0.8);
  assert.equal(tilesOf({ w: 0, h: 0 }, {}).tiles.length, 1);
});

test('跟着图的那一句', () => {
  assert.equal(eyeNote({ n: 0 }), '');
  assert.equal(eyeNote({ n: 1 }), '[画面] 第 1 张图是页面拍的学生现在看到的这块板。');
  assert.equal(eyeNote({ n: 2, more: true }), '[画面] 前 2 张图是页面拍的学生现在看到的这块板（从上往下一屏一张）；板更长，后面的没拍。');
});

function clock() {
  let t = 0; let seq = 0; const q = [];
  return {
    T: { setTimeout: (f, ms) => { const id = ++seq; q.push({ id, at: t + ms, f }); return id; }, clearTimeout: (id) => { const i = q.findIndex((x) => x.id === id); if (i >= 0) q.splice(i, 1); }, now: () => t },
    // 拍的那条链有好几个 await：每走一步真的让出一次，等它们都落地
    async run(ms) { const settle = () => new Promise((r) => setImmediate(r)); const end = t + ms; await settle(); for (;;) { q.sort((a, b) => a.at - b.at); if (!q.length || q[0].at > end) break; const x = q.shift(); t = x.at; x.f(); await settle(); } t = end; await settle(); },
  };
}

test('板静下来在后台先拍；没再变直接给；变了当场拍；拍不出来给 null', async () => {
  const c = clock();
  let n = 0; let fail = false; let hang = false;
  const eye = createBoardEye({ target: () => ({}), timer: c.T, quietMs: 600, timeoutMs: 2500,
    render: async () => { if (hang) return new Promise(() => {}); if (fail) throw new Error('画不出来'); n++; return { blobs: [`图${n}`], more: false }; } });
  assert.equal(eye.latest(), null);
  eye.dirty();
  await c.run(700);
  assert.deepEqual(eye.latest().blobs, ['图1']);
  // 没再变：直接给，不重拍
  assert.deepEqual((await eye.fresh(400)).blobs, ['图1']);
  assert.equal(n, 1);
  // 变了：当场拍
  eye.dirty();
  const p = eye.fresh(400);
  await c.run(10);
  assert.deepEqual((await p).blobs, ['图2']);
  // 拍不出来：给上一份，记着为什么
  fail = true;
  eye.dirty();
  const p2 = eye.fresh(400);
  await c.run(10);
  assert.deepEqual((await p2).blobs, ['图2']);
  assert.equal(eye.lastError(), '画不出来');
  // 一直拍不完：等到 maxWait 就走，不卡着调用老师
  fail = false; hang = true;
  eye.dirty();
  const p3 = eye.fresh(400);
  await c.run(450);
  assert.deepEqual((await p3).blobs, ['图2']);
});

test('没有板、一张都没拍成：null', async () => {
  const c = clock();
  const none = createBoardEye({ target: () => null, timer: c.T, render: async () => ({ blobs: ['x'] }) });
  none.dirty();
  const p = none.fresh(100);
  await c.run(150);
  assert.equal(await p, null);
  const bad = createBoardEye({ target: () => ({}), timer: c.T, render: async () => { throw new Error('坏了'); } });
  const p2 = bad.fresh(100);
  await c.run(150);
  assert.equal(await p2, null);
  bad.stop();
  assert.equal(await bad.fresh(100), null);
});

test('老师的说明：带眼睛时多一节「你看得见板」，只写事实', async () => {
  const { buildSystem, EYE_DOC, PROTOCOL_DOC } = await import('../kit/src/class/prompt.js');
  const base = { componentDocs: '', pack: { main: {}, problems: {} }, board: {}, subject: '线代' };
  const off = buildSystem(base);
  const on = buildSystem({ ...base, eye: true });
  assert.doesNotMatch(off, /你看得见板/);
  assert.match(on, /### 你看得见板/);
  assert.equal(on.replace(`\n\n${EYE_DOC}`, ''), off);
  assert.match(EYE_DOC, /板长什么样由你设计/);
  assert.doesNotMatch(EYE_DOC, /必须|每块板都|一律/);
  assert.doesNotMatch(PROTOCOL_DOC, /先讲透/);
});
