// 下一步学什么（docs/exam-plan.md 第五节）：每块「还能攒多少分」= 这一块在 410 里值多少 ×（1 − 现在攒到几成），
// 前置的块（课程地图的 requires）还没过基础题的排在它前面；到期的复现 ×1.2、复盘对上过真题的坑 ×1.3。
// 出：每科前五块、四科的时间怎么分（按还能攒的分，每科至少一成）、这一周哪一科偏了（实际学的时间不到它该占的一半）。
// 首页「下一步」、后方的工作单（该备的课先排它）用。不调用 Claude。纯函数，有测试（tests/exam-priority.test.js）。
import { addDays } from '../memory/schema.js';

const SPACES = ['math', 'cs', 'en'];
const PASSED = new Set(['基础题过', '复现通过']);
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * blocks：{ 块: { points, got, title, subject（math / cs / en / pol）} }（测量 forecast/ 的每块：卷面期望分值、现在平均能拿几分）；
 * curriculum（requires）、mastery、dueBlocks（到期复现组挂的块）、traps：{ 块: [坑] }（exam_bar 的 traps）、sessions（算这一周的时间）
 */
export function priority({ blocks = {}, curriculum = [], mastery = [], dueBlocks = new Set(), traps = {}, sessions = [], today = '', n = 5 } = {}) {
  const st = new Map(mastery.map((m) => [String(m.id), m.state]));
  const req = new Map(curriculum.filter((c) => Array.isArray(c.requires) && c.requires.length).map((c) => [String(c.id), c.requires.map(String)]));
  const rows = new Map();
  for (const [id, b] of Object.entries(blocks)) {
    if (!SPACES.includes(b.subject)) continue;
    const left = Math.max(0, Number(b.points || 0) - Number(b.got || 0));
    let score = left;
    const why = [];
    if (left > 0) why.push(`还能攒 ${round1(left)} 分`);
    if (dueBlocks.has(id)) { score *= 1.2; why.push('复现到期了'); }
    if (traps[id]?.length) { score *= 1.3; why.push('复盘时对上过真题的坑（踩过）'); }
    rows.set(id, { id, title: b.title || id, space: b.subject, left: round1(left), score, why });
  }
  // 前置还没过基础题：至少和依赖它的那一块一样急，排在它前面
  for (const [id, need] of req) {
    const me = rows.get(id);
    if (!me) continue;
    for (const p of need) {
      const r = rows.get(p);
      if (!r || PASSED.has(st.get(p))) continue;
      if (r.score < me.score) { r.score = me.score; r.before = id; }
      r.why.push(`「${me.title}」要先过这一块`);
    }
  }
  const top = {};
  for (const sp of SPACES) {
    const list = [...rows.values()].filter((r) => r.space === sp && r.score > 0).sort((a, b) => b.score - a.score || (a.before === b.id ? -1 : b.before === a.id ? 1 : 0) || a.id.localeCompare(b.id));
    // 前置挪到依赖它的那一块前面（分一样时上面的排序已经照顾到了；这里管分不一样的）
    for (let i = 0; i < list.length; i++) {
      const dep = list[i].before && list.findIndex((x) => x.id === list[i].before);
      if (Number.isInteger(dep) && dep >= 0 && dep < i) list.splice(dep, 0, list.splice(i, 1)[0]);
    }
    top[sp] = list.slice(0, n).map(({ id, title, left, why }) => ({ id, title, left, why: why.join('；') }));
  }
  // 四科（有课的三科）的时间：每科先给一成，其余七成按还能攒的分
  const leftOf = Object.fromEntries(SPACES.map((sp) => [sp, [...rows.values()].filter((r) => r.space === sp).reduce((s, r) => s + r.left, 0)]));
  const sum = Object.values(leftOf).reduce((a, b) => a + b, 0);
  const free = 1 - 0.1 * SPACES.length;
  const split = Object.fromEntries(SPACES.map((sp) => [sp, 0.1 + (sum ? (free * leftOf[sp]) / sum : free / SPACES.length)]));
  // 这一周：每科实际学了多少分钟，不到该占的一半就是偏了
  const from = today ? addDays(today, -6) : '';
  const mins = Object.fromEntries(SPACES.map((sp) => [sp, 0]));
  for (const s of sessions) {
    const d = s.date || '';
    if (!s.report?.activeMs || !SPACES.includes(s.space) || (from && (d < from || d > today))) continue;
    mins[s.space] += Number(s.report.activeMs) / 60000;
  }
  const total = Object.values(mins).reduce((a, b) => a + b, 0);
  const lag = total ? SPACES.filter((sp) => mins[sp] < split[sp] * total * 0.5).map((sp) => ({ space: sp, actual: Math.round(mins[sp]), should: Math.round(split[sp] * total) })) : [];
  return { top, split, lag };
}
