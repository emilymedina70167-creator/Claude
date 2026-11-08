// 舞台上跟着算的量（kit/src/stage/value.js）：一行里的 {…} 拆出来、式子里的名字换成舞台上的值、依赖、按依赖排先后、查环；
// 接进场景以后：格里的 {k}、整个矩阵 = {A + B}、{P^-1}、平面上的 {A v}，依赖一变当场重算；成环、不可逆报出来，原来的值不动；跟着算的学生动不了
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { parseLive, evalLive, liveOrder, scopeOf, numText } from '../kit/src/stage/value.js';
import { Q } from '../kit/src/exact.js';

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };
const one = (scene, line) => scene.apply(parseScript(line)[0]);
const err = (scene, line) => scene.check(parseScript(line)[0]);
/** 矩阵现在每一行的数 */
const rows = (s, id) => {
  const o = s.objects.get(id);
  return Array.from({ length: o.rows }, (_, i) => o.cells.filter((x) => x.r === i + 1).sort((a, b) => a.c - b.c).map((x) => x.value));
};
const at = (s, name, id = 'p') => { const it = s.objects.get(id).items.find((i) => i.name === name); return [it.x, it.y]; };
/** fx.derived 里某样东西变了的那几格 */
const changedOf = (fx, id) => (fx.derived || []).filter((d) => d.id === id).flatMap((d) => d.changed);

test('parseLive：一行里的 {…} 拆出来，引号里的不动；没收尾、空的、套着的报出来', () => {
  assert.deepEqual(parseLive('1 {k} / 0 1').parts, [{ k: 'text', v: '1 ' }, { k: 'expr', v: 'k' }, { k: 'text', v: ' / 0 1' }]);
  assert.deepEqual(parseLive('{ A + B }').parts, [{ k: 'expr', v: 'A + B' }]);
  assert.deepEqual(parseLive('A-B:{w1} B-C:4').parts, [{ k: 'text', v: 'A-B:' }, { k: 'expr', v: 'w1' }, { k: 'text', v: ' B-C:4' }]);
  // 引号里的 {a.3} 是话里的小块，不是式子
  assert.deepEqual(parseLive('card q = "看 {a.3}" 「{d}」').parts, [{ k: 'text', v: 'card q = "看 {a.3}" 「{d}」' }]);
  assert.deepEqual(parseLive('1 2 / 3 4').parts, [{ k: 'text', v: '1 2 / 3 4' }]);
  assert.throws(() => parseLive('1 {k / 0 1'), /没有收尾/);
  assert.throws(() => parseLive('1 {} 2'), /\{\} 里要写式子/);
  assert.throws(() => parseLive('1 {a{b}} 2'), /不能再套/);
  assert.throws(() => parseLive('1 k} 2'), /多了一个 \}/);
});

test('evalLive：拨数、矩阵、部件、平面上的向量都能写；省略乘号；依赖是用到的名字；写错、算不出来的错误里有原式子', () => {
  const sc = run(new Scene(), 'dial k = 2 range=-3..3\nmatrix A = 2 0 / 0 1\nmatrix B = 1 2 / 3 4\nplane p\nvec p v = 1 1');
  const r = evalLive('{A v}', sc, { plane: 'p' });
  assert.deepEqual(r.value.map(String), ['2', '1']);
  assert.deepEqual(r.deps, ['A', 'p.v']);
  assert.equal(evalLive('k B.2,1 + 1', sc).value.toString(), '7');
  assert.deepEqual(evalLive('k B.2,1 + 1', sc).deps, ['k', 'B.2,1']);
  assert.deepEqual(evalLive('p.v', sc).value.map(String), ['1', '1']);
  assert.deepEqual(evalLive('A B', sc).value.map((r) => r.map(String)), [['2', '4'], ['3', '4']]);
  assert.deepEqual(evalLive("B'", sc).value.map((r) => r.map(String)), [['1', '3'], ['2', '4']]);
  assert.equal(evalLive('det(B)', sc).value.toString(), '-2');
  assert.deepEqual(evalLive('B⁻¹', sc).value.map((r) => r.map(String)), [['-2', '1'], ['3/2', '-1/2']]);
  assert.throws(() => evalLive('A + z', sc), /「\{A \+ z\}」里的「z」不是拨数，也不是舞台上的东西/);
  assert.throws(() => evalLive('Z.1,1', sc), /舞台上没有「Z」/);
  assert.throws(() => evalLive('A + [1, 2, 3]', sc), /「\{A \+ \[1, 2, 3\]\}」算不出来/);
  assert.throws(() => evalLive('p', sc), /平面/);
});

