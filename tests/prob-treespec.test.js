// 视觉交互第 4 批 Task 4 的纯函数部分：概率树组件的写法、问的量、能空的地方（kit/src/prob/treespec.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePtree, termOf, valueOf, judgeTreeProb, blankOf } from '../kit/src/prob/treespec.js';
import { moveBoundary } from '../kit/src/prob/tree.js';

const S = (x) => String(x);
const FACTORY = `title: 三个厂的次品
A1 0.5: B 0.02
A2 0.3: B 0.01
A3 0.2: B 0.03
labels: A1=甲厂 A2=乙厂 A3=丙厂 B=次品
drag: on
ask: P(B)
ask: "抽到次品，它是甲厂的概率" P(A1 | B)
note: 拖面积图的分界试试`;

test('写法：树的行和字段混着写；labels、drag、ask（几条）', () => {
  const p = parsePtree(FACTORY);
  assert.deepEqual(p.problems, []);
  assert.equal(p.tree.form, 'bayes');
  assert.equal(p.fields.title, '三个厂的次品');
  assert.equal(p.drag, true);
  assert.deepEqual(p.labels, { A1: '甲厂', A2: '乙厂', A3: '丙厂', B: '次品' });
  assert.equal(p.asks.length, 2);
  assert.equal(p.asks[0].q, '$P(B)$ 是多少？');
  assert.equal(p.asks[1].q, '抽到次品，它是甲厂的概率');
  assert.equal(S(valueOf(p.asks[0].term, p.tree).value), '19/1000');
  assert.equal(S(valueOf(p.asks[1].term, p.tree).value), '10/19');
});

