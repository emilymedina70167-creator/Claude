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
/**
 * 矩阵 → Q 的二维数组（按现在的行列）；还空着的格用到才报。
 * fill(东西的名字, 格)：给了就拿它的数顶上空格子（evalBlank 试算用：空格子上挂的跟着算的，先挂上、空着的那几格空着）
 */
function matrixValue(o, fill = null) {
  const out = [];
  for (let r = 1; r <= o.rows; r++) {
    out.push(o.cells.filter((x) => x.r === r).sort((a, b) => a.c - b.c).map((x) => {
      if (x.value === '') { if (fill) return fill(o.id, x); throw new Error(`${o.id}.${x.r},${x.c} 还空着`); }
      return toQ(x.value);
    }));
  }
  return out;
}
const isPoint = (p) => (p.kind === 'vec' || p.kind === 'pt') && p.x != null && p.y != null;
// 一个部件的值：平面上的向量、点是列向量；别的（一格、结点、边权）是数（49′ 当 49）
function partQ(p, ref, fill = null) {
  if (isPoint(p)) return [toQ(p.x), toQ(p.y)];
  if ((p.value === '' || p.value == null) && fill && p.r != null) return fill(p.obj, p);
  if (p.value === '' || p.value == null) throw new Error(`${ref} 还空着`);
  const q = toQ(String(p.value).replace(/[′']/g, ''));
  if (!q) throw new Error(`${ref} 是「${p.value}」，不是数`);
  return q;
}
/** 部件写法的值（B.1,2 是数、p.u 是向量、A.r1 是一串数） */
export function partValue(scene, ref, fill = null) {
  const ps = scene.parts(ref);
  if (ps.length === 1) return partQ(ps[0], ref, fill);
  return ps.map((p) => { const v = partQ(p, ref, fill); if (!isQ(v)) throw new Error(`${ref} 里有向量，式子里一个一个写`); return v; });
}

/**
 * 式子里的名字 → 值（exact.js 的 vars）：拨数是数；舞台上的矩阵是 Q 的二维数组；给了平面（vec p w = {A v}）时，
 * 这个平面上的向量、点直接写名字（列向量）。同名时平面上的 > 舞台上的东西 > 拨数。都是用到才算（乘积还空着也不碍事）
 */
export function scopeOf(scene, { plane, fill = null } = {}) {
  const vars = {};
  const put = (k, get) => Object.defineProperty(vars, k, { get, enumerable: true, configurable: true });
  for (const [k, v] of scene.vars) put(k, () => Q.from(v.v));
  for (const o of scene.objects.values()) if (o.type === 'matrix') put(o.id, () => matrixValue(o, fill));
  const p = plane && scene.objects.get(plane);
  if (p?.items) for (const it of p.items) put(it.name, () => [toQ(it.x), toQ(it.y)]);
  return vars;
}

// —— 写法的容错：B.1,2 这类部件、省略的乘号（A v）、上标（P⁻¹、A²、Aᵀ）——
// 部件写法：名字.2,3 / 名字.u / 名字#3（前面不能贴着字母数字或点，不然 0.5、x1.2 会被认错）
const REF_RE = /(?<![\w.#])([A-Za-z_]\w*)([.#])(\d+[,，]\d+|\w+)/g;
// 量的写法：名字(东西或部件)（rules.js 的 parseMeasure，这里找一行里的每一处）
const MEASURE_RE = /(?<![\w.#])([A-Za-z_]\w*)\(\s*([^()\s]+)\s*\)/g;
// 增广矩阵拆开：coef(M) 竖线左边（系数矩阵）、rhs(M) 竖线右边（常数项）——要验 A x = b 就写 {coef(M) P - rhs(M)}
const SLICE_RE = /(?<![\w.#])(coef|rhs)\(\s*([A-Za-z_]\w*)\s*\)/g;
/**
 * 增广矩阵的一半：coef 是 Q 的二维数组（竖线左边）；rhs 是竖线右边，照舞台上一列的矩阵（matrix P = 1 / 2）的样子
 * 也是二维数组（n×1），和 coef(M) P 算出来的一样，能直接相减（exact.js 里 n×1 的矩阵和向量不能相加）
 */
function sliceOf(scene, fn, id, fill = null) {
  const o = scene.objects.get(id);
  if (!o) throw new Error(`舞台上没有「${id}」`);
  if (o.type !== 'matrix') throw new Error(`「${id}」是${scene.type(o).label}，${fn}(…) 写增广矩阵`);
  if (!o.aug) throw new Error(`${id} 不是增广矩阵（${fn} 拆的是竖线 | ${fn === 'coef' ? '左边' : '右边'}）`);
  // 只看用到的那一半：左边还空着不碍 rhs 的事；还空着的格照它在 M 里的位置报
  const want = (x) => (fn === 'coef' ? x.c <= o.aug : x.c > o.aug);
  const rows = [];
  for (let r = 1; r <= o.rows; r++) {
    rows.push(o.cells.filter((x) => x.r === r && want(x)).sort((a, b) => a.c - b.c).map((x) => {
      if (x.value === '') { if (fill) return fill(o.id, x); throw new Error(`${o.id}.${x.r},${x.c} 还空着`); }
      return toQ(x.value);
    }));
  }
  return rows;
}
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
export function evalLive(src, scene, { plane, fill = null } = {}) {
  const raw = String(src ?? '').trim().replace(/^\{([^{}]*)\}$/, '$1').trim();
  if (!raw) throw new Error('{} 里要写式子（比如 {k}、{A + B}、{P^-1}）');
  const shown = `「{${raw}}」`;
  const vars = scopeOf(scene, { plane, fill });
  const local = new Set(plane ? (scene.objects.get(plane)?.items || []).map((i) => i.name) : []);
  const refs = new Map(); // 占位的名字 → 部件写法
  const ms = new Map(); // 占位的名字 → 量算的是哪样东西（依赖）
  let text = raw.replace(/[−–]/g, '-');
  for (const [re, to] of SUPS) text = text.replace(re, to);
  // coef(M)、rhs(M) 先换成拆出来的那一半（在量前面：不然被当成矩阵的量，报「没有量 coef」）；依赖是 M
  text = text.replace(SLICE_RE, (m, fn, id) => {
    let v;
    try { v = sliceOf(scene, fn, id, fill); } catch (e) { throw new Error(`${shown}里的「${m}」：${e.message}`); }
    const k = `_s${ms.size}_`;
    ms.set(k, id);
    Object.defineProperty(vars, k, { value: v, enumerable: true });
    return ` ${k} `;
  });
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
    try { v = partValue(scene, m, fill); } catch (e) { throw new Error(`${shown}里的「${m}」：${e.message}`); }
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

// —— 空格子上挂跟着算的（第三次量 L1 第 1 幕、L2 第 6 幕）：matrix AD = {A D}、D 还是 _ _ / _ _ ——
// 以前一算就报「D.1,1 还空着」，整行不演，老师只好把 D 写成 0。现在先挂上：空格子换成几组不一样的数各算一遍，
// 几组都一样的格（不跟着空格子变）照写，跟着空格子变的格空着；D 填上一格，跟着重算
const BLANK_TRIALS = 3;
const isBlankErr = (e) => /还空着/.test(String(e?.message ?? e));
// 第 t 组里第 i 个空格子顶上的数：几组、几格各不一样（都一样容易凑出不可逆、相减成 0）
const trialQ = (t, i) => Q.int(1009 + 7919 * i + 104729 * t).div(Q.int(97 + 13 * t + 31 * i));
const sameVal = (a, b) => (isQ(a) && isQ(b) ? a.cmp(b) === 0 : Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameVal(x, b[i])));
// 几组算出来的值 → 和值一样形状的「这一格跟着空格子变」（true）
const holesOf = (vals) => (isQ(vals[0]) ? !vals.every((v) => sameVal(v, vals[0])) : vals[0].map((_, i) => holesOf(vals.map((v) => v[i]))));
/**
 * 算一个 {式子}，用到的有空格子（_）也先算出来：{ value, deps, holes }。holes 和 value 一样形状，true 的那一格跟着空格子变
 * （现在还空着），value 那一格是试算的数、不能拿去用；用到的都写满了 holes 是 null（和 evalLive 一样）。
 * 不是因为空格子算不出来（写错了、不可逆、维数对不上）：照 evalLive 抛原来的错
 */
export function evalHoles(src, scene, ctx = {}) {
  try { return { ...evalLive(src, scene, ctx), holes: null }; } catch (err) {
    if (!isBlankErr(err)) throw err;
    const runs = [];
    for (let t = 0; t < BLANK_TRIALS; t++) {
      const seen = new Map();
      const fill = (id, x) => { const k = `${id}:${x.key ?? `${x.r}.${x.c}`}`; if (!seen.has(k)) seen.set(k, seen.size); return trialQ(t, seen.get(k)); };
      try { runs.push(evalLive(src, scene, { ...ctx, fill })); } catch { throw err; }
    }
    const vals = runs.map((r) => r.value);
    const shape = (v) => (isQ(v) ? 'q' : isQMat(v) ? `m${v.length}x${v[0].length}` : isQVec(v) ? `v${v.length}` : '?');
    if (vals.some((v) => shape(v) !== shape(vals[0]))) throw err;
    return { value: vals[0], deps: runs[0].deps, holes: holesOf(vals) };
  }
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
/**
 * 一张矩阵现在的数写成一行给老师看：(2 0; 0 −2)。负号写 −（和舞台上画的一样），空格子（''）写 _（造的时候写的就是 _）。
 * [跟着变的] 写整张矩阵用它（doc.js 的 derivedLines）
 */
export function gridText(rows) {
  const cell = (v) => (v === '' || v == null ? '_' : String(v).replace(/^-/, '−'));
  return `(${(rows || []).map((row) => row.map(cell).join(' ')).join('; ')})`;
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

// —— 同类项（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 2.3：学生把一张矩阵拖到另一张上并同类项）——
// 只认「数 × 同一个矩阵（或同一串乘积）」：-2 A、-A、(1/2) A、3 A B、2A。别的写法（A + B、A'、A^2、2 (A + B)）页面看不出，
// 是 null——不说「不是同类项」（A^2 和 A A 是一回事，页面不按值猜，免得说错）
const FACTOR_RE = /^[A-Za-z_]\w*$/;
const COEF_RE = /^(\((?:\s*[+-]?\s*)\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?\s*\)|\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\s*\*?\s*/;
/** 认不出时的话（mergeTerms 的 error、并同类项做不到时给老师、给学生的） */
export const TERM_UNKNOWN = '页面看不出是不是同类项（只认 数 × 矩阵）';

/**
 * 一个式子 → { k（Q：系数）, base（因子的名字，空格隔开：'A'、'A B'） } | null（不是 数 × 矩阵）。
 * 外面的 {} 不算；减号能写 −；系数能贴着名字（2A）、能加括号（(-3) A，并好的 {(k) base} 就是这样写的）；乘号 * · × 可写可不写。
 * matrix(名字)：给了就要每个因子都是它认的矩阵（拨数 k 写在前面的 {k A}：k 不是矩阵，看不出，是 null）
 */
export function termOf(src, { matrix = null } = {}) {
  let s = String(src ?? '').trim().replace(/^\{([^{}]*)\}$/, '$1').trim().replace(/[−–]/g, '-').replace(/[·×]/g, '*');
  let neg = false;
  const sign = s.match(/^([+-])\s*/);
  if (sign) { neg = sign[1] === '-'; s = s.slice(sign[0].length); }
  let k = Q.from(1);
  const m = s.match(COEF_RE);
  if (m) {
    const q = toQ(m[1].replace(/\s+/g, ''));
    if (!q) return null;
    k = q;
    s = s.slice(m[0].length);
  }
  const factors = s.split(/\s*\*\s*|\s+/).filter(Boolean);
  if (!factors.length || !factors.every((f) => FACTOR_RE.test(f))) return null;
  if (matrix && !factors.every((f) => matrix(f))) return null;
  return { k: neg ? k.neg() : k, base: factors.join(' ') };
}

const minusText = (s) => String(s).replace(/-/g, '−');
// 因子写在一起：都是一个字母的连着写（AB），名字长的用 · 隔开（AA·AB），不把两个名字读成一个
const baseText = (base) => { const fs = String(base).split(' '); return fs.every((f) => f.length === 1) ? fs.join('') : fs.join('·'); };
/** 一项写给老师看：−2A、−A、A、(1/2)A、3AB；系数是 0 写 O（抵消了） */
export function termText(t) {
  if (!t) return '?';
  if (t.k.zero) return 'O';
  const neg = t.k.n < 0n;
  const a = neg ? t.k.neg() : t.k;
  const coef = a.n === 1n && a.d === 1n ? '' : a.integer ? String(a) : `(${a})`;
  return `${neg ? '−' : ''}${coef}${baseText(t.base)}`;
}
// 报「并不了」时系数照写（−1·B，不省成 −B：看得出是几倍）
const dotText = (t) => `${minusText(t.k.integer ? t.k : `(${t.k})`)}·${baseText(t.base)}`;

/**
 * 两项并成一项：{ k, base }（系数加起来，0 就是抵消了）| { error }。
 * 认不出写法的（a、b 是 null）说页面看不出；base 不一样说写法上不是同一个矩阵的倍数。names：报错里两张矩阵叫什么（默认 X、Y）
 */
export function mergeTerms(a, b, { x = 'X', y = 'Y' } = {}) {
  if (!a || !b) return { error: TERM_UNKNOWN };
  // 只按写法说（A、B 恰好能交换、恰好相等时 {A B} 和 {B A} 数上是一回事，页面不按值猜）
  if (a.base !== b.base) return { error: `${x} 是 ${dotText(a)}，${y} 是 ${dotText(b)}，写法上不是同一个矩阵的倍数（页面只按写法认），并不了` };
  return { k: a.k.add(b.k), base: a.base };
}
