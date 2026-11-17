// 班主任每一轮的说明（kit/src/head/context.js）：第十四轮起就是项目 Claude 的说明（project/system.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headSystem, fitHistory, nextChatId, chatTitle, HEAD, HEAD_MAX } from '../kit/src/head/context.js';

const facts = { today: '2026-11-17', version: 'v', examDays: 399, target: '南京大学智能科学与技术学院' };

test('班主任的说明就是项目 Claude 的说明：学生写的指令、它的笔记、学习台里有什么、工具', () => {
  const s = headSystem({ facts, instructions: '老师把内容讲透，我来学。', notes: [{ path: '学生/底子.md', text: '词汇是瓶颈', pin: true }], catalog: '- 教材：句句真研（2 条）', toolsDoc: '- search：按字找' });
  for (const x of ['老师把内容讲透，我来学。', '### 笔记：学生/底子.md', '词汇是瓶颈', '句句真研', 'search：按字找', '今天 2026-11-17']) assert.ok(s.includes(x), x);
  for (const x of ['班主任', '学生的要求', '开场简报', '怎么改记忆']) assert.ok(!s.includes(x), `还带着「${x}」`);
});

test('笔记本空着：照实写；不超过上限；不用「他」「她」', () => {
  const s = headSystem({ facts, instructions: '', notes: [], catalog: '', toolsDoc: '' });
  assert.match(s, /笔记本还是空的/);
  assert.match(s, /学生还没写/);
  assert.ok(new TextEncoder().encode(s).length <= HEAD_MAX);
  assert.ok(!/[他她]/.test(s));
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
