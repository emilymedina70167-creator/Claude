// 第十一轮 A2：删课不删我说的话（purge.js 的 keepWords）；体检不把正在删的课的证据当孤儿、只清不是我说的话的孤儿（health.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purgePlan } from '../kit/src/memory/purge.js';
import { healthCheck } from '../kit/src/memory/health.js';

const SID = 'c-20261114-1';
const mem = {
  sessions: [{ id: SID, kind: 'stage', status: 'open', date: '2026-11-14' }],
  evidence: [
    { id: 'ev-s', session: SID, src: 'say', text: '只做2-3句就行啊', at: 1 },
    { id: 'ev-r', session: SID, src: 'record', comp: 'S1', ok: true, at: 2 },
  ],
  asks: [{ id: 'A-1', text: '开场复习两三句', quotes: [{ ev: 'ev-s', at: 1, session: SID, text: '只做2-3句就行啊' }], status: 'active', since: '2026-11-14' }],
};

test('keepWords 时我说的话留着、作答照删；要求不在删的里面', () => {
  const p = purgePlan(mem, SID, { keepWords: true });
  assert.ok(p.docs.includes('evidence/ev-r'));
  assert.ok(!p.docs.includes('evidence/ev-s'));
  assert.ok(p.kept.some((k) => k.path === 'evidence/ev-s'));
  assert.ok(!p.docs.some((d) => d.startsWith('asks/')));
  // 不 keepWords：照旧全删（话的账过完了，原话已经抄进要求）
  assert.ok(purgePlan(mem, SID).docs.includes('evidence/ev-s'));
});

test('体检：正在删的课的证据不报孤儿；真孤儿里我说的话不清、别的交给页面清', () => {
  const evidence = [
    { id: 'ev-a', session: 'c-gone', src: 'record', at: 1 },
    { id: 'ev-b', session: 'c-gone', src: 'say', text: '别重叠', at: 2 },
    { id: 'ev-c', session: 'c-deleting', src: 'record', at: 3 },
  ];
  const r = healthCheck({ sessions: [], evidence }, { today: '2026-11-14', purging: new Set(['c-deleting']) });
  assert.deepEqual(r.orphans, ['ev-a']);
  assert.ok(r.notes.some((n) => n.msg.includes('c-gone')));
  assert.ok(!r.notes.some((n) => n.msg.includes('c-deleting')));
});

test('终审 5：keepWords 时这节课的账和每一轮也留着（下次过账要知道哪几句过过了、我当时在回应什么）', () => {
  const p = purgePlan(mem, SID, { keepWords: true });
  assert.ok(!p.scoped.includes('said'));
  assert.ok(!p.scoped.includes('class_turns'));
  assert.ok(purgePlan(mem, SID).scoped.includes('said'));
});

test('终审：体检只清旧的孤儿（另一台设备上新开的课，证据可能比课先到）', () => {
  const now = 10 * 3600 * 1000;
  const evidence = [{ id: 'ev-old', session: 'c-gone', src: 'record', at: now - 3600 * 1000 }, { id: 'ev-new', session: 'c-new', src: 'record', at: now - 60 * 1000 }];
  const r = healthCheck({ sessions: [], evidence }, { today: '2026-11-14', now });
  assert.deepEqual(r.orphans, ['ev-old']);
});
