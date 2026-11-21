// 概率组件共用的数：一律是精确的分数（exact.js 的 Q，BigInt，不丢精度）。纯函数。
import { Q } from '../exact.js';

export const Q0 = new Q(0n), Q1 = new Q(1n);
export const qInt = (k) => new Q(BigInt(k));

// 十进制的写法 → 分数：0.35 → 7/20（照写的那几位，不过浮点）
function decimalQ(s) {
  const m = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] || '';
  const n = BigInt((m[2] || '0') + frac);
  return new Q(m[1] === '-' ? -n : n, 10n ** BigInt(frac.length));
}

/** 「0.2」「1/5」「20%」「.5」→ 分数；读不懂回 null */
export function readQ(src) {
  const s = String(src ?? '').replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/％/g, '%');
  if (!s) return null;
  if (s.endsWith('%')) { const v = decimalQ(s.slice(0, -1)); return v && v.div(qInt(100)); }
  const parts = s.split('/');
  if (parts.length > 2) return null;
  const a = decimalQ(parts[0]);
  if (!a) return null;
  if (parts.length === 1) return a;
  const b = decimalQ(parts[1]);
  return b && !b.zero ? a.div(b) : null;
}

export const qSum = (xs) => xs.reduce((s, x) => s.add(x), Q0);
export const qMin = (xs) => xs.reduce((m, x) => (x.cmp(m) < 0 ? x : m));
export const qMax = (xs) => xs.reduce((m, x) => (x.cmp(m) > 0 ? x : m));

/** 分母超过它就写小数（4 位有效数字）：读数、题面、表、树一个门槛（以前读数 1000、表 9999，2026-11-21 统一；
 *  9999 放得下掷四次骰子的 1296、抽牌的 2652 这种考试里常见的分母） */
export const BIG_DEN = 9999;
/** 给人看的：分母不大的写分数，大的写小数（4 位有效数字） */
export function qText(x, { maxDen = BIG_DEN } = {}) {
  if (x.d <= BigInt(maxDen)) return x.toString();
  return String(Number(x.toNumber().toPrecision(4)));
}
export function qTeX(x, { maxDen = BIG_DEN } = {}) {
  if (x.d <= BigInt(maxDen)) return x.d === 1n ? `${x.n}` : `${x.n < 0n ? '-' : ''}\\frac{${x.n < 0n ? -x.n : x.n}}{${x.d}}`;
  return String(Number(x.toNumber().toPrecision(4)));
}

/** 高斯消元（精确）。rows: [{ a: 系数, b: 右边 }]，N 个未知数。回 { M（化成最简的非零行，最后一列是右边）, pivots（每行的主元在第几列）, ok（没有 0 = 非零的矛盾行）} */
export function qReduce(rows, N) {
  const M = rows.map((r) => [...r.a, r.b]);
  const pivots = [];
  let r = 0;
  for (let c = 0; c < N && r < M.length; c++) {
    const k = M.findIndex((row, i) => i >= r && !row[c].zero);
    if (k < 0) continue;
    [M[r], M[k]] = [M[k], M[r]];
    const pv = M[r][c];
    M[r] = M[r].map((x) => x.div(pv));
    for (let i = 0; i < M.length; i++) {
      if (i === r || M[i][c].zero) continue;
      const f = M[i][c];
      M[i] = M[i].map((x, j) => x.sub(f.mul(M[r][j])));
    }
    pivots.push(c); r++;
  }
  const ok = M.slice(r).every((row) => row[N].zero);
  return { M: M.slice(0, r), pivots, ok };
}

