// 文字型的答案：计算机课里大量的答案不是数、向量、矩阵，而是
//   序列（遍历序列 A B D E C、调度顺序 P1 P3 P2、缺页的页号……）——type: seq
//   一串二进制 / 十六进制位（补码、IEEE 754、地址、掩码……）——type: bin / hex
// 这里只管读懂学生的写法、和标准答案比、说出哪几个不对；纯函数，不碰 DOM（tests/textcheck.test.js）。
import { isRadix } from './expr.js';

// —— 序列 ——

// 标准答案：一个或几个可接受的序列，用 | 隔开；序列里用空格、逗号、顿号、→ 分开（全是单个字符时也可以连着写）
export function parseSeqAnswer(src) {
  const alts = String(src ?? '').split('|').map((s) => splitSeq(s)).filter((a) => a.length);
  if (!alts.length) throw new Error('type: seq 的 answer 要写出序列，比如 answer: A B D E C（几种都对时用 | 隔开）');
  return alts;
}

const SEP = /[\s,，、;；→>]+|->|=>/;
const clean = (s) => String(s ?? '').replace(/[()（）[\]【】{}]/g, ' ').trim();

/**
 * 学生写的 → 一个个元素。有分隔符就按分隔符切；没有分隔符时，标准答案全是单个字符（如 ABDEC）就一个字一个字切，
 * 否则当成一个元素。大小写不管（a 和 A 一样），全角字母数字换成半角
 */
export function splitSeq(text, { single = false } = {}) {
  const s = clean(halfWidth(text));
  if (!s) return [];
  const parts = s.split(SEP).filter(Boolean);
  if (parts.length === 1 && single && [...parts[0]].length > 1) return [...parts[0]];
  return parts;
}

const norm = (t) => halfWidth(t).trim().toUpperCase();

function halfWidth(s) {
  return String(s ?? '').replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
}

/**
 * 序列判分。alts：parseSeqAnswer 的结果。返回 { ok, tokens（学生的元素）, wrong（不对的位置，从 0 数）, msg }。
 * 几种答案都对时，按「从头开始对上最多」的那一种指出错处。提示只说哪几个位置不对，不说应该是什么（不替学生做）
 */
export function checkSeq(text, alts) {
  const single = alts.every((a) => a.every((t) => [...t].length === 1));
  const tokens = splitSeq(text, { single });
  if (!tokens.length) return { ok: false, tokens, wrong: [], msg: '还没写序列。' };
  const g = tokens.map(norm);
  let best = null;
  for (const alt of alts) {
    const a = alt.map(norm);
    if (a.length === g.length && a.every((x, i) => x === g[i])) return { ok: true, tokens, wrong: [], msg: alts.length > 1 && alt !== alts[0] ? '这也是一种正确的顺序。' : '' };
    let prefix = 0;
    while (prefix < a.length && prefix < g.length && a[prefix] === g[prefix]) prefix++;
    const wrong = g.map((x, i) => (x !== a[i] ? i : -1)).filter((i) => i >= 0);
    if (!best || prefix > best.prefix) best = { a, prefix, wrong };
  }
  const { a, prefix, wrong } = best;
  let msg;
  if (g.length !== a.length) msg = `元素个数不对：你写了 ${g.length} 个，应该是 ${a.length} 个。${prefix ? `前 ${prefix} 个是对的。` : ''}`;
  else msg = prefix ? `前 ${prefix} 个是对的，从第 ${prefix + 1} 个开始不对（有 ${wrong.length} 个位置不对，已标红）。` : `第 1 个就不对（有 ${wrong.length} 个位置不对，已标红）。`;
  return { ok: false, tokens, wrong, msg };
}

// —— 二进制 / 十六进制 ——

const DIGITS = { 2: /^[01]+$/, 16: /^[0-9A-F]+$/ };
const NAME = { 2: '二进制', 16: '十六进制' };

/**
 * 标准答案（数，或者 bin() / hex() 的结果）→ { digits, base, width }。
 * width：要求的位数（写了 bits: 或者答案本身补足了前导 0 时）；0 表示不管前导 0
 */
