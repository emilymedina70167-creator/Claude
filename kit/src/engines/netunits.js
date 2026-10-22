// 计网题里的量：数据率、长度、时间、距离、信号传播速率。写法放宽（10Mb/s、10Mbps、1518B、48bit、2km、
// 200m/μs、2×10^8 m/s、200000km/s、51.2μs、270ms），读成国际单位（b/s、bit、s、m、m/s）；写错报中文原因。
// 还有写成人看的样子（自动挑 μs / ms / s、Mb/s / kb/s）。csma / dv / switch / util / rtt 共用。纯函数（tests/cn2-engine.test.js）。

const SUP = { '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9 };
const supNum = (s) => Number((s[0] === '⁻' ? '-' : '') + [...s.replace(/^[⁻⁺]/, '')].map((c) => SUP[c]).join(''));

// 去掉浮点的毛刺：2e-5 × 1e7 = 200.00000000000003 → 200
export const clean = (x) => (Number.isFinite(x) ? Number(Number(x).toPrecision(12)) : x);

/** 开头的数：12、51.2、2×10^8、2*10^8、2x10⁸、10^7、2e8、3/4 → { value, rest }；读不出数是 null */
export function leadNumber(src) {
  const s = String(src ?? '').trim().replace(/，/g, ',').replace(/−/g, '-');
  let m = /^10\s*(?:\^\s*\(?\s*([+-]?\d+)\s*\)?|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))/.exec(s);
  if (m) return { value: 10 ** (m[1] !== undefined ? Number(m[1]) : supNum(m[2])), rest: s.slice(m[0].length).trim() };
  m = /^([+-]?\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?)(?!\s*[a-zA-Zμµ]))?/.exec(s);
  if (!m) return null;
  let value = Number(m[1]);
  if (m[2] !== undefined) value /= Number(m[2]);
  let rest = s.slice(m[0].length);
  const e = /^\s*(?:[×xX*·]\s*10\s*(?:\^\s*\(?\s*([+-]?\d+)\s*\)?|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))|[eE]([+-]?\d+))/.exec(rest);
  if (e) { value *= 10 ** (e[1] !== undefined ? Number(e[1]) : e[2] !== undefined ? supNum(e[2]) : Number(e[3])); rest = rest.slice(e[0].length); }
  return { value, rest: rest.trim() };
}

const PRE = { '': 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6, g: 1e9, G: 1e9 };

/** 数据率 → b/s。10Mb/s、10Mbps、100 Mbit/s、1Gb/s、128kb/s、2MB/s（字节）、10^7 b/s */
export function parseRate(src, what = 'rate: 数据率') {
  const n = leadNumber(src);
  const bad = () => new Error(`${what}写成 10Mb/s、100Mbps、128kb/s 这样（数加单位；现在是「${src ?? ''}」）`);
  if (!n || !(n.value > 0)) throw bad();
  const u = n.rest.replace(/\s+/g, '').replace(/比特\/秒|bit\/s|bits\/s/i, 'b/s').replace(/字节\/秒/, 'B/s');
  const m = /^([kKmMgG]?)(b|B|bit)(\/s|ps)$/.exec(u) || /^([kKmMgG]?)(bit)(s\/s)$/.exec(u);
  if (!m) throw bad();
  return clean(n.value * PRE[m[1]] * (m[2] === 'B' ? 8 : 1));
}

/** 长度（数据量）→ bit。1518B、1518字节、48bit、48比特、200b、1KB（1024 字节）。bare：没写单位时当成什么（'bit' / 'B'），不给就报错 */
export function parseBits(src, what = '长度', { bare = null } = {}) {
  const n = leadNumber(src);
  const bad = () => new Error(`${what}写成 1000B（字节）或 800bit（比特）（现在是「${src ?? ''}」）`);
  if (!n || !(n.value >= 0)) throw bad();
  const u = n.rest.replace(/\s+/g, '');
  if (u === '') { if (!bare) throw new Error(`${what}要写单位：B（字节）还是 bit（比特）？（现在是「${src}」）`); return clean(n.value * (bare === 'B' ? 8 : 1)); }
  if (/^(bit|bits|b|比特|位)$/.test(u)) return clean(n.value);
  if (/^(B|byte|bytes|字节)$/i.test(u)) return clean(n.value * 8);
  if (/^(kbit|kb|Kbit|Kb)$/.test(u)) return clean(n.value * 1000);
  if (/^(KB|kB|K字节)$/.test(u)) return clean(n.value * 1024 * 8);
  if (/^(MB|M字节)$/.test(u)) return clean(n.value * 1024 * 1024 * 8);
  throw bad();
}

const TIME = { s: 1, 秒: 1, ms: 1e-3, 毫秒: 1e-3, μs: 1e-6, µs: 1e-6, us: 1e-6, 微秒: 1e-6, ns: 1e-9, 纳秒: 1e-9 };
/** 时间 → s。51.2μs、51.2us、270ms、0.27s、10微秒。bare：没写单位时的单位（如 'μs'），不给就报错 */
export function parseTime(src, what = '时间', { bare = null } = {}) {
  const n = leadNumber(src);
  const bad = () => new Error(`${what}写成 10μs、270ms、0.5s 这样（现在是「${src ?? ''}」）`);
  if (!n || !(n.value >= 0)) throw bad();
  const u = n.rest.replace(/\s+/g, '') || bare;
  if (!u) throw new Error(`${what}要写单位：μs、ms 还是 s？（现在是「${src}」）`);
  if (!(u in TIME)) throw bad();
  return clean(n.value * TIME[u]);
}

