// 抽样模拟 sim 的写法、读数、坐标刻度、判一个数（概率第 4 批）。纯函数，不碰 DOM。
import { compile, evaluate, names } from '../expr.js';
import { parseDist, theory, simulator } from './sim.js';
import { readQ, decimalVerdict, splitAsk } from './num.js';

const KEYS = ['title', 'q', 'note', 'draw', 'n', 'stat', 'view', 'curve', 'x', 'y', 'bins', 'seed', 'level', 'sigma', 'band', 'discrete', 'ask'];
const COMMON = ['id', 'upload'];
const VIEWS = ['hist', 'path', 'intervals', 'scatter'];
// 模拟出来的量（读数、曲线里能用；ask 里不能用：判对错只按理论值）
export const SIM_NAMES = ['reps', 'mean', 'var', 'last', 'miss', 'total', 'cover', 'inband', 'r'];
// 滑块不能起的名字（页面自己在用；n 除外：它就是样本量）
const RESERVED = [...SIM_NAMES, 'mu', 'sigma', 'level', 'band', 'x'];
const two = (s) => { const a = String(s || '').trim().split(/[\s,，]+/).map(Number); return a.length === 2 && a.every(Number.isFinite) && a[1] > a[0] ? a : null; };

/** 整齐的刻度：在 [lo, hi] 里、间隔是 1 / 2 / 5 × 10ᵏ，大约 n 个 */
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) return Number.isFinite(lo) ? [lo] : [];
  const raw = (hi - lo) / Math.max(1, n), mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
  const out = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) out.push(Number((k * step).toPrecision(12)) + 0);
  return out;
}

/** 切比雪夫给的界：P(|X̄ − μ| ≥ ε) ≤ σ² / (n ε²)（超过 1 就是 1） */
export const chebyshev = (sigma, n, eps) => Math.min(1, (sigma * sigma) / (n * eps * eps));

/** 理论上的量（判 ask 只给这些）：滑块现在的值、n、mu、sigma（分布的理论值）、level、band */
export function theoryVars(spec, sliders = {}) {
  const sl = { ...Object.fromEntries(spec.sliders.map((s) => [s.name, s.init])), ...sliders };
  const n = Math.round(sl.n ?? spec.n);
  let mu = NaN, sigma = NaN;
  try { const th = theory(parseDist(spec.draw, sl)); mu = th.mean; sigma = Math.sqrt(th.var); } catch { /* 画的时候报 */ }
  return { ...sl, n, mu, sigma, level: spec.level, band: spec.band ?? NaN };
}

/**
 * 读数、曲线里能用的东西：理论上的量，加上模拟出来的 reps、mean、var（这些统计量的平均和方差）、last、
 * 区间的 miss、total、cover，路径的 inband，散点的 r。data 是画面攒下来的
 */
export function varsOf(spec, sliders = {}, data = {}) {
  const vals = data.values || [], reps = vals.length;
  let mean = NaN, v = NaN;
  if (reps) { let s = 0; for (const x of vals) s += x; mean = s / reps; let q = 0; for (const x of vals) q += (x - mean) ** 2; v = q / reps; }
  const total = data.total ?? 0, miss = data.miss ?? 0;
  return { ...theoryVars(spec, sliders), reps, mean, var: v, last: data.last ?? NaN, miss, total, cover: total ? 1 - miss / total : NaN, inband: data.inband ?? NaN, r: data.r ?? NaN };
}

/** 还没攒够数据时横轴先取哪一段：按这个统计量理论上的中心和散布（v 里有 mu、sigma） */
export function guessRange(stat, v, n) {
  const m = v.mu, s = v.sigma, k = Math.max(1, n - 1);
  if (stat === 'sum') return [n * m - 4 * s * Math.sqrt(n), n * m + 4 * s * Math.sqrt(n)];
  if (stat === 'mean' || stat === 'median') return [m - (4 * s) / Math.sqrt(n), m + (4 * s) / Math.sqrt(n)];
  if (stat === 'z' || stat === 't') return [-4, 4];
  if (stat === 'chi') return [0, k + 4 * Math.sqrt(2 * k)];
  if (stat === 'S2' || stat === 'var') return [0, s * s * (1 + 4 * Math.sqrt(2 / k))];
  if (stat === 'S') return [0, s * (1 + 4 / Math.sqrt(2 * k))];
  return [m - 4 * s, m + 4 * s];
}

