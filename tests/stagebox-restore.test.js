// dr-trail-fix 3：board stage 刷新前的样子——存哪一份、指纹、文档 id（纯函数，stageboxspec.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptSig, logDoc, docId } from '../kit/src/stageboxspec.js';

test('指纹：段改过就对不上', () => {
  assert.equal(scriptSig('s2', 'tex e = "(A+B)^2"\nopen e expand'), scriptSig('s2', 'tex e = "(A+B)^2"\nopen e expand\n'));
  assert.notEqual(scriptSig('s2', 'tex e = "(A+B)^2"'), scriptSig('s2', 'tex e = "(A-B)^2"'));
  assert.notEqual(scriptSig('s2', 'x'), scriptSig('s3', 'x'));
});

test('只存学生动过的；行只留 src、by、open、pre', () => {
  assert.equal(logDoc([{ src: 'tex e = "x"', by: 'teacher', turn: 1 }], { sig: 'a' }), null);
  const d = logDoc([{ src: 'tex e = "x"', by: 'teacher', turn: 1 }, { src: 'expand e t1', by: 'student', open: 'expand', turn: 2 }, { src: 'say "对"', by: 'page', pre: true }], { sig: 'a', ask: 'ask next "好了"' });
  assert.deepEqual(d, { sig: 'a', rows: [{ src: 'tex e = "x"', by: 'teacher' }, { src: 'expand e t1', by: 'student', open: 'expand' }, { src: 'say "对"', by: 'page', pre: true }], ask: 'ask next "好了"' });
  assert.equal(docId('s 1/#x'), 's_1__x');
});
