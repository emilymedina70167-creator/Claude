// 二次曲面、二次曲线 xᵀAx = c 的线框（space 的 quadric、scene 的 conic）。
// 做法和二次型的正交变换法一样：对称矩阵 A 按特征向量转到主轴 x = Qy，λ₁y₁² + λ₂y₂² + λ₃y₃² = c，
// 按特征值（除以 c 以后）的正负分类，在主轴里参数化成一条条折线，再转回原来的坐标。纯函数，不碰 DOM（tests/quadric.test.js）。

const EPS = 1e-9;

/** 实对称矩阵的特征值和单位特征向量（Jacobi 旋转）：{ values: [λ…], vectors: [[q₁], [q₂]…]（每个是一个特征向量） } */
export function symEig(A) {
  const n = A.length;
  if (!A.every((r) => r.length === n)) throw new Error('要方阵');
  if (!A.every((r, i) => r.every((x, j) => Math.abs(x - A[j][i]) < 1e-9))) throw new Error('二次型的矩阵要对称');
  const a = A.map((r) => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq;
        V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const values = a.map((r, i) => r[i]);
  const vectors = values.map((_, j) => V.map((r) => r[j]));
  return { values, vectors };
}

const sgn = (x) => (Math.abs(x) < EPS ? 0 : x > 0 ? 1 : -1);

/**
 * xᵀAx = c（A 是 3×3 对称矩阵）：{ kind（曲面的名字）, lines: [[[x, y, z]…]…], note }。
 * R：画多大（坐标范围）；曲面伸到无穷远的部分截在 R 以内。没有实点的（虚椭球面）lines 是空的
 */
export function quadricLines(A, c = 1, R = 3, { rings = 7, spokes = 14, pts = 36 } = {}) {
  if (A.length !== 3) throw new Error('quadric 要 3×3 的对称矩阵');
  const { values, vectors } = symEig(A);
  // 两边同乘 −1 让 c ≥ 0；c = 0 时是锥面那一类
  const k = c < 0 ? -1 : 1;
  const lam = values.map((x) => x * k);
  const cc = c * k;
  const toX = (y) => [0, 1, 2].map((r) => vectors[0][r] * y[0] + vectors[1][r] * y[1] + vectors[2][r] * y[2]);
  const P = [], N = [], Z = [];
  lam.forEach((x, i) => (sgn(x) > 0 ? P : sgn(x) < 0 ? N : Z).push(i));
  const lines = [];
  const put = (f, list) => { for (const y of list) lines.push(y.map(toX)); return f; };
  const range = (a, b, m = pts) => Array.from({ length: m + 1 }, (_, t) => a + ((b - a) * t) / m);
  const half = (i) => Math.sqrt(cc / Math.abs(lam[i]));
  const fit = (lim, s) => Math.max(0.05, Math.min(lim, s)); // 参数的上限：截在 R 以内

  if (cc > EPS) {
    if (P.length === 3) {
      const [a, b, h] = [0, 1, 2].map(half);
      const L = [];
      for (const th of range(0, Math.PI, rings + 1).slice(1, -1)) L.push(range(0, 2 * Math.PI).map((ph) => y3([a * Math.sin(th) * Math.cos(ph), b * Math.sin(th) * Math.sin(ph), h * Math.cos(th)])));
      for (const ph of range(0, Math.PI, spokes / 2).slice(0, -1)) L.push(range(0, 2 * Math.PI).map((th) => y3([a * Math.sin(th) * Math.cos(ph), b * Math.sin(th) * Math.sin(ph), h * Math.cos(th)])));
      return put({ kind: '椭球面', lines }, L);
    }
    if (P.length === 2 && N.length === 1) {
      const [i, j] = P, m = N[0];
      const a = half(i), b = half(j), h = half(m);
      const U = fit(Math.acosh(Math.max(1.0001, R / Math.max(a, b))), Math.asinh(R / h));
      const L = [];
      for (const u of range(-U, U, rings - 1)) L.push(range(0, 2 * Math.PI).map((ph) => at(i, a * Math.cosh(u) * Math.cos(ph), j, b * Math.cosh(u) * Math.sin(ph), m, h * Math.sinh(u))));
      for (const ph of range(0, 2 * Math.PI, spokes).slice(0, -1)) L.push(range(-U, U).map((u) => at(i, a * Math.cosh(u) * Math.cos(ph), j, b * Math.cosh(u) * Math.sin(ph), m, h * Math.sinh(u))));
      return put({ kind: '单叶双曲面', lines }, L);
    }
    if (P.length === 1 && N.length === 2) {
      const i = P[0], [j, m] = N;
      const a = half(i), b = half(j), h = half(m);
      const U = fit(Math.acosh(Math.max(1.0001, R / a)), Math.asinh(R / Math.max(b, h)));
      const L = [];
      for (const side of [1, -1]) {
        for (const u of range(0, U, rings - 2).slice(1)) L.push(range(0, 2 * Math.PI).map((ph) => at(i, side * a * Math.cosh(u), j, b * Math.sinh(u) * Math.cos(ph), m, h * Math.sinh(u) * Math.sin(ph))));
        for (const ph of range(0, 2 * Math.PI, spokes).slice(0, -1)) L.push(range(0, U).map((u) => at(i, side * a * Math.cosh(u), j, b * Math.sinh(u) * Math.cos(ph), m, h * Math.sinh(u) * Math.sin(ph))));
      }
      return put({ kind: '双叶双曲面', lines }, L);
    }
    if (P.length === 2 && Z.length === 1) {
      const [i, j] = P, m = Z[0];
      const a = half(i), b = half(j);
      const L = [];
      for (const t of range(-R, R, rings - 1)) L.push(range(0, 2 * Math.PI).map((ph) => at(i, a * Math.cos(ph), j, b * Math.sin(ph), m, t)));
      for (const ph of range(0, 2 * Math.PI, spokes).slice(0, -1)) L.push([at(i, a * Math.cos(ph), j, b * Math.sin(ph), m, -R), at(i, a * Math.cos(ph), j, b * Math.sin(ph), m, R)]);
      return put({ kind: '椭圆柱面', lines }, L);
    }
    if (P.length === 1 && N.length === 1 && Z.length === 1) {
      const i = P[0], j = N[0], m = Z[0];
      const a = half(i), b = half(j);
      const U = fit(Math.acosh(Math.max(1.0001, R / a)), Math.asinh(R / b));
      const L = [];
      for (const side of [1, -1]) {
        for (const t of range(-R, R, rings - 1)) L.push(range(-U, U).map((u) => at(i, side * a * Math.cosh(u), j, b * Math.sinh(u), m, t)));
        for (const u of range(-U, U, spokes / 2)) L.push([at(i, side * a * Math.cosh(u), j, b * Math.sinh(u), m, -R), at(i, side * a * Math.cosh(u), j, b * Math.sinh(u), m, R)]);
      }
      return put({ kind: '双曲柱面', lines }, L);
    }
    if (P.length === 1 && Z.length === 2) {
      const i = P[0], [j, m] = Z;
      const a = half(i);
      const L = [];
      for (const side of [1, -1]) {
        for (const t of range(-R, R, 6)) { L.push([at(i, side * a, j, t, m, -R), at(i, side * a, j, t, m, R)]); L.push([at(i, side * a, j, -R, m, t), at(i, side * a, j, R, m, t)]); }
      }
      return put({ kind: '两个平行平面', lines }, L);
    }
    return { kind: '没有实点', lines: [], note: '标准形的系数（除以右边以后）都不是正的：没有实数点满足它' };
  }
  // c = 0：锥面（两正一负或一正两负）、一条直线、两个相交平面……
  if (P.length && N.length && Z.length === 0) {
    const [i, j] = P.length === 2 ? P : N, m = P.length === 2 ? N[0] : P[0];
    const s = (x) => Math.sqrt(1 / Math.abs(lam[x]));
    const Rr = R / Math.max(s(i), s(j), s(m));
    const L = [];
    for (const side of [1, -1]) {
      for (const r of range(0, Rr, rings - 2).slice(1)) L.push(range(0, 2 * Math.PI).map((ph) => at(i, r * s(i) * Math.cos(ph), j, r * s(j) * Math.sin(ph), m, side * r * s(m))));
      for (const ph of range(0, 2 * Math.PI, spokes).slice(0, -1)) L.push([at(i, 0, j, 0, m, 0), at(i, Rr * s(i) * Math.cos(ph), j, Rr * s(j) * Math.sin(ph), m, side * Rr * s(m))]);
    }
    return put({ kind: '二次锥面', lines }, L);
  }
  return { kind: '退化的情形', lines: [], note: '右边是 0：只有原点、一条直线或一对平面，这里不画' };
}

// 主轴坐标：第 i、j、m 个分量分别是 yi、yj、ym
function at(i, yi, j, yj, m, ym) {
  const y = [0, 0, 0];
  y[i] = yi; y[j] = yj; y[m] = ym;
  return y;
}
const y3 = (y) => y;

/**
 * 平面上的 xᵀAx = c（A 是 2×2 对称矩阵）：{ kind, lines: [[[x, y]…]…], axes: 两个主轴方向 }
 */
export function conicLines(A, c = 1, R = 4, { pts = 72 } = {}) {
  if (A.length !== 2) throw new Error('conic 要 2×2 的对称矩阵');
  const { values, vectors } = symEig(A);
  const k = c < 0 ? -1 : 1;
  const lam = values.map((x) => x * k);
  const cc = c * k;
  const toX = (y) => [vectors[0][0] * y[0] + vectors[1][0] * y[1], vectors[0][1] * y[0] + vectors[1][1] * y[1]];
  const range = (a, b, m = pts) => Array.from({ length: m + 1 }, (_, t) => a + ((b - a) * t) / m);
  const s = lam.map(sgn);
  const half = (i) => Math.sqrt(cc / Math.abs(lam[i]));
  const out = (kind, ys) => ({ kind, lines: ys.map((l) => l.map(toX)), axes: vectors });
  if (cc > EPS) {
    if (s[0] > 0 && s[1] > 0) { const a = half(0), b = half(1); return out('椭圆', [range(0, 2 * Math.PI).map((t) => [a * Math.cos(t), b * Math.sin(t)])]); }
    if (s[0] * s[1] < 0) {
      const i = s[0] > 0 ? 0 : 1, j = 1 - i;
      const a = half(i), b = half(j);
      const U = Math.max(0.05, Math.min(Math.acosh(Math.max(1.0001, R / a)), Math.asinh(R / b)));
      const br = (side) => range(-U, U).map((u) => { const y = [0, 0]; y[i] = side * a * Math.cosh(u); y[j] = b * Math.sinh(u); return y; });
      return out('双曲线', [br(1), br(-1)]);
    }
    if (s.filter((x) => x > 0).length === 1) {
      const i = s[0] > 0 ? 0 : 1, j = 1 - i, a = half(i);
      const ln = (side) => [-R, R].map((t) => { const y = [0, 0]; y[i] = side * a; y[j] = t; return y; });
      return out('两条平行直线', [ln(1), ln(-1)]);
    }
    return { kind: '没有实点', lines: [], axes: vectors };
  }
  if (s[0] * s[1] < 0) {
    // xᵀAx = 0、一正一负：两条相交直线
    const r = Math.sqrt(Math.abs(lam[0]) / Math.abs(lam[1]));
    return out('两条相交直线', [[[-R, -R * r], [R, R * r]], [[-R, R * r], [R, -R * r]]]);
  }
  return { kind: '退化的情形', lines: [], axes: vectors };
}
