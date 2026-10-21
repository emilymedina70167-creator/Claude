// 特殊矩阵的压缩存储（组件 compress）：对称、下三角、上三角、三对角矩阵存进一维数组 B；稀疏矩阵存成三元组表。
// 按王道 3.4 的口径：默认 A 的行列号从 1 数（base: 1）、B 从 0 开始存（from: 0）、行优先（order: row）。
// 算下标一律「先数出它前面存了几个元素 m，再加上 B 的起点」：公式只是这个数法的结果，画面上把前面那几个圈出来。
// 纯函数，不碰 DOM（tests/compress-engine.test.js）。
import { esc, chips } from './arrayview.js';
import { gtable } from './linearview.js';

const KIND = { symmetric: '对称矩阵', lower: '下三角矩阵', upper: '上三角矩阵', tridiagonal: '三对角矩阵', sparse: '稀疏矩阵' };
const KIND_ALIAS = { symmetric: 'symmetric', sym: 'symmetric', 对称: 'symmetric', 对称矩阵: 'symmetric', lower: 'lower', 下三角: 'lower', 下三角矩阵: 'lower', upper: 'upper', 上三角: 'upper', 上三角矩阵: 'upper', tridiagonal: 'tridiagonal', tri: 'tridiagonal', band: 'tridiagonal', 三对角: 'tridiagonal', 三对角矩阵: 'tridiagonal', sparse: 'sparse', 稀疏: 'sparse', 稀疏矩阵: 'sparse' };
const SMALL = 8; // n 不超过它就画出每个元素、一行一行放进 B；更大的只画示意图、讲公式

const bit = (fields, k, def) => {
  const s = String(fields[k] ?? '').trim();
  if (!s) return def;
  if (s !== '0' && s !== '1') throw new Error(`${k}: 只能写 0 或 1（下标从几开始），现在是「${fields[k]}」`);
  return Number(s);
};

export function parse(fields) {
  const m = /^\s*(\S+)\s*(\d+)?\s*$/.exec(String(fields.matrix ?? ''));
  const kind = m && KIND_ALIAS[m[1].toLowerCase()];
  if (!kind) throw new Error('compress 要写 matrix:（symmetric 5、lower 5、upper 5、tridiagonal 5，或 sparse 加 data:）');
  const base = bit(fields, 'base', 1), from = bit(fields, 'from', 0);
  const orderSrc = String(fields.order ?? '').trim().toLowerCase();
  const order = !orderSrc || /^(row|行|行优先)$/.test(orderSrc) ? 'row' : /^(col|column|列|列优先)$/.test(orderSrc) ? 'col' : null;
  if (!order) throw new Error(`order: 写 row（行优先，默认）或 col（列优先），现在是「${fields.order}」`);
  let n, data = null, store = null;
  if (kind === 'sparse') {
    data = parseData(fields.data);
    n = data.length;
  } else {
    n = Number(m[2]);
    if (!Number.isInteger(n) || n < 2 || n > 200) throw new Error(`matrix: 写成「${m[1]} 5」，阶数 n 是 2～200 的整数`);
    if (kind === 'symmetric') {
      const s = String(fields.store ?? '').trim().toLowerCase();
      store = !s || /^(lower|下三角|下)$/.test(s) ? 'lower' : /^(upper|上三角|上)$/.test(s) ? 'upper' : null;
      if (!store) throw new Error(`store: 写 lower（存下三角，默认）或 upper（存上三角），现在是「${fields.store}」`);
    }
  }
  let at = null;
  if (fields.at !== undefined && String(fields.at).trim() !== '') {
    const t = String(fields.at).match(/-?\d+/g);
    if (!t || t.length !== 2) throw new Error(`at: 写要找的元素的行号和列号，如 at: 3 4（就是 a[3][4]），现在是「${fields.at}」`);
    at = t.map(Number);
    const rows = kind === 'sparse' ? data.length : n, cols = kind === 'sparse' ? data[0].length : n;
    if (at[0] < base || at[0] >= base + rows || at[1] < base || at[1] >= base + cols) throw new Error(`at: a[${at[0]}][${at[1]}] 不在矩阵里（下标从 ${base} 数，${rows} 行 ${cols} 列）`);
  }
  return { kind, n, base, from, order, store, at, data };
}

