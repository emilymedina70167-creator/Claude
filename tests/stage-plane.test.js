// 舞台上的平面（kit/src/stage/types/plane.js）：造、部件的写法、向量和点、线性组合（跟着变、跟着拨数）、和、张成、线性变换和退回、拖、给老师看的现状
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { actText } from '../kit/src/stage/stage.js';
import { plane, UNIT, toWorld, fromWorld, snap, nameAt, planeBox, spanOf, exprText, showName, mul2, inv2, det2 } from '../kit/src/stage/types/plane.js';

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };
const one = (scene, line) => scene.apply(parseScript(line)[0]);
const err = (scene, line) => scene.check(parseScript(line)[0]);
const at = (s, name, id = 'p') => { const it = s.objects.get(id).items.find((i) => i.name === name); return [it.x, it.y]; };
const base = () => run(new Scene(), 'plane p range=-4..4\nvec p u = 2 1\nvec p v = -1 2');

test('造：range=-4..4（默认）、x= y= 分开写；原点在网格里；一格 UNIT 像素', () => {
  const s = run(new Scene(), 'plane p');
  const o = s.objects.get('p');
  assert.deepEqual([o.xlo, o.xhi, o.ylo, o.yhi], [-4, 4, -4, 4]);
  const b = planeBox(o);
  assert.equal(b.w, 8 * UNIT);
  const O = toWorld(o, 0, 0);
  assert.deepEqual([O.x, O.y], [b.x + b.w / 2, b.y + b.h / 2]);
  assert.ok(UNIT >= 50 && UNIT <= 60);
  // y 朝上：y 大的在上面
  assert.ok(toWorld(o, 0, 2).y < O.y);
  const q = run(new Scene(), 'plane q x=-1..5 y=0..3').objects.get('q');
  assert.deepEqual([q.xlo, q.xhi, q.ylo, q.yhi], [-1, 5, 0, 3]);
  assert.equal(run(new Scene(), 'plane r range=3').objects.get('r').xlo, -3);
  assert.match(err(new Scene(), 'plane p range=1..4'), /要把原点包在里面/);
  assert.match(err(new Scene(), 'plane p range=-20..4'), /最多到 ±10/);
  assert.match(err(new Scene(), 'plane p range=abc'), /range 要写成 -4\.\.4/);
  // 拖的时候屏幕上的一点 → 坐标，吸到格点上、不出网格
  assert.deepEqual(fromWorld(o, toWorld(o, 1.5, -2)), { x: 1.5, y: -2 });
  assert.deepEqual(snap(o, { x: 2.4, y: -0.6 }), { x: 2, y: -1 });
  assert.deepEqual(snap(o, { x: 9, y: -7 }), { x: 4, y: -4 });
});

test('向量：精确坐标、默认按顺序给颜色、再写一次挪到新坐标；写错报怎么写', () => {
  const s = base();
  one(s, 'vec p w = 1/2 -3');
  assert.deepEqual(at(s, 'w'), ['1/2', '-3']);
  assert.deepEqual(s.objects.get('p').items.map((i) => i.paint), ['g1', 'g2', 'g3']);
  const fx = one(s, 'vec p u = (3, -1)');
  assert.deepEqual(fx.before, ['2', '1']);
  assert.equal(fx.fresh, false);
  assert.deepEqual(at(s, 'u'), ['3', '-1']);
  one(s, 'vec p u = 3,1 color=g5');
  assert.equal(s.parts('p.u')[0].paint, 'g5');
  assert.match(err(s, 'vec p u 2 1'), /要写成 vec p u = 2 1/);
  assert.match(err(s, 'vec p u ='), /「=」后面要写坐标或式子/);
  assert.match(err(s, 'vec p u = 1 2 3'), /坐标要两个数（写了 3 个）/);
  assert.match(err(s, 'vec p u = 1 2 color=g9'), /颜色只有 g1～g6/);
  assert.match(err(s, 'vec q u = 1 2'), /vec 后面先写平面的名字（比如 vec p …）：舞台上没有「q」/);
  assert.match(err(run(new Scene(), 'array a = 1'), 'vec a u = 1 2'), /一排格子没有「vec」（平面才有）/);
  assert.match(err(s, 'vec p 2u = 1 2'), /名字用字母开头/);
});

