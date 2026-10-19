// 步进器的公共写法（stepperspec.js）和排序引擎（engines/sort.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonSpec, parseAskField, resolveAsks, checkAsk, askAnswerText, stepLabel } from '../kit/src/stepperspec.js';
import { parse, run, quiz, problems, view, ALGOS } from '../kit/src/engines/sort.js';

const ARR = "49 38 65 97 76 13 27 49'";
const go = (algo, array = ARR) => run(parse({ algo, array }));

test('公共字段：mode、speed、start、ask 的写法和报错', () => {
  assert.deepEqual(commonSpec({}), { mode: 'demo', ask: null, speed: 1.2, start: 0, auto: false });
  const c = commonSpec({ mode: 'quiz', speed: '0.8s', start: 'end', auto: 'true', ask: 'pass, 3' });
  assert.equal(c.mode, 'quiz');
  assert.equal(c.speed, 0.8);
  assert.equal(c.start, 'end');
  assert.equal(c.auto, true);
  assert.deepEqual(c.ask, { all: false, tags: ['pass'], nums: [3] });
  assert.throws(() => commonSpec({ mode: 'play' }), /demo/);
  assert.throws(() => commonSpec({ speed: '50' }), /speed/);
  assert.throws(() => commonSpec({ start: '-1' }), /start/);
  assert.equal(parseAskField('不问'), null);
  assert.deepEqual(parseAskField('all'), { all: true, tags: [], nums: [] });
});

test('挑要问的步：种类、步号、all；不认识的种类、没问题可问的步号都报出来', () => {
  const steps = [{}, { ask: { tag: 'pass' } }, {}, { ask: { tag: 'swap' } }, { ask: { tag: 'pass' } }];
  assert.deepEqual([...resolveAsks(parseAskField('pass'), steps).asks], [1, 4]);
  assert.deepEqual([...resolveAsks(parseAskField('all'), steps).asks].sort(), [1, 3, 4]);
  let r = resolveAsks(parseAskField('3'), steps);
  assert.deepEqual([...r.asks], [3]);
  r = resolveAsks(parseAskField('visit, 2, 9'), steps);
  assert.equal(r.errors.length, 3);
  assert.match(r.errors[0], /没有「visit」这种问题（这个演示能问的：pass、swap）/);
  assert.match(r.errors[1], /第 2 步没有可以问的（能问的步：1、3、4）/);
  assert.match(r.errors[2], /没有第 9 步（一共 4 步）/);
  assert.equal(resolveAsks(null, steps).asks.size, 0);
});

test('判一次猜测：点一个、点几个（不管顺序）、选项、写序列', () => {
  assert.ok(checkAsk({ kind: 'pick', answer: '3' }, '3').ok);
  assert.ok(!checkAsk({ kind: 'pick', answer: '3' }, '4').ok);
  assert.ok(checkAsk({ kind: 'pick', alts: ['B', 'C'] }, 'c').ok, '几个都对、大小写不管');
  assert.ok(checkAsk({ kind: 'pick', count: 2, answer: ['2', '5'] }, ['5', '2']).ok);
  assert.ok(!checkAsk({ kind: 'pick', count: 2, answer: ['2', '5'] }, ['5']).ok);
  assert.ok(checkAsk({ kind: 'choice', answer: '交换' }, '交换').ok);
  const t = checkAsk({ kind: 'text', answer: '1 2 3' }, '1 3 2');
  assert.equal(t.ok, false);
  assert.match(t.msg, /前 1 个是对的/);
  assert.equal(askAnswerText({ kind: 'text', answer: '1 2 3 | 1 3 2' }), '1 2 3');
  assert.equal(askAnswerText({ kind: 'pick', count: 2, answer: ['2', '5'] }), '2、5');
  assert.equal(stepLabel(0, 9), '开始');
  assert.equal(stepLabel(3, 9), '第 3 / 9 步');
});

test('排序引擎：几种算法的结果、每一趟（和王道的例子对得上）', () => {
  const sorted = '13 27 38 49 49 65 76 97';
  for (const a of Object.keys(ALGOS)) assert.equal(go(a).passes.at(-1).join(' '), sorted, a);
  assert.equal(go('insert').passes[0].join(' '), '38 49 65 97 76 13 27 49');
  assert.equal(go('bubble').passes[0].join(' '), '13 49 38 65 97 76 27 49', '王道冒泡：从后往前，最小的冒到最前');
  assert.equal(go('select').passes[0].join(' '), '13 38 65 97 76 49 27 49');
  assert.equal(go('quick').passes[0].join(' '), '27 38 13 49 76 97 65 49', '王道快排第一次划分');
  assert.equal(go('merge').passes[0].join(' '), '38 49 65 97 13 76 27 49');
  assert.equal(go('radix').passes[0].join(' '), '13 65 76 97 27 38 49 49');
  // 冒泡一趟没交换就提前结束
  assert.equal(go('bubble', '1 2 3 5 4').passes.length, 2);
});

