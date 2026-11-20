// 视觉交互第 4 批 Task 3：概率树的计算（kit/src/prob/tree.js，纯函数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTree, checkTree, treeNumbers, leaves, levelProb, moveBoundary, setCond } from '../kit/src/prob/tree.js';
import { readQ } from '../kit/src/prob/num.js';

const S = (x) => String(x);
const FACTORY = 'A1 0.5: B 0.02\nA2 0.3: B 0.01\nA3 0.2: B 0.03';

test('三个厂的次品率：全概率、贝叶斯都是精确的分数', () => {
  const t = parseTree(FACTORY);
  assert.equal(t.form, 'bayes');
  assert.deepEqual(t.causes.map((c) => c.name), ['A1', 'A2', 'A3']);
  assert.equal(t.effect, 'B');
  assert.deepEqual(checkTree(t), []);
  const n = treeNumbers(t);
  assert.deepEqual(n.joint.map(S), ['1/100', '3/1000', '3/500']);
  assert.deepEqual(n.jointNot.map(S), ['49/100', '297/1000', '97/500']);
  assert.equal(S(n.total), '19/1000');
  assert.equal(S(n.totalNot), '981/1000');
  assert.deepEqual(n.post.map(S), ['10/19', '3/19', '6/19']);
  assert.deepEqual(n.postNot.map(S), ['490/981', '33/109', '194/981']);
});

test('写法：分数、百分数、中文名字、全角冒号；写错的说怎么写', () => {
  const t = parseTree('甲厂 1/2： 次品 2%\n乙厂 1/2： 次品 4%');
  assert.equal(t.effect, '次品');
  assert.equal(S(treeNumbers(t).total), '3/100');
  assert.throws(() => parseTree('A1 0.5 B 0.02'), /概率树/);
  assert.throws(() => parseTree('A1 x: B 0.02'), /概率要是一个数/);
  assert.throws(() => parseTree(''), /概率树/);
  assert.throws(() => parseTree('A1 0.5: B 0.02\nA2 0.5: C 0.1'), /同一个结果/);
});

test('检查：先验的和不是 1、概率出了 0 到 1、只有一支、名字重了', () => {
  assert.match(checkTree(parseTree('A1 0.5: B 0.02\nA2 0.3: B 0.01')).join('；'), /加起来是 4\/5，不是 1/);
  assert.match(checkTree(parseTree('A1 1.2: B 0.02\nA2 -0.2: B 0.01')).join('；'), /0 到 1/);
  assert.match(checkTree(parseTree('A1 1: B 0.02')).join('；'), /至少两支/);
  assert.match(checkTree(parseTree('A 0.5: B 0.02\nA 0.5: B 0.01')).join('；'), /名字重了/);
  assert.match(checkTree(parseTree('A1 0.5: B 1.5\nA2 0.5: B 0.01')).join('；'), /0 到 1/);
});

test('P(B) = 0 时后验没有定义；P(B) = 1 时另一边没有定义', () => {
  const z = treeNumbers(parseTree('A1 0.5: B 0\nA2 0.5: B 0'));
  assert.equal(S(z.total), '0');
  assert.equal(z.post, null);
  assert.deepEqual(z.postNot.map(S), ['1/2', '1/2']);
  const o = treeNumbers(parseTree('A1 0.5: B 1\nA2 0.5: B 1'));
  assert.equal(o.postNot, null);
});

test('缩进写的多层树：不放回地摸两次', () => {
  const t = parseTree('红 3/5\n  红 2/4\n  白 2/4\n白 2/5\n  红 3/4\n  白 1/4');
  assert.equal(t.form, 'levels');
  assert.equal(t.depth, 2);
  assert.deepEqual(checkTree(t), []);
  const ls = leaves(t);
  assert.deepEqual(ls.map((l) => l.path.join('')), ['红红', '红白', '白红', '白白']);
  assert.deepEqual(ls.map((l) => S(l.p)), ['3/10', '3/10', '3/10', '1/10']);
  assert.equal(S(ls.reduce((s, l) => s.add(l.p), readQ('0'))), '1');
  assert.equal(S(levelProb(t, 1, '红')), '3/5', '第二次摸到红（抽签公平）');
  assert.equal(S(levelProb(t, 0, '白')), '2/5');
  // 某个结点下面几支加起来不是 1：说是哪个结点
  const bad = parseTree('红 3/5\n  红 2/4\n  白 1/4\n白 2/5\n  红 3/4\n  白 1/4');
  assert.match(checkTree(bad).join('；'), /红.*下面.*加起来是 3\/4/);
  // 三层、深浅不一的也行
  const three = parseTree('a 1/2\n  b 1/2\n    c 1\n  d 1/2\nb 1/2');
  assert.equal(three.depth, 3);
  assert.deepEqual(leaves(three).map((l) => `${l.path.join('')}=${l.p}`), ['abc=1/4', 'ad=1/4', 'b=1/2']);
  assert.throws(() => parseTree('  红 1/2\n白 1/2'), /缩进/);
});

test('拖面积图的分界：只动挨着的两块，和不变；取到 1/100', () => {
  const t = parseTree(FACTORY);
  const m = moveBoundary(t, 0, 0.4234); // A1 | A2 的分界拖到 0.42
  assert.deepEqual(m.causes.map((c) => S(c.p)), ['21/50', '19/50', '1/5']);
  assert.deepEqual(checkTree(m), []);
  // 拖过头：停在旁边那条分界上（那一块成 0，不成负数）
  assert.deepEqual(moveBoundary(t, 0, 0.95).causes.map((c) => S(c.p)), ['4/5', '0', '1/5']);
  assert.deepEqual(moveBoundary(t, 1, 0.1).causes.map((c) => S(c.p)), ['1/2', '0', '1/2']);
  // 原来的不动
  assert.equal(S(t.causes[0].p), '1/2');
  // 改一列里的条件概率
  const c = setCond(t, 2, 0.257);
  assert.equal(S(c.cond[2]), '13/50');
  assert.equal(S(setCond(t, 2, 1.4).cond[2]), '1');
  assert.equal(S(setCond(t, 2, -0.2).cond[2]), '0');
});
