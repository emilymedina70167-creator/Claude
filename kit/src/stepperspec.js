// 步进器（一步步走的演示）的公共写法：模式、问哪几步、播放速度；以及「先猜再揭晓」的判分。
// 每个算法是一个引擎（engines/*.js）：parse(fields) → 输入，run(输入) → 每一步的状态和一句说明，view(状态) → 画面。
// 外壳（stepper.js）统一管上一步 / 下一步 / 播放、ask、quiz、课堂的 figure、记录。
// 这里是不碰 DOM 的部分，有测试（tests/stepper.test.js）。
import { parseSeqAnswer, checkSeq, radixAnswer, checkRadix } from './textcheck.js';
import { expandCalc, calcValue, exactText } from './exact.js';

/**
 * 每个引擎的步：{ view, msg, ask? }
 *   view：交给引擎的 view() 画的状态（随便什么结构）
 *   msg：这一步的说明（Markdown，可以有 $公式$）
 *   ask：走到这一步之前可以先问学生的问题（学生猜这一步会怎样）：
 *     { tag, q, kind: 'pick' | 'choice' | 'text', answer, choices?, count?, explain? }
 *     tag：问题的种类（作者用 ask: 种类 挑），pick：在图上点（answer 是 data-pick 的值，几个都对时写数组 alts），
 *     choice：选项按钮，text：写一个序列（answer 是序列原文，几种都对用 | 隔开），
 *     order：在图上按顺序一个个点出一个序列（遍历序列、加入 S 的顺序……；answer 同 text，元素是 data-pick 的值）
 */

const BOOL = /^(true|yes|on|1|是)$/i;

/** 公共字段：mode（demo 演示 / quiz 只给输入、写出结果）、ask、start（一开始停在第几步）、speed（播放时每步几秒） */
export function commonSpec(fields = {}) {
  const mode = String(fields.mode || 'demo').trim().toLowerCase();
  if (!['demo', 'quiz', 'fill'].includes(mode)) throw new Error(`mode: 只能是 demo（演示，默认）、quiz（只给输入，写出结果）或 fill（自己把整张表填出来）（现在是「${fields.mode}」）`);
  const speed = fields.speed === undefined || fields.speed === '' ? 1.2 : Number(String(fields.speed).replace(/s$/i, ''));
  if (!(speed >= 0.2 && speed <= 10)) throw new Error(`speed: 写 0.2 到 10 之间的秒数（现在是「${fields.speed}」）`);
  const start = fields.start === undefined || fields.start === '' ? 0 : String(fields.start).trim().toLowerCase();
  if (start !== 0 && start !== 'end' && !(Number.isInteger(Number(start)) && Number(start) >= 0)) throw new Error(`start: 写步号（0 是开始）或 end（现在是「${fields.start}」）`);
  return { mode, ask: parseAskField(fields.ask), speed, start: start === 'end' ? 'end' : Number(start), auto: BOOL.test(fields.auto || '') };
}

/** ask: all / 种类（几个用逗号）/ 步号（3, 5）/ 混着写。不写就是不问 */
export function parseAskField(src) {
  const s = String(src ?? '').trim();
  if (!s || /^(none|no|off|false|不问)$/i.test(s)) return null;
  const out = { all: false, tags: [], nums: [] };
  for (const t of s.split(/[\s,，、]+/).filter(Boolean)) {
    if (/^(all|every|全部|每一步)$/i.test(t)) out.all = true;
    else if (/^\d+$/.test(t)) out.nums.push(Number(t));
    else out.tags.push(t.toLowerCase());
  }
  return out;
}

// 一步能问的：主问题 ask，加上额外的 asks（比如第 1 步既能问「第一个访问谁」，也能问「整个序列按顺序点出来」）
const asksOf = (s) => [s.ask, ...(Array.isArray(s.asks) ? s.asks : [])].filter(Boolean);

/**
 * 按作者的 ask: 挑出要问的步（步号，从 1 数；第 0 步是开始的样子，不问）。
 * 返回 { asks: Set(步号), which: Map(步号 → 问哪个), errors: [中文说明] }：点了没有问题可问的步号、或者不认识的种类，都报出来。
 * 同一步有几个问题时，按作者写的种类的先后挑第一个对得上的
 */
