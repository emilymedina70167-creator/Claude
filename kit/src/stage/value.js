// 舞台上跟着算的量（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 4 节）：任何一个值都能写成 {式子}——
// 一格、整个矩阵、平面上的向量、一排格子里的数、图的边权；依赖的东西（拨数、矩阵、一格、向量）变了，页面当场重算。
// 纯函数，不碰 DOM，有测试（tests/stage-value.test.js）。
//
// 式子交给黑板已有的精确计算（exact.js 的 evaluateExact：分数、矩阵加减乘、数乘、转置、求逆、行列式都现成），
// 这里只管舞台这边的事：一行里的 {…} 拆出来、式子里的名字换成舞台上的值、用到了谁（依赖）、按依赖排先后、查环。
// 场景（scene.js）把用了 {…} 的东西记成 o.live = { line, deps, … }，每一行之后照这里排的先后重算。
import { evaluateExact, exactText, isQ, isQVec, isQMat, Q, isExactFunc } from '../exact.js';
import { names } from '../expr.js';
import { parseRef } from './script.js';
import { toQ } from './types/matrix.js';
import { evalMeasure } from './rules.js';

const QUOTES = { '"': '"', '「': '」', '“': '”' };

/**
 * 一行里的 {…} 拆出来：{ parts: [{ k: 'text', v } | { k: 'expr', v }] }。
 * 引号里的照原样算字（话、题卡、贴的字里的 {a.3}、{d} 是话里的小块，不是式子）；没收尾、空的、套着的当场报出来
 */
export function parseLive(text) {
  const s = String(text ?? '');
  const parts = [];
  let buf = '';
  const flush = () => { if (buf) parts.push({ k: 'text', v: buf }); buf = ''; };
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (QUOTES[ch]) {
      const j = s.indexOf(QUOTES[ch], i + 1);
      const end = j < 0 ? s.length : j + 1;
      buf += s.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '{') {
      const j = s.indexOf('}', i + 1);
      if (j < 0) throw new Error(`「${s.slice(i, i + 16)}」的 { 没有收尾（式子写在一对 {} 里）`);
      const inner = s.slice(i + 1, j);
      if (inner.includes('{')) throw new Error(`{} 里面不能再套 {}：${s.slice(i, j + 1)}`);
      if (!inner.trim()) throw new Error('{} 里要写式子（比如 {k}、{A + B}、{P^-1}）');
      flush();
      parts.push({ k: 'expr', v: inner.trim() });
      i = j + 1;
      continue;
    }
    if (ch === '}') throw new Error(`多了一个 }：${s.slice(Math.max(0, i - 12), i + 1)}`);
    buf += ch;
    i++;
  }
  flush();
  return { parts };
}

