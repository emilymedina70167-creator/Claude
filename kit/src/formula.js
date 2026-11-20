// 含 n 的式子作答（纯函数，有测试 tests/formula.test.js）：
// 学生写 (-1)^(n-1)A、3^(n-1)·A 这类答案，页面代几组 n（和题里的量）进去和标准答案比，
// 写法不同但等价的算对；不对时指出在哪个 n 上对不上。
//   normalizeFormula：学生的写法 → 表达式（补乘号、上标、希腊字母、连写的名字拆开）
//   formulaTeX：表达式 → TeX（输入框下面的预览，学生看得到自己写的是什么）
//   compareFormula：代值比较
import { parse, FX_NAMES } from './expr.js';
import { calcValue, exactTeX, isQ, isQMat, toFloat, Q } from './exact.js';
import { parseDomain, compareFx, DEFAULT_RANGE } from './fx/sample.js';
import './fx/diff.js'; // 实数题里 f' 是求导（fx/diff.js 接到 fxEval 上）
import { parseCalc, calcSelfCheck, judgeCalc, FUNCTION_KINDS, CONST_NAMES, PAGE_BUDGET } from './fx/calc.js';

// 学生能用的函数（和 expr.js / exact.js 一致的常用那些）。计划 3 加了初等函数（FX_NAMES）和带底数的 log
const OLD_FUNCS = ['tr', 'det', 'rank', 'inv', 'T', 'sqrt', 'abs', 'dot', 'norm', 'choose', 'fact'];
export const FORMULA_FUNCS = [...OLD_FUNCS, ...FX_NAMES.filter((f) => !OLD_FUNCS.includes(f)), 'log'];
// 不带括号时吃整个「单项」（sin 2x → sin(2x)）的：新加的初等函数；sqrt、abs 只在实数的题里这样读（线代的 sqrt2 照旧）
const MONO = new Set(FX_NAMES.filter((f) => f !== 'sqrt' && f !== 'abs'));
const TRIG = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc'];
const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', λ: 'lambda', μ: 'mu', θ: 'theta', ξ: 'xi', η: 'eta', φ: 'phi', Φ: 'Phi' };
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n', '⁻': '-', '⁺': '+' };
// 题里没定义时当常数的名字（题里定义了 e，e 就是题里的）
const CONSTS = ['e', 'pi', 'inf'];

/**
 * 学生写的式子 → 能交给 expr.js / exact.js 的表达式。names：式子里能用的量（n、A、alpha……）。
 * 认：省略乘号（3A、2n、(n-1)A、nA）、·×÷−、上标（A²、3ⁿ⁻¹）、ᵀ 和 ^T（转置）、希腊字母（α → alpha）、
 * 函数后面直接跟名字（trA → tr(A)）。计划 3：e、π、∞、√、|x|、n!、C(n,k)、log_2 x、Φ；
 * 初等函数不带括号时吃后面的「系数 + 一个名字（带它的指数）」（sin 2x、sin x^2、sin πx），sin^2 x 是 (sin x)²；
 * 整段只写「不存在」「发散」读成 __dne、__div。
 * real：实数取点的题，读不准的不读（e^2x、sin xy），照实说。看不懂时抛出中文原因
 * fx：不是矩阵的题（高数、概率、数的式子）：「不认识」的提示列 sin、ln、e、π，不列 tr、det（dr-final-fix 第 6 条；real 也算）
 */
