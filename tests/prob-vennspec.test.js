// 视觉交互第 4 批 Task 2：文氏图的写法（kit/src/prob/vennspec.js，纯函数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVenn, judgeRegion, judgeProb, atomName, readoutOf } from '../kit/src/prob/vennspec.js';

test('写法：sets、given、shade（几行）、ask（几条）、find', () => {
  const v = parseVenn(`title: 德摩根
sets: A B
given: P(A) = 0.5, P(B) = 0.4, P(AB) = 0.2
shade: A - B
shade: AB
ask: "两个都不发生" ~(A + B)
ask: 至少一个发生 => A + B
ask: A' ∪ B'
ask: P(A + B)
ask: "已知 B 发生，A 发生的概率" P(A | B)
find: P(A - B), P(B | A)
note: 圆外面那一块也能点`);
  assert.deepEqual(v.names, ['A', 'B']);
  assert.equal(v.fields.title, '德摩根');
  assert.equal(v.fields.note, '圆外面那一块也能点');
  assert.equal(v.givens.length, 3);
  assert.deepEqual(v.shades.map((s) => s.atoms), [[1], [3]]);
  assert.deepEqual(v.asks.map((a) => a.kind), ['region', 'region', 'region', 'prob', 'prob']);
  assert.equal(v.asks[0].q, '两个都不发生');
  assert.deepEqual(v.asks[0].atoms, [0]);
  assert.equal(v.asks[1].q, '至少一个发生');
  assert.deepEqual(v.asks[1].atoms, [1, 2, 3]);
  assert.equal(v.asks[2].q, '在图上点出 $\\overline{A} \\cup \\overline{B}$', '没写题目：题目就是式子');
  assert.equal(String(v.asks[3].value), '7/10');
  assert.equal(v.asks[3].q, '$P(A \\cup B)$ 是多少？');
  assert.equal(String(v.asks[4].value), '1/2');
  assert.equal(v.finds.length, 2);
  assert.deepEqual(v.problems, []);
  assert.equal(v.probs.status, 'unique');
});

test('写错的报出来：没有 sets、事件太多、式子读不懂、要学生算的量定不下来、给的条件矛盾', () => {
  assert.match(parseVenn('given: P(A) = 0.5').problems.join('；'), /sets/);
  assert.match(parseVenn('sets: A B C D').problems.join('；'), /1 到 3 个/);
  assert.match(parseVenn('sets: A B\nshade: A ∪').problems.join('；'), /shade.*事件的式子/);
  assert.match(parseVenn('sets: A B\ngiven: P(A) = 0.5, P(B) = 0.4\nask: P(AB)').problems.join('；'), /定不下来/);
  assert.match(parseVenn('sets: A B\ngiven: P(A) = 0.5, P(B) = 0.4, P(AB) = 0.6').problems.join('；'), /矛盾/);
  assert.match(parseVenn('sets: A B\nask: P(A)').problems.join('；'), /given/);
  assert.match(parseVenn('sets: A B\ngiven: P(A) = 0.5, P(B) = 0, P(AB) = 0\nask: P(A | B)').problems.join('；'), /没有定义/);
  assert.match(parseVenn('sets: A a').problems.join('；'), /名字/);
  assert.match(parseVenn('sets: A B\nfoo: 1').problems.join('；'), /foo/);
  // 没有要学生做的也行（只展示）
  assert.deepEqual(parseVenn('sets: A B C\nshade: (A + B) C').problems, []);
});

test('点区域的判法：全对才过；不对时只说多了几块、少了几块', () => {
  const v = parseVenn('sets: A B C\nask: (A + B) - C');
  const a = v.asks[0];
  assert.deepEqual(a.atoms, [1, 2, 3]);
  assert.deepEqual(judgeRegion(a, [3, 1, 2]), { ok: true, text: '对，就是这几块。', extra: 0, missing: 0 });
  const r = judgeRegion(a, [1, 2, 3, 7]);
  assert.equal(r.ok, false); assert.equal(r.extra, 1); assert.equal(r.missing, 0);
  assert.match(r.text, /多点了 1 块/);
  const s = judgeRegion(a, [1, 5]);
  assert.match(s.text, /多点了 1 块.*少点了 2 块/);
  assert.match(judgeRegion(a, []).text, /一块都没点/);
  // 空集的题：一块都不点是对的
  assert.equal(judgeRegion(parseVenn('sets: A B\nask: A - A').asks[0], []).ok, true);
});

test('填概率的判法：分数、小数、百分数都认；小数位数不够的不算；读不懂的不判', () => {
  const v = parseVenn('sets: A B\ngiven: P(A) = 1/3, P(B) = 1/2, P(AB) = 1/6\nask: P(A + B)');
  const a = v.asks[0];
  assert.equal(String(a.value), '2/3');
  assert.equal(judgeProb(a, '2/3').ok, true);
  assert.equal(judgeProb(a, '4/6').ok, true);
  assert.equal(judgeProb(a, '0.6667').ok, true, '四位小数算对');
  assert.equal(judgeProb(a, '0.67').ok, false);
  assert.match(judgeProb(a, '0.67').text, /分数/);
  assert.equal(judgeProb(a, '1/2').ok, false);
  assert.equal(judgeProb(a, 'abc').ok, null);
  assert.equal(judgeProb(a, '').ok, null);
  const w = parseVenn('sets: A B\ngiven: P(A) = 0.5, P(B) = 0.4, P(AB) = 0.2\nask: P(A + B)').asks[0];
  assert.equal(judgeProb(w, '0.7').ok, true);
  assert.equal(judgeProb(w, '70%').ok, true);
  assert.equal(judgeProb(w, '0.9').ok, false);
  assert.match(judgeProb(w, '0.9').text, /P\(A\) \+ P\(B\)/, '直接把两个概率加起来的：说一句减去重复的');
});

test('每一块的名字、读数', () => {
  assert.equal(atomName(1, ['A', 'B']), "AB'");
  assert.equal(atomName(0, ['A', 'B']), "A'B'");
  assert.equal(atomName(7, ['A', 'B', 'C']), 'ABC');
  const v = parseVenn('sets: A B\ngiven: P(A) = 0.5, P(B) = 0.4\nfind: P(A), P(A + B), P(A | B)');
  assert.deepEqual(v.problems, [], 'find 定不下来不算写错：读数里照实写');
  assert.match(readoutOf(v.finds[0], v), /= \\frac\{1\}\{2\}/);
  assert.match(readoutOf(v.finds[1], v), /条件不够.*\\frac\{1\}\{2\}.*\\frac\{9\}\{10\}/);
  assert.match(readoutOf(v.finds[2], v), /条件不够/);
});
