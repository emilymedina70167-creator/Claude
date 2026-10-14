// 查找的演示引擎（engines/search.js）：KMP、散列表、折半查找；和王道的例子对答案
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kmpEngine, hashEngine, bsearchEngine, nextArray, nextvalArray } from '../kit/src/engines/search.js';

const go = (eng, f) => { const input = eng.parse(f); return { input, r: eng.run(input) }; };
const KEYS = '19 14 23 01 68 20 84 27 55 11 10 79';

test('KMP：next、nextval（王道从 1 数）', () => {
  const T = (s) => [undefined, ...s];
  const nx = nextArray(T('abaabc'));
  assert.deepEqual(nx.slice(1), [0, 1, 1, 2, 2, 3]);
  assert.deepEqual(nextvalArray(T('abaabc'), nx).slice(1), [0, 1, 0, 2, 1, 3]);
  const a = nextArray(T('aaaab'));
  assert.deepEqual(a.slice(1), [0, 1, 2, 3, 4]);
  assert.deepEqual(nextvalArray(T('aaaab'), a).slice(1), [0, 0, 0, 0, 4]);
  const { input, r } = go(kmpEngine, { pattern: 'abaabc', show: 'nextval' });
  assert.equal(kmpEngine.quiz(input, r).answer, '0 1 0 2 1 3');
  const asks = r.steps.filter((s) => s.ask);
  assert.deepEqual(asks.filter((s) => s.ask.tag === 'next').map((s) => s.ask.answer), [1, 1, 2, 2, 3]);
  assert.deepEqual(asks.filter((s) => s.ask.tag === 'nextval').map((s) => s.ask.answer), [1, 0, 2, 1, 3]);
  for (const s of r.steps) assert.match(kmpEngine.view(s.view, input), /sv-tbl/);
});

test('KMP 匹配：位置、失配后 j 变成多少', () => {
  const { input, r } = go(kmpEngine, { pattern: 'abaabc', text: 'abaabaabcabaabc' });
  assert.equal(r.passes[0][0], 4);
  assert.match(r.steps.at(-1).msg, /匹配成功，位置是 i − 6 = 4/);
  assert.deepEqual(r.steps.filter((s) => s.ask?.tag === 'slide').map((s) => s.ask.answer), [3]);
  assert.equal(kmpEngine.quiz(input, r).answer, '4');
  const nv = go(kmpEngine, { pattern: 'aaaab', text: 'aaabaaaab', use: 'nextval' });
  assert.equal(nv.r.passes[0][0], 5);
  const miss = go(kmpEngine, { pattern: 'abc', text: 'ababab' });
  assert.equal(miss.r.passes[0][0], 0);
  for (const s of nv.r.steps) assert.match(kmpEngine.view(s.view, nv.input), /sv-kmp/);
  assert.throws(() => kmpEngine.parse({}), /pattern/);
  assert.throws(() => kmpEngine.parse({ pattern: 'ab', show: 'match' }), /text/);
});

test('散列表：线性探测（表长 16）、拉链法，ASL 和王道一致', () => {
  let { input, r } = go(hashEngine, { hash: KEYS, p: '13', size: '16' });
  assert.equal(r.passes[0].join(' '), '# 14 01 68 27 55 19 20 84 79 23 11 10 # # #');
  assert.deepEqual(r.asl, { succ: '5/2', fail: '7' });
  assert.equal(hashEngine.quiz(input, r, {}).answer, r.passes[0].join(' '));
  assert.equal(hashEngine.quiz(input, r, { quiz: 'asl' }).answer, '5/2');
  const place = r.steps.filter((s) => s.ask?.tag === 'place').map((s) => s.ask.answer);
  assert.equal(place.length, 12);
  assert.equal(place[4], '3', '68 冲突后放在 3');
  ({ input, r } = go(hashEngine, { hash: KEYS, p: '13', probe: 'chain' }));
  assert.deepEqual(r.asl, { succ: '7/4', fail: '12/13' });
  for (const s of r.steps) assert.match(hashEngine.view(s.view, input), /sv-chains/);
  assert.throws(() => hashEngine.quiz(input, r, {}), /拉链法/);
  const q = go(hashEngine, { hash: KEYS, p: '13', size: '16', probe: 'quadratic' });
  assert.equal(q.r.passes[0].filter((x) => x !== '#').length, 12);
  assert.throws(() => hashEngine.parse({ hash: KEYS }), /p:/);
  assert.throws(() => hashEngine.parse({ hash: KEYS, p: '13', size: '10' }), /不小于/);
  assert.throws(() => hashEngine.parse({ hash: '1 2 3', p: '2', probe: 'random' }), /probe/);
});

test('折半查找：比较序列、判定树的 ASL（11 个元素：3 和 11/3）', () => {
  const { input, r } = go(bsearchEngine, { bsearch: '7 10 13 16 19 29 32 33 37 41 43', key: '11, 32', tree: 'true' });
  assert.deepEqual(r.passes.map((p) => p.join(' ')), ['29 13 7 10', '29 37 32']);
  assert.deepEqual(r.asl, { succ: '3', fail: '11/3' });
  assert.equal(bsearchEngine.quiz(input, r).answer, '29 13 7 10');
  for (const s of r.steps) assert.match(bsearchEngine.view(s.view, input), /sv-tree/);
  assert.deepEqual(r.steps.filter((s) => s.ask?.tag === 'mid').map((s) => s.ask.answer), ['6', '3', '1', '2', '6', '9', '7']);
  assert.throws(() => bsearchEngine.parse({ bsearch: '3 1 2', key: '1' }), /从小到大/);
  assert.throws(() => bsearchEngine.parse({ bsearch: '1 2 3' }), /key/);
});
