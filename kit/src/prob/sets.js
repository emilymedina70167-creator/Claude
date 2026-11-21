// 事件的代数（概率第 4 批，文氏图用）。纯函数，不碰 DOM。
// n 个事件把样本空间切成 2ⁿ 块（原子）：第 k 块的编号按二进制读，第 i 位是 1 表示第 i 个事件发生。
// 一个事件 = 它包含哪几块，存成位掩码 mask（第 k 位是 1 表示包含第 k 块）。
// 概率：每一块一个未知数，给的条件都是它们的一次方程（P(A | B) = v 是 P(AB) − v·P(B) = 0），
// 再加上「和是 1、每块 ≥ 0」。能取的值是一个多面体，问的量在它的顶点上取到最小最大：
// 最小 = 最大就是定得下来，不一样就是条件不够（不替学生猜独立）。
import { Q0, Q1, readQ, qReduce as reduce } from './num.js';

export const MAX_EVENTS = 4;
const fullOf = (n) => (1 << (1 << n)) - 1;
const eventMask = (i, n) => { let m = 0; for (let k = 0; k < 1 << n; k++) if ((k >> i) & 1) m |= 1 << k; return m; };
export const atomsOf = (mask) => { const out = []; for (let k = 0; k < 32; k++) if ((mask >>> k) & 1) out.push(k); return out; };
export const regionsOf = atomsOf;
export const sameEvent = (a, b) => (a.mask ?? a) === (b.mask ?? b);

const HOW = '事件的式子这样写：A ∪ B（或 A + B）、AB（或 A ∩ B）、A - B、对立写 ~A 或 A\'，能加括号';
const fail = (msg) => { throw new Error(`${msg}。${HOW}`); };

// —— 分词 ——
const WORDS = [
  ['\\overline', 'over'], ['\\bar', 'over'], ['\\cup', 'or'], ['\\cap', 'and'], ['\\setminus', 'minus'],
  ['\\Omega', 'all'], ['\\emptyset', 'none'], ['\\varnothing', 'none'], ['\\cdot', 'and'], ['\\neg', 'not'], ['\\lnot', 'not'],
  ['\\left', null], ['\\right', null],
];
const CHARS = {
  '∪': 'or', '+': 'or', '∨': 'or', '∩': 'and', '*': 'and', '·': 'and', '∧': 'and', '×': 'and', ',': 'and', '，': 'and',
  '-': 'minus', '−': 'minus', '–': 'minus', '\\': 'minus', '∖': 'minus',
  '~': 'not', '!': 'not', '¬': 'not', '～': 'not', '！': 'not',
  "'": 'post', '′': 'post', '’': 'post', 'ᶜ': 'post', '̄': 'post', '̅': 'post',
  '(': '(', ')': ')', '（': '(', '）': ')', '{': '{', '}': '}', '[': '(', ']': ')',
  'Ω': 'all', '∅': 'none', 'Φ': 'none', 'ϕ': 'none',
};
function tokens(src, names) {
  // Ā 这样拼好的字拆成「A + 上划线」；全角字母转半角
  // A_1、A_{1}、A_(1) 是页面自己显示的写法：读成 A1（ptree 以前就认，2026-11-21 两个组件一套写法）
  const s = String(src ?? '').normalize('NFD').replace(/[Ａ-Ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/([A-Za-z])_\s*(?:\{\s*(\d+)\s*\}|\(\s*(\d+)\s*\)|(\d+))/g, (_, a, b, c, d) => a + (b ?? c ?? d));
  const byLen = [...names].sort((a, b) => b.length - a.length);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\' && /[,;!:]/.test(s[i + 1] || '')) { i += 2; continue; } // \, \; 这些是公式里的间距
    if (c === '\\' && /[A-Za-z]/.test(s[i + 1] || '')) {
      const w = WORDS.find(([t]) => s.startsWith(t, i) && !/[A-Za-z]/.test(s[i + t.length] || ''));
      // 不是认得的词：这个反斜杠是差（A\B）
      if (!w) { out.push({ t: 'minus', at: i }); i++; continue; }
      if (w[1]) out.push({ t: w[1], at: i });
      i += w[0].length; continue;
    }
    const name = byLen.find((nm) => s.startsWith(nm, i));
    if (name) { out.push({ t: 'name', i: names.indexOf(name), name, at: i }); i += name.length; continue; }
    if (c === '^' && /^\^\s*\{?\s*c\s*\}?/.test(s.slice(i))) { out.push({ t: 'post', at: i }); i += /^\^\s*\{?\s*c\s*\}?/.exec(s.slice(i))[0].length; continue; }
    if (c === '_') fail(`事件的名字里没有「${s.slice(Math.max(0, i - 1), i + 2)}」`);
    // U：手写的并（A U B）。S：全集。0：空集——贴着字母、数字的不算（A0 多半是写错了名字）
    if (c === 'U') { out.push({ t: 'or', at: i }); i++; continue; }
    if (c === 'S') { out.push({ t: 'all', at: i }); i++; continue; }
    if (c === '0') {
      if (/[A-Za-z0-9]/.test(s[i - 1] || '') || /[A-Za-z0-9]/.test(s[i + 1] || '')) fail(`「${s.slice(Math.max(0, i - 1), i + 2)}」读不懂（空集写 ∅，单独的 0 也行）`);
      out.push({ t: 'none', at: i }); i++; continue;
    }
    if (Object.hasOwn(CHARS, c)) { out.push({ t: CHARS[c], at: i }); i++; continue; }
    if (/[A-Za-z]/.test(c)) fail(`这里没有叫 ${/^[A-Za-z]\d*/.exec(s.slice(i))[0]} 的事件（有的是 ${names.join('、')}）`);
    fail(`「${c}」读不懂`);
  }
  return out;
}

