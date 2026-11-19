// 检验的判（设计 5.3）：页面机器能判的当场判、不调 Claude（构造的每一条、式子、真假、能不能、哪一行、逐行证明、结果、改正）；
// 要点、证明要点、理由、solve 的步骤交给页面里的 Opus 5.5 high（下面另一半）。不碰 DOM，tests/check-judge*.test.js。
//
// 每一项的结论都是 { id, ok: true | false | 'missing' | null, why, tag? }（和计划 1 的 board judge / 证据的 steps 一个样子）：
// null 是页面判不了 / 拿不准，待外部核——任何时候都不当成过。
import { compile } from '../expr.js';
import { readCell } from '../anscheck.js';
import { equivalent } from '../ncalg.js';
import { normalizeFormula, FORMULA_FUNCS } from '../formula.js';
import { parseDeriveDo, sampleEnvs, checkLine } from '../derivedo.js';
import { baseType, probeVars, evalIfs, withDefaults, runVars, runFields, measuresUsed, expectValue, traceTable, traceRows, traceRowName, rewriteHits } from './spec.js';
import { ROLES, matchText, diagnose, normText, joinWords, spanText, tokenizeSentence } from '../entext.js';
import { variantsOf, variantValues, sortPass } from '../engines/measures.js';
import { checkFill, cellOk, normCell, misreadFill } from '../stepperspec.js';
import { valueMatch, sameResult, unreadWhy } from './values.js';
import { parseJudge, STEP_KINDS, STEP_TAGS } from '../solvespec.js';
import { parseCodeSpec, runTests } from '../codejudge.js';

/** 还有几格没填（空串、只有空白、null） */
export function blankCells(v) {
  if (Array.isArray(v)) return v.reduce((n, x) => n + blankCells(x), 0);
  return v === null || v === undefined || String(v).trim() === '' ? 1 : 0;
}

const readable = (x) => { try { readCell(x); return true; } catch { return false; } };

/**
 * 交之前还差什么（构造题、判假的反例）：没填的格、读不懂的格（「1/」这种）、空着的式子框。'' 是能交了。
 * 只管格子和式子框（真假、能不能、哪一行、写字的地方由外壳另看）
 */
export function notReady(probe, answer = {}) {
  if (!probe?.slots || !answer?.slots) return '';
  const blank = probe.slots.reduce((n, s) => n + blankCells(answer.slots[s.name] ?? ''), 0);
  if (blank) return `还有 ${blank} 格没填`;
  const bad = probe.slots.filter((s) => [answer.slots[s.name]].flat(2).some((x) => String(x ?? '').trim() && !readable(x))).map((s) => s.name);
  if (bad.length) return `${bad.join('、')} 里有格子读不懂：写数、分数（1/2）或根号（√2）`;
  const empty = (probe.exprs || []).filter((e) => !String(answer.exprs?.[e.id] ?? '').trim()).map((e) => e.label);
  if (empty.length) return `${empty.join('、')}还没写`;
  return '';
}

// 学生格子里写的（'1/2'、'√2'、数）→ 数
const cellNum = (x) => (Array.isArray(x) ? x.map(cellNum) : typeof x === 'number' ? x : Number(readCell(x)));

const close = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => close(x, b[i]));
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
};

/** 学生写的式子（省乘号、上标、希腊字母都认）在 vars 上算，和标准式子比值 */
function sameValue(student, expected, vars) {
  const names = Object.keys(vars);
  try {
    const s = compile(normalizeFormula(String(student), { names, funcs: FORMULA_FUNCS }))(vars);
    const e = compile(normalizeFormula(String(expected), { names, funcs: FORMULA_FUNCS }))(vars);
    return close(s, e);
  } catch { return null; }
}

function ifItems(probe, slots, vars) {
  let values;
  try { values = Object.fromEntries(probe.slots.map((s) => [s.name, cellNum(slots?.[s.name])])); } catch { return probe.ifs.map((c) => ({ id: c.id, ok: false, why: '有格子里写的不是数' })); }
  return evalIfs(probe.ifs, values, vars, probe.slots).map((r) => {
    const c = probe.ifs.find((x) => x.id === r.id);
    return { id: r.id, ok: r.ok, why: r.ok ? '' : r.error ? `代进去算不了：${r.error}` : c.msg || `不满足 ${c.text}` };
  });
}

function exprItems(probe, exprs = {}) {
  return (probe.exprs || []).map((e) => {
    const s = String(exprs?.[e.id] ?? '').trim();
    if (!s) return { id: e.id, ok: false, why: `没写${e.label}` };
    const v = equivalent(s, e.expected);
    return { id: e.id, ok: v === 'unknown' ? null : v, why: v === true ? '' : v === 'unknown' ? '页面判不了这个式子' : `${e.label}不对` };
  });
}

function proofItem(probe, lines = []) {
  const p = probe.proof;
  // 模板取过数的：取到的数也写成 let（derive 照它算）
  const src = [`start: ${p.start}`, `goal: ${p.goal}`, ...(p.vars ? [`vars: ${p.vars}`] : []), ...Object.entries(probe.vals || {}).map(([k, v]) => `let ${k} = ${JSON.stringify(v)}`), ...(probe.lets || []).map((l) => `let ${l.name} = ${l.src}`)].join('\n');
  let spec, envs;
  try { spec = parseDeriveDo(src); envs = sampleEnvs(spec, { seed: probe.id }); } catch (e) { return { id: 'proof', ok: null, why: `页面算不了：${e.message}` }; }
  let prev = p.start;
  let done = false;
  const ls = (lines || []).map((x) => String(x).trim()).filter(Boolean);
  for (let i = 0; i < ls.length; i++) {
    const r = checkLine(spec, envs, prev, ls[i]);
    if (!r.ok) return { id: 'proof', ok: false, why: `第 ${i + 1} 行：${r.why || r.error}` };
    prev = ls[i];
    done = r.done;
  }
  return done ? { id: 'proof', ok: true, why: '' } : { id: 'proof', ok: false, why: `没推到 ${p.goal}` };
}

