// 非交换多项式：大写字母是矩阵（乘起来不交换），小写字母和数是标量（交换），E / I 是单位矩阵，O 是零矩阵。
// 舞台上的式子（stage/types/tex.js 的 alg=on）让学生拖项换顺序、合并同类项、展开括号，合不合法由这里判：
// 两个式子展开成「标量系数 × 矩阵字」的和、合并、比较。纯函数，有测试（tests/ncalg.test.js）。
//
// 只判有把握的：AB + BA 不能并成 2AB（矩阵一般不交换）、(A+B)^2 = A^2 + AB + BA + B^2、AE = A、(kE)A = A(kE)。
// 含逆（^-1）、转置（'、^T）、除以不是数的东西、函数（det、tr……）、读不懂的，一律回 'unknown'：判不了就照实说判不了，不猜
// （A^-1 A = E 是对的，可这里的代数里没有逆，说 false 是假话，说 true 是猜）。

// —— 分数（BigInt，精确） ——
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
function q(n, d = 1n) {
  if (d === 0n) throw new Unknown('除以 0');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
const qadd = (a, b) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qmul = (a, b) => q(a.n * b.n, a.d * b.d);
const qneg = (a) => ({ n: -a.n, d: a.d });
const qzero = (a) => a.n === 0n;
const qtext = (a) => (a.d === 1n ? String(a.n) : `${a.n}/${a.d}`);
function qparse(s) {
  const [i, f = ''] = s.split('.');
  return q(BigInt(i + f), 10n ** BigInt(f.length));
}

/** 判不了：带一句为什么（写给读的人） */
class Unknown extends Error {}

// 展开以后最多多少项、次方最多几次（再大就当判不了：一个拖动不该卡住页面）
export const MAX_TERMS = 4000;
export const MAX_POW = 12;
const FUNCS = new Set(['det', 'tr', 'rank', 'rk', 'diag', 'adj', 'sin', 'cos', 'tan', 'exp', 'log', 'ln', 'lim', 'max', 'min']);
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', omega: 'ω', eta: 'η', zeta: 'ζ', kappa: 'κ', pi: 'π' };
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

// —— 读：一串字 → 记号 ——
function tokenize(src) {
  let s = String(src ?? '');
  // LaTeX 里常见的几样：\left( \right) 去掉，\cdot \times 是乘，希腊字母当标量；别的 \命令 读不懂
  s = s.replace(/\\(left|right|big|Big|bigl|bigr|Bigl|Bigr)\b/g, '').replace(/\\(cdot|times)\b/g, '*').replace(/\\[,;!: ]/g, ' ');
  s = s.replace(/\\([A-Za-z]+)/g, (m, w) => {
    if (GREEK[w]) return GREEK[w];
    if (w === 'mathrm' || w === 'mathbf' || w === 'boldsymbol' || w === 'mathit') return '';
    throw new Unknown(`读不懂 \\${w}`);
  });
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/\d/.test(ch)) {
      const m = s.slice(i).match(/^\d+(?:\.\d+)?/);
      out.push({ t: 'num', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      // 一串小写字母是函数名（det、tr……）：判不了。别的字母一个是一个（ab 是 a 乘 b，AB 是 A 乘 B）
      const run = s.slice(i).match(/^[a-z]+/)?.[0] || '';
      if (run.length >= 2 && FUNCS.has(run)) throw new Unknown(`含函数 ${run}，判不了`);
      // 下标：A_1、A_{12}、A1 都是一个名字
      const m = s.slice(i).match(/^[A-Za-z](?:_\{?\d+\}?|\d+)?/);
      out.push({ t: 'sym', v: m[0].replace(/[_{}]/g, '') });
      i += m[0].length;
      continue;
    }
    if (/[α-ωΑ-Ω]/.test(ch)) { out.push({ t: 'sym', v: ch }); i++; continue; }
    if (SUP[ch]) {
      let j = i, d = '';
      while (SUP[s[j]]) d += SUP[s[j++]];
      out.push({ t: 'sup', v: d });
      i = j;
      continue;
    }
    if (ch === '⁻') throw new Unknown('含负次方（逆），判不了');
    if (ch === 'ᵀ' || ch === "'" || ch === '′' || ch === '†') throw new Unknown('含转置，判不了');
    if ('+-−–'.includes(ch)) { out.push({ t: ch === '+' ? '+' : '-' }); i++; continue; }
    if ('*·×⋅'.includes(ch)) { out.push({ t: '*' }); i++; continue; }
    if (ch === '/' || ch === '÷') { out.push({ t: '/' }); i++; continue; }
    if (ch === '^') { out.push({ t: '^' }); i++; continue; }
    if ('([{'.includes(ch)) { out.push({ t: '(' , v: ch }); i++; continue; }
    if (')]}'.includes(ch)) { out.push({ t: ')', v: ch }); i++; continue; }
    throw new Unknown(`读不懂「${ch}」`);
  }
  return out;
}

// —— 读：记号 → 式子的树 ——
// sum：{ t: 'sum', items: [{ sign: 1 | -1, prod }] }；prod：{ t: 'prod', factors: [factor] }
// factor：{ t: 'num', v: 分数 } | { t: 'sym', name } | { t: 'group', body: sum }；都可以带 pow（正整数次方）
function parseTokens(toks) {
  let i = 0;
  const peek = () => toks[i];
  const sum = (close) => {
    const items = [];
    for (;;) {
      // 开头、每个 + - 后面：一串正负号合起来（a - -b）
      let sg = 1;
      while (peek() && (peek().t === '+' || peek().t === '-')) { if (peek().t === '-') sg = -sg; i++; }
      const p = prod();
      if (!p.factors.length) throw new Unknown('有一项是空的');
      items.push({ sign: sg, prod: p });
      const nx = peek();
      if (!nx) break;
      if (nx.t === ')') { if (!close) throw new Unknown('括号对不上'); break; }
      if (nx.t !== '+' && nx.t !== '-') throw new Unknown('读不懂这一串');
    }
    return { t: 'sum', items };
  };
  const prod = () => {
    const factors = [];
    for (;;) {
      const tk = peek();
      if (!tk || tk.t === '+' || tk.t === '-' || tk.t === ')') break;
      if (tk.t === '*') { if (!factors.length) throw new Unknown('乘号前面是空的'); i++; continue; }
      if (tk.t === '/') {
        i++;
        const prev = factors[factors.length - 1];
        const next = factor();
        // 只认数除以数（1/2 A）：除以矩阵、除以字母都是逆，判不了
        if (!prev || prev.t !== 'num' || prev.pow || next.t !== 'num' || next.pow) throw new Unknown('含除法（除以不是数的东西），判不了');
        factors[factors.length - 1] = { t: 'num', v: q(prev.v.n * next.v.d, prev.v.d * next.v.n) };
        continue;
      }
      factors.push(factor());
    }
    return { t: 'prod', factors };
  };
  const factor = () => {
    const tk = toks[i++];
    if (!tk) throw new Unknown('式子没写完');
    let f;
    if (tk.t === 'num') f = { t: 'num', v: qparse(tk.v) };
    else if (tk.t === 'sym') f = { t: 'sym', name: tk.v };
    else if (tk.t === '(') {
      const body = sum(true);
      if (peek()?.t !== ')') throw new Unknown('括号对不上');
      i++;
      f = { t: 'group', body, br: tk.v };
    } else throw new Unknown('读不懂这一串');
    // 次方：^2、^{2}、²；^-1、^T、^n 判不了
    for (;;) {
      const nx = peek();
      if (nx?.t === 'sup') { i++; f = withPow(f, Number(nx.v)); continue; }
      if (nx?.t !== '^') break;
      i++;
      const e = toks[i];
      let n = null;
      if (e?.t === 'num' && /^\d+$/.test(e.v)) { n = Number(e.v); i++; }
      else if (e?.t === '(' && toks[i + 1]?.t === 'num' && /^\d+$/.test(toks[i + 1].v) && toks[i + 2]?.t === ')') { n = Number(toks[i + 1].v); i += 3; }
      else if (e?.t === '-' || (e?.t === '(' && toks[i + 1]?.t === '-')) throw new Unknown('含负次方（逆），判不了');
      else if (e?.t === 'sym' && /^[TH]$/.test(e.v)) throw new Unknown('含转置，判不了');
      else if (e?.t === '(' && toks[i + 1]?.t === 'sym' && /^[TH]$/.test(toks[i + 1].v)) throw new Unknown('含转置，判不了');
      else throw new Unknown('次方只认正整数（A^2）');
      f = withPow(f, n);
    }
    return f;
  };
  const withPow = (f, n) => {
    if (n > MAX_POW) throw new Unknown(`次方太大（${n}），判不了`);
    // (A^2)^3：照次方乘起来
    return f.pow ? { ...f, pow: f.pow * n } : { ...f, pow: n };
  };
  const out = sum(false);
  if (i < toks.length) throw new Unknown('读不懂这一串');
  return out;
}

/** 一串字 → { ok: true, ast } 或 { ok: false, why }（读不懂、含逆、转置、函数：判不了） */
export function parse(src) {
  try {
    if (!String(src ?? '').trim()) return { ok: false, why: '式子是空的' };
    return { ok: true, ast: parseTokens(tokenize(src)) };
  } catch (e) {
    if (e instanceof Unknown) return { ok: false, why: e.message };
    throw e;
  }
}

// —— 展开：多项式 = Map(键 → { c, sc, w })；sc 是标量的乘方（排好的 [名字, 次数]），w 是矩阵字（不交换，照先后）——
const isMatrix = (name) => /^[A-Z]/.test(name);
const scKey = (sc) => sc.map(([v, e]) => (e === 1 ? v : `${v}^${e}`)).join('·');
const keyOf = (m) => `${scKey(m.sc)}|${m.w.join(' ')}`;
const one = () => ({ c: q(1n), sc: [], w: [] });
function mulMono(a, b) {
  const sc = new Map(a.sc);
  for (const [v, e] of b.sc) sc.set(v, (sc.get(v) || 0) + e);
  return { c: qmul(a.c, b.c), sc: [...sc].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)), w: [...a.w, ...b.w], ...(a.mat || b.mat ? { mat: true } : {}) };
}
/** 一个因子 → 几项（不合并：展开括号时学生要看见每一项从哪来） */
function factorTerms(f) {
  let base;
  if (f.t === 'num') base = [{ ...one(), c: f.v }];
  else if (f.t === 'sym') {
    const n = f.name;
    if (n === 'O') base = [];
    // mat：乘进过单位矩阵、矩阵（只剩数时写回成 kE：(A-E)(A-2E) 展开出来的是 2E，不是 2）
    else if (n === 'E' || n === 'I') base = [{ ...one(), mat: true }];
    else if (isMatrix(n)) base = [{ ...one(), w: [n], mat: true }];
    else base = [{ ...one(), sc: [[n, 1]] }];
  } else base = sumTerms(f.body);
  if (f.pow == null) return base;
  let out = [one()];
  for (let k = 0; k < f.pow; k++) out = cross(out, base);
  return out;
}
function cross(xs, ys) {
  if (xs.length * ys.length > MAX_TERMS) throw new Unknown('展开以后项太多，判不了');
  const out = [];
  for (const x of xs) for (const y of ys) out.push(mulMono(x, y));
  return out;
}
function prodTerms(p) {
  let out = [one()];
  for (const f of p.factors) out = cross(out, factorTerms(f));
  return out;
}
function sumTerms(s) {
  const out = [];
  for (const it of s.items) for (const m of prodTerms(it.prod)) out.push(it.sign < 0 ? { ...m, c: qneg(m.c) } : m);
  if (out.length > MAX_TERMS) throw new Unknown('展开以后项太多，判不了');
  return out;
}
/** 几项合并同类项（照第一次出现的先后），系数是 0 的去掉 */
function combine(terms) {
  const map = new Map();
  for (const m of terms) {
    const k = keyOf(m);
    const had = map.get(k);
    if (had) { had.c = qadd(had.c, m.c); if (m.mat) had.mat = true; } else map.set(k, { ...m });
  }
  for (const [k, m] of map) if (qzero(m.c)) map.delete(k);
  return map;
}

