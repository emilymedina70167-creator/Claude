// 学习台首页的「离考研多少天」和「这一周」（docs/journey-plan.md）。全是页面按记录算的，不调用 Claude，
// 也不进发给课堂 Claude 的说明（不影响回复的快慢）。纯函数，有测试（tests/memory-journey.test.js）。
//
// 情绪价值照我的口味（profile：语气平实，不夸、不铺垫）：只说真发生了的事——连着学了几天、这周学了多久、
// 哪个知识点上次错了几道这次一上来就对了、哪一块升了一档。没有可说的就不说，不编鼓励的话。
import { toDate, addDays, daysBetween } from './schema.js';
import { voidedIds } from './memo.js';
import { spaceOfId, courseOf, COURSES, SPACES } from './space.js';
import { pointCatalog } from './skills.js';
import { drillId } from './drills.js';

// 考研初试第一天（2026-11-03 我说的：2027 年 12 月 21 日）
export const EXAM_DATE = '2027-12-21';
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/** 离考试还有几天（考试那天是 0，过了是负数） */
export const daysLeft = (today = toDate(Date.now()), exam = EXAM_DATE) => daysBetween(today, exam);

/** 离下一个本地午夜还有多少毫秒（页面一直开着时，到点把「今天」换成新的一天）；至少 1 秒，免得在午夜那一刻连着触发 */
export function msToNextDay(now = Date.now()) {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - d.getTime());
}

/** 顶上那一行：离考研 413 天 */
export function countdownText(today = toDate(Date.now()), exam = EXAM_DATE) {
  const n = daysLeft(today, exam);
  if (n > 0) return `离考研 ${n} 天`;
  return n === 0 ? '今天考研' : '';
}

/** 哪几天学过（有作答、说话、想记忆点、补记这些动静的日子）：Set<YYYY-MM-DD> */
export function studyDays(evidence = []) {
  const out = new Set();
  for (const e of evidence || []) {
    if (!e || !e.at || (e.src === 'event' && ['open', 'end'].includes(e.kind))) continue;
    const d = toDate(e.at);
    if (d) out.add(d);
  }
  return out;
}

