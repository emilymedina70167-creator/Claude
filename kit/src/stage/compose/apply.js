// 自由构图接到画面上（第八轮）：不碰 DOM 的那一半。
// 画面那一半在 stage.js 的 compose()：量每样东西多大 → 这里拼成求解器的输入 → solveLayout → 写回场景（一行 pos 记进 log，
// 刷新、回看、作废照 log 放回，排出来和当时一样）。

import { parseRef } from '../script.js';
import { fromCells } from './grid.js';

// 句子能折成的几种宽（世界坐标，和 types/sentence.js 的 WRAP 一样的单位）
export const SENTENCE_WIDTHS = [800, 600, 450];

/** 画布：舞台那一块扣掉底下的输入条，四周留一点 */
export function canvasOf({ w, h, dockH = 0, pad = 16 }) {
  return { left: pad, top: pad, w: Math.max(200, w - 2 * pad), h: Math.max(160, h - dockH - 2 * pad) };
}

/**
 * 求解器的输入：每样摆着的东西一件（世界框 × 字号档），老师写的关系照格子、部件换成像素。
 * env：{ ts, camS（现在的镜头倍数：上一次摆好的位置换成画布像素）, grid,
 *        boxOf(id) → 世界框（带上只贴在它身上的字）, altsOf(id) → 能折成的几种世界大小 | null,
 *        partBox(ref) → 部件的世界框 | null, extras: [{ id, w, h, alts?, prev?, fixed? }]（画布像素：话、挑战）,
 *        lastTouched：这一轮老师讲的那样东西 }
 */
export function composeInput(scene, env) {
  const { ts, camS, grid } = env;
  const items = [];
  const relations = [];
  const U = new Map(); // 东西 → 它所在那一组的框（世界坐标）
  const ids = scene.shownIds();
  // 底座排成一体的几样（乘积和它的两个因子，types 的 anchors）当一块摆：一起挪、挪一样的距离（不然乘积那一排被拆散）
  const lead = new Map(ids.map((id) => [id, id]));
  const find = (x) => { while (lead.get(x) !== x) x = lead.get(x); return x; };
  for (const id of ids) for (const t of env.tiedOf?.(id) || []) {
    if (!lead.has(t)) continue;
    const a = find(id), b = find(t);
    if (a !== b) { const [keep, drop] = ids.indexOf(a) < ids.indexOf(b) ? [a, b] : [b, a]; lead.set(drop, keep); }
  }
  const groups = new Map();
  for (const id of ids) { const g = find(id); groups.set(g, [...(groups.get(g) || []), id]); }
  const leaderOf = (id) => (lead.has(id) ? find(id) : id);
  ids.forEach((id, k) => {
    if (find(id) !== id) return;
    const members = groups.get(id);
    const boxes = members.map((m) => env.boxOf(m)).filter(Boolean);
    if (!boxes.length) return;
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const b = { x: x0, y: y0, w: Math.max(...boxes.map((q) => q.x + q.w)) - x0, h: Math.max(...boxes.map((q) => q.y + q.h)) - y0 };
    for (const m of members) U.set(m, b);
    const it = { id, w: b.w * ts, h: b.h * ts, order: k, ...(members.length > 1 ? { members } : {}) };
    const alts = members.length === 1 ? env.altsOf?.(id) : null;
    if (alts && alts.length > 1) it.alts = alts.map((a) => ({ w: a.w * ts, h: a.h * ts }));
    if (members.some((m) => scene.objects.get(m)?.placed)) it.prev = { x: b.x * camS, y: b.y * camS };
    if (members.some((m) => scene.objects.get(m)?.pinned)) it.pinned = true;
    items.push(it);
  });
  (env.extras || []).forEach((x, k) => items.push({ ...x, order: ids.length + k, rigid: true }));
  const have = new Set(items.map((it) => it.id));
  for (const rs of scene.layout.values()) for (const r of rs) {
    if (r.kind === 'at') { relations.push({ kind: 'at', a: r.a, box: fromCells(r.at, grid) }); continue; }
    const ref = typeof r.b === 'string' ? parseRef(r.b) : null;
    if (r.kind === 'near' && ref?.mark) {
      const ub = U.get(ref.obj), pb = env.partBox(r.b);
      if (!ub || !pb) continue;
      relations.push({ ...r, b: { of: ref.obj, x: (pb.x - ub.x) * ts, y: (pb.y - ub.y) * ts, w: pb.w * ts, h: pb.h * ts, name: r.b } });
      continue;
    }
    relations.push({ ...r });
  }
  // 关系里写的是一组里的某一样：换成那一组（同一组里的关系不要了：它们本来就排成一体）
  for (const r of relations) {
    if (Array.isArray(r.a)) r.a = [...new Set(r.a.map(leaderOf))];
    else r.a = leaderOf(r.a);
    if (typeof r.b === 'string') r.b = leaderOf(r.b);
    else if (r.b?.of) r.b = { ...r.b, x: r.b.x, of: leaderOf(r.b.of) };
  }
  for (let i = relations.length - 1; i >= 0; i--) { const r = relations[i]; if (typeof r.b === 'string' && r.b === r.a) relations.splice(i, 1); }
  // 话默认贴着这一轮讲的那样东西（能让就让）
  if (!scene.layout.has('say') && have.has('say') && env.lastTouched && U.has(env.lastTouched)) {
    relations.push({ kind: 'near', a: 'say', b: leaderOf(env.lastTouched), weight: 'weak', auto: true });
  }
  return { items, relations, groups };
}

/** 摆好的几样写成一行 pos（世界坐标，一位小数）：pos s=12.5,40 gl=30,4.5,600（第三个数是句子折成的宽） */
export function posLine(moves) {
  const n = (v) => String(Math.round(v * 10) / 10);
  return `pos ${moves.map((m) => `${m.id}=${n(m.x)},${n(m.y)}${m.width ? `,${m.width}` : ''}`).join(' ')}`;
}
