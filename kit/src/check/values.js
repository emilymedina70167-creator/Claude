// 检验里学生写的值和页面算出来的值怎么比（计划 4 第二节第 5 条，外部审过；纯函数，tests/check-values.test.js）。
//   - 数：分数、小数、百分数都认；和对的值一模一样的（0.75、75%、3/4）不管位数都对；
//     不一样的小数按学生写出来的位数四舍五入比，要至少 2 位小数、而且至少 3 位有效数字（16/3 写 5.33 对、5.3 不对；
//     0.0533 写 5% 不对、5.33% 对；0.004 写 0.00 不对）；百分数换成小数以后数小数位数（53.33% 是 4 位），有效数字照写出来的数
//   - 复杂度：O(nlogn)、O(n log₂n)、O(nlgn)、O(n log n) 一样；O(n^2)、O(n²)、O(n*n) 一样
//   - 序列、字：照 spec.js 的 normTokens（不管空格逗号括号大小写，箭头 → -> ⇒ > 也是分隔，字的序列另认 - —；相同的数后出现的记成 49′）；
//     撇号照 sameSeq：学生一个撇号都没写只比数，写了连撇号的位置一起比（引擎交的 final、pass#、round# 带撇号）
// 读不懂的是 null：调用方写「读不懂」判没过（格式不对本来在交之前就挡住了），不当成过。
//   - 读之前先 cleanInput：全角转半角（NFKC：iPad 中文键盘打出来的 ０.６、3／5），去掉末尾的 。.，,；;（0.6。、12,、2 5 8。）；
//     交之前（expectProblems、slotProblems）和判的时候用同一个，交之前挡得住的判的时候也读得懂
import { normTokens, sameSeq } from './spec.js';
import { normalizeFormula } from '../formula.js';
import { evaluate } from '../expr.js';

const SUP_RUN = /[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]+/g;
const SUP_OF = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n' };

/**
 * 全角转半角（NFKC）。上标先写成 ^…（NFKC 会把 n² 变成 n2、2ⁿ 变成 2n，复杂度就读错了）；½ 拆出来的分数斜线 ⁄ 换成 /
 */
export function halfWidth(text) {
  return String(text ?? '').replace(SUP_RUN, (m) => `^${[...m].map((c) => SUP_OF[c]).join('')}`).normalize('NFKC').replace(/⁄/g, '/');
}

/** 学生写的数、序列、复杂度读之前：全角转半角，去掉首尾空白和末尾的 。.，,；;（去完什么都不剩就留着原样，照旧读不懂） */
export function cleanInput(text) {
  const s = halfWidth(text).trim();
  const t = s.replace(/[\s。.，,；;、]+$/u, '');
  return t || s;
}

// 有一边不是有限数就不相等（dr-final-fix 第 1 条）
const exactly = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// 学生写的数：{ v: 值, digits: 小数位数（百分数换成小数以后数）, sig: 有效数字几位, frac: 是不是分数 }；读不懂 null
function readNum(student) {
  const s = cleanInput(student).replace(/\s*([/%％])\s*/g, '$1').replace(/[−–—]/g, '-').replace(/％/g, '%').replace(/．/g, '.');
  let m;
  // 有效数字：去掉小数点、去掉开头的 0（末尾的 0 算），百分数换成小数不变
  const sigOf = (int, dec) => `${int}${dec}`.replace(/^0+/, '').length;
  if ((m = /^(-?\d+)\/(\d+)$/.exec(s))) return Number(m[2]) === 0 ? null : { v: Number(m[1]) / Number(m[2]), digits: null, frac: true };
  if ((m = /^(-?)(\d*)(?:\.(\d+))?%$/.exec(s)) && (m[2] || m[3])) return { v: Number(s.slice(0, -1)) / 100, digits: (m[3] || '').length + 2, sig: sigOf(m[2], m[3] || ''), frac: false };
  if ((m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s)) && (m[2] || m[3])) return { v: Number(s.replace(/\.$/, '')), digits: (m[3] || '').length, sig: sigOf(m[2], m[3] || ''), frac: false };
  return null;
}

