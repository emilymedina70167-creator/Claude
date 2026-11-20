// derive（线代）的一行：随机取的矩阵奇异了（上一行 1/det(A) 在这组数上不是有限的），这一组跳过，
// 对的一行（det(A)^(-1)）不因此判错；所有组都跳过时判不了（ok: null）。审查找出来的（dr-final-fix 之后）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeriveDo, sampleEnvs, checkLine } from '../kit/src/derivedo.js';

test('1/det(A) → det(A)^(-1)：换多少组随机数都不判错', () => {
  const s = parseDeriveDo('mode: do\nvars: A=mat(2,2)\nstart: 1/det(A)\ngoal: det(A)^(-1)');
  for (let k = 0; k < 300; k++) {
    const envs = sampleEnvs(s, { seed: `sing-${k}` });
    assert.notEqual(checkLine(s, envs, '1/det(A)', 'det(A)^(-1)').ok, false, `seed sing-${k}`);
  }
});

test('每一组都算不出有限的值：ok 是 null，不是 false', () => {
  const s = parseDeriveDo('mode: do\nvars: A=mat(2,2)\nstart: 1/(det(A)-det(A))');
  const envs = sampleEnvs(s, { seed: 'z' });
  const r = checkLine(s, envs, '1/(det(A)-det(A))', '1/0');
  assert.equal(r.ok, null);
  assert.match(r.why, /判不了/);
  // 不等的行照旧判错
  const t = parseDeriveDo('mode: do\nvars: A=mat(2,2)\nstart: 2*A');
  assert.equal(checkLine(t, sampleEnvs(t, { seed: 'z' }), '2*A', '3*A').ok, false);
});
