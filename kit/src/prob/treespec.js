// 概率树 ptree 的写法、问的量、判法、能空的地方（概率第 4 批）。纯函数，不碰 DOM。
import { parseTree, checkTree, leaves } from './tree.js';
import { Q0, Q1, qSum, qInt, judgeNumber } from './num.js';

const KEYS = ['title', 'q', 'note', 'labels', 'drag', 'ask', 'find', 'blank'];
const COMMON = ['id', 'upload'];
const MANY = new Set(['ask']);
const JOIN = new Set(['find', 'blank', 'labels']);

const nameTeX = (s) => (/^[A-Za-z]\d*$/.test(s) ? s.replace(/^([A-Za-z])(\d+)$/, '$1_$2') : `\\text{${s}}`);

// —— 问的量 ——
// 「一行一个原因」的树：样本空间切成 2n 格（第 i 个原因 × 结果发生 / 不发生），第 2i 格是发生、第 2i + 1 格是不发生。
// 一个事件 = 一组格子的位掩码；并、交、对立就是位运算（以前并两边有结果时被当成了交，读数是错的）
const causeMask = (i) => 3 << (2 * i);
const effectMask = (t, yes) => { let m = 0; for (let i = 0; i < t.causes.length; i++) m |= 1 << (2 * i + (yes ? 0 : 1)); return m; };
const fullMask = (t) => (1 << (2 * t.causes.length)) - 1;

