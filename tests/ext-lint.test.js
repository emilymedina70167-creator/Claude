// 外部的预检 --lint（需求 R4）：不开浏览器只查写法
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintTurn, blockNames, fencesOf } from '../tools/ext-lint.js';

const F = '````', f = '```';
const seg = (op, id, body) => `${F}board ${op} id=${id}\n${body}\n${F}`;

test('组件名从源码里读全', async () => {
  const n = await blockNames();
  for (const k of ['answer', 'steps', 'scene', 'matrix', 'let', 'key', 'hint', 'sort', 'elim', 'cloze', 'link', 'gloss']) assert.ok(n.has(k), k);
  assert.ok(!n.has('ENGINES') && !n.has('callouts'));
});

test('查出：看不懂的指令、重复的段、拼错的组件、重复的组件 id、算不出的 \\calc、指不到的 target', async () => {
  const names = await blockNames();
  const prior = [seg('new', 'b1', `${f}answer\nid: q1\nq: 1\nanswer: 1\n${f}`)];
  const text = [
    '说一句',
    seg('add', 'b1', 'x'),
    seg('add', 'b2', `${f}anser\nid: q2\n${f}\n${f}answer\nid: q1\nq: $\\calc{1/0}$\nanswer: 1\n${f}`),
    `${F}board mark target=nope\n${F}`,
    `${F}board foo\n${F}`,
    `${F}board figure target=q1 set x=1\n${F}`,
  ].join('\n');
  const msgs = lintTurn({ prior, text, names }).problems.map((p) => p.msg).join('\n');
  assert.match(msgs, /看不懂的指令「foo」/);
  assert.match(msgs, /b1 已经用过了/);
  assert.match(msgs, /是不是想写 answer/);
  assert.match(msgs, /q1」已经在 b1 里用过了/);
  assert.match(msgs, /除以 0/);
  assert.match(msgs, /板上没有 nope/);
  assert.doesNotMatch(msgs, /板上没有 q1/);
});

test('let 的量给后面的 \\calc 用', async () => {
  const names = await blockNames();
  const text = seg('new', 'b1', `${f}let\na = 3\n${f}\n\n结果 $\\calc{a*2}$`);
  assert.deepEqual(lintTurn({ text, names }).problems, []);
});

test('fencesOf：没闭合的组件报出来', () => {
  assert.equal(fencesOf('```answer\nid: q\n').at(0).unclosed, true);
});
