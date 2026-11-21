// scene 向量的名字放哪（plot.js 的 labelSpot）：箭头尖在窗口边上时以前六个候选都在尖外面，
// 一个都放不进框就退回第一个、画到框外被裁掉（2026-11-18 那节外部课里 Ax、BAx 两个名字都没出来）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelSpot, PLANE_SIZE } from '../kit/src/plot.js';

const inBox = ([cx, cy], w) => cx - w / 2 > 2 && cx + w / 2 < PLANE_SIZE - 2 && cy > 16 && cy < PLANE_SIZE - 14;

test('箭头尖在右边框上：名字退到箭杆旁边，放在框里', () => {
  // range 4 时 A·[2,2] = [4,2]：尖在 (480, 120)，方向 (2,1)/√5
  const ux = 2 / Math.sqrt(5), uy = -1 / Math.sqrt(5);
  const at = labelSpot(480, 120, ux, uy, 'Ax', []);
  assert.ok(inBox(at, 32), `放在了 ${at}`);
});

test('箭头尖在上边框上：名字放在框里', () => {
  const ux = -1 / Math.sqrt(5), uy = -2 / Math.sqrt(5);
  const at = labelSpot(120, 0, ux, uy, 'BAx', []);
  assert.ok(inBox(at, 48), `放在了 ${at}`);
});

test('箭头在窗口中间：照旧放在尖的前面（老的图不变）', () => {
  const at = labelSpot(300, 200, 1, 0, 'x', []);
  assert.ok(at[0] > 300 && Math.abs(at[1] - 200) < 1e-9, `放在了 ${at}`);
});
