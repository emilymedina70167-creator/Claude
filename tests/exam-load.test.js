// 按门课读考试资料（kit/src/exam/load.js）：只按门课查，不读整类
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseOfBlock, loadExamCourse } from '../kit/src/exam/load.js';

test('courseOfBlock：课程地图的块 → 门课', () => {
  assert.equal(courseOfBlock('DS-L2.1.1'), 'DS');
  assert.equal(courseOfBlock('L2.2.1'), 'LA');
  assert.equal(courseOfBlock('HM-L1.1'), 'HM');
  assert.equal(courseOfBlock('PS-L3'), 'PS');
  assert.equal(courseOfBlock('EN-L1.1.1'), 'EN');
  assert.equal(courseOfBlock(''), '');
});

function fakeDb(rows, broken = []) {
  const queries = [];
  return {
    queries,
    collection: (c) => ({
      get: () => { throw new Error('不许读整类'); },
      onSnapshot: () => { throw new Error('不许订阅'); },
      where: (f, op, v) => ({ get: async () => {
        queries.push([c, f, v]);
        if (broken.includes(c)) throw new Error('读不到');
        return { docs: (rows[c] || []).filter((d) => d[f] === v).map(({ id, ...d }) => ({ id, data: () => d })) };
      } }),
    }),
  };
}

test('只按门课查、不读整类；卷的 reserve 并到题上；一类失败只空那一类', async () => {
  const db = fakeDb({
    syllabus: [{ id: 'G-DS-1', course: 'DS' }, { id: 'G-OS-1', course: 'OS' }],
    questions: [{ id: 'Q-408-2025-3', course: 'DS', paper: 'X-408-2025' }, { id: 'Q-408-2019-3', course: 'DS', paper: 'X-408-2019' }, { id: 'Q-408-2019-30', course: 'OS', paper: 'X-408-2019' }],
    papers: [{ id: 'X-408-2025', subject: '408', reserve: true }, { id: 'X-408-2019', subject: '408' }, { id: 'X-301-2019', subject: '301' }],
  }, ['exam_profiles']);
  const r = await loadExamCourse(db, 'DS');
  assert.deepEqual(db.queries, [['syllabus', 'course', 'DS'], ['exam_profiles', 'course', 'DS'], ['questions', 'course', 'DS'], ['passages', 'course', 'DS'], ['papers', 'subject', '408']]);
  assert.equal(r.course, 'DS');
  assert.deepEqual(r.syllabus.map((x) => x.id), ['G-DS-1']);
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions.find((q) => q.id === 'Q-408-2025-3').reserve, true);
  assert.equal(r.questions.find((q) => q.id === 'Q-408-2019-3').reserve, undefined);
  assert.deepEqual(r.papers.map((x) => x.id).sort(), ['X-408-2019', 'X-408-2025']);
  assert.deepEqual(r.profiles, []);
  assert.deepEqual(r.failed, ['exam_profiles']);
});

test('认不得的门课：什么都不读', async () => {
  const db = fakeDb({});
  const r = await loadExamCourse(db, '');
  assert.deepEqual(db.queries, []);
  assert.deepEqual(r.questions, []);
});
