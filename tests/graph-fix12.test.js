// 第 1、2 批留下的小毛病（2026-11-21 一次修完）：一条一个能重现的测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGraph } from '../kit/src/graphspec.js';
import { parseSpace } from '../kit/src/spacespec.js';

test('多行的 note：前面空了格的续行算这一段的字，长得像 f(x) = … 也不当成定义', () => {
  const g = parseGraph('note: 比一比\n  f(x) = x^2 在 0 处最小\nplot x');
  assert.match(g.fields.note, /f\(x\) = x\^2 在 0 处最小/);
  assert.equal(g.defs.has?.('f') ?? Object.hasOwn(g.defs, 'f'), false);
  const s = parseSpace('note: 比一比\n  f(x, y) = x^2 + y^2 是碗\nvector [1, 2, 3]');
  assert.match(s.fields.note, /是碗/);
  assert.equal(s.rad, false, '续行里的「定义」不让整张图改成弧度');
  // 顶格写的照旧是定义
  const d = parseGraph('note: 看\nf(x) = x^2\nplot f(x)');
  assert.doesNotThrow(() => d.cmds[0].f({ x: 2 }));
});

import { makeDefs, parseDef, addDef, compileWith } from '../kit/src/fx/defs.js';
const defsOf = (...lines) => { const d = makeDefs(); for (const l of lines) addDef(d, parseDef(l)); return d; };
test("尖点、分段的分界上 f'(a) 没有定义（以前给一侧的值）；光滑的地方照旧", () => {
  const d = defsOf('f(x) = abs(x - 1) + x', 'g(x) = (x < 0)*x^2 + (x >= 0)*x^3', 'h(x) = x^3');
  const at = (src, x) => compileWith(src, d)({ x });
  assert.ok(Number.isNaN(at("f'(x)", 1)), `f'(1) = ${at("f'(x)", 1)}`);
  assert.equal(at("f'(x)", 3), 2);
  assert.ok(Math.abs(at("g'(x)", 0)) < 1e-9, '左右导数都是 0：可导，照旧');
  assert.ok(Number.isNaN(at("g''(x)", 0)), "g'' 在 0 左边 2、右边 0：没有定义");
  assert.equal(at("h''(x)", 2), 12);
});
test('偏导、梯度在分段的分界上没有定义；osc 那种用到 f″ 的地方跟着没定义', () => {
  const d = defsOf('F(x, y) = abs(x) + y^2');
  const at = (src, x, y) => compileWith(src, d)({ x, y });
  assert.ok(Number.isNaN(at('F_x(x, y)', 0, 1)));
  assert.equal(at('F_y(x, y)', 0, 1), 2);
  assert.equal(at('F_x(x, y)', 2, 1), 1);
  const G = defsOf('G(x, y) = (x < 0)*(-2x) + (x >= 0)*(3x) + y^2');
  assert.ok(Number.isNaN(compileWith('G_x(x, y)', G)({ x: 0, y: 1 })), '分段的分界：左 −2、右 3');
  assert.ok(Number.isNaN(compileWith('G_grad(x, y)', G)({ x: 0, y: 1 })[0]));
  assert.equal(compileWith('G_x(x, y)', G)({ x: 1, y: 1 }), 3);
  const gr = compileWith('F_grad(x, y)', d)({ x: 0, y: 1 });
  assert.ok(Number.isNaN(gr[0]) && gr[1] === 2, JSON.stringify(gr));
});

test('osc 在 f″ 跳的地方没有曲率圆（f′ 光滑、f″ 左 2 右 −2）', () => {
  const g = parseGraph('osc K = (x < 0)*x^2 + (x >= 0)*(-x^2) at 0');
  const c = g.cmds[0];
  assert.ok(Number.isNaN(c.d2f({ x: 0 })), `f''(0) = ${c.d2f({ x: 0 })}`);
  assert.equal(c.d2f({ x: 1 }), -2);
  assert.ok(Math.abs(c.df({ x: 0 })) < 1e-9, 'f′ 在 0 照旧是 0');
});

