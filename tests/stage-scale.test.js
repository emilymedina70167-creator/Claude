// 第九轮 Task 6：scale（整样东西放大缩小：对外的框按左上角乘系数，画法用不缩放的框）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';

const run = (src, sc = new Scene()) => { let fx; for (const c of parseScript(src)) fx = sc.apply(c); return { sc, fx }; };
const err = (sc, line) => sc.check(parseScript(line)[0]);

test('scale s 2：画面上的框宽 2 倍、离左上角的距离 2 倍；画法用的框不变；点换得回去', () => {
  const { sc } = run('sentence s = "The company makes a quick decision."');
  const p = sc.parts('s.3')[0];
  const before = sc.partBox(p), o0 = sc.objectBox('s');
  run('scale s 2', sc);
  const after = sc.worldPartBox(p), o1 = sc.worldObjectBox('s');
  assert.ok(Math.abs(after.w - before.w * 2) < 0.01);
  assert.ok(Math.abs((after.x - o1.x) - (before.x - o0.x) * 2) < 0.01);
  assert.deepEqual([o1.x, o1.y], [o0.x, o0.y], '左上角不动');
  assert.ok(Math.abs(o1.w - o0.w * 2) < 0.01);
  assert.deepEqual(sc.partBox(p), before, '画法、底座用的框不变');
  assert.deepEqual(sc.objectBox('s'), o0);
  const mid = { x: after.x + after.w / 2, y: after.y + after.h / 2 };
  const back = sc.toLocal('s', mid);
  assert.ok(Math.abs(back.x - (before.x + before.w / 2)) < 0.01 && Math.abs(back.y - (before.y + before.h / 2)) < 0.01, '画面上的点换回它自己的坐标');
});

test('写错当场报；交给学生的部件缩到小于 44 不照办', () => {
  const { sc } = run('array a = 1 2 3\nopen a');
  assert.match(err(sc, 'scale a 3'), /0\.5 到 2\.5/);
  assert.match(err(sc, 'scale zz 1.2'), /舞台上没有「zz」/);
  assert.match(err(sc, 'scale a 0.5'), /学生要点/);
  assert.equal(err(sc, 'scale a 1.5'), null);
});

test('scale 1 回到原样；clone 带着；现状写一句', () => {
  const { sc } = run('array a = 1 2 3\nscale a 1.5');
  assert.equal(sc.clone().objects.get('a').k, 1.5);
  assert.match(sc.stateText(), /放大到 1\.5 倍/);
  run('scale a 1', sc);
  assert.equal(sc.objects.get('a').k, undefined);
});
