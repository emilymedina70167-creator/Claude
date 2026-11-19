// 检验里学生写的值和页面算出来的值怎么比（计划 4 第二节第 5 条，外部审过；纯函数，tests/check-values.test.js）。
//   - 数：分数、小数、百分数都认；和对的值一模一样的（0.75、75%、3/4）不管位数都对；
//     不一样的小数按学生写出来的位数四舍五入比、至少 2 位（16/3 写 5.33 对、5.3 不对）；百分数换成小数以后数位数（53.33% 是 4 位）
//   - 复杂度：O(nlogn)、O(n log₂n)、O(nlgn)、O(n log n) 一样；O(n^2)、O(n²)、O(n*n) 一样
//   - 序列、字：照 spec.js 的 normTokens（不管空格逗号括号大小写撇号，相同的数后出现的记成 49′）
// 读不懂的是 null：调用方写「读不懂」判没过（格式不对本来在交之前就挡住了），不当成过。
import { normTokens } from './spec.js';

const exactly = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// 学生写的数：{ v: 值, digits: 小数位数（百分数换成小数以后数）, frac: 是不是分数 }；读不懂 null
function readNum(student) {
  const s = String(student ?? '').trim().replace(/\s*([/%％])\s*/g, '$1').replace(/[−–—]/g, '-').replace(/％/g, '%').replace(/．/g, '.');
  let m;
  if ((m = /^(-?\d+)\/(\d+)$/.exec(s))) return Number(m[2]) === 0 ? null : { v: Number(m[1]) / Number(m[2]), digits: null, frac: true };
  if ((m = /^(-?)(\d*)(?:\.(\d+))?%$/.exec(s)) && (m[2] || m[3])) return { v: Number(s.slice(0, -1)) / 100, digits: (m[3] || '').length + 2, frac: false };
  if ((m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s)) && (m[2] || m[3])) return { v: Number(s.replace(/\.$/, '')), digits: (m[3] || '').length, frac: false };
  return null;
}

/**
 * 学生写的一个数（字）和算出来的值（数）比：true / false；读不懂 null。
 * 一模一样（相对 1e-9 以内）的总是对；分数只认一模一样；小数、百分数至少 2 位、按写出来的位数四舍五入以后等于对的值才对
 */
export function numMatch(student, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const r = readNum(student);
  if (!r || !Number.isFinite(r.v)) return null;
  if (exactly(r.v, value)) return true;
  if (r.frac || r.digits < 2) return false;
  // 四舍五入到 digits 位等于学生写的 ⇔ 两个数差不超过半个最小位（正好在一半上两种舍法都认）
  return Math.abs(r.v - value) <= 0.5 * 10 ** -r.digits + 1e-12 * Math.max(1, Math.abs(value));
}

// —— 复杂度 ——

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n' };

// 一项（没有 +）的规范写法：变量带次数按字母排、log 因子按字母排、2^n 和 n! 另列；系数不要；什么都没有是 1。读不懂 null
function termOf(t) {
  const pow = {}, logs = {}, extra = [];
  const add = (o, k, n) => { o[k] = (o[k] || 0) + n; };
  const pats = [
    [/log(?:\^(\d+))?([a-z])/y, (m) => add(logs, m[2], Number(m[1] || 1))],
    [/(\d+)\^([a-z])/y, (m) => extra.push(`${m[1]}^${m[2]}`)],
    [/([a-z])!/y, (m) => extra.push(`${m[1]}!`)],
    [/√([a-z])/y, (m) => add(pow, m[1], 0.5)],
    [/([a-z])(?:\^(\d+(?:\.\d+)?))?/y, (m) => add(pow, m[1], Number(m[2] || 1))],
    [/\d+(?:\.\d+)?/y, () => {}], // 系数：O(2n) 就是 O(n)
  ];
  let i = 0;
  while (i < t.length) {
    let hit = false;
    for (const [re, on] of pats) {
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
  let s = String(text ?? '').trim();
  if (!s) return null;
  s = s.replace(/[\s*·×⋅{}|]/g, '').replace(/（/g, '(').replace(/）/g, ')');
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]+/g, (m) => `^${[...m].map((c) => SUP[c]).join('')}`);
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
export function seqMatch(a, b, { set = false } = {}) {
  let x = normTokens(a), y = normTokens(b);
  if (set) { x = [...x].sort(); y = [...y].sort(); }
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

/**
 * 学生写的（字）和算出来的值比：按值的样子挑——数走 numMatch、复杂度走 bigO、数组和别的字走 seqMatch（先后算数）。
 * true / false；读不懂 null（数、复杂度才会读不懂）
 */
export function valueMatch(student, value) {
  if (typeof value === 'number') return numMatch(student, value);
  if (looksBigO(value)) {
    const s = bigO(student);
    return s === null ? null : s === bigO(value);
  }
  if (String(student ?? '').trim() === '') return false;
  return seqMatch(student, value);
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
