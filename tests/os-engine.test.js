// 操作系统的演示引擎（engines/os.js）：和王道 / 经典教材的例子对答案
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedEngine, pagingEngine, bankerEngine, diskEngine, safeSequences } from '../kit/src/engines/os.js';
import { checkAsk, misreadAnswer, misreadFill } from '../kit/src/stepperspec.js';

const go = (eng, f) => { const input = eng.parse(f); return { input, r: eng.run(input) }; };

// 和 stepper.js 一样拿常见错法比（答错了才比）：先猜比题面一样的那一问，quiz 比答案，填表逐格比
const vruns = (eng, input, fields) => eng.variants(input, fields).map((v) => ({ label: v.label, input: v.input, run: eng.run(v.input) }));
const askAns = (a) => (Array.isArray(a.alts) ? a.alts.map((z) => [].concat(z).join(' ')).join(' | ') : [].concat(a.answer).join(' '));
function askDiag(eng, input, ask, given, fields = {}) {
  if (checkAsk(ask, given).ok) return '';
  return misreadAnswer(given, vruns(eng, input, fields).map((v) => { const a = v.run.steps.flatMap((x) => [x.ask, ...(x.asks || [])]).find((y) => y && y.q === ask.q && y.kind === ask.kind); return a ? { label: v.label, answer: askAns(a) } : null; }).filter(Boolean));
}
function quizDiag(eng, input, given, fields = {}) {
  if (misreadAnswer(given, [{ label: 'ok', answer: String(eng.quiz(input, eng.run(input), fields).answer) }])) return '';
  return misreadAnswer(given, vruns(eng, input, fields).map((v) => ({ label: v.label, answer: String(eng.quiz(v.input, v.run, fields).answer) })));
}
const fillAs = (eng, inp, fields = {}) => eng.table(inp, eng.run(inp), fields).rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));
const fillDiag = (eng, input, values, fields = {}) => misreadFill(eng.table(input, eng.run(input), fields), values, vruns(eng, input, fields).map((v) => ({ label: v.label, table: eng.table(v.input, v.run, fields) })));
const pick = (eng, input, re, fields = {}) => { const v = eng.variants(input, fields).find((x) => re.test(x.label)); assert.ok(v, `没有「${re}」这种错法`); return v; };
const segs = (r) => r.segs.map((x) => `${x.name || '-'}:${x.s}-${x.e}`).join(' ');
const W = 'P1 0 7, P2 2 4, P3 4 1, P4 5 4';

test('进程调度：FCFS、SJF、SRTF、HRRN 的平均周转时间（王道的例子）', () => {
  assert.equal(go(schedEngine, { algo: 'fcfs', procs: W }).r.avgTurn, 8.75);
  assert.equal(go(schedEngine, { algo: 'sjf', procs: W }).r.avgTurn, 8);
  const s = go(schedEngine, { algo: 'srtf', procs: W });
  assert.equal(s.r.avgTurn, 7);
  assert.equal(segs(s.r), 'P1:0-2 P2:2-4 P3:4-5 P2:5-7 P4:7-11 P1:11-16');
  assert.equal(schedEngine.quiz(s.input, s.r, {}).answer, 'P1 P2 P3 P2 P4 P1');
  assert.equal(segs(go(schedEngine, { algo: 'hrrn', procs: W }).r), 'P1:0-7 P3:7-8 P2:8-12 P4:12-16');
  assert.equal(schedEngine.quiz(s.input, s.r, { quiz: 'avg' }).answer, '7');
});

