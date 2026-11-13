// 自由构图的求解器（第八轮）：老师说关系和轻重，页面算精确几何。纯函数。
//
// 用 kiwi.js（Cassowary 线性约束求解）解：在画布里、老师写的关系（按 weight）、
// 和上一次的位置尽量一样（改一处只动那一处）、新东西挨着前一样。
// 不重叠不是线性约束：照 WebCoLa 的做法，解完找压着的每一对，照现在的相对位置
// 给它们选一个分开的方向（左右或上下），加成约束再解，几轮就稳。
// 能折行的东西有几种「宽 → 高」，挑一个让整体最好的；还放不下先压间距、
// 再整台缩一档（最低 8 成），照实写进 unmet 给老师看。

import { Solver, Variable, Constraint, Operator, Strength } from 'kiwi.js';
import { GAPS } from './grid.js';

const W_PIN = 1e9;              // 老师摆过的（钉住的）：一个像素都不挪（第九轮）
const W_BOUND = 1e8;            // 在画布里、at= 定死的框
const W_SEP = 1e7;              // 不重叠
const WEIGHT = { strong: 1e6, medium: 1e4, weak: 1e2 };
const W_STAB = 1e3;             // 和上一次一样（比老师写的 weak 还硬：已经摆好的不被「能让就让」的拽来拽去）
const W_GUESS = 3;              // 新东西的初始位置（挨着前一样）
const SEP_ROUNDS = 6;
const SCALES = [1, 0.9, 0.81, 0.8];
const DIR = { 'right-of': '右边', 'left-of': '左边', above: '上面', below: '下面', near: '旁边', row: '排成一行', col: '排成一列', main: '中间' };

const { Le, Ge, Eq } = Operator;

function hits(a, b, pad = 0) {
  return a.x < b.x + b.w + pad - 0.5 && b.x < a.x + a.w + pad - 0.5
    && a.y < b.y + b.h + pad - 0.5 && b.y < a.y + a.h + pad - 0.5;
}

function inside(b, cv) {
  return b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= cv.w + 0.5 && b.y + b.h <= cv.h + 0.5;
}

// 关系整理成统一的样子；指着没有的东西的丢掉
function normRels(relations, ids) {
  const out = [];
  for (const r of relations || []) {
    if (!r || !DIR[r.kind] && r.kind !== 'at') continue;
    const rel = { ...r, weight: WEIGHT[r.weight] ? r.weight : 'medium', gap: GAPS[r.gap] != null ? r.gap : 'm' };
    if (r.kind === 'row' || r.kind === 'col') {
      const a = (Array.isArray(r.a) ? r.a : [r.a]).filter(id => ids.has(id));
      if (a.length < 2) continue;
      rel.a = a;
    } else if (!ids.has(r.a)) continue;
    if (['right-of', 'left-of', 'above', 'below'].includes(r.kind) && (!ids.has(r.b) || r.b === r.a)) continue;
    if (r.kind === 'near') {
      const b = r.b;
      if (typeof b === 'string' ? !ids.has(b) || b === r.a : !b || b.of != null && !ids.has(b.of)) continue;
    }
    out.push(rel);
  }
  return out;
}

const nameOf = b => typeof b === 'string' ? b : b?.name || b?.of || '那一处';

