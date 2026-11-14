// 舞台主线第十轮：量画面（kit/src/stage/sight.js）的纯函数那一半
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sightIssues, nameOf, mustOf, sightLines } from '../kit/src/stage/sight.js';

const R = (x, y, w, h) => ({ x, y, w, h });

test('压着：两样东西重叠才算，碰边、差两个像素以内不算；系在一起的不算', () => {
  const items = [
    { kind: 'obj', id: 'q', rects: [R(100, 100, 400, 80)] },
    { kind: 'obj', id: 'tl', rects: [R(100, 150, 400, 80)] },
    { kind: 'obj', id: 'r', rects: [R(100, 230, 400, 50)] }, // 和 tl 正好挨着
  ];
  const iss = sightIssues(items, { vw: 1180, vh: 678 });
  assert.deepEqual(iss.map((x) => [x.what, x.a, x.b]), [['压着', 'obj:q', 'obj:tl']]);
  assert.equal(sightIssues(items, { vw: 1180, vh: 678, tied: (a, b) => a.id === 'q' && b.id === 'tl' }).length, 0);
});

test('话、这一问压着题卡也算（以前的版面报告不算这一问那一行）；同一块里的几行话不算', () => {
  const items = [
    { kind: 'obj', id: 'c', rects: [R(250, 380, 540, 210)] },
    { kind: 'caption', id: '话1', rects: [R(290, 500, 410, 40)] },
    { kind: 'caption', id: '话2', ask: true, rects: [R(290, 545, 410, 60)] },
  ];
  const iss = sightIssues(items, { vw: 1180, vh: 678 });
  assert.equal(iss.length, 2);
  for (const x of iss) { x.an = nameOf(x.a, items); x.bn = nameOf(x.b, items); }
  assert.deepEqual(sightLines(iss), ['c 和 话 压着', 'c 和 这一问 压着']);
});

test('出了屏幕：按屏幕真有多高（Safari 地址栏占掉一截时更矮）', () => {
  const items = [{ kind: 'obj', id: 'q', rects: [R(100, 600, 400, 120)] }];
  assert.equal(sightIssues(items, { vw: 1180, vh: 820 }).length, 0);
  assert.deepEqual(sightIssues(items, { vw: 1180, vh: 678 }).map((x) => x.what), ['出了屏幕']);
});

test('页面的按钮：东西压着它算；它和底下那一条、拨数器挨着不算', () => {
  const items = [
    { kind: 'chrome', id: '页面的按钮「说过的」', rects: [R(1060, 10, 80, 40)] },
    { kind: 'obj', id: 'm', rects: [R(1000, 20, 120, 40)] },
    { kind: 'dock', id: '底下1', rects: [R(1125, 30, 50, 40)] },
  ];
  const iss = sightIssues(items, { vw: 1180, vh: 678 });
  assert.equal(iss.length, 1);
  assert.equal(nameOf(iss[0].a, items), '页面的按钮「说过的」');
});

test('名字：老师认得的写法；只有压着、出了屏幕要改', () => {
  assert.equal(nameOf('label:dial:m'), '拨盘 m');
  assert.equal(nameOf('label:lm'), '贴的字 lm');
  assert.equal(nameOf('goal:g1'), '挑战 g1');
  assert.equal(nameOf('dock:底下1'), '底下的输入框');
  assert.deepEqual(mustOf([{ what: '贴的字太小' }, { what: '压着' }, { what: '出了屏幕' }]).map((x) => x.what), ['压着', '出了屏幕']);
  // 同一对写一次
  assert.equal(sightLines([{ what: '压着', an: 'q', bn: 'tl' }, { what: '压着', an: 'tl', bn: 'q' }]).length, 1);
});
