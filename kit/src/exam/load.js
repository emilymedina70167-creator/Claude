// 按门课读考试资料（docs/exam-plan.md 1.1）：开课、备课时只取这一门课的考点、画像、真题、篇章和这一科的卷，
// 不订阅、不读整类（四门课十五年上千道题）。读不到的那一类就是空的、记在 failed 里，开课不为它多等（desk.js 不 await）。
// courseOfBlock 是纯函数（tests/exam-load.test.js）。
import { EXAM_COURSES, subjectOfCourse } from './schema.js';

/** 课程地图块的编号 → 门课：带前缀的照前缀（DS-L2.1 → DS、HM-L1 → HM），不带前缀的是线代 */
export function courseOfBlock(block) {
  const id = String(block || '');
  if (!id) return '';
  const m = id.match(/^([A-Z]{2})-L/);
  if (m) return EXAM_COURSES.includes(m[1]) ? m[1] : '';
  return /^L\d/.test(id) ? 'LA' : '';
}

/** 一门课的考试资料：{ course, syllabus, profiles, questions（带卷的 reserve）, passages, papers, failed } */
export async function loadExamCourse(db, course) {
  const out = { course, syllabus: [], profiles: [], questions: [], passages: [], papers: [], failed: [] };
  if (!EXAM_COURSES.includes(course)) return out;
  const read = async (coll, field, value, key) => {
    try {
      const snap = await db.collection(coll).where(field, '==', value).get();
      out[key] = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    } catch { out.failed.push(coll); }
  };
  // 一个一个读（不并发）：讲课那一边同时也在读教材、证据，别一下子挤上去
  await read('syllabus', 'course', course, 'syllabus');
  await read('exam_profiles', 'course', course, 'profiles');
  await read('questions', 'course', course, 'questions');
  await read('passages', 'course', course, 'passages');
  await read('papers', 'subject', subjectOfCourse(course), 'papers');
  const reserved = new Set(out.papers.filter((p) => p.reserve).map((p) => p.id));
  out.questions = out.questions.map((q) => (reserved.has(q.paper) ? { ...q, reserve: true } : q));
  return out;
}