// —— 语法：并和差同级、从左往右；交（含并排写）比它们先算；对立最先 ——
function parse(toks, n) {
  let p = 0;
  const peek = () => toks[p];
  const startsFactor = (t) => t && ['name', 'not', 'over', '(', 'all', 'none'].includes(t.t);
  const union = () => {
    let l = inter();
    for (;;) {
      const t = peek();
      if (t && (t.t === 'or' || t.t === 'minus')) { p++; const r = inter(); l = { op: t.t, l, r }; } else return l;
    }
  };
  const inter = () => {
    let l = factor();
    for (;;) {
      const t = peek();
      if (t && t.t === 'and') { p++; l = { op: 'and', l, r: factor() }; }
      else if (startsFactor(t)) l = { op: 'and', l, r: factor() };
      else return l;
    }
  };
  const factor = () => {
    const t = peek();
    if (!t) fail('事件的式子没写完');
    let node;
    if (t.t === 'not') { p++; node = { op: 'not', x: factor() }; return node; }
    if (t.t === 'over') {
      p++;
      const u = peek();
      if (u && u.t === '{') { p++; const x = union(); if (!peek() || peek().t !== '}') fail('\\overline{…} 的括号没有合上'); p++; node = { op: 'not', x }; }
      else node = { op: 'not', x: primary() };
    } else node = primary();
    while (peek() && peek().t === 'post') { p++; node = { op: 'not', x: node }; }
    return node;
  };
  const primary = () => {
    const t = peek();
    if (!t) fail('事件的式子没写完');
    p++;
    if (t.t === 'name') return { op: 'name', i: t.i, name: t.name };
    if (t.t === 'all') return { op: 'all' };
    if (t.t === 'none') return { op: 'none' };
    if (t.t === '(' || t.t === '{') {
      const x = union();
      const close = t.t === '(' ? ')' : '}';
      if (!peek() || peek().t !== close) fail('括号没有合上');
      p++;
      return { op: 'group', x };
    }
    if (t.t === ')' || t.t === '}') fail('多了一个右括号');
    return fail('事件的式子这里少了一个事件');
  };
  if (!toks.length) fail('事件的式子是空的');
  const tree = union();
  if (p < toks.length) fail(toks[p].t === ')' || toks[p].t === '}' ? '多了一个右括号' : '事件的式子这里读不下去');
  return tree;
}

function maskOf(t, n) {
  const full = fullOf(n);
  switch (t.op) {
    case 'name': return eventMask(t.i, n);
    case 'all': return full;
    case 'none': return 0;
    case 'group': return maskOf(t.x, n);
    case 'not': return full & ~maskOf(t.x, n);
    case 'or': return maskOf(t.l, n) | maskOf(t.r, n);
    case 'and': return maskOf(t.l, n) & maskOf(t.r, n);
    default: return maskOf(t.l, n) & ~maskOf(t.r, n); // minus
  }
}

