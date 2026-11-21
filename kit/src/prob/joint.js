// 二维离散随机变量的联合分布表（概率第 4 批）。纯函数，不碰 DOM，全是精确的分数。
// 表的行是 X 的取值、列是 Y 的取值，p[i][j] = P(X = xs[i], Y = ys[j])；空着的格是 null。
import { evaluateExact, Q } from '../exact.js';
import { evaluate } from '../expr.js';
import { Q0, Q1, qSum, readQ, qReduce, qTeX } from './num.js';

const cellsOf = (src) => String(src ?? '').trim().split(/[\s,，]+/).filter(Boolean);
const values = (src, what) => {
  const out = cellsOf(src).map((s) => {
    const v = readQ(s);
    if (!v) throw new Error(`${what} 的取值「${s}」读不懂：写数，空格隔开`);
    return v;
  });
  if (!out.length) throw new Error(`${what} 的取值没写`);
  if (new Set(out.map(String)).size < out.length) throw new Error(`${what} 的取值有重了的`);
  return out;
};

/** 读一张表。xs、ys 一行数；p 按行写（一行是 X 的一个值），分号或换行分行，? 是空着的格 */
export function parseJoint(xSrc, ySrc, pSrc) {
  const xs = values(xSrc, 'X'), ys = values(ySrc, 'Y');
  const rows = String(pSrc ?? '').split(/[;；\n]/).map((r) => r.trim()).filter(Boolean);
  if (rows.length !== xs.length) throw new Error(`p 要写 ${xs.length} 行（X 的每个取值一行，分号或换行分开），现在是 ${rows.length} 行`);
  const blanks = [];
  const p = rows.map((row, i) => {
    const cs = cellsOf(row);
    if (cs.length !== ys.length) throw new Error(`p 的第 ${i + 1} 行要 ${ys.length} 个数（Y 的每个取值一个），现在是 ${cs.length} 个`);
    return cs.map((s, j) => {
      if (/^[?？_]$/.test(s)) { blanks.push([i, j]); return null; }
      const v = readQ(s);
      if (!v) throw new Error(`p 里的「${s}」读不懂：写 0.2、1/5、20%，空着的格写 ?`);
      return v;
    });
  });
  return { xs, ys, p, blanks };
}

/** 数对不对：回一组话（空的就是没问题）。有空着的格时不查和 */
export function checkJoint(j) {
  const out = [];
  const flat = j.p.flat();
  if (flat.some((x) => x && x.cmp(Q0) < 0)) out.push('表里有负的概率');
  if (flat.every(Boolean)) {
    const sum = qSum(flat);
    if (sum.cmp(Q1) !== 0) out.push(`表里的概率加起来是 ${sum}，不是 1`);
  }
  return out;
}

const sums = (src, n, what) => {
  if (src == null || src === '') return null;
  const out = Array.isArray(src) ? src : cellsOf(src).map((s) => readQ(s));
  if (out.length !== n || out.some((x) => !x)) throw new Error(`${what} 要 ${n} 个数`);
  return out;
};

/**
 * 补空着的格。能用的条件：和是 1、给的边缘（rowSums 是 X 的、colSums 是 Y 的）、独立。
 * 回 { ok, joint, filled, missing（还补不出来的格）, why（条件互相对不上时）}
 */
