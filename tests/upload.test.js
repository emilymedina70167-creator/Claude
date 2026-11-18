// 截图入口能关（需求 R11）：组件的 upload: 和整节课的 board set upload=
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeUploadField, uploadAllowed } from '../kit/src/upload.js';
import { parseCommand } from '../kit/src/class/protocol.js';

test('组件的 upload: 拿出来、别的行原样', () => {
  assert.deepEqual(takeUploadField('id: q1\nupload: on\nq: 1+1'), { upload: 'on', body: 'id: q1\nq: 1+1' });
  assert.deepEqual(takeUploadField('id: q1\nupload：关'), { upload: 'off', body: 'id: q1' });
  assert.deepEqual(takeUploadField('id: q1\nq: upload: off 不是一行'), { upload: '', body: 'id: q1\nq: upload: off 不是一行' });
});

test('组件写了听组件，没写听整节课', () => {
  const node = (v) => ({ closest: () => (v ? { dataset: { upload: v } } : null) });
  assert.equal(uploadAllowed(node(''), undefined), true);
  assert.equal(uploadAllowed(node(''), false), false);
  assert.equal(uploadAllowed(node('on'), false), true);
  assert.equal(uploadAllowed(node('off'), true), false);
  assert.equal(uploadAllowed(null, false), false);
});

test('board set upload=', () => {
  assert.deepEqual(parseCommand('set upload=on'), { op: 'set', values: { upload: 'on' } });
  assert.match(parseCommand('set upload=maybe').error, /on \/ off/);
  assert.match(parseCommand('set color=red').error, /没有「color」/);
  assert.match(parseCommand('set').error, /名字=值/);
});