/** 读数里的 {式子} 填上数（公式自己的花括号不动）。算不出来写 ?；还没抽、没有数的写 — */
export function fillShow(text, vars) {
  return String(text).replace(/(?<![\\\w}_^])\{([^{}]+)\}/g, (m, expr) => {
    try {
      const v = evaluate(expr, vars);
      if (typeof v === 'number') return Number.isNaN(v) ? '—' : String(Number(v.toPrecision(4)));
      const s = String(v);
      return /NaN/.test(s) ? '—' : s;
    } catch (e) { return /dec\(\) 里要一个数/.test(e.message) ? '—' : '?'; } // dec(NaN)：还没抽，没有数
  });
}

/** 学生填的一个数对不对（期望的值按滑块现在的值算）：{ ok: true | false | null, text } */
export function judgeSimAsk(ask, input, vars) {
  const s = String(input ?? '').trim();
  if (!s) return { ok: null, text: '还没填。' };
  const q = readQ(s);
  if (!q) return { ok: null, text: '这个读不懂：写分数（1/5）或小数（0.2）。' };
  let want;
  try { want = evaluate(ask.expr, vars); } catch { want = NaN; }
  if (typeof want !== 'number' || !Number.isFinite(want)) return { ok: null, text: '这个量现在算不出来。' };
  const got = q.toNumber();
  if (Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want))) return { ok: true, text: '对。' };
  const dec = decimalVerdict(s, want);
  if (dec === 'ok') return { ok: true, text: '对。' };
  if (dec === 'short' && Math.abs(got - want) < 0.01 * Math.max(1, Math.abs(want))) return { ok: false, text: '小数的位数不够：写成分数，或者至少三位有效数字。' };
  if (dec === 'cut') return { ok: false, text: '最后一位要四舍五入，不是把后面的截掉。' };
  return { ok: false, text: '不对。' };
}

