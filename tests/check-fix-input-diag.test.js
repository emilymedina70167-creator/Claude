// 计划 4 验收以后的修正（dr-plan4-fix 1、3 和两条小的）：
//   1 交之前读不懂的挡住（全角、末尾标点、单位、复杂度），判的时候同一套读法；construct 的格子也先全角转半角
//   3 几种诊断撞在同一个错答案上都记（predict、trace），固定题自检报、模板重取
//   小的：错法标 tagFit（exact / partial，partial 的话写「可能」）；只问字面答案的 predict 不要 run 行
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe, parseCheck, selfCheck, probeIssues, slotProblems, traceTable } from '../kit/src/check/spec.js';
import { judgeMachine, expectProblems, notReady, teachFor } from '../kit/src/check/judge.js';
import { valueMatch, numMatch, bigO, seqMatch, cleanInput, halfWidth, readProblem } from '../kit/src/check/values.js';
import { createFlow, step } from '../kit/src/check/flow.js';
import { evidenceOf } from '../kit/src/check/record.js';

const P = (type, src) => { const r = parseProbe(type, src.trim()); assert.equal(r.error, undefined, r.error); return r.probe; };
const item = (r, id) => r.items.find((x) => x.id === id);
const F = '```';

// —— 1：读法 ——

test('cleanInput：全角转半角、去掉末尾的标点；上标不被 NFKC 吃掉', () => {
  assert.equal(cleanInput('０.６'), '0.6');
  assert.equal(cleanInput('3／5'), '3/5');
  assert.equal(cleanInput(' 0.6。 '), '0.6');
  assert.equal(cleanInput('12,'), '12');
  assert.equal(cleanInput('2 5 8。'), '2 5 8');
  assert.equal(cleanInput('.'), '.'); // 去完什么都不剩：留着，照旧读不懂
  assert.equal(halfWidth('O(n²)'), 'O(n^2)');
  assert.equal(halfWidth('O(2ⁿ)'), 'O(2^n)');
  assert.equal(halfWidth('½'), '1/2');
});

test('值：请求里的每一个例子都读得懂（末尾标点、全角）；5. 照旧是 5', () => {
  for (const s of ['0.6。', '0.6.', '０.６', '3／5', '０．６', '60％']) assert.equal(valueMatch(s, 0.6), true, s);
  assert.equal(valueMatch('12,', 12), true);
  assert.equal(valueMatch('１２。', 12), true);
  assert.equal(numMatch('5.', 5), true);
  assert.equal(numMatch('5.', 5.5), false);
  assert.equal(valueMatch('2 5 8。', [2, 5, 8]), true);
  assert.equal(valueMatch('2 5 8。', '2 5 8'), true);
  assert.equal(seqMatch('２，５，８。', [2, 5, 8]), true);
  assert.equal(bigO('O（nlogn）。'), 'O(nlogn)');
  // 读不懂的照旧是 null（交之前就挡住了）
  assert.equal(valueMatch('12次', 12), null);
  assert.equal(valueMatch('12 次', 12), null);
  assert.equal(valueMatch('O(n2)', 'O(n^2)'), null);
});

test('readProblem：按对的值的样子说；不说要写几个', () => {
  assert.equal(readProblem('12次', 12, '缺页次数'), '「缺页次数」只写数（分数、小数、百分数），不写单位');
  assert.equal(readProblem('12 次', 12, '缺页次数'), '「缺页次数」只写数（分数、小数、百分数），不写单位');
  assert.equal(readProblem('O(n2)', 'O(n^2)', '时间复杂度'), '「时间复杂度」写成 O(n^2) 这样');
  assert.equal(readProblem('7 0 1 次', [7, 0, 1], '换出的页'), '「换出的页」写一串数，用空格或逗号隔开');
  assert.doesNotMatch(readProblem('7 0', [7, 0, 1], '换出的页'), /个/); // 少写一个读得懂，不提示个数
  assert.equal(readProblem('7 0', [7, 0, 1], '换出的页'), '');
  for (const s of ['0.6。', '0.6.', '０.６', '3／5', '3/5']) assert.equal(readProblem(s, 0.6, 'x'), '', s);
  assert.equal(readProblem('2 5 8。', [2, 5, 8], 'x'), '');
  assert.equal(readProblem('P1 P2', 'P1 P2', '先后'), ''); // 字不挡
});

