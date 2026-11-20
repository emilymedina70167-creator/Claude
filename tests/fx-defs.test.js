// 视觉交互第 1 批 Task 3：图里的函数定义 f(x) = … 和撇号求导 f′、f″
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDef, makeDefs, addDef, expandSrc, compileWith } from '../kit/src/fx/defs.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);
const defsOf = (...lines) => { const d = makeDefs(); for (const l of lines) addDef(d, parseDef(l)); return d; };
const val = (src, defs, vars = {}) => compileWith(src, defs)(vars);

test('parseDef：认「名字(字母, …) = 式子」，别的行回 null', () => {
  assert.deepEqual(parseDef('f(x) = x^2'), { name: 'f', params: ['x'], src: 'x^2' });
  assert.deepEqual(parseDef('g(x, y) = x^2 + y^2'), { name: 'g', params: ['x', 'y'], src: 'x^2 + y^2' });
  assert.equal(parseDef('plot x^2'), null);
  assert.equal(parseDef('let a = 1'), null);
  assert.equal(parseDef('x: -3 3'), null);
  assert.equal(parseDef('plot (x) == 1'), null);
  assert.equal(parseDef('goal f(a) = 0'), null);
  assert.throws(() => parseDef('sin(x) = 1'), /sin 是页面自带的函数/);
  assert.throws(() => parseDef('sum(k) = 1'), /sum 是页面自带的函数/);
  assert.throws(() => parseDef('f(x, x) = x'), /参数重名/);
});

test('调用和求导', () => {
  const d = defsOf('f(x) = x^3 - 3x');
  assert.equal(val('f(2)', d), 2);
  assert.equal(val("f'(2)", d), 9);
  assert.equal(val("f''(a)", d, { a: 1 }), 6);
  assert.equal(val("f'''(0)", d), 6);
  assert.equal(val("f'(x+1)", d, { x: 1 }), 9); // 先求导，再把 x+1 代进去
  assert.equal(val('f(x) + 1', d, { x: 2 }), 3);
  assert.equal(val("2f'(1) + f(1)", d), -2);
});

test('后面的定义能用前面的；自己不能用自己', () => {
  const d = defsOf('f(x) = x^3 - 3x', 'g(x) = f(x)^2');
  assert.equal(val('g(2)', d), 4);
  near(val("g'(1)", d), 0); // −0 也是 0
  assert.equal(val("g'(2)", d), 2 * 2 * 9);
  const e = makeDefs();
  assert.throws(() => addDef(e, parseDef('f(x) = f(x) + 1')), /f 的定义里用到了它自己/);
});

test('二元函数：撇号对第一个参数求导', () => {
  const d = defsOf('h(x, y) = x^2*y');
  assert.equal(val('h(2, 3)', d), 12);
  assert.equal(val("h'(2, 3)", d), 12);
  assert.throws(() => val('h(1)', d), /h 要 2 个参数/);
  assert.throws(() => val('f(1, 2)', defsOf('f(x) = x')), /f 要 1 个参数/);
});

test('定义里能用外面的量；参数的名字不和外面的量混', () => {
  const d = defsOf('p(x) = a*x');
  assert.equal(val('p(3)', d, { a: 2 }), 6);
  assert.equal(val('p(x)', d, { a: 2, x: 5 }), 10);
  assert.equal(val('p(a)', d, { a: 2 }), 4); // 实参里的 a 是外面的 a
});

test('变限积分定义的函数：求值、求导（莱布尼茨）', () => {
  const d = defsOf('F(t) = int(cos(s), s, 0, t)');
  near(val('F(pi/2)', d), 1);
  near(val("F'(0)", d), 1);
  near(val("F'(x)", d, { x: 1 }), Math.cos(1));
});

test('求和定义的函数：求值可以，实参里的字母不被求和的字母抓走', () => {
  const d = defsOf('q(x) = sum(k, 1, 3, x^k)');
  assert.equal(val('q(2)', d), 14);
  assert.equal(val('q(k)', d, { k: 2 }), 14);
  assert.throws(() => val("q'(2)", d), /求不了导/);
});

test('没有定义、没有撇号时就是普通的表达式', () => {
  const d = makeDefs();
  assert.equal(val('2x + 1', d, { x: 3 }), 7);
  assert.deepEqual(val("[1, 2]'", d), [[1, 2]]); // 转置照旧
  assert.equal(expandSrc('x^2', d).t, 'bin');
});

test('弧度', () => {
  near(val('f(pi/2)', defsOf('f(x) = sin(x)')), 1);
});

// —— 视觉交互第 2 批 Task 1：偏导、梯度、向量当实参 ——
test('偏导：下划线后面每个字母是一个参数', () => {
  const d = defsOf('h(x, y) = x^2*y + y^3');
  assert.equal(val('h_x(2, 3)', d), 12);
  assert.equal(val('h_y(2, 3)', d), 31);
  assert.equal(val('h_xy(2, 3)', d), 4);
  assert.equal(val('h_yx(2, 3)', d), 4);
  assert.equal(val('h_yy(1, 2)', d), 12);
  assert.equal(val('h_xx(5, 3)', d), 6);
  assert.throws(() => val('h_z(1, 2)', d), /h 没有参数 z/);
  assert.throws(() => val('h(1, 2, 3)', d), /h 要 2 个参数/);
});

test('梯度、向量当实参', () => {
  const d = defsOf('h(x, y) = x^2*y + y^3');
  assert.deepEqual(val('h_grad(2, 3)', d), [12, 31]);
  assert.equal(val('h(P)', d, { P: [2, 3] }), 39);
  assert.deepEqual(val('h_grad(P)', d, { P: [2, 3] }), [12, 31]);
  assert.equal(val('h_x(P)', d, { P: [2, 3] }), 12);
  assert.equal(val('h(P + [1, 0])', d, { P: [1, 3] }), 39);
  near(val('dot(h_grad(P), [1, 0])', d, { P: [2, 3] }), 12);
});

test('一元函数也认 f_x；带下划线的普通名字不受影响', () => {
  const d = defsOf('f(x) = x^3');
  assert.equal(val('f_x(2)', d), 12);
  assert.equal(val('f_xx(2)', d), 12);
  assert.equal(val('a_x + 1', d, { a_x: 2 }), 3);
  assert.equal(val('f_x + 1', d, { f_x: 2 }), 3); // 后面没有括号：是个普通的量
});

test('定义里的 int3 / flux / lineint3：实参里的同名字母不被抓走', () => {
  const d = makeDefs();
  for (const l of ['V(c) = int3(c, x, 0, 1, y, 0, 1, z, 0, 1)', 'G(a) = flux(a*x, a*y, a*z, sin(u)*cos(v), sin(u)*sin(v), cos(u), u, 0, pi, v, 0, 2pi)', 'W(k) = lineint3(-k*y, k*x, 0, cos(t), sin(t), t, t, 0, 2pi)']) addDef(d, parseDef(l));
  const near = (a, b, e = 1e-5) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);
  near(compileWith('V(x)', d)({ x: 3 }), 3); near(compileWith('V(z + y)', d)({ z: 1, y: 2 }), 3);
  near(compileWith('G(x)', d)({ x: 2 }), 8 * Math.PI); near(compileWith('G(u)', d)({ u: 0.5 }), 2 * Math.PI); near(compileWith('G(z)', d)({ z: 1 }), 4 * Math.PI);
  near(compileWith('W(t)', d)({ t: 2 }), 4 * Math.PI); near(compileWith('W(y)', d)({ y: 0.5 }), Math.PI);
});
