// 视觉交互第 3 批 Task 1：三维图的解析拆成纯函数（kit/src/spacespec.js）。
// 老写法逐条照旧（按角度）；多认函数定义、偏导；微积分的图按弧度；goal、after。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpace, SPACE_CMDS } from '../kit/src/spacespec.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);
const one = (src) => parseSpace(src).cmds.at(-1);

test('老写法每种一条：字段、求值和以前一样', () => {
  const g = parseSpace(['title: 张成', 'view: -40 25', 'range: 3', 'let u = [1, 0, 1]', 'slider t 0 1 = 0.5 step=0.1 label="t"',
    'vector t*u + [0, 1, 1] from [0, 0, 1] color=yellow label=w drop', 'point [1, 2, 3], u color=pink label=P', 'segment u, [0, 0, 0] dashed',
    'line [0, 0, 1] dir [1, 1, 0] color=blue', 'span u, [0, 1, 1] color=blue', 'plane normal [0, 0, 1] at [0, 0, 1] size=0.5', 'plane normal [1, 1, 1]',
    'box u, [0, 1, 0], [0, 0, 1]', 'grid [[1,0,0],[0,1,0],[0,0,1]]', 'quadric [[2,0,0],[0,3,2],[0,2,3]] = 6', 'quadric [[1,0,0],[0,1,0],[0,0,-1]]',
    'text "原点" at [0, 0, 0] color=gray', 'show $\\det = {det(mat(u, [0,1,0], [0,0,1]))}$'].join('\n'));
  assert.equal(g.fields.title, '张成'); assert.equal(g.fields.view, '-40 25'); assert.equal(g.fields.range, '3');
  assert.deepEqual(g.cmds.map((c) => c.kind), ['let', 'slider', 'vector', 'point', 'segment', 'line', 'span', 'plane', 'plane', 'box', 'grid', 'quadric', 'quadric', 'text', 'show']);
  const [lt, sl, vec, pt, sg, ln, sp, pl, pl2, bx, gr, q1, q2, tx, sh] = g.cmds;
  const v = { u: [1, 0, 1], t: 0.5 };
  assert.deepEqual(lt.expr({}), [1, 0, 1]); assert.equal(lt.name, 'u');
  assert.deepEqual([sl.name, sl.min, sl.max, sl.init, sl.step, sl.mods.label], ['t', 0, 1, 0.5, 0.1, 't']);
  assert.deepEqual(vec.expr(v), [0.5, 1, 1.5]); assert.deepEqual(vec.from(v), [0, 0, 1]); assert.equal(vec.mods.drop, true); assert.equal(vec.mods.label, 'w');
  assert.deepEqual(pt.exprs.map((e) => e(v)), [[1, 2, 3], [1, 0, 1]]);
  assert.equal(sg.exprs.length, 2); assert.equal(sg.mods.dashed, true);
  assert.deepEqual(ln.p(v), [0, 0, 1]); assert.deepEqual(ln.d(v), [1, 1, 0]);
  assert.equal(sp.exprs.length, 2);
  assert.deepEqual(pl.n(v), [0, 0, 1]); assert.deepEqual(pl.at(v), [0, 0, 1]); assert.equal(pl.mods.size, '0.5'); assert.equal(pl2.at, null);
  assert.equal(bx.exprs.length, 3); assert.equal(gr.exprs.length, 1);
  assert.equal(q1.c(v), 6); assert.equal(q2.c(v), 1); assert.deepEqual(q1.A(v)[1], [0, 3, 2]);
  assert.equal(tx.label, '原点'); assert.deepEqual(tx.at(v), [0, 0, 0]);
  assert.match(sh.text, /det/);
  assert.equal(g.rad, false);
  assert.throws(() => parseSpace('line [0,0,0]'), /line 的写法/);
  assert.throws(() => parseSpace('plane [0,0,1]'), /plane 的写法/);
  assert.throws(() => parseSpace('这是什么'), /看不懂这一行/);
});

