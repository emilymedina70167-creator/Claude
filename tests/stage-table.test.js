// 表（主线第三轮 A）：行名列名、格里能放数 / ∞ / 字 / 短语 / 空着；学生点一格写；老师给了答案的页面逐格比、不当场标
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { TYPES } from '../kit/src/stage/types/index.js';
import { evalMeasure, gestureOf } from '../kit/src/stage/rules.js';
import { askFor } from '../kit/src/stage/gestures.js';

const run = (s, src, extra = {}) => { for (const c of parseScript(src)) s.apply({ ...c, ...extra }); return s; };
const make = (src) => run(new Scene(), src);
const stu = (s, src) => s.apply(parseScript(src)[0], { by: 'student', open: 'edit' });
const D = 'table T = 10 ∞ _ / _ "will have" 能 rows="顶点2 顶点3" cols="第1轮 第2轮 第3轮"';
const cell = (s, r, c, id = 'T') => s.objects.get(id).cells.find((x) => x.r === r && x.c === c);

test('造：数、∞、词、引号里的短语、空着；行名列名；只写 rows= cols= 是全空的表', () => {
  const s = make(D);
  const o = s.objects.get('T');
  assert.deepEqual([o.rows, o.cols, o.rowNames, o.colNames], [2, 3, ['顶点2', '顶点3'], ['第1轮', '第2轮', '第3轮']]);
  assert.deepEqual(o.cells.map((x) => x.value), ['10', '∞', '', '', 'will have', '能']);
  // 造的时候就有值的是给定的格；空着的等填
  assert.deepEqual(o.cells.map((x) => x.given), [true, true, false, false, true, true]);
  const e = make('table E rows="最少 最多" cols="1 2 3 4"').objects.get('E');
  assert.deepEqual([e.rows, e.cols, e.cells.every((x) => x.value === '' && !x.given)], [2, 4, true]);
  // 名字里有空格的用 | 隔
  assert.deepEqual(make('table N rows="at 5 o\'clock|by then" cols="a b"').objects.get('N').rowNames, ["at 5 o'clock", 'by then']);
  // 没写行名列名也行
  assert.deepEqual(make('table P = 1 2 / 3 4').objects.get('P').rowNames, []);
  // 写错的当场报
  assert.match(dryRun(new Scene(), 'table T = 1 2 / 3 rows="a b" cols="x y"')[0].error, /第 2 行有 1 格，第 1 行有 2 格/);
  assert.match(dryRun(new Scene(), 'table T = 1 2 / 3 4 rows="a b c"')[0].error, /rows= 写了 3 个名字，表有 2 行/);
  assert.match(dryRun(new Scene(), 'table T = 1 2 cols="x"')[0].error, /cols= 写了 1 个名字，表有 2 列/);
  assert.match(dryRun(new Scene(), 'table T rows="a"')[0].error, /rows= 和 cols= 都要写/);
  assert.match(dryRun(new Scene(), `table T rows="${Array.from({ length: 11 }, (_, i) => `r${i}`).join(' ')}" cols="a"`)[0].error, /最多 10 行 13 列/);
});

test('部件：T.2,3 一格、T.r2 一行、T.c3 一列；现状照行名列名写一张', () => {
  const s = make(D);
  assert.deepEqual(s.parts('T.2,3').map((p) => p.value), ['能']);
  assert.deepEqual(s.parts('T.r1').map((p) => p.value), ['10', '∞', '']);
  assert.deepEqual(s.parts('T.c2').map((p) => p.value), ['∞', 'will have']);
  assert.match(dryRun(s, 'glow T.3,1')[0].error, /T 是 2 行 3 列的，没有第 3 行/);
  const st = s.stateText();
  assert.match(st, /表 T（2 行 3 列）：/);
  assert.match(st, /列：第1轮｜第2轮｜第3轮/);
  assert.match(st, /顶点2：10｜∞｜□/);
  assert.match(st, /顶点3：□｜will have｜能/);
  assert.match(st, /还空着：顶点2×第3轮、顶点3×第1轮/);
  // 共用的样子照旧
  assert.equal(dryRun(s, 'glow T.r1\npaint T.c2 g1\ndim T.2,3\nlabel n T.1,1 "从这里开始"').length, 0);
});

