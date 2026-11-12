// 真题级（docs/exam-plan.md 第五节）：这一块的原真题（证据带 exam=，第一次做）或教研室对标真题出的、过了检查的新题
// （d-lab- 的题、带 like=）在**第一次碰到它的那节课**里第一次作答就做对、没看提示、没标没把握，算「真题级过了」；
// 同时在建议用时以内，算「限时过了」。课上老师当场改数出的题不算（没人核过它是不是真题的难度）；原题再做对也不算（rule-rev-2）。
// 不写进掌握的五种状态，结果存进 exam_bar（每块一条，页面算的缓存）；asOf 退回某一天以前（410 分的「这 7 天」要用）。
// 纯函数，有测试（tests/exam-bar.test.js）。
import { structureOf } from './structure.js';

const subjectOf = (q) => String(q.subject || String(q.id || '').match(/^Q-(\d{3})-/)?.[1] || '408');
const yearOf = (q) => Number(q.year) || Number(String(q.id || '').match(/^Q-\d{3}-(\d{4})-/)?.[1]) || 0;
const BLOCKERS = new Set(['hint', 'reveal', 'giveup', 'stage-hint']);

/** 建议用时（毫秒）：分值 × 这门考试的分钟数 / 卷面总分 × 0.85（留检查的时间），不让 Claude 估 */
export function suggestMs(q) {
  const s = structureOf(subjectOf(q), yearOf(q) || 2020);
  return (Number(q.points || 0) * (s?.minutes || 180) / (s?.total || 150)) * 0.85 * 60000;
}

/**
 * 一块的真题级：{ block, done: [{ id, at, ok, first, ms, session }], passed, timed, traps, at }。
 * questions：这一块的真题（能用的、留着的都给：留着的本来就不会有作答）；evidence：证据（带 exam / like 的那些）；
 * prev：上一次算的（坑由复盘对上的写进来，这里留着）；asOf：只看这个时刻以前的证据
 */
export function barOf({ block, questions = [], evidence = [], prev = null, asOf = null, now = Date.now() } = {}) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const evs = evidence.filter((e) => e && (asOf == null || Number(e.at) <= asOf)).sort((a, b) => (a.at || 0) - (b.at || 0));
  // 一次作答算哪一道真题：exam= 的原题；like= 只认教研室出的题（d-lab-）
  const keyOf = (e) => (e.exam && byId.has(e.exam) ? e.exam : e.like && byId.has(e.like) && /^d-lab-/.test(String(e.comp || '')) ? `${e.like}~${e.comp}` : '');
  const firstSession = new Map();
  const done = [];
  let passed = false, timed = false, passedAt = null;
  for (const e of evs) {
    if (e.kind === 'hint' || e.kind === 'sure' || BLOCKERS.has(e.kind)) continue;
    const k = keyOf(e);
    if (!k || e.ok === undefined) continue;
    if (!firstSession.has(k)) firstSession.set(k, e.session || '');
    if (done.some((d) => d.key === k)) continue; // 只看第一次作答
    const qid = k.split('~')[0];
    const clean = !!e.ok && Number(e.attempts || 1) <= 1 && e.sure !== false && (e.session || '') === firstSession.get(k)
      && !evs.some((h) => BLOCKERS.has(h.kind) && h.session === e.session && h.comp && h.comp === e.comp && (h.at || 0) <= (e.at || 0))
      // 「有把握吗」点了没把握（confidence.js 另记一条 sure 动作）
      && !evs.some((h) => h.kind === 'sure' && h.detail?.sure === false && h.session === e.session && h.comp && h.comp === e.comp);
    const ms = Number.isFinite(e.ms) ? e.ms : null;
    done.push({ key: k, id: qid, at: e.at, ok: !!e.ok, first: Number(e.attempts || 1) <= 1, ms, session: e.session || '' });
    if (clean) { passed = true; passedAt ??= e.at ?? null; if (ms != null && ms <= suggestMs(byId.get(qid))) timed = true; }
  }
  // passedAt：第一次过的时刻（410 分的「这 7 天」照它退回 7 天前）
  return { block, done: done.map(({ key: _, ...d }) => d), passed, timed, ...(passedAt != null ? { passedAt } : {}), traps: prev?.traps || [], at: now };
}

/** 只差 at（算的时间）的不算变了：首页每次自检都重算，变了才写 */
export function barsChanged(prev, next) {
  if (!prev) return true;
  const strip = ({ at: _, ...x } = {}) => JSON.stringify(x);
  return strip(prev) !== strip(next);
}
