// 组件写 exam: / like:（考情第 4 批 4.1，题库的真题第 2 批就要）：渲染时拿掉这两行、挂在组件外面，作答记录带上
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeExamFields, examOfRecord } from '../kit/src/exam/fields.js';

test('拿掉 exam: / like: 两行，别的原样', () => {
  const r = takeExamFields('exam: Q-408-2019-23\nq: 题\n- [x] a\nlike：Q-408-2019-24');
  assert.equal(r.exam, 'Q-408-2019-23');
  assert.equal(r.like, 'Q-408-2019-24');
  assert.equal(r.body, 'q: 题\n- [x] a');
  assert.deepEqual(takeExamFields('q: 没有\nanswer: 2'), { exam: '', like: '', body: 'q: 没有\nanswer: 2' });
  assert.equal(takeExamFields('exam: 乱写的\nq: x').exam, '', '不像题号的不收');
});

test('作答记录：从组件外面那一层取题号', () => {
  const el = { closest: (sel) => (sel === '[data-exam]' ? { dataset: { exam: 'Q-408-2019-23' } } : sel === '[data-like]' ? null : null) };
  assert.deepEqual(examOfRecord(el), { exam: 'Q-408-2019-23' });
  assert.deepEqual(examOfRecord(null), {});
});
