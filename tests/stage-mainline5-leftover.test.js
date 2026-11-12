// 第四轮审查留下的几条小的（主线第五轮任务 17）：一条一个测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { whereOf } from '../kit/src/stage/follow.js';
import { stageDrillId } from '../kit/src/memory/stagedrills.js';

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
  assert.match(s.stateText(), /a 照 直接插入排序 走：照不下去了（学生把数改写了/);
  // 老师重新 follow：从现在的样子接着照
  run(s, 'write a.1 3\nfollow a sort insert');
  assert.match(s.stateText(), /a 照 直接插入排序 走：还没做完第 1 趟/);
});

test('题库的编号：算法名写中文也分得开（以前中文被去掉，希尔和快排撞成一个编号）', () => {
  const a = stageDrillId('DS-L8.2.3', '希尔', {}), b = stageDrillId('DS-L8.2.3', '快排', {});
  assert.notEqual(a, b);
  assert.match(a, /^d-[A-Za-z0-9_-]+$/);
  assert.notEqual(stageDrillId('DS-L8.2.3', 'sort', { algo: '希尔' }), stageDrillId('DS-L8.2.3', 'sort', { algo: '冒泡' }));
  // 英文的照旧（已经抄进题库的编号不变）
  assert.equal(stageDrillId('DS-L8.2.3', 'sort', { algo: 'shell', gaps: '5 3 1' }), 'd-stage-DS-L8_2_3-sort-algo_shell_gaps_5_3_1');
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

test('舞台题点「做不出来」：放弃记在那道题的记录上，报告里是一道（另记一条动作会归成另一道——组件不再另记）', async () => {
  const { itemsOf } = await import('../kit/src/memory/report.js');
  const rec = { src: 'record', comp: 'sd1', type: 'stage', q: '照 希尔排序 走一遍', ok: false, giveup: true, at: 1 };
  const one = itemsOf([rec]);
  assert.equal(one.length, 1);
  assert.equal(one[0].outcome, 'giveup');
  // 以前：同一个组件再记一条 giveup 的动作（没有 q）→ 两道
  assert.equal(itemsOf([rec, { src: 'event', comp: 'sd1', kind: 'giveup', at: 2 }]).length, 2);
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../kit/src/blocks/stagedrill.js', import.meta.url), 'utf8');
  assert.equal((src.match(/session\.event\('giveup'/g) || []).length, (src.match(/if \(!gave\) session\.event\('giveup'/g) || []).length);
});
