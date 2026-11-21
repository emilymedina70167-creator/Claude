// 学生在函数图上点出来的点怎么判（视觉交互第 1 批；纯函数，tests/graphpick.test.js）。
// 「点出全部极值点」「点出间断点」这类：以前只能看主讲画好的，学生动不了手；现在学生点、页面判。
// 判法要经得起点得不准：按距离从近到远一对一配，一个目标只配一个点；多点的、漏的分开说。

const dist = (a, b, scale) => (Array.isArray(a) ? Math.hypot((a[0] - b[0]) / scale[0], (a[1] - b[1]) / scale[1]) : Math.abs(a - b));

/**
 * picked、targets：数的数组（点在曲线上、x 轴上，值是 x）或 [x, y] 的数组（随便点）。
 * tol：算「点到了」的距离。scale: [sx, sy]：[x, y] 的两个方向各除以它再算距离（横竖比例不一样的图）。
 * 回 { ok, hits（配上的 picked 下标）, extra（没配上的 picked 下标）, missed（没人点的目标有几个）}
 */
export function judgePicks(picked, targets, tol, { scale = [1, 1] } = {}) {
  const pairs = [];
  picked.forEach((p, i) => targets.forEach((t, j) => { const d = dist(p, t, scale); if (d <= tol + 1e-12) pairs.push([d, i, j]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const usedP = new Set(), usedT = new Set();
  for (const [, i, j] of pairs) { if (usedP.has(i) || usedT.has(j)) continue; usedP.add(i); usedT.add(j); }
  // 一条线上的点（曲线上、x 轴上）：「先配最近的」有时配不满——点 0.15、−0.2 对目标 0、0.314，
  // 0.15 先占了 0，−0.2 就没处去了，其实 −0.2 配 0、0.15 配 0.314 都在容差里。能全配上就不该说错：
  // 排好序从左往右配是配得最多的配法，比「先配最近的」多的时候用它
  if (!picked.some(Array.isArray) && !targets.some(Array.isArray)) {
    const ps = picked.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), ts = targets.map((v, j) => [v, j]).sort((a, b) => a[0] - b[0]);
    const mp = new Set(), mt = new Set();
    for (let i = 0, j = 0; i < ps.length && j < ts.length;) {
      if (Math.abs(ps[i][0] - ts[j][0]) <= tol + 1e-12) { mp.add(ps[i][1]); mt.add(ts[j][1]); i++; j++; } else if (ps[i][0] < ts[j][0]) i++; else j++;
    }
    if (mp.size > usedP.size) { usedP.clear(); usedT.clear(); mp.forEach((i) => usedP.add(i)); mt.forEach((j) => usedT.add(j)); }
  }
  const hits = [...usedP].sort((a, b) => a - b);
  const extra = picked.map((_, i) => i).filter((i) => !usedP.has(i));
  const missed = targets.length - usedT.size;
  return { ok: !extra.length && !missed, hits, extra, missed };
}

/** 给学生看的一句（不说漏的在哪：让学生自己再找） */
export function pickFeedback(r) {
  if (r.ok) return '全对';
  const parts = [];
  if (r.extra.length) parts.push(`有 ${r.extra.length} 个不在这里`);
  if (r.missed) parts.push(`还差 ${r.missed} 个`);
  return parts.join('，');
}

/** 手指点在 (x, y)：curve 回 x（那里曲线没定义回 null）、axis 回 x、free 回 [x, y] */
export function snapPick(x, y, { on, f } = {}) {
  if (on === 'free') return [x, y];
  if (on === 'curve') {
    let v;
    try { v = f(x); } catch { return null; }
    return typeof v === 'number' && Number.isFinite(v) ? x : null;
  }
  return x;
}

/** 图上关卡的一行（黑板现状里给老师看）：目标做到几个、每道点一点点了哪几个、检查了几次。没有关卡回 '' */
export function tasksText(t) {
  if (!t) return '';
  const out = [];
  const [hit, all] = String(t.goals || '0/0').split('/').map(Number);
  if (all) out.push(`目标 ${hit}/${all}`);
  for (const p of t.picks || []) {
    const q = String(p.q || '').replace(/\$/g, '').slice(0, 40);
    out.push(p.done ? `「${q}」${p.giveup ? '看了答案' : '做完'}` : `「${q}」${p.picked?.length ? `点了 ${p.picked.join('、')}` : '还没点'}${p.tries ? `，检查了 ${p.tries} 次` : ''}`);
  }
  return out.join('；');
}
