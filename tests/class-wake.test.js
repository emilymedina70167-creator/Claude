// 叫醒主讲的门铃（wake.js）：什么时候按、写什么、连按只算一次
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wakeWorthy, wakeText, wakeDue, WAKE_GAP } from '../kit/src/class/wake.js';

test('打字、附图、交作答、叫主讲才按门铃；拖一拖不按', () => {
  assert.equal(wakeWorthy({ texts: 1 }), true);
  assert.equal(wakeWorthy({ images: 2 }), true);
  assert.equal(wakeWorthy({ now: true }), true);
  assert.equal(wakeWorthy({ call: true }), true);
  assert.equal(wakeWorthy({}), false);
});

test('门铃只指路：课号、原因、读哪里', () => {
  const t = wakeText({ session: 'c-20261122-1', why: '学生交了作答', at: Date.UTC(2026, 10, 22, 12, 0, 0) });
  assert.match(t, /c-20261122-1/);
  assert.match(t, /学生交了作答/);
  assert.match(t, /sessions\/c-20261122-1\/meta\/since/);
  assert.ok(Buffer.byteLength(t) < 4096);
});

test('连着按只算一次', () => {
  assert.equal(wakeDue(0, 1000), true);
  assert.equal(wakeDue(1000, 1000 + WAKE_GAP - 1), false);
  assert.equal(wakeDue(1000, 1000 + WAKE_GAP), true);
});
