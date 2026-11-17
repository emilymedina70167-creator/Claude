// 活板的教学检查（kit/src/huoban/check.js）：学生看到之前先查这道题出得对不对
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../kit/src/huoban/runtime.js';
import { checkBoard, checkText } from '../kit/src/huoban/check.js';

const run = (src) => { const rt = new Runtime(); rt.load(src); return checkBoard(rt); };
// not-telling（按常见错法也得同样答案）是真提醒，但和这几条测的东西无关，单独测
const codes = (list) => list.filter((x) => x.code !== 'not-telling').map((x) => x.code).sort();

const BELADY = `let refs = 1 2 3 4 1 2 5 1 2 3 4 5
let f = 3 拨 1..6
let r = paging(refs=refs, frames=f, algo=fifo)
draw r
缺页 {r.faults?} 次
goal faults(refs, f, fifo) > faults(refs, f - 1, fifo) => "多给一块反而多缺页"`;

test('出得对的板：没有要改的', () => {
  const r = run(BELADY);
  assert.deepEqual(codes(r), []);
  assert.ok(!r.some((x) => x.level === 'error'));
});

test('目标：一上来就做到了、怎么拨都做不到、不依赖学生能动的东西', () => {
  assert.deepEqual(codes(run(BELADY.replace('let f = 3 拨', 'let f = 4 拨'))), ['goal-already']);
  // 1..3 块里没有反例
  const r = run(BELADY.replace('拨 1..6', '拨 1..3'));
  assert.deepEqual(codes(r), ['goal-unreachable']);
  assert.match(r.find((x) => x.code === 'goal-unreachable').msg, /第 6 行.*试遍了（3 种）/);
  assert.deepEqual(codes(run('let a = 1\ngoal a > 2')), ['goal-fixed']);
});

test('拖向量也试：找得到特征方向就不报；转 90° 的矩阵找不到就报', () => {
  const eig = 'let A = [[2, 1], [1, 2]]\nlet x = [1, 0] 拖 吸附 0.5\ndraw A, x, A*x\ngoal par(A*x, x)';
  assert.deepEqual(run(eig), []);
  assert.deepEqual(codes(run(eig.replace('[[2, 1], [1, 2]]', '[[0, -1], [1, 0]]'))), ['goal-unreachable']);
});

test('句子：折法都试一遍', () => {
  const s = 'let s = 句子("The man [whom I met] [yesterday] is [my teacher].")\ndraw s\ngoal s.rest == "The man is my teacher."';
  assert.deepEqual(run(s), []);
  assert.deepEqual(codes(run(s.replace('The man is my teacher."', 'The man teacher."'))), ['goal-unreachable']);
});

test('空：答案已经写在板上是白问；算不出来要重写；问整个过程学生没法写', () => {
  assert.deepEqual(codes(run(`${BELADY}\n一共缺了 {r.faults} 次`)), ['giveaway']);
  assert.deepEqual(codes(run('let a = 1\n{zz?}')), []);// 名字不认识：读的时候就报（parseBoard），这里不重复
  assert.deepEqual(codes(run('let a = [[1, 2], [2, 4]]\n逆矩阵 {inv(a)?}')), ['blank-error']);
  assert.deepEqual(codes(run(`${BELADY}\n{r?}`)), ['blank-kind']);
});

test('按常见错法也得同样的答案：分不开，提醒换一组数', () => {
  // 这串在 3 块时 FIFO 和 LRU 缺页一样多
  const src = 'let v = 1 2 3 1 2 3\nlet r = paging(refs=v, frames=3, algo=fifo)\ndraw r\n缺页 {r.faults?} 次';
  const r = run(src);
  const t = r.find((x) => x.code === 'not-telling');
  assert.ok(t, checkText(r));
  assert.match(t.msg, /LRU/);
  assert.equal(t.level, 'warn');
});

test('when 永远出不来要提醒；学生没有能动手的地方只是注意', () => {
  assert.deepEqual(codes(run(`${BELADY}\nwhen f > 9：不会出现`)), ['when-never']);
  assert.deepEqual(codes(run('# 只是讲一句\n这是定义。')), ['no-action']);
  assert.match(checkText(run('# 只讲\n讲。')), /注意：这块板上学生没有能动手的地方/);
});
