// 图的引擎（engines/graph.js 的 net）接到舞台的图和表上（kit/src/stage/follows/net.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { evalMeasure } from '../kit/src/stage/rules.js';
import { whereOf } from '../kit/src/stage/follow.js';

const run = (s, src, opt) => { let fx; for (const c of parseScript(src)) fx = s.apply(c, opt); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const stu = (s, src, open) => s.apply(parseScript(src)[0], { by: 'student', open });
const said = (fx) => [...(fx.judged?.facts || []), ...(fx.judged?.after || [])].join('\n');
const G = 'graph g = 1>2:10 1>5:5 2>3:1 5>2:3 5>3:9';

test('Dijkstra 接在图上：比的是结点牌子上的 dist；一轮是一个检查点；这一轮确定谁写在给老师的那一句里', () => {
  const s = make(`${G}\nfollow g net dijkstra from=1\nopen g tag`);
  assert.match(s.stateText(), /g 照 Dijkstra（从 1 出发） 走：还没做完第 1 轮（共 4 轮）。第 1 轮做完该是：确定 1；dist 1=0 2=10 3=∞ 5=5/);
  let fx = stu(s, 'tag g.1 0', 'tag');
  assert.equal(fx.judged.verdict.right, null); // 一轮里先写哪个页面不判
  stu(s, 'tag g.2 10', 'tag');
  fx = stu(s, 'tag g.5 5', 'tag');
  assert.equal(fx.judged.verdict.right, true);
  assert.match(said(fx), /到了第 1 轮做完的样子（和引擎算的一样）/);
  assert.equal(evalMeasure(s, 'pass(g)').value, 1);
  assert.match(s.stateText(), /第 2 轮做完该是：确定 5；dist 1=0 2=8 3=14 5=5/);
  // 第 2 轮：学生把 2 写成 3（只比了边权，没加上到 5 的距离：Prim 的更新方式）
  stu(s, 'tag g.3 9', 'tag');
  fx = stu(s, 'tag g.2 3', 'tag');
  assert.equal(fx.judged.verdict.right, false);
  assert.match(fx.judged.verdict.misread, /Prim 的更新方式/);
  fx = stu(s, 'tag g.3 14', 'tag');
  assert.match(said(fx), /和第 2 轮做完该有的样子差 1 个顶点：顶点 2（现在 3，该是 8）/);
  fx = stu(s, 'tag g.2 8', 'tag');
  assert.equal(fx.judged.verdict.right, true);
});

test('Dijkstra 接在表上：引擎每一轮的 dist 直接当表的答案；行名对不上顶点当场报', () => {
  const s = make(`${G}\ntable T = _ _ _ _ / _ _ _ _ / _ _ _ _ rows="2 3 5" cols="第1轮 第2轮 第3轮 第4轮"\nfollow T net dijkstra on=g from=1\nopen T edit`);
  assert.deepEqual(s.objects.get('T').key, [['10', '8', '8', '8'], ['∞', '14', '9', '9'], ['5', '5', '5', '5']]);
  assert.match(s.stateText(), /答案：收下了/);
  const fx = stu(s, 'write T.1,1 10', 'edit');
  assert.match(fx.judged.verdict.why, /写了 10，和答案一样/);
  // 行名写成「顶点2」也认
  const t = make(`${G}\ntable T = _ / _ / _ rows="顶点2 顶点3 顶点5" cols="第1轮"\nfollow T net dijkstra on=g from=1`);
  assert.deepEqual(t.objects.get('T').key, [['10'], ['∞'], ['5']]);
  const bad = make(`${G}\ntable T = _ _ / _ _ rows="A B" cols="1 2"`);
  assert.match(dryRun(bad, 'follow T net dijkstra on=g from=1')[0].error, /行名要是图里的顶点（1、2、3、5）/);
  assert.match(dryRun(bad, 'follow T net dijkstra from=1')[0].error, /on=/);
});

test('同一份对应关系顺带接上的：Prim / Kruskal 选边、BFS / DFS 点结点', () => {
  const U = 'graph g = 1-2:10 1-5:5 2-3:1 5-2:3 5-3:9';
  const p = make(`${U}\nfollow g net prim from=1\nopen g choose`);
  assert.match(p.stateText(), /g 照 Prim（从 1 出发） 走：还没做完第 1 轮（共 3 轮）。第 1 轮做完该是：选了 1–5/);
  let fx = stu(p, 'choose g.1~5', 'choose');
  assert.equal(fx.judged.verdict.right, true);
  stu(p, 'choose g.2~5', 'choose');
  fx = stu(p, 'choose g.2~3', 'choose');
  assert.deepEqual(fx.done, ['g']);
  const k = make(`${U}\nfollow g net kruskal\nopen g choose`);
  fx = stu(k, 'choose g.2~3', 'choose');
  assert.equal(fx.judged.verdict.right, true);
  const b = make(`${U}\nfollow g net bfs from=1\nopen g visit`);
  stu(b, 'visit g.1', 'visit');
  fx = stu(b, 'visit g.2', 'visit');
  assert.equal(fx.judged.verdict.right, true);
  fx = stu(b, 'visit g.3', 'visit'); // 广度优先该先走 5：走成了深度优先
  assert.equal(whereOf(b.objects.get('g'), b).off, true);
  const d = make(`${U}\nfollow g net dfs from=1`);
  assert.equal(whereOf(d.objects.get('g'), d).total, 4);
});

test('老师改了图的边权（数据变了）：从新的图重跑', () => {
  const s = make(`${G}\nfollow g net dijkstra from=1`);
  assert.equal(whereOf(s.objects.get('g'), s).error, null);
  assert.match(dryRun(s, 'follow g net dijkstra from=9')[0].error, /9/);
});
