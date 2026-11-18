// 舞台上能动手的式子（tex f = "(A+B)(A+B)" alg=on）：照代数写的一行，页面拆成项和因子，学生拖项换顺序、拖到另一项上合并同类项、
// 点一项展开括号。合不合法由非交换多项式的判定（kit/src/ncalg.js）定：数学上相等才让动（交换律只对标量、单位矩阵成立），
// 不相等弹回去、说为什么，判不了照实说判不了。纯函数，有测试（tests/stage-tex-alg.test.js）。
//
// 模型 o.alg = { items: [{ key: 't1', sign: 1 | -1, factors: [{ key, text }] }], n }：一项（加减分开的一段）是几个因子的积。
// 一项只有一个因子时它自己是部件（f.t1）；有几个因子时每个因子是部件（f.t2f1、f.t2f2），这一项整个跟着它的因子走
import { splitTerms, expandTerm, likeTerms, mergedText, equivalent, unknownWhy, toTex, polyOf, monoText } from '../../ncalg.js';

/** 一行代数 → 模型；读不懂（含逆、转置……）抛错，话给老师看 */
export function algParse(src, n0 = 0) {
  const ts = splitTerms(src);
  if (!ts) {
    const why = unknownWhy(src, '0') || '读不懂';
    throw new Error(`alg=on 的式子照代数写（大写字母是矩阵、小写字母和数是标量，E / I 单位矩阵，O 零矩阵，+ − 乘、括号、正整数次方）：${why}`);
  }
  let n = n0;
  const items = ts.map((t) => {
    const key = `t${++n}`;
    return { key, sign: t.sign, factors: t.factors.map((f, j) => ({ key: t.factors.length === 1 ? key : `${key}f${j + 1}`, text: f })) };
  });
  return { items, n };
}