test('问的量：先验、条件、联合、全概率、后验、对立；写法几种都认', () => {
  const p = parsePtree(FACTORY), t = p.tree;
  const v = (src) => { const r = valueOf(termOf(src, t), t); return r.status === 'ok' ? S(r.value) : r.status; };
  assert.equal(v('P(A2)'), '3/10');
  assert.equal(v('P(B | A2)'), '1/100');
  assert.equal(v('P(~B | A2)'), '99/100');
  assert.equal(v("P(B' | A2)"), '99/100');
  assert.equal(v('P(A2 B)'), '3/1000');
  assert.equal(v('P(A2B)'), '3/1000');
  assert.equal(v('P(A2 ∩ B)'), '3/1000');
  assert.equal(v('P(B)'), '19/1000');
  assert.equal(v('P(~B)'), '981/1000');
  assert.equal(v('P(A3 | B)'), '6/19');
  assert.equal(v('P(A3 | ~B)'), '194/981');
  assert.equal(v('P(A1 + A2 | B)'), '13/19', '几个原因并起来');
  assert.equal(termOf('P(A1 | B)', t).tex, 'P(A_1 \\mid B)');
  assert.equal(termOf('P(~B | A2)', t).tex, 'P(\\overline{B} \\mid A_2)');
  assert.throws(() => termOf('P(C)', t), /没有叫 C 的/);
  assert.throws(() => termOf('A1', t), /P\(/);
  // 分母是 0
  const z = parsePtree('A1 0.5: B 0\nA2 0.5: B 0').tree;
  assert.equal(valueOf(termOf('P(A1 | B)', z), z).status, 'undefined');
});

test('多层的树：按位置写（逗号隔开，_ 是哪个都行）', () => {
  const p = parsePtree('红 3/5\n  红 2/4\n  白 2/4\n白 2/5\n  红 3/4\n  白 1/4\nask: P(_, 红)\nask: "两次都是红" P(红, 红)\nask: P(红, _ | _, 红)');
  assert.deepEqual(p.problems, []);
  assert.equal(p.tree.form, 'levels');
  const vals = p.asks.map((a) => S(valueOf(a.term, p.tree).value));
  assert.deepEqual(vals, ['3/5', '3/10', '1/2']);
  assert.equal(p.asks[0].term.tex, 'P(\\text{第 2 步是红})');
  assert.match(parsePtree('红 3/5\n  红 2/4\n  白 2/4\n白 2/5\n  红 3/4\n  白 1/4\nask: P(红)').problems.join('；'), /逗号/, '名字在两层都有：要按位置写');
  assert.match(parsePtree('红 3/5\n  红 2/4\n  白 2/4\n白 2/5\n  红 3/4\n  白 1/4\ndrag: on').problems.join('；'), /drag/, '多层的树没有面积图，不能拖');
});

test('写错的报出来：数不对、ask 读不懂、不认识的字段、labels 的名字没有', () => {
  assert.match(parsePtree('A1 0.5: B 0.02\nA2 0.3: B 0.01').problems.join('；'), /加起来是 4\/5/);
  assert.match(parsePtree('A1 0.5: B 0.02\nA2 0.5: B 0.01\nask: P(C)').problems.join('；'), /ask.*没有叫 C/);
  assert.match(parsePtree('A1 0.5: B 0.02\nA2 0.5: B 0.01\nfoo: 1').problems.join('；'), /foo/);
  assert.match(parsePtree('A1 0.5: B 0.02\nA2 0.5: B 0.01\nlabels: C=丙').problems.join('；'), /labels.*C/);
  assert.match(parsePtree('title: 空的').problems.join('；'), /概率树/);
  assert.match(parsePtree('A1 0.5: B 0\nA2 0.5: B 0\nask: P(A1 | B)').problems.join('；'), /没有定义/);
});

test('填概率的判法：认出条件写反、没除、拿先验当后验、条件概率直接相加', () => {
  const p = parsePtree(FACTORY), t = p.tree;
  const post = p.asks[1], total = p.asks[0];
  assert.equal(judgeTreeProb(post.term, t, '10/19').ok, true);
  assert.equal(judgeTreeProb(post.term, t, '0.5263').ok, true);
  assert.deepEqual([judgeTreeProb(post.term, t, '0.02').ok, judgeTreeProb(post.term, t, '0.02').tag], [false, 'cond-reversed']);
  assert.equal(judgeTreeProb(post.term, t, '0.01').tag, 'joint-for-cond');
  assert.equal(judgeTreeProb(post.term, t, '1/2').tag, 'prior-for-post');
  assert.equal(judgeTreeProb(total.term, t, '0.019').ok, true);
  assert.equal(judgeTreeProb(total.term, t, '0.06').tag, 'sum-cond');
  assert.equal(judgeTreeProb(total.term, t, '0.02').tag, 'mean-cond');
  assert.equal(judgeTreeProb(total.term, t, '0.5').ok, false);
  assert.equal(judgeTreeProb(total.term, t, 'x').ok, null);
  // 树拖过以后按新的数判
  const t2 = moveBoundary(t, 0, 0.4);
  assert.equal(judgeTreeProb(total.term, t2, '0.019').ok, false);
  assert.equal(S(valueOf(total.term, t2).value), '9/500');
});

test('树上能空的地方：对立那一支、叶子上的乘积、最后一个先验；给的条件不能空', () => {
  const p = parsePtree(`${FACTORY}\nblank: A2:~B, A1 B, A3`);
  assert.deepEqual(p.problems, []);
  assert.deepEqual(p.blanks.map((b) => [b.where, S(b.value(p.tree))]), [['edge:1:not', '99/100'], ['leaf:0:yes', '1/100'], ['prior:2', '1/5']]);
  assert.match(parsePtree(`${FACTORY}\nblank: A2:B`).problems.join('；'), /给的条件/);
  assert.match(parsePtree(`${FACTORY}\nblank: A1, A3`).problems.join('；'), /先验只能空一个/);
  assert.equal(blankOf('A2 ~B', p.tree).where, 'leaf:1:not');
  assert.throws(() => blankOf('A9', p.tree), /没有叫 A9/);
});
