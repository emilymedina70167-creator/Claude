// 矩阵（消元）的规则（kit/src/stage/types/matrix.rules.js）：下一步、三种错法、阶梯形 / 行最简形 / 秩 / 行等价的判断式、
// 写给老师的事实、手势表；和 engines/elim.js（学生自己做行变换的那一段、行最简形、解）对拍（两边各算各的，结果要一样）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { parseOps, toQ } from '../kit/src/stage/types/matrix.js';
import { matrixRules as R, actSrc } from '../kit/src/stage/types/matrix.rules.js';
import { rulesOf, predicateOf, gestureOf, done } from '../kit/src/stage/rules.js';
import { Q } from '../kit/src/exact.js';
import { P } from '../kit/src/poly.js';
import * as E from '../kit/src/engines/elim.js';

const run = (s, src) => { for (const c of parseScript(src)) s.apply(c); return s; };
const make = (src) => run(new Scene(), src);
const M = (s, id = 'M') => s.objects.get(id);
/** 矩阵现在每一行的数（按现在的位置） */
const rows = (o) => Array.from({ length: o.rows }, (_, i) => o.cells.filter((x) => x.r === i + 1).sort((a, b) => a.c - b.c).map((x) => x.value));
const op = (o, text) => ({ type: 'rowop', op: parseOps(text, o) });
const chk = (o, text, scene) => R.check(o, op(o, text), scene);
// 舞台上的一行（rowop M r2 - r1）里那一步
const srcOf = (o, a) => actSrc(o, a).replace(/^rowop \S+ /, '');
const actTexts = (o) => R.next(o).acts.map((a) => srcOf(o, a));
// next 给的每一个动作照做都判对
const allRight = (o, nx) => { for (const a of nx.acts) assert.equal(R.check(o, a).right, true, `next 给的 ${actSrc(o, a)} 要判对`); };

// 第 4 幕的方程组（evals/stage-gaps/ideal/L2.md）：x1 + 2x2 = 2、x1 − 4x3 = 0、x1 + 2x2 − 2x3 = 0
const L2 = 'matrix M = 1 2 0 | 2 / 1 0 -4 | 0 / 1 2 -2 | 0';
// 计划里写的那一张：第 2 行是第 1 行的 2 倍再改一点，要 r2 − 2r1
const BRIEF = 'matrix M = 1 2 0 | 2 / 2 2 -4 | 2 / 0 0 -2 | -2';

/** 照 next 一路做到没有下一步（pick 挑 acts 里的哪一个，默认第一个）：每一下 check 要判对；返回做过的几步 */
function follow(s, pick = () => 0, max = 300) {
  const done = [];
  for (let i = 0; i < max; i++) {
    const o = M(s);
    const nx = R.next(o);
    if (!nx) return done;
    allRight(o, nx);
    const a = nx.acts[pick(nx.acts.length)];
    done.push(srcOf(o, a));
    run(s, actSrc(o, a));
  }
  return assert.fail('照 next 走了好多步还没走完');
}

// elim.js 那边：数 → 多项式矩阵；行变换照它自己的读法读（r2 - 2r1、r1 <-> r3、r2 / 3、(-1/2)r2）
const polyOf = (rs) => rs.map((r) => r.map((v) => P(toQ(v))));
const numsOf = (M2) => M2.map((r) => r.map((p) => p.constValue().toString()));