test('线性组合：2u - v 精确；u、v 变了它跟着变；系数能是拨的数（拨了跟着变）', () => {
  const s = base();
  one(s, 'vec p w = 2u - v');
  assert.deepEqual(at(s, 'w'), ['5', '0']);
  one(s, 'vec p u = 1 1');
  assert.deepEqual(at(s, 'w'), ['3', '0'], 'u 挪了 w 跟着重新算');
  one(s, 'vec p h = 1/2 u + (1/3)v');
  assert.deepEqual(at(s, 'h'), ['1/6', '7/6']);
  run(s, 'dial k = 2 range=0-4 at=p\nvec p z = k u');
  assert.deepEqual(at(s, 'z'), ['2', '2']);
  one(s, 'set k 3');
  assert.deepEqual(at(s, 'z'), ['3', '3'], '拨一下就跟着变');
  one(s, 'vec p y = -k v');
  assert.deepEqual(at(s, 'y'), ['3', '-6']);
  const items = s.objects.get('p').items;
  assert.equal(exprText(items.find((i) => i.name === 'w').expr), '2u - v');
  assert.equal(exprText(items.find((i) => i.name === 'h').expr), '(1/2)u + (1/3)v');
  assert.equal(exprText(items.find((i) => i.name === 'z').expr), 'k·u');
  assert.equal(exprText(items.find((i) => i.name === 'y').expr), '-k·v');
  // 写错的
  assert.match(err(s, 'vec p w = 2x'), /平面 p 上没有向量「2x」/);
  assert.match(err(s, 'vec p w = q u'), /「q」不是数，也不是拨的数/);
  assert.match(err(s, 'vec p w = w + u'), /w 不能用自己来算/);
  assert.match(err(s, 'vec p u = w + v'), /u 和别的向量转着圈互相算/);
  assert.match(err(s, 'vec p w = u +'), /没写完/);
});

test('点：只能写坐标；名字不能和向量重；sum 要两项以上、画首尾相接', () => {
  const s = base();
  one(s, 'point p P = 2 3');
  assert.equal(s.parts('p.P')[0].kind, 'pt');
  assert.equal(s.parts('p.P')[0].paint, null);
  assert.match(err(s, 'point p P = u + v'), /点要写坐标/);
  assert.match(err(s, 'point p u = 1 1'), /「u」已经是平面上的向量了/);
  const fx = one(s, 'sum p w = u + v');
  assert.equal(fx.fresh, true);
  const w = s.parts('p.w')[0];
  assert.equal(w.guide, true);
  assert.deepEqual([w.x, w.y], ['1', '3']);
  assert.match(err(s, 'sum p z = 2u'), /sum 要两项以上/);
  assert.match(err(s, 'sum p z = 1 2'), /坐标用 vec/);
  // 再用 vec 定义就不画首尾相接了；unsum 也收起
  one(s, 'sum p w = u + v');
  one(s, 'unsum p');
  assert.equal(s.parts('p.w')[0].guide, false);
});

