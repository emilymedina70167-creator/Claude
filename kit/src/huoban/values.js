// 活板的值：数用 exact.js 的精确分数（和 \calc、let 块、matrix 一样），开方这类算不出精确值的退回小数。
// 向量、矩阵是数的数组；另外有文字、真假，和对象（演示过程、句子，见 objects.js）。纯函数。
import { Q, isQ, toFloat, add as qadd, mul as qmul, scale as qscale, exactText, exactTeX, isQVec, isQMat, calcValue, Inexact } from '../exact.js';
import { isRadix, parse } from '../expr.js';
import { HbError } from './lang.js';

const err = (m) => new HbError(m);

export const isNumber = (v) => isQ(v) || typeof v === 'number';
export const isVector = (v) => Array.isArray(v) && v.length > 0 && v.every(isNumber);
export const isMatrix = (v) => Array.isArray(v) && v.length > 0 && v.every(isVector) && v.every((r) => r.length === v[0].length);
const exactAll = (v) => (isQ(v) ? true : Array.isArray(v) ? v.every(exactAll) : false);
export const f = (v) => (isQ(v) ? v.toNumber() : Array.isArray(v) ? v.map(f) : v);

/** JS 的数 → 精确的（整数和看得出是分数的浮点） */
export function q(x) {
  if (isQ(x)) return x;
  if (typeof x === 'number' && Number.isFinite(x)) { try { return Q.from(x); } catch { return x; } }
  return x;
}
export const qnum = (s) => Q.from(Number(s));

// —— 四则运算：两边都精确就精确算，否则小数 ——
const fadd = (a, b, s) => {
  if (typeof a === 'number' && typeof b === 'number') return a + s * b;
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) throw err('长度不一样的两个东西不能相加'); return a.map((x, i) => fadd(x, b[i], s)); }
  throw err(s === 1 ? '这两个东西不能相加' : '这两个东西不能相减');
};
export function add(a, b, s = 1) {
  if (typeof a === 'string' && s === 1) return a + text(b);
  if (exactAll(a) && exactAll(b)) {
    try { return s === 1 ? qadd(a, b) : qadd(a, qscale(new Q(-1n), b)); } catch (e) { throw err(e.message); }
  }
  return fadd(f(a), f(b), s);
}
export function scale(k, v) {
  if (exactAll(k) && exactAll(v)) return qscale(k, v);
  const kk = f(k);
  const go = (x) => (Array.isArray(x) ? x.map(go) : kk * x);
  return go(f(v));
}
export function mul(a, b) {
  if (isNumber(a) || isNumber(b)) {
    if (isNumber(a) && isNumber(b)) return exactAll(a) && exactAll(b) ? a.mul(b) : f(a) * f(b);
    return isNumber(a) ? scale(a, b) : scale(b, a);
  }
  if (isVector(a) && isVector(b)) throw err('两个向量相乘写 dot(u, v)');
  if (exactAll(a) && exactAll(b)) { try { return qmul(a, b); } catch (e) { throw err(e.message); } }
  const A = f(a), B = f(b);
  if (isMatrix(A) && isVector(B)) { if (A[0].length !== B.length) throw err(`${A.length}×${A[0].length} 的矩阵不能乘 ${B.length} 维的向量`); return A.map((r) => r.reduce((s, x, j) => s + x * B[j], 0)); }
  if (isMatrix(A) && isMatrix(B)) { if (A[0].length !== B.length) throw err('矩阵的形状对不上，不能相乘'); return A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0))); }
  throw err('这两个东西不能相乘');
}
export function div(a, b) {
  if (!isNumber(b)) throw err('只能除以一个数');
  if (exactAll(b) && b.zero) throw err('除以 0 了');
  if (exactAll(b)) return scale(new Q(1n).div(b), a);
  return scale(1 / f(b), a);
}
export function neg(a) { if (isNumber(a) || Array.isArray(a)) return scale(new Q(-1n), a); throw err('负号只能用在数、向量、矩阵前面'); }

export function cmp(a, b) {
  if (isQ(a) && isQ(b)) return a.cmp(b);
  if (!isNumber(a) || !isNumber(b)) throw err('只能比较两个数的大小');
  const x = f(a), y = f(b), d = x - y;
  return Math.abs(d) < 1e-9 * Math.max(1, Math.abs(x), Math.abs(y)) ? 0 : d < 0 ? -1 : 1;
}

export const normText = (s) => String(s).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim().replace(/[.!?。]+$/, '');