const guard = (fn) => { try { return fn(); } catch (e) { if (e instanceof Unknown) return { ok: false, why: e.message }; throw e; } };

/** 一个式子展开、合并以后的多项式：{ ok: true, poly: Map } 或 { ok: false, why } */
export function polyOf(src) {
  const p = typeof src === 'string' ? parse(src) : { ok: true, ast: src };
  if (!p.ok) return p;
  return guard(() => ({ ok: true, poly: combine(sumTerms(p.ast)) }));
}

// —— 严的判法（dr-ncalg-strict，2026-11-18 外部验收时查出来的）：矩阵的式子里单独写一个数（A^2-3A+2 的 2、A-A=0 的 0），
// 宽的判法当成 2E、O 算是相等，可这正是学生「矩阵和数混在一起」的弱点（W19），页面判对等于替学生盖过去。
// 所以默认严：一个式子里有矩阵时，加法的每一项都得是矩阵（带 E / I / O 或矩阵字母）；两边一边是矩阵、一边是数也不相等。
// 外部要宽的判法（比如数和单位矩阵就是想混着写）自己开 { loose: true }。
// 一个节点是不是矩阵：矩阵字母、E / I / O 是；数、小写字母不是；括号看里面；乘积有一个因子是矩阵就是
function typeOf(node, bad) {
  if (node.t === 'num') return false;
  if (node.t === 'sym') return isMatrix(node.name);
  if (node.t === 'group') return typeOf(node.body, bad);
  if (node.t === 'prod') return node.factors.map((f) => typeOf(f, bad)).some(Boolean);
  // 加法：先看每一项，有矩阵的项就整个是矩阵；这时单独的数项就是少了 E（数 0 是零矩阵写成了数）
  const kinds = node.items.map((it) => typeOf(it.prod, bad));
  if (kinds.some(Boolean)) {
    node.items.forEach((it, k) => {
      if (kinds[k]) return;
      const zero = it.prod.factors.length === 1 && it.prod.factors[0].t === 'num' && qzero(it.prod.factors[0].v);
      bad.push(zero ? 'zero' : 'scalar');
    });
  }
  return kinds.some(Boolean);
}
/** 一个式子的类型（严的判法用）：{ ok, matrix, bad: ['scalar' | 'zero'] }；读不懂 { ok: false } */
export function typeCheck(src) {
  const p = typeof src === 'string' ? parse(src) : { ok: true, ast: src };
  if (!p.ok) return p;
  const bad = [];
  const matrix = typeOf(p.ast, bad);
  // 整个式子就是一个数 0、另一边是矩阵：在 equivalent 里比两边时再说
  const zero = !matrix && p.ast.items.length === 1 && p.ast.items[0].prod.factors.length === 1 && p.ast.items[0].prod.factors[0].t === 'num' && qzero(p.ast.items[0].prod.factors[0].v);
  return { ok: true, matrix, bad, zero };
}
const BAD_TEXT = { scalar: '常数项少了 E：矩阵和数不能直接相加（数 k 要写成 kE）', zero: '零矩阵写成了数 0：要写 O' };
/** 严的判法下为什么不相等（类型对不上）：一句话；类型没问题是 null */
export function strictWhy(a, b) {
  const ta = typeCheck(a), tb = typeCheck(b);
  if (!ta.ok || !tb.ok) return null;
  for (const t of [ta, tb]) if (t.bad.length) return BAD_TEXT[t.bad[0]];
  if (ta.matrix !== tb.matrix) return (ta.matrix ? tb : ta).zero ? BAD_TEXT.zero : '一边是矩阵、一边是数：两样东西不相等';
  return null;
}