test('scopeOf：拨数是数、矩阵是 Q 的二维数组、平面上的向量是列向量（给了平面才有）；还空着的格用到才报', () => {
  const sc = run(new Scene(), 'dial k = 0.5 range=-3..3\nmatrix A = 1 2 / 3 4\nmatrix B = 1 / 2\nproduct C = A B\nplane p\nvec p u = 2 1');
  const v = scopeOf(sc);
  assert.ok(v.k instanceof Q);
  assert.equal(v.k.toString(), '1/2');
  assert.deepEqual(v.A.map((r) => r.map(String)), [['1', '2'], ['3', '4']]);
  assert.equal('u' in v, false);
  assert.deepEqual(scopeOf(sc, { plane: 'p' }).u.map(String), ['2', '1']);
  assert.throws(() => v.C, /C\.1,1 还空着/);
  assert.throws(() => evalLive('C', sc), /算不出来：C\.1,1 还空着/);
});

test('liveOrder：按依赖排先后；成环时抛错，列出环上的名字', () => {
  const order = liveOrder([{ id: 'S', deps: ['A', 'T.1,1'] }, { id: 'T', deps: ['k'] }, { id: 'p.w', deps: ['S', 'p.v'] }]);
  assert.ok(order.indexOf('T') < order.indexOf('S') && order.indexOf('S') < order.indexOf('p.w'));
  assert.throws(() => liveOrder([{ id: 'X', deps: ['Y'] }, { id: 'Y', deps: ['X.1,1'] }]), (e) => /X/.test(e.message) && /Y/.test(e.message) && /转着圈/.test(e.message));
  assert.throws(() => liveOrder([{ id: 'X', deps: ['X'] }]), /X 跟着自己算/);
  assert.equal(numText(new Q(1n, 2n)), '0.5');
  assert.equal(numText(new Q(-1n, 3n)), '-1/3');
});

test('格里的 {k} 跟着拨数变', () => {
  const sc = run(new Scene(), 'dial k = 1 range=-3..3\nmatrix M = 1 {k} / 0 1');
  assert.deepEqual(rows(sc, 'M'), [['1', '1'], ['0', '1']]);
  const fx = one(sc, 'set k 3');
  assert.equal(rows(sc, 'M')[0][1], '3');
  assert.deepEqual(changedOf(fx, 'M'), [{ ref: 'M.1,2', from: '1', to: '3' }]);
  // 格里只认拨数名或部件
  assert.match(err(sc, 'matrix N = 1 {k + 1} / 0 1'), /只能写拨数的名字/);
  assert.match(err(sc, 'matrix N = 1 {q} / 0 1'), /只能写拨数的名字/);
  // 格里写一格也行：跟着那一格变
  run(sc, 'matrix B = 5 6 / 7 8\nmatrix N = {B.2,1} 0 / 0 {k}');
  assert.deepEqual(rows(sc, 'N'), [['7', '0'], ['0', '3']]);
  const fx2 = one(sc, 'write B.2,1 9');
  assert.deepEqual(changedOf(fx2, 'N'), [{ ref: 'N.1,1', from: '7', to: '9' }]);
});

test('整个矩阵 {A + B}', () => {
  const sc = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nmatrix S = {A + B}');
  assert.deepEqual(rows(sc, 'S'), [['2', '2'], ['3', '5']]);
  const fx = one(sc, 'write A.1,1 5');
  assert.deepEqual(rows(sc, 'S'), [['6', '2'], ['3', '5']]);
  assert.deepEqual(changedOf(fx, 'S'), [{ ref: 'S.1,1', from: '2', to: '6' }]);
  // 画面要闪的部件跟着交出来
  assert.ok(fx.derived.find((d) => d.id === 'S').parts.every((p) => p.obj === 'S'));
  // 舞台现状里写着它是跟着算的
  assert.match(sc.stateText(), /跟着算的.*S = \{A \+ B\}/);
  // 维数对不上：报出来
  assert.match(err(sc, 'matrix T = {A + [1, 2]}'), /算不出来/);
});

