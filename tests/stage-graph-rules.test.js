// 图交给学生动手（主线第二轮 D）：选边、锁结点、写牌子；页面数选的边连成几块、成不成圈；不判对错
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { graphRules as R } from '../kit/src/stage/types/graph.rules.js';
import { evalMeasure, gestureOf } from '../kit/src/stage/rules.js';

const run = (s, src, extra = {}) => { for (const c of parseScript(src)) s.apply({ ...c, ...extra }); return s; };
const make = (src) => run(new Scene(), src);
// 一个三角形 A-B-C，D 挂在 C 上，E 孤着一条边连 D
const G = 'graph g = A-B:4 A-C:2 B-C:1 C-D:5 D-E:3';
const m = (s, w) => evalMeasure(s, w).value;
const stu = (s, src, open) => s.apply(parseScript(src)[0], { by: 'student', open });

test('choose / unchoose：选进、拿掉、整张清掉；选过的再选、没选的拿掉当场报；现状里列选了的边', () => {
  const s = make(G);
  run(s, 'choose g.B~C g.A~C');
  assert.deepEqual(s.objects.get('g').edges.filter((e) => e.chosen).map((e) => e.key), ['A~C', 'B~C']);
  assert.match(s.stateText(), /选了的边：A–C 2、B–C 1/);
  assert.match(dryRun(s, 'choose g.B~C')[0].error, /B–C 已经选了/);
  assert.match(dryRun(s, 'unchoose g.A~B')[0].error, /A–B 没有选/);
  assert.match(dryRun(s, 'choose g.A')[0].error, /choose 写边/);
  run(s, 'unchoose g.B~C');
  assert.deepEqual(s.objects.get('g').edges.filter((e) => e.chosen).map((e) => e.key), ['A~C']);
  run(s, 'unchoose g');
  assert.equal(s.objects.get('g').edges.some((e) => e.chosen), false);
  // 没选边的图现状一字不多（旧课照旧）
  assert.doesNotMatch(make(G).stateText(), /选了的边|页面算的/);
});

test('量：chosen 选了几条、weight 选的边权加起来、pieces 连成几块、visited 访问了几个', () => {
  const s = make(G);
  assert.deepEqual([m(s, 'chosen(g)'), m(s, 'weight(g)'), m(s, 'pieces(g)'), m(s, 'visited(g)')], [0, 0, 5, 0]);
  run(s, 'choose g.B~C g.A~C\nvisit g.A g.C');
  assert.deepEqual([m(s, 'chosen(g)'), m(s, 'weight(g)'), m(s, 'pieces(g)'), m(s, 'visited(g)')], [2, 3, 3, 2]);
  // 不带权的图没有 weight
  assert.equal(evalMeasure(make('graph h = A-B B-C'), 'weight(h)').never, true);
  // 拿掉的结点（take）和它的边不算：选着的边跟着没了
  run(s, 'take g.B');
  assert.deepEqual([m(s, 'chosen(g)'), m(s, 'weight(g)'), m(s, 'pieces(g)')], [1, 2, 3]);
  // 现状里：有选了的边才列
  assert.match(s.stateText(), /页面算的：chosen\(g\) = 1，weight\(g\) = 2，pieces\(g\) = 3/);
});

test('判断式：g tree（选的边正好是一棵生成树）、g cyclic（选的边里有圈）、g connected（连成一块）；有向图判生成树当场报', () => {
  const s = make(G);
  const st = () => s.stateText();
  run(s, 'goal t "选出一棵生成树" when="g tree"\ngoal c "x" when="g cyclic"\ngoal k "y" when="g connected"');
  assert.match(st(), /t[^\n]*g tree ✗/);
  run(s, 'choose g.A~B g.A~C g.B~C');
  // 三角形三条都选：成圈（挑战 c 这就成立了）、没连成一块、不是树
  assert.deepEqual([s.goals.get('t').met, s.goals.get('c').met, s.goals.get('k').met], [false, true, false]);
  assert.match(st(), /t[^\n]*g tree ✗/);
  const f1 = stu(run(s, 'open g choose'), 'unchoose g.A~B', 'choose');
  assert.equal(f1.goalsMet, undefined);
  stu(s, 'choose g.C~D', 'choose');
  const f2 = stu(s, 'choose g.D~E', 'choose');
  // A-C、B-C、C-D、D-E：4 条、5 个结点、没有圈、连成一块
  assert.deepEqual(f2.goalsMet.sort(), ['k', 't']);
  // 再把 A–B 选回来：又成圈了，不再是树（做到过的挑战照「做到过；现在不成立」写）
  stu(s, 'choose g.A~B', 'choose');
  assert.match(st(), /t[^\n]*做到过；现在不成立（g tree ✗）/);
  // 有向图：成圈、连通照无向的算；生成树页面不判
  const d = make('graph d = A>B B>C');
  assert.match(dryRun(d, 'goal t "x" when="d tree"')[0].error, /有向图页面不判生成树/);
  assert.equal(dryRun(d, 'goal t "x" when="d connected"').length, 0);
});

