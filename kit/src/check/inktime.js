// 检验手写板的时间线（设计 5.4）：交卷时从笔画的数据算——行、关键时刻（停顿、划掉之前、下一步）、某一刻纸上的样子、
// 一段时间线文字。快照不当场截图：每一笔记了 t0 / t1、划掉的记了 struck，哪一刻的样子都能重画。不碰 DOM，tests/check-inktime.test.js
//
// 笔画：ink/engine.js 的 { color, pts: [x, y, r, …], bbox: [x0, y0, x1, y1] }，多 t0、t1（从这道题出现算的毫秒）、struck（划掉的时刻）。
// 事件：[{ t, kind: 'step' | 'strike' | 'unstrike' | 'undo', ids: [笔画的下标] }]

export const PAUSE = 30000;
export const MOMENTS_MAX = 6;
export const INK_MAX = 200 * 1024;

/** 毫秒 → 「1:20」 */
export const mmss = (ms) => { const s = Math.max(0, Math.round((Number(ms) || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const top = (s) => s.bbox[1];
const bottom = (s) => s.bbox[3];
const mid = (s) => (s.bbox[1] + s.bbox[3]) / 2;

/**
 * 按上下位置把笔画聚成行：一笔和某一行上下交叠够多（小的那个高度的四成）、或者它的中线落在那一行里，就归那一行。
 * 返回 [{ n, top, bottom, ids }]，从上往下 1、2…
 */
export function linesOf(strokes = []) {
  const order = strokes.map((s, i) => i).sort((a, b) => mid(strokes[a]) - mid(strokes[b]));
  const lines = [];
  for (const i of order) {
    const s = strokes[i];
    const h = Math.max(1, bottom(s) - top(s));
    const hit = lines.find((L) => {
      const lh = Math.max(1, L.bottom - L.top);
      const overlap = Math.min(L.bottom, bottom(s)) - Math.max(L.top, top(s));
      return overlap >= 0.4 * Math.min(h, lh) || (mid(s) >= L.top && mid(s) <= L.bottom);
    });
    if (hit) { hit.ids.push(i); hit.top = Math.min(hit.top, top(s)); hit.bottom = Math.max(hit.bottom, bottom(s)); }
    else lines.push({ top: top(s), bottom: bottom(s), ids: [i] });
  }
  return lines.sort((a, b) => a.top - b.top).map((L, k) => ({ n: k + 1, ...L }));
}

const byT = (strokes) => strokes.map((s, i) => i).sort((a, b) => strokes[a].t0 - strokes[b].t0);

/** 两笔之间停了够久的：[{ t（停下来那一刻纸上的样子）, gap, after（停之前最后一笔）, before（停之后第一笔）}] */
function pauses(strokes, pause) {
  const ord = byT(strokes);
  const out = [];
  for (let k = 1; k < ord.length; k++) {
    const a = strokes[ord[k - 1]], b = strokes[ord[k]];
    const gap = b.t0 - a.t1;
    if (gap >= pause) out.push({ t: b.t0 - 1, gap, after: ord[k - 1], before: ord[k] });
  }
  return out;
}

const RANK = { strike: 3, pause: 2, step: 1 };

/**
 * 关键时刻：每次划掉之前、停顿超过 pause、每次「下一步」；最多 max 个（先划掉，再最长的停顿，再分步），同一刻（一秒内）的并成一个。按时间排
 */
export function keyMoments(strokes = [], events = [], { pause = PAUSE, max = MOMENTS_MAX } = {}) {
  const all = [
    ...events.filter((e) => e.kind === 'strike').map((e) => ({ t: e.t - 1, why: 'strike' })),
    ...pauses(strokes, pause).map((p) => ({ t: p.t, why: 'pause', gap: p.gap })),
    ...events.filter((e) => e.kind === 'step').map((e) => ({ t: e.t, why: 'step' })),
  ];
  // 同一刻的并成一个（留要紧的那种）
  const merged = [];
  for (const m of all.sort((a, b) => a.t - b.t)) {
    const near = merged.find((x) => Math.abs(x.t - m.t) < 1000);
    if (!near) merged.push({ ...m });
    else if (RANK[m.why] > RANK[near.why]) Object.assign(near, m);
  }
  const pick = [...merged].sort((a, b) => RANK[b.why] - RANK[a.why] || (b.gap || 0) - (a.gap || 0) || a.t - b.t).slice(0, max);
  return pick.sort((a, b) => a.t - b.t);
}

/** 那一刻纸上的样子：已经写了的笔画（t0 ≤ t），struckNow 是那一刻划没划掉 */
export function frameAt(strokes = [], t) {
  return strokes.filter((s) => s.t0 <= t).map((s) => ({ ...s, struckNow: s.struck !== undefined && s.struck !== null && s.struck <= t }));
}

/**
 * 时间线一段字：「0:00–1:20 写 L1；停 45 秒；2:05–2:30 写 L2；2:35 划掉 L2（划前见快照 2）；2:40 下一步」。
 * 快照的编号照 moments 的先后（1 开始）
 */
export function timelineText(strokes = [], events = [], lines = [], moments = [], { pause = PAUSE } = {}) {
  const lineOf = new Map();
  for (const L of lines) for (const i of L.ids) lineOf.set(i, L.n);
  const items = []; // { t, text }
  // 写：按时间一段一段，换了行或停够久就另起一段
  let seg = null;
  const close = () => { if (seg) items.push({ t: seg.from, text: `${mmss(seg.from)}–${mmss(seg.to)} 写 ${[...seg.lines].map((n) => `L${n}`).join('、')}` }); seg = null; };
  let lastEnd = null; // 上一笔写完的时刻
  for (const i of byT(strokes)) {
    const s = strokes[i];
    const n = lineOf.get(i);
    if (lastEnd !== null && s.t0 - lastEnd >= pause) { close(); items.push({ t: s.t0 - 1, text: `停 ${Math.round((s.t0 - lastEnd) / 1000)} 秒` }); }
    if (seg && !seg.lines.has(n)) close();
    if (!seg) seg = { from: s.t0, to: s.t1, lines: new Set([n]) };
    else seg.to = Math.max(seg.to, s.t1);
    lastEnd = Math.max(lastEnd ?? 0, s.t1);
  }
  close();
  const shotOf = (t) => moments.findIndex((m) => Math.abs(m.t - t) < 1000) + 1;
  for (const e of events) {
    if (e.kind === 'strike') {
      const ns = [...new Set((e.ids || []).map((i) => lineOf.get(i)).filter(Boolean))].sort((a, b) => a - b);
      const k = shotOf(e.t - 1);
      items.push({ t: e.t, text: `${mmss(e.t)} 划掉 ${ns.map((n) => `L${n}`).join('、') || '几笔'}${k ? `（划前见快照 ${k}）` : ''}` });
    } else if (e.kind === 'step') items.push({ t: e.t, text: `${mmss(e.t)} 下一步` });
    else if (e.kind === 'unstrike') items.push({ t: e.t, text: `${mmss(e.t)} 撤回划掉` });
  }
  return items.sort((a, b) => a.t - b.t).map((x) => x.text).join('；');
}

const r1 = (v) => Math.round(v * 10) / 10;

/** 存进数据库的笔画（回放用）：坐标取一位小数；还超了就隔点取样，直到放得下。返回 { strokes, trimmed } */
export function fitStrokes(strokes = [], maxBytes = INK_MAX) {
  const tidy = (s, step = 1) => {
    const pts = [];
    const n = s.pts.length / 3;
    for (let i = 0; i < n; i += step) pts.push(r1(s.pts[i * 3]), r1(s.pts[i * 3 + 1]), r1(s.pts[i * 3 + 2]));
    if (step > 1 && (n - 1) % step) pts.push(r1(s.pts[(n - 1) * 3]), r1(s.pts[(n - 1) * 3 + 1]), r1(s.pts[(n - 1) * 3 + 2]));
    return { color: s.color, pts, bbox: s.bbox.map(r1), t0: s.t0, t1: s.t1, ...(s.struck !== undefined && s.struck !== null ? { struck: s.struck } : {}) };
  };
  let step = 1;
  let out = strokes.map((s) => tidy(s));
  while (JSON.stringify(out).length > maxBytes && step < 64) {
    step *= 2;
    out = strokes.map((s) => tidy(s, step));
  }
  return { strokes: out, trimmed: step > 1 };
}