test('{P^-1}', () => {
  const sc = run(new Scene(), 'matrix P = 2 1 / 1 1\nmatrix P2 = {P^-1}');
  assert.deepEqual(rows(sc, 'P2'), [['1', '-1'], ['-1', '2']]);
  // 乘起来是单位矩阵（链着的：PP 跟着 P、P2）
  one(sc, 'matrix I2 = {P P2}');
  assert.deepEqual(rows(sc, 'I2'), [['1', '0'], ['0', '1']]);
  one(sc, 'write P.1,1 3');
  assert.deepEqual(rows(sc, 'P2'), [['1/2', '-1/2'], ['-1/2', '3/2']]);
  assert.deepEqual(rows(sc, 'I2'), [['1', '0'], ['0', '1']]);
});

test('{A v}', () => {
  const sc = run(new Scene(), 'plane p range=-4..4\nmatrix A = 2 0 / 0 1\nvec p v = 1 1\nvec p w = {A v}');
  assert.deepEqual(at(sc, 'w'), ['2', '1']);
  const fx = one(sc, 'vec p v = 2 0');
  assert.deepEqual(at(sc, 'w'), ['4', '0']);
  assert.deepEqual(changedOf(fx, 'p'), [{ ref: 'p.w', from: '(2, 1)', to: '(4, 0)' }]);
  // A 变了也跟着变；跟着 w 的线性组合也跟着走
  one(sc, 'vec p z = w + v');
  one(sc, 'write A.1,1 1');
  assert.deepEqual(at(sc, 'w'), ['2', '0']);
  assert.deepEqual(at(sc, 'z'), ['4', '0']);
  assert.match(sc.stateText(), /向量 w = \{A v\} = \(2, 0\)/);
  assert.match(sc.stateText(), /跟着算的.*p\.w = \{A v\}/);
  // 写错的
  assert.match(err(sc, 'vec p q = {A}'), /平面上的向量要两个数/);
  assert.match(err(sc, 'vec p q = 2 {k}'), /整个式子写在一对 \{\} 里/);
  assert.match(err(sc, 'sum p q = {A v}'), /sum 不写 \{…\}/);
  // 再写成坐标：不跟着算了
  one(sc, 'vec p w = 1 1');
  one(sc, 'write A.1,1 3');
  assert.deepEqual(at(sc, 'w'), ['1', '1']);
  assert.doesNotMatch(sc.stateText(), /跟着算的/);
});

test('环', () => {
  const sc = run(new Scene(), 'matrix Y = 1 2 / 3 4\nmatrix X = {Y}');
  assert.deepEqual(rows(sc, 'X'), [['1', '2'], ['3', '4']]);
  const e = err(sc, 'matrix Y = {X}');
  assert.ok(e && /X/.test(e) && /Y/.test(e) && /转着圈/.test(e), e);
  assert.throws(() => one(sc, 'matrix Y = {X}'), /转着圈/);
  // 已有的东西不动
  assert.deepEqual(rows(sc, 'Y'), [['1', '2'], ['3', '4']]);
  assert.equal(sc.objects.get('Y').live, undefined);
  // 自己跟着自己
  assert.match(err(sc, 'matrix X = {X + Y}'), /X 跟着自己算/);
  // 平面上：经过线性组合绕回来的环
  run(sc, 'plane p\nmatrix A = 2 0 / 0 1\nvec p u = 1 1\nvec p z = 1 0\nvec p w = {A z}');
  assert.match(err(sc, 'vec p z = w + u'), /转着圈/);
  // 乘积绕回来的环
  run(sc, 'matrix B = 1 0 / 0 1\nproduct C = A B\nmul C');
  assert.match(err(sc, 'matrix A = {C}'), /转着圈/);
});

test('不可逆', () => {
  const sc = run(new Scene(), 'matrix P = 1 1 / 1 1');
  assert.throws(() => one(sc, 'matrix Q = {P^-1}'), (e) => /不可逆/.test(e.message) && /P\^-1/.test(e.message));
  // 已有的东西不动
  assert.equal(sc.objects.has('Q'), false);
  assert.deepEqual(rows(sc, 'P'), [['1', '1'], ['1', '1']]);
  // 依赖变了才算不出来：不崩，原来的值不动，报给老师（舞台现状里写着、fx.derived 里交出来一次）
  run(sc, 'matrix R = 2 1 / 1 1\nmatrix R2 = {R^-1}');
  const fx = one(sc, 'write R.1,1 1');
  assert.deepEqual(rows(sc, 'R2'), [['1', '-1'], ['-1', '2']]);
  const bad = fx.derived.find((d) => d.id === 'R2');
  assert.match(bad.error, /不可逆/);
  assert.deepEqual(bad.changed, []);
  assert.match(sc.stateText(), /R2 = \{R\^-1\}（现在算不出来：.*不可逆.*停在上一次算出来的数）/);
  // 同一个错不重复交
  assert.equal((one(sc, 'glow R.1,1').derived || []).length, 0);
  // 又能算了：跟着变回来，错也收起
  const fx2 = one(sc, 'write R.1,1 3');
  assert.deepEqual(rows(sc, 'R2'), [['1/2', '-1/2'], ['-1/2', '3/2']]);
  assert.ok(changedOf(fx2, 'R2').length);
  assert.doesNotMatch(sc.stateText(), /算不出来/);
});

