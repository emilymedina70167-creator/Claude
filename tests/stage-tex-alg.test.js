// 照代数写、学生能动手的式子（tex … alg=on）：拖项换顺序、合并同类项、展开括号，合不合法由 ncalg.js 判
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { algParse, algShown, algLatex, reorder, merge, expand, isExpanded, isMerged, sameForm } from '../kit/src/stage/types/tex.alg.js';
import { gestureAct } from '../kit/src/stage/gestures.js';

const run = (s, src) => { let fx; for (const c of parseScript(src)) fx = s.apply(c); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const stu = (s, line, open) => s.apply(parseScript(line)[0], { by: 'student', open });
const shown = (s, id = 'e') => algShown(s.objects.get(id).alg);

test('拆项：一项一个因子是 t1，几个因子的每个因子是部件；画成带 \\hl 的 KaTeX', () => {
  const a = algParse('A^2 + 2AB - BA');
  assert.deepEqual(a.items.map((it) => [it.key, it.sign, it.factors.map((f) => f.key)]), [['t1', 1, ['t1']], ['t2', 1, ['t2f1', 't2f2', 't2f3']], ['t3', -1, ['t3f1', 't3f2']]]);
  assert.equal(algShown(a), 'A^2 + 2AB - BA');
  assert.match(algLatex(a), /\\hl\{t1\}\{A\^\{2\}\} \+ \\hl\{t2f1\}\{2\}/);
  assert.throws(() => algParse('A^-1 A'), /逆/);
});

test('展开、换顺序、合并（纯函数）', () => {
  let a = algParse('(A+B)(A+B)');
  const e = expand(a, 't1');
  assert.equal(algShown(e.alg), 'A^2 + AB + BA + B^2');
  assert.equal(expand(e.alg, 't2').error, '这一项没有括号可展开');
  a = e.alg;
  assert.equal(algShown(reorder(a, 't5', 't2').alg), 'B^2 + A^2 + AB + BA');
  assert.equal(reorder(a, 't2', 't3').quiet, true); // 还在原处
  assert.match(merge(a, 't3', 't4').error, /不是同类项/);
  const b = algParse('2AB - AB + BA');
  assert.equal(algShown(merge(b, 't1', 't2').alg), 'AB + BA');
  assert.equal(algShown(merge(algParse('AB - AB + C'), 't1', 't2').alg), 'C');
  assert.equal(isExpanded(a), true);
  assert.equal(isMerged(a), true);
  assert.equal(isMerged(algParse('ab + ba')), false); // 标量交换：同类项
  assert.equal(sameForm(a, 'A^2+AB+BA+B^2'), true);
  assert.equal(sameForm(a, 'A^2+BA+AB+B^2'), false);
});

test('学生的一下先过裁判：矩阵的因子换先后、AB 和 BA 合并弹回去，说为什么；加法换顺序、标量换先后照做', () => {
  const s = make('tex e = "(A+B)(A+B)" alg=on\nopen e move\nopen e expand');
  assert.ok(!stu(s, 'expand e t1', 'expand').blocked);
  assert.equal(shown(s), 'A^2 + AB + BA + B^2');
  const sw = stu(s, 'reorder e t3f2 t3f1', 'move');
  assert.equal(sw.blocked, true);
  assert.match(sw.judged.verdict.why, /矩阵乘法不交换/);
  const mg = stu(s, 'merge e t3 t4', 'move');
  assert.equal(mg.blocked, true);
  assert.match(mg.judged.verdict.why, /AB 和 BA 不是同类项/);
  assert.equal(shown(s), 'A^2 + AB + BA + B^2', '弹回去了：式子没变');
  assert.ok(!stu(s, 'reorder e t5 t2', 'move').blocked);
  assert.equal(shown(s), 'B^2 + A^2 + AB + BA');
  // 标量：k 和 A 能换先后
  const k = make('tex f = "kA + B" alg=on\nopen f move');
  assert.ok(!stu(k, 'reorder f t1f2 t1f1', 'move').blocked);
  assert.equal(shown(k, 'f'), 'Ak + B');
  // 判不了：含逆的式子造不出来（alg=on 照代数写，读不懂当场报）
  assert.throws(() => run(new Scene(), 'tex g = "A^-1 A" alg=on'), /逆/);
});

test('手势翻成一行：拖到空隙 = reorder，拖到另一项 = merge，同一项里的因子拖到另一个因子上 = 换先后，点一项 = expand', () => {
  const s = make('tex e = "A^2 + AB + BA + B^2" alg=on\nopen e move\nopen e expand');
  const e = s.opens.get('e:move');
  const p = (k) => s.partOf('e', k);
  assert.equal(gestureAct(s, e, { from: p('t4'), to: { gap: { level: 'sum', before: 't1' } } }).src, 'reorder e t4 t1');
  assert.equal(gestureAct(s, e, { from: p('t2f1'), to: { gap: { level: 'sum', before: null } } }).src, 'reorder e t2 end');
  assert.equal(gestureAct(s, e, { from: p('t3f2'), to: p('t2f1') }).src, 'merge e t2 t3');
  assert.equal(gestureAct(s, e, { from: p('t2f2'), to: p('t2f1') }).src, 'reorder e t2f2 t2f1');
  assert.equal(gestureAct(s, e, { from: p('t2f1'), to: p('t2f2') }).src, 'reorder e t2f1 end');
  assert.equal(gestureAct(s, s.opens.get('e:expand'), { from: p('t1') }).src, 'expand e t1');
});

test('判断式和现状：e expanded / merged / same= / equals=；没写 alg=on 的式子交不给学生', () => {
  const s = make('tex e = "(A+B)^2" alg=on\nopen e expand');
  assert.throws(() => run(s, 'goal g0 "x" when="e expanded"\nungoal g0\ngoal g1 "y" when="e equals=A^2+AB+BA+B^2"'), /现在就已经成立/);
  run(s, 'goal g2 "照先后写出四项" when="e same=A^2+AB+BA+B^2"');
  const fx = stu(s, 'expand e t1', 'expand');
  assert.deepEqual(fx.goalsMet, ['g2']);
  assert.match(s.stateText(), /项：1\. \+A\^2（e\.t2）；2\. \+A·B（e\.t3f1 e\.t3f2）/);
  assert.match(s.stateText(), /现在：A\^2 \+ AB \+ BA \+ B\^2（照代数写，alg=on）/);
  assert.throws(() => run(make('tex f = "\\hl{a}{x}"'), 'open f move'), /不是照代数写的式子/);
});

test('@e.miss：学生走偏（被弹回）时演（prewrite: all）', () => {
  const s = new Scene();
  s.prewriteAll = true;
  run(s, 'tex e = "AB + BA" alg=on\nopen e move\n@e.miss say "AB 和 BA 能合并吗？"');
  const j = s.judgeLine(parseScript('merge e t1 t2')[0], { by: 'student', open: 'move' });
  assert.equal(j.apply, false);
  assert.deepEqual(s.slipReactions('e', j.verdict, { blocked: true }).map((r) => r.src), ['say "AB 和 BA 能合并吗？"']);
});
