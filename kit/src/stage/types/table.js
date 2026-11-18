// 舞台上的表（主线第三轮 A）：有行名列名，格里能放数、∞、字、短语，能空着等填。数据和指令，不碰 DOM（画法在 table.view.js）。
// 纯函数，有测试（tests/stage-table.test.js）。
//
// 以前老师是拿矩阵（格只收数，∞、字写不进，行名只能贴字）、几排格子摞起来（横屏会散）、题卡（学生写不进）凑的：
// 最短路的 dist 表、时态图鉴、复杂度对照表都是它。学生点一格写（open T edit：数字键盘 / 输入框 / 一排选项，规则在 table.rules.js）；
// 老师给了答案（key=）的，页面逐格比，比出来的不当场给学生标，只告诉老师。
import { parseRef } from '../script.js';

import { engineTable, variantsOf as engineVariants, ETABLE_MAX, SKIP } from '../enginetable.js';
import { cellOk, normCell } from '../../stepperspec.js';
export const MAX_TROWS = ETABLE_MAX.rows, MAX_TCOLS = ETABLE_MAX.cols; // 10 行 13 列（主线第五轮：引擎的过程表常见的大小）
export const TB = { CH: 46, GAP: 6, HEAD: 32, MINW: 58, MAXW: 230, PADX: 26 };
const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
const VALUE_MAX = 24; // 一格最多几个字（再长排不下；长的话写在题卡、贴的字里）

/** 一段字画出来大约多宽（18px 的字：中文一个字一份，英文、数字半份多一点）；画面量过会写回 */
export function textW(s) {
  let w = 0;
  for (const ch of String(s ?? '')) w += /[\u0000-ÿ]/.test(ch) ? 10.5 : 18;
  return w;
}
// 名字 / 选项的写法：有 | 的照 | 切（名字里能有空格），没有的照空格切
export const namesOf = (v) => (String(v).includes('|') ? String(v).split('|').map((x) => x.trim()).filter(Boolean) : String(v).trim().split(/\s+/).filter(Boolean));
// 一格里写的字规整一下：_ 是空着；别的照原样（去掉两头的空格）
const cellValue = (v) => { const t = String(v ?? '').trim(); return t === '_' ? '' : t; };
/** 两格里的字是不是一样（和答案比）：数按数比；字不管两头和中间多余的空格、大小写、全角半角、两种减号 */
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n', '⁻': '-', '⁺': '+' };
export function sameValue(a, b) {
  // 上标先写成 ^…（不然 NFKC 把 n² 压成 n2、2ⁿ 压成 2n，和不带上标的判成一样）；弯撇号、几种横线两边一起规整
  const norm = (v) => String(v ?? '').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁻⁺]+/g, (m) => `^${[...m].map((ch) => SUP[ch]).join('')}`)
    .normalize('NFKC').replace(/[−–—]/g, '-').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const x = norm(a), y = norm(b);
  if (x === y) return true;
  // 按数比只认规范的数：有前导 0 的（0011、02：二进制、编号）照字比
  const num = (t) => { const m = t.match(/^(-?(?:0|[1-9]\d*)(?:\.\d+)?)(?:\/([1-9]\d*))?$/); return m ? Number(m[1]) / (m[2] != null ? Number(m[2]) : 1) : null; };
  const p = num(x), q = num(y);
  return p != null && q != null && Math.abs(p - q) < 1e-9;
}

// 等号后面的那一串 → 一行行的格（词、引号里的短语；「/」分行）
function gridOf(args) {
  const rows = [[]];
  for (const a of args) {
    if (a.t === 'word' && a.v === '/') { rows.push([]); continue; }
    if ((a.t === 'word' || a.t === 'str') && /[{}]/.test(a.v)) throw new Error(`表的格不跟着算，不能写 {式子}（「${a.v}」）：要跟着算的数放进矩阵，或者你算好了 write 进去`);
    if (a.t === 'word' || a.t === 'str') rows.at(-1).push(cellValue(a.v));
    else throw new Error('表的格里写数、∞、一个词、引号里的短语，或者 _（空着等填）；「 / 」分行');
  }
  while (rows.length > 1 && !rows.at(-1).length) rows.pop();
  return rows;
}
/** key= 的写法 → 一行行的答案（'' 是不比的格）：「 / 」分行，格之间空格隔开；一行里有 | 的照 | 隔（答案是短语时） */
export function parseTableKey(src, o) {
  const rows = String(src ?? '').split(/\s+\/\s+|^\/\s+|\s+\/$/).map((r) => (r.includes('|') ? r.split('|').map((x) => cellValue(x)) : r.trim().split(/\s+/).filter(Boolean).map(cellValue)));
  if (rows.length !== o.rows) throw new Error(`key= 有 ${rows.length} 行，表有 ${o.rows} 行（key 和表一样的形状，「 / 」分行，不比的格写 _）`);
  rows.forEach((r, i) => { if (r.length !== o.cols) throw new Error(`key= 第 ${i + 1} 行有 ${r.length} 格，表有 ${o.cols} 列（不比的格写 _；答案是短语时这一行用 | 隔开）`); });
  for (const v of rows.flat()) if (/[{}]/.test(v)) throw new Error(`key= 里不能写 {式子}（「${v}」）：表的格不跟着算，答案直接写出来`);
  for (const v of rows.flat()) if ([...v].length > VALUE_MAX) throw new Error(`key= 里「${v}」太长了（一格最多 ${VALUE_MAX} 个字）`);
  return rows;
}

