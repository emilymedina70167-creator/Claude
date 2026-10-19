// 一个未知数的多项式，系数是精确分数（exact.js 的 Q）。线代组件用：特征多项式 |λE − A|、含参数的方程组（主元是 λ 的式子）。
// 求有理根（有理根定理）、分解出一次因式、写成 TeX（展开的、分解的）。纯函数，不碰 DOM（tests/poly.test.js）。
import { Q } from './exact.js';

const ZERO = new Q(0n), ONE = new Q(1n);
const qOf = (x) => (x instanceof Q ? x : Q.from(x));

export class Poly {
  /** c[k] 是 x^k 的系数 */
  constructor(c = []) {
    const a = c.map(qOf);
    while (a.length && a[a.length - 1].zero) a.pop();
    this.c = a;
  }
  static const(k) { return new Poly([qOf(k)]); }
  static x() { return new Poly([ZERO, ONE]); }
  get deg() { return this.c.length - 1; } // 零多项式是 −1
  get zero() { return this.c.length === 0; }
  get lead() { return this.c[this.c.length - 1] ?? ZERO; }
  get isConst() { return this.c.length <= 1; }
  constValue() { return this.c[0] ?? ZERO; }
  coef(k) { return this.c[k] ?? ZERO; }
  add(o) { o = P(o); const n = Math.max(this.c.length, o.c.length); return new Poly(Array.from({ length: n }, (_, k) => this.coef(k).add(o.coef(k)))); }
  sub(o) { return this.add(P(o).neg()); }
  neg() { return new Poly(this.c.map((x) => x.neg())); }
  scale(k) { k = qOf(k); return new Poly(this.c.map((x) => x.mul(k))); }
  mul(o) {
    o = P(o);
    if (this.zero || o.zero) return new Poly([]);
    const out = Array.from({ length: this.c.length + o.c.length - 1 }, () => ZERO);
    this.c.forEach((a, i) => o.c.forEach((b, j) => { out[i + j] = out[i + j].add(a.mul(b)); }));
    return new Poly(out);
  }
  pow(n) { let r = Poly.const(1); for (let i = 0; i < n; i++) r = r.mul(this); return r; }
  /** 带余除法：{ q, r } */
  divmod(o) {
    o = P(o);
    if (o.zero) throw new Error('除以 0 多项式了');
    let r = this;
    const q = Array.from({ length: Math.max(0, this.deg - o.deg + 1) }, () => ZERO);
    while (!r.zero && r.deg >= o.deg) {
      const k = r.deg - o.deg;
      const f = r.lead.div(o.lead);
      q[k] = f;
      r = r.sub(new Poly([...Array(k).fill(ZERO), ...o.c.map((x) => x.mul(f))]));
    }
    return { q: new Poly(q), r };
  }
  /** 整除时的商（不整除就抛错） */
  div(o) { const { q, r } = this.divmod(o); if (!r.zero) throw new Error('多项式不整除'); return q; }
  eval(x) { x = qOf(x); let v = ZERO; for (let k = this.c.length - 1; k >= 0; k--) v = v.mul(x).add(this.c[k]); return v; }
  equals(o) { return this.sub(P(o)).zero; }
  monic() { return this.zero ? this : this.scale(ONE.div(this.lead)); }

  /**
   * 有理根（带重数）：[{ root: Q, mult }]，按从小到大。剩下的部分（没有有理根的因式）在 rest。
   * 用有理根定理：先乘成整系数，±(常数项的因数)/(首项的因数) 一个个试
   */
  roots() {
    let p = this;
    const out = [];
    if (p.zero) return { roots: out, rest: p };
    // x = 0 的重根
    let m0 = 0;
    while (p.deg > 0 && p.coef(0).zero) { p = new Poly(p.c.slice(1)); m0++; }
    if (m0) out.push({ root: ZERO, mult: m0 });
    for (;;) {
      if (p.deg < 1) break;
      const ints = integerCoeffs(p);
      const a0 = abs(ints[0]), an = abs(ints[ints.length - 1]);
      let found = null;
      outer: for (const q of divisors(an)) {
        for (const r of divisors(a0)) {
          for (const s of [1n, -1n]) {
            const x = new Q(s * r, q);
            if (p.eval(x).zero) { found = x; break outer; }
          }
        }
      }
      if (!found) break;
      let m = 0;
      const lin = new Poly([found.neg(), ONE]);
      while (p.deg >= 1 && p.eval(found).zero) { p = p.div(lin); m++; }
      out.push({ root: found, mult: m });
    }
    out.sort((a, b) => a.root.cmp(b.root));
    return { roots: out, rest: p };
  }

