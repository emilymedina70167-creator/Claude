// 考点 ↔ 课程地图（docs/exam-plan.md 第三节）：考点挂在哪几块（syllabus.blocks，多对多，教研室 / 开发那边挂），
// 一块挂了哪些考点、哪些块还没挂、哪些考点还没有块（课程地图漏了），映射时课程地图的指纹（变了就要重挂）。
// 纯函数，有测试（tests/exam-mapping.test.js）。

const live = (syllabus) => (syllabus || []).filter((n) => n && n.status !== 'void');

/** 块 → 挂在它上面的考点编号 */
export function blockSyllabus(syllabus = []) {
  const out = new Map();
  for (const n of live(syllabus)) for (const b of n.blocks || []) { if (!out.has(b)) out.set(b, []); out.get(b).push(n.id); }
  return out;
}

/** 这一块挂的考点（整条） */
export const syllabusOfBlock = (block, syllabus = []) => live(syllabus).filter((n) => (n.blocks || []).includes(block));

const inCourse = (course) => (id) => (course === 'LA' ? /^L\d/.test(String(id)) : String(id).startsWith(`${course}-L`));

/** 漏挂的：这门课的块没挂考点的、叶子考点没挂块的 */
export function mapHoles({ syllabus = [], curriculum = [], course }) {
  const nodes = live(syllabus).filter((n) => n.course === course);
  const parents = new Set(nodes.map((n) => n.parent).filter(Boolean));
  const mapped = blockSyllabus(nodes);
  const blocks = curriculum.filter((b) => b.level === 'block' && b.status !== 'void' && inCourse(course)(b.id)).map((b) => String(b.id));
  return {
    blocks: blocks.filter((b) => !mapped.has(b)),
    nodes: nodes.filter((n) => !parents.has(n.id) && !(n.blocks || []).length).map((n) => n.id),
  };
}

/** 这门课课程地图的指纹（块的编号和标题）：映射时写进 syllabus.mapSig，以后对不上就是课程地图改过、要重挂 */
export function mapSig(curriculum = [], course) {
  const s = curriculum.filter((b) => b.level === 'block' && inCourse(course)(b.id)).map((b) => `${b.id}=${b.title || ''}`).sort().join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