test('老的图按角度；写了函数定义的图按弧度；angle: 能明着定', () => {
  const old = parseSpace('vector [cos(60), sin(60), 0]');
  assert.equal(old.rad, false); near(old.cmds[0].expr({})[0], 0.5); near(old.cmds[0].expr({})[1], Math.sqrt(3) / 2);
  const calc = parseSpace('f(x, y) = sin(x)*y\nlet k = f(pi/2, 2)');
  assert.equal(calc.rad, true); near(calc.cmds[0].expr({}), 2);
  const forced = parseSpace('angle: deg\nf(x, y) = sin(x)*y\nlet k = f(90, 2)');
  assert.equal(forced.rad, false); near(forced.cmds[0].expr({}), 2);
  const rad = parseSpace('angle: rad\nvector [cos(pi/3), sin(pi/3), 0]');
  assert.equal(rad.rad, true); near(rad.cmds[0].expr({})[0], 0.5);
  assert.throws(() => parseSpace('angle: grad\nvector [1, 0, 0]'), /angle: 只能写 rad 或者 deg/);
});

test('函数定义、偏导、梯度在三维图里能用', () => {
  const g = parseSpace('f(x, y) = x^2 - y^2\nlet a = f_x(1, 2)\nlet b = f_y(1, 2)\nlet n = [-f_x(1, 2), -f_y(1, 2), 1]\nshow {f(1, 2)}');
  assert.equal(g.cmds[0].expr({}), 2); assert.equal(g.cmds[1].expr({}), -4); assert.deepEqual(g.cmds[2].expr({}), [-2, 4, 1]);
  assert.ok(g.defs.has('f'));
  assert.throws(() => parseSpace('sin(x) = 3'), /页面自带的函数/);
});

test('goal、after / before', () => {
  const g = parseSpace('slider t 0 1 = 0\nvector [t, 0, 0]\ngoal t = 1 tol=0.02 msg="到了"\ngoal t > 0.5\nshow $t = {t}$ after\nvector [0, 1, 0] after\npoint [0, 0, 1] before');
  const [, , g1, g2, sh, va, pb] = g.cmds;
  assert.equal(g1.kind, 'goal'); assert.equal(g1.lhs({ t: 0.3 }), 0.3); assert.equal(g1.rhs({}), 1); assert.equal(g1.mods.tol, '0.02'); assert.equal(g1.mods.msg, '到了');
  assert.equal(g2.cond({ t: 0.7 }), 1);
  assert.equal(sh.mods.after, true); assert.equal(sh.text, '$t = {t}$');
  assert.equal(va.mods.after, true); assert.equal(pb.mods.before, true);
  assert.throws(() => parseSpace('goal t = 1 after'), /goal 不能写 after/);
  assert.throws(() => parseSpace('goal'), /看不懂这一行|goal 的写法/);
  assert.ok(SPACE_CMDS.includes('goal'));
});

test('每条命令带着原文（报错、highlight 用）', () => {
  assert.equal(one('vector [1, 0, 0] color=blue').srcLine, 'vector [1, 0, 0] color=blue');
});

// —— Task 3：第 3 批的新命令 ——
const cmdsOf = (src) => parseSpace(src).cmds;

test('平面写方程、起名字；老写法照旧；直线起名字', () => {
  const [p1, p2, p3, old] = cmdsOf('plane p1 = 2x + y - z = 3 color=blue\nplane x + y = 1\nplane z = 2\nplane normal [0, 0, 1] at [0, 0, 1]');
  assert.equal(p1.name, 'p1'); assert.equal(p1.eq({ x: 1, y: 1, z: 0 }), 0); assert.equal(p1.eq({ x: 0, y: 0, z: 0 }), -3); assert.equal(p1.mods.color, 'blue');
  assert.equal(p2.name, undefined); assert.equal(p2.eq({ x: 1, y: 0, z: 5 }), 0);
  assert.equal(p3.name, undefined); assert.equal(p3.eq({ x: 9, y: 9, z: 2 }), 0);
  assert.equal(old.eq, undefined); assert.deepEqual(old.n({}), [0, 0, 1]);
  const [l1, l2] = cmdsOf('line l1 = [1, 0, 0] dir [1, 1, 1]\nline [0, 0, 1] dir [1, 0, 0]');
  assert.equal(l1.name, 'l1'); assert.deepEqual(l1.p({}), [1, 0, 0]); assert.deepEqual(l1.d({}), [1, 1, 1]); assert.equal(l2.name, undefined);
  assert.equal(parseSpace('plane x + y = 1').rad, false, '平面、直线不让图变成弧度');
});

