// 双人打标签（docs/exam-plan.md 第二节第 4 步）：每道题交给两个互不知道的助手各打一遍（同一份说明、同一张词表、
// 这门课的考点树和课程地图），比主考点：一致的直接收，不一致的交第三个助手看两份定。一批的主考点一致率 ≥ 90% 才算合格。
// tools/exam.mjs 的 tagprep / tagmerge / tagapply 用这里的函数。纯函数，有测试（tests/exam-tagging.test.js）。
import { HOW, TYPES } from './taxonomy.js';

export const AGREE_MIN = 0.9;
const one = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const qText = (q) => [`### ${q.id}（第 ${q.n} 题，${TYPES[q.type] || q.type}，${q.points} 分）`, q.stem, ...Object.entries(q.options || {}).map(([k, v]) => `${k}. ${v}`), q.answer ? `答案：${q.answer}` : '', q.analysis ? `解析：${one(q.analysis, 600)}` : ''].filter(Boolean).join('\n');
const sylLine = (n) => `- ${n.id} ${n.title}${n.level ? `（${n.level}）` : ''}${n.text ? `：${one(n.text, 80)}` : ''}`;
const FORMAT = '题 Q-…｜主考点,次考点｜考法｜难度｜难度的依据｜坑：一两句话';

/** 打标签的出题单：说明、考法词表、考点树、课程地图里这门课的块、题（题面、选项、答案、解析） */
export function tagPrompt({ questions = [], syllabus = [], curriculum = [], course = '' }) {
  const how = HOW[course] || {};
  const prefix = course === 'LA' ? /^L\d/ : new RegExp(`^${course}-L`);
  const blocks = curriculum.filter((b) => b.level === 'block' && prefix.test(String(b.id)));
  return [
    `你给考研真题打标签。下面是 ${questions.length} 道题、这门课的考点树（考试大纲切出来的）、考法词表和学习台的课程地图。每道题写一行：`,
    `${FORMAT}`,
    '- 主考点：这道题主要考的那一个考点（考点树里的编号，挑最细的那一层）；次考点最多两个，没有就不写。',
    '- 考法：只能写词表里的一个（写键或中文都行）。',
    '- 难度：1～5 的整数（1 是送分、3 是这门课真题的平均水平、5 是全卷最难的那几道），依据写和哪道题比（「比 2019-41 多一层」），不写空话。',
    '- 坑：学生最容易在哪里错，一两句话、要具体（「把 FIFO 当成 LRU 换出」）；想不出就写「坑：」后面空着。',
    '只写这些行，不要别的话。考点、考法只能从下面挑，不许自己编。',
    `## 考法词表\n${Object.entries(how).map(([k, v]) => `- ${k}：${v}`).join('\n')}`,
    `## 考点树\n${syllabus.map(sylLine).join('\n')}`,
    blocks.length ? `## 课程地图里这门课的块（参考：考点和哪一块对得上）\n${blocks.map((b) => `- ${b.id} ${b.title || ''}`).join('\n')}` : '',
    `## 题\n${questions.map(qText).join('\n\n')}`,
  ].filter(Boolean).join('\n\n');
}

const HOW_ZH = (course) => Object.fromEntries(Object.entries(HOW[course] || {}).map(([k, v]) => [v, k]));

/** 读回一份：{ tags: { [qid]: { syl, how, difficulty: { est, basis }, traps } }, problems } */
export function parseTags(text, { ids = null, course = '' } = {}) {
  const tags = {};
  const problems = [];
  const zh = HOW_ZH(course);
  const want = ids ? new Set(ids) : null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s*[｜|]\s*/);
    const m = parts[0].match(/^题\s*(Q-\d{3}-\d{4}-\d{1,2})$/);
    if (!m || parts.length < 4) { problems.push(`看不懂：${one(line, 60)}`); continue; }
    const id = m[1];
    if (want && !want.has(id)) { problems.push(`${id} 不在这一批里`); continue; }
    const syl = parts[1].split(/\s*[,，、]\s*/).filter(Boolean);
    const how = zh[parts[2]] || parts[2];
    const est = Number(parts[3]);
    const basis = parts[4] || '';
    const trap = (parts.slice(5).join('｜').replace(/^坑[：:]\s*/, '') || '').trim();
    tags[id] = { syl, how, difficulty: { est, basis }, traps: trap ? [trap] : [] };
  }
  return { tags, problems };
}

/**
 * 比两份：主考点一样算一致（次考点取两份共有的；考法不一样取 a 的、记 disagree: 'how'；难度取平均四舍五入）；
 * 不一致的（或只有一份打了的）列进 conflicts。rate = 一致的 / 两份里出现过的题数
 */
export function mergeTags(a = {}, b = {}) {
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const agreed = {};
  const conflicts = [];
  for (const id of ids) {
    const x = a[id], y = b[id];
    if (!x || !y || x.syl?.[0] !== y.syl?.[0]) { conflicts.push({ id, a: x || null, b: y || null }); continue; }
    const rest = (x.syl || []).slice(1).filter((s) => (y.syl || []).includes(s));
    const ests = [x.difficulty?.est, y.difficulty?.est].filter((n) => Number.isFinite(n));
    agreed[id] = {
      syl: [x.syl[0], ...rest], how: x.how,
      ...(ests.length ? { difficulty: { est: Math.round(ests.reduce((s, n) => s + n, 0) / ests.length), basis: x.difficulty?.basis || y.difficulty?.basis || '' } } : {}),
      traps: [...new Set([...(x.traps || []), ...(y.traps || [])])],
      ...(x.how !== y.how ? { disagree: 'how' } : {}),
    };
  }
  return { agreed, conflicts, rate: ids.length ? Object.keys(agreed).length / ids.length : 1 };
}

/** 第三个人看两份理由定：出题单 */
export function settlePrompt({ conflicts = [], questions = [], syllabus = [], course = '' }) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const side = (t) => (t ? `${(t.syl || []).join(',')}｜${t.how}｜${t.difficulty?.est ?? ''}｜${t.difficulty?.basis || ''}｜坑：${(t.traps || []).join('；')}` : '（没打）');
  return [
    `两个人给下面 ${conflicts.length} 道考研真题打的主考点不一样。你看题、看两份，定一份。每道题写一行，格式和他们的一样：`,
    FORMAT,
    `## 考法词表\n${Object.entries(HOW[course] || {}).map(([k, v]) => `- ${k}：${v}`).join('\n')}`,
    `## 考点树\n${syllabus.map(sylLine).join('\n')}`,
    `## 题和两份\n${conflicts.map((c) => `${byId.get(c.id) ? qText(byId.get(c.id)) : `### ${c.id}`}\n甲：${side(c.a)}\n乙：${side(c.b)}`).join('\n\n')}`,
  ].join('\n\n').replace(/他们/g, '两份');
}

/** 第三个人的回答 → { [qid]: tags（settled: true）}；只收冲突里的题 */
export function settle(conflicts = [], text = '', { course = '' } = {}) {
  const { tags } = parseTags(text, { ids: conflicts.map((c) => c.id), course });
  return Object.fromEntries(Object.entries(tags).map(([id, t]) => [id, { ...t, settled: true }]));
}