const DIST = { m: 1, 米: 1, km: 1e3, 千米: 1e3, 公里: 1e3 };
/** 距离 → m。2km、200m、2千米、2公里 */
export function parseDist(src, what = 'dist: 距离') {
  const n = leadNumber(src);
  const u = n?.rest.replace(/\s+/g, '');
  if (!n || !(n.value > 0) || !(u in DIST)) throw new Error(`${what}写成 2km、500m 这样（现在是「${src ?? ''}」）`);
  return clean(n.value * DIST[u]);
}

/** 信号传播速率 → m/s。200m/μs、2×10^8 m/s、2×10^5 km/s、200000km/s */
export function parseSpeed(src, what = 'v: 信号传播速率') {
  const n = leadNumber(src);
  const bad = () => new Error(`${what}写成 200m/μs、2×10^8 m/s 或 200000km/s（现在是「${src ?? ''}」）`);
  if (!n || !(n.value > 0)) throw bad();
  const [a, b] = n.rest.replace(/\s+/g, '').split('/');
  if (!(a in DIST) || !(b in TIME)) throw bad();
  return clean(n.value * DIST[a] / TIME[b]);
}

/** 百分数 → 0～1。80%、0.8、百分之80 */
export function parsePercent(src, what = 'target: 利用率') {
  const s = String(src ?? '').trim().replace(/^百分之/, '');
  const m = /^(\d+(?:\.\d+)?)\s*(%|％)?$/.exec(s);
  const v = m ? Number(m[1]) / (m[2] || Number(m[1]) > 1 ? 100 : 1) : NaN;
  if (!(v > 0 && v <= 1)) throw new Error(`${what}写成 80% 或 0.8（大于 0，不超过 100%）（现在是「${src ?? ''}」）`);
  return v;
}

// —— 写成人看的样子 ——

/** 数：除得尽（三位小数以内）写原数，不然四舍五入写到两位（大数一位），exact 告诉要不要写「≈」 */
export function num(x) {
  const r = clean(x);
  if (!Number.isFinite(r)) return { text: '∞', exact: true };
  const s = String(r);
  if (!/e/i.test(s) && (s.split('.')[1] || '').length <= 3) return { text: s, exact: true };
  const d = Math.abs(r) >= 10000 ? 1 : Math.abs(r) >= 0.01 ? 2 : 4;
  return { text: String(Number(r.toFixed(d))), exact: false };
}
export const numText = (x) => num(x).text;
// 答案（填表的格子、quiz）：除不尽的留四位小数——写到两位、三位都在误差里，看答案时也不是一长串
export const ansText = (x) => (Number.isFinite(x) ? String(Number(clean(x).toFixed(4))) : String(x));
// 「= 9.33」或「≈ 9.33」
export const eq = (x) => { const n = num(x); return `${n.exact ? '=' : '≈'} ${n.text}`; };

/** 一个时间挑合适的单位：{ v（在这个单位下的数）, unit, text } */
// 先挑写出来是「≥ 1 的整齐数」的最大单位（1214.4μs 不写成 1.2144ms），都不整齐就按大小挑（266.67ms）
export function timeUnit(sec) {
  const a = Math.abs(sec);
  if (a === 0) return 'μs';
  for (const u of ['s', 'ms', 'μs', 'ns']) { const v = clean(a / TIME[u]); if (v >= 1 && v < 1e6 && num(v).exact) return u; }
  return a >= 1 ? 's' : a >= 1e-3 ? 'ms' : a >= 1e-6 ? 'μs' : 'ns';
}
export function inUnit(sec, unit) { return clean(sec / TIME[unit]); }
export function timeText(sec, unit = timeUnit(sec)) { return `${num(inUnit(sec, unit)).text}${unit}`; }
export function rateText(bps) {
  const [k, u] = bps >= 1e9 ? [1e9, 'Gb/s'] : bps >= 1e6 ? [1e6, 'Mb/s'] : bps >= 1e3 ? [1e3, 'kb/s'] : [1, 'b/s'];
  return `${num(bps / k).text}${u}`;
}
export function rateUnit(bps) { return bps >= 1e9 ? ['Gb/s', 1e9] : bps >= 1e6 ? ['Mb/s', 1e6] : bps >= 1e3 ? ['kb/s', 1e3] : ['b/s', 1]; }
/** 比特数：能整除 8 的顺便写字节 */
export function bitsText(bits) { const b = clean(bits); return Number.isInteger(b) && b % 8 === 0 && b >= 8 ? `${b} bit（${b / 8} B）` : `${num(b).text} bit`; }
export function distText(m) { return m >= 1000 ? `${num(m / 1000).text}km` : `${num(m).text}m`; }
export function speedText(v) { return `${num(v / 1e6).text}m/μs`; }
export const pct = (u) => `${num(u * 100).text}%`;
