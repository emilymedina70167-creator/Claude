// 考试资料的规矩（kit/src/exam/schema.js）：编号、必填、取值、谁能写；记忆库的 canWrite、writer 的 validateWrite 也认它
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateExam, examSpaceOf, EXAM_COLLECTIONS } from '../kit/src/exam/schema.js';
import { canWrite, assertWrite, COLLECTIONS } from '../kit/src/memory/schema.js';
import { validateWrite } from '../kit/src/memory/writer.js';

test('编号：考点、卷、题、篇章、动态', () => {
  assert.deepEqual(validateExam('syllabus', 'G-DS-6.4', { course: 'DS', space: 'cs', title: '图的应用', year: 2026 }), []);
  assert.match(validateExam('syllabus', 'G-XX-1', { course: 'DS', space: 'cs', title: 't', year: 2026 }).join(), /编号「G-XX-1」不对/);
  assert.deepEqual(validateExam('questions', 'Q-408-2019-23', { paper: 'X-408-2019', n: 23, type: 'single', points: 2, stem: '…', space: 'cs', course: 'OS' }), []);
  assert.match(validateExam('questions', 'Q-408-2019-23', { paper: 'X-408-2019', n: 23, type: 'mcq', points: 2, stem: '…', space: 'cs', course: 'OS' }).join(), /type 是「mcq」/);
  assert.match(validateExam('questions', 'Q-408-2019-23', { paper: 'X-408-2019', n: 23, type: 'single', points: 2, stem: '…', space: 'cs', course: 'OS', verified: { how: 'guess' } }).join(), /verified\.how/);
  assert.match(validateExam('passages', 'P-201-2020-T1', { paper: 'X-201-2020', text: '…', space: 'en', course: 'EN' }).join(), /编号/);
  assert.deepEqual(validateExam('passages', 'PA-201-2020-T1', { paper: 'X-201-2020', text: '…', space: 'en', course: 'EN' }), []);
  assert.deepEqual(validateExam('papers', 'X-408-2019', { subject: '408', year: 2019, space: 'cs', total: 150, count: 47 }), []);
  assert.match(validateExam('papers', 'X-408-2019', { subject: '408', year: 2019, space: 'cs', total: 150 }).join(), /缺了必填的 count/);
  assert.deepEqual(validateExam('exam_intel', 'ix-2026-line', { kind: 'line', text: '复试线', at: 1 }), []);
  assert.deepEqual(validateExam('steps', 'x', {}), []); // 不是考试资料不管
});

test('examSpaceOf：先看 space，再看门课，再看编号里的科目代码', () => {
  assert.equal(examSpaceOf({ space: 'math', course: 'DS' }), 'math');
  assert.equal(examSpaceOf({ course: 'HM' }), 'math');
  assert.equal(examSpaceOf({ course: 'CN' }), 'cs');
  assert.equal(examSpaceOf({ id: 'Q-201-2020-46' }), 'en');
  assert.equal(examSpaceOf({ id: 'G-PO-1' }), 'pol');
  assert.equal(examSpaceOf({ id: 'X-301-2021' }), 'math');
});

test('谁能写：考试资料只有 page、chat；收件箱 chat 写、page 收', () => {
  assert.equal(canWrite('page', 'questions'), true);
  assert.equal(canWrite('chat', 'questions'), true);
  assert.equal(canWrite('class', 'questions'), false);
  assert.equal(canWrite('me', 'syllabus'), false);
  assert.equal(canWrite('chat', 'exam_inbox'), true);
  assert.equal(canWrite('page', 'exam_inbox_log'), true);
  assert.equal(canWrite('chat', 'exam_inbox_log'), false);
  assert.equal(canWrite('me', 'exam'), true);
  assert.equal(canWrite('class', 'exam'), false);
  assert.equal(canWrite('page', 'exam_bar'), true);
  assert.equal(canWrite('class', 'exam_bar'), false);
  assert.equal(canWrite('class', 'steps'), true); // 两边都不管的照旧放行
  assert.throws(() => assertWrite('class', 'questions'), /真题/);
});

test('记忆库多两类：考试档案只认 target，真题级照课程地图的块编号', () => {
  assert.ok(COLLECTIONS.exam && COLLECTIONS.exam_bar);
  assert.ok(!EXAM_COLLECTIONS.exam && !EXAM_COLLECTIONS.exam_bar);
  assert.deepEqual(validateWrite('exam/target', { school: '南京大学', degree: '学硕', date: '2027-12-21' }), []);
  assert.match(validateWrite('exam/other', { school: '南京大学' }).join(), /编号「other」不对/);
  assert.match(validateWrite('exam/target', { school: '南京大学', degree: '博士' }).join(), /degree/);
  assert.deepEqual(validateWrite('exam_bar/DS-L2.1.1', { at: 1 }), []);
});

test('writer 的 validateWrite 也查考试资料', () => {
  assert.match(validateWrite('questions/Q-408-2019-23', { paper: 'X-408-2019' }).join(), /缺了必填的 n/);
  assert.deepEqual(validateWrite('exam_inbox/t-1', { kind: 'paper' }), []);
});
