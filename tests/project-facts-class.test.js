// 从入口链接直接进课（不经过首页）时也写 meta/facts：算法和首页同一份，记忆没读全不写
import test from 'node:test';
import assert from 'node:assert/strict';
import { classFacts, FACTS_NEED } from '../kit/src/project/factsclass.js';

test('记忆没读全不写', () => {
  assert.equal(classFacts({ mem: { reviews: [], recall: [] }, loaded: new Set(['reviews', 'recall']), probes: [], today: '2026-11-28', prev: null }), null);
  assert.equal(classFacts({ mem: {}, loaded: new Set(FACTS_NEED), probes: null, today: '2026-11-28', prev: null }), null, '题库还没读到');
  assert.equal(classFacts({ mem: {}, loaded: new Set(FACTS_NEED), probes: [], today: '', prev: null }), null, '没有今天');
});

test('读全了照首页的算法算，体检和后台活沿用上一份', () => {
  const mem = { reviews: [], sessions: [], absorb: [], recall: [{ id: 'K1', q: 'q', a: 'a', space: 'en', tier: 1, last: '2026-11-26' }] };
  const f = classFacts({ mem, loaded: new Set(FACTS_NEED), probes: [], today: '2026-11-28', prev: { health: 5, jobs: { queued: 1 }, today: '2026-11-23' } });
  assert.equal(f.today, '2026-11-28');
  assert.equal(f.spaces.en.recall, 1);
  assert.equal(f.health, 5);
  assert.deepEqual(f.jobs, { queued: 1 });
});

test('没有上一份：体检 0 条，不带后台活', () => {
  const f = classFacts({ mem: { reviews: [], sessions: [], absorb: [], recall: [] }, loaded: new Set(FACTS_NEED), probes: [], today: '2026-11-28', prev: null });
  assert.equal(f.health, 0);
  assert.equal('jobs' in f, false);
});
