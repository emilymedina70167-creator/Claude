// 计划 3（dr-calc-base）Task 1：表达式默认弧度；画图的几处（scene、space、标注、figure set、predict）照旧角度
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { evaluate, compile } from '../kit/src/expr.js';
import { calcValue, letScope, toFloat } from '../kit/src/exact.js';
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { parseScene } = await import('../kit/src/scene.js');

const near = (a, b, e = 1e-12) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);

test('默认弧度', () => {
  near(evaluate('sin(pi/6)'), 0.5);
  near(calcValue('sin(pi/6)').float, 0.5);
  near(evaluate('cos(pi)'), -1);
  near(evaluate('arctan(1)'), Math.PI / 4);
  near(evaluate('arcsin(1/2)'), Math.PI / 6);
  near(evaluate('atan2(1, 1)'), Math.PI / 4);
  near(evaluate('cot(pi/4)'), 1);
  near(evaluate('sec(0)'), 1);
  near(evaluate('lg(1000)'), 3);
  near(evaluate('Phi(0)'), 0.5, 1e-7);
  near(evaluate('phi(0)'), 1 / Math.sqrt(2 * Math.PI));
  assert.equal(evaluate('5!'), 120);
  assert.equal(evaluate('3!*2'), 12);
  assert.equal(evaluate('inf'), Infinity);
  assert.equal(evaluate('|-3|'), 3);
  assert.equal(evaluate('5 != 3'), 1); // ! 后缀不能吃掉 !=
});

test('负数的奇数次方根取实数', () => {
  near(evaluate('(-8)^(1/3)'), -2);
  near(evaluate('(-32)^(3/5)'), -8);
  assert.ok(Number.isNaN(evaluate('(-8)^(1/2)')));
});

test('图形的地方照旧角度', () => {
  near(compile('sin(90)', { deg: true })({}), 1);
  near(evaluate('atan2(1, 1)', {}, { deg: true }), 45);
  near(calcValue('cos(60)', {}, { deg: true }).float, 0.5);
  // rot(角度) 名字就写着是角度：两种都按角度
  for (const o of [{}, { deg: true }]) assert.deepEqual(compile('rot(90)', o)({}).map((r) => r.map(Math.round)), [[0, -1], [1, 0]]);
  const { cmds } = parseScene('curve [cos(s), sin(s)] for s 0 360');
  const c = cmds.find((x) => x.kind === 'curve');
  assert.deepEqual(c.expr({ s: 90 }).map((x) => Math.round(x * 1e9) / 1e9), [0, 1]);
});

test('图自己的 let 和画出来的一致', () => {
  const { cmds } = parseScene('let p = [cos(60), sin(60)]');
  near(toFloat(letScope(cmds, {}, { deg: true }).p)[0], 0.5);
});

// —— 每一个从 expr.js / exact.js 拿求值的地方都要归类：角度（画图的）还是弧度（答案、计算）——
// 新加一个调用、没归类，这条就红：免得以后有人在图里写 sin，没人记得这里分过两种
const DEG = new Set(['scene.js', 'space.js', 'marks.js', 'class/boardtools.js', 'blocks/predict.js', 'blocks/scene.js']);
const RAD = new Set([
  'exact.js', 'formula.js', 'graph.js', 'graphspec.js', 'anscheck.js', 'derivedo.js', 'practicespec.js', 'textspec.js', 'matrixspec.js',
  'blocks/answer.js', 'blocks/steps.js', 'blocks/matrix.js', 'blocks/practice.js', 'blocks/letblock.js',
  'check/judge.js', 'check/spec.js', 'codejudge.js', 'render.js', 'stage/value.js', 'algofuncs.js', 'usespec.js',
  'anstypes.js', 'check/values.js', 'blocks/widget.js', 'class/classroom.js', 'exam/drillgen.js', 'exam/verify.js', 'stage/answer.js', 'stepperspec.js',
]);
function callers(dir = 'kit/src', out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { callers(p, out); continue; }
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(p, 'utf8');
    const rel = relative('kit/src', p);
    if (rel === 'expr.js') continue;
    const fromExpr = /from '(\.\.\/)*(\.\/)?(expr|exact)\.js'/.test(src);
    if (!fromExpr) continue;
    const names = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(?:\.\.\/)*(?:\.\/)?(?:expr|exact)\.js'/g)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]));
    if (!names.some((n) => ['compile', 'evaluate', 'calcValue', 'letScope', 'evaluateFloat', 'expandCalc'].includes(n))) continue;
    out.push(rel);
  }
  return out;
}
// 三维图两种都有（视觉第 3 批）：解析在 spacespec.js，经 fx/defs.js 的 compileWith 求值，上面按 import 找不到它，单独守着。
// 老的图（线代）按角度；写了函数定义、微积分命令的图按弧度；angle: 明着定
test('三维图：老的图按角度，微积分的图按弧度', async () => {
  const { parseSpace } = await import('../kit/src/spacespec.js');
  near(parseSpace('vector [cos(60), 0, 0]').cmds[0].expr({})[0], 0.5);
  near(parseSpace('f(x, y) = cos(x)\nvector [f(pi/3, 0), 0, 0]').cmds[0].expr({})[0], 0.5);
  near(parseSpace('angle: rad\nvector [cos(pi/3), 0, 0]').cmds[0].expr({})[0], 0.5);
  const src = readFileSync('kit/src/space.js', 'utf8');
  assert.ok(!/from '\.\/expr\.js'[^\n]*\bcompile\b|import \{[^}]*\bcompile\b[^}]*\} from '\.\/expr\.js'/.test(src), 'space.js 不该自己从 expr.js 拿 compile（角度 / 弧度由 spacespec.js 定）');
  assert.match(src, /parsed\.rad \? undefined : \{ deg: true \}/);
});

test('每个调用的地方都归了类', () => {
  // spacespec.js 两种都有（老的三维图角度、微积分的图弧度），上面那条测试专门守着
  const missing = callers().filter((f) => !DEG.has(f) && !RAD.has(f) && !f.startsWith('fx/') && f !== 'spacespec.js'); // fx/ 下全是弧度（计划 3 的实数取点）
  assert.deepEqual(missing, [], `这些文件用到了求值，要在 tests/expr-rad.test.js 里归进 DEG（画图、角度）或 RAD（答案、弧度）`);
});
