// 舞台主线第四轮：最后一审（一个只读的助手）抓到的，一条一个测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { whereOf } from '../kit/src/stage/follow.js';
import { undoneOf } from '../kit/src/stage/events.js';
import { stageDoc } from '../kit/src/stage/doc.js';

const run = (s, src, opt) => { let fx; for (const c of parseScript(src)) fx = s.apply(c, opt); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const stu = (s, src, open = 'move') => s.apply(parseScript(src)[0], { by: 'student', open });
const said = (fx) => [...(fx.judged?.facts || []), ...(fx.judged?.after || [])].join('\n');
const WD = "array a = 49 38 65 97 76 13 27 49′";

test('follow 的字段写错（引擎没有这个字段）当场报，不照默认值悄悄跑出另一条路；引擎有的字段都传得进去', () => {
  const s = make(`${WD}\ngraph g = 1-2:10 1-5:5 5-2:3 2-3:1`);
  assert.match(dryRun(s, 'follow a sort shell gap="5 3 1"')[0].error, /sort 没有「gap」这个字段（能写：gaps）/);
  assert.match(dryRun(s, 'follow a sort quick pivot=last')[0].error, /没有「pivot」这个字段/);
  assert.match(dryRun(s, 'follow g net dijkstra form=5')[0].error, /net 没有「form」这个字段（能写：from、order、on）/);
  // order 是图的引擎真有的字段（邻接点按顶点编号还是按写的顺序）：传得进去
  const v = make('graph g = 1-5 1-2 2-3 5-3\nfollow g net bfs from=1 order=list');
  assert.equal(v.objects.get('g').follow.input.order, 'list');
  // 重放旧课不报
  const t = new Scene();
  for (const c of parseScript(`${WD}\nfollow a sort shell gap="5 3 1"`)) t.apply({ ...c, lenient: true });
});

test('back、同名重造不把 follow 弄丢：回去以后照旧照着走；重造从新的一排重跑', () => {
  const s = make(`${WD}\nkeep a "开始"\nfollow a sort shell gaps="5 3 1"\nopen a move`);
  stu(s, 'swap a#1 a#6');
  run(s, 'back a "开始"');
  assert.ok(s.objects.get('a').follow, 'back 以后还照着走');
  assert.match(s.stateText(), /a 照 希尔排序（增量 5 3 1） 走：还没做完第 1 趟/);
  const r = make(`${WD}\nfollow a sort insert\narray a = 5 4 3`);
  assert.equal(r.objects.get('a').follow?.name, 'sort');
  assert.match(r.stateText(), /a 照 直接插入排序 走：还没做完第 1 趟（共 2 趟）。第 1 趟做完该是：4 5 3/);
});

test('带前导零的数（09、007）：和引擎比的时候照数比，给老师看的照牌上写的字', () => {
  const s = make('array b = 09 05 13 02\nfollow b sort insert\nopen b move');
  assert.match(s.stateText(), /第 1 趟[^：]*做完该是：05 09 13 02/);
  const fx = stu(s, 'move b#2 -> b.1');
  assert.equal(fx.judged.verdict.right, true);
  const t = make('array b = 09 05 13 02 20 30 40 50\nfollow b sort insert\nopen b move');
  assert.match(said(stu(t, 'swap b#7 b#8')), /第 1 格（现在 09，该是 05）、第 2 格（现在 05，该是 09）/);
});

test('学生手上还有没有事：照着走、还没走完、开着拖（move）或选边（choose）的，算手上有事', () => {
  const a = make(`${WD}\nfollow a sort shell gaps="5 3 1"\nopen a move`);
  assert.deepEqual(undoneOf(a), ['a']);
  const g = make('graph g = 1-2:10 1-5:5 5-2:3 2-3:1\nfollow g net prim from=1\nopen g choose');
  assert.deepEqual(undoneOf(g), ['g']);
});

test('图里有孤立的顶点：Dijkstra 的 dist 不错位', () => {
  const s = make('graph g = 1-2:10 1-5:5 5-2:3 2-3:1 4\nfollow g net dijkstra from=1\nopen g tag');
  assert.match(s.stateText(), /第 1 轮做完该是：确定 1；dist 1=0 2=10 3=∞ 4=∞ 5=5/);
});

test('给老师的字：走完以后又动了、挪开以后不说「一上来就做完」；错法不写成「像是像是」；选边的不说「个顶点」；说明写清 @a.right 只演一次', () => {
  const s = make('array a = 1 2 3 4\nfollow a sort insert\nopen a move');
  stu(s, 'swap a#1 a#2');
  assert.doesNotMatch(s.stateText(), /一上来就已经是做完的样子/);
  const d = make('array a = 2 1 3\nfollow a sort insert\nopen a move');
  stu(d, 'swap a#1 a#2'); // → 1 2 3 走完了
  const fx = stu(d, 'swap a#1 a#3'); // → 1 3 2：不在路上了
  assert.match(d.stateText(), /a 照 直接插入排序 走：走完以后又动了，现在不是做完的样子/);
  assert.match(said(fx), /走完以后又动了，现在不是做完的样子/);
  const v = make(`${WD}\nfollow a sort shell gaps="5 3 1"\nopen a move`);
  stu(v, 'swap a#1 a#2');
  assert.doesNotMatch(stu(v, 'swap a#5 a#6').judged.verdict.misread, /^像是/);
  const p = make('graph g = 1-2:10 1-5:5 5-2:3 2-3:1\nfollow g net prim from=1\nopen g choose');
  assert.doesNotMatch(said(stu(p, 'choose g.2~3', 'choose')), /个顶点/);
  assert.match(stageDoc('数据结构'), /@a\.right 第一次到一趟时演（只演一次）/);
});

test('抄进题库的题先试一遍：课上 group 写的是拨盘名（题里没有拨盘）——去掉那一行照抄，不抄一道出不了的题', async () => {
  const { harvestDrills } = await import('../kit/src/memory/drills.js');
  const { parseStageDrill, drawStageDrill } = await import('../kit/src/stagedrillspec.js');
  const turns = [{ seq: 1, role: 'claude', text: `${WD}\ndial d = 5 range=1-5\nfollow a sort shell gaps="5 3 1"\ngroup a stride=d\nopen a move` }];
  const out = harvestDrills({ session: { id: 'c-1', kind: 'stage', block: 'DS-L8.2.3' }, turns, report: null, existing: [] });
  assert.equal(out.length, 1);
  assert.doesNotMatch(out[0].doc.md, /stride=d/);
  assert.ok(!drawStageDrill(parseStageDrill(out[0].doc.md.replace(/^```stage\n|\n```$/g, ''))).error);
  // 分组写了几次（5、3、1）：只留最后一次
  const many = harvestDrills({ session: { id: 'c-2', kind: 'stage', block: 'DS-L8.2.3' }, turns: [{ seq: 1, role: 'claude', text: `${WD}\nfollow a sort shell gaps="5 3 1"\ngroup a stride=5\ngroup a stride=3\nopen a move` }], report: null, existing: [] });
  assert.equal((many[0].doc.md.match(/group a/g) || []).length, 1);
  assert.match(many[0].doc.md, /group a stride=3/);
});
