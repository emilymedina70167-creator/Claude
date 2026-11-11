// 引擎的过程表 → 舞台的表（主线第五轮，设计第 3 节）。纯函数。
// 黑板的演示组件大多自带一张「考试里那张表」（engine.table：一趟一行的排序、一次访问一列的页面置换、每一轮的 dist……）和常见错法
// （engine.variants）。这里只做「搬」：行名列名、哪些格给定、哪些等学生填、答案、先后不论的几格、每种错法的表，一样不自己算。
// 舞台那边（types/table.js）照它造表、逐格比、认错法；算法的知识都在引擎里。
import { ENGINES } from '../engines/registry.js';
import { trackFields, cellAnswer, normCell } from '../stepperspec.js';

/** 舞台上一张表最多几行几列（types/table.js 的上限照它）：希尔 12 个数、页面置换 12 次访问、散列表 13 个槽是常见的题目大小 */
export const SKIP = '—'; // 引擎给定的空格（Dijkstra 里已经确定的顶点后面几轮不写）：舞台上画一道横线，学生不用填、不比
export const ETABLE_MAX = { rows: 10, cols: 13 }; // 13 列：散列表 p = 13 一格一列
const VALUE_MAX = 24;

// 给定的空格（Dijkstra 里已经确定的顶点后面几轮不写）：舞台上画一道横线。等学生填、答案却是空着的格（页面置换里没有换出谁的那一次）
// 另记在 empties 里：学生不填才对，不算「还空着」——画成横线会把答案漏给学生
const textOf = (cell) => { const a = Array.isArray(cell.v) ? cell.v[0] : cell.v; const t = cell.mark ? (normCell(a) ? '√' : '×') : String(a ?? ''); return t === '' && cell.given ? SKIP : t; };
const isGiven = (cell) => !!cell.given;

/**
 * 引擎的一张表摆成舞台表要的样子（引擎的表竖着排——dir: 'col'，一步一列——就转过来）：
 * { name, title, q, rowNames, colNames, grid（给定的格是值，等填的是 ''）, cells（引擎的格，照舞台的行列）, key（每格的答案）,
 *   groups（先后不论的几格 [[r, c]…]）, marks（打勾的格）, lines（引擎的一行一行，认错法照它）, empties（等学生填、答案是空着的格）,
 *   extra（表下面单独的几格 [{ label, v }]） }
 * 不带错法（variantsOf 另算：要多跑几遍引擎，用到才算）。写错的抛错，话给老师看
 */
export function engineTable(name, rawFields = {}) {
  const e = ENGINES[name];
  if (!e) throw new Error(`没有「${name}」这个引擎（有：${Object.keys(ENGINES).filter((k) => ENGINES[k].table).join(' ')}）`);
  if (!e.table) throw new Error(`${name} 没有能填的表`);
  const tracked = trackFields({ ...rawFields });
  const input = e.parse(tracked.fields, '');
  const run = e.run(input);
  const t = e.table(input, run, tracked.fields);
  if (!t?.rows?.length) throw new Error(`${name} 照这样写没有能填的表`);
  // 引擎没用上的字段（少写一个 s 就照默认值悄悄算出另一张表）：当场报。黑板那边的话里写的是「字段:」，这里是「字段=」
  const stray = tracked.unknown();
  if (stray.length) throw new Error(stray[0].replace(/「(\w+):」/g, '「$1=」').replace(/是不是 (\w+):？/, '是不是 $1=？').replace(/（[^（）]*mode: fill[^（）]*）/, '').replace(/（写错的字段[^）]*）?$/, ''));
  const col = t.dir === 'col';
  const R = col ? t.head.length : t.rows.length, C = col ? t.rows.length : t.head.length;
  if (R > ETABLE_MAX.rows || C > ETABLE_MAX.cols) throw new Error(`这张表有 ${R} 行 ${C} 列，舞台上放不下（最多 ${ETABLE_MAX.rows} 行 ${ETABLE_MAX.cols} 列）：把输入写短一点`);
  const label = (row, i) => (row.label !== undefined && String(row.label) !== '' ? String(row.label) : String(i + 1));
  const rowNames = col ? t.head.map(String) : t.rows.map(label);
  const colNames = col ? t.rows.map(label) : t.head.map(String);
  const at = (r, c) => (col ? t.rows[c].cells[r] : t.rows[r].cells[c]);
  const cells = Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => at(r, c)));
  const key = cells.map((row) => row.map(textOf));
  for (const v of key.flat()) if ([...v].length > VALUE_MAX) throw new Error(`这张表里有一格「${v}」太长了（一格最多 ${VALUE_MAX} 个字）：舞台上放不下`);
  const grid = cells.map((row, r) => row.map((cell, c) => (isGiven(cell) ? key[r][c] : '')));
  // 引擎的一行（转过以后是一列）里等填的格；同一组（group）的先后不论
  const lines = [], groups = [], marks = [], empties = [];
  t.rows.forEach((row, i) => {
    const pos = (k) => (col ? [k, i] : [i, k]);
    const open = row.cells.map((cell, k) => (isGiven(cell) ? null : pos(k))).filter(Boolean);
    if (open.length) lines.push(open);
    const by = new Map();
    row.cells.forEach((cell, k) => { if (!isGiven(cell) && cell.group !== undefined) (by.get(cell.group) || by.set(cell.group, []).get(cell.group)).push(pos(k)); if (cell.mark && !cell.given) marks.push(pos(k)); if (!cell.given && !cell.mark && textOf(cell) === '') empties.push(pos(k)); });
    for (const g of by.values()) if (g.length > 1) groups.push(g);
  });
  const extra = (t.extra || []).map((x) => ({ label: String(x.label ?? ''), v: cellAnswer(x) }));
  return { name, title: e.title || name, q: t.q || '', rowNames, colNames, grid, cells, key, groups, marks, lines, empties, extra, input, shape: { R, C, col }, isGiven };
}

/** 引擎认得的常见错法各算一张表：[{ label, key }]（形状和对的一样、和对的不全等的才留）。算不了的那种跳过 */
export function variantsOf(name, table) {
  const e = ENGINES[name];
  const out = [];
  for (const v of e?.variants?.(table.input, {}) || []) {
    try {
      const t = e.table(v.input, e.run(v.input), {});
      const { R, C, col } = table.shape;
      if (!t?.rows || (col ? t.head.length !== R || t.rows.length !== C : t.rows.length !== R || t.head.length !== C)) continue;
      const key = Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => textOf(col ? t.rows[c].cells[r] : t.rows[r].cells[c])));
      if (JSON.stringify(key) !== JSON.stringify(table.key)) out.push({ label: String(v.label || ''), key });
    } catch { /* 这种错法在这组数上算不了 */ }
  }
  return out.filter((v) => v.label);
}
