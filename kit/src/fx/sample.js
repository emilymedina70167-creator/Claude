// 实数取点判函数式相等（计划 3，dr-calc-base 第二节 2.2；纯函数，tests/fx-sample.test.js）。
// 含 x 的式子写法千变万化（2sin x cos x、sin 2x），化简比对做不全，所以在定义域里随机取点比值：
//   - 同一个种子（按题目的写法定）：刷新、外部和学生看到的同一组点；
//   - 标准答案在这一点没定义、不是有限数、太大（> 1e8）的点跳过，接着取，直到 16 个有效点（最多试 200 个），不到 6 个就「页面判不了」；
//   - 标准答案有定义、学生的式子没定义的点算不对（ln x 在 (−3, 3) 上不是 ln|x|）；
//   - 只有一个点对不上时，在它旁边再取两个点，还对不上才算错（防浮点抵消碰巧落在一个点上：把对的判成错比判不了伤害大）。
// 判不了一律 ok: null，不当成对。
import { parse, evaluate } from '../expr.js';
import { toFloat } from '../exact.js';

export const DEFAULT_RANGE = { lo: -3, hi: 3, openLo: true, openHi: true };
export const WANT_POINTS = 16;
export const MIN_POINTS = 6;
export const MAX_TRIES = 200;
const TOO_BIG = 1e8;
const TOL = 1e-7;

const numOf = (t) => {
  const s = String(t).trim().replace(/[−–]/g, '-').replace(/∞/g, 'inf').replace(/π/g, 'pi');
  if (/^\+?inf$/i.test(s)) return Infinity;
  if (/^-inf$/i.test(s)) return -Infinity;
  const v = evaluate(s);
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`「${t}」不是一个数`);
  return v;
};

/** 「x in (0, 1)」「x in [0, inf)」「x in (0,1), a in [1,3]」 → [{ name, lo, hi, openLo, openHi }]；写错抛中文原因 */
export function parseDomain(text) {
  const out = [];
  const src = String(text ?? '').trim();
  if (!src) return out;
  const re = /([A-Za-z_]\w*)\s*(?:in|∈)\s*([([])\s*([^,;，；\])]+?)\s*[,，]\s*([^,;，；\])]+?)\s*([)\]])/g;
  let m, rest = src;
  while ((m = re.exec(src))) {
    const lo = numOf(m[3]), hi = numOf(m[4]);
    if (!(lo < hi)) throw new Error(`${m[1]} 的范围写反了或是空的：${m[0]}（左边要比右边小）`);
    out.push({ name: m[1], lo, hi, openLo: m[2] === '(' || lo === -Infinity, openHi: m[5] === ')' || hi === Infinity });
    rest = rest.replace(m[0], '');
  }
  if (rest.replace(/[\s,，;；]/g, '')) throw new Error(`范围的写法：x in (0, 1)、x in [0, inf)，几个变量用逗号隔开（看不懂「${rest.trim().slice(0, 20)}」）`);
  return out;
}

/** 种子随机数（同一道题每次取的点一样） */
export function rng(seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}

// 一个变量取一个值：有限区间均匀取（离端点留 2%）；(a, inf) 取 a + 10^U(−2, 1.5)；(−inf, b) 对称；(−inf, inf) 取 ±10^U(−2, 1.5)
function draw(d, r) {
  const far = () => 10 ** (-2 + 3.5 * r());
  if (Number.isFinite(d.lo) && Number.isFinite(d.hi)) return d.lo + (0.02 + 0.96 * r()) * (d.hi - d.lo);
  if (Number.isFinite(d.lo)) return d.lo + far();
  if (Number.isFinite(d.hi)) return d.hi - far();
  return (r() < 0.5 ? -1 : 1) * far();
}

/**
 * 取点：每个实数变量按它的范围取，整数变量（ints：[{ name, values }]）轮流取。
 * valid(pt) 回 false 的点不算，接着取，直到 n 个有效点或试满 maxTries。回 { points, tried }
 */
export function samplePoints(domain, { seed = 'fx', n = WANT_POINTS, valid = () => true, maxTries = MAX_TRIES, ints = [] } = {}) {
  const r = rng(seed);
  const points = [];
  let tried = 0;
  while (points.length < n && tried < maxTries) {
    const pt = {};
    for (const d of domain) pt[d.name] = draw(d, r);
    for (const f of ints) pt[f.name] = f.values[(tried + points.length) % f.values.length];
    tried++;
    if (valid(pt)) points.push(pt);
  }
  return { points, tried };
}

// 在实数上求值（弧度）。' 是求导、∫ 是原函数：fx/diff.js 接上（useDeriver）以后先把它们换掉再求值
let deriver = null;
export function useDeriver(fn) { deriver = fn; }
export function fxEval(ast, vars) {
  const node = typeof ast === 'string' ? parse(ast) : ast;
  return evaluate(deriver ? deriver(node, vars) : node, vars);
}