export function solveLayout({ canvas, grid, items, relations = [], release = null, arrange = null }) {
  const cell = grid.cell;
  const ids = new Set(items.map(it => it.id));
  const rels = normRels(relations, ids);
  // at= 写成关系的，并进 fixed
  const fixedOf = new Map();
  for (const it of items) if (it.fixed) fixedOf.set(it.id, it.fixed);
  for (const r of rels) if (r.kind === 'at' && r.box) fixedOf.set(r.a, r.box);
  // 钉住的（老师摆过的，第九轮）：照上一次的位置定死，不缩、不吸格、不挪进画布。release 的这一次不当钉子（保留上一次的位置，挪最少）；
  // arrange 的这一次不当钉子、也不管上一次的位置（照关系整个重排）
  const arranged = (id) => arrange === 'all' || !!arrange?.has?.(id);
  const work = items.map((it, i) => {
    const f = fixedOf.get(it.id);
    const free = arranged(it.id) || !!release?.has?.(it.id);
    const pin = it.pinned && it.prev && !free ? { x: it.prev.x, y: it.prev.y, w: it.w, h: it.h } : null;
    return { ...it, idx: i, order: it.order ?? i, fixed: f && !pin ? clampBox(f, canvas) : null, pin, ...(arranged(it.id) ? { prev: undefined } : {}) };
  });
  // 主语钉住了的关系：它当初照关系摆好、钉住了，这条关系不再拉它（别的东西照样能挨着它）
  const pinned = new Set(work.filter((w) => w.pin).map((w) => w.id));
  const live = rels.filter(r => r.kind !== 'at' && !(Array.isArray(r.a) ? r.a.every((x) => pinned.has(x)) : pinned.has(r.a)));

  let best = null;
  // 台上有钉住的东西：页面不整台缩（只有一个镜头，缩不了「只缩没钉住的」），放不下照实报告
  for (const scale of pinned.size ? [1] : SCALES) {
    for (const gapF of [1, 0.5]) {
      const res = attempt(work, live, { canvas, cell, scale, gapF });
      if (!best || res.cost < best.cost) best = { ...res, scale };
      if (res.fits) return finish(res, scale);
    }
  }
  const out = finish(best, best.scale);
  out.unmet.push({ rel: null, why: `放不下，整台缩到 ${Math.round(best.scale * 10)} 成还是挤` });
  return out;

  function finish(res, scale) {
    const unmet = [...res.unmet];
    if (scale < 1) unmet.push({ rel: null, why: `放不下，整台缩到 ${Math.round(scale * 10)} 成` });
    return { boxes: res.boxes, unmet, scale };
  }
}

function clampBox(b, cv) {
  const w = Math.min(b.w, cv.w), h = Math.min(b.h, cv.h);
  return { x: Math.max(0, Math.min(b.x, cv.w - w)), y: Math.max(0, Math.min(b.y, cv.h - h)), w, h };
}

// 一种缩放、一档间距下：挑折行的样子，解，右边放不下的换到下面
function attempt(work, rels, env) {
  const { scale } = env;
  const opts = work.map(it => {
    if (it.pin) return [{ w: it.pin.w, h: it.pin.h }];
    if (it.fixed) return [{ w: it.fixed.w, h: it.fixed.h }];
    const list = (it.alts && it.alts.length ? it.alts : [{ w: it.w, h: it.h }]).slice(0, 3);
    // rigid：画面上的一块（话、挑战）不跟着整台缩，字号是定的
    return list.map(s => (it.rigid ? { ...s } : { w: s.w * scale, h: s.h * scale }));
  });
  const pick = opts.map(() => 0);
  const sizesOf = () => pick.map((k, i) => opts[i][k]);
  let cur = run(work, rels, sizesOf(), env);
  // 一样一样挑（组合多了一起挑太慢）
  for (let i = 0; i < work.length; i++) {
    if (opts[i].length < 2) continue;
    for (let k = 1; k < opts[i].length; k++) {
      const keep = pick[i];
      pick[i] = k;
      const r = run(work, rels, sizesOf(), env);
      if (r.cost < cur.cost) cur = r; else pick[i] = keep;
    }
  }
  // 方向上放不下的：换一边，写清楚为什么
  const swapped = [];
  const rels2 = rels.map(r => {
    const s = swapFor(r, cur.boxes, env);
    if (!s) return r;
    swapped.push({ rel: r, why: s.why });
    return s.rel;
  });
  if (swapped.length) {
    const r = run(work, rels2, sizesOf(), env);
    cur = { ...r, unmet: [...swapped, ...r.unmet.filter(u => !swapped.some(s => s.rel === u.rel))] };
  }
  return cur;
}

