// 第十一轮 A1：我打的话存成证据时带上第几轮（话的账按它找前后老师说了什么、守卫按它核轮次）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sayEvidence } from '../kit/src/memory/session.js';

test('sayEvidence 带轮次', () => {
  assert.equal(sayEvidence('别重叠', { session: 'c-1', block: 'EN-L1', turn: 12 }).turn, 12);
  assert.equal('turn' in sayEvidence('别重叠', { session: 'c-1', block: 'EN-L1' }), false);
});
