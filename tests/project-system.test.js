// 项目 Claude 每一轮的说明（project/system.js、project/catalog.js，第十四轮）：事实、学生写的项目指令、它的笔记本、学习台里有什么、工具。
// 页面拼的那几段只写事实，不写做法（底线：不替它做任何事）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSystem, FORBIDDEN, identityText } from '../kit/src/project/system.js';
import { catalogText } from '../kit/src/project/catalog.js';

const facts = { today: '2026-11-17', version: '2026-11-17b', examDays: 399, target: '南京大学智能科学与技术学院，目标 410 分' };
const base = { facts, instructions: '老师把内容讲透，我来学。必须用中文。', notes: [], catalog: '- 教材：线代 30 讲（120 条）', toolsDoc: '- read：按路径读一条', sections: [{ title: '黑板现状', text: '当前板是空的' }], max: 160 * 1024 };
const pageParts = (r) => r.text.replace(base.instructions, '').replace(/### 笔记：[\s\S]*?(?=\n# |$)/g, '').replace(/# 黑板现状[\s\S]*$/, '');

test('先后：事实 → 学生写的项目指令（原样）→ 笔记本 → 学习台里有什么 → 工具 → 别的几段', () => {
  const r = projectSystem({ ...base, notes: [{ path: 'a.md', text: '学生的词汇是瓶颈', pin: true }] });
  const at = (s) => r.text.indexOf(s);
  assert.ok(at('今天 2026-11-17') < at(base.instructions));
  assert.ok(at(base.instructions) < at('### 笔记：a.md'));
  assert.ok(at('### 笔记：a.md') < at('线代 30 讲'));
  assert.ok(at('线代 30 讲') < at('read：按路径读一条'));
  assert.ok(at('read：按路径读一条') < at('当前板是空的'));
});

test('页面拼的部分不写做法（学生的指令里有「必须」照留）', () => {
  const r = projectSystem(base);
  assert.ok(r.text.includes('必须用中文'));
  for (const w of FORBIDDEN) assert.ok(!pageParts(r).includes(w), `页面拼的部分出现了「${w}」`);
  assert.ok(!/[他她]/.test(identityText(facts)));
});

test('学生还没写指令：写明空着；笔记本空着：写明，以前的记录在目录里', () => {
  const r = projectSystem({ ...base, instructions: '' });
  assert.match(r.text, /学生还没写/);
  assert.match(r.text, /笔记本还是空的/);
});

test('一轮放不下：不超总量，没放下的 pin 列出路径和大小', () => {
  const notes = [{ path: 'a.md', text: '甲'.repeat(3000), pin: true, order: 1 }, { path: 'b.md', text: '乙'.repeat(3000), pin: true, order: 2 }];
  const r = projectSystem({ ...base, notes, max: 14 * 1024 });
  assert.ok(new TextEncoder().encode(r.text).length <= 14 * 1024, `${new TextEncoder().encode(r.text).length}`);
  assert.deepEqual(r.skipped.map((x) => x.path), ['b.md']);
  assert.match(r.text, /b\.md/);
  assert.match(r.text, /没放下/);
});

test('用量那一行：总量、指令、笔记各多大，上限多少', () => {
  const r = projectSystem(base);
  assert.match(r.text, /这一轮说明一共 [\d.]+ KB：项目指令 [\d.]+ KB、笔记 0 KB/);
  assert.equal(r.sizes.pinned, 0);
  assert.ok(r.sizes.total > 0);
});

test('学习台里有什么：书、真题、上过几节课、旧记忆每类几条、页面算好的事实在哪', () => {
  const data = {
    sessions: [{ id: 'c-1', space: 'en', date: '2026-11-16' }, { id: 'c-2', space: 'math', date: '2026-10-27' }, { id: 'c-3', space: 'en', date: '2026-11-12' }],
    rules: [{ id: 'r1' }, { id: 'r2' }], summary: [{ id: 'shared' }], notebook: [{ id: 'n', path: 'x.md' }],
  };
  const t = catalogText({ data, books: { books: [{ id: 'B1', title: '句句真研' }], chunks: [{ book: 'B1' }, { book: 'B1' }] }, exam: { questions: 846, years: [2009, 2026], profiles: 202 }, chats: 3 });
  assert.match(t, /句句真研（2 条）/);
  assert.match(t, /真题 846 道（2009–2026）/);
  assert.match(t, /英语 2 节（最近 2026-11-16）/);
  assert.match(t, /rules 2 条/);
  assert.match(t, /和班主任的对话 3 段/);
  assert.match(t, /meta\/forecast/);
  assert.match(t, /dev_requests/);
  for (const w of FORBIDDEN) assert.ok(!t.includes(w), w);
});

test('dev_requests：要改代码的事一条一条记（at、by、text、原话 quote、open / done），格式不对说出来', async () => {
  const { validateWrite } = await import('../kit/src/memory/writer.js');
  assert.deepEqual(validateWrite('dev_requests/dr-1', { at: 1, by: 'head', text: '首页能不能按周排', quote: '首页按周排吧', status: 'open' }), []);
  assert.ok(validateWrite('dev_requests/dr-1', { at: 1, by: 'head', status: 'open' }).some((p) => /text/.test(p)));
  assert.ok(validateWrite('dev_requests/dr-1', { at: 1, by: 'head', text: 'x', status: '要做' }).some((p) => /status/.test(p)));
});