/** 两个值一样吗（数精确比、小数按误差比、文字不管大小写和多余的空格） */
export function same(a, b) {
  if (a && a.kind === 'alts') return a.items.some((x) => same(x, b));
  if (b && b.kind === 'alts') return b.items.some((x) => same(a, x));
  if (isNumber(a) && isNumber(b)) return cmp(a, b) === 0;
  if (isRadix(a) || isRadix(b)) return normText(text(a)) === normText(text(b));
  if (typeof a === 'string' || typeof b === 'string') return normText(text(a)) === normText(text(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
  return a === b;
}

export const truthy = (v) => (Array.isArray(v) ? v.length > 0 : isQ(v) ? !v.zero : !!v);

// —— 写出来 ——
export function numText(x) {
  if (isQ(x)) { try { return exactText(x).replace('-', '−'); } catch { return '很大的数'; } }
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞';
  const r = Math.round(x);
  if (Math.abs(x - r) < 1e-9) return String(r).replace('-', '−');
  return String(Number(x.toPrecision(4))).replace('-', '−');
}
/** 值 → 给人看的一行字（板上的活的值、记给老师的事实） */
export function text(v) {
  if (v === undefined || v === null) return '—';
  if (isNumber(v)) return numText(v);
  if (isRadix(v)) return v.digits;
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'string') return v;
  if (v.kind === 'alts') return v.items.map(text).join(' 或 ');
  if (isMatrix(v)) return `[${v.map((r) => r.map(numText).join(' ')).join('; ')}]`;
  if (isVector(v)) return v.length <= 3 ? `(${v.map(numText).join(', ')})` : v.map(numText).join(' ');
  if (Array.isArray(v)) return v.map(text).join(' ');
  if (typeof v.toText === 'function') return v.toText();
  return String(v);
}
/** 值 → TeX（精确的用 exact.js 的写法，分数是 \tfrac） */
export function tex(v) {
  try { if (exactAll(v) || isRadix(v)) return exactTeX(v); } catch {}
  if (typeof v === 'number') return numText(v).replace('−', '-');
  if (isMatrix(v)) return `\\begin{bmatrix}${v.map((r) => r.map((x) => tex(x)).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
  if (isVector(v)) return `\\begin{bmatrix}${v.map((x) => tex(x)).join(' \\\\ ')}\\end{bmatrix}`;
  return `\\text{${text(v).replace(/[\\{}$&#^_%~]/g, '')}}`;
}

// —— exact.js 的函数（det、inv、rank、mod、bin、hex、faults、nextval……）照用：拼成一个式子交给 calcValue ——
// 先精确算，算不出精确值的（开方、三角）它自己退回小数。参数里的算法名（fifo、lru）原样写成词
const AST = new Map();
export function exactCall(fn, args) {
  const vars = {};
  const parts = args.map((a, i) => {
    if (typeof a === 'string' && /^[A-Za-z]\w*$/.test(a)) return a;
    if (!(isNumber(a) || Array.isArray(a))) throw err(`${fn}() 的第 ${i + 1} 个参数要数、向量或矩阵`);
    vars[`__a${i}`] = a;
    return `__a${i}`;
  });
  try {
    // 找例子时一秒调几万次：同一个式子只解析一次
    const src = `${fn}(${parts.join(', ')})`;
    let ast = AST.get(src);
    if (!ast) { ast = parse(src); AST.set(src, ast); }
    const r = calcValue(ast, vars);
    return r.value;
  } catch (e) {
    if (e instanceof Inexact) throw err(e.message);
    throw err(String(e.message || e).replace(/^未定义的变量 __a\d+$/, `${fn}() 的参数不对`));
  }
}

// —— 学生写的答案 ——
/** 读学生写的：数（整数、分数、小数）、向量（(1, 2) / 1 2）、文字 */
export function readAnswer(s) {
  const t = String(s).trim().replace(/[（(]/g, '(').replace(/[）)]/g, ')').replace(/，/g, ',').replace(/−/g, '-');
  const one = (x) => {
    const m = /^(-?\d+(?:\.\d+)?)(?:\/(-?\d+(?:\.\d+)?))?$/.exec(x.trim());
    if (!m) return null;
    const a = Q.from(Number(m[1]));
    return m[2] ? (Number(m[2]) === 0 ? null : a.div(Q.from(Number(m[2])))) : a;
  };
  if (one(t)) return one(t);
  const parts = t.replace(/^[([]|[)\]]$/g, '').split(/\s*,\s*|\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => one(p))) return parts.map(one);
  return t;
}
/** 学生写的对吗（不是整数的答案，写成保留两位的小数也算对） */
export function checkAnswer(given, expected) {
  const g = readAnswer(given);
  if (expected && expected.kind === 'alts') return expected.items.some((x) => checkAnswer(given, x));
  if (isNumber(expected) && isNumber(g)) {
    if (cmp(g, expected) === 0) return true;
    const e = f(expected);
    return !(isQ(expected) && expected.integer) && !Number.isInteger(e) && Math.abs(f(g) - e) < 0.006;
  }
  if (isVector(expected) && isVector(g)) return same(g, expected);
  if (isVector(expected) && typeof g === 'string') return normText(g.replace(/[,\s]+/g, ' ')) === normText(text(expected));
  return normText(text(g)) === normText(text(expected));
}

export { isQ, Q, toFloat, isQVec, isQMat };
