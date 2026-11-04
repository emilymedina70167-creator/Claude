import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specFor, specKey, SPEC_SAY } from '../kit/src/class/spec.js';
import { usageOf, usageText, callCost } from '../kit/src/class/usage.js';

const base = { on: true, available: true, started: true, liveTurns: 4 };

test('specFor：开课前抢跑「开始上课」；一轮讲完、板上没事可做时抢跑「继续」', () => {
  assert.equal(specFor({ ...base, started: false, liveTurns: 0 }), SPEC_SAY.start);
  assert.equal(specFor({ ...base, started: false, liveTurns: 2 }), null, '刷新回来的课不是开课');
  assert.equal(specFor(base), SPEC_SAY.next);
});

test('specFor：学生有别的要说、有题要做、正在讲、关着时不抢跑', () => {
  for (const k of ['busy', 'ended', 'compacting', 'queued', 'drafts', 'ink', 'pending', 'waiting', 'beatsLeft', 'away']) {
    assert.equal(specFor({ ...base, [k]: 1 }), null, k);
  }
  assert.equal(specFor({ ...base, on: false }), null);
  assert.equal(specFor({ ...base, available: false }), null);
});

test('specKey：整份输入一字不差才一样；带图不抢跑', () => {
  const a = [{ role: 'user', content: '说明' }, { role: 'user', content: '继续。' }];
  assert.equal(specKey(a), specKey(a.map((t) => ({ ...t }))));
  assert.notEqual(specKey(a), specKey([a[0], { role: 'user', content: '继续' }]));
  assert.notEqual(specKey(a), specKey([{ role: 'user', content: '说明 ' }, a[1]]));
  assert.equal(specKey(a, 1), null);
});

test('usage：抢跑接上的轮和没用上的分开记；没用上的算多跑的轮', () => {
  const turns = [
    { role: 'claude', cost: callCost({ bytes: 1000, why: 'turn', ms: 2000, first: 0, spec: 'hit' }) },
    { role: 'system', kind: 'spec', discarded: true, cost: callCost({ bytes: 1000, why: 'spec' }) },
    { role: 'claude', cost: callCost({ bytes: 1000, why: 'turn', ms: 30000 }) },
  ];
  const u = usageOf(turns);
  assert.deepEqual(u.spec, { hit: 1, miss: 1 });
  assert.equal(u.extra.spec, 1);
  assert.equal(u.calls, 3);
  assert.match(usageText(u), /抢跑接上 1 次（没用上 1 次）/);
  assert.equal(turns[0].cost.spec, 'hit');
});

test('specKey：版面的估算数（高约、宽约）变了不算，别的字变了算', () => {
  const a = (h, more = '') => [{ role: 'user', content: `内容一共高约 649，一屏能看约 ${h}：学生要往下滑一下。${more}` }];
  assert.equal(specKey(a(580)), specKey(a(570)));
  assert.notEqual(specKey(a(580)), specKey(a(580, '放得下')));
});

test('specDiff：记下第一处不同的地方', async () => {
  const { specDiff } = await import('../kit/src/class/spec.js');
  assert.equal(specDiff('abc', 'abc'), '');
  assert.equal(specDiff('前面一样，后面是甲', '前面一样，后面是乙', 3), '后面是甲 ⟂ 后面是乙');
});
