// 第十五轮：外部主 Claude 开的课 kind: ext；它写的数据、记忆的 log 用身份 ext
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, isTeach, SESSION_KINDS } from '../kit/src/memory/session.js';
import { ROLES } from '../kit/src/memory/schema.js';
import { validateWrite } from '../kit/src/memory/writer.js';
import { oldKind } from '../kit/src/memory/oldview.js';

test('kind: ext 是外部的课，是上课的一种，不是旧课', () => {
  assert.equal(kindOf({ kind: 'ext' }), 'ext');
  assert.ok(SESSION_KINDS.ext);
  assert.equal(isTeach({ kind: 'ext' }), true);
  assert.equal(oldKind({ kind: 'ext' }), false);
});

test('写入身份 ext：sessions、观察、改动单、log 都认', () => {
  assert.ok(ROLES.includes('ext'));
  assert.deepEqual(validateWrite('sessions/c-20261118-1', { date: '2026-11-18', kind: 'ext', status: 'open' }), []);
  assert.ok(!validateWrite('observations/o-x', { kind: 'note', by: 'ext', date: '2026-11-18', text: 'x' }).some((p) => /by/.test(p)));
  assert.ok(!validateWrite('pending/pd-x', { kind: 'note', by: 'ext', status: 'done', op: 'add', tier: 'direct' }).some((p) => /\bby\b/.test(p)));
});
