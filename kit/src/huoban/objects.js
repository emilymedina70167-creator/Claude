// 活板里的对象（docs/talk-plan.md 第 2 节）：现在组件库的东西不再是一个个组件 × 一种种模式，而是「能算、能画、学生能动」的对象。
//   演示过程：61 个演示引擎一个适配器接上。字段名和组件说明里的一样：paging(refs=v, frames=f, algo=fifo)。
//             每一步引擎自己的问题（ask 的答案）变成能取的成员：r.faults、r.victim（几次就是一串）；
//             引擎的常见错法（variants）照旧拿来看学生的错答像哪一种。
//   句子：方括号里是学生能折起的一段。
//   找例子的范围：序列(n, a..b)、整数(a..b)、向量(n, a..b)、矩阵(n, a..b)。
// 纯函数，不碰 DOM（画法在 huoban/view.js）。
import { ENGINES } from '../engines/registry.js';
import { checkAsk } from '../stepperspec.js';
import '../algofuncs.js'; // faults()、nextval() 这些用引擎算的函数注册进 exact.js
import { HbError } from './lang.js';
import { Q, isQ, isNumber, isVector, isMatrix, f, text, q } from './values.js';

const err = (m) => new HbError(m);

// —— 演示过程 ——

// 值 → 引擎字段的写法：数 3、向量 1 2 3、矩阵 1 2; 3 4、文字照写
function fieldText(v, name) {
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (isNumber(v)) return isQ(v) ? v.toString() : String(v);
  if (isMatrix(v)) return v.map((r) => r.map((x) => fieldText(x)).join(' ')).join('; ');
  if (isVector(v)) return v.map((x) => fieldText(x)).join(' ');
  if (Array.isArray(v)) return v.map((x) => fieldText(x)).join(' ');
  if (v && typeof v.digits === 'string') return v.digits;
  throw err(`字段 ${name} 的值写不进去`);
}

export const isEngine = (name) => Object.prototype.hasOwnProperty.call(ENGINES, name);

export function makeProcess(name, named) {
  const engine = ENGINES[name];
  if (!engine) throw err(`没有「${name}」这个演示`);
  const fields = {};
  for (const [k, v] of Object.entries(named)) fields[k] = fieldText(v, k);
  const src = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  let input, run;
  try {
    input = engine.parse(fields, src);
    run = engine.run(input);
  } catch (e) {
    throw err(`${name}：${e.message}`);
  }
  if (!run || !Array.isArray(run.steps) || !run.steps.length) throw err(`${name} 没有算出过程`);
  return { kind: 'process', name, engine, fields, src, input, run, toText: () => `${engine.title || name}的过程` };
}

const asksOf = (s) => [s.ask, ...(Array.isArray(s.asks) ? s.asks : [])].filter(Boolean);

/** 过程里能取的成员：每一步问题的种类（tag），和 steps（一共几步） */
export function processTags(p) {
  const tags = new Map();
  p.run.steps.forEach((s, k) => asksOf(s).forEach((a) => { if (!tags.has(a.tag)) tags.set(a.tag, []); tags.get(a.tag).push({ k, ask: a }); }));
  return tags;
}

// 问题的答案 → 值（数换成精确的分数，几个都对时是 alts）
function askValue(a) {
  const conv = (x) => (typeof x === 'number' || typeof x === 'bigint' ? Q.from(typeof x === 'bigint' ? Number(x) : x) : Array.isArray(x) ? x.map(conv) : x);
  if (Array.isArray(a.alts) && a.alts.length > 1 && a.answer === undefined) return { kind: 'alts', items: a.alts.map(conv) };
  if (a.answer !== undefined) return conv(a.answer);
  return conv(a.alts?.[0]);
}

export function processMember(p, name) {
  if (name === 'steps') return Q.int(p.run.steps.length - 1);
  const tags = processTags(p);
  if (tags.has(name)) {
    const list = tags.get(name);
    return list.length === 1 ? askValue(list[0].ask) : list.map((x) => askValue(x.ask));
  }
  if (name === 'quiz') {
    const qz = p.engine.quiz?.(p.input, p.run, p.fields);
    if (!qz) throw err(`${p.name} 没有 quiz`);
    return typeof qz.answer === 'number' ? Q.from(qz.answer) : qz.answer;
  }
  // 引擎算好的结果（paging 的 faults、victims 这类）：数、一串数、文字
  const r = p.run[name];
  if (typeof r === 'number') return Q.from(r);
  if (typeof r === 'string') return r;
  if (Array.isArray(r) && r.every((x) => typeof x === 'number' || typeof x === 'string')) return r.map((x) => (typeof x === 'number' ? Q.from(x) : x));
  const can = [...tags.keys(), 'steps'];
  throw err(`${p.name} 能取的是：${can.join('、')}`);
}