function swapFor(r, boxes, { canvas, cell, gapF }) {
  if (!['right-of', 'left-of', 'above', 'below'].includes(r.kind)) return null;
  const A = boxes.get(r.a), B = boxes.get(r.b);
  if (!A || !B || !violated(r, boxes, cell, gapF)) return null;
  const g = GAPS[r.gap] * cell * gapF;
  const cols = px => Math.max(0, Math.floor(px / cell));
  if (r.kind === 'right-of' && canvas.w - (B.x + B.w) - g < A.w)
    return { rel: { ...r, kind: 'below', align: 'left' }, why: `${r.a} 要在 ${r.b} 右边，右边只剩 ${cols(canvas.w - B.x - B.w)} 列，放在了 ${r.b} 下面` };
  if (r.kind === 'left-of' && B.x - g < A.w)
    return { rel: { ...r, kind: 'below', align: 'left' }, why: `${r.a} 要在 ${r.b} 左边，左边只剩 ${cols(B.x)} 列，放在了 ${r.b} 下面` };
  if (r.kind === 'above' && B.y - g < A.h)
    return { rel: { ...r, kind: 'below' }, why: `${r.a} 要在 ${r.b} 上面，上面只剩 ${cols(B.y)} 行，放在了 ${r.b} 下面` };
  if (r.kind === 'below' && canvas.h - (B.y + B.h) - g < A.h)
    return { rel: { ...r, kind: 'right-of', align: 'top' }, why: `${r.a} 要在 ${r.b} 下面，下面只剩 ${cols(canvas.h - B.y - B.h)} 行，放在了 ${r.b} 右边` };
  return null;
}