test('跟着算的不能 open', () => {
  const sc = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nmatrix S = {A + B}\nplane p\nmatrix T = 2 0 / 0 1\nvec p v = 1 1\nvec p w = {T v}');
  assert.match(err(sc, 'open S edit'), /S 是跟着算的，学生动不了/);
  assert.match(err(sc, 'open p.w drag'), /p\.w 是跟着算的，学生动不了/);
  // 它依赖的能开放
  assert.equal(err(sc, 'open A edit'), null);
  assert.equal(err(sc, 'open p.v drag'), null);
});

test('老师改跟着算的矩阵：手写的一格不再跟着算；做了行变换就是普通的矩阵', () => {
  const sc = run(new Scene(), 'dial k = 1 range=-3..3\nmatrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nmatrix S = {A + B}\nmatrix M = {k} {k} / 0 1');
  one(sc, 'write S.1,2 9');
  run(sc, 'write A.1,2 5\nwrite A.1,1 7');
  assert.deepEqual(rows(sc, 'S'), [['8', '9'], ['3', '5']]);
  one(sc, 'write M.1,1 4');
  one(sc, 'set k 2');
  assert.deepEqual(rows(sc, 'M'), [['4', '2'], ['0', '1']]);
  one(sc, 'rowop S r2 - r1');
  one(sc, 'write A.2,2 0');
  assert.deepEqual(rows(sc, 'S'), [['8', '9'], ['-5', '-4']]);
  assert.doesNotMatch(sc.stateText(), /S = \{A \+ B\}/);
});

test('别的东西（一排格子、图）造它的那一行能写 {式子}：依赖一变照新的数重新造，名字和位置不变', () => {
  const sc = run(new Scene(), 'dial k = 2 range=0..5\narray a = 1 {k} 3\ngraph g = A-B:{k + 1} B-C:4');
  assert.deepEqual(sc.objects.get('a').cells.map((x) => x.value), ['1', '2', '3']);
  assert.equal(sc.objects.get('g').edges.find((e) => e.key === 'A~B').w, '3');
  const origin = { ...sc.objects.get('a').origin };
  const fx = one(sc, 'set k 4');
  assert.deepEqual(sc.objects.get('a').cells.map((x) => x.value), ['1', '4', '3']);
  assert.deepEqual(sc.objects.get('a').origin, origin);
  assert.equal(sc.objects.get('g').edges.find((e) => e.key === 'A~B').w, '5');
  assert.deepEqual(changedOf(fx, 'a'), [{ ref: 'a', expr: 'k', from: '2', to: '4' }]);
  assert.deepEqual(changedOf(fx, 'g'), [{ ref: 'g', expr: 'k + 1', from: '3', to: '5' }]);
  assert.match(sc.stateText(), /跟着算的.*array a = 1 \{k\} 3/);
  assert.match(err(sc, 'open a'), /a 是跟着算的，学生动不了/);
  // 题卡、句子的引号里的 {…} 照旧是话里的小块
  assert.equal(err(sc, 'card q = "看 {a.2}"'), null);
  one(sc, 'card q = "看 {a.2}"');
  assert.equal(sc.objects.get('q').live, undefined);
});

