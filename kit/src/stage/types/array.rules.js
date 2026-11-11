// 一排格子（排序）的规则（接口见 rules.js、docs/stage-types.md）：从现在的样子算正确的下一步、判学生的一下、写给老师的事实、
// 量、挑战用的判断式、手势表。纯函数，有测试（tests/stage-array-rules.test.js）；在 types/index.js 里登记。
//
// 排序本身都在 array.sort.js（每一趟的结果、常见错法借 engines/sort.js 的引擎，照王道的代码走），这里只照规则接口交出去。
// 老师没写明在做哪种排序（sort a insert、sort a shell d=5……）时页面不猜：只判这个世界做不做得到（分开排以后牌拖不到别的泳道），不判对错。
// 做完了（next 是 null，@a.done、叫老师）：希尔是这一趟做完（隔 d 的每条链都递增），别的是整个排好；from= 的一排是等于它该等于的那一趟。
// 一下的粒度只有直接插入、希尔、冒泡、简单选择；快排、归并、基数只判到一趟，学生的每一下不判对错。
import { parseRef } from '../script.js';
import { rowOf, numOf, inversions, strideOf, badPairs, chainSlots, chainMates, nextOf, checkOf, factsOf, briefOf, planFor, passEquals, noSortText } from './array.sort.js';

const cellOf = (o, x) => (x?.key != null ? rowOf(o).find((c) => c.key === x.key) || null : null);

/** 一个动作 → 学生那一行镜头指令（牌写 #编号：跟着它走；落点写第几格） */
export function actSrc(o, act) {
  if (act.type === 'swap') return `swap ${o.id}#${act.a} ${o.id}#${act.b}`;
  if (act.type === 'move') return `move ${o.id}#${act.key} -> ${o.id}.${act.to}${(act.d || 1) > 1 ? ` d=${act.d}` : ''}`;
  if (act.type === 'write') return `write ${o.id}.${cellOf(o, act)?.slot} ${act.value}`;
  throw new Error(`一排格子没有「${act.type}」这个动作`);
}
const made = (o, act) => ({ act, src: actSrc(o, act) });

/**
 * 一行镜头指令 → check 认的动作（actSrc 倒过来）：swap a#1 a#6、move a#6 -> a.2（d=5 是在隔 5 的链上挪）、write a.3 26。
 * 读不懂的给 null（一排格子自己的指令会把错说清楚）
 */
function lineAct(o, c, h) {
  const mine = (ps) => ps.length && ps.every((p) => p.obj === o.id);
  if (c.cmd === 'swap') {
    const ps = h.partsIn();
    return ps.length === 2 && mine(ps) && ps[0] !== ps[1] ? { type: 'swap', a: ps[0].key, b: ps[1].key } : null;
  }
  if (c.cmd === 'move') {
    if (h.arrow < 0) return null;
    const ps = h.partsIn(h.args.slice(0, h.arrow));
    const dest = h.args.slice(h.arrow + 1).find((a) => a.t === 'word' && parseRef(a.v)?.kind === 'slot');
    const r = dest ? parseRef(dest.v) : null;
    if (ps.length !== 1 || !mine(ps) || !r || r.obj !== o.id) return null;
    const d = h.opts.d == null ? 1 : h.scene.num(h.opts.d);
    return { type: 'move', key: ps[0].key, to: r.lo, d };
  }
  if (c.cmd === 'write') {
    const ps = h.partsIn();
    if (ps.length !== 1 || !mine(ps)) return null;
    const v = h.words.filter((w) => !h.scene.isRef(w)).at(-1) ?? h.str;
    return v == null ? null : { type: 'write', key: ps[0].key, value: v === '_' ? '' : String(v) };
  }
  return null;
}