test('排序引擎：稳定性看得出来（带 \' 的 49 走到哪了）', () => {
  const where = (algo, array = ARR, v = 49) => { const r = go(algo, array); const A = r.steps.at(-1).view.A; return A.findIndex((x) => x.mark) - A.findIndex((x) => x.v === v && !x.mark); };
  assert.ok(where('insert') > 0, '插入稳定');
  assert.ok(where('bubble') > 0, '冒泡稳定');
  assert.ok(where('merge') > 0, '归并稳定');
  assert.ok(where('radix') > 0, '基数稳定');
  assert.ok(where('select', "2 2' 1", 2) < 0, '选择不稳定：2 2\' 1 → 1 2\' 2');
  assert.ok(where('quick', "2 2' 1", 2) < 0, '快排不稳定');
});

test('排序引擎：先猜的问题和真实结果一致；每一步都画得出来', () => {
  for (const a of Object.keys(ALGOS)) {
    const r = go(a);
    const passAsks = r.steps.filter((s) => s.ask && ['pass', 'partition'].includes(s.ask.tag)).map((s) => s.ask.answer);
    assert.deepEqual(passAsks, r.passes.map((p) => p.join(' ')), a);
    const input = parse({ algo: a, array: ARR });
    for (const s of r.steps) assert.match(view(s.view, input), /class="sv-arr"/);
  }
  // 快排「枢轴落在第几个」和那一步画出来的位置一致
  const q = go('quick');
  for (const s of q.steps.filter((x) => x.ask?.tag === 'pivot')) assert.match(s.view.cls[s.ask.answer], /sv-placed/);
  // 插入排序「插在第几个」
  const ins = go('insert');
  for (const s of ins.steps.filter((x) => x.ask?.tag === 'place')) assert.match(s.view.cls[s.ask.answer], /sv-placed/);
});

test('排序引擎：quiz 出第几趟、写法错误和提醒', () => {
  const input = parse({ algo: 'quick', array: ARR, pass: '2' });
  const r = run(input);
  const qz = quiz(input, r);
  assert.match(qz.q, /第 2 次划分/);
  assert.equal(qz.answer, r.passes[1].join(' '));
  assert.equal(qz.type, 'seq');
  assert.throws(() => parse({ array: ARR }), /algo/);
  assert.throws(() => parse({ algo: 'heap', array: ARR }), /不认识「heap」/);
  assert.throws(() => parse({ algo: 'radix', array: '3 -1 2' }), /非负整数/);
  assert.throws(() => parse({ algo: '快排' }), /array/);
  assert.deepEqual(problems(parse({ algo: 'insert', array: '1 2 3' }), go('insert', '1 2 3')).length, 1);
});

test('课堂 Claude 看到的：演示里先猜的作答、走到第几步', async () => {
  const { actionText } = await import('../kit/src/class/prompt.js');
  assert.equal(
    actionText({ source: 'record', type: 'stepper', engine: 'sort', step: 'b2', block: 's-2', title: '快排', q: '枢轴 49 最后落在第几个位置？', value: '2', pick: true, ok: false, attempts: 1, detail: '第 7 步', ms: 3000 }),
    '[作答] b2 里的 sort s-2「快排」：第 7 步，「枢轴 49 最后落在第几个位置？」在图上点了 2（错，第 1 次），用时 3 秒',
  );
  assert.match(actionText({ source: 'record', type: 'stepper', engine: 'sort', block: 's-2', final: true, giveup: true, expected: '4', detail: '第 7 步' }), /想不出来，直接看了（答案是 4）/);
  assert.match(actionText({ source: 'record', type: 'stepper', engine: 'sort', block: 's-2', value: '1 2 3', ok: true, attempts: 2, detail: '写出结果' }), /写出结果，写了 1 2 3（对，第 2 次）/);
  assert.equal(actionText({ source: 'event', type: 'drag', step: 'b2', block: 's-2', name: 'step', value: 6, beat: 22 }), '[动作] b2 里的演示 s-2：走到第 6 步（共 22 步）');
});

