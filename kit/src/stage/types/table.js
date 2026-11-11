// 舞台上的表（主线第三轮 A）：有行名列名，格里能放数、∞、字、短语，能空着等填。数据和指令，不碰 DOM（画法在 table.view.js）。
// 纯函数，有测试（tests/stage-table.test.js）。
//
// 以前老师是拿矩阵（格只收数，∞、字写不进，行名只能贴字）、几排格子摞起来（横屏会散）、题卡（学生写不进）凑的：
// 最短路的 dist 表、时态图鉴、复杂度对照表都是它。学生点一格写（open T edit：数字键盘 / 输入框 / 一排选项，规则在 table.rules.js）；
// 老师给了答案（key=）的，页面逐格比，比出来的不当场给学生标，只告诉老师。
import { parseRef } from '../script.js';

export const MAX_TROWS = 8, MAX_TCOLS = 10;
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
export function sameValue(a, b) {
  const norm = (v) => String(v ?? '').normalize('NFKC').replace(/[−–]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const x = norm(a), y = norm(b);
  if (x === y) return true;
  const num = (t) => { const m = t.match(/^(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/); return m && !(m[2] != null && Number(m[2]) === 0) ? Number(m[1]) / (m[2] != null ? Number(m[2]) : 1) : null; };
  const p = num(x), q = num(y);
  return p != null && q != null && Math.abs(p - q) < 1e-9;
}

// 等号后面的那一串 → 一行行的格（词、引号里的短语；「/」分行）
function gridOf(args) {
  const rows = [[]];
  for (const a of args) {
    if (a.t === 'word' && a.v === '/') { rows.push([]); continue; }
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
  for (const v of rows.flat()) if ([...v].length > VALUE_MAX) throw new Error(`key= 里「${v}」太长了（一格最多 ${VALUE_MAX} 个字）`);
  return rows;
}

const mkCell = (obj, r, c, value) => ({ obj, key: `${r}.${c}`, r, c, value, given: value !== '', by: null, tick: null, paint: null, glow: false, lift: false, dim: false, covered: false });
const sortRC = (a, b) => a.r - b.r || a.c - b.c;
export const cellAt = (o, r, c) => o.cells.find((x) => x.r === r && x.c === c) || null;
/** 一格叫什么（写给老师）：行名×列名；没写名字的写 T.2,3 */
export function cellName(o, x) {
  const rn = o.rowNames[x.r - 1], cn = o.colNames[x.c - 1];
  if (rn != null && cn != null) return `${rn}×${cn}`;
  return `${o.id}.${x.r},${x.c}`;
}
/** 这一格比不比（有答案、答案这一格不是空的、不是造的时候就给定的） */
export const keyed = (o, x) => !!o.key && o.key[x.r - 1]?.[x.c - 1] !== '' && o.key[x.r - 1]?.[x.c - 1] != null && !x.fixed;
export const answerOf = (o, x) => o.key?.[x.r - 1]?.[x.c - 1] ?? '';
/** 和答案不一样的格（填了的才算；空着的不算不一样） */
export const wrongCells = (o) => (o.key ? o.cells.filter((x) => keyed(o, x) && x.value !== '' && !sameValue(x.value, answerOf(o, x))).sort(sortRC) : []);

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
// 老师写的值：引号里的短语，或者最后一个不是部件的词
const valueIn = (scene, h) => (h.str != null ? h.str : h.words.filter((w) => !scene.isRef(w)).at(-1));

export const table = {
  type: 'table',
  label: '表',
  create: ['table'],
  options: { table: ['rows', 'cols', 'key'] },
  hint: '（表：名字.2,3 是第 2 行第 3 列的格，名字.r2 是第 2 行，名字.c3 是第 3 列；现状里一格写成 行名×列名）',
  make(scene, c, h, old) {
    const id = h.words[0];
    const eq = h.args.findIndex((a) => a.t === 'eq');
    const eg = `table ${id || 'T'} = 10 ∞ _ / _ 7 _ rows="顶点2 顶点3" cols="第1轮 第2轮 第3轮"（只写 rows= cols= 是一张全空的表）`;
    const rowNames = h.opts.rows != null ? namesOf(h.opts.rows) : [];
    const colNames = h.opts.cols != null ? namesOf(h.opts.cols) : [];
    let grid;
    if (eq >= 0) {
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
  // 挑战拿来整个比的（T = U）：照矩阵的样子交
  measure(o) { const rows = []; for (let r = 1; r <= o.rows; r++) rows.push(o.cells.filter((x) => x.r === r).sort(sortRC).map((x) => x.value)); return { kind: 'matrix', rows }; },
  commands: {
    // write T.2,3 7 / write T.2,3 "不稳定" / write T.2,3 _：写一格（_ 是空出来等学生填）。老师写进去的格学生写不了
    write(scene, c, h) {
      const t = targetOf(scene, h, 'write', 'write T.2,3 7（写一格；短语写在引号里，_ 是空出来）');
      if (t.cells.length !== 1) throw new Error(`write 一次写一格：write ${t.o.id}.2,3 7`);
      const v = valueIn(scene, h);
      if (v == null) throw new Error(`要写成 write ${t.ref} 7（短语写在引号里，_ 是空出来）`);
      const val = cellValue(v);
      if ([...val].length > VALUE_MAX) throw new Error(`「${val}」太长了：一格最多 ${VALUE_MAX} 个字`);
      const x = t.cells[0];
      const before = x.value;
      x.value = val;
      // 谁写的：学生写的格学生能再改；老师写的（连造的时候就有的）是给定的
      const student = scene.actor === 'student';
      x.by = val === '' ? null : student ? 'student' : null;
      x.given = val !== '' && !student;
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
    const blank = o.cells.filter((x) => x.value === '').sort(sortRC);
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
    if (o.key) {
      const n = o.cells.filter((x) => keyed(o, x)).length;
      lines.push(`  答案：收下了（比 ${n} 格；学生看不到，比出来的不当场标）`);
      const bad = wrongCells(o);
      if (bad.length) lines.push(`  和答案不一样：${bad.map((x) => `${cellName(o, x)}（写了 ${x.value}，答案是 ${answerOf(o, x)}）`).join('、')}`);
    }
    return lines;
  },
  summary(o) { const rows = []; for (let r = 1; r <= o.rows; r++) rows.push(o.cells.filter((x) => x.r === r).sort(sortRC).map((x) => (x.value === '' ? '□' : x.value)).join(' ')); return rows.join(' / '); },
  doc: `表（行名列名，格里放数、∞、字、短语，能空着等填）：
table T = 10 ∞ _ / _ 7 _ rows="顶点2 顶点3" cols="第1轮 第2轮 第3轮"  「 / 」分行，_ 空着，短语写引号里；最多 8 行 10 列
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
  if (t.row) o.marks.rows[t.row] = kind; else if (t.col) o.marks.cols[t.col] = kind; else for (const x of t.cells) x.tick = kind;
  return { id: o.id, parts: t.cells };
}
