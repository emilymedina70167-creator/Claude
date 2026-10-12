// matrix 组件的写法和计算（纯函数，有测试 tests/matrix.test.js）。画面和动画在 blocks/matrix.js。
//
//   id: m-pow
//   title: B 的幂
//   let B = [[0, 1, 0], [0, 0, 1], [0, 0, 0]]
//   slider k 1 3 = 1 step=1 label="k" play
//   matrix B^k label="B^{\calc{k}} ="
//   mark row 1 note="只剩右上角" from=2
//
// 命令一行一条，按顺序排成一行公式：let / slider / matrix / tex / split / mark / product。
// 值都按精确分数算（exact.js）；算不准的（sin、rot……）退回小数。
import { splitMods } from './mods.js';
import { parse } from './expr.js';
import { calcValue, expandCalc, toExact, toFloat, isQ, isQVec, isQMat, Q } from './exact.js';
import { parseMarkSpec } from './markspec.js';
import { tokenize } from './tokens.js';

const CMDS = ['let', 'slider', 'matrix', 'tex', 'split', 'mark', 'product'];
const CMD_RE = new RegExp(`^(${CMDS.join('|')})\\b\\s*(.*)$`, 'i');
const ONE_LINE = new Set(['id', 'title', 'link']);
const NAME_RE = /^[A-Za-z_][\w]*$/;
const MXNAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
// 一个矩阵最多画多大：再大黑板上放不下，也看不清
export const MAX_DIM = 8;

// 从一行末尾拆出 from= until= name= label= of=（值可以加引号）
function mods(rest) {
  const { body, mods: m } = splitMods(rest);
  return { body: body.trim(), m };
}

const stepNum = (v, what) => {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(String(v))) throw new Error(`${what} 后面写第几步（数字）`);
  return Number(v);
};

/** 解析整段。返回 { fields, cmds }；写错了抛出中文原因（哪一行、怎么写才对） */
export function parseMatrix(src) {
  const fields = {};
  const cmds = [];
  let lastField = null;
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '').trimEnd();
    if (!line.trim()) { if (lastField) fields[lastField] += '\n'; continue; }
    const t = line.trim();
    const c = t.match(CMD_RE);
    const f = !c && line.match(/^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/);
    if (f) {
      lastField = f[1].toLowerCase();
      fields[lastField] = f[2];
      continue;
    }
    if (c) {
      try {
        cmds.push({ ...parseCmd(c[1].toLowerCase(), c[2]), srcLine: t });
      } catch (e) {
        throw new Error(`「${t.slice(0, 60)}」：${e.message}`);
      }
      lastField = null;
      continue;
    }
    if (lastField && !ONE_LINE.has(lastField)) fields[lastField] += '\n' + line;
    else throw new Error(`看不懂这一行：${t}（matrix 组件的命令：${CMDS.join(' / ')}）`);
  }
  for (const k in fields) if (typeof fields[k] === 'string') fields[k] = fields[k].trim();
  if (!cmds.some((x) => x.kind === 'matrix' || x.kind === 'product')) throw new Error('matrix 组件里至少要有一条 matrix 表达式（或 product A B）');
  // split 和 mark 的 of= 要指向有名字的矩阵
  const names = new Set();
  for (const x of cmds) {
    if (x.kind === 'matrix' && x.name) names.add(x.name);
    if (x.kind === 'product') [x.nameA, x.nameB, x.nameC].forEach((n) => names.add(n));
  }
  for (const x of cmds) {
    const of = x.kind === 'split' ? x.of : x.kind === 'mark' ? x.spec.of : null;
    if (of && !names.has(of)) throw new Error(`${x.srcLine}：没有叫 ${of} 的矩阵${names.size ? `（有的是：${[...names].join('、')}）` : '（matrix 那一行写 name=…）'}`);
  }
  return { fields, cmds };
}