export function completeJoint(j, { rowSums, colSums, independent: indep = false } = {}) {
  const R = j.xs.length, C = j.ys.length;
  const p = j.p.map((r) => r.slice());
  const r = sums(rowSums, R, 'X 的边缘') || Array(R).fill(null);
  const c = sums(colSums, C, 'Y 的边缘') || Array(C).fill(null);
  const clash = (why) => ({ ok: false, joint: { ...j, p }, filled: [], missing: blanksOf(p), why });
  const blanksOf = (t) => t.flatMap((row, i) => row.map((x, k) => (x ? null : [i, k])).filter(Boolean));

  // 一次方程那一半：未知的格是未知数，和是 1、给了的行和列和各一条，消元后只剩自己的就是定下来了
  const linear = () => {
    const unk = blanksOf(p), N = unk.length;
    const at = new Map(unk.map(([i, k], n) => [`${i},${k}`, n]));
    const eq = (cells, total) => {
      const a = Array(N).fill(Q0); let b = total;
      for (const [i, k] of cells) { if (p[i][k]) b = b.sub(p[i][k]); else a[at.get(`${i},${k}`)] = Q1; }
      return { a, b };
    };
    const all = []; for (let i = 0; i < R; i++) for (let k = 0; k < C; k++) all.push([i, k]);
    const rows = [eq(all, Q1)];
    r.forEach((v, i) => { if (v) rows.push(eq(all.filter((x) => x[0] === i), v)); });
    c.forEach((v, k) => { if (v) rows.push(eq(all.filter((x) => x[1] === k), v)); });
    const red = qReduce(rows, N);
    if (!red.ok) return false;
    let changed = false;
    red.M.forEach((row, n) => {
      if (row.slice(0, N).filter((x) => !x.zero).length !== 1) return;
      const [i, k] = unk[red.pivots[n]];
      p[i][k] = row[N]; changed = true;
    });
    return changed ? 'changed' : true;
  };
  // 独立那一半：格 = 行边缘 × 列边缘，知道两个推第三个；边缘的和是 1
  const product = () => {
    let changed = false, bad = false;
    const lastOne = (m) => { const un = m.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0); if (un.length === 1) { m[un[0]] = Q1.sub(qSum(m.filter(Boolean))); changed = true; } };
    for (let i = 0; i < R; i++) if (!r[i] && p[i].every(Boolean)) { r[i] = qSum(p[i]); changed = true; }
    for (let k = 0; k < C; k++) if (!c[k] && p.every((row) => row[k])) { c[k] = qSum(p.map((row) => row[k])); changed = true; }
    lastOne(r); lastOne(c);
    for (let i = 0; i < R; i++) for (let k = 0; k < C; k++) {
      const x = p[i][k];
      if (r[i] && c[k]) {
        const v = r[i].mul(c[k]);
        if (!x) { p[i][k] = v; changed = true; } else if (x.cmp(v) !== 0) bad = true;
      } else if (x && r[i] && !r[i].zero && !c[k]) { c[k] = x.div(r[i]); changed = true; }
      else if (x && c[k] && !c[k].zero && !r[i]) { r[i] = x.div(c[k]); changed = true; }
    }
    return bad ? false : changed ? 'changed' : true;
  };

  for (let guard = 0; guard < 4 * (R + C + R * C); guard++) {
    const a = linear();
    if (a === false) return clash('给的边缘和表里的数对不上');
    const b = indep ? product() : true;
    if (b === false) return clash('表里的数和「独立」对不上');
    if (a !== 'changed' && b !== 'changed') break;
  }
  const flat = p.flat().filter(Boolean);
  if (flat.some((x) => x.cmp(Q0) < 0)) return clash('给的边缘和表里的数对不上（补出来的格是负的）');
  const missing = blanksOf(p);
  const filled = j.blanks.filter(([i, k]) => p[i][k]);
  return { ok: !missing.length, joint: { ...j, p, blanks: missing }, filled, missing };
}

const need = (j) => { if (j.p.flat().some((x) => !x)) throw new Error('表里还有空着的格'); };

/** 边缘分布：px[i] = P(X = xs[i])，py[j] = P(Y = ys[j]) */
export function marginals(j) {
  need(j);
  return { px: j.p.map((row) => qSum(row)), py: j.ys.map((_, k) => qSum(j.p.map((row) => row[k]))) };
}
/** 条件分布：'Y|X' 是 X = xs[i] 时 Y 的分布，'X|Y' 是 Y = ys[i] 时 X 的分布。条件的概率是 0 回 null */
export function conditional(j, which, i) {
  const { px, py } = marginals(j);
  const yx = /^Y/i.test(which);
  const base = yx ? px[i] : py[i];
  if (!base || base.zero) return null;
  return (yx ? j.p[i] : j.p.map((row) => row[i])).map((x) => x.div(base));
}
/** 独立吗：每一格和「行边缘 × 列边缘」比。回 { ok, where（第一格对不上的）, product（那一格的乘积）, cells（全部对不上的格）} */
export function independent(j) {
  const { px, py } = marginals(j);
  const cells = [];
  j.p.forEach((row, i) => row.forEach((x, k) => { if (x.cmp(px[i].mul(py[k])) !== 0) cells.push([i, k]); }));
  if (!cells.length) return { ok: true, cells };
  const [i, k] = cells[0];
  return { ok: false, where: cells[0], product: px[i].mul(py[k]), cells };
}

// 式子里并排写的 XY、2X 补上乘号
export const tidy = (src) => String(src ?? '').replace(/\s+/g, ' ').trim()
  .replace(/(\d)\s*(?=[XYxy](?![A-Za-z]))/g, '$1*')
  .replace(/(?<![A-Za-z])([XYxy])\s*(?=[XYxy](?![A-Za-z]))/g, '$1*');
function valueAt(src, x, y) {
  const vars = { X: x, Y: y, x, y };
  try {
    const v = evaluateExact(src, vars);
    if (v instanceof Q) return v;
    throw new Error('要是一个数');
  } catch (e) {
    if (!e || !e.inexact) throw e; // 认「算不出精确值」靠错误上的 inexact 标记：类的名字压缩以后就没了
    const f = evaluate(src, { X: x.toNumber(), Y: y.toNumber(), x: x.toNumber(), y: y.toNumber() });
    if (typeof f !== 'number' || !Number.isFinite(f)) throw new Error('算出来不是一个数');
    return Number(f.toPrecision(12));
  }
}
const numOf = (z) => (typeof z === 'number' ? z : z.toNumber());

