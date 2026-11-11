// 舞台上的平面（线代的几何：向量、线性组合、张成、线性变换、特征向量）：数据和指令，不碰 DOM（画法在 plane.view.js）。
// 纯函数，有测试（tests/stage-plane.test.js）。照 array.js 的样子写（docs/stage-types.md）。
//
// 坐标是数学里的 (x, y)（y 朝上），都是精确分数（存成字符串，副本不丢东西）；画面里一格画成 UNIT 像素。
// 线性变换：网格记着「现在是哪个矩阵变过去的」（M）；每个向量、点记着现在的坐标和变换前的坐标（home），退回原样时回到 home。
// 跟着别的向量算的（w = 2u − v、w = k·u）只记式子，每次照式子重新算：u 被拖、k 被拨、平面被变换，w 都跟着走。
// 写成 {式子} 的（vec p w = {A v}，value.js）：式子里能用舞台上的矩阵、拨数，平面上的向量直接写名字；依赖一变场景叫 relive 重算。
import { Q, isQVec, isQMat } from '../../exact.js';
import { bbox } from '../layout.js';
import { toQ, parseRows, placeFor } from './matrix.js';
import { wordDialError } from '../pick.js';

export const UNIT = 56; // 一格多少像素（iPad 上看得清：镜头还会放大一点）
export const MAX_RANGE = 10;
/** 网格外面留给刻度、x / y 的地方 */
export const MARGIN = { l: 28, r: 24, t: 24, b: 24 };
const COLORS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
/** 一块平面最多钉几条 span … stay（多了画面认不清哪条是哪条） */
const STAY_MAX = 6;
const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
const ZERO = new Q(0n);
export const I2 = [['1', '0'], ['0', '1']];

// —— 2×2 的精确矩阵（字符串）——
const q = (s) => toQ(s);
export function mul2(A, B) {
  return [0, 1].map((i) => [0, 1].map((j) => q(A[i][0]).mul(q(B[0][j])).add(q(A[i][1]).mul(q(B[1][j]))).toString()));
}
export function apply2(A, x, y) {
  return [q(A[0][0]).mul(q(x)).add(q(A[0][1]).mul(q(y))).toString(), q(A[1][0]).mul(q(x)).add(q(A[1][1]).mul(q(y))).toString()];
}
export const det2 = (A) => q(A[0][0]).mul(q(A[1][1])).sub(q(A[0][1]).mul(q(A[1][0])));
export function inv2(A) {
  const d = det2(A);
  if (d.zero) return null;
  return [[q(A[1][1]).div(d), q(A[0][1]).neg().div(d)], [q(A[1][0]).neg().div(d), q(A[0][0]).div(d)]].map((r) => r.map(String));
}
export const isI = (M) => M[0][0] === '1' && M[0][1] === '0' && M[1][0] === '0' && M[1][1] === '1';
export const matText = (M) => `${M[0].join(' ')} / ${M[1].join(' ')}`;

// —— 位置（世界坐标，像素）——
export const planeBox = (o) => ({ x: o.origin.x, y: o.origin.y, w: (o.xhi - o.xlo) * UNIT, h: (o.yhi - o.ylo) * UNIT });
export const toWorld = (o, x, y) => ({ x: o.origin.x + (x - o.xlo) * UNIT, y: o.origin.y + (o.yhi - y) * UNIT });
export const fromWorld = (o, p) => ({ x: (p.x - o.origin.x) / UNIT + o.xlo, y: o.yhi - (p.y - o.origin.y) / UNIT });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** 学生拖到的地方吸到最近的格点（不出网格） */
export const snap = (o, p) => ({ x: clamp(Math.round(p.x), o.xlo, o.xhi), y: clamp(Math.round(p.y), o.ylo, o.yhi) });
export const num = (s) => toQ(s).toNumber();
/** 名字贴在哪（字的中心，世界坐标）：箭头尖再往前一点、偏到左手边（像 3Blue1Brown）；点和零向量贴在右上 */
export function nameAt(o, x, y, kind = 'vec') {
  const tip = toWorld(o, x, y), O = toWorld(o, 0, 0);
  const dx = tip.x - O.x, dy = tip.y - O.y, d = Math.hypot(dx, dy);
  if (kind === 'pt' || d < 1) return { x: tip.x + 15, y: tip.y - 15 };
  return { x: tip.x + (dx / d) * 14 + (dy / d) * 13, y: tip.y + (dy / d) * 14 - (dx / d) * 13 };
}
const tipBox = (o, x, y, r = 16) => { const p = toWorld(o, x, y); return { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r }; };

