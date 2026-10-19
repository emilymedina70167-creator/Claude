// 含 n 的式子作答（纯函数，有测试 tests/formula.test.js）：
// 学生写 (-1)^(n-1)A、3^(n-1)·A 这类答案，页面代几组 n（和题里的量）进去和标准答案比，
// 写法不同但等价的算对；不对时指出在哪个 n 上对不上。
//   normalizeFormula：学生的写法 → 表达式（补乘号、上标、希腊字母、连写的名字拆开）
//   formulaTeX：表达式 → TeX（输入框下面的预览，学生看得到自己写的是什么）
//   compareFormula：代值比较
import { parse } from './expr.js';
import { calcValue, exactTeX, isQ, isQMat, toFloat, Q } from './exact.js';

// 学生能用的函数（和 expr.js / exact.js 一致的常用那些）
export const FORMULA_FUNCS = ['tr', 'det', 'rank', 'inv', 'T', 'sqrt', 'abs', 'dot', 'norm', 'choose', 'fact'];
const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', λ: 'lambda', μ: 'mu', θ: 'theta', ξ: 'xi', η: 'eta' };
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n', '⁻': '-', '⁺': '+' };

/**
 * 学生写的式子 → 能交给 expr.js / exact.js 的表达式。names：式子里能用的量（n、A、alpha……）。
 * 认：省略乘号（3A、2n、(n-1)A、nA）、·×÷−、上标（A²、3ⁿ⁻¹）、ᵀ 和 ^T（转置）、希腊字母（α → alpha）、
 * 函数后面直接跟名字（trA → tr(A)）。看不懂时抛出中文原因
 */