function parseData(src) {
  const s = String(src ?? '').trim();
  if (!s) throw new Error('sparse 要写 data:（矩阵，如 data: 0 0 3; 0 5 0; 7 0 0，或 [[0,0,3],[0,5,0],[7,0,0]]）');
  const rows = s.replace(/^\[\s*\[/, '').replace(/\]\s*\]$/, '').split(/\]\s*,?\s*\[|[;；\n]/).map((r) => r.replace(/[[\]]/g, '').trim()).filter(Boolean)
    .map((r) => r.split(/[\s,，]+/).filter(Boolean).map((x) => { if (!/^-?\d+$/.test(x)) throw new Error(`data: 看不懂「${x}」（写整数）`); return Number(x); }));
  if (rows.length < 2 || rows.some((r) => r.length !== rows[0].length)) throw new Error('data: 每一行的个数要一样，至少两行');
  if (rows.length > SMALL || rows[0].length > SMALL) throw new Error(`data: 最多 ${SMALL} 行 ${SMALL} 列`);
  if (!rows.flat().some((x) => x !== 0)) throw new Error('data: 全是 0，没有要存的');
  return rows;
}

// —— 存哪些、按什么顺序（I、J 是从 1 数的行列号）——
const inRegion = (kind, I, J) => (kind === 'lower' ? I >= J : kind === 'upper' ? I <= J : Math.abs(I - J) <= 1);
const regionOf = (input) => (input.kind === 'symmetric' ? input.store : input.kind);
// 前面存了几个元素（I、J 在要存的那一片里）
function before(region, n, order, I, J) {
  if (region === 'tridiagonal') return order === 'row' ? 2 * I + J - 3 : 2 * J + I - 3;
  if (region === 'lower') return order === 'row' ? ((I - 1) * I) / 2 + (J - 1) : ((J - 1) * (2 * n - J + 2)) / 2 + (I - J);
  return order === 'row' ? ((I - 1) * (2 * n - I + 2)) / 2 + (J - I) : ((J - 1) * J) / 2 + (I - 1);
}
const total = (region, n) => (region === 'tridiagonal' ? 3 * n - 2 : (n * (n + 1)) / 2);
// 一行（或一列）里存的：行优先是第 L 行的那几列
function lineCells(region, n, order, L) {
  const out = [];
  for (let x = 1; x <= n; x++) { const [I, J] = order === 'row' ? [L, x] : [x, L]; if (inRegion(region, I, J)) out.push([I, J]); }
  return out;
}

/**
 * a[i][j]（作者写的下标）存在 B 的哪个位置。mistake（只在算常见错法时用）：
 *   flipOrder 行优先当成列优先（或反过来）；fromOff B 的起点差 1；baseOff A 的下标起点差 1；noSwap 对称矩阵另一半的元素没换成对称的那个
 * 返回 { k, I, J, use: [I, J]（真正去找的元素）, swapped, constant, zero, m（前面有几个） }
 */
export function locate(input, i, j, mistake = input.mistake) {
  const { kind, n } = input;
  const base = mistake === 'baseOff' ? 1 - input.base : input.base;
  const from = mistake === 'fromOff' ? 1 - input.from : input.from;
  const order = mistake === 'flipOrder' ? (input.order === 'row' ? 'col' : 'row') : input.order;
  const I = i - base + 1, J = j - base + 1;
  const region = regionOf(input);
  if (kind === 'symmetric') {
    if (inRegion(region, I, J) || mistake === 'noSwap') return { k: from + before(region, n, order, I, J), I, J, use: [I, J], m: before(region, n, order, I, J) };
    return { k: from + before(region, n, order, J, I), I, J, use: [J, I], swapped: true, m: before(region, n, order, J, I) };
  }
  if (inRegion(region, I, J)) return { k: from + before(region, n, order, I, J), I, J, use: [I, J], m: before(region, n, order, I, J) };
  if (kind === 'tridiagonal') return { k: null, I, J, zero: true };
  return { k: from + total(region, n), I, J, constant: true, m: total(region, n) };
}

