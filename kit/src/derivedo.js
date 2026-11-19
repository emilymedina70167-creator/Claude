// derive 的学生版（mode: do，docs/learning-plan.md 第 6 节）：老师给出发的式子，学生一行一行往下写，
// 页面查每一行和上一行是不是相等。纯函数，有测试（tests/derivedo.test.js）；画面在 blocks/derivedo.js。
//
//   id: dd-1
//   mode: do
//   title: 推 A²
//   q: $A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$（3 维列向量），从 $A^2$ 推到只含 $\operatorname{tr}A$ 和 $A$ 的式子
//   vars: a=vec(3) b=vec(3)        // 随机取几组来比（不写就用 let 和整节课的量，只比一组）
//   let A = a*b'
//   start: A^2                      // 第一行，页面写好
//   goal: tr(A)*A                   // 写到这个样子算推完（写法一样、而且相等）
//
// 为什么随机取几组：学生写的是一般的式子（α、β 是任意向量），只拿一组数比，碰巧相等的错式子也会被判对。
// 每行先按 formula.js 的读法读懂（省略乘号、ᵀ、α β、上标），再用 expr.js 在每一组数上算；有一组不等就是不等。
import { compile, evaluate, isNum, isVec, isMat, valueTeX, eye } from './expr.js';
import { normalizeFormula, formulaTeX, FORMULA_FUNCS } from './formula.js';
import { parseDeriveCalc, checkFxLine, readLine } from './fx/deriveline.js';
import { parseDomain, compareFx, DEFAULT_RANGE } from './fx/sample.js';

