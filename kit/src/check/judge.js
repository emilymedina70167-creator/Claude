// 检验的判（设计 5.3）：页面机器能判的当场判、不调 Claude（构造的每一条、式子、真假、能不能、哪一行、逐行证明、结果、改正）；
// 要点、证明要点、理由、solve 的步骤交给页面里的 Opus 5.5 high（下面另一半）。不碰 DOM，tests/check-judge*.test.js。
//
// 每一项的结论都是 { id, ok: true | false | 'missing' | null, why, tag? }（和计划 1 的 board judge / 证据的 steps 一个样子）：
// null 是页面判不了 / 拿不准，待外部核——任何时候都不当成过。
import { compile } from '../expr.js';
import { readCell } from '../anscheck.js';
import { equivalent } from '../ncalg.js';
import { normalizeFormula, FORMULA_FUNCS } from '../formula.js';
import { compareFx, DEFAULT_RANGE } from '../fx/sample.js';
import { parseDeriveDo, sampleEnvs, checkLine } from '../derivedo.js';
import { baseType, probeVars, evalIfs, withDefaults, runVars, measuresUsed, expectValue, runRefs, slotScope, traceTable, traceRows, traceRowName, rewriteHits, diagnosesOf, variantVars } from './spec.js';
import { ROLES, matchText, diagnose, normText, joinWords, spanText, tokenizeSentence } from '../entext.js';
import { sortPass } from '../engines/measures.js';
import { checkFill, cellOk, normCell, misreadFill } from '../stepperspec.js';
import { valueMatch, sameResult, unreadWhy, halfWidth, readProblem, UNSURE, ambiguousWhy } from './values.js';
import { parseJudge, STEP_KINDS, STEP_TAGS } from '../solvespec.js';
import { parseCodeSpec, runTests } from '../codejudge.js';

/** 还有几格没填（空串、只有空白、null） */
export function blankCells(v) {
  if (Array.isArray(v)) return v.reduce((n, x) => n + blankCells(x), 0);
  return v === null || v === undefined || String(v).trim() === '' ? 1 : 0;
}

// 格子里写的先全角转半角（iPad 中文键盘的 １/２），再照 anscheck 的 readCell 读
const readCellHalf = (x) => readCell(typeof x === 'string' ? halfWidth(x) : x);
// 1e999 读得出来却是 Infinity：和 cellNum 一样算读不懂（交之前就挡住）
const readable = (x) => { try { return Number.isFinite(Number(readCellHalf(x))); } catch { return false; } };

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
// 读出来不是有限数（1e999）算「写的不是数」：抛（调用的地方当写的不是数）
const cellNum = (x) => {
  if (Array.isArray(x)) return x.map(cellNum);
  const v = typeof x === 'number' ? x : Number(readCellHalf(x));
  if (!Number.isFinite(v)) throw new Error('不是有限数');
  return v;
};

const close = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => close(x, b[i]));
  // 有一边不是有限数（∞、-∞、1/0、10^400、NaN）就不相等（dr-final-fix 第 1 条）
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
};

/** 学生写的式子（省乘号、上标、希腊字母都认）在 vars 上算，和标准式子比值 */
function sameValue(student, expected, vars) {
  const names = Object.keys(vars);
  try {
    const s = compile(normalizeFormula(String(student), { names, funcs: FORMULA_FUNCS }))(vars);
    const e = compile(normalizeFormula(String(expected), { names, funcs: FORMULA_FUNCS }))(vars);
    return close(s, e);
  } catch { return fxSame(student, expected, vars); }
}