// 稀疏矩阵的三元组（行、列用作者的下标）。flipOrder：按列扫；baseOff：下标起点差 1
function triples(input, mistake = input.mistake) {
  const { data } = input;
  const base = mistake === 'baseOff' ? 1 - input.base : input.base;
  const order = mistake === 'flipOrder' ? (input.order === 'row' ? 'col' : 'row') : input.order;
  const out = [];
  const R = data.length, C = data[0].length;
  if (order === 'row') { for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (data[r][c]) out.push({ r, c, i: r + base, j: c + base, v: data[r][c] }); }
  else for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) if (data[r][c]) out.push({ r, c, i: r + base, j: c + base, v: data[r][c] });
  return out;
}

const ij = (input, I, J) => [I + input.base - 1, J + input.base - 1];
const aName = (input, I, J) => { const [i, j] = ij(input, I, J); return `a[${i}][${j}]`; };
const lineName = (input, L) => (input.order === 'row' ? `第 ${L + input.base - 1} 行` : `第 ${L + input.base - 1} 列`);

export function run(input) {
  if (input.kind === 'sparse') return runSparse(input);
  const { kind, n, from, order, at } = input;
  const region = regionOf(input);
  const cnt = total(region, n) + (kind === 'lower' || kind === 'upper' ? 1 : 0);
  const small = n <= SMALL;
  const steps = [];
  const what = {
    symmetric: `对称矩阵 a[i][j] = a[j][i]，只存${region === 'lower' ? '下' : '上'}三角（含主对角线）：n(n+1)/2 = ${total(region, n)} 个`,
    lower: `下三角矩阵：存下三角（含主对角线）的 n(n+1)/2 = ${total(region, n)} 个，上三角区都是同一个常数 c，在最后再存一个：一共 ${cnt} 个`,
    upper: `上三角矩阵：存上三角（含主对角线）的 n(n+1)/2 = ${total(region, n)} 个，下三角区都是同一个常数 c，在最后再存一个：一共 ${cnt} 个`,
    tridiagonal: `三对角矩阵：只有主对角线和上下两条对角线上有非零元，|i − j| ≤ 1，一共 3n − 2 = ${total(region, n)} 个`,
  }[kind];
  steps.push({ view: { filled: 0 }, msg: `${n} 阶${what}，按${order === 'row' ? '行' : '列'}优先依次存进 B[${from}]～B[${from + cnt - 1}]。A 的行列号从 ${input.base} 数。` });
  const countAsk = { tag: 'count', kind: 'number', q: `B 一共要存多少个元素？`, answer: cnt };
  const L = at ? locate(input, at[0], at[1]) : null;
  if (at) {
    const right = locate(input, at[0], at[1], null);
    steps.push({ view: { filled: 0, target: right, show: 'locate' }, msg: locateMsg(input, right), ...(L.k === null ? { ask: countAsk } : { ask: { tag: 'index', kind: 'number', q: `a[${at[0]}][${at[1]}] 存在 B 的哪个位置？写下标 k（B[k]）。`, answer: L.k }, asks: [countAsk, ...(small ? [{ tag: 'cell', kind: 'pick', q: `a[${at[0]}][${at[1]}] 存在 B 的哪一格？在 B 里点出来。`, answer: String(L.k) }] : [])] }) });
  }
  if (small) {
    let filled = 0;
    for (let line = 1; line <= n; line++) {
      const cells = lineCells(region, n, order, line);
      const startK = from + filled;
      const firstName = aName(input, ...cells[0]);
      const ask = line === 1 && !at ? countAsk : line > 1 ? { tag: 'line', kind: 'number', q: `${lineName(input, line)}存的第一个元素 ${firstName} 放在 B 的哪个下标？`, answer: (input.mistake ? locate(input, ...ij(input, ...cells[0])).k : startK) } : null;
      filled += cells.length;
      steps.push({ view: { filled, line, target: at ? locate(input, at[0], at[1], null) : null }, msg: `${lineName(input, line)}存 ${cells.length} 个：${cells.map(([I, J]) => aName(input, I, J)).join('、')}，放在 B[${startK}]${cells.length > 1 ? `～B[${startK + cells.length - 1}]` : ''}。`, ...(ask ? { ask } : {}) });
    }
    if (kind === 'lower' || kind === 'upper') steps.push({ view: { filled: cnt, constant: true, target: at ? locate(input, at[0], at[1], null) : null }, msg: `${kind === 'lower' ? '上' : '下'}三角区的常数 c 只存一次，放在最后：B[${from + cnt - 1}]。` });
    if (at) {
      const right = locate(input, at[0], at[1], null);
      steps.push({ view: { filled: cnt, target: right, show: 'check' }, msg: right.k === null ? `对照：a[${at[0]}][${at[1]}] 在三条对角线外面，是 0，B 里没有它。` : `对照：a[${at[0]}][${at[1]}]${right.swapped ? `（就是 ${aName(input, ...right.use)}）` : right.constant ? '（常数 c）' : ''} 确实在 B[${right.k}]。` });
    }
  }
  return { steps, cnt, L, region };
}