test('部件的写法：p.u 向量、p.P 点；写错报有哪些；话里的小块写名字（下标），图上贴字贴在箭头尖', () => {
  const s = run(base(), 'point p P = 1 -1\nvec p a1 = 3 3');
  assert.equal(s.refOf(s.parts('p.u')[0]), 'p.u');
  assert.equal(s.parts('p').length, 4);
  assert.throws(() => s.parts('p.x'), /平面写 p\.u（向量 u）、p\.P（点 P），p 上有的是：u、v、P、a1/);
  assert.throws(() => s.parts('p#1'), /平面写 p\.u/);
  assert.throws(() => run(new Scene(), 'plane q').parts('q.u'), /q 上还没有（先 vec q u = 2 1）/);
  assert.equal(s.parts('p.a1')[0].label, 'a₁');
  assert.equal(showName('α2'), 'α₂');
  assert.equal(showName('u'), 'u');
  // 部件的框就是箭头尖那一块（贴字、镜头、点都对着它）
  const o = s.objects.get('p');
  const box = s.partBox(s.parts('p.u')[0]);
  const T = toWorld(o, 2, 1);
  assert.ok(box.x < T.x && box.x + box.w > T.x && box.y < T.y && box.y + box.h > T.y);
  // 名字贴在尖的前面一点（往右的向量贴在右上）
  const n = nameAt(o, 2, 0);
  assert.ok(n.x > toWorld(o, 2, 0).x && n.y < toWorld(o, 2, 0).y);
  assert.deepEqual(dryRun(s, 'say "看 {p.u} 和 {p.P}"\nglow p.u\npaint p.v g4\nlabel t p.u "这一根" side=above\ncamera p\nask tap p "点 {p.v}" expect=p.v'), []);
});

test('线性变换：网格和自由的向量、点一起变过去（精确），跟着算的照式子跟着走；再变一次是接着变；退回原样', () => {
  const s = run(base(), 'point p P = 1 1\nsum p w = u + v');
  const fx = one(s, 'transform p = 1 1 / 0 1');
  assert.deepEqual(fx.from, [['1', '0'], ['0', '1']]);
  assert.deepEqual(fx.to, [['1', '1'], ['0', '1']]);
  assert.deepEqual(at(s, 'u'), ['3', '1']);
  assert.deepEqual(at(s, 'v'), ['1', '2']);
  assert.deepEqual(at(s, 'P'), ['2', '1']);
  assert.deepEqual(at(s, 'w'), ['4', '3'], 'w = u + v 跟着变');
  const u = s.parts('p.u')[0];
  assert.deepEqual([u.hx, u.hy], ['2', '1'], '变换前的坐标留着');
  // 再变一次：先剪切、再旋转 90°，网格的矩阵是乘起来的
  one(s, 'transform p [[0 -1][1 0]]');
  assert.deepEqual(s.objects.get('p').M, [['0', '-1'], ['1', '1']]);
  assert.deepEqual(at(s, 'u'), ['-1', '3']);
  // 变换以后新加的向量：写的是现在看到的坐标；退回原样时也倒回去
  one(s, 'vec p z = 1 0');
  one(s, 'untransform p');
  assert.deepEqual(at(s, 'u'), ['2', '1']);
  assert.deepEqual(at(s, 'w'), ['1', '3']);
  assert.deepEqual(at(s, 'z'), ['1', '-1'], 'z 照 M 的逆倒回去');
  assert.deepEqual(s.objects.get('p').M, [['1', '0'], ['0', '1']]);
  assert.deepEqual(mul2([['1', '1'], ['0', '1']], [['2', '0'], ['0', '3']]), [['2', '3'], ['0', '3']]);
  assert.equal(det2([['1', '2'], ['2', '4']]).zero, true);
  assert.equal(inv2([['1', '2'], ['2', '4']]), null);
  assert.deepEqual(inv2([['2', '0'], ['0', '4']]), [['1/2', '0'], ['0', '1/4']]);
});

test('压扁的变换（行列式为 0）：这时加的向量倒不回去，退回原样时留在原地', () => {
  const s = base();
  one(s, 'transform p = 1 2 / 2 4');
  assert.deepEqual(at(s, 'u'), ['4', '8']);
  one(s, 'vec p z = 1 1');
  assert.equal(s.parts('p.z')[0].hx, null);
  one(s, 'untransform p');
  assert.deepEqual(at(s, 'u'), ['2', '1']);
  assert.deepEqual(at(s, 'z'), ['1', '1']);
});