test('老师：write 写一格（数、字、短语、_ 空出来）、tick / cross / untick、addrow', () => {
  const s = make(D);
  run(s, 'write T.1,3 7\nwrite T.2,1 "不稳定"\nwrite T.1,1 _');
  assert.deepEqual(s.objects.get('T').cells.map((x) => x.value), ['', '∞', '7', '不稳定', 'will have', '能']);
  // 老师写的格是给定的（学生写不了）；空出来的等填
  assert.deepEqual([cell(s, 1, 3).given, cell(s, 1, 1).given], [true, false]);
  run(s, 'tick T.c2\ncross T.2,3\ntick T.r1');
  assert.match(s.stateText(), /打勾：第2轮（列）、顶点2（行）/);
  assert.match(s.stateText(), /打叉：顶点3×第3轮/);
  run(s, 'untick T');
  assert.doesNotMatch(s.stateText(), /打勾|打叉/);
  run(s, 'addrow T "合计" 3 _ 5');
  const o = s.objects.get('T');
  assert.deepEqual([o.rows, o.rowNames.at(-1), s.parts('T.r3').map((p) => p.value)], [3, '合计', ['3', '', '5']]);
  assert.match(dryRun(s, 'addrow T "再一行" 1 2')[0].error, /这一行写了 2 格，表有 3 列/);
  assert.match(dryRun(s, 'write T.1,1')[0].error, /write T\.1,1 7/);
});

test('答案 key=：形状要和表一样；数按数比、字不管空格大小写全角；给定的格、_ 的格不比', () => {
  const K = `${D} key="10 ∞ 7 / 3 _ _"`;
  const s = make(K);
  assert.match(s.stateText(), /答案：收下了（比 2 格/);
  assert.match(dryRun(new Scene(), `${D} key="1 2 / 3 4"`)[0].error, /key= 第 1 行有 2 格，表有 3 列/);
  assert.match(dryRun(new Scene(), `${D} key="1 2 3"`)[0].error, /key= 有 1 行，表有 2 行/);
  const W = make('table W rows="a b" cols="x" key="O(n²) / 不稳定"\nopen W edit input=text');
  stu(W, 'write W.1,1 "o(n²)"');
  stu(W, 'write W.2,1 " 不稳定 "');
  assert.equal(evalMeasure(W, 'wrong(W)').value, 0);
  stu(s.clone(), 'write T.1,3 7.0');
});

test('学生点一格写：键盘（有 ∞）/ 输入框 / 一排选项；给定的格写不了；页面不当场标，事实里说和答案一不一样', () => {
  const s = make(`${D} key="10 ∞ 7 / 3 _ _"\nopen T edit`);
  const o = s.objects.get('T');
  const g = gestureOf(o, 'edit');
  const e = s.opens.get('T:edit');
  assert.equal(g.gesture, 'write');
  assert.deepEqual([askFor(g, o, 'write', { to: cell(s, 1, 3) }, e).input, askFor(g, o, 'write', { to: cell(s, 1, 3) }, e).extra], ['keypad', '∞']);
  assert.deepEqual(g.toAct(o, { to: cell(s, 1, 3), value: '7' }), { act: { type: 'write', key: '1.3', value: '7' }, src: 'write T.1,3 7' });
  assert.match(g.toAct(o, { to: cell(s, 1, 1), value: '7' }).error, /给定的/);
  assert.match(g.toAct(o, { to: cell(s, 1, 3), value: 'abc' }).error, /不是数/);
  // 学生的一下：照做、不判对错（right 是 null），做了什么和答案比的结果在话里
  const a = stu(s, 'write T.1,3 8');
  assert.deepEqual([a.judged.verdict.legal, a.judged.verdict.right], [true, null]);
  assert.match(a.judged.verdict.why, /顶点2×第3轮 写了 8，和答案不一样（答案是 7）/);
  assert.equal(cell(s, 1, 3).by, 'student');
  // 学生自己写过的能再改
  const b = stu(s, 'write T.1,3 7');
  assert.match(b.judged.verdict.why, /顶点2×第3轮 写了 7（原来是 8），和答案一样/);
  // 写满了：事实里说一声、算做完
  const c = stu(s, 'write T.2,1 4');
  assert.match(c.judged.after.join('；'), /写满了：比的 2 格里 1 格和答案不一样：顶点3×第1轮（写了 4，答案是 3）/);
  assert.deepEqual(c.done, ['T']);
  // 不当场标：wrong= 当场报
  assert.match(dryRun(make(D), 'open T edit wrong=mark')[0].error, /wrong=/);
  // 输入框、选项
  const t = make(`${D}\nopen T edit input=text`);
  assert.equal(askFor(gestureOf(t.objects.get('T'), 'edit'), t.objects.get('T'), 'write', { to: cell(t, 1, 3) }, t.opens.get('T:edit')).input, 'text');
  assert.equal(gestureOf(t.objects.get('T'), 'edit').toAct(t.objects.get('T'), { to: cell(t, 1, 3), value: 'will be doing', open: t.opens.get('T:edit') }).src, 'write T.1,3 "will be doing"');
  const p = make(`${D}\nopen T edit choices="能 不能"`);
  const ask = askFor(gestureOf(p.objects.get('T'), 'edit'), p.objects.get('T'), 'write', { to: cell(p, 1, 3) }, p.opens.get('T:edit'));
  assert.deepEqual([ask.pick, ask.choices.map((x) => x.value)], [true, ['能', '不能']]);
  assert.equal(gestureOf(p.objects.get('T'), 'edit').toAct(p.objects.get('T'), { to: cell(p, 1, 3), role: '不能', open: p.opens.get('T:edit') }).src, 'write T.1,3 "不能"');
  assert.match(dryRun(make(D), 'open T edit choices="能"')[0].error, /至少两个/);
  assert.match(dryRun(make(D), 'open T edit input=text choices="a b"')[0].error, /只能写一个/);
  // 只开一列
  assert.equal(dryRun(make(D), 'open T.c3 edit').length, 0);
});

