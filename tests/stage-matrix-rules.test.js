// 矩阵（消元）的规则（kit/src/stage/types/matrix.rules.js）：下一步、三种错法、阶梯形 / 行最简形 / 秩 / 行等价的判断式、
// 写给老师的事实、手势表；和 engines/elim.js（学生自己做行变换的那一段、行最简形、解）对拍（两边各算各的，结果要一样）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { parseOps, toQ } from '../kit/src/stage/types/matrix.js';
import { matrixRules as R, actSrc, readBack, solutionText, brief, inferRowOp, fromFact } from '../kit/src/stage/types/matrix.rules.js';
import { rulesOf, predicateOf, gestureOf, done, evalMeasure, measureLine, changedKeys } from '../kit/src/stage/rules.js';
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
  assert.equal(chk(p, '3r1').right, true, '一行乘一个不是 0 的数弄不乱前面，也算对');
  assert.match(chk(p, '3r1').why, /倍乘第 1 行/);
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

test('化简一步（提公因数、变号）判对：elim.js 自己每消一行就这样做；拿下面一行加到主元那一行上凑成 ±1 也对，没凑出来照旧判错', () => {
  const s = make(L2);
  run(s, 'rowop M r2 - r1');
  const o = M(s);
  for (const [t, note] of [['r2 / (-2)', /化简第 2 行/], ['r2 / 2', /化简第 2 行/], ['-r2', /第 2 行变号/]]) {
    const v = chk(o, t);
    assert.equal(v.right, true, `${t} 判对`);
    assert.equal(v.misread, null);
    assert.match(v.why, note);
  }
  const u = M(make('matrix M = 3 1 / 2 5'));
  const v = chk(u, 'r1 - r2');
  assert.equal(v.right, true, 'r1 − r2 把主元凑成 1');
  assert.match(v.why, /把主元凑成 1/);
  assert.match(chk(u, 'r1 - 2r2').why, /把主元凑成 −1/);
  assert.ok(actTexts(u).includes('r1 - r2'), '凑 ±1 也在 acts 里');
  assert.equal(chk(u, 'r1 + r2').right, false, '没凑出 1、也没消掉什么');
  assert.equal(chk(u, 'r1 / 3').right, true);
  assert.match(chk(u, 'r1 / 3').why, /把主元化成 1/);
  // 主元已经是 1：再拿下面一行去加不是凑主元
  assert.equal(chk(M(make(L2)), 'r1 - 2r2').right, false);
  // 拿消好的行去凑也是弄乱
  const w = M(make('matrix M = 1 2 0 / 0 3 1 / 0 2 5'));
  assert.equal(chk(w, 'r2 - r3').right, true);
  assert.match(chk(w, 'r2 - 2r1').misread, /弄乱/);
});

test('判断式 rankA：增广矩阵只算竖线左边（系数矩阵的秩），不是增广矩阵时和 rank 一样', () => {
  const s = make('matrix M = 1 1 | 1 / 1 1 | 2\nmatrix A = 1 2 / 2 4');
  assert.equal(predicateOf(s, 'M', 'rankA')(['1']), true, 'r(A) = 1');
  assert.equal(predicateOf(s, 'M', 'rank')(['2']), true, 'r(A | b) = 2：无解');
  assert.equal(predicateOf(s, 'M', 'rankA')(['2']), false);
  assert.equal(predicateOf(s, 'A', 'rankA')(['1']), true);
  assert.equal(predicateOf(s, 'A', 'rank')(['1']), true);
  assert.throws(() => predicateOf(s, 'M', 'rankA')([]), /rankA=2/);
  // 挑战：改右边的一个数让方程组无解（r(A) = 1、r(A | b) = 2）
  const t = make('matrix M = 1 1 | 1 / 1 1 | 1');
  run(t, 'goal g1 "改右边一个数，让它无解" when="M rankA=1, M rank=2"');
  assert.deepEqual(t.apply(parseScript('write M.2,3 2')[0]).goalsMet, ['g1']);
});

