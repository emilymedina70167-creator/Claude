// 课堂的老师就是项目 Claude（第十四轮，docs/superpowers/specs/2026-11-17-project-claude-design.md 6.4）：
// 学习台里上课时，每一轮的说明是项目 Claude 的那一份（学生的指令、它的笔记本、学习台里有什么、工具）加上课堂的几段（组件和黑板、这节课的资料、考情、黑板现状）。
// 开发写的根本规则、「你对学生的了解」、规定形式的句子不再发。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystem, SYSTEM_MAX, closingFacts, PROTOCOL_DOC } from '../kit/src/class/prompt.js';
import { blockCommand, parseOutput } from '../kit/src/class/protocol.js';
import { noteResultText } from '../kit/src/project/notebook.js';

const project = {
  facts: { today: '2026-11-17', version: 'v', examDays: 399, target: '南京大学' },
  instructions: '老师把内容讲透，我来学。',
  notes: [{ path: '学生/英语.md', text: '词汇是瓶颈', pin: true }],
  catalog: '- 教材：句句真研（120 条）',
  toolsDoc: '- search：按字找',
};
const sys = () => buildSystem({ componentDocs: '### answer：自己算\n写法……', pack: { main: { unit: '情态动词' } }, board: {}, subject: '英语', project, tools: true });

test('学习台里的课：项目 Claude 的说明在前，课堂的几段在后', () => {
  const s = sys();
  const at = (x) => s.indexOf(x);
  for (const x of ['老师把内容讲透，我来学。', '### 笔记：学生/英语.md', '句句真研', 'search：按字找', '### answer：自己算', '情态动词', '黑板现状']) assert.ok(at(x) >= 0, x);
  assert.ok(at('老师把内容讲透') < at('### 笔记：学生/英语.md'));
  assert.ok(at('search：按字找') < at('### answer：自己算'));
  assert.ok(new TextEncoder().encode(s).length <= SYSTEM_MAX);
});

test('开发写的做法不再发：根本规则、「你对学生的了解」、规定形式的句子', () => {
  const s = sys();
  for (const x of ['你是这个学生一对一的老师', '你对学生的了解', '板顶的话只是一两句招呼', '要短，一条两三行；不放题', '只轻轻问一句', '记忆是用来了解学生的背景']) assert.ok(!s.includes(x), `还在：${x}`);
  for (const x of ['板顶的话只是一两句招呼', '要短，一条两三行；不放题', '只轻轻问一句']) assert.ok(!PROTOCOL_DOC.includes(x), `PROTOCOL_DOC 还在：${x}`);
});

test('工具手册里有 board note 块的写法', () => {
  assert.match(sys(), /board note/);
});

test('board note 块：读成笔记本的操作', () => {
  const op = blockCommand('note', 'create 学生/a.md\n<<<\n正文\n>>>\nset 学生/a.md pin=on');
  assert.equal(op.op, 'note');
  assert.deepEqual(op.ops.map((o) => o.kind), ['create', 'set']);
  const out = parseOutput('好。\n````board note\ncreate a.md\n<<<\nx\n>>>\n````\n', { final: true });
  assert.ok(out.segments.some((sg) => sg.type === 'board' && sg.op?.op === 'note'));
});

test('笔记没改成：下一轮告诉它是哪一条、为什么', () => {
  const t = noteResultText([{ ok: true, path: 'a.md' }, { ok: false, path: 'b.md', error: 'b.md 里没找到要换的那一段' }]);
  assert.match(t, /笔记没改成/);
  assert.match(t, /b\.md 里没找到/);
  assert.equal(noteResultText([{ ok: true, path: 'a.md' }]), '');
});

test('下课时只写事实：学生点了下课；复现课写明复现的是哪几组和页面怎么记', () => {
  assert.equal(closingFacts({}), '学生点了下课。');
  const t = closingFacts({ review: [{ id: 'R3', title: '特征值' }] });
  assert.match(t, /R3/);
  assert.match(t, /review id=/);
  for (const w of ['小结', '整理单', '你应该', '必须']) assert.ok(!t.includes(w), w);
});
