// 第十一轮 B1：班主任每一轮的说明（kit/src/head/context.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headSystem, fitHistory, nextChatId, chatTitle, HEAD, HEAD_MAX } from '../kit/src/head/context.js';

const asks = [
  { id: 'A-1', text: '开场复习最多两三句', quotes: [{ ev: 'e1', text: '只做2-3句就行啊' }], status: 'active', broken: 0 },
  { id: 'A-2', text: '画面上的东西不能重叠', quotes: [{ ev: 'e2', text: '别重叠' }, { ev: 'e3', text: '你重叠这件事情要犯几次？' }], status: 'active', broken: 2 },
  { id: 'A-3', text: '旧的', quotes: [], status: 'replaced' },
];

test('要求全文在前，犯过的在前，不用了的不带', () => {
  const s = headSystem({ asks, today: '2026-11-15' });
  const i1 = s.indexOf('开场复习最多两三句');
  const i2 = s.indexOf('画面上的东西不能重叠');
  assert.ok(i2 > 0 && i1 > i2, '犯过的在前');
  assert.ok(s.includes('老师犯过 2 次'));
  assert.ok(!s.includes('旧的'));
  assert.ok(s.indexOf('学生的要求') < s.indexOf('## 怎么查'));
});

test('预测分、下一步、这一周、考试都写上', () => {
  const s = headSystem({
    asks, today: '2026-11-15', examDays: 401,
    target: { school: '南京大学', dept: '智能科学与技术学院', majorCode: '11408', date: '2027-12-21', goal: 410 },
    forecast: { total: { median: 251.4, lo: 200, hi: 300 }, pass: 0.03, measured: 0.15, goal: 410, subjects: [{ label: '408', median: 60, lo: 40, hi: 80, target: 110 }] },
    next: { cs: [{ title: '页式存储', why: '还能多拿 4.2 分；考过 9 年' }] },
    week: [{ text: '连着学了 3 天' }],
  });
  for (const x of ['约 251 分', '200–300', '约 3%', '约 2 成是测出来的', '408：约 60', '页式存储', '连着学了 3 天', '还有 401 天', '南京大学']) assert.ok(s.includes(x), x);
});

test('不用「他」「她」称呼学生', () => {
  const s = headSystem({ asks, today: '2026-11-15' });
  assert.ok(!/[他她]/.test(s.replace(/其他|他人/g, '')), s.match(/.{10}[他她].{10}/)?.[0]);
});

test('整份放不下先截简报，不超过上限', () => {
  const big = '目录一行\n'.repeat(30000);
  const s = headSystem({ asks, today: '2026-11-15', briefs: [{ space: 'math', text: big }, { space: 'cs', text: '短的 408 简报' }, { space: 'en', text: big }] });
  assert.ok(new TextEncoder().encode(s).length <= HEAD_MAX);
  assert.ok(s.includes('短的 408 简报'));
  assert.ok(s.includes('放不下，后面截掉了'));
  assert.ok(s.includes('## 怎么改记忆'), '改记忆的说明一定在');
});

test('只认 Opus 5.5 high', () => {
  assert.equal(HEAD.model, 'claude-opus-5-5');
  assert.equal(HEAD.effort, 'high');
});

test('fitHistory：说明在第一条、最后是学生；太长丢最早的', () => {
  const h = [{ role: 'me', text: 'a'.repeat(1000) }, { role: 'head', text: 'b'.repeat(1000) }, { role: 'me', text: 'c' }, { role: 'head', text: 'd' }, { role: 'me', text: 'e' }, { role: 'head', text: 'f' }, { role: 'me', text: 'g' }];
  const r = fitHistory('说明', h, { maxBytes: 500 });
  assert.equal(r.turns[0].content, '说明');
  assert.equal(r.turns.at(-1).content, 'g');
  assert.ok(r.dropped >= 2);
  assert.equal(r.turns.find((t, i) => i > 1)?.role, 'user');
  assert.throws(() => fitHistory('x', [{ role: 'me', text: 'q' }, { role: 'head', text: 'a' }]));
});

test('编号和标题', () => {
  assert.equal(nextChatId([], '2026-11-15'), 'h-20261115-1');
  assert.equal(nextChatId([{ id: 'h-20261115-1' }, { id: 'h-20261115-3' }, { id: 'h-20261114-9' }], '2026-11-15'), 'h-20261115-4');
  assert.equal(chatTitle('我现在 408 学到哪了，接下来两周怎么排比较好'), '我现在 408 学到哪了，接下来两周怎么');
  assert.equal(chatTitle('  '), '新对话');
});
