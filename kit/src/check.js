// 判分：把学生答案（分数）和标准答案（表达式算出的浮点）比较，认可等价写法
import { isNum, isVec, isMat } from './expr.js';

const EPS = 1e-9;
const N = (x) => Number(x);

// 推断作答形状
export function shapeOf(answer, type) {
  if (type === 'basis' || type === 'vectors') {
    const vs = toVectors(answer);
    return { kind: 'vectors', n: vs[0].length, count: vs.length };
  }
  if (type === 'direction' || type === 'eigvec') return { kind: 'vector', n: answer.length };
  if (isNum(answer)) return { kind: 'number' };
  if (isMat(answer)) return { kind: 'matrix', r: answer.length, c: answer[0].length };
  if (isVec(answer)) return { kind: 'vector', n: answer.length };
  throw new Error('answer 需要是数、向量、矩阵或一组向量');
}

const toVectors = (a) => (isMat(a) ? a : isVec(a) ? [a] : (() => { throw new Error('basis 的答案写成 [[向量1], [向量2]]'); })());

// 返回 {ok, wrong:[{i,j,k}], msg}
export function check(given, answer, type) {
  if (type === 'basis' || type === 'vectors') return checkBasis(given.map((v) => v.map(N)), toVectors(answer));
  if (type === 'direction' || type === 'eigvec') {
    const g = given.map(N);
    if (g.every((x) => Math.abs(x) < EPS)) return { ok: false, msg: '零向量不算：特征向量必须非零。' };
    const ok = rank([g, answer]) === 1;
    return { ok, msg: ok ? (same(g, answer) ? '' : '和参考答案差一个倍数，同样正确。') : '方向不对。' };
  }
  if (isNum(answer)) return { ok: Math.abs(N(given) - answer) < EPS, wrong: [{ i: 0, j: 0 }] };
  if (isMat(answer)) {
    const wrong = [];
    answer.forEach((r, i) => r.forEach((x, j) => { if (Math.abs(N(given[i][j]) - x) > EPS) wrong.push({ i, j }); }));
    return { ok: !wrong.length, wrong, msg: wrong.length ? `有 ${wrong.length} 个元素不对（已标红）。` : '' };
  }
  const wrong = [];
  answer.forEach((x, i) => { if (Math.abs(N(given[i]) - x) > EPS) wrong.push({ i, j: 0 }); });
  return { ok: !wrong.length, wrong, msg: wrong.length ? `有 ${wrong.length} 个分量不对（已标红）。` : '' };
}

function checkBasis(given, ref) {
  const d = rank(ref);
  if (given.some((v) => v.length !== ref[0].length)) return { ok: false, msg: `每个向量应该有 ${ref[0].length} 个分量。` };
  if (given.length !== d) return { ok: false, msg: `向量个数不对：这个空间是 ${d} 维的，基里应该有 ${d} 个向量。` };
  if (rank(given) < given.length) return { ok: false, msg: '这几个向量线性相关，不能作为基。' };
  if (rank([...ref, ...given]) > d) return { ok: false, msg: '有向量不在这个空间里。' };
  return { ok: true, msg: same(given.flat(), ref.flat()) ? '' : '和参考答案不一样，但张成的是同一个空间，同样正确。' };
}

const same = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(N(x) - N(b[i])) < EPS);

// 浮点高斯消元求秩
export function rank(rows) {
  const M = rows.map((r) => r.map(N));
  const R = M.length, C = M[0].length;
  let r = 0;
  for (let c = 0; c < C && r < R; c++) {
    let p = r;
    for (let i = r + 1; i < R; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-9) continue;
    [M[r], M[p]] = [M[p], M[r]];
    for (let i = 0; i < R; i++) {
      if (i === r) continue;
      const f = M[i][c] / M[r][c];
      for (let j = c; j < C; j++) M[i][j] -= f * M[r][j];
    }
    r++;
  }
  return r;
}
