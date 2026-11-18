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

import { checkers } from '../tools/ext-lint.js';
test('stage / widget 段的写法也查', async () => {
  const names = await blockNames();
  const extra = await checkers();
  const text = '````board stage id=s1\narray a = 3 1 2\nopen a fly\n````\n````board widget id=w1\nla.say((\n````';
  const msgs = lintTurn({ text, names, ...extra }).problems.map((p) => p.msg).join('\n');
  assert.match(msgs, /没有「fly」/);
  assert.match(msgs, /JS 写错了/);
  assert.deepEqual(lintTurn({ text: '````board stage id=s2\narray a = 3 1 2\nopen a move\n````', names, ...extra }).problems, []);
});

// dr-batch4 第 3 条：queue 里的 derive 写了页面不认的 E(2)；预备板里的组件能当 target；ext-check 把预备板照 new 画一遍
import { deriveDoProblems } from '../tools/ext-lint.js';
import { queuedBoards, extClass } from '../tools/ext-class.js';
test('预检：queue 里的 derive、预备板里的组件', async () => {
  const names = await blockNames();
  const bad = '````board queue id=b9 title="下一块" after=q1:right\n```derive\nid: dd1\nmode: do\nstart: (A-E(2))^2\n```\n````\n\n````board react target=dd1\ndone: 好\n````';
  const r = lintTurn({ text: bad, names });
  assert.ok(r.problems.some((p) => /单位阵/.test(p.msg)), JSON.stringify(r.problems));
  assert.ok(!r.problems.some((p) => /板上没有 dd1/.test(p.msg)));
  assert.deepEqual(deriveDoProblems('mode: do\nvars: A=mat(2,2)\nstart: (A-E)^2'), []);
  assert.equal(queuedBoards(bad)[0].id, 'b9');
  const spec = extClass({ next: bad });
  assert.match(spec.turns.at(-1).teacher, /^````board new id=b9 title="下一块"\n```derive/);
});

// dr-batch4 第 5 条：出题提示（只提醒，不算写错）
test('出题提示：没写预案、正确选项长、露答案、能绕过前面那步', async () => {
  const names = await blockNames();
  const F3 = '```';
  const text = `\`\`\`\`board new id=b1 title="t"\n${F3}answer\nid: a1\nq: 2+3 等于几\nanswer: 5\n${F3}\n${F3}quiz\nid: z1\nq: 选一个\n- [x] 因为矩阵乘法一般不满足交换律所以不能这样\n- [ ] 能\n- [ ] 不一定\n${F3}\n${F3}quiz\nid: z2\nq: 上面那题得 5，对吗\n- [x] 5\n- [ ] 6\n${F3}\n\`\`\`\`\n\n\`\`\`\`board react target=a1\nwrong: 再想想\n\`\`\`\``;
  const r = lintTurn({ text, names });
  const hints = r.problems.filter((p) => p.level === 'hint').map((p) => p.msg).join('\n');
  assert.doesNotMatch(hints, /a1 没写预案/);
  assert.match(hints, /z1 没写预案/);
  assert.match(hints, /长得多/);
  assert.match(hints, /绕过前面那步/);
  assert.ok(!r.problems.some((p) => p.level !== 'hint'), JSON.stringify(r.problems));
});

// 计划 2：board check 的预检（写法、example 自检、retry 至少 2 道）
test('board check：example 不满足、retry 只有一道都报；写对的不报', async () => {
  const names = await blockNames();
  const { DEV_CHECK } = await import('../kit/src/check/devsample.js');
  assert.deepEqual(lintTurn({ text: DEV_CHECK, names }).problems.filter((p) => /check/.test(p.where)), []);
  const bad = DEV_CHECK.replace('example: A=[[1,0],[0,0]] B=[[0,0],[0,1]]', 'example: A=[[1,0],[0,0]] B=[[1,0],[0,0]]');
  const p1 = lintTurn({ text: bad, names }).problems;
  assert.ok(p1.some((p) => /p1/.test(p.msg) && /if1/.test(p.msg)), JSON.stringify(p1));
  const one = DEV_CHECK.replace('retry: p3a, p3b', 'retry: p3a');
  const p2 = lintTurn({ text: one, names }).problems;
  assert.ok(p2.some((p) => /p3/.test(p.msg) && /至少 2 道/.test(p.msg)), JSON.stringify(p2));
});
