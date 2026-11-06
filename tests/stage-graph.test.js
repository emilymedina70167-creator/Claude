// 舞台上的图（kit/src/stage/types/graph.js）：造、自动排版、部件的写法、每个指令改了什么、给老师看的现状、说明里的写法照抄能演
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { graph, layoutGraph, layoutFaults, edgeGeom, spots, nodeCenter, GNODE } from '../kit/src/stage/types/graph.js';

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };
const make = (src) => run(new Scene(), src);
const G = (s, id = 'g') => s.objects.get(id);
const N = (o, k) => o.nodes.find((n) => n.key === k);
const err = (s, line) => dryRun(s, line)[0]?.error;
const BASE = 'graph g = A-B:4 A-C:2 B-C:1 B-D:5 C-D:8 D-E:3';
// 王道里的几张图
const BOOK = {
  dijkstra: '1>2:10 1>5:5 2>3:1 2>5:2 3>4:4 4>1:7 4>3:6 5>2:3 5>3:9 5>4:2',
  prim: '1-2:6 1-3:1 1-4:5 2-3:5 3-4:5 2-5:3 3-5:6 3-6:4 4-6:2 5-6:6',
  bfs: 'a-b a-c b-d b-e c-f c-g d-h e-h f-g',
  topo: '1>2 1>4 2>3 2>4 4>3 4>5 3>5',
  aov: 'A>B A>C B>D C>D C>E D>F E>F',
};
const faults = (o) => {
  const names = o.nodes.map((n) => n.key), idx = new Map(names.map((k, i) => [k, i]));
  return layoutFaults(names.map((k) => ({ x: o.pos[k].x / 150, y: o.pos[k].y / 150 })), o.edges.map((e) => [idx.get(e.a), idx.get(e.b)]));
};

test('造：无向带权、有向（A>B，也认 A -> B 分开写）、单独的结点；边和结点都是部件', () => {
  const o = G(make(BASE));
  assert.equal(o.directed, false);
  assert.equal(o.weighted, true);
  assert.deepEqual(o.nodes.map((n) => n.key), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(o.edges.map((e) => `${e.key}:${e.w}`), ['A~B:4', 'A~C:2', 'B~C:1', 'B~D:5', 'C~D:8', 'D~E:3']);
  const d = G(make('graph g = A>B A -> C C→D E'));
  assert.equal(d.directed, true);
  assert.equal(d.weighted, false);
  assert.deepEqual(d.edges.map((e) => e.key), ['A~B', 'A~C', 'C~D']);
  assert.ok(N(d, 'E'), '单独的结点');
  assert.equal(make(BASE).parts('g').length, 11, '5 个结点 + 6 条边');
});

test('造写错了说清楚怎么写', () => {
  const s = new Scene();
  assert.match(err(s, 'graph g A-B'), /要写成 graph 名字 = A-B:4/);
  assert.match(err(s, 'graph g = A-B A>C'), /要么都是 A-B（无向），要么都是 A>B（有向）/);
  assert.match(err(s, 'graph g = A-B:1 B-C'), /有的边写了权、有的没写（B-C 没写）/);
  assert.match(err(s, 'graph g = A-B B-A'), /B–A 写了两次/);
  assert.match(err(s, 'graph g = A-A'), /自环/);
  assert.match(err(s, 'graph g = A-B=4'), /权写成 A-B:4（用冒号/);
  assert.match(err(s, 'graph g = A-B:x'), /权要是数/);
  assert.match(err(s, 'graph g = 甲-B'), /结点的名字用字母或数字/);
  assert.match(err(s, `graph g = ${Array.from({ length: 17 }, (_, i) => `N${i}`).join(' ')}`), /最多 16 个结点/);
  assert.match(err(s, 'graph g = A-B pos="A=0,0"'), /pos 要给每个结点（B 没给）/);
  assert.match(err(s, 'graph g = A-B pos="A=0,0 B=0.1,0"'), /挨得太近/);
  assert.match(err(s, 'graph g = A-B pos="A 0 0"'), /pos 写成/);
  // 有向图里一对来回的边可以有
  assert.equal(err(s, 'graph g = A>B B>A'), undefined);
});

test('自动排版：同一张图每次排得一样；王道里的几张图没有交叉、结点不压着边、不挤；有向无环图按层从左往右', () => {
  for (const [name, src] of Object.entries(BOOK)) {
    const a = G(make(`graph g = ${src}`)), b = G(make(`graph g = ${src}`));
    assert.deepEqual(a.pos, b.pos, `${name} 排得一样`);
    assert.deepEqual(faults(a), { cross: 0, touch: 0, crowd: 0 }, `${name} 排得干净`);
    const ps = Object.values(a.pos);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) >= GNODE + 60, `${name} 结点之间有地方写字`);
  }
  for (const name of ['topo', 'aov']) {
    const o = G(make(`graph g = ${BOOK[name]}`));
    for (const e of o.edges) assert.ok(o.pos[e.b].x > o.pos[e.a].x, `${name}：${e.a}→${e.b} 往右`);
  }
  // 老师给的坐标照用（一个单位一条边长）
  const p = G(make('graph g = A-B B-C pos="A=0,0 B=2,0 C=1,1"'));
  assert.deepEqual(p.pos, { A: { x: 0, y: 0 }, B: { x: 300, y: 0 }, C: { x: 150, y: 150 } });
  // 一个结点、没有边也排得出
  assert.deepEqual(layoutGraph(['A'], []), { A: { x: 0, y: 0 } });
  // 两张图上下摆开
  const s2 = make(`${BASE}\ngraph h = X-Y`);
  const A = graph.objectBox(G(s2)), B = graph.objectBox(G(s2, 'h'));
  assert.ok(B.y > A.y + A.h);
});