test('meet / angle / foot 指着前面起了名字的东西', () => {
  const g = cmdsOf('plane p1 = x = 0\nplane p2 = y = 0\nplane p3 = z = 1\nline l1 = [0,0,0] dir [1,1,1]\nmeet p1, p2 color=yellow label=l\nmeet p1, p2, p3\nangle p1, l1\nfoot [1, 2, 3] on p3 label=H');
  assert.deepEqual(g[4].names, ['p1', 'p2']); assert.equal(g[4].mods.label, 'l');
  assert.deepEqual(g[5].names, ['p1', 'p2', 'p3']);
  assert.deepEqual(g[6].names, ['p1', 'l1']);
  assert.deepEqual(g[7].pt({}), [1, 2, 3]); assert.equal(g[7].on, 'p3');
  assert.throws(() => parseSpace('plane p1 = x = 0\nmeet p1, p9'), /没有叫 p9 的平面/);
  assert.throws(() => parseSpace('plane p1 = x = 0\nmeet p1'), /meet 的写法/);
  assert.throws(() => parseSpace('line l1 = [0,0,0] dir [1,0,0]\nplane p1 = x = 0\nmeet p1, l1'), /没有叫 l1 的平面/);
  assert.throws(() => parseSpace('angle a, b'), /没有叫 a 的/);
  assert.throws(() => parseSpace('foot [1,2,3]'), /foot 的写法/);
});

test('surface：显式（矩形、极坐标的底、over 区域）、参数、任意方程；能起名字', () => {
  const g = parseSpace(['f(x, y) = x^2 - y^2', 'region D = y from 0 to 1 - x for x 0 1', 'surface S = z = f(x, y) for x -2 2, y -1 1 color=blue',
    'surface z = 4 - x^2 - y^2 for r 0 2, t 0 2pi', 'surface z = x + y over D', 'surface z = sin(x)', 'surface T = [cos(u)*sin(v), sin(u)*sin(v), cos(v)] for u 0 2pi, v 0 pi',
    'surface x^2 + y^2 - z^2 = 1', 'surface Q = x^2/4 + y^2 = z'].join('\n'));
  assert.equal(g.rad, true);
  const [, s1, s2, s3, s4, s5, s6, s7] = g.cmds;
  assert.equal(s1.form, 'z'); assert.equal(s1.name, 'S'); assert.equal(s1.f({ x: 2, y: 1 }), 3);
  assert.equal(s1.base.kind, 'xy'); assert.deepEqual([s1.base.a({}), s1.base.b({}), s1.base.lo({}), s1.base.hi({})], [-2, 2, -1, 1]);
  assert.equal(s2.base.kind, 'polar'); near(s2.base.b({}), 2 * Math.PI); assert.equal(s2.base.hi({}), 2); assert.equal(s2.f({ x: 1, y: 1 }), 2);
  assert.equal(s3.base.kind, 'region'); assert.equal(s3.base.of, 'D');
  assert.equal(s4.base, null, '不写范围：按整张图的范围');
  assert.equal(s5.form, 'param'); assert.equal(s5.name, 'T'); assert.deepEqual(s5.params, ['u', 'v']);
  const pt = s5.p({ u: 0, v: Math.PI / 2 }); near(pt[0], 1); near(pt[1], 0); near(pt[2], 0, 1e-12);
  assert.equal(s6.form, 'eq'); assert.equal(s6.F({ x: 1, y: 0, z: 0 }), 0); assert.equal(s6.name, undefined);
  assert.equal(s7.form, 'eq'); assert.equal(s7.name, 'Q'); assert.equal(s7.F({ x: 2, y: 1, z: 2 }), 0);
  assert.throws(() => parseSpace('surface z = x for x 0 1'), /surface 的写法/);
  assert.throws(() => parseSpace('surface z = x over D'), /没有叫 D 的区域/);
  assert.throws(() => parseSpace('surface [u, v] for u 0 1, v 0 1'), /三个分量/);
});

