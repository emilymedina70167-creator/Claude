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