// LRU、3 块、王道那串：缺页 12，OPT 9
const WANGDAO = '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1';
const LRU = (extra = '') => P('predict', `
id: p2
q: LRU 缺页几次、依次换出哪几页
target: LRU 当成 OPT
level: 方法
run r: paging algo=lru frames=3 refs="${WANGDAO}"
expect 缺页次数: r.faults
expect x2 换出的页: r.victims
expect x3 缺页率: r.rate
${extra}`);

test('predict 交之前：expectProblems 挡住带单位的、一串数里夹了字的；全角、末尾标点照读（不算第一次作答）', () => {
  const p = LRU();
  const ok = { x1: '１２。', x2: '7 0 1 2 0 3 0 4 2,', x3: '12／20' };
  assert.deepEqual(expectProblems(p, ok), []);
  assert.deepEqual(expectProblems(p, { ...ok, x1: '12次' }), ['「缺页次数」只写数（分数、小数、百分数），不写单位']);
  assert.deepEqual(expectProblems(p, { ...ok, x1: '12 次' }), ['「缺页次数」只写数（分数、小数、百分数），不写单位']);
  assert.deepEqual(expectProblems(p, { ...ok, x2: '7、0、1。' }), []);
  assert.deepEqual(expectProblems(p, { ...ok, x2: '7 0 1 页' }), ['「换出的页」写一串数，用空格或逗号隔开']);
  assert.deepEqual(expectProblems(p, { ...ok, x3: '' }), ['「缺页率」还没写']);
  // 判的时候同一套读法：交得了的都读得懂
  const r = judgeMachine(p, { expects: { x1: '１２。', x2: '7 0 1 2 0 3 0 4 2', x3: '0.6.' } });
  assert.deepEqual(r.items.map((x) => [x.id, x.ok]), [['x1', true], ['x2', false], ['x3', true]]);
});

test('predict 交之前：复杂度写漏了 ^ 挡住；只问字面答案的 predict 不要 run 行', () => {
  const p = P('predict', 'id: q\ntarget: 平均和最坏\nlevel: 基础\nq: 快排平均时间复杂度\nexpect 时间复杂度: O(n log n)\nwrong w1: O(n^2) => 那是最坏情况');
  assert.equal(p.runs, undefined);
  assert.deepEqual(expectProblems(p, { x1: 'O(n2)' }), ['「时间复杂度」写成 O(n^2) 这样']);
  assert.deepEqual(expectProblems(p, { x1: 'O（nlog₂n）。' }), []);
  assert.equal(item(judgeMachine(p, { expects: { x1: 'O（nlog₂n）。' } }), 'x1').ok, true);
  const w = item(judgeMachine(p, { expects: { x1: 'O(n²)' } }), 'x1');
  assert.equal(w.hit, 'w1');
  assert.equal(w.tagFit, 'exact');
  assert.deepEqual(probeIssues(p), { hard: [], redraw: [] });
  // 用到 r. 的量还是要 run；不写 run 不能写 against
  assert.match(parseProbe('predict', 'id: q\ntarget: x\nlevel: 基础\nexpect: r.faults').error, /要写 run 行：r\.faults/);
  assert.match(parseProbe('predict', 'id: q\ntarget: x\nlevel: 基础\nexpect: 3\nagainst: fifo').error, /against: 要和 run 行一起写/);
  // 引号里的字、小数不当成量
  assert.equal(parseProbe('predict', 'id: q\ntarget: x\nlevel: 基础\nexpect: "r.faults"').error, undefined);
  assert.equal(parseProbe('predict', 'id: q\ntarget: x\nlevel: 基础\nexpect: 0.5').error, undefined);
  // 整份检验的自检也收
  const { check, errors } = parseCheck('check id=k1', ['block DS-L8.1 must=q', `${F}predict\nid: q\nq: 快排平均\ntarget: x\nlevel: 基础\nexpect 时间复杂度: O(n log n)\nteach default: 平均每次划分大致对半\nretry: qa, qb\n${F}`, `${F}predict\nid: qa\nq: 归并\ntarget: x\nlevel: 基础\nexpect: O(n log n)\n${F}`, `${F}predict\nid: qb\nq: 堆排\ntarget: x\nlevel: 基础\nexpect: O(n log n)\n${F}`].join('\n'));
  assert.deepEqual(errors, []);
  assert.deepEqual(selfCheck(check), []);
});

