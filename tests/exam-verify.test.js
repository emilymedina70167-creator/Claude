// 验算真题的答案（kit/src/exam/verify.js）：精确计算、引擎函数
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyQuestion, normAnswer, applyVerify } from '../kit/src/exam/verify.js';

const refs = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2];

test('填空题：引擎函数算出来和答案一样 → engine、对上了', () => {
  const q = { id: 'Q-408-2019-26', type: 'fill', answer: '9', check: { expr: 'faults(r, 3, lru)', vars: { r: refs } } };
  assert.deepEqual(verifyQuestion(q), { how: 'engine', ok: true, got: '9', why: '' });
  const bad = verifyQuestion({ ...q, answer: '8' });
  assert.equal(bad.ok, false);
  assert.equal(bad.got, '9');
});

test('序列答案：空格、逗号、全角都当一样', () => {
  const q = { id: 'Q', type: 'fill', answer: '7，0，1，2，3，0，4', check: { expr: 'list(victims(r, 3, fifo))', vars: { r: refs } } };
  assert.equal(verifyQuestion(q).ok, true);
  assert.equal(normAnswer(' A, b，C '), 'a b c');
});

test('单选题：算出来的和正确选项的文字比；没用引擎函数的是 exact', () => {
  const q = { id: 'Q', type: 'single', answer: 'B', options: { A: '512', B: '1024', C: '2048', D: '4096' }, check: { expr: '2^10' } };
  assert.deepEqual(verifyQuestion(q), { how: 'exact', ok: true, got: '1024', why: '' });
  assert.equal(verifyQuestion({ ...q, answer: 'C' }).ok, false);
});

test('算不出来：none，写原因；没写 check：book', () => {
  const r = verifyQuestion({ id: 'Q', type: 'fill', answer: '1', check: { expr: '1/0' } });
  assert.equal(r.how, 'none');
  assert.equal(r.ok, null);
  assert.match(r.why, /除以 0/);
  assert.deepEqual(verifyQuestion({ id: 'Q', type: 'fill', answer: '1' }), { how: 'book', ok: null, got: '', why: '' });
});

test('applyVerify：换上 verified，对不上的列出来', () => {
  const qs = [
    { id: 'Q1', type: 'fill', answer: '9', check: { expr: 'faults(r, 3, lru)', vars: { r: refs } }, verified: { how: 'book' } },
    { id: 'Q2', type: 'fill', answer: '3', check: { expr: '1 + 1' }, verified: { how: 'book' } },
    { id: 'Q3', type: 'comp', answer: '', verified: { how: 'book' } },
  ];
  const r = applyVerify(qs);
  assert.deepEqual(r.questions[0].verified, { how: 'engine', ok: true });
  assert.deepEqual(r.questions[1].verified, { how: 'exact', ok: false, got: '2' });
  assert.deepEqual(r.questions[2].verified, { how: 'book' });
  assert.deepEqual(r.mismatched, [{ id: 'Q2', got: '2', answer: '3' }]);
  assert.equal(qs[0].verified.how, 'book', '不改原来的');
});
