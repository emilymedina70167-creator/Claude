import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWidget, widgetProblems, compareOrder } from '../kit/src/widgetspec.js';

test('读 widget：字段和代码', () => {
  assert.deepEqual(parseWidget('id: w1\ntitle: 拖\n---\nla.say("x")'), { id: 'w1', title: '拖', code: 'la.say("x")' });
  assert.deepEqual(parseWidget('la.say(1)'), { id: '', title: '', code: 'la.say(1)' });
  assert.match(parseWidget('id: w\n---\n').error, /没写代码/);
  assert.match(parseWidget('foo\n---\nx').error, /看不懂/);
});

test('JS 语法错报出来', () => {
  assert.deepEqual(widgetProblems('la.say(1)'), []);
  assert.match(widgetProblems('la.say((')[0], /JS 写错了/);
});

test('比顺序', () => {
  assert.deepEqual(compareOrder(['a', 'c', 'b'], ['a', 'b', 'c']), { ok: false, right: 1, n: 3, first: 1 });
  assert.equal(compareOrder(['a'], ['a']).ok, true);
});
