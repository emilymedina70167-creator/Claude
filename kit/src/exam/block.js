// 每块的考情（docs/exam-plan.md 第三节）：一块挂的考点和大纲要求、统计（页面算的）、画像里的「怎么考」和坑、代表题、
// 其余能用的真题、我做过哪几道。舞台课每一轮的「这一块在考试里」（context.js）、备课、考情页都用它。
// 纯函数，有测试（tests/exam-block.test.js）。
import { syllabusOfBlock, blockSyllabus } from './mapping.js';
import { blockStats, spanOf } from './stats.js';
import { usable } from './reserve.js';

const yearOf = (q) => Number(q?.year) || Number(String(q?.id || '').match(/^Q-\d{3}-(\d{4})-/)?.[1]) || 0;
const newer = (a, b) => yearOf(b) - yearOf(a) || Number(b.n || 0) - Number(a.n || 0);

/**
 * 代表题：只从能用的里挑（调用的地方先 usable 过）；不同考法各一道，新的年份先；做过的（done）往后排；
 * 英语同一篇最多一道。考法不够 n 种时按新旧补
 */
export function pickReps(questions = [], { n = 3, done = new Set() } = {}) {
  const order = [...questions].sort((a, b) => Number(done.has(a.id)) - Number(done.has(b.id)) || newer(a, b));
  const out = [];
  const hows = new Set();
  const passages = new Set();
  for (const q of order) {
    if (out.length >= n) break;
    if (hows.has(q.tags?.how) || (q.passage && passages.has(q.passage))) continue;
    out.push(q); hows.add(q.tags?.how); if (q.passage) passages.add(q.passage);
  }
  for (const q of order) { if (out.length >= n) break; if (!out.includes(q) && !(q.passage && passages.has(q.passage))) out.push(q); }
  return out;
}

/**
 * 一块的考情；没挂考点（或考试资料还没读到）返回 null。
 * exam：load.js 的 loadExamCourse 的结果；years：留作模考的年份；evidence：这门课的证据（带 exam= 的那些）
 * → { block, course, syl, stats, rank, of, profiles, reps, rest, mine, reserved, span }
 */
export function examForBlock({ block, exam, years = [], evidence = [], n = 3 } = {}) {
  if (!exam || !block) return null;
  const syl = syllabusOfBlock(block, exam.syllabus || []);
  if (!syl.length) return null;
  const ids = new Set(syl.map((x) => x.id));
  const all = (exam.questions || []).filter((q) => q.tags?.syl?.length);
  const span = spanOf(exam.questions || []);
  const mineQs = all.filter((q) => q.tags.syl.some((s) => ids.has(s)));
  const stats = blockStats([...ids], all, { years: span });
  // 在这门课里排第几（按平均每年几分）
  const per = [...blockSyllabus(exam.syllabus || [])].map(([b, s]) => [b, blockStats(s, all, { years: span }).perYear]).sort((a, b) => b[1] - a[1]);
  const rank = per.findIndex(([b]) => b === block) + 1;
  const qIds = new Set(mineQs.map((q) => q.id));
  const seen = new Set();
  const mine = [];
  for (const e of [...evidence].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    if (!e?.exam || !qIds.has(e.exam) || seen.has(e.exam)) continue;
    seen.add(e.exam);
    mine.push({ id: e.exam, at: e.at, ok: !!e.ok, first: Number(e.attempts || 1) <= 1, session: e.session || '' });
  }
  const ok = mineQs.filter((q) => usable(q, years));
  const reps = pickReps(ok.filter((q) => ids.has(q.tags.syl[0])).length ? ok.filter((q) => ids.has(q.tags.syl[0])) : ok, { n, done: seen });
  const profiles = (exam.profiles || []).filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, how: p.how || '', traps: p.traps || [] }));
  return {
    block, course: exam.course, syl: syl.map((x) => ({ id: x.id, title: x.title, level: x.level || '', text: x.text || '' })),
    stats, rank, of: per.length, profiles, reps, rest: ok.filter((q) => !reps.includes(q)).sort(newer), mine,
    reserved: mineQs.length - ok.length, span,
  };
}