test('construct：一排数末尾带句号、全角都读得懂；数学的格子先全角转半角', () => {
  assert.deepEqual(slotProblems({ kind: 'seq', n: 3 }, '2 5 8。'), []);
  assert.deepEqual(slotProblems({ kind: 'seq', n: 3 }, '２，５，８'), []);
  assert.deepEqual(slotProblems({ kind: 'seq', n: 3 }, '2 5 8 次'), ['要 3 个数，写了 4 个', '「次」不是数']);
  const sh = P('construct', 'id: q\ntarget: x\nlevel: 核心\nslots: A=seq(8) P=seq(2)\nrun r: sort algo=shell gaps="4 2 1" array=A\nif: r.unstable >= 1 => 稳定\nif: P in r.flipped => 这一对没换\nexample: A=4 7 4 1 2 5 7 8 P=4 4\'');
  const r = judgeMachine(sh, { slots: { A: '４ ７ ４ １ ２ ５ ７ ８。', P: '4 4′。' } });
  assert.deepEqual(r.items.map((x) => x.ok), [true, true]);
  const m = P('construct', 'id: q\ntarget: x\nlevel: 基础\nslots: A=mat(2)\nif: A != O => 零矩阵不算\nexample: A=[[1,0],[0,0]]');
  const ans = { slots: { A: [['１/２', '0'], ['0', '0']] } };
  assert.equal(notReady(m, ans), '');
  assert.equal(item(judgeMachine(m, ans), 'if1').ok, true);
});

// —— 3：几种诊断撞在同一个错答案上 ——

const COLLIDE = () => P('predict', `
id: p2
q: 3 个物理块、LRU，引用串 ${WANGDAO}，缺页几次
target: LRU 当成 OPT
level: 方法
run r: paging algo=lru frames=3 refs="${WANGDAO}"
expect 缺页次数: r.faults
wrong w1: r.faults - 3 => 一开始调入的 3 次没算缺页
teach tag=opt: LRU 往前看，不往后看。
teach w1: 一开始调入也是缺页。
teach default: 往前数最久没用的。`);

test('predict：写 9（OPT、少算开头 3 次、wrong w1 都是 9）→ tags 全记、没有单个 tag、补讲 x1 → default', () => {
  const p = COLLIDE();
  const r = judgeMachine(p, { expects: { x1: '9' } });
  const x1 = item(r, 'x1');
  assert.equal(x1.ok, false);
  assert.ok(x1.tags.includes('opt') && x1.tags.includes('w1'), JSON.stringify(x1.tags));
  assert.equal(x1.tag, undefined);
  assert.equal(x1.hit, undefined);
  assert.match(x1.why, /^这几种错法在这组数上答案一样：/);
  assert.match(x1.why, /OPT/);
  assert.match(x1.why, /一开始调入的 3 次没算缺页/);
  assert.deepEqual(x1.keys, ['x1', 'default']);
  assert.equal(teachFor(p, ['x1'], r.items).key, 'default');
  // 只对上一种的照旧（写 15：只有 FIFO）
  const f = item(judgeMachine(p, { expects: { x1: '15' } }), 'x1');
  assert.equal(f.tag, 'fifo');
  assert.equal(f.tagFit, 'exact');
  assert.equal(f.tags, undefined);
  assert.deepEqual(f.keys, ['tag=fifo', 'x1']);
});

test('predict 自检：固定题报「x1 上 w1 和 opt 的答案一样」；模板取到这种数算重取', () => {
  const p = COLLIDE();
  const { hard, redraw } = probeIssues(p);
  assert.deepEqual(hard, []);
  assert.ok(redraw.some((m) => /^x1 上 w1、.*opt.* 的答案一样/.test(m)), redraw.join('\n'));
  // against 只留一种、w1 也分得开（这组数上 fifo 是 15）：不报
  const apart = P('predict', `id: p2\ntarget: x\nlevel: 方法\nrun r: paging algo=lru frames=3 refs="${WANGDAO}"\nexpect: r.faults\nwrong w1: r.faults - 3 => 少了\nagainst: fifo`);
  assert.deepEqual(probeIssues(apart), { hard: [], redraw: [] });
  // 整份检验：报成写法错误
  const body = (id) => `${F}predict\nid: ${id}\nq: 缺页几次\ntarget: x\nlevel: 方法\nrun r: paging algo=lru frames=3 refs="${WANGDAO}"\nexpect: r.faults\nwrong w1: r.faults - 3 => 少了\nteach default: 往前数。\n${id === 'p2' ? 'retry: p2a, p2b\n' : ''}${F}`;
  const { check } = parseCheck('check id=k1', ['block OS-L3.4 must=p2', body('p2'), body('p2a'), body('p2b')].join('\n'));
  const errs = selfCheck(check);
  assert.ok(errs.some((m) => /^p2 的 x1 上 w1、.*opt.* 的答案一样/.test(m)), errs.join('\n'));
});

