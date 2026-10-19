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

// —— 常见错法：和 stepper.js 的诊断一样比（ask 在错法的 run 里找题面、种类一样的问题；quiz 比答案；填表逐格比）——
import { misreadAnswer, misreadFill } from '../kit/src/stepperspec.js';

const asksOf = (r) => r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean);
const ansText = (a) => (Array.isArray(a.alts) ? a.alts.map((z) => [].concat(z).join(' ')).join(' | ') : [].concat(a.answer).join(' '));
// only：只和这一种错法比（对的答案不该被认成它；别的错法在这一问上可能和对的一样，stepper 不会拿对的答案去比）
const misAsk = (eng, input, ask, given, only) => misreadAnswer(given, eng.variants(input).filter((v) => !only || v.label === only).map((v) => {
  const a = asksOf(eng.run(v.input)).find((y) => y.q === ask.q && y.kind === ask.kind);
  return a ? { label: v.label, answer: ansText(a) } : null;
}).filter(Boolean));
const misFill = (eng, input, values) => misreadFill(eng.table(input, eng.run(input)), values, eng.variants(input).map((v) => ({ label: v.label, table: eng.table(v.input, eng.run(v.input)) })).filter((x) => x.table));
const cellsOf = (t) => t.rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));
const labelLike = (eng, input, re) => eng.variants(input).find((v) => re.test(v.label))?.label;

test('散列表的错法：ASL失败按表长平均、空位置那次没算；拉链法和空指针比也算了、除以了关键字个数', () => {
  // 王道：p = 13，表长 16，线性探测；ASL失败 = 91/13 = 7
  let { input, r } = go(hashEngine, { hash: KEYS, p: '13', size: '16' });
  const fail = asksOf(r).find((a) => a.tag === 'aslfail');
  const bySize = labelLike(hashEngine, input, /按表长 16 个地址平均/);
  const noEmpty = labelLike(hashEngine, input, /空位置的那次比较没算/);
  assert.ok(bySize && noEmpty);
  // 16 个地址都算（后 3 个空着各 1 次）：94/16；学生写约分的、没约分的、两位小数都认得
  for (const g of ['47/8', '94/16', '5.88']) assert.equal(misAsk(hashEngine, input, fail, g), bySize, g);
  assert.equal(misAsk(hashEngine, input, fail, '6'), noEmpty, '每个地址少算 1 次：78/13 = 6');
  assert.equal(misAsk(hashEngine, input, fail, '7'), '', '对的答案不认成错法');
  assert.equal(misAsk(hashEngine, input, fail, '8'), '', '对不上任何错法就不说');
  // 表长等于 p：没有「按表长平均」「表长当除数」；这组数平方探测放不下（13 不是 4k+3），那种错法算不了也不列
  ({ input, r } = go(hashEngine, { hash: KEYS, p: '13' }));
  assert.deepEqual(hashEngine.variants(input).map((v) => v.input.mistake), ['failNoEmpty', 'failByN']);
  const f13 = asksOf(r).find((a) => a.tag === 'aslfail');
  const byN13 = labelLike(hashEngine, input, /除以了关键字个数 12/);
  assert.equal(misAsk(hashEngine, input, f13, `${f13.answer * 13}/12`), byN13);
  assert.equal(misAsk(hashEngine, input, f13, f13.display, byN13), '');
  // 拉链法：ASL失败 = 12/13
  ({ input, r } = go(hashEngine, { hash: KEYS, p: '13', probe: 'chain' }));
  const cf = asksOf(r).find((a) => a.tag === 'aslfail');
  const nul = labelLike(hashEngine, input, /空指针的比较也算了/);
  const byN = labelLike(hashEngine, input, /除以了关键字个数 12/);
  assert.equal(misAsk(hashEngine, input, cf, '25/13'), nul, '13 条链各多算 1 次');
  assert.equal(misAsk(hashEngine, input, cf, '1'), byN, '12/12');
  assert.equal(misAsk(hashEngine, input, cf, '12/13'), '');
  // 关键字个数正好等于 p：除以 n 和除以 p 一样，不列
  const same = go(hashEngine, { hash: '1 2 3', p: '3', probe: 'chain' });
  assert.deepEqual(hashEngine.variants(same.input).map((v) => v.input.mistake), ['nullCounted']);
});

test('折半查找的错法：位置从 0 数（填表）、mid 向上取整（每一问的题面不一样）、判定树的 ASL失败', () => {
  const { input, r } = go(bsearchEngine, { bsearch: '7 10 13 16 19 29 32 33 37 41 43', key: '11, 32', tree: 'true' });
  // 位置从 0 数：比的元素一样，low、high、mid 都小 1
  const zero = labelLike(bsearchEngine, input, /位置从 0 数/);
  const zt = bsearchEngine.table({ ...input, mistake: 'zero' }, r);
  assert.deepEqual(cellsOf(zt)[0], ['0', '10', '5', '29']);
  assert.equal(misFill(bsearchEngine, input, cellsOf(zt)), zero);
  assert.equal(misFill(bsearchEngine, input, cellsOf(bsearchEngine.table(input, r))), '', '对的表不认成错法');
  // 向上取整：查 11 的第 3 次，对的是 7（位置 1），向上取整是 10（位置 2）
  const ceil = labelLike(bsearchEngine, input, /向上取整/);
  const third = asksOf(r).find((a) => a.q === '查找 11：第 3 次和哪个元素比？在图里点出来。');
  assert.equal(third.answer, '1');
  assert.equal(misAsk(bsearchEngine, input, third, '2'), ceil);
  assert.equal(misAsk(bsearchEngine, input, third, '1', ceil), '', '对的答案不认成向上取整');
  // 题面不一样：第 3 次又点了第 1 次比过的 29（位置 6），不会被当成「向上取整」（向上取整的第 1 次也是 6）
  assert.equal(misAsk(bsearchEngine, input, third, '6'), '');
  // 判定树：ASL失败 = 44/12 = 11/3；失败结点那层也算 → 56/12 = 14/3；除以 n → 44/11 = 4
  const fail = asksOf(r).find((a) => a.tag === 'aslfail');
  const lvl = labelLike(bsearchEngine, input, /失败结点那一层也算/);
  const byN = labelLike(bsearchEngine, input, /ASL失败除以了 11/);
  assert.equal(misAsk(bsearchEngine, input, fail, '14/3'), lvl);
  assert.equal(misAsk(bsearchEngine, input, fail, '4.67'), lvl);
  assert.equal(misAsk(bsearchEngine, input, fail, '4'), byN);
  assert.equal(misAsk(bsearchEngine, input, fail, '11/3', lvl), '', '对的答案不认成这两种');
  assert.equal(misAsk(bsearchEngine, input, fail, '11/3', byN), '');
  // 只画判定树（没写 key）：没有填表、没有比较序列，只剩 ASL 的两种
  const t = go(bsearchEngine, { bsearch: '7 10 13 16 19 29 32 33 37 41 43', tree: 'true' });
  assert.deepEqual(bsearchEngine.variants(t.input).map((v) => v.input.mistake), ['failLevel', 'failByN']);
});