// 现在这一张写回舞台上的写法（换一个场景接着走，不动原来的）
const matSrc = (o) => `matrix M = ${rows(o).map((r) => (o.aug ? `${r.slice(0, o.aug).join(' ')} | ${r.slice(o.aug).join(' ')}` : r.join(' '))).join(' / ')}`;
// elim.js 的一步（多项式、从 0 数）→ 舞台上的一步：照它的结构换，不经过文字
const fromElim = (e) => ({ line: 'r', kind: e.kind, i: e.i + 1, j: e.j == null ? null : e.j + 1,
  a: e.kind === 'swap' ? null : String((e.kind === 'comb' ? e.a : e.kind === 'scale' ? e.k : P(1)).constValue()),
  b: e.kind === 'add' ? String(e.k.constValue()) : e.kind === 'comb' ? String(e.b.constValue()) : null });

test('随机走错几下以后接着判：next 的每一下都判对、照着走都到得了阶梯形；elim.js 的 doHint 给的那一下也判对', () => {
  let a = 1106;
  const rnd = () => { a = (a * 1103515245 + 12345) % 2 ** 31; return a / 2 ** 31; };
  const any = (xs) => xs[Math.floor(rnd() * xs.length)];
  let wrongs = 0, hints = 0;
  for (let k = 0; k < 60; k++) {
    const m = 2 + Math.floor(rnd() * 3), n = 2 + Math.floor(rnd() * 3);
    const aug = n >= 3 && rnd() < 0.4 ? n - 1 : null;
    const vals = Array.from({ length: m }, () => Array.from({ length: n }, () => (rnd() < 0.3 ? '0' : String(Math.floor(rnd() * 7) - 3))));
    const s = make(`matrix M = ${vals.map((r) => (aug ? `${r.slice(0, aug).join(' ')} | ${r.slice(aug).join(' ')}` : r.join(' '))).join(' / ')}`);
    for (let step = 0; step < 10; step++) {
      const o = M(s);
      const nx = R.next(o);
      if (nx) {
        allRight(o, nx);
        // 从这里照 next 随便挑着走，走得完
        const t = make(matSrc(o));
        follow(t, (len) => Math.floor(rnd() * len));
        assert.equal(R.predicates.stairs(M(t)), true);
        // elim.js 自己会怎么走（它只看竖线左边：左边消完了它就没有下一步）
        const G = polyOf(rows(o));
        const hint = E.doHint({ M: G, n: aug ?? n, m, target: 'ref', history: [] });
        if (hint) {
          const h = { type: 'rowop', op: [fromElim(hint)] };
          assert.equal(R.check(o, h).right, true, `${matSrc(o)}：elim.js 给的 ${actSrc(o, h)} 判对`);
          hints++;
        }
      }
      // 一半照 next，一半随便来一步（倍加 k 取 ±1、±2、1/2，换任两行，倍乘 −1、2、1/2）
      let line;
      if (nx && rnd() < 0.5) line = actSrc(o, any(nx.acts));
      else {
        const i = 1 + Math.floor(rnd() * m);
        let j = 1 + Math.floor(rnd() * (m - 1));
        if (j >= i) j++;
        const kind = any(['add', 'add', 'swap', 'scale']);
        line = `rowop M ${kind === 'swap' ? `r${i} <-> r${j}` : kind === 'scale' ? `${any(['-1', '2', '(1/2)'])}r${i}` : `r${i} ${any(['+', '-'])} ${any(['', '2', '(1/2)'])}r${j}`}`;
        wrongs++;
      }
      run(s, line);
    }
  }
  assert.ok(wrongs > 200 && hints > 200, `随便走了 ${wrongs} 下、对了 ${hints} 次 elim.js 的提示`);
});

