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
