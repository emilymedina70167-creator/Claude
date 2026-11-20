// 视觉交互第 1 批 Task 5：函数图的解析（graphspec.js，纯函数）——老写法照旧，认函数定义和新命令
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGraph, CMDS } from '../kit/src/graphspec.js';
import { compile } from '../kit/src/expr.js';
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { fillValues } = await import('../kit/src/scene.js');

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);
const one = (src) => parseGraph(src).cmds.at(-1);

test('老写法：示例页里的两张图命令序列不变', () => {
  const html = readFileSync('kit/examples/figures.html', 'utf8');
  const blocks = [...html.matchAll(/```graph\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(blocks.length, 2);
  assert.deepEqual(parseGraph(blocks[0]).cmds.map((c) => c.kind), ['slider', 'slider', 'let', 'shade', 'plot', 'plot', 'show']);
  assert.deepEqual(parseGraph(blocks[1]).cmds.map((c) => c.kind), ['slider', 'bars', 'show']);
  const g = parseGraph(blocks[0]);
  assert.deepEqual(g.xr, [-4, 4]);
  assert.equal(g.fields.title, '正态分布：拖动 a 看累积概率');
  assert.equal(g.cmds[2].mods.drag, true);
  near(g.cmds[4].f({ x: 0, mu: 0, s: 1 }), 1 / Math.sqrt(2 * Math.PI));
});

test('函数定义：不进 cmds，后面的命令能用 f、f′', () => {
  const g = parseGraph('f(x) = x^2/2\nplot f(x)\nplot f\'(x) dashed');
  assert.equal(g.cmds.length, 2);
  assert.ok(g.defs.has('f'));
  assert.equal(g.cmds[0].f({ x: 2 }), 2);
  assert.equal(g.cmds[1].f({ x: 3 }), 3);
  assert.equal(g.cmds[1].mods.dashed, true);
  assert.throws(() => parseGraph('plot f(x)\nf(x) = x').cmds[0].f({ x: 1 }), /没有函数 f/); // 定义要写在用它之前：求值时报
});

test('plot … for x a b：只画一段', () => {
  const c = one('plot sqrt(x) for x 0 4 color=blue');
  assert.equal(c.kind, 'plot');
  assert.equal(c.lo({}), 0); assert.equal(c.hi({}), 4);
  assert.equal(c.f({ x: 4 }), 2);
  assert.equal(c.mods.color, 'blue');
  assert.equal(one('plot x^2').lo, undefined);
});

test('tangent / secant', () => {
  const t = parseGraph('f(x) = x^2/2\ntangent f(x) at a color=yellow').cmds[0];
  assert.equal(t.kind, 'tangent');
  assert.equal(t.at({ a: 1 }), 1);
  assert.equal(t.f({ x: 2 }), 2);
  assert.equal(t.df({ x: 1 }), 1);
  assert.equal(one('tangent sin(x) at 0').df({ x: 0 }), 1);
  assert.throws(() => parseGraph('tangent sum(k, 1, 3, x^k) at 1'), /求不了导/);
  assert.throws(() => parseGraph('tangent x^2'), /tangent 的写法/);
  const s = one('secant x^2 at a, a + h');
  assert.equal(s.kind, 'secant');
  assert.equal(s.a({ a: 1, h: 2 }), 1); assert.equal(s.b({ a: 1, h: 2 }), 3);
  assert.throws(() => parseGraph('secant x^2 at 1'), /secant 的写法/);
});

test('riemann / area：能起名字', () => {
  const r = one('riemann S = x^2 from 0 to 1 n=n mid');
  assert.equal(r.kind, 'riemann'); assert.equal(r.name, 'S'); assert.equal(r.rule, 'mid');
  assert.equal(r.n({ n: 8 }), 8); assert.equal(r.a({}), 0); assert.equal(r.b({}), 1);
  assert.equal(one('riemann x^2 from 0 to 1 n=4').rule, 'left');
  assert.equal(one('riemann x^2 from 0 to 1 right n=4 color=pink').rule, 'right');
  assert.equal(one('riemann x^2 from 0 to 1 n=4').name, undefined);
  assert.throws(() => parseGraph('riemann x^2 from 0 to 1'), /riemann 的写法/);
  const a = one('area A = x, x^2 from 0 to 1 color=yellow');
  assert.equal(a.kind, 'area'); assert.equal(a.name, 'A');
  assert.equal(a.f({ x: 0.5 }), 0.5); assert.equal(a.g({ x: 0.5 }), 0.25);
  assert.throws(() => parseGraph('area x from 0 to 1'), /area 的写法/);
});

test('dots：数列的点', () => {
  const d = one('dots 1 + (-1)^n/n for n 1 30 join highlight=n>=10');
  assert.equal(d.kind, 'dots'); assert.equal(d.param, 'n');
  assert.equal(d.f({ n: 2 }), 1.5);
  assert.equal(d.from({}), 1); assert.equal(d.to({}), 30);
  assert.equal(d.mods.join, true);
  assert.equal(d.mods.highlight, 'n>=10');
});

test('point hollow、let … drag on=', () => {
  assert.equal(one('point [0, 1] hollow label=空心').mods.hollow, true);
  const g = parseGraph('f(x) = x^2\nlet a = 1 drag on=f(x)');
  assert.equal(g.cmds[0].mods.drag, true);
  assert.equal(g.cmds[0].onF({ x: 2 }), 4);
  assert.equal(one('let a = 1 drag').onF, undefined);
});

test('goal：等式或者条件', () => {
  const g = parseGraph('f(x) = x^3 - 3x\ngoal f\'(a) = 0 tol=0.05 msg="到了"').cmds[0];
  assert.equal(g.kind, 'goal');
  assert.equal(g.lhs({ a: 1 }), 0); assert.equal(g.rhs({}), 0);
  assert.equal(g.mods.tol, '0.05'); assert.equal(g.mods.msg, '到了');
  const c = one('goal maxon(abs(x^2 - 4), x, 2 - d, 2 + d) < eps');
  assert.equal(c.lhs, undefined);
  assert.equal(c.cond({ d: 0.1, eps: 1 }), 1);
  assert.equal(c.cond({ d: 1, eps: 1 }), 0);
  assert.equal(one('goal a >= 2').cond({ a: 2 }), 1);
  assert.throws(() => parseGraph('goal a = 1 = 2'), /goal 的写法/);
});

test('pick：在曲线上、在 x 轴上、随便点', () => {
  const g = parseGraph('f(x) = x^3 - 3x\npick "点出极值点" on f(x) at roots(f\'(x), x, -3, 3) tol=0.2');
  const p = g.cmds[0];
  assert.equal(p.kind, 'pick'); assert.equal(p.q, '点出极值点'); assert.equal(p.on, 'curve');
  assert.equal(p.tol, 0.2);
  const t = p.targets({});
  assert.equal(t.length, 2); near(t[0], -1, 1e-8); near(t[1], 1, 1e-8);
  assert.equal(p.onF({ x: 2 }), 2);
  const ax = one('pick "间断点" on x at 0, 1');
  assert.equal(ax.on, 'axis'); assert.deepEqual(ax.targets({}), [0, 1]);
  const fr = one('pick "交点" at [1, 1], [0, 0]');
  assert.equal(fr.on, 'free'); assert.deepEqual(fr.targets({}), [[1, 1], [0, 0]]);
  assert.throws(() => parseGraph('pick 点出来 at 1'), /pick 的写法/);
  assert.throws(() => one('pick "交点" at 1, 2').targets({}), /\[x, y\]/);
});

test('上下限里可以有空格（括号里的不切开）', () => {
  const sh = one('shade chi2pdf(x, n) chi2inv(1 - al, n) inf color=yellow');
  assert.equal(sh.kind, 'shade');
  assert.equal(sh.b({}), Infinity);
  near(sh.a({ al: 0.05, n: 10 }), 18.307, 1e-3);
  assert.equal(one('shade x + 1 0 2').f({ x: 1 }), 2);
  const r = one('riemann x^2 from a - 1 to a + 1 n=4');
  assert.equal(r.a({ a: 3 }), 2); assert.equal(r.b({ a: 3 }), 4);
  const p = one('plot x^2 for x max(0, a) min(4, a + 2)');
  assert.equal(p.lo({ a: 1 }), 1); assert.equal(p.hi({ a: 1 }), 3);
  const d = one('dots 1/n for n 1 floor(2.5 * m)');
  assert.equal(d.to({ m: 4 }), 10);
});

test('show 末尾能写 after / before（做到以后才显示的读数）', () => {
  const a = one('show $\\chi^2_{0.05} = {x}$ after');
  assert.equal(a.text, '$\\chi^2_{0.05} = {x}$'); assert.equal(a.mods.after, true);
  assert.equal(one('show 拖到这里 before').mods.before, true);
  assert.deepEqual(one('show 之后 after 之前').mods, {}); // 句子中间的不算
});

test('看不懂的行、不认识的字段照旧报', () => {
  assert.throws(() => parseGraph('画一条线'), /看不懂这一行/);
  assert.ok(CMDS.includes('tangent') && CMDS.includes('plot'));
});

test('图里的式子是弧度', () => {
  near(one('plot sin(x)').f({ x: Math.PI / 2 }), 1);
});

test('fillValues：可以换编译函数（函数图用弧度），不传照旧角度', () => {
  assert.equal(fillValues('{sin(pi/2)}', {}, [], (s) => compile(s)), '$1$');
  assert.equal(fillValues('{sin(90)}', {}, []), '$1$');
});
