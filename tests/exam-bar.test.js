// 真题级（kit/src/exam/bar.js）：这一块的原真题（或教研室对标真题出的、过了检查的新题）在一节课里第一次碰到就做对、
// 没看提示、没标没把握，算过了；在建议用时以内，限时也过了。原题再做对不算（rule-rev-2）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barOf, barsChanged, suggestMs } from '../kit/src/exam/bar.js';

const qs = [{ id: 'Q-408-2019-26', year: 2019, points: 2, subject: '408' }, { id: 'Q-408-2023-45', year: 2023, points: 8 }];
const ev = (x) => ({ kind: 'answer', src: 'answer', session: 'c-1', ...x });

test('建议用时：分值 × 180 / 卷面总分 × 0.85 分钟', () => {
  assert.equal(suggestMs({ id: 'Q-408-2019-26', points: 2 }), 2 * 180 / 150 * 0.85 * 60000);
  assert.equal(suggestMs({ id: 'Q-201-2019-46', points: 2 }), 2 * 180 / 100 * 0.85 * 60000);
});

test('第一次碰到就一次做对、用时以内：过了、限时也过了', () => {
  const b = barOf({ block: 'OS-L3.2.1', questions: qs, evidence: [ev({ exam: 'Q-408-2019-26', ok: true, attempts: 1, ms: 60000, at: 10 })], now: 99 });
  assert.equal(b.passed, true);
  assert.equal(b.timed, true);
  assert.deepEqual(b.done, [{ id: 'Q-408-2019-26', at: 10, ok: true, first: true, ms: 60000, session: 'c-1' }]);
  assert.equal(b.at, 99);
});

test('超时：过了，限时没过；第一次错了、后来对了：没过', () => {
  assert.equal(barOf({ block: 'b', questions: qs, evidence: [ev({ exam: 'Q-408-2019-26', ok: true, attempts: 1, ms: 9e6, at: 1 })] }).timed, false);
  const b = barOf({ block: 'b', questions: qs, evidence: [ev({ exam: 'Q-408-2019-26', ok: false, attempts: 1, at: 1 }), ev({ exam: 'Q-408-2019-26', ok: true, attempts: 2, at: 2 })] });
  assert.equal(b.passed, false);
  assert.equal(b.done[0].ok, false);
});

test('原题：第二节课再做对不算；看了提示、标了没把握不算', () => {
  const again = barOf({ block: 'b', questions: qs, evidence: [ev({ exam: 'Q-408-2019-26', ok: false, attempts: 1, at: 1 }), ev({ exam: 'Q-408-2019-26', ok: true, attempts: 1, at: 50, session: 'c-2' })] });
  assert.equal(again.passed, false);
  const hinted = barOf({ block: 'b', questions: qs, evidence: [{ kind: 'hint', session: 'c-1', comp: 'S3', at: 1 }, ev({ exam: 'Q-408-2019-26', comp: 'S3', ok: true, attempts: 1, at: 2 })] });
  assert.equal(hinted.passed, false);
  assert.equal(barOf({ block: 'b', questions: qs, evidence: [ev({ exam: 'Q-408-2019-26', ok: true, attempts: 1, sure: false, at: 2 })] }).passed, false);
});

test('like=：只有教研室出的、过了检查的题（d-lab-）算；课上老师当场改数的不算', () => {
  assert.equal(barOf({ block: 'b', questions: qs, evidence: [ev({ like: 'Q-408-2019-26', comp: 'd-lab-7', ok: true, attempts: 1, at: 1 })] }).passed, true);
  assert.equal(barOf({ block: 'b', questions: qs, evidence: [ev({ like: 'Q-408-2019-26', comp: 'S5', ok: true, attempts: 1, at: 1 })] }).passed, false);
  assert.equal(barOf({ block: 'b', questions: qs, evidence: [ev({ exam: 'Q-408-2018-1', ok: true, attempts: 1, at: 1 })] }).done.length, 0, '别的块的题不算');
});

test('asOf：退回那一天以前；坑留着；只差 at 不算变了', () => {
  const evs = [ev({ exam: 'Q-408-2019-26', ok: true, attempts: 1, at: 100 })];
  assert.equal(barOf({ block: 'b', questions: qs, evidence: evs, asOf: 50 }).passed, false);
  const prev = { block: 'b', traps: ['G-OS-3.2#t1'], at: 1 };
  const next = barOf({ block: 'b', questions: qs, evidence: evs, prev, now: 7 });
  assert.deepEqual(next.traps, ['G-OS-3.2#t1']);
  assert.equal(barsChanged(next, { ...next, at: 99 }), false);
  assert.equal(barsChanged(next, { ...next, passed: false }), true);
  assert.equal(barsChanged(null, next), true);
});
test('「有把握吗」另记的那条点了没把握：不算', () => {
  const b = barOf({ block: 'b', questions: qs, evidence: [ev({ exam: 'Q-408-2019-26', comp: 'q-1', ok: true, attempts: 1, at: 2 }), { kind: 'sure', session: 'c-1', comp: 'q-1', detail: { sure: false }, at: 3 }] });
  assert.equal(b.passed, false);
});
