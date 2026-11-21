// 联合分布表 joint 的写法、问的量、判法（概率第 4 批）。纯函数，不碰 DOM。
import { evaluateExact, Q } from '../exact.js';
import { evaluate } from '../expr.js';
import { parseJoint, checkJoint, completeJoint, independent, moments, distOf, expectOf, tidy } from './joint.js';
import { Q0, readQ, judgeNumber, decimalVerdict, qInt, qTeX, splitAsk } from './num.js';

const KEYS = ['title', 'q', 'note', 'x', 'y', 'p', 'px', 'py', 'independent', 'show', 'z', 'ask'];
const COMMON = ['id', 'upload'];
const SHOWS = ['margins', 'moments', 'independent'];
const yes = (s) => /^(on|yes|true|是)$/i.test(String(s || '').trim());

// 条件：X + Y <= 1、X = Y、X ≠ 1；逗号、「且」是都要成立
const condSrc = (s) => tidy(s.replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=').replace(/(?<![<>=!])=(?!=)/g, '=='));
const condTeX = (s) => s.trim().replace(/\s+/g, ' ').replace(/<=|≤/g, '\\le').replace(/>=|≥/g, '\\ge').replace(/!=|≠/g, '\\ne').replace(/==/g, '=').replace(/\*/g, '\\cdot ');
const splitTop = (s, sep = /[,，]/) => { const out = []; let depth = 0, cur = ''; for (const c of s) { if ('(（['.includes(c)) depth++; if (')）]'.includes(c)) depth--; if (depth === 0 && sep.test(c)) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
// 连着的不等号 0 < X <= 2 拆成两条
const unchain = (c) => { const m = /^(.+?)(<=|>=|<|>)(.+?)(<=|>=|<|>)(.+)$/.exec(c); return m ? [`${m[1]}${m[2]}${m[3]}`, `${m[3]}${m[4]}${m[5]}`] : [c]; };
const allOf = (s) => splitTop(s.replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/\s*(且|and|&&)\s*/g, ',')).flatMap(unchain);
// 表里满足条件的格：[i, k]。条件要是比较（X = 1、X + Y <= 2）；只写 X、X − Y 的不是事件
function cellsWhere(j, cond) {
  const cs = allOf(cond);
  for (const c of cs) if (!/[<>=!≠]/.test(c)) throw new Error(`「${c.trim()}」不是一个比较：事件写成 X = 1、X + Y <= 2、X > Y 这样`);
  const src = cs.map(condSrc), out = [];
  j.xs.forEach((x, i) => j.ys.forEach((y, k) => {
    for (const c of src) { const v = evaluateExact(c, { X: x, Y: y, x, y }); if (!(v instanceof Q) || v.zero) return; }
    out.push([i, k]);
  }));
  return out;
}

/** 表里满足条件的那些格的概率加起来（条件用 X、Y 写，几个条件逗号隔开是都要成立） */
export function probWhere(j, cond) {
  return cellsWhere(j, cond).reduce((s, [i, k]) => s.add(j.p[i][k]), Q0);
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
  if (r) {
    const parts = r[1].split(/[|｜∣]/);
    if (parts.length === 1) return { exact: true, value: E(r[1]), tex: `E(${condTeX(r[1])})`, traps: [] };
    if (parts.length > 2) throw new Error('竖线太多：条件期望写成 E(X | Y = 0)');
    // 条件期望：满足条件的那些格上按概率加权平均
    const cells = cellsWhere(j, parts[1]), den = cells.reduce((acc, [i, k]) => acc.add(j.p[i][k]), Q0);
    if (den.zero) throw new Error(`条件「${parts[1].trim()}」的概率是 0，条件期望没有定义`);
    const g = tidy(parts[0]);
    let num = Q0;
    for (const [i, k] of cells) { const v = evaluateExact(g, { X: j.xs[i], Y: j.ys[k], x: j.xs[i], y: j.ys[k] }); if (!(v instanceof Q)) throw new Error('E( ) 里要是一个数'); num = num.add(v.mul(j.p[i][k])); }
    return { exact: true, value: num.div(den), tex: `E(${condTeX(parts[0])} \\mid ${allOf(parts[1]).map(condTeX).join(',\\ ')})`, traps: [trap(num, '这是只在条件成立的那几格上加出来的：条件期望还要除以条件的概率。', 'joint-for-cond')] };
  }
  r = /^(?:D|Var)\s*[(（]([\s\S]+)[)）]$/i.exec(s) || /^D\s*([XY])$/.exec(s);
  if (r) {
    const e2 = E(`(${tidy(r[1])})^2`), e1 = E(r[1]);
    return { exact: true, value: e2.sub(e1.mul(e1)), tex: `D(${condTeX(r[1])})`, traps: [trap(e2, '这是平方的期望：方差还要减去期望的平方。', 'ex2-for-var')] };
  }
  r = /^Cov\s*[(（]([\s\S]+)[)）]$/i.exec(s);
  if (r || /^cov$/i.test(s)) {
    const [a, b] = r ? splitTop(r[1]) : ['X', 'Y'];
    if (!a || !b || splitTop(r ? r[1] : 'X, Y').length !== 2) throw new Error('协方差写成 Cov(X, Y)：括号里正好两个，逗号隔开');
    const eab = E(`(${tidy(a)})*(${tidy(b)})`), ea = E(a), eb = E(b);
    return { exact: true, value: eab.sub(ea.mul(eb)), tex: `\\operatorname{Cov}(${condTeX(a)}, ${condTeX(b)})`, traps: [trap(eab, '这是乘积的期望：协方差还要减去两个期望的乘积。', 'exy-for-cov')] };
  }
  if (/^(rho|ρ)(_?\{?XY\}?)?$/i.test(s)) {
    if (m.rho === null) throw new Error('X、Y 里有一个是常数（方差是 0），相关系数没有定义');
    if (m.rho instanceof Q) return { exact: true, value: m.rho, tex: '\\rho_{XY}', traps: [trap(m.cov, '这是协方差：相关系数还要除以两个标准差。', 'cov-for-rho')] };
    return { exact: false, dec: !!m.rhoDec, approx: m.rhoValue, valueTeX: m.rhoTeX, tex: '\\rho_{XY}', traps: [trap(m.cov, '这是协方差：相关系数还要除以两个标准差。', 'cov-for-rho')] };
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

// 学生写的带根号的式子 → 表达式：√6、√(2/147)、2√6/42、(√6)/21
const rootExpr = (s) => tidy(s.replace(/[−–]/g, '-')).replace(/√\s*(\d+(?:\.\d+)?)/g, 'sqrt($1)').replace(/√\s*\(/g, 'sqrt(')
  .replace(/(\d|\))\s*(?=sqrt\()/g, '$1*').replace(/\)\s*\(/g, ')*(').replace(/(\d)\s*\(/g, '$1*(');
/** 学生填的一个数对不对：{ ok: true | false | null, text, tag? } */
export function judgeQuantity(q, input) {
  const s = String(input ?? '').trim();
  const traps = (q.traps || []).filter((t) => t.value && (q.exact ? t.value.cmp(q.value) !== 0 : true));
  if (q.exact) {
    const r = judgeNumber(q.value, s, traps);
    if (r.ok === false && !r.tag) { const v = readQ(s); if (v && !q.value.zero && v.cmp(q.value.neg()) === 0) return { ok: false, text: '数对了，符号反了。', tag: 'sign' }; }
    return r;
  }
  // 开不尽的（相关系数）：小数按位数的规矩，别的当式子算
  if (!s) return { ok: null, text: '还没填。' };
  const want = q.approx;
  const isDec = decimalVerdict(s, want) !== null;
  let v;
  if (isDec) v = Number(s.replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/[%％]$/, '')) / (/[%％]$/.test(s) ? 100 : 1);
  else { try { const e = evaluate(rootExpr(s)); v = typeof e === 'number' && Number.isFinite(e) ? e : null; } catch { v = null; } }
  if (v === null || !Number.isFinite(v)) return { ok: null, text: '这个读不懂：写小数（三位有效数字），或者带根号的式子（sqrt(6)/21、√6/21）。' };
  const same = (target) => (isDec ? decimalVerdict(s, target) === 'ok' : Math.abs(v - target) <= 1e-9 * Math.max(1, Math.abs(target)));
  if (same(want)) return { ok: true, text: '对。' };
  if (isDec ? decimalVerdict(s.replace(/^[+-]?/, (m) => (m === '-' ? '' : '-')).replace(/^[−–]/, ''), want) === 'ok' || same(-want) : same(-want)) return { ok: false, text: '数对了，符号反了。', tag: 'sign' };
  const t = traps.find((x) => same(x.value.toNumber()) || Math.abs(x.value.toNumber() - v) < 1e-12);
  if (t) return { ok: false, text: t.text, tag: t.tag };
  const dec = isDec ? decimalVerdict(s, want) : null;
  if (dec === 'short' && Math.abs(v - want) < 0.01) return { ok: false, text: '小数的位数不够：至少三位有效数字，或者写成带根号的式子（√6/21）。', tag: 'short' };
  if (dec === 'cut') return { ok: false, text: '最后一位要四舍五入，不是把后面的截掉。', tag: 'cut' };
  return { ok: false, text: '不对。' };
}

/** 一组格子逐格判（边缘、Z 的分布、空着的格）：expected 是分数（或者写成字的数），inputs 是学生填的。没填完、有读不懂的不判 */
export function judgeCells(expected, inputs) {
  const want = expected.map((e) => (e instanceof Q ? e : readQ(e)));
  const got = inputs.map((s) => String(s ?? '').trim());
  const empty = got.filter((s) => !s).length;
  if (empty) return { ok: null, marks: got.map(() => null), text: `还有 ${empty} 格没填。` };
  const res = got.map((s, i) => judgeNumber(want[i], s));
  const marks = res.map((r) => r.ok);
  const unread = marks.filter((x) => x === null).length;
  if (unread) return { ok: null, marks, text: `有 ${unread} 格读不懂：写分数（3/10）或小数（0.3）。` };
  const wrong = marks.filter((x) => !x).length;
  // 错的格里有的只是小数的位数不够、截断了：说出来（不然学生只看到「错」）
  const short = res.filter((r) => r.tag === 'short' || r.tag === 'cut').length;
  return wrong ? { ok: false, marks, text: `错了 ${wrong} 格（标出来的）${short ? `；其中 ${short} 格是小数的位数不够或者没有四舍五入：写成分数，或者至少三位有效数字` : ''}。` } : { ok: true, marks, text: '都对。' };
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
  // 写全了的表也照 px、py、independent 核一遍：和表对不上的报出来（以前只在有空格时才用它们）
  if (raw.blanks.length || fields.px || fields.py || yes(fields.independent)) {
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
    const { q: text, expr } = splitAsk(s);
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

/** 答案那一行（看答案、答对了时写）：精确的「= 值」；开不尽的「= 根式 ≈ 小数」；只有小数的「≈ 小数」（只一次 ≈） */
export function answerLine(q, ft = qTeX) {
  if (q.exact) return `${q.tex} = ${ft(q.value)}`;
  if (q.dec) return `${q.tex} \\approx ${Number(q.approx.toPrecision(4))}`;
  return `${q.tex} = ${q.valueTeX} \\approx ${Number(q.approx.toPrecision(4))}`;
}