const mkCell = (obj, r, c, value) => ({ obj, key: `${r}.${c}`, r, c, value, given: value !== '', by: null, tick: null, paint: null, glow: false, lift: false, dim: false, covered: false });
const sortRC = (a, b) => a.r - b.r || a.c - b.c;
export const cellAt = (o, r, c) => o.cells.find((x) => x.r === r && x.c === c) || null;
/** 一格叫什么（写给老师）：行名×列名；没写名字的写 T.2,3 */
export function cellName(o, x) {
  let rn = o.rowNames[x.r - 1], cn = o.colNames[x.c - 1];
  // 名字有重的（页面置换的列名是访问串 7 0 1 2 0 …）：带上第几列 / 行，不然分不清是哪一个
  if (rn != null && o.rowNames.filter((n) => n === rn).length > 1) rn = `第 ${x.r} 行（${rn}）`;
  if (cn != null && o.colNames.filter((n) => n === cn).length > 1) cn = `第 ${x.c} 列（${cn}）`;
  if (rn != null && cn != null) return `${rn}×${cn}`;
  return `${o.id}.${x.r},${x.c}`;
}
/** 这一格比不比（有答案、答案这一格不是空的、不是造的时候就给定的） */
// 引擎的表里答案是「空着」的格、一组里的格也比（填了不该填的算不一样）
export const keyed = (o, x) => !!o.key && ((o.key[x.r - 1]?.[x.c - 1] !== '' && o.key[x.r - 1]?.[x.c - 1] != null) || !!o.engine?.empties?.includes(x.key)) && !x.fixed;
export const answerOf = (o, x) => (o.engine?.empties?.includes(x.key) ? '空着' : o.key?.[x.r - 1]?.[x.c - 1] ?? '');
/**
 * 交给学生写的格（open T edit / open T.c1 edit：开着的那几格里不是给定的）；没交给学生是 null。
 * 写满没写满只看这几格：只开一列时，写满这一列学生手上就没事了（scene.js 的 blankLeft、规则的 next 都照它）
 */
export function openCells(scene, o) {
  const es = [...(scene?.opens?.values?.() || [])].filter((e) => e.obj === o.id && e.action === 'edit');
  if (!es.length) return null;
  if (es.some((e) => !e.refs?.length)) return o.cells.filter((x) => !x.given);
  const keys = new Set();
  for (const e of es) for (const r of e.refs) { try { for (const p of scene.parts(r)) keys.add(p.key); } catch { /* 那几格不在了 */ } }
  return o.cells.filter((x) => keys.has(x.key) && !x.given);
}
// 引擎的表里先后不论的一组（页面置换同一次访问的几个物理块）：这一格在哪一组；一组要填几格（答案里不空的）、已经填了几格
const groupOf = (o, x) => o.engine?.groups.find((ks) => ks.includes(x.key)) || null;
function groupState(o, g, x = null, value = null) {
  const cs = g.map((k) => o.cells.find((c) => c.key === k));
  const vals = cs.map((c) => (c === x ? value : c.value));
  const want = cs.map((c) => o.key?.[c.r - 1]?.[c.c - 1] ?? '');
  return { cs, vals, want, need: want.filter((v) => v !== '').length, have: vals.filter((v) => v !== '').length };
}
/** 这一格答案是空着的（引擎的表：没有换出谁的那一次）：学生不填才对，不算「还空着」。一组里的照整组看，不在这里 */
export const emptyKey = (o, x) => !!o.engine?.empties?.includes(x.key) && !groupOf(o, x);
/** 这一格还等着学生填：空着，而且答案不是「空着」；一组先后不论的，这一组还没填够才算 */
export function isBlank(o, x) {
  if (x.value !== '') return false;
  const g = groupOf(o, x);
  if (g) { const st = groupState(o, g); return st.have < st.need; }
  return !emptyKey(o, x);
}
/**
 * 这一格（写成 value 的话）和答案一不一样：true / false；null 是还定不了（它那一组先后不论的几格还没填够）。
 * 引擎造的表（o.engine）照引擎那边判一格的办法（几种写法都对、数按数比、向量、打勾）；一组先后不论的照整组比
 */
