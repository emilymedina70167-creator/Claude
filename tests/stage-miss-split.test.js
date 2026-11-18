// dr-ext-live-fixes 2、3：.miss 按手势、原因分；展开完了还在点，告诉学生能按住拖去合并
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { reasonOf } from '../kit/src/stage/types/tex.rules.js';
import { judge } from '../kit/src/stage/referee.js';

function scene(lines) {
  const s = new Scene();
  s.prewriteAll = true;
  for (const c of parseScript(lines)) s.apply(c);
  return s;
}

test('原因的归类', () => {
  assert.equal(reasonOf('AB 和 BA 不是同类项：矩阵乘法不交换，先后不一样就是两样东西'), 'noncommute');
  assert.equal(reasonOf('这一项没有括号可展开'), 'noparen');
  assert.equal(reasonOf('A 和 B 不是同类项'), 'notlike');
  assert.equal(reasonOf('判不了：含逆'), 'unknown');
});

test('.miss 按原因 > 按手势 > 不分 挑', () => {
  const s = scene(['tex e = "A^2+AB+BA+B^2" alg=on', 'open e move', 'open e expand',
    '@e.miss merge say "合并：先后不一样"', '@e.miss why=noparen say "没有括号了，按住拖去合并"', '@e.miss say "再想想"'].join('\n'));
  const exp = s.slipReactions('e', { legal: false, gesture: 'expand', reason: 'noparen' }, { blocked: true });
  assert.deepEqual(exp.map((x) => x.src), ['say "没有括号了，按住拖去合并"']);
  const mer = s.slipReactions('e', { legal: false, gesture: 'merge', reason: 'noncommute' }, { blocked: true });
  assert.deepEqual(mer.map((x) => x.src), ['say "合并：先后不一样"']);
  const other = s.slipReactions('e', { legal: false, gesture: 'reorder', reason: 'unequal' }, { blocked: true });
  assert.deepEqual(other.map((x) => x.src), ['say "再想想"']);
  // 都只演一次
  assert.deepEqual(s.slipReactions('e', { legal: false, gesture: 'merge', reason: 'noncommute' }, { blocked: true }), []);
});

test('展开完了还在点：开了 move 时告诉学生按住拖去合并；裁判带上手势和原因', () => {
  const s = scene(['tex e = "A^2+AB" alg=on', 'open e move', 'open e expand'].join('\n'));
  const r = judge(s, 'e', { type: 'expand', key: 't1' });
  assert.equal(r.verdict.legal, false);
  assert.match(r.verdict.why, /要合并就按住这一项拖到另一项上/);
  assert.equal(r.verdict.gesture, 'expand');
  assert.equal(r.verdict.reason, 'noparen');
  const s2 = scene(['tex e = "A^2+AB" alg=on', 'open e expand'].join('\n'));
  assert.doesNotMatch(judge(s2, 'e', { type: 'expand', key: 't1' }).verdict.why, /按住/);
});