/**
 * 两个式子数学上相等吗（对所有矩阵、所有标量都成立）：true / false / 'unknown'（含逆、转置、函数、读不懂）。
 * 矩阵不交换：AB + BA 和 2AB 不相等；标量、单位矩阵和谁都交换：kA = Ak、(kE)A = A(kE)、AE = A。
 * 默认严（strictWhy）：矩阵的式子里单独的数不当 kE、数 0 不当 O；{ loose: true } 照宽的判法
 */
export function equivalent(a, b, { loose = false } = {}) {
  const pa = polyOf(a), pb = polyOf(b);
  if (!pa.ok || !pb.ok) return 'unknown';
  if (!loose && strictWhy(a, b)) return false;
  const d = combine([...pa.poly.values(), ...[...pb.poly.values()].map((m) => ({ ...m, c: qneg(m.c) }))]);
  return d.size === 0;
}

/** 不相等的原因（equivalent 回 false 时写给读的人）：类型对不上的那一句，或「展开、合并以后不一样」；相等或判不了是 null */
export function whyNot(a, b, opts = {}) {
  const r = equivalent(a, b, opts);
  if (r !== false) return null;
  return (!opts.loose && strictWhy(a, b)) || '展开、合并同类项以后两边不一样';
}

/** 判不了的原因（equivalent 回 'unknown' 时写给读的人）；判得了是 null */
export function unknownWhy(a, b) {
  for (const x of [a, b]) { const p = polyOf(x); if (!p.ok) return p.why; }
  return null;
}