// 照一组大小解一次：建约束、解、找压着的加分开方向再解、吸到半格
function run(work, rels, sizes, env) {
  const { canvas, cell, gapF } = env;
  const n = work.length;
  const solver = new Solver();
  const X = work.map(it => new Variable(it.id + '.x'));
  const Y = work.map(it => new Variable(it.id + '.y'));
  const at = new Map(work.map((it, i) => [it.id, i]));
  const add = (lhs, op, rhs, w) => solver.addConstraint(new Constraint(lhs, op, rhs, w));
  const guess = guessAll(work, sizes, env);

  for (let i = 0; i < n; i++) {
    const it = work[i], { w, h } = sizes[i];
    if (it.pin) { add(X[i], Eq, it.pin.x, W_PIN); add(Y[i], Eq, it.pin.y, W_PIN); continue; }
    add(X[i], Ge, 0, Strength.required);
    add(Y[i], Ge, 0, Strength.required);
    add(X[i].plus(w), Le, canvas.w, W_BOUND);
    add(Y[i].plus(h), Le, canvas.h, W_BOUND);
    if (it.fixed) { add(X[i], Eq, it.fixed.x, W_BOUND); add(Y[i], Eq, it.fixed.y, W_BOUND); continue; }
    if (it.prev) { add(X[i], Eq, it.prev.x, W_STAB); add(Y[i], Eq, it.prev.y, W_STAB); }
    else { add(X[i], Eq, guess[i].x, W_GUESS); add(Y[i], Eq, guess[i].y, W_GUESS); }
  }

  for (const r of rels) relConstraints(r);

  solver.updateVariables();
  const pos = () => work.map((_, i) => ({ x: X[i].value(), y: Y[i].value(), w: sizes[i].w, h: sizes[i].h }));
  const sepGap = GAPS.s * cell * gapF;
  const seps = new Set();
  for (let round = 0; round < SEP_ROUNDS; round++) {
    const p = pos();
    let added = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (seps.has(i + '|' + j) || !hits(p[i], p[j], sepGap)) continue;
      seps.add(i + '|' + j);
      separate(i, j, p);
      added++;
    }
    if (!added) break;
    solver.updateVariables();
  }

  let boxes = pos();
  // 一整幕新摆的（没有上一次、没有定死的、没有主角）：整块在画布里横着居中、竖着略偏上
  if (!work.some(it => it.prev || it.fixed) && !rels.some(r => r.kind === 'main')) boxes = centerAll(boxes, canvas);
  boxes = snap(boxes, work, canvas, cell);
  const map = new Map(work.map((it, i) => [it.id, boxes[i]]));
  return score(map, work, rels, env);

  function rel(r) { return WEIGHT[r.weight]; }
  function alignC(a, b, ax, ws) {
    const ia = at.get(a), ib = at.get(b);
    const sa = sizes[ia], sb = sizes[ib];
    if (ax === 'y') {
      const al = ['top', 'bottom', 'center'].includes(ws.align) ? ws.align : 'top';
      const k = al === 'top' ? 0 : al === 'bottom' ? 1 : 0.5;
      add(Y[ia].plus(sa.h * k), Eq, Y[ib].plus(sb.h * k), ws.align ? ws.s : ws.s / 10);
    } else {
      const al = ['left', 'right', 'center'].includes(ws.align) ? ws.align : 'left';
      const k = al === 'left' ? 0 : al === 'right' ? 1 : 0.5;
      add(X[ia].plus(sa.w * k), Eq, X[ib].plus(sb.w * k), ws.align ? ws.s : ws.s / 10);
    }
  }
  function relConstraints(r) {
    const s = rel(r), g = GAPS[r.gap] * cell * gapF;
    if (r.kind === 'main') {
      const i = at.get(r.a), { w, h } = sizes[i];
      add(X[i].plus(w / 2), Eq, canvas.w / 2, s);
      add(Y[i].plus(h / 2), Eq, canvas.h * 0.42, s / 10);
      return;
    }
    if (r.kind === 'row' || r.kind === 'col') {
      for (let k = 1; k < r.a.length; k++) {
        const p = at.get(r.a[k - 1]), q = at.get(r.a[k]);
        if (r.kind === 'row') { add(X[q], Eq, X[p].plus(sizes[p].w + g), s); alignC(r.a[k], r.a[k - 1], 'y', { s, align: r.align }); }
        else { add(Y[q], Eq, Y[p].plus(sizes[p].h + g), s); alignC(r.a[k], r.a[k - 1], 'x', { s, align: r.align }); }
      }
      return;
    }
    const a = at.get(r.a), A = sizes[a];
    if (r.kind === 'near') return nearC(r, a, A, s, g);
    const b = at.get(r.b), B = sizes[b];
    if (r.kind === 'right-of') { add(X[a], Ge, X[b].plus(B.w + g), s); add(X[a], Le, X[b].plus(B.w + g), s / 10); alignC(r.a, r.b, 'y', { s, align: r.align }); }
    if (r.kind === 'left-of') { add(X[a].plus(A.w + g), Le, X[b], s); add(X[a].plus(A.w + g), Ge, X[b], s / 10); alignC(r.a, r.b, 'y', { s, align: r.align }); }
    if (r.kind === 'below') { add(Y[a], Ge, Y[b].plus(B.h + g), s); add(Y[a], Le, Y[b].plus(B.h + g), s / 10); alignC(r.a, r.b, 'x', { s, align: r.align }); }
    if (r.kind === 'above') { add(Y[a].plus(A.h + g), Le, Y[b], s); add(Y[a].plus(A.h + g), Ge, Y[b], s / 10); alignC(r.a, r.b, 'x', { s, align: r.align }); }
  }
  // 贴着一处：那一处可以是一样东西，也可以是一样东西里的部件（跟着那样东西走）
  function nearC(r, a, A, s, g) {
    let ex, ey, bw, bh, est;
    if (typeof r.b === 'string') {
      const b = at.get(r.b);
      ex = X[b].plus(0); ey = Y[b].plus(0); bw = sizes[b].w; bh = sizes[b].h; est = estOf(b);
    } else if (r.b.of != null) {
      // 部件的框是照那样东西没缩时量的：跟着整台一起缩
      const b = at.get(r.b.of), k = work[b].rigid ? 1 : env.scale;
      ex = X[b].plus(r.b.x * k); ey = Y[b].plus(r.b.y * k); bw = r.b.w * k; bh = r.b.h * k;
      const e = estOf(b); est = { x: e.x + r.b.x * k, y: e.y + r.b.y * k };
    } else {
      ex = r.b.x; ey = r.b.y; bw = r.b.w; bh = r.b.h; est = { x: r.b.x, y: r.b.y };
    }
    // 哪一边有地方贴：下、上、右、左
    const side = canvas.h - (est.y + bh) - g >= A.h ? 'below' : est.y - g >= A.h ? 'above'
      : canvas.w - (est.x + bw) - g >= A.w ? 'right' : est.x - g >= A.w ? 'left' : 'below';
    const plus = (e, k) => typeof e === 'number' ? e + k : e.plus(k);
    if (side === 'below') { add(Y[a], Eq, plus(ey, bh + g), s); add(X[a], Eq, ex, s / 10); }
    if (side === 'above') { add(Y[a].plus(A.h + g), Eq, ey, s); add(X[a], Eq, ex, s / 10); }
    if (side === 'right') { add(X[a], Eq, plus(ex, bw + g), s); add(Y[a].plus(A.h / 2), Eq, plus(ey, bh / 2), s / 10); }
    if (side === 'left') { add(X[a].plus(A.w + g), Eq, ex, s); add(Y[a].plus(A.h / 2), Eq, plus(ey, bh / 2), s / 10); }
  }
  function estOf(i) {
    const it = work[i];
    return it.fixed || it.prev || guess[i];
  }
  function separate(i, j, p) {
    const A = p[i], B = p[j];
    // 一样挪不动（钉住的、定死在格子上的）、一样能挪：挪的那一样去它四边里最近、真有空地的那一边
    // （以前照中心的相对位置选：钉住的上面正好是另一样钉住的，话被推上去又压着那一样，退不回来）
    const still = (k) => !!(work[k].pin || work[k].fixed);
    if (still(i) !== still(j)) {
      const [s, m] = still(i) ? [i, j] : [j, i];
      const S = p[s], M = p[m];
      const walls = p.filter((_, k) => k !== m && still(k));
      const sides = [
        { side: 'below', box: { ...M, y: S.y + S.h + sepGap } },
        { side: 'above', box: { ...M, y: S.y - M.h - sepGap } },
        { side: 'right', box: { ...M, x: S.x + S.w + sepGap } },
        { side: 'left', box: { ...M, x: S.x - M.w - sepGap } },
      ].map((c) => ({ ...c, move: Math.abs(c.box.x - M.x) + Math.abs(c.box.y - M.y) }))
        .filter((c) => inside(c.box, canvas) && !walls.some((w) => hits(w, c.box)))
        .sort((x, y) => x.move - y.move);
      if (sides.length) {
        const { side } = sides[0];
        if (side === 'below') add(Y[m], Ge, Y[s].plus(sizes[s].h + sepGap), W_SEP);
        if (side === 'above') add(Y[m].plus(sizes[m].h + sepGap), Le, Y[s], W_SEP);
        if (side === 'right') add(X[m], Ge, X[s].plus(sizes[s].w + sepGap), W_SEP);
        if (side === 'left') add(X[m].plus(sizes[m].w + sepGap), Le, X[s], W_SEP);
        return;
      }
    }
    // 有上一次的照上一次的相对位置分，没有的照现在的
    const ref = work[i].prev && work[j].prev
      ? [{ ...work[i].prev, w: A.w, h: A.h }, { ...work[j].prev, w: B.w, h: B.h }] : [A, B];
    const [ra, rb] = ref;
    const dcx = (rb.x + rb.w / 2) - (ra.x + ra.w / 2), dcy = (rb.y + rb.h / 2) - (ra.y + ra.h / 2);
    const needX = (A.w + B.w) / 2 + sepGap - Math.abs(dcx), needY = (A.h + B.h) / 2 + sepGap - Math.abs(dcy);
    const canX = A.w + B.w + sepGap <= canvas.w, canY = A.h + B.h + sepGap <= canvas.h;
    const horiz = canX && (!canY || needX <= needY);
    const [lo, hi] = (horiz ? dcx : dcy) >= 0 ? [i, j] : [j, i];
    if (horiz) add(X[hi], Ge, X[lo].plus(sizes[lo].w + sepGap), W_SEP);
    else add(Y[hi], Ge, Y[lo].plus(sizes[lo].h + sepGap), W_SEP);
  }
}