export function cellRight(o, x, value = x.value) {
  const e = o.engine;
  if (!e) return sameValue(value, answerOf(o, x));
  const g = groupOf(o, x);
  if (g) {
    const st = groupState(o, g, x, value);
    if (st.have < st.need) return null;
    // 一格一格判：照格的先后把写的值和答案里还没被对上的一个个对，对不上的（多出来的）那一格才算不一样——
    // 该是 {7,0,1} 写成 2 7 0，只有那个 2 不一样，不是三格都错
    const left = st.want.filter((v) => v !== '').map(normCell);
    let mine = true;
    for (let i = 0; i < st.cs.length; i++) {
      const v = st.vals[i];
      if (v === '') continue;
      const at = left.indexOf(normCell(v));
      if (at >= 0) left.splice(at, 1);
      if (st.cs[i] === x) { mine = at >= 0; break; }
    }
    return mine;
  }
  if (emptyKey(o, x)) return value === '';
  const cell = e.cells[x.key];
  // 答案和写的都是一串数字（散列表的关键字 01）：按数比，写 1 也对
  const INT = /^-?\d+$/;
  if (INT.test(answerOf(o, x)) && INT.test(String(value).trim())) return Number(answerOf(o, x)) === Number(value);
  return cell ? cellOk({ ...cell, given: false }, value) : sameValue(value, answerOf(o, x));
}
/** 这一格不对时写给老师（自己练里写给学生）的那半句：答案是什么。一组先后不论的不按位置说，说这一组该有哪几个 */
export function wantText(o, x) {
  const g = groupOf(o, x);
  if (g) return `这一组该是 ${groupState(o, g).want.filter((v) => v !== '').join(' ')}，先后不论`;
  return answerOf(o, x) === '空着' ? '这一格该空着' : `答案是 ${answerOf(o, x)}`;
}
/** 这一格所在的先后不论的一组（格的 key）；不在组里是 null */
export const groupKeys = (o, x) => groupOf(o, x);
/** 和答案不一样的格（填了的才算；空着的、一组还没填完的不算不一样） */
export const wrongCells = (o) => (o.key ? o.cells.filter((x) => keyed(o, x) && x.value !== '' && cellRight(o, x) === false).sort(sortRC) : []);

// —— 引擎造的表（table T engine=sort algo=shell array="…"）——
const VCACHE = new Map();
/** 引擎认得的常见错法各算出来的表：[{ label, key }]（用到才算、记着） */
export function variantsOf(o) {
  if (!o.engine) return [];
  const k = `${o.engine.name}\n${JSON.stringify(o.engine.fields)}`;
  if (!VCACHE.has(k)) {
    let vs = [];
    try { vs = engineVariants(o.engine.name, engineTable(o.engine.name, o.engine.fields)); } catch { /* 算不了：没有错法可比 */ }
    if (VCACHE.size > 40) VCACHE.clear();
    VCACHE.set(k, vs);
  }
  return VCACHE.get(k);
}
/**
 * 学生填完的哪几行、哪几列像哪种错法：[{ name（这一行 / 列叫什么）, label, keys }]。引擎的一行（竖着排的表是一列）和舞台上
 * 另一个方向的一整行都比（KMP 的表一步一列，学生是一整行 next 照错法填的）。
 * 填完了、有格和答案不一样、每一格都和这种错法算出来的一样才算；一组先后不论的照集合比。
 * 几种错法都对得上就都列出来（只说第一种是替老师挑了一个）
 */
