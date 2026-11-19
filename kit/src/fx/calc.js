// calc: 字段：页面自己核导数、不定积分、定积分、极限、等价、阶、泰勒（计划 3，dr-calc-base 第二节 2.3 + 审的必改 1、2，必加 8、9、10）。
// 纯函数，tests/fx-calc.test.js。两件事：
//   calcSelfCheck：外部写的 answer: 先核一遍（错了页面报写法错误、预检报错；页面核不了的进 hints，只提醒）；
//   judgeCalc：判学生的（学生的字先照输入框读好，和 compareFormula 收的一样）。
// 判学生时外部的 answer: 是标准（外部是主讲）；页面算的只用来核外部。判不了一律 ok: null。
import { parse, evaluate } from '../expr.js';
import { compareFx, floatScope, showNum, DEFAULT_RANGE, fxEval } from './sample.js';
import { diffAst, substitute, has } from './diff.js';
import { numLimit, orderAt } from './limit.js';
import { numIntegral, numIntegral2 } from './integral.js';
import { rng } from './sample.js';
import { expandPrimes } from './diff.js';
import { polyCoeffs, taylorCoeffs, nearFraction, coefTeX } from './taylor.js';

export const CALC_KINDS = ['deriv', 'antideriv', 'integral', 'limit', 'equiv', 'order', 'taylor', 'integral2', 'sum', 'ode'];
// 只写 calc: 不写 formula: 时：这几种学生写的是 x 的式子，别的是一个数
export const FUNCTION_KINDS = new Set(['deriv', 'antideriv', 'equiv', 'taylor', 'ode']);
const KEYS = ['of', 'at', 'side', 'from', 'to', 'order', 'C', 'wrt', 'x', 'y', 'n', 'eq'];
export const PAGE_BUDGET = 50; // 页面上一次自检最多花多少毫秒（iPad 上一块板几道题不能卡住画板）
export const LINT_BUDGET = 2000; // 外部预检

const N = (v) => ({ t: 'num', v });

