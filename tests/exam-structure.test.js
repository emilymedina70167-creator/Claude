// 卷面结构表（kit/src/exam/structure.js）和题型、考法词表（taxonomy.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structureOf, checkPaper, courseHint } from '../kit/src/exam/structure.js';
import { TYPES, typeKey, HOW, checkTags } from '../kit/src/exam/taxonomy.js';
import { EXAM_COLLECTIONS, EXAM_COURSES } from '../kit/src/exam/schema.js';

const paper408 = { subject: '408', year: 2019, total: 150, count: 47 };
const qs408 = () => [...Array(40)].map((_, i) => ({ n: i + 1, type: 'single', points: 2 })).concat([41, 42, 43, 44, 45, 46, 47].map((n) => ({ n, type: 'comp', points: 10 })));

test('408 的结构：40 道单选每道 2 分，41～47 综合合计 70，共 150', () => {
  const s = structureOf('408', 2019);
  assert.equal(s.total, 150);
  assert.equal(s.minutes, 180);
  assert.deepEqual(checkPaper(paper408, qs408()).problems, []);
  const qs = qs408();
  qs[40].points = 13;
  assert.match(checkPaper(paper408, qs).problems.join(), /41～47.*合计 73.*70/);
  assert.match(checkPaper(paper408, qs408().slice(0, 46)).problems.join(), /少了第 47 题/);
  const bad = qs408(); bad[2].points = 3;
  assert.match(checkPaper(paper408, bad).problems.join(), /第 3 题.*3 分.*2 分/);
  const t = qs408(); t[5].type = 'multi';
  assert.match(checkPaper(paper408, t).problems.join(), /第 6 题.*多选.*单选/);
  assert.match(checkPaper({ ...paper408, total: 140 }, qs408()).problems.join(), /卷面总分/);
  assert.match(checkPaper(paper408, [...qs408(), { n: 48, type: 'comp', points: 0 }]).problems.join(), /多了第 48 题/);
});

test('408 照十八年真卷核过了：不再提醒；别的科目还是草稿', async () => {
  const r = checkPaper(paper408, qs408());
  assert.ok(!r.notes.some((x) => /还没照真卷核过/.test(x)));
  const { STRUCTURE } = await import('../kit/src/exam/structure.js');
  assert.ok(STRUCTURE['408'].every((s) => s.checked === true));
  for (const k of ['301', '201', '101']) assert.ok(STRUCTURE[k].every((s) => s.checked === false), k);
});

test('数学一 2021 前后结构不一样；英语一完形每题半分', () => {
  assert.equal(structureOf('301', 2020).sections[0].points, 4);
  assert.equal(structureOf('301', 2021).sections[0].points, 5);
  assert.equal(structureOf('301', 2021).total, 150);
  assert.equal(structureOf('201', 2020).sections[0].points, 0.5);
  assert.equal(structureOf('101', 2020).total, 100);
  assert.equal(structureOf('408', 2005), null);
});

test('courseHint：408 按题号认门课，别的科目一门课', () => {
  assert.equal(courseHint('408', 2019, 5), 'DS');
  assert.equal(courseHint('408', 2019, 15), 'CO');
  assert.equal(courseHint('408', 2019, 30), 'OS');
  assert.equal(courseHint('408', 2019, 38), 'CN');
  assert.equal(courseHint('408', 2019, 42), 'DS');
  assert.equal(courseHint('408', 2019, 44), 'CO');
  assert.equal(courseHint('408', 2019, 46), 'OS');
  assert.equal(courseHint('408', 2019, 47), 'CN');
  assert.equal(courseHint('201', 2019, 46), 'EN');
  assert.equal(courseHint('101', 2019, 3), 'PO');
  assert.equal(courseHint('301', 2019, 3), 'HM'); // 先猜高数，打了标签照主考点改
});

test('题型词表和 schema 的一致；中文认得', () => {
  assert.deepEqual(Object.keys(TYPES).sort(), EXAM_COLLECTIONS.questions.enums.type.slice().sort());
  assert.equal(typeKey('单选'), 'single');
  assert.equal(typeKey('综合'), 'comp');
  assert.equal(typeKey('新题型'), 'newtype');
  assert.equal(typeKey('不知道'), '');
});

test('每门课都有考法表；标签只能取表里的', () => {
  for (const c of EXAM_COURSES) assert.ok(Object.keys(HOW[c] || {}).length >= 3, c);
  const ids = new Set(['G-DS-6.4', 'G-DS-6.3']);
  assert.deepEqual(checkTags({ syl: ['G-DS-6.4'], how: 'process', difficulty: { est: 3 } }, { course: 'DS', syllabusIds: ids }), []);
  const bad = checkTags({ syl: ['G-DS-9'], how: 'proof', difficulty: { est: 7 } }, { course: 'DS', syllabusIds: ids }).join('\n');
  assert.match(bad, /G-DS-9.*没有/);
  assert.match(bad, /proof/);
  assert.match(bad, /难度/);
  assert.match(checkTags({ syl: [], how: 'process' }, { course: 'DS', syllabusIds: ids }).join(), /至少一个考点/);
  assert.match(checkTags({ syl: ['G-DS-6.4', 'G-DS-6.3', 'G-DS-6.4', 'G-DS-6.3'], how: 'process' }, { course: 'DS', syllabusIds: ids }).join(), /最多 3 个/);
});
