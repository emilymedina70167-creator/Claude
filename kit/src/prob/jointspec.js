// 联合分布表 joint 的写法、问的量、判法（概率第 4 批）。纯函数，不碰 DOM。
import { evaluateExact, Q } from '../exact.js';
import { evaluate } from '../expr.js';
import { parseJoint, checkJoint, completeJoint, independent, moments, distOf, expectOf, tidy } from './joint.js';
import { Q0, readQ, judgeNumber, qInt } from './num.js';

const KEYS = ['title', 'q', 'note', 'x', 'y', 'p', 'px', 'py', 'independent', 'show', 'z', 'ask'];
const COMMON = ['id', 'upload'];
const SHOWS = ['margins', 'moments', 'independent'];
const yes = (s) => /^(on|yes|true|是)$/i.test(String(s || '').trim());

// 条件：X + Y <= 1、X = Y、X ≠ 1；逗号、「且」是都要成立
const condSrc = (s) => tidy(s.replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=').replace(/(?<![<>=!])=(?!=)/g, '=='));
const condTeX = (s) => s.trim().replace(/\s+/g, ' ').replace(/<=|≤/g, '\\le').replace(/>=|≥/g, '\\ge').replace(/!=|≠/g, '\\ne').replace(/==/g, '=').replace(/\*/g, '\\cdot ');
const splitTop = (s, sep = /[,，]/) => { const out = []; let depth = 0, cur = ''; for (const c of s) { if ('(（['.includes(c)) depth++; if (')）]'.includes(c)) depth--; if (depth === 0 && sep.test(c)) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
const allOf = (s) => splitTop(s.replace(/\s*(且|and|&&)\s*/g, ','));

/** 表里满足条件的那些格的概率加起来（条件用 X、Y 写，几个条件逗号隔开是都要成立） */
export function probWhere(j, cond) {
  const cs = allOf(cond).map(condSrc);
  let sum = Q0;
  j.xs.forEach((x, i) => j.ys.forEach((y, k) => {
    for (const c of cs) { const v = evaluateExact(c, { X: x, Y: y, x, y }); if (!(v instanceof Q) || v.zero) return; }
    sum = sum.add(j.p[i][k]);
  }));
  return sum;
}

/**
 * 「E(X)」「D(X + Y)」「Cov(X, Y)」「rho」「P(X + Y <= 1)」「P(X = 1 | Y = 0)」→ 这张表上的一个量：
 * { exact: true, value（分数）, tex, traps } 或 { exact: false, approx, valueTeX, tex, traps }（相关系数开不尽）。读不懂抛出
 */
export function quantityOf(src, j) {
  const s = String(src).trim();
  const E = (e) => expectOf(j, e);
  const m = moments(j);
  const trap = (value, text, tag) => ({ value, text, tag });
  let r = /^E\s*[(（]([\s\S]+)[)）]$/.exec(s) || /^E\s*([XY])$/.exec(s);
  if (r) return { exact: true, value: E(r[1]), tex: `E(${condTeX(r[1])})`, traps: [] };
  r = /^(?:D|Var)\s*[(（]([\s\S]+)[)）]$/i.exec(s) || /^D\s*([XY])$/.exec(s);
  if (r) {
    const e2 = E(`(${tidy(r[1])})^2`), e1 = E(r[1]);
    return { exact: true, value: e2.sub(e1.mul(e1)), tex: `D(${condTeX(r[1])})`, traps: [trap(e2, '这是平方的期望：方差还要减去期望的平方。', 'ex2-for-var')] };
  }
  r = /^Cov\s*[(（]([\s\S]+)[)）]$/i.exec(s);
  if (r || /^cov$/i.test(s)) {
    const [a, b] = r ? splitTop(r[1]) : ['X', 'Y'];
    if (!a || !b) throw new Error('协方差写成 Cov(X, Y)');
    const eab = E(`(${tidy(a)})*(${tidy(b)})`), ea = E(a), eb = E(b);
    return { exact: true, value: eab.sub(ea.mul(eb)), tex: `\\operatorname{Cov}(${condTeX(a)}, ${condTeX(b)})`, traps: [trap(eab, '这是乘积的期望：协方差还要减去两个期望的乘积。', 'exy-for-cov')] };
  }
  if (/^(rho|ρ)(_?\{?XY\}?)?$/i.test(s)) {
    if (m.rho === null) throw new Error('X、Y 里有一个是常数（方差是 0），相关系数没有定义');
    if (m.rho instanceof Q) return { exact: true, value: m.rho, tex: '\\rho_{XY}', traps: [trap(m.cov, '这是协方差：相关系数还要除以两个标准差。', 'cov-for-rho')] };
    return { exact: false, approx: m.rhoValue, valueTeX: m.rhoTeX, tex: '\\rho_{XY}', traps: [trap(m.cov, '这是协方差：相关系数还要除以两个标准差。', 'cov-for-rho')] };
  }
  r = /^P\s*[(（]([\s\S]+)[)）]$/.exec(s);
  if (r) {
    const parts = r[1].split(/[|｜∣]/);
    if (parts.length > 2) throw new Error('竖线太多：条件概率写成 P(X = 1 | Y = 0)');
    const tex = parts.map((p) => allOf(p).map(condTeX).join(',\\ ')).join(' \\mid ');
    if (parts.length === 1) return { exact: true, value: probWhere(j, parts[0]), tex: `P(${tex})`, traps: [] };
    const den = probWhere(j, parts[1]);
    if (den.zero) throw new Error(`条件「${parts[1].trim()}」的概率是 0，条件概率没有定义`);
    const both = probWhere(j, `${parts[0]}, ${parts[1]}`);
    return { exact: true, value: both.div(den), tex: `P(${tex})`, traps: [trap(both, '这是两个都成立的概率：条件概率还要除以条件的概率。', 'joint-for-cond')] };
  }
  throw new Error(`「${s}」读不懂：能问的是 E(X)、E(XY)、D(X)、Cov(X, Y)、rho、P(X + Y <= 1)、P(X = 1 | Y = 0)`);
}

// 小数：至少两位小数、三位有效数字，四舍五入对得上
function decimalNear(input, value) {
  const m = /^[+-]?(\d*)\.(\d+)$/.exec(input.replace(/\s+/g, ''));
  if (!m) return null;
  const places = m[2].length, sig = (m[1] + m[2]).replace(/^0+/, '').length;
  if (places < 2 || sig < 3) return 'short';
  return Math.abs(Number(input) - value) <= 0.5 / 10 ** places + 1e-12 ? 'ok' : 'off';
}
/** 学生填的一个数对不对：{ ok: true | false | null, text, tag? } */
export function judgeQuantity(q, input) {
  const s = String(input ?? '').trim();
  const traps = (q.traps || []).filter((t) => t.value && (q.exact ? t.value.cmp(q.value) !== 0 : true));
  if (q.exact) {
    const r = judgeNumber(q.value, s, traps);
    if (r.ok === false && !r.tag) { const v = readQ(s); if (v && !q.value.zero && v.cmp(q.value.neg()) === 0) return { ok: false, text: '数对了，符号反了。', tag: 'sign' }; }
    return r;
  }
  if (!s) return { ok: null, text: '还没填。' };
  const dec = decimalNear(s, q.approx);
  if (dec === 'ok') return { ok: true, text: '对。' };
  if (dec === 'short') return { ok: false, text: '小数的位数不够：至少三位有效数字，或者写成带根号的式子（sqrt(6)/21）。', tag: 'short' };
  let v = null;
  if (dec === null) { try { const e = evaluate(tidy(s).replace(/√\s*\(?(\d+)\)?/g, 'sqrt($1)')); if (typeof e === 'number' && Number.isFinite(e)) v = e; } catch { v = null; } if (v === null) return { ok: null, text: '这个读不懂：写小数（三位有效数字），或者带根号的式子（sqrt(6)/21）。' }; } else v = Number(s);
  if (Math.abs(v - q.approx) <= 1e-9 * Math.max(1, Math.abs(q.approx)) && Number.isFinite(v)) return { ok: true, text: '对。' };
  if (Math.abs(v + q.approx) <= 1e-4) return { ok: false, text: '数对了，符号反了。', tag: 'sign' };
  const t = traps.find((x) => Math.abs(x.value.toNumber() - v) < 1e-9);
  return t ? { ok: false, text: t.text, tag: t.tag } : { ok: false, text: '不对。' };
}

/** 一组格子逐格判（边缘、Z 的分布、空着的格）：expected 是分数（或者写成字的数），inputs 是学生填的。没填完、有读不懂的不判 */
export function judgeCells(expected, inputs) {
  const want = expected.map((e) => (e instanceof Q ? e : readQ(e)));
  const got = inputs.map((s) => String(s ?? '').trim());
  const empty = got.filter((s) => !s).length;
  if (empty) return { ok: null, marks: got.map(() => null), text: `还有 ${empty} 格没填。` };
  const marks = got.map((s, i) => { const r = judgeNumber(want[i], s); return r.ok; });
  const unread = marks.filter((x) => x === null).length;
  if (unread) return { ok: null, marks, text: `有 ${unread} 格读不懂：写分数（3/10）或小数（0.3）。` };
  const wrong = marks.filter((x) => !x).length;
  return wrong ? { ok: false, marks, text: `错了 ${wrong} 格（标出来的）。` } : { ok: true, marks, text: '都对。' };
}

/** 读 joint 组件。写错的收进 problems（不抛） */
export function parseJointBlock(src) {
  const fields = {}, asks0 = [], problems = [];
  let last = null;
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '');
    if (!line.trim()) continue;
    const m = /^\s*([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/.exec(line);
    const key = m ? m[1].toLowerCase() : null;
    if (m && COMMON.includes(key)) { last = null; continue; }
    if (m && KEYS.includes(key)) { if (key === 'ask') asks0.push(m[2].trim()); else fields[key] = m[2].trim(); last = key; } else if (m) { problems.push(`不认识的字段 ${m[1]}（能写的：X Y p px py independent show z ask title q note）`); last = null; } else if (last === 'p') fields.p += `\n${line.trim()}`; // p 能分几行写
    else if (last && last !== 'ask') fields[last] += `\n${line.trim()}`;
    else problems.push(`「${line.trim()}」读不懂：一行一个字段`);
  }
  const out = { fields, joint: null, raw: null, show: new Set(), z: null, asks: [], problems, indep: null, moments: null };
  for (const k of ['x', 'y', 'p']) if (!fields[k]) { problems.push(`要写 ${k === 'p' ? 'p' : k.toUpperCase()}:（${k === 'p' ? '概率，一行是 X 的一个取值，分号或换行分行' : '取值，空格隔开'}）`); }
  if (!fields.x || !fields.y || !fields.p) return out;
  let raw;
  try { raw = parseJoint(fields.x, fields.y, fields.p); } catch (e) { problems.push(e.message); return out; }
  out.raw = raw;
  let j = raw;
  if (raw.blanks.length) {
    let done;
    try { done = completeJoint(raw, { rowSums: fields.px, colSums: fields.py, independent: yes(fields.independent) }); } catch (e) { problems.push(e.message); return out; }
    if (done.why) { problems.push(done.why); return out; }
    if (!done.ok) { problems.push(`空着的格补不出来（还差 ${done.missing.length} 格）：给 px:、py:（边缘），或者 independent: on`); return out; }
    j = { ...done.joint, blanks: [] };
  }
  const bad = checkJoint(j);
  problems.push(...bad);
  if (bad.length) return out;
  out.joint = j;
  out.indep = independent(j);
  out.moments = moments(j);
  for (const s of (fields.show || '').split(/[\s,，]+/).filter(Boolean)) { if (SHOWS.includes(s.toLowerCase())) out.show.add(s.toLowerCase()); else problems.push(`show 里的 ${s} 不认识（能写的：${SHOWS.join(' ')}）`); }
  if (fields.z) { try { out.z = distOf(j, fields.z); } catch (e) { problems.push(`z：${e.message}`); } }
  for (const s of asks0) {
    const q = /^["“]([^"”]*)["”]\s*([\s\S]+)$/.exec(s), k = s.lastIndexOf('=>');
    const [text, expr] = q ? [q[1].trim(), q[2].trim()] : k >= 0 ? [s.slice(0, k).trim(), s.slice(k + 2).trim()] : ['', s.trim()];
    const kind = expr.toLowerCase();
    if (kind === 'margins') out.asks.push({ kind, q: text || '把边缘分布填出来：每一行、每一列各加起来。' });
    else if (kind === 'cells') { if (!raw.blanks.length) problems.push('ask: cells 要表里有空着的格（p 里写 ?）；现在没有空着的格'); else out.asks.push({ kind, q: text || '把表里空着的格填出来。', cells: raw.blanks }); } else if (kind === 'z') { if (!out.z) problems.push('ask: z 要先写 z:（Z 的式子）'); else out.asks.push({ kind, q: text || `把 $Z = ${tidy(fields.z).replace(/\*/g, '')}$ 的分布填出来。` }); } else if (kind === 'independent') out.asks.push({ kind, q: text || '$X$ 和 $Y$ 独立吗？', answer: out.indep.ok, cells: out.indep.cells });
    else {
      try { const qn = quantityOf(expr, j); out.asks.push({ kind: 'value', q: text || `$${qn.tex}$ 是多少？`, expr, quantity: qn, value: qn.exact ? qn.value : qn.approx }); } catch (e) { problems.push(`ask「${expr}」：${e.message}`); }
    }
  }
  return out;
}
export { qInt };