const bare = (t) => (t.op === 'group' ? bare(t.x) : t);
const nameTeX = (s) => (/^[A-Za-z]\d*$/.test(s) ? s.replace(/^([A-Za-z])(\d+)$/, '$1_{$2}') : `\\text{${s}}`); // 中文的名字放进 \text（照 ptree）
function texOf(t0) {
  const t = bare(t0);
  const loose = (x) => ['or', 'minus'].includes(bare(x).op);
  switch (t.op) {
    case 'name': return nameTeX(t.name);
    case 'all': return '\\Omega{}';
    case 'none': return '\\varnothing';
    case 'not': return `\\overline{${texOf(t.x)}}`;
    // 并和差同级、从左往右读：右边是差的话不加括号就成了 (A ∪ B) − C
    case 'or': return `${texOf(t.l)} \\cup ${bare(t.r).op === 'minus' ? `(${texOf(t.r)})` : texOf(t.r)}`;
    case 'minus': return `${texOf(t.l)} - ${loose(t.r) ? `(${texOf(t.r)})` : texOf(t.r)}`;
    default: { // and：并排写；里面是并、差的加括号
      const side = (x) => (loose(x) ? `(${texOf(x)})` : texOf(x));
      const l = side(t.l), r = side(t.r);
      // 两个带下标的名字、Ω 这些并排会粘在一起看不清的，中间不用加东西：TeX 自己分得开
      return `${l}${r}`;
    }
  }
}

/** 只读成语法树（ptree 也用：它的事件不是 2ⁿ 块，叶子换成自己的掩码） */
export const eventTree = (src, names) => parse(tokens(src, names), names.length);
export function evalEvent(t, leaf, full) {
  switch (t.op) {
    case 'name': return leaf(t.i);
    case 'all': return full;
    case 'none': return 0;
    case 'group': return evalEvent(t.x, leaf, full);
    case 'not': return full & ~evalEvent(t.x, leaf, full);
    case 'or': return evalEvent(t.l, leaf, full) | evalEvent(t.r, leaf, full);
    case 'and': return evalEvent(t.l, leaf, full) & evalEvent(t.r, leaf, full);
    default: return evalEvent(t.l, leaf, full) & ~evalEvent(t.r, leaf, full); // minus
  }
}
export const eventTeX = (t) => texOf(t);

/** 事件的式子 → { mask, atoms, tex }；读不懂抛出（说哪里、怎么写） */
export function parseEvent(src, names) {
  const n = names.length;
  if (n < 1 || n > MAX_EVENTS) throw new Error(`事件要 1 到 ${MAX_EVENTS} 个`);
  const tree = parse(tokens(src, names), n);
  const mask = maskOf(tree, n);
  return { mask, atoms: atomsOf(mask), tex: texOf(tree), src: String(src).trim() };
}