const FIELD = /^\s*([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/;
const FIELDS = new Set(['id', 'title', 'q', 'mode', 'vars', 'start', 'goal', 'note', 'hint', 'samples', 'calc', 'domain']);
export const SAMPLES = 4;
const GREEK_ALIAS = [['a', 'alpha'], ['b', 'beta'], ['c', 'gamma'], ['l', 'lambda'], ['x', 'xi']];

/** 随机取值的写法：vec(3)、mat(2,3)、int(1,5)、num（-5..5 的整数）→ 生成器 */
function generator(spec) {
  const s = String(spec).trim();
  let m;
  if ((m = s.match(/^vec\(\s*(\d+)\s*\)$/))) return { kind: 'vec', n: +m[1] };
  if ((m = s.match(/^mat\(\s*(\d+)\s*,\s*(\d+)\s*\)$/))) return { kind: 'mat', m: +m[1], n: +m[2] };
  if ((m = s.match(/^int\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/))) return { kind: 'int', lo: +m[1], hi: +m[2] };
  if (/^num$/.test(s)) return { kind: 'int', lo: -5, hi: 5 };
  // 实数（计划 3）：x=real(-2, 2)
  if ((m = s.match(/^real\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/))) return { kind: 'real', lo: +m[1], hi: +m[2] };
  throw new Error(`vars 里的「${s}」看不懂：写 vec(3)、mat(2,3)、int(1,5)、num 或 real(-2, 2)`);
}

// 种子随机数（同一道题每次取的数一样：刷新后、老师和学生看到的同一组）
function rng(seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}
const pick = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
function draw(g, r) {
  // 不取全 0、不取 ±1 太多的：避免恰好相等（0 乘什么都是 0）
  const nz = () => { let x = 0; while (x === 0) x = pick(r, -4, 4); return x; };
  if (g.kind === 'vec') return Array.from({ length: g.n }, nz);
  if (g.kind === 'mat') return Array.from({ length: g.m }, () => Array.from({ length: g.n }, nz));
  if (g.kind === 'real') return g.lo + (0.05 + 0.9 * r()) * (g.hi - g.lo);
  let x = pick(r, g.lo, g.hi);
  if (x === 0 && g.lo < 0 && g.hi > 0) x = g.hi;
  return x;
}

/** 解析。返回 { fields, vars: [[名字, 生成器]], lets: [[名字, 式子]], start, goal }；写错了抛出中文原因 */
export function parseDeriveDo(src) {
  const fields = {};
  const lets = [];
  for (const raw of String(src ?? '').split('\n')) {
    if (!raw.trim()) continue;
    const l = raw.match(/^\s*let\s+([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (l) { lets.push([l[1], l[2].trim()]); continue; }
    const m = raw.match(FIELD);
    if (m && FIELDS.has(m[1].toLowerCase())) { fields[m[1].toLowerCase()] = m[2].trim(); continue; }
    throw new Error(`mode: do 的 derive 里看不懂这一行：「${raw.trim().slice(0, 40)}」（字段是 ${[...FIELDS].join('、')}，量写 let 名字 = 式子）`);
  }
  if (!fields.start) throw new Error('mode: do 要写 start:（第一行，页面写好，学生从这里往下推）');
  const vars = [];
  for (const part of String(fields.vars || '').split(/\s+/).filter(Boolean)) {
    const m = part.match(/^([A-Za-z_]\w*)=(.+)$/);
    if (!m) throw new Error(`vars 写成 名字=vec(3) 这样，空格隔开：「${part}」`);
    vars.push([m[1], generator(m[2])]);
  }
  const samples = Math.max(1, Math.min(8, Number(fields.samples) || (vars.length ? SAMPLES : 1)));
  // 高数（计划 3）：写了 calc:、domain: 或者有实数的变量，就按实数取点、交给 fx/deriveline.js 判
  const calc = parseDeriveCalc(fields.calc);
  const domain = [...vars.filter(([, g]) => g.kind === 'real').map(([name, g]) => ({ name, lo: g.lo, hi: g.hi, openLo: true, openHi: true })), ...parseDomain(fields.domain || '')];
  const fx = !!calc || domain.length > 0;
  return { fields, vars, lets, start: fields.start, goal: fields.goal || '', samples, ...(fx ? { fx: true, calc, domain } : {}) };
}

/** 每一组取值（vars 随机取、let 接着算）；base：整节课的量 */
export function sampleEnvs(spec, { seed = 'derive', base = {} } = {}) {
  const r = rng(seed);
  const envs = [];
  for (let k = 0; k < spec.samples; k++) {
    const env = { ...base };
    for (const [name, g] of spec.vars) env[name] = draw(g, r);
    // 单位阵（dr-batch4 第 3 条）：E、I 照 vars 里第一个方阵的阶数给（和 answer 一样认 E），自己定义了的不动
    const sq = Object.values(env).find((v) => isMat(v) && v.length === v[0]?.length);
    if (sq) for (const k of ['E', 'I']) if (env[k] === undefined) env[k] = eye(sq.length);
    // 学生写 α、β 也认：a ↔ alpha、b ↔ beta……（老师随便用哪种名字）
    for (const [x, y] of GREEK_ALIAS) { if (env[x] !== undefined && env[y] === undefined) env[y] = env[x]; else if (env[y] !== undefined && env[x] === undefined) env[x] = env[y]; }
    for (const [name, ex] of spec.lets) {
      try { env[name] = compile(prep(ex, Object.keys(env), orderOf(env)))(env); } catch (e) { throw new Error(`let ${name} 算不出来：${e.message}`); }
    }
    // 方阵是 let 算出来的（没有 vars）：单位阵照它的阶数
    const sq2 = !isMat(env.E) && Object.values(env).find((v) => isMat(v) && v.length === v[0]?.length);
    if (sq2) for (const k of ['E', 'I']) if (env[k] === undefined) env[k] = eye(sq2.length);
    envs.push(env);
  }
  return envs;
}

// 学生（和老师）写的式子 → expr.js 能算的。E(2) / I(3) 这样写阶数的单位阵：阶数和题里的方阵一样就当 E；不一样照实说
const orderOf = (env) => (isMat(env?.E) ? env.E.length : 0);
function prep(text, names, order = 0) {
  const t = String(text ?? '').replace(/\b([EI])\s*\(\s*(\d+)\s*\)/g, (all, k, n) => {
    if (!order) throw new Error(`${all} 里的单位阵：题里没有方阵，页面不知道它几阶（vars 里给一个方阵，或者 let ${k} = [[1,0],[0,1]]）`);
    if (Number(n) !== order) throw new Error(`${all} 和题里的 ${order} 阶矩阵阶数不一样`);
    return k;
  });
  return normalizeFormula(t, { names, funcs: FORMULA_FUNCS });
}

const shape = (v) => (isNum(v) ? '一个数' : isVec(v) ? `${v.length} 维列向量` : isMat(v) ? `${v.length}×${v[0].length} 矩阵` : '算不出来的东西');
const flat = (v) => (Array.isArray(v) ? v.flat(Infinity) : [v]);
function equal(a, b) {
  if (shape(a) !== shape(b)) return false;
  const x = flat(a), y = flat(b);
  return x.length === y.length && x.every((n, i) => Math.abs(n - y[i]) <= 1e-7 * Math.max(1, Math.abs(n), Math.abs(y[i])));
}
// 1×1 矩阵当一个数（βᵀα 算出来是 [[5]]）
const scalarize = (v) => (isMat(v) && v.length === 1 && v[0].length === 1 ? v[0][0] : isVec(v) && v.length === 1 ? v[0] : v);
const compact = (s) => String(s).replace(/\s+/g, '');

/**
 * 查一行：prev 是上一行（式子），line 是学生写的这一行。envs：sampleEnvs 的结果。
 * 返回 { ok, tex（这一行写成公式）, norm（读懂以后的写法）, error?（看不懂 / 算不出来）, why?（不等时：哪一组数、两边各等于什么）, done?（推到 goal 了）}
 */
export function checkLine(spec, envs, prev, line, state = {}) {
  if (spec.fx) return checkFx(spec, prev, line, state);
  const names = Object.keys(envs[0] || {});
  const order = orderOf(envs[0]);
  let norm;
  try { norm = prep(line, names, order); } catch (e) { return { ok: false, error: e.message }; }
  let tex = '';
  try { tex = formulaTeX(norm); } catch { tex = ''; }
  let p;
  try { p = prep(prev, names, order); } catch (e) { return { ok: false, error: `上一行看不懂：${e.message}`, tex, norm }; }
  for (const env of envs) {
    let a, b;
    try { a = scalarize(compile(p)(env)); } catch (e) { return { ok: false, error: `上一行算不出来：${e.message}`, tex, norm }; }
    try { b = scalarize(compile(norm)(env)); } catch (e) { return { ok: false, error: `这一行算不出来：${e.message}`, tex, norm }; }
    if (!equal(a, b)) {
      const at = spec.vars.map(([n]) => `${n}=${valueText(env[n])}`).join('，');
      return {
        ok: false, tex, norm,
        why: shape(a) !== shape(b) ? `上一行是${shape(a)}，这一行是${shape(b)}` : `${at ? `取 ${at} 时` : ''}上一行等于 ${valueText(a)}，这一行等于 ${valueText(b)}`,
        prevVal: a, lineVal: b,
      };
    }
  }
  let done = false;
  if (spec.goal) { try { done = compact(prep(spec.goal, names, order)) === compact(norm); } catch { done = false; } }
  return { ok: true, tex, norm, done };
}

// 高数的一行（fx/deriveline.js）。state.ctx：换元、每一行的极限变量和点（blocks/derivedo.js 存着、接着传）
function checkFx(spec, prev, line, state) {
  const kind = spec.calc?.kind || null;
  const ctx = state.ctx || (kind === 'limit' ? { lim: { v: spec.calc.v, at: spec.calc.at, side: spec.calc.side || 'both' } } : {});
  let prevRead;
  try { prevRead = readLine(prev, { kind }); } catch (e) { return { ok: false, error: `上一行看不懂：${e.message}` }; }
  const r = checkFxLine(spec.calc, { read: prevRead, lim: ctx.lim }, line, { ctx, domain: spec.domain });
  if (r.error) return { ok: false, error: r.error };
  let tex = '';
  try { tex = r.read ? formulaTeX(r.read.src) : ''; } catch { tex = ''; }
  const out = { ok: r.ok, tex, norm: r.read?.src || line, ctx: r.ctx || ctx, ...(r.note ? { note: true } : {}), ...(r.same ? { same: r.same } : {}), ...(r.ok !== true ? { why: r.why } : {}) };
  if (r.ok === true && !r.note && spec.goal) out.done = reachedGoal(spec, r.read, kind);
  return out;
}
// 推到 goal 了吗：极限题是一个数（值一样）；不定积分是没有 ∫ 的那一行和 goal 差一个常数；别的恒等
function reachedGoal(spec, read, kind) {
  try {
    const g = readLine(spec.goal, { kind });
    if (kind === 'limit') return !read.vars.length && !g.vars.length && Math.abs(evalNum(read.ast) - evalNum(g.ast)) <= 1e-9 * Math.max(1, Math.abs(evalNum(g.ast)));
    if (kind === 'antideriv' && /\bint\(/.test(read.src)) return false;
    const r = compareFx(g.ast, read.ast, { domain: spec.domain.length ? spec.domain : [{ ...DEFAULT_RANGE, name: 'x' }], upToConst: kind === 'antideriv' });
    return r.ok === true;
  } catch { return false; }
}
const evalNum = (ast) => { const v = evaluate(ast, {}); return typeof v === 'number' ? v : NaN; };

/** 值写成一行文字（给老师的记录用）：[[1, 2], [3, 4]]、5 */
export function valueText(v) {
  const r = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
  if (isNum(v)) return r(v);
  if (isVec(v)) return `(${v.map(r).join(', ')})ᵀ`;
  if (isMat(v)) return `[${v.map((row) => `[${row.map(r).join(', ')}]`).join(', ')}]`;
  return String(v);
}
export { valueTeX };
