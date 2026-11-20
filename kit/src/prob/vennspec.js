// 文氏图 venn 的写法和判法（概率第 4 批）。纯函数，不碰 DOM。
import { parseEvent, parseGiven, parseProbTerm, solveAtoms, termValue, probOf, atomsOf } from './sets.js';
import { readQ, qTeX } from './num.js';

const KEYS = ['title', 'q', 'note', 'sets', 'given', 'shade', 'ask', 'find', 'probs'];
const MANY = new Set(['shade', 'ask']);
const JOIN = new Set(['given', 'find']);

/** 第 k 块的名字：AB'（A 发生、B 不发生） */
export const atomName = (k, names) => names.map((nm, i) => ((k >> i) & 1 ? nm : `${nm}'`)).join('');

// 「"题目" 式子」「题目 => 式子」「式子」
function splitAsk(src) {
  const s = src.trim();
  const q = /^["“]([^"”]*)["”]\s*([\s\S]+)$/.exec(s);
  if (q) return { q: q[1].trim(), expr: q[2].trim() };
  const k = s.lastIndexOf('=>');
  if (k >= 0) return { q: s.slice(0, k).trim(), expr: s.slice(k + 2).trim() };
  return { q: '', expr: s };
}
function splitTop(src) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of src) {
    if ('(（'.includes(c)) depth++;
    if (')）'.includes(c)) depth--;
    if (depth === 0 && /[,，;；\n]/.test(c)) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// 填概率的题常见的错法：算出那个错的值，学生填了它就说一句（也告诉老师）
function trapsOf(term, names, givens, n) {
  const P = (mask) => { const r = probOf(mask, givens, n); return r.status === 'ok' ? r.value : null; };
  const ev = names.map((nm) => parseEvent(nm, names).mask);
  const out = [];
  const add = (value, text, tag) => { if (value) out.push({ value, text, tag }); };
  if (term.cond == null) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = P(ev[i]), b = P(ev[j]);
      if (!a || !b) continue;
      if (i < j && term.mask === (ev[i] | ev[j])) add(a.add(b), `这是 P(${names[i]}) + P(${names[j]})：两个圆重叠的那一块算了两遍。`, 'add-twice');
      if (term.mask === (ev[i] & ~ev[j])) add(a.sub(b), `这是 P(${names[i]}) − P(${names[j]})：该减掉的是 ${names[i]}、${names[j]} 都发生的那一块。`, 'minus-whole');
      if (i < j && term.mask === (ev[i] & ev[j])) add(a.mul(b), `这是 P(${names[i]})·P(${names[j]})：没说独立，不能直接乘。`, 'assume-indep');
    }
  } else {
    add(P(term.mask & term.cond), '这是两个都发生的概率：条件概率还要除以条件的概率。', 'joint-for-cond');
    const back = termValue({ mask: term.cond, cond: term.mask }, givens, n);
    if (back.status === 'ok') add(back.value, '条件和结果写反了。', 'cond-reversed');
  }
  return out;
}