test('教材例题对拍（第 4 幕的增广矩阵）：照 next 一路消成阶梯形，和 elim.js 自己做行变换的结果、行最简形、解都对得上', () => {
  const s = make(L2);
  const ops = follow(s);
  assert.deepEqual(ops, ['r2 - r1', 'r3 - r1']);
  assert.deepEqual(rows(M(s)), [['1', '2', '0', '2'], ['0', '-2', '-4', '-2'], ['0', '0', '-2', '-2']], '和 L2 第 4 幕学生消出来的一样');
  assert.equal(R.predicates.stairs(M(s)), true);
  assert.equal(done(s, 'M'), true, '消成阶梯形就做完了');
  // elim.js：同样几步在它那边做，它也说到了行阶梯形，矩阵一样
  const input = E.parse({ matrix: '[[1, 2, 0], [1, 0, -4], [1, 2, -2]]', b: '[2, 0, 0]' });
  let st = E.doStart(input, { target: 'ref' });
  assert.equal(E.doStatus(st).done, false);
  for (const t of ops) for (const eop of E.parseOps(t, input.m)) st = E.doApply(st, eop).state;
  assert.equal(E.doStatus(st).done, true);
  assert.deepEqual(numsOf(st.M), rows(M(s)));
  // 行最简形：elim.js 的 rrefQ 写成舞台上的矩阵，same 判行等价；解是 (4, −1, 1)
  const { M: rr, pivots } = E.rrefQ(E.doStart(input).M, input.n);
  run(s, `matrix Rr = ${numsOf(rr).map((r) => `${r.slice(0, 3).join(' ')} | ${r[3]}`).join(' / ')}`);
  assert.equal(predicateOf(s, 'M', 'same')(['Rr']), true);
  assert.equal(predicateOf(s, 'Rr', 'rref')(), true);
  assert.equal(predicateOf(s, 'M', 'rref')(), false, '阶梯形还不是行最简形');
  const sol = E.solution(rr, input.n, pivots);
  assert.equal(sol.kind, 'unique');
  assert.deepEqual(sol.x.map(String), ['4', '-1', '1']);
  assert.equal(predicateOf(s, 'M', 'rank')(['3']), true);
});

test('计划里的那一张：r2 − 2r1 以后就是阶梯形', () => {
  const s = make(BRIEF);
  assert.deepEqual(follow(s), ['r2 - 2r1']);
  assert.deepEqual(rows(M(s)), [['1', '2', '0', '2'], ['0', '-2', '-4', '-2'], ['0', '0', '-2', '-2']]);
});

test('对拍：随机的两百张矩阵（含增广、有全零列、要先换行的），随便挑 next 给的哪一下，都消得成阶梯形，和原来的行等价（elim.js 的 rrefQ）', () => {
  let a = 20261106;
  const rnd = () => { a = (a * 1103515245 + 12345) % 2 ** 31; return a / 2 ** 31; };
  const pickAny = (n) => Math.floor(rnd() * n);
  for (let k = 0; k < 200; k++) {
    const m = 2 + Math.floor(rnd() * 3), n = 2 + Math.floor(rnd() * 4);
    const aug = n >= 3 && rnd() < 0.4 ? n - 1 : null;
    const zeroCol = rnd() < 0.2 ? Math.floor(rnd() * n) : -1;
    const vals = Array.from({ length: m }, () => Array.from({ length: n }, (_, c) => (c === zeroCol || rnd() < 0.3 ? '0' : String(Math.floor(rnd() * 7) - 3))));
    const src = `matrix M = ${vals.map((r) => (aug ? `${r.slice(0, aug).join(' ')} | ${r.slice(aug).join(' ')}` : r.join(' '))).join(' / ')}`;
    const s = make(src);
    follow(s, pickAny);
    assert.equal(R.predicates.stairs(M(s)), true, `${src} 消完是阶梯形`);
    // 两边各算各的：elim.js 从原来的矩阵算行最简形（整张都算主元，增广的右边也算），舞台上的 same 判行等价
    const { M: rr } = E.rrefQ(polyOf(vals), n);
    run(s, `matrix Rr = ${numsOf(rr).map((r) => r.join(' ')).join(' / ')}`);
    assert.equal(predicateOf(s, 'M', 'same')(['Rr']), true, `${src} 消完和原来行等价`);
    // elim.js 也说到了行阶梯形（它只看系数部分；整张是阶梯形，系数部分一定是）
    const fin = polyOf(rows(M(s)));
    const st = E.doStart({ A: fin.map((r) => r.slice(0, aug ?? n)), B: aug ? fin.map((r) => r.slice(aug)) : null, n: aug ?? n, m, goal: 'rank', param: '' });
    assert.equal(st.target, 'ref');
    assert.equal(E.doStatus(st).done, true, `${src}：elim.js 也说是行阶梯形`);
  }
});