/** 过程成员对应的那个问题（判学生写的用引擎自己的判法：25/13 和 1.92、按顺序的序列、二进制……） */
export function processAsk(p, name, idx = null) {
  const list = processTags(p).get(name);
  if (!list) return null;
  return (idx === null ? list[list.length - 1] : list[idx])?.ask || null;
}

/** 学生答 p.name 那一题写了 given：对不对，错了像哪种错法（引擎的 variants） */
export function judgeProcess(p, name, idx, given) {
  const ask = processAsk(p, name, idx);
  if (!ask) return null;
  const r = checkAsk(ask, given);
  if (r.ok) return { ok: true };
  const list = processTags(p).get(name);
  const at = idx === null ? list.length - 1 : idx;
  let misread = '';
  for (const v of p.engine.variants?.(p.input, p.fields) || []) {
    try {
      const vr = p.engine.run(v.input);
      const vl = [];
      vr.steps.forEach((s) => asksOf(s).forEach((a) => { if (a.tag === name) vl.push(a); }));
      const va = vl[at];
      if (va && checkAsk(va, given).ok) { misread = v.label; break; }
    } catch { /* 这种错法在这组数上算不了 */ }
  }
  return { ok: false, msg: r.msg || '', misread };
}

// —— 句子 ——
export function sentence(t) {
  t = String(t);
  const parts = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0, m, g = 0;
  while ((m = re.exec(t))) {
    if (m.index > last) parts.push({ t: t.slice(last, m.index), fold: false });
    parts.push({ t: m[1], fold: true, i: g++ });
    last = re.lastIndex;
  }
  if (last < t.length) parts.push({ t: t.slice(last), fold: false });
  if (!g) throw err('句子里至少要有一段用 [ ] 括起来，学生才有东西可折');
  return { kind: 'sentence', text: t, parts, folded: new Set(), toText() { return restOf(this); } };
}
const tidy = (s) => s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').trim();
export function restOf(s) { return tidy(s.parts.filter((p) => !(p.fold && s.folded.has(p.i))).map((p) => p.t).join(' ')); }
export function sentenceMember(s, name) {
  if (name === 'rest') return restOf(s);
  if (name === 'folded') return Q.int(s.folded.size);
  if (name === 'text') return tidy(s.parts.map((p) => p.t).join(' '));
  throw err('句子能取的是：rest（折完剩下的）、folded（折起了几段）、text（原句）');
}

// —— 找例子的范围 ——
export function domain(type, args) {
  const range = args.find((a) => a && a.kind === 'range');
  const n = args.find(isNumber);
  if (!range) throw err('范围要写取值，比如 1..5');
  const lo = Math.ceil(f(range.lo)), hi = Math.floor(f(range.hi));
  if (hi < lo) throw err('取值范围是空的');
  if (type !== 'int' && !(n && f(n) >= 1 && f(n) <= 40)) throw err('序列、向量、矩阵要写长度（1 到 40）：序列(12, 1..5)');
  return { kind: 'domain', type, n: type === 'int' ? 1 : Math.round(f(n)), lo, hi, toText: () => `${lo}..${hi}` };
}
export function sampleDomain(d, r) {
  const pick = () => Q.int(d.lo + Math.floor(r() * (d.hi - d.lo + 1)));
  if (d.type === 'int') return pick();
  if (d.type === 'seq' || d.type === 'vec') return Array.from({ length: d.n }, pick);
  return Array.from({ length: d.n }, () => Array.from({ length: d.n }, pick));
}
export function mutateDomain(d, v, r) {
  const pick = () => Q.int(d.lo + Math.floor(r() * (d.hi - d.lo + 1)));
  if (d.type === 'int') { const x = Number(v.n) + (r() < 0.5 ? -1 : 1); return r() < 0.5 ? Q.int(Math.min(d.hi, Math.max(d.lo, x))) : pick(); }
  if (d.type === 'mat') { const m = v.map((row) => row.slice()); m[Math.floor(r() * d.n)][Math.floor(r() * d.n)] = pick(); return m; }
  const c = v.slice();
  const k = Math.floor(r() * c.length);
  c[k] = pick();
  if (d.type === 'seq' && r() < 0.3) { const j = Math.floor(r() * c.length); [c[k], c[j]] = [c[j], c[k]]; }
  return c;
}

export { text, q };