// 1 + 2 + 3、12 + 11 + … + 8：短的全写出来，长的写头两个和最后一个
const series = (list) => (list.length <= 4 ? list.join(' + ') : `${list[0]} + ${list[1]} + … + ${list.at(-1)}`);

function locateMsg(input, L) {
  const { kind, n, from, order, at } = input;
  const [i, j] = at;
  const region = regionOf(input);
  const conv = input.base === 0 ? `（下标从 0 数：它是第 ${L.I} 行第 ${L.J} 列）` : '';
  if (L.zero) return `a[${i}][${j}]${conv} 不在三条对角线上（|i − j| > 1），是 0，不存。`;
  if (L.constant) return `a[${i}][${j}]${conv} 在${kind === 'lower' ? '上' : '下'}三角区，是常数 c：存在 B 的最后一个，前面有 n(n+1)/2 = ${L.m} 个，所以是 B[${from} + ${L.m}] = **B[${L.k}]**。`;
  const [I, J] = L.use;
  const sw = L.swapped ? `a[${i}][${j}] 在${region === 'lower' ? '上' : '下'}三角，存的是和它相等的 ${aName(input, I, J)}。` : '';
  let count;
  if (region === 'tridiagonal') count = '';
  else {
    // 前面整行（整列）各存了几个：行优先的下三角是 1、2、3……，上三角是 n、n−1……
    const lines = order === 'row' ? I - 1 : J - 1;
    const desc = (region === 'lower') !== (order === 'row');
    const list = Array.from({ length: lines }, (_, k) => (desc ? n - k : k + 1));
    const sum = list.reduce((x, y) => x + y, 0);
    const inLine = L.m - sum;
    const unit = order === 'row' ? '行' : '列';
    const formula = region === 'lower' ? (order === 'row' ? 'i(i−1)/2 + j − 1' : '(j−1)(2n−j+2)/2 + i − j') : order === 'row' ? '(i−1)(2n−i+2)/2 + j − i' : 'j(j−1)/2 + i − 1';
    count = `${lines ? `前 ${lines} ${unit}存了 ${series(list)}${list.length > 1 ? ` = ${sum}` : ''} 个` : `前面没有整${unit}的`}，第 ${order === 'row' ? I : J} ${unit}里它前面还有 ${inLine} 个：m = ${formula} = ${L.m}`;
  }
  if (region === 'tridiagonal') {
    const lines = order === 'row' ? I - 1 : J - 1;
    const beforeLines = Math.max(0, 3 * lines - 1);
    const inLine = L.m - beforeLines;
    count = `前 ${lines} ${order === 'row' ? '行' : '列'}一共 ${lines ? `3×${lines} − 1 = ` : ''}${beforeLines} 个（第 1 ${order === 'row' ? '行' : '列'}只有 2 个），本${order === 'row' ? '行' : '列'}里它前面还有 ${inLine} 个：m = ${order === 'row' ? '2i + j − 3' : '2j + i − 3'} = ${L.m}`;
  }
  return `${sw}${conv}先数它前面存了几个：${count}（这里的 i、j 从 1 数）。B 从 ${from} 开始存，所以 k = ${from} + ${L.m} = **${L.k}**。`;
}