test('transform 用舞台上的 2×2 矩阵；写错的说清楚', () => {
  const s = run(base(), 'matrix A = 2 0 / 0 1/2 beside=p\nmatrix B = 1 2 3 / 4 5 6');
  // beside=p：矩阵放在平面右边
  const A = s.objects.get('A'), pb = s.objects.get('p') && s.objectBox('p');
  assert.ok(A.origin.x > pb.x + pb.w);
  assert.equal(one(s, 'transform p A').by, 'A', '画面让 A 闪一下');
  assert.deepEqual(at(s, 'u'), ['4', '1/2']);
  assert.equal(one(s, 'transform p = 1 0 / 0 1').by, null);
  assert.match(err(s, 'transform p B'), /「B」不是 2×2 的矩阵/);
  assert.match(err(s, 'transform p = 1 2 3 / 4 5 6'), /transform 要一个 2×2 矩阵/);
  assert.match(err(s, 'transform p = 1 x / 0 1'), /transform 要一个 2×2 矩阵/);
  assert.match(err(s, 'transform p'), /transform 要一个 2×2 矩阵/);
  run(s, 'matrix C = 1 0 / 0 1\nproduct D = C C');
  assert.match(err(s, 'transform p D'), /D\.1,1 还空着/);
});

test('张成：一个向量是一条线，两个不共线是整个平面，共线还是一条线，零向量只有原点；stay 停在那时的样子', () => {
  const s = base();
  one(s, 'span p u');
  one(s, 'span p u v');
  const o = s.objects.get('p');
  assert.deepEqual(spanOf(o, o.spans[0]), { kind: 'line', dir: ['2', '1'] });
  assert.deepEqual(spanOf(o, o.spans[1]), { kind: 'plane' });
  assert.equal(o.spans[0].color, 'g1', '颜色跟着第一个向量');
  // 学生把 v 拖到和 u 共线：张成塌成一条线
  one(s, 'vec p v = -4 -2');
  assert.equal(spanOf(o, o.spans[1]).kind, 'line');
  one(s, 'vec p n = 0 0');
  one(s, 'span p n');
  assert.equal(spanOf(o, o.spans.at(-1)).kind, 'point');
  // 同一组向量再画一次就换掉；stay：之后 u 动了它不动，没写 stay 的跟着动
  one(s, 'span p u stay color=g4');
  one(s, 'span p v');
  one(s, 'vec p u = 0 3');
  one(s, 'vec p v = 1 0');
  assert.deepEqual(spanOf(o, o.spans.find((x) => x.id === 'u')).dir, ['2', '1']);
  assert.deepEqual(spanOf(o, o.spans.find((x) => x.id === 'v')).dir, ['1', '0']);
  assert.equal(spanOf(o, o.spans.find((x) => x.id === 'u+v')).kind, 'plane');
  assert.match(s.stateText(), /张成：v 张成一条过原点的直线（方向 \(1, 0\)），粉色涂着/);
  assert.match(s.stateText(), /张成：u 张成一条过原点的直线（方向 \(2, 1\)），金色涂着（停在画的时候，之后不跟着动）/);
  assert.match(err(s, 'span p'), /span 后面写一个或两个向量/);
  assert.match(err(s, 'span p u v n'), /span 后面写一个或两个向量/);
  assert.match(err(s, 'span p zz'), /平面 p 上没有向量「zz」/);
  one(s, 'unspan p u');
  assert.ok(o.spans.every((x) => !x.of.includes('u')));
  one(s, 'unspan p');
  assert.equal(o.spans.length, 0);
});