export function normalizeFormula(text, { names = [], funcs = FORMULA_FUNCS, real = false, fx = false } = {}) {
  const known = new Set(names);
  const fn = new Set(funcs);
  let s = halfWidthAscii(text).trim();
  if (!s) throw new Error('还没写式子');
  if (/^(不存在|DNE)$/i.test(s)) return '__dne';
  if (/^发散$/.test(s)) return '__div';
  if (/!\s*!/.test(s)) throw new Error('双阶乘（!!）页面不认：写成 fact(…) 的式子，比如 (2n-1)!! = (2n)!/(2^n n!)');
  s = s.replace(/[−–—]/g, '-').replace(/[×·∙⋅]/g, '*').replace(/÷/g, '/').replace(/（/g, '(').replace(/）/g, ')').replace(/［/g, '[').replace(/］/g, ']').replace(/，/g, ',');
  // log_2 x、log_{2}(x)、log_a x：底数先记下，记号流里是 __logb0（只认一个数或一个字母当底数）
  const bases = [];
  s = s.replace(/log_\s*(\{[^}]*\}|\([^)]*\)|\d+(?:\.\d+)?|[A-Za-z])/g, (all, b) => { bases.push(b.replace(/^[{(]\s*|\s*[})]$/g, '')); return ` __logb${bases.length - 1} `; });
  if (new RegExp(`\\b(${TRIG.join('|')})\\s*\\^\\s*[({]?\\s*-\\s*1\\b`).test(s)) throw new Error('反三角写 arcsin、arccos、arctan、arccot（不写 sin^-1）');
  s = s.replace(/[{]/g, '(').replace(/[}]/g, ')');
  s = s.replace(/ᵀ/g, "'");
  // 连着的上标字符：A²³ → A^(23)，3ⁿ⁻¹ → 3^(n-1)
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁻⁺]+/g, (m) => `^(${[...m].map((c) => SUP[c]).join('')})`);
  s = s.replace(/[αβγδλμθξηφΦ]/g, (c) => (known.has(GREEK[c]) || !known.has(c) ? ` ${GREEK[c]} ` : c));
  s = s.replace(/π/g, ' pi ').replace(/∞/g, ' inf ').replace(/√/g, ' sqrt ');
  const cst = new Set(CONSTS.filter((c) => !known.has(c)));
  const all = new Set([...known, ...cst]);
  let toks = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z_0-9]*)|(\*\*|!=|[-+*/^()[\],'|!]))/y;
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    const sp = i > 0 && /\s/.test(s[i - 1]);
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new Error(`看不懂「${s.slice(i, i + 6)}」`);
    i = re.lastIndex;
    if (m[1] !== undefined) toks.push({ k: 'num', v: m[1], sp });
    else if (m[2] !== undefined) {
      const w = m[2];
      const lb = /^__logb(\d+)$/.exec(w);
      if (lb) { toks.push({ k: 'fn', v: 'log', base: bases[+lb[1]], sp }); continue; }
      // C(n, k)：组合数（题里没定义 C、后面紧跟括号时）
      if (w === 'C' && !known.has('C') && /^\s*\(/.test(s.slice(i))) { toks.push({ k: 'fn', v: 'choose', isC: true, sp }); continue; }
      // sin2x、ln3x：函数名后面紧跟数字（分词时连成了一个词），拆开，后面的从数字那里重新读
      if (!all.has(w) && !fn.has(w)) {
        const f = [...fn].sort((a, b) => b.length - a.length).find((g) => g !== 'log' && w.startsWith(g) && /^\d/.test(w.slice(g.length))); // log 写底数用 log_2（log2 照旧不认）
        if (f) { toks.push({ k: 'fn', v: f, sp }); i -= w.length - f.length; continue; }
      }
      splitName(w, all, fn, { fx: real || fx }).forEach((t, j) => toks.push({ ...t, cst: t.k === 'name' && cst.has(t.v), sp: j === 0 && sp }));
    } else toks.push({ k: 'op', v: m[3] === '**' ? '^' : m[3], sp });
  }
  // ^T：转置（T 不是题里的量时）
  for (let k = 0; k + 1 < toks.length; k++) {
    if (toks[k].v === '^' && toks[k + 1].v === 'T' && toks[k + 1].k !== 'num' && !known.has('T')) { toks.splice(k, 2, { k: 'op', v: "'" }); }
  }
  toks = absGroups(toks);
  if (real) checkExponents(toks);
  toks = wrapArgs(toks, { real });
  // 省略的乘号
  const out = [];
  toks.forEach((t, k) => {
    const prev = toks[k - 1];
    const endsValue = prev && (prev.k === 'num' || prev.k === 'name' || prev.v === ')' || prev.v === ']' || prev.v === "'" || prev.v === '!');
    const startsValue = t.k === 'num' || t.k === 'name' || t.k === 'fn' || t.v === '(' || t.v === '[';
    if (endsValue && startsValue) out.push('*');
    out.push(t.v);
  });
  const src = out.join(' ').replace(/ ' /g, "' ").replace(/ '$/, "'").replace(/ !/g, '!');
  try { parse(src); } catch (e) { throw new Error(`式子不完整或写错了：${e.message}`); }
  return src;
}

// |…| → norm(…)（abs 写在数上就是绝对值，写在向量上是长度，和以前 expr.js 读 |…| 一样）。
// 一对竖线：前面是一个值的结尾才是「关」，所以 |x-1||x+1| 是两个相乘；关之前又遇到「开」就是嵌套，不猜
function absGroups(toks) {
  if (!toks.some((t) => t.v === '|')) return toks;
  const out = [];
  let open = false;
  for (const t of toks) {
    if (t.v !== '|') { out.push(t); continue; }
    const prev = out[out.length - 1];
    const ends = prev && (prev.k === 'num' || prev.k === 'name' || prev.v === ')' || prev.v === ']' || prev.v === "'" || prev.v === '!');
    if (open && ends) { out.push({ k: 'op', v: ')' }); open = false; continue; }
    if (open) throw new Error('嵌套的绝对值写 abs(…)，比如 abs(abs(x)-1)');
    out.push({ k: 'fn', v: 'norm', absGroup: true, sp: t.sp }, { k: 'op', v: '(' });
    open = true;
  }
  if (open) throw new Error('绝对值的竖线没写完');
  return out;
}

// 实数的题：不带括号的指数是「数字紧跟字母」（e^2x、e^-2x、x^2y）不读——读成 e²·x 再判错就是把对的判成错。
// 两种照读（dr-calc-fix 第 1、2 条）：底是函数名（sin^2x 是 (sin x)²，数字后面是参数，wrapArgs 处理）；
// 紧跟的是 e 而且后面还有 ^（x^2e^x：指数到数字为止，e^x 是新的因子）。不收的话照学生写的底和字母说（第 3 条）
function checkExponents(toks) {
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].v !== '^') continue;
    if (toks[k - 1]?.k === 'fn') continue;
    let j = k + 1;
    const sign = toks[j]?.v === '-' ? '-' : '';
    if (toks[j]?.v === '-' || toks[j]?.v === '+') j++;
    const n = toks[j], l = toks[j + 1];
    if (n?.k !== 'num' || l?.k !== 'name' || l.sp) continue;
    if (l.cst && l.v === 'e' && toks[j + 2]?.v === '^') continue;
    const b = toks[k - 1]?.k === 'num' || toks[k - 1]?.k === 'name' ? toks[k - 1].v : '(…)';
    const ways = sign ? `${b}^(-${n.v}${l.v}) 或 ${b}^(-${n.v})·${l.v}` : `${b}^${n.v}·${l.v} 或 ${b}^(${n.v}${l.v})`;
    throw new Error(`指数写不清：写 ${ways}（不带括号的指数只读到数字为止）`);
  }
}