/** 读 sim 组件。写错的收进 problems（不抛） */
export function parseSim(src) {
  const fields = {}, problems = [], sliders = [], curves = [], shows = [], asks0 = [];
  let last = null;
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '');
    if (!line.trim()) continue;
    const t = line.trim();
    if (/^slider\s/i.test(t)) {
      const mods = {};
      const rest = t.slice(6).replace(/\s+(\w+)=("[^"]*"|\S+)/g, (m, k, v) => { mods[k] = v.replace(/^"|"$/g, ''); return ''; }).trim();
      const m = /^([A-Za-z_]\w*)\s+(\S+)\s+(\S+)(?:\s*=\s*(\S+))?$/.exec(rest);
      const lo = m && Number(m[2]), hi = m && Number(m[3]);
      if (!m || !(hi > lo)) { problems.push(`slider 的写法：slider n 1 60 = 5 step=1（「${t}」读不懂）`); last = null; continue; }
      sliders.push({ name: m[1], min: lo, max: hi, init: m[4] !== undefined ? Number(m[4]) : lo, step: Number(mods.step) || (hi - lo) / 100, label: mods.label || m[1] });
      last = null; continue;
    }
    if (/^show\s/i.test(t)) { shows.push(t.slice(5).trim()); last = null; continue; }
    const m = /^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/.exec(line);
    const key = m ? m[1].toLowerCase() : null;
    if (m && COMMON.includes(key)) { last = null; continue; }
    if (m && KEYS.includes(key)) { const val = m[2].trim(); if (key === 'curve') curves.push(val); else if (key === 'ask') asks0.push(val); else fields[key] = val; last = key; } else if (m) { problems.push(`不认识的字段 ${m[1]}（能写的：${KEYS.join(' ')}，还有 slider、show 两种行）`); last = null; } else if (last && !['curve', 'ask'].includes(last)) fields[last] += `\n${t}`;
    else problems.push(`「${t}」读不懂：一行一个字段`);
  }
  const num = (k, d) => (fields[k] !== undefined && Number.isFinite(Number(fields[k])) ? Number(fields[k]) : d);
  const out = {
    fields, problems, sliders, shows, asks: [], curves: [],
    draw: fields.draw || '', stat: fields.stat || 'mean', view: (fields.view || 'hist').toLowerCase(),
    n: Math.max(1, Math.round(num('n', 30))), bins: Math.max(4, Math.min(80, Math.round(num('bins', 24)))), seed: Math.round(num('seed', 1)),
    x: two(fields.x), y: two(fields.y), level: num('level', 0.95), sigmaKnown: !/^(unknown|未知|no)$/i.test(fields.sigma || 'known'),
    band: fields.band !== undefined ? Number(fields.band) : null, discrete: /^(on|yes|是)$/i.test(fields.discrete || ''),
  };
  if (!out.draw) { problems.push('要写 draw:（从哪个分布抽，比如 draw: X ~ N(0, 1)）'); return out; }
  if (!VIEWS.includes(out.view)) { problems.push(`view 只能是 ${VIEWS.join(' / ')}（现在是 ${fields.view}）`); out.view = 'hist'; }
  if (!(out.level > 0 && out.level < 1)) { problems.push(`level（置信水平）要在 0 和 1 之间（现在是 ${fields.level}）`); out.level = 0.95; }
  if (out.band !== null && !(out.band > 0)) { problems.push(`band（带子的半宽 ε）要是正数（现在是 ${fields.band}）`); out.band = null; }
  for (const sd of sliders) if (RESERVED.includes(sd.name)) problems.push(`滑块不能叫 ${sd.name}（这个名字页面自己在用）：换个名字${sd.name === 'r' ? '，比如 rho' : ''}`);
  const sl = Object.fromEntries(sliders.map((s) => [s.name, s.init]));
  if (sl.n !== undefined) out.n = Math.max(1, Math.round(sl.n));
  let dist = null;
  try { dist = parseDist(out.draw, sl); } catch (e) { problems.push(`draw：${e.message}`); return out; }
  out.pair = !!dist.pair;
  if (out.view === 'scatter') { if (!dist.pair) problems.push('view: scatter 要成对的样本：draw 写 (X, Y) ~ N2(ρ)'); out.stat = 'r'; }
  if (out.view === 'intervals' || out.view === 'path') out.stat = 'mean';
  if (out.view === 'intervals' && !out.sigmaKnown) {
    const ns = sliders.find((x) => x.name === 'n');
    if (ns && ns.min < 2) problems.push('σ 未知的置信区间至少要 2 个样本：n 的滑块从 2 起');
    else if (out.n < 2) problems.push('σ 未知的置信区间至少要 2 个样本（现在 n = 1）');
  }
  if (out.view !== 'scatter' || dist.pair) { try { simulator({ dist: out.draw, n: out.n, stat: out.stat, seed: out.seed, vars: sl }).next(); } catch (e) { problems.push(e.message); } }
  const probe = { ...varsOf(out, sl, { values: [1, 2] }), x: 0.5 };
  for (const c of curves) {
    const mods = {};
    const body = c.replace(/\s+(\w+)=("[^"]*"|\S+)/g, (m, k, v) => { mods[k] = v.replace(/^"|"$/g, ''); return ''; }).trim();
    try { compile(body)(probe); out.curves.push({ src: body, label: mods.label || '' }); } catch (e) { problems.push(`curve「${body}」：${e.message}`); }
  }
  for (const s of asks0) {
    const { q, expr } = splitAsk(s);
    if (!expr) { problems.push(`ask 的写法：ask: "题目" 式子（式子里能用 n、mu、sigma 和滑块；「${s}」读不懂）`); continue; }
    try {
      const used = names(expr).filter((nm) => SIM_NAMES.includes(nm));
      if (used.length) throw new Error(`用到了模拟出来的量（${used.join('、')}）：判对错只按理论值，式子里用 n、mu、sigma 和滑块`);
      const v = evaluate(expr, theoryVars(out, sl));
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('按理论值算不出一个有限的数（这个分布的期望或方差不存在？）');
      out.asks.push({ q: q || `${expr} 是多少？`, expr });
    } catch (e) { problems.push(`ask「${expr}」：${e.message}`); }
  }
  return out;
}
