// 卷面：一张卷由哪些题组成（spec 6.1）。卷面满分分到「单位」——课程地图的块，加上还没排块的章（章:*）、
// 学习台里还没有的部分（部分:*），所有单位加起来就是满分：缺口一直在卷上占着分，不会因为只学了线代就显得数学快学完了。
// 有真题入库的门课用历年真卷当样本（meta/exam.papers），没有的照卷面结构合成一张卷。纯函数。
import { SUBJECTS, chapterWeight, isChapter, isBlock } from '../memory/score.js';
import { courseOf } from '../memory/space.js';
import { RECENT_X } from './priors.js';

export const SUBJECT_CODE = { math: '301', cs: '408', en: '201', pol: '101' };
const list = (v) => (Array.isArray(v) ? v : []);
const naturally = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

/** 这一科的单位：[{ id, part, subject, points, title }]，points 加起来 = 卷面满分（不按 410 缩放） */
export function units(curriculum = [], subjectKey) {
  const s = SUBJECTS.find((x) => x.key === subjectKey);
  if (!s) return [];
  const all = list(curriculum).filter((b) => b?.id && b.status !== 'void');
  const out = [];
  for (const p of s.parts) {
    const mine = p.course ? all.filter((b) => courseOf(b.id) === p.course && !(p.course === 'LA' && /^[A-Z]{2}-/.test(b.id))) : [];
    const chapters = mine.filter(isChapter).sort((a, b) => naturally(a.id, b.id)).filter((c) => chapterWeight(c) > 0);
    const wsum = chapters.reduce((n, c) => n + chapterWeight(c), 0);
    if (!chapters.length) { out.push({ id: `${p.key}:*`, part: p.key, subject: s.key, points: p.points, title: p.label }); continue; }
    for (const c of chapters) {
      const cpts = (p.points * chapterWeight(c)) / wsum;
      const bs = mine.filter((b) => isBlock(b) && String(b.id).startsWith(`${c.id}.`));
      if (!bs.length) out.push({ id: `${c.id}:*`, part: p.key, subject: s.key, points: cpts, title: c.title || c.id });
      else for (const b of bs) out.push({ id: String(b.id), part: p.key, subject: s.key, points: cpts / bs.length, title: b.title || b.id });
    }
  }
  return out;
}

// 题型只落在对应的部分（英语的卷面按题型分得很清楚：作文只能是写作那一部分）；没写的题型落在整科
const TYPE_PARTS = { essay: ['WR'], translate: ['EN'], cloze: ['EN'], reading: ['RD', 'EN'], newtype: ['RD'] };
const poolFor = (type, us) => {
  const ps = TYPE_PARTS[type];
  const p = ps ? us.filter((u) => ps.includes(u.part)) : us;
  return p.length ? p : us;
};

/** 照卷面结构合成一张卷：[{ unit: null, pool, type, points }]，抽卷时按 pool 里单位的分值比例抽一个 */
export function synthPaper(subjectKey, us, structure) {
  const out = [];
  for (const sec of list(structure?.sections)) {
    const n = sec.to - sec.from + 1;
    const pts = sec.points ?? sec.sum / n;
    for (let i = 0; i < n; i++) out.push({ unit: null, pool: poolFor(sec.type, us), type: sec.type, points: pts });
  }
  return out;
}

/** 卷面样本 { 年份: [[块, 分值, 题型]] } → [{ year, items: [{ unit, type, points }] }]；题分不到满分的补一题 */
export function realPapers(skeletons = {}, us = [], subjectKey) {
  const s = SUBJECTS.find((x) => x.key === subjectKey);
  const ids = new Set(us.map((u) => u.id));
  const partOfCourse = (b) => s?.parts.find((p) => p.course === courseOf(b))?.key;
  const stars = us.filter((u) => u.id.endsWith(':*')).sort((a, b) => b.points - a.points);
  const out = [];
  for (const [year, rows] of Object.entries(skeletons || {})) {
    const items = [];
    for (const [b, points, type] of list(rows)) {
      let unit = ids.has(String(b)) ? String(b) : null;
      if (!unit) { const pk = partOfCourse(b); unit = pk && ids.has(`${pk}:*`) ? `${pk}:*` : null; }
      if (unit) items.push({ unit, type: type || 'answer', points: Number(points) || 0 });
      else items.push({ unit: null, pool: us, type: type || 'answer', points: Number(points) || 0 });
    }
    const got = items.reduce((n, x) => n + x.points, 0);
    const gap = (s?.full || 0) - got;
    // 标签缺了的那部分分：落在分最大的「还没进学习台」单位（没有的话按整科比例抽），不缩放、不丢卷
    if (gap > 1e-9) items.push(stars.length ? { unit: stars[0].id, type: 'answer', points: gap } : { unit: null, pool: us, type: 'answer', points: gap });
    out.push({ year: Number(year), items });
  }
  return out.sort((a, b) => a.year - b.year);
}

/** 抽一卷：最近五年的卷抽中的机会是以前的 RECENT_X 倍；没有卷返回 null */
export function pickPaper(rand, papers = []) {
  if (!papers.length) return null;
  const top = Math.max(...papers.map((p) => p.year));
  const w = papers.map((p) => (p.year >= top - 4 ? RECENT_X : 1));
  let u = rand() * w.reduce((n, x) => n + x, 0);
  for (let i = 0; i < papers.length; i++) { u -= w[i]; if (u < 0) return papers[i].items; }
  return papers.at(-1).items;
}
