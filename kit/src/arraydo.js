// array 的 mode: do：学生自己在数组上动手（交换、挪进空位、挪指针），页面只把每一步做出来、记下来。
// 哪种算法、哪一步该动谁，页面不管（那是主讲看记录判断的事）；写了 goal: 才比最后的序列。
// 这里全是纯函数（tests/arraydo.test.js），画面和记录在 blocks/arraydo.js。
import { parseArray, fmt } from './sorting.js';

const MAX_PTRS = 4;
const key = (x) => `${x.v}/${x.mark}`;
const show = (x) => fmt(x);

function parsePtrs(src, n) {
  const toks = String(src ?? '').trim().split(/[\s,，、]+/).filter(Boolean);
  if (toks.length > MAX_PTRS) throw new Error(`ptrs: 最多 ${MAX_PTRS} 个指针（现在 ${toks.length} 个）`);
  const out = [];
  for (const t of toks) {
    const m = t.match(/^([A-Za-z一-龥][\w一-龥]{0,7})(?:[=＝](\d+))?$/);
    if (!m) throw new Error(`ptrs: 看不懂「${t}」。写成 low=1 high=8（名字最多 8 个字，= 后面是开始的位置）`);
    const at = m[2] === undefined ? 1 : Number(m[2]);
    if (at < 1 || at > n) throw new Error(`ptrs: ${m[1]} 的位置要写 1 到 ${n}（现在是 ${at}）`);
    if (out.some((x) => x.name === m[1])) throw new Error(`ptrs: 指针 ${m[1]} 重复了`);
    out.push({ name: m[1], at });
  }
  return out;
}

/** 开始的样子。cells[0] 是暂存格（没写 temp: 就一直是 null、也不画），cells[1..n] 是数组 */
export function doStart(fields = {}) {
  const items = parseArray(fields.array);
  const n = items.length;
  const temp = String(fields.temp ?? '').trim().slice(0, 8) || null;
  let goal = null;
  if (String(fields.goal ?? '').trim()) {
    try { goal = parseArray(fields.goal); } catch (e) { throw new Error(String(e.message).replace(/^array:/, 'goal:')); }
    const a = items.map(key).sort().join(' ');
    const b = goal.map(key).sort().join(' ');
    if (a !== b) throw new Error('goal: 要和 array 是同一批数（只是顺序不同；重复的数照样加 \'）');
  }
  return { cells: [null, ...items], n, temp, ptrs: parsePtrs(fields.ptrs, n), goal, history: [] };
}

/** 点了两下，成不成一步。a、b：{ cell: 位置 }（0 是暂存格）或 { ptr: 名字 } */
export function doTap(state, a, b) {
  if (a.ptr !== undefined) {
    if (b.cell === undefined) throw new Error('点了指针，再点它要去的格子');
    if (b.cell === 0) throw new Error('指针不能指到暂存的那一格');
    const p = state.ptrs.find((x) => x.name === a.ptr);
    if (!p) throw new Error(`没有 ${a.ptr} 这个指针`);
    if (p.at === b.cell) throw new Error(`${p.name} 已经在第 ${p.at} 个了`);
    return { kind: 'ptr', name: p.name, from: p.at, to: b.cell };
  }
  if (b.cell === undefined) throw new Error('点了格子，再点另一个格子');
  if (a.cell === b.cell) throw new Error('点的是同一个格子');
  const x = state.cells[a.cell];
  const y = state.cells[b.cell];
  if (!x) throw new Error('先点的那一格是空的');
  return y ? { kind: 'swap', i: a.cell, j: b.cell } : { kind: 'move', from: a.cell, to: b.cell };
}

export function doApply(state, op) {
  const cells = state.cells.slice();
  let ptrs = state.ptrs;
  if (op.kind === 'swap') [cells[op.i], cells[op.j]] = [cells[op.j], cells[op.i]];
  else if (op.kind === 'move') { cells[op.to] = cells[op.from]; cells[op.from] = null; }
  else if (op.kind === 'ptr') ptrs = ptrs.map((p) => (p.name === op.name ? { ...p, at: op.to } : p));
  return { ...state, cells, ptrs, history: [...state.history, op] };
}

/** 撤回一步：从头照着重做一遍（最多十几个格子，不值得写反操作） */
export function doUndo(state) {
  const hist = state.history.slice(0, -1);
  let s = doReset(state);
  for (const op of hist) s = doApply(s, op);
  return s;
}

/** 回到开始的样子（history 里每一步都可逆，倒着做回去） */
export function doReset(state) {
  const cells = state.cells.slice();
  let ptrs = state.ptrs;
  for (const op of [...state.history].reverse()) {
    if (op.kind === 'swap') [cells[op.i], cells[op.j]] = [cells[op.j], cells[op.i]];
    else if (op.kind === 'move') { cells[op.from] = cells[op.to]; cells[op.to] = null; }
    else if (op.kind === 'ptr') ptrs = ptrs.map((p) => (p.name === op.name ? { ...p, at: op.from } : p));
  }
  return { ...state, cells, ptrs, history: [] };
}

const place = (state, p) => (p === 0 ? state.temp || '暂存' : `A[${p}]`);

/** 这一步写成字（给主讲看的记录）。state 是做这一步之前的 */
export function doOpText(op, state) {
  if (op.kind === 'swap') return `交换 A[${op.i}]、A[${op.j}]（${show(state.cells[op.i])} 和 ${show(state.cells[op.j])}）`.replace(/A\[0\]/g, state.temp || '暂存');
  if (op.kind === 'move') return `${place(state, op.from)} 的 ${show(state.cells[op.from])} 挪到 ${place(state, op.to)}`;
  return `${op.name}：${op.from} → ${op.to}`;
}

/** 记录里放回来用的短写法 */
export function doEncode(op) {
  if (op.kind === 'swap') return `s${op.i}-${op.j}`;
  if (op.kind === 'move') return `m${op.from}>${op.to}`;
  return `p:${op.name}:${op.from}>${op.to}`;
}

export function doDecode(text) {
  const t = String(text ?? '');
  let m = t.match(/^s(\d+)-(\d+)$/);
  if (m) return { kind: 'swap', i: Number(m[1]), j: Number(m[2]) };
  m = t.match(/^m(\d+)>(\d+)$/);
  if (m) return { kind: 'move', from: Number(m[1]), to: Number(m[2]) };
  m = t.match(/^p:([^:]+):(\d+)>(\d+)$/);
  if (m) return { kind: 'ptr', name: m[1], from: Number(m[2]), to: Number(m[3]) };
  return null;
}

/** 现在的序列（空位写 _；暂存格不算） */
export const doSeq = (state) => state.cells.slice(1).map((x) => (x ? show(x) : '_')).join(' ');

/** 全部步骤写成字 */
export function doOpsText(state) {
  const out = [];
  let s = doReset(state);
  for (const op of state.history) { out.push(doOpText(op, s)); s = doApply(s, op); }
  return out;
}

/** 做完了没有。ok: true / false；没写 goal 又没有空位时是 null（不判） */
export function doCheck(state) {
  if (state.cells.slice(1).some((x) => !x)) return { ok: false, why: '还有空着的格子' };
  if (!state.goal) return { ok: null, why: '' };
  const same = state.goal.every((g, k) => key(g) === key(state.cells[k + 1]));
  return same ? { ok: true, why: '' } : { ok: false, why: '和要做成的不一样' };
}