test('旧写法不变', () => {
  const s = new Scene();
  run(s, 'matrix A = 1 2 3 / -1 0 1/2\nmatrix B = 1 0 / 2 1 / -2 4\nproduct C = A B\nmul C');
  assert.deepEqual(rows(s, 'C'), [['-1', '14'], ['-2', '2']]);
  // 乘积跟着重算照旧一格一条，交出来的还是那一格（画面闪它）；多了 id、changed，好写进给老师的事实
  const fx = one(s, 'write B.1,1 3');
  assert.ok(fx.derived.length === 2 && fx.derived.every((d) => d.part.obj === 'C' && d.id === 'C'));
  assert.deepEqual(fx.derived.map((d) => d.changed[0]), [{ ref: 'C.1,1', from: '-1', to: '1' }, { ref: 'C.2,1', from: '-2', to: '-4' }]);
  run(s, 'plane p range=-4..4\nvec p u = 2 1\nvec p v = -1 2\nvec p w = 2u - v\ndial k = 2 range=0-4 at=p\nvec p z = k u\nset k 3');
  assert.deepEqual(at(s, 'w'), ['5', '0']);
  assert.deepEqual(at(s, 'z'), ['6', '3']);
  // 改之前（ab74486）存下的舞台现状：一个字都不变
  assert.equal(s.stateText(), '（矩阵：名字.2,3 是第 2 行第 3 列，名字.r2 是第 2 行，名字.c3 是第 3 列；交换两行时数跟着走，名字.2,3 指的总是现在的第 2 行第 3 列）\n（平面：名字.u 是向量 u（从原点出发的箭头），名字.P 是点 P；坐标是数学里的 (x, y)，y 朝上）\n矩阵 A（2×3）：\n  第 1 行：1  2  3\n  第 2 行：-1  0  1/2\n矩阵 B（3×2）：\n  第 1 行：3  0\n  第 2 行：2  1\n  第 3 行：-2  4\n矩阵 C = A B（2×2；算出来的 4 格跟着 A、B 自动重算）：\n  第 1 行：1  14\n  第 2 行：-4  2\n平面 p（x 从 -4 到 4，y 从 -4 到 4；一格是 1）：\n  向量 u = (2, 1)（蓝）\n  向量 v = (-1, 2)（粉）\n  向量 w = 2u - v = (5, 0)（绿、出了网格）\n  向量 z = k·u = (6, 3)（金、出了网格）\n能拨的数：k = 3（0～4）');
  // 乘积换着乘（C = A B 以后把 A 换成 C B）这种老写法照旧收下、照旧只重算三遍，不当成跟着算的环
  const t = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nproduct C = A B\nmul C');
  assert.equal(err(t, 'product A = C B'), null);
  run(t, 'product A = C B\nmul A\nwrite B.1,1 2');
  assert.equal(t.stateText(), '（矩阵：名字.2,3 是第 2 行第 3 列，名字.r2 是第 2 行，名字.c3 是第 3 列；交换两行时数跟着走，名字.2,3 指的总是现在的第 2 行第 3 列）\n矩阵 B（2×2）：\n  第 1 行：2  0\n  第 2 行：0  1\n矩阵 C = A B（2×2；算出来的 4 格跟着 A、B 自动重算）：\n  第 1 行：32  2\n  第 2 行：96  4\n矩阵 A = C B（2×2；算出来的 4 格跟着 C、B 自动重算）：\n  第 1 行：64  2\n  第 2 行：192  4');
});

// —— 整条分支的最终审查（I3）：跟着算的一排格子、树、图，依赖一变照造它的那一行重新造——老师后来做的不能没声没息地丢 ——

test('I3 图：拨了边权重新造，老师写的旁边的数、访问顺序、染色、亮、拿掉的结点和边、度都按结点 / 边带过去', () => {
  const sc = run(new Scene(), 'dial w = 4 range=1..9\ngraph g = A-B:{w} A-C:2 B-C:1 C-D:3\ntag g ∞\ntag g.A 0\nrelax g.A -> g.C\nvisit g.A\npaint g.A~C g1\nglow g.B\ndeg g\ntake g.D');
  const fx = one(sc, 'set w 6');
  assert.deepEqual(changedOf(fx, 'g'), [{ ref: 'g', expr: 'w', from: '4', to: '6' }]);
  const g = sc.objects.get('g');
  const n = (k) => g.nodes.find((x) => x.key === k);
  const e = (k) => g.edges.find((x) => x.key === k);
  assert.equal(e('A~B').w, '6');
  assert.deepEqual(['A', 'B', 'C'].map((k) => n(k).tag), ['0', '∞', '2']);
  assert.equal(n('C').value, '2');
  assert.equal(n('A').order, 1);
  assert.equal(e('A~C').paint, 'g1');
  assert.equal(n('B').glow, true);
  assert.equal(g.deg, true);
  assert.deepEqual(g.taken, ['D']);
  assert.equal(e('C~D').gone, true);
  assert.match(sc.stateText(), /旁边的数：A 0，B ∞，C 2/);
  assert.match(sc.stateText(), /访问顺序：A/);
  // 访问号接着往下编
  one(sc, 'visit g.C');
  assert.equal(n('C').order, 2);
});

