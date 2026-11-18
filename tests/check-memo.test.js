// 检验里最后没过的题记错题（外部 review 必改 2）：memo 的 error 那条路多收 check、probe、target、items 照存
import test from 'node:test';
import assert from 'node:assert/strict';
import { planEntry } from '../kit/src/memory/memo.js';

const ev = { id: 'ev-ck-1', src: 'check', kind: 'construct', comp: 'k1:p2', session: 'c-1', block: 'L2.1.1', at: 1, first: 'A=[[1,0],[0,1]] B=[[1,0],[0,1]]' };
const entry = {
  kind: 'error',
  attrs: { q: '造两个同型但不相等的矩阵', mine: ev.first, step: '这两个相等了', cause: 'L2-14', block: 'L2.1.1', basis: ['ev-ck-1'], check: 'k1', probe: 'p2', target: 'L2-14', items: [{ id: 'if1', ok: false, why: '这两个相等了' }, { id: 'm1', ok: 'missing', why: '' }, { id: 'm2', ok: null, unsure: true }] },
  line: 'error q="…"',
};

test('检验的错题：check、probe、target、items 照存', () => {
  const r = planEntry(entry, { mem: { curriculum: [{ id: 'L2.1.1', title: '矩阵' }] }, session: 'c-1', date: '2026-11-18', space: 'math', evidence: [ev] });
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.data.check, 'k1');
  assert.equal(r.data.probe, 'p2');
  assert.equal(r.data.target, 'L2-14');
  assert.deepEqual(r.data.items, [{ id: 'if1', ok: false, why: '这两个相等了' }, { id: 'm1', ok: 'missing' }, { id: 'm2', ok: null, unsure: true }]);
  assert.deepEqual(r.data.evidence, ['ev-ck-1']);
  assert.equal(r.data.block, 'L2.1.1');
});
