// 视觉交互第 4 批 Task 2 的纯函数部分：文氏图的几何（kit/src/prob/venngeom.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { vennLayout, atomAt } from '../kit/src/prob/venngeom.js';

const inside = (c, x, y) => Math.hypot(x - c.cx, y - c.cy) < c.r;
const bits = (L, x, y) => L.circles.reduce((m, c, i) => (inside(c, x, y) ? m | (1 << i) : m), 0);

for (const n of [1, 2, 3]) {
  test(`${n} 个事件：2ⁿ 块都有轮廓、都点得到（放字的那一点四周至少 22px）`, () => {
    const L = vennLayout(n);
    assert.equal(L.circles.length, n);
    assert.equal(L.atoms.length, 1 << n);
    L.atoms.forEach((a, k) => {
      assert.equal(a.k, k);
      assert.match(a.d, /^M[\d.\- ]+/, `第 ${k} 块有轮廓`);
      assert.equal(bits(L, a.at.x, a.at.y), k, `第 ${k} 块放字的点在这一块里`);
      assert.ok(a.room >= 22, `第 ${k} 块四周只有 ${a.room}px`);
      assert.equal(atomAt(L, a.at.x, a.at.y), k);
      // 一块是一圈（圆外面那一块是矩形套着一圈洞）
      assert.equal((a.d.match(/M/g) || []).length, k === 0 ? 2 : 1);
      assert.equal((a.d.match(/Z/g) || []).length, k === 0 ? 2 : 1);
    });
    assert.equal(atomAt(L, -5, 10), null, '矩形外面不算');
    assert.equal(atomAt(L, L.w + 1, 10), null);
    // 圆和名字都在矩形里
    for (const c of L.circles) {
      assert.ok(c.cx - c.r > 4 && c.cx + c.r < L.w - 4 && c.cy - c.r > 4 && c.cy + c.r < L.h - 4);
      assert.ok(c.label.x > 8 && c.label.x < L.w - 8 && c.label.y > 8 && c.label.y < L.h - 8);
      assert.ok(Math.hypot(c.label.x - c.cx, c.label.y - c.cy) > c.r, '名字写在圆外面');
    }
  });
}

test('每一块轮廓上的弧首尾相接；弧数对', () => {
  const arcs = (d) => (d.match(/A/g) || []).length;
  const L2 = vennLayout(2);
  assert.deepEqual(L2.atoms.map((a) => arcs(a.d)), [2, 2, 2, 2]); // 外面：两段大弧；只 A：大弧 + 凹弧；只 B；交：两段小弧
  const L3 = vennLayout(3);
  assert.deepEqual(L3.atoms.map((a) => arcs(a.d)), [3, 3, 3, 3, 3, 3, 3, 3]);
  // 沿着轮廓走，每段弧的起点就是上一段的终点
  for (const a of [...L2.atoms, ...L3.atoms]) {
    for (const loop of a.loops) {
      loop.forEach((seg, i) => {
        const prev = loop[(i + loop.length - 1) % loop.length];
        assert.ok(Math.hypot(seg.from.x - prev.to.x, seg.from.y - prev.to.y) < 1e-6);
      });
    }
  }
});

test('面积对得上：各块的面积加起来是矩形；两个圆的交是透镜的面积', () => {
  for (const n of [2, 3]) {
    const L = vennLayout(n);
    const sum = L.atoms.reduce((s, a) => s + a.area, 0);
    assert.ok(Math.abs(sum - L.w * L.h) < 1e-6 * L.w * L.h, `和 ${sum} 对 ${L.w * L.h}`);
    assert.ok(L.atoms.every((a) => a.area > 0));
  }
  const L = vennLayout(2), [a, b] = L.circles, d = Math.hypot(a.cx - b.cx, a.cy - b.cy), r = a.r;
  const lens = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
  assert.ok(Math.abs(L.atoms[3].area - lens) < 1e-6 * lens);
});