test('边怎么画：有向图来回两条边往各自的右手边弯开、带箭头；无向的是直的', () => {
  const o = G(make('graph g = A>B B>A B>C'));
  const ab = edgeGeom(o, o.edges[0]), ba = edgeGeom(o, o.edges[1]), bc = edgeGeom(o, o.edges[2]);
  const A = nodeCenter(o, 'A'), B = nodeCenter(o, 'B');
  const side = (g) => Math.sign((B.x - A.x) * (g.c.y - A.y) - (B.y - A.y) * (g.c.x - A.x));
  assert.equal(side(ab), -side(ba), '两条往两边弯');
  assert.ok(ab.arrow && bc.arrow);
  const mid = { x: (nodeCenter(o, 'B').x + nodeCenter(o, 'C').x) / 2, y: (nodeCenter(o, 'B').y + nodeCenter(o, 'C').y) / 2 };
  assert.ok(Math.hypot(bc.c.x - mid.x, bc.c.y - mid.y) < 0.01, '只有一条的是直的');
  const u = G(make('graph g = A-B'));
  assert.equal(edgeGeom(u, u.edges[0]).arrow, null);
  // 旁边的数放在没有边的方向
  const s = G(make(BASE));
  for (const n of s.nodes) {
    const sp = spots(s, n.key).tag;
    const a = Math.atan2(sp.dy, sp.dx);
    for (const e of s.edges.filter((x) => x.a === n.key || x.b === n.key)) {
      const other = nodeCenter(s, e.a === n.key ? e.b : e.a), c = nodeCenter(s, n.key);
      const b = Math.atan2(other.y - c.y, other.x - c.x);
      const d = Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      assert.ok(d > Math.PI / 5, `${n.key} 旁边的数不压着边`);
    }
  }
});

