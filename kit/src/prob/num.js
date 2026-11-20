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

/** 给人看的：分母不大的写分数，大的写小数（4 位有效数字） */
export function qText(x, { maxDen = 1000 } = {}) {
  if (x.d <= BigInt(maxDen)) return x.toString();
  return String(Number(x.toNumber().toPrecision(4)));
}
export function qTeX(x, { maxDen = 1000 } = {}) {
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

// 小数：至少两位小数、三位有效数字，四舍五入对得上才算
function decimalOk(input, value) {
  const m = /^[+-]?(\d*)\.(\d+)$/.exec(input.replace(/\s+/g, ''));
  if (!m) return null;
  const places = m[2].length, sig = (m[1] + m[2]).replace(/^0+/, '').length;
  if (places < 2 || sig < 3) return 'short';
  const k = 10 ** places;
  return Math.abs(Number(input) - value.toNumber()) <= 0.5 / k + 1e-12 ? 'ok' : 'off';
}
/**
 * 学生填的一个数对不对（概率组件共用）：分数、小数、百分数都认，精确比；小数要位数够、四舍五入对得上。
 * traps：[{ value, text, tag }] 常见错法算出来的值，填了它就说那一句。回 { ok: true | false | null（读不懂，不判）, text, tag? }
 */
export function judgeNumber(value, input, traps = []) {
  const s = String(input ?? '').trim();
  const v = readQ(s);
  if (!v) return { ok: null, text: s ? '这个读不懂：写分数（2/3）、小数（0.25）或百分数（25%）。' : '还没填。' };
  if (v.cmp(value) === 0) return { ok: true, text: '对。' };
  const trap = traps.find((t) => t.value.cmp(v) === 0);
  if (trap) return { ok: false, text: trap.text, tag: trap.tag };
  const dec = decimalOk(s, value);
  if (dec === 'ok') return { ok: true, text: '对。' };
  if (dec === 'short' && Math.abs(v.toNumber() - value.toNumber()) < 0.01) return { ok: false, text: '小数的位数不够：写成分数，或者至少三位有效数字。', tag: 'short' };
  return { ok: false, text: '不对。' };
}

/** 表、树上写的数：decimal 为真（主讲写的是小数）而且除得尽的写小数，别的写分数；分母太大的写四位有效数字 */
export function qShow(q, decimal = false) {
  if (decimal) { let d = q.d; while (d % 2n === 0n) d /= 2n; while (d % 5n === 0n) d /= 5n; const s = String(Number(q.toNumber().toPrecision(12))); if (d === 1n && s.length <= 8) return s; }
  return q.d > 9999n ? String(Number(q.toNumber().toPrecision(4))) : q.toString();
}
/** 写进公式里的数：同上，分数用 \frac */
export const qShowTeX = (q, decimal = false) => (decimal && /^-?\d+(\.\d+)?$/.test(qShow(q, true)) ? qShow(q, true) : qTeX(q));
