// 「这一块在考试里」（kit/src/exam/context.js）接进舞台课的说明（stage/doc.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examForClass, EXAM_BUDGET } from '../kit/src/exam/context.js';
import { examForBlock } from '../kit/src/exam/block.js';
import { DEFAULT_TARGET } from '../kit/src/exam/target.js';
import { buildStageSystem } from '../kit/src/stage/doc.js';

const syllabus = [{ id: 'G-OS-3.2', course: 'OS', title: '页面置换', level: '掌握', text: '掌握 FIFO、LRU 和 CLOCK 算法', blocks: ['OS-L3.2.1'] }];
const q = (id, year, how, extra = {}) => ({ id, year, n: Number(id.split('-').at(-1)), paper: `X-408-${year}`, type: 'single', points: 2, stem: `某进程的页面引用串……（${id}）`, options: { A: '1', B: '2', C: '3', D: '4' }, answer: 'B', analysis: '用 LRU 依次换出……'.repeat(20), course: 'OS', tags: { syl: ['G-OS-3.2'], how }, ...extra });
const questions = [q('Q-408-2015-26', 2015, 'concept'), q('Q-408-2019-26', 2019, 'calc'), q('Q-408-2023-45', 2023, 'process', { type: 'comp', points: 8 }), q('Q-408-2021-26', 2021, 'calc'), q('Q-408-2025-26', 2025, 'calc')];
const exam = { course: 'OS', syllabus, questions, profiles: [{ id: 'G-OS-3.2', how: '常考 LRU 的缺页次数和换出序列', traps: [{ id: 'G-OS-3.2#t1', text: '把 FIFO 当 LRU', qs: ['Q-408-2019-26'] }] }] };
const years = [2024, 2025, 2026];
const info = () => examForBlock({ block: 'OS-L3.2.1', exam, years });

test('有考情：档案、考点和大纲原文、统计、坑、代表题全文、学生的情况、用法都在；留着的卷的题面没有', () => {
  const t = examForClass({ target: DEFAULT_TARGET, info: info(), today: '2026-11-12' });
  for (const s of ['南京大学 智能科学与技术学院', '离考试 404 天', '页面置换（掌握）：掌握 FIFO', '考了 5 次', '平均每年', '坑 G-OS-3.2#t1：把 FIFO 当 LRU', '### Q-408-2023-45', '还没做过这一块的真题', 'exam=Q-', 'like=']) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('（Q-408-2025-26）'), '留着那一年的题面不出现');
  assert.match(t, /另有 1 道在留作模考的卷里/);
  assert.doesNotMatch(t.replace(/某进程的页面引用串[^\n]*|用 LRU 依次换出[^\n]*/g, ''), /[他她]/);
});

test('预算压到 6 KiB：解析先截、目录先少，档案、考点、统计、情况、用法还在；整份不超', () => {
  const t = examForClass({ target: DEFAULT_TARGET, info: info(), today: '2026-11-12', budget: 6 * 1024 });
  assert.ok(new TextEncoder().encode(t).length <= 6 * 1024);
  for (const s of ['目标：', '## 这一块挂的考点', '## 统计', '## 学生在这一块真题上的情况', '## 这一节怎么用']) assert.ok(t.includes(s), s);
});

test('真题级过了、踩过的坑：写在学生的情况里；老师用过的题号挪进代表题', () => {
  const t = examForClass({ target: DEFAULT_TARGET, info: info(), today: '2026-11-12', bar: { passed: true, timed: false, done: [{ id: 'Q-408-2019-26', ok: true, first: true }], traps: ['G-OS-3.2#t1'] }, asked: ['Q-408-2015-26'] });
  assert.match(t, /真题级：过了（超了建议用时）；踩过的坑：G-OS-3\.2#t1/);
  assert.match(t, /Q-408-2019-26（一次对）/);
  assert.match(t, /### Q-408-2015-26/);
});

test('没有考情：空的；舞台说明和不传时一样；有的话在资料包后面、记忆前面', () => {
  assert.equal(examForClass({ target: DEFAULT_TARGET, info: null, today: '2026-11-12' }), '');
  const a = buildStageSystem({ pack: { main: { goal: '讲置换' } }, subject: '操作系统' });
  assert.equal(buildStageSystem({ pack: { main: { goal: '讲置换' } }, subject: '操作系统', exam: '' }), a);
  const ex = examForClass({ target: DEFAULT_TARGET, info: info(), today: '2026-11-12' });
  const b = buildStageSystem({ pack: { main: { goal: '讲置换' } }, subject: '操作系统', exam: ex, memory: { mem: {}, block: 'OS-L3.2.1', space: 'cs' } });
  const i = b.indexOf('这一块在考试里');
  assert.ok(i > b.indexOf('这节课') && i < b.indexOf('你对学生的了解'));
  assert.ok(EXAM_BUDGET === 16 * 1024);
});
