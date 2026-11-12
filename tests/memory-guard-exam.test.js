// 守卫认真题、考点、坑的编号（考情第 4 批 4.2）：引了真有的照常收，引了留作模考的卷拒掉
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardCandidate } from '../kit/src/memory/guard.js';

const mem = { evidence: [{ id: 'ev-1', session: 'c-1', at: 1 }], sessions: [{ id: 'c-1', startedAt: 0 }] };
const exam = { ids: new Set(['Q-408-2019-23', 'G-OS-3.2', 'G-OS-3.2#t1']), reserved: new Set(['Q-408-2025-3']) };
const err = (extra) => ({ coll: 'errors', id: 'OS-L3-01', doc: { source: '课上', q: '缺页', mine: '8', step: '1', cause: '把 FIFO 当 LRU', date: '2026-11-12', ...extra }, author: 'class', session: 'c-1' });

test('依据写真题题号、坑的编号：认得，不算编出来的', () => {
  const g = guardCandidate({ ...err(), basis: ['ev-1', 'Q-408-2019-23', 'G-OS-3.2#t1'] }, { mem, exam });
  assert.ok(!g.checks.some((c) => c.code === 'basis-missing'), JSON.stringify(g.checks));
  const bare = guardCandidate({ ...err(), basis: ['Q-408-2019-23'] }, { mem });
  assert.ok(bare.checks.some((c) => c.code === 'basis-missing'), '没给考试资料时照旧当找不到');
});

test('引了留作模考的卷（依据或正文里）：拒掉', () => {
  const a = guardCandidate({ ...err(), basis: ['Q-408-2025-3'] }, { mem, exam });
  assert.equal(a.verdict, 'reject');
  assert.ok(a.checks.some((c) => c.code === 'exam-reserved'));
  const b = guardCandidate(err({ cause: '和 Q-408-2025-3 那道一样把 FIFO 当 LRU' }), { mem, exam });
  assert.equal(b.verdict, 'reject');
});