// —— 舞台上的东西 → 式子里的值 ——
/** 矩阵 → Q 的二维数组（按现在的行列）；还空着的格用到才报 */
function matrixValue(o) {
  const out = [];
  for (let r = 1; r <= o.rows; r++) {
    out.push(o.cells.filter((x) => x.r === r).sort((a, b) => a.c - b.c).map((x) => {
      if (x.value === '') throw new Error(`${o.id}.${x.r},${x.c} 还空着`);
      return toQ(x.value);
    }));
  }
  return out;
}
const isPoint = (p) => (p.kind === 'vec' || p.kind === 'pt') && p.x != null && p.y != null;
// 一个部件的值：平面上的向量、点是列向量；别的（一格、结点、边权）是数（49′ 当 49）
function partQ(p, ref) {
  if (isPoint(p)) return [toQ(p.x), toQ(p.y)];
  if (p.value === '' || p.value == null) throw new Error(`${ref} 还空着`);
  const q = toQ(String(p.value).replace(/[′']/g, ''));
  if (!q) throw new Error(`${ref} 是「${p.value}」，不是数`);
  return q;
}
/** 部件写法的值（B.1,2 是数、p.u 是向量、A.r1 是一串数） */
export function partValue(scene, ref) {
  const ps = scene.parts(ref);
  if (ps.length === 1) return partQ(ps[0], ref);
  return ps.map((p) => { const v = partQ(p, ref); if (!isQ(v)) throw new Error(`${ref} 里有向量，式子里一个一个写`); return v; });
}

/**
 * 式子里的名字 → 值（exact.js 的 vars）：拨数是数；舞台上的矩阵是 Q 的二维数组；给了平面（vec p w = {A v}）时，
 * 这个平面上的向量、点直接写名字（列向量）。同名时平面上的 > 舞台上的东西 > 拨数。都是用到才算（乘积还空着也不碍事）
 */
export function scopeOf(scene, { plane } = {}) {
  const vars = {};
  const put = (k, get) => Object.defineProperty(vars, k, { get, enumerable: true, configurable: true });
  for (const [k, v] of scene.vars) put(k, () => Q.from(v.v));
  for (const o of scene.objects.values()) if (o.type === 'matrix') put(o.id, () => matrixValue(o));
  const p = plane && scene.objects.get(plane);
  if (p?.items) for (const it of p.items) put(it.name, () => [toQ(it.x), toQ(it.y)]);
  return vars;
}

// —— 写法的容错：B.1,2 这类部件、省略的乘号（A v）、上标（P⁻¹、A²、Aᵀ）——
// 部件写法：名字.2,3 / 名字.u / 名字#3（前面不能贴着字母数字或点，不然 0.5、x1.2 会被认错）
const REF_RE = /(?<![\w.#])([A-Za-z_]\w*)([.#])(\d+[,，]\d+|\w+)/g;
// 量的写法：名字(东西或部件)（rules.js 的 parseMeasure，这里找一行里的每一处）
const MEASURE_RE = /(?<![\w.#])([A-Za-z_]\w*)\(\s*([^()\s]+)\s*\)/g;
const SUPS = [[/⁻¹/g, '^(-1)'], [/²/g, '^2'], [/³/g, '^3'], [/ᵀ/g, "'"]];
const TOK = /\s*(?:(0[xX][0-9A-Fa-f_]+|0[bB][01_]+|\d+\.?\d*|\.\d+)|([A-Za-z_Ͱ-Ͽ][\wͰ-Ͽ]*)|(\*\*|<=|>=|==|!=|\S))/y;
// exact.js 只认数后面省略乘号（2u）；舞台上老师常写 A v、P B、(A + B) v：两样值挨着就补一个 *（名字后面紧跟括号是函数，除非它是舞台上的值）
function withTimes(s, isVal) {
  const out = [];
  let prev = null;
  for (let pos = 0; pos < s.length;) {
    TOK.lastIndex = pos;
    if (/^\s*$/.test(s.slice(pos))) break;
    const m = TOK.exec(s);
    if (!m) break;
    pos = TOK.lastIndex;
    const t = m[1] != null ? { k: 'num', v: m[1] } : m[2] != null ? { k: 'id', v: m[2] } : { k: 'op', v: m[3] };
    const ends = prev && (prev.k !== 'op' || [')', ']', "'"].includes(prev.v));
    const starts = t.k !== 'op' || t.v === '(' || t.v === '[';
    const call = prev?.k === 'id' && t.v === '(' && !isVal(prev.v);
    if (ends && starts && !call && !(prev.k === 'num' && t.k === 'num')) out.push('*');
    out.push(t.v);
    prev = t;
  }
  return out.join(' ');
}
const BUILTIN = new Set(['I', 'E', 'pi', 'e']);

/**
 * 算一个 {式子}：{ value（Q / 向量 / 矩阵）, deps（用到的名字：拨数名、东西的名字、部件写法；平面上的向量写成 p.v） }。
 * ctx.plane：写在哪个平面上（那个平面的向量直接写名字）。写错了、算不出来（不可逆、维数对不上、还空着）抛错，错误里有原式子
 */
export function evalLive(src, scene, { plane } = {}) {
  const raw = String(src ?? '').trim().replace(/^\{([^{}]*)\}$/, '$1').trim();
  if (!raw) throw new Error('{} 里要写式子（比如 {k}、{A + B}、{P^-1}）');
  const shown = `「{${raw}}」`;
  const vars = scopeOf(scene, { plane });
  const local = new Set(plane ? (scene.objects.get(plane)?.items || []).map((i) => i.name) : []);
  const refs = new Map(); // 占位的名字 → 部件写法
  const ms = new Map(); // 占位的名字 → 量算的是哪样东西（依赖）
  let text = raw.replace(/[−–]/g, '-');
  for (const [re, to] of SUPS) text = text.replace(re, to);
  // 量（count(t)、rankA(M)）先换成页面数出来的数：括号里是舞台上的东西或部件、名字不是 exact.js 本来就有的函数才换——
  // det(A)、rank(M) 照旧交给 exact.js（写满时两边算的一样，旧课的 {det(A)} 一字不变）；名字不是这样东西的量当场报（size(t)）
  text = text.replace(MEASURE_RE, (m, name, arg) => {
    const obj = parseRef(arg)?.obj;
    if (isExactFunc(name) || !obj || !scene.objects.has(obj)) return m;
    let r;
    try { r = evalMeasure(scene, `${name}(${arg})`); } catch (e) { throw new Error(`${shown}里的「${m}」：${e.message}`); }
    if (r.value == null) throw new Error(`${shown}里的「${m}」页面数不了：${r.why}`);
    const k = `_m${ms.size}_`;
    ms.set(k, obj);
    Object.defineProperty(vars, k, { value: Q.from(r.value), enumerable: true });
    return ` ${k} `;
  });
  text = text.replace(REF_RE, (m, obj) => {
    if (!scene.objects.has(obj)) throw new Error(`${shown}里的「${m}」：舞台上没有「${obj}」`);
    let v;
    try { v = partValue(scene, m); } catch (e) { throw new Error(`${shown}里的「${m}」：${e.message}`); }
    const k = `_r${refs.size}_`;
    refs.set(k, m);
    Object.defineProperty(vars, k, { value: v, enumerable: true });
    return ` ${k} `;
  });
  text = withTimes(text, (n) => n in vars);
  let used;
  try { used = names(text); } catch (e) { throw new Error(`${shown}写错了：${e.message}`); }
  for (const n of used) {
    if (n in vars || BUILTIN.has(n)) continue;
    const o = scene.objects.get(n);
    // 平面上的向量：写在别的东西里要带上平面的名字
    const on = !o && [...scene.objects.values()].find((x) => x.items?.some((i) => i.name === n));
    throw new Error(`${shown}里的「${n}」${o ? `是${scene.type(o).label}，式子里写它的部件（比如 ${n}.…）` : on ? `是平面 ${on.id} 上的，写成 ${on.id}.${n}` : '不是拨数，也不是舞台上的东西'}`);
  }
  let value;
  try { value = evaluateExact(text, vars); } catch (e) { throw new Error(`${shown}算不出来：${e.message}`); }
  if (!(isQ(value) || isQVec(value) || isQMat(value))) throw new Error(`${shown}算出来的不是数、向量或矩阵`);
  const deps = [];
  const add = (d) => { if (!deps.includes(d)) deps.push(d); };
  for (const n of used) {
    if (refs.has(n)) add(refs.get(n));
    else if (ms.has(n)) add(ms.get(n));
    else if (local.has(n)) add(`${plane}.${n}`);
    else if (scene.objects.has(n) || scene.vars.has(n)) add(n);
  }
  return { value, deps };
}

/** 算出来的数写成字：整数、有限小数照写（图的边权、格子里的数要这样），别的写分数 */
export function numText(q) {
  if (q.integer) return q.toString();
  let d = q.d, k = 0;
  while (d % 2n === 0n) { d /= 2n; k++; }
  while (d % 5n === 0n) { d /= 5n; k++; }
  if (d !== 1n || k > 6) return q.toString();
  return String(q.toNumber());
}
/** 值写给老师看（报错里用）：3/4、[1, 2]、[[1, 2], [3, 4]] */
export const valueText = (v) => { try { return exactText(v); } catch { return '？'; } };

/**
 * 造东西的那一行里的 {…} 都算成数，换回一行（一排格子、图这类照新的数重新造）：
 * { text（换好的一行）, exprs（原来的式子）, vals（算出来的字）, deps }；这一行里没有 {…} 给 null
 */
export function fillLine(line, scene) {
  const { parts } = parseLive(line);
  if (!parts.some((p) => p.k === 'expr')) return null;
  const exprs = [], vals = [], deps = [];
  let text = '';
  for (const p of parts) {
    if (p.k === 'text') { text += p.v; continue; }
    const r = evalLive(p.v, scene);
    if (!isQ(r.value)) throw new Error(`「{${p.v}}」算出来是 ${valueText(r.value)}，这里要一个数`);
    const v = numText(r.value);
    exprs.push(p.v);
    vals.push(v);
    text += v;
    for (const d of r.deps) if (!deps.includes(d)) deps.push(d);
  }
  return { text, exprs, vals, deps };
}

/**
 * 按依赖排先后：nodes 是 [{ id, deps }]（id 是东西的名字 S，或者平面上的向量 p.w）；依赖写成部件（S.1,2）也算依赖 S。
 * 返回 id 的先后（依赖的在前）。成环时抛错，列出环上的名字（err.cycle 是环上的 id）
 */
export function liveOrder(nodes) {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const targets = (n) => {
    const out = [];
    for (const d of n?.deps || []) {
      let t = by.has(d) ? d : null;
      if (!t) { const r = parseRef(d); if (r && r.mark && by.has(r.obj)) t = r.obj; }
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  };
  const order = [], state = new Map(), stack = [];
  const visit = (id) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const cyc = [...stack.slice(stack.indexOf(id)), id];
      const err = new Error(cyc.length === 2 ? `${id} 跟着自己算，算不出来` : `${cyc.join(' → ')} 转着圈互相算，算不出来（先把其中一个写成数）`);
      err.cycle = cyc.slice(0, -1);
      throw err;
    }
    state.set(id, 1);
    stack.push(id);
    for (const t of targets(by.get(id))) visit(t);
    stack.pop();
    state.set(id, 2);
    order.push(id);
  };
  for (const n of nodes) visit(n.id);
  return order;
}