test('I3 一排格子：拨了照新的数重新造，染色、指针、分组留着；换了位置（swap）就不再跟着算，舞台现状里说一声', () => {
  const sc = run(new Scene(), 'dial k = 1 range=0..9\narray a = {k} 3 5\npaint a.2 g1\nptr i a.3');
  one(sc, 'set k 2');
  const a = () => sc.objects.get('a');
  const vals = () => [...a().cells].sort((x, y) => x.slot - y.slot).map((c) => c.value);
  assert.deepEqual(vals(), ['2', '3', '5']);
  assert.equal(a().cells.find((c) => c.key === 2).paint, 'g1');
  assert.equal(a().ptrs.get('i'), 3);
  one(sc, 'swap a.1 a.3');
  assert.equal(a().live, undefined, '换了位置就是一排普通的格子');
  one(sc, 'set k 7');
  assert.deepEqual(vals(), ['5', '3', '2'], '拨了也不再照那一行重新造（换的位置还在）');
  assert.match(sc.stateText(), /a 已经不跟着 \{k\} 变了：你动过它的结构（swap a\.1 a\.3）/);
  assert.equal(err(sc, 'open a'), null, '不跟着算了，学生能动');
  // move、write 也一样
  const s2 = run(new Scene(), 'dial k = 1 range=0..9\narray b = {k} 3 5\nwrite b.2 9');
  assert.equal(s2.objects.get('b').live, undefined);
  one(s2, 'set k 4');
  assert.deepEqual([...s2.objects.get('b').cells].sort((x, y) => x.slot - y.slot).map((c) => c.value), ['1', '9', '5']);
});

test('I3 树：拨了照新的数重新造（角上的小字、染色、访问号留着）；转过、插过就不再跟着算', () => {
  const sc = run(new Scene(), 'dial h = 40 range=0..99\ntree t = 50 30 70 {h}\ntag t.50 "+1"\npaint t.30 g2\nvisit t.50');
  const t = () => sc.objects.get('t');
  const fx = one(sc, 'set h 20');
  assert.deepEqual(changedOf(fx, 't'), [{ ref: 't', expr: 'h', from: '40', to: '20' }]);
  const node = (k) => t().nodes.find((x) => x.key === k);
  assert.deepEqual([1, 2, 3, 4].map((k) => node(k).value), ['50', '30', '70', '20']);
  assert.equal(node(1).tag, '+1');
  assert.equal(node(2).paint, 'g2');
  assert.equal(node(1).order, 1);
  assert.equal(t().visits, 1);
  one(sc, 'rotate t.50 right');
  assert.equal(t().live, undefined);
  one(sc, 'set h 25');
  assert.equal(t().root, 2, '转过的样子还在');
  assert.equal(node(4).value, '20');
  assert.match(sc.stateText(), /t 已经不跟着 \{h\} 变了：你动过它的结构（rotate t\.50 right）/);
  const s2 = run(new Scene(), 'dial h = 40 range=0..99\ntree u = 50 30 70 {h}\ninsert u 60');
  assert.equal(s2.objects.get('u').live, undefined);
});

test('I3 矩阵做了行变换不再跟着算：舞台现状里也说一声', () => {
  const sc = run(new Scene(), 'dial k = 2 range=0..5\nmatrix M = 1 {k} / 0 1\nrowop M r1 - r2');
  assert.match(sc.stateText(), /M 已经不跟着 \{k\} 变了：你动过它的结构（rowop M r1 - r2）/);
});

test('复核 学生（ask drag）换了跟着算的一排：舞台现状写「学生动过它的结构」（老师读这一句）', () => {
  const sc = run(new Scene(), 'dial k = 1 range=0..9\narray a = {k} 3 5');
  sc.apply(parseScript('swap a.1 a.3')[0], { by: 'student', judged: null });
  assert.match(sc.stateText(), /a 已经不跟着 \{k\} 变了：学生动过它的结构（swap a\.1 a\.3）/);
  const t = run(new Scene(), 'dial k = 1 range=0..9\narray a = {k} 3 5\nswap a.1 a.3');
  assert.match(t.stateText(), /你动过它的结构/);
});