test('进程调度：RR（新到的先入队）、优先级、CPU 空闲、写法报错', () => {
  assert.equal(segs(go(schedEngine, { algo: 'rr q=2', procs: 'P1 0 5, P2 2 4, P3 4 1, P4 5 6' }).r), 'P1:0-2 P2:2-4 P1:4-6 P3:6-7 P2:7-9 P4:9-11 P1:11-12 P4:12-14 P4:14-16');
  assert.equal(segs(go(schedEngine, { algo: 'prio', procs: 'P1 0 3 3, P2 1 2 1, P3 2 4 2' }).r), 'P1:0-3 P2:3-5 P3:5-9');
  assert.equal(segs(go(schedEngine, { algo: 'pprio', procs: 'P1 0 3 3, P2 1 2 1, P3 2 4 2' }).r), 'P1:0-1 P2:1-3 P3:3-7 P1:7-9');
  assert.equal(segs(go(schedEngine, { algo: 'pprio', procs: 'P1 0 3 3, P2 1 2 1, P3 2 4 2', prio: 'large' }).r), 'P1:0-3 P3:3-7 P2:7-9');
  assert.equal(segs(go(schedEngine, { algo: 'fcfs', procs: 'P1 0 2, P2 5 1' }).r), 'P1:0-2 -:2-5 P2:5-6');
  const { input, r } = go(schedEngine, { algo: 'sjf', procs: W });
  for (const s of r.steps) assert.match(schedEngine.view(s.view, input), /os-gantt/);
  assert.deepEqual(r.steps.filter((s) => s.ask?.tag === 'next').map((s) => s.ask.answer), ['P1', 'P3', 'P2', 'P4']);
  assert.throws(() => schedEngine.parse({ procs: W }), /algo/);
  assert.throws(() => schedEngine.parse({ algo: 'rr', procs: W }), /时间片/);
  assert.throws(() => schedEngine.parse({ algo: 'prio', procs: W }), /优先级/);
  assert.throws(() => schedEngine.parse({ algo: 'fcfs', procs: 'P1 0' }), /看不懂/);
});

test('页面置换：OPT 9、FIFO 15、LRU 12 次缺页（经典引用串）；Belady 现象', () => {
  const R = '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1';
  const f = (algo, refs = R, frames = '3') => go(pagingEngine, { refs, frames, algo }).r.faults;
  assert.equal(f('opt'), 9);
  assert.equal(f('fifo'), 15);
  assert.equal(f('lru'), 12);
  assert.equal(f('fifo', '1 2 3 4 1 2 5 1 2 3 4 5', '3'), 9);
  assert.equal(f('fifo', '1 2 3 4 1 2 5 1 2 3 4 5', '4'), 10, 'FIFO 多一个物理块反而多缺页');
  const { input, r } = go(pagingEngine, { refs: R, frames: '3', algo: 'clock' });
  assert.ok(r.faults >= 9 && r.faults <= 15);
  for (const s of r.steps) assert.match(pagingEngine.view(s.view, input), /os-pt/);
  // 换出哪一页：答案在上一步的表的最后一列里点得到
  const lru = go(pagingEngine, { refs: R, frames: '3', algo: 'lru' });
  lru.r.steps.forEach((s, k) => { if (s.ask?.tag === 'victim') assert.match(pagingEngine.view(lru.r.steps[k - 1].view, lru.input), new RegExp(`data-pick="${s.ask.answer}"`)); });
  assert.equal(pagingEngine.quiz(lru.input, lru.r, {}).answer, '12');
  assert.throws(() => pagingEngine.parse({ refs: R, frames: '3', algo: 'mru' }), /algo/);
});

test('银行家算法：安全序列（几种都对）、请求能不能分配', () => {
  const B = { avail: '3 3 2', max: 'P0 7 5 3; P1 3 2 2; P2 9 0 2; P3 2 2 2; P4 4 3 3', alloc: 'P0 0 1 0; P1 2 0 0; P2 3 0 2; P3 2 1 1; P4 0 0 2' };
  const { input, r } = go(bankerEngine, B);
  assert.equal(r.safe, true);
  assert.ok(r.seqs.some((x) => x.join(' ') === 'P1 P3 P4 P2 P0'), '王道书上的那个序列也在');
  assert.ok(bankerEngine.quiz(input, r).answer.includes('P1 P3 P4 P2 P0'));
  assert.equal(go(bankerEngine, { ...B, request: 'P1 1 0 2' }).r.safe, true);
  assert.equal(go(bankerEngine, { ...B, request: 'P4 3 3 0' }).r.safe, false);
  assert.match(go(bankerEngine, { ...B, request: 'P0 8 0 0' }).r.steps.at(-1).msg, /超过了它还需要的/);
  assert.match(go(bankerEngine, { ...B, request: 'P2 4 0 0' }).r.steps.at(-1).msg, /资源不够/);
  assert.equal(safeSequences([0, 0], [[1, 0]], [[0, 0]]).length, 0);
  assert.throws(() => bankerEngine.parse({ ...B, alloc: 'P0 9 9 9; P1 0 0 0; P2 0 0 0; P3 0 0 0; P4 0 0 0' }), /还多/);
});

