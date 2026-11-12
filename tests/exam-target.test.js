// 考试档案（kit/src/exam/target.js）：默认的一份、读法、只交改了的；410 分和距考研读它
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TARGET, targetOf, examDateOf, goalOf, needsDefault, targetPatch, schoolLine } from '../kit/src/exam/target.js';
import { validateWrite } from '../kit/src/memory/writer.js';

test('默认档案：南京大学智能科学与技术学院，11408，410 分，2027-12-21；守记忆库的规矩', () => {
  assert.equal(DEFAULT_TARGET.school, '南京大学');
  assert.equal(DEFAULT_TARGET.dept, '智能科学与技术学院');
  assert.deepEqual(DEFAULT_TARGET.alt, ['人工智能学院']);
  assert.deepEqual(DEFAULT_TARGET.subjects, ['101', '201', '301', '408']);
  assert.equal(DEFAULT_TARGET.goal, 410);
  assert.equal(DEFAULT_TARGET.date, '2027-12-21');
  assert.equal(DEFAULT_TARGET.reserve, null);
  assert.deepEqual(validateWrite('exam/target', { ...DEFAULT_TARGET, by: 'page', at: 1 }), []);
  assert.equal(schoolLine(DEFAULT_TARGET), '南京大学 智能科学与技术学院');
  assert.equal(schoolLine({ school: '南京大学', dept: '', major: '' }), '南京大学');
});

test('没档案用默认；日期写坏回退；四科对不上照用并提醒', () => {
  assert.equal(targetOf({}).goal, 410);
  assert.equal(targetOf({ exam: [{ id: 'target', school: '南京大学', goal: 400 }] }).goal, 400);
  assert.equal(targetOf({ exam: [{ id: 'target', school: '南京大学' }] }).goal, 410); // 缺的字段用默认补
  assert.equal(examDateOf({ date: '2027-13-40' }), '2027-12-21');
  assert.equal(examDateOf({ date: '2027-12-23' }), '2027-12-23');
  const g = goalOf({ goal: 400, split: { math: 130, cs: 135, en: 75, pol: 70 } });
  assert.equal(g.goal, 400);
  assert.deepEqual(g.split, { math: 130, cs: 135, en: 75, pol: 70 });
  assert.match(g.warn, /四科加起来是 410，不是目标的 400/);
  assert.equal(goalOf(DEFAULT_TARGET).warn, '');
  const bad = goalOf({ goal: 'x', split: { math: -3 } });
  assert.equal(bad.goal, 410);
  assert.equal(bad.split.math, 130);
});

test('只在读到了而且是空的时候写默认', () => {
  assert.equal(needsDefault({ loaded: true, failed: false, docs: [] }), true);
  assert.equal(needsDefault({ loaded: false, failed: false, docs: [] }), false);
  assert.equal(needsDefault({ loaded: true, failed: true, docs: [] }), false);
  assert.equal(needsDefault({ loaded: true, failed: false, docs: [{ id: 'target' }] }), false);
});

test('targetPatch 只交改了的；数字、年份从表单的字转好', () => {
  assert.deepEqual(targetPatch(DEFAULT_TARGET, { ...DEFAULT_TARGET, dept: '人工智能学院' }), { dept: '人工智能学院' });
  assert.deepEqual(targetPatch(DEFAULT_TARGET, { goal: '400', split: { math: '120', cs: '135', en: '75', pol: '70' } }), { goal: 400, split: { math: 120, cs: 135, en: 75, pol: 70 } });
  assert.deepEqual(targetPatch(DEFAULT_TARGET, { reserve: '2025, 2026' }), { reserve: [2025, 2026] });
  assert.deepEqual(targetPatch({ ...DEFAULT_TARGET, reserve: [2025] }, { reserve: '' }), { reserve: null });
  assert.deepEqual(targetPatch(DEFAULT_TARGET, { date: '2027-12-21' }), {});
});