// —— 手势表 ——
// 按住一张牌拖（open a move）：放到另一张上 = 对调；放到两张之间 = 插进去，中间的各让一格；放到空格子上 = 挪进去（和空格子对调）。
// 落点是画法交的：另一格（部件），或者两格之间的空隙 { gap: { row（哪条泳道，没分开是 0）, before（空隙后面那一格是第几格；这条线的最后是 null） } }。
// 这张牌沿哪条线挪：分开排着（split）是它那条泳道；写明了希尔是它那条隔 d 的链（一排里的空隙照「链上排第几」算，落不到别的链上）；不然是整排
function moveAct(o, { from, to } = {}) {
  const row = rowOf(o);
  const x = cellOf(o, from);
  if (!x) return { error: '按住一张牌再拖' };
  if (x.value === '') return { error: '空格子拖不动：把牌拖进来' };
  const split = row.some((c) => c.row);
  const lane = '分开排着的时候只能在自己那一排里拖';
  if (to?.key != null) {
    const y = cellOf(o, to);
    if (!y || y.key === x.key) return { error: '拖到另一格上（对调），或者两格之间（插进去）' };
    if (split && y.row !== x.row) return { error: lane };
    return made(o, { type: 'swap', a: x.key, b: y.key });
  }
  const g = to?.gap;
  if (!g) return { error: '拖到另一格上（对调），或者两格之间（插进去）' };
  if (split && g.row !== x.row) return { error: lane };
  const d = !split && o.sort?.algo === 'shell' && Number.isInteger(o.sort.d) && o.sort.d > 1 ? o.sort.d : 1;
  const line = split ? row.filter((c) => c.row === x.row) : d > 1 ? row.filter((c) => (c.slot - x.slot) % d === 0) : row;
  const i = line.findIndex((c) => c.key === x.key);
  const t = g.before == null ? line.length : line.filter((c) => c.slot < g.before).length;
  const j = t > i ? t - 1 : t;
  if (j === i) return { error: d > 1 ? `还在原处：${x.value} 只沿隔 ${d} 的那条链（第 ${line.map((c) => c.slot).join('、')} 格）挪` : '还在原处：拖到别的两格之间' };
  const stride = line.length > 1 ? line[1].slot - line[0].slot : 1;
  if (line.some((c, k) => k && c.slot - line[k - 1].slot !== stride)) return { error: '这条泳道上的牌已经不是隔得一样远的一组了，插不了（拖到另一张上对调）' };
  return made(o, { type: 'move', key: x.key, to: line[j].slot, d: stride });
}

const gestures = {
  // makes：交出去的是 swap 或 move（events.js 的 undoneOf 照它看学生做不做得了下一步）
  move: { gesture: 'drop-at', from: 'cell', to: ['cell', 'gap'], makes: ['swap', 'move'], toAct: moveAct, text: '按住拖：放到另一张上对调，放到两张之间插进去' },
  // 点一格写一个数（数字键盘）：空格子、有数的格都能写（只开几格写 open a.1 edit）
  edit: {
    gesture: 'write', on: 'cell',
    ask: (o, { to, from } = {}) => { const x = cellOf(o, to || from); return { input: 'keypad', prompt: x ? `${o.id} 第 ${x.slot} 格写成几？` : '写一个数' }; },
    toAct(o, { to, from, value } = {}) {
      const x = cellOf(o, to || from);
      if (!x) return { error: `点 ${o.id} 的一格再写数` };
      const v = String(value ?? '').trim();
      if (!/^-?\d+(\.\d+)?(\/\d+)?$/.test(v)) return { error: `「${v}」不是数（写成 26、-3、0.5）` };
      return made(o, { type: 'write', key: x.key, value: v });
    },
  },
};

// —— 量（inv(a)、bad(a)、chains(a)、moves(a)；rules.js 的 measures）——
// 有空着的格是 null（现在数不了，写满了就有）；不全是数、没定隔几个、没写明排序是 undefined（这一排本来就没有这个量，现状里不列）
const numsOf = (cells) => [...cells].sort((a, b) => a.slot - b.slot).map((c) => (c.value === '' ? '' : numOf(c.value)));
function chainsNow(o, parts) {
  if (parts) return undefined;
  const d = strideOf(o);
  const row = rowOf(o);
  if (!d || !(d >= 1 && d < row.length) || row.some((c) => c.value !== '' && c.num == null)) return undefined;
  if (row.some((c) => c.value === '')) return null;
  return { total: chainSlots(row.length, d).length, bad: badPairs(row, d) };
}
const BLANK = '还有空着的格';
const NEED_D = '写整排的名字，隔几个照 sort a shell d=5 或 group a stride=5';
const measures = {
  // 前大后小的有几对（逆序对）；写一段（inv(a.2-5)）只数这一段里的
  inv: Object.assign((o, parts) => {
    const ns = numsOf(parts || o.cells);
    if (ns.some((v) => v == null)) return undefined;
    return ns.includes('') ? null : inversions(ns);
  }, { blank: BLANK, none: '格子里不全是数' }),
  // 隔 d 的链上挨着、前大后小的有几对
  bad: Object.assign((o, parts) => { const c = chainsNow(o, parts); return c == null ? c : c.bad.length; }, { blank: BLANK, none: NEED_D }),
  // 隔 d 的链排好了几条
  chains: Object.assign((o, parts) => { const c = chainsNow(o, parts); return c == null ? c : c.total - new Set(c.bad.map((p) => p.chain)).size; }, { blank: BLANK, none: NEED_D }),
  // 写明排序以来一共让了几格（对调算 1 格，插进去是给它让位的有几张）
  moves: Object.assign((o, parts) => (parts || !o.sort || o.sort.src ? undefined : o.sort.moved || 0), { none: '写整排的名字，先写明在做哪种排序：sort a insert' }),
};

