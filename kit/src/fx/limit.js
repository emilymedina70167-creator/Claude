// 数值极限、阶（计划 3，dr-calc-base Task 5 + 审的必改 1、2；纯函数，tests/fx-limit.test.js）。
// 把对的判成错比「判不了」伤害大，所以这里宁可说判不了：
//   - 每一侧取两条步长 h = 0.2·2^(−k)（k = 0…14）和 h = 0.2·3^(−k)（k = 0…8），各用 Neville 外推到 h = 0，
//     两条都收敛、而且彼此对得上才算这个数（cos(π/x) 在第一条上恒为 1、第二条上恒为 −1，只用一条会被骗）；
//   - 最后几个点绝对值一直变大、超过开头的 1000 倍、外推不收敛 → ±∞；
//   - 两侧：都是同一个数才是这个数；一侧 +∞ 一侧 −∞ 是无符号的 ∞（教材写 lim 1/x = ∞）；
//     两侧不同的数、一侧 ±∞ 一侧有限 → 不存在；有一侧判不了就判不了；
//   - x→∞（at=inf）照国内教材是 |x|→∞，两侧都算；+inf、-inf 才是单侧。
// 振荡的（sin(1/x)）、不是 h 的幂级数的（x ln x）外推不稳，报判不了，不猜。
const SEQ_A = Array.from({ length: 15 }, (_, k) => 0.2 * 2 ** -k);
const SEQ_B = Array.from({ length: 9 }, (_, k) => 0.2 * 3 ** -k);
export const LIMIT_EVALS = SEQ_A.length + SEQ_B.length; // 一侧最多求值几次
const TOL = 1e-6; // 收敛：估计误差 ≤ TOL·max(1, |L|)
const AGREE = 1e-6; // 两条步长、两侧对得上
const APART = 1e-4; // 两侧确实不一样（差得更小又对不上：判不了）

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

// 一条步长上的值外推到 h = 0：Neville 表，取相邻两次外推差最小的那一格（Ridders 的做法），回 { value, err }
function extrapolate(hs, ys) {
  let best = null;
  const T = [];
  for (let i = 0; i < ys.length; i++) {
    T[i] = [ys[i]];
    for (let j = 1; j <= i; j++) {
      // P_{i,j}(0)：把 h_{i-j} … h_i 上的插值多项式取在 0 处
      const v = T[i][j - 1] + (T[i][j - 1] - T[i - 1][j - 1]) * hs[i] / (hs[i - j] - hs[i]);
      T[i][j] = v;
      const err = Math.max(Math.abs(v - T[i][j - 1]), Math.abs(v - T[i - 1][j - 1]));
      if (!best || err < best.err) best = { value: v, err };
    }
    // 外推开始变坏（到了浮点抵消的那一段）就停：最后一格比最好的差很多
    if (best && i > 3 && Math.abs(T[i][i] - T[i - 1][i - 1]) > 4 * best.err && best.err < 1e-3) break;
  }
  return best || { value: NaN, err: Infinity };
}

// 一条步长上一直往一个方向变大：+∞ / −∞（回 1 / −1），不是回 0
// 溢出成 ±Infinity 也算（e^(1/h) 到小的 h 就超出浮点了）；没溢出的要像 h 的负次幂那样涨：
// log|f| 对 log h 的斜率 ≤ −0.3，而且最后一个比开头大一千倍——趋向一个大的有限数（1500）的不算
function diverges(pts) {
  const tail = pts.slice(-6);
  if (tail.length < 6) return 0;
  const ys = tail.map((p) => p[1]);
  const sign = Math.sign(ys.at(-1));
  if (!sign || !ys.every((y) => Math.sign(y) === sign)) return 0;
  for (let i = 1; i < ys.length; i++) if (Math.abs(ys[i]) <= Math.abs(ys[i - 1]) && Number.isFinite(ys[i])) return 0;
  if (!Number.isFinite(ys.at(-1))) return sign;
  const [h0, y0] = tail[2], [h1, y1] = tail.at(-1);
  const slope = Math.log(Math.abs(y1) / Math.abs(y0)) / Math.log(h1 / h0);
  return slope <= -0.3 && Math.abs(y1) > 1000 * Math.max(1, Math.abs(pts[0][1])) ? sign : 0;
}