function runSparse(input) {
  const { data, from, at } = input;
  const right = triples(input, null);
  const mine = triples(input);
  const steps = [];
  steps.push({ view: { got: 0 }, msg: `${data.length} × ${data[0].length} 的稀疏矩阵，只存非零元：每个非零元存成一个三元组（行号, 列号, 值），按${input.order === 'row' ? '行' : '列'}优先排成三元组表（下标从 ${from} 数）。行列号从 ${input.base} 数。压缩以后就不能随机存取了：要找某个元素得在表里查。` });
  right.forEach((t, k) => {
    const m = mine[k];
    const ask = { tag: 'triple', kind: 'text', q: `第 ${k + 1} 个三元组是什么？（写 行 列 值，空格隔开）`, answer: m ? `${m.i} ${m.j} ${m.v}` : '' };
    steps.push({ view: { got: k + 1 }, msg: `${input.order === 'row' ? '一行一行' : '一列一列'}扫，下一个非零元是 a[${t.i}][${t.j}] = ${t.v}：三元组 (${t.i}, ${t.j}, ${t.v})，放在三元组表下标 ${from + k} 的位置。`, ...(m ? { ask, ...(k === 0 ? { asks: [{ tag: 'count', kind: 'number', q: '三元组表一共有几个三元组？', answer: right.length }] } : {}) } : {}) });
  });
  if (at) {
    const k = right.findIndex((t) => t.i === at[0] && t.j === at[1]);
    const km = mine.findIndex((t) => t.i === at[0] && t.j === at[1]);
    steps.push({ view: { got: right.length, find: k }, msg: k < 0 ? `a[${at[0]}][${at[1]}] 是 0，表里没有它（在表里查一遍找不到，就是 0）。` : `要找 a[${at[0]}][${at[1]}]：在三元组表里从头查行号、列号，第 ${from + k} 个就是它，值是 ${right[k].v}。`, ...(k >= 0 && km >= 0 ? { ask: { tag: 'index', kind: 'number', q: `a[${at[0]}][${at[1]}] 是三元组表的第几个（下标从 ${from} 数）？`, answer: from + km } } : {}) });
  }
  return { steps, list: mine, right };
}

// —— 画面 ——
const sub = (input, I, J) => { const [i, j] = ij(input, I, J); const big = i >= 10 || j >= 10; return `a<sub>${i}${big ? ',' : ''}${j}</sub>`; };

export function view(s, input) {
  if (input.kind === 'sparse') return sparseView(s, input);
  const { kind, n, order, from } = input;
  const region = regionOf(input);
  const cnt = total(region, n) + (kind === 'lower' || kind === 'upper' ? 1 : 0);
  const T = s.target;
  if (n > SMALL) return bigView(s, input, T, cnt);
  // 每个元素在 B 里的位置（正确的那一种存法）
  const pos = {};
  let k = 0;
  for (let line = 1; line <= n; line++) for (const [I, J] of lineCells(region, n, order, line)) pos[`${I},${J}`] = from + k++;
  const constK = kind === 'lower' || kind === 'upper' ? from + total(region, n) : null;
  const useKey = T && !T.zero ? (T.constant ? 'c' : `${T.use[0]},${T.use[1]}`) : null;
  // 数到它之前的那些（locate 那一步画出来）
  const beforeSet = new Set();
  if (T && !T.zero && s.show) for (const [key, kk] of Object.entries(pos)) if (kk < T.k) beforeSet.add(key);
  const curLine = s.line ? new Set(lineCells(region, n, order, s.line).map(([I, J]) => `${I},${J}`)) : new Set();
  let mx = `<div class="ln-mx" style="--n:${n}"><div class="ln-mx-c ln-mx-h"></div>`;
  for (let J = 1; J <= n; J++) mx += `<div class="ln-mx-c ln-mx-h">${J + input.base - 1}</div>`;
  for (let I = 1; I <= n; I++) {
    mx += `<div class="ln-mx-c ln-mx-h">${I + input.base - 1}</div>`;
    for (let J = 1; J <= n; J++) {
      const key = `${I},${J}`;
      const stored = pos[key] !== undefined;
      const cls = ['ln-mx-c'];
      let label = sub(input, I, J);
      if (stored) cls.push('ln-st'); else if (kind === 'symmetric') cls.push('ln-mirror'); else if (kind === 'tridiagonal') { cls.push('ln-zero'); label = '0'; } else { cls.push('ln-const'); label = 'c'; }
      if (stored && pos[key] < from + s.filled) cls.push('ln-filled');
      if (curLine.has(key)) cls.push('ln-line');
      if (beforeSet.has(key)) cls.push('ln-before');
      if (T && T.I === I && T.J === J) cls.push('ln-target');
      if (T && useKey === key && T.swapped) cls.push('ln-use');
      mx += `<div class="${cls.join(' ')}" data-label="${esc(label.replace(/<\/?sub>/g, ''))}">${label}</div>`;
    }
  }
  mx += '</div>';
  // B：一排格子，可以折行；下面写下标
  const inv = Object.fromEntries(Object.entries(pos).map(([key, kk]) => [kk, key]));
  let b = `<div class="ln-b">`;
  for (let kk = from; kk < from + cnt; kk++) {
    const key = kk === constK ? 'c' : inv[kk];
    const filled = kk < from + s.filled;
    const [I, J] = key === 'c' ? [0, 0] : key.split(',').map(Number);
    const cls = ['ln-b-c', filled ? 'ln-filled' : '', key && curLine.has(key) ? 'ln-line sv-new' : '', s.constant && key === 'c' ? 'sv-new' : '', T && !T.zero && kk === T.k ? 'ln-target' : '', T && s.show && !T.zero && kk < T.k ? 'ln-before' : ''].filter(Boolean).join(' ');
    b += `<div class="ln-b-w"><div class="${cls}" data-pick="${kk}" data-cmd="${kk - from + 1}" data-key="b:${kk}">${filled ? (key === 'c' ? 'c' : sub(input, I, J)) : ''}</div><div class="ln-b-i">${kk}</div></div>`;
  }
  b += '</div>';
  const ch = chips([['B 的长度', cnt], ...(T && !T.zero && s.show ? [['k', `${from} + ${T.m} = ${T.k}`]] : [])]);
  return `<div class="ln-cp"><div class="ln-h">A（${KIND[kind]}，${n} 阶）</div>${mx}<div class="ln-h">B（${order === 'row' ? '行' : '列'}优先）</div>${b}${ch}</div>`;
}