// 没有上一次的新东西放哪：挨着阅读顺序里的前一样（下面、右边），都不行就照行找一块空地
function guessAll(work, sizes, { canvas, cell, gapF }) {
  const g = GAPS.m * cell * gapF;
  const out = new Array(work.length);
  const placed = [];
  work.forEach((it, i) => {
    const b = it.fixed || (it.prev && { x: it.prev.x, y: it.prev.y });
    if (b) { out[i] = { x: b.x, y: b.y }; placed.push({ x: b.x, y: b.y, ...sizes[i] }); }
  });
  const seq = work.map((it, i) => i).sort((a, b) => work[a].order - work[b].order || a - b);
  let last = null;
  for (const i of seq) {
    if (out[i]) { last = { ...out[i], ...sizes[i] }; continue; }
    const { w, h } = sizes[i];
    const free = (x, y) => {
      const bx = { x, y, w, h };
      return inside(bx, canvas) && !placed.some(p => hits(p, bx, g * 0.5));
    };
    const tries = last ? [[last.x, last.y + last.h + g], [last.x + last.w + g, last.y]] : [];
    let spot = tries.find(([x, y]) => free(x, y));
    if (!spot) {
      // 照行找空地：越靠上越好，同一高度越靠画布正中越好（不全挤在左边）
      const step = cell, mid = (canvas.w - w) / 2;
      let best = Infinity;
      for (let y = 0; y + h <= canvas.h + 0.5; y += step) {
        if (y > best) break;
        for (let x = 0; x + w <= canvas.w + 0.5; x += step) {
          if (!free(x, y)) continue;
          const cost = y + Math.abs(x - mid) * 0.5;
          if (cost < best) { best = cost; spot = [x, y]; }
        }
      }
    }
    if (!spot) spot = [0, 0];
    out[i] = { x: spot[0], y: spot[1] };
    last = { x: spot[0], y: spot[1], w, h };
    placed.push(last);
  }
  return out;
}