  /** 展开的 TeX：λ^3 - 4λ^2 + 5λ - 2 */
  toTeX(v = '\\lambda') {
    if (this.zero) return '0';
    let s = '';
    for (let k = this.c.length - 1; k >= 0; k--) {
      const a = this.c[k];
      if (a.zero) continue;
      const neg = a.n < 0n;
      const abs = neg ? a.neg() : a;
      const coefTeX = k > 0 && abs.n === 1n && abs.d === 1n ? '' : abs.toTeX();
      const mono = k === 0 ? '' : k === 1 ? v : `${v}^{${k}}`;
      s += `${s ? (neg ? ' - ' : ' + ') : neg ? '-' : ''}${coefTeX}${mono}`;
    }
    return s;
  }

  /**
   * 分解的 TeX：(λ - 2)^2(λ - 6)；有理根分不完的部分照写。首项系数不是 1 时写在最前面。
   * sign：首项是负的（比如 2 − λ 这种）时，lin 写成 (c − λ) 的样子更像课本：opts.flip
   */
  toFactorTeX(v = '\\lambda') {
    if (this.zero) return '0';
    if (this.deg < 1) return this.constValue().toTeX();
    const { roots, rest } = this.roots();
    if (!roots.length) return this.toTeX(v);
    let lead = rest.lead;
    let restPart = rest.deg >= 1 ? rest.monic() : null;
    const parts = roots.map(({ root, mult }) => {
      const lin = root.zero ? v : `(${v} ${root.n < 0n ? '+' : '-'} ${(root.n < 0n ? root.neg() : root).toTeX()})`;
      return mult > 1 ? `${lin}^{${mult}}` : lin;
    });
    if (restPart) parts.push(`(${restPart.toTeX(v)})`);
    const neg = lead.n < 0n;
    if (neg) lead = lead.neg();
    const k = lead.n === 1n && lead.d === 1n ? '' : lead.toTeX();
    return `${neg ? '-' : ''}${k}${parts.join('')}`;
  }
}

export const P = (x) => (x instanceof Poly ? x : Poly.const(x));

const abs = (n) => (n < 0n ? -n : n);
function gcdBig(a, b) { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; }
function lcmBig(a, b) { return a / gcdBig(a, b) * b; }

// 乘上分母的最小公倍数，变成整系数（BigInt 数组）
function integerCoeffs(p) {
  const L = p.c.reduce((m, x) => lcmBig(m, x.d), 1n);
  return p.c.map((x) => x.n * (L / x.d));
}

// 正因数（数太大时只试到 10^6，考题里足够）
function divisors(n) {
  n = abs(n);
  if (n === 0n) return [1n];
  const out = [];
  for (let d = 1n; d * d <= n && d <= 1000000n; d++) if (n % d === 0n) { out.push(d); if (d * d !== n) out.push(n / d); }
  return out.sort((a, b) => (a < b ? -1 : 1));
}

/** 多项式矩阵的行列式（按第一行展开，n ≤ 6） */
export function polyDet(M) {
  const n = M.length;
  if (n === 1) return P(M[0][0]);
  if (n > 6) throw new Error('行列式最多算到 6 阶');
  let d = new Poly([]);
  for (let j = 0; j < n; j++) {
    const a = P(M[0][j]);
    if (a.zero) continue;
    const minor = M.slice(1).map((r) => r.filter((_, k) => k !== j));
    const t = a.mul(polyDet(minor));
    d = j % 2 ? d.sub(t) : d.add(t);
  }
  return d;
}

/** 特征多项式 |λE − A|（A 是 Q 的方阵） */
export function charPoly(A) {
  const n = A.length;
  const lam = Poly.x();
  return polyDet(A.map((r, i) => r.map((a, j) => (i === j ? lam.sub(P(a)) : P(a).neg()))));
}

/** 多项式的最大公因式（首一） */
export function polyGcd(a, b) {
  a = P(a); b = P(b);
  while (!b.zero) [a, b] = [b, a.divmod(b).r];
  return a.zero ? a : a.monic();
}