// n 大的时候：示意图（存的那一片、它前面的那些、目标元素）+ B 的一条
function bigView(s, input, T, cnt) {
  const { kind, n, order, from } = input;
  const region = regionOf(input);
  const S = 220, o = 30;
  const P = (I, J) => [o + ((J - 0.5) / n) * S, o + ((I - 0.5) / n) * S];
  let shape;
  if (region === 'lower') shape = `M${o} ${o} L${o + S} ${o + S} L${o} ${o + S} Z`;
  else if (region === 'upper') shape = `M${o} ${o} L${o + S} ${o} L${o + S} ${o + S} Z`;
  else shape = `M${o} ${o} L${o + (2 * S) / n} ${o} L${o + S} ${o + S - (2 * S) / n} L${o + S} ${o + S} L${o + S - (2 * S) / n} ${o + S} L${o} ${o + (2 * S) / n} Z`;
  let h = `<rect class="ln-sk-box" x="${o}" y="${o}" width="${S}" height="${S}"/><path class="ln-sk-st" d="${shape}"/>`;
  if (T && !T.zero && !T.constant && s.show) {
    const [I, J] = T.use;
    // 前面那些：行优先是前 I−1 行（那一片）+ 本行在它左边的
    const y = o + ((I - 1) / n) * S, x = o + ((J - 1) / n) * S;
    if (order === 'row') h += `<rect class="ln-sk-before" x="${o}" y="${o}" width="${S}" height="${y - o}" clip-path="url(#ln-clip)"/><rect class="ln-sk-before" x="${o}" y="${y}" width="${x - o}" height="${S / n}" clip-path="url(#ln-clip)"/>`;
    else h += `<rect class="ln-sk-before" x="${o}" y="${o}" width="${x - o}" height="${S}" clip-path="url(#ln-clip)"/><rect class="ln-sk-before" x="${x}" y="${o}" width="${S / n}" height="${y - o}" clip-path="url(#ln-clip)"/>`;
    const [px, py] = P(I, J);
    h += `<circle class="ln-sk-dot" cx="${px}" cy="${py}" r="5"/><text class="ln-sk-t" x="${px + 9}" y="${py - 9}">${esc(aName(input, I, J))}</text>`;
  }
  h += `<text class="ln-sk-ax" x="${o}" y="${o - 10}">1</text><text class="ln-sk-ax" x="${o + S}" y="${o - 10}" text-anchor="end">${n}</text><text class="ln-sk-ax" x="${o - 8}" y="${o + S}" text-anchor="end">${n}</text>`;
  const svg = `<svg class="ln-sketch" viewBox="0 0 ${S + 2 * o + 70} ${S + 2 * o}" width="${S + 2 * o + 70}" style="max-width:100%" role="img" aria-label="${KIND[kind]}示意"><defs><clipPath id="ln-clip"><path d="${shape}"/></clipPath></defs>${h}</svg>`;
  const kText = T && !T.zero && s.show ? [['k', `${from} + ${T.m} = ${T.k}`]] : [];
  return `<div class="ln-cp"><div class="ln-h">A（${KIND[kind]}，${n} 阶，涂色的是要存的）</div>${svg}${chips([['B', `B[${from}]～B[${from + cnt - 1}]，一共 ${cnt} 个`], ...kText])}</div>`;
}