function centerAll(boxes, canvas) {
  if (!boxes.length) return boxes;
  const x0 = Math.min(...boxes.map(b => b.x)), x1 = Math.max(...boxes.map(b => b.x + b.w));
  const y0 = Math.min(...boxes.map(b => b.y)), y1 = Math.max(...boxes.map(b => b.y + b.h));
  const dx = Math.max(0, (canvas.w - (x1 - x0)) / 2) - x0;
  const dy = Math.max(0, (canvas.h - (y1 - y0)) * 0.4) - y0;
  return boxes.map(b => ({ ...b, x: b.x + dx, y: b.y + dy }));
}

// 吸到半格上；吸了会压着别的就不吸那一样
function snap(boxes, work, canvas, cell) {
  const half = cell / 2;
  const out = boxes.map(b => ({ ...b }));
  out.forEach((b, i) => {
    if (work[i].fixed || work[i].pin) return;
    const s = {
      ...b,
      x: Math.max(0, Math.min(Math.round(b.x / half) * half, Math.max(0, canvas.w - b.w))),
      y: Math.max(0, Math.min(Math.round(b.y / half) * half, Math.max(0, canvas.h - b.h))),
    };
    const was = out.filter((o, j) => j !== i && hits(o, b)).length;
    const now = out.filter((o, j) => j !== i && hits(o, s)).length;
    if (now <= was) out[i] = s;
  });
  return out;
}