test('next 给的可接受的下一步不止一个：先消下面哪一格都行、换别的非零行当主元、先把主元化成 1、两行都乘一下免得出分数', () => {
  const o = M(make(L2));
  const acts = actTexts(o);
  assert.equal(acts[0], 'r2 - r1');
  for (const t of ['r3 - r1', 'r2 - r3', 'r1 <-> r2', 'r1 <-> r3']) assert.ok(acts.includes(t), `${t} 也在 acts 里`);
  assert.match(R.next(o).why, /第 1 列/);
  assert.match(R.next(o).why, /M\.2,1/);
  const p = M(make('matrix M = 2 4 1 / 3 1 2 / 4 1 1'));
  const pa = actTexts(p);
  assert.equal(pa[0], 'r2 - (3/2)r1');
  assert.ok(pa.includes('r1 / 2'), '先把主元化成 1');
  assert.equal(chk(p, 'r1 / 2').right, true);
  assert.equal(chk(p, '2r2 - 3r1').right, true, '两行都乘一下（免得出分数）也消得掉');
  assert.equal(chk(p, '3r1').right, false, '乘一个别的数不是下一步');
  // 主元那一格是 0：先换一行上来
  const z = M(make('matrix M = 0 1 / 1 2 / 2 3'));
  const za = actTexts(z);
  assert.equal(za[0], 'r1 <-> r2');
  assert.ok(za.includes('r1 <-> r3'));
  assert.ok(za.includes('r3 - 2r2'), '下面两行之间先消也行');
  assert.match(R.next(z).why, /是 0/);
  assert.equal(chk(z, 'r2 + r1').right, false, '拿全是 0 的那一格消不掉');
  assert.doesNotThrow(() => JSON.stringify([R.next(o), chk(o, 'r2 + r1')]), '下一步、判的结果都能存（数写成字符串）');
});

test('符号反了：该 r2 − 2r1 写成 r2 + 2r1', () => {
  const o = M(make(BRIEF));
  const v = chk(o, 'r2 + 2r1');
  assert.equal(v.legal, true);
  assert.equal(v.right, false);
  assert.match(v.misread, /符号/);
  assert.match(v.misread, /r₂ − 2r₁/);
  assert.match(v.why, /r₂ \+ 2r₁/);
  assert.ok(v.next.acts.map((a) => srcOf(o, a)).includes('r2 - 2r1'));
  assert.match(v.next.why, /r₂ − 2r₁/);
  // 两行都乘一下的写法：2r2 − 3r1 写成 2r2 + 3r1 也是符号反了
  const p = M(make('matrix M = 2 4 1 / 3 1 2 / 4 1 1'));
  assert.match(chk(p, '2r2 + 3r1').misread, /符号/);
});

test('倍数不对：k 不对、也不是符号的问题', () => {
  const o = M(make(BRIEF));
  const v = chk(o, 'r2 - 3r1');
  assert.equal(v.right, false);
  assert.match(v.misread, /倍数不对，这一格消不成 0/);
  assert.match(chk(o, 'r2 + 3r1').misread, /倍数不对/);
});

