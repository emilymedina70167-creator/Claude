// 一排格子的规则（接口见 rules.js、docs/stage-types.md；主线第二轮 A）。纯函数，有测试（tests/stage-array-rules.test.js）。
//
// 页面在一排格子上不判对错（没有 next / judges / doneBy）：排序的每一趟对不对是老师看着判的事。这里只交
//   - 手势表：按住一张拖（open a move：放到另一张上对调、放到两张之间插进去、放到空格子上挪进去）、点一格写数（open a edit）；
//   - 做不做得到：分开排着（split）时只在自己那条泳道里、空格子拿不起来；
//   - 事实：这一下做了什么、前大后小的对数怎么变；
//   - 量：inversions(a) 前大后小的有几对（不叫 inv：那是矩阵求逆，话里的 {inv(A)} 照旧是式子）、blank(a) 还空着几格。
// 老写法 open a（按下就拖、两格对调）不走这里：发给老师的话和以前一字不差（actOf 只认 open a move / edit 来的那一下）
import { parseRef } from '../script.js';

const rowOf = (o) => [...o.cells].sort((a, b) => a.slot - b.slot);
const cellOf = (o, x) => (x?.key != null ? o.cells.find((c) => c.key === x.key) || null : null);
/** 一格里的字当数读（49′ 是 49）：不是数给 null，空格子给 '' */
export function numOf(v) {
  const s = String(v ?? '').trim();
  if (s === '') return '';
  const m = s.replace(/[′']+$/, '').replace(/^[−–]/, '-').match(/^(-?\d+(?:\.\d+)?)(?:\/(\d+))?$/);
  return m && !(m[2] && Number(m[2]) === 0) ? Number(m[1]) / (m[2] ? Number(m[2]) : 1) : null; // 分母是 0 的不是数
}
/** 前大后小的有几对（逆序对）；一样大的不算 */
export function inversions(ns) {
  let n = 0;
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (ns[i] > ns[j]) n++;
  return n;
}

/** 一个动作 → 学生那一行镜头指令（牌写 #编号：跟着它走；落点写第几格） */
export function actSrc(o, act) {
  if (act.type === 'swap') return `swap ${o.id}#${act.a} ${o.id}#${act.b}`;
  if (act.type === 'move') return `move ${o.id}#${act.key} -> ${o.id}.${act.to}`;
  if (act.type === 'write') return `write ${o.id}.${cellOf(o, act)?.slot} ${act.value === '' ? '_' : act.value}`;
  throw new Error(`一排格子没有「${act.type}」这个动作`);
}
const made = (o, act) => ({ act, src: actSrc(o, act) });

// 按住一张牌拖（open a move）。落点是画法交的：另一格（部件），或者两格之间的空隙
// { gap: { row（哪条泳道，没分开是 0）, before（空隙后面那一格现在是第几格；这条线的最后是 null） } }
function moveAct(o, { from, to } = {}) {
  const x = cellOf(o, from);
  if (!x) return { error: '按住一张牌再拖' };
  if (x.value === '') return { error: '空格子拖不动：把牌拖进来' };
  const split = o.cells.some((c) => c.row);
  const lane = '分开排着的时候只能在自己那一排里拖';
  const where = '拖到另一张上（对调），或者两张之间（插进去）';
  if (to?.key != null) {
    const y = cellOf(o, to);
    if (!y || y.key === x.key) return { error: where };
    if (split && y.row !== x.row) return { error: lane };
    return made(o, { type: 'swap', a: x.key, b: y.key });
  }
  const g = to?.gap;
  if (!g) return { error: where };
  if (split && (g.row || 0) !== (x.row || 0)) return { error: lane };
  // 这张牌沿哪条线挪：分开排着是它那条泳道，不然是整排
  const line = rowOf(o).filter((c) => !split || c.row === x.row);
  const i = line.findIndex((c) => c.key === x.key);
  const t = g.before == null ? line.length : line.filter((c) => c.slot < g.before).length;
  const j = t > i ? t - 1 : t;
  if (j === i) return { error: '还在原处：拖到别的两张之间', quiet: true };
  // 泳道里的牌隔得一样远才插得了（move 是整排上中间的各让一格；泳道上隔着别的牌，插不成）
  if (split && line.some((c, k) => k && c.slot - line[k - 1].slot !== 1)) return { error: '分开排着的时候插不了（拖到另一张上对调；要插进去先 merge 合回一排）' };
  return made(o, { type: 'move', key: x.key, to: line[j].slot });
}

const gestures = {
  // makes：交出去的是 swap 或 move
  move: { gesture: 'drop-at', from: 'cell', to: ['cell', 'gap'], makes: ['swap', 'move'], toAct: moveAct, brief: '按住一张拖：放到另一张上对调，两张之间插进去', text: '按住一张拖：放到另一张上对调，放到两张之间插进去' },
  // 点一格写一个数（数字键盘）：空格子、有数的格都能写（只开几格写 open a.1 a.2 edit）
  edit: {
    gesture: 'write', on: 'cell', brief: '点一格键盘写数', text: '点一格，键盘写一个数',
    ask: (o, { to, from } = {}) => { const x = cellOf(o, to || from); return { input: 'keypad', prompt: x ? `${o.id} 第 ${x.slot} 格写成几？` : '写一个数' }; },
    toAct(o, { to, from, value } = {}) {
      const x = cellOf(o, to || from);
      if (!x) return { error: `点 ${o.id} 的一格再写数` };
      const v = String(value ?? '').trim();
      if (numOf(v) == null || v === '') return { error: `「${v}」不是数（写成 26、-3、0.5）` };
      return made(o, { type: 'write', key: x.key, value: v });
    },
  },
};

/**
 * 一行镜头指令 → check 认的动作。只认学生从 open a move / open a edit 做的那一下：老写法 open a 的对调、老师自己演的都不过裁判
 * （它们发给老师的话、画面和以前一样）。读不懂的给 null（一排格子自己的指令会把错说清楚）
 */
function actOf(o, c, h, { by = null, open = null } = {}) {
  if (by !== 'student' || (open !== 'move' && open !== 'edit')) return null;
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
    return ps.length === 1 && mine(ps) && r && r.obj === o.id ? { type: 'move', key: ps[0].key, to: r.lo } : null;
  }
  if (c.cmd === 'write') {
    const ps = h.partsIn();
    if (ps.length !== 1 || !mine(ps)) return null;
    const v = h.words.filter((w) => !h.scene?.isRef?.(w)).at(-1) ?? h.str;
    return v == null ? null : { type: 'write', key: ps[0].key, value: v === '_' ? '' : String(v) };
  }
  return null;
}

// 只判这个世界做不做得到，不判对错（right 永远是 null）。why 写这一下做了什么
function check(o, act) {
  const no = (why) => ({ legal: false, right: null, misread: null, why, next: null });
  const ok = (why) => ({ legal: true, right: null, misread: null, why, next: null });
  const split = o.cells.some((c) => c.row);
  if (act.type === 'swap') {
    const a = cellOf(o, { key: act.a }), b = cellOf(o, { key: act.b });
    if (!a || !b) return ok(null);
    if (split && a.row !== b.row) return no('这两张不在同一条泳道里：分开排着时只能在自己那一组里换');
    if (a.value === '' && b.value === '') return no('两格都空着');
    if (a.value === '' || b.value === '') { const x = a.value === '' ? b : a, y = a.value === '' ? a : b; return ok(`${x.value} 从第 ${x.slot} 格挪进空着的第 ${y.slot} 格`); }
    return ok(`${a.value} 和 ${b.value} 对调（第 ${a.slot} 格和第 ${b.slot} 格）`);
  }
  if (act.type === 'move') {
    const x = cellOf(o, { key: act.key });
    if (!x) return ok(null);
    if (x.value === '') return no('空格子拖不动');
    const n = Math.abs(act.to - x.slot);
    return ok(`${x.value} 从第 ${x.slot} 格插到第 ${act.to} 格，中间 ${n} 张各让一格`);
  }
  if (act.type === 'write') {
    const x = cellOf(o, { key: act.key });
    if (!x) return ok(null);
    return ok(act.value === '' ? `第 ${x.slot} 格空出来了` : `第 ${x.slot} 格写成 ${act.value}${x.value !== '' ? `（原来是 ${x.value}）` : ''}`);
  }
  return ok(null);
}

// 都是数、没有空格子时：前大后小的有几对；数不了是 null
const invOf = (o) => { const ns = rowOf(o).map((c) => numOf(c.value)); return ns.some((v) => v == null || v === '') ? null : inversions(ns); };
/** 学生这一下以后写给老师的事实：前大后小的对数怎么变；写满了说一声 */
function facts(before, after, act) {
  const out = [];
  const a = invOf(before), b = invOf(after);
  if (a != null && b != null && act.type !== 'write') out.push(a === b ? `前大后小的还是 ${b} 对` : `前大后小的从 ${a} 对变成 ${b} 对${b === 0 ? '（从小到大排好了）' : ''}`);
  if (act.type === 'write') {
    const left = after.cells.filter((c) => c.value === '').length;
    if (before.cells.some((c) => c.value === '')) out.push(left ? `还空着 ${left} 格` : `写满了：${rowOf(after).map((c) => c.value).join(' ')}`);
  }
  return out;
}

// 交给学生拖、写的时候才在现状里列（查找、哈希、KMP 的课用不上，每一轮多一句没用；老师的话、贴的字、挑战里随时能写）
// 还有空格子时不列（blank 那一项已经说了空着几格，不再多一句「数不了」）
const studentMoves = (o, scene) => !o.cells.some((c) => c.value === '') && [...(scene?.opens?.values?.() || [])].some((e) => e.obj === o.id && (e.action === 'move' || e.action === 'edit'));
const measures = {
  // 前大后小的有几对（逆序对）；写一段（inversions(a.2-5)）只数这一段里的
  inversions: Object.assign((o, parts) => {
    const ns = [...(parts || o.cells)].sort((x, y) => x.slot - y.slot).map((c) => numOf(c.value));
    if (ns.some((v) => v == null)) return undefined;
    return ns.includes('') ? null : inversions(ns);
  }, { blank: '还有空着的格', none: '格子里不全是数', listed: studentMoves }),
  // 还空着几格（有空格子才在现状里列）
  blank: Object.assign((o, parts) => [...(parts || o.cells)].filter((c) => c.value === '').length, { listed: (o) => o.cells.some((c) => c.value === '') }),
};

/** 这一下改了哪几格（ask pick 交了以后和真变了的比）：换了位置、换了值的 */
function changed(before, after) {
  if (!before || !after) return [];
  const was = new Map(before.cells.map((c) => [c.key, c]));
  return rowOf(after).filter((c) => { const q = was.get(c.key); return q && (q.slot !== c.slot || String(q.value) !== String(c.value)); }).map((c) => c.key);
}

export const arrayRules = { check, facts, measures, gestures, changed, actOf };