// —— 挑战用的判断式（when="a pass=2, a chains=5, a mates a.1 a.6"；整个排好是共用的 a sorted）——
const predicates = {
  // 现在等于第 k 趟（快排是第 k 次划分）结束后的样子；不写 k：希尔是这一趟，from= 的一排是它该等于的那一趟
  pass: (o, [k] = [], scene) => {
    if (!o.sort) throw new Error(`${noSortText(o.id)}，${o.id} pass 判不了`);
    let want = null;
    if (k != null) {
      if (!/^\d+$/.test(String(k)) || Number(k) < 1) throw new Error(`pass 写第几趟（从 1 数）：${o.id} pass=2`);
      want = Number(k);
    } else if (!o.sort.src && o.sort.algo !== 'shell') throw new Error(`pass 要写第几趟：${o.id} pass=2（整个排好写 ${o.id} sorted）`);
    return passEquals(o, scene, want);
  },
  // 隔 d 的每条链都递增（d 不写就照写明的希尔、分的组）
  chains: (o, [dArg] = [], scene) => {
    const d = dArg != null ? scene.num(dArg) : strideOf(o);
    const row = rowOf(o);
    if (d == null) throw new Error(`chains 要写隔几个：${o.id} chains=5（或者先 sort ${o.id} shell d=5 / group ${o.id} stride=5）`);
    if (!(Number.isInteger(d) && d >= 1)) throw new Error(`chains=${dArg ?? d}：隔几个要是正整数`);
    if (row.some((c) => c.value !== '' && c.num == null)) throw new Error(`${o.id} 里不全是数，链排没排好判不了`);
    if (row.some((c) => c.value === '')) return null;
    return badPairs(row, Math.min(d, row.length)).length === 0;
  },
  // 这两格是不是隔 d 的同一条链上挨着的
  mates: (o, args = [], scene) => {
    const d = strideOf(o);
    if (d == null) throw new Error(`mates 要先定隔几个：sort ${o.id} shell d=5 或 group ${o.id} stride=5`);
    const ps = args.flatMap((w) => scene.parts(w));
    if (ps.length !== 2 || ps.some((p) => p.obj !== o.id)) throw new Error(`mates 后面写 ${o.id} 的两格：${o.id} mates ${o.id}.1 ${o.id}.6`);
    return chainMates(ps[0].slot, ps[1].slot, d);
  },
};

/** 这一下改了哪几格（ask pick 交了以后和真变了的比）：换了位置、换了值的 */
function changed(before, after) {
  if (!before || !after) return [];
  const was = new Map(before.cells.map((c) => [c.key, c]));
  return rowOf(after).filter((c) => { const q = was.get(c.key); return q && (q.slot !== c.slot || String(q.value) !== String(c.value)); }).map((c) => c.key);
}

/** 借引擎跑出来的整段标准过程（测试拿来和 next 对拍）：每一趟结束后的一排、常见错法；没写明排序、跑不了是 null */
function standard(o, scene) {
  if (!o.sort) return null;
  try { const p = planFor(o, scene); return { passes: p.passes, nums: p.nums, variants: p.variants, counts: p.counts }; } catch { return null; }
}

export const arrayRules = {
  next: nextOf, check: checkOf, facts: factsOf, brief: briefOf, predicates, measures, gestures, changed, standard, actOf: lineAct,
  // 不走手势表的拖（open a：两格对调）交的是 swap
  makes: { drag: ['swap'] },
  // 拖（open a）、挪（open a move）页面判对错（写明了判得了每一下的排序时；别的 open 那一行写 wrong= 当场报，array.js 的 canOpen）
  judges: ['drag', 'move'],
  doneBy: ['drag', 'move', 'edit'],
};