export function misreadLines(o) {
  if (!o.engine) return [];
  const out = [];
  const at = (k) => o.cells.find((c) => c.key === k);
  const bag = (xs) => xs.filter((v) => v !== '' && v != null).map(normCell).sort().join('|');
  const fits = (cs, vr) => {
    const seen = new Set();
    return cs.every((x) => {
      const g = groupOf(o, x);
      if (!g) return normCell(x.value) === normCell(vr.key[x.r - 1]?.[x.c - 1] ?? '');
      if (seen.has(g)) return true;
      seen.add(g);
      const gs = g.map(at);
      return bag(gs.map((c) => c.value)) === bag(gs.map((c) => vr.key[c.r - 1]?.[c.c - 1] ?? ''));
    });
  };
  // 另一个方向的整行 / 整列：学生要填的格不少于 2 个才比（一格对上一种错法说明不了什么）
  const engineRows = o.engine.lines.every((ks) => { const cs = ks.map(at).filter(Boolean); return cs.every((x) => x.r === cs[0]?.r); });
  const cross = [];
  const n = engineRows ? o.cols : o.rows;
  for (let i = 1; i <= n; i++) { const ks = o.cells.filter((x) => (engineRows ? x.c : x.r) === i && !x.fixed).map((x) => x.key); if (ks.length >= 2) cross.push(ks); }
  const have = new Set();
  for (const ks of [...o.engine.lines, ...cross]) {
    const cs = ks.map(at);
    if (cs.some((x) => !x || isBlank(o, x)) || !cs.some((x) => cellRight(o, x) === false)) continue;
    const vs = variantsOf(o).filter((vr) => fits(cs, vr));
    if (!vs.length) continue;
    const row = cs.every((x) => x.r === cs[0].r);
    const uniq = (names, nm) => nm != null && names.filter((t) => t === nm).length === 1;
    const rn = o.rowNames[cs[0].r - 1], cn = o.colNames[cs[0].c - 1];
    const name = row ? (uniq(o.rowNames, rn) ? `${rn}这一行` : `第 ${cs[0].r} 行${rn != null ? `（${rn}）` : ''}`) : (uniq(o.colNames, cn) ? `${cn}这一列` : `第 ${cs[0].c} 列${cn != null ? `（${cn}）` : ''}`);
    if (have.has(name)) continue;
    have.add(name);
    out.push({ name, label: [...new Set(vs.map((v) => v.label.replace(/^像是/, '')))].join('，或者'), keys: ks });
  }
  return out;
}

// —— 排版 ——
/** 每一列多宽：这一列最长的字（格里的、答案的、列名）；画面量过的（o.mw）优先 */
export function colWidths(o) {
  const out = [];
  for (let c = 1; c <= o.cols; c++) {
    const texts = [o.colNames[c - 1] ?? '', ...o.cells.filter((x) => x.c === c).map((x) => x.value), ...(o.key ? o.key.map((r) => r[c - 1]) : [])];
    out.push(Math.min(TB.MAXW, Math.max(TB.MINW, ...texts.map((t) => textW(t) + TB.PADX))));
  }
  return out;
}
export const nameWidth = (o) => (o.rowNames.length ? Math.min(TB.MAXW, Math.max(...o.rowNames.map((t) => textW(t) + 18))) : 0);
export const headHeight = (o) => (o.colNames.length ? TB.HEAD : 0);
export function cellBox(o, x) {
  const ws = colWidths(o);
  let px = o.origin.x + nameWidth(o);
  for (let c = 1; c < x.c; c++) px += ws[c - 1] + TB.GAP;
  return { x: px, y: o.origin.y + headHeight(o) + (x.r - 1) * (TB.CH + TB.GAP), w: ws[x.c - 1], h: TB.CH };
}
function sizeOf(o) {
  const ws = colWidths(o);
  return { w: nameWidth(o) + ws.reduce((a, b) => a + b, 0) + TB.GAP * (o.cols - 1), h: headHeight(o) + o.rows * (TB.CH + TB.GAP) - TB.GAP };
}
function objectBox(o) { return { x: o.origin.x, y: o.origin.y, ...sizeOf(o) }; }

// 一行指令的第一个部件写法是哪一种：一格 / 一行 / 一列 / 整张
function targetOf(scene, h, cmd, eg) {
  const ref = h.refsIn()[0];
  const r = ref ? parseRef(ref) : null;
  const o = r ? scene.objects.get(r.obj) : null;
  if (!o || o.type !== 'table') throw new Error(`要写成 ${eg}`);
  const m = r.mark ? String(r.sel).match(/^([rc])(\d+)$/) : null;
  return { o, ref, whole: !r.mark, row: m?.[1] === 'r' ? Number(m[2]) : null, col: m?.[1] === 'c' ? Number(m[2]) : null, cells: r.mark ? scene.parts(ref) : [], cmd };
}
// 一行 write 里写的值：那一格后面的那一个词或那一对引号（照位置取：值可以和舞台上的东西同名，write T.2,2 T）。
// 后面多了词、有箭头（A→B 被切成三截）：抛错——短语要写在引号里，不然只收到最后一截
export function valueAfter(h, ref) {
  const i = h.args.findIndex((a) => a.t === 'word' && a.v === ref);
  const rest = h.args.slice(i + 1);
  if (!rest.length) return null;
  if (rest.length !== 1 || (rest[0].t !== 'word' && rest[0].t !== 'str')) throw new Error(`短语写在引号里：write ${ref} "${rest.filter((a) => a.v != null).map((a) => a.v).join(' ')}"（一格后面只写一个词，或者一对引号）`);
  return String(rest[0].v);
}

