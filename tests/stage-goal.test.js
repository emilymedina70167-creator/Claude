// 活的舞台（docs/stage-plan.md E 段）：开放给学生直接动、乘积跟着重算、挑战当场判、做到了马上交出预写的行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { parseGoal, evalGoal, goalStatus } from '../kit/src/stage/goal.js';
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
  // 多了老师事先定的 policy（没写就是默认：照做、只记下）和手势表里的那一项（第 8 个任务）；第二轮多了 seq（第几个开的）
  const e = sc.opens.get('B:edit');
  assert.deepEqual({ ...e, gesture: e.gesture?.gesture }, { obj: 'B', action: 'edit', refs: [], lo: -3, hi: 3, policy: { wrong: 'quiet', call: null, undo: false }, gesture: 'write', seq: 1 });
  assert.equal(sc.opens.get('C:explain').seq, 2);
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
  // 学生的一下（第二轮起预写的行只在学生的一下演，老师的一下拿掉不演）
  const fx = sc.apply(parseScript('write B.1,1 2')[0], { by: 'student' });
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

// —— 整条分支的最终审查（I4、M2）——
const one = (src) => parseScript(src)[0];

test('I4 永远判不了的挑战写下时就报：句子没写 key、key 作废了；判断式的参数写错（预写里也查）；乘积还空着这种之后会有的照收', () => {
  const s = new Scene();
  run(s, 'sentence s = "The man is a doctor."\nopen s mark');
  assert.match(s.check(one('goal g1 "拆完" when="s parsed"')) || '', /s 没写 key=.*页面判不了/);
  assert.match(s.check(one('goal g2 "主干" when="s main"')) || '', /s 没写 key=/);
  assert.equal(s.check(one('goal g3 "谓语" when="s span s.3 = V"')), null, '不靠 key 的照收');
  const k = new Scene();
  run(k, 'sentence s = "The man is a doctor." key="[S The man] [V is] [P a doctor]."\nrewrite s "The men are doctors."');
  assert.match(k.check(one('goal g1 "拆完" when="s parsed"')) || '', /作废/);
  // 预写里的挑战也查（以前预写的那一份不跑判断式，写错了也照收）
  const t = new Scene();
  run(t, 'tree t = 50 30 70\ngoal g1 "长高" when="t height=4"');
  assert.match(t.check(one('@g1 goal g2 "再长" when="t height=abc"')) || '', /height 要写树有几层/);
  // 乘积还空着：判不了（null），之后算出来就判得了，照收
  const m = new Scene();
  run(m, 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nproduct C = A B');
  assert.equal(m.check(one('goal g1 "C 是阶梯形" when="C stairs"')), null);
  // 重放旧课：当时收下的照样收下
  assert.doesNotThrow(() => s.apply({ ...one('goal g1 "拆完" when="s parsed"'), lenient: true }));
});

test('I4 舞台现状：判不了的那一句写「判不了」，不写 ✗；后来作废了的写原因', () => {
  const m = new Scene();
  run(m, 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nproduct C = A B\ngoal g1 "C 是阶梯形" when="C stairs"');
  assert.match(m.stateText(), /还没做到（C stairs 判不了）/);
  const k = new Scene();
  run(k, 'sentence s = "The man is a doctor." key="[S The man] [V is] [P a doctor]."\nopen s mark\ngoal g1 "拆完" when="s parsed"\nrewrite s "The men are doctors."');
  assert.match(k.stateText(), /还没做到（s parsed 判不了：s 的 key 跟着 rewrite 作废了/);
});

test("M2 比一格：ASCII 的 ' 和 ′ 一样是撇（49' 不是 49）", () => {
  const sc = new Scene();
  run(sc, "array a = 49 38 49' 13");
  run(sc, `goal g2 "y" when="a.4 = 49'"`);
  run(sc, 'swap a.1 a.4');
  assert.equal(sc.goals.get('g2').met, false, '换过去的是不带撇的 49');
  run(sc, 'swap a.3 a.4');
  assert.equal(sc.goals.get('g2').met, true);
  assert.equal(evalGoal(sc, parseGoal("a.4 = 49′")), true, '两种撇写法一样');
});

// 王道综合题 03 转平以后的树（34 23 15 98 115 28 107 依次插）
const AVL7 = 'tree t = 34 23 107 15 28 98 115';
const status = (sc, when) => goalStatus(sc, { cond: parseGoal(when), met: false });

test('挑战里写量：count(t) = 7 和判断式写在一起', () => {
  assert.deepEqual(parseGoal('count(t) = 7, t avl'), [{ l: 'count(t)', op: '=', r: '7' }, { l: 't', pred: 'avl', args: [] }]);
  assert.deepEqual(parseGoal('height( t.50 ) >= 2'), [{ l: 'height(t.50)', op: '>=', r: '2' }], '括号里的空格不碍事');
  const four = new Scene();
  run(four, 'tree t = 50 30 70 20');
  assert.match(status(four, 'count(t) = 7, t avl'), /count\(t\) = 7 ✗/);
  assert.equal(evalGoal(four, parseGoal('count(t) = 7, t avl')), false);
  const seven = new Scene();
  run(seven, AVL7);
  assert.equal(evalGoal(seven, parseGoal('count(t) = 7, t avl, height(t) = 3')), true);
  assert.equal(evalGoal(seven, parseGoal('height(t.107) < height(t)')), true, '两边都能写量');
  // 学生插到 7 个就做到
  run(four, 'goal g1 "插到 7 个" when="count(t) = 7"');
  run(four, 'insert t 10\ninsert t 40');
  assert.equal(four.goals.get('g1').met, false);
  const fx = four.apply(parseScript('insert t 60')[0]);
  assert.deepEqual(fx.goalsMet, ['g1']);
});

test('量判不了（写下以后 key 作废了、乘积还空着、重放旧课）：挑战写「判不了」不写 ✗，也不算做到', () => {
  // 写下时 key 还在（数得了），后来 rewrite 把 key 作废了
  const sc = new Scene();
  run(sc, 'sentence s = "The man is a doctor." key="[S The man] [V is] [P a doctor]."\ngoal g1 "找出谓语" when="verbs(s) = 2"\nrewrite s "The men are doctors."');
  const g = sc.goals.get('g1');
  assert.match(goalStatus(sc, g), /verbs\(s\) = 2 判不了：s 的 key 跟着 rewrite 作废了/);
  assert.doesNotMatch(goalStatus(sc, g), /✗/);
  assert.equal(evalGoal(sc, g.cond), false);
  assert.deepEqual(sc.checkGoals(), []);
  assert.equal(g.met, false);
  const m = new Scene();
  run(m, 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nproduct C = A B\ngoal g1 "C 满秩" when="rank(C) = 2"');
  const h = m.goals.get('g1');
  assert.match(goalStatus(m, h), /rank\(C\) = 2 判不了：C 还有空着的格/);
  assert.doesNotMatch(goalStatus(m, h), /✗/);
  assert.equal(evalGoal(m, h.cond), false);
  assert.deepEqual(m.checkGoals(), []);
  assert.match(m.stateText(), /挑战 g1「C 满秩」when="rank\(C\) = 2"：还没做到（rank\(C\) = 2 判不了：C 还有空着的格）/);
  // 算出来以后照常判
  run(m, 'mul C');
  assert.equal(h.met, true);
  // 重放旧课（lenient）：当时收下的照样收下，没写 key 的也是「判不了」
  const r = new Scene();
  run(r, 'sentence s2 = "The man is a doctor."');
  r.apply({ ...one('goal g1 "找出谓语" when="verbs(s2) = 1"'), lenient: true });
  assert.match(goalStatus(r, r.goals.get('g1')), /verbs\(s2\) = 1 判不了：s2 没写 key/);
  assert.deepEqual(r.checkGoals(), []);
});

test('以后也数不了的量写下挑战时当场报（第一轮 I4 的规矩）：增广矩阵、不是方阵的 det，没写 key 的句子；还空着的照收', () => {
  const sc = new Scene();
  run(sc, 'matrix M = 1 2 | 1 / 2 4 | -1\nmatrix N = 1 2 3 / 4 5 6\nsentence s2 = "The man is a doctor."\nmatrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nproduct C = A B');
  assert.match(sc.check(one('goal g1 "x" when="det(M) = 0"')) || '', /「det\(M\)」页面数不了，以后也数不了：M 没有 det（不是方阵，或者是增广矩阵）/);
  assert.match(sc.check(one('goal g1 "x" when="det(N) = 0"')) || '', /以后也数不了/);
  assert.match(sc.check(one('goal g1 "x" when="verbs(s2) = 1"')) || '', /以后也数不了：s2 没写 key/);
  assert.match(sc.check(one('goal g1 "x" when="rank(M.r1) = 1"')) || '', /以后也数不了：M\.r1 没有 rank/);
  assert.equal(sc.check(one('goal g1 "C 满秩" when="rank(C) = 2"')), null, '还空着：之后数得了');
  assert.equal(sc.check(one('goal g1 "C 可逆" when="det(C) != 0"')), null, '方阵还空着：之后数得了');
});

test('量写错当场报：这种东西没有这个量、舞台上没有这样东西', () => {
  const sc = new Scene();
  run(sc, 'tree t = 50 30 70');
  assert.match(sc.check(one('goal g1 "长高" when="size(t) = 3"')) || '', /能写：count、height、tray/);
  assert.match(sc.check(one('goal g1 "长高" when="count(q) = 3"')) || '', /舞台上没有「q」/);
  assert.match(sc.check(one('goal g1 "长高" when="height(t.99) = 3"')) || '', /没有值是 99 的结点/);
  assert.match(sc.check(one('goal g1 "长高" when="count(t) = 3"')) || '', /现在就已经成立了/, '量算得出来，照旧查一写下就成立的');
  assert.equal(sc.check(one('goal g1 "长高" when="count(t) = 4"')), null);
});

test('「或」：| 隔开几组，有一组都成立就算做到；只满足一组的半边不算；goalStatus 一组一组写', async () => {
  const { parseWhen, evalWhen } = await import('../kit/src/stage/goal.js');
  const when = 'k.1 = 3, k.2 = 1 | k.1 = 4, k.2 = 2';
  const alts = parseWhen(when);
  assert.equal(alts.length, 2);
  assert.deepEqual(alts[0], parseGoal('k.1 = 3, k.2 = 1'));
  assert.deepEqual(parseWhen('C = O'), [parseGoal('C = O')], '没有 | 就是一组');
  const at = (vals) => { const sc = new Scene(); run(sc, `array k = ${vals}`); return sc; };
  assert.equal(evalWhen(at('1 2 3 4'), alts), false);
  assert.equal(evalWhen(at('3 1 2 4'), alts), true, '照第一组换出来的');
  assert.equal(evalWhen(at('4 2 3 1'), alts), true, '照第二组换出来的');
  assert.equal(evalWhen(at('3 2 1 4'), alts), false, '只满足第一组的半边');
  assert.equal(evalWhen(at('1 2 3 4'), parseWhen('k.1 = 9 | k sorted')), true);
  assert.throws(() => parseWhen('k.1 = 3 |'), /\| 两边都要写条件/);
  const sc = at('3 2 1 4');
  run(sc, `goal g1 "换两格" when="${when}"`);
  assert.equal(goalStatus(sc, sc.goals.get('g1')), '还没做到（k.1 = 3 ✓，k.2 = 1 ✗ | k.1 = 4 ✗，k.2 = 2 ✓）');
});

test('复核：「或」里有一组判不了（那样东西拿掉了），别的组照样判得做到；写下时哪一组写错照样当场报', async () => {
  const { parseWhen, evalWhen } = await import('../kit/src/stage/goal.js');
  const sc = new Scene();
  run(sc, 'array k = 2 1 3\nopen k\ntree t = 30 20 _ 10\ngoal g1 "排好或者平衡" when="t avl | k sorted"\nremove t');
  assert.equal(evalWhen(sc, parseWhen('t avl | k sorted')), false);
  const fx = sc.apply(parseScript('swap k.1 k.2')[0], { by: 'student', open: 'drag' });
  assert.deepEqual(fx.goalsMet, ['g1']);
  assert.equal(goalStatus(sc, sc.goals.get('g1')), '做到了');
  assert.throws(() => run(new Scene(), 'matrix A = 1 0 / 0 1\nmatrix B = 1 2 / 3 4\ngoal g1 "x" when="A < B | A = B"'), /整个东西只能比一样不一样/);
});

test('复核：重放旧课（lenient）时挑战那一行新加的检查不报：call=、n=、on=""、| 两边空着照收', () => {
  for (const line of ['goal g1 "排好" when="k sorted" call=done', 'goal g1 "排好" when="k sorted" n=3', 'goal g1 "排好" when="k sorted" on=""']) {
    const s = new Scene();
    run(s, 'array k = 2 1 3\nopen k');
    assert.doesNotThrow(() => s.apply({ ...parseScript(line)[0], lenient: true, replay: true }), line);
    assert.ok(s.goals.has('g1'), line);
    assert.equal(s.goals.get('g1').call, null);
    assert.equal(s.goals.get('g1').on, null);
    assert.match(s.check(parseScript(line)[0]) || '', /./, `新写的照样报：${line}`);
  }
});