test('部件的写法：g.A 结点、g.A~B 边（无向图 g.B~A、g.A-B 也认）、g.nodes、g.edges；写错了说清楚', () => {
  const s = make(BASE);
  assert.equal(s.parts('g.A')[0].kind, 'node');
  assert.equal(s.parts('g.A~B')[0].key, 'A~B');
  assert.equal(s.parts('g.B~A')[0].key, 'A~B');
  assert.equal(s.parts('g.A-B')[0].key, 'A~B');
  assert.equal(s.parts('g.nodes').length, 5);
  assert.equal(s.parts('g.edges').length, 6);
  assert.equal(s.refOf(s.parts('g.B~A')[0]), 'g.A~B');
  assert.equal(s.refOf(s.parts('g.C')[0]), 'g.C');
  assert.equal(s.parts('g.a')[0].key, 'A', '大小写认得出来时也行');
  assert.throws(() => s.parts('g.Z'), /图 g 没有结点 Z（有：A B C D E；边写 g\.A~B）/);
  assert.throws(() => s.parts('g.A~E'), /g 里 A 和 E 之间没有边（A 连着的：g\.A~B g\.A~C）/);
  assert.throws(() => s.parts('g#1'), /图的部件写 g\.A（结点）或 g\.A~B（边）/);
  // 边也能染色、点亮、灰掉；比较时比的是权
  run(s, 'paint g.A~C g3\nglow g.B~C\ndim g.C~D');
  assert.match(s.stateText(), /绿 A–C；亮 B–C；灰 C–D/);
  assert.equal(s.apply(parseScript('compare g.A~C g.A~B')[0]).sign, -1);
  assert.match(err(make(BASE), 'swap g.A g.B'), /图没有「swap」/);
});

test('旁边的数和松弛：A 的数 + 边权比 B 的小就改成它，不小就不动；比较结点比的是旁边的数', () => {
  const s = make(`${BASE}\ntag g ∞\ntag g.A 0`);
  const o = G(s);
  assert.deepEqual(o.nodes.map((n) => n.tag), ['0', '∞', '∞', '∞', '∞']);
  let fx = s.apply(parseScript('relax g.A -> g.B')[0]);
  assert.deepEqual([fx.alt, fx.before, fx.improved], ['4', '∞', true]);
  assert.equal(N(o, 'B').tag, '4');
  run(s, 'relax g.A -> g.C');
  fx = s.apply(parseScript('relax g.C -> g.B')[0]);
  assert.deepEqual([fx.dA, fx.w, fx.alt, fx.before, fx.improved], ['2', '1', '3', '4', true]);
  fx = s.apply(parseScript('relax g.B g.C')[0]);
  assert.deepEqual([fx.alt, fx.improved], ['4', false]);
  assert.equal(N(o, 'C').tag, '2', '不比它小就不动');
  run(s, 'relax g.C~D');
  assert.equal(N(o, 'D').tag, '10');
  assert.equal(s.apply(parseScript('compare g.B g.D')[0]).sign, -1, '3 < 10');
  assert.match(s.stateText(), /旁边的数：A 0，B 3，C 2，D 10，E ∞/);
  assert.match(err(s, 'relax g.E -> g.D'), /E 还没有距离.*还是 ∞/);
  assert.match(err(s, 'relax g.A -> g.E'), /A 和 E 之间没有边/);
  assert.match(err(s, 'relax g.A'), /要写成 relax g\.A -> g\.B/);
  // 有向图只能顺着箭头松弛
  const d = make('graph d = A>B:2\ntag d.A 0\ntag d.B 0');
  assert.match(err(d, 'relax d.B -> d.A'), /只有 A→B，不能从 B 到 A/);
  run(s, 'untag g.E');
  assert.equal(N(o, 'E').tag, null);
  assert.equal(N(o, 'E').value, 'E');
  assert.match(err(s, 'tag g.A~B 1'), /tag 对结点做（写的 A–B 是边）/);
});

test('访问号和沿边走：visit 编号、记着上一个；walk 要相邻', () => {
  const s = make(BASE);
  let fx = s.apply(parseScript('visit g.A')[0]);
  assert.equal(fx.from, null);
  fx = s.apply(parseScript('visit g.B g.C')[0]);
  assert.equal(fx.from, 'A');
  assert.deepEqual(G(s).nodes.map((n) => n.order), [1, 2, 3, null, null]);
  assert.match(s.stateText(), /访问顺序：A B C/);
  assert.match(err(s, 'visit g.B'), /B 已经访问过了（第 2 个）；重来先写 unvisit g/);
  run(s, 'unvisit g');
  assert.ok(G(s).nodes.every((n) => n.order == null));
  assert.deepEqual(s.apply(parseScript('walk g.A g.B g.D g.E')[0]).path, ['A', 'B', 'D', 'E']);
  assert.match(err(s, 'walk g.A g.D'), /A 和 D 之间没有边（walk 要沿着边走）/);
});