/** 读 venn 组件。写错的地方收进 problems（不抛） */
export function parseVenn(src) {
  const fields = {}, many = { shade: [], ask: [] }, problems = [];
  let last = null;
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '');
    if (!line.trim()) continue;
    const m = /^\s*([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/.exec(line);
    const key = m ? m[1].toLowerCase() : null;
    if (m && KEYS.includes(key)) {
      const val = m[2].trim();
      if (MANY.has(key)) many[key].push(val);
      else if (JOIN.has(key) && fields[key]) fields[key] += `, ${val}`;
      else fields[key] = val;
      last = key;
    } else if (m && !/^P$/i.test(m[1])) {
      problems.push(`不认识的字段 ${m[1]}（能写的：${KEYS.join(' ')}）`);
      last = null;
    } else if (last && !MANY.has(last)) fields[last] += `${JOIN.has(last) ? ', ' : '\n'}${line.trim()}`;
    else problems.push(`「${line.trim()}」读不懂：一行一个字段（${KEYS.join(' ')}）`);
  }
  const names = (fields.sets || '').split(/[\s,，、]+/).filter(Boolean);
  const out = { fields, names, n: names.length, givens: [], shades: [], asks: [], finds: [], problems, probs: null };
  if (!names.length) { problems.push('要写 sets: A B（两个或三个事件的名字）'); return out; }
  if (names.length > 3) { problems.push(`文氏图画 1 到 3 个事件（现在写了 ${names.length} 个）`); return out; }
  if (names.some((nm) => !/^[A-Z]\d?$/.test(nm)) || new Set(names).size < names.length) { problems.push(`事件的名字用一个大写字母（能带一位数字），不能重：现在是 ${names.join(' ')}`); return out; }
  const n = names.length;
  const guard = (what, fn) => { try { return fn(); } catch (e) { problems.push(`${what}：${e.message}`); return null; } };

  out.givens = (fields.given && guard('given', () => parseGiven(fields.given, names))) || [];
  const solved = solveAtoms(out.givens, n);
  if (solved.status === 'conflict') problems.push('given 给的几个概率自相矛盾（比如交的概率比其中一个事件还大、加起来超过 1）');
  out.probs = out.givens.length ? solved : null;

  for (const s of many.shade) {
    const ev = guard(`shade「${s}」`, () => parseEvent(s, names));
    if (ev) out.shades.push(ev);
  }
  for (const s of many.ask) {
    const { q, expr } = splitAsk(s);
    if (/^P\s*[(（]/.test(expr)) {
      const term = guard(`ask「${expr}」`, () => parseProbTerm(expr, names));
      if (!term || solved.status === 'conflict') continue;
      const r = termValue(term, out.givens, n);
      if (r.status === 'undefined') { problems.push(`ask 的 ${expr} 没有定义（条件的概率是 0）`); continue; }
      if (r.status !== 'ok') { problems.push(`ask 的 ${expr} 定不下来：given 给的条件不够${r.min ? `（它可以在 ${r.min} 到 ${r.max} 之间）` : ''}`); continue; }
      out.asks.push({ kind: 'prob', q: q || `$${term.tex}$ 是多少？`, expr, term, value: r.value, traps: trapsOf(term, names, out.givens, n).filter((t) => t.value.cmp(r.value) !== 0) });
    } else {
      const ev = guard(`ask「${expr}」`, () => parseEvent(expr, names));
      if (ev) out.asks.push({ kind: 'region', q: q || `在图上点出 $${ev.tex}$`, expr, mask: ev.mask, atoms: ev.atoms, tex: ev.tex });
    }
  }
  for (const s of fields.find ? splitTop(fields.find) : []) {
    const term = guard(`find「${s}」`, () => parseProbTerm(s, names));
    if (term) out.finds.push(term);
  }
  return out;
}

/** 学生点的几块对不对。不对时只说多了几块、少了几块（不说是哪几块） */
export function judgeRegion(ask, picked) {
  const want = new Set(ask.atoms), got = new Set(picked);
  const extra = [...got].filter((k) => !want.has(k)).length, missing = [...want].filter((k) => !got.has(k)).length;
  if (!extra && !missing) return { ok: true, text: '对，就是这几块。', extra, missing };
  if (!got.size) return { ok: false, text: '一块都没点。', extra, missing };
  const parts = [extra ? `多点了 ${extra} 块` : '', missing ? `少点了 ${missing} 块` : ''].filter(Boolean);
  return { ok: false, text: `${parts.join('，')}。`, extra, missing };
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
/** 学生填的概率对不对：{ ok: true | false | null（读不懂，不判）, text, tag? } */
export function judgeProb(ask, input) {
  const s = String(input ?? '').trim();
  const v = readQ(s);
  if (!v) return { ok: null, text: s ? '这个读不懂：写分数（2/3）、小数（0.25）或百分数（25%）。' : '还没填。' };
  if (v.cmp(ask.value) === 0) return { ok: true, text: '对。' };
  const trap = (ask.traps || []).find((t) => t.value.cmp(v) === 0);
  if (trap) return { ok: false, text: trap.text, tag: trap.tag };
  const dec = decimalOk(s, ask.value);
  if (dec === 'ok') return { ok: true, text: '对。' };
  if (dec === 'short' && Math.abs(v.toNumber() - ask.value.toNumber()) < 0.01) return { ok: false, text: '小数的位数不够：写成分数，或者至少三位有效数字。', tag: 'short' };
  return { ok: false, text: '不对。' };
}

/** find 的一条读数（带 $ 的文字，交给 mdToHtml） */
export function readoutOf(term, v) {
  const r = termValue(term, v.givens, v.n);
  if (r.status === 'ok') return `$${term.tex} = ${qTeX(r.value)}$`;
  if (r.status === 'undefined') return `$${term.tex}$ 没有定义（条件的概率是 0）`;
  if (r.status === 'conflict') return `$${term.tex}$：given 自相矛盾`;
  return `$${term.tex}$：条件不够${r.min ? `（在 $${qTeX(r.min)}$ 到 $${qTeX(r.max)}$ 之间）` : ''}`;
}

/** 每一块里写的概率（定得下来的才写）：回 2ⁿ 个 TeX 或 null */
export function atomTexts(v) {
  if (!v.probs || v.probs.status === 'conflict') return null;
  const N = 1 << v.n;
  if (v.probs.status === 'unique') return v.probs.p.map((x) => qTeX(x));
  return Array.from({ length: N }, (_, k) => (v.probs.lo[k].cmp(v.probs.hi[k]) === 0 ? qTeX(v.probs.lo[k]) : null));
}
export { atomsOf };
