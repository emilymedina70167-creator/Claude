// 一排格子的规则（kit/src/stage/types/array.rules.js，主线第二轮 A）：空格子、插入式地拖、点一格写数、量。
// 页面不判对错：只有手势表、做不做得到、事实、量
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { arrayRules as R } from '../kit/src/stage/types/array.rules.js';
import { gestureOf, evalMeasure } from '../kit/src/stage/rules.js';

const run = (s, src, opt) => { for (const c of parseScript(src)) s.apply(c, opt); return s; };
const make = (src) => run(new Scene(), src);
const vals = (s, id = 'a') => [...s.objects.get(id).cells].sort((x, y) => x.slot - y.slot).map((c) => c.value);
const cell = (s, slot, id = 'a') => s.objects.get(id).cells.find((c) => c.slot === slot);
const TEN = 'array a = 49 38 65 97 76 13 27 49′ 55 04';

test('空格子：_ 造成空位（值是空的），现状写 □；write a.3 _ 空出来；跟着它算的、a sorted 照「还空着」', () => {
  const s = make('array h = _ 49 38');
  assert.deepEqual(vals(s, 'h'), ['', '49', '38']);
  assert.match(s.stateText(), /□ 49 38/);
  run(s, 'write h.3 _');
  assert.deepEqual(vals(s, 'h'), ['', '49', '']);
  run(s, 'write h.1 7');
  assert.deepEqual(vals(s, 'h'), ['7', '49', '']);
  // 跟着空格子算的：写下时算不出来（还空着），当场报
  assert.match(dryRun(s, 'array c = {h.3}')[0].error, /还空着/);
  // a sorted 有空格子判不了（不是「不成立」）
  run(s, 'open h edit\ngoal g1 "排好" when="h sorted"');
  assert.match(s.stateText(), /判不了/);
});

test('手势 move：放到另一张上是对调，放到两张之间是插进去，放回原处、跨泳道做不到', () => {
  const s = make(TEN);
  const o = s.objects.get('a');
  const g = gestureOf(o, 'move');
  assert.equal(g.gesture, 'drop-at');
  const from = cell(s, 6);
  assert.deepEqual(g.toAct(o, { from, to: cell(s, 1) }), { act: { type: 'swap', a: 6, b: 1 }, src: 'swap a#6 a#1' });
  // 两张之间：gap.before 是空隙后面那一格现在是第几格（最后是 null）
  assert.deepEqual(g.toAct(o, { from, to: { gap: { row: 0, before: 2 } } }), { act: { type: 'move', key: 6, to: 2 }, src: 'move a#6 -> a.2' });
  assert.deepEqual(g.toAct(o, { from: cell(s, 2), to: { gap: { row: 0, before: null } } }), { act: { type: 'move', key: 2, to: 10 }, src: 'move a#2 -> a.10' });
  // 往后插：落在空隙前面那一格
  assert.deepEqual(g.toAct(o, { from: cell(s, 2), to: { gap: { row: 0, before: 6 } } }).src, 'move a#2 -> a.5');
  // 紧挨着的两个空隙放下去还在原处
  assert.match(g.toAct(o, { from, to: { gap: { row: 0, before: 6 } } }).error, /还在原处/);
  assert.match(g.toAct(o, { from, to: { gap: { row: 0, before: 7 } } }).error, /还在原处/);
  // 空格子拿不起来；牌能放到空格子上（和它对调）
  const h = make('array h = _ 49 38');
  const ho = h.objects.get('h');
  assert.match(gestureOf(ho, 'move').toAct(ho, { from: cell(h, 1, 'h'), to: cell(h, 2, 'h') }).error, /空格子拖不动/);
  assert.equal(gestureOf(ho, 'move').toAct(ho, { from: cell(h, 3, 'h'), to: cell(h, 1, 'h') }).src, 'swap h#3 h#1');
  // 分开排着：只在自己那条泳道里
  const sp = make(`${TEN}\ngroup a stride=5\nsplit a`);
  const so = sp.objects.get('a');
  assert.match(gestureOf(so, 'move').toAct(so, { from: cell(sp, 6), to: cell(sp, 2) }).error, /自己那一排/);
  assert.equal(gestureOf(so, 'move').toAct(so, { from: cell(sp, 6), to: cell(sp, 1) }).src, 'swap a#6 a#1');
});

test('手势 edit：点一格写一个数；不是数做不到', () => {
  const s = make('array h = _ 49 38');
  const o = s.objects.get('h');
  const g = gestureOf(o, 'edit');
  assert.equal(g.gesture, 'write');
  assert.equal(g.ask(o, { to: cell(s, 1, 'h') }).input, 'keypad');
  assert.deepEqual(g.toAct(o, { to: cell(s, 1, 'h'), value: '38' }), { act: { type: 'write', key: 1, value: '38' }, src: 'write h.1 38' });
  assert.match(g.toAct(o, { to: cell(s, 1, 'h'), value: 'abc' }).error, /不是数/);
});