function sparseView(s, input) {
  const { data, from } = input;
  const list = triples(input, null);
  const got = new Set(list.slice(0, s.got).map((t) => `${t.r},${t.c}`));
  const cur = s.got ? list[s.got - 1] : null;
  const found = s.find >= 0 && s.find !== undefined ? list[s.find] : null;
  let mx = `<div class="ln-mx" style="--n:${data[0].length}"><div class="ln-mx-c ln-mx-h"></div>`;
  for (let c = 0; c < data[0].length; c++) mx += `<div class="ln-mx-c ln-mx-h">${c + input.base}</div>`;
  data.forEach((row, r) => {
    mx += `<div class="ln-mx-c ln-mx-h">${r + input.base}</div>`;
    row.forEach((x, c) => {
      const cls = ['ln-mx-c', x ? 'ln-st' : 'ln-zero', got.has(`${r},${c}`) ? 'ln-filled' : '', cur && cur.r === r && cur.c === c && s.find === undefined ? 'ln-line' : '', found && found.r === r && found.c === c ? 'ln-target' : ''].filter(Boolean).join(' ');
      mx += `<div class="${cls}">${x}</div>`;
    });
  });
  mx += '</div>';
  const rows = list.slice(0, s.got).map((t, k) => [{ html: String(from + k), cls: 'ln-tt-k' }, ...[t.i, t.j, t.v].map((x) => ({ html: String(x), cls: (k === s.got - 1 && s.find === undefined) || k === s.find ? 'sv-chg' : '' }))]);
  const tbl = rows.length ? gtable(['', '行', '列', '值'], rows, 'ln-tt') : '<div class="muted ln-tt-empty">（三元组表还是空的）</div>';
  return `<div class="ln-cp ln-sp"><div><div class="ln-h">A</div>${mx}</div><div><div class="ln-h">三元组表</div>${tbl}</div></div>`;
}

// —— mode: quiz ——
export function quiz(input, r) {
  if (input.kind === 'sparse') return { q: `把上面的稀疏矩阵按${input.order === 'row' ? '行' : '列'}优先写成三元组表（行列号从 ${input.base} 数）：每个三元组写「行 列 值」，依次连起来写成一串。`, qhtml: sparseView({ got: 0 }, input), type: 'seq', answer: r.list.map((t) => `${t.i} ${t.j} ${t.v}`).join(' ') };
  const head = `${input.n} 阶${KIND[input.kind]}${input.kind === 'symmetric' ? `（存${input.store === 'lower' ? '下' : '上'}三角）` : ''}按${input.order === 'row' ? '行' : '列'}优先压缩存进一维数组 B[${input.from}…]，A 的行列号从 ${input.base} 数。`;
  if (!input.at || r.L.k === null) return { q: `${head}B 一共要存多少个元素？`, type: 'seq', answer: String(r.cnt) };
  return { q: `${head}a[${input.at[0]}][${input.at[1]}] 存在 B 的哪个位置？写下标 k。`, type: 'seq', answer: String(r.L.k) };
}