test('自己填表：逐格判、只指出第一处、mark 格、数、几种都对；错法诊断', async () => {
  const { checkFill, cellOk, normCell, cellName, misreadFill, misreadAnswer, fillOrder } = await import('../kit/src/stepperspec.js');
  const table = {
    dir: 'col', head: ['块 1', '块 2', '缺页'],
    rows: [
      { label: '7', cells: [{ v: '7' }, { v: '' }, { v: '√', mark: true }] },
      { label: '0', cells: [{ v: '7', given: true }, { v: '0' }, { v: '√', mark: true }] },
      { label: '7', cells: [{ v: '7' }, { v: '0' }, { v: '', mark: true }] },
    ],
  };
  assert.equal(fillOrder(table).length, 8);
  assert.equal(normCell(' ∞ '), '∞');
  assert.equal(normCell('inf'), '∞');
  assert.equal(normCell('—'), '');
  assert.ok(cellOk({ v: '2.5', num: true }, '5/2'));
  assert.ok(cellOk({ v: '7/3', num: true }, '2.33'));
  assert.ok(!cellOk({ v: '7/3', num: true }, '2.3'));
  assert.ok(cellOk({ v: ['A', 'B'] }, 'b'));
  let r = checkFill(table, [['7', '', '√'], ['', '0', '√'], ['7', '0', '']]);
  assert.ok(r.ok);
  r = checkFill(table, [['7', '', '√'], ['', '1', '√'], ['7', '0', '']]);
  assert.deepEqual(r.first, { r: 1, c: 1, empty: false });
  assert.equal(r.okCount, 3);
  r = checkFill(table, [['7', '', ''], ['', '0', '√']]);
  assert.equal(r.first.r, 0);
  assert.equal(r.first.c, 2);
  r = checkFill(table, [['7', '', '√'], ['', '', '']]);
  assert.ok(r.first.empty);
  assert.equal(cellName(table, 1, 1), '「0」那一列的「块 2」');
  // 错法诊断：错的格子和 FIFO 的表对得上
  const fifo = { rows: [{ cells: [{ v: '7' }, { v: '' }, { v: '√', mark: true }] }, { cells: [{ v: '7' }, { v: '1' }, { v: '√', mark: true }] }, { cells: [{ v: '7' }, { v: '0' }, { v: '', mark: true }] }] };
  assert.equal(misreadFill(table, [['7', '', '√'], ['', '1', '√'], ['7', '0', '']], [{ label: '像是按 FIFO 换的', table: fifo }]), '像是按 FIFO 换的');
  assert.equal(misreadFill(table, [['7', '', '√'], ['', '9', '√'], ['7', '0', '']], [{ label: 'x', table: fifo }]), '');
  assert.equal(misreadAnswer('A C B', [{ label: '像是先序', answer: 'A B C' }, { label: '像是后序', answer: 'A C B' }]), '像是后序');
  assert.equal(misreadAnswer('A,C,B', [{ label: '像是后序', answer: 'A C B | C A B' }]), '像是后序');
});

test('填表：一组格子不管先后（物理块）；页面置换的表和错法', async () => {
  const { checkFill, misreadFill, fillSpec } = await import('../kit/src/stepperspec.js');
  const { pagingEngine } = await import('../kit/src/engines/os.js');
  const input = pagingEngine.parse({ refs: '1 2 3 4 1 2 5 1 2 3 4 5', frames: '3', algo: 'fifo' });
  const r = pagingEngine.run(input);
  const t = pagingEngine.table(input, r);
  assert.equal(t.rows.length, 12);
  assert.equal(t.rows.filter((x) => x.cells[3].v === '√').length, 9);
  // 学生按「进入的先后」写（顺序和物理块不一样）也算对
  const vals = t.rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));
  vals[5] = [vals[5][2], vals[5][0], vals[5][1], vals[5][3], vals[5][4]];
  assert.ok(checkFill(t, vals).ok);
  // 第 4 列写成 LRU 的结果：报第 4 列的组；错法对得上 LRU
  const lru = pagingEngine.table({ ...input, algo: 'lru' }, pagingEngine.run({ ...input, algo: 'lru' }));
  const bad = lru.rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));
  const res = checkFill(t, bad);
  assert.ok(!res.ok);
  assert.equal(misreadFill(t, bad, [{ label: 'LRU', table: lru }]), 'LRU');
  // given: 3 前 3 列直接给出；cols 只填缺页
  const g = fillSpec(t, { given: '3', cols: '缺页' });
  assert.deepEqual(g.errors, []);
  assert.equal(g.table.rows[5].cells.filter((c) => !c.given).length, 1);
  assert.match(fillSpec(t, { cols: '块 9' }).errors[0], /没有「块 9」/);
  // 错法：没把一开始调入算成缺页
  const v = pagingEngine.variants(input).find((x) => /调入/.test(x.label));
  assert.equal(pagingEngine.quiz(v.input, pagingEngine.run(v.input), {}).answer, '6');
});

