// 检验修正（dr-plan4-fix 第 4、5 条）：快排按真题说的「趟」（round#、rounds、trace 的 by: round），
// C-SCAN / C-LOOK 跳回去的距离算不算要写明（disk 的 jump: count / skip，用到 dist、avg 时自检报）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, run, roundsOf } from '../kit/src/engines/sort.js';
import { measure, variantValues, MEASURES } from '../kit/src/engines/measures.js';
import { ENGINES } from '../kit/src/engines/registry.js';
import { parseProbe, probeProblems, traceTable, JUMP_MSG } from '../kit/src/check/spec.js';
import { judgeMachine } from '../kit/src/check/judge.js';

const P = (type, src) => { const r = parseProbe(type, src.trim()); if (r.error) throw new Error(r.error); return r.probe; };
const seq = (s) => s.split(' ').map((x) => Number(x.replace(/′/g, '')));
const row = (s) => s.split(' ');
const ARR = "49 38 65 97 76 13 27 49′";

// —— 第 4 条：快排的趟 ——

test('快排 round#：一层划分做完；pass# 照旧是第几次划分', () => {
  const v = measure('sort', { algo: 'quick', array: ARR }).values;
  assert.deepEqual(v.round1, seq('27 38 13 49 76 97 65 49′'));
  assert.deepEqual(v.round2, seq('13 27 38 49 49′ 65 76 97'));
  assert.equal(v.rounds, 3); // 第 3 趟只剩 [49′ 65] 那一个子表
  // 第 2 次划分只划分了左边的子表
  assert.deepEqual(v.pass2, seq('13 27 38 49 76 97 65 49′'));
  assert.equal(v.passes, 4);
  assert.ok(MEASURES.sort.includes('rounds') && MEASURES.sort.includes('round#'));
  // 别的排序不交 rounds
  assert.equal(measure('sort', { algo: 'shell', array: ARR, gaps: '4 2 1' }).values.rounds, undefined);
});

test('roundsOf：同一层的区间各自按划分完那一刻的样子拼', () => {
  const log = [
    { d: 1, lo: 0, hi: 3, after: [1, 0, 2, 3] },
    { d: 2, lo: 0, hi: 1, after: [0, 1, 2, 3] },
    { d: 2, lo: 3, hi: 3, after: [0, 1, 2, 3] },
  ];
  assert.deepEqual(roundsOf([2, 1, 0, 3], log), [[1, 0, 2, 3], [0, 1, 2, 3]]);
  assert.deepEqual(roundsOf([5], []), []);
});

test('2019 年 408 第 10 题：只有 D 不可能是快排第二趟的结果（八个数的全排列都跑一遍引擎）', () => {
  // 题面：「排序过程中，对尚未确定最终位置的所有元素进行一遍处理称为一趟排序。下列序列中，不可能是快速排序第二趟结果的是」
  const options = {
    A: '5 2 16 12 28 60 32 72',
    B: '2 16 5 28 12 60 32 72',
    C: '2 12 16 5 28 32 72 60',
    D: '5 2 12 28 16 32 72 60',
  };
  const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
  const second = new Set();
  for (const p of perms([2, 5, 12, 16, 28, 32, 60, 72])) second.add(run(parse({ algo: 'quick', array: p.join(' ') })).rounds[1].join(' '));
  assert.deepEqual(Object.keys(options).filter((k) => !second.has(options[k])), ['D']);
});

test('快排的错法也按层交：variantValues 的 round1', () => {
  const f = { algo: 'quick', array: ARR };
  assert.deepEqual(variantValues('sort', f, 'quickSwap').values.round1, seq('13 38 27 49 76 97 65 49′'));
  assert.equal(variantValues('sort', f, 'quickSwap').values.rounds, 3);
});

