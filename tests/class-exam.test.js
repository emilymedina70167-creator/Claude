// 黑板课每一轮带「这一块在考试里」（docs/superpowers/specs/2026-11-15-root-design.md 第 2 节）：
// buildSystem 的 exam、让出来的预算、一问一答和舞台课不变；黑板课这一路（class/examroom.js）的题号、留作模考的卷
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSystem, SYSTEM_MAX, TEXTBOOK_FLOOR, PACK_BUDGET } from '../kit/src/class/prompt.js';
import { EXAM_BUDGET, examForClass } from '../kit/src/exam/context.js';
import { examForBlock } from '../kit/src/exam/block.js';
import { examCheckOf } from '../kit/src/exam/fields.js';
import { DEFAULT_TARGET } from '../kit/src/exam/target.js';
import { askedOnBoard, boardExam, examLint } from '../kit/src/class/examroom.js';
import { specKey } from '../kit/src/class/spec.js';
import { componentDocs } from '../kit/build-docs.js';
import { sampleMemory } from '../kit/src/memory/sample.js';
import * as stageDoc from '../kit/src/stage/doc.js';

const bytes = (s) => Buffer.byteLength(s);
const board = { segs: [], pages: [], cur: 0 };
const exam = '## 统计\n- 2015–2023 年考了 4 次\n## 代表题\n### Q-408-2023-45\n某进程的页面引用串……';