// —— 写回成字 ——
/** 矩阵字写成字：连着一样的写成次方（A A B → A^2B） */
function wordText(w) {
  const out = [];
  for (let i = 0; i < w.length;) {
    let j = i;
    while (j < w.length && w[j] === w[i]) j++;
    out.push(j - i > 1 ? `${w[i]}^${j - i}` : w[i]);
    i = j;
  }
  return out.join('');
}
/** 一项写成字（不带前面的正负号）：系数 1 不写，标量在前、矩阵在后，只有系数时写数 */
export function monoText(m, { sign = false } = {}) {
  const neg = m.c.n < 0n;
  const c = neg ? qneg(m.c) : m.c;
  // 乘进过矩阵、只剩标量的一项（2E、kE）：E 写出来
  const body = `${scKey(m.sc).replace(/·/g, '')}${wordText(m.w)}${m.mat && !m.w.length ? 'E' : ''}`;
  const cs = qtext(c);
  const head = body ? (cs === '1' ? '' : cs.includes('/') ? `(${cs})` : cs) : cs;
  return `${sign && neg ? '-' : ''}${head}${body}`;
}
/** 多项式写成字：A^2 + AB - BA - B^2；零是 O（有矩阵时）或 0 */
export function polyText(poly) {
  const ms = [...(poly?.values?.() || [])];
  if (!ms.length) return '0';
  return ms.map((m, i) => { const t = monoText(m); const neg = m.c.n < 0n; return i ? `${neg ? ' - ' : ' + '}${t}` : `${neg ? '-' : ''}${t}`; }).join('');
}
/** 展开、合并以后写成字（判不了是 null） */
export function expandText(src) {
  const p = polyOf(src);
  return p.ok ? polyText(p.poly) : null;
}