// —— 向量和点 ——
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
/** 画出来的名字：末尾的数字写成下标（a1 → a₁、α2 → α₂） */
export const showName = (n) => String(n).replace(/^(\D+)(\d+)$/, (m, a, d) => a + d.replace(/\d/g, (k) => SUBS[k]));
const NAME_RE = /^[A-Za-zα-ωΑ-Ω][A-Za-z0-9α-ωΑ-Ω_]*['′]?$/u;
const newItem = (o, kind, name) => ({ obj: o.id, key: name, kind, name, label: showName(name), value: '(0, 0)', x: '0', y: '0', hx: '0', hy: '0', expr: null, guide: false, paint: null, glow: false, lift: false, dim: false, covered: false });
function setXY(it, x, y) { it.x = String(x); it.y = String(y); it.value = `(${it.x}, ${it.y})`; }
// 变换前的坐标：网格没变过就是现在的；变过就倒回去（压扁了倒不回去，记 null：退回原样时它留在原地）
function setHome(o, it) {
  if (isI(o.M)) { it.hx = it.x; it.hy = it.y; return; }
  const inv = inv2(o.M);
  if (!inv) { it.hx = null; it.hy = null; return; }
  [it.hx, it.hy] = apply2(inv, it.x, it.y);
}
const vecsOf = (o) => o.items.filter((i) => i.kind === 'vec');
function vecOf(o, name) {
  const it = o.items.find((i) => i.name === name && i.kind === 'vec');
  if (!it) throw new Error(`平面 ${o.id} 上没有向量「${name}」${vecsOf(o).length ? `（有的是：${vecsOf(o).map((i) => i.name).join('、')}）` : `（先 vec ${o.id} ${name} = 2 1）`}`);
  return it;
}
function nextColor(o) {
  const used = new Set(vecsOf(o).map((i) => i.paint));
  return COLORS.find((c) => !used.has(c)) || COLORS[vecsOf(o).length % COLORS.length];
}
function planeOf(scene, id, cmd) {
  const o = id && scene.objects.get(id);
  if (!o) throw new Error(`${cmd} 后面先写平面的名字（比如 ${cmd} p …）${id ? `：舞台上没有「${id}」` : ''}`);
  if (o.type !== 'plane') throw new Error(`「${id}」不是平面`);
  return o;
}

/** 坐标的写法：2 1、(2, 1)、2,1、-1/2 3；不是两个数给 null（全是数但个数不对就报错） */
export function coordsOf(words) {
  const t = words.join(' ').replace(/[()[\]（）]/g, ' ').replace(/[,，]/g, ' ').split(/\s+/).filter(Boolean);
  const qs = t.map(toQ);
  if (qs.length && qs.every(Boolean)) {
    if (qs.length !== 2) throw new Error(`坐标要两个数（写了 ${qs.length} 个）：比如 = 2 1`);
    return qs;
  }
  return null;
}

/**
 * 线性组合的写法 → 一项项 { of: 向量名, k: 系数（精确的数）| null, dial: 拨的数的名字 | null, neg }：
 * 2u - v、u + v、-u、1/2 u、(1/2)u、k u、a u + b v（系数写拨的数时，拨一下它跟着变）
 */
export function parseCombo(text, o, scene, self) {
  const src = String(text ?? '').replace(/[−–]/g, '-').replace(/[*·×]/g, ' ').trim();
  const parts = [];
  let sign = 1, cur = '';
  for (const ch of src) {
    if (ch === '+' || ch === '-') {
      if (!cur.trim()) { if (ch === '-') sign = -sign; continue; }
      if (/[/(]\s*$/.test(cur)) { cur += ch; continue; }
      parts.push({ sign, s: cur.trim() });
      sign = ch === '-' ? -1 : 1;
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (!cur.trim()) throw new Error(`「${text}」没写完：写成 2u - v、u + v、k u`);
  parts.push({ sign, s: cur.trim() });
  const all = o.items.map((i) => i.name).sort((a, b) => b.length - a.length);
  const okCoef = (c) => c === '' || c === '-' || !!toQ(c) || scene.vars.has(c.replace(/^-/, ''));
  return parts.map(({ sign: sg, s }) => {
    const ws = s.split(/\s+/);
    let name, coef;
    if (ws.length > 1) { name = ws.at(-1); coef = ws.slice(0, -1).join(''); } else {
      // 2u、1/2u、ku：名字是末尾和平面上的向量对得上的那一段（长的先试）
      name = all.find((n) => s.endsWith(n) && okCoef(s.slice(0, s.length - n.length))) || s;
      coef = s.slice(0, s.length - name.length);
    }
    if (name === self) throw new Error(`${self} 不能用自己来算`);
    vecOf(o, name);
    let k = null, dial = null, neg = sg < 0;
    if (coef === '' || coef === '-') { k = coef === '-' ? (neg ? '1' : '-1') : neg ? '-1' : '1'; neg = false; } else if (toQ(coef)) { k = (neg ? toQ(coef).neg() : toQ(coef)).toString(); neg = false; } else if (scene.vars.has(coef.replace(/^-/, ''))) {
      dial = coef.replace(/^-/, '');
      if (scene.vars.get(dial).options) throw new Error(wordDialError(dial, scene.vars.get(dial)));
      if (coef.startsWith('-')) neg = !neg;
    } else if (scene.objects.has(coef)) {
      // vec p w = A v：照字面写的矩阵乘向量。系数只收数和拨数，要算式子写在 {} 里（跟着算，value.js）
      throw new Error(`「${coef}」是舞台上的${scene.type(scene.objects.get(coef)).label}，不是系数：要它乘向量写成 {}，vec ${o.id} ${self} = {${coef} ${name}}（跟着 ${coef}、${name} 变）`);
    } else throw new Error(`「${coef}」不是数，也不是拨的数（系数写数或拨数：dial ${coef} = 1 range=0-3；要算式子就写在 {} 里：vec ${o.id} ${self} = {…}）`);
    return { of: name, k, dial, neg };
  });
}
/** 式子写成字给老师看：2u - v、k·u、(1/2)u + v */
export function exprText(expr) {
  return expr.map((t, i) => {
    let neg, body;
    if (t.dial) { neg = t.neg; body = `${t.dial}·${t.of}`; } else {
      const k = toQ(t.k);
      neg = k.n < 0n;
      const a = neg ? k.neg() : k;
      body = `${a.n === 1n && a.d === 1n ? '' : a.integer ? a : `(${a})`}${t.of}`;
    }
    return `${i ? (neg ? ' - ' : ' + ') : neg ? '-' : ''}${body}`;
  }).join('');
}
const coefQ = (t, scene) => {
  if (!t.dial) return toQ(t.k);
  const v = scene.vars.get(t.dial);
  if (!v) throw new Error(`没有叫「${t.dial}」的数`);
  const k = Q.from(v.v);
  return t.neg ? k.neg() : k;
};
/** 系数（浮点，画面用） */
export const coefNum = (t, scene) => (t.dial ? (t.neg ? -1 : 1) * (scene.vars.get(t.dial)?.v ?? 0) : num(t.k));

/** 跟着别的向量算的，照依赖的先后重新算一遍 */
export function refresh(o, scene) {
  const by = new Map(o.items.map((i) => [i.name, i]));
  const ready = new Set(o.items.filter((i) => !i.expr).map((i) => i.name));
  for (let pass = 0; pass <= o.items.length && ready.size < o.items.length; pass++) {
    for (const it of o.items) {
      if (ready.has(it.name) || !it.expr.every((t) => ready.has(t.of))) continue;
      let x = ZERO, y = ZERO;
      for (const t of it.expr) {
        const k = coefQ(t, scene), b = by.get(t.of);
        x = x.add(k.mul(toQ(b.x)));
        y = y.add(k.mul(toQ(b.y)));
      }
      setXY(it, x, y);
      ready.add(it.name);
    }
  }
}
function checkCycle(o, self, expr) {
  const by = new Map(o.items.map((i) => [i.name, i]));
  const seen = new Set();
  const stack = expr.map((t) => t.of);
  while (stack.length) {
    const n = stack.pop();
    if (n === self) throw new Error(`${self} 和别的向量转着圈互相算，算不出来`);
    if (seen.has(n)) continue;
    seen.add(n);
    const it = by.get(n);
    if (it?.expr) stack.push(...it.expr.map((t) => t.of));
  }
}

/** {式子} 算出来的 → 坐标（两个数：向量、2×1 或 1×2 的矩阵） */
function coordsOfValue(v, src) {
  const flat = isQVec(v) ? v : isQMat(v) && (v.length === 1 || v[0].length === 1) ? v.flat() : null;
  if (!flat || flat.length !== 2) throw new Error(`「{${src}}」算出来不是两个数：平面上的向量要两个数（比如 {A v}，A 是 2×2）`);
  return flat.map(String);
}
// vec p w = {A v}：整个 = 后面是一个 {式子}；算出坐标，记着式子（rec 放进 it.live）
function liveItem(scene, h, o, cmd, name, text, guide) {
  if (guide) throw new Error(`sum 不写 {…}：要跟着算写 vec ${o.id} ${name} = {…}`);
  const { parts } = h.parseLive(text);
  const exprs = parts.filter((p) => p.k === 'expr');
  if (exprs.length !== 1 || parts.some((p) => p.k === 'text' && p.v.trim())) throw new Error(`要写成 ${cmd} ${o.id} ${name} = {A v}（整个式子写在一对 {} 里）`);
  const src = exprs[0].v;
  const { value, deps } = h.liveValue(src, { plane: o.id });
  const coords = coordsOfValue(value, src);
  // 依赖成环（w 跟着 z、z 又跟着 w）：先查
  scene.liveCheck([{ id: `${o.id}.${name}`, obj: o.id, deps, live: true }]);
  return { coords, rec: deps.length ? { line: h.line, expr: src, deps } : null };
}

// vec / point / sum 共用：加一个，或者把已有的挪到新坐标、换成新的式子
function setItem(scene, h, cmd, kind, guide = false) {
  const o = planeOf(scene, h.words[0], cmd);
  const name = h.words[1];
  const eq = h.args.findIndex((a) => a.t === 'eq');
  if (!name || !NAME_RE.test(name) || eq < 0) throw new Error(`要写成 ${cmd} ${o.id} ${kind === 'pt' ? 'P = 2 3' : guide ? 'w = u + v' : 'u = 2 1'}（名字用字母开头）`);
  const rhs = h.args.slice(eq + 1).filter((a) => a.t === 'word').map((a) => a.v);
  if (!rhs.length) throw new Error(`「=」后面要写${kind === 'pt' ? '坐标' : '坐标或式子'}`);
  let it = o.items.find((i) => i.name === name);
  if (it && it.kind !== kind) throw new Error(`「${name}」已经是平面上的${it.kind === 'vec' ? '向量' : '点'}了，换一个名字`);
  const live = rhs.some((w) => /[{}]/.test(w)) ? liveItem(scene, h, o, cmd, name, rhs.join(' '), guide) : null;
  const coords = live ? live.coords : coordsOf(rhs);
  if (kind === 'pt' && !coords) throw new Error(`点要写坐标：point ${o.id} ${name} = 2 3`);
  if (guide && coords) throw new Error(`sum 要写成 sum ${o.id} ${name} = u + v（坐标用 vec）`);
  const expr = coords ? null : parseCombo(rhs.join(' '), o, scene, name);
  if (guide && expr.length < 2) throw new Error(`sum 要两项以上：sum ${o.id} ${name} = u + v`);
  if (expr) checkCycle(o, name, expr);
  // 线性组合绕过跟着算的向量转回自己（w = {A z}，又写 z = w + u）：也是环
  if (expr) scene.liveCheck([{ id: `${o.id}.${name}`, obj: o.id, deps: expr.map((t) => `${o.id}.${t.of}`) }]);
  const color = h.opts.color;
  if (color != null && !COLORS.includes(color)) throw new Error(`颜色只有 g1～g6（${COLORS.map((k) => `${k} ${COLOR_NAMES[k]}`).join('、')}）`);
  const fresh = !it;
  if (fresh) {
    it = newItem(o, kind, name);
    it.paint = kind === 'vec' ? nextColor(o) : null;
    o.items.push(it);
  }
  if (color) it.paint = color;
  const before = fresh ? null : [it.x, it.y];
  it.expr = expr;
  it.guide = guide;
  if (live?.rec) it.live = live.rec; else delete it.live;
  if (coords) { setXY(it, coords[0], coords[1]); setHome(o, it); }
  if (expr) for (const t of expr) if (t.dial && !scene.binds.some((b) => b.kind === 'vec' && b.obj === o.id && b.v === t.dial)) scene.binds.push({ kind: 'vec', obj: o.id, v: t.dial });
  refresh(o, scene);
  return { id: o.id, key: name, fresh, before };
}

/** 张成：一条线（方向）、整个平面、只有原点。stay 的照画的那时候的样子，别的照向量现在的样子 */
export function spanOf(o, s) {
  const vs = s.at || s.of.map((n) => { const i = o.items.find((x) => x.name === n); return i ? [i.x, i.y] : ['0', '0']; });
  const nz = vs.filter(([x, y]) => !(toQ(x).zero && toQ(y).zero));
  if (!nz.length) return { kind: 'point' };
  if (nz.length === 2 && !toQ(nz[0][0]).mul(toQ(nz[1][1])).sub(toQ(nz[0][1]).mul(toQ(nz[1][0]))).zero) return { kind: 'plane' };
  return { kind: 'line', dir: nz[0] };
}

/** transform 后面写的矩阵：= 1 1 / 0 1、[[1 1][0 1]]，或者舞台上一个 2×2 矩阵的名字 */
function matrixArg(scene, words, o) {
  const bad = () => new Error(`transform 要一个 2×2 矩阵：transform ${o.id} = 1 1 / 0 1，或者舞台上 2×2 矩阵的名字（transform ${o.id} A）`);
  if (!words.length) throw bad();
  if (words.length === 1 && scene.objects.has(words[0])) {
    const m = scene.objects.get(words[0]);
    if (m.type !== 'matrix' || m.rows !== 2 || m.cols !== 2 || m.aug) throw new Error(`「${words[0]}」不是 2×2 的矩阵（平面只能做 2×2 的变换）`);
    const cell = (r, c) => {
      const x = m.cells.find((k) => k.r === r && k.c === c);
      if (x.value === '') throw new Error(`${m.id}.${r},${c} 还空着`);
      return x.value;
    };
    return [[cell(1, 1), cell(1, 2)], [cell(2, 1), cell(2, 2)]];
  }
  let rows;
  try { ({ rows } = parseRows(words)); } catch { throw bad(); }
  if (rows.length !== 2 || rows[0].length !== 2) throw bad();
  return rows;
}

function parseRange(v, what) {
  const s = String(v).trim();
  let m = s.match(/^(-?\d+)\s*(?:\.\.|~|…|,|到)\s*(-?\d+)$/);
  if (!m && /^\d+$/.test(s)) m = [s, `-${s}`, s];
  if (!m) throw new Error(`${what} 要写成 -4..4`);
  const lo = Number(m[1]), hi = Number(m[2]);
  if (!(lo <= 0 && hi >= 0 && lo < hi)) throw new Error(`${what}=${s}：要把原点包在里面（比如 -4..4、0..5）`);
  if (-lo > MAX_RANGE || hi > MAX_RANGE) throw new Error(`${what} 最多到 ±${MAX_RANGE}`);
  return [lo, hi];
}

function objectBox(o) {
  const b = planeBox(o);
  const boxes = [{ x: b.x - MARGIN.l, y: b.y - MARGIN.t, w: b.w + MARGIN.l + MARGIN.r, h: b.h + MARGIN.t + MARGIN.b }];
  for (const it of o.items) {
    const x = num(it.x), y = num(it.y), n = nameAt(o, x, y, it.kind);
    boxes.push(tipBox(o, x, y, 18), { x: n.x - 14, y: n.y - 14, w: 28, h: 28 });
  }
  return bbox(boxes);
}

export const plane = {
  type: 'plane',
  label: '平面',
  create: ['plane'],
  // 认得的选项（名字=值，scene.js 的 checkOptions；造它的那一行另外都认 hide=）：写了不认得的当场报，不默默当没写
  options: { plane: ['range', 'x', 'y', 'beside'], vec: ['color'], point: ['color'], sum: ['color'], span: ['color'] },
  drag: true,
  hint: '（平面：名字.u 是向量 u（从原点出发的箭头），名字.P 是点 P；坐标是数学里的 (x, y)，y 朝上）',
  make(scene, c, h) {
    const [xlo, xhi] = parseRange(h.opts.x ?? h.opts.range ?? '-4..4', h.opts.x != null ? 'x' : 'range');
    const [ylo, yhi] = parseRange(h.opts.y ?? h.opts.range ?? '-4..4', h.opts.y != null ? 'y' : 'range');
    const o = { origin: { x: 0, y: 0 }, xlo, xhi, ylo, yhi, M: I2.map((r) => [...r]), items: [], spans: [] };
    const w = (xhi - xlo) * UNIT + MARGIN.l + MARGIN.r, hh = (yhi - ylo) * UNIT + MARGIN.t + MARGIN.b;
    const at = placeFor(scene, { w, h: hh }, h.opts);
    o.origin = { x: at.x + MARGIN.l, y: at.y + MARGIN.t };
    return o;
  },
  parts(o) { return [...o.items]; },
  /** 扣着的向量、点画成小块写它的名字（u），不写坐标（scene.js 的 coverText） */
  coverName: (p) => p.label,
  pick(o, mark, sel, word) {
    const it = mark === '.' && o.items.find((i) => i.name === sel);
    if (!it) throw new Error(`「${word}」：平面写 ${o.id}.u（向量 u）、${o.id}.P（点 P）${o.items.length ? `，${o.id} 上有的是：${o.items.map((i) => i.name).join('、')}` : `，${o.id} 上还没有（先 vec ${o.id} u = 2 1）`}`);
    return [it];
  },
  ref(p) { return `${p.obj}.${p.name}`; },
  partBox(o, p) { return tipBox(o, num(p.x), num(p.y)); },
  objectBox,
  obstacles(o) {
    const out = [];
    const O = toWorld(o, 0, 0);
    for (const it of o.items) {
      const x = num(it.x), y = num(it.y), T = toWorld(o, x, y), n = nameAt(o, x, y, it.kind);
      out.push(tipBox(o, x, y, 18), { x: n.x - 13, y: n.y - 13, w: 26, h: 26 });
      // 箭杆：每隔一段放一个小框（贴字别压着箭）
      if (it.kind === 'vec') {
        const d = Math.hypot(T.x - O.x, T.y - O.y);
        for (let s = 30; s < d - 16; s += 30) out.push({ x: O.x + ((T.x - O.x) * s) / d - 7, y: O.y + ((T.y - O.y) * s) / d - 7, w: 14, h: 14 });
      }
    }
    return out;
  },
  onVar(scene, o, b) {
    if (b.kind !== 'vec') return null;
    refresh(o, scene);
    return { id: o.id };
  },
  /** 依赖图里的结（场景拿来排先后、查环）：写成 {式子} 的向量要重算（live）；线性组合只用来查环（它们照旧 refresh） */
  depNodes(o) {
    return o.items.flatMap((it) => {
      const id = `${o.id}.${it.name}`;
      if (it.live) return [{ id, key: it.key, deps: it.live.deps, live: true, rec: it.live, text: `${id} = {${it.live.expr}}` }];
      if (it.expr) return [{ id, key: it.key, deps: it.expr.map((t) => `${o.id}.${t.of}`) }];
      return [];
    });
  },
  /** 写成 {式子} 的向量重算：坐标变了挪过去，跟着它的线性组合一起走 */
  relive(scene, o, n) {
    const it = o.items.find((i) => i.key === n.key);
    const { value, deps } = scene.liveValue(it.live.expr, { plane: o.id });
    const [x, y] = coordsOfValue(value, it.live.expr);
    it.live.deps = deps;
    if (x === it.x && y === it.y) return { changed: [] };
    const from = it.value;
    setXY(it, x, y);
    setHome(o, it);
    refresh(o, scene);
    return { changed: [{ ref: `${o.id}.${it.name}`, from, to: it.value }], parts: [it] };
  },
  commands: {
    // vec p u = 2 1：加向量 / 挪到新坐标；vec p w = 2u - v、vec p w = k u：跟着算的
    vec(scene, c, h) { return setItem(scene, h, 'vec', 'vec'); },
    point(scene, c, h) { return setItem(scene, h, 'point', 'pt'); },
    // sum p w = u + v：首尾相接画出和（v 的副本挪到 u 的尖上，再画出 w，平行四边形的另一半补上）
    sum(scene, c, h) { return setItem(scene, h, 'sum', 'vec', true); },
    unsum(scene, c, h) {
      const o = planeOf(scene, h.words[0], 'unsum');
      const names = h.words.slice(1);
      for (const it of o.items) if (!names.length || names.includes(it.name)) it.guide = false;
      return { id: o.id };
    },
    unvec(scene, c, h) {
      const o = planeOf(scene, h.words[0], 'unvec');
      const names = h.words.slice(1);
      for (const n of names) if (!o.items.some((i) => i.name === n)) throw new Error(`平面 ${o.id} 上没有「${n}」`);
      const gone = new Set(names.length ? names : o.items.map((i) => i.name));
      o.items = o.items.filter((i) => !gone.has(i.name));
      // 跟着拿掉的那个算的：定在现在的位置
      for (const it of o.items) if (it.expr?.some((t) => gone.has(t.of))) { it.expr = null; it.guide = false; setHome(o, it); }
      for (const it of o.items) if (it.live?.deps.some((d) => [...gone].some((n) => d === `${o.id}.${n}`))) { delete it.live; setHome(o, it); }
      o.spans = o.spans.filter((s) => !s.of.some((n) => gone.has(n)));
      for (const [k, l] of scene.labels) if (l.refs.some((r) => [...gone].some((n) => r === `${o.id}.${n}`))) scene.labels.delete(k);
      for (const [k, l] of scene.links) if ((l.a.obj === o.id && gone.has(l.a.key)) || (l.b.obj === o.id && gone.has(l.b.key))) scene.links.delete(k);
      return { id: o.id, gone: [...gone] };
    },
    // span p u（一条线）/ span p u v（两个不共线就是整个平面）；stay：停在这时的样子，之后拖、变换都不跟着动
    span(scene, c, h) {
      const o = planeOf(scene, h.words[0], 'span');
      const stay = h.words.includes('stay');
      const names = h.words.slice(1).filter((w) => w !== 'stay');
      if (!names.length || names.length > 2) throw new Error(`span 后面写一个或两个向量：span ${o.id} u、span ${o.id} u v`);
      const its = names.map((n) => vecOf(o, n));
      const color = h.opts.color ?? its[0].paint ?? 'g1';
      if (!COLORS.includes(color)) throw new Error('颜色只有 g1～g6');
      const base = names.join('+');
      if (!stay) {
        // 跟着走的：同一组向量只有一条，再写就换掉（钉着的不动）
        o.spans = o.spans.filter((s) => s.id !== base);
        o.spans.push({ id: base, of: names, color, at: null });
        return { id: o.id, span: base };
      }
      // 钉着的能留几条（主线第一轮 L3-5：以前第二次写把第一条换掉，收集两条特征线只剩一条，也不报）。
      // 同一个地方再钉一次不多一条；一块平面最多钉 STAY_MAX 条
      const at = its.map((i) => [i.x, i.y]);
      const sameAt = (s) => s.at && s.of.join('+') === base && JSON.stringify(s.at.map((p) => p.map(String))) === JSON.stringify(at.map((p) => p.map(String)));
      const had = o.spans.find(sameAt);
      if (had) { had.color = color; return { id: o.id, span: had.id }; }
      const pinned = o.spans.filter((s) => s.at);
      // 重放旧课（那时每次换掉上一条，钉多少次都行）：不报，换掉最早钉的那一条
      if (pinned.length >= STAY_MAX && c.lenient) o.spans = o.spans.filter((s) => s !== pinned[0]);
      else if (pinned.length >= STAY_MAX) throw new Error(`一块平面最多钉 ${STAY_MAX} 条（span … stay）：先 unspan ${o.id} 收掉几条`);
      // 跟着走的那一条换成钉着的（照旧：同一组向量先 span 再 span … stay，是把它钉住）
      o.spans = o.spans.filter((s) => s.id !== base);
      let n = 1;
      while (o.spans.some((s) => s.id === `${base}@${n}`)) n++;
      const id = `${base}@${n}`;
      o.spans.push({ id, of: names, color, at });
      return { id: o.id, span: id };
    },
    unspan(scene, c, h) {
      const o = planeOf(scene, h.words[0], 'unspan');
      const names = h.words.slice(1);
      o.spans = names.length ? o.spans.filter((s) => !s.of.some((n) => names.includes(n))) : [];
      return { id: o.id };
    },
    // transform p = 1 1 / 0 1、transform p A：网格和上面的向量、点一起变过去（再写一次是接着变：先 A 再 B）
    transform(scene, c, h) {
      const o = planeOf(scene, h.words[0], 'transform');
      const A = matrixArg(scene, h.words.slice(1), o);
      const from = o.M;
      // 跟着算的（线性组合、{A v}）不直接变：它们依赖的变过去以后照式子重算
      for (const it of o.items) if (!it.expr && !it.live) { const [x, y] = apply2(A, it.x, it.y); setXY(it, x, y); }
      o.M = mul2(A, o.M);
      refresh(o, scene);
      // 用的是舞台上的矩阵：画面让它闪一下（看得出是谁在变换平面）
      const by = h.words.length === 2 && scene.objects.get(h.words[1])?.type === 'matrix' ? h.words[1] : null;
      return { id: o.id, A, from, to: o.M, by };
    },
    untransform(scene, c, h) {
      const o = planeOf(scene, h.words[0], 'untransform');
      const from = o.M;
      for (const it of o.items) {
        if (it.expr || it.live) continue;
        if (it.hx != null) setXY(it, it.hx, it.hy);
        it.hx = it.x;
        it.hy = it.y;
      }
      o.M = I2.map((r) => [...r]);
      refresh(o, scene);
      return { id: o.id, from, to: o.M };
    },
  },
  describe(o) {
    const lines = [`平面 ${o.id}（x 从 ${o.xlo} 到 ${o.xhi}，y 从 ${o.ylo} 到 ${o.yhi}；一格是 1）：`];
    if (!o.items.length) lines.push('  上面还没有向量和点');
    const changed = !isI(o.M);
    for (const it of o.items) {
      const bits = [];
      if (it.paint) bits.push(COLOR_NAMES[it.paint]);
      if (it.glow) bits.push('亮');
      if (it.dim) bits.push('灰');
      if (it.covered) bits.push('扣着');
      if (it.guide) bits.push('首尾相接画着');
      if (num(it.x) < o.xlo || num(it.x) > o.xhi || num(it.y) < o.ylo || num(it.y) > o.yhi) bits.push('出了网格');
      const def = it.expr ? ` = ${exprText(it.expr)}` : it.live ? ` = {${it.live.expr}}` : '';
      const home = changed && !it.expr && !it.live && it.hx != null && (it.hx !== it.x || it.hy !== it.y) ? `，变换前是 (${it.hx}, ${it.hy})` : '';
      lines.push(`  ${it.kind === 'vec' ? '向量' : '点'} ${it.name}${def} = (${it.x}, ${it.y})${bits.length ? `（${bits.join('、')}）` : ''}${home}`);
    }
    if (changed) lines.push(`  网格做过线性变换：现在是矩阵 (${matText(o.M)}) 变过去的样子（untransform 退回原样）`);
    for (const s of o.spans) {
      const k = spanOf(o, s);
      const what = k.kind === 'plane' ? '整个平面' : k.kind === 'point' ? '只有原点' : `一条过原点的直线（方向 (${k.dir.join(', ')})）`;
      lines.push(`  张成：${s.of.join('、')} 张成${what}，${COLOR_NAMES[s.color]}色涂着${s.at ? '（停在画的时候，之后不跟着动）' : ''}`);
    }
    return lines;
  },
  doc: `平面（向量、线性组合、张成、线性变换、特征向量）：
plane p range=-4..4               造坐标平面（网格、坐标轴，y 朝上）
写法：p.u 向量 u（从原点出发的箭头）；p.P 点 P
vec p u = 2 1 color=g1            加向量；再写一次就滑到新坐标
vec p w = 2u - v                  线性组合（u、v 变了它跟着变；系数能写拨的数：vec p w = k u）
vec p w = {A v}                   跟着算：矩阵 A 乘 v（A、v 一变 w 跟着变；学生拖不动 w）
point p P = 2 3                   加一个点
sum p w = u + v                   首尾相接画出和（平行四边形法则）
span p u / span p u v / unspan p  淡淡涂上张成的直线或整个平面（写 stay 就钉住这时的样子，能钉几条）
transform p A                     线性变换：网格和向量一起平滑地变过去（A 是舞台上的 2×2 矩阵，也能直接写 transform p = 1 1 / 0 1；再写是接着变）
untransform p                     退回原样
unvec p u                         拿掉向量或点
ask drag p.u "…"                  学生拖向量末端（落在格点上），页面照做，告诉你新坐标`,
  example: `plane p range=-4..4
vec p u = 2 1
vec p v = -1 2
sum p w = u + v
say "从原点先走 {p.u}，再接着走 {p.v}，就到了 {p.w} 的尖上。"
matrix A = 1 1 / 0 1 beside=p
transform p A
span p w
ask drag p.u "把 {p.u} 拖到别的格点上，看 {p.w} 怎么跟着变。"`,
};