/** 连着学了几天：到今天（今天还没学就到昨天）为止，一天不断地往回数 */
export function streak(days, today = toDate(Date.now())) {
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

/** 这 7 天和前 7 天各学了几分钟（按每节课报告里去掉空档的时长），几天有动静 */
export function weekMinutes(mem = {}, today = toDate(Date.now())) {
  const ss = list(mem.sessions).filter((s) => s && s.report && Number(s.report.activeMs) > 0);
  const sum = (from, to) => Math.round(ss.filter((s) => { const d = s.date || toDate(s.startedAt); return d >= from && d <= to; }).reduce((n, s) => n + Number(s.report.activeMs), 0) / 60000);
  const days = studyDays(mem.evidence);
  const span = (from, to) => [...days].filter((d) => d >= from && d <= to).length;
  return {
    now: sum(addDays(today, -6), today), before: sum(addDays(today, -13), addDays(today, -7)),
    daysNow: span(addDays(today, -6), today), daysBefore: span(addDays(today, -13), addDays(today, -7)),
  };
}

/**
 * 真实的进步（最近 days 天里）：
 * - 知识点：以前哪节课错过（归类里 fail > 0），最近一节一上来就对、没再错（first > 0、fail 0）
 * - 掌握：升到「基础题过」「复现通过」的（log 里那天的记录）
 * 返回 [{ kind: 'point' | 'mastery', name, text, date }]，新的在前
 */
export function improvements(mem = {}, { today = toDate(Date.now()), days = 14, space = '' } = {}) {
  const since = addDays(today, -(days - 1));
  const gone = voidedIds(mem);
  const cat = pointCatalog(mem.sessions, mem.mastery);
  const name = (p) => cat[p]?.title || String(p).split('#')[1] || p;
  const inSpace = (id) => !space || spaceOfId(id) === space;
  const ss = list(mem.sessions).filter((s) => s?.skills?.sum && s.date).sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.startedAt || 0) - (b.startedAt || 0));
  const out = [];
  const seen = new Set();
  for (let i = ss.length - 1; i >= 0; i--) {
    const s = ss[i];
    if (s.date < since) break;
    for (const [p, x] of Object.entries(s.skills.sum)) {
      if (seen.has(p) || !inSpace(p) || !(Number(x.first) > 0) || Number(x.fail) > 0) continue;
      const before = ss.slice(0, i).reverse().find((t) => Number(t.skills.sum[p]?.fail) > 0);
      if (!before) continue;
      seen.add(p);
      out.push({ kind: 'point', name: name(p), date: s.date, text: `${name(p)}：${before.date.slice(5).replace('-', '/')} 错了 ${before.skills.sum[p].fail} 道，${s.date === today ? '今天' : `${s.date.slice(5).replace('-', '/')} `}一上来就对了` });
    }
  }
  const title = (id) => { const c = list(mem.curriculum).find((b) => String(b.id) === String(id).split('#')[0]); return id.includes('#') ? name(id) : c?.title || id; };
  for (const m of list(mem.mastery)) {
    if (!m?.id || gone.has(`mastery/${m.id}`) || !inSpace(m.id)) continue;
    const up = list(m.log).filter((l) => l?.field === 'state' && ['基础题过', '复现通过'].includes(l.to) && l.date >= since && l.date <= today).at(-1);
    if (!up || m.state !== up.to) continue;
    out.push({ kind: 'mastery', name: title(m.id), date: up.date, text: `${title(m.id)}：${up.to === '复现通过' ? `隔了几天还做得对，复现通过${m.tier ? `（第 ${m.tier} 天那档）` : ''}` : '两道不同的题一次做对，基础题过了'}` });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * 每一科讲到哪：块一共几块、讲过（掌握不是「未学」）几块、过了（基础题过 / 复现通过）几块。
 * 一科里只有一门课的块时写那门课的名字（课程地图里的数学现在只有线代，写「数学 19 / 20」像是数学快学完了）
 */
export function progress(mem = {}) {
  const gone = voidedIds(mem);
  const state = new Map(list(mem.mastery).filter((m) => m?.id && !gone.has(`mastery/${m.id}`) && !String(m.id).includes('#')).map((m) => [String(m.id), m.state]));
  const out = {};
  for (const k of Object.keys(SPACES)) out[k] = { space: k, label: SPACES[k].label, total: 0, taught: 0, passed: 0 };
  for (const b of list(mem.curriculum)) {
    if (!b?.id || !/\.\d+\.\d+$/.test(String(b.id))) continue;
    const k = spaceOfId(b.id);
    if (!out[k]) continue;
    const st = state.get(String(b.id)) || '未学';
    out[k].total++;
    (out[k].courses ||= new Set()).add(courseOf(b.id));
    if (st !== '未学') out[k].taught++;
    if (st === '基础题过' || st === '复现通过') out[k].passed++;
  }
  return Object.values(out).filter((x) => x.total).map(({ courses, ...x }) => ({ ...x, label: courses.size === 1 ? COURSES[[...courses][0]].name : x.label }));
}

/**
 * 课前热身：上一节「下次先测」的知识点，题库里有那节课上的原题就挑出来（最多 n 道），开一节练习（页面判分，不调用 Claude）。
 * last：上一节（sessions，带 skills）；next：lessonLines(…).next（[{ p }]）。返回题库编号
 */
export function warmupDrills(mem = {}, last = null, next = [], { n = 3 } = {}) {
  if (!last?.skills?.items || !next.length) return [];
  const want = new Set(next.map((x) => x.p));
  const drills = new Map(list(mem.drills).filter((d) => d && d.status !== 'void' && !d.broken).map((d) => [String(d.id), d]));
  const out = [];
  for (const it of last.skills.items) {
    if (out.length >= n || !want.has(it.p)) continue;
    const comp = String(it.k || '').split('|')[0];
    const id = drillId(last.id, comp);
    if (drills.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 到期的复现组多的时候：每天做 perDay 组，几天做完（3 组以内不说） */
export function backlogDays(total, perDay = 3) {
  return total > perDay ? Math.ceil(total / perDay) : 0;
}

/**
 * 「这一周」那张卡上的几句话（按真实记录，没有可说的就不说）：[{ k, text }]
 * k：streak 连着学 / week 这一周 / better 进步 / done 今天的都做完了
 */
export function weekLines(mem = {}, { today = toDate(Date.now()), space = '', dueToday = 0, recallToday = 0 } = {}) {
  const lines = [];
  const days = studyDays(mem.evidence);
  const st = streak(days, today);
  if (st >= 2) lines.push({ k: 'streak', text: `连着学了 ${st} 天${days.has(today) ? '' : '（今天还没开始）'}` });
  const w = weekMinutes(mem, today);
  if (w.now || w.before) {
    const diff = w.now - w.before;
    lines.push({ k: 'week', text: `这 7 天学了 ${w.now} 分钟、${w.daysNow} 天${w.before ? `；前 7 天 ${w.before} 分钟${diff > 0 ? `，多了 ${diff} 分钟` : diff < 0 ? `，少了 ${-diff} 分钟` : ''}` : ''}` });
  }
  // 今天真做过复现或想过记忆点，才说「都做完了」（全新的学习台上完第一节课，不该说做完了从来没有过的事）
  const didToday = list(mem.reviews).some((r) => r?.last === today && r?.result) || list(mem.evidence).some((e) => e?.src === 'recall' && toDate(e.at) === today);
  if (days.has(today) && !dueToday && !recallToday && didToday) lines.push({ k: 'done', text: '今天到期的复现和要记的都做完了' });
  for (const x of improvements(mem, { today, space }).slice(0, 3)) lines.push({ k: 'better', text: x.text });
  return lines;
}