// —— 给的条件 ——
// 最外层的逗号、分号切开（括号里的不切）
function splitTop(src) {
  const out = []; let depth = 0, cur = '';
  for (const c of String(src ?? '')) {
    if ('(（{['.includes(c)) depth++;
    if (')）}]'.includes(c)) depth--;
    if (depth === 0 && /[,，;；\n]/.test(c)) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
// 「P(式子)」「P(式子 | 式子)」→ { mask, cond? }
export function parseProbTerm(src, names) {
  const m = /^P\s*[(（]([\s\S]*)[)）]$/.exec(String(src).trim());
  if (!m) throw new Error(`「${String(src).trim()}」读不懂：概率写成 P(A)、P(A ∪ B)、P(A | B)`);
  const parts = m[1].split(/[|｜∣]/);
  if (parts.length > 2) throw new Error(`「${src}」里竖线太多：条件概率写成 P(A | B)`);
  const ev = parseEvent(parts[0], names);
  if (parts.length === 1) return { mask: ev.mask, tex: `P(${ev.tex})`, src: String(src).trim() };
  const cond = parseEvent(parts[1], names);
  return { mask: ev.mask, cond: cond.mask, tex: `P(${ev.tex} \\mid ${cond.tex})`, src: String(src).trim() };
}
/** given 那一行：「P(A) = 0.5, P(AB) = 1/5, P(B | A) = 40%」→ [{ mask, cond?, value, src }] */
export function parseGiven(src, names) {
  return splitTop(src).map((item) => {
    const k = item.lastIndexOf('=');
    const head = k < 0 ? '' : item.slice(0, k).trim();
    if (k < 0 || !/^P\s*[(（]/.test(head)) throw new Error(`given 的写法是 P(A) = 0.5, P(AB) = 1/5（「${item}」读不懂）`);
    const value = readQ(item.slice(k + 1));
    if (!value) throw new Error(`「${item}」：概率要是一个数（0.2、1/5、20%）`);
    return { ...parseProbTerm(head, names), value, src: item };
  });
}

// —— 解 ——
const indicator = (mask, N) => Array.from({ length: N }, (_, k) => ((mask >>> k) & 1 ? Q1 : Q0));
// 一条条件 → 一行方程（系数、右边）
function rowOf(g, N) {
  if (g.cond == null) return { a: indicator(g.mask, N), b: g.value };
  const both = indicator(g.mask & g.cond, N), base = indicator(g.cond, N);
  return { a: both.map((x, k) => x.sub(g.value.mul(base[k]))), b: Q0 };
}
function* choose(arr, k, from = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = from; i <= arr.length - (k - acc.length); i++) { acc.push(arr[i]); yield* choose(arr, k, i + 1, acc); acc.pop(); }
}
const memo = new WeakMap();
// 能取的值那个多面体的顶点（每个是 2ⁿ 个分数）。没有顶点 = 条件自相矛盾
function vertices(givens, n) {
  if (memo.has(givens) && memo.get(givens).n === n) return memo.get(givens).v;
  const N = 1 << n;
  const rows = [{ a: indicator(fullOf(n), N), b: Q1 }, ...givens.map((g) => rowOf(g, N))];
  const base = reduce(rows, N);
  const out = [];
  if (base.ok) {
    const r = base.pivots.length;
    const eqs = base.M.map((row) => ({ a: row.slice(0, N), b: row[N] }));
    const seen = new Set();
    const cols = Array.from({ length: N }, (_, k) => k);
    for (const zero of choose(cols, N - r)) {
      // 这几块定成 0，剩下 r 块由方程唯一定出来（定不出来的组合不是顶点）
      const pin = zero.map((k) => ({ a: cols.map((j) => (j === k ? Q1 : Q0)), b: Q0 }));
      const sol = reduce([...eqs, ...pin], N);
      if (!sol.ok || sol.pivots.length < N) continue;
      const p = sol.M.map((row) => row[N]);
      if (p.some((x) => x.cmp(Q0) < 0)) continue;
      const key = p.join(',');
      if (!seen.has(key)) { seen.add(key); out.push(p); }
    }
  }
  if (typeof givens === 'object' && givens) memo.set(givens, { n, v: out });
  return out;
}
const dot = (p, mask) => p.reduce((s, x, k) => ((mask >>> k) & 1 ? s.add(x) : s), Q0);
const range = (vals) => vals.reduce((m, x) => ({ min: x.cmp(m.min) < 0 ? x : m.min, max: x.cmp(m.max) > 0 ? x : m.max }), { min: vals[0], max: vals[0] });

/** 每一块的概率：{ status: 'unique', p } | { status: 'under', lo, hi（每块能取的范围）} | { status: 'conflict' } */
export function solveAtoms(givens, n) {
  const vs = vertices(givens, n);
  if (!vs.length) return { status: 'conflict' };
  if (vs.length === 1) return { status: 'unique', p: vs[0] };
  const N = 1 << n;
  const rs = Array.from({ length: N }, (_, k) => range(vs.map((v) => v[k])));
  return { status: 'under', lo: rs.map((r) => r.min), hi: rs.map((r) => r.max) };
}
/** P(事件)：{ status: 'ok', value } | { status: 'under', min, max } | { status: 'conflict' } */
export function probOf(mask, givens, n) {
  const vs = vertices(givens, n);
  if (!vs.length) return { status: 'conflict' };
  const { min, max } = range(vs.map((v) => dot(v, mask)));
  return min.cmp(max) === 0 ? { status: 'ok', value: min } : { status: 'under', min, max };
}
/**
 * P(a | b)：分母一定是 0 回 { status: 'undefined' }；比值定不下来回 under。
 * 分母在有的顶点上是 0、别的顶点上比值都一样时算定得下来：那些顶点上分子也是 0（a∩b 在 b 里面），
 * 「分子 − r·分母」在所有顶点上是 0，所以只要条件的概率不是 0，比值就是 r（给了 P(B | A) = 0.4 这种条件时就是这样）
 */
export function condOf(a, b, givens, n) {
  const vs = vertices(givens, n);
  if (!vs.length) return { status: 'conflict' };
  const den = vs.map((v) => dot(v, b));
  if (den.every((d) => d.zero)) return { status: 'undefined' };
  const ratios = vs.map((v, i) => (den[i].zero ? null : dot(v, a & b).div(den[i]))).filter(Boolean);
  const { min, max } = range(ratios);
  if (min.cmp(max) !== 0) return { status: 'under', min, max };
  return { status: 'ok', value: min };
}
/** 一个读好的项（parseProbTerm 的结果）的值 */
export const termValue = (term, givens, n) => (term.cond == null ? probOf(term.mask, givens, n) : condOf(term.mask, term.cond, givens, n));
