// 练习题生成器：题目由代码随机构造，答案由代码算出，保证正确、数字干净
import { mul, det, valueTeX, numTeX } from './expr.js';
import { SORT_GENERATORS } from './sorting.js';

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const nz = (a, b) => { let x; do x = rnd(a, b); while (x === 0); return x; };
const mat = (r, c, a = -3, b = 3) => Array.from({ length: r }, () => Array.from({ length: c }, () => rnd(a, b)));
const vec = (n, a = -3, b = 3) => { let v; do v = Array.from({ length: n }, () => rnd(a, b)); while (v.every((x) => x === 0)); return v; };
const T = valueTeX;
const paren = (x) => (x < 0 ? `(${numTeX(x)})` : numTeX(x));
const col = (M, j) => M.map((r) => r[j]);

export const GENERATORS = {
  // 矩阵乘向量
  matvec(level = 1) {
    const [r, c] = level >= 2 ? [[2, 3], [3, 2], [3, 3]][rnd(0, 2)] : [2, 2];
    const A = mat(r, c), x = vec(c);
    const ans = mul(A, x);
    const rows = A.map((row, i) => `(A\\mathbf x)_${i + 1} &= ${row.map((a, j) => `${paren(a)}\\cdot ${paren(x[j])}`).join(' + ')} = ${numTeX(ans[i])}`).join(' \\\\ ');
    const cols = `A\\mathbf x = ${x.map((xj, j) => `${paren(xj)}${T(col(A, j))}`).join(' + ')} = ${T(ans)}`;
    return {
      q: `计算 $A\\mathbf x$，其中 $A = ${T(A)}$，$\\mathbf x = ${T(x)}$。`,
      before: 'A\\mathbf x =',
      answer: ans,
      explain: `**按行算**（每一行和 $\\mathbf x$ 做点积）：\n$$\\begin{aligned} ${rows} \\end{aligned}$$\n**按列看**（列的线性组合）：\n$$${cols}$$`,
    };
  },
  // 已知基向量去向，写出矩阵
  columns(level = 1) {
    const n = level >= 2 ? 3 : 2;
    let A;
    do A = mat(n, n); while (Math.abs(det(A)) < 1e-9);
    const names = n === 2 ? ['\\hat\\imath', '\\hat\\jmath'] : ['\\mathbf e_1', '\\mathbf e_2', '\\mathbf e_3'];
    const maps = names.map((e, j) => `$${e} \\mapsto ${T(col(A, j))}$`).join('，');
    return {
      q: `一个线性变换把 ${maps}。写出它的矩阵 $A$。`,
      before: 'A =',
      answer: A,
      explain: `矩阵的第 $j$ 列就是第 $j$ 个基向量变换后的位置，所以把这几个向量按顺序**竖着排成列**：$A = ${T(A)}$。`,
    };
  },
  // 已知 b 是列的组合，反求 x
  combo(level = 1) {
    const n = level >= 2 ? 3 : 2;
    const A = mat(n, n), x = vec(n);
    const combo = x.map((xj, j) => `${xj === 1 ? '' : xj === -1 ? '-' : numTeX(xj)}\\mathbf a_${j + 1}`).join(' + ').replace(/\+ -/g, '- ');
    return {
      q: `设 $A = ${T(A)}$，它的列记作 $\\mathbf a_1, \\dots, \\mathbf a_${n}$。找一个 $\\mathbf x$，使 $A\\mathbf x = ${combo}$。`,
      before: '\\mathbf x =',
      answer: x,
      explain: `$A\\mathbf x = x_1\\mathbf a_1 + \\cdots + x_${n}\\mathbf a_${n}$，所以组合系数就是 $\\mathbf x$ 的分量：$\\mathbf x = ${T(x)}$。不需要真的去乘。`,
    };
  },
  det2() {
    const A = mat(2, 2, -5, 5);
    const d = det(A);
    return {
      q: `计算 $\\det ${T(A)}$。`,
      before: '\\det A =',
      answer: d,
      explain: `$ad - bc = ${paren(A[0][0])}\\cdot${paren(A[1][1])} - ${paren(A[0][1])}\\cdot${paren(A[1][0])} = ${numTeX(d)}$。`,
    };
  },
  matmul(level = 1) {
    const [m, k, n] = level >= 2 ? [2, 3, 2] : [2, 2, 2];
    const A = mat(m, k), B = mat(k, n);
    const C = mul(A, B);
    return {
      q: `计算 $AB$，其中 $A = ${T(A)}$，$B = ${T(B)}$。`,
      before: 'AB =',
      answer: C,
      explain: `$(AB)_{ij}$ = $A$ 的第 $i$ 行 · $B$ 的第 $j$ 列。也可以按列看：$AB$ 的第 $j$ 列 = $A$ 乘 $B$ 的第 $j$ 列。\n$$AB = ${T(C)}$$`,
    };
  },
  // 求零空间的一组基（构造成 1 个自由变量）
  nullspace() {
    const a = nz(-2, 2), b = nz(-2, 2);
    const v = [a, b, 1];
    // 两行都与 v 正交且线性无关
    let rows;
    do {
      const r1 = vec(3, -2, 2), r2 = vec(3, -2, 2);
      rows = [r1, r2].map((r) => [r[0], r[1], -(r[0] * a + r[1] * b)]);
    } while (Math.abs(rows[0][0] * rows[1][1] - rows[0][1] * rows[1][0]) < 1e-9);
    return {
      q: `求 $A = ${T(rows)}$ 的零空间 $\\operatorname{Nul}A$ 的一组基。`,
      type: 'basis',
      answer: [v],
      explain: `行化简后有 1 个自由变量，零空间是一条过原点的直线，方向是 $${T(v)}$$（它的任何非零倍数都可以）。`,
    };
  },
};

Object.assign(GENERATORS, SORT_GENERATORS);

export function generate(type, level) {
  const g = GENERATORS[type];
  if (!g) throw new Error(`没有「${type}」题型，可用：${Object.keys(GENERATORS).join(', ')}`);
  // gen 是题型名；type 留给作答类型（basis、array 等），两者不能混用
  return { type, ...g(level), gen: type };
}