// 和 k 处的「(」配对的「)」的下标
function closeOf(toks, k) {
  let d = 0;
  for (let j = k; j < toks.length; j++) {
    if (toks[j].v === '(' || toks[j].v === '[') d++;
    else if (toks[j].v === ')' || toks[j].v === ']') { d--; if (!d) return j; }
  }
  throw new Error('括号没配对');
}
// 指数：一个括号、或（带负号的）一个数 / 名字。回指数结束的下一个下标
function exponentEnd(toks, j) {
  if (toks[j]?.v === '(') return closeOf(toks, j) + 1;
  if (toks[j]?.v === '-' || toks[j]?.v === '+') j++;
  if (toks[j]?.k === 'num' || toks[j]?.k === 'name') return j + 1;
  throw new Error('^ 后面要写指数');
}
const P = (v) => ({ k: 'op', v });

// 函数的参数：带括号的照旧；不带括号的，新函数吃「系数（数、π）+ 一个名字（带它的指数）」，老函数照旧只吃一个记号（trA → tr(A)）
// 从右往左包（dr-calc-fix 第 4 条）：里面的函数先包好，外面的函数后面紧跟一个函数时，参数就是那一个（ln ln x、sin√x）
function wrapArgs(toks, { real }) {
  for (let k = toks.length - 1; k >= 0; k--) {
    const t = toks[k];
    if (t.k !== 'fn') continue;
    const name = t.v === 'log' && t.base !== undefined ? `log_${t.base}` : t.v;
    if (t.v === 'log' && t.base === undefined) throw new Error('log 要写底数：写 ln x、lg x 或 log_2 x');
    const mono = MONO.has(t.v) || t.v === 'log' || (real && (t.v === 'sqrt' || t.v === 'abs'));
    // sin^2 x：(sin x)²
    let power = null;
    if (mono && toks[k + 1]?.v === '^') {
      const e = exponentEnd(toks, k + 2);
      power = toks.splice(k + 1, e - k - 1).slice(1);
    }
    let end; // 参数结束的下一个下标（参数是 toks[k+1 .. end)）
    if (toks[k + 1]?.v === '(') {
      end = closeOf(toks, k + 1) + 1;
      if (t.isC) { const inner = toks.slice(k + 2, end - 1); if (!topComma(inner)) throw new Error('C(n, k) 是组合数，要写两个数：C(5, 2)'); }
    } else if (mono) {
      let j = k + 1;
      if (toks[j]?.v === '-') j++;
      const from = j;
      while (toks[j] && (toks[j].k === 'num' || (toks[j].k === 'name' && toks[j].cst && toks[j].v === 'pi'))) j++;
      if (toks[j]?.k === 'name' && !toks[j].cst) {
        j++;
        if (toks[j]?.v === '^') j = exponentEnd(toks, j + 1);
      } else if (j === from && toks[j]?.k === 'fn' && toks[j + 1]?.v === '(') j = closeOf(toks, j + 1) + 1; // ln|x|、ln ln x、sin√x（里面那个已经包好了）
      if (j === from) throw new Error(`${name} 后面要写它作用在什么上，比如 ${name}(x)`);
      if (toks[j]?.k === 'name' && !toks[j].cst) {
        const a = toks.slice(from, j).map((x) => x.v).join('');
        throw new Error(`写 ${name}(${a}${toks[j].v}) 或 ${name}(${a})·${toks[j].v}`);
      }
      toks.splice(j, 0, P(')'));
      toks.splice(k + 1, 0, P('('));
      end = j + 2;
    } else if (toks[k + 1] && (toks[k + 1].k === 'name' || toks[k + 1].k === 'num')) {
      toks.splice(k + 1, 1, P('('), toks[k + 1], P(')'));
      end = k + 4;
    } else continue;
    // log_2 x：底数接在参数后面（expr.js 的 log(x, 底数)）
    if (t.base !== undefined) { toks.splice(end - 1, 0, P(','), { k: /^\d/.test(t.base) ? 'num' : 'name', v: t.base }); end += 2; }
    if (power) {
      toks.splice(end, 0, P(')'), P('^'), ...power);
      toks.splice(k, 0, P('('));
    }
  }
  return toks;
}
const topComma = (ts) => { let d = 0; return ts.some((x) => { if (x.v === '(' || x.v === '[') d++; else if (x.v === ')' || x.v === ']') d--; return d === 0 && x.v === ','; }); };

