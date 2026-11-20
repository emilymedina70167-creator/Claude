// derive mode: do 推高数的一行（计划 3 Task 7 + 审的必改 5、6、必加 7；纯函数，tests/derivedo-fx.test.js）。
// derivedo.js 的 checkLine 在实数的题里交给这里。三种：
//   limit（calc: limit at=0）：每一行是「要求极限的那个式子」，一行和上一行恒等直接过；不恒等就比两行的极限——
//     两行的极限都定了（有限、+∞、−∞、∞）而且不同才判错（加减里乱用等价替换就在这里抓到），差得很小、有一行判不了 → null。
//     一行里的 lim 全去掉；一行可以写自己的 lim t→0；「令 t = 1/x」这种行是说明，不判。
//   antideriv（calc: antideriv）：每一行是「一族原函数」，可以带 ∫ g dx、∫ g d(h)、∫_a^b；比两行的导数（∫ g dx 的导数是 g），+C 去掉；
//     换元：「令 x = φ(t)」「令 t = ψ(x)」以后两行化到同一个变量上的导数比；没写「令」就冒出新变量 → null，绝不判错。
//   不写 calc:：判恒等（求导写 '）。
import { parse, evaluate } from '../expr.js';
import { normalizeFormula, FORMULA_FUNCS } from '../formula.js';
import { compareFx, parseDomain, floatScope, showNum, DEFAULT_RANGE, fxEval } from './sample.js';
import { diffAst, substitute, has } from './diff.js';
import { numLimit } from './limit.js';
import { stripTail, atOf, splitSide, valueKind } from './calc.js';
import { nearFraction } from './taylor.js';

const VARS = ['x', 't', 'u', 'y', 'n', 's', 'v', 'w', 'z'];
const SUBST_T = { name: 't', lo: 0.1, hi: 1.2, openLo: true, openHi: true }; // 换元的新变量没写范围时取 (0.1, 1.2)：常见换元在这一段单调、根号取正
const AGREE = 1e-6, APART = 1e-4;

/** derive 的 calc: 一行：limit at=0 [side=+]、antideriv */
export function parseDeriveCalc(line) {
  const s = String(line ?? '').trim();
  if (!s) return null;
  const m = /^(limit|antideriv)\b\s*(.*)$/.exec(s);
  if (!m) throw new Error('derive 的 calc: 写 limit at=0（一行行求极限）或 antideriv（一行行求不定积分）');
  const out = { kind: m[1] };
  for (const kv of m[2].matchAll(/(at|side|var)\s*=\s*(\S+)/g)) out[kv[1]] = kv[2];
  if (out.kind === 'limit') {
    if (out.at === undefined) throw new Error('calc: limit 要写 at=（x 趋向哪：0、inf、+inf、-inf）');
    const t = splitSide(out.at); // at=0+（dr-calc-fix 第 6 条）
    out.at = atOf(t.at);
    if (t.side && !out.side) out.side = t.side;
  }
  out.v = out.var || 'x';
  return out;
}