// 学生写的小数、百分数 → 照写的那几位的小数（'52.6%' → '0.526'，Unicode 的减号换成普通的）；不是这两种写法回 null
function asDecimal(input) {
  const s = String(input).replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/％/g, '%');
  const m = /^([+-]?)(\d*)(?:\.(\d+))?(%?)$/.exec(s);
  if (!m || (!m[2] && !m[3]) || (!m[3] && !m[4])) return null; // 整数不算小数（3 对 3 是精确比的）
  if (!m[4]) return `${m[1]}${m[2] || '0'}.${m[3]}`;
  const whole = (m[2] || '').padStart(3, '0'), frac = m[3] || '';
  return `${m[1]}${whole.slice(0, -2).replace(/^0+(?=\d)/, '')}.${whole.slice(-2)}${frac}`;
}
// 小数（百分数换成小数以后）：至少两位小数、三位有效数字，四舍五入对得上才算。回 'ok' | 'short'（位数不够）| 'cut'（是截断的，不是四舍五入）| 'off' | null（不是小数）
export function decimalVerdict(input, value) {
  const d = asDecimal(input);
  if (d === null) return null;
  const [, int, frac] = /^[+-]?(\d*)\.(\d+)$/.exec(d);
  const places = frac.length, sig = (int + frac).replace(/^0+/, '').length, x = Number(d), k = 10 ** places;
  if (places < 2 || sig < 3) return 'short';
  if (Math.abs(x - value) <= 0.5 / k + 1e-12) return 'ok';
  // 截掉后面的（2/3 写 0.666）：往 0 的方向差不到一位
  if (Math.abs(x) < Math.abs(value) && Math.abs(value) - Math.abs(x) < 1 / k && Math.sign(x) === Math.sign(value)) return 'cut';
  return 'off';
}
/**
 * 学生填的一个数对不对（概率组件共用）：分数、小数、百分数都认，精确比；小数、百分数要位数够、四舍五入对得上。
 * traps：[{ value, text, tag }] 常见错法算出来的值，填了它就说那一句。回 { ok: true | false | null（读不懂，不判）, text, tag? }
 */
export function judgeNumber(value, input, traps = []) {
  const s = String(input ?? '').trim();
  const v = readQ(s);
  if (!v) return { ok: null, text: s ? '这个读不懂：写分数（2/3）、小数（0.25）或百分数（25%）。' : '还没填。' };
  if (v.cmp(value) === 0) return { ok: true, text: '对。' };
  const trap = traps.find((t) => t.value.cmp(v) === 0);
  if (trap) return { ok: false, text: trap.text, tag: trap.tag };
  const dec = decimalVerdict(s, value.toNumber());
  if (dec === 'ok') return { ok: true, text: '对。' };
  if (dec === 'short' && Math.abs(v.toNumber() - value.toNumber()) < 0.01) return { ok: false, text: '小数的位数不够：写成分数，或者至少三位有效数字。', tag: 'short' };
  if (dec === 'cut') return { ok: false, text: '最后一位要四舍五入，不是把后面的截掉（写成分数最稳）。', tag: 'cut' };
  return { ok: false, text: '不对。' };
}

/** 表、树上写的数：decimal 为真（主讲写的是小数）而且除得尽的写小数，别的写分数；分母太大的写四位有效数字 */
export function qShow(q, decimal = false) {
  if (decimal) { let d = q.d; while (d % 2n === 0n) d /= 2n; while (d % 5n === 0n) d /= 5n; const s = String(Number(q.toNumber().toPrecision(12))); if (d === 1n && s.length <= 8) return s; }
  return q.d > BigInt(BIG_DEN) ? String(Number(q.toNumber().toPrecision(4))) : q.toString();
}
/** 写进公式里的数：同上，分数用 \frac */
export const qShowTeX = (q, decimal = false) => (decimal && /^-?\d+(\.\d+)?$/.test(qShow(q, true)) ? qShow(q, true) : qTeX(q));

// ask 的写法（venn、ptree、joint、sim 同一套，2026-11-21 统一）：
//   "题目" 式子、"题目" = 式子（以前 sim 的写法）、题目 => 式子、只写式子（题目由组件自己补）
export function splitAsk(src) {
  const s = String(src ?? '').trim();
  const q = /^["“]([^"”]*)["”]\s*(?:=(?!=)\s*)?([\s\S]+)$/.exec(s);
  if (q) return { q: q[1].trim(), expr: q[2].trim() };
  const k = s.lastIndexOf('=>');
  if (k >= 0) return { q: s.slice(0, k).trim(), expr: s.slice(k + 2).trim() };
  return { q: '', expr: s };
}