test('给了考情就多一节，在资料包后面、记忆前面', () => {
  const s = buildSystem({ componentDocs: '', pack: { main: { unit: '页面置换' } }, board, subject: '操作系统', exam, memory: { mem: {}, block: 'OS-L3.2.1', space: 'cs' } });
  const i = s.indexOf('这一块在考试里（页面从入库的真题和考试大纲算的）');
  assert.ok(i > s.indexOf('页面置换') && s.includes('Q-408-2023-45'));
  assert.ok(i > s.indexOf('这节课的资料包') && i < s.indexOf('你对学生的了解（学习台的记忆库）') && i < s.indexOf('黑板现状\n'));
  // 一节一个编号：角色、组件、资料包、考情、记忆、黑板现状
  assert.match(s, /^# 四、这一块在考试里/m);
  assert.match(s, /^# 六、黑板现状/m);
});
test('没给就没有这一节；空的和不传一样', () => {
  const a = { componentDocs: '', pack: { main: { unit: '页面置换' } }, board, subject: '操作系统' };
  const s = buildSystem(a);
  assert.ok(!s.includes('这一块在考试里'));
  assert.equal(buildSystem({ ...a, exam: '' }), s);
});
test('考情、最大的资料包一起带：整份不超上限，教材原文不少于 32 KiB', () => {
  const big = '教'.repeat(60 * 1024);   // 约 180 KiB 的教材原文
  const s = buildSystem({ componentDocs: 'x'.repeat(40 * 1024), pack: { main: { unit: 'u', textbook: big, plan: '计'.repeat(30 * 1024) } }, board, subject: '操作系统', exam: '考'.repeat(Math.floor(EXAM_BUDGET / 3)) });
  assert.ok(bytes(s) <= SYSTEM_MAX);
  const kept = (s.match(/教+/g) || []).reduce((n, x) => Math.max(n, bytes(x)), 0);
  assert.ok(kept >= TEXTBOOK_FLOOR, `教材只留了 ${kept} 字节`);
});
test('教材原文不是最大的那一段时也留够 32 KiB（别的字段挤不掉它）；不带考情时资料包照旧', () => {
  // 三段各 90 KiB、教材 60 KiB：平分的话教材分不到 32 KiB
  const main = { unit: 'u', textbook: '教'.repeat(20 * 1024), a1: 'a'.repeat(90 * 1024), a2: 'b'.repeat(90 * 1024), a3: 'c'.repeat(90 * 1024) };
  const mem = { mem: sampleMemory('2026-11-12'), block: 'OS-L3.2.1', space: 'cs' };
  const args = { componentDocs: 'x'.repeat(40 * 1024), pack: { main }, board, subject: '操作系统', memory: mem };
  const kept = (s) => (s.match(/教+/g) || []).reduce((n, x) => Math.max(n, bytes(x)), 0);
  const withExam = buildSystem({ ...args, exam: '考'.repeat(Math.floor(EXAM_BUDGET / 3)) });
  assert.ok(bytes(withExam) <= SYSTEM_MAX);
  // 被截的那一段末尾有一行「（资料包太长，已截断）」，算在留的 32 KiB 里
  assert.ok(kept(withExam) >= TEXTBOOK_FLOOR - 64, `教材只留了 ${kept(withExam)} 字节`);
  // 没有考情的课（数学、英语现在没有真题）：一个字节都不变——留底只在考情占了地方时才加
  assert.ok(kept(buildSystem(args)) < TEXTBOOK_FLOOR - 1024);
});
test('资料包紧的时候（记忆装满的数据结构课只剩四十来 KiB）：教材原文留一半，教案不被挤到只剩几 KiB', () => {
  const main = { unit: 'u', textbook: '教'.repeat(20 * 1024), plan: '计'.repeat(10 * 1024) }; // 教材 60 KiB、教案 30 KiB
  const s = buildSystem({ componentDocs: '', pack: { main }, board, subject: '数据结构', exam, packBudget: 40 * 1024 });
  const run = (re) => (s.match(re) || []).reduce((n, x) => Math.max(n, bytes(x)), 0);
  assert.ok(run(/教+/g) >= 20 * 1024 - 64, `教材只留了 ${run(/教+/g)} 字节`);
  assert.ok(run(/计+/g) >= 16 * 1024, `教案只留了 ${run(/计+/g)} 字节`);
});
test('同样的输入拼出来一字不差（抢跑要对指纹）', () => {
  const a = { componentDocs: '', pack: { main: { unit: 'u' } }, board, subject: '操作系统', exam };
  assert.equal(buildSystem(a), buildSystem({ ...a }));
});
test('一问一答不带考情；TEXTBOOK_FLOOR 挪到 prompt.js，舞台课照旧从 stage/doc.js 拿得到同一个数', () => {
  const a = { componentDocs: '', pack: {}, board: '', subject: '操作系统', talk: true };
  assert.equal(buildSystem({ ...a, exam }), buildSystem(a));
  assert.equal(TEXTBOOK_FLOOR, 32 * 1024);
  assert.equal(stageDoc.TEXTBOOK_FLOOR, TEXTBOOK_FLOOR);
});

// —— 接得上：考试资料 → examForBlock → examForClass → buildSystem（样例数据和 tests/exam-context.test.js 一样）——
const syllabus = [{ id: 'G-OS-3.2', course: 'OS', title: '页面置换', level: '掌握', text: '掌握 FIFO、LRU 和 CLOCK 算法', blocks: ['OS-L3.2.1'] }];
const q = (id, year, how, extra = {}) => ({ id, year, n: Number(id.split('-').at(-1)), paper: `X-408-${year}`, type: 'single', points: 2, stem: `某进程的页面引用串……（${id}）`, options: { A: '1', B: '2', C: '3', D: '4' }, answer: 'B', analysis: '用 LRU 依次换出……'.repeat(20), course: 'OS', tags: { syl: ['G-OS-3.2'], how }, ...extra });
const questions = [q('Q-408-2015-26', 2015, 'concept'), q('Q-408-2019-26', 2019, 'calc'), q('Q-408-2023-45', 2023, 'process', { type: 'comp', points: 8 }), q('Q-408-2021-26', 2021, 'calc'), q('Q-408-2017-26', 2017, 'calc'),
  q('Q-408-2025-26', 2025, 'calc'), q('Q-408-2022-30', 2022, 'calc', { reserve: true })]; // 2025 在留着的年份里；2022-30 那张卷标了留作模考
const course = { course: 'OS', syllabus, questions, profiles: [{ id: 'G-OS-3.2', how: '常考 LRU 的缺页次数和换出序列', traps: [{ id: 'G-OS-3.2#t1', text: '把 FIFO 当 LRU', qs: ['Q-408-2019-26', 'Q-408-2025-26'] }] }] };
const years = [2024, 2025, 2026];
const mem = { exam: [], exam_bar: [{ id: 'OS-L3.2.1', passed: false, done: [{ id: 'Q-408-2019-26', ok: true, first: true }], traps: [] }] };

test('黑板课这一路：该有的都在，数是页面算的，写法是组件的 exam: / like:（不是舞台的 exam=）', () => {
  const t = boardExam({ exam: course, block: 'OS-L3.2.1', years, mem, today: '2026-11-12' });
  for (const s of ['目标：', '## 这一块挂的考点（考试大纲原文）', '页面置换（掌握）：掌握 FIFO', '考了 7 次', '### Q-408-2023-45', '坑 G-OS-3.2#t1：把 FIFO 当 LRU', 'Q-408-2019-26（一次对）', '真题级：还没过', '## 这一节怎么用', '`exam: 题号`', '`like: 题号`']) assert.ok(t.includes(s), s);
  // 舞台的写法（ask value、goal、exam=）黑板课上没有：这一节里不出现
  for (const s of ['exam=', 'like=', 'ask value', 'goal']) assert.ok(!t.includes(s), `不该有 ${s}`);
  assert.ok(bytes(t) <= EXAM_BUDGET);
  // 提到学生不用「他」「她」
  assert.doesNotMatch(t.replace(/某进程的页面引用串[^\n]*|用 LRU 依次换出[^\n]*/g, ''), /[他她]/);
  const s = buildSystem({ componentDocs: '', pack: { main: { unit: '页面置换' } }, board, subject: '操作系统', exam: t, memory: { mem, block: 'OS-L3.2.1', space: 'cs' } });
  assert.ok(s.includes('### Q-408-2023-45') && s.includes('这一块在考试里（页面从入库的真题和考试大纲算的）'));
});
test('舞台课那一份不变：不写 form 时用法还是舞台的写法', () => {
  const info = examForBlock({ block: 'OS-L3.2.1', exam: course, years });
  const t = examForClass({ target: DEFAULT_TARGET, info, today: '2026-11-12' });
  assert.ok(t.includes('`exam=题号`（`ask value "…" answer=… exam=Q-…`') && t.includes('照题号写进 exam= / like= 用了'));
  assert.ok(!t.includes('`exam: 题号`'));
});
test('留作模考的卷不出现在黑板课这一节里：留着的年份、标了留着的卷，题面、题号、目录、坑里引的都没有', () => {
  // 板上写了留着的题号（老师凭印象写的）也不会把它的全文挪进来
  const mds = ['```answer\nexam: Q-408-2025-26\nq: 缺页几次\nanswer: 9\n```', '```quiz\nlike: Q-408-2022-30\nq: 哪个对\n- [x] a\n- [ ] b\n```'];
  const t = boardExam({ exam: course, block: 'OS-L3.2.1', years, mem, mds, today: '2026-11-12' });
  assert.ok(!t.includes('Q-408-2025-26') && !t.includes('Q-408-2022-30'), '留着的题号');
  assert.ok(!t.includes('（Q-408-2025-26）') && !t.includes('（Q-408-2022-30）'), '留着的题面');
  assert.match(t, /另有 2 道在留作模考的卷里/);
  assert.match(t, /坑 G-OS-3\.2#t1：把 FIFO 当 LRU（Q-408-2019-26）/);
  // 当场报成写法错误：留作模考的、库里没有的
  const check = examCheckOf(course, years);
  const errs = examLint(mds.join('\n\n'), check);
  assert.equal(errs.length, 2);
  assert.match(errs[0], /exam: Q-408-2025-26 是留作模考的卷/);
  assert.match(errs[1], /like: Q-408-2022-30 是留作模考的卷/);
  assert.match(examLint('```answer\nexam: Q-408-2019-99\nq: x\nanswer: 1\n```', check)[0], /库里没有这道真题 Q-408-2019-99/);
  // 报错的话里是组件的写法，不是舞台的 like=
  assert.ok(!errs.join().includes('like=') && errs[0].includes('照它 like: 出一道'));
  assert.deepEqual(examLint('```answer\nexam: Q-408-2019-26\nq: x\nanswer: 1\n```', check), []);
  // 考试资料还没读到（check 是 null）：不查
  assert.deepEqual(examLint(mds.join('\n\n'), null), []);
});
test('板上组件写过的题号：目录里的那道下一轮有全文；题号从段的原文里读（exam: / like:，全角冒号也认）', () => {
  assert.deepEqual(askedOnBoard(['## 例题\n\n```answer\nexam: Q-408-2015-26\nq: x\nanswer: 1\n```', '```quiz\nlike：Q-408-2017-26\nq: y\n- [x] a\n```', '正文里提到 Q-408-2021-26 不算', null]), ['Q-408-2015-26', 'Q-408-2017-26']);
  const before = boardExam({ exam: course, block: 'OS-L3.2.1', years, mem, today: '2026-11-12' });
  // 代表题挑三道（不同考法各一道、新的先、做过的往后）：剩下的在目录里只有一行
  const rest = ['Q-408-2015-26', 'Q-408-2017-26', 'Q-408-2019-26', 'Q-408-2021-26'].filter((id) => !before.includes(`### ${id}`));
  assert.ok(rest.length >= 1);
  const after = boardExam({ exam: course, block: 'OS-L3.2.1', years, mem, mds: [`\`\`\`answer\nlike: ${rest[0]}\nq: x\nanswer: 1\n\`\`\``], today: '2026-11-12' });
  assert.ok(after.includes(`### ${rest[0]}`));
});
test('没有考情的不出现：考试资料没读到、这一块没挂考点（数学、英语现在没入库）都是空的，不写占地方的话', () => {
  assert.equal(boardExam({ exam: null, block: 'OS-L3.2.1', years, mem, today: '2026-11-12' }), '');
  assert.equal(boardExam({ exam: course, block: '', years, mem, today: '2026-11-12' }), '');
  assert.equal(boardExam({ exam: course, block: 'OS-L9.9.9', years, mem, today: '2026-11-12' }), '');
  assert.equal(boardExam({ exam: { course: 'LA', syllabus: [], questions: [], profiles: [] }, block: 'L2.1.4', years, mem, today: '2026-11-12' }), '');
});
test('抢跑接得上：考试资料、板、记忆都没变时前后两次这一节一字不差，整份的指纹一样', () => {
  const mds = ['```answer\nexam: Q-408-2015-26\nq: x\nanswer: 1\n```'];
  const sys = () => buildSystem({ componentDocs: '', pack: { main: { unit: '页面置换' } }, board, subject: '操作系统', memory: { mem, block: 'OS-L3.2.1', space: 'cs' }, exam: boardExam({ exam: course, block: 'OS-L3.2.1', years, mem, mds: [...mds], today: '2026-11-12' }) });
  assert.equal(specKey([{ role: 'system', content: sys() }]), specKey([{ role: 'system', content: sys() }]));
});

// —— 预算：真的组件说明、装满的记忆、最大的考情一起带 ——
const DOCS = componentDocs(readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8'));
test('四门 408 的课：带满 16 KiB 的考情，整份不超上限；不带记忆时留给资料包的不少于 96 KiB − 考情', () => {
  const full = '考'.repeat(Math.floor(EXAM_BUDGET / 3));
  const pack = { main: { unit: 'u', textbook: '教材原文。'.repeat(300 * 1024 / 15) } };
  for (const subject of ['数据结构', '操作系统', '组成原理', '计网']) {
    const sys = buildSystem({ componentDocs: DOCS, pack, board, subject, exam: full, canvas: true, memory: { mem: sampleMemory('2026-11-12'), block: 'OS-L3.2.1', space: 'cs' } });
    assert.ok(bytes(sys) <= SYSTEM_MAX, `${subject}：整份 ${bytes(sys)}`);
    const rest = bytes(buildSystem({ componentDocs: DOCS, pack: {}, board: [], subject, exam: full }));
    assert.ok(rest < SYSTEM_MAX - (96 * 1024 - EXAM_BUDGET), `${subject}：带考情时资料包以外 ${rest} 字节`);
    assert.ok(PACK_BUDGET >= 96 * 1024);
  }
});