// —— 读一行 ——
// 「令 t = 1/x」「设 x = sin t, t in (0, 1)」「t = 1/x」：换元的说明行
const SUBST = /^\s*(?:令|设)?\s*([a-z])\s*=\s*(.+?)\s*(?:[,，;；]\s*([a-z]\s*(?:in|∈)\s*[([].*))?\s*$/;
export function substOf(text, known) {
  const m = SUBST.exec(String(text));
  if (!m) return null;
  if (!/^\s*(令|设)/.test(text) && known.includes(m[1]) && !/[a-z]/.test(m[2].replace(/\b(sin|cos|tan|ln|sqrt|arcsin|arctan|e|pi)\b/g, ''))) return null; // x = 1 这种不算换元
  return { name: m[1], rhs: m[2], domain: m[3] ? parseDomain(m[3]) : null };
}

// lim_{x→0}、lim x->0^+、\lim_{t\to\infty}：全部去掉，回第一个写的变量和点
const LIM = /\\?lim\s*(?:_\s*)?[({]?\s*([a-z])\s*(?:->|→|\\to)\s*([+-]?\s*(?:\\infty|∞|inf|[\d.]+|pi|π))\s*(\^\s*[({]?\s*[+-]\s*[)}]?)?\s*[)}]?/g;
function stripLims(text) {
  let first = null;
  const out = String(text).replace(LIM, (all, v, at, side) => {
    if (!first) first = { v, at: atOf(at.replace(/\\infty/g, 'inf').replace(/\s+/g, '')), side: side ? (side.includes('-') ? '-' : '+') : 'both' };
    return ' ';
  }).replace(/\\?\blim\b/g, ' '); // 没写下标的 lim（沿用上一行的变量和点）
  return { text: out, lim: first };
}

// ∫ g dx → int(g, x)；∫ g d(h) → int((g)*((h))')（导数是 g·h′）；∫_a^b g dt → int(g, t, a, b)
function bound(s, i) {
  if (s[i] === '{' || s[i] === '(') { const close = s[i] === '{' ? '}' : ')'; let d = 0; for (let j = i; j < s.length; j++) { if (s[j] === s[i]) d++; else if (s[j] === close && !--d) return [s.slice(i + 1, j), j + 1]; } }
  const m = /^\s*([+-]?[\w.]+)/.exec(s.slice(i));
  return m ? [m[1], i + m[0].length] : ['', i];
}
export function integrals(text) {
  let s = String(text).replace(/\\int/g, '∫');
  for (let guard = 0; s.includes('∫') && guard < 8; guard++) {
    const k = s.lastIndexOf('∫'); // 从里往外：先换最后一个
    let i = k + 1, lo = null, hi = null;
    if (s[i] === '_') { [lo, i] = bound(s, i + 1); if (s[i] === '^') [hi, i] = bound(s, i + 1); }
    // 被积函数到「d变量」或「d(…)」为止（同一层括号里）
    let d = 0, j = i, end = -1, dv = null, dh = null;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === '(' || c === '[') d++;
      else if (c === ')' || c === ']') { if (!d) break; d--; }
      if (d === 0 && c === 'd' && !/[A-Za-z]/.test(s[j - 1] || '')) {
        const m = /^d\s*([a-z])(?![A-Za-z(])/.exec(s.slice(j));
        if (m) { dv = m[1]; end = j + m[0].length; break; }
        if (/^d\s*\(/.test(s.slice(j))) { const p = s.indexOf('(', j); const [h, e] = bound(s, p); dh = h; end = e; break; }
      }
    }
    if (end < 0) throw new Error('∫ 后面要写 dx（或 dt、d(…)）');
    const g = s.slice(i, j).trim();
    if (!g) throw new Error('∫ 和 dx 中间要写被积函数');
    const rep = dh !== null ? `int((${g})*((${dh}))')` : lo !== null ? `int(${g}, ${dv}, ${lo}, ${hi ?? ''})` : `int(${g}, ${dv})`;
    s = s.slice(0, k) + ` ${rep} ` + s.slice(end);
  }
  return s;
}

/** 读一行：回 { ast, src, vars（这一行用到的变量）, lim?, hadC } */
export function readLine(text, { kind, names = [] } = {}) {
  let t = String(text ?? '');
  let lim = null;
  if (kind === 'limit') ({ text: t, lim } = stripLims(t));
  if (kind === 'antideriv' || /∫|\\int/.test(t)) t = integrals(t);
  const known = [...new Set([...VARS, ...names, 'C', 'c', 'C_1', 'C_2'])];
  const src = normalizeFormula(t, { names: known, real: true, funcs: [...FORMULA_FUNCS, 'int'] });
  let ast = parse(src);
  let hadC = false;
  if (kind === 'antideriv') ({ ast, hadC } = stripTail(ast, { kind: 'antideriv' }));
  const vars = VARS.filter((v) => has(ast, v));
  return { ast, src, vars, lim, hadC };
}

// 一行只写一个特殊的值：∞（无符号）、+∞、−∞、不存在
const SPECIAL_TEXT = { inf: '∞', '+inf': '+∞', '-inf': '−∞', none: '不存在' };
export function specialKind(src) {
  const k = valueKind(src).kind;
  return k in SPECIAL_TEXT && /inf|__dne/.test(String(src)) ? k : null;
}
// 真的极限是 truth、学生写的是 wrote：对回 true 或一句提醒（字），错回 false（照 answer 的表：+∞ 写 ∞ 对、∞ 写不存在对）
export function sameKind(truth, wrote) {
  if (truth === wrote) return true;
  if ((truth === '+inf' || truth === '-inf') && wrote === 'inf') return `写 ${SPECIAL_TEXT[truth]} 更准确`;
  if (truth === 'inf' && wrote === 'none') return '更准确是 ∞';
  return false;
}

const fmt = (v) => {
  const q = nearFraction(v, { tol: 1e-9, maxDen: 1000 });
  return q ? q.toString() : showNum(v);
};
const KIND = { inf: '∞', '+inf': '+∞', '-inf': '−∞' };
const limText = (r) => (r.kind === 'finite' ? fmt(r.value) : KIND[r.kind] || '?');

// 一行的极限：ctx.lim 是这一行的变量和点
function limitOf(ast, lim, scope) {
  if (!lim || !has(ast, lim.v)) {
    try { const v = fxEval(ast, floatScope(scope)); return Number.isFinite(v) ? { kind: 'finite', value: v } : { kind: null }; } catch { return { kind: null }; }
  }
  const base = floatScope(scope);
  return numLimit((t) => fxEval(ast, { ...base, [lim.v]: t }), lim.at, { side: lim.side || 'both' });
}

/**
 * 判一行。prev：上一行（读好的 readLine 结果和它的 ctx）；text：学生这一行。ctx：{ lim, subst }（换元、极限的变量和点）。
 * 回 { ok: true | false | null, why?, note?（这一行是换元的说明，不判）, same?: 'limit', read, ctx }
 */
export function checkFxLine(calc, prev, text, { ctx = {}, domain = [], scope = {} } = {}) {
  const kind = calc?.kind || null;
  // 换元的说明行（令 t = 1/x）
  const sub = substOf(text, prev.read.vars);
  if (sub && (kind === 'limit' || kind === 'antideriv')) {
    let rhs;
    try { rhs = parse(normalizeFormula(sub.rhs, { names: VARS, real: true })); } catch (e) { return { ok: false, error: `看不懂这一行：${e.message}` }; }
    const s2 = { name: sub.name, rhs, domain: sub.domain?.[0] || null, from: VARS.find((v) => v !== sub.name && has(rhs, v)) || null };
    return { ok: true, note: true, why: '换元，记下了', ctx: { ...ctx, subst: s2 } };
  }
  let read;
  try { read = readLine(text, { kind, names: Object.keys(scope) }); } catch (e) { return { ok: false, error: e.message }; }
  if (kind === 'limit') return limitLine(calc, prev, read, ctx, scope, domain);
  if (kind === 'antideriv') return antiLine(prev, read, ctx, scope);
  const r = compareFx(prev.read.ast, read.ast, { domain: domain.length ? domain : [{ ...DEFAULT_RANGE, name: 'x' }], scope, allowPrime: true });
  return { ok: r.ok, why: r.ok === false ? r.msg.replace(/\$/g, '') : r.ok === null ? '页面判不了这一步' : '', read, ctx };
}

function limitLine(calc, prev, read, ctx, scope, domain) {
  // 整行只写 ∞ / +∞ / -∞ / 不存在（dr-calc-fix 第 5 条）：当极限的值和上一行的极限比，照 answer 那张表认
  const sp = specialKind(read.src);
  if (sp) {
    const a = limitOf(prev.read.ast, prev.lim || ctx.lim, scope);
    if (a.kind === null) return { ok: null, why: '页面判不了这一步（上一行的极限算不出来）', read, ctx };
    const r = sameKind(a.kind, sp);
    if (r === false) return { ok: false, why: `上一行的极限是 ${limText(a)}，这一行写的是 ${SPECIAL_TEXT[sp]}`, read, ctx, prevLim: limText(a), lineLim: SPECIAL_TEXT[sp] };
    return { ok: true, read, ctx, ...(r ? { hint: r } : {}) };
  }
  // 这一行的变量和点：写了 lim 就用它的；没写、变量换了、有换元的：照换元算点；别的沿用上一行的
  let lim = read.lim || ctx.lim || { v: calc.v, at: calc.at, side: calc.side || 'both' };
  if (!read.lim && read.vars.length && !read.vars.includes(lim.v)) {
    const s = ctx.subst;
    if (s && read.vars.includes(s.name) && s.from === lim.v) {
      const r = numLimit((x) => fxEval(s.rhs, { ...floatScope(scope), [lim.v]: x }), lim.at, { side: lim.side });
      lim = r.kind === 'finite' ? { v: s.name, at: r.value, side: 'both' } : r.kind === '+inf' || r.kind === '-inf' ? { v: s.name, at: r.kind, side: 'both' } : null;
      if (!lim) return { ok: null, why: '换元以后新变量趋向哪，页面算不出来：这一行写上 lim t→…', read, ctx };
    } else return { ok: null, why: '换了变量：先写一行 令 t = …，或者这一行写上 lim t→…', read, ctx };
  }
  const next = { ...ctx, lim };
  // 恒等（同一个变量）：直接过
  const pv = prev.lim || ctx.lim;
  if (pv && pv.v === lim.v && read.vars.every((v) => v === lim.v)) {
    const dm = domain.find((d) => d.name === lim.v) || { ...DEFAULT_RANGE, name: lim.v };
    const r = compareFx(prev.read.ast, read.ast, { domain: [dm], scope });
    if (r.ok === true) return { ok: true, read, ctx: next };
  }
  const a = limitOf(prev.read.ast, pv, scope), b = limitOf(read.ast, lim, scope);
  const decided = (r) => r.kind === 'finite' || r.kind === '+inf' || r.kind === '-inf' || r.kind === 'inf';
  if (!decided(a) || !decided(b)) return { ok: null, why: `页面判不了这一步（${!decided(b) ? '这一行' : '上一行'}的极限算不出来）`, read, ctx: next };
  const why = `这一行的极限是 ${limText(b)}，上一行是 ${limText(a)}`;
  if (a.kind !== b.kind) return { ok: false, why, read, ctx: next, prevLim: limText(a), lineLim: limText(b) };
  if (a.kind !== 'finite') return { ok: true, same: 'limit', read, ctx: next };
  // 种类是 finite 而值不是有限数（外推溢出）：判不了，不拿 ∞ 的容差去比（dr-final-fix 第 1 条）
  if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) return { ok: null, why: '页面判不了这一步（极限算出来不是有限数）', read, ctx: next };
  const scale = Math.max(1, Math.abs(a.value), Math.abs(b.value)), gap = Math.abs(a.value - b.value);
  if (gap <= AGREE * scale) return { ok: true, same: 'limit', read, ctx: next };
  if (gap > APART * scale) return { ok: false, why, read, ctx: next, prevLim: limText(a), lineLim: limText(b) };
  return { ok: null, why: '两行的极限差一点点，页面分不清', read, ctx: next };
}

// 不定积分的一行：对它自己的变量求导；换元了就化到同一个变量上
function antiLine(prev, read, ctx, scope) {
  const pv = prev.read.vars, lv = read.vars;
  const one = (vs) => (vs.length === 1 ? vs[0] : vs.length === 0 ? null : 'many');
  const a = one(pv) || 'x', b = one(lv) || a;
  if (a === 'many' || b === 'many') return { ok: null, why: '一行里有两个变量，页面判不了', read, ctx };
  const Da = diffAst(prev.read.ast, a), Db = diffAst(read.ast, b);
  if (a === b) {
    const dm = a === ctx.subst?.name ? (ctx.subst.domain || { ...SUBST_T, name: a }) : { ...DEFAULT_RANGE, name: a };
    const r = compareFx(Da, Db, { domain: [dm], scope });
    return { ok: r.ok, why: r.ok === false ? `两行求导以后不一样：${r.msg.replace(/\$/g, '')}` : r.ok === null ? '页面判不了这一步' : '', read, ctx };
  }
  const s = ctx.subst;
  if (!s || ![a, b].includes(s.name)) return { ok: null, why: '换了变量，先写一行 令 x = …（或 令 t = …），页面才能核', read, ctx };
  // x = φ(t)：在 t 上取点，x 的行用 F′(φ(t))·φ′(t)；t = ψ(x)：在 x 上取点，t 的行用 G′(ψ(x))·ψ′(x)
  const newVar = s.name, oldVar = s.from || (a === newVar ? b : a);
  let left, right, dm;
  if (s.from && s.name !== 'x' && has(s.rhs, oldVar) && oldVar === 'x') {
    // t = ψ(x)
    const chain = (D) => ({ t: 'bin', op: '*', a: substitute(D, newVar, s.rhs), b: diffAst(s.rhs, 'x') });
    [left, right] = a === newVar ? [chain(Da), Db] : [Da, chain(Db)];
    dm = { ...DEFAULT_RANGE, name: 'x' };
  } else {
    // x = φ(t)：s.name 是 x，s.rhs 是 t 的式子
    const tv = VARS.find((v) => v !== s.name && has(s.rhs, v));
    const chain = (D) => ({ t: 'bin', op: '*', a: substitute(D, s.name, s.rhs), b: diffAst(s.rhs, tv) });
    [left, right] = a === s.name ? [chain(Da), Db] : [Da, chain(Db)];
    dm = s.domain || { ...SUBST_T, name: tv };
  }
  const r = compareFx(left, right, { domain: [dm], scope });
  return { ok: r.ok, why: r.ok === false ? `换元以后两行对不上：${r.msg.replace(/\$/g, '')}` : r.ok === null ? '页面判不了这一步' : '', read, ctx };
}
