// 泰勒展开的系数（计划 3，dr-calc-base Task 6；纯函数，tests/fx-taylor.test.js）。
//   polyCoeffs：学生 / 外部写的多项式 → 按 (x − at) 的幂的精确系数（poly.js 的 Poly，系数是 exact.js 的分数）；
//   taylorCoeffs：f 的第 k 项系数 = f⁽ᵏ⁾(at) / k!，符号求导再取值（在 at 上没定义的用数值极限），再找回分数。
// 考研的麦克劳林展开系数都是有理数；找不回分数的（e^x 在 x = 1 展开带 e）回 null，自检报「页面判不了」。
import { parse, evaluate } from '../expr.js';
import { Q, calcValue, isQ } from '../exact.js';
import { Poly } from '../poly.js';
import { diffAst } from './diff.js';
import { numLimit } from './limit.js';

const notPoly = (why) => { throw new Error(`要写成 x 的多项式（${why}）`); };

/** 多项式的精确系数：c[k] 是 (x − at)^k 的系数。不是多项式（有 sin、x 在分母、非整数次幂）抛中文原因 */
export function polyCoeffs(ast, x = 'x', at = 0) {
  const n = typeof ast === 'string' ? parse(ast) : ast;
  const shift = Q.from(at);
  const go = (m) => {
    switch (m.t) {
      case 'num': return Poly.const(m.big !== undefined ? new Q(m.big) : Q.from(m.v));
      case 'var':
        if (m.name === x) return new Poly([shift, Q.int(1)]); // x = at + t
        return notPoly(`${m.name === 'pi' ? 'π' : m.name} 不是有理数`);
      case 'neg': return go(m.a).neg();
      case 'bin': {
        if (m.op === '+') return go(m.a).add(go(m.b));
        if (m.op === '-') return go(m.a).sub(go(m.b));
        if (m.op === '*') return go(m.a).mul(go(m.b));
        if (m.op === '/') {
          const d = go(m.b);
          if (!d.isConst || d.zero) notPoly('分母里不能有 x');
          return go(m.a).scale(Q.int(1).div(d.constValue()));
        }
        if (m.op === '^') {
          const e = go(m.b);
          if (!e.isConst) notPoly('指数里不能有 x');
          const k = e.constValue();
          if (!k.integer || k.n < 0n || k.n > 60n) notPoly('次数要是非负整数');
          return go(m.a).pow(Number(k.n));
        }
        return notPoly('不能有比较');
      }
      default: return notPoly(m.t === 'call' ? `不能有 ${m.name}()` : '写法');
    }
  };
  return go(n).c;
}

// 浮点 → 分母不超过 maxDen 的分数（误差 tol 以内）；找不到回 null。连分数逐项逼近
export function nearFraction(v, { tol = 1e-7, maxDen = 100000 } = {}) {
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v - Math.round(v)) <= tol * Math.max(1, Math.abs(v))) return Q.int(Math.round(v));
  let h0 = 1n, h1 = 0n, k0 = 0n, k1 = 1n, y = v;
  for (let i = 0; i < 30; i++) {
    const a = Math.floor(y);
    const ba = BigInt(a);
    [h0, h1] = [ba * h0 + h1, h0];
    [k0, k1] = [ba * k0 + k1, k0];
    if (k0 > BigInt(maxDen)) return null;
    if (Math.abs(Number(h0) / Number(k0) - v) <= tol * Math.max(1, Math.abs(v))) return new Q(h0, k0);
    const frac = y - a;
    if (frac < 1e-12) return null;
    y = 1 / frac;
  }
  return null;
}

/**
 * f 在 at 处泰勒展开前 order + 1 项的系数（精确分数），找不回分数的那一项是 null。
 * f⁽ᵏ⁾(at) 直接代进去算不出来（at 是可去间断点）时用数值极限
 */
export function taylorCoeffs(fAst, x = 'x', at = 0, order = 3, { untilNonzero = false } = {}) {
  const f = typeof fAst === 'string' ? parse(fAst) : fAst;
  const out = [];
  let fact = 1;
  let D = f;
  for (let k = 0; k <= order; k++) {
    if (k) fact *= k;
    let v = NaN;
    try {
      // 在上一阶的导数上接着求（每一阶都从头求，tan 的八阶导要几十毫秒）
      if (k) D = diffAst(D, x, 1);
      try { v = evaluate(D, { [x]: at }); } catch { v = NaN; }
      if (!Number.isFinite(v)) {
        const r = numLimit((t) => evaluate(D, { [x]: t }), at);
        v = r.kind === 'finite' ? r.value : NaN;
      }
    } catch { v = NaN; }
    out.push(nearFraction(v / fact));
    // 找阶（第一个不为 0 的系数）时找到就停
    if (untilNonzero && out.at(-1) && !out.at(-1).zero) break;
  }
  return out;
}

/** 系数写成 TeX（-1/2 → -\tfrac{1}{2}） */
export function coefTeX(c) {
  if (c === null || c === undefined) return '?';
  try { return isQ(c) ? c.toTeX() : calcValue(String(c)).tex; } catch { return String(c); }
}
