// 考情的统计（docs/exam-plan.md 第三节）：从带标签的真题里**算出来**，不让 Claude 凭记忆说、不让它在一大堆文字里数。
// 一道题的分：主考点算全分，次考点各算一半。留作模考的卷也算进统计（只是题面不出现）。纯函数，有测试（tests/exam-stats.test.js）。
import { blockSyllabus, mapHoles } from './mapping.js';

const yearOf = (q) => Number(q?.year) || Number(String(q?.id || '').match(/^Q-\d{3}-(\d{4})-/)?.[1]) || 0;
const inc = (o, k, n = 1) => { if (k) o[k] = (o[k] || 0) + n; };

/** 这一批题的年份范围（统计按这个算「平均每年」） */
export function spanOf(questions = []) {
  const ys = questions.map(yearOf).filter(Boolean);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 0];
}

function fold(items, [lo, hi]) {
  // items：[{ q, points }]
  const years = [...new Set(items.map((x) => yearOf(x.q)))].sort((a, b) => a - b);
  const points = items.reduce((s, x) => s + x.points, 0);
  const span = Math.max(1, hi - lo + 1);
  const types = {}, hows = {};
  for (const x of items) { inc(types, x.q.type); inc(hows, x.q.tags?.how); }
  const per = (a, b) => { const n = Math.max(0, b - a + 1); return n ? items.filter((x) => yearOf(x.q) >= a && yearOf(x.q) <= b).reduce((s, x) => s + x.points, 0) / n : 0; };
  let trend = 'flat';
  const recent5 = per(hi - 4, hi);
  const before = per(lo, hi - 5);
  if (span >= 6) trend = before === 0 ? (recent5 > 0 ? 'up' : 'flat') : recent5 > before * 1.25 ? 'up' : recent5 < before * 0.75 ? 'down' : 'flat';
  return { n: items.length, years, points, perYear: points / span, types, hows, recent5, before, trend };
}

/** 每个考点：Map<考点, { n, years, points, perYear, types, hows, recent5, before, trend, with: [{ id, n }] }> */
export function nodeStats(questions = [], { years = spanOf(questions) } = {}) {
  const by = new Map();
  const co = new Map();
  for (const q of questions) {
    const syl = q.tags?.syl || [];
    syl.forEach((id, i) => {
      if (!by.has(id)) by.set(id, []);
      by.get(id).push({ q, points: Number(q.points || 0) * (i === 0 ? 1 : 0.5) });
      const w = co.get(id) || new Map();
      for (const o of syl) if (o !== id) w.set(o, (w.get(o) || 0) + 1);
      co.set(id, w);
    });
  }
  const out = new Map();
  for (const [id, items] of by) out.set(id, { ...fold(items, years), with: [...(co.get(id) || [])].map(([o, n]) => ({ id: o, n })).sort((a, b) => b.n - a.n) });
  return out;
}

/** 一块（挂了几个考点）：同一道题只算一次——主考点在这一块全分，只有次考点在这一块算一半 */
export function blockStats(sylIds = [], questions = [], { years = spanOf(questions) } = {}) {
  const set = new Set(sylIds);
  const items = [];
  for (const q of questions) {
    const syl = q.tags?.syl || [];
    if (!syl.some((s) => set.has(s))) continue;
    items.push({ q, points: Number(q.points || 0) * (set.has(syl[0]) ? 1 : 0.5) });
  }
  return fold(items, years);
}

/** 一门课的考点热度：[{ id, title, n, points, perYear, trend, rank }]，按分数排 */
export function courseHeat(questions = [], syllabus = [], { years = spanOf(questions) } = {}) {
  const stats = nodeStats(questions, { years });
  const title = new Map(syllabus.map((n) => [n.id, n.title]));
  return [...stats].map(([id, s]) => ({ id, title: title.get(id) || id, n: s.n, points: s.points, perYear: s.perYear, trend: s.trend }))
    .sort((a, b) => b.points - a.points || b.n - a.n || a.id.localeCompare(b.id)).map((x, i) => ({ ...x, rank: i + 1 }));
}

/**
 * 首页存进 meta/exam 的一门课的缓存（410 分的权重、考情页、体检用；首页不为它订阅整类）：
 * { heat（前 12）, blockPerYear: { 块: 平均每年几分 }, holes: { blocks, nodes }, untagged, n, span }
 */
export function statsCache({ course, questions = [], syllabus = [], curriculum = [] }) {
  const years = spanOf(questions);
  const tagged = questions.filter((q) => q.tags?.syl?.length);
  const map = blockSyllabus(syllabus.filter((n) => n.course === course));
  const blockPerYear = {};
  for (const [b, ids] of map) blockPerYear[b] = blockStats(ids, tagged, { years }).perYear;
  return {
    heat: courseHeat(tagged, syllabus, { years }).slice(0, 12), blockPerYear, holes: mapHoles({ syllabus, curriculum, course }),
    untagged: questions.length - tagged.length, n: questions.length, span: years,
  };
}