// —— 408 的 construct、predict（计划 4 Task 3）：先照学生写的跑引擎、再比 ——

const STR_SLOTS = new Set(['seq', 'text', 'procs']);
const TIE_WHY = '这组输入有并列，页面判不了';
// 有 run 行、或有 seq / text / procs 格子的是 408 的构造题；数学的照旧走上面的 ifItems
const is408 = (probe) => (probe.runs || []).length > 0 || (probe.slots || []).some((s) => STR_SLOTS.has(s.kind));
const runNames = (probe) => (probe.runs || []).map((r) => r.name);
// 一段式子 / 条件用到的、带并列的量
const tiedIn = (probe, texts, ties) => measuresUsed({ runs: probe.runs, ifs: texts.map((text) => ({ text })) }).some((m) => ties.includes(m.key));

/**
 * 408 的构造题：学生的格子代进 run 跑一遍，再逐条判。格式（slotProblems）交之前外壳已经挡住了，这里只保证不抛：
 * 引擎不收（AVL 里有重复的数）→ 一项 run、引擎原话、停下（判没过，不算待核）；条件用到的量有并列 → 那一项 null；
 * 页面替学生加的撇号（notes）接在第一项 why 后面，也单独交出去
 */
function construct408(probe, answer = {}, base = {}) {
  const raw = answer.slots || {};
  let rv;
  try { rv = runVars(probe, raw, base); } catch (e) { return { items: [{ id: 'run', ok: null, why: `页面算不了：${e.message}` }], needsClaude: false, stop: true }; }
  if (rv.error) return { items: [{ id: 'run', ok: false, why: rv.error.msg }], needsClaude: false, stop: true, notes: rv.notes };
  const values = {};
  for (const s of probe.slots || []) {
    const v = raw[s.name];
    if (STR_SLOTS.has(s.kind)) { values[s.name] = String(v ?? ''); continue; }
    try { values[s.name] = cellNum(v); } catch { values[s.name] = NaN; }
  }
  const vars = withDefaults(rv.vars, probe.slots || []);
  const items = evalIfs(probe.ifs || [], values, vars, probe.slots || [], { runs: runNames(probe) }).map((r) => {
    const c = probe.ifs.find((x) => x.id === r.id);
    if (tiedIn(probe, [c.text], rv.ties)) return { id: r.id, ok: null, why: TIE_WHY };
    return { id: r.id, ok: r.ok, why: r.ok ? '' : r.error ? `代进去算不了：${r.error}` : c.msg || `不满足 ${c.text}` };
  });
  items.push(...exprItems(probe, answer.exprs));
  if (rv.notes.length && items[0]) items[0].why = [items[0].why, ...rv.notes].filter(Boolean).join('；');
  return { items, needsClaude: false, stop: false, notes: rv.notes };
}

// 一个 run 的错法：[{ key, label, vars }]（vars 是把这个 run 的量换成错法算出来的那一份）；against 写了只要那几种
function variantVars(probe, run, vars) {
  let list;
  const fields = runFields(probe, run, {});
  try { list = variantsOf(run.engine, fields); } catch { return []; }
  const want = probe.against || [];
  return list.filter((v) => !want.length || want.includes(v.key)).flatMap((v) => {
    let vv;
    try { vv = variantValues(run.engine, fields, v.key); } catch { return []; }
    if (!vv) return [];
    const out = { ...vars };
    for (const k of Object.keys(out)) if (k.startsWith(`${run.name}__`)) delete out[k]; // 错法没交的量不拿对的顶上
    for (const [k, x] of Object.entries(vv.values)) out[`${run.name}__${k}`] = x;
    return [{ key: v.key, label: v.label, vars: out, ties: vv.ties.map((t) => `${run.name}.${t}`) }];
  });
}

/**
 * predict：每个 expect 一项（x1…）。不对时依次认：引擎的错法（against 的，没写看全部）→ tag、why 是错法的说法；
 * 外部写的错答案（wrong w1: 式子 => 说明）→ hit、why 是说明；错法、错答案这组数上算出来和对的一样的不用。
 * 不对的项带 keys（补讲照它找：tag=… → w1 → x1）。有一项不对就停下；都对、写了 must → 理由交页面里的 Claude
 */
function predictItems(probe, answer = {}, base = {}) {
  const names = runNames(probe);
  let rv;
  try { rv = runVars(probe, {}, base); } catch (e) { rv = { error: { msg: e.message } }; }
  if (rv.error) return { items: [{ id: 'run', ok: null, why: `页面跑不了：${rv.error.msg}` }], needsClaude: false, stop: true };
  const got = answer.expects || {};
  let variants = null; // 用到再算（错法要把引擎再跑几遍）
  const allVariants = () => (variants ??= (probe.runs || []).map((run) => ({ run: run.name, list: variantVars(probe, run, rv.vars) })));
  const items = (probe.expects || []).map((e) => {
    if (tiedIn(probe, [e.value], rv.ties)) return { id: e.id, ok: null, why: TIE_WHY };
    let right;
    try { right = expectValue(e.value, rv.vars, names); } catch (err) { return { id: e.id, ok: null, why: `页面算不了这一项：${err.message}` }; }
    // 外部写的式子算出了不是数的数（除以 0）：是题的毛病，不怪学生——待核
    if (typeof right === 'number' && !Number.isFinite(right)) return { id: e.id, ok: null, why: '页面算不了这一项：算出来不是一个数' };
    const s = String(got[e.id] ?? '').trim();
    if (!s) return { id: e.id, ok: false, why: `没写${e.label}`, keys: [e.id] };
    const m = valueMatch(s, right);
    if (m === true) return { id: e.id, ok: true, why: '' };
    if (m === null) return { id: e.id, ok: false, why: unreadWhy(right), keys: [e.id] };
    const it = { id: e.id, ok: false, why: '' };
    const used = new Set(measuresUsed({ runs: probe.runs, expects: [{ value: e.value, wrongs: [] }] }).map((x) => x.run));
    for (const { run, list } of allVariants()) {
      if (!used.has(run) || it.tag) continue;
      for (const v of list) {
        if (tiedIn(probe, [e.value], v.ties)) continue;
        let wv;
        try { wv = expectValue(e.value, v.vars, names); } catch { continue; }
        if (sameResult(wv, right)) continue;
        if (valueMatch(s, wv) === true) { it.tag = v.key; it.why = v.label; break; }
      }
    }
    for (const w of e.wrongs || []) {
      let wv;
      try { wv = expectValue(w.expr, rv.vars, names); } catch { continue; }
      if (sameResult(wv, right)) continue;
      if (valueMatch(s, wv) === true) { it.hit = w.id; it.why = it.why || w.msg; break; }
    }
    if (!it.why) it.why = `${e.label}不对`;
    it.keys = [...(it.tag ? [`tag=${it.tag}`] : []), ...(it.hit ? [it.hit] : []), e.id];
    return it;
  });
  const stop = items.some((x) => x.ok === false);
  return { items, needsClaude: !stop && (probe.must || []).length > 0, stop };
}