const FX_HINT = 'sin、cos、ln、arctan 这些函数和 e、π';

/**
 * 全角的 ASCII 转半角（iPad 中文键盘打的 ２ｘ、ｓｉｎ（ｘ）、＋）、全角空格转空格。只换 U+FF01–FF5E：
 * 不用 NFKC——它把 A² 变成 A2、ᵀ 变成 T，式子就读错了（dr-final-fix 第 6 条）
 */
export function halfWidthAscii(text) {
  return String(text ?? '').replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ');
}

// 一个不认识的名字：试着拆成认识的几个（nA → n、A；trA → tr、A）；拆不开就报错
function splitName(w, known, fn, { fx = false } = {}) {
  if (known.has(w)) return [{ k: 'name', v: w }];
  if (fn.has(w)) return [{ k: 'fn', v: w }];
  const all = [...known, ...fn].sort((a, b) => b.length - a.length);
  const memo = new Map();
  const go = (s) => {
    if (!s) return [];
    if (memo.has(s)) return memo.get(s);
    let best = null;
    // C_1cos2x：数字自成一段（cos2x → cos、2、x）
    const d = /^\d+(?:\.\d+)?/.exec(s);
    if (d) { const rest = go(s.slice(d[0].length)); if (rest) best = [{ k: 'num', v: d[0] }, ...rest]; }
    for (const n of best ? [] : all) {
      if (!s.startsWith(n)) continue;
      if (n === 'log' && /^\d/.test(s.slice(3))) continue; // log2 不拆
      const rest = go(s.slice(n.length));
      if (rest) { best = [{ k: fn.has(n) && !known.has(n) ? 'fn' : 'name', v: n }, ...rest]; break; }
    }
    memo.set(s, best);
    return best;
  };
  const parts = go(w);
  if (parts) return parts;
  const list = [...known].filter((x) => x.length <= 8 && !CONSTS.includes(x));
  // 按题换：高数、概率、数的式子列初等函数和常数；矩阵的题照旧列 tr、det、rank、inv
  const fns = fx ? FX_HINT : `${[...fn].filter((f) => f !== 'T').slice(0, 5).join('、')} 这些函数`;
  throw new Error(`不认识「${w}」：式子里能用 ${list.join('、') || '题里给的量'}${fn.size ? `，以及 ${fns}` : ''}`);
}