// 式子里有自变量 x、y（题里没给值）：高数的函数式，在 (−3, 3) 上取点比（计划 3，fx/sample.js）；判不了是 null
function fxSame(student, expected, vars = {}) {
  try {
    const names = [...new Set([...Object.keys(vars), 'x', 'y'])];
    const s = normalizeFormula(String(student), { names, real: true });
    const e = normalizeFormula(String(expected), { names, real: true });
    const free = ['x', 'y'].filter((v) => !(v in vars) && new RegExp(`\\b${v}\\b`).test(`${s} ${e}`));
    if (!free.length) return null;
    return compareFx(e, s, { domain: free.map((name) => ({ ...DEFAULT_RANGE, name })), scope: vars, seed: String(expected) }).ok;
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
    // 非交换多项式判不了的（sin、ln 这些函数式）：交给实数取点（计划 3）；还判不了是 null
    let v = equivalent(s, e.expected);
    if (v === 'unknown') { const f = fxSame(s, e.expected); if (f !== null) v = f; }
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
    if (r.ok === null) return { id: 'proof', ok: null, why: `第 ${i + 1} 行页面判不了：${r.why}` };
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
  try { rv = runVars(probe, raw, base); } catch (e) { rv = { error: { msg: e.message, page: true } }; }
  // 页面这边的毛病（不是引擎的原话）：每一条条件、每个 expr 待核，不当成学生错
  if (rv.error?.page) {
    const why = `页面算不了：${rv.error.msg}`;
    const items = [...(probe.ifs || []), ...(probe.exprs || [])].map((x) => ({ id: x.id, ok: null, why }));
    return { items: items.length ? items : [{ id: 'run', ok: null, why }], needsClaude: false, stop: true };
  }
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
  // 用到 run 的量的 expr（比较次数: r.cmp）：照学生这组数跑出来的值比（selfCheck 也是照 run 的量验的）；
  // 不碰 run 的照旧走非交换多项式 / 实数取点那条路（计划 3）
  const names = runNames(probe);
  const touches = (e) => runRefs(e.expected, names) !== e.expected;
  const plain = (probe.exprs || []).filter((e) => !touches(e));
  const plainItems = exprItems({ ...probe, exprs: plain }, answer.exprs);
  for (const e of probe.exprs || []) {
    if (!touches(e)) { items.push(plainItems.shift()); continue; }
    items.push(runExprItem(probe, e, answer.exprs, raw, rv, names));
  }
  if (rv.notes.length && items[0]) items[0].why = [items[0].why, ...rv.notes].filter(Boolean).join('；');
  return { items, needsClaude: false, stop: false, notes: rv.notes };
}

// construct 408 里用到 run 的量的一个 expr：学生写的值 vs 照学生这组数跑出来的值。并列、算不了是待核，不当过
function runExprItem(probe, e, exprs, raw, rv, names) {
  if (tiedIn(probe, [e.expected], rv.ties)) return { id: e.id, ok: null, why: TIE_WHY };
  let right;
  try { right = expectValue(e.expected, slotScope(raw, rv.vars, probe.slots || []), names); } catch (err) { return { id: e.id, ok: null, why: `页面算不了这一项：${err.message}` }; }
  if (right === undefined || (typeof right === 'number' && !Number.isFinite(right))) return { id: e.id, ok: null, why: '页面算不了这一项：算出来不是一个数' };
  const s = String(exprs?.[e.id] ?? '').trim();
  if (!s) return { id: e.id, ok: false, why: `没写${e.label}` };
  const m = valueMatch(s, right);
  if (m === UNSURE) return { id: e.id, ok: null, why: ambiguousWhy(s) };
  return m === true ? { id: e.id, ok: true, why: '' } : { id: e.id, ok: false, why: m === null ? unreadWhy(right) : `${e.label}不对` };
}

// 每道题对的值算一次（交之前每打一个字都要查）：probe → { base, rights }
const RIGHTS = new WeakMap();
function expectRights(probe, base) {
  const hit = RIGHTS.get(probe);
  if (hit && hit.base === base) return hit.rights;
  const rights = {};
  let rv;
  try { rv = runVars(probe, {}, base); } catch { rv = { error: true }; }
  if (!rv.error) for (const e of probe.expects || []) { try { rights[e.id] = expectValue(e.value, rv.vars, runNames(probe)); } catch { /* 算不了的这一项不挡，判的时候待核 */ } }
  RIGHTS.set(probe, { base, rights });
  return rights;
}

/**
 * predict 交之前还差什么（和 construct 的 slotProblems 一样，挡住的不算第一次作答）：没写的、读不懂的（照对的值的样子：
 * 数带了单位、复杂度写成 O(n2)、一串数里夹了字）。全角、末尾的句号逗号不挡（values.js 的 cleanInput 读得懂）。[] 是能交了
 */
export function expectProblems(probe, got = {}, base = {}) {
  const rights = expectRights(probe, base);
  return (probe.expects || []).map((e) => {
    const s = String(got?.[e.id] ?? '').trim();
    if (!s) return `「${e.label}」还没写`;
    return Object.hasOwn(rights, e.id) ? readProblem(s, rights[e.id], e.label) : '';
  }).filter(Boolean);
}

/**
 * predict：每个 expect 一项（x1…）。不对时依次认：引擎的错法（against 的，没写看全部）→ tag、why 是错法的说法；
 * 外部写的错答案（wrong w1: 式子 => 说明）→ hit、why 是说明；错法、错答案这组数上算出来和对的一样的不用。
 * 几种诊断都对得上（这组数上答案一样）→ tags 全记、why「这几种错法在这组数上答案一样：…」、keys [x1, default]，不挑一种；
 * 认出来的都带 tagFit: 'exact'（值一模一样）。
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
    // 100B、5h：分不清是进制还是单位，待核（dr-final-fix 第 4 条的裁定）
    if (m === UNSURE) return { id: e.id, ok: null, why: ambiguousWhy(s) };
    // 判的时候还读不懂（交之前没挡住的）：读不懂不是答错，待核（dr-final-fix 第 4 条）
    if (m === null) return { id: e.id, ok: null, why: `${unreadWhy(right)}（页面读不懂，待核）` };
    const it = { id: e.id, ok: false, why: '' };
    const hits = diagnosesOf(probe, e, right, rv.vars, { names, allVariants }).filter((d) => valueMatch(s, d.value) === true);
    if (hits.length > 1) {
      // 几种诊断在这组数上答案一样（OPT 和「没算一开始调入」、外部写的 r.faults - 3 都是 9）：分不清是哪一种，都记下、不挑一种补讲
      Object.assign(it, { tags: hits.map((d) => d.key), tagFit: 'exact', why: `这几种错法在这组数上答案一样：${hits.map((d) => d.label).join('；')}`, keys: [e.id, 'default'] });
      return it;
    }
    const [d] = hits;
    if (d?.kind === 'tag') Object.assign(it, { tag: d.key, why: d.label, tagFit: 'exact' });
    if (d?.kind === 'hit') Object.assign(it, { hit: d.key, why: d.msg, tagFit: 'exact' });
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

// 一行里哪几格不对（按判分的单位：一格，或一组不管先后的几格）：[{ c, mine, want, empty }]。
// 一组格子（页框这样的 group）先把写对了的值消掉，剩下写的不在里面的格就是错的，「应该是」照剩下没对上的值依次给
function rowDiff(table, r, mine) {
  const row = table.rows[r];
  const out = [];
  const seen = new Set();
  const want0 = (c) => [].concat(c.v)[0];
  row.cells.forEach((cell, j) => {
    if (cell.given) return;
    const s = String(mine?.[j] ?? '');
    if (cell.group === undefined) {
      if (cellOk(cell, s)) return;
      out.push({ c: j, mine: s.trim(), want: cell.mark ? (normCell(want0(cell)) ? '√' : '') : String(want0(cell) ?? ''), empty: !cell.mark && normCell(s) === '', mark: !!cell.mark });
      return;
    }
    if (seen.has(cell.group)) return;
    seen.add(cell.group);
    const idx = row.cells.map((x, i) => (x.group === cell.group && !x.given ? i : -1)).filter((i) => i >= 0);
    const left = row.cells.filter((x) => x.group === cell.group).map((x) => String(want0(x) ?? '')).filter((x) => normCell(x) !== '');
    for (const x of row.cells.filter((y) => y.group === cell.group && y.given)) { const k = left.findIndex((w) => normCell(w) === normCell(want0(x))); if (k >= 0) left.splice(k, 1); }
    const bad = idx.filter((i) => {
      const v = normCell(mine?.[i] ?? '');
      if (!v) return true;
      const k = left.findIndex((w) => normCell(w) === v);
      if (k < 0) return true;
      left.splice(k, 1);
      return false;
    });
    // 空着而且这一组本来就不该再有值的格不算错（组里的值比格子少）
    for (const i of bad) {
      const s = String(mine?.[i] ?? '');
      const empty = normCell(s) === '';
      const want = left.length ? left.shift() : '';
      if (empty && !want) continue;
      out.push({ c: i, mine: s.trim(), want, empty });
    }
  });
  return out.sort((a, b) => a.c - b.c);
}

// 一行错在哪的话：「第 1 趟（d = 4）第 7、8 格：你写的 23 16，应该是 16 23」；空着的另说「第 3 格还空着」；整行空着「第 2 趟还空着」
function rowDiffWhy(table, r, diff) {
  const name = traceRowName(table, r);
  const fill = table.rows[r].cells.filter((c) => !c.given && !c.mark);
  if (fill.length && diff.filter((d) => d.empty).length >= fill.length) return `${name}还空着`;
  const colName = (c) => { const h = table.head?.[c]; return /^\d+$/.test(String(h ?? '')) ? { n: String(h) } : h !== undefined && h !== '' ? { l: String(h) } : { n: String(c + 1) }; };
  const cols = (ds) => {
    const xs = ds.map((d) => colName(d.c));
    if (xs.every((x) => x.n)) return `第 ${xs.map((x) => x.n).join('、')} 格`;
    return `的${xs.map((x) => (x.n ? `第 ${x.n} 格` : `「${x.l}」`)).join('、')}`;
  };
  const list = (ds, key) => { const vs = ds.map((d) => (d[key] === '' ? '（空）' : d[key])); return vs.some((v) => /\s/.test(v)) ? vs.map((v) => `「${v}」`).join('') : vs.join(' '); };
  // 打勾的格不说「你写的 空」：说该不该打勾
  const written = diff.filter((d) => !d.empty && !d.mark), blank = diff.filter((d) => d.empty);
  const tick = diff.filter((d) => d.mark && d.want), untick = diff.filter((d) => d.mark && !d.want);
  const parts = [];
  const more = (t) => (parts.length ? t.replace(/^的/, '') : t);
  if (written.length) parts.push(`${cols(written)}：你写的 ${list(written, 'mine')}，应该是 ${list(written, 'want')}`);
  if (blank.length) parts.push(`${more(cols(blank))}还空着`);
  if (tick.length) parts.push(`${more(cols(tick))}该打勾`);
  if (untick.length) parts.push(`${more(cols(untick))}不该打勾`);
  return `${name}${parts.join('；') || '不对'}`;
}

function traceItems(probe, answer = {}) { return traceJudge(probe, answer).res; }

/**
 * 没过的那一屏重画学生交的表用（shell.js）：{ table, cells（统一过撇号的作答）, bad: Set('r:c')（错的格）, badExtra: Set(i), faint: Set(r)（按自己的上一行推对了的行） }；
 * 不是 trace、页面跑不了引擎回 null
 */
export function traceReview(probe, answer = {}) {
  if (baseType(probe) !== 'trace') return null;
  const j = traceJudge(probe, answer);
  return j.table ? { table: j.table, cells: j.cells, bad: j.bad, badExtra: j.badExtra, faint: j.faint } : null;
}

function traceJudge(probe, answer = {}) {
  let T;
  const marks = { bad: new Set(), badExtra: new Set(), faint: new Set() };
  try { T = traceTable(probe); } catch (e) { return { res: { items: [{ id: 'run', ok: null, why: `页面跑不了：${e.message}` }], needsClaude: false, stop: true } }; }
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
      if (!ok) marks.badExtra.add(i);
      items.push({ id: `x${i + 1}`, ok, why: ok ? '' : `「${cell.label}」${normCell(s) === '' ? '还空着' : `不对：你写的 ${s.trim()}，应该是 ${[].concat(cell.v)[0]}`}` });
    });
    return { res: { items, needsClaude: false, stop: items.some((x) => x.ok === false) }, table, cells, ...marks };
  }
  // 靠并列定的那一步（走到这里是有格空着）：写了的格可能是另一种也对的做法，不说「应该是」、不标红，只说空着的
  const tied = ties.includes(bad.r);
  const diff = rowDiff(table, bad.r, cells[bad.r]).filter((d) => !tied || d.empty);
  for (const d of diff) marks.bad.add(`${bad.r}:${d.c}`);
  const it = { id: bad.id, ok: false, why: `${tied ? '这一步有并列；' : ''}${rowDiffWhy(table, bad.r, diff)}` };
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
      if (prev && mine) {
        const want = sortPass(input.algo, prev, x.r + 1, { gaps: input.gaps, n });
        ok = want.length === mine.length && want.every((v, i) => v === mine[i]);
        // 画回去时标出照学生自己的上一行推也不对的格（给出的格不标）
        if (!ok) table.rows[x.r].cells.forEach((c, j) => { if (!c.given && want[j] !== mine[j]) marks.bad.add(`${x.r}:${j}`); });
      } else table.rows[x.r].cells.forEach((c, j) => { if (!c.given && normCell(cells[x.r][j]) === '') marks.bad.add(`${x.r}:${j}`); });
      if (ok) marks.faint.add(x.r);
      const name = traceRowName(table, x.r);
      const blank = table.rows[x.r].cells.some((c, j) => !c.given && normCell(cells[x.r][j]) === '');
      const why = ok ? '' : blank ? `${name}还空着` : !mine ? `${name}读不懂：写一排数` : !prev ? '上一行读不成一排数，接着核不了' : `${name}按你写的上一行推也不对`;
      later.push({ id: x.id, ok, carried: true, why });
      prev = mine;
    }
  }
  // 错法（写了 against 只认那几种）：错的地方一半以上和照那种错法填的表对得上（misreadFill）；
  // 而且第一处错的那一行要像那种错法：整行和错法的那一行一样，或者这一行错的格里至少 2 格是照错法填的、
  // 而且这一行像错法的格比像对的多——不然两个数写反（错的两格里正好一格、两格和错法碰上）也会被说成那种错法
  const want = probe.against || [];
  // 一行按「判分的单位」切：一格，或一组不管先后的几格（页框这样的 group），和 misreadFill 一样
  const units = [];
  const seenG = new Set();
  table.rows[bad.r].cells.forEach((c, j, all) => {
    if (c.given) return;
    if (c.group === undefined) { units.push([j]); return; }
    if (seenG.has(c.group)) return;
    seenG.add(c.group);
    units.push(all.map((x, i) => (x.group === c.group && !x.given ? i : -1)).filter((i) => i >= 0));
  });
  const bag = (xs) => xs.map(normCell).filter(Boolean).sort().join('|');
  const mine = cells[bad.r];
  const unitIs = (row, u) => !!row && (u.length === 1 && row.cells[u[0]]?.group === undefined
    ? !!row.cells[u[0]] && cellOk(row.cells[u[0]], mine[u[0]] ?? '')
    : bag(u.map((j) => [].concat(row.cells[j]?.v ?? '')[0])) === bag(u.map((j) => mine[j] ?? '')));
  const looksLike = (v) => {
    const vr = v.table?.rows?.[bad.r], cr = table.rows[bad.r];
    if (!vr) return false;
    if (units.every((u) => unitIs(vr, u))) return true;
    const wrongHits = units.filter((u) => !unitIs(cr, u) && unitIs(vr, u)).length;
    return wrongHits >= 2 && units.filter((u) => unitIs(vr, u)).length > units.filter((u) => unitIs(cr, u)).length;
  };
  const vlist = T.variants.filter((v) => (!want.length || want.includes(v.key)) && looksLike(v));
  const label = misreadFill(table, cells, vlist);
  const hitV = label ? vlist.find((v) => v.label === label) : null;
  // 整行和错法的那一行一样是 exact，只是大半像是 partial（话前面加「可能」：学生可能做的是另一件事）
  const fitOf = (v) => (units.every((u) => unitIs(v.table?.rows?.[bad.r], u)) ? 'exact' : 'partial');
  // 和 hitV 一样像的（misreadFill 两个先后都挑自己：对得上的格一样多）、而且像的程度（整行 / 大半）一样：分不清是哪一种
  const same = hitV ? vlist.filter((v) => v === hitV || (fitOf(v) === fitOf(hitV) && misreadFill(table, cells, [v, hitV]) === v.label && misreadFill(table, cells, [hitV, v]) === hitV.label)) : [];
  const say = (fit, text) => (fit === 'partial' ? `可能${text}` : text);
  if (same.length > 1) {
    const fit = fitOf(hitV);
    Object.assign(it, { tags: same.map((v) => v.key), tagFit: fit, why: `${it.why}；${say(fit, `这几种错法在这组数上答案一样：${same.map((v) => v.label).join('；')}`)}`, keys: [it.id, 'default'] });
  } else if (hitV) {
    const fit = fitOf(hitV);
    Object.assign(it, { tag: hitV.key, tagFit: fit, why: `${it.why}；${say(fit, hitV.label)}`, keys: [`tag=${hitV.key}`, it.id] });
  } else if (later.length && later.every((y) => y.ok === true) && nearMiss(table.rows[bad.r], cells[bad.r])) {
    Object.assign(it, { tag: 'slip', why: `${it.why}（后面按你自己的上一行推都对）`, keys: ['slip', 'tag=slip', it.id] });
  } else it.keys = [it.id];
  return { res: { items: [...items, it, ...later], needsClaude: false, stop: true }, table, cells, ...marks };
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
  // 判的时候还读不懂（交之前没挡住的）：待核，不当答错（dr-final-fix 第 4 条）
  if (m === null) return { id: 'result', ok: null, why: `${unreadWhy(right)}（页面读不懂，待核）` };
  if (m === UNSURE) return { id: 'result', ok: null, why: ambiguousWhy(s) };
  return m === true ? { id: 'result', ok: true, why: '' } : { id: 'result', ok: false, why: '最后的值不对' };
}

// solve / calc 的 result 对的值（交之前每打一个字都要查，算一次存着）；算不了 undefined（不挡，判的时候待核）
const RESULT_RIGHT = new WeakMap();
function resultRight(probe, base) {
  const hit = RESULT_RIGHT.get(probe);
  if (hit && hit.base === base) return hit.right;
  let right;
  try {
    const rv = runVars(probe, {}, base);
    if (!rv.error && !tiedIn(probe, [probe.result], rv.ties)) right = expectValue(probe.result, rv.vars, runNames(probe));
  } catch { right = undefined; }
  RESULT_RIGHT.set(probe, { base, right });
  return right;
}

/**
 * solve / calc 的「最后的值」交之前读不读得懂（和 predict 的 expectProblems 一样照对的值的样子查：带了单位、
 * 一串数里夹了字）。读得懂、没写、页面算不出对的值都是 ''（没写另由画面说）
 */
export function resultProblem(probe, result, base = {}) {
  if (!probe?.result) return '';
  const s = String(result ?? '').trim();
  if (!s) return '';
  const right = resultRight(probe, base);
  return right === undefined ? '' : readProblem(s, right, '最后的值');
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