export function resolveAsks(ask, steps) {
  const asks = new Set();
  const which = new Map();
  const errors = [];
  if (!ask) return { asks, which, errors };
  const tags = new Set();
  steps.forEach((s, k) => { if (k > 0) asksOf(s).forEach((a) => tags.add(a.tag)); });
  const askable = steps.map((s, k) => (k > 0 && asksOf(s).length ? k : -1)).filter((k) => k > 0);
  const put = (k, a) => { if (!which.has(k)) { which.set(k, a); asks.add(k); } };
  for (const t of ask.tags) {
    if (!tags.has(t)) { errors.push(`ask: 没有「${t}」这种问题${tags.size ? `（这个演示能问的：${[...tags].join('、')}）` : '（这个演示没有可以问的步）'}`); continue; }
    askable.forEach((k) => { const a = asksOf(steps[k]).find((x) => x.tag === t); if (a) put(k, a); });
  }
  if (ask.all) askable.forEach((k) => put(k, asksOf(steps[k])[0]));
  for (const n of ask.nums) {
    if (n < 1 || n >= steps.length) errors.push(`ask: 没有第 ${n} 步（一共 ${steps.length - 1} 步）`);
    else if (!asksOf(steps[n]).length) errors.push(`ask: 第 ${n} 步没有可以问的${askable.length ? `（能问的步：${askable.slice(0, 12).join('、')}${askable.length > 12 ? '……' : ''}）` : ''}`);
    else put(n, asksOf(steps[n])[0]);
  }
  return { asks: new Set([...asks].sort((a, b) => a - b)), which, errors };
}

const norm = (x) => String(x ?? '').trim().toUpperCase();

/**
 * 判一次猜测。given：pick 是点的值（count > 1 时是数组），choice 是选的选项，text 是写的文字。
 * 返回 { ok, msg, wrong? }
 */
export function checkAsk(ask, given) {
  if (ask.kind === 'number') {
    const g = readNumber(given);
    if (g === null) return { ok: false, msg: '写一个数（整数、小数或分数，如 2.5、5/2）。' };
    // 小数写到两位（四舍五入）也算对：ASL 这类常常除不尽
    const a = Number(ask.answer);
    const decimals = (String(given).trim().split('.')[1] || '').length;
    const tol = decimals && decimals <= 2 && !String(given).includes('/') ? 0.5 * 10 ** -decimals + 1e-9 : 1e-9;
    const ok = Math.abs(g - a) <= tol;
    return { ok, msg: ok ? '' : '不对，再算算。' };
  }
  if (ask.kind === 'bin' || ask.kind === 'hex') {
    // 位串：answer 是数（BigInt 也行）；width 要求写满几位
    const r = checkRadix(given, radixAnswer(typeof ask.answer === 'bigint' ? ask.answer : Number(ask.answer), ask.kind === 'bin' ? 2 : 16, ask.width || 0));
    return { ok: r.ok, msg: r.msg, wrong: r.wrong };
  }
  if (ask.kind === 'text' || ask.kind === 'order') {
    const text = Array.isArray(given) ? given.join(' ') : given;
    const r = checkSeq(text, parseSeqAnswer(ask.answer));
    if (ask.kind === 'order' && !r.ok) {
      // 在图上点的：没有输入框可以标红，话要说成「接着点」
      const n = Array.isArray(given) ? given.length : r.tokens?.length || 0;
      const total = parseSeqAnswer(ask.answer)[0]?.length || 0;
      const p = r.prefix ?? 0;
      const msg = p === n && n < total ? `这 ${n} 个都对，还差 ${total - n} 个，接着点。` : p ? `前 ${p} 个是对的，第 ${p + 1} 个不对：后面的撤掉了，从第 ${p + 1} 个接着点。` : '第 1 个就不对，重新点。';
      return { ok: false, msg, wrong: r.wrong, prefix: p };
    }
    return { ok: r.ok, msg: r.msg, wrong: r.wrong, prefix: r.prefix ?? 0 };
  }
  const alts = Array.isArray(ask.alts) ? ask.alts : [ask.answer];
  if (ask.kind === 'pick' && (ask.count || 1) > 1) {
    // 点几个：不管顺序（比如「哪两个交换」）
    const g = [...(Array.isArray(given) ? given : [given])].map(norm).sort();
    const ok = alts.some((a) => { const x = [].concat(a).map(norm).sort(); return x.length === g.length && x.every((v, i) => v === g[i]); });
    return { ok, msg: ok ? '' : '不对，再想想。' };
  }
  const ok = alts.some((a) => norm(a) === norm(given));
  return { ok, msg: ok ? '' : ask.kind === 'pick' ? '不是这个，再想想。' : '不对，再想想。' };
}

