// 循环队列（engines/cqueue.js）：和王道 3.2 的例子对答案；常见错法各查一个
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cqueueEngine as E } from '../kit/src/engines/cqueue.js';
import { checkAsk, misreadAnswer, misreadFill } from '../kit/src/stepperspec.js';

const go = (f) => { const input = E.parse(f); return { input, r: E.run(input) }; };
const vruns = (input) => E.variants(input).map((v) => ({ label: v.label, input: v.input, run: E.run(v.input) }));
const askOf = (r, re) => r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).find((a) => a && re.test(a.q));
function askDiag(input, ask, given) {
  if (checkAsk(ask, given).ok) return '';
  return vruns(input).find((v) => { const a = v.run.steps.flatMap((x) => [x.ask, ...(x.asks || [])]).find((y) => y && y.q === ask.q && y.kind === ask.kind); return a && checkAsk(a, given).ok; })?.label || '';
}
const pick = (input, re) => { const v = E.variants(input).find((x) => re.test(x.label)); assert.ok(v, `没有「${re}」这种错法：${E.variants(input).map((x) => x.label).join('；')}`); return v; };
const OPS = 'enqueue a b c d e, dequeue 2, enqueue f g h';

test('王道习题：A[0..5]，rear = 0、front = 3，删一个再加两个 → rear = 2、front = 4', () => {
  const { input, r } = go({ size: '6', front: '3', rear: '0', ops: 'dequeue, enqueue x y' });
  assert.deepEqual(r.final, { front: 4, rear: 2, len: 4 });
  assert.equal(E.quiz(input, r).answer, '4 2 4');
});

test('牺牲一个单元：MaxSize = 6 最多放 5 个，h 入队时 (rear + 1) % 6 == front，队满', () => {
  const { input, r } = go({ size: '6', ops: OPS });
  assert.deepEqual(r.final, { front: 2, rear: 1, len: 5 });
  assert.equal(askOf(r, /第 10 步要让 h 入队/).answer, '满了，入队失败');
  assert.equal(askOf(r, /第 8 步（f 入队）以后，rear/).answer, 0, 'rear 从 5 绕回 0');
  // 填表：f 入队以后 front 2、rear 0、长度 (0 − 2 + 6) % 6 = 4
  assert.deepEqual(E.table(input, r).rows[7].cells.map((c) => c.v), ['2', '0', '4']);
  // 增设 size / tag：6 个单元都能用，h 也进得去
  assert.deepEqual(go({ size: '6', ops: OPS, full: 'count' }).r.final, { front: 2, rear: 2, len: 6 });
  assert.deepEqual(go({ size: '6', ops: OPS, full: 'tag' }).r.final, { front: 2, rear: 2, len: 6 });
  assert.throws(() => E.parse({ size: '6', ops: 'push a' }), /看不懂/);
});

test('循环队列的错法：队长公式没加 MaxSize、把 rear == front 当队满、指针没取模、增设 size 还空一格', () => {
  const { input, r } = go({ size: '6', ops: OPS });
  // f 入队以后 rear = 0、front = 2：(0 − 2) % 6 在 C 里是 −2
  assert.equal(askDiag(input, askOf(r, /第 8 步（f 入队）以后，队列长度/), '-2'), pick(input, /队长公式/).label);
  assert.equal(askDiag(input, askOf(r, /第 10 步要让 h 入队/), '没满，能入队'), pick(input, /rear == front/).label);
  assert.equal(askDiag(input, askOf(r, /第 8 步（f 入队）以后，rear/), '6'), pick(input, /没对 MaxSize 取模/).label);
  assert.equal(askDiag(input, askOf(r, /第 8 步（f 入队）以后，rear/), '0'), '', '答对了不诊断');
  const c = go({ size: '6', ops: OPS, full: 'count' });
  const spare = pick(c.input, /牺牲一个单元/);
  assert.equal(askDiag(c.input, askOf(c.r, /第 10 步要让 h 入队/), '满了，入队失败'), spare.label);
  // quiz、填表：整个过程都按「牺牲一个单元」做
  assert.equal(misreadAnswer('2 1 5', vruns(c.input).map((v) => ({ label: v.label, answer: E.quiz(v.input, v.run).answer }))), spare.label);
  const values = E.table(spare.input, E.run(spare.input)).rows.map((row) => row.cells.map((x) => x.v));
  assert.equal(misreadFill(E.table(c.input, c.r), values, vruns(c.input).map((v) => ({ label: v.label, table: E.table(v.input, v.run) }))), spare.label);
});