import { tasksText } from '../kit/src/graphpick.js';
test('图上的关卡写进黑板现状：目标做到几个、每道点一点点了哪几个、检查了几次', () => {
  const t = tasksText({ goals: '1/2', picks: [{ q: '点出极值点', picked: ['(1, 2)'], tries: 2, done: false }, { q: '零点', picked: [], tries: 0, done: true }] });
  assert.match(t, /目标 1\/2/);
  assert.match(t, /点出极值点.*\(1, 2\).*检查了 2 次/);
  assert.match(t, /零点.*做完/);
  assert.equal(tasksText({ goals: '0/0', picks: [] }), '');
});

test('f(P)：点的维数和参数个数对不上报出来；给了一个数说要几个参数', () => {
  const d = defsOf('f(x, y) = x + 10y');
  assert.equal(compileWith('f(P)', d)({ P: [1, 2] }), 21);
  assert.throws(() => compileWith('f(P)', d)({ P: [1, 2, 3] }), /3 维.*2/);
  assert.throws(() => compileWith('f(a)', d)({ a: 5 }), /2 个参数/);
});

test('drag on= 写了不等式说清楚；let P = P0 + [1, 0] drag on=… 认得是二维的点', () => {
  assert.throws(() => parseGraph('let P = [1, 1] drag on="x^2 + y^2 <= 4"'), /不等式/);
  const g = parseGraph('let P0 = [1, 0]\nlet P = P0 + [0, 1] drag on="x^2 + y^2 = 2"');
  const c = g.cmds[1];
  assert.ok(c.onG, '二维的约束编译好了');
  assert.ok(Math.abs(c.onG({ x: 1, y: 1 })) < 1e-12);
  const f = parseGraph('let a = 1 drag on=x^2');
  assert.equal(f.cmds[0].onF({ x: 3 }), 9);
});

test('末尾的词既是修饰（hide、fill）又是滑块的名字：当修饰读不通时按滑块读；strip 的 lo= / hi= 和滑块重名报出来', () => {
  const r = parseGraph('slider hide 0 2 = 1\nregion y from 0 to x for x 0 hide');
  const reg = r.cmds[1];
  assert.notEqual(reg.mods.hide, true, '这里的 hide 是 x 的上限，不是「只起名字不画」');
  const p = parseGraph('slider fill 1 6 = 6\npolar 1 + cos(t) for t 0 fill');
  assert.notEqual(p.cmds[1].mods.fill, true, '这里的 fill 是 t 的上限');
  assert.equal(parseGraph('slider fill 1 6 = 6\npolar 1 + cos(t) for t 0 2pi fill').cmds[1].mods.fill, true, '读得通时照旧是修饰');
  // 用在别的命令里照旧是普通的名字
  assert.doesNotThrow(() => parseGraph('let mid = 1\nshade x^2 0 mid'));
  assert.throws(() => parseGraph('slider a 0 1 = 0.5\nregion D = y from 0 to x for x 0 1\nstrip D at a lo=a'), /lo=.*a.*重名/);
});

import { whereRuns, whereNote, implicitNote } from '../kit/src/fx/plane.js';
const BOX = { x0: -5, x1: 5, y0: -5, y1: 5 };
test('条件围出来的区域一处都不成立（x == 1）、只是一条很细的带子：说一句（以前什么都不画、或画成一圈点，不提醒）', () => {
  const none = whereRuns((x) => Math.abs(x - 1) <= 1e-9, BOX, { nx: 96, ny: 96 });
  assert.match(whereNote(none, BOX), /implicit/);
  const ring = whereRuns((x, y) => Math.abs(x * x + y * y - 4) < 0.02, BOX, { nx: 96, ny: 96 });
  assert.match(whereNote(ring, BOX), /细|implicit/);
  const disk = whereRuns((x, y) => x * x + y * y <= 4, BOX, { nx: 96, ny: 96 });
  assert.equal(whereNote(disk, BOX), '');
});
test('implicit 的式子不变号（(x − y)² = 0）说一句；没有零点的（x² + y² + 1 = 0）、正常的不说', () => {
  assert.match(implicitNote((x, y) => (x - y) ** 2, BOX), /不变号/);
  assert.equal(implicitNote((x, y) => x * x + y * y + 1, BOX), '');
  assert.equal(implicitNote((x, y) => x * x + y * y - 4, BOX), '');
});