// bayes 的一边：式子 → { mask, tex }。并 + ∪，交并排写（空格、逗号、∩ 也行），对立 ~X、X'、\overline{…}，能加括号
function sideBayes(src, t) {
  const names = [...t.causes.map((c) => c.name), t.effect].sort((a, b) => b.length - a.length);
  // 页面自己显示的 A_1、A_{1}、\bar{B} 也认
  const s = String(src).replace(/\\overline\s*\{/g, '~(').replace(/\\bar\s*\{/g, '~(').replace(/\}/g, ')').replace(/\\bar\s*/g, '~')
    .replace(/\\cup/g, '+').replace(/\\cap/g, ' ').replace(/([A-Za-z])_\(?(\d+)\)?/g, '$1$2').replace(/\s+/g, ' ').trim();
  let i = 0;
  const skip = () => { while (i < s.length && /[\s,，∩*·]/.test(s[i])) i++; };
  const list = () => [...t.causes.map((c) => c.name), t.effect].join('、');
  const union = () => {
    let l = inter();
    for (;;) { skip(); if (i < s.length && /[+∪]/.test(s[i])) { i++; const r = inter(); l = { mask: l.mask | r.mask, tex: `${l.tex} \\cup ${r.tex}`, loose: true }; } else return l; }
  };
  const inter = () => {
    let l = factor();
    for (;;) {
      skip();
      if (i >= s.length || /[+∪)]/.test(s[i])) return l;
      const r = factor();
      const side = (x) => (x.loose ? `(${x.tex})` : x.tex);
      l = { mask: l.mask & r.mask, tex: `${side(l)}${side(r)}` };
    }
  };
  const factor = () => {
    skip();
    if (i >= s.length) throw new Error('P( ) 里的式子没写完');
    if (/[~!¬～！]/.test(s[i])) { i++; const x = factor(); return { mask: fullMask(t) & ~x.mask, tex: `\\overline{${x.tex}}` }; }
    let node;
    if (s[i] === '(' || s[i] === '（') {
      i++; node = union(); skip();
      if (!/[)）]/.test(s[i] || '')) throw new Error('括号没有合上');
      i++; node = { ...node, loose: !!node.loose };
    } else {
      const nm = names.find((n) => s.startsWith(n, i));
      if (!nm) { const bad = (/^[^\s,，|+∪∩*·'′()（）]+/.exec(s.slice(i)) || [s.slice(i)])[0]; throw new Error(`树上没有叫 ${bad} 的（有的是 ${list()}）`); }
      i += nm.length;
      node = { mask: nm === t.effect ? effectMask(t, true) : causeMask(t.causes.findIndex((c) => c.name === nm)), tex: nameTeX(nm) };
    }
    while (i < s.length && (/['′’]/.test(s[i]) || s[i] === '̄')) { i++; node = { mask: fullMask(t) & ~node.mask, tex: `\\overline{${node.tex}}` }; }
    return node;
  };
  if (!s) throw new Error('P( ) 里是空的');
  const out = union();
  skip();
  if (i < s.length) throw new Error(`「${s.slice(i)}」读不懂`);
  return { mask: out.mask, tex: out.tex };
}
// 多层的树的一边：每层一个名字或 null（哪个都行）
function sideLevels(src, t, names) {
  const s = src.trim();
  if (!s) throw new Error('P( ) 里是空的');
  let pat;
  if (/[,，_]|^\*$/.test(s) || /(^|[\s,，])\*($|[\s,，])/.test(s)) {
    pat = s.split(/[,，]/).map((x) => x.trim()).map((x) => (x === '_' || x === '*' || x === '' || x === '任意' ? null : x));
    if (pat.length > t.depth) throw new Error(`这棵树只有 ${t.depth} 层，P( ) 里写了 ${pat.length} 个`);
    pat.forEach((x, d) => { if (x !== null && !names[d].has(x)) throw new Error(`第 ${d + 1} 层没有叫 ${x} 的（有的是 ${[...names[d]].join('、')}）`); });
  } else {
    pat = Array(t.depth).fill(null);
    for (const x of s.split(/\s+/)) {
      const at = names.map((set, d) => (set.has(x) ? d : -1)).filter((d) => d >= 0);
      if (!at.length) throw new Error(`树上没有叫 ${x} 的`);
      if (at.length > 1) throw new Error(`${x} 在好几层都有：按位置写，逗号隔开，哪个都行的写 _（第 2 步是${x}写 P(_, ${x})）`);
      pat[at[0]] = x;
    }
  }
  while (pat.length < t.depth) pat.push(null);
  const said = pat.map((x, d) => (x === null ? null : `第 ${d + 1} 步是${x}`)).filter(Boolean);
  return { pat, tex: `\\text{${said.join('，') || '任意'}}` };
}
const levelNames = (t) => {
  const out = Array.from({ length: t.depth }, () => new Set());
  const walk = (kids, d) => { for (const k of kids) { out[d].add(k.name); walk(k.children, d + 1); } };
  walk(t.children, 0);
  return out;
};

/** 「P(B)」「P(A1 | B)」「P(_, 红)」→ 一个能在树上算的量 { form, a, b?（条件）, tex, src }。读不懂抛出 */
export function termOf(src, t) {
  const m = /^P\s*[(（]([\s\S]*)[)）]$/.exec(String(src).trim());
  if (!m) throw new Error(`「${String(src).trim()}」读不懂：问的量写成 P(B)、P(A1 | B)`);
  const parts = m[1].split(/[|｜∣]/);
  if (parts.length > 2) throw new Error('竖线太多：条件概率写成 P(A1 | B)');
  const names = t.form === 'levels' ? levelNames(t) : null;
  const side = (x) => (t.form === 'bayes' ? sideBayes(x, t) : sideLevels(x, t, names));
  const a = side(parts[0]), b = parts.length === 2 ? side(parts[1]) : null;
  return { form: t.form, a, b, tex: b ? `P(${a.tex} \\mid ${b.tex})` : `P(${a.tex})`, src: String(src).trim() };
}

// 一边（或者两边都要）的概率
function probBayes(t, sides) {
  const mask = sides.reduce((m, x) => m & x.mask, fullMask(t));
  let sum = Q0;
  t.causes.forEach((c, i) => {
    if ((mask >> (2 * i)) & 1) sum = sum.add(c.p.mul(t.cond[i]));
    if ((mask >> (2 * i + 1)) & 1) sum = sum.add(c.p.mul(Q1.sub(t.cond[i])));
  });
  return sum;
}
function probLevels(t, sides) {
  let sum = Q0;
  for (const l of leaves(t)) if (sides.every((s) => s.pat.every((x, d) => x === null || l.path[d] === x))) sum = sum.add(l.p);
  return sum;
}
/** 这个量在这棵树上是多少：{ status: 'ok', value } | { status: 'undefined' }（条件的概率是 0） */
export function valueOf(term, t) {
  const P = t.form === 'bayes' ? probBayes : probLevels;
  if (!term.b) return { status: 'ok', value: P(t, [term.a]) };
  const den = P(t, [term.b]);
  if (den.zero) return { status: 'undefined' };
  return { status: 'ok', value: P(t, [term.a, term.b]).div(den) };
}

// 常见的错法（全概率、贝叶斯）：算出那个错的值
function trapsOf(term, t) {
  if (t.form !== 'bayes') return [];
  const out = [];
  const add = (value, text, tag) => out.push({ value, text, tag });
  const yes = effectMask(t, true), no = effectMask(t, false);
  const one = (m) => t.causes.findIndex((_, i) => m === causeMask(i));
  const eff = (m) => (m === yes ? 'yes' : m === no ? 'not' : null);
  const { a, b } = term;
  const c = (i, e) => (e === 'yes' ? t.cond[i] : Q1.sub(t.cond[i]));
  if (b && eff(b.mask) && one(a.mask) >= 0) {
    // 后验 P(Aᵢ | B)
    const i = one(a.mask), e = eff(b.mask);
    add(c(i, e), '条件和结果反了：这是「是这个原因时出现这个结果」的概率，问的是已经看到结果、倒推原因。', 'cond-reversed');
    add(t.causes[i].p.mul(c(i, e)), '这是两个都发生的概率：还要除以条件的概率。', 'joint-for-cond');
    add(t.causes[i].p, '这是它原来的概率：看到结果以后要重新算。', 'prior-for-post');
  }
  if (!b && eff(a.mask)) {
    // 全概率 P(B)
    const cs = t.cond.map((x, i) => c(i, eff(a.mask)));
    add(qSum(cs), '把几个条件概率直接加起来了：每一个要先乘上那个原因的概率。', 'sum-cond');
    add(qSum(cs).div(qInt(cs.length)), '把几个条件概率直接平均了：要按每个原因的概率加权。', 'mean-cond');
  }
  if (!b) {
    // 两个都发生 P(AᵢB)：一格
    for (let i = 0; i < t.causes.length; i++) for (const e of ['yes', 'not']) if (a.mask === (1 << (2 * i + (e === 'yes' ? 0 : 1)))) add(c(i, e), '这是条件概率：两个都发生还要乘上这个原因的概率。', 'cond-for-joint');
  }
  return out;
}
/** 学生填的数对不对（按树现在的数判：拖过以后跟着变）。{ ok, text, tag? }；这个量没有定义时 ok: null */
export function judgeTreeProb(term, t, input) {
  const r = valueOf(term, t);
  if (r.status !== 'ok') return { ok: null, text: '条件的概率是 0，这个量现在没有定义。' };
  return judgeNumber(r.value, input, trapsOf(term, t).filter((x) => x.value.cmp(r.value) !== 0));
}

// —— 树上能空着让学生填的地方 ——
/** 「A3」先验、「A2:~B」对立那一支、「A1 B」叶子上的乘积 → { where: 'prior:2' | 'edge:1:not' | 'leaf:0:yes', value(tree), tex } */
export function blankOf(src, t) {
  if (t.form !== 'bayes') throw new Error('多层的树不能空');
  const s = String(src).trim();
  const yes = effectMask(t, true), no = effectMask(t, false);
  const one = (m) => t.causes.findIndex((_, i) => m === causeMask(i));
  const A = (i) => nameTeX(t.causes[i].name), B = (e) => (e === 'not' ? `\\overline{${nameTeX(t.effect)}}` : nameTeX(t.effect));
  const c = (i, e) => (tree) => (e === 'yes' ? tree.cond[i] : Q1.sub(tree.cond[i]));
  const how = `blank「${s}」读不懂：能空的写成 A1（先验）、A1:~B（那一支）、A1 B（叶子上的乘积）`;
  if (/[:：]/.test(s)) {
    const [l, r = ''] = s.split(/[:：]/);
    const i = one(sideBayes(l, t).mask), m = sideBayes(r, t).mask, e = m === yes ? 'yes' : m === no ? 'not' : null;
    if (i < 0 || !e) throw new Error(how);
    return { where: `edge:${i}:${e}`, value: c(i, e), tex: `P(${B(e)} \\mid ${A(i)})` };
  }
  const m = sideBayes(s, t).mask;
  if (one(m) >= 0) { const i = one(m); return { where: `prior:${i}`, value: (tree) => tree.causes[i].p, tex: `P(${A(i)})` }; }
  for (let i = 0; i < t.causes.length; i++) for (const e of ['yes', 'not']) if (m === (1 << (2 * i + (e === 'yes' ? 0 : 1)))) return { where: `leaf:${i}:${e}`, value: (tree) => tree.causes[i].p.mul(c(i, e)(tree)), tex: `P(${A(i)}${B(e)})` };
  throw new Error(how);
}

/** 读 ptree 组件。写错的收进 problems（不抛） */
export function parsePtree(src) {
  const fields = {}, asks0 = [], problems = [], treeLines = [];
  let last = null;
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '');
    if (!line.trim()) continue;
    const m = /^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/.exec(line);
    const key = m ? m[1].toLowerCase() : null;
    if (m && COMMON.includes(key)) { last = null; continue; }
    if (m && KEYS.includes(key)) {
      const val = m[2].trim();
      if (MANY.has(key)) asks0.push(val);
      else if (JOIN.has(key) && fields[key]) fields[key] += `, ${val}`;
      else fields[key] = val;
      last = key;
    } else if (m) { problems.push(`不认识的字段 ${m[1]}（能写的：${KEYS.join(' ')}）`); last = null; } else { treeLines.push(line); last = null; }
  }
  const out = { fields, tree: null, labels: {}, drag: false, asks: [], finds: [], blanks: [], problems };
  let t;
  try { t = parseTree(treeLines.join('\n')); } catch (e) { problems.push(e.message); return out; }
  out.tree = t;
  problems.push(...checkTree(t));
  const guard = (what, fn) => { try { return fn(); } catch (e) { problems.push(`${what}：${e.message}`); return null; } };
  const known = new Set();
  (function walk(kids) { for (const k of kids) { known.add(k.name); walk(k.children); } }(t.children));
  for (const item of (fields.labels || '').split(/[\s,，]+/).filter(Boolean)) {
    const k = item.indexOf('=');
    if (k <= 0) { problems.push(`labels 写成 A1=甲厂 这样（「${item}」读不懂）`); continue; }
    const nm = item.slice(0, k);
    if (!known.has(nm)) { problems.push(`labels 里的 ${nm} 树上没有`); continue; }
    out.labels[nm] = item.slice(k + 1);
  }
  out.drag = /^(on|yes|是)$/i.test(fields.drag || '');
  if (out.drag && t.form !== 'bayes') { problems.push('drag: on 只对「A1 0.5: B 0.02」这种写法的树（它才有面积图）'); out.drag = false; }
  const sound = !checkTree(t).length;
  const split = (s) => { const res = []; let depth = 0, cur = ''; for (const ch of s) { if ('(（'.includes(ch)) depth++; if (')）'.includes(ch)) depth--; if (depth === 0 && /[;；]/.test(ch)) { res.push(cur); cur = ''; } else if (depth === 0 && /[,，]/.test(ch)) { res.push(cur); cur = ''; } else cur += ch; } res.push(cur); return res.map((x) => x.trim()).filter(Boolean); };
  for (const s of asks0) {
    const q = /^["“]([^"”]*)["”]\s*([\s\S]+)$/.exec(s), k = s.lastIndexOf('=>');
    const [text, expr] = q ? [q[1].trim(), q[2].trim()] : k >= 0 ? [s.slice(0, k).trim(), s.slice(k + 2).trim()] : ['', s.trim()];
    const term = guard(`ask「${expr}」`, () => termOf(expr, t));
    if (!term) continue;
    if (sound && valueOf(term, t).status !== 'ok') { problems.push(`ask 的 ${expr} 没有定义（条件的概率是 0）`); continue; }
    out.asks.push({ q: text || `$${term.tex}$ 是多少？`, expr, term });
  }
  for (const s of fields.find ? split(fields.find) : []) { const term = guard(`find「${s}」`, () => termOf(s, t)); if (term) out.finds.push(term); }
  for (const s of fields.blank ? split(fields.blank) : []) {
    const b = guard(`blank「${s}」`, () => blankOf(s, t));
    if (!b) continue;
    if (/^edge:\d+:yes$/.test(b.where)) { problems.push(`blank「${s}」是给的条件，空了学生没法算；能空的是对立那一支（A1:~B）、叶子上的乘积（A1 B）、一个先验（A1）`); continue; }
    out.blanks.push({ ...b, src: s });
  }
  if (out.blanks.filter((b) => b.where.startsWith('prior:')).length > 1) problems.push('blank：先验只能空一个（空了两个就定不下来了）');
  return out;
}