// —— 408 的 trace（计划 4 Task 4）：学生填引擎的那张表，整张一次判 ——
// answer.cells 和 stepperspec.js 的 checkFill 收的一样：cells[r][c] 是 table.rows[r] 第 c 格学生写的（直接给出的格可以不写），
// 表下面那几格（散列表的 ASL）写在 answer.extra[i]（数组上挂的 cells.extra 存进 JSON 会丢：以前的作答照旧认）。r 是 traceTable(probe).table.rows 的下标（rows: 2-3 时第 1 行是直接给出的那一行）

// 每一趟只看上一趟的序列的四种排序：第一处错以后照「对的这一趟作用在学生写的上一行上」接着核，分开笔误和不会
const CARRY = new Set(['insert', 'shell', 'bubble', 'select']);
const TRACE_TIE = '这一步有并列（几种做法都对），页面判不了';
const plainNum = (x) => { const t = String(x ?? '').trim().replace(/['’′_]+$/, ''); return /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : NaN; };

// 笔误只认「一个数写错、或两个数写反」：错的那一行和对的最多差 2 格。希尔最后一趟 d = 1、怎么写都排得齐，
// 不加这一条的话倒数第二趟整行做错（第 2 趟当成直接插入一趟排完）后面也「按上一行推都对」，会被说成笔误
const nearMiss = (row, mine) => row.cells.filter((c, j) => !c.given && !cellOk(c, mine?.[j] ?? '')).length <= 2;

function traceItems(probe, answer = {}) {
  let T;
  try { T = traceTable(probe); } catch (e) { return { items: [{ id: 'run', ok: null, why: `页面跑不了：${e.message}` }], needsClaude: false, stop: true }; }
  const { table, ties, input } = T;
  const sort = probe.use === 'sort';
  const raw = answer.cells || [];
  // 排序的格子认 49、49'、49’、49′（引擎的格子收 49 和 49′、49'）：学生写的撇号先统一成 ′
  const fix = (v) => (sort ? String(v ?? '').replace(/['’_]/g, '′') : String(v ?? ''));
  const rawExtra = answer.extra ?? raw.extra ?? [];
  const cells = Object.assign(table.rows.map((row, r) => row.cells.map((_, c) => fix(raw[r]?.[c]))), { extra: (table.extra || []).map((_, i) => String(rawExtra[i] ?? '')) });
  const rows = traceRows(table);
  const items = [];
  let bad = null;
  for (const x of rows) {
    const res = checkFill({ ...table, rows: [table.rows[x.r]], extra: [] }, [cells[x.r]]);
    if (res.ok) { items.push({ id: x.id, ok: true, why: '' }); continue; }
    // 靠并列定的那几步：学生写的可能是另一种也对的做法——待核，后面的行照常核
    // 空着的格不是「另一种做法」：照常判没写
    if (ties.includes(x.r) && !res.first.empty) { items.push({ id: x.id, ok: null, why: TRACE_TIE }); continue; }
    bad = { ...x, first: res.first };
    break;
  }
  if (!bad) {
    // 表都对（或只有待核的）了才看表下面那几格
    if (!items.some((x) => x.ok === null)) (table.extra || []).forEach((cell, i) => {
      const s = cells.extra[i];
      const ok = normCell(s) !== '' && cellOk(cell, s);
      items.push({ id: `x${i + 1}`, ok, why: ok ? '' : `「${cell.label}」${normCell(s) === '' ? '还空着' : '不对'}` });
    });
    return { items, needsClaude: false, stop: items.some((x) => x.ok === false) };
  }
  const head = table.head?.[bad.first.c];
  const where = /^\d+$/.test(String(head ?? '')) ? `第 ${head} 格` : head !== undefined ? `的「${head}」` : `第 ${bad.first.c + 1} 格`;
  const it = { id: bad.id, ok: false, why: `${traceRowName(table, bad.r)}${where}${bad.first.empty ? '还空着' : '不对'}` };
  // 后面的行：只有那四种排序接着核（carried：ok 是对学生自己的上一行而言；这道题照样没过）；别的引擎错行后面的不列
  const later = [];
  if (sort && CARRY.has(input.algo)) {
    const n = input.items.length;
    const nums = (r) => {
      const xs = table.rows[r].cells.map((c, j) => plainNum(c.given ? [].concat(c.v)[0] : cells[r][j]));
      return xs.length === n && xs.every(Number.isFinite) ? xs : null;
    };
    let prev = nums(bad.r);
    for (const x of rows.filter((y) => y.r > bad.r)) {
      const mine = nums(x.r);
      let ok = false;
      if (prev && mine) { const want = sortPass(input.algo, prev, x.r + 1, { gaps: input.gaps, n }); ok = want.length === mine.length && want.every((v, i) => v === mine[i]); }
      const name = traceRowName(table, x.r);
      const blank = table.rows[x.r].cells.some((c, j) => !c.given && normCell(cells[x.r][j]) === '');
      const why = ok ? '' : blank ? `${name}还空着` : !mine ? `${name}读不懂：写一排数` : !prev ? '上一行读不成一排数，接着核不了' : `${name}按你写的上一行推也不对`;
      later.push({ id: x.id, ok, carried: true, why });
      prev = mine;
    }
  }
  // 错法（写了 against 只认那几种）：错的地方一半以上和照那种错法填的表对得上
  const want = probe.against || [];
  const vlist = T.variants.filter((v) => !want.length || want.includes(v.key));
  const label = misreadFill(table, cells, vlist);
  const hitV = label ? vlist.find((v) => v.label === label) : null;
  if (hitV) Object.assign(it, { tag: hitV.key, why: `${it.why}；${hitV.label}`, keys: [`tag=${hitV.key}`, it.id] });
  else if (later.length && later.every((y) => y.ok === true) && nearMiss(table.rows[bad.r], cells[bad.r])) {
    Object.assign(it, { tag: 'slip', why: `后面按你自己的上一行推都对，第 ${bad.r + 1} 趟这一处写错了`, keys: ['slip', 'tag=slip', it.id] });
  } else it.keys = [it.id];
  return { items: [...items, it, ...later], needsClaude: false, stop: true };
}

// —— 408 的 code（计划 4 Task 5）：真跑老师给的测试，一个测试一项；编译错一项 compile ——
// 学生的代码死循环、越界、编译错都按测试点判没过、写原因（codejudge 里有步数上限，不卡页面）；
// 老师这边的毛病（检查函数 / 参考解法出错）判不了，待核（null），不怪学生
const codeWhy = (r) => (r.error ? `${r.error}${r.errLine ? `（第 ${r.errLine} 行）` : ''}` : (r.diff || []).map((d) => `${d.what}：想要 ${d.want}，得到 ${d.got}`).join('；') || '结果不对');
function codeItems(probe, answer = {}) {
  const src = String(answer.code ?? '');
  let spec;
  try { spec = parseCodeSpec(probe.code || {}); } catch (e) { return { items: [{ id: 'run', ok: null, why: `页面读不了这道题的测试：${e.message}` }], needsClaude: false, stop: true }; }
  const all = (why) => ({ items: spec.tests.map((_, i) => ({ id: `t${i + 1}`, ok: false, why })), needsClaude: false, stop: true });
  if (!src.trim()) return all('没写代码');
  let res;
  try { res = runTests(src, spec); } catch (e) { return all(`跑不起来：${e.message}`); }
  if (res.some((r) => r.compile)) return { items: [{ id: 'compile', ok: false, why: codeWhy(res.find((r) => r.compile)) }], needsClaude: false, stop: true };
  const items = res.map((r, i) => ({ id: `t${i + 1}`, ok: r.ok ? true : r.teacher ? null : false, why: r.ok ? '' : codeWhy(r) }));
  return { items, needsClaude: false, stop: items.some((x) => x.ok === false) };
}

// solve / calc 的 result：用 run 算出的量或式子比学生写的最后的值；并列、算不了都是待核
function resultItem(probe, answer = {}, base = {}) {
  if (!probe.result) return null;
  const names = runNames(probe);
  let rv;
  try { rv = runVars(probe, {}, base); } catch (e) { return { id: 'result', ok: null, why: `页面算不了：${e.message}` }; }
  if (rv.error) return { id: 'result', ok: null, why: `页面跑不了：${rv.error.msg}` };
  if (tiedIn(probe, [probe.result], rv.ties)) return { id: 'result', ok: null, why: TIE_WHY };
  let right;
  try { right = expectValue(probe.result, rv.vars, names); } catch (e) { return { id: 'result', ok: null, why: `页面算不了最后的值：${e.message}` }; }
  if (typeof right === 'number' && !Number.isFinite(right)) return { id: 'result', ok: null, why: '页面算不了最后的值：算出来不是一个数' };
  const s = String(answer.result ?? '').trim();
  if (!s) return { id: 'result', ok: false, why: '没写最后的值' };
  const m = valueMatch(s, right);
  return m === true ? { id: 'result', ok: true, why: '' } : { id: 'result', ok: false, why: m === null ? unreadWhy(right) : '最后的值不对' };
}

// —— 英语（计划 4 Task 6）：parse、rewrite、errfind、discriminate 的两个按钮页面判；translate 照 recall 全交页面里的 Claude ——

const roleName = (probe, role) => probe.roles?.find((r) => r.key === role)?.name || ROLES[role] || role;

/** parse 的 key 每个成分的编号（按句子先后；同一种第二个起 RC2、RC3…）：[{ id, span }] */
export function parseItemIds(probe) {
  const seen = {};
  return (probe.spans || []).map((span) => {
    seen[span.role] = (seen[span.role] || 0) + 1;
    return { id: seen[span.role] > 1 ? `${span.role}${seen[span.role]}` : span.role, span };
  });
}

/** 词和成分写回括号写法：[S The man [RC who called]] [V met] …（外面的先开、里面的先关） */
export function bracketText(tokens = [], spans = []) {
  const sorted = [...spans].sort((a, b) => a.from - b.from || b.to - a.to);
  const words = tokens.map((t, i) => {
    const open = sorted.filter((s) => s.from === i).map((s) => `[${s.role} `).join('');
    const close = ']'.repeat(sorted.filter((s) => s.to === i).length);
    return `${open}${t.w}${close}`;
  });
  return joinWords(words);
}

/**
 * parse：学生标的 vs key，宽严和一类 parse 的 judgeSpans 一样（范围一模一样才算标到；标点不算进头尾）。
 * 先配范围和角色都一样的，再配范围一样角色不一样的（false「这是 X，标成了 Y」），key 剩下的 missing，学生剩下的并成一项 extra
 */
function parseItems(probe, answer = {}) {
  const mine = (answer.spans || []).map((s) => ({ role: s.role, from: Number(s.from), to: Number(s.to) }));
  const used = new Set();
  const ids = parseItemIds(probe);
  const res = new Map();
  const take = (span, same) => mine.findIndex((m, k) => !used.has(k) && m.from === span.from && m.to === span.to && (!same || m.role === span.role));
  for (const { id, span } of ids) { const k = take(span, true); if (k >= 0) { used.add(k); res.set(id, { id, ok: true, why: '' }); } }
  for (const { id, span } of ids) {
    if (res.has(id)) continue;
    const k = take(span, false);
    if (k >= 0) { used.add(k); res.set(id, { id, ok: false, why: `这是${roleName(probe, span.role)}，标成了${roleName(probe, mine[k].role)}` }); }
  }
  const left = mine.filter((_, k) => !used.has(k));
  const nearUsed = new Set();
  const text = (s) => spanText(probe.tokens, s);
  const items = ids.map(({ id, span }) => {
    const keys = [id, ...(id !== span.role ? [span.role] : []), `role=${span.role}`];
    if (res.has(id)) { const it = res.get(id); return it.ok ? it : { ...it, keys }; }
    // 同一种成分标了，范围不对（被动的谓语只标了 were）：照旧是没标到，说一句范围不对
    const near = left.find((m) => m.role === span.role && m.from <= span.to && m.to >= span.from && !nearUsed.has(m));
    if (near) nearUsed.add(near); // 这一段已经说成「范围不对」了，不再另列在「多标了」里
    const name = roleName(probe, span.role);
    return { id, ok: 'missing', why: near ? `${name}的范围不对：标了「${text(near)}」` : `没标出${name}`, keys };
  });
  const rest = left.filter((m) => !nearUsed.has(m));
  if (rest.length) items.push({ id: 'extra', ok: false, why: `多标了：${rest.map((m) => `「${text(m)}」（${roleName(probe, m.role)}）`).join('、')}`, keys: ['extra'] });
  return { items, needsClaude: false, stop: items.some((x) => x.ok === false || x.ok === 'missing') };
}

/** rewrite：has 每条一项（h1…）、not 每条一项（n1…，写了就是 false）；有一项不过停下；都过、写了 must 交页面里的 Claude */
function rewriteItems(probe, answer = {}) {
  const text = String(answer.text ?? '');
  const r = rewriteHits(probe, text);
  const empty = !text.trim();
  const items = [
    ...(probe.has || []).map((h, i) => ({ id: h.id, ok: r.has[i] === true, why: r.has[i] ? '' : empty ? '还没写' : h.msg || '没有用到要求的写法' })),
    ...(probe.not || []).map((h, i) => ({ id: h.id, ok: !empty && !r.not[i], why: empty ? '还没写' : r.not[i] ? h.msg || `写了不该有的「${h.frag}」` : '' })),
  ];
  const stop = items.some((x) => !x.ok);
  return { items, needsClaude: !stop && (probe.must || []).length > 0, stop };
}

// errfind 的改法：删掉 / 删 / del / - 都当「（删掉）」（和一类 errfind 一样）
const DEL = /^[（(]?\s*(删掉|删去|删除|删|去掉|delete|del|-|—)\s*[)）]?$/i;
const delNorm = (s) => (DEL.test(String(s ?? '').trim()) ? '（删掉）' : String(s ?? ''));
const FIX_OPTS = { sentence: true };

/** errfind：点的词一项 word（点了 decoys 里的，why 写那条、补讲找 decoy=词）、改法一项 fix（常见的错改法 why 写那条）；不对停下 */
function errfindItems(probe, answer = {}) {
  const toks = tokenOf(probe);
  const at = answer.word === undefined || answer.word === null || answer.word === '' ? -1 : Number(answer.word);
  if (at !== probe.wordAt) {
    const decoy = (probe.decoys || []).find((d) => d.i === at);
    const w = toks[at]?.w;
    const why = at < 0 || !w || !toks[at].word ? '没点错的词' : decoy ? `「${w}」用得没错：${decoy.why}` : `「${w}」用得没错，错的是别的词`;
    return { items: [{ id: 'word', ok: false, why, keys: [...(decoy ? [`decoy=${decoy.w}`] : []), 'word'] }], needsClaude: false, stop: true };
  }
  const items = [{ id: 'word', ok: true, why: '' }];
  // 学生把改法用引号括起来（"known"、‘known’）不算错
  const s = String(answer.fix ?? '').trim().replace(/^["“”‘’']+|["“”‘’']+$/g, '').trim();
  const fixes = (probe.fix || []).map(delNorm);
  const m = s ? matchText(delNorm(s), fixes, FIX_OPTS) : { ok: false, empty: true };
  if (m.ok) items.push({ id: 'fix', ok: true, why: '' });
  else {
    const bad = s ? diagnose(s, probe.fixWrongs || [], FIX_OPTS) : null;
    items.push({ id: 'fix', ok: false, why: !s ? '没写改成什么' : bad ? `改成了常见的错法「${bad.text}」${bad.why ? `：${bad.why}` : ''}` : '找对了，改得不对', keys: ['fix'] });
  }
  const stop = items.some((x) => !x.ok);
  return { items, needsClaude: !stop && (probe.must || []).length > 0, stop };
}

// errfind 的句子切成的词（和一类 errfind、findWrong 的下标一样）
const tokCache = new WeakMap();
function tokenOf(probe) {
  if (!tokCache.has(probe)) tokCache.set(probe, tokenizeSentence(probe.text));
  return tokCache.get(probe);
}

/**
 * 一项在画面上叫什么（不露编号）：predict 的 expect 是外部写的标签，run 是「跑引擎」；trace 的 r1… 是那张表的行名
 * （「第 2 趟（d = 2）」「第 10 列「3」」「第 k 行」），x1… 是表下面那几格的名字；别的 null（外壳照旧）
 */
export function itemLabel(probe, id) {
  if (probe?.type === 'code') return id === 'compile' ? '编译' : /^t\d+$/.test(id) ? `测试 ${id.slice(1)}` : null;
  if (id === 'run') return '跑引擎';
  if (probe?.type === 'parse') {
    if (id === 'extra') return '多标的';
    const x = parseItemIds(probe).find((y) => y.id === id);
    if (!x) return null;
    const n = Number(id.slice(x.span.role.length)) || 1;
    return `${roleName(probe, x.span.role)}${n > 1 ? `（第 ${n} 个）` : ''}`;
  }
  if (probe?.type === 'rewrite' && /^[hn]\d+$/.test(id)) {
    const list = id[0] === 'h' ? probe.has || [] : probe.not || [];
    const k = Number(id.slice(1));
    const what = id[0] === 'h' ? '要有的写法' : '不该有的写法';
    return k >= 1 && k <= list.length ? `${what}${list.length > 1 ? ` ${k}` : ''}` : null;
  }
  if (probe?.type === 'errfind') return id === 'word' ? '错的词' : id === 'fix' ? '改法' : null;
  if (probe?.type === 'discriminate' && id === 'pick') return '选哪个';
  if (id === 'result' && baseType(probe) === 'solve') return '最后的值';
  if (probe?.type === 'trace' && /^[rx]\d+$/.test(id)) {
    let T;
    try { T = traceTable(probe); } catch { return null; }
    if (id[0] === 'x') return T.table.extra?.[Number(id.slice(1)) - 1]?.label ?? null;
    const x = traceRows(T.table).find((y) => y.id === id);
    return x ? traceRowName(T.table, x.r) : null;
  }
  const e = (probe?.expects || []).find((x) => x.id === id);
  return e ? e.label : null;
}

/**
 * 页面机器判的那一半。answer 的样子见 Task 2：construct { slots, exprs }；claim { truth, slots?, exprs?, text?, ink?, proof? }；
 * discriminate { can, text?, ink?, result? }；locate { line, text?, ink?, fix? }；recall / solve { text?, ink? }；
 * 408 的 construct 的 seq / text / procs 格子是学生写的原文；predict { expects: { x1: '10', … }, text?, ink? }。
 * 英语：parse { spans: [{ role, from, to }] }（下标照 probe.tokens）；rewrite { text }；translate { text?, ink? }（同 recall）；
 * errfind { word（点的词在 probe.text 切出来的第几个记号，tokenizeSentence 的下标）, fix, text? }；discriminate 的两个按钮 { pick（选的那个字）, text?, ink? }。
 * 返回 { items, needsClaude（还有要点 / 步骤要页面里的 Claude 判）, stop（判断错了：真假、能不能、哪一行，后面不用判了）}
 */
export function judgeMachine(probe, answer = {}, base = {}) {
  let vars;
  try { vars = withDefaults(probeVars(probe, base), probe.slots || []); } catch { vars = withDefaults({ ...base }, probe.slots || []); }
  const items = [];
  const hasPoints = (probe.must || []).length > 0;
  switch (baseType(probe)) {
    case 'construct':
      if (is408(probe)) return construct408(probe, answer, base);
      items.push(...ifItems(probe, answer.slots, vars), ...exprItems(probe, answer.exprs));
      return { items, needsClaude: false, stop: false };
    case 'predict':
      return predictItems(probe, answer, base);
    case 'trace':
      return traceItems(probe, answer);
    case 'claim': {
      const ok = answer.truth === probe.truth;
      items.push({ id: 'truth', ok, why: ok ? '' : `这个命题是${probe.truth ? '真' : '假'}的` });
      if (!ok) return { items, needsClaude: false, stop: true };
      if (!probe.truth) { items.push(...ifItems(probe, answer.slots, vars), ...exprItems(probe, answer.exprs)); return { items, needsClaude: false, stop: false }; }
      if (probe.proof) { items.push(proofItem(probe, answer.proof)); return { items, needsClaude: false, stop: false }; }
      return { items, needsClaude: hasPoints, stop: false };
    }
    case 'discriminate': {
      if (probe.options) { // 两个按钮：选对了理由交页面里的 Claude，选错了停下
        const ok = normText(answer.pick ?? '') !== '' && normText(answer.pick) === normText(probe.answer);
        items.push({ id: 'pick', ok, why: ok ? '' : answer.pick ? `这里是「${probe.answer}」` : '没选' });
        if (!ok) return { items, needsClaude: false, stop: true };
        return { items, needsClaude: hasPoints, stop: false };
      }
      const ok = answer.can === probe.can;
      items.push({ id: 'can', ok, why: ok ? '' : `这里${probe.can ? '能' : '不能'}用` });
      if (!ok) return { items, needsClaude: false, stop: true };
      if (probe.result) {
        const s = String(answer.result ?? '').trim();
        const v = s ? sameValue(s, probe.result, vars) : false;
        items.push({ id: 'result', ok: v, why: v === true ? '' : v === null ? '页面算不了这个结果' : s ? '结果不对' : '没写结果' });
      }
      return { items, needsClaude: hasPoints, stop: false };
    }
    case 'locate': {
      const ok = Number(answer.line) === probe.bug;
      items.push({ id: 'line', ok, why: ok ? '' : `第 ${Number(answer.line) || '?'} 行是对的` });
      if (!ok) return { items, needsClaude: false, stop: true };
      if (probe.fix) {
        const s = String(answer.fix ?? '').trim();
        const v = s ? sameValue(s, probe.fix, vars) : false;
        items.push({ id: 'fix', ok: v, why: v === true ? '' : v === null ? '页面判不了这个改法' : s ? '改得不对' : '没写改成什么' });
      }
      return { items, needsClaude: hasPoints, stop: false };
    }
    case 'code':
      return codeItems(probe, answer);
    case 'parse':
      return parseItems(probe, answer);
    case 'rewrite':
      return rewriteItems(probe, answer);
    case 'errfind':
      return errfindItems(probe, answer);
    case 'solve': { // solve / calc：写了 result 的先核最后的值，步骤照旧全交页面里的 Claude
      const it = resultItem(probe, answer, base);
      return { items: it ? [it] : [], needsClaude: true, stop: false };
    }
    default: // recall：全交给页面里的 Claude
      return { items, needsClaude: true, stop: false };
  }
}

// —— 页面里的 Claude 判的那一半 ——
// 要点（recall、claim 的证明要点、discriminate / locate 的理由）和 solve 的步骤：每交一次调一次 Opus 5.5 high（调用方 classroom.js 做），
// 给它的只有事实，回的 [判] 那几行和计划 1 的 board judge 同一种写法，用计划 1 的 parseJudge 读。读不出来的一律待核，绝不当成过。

export const JUDGE_WAIT = 90000; // 一次最多等多久：到了这道题待核（设计 5.6′）
// 外部没写 <<< >>> 时给页面里的 Claude 的话：外部在任务书里写的原话
export const DEFAULT_FALLBACK = '指出错在哪、只补缺的那一点（不给整段答案）。';

// 两条的开头（?dev 的模拟老师按它认出来，devteacher.js）
export const VERDICT_HEAD = '学习台上，学生在课后的检验里交了一道题（合书、第一次作答）。下面是题、主讲（外部的 Claude）写好的判分要点、学生交的。页面按你回的结论接着走：过了出下一道，没过显示主讲写的补讲、再出一道同类的题。';
export const FALLBACK_HEAD = '学习台上，学生在课后的检验里做错了一道题，主讲（外部的 Claude）写的补讲里没有对上这一次的错法。你写的话会原样显示在这道题下面当补讲，之后页面出一道同类的题让学生自己做。';

/** 要它判的项的编号：solve 是参考步骤，别的是 must、may、wrong */
export function claudeIds(probe) {
  if (baseType(probe) === 'solve') return (probe.steps || []).map((s) => s.id);
  return [...(probe.must || []), ...(probe.may || []), ...(probe.wrong || [])].map((x) => x.id);
}

const VERDICT_LINE = /^\s*[-*]?\s*([A-Za-z]\w{0,15})\s+(ok|right|wrong|bad|missing|miss|unsure|对|错|缺|没写|待核|✓|✗|\?|？)(\s|$)/i;
const SCRIPT_LINE = /^\s*L(\d+)\s*(\[划掉\])?\s*[:：]\s?(.*)$/;

/**
 * 读它回的：[转写] 下的 L1 / L2 [划掉] 行，[判] 下的一行一项。ids 里没写到的 → ok: null、「没判这一项」；不在 ids 里的丢掉；
 * 一项都读不出来 → unread: true、全部 ok: null。steps：判的是 solve 的步骤（missing 照计划 1 带 tag 步骤缺）
 * 返回 { lines: [{ n, text, struck }], items: [{ id, ok, why, tag, unsure? }], unread }
 */
export function parseVerdict(text, ids = [], { steps = false } = {}) {
  const lines = [];
  const judged = [];
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    let m;
    if ((m = raw.match(SCRIPT_LINE))) { lines.push({ n: Number(m[1]), text: m[3].trim(), struck: !!m[2] }); continue; }
    if ((m = raw.match(VERDICT_LINE)) && ids.includes(m[1])) judged.push(raw.trim());
  }
  const r = judged.length ? parseJudge(judged.join('\n'), ids.map((id) => ({ id }))) : { steps: ids.map((id) => ({ id, ok: null, why: '', tag: '' })) };
  const items = r.steps.map((s) => {
    const got = judged.some((l) => l.match(VERDICT_LINE)?.[1] === s.id);
    const it = { ...s, why: got ? s.why : '没判这一项', tag: !steps && s.tag === '步骤缺' ? '' : s.tag || '' };
    return it;
  });
  return { lines, items, unread: judged.length === 0 };
}

const mayIds = (probe) => new Set((probe.may || []).map((x) => x.id));

/** 一道题过没过：may 不算；有 false / missing → fail；没有失败、有 null → pending；都过 → pass。guessed：过了但点的是「蒙的」 */
export function outcomeOf(probe, items = [], { sure } = {}) {
  const skip = mayIds(probe);
  const req = items.filter((x) => !skip.has(x.id));
  const failed = req.filter((x) => x.ok === false || x.ok === 'missing').map((x) => x.id);
  const outcome = failed.length ? 'fail' : req.some((x) => x.ok !== true) ? 'pending' : 'pass';
  return { outcome, failed, guessed: outcome === 'pass' && sure === 'guess' };
}

/** 判出没过以后显示哪一条补讲：失败项带 keys 的先照 keys，再按失败项的编号，再按失败项的 tag=…，想不出来时 giveup，最后 default；都没有 null */
export function teachFor(probe, failed = [], items = [], { giveup = false } = {}) {
  const t = probe.teach || {};
  const hit = (key) => (t[key] ? { key, text: t[key] } : null);
  if (giveup) return hit('giveup') || hit('default');
  // 项自己带了查找的先后（predict：tag=… → w1 → x1）：先照它找；没带 keys 的项照下面的老办法
  for (const id of failed) for (const k of items.find((x) => x.id === id)?.keys || []) { const h = hit(k); if (h) return h; }
  for (const id of failed) { const h = hit(id); if (h) return h; }
  for (const it of items) if (failed.includes(it.id) && it.tag) { const h = hit(`tag=${it.tag}`); if (h) return h; }
  return hit('default');
}

const OK_TEXT = { must: '必写要点', may: '可选要点（不影响过没过）', wrong: '常见错说法' };

/** 学生这次交的，写成几行事实 */
function answerText(probe, answer = {}, images = 0) {
  const out = [];
  if (probe.type === 'claim') out.push(`学生判这个命题是：${answer.truth ? '真' : '假'}`);
  if (probe.type === 'discriminate' && probe.options) out.push(`学生选的：${String(answer.pick ?? '').trim() || '（没选）'}`);
  else if (probe.type === 'discriminate') out.push(`学生判：${answer.can ? '能' : '不能'}用`, ...(answer.result ? [`学生写的结果：${answer.result}`] : []));
  if (probe.type === 'parse') out.push(`学生标的：${(answer.spans || []).length ? bracketText(probe.tokens, answer.spans) : '（一处都没标）'}`);
  if (probe.type === 'errfind') {
    const k = answer.word === undefined || answer.word === null || answer.word === '' ? -1 : Number(answer.word);
    const w = tokenOf(probe)[k]?.word ? tokenOf(probe)[k].w : '';
    out.push(w ? `学生点的词：「${w}」（第 ${tokenOf(probe).filter((t) => t.word && t.i <= k).length} 个词）` : '学生没点词', `学生写的改法：${String(answer.fix ?? '').trim() || '（没写）'}`);
  }
  if (probe.type === 'locate') out.push(`学生点的错的那一行：第 ${answer.line} 行`, ...(answer.fix ? [`学生写的改法：${answer.fix}`] : []));
  if (baseType(probe) === 'solve' && probe.result) out.push(`学生写的最后的值：${String(answer.result ?? '').trim() || '（没写）'}`);
  if (probe.type === 'predict') for (const e of probe.expects || []) out.push(`学生写的「${e.label}」：${String(answer.expects?.[e.id] ?? '').trim() || '（没写）'}`);
  if (probe.type === 'trace') {
    // 学生填的表：一行一行照写的抄（直接给出的行不抄）
    try {
      const { table } = traceTable(probe);
      out.push(`学生填的表（${(table.head || []).join(' | ')}）：`);
      for (const x of traceRows(table)) out.push(`${traceRowName(table, x.r)}：${table.rows[x.r].cells.map((c, j) => (c.given ? '（给出）' : String(answer.cells?.[x.r]?.[j] ?? '').trim() || '（空）')).join(' | ')}`);
    } catch { /* 表都出不来：判的那一项已经待核 */ }
  }
  if (answer.text) out.push('学生打的字：', '<<<', String(answer.text), '>>>');
  if (images) out.push(`附图 ${images} 张：学生在页面上手写的整页（左边淡色的 L1、L2… 是页面写的行号；灰色带一道线的是学生划掉的）。`);
  if (!answer.text && !images) out.push('学生这次没写字。');
  return out;
}

// 英语题给页面里的 Claude 的事实：原句、两个选项、参考译文 / 改写、错的词和改法（判理由时用）
function englishFacts(probe) {
  const out = [];
  if (probe.type === 'parse') out.push(`原句：${probe.text}`, `主讲标的成分：${bracketText(probe.tokens, probe.spans)}`);
  else if (['translate', 'rewrite', 'errfind'].includes(probe.type) && probe.text) out.push(`原句：${probe.text}`);
  if (probe.type === 'translate' && probe.answer) out.push(`参考译文：${probe.answer}`);
  if (probe.type === 'rewrite' && probe.example) out.push(`一句对的改写：${probe.example}`);
  if (probe.type === 'errfind') out.push(`错的词：「${tokenOf(probe)[probe.wordAt]?.w}」，改成：${(probe.fix || []).join(' / ')}`);
  if (probe.type === 'discriminate' && probe.options) out.push(`两个选项：${probe.options.join(' | ')}；对的是「${probe.answer}」`);
  return out;
}

/** 给页面里的 Claude 判分的那一条：题、要点或参考步骤、学生交的、要回的写法。只写事实 */
export function verdictPrompt({ probe, answer = {}, ids = claudeIds(probe), images = 0 } = {}) {
  const head = [VERDICT_HEAD, ''];
  const q = [`题（${probe.type}）：`, probe.claim ? `命题：${probe.claim}` : '', probe.q || '', ...(probe.lines || []).map((l, i) => `第 ${i + 1} 行：${l}`), ...englishFacts(probe)].filter(Boolean);
  const pts = [];
  if (baseType(probe) === 'solve') {
    pts.push('参考步骤：', ...(probe.steps || []).map((s) => `${s.id}（${STEP_KINDS[s.kind] || s.kind}）：${s.text}`));
    pts.push(`错法的词（tag=）：${STEP_TAGS.join('、')}`);
  } else {
    for (const k of ['must', 'may', 'wrong']) if ((probe[k] || []).length) pts.push(`${OK_TEXT[k]}：`, ...probe[k].filter((x) => ids.includes(x.id)).map((x) => `${x.id}：${x.text}`));
  }
  const fmt = [
    '回的写法：',
    ...(images ? ['[转写]', '照图一行一行写，行号照图左边的；划掉的行在行号后面写 [划掉]，比如：', 'L1: …', 'L2 [划掉]: …'] : []),
    '[判]',
    `每个编号一行（${ids.join('、')}）：`,
    baseType(probe) === 'solve'
      ? '`s1 ok`（这一步写了、对）、`s3 wrong tag=规则用错 why="…"`（写了、错）、`s4 missing`（没写这一步）'
      : '`m1 ok`（写到了、写对了）、`m2 missing`（没写到）、`m3 wrong why="…"`（写了、写错了）；常见错说法 w 开头的：`w1 ok` 是学生没写这个错说法，`w1 wrong why="…"` 是写了',
    '看不清、拿不准对错的写 unsure，页面会标待主讲核：`m2 unsure why="…"`。',
  ];
  return [...head, ...q, '', ...pts, '', ...answerText(probe, answer, images), '', ...fmt].join('\n');
}

/** 外部没写到的错法（没有对上的 teach）：叫页面里的 Claude 写一段补讲。extPrompt 是 board check 里 <<< >>> 外部写给它的话 */
export function fallbackPrompt({ probe, answer = {}, items = [], extPrompt = '' } = {}) {
  const failed = items.filter((x) => x.ok === false || x.ok === 'missing');
  return [
    FALLBACK_HEAD,
    '',
    `主讲写给你的话：${String(extPrompt || '').trim() || DEFAULT_FALLBACK}`,
    '',
    `题（${probe.type}）：${probe.claim || probe.q || ''}`,
    ...englishFacts(probe),
    ...['must', 'may', 'wrong'].flatMap((k) => (probe[k] || []).map((x) => `${OK_TEXT[k]} ${x.id}：${x.text}`)),
    ...(probe.steps || []).map((s) => `参考步骤 ${s.id}：${s.text}`),
    ...Object.entries(probe.teach || {}).map(([k, v]) => `主讲写的补讲（${k}）：${v}`),
    '',
    ...answerText(probe, answer, 0),
    '',
    '页面判出来没过的项：',
    ...(failed.length ? failed.map((x) => `${x.id}：${x.ok === 'missing' ? '没写到' : '不对'}${x.why ? `（${x.why}）` : ''}`) : ['（想不出来，没交）']),
  ].join('\n');
}