// —— 表达式 → TeX（预览）——
const TEX_NAME = { alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta', lambda: '\\lambda', mu: '\\mu', theta: '\\theta', xi: '\\xi', eta: '\\eta', phi: '\\varphi', Phi: '\\Phi', pi: '\\pi', inf: '\\infty', __dne: '\\text{不存在}', __div: '\\text{发散}' };
// 初等函数的写法：参数一律画括号，学生交之前看得见页面是怎么读的（sin 2x → \sin(2x)）
const TEX_FN = { sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot', sec: '\\sec', csc: '\\csc', arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan', arccot: '\\operatorname{arccot}', ln: '\\ln', lg: '\\lg', exp: '\\exp', Phi: '\\Phi', phi: '\\varphi' };
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
      if (TEX_FN[n.name]) return `${TEX_FN[n.name]}\\left(${args}\\right)`;
      if (n.name === 'log' && n.args.length === 2) return `\\log_{${tex(n.args[1])}}\\left(${tex(n.args[0])}\\right)`;
      if (n.name === 'fact') return `${wrap(n.args[0], 9)}!`;
      if (n.name === 'int') return `\\int${n.args.length === 4 ? `_{${tex(n.args[2])}}^{${tex(n.args[3])}}` : ''} ${tex(n.args[0])}${n.args[1] ? `\\,\\mathrm{d}${tex(n.args[1])}` : ''}`;
      if (n.name === 'choose' && n.args.length === 2) return `\\binom{${tex(n.args[0])}}{${tex(n.args[1])}}`;
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
  // formula: -：式子作答、没有变量（3^9A 这种：页面比值，配 form: 要求写成什么样）
  if (/^\s*(-|none|无|没有)\s*$/i.test(String(spec ?? ''))) return [];
  const parts = splitTop(greekNames(spec)).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) throw new Error('formula: 后面写式子里的变量，比如 formula: n');
  return parts.map((p) => {
    // 实数的变量：x in (0, 1)（计划 3：在这个范围里随机取点比）
    if (/\s(in|∈)\s*[([]/.test(` ${p}`)) { const [d] = parseDomain(p); return { name: d.name, domain: d }; }
    const m = p.match(/^([A-Za-z_]\w*)\s*(?:[=＝]\s*(-?\d+)\s*(?:\.\.|…|~|到)\s*(-?\d+))?$/);
    if (!m) throw new Error(`formula: 的写法：formula: n，或者 formula: n=1..8，实数写 formula: x in (0, 1)（看不懂「${p}」）`);
    const lo = m[2] !== undefined ? Number(m[2]) : 1, hi = m[3] !== undefined ? Number(m[3]) : 6;
    if (!(hi >= lo) || hi - lo > 30) throw new Error(`${m[1]} 的范围写成 ${m[1]}=1..8 这样，最多 30 个值`);
    // explicit：写了整数范围（x=1..5）的 x 照整数取点
    const f = { name: m[1], values: Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) };
    if (m[2] !== undefined) Object.defineProperty(f, 'explicit', { value: true }); // 不可枚举：旧的比较、存档里照旧没有它
    return f;
  });
}

// 输入框的示例字按题换（dr-calc-fix）：答案是一个数的「比如 1/2、e^2、∞」，函数式的「比如 x e^x」
function placeholderFor(c) {
  if (c && !FUNCTION_KINDS.has(c.kind) && c.kind !== 'sum') return '比如 1/2、e^2、∞';
  if (c && c.kind === 'deriv' && c.at !== undefined && c.order !== 'n') return '比如 1/2、e^2、∞';
  return '比如 x e^x';
}

// 小键盘多的那一排：极限题能写无穷和不存在，积分题能写发散，别的是常用函数
function padFor(c) {
  if (c && c.kind === 'limit') return ['∞', '+∞', '-∞', '不存在', 'e', 'π'];
  if (c && c.kind === 'integral') return ['发散', 'e', 'π', '√', 'ln', '∞'];
  if (c && c.kind === 'order') return [];
  return ['sin', 'cos', 'ln', 'e^', 'π', '√', ...(c?.kind === 'antideriv' ? ['C', 'arctan'] : [])];
}

// calc: 没配 formula: 时的变量（第五节第 2 条：一行就够）
function calcFree(c, scope = {}) {
  // of 里的实数变量都要取点（偏导 wrt=y 时 x 照样要有值）；n 是 n 阶导的通式自己的
  const vars = [...new Set([...(c.wrtList || [c.x]), ...[...varsIn(c.ofAst)].filter((v) => /^[a-z]$/.test(v) && !['e', 'n'].includes(v) && !(v in scope) && !(c.kind === 'ode' && v === 'y'))])];
  const n = c.order === 'n' ? ['n=1..5'] : [];
  if (c.kind === 'deriv' && c.at !== undefined) return n.length ? n[0] : '-';
  return FUNCTION_KINDS.has(c.kind) ? [...vars.map((v) => (v === 'n' ? 'n' : `${v} in (-3, 3)`)), ...n].join(', ') : '-';
}

