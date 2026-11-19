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

// 计划 4：408、英语的样板当一轮外部写的写进来，预检干净；改坏三处（example 不满足 if、拼错的量、两个按钮写了三个）各报一条
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('board check 的 408、英语样板：ext-check --lint 退出码 0；改坏三处各报一条', async () => {
  const names = await blockNames();
  const { DEV_CHECK_408, DEV_CHECK_EN } = await import('../kit/src/check/devsample.js');
  const dir = mkdtempSync(join(tmpdir(), 'ext-lint-'));
  const run = (text) => { const f = join(dir, `t${Math.random().toString(36).slice(2)}.txt`); writeFileSync(f, text); return spawnSync(process.execPath, ['tools/ext-check.mjs', '--next', f, '--lint'], { encoding: 'utf8' }); };
  const ok = run(`这一轮做个检验。\n\n${DEV_CHECK_408}\n\n${DEV_CHECK_EN}`);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /没有问题/);
  const errs = (text) => lintTurn({ text, names }).problems.filter((p) => p.level !== 'hint');
  assert.deepEqual(errs(DEV_CHECK_408), []);
  assert.deepEqual(errs(DEV_CHECK_EN), []);
  const ex = errs(DEV_CHECK_408.replace("example: A=4 7 4 1 2 5 7 8 P=4 4'", 'example: A=4 7 4 1 2 5 7 8 P=7 7'));
  assert.equal(ex.length, 1, JSON.stringify(ex));
  assert.match(ex[0].msg, /p2 的 example 不满足 if2/);
  const meas = errs(DEV_CHECK_408.replace('if: r.unstable >= 1', 'if: r.fault >= 1'));
  assert.equal(meas.length, 1, JSON.stringify(meas));
  assert.match(meas[0].msg, /r\.fault 不是 sort 的量/);
  const three = DEV_CHECK_EN.replace('options: 谓语 | 非谓语', 'options: 谓语 | 非谓语 | 都不是');
  const opt = errs(three);
  assert.equal(opt.length, 1, JSON.stringify(opt)); // 读不懂的那道题不再连带报「没写这道题」「retry 没排进去」
  assert.match(opt[0].msg, /p3：options: 只收两个/);
  const bad = run(three);
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /1 处问题/);
});
