// 舞台的作答带真题题号（考情第 4 批 4.1）：ask / goal 写 exam= / like=，证据带上、记用时；题号不对、留作模考的当场报
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { actEvidence } from '../kit/src/stage/evidence.js';
import { examCheckOf } from '../kit/src/exam/fields.js';

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };

test('ask value 写 exam=：等着的那一问带上题号、亮出来的时刻', () => {
  const sc = run(new Scene(), 'ask value "缺页几次？" answer=9 exam=Q-408-2019-26');
  assert.equal(sc.waiting.exam, 'Q-408-2019-26');
  assert.ok(Number.isFinite(sc.waiting.shownAt));
  const sc2 = run(new Scene(), 'matrix A = 1 1 / 0 1\ngoal g1 "化成单位阵" when="A = I" like=Q-301-2021-17');
  assert.equal(sc2.goals.get('g1').like, 'Q-301-2021-17');
});

test('写的不像题号：当场报（没演上，下一轮告诉老师）', () => {
  assert.throws(() => run(new Scene(), 'ask value "x" answer=1 exam=2019-26'), /exam= 写真题的题号/);
});

test('题号库里没有、是留作模考的卷：页面知道考试资料时当场报', () => {
  const sc = new Scene();
  sc.examCheck = examCheckOf({ questions: [{ id: 'Q-408-2019-26' }, { id: 'Q-408-2025-26', reserve: true }] }, [2024, 2025, 2026]);
  run(sc, 'ask value "x" answer=1 exam=Q-408-2019-26');
  assert.throws(() => run(sc, 'ask value "x" answer=1 exam=Q-408-2025-26'), /留作模考/);
  assert.throws(() => run(sc, 'ask value "x" answer=1 exam=Q-408-2018-26'), /没有这道真题/);
});

test('证据：作答带 exam、ms；挑战做到了也带', () => {
  const w = { kind: 'value', prompt: '缺页几次？', exam: 'Q-408-2019-26', shownAt: 1000 };
  const ev = actEvidence({ type: 'value', text: '9', right: true }, { comp: 'S3', q: w.prompt, wait: w, now: 4000 });
  assert.equal(ev.records[0].exam, 'Q-408-2019-26');
  assert.equal(ev.records[0].ms, 3000);
  const none = actEvidence({ type: 'value', text: '9', right: true }, { comp: 'S3', q: 'x' });
  assert.equal(none.records[0].exam, undefined);
});