// 关系照办了没有（给 unmet 和挑折行用）
function violated(r, boxes, cell, gapF) {
  const tol = cell * 0.3;
  const g = GAPS[r.gap] * cell * gapF;
  const A = boxes.get(Array.isArray(r.a) ? r.a[0] : r.a);
  if (r.kind === 'main') return false;
  if (r.kind === 'row' || r.kind === 'col') {
    for (let k = 1; k < r.a.length; k++) {
      const p = boxes.get(r.a[k - 1]), q = boxes.get(r.a[k]);
      if (r.kind === 'row' && (q.x < p.x + p.w - tol || Math.abs(q.y - p.y) > tol && !r.align)) return true;
      if (r.kind === 'col' && (q.y < p.y + p.h - tol || Math.abs(q.x - p.x) > tol && !r.align)) return true;
    }
    return false;
  }
  if (r.kind === 'near') {
    let B;
    if (typeof r.b === 'string') B = boxes.get(r.b);
    else if (r.b.of != null) { const o = boxes.get(r.b.of); B = { x: o.x + r.b.x, y: o.y + r.b.y, w: r.b.w, h: r.b.h }; }
    else B = r.b;
    const dx = Math.max(0, B.x - (A.x + A.w), A.x - (B.x + B.w));
    const dy = Math.max(0, B.y - (A.y + A.h), A.y - (B.y + B.h));
    // 贴着一样东西里的部件：得绕到那样东西外面去，离部件远一点也算贴着
    return Math.hypot(dx, dy) > g + cell * (typeof r.b === 'string' ? 1.5 : 5);
  }
  const B = boxes.get(r.b);
  if (r.kind === 'right-of') return A.x < B.x + B.w - tol;
  if (r.kind === 'left-of') return A.x + A.w > B.x + tol;
  if (r.kind === 'below') return A.y < B.y + B.h - tol;
  if (r.kind === 'above') return A.y + A.h > B.y + tol;
  return false;
}

function score(boxes, work, rels, { canvas, cell, gapF }) {
  const list = work.map((w) => boxes.get(w.id));
  let bad = 0;
  // 钉住的东西自己出了屏幕、两样钉住的互相压着：页面不管（不挪老师摆的），只在版面里报告，不算这一次排得不好
  for (let i = 0; i < list.length; i++) {
    const still = (k) => !!(work[k].pin || work[k].fixed); // 钉住的、定死在格子上的：页面挪不动它们
    if (!inside(list[i], canvas) && !work[i].pin) bad++;
    for (let j = i + 1; j < list.length; j++) if (hits(list[i], list[j]) && !(still(i) && still(j))) bad++;
  }
  const unmet = [];
  let cost = bad * 1e9;
  for (const r of rels) if (violated(r, boxes, cell, gapF)) {
    cost += WEIGHT[r.weight];
    const who = Array.isArray(r.a) ? r.a.join(' ') : r.a;
    const what = r.kind === 'row' || r.kind === 'col' ? `${who} 要${DIR[r.kind]}` : `${who} 要在 ${nameOf(r.b)} ${DIR[r.kind]}`;
    unmet.push({ rel: r, why: `${what}，和别的要求冲突，没照办` });
  }
  for (const it of work) if (it.prev) {
    const b = boxes.get(it.id);
    cost += Math.abs(b.x - it.prev.x) + Math.abs(b.y - it.prev.y);
  }
  return { boxes, unmet, cost, fits: bad === 0 };
}