/** 答案写成一句话（看答案、记录用） */
export function askAnswerText(ask) {
  if (ask.display !== undefined) return String(ask.display);
  if (ask.kind === 'text' || ask.kind === 'order') return String(ask.answer).split('|')[0].trim();
  const a = Array.isArray(ask.alts) ? ask.alts[0] : ask.answer;
  return Array.isArray(a) ? a.join('、') : String(a);
}

/** 第几步的计数文字：0 是「开始」 */
export const stepLabel = (k, n) => (k <= 0 ? '开始' : `第 ${k} / ${n} 步`);

// 学生写的数：整数、小数、分数（全角也认）
export function readNumber(text) {
  const s = String(text ?? '').trim().replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/／/g, '/').replace(/．/g, '.').replace(/−/g, '-');
  let m = /^(-?\d+(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(-?\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  return null;
}

// —— 自己填表（mode: fill）——
// 引擎的 table(输入, run, fields) 给出考试里那张表：
//   { q?, dir: 'row' | 'col', head: [列名…], rows: [{ label, cells: [格…] }], copy?: true, note? }
//   dir: 'col' 是「每一步一列」（页面置换、拥塞窗口这种考卷上横着写的表），显示时转过来，判分顺序不变（按步）。
//   格：{ v: 答案（字符串；几种都对写数组；'' 是这一格该空着）, given?: true（直接给出、不用填）,
//         mark?: true（点一下打 √ 的格子：v 是 '√' 或 ''）, num?: true（按数比：分数、两位小数都认），
//         group?: 'f'（同一行里 group 一样的几格不管先后，比的是写了哪些：物理块里放了哪几页），
//         vec?: true（一个向量：几个数用空格或逗号隔开，括号可有可无） }
//   copy: true 每一行后面有「照上一行抄」（页面置换这种大部分照抄、只改一格的表）
//   extra: [{ label, v, num? }] 表下面再写几个数（散列表填完再写两个 ASL），表都对了才判它们

const FILL_BLANK = /^(|-|—|–|－|#|＃|无|空)$/; // # 和 hash 的 quiz 一样表示空位置
const INF_RE = /^(∞|inf|infinity|oo|无穷|无穷大)$/i;
const MARK_RE = /^(√|✓|✔|v|y|yes|是|1|t|true)$/i;

/** 学生写的一格 → 规整的写法（比较用） */
export function normCell(text) {
  let s = String(text ?? '').trim().replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  s = s.replace(/\s+/g, '').replace(/，/g, ',').replace(/（/g, '(').replace(/）/g, ')').replace(/：/g, ':').replace(/−/g, '-');
  if (FILL_BLANK.test(s)) return '';
  if (INF_RE.test(s)) return '∞';
  return s.toUpperCase();
}

/** 一格对不对：given 的不判；mark 格按打没打勾比；num 格按数比；其余规整后逐字比（几种都对的任一个） */
const vecOf = (t) => String(t ?? '').replace(/[()（）[\]【】]/g, ' ').split(/[\s,，、]+/).filter(Boolean).map((x) => x.toUpperCase());

export function cellOk(cell, text) {
  if (cell.given) return true;
  const alts = (Array.isArray(cell.v) ? cell.v : [cell.v]).map((x) => String(x ?? ''));
  if (cell.vec) {
    // 一个向量（Need、Work）：几个数用空格、逗号隔开，带不带括号都行
    const g = vecOf(text);
    return alts.some((a) => { const w = vecOf(a); return w.length === g.length && w.every((x, i) => x === g[i]); });
  }
  if (cell.mark) {
    const on = MARK_RE.test(String(text ?? '').trim());
    return alts.some((a) => (normCell(a) !== '') === on);
  }
  const g = normCell(text);
  return alts.some((a) => {
    const w = normCell(a);
    if (w === g) return true;
    if (cell.num && w !== '' && g !== '' && w !== '∞' && g !== '∞') {
      const x = readNumber(g), y = readNumber(w);
      if (x === null || y === null) return false;
      // 除不尽的（ASL 这种）写到两位小数以上、四舍五入对得上就算对；只写一位不算
      const decimals = (g.split('.')[1] || '').length;
      const tol = decimals >= 2 && !g.includes('/') ? 0.5 * 10 ** -decimals + 1e-9 : 1e-9;
      return Math.abs(x - y) <= tol;
    }
    return false;
  });
}

/** 表里要填的格，按判分顺序（一行一行；每一行从左往右）：[{ r, c }] */
export function fillOrder(table) {
  const out = [];
  table.rows.forEach((row, r) => row.cells.forEach((cell, c) => { if (!cell.given) out.push({ r, c }); }));
  return out;
}

/**
 * 判一张表。values[r][c] 是学生写的（mark 格是 '√' 或 ''）。
 * 返回 { ok, first（第一个不对或还空着的 { r, c, empty }，全对是 null）, okCount（第一处之前对了几格）, total }。
 * 只指出第一处：后面的格子可能是被前面的错带错的，一次只改一处
 */
export function checkFill(table, values) {
  const order = fillOrder(table);
  let okCount = 0;
  const groupDone = new Set();
  for (const { r, c } of order) {
    const cell = table.rows[r].cells[c];
    const text = values?.[r]?.[c] ?? '';
    if (cell.group !== undefined) {
      // 一组格子（不管先后）：第一次碰到时整组一起比
      const key = `${r}:${cell.group}`;
      if (groupDone.has(key)) continue;
      groupDone.add(key);
      const idx = table.rows[r].cells.map((x, i) => (x.group === cell.group && !x.given ? i : -1)).filter((i) => i >= 0);
      const want = table.rows[r].cells.filter((x) => x.group === cell.group).map((x) => normCell([].concat(x.v)[0])).filter(Boolean).sort();
      const givenVals = table.rows[r].cells.filter((x) => x.group === cell.group && x.given).map((x) => normCell([].concat(x.v)[0])).filter(Boolean);
      const got = [...givenVals, ...idx.map((i) => normCell(values?.[r]?.[i] ?? ''))].filter(Boolean).sort();
      if (got.length === want.length && got.every((x, i) => x === want[i])) { okCount += idx.length; continue; }
      // 指到组里第一个空着的格子，或者第一个写了不该写的
      const wantLeft = [...want];
      for (const g of givenVals) wantLeft.splice(wantLeft.indexOf(g), 1);
      let at = idx.find((i) => { const v = normCell(values?.[r]?.[i] ?? ''); if (!v) return false; const j = wantLeft.indexOf(v); if (j < 0) return true; wantLeft.splice(j, 1); return false; });
      const empty = at === undefined;
      if (empty) at = idx.find((i) => !normCell(values?.[r]?.[i] ?? '')) ?? idx[0];
      return { ok: false, first: { r, c: at, empty }, okCount, total: order.length, group: idx };
    }
    const empty = !cell.mark && normCell(text) === '' && (Array.isArray(cell.v) ? cell.v : [cell.v]).every((a) => normCell(a) !== '');
    if (empty) return { ok: false, first: { r, c, empty: true }, okCount, total: order.length };
    if (!cellOk(cell, text)) return { ok: false, first: { r, c, empty: false }, okCount, total: order.length };
    okCount++;
  }
  const extras = table.extra || [];
  const total = order.length + extras.length;
  for (let i = 0; i < extras.length; i++) {
    const text = values?.extra?.[i] ?? '';
    if (normCell(text) === '') return { ok: false, first: { extra: i, empty: true }, okCount, total };
    if (!cellOk(extras[i], text)) return { ok: false, first: { extra: i, empty: false }, okCount, total };
    okCount++;
  }
  return { ok: true, first: null, okCount, total };
}

/** 这一格叫什么（「第 3 行『块 2』」「访问 1 那一列的『块 2』」） */
export function cellName(table, r, c) {
  if (r && typeof r === 'object') return `「${table.extra?.[r.extra]?.label ?? '下面那一格'}」`;
  const row = table.rows[r], col = table.head[c] ?? `第 ${c + 1} 格`;
  const rl = row.label !== undefined && row.label !== '' ? String(row.label) : `第 ${r + 1} ${table.dir === 'col' ? '列' : '行'}`;
  return table.dir === 'col' ? `「${rl}」那一列的「${col}」` : `「${rl}」那一行的「${col}」`;
}

/** 一格的标准答案（看答案、记录用） */
export const cellAnswer = (cell) => { const a = Array.isArray(cell.v) ? cell.v[0] : cell.v; return cell.mark ? (normCell(a) ? '√' : '（空）') : String(a ?? '') || '（空）'; };

/**
 * 错法诊断：学生错的那几格，和「按某种常见错法算出来的表」比，对得上的多就说「像是按 X 做的」。
 * variants：[{ label, table }]（同样形状的表）。返回 label 或 ''
 */
export function misreadFill(table, values, variants = []) {
  // 判分的单位：一格，或者一组（不管先后的几格）
  const units = [];
  table.rows.forEach((row, r) => {
    const seen = new Set();
    row.cells.forEach((cell, c) => {
      if (cell.given) return;
      if (cell.group === undefined) { units.push({ r, cs: [c] }); return; }
      if (seen.has(cell.group)) return;
      seen.add(cell.group);
      units.push({ r, cs: row.cells.map((x, i) => (x.group === cell.group && !x.given ? i : -1)).filter((i) => i >= 0), group: cell.group });
    });
  });
  // 表下面单独的几格（ASL、D、总移动距离……）也算：很多错法只错在这里
  (table.extra || []).forEach((_, x) => units.push({ x }));
  const bag = (xs) => xs.map(normCell).filter(Boolean).sort().join('|');
  const unitOk = (t, u) => {
    if (u.x !== undefined) { const cell = t.extra?.[u.x]; return !!cell && cellOk(cell, values?.extra?.[u.x] ?? ''); }
    const row = t.rows[u.r];
    if (!row) return false;
    if (u.group === undefined) { const cell = row.cells[u.cs[0]]; return !!cell && cellOk(cell, values?.[u.r]?.[u.cs[0]] ?? ''); }
    return bag(u.cs.map((c) => [].concat(row.cells[c]?.v ?? '')[0])) === bag(u.cs.map((c) => values?.[u.r]?.[c] ?? ''));
  };
  const filled = (u) => (u.x !== undefined ? normCell(values?.extra?.[u.x] ?? '') !== '' : u.cs.some((c) => normCell(values?.[u.r]?.[c] ?? '') !== '' || table.rows[u.r].cells[c].mark));
  const wrong = units.filter((u) => filled(u) && !unitOk(table, u));
  if (!wrong.length) return '';
  let best = { label: '', hit: 0 };
  for (const v of variants) {
    if (!v?.table?.rows || v.table.rows.length !== table.rows.length || (v.table.extra || []).length !== (table.extra || []).length) continue;
    const hit = wrong.filter((u) => unitOk(v.table, u)).length;
    if (hit > best.hit) best = { label: v.label, hit };
  }
  // 至少一半错的地方对得上，才算看出来了
  return best.hit && best.hit * 2 >= wrong.length ? best.label : '';
}

/** 一个答案（quiz 写的结果、ask 写的、点的）和常见错法的答案比：一样就说出来。answers：[{ label, answer }] */
export function misreadAnswer(given, variants = [], same = (a, b) => normCell(a) === normCell(b)) {
  const g = Array.isArray(given) ? given.join(' ') : String(given ?? '');
  if (!g.trim()) return '';
  for (const v of variants) {
    const alts = String(v.answer ?? '').split('|').map((x) => x.trim()).filter(Boolean);
    if (alts.some((a) => same(a.replace(/[\s,，、→]+/g, ' '), g.replace(/[\s,，、→]+/g, ' ')))) return v.label;
  }
  return '';
}

/**
 * 作者对填表的要求：given: 2（前 2 行 / 列直接给出）、rows: 3（只要前 3 行 / 列）、cols: 块 1, 缺页（只填这几列，别的直接给出）。
 * 返回 { table（改好 given 的新表）, errors }
 */
export function fillSpec(table, fields = {}) {
  const errors = [];
  const t = { ...table, rows: table.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c })) })) };
  const unit = t.dir === 'col' ? '列' : '行';
  if (fields.given !== undefined && String(fields.given).trim() !== '') {
    const n = Number(fields.given);
    if (!Number.isInteger(n) || n < 0) errors.push(`given: 写前几${unit}直接给出（整数），现在是「${fields.given}」`);
    else if (n >= t.rows.length) errors.push(`given: ${n} 太多了：这张表一共 ${t.rows.length} ${unit}，全给出就没得填了`);
    else for (let r = 0; r < n; r++) t.rows[r].cells.forEach((c) => { c.given = true; });
  }
  if (fields.rows !== undefined && String(fields.rows).trim() !== '') {
    // 只填前几行 / 前几列（比如排序只写前 3 趟）
    const n = Number(fields.rows);
    if (!Number.isInteger(n) || n < 1) errors.push(`rows: 写只填前几${unit}（正整数），现在是「${fields.rows}」`);
    else t.rows = t.rows.slice(0, n);
  }
  if (fields.cols !== undefined && String(fields.cols).trim() !== '') {
    const want = String(fields.cols).split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
    const norm = (x) => String(x).replace(/\s+/g, '').toLowerCase();
    const idx = want.map((w) => t.head.findIndex((h) => norm(h) === norm(w)));
    const bad = want.filter((w, i) => idx[i] < 0);
    if (bad.length) errors.push(`cols: 没有「${bad.join('、')}」（这张表的${t.dir === 'col' ? '行' : '列'}：${t.head.join('、')}）`);
    else t.rows.forEach((row) => row.cells.forEach((c, i) => { if (!idx.includes(i)) c.given = true; }));
  }
  if (!fillOrder(t).length && !(t.extra || []).length) errors.push('这张表没有要填的格子了');
  return { table: t, errors };
}

