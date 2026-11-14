// FSRS-5 的遗忘曲线和稳定度更新（spec 6.2 的 R）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { W, retrievability, firstState, review, memoryOf, rOn } from '../kit/src/forecast/fsrs.js';

test('隔 S 天还记得九成；负的天数当 0', () => {
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
  assert.equal(retrievability(-3, 5), 1);
  assert.ok(retrievability(30, 5) < retrievability(10, 5));
});

test('第一次学 Good 的稳定度是 W[2]=3.173，Again 是 W[0]', () => {
  assert.equal(W.length, 19);
  assert.equal(firstState(true).S, 3.173);
  assert.equal(firstState(false).S, 0.40255);
});

test('隔几天做对稳定度涨、做错掉，掉了不超过原来、难度变大', () => {
  const s0 = firstState(true);
  assert.ok(review(s0, true, 4).S > s0.S);
  const f = review(s0, false, 4);
  assert.ok(f.S <= s0.S && f.S > 0);
  assert.ok(f.D > s0.D);
  const d = review({ S: 3, D: 9.99 }, false, 1).D;
  assert.ok(d <= 10 && d >= 1);
});

test('memoryOf 照日期走；没有复习返回 null；rOn 用倍数', () => {
  assert.equal(memoryOf([]), null);
  const m = memoryOf([{ day: '2026-11-05', ok: true }, { day: '2026-11-01', ok: true }]);
  assert.equal(m.last, '2026-11-05');
  assert.ok(m.S > 3.173);
  assert.ok(rOn(m, '2026-12-05', { x: 3 }) > rOn(m, '2026-12-05', { x: 1 }));
  assert.equal(rOn(null, '2027-12-21'), 1);
  assert.equal(rOn(m, '2026-10-01'), 1, '早于最后一次复习的那天当 0 天');
});

test('第一次学的那一节一律按学过起步：当堂做错是还没会（K 管），不是忘了（R 管）', () => {
  assert.equal(memoryOf([{ day: '2026-11-01', ok: false }]).S, 3.173);
  const lapse = memoryOf([{ day: '2026-11-01', ok: true }, { day: '2026-11-05', ok: false }]);
  assert.ok(lapse.S < 3.173, '第二节起做错才算忘了');
});
