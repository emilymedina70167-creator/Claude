// 活的舞台（docs/stage-plan.md E 段）：开放给学生直接动、乘积跟着重算、挑战当场判、做到了马上交出预写的行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { parseGoal, evalGoal } from '../kit/src/stage/goal.js';
import { registerRules } from '../kit/src/stage/rules.js';

const run = (sc, src) => { const out = []; for (const c of parseScript(src)) out.push(sc.apply(c)); return out; };
const setup = () => {
  const sc = new Scene();
  run(sc, `matrix A = 1 1 / -1 -1
matrix B = 1 -1 / -1 1 beside=A
product C = A B
mul C
matrix B2 = 1 -1 / -1 1
product D = B A`);
  return sc;
};

test('条件的写法：逗号连着的几句（部件里的逗号不拆）、比较符号、sorted', () => {
  assert.deepEqual(parseGoal('C = O, D != O'), [{ l: 'C', op: '=', r: 'O' }, { l: 'D', op: '!=', r: 'O' }]);
  assert.deepEqual(parseGoal('B.1,2 ≥ 0 且 a sorted desc'), [{ l: 'B.1,2', op: '>=', r: '0' }, { l: 'a', sorted: 'desc' }]);
  assert.deepEqual(parseGoal('C=O,D≠O'), [{ l: 'C', op: '=', r: 'O' }, { l: 'D', op: '!=', r: 'O' }]);
  assert.throws(() => parseGoal(''), /when=/);
  assert.throws(() => parseGoal('C 是零'), /看不懂/);
});

test('判：零矩阵、单位矩阵、两个矩阵一样不一样、一格的大小；还空着的格两边都不成立', () => {
  const sc = setup();
  assert.equal(evalGoal(sc, parseGoal('C = O')), true);
  assert.equal(evalGoal(sc, parseGoal('C != O')), false);
  // D 还空着：D = O、D != O 都不成立
  assert.equal(evalGoal(sc, parseGoal('D = O')), false);
  assert.equal(evalGoal(sc, parseGoal('D != O')), false);
  assert.equal(evalGoal(sc, parseGoal('B = B2')), true);
  assert.equal(evalGoal(sc, parseGoal('A != B')), true);
  assert.equal(evalGoal(sc, parseGoal('A.1,1 = 1, B.1,2 < 0')), true);
  assert.equal(evalGoal(sc, parseGoal('A.1,1 > 1')), false);
  run(sc, 'matrix E = 1 0 / 0 1');
  assert.equal(evalGoal(sc, parseGoal('E = I')), true);
  assert.throws(() => evalGoal(sc, parseGoal('C = 3')), /不能和一个数比/);
  assert.throws(() => evalGoal(sc, parseGoal('Z = O')), /不是舞台上的东西/);
});

test('一排格子：sorted、一组部件都要成立', () => {
  const sc = new Scene();
  run(sc, 'array a = 3 1 2');
  assert.equal(evalGoal(sc, parseGoal('a sorted')), false);
  run(sc, 'swap a.1 a.2');
  run(sc, 'swap a.2 a.3');
  assert.equal(evalGoal(sc, parseGoal('a sorted')), true);
  assert.equal(evalGoal(sc, parseGoal('a.1-3 > 0')), true);
});

test('乘积跟着重算：算出来的格在 A、B 变了以后马上变（交出变了的格），手写的格不动、空着的照旧空着', () => {
  const sc = setup();
  const [fx] = run(sc, 'write B.1,1 2');
  const C = sc.objects.get('C');
  assert.deepEqual(C.cells.map((x) => x.value), ['1', '0', '-1', '0']);
  assert.ok(fx.derived.length === 2 && fx.derived.every((d) => d.part.obj === 'C'));
  assert.equal(sc.objects.get('D').cells.every((x) => x.value === ''), true);
  run(sc, 'write C.1,1 7');
  run(sc, 'write B.1,1 3');
  assert.equal(C.cells.find((x) => x.key === '1.1').value, '7');
  assert.match(sc.stateText(), /算出来的 3 格跟着 A、B 自动重算/);
});

test('open / close：能开放的动作、乘积只能 explain、一排格子能 drag；写在舞台现状里', () => {
  const sc = setup();
  run(sc, 'open B edit range=-3..3\nopen C explain');
  assert.deepEqual(sc.opens.get('B:edit'), { obj: 'B', action: 'edit', refs: [], lo: -3, hi: 3 });
  assert.match(sc.stateText(), /学生能直接动的：B edit（点一格，拨里面的数，-3～3）；C explain/);
  assert.match(dryRun(sc, 'open C edit')[0].error, /是乘积/);
  assert.match(dryRun(sc, 'open A explain')[0].error, /不是乘积/);
  assert.match(dryRun(sc, 'open A fly')[0].error, /能开放的是：edit/);
  run(sc, 'close B');
  assert.equal(sc.opens.has('B:edit'), false);
  run(sc, 'array a = 3 1 2\nopen a');
  assert.equal(sc.opens.get('a:drag').action, 'drag');
  run(sc, 'remove a');
  assert.equal(sc.opens.has('a:drag'), false);
});

