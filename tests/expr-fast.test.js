// fastNum：积分、求和里层的式子编译成闭包，算出来和 run 一模一样（2026-11-21，带条件的三重积分从 1.5 秒到 1 秒以内）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, evaluate, fastNum } from '../kit/src/expr.js';

const SRCS = ['x^2 + 3x - 1', '(x < 0)*x^2 + (x >= 0)*x^3', 'sin(x)/x', 'x/3 - y/7', 'abs(x - y) <= 0.5', '(-8)^(1/3) + x', 'max(x, y) - min(x, y)', 'e^x * cos(pi*y)', 'x == y', 'x != 0.1', 'ln(abs(x) + 1)', '-x^2', 'sqrt(x^2 + y^2)', 'floor(x) + ceil(y)'];
test('和 run 逐位一样（随机取几百个点）', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 6 - 3; };
  for (const src of SRCS) {
    const ast = parse(src), f = fastNum(ast);
    for (let k = 0; k < 300; k++) {
      const v = { x: rnd(), y: rnd() };
      let a, b;
      try { a = evaluate(ast, v); } catch (e) { a = `E:${e.message}`; }
      try { b = f(v); } catch (e) { b = `E:${e.message}`; }
      if (Number.isNaN(a) && Number.isNaN(b)) continue;
      assert.equal(b, a, `${src} 在 ${JSON.stringify(v)}`);
    }
  }
});
test('碰到向量、没定义的名字、特殊形式：退回 run，结果和报的错一样', () => {
  for (const [src, v] of [['P + [1, 2]', { P: [1, 1] }], ['dot(P, P)', { P: [3, 4] }], ['q + 1', {}], ['sum(k, 1, 3, k*x)', { x: 2 }], ['int(t^2, t, 0, x)', { x: 3 }]]) {
    const ast = parse(src), f = fastNum(ast);
    let a, b;
    try { a = JSON.stringify(evaluate(ast, v)); } catch (e) { a = `E:${e.message}`; }
    try { b = JSON.stringify(f(v)); } catch (e) { b = `E:${e.message}`; }
    assert.equal(b, a, src);
  }
});
test('带条件的三重积分（球的体积）和以前一样准（快了多少不在这里量：机器不一样）', () => {
  const v = evaluate('int3((x^2+y^2+z^2 <= 1), x, -1, 1, y, -1, 1, z, -1, 1)', {});
  assert.ok(Math.abs(v - 4 * Math.PI / 3) < 1e-3);
});