test('拓扑排序：take 拿掉结点和它的边、排到下面的序列里；deg 标入度（拿掉以后跟着变）', () => {
  const s = make(`graph g = ${BOOK.aov}\ndeg g`);
  const o = G(s);
  assert.match(s.stateText(), /入度：A 0，B 1，C 1，D 2，E 1，F 2/);
  const fx = s.apply(parseScript('take g.A')[0]);
  assert.deepEqual(fx.edges, ['A~B', 'A~C']);
  assert.match(s.stateText(), /入度：B 0，C 0，D 2/);
  run(s, 'take g.C');
  assert.deepEqual(o.taken, ['A', 'C']);
  assert.match(s.stateText(), /拿掉的（按先后排在下面）：A C/);
  assert.equal(s.parts('g.edges').length, 3, '拿掉的边不再是部件');
  assert.throws(() => s.parts('g.A~B'), /跟着拿掉的结点一起没了/);
  assert.match(err(s, 'take g.A'), /A 已经拿掉了/);
  assert.match(err(s, 'walk g.A g.B'), /A 已经拿掉了/);
  // 拿掉的排在图的下面，一个挨一个
  const a = nodeCenter(o, 'A'), c = nodeCenter(o, 'C');
  assert.equal(a.y, c.y);
  assert.ok(c.x > a.x);
  const box = graph.objectBox(o);
  assert.ok(a.y + GNODE / 2 <= box.y + box.h);
  run(s, 'undeg g');
  assert.doesNotMatch(s.stateText(), /入度/);
  // 无向图标的是度
  assert.match(make(`${BASE}\ndeg g`).stateText(), /度：A 2，B 3/);
});

test('给老师看的现状：有向无向、带不带权、每条边和权', () => {
  const t = make(BASE).stateText();
  assert.match(t, /图：名字\.A 是结点，名字\.A~B 是边/);
  assert.match(t, /图 g（无向、带权，5 个结点、6 条边）：/);
  assert.match(t, /边：A–B 4、A–C 2、B–C 1、B–D 5、C–D 8、D–E 3/);
  assert.match(make('graph g = A>B B>C').stateText(), /图 g（有向，3 个结点、2 条边）：\n {2}边：A→B、B→C/);
});

test('学生点：ask tap g.nodes 只点结点，ask tap g.edges 只点边；回答写 g.A / g.A~B', () => {
  const s = make(`${BASE}\nask tap g.edges "下一条选哪条？" expect=g.B~C`);
  assert.equal(s.parts(s.waiting.refs[0]).every((p) => p.kind === 'edge'), true);
  assert.equal(s.refOf(s.parts(s.waiting.expect)[0]), 'g.B~C');
});

test('说明里的例子照抄就能演（一行不错）；说明里每一条写法在摆好这张图的舞台上都能演', () => {
  assert.deepEqual(dryRun(new Scene(), graph.example), []);
  assert.match(graph.example.split('\n')[0], /^graph g = /);
  const lines = graph.doc.split('\n').flatMap((l) => l.split(/\s{2,}/)[0].split(/\s\/\s/)).map((l) => l.trim()).filter((l) => /^[a-z]+ /.test(l));
  assert.ok(lines.length >= 12, `说明里的写法 ${lines.length} 条`);
  const bad = [];
  for (const l of lines) {
    const base = make(`${BASE}\ntag g.A 0`);
    const e = dryRun(base, l);
    if (e.length) bad.push(`${l} → ${e[0].error}`);
  }
  assert.deepEqual(bad, []);
  assert.doesNotMatch(graph.doc + graph.hint + graph.example, /[他她]/);
});
