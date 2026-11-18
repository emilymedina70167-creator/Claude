// 每道题在学生屏幕上的时间（dr-batch4 第 3、4 条，timing.js 纯的那一半）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimer } from '../kit/src/timing.js';
import { stuckDue } from '../kit/src/class/react.js';

test('只算在屏幕上的时间；ms 到第一次交、msTotal 到这一次', () => {
  let t = 0;
  const tm = createTimer({ now: () => t });
  assert.equal(tm.submit('q1'), null); // 从没在屏幕上
  tm.set('q1', true, 1000);
  tm.set('q1', false, 4000); // 翻到别的板
  tm.set('q1', true, 10000);
  t = 12000;
  assert.deepEqual(tm.submit('q1', 12000), { ms: 5000, msTotal: 5000 });
  tm.hideAll(13000); // 锁屏
  tm.set('q1', true, 20000);
  assert.deepEqual(tm.submit('q1', 21000), { ms: 5000, msTotal: 7000 });
  assert.equal(tm.visibleMs('q1', 11000, 21000), 3000);
  // 刷新以后：以前交过的第一次放回去
  const tm2 = createTimer({ now: () => 50000 });
  tm2.seedFirst('q1', 30000);
  tm2.set('q1', true, 40000);
  assert.deepEqual(tm2.submit('q1', 45000), { ms: 0, msTotal: 5000 });
});

test('stuck 按屏幕上的时间（学生不在那块板上不计）', () => {
  const rule = { cases: [{ kind: 'stuck', after: 60000, used: false }] };
  assert.equal(stuckDue(rule, { now: 200000, touched: 0, armed: 0 }), 0);
  assert.equal(stuckDue(rule, { now: 200000, touched: 0, armed: 0, quietMs: 20000 }), -1);
  assert.equal(stuckDue(rule, { quietMs: 61000 }), 0);
});
