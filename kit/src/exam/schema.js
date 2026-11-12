// 考试的资料（docs/exam-plan.md 第一节）：真题、考点、篇章、画像、考情动态、开发那边入库的收件箱。
// 不进记忆库：记忆库每一类首页都整类订阅、开课整类读、自检把指纹写进一个文档，四门课十五年上千道题这样走会拖垮开课、
// 撑爆 meta/ledger。这几类像教材那样按需读（load.js：开课时只取这一门课的）。
// 纯函数，有测试（tests/exam-schema.test.js）。不 import memory/schema.js：那边的 canWrite 要 import 这边，免得绕圈。
//
// 谁写：教研室、开发那边都不直接写库（教研室的回答由页面并进来），所以角色只有 page（页面并收件箱、算缓存）和
// chat（开发那边修数据）；是谁做的写在每一条的 by 字段里（dev / lab / me / page）。

/** 门课（课程地图的前缀，线代在课程地图里不带前缀，这里写 LA）和它在哪一科 */
export const EXAM_COURSES = ['LA', 'HM', 'PS', 'DS', 'CO', 'OS', 'CN', 'EN', 'PO'];
const COURSE_SPACE = { LA: 'math', HM: 'math', PS: 'math', DS: 'cs', CO: 'cs', OS: 'cs', CN: 'cs', EN: 'en', PO: 'pol' };
/** 科目代码 → 学习台的哪一科（政治在学习台里没有课，单独一个 pol） */
export const EXAM_SUBJECTS = { 101: 'pol', 201: 'en', 301: 'math', 408: 'cs' };
const SPACE_SUBJECT = { pol: '101', en: '201', math: '301', cs: '408' };
export const EXAM_SPACES = ['math', 'cs', 'en', 'pol'];

export const courseSpace = (course) => COURSE_SPACE[String(course || '').toUpperCase()] || '';
export const subjectOfCourse = (course) => SPACE_SUBJECT[courseSpace(course)] || '';

// 题型的键（和 taxonomy.js 的 TYPES 一致，tests/exam-structure.test.js 守着）
const TYPE_KEYS = ['single', 'multi', 'fill', 'answer', 'comp', 'cloze', 'reading', 'newtype', 'translate', 'essay', 'analysis'];
export const VERIFY_HOW = ['engine', 'exact', 'double', 'book', 'none'];

const SUBJ = '(?:101|201|301|408)';
const NODE = '(?:LA|HM|PS|DS|CO|OS|CN|EN|PO)-\\d+(?:\\.\\d+){0,3}';

/**
 * 每一类：label、writers、id（编号的规则）、required、enums。
 * 编号避开记忆库已有的（K12、T-…、R、W、L2-07、p-…、d-…）；篇章用 PA-（P- 和关于我的 p- 只差大小写，PS- 是概率的门课前缀）
 */
