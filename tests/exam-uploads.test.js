// 学习台里放考试资料（「管理 → 考试」传 PDF：真题、解析、大纲）：存进 assets，记一条 exam_uploads 等开发那边入库
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadDoc, guessKind, uploadProblem, UPLOAD_MAX, waitingLine } from '../kit/src/exam/uploads.js';
import { validateExam } from '../kit/src/exam/schema.js';

test('猜是什么：文件名里有解析 / 答案、大纲、真题', () => {
  assert.equal(guessKind('2019年408真题.pdf'), 'paper');
  assert.equal(guessKind('2019 408 答案解析.pdf'), 'answers');
  assert.equal(guessKind('2026计算机考研大纲.pdf'), 'syllabus');
  assert.equal(guessKind('笔记.pdf'), 'other');
});

test('一条记录：编号、文件名、asset、大小、猜的科目年份；守规矩', () => {
  const d = uploadDoc({ name: '2019年408真题.pdf', size: 1200000, asset: 'a1', kind: 'paper', note: '', now: Date.parse('2026-11-13T10:00:00Z'), seq: 2 });
  assert.match(d.id, /^up-20261113-\d+-2$/);
  assert.equal(d.subject, '408');
  assert.equal(d.year, 2019);
  assert.equal(d.status, 'waiting');
  const { id, ...rest } = d;
  assert.deepEqual(validateExam('exam_uploads', id, rest), []);
  assert.equal(uploadDoc({ name: '数学一 2021.pdf', size: 1, asset: 'a', kind: 'paper', now: 1, seq: 1 }).subject, '301');
});

test('不收的：不是 PDF、超过 15 MB', () => {
  assert.match(uploadProblem({ name: 'a.docx', type: 'application/msword', size: 10 }), /PDF/);
  assert.match(uploadProblem({ name: 'a.pdf', type: 'application/pdf', size: UPLOAD_MAX + 1 }), /15 MB/);
  assert.equal(uploadProblem({ name: 'a.pdf', type: 'application/pdf', size: 100 }), '');
});

test('等入库的一行字', () => {
  assert.equal(waitingLine([]), '');
  assert.match(waitingLine([{ status: 'waiting' }, { status: 'waiting' }, { status: 'done' }]), /2 份等入库/);
});
