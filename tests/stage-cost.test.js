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

// —— 读一节真课（class_turns）——
import { lessonCost, featureUse, FEATURES, VALUE_TYPES } from '../tools/stage-cost-lib.js';
import { ANSWER_TYPES } from '../kit/src/stage/answer.js';

test('写法的清单：每条指令一项，ask value 的每种 type 一项（和 answer.js 同一份）', () => {
  assert.deepEqual(VALUE_TYPES, ANSWER_TYPES);
  const names = FEATURES.map((f) => f.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of ['swap', 'open', '@ask.right', '@名字.done', '{式子}', 'ask pick', 'ask value type=set', 'rank(', 'goal collect=']) assert.ok(names.includes(n), n);
});

test('一节真课：没演上的行、每轮等几秒、学生手上有没有事、一次没碰的写法', () => {
  const turns = [
    { seq: 1, role: 'claude', text: 'array a = 3 1 2\nsay "看这一排"\nask next "看清了点下面"', log: [], cost: { bytes: 9000, ms: 8000, first: 2000 } },
    { seq: 2, role: 'student', text: '学生点了「接着」', msg: '[学生] 点了「接着」\n\n[舞台现在]\n一排格子 a：3 1 2' },
    { seq: 3, role: 'claude', text: 'open a\ngoal g1 "排好" when="a sorted"\nlable x a "错字"\n\n```board memo\nnote 学生很快\n```', log: [], cost: { bytes: 9500, ms: 6000, first: 1500 } },
    { seq: 4, role: 'student', text: '学生做到了', msg: '[学生] 做到了 g1\n\n[上一轮没演的行]（写错了，页面跳过了，别的行照演）\n- 第 3 行「lable x a "错字"」：不认得 lable\n\n[舞台现在]\n…' },
    { seq: 5, role: 'system', kind: 'stale', discarded: true, text: '…', cost: { bytes: 1, ms: 99999 } },
    { seq: 6, role: 'claude', discarded: true, text: 'say "作废的一轮"', cost: { bytes: 1, ms: 99999 } },
  ];
  const r = lessonCost(turns);
  assert.equal(r.turns.length, 2);
  assert.deepEqual(r.turns.map((t) => t.lines), [3, 3]);
  assert.deepEqual(r.turns.map((t) => t.hands), [false, true]);
  assert.equal(r.turns[1].missed[0].src, 'lable x a "错字"');
  assert.match(r.turns[1].missed[0].error, /不认得 lable/);
  assert.equal(r.turns[1].played, 2);
  assert.equal(r.total.missed, 1);
  assert.equal(r.total.ms, 14000);
  assert.equal(r.total.first, 3500);
  assert.equal(r.talkRuns, 1);
  assert.equal(r.features.used.open, 1);
  assert.ok(r.features.unused.includes('@ask.right') && r.features.unused.includes('ask pick'));
  assert.ok(!r.features.unused.includes('ask next'));
});

test('写法用了几次：预写、跟着算的、量', () => {
  const { used, unused } = featureUse(['matrix A = 1 {k} / 0 1\n@g1 say "好"\n@A.done say "做完了"\n@ask.right say "对"\nlabel n A "秩 {rank(A)}"\n& glow A']);
  assert.equal(used['{式子}'], 2); // {k} 和 {rank(A)}
  assert.equal(used['@挑战'], 1);
  assert.equal(used['@名字.done'], 1);
  assert.equal(used['@ask.right'], 1);
  assert.equal(used['rank('], 1);
  assert.equal(used['& 一起演'], 1);
  assert.equal(used.say, 3);
  assert.ok(unused.includes('@名字.right'));
});
