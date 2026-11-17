// 学生卡、课前档案按需读（docs/superpowers/specs/2026-11-13-aide-design.md 5.1）：开课时只读这一块附近的十来张，
// 首页补卡、写档案时读这一类全部（一科一百多块，有内容的几十张，小）。读不到的当没有，开课不为它多等。
// 还有下课后的助手和首页的复盘共用的两样：这一块真题的坑表、对上的坑记进 exam_bar。
import { loadExamCourse, courseOfBlock } from '../exam/load.js';
import { assertWrite } from '../memory/schema.js';

const within = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]).catch(() => fallback);
const docsOf = (snap) => (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));

/** 读几张卡（一张一张读，超时、读不到的当没有）：[{ id, block|space, text, src, at, … }] */
export async function loadCards(db, ids = [], { ms = 3000 } = {}) {
  const got = await Promise.all([...new Set(ids)].map((id) => within(db.doc(`cards/${id}`).get().then((s) => (s?.exists ? { id, ...s.data() } : null)), ms, null)));
  return got.filter(Boolean);
}

/** 这一类全部的卡（首页补卡、写档案用） */
export const loadAllCards = (db, { ms = 8000 } = {}) => within(db.collection('cards').get().then(docsOf), ms, []);

/** 这一科的课前档案 */
export const loadBrief = (db, space, { ms = 3000 } = {}) => within(db.doc(`aide_briefs/${space}`).get().then((s) => (s?.exists ? { id: space, ...s.data() } : null)), ms, null);

/** 这一块真题的坑表（考情第 5 批：画像里教研室归纳的）：[{ id, text, qs }]（5 秒读不到当没有） */
export async function trapsFor(db, block) {
  if (!block) return [];
  const ex = await within(loadExamCourse(db, courseOfBlock(block)), 5000, null);
  const syl = new Set((ex?.syllabus || []).filter((n) => (n.blocks || []).includes(block)).map((n) => n.id));
  return (ex?.profiles || []).filter((p) => syl.has(p.id)).flatMap((p) => p.traps || []);
}

/** 复盘里对上的坑记进这一块的 exam_bar（不写进弱点表：弱点表的写入方没有 page）；读最新的再并 */
export async function markTraps(db, block, hit = []) {
  if (!block || !hit.length) return;
  const ref = db.doc(`exam_bar/${block}`);
  const bar = await ref.get().then((r) => (r.exists ? r.data() : null)).catch(() => null);
  assertWrite('page', 'exam_bar');
  await ref.set({ ...(bar || { block, done: [], passed: false, timed: false }), traps: [...new Set([...(bar?.traps || []), ...hit])], at: Date.now() });
}
