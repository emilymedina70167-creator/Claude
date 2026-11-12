// 真题、解析、大纲的转写格式和切法（kit/src/exam/ingest.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitPaper, splitAnswers, buildPaper, parseSyllabus } from '../kit/src/exam/ingest.js';
import { validateExam } from '../kit/src/exam/schema.js';

const read = (f) => readFileSync(new URL(`./fixtures/exam/${f}`, import.meta.url), 'utf8');
const paperText = read('408-2019.paper.txt');
const answersText = read('408-2019.answers.txt');

test('切一卷 408：47 道题、题号对、跨页的题面接上、选项拆开', () => {
  const r = buildPaper({ subject: '408', year: 2019, paperText, answersText, source: 'test' });
  assert.deepEqual(r.problems, []);
  assert.equal(r.paper.id, 'X-408-2019');
  assert.equal(r.paper.total, 150);
  assert.equal(r.paper.count, 47);
  assert.equal(r.paper.source, 'test');
  assert.deepEqual(validateExam('papers', r.paper.id, r.paper), []);
  assert.equal(r.questions.length, 47);
  const q23 = r.questions.find((q) => q.n === 23);
  assert.equal(q23.id, 'Q-408-2019-23');
  assert.equal(q23.type, 'single');
  assert.equal(q23.course, 'OS');
  assert.equal(q23.space, 'cs');
  assert.equal(q23.year, 2019);
  assert.equal(q23.paper, 'X-408-2019');
  assert.deepEqual(Object.keys(q23.options), ['A', 'B', 'C', 'D']);
  assert.equal(q23.options.B, '选项 B23');
  assert.ok(!q23.stem.includes('选项'));
  assert.equal(q23.answer, 'C');
  assert.match(q23.analysis, /解析 23/);
  assert.deepEqual(q23.verified, { how: 'book' });
  assert.deepEqual(q23.pages, [3]);
  for (const q of r.questions) assert.deepEqual(validateExam('questions', q.id, q), [], q.id);
  const q41 = r.questions.find((q) => q.n === 41);
  assert.ok(q41.stem.includes('（接上页）'));
  assert.deepEqual(q41.pages, [5, 6]);
  assert.equal(q41.answer, '');
  assert.match(q41.analysis, /综合题 41/);
});

test('少一题、解析册缺答案、题号重复、看不懂的题型都报', () => {
  const p = paperText.replace(/--- 题 47[\s\S]*$/, '');
  assert.match(buildPaper({ subject: '408', year: 2019, paperText: p, answersText }).problems.join(), /少了第 47 题/);
  assert.match(buildPaper({ subject: '408', year: 2019, paperText, answersText: '--- 答 1\n答案：A' }).problems.join(), /第 2 题.*没有答案/);
  assert.match(splitPaper('--- 题 1 | 单选 | 2\na\n--- 题 1 | 单选 | 2\nb').problems.join(), /第 1 题出现了两次/);
  assert.match(splitPaper('--- 题 1 | 选择 | 2\na').problems.join(), /第 1 题.*「选择」/);
  assert.match(splitPaper('前面的字\n--- 题 1 | 单选 | 2\na').problems.join(), /第一题前面/);
  assert.match(splitAnswers('--- 答 3\n答案：A\n--- 答 3\n答案：B').problems.join(), /第 3 题.*两次/);
});

test('英语的篇章：题挂着篇，篇自己一条', () => {
  const t = '=== 第 1 页\n--- 篇 T1 | 阅读\nIt is a passage.\nSecond line.\n--- 题 21 | 阅读 | 2 | 篇 T1\nWhat is it?\nA. a\nB. b\nC. c\nD. d';
  const r = splitPaper(t);
  assert.deepEqual(r.problems, []);
  assert.equal(r.passages[0].key, 'T1');
  assert.match(r.passages[0].text, /Second line/);
  assert.equal(r.questions[0].passage, 'T1');
  const b = buildPaper({ subject: '201', year: 2020, paperText: t, answersText: '--- 答 21\n答案：B' });
  assert.equal(b.passages[0].id, 'PA-201-2020-T1');
  assert.equal(b.questions[0].passage, 'PA-201-2020-T1');
  assert.equal(b.questions[0].course, 'EN');
  assert.deepEqual(validateExam('passages', b.passages[0].id, b.passages[0]), []);
});

test('大纲切成考点树：三层编号、要求层级从第一句取', () => {
  const r = parseSyllabus(read('ds-2026.syllabus.txt'), { course: 'DS', year: 2026 });
  assert.deepEqual(r.problems, []);
  const ids = r.nodes.map((x) => x.id);
  assert.deepEqual(ids, ['G-DS-1', 'G-DS-1.1', 'G-DS-1.2', 'G-DS-1.2.1', 'G-DS-1.2.2', 'G-DS-1.3', 'G-DS-2', 'G-DS-2.1']);
  const n = r.nodes.find((x) => x.id === 'G-DS-1.2.1');
  assert.equal(n.parent, 'G-DS-1.2');
  assert.equal(n.level, '掌握');
  assert.equal(n.space, 'cs');
  assert.equal(n.title, '顺序存储');
  assert.deepEqual(n.path, ['线性表', '线性表的实现', '顺序存储']);
  assert.equal(r.nodes.find((x) => x.id === 'G-DS-1.1').level, '了解');
  assert.equal(r.nodes.find((x) => x.id === 'G-DS-1.3').level, '会用');
  assert.equal(r.nodes.find((x) => x.id === 'G-DS-1.2').level, '');
  for (const x of r.nodes) assert.deepEqual(validateExam('syllabus', x.id, x), [], x.id);
  assert.match(parseSyllabus('### 1. 没有上一层', { course: 'DS', year: 2026 }).problems.join(), /上一层/);
});