// —— 舞台的式子要的：一项一项拆开、展开一项、同类项 ——
/** 式子的树写回成字（读进来的样子，括号照写） */
export function astText(node) {
  if (node.t === 'sum') return node.items.map((it, i) => `${i ? (it.sign < 0 ? ' - ' : ' + ') : it.sign < 0 ? '-' : ''}${astText(it.prod)}`).join('');
  if (node.t === 'prod') {
    // 数后面跟数要隔开（2·3）；别的挨着写
    return node.factors.map((f, i) => `${i && f.t === 'num' && node.factors[i - 1].t === 'num' ? '·' : ''}${astText(f)}`).join('');
  }
  const pw = node.pow != null ? `^${node.pow}` : '';
  if (node.t === 'num') return node.pow != null || node.v.d !== 1n ? `(${qtext(node.v)})${pw}` : `${qtext(node.v)}`;
  if (node.t === 'sym') return `${node.name}${pw}`;
  return `(${astText(node.body)})${pw}`;
}
/**
 * 一个式子拆成项：[{ sign, text, factors: [字] }]（顶层的加减分开，每一项的因子分开）。读不懂是 null
 */
export function splitTerms(src) {
  const p = parse(src);
  if (!p.ok) return null;
  return p.ast.items.map((it) => ({ sign: it.sign, text: astText(it.prod), factors: it.prod.factors.map((f) => astText({ t: 'prod', factors: [f] })) }));
}
/**
 * 展开一项（只展开这一项里的括号和次方，不合并：学生要看见每一项从哪来）：[{ sign, text }]，
 * 每一项的字照「系数、标量、矩阵」写（A·A 写成 A^2）。判不了是 null
 */