// 数读不出来时的另外几种写法（dr-final-fix 第 4 条：地址、Cache、子网的答案本来就是十六进制；高数的最后结果多是 π/4、e^2）：
//   十六进制 0x3A3C、3A3CH、3a3ch；二进制 0b1011、1011B；1e5 这样的科学计数；别的照计划 3 的读法（formula.js 的
//   normalizeFormula(…, { real: true })，弧度）读成式子再算：π/4、e^2、ln 2、√2/2、2^10、1/√2。
// 回 { v }（v 可能不是有限数：1/0、10^400——读得懂，判的时候不算对）；读不懂 null。
// 两个数之间只隔着空格的（2 3）、两个小数点的（5.3.3）不当成乘：那是写了一串，不是一个数；带单位的（200ns、1KB）式子里不认识那几个字母，读不懂
const HEX = /^(?:0x([0-9a-f]+)|([0-9a-f]+)h)$/i;
const BIN = /^(?:0b([01]+)|([01]+)b)$/i;
const SCI = /^-?\d+(?:\.\d+)?e[+-]?\d+$/i;
function readOther(student) {
  const s = cleanInput(student);
  const t = s.replace(/\s+/g, '');
  if (!t) return null;
  let m;
  // 后缀的写法（王道的 1011B、3A3CH）另记「同样的数字当十进制读」plain：100B 也可能是 100 个字节、5h 是 5 小时（numMatch 看）
  const plainOf = (digits) => (digits !== undefined && /^\d+$/.test(digits) ? Number(digits) : undefined);
  if ((m = BIN.exec(t))) return { v: parseInt(m[1] ?? m[2], 2), plain: plainOf(m[2]), unit: 'B' };
  if ((m = HEX.exec(t))) return { v: parseInt(m[1] ?? m[2], 16), plain: plainOf(m[2]), unit: 'H' };
  if (SCI.test(t)) return { v: Number(t) };
  if (/\d\s+\d/.test(s) || /\d*\.\d*\./.test(t)) return null; // 5.3.3 也不读成 5.3 × .3
  try {
    const v = evaluate(normalizeFormula(s, { real: true }), {});
    return typeof v === 'number' && !Number.isNaN(v) ? { v } : null;
  } catch { return null; }
}

/**
 * 学生写的一个数（字）和算出来的值（数）比：true / false；读不懂 null。
 * 一模一样（相对 1e-9 以内）的总是对；分数只认一模一样；小数、百分数要至少 2 位小数、至少 3 位有效数字，
 * 按写出来的位数四舍五入以后等于对的值才对。十六进制、二进制、式子（readOther）只认一模一样（相对 1e-9），算出来不是有限数的不对
 */
export function numMatch(student, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const r = readNum(student);
  if (!r || !Number.isFinite(r.v)) {
    const o = readOther(student);
    if (!o) return null;
    // 后缀的二进制、十六进制按进制读对不上、同样的数字当十进制读却对得上（对的值 100 写 100B；5 写 5h）：
    // 分不清是进制还是单位，回 UNSURE（判的时候待核，不当对也不当错；ambiguousWhy 说）
    if (o.plain !== undefined && exactly(o.plain, value)) return UNSURE;
    return exactly(o.v, value);
  }
  if (exactly(r.v, value)) return true;
  if (r.frac || r.digits < 2 || r.sig < 3) return false;
  // 四舍五入到 digits 位等于学生写的 ⇔ 两个数差不超过半个最小位（正好在一半上两种舍法都认）
  return Math.abs(r.v - value) <= 0.5 * 10 ** -r.digits + 1e-12 * Math.max(1, Math.abs(value));
}

// —— 复杂度 ——

// 一项（没有 +）的规范写法：变量带次数按字母排、log 因子按字母排、2^n 和 n! 另列；系数不要；什么都没有是 1。读不懂 null。
// 数只认在一项的开头（系数 2n、底数 2^n）：跟在变量、log 后面的数（n2 是 n² 写漏了 ^ 还是 n·2？）读不懂，不当成系数放过
function termOf(t) {
  const pow = {}, logs = {}, extra = [];
  const add = (o, k, n) => { o[k] = (o[k] || 0) + n; };
  const pats = [
    [/log(?:\^(\d+))?([a-z])/y, (m) => add(logs, m[2], Number(m[1] || 1))],
    [/(\d+)\^([a-z])/y, (m) => extra.push(`${m[1]}^${m[2]}`), true],
    [/([a-z])!/y, (m) => extra.push(`${m[1]}!`)],
    [/√([a-z])/y, (m) => add(pow, m[1], 0.5)],
    [/([a-z])(?:\^(\d+(?:\.\d+)?))?/y, (m) => add(pow, m[1], Number(m[2] || 1))],
    [/\d+(?:\.\d+)?/y, () => {}, true], // 系数：O(2n) 就是 O(n)
  ];
  let i = 0;
  while (i < t.length) {
    let hit = false;
    for (const [re, on, lead] of pats) {
      if (lead && i > 0) continue; // 数开头的只在一项的最前面
      re.lastIndex = i;
      const m = re.exec(t);
      if (m && m[0]) { on(m); i = re.lastIndex; hit = true; break; }
    }
    if (!hit) return null;
  }
  const vars = Object.keys(pow).sort().map((v) => (pow[v] === 1 ? v : `${v}^${pow[v]}`));
  const lg = Object.keys(logs).sort().map((v) => `log${logs[v] === 1 ? '' : `^${logs[v]}`}${v}`);
  return [...vars, ...lg, ...extra.sort()].join('') || '1';
}

