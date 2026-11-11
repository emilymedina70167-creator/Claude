// 照拨盘挑一个（主线第二轮 C）：{t: was holding | am holding | will be holding}——拨盘 t 现在是第几个，就写第几段。
// 纯函数，不碰 DOM，有测试（tests/stage-pick.test.js）。话、贴的字、题卡、挑战的字（script.js 的 parseRich 交 k: 'pick'）、
// 句子（types/sentence.js：拨盘一变照 rewrite 重排）都用这一份。
//
// 拨盘两种：拨数的（dial k = 1 range=1..3：从 range 的头一个数起）、拨词的（dial t = 现在 options="过去 现在 将来"：
// 里面存的是第几个，1 起；写出来、比较都是那个词）。段数要和拨盘能拨到的个数一样。能套一层（段里再写 {z: … | …}）。

const HEAD = /^\s*([A-Za-z_]\w*)\s*[:：]/;

/** 从 s[i]（是 {）起找配对的 }（能套）：返回 } 的位置，没有是 -1 */
export function closeOf(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') { depth--; if (depth === 0) return j; }
  }
  return -1;
}
// 最外一层的 | 切开（套着的 {…} 里的不切）
function splitAlts(body) {
  const out = [];
  let depth = 0, buf = '';
  for (const ch of body) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if ((ch === '|' || ch === '｜') && depth === 0) { out.push(buf); buf = ''; } else buf += ch;
  }
  out.push(buf);
  return out.map((x) => x.trim());
}
/**
 * 一对 {} 里面的字是不是「照拨盘挑一个」：{ name, alts: [每一段的原文（可能套着一层）] }；不是（{k}、{a.3}、{A + B}）是 null。
 * 要有名字、冒号、至少一个 |（{x: y} 没有 | 的照旧当字）
 */
export function parsePick(inner) {
  const m = String(inner ?? '').match(HEAD);
  if (!m) return null;
  const body = String(inner).slice(m[0].length);
  const alts = splitAlts(body);
  return alts.length >= 2 ? { name: m[1], alts } : null;
}
/**
 * 一段字拆成：[{ k: 'text', v } | { k: 'pick', name, alts, raw }]（只拆最外一层；别的 {…} 留在 text 里照旧）。
 * { 没收尾的那一截照字留着（话里别的写法自己会报）
 */
export function splitPicks(text) {
  const s = String(text ?? '');
  const out = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    // 公式 $…$ 里的花括号是公式自己的（$\{x: Ax = 0 | x \ne 0\}$ 是集合，不是挑一段）：整段照原样过去
    if (s[i] === '$') { const j = s.indexOf('$', i + 1); if (j > i + 1) { buf += s.slice(i, j + 1); i = j; continue; } }
    if (s[i] === '{') {
      const j = closeOf(s, i);
      const p = j > 0 ? parsePick(s.slice(i + 1, j)) : null;
      if (p) { if (buf) out.push({ k: 'text', v: buf }); buf = ''; out.push({ k: 'pick', ...p, raw: s.slice(i, j + 1) }); i = j; continue; }
    }
    buf += s[i];
  }
  if (buf) out.push({ k: 'text', v: buf });
  return out;
}
/** 有没有「照拨盘挑一个」 */
export const hasPick = (text) => splitPicks(text).some((p) => p.k === 'pick');

/** 拨词的拨盘（dial t = 现在 options="…"）用在只认数的地方：当场报，不默默当成第几个 */
export const wordDialError = (name, x) => `${name} 是拨词的拨盘（${x.options.join(' / ')}），不是数：这里要一个拨数的（dial k = 1 range=1..5）`;
/** 拨盘现在写出来是什么：拨词的是那个词，拨数的是数 */
export const varText = (x) => (x?.options ? x.options[x.v - 1] ?? String(x.v) : String(x?.v ?? ''));
/** 拨盘能拨到几个、现在是第几个（0 起）；拨数的拨盘不是整数格的（没有）是 null */
export function dialSteps(x) {
  if (!x) return null;
  if (x.options) return { n: x.options.length, i: x.v - 1 };
  if (![x.lo, x.hi, x.v].every(Number.isInteger)) return null;
  return { n: x.hi - x.lo + 1, i: x.v - x.lo };
}
const names = (x) => (x.options ? x.options.join(' / ') : `${x.lo}～${x.hi}`);

/**
 * 写得对不对（写下新的一行时查）：名字是拨盘、段数和拨盘能拨到的个数一样、最多套一层、段里没有多余的 { } |。
 * vars 是场景的拨盘表（Map：名字 → { v, lo, hi, options? }）。错了抛错，话给老师看
 */
export function checkPick(p, vars, depth = 0) {
  const x = vars.get(p.name);
  const shown = `{${p.name}: ${p.alts.join(' | ')}}`;
  if (!x) throw new Error(`「${shown}」：没有叫「${p.name}」的拨盘（先写 dial ${p.name} = … options="…"；有的是：${[...vars.keys()].join('、') || '还没有'}）`);
  const st = dialSteps(x);
  if (!st) throw new Error(`「${shown}」：拨盘 ${p.name} 不是一格一格的整数，挑不了`);
  if (p.alts.length !== st.n) throw new Error(`「${shown}」写了 ${p.alts.length} 段，拨盘 ${p.name} 能拨到 ${st.n} 个（${names(x)}）：一个一段，用 | 隔开`);
  for (const a of p.alts) {
    const inner = splitPicks(a);
    for (const q of inner) {
      if (q.k === 'pick') {
        if (depth >= 1) throw new Error(`「${shown}」套得太深：最多套一层`);
        if (q.name === p.name) throw new Error(`「${shown}」：里面那一层要跟着另一个拨盘（不是 ${p.name} 自己）`);
        checkPick(q, vars, depth + 1);
      } else if (/[{}]/.test(q.v)) throw new Error(`「${shown}」的段里只能写字，或者再套一层 {另一个拨盘: … | …}：「${a}」里的 {…} 不行`);
    }
  }
}
/** 一个「照拨盘挑一个」现在写出来是什么（套着的一起解开）；拨盘不在、挑不了时照原文 */
export function pickNow(p, vars) {
  const st = dialSteps(vars.get(p.name));
  if (!st || st.i < 0 || st.i >= p.alts.length) return p.raw ?? `{${p.name}: ${p.alts.join(' | ')}}`;
  return fillPicks(p.alts[st.i], vars);
}
/** 一段字里的「照拨盘挑一个」都换成现在的字（别的 {…} 不动） */
export function fillPicks(text, vars) {
  return splitPicks(text).map((p) => (p.k === 'pick' ? pickNow(p, vars) : p.v)).join('');
}
/** 用到了哪几个拨盘（连套着的） */
export function pickDeps(text) {
  const out = new Set();
  const walk = (t) => { for (const p of splitPicks(t)) if (p.k === 'pick') { out.add(p.name); p.alts.forEach(walk); } };
  walk(text);
  return [...out];
}
