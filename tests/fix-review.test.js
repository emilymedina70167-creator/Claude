// 六批以后那一轮的独立复查：一条一个能重现的测试（2026-11-21）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGraph } from '../kit/src/graphspec.js';
import { parseSpace } from '../kit/src/spacespec.js';
import { makeDefs, parseDef, addDef, compileWith } from '../kit/src/fx/defs.js';
import { whereRuns, whereNote } from '../kit/src/fx/plane.js';

test('1 缩进的命令照旧是命令：续行只算 note / q 这种写字的字段', () => {
  const a = parseGraph('x: -3 3\n  plot x^2');
  assert.equal(a.cmds.length, 1); assert.deepEqual(a.xr, [-3, 3]);
  assert.equal(parseGraph('title: 抛物线\n  plot x^2\n  point [1, 1]').cmds.length, 2);
  assert.equal(parseSpace('title: 曲面\n  surface z = x^2 + y^2 for x -1 1, y -1 1').cmds.length, 1);
  assert.match(parseGraph('note: 比一比\n  f(x) = x^2 在 0 处最小\nplot x').fields.note, /在 0 处最小/);
});

const defsOf = (...lines) => { const d = makeDefs(); for (const l of lines) addDef(d, parseDef(l)); return d; };
test('2 陡但光滑的函数导数照旧有定义；真的尖点没有', () => {
  const nanCount = (src, def, a, b, n = 2001) => { const d = defsOf(def), f = compileWith(src, d); let k = 0; for (let i = 0; i < n; i++) if (Number.isNaN(f({ x: a + ((b - a) * i) / (n - 1) }))) k++; return k; };
  assert.equal(nanCount("f'(x)", 'f(x) = exp(-x^2/(2*0.01^2))/(0.01*sqrt(2*pi))', -0.05, 0.05), 0);
  assert.equal(nanCount("f'(x)", 'f(x) = sin(200x)', 0, 1), 0);
  assert.equal(nanCount("f''(x)", 'f(x) = sin(50x)', -1, 1), 0);
  assert.equal(nanCount("f'(x)", 'f(x) = x^2*sin(1/x)', 0.001, 0.05), 0);
  assert.equal(nanCount("f'(x)", 'f(x) = sin(x)', 0, 1e5, 501), 0);
  assert.ok(Number.isNaN(compileWith("f'(x)", defsOf('f(x) = abs(x - 1) + x'))({ x: 1 })));
  assert.ok(Number.isNaN(compileWith("g''(x)", defsOf('g(x) = (x < 0)*x^2 + (x >= 0)*x^3'))({ x: 0 })));
});

const BOX = { x0: -5, x1: 5, y0: -5, y1: 5 };
test('3 小的圆、三角形不说是「很细的带子」；真的细圈照旧说', () => {
  assert.equal(whereNote(whereRuns((x, y) => x * x + y * y < 0.09, BOX, { nx: 96, ny: 96 }), BOX), '');
  assert.equal(whereNote(whereRuns((x, y) => x > 0 && y > 0 && x + y < 0.8, BOX, { nx: 96, ny: 96 }), BOX), '');
  assert.match(whereNote(whereRuns((x, y) => Math.abs(x * x + y * y - 4) < 0.02, BOX, { nx: 96, ny: 96 }), BOX), /细/);
});

test('4 let a = 1 drag on="y = x^2"：数的把手认 y = 的写法', () => {
  const c = parseGraph('let a = 1 drag on="y = x^2"').cmds[0];
  assert.ok(c.onF, '有骑的曲线');
  assert.equal(c.onF({ x: 3 }), 9);
});