test('量 blank / wrong，判断式 T full / T right；写满了演预写的 @T.done', () => {
  const s = make(`${D} key="10 ∞ 7 / 3 _ _"\nopen T edit\ngoal g1 "填对" when="T right"\n@T.done say "填完了，对一下。"`);
  assert.deepEqual([evalMeasure(s, 'blank(T)').value, evalMeasure(s, 'wrong(T)').value], [2, 0]);
  assert.match(s.stateText(), /页面算的：blank\(T\) = 2，wrong\(T\) = 0/);
  stu(s, 'write T.1,3 8');
  assert.equal(evalMeasure(s, 'wrong(T)').value, 1);
  assert.match(s.stateText(), /和答案不一样：顶点2×第3轮（写了 8，答案是 7）/);
  const fx = stu(s, 'write T.2,1 3');
  assert.deepEqual(fx.reactions.map((r) => r.src), ['say "填完了，对一下。"']);
  assert.equal(s.goals.get('g1').met, false);
  const f2 = stu(s, 'write T.1,3 7');
  assert.deepEqual(f2.goalsMet, ['g1']);
  // 没写答案的表没有 wrong、T right 当场报
  assert.equal(evalMeasure(make(D), 'wrong(T)').never, true);
  assert.match(dryRun(make(D), 'goal g "x" when="T right"')[0].error, /没写 key=/);
  assert.equal(dryRun(make(`${D}\nopen T edit`), 'goal g "x" when="T full"').length, 0);
});

test('克隆、重放一样；说明里的例子照抄能演；六门课都带表', async () => {
  const src = `${D} key="10 ∞ 7 / 3 _ _"\nopen T edit\ntick T.c1`;
  const a = make(src);
  stu(a, 'write T.1,3 8');
  const b = run(new Scene(), src, { lenient: true, replay: true });
  b.apply({ ...parseScript('write T.1,3 8')[0], lenient: true, replay: true }, { by: 'student', open: 'edit' });
  assert.equal(JSON.stringify(a.objects.get('T')), JSON.stringify(b.objects.get('T')));
  assert.equal(JSON.stringify(a.clone().objects.get('T')), JSON.stringify(a.objects.get('T')));
  assert.deepEqual(dryRun(new Scene(), TYPES.table.example), []);
  const { SUBJECT_TYPES } = await import('../kit/src/stage/doc.js');
  for (const [k, v] of Object.entries(SUBJECT_TYPES)) assert.ok(v.includes('table'), k);
  assert.doesNotMatch(TYPES.table.doc + TYPES.table.hint + TYPES.table.example, /[他她]/);
});
