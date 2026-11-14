// 测量的先验和固定种子（docs/superpowers/specs/2026-11-14-round10-measure-design.md 第六节）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PART_PRIORS, TAUGHT_MIN, GUESS, PARTIAL, TAU, DELTA, BLOCK_S_X, DRAWS, RECENT_X, MEASURED_N } from '../kit/src/forecast/priors.js';
import { rng, seedOf } from '../kit/src/forecast/rng.js';
import { SUBJECTS } from '../kit/src/memory/score.js';
import { TYPES } from '../kit/src/exam/taxonomy.js';

test('每一部分都有先验、都写了依据', () => {
  for (const s of SUBJECTS) for (const p of s.parts) {
    const pr = PART_PRIORS[p.key];
    assert.ok(pr && pr.mean > 0 && pr.mean < 1 && pr.n > 0 && pr.basis, p.key);
  }
  assert.ok(TAUGHT_MIN.mean > 0 && TAUGHT_MIN.basis);
});

test('猜对的底：单选 0.25、七选五 1/7、多选 1/11、大题 0；每种题型都有', () => {
  assert.equal(GUESS.single, 0.25); assert.equal(GUESS.reading, 0.25); assert.equal(GUESS.cloze, 0.25);
  assert.ok(Math.abs(GUESS.newtype - 1 / 7) < 1e-12); assert.ok(Math.abs(GUESS.multi - 1 / 11) < 1e-12);
  for (const t of ['fill', 'answer', 'comp', 'translate', 'essay', 'analysis']) assert.equal(GUESS[t], 0, t);
  for (const t of Object.keys(TYPES)) assert.ok(t in GUESS, t);
  for (const t of ['answer', 'comp', 'translate', 'essay', 'analysis']) assert.ok(PARTIAL.has(t), t);
  assert.ok(!PARTIAL.has('single') && !PARTIAL.has('fill'));
});

test('其余常数', () => {
  for (const k of ['math', 'cs', 'en', 'pol']) assert.equal(TAU[k], 0.9);
  assert.equal(DELTA, 1.2); assert.equal(BLOCK_S_X, 3); assert.equal(DRAWS, 1000); assert.equal(RECENT_X, 2); assert.equal(MEASURED_N, 2);
});

test('同一个种子同一串数，不同种子不同', () => {
  const a = rng(seedOf('2026-11-14', 'x')), b = rng(seedOf('2026-11-14', 'x')), c = rng(seedOf('2026-11-15', 'x'));
  const xs = [a(), a(), a()];
  assert.deepEqual(xs, [b(), b(), b()]);
  assert.notEqual(xs[0], c());
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});
