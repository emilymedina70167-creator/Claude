// 矛盾修复 T2：概率四个组件的写法照一套（ask 的三种写法、事件的写法、大分母什么时候写小数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAsk } from '../kit/src/prob/num.js';
import { parseVenn } from '../kit/src/prob/vennspec.js';
import { parsePtree } from '../kit/src/prob/treespec.js';
import { parseJointBlock } from '../kit/src/prob/jointspec.js';
import { parseSim } from '../kit/src/prob/simspec.js';

test('ask 的写法：「"题目" 式子」「"题目" = 式子」「题目 => 式子」「式子」四个组件都认', () => {
  assert.deepEqual(splitAsk('"求 P" P(A)'), { q: '求 P', expr: 'P(A)' });
  assert.deepEqual(splitAsk('“求 P” = P(A)'), { q: '求 P', expr: 'P(A)' });
  assert.deepEqual(splitAsk('求 P => P(A)'), { q: '求 P', expr: 'P(A)' });
  assert.deepEqual(splitAsk('P(A)'), { q: '', expr: 'P(A)' });
});

test('venn、ptree、joint 认 "题目" = 式子', () => {
  const v = parseVenn('sets: A B\ngiven: P(A) = 0.5, P(B) = 0.4, P(AB) = 0.2\nask: "并的概率" = P(A + B)');
  assert.deepEqual(v.problems, []);
  assert.equal(v.asks[0].q, '并的概率');
  const t = parsePtree('A1 0.5: B 0.02\nA2 0.5: B 0.04\nask: "后验" = P(A1 | B)');
  assert.deepEqual(t.problems, []);
  assert.equal(t.asks[0].q, '后验');
  const j = parseJointBlock('X: 0 1\nY: 0 1\np: 0.1 0.2; 0.3 0.4\nask: "期望" = E(X)');
  assert.deepEqual(j.problems, []);
  assert.equal(j.asks[0].q, '期望');
});

test('sim 认 "题目" 式子、题目 => 式子，只写式子时题目自己补', () => {
  for (const src of ['ask: "均值" mu', 'ask: 均值 => mu', 'ask: "均值" = mu']) {
    const s = parseSim(`draw: N(2, 1)\nn: 10\n${src}`);
    assert.deepEqual(s.problems, [], src);
    assert.equal(s.asks[0].q, '均值', src);
  }
  const s = parseSim('draw: N(2, 1)\nn: 10\nask: mu');
  assert.deepEqual(s.problems, []);
  assert.match(s.asks[0].q, /mu/);
});

import { qText, qTeX, qShow, BIG_DEN } from '../kit/src/prob/num.js';
import { readQ } from '../kit/src/prob/num.js';
test('大分母什么时候写小数：读数、题面、表、树一个门槛', () => {
  const q = readQ('5/1296'); // 掷四次骰子
  assert.equal(qText(q), '5/1296');
  assert.equal(qShow(q), '5/1296');
  assert.match(qTeX(q), /frac\{5\}\{1296\}/);
  const big = readQ(`1/${BIG_DEN + 1}`);
  assert.ok(!/\//.test(qText(big)) && !/frac/.test(qTeX(big)) && !/\//.test(qShow(big)), '超过门槛三处都写小数');
});

import { termOf, valueOf } from '../kit/src/prob/treespec.js';
import { parseTree } from '../kit/src/prob/tree.js';
import { parseEvent } from '../kit/src/prob/sets.js';
test('ptree 的事件写法照 venn：差 −、全集 Ω、U 是并、\\setminus', () => {
  const t = parseTree('A1 0.5: B 0.02\nA2 0.5: B 0.04');
  const v = (src) => valueOf(termOf(src, t), t).value.toString();
  assert.equal(v('P(Ω)'), '1');
  assert.equal(v('P(A1 U B)'), v('P(A1 + B)'));
  assert.equal(v('P(B - A1)'), v('P(A2 B)'), '差：B 发生、A1 不发生');
  assert.equal(v('P(B \\setminus A1)'), v('P(A2 B)'));
  assert.equal(v('P(A_1, B)'), v('P(A1 B)'), '页面自己显示的 A_1 和逗号照旧认');
  assert.throws(() => termOf('P(C)', t), /没有叫 C 的/);
});
test('venn 也认 A_1、A_{1} 和逗号写的交（ptree 以前就认）', () => {
  const names = ['A1', 'A2'];
  assert.equal(parseEvent('A_1 A_{2}', names).mask, parseEvent('A1 A2', names).mask);
  assert.equal(parseEvent('A1, A2', names).mask, parseEvent('A1 A2', names).mask);
});