test('挑战：写下就已经成立的不收；做到的那一行交出 goalsMet 和预写的行（一次就交出去，replay 也一样）；做到了就一直算做到', () => {
  const sc = setup();
  assert.match(dryRun(sc, 'goal g0 "x" when="C = O"')[0].error, /现在就已经成立/);
  assert.match(dryRun(sc, '@g9 say "对"')[0].error, /先写 goal g9/);
  run(sc, `goal g1 "让 AB 不再是 O" when="C != O"
@g1 say "对，{C.1,1} 不是 0 了。"
@g1 goal g2 "再让 AB 变回 O" when="C = O"`);
  assert.equal(sc.reactions.get('g1').length, 2);
  assert.match(sc.stateText(), /挑战 g1「让 AB 不再是 O」when="C != O"：还没做到（C != O ✗）；做到了页面马上演你预写的 2 行/);
  const [fx] = run(sc, 'write B.1,1 2');
  assert.deepEqual(fx.goalsMet, ['g1']);
  assert.deepEqual(fx.reactions.map((r) => r.src), ['say "对，{C.1,1} 不是 0 了。"', 'goal g2 "再让 AB 变回 O" when="C = O"']);
  assert.equal(sc.reactions.has('g1'), false);
  const [again] = run(sc, 'write B.1,1 1');
  assert.equal(again.goalsMet, undefined);
  assert.equal(sc.goals.get('g1').met, true);
  assert.match(dryRun(sc, '@g1 say "x"')[0].error, /已经做到了/);
});

test('@ 的行写错了当场挡下（连着前面记着的一起试）', () => {
  const sc = setup();
  run(sc, 'goal g1 "x" when="C != O"\n@g1 matrix E = 1 0 / 0 1');
  assert.deepEqual(dryRun(sc, '@g1 product F = A E'), []);
  assert.match(dryRun(sc, '@g1 swap E.1')[0].error, /./);
  assert.match(parseScript('@ say "x"')[0].error, /@挑战的名字/);
});

test('49′ 不等于 49；比大小、sorted 照旧按数', () => {
  const sc = new Scene();
  run(sc, 'array a = 13 49 49′ 65');
  assert.equal(evalGoal(sc, parseGoal('a.3 = 49')), false);
  assert.equal(evalGoal(sc, parseGoal('a.3 != 49')), true);
  assert.equal(evalGoal(sc, parseGoal('a.3 = 49′')), true);
  assert.equal(evalGoal(sc, parseGoal('a.2 = 49')), true);
  assert.equal(evalGoal(sc, parseGoal('a.3 >= 49')), true);
  assert.equal(evalGoal(sc, parseGoal('a sorted')), true);
});

test('每种东西的判断式：名字 判断式 参数；写错了报能写哪些；判不了算没成立', () => {
  registerRules('array', { predicates: { even: (o) => o.cells.every((c) => Number(c.value) % 2 === 0), atLeast: (o, [k]) => o.cells.length >= Number(k), unknown: () => null } });
  const sc = new Scene();
  run(sc, 'array x = 2 4\narray y = 2 3');
  assert.deepEqual(parseGoal('x atLeast=2, y even'), [{ l: 'x', pred: 'atLeast', args: ['2'] }, { l: 'y', pred: 'even', args: [] }]);
  assert.equal(evalGoal(sc, parseGoal('x even')), true);
  assert.equal(evalGoal(sc, parseGoal('y even')), false);
  assert.equal(evalGoal(sc, parseGoal('x atLeast 2')), true);
  assert.equal(evalGoal(sc, parseGoal('x atLeast=3')), false);
  assert.equal(evalGoal(sc, parseGoal('x unknown')), false);
  assert.throws(() => evalGoal(sc, parseGoal('x odd')), /没有判断式「odd」，能写：even、atLeast、unknown/);
  assert.throws(() => run(sc, 'goal g1 "让 x 是奇数" when="x odd"'), /能写：even/);
  assert.equal(run(sc, 'goal g2 "让 y 都是偶数" when="y even"').length, 1);
});

test('预写的挑战，条件每一句都在触发它的挑战里：g1 一做到它就成立，当场报错；条件不同的照收；重放不查', () => {
  const sc = setup();
  run(sc, 'goal g1 "让 AB 不是 O" when="D != O, C = O"');
  assert.throws(() => run(sc, '@g1 goal g2 "再来" when="C = O, D != O"'), /挑战 g2 的条件在 g1 做到时就已经成立了/);
  assert.throws(() => run(sc, '@g1 goal g2 "再来" when="D!=O"'), /学生不用再动手/);
  run(sc, '@g1 goal g2 "再来" when="D != O, A != B"');
  assert.equal(sc.reactions.get('g1').length, 1);
  assert.doesNotThrow(() => sc.apply({ ...parseScript('@g1 goal g4 "再来" when="C = O"')[0], lenient: true }));
});