/**
 * Z = g(X, Y) 的分布。回 { rows: [{ z, p, cells }]（按 z 从小到大，概率是 0 的不列）, cellZ[i][j]（这一格是 rows 里第几个，没有是 -1）}
 */
export function distOf(j, expr) {
  need(j);
  const src = tidy(expr);
  const groups = new Map();
  try {
    j.xs.forEach((x, i) => j.ys.forEach((y, k) => {
      const z = valueAt(src, x, y), key = String(z);
      if (!groups.has(key)) groups.set(key, { z, p: Q0, cells: [] });
      const g = groups.get(key);
      g.p = g.p.add(j.p[i][k]); g.cells.push([i, k]);
    }));
  } catch (e) {
    throw new Error(`Z 的式子「${expr}」算不出来（${e.message}）：用 X、Y 写，比如 X + Y、max(X, Y)、X*Y`);
  }
  const rows = [...groups.values()].filter((g) => !g.p.zero).sort((a, b) => numOf(a.z) - numOf(b.z));
  const cellZ = j.xs.map(() => j.ys.map(() => -1));
  rows.forEach((g, n) => g.cells.forEach(([i, k]) => { cellZ[i][k] = n; }));
  return { rows, cellZ, src };
}
/** E[g(X, Y)]（精确；式子算不出精确值的抛出） */
export function expectOf(j, expr) {
  need(j);
  const src = tidy(expr);
  let sum = Q0;
  j.xs.forEach((x, i) => j.ys.forEach((y, k) => {
    if (j.p[i][k].zero) return;
    const v = evaluateExact(src, { X: x, Y: y, x, y });
    if (!(v instanceof Q)) throw new Error('要是一个数');
    sum = sum.add(v.mul(j.p[i][k]));
  }));
  return sum;
}

// —— 相关系数：ρ² 是分数，ρ 开得尽就是分数，开不尽写成最简根式 ——
function isqrt(n) {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}
// n = s² · t（t 没有平方因子）；太大的不拆（回 null）
function squarePart(n) {
  if (n > 10n ** 12n) return null;
  let s = 1n, t = n;
  for (let f = 2n; f * f <= t; f++) while (t % (f * f) === 0n) { t /= f * f; s *= f; }
  return { s, t };
}
function rhoOf(cov, den2) {
  if (den2.zero) return { rho: null, rhoValue: null, rhoTeX: null };
  if (cov.zero) return { rho: Q0, rhoValue: 0, rhoTeX: '0' };
  const value = cov.toNumber() / Math.sqrt(den2.toNumber());
  const r2 = cov.mul(cov).div(den2); // ρ² = u/v
  const sn = isqrt(r2.n), sd = isqrt(r2.d);
  const neg = cov.cmp(Q0) < 0;
  if (sn * sn === r2.n && sd * sd === r2.d) {
    const rho = new Q(neg ? -sn : sn, sd);
    return { rho, rhoValue: rho.toNumber(), rhoTeX: qTeX(rho) };
  }
  const root = { num: cov, den2 };
  // ρ = ±√(u·v)/v = ±s√t/v
  const part = squarePart(r2.n * r2.d);
  if (!part) return { rho: root, rhoValue: value, rhoTeX: String(Number(value.toPrecision(4))) };
  const k = new Q(part.s, r2.d); // 根号外面的系数
  const top = k.n === 1n ? `\\sqrt{${part.t}}` : `${k.n}\\sqrt{${part.t}}`;
  const tex = `${neg ? '-' : ''}${k.d === 1n ? top : `\\frac{${top}}{${k.d}}`}`;
  return { rho: root, rhoValue: value, rhoTeX: tex };
}

/** 期望、方差、协方差、相关系数。rho：分数；开不尽是 { num: 协方差, den2: DX·DY }（ρ = num / √den2）；有一个是常数时 null */
export function moments(j) {
  const { px, py } = marginals(j);
  const E = (vals, ps, pow = 1) => qSum(vals.map((v, i) => (pow === 2 ? v.mul(v) : v).mul(ps[i])));
  const EX = E(j.xs, px), EY = E(j.ys, py), EX2 = E(j.xs, px, 2), EY2 = E(j.ys, py, 2);
  let EXY = Q0;
  j.xs.forEach((x, i) => j.ys.forEach((y, k) => { EXY = EXY.add(x.mul(y).mul(j.p[i][k])); }));
  const DX = EX2.sub(EX.mul(EX)), DY = EY2.sub(EY.mul(EY)), cov = EXY.sub(EX.mul(EY));
  return { EX, EY, EX2, EY2, EXY, DX, DY, cov, ...rhoOf(cov, DX.mul(DY)) };
}