export function normalizeFormula(text, { names = [], funcs = FORMULA_FUNCS } = {}) {
  const known = new Set(names);
  const fn = new Set(funcs);
  let s = String(text ?? '').trim();
  if (!s) throw new Error('还没写式子');
  s = s.replace(/[−–—]/g, '-').replace(/[×·∙⋅]/g, '*').replace(/÷/g, '/').replace(/（/g, '(').replace(/）/g, ')').replace(/［/g, '[').replace(/］/g, ']').replace(/，/g, ',');
  s = s.replace(/ᵀ/g, "'");
  // 连着的上标字符：A²³ → A^(23)，3ⁿ⁻¹ → 3^(n-1)
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁻⁺]+/g, (m) => `^(${[...m].map((c) => SUP[c]).join('')})`);
  s = s.replace(/[αβγδλμθξη]/g, (c) => (known.has(GREEK[c]) || !known.has(c) ? ` ${GREEK[c]} ` : c));
  const toks = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z_0-9]*)|(\*\*|[-+*/^()[\],'|]))/y;
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new Error(`看不懂「${s.slice(i, i + 6)}」`);
    i = re.lastIndex;
    if (m[1] !== undefined) toks.push({ k: 'num', v: m[1] });
    else if (m[2] !== undefined) toks.push(...splitName(m[2], known, fn));
    else toks.push({ k: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  // ^T：转置（T 不是题里的量时）
  for (let k = 0; k + 1 < toks.length; k++) {
    if (toks[k].v === '^' && toks[k + 1].v === 'T' && toks[k + 1].k !== 'num' && !known.has('T')) { toks.splice(k, 2, { k: 'op', v: "'" }); }
  }
  // 函数后面直接跟名字或数：trA → tr(A)
  for (let k = 0; k + 1 < toks.length; k++) {
    if (toks[k].k === 'fn' && toks[k + 1].v !== '(' && (toks[k + 1].k === 'name' || toks[k + 1].k === 'num')) {
      toks.splice(k + 1, 1, { k: 'op', v: '(' }, toks[k + 1], { k: 'op', v: ')' });
    }
  }
  // 省略的乘号
  const out = [];
  toks.forEach((t, k) => {
    const prev = toks[k - 1];
    const endsValue = prev && (prev.k === 'num' || prev.k === 'name' || prev.v === ')' || prev.v === ']' || prev.v === "'");
    const startsValue = t.k === 'num' || t.k === 'name' || t.k === 'fn' || t.v === '(' || t.v === '[';
    if (endsValue && startsValue) out.push('*');
    out.push(t.v);
  });
  const src = out.join(' ').replace(/ ' /g, "' ").replace(/ '$/, "'");
  try { parse(src); } catch (e) { throw new Error(`式子不完整或写错了：${e.message}`); }
  return src;
}

// 一个不认识的名字：试着拆成认识的几个（nA → n、A；trA → tr、A）；拆不开就报错
function splitName(w, known, fn) {
  if (known.has(w)) return [{ k: 'name', v: w }];
  if (fn.has(w)) return [{ k: 'fn', v: w }];
  const all = [...known, ...fn].sort((a, b) => b.length - a.length);
  const memo = new Map();
  const go = (s) => {
    if (!s) return [];
    if (memo.has(s)) return memo.get(s);
    let best = null;
    for (const n of all) {
      if (!s.startsWith(n)) continue;
      const rest = go(s.slice(n.length));
      if (rest) { best = [{ k: fn.has(n) && !known.has(n) ? 'fn' : 'name', v: n }, ...rest]; break; }
    }
    memo.set(s, best);
    return best;
  };
  const parts = go(w);
  if (parts) return parts;
  const list = [...known].filter((x) => x.length <= 8);
  throw new Error(`不认识「${w}」：式子里能用 ${list.join('、') || '题里给的量'}${fn.size ? `，以及 ${[...fn].filter((f) => f !== 'T').slice(0, 5).join('、')} 这些函数` : ''}`);
}

// —— 表达式 → TeX（预览）——
const TEX_NAME = { alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta', lambda: '\\lambda', mu: '\\mu', theta: '\\theta', xi: '\\xi', eta: '\\eta' };
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 2.5, '^': 3 };

export function formulaTeX(src) {
  return tex(typeof src === 'string' ? parse(src) : src);
}

function prec(n) {
  if (n.t === 'bin') return PREC[n.op] ?? 0;
  if (n.t === 'neg') return PREC.neg;
  if (n.t === 'num' && n.v < 0) return PREC.neg;
  return 9;
}
const wrap = (n, min) => (prec(n) < min ? `\\left(${tex(n)}\\right)` : tex(n));
const numTex = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(8))));

function tex(n) {
  switch (n.t) {
    case 'num': return numTex(n.v);
    case 'var': return TEX_NAME[n.name] || (n.name.length > 1 ? `\\mathrm{${n.name.replace(/_/g, '\\_')}}` : n.name);
    case 'neg': return `-${wrap(n.a, PREC.neg + 0.1)}`;
    case 'list': {
      const rows = n.items.every((x) => x.t === 'list') ? n.items.map((r) => r.items.map(tex).join(' & ')) : n.items.map(tex);
      return `\\begin{bmatrix}${rows.join(' \\\\ ')}\\end{bmatrix}`;
    }
    case 'call': {
      const args = n.args.map(tex).join(', ');
      if (n.name === 'T' || n.name === 'transpose') return `{${wrap(n.args[0], 9)}}^{\\mathrm T}`;
      if (n.name === 'inv') return `{${wrap(n.args[0], 9)}}^{-1}`;
      if (n.name === 'sqrt') return `\\sqrt{${args}}`;
      if (n.name === 'abs' || n.name === 'norm') return `\\left|${args}\\right|`;
      if (n.name === 'det') return `\\det\\left(${args}\\right)`;
      return `\\operatorname{${n.name}}\\left(${args}\\right)`;
    }
    case 'bin': {
      const p = PREC[n.op];
      if (n.op === '+') return `${wrap(n.a, p)} + ${wrap(n.b, p)}`;
      if (n.op === '-') return `${wrap(n.a, p)} - ${wrap(n.b, p + 0.1)}`;
      if (n.op === '/') return `\\frac{${tex(n.a)}}{${tex(n.b)}}`;
      if (n.op === '^') return `{${wrap(n.a, 9)}}^{${tex(n.b)}}`;
      if (n.op === '*') {
        // 两个数相乘写 ·，别的直接挨着写（3A、(n-1)A）
        const a = wrap(n.a, p), b = wrap(n.b, p + 0.1);
        const dot = startsWithDigit(n.b) || n.b.t === 'neg';
        return `${a}${dot ? ' \\cdot ' : '\\,'}${b}`;
      }
      return `${tex(n.a)} ${{ '<': '<', '<=': '\\le', '>': '>', '>=': '\\ge', '==': '=', '!=': '\\ne' }[n.op] || n.op} ${tex(n.b)}`;
    }
  }
  return '?';
}
function startsWithDigit(n) {
  if (n.t === 'num') return true;
  if (n.t === 'bin') return n.op === '^' || n.op === '*' ? startsWithDigit(n.a) : false;
  return false;
}

/**
 * formula: 字段 → 要代的值。"n" → n = 1…6；"n=0..5" → n = 0…5；"n, k" → 两个都代（各取几组）。
 * 返回 [{ name, values }]；写错抛出中文原因
 */
// 作者写的希腊字母（formula: λ、answer: (λ-1)^2）换成名字，和学生输入的读法一致（λ 读成 lambda）
const greekNames = (t) => String(t ?? '').replace(/[αβγδλμθξη]/g, (c) => ` ${GREEK[c]} `);

export function parseFree(spec) {
  const parts = greekNames(spec).split(/[,，;；]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) throw new Error('formula: 后面写式子里的变量，比如 formula: n');
  return parts.map((p) => {
    const m = p.match(/^([A-Za-z_]\w*)\s*(?:[=＝]\s*(-?\d+)\s*(?:\.\.|…|~|到)\s*(-?\d+))?$/);
    if (!m) throw new Error(`formula: 的写法：formula: n，或者 formula: n=1..8（看不懂「${p}」）`);
    const lo = m[2] !== undefined ? Number(m[2]) : 1, hi = m[3] !== undefined ? Number(m[3]) : 6;
    if (!(hi >= lo) || hi - lo > 30) throw new Error(`${m[1]} 的范围写成 ${m[1]}=1..8 这样，最多 30 个值`);
    return { name: m[1], values: Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) };
  });
}

