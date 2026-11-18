// 第四轮审查留下的几条小的（主线第五轮任务 17）：一条一个测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { whereOf } from '../kit/src/stage/follow.js';

const run = (s, src, opt) => { let fx; for (const c of parseScript(src)) fx = s.apply(c, opt); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };

test('照着走的一排同时开着 edit：学生把数直接写成有序的——不算走完（不演 @a.done），现状说数被改写了', () => {
  const s = make('array a = 3 1 2\nfollow a sort insert\nopen a edit\n@a.done say "排好了"');
  const w = (src) => s.apply(parseScript(src)[0], { by: 'student', open: 'edit' });
  w('write a.1 1'); w('write a.2 2');
  const fx = w('write a.3 3');
  assert.equal([...s.objects.get('a').cells].sort((x, y) => x.slot - y.slot).map((c) => c.value).join(' '), '1 2 3');
  const wh = whereOf(s.objects.get('a'), s);
  assert.equal(wh.done, false);
  assert.deepEqual(fx.done || [], []);
  assert.deepEqual(fx.reactions || [], []);
  assert.match(s.stateText(), /a 照 直接插入排序 走：照不下去了（学生把数直接改写成了做完的样子，不算照着走完的/);
  // 老师重新 follow：从现在的样子接着照
  run(s, 'write a.1 3\nfollow a sort insert');
  assert.match(s.stateText(), /a 照 直接插入排序 走：还没做完第 1 趟/);
});

test('Dijkstra 连着两轮 dist 一样（并成一个检查点）：两轮各确定了谁都写出来', () => {
  // 1→2:1、1→3:1：第 1 轮确定 1（dist 2=1 3=1），第 2 轮确定 2、第 3 轮确定 3，dist 都不再变
  const s = make('graph g = 1>2:1 1>3:1\nfollow g net dijkstra from=1\nopen g tag');
  const t = s.stateText();
  assert.match(t, /确定 1；确定 2；确定 3；|确定 1；[^\n]*确定 2；[^\n]*确定 3；/);
});

test('学生改写了又自己改回去：接着照（不用老师重新 follow）', () => {
  const s = make('array a = 3 1 2\nfollow a sort insert\nopen a edit');
  const w = (src) => s.apply(parseScript(src)[0], { by: 'student', open: 'edit' });
  w('write a.1 9');
  assert.match(s.stateText(), /照不下去了（学生把数改写了/);
  w('write a.1 3');
  assert.match(s.stateText(), /a 照 直接插入排序 走：还没做完第 1 趟/);
});

test('学生改写了、中间还挪过、再把数改回原来那一组：从现在的排法接着照（审查：以前只认排法回到改写以前，卡死）', () => {
  const s = make('array a = 3 1 2 5 4\nfollow a sort bubble\nopen a edit\nopen a');
  const w = (src, open) => s.apply(parseScript(src)[0], { by: 'student', open });
  w('write a.1 9', 'edit');
  assert.match(s.stateText(), /照不下去了（学生把数改写了/);
  w('swap a.2 a.3', 'drag');
  w('write a.1 3', 'edit');
  assert.doesNotMatch(s.stateText(), /照不下去了/);
  assert.match(s.stateText(), /a 照 冒泡排序 走：/);
  // 改写出来的正好是第 1 趟做完的样子：也不卡住（从这里重新照）
  const s2 = make('array a = 3 1 2\nfollow a sort insert\nopen a edit');
  const w2 = (src) => s2.apply(parseScript(src)[0], { by: 'student', open: 'edit' });
  w2('write a.1 1'); w2('write a.2 3');
  assert.doesNotMatch(s2.stateText(), /照不下去了/);
  assert.equal(whereOf(s2.objects.get('a'), s2).done, false);
});