/** 一项的代数（不带正负号）：因子之间写 *（ncalg 认），2*3 这种也不会粘成 23 */
const itemText = (it) => it.factors.map((f) => f.text).join('*');
/** 整行的代数（判合不合法用） */
export function algText(alg) {
  if (!alg.items.length) return '0';
  return alg.items.map((it, i) => `${i ? (it.sign < 0 ? ' - ' : ' + ') : it.sign < 0 ? '-' : ''}${itemText(it)}`).join('');
}
const isNum = (t) => /^\(?-?\d/.test(String(t));
/** 整行写给人看（因子挨着写，数和数之间写 ·）：A^2 + AB - BA */
export function algShown(alg) {
  if (!alg.items.length) return '0';
  return alg.items.map((it, i) => `${i ? (it.sign < 0 ? ' - ' : ' + ') : it.sign < 0 ? '-' : ''}${it.factors.map((f, j) => `${j && isNum(f.text) && isNum(it.factors[j - 1].text) ? '·' : ''}${f.text}`).join('')}`).join('');
}
/** 整行写成 KaTeX（每个部件一个 \hl{名字}{…}，画面照它找到那一项） */
export function algLatex(alg, { lead = '' } = {}) {
  if (!alg.items.length) return `${lead}0`;
  const body = alg.items.map((it, i) => {
    const sg = i ? (it.sign < 0 ? ' - ' : ' + ') : it.sign < 0 ? '-' : '';
    const fs = it.factors.map((f, j) => `${j && isNum(f.text) && isNum(it.factors[j - 1].text) ? ' \\cdot ' : ''}\\hl{${f.key}}{${toTex(f.text)}}`).join('');
    return sg + fs;
  }).join('');
  return `${lead}${body}`;
}

/** 部件的名字在哪：{ i（第几项）, j（第几个因子；一项一个因子时是 0）, item } */
export function locate(alg, key) {
  for (let i = 0; i < alg.items.length; i++) {
    const it = alg.items[i];
    const j = it.factors.findIndex((f) => f.key === key);
    if (it.key === key || j >= 0) return { i, j: Math.max(0, j), item: it };
  }
  return null;
}
/** 写给人看的一项（带正负号，照学生看到的样子） */
const shown = (it, first = false) => `${it.sign < 0 ? '-' : first ? '' : '+'}${it.factors.map((f) => f.text).join('')}`;
const clone = (alg) => ({ n: alg.n, items: alg.items.map((it) => ({ ...it, factors: it.factors.map((f) => ({ ...f })) })) });

/**
 * 换顺序：key 挪到 before 前面（before 是 null 就挪到最后）。key 是一项（或那一项里的一个因子，挪的是整项）就在项之间挪；
 * level: 'prod' 时 key 是因子，在它那一项的因子之间挪。返回 { alg } 或 { error }（写法上做不了：不在同一项里、还在原处）
 */
export function reorder(alg, key, before = null, { level = 'sum' } = {}) {
  const at = locate(alg, key);
  if (!at) return { error: `式子里没有「${key}」` };
  const out = clone(alg);
  if (level === 'prod') {
    const it = out.items[at.i];
    if (it.factors.length < 2) return { error: '这一项只有一个因子，没有可换的' };
    const from = it.factors.findIndex((f) => f.key === key);
    if (from < 0) return { error: `「${key}」是整项：要在项之间挪` };
    if (before != null && !it.factors.some((f) => f.key === before)) return { error: '只能在同一项的因子之间挪' };
    const [f] = it.factors.splice(from, 1);
    const to = before == null ? it.factors.length : it.factors.findIndex((x) => x.key === before);
    it.factors.splice(to, 0, f);
    if (it.factors.map((x) => x.key).join() === alg.items[at.i].factors.map((x) => x.key).join()) return { error: '还在原处', quiet: true };
    return { alg: out };
  }
  if (before != null && !alg.items.some((it) => it.key === before)) return { error: '要拖到两项之间' };
  const [it] = out.items.splice(at.i, 1);
  const to = before == null ? out.items.length : out.items.findIndex((x) => x.key === before);
  out.items.splice(to, 0, it);
  if (out.items.map((x) => x.key).join() === alg.items.map((x) => x.key).join()) return { error: '还在原处', quiet: true };
  return { alg: out };
}

/**
 * 合并同类项：b 那一项并进 a 那一项（结果留在 a 的位置）。不是同类项（AB 和 BA）、还有括号没展开的给 { error }（判不了的 unknown: true）；
 * 合成 0 的那一项拿掉
 */
export function merge(alg, a, b) {
  const A = locate(alg, a), B = locate(alg, b);
  if (!A || !B) return { error: '式子里没有这一项' };
  if (A.i === B.i) return { error: '拖到另一项上（合并两项）', quiet: true };
  const sa = `${A.item.sign < 0 ? '-' : ''}${itemText(A.item)}`, sb = `${B.item.sign < 0 ? '-' : ''}${itemText(B.item)}`;
  const lk = likeTerms(sa, sb);
  if (lk.like === 'unknown') return { error: `判不了：${lk.why}`, unknown: true };
  if (!lk.like) return { error: lk.why };
  const out = clone(alg);
  const text = mergedText(lk.sum);
  const ia = A.i;
  if (text === '0') out.items.splice(ia, 1);
  else {
    const neg = text.startsWith('-');
    const t = splitTerms(neg ? text.slice(1) : text)[0];
    const key = A.item.key;
    out.items[ia] = { key, sign: neg ? -1 : 1, factors: t.factors.map((f, j) => ({ key: t.factors.length === 1 ? key : `${key}f${j + 1}`, text: f })) };
  }
  out.items.splice(out.items.findIndex((x) => x.key === B.item.key), 1);
  return { alg: out, text };
}

/** 展开一项（这一项里的括号、次方）：换成展开出来的几项（不合并，学生自己合并）。没有可展开的、判不了给 { error } */
export function expand(alg, key) {
  const at = locate(alg, key);
  if (!at) return { error: `式子里没有「${key}」` };
  const src = itemText(at.item);
  if (!src.includes('(')) return { error: '这一项没有括号可展开' };
  const ts = expandTerm(src);
  if (!ts) return { error: `判不了：${unknownWhy(src, '0')}`, unknown: true };
  const out = clone(alg);
  let n = out.n;
  const fresh = ts.map((t) => {
    const k = `t${++n}`;
    const fs = splitTerms(t.text)[0].factors;
    return { key: k, sign: t.sign * at.item.sign, factors: fs.map((f, j) => ({ key: fs.length === 1 ? k : `${k}f${j + 1}`, text: f })) };
  });
  out.items.splice(at.i, 1, ...fresh);
  out.n = n;
  return { alg: out, count: fresh.length };
}

/**
 * 学生这一下合不合法：变了以后的式子和变之前数学上相等吗（ncalg 判）。{ legal, why, unknown }：
 * 换顺序换出来不相等（矩阵的因子换了先后）、合并的不是同类项弹回去；判不了照实说
 */
export function judge(before, after, { what = '这一下' } = {}) {
  const r = equivalent(algText(before), algText(after));
  if (r === true) return { legal: true };
  if (r === 'unknown') return { legal: false, unknown: true, why: `判不了：${unknownWhy(algText(before), algText(after)) || '式子里有页面算不了的东西'}（${what}页面没让做）` };
  return { legal: false, why: `${what}以后和原来不相等` };
}
/** 换因子换出来不相等时说一句为什么（矩阵乘法不交换） */
export function swapWhy(before, key, after) {
  const at = locate(before, key);
  const it = at?.item;
  const ns = (it?.factors || []).filter((f) => /^[A-Z]/.test(f.text) && !/^[EIO](\^|$)/.test(f.text)).map((f) => f.text);
  return ns.length >= 2 ? `矩阵乘法不交换：${ns.join('、')} 换了先后，${shown(it, true)} 就变成另一样东西了` : `换了先后以后和原来不相等`;
}

// —— 挑战用的判断式（tex.rules.js 的 predicates）——
/** 都展开了：每一项都是单项（没有括号） */
export function isExpanded(alg) {
  return alg.items.every((it) => it.factors.every((f) => !f.text.includes('(')));
}
/** 合并完了：都展开了，而且没有两项是同类项 */
export function isMerged(alg) {
  if (!isExpanded(alg)) return false;
  const keys = alg.items.map((it) => { const p = polyOf(`${itemText(it)}`); return p.ok && p.poly.size === 1 ? [...p.poly.keys()][0] : null; });
  if (keys.some((k) => k == null)) return null;
  return new Set(keys).size === keys.length;
}
/** 一项一项写成规范的样子（合起来比先后用）：2·A·B → 2AB，A A → A^2 */
function normItems(text) {
  const ts = splitTerms(text);
  if (!ts) return null;
  return ts.map((t) => { const p = polyOf(t.factors.join('*')); if (!p.ok || p.poly.size !== 1) return `${t.sign < 0 ? '-' : '+'}${t.text}`; const [m] = p.poly.values(); const s = monoText(m, { sign: true }); return t.sign < 0 ? (s.startsWith('-') ? `+${s.slice(1)}` : `-${s}`) : s.startsWith('-') ? s : `+${s}`; });
}
/** 现在写成的样子和 target 一样（一项一项、照先后比；每一项按规范的写法比：2*A*B 和 2AB 一样） */
export function sameForm(alg, target) {
  const a = normItems(algText(alg)), b = normItems(target);
  if (!a || !b) return null;
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
/** 和 target 数学上相等（判不了是 null） */
export function equalsTo(alg, target) {
  const r = equivalent(algText(alg), target);
  return r === 'unknown' ? null : r;
}