test('秩和自由变量：rank 是整张（增广的是 r(A | b)）、rankA 是竖线左边、free 是系数的列数减 rankA；det 只有不是增广的方阵才有', () => {
  const s = make('matrix M = 1 2 | 1 / 2 4 | -1');
  const v = (w, sc = s) => evalMeasure(sc, w).value;
  assert.equal(v('rank(M)'), 2);
  assert.equal(v('rankA(M)'), 1);
  assert.equal(v('free(M)'), 1);
  assert.equal(v('det(M)'), null);
  assert.match(evalMeasure(s, 'det(M)').why, /没有 det/);
  assert.equal(evalMeasure(s, 'det(M)').never, true, '本来就没有：以后也数不了');
  const line = measureLine(s, M(s));
  assert.equal(line, '页面算的：rank(M) = 2，rankA(M) = 1，free(M) = 1');
  assert.doesNotMatch(line, /det\(M\)|页面数不了/, '本来就没有的不列，也不算数不了');
  const a = make('matrix A = 1 2 / 3 4');
  assert.equal(v('det(A)', a), -2);
  assert.equal(v('rank(A)', a), 2);
  assert.equal(v('free(A)', a), 0);
  assert.equal(v('det(A)', make('matrix A = 1 2 3 / 4 5 6')), null, '不是方阵');
  // 乘积还空着：暂时数不了
  const c = make('matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nproduct C = A B');
  assert.deepEqual(evalMeasure(c, 'rank(C)'), { value: null, why: 'C 还有空着的格' });
  assert.equal(measureLine(c, M(c, 'C')), '页面数不了：C 还有空着的格');
  // 旧判断式照旧
  assert.equal(predicateOf(s, 'M', 'rank')(['2']), true);
  assert.equal(predicateOf(s, 'M', 'rankA')(['1']), true);
  assert.equal(predicateOf(c, 'C', 'rank')(['2']), null, '还空着照旧判不了');
});

// —— 页面算的写出来（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 3.2）——

test('读回和矛盾行：增广矩阵每一行读回成方程，0 = −3 标出矛盾；vars= 换未知数；现状里写 r(A)、r(A | b) 和解的样子', () => {
  const s = make('matrix M = 1 2 -1 | 1 / 0 1 1 | 2 / 0 0 0 | -3');
  assert.deepEqual(readBack(M(s)), ['第 1 行读回来：x1 + 2x2 − x3 = 1', '第 2 行：x2 + x3 = 2', '第 3 行：0 = −3（矛盾）']);
  const v = make('matrix M = 1 2 -1 | 1 / 0 1 1 | 2 / 0 0 0 | -3 vars="x y z"');
  assert.equal(readBack(M(v))[0], '第 1 行读回来：x + 2y − z = 1');
  const st = s.stateText();
  assert.ok(st.includes('r(A) = 2，r(A | b) = 3：无解'), st);
  assert.ok(st.includes('第 1 行读回来：x1 + 2x2 − x3 = 1；第 2 行：x2 + x3 = 2；第 3 行：0 = −3（矛盾）'), st);
  // 系数：分数加括号、−1 写「−」、0 不写；左边全是 0 写 0；第一项是负的
  const f = make('matrix M = 1/2 0 -1/3 | -1/2 / -1 0 0 | 0 / 0 0 0 | 0');
  assert.deepEqual(readBack(M(f)), ['第 1 行读回来：(1/2)x1 − (1/3)x3 = −1/2', '第 2 行：−x1 = 0', '第 3 行：0 = 0']);
  // 不是增广矩阵不读回；还空着的行不读
  assert.deepEqual(readBack(M(make('matrix M = 1 2 / 3 4'))), []);
  assert.deepEqual(readBack(M(make('matrix M = 1 2 | 1 / _ 1 | 2'))), ['第 1 行读回来：x1 + 2x2 = 1']);
  assert.equal(solutionText(M(make('matrix M = 1 2 | 1 / _ 1 | 2'))), null, '有空格不说解');
  assert.equal(solutionText(M(make('matrix M = 1 2 / 3 4'))), null, '不是增广矩阵');
});