test('把已经消好的那一列又弄乱了：拿消好的行去加、改消好的行、换走消好的行', () => {
  const s = make('matrix M = 1 2 0 | 2 / 0 -2 -4 | -2 / 0 2 1 | 0');
  const o = M(s);
  assert.equal(actTexts(o)[0], 'r3 + r2', '第 1 列已经消好了，现在是第 2 列');
  const v = chk(o, 'r3 - r1');
  assert.equal(v.right, false);
  assert.match(v.misread, /把已经消好的那一列又弄乱了/);
  assert.match(v.misread, /M\.3,1/);
  assert.match(chk(o, 'r1 <-> r2').misread, /弄乱/);
  assert.match(chk(o, 'r2 + r1').misread, /弄乱/);
  // 已经是阶梯形以后：往上消（化行最简形）不判，弄乱了照样说
  const e = M(make('matrix M = 1 2 3 / 0 1 4 / 0 0 1'));
  assert.equal(R.next(e), null);
  assert.equal(chk(e, 'r1 - 2r2').right, null);
  assert.equal(chk(e, 'r2 / 2').right, null);
  const w = chk(e, 'r3 + r1');
  assert.equal(w.right, false);
  assert.match(w.misread, /弄乱/);
});

test('走偏以后接着判：先做一步不必要的倍加，之后照 next 照样消成阶梯形', () => {
  const s = make(L2);
  const v = chk(M(s), 'r1 + r2');
  assert.equal(v.legal, true);
  assert.equal(v.right, false);
  run(s, 'rowop M r1 + r2');
  assert.deepEqual(rows(M(s))[0], ['2', '2', '-4', '2']);
  const ops = follow(s);
  assert.ok(ops.length >= 2);
  assert.equal(R.predicates.stairs(M(s)), true);
  // 走偏以后 next 从现在的样子算：第 1 列的主元是新的第 1 行
  const t = make(L2);
  run(t, 'rowop M r1 + r2');
  assert.equal(actTexts(M(t))[0], 'r2 - (1/2)r1');
});

test('倍乘 0、同一行换同一行、行号不对、还空着的格都是 legal: false；列变换不判', () => {
  const o = M(make(L2));
  const zero = R.check(o, { type: 'rowop', op: [{ line: 'r', kind: 'scale', i: 2, j: null, a: new Q(0n), b: null }] });
  assert.equal(zero.legal, false);
  assert.match(zero.why, /乘 0/);
  assert.equal(R.check(o, { type: 'rowop', op: [{ line: 'r', kind: 'swap', i: 2, j: 2 }] }).legal, false);
  assert.equal(R.check(o, { type: 'rowop', op: [{ line: 'r', kind: 'add', i: 4, j: 1, a: '1', b: '-1' }] }).legal, false);
  assert.equal(R.check(o, { type: 'rowop', op: 'r2 + x' }).legal, false, '写法看不懂');
  assert.equal(R.check(o, { type: 'rowop', op: 'r2 - r1' }).right, true, '写成一行字也认');
  assert.equal(R.check(o, op(o, 'c1 <-> c2')).right, null, '列变换不判');
  assert.equal(R.check(o, { type: 'write', r: 1, c: 1, value: '3' }).right, null, '改一格不判');
  // 乘积里还空着的格：动不了那一行，也没有下一步
  const s = make('matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1 beside=A\nproduct C = A B');
  assert.equal(R.next(M(s, 'C')), null);
  assert.equal(R.check(M(s, 'C'), op(M(s, 'C'), 'r2 - r1')).legal, false);
  assert.equal(R.predicates.stairs(M(s, 'C')), null, '还空着，判不了');
});

test('连着几步（r2 − r1, r3 − r1）：每一步都对才对；哪一步错了说哪一步', () => {
  const o = M(make(L2));
  assert.equal(chk(o, 'r2 - r1, r3 - r1').right, true);
  const v = chk(o, 'r2 - r1, r3 + r1');
  assert.equal(v.right, false);
  assert.match(v.misread, /符号/);
  assert.match(v.next.why, /r₃ − r₁/, '现在正确的是从做完第一步的样子算');
});