export function radixAnswer(value, base, width = 0) {
  if (isRadix(value)) {
    if (value.base !== base) throw new Error(`答案是${NAME[value.base]}（${value.base === 2 ? 'bin' : 'hex'}()），type 却写了 ${base === 2 ? 'bin' : 'hex'}`);
    const w = width || (/^0/.test(value.digits) && value.digits.length > 1 ? value.digits.length : 0);
    if (width && value.digits.length !== width) throw new Error(`答案有 ${value.digits.length} 位，bits: 写的是 ${width} 位`);
    return { digits: value.digits, base, width: w };
  }
  const ok = typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value));
  if (!ok) throw new Error(`type: ${base === 2 ? 'bin' : 'hex'} 的答案要是整数（或者 bin()、hex() 的结果）`);
  let big = BigInt(value);
  if (big < 0n) {
    if (!width) throw new Error('答案是负数：写 bits:（几位），按补码比较');
    big += 1n << BigInt(base === 2 ? width : width * 4);
    if (big < 0n) throw new Error(`${value} 用 ${width} 位放不下`);
  }
  const digits = big.toString(base).toUpperCase().padStart(width, '0');
  if (width && digits.length > width) throw new Error(`答案 ${value} 有 ${digits.length} 位，比 bits: ${width} 长`);
  return { digits, base, width };
}

/** 学生写的 → 一串数字（大写）。认 0x / 0b 前缀、H / B 后缀，空格、_、逗号分组都去掉。写错了抛出中文原因 */
export function readRadix(text, base) {
  let s = halfWidth(text).trim().toUpperCase().replace(/[\s_,，']/g, '');
  if (!s) throw new Error('还没写。');
  if (base === 16) s = s.replace(/^0X/, '').replace(/H$/, '');
  else s = s.replace(/^0B/, '').replace(/B$/, '');
  if (!s) throw new Error('还没写。');
  if (!DIGITS[base].test(s)) {
    const bad = [...s].find((c) => !DIGITS[base].test(c));
    throw new Error(base === 2 ? `二进制只能写 0 和 1（这里有「${bad}」）。` : `十六进制只能写 0–9 和 A–F（这里有「${bad}」）。`);
  }
  return s;
}

/**
 * 判分：位数要求（width）不为 0 时位数也得对（补码、编码题前导 0 有意义）；否则比数值。
 * 返回 { ok, digits（学生的）, wrong（不对的位，从左数、从 0 开始）, msg }
 */
export function checkRadix(text, ans) {
  let digits;
  try { digits = readRadix(text, ans.base); } catch (e) { return { ok: false, digits: '', wrong: [], msg: e.message, bad: true }; }
  const unit = ans.base === 2 ? '位' : '位（十六进制）';
  if (ans.width) {
    if (digits.length !== ans.width) return { ok: false, digits, wrong: [], msg: `要写 ${ans.width} ${unit}，你写了 ${digits.length} 位。` };
    const wrong = [...digits].map((c, i) => (c !== ans.digits[i] ? i : -1)).filter((i) => i >= 0);
    return wrong.length ? { ok: false, digits, wrong, msg: `有 ${wrong.length} 位不对（已标红；从左边数第 ${wrong.slice(0, 4).map((i) => i + 1).join('、')}${wrong.length > 4 ? '……' : ''} 位）。` } : { ok: true, digits, wrong: [], msg: '' };
  }
  const strip = (s) => s.replace(/^0+(?=.)/, '');
  const g = strip(digits), a = strip(ans.digits);
  if (g === a) return { ok: true, digits, wrong: [], msg: '' };
  // 位数一样时逐位指出；不一样时只说位数
  if (g.length !== a.length) return { ok: false, digits, wrong: [], msg: `位数不对：去掉前导 0 后应该有 ${a.length} 位，你的有 ${g.length} 位。` };
  const off = digits.length - g.length;
  const wrong = [...g].map((c, i) => (c !== a[i] ? i + off : -1)).filter((i) => i >= 0);
  return { ok: false, digits, wrong, msg: `有 ${wrong.length} 位不对（已标红）。` };
}

/** 四位一组写出来（显示答案、学生输入的回显用） */
export function groupDigits(digits) {
  const out = [];
  for (let i = digits.length; i > 0; i -= 4) out.unshift(digits.slice(Math.max(0, i - 4), i));
  return out.join(' ');
}
