// 第九轮第 1 批：下课后的助手（kit/src/aide/after.js）：一次写复盘、归类、事实、学生卡
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AFTER_VERSION, AFTER_HEAD, needsAfter, afterPrompt, splitAfter, parseAfter } from '../kit/src/aide/after.js';
import { needsDebrief, debriefPrompt } from '../kit/src/memory/debrief.js';
import { needsSkills } from '../kit/src/memory/skills.js';

const closed = { id: 'c-20261114-1', kind: 'stage', status: 'closed', report: { at: 5, items: 2 }, aide: 1, block: 'DS-L8.2.1' };
const items = [{ key: 'S3', q: '稳定吗', seq: '×✓', outcome: 'ok', tags: ['DS-L8.2.1'] }, { key: 'S5', q: '比较次数', seq: '✓', outcome: 'first', tags: ['DS-L8.2.1'] }];

const REPLY = `## 复盘
误解｜还在｜把稳定当成后进先出｜#3 学生答「后进先出」
开场｜先测稳定｜给 (5,3,5′,1) 问稳定吗

## 归类
point DS-L8.2.1#stable 稳定性的定义
item 1 DS-L8.2.1#stable
item 2 DS-L8.2.1#stable

## 事实
\`\`\`\`board memo
error q="稳定吗" mine="后进先出" step="稳定的定义" block=DS-L8.2.1 basis=S3
lesson id=T-1 again="又没等学生"
\`\`\`\`

## 卡 DS-L8.2.1
概括｜稳定性还没过关
误解｜把稳定当后进先出

## 卡 DS-L9.9.9
概括｜不该写这张
`;

test('要不要做：只做这一轮以后开的舞台课，下了课、报告写好、没做过或版本旧、没连着失败三次', () => {
  assert.equal(needsAfter(closed), true);
  assert.equal(needsAfter({ ...closed, aide: undefined }), false);
  assert.equal(needsAfter({ ...closed, after: { v: AFTER_VERSION, at: 1 } }), false);
  assert.equal(needsAfter({ ...closed, after: { v: AFTER_VERSION - 1, at: 1 } }), true);
  assert.equal(needsAfter({ ...closed, after: { fails: 3 } }), false);
  assert.equal(needsAfter({ ...closed, report: { at: 5, items: 2, provisional: true } }), false);
});

test('助手做的课，旧的复盘和归类不再各做一次', () => {
  assert.equal(needsDebrief(closed), false);
  assert.equal(needsSkills(closed), false);
  assert.equal(needsDebrief({ ...closed, aide: undefined }), true);
});

test('分节', () => {
  const s = splitAfter(REPLY);
  assert.match(s.debrief, /误解｜还在/);
  assert.match(s.skills, /item 1/);
  assert.match(s.facts, /error q=/);
  assert.deepEqual(Object.keys(s.cards).sort(), ['DS-L8.2.1', 'DS-L9.9.9']);
});

test('读回：复盘、归类照原来的读法；事实只收那几种；只收给了的卡', () => {
  const r = parseAfter(REPLY, { items, blocks: ['DS-L8.2.1'], catalog: {}, weaknesses: [], cardIds: new Set(['DS-L8.2.1']) });
  assert.equal(r.debrief.mis.length, 1);
  assert.equal(r.skills.items.length, 2);
  assert.deepEqual(r.memo.map((e) => e.kind), ['error']);
  assert.ok(r.problems.some((p) => /lesson/.test(p)));
  assert.deepEqual(Object.keys(r.cards), ['DS-L8.2.1']);
  assert.ok(r.problems.some((p) => /DS-L9\.9\.9/.test(p)));
});

test('提示词：有开头、四节、不用他她；复盘的判法和原来的复盘提示词同一份', () => {
  const p = afterPrompt({ session: closed, transcript: '#3【学生】后进先出', report: '1. 稳定吗 ×✓', weaknesses: [], items, curriculum: [{ id: 'DS-L8.2.1', title: '直接插入排序' }], catalog: {}, cards: [{ id: 'DS-L8.2.1', text: '概括｜旧的' }] });
  assert.ok(p.startsWith(AFTER_HEAD));
  for (const h of ['## 复盘', '## 归类', '## 事实', '## 卡 DS-L8.2.1']) assert.ok(p.includes(h), h);
  assert.ok(!/[他她](?!们)/.test(p));
  const old = debriefPrompt({ session: closed, transcript: 'x' });
  const judge = old.slice(old.indexOf('## 怎么判'), old.indexOf('## 输出'));
  assert.ok(p.includes(judge.trim()));
});