// 几个变量的取值组合（最多 12 组：每个变量取前几个值的笛卡尔积，太多就截断）
function samples(free) {
  let out = [{}];
  for (const f of free) {
    const vals = free.length > 1 ? f.values.slice(0, 4) : f.values;
    out = out.flatMap((s) => vals.map((v) => ({ ...s, [f.name]: v })));
  }
  return out.slice(0, 12);
}

// 两个值一样吗：精确的按分数比，有小数的按相对误差比
function same(a, b) {
  if (isQ(a) && isQ(b)) return a.cmp(b) === 0;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  try {
    const x = toFloat(a), y = toFloat(b);
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  } catch { return false; }
}

// 一个值写成 TeX（报对不上时给学生看）
function valueTeX(v) {
  try { return exactTeX(v); } catch { /* 小数 */ }
  try {
    const f = toFloat(v);
    const r = (x) => String(Math.round(x * 1000) / 1000);
    if (typeof f === 'number') return r(f);
    if (Array.isArray(f) && Array.isArray(f[0])) return `\\begin{bmatrix}${f.map((row) => row.map(r).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
    if (Array.isArray(f)) return `\\begin{bmatrix}${f.map(r).join(' \\\\ ')}\\end{bmatrix}`;
  } catch { /* */ }
  return '?';
}

// 树里有没有「矩阵的、含自由变量的幂」（A^n、A^(n-1)）
function matrixPowerIn(ast, freeNames, scope) {
  let hit = false;
  const uses = (n) => n && (n.t === 'var' ? freeNames.has(n.name) : ['a', 'b'].some((k) => uses(n[k])) || (n.args || n.items || []).some(uses));
  const walk = (n) => {
    if (!n || hit) return;
    if (n.t === 'bin' && n.op === '^' && uses(n.b)) {
      try { if (isQMat(calcValue(n.a, scope).value)) hit = true; } catch { /* 算不出来就不管 */ }
    }
    ['a', 'b'].forEach((k) => walk(n[k]));
    (n.args || n.items || []).forEach(walk);
  };
  walk(ast);
  return hit;
}

/**
 * 代值比较。expected：标准答案的表达式；given：学生的式子（normalizeFormula 之后的）；
 * free：parseFree 的结果；scope：题里的量（精确值）。
 * 返回 { ok, msg（给学生看的，可以有 $TeX$）, note（记进作答记录的一句话）, checked（代了几组）}
 */
export function compareFormula(expected, given, { free, scope = {} } = {}) {
  const freeNames = new Set(free.map((f) => f.name));
  const eAst = typeof expected === 'string' ? parse(expected) : expected;
  const gAst = typeof given === 'string' ? parse(given) : given;
  const first = { ...scope };
  for (const f of free) first[f.name] = Q.int(f.values.find((v) => v > 1) ?? f.values[0]);
  // 标准答案里没有 A^n，学生也不能直接写 A^n（那等于没化简）
  if (matrixPowerIn(gAst, freeNames, first) && !matrixPowerIn(eAst, freeNames, first)) {
    const nm = free[0].name;
    return { ok: false, powerBan: true, msg: `不能直接写矩阵的 $${nm}$ 次方：要化简成不含矩阵 $${nm}$ 次幂的式子（比如一个数乘 $A$）。`, note: `直接写了矩阵的 ${nm} 次方，没化简` };
  }
  const rows = [];
  for (const s of samples(free)) {
    const vars = { ...scope };
    for (const [k, v] of Object.entries(s)) vars[k] = Q.int(v);
    let want;
    try { want = calcValue(eAst, vars).value; } catch { continue; } // 标准答案在这一组没定义（比如 n=0 时的负次幂）：跳过
    let got, err = null;
    try { got = calcValue(gAst, vars).value; } catch (e) { err = e.message; }
    rows.push({ at: s, ok: !err && same(got, want), want, got, err });
  }
  if (!rows.length) throw new Error('标准答案在这些取值上都算不出来，检查 formula: 的范围');
  const bad = rows.filter((r) => !r.ok);
  if (!bad.length) return { ok: true, msg: '', note: '', checked: rows.length };
  const good = rows.filter((r) => r.ok);
  const b = bad[0];
  // 「n = 1、2 时」：一个变量时只列值；几个变量时一组一组列
  const one = free.length === 1 ? free[0].name : null;
  const list = (rs, max = 6) => {
    const shown = rs.slice(0, max).map((r) => (one ? String(r.at[one]) : Object.entries(r.at).map(([k, v]) => `${k}=${v}`).join(', ')));
    return `${one ? `${one} = ` : ''}${shown.join('、')}${rs.length > max ? ' 等' : ''}`;
  };
  // 给学生看的写成公式：$n = 1$
  const listTeX = (rs) => `$${list(rs).replace(/、/g, ',\\ ').replace(/ 等$/, ',\\ \\dots')}$`;
  const why = b.err ? `你的式子算不出来（${b.err}）` : `你的式子得 $${valueTeX(b.got)}$，应该是 $${valueTeX(b.want)}$`;
  const msg = `${good.length ? `${listTeX(good)} 时对得上；` : ''}${listTeX([b])} 时${why}。`;
  const note = `代值检查：${good.length ? `${list(good)} 对，` : ''}${list(bad, 4)} 不对`;
  return { ok: false, msg, note, checked: rows.length };
}

// 树里用到的变量名
function varsIn(n, out = new Set()) {
  if (!n) return out;
  if (n.t === 'var') out.add(n.name);
  ['a', 'b'].forEach((k) => varsIn(n[k], out));
  (n.args || n.items || []).forEach((x) => varsIn(x, out));
  return out;
}

/**
 * answer / steps 里写了 formula: 时，准备好判式子要用的东西。
 *   answer：标准答案的表达式（比如 3^(n-1)*A）；free：formula: 字段；scope：题里的量（精确值）。
 * 返回 { expected, free, scope, names（式子里能用的名字）, keys（小键盘上放的：自由变量 + 答案里用到的量）, display }。
 * 标准答案自己代不进去（变量没定义之类）时抛出中文原因
 */
export function formulaSpec(answer, freeSpec, scope = {}) {
  const free = parseFree(freeSpec);
  const shown = String(answer ?? '').trim();
  const src = greekNames(shown).replace(/\s+/g, ' ').trim();
  if (!src) throw new Error('formula: 的题要写 answer:（标准答案的式子，比如 3^(n-1)*A）');
  const freeNames = free.map((f) => f.name);
  // 按表达式读；读不了（省略了乘号：(λ-1)(λ-2)、2n）就照学生输入的读法再读一次
  let ast, expected = src;
  try { ast = parse(src); } catch (e) {
    try { expected = normalizeFormula(shown, { names: [...freeNames, ...Object.keys(scope)] }); ast = parse(expected); } catch { throw new Error(`answer: ${shown} 写错了：${e.message}`); }
  }
  const used = [...varsIn(ast)].filter((v) => !freeNames.includes(v));
  const missing = used.filter((v) => !(v in scope) && !['I', 'E', 'pi', 'e'].includes(v));
  if (missing.length) throw new Error(`answer: 里的 ${missing.join('、')} 没有定义：在 let 里给出它的值`);
  const self = compareFormula(ast, ast, { free, scope });
  if (!self.ok) throw new Error(`answer: ${src} 代不进去：${self.msg}`);
  // 只在一两个值上算得出来，比不出对错（比如 A^(1/n)）
  if (self.checked < 2) throw new Error(`answer: ${src} 代不进去：只有 ${self.checked} 组值算得出来，检查式子或 formula: 的范围`);
  const names = [...new Set([...freeNames, ...Object.keys(scope).filter((k) => /^[A-Za-z_]\w*$/.test(k))])];
  return { expected, free, scope, names, keys: [...freeNames, ...used], display: shown };
}