test('增广矩阵：先只在竖线左边找主元；左边消完了右边还不是阶梯形（无解的方程组），接着把右边那一列消好', () => {
  const s = make('matrix M = 1 1 | 1 / 1 1 | 2 / 1 1 | 3');
  const ops = follow(s);
  assert.deepEqual(ops.slice(0, 2), ['r2 - r1', 'r3 - r1']);
  assert.ok(ops.length === 3);
  assert.deepEqual(rows(M(s)), [['1', '1', '1'], ['0', '0', '1'], ['0', '0', '0']]);
  assert.equal(R.predicates.stairs(M(s)), true);
  assert.equal(R.predicates.rank(M(s), ['2']), true);
  const mid = make('matrix M = 1 1 | 1 / 0 0 | 1 / 0 0 | 2');
  assert.match(R.next(M(mid)).why, /右边/);
});

test('判断式：stairs、rref、rank=2、same B；登记在矩阵上，挑战能写', () => {
  const s = make('matrix A = 1 2 3 / 2 4 6 / 1 1 1');
  assert.equal(rulesOf(M(s, 'A')).hasNext, true, 'types/index.js 登记了矩阵的规则');
  assert.equal(predicateOf(s, 'A', 'rank')(['2']), true);
  assert.equal(predicateOf(s, 'A', 'rank')(['3']), false);
  assert.throws(() => predicateOf(s, 'A', 'rank')([]), /rank=2/);
  assert.equal(predicateOf(s, 'A', 'stairs')(), false);
  assert.equal(R.predicates.stairs(M(make('matrix M = 1 2 3 / 0 1 4 / 0 0 0'))), true);
  assert.equal(R.predicates.stairs(M(make('matrix M = 0 1 / 1 0'))), false);
  assert.equal(R.predicates.rref(M(make('matrix M = 1 0 2 / 0 1 4'))), true);
  assert.equal(R.predicates.rref(M(make('matrix M = 1 2 2 / 0 1 4'))), false);
  run(s, 'matrix B = 1 1 1 / 0 1 2 / 0 0 0\nmatrix D = 1 0 0 / 0 1 0 / 0 0 1\nmatrix F = 1 2 / 3 4');
  assert.equal(predicateOf(s, 'A', 'same')(['B']), true, 'A 和 B 行等价');
  assert.equal(predicateOf(s, 'A', 'same')(['D']), false);
  assert.equal(predicateOf(s, 'A', 'same')(['F']), false, '尺寸不同');
  assert.throws(() => predicateOf(s, 'A', 'same')(['X']), /舞台上没有「X」/);
  assert.throws(() => predicateOf(s, 'A', 'same')([]), /same B/);
  // 挑战：消成阶梯形就做到
  const t = make(L2);
  run(t, 'goal g1 "消成阶梯形" when="M stairs, M rank=3"');
  assert.equal(t.apply(parseScript('rowop M r2 - r1')[0]).goalsMet, undefined);
  assert.deepEqual(t.apply(parseScript('rowop M r3 - r1')[0]).goalsMet, ['g1']);
});

test('事实：这一步做了什么、哪一行变成什么、现在离阶梯形还差哪几格；弄乱了说哪一格', () => {
  const s = make(L2);
  const b1 = structuredClone(M(s));
  run(s, 'rowop M r2 - r1');
  const f1 = R.facts(b1, M(s), op(b1, 'r2 - r1')).join('\n');
  assert.match(f1, /r₂ − r₁：第 2 行加上第 1 行的 −1 倍，变成 \(0 −2 −4 \| −2\)/);
  assert.match(f1, /还不是阶梯形/);
  assert.match(f1, /M\.3,1/);
  const b2 = structuredClone(M(s));
  run(s, 'rowop M r3 - r1');
  assert.match(R.facts(b2, M(s), op(b2, 'r3 - r1')).join('\n'), /现在是阶梯形了：非零行 3 行/);
  const b3 = structuredClone(M(s));
  run(s, 'rowop M r1 <-> r3');
  const f3 = R.facts(b3, M(s), op(b3, 'r1 <-> r3')).join('\n');
  assert.match(f3, /r₁ ↔ r₃：第 1、3 行对调/);
  assert.match(f3, /弄乱/);
  const z = make('matrix M = 0 1 / 1 2');
  const b4 = structuredClone(M(z));
  run(z, 'rowop M 3r1');
  assert.match(R.facts(b4, M(z), op(b4, '3r1')).join('\n'), /3r₁：第 1 行乘 3，变成 \(0 3\)[\s\S]*M\.1,1 是 0/);
});