test('解的样子：无穷多解几个自由变量、唯一解；brief 写要点（扫拨数用），别的矩阵写秩，有空格是 null', () => {
  const n = make('matrix N = 1 2 | 3 / 0 0 | 0');
  assert.equal(solutionText(M(n, 'N')), 'r(A) = 1，r(A | b) = 1：无穷多解（1 个自由变量）');
  const u = make('matrix U = 1 0 | 1 / 0 1 | 2');
  assert.equal(solutionText(M(u, 'U')), 'r(A) = 2，r(A | b) = 2：唯一解');
  assert.ok(u.stateText().includes('r(A) = 2，r(A | b) = 2：唯一解'));
  assert.equal(brief(M(n, 'N')), '无穷多解（1 个自由变量）');
  assert.equal(brief(M(u, 'U')), '唯一解');
  assert.equal(brief(M(make('matrix M = 1 1 | 1 / 1 1 | 2'))), '无解（r(A) = 1，r(A | b) = 2）');
  assert.equal(brief(M(make('matrix A = 1 2 / 2 4'), 'A')), 'r = 1');
  assert.equal(brief(M(make('matrix A = 1 _ / 2 4'), 'A')), null);
  assert.equal(rulesOf(M(u, 'U')).brief, brief, '交给场景扫拨数');
});

test('from=M0：学生写满一行就和 M0 比，猜是哪一种初等行变换、哪一格不对、同不同解；猜不出照说', () => {
  const s = make('matrix M0 = 1 2 0 | 2 / 2 2 -4 | 2 / 0 0 -2 | -2\nmatrix M1 = 1 2 0 | 2 / _ _ _ | _ / 0 0 -2 | -2 from=M0\nopen M1 edit input=keypad');
  const stu = (line) => s.apply(parseScript(line)[0], { by: 'student', open: 'edit' });
  for (const line of ['write M1.2,1 1', 'write M1.2,2 0', 'write M1.2,3 4']) {
    const fx = stu(line);
    assert.ok(fx.judged, `${line} 过了裁判`);
    assert.equal(fx.judged.verdict.right, null, '改一格不判对错');
    assert.ok(!(fx.judged.after || []).some((f) => f.includes('变了')), `${line}：这一行还没写满，不比`);
  }
  const fx = stu('write M1.2,4 0');
  assert.ok(fx.judged.after.includes('M1 第 2 行变了，像 r2 − r1；第 3 格该是 −4，写的是 4；第 1、3 行没变；和 M0 同解：否'), fx.judged.after.join('\n'));
  // 改成 5 7 9 | 11：看不出
  let last;
  for (const line of ['write M1.2,1 5', 'write M1.2,2 7', 'write M1.2,3 9', 'write M1.2,4 11']) last = stu(line);
  assert.ok(last.judged.after.some((f) => f.includes('看不出是哪一种初等行变换')), last.judged.after.join('\n'));
  assert.equal(last.judged.after[0], 'M1 第 2 行变了，看不出是哪一种初等行变换；第 1、3 行没变；和 M0 同解：否');
  // 写对了：同解
  for (const line of ['write M1.2,1 0', 'write M1.2,2 -2', 'write M1.2,3 -4', 'write M1.2,4 -2']) last = stu(line);
  assert.equal(last.judged.after[0], 'M1 第 2 行变了，像 r2 − 2r1；第 1、3 行没变；和 M0 同解：是');
  // 没写 from= 的矩阵改一格没有事实
  const p = make('matrix A = 1 2 / 3 4\nopen A edit input=keypad');
  assert.deepEqual(p.apply(parseScript('write A.1,1 5')[0], { by: 'student', open: 'edit' }).judged.after, []);
  // check、actOf 认 write
  assert.deepEqual(R.check(M(s, 'M1'), { type: 'write', r: 2, c: 1, value: '1' }), { legal: true, right: null });
});