function parseCmd(kind, rest) {
  if (kind === 'let') {
    const m = rest.trim().match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/);
    if (!m) throw new Error('let 的写法：let 名字 = 表达式');
    if (['I', 'E', 'step', 't'].includes(m[1])) throw new Error(`${m[1]} 是保留的名字，换一个`);
    parse(m[2]);
    return { kind, name: m[1], src: m[2].trim(), mods: {} };
  }
  if (kind === 'slider') {
    const { body, m } = mods(rest);
    const s = body.match(/^([A-Za-z_]\w*)\s+(\S+)\s+(\S+)(?:\s*=\s*(\S+))?$/);
    if (!s) throw new Error('slider 的写法：slider k 1 4 = 1 step=1');
    const min = Number(s[2]), max = Number(s[3]);
    const step = m.step !== undefined ? Number(m.step) : 1;
    const init = s[4] !== undefined ? Number(s[4]) : min;
    if (![min, max, init, step].every(Number.isFinite) || !(max > min) || !(step > 0)) throw new Error('slider 的最小值、最大值、初值、step 要是数，最大值比最小值大');
    if (init < min || init > max) throw new Error(`初值 ${init} 不在 ${min} 到 ${max} 之间`);
    return { kind, name: s[1], min, max, init, step, mods: m };
  }
  if (kind === 'matrix') {
    const { body, m } = mods(rest);
    if (!body) throw new Error('matrix 后面写要画的表达式，比如 matrix A 或 matrix A^k');
    parse(body);
    const name = m.name ?? (NAME_RE.test(body) ? body : undefined);
    if (name !== undefined && !MXNAME_RE.test(name)) throw new Error(`name「${name}」只能用字母、数字、- 和 _`);
    return { kind, src: body, label: m.label, name, from: stepNum(m.from, 'from'), until: stepNum(m.until, 'until'), mods: m };
  }
  if (kind === 'tex') {
    const { body, m } = mods(rest);
    if (!body) throw new Error('tex 后面写一段公式，比如 tex = 或 tex \\times');
    return { kind, tex: body, from: stepNum(m.from, 'from'), until: stepNum(m.until, 'until'), mods: m };
  }
  if (kind === 'split') {
    const m = {};
    for (const t of tokenize(rest)) {
      if (!t.key) throw new Error('split 的写法：split rows=2 cols=1（第 2 行、第 1 列后面画分块线）');
      m[t.key] = t.value;
    }
    const list = (v, what) => {
      if (v === undefined) return [];
      const ns = String(v).split(/[,，]/).map((x) => x.trim()).filter(Boolean).map(Number);
      if (!ns.length || ns.some((n) => !Number.isInteger(n) || n < 1)) throw new Error(`${what} 写从 1 数的序号，几条线用逗号隔开，比如 ${what}=1,3`);
      return [...new Set(ns)].sort((a, b) => a - b);
    };
    const rows = list(m.rows ?? m.row, 'rows'), cols = list(m.cols ?? m.col, 'cols');
    if (!rows.length && !cols.length) throw new Error('split 至少写 rows= 或 cols=');
    if (m.of !== undefined && !MXNAME_RE.test(m.of)) throw new Error('of 后面写矩阵的名字');
    return { kind, rows, cols, of: m.of };
  }
  if (kind === 'mark') {
    const r = parseMarkSpec(rest, { component: true });
    if (r.error) throw new Error(r.error);
    return { kind, spec: r.spec };
  }
  if (kind === 'product') {
    const { body, m } = mods(rest);
    const parts = body.split(/\s+/).filter(Boolean);
    if (parts.length !== 2) throw new Error('product 的写法：product A B（两个矩阵的名字或表达式，中间空格）');
    parts.forEach((p) => parse(p));
    const nm = (p, d) => (NAME_RE.test(p) ? p : d);
    return { kind, a: parts[0], b: parts[1], nameA: nm(parts[0], 'A'), nameB: nm(parts[1], 'B'), nameC: m.name || `${nm(parts[0], 'A')}${nm(parts[1], 'B')}`, from: stepNum(m.from, 'from'), until: stepNum(m.until, 'until'), mods: m };
  }
  throw new Error(`不认识的命令 ${kind}`);
}

/** 滑块的值按 step 取整（play 的时候中间值也落在格点上，矩阵一格一格地变） */
export function snapSlider(c, x) {
  const v = Math.min(c.max, Math.max(c.min, Number(x)));
  const k = Math.round((v - c.min) / c.step);
  return Math.round((c.min + k * c.step) * 1e9) / 1e9;
}

/**
 * 依次求出变量：整节课的量（base，精确值）→ 外部变量（link 的 step / t）→ 滑块（按 step 取整）→ let（被 set 过的用 set 的值）。
 * 返回 { vars（精确值，算不准的是小数）, errors }
 */
export function matrixEnv(cmds, { base = {}, extra = {}, slider = {}, override = {} } = {}) {
  const vars = { ...base };
  const errors = [];
  for (const [k, v] of Object.entries(extra)) vars[k] = toExactSafe(v);
  for (const c of cmds) if (c.kind === 'slider') vars[c.name] = Q.from(snapSlider(c, slider[c.name] ?? c.init));
  for (const c of cmds) {
    if (c.kind !== 'let') continue;
    if (Object.hasOwn(override, c.name)) { vars[c.name] = toExactSafe(override[c.name]); continue; }
    try { vars[c.name] = calcValue(c.src, vars).value; } catch (e) { errors.push(`let ${c.name} 算不出来：${e.message}`); }
  }
  return { vars, errors };
}

function toExactSafe(v) {
  try { return toExact(v); } catch { return v; }
}

