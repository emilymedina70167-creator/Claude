// 第十一轮 A1：「我的要求」asks 一类（docs/superpowers/specs/2026-11-14-round11-design.md 6.1）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, canWrite } from '../kit/src/memory/schema.js';
import { validateWrite } from '../kit/src/memory/writer.js';
import { checkMemory } from '../kit/src/memory/check.js';
import { AUTHORS } from '../kit/src/memory/guard.js';
import { nextAskId } from '../kit/src/memory/said.js';

const ask = { text: '开场复习最多两三句', quotes: [{ ev: 'ev-1', at: 1, session: 'c-1', text: '只做2-3句就行啊' }], status: 'active', since: '2026-11-14', scope: 'all', checks: [], broken: 0 };

test('asks 是状态类、页面和课堂能写', () => {
  assert.equal(COLLECTIONS.asks.kind, 'state');
  assert.equal(canWrite('class', 'asks'), true);
  assert.equal(canWrite('page', 'asks'), true);
});

test('一条要求过格式检查', () => {
  assert.deepEqual(validateWrite('asks/A-1', ask), []);
  assert.equal(validateWrite('asks/A-1', { ...ask, status: 'done' }).length, 1);
  const { quotes: _q, ...noQuotes } = ask;
  assert.ok(validateWrite('asks/A-1', noQuotes).some((m) => m.includes('quotes')));
  assert.equal(validateWrite('asks/X-1', ask).length, 1);
});

test('关于我能并进要求', () => {
  const r = checkMemory({ asks: [{ id: 'A-1', ...ask }], profile: [{ id: 'p-newfirst', topic: '偏好', text: '开场复习两三句', status: 'merged', into: 'A-1' }] }, { today: '2026-11-14' });
  assert.ok(!r.problems.some((p) => p.coll === 'profile' && p.msg.includes('into')), JSON.stringify(r.problems));
});

test('作者 said 对不上直接不收', () => {
  assert.equal(AUTHORS.said.strict, 'drop');
});

test('nextAskId 接着已有的编号', () => {
  assert.equal(nextAskId([]), 'A-1');
  assert.equal(nextAskId([{ id: 'A-1' }, { id: 'A-3' }]), 'A-4');
});