/** 「limit of=(tan(x)-sin(x))/x^3 at=0」 → { kind, of, at, side, from, to, order, C, wrt }；写错抛中文原因 */
export function parseCalc(line) {
  const src = String(line ?? '').trim();
  const m = /^([A-Za-z]\w*)\s*(.*)$/s.exec(src);
  if (!m || !CALC_KINDS.includes(m[1])) throw new Error(`calc: 能写 ${CALC_KINDS.join('、')}（看不懂「${src.slice(0, 20)}」）`);
  const out = { kind: m[1] };
  const re = new RegExp(`(?:^|\\s)(${KEYS.join('|')})\\s*=`, 'g');
  const marks = [...m[2].matchAll(re)];
  if (m[2].trim() && (!marks.length || m[2].slice(0, marks[0].index).trim())) throw new Error(`calc: ${m[1]} 后面写 key=value（${KEYS.join('、')}），看不懂「${m[2].trim().slice(0, 20)}」`);
  marks.forEach((mk, i) => {
    const v = m[2].slice(mk.index + mk[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim();
    out[mk[1]] = v;
  });
  const need = { deriv: ['of'], antideriv: ['of'], integral: ['of', 'from', 'to'], limit: ['of', 'at'], equiv: ['of', 'at'], order: ['of', 'at'], taylor: ['of', 'order'], integral2: ['of', 'x', 'y'], sum: ['of', 'n'], ode: ['eq'] }[out.kind];
  for (const k of need) if (!out[k]) throw new Error(`calc: ${out.kind} 要写 ${k}=`);
  if (out.C && !['need', 'any', 'no'].includes(out.C)) throw new Error('calc: antideriv 的 C= 写 need（要写 +C，默认）、any（写不写都行）或 no（不写）');
  if (out.side && !['+', '-'].includes(out.side)) throw new Error('side= 写 + 或 -');
  if (out.order !== undefined && out.order !== 'n' && !/^\d+$/.test(out.order)) throw new Error('order= 写一个整数，或者 n（n 阶导的通式）');
  if (out.kind === 'taylor' && Number(out.order) > 8) throw new Error('taylor 的 order 最多写 8');
  if (out.kind === 'ode') {
    // 微分方程：eq=y''-3y'+2y=e^x，y 是 x 的函数，' 是求导；order 不写就数 y 后面最多几撇
    const [l, r = '0'] = out.eq.split('=');
    out.eqAst = { t: 'bin', op: '-', a: parse(l), b: parse(r) };
    if (!out.order) out.order = String(Math.max(1, ...[...out.eq.matchAll(/y('+)/g)].map((m) => m[1].length)));
    out.ofAst = out.eqAst;
    out.x = 'x';
    return out;
  }
  // 二重积分 x=0..1 y=0..x、级数 n=1..inf：范围
  for (const k of ['x', 'y', 'n']) {
    if (out[k] === undefined) continue;
    const m2 = /^(.+?)\s*\.\.\s*(.+)$/.exec(out[k]);
    if (!m2) throw new Error(`${k}= 写成 ${k}=0..1 这样（下限..上限）`);
    out[`${k}Range`] = [m2[1].trim(), m2[2].trim()];
  }
  out.ofAst = parse(out.of);
  out.wrtList = out.wrt ? out.wrt.split(/[,，\s]+/).filter(Boolean) : null;
  out.x = out.wrtList?.[0] || (has(out.ofAst, 'x') || !has(out.ofAst, 'n') ? 'x' : 'n');
  return out;
}

// 极限的点：数、inf（两侧）、+inf、-inf
export function atOf(s) {
  const t = String(s ?? '').trim().replace(/∞/g, 'inf').replace(/\s+/g, '');
  if (/^inf$/i.test(t)) return 'inf';
  if (/^\+inf$/i.test(t)) return '+inf';
  if (/^-inf$/i.test(t)) return '-inf';
  const v = evaluate(t);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`at= 写一个数，或 inf、+inf、-inf（看不懂「${s}」）`);
  return v;
}
const boundOf = (s) => { const a = atOf(s); return a === 'inf' || a === '+inf' ? Infinity : a === '-inf' ? -Infinity : a; };

// 一个答案（读好的串）是哪一种：数、inf（无符号）、+inf、-inf、none（不存在）、div（发散）
export function valueKind(src, scope = {}) {
  const s = String(src ?? '').replace(/\s+/g, '');
  if (s === '__dne') return { kind: 'none' };
  if (s === '__div') return { kind: 'div' };
  if (s === 'inf') return { kind: 'inf' };
  if (s === '+inf') return { kind: '+inf' };
  if (s === '-inf') return { kind: '-inf' };
  let v;
  try { v = evaluate(src, floatScope(scope)); } catch { return { kind: 'bad' }; }
  if (v === Infinity) return { kind: '+inf' };
  if (v === -Infinity) return { kind: '-inf' };
  return typeof v === 'number' && Number.isFinite(v) ? { kind: 'finite', value: v } : { kind: 'bad' };
}
const KIND_TEXT = { inf: '∞', '+inf': '+∞', '-inf': '−∞', none: '不存在', div: '发散' };
const kindText = (k) => (k.kind === 'finite' ? showNum(k.value) : KIND_TEXT[k.kind] || '?');
const sameNum = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// 学生写的 x 的式子在 x 上的函数
// （走 fxEval：of= 里写了变限积分 int(g, t, 0, x) 也能求值）
const fn = (ast, x, scope) => { const base = floatScope(scope); return (t) => fxEval(ast, { ...base, [x]: t }); };

// —— 不定积分的 +C、泰勒的 o(x^n)：在语法树最外层的和式里去掉 ——
function terms(n, sign = 1, out = []) {
  if (n.t === 'bin' && (n.op === '+' || n.op === '-')) { terms(n.a, sign, out); terms(n.b, n.op === '-' ? -sign : sign, out); return out; }
  if (n.t === 'neg') return terms(n.a, -sign, out);
  out.push({ sign, n });
  return out;
}
function rebuild(ts) {
  if (!ts.length) return N(0);
  return ts.slice(1).reduce((acc, t) => ({ t: 'bin', op: t.sign > 0 ? '+' : '-', a: acc, b: t.n }), ts[0].sign > 0 ? ts[0].n : { t: 'neg', a: ts[0].n });
}
export const CONST_NAMES = ['C', 'c', 'C_1', 'C_2'];
/** 回 { ast, hadC, hadO } */
export function stripTail(ast, { kind, scope = {} } = {}) {
  const ts = terms(typeof ast === 'string' ? parse(ast) : ast);
  let hadC = false, hadO = false;
  const keep = ts.filter(({ n }) => {
    if (kind === 'antideriv' && n.t === 'var' && CONST_NAMES.includes(n.name) && !(n.name in scope)) { hadC = true; return false; }
    if (kind === 'taylor' && n.t === 'call' && (n.name === 'o' || n.name === 'O')) { hadO = true; return false; }
    return true;
  });
  return { ast: rebuild(keep), hadC, hadO };
}

// x、y 这些实数变量的范围（spec.domain 里有就用它的，没有用默认 (−3, 3)）
const domainFor = (spec, names) => (spec.domain?.length ? spec.domain : names.map((nm) => ({ ...DEFAULT_RANGE, name: nm })));
const NS = [1, 2, 3, 4, 5]; // n 阶导的通式：代 n = 1…5

// 外部写的标准答案（不写的种类用页面算的）
function expectedOf(spec) {
  const c = spec.calc;
  if (c.kind === 'deriv' && !spec.expected) return (c.wrtList?.length > 1 ? c.wrtList : [c.x]).reduce((a, v) => diffAst(a, v), c.ofAst);
  return typeof spec.expected === 'string' ? parse(spec.expected) : spec.expected;
}
// 导数（偏导、高阶导）：of 照 wrt / order 求
function derivOf(c, n = null) {
  const order = n ?? (c.order && c.order !== 'n' ? Number(c.order) : 1);
  if (c.wrtList?.length > 1) return c.wrtList.reduce((a, v) => diffAst(a, v), c.ofAst);
  return diffAst(c.ofAst, c.x, order);
}

/**
 * 外部的答案先核一遍。spec：formulaSpec 的结果（带 calc、expected、domain、scope）。
 * 回 { errors: [中文], hints: [中文] }：errors 是答案和页面算的对不上；hints 是页面核不了（提醒，不挡题）
 */
export function calcSelfCheck(spec, { budget = PAGE_BUDGET } = {}) {
  const t0 = Date.now();
  const errors = [], hints = [];
  const slow = () => Date.now() - t0 > budget;
  const c = spec.calc;
  const ans = spec.expected ? expectedOf(spec) : null;
  const vars = c.wrtList || [c.x];
  try {
    switch (c.kind) {
      case 'deriv': {
        if (!ans) break;
        if (c.at !== undefined && c.order !== 'n') {
          // f⁽ᵏ⁾(a)：一个数
          const v = derivAt(c, spec.scope), w = valueKind(spec.expected, spec.scope);
          if (v === null) hints.push('页面算不出这一点的导数');
          else if (w.kind !== 'finite' || Math.abs(v - w.value) > 1e-6 * Math.max(1, Math.abs(v))) errors.push(`answer: 是 ${kindText(w)}，页面算这一点的导数得 ${showNum(v)}`);
          break;
        }
        if (c.order === 'n') {
          for (const n of NS) {
            if (slow()) { hints.push('页面核得太慢，没核完'); break; }
            const r = c.at !== undefined ? cmpValue(evaluate(derivOf(c, n), { x: boundOf(c.at) }), evaluate(substitute(ans, 'n', N(n)), floatScope(spec.scope))) : compareFx(derivOf(c, n), substitute(ans, 'n', N(n)), { domain: domainFor(spec, vars), scope: spec.scope, seed: spec.seed });
            if (r.ok === false) { errors.push(`answer: 和页面对 ${c.of} 求的 ${n} 阶导数对不上（n = ${n}）`); break; }
            if (r.ok === null) hints.push(`页面核不了 n = ${n} 那一阶`);
          }
          break;
        }
        const r = compareFx(derivOf(c), ans, { domain: domainFor(spec, vars), scope: spec.scope, seed: spec.seed });
        if (r.ok === false) errors.push(`answer: 和页面对 ${c.of} 求的导数对不上（${r.note}）`);
        else if (r.ok === null) hints.push(`页面核不了这个导数（${r.note}）`);
        break;
      }
      case 'antideriv': {
        if (!ans) break;
        const r = compareFx(c.ofAst, diffAst(ans, c.x), { domain: domainFor(spec, [c.x]), scope: spec.scope, seed: spec.seed });
        if (r.ok === false) errors.push(`answer: 求导以后不等于 ${c.of}（${r.note}）`);
        else if (r.ok === null) hints.push(`页面核不了这个原函数（${r.note}）`);
        break;
      }
      case 'integral': {
        const want = valueKind(spec.expected, spec.scope);
        const r = numIntegral(fn(c.ofAst, c.x, spec.scope), boundOf(c.from), boundOf(c.to));
        if (r.ok === true && want.kind === 'finite' && !sameNum(r.value, want.value) && Math.abs(r.value - want.value) > 1e-6 * Math.max(1, Math.abs(want.value))) errors.push(`answer: 是 ${kindText(want)}，页面算这个积分得 ${showNum(r.value)}`);
        else if (r.ok === true && want.kind === 'div') errors.push(`answer: 写的是发散，页面算这个积分收敛到 ${showNum(r.value)}`);
        else if (r.ok !== true) hints.push(`页面核不了这个积分（${r.why}）`);
        break;
      }
      case 'limit': {
        const want = valueKind(spec.expected, spec.scope);
        const seq = isSequence(c);
        if (seq?.cannot) { hints.push('数列极限页面核不了（有 ! 或 (-1)^n）'); break; }
        const r = seq ? numLimit(fn(c.ofAst, 'n', spec.scope), '+inf') : numLimit(fn(c.ofAst, c.x, spec.scope), atOf(c.at), { side: c.side === '+' ? '+' : c.side === '-' ? '-' : 'both' });
        if (r.kind === null) { hints.push(`页面核不了这个极限（${r.why}）`); break; }
        const got = r.kind === 'finite' ? { kind: 'finite', value: r.value } : { kind: r.kind };
        if (got.kind === want.kind) { if (got.kind === 'finite' && Math.abs(got.value - want.value) > 1e-6 * Math.max(1, Math.abs(want.value))) errors.push(`answer: 是 ${kindText(want)}，页面算这个极限得 ${kindText(got)}`); }
        else if (want.kind === 'inf' && (got.kind === '+inf' || got.kind === '-inf')) { hints.push(`页面算出来是 ${kindText(got)}，answer: 写 ${got.kind} 更准确`); spec.trueKind = got.kind; }
        else errors.push(`answer: 是 ${kindText(want)}，页面算这个极限得 ${kindText(got)}`);
        break;
      }
      case 'equiv': {
        if (!ans) break;
        const r = numLimit((t) => fn(c.ofAst, c.x, spec.scope)(t) / fn(ans, c.x, spec.scope)(t), atOf(c.at));
        if (r.kind === 'finite' && Math.abs(r.value - 1) > 1e-6) errors.push(`answer: 和 ${c.of} 不等价（两者之比的极限是 ${showNum(r.value)}）`);
        else if (r.kind !== 'finite' && r.kind !== null) errors.push(`answer: 和 ${c.of} 不等价（两者之比的极限是 ${KIND_TEXT[r.kind] || r.kind}）`);
        else if (r.kind === null) hints.push(`页面核不了（${r.why}）`);
        break;
      }
      case 'order': {
        const want = valueKind(spec.expected, spec.scope);
        const k = orderOf(c, spec.scope);
        if (k === null) hints.push('页面估不出这个无穷小的阶');
        else if (want.kind !== 'finite' || Math.abs(k - want.value) > 0.05) errors.push(`answer: 是 ${kindText(want)}，页面估出来是 ${showNum(k)} 阶`);
        break;
      }
      case 'integral2': {
        const want = valueKind(spec.expected, spec.scope);
        const base = floatScope(spec.scope);
        const [x0, x1] = c.xRange.map(boundOf);
        const [ylo, yhi] = c.yRange.map((t) => { const a = /^[+-]?inf$|^∞$/.test(t.trim()) ? boundOf(t) : null; const ast = a === null ? parse(t) : null; return (x) => (a !== null ? a : fxEval(ast, { ...base, x })); });
        const r = numIntegral2((x, y) => fxEval(c.ofAst, { ...base, x, y }), [x0, x1], [ylo, yhi]);
        if (r.ok !== true) hints.push(`页面核不了这个二重积分（${r.why}）`);
        else if (want.kind !== 'finite' || Math.abs(r.value - want.value) > 1e-6 * Math.max(1, Math.abs(want.value))) errors.push(`answer: 是 ${kindText(want)}，页面算这个二重积分得 ${showNum(r.value)}`);
        break;
      }
      case 'sum': {
        const pts = spec.domain?.length ? null : [{}];
        if (pts) {
          const r = seriesAt(c, {}, spec.scope);
          const want = valueKind(spec.expected, spec.scope);
          if (r === null) hints.push('级数加到 5000 项还没收敛，页面核不了');
          else if (want.kind !== 'finite' || Math.abs(r - want.value) > 1e-6 * Math.max(1, Math.abs(want.value))) errors.push(`answer: 是 ${kindText(want)}，页面加这个级数得 ${showNum(r)}`);
          break;
        }
        // 和函数：在取的点上直接加，和 answer: 比
        let bad = null, n = 0;
        for (const pt of samplePts(spec)) {
          const r = seriesAt(c, pt, spec.scope);
          if (r === null) continue;
          n++;
          const w = fxEval(ans, { ...floatScope(spec.scope), ...pt });
          if (!(Math.abs(r - w) <= 1e-7 * Math.max(1, Math.abs(r)))) { bad = { pt, r, w }; break; }
        }
        if (bad) errors.push(`answer: 和级数对不上：x = ${showNum(bad.pt.x)} 时级数加起来是 ${showNum(bad.r)}，answer 得 ${showNum(bad.w)}`);
        else if (n < 6) hints.push('级数在取的点上加不收敛，页面核不了（formula: x in (…) 给一个收敛域里面的范围）');
        break;
      }
      case 'ode': {
        if (!ans) break;
        const r = odeCheck(c, ans, spec);
        if (r.ok === false) errors.push(`answer: 不满足方程：${r.msg}`);
        else if (r.ok === null) hints.push(`页面核不了这个通解（${r.note}）`);
        break;
      }
      case 'taylor': {
        if (!ans) break;
        const order = Number(c.order), at = c.at !== undefined ? boundOf(c.at) : 0;
        const true_ = taylorCoeffs(c.ofAst, c.x, at, order);
        const mine = polyCoeffs(ans, c.x, at);
        if (true_.some((q) => q === null)) { errors.push('泰勒系数不是有理数，页面判不了（换成系数是有理数的展开，或者不用 calc: taylor）'); break; }
        const bad = true_.map((q, k) => (q.cmp(mine[k] ?? zeroQ(q)) !== 0 ? k : -1)).filter((k) => k >= 0);
        if (bad.length) errors.push(`answer: 的 ${bad.map((k) => termText(k, c.x, at)).join('、')} 项系数和页面算的不一样（应该是 ${bad.map((k) => coefTeX(true_[k])).join('、')}）`);
        break;
      }
    }
  } catch (e) { errors.push(`calc: 算不了：${e.message}`); }
  if (slow() && !hints.some((h) => h.includes('太慢'))) hints.push('页面核得太慢，没核完');
  return { errors, hints };
}
const zeroQ = (q) => q.sub(q);
const cmpValue = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? { ok: sameNum(a, b) } : { ok: null });

// f⁽ᵏ⁾(a)：符号求导再代 a，代不进去（可去间断点）用数值极限
function derivAt(c, scope) {
  const D = derivOf(c), a = boundOf(c.at), base = floatScope(scope);
  try { const v = fxEval(D, { ...base, [c.x]: a }); if (Number.isFinite(v)) return v; } catch { /* 用极限 */ }
  const r = numLimit((t) => fxEval(D, { ...base, [c.x]: t }), a);
  return r.kind === 'finite' ? r.value : null;
}

// 级数在一点上的和：加到项 < 1e-14 或 5000 项；不收敛回 null
function seriesAt(c, pt, scope) {
  const base = { ...floatScope(scope), ...pt };
  const lo = Number(fxEval(parse(c.nRange[0]), base)), hiT = c.nRange[1].trim();
  const hi = /^[+]?inf$|^∞$/.test(hiT) ? Infinity : Number(fxEval(parse(hiT), base));
  let sum = 0, small = 0;
  for (let n = lo, k = 0; n <= hi && k < 5000; n++, k++) {
    const t = fxEval(c.ofAst, { ...base, n });
    if (!Number.isFinite(t)) return null;
    sum += t;
    small = Math.abs(t) < 1e-14 ? small + 1 : 0;
    if (small >= 3) return sum;
  }
  return hi === Infinity ? null : sum;
}
// 和函数在哪些点上核：formula / domain 的范围里取 16 个
function samplePts(spec) {
  const r = rng(`${spec.seed}|sum`);
  const d = spec.domain;
  return Array.from({ length: 16 }, () => Object.fromEntries(d.map((v) => [v.name, Number.isFinite(v.lo) && Number.isFinite(v.hi) ? v.lo + (0.05 + 0.9 * r()) * (v.hi - v.lo) : (r() - 0.5) * 4])));
}

// 微分方程的解（必加 12）：随机取几组常数代进方程，残差 ≈ 0；常数要够 order 个、而且独立（∂y/∂C_i 在几个点上满秩）。
// 常数认 C_1 C_2 …、C1 C2 …，只有一个常数时也认 C
const CONSTS_RE = /^C_?\d$|^C$/;
function odeCheck(c, yAst, spec) {
  const names = [...collectVars(yAst)].filter((v) => CONSTS_RE.test(v) && !(v in (spec.scope || {})));
  const order = Number(c.order) || 1;
  const r = rng(`${spec.seed}|ode`);
  const domain = domainFor(spec, ['x']);
  for (let k = 0; k < 3; k++) {
    const vals = Object.fromEntries(names.map((nm) => [nm, Math.round((r() * 4 - 2) * 100) / 100 || 0.5]));
    let y = yAst;
    for (const [nm, v] of Object.entries(vals)) y = substitute(y, nm, N(v));
    const res = expandPrimes(substitute(c.eqAst, 'y', y), 'x');
    const t = compareFx(N(0), res, { domain, scope: spec.scope, seed: `${spec.seed}|ode${k}` });
    if (t.ok === null) return { ok: null, msg: '页面判不了，待外部核。', note: '代进方程算不出来' };
    if (t.ok === false) return { ok: false, msg: `代进方程不成立（常数取 ${Object.entries(vals).map(([a, b]) => `${a}=${b}`).join('、') || '—'} 时，${t.msg.replace('你的式子得', '左边减右边得').replace(/应该是 \$0\$/, '应该是 0')}）`, note: '不满足方程' };
  }
  if (order > 0 && names.length !== order) return { ok: false, msg: `通解要 ${order} 个独立常数（写 C_1、C_2），你写了 ${names.length} 个`, note: `常数个数 ${names.length}，应是 ${order}` };
  // 独立：∂y/∂C_i 在 order + 2 个点上组成的矩阵满秩
  const base = floatScope(spec.scope);
  const xs = [0.3, 0.9, 1.4, -0.6, 2.1, -1.3].slice(0, order + 2);
  const M = xs.map((x) => names.map((nm) => { try { return fxEval(diffAst(yAst, nm), { ...base, x, ...Object.fromEntries(names.map((m) => [m, 0.7])) }); } catch { return NaN; } }));
  if (M.flat().some((v) => !Number.isFinite(v))) return { ok: null, msg: '页面判不了，待外部核。', note: '常数独立性算不出来' };
  if (rankOf(M) < names.length) return { ok: false, msg: `这几个常数不独立（合起来其实是更少的常数）：通解要 ${order} 个独立常数`, note: '常数不独立' };
  return { ok: true, msg: '', note: '' };
}
function collectVars(n, out = new Set()) {
  if (!n) return out;
  if (n.t === 'var') out.add(n.name);
  ['a', 'b'].forEach((k) => collectVars(n[k], out));
  (n.args || n.items || []).forEach((m) => collectVars(m, out));
  return out;
}
function rankOf(M) {
  const A = M.map((r) => r.slice());
  let rank = 0;
  for (let c = 0; c < (A[0]?.length || 0); c++) {
    let p = -1, best = 0;
    for (let i = rank; i < A.length; i++) if (Math.abs(A[i][c]) > best) { best = Math.abs(A[i][c]); p = i; }
    const scale = Math.max(1, ...A.map((r) => Math.abs(r[c])));
    if (p < 0 || best <= 1e-9 * scale) continue;
    [A[rank], A[p]] = [A[p], A[rank]];
    for (let i = 0; i < A.length; i++) if (i !== rank) { const f = A[i][c] / A[rank][c]; A[i] = A[i].map((v, j) => v - f * A[rank][j]); }
    rank++;
  }
  return rank;
}

// 数列极限：of 里只有 n（没有 x）。有 ! 或 (-1)^n 的不硬算（审的小条）
function isSequence(c) {
  if (has(c.ofAst, 'x') || !has(c.ofAst, 'n')) return null;
  if (/!|fact\(|\(\s*-\s*1\s*\)\s*\^/.test(c.of)) return { cannot: true };
  return { n: true };
}

// 阶：解析的先用泰勒系数找第一个不为 0 的（精确）；不行再用斜率（可以是分数）
function orderOf(c, scope) {
  const at = boundOf(c.at);
  try {
    const qs = taylorCoeffs(c.ofAst, c.x, at, 8, { untilNonzero: true });
    const k = qs.findIndex((q) => q !== null && !q.zero);
    if (k >= 0 && qs.slice(0, k).every((q) => q !== null)) return k;
  } catch { /* 不解析：用斜率 */ }
  const r = orderAt(fn(c.ofAst, c.x, scope), at);
  return r.ok ? r.k : null;
}

const termText = (k, x, at) => (k === 0 ? '常数' : `${at ? `(${x}${at > 0 ? '-' : '+'}${Math.abs(at)})` : x}${k > 1 ? `^${k}` : ''}`);

/**
 * 判学生的。given：照输入框读好的串（normalizeFormula 的结果）。
 * 回 { ok: true | false | null, msg（给学生看，可带 $TeX$）, note（进作答记录）, bad? }
 */
export function judgeCalc(spec, given) {
  const c = spec.calc;
  let g;
  try { g = parse(given); } catch (e) { return { ok: false, msg: `看不懂你写的：${e.message}`, note: '读不懂' }; }
  const domain = domainFor(spec, c.wrtList || [c.x]);
  const opt = { domain, scope: spec.scope, seed: spec.seed };
  switch (c.kind) {
    case 'deriv': {
      if (c.at !== undefined && c.order !== 'n') return judgeValue('deriv', valueKind(spec.expected, spec.scope), valueKind(given, spec.scope));
      if (c.order === 'n') {
        const want = expectedOf(spec);
        for (const n of NS) {
          const D = want ? substitute(want, 'n', N(n)) : derivOf(c, n);
          const mine = substitute(g, 'n', N(n));
          const r = c.at !== undefined ? cmpValue(evaluate(mine, floatScope(spec.scope)), evaluate(D, { ...floatScope(spec.scope), x: boundOf(c.at) })) : compareFx(D, mine, opt);
          if (r.ok !== true) return { ...r, msg: r.ok === null ? '页面判不了，待外部核。' : `n = ${n} 时不对：${r.msg || ''}`, note: `n 阶导的通式：n = ${n} 时${r.ok === null ? '判不了' : '不对'}` };
        }
        return { ok: true, msg: '', note: '' };
      }
      return compareFx(expectedOf(spec), g, opt);
    }
    case 'antideriv': {
      const { ast, hadC } = stripTail(g, { kind: 'antideriv', scope: spec.scope });
      const want = expectedOf(spec);
      const r = want ? compareFx(want, ast, { ...opt, upToConst: true }) : compareFx(c.ofAst, diffAst(ast, c.x), opt);
      if (r.ok !== true) return r;
      const policy = c.C || 'need';
      if (policy === 'need' && !hadC) return { ok: false, msg: '少写了 +C', note: '少写了 +C' };
      if (policy === 'no' && hadC) return { ok: false, msg: '这一题不写 +C', note: '多写了 +C' };
      return r;
    }
    case 'sum': {
      if (!spec.domain?.length) return judgeValue('sum', valueKind(spec.expected, spec.scope), valueKind(given, spec.scope));
      return compareFx(expectedOf(spec), g, opt);
    }
    case 'ode': return odeCheck(c, g, spec);
    case 'integral': case 'limit': case 'order': case 'integral2': {
      const want = valueKind(spec.expected, spec.scope);
      const got = valueKind(given, spec.scope);
      if (got.kind === 'bad') return { ok: false, msg: '这里写一个数（或 ∞、+∞、−∞、不存在、发散）', note: '写的不是一个数' };
      return judgeValue(c.kind, want, got, spec.trueKind);
    }
    case 'equiv': {
      const f = fn(c.ofAst, c.x, spec.scope), h = fn(g, c.x, spec.scope);
      const r = numLimit((t) => f(t) / h(t), atOf(c.at));
      if (r.kind === null) return { ok: null, msg: '页面判不了，待外部核。', note: `等价：f/g 的极限页面算不出来（${r.why}）` };
      if (r.kind === 'finite' && Math.abs(r.value - 1) <= 1e-6) return { ok: true, msg: '', note: '' };
      const v = r.kind === 'finite' ? showNum(r.value) : KIND_TEXT[r.kind];
      return { ok: false, msg: `两者之比的极限是 $${v}$，不是 1：不等价。`, note: `等价：f/g → ${v}` };
    }
    case 'taylor': {
      const order = Number(c.order), at = c.at !== undefined ? boundOf(c.at) : 0;
      const { ast } = stripTail(g, { kind: 'taylor' });
      let mine;
      try { mine = polyCoeffs(ast, c.x, at); } catch (e) { return { ok: false, msg: e.message, note: '写的不是多项式' }; }
      const want = polyCoeffs(expectedOf(spec), c.x, at);
      const bad = [];
      for (let k = 0; k <= order; k++) {
        const w = want[k] ?? null, m = mine[k] ?? null;
        const wz = !w || w.zero, mz = !m || m.zero;
        if (wz && mz) continue;
        if (wz !== mz || w.cmp(m) !== 0) bad.push({ k, want: w ? w.toString() : '0', got: m ? m.toString() : '0' });
      }
      const extra = mine.length - 1 > order ? `（${termText(order + 1, c.x, at)} 以上的项不判）` : '';
      if (!bad.length) return { ok: true, msg: extra, note: '' };
      const b = bad[0];
      const msg = `$${termText(b.k, c.x, at)}$ 的系数应该是 $${coefTeX(want[b.k] ?? nearFraction(0))}$，你写的是 $${coefTeX(mine[b.k] ?? nearFraction(0))}$${bad.length > 1 ? `（一共 ${bad.length} 项不对）` : ''}。${extra}`;
      return { ok: false, msg, note: `泰勒：${bad.map((x) => `${termText(x.k, c.x, at)} 的系数应是 ${x.want}，写成 ${x.got}`).join('；')}`, bad };
    }
  }
  return { ok: null, msg: '页面判不了，待外部核。', note: `calc: ${c.kind} 页面不会判` };
}

// 一个数的答案：照审的表（+∞ 写 ∞ 对、说一句；∞ 写不存在对、说一句）
// trueKind：外部写的 ∞、页面算出来是 +∞（或 −∞）时，学生写那个带符号的也对
function judgeValue(kind, want, got, trueKind = null) {
  const right = (msg = '') => ({ ok: true, msg, note: msg });
  const wrong = () => ({ ok: false, msg: `不对：你写的是 $${kindText(got)}$。`, note: `写了 ${kindText(got)}，答案是 ${kindText(want)}` });
  if (want.kind === 'finite') return got.kind === 'finite' && Math.abs(got.value - want.value) <= 1e-9 * Math.max(1, Math.abs(want.value)) ? right() : wrong();
  if (want.kind === got.kind) return right();
  if (kind === 'limit') {
    if ((want.kind === '+inf' || want.kind === '-inf') && got.kind === 'inf') return right(`写 ${KIND_TEXT[want.kind]} 更准确`);
    if (want.kind === 'inf' && got.kind === 'none') return right('更准确是 ∞');
    if (want.kind === 'inf' && trueKind && got.kind === trueKind) return right();
  }
  return wrong();
}