test('磁盘调度：经典的 FCFS 640、SSTF 236、SCAN 331、C-SCAN 183；王道的例子', () => {
  const D = { requests: '98 183 37 122 14 124 65 67', head: '53' };
  const d = (algo, extra = {}) => go(diskEngine, { ...D, algo, ...extra }).r.dist;
  assert.equal(d('fcfs'), 640);
  assert.equal(d('sstf'), 236);
  assert.equal(d('scan'), 331);
  assert.equal(d('look'), 299);
  assert.equal(d('cscan'), 183);
  assert.equal(d('cscan', { jump: 'count' }), 382);
  assert.equal(d('scan', { dir: 'down' }), 236);
  const w = go(diskEngine, { requests: '55 58 39 18 90 160 150 38 184', head: '100', algo: 'sstf' });
  assert.equal(w.r.dist, 248);
  assert.equal(diskEngine.quiz(w.input, w.r, { quiz: 'order' }).answer, '90 58 55 39 38 18 150 160 184');
  for (const s of w.r.steps) assert.match(diskEngine.view(s.view, w.input), /os-disk/);
  assert.throws(() => diskEngine.parse({ ...D, algo: 'scan', tracks: '0-50' }), /tracks/);
});

test('银行家算法的常见错法：Max 当 Need、Work 加的不是 Allocation、请求没先和 Need 比、试分配没改状态', () => {
  const B = { avail: '3 3 2', max: 'P0 7 5 3; P1 3 2 2; P2 9 0 2; P3 2 2 2; P4 4 3 3', alloc: 'P0 0 1 0; P1 2 0 0; P2 3 0 2; P3 2 1 1; P4 0 0 2' };
  const { input, r } = go(bankerEngine, B);
  const needMax = pick(bankerEngine, input, /Max 当成了 Need/), workNeed = pick(bankerEngine, input, /Work 加的是 Need/), workMax = pick(bankerEngine, input, /Work 加的是 Max/);
  // Need 用 Max：走到 P3 以后谁也运行不了，学生写「不安全」
  assert.equal(quizDiag(bankerEngine, input, '不安全'), needMax.label);
  assert.equal(quizDiag(bankerEngine, input, 'P1 P3 P4 P2 P0'), '', '对的安全序列不比');
  // Work += Need：有的序列只有这么算才「安全」
  const wn = bankerEngine.run(workNeed.input).seqs.map((x) => x.join(' ')).find((s) => !r.seqs.some((y) => y.join(' ') === s));
  assert.ok(wn);
  assert.equal(quizDiag(bankerEngine, input, wn), workNeed.label);
  // 填表：按错法填的整张表认得出来；对的表不报
  assert.equal(fillDiag(bankerEngine, input, fillAs(bankerEngine, workMax.input)), workMax.label);
  assert.equal(fillDiag(bankerEngine, input, fillAs(bankerEngine, needMax.input)), needMax.label, '不安全的表后面几行空着，行数和对的表一样，比得上');
  assert.equal(fillDiag(bankerEngine, input, fillAs(bankerEngine, input)), '');
  assert.equal(bankerEngine.table(needMax.input, bankerEngine.run(needMax.input)).rows.length, bankerEngine.table(input, r).rows.length);

  // 请求超过 Need：只和 Available 比就会「能分配」
  const q1 = go(bankerEngine, { ...B, request: 'P1 2 0 0' });
  const ask1 = q1.r.steps.find((s) => s.ask?.tag === 'request').ask;
  const noNeed = pick(bankerEngine, q1.input, /没先和 Need 比/);
  assert.equal(askDiag(bankerEngine, q1.input, ask1, '能分配'), noNeed.label);
  assert.equal(askDiag(bankerEngine, q1.input, ask1, '不能：超过它声明的需求'), '');
  assert.equal(quizDiag(bankerEngine, q1.input, '能'), noNeed.label);
  assert.ok(!bankerEngine.variants(go(bankerEngine, { ...B, request: 'P1 1 0 2' }).input, {}).some((v) => /没先和 Need 比/.test(v.label)), '请求没超过 Need 时这种错法和对的一样，不列');
  // 分了就不安全：拿原来的状态检查会以为能分
  const q2 = go(bankerEngine, { ...B, request: 'P4 3 3 0' });
  const ask2 = q2.r.steps.find((s) => s.ask?.tag === 'request').ask;
  assert.equal(askDiag(bankerEngine, q2.input, ask2, '能分配'), pick(bankerEngine, q2.input, /试分配以后没改/).label);
  assert.equal(askDiag(bankerEngine, q2.input, ask2, '不能：分配了就不安全'), '');
});