test('inferRowOp：对调、倍乘、倍加；只比两边都写满的行；猜不出是 null；M0 拿掉了照说', () => {
  const g = (rows) => rows.map((r) => r.map((x) => (x == null ? null : toQ(x))));
  // 第 3 行是前两行的和（秩 2）：换了一行的那一张和它不一定同解
  const G0 = g([['1', '2', '3'], ['4', '5', '6'], ['5', '7', '9']]);
  const sw = inferRowOp(G0, g([['4', '5', '6'], ['1', '2', '3'], ['5', '7', '9']]));
  assert.equal(sw.guess.kind, 'swap');
  assert.equal(sw.guess.text, 'r1 ↔ r2');
  assert.deepEqual(sw.rows, [1, 2]);
  assert.equal(sw.same, true);
  assert.deepEqual(sw.bad, []);
  const sc = inferRowOp(G0, g([['1', '2', '3'], ['2', '5/2', '3'], ['5', '7', '9']]));
  assert.equal(sc.guess.kind, 'scale');
  assert.equal(sc.guess.text, '(1/2)r2');
  assert.equal(sc.same, true);
  const ad = inferRowOp(G0, g([['1', '2', '3'], ['0', '-3', '-7'], ['5', '7', '9']]));
  assert.deepEqual({ kind: ad.guess.kind, i: ad.guess.i, j: ad.guess.j, k: ad.guess.k, text: ad.guess.text }, { kind: 'add', i: 2, j: 1, k: '-4', text: 'r2 − 4r1' });
  assert.deepEqual(ad.bad, [{ c: 3, want: '-6', got: '-7' }]);
  assert.equal(ad.same, false);
  // 第 2 行本来是第 1 行的 2 倍：两行对调了，单看第 1 行也像倍乘，说的是一下对调
  const D0 = g([['1', '2'], ['2', '4']]);
  const dd = inferRowOp(D0, g([['2', '4'], ['1', '2']]));
  assert.equal(dd.guess.kind, 'swap');
  assert.equal(dd.guess.text, 'r1 ↔ r2');
  // 第 2 行还空着：不比，同不同解说不了
  const part = inferRowOp(G0, g([['1', '2', '3'], [null, '5', '6'], ['5', '7', '9']]));
  assert.deepEqual(part.rows, []);
  assert.equal(part.same, null);
  // 换上来一行、另一行还空着：像对调
  const half = inferRowOp(G0, g([['4', '5', '6'], [null, null, null], ['5', '7', '9']]));
  assert.equal(half.guess?.kind, 'swap');
  // 第 1 行抄成第 2 行、第 2 行没变：不是对调
  const copy = inferRowOp(G0, g([['4', '5', '6'], ['4', '5', '6'], ['5', '7', '9']]));
  assert.notEqual(copy.guess?.kind, 'swap');
  // M0 拿掉了、改了大小：照说页面比不了
  const s = make('matrix M0 = 1 2 / 3 4\nmatrix M1 = 1 2 / _ _ from=M0\nopen M1 edit input=keypad');
  run(s, 'matrix M0 = 1 2 3 / 4 5 6');
  s.apply(parseScript('write M1.2,1 3')[0], { by: 'student', open: 'edit' });
  const fx = s.apply(parseScript('write M1.2,2 4')[0], { by: 'student', open: 'edit' });
  assert.match(fx.judged.after[0], /M0 现在是 2×3 的，和 M1 不一样大，页面比不了/);
  assert.match(fromFact(M(s, 'M1'), null), /舞台上已经没有 M0 了，页面比不了/);
});

test('from= 的不是方程组：说「行等价」不说「同解」；两列的矩阵改得不像一步初等行变换：看不出', () => {
  const s = make('matrix A = 1 2 / 2 4\nmatrix B = 1 2 / _ _ from=A\nopen B edit input=keypad');
  const stu = (line) => s.apply(parseScript(line)[0], { by: 'student', open: 'edit' });
  stu('write B.2,1 0');
  assert.equal(stu('write B.2,2 0').judged.after[0], 'B 第 2 行变了，像 r2 − 2r1；第 1 行没变；和 A 行等价：是');
  // 0 1：一格凑得上 r2 − 2r1、一格凑得上 r2 − (3/2)r1，变了的两格只对得上一格，说不出是哪一步
  assert.equal(stu('write B.2,2 1').judged.after[0], 'B 第 2 行变了，看不出是哪一种初等行变换；第 1 行没变；和 A 行等价：否');
  // 还空着：是不是行等价说不了
  const p = make('matrix A = 1 2 / 2 4\nmatrix B = _ _ / _ _ from=A\nopen B edit input=keypad');
  for (const line of ['write B.1,1 1', 'write B.1,2 2']) p.apply(parseScript(line)[0], { by: 'student', open: 'edit' });
  assert.match(fromFact(M(p, 'B'), M(p, 'A')), /还有空着的格，和 A 是不是行等价还说不了$/);
  // 方程组照旧说同解
  const q = make('matrix M0 = 1 1 | 2 / 1 -1 | 0\nmatrix M1 = 1 1 | 2 / _ _ | _ from=M0');
  run(q, 'write M1.2,1 0\nwrite M1.2,2 -2\nwrite M1.2,3 -2');
  assert.match(fromFact(M(q, 'M1'), M(q, 'M0')), /和 M0 同解：是$/);
});

