// 按考点树补课程地图的章（docs/exam-plan.md 第二节「课程地图补门课」）：考点树的每个一级节点一章，只到章（块由备课、教研室以后排），
// 410 分的进度从此不缺块——没排课的章分照样占着、攒到的是 0，缺口一眼看得到。课程地图只有 chat / me 能写：
// tools/exam.mjs skeleton 打印 ArtifactData batch，开发那边写。纯函数，有测试（tests/exam-skeleton.test.js）。

const strip = (t) => String(t || '').replace(/^\s*第\s*[\d一二三四五六七八九十]+\s*[章讲节]\s*/, '').replace(/\s+/g, '');
const grams = (s) => { const out = new Set(); for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2)); return out; };
function alike(a, b) {
  const x = strip(a), y = strip(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const gx = grams(x), gy = grams(y);
  const both = [...gx].filter((g) => gy.has(g)).length;
  return gx.size + gy.size ? (2 * both) / (gx.size + gy.size) >= 0.5 : false;
}

/** 这门课还缺的章：[{ id, level: 'lecture', title: '第N章 …', from: 考点编号, by: 'dev' }]（课程地图里已有的跳过） */
export function skeleton({ course, nodes = [], curriculum = [] }) {
  const prefix = course === 'LA' ? '' : `${course}-`;
  const re = new RegExp(`^${prefix}L(\\d+)$`);
  const chapters = curriculum.filter((c) => re.test(String(c.id)));
  let next = Math.max(0, ...chapters.map((c) => Number(String(c.id).match(re)[1]))) + 1;
  const out = [];
  for (const n of nodes.filter((x) => x.course === course && !x.parent && /^G-[A-Z]{2}-\d+$/.test(x.id))) {
    if (chapters.some((c) => c.from === n.id || alike(c.title, n.title))) continue;
    out.push({ id: `${prefix}L${next}`, level: 'lecture', title: `第${next}章 ${n.title}`, from: n.id, by: 'dev' });
    next++;
  }
  return out;
}

/**
 * 按考点树给课程地图排节和块，并把每个叶子考点挂到块上（考情要落到「学生在学的哪一块」上：统计、预测、老师每一轮的「这一块在考试里」都按块算）。
 * - chapters：{ 考点树的章: 课程地图的章 }，写明的照写（标题对不上的，比如「基本概念」↔「绪论」）；没写的按标题找，找不到新开一章
 * - 课程地图里这一章还没有块：照考点树排——一个二级考点一节，它下面的三级考点一块一块；没有三级的，二级考点自己一块。块的 from 记着考点
 * - 已经有块的章（备课、教材排过的）：叶子考点按标题找最像的块挂上；manual：{ 考点: [块] } 手工指定的照写；还挂不上的列进 unmapped（教研室以后挂）
 * 返回 { writes: [{ id, level, title, from, by, parent, requires }]（要新写进课程地图的章、节、块）, map: { 考点: [块] }, unmapped: [考点] }。纯函数
 */
export function blockPlan({ course, nodes = [], curriculum = [], chapters: given = {}, manual = {} }) {
  const prefix = course === 'LA' ? '' : `${course}-`;
  const mine = nodes.filter((n) => n.course === course && n.status !== 'void');
  const kids = (id) => mine.filter((n) => n.parent === id);
  const re = new RegExp(`^${prefix}L(\\d+)$`);
  const curCh = curriculum.filter((c) => re.test(String(c.id)));
  let next = Math.max(0, ...curCh.map((c) => Number(String(c.id).match(re)[1]))) + 1;
  const blocksUnder = (ch) => curriculum.filter((b) => b.level === 'block' && String(b.id).startsWith(`${ch}.`));
  const writes = [];
  const map = {};
  const unmapped = [];
  for (const top of mine.filter((n) => !n.parent)) {
    let ch = given[top.id] || curCh.find((c) => alike(c.title, top.title))?.id;
    if (!ch) {
      ch = `${prefix}L${next}`;
      writes.push({ id: ch, level: 'lecture', title: `第${next}章 ${top.title}`, from: top.id, by: 'dev', requires: [] });
      next++;
    }
    const num = String(ch).match(/L(\d+)$/)[1];
    const have = blocksUnder(ch);
    const leaves = [];
    const walk = (n) => { const k = kids(n.id); if (!k.length) leaves.push(n); else k.forEach(walk); };
    kids(top.id).forEach(walk);
    if (!have.length) {
      kids(top.id).forEach((sec, i) => {
        const sid = `${ch}.${i + 1}`;
        writes.push({ id: sid, level: 'section', title: `${num}.${i + 1} ${sec.title}`, from: sec.id, by: 'dev', parent: ch, requires: [] });
        const items = kids(sec.id);
        (items.length ? items : [sec]).forEach((it, j) => {
          const bid = `${sid}.${j + 1}`;
          writes.push({ id: bid, level: 'block', title: it.title, from: it.id, by: 'dev', parent: sid, requires: [] });
          map[it.id] = [bid];
        });
      });
      continue;
    }
    for (const leaf of leaves) {
      if (manual[leaf.id]) { map[leaf.id] = manual[leaf.id]; continue; }
      const hit = have.find((b) => alike(b.title, leaf.title));
      if (hit) map[leaf.id] = [String(hit.id)]; else unmapped.push(leaf.id);
    }
  }
  const own = new Set(mine.map((n) => n.id));
  for (const [id, bs] of Object.entries(manual)) if (own.has(id) && !map[id]) { map[id] = bs; const k = unmapped.indexOf(id); if (k >= 0) unmapped.splice(k, 1); }
  return { writes, map, unmapped };
}
