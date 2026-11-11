// 排序的对应关系（kit/src/stage/follows/sort.js）：黑板的排序引擎接到一排格子上。算法的知识全在引擎里，这里只验对应得上
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { evalMeasure } from '../kit/src/stage/rules.js';
import { whereOf } from '../kit/src/stage/follow.js';

const run = (s, src, opt) => { let fx; for (const c of parseScript(src)) fx = s.apply(c, opt); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const stu = (s, src) => s.apply(parseScript(src)[0], { by: 'student', open: 'move' });
const said = (fx) => [...(fx.judged?.facts || []), ...(fx.judged?.after || [])].join('\n');
const WD = "array a = 49 38 65 97 76 13 27 49′";

test('希尔：现状里有每一趟做完该是什么样；学生照自己的先后理三条链，中间不判，理完到检查点', () => {
  const s = make(`${WD}\nfollow a sort shell gaps="5 3 1"\nopen a move`);
  assert.match(s.stateText(), /a 照 希尔排序（增量 5 3 1） 走：还没做完第 1 趟（共 3 趟）。第 1 趟做完该是：13 27 49′ 97 76 49 38 65/);
  let fx = stu(s, 'swap a#3 a#8'); // 65 ↔ 49′：引擎先动的是 49 ↔ 13
  assert.equal(fx.judged.verdict.right, null);
  assert.match(said(fx), /和第 1 趟做完该有的样子差 4 格：/);
  stu(s, 'swap a#1 a#6');
  fx = stu(s, 'swap a#2 a#7');
  assert.equal(fx.judged.verdict.right, true);
  assert.match(said(fx), /到了第 1 趟做完的样子（和引擎算的一样）/);
  assert.equal(evalMeasure(s, 'pass(a)').value, 1);
  assert.match(s.stateText(), /做完了第 1 趟（共 3 趟）。第 2 趟做完该是：13 27 49′ 38 65 49 97 76/);
});

test('希尔：做成引擎认得的错法（把相邻的分成一组）的第 1 趟——说像哪种', () => {
  const s = make(`${WD}\nfollow a sort shell gaps="5 3 1"\nopen a move`);
  stu(s, 'swap a#1 a#2'); // 38 49 …
  const fx = stu(s, 'swap a#5 a#6'); // … 13 76 27 49′：相邻分组的第 1 趟
  assert.equal(fx.judged.verdict.right, false);
  assert.match(fx.judged.verdict.misread, /相邻的元素分成了一组/);
  assert.match(s.stateText(), /像是把相邻的元素分成了一组/);
});

test('直接插入：按住一张插进去；连着几趟没有要动的并成一个检查点', () => {
  const s = make('array a = 49 38 65 97 76 13\nfollow a sort insert\nopen a move');
  assert.match(s.stateText(), /a 照 直接插入排序 走：还没做完第 1 趟（共 5 趟）。第 1 趟（第 2～3 趟没有要动的，做完是同一个样子）做完该是：38 49 65 97 76 13/);
  const fx = stu(s, 'move a#2 -> a.1');
  assert.equal(fx.judged.verdict.right, true);
  assert.match(said(fx), /到了第 3 趟做完的样子/);
  stu(s, 'move a#5 -> a.4');
  const last = stu(s, 'move a#6 -> a.1');
  assert.deepEqual(last.done, ['a']);
  assert.equal(whereOf(s.objects.get('a'), s).done, true);
});

test('重复的数：两张不带撇的一样的牌换了先后还在路上；带撇的（49 和 49′）分得开', () => {
  const s = make("array a = 38 49 38′ 13\nfollow a sort insert\nopen a move");
  // 第 2 趟把 38′ 插到 38 后面（稳定）
  let fx = stu(s, 'move a#3 -> a.2');
  assert.equal(fx.judged.verdict.right, true);
  const t = make("array a = 38 49 38′ 13\nfollow a sort insert\nopen a move");
  fx = stu(t, 'move a#3 -> a.1'); // 插到了 38 前面：不稳定，不在路上
  assert.equal(fx.judged.verdict.right, null);
  assert.match(said(fx), /差 2 格：第 1 格（现在 38′，该是 38）、第 2 格（现在 38，该是 38′）/);
  // 两张一模一样的 7 换了先后：看不出来，也不该算错
  const u = make('array a = 7 7 3\nfollow a sort insert\nopen a move');
  stu(u, 'swap a#1 a#2');
  assert.equal(whereOf(u.objects.get('a'), u).off, false);
});

test('七种都接得上；快排说「次划分」；字段写错引擎自己报；字段里写 {…} 当场报；有空格子当场报', () => {
  for (const algo of ['insert', 'shell', 'bubble', 'select', 'quick', 'merge', 'radix']) {
    const s = make(`array a = 49 38 65 97 76 13 27\nfollow a sort ${algo}`);
    const w = whereOf(s.objects.get('a'), s);
    assert.ok(w.total >= 1 && !w.error && w.next, `${algo}：${JSON.stringify(w)}`);
  }
  const q = make('array a = 49 38 65 97 76 13 27\nfollow a sort quick');
  assert.match(q.stateText(), /a 照 快速排序 走：还没做完第 1 次划分（共 \d+ 次划分）。第 1 次划分做完该是：27 38 13 49 76 97 65/);
  const s = make('array a = 3 1 2\ndial d = 2 range=1-2');
  assert.match(dryRun(s, 'follow a sort nosuch')[0].error, /不认识「nosuch」/);
  assert.match(dryRun(s, 'follow a sort shell gaps="{d} 1"')[0].error, /写死的数/);
  const b = make('array h = 3 _ 2');
  assert.match(dryRun(b, 'follow h sort insert')[0].error, /还有空着的格/);
});

test('老师写了一格（数据变了）：从新的一排重跑', () => {
  const s = make('array a = 3 1 2\nfollow a sort insert\nopen a move');
  run(s, 'write a.3 0');
  assert.match(s.stateText(), /第 1 趟做完该是：1 3 0/);
});
