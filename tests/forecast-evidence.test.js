// 证据 → 每块的作答和复习序列（spec 6.2）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockEvidence } from '../kit/src/forecast/evidence.js';
import { toEvidence } from '../kit/src/memory/session.js';
import { toAnswer } from '../kit/src/live/sync.js';

const DAY = 86400000;
const T0 = Date.parse('2026-11-01T10:00:00');
const at = (d, min = 0) => T0 + d * DAY + min * 60000;
let n = 0;
function rec({ comp, q = '题', ok, attempts = 1, d = 0, min = 0, session = 'c-20261101-1', block = 'DS-L2.1.1', type = 'answer', extra = {} }) {
  const ev = toEvidence('record', toAnswer({ type, block: comp, q, ok, attempts, final: true, at: at(d, min) }), { session, block });
  return { ...ev, id: `ev-${++n}`, ...extra };
}
const curriculum = [
  { id: 'DS-L2', level: 'lecture', title: '线性表' },
  { id: 'DS-L2.1.1', level: 'block', title: '顺序表' },
  { id: 'DS-L2.1.2', level: 'block', title: '链表' },
];
const mem = (evidence, sessions = []) => ({ evidence, curriculum, sessions });

test('每道题只算第一次', () => {
  const m = blockEvidence(mem([rec({ comp: 'q1', ok: true }), rec({ comp: 'q1', ok: false, d: 3, session: 'c-20261104-1' })]));
  assert.equal(m.get('DS-L2.1.1').obs.length, 1);
  assert.equal(m.get('DS-L2.1.1').obs[0].ok, true);
});

test('真题级认得出', () => {
  const m = blockEvidence(mem([
    rec({ comp: 'q1', ok: true, extra: { exam: 'Q-408-2015-01' } }),
    rec({ comp: 'd-lab-x', ok: true, min: 1, extra: { like: 'Q-408-2015-02' } }),
    rec({ comp: 'q3', ok: true, min: 2 }),
  ]));
  assert.deepEqual(m.get('DS-L2.1.1').obs.map((o) => o.level), ['exam', 'exam', 'class']);
});

test('单选题带猜对的底', () => {
  const m = blockEvidence(mem([rec({ comp: 'qz', ok: true, type: 'quiz' }), rec({ comp: 'a', ok: true, min: 1 })]));
  assert.deepEqual(m.get('DS-L2.1.1').obs.map((o) => o.g), [0.25, 0]);
});

test('失手算错、没把握的对不算、改对了算错', () => {
  const m = blockEvidence(mem([rec({ comp: 'w', ok: true, attempts: 2 }), rec({ comp: 'x', ok: false, min: 1 })]));
  assert.deepEqual(m.get('DS-L2.1.1').obs.map((o) => o.ok), [false, false]);
});

test('复习一天一条：同一天两节课只留第一节', () => {
  const m = blockEvidence(mem([
    rec({ comp: 'a', ok: true, session: 's1' }),
    rec({ comp: 'b', ok: false, min: 30, session: 's2' }),
    rec({ comp: 'c', ok: true, d: 4, session: 's3' }),
  ]));
  assert.deepEqual(m.get('DS-L2.1.1').reviews, [{ day: '2026-11-01', ok: true }, { day: '2026-11-05', ok: true }]);
});

test('没有的块不算', () => {
  const m = blockEvidence(mem([rec({ comp: 'a', ok: true, block: 'L9.9.9' })]));
  assert.ok(!m.has('L9.9.9'));
});

test('asOf 截断；讲过的块没有作答也是 taught', () => {
  const m = blockEvidence(mem([rec({ comp: 'a', ok: true }), rec({ comp: 'b', ok: true, d: 5, session: 's9' })], [{ id: 'c1', block: 'DS-L2.1.2' }]), { asOf: at(1) });
  assert.equal(m.get('DS-L2.1.1').obs.length, 1);
  assert.equal(m.get('DS-L2.1.2').taught, true);
  assert.equal(m.get('DS-L2.1.2').obs.length, 0);
});

test('upTo 截到某一天和按 asOf 重新整理一样', async () => {
  const { upTo } = await import('../kit/src/forecast/evidence.js');
  const evs = [rec({ comp: 'a', ok: true, session: 's1' }), rec({ comp: 'b', ok: false, d: 3, session: 's2' }), rec({ comp: 'c', ok: true, d: 6, session: 's3', block: 'DS-L2.1.2' })];
  const m = mem(evs, [{ id: 's9', block: 'DS-L2.1.2', date: '2026-11-05' }]);
  const cut = upTo(blockEvidence(m), '2026-11-04');
  const fresh = blockEvidence(m, { asOf: Date.parse('2026-11-04T23:59:59') });
  for (const b of ['DS-L2.1.1', 'DS-L2.1.2']) {
    assert.deepEqual(cut.get(b).obs, fresh.get(b).obs, b);
    assert.deepEqual(cut.get(b).reviews, fresh.get(b).reviews, b);
    assert.equal(cut.get(b).taught, fresh.get(b).taught, b);
  }
});