test('predict 用 round2：照真题的趟判；别的排序写 round# 自检报', () => {
  const p = P('predict', `id: p1\nq: 快排第二趟以后\ntarget: 把一次划分当成一趟\nlevel: 方法\nrun r: sort algo=quick array="49 38 65 97 76 13 27 49′"\nexpect 第二趟: r.round2`);
  assert.deepEqual(probeProblems(p), []);
  assert.equal(judgeMachine(p, { expects: { x1: '13 27 38 49 49′ 65 76 97' } }).items[0].ok, true);
  assert.equal(judgeMachine(p, { expects: { x1: '13 27 38 49 76 97 65 49′' } }).items[0].ok, false); // 那是第 2 次划分
  const bad = P('predict', `id: p2\nq: x\ntarget: t\nlevel: 方法\nrun r: sort algo=shell gaps="4 2 1" array="49 38 65 97 76 13 27 49′"\nexpect 第二趟: r.round2`);
  assert.ok(probeProblems(bad).some((m) => /round#、rounds 只有快排有/.test(m)));
});

const QUICK = (extra = '') => `
id: t1
q: 对下面的序列做快速排序，写出每一趟结束后的序列
target: 把一次划分当成一趟
level: 方法
use: sort
algo: quick
array: ${ARR}
${extra}`;

test('trace by: round：一趟一行（第 k 趟），照表判；不写 by 照旧一次划分一行', () => {
  const p = P('trace', QUICK('by: round'));
  assert.equal(p.fill.by, 'round');
  const T = traceTable(p);
  assert.deepEqual(T.table.rows.map((r) => r.label), ['第 1 趟', '第 2 趟', '第 3 趟']);
  assert.deepEqual(T.table.rows.map((r) => r.cells.map((c) => [].concat(c.v)[0]).join(' ')), ['27 38 13 49 76 97 65 49', '13 27 38 49 49 65 76 97', '13 27 38 49 49 65 76 97']);
  assert.deepEqual(probeProblems(p), []);
  const R = ['27 38 13 49 76 97 65 49′', '13 27 38 49 49′ 65 76 97', '13 27 38 49 49′ 65 76 97'];
  assert.deepEqual(judgeMachine(p, { cells: R.map(row) }).items.map((x) => x.ok), [true, true, true]);
  // 第 2 趟写成第 2 次划分：r2 没过，快排不接着核后面的行
  const wrong = judgeMachine(p, { cells: [row(R[0]), row('13 27 38 49 76 97 65 49′'), row(R[2])] });
  assert.equal(wrong.items.find((x) => x.id === 'r2').ok, false);
  assert.match(wrong.items.find((x) => x.id === 'r2').why, /^第 2 趟/);
  assert.ok(!wrong.items.some((x) => x.carried));
  // 错法的表也按层
  const sw = T.variants.find((x) => x.key === 'quickSwap');
  assert.equal(sw.table.rows[0].cells.map((c) => [].concat(c.v)[0]).join(' '), '13 38 27 49 76 97 65 49');
  // 不写 by：一次划分一行（4 行）
  assert.equal(traceTable(P('trace', QUICK())).table.rows.length, 4);
});

test('trace by: 只能写 round、只给快排', () => {
  assert.match(parseProbe('trace', QUICK('by: level').trim()).error, /by: 只能写 round/);
  const shell = parseProbe('trace', QUICK('by: round').replace('algo: quick', 'algo: shell\ngaps: 4 2 1').trim()).error;
  assert.match(shell, /by: round 只给快排/);
});

// —— 第 5 条：C-SCAN / C-LOOK 跳回去 ——

const DISK = { requests: '98 183 37 122 14 124 65 67', head: '53', algo: 'cscan' };

test('disk 的 jump: skip 和不写一样（不算跳回去），count 算；写别的报', () => {
  const dist = (jump) => measure('disk', { ...DISK, ...(jump ? { jump } : {}) }).values.dist;
  assert.equal(dist(), dist('skip'));
  assert.equal(dist('不算'), dist('skip'));
  assert.equal(dist('count'), 382);
  assert.equal(dist('count') - dist('skip'), 199); // 199 → 0 那一段
  assert.throws(() => ENGINES.disk.parse({ ...DISK, jump: 'maybe' }), /jump: 写 count（跳回去的距离算）或 skip（不算）/);
});

const DP = (algo, extra, expect = 'r.dist') => P('predict', `id: d1\nq: 磁头移动多少\ntarget: t\nlevel: 方法\nrun r: disk algo=${algo} head=53 requests="98 183 37 122 14 124 65 67"${extra}\nexpect 移动: ${expect}`);

test('predict 用 C-SCAN / C-LOOK 的 dist、avg 没写 jump：自检报；写了、别的算法、只问 order 不报', () => {
  const has = (p) => probeProblems(p).some((m) => m.includes(JUMP_MSG));
  assert.ok(has(DP('cscan', '')));
  assert.ok(has(DP('clook', '', 'r.avg')));
  assert.ok(has(DP('c-scan', '')));
  assert.ok(!has(DP('cscan', ' jump=count')));
  assert.ok(!has(DP('clook', ' jump=skip')));
  assert.ok(!has(DP('scan', '')));
  assert.ok(!has(DP('cscan', '', 'r.order')));
  assert.equal(JUMP_MSG, '写明 jump: count 或 jump: skip，题面也写清楚跳回去算不算');
});

test('calc 的 result、construct 的条件用到 C-SCAN 的 dist 也报；trace 的 disk C-LOOK 没写 jump 报', () => {
  const c = P('calc', `id: c1\nq: 算 C-SCAN 移动的磁道数\ntarget: t\nlevel: 方法\nsteps:\ns1 calc: 依次访问\nrun r: disk algo=cscan head=53 requests="98 183 37"\nresult: r.dist`);
  assert.ok(probeProblems(c).some((m) => m.includes(JUMP_MSG)));
  const k = P('construct', `id: k1\nq: 造一组请求\ntarget: t\nlevel: 核心\nslots: R=seq(4)\nrun r: disk algo=clook head=50 requests=R\nif: r.dist >= 100 => 太短\nexample: R=10 90 20 80`);
  assert.ok(probeProblems(k).some((m) => m.includes(JUMP_MSG)));
  const t = (extra) => P('trace', `id: t2\nq: 填表\ntarget: t\nlevel: 方法\nuse: disk\nalgo: clook\nhead: 53\nrequests: 98 183 37 122\n${extra}`);
  assert.ok(probeProblems(t('')).some((m) => m.includes(JUMP_MSG)));
  assert.ok(!probeProblems(t('jump: count')).some((m) => m.includes(JUMP_MSG)));
});