test('学生的一下：open a move 里的 swap / move 过裁判（不判对错，写做了什么和逆序对怎么变）；open a 的两格对调照旧不过', () => {
  const s = make(`${TEN}\nopen a move`);
  const fx = s.apply(parseScript('move a#6 -> a.1')[0], { by: 'student', open: 'move' });
  assert.equal(fx.judged.verdict.legal, true);
  assert.equal(fx.judged.verdict.right, null);
  assert.match(fx.judged.verdict.why, /13 从第 6 格插到第 1 格，中间 5 张各让一格/);
  assert.ok(fx.judged.after.some((f) => /前大后小的从 \d+ 对变成 \d+ 对/.test(f)), fx.judged.after.join('；'));
  assert.deepEqual(vals(s).slice(0, 3), ['13', '49', '38']);
  // 老写法 open a（两格对调）：不过裁判，发给老师的话和以前一样
  const t = make(`${TEN}\nopen a`);
  const old = t.apply(parseScript('swap a#6 a#1')[0], { by: 'student', open: 'drag' });
  assert.equal(old.judged, undefined);
  // 老师自己演的也不过
  assert.equal(s.apply(parseScript('swap a.1 a.2')[0], { by: 'teacher' }).judged, undefined);
});

test('量：inversions(a) 前大后小的有几对，写一段只数这一段；blank(a) 空着几格；不全是数没有 inv，有空格子还数不了', () => {
  const s = make('array a = 3 1 2\narray w = 是 不是\narray h = _ 5 _');
  assert.equal(evalMeasure(s, 'inversions(a)').value, 2);
  assert.equal(evalMeasure(s, 'inversions(a.2-3)').value, 0);
  assert.equal(evalMeasure(s, 'blank(h)').value, 2);
  assert.equal(evalMeasure(s, 'blank(a)').value, 0);
  // 有空格子：现在数不了（之后会有）；不全是数：这一排永远没有这个量
  assert.equal(evalMeasure(s, 'inversions(h)').value, null);
  assert.ok(!evalMeasure(s, 'inversions(h)').never);
  assert.equal(evalMeasure(s, 'inversions(w)').never, true);
  // 现状里：交给学生拖、写的时候才列（查找、哈希的课不多这一句）；空着几格有空格子才列
  assert.doesNotMatch(s.stateText(), /inversions/);
  assert.match(s.stateText(), /页面算的：blank\(h\) = 2/);
  assert.doesNotMatch(s.stateText(), /blank\(a\)/);
  run(s, 'open a move');
  assert.match(s.stateText(), /页面算的：inversions\(a\) = 2/);
  // 话、贴的字里能写，跟着变
  assert.equal(dryRun(s, 'label n a "还有 {inversions(a)} 对前大后小"').length, 0);
});

test('open：move、edit 能开；和 open a（两格对调）一起开当场报；页面不判对错，wrong= 当场报', () => {
  const s = make(TEN);
  assert.equal(dryRun(s, 'open a move').length, 0);
  assert.equal(dryRun(s, 'open a edit').length, 0);
  assert.equal(dryRun(s, 'open a.1-2 edit').length, 0);
  assert.match(dryRun(s, 'open a move wrong=mark')[0].error, /wrong=/);
  const both = dryRun(s, 'open a\nopen a move');
  assert.equal(both.length, 1);
  assert.match(both[0].error, /open a/);
  // 默认的动作还是两格对调
  assert.equal(run(make(TEN), 'open a').opens.get('a:drag').action, 'drag');
});

test('审查盯 2：空格子进了一排以后，原来当「每格都有值」的指令不崩、不说假话', () => {
  const s = make('array h = _ 49 _ 38 7 _\nopen h edit');
  // 空格子的比较不成立（和矩阵的空格一样），不是「成立」
  assert.equal(dryRun(s, 'goal g1 "a" when="h.1 < h.2"\ngoal g2 "b" when="h.1 != 13"').length, 0);
  run(s, 'goal g1 "a" when="h.1 < h.2"\ngoal g2 "b" when="h.1 != 13"');
  assert.match(s.stateText(), /g1[^\n]*还没做到/);
  assert.match(s.stateText(), /g2[^\n]*还没做到/);
  // 老师自己演的照旧：空位跟着换、跟着让
  assert.equal(dryRun(s, 'hop h.1 -> h.4\nswap h.1 h.2\nmove h#4 -> h.1\ngroup h stride=2\nsplit h\nmerge h\nptr i h.3\npaint h.1 h.3 g1\nlabel n h.3 "这里 {h.3}"').length, 0);
  run(s, 'swap h.1 h.2\nmove h#4 -> h.1');
  assert.match(s.stateText(), /第 1～6 格：38（#4） 49 □（#1） □（#3） 7 □/);
  // 跟着空格子算的：当场说还空着
  assert.match(dryRun(s, 'array c = {h.3} 1')[0].error, /还空着/);
});
