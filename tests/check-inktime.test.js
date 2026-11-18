// 检验手写板的时间线（kit/src/check/inktime.js）：行、关键时刻、某一刻的样子、时间线文字、存档瘦身
import test from 'node:test';
import assert from 'node:assert/strict';
import { linesOf, keyMoments, frameAt, timelineText, fitStrokes, decodeStrokes, mmss } from '../kit/src/check/inktime.js';

// 一笔：在 (x, y0..y1) 一竖，t0..t1 写的
const stroke = (x, y0, y1, t0, t1, extra = {}) => ({ color: 'white', pts: [x, y0, 2, x + 4, (y0 + y1) / 2, 2, x + 8, y1, 2], bbox: [x - 2, y0 - 2, x + 10, y1 + 2], t0, t1, ...extra });

test('mmss', () => {
  assert.equal(mmss(0), '0:00');
  assert.equal(mmss(80000), '1:20');
  assert.equal(mmss(125000), '2:05');
});

test('linesOf：两行字是两行，从上往下编号', () => {
  const s = [stroke(0, 60, 90, 0, 1), stroke(20, 0, 30, 2, 3), stroke(40, 62, 88, 4, 5), stroke(60, 2, 28, 6, 7), stroke(80, 0, 30, 8, 9), stroke(100, 60, 90, 10, 11)];
  const lines = linesOf(s);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].n, 1);
  assert.deepEqual(lines[0].ids.sort(), [1, 3, 4]);
  assert.deepEqual(lines[1].ids.sort(), [0, 2, 5]);
});

test('linesOf：同一行上下抖 8px 还是一行；一个小点也归进那一行', () => {
  const s = [stroke(0, 0, 30, 0, 1), stroke(20, 8, 38, 2, 3), stroke(40, -6, 24, 4, 5), { color: 'white', pts: [60, 15, 2], bbox: [58, 13, 62, 17], t0: 6, t1: 6 }];
  assert.equal(linesOf(s).length, 1);
});

test('keyMoments：停顿、划掉之前、下一步；划掉的都在，最多 6 个', () => {
  const s = [stroke(0, 0, 30, 0, 10000), stroke(20, 0, 30, 55000, 60000)];
  const m = keyMoments(s, [], { pause: 30000 });
  assert.equal(m.length, 1);
  assert.equal(m[0].why, 'pause');
  assert.equal(m[0].gap, 45000);
  // 10 个停顿 + 2 次划掉
  const many = Array.from({ length: 11 }, (_, i) => stroke(i * 10, 0, 30, i * 100000, i * 100000 + 1000));
  const ev = [{ t: 350000, kind: 'strike', ids: [1] }, { t: 750000, kind: 'strike', ids: [2] }];
  const mm = keyMoments(many, ev, { pause: 30000, max: 6 });
  assert.equal(mm.length, 6);
  assert.equal(mm.filter((x) => x.why === 'strike').length, 2);
  // 按时间排
  assert.deepEqual(mm.map((x) => x.t), [...mm.map((x) => x.t)].sort((a, b) => a - b));
});

test('frameAt：划掉以前那一刻，那几笔还没划', () => {
  const s = [stroke(0, 0, 30, 0, 1000, { struck: 5000 }), stroke(20, 0, 30, 2000, 3000), stroke(40, 0, 30, 9000, 9500)];
  const f = frameAt(s, 4999);
  assert.equal(f.length, 2);
  assert.equal(f[0].struckNow, false);
  assert.equal(frameAt(s, 5000)[0].struckNow, true);
});

test('timelineText', () => {
  const s = [
    stroke(0, 0, 30, 0, 20000), stroke(20, 0, 30, 30000, 80000), // L1：0:00–1:20
    stroke(0, 60, 90, 125000, 140000), stroke(20, 60, 90, 141000, 150000), // 停 45 秒；L2：2:05–2:30
  ];
  const ev = [{ t: 155000, kind: 'strike', ids: [2, 3] }, { t: 160000, kind: 'step', ids: [] }];
  const lines = linesOf(s);
  const m = keyMoments(s, ev, { pause: 30000 });
  assert.equal(timelineText(s, ev, lines, m, { pause: 30000 }), '0:00–1:20 写 L1；停 45 秒；2:05–2:30 写 L2；2:35 划掉 L2（划前见快照 2）；2:40 下一步');
});

test('fitStrokes：三万个点也压到 200 KiB 以内', () => {
  const pts = [];
  for (let i = 0; i < 30000; i++) pts.push(100.123 + i * 0.37, 200.456 + Math.sin(i) * 30, 2.345);
  const big = [{ color: 'white', pts, bbox: [0, 0, 12000, 300], t0: 0, t1: 600000 }];
  const r = fitStrokes(big);
  assert.ok(JSON.stringify(r).length <= 200 * 1024, `${JSON.stringify(r).length}`);
  assert.equal(r.trimmed, true);
  // 小的：坐标取整、半径一位小数，不算 trimmed
  const small = fitStrokes([stroke(0.4, 0.6, 30.2, 0, 1)]);
  assert.equal(small.trimmed, false);
  assert.ok(decodeStrokes(small)[0].pts.every((x) => Number.isInteger(x * 10)));
});