const hasCall = (n, name) => !!n && ((n.t === 'call' && n.name === name) || ['a', 'b'].some((k) => hasCall(n[k], name)) || (n.args || n.items || []).some((m) => hasCall(m, name)));
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const flat = (v) => (Array.isArray(v) ? v.flat(Infinity) : [v]);
const usable = (v) => flat(v).every((x) => isFiniteNum(x) && Math.abs(x) <= TOO_BIG);
const close = (a, b, scale = 0) => {
  const x = flat(a), y = flat(b);
  return x.length === y.length && x.every((p, i) => Number.isFinite(p) && Number.isFinite(y[i]) && Math.abs(p - y[i]) <= TOL * Math.max(1, Math.abs(p), Math.abs(y[i]), scale));
};
export const showNum = (v) => (Array.isArray(v) ? `[${v.map(showNum).join(', ')}]` : !isFiniteNum(v) ? String(v) : String(Number(v.toPrecision(4))));
const at = (pt) => Object.entries(pt).map(([k, v]) => `${k} = ${showNum(v)}`).join(', ');

export function floatScope(scope) {
  const out = {};
  for (const [k, v] of Object.entries(scope || {})) { try { out[k] = toFloat(v); } catch { out[k] = v; } }
  return out;
}

/**
 * 比两个函数式。expected / given：表达式原文或语法树（given 是学生的、读好的）。
 * domain：parseDomain 的结果（变量都在这里）；ints：整数变量 [{ name, values }]；scope：题里的量；
 * upToConst：两个式子差一个常数也算对（不定积分），回的 shift 是那个常数。
 * 回 { ok: true | false | null, msg（给学生看，可带 $TeX$）, note（进作答记录）, checked, bad: [{ at, want, got, err }] }
 */
export function compareFx(expected, given, { domain = [], ints = [], scope = {}, seed = 'fx', upToConst = false, allowPrime = false } = {}) {
  const e = typeof expected === 'string' ? parse(expected) : expected;
  const g = typeof given === 'string' ? parse(given) : given;
  // 学生的答案里写求导符号（把题目抄一遍加一撇）不算：要把导数算出来。derive 的推导一行行写 ' 是允许的（allowPrime）
  if (!allowPrime && hasCall(g, 'T') && domain.length) return { ok: false, msg: "答案里不能写求导的 '：把导数算出来写。", note: "答案里写了求导的 '（没算出来）", checked: 0, bad: [] };
  const base = floatScope(scope);
  const val = (ast, pt) => { try { return fxEval(ast, { ...base, ...pt }); } catch { return NaN; } };
  const { points } = samplePoints(domain, { seed, ints, valid: (pt) => usable(val(e, pt)) });
  if (points.length < MIN_POINTS) {
    return { ok: null, msg: '页面判不了：标准答案在给的范围里取不到足够的点，待外部核。', note: `实数取点只取到 ${points.length} 个有定义的点，页面判不了`, checked: points.length, bad: [] };
  }
  let shift = null;
  const diffAt = (pt) => {
    const w = val(e, pt), v = val(g, pt);
    if (!usable(v)) return { pt, want: w, got: v, err: '没有定义' };
    if (upToConst) {
      const d = flat(v)[0] - flat(w)[0];
      if (shift === null) shift = d;
      return close(flat(v)[0] - shift, w, Math.abs(shift)) ? null : { pt, want: w, got: v };
    }
    return close(v, w) ? null : { pt, want: w, got: v };
  };
  const bad = [];
  for (const pt of points) {
    const d = diffAt(pt);
    if (!d) continue;
    // 只在这一点对不上：旁边再看两点（都要标准答案有定义），都对得上就当是这一点的浮点抵消
    if (!d.err && bad.length === 0) {
      const near = domain.flatMap((dm) => [-1, 1].map((s) => ({ ...pt, [dm.name]: pt[dm.name] * (1 + s * 1e-3) + s * 1e-6 })));
      const ok = near.filter((q) => usable(val(e, q))).map(diffAt);
      if (ok.length >= 2 && ok.every((x) => x === null)) continue;
    }
    bad.push(d);
  }
  const checked = points.length;
  if (!bad.length) return { ok: true, msg: '', note: '', checked, bad, ...(upToConst ? { shift } : {}) };
  const b = bad[0];
  const where = `$${at(b.pt).replace(/, /g, ',\\ ')}$ 时`;
  const msg = b.err
    ? `${where}你的式子没有定义，答案在那里是 $${showNum(b.want)}$（按题给的范围比）。`
    : upToConst ? `你的式子和答案差的不是一个常数：${where}你的式子得 $${showNum(b.got)}$，答案（差一个常数以后）该是 $${showNum(flat(b.want)[0] + shift)}$。`
      : `${where}你的式子得 $${showNum(b.got)}$，应该是 $${showNum(b.want)}$。`;
  const note = `实数取点：${checked} 个点里 ${bad.length} 个对不上（${at(b.pt)} 时${b.err ? '学生的式子没有定义' : `得 ${showNum(b.got)}，该是 ${showNum(b.want)}`}）`;
  return { ok: false, msg, note, checked, bad: bad.map((x) => ({ at: x.pt, want: x.want, got: x.got, err: x.err })) };
}