test('trace：错的那一行和几种错法一样像 → tags 全记、没有单个 tag', () => {
  const p = P('trace', 'id: t\ntarget: 快排划分\nlevel: 方法\nuse: sort\nalgo: quick\narray: 20 6 14 2 5 11');
  const T = traceTable(p);
  const row = (v, k) => v.table.rows[k].cells.map((c) => [].concat(c.v)[0]);
  const swap = T.variants.find((v) => v.key === 'quickSwap');
  const last = T.variants.find((v) => v.key === 'quickLast');
  assert.deepEqual(row(swap, 1), row(last, 1)); // 这组数第 2 次划分以后两种错法一样
  const r = judgeMachine(p, { cells: [row(T, 0), row(swap, 1)] });
  const it = r.items.find((x) => x.ok === false);
  assert.deepEqual(it.tags, ['quickSwap', 'quickLast']);
  assert.equal(it.tag, undefined);
  assert.equal(it.tagFit, 'exact');
  assert.match(it.why, /这几种错法在这组数上答案一样：/);
  assert.deepEqual(it.keys, [it.id, 'default']);
});

// —— 小的：tagFit ——

const SHELL = () => P('trace', 'id: t\ntarget: 希尔分组\nlevel: 方法\nuse: sort\nalgo: shell\narray: 49 38 65 97 76 13 27 49\ngaps: 4 2 1');

test('trace 的 tagFit：第 1 趟写成直接插入 38 49 65 97 76 13 27 49 → 还标 shellBlock 的话是 partial、话里「可能」', () => {
  const r = judgeMachine(SHELL(), { cells: ['38 49 65 97 76 13 27 49'.split(' ')] });
  const it = r.items.find((x) => x.ok === false);
  assert.equal(it.tag, 'shellBlock');
  assert.equal(it.tagFit, 'partial');
  assert.match(it.why, /可能像是/);
});

test('trace 的 tagFit：整行和错法填的一模一样是 exact，话里没有「可能」', () => {
  const p = SHELL();
  const T = traceTable(p);
  const v = T.variants.find((x) => x.key === 'shellBlock');
  const r = judgeMachine(p, { cells: [v.table.rows[0].cells.map((c) => [].concat(c.v)[0])] });
  const it = r.items.find((x) => x.ok === false);
  assert.equal(it.tag, 'shellBlock');
  assert.equal(it.tagFit, 'exact');
  assert.doesNotMatch(it.why, /可能/);
});

test('证据里每一项留着 tagFit、tags', () => {
  const src = (id) => `${F}predict\nid: ${id}\nq: 缺页几次\ntarget: x\nlevel: 方法\nrun r: paging algo=lru frames=3 refs="${WANGDAO}"\nexpect: r.faults\nwrong w1: r.faults - 3 => 少了\nteach default: 往前数。\n${id === 'p1' ? 'retry: p1a, p1b\n' : ''}${F}`;
  const { check } = parseCheck('check id=k1', ['block OS-L3.4 must=p1', src('p1'), src('p1a'), src('p1b')].join('\n'));
  const answer = { expects: { x1: '9' } };
  const machine = judgeMachine(check.probes.p1, answer);
  let s = step(createFlow(check), { type: 'start', at: 1795000000000 });
  s = step(s, { type: 'submit', id: 'p1', answer, sure: 'sure', ms: 30000, machine, at: 1795000060000 });
  const ev = evidenceOf(s, 'p1', { ctx: { session: 'c-1' } });
  const x1 = ev.items.find((x) => x.id === 'x1');
  assert.equal(x1.tagFit, 'exact');
  assert.ok(x1.tags.includes('w1') && x1.tags.includes('opt'));
});