test('inferRowOp：一格改了、变了的格只对上一半：看不出；变了的格大半对得上照说像哪一步', () => {
  const g = (rows) => rows.map((r) => r.map((x) => (x == null ? null : toQ(x))));
  // 只改了一格（不是初等行变换）：凑一个 k 对上那一格，别的格就对不上了
  const one = inferRowOp(g([['1', '0', '0', '2'], ['3', '4', '5', '6']]), g([['1', '0', '0', '2'], ['3', '4', '5', '8']]));
  assert.equal(one.guess, null);
  // 两列的：变了的两格各凑得上一种倍加
  assert.equal(inferRowOp(g([['1', '2'], ['3', '4']]), g([['1', '2'], ['0', '2']])).guess, null);
  // 三列、r1 里有 0：消掉了第 1 格、第 3 格算错——变了的两格只对上一格，两种倍加一样像
  assert.equal(inferRowOp(g([['1', '0', '2'], ['3', '5', '7']]), g([['1', '0', '2'], ['0', '5', '2']])).guess, null);
  // 简报的那一张：变了的四格对上三格，照说像 r2 − r1
  const b = inferRowOp(g([['1', '2', '0', '2'], ['2', '2', '-4', '2'], ['0', '0', '-2', '-2']]), g([['1', '2', '0', '2'], ['1', '0', '4', '0'], ['0', '0', '-2', '-2']]));
  assert.equal(b.guess.text, 'r2 − r1');
  assert.deepEqual(b.bad, [{ c: 3, want: '-4', got: '4' }]);
});

test('inferRowOp 随机：真的一步初等行变换（对调、倍乘、倍加，整数和分数倍）总认得出，照认出的那一步做出来就是写的', () => {
  let seed = 20261109;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const q = (n, d = 1) => new Q(BigInt(n), BigInt(d));
  const apply = (G, gs) => {
    const H = G.map((r) => r.slice());
    const i = gs.i - 1;
    if (gs.kind === 'swap') { const j = gs.j - 1; [H[i], H[j]] = [H[j], H[i]]; return H; }
    const k = toQ(gs.k);
    H[i] = gs.kind === 'scale' ? G[i].map((x) => x.mul(k)) : G[i].map((x, c) => x.add(k.mul(G[gs.j - 1][c])));
    return H;
  };
  const same = (A, B) => A.every((r, i) => r.every((x, c) => x.sub(B[i][c]).zero));
  let named = 0;
  for (let n = 0; n < 2000; n++) {
    const rows = 2 + rnd(3), cols = 2 + rnd(4);
    const G0 = Array.from({ length: rows }, () => Array.from({ length: cols }, () => q(rnd(7) - 3)));
    const i = rnd(rows);
    let j = rnd(rows - 1); if (j >= i) j++;
    const kind = ['swap', 'scale', 'add'][rnd(3)];
    let k = q(rnd(7) - 3, 1 + rnd(3));
    if (k.zero || (kind === 'scale' && k.sub(q(1)).zero)) k = q(2);
    const G1 = apply(G0, { kind, i: i + 1, j: j + 1, k: String(k) });
    if (same(G0, G1)) continue; // 这一步什么也没变（加了全是 0 的一行、两行本来一样）
    const r = inferRowOp(G0, G1);
    assert.ok(r.guess, `${kind} 没认出来：${JSON.stringify(G0.map((x) => x.map(String)))} → ${JSON.stringify(G1.map((x) => x.map(String)))}`);
    assert.deepEqual(r.bad, []);
    assert.ok(same(apply(G0, r.guess), G1), `认成 ${r.guess.text}，做出来和写的不一样`);
    named++;
  }
  assert.ok(named > 1500, `真的一步变了的有 ${named} 组`);
});