// —— mode: fill：每一行（列）存在 B 的哪一段；最后写 B 的长度、a[i][j] 的下标 ——
export function table(input, r) {
  if (input.kind === 'sparse') {
    return {
      q: `按${input.order === 'row' ? '行' : '列'}优先写出三元组表（行列号从 ${input.base} 数）。`,
      qhtml: sparseView({ got: 0 }, input),
      dir: 'row', head: ['行', '列', '值'],
      rows: r.right.map((_, k) => { const t = r.list[k]; return { label: `第 ${input.from + k} 个`, cells: [{ v: String(t?.i ?? ''), num: true }, { v: String(t?.j ?? ''), num: true }, { v: String(t?.v ?? ''), num: true }] }; }),
      ...(input.at && r.steps.at(-1).ask ? { extra: [{ label: `a[${input.at[0]}][${input.at[1]}] 是第几个`, v: String(r.steps.at(-1).ask.answer), num: true }] } : {}),
    };
  }
  const { n, order } = input;
  const region = regionOf(input);
  const want = n <= SMALL ? Array.from({ length: n }, (_, k) => k + 1) : [...new Set([1, 2, input.at && r.L.use ? (order === 'row' ? r.L.use[0] : r.L.use[1]) : 3])].sort((a, b) => a - b);
  const rows = want.map((line) => {
    const cells = lineCells(region, n, order, line);
    const first = locate(input, ...ij(input, ...cells[0])).k, last = locate(input, ...ij(input, ...cells.at(-1))).k;
    return { label: lineName(input, line), cells: [{ v: String(first), num: true }, { v: String(last), num: true }] };
  });
  const extra = [{ label: 'B 一共几个元素', v: String(r.cnt), num: true }];
  if (input.at && r.L.k !== null) extra.push({ label: `a[${input.at[0]}][${input.at[1]}] 的下标`, v: String(r.L.k), num: true });
  return {
    q: `${n} 阶${KIND[input.kind]}${input.kind === 'symmetric' ? `（存${input.store === 'lower' ? '下' : '上'}三角）` : ''}按${order === 'row' ? '行' : '列'}优先存进 B（从 B[${input.from}] 开始），A 的行列号从 ${input.base} 数。写出每${order === 'row' ? '一行' : '一列'}存的元素在 B 里从哪个下标到哪个下标。`,
    dir: 'row', head: ['从 B[ ]', '到 B[ ]'],
    rows, extra,
  };
}

export function problems(input, r) {
  const out = [];
  if (input.kind === 'tridiagonal' && r.L?.zero) out.push(`at: a[${input.at[0]}][${input.at[1]}] 在三条对角线外面，是 0，不存；要问下标就换一个对角线上的`);
  if (input.kind === 'sparse' && input.at && !r.steps.at(-1).ask) out.push(`at: a[${input.at[0]}][${input.at[1]}] 是 0，三元组表里没有它`);
  return out;
}

const VARIANTS = [
  ['flipOrder', (input) => (input.order === 'row' ? '像是按列优先算的（王道：题目说行优先，就先数前面整行一共存了多少个）' : '像是按行优先算的（王道：题目说列优先，就先数前面整列一共存了多少个）')],
  ['noSwap', () => '像是上三角的元素直接代了存下三角的公式（王道：对称矩阵只存一半，另一半的 a[i][j] 要换成 a[j][i] 再算）'],
  ['fromOff', (input) => (input.from === 0 ? '像是把 B 的下标当成从 1 开始了，差了 1（王道：先数它前面有 m 个，B 从 0 开始存就是 B[m]）' : '像是把 B 的下标当成从 0 开始了，差了 1（王道：先数它前面有 m 个，B 从 1 开始存就是 B[m + 1]）')],
  ['baseOff', (input) => `像是把 A 的行列号起点弄错了，差了 1（王道：先看清下标从 ${input.base} 数，代公式的 i、j 要换成第几行第几列）`],
];
const answersOf = (input, r) => {
  let q = null, t = null;
  try { q = quiz(input, r).answer; } catch { /* 没有 */ }
  try { t = table(input, r).rows.map((x) => x.cells.map((c) => c.v)).concat([(table(input, r).extra || []).map((x) => x.v)]); } catch { /* 没有 */ }
  return JSON.stringify([r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean).map((a) => [a.q, a.answer]), q, t]);
};
export function variants(input) {
  const base = answersOf(input, run(input));
  return VARIANTS.filter(([m]) => m !== 'noSwap' || input.kind === 'symmetric').map(([mistake, label]) => ({ label: label(input), input: { ...input, mistake } })).filter((v) => { try { return answersOf(v.input, run(v.input)) !== base; } catch { return false; } });
}

export const compressEngine = { name: 'compress', title: '特殊矩阵的压缩存储', parse, run, view, quiz, table, problems, variants };
