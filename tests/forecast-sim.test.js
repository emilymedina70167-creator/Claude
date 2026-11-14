// 模拟学生的尺子能跑、输出的结构对（真正的量在 tools/forecast-sim.mjs，结果 evals/forecast/results.md）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, judge, SETTINGS, simStudent } from '../tools/forecast-sim.mjs';

test('一个学生一年的证据：有课堂题也有真题级', () => {
  const st = simStudent(SETTINGS[0], 1);
  assert.ok(st.evidence.length > 500);
  assert.ok(st.evidence.some((e) => e.exam));
});

test('小规模跑一遍：每个时点每科一行，合格线算得出来', () => {
  const rows = run({ students: 12, draws: 100 });
  assert.equal(rows.length, 12 * 4 * 5 + 12);
  for (const r of rows.filter((x) => x.subject !== 'cs-ksd')) assert.ok(Number.isFinite(r.lo) && Number.isFinite(r.truth));
  for (const r of rows.filter((x) => x.subject === 'cs-ksd')) assert.ok(Number.isFinite(r.thin) && Number.isFinite(r.full));
  const j = judge(rows);
  assert.ok(typeof j.pass.m0 === 'boolean' && typeof j.pass.enough === 'boolean');
});