test('changed：数变了的格（ask pick 交了以后和真变了的比）；没变的格、多出来的格不算', () => {
  const s = make('matrix M = 1 0 2 / 3 5 4');
  const before = structuredClone(s.objects.get('M'));
  run(s, 'rowop M r2 - 3r1');
  const o = s.objects.get('M');
  // 第 2 行：3 → 0、5 → 5（没变）、4 → −2
  assert.deepEqual(R.changed(before, o), ['2.1', '2.3']);
  assert.deepEqual(changedKeys(o, before, o), ['2.1', '2.3']);
  const t = make('matrix M = 1 2 / 3 4');
  const b2 = structuredClone(t.objects.get('M'));
  // 对调两行：格子整个挪走（key 跟着格走），按位置比，四个位置的数都变了
  run(t, 'rowop M r1 <-> r2');
  const M = t.objects.get('M');
  assert.deepEqual(R.changed(b2, M).map((k) => { const x = M.cells.find((c) => c.key === k); return `${x.r},${x.c}`; }), ['1,1', '1,2', '2,1', '2,2']);
});

test('并同类项认不出、不同类：这个世界做不到（legal: false），学生的一下弹回去；只认 数 × 同一个矩阵，不说「不是同类项」', () => {
  const s = make('matrix A = 1 2 / 3 4\nmatrix B = 0 1 / 1 0\nmatrix X = {A + B}\nmatrix Y = {A}\nmatrix Z = {-2 A}\nmatrix W = {-B}\nmatrix N = 1 2 / 3 4');
  const v = R.check(M(s, 'X'), { type: 'merge', into: 'Y' }, s);
  assert.equal(v.legal, false);
  assert.equal(v.why, '页面看不出是不是同类项（只认 数 × 矩阵）');
  const v2 = R.check(M(s, 'Z'), { type: 'merge', into: 'W' }, s);
  assert.equal(v2.legal, false);
  assert.equal(v2.why, 'Z 是 −2·A，W 是 −1·B，不是同一个矩阵的倍数，并不了');
  // 不是跟着算的（一张写满数的矩阵）也看不出
  assert.equal(R.check(M(s, 'N'), { type: 'merge', into: 'Y' }, s).why, '页面看不出是不是同类项（只认 数 × 矩阵）');
  // 能并的：照收，不判对错
  assert.deepEqual(R.check(M(s, 'Z'), { type: 'merge', into: 'Y' }, s), { legal: true, right: null });
  for (const k of ['compare', 'put', 'merge']) assert.ok(!R.judges.includes(k), `${k} 不判对错`);
  // 学生的一下：照这一行过裁判，做不到就弹回去，舞台一点不动
  run(s, 'open Z merge');
  const fx = s.apply(parseScript('merge Z W')[0], { by: 'student', open: 'merge' });
  assert.ok(fx.blocked);
  assert.ok(s.objects.has('Z'));
  assert.deepEqual(R.actOf(M(s, 'Z'), parseScript('merge Z W')[0], s.helpers(parseScript('merge Z W')[0])), { type: 'merge', into: 'W' });
  assert.deepEqual(R.actOf(M(s, 'Z'), parseScript('put Z Sum')[0], s.helpers(parseScript('put Z Sum')[0])), { type: 'put', into: 'Sum' });
  // 收集用的不是 Sum：put 也做不到
  assert.equal(R.check(M(s, 'Z'), { type: 'put', into: 'Y' }, s).why, 'Y 不是收集用的矩阵（写 matrix Y = collect）');
});
