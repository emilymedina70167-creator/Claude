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