export const EXAM_COLLECTIONS = {
  syllabus: {
    label: '考点（大纲）', writers: ['page', 'chat'],
    id: { re: new RegExp(`^G-${NODE}$`), eg: 'G-DS-6.4、G-LA-2.3、G-HM-3.2.1' },
    required: ['course', 'space', 'title', 'year'],
    // void：重新切大纲时这一份里没有了（编号不删：以前的标签还指着它）
    enums: { course: EXAM_COURSES, space: EXAM_SPACES, level: ['了解', '理解', '掌握', '会用', ''], status: ['active', 'void', ''] },
  },
  papers: {
    label: '真题卷', writers: ['page', 'chat'],
    id: { re: new RegExp(`^X-${SUBJ}-\\d{4}$`), eg: 'X-408-2019' },
    required: ['subject', 'year', 'space', 'total', 'count'],
    enums: { subject: Object.keys(EXAM_SUBJECTS), space: EXAM_SPACES },
  },
  questions: {
    label: '真题', writers: ['page', 'chat'],
    id: { re: new RegExp(`^Q-${SUBJ}-\\d{4}-\\d{1,2}$`), eg: 'Q-408-2019-23、Q-301-2021-17' },
    required: ['paper', 'n', 'type', 'points', 'stem', 'space', 'course'],
    enums: { type: TYPE_KEYS, space: EXAM_SPACES, course: EXAM_COURSES },
  },
  passages: {
    label: '篇章', writers: ['page', 'chat'],
    id: { re: new RegExp(`^PA-${SUBJ}-\\d{4}-[A-Za-z0-9]+$`), eg: 'PA-201-2020-T1' },
    required: ['paper', 'text', 'space', 'course'],
    enums: { space: EXAM_SPACES, course: EXAM_COURSES },
  },
  exam_profiles: {
    label: '考点的画像', writers: ['page', 'chat'],
    id: { re: new RegExp(`^G-${NODE}$`), eg: '和考点同号：G-DS-6.4' },
    required: ['course', 'space'],
    enums: { course: EXAM_COURSES, space: EXAM_SPACES },
  },
  exam_intel: {
    label: '考情动态', writers: ['page', 'chat'],
    id: { re: /^ix-[A-Za-z0-9_-]+$/, eg: 'ix-2026-line' },
    required: ['kind', 'text', 'at'],
    enums: { kind: ['brochure', 'catalog', 'line', 'syllabus', 'ratio', 'other'] },
  },
  // 只给开发那边入库用：它写进来，页面照规矩查过再并进上面几类（examdesk.js），并完删掉、写一份回执
  exam_inbox: {
    label: '考试资料的收件箱', writers: ['chat', 'page'],
    id: { re: /^[A-Za-z0-9_.-]+$/, eg: 'X-408-2019、syllabus-DS-2026' },
    required: ['kind'],
    enums: { kind: ['paper', 'syllabus', 'tags', 'drills'] },
  },
  exam_inbox_log: {
    label: '收件箱的回执', writers: ['page'],
    id: { re: /^[A-Za-z0-9_.-]+$/, eg: '和收件箱那条同号' },
    required: ['at'],
    enums: {},
  },
};

/** role 能不能写 coll；不是考试资料的集合返回 null（交给记忆库那边判） */
export function canWriteExam(role, coll) {
  const c = EXAM_COLLECTIONS[coll];
  return c ? c.writers.includes(role) : null;
}

const empty = (v) => v === undefined || v === null || v === '';

/** 一次写（整份文档）守不守规矩：返回问题的列表（写法和 memory/writer.js 的 validateWrite 一样）；不是考试资料返回空的 */
export function validateExam(coll, id, data) {
  const c = EXAM_COLLECTIONS[coll];
  if (!c || !data || typeof data !== 'object') return [];
  const out = [];
  const key = String(id ?? '');
  if (!c.id.re.test(key)) out.push(`编号「${key}」不对（${c.label}的编号像 ${c.id.eg}）`);
  for (const f of c.required) if (empty(data[f])) out.push(`缺了必填的 ${f}`);
  for (const [f, vals] of Object.entries(c.enums)) if (!empty(data[f]) && !vals.includes(String(data[f]))) out.push(`${f} 是「${data[f]}」，只能是 ${vals.filter(Boolean).join(' / ')}`);
  if (coll === 'questions' && data.verified && !VERIFY_HOW.includes(data.verified.how)) out.push(`verified.how 是「${data.verified.how}」，只能是 ${VERIFY_HOW.join(' / ')}`);
  return out.map((m) => `${c.label} ${key}：${m}`);
}

/** 一条考试资料在哪一科：先看 space，没有按门课，再没有按编号里的科目代码（考点的编号里是门课） */
export function examSpaceOf(doc = {}) {
  if (EXAM_SPACES.includes(doc.space)) return doc.space;
  if (courseSpace(doc.course)) return courseSpace(doc.course);
  const id = String(doc.id || '');
  const g = id.match(/^G-([A-Z]{2})-/);
  if (g) return courseSpace(g[1]);
  const s = id.match(/^(?:X|Q|PA)-(\d{3})-/);
  return s ? EXAM_SUBJECTS[s[1]] || '' : '';
}