test('字段名的拼写检查：写了却没用上的字段报出来，像的给个建议', async () => {
  const { trackFields } = await import('../kit/src/stepperspec.js');
  const { sortEngine } = await import('../kit/src/engines/sort.js');
  const { parseFields } = await import('../kit/src/parse.js');
  const src = 'id: s1\ntitle: 快排\nalgo: quick\narray: 3 1 2\nspeeed: 2\ngiven: 1\nfoo: 1';
  const t = trackFields(parseFields(src).fields);
  const input = sortEngine.parse(t.fields, src);
  sortEngine.run(input);
  void t.fields.speed; void t.fields.mode; // 外壳读的
  const msgs = t.unknown();
  assert.equal(msgs.length, 3);
  assert.match(msgs[0], /「speeed:」.*是不是 speed:/);
  assert.match(msgs[1], /「given:」.*只在 mode: fill 时有用/);
  assert.match(msgs[2], /「foo:」.*这个组件没有这个字段/);
});

test('错法诊断按题型判：先猜里分数对小数、quiz 里十六进制的各种写法、填表下面单独的格子', async () => {
  const { checkAsk, misreadFill, fillSpec } = await import('../kit/src/stepperspec.js');
  // 外壳先猜时：用错法那一问自己的判法（checkAsk）判学生写的
  const a = { tag: 'aslfail', kind: 'number', q: 'ASL失败是多少？', answer: 25 / 13, display: '25/13' };
  assert.ok(checkAsk(a, '25/13').ok);
  assert.ok(checkAsk(a, '1.92').ok);
  // 填表：只错在表下面 extra 的那一格，也认得出
  const table = { dir: 'row', head: ['x'], rows: [{ label: 'a', cells: [{ v: '1', num: true }] }], extra: [{ label: 'D', v: '48', num: true }] };
  const wrongT = { ...table, extra: [{ label: 'D', v: '8', num: true }] };
  const t = fillSpec(table, {}).table;
  assert.equal(misreadFill(t, Object.assign([['1']], { extra: ['8'] }), [{ label: '系数没跟着变', table: fillSpec(wrongT, {}).table }]), '系数没跟着变');
  assert.equal(misreadFill(t, Object.assign([['1']], { extra: ['7'] }), [{ label: '系数没跟着变', table: fillSpec(wrongT, {}).table }]), '');
});

test('组件字段里的 \\calc{…}：换成 let 量的精确值（矩阵、分数）；题面不换；算不出来报出来', async () => {
  const { calcFields } = await import('../kit/src/stepperspec.js');
  const { toExact } = await import('../kit/src/exact.js');
  const scope = { A: toExact([[1, 2], [3, 4]]), b: toExact([1, 0.5]), k: toExact(3) };
  const r = calcFields({ matrix: '\\calc{A}', b: '\\calc{b}', key: '\\calc{k + 1}', q: '求 $\\calc{A}$ 的逆', title: '\\calc{k}' }, scope);
  assert.equal(r.fields.matrix, '[[1, 2], [3, 4]]');
  assert.equal(r.fields.b, '[1, 1/2]');
  assert.equal(r.fields.key, '4');
  assert.equal(r.fields.q, '求 $\\calc{A}$ 的逆');
  assert.equal(r.fields.title, '\\calc{k}');
  assert.deepEqual(r.errors, []);
  assert.match(calcFields({ matrix: '\\calc{Z}' }, scope).errors[0], /matrix: 里的 \\calc\{Z\} 算不出来：未定义的变量 Z/);
  // 换出来的矩阵 elim 直接能用
  const { elimEngine } = await import('../kit/src/engines/elim.js');
  const run = elimEngine.run(elimEngine.parse({ matrix: r.fields.matrix, inverse: 'true' }));
  assert.ok(run.X);
});