test('curve、section、tangent', () => {
  const g = cmdsOf('f(x, y) = x*y\nsurface S = z = f(x, y)\ncurve C = [cos(t), sin(t), t/3] for t 0 4pi color=pink\nslider a -1 1 = 0.5\nsection x = a of S color=yellow\nsection z = 1 of S\ntangent S at [a, 1]\ntangent C at pi/2 plane');
  const [, c, , sx, sz, ts, tc] = g;
  assert.equal(c.name, 'C'); assert.equal(c.param, 't'); near(c.to({}), 4 * Math.PI); near(c.p({ t: 0 })[0], 1);
  assert.deepEqual([sx.axis, sx.of], ['x', 'S']); assert.equal(sx.at({ a: 0.5 }), 0.5); assert.equal(sz.axis, 'z');
  assert.equal(ts.of, 'S'); assert.deepEqual(ts.at({ a: 0.5 }), [0.5, 1]);
  assert.equal(tc.of, 'C'); near(tc.at({}), Math.PI / 2); assert.equal(tc.mods.plane, true);
  assert.throws(() => parseSpace('section x = 1 of S'), /没有叫 S 的曲面/);
  assert.throws(() => parseSpace('surface S = z = x\nsection w = 1 of S'), /section 的写法/);
  assert.throws(() => parseSpace('tangent S at [0, 0]'), /没有叫 S 的/);
});

test('revolve、disk、shell', () => {
  const g = cmdsOf('slider th 0 6.28 = 6.28\nrevolve V = sqrt(x) for x 0 4 about x upto=th color=blue\nrevolve W = x^2 for x 0 1 about y\ndisk V at 2 color=yellow\nshell W at 0.5');
  const [, rv, rw, dk, sh] = g;
  assert.equal(rv.name, 'V'); assert.equal(rv.axis, 'x'); assert.equal(rv.f({ x: 4 }), 2); assert.deepEqual([rv.a({}), rv.b({})], [0, 4]); assert.equal(rv.upto({ th: 3 }), 3);
  assert.equal(rw.axis, 'y'); assert.equal(rw.upto, null);
  assert.equal(dk.of, 'V'); assert.equal(dk.at({}), 2); assert.equal(sh.of, 'W');
  assert.throws(() => parseSpace('revolve x^2 for x 0 1'), /revolve 的写法/);
  assert.throws(() => parseSpace('revolve x^2 for x 0 1 about z'), /about 后面是 x 或者 y/);
  assert.throws(() => parseSpace('disk V at 1'), /没有叫 V 的旋转体/);
});