// —— 字段名的拼写检查 ——
// 组件读过的字段都记下来（读的时候没写也算：引擎会先看「有没有 b:」），源码里写了却从来没被读过的，
// 就是写错了名字、或者这个组件 / 这种用法用不上它（比如没写 mode: fill 却写了 given:）。不报的话作者以为生效了。
const SHELL_FIELDS = ['id', 'title', 'q', 'note', 'link'];
export function trackFields(raw) {
  const seen = new Set(SHELL_FIELDS);
  const fields = new Proxy(raw, {
    get(t, k) { if (typeof k === 'string') seen.add(k); return t[k]; },
    has(t, k) { if (typeof k === 'string') seen.add(k); return k in t; },
  });
  const unknown = () => Object.keys(raw).filter((k) => !seen.has(k)).map((k) => {
    const near = closest(k, [...seen]);
    return `字段「${k}:」页面没有用上：${near ? `是不是 ${near}:？` : '这个组件没有这个字段'}（${k === 'given' || k === 'rows' || k === 'cols' ? '这几个字段只在 mode: fill 时有用；' : ''}写错的字段会被忽略）`;
  });
  return { fields, unknown };
}

// 编辑距离最近的（差一两个字母、大小写不同）
function closest(k, names) {
  const a = k.toLowerCase();
  let best = '', bd = Infinity;
  for (const n of names) {
    const d = editDistance(a, n.toLowerCase());
    if (d < bd) { bd = d; best = n; }
  }
  return bd <= Math.max(1, Math.min(2, Math.floor(a.length / 3))) ? best : '';
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// —— 组件字段里的 \calc{…} ——
// 整节课 let 块里定义的矩阵、数，直接拿来当演示的输入：matrix: \calc{A}、b: \calc{b}、key: \calc{k + 1}。
// 换成精确的文字（[[1, 2], [3, 4]]、1/2）；题面这类会排成公式的字段不换（那里的 \calc 由公式来算）
const TEXT_FIELDS = new Set(['id', 'title', 'q', 'note', 'hint', 'explain']);
export function calcFields(fields, scope = {}) {
  const errors = [];
  const out = { ...fields };
  for (const [k, v] of Object.entries(fields)) {
    if (TEXT_FIELDS.has(k) || typeof v !== 'string' || !v.includes('\\calc')) continue;
    const r = expandCalc(v, (e) => exactText(calcValue(e, scope).value), { wrap: false });
    out[k] = r.tex;
    for (const e of r.errors) errors.push(`${k}: 里的 \\calc{${e.expr.trim().slice(0, 40)}} 算不出来：${e.msg}`);
  }
  return { fields: out, errors };
}