/** 精确值 → 浮点（给 figureControls、课堂的 figure set 用） */
export function floatEnv(vars) {
  const out = {};
  for (const [k, v] of Object.entries(vars)) {
    try { out[k] = toFloat(v); } catch { /* 不是数的跳过 */ }
  }
  return out;
}

// 一个格子写成什么：精确分数写成 TeX（\tfrac），算不准的小数保留两位
export function cellTeX(x) {
  if (isQ(x)) return x.toTeX();
  if (typeof x === 'number') {
    const r = Math.round(x * 100) / 100;
    return String(Object.is(r, -0) ? 0 : r);
  }
  throw new Error('格子里要是数');
}

/** 值 → 要画的格子：矩阵原样，向量是一列，数是 1×1（不画括号）。返回 { cells: [[tex]], shape: 'matrix'|'vector'|'number' } */
export function cellsOf(v) {
  if (isQ(v) || typeof v === 'number') return { cells: [[cellTeX(v)]], shape: 'number' };
  const isNumVec = Array.isArray(v) && v.length && v.every((x) => isQ(x) || typeof x === 'number');
  if (isNumVec) return { cells: v.map((x) => [cellTeX(x)]), shape: 'vector' };
  const isM = Array.isArray(v) && v.length && v.every((r) => Array.isArray(r) && r.length === v[0].length && r.every((x) => isQ(x) || typeof x === 'number'));
  if (isM) return { cells: v.map((r) => r.map(cellTeX)), shape: 'matrix' };
  throw new Error('要画的是数、向量或矩阵');
}

const visibleAt = (c, step) => !(c.from !== undefined && !(step >= c.from)) && !(c.until !== undefined && !(step <= c.until));

/**
 * 按当前变量算出要画的东西（一项一项，从左到右）：
 *   { kind: 'matrix', cmd, name, label, cells, shape, split: { rows, cols } }
 *   { kind: 'tex', cmd, tex }
 *   { kind: 'product', cmd, A, B, C: { cells }, names }
 * 以及组件里的 mark（{ cmd, spec }，按 step 过滤过）。算不出来的项写进 errors（带命令原文）。
 */
export function matrixItems(cmds, vars) {
  const items = [];
  const marks = [];
  const errors = [];
  const step = isQ(vars.step) ? vars.step.toNumber() : Number(vars.step ?? 0);
  const calc = (tex) => {
    const r = expandCalc(String(tex ?? ''), (e) => calcValue(e, vars).tex);
    r.errors.forEach((e) => errors.push(`\\calc{${e.expr.trim().slice(0, 40)}} 算不出来：${e.msg}`));
    return r.tex;
  };
  let lastMatrix = null;
  cmds.forEach((c, i) => {
    const cmd = i + 1;
    try {
      if (c.kind === 'matrix') {
        if (!visibleAt(c, step)) return;
        const v = calcValue(c.src, vars).value;
        const { cells, shape } = cellsOf(v);
        if (cells.length > MAX_DIM || cells[0].length > MAX_DIM) throw new Error(`${cells.length}×${cells[0].length} 太大了，黑板上最多画 ${MAX_DIM}×${MAX_DIM}`);
        const it = { kind: 'matrix', cmd, name: c.name, label: c.label !== undefined ? calc(c.label) : undefined, cells, shape, split: { rows: [], cols: [] } };
        items.push(it);
        if (shape !== 'number') lastMatrix = it;
      } else if (c.kind === 'tex') {
        if (visibleAt(c, step)) items.push({ kind: 'tex', cmd, tex: calc(c.tex) });
      } else if (c.kind === 'product') {
        if (!visibleAt(c, step)) return;
        const A = calcValue(c.a, vars).value, B = calcValue(c.b, vars).value;
        const mA = asMatrix(A, c.a), mB = asMatrix(B, c.b);
        if (mA[0].length !== mB.length) throw new Error(`${c.a} 是 ${mA.length}×${mA[0].length}，${c.b} 是 ${mB.length}×${mB[0].length}：前一个的列数要等于后一个的行数才能相乘`);
        const C = calcValue(`(${c.a})*(${c.b})`, vars).value;
        const mC = asMatrix(C, `${c.a}${c.b}`);
        items.push({
          kind: 'product', cmd, names: [c.nameA, c.nameB, c.nameC],
          A: { cells: mA.map((r) => r.map(cellTeX)) }, B: { cells: mB.map((r) => r.map(cellTeX)) }, C: { cells: mC.map((r) => r.map(cellTeX)) },
          terms: (ci, cj) => mA[ci].map((a, k) => [cellTeX(a), cellTeX(mB[k][cj])]),
        });
        lastMatrix = { kind: 'product-c', name: c.nameC };
      } else if (c.kind === 'split') {
        const target = c.of ? items.find((x) => x.kind === 'matrix' && x.name === c.of) : (lastMatrix?.kind === 'matrix' ? lastMatrix : null);
        if (!target) throw new Error(c.of ? `${c.of} 还没画出来（split 写在它后面）` : 'split 前面要有一个矩阵（或者写 of=名字）');
        const R = target.cells.length, C = target.cells[0].length;
        const badR = c.rows.find((r) => r >= R), badC = c.cols.find((x) => x >= C);
        if (badR) throw new Error(`矩阵只有 ${R} 行，第 ${badR} 行后面画不了分块线`);
        if (badC) throw new Error(`矩阵只有 ${C} 列，第 ${badC} 列后面画不了分块线`);
        target.split = { rows: c.rows, cols: c.cols };
      } else if (c.kind === 'mark') {
        if (visibleAt(c.spec, step)) marks.push({ cmd, spec: c.spec });
      }
    } catch (e) {
      errors.push(`第 ${cmd} 条（${c.srcLine}）：${e.message}`);
    }
  });
  return { items, marks, errors };
}