test('手势：choose 点一条边（选着的再点是拿掉）、visit 点一个结点、tag 点一个结点写数（∞ 也行）', () => {
  const s = make(G);
  const o = s.objects.get('g');
  const edge = (k) => o.edges.find((e) => e.key === k), node = (k) => o.nodes.find((n) => n.key === k);
  const ch = gestureOf(o, 'choose');
  assert.equal(ch.gesture, 'tap');
  assert.deepEqual(ch.toAct(o, { from: edge('B~C') }), { act: { type: 'choose', key: 'B~C' }, src: 'choose g.B~C' });
  run(s, 'choose g.B~C');
  assert.deepEqual(ch.toAct(o, { from: edge('B~C') }), { act: { type: 'unchoose', key: 'B~C' }, src: 'unchoose g.B~C' });
  assert.match(ch.toAct(o, { from: node('A') }).error, /点一条边/);
  const vi = gestureOf(o, 'visit');
  assert.deepEqual(vi.toAct(o, { from: node('A') }), { act: { type: 'visit', key: 'A' }, src: 'visit g.A' });
  run(s, 'visit g.A');
  assert.match(vi.toAct(o, { from: node('A') }).error, /A 已经访问过了/);
  const tg = gestureOf(o, 'tag');
  assert.equal(tg.gesture, 'write');
  assert.equal(tg.ask(o, { to: node('B') }).extra, '∞');
  assert.deepEqual(tg.toAct(o, { to: node('B'), value: '7' }), { act: { type: 'tag', key: 'B', value: '7' }, src: 'tag g.B 7' });
  assert.deepEqual(tg.toAct(o, { to: node('B'), value: '∞' }).src, 'tag g.B ∞');
  assert.match(tg.toAct(o, { to: node('B'), value: 'x' }).error, /不是数/);
});

test('学生的一下过裁判：页面不判对错，只说做了什么、现在选了几条、总权、连成几块；成圈时写出那个圈', () => {
  const s = make(`${G}\nopen g choose\nopen g visit`);
  // visit 和 tag 都是点结点：一起开，后开的那一项学生永远用不上——当场报（手势层本来的规矩）
  assert.match(dryRun(s, 'open g tag')[0].error, /已经开着 visit/);
  const a = stu(s, 'choose g.B~C', 'choose');
  assert.equal(a.judged.verdict.legal, true);
  assert.equal(a.judged.verdict.right, null);
  assert.match(a.judged.verdict.why, /选了 B–C（权 1）/);
  assert.match(a.judged.after.join('；'), /现在选了 1 条、总权 1、连成 4 块/);
  stu(s, 'choose g.A~C', 'choose');
  const b = stu(s, 'choose g.A~B', 'choose');
  assert.match(b.judged.after.join('；'), /成圈了：A–B–C–A|成圈了：A–C–B–A|成圈了：B–C–A–B|成圈了：B–A–C–B/);
  assert.match(b.judged.after.join('；'), /现在选了 3 条、总权 7、连成 3 块/);
  const c = stu(s, 'unchoose g.A~B', 'choose');
  assert.match(c.judged.verdict.why, /拿掉了 A–B/);
  const v = stu(s, 'visit g.C', 'visit');
  assert.match(v.judged.verdict.why, /访问了 C（第 1 个）/);
  run(s, 'close g visit\nopen g tag');
  const t = stu(s, 'tag g.D 7', 'tag');
  assert.match(t.judged.verdict.why, /D 旁边写了 7/);
  assert.match(stu(s, 'tag g.D ∞', 'tag').judged.verdict.why, /D 旁边写了 ∞（原来是 7）/);
  // 老师自己演的不过裁判（话、画面照旧）
  assert.equal(s.apply(parseScript('choose g.C~D')[0], { by: 'teacher' }).judged, undefined);
  // 不判对错：wrong= 当场报
  assert.match(dryRun(make(G), 'open g choose wrong=mark')[0].error, /wrong=/);
});

test('审查盯 5：选的边在同名重造、跟着拨数重造以后还对得上；克隆带着', () => {
  const s = make('dial w = 4 range=1..9\ngraph g = A-B:{w} A-C:2 B-C:1\nchoose g.A~B g.B~C');
  run(s, 'set w 6');
  assert.deepEqual(s.objects.get('g').edges.filter((e) => e.chosen).map((e) => e.key), ['A~B', 'B~C']);
  assert.equal(m(s, 'weight(g)'), 7);
  assert.deepEqual(s.clone().objects.get('g').edges.filter((e) => e.chosen).map((e) => e.key), ['A~B', 'B~C']);
});

test('手势表里写的把手画面都交得出（一排格子、图）：名字在 ARMED_GRIPS 里、画法的 grips 里有——不然开了学生也点不到', async () => {
  const { ARMED_GRIPS, kindArmed } = await import('../kit/src/stage/gestures.js');
  const { rulesOf } = await import('../kit/src/stage/rules.js');
  const src = { array: await import('node:fs').then((fs) => fs.readFileSync(new URL('../kit/src/stage/types/array.view.js', import.meta.url), 'utf8')), graph: await import('node:fs').then((fs) => fs.readFileSync(new URL('../kit/src/stage/types/graph.view.js', import.meta.url), 'utf8')) };
  for (const type of ['array', 'graph']) {
    for (const [name, g] of Object.entries(rulesOf({ type }).gestures)) {
      for (const k of [].concat(g.gesture)) assert.equal(kindArmed(g, k), true, `${type} 的 ${name}（${k}）画面挂得上`);
      for (const grip of [g.on, g.from, g.to].flat().filter(Boolean)) {
        assert.ok(ARMED_GRIPS.has(grip), `${type} 的 ${name}：把手 ${grip} 要在 ARMED_GRIPS 里`);
        assert.match(src[type], new RegExp(`^    ${grip}: \\(stage, o`, 'm'), `${type} 的画法要交把手 ${grip}`);
      }
    }
  }
});
