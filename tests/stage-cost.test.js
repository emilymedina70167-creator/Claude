// 舞台主线的尺子（tools/stage-cost-lib.js）：老师一轮写的行里，哪些是「教」、哪些是「搭」；读一节真课的记录
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS } from '../kit/src/stage/script.js';
import { TYPES, CREATE } from '../kit/src/stage/types/index.js';
import { CLASS_OF, MAKERS, classifyRound, costOfTry, sumCost, rankBuild } from '../tools/stage-cost-lib.js';

const rowsOf = (list, names = new Set()) => classifyRound(list.map((src, i) => ({ line: i + 1, src })), names);

test('每条指令都归了类（加了指令不归类这里会红）', () => {
  const all = new Set([...COMMANDS, ...Object.keys(CREATE), ...Object.values(TYPES).flatMap((t) => Object.keys(t.commands || {}))]);
  const missing = [...all].filter((c) => !CLASS_OF[c] && !MAKERS.has(c));
  assert.deepEqual(missing, []);
});

test('L3 第 7 幕那一轮：藏着的矩阵是搭，open / say / goal 是教', () => {
  const rows = rowsOf([
    'vec q a = 1 1 color=g1', 'matrix Va = {q.a} hide=on', 'matrix Wa = {J Va} hide=on',
    'matrix Dg = {Va.1,1} 0 / 0 {Va.1,1} hide=on', 'matrix R = {Dg^-1 Wa} hide=on',
    'open q.a', 'say "两边各把特征方向找全。"', 'goal g1 "找出两条" when="det(Ka) = 0" collect=R n=2', '@g1 span q a stay',
  ], new Set(['q', 'J']));
  assert.deepEqual(rows.map((r) => r.cls), ['例子', '藏着的辅助', '藏着的辅助', '藏着的辅助', '藏着的辅助', '交给学生', '说问', '交给学生', '指给学生看']);
  assert.deepEqual(rows[4].uses, ['^-1', '乘']);
  const sum = sumCost([rows]);
  assert.equal(sum.build.lines, 4);
  assert.ok(sum.share > 0.3 && sum.share < 0.6, `搭占 ${sum.share}`);
});

test('同名重造、收拾、写死的数', () => {
  const rows = rowsOf(['array a = 3 1 2', 'unlabel n', 'array a = 1 2 3', 'label c a "逆序对 2 个"', 'label d a "逆序对 {inv(a)} 个"']);
  assert.deepEqual(rows.map((r) => r.cls), ['例子', '收拾', '同名重造', '指给学生看', '指给学生看']);
  assert.deepEqual(rows.map((r) => r.suspect), [false, false, false, true, false]);
  assert.deepEqual(rows.map((r) => r.build), [false, true, true, false, false]);
});

test('& 开头的、@ 预写的照后面那条指令归；平面里的箭头按「平面.名字」记', () => {
  const rows = rowsOf(['& paint a.2 a.7 g2', '@a.done say "排好了。"', '@ask.right remove c', 'vec p v = 1 0', 'vec p v = 2 1'], new Set(['a', 'p', 'c']));
  assert.deepEqual(rows.map((r) => r.cls), ['指给学生看', '说问', '收拾', '例子', '同名重造']);
  assert.deepEqual(rows.map((r) => r.cmd), ['paint', 'say', 'remove', 'vec', 'vec']);
});

test('试演文件：学生的行切开一轮一轮，注释不算；排行榜按字节排', () => {
  const text = '# 注释\nmatrix A = 1 2 / 3 4\nmatrix H = {A^-1} hide=on\nsay "看"\n学生: next\nremove H\nsay "好"\n';
  const { rounds } = costOfTry(text);
  assert.equal(rounds.length, 2);
  const rank = rankBuild([{ file: 'x.txt', rounds }]);
  assert.equal(rank[0].pattern, '藏着的辅助·matrix（^-1）');
  assert.equal(rank[1].pattern, '收拾·remove');
  assert.equal(rank[0].examples[0].line, 3);
  assert.equal(rank[0].examples[0].file, 'x.txt');
});