test('手势表：行的把手拖到另一行上是倍加，拖到行号上是对调，点行号是倍乘；点一格写一个数', () => {
  const s = make(L2);
  const o = M(s);
  const g = gestureOf(o, 'rowop');
  assert.deepEqual(g.gesture, ['drop-on', 'tap']);
  assert.equal(g.toAct(o, { from: { row: 1 }, to: { row: 3 }, value: '-2' }).src, 'rowop M r3 - 2r1');
  assert.equal(g.toAct(o, { from: { row: 1 }, to: { r: 2, c: 3 }, value: '1/2' }).src, 'rowop M r2 + (1/2)r1', '落在那一行的一格上也算');
  assert.equal(g.toAct(o, { from: { row: 1 }, to: { label: 3 } }).src, 'rowop M r1 <-> r3');
  assert.equal(g.toAct(o, { from: { label: 2 }, value: '1/2' }).src, 'rowop M r2 / 2');
  assert.equal(g.toAct(o, { to: { label: 2 }, value: '-3' }).src, 'rowop M -3r2');
  assert.equal(g.toAct(o, { from: { label: 2 }, value: '-1/2' }).src, 'rowop M (-1/2)r2');
  assert.ok(g.toAct(o, { from: { row: 1 }, to: { row: 1 }, value: '2' }).error, '拖到自己身上');
  assert.ok(g.toAct(o, { from: { row: 1 }, to: { row: 3 } }).error, '倍加要写倍数');
  assert.ok(g.toAct(o, { from: { row: 1 }, to: { row: 3 }, value: 'x' }).error, '倍数不是数');
  assert.ok(g.toAct(o, { from: { row: 1 }, to: { row: 3 }, value: '0' }).error, '加 0 倍什么也没变');
  // 乘 0：交出动作，裁判判 legal: false（这个世界的物理，记一笔）
  const z = g.toAct(o, { from: { label: 2 }, value: '0' });
  assert.equal(R.check(o, z.act).legal, false);
  // 翻出来的动作就是那一行：check 判得了、照抄能演
  const a = g.toAct(o, { from: { row: 1 }, to: { row: 2 }, value: '-1' });
  assert.equal(R.check(o, a.act).right, true);
  assert.equal(actSrc(o, a.act), a.src);
  const w = gestureOf(o, 'edit');
  assert.equal(w.gesture, 'write');
  assert.deepEqual(w.toAct(o, { to: { r: 2, c: 3 }, value: '-3/2' }), { act: { type: 'write', r: 2, c: 3, value: '-3/2' }, src: 'write M.2,3 -3/2' });
  assert.equal(w.toAct(o, { to: { r: 2, c: 3 }, value: '0.5' }).src, 'write M.2,3 1/2');
  assert.ok(w.toAct(o, { to: { r: 2, c: 3 }, value: 'abc' }).error);
  assert.ok(w.toAct(o, { to: { r: 5, c: 1 }, value: '1' }).error, '没有第 5 行');
  for (const src of ['rowop M r3 - 2r1', 'rowop M r2 + (1/2)r1', 'rowop M r1 <-> r3', 'rowop M r2 / 2', 'rowop M -3r2', 'rowop M (-1/2)r2', 'write M.2,3 -3/2']) assert.deepEqual(dryRun(make(L2), src), [], src);
});