export function expandTerm(src) {
  const p = parse(src);
  if (!p.ok) return null;
  return guard(() => sumTerms(p.ast).filter((m) => !qzero(m.c)).map((m) => ({ sign: m.c.n < 0n ? -1 : 1, text: monoText(m) })));
}
/**
 * 两项是不是同类项（标量和矩阵字都一样，只差系数）：true / false / 'unknown'。
 * 不是一项（还有括号没展开、展开了是好几项）的不算：false，why 写为什么
 */
export function likeTerms(a, b) {
  const pa = polyOf(a), pb = polyOf(b);
  if (!pa.ok || !pb.ok) return { like: 'unknown', why: pa.why || pb.why };
  if (pa.poly.size !== 1 || pb.poly.size !== 1) return { like: false, why: '还有括号没展开（展开了不止一项），先展开再合并' };
  const [ma] = pa.poly.values(), [mb] = pb.poly.values();
  if (keyOf(ma) === keyOf(mb)) return { like: true, sum: { ...ma, c: qadd(ma.c, mb.c) } };
  // 字母一样、先后不一样：矩阵乘法不交换（AB 和 BA）
  const same = [...ma.w].sort().join(' ') === [...mb.w].sort().join(' ') && scKey(ma.sc) === scKey(mb.sc);
  return { like: false, why: same ? `${wordText(ma.w)} 和 ${wordText(mb.w)} 不是同类项：矩阵乘法不交换，先后不一样就是两样东西` : `${monoText({ ...ma, c: q(1n) })} 和 ${monoText({ ...mb, c: q(1n) })} 不是同类项` };
}
/** 合并两项以后的那一项写成字（带正负号）：likeTerms 的 sum；系数是 0 写 0 */
export function mergedText(sum) {
  return qzero(sum.c) ? '0' : monoText(sum, { sign: true });
}

/** 写成 LaTeX（给 KaTeX 画）：(1/2) → \tfrac{1}{2}，^2 → ^{2}，数和数之间的 · 写 \cdot，别的乘号去掉 */
export function toTex(src) {
  return String(src ?? '')
    .replace(/\((\d+)\/(\d+)\)/g, '\\tfrac{$1}{$2}')
    .replace(/\^(\d+)/g, '^{$1}')
    .replace(/·/g, ' \\cdot ')
    .replace(/\*/g, '');
}
