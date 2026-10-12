// 截图 / 手写图转白底：透明底的浅色笔迹要压暗，本来有底色的图不改
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenOnWhite, INK_MAX_LUMINANCE, CUTOUT_MIN_TRANSPARENT } from '../kit/src/flatten.js';

const lum = (r, g, b) => {
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const px = (...list) => Uint8ClampedArray.from(list.flat());
const at = (d, i) => [...d.slice(i * 4, i * 4 + 4)];

test('Notability 圈选拷贝那种图：透明底 + 青色笔迹 → 白底 + 压暗的青色，色相不变', () => {
  const cyan = [32, 212, 235, 255]; // 实测学生的笔迹颜色
  const d = px([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], cyan);
  const r = flattenOnWhite(d);
  assert.deepEqual(r, { cutout: true, darkened: 1 });
  assert.deepEqual(at(d, 0), [255, 255, 255, 255], '透明处变成白底');
  const [R, G, B, A] = at(d, 3);
  assert.equal(A, 255);
  assert.ok(lum(R, G, B) <= INK_MAX_LUMINANCE + 0.01, `压暗后亮度 ${lum(R, G, B)}`);
  // 白底上的对比度至少 5:1（原来只有约 1.8:1）
  assert.ok(1.05 / (lum(R, G, B) + 0.05) >= 5);
  assert.ok(Math.abs(G / B - 212 / 235) < 0.03 && R < G, '还是青色');
});

test('透明底上的深色笔迹不改，半透明的边按透明度铺到白底上', () => {
  const d = px([0, 0, 0, 0], [0, 0, 0, 0], [20, 20, 60, 255], [20, 20, 60, 128]);
  const r = flattenOnWhite(d);
  assert.equal(r.cutout, true);
  assert.equal(r.darkened, 0);
  assert.deepEqual(at(d, 2), [20, 20, 60, 255]);
  const half = at(d, 3);
  assert.ok(half[0] > 120 && half[0] < 150 && half[3] === 255, `半透明边：${half}`);
});

test('本来就有底色的图（系统截图、照片）一个像素都不改', () => {
  const shot = [[30, 40, 35, 255], [32, 212, 235, 255], [255, 255, 255, 255], [0, 0, 0, 255], [32, 212, 235, 250]];
  const d = px(...shot);
  const r = flattenOnWhite(d);
  assert.deepEqual(r, { cutout: false, darkened: 0 });
  shot.slice(0, 4).forEach((p, i) => assert.deepEqual(at(d, i), p));
});

test('透明像素太少（低于阈值）不算透明底的图，浅色不压暗', () => {
  const n = 20;
  const list = Array.from({ length: n }, (_, i) => (i < Math.floor(n * CUTOUT_MIN_TRANSPARENT) - 1 ? [0, 0, 0, 0] : [240, 240, 240, 255]));
  const d = px(...list);
  assert.equal(flattenOnWhite(d).cutout, false);
  assert.deepEqual(at(d, n - 1), [240, 240, 240, 255]);
});

test('白色笔迹（深色纸上写的）也看得见；空图不出错', () => {
  const d = px([0, 0, 0, 0], [0, 0, 0, 0], [255, 255, 255, 255]);
  flattenOnWhite(d);
  const [R, G, B] = at(d, 2);
  assert.ok(lum(R, G, B) <= INK_MAX_LUMINANCE + 0.01 && R === G && G === B, `白笔迹变灰：${R}`);
  assert.deepEqual(flattenOnWhite(px()), { cutout: false, darkened: 0 });
});
