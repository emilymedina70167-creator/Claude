// 板上的记忆点（board recall 包成的 recalldue 组件）：组件里的几行怎么读
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecallDue } from '../kit/src/memory/recall.js';

test('n 默认 10，space 不写是空（课堂用这节课的科）', () => {
  assert.deepEqual(parseRecallDue('id: b9'), { n: 10, space: '' });
  assert.deepEqual(parseRecallDue('id: b9\nn: 3\nspace: en'), { n: 3, space: 'en' });
});
test('写错的照实报', () => {
  assert.match(parseRecallDue('n: 0').error, /1 到 20/);
  assert.match(parseRecallDue('space: 政治').error, /math、cs、en/);
  assert.match(parseRecallDue('foo: 1').error, /不认识「foo」/);
});