test('region（地面上）、solid、column、slice', () => {
  const g = cmdsOf(['region D = r from 0 to 2 for t 0 2pi', 'solid T = z from x^2 + y^2 to 4 over D color=blue', 'solid B = z from 0 to 1 - x - y for x 0 1, y 0 1 - x',
    'solid K = rho from 0 to 2 for phi 0 pi/4, t 0 2pi', 'let P = [1, 0] drag snap=0.1', 'column T at P lo=z1 hi=z2', 'slider h 0 4 = 1', 'slice T at h area=A'].join('\n'));
  const [d, t, b, k, p, col, , sl] = g;
  assert.equal(d.kind, 'region'); assert.equal(d.shape, 'r'); assert.equal(d.name, 'D');
  assert.equal(t.name, 'T'); assert.equal(t.form, 'z'); assert.equal(t.lo({ x: 1, y: 1 }), 2); assert.equal(t.hi({ x: 1, y: 1 }), 4); assert.equal(t.base.of, 'D');
  assert.equal(b.base.kind, 'xy'); assert.equal(b.base.hi({ x: 0.25 }), 0.75);
  assert.equal(k.form, 'sph'); near(k.phi[1]({}), Math.PI / 4); assert.equal(k.lo({}), 0); assert.equal(k.hi({}), 2);
  assert.equal(p.mods.drag, true); assert.deepEqual(p.expr({}), [1, 0]);
  assert.deepEqual([col.of, col.loName, col.hiName], ['T', 'z1', 'z2']); assert.deepEqual(col.at({ P: [1, 0] }), [1, 0]);
  assert.equal(sl.of, 'T'); assert.equal(sl.at({ h: 1 }), 1); assert.equal(sl.areaName, 'A');
  assert.throws(() => parseSpace('solid T = z from 0 to 1'), /solid 的写法/);
  assert.throws(() => parseSpace('column T at [0, 0]'), /没有叫 T 的/);
  assert.throws(() => parseSpace('solid K = rho from 0 to 2 for phi 0 pi/4, t 0 2pi\ncolumn K at [0, 0]'), /球面坐标的区域没有/);
});

test('field、normals、eigen、pick；这些命令让图按弧度（eigen、pick 不算）', () => {
  const g = parseSpace('surface S = [cos(u)*sin(v), sin(u)*sin(v), cos(v)] for u 0 2pi, v 0 pi\nfield [x, y, z] n=3 color=gray\nnormals S n=5\npick "点出驻点" at [0, 0], [1, 1] tol=0.3');
  const [, fd, nm, pk] = g.cmds;
  assert.deepEqual([fd.P({ x: 1, y: 2, z: 3 }), fd.Q({ x: 1, y: 2, z: 3 }), fd.R({ x: 1, y: 2, z: 3 })], [1, 2, 3]); assert.equal(fd.mods.n, '3');
  assert.equal(nm.of, 'S');
  assert.equal(pk.q, '点出驻点'); assert.deepEqual(pk.targets({}), [[0, 0], [1, 1]]); assert.equal(pk.tol, 0.3);
  const e = parseSpace('eigen [[2,0,0],[0,3,4],[0,4,9]] color=yellow');
  assert.equal(e.cmds[0].A({})[1][2], 4); assert.equal(e.rad, false);
  assert.throws(() => parseSpace('field [x, y]'), /field 的写法/);
  assert.throws(() => parseSpace('pick "x" at 1'), /\[x, y\]/);
  assert.throws(() => parseSpace('pick "x" at [0, 0] after'), /pick 不能写 after/);
  assert.equal(parseSpace('curve [t, t, t] for t 0 1').rad, true);
});

test('pick … on S：学生点在曲面上（目标还是地面上的 [x, y]）', () => {
  const g = parseSpace('surface S = z = x*y\npick "点出鞍点" on S at [0, 0] tol=0.3');
  assert.equal(g.cmds[1].on, 'S'); assert.deepEqual(g.cmds[1].targets({}), [[0, 0]]);
  assert.equal(parseSpace('pick "x" at [0, 0]').cmds[0].on, undefined);
  assert.throws(() => parseSpace('pick "x" on S at [0, 0]'), /没有叫 S 的曲面/);
  assert.throws(() => parseSpace('surface S = x^2 + y^2 + z^2 = 1\npick "x" on S at [0, 0]'), /z = f\(x, y\)/);
});

test('revolve … area=S：侧面积起名字（导数页面求）', () => {
  const g = parseSpace('revolve V = sqrt(x) for x 0 4 about x area=S');
  const c = g.cmds[0];
  assert.equal(c.areaName, 'S'); near(c.df({ x: 4 }), 0.25);
  assert.equal(parseSpace('revolve x^2 for x 0 1 about y').cmds[0].areaName, undefined);
  assert.throws(() => parseSpace('revolve x^2 for x 0 1 about y area=S'), /侧面积只算绕 x 轴的/);
});