/** 复杂度的规范写法（O(nlogn)、O(n^2)、O(e+n)）；O( ) 不写也认；读不懂 null */
export function bigO(text) {
  let s = cleanInput(text);
  if (!s) return null;
  s = s.replace(/[\s*·×⋅{}|]/g, '').replace(/（/g, '(').replace(/）/g, ')');
  const m = /^[oOΘθ]\((.*)\)$/.exec(s);
  let body = (m ? m[1] : s).toLowerCase();
  if (!body) return null;
  body = body
    .replace(/log_?[₀-₉]+/g, 'log').replace(/log_?\d+(?=[a-z(^])/g, 'log') // log₂n、log2n、log_2n 底数不管
    .replace(/lg|ln/g, 'log')
    .replace(/\(log([a-z])\)\^(\d+)/g, 'log^$2$1') // (logn)^2 → log^2n
    .replace(/log(\^\d+)?\(([a-z])\)/g, 'log$1$2'); // log(n) → logn
  const terms = body.split('+').map(termOf);
  if (terms.some((x) => x === null)) return null;
  return `O(${[...new Set(terms)].sort().join('+')})`;
}

const looksBigO = (v) => typeof v === 'string' && /^\s*[oOΘθ]\s*[(（]/.test(v) && bigO(v) !== null;

/** 两个序列一样不一样（normTokens 以后）；set：先后不论 */
const cleanSide = (v) => (typeof v === 'string' ? cleanInput(v) : v);
export function seqMatch(a, b, { set = false } = {}) {
  return sameSeq(cleanSide(a), cleanSide(b), { set });
}

/** numMatch / valueMatch 的第四种结论：读得懂，但分不清是进制还是单位（100B、5h），判的时候待核 */
export const UNSURE = 'unsure';
/** UNSURE 时那一项写什么 */
export function ambiguousWhy(student) {
  const s = cleanInput(student);
  const o = readOther(s);
  if (!o || o.plain === undefined) return `「${s}」页面判不了，主讲会核`;
  return o.unit === 'B' ? `「${s}」是二进制还是 ${o.plain} 个字节？页面判不了，主讲会核` : `「${s}」是十六进制还是 ${o.plain} 小时？页面判不了，主讲会核`;
}

/**
 * 学生写的（字）和算出来的值比：按值的样子挑——数走 numMatch、复杂度走 bigO、数组和别的字走 seqMatch（先后算数）。
 * true / false；读不懂 null（数、复杂度才会读不懂）；分不清进制还是单位 UNSURE（numMatch）
 */
export function valueMatch(student, value) {
  if (typeof value === 'number') return numMatch(student, value);
  if (looksBigO(value)) {
    const s = bigO(student);
    return s === null ? null : s === bigO(value);
  }
  if (cleanInput(student) === '') return false;
  return seqMatch(student, value);
}

const NUM_TOK = /^-?\d+(?:\.\d+)?′*$/;
// 对的值是一串数（7 1 0、[7, 0, 1]、只有一个数的数组）：学生写的也要每个都是数
const numSeq = (v) => typeof v !== 'number' && !looksBigO(v) && (() => { const t = normTokens(cleanSide(v)); return t.length > 0 && t.every((x) => NUM_TOK.test(x)); })();

/**
 * 交之前：学生写的读不读得懂（按对的值的样子：数、复杂度、一串数）。读得懂（或没写、或是字）是 ''，读不懂是要说的话。
 * 不说要写几个（换出的页有几个就等于说了缺页数）
 */
export function readProblem(student, value, label = '') {
  const s = cleanInput(student);
  if (!s) return '';
  const name = `「${label}」`;
  if (typeof value === 'number') return readNum(s) || readOther(s) ? '' : `${name}只写数（分数、小数、百分数），不写单位`;
  if (looksBigO(value)) return bigO(s) !== null ? '' : `${name}写成 O(n^2) 这样`;
  if (numSeq(value)) return normTokens(s).every((x) => NUM_TOK.test(x)) ? '' : `${name}写一串数，用空格或逗号隔开`;
  return '';
}

/** 读不懂时那一项写什么（按值的样子） */
export function unreadWhy(value) {
  return looksBigO(value) ? '读不懂：写成 O(n log n) 这样' : '读不懂：写数、分数或小数';
}

/** 两个算出来的值一样不一样（错法、外部写的错答案和对的一样时那一条不用） */
export function sameResult(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return exactly(a, b);
  if (looksBigO(a) || looksBigO(b)) return bigO(String(a)) !== null && bigO(String(a)) === bigO(String(b));
  if (typeof a === 'number' || typeof b === 'number') {
    const n = typeof a === 'number' ? a : b, o = typeof a === 'number' ? b : a;
    const r = Array.isArray(o) ? null : readNum(o);
    return !!r && exactly(r.v, n);
  }
  return seqMatch(a, b);
}