// 按最外层的逗号、分号切（x in (0, 1), a in [1, 3] 里括号里的逗号不算）
function splitTop(s) {
  const out = [];
  let d = 0, cur = '';
  for (const c of String(s)) {
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    if (d === 0 && /[,，;；]/.test(c)) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
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
    // 有一边不是有限数（学生写 ∞、1/0、10^400）就不相等：两边都是 Infinity 时右边的容差也是 Infinity（dr-final-fix 第 1 条）
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
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
export function compareFormula(expected, given, opts = {}) {
  // calc:（导数、不定积分、极限……）：fx/calc.js 判
  if (opts.calc) return judgeCalc(opts, given, { texOf: formulaTeX });
  // 实数取点的题（formula: x、x in (…)、domain:、calc:）：fx/sample.js 判
  if (opts.real) return compareFx(expected, given, { domain: opts.domain, ints: opts.ints, scope: opts.scope, seed: opts.seed });
  const { free, scope = {} } = opts;
  const freeNames = new Set(free.map((f) => f.name));
  const eAst = typeof expected === 'string' ? parse(expected) : expected;
  const gAst = typeof given === 'string' ? parse(given) : given;
  const first = { ...scope };
  for (const f of free) first[f.name] = Q.int(f.values.find((v) => v > 1) ?? f.values[0]);
  for (const [k, v] of Object.entries(first)) if (!freeNames.has(k)) first[k] = atParam(v, Object.fromEntries(free.map((f) => [f.name, Number(first[f.name].n)])));
  // 标准答案里没有 A^n，学生也不能直接写 A^n（那等于没化简）
  if (matrixPowerIn(gAst, freeNames, first) && !matrixPowerIn(eAst, freeNames, first)) {
    const nm = free[0].name;
    return { ok: false, powerBan: true, msg: `不能直接写矩阵的 $${nm}$ 次方：要化简成不含矩阵 $${nm}$ 次幂的式子（比如一个数乘 $A$）。`, note: `直接写了矩阵的 ${nm} 次方，没化简` };
  }
  const rows = [];
  for (const s of samples(free)) {
    const vars = { ...scope };
    for (const [k, v] of Object.entries(s)) vars[k] = Q.int(v);
    // 题里含参数算出来的量（let 里 a = param、A 含 a）：自由变量就是这个参数时，代进这一组的值
    for (const [k, v] of Object.entries(vars)) if (!(k in s)) vars[k] = atParam(v, s);
    let want;
    try { want = calcValue(eAst, vars).value; } catch { continue; } // 标准答案在这一组没定义（比如 n=0 时的负次幂）：跳过
    if (!finite(want)) continue; // 算出来不是有限数（ln 在负数上）也是没定义
    let got, err = null;
    try { got = calcValue(gAst, vars).value; } catch (e) { err = e.message; }
    rows.push({ at: s, ok: !err && same(got, want), want, got, err });
  }
  if (!rows.length) throw new Error('标准答案在这些取值上都算不出来，检查 formula: 的范围');
  const bad = rows.filter((r) => !r.ok);
  if (!bad.length) return { ok: true, msg: '', note: '', checked: rows.length };
  // 对不上的全是因为学生的式子在那几个 n 上算不出来（ln(n-1) 在 n = 1，新加的函数没定义）：页面判不了，不判错
  if (bad.every((r) => r.err || !finite(r.got)) && rows.some((r) => r.ok) && usesFx(gAst)) {
    const nm = free.length === 1 ? free[0].name : '';
    return { ok: null, msg: `页面判不了：你的式子在 ${nm ? `$${nm} = ${bad.map((r) => r.at[nm]).join(',\\ ')}$` : '几组取值'} 时算不出来，别的取值都对得上，待外部核。`, note: `代值检查：${bad.length} 组算不出来（${bad[0].err}），页面判不了`, checked: rows.length, bad };
  }
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
  // bad：对不上的那几组（{ at, want, got, err }）：舞台写给老师「代 n = 3 是 4.5，该是 3」要用两边的值
  return { ok: false, msg, note, checked: rows.length, bad };
}

const finite = (v) => { try { const f = toFloat(v); return (Array.isArray(f) ? f.flat(Infinity) : [f]).every(Number.isFinite); } catch { return false; } };
// 树里用到了计划 3 新加的初等函数
function usesFx(n) {
  if (!n) return false;
  if (n.t === 'call' && FX_NAMES.includes(n.name)) return true;
  return ['a', 'b'].some((k) => usesFx(n[k])) || (n.args || n.items || []).some(usesFx);
}

// 含参数的多项式（paramcalc.js 算出来、记着参数名 param）在这一组值上的值；别的原样
function atParam(v, at) {
  if (Array.isArray(v)) return v.map((x) => atParam(x, at));
  if (v && typeof v.eval === 'function' && v.param && v.param in at) return v.eval(Q.int(at[v.param]));
  return v;
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
export function formulaSpec(answer, freeSpec, scope = {}, opts = {}) {
  const calc = opts.calc ? parseCalc(opts.calc) : null;
  // 只写 calc: 不写 formula:：导数、原函数、等价、泰勒的学生写 x 的式子（n 阶导通式再加 n），极限、积分、阶写一个数
  if (calc && !String(freeSpec ?? '').trim()) freeSpec = calcFree(calc, scope);
  let free = parseFree(freeSpec);
  // domain: x in (0, 1)：给实数的变量定范围（formula: 里没写这个变量就加上）
  for (const d of parseDomain(opts.domain || '')) {
    const k = free.findIndex((f) => f.name === d.name);
    if (k >= 0) free[k] = { name: d.name, domain: d }; else free = [...free, { name: d.name, domain: d }];
  }
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
  // 微分方程的 answer: 里的常数 C_1、C_2 不算没定义的量
  const odeC = calc?.kind === 'ode' ? ['C', 'C_1', 'C_2', 'C_3', 'C1', 'C2', 'C3'] : [];
  const missing = used.filter((v) => !(v in scope) && !['I', 'E', 'pi', 'e', 'inf', '__dne', '__div', ...odeC].includes(v));
  if (missing.length) throw new Error(`answer: 里的 ${missing.join('、')} 没有定义：在 let 里给出它的值`);
  const names = [...new Set([...freeNames, ...Object.keys(scope).filter((k) => /^[A-Za-z_]\w*$/.test(k))])];
  // 实数取点：写了范围、domain:、calc:，或者变量叫 x、y——但题里用到矩阵（矩阵的量、det tr rank inv、转置）时照旧整数取点（线代的 |A − xE|）
  const matrixy = Object.values(scope).some((v) => Array.isArray(v)) || /\b(det|tr|rank|inv|T)\s*\(|'/.test(src);
  const intOnly = /\b(fact|choose|mod|div|gcd|lcm|floor|ceil|bin|hex|bit|signed|unsigned|faults|next|nextval)\s*\(|!/.test(src);
  const explicitReal = free.some((f) => f.domain) || !!opts.calc;
  const autoReal = !explicitReal && !matrixy && !intOnly && free.some((f) => /^[xy]$/.test(f.name) && !f.explicit);
  let real = explicitReal || autoReal;
  // 自动按实数（变量叫 x、y、没写范围）在 (−3, 3) 上取不到点的：退回以前的整数取点（旧课件 ln(x-3) 在 x = 4…6 能代）
  if (autoReal) {
    const dom = free.filter((f) => /^[xy]$/.test(f.name) && !f.explicit).map((f) => ({ ...DEFAULT_RANGE, name: f.name }));
    if (compareFx(ast, ast, { domain: dom, ints: free.filter((f) => !dom.some((d) => d.name === f.name)), scope, seed: `${shown}|${freeSpec}` }).ok !== true) real = false;
  }
  if (real) {
    const domain = free.filter((f) => f.domain || (/^[xy]$/.test(f.name) && !f.explicit)).map((f) => f.domain || { ...DEFAULT_RANGE, name: f.name });
    const ints = free.filter((f) => !domain.some((d) => d.name === f.name));
    const seed = `${shown}|${freeSpec}`;
    const keys = [...freeNames, ...used.filter((v) => !['pi', 'e', 'inf', '__dne', '__div'].includes(v))];
    if (calc) {
      // 学生写 +C、o(x^3)：输入框读法里认这几个名字，判的时候在语法树上去掉（fx/calc.js 的 stripTail）
      const extra = calc.kind === 'antideriv' ? CONST_NAMES.filter((c) => !(c in scope)) : calc.kind === 'ode' ? ['C', 'C_1', 'C_2', 'C_3', 'C1', 'C2', 'C3'].filter((c) => !(c in scope)) : [];
      const spec = { expected, free, scope, names: [...names, ...extra], keys, display: shown, real: true, domain, ints, seed, calc, pad: padFor(calc), placeholder: placeholderFor(calc),
        read: { names: [...names, ...extra], real: domain.length > 0, fx: true, ...(calc.kind === 'taylor' ? { funcs: [...FORMULA_FUNCS, 'o', 'O'] } : {}) } };
      const { errors, hints } = calcSelfCheck(spec, { budget: opts.budget ?? PAGE_BUDGET });
      if (errors.length) throw new Error(errors.join('；'));
      spec.hints = hints;
      return spec;
    }
    const self = compareFx(ast, ast, { domain, ints, scope, seed });
    if (self.ok !== true) throw new Error(`answer: ${shown} 在给的范围里算不出来（${self.note}）：检查式子，或用 domain: x in (…) 给范围`);
    return { expected, free, scope, names, keys, display: shown, real: true, domain, ints, seed, read: { names, real: true, fx: true }, pad: padFor(null), placeholder: placeholderFor(null) };
  }
  const self = compareFormula(ast, ast, { free, scope });
  if (!self.ok) throw new Error(`answer: ${src} 代不进去：${self.msg}`);
  // 只在一两个值上算得出来，比不出对错（比如 A^(1/n)）
  if (self.checked < Math.min(2, free.length ? 2 : 1)) throw new Error(`answer: ${src} 代不进去：只有 ${self.checked} 组值算得出来，检查式子或 formula: 的范围`);
  return { expected, free, scope, names, keys: [...freeNames, ...used], display: shown, read: { names, ...(matrixy ? {} : { fx: true }) } };
}

/**
 * 标准答案是按格写出来的矩阵（[[2^n, n*2^(n-1)], [0, 2^n]]）：拆成每一格的式子 [[…]]；不是这种写法返回 null。
 * 这时作答框按格给（每格一个式子框），逐格判，指出哪几格不对
 */
export function matrixCells(src) {
  const s = String(src ?? '').trim();
  if (!/^\[\s*\[/.test(s) || !s.endsWith(']')) return null;
  const top = splitList(s.slice(1, -1));
  if (!top || !top.length) return null;
  const rows = top.map((r) => (r.startsWith('[') && r.endsWith(']') ? splitList(r.slice(1, -1)) : null));
  if (rows.some((r) => !r || !r.length) || rows.some((r) => r.length !== rows[0].length)) return null;
  if (rows.length > 4 || rows[0].length > 4) return null;
  return rows;
}
// 按最外层逗号切（括号里的逗号不算）
function splitList(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (depth < 0) return null;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (depth) return null;
  if (cur.trim()) out.push(cur.trim());
  return out.some((x) => !x) ? null : out;
}

/** 逐格比：expected / given 都是 [[式子]]。返回 { ok, wrong: [格的序号（按行数）], first: { r, c, msg, bad（对不上的那几组值） } } */
export function compareCells(expected, given, opts) {
  const wrong = [];
  let first = null, unsure = null;
  expected.forEach((row, r) => row.forEach((e, c) => {
    const res = compareFormula(e, given[r][c], opts);
    if (res.ok === null) { unsure ??= { r, c, msg: res.msg }; return; }
    if (!res.ok) { wrong.push(r * row.length + c); first ??= { r, c, msg: res.msg, powerBan: res.powerBan, bad: res.bad || [] }; }
  }));
  // 有判不了的格子、别的都对：这一题判不了（计划 3：不当成对，也不当成错）
  if (!wrong.length && unsure) return { ok: null, wrong, first: unsure };
  return { ok: !wrong.length, wrong, first };
}

// —— form:：答案要写成什么样（值对了以后再看写法；考研「写出最简形式」的题）——
//   form: kA        一个数乘一个矩阵的名字（3^9A、-2^(n-1)A）：不能写成乘开的矩阵、不能留 A^10
//   form: factored  因式分解（每个因式是一次的，可以带次方：-(a-1)^2(a+2)）：不能是展开的多项式
export const FORMS = { ka: '数 × 矩阵', factored: '因式分解' };

/** 写法对不对：given 是读懂以后的式子。返回 { ok, msg } */
export function checkForm(given, form, { free = [], scope = {} } = {}) {
  const f = String(form ?? '').trim().toLowerCase();
  if (!f) return { ok: true, msg: '' };
  if (!FORMS[f]) throw new Error(`form: 写 kA（数 × 矩阵）或 factored（因式分解）（现在是「${form}」）`);
  const ast = typeof given === 'string' ? parse(given) : given;
  // 拆成连乘的几个因式（负号、除以数、整数次方都算在因式里）
  const factors = [];
  const walk = (n) => {
    if (n.t === 'neg') return walk(n.a);
    if (n.t === 'bin' && n.op === '*') { walk(n.a); walk(n.b); return; }
    if (n.t === 'bin' && n.op === '/' && isConstAst(n.b)) { walk(n.a); return; }
    factors.push(n);
  };
  walk(ast);
  const at = (n, v) => { const vars = { ...scope }; for (const x of free) vars[x.name] = Q.int(v); return calcValue(n, vars).value; };
  if (f === 'ka') {
    const mats = factors.filter((n) => { try { return Array.isArray(at(n, 2)); } catch { return false; } });
    const ok = mats.length === 1 && mats[0].t === 'var';
    return { ok, msg: ok ? '' : '值对了，但要写成「一个数 × 矩阵名」的样子（比如 $3^9A$），不要乘开、也不要留着矩阵的幂。' };
  }
  // factored：每个不是常数的因式都是一次的（底数一次、整数次方）
  const name = free[0]?.name;
  const linear = (n) => {
    const base = n.t === 'bin' && n.op === '^' && isConstAst(n.b) ? n.a : n;
    if (!name) return true;
    try {
      const y = [0, 1, 2, 3].map((v) => Number(toFloat(at(base, v))));
      return Math.abs(y[2] - 2 * y[1] + y[0]) < 1e-9 && Math.abs(y[3] - 2 * y[2] + y[1]) < 1e-9;
    } catch { return false; }
  };
  const ok = factors.every(linear);
  return { ok, msg: ok ? '' : '值对了，但要写成因式分解的样子（每个因式是一次的，比如 $-(a-1)^2(a+2)$）。' };
}
const isConstAst = (n) => n.t === 'num' || (n.t === 'neg' && isConstAst(n.a)) || (n.t === 'bin' && isConstAst(n.a) && isConstAst(n.b));