test('拿掉向量：跟着它算的定在现在的位置；张成、贴的字、连线一起收掉', () => {
  const s = run(base(), 'vec p w = u + v\nspan p u\nlabel t p.u "这根"\nlink p.u p.v');
  one(s, 'unvec p u');
  const o = s.objects.get('p');
  assert.deepEqual(o.items.map((i) => i.name), ['v', 'w']);
  assert.equal(o.items[1].expr, null);
  assert.deepEqual(at(s, 'w'), ['1', '3']);
  assert.equal(o.spans.length, 0);
  assert.equal(s.labels.has('t'), false);
  assert.equal(s.links.size, 0);
  assert.match(err(s, 'unvec p zz'), /平面 p 上没有「zz」/);
  one(s, 'unvec p');
  assert.equal(o.items.length, 0);
});

test('学生拖：舞台照「vec p u = 3 1」改场景，跟着算的跟着走；告诉老师新坐标', () => {
  const s = run(base(), 'vec p w = u + v\nask drag p.u "拖一下"');
  assert.equal(s.waiting.kind, 'drag');
  assert.equal(plane.drag, true);
  one(s, 'vec p u = 3 -1');
  assert.deepEqual(at(s, 'w'), ['2', '1']);
  // 拖动画面交回来的那一条（plane.view.js 的 drag 也是这样写的）
  const act = { type: 'drag', ref: 'p.u', from: ['2', '1'], to: ['3', '-1'], text: '学生把向量 p.u 的末端拖到了 (3, -1)（原来在 (2, 1)），舞台已经照做了' };
  assert.equal(actText(act), act.text);
  // 跟着算的也能拖：拖完它就自由了
  one(s, 'vec p w = 0 2');
  assert.equal(s.parts('p.w')[0].expr, null);
});

test('给老师看的现状：每个向量的坐标、式子、颜色、变换前、出了网格；变换过的网格；张成', () => {
  const s = run(base(), 'sum p w = u + v\ntransform p = 2 0 / 0 2\nglow p.u');
  const t = s.stateText();
  assert.match(t, /（平面：名字\.u 是向量 u/);
  assert.match(t, /平面 p（x 从 -4 到 4，y 从 -4 到 4；一格是 1）：/);
  assert.match(t, /向量 u = \(4, 2\)（蓝、亮），变换前是 \(2, 1\)/);
  assert.match(t, /向量 w = u \+ v = \(2, 6\)（绿、首尾相接画着、出了网格）/);
  assert.match(t, /网格做过线性变换：现在是矩阵 \(2 0 \/ 0 2\) 变过去的样子（untransform 退回原样）/);
  assert.match(run(new Scene(), 'plane q').stateText(), /上面还没有向量和点/);
});

test('平面放在已有东西下面；镜头要框进来的地方包括箭头尖和名字', () => {
  const s = run(new Scene(), 'array a = 1 2 3\nplane p range=-2..2\nvec p u = 6 0');
  const o = s.objects.get('p');
  assert.ok(o.origin.y > 64 + 22);
  const box = s.objectBox('p');
  assert.ok(box.x + box.w > toWorld(o, 6, 0).x, '出了网格的箭头尖也框进来');
});

test('说明里的例子照抄能演：一行不错', () => {
  assert.deepEqual(dryRun(new Scene(), plane.example), []);
  const s = run(new Scene(), plane.example);
  assert.deepEqual(at(s, 'w'), ['4', '3']);
  assert.equal(s.waiting.kind, 'drag');
  assert.doesNotMatch(plane.doc + plane.hint, /[他她]/);
});

test('扣着的向量：学生看的小块写它的名字，不写坐标；写给老师的说一声扣着', async () => {
  const { chipTextOf, tapValueOf } = await import('../kit/src/stage/scene.js');
  const s = run(base(), 'cover p.u');
  const o = s.objects.get('p');
  const [u] = s.parts('p.u');
  assert.equal(u.covered, true);
  assert.equal(chipTextOf(u, o), 'u');
  assert.doesNotMatch(chipTextOf(u, o), /2/);
  assert.equal(tapValueOf(u), 'u，扣着');
});