export const table = {
  type: 'table',
  label: '表',
  create: ['table'],
  options: { table: ['rows', 'cols', 'key', 'engine'] },
  variantsOf,
  hint: '（表：名字.2,3 是第 2 行第 3 列的格，名字.r2 是第 2 行，名字.c3 是第 3 列；现状里一格写成 行名×列名）',
  make(scene, c, h, old) {
    const id = h.words[0];
    const eq = h.args.findIndex((a) => a.t === 'eq');
    const eg = `table ${id || 'T'} = 10 ∞ _ / _ 7 _ rows="顶点2 顶点3" cols="第1轮 第2轮 第3轮"（只写 rows= cols= 是一张全空的表）`;
    const rowNames = h.opts.rows != null ? namesOf(h.opts.rows) : [];
    const colNames = h.opts.cols != null ? namesOf(h.opts.cols) : [];
    let grid;
    let E = null;
    if (h.opts.engine != null) {
      // table T engine=sort algo=shell array="…"：引擎的过程表（enginetable.js）。别的 名字=值 原样交给引擎（和黑板组件的字段一样）
      if (eq >= 0) throw new Error('engine= 的表不写格子：格子、行名列名、答案都从引擎来（table T engine=sort algo=shell array="49 38 65" gaps="2 1"）');
      for (const k of ['rows', 'cols', 'key']) if (h.opts[k] != null) throw new Error(`engine= 的表行名、列名、答案都从引擎来，不写 ${k}=`);
      const fields = {};
      for (const [k, v] of Object.entries(h.opts)) if (!['engine', 'hide'].includes(k)) fields[k] = String(v);
      E = engineTable(String(h.opts.engine).trim(), fields);
      grid = E.grid.map((r) => [...r]);
      rowNames.push(...E.rowNames);
      colNames.push(...E.colNames);
    } else if (eq >= 0) {
      grid = gridOf(h.args.slice(eq + 1));
      if (!grid[0].length) throw new Error(`表要有格：写成 ${eg}`);
      grid.forEach((r, i) => { if (r.length !== grid[0].length) throw new Error(`第 ${i + 1} 行有 ${r.length} 格，第 1 行有 ${grid[0].length} 格（每行要一样多；空着的格写 _，短语写在引号里）`); });
    } else {
      if (!rowNames.length || !colNames.length) throw new Error(`没写格子的表 rows= 和 cols= 都要写（几行几列照名字的个数）：${eg}`);
      grid = rowNames.map(() => colNames.map(() => ''));
    }
    const rows = grid.length, cols = grid[0].length;
    if (rows > MAX_TROWS || cols > MAX_TCOLS) throw new Error(`一张表最多 ${MAX_TROWS} 行 ${MAX_TCOLS} 列（写了 ${rows} 行 ${cols} 列）`);
    if (rowNames.length && rowNames.length !== rows) throw new Error(`rows= 写了 ${rowNames.length} 个名字，表有 ${rows} 行（一行一个名字，空格隔开；名字里有空格的用 | 隔）`);
    if (colNames.length && colNames.length !== cols) throw new Error(`cols= 写了 ${colNames.length} 个名字，表有 ${cols} 列（一列一个名字，空格隔开；名字里有空格的用 | 隔）`);
    for (const v of grid.flat()) if ([...v].length > VALUE_MAX) throw new Error(`「${v}」太长了：一格最多 ${VALUE_MAX} 个字（长的写在题卡里）`);
    const o = { id, rows, cols, rowNames, colNames, marks: { rows: {}, cols: {} }, key: null, origin: { x: 0, y: 0 }, cells: grid.flatMap((r, i) => r.map((v, j) => mkCell(id, i + 1, j + 1, v))) };
    // 造的时候就有值的格：给定的，答案不比它（fixed 一直不变；老师后来写进去的格是 given、照旧比）
    for (const x of o.cells) if (x.given) x.fixed = true;
    if (h.opts.key != null) o.key = parseTableKey(h.opts.key, o);
    if (E) {
      const kk = (r, c) => `${r + 1}.${c + 1}`;
      o.key = E.key.map((r) => [...r]);
      const cells = {};
      E.cells.forEach((row, r) => row.forEach((cell, c) => { if (!E.isGiven(cell)) cells[kk(r, c)] = { v: [].concat(cell.v ?? '').map((a) => (cell.mark ? (normCell(a) ? '√' : '×') : String(a ?? ''))), ...(cell.num ? { num: true } : {}), ...(cell.vec ? { vec: true } : {}) }; }));
      const fields = {};
      for (const [k, v] of Object.entries(h.opts)) if (!['engine', 'hide'].includes(k)) fields[k] = String(v);
      o.engine = { name: E.name, title: E.title, fields, cells, groups: E.groups.map((g) => g.map(([r, c]) => kk(r, c))), marks: E.marks.map(([r, c]) => kk(r, c)), lines: E.lines.map((g) => g.map(([r, c]) => kk(r, c))), empties: E.empties.map(([r, c]) => kk(r, c)), extra: E.extra };
    }
    const { w } = sizeOf(o);
    o.origin = old?.type === 'table' ? { ...old.origin } : scene.slotFor(w);
    delete o.id;
    return o;
  },
  parts(o) { return [...o.cells].sort(sortRC); },
  pick(o, mark, sel, word) {
    const bad = () => new Error(`「${word}」：表写 ${o.id}.2,3（第 2 行第 3 列）、${o.id}.r2（第 2 行）或 ${o.id}.c3（第 3 列）`);
    if (mark !== '.') throw bad();
    const size = `${o.id} 是 ${o.rows} 行 ${o.cols} 列的`;
    let m = String(sel).match(/^(\d+)[,，](\d+)$/);
    if (m) {
      const r = Number(m[1]), c = Number(m[2]);
      if (r < 1 || r > o.rows) throw new Error(`${size}，没有第 ${r} 行`);
      if (c < 1 || c > o.cols) throw new Error(`${size}，没有第 ${c} 列`);
      return [cellAt(o, r, c)];
    }
    m = String(sel).match(/^([rc])(\d+)(?:-(\d+))?$/);
    if (m) {
      const lo = Math.min(Number(m[2]), Number(m[3] ?? m[2])), hi = Math.max(Number(m[2]), Number(m[3] ?? m[2]));
      const n = m[1] === 'r' ? o.rows : o.cols;
      if (lo < 1 || hi > n) throw new Error(`${size}，没有第 ${hi > n ? hi : lo} ${m[1] === 'r' ? '行' : '列'}`);
      return o.cells.filter((x) => { const k = m[1] === 'r' ? x.r : x.c; return k >= lo && k <= hi; }).sort(sortRC);
    }
    throw bad();
  },
  ref(p) { return `${p.obj}.${p.r},${p.c}`; },
  partBox: cellBox,
  objectBox,
  obstacles(o) { return [objectBox(o)]; },
  // 还有没有空着等学生填的格（scene.js 的 blankLeft）：交给学生的那几格里的；没交给学生看整张
  blankLeft(scene, o) { return (openCells(scene, o) || o.cells).some((x) => isBlank(o, x)); },
  // 挑战拿来整个比的（T = U）：照矩阵的样子交
  measure(o) { const rows = []; for (let r = 1; r <= o.rows; r++) rows.push(o.cells.filter((x) => x.r === r).sort(sortRC).map((x) => x.value)); return { kind: 'matrix', rows }; },
  commands: {
    // write T.2,3 7 / write T.2,3 "不稳定" / write T.2,3 _：写一格（_ 是空出来等学生填）。老师写进去的格学生写不了
    write(scene, c, h) {
      const t = targetOf(scene, h, 'write', 'write T.2,3 7（写一格；短语写在引号里，_ 是空出来）');
      if (t.cells.length !== 1) throw new Error(`write 一次写一格：write ${t.o.id}.2,3 7`);
      const v = valueAfter(h, t.ref);
      if (v == null) throw new Error(`要写成 write ${t.ref} 7（短语写在引号里，_ 是空出来）`);
      if (/[{}]/.test(v) && scene.actor !== 'student') throw new Error('表的格不跟着算，不能写 {式子}：你算好了再 write 进去');
      const val = cellValue(v);
      if ([...val].length > VALUE_MAX) throw new Error(`「${val}」太长了：一格最多 ${VALUE_MAX} 个字`);
      const x = t.cells[0];
      const before = x.value;
      x.value = val;
      // 谁写的：学生写的格学生能再改；老师写的（连造的时候就有的）是给定的
      const student = scene.actor === 'student';
      x.by = val === '' ? null : student ? 'student' : null;
      x.given = val !== '' && !student;
      // 造的时候有值、老师又空出来等学生填的：照答案比（不再是「给定的」）
      if (val === '' && !student) delete x.fixed;
      return { id: t.o.id, part: x, before };
    },
    // tick T.c2（一列、一行或一格打勾）、cross T.1,4（打叉：这一格不合法 / 这一列不对）、untick T（都收掉）
    tick(scene, c, h) { return markCmd(scene, h, 'tick'); },
    cross(scene, c, h) { return markCmd(scene, h, 'cross'); },
    untick(scene, c, h) {
      const t = targetOf(scene, h, 'untick', 'untick T（都收掉）或 untick T.c2');
      const { o } = t;
      if (t.whole) { o.marks = { rows: {}, cols: {} }; for (const x of o.cells) x.tick = null; } else if (t.row) delete o.marks.rows[t.row]; else if (t.col) delete o.marks.cols[t.col]; else for (const x of t.cells) x.tick = null;
      return { id: o.id };
    },
    // addrow T "合计" 3 _ 5：下面加一行（引号里是行名；表没有行名时不写）
    addrow(scene, c, h) {
      const o = scene.objects.get(h.words[0]);
      if (!o || o.type !== 'table') throw new Error('要写成 addrow T "行名" 3 _ 5（表的名字，行名，再一格格写）');
      if (o.rows >= MAX_TROWS) throw new Error(`一张表最多 ${MAX_TROWS} 行`);
      const named = o.rowNames.length > 0;
      const rest = h.args.slice(h.args.findIndex((a) => a.t === 'word' && a.v === o.id) + 1);
      if (named && rest[0]?.t !== 'str') throw new Error(`${o.id} 有行名：addrow ${o.id} "这一行的名字" 后面再一格格写`);
      const vals = (named ? rest.slice(1) : rest).filter((a) => a.t === 'word' || a.t === 'str').map((a) => cellValue(a.v));
      if (vals.length !== o.cols) throw new Error(`这一行写了 ${vals.length} 格，表有 ${o.cols} 列（空着的写 _）`);
      o.rows += 1;
      if (named) o.rowNames.push(String(rest[0].v).trim());
      const added = vals.map((v, j) => mkCell(o.id, o.rows, j + 1, v));
      o.cells.push(...added);
      // 答案跟着多一行不比的
      if (o.key) o.key.push(vals.map(() => ''));
      return { id: o.id, parts: added };
    },
  },
  describe(o) {
    const sh = (v) => (v === '' ? '□' : v);
    const lines = [`表 ${o.id}（${o.rows} 行 ${o.cols} 列）：`];
    if (o.colNames.length) lines.push(`  列：${o.colNames.join('｜')}`);
    for (let r = 1; r <= o.rows; r++) lines.push(`  ${o.rowNames[r - 1] ?? `第 ${r} 行`}：${o.cells.filter((x) => x.r === r).sort(sortRC).map((x) => sh(x.value)).join('｜')}`);
    const blank = o.cells.filter((x) => isBlank(o, x)).sort(sortRC);
    if (blank.length) lines.push(`  还空着：${blank.length > 12 ? `${blank.length} 格` : blank.map((x) => cellName(o, x)).join('、')}`);
    const ticks = [...Object.entries(o.marks.cols).filter(([, v]) => v === 'tick').map(([k]) => `${o.colNames[k - 1] ?? `第 ${k} 列`}（列）`), ...Object.entries(o.marks.rows).filter(([, v]) => v === 'tick').map(([k]) => `${o.rowNames[k - 1] ?? `第 ${k} 行`}（行）`), ...o.cells.filter((x) => x.tick === 'tick').map((x) => cellName(o, x))];
    const crosses = [...Object.entries(o.marks.cols).filter(([, v]) => v === 'cross').map(([k]) => `${o.colNames[k - 1] ?? `第 ${k} 列`}（列）`), ...Object.entries(o.marks.rows).filter(([, v]) => v === 'cross').map(([k]) => `${o.rowNames[k - 1] ?? `第 ${k} 行`}（行）`), ...o.cells.filter((x) => x.tick === 'cross').map((x) => cellName(o, x))];
    if (ticks.length || crosses.length) lines.push(`  ${[ticks.length ? `打勾：${ticks.join('、')}` : '', crosses.length ? `打叉：${crosses.join('、')}` : ''].filter(Boolean).join('；')}`);
    const groups = new Map();
    const put = (k, s) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); };
    for (const x of [...o.cells].sort(sortRC)) {
      if (x.paint) put(COLOR_NAMES[x.paint], cellName(o, x));
      if (x.glow) put('亮', cellName(o, x));
      if (x.dim) put('灰', cellName(o, x));
      if (x.covered) put('扣着', cellName(o, x));
    }
    if (groups.size) lines.push(`  样子：${[...groups].map(([k, v]) => `${k} ${v.join(' ')}`).join('；')}`);
    if (o.engine) lines[0] = `表 ${o.id}（${o.rows} 行 ${o.cols} 列）：照 ${o.engine.name} 的过程表（${Object.entries(o.engine.fields).map(([k, v]) => `${k}=${v}`).join(' ')}）`;
    if (o.engine?.extra.length) lines.push(`  表外的答案（学生看不到）：${o.engine.extra.map((x) => `${x.label} = ${x.v}`).join('；')}`);
    if (o.key) {
      const n = o.cells.filter((x) => keyed(o, x)).length;
      lines.push(`  答案：收下了（比 ${n} 格；学生看不到，比出来的不当场标）`);
      for (const m of misreadLines(o)) lines.push(`  ${m.name}像是：${m.label}`);
      const bad = wrongCells(o);
      if (bad.length) lines.push(`  和答案不一样：${bad.map((x) => `${cellName(o, x)}（写了 ${x.value}，${wantText(o, x)}）`).join('、')}`);
    }
    return lines;
  },
  summary(o) { const rows = []; for (let r = 1; r <= o.rows; r++) rows.push(o.cells.filter((x) => x.r === r).sort(sortRC).map((x) => (x.value === '' ? '□' : x.value)).join(' ')); return rows.join(' / '); },
  doc: `表（行名列名，格里放数、∞、字、短语，能空着等填）：
table T = 10 ∞ _ / _ 7 _ rows="顶点2 顶点3" cols="第1轮 第2轮 第3轮"  「 / 」分行，_ 空着，短语写引号里；最多 10 行 13 列
table E rows="最少 最多" cols="1 2 3" key="1 2 4 / 1 3 7"  只写 rows= cols= 是全空的；key= 是答案（同形，不比的写 _）：页面逐格比，只告诉你、不给学生标
写法：T.2,3 一格；T.r2 一行；T.c3 一列
write T.2,3 7 / write T.2,3 "不稳定" / write T.2,3 _  写一格（你写的学生改不了）/ 空出来
tick T.c2 / cross T.1,4 / untick T  打勾 / 打叉 / 都收掉
addrow T "合计" 3 _ 5  加一行
open T edit  学生点一格键盘写（有 ∞）= write T.2,3 7；input=text 写字，choices="能 不能" 点选项；只开一列 open T.c2 edit
判断式：T full（填满）、T right（填满且都对）；量：blank(T)、wrong(T) 和答案不一样几格；写满演 @T.done`,
  example: `table T = 10 ∞ _ / _ 7 _ rows="顶点2 顶点3" cols="第1轮 第2轮 第3轮" key="10 ∞ 9 / 5 7 7"
say "第 3 轮以后，到每个顶点最短是多少？填进表里。"
open T edit
@T.done say "填完了，我们一格一格对。"`,
};

function markCmd(scene, h, kind) {
  const eg = kind === 'tick' ? 'tick T.c2（一列、一行或一格打勾）' : 'cross T.1,4（一格、一行或一列打叉）';
  const t = targetOf(scene, h, kind, eg);
  const { o } = t;
  if (t.whole) throw new Error(`${kind} 写哪一格、哪一行、哪一列：${eg}`);
  // 行、列的记号画在行名、列名后面：没有名字的没处画，当场报
  if (t.row && !o.rowNames.length) throw new Error(`${o.id} 没有行名，一整行的${kind === 'tick' ? '勾' : '叉'}没处画：打在格上（${kind} ${o.id}.${t.row},1），或者造表时写 rows="…"`);
  if (t.col && !o.colNames.length) throw new Error(`${o.id} 没有列名，一整列的${kind === 'tick' ? '勾' : '叉'}没处画：打在格上（${kind} ${o.id}.1,${t.col}），或者造表时写 cols="…"`);
  if (t.row) o.marks.rows[t.row] = kind; else if (t.col) o.marks.cols[t.col] = kind; else for (const x of t.cells) x.tick = kind;
  return { id: o.id, parts: t.cells };
}