function asMatrix(v, what) {
  if (isQMat(v)) return v;
  if (isQVec(v)) return v.map((x) => [x]);
  if (Array.isArray(v) && v.length && v.every((r) => Array.isArray(r))) return v;
  if (Array.isArray(v) && v.length) return v.map((x) => [x]);
  throw new Error(`${what} 要是矩阵或向量`);
}

/**
 * 两次画面之间，哪些格子的数「挪了地方」：新格子 (i, j) 的值变了、不是 0，旧矩阵里有个格子原来是这个值、现在变了 →
 * 从那个格子飞过来（每个旧格子只用一次，取最近的）。形状变了就不飞。返回 [{ from: [p, q], to: [i, j] }]
 */
export function flights(oldCells, newCells) {
  if (!oldCells || !newCells || oldCells.length !== newCells.length || oldCells[0].length !== newCells[0].length) return [];
  const out = [];
  const used = new Set();
  const R = newCells.length, C = newCells[0].length;
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < C; j++) {
      const v = newCells[i][j];
      if (v === oldCells[i][j] || v === '0') continue;
      let best = null;
      for (let p = 0; p < R; p++) {
        for (let q = 0; q < C; q++) {
          if ((p === i && q === j) || used.has(`${p},${q}`)) continue;
          if (oldCells[p][q] !== v || newCells[p][q] === v) continue;
          const d = Math.abs(p - i) + Math.abs(q - j);
          if (!best || d < best.d) best = { p, q, d };
        }
      }
      if (best) { used.add(`${best.p},${best.q}`); out.push({ from: [best.p, best.q], to: [i, j] }); }
    }
  }
  return out;
}

/** 两次画面之间值变了的格子（形状相同时）：[[i, j]] */
export function changedCells(oldCells, newCells) {
  if (!oldCells || !newCells || oldCells.length !== newCells.length || oldCells[0].length !== newCells[0].length) return [];
  const out = [];
  newCells.forEach((r, i) => r.forEach((v, j) => { if (v !== oldCells[i][j]) out.push([i, j]); }));
  return out;
}

/**
 * 组件里的 mark 对不对得上矩阵（行号、列号、分块）：返回出错原因，对得上返回 ''。
 * 不写 of= 时标的是第一个矩阵（和页面上从左到右的第一个一致）
 */
export function checkMark(spec, items) {
  const mats = [];
  for (const x of items) {
    if (x.kind === 'matrix' && x.shape !== 'number') mats.push({ name: x.name, cells: x.cells, split: x.split });
    if (x.kind === 'product') [x.A, x.B, x.C].forEach((m, k) => mats.push({ name: x.names[k], cells: m.cells, split: { rows: [], cols: [] } }));
  }
  const m = spec.of ? mats.find((x) => x.name === spec.of) : mats[0];
  if (!m) return spec.of ? `${spec.of} 现在没画出来` : '组件里没有矩阵可标';
  const R = m.cells.length, C = m.cells[0].length;
  const s = spec.sel;
  const size = `${R}×${C}`;
  if (s.kind === 'row' && s.i > R) return `矩阵是 ${size} 的，没有第 ${s.i} 行`;
  if (s.kind === 'col' && s.j > C) return `矩阵是 ${size} 的，没有第 ${s.j} 列`;
  if (s.kind === 'entry' && (s.i > R || s.j > C)) return `矩阵是 ${size} 的，没有 (${s.i}, ${s.j}) 元`;
  if (s.kind === 'block') {
    const nr = m.split.rows.length + 1, nc = m.split.cols.length + 1;
    if (!m.split.rows.length && !m.split.cols.length) return '这个矩阵还没分块：先写 split rows=… cols=…';
    if (s.i > nr || s.j > nc) return `矩阵分成 ${nr}×${nc} 块，没有子块 (${s.i}, ${s.j})`;
  }
  return '';
}