/** 一侧：g(h) 在 h → 0⁺。回 { kind: 'finite' | '+inf' | '-inf' | null, value?, err?, why? } */
function oneSide(g) {
  const run = (hs) => {
    const pts = [];
    for (const h of hs) { let y; try { y = g(h); } catch { y = NaN; } pts.push([h, y]); }
    const ok = pts.filter(([, y]) => fin(y));
    return { hs: ok.map((p) => p[0]), ys: ok.map((p) => p[1]), raw: pts.filter(([, y]) => !Number.isNaN(y)), got: ok.length };
  };
  const A = run(SEQ_A), B = run(SEQ_B);
  const dA = diverges(A.raw), dB = diverges(B.raw);
  if (dA && dA === dB) return { kind: dA > 0 ? '+inf' : '-inf' };
  if (A.got < 6 || B.got < 5) return { kind: null, why: '在这一点附近算不出值' };
  const a = extrapolate(A.hs, A.ys), b = extrapolate(B.hs, B.ys);
  const scale = Math.max(1, Math.abs(a.value));
  if (!(a.err <= TOL * scale && b.err <= TOL * scale)) return { kind: null, why: '算不稳（振荡，或者收敛得太慢）' };
  if (Math.abs(a.value - b.value) > AGREE * scale) return { kind: null, why: '两种步长算出来的不一样（可能在振荡）' };
  return { kind: 'finite', value: (a.value + b.value) / 2, err: Math.max(a.err, b.err, Math.abs(a.value - b.value)) };
}

/**
 * f：(x) => 数。a：一个数，或 'inf'（|x|→∞，两侧）、'+inf'、'-inf'（也收 Infinity / -Infinity，当单侧）。
 * side：'both' | '+' | '-'（a 是数时用）。
 * 回 { kind: 'finite' | '+inf' | '-inf' | 'inf' | 'none' | null, value?, err?, why? }
 */
export function numLimit(f, a, { side = 'both' } = {}) {
  const at = a === Infinity ? '+inf' : a === -Infinity ? '-inf' : a;
  let sides;
  if (at === 'inf') sides = [(h) => f(1 / h), (h) => f(-1 / h)];
  else if (at === '+inf') sides = [(h) => f(1 / h)];
  else if (at === '-inf') sides = [(h) => f(-1 / h)];
  else {
    const x0 = Number(at);
    if (!fin(x0)) return { kind: null, why: '极限的点写错了' };
    sides = side === '+' ? [(h) => f(x0 + h)] : side === '-' ? [(h) => f(x0 - h)] : [(h) => f(x0 + h), (h) => f(x0 - h)];
  }
  const rs = sides.map(oneSide);
  if (rs.length === 1) return rs[0];
  const [p, q] = rs;
  if (p.kind === null || q.kind === null) return { kind: null, why: (p.kind === null ? p : q).why };
  if (p.kind === 'finite' && q.kind === 'finite') {
    const scale = Math.max(1, Math.abs(p.value), Math.abs(q.value));
    const gap = Math.abs(p.value - q.value);
    if (gap <= AGREE * scale) return { kind: 'finite', value: (p.value + q.value) / 2, err: Math.max(p.err, q.err, gap) };
    if (gap > APART * scale) return { kind: 'none', why: `两侧的极限不一样（${short(p.value)} 和 ${short(q.value)}）` };
    return { kind: null, why: '两侧差一点点，页面分不清' };
  }
  if (p.kind === q.kind) return { kind: p.kind };
  if ((p.kind === '+inf' && q.kind === '-inf') || (p.kind === '-inf' && q.kind === '+inf')) return { kind: 'inf' };
  return { kind: 'none', why: '一侧是无穷、另一侧是有限的数' };
}
const short = (v) => String(Number(v.toPrecision(6)));

/**
 * f 在 a 处是几阶无穷小（f ~ c·(x−a)^k）：log|f(a+h)| 对 log h 的斜率，h = 1e-2、1e-3、1e-4，
 * 两段斜率差 ≤ 0.05 才算数。回 { k（不取整：3/2 阶就是 1.5）, ok }
 */
export function orderAt(f, a = 0, { side = '+' } = {}) {
  const s = side === '-' ? -1 : 1;
  const at = (h) => { try { return Math.abs(f(a + s * h)); } catch { return NaN; } };
  const hs = [1e-2, 1e-3, 1e-4];
  const ys = hs.map(at);
  if (!ys.every((y) => fin(y) && y > 0)) return { k: NaN, ok: false };
  const k1 = Math.log(ys[1] / ys[0]) / Math.log(hs[1] / hs[0]);
  const k2 = Math.log(ys[2] / ys[1]) / Math.log(hs[2] / hs[1]);
  return { k: k2, ok: Math.abs(k1 - k2) <= 0.05 };
}
