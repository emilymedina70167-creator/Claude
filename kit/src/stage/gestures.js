// 通用手势（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）不碰 DOM 的那一半：手指的事都在 gesturedom.js，
// 这里只管「按下的部件、松手处的部件或空位、写的值 → 一行学生指令」和「撤一步」。纯函数，有测试（tests/stage-gestures.test.js）。
//
// 六种手势所有东西共用：tap 点一个部件、drop-on 拖到另一个部件上、drop-at 拖到空处（托盘里的拖进来）、span 从一个部件拉到另一个、
// line 从一个钩拉出一条线松在别处（句子的 refer）、write 往一个部件里写一个值。每种东西在规则文件里交一张手势表（rules.js 的 gestures）：这几种手势在它这里是什么动作、翻成哪一行指令
// （toAct），要不要先问一个值（ask：倍数框；pick + choices：成分标签）。这里不认识任何具体的东西。
import { gestureOf } from './rules.js';

/** 手势表那一项交的手势（一种或几种：矩阵的 rowop 是 drop-on 和 tap） */
export const kindsOf = (g) => [].concat(g?.gesture || []);

/** 写的值规整成指令里的写法：键盘上的减号（−）、全角斜线 */
export function normValue(v) {
  if (v == null) return v;
  return String(v).trim().replace(/[−–—]/g, '-').replace(/／/g, '/');
}

/**
 * 一下手势 → 一行学生指令：{ act, src } | { error }。
 * e 是场景里 open 的那一项（scene.opens 的值：{ obj, action, gesture, … }）；from / to 是部件（scene.parts 给的）或
 * 那种东西自己认的写法（{ row: 3 }、{ label: 3 }、{ slot: { parent, side } }、{ tree }）；value 是写的值、托盘里的数；role 是点的成分
 */
export function gestureAct(scene, e, { from, to, value, role } = {}) {
  const o = scene?.objects?.get(e?.obj);
  if (!o) return { error: `舞台上没有「${e?.obj ?? ''}」` };
  const g = e.gesture || gestureOf(o, e.action);
  if (typeof g?.toAct !== 'function') return { error: `${o.id} 的 ${e.action} 不是通用手势` };
  let r;
  try { r = g.toAct(o, { from, to, value: normValue(value), role }); } catch (err) { return { error: err?.message || String(err) }; }
  if (r?.error) return { error: r.error };
  if (!r?.src) return { error: '这一下翻不成一行指令' };
  return { act: r.act, src: r.src };
}

/**
 * 这一下放下以后要不要先问一个值：{ input: 'keypad', prompt, hint? }（数字键盘）、{ pick, choices: [{ value, text, paint? }] }（点一个）或 null。
 * write 总是要写一个值；span 的手势表写了 pick 就要点一个（句子的成分）；别的看手势表的 ask（矩阵：倍加、倍乘要倍数，对调不用）
 */
export function askFor(g, o, kind, ctx = {}) {
  if (!g) return null;
  const own = typeof g.ask === 'function' ? g.ask(o, { kind, ...ctx }) : null;
  if (kind === 'write') return own || { input: 'keypad', prompt: '写一个数' };
  if (kind === 'span' && g.pick) return { pick: g.pick, choices: typeof g.choices === 'function' ? g.choices(o, ctx) : [] };
  return own || null;
}

/** 撤不了时按钮下面那一句（中性：不说对错） */
export const UNDO_TOLD = '这一下已经记下了，撤不了';
export const UNDO_NO = '这一下不能撤';

/**
 * 撤一步（open … undo=on）要撤哪一行：from（这一回合从 log 的哪里开始，以前的老师已经看过、照它讲了）以后学生的最后一行。
 * 返回 { lines（去掉那一行，别的一行不少、先后不变）, gone（撤掉的那一行）, why（撤不了的话）, index }。
 * 撤不了的不往前跳（跳过去撤更早的一行，先后就乱了）：
 *   - 那一下引出过预写、做到了挑战、做完了（reacted）：预写只演一次，「做到了」也已经告诉课堂——UNDO_TOLD；
 *   - 那一下不是从写了 undo=on 的那一项来的（undoable 说不行，比如拨数）——UNDO_NO。
 * 这一回合学生还没做过：gone、why 都是 null
 */
export function undoPlan(lines = [], { from = 0, undoable = null } = {}) {
  let i = lines.length - 1;
  for (; i >= Math.max(0, from); i--) if (lines[i]?.by === 'student') break;
  if (i < Math.max(0, from)) return { lines, gone: null, why: null, index: -1 };
  const row = lines[i];
  if (row.reacted) return { lines, gone: null, why: UNDO_TOLD, index: i };
  if (undoable && !undoable(row)) return { lines, gone: null, why: UNDO_NO, index: i };
  return { lines: [...lines.slice(0, i), ...lines.slice(i + 1)], gone: row, why: null, index: i };
}
/** 撤一步以后的 log（撤不了就原样，长度一样） */
export const undoLines = (lines = [], opts = {}) => [...undoPlan(lines, opts).lines];

// 一项 open 用手指抓哪几种地方：部件（树的结点、句子的词、矩阵的格）统一叫 part，别的照手势表的名字（托盘、行把手、行号、括号）
const PART_GRIPS = new Set(['part', 'node', 'word', 'cell']);
/**
 * 手势表那一项要抓的：拖、拉的起点（from），点、写的地方（tap / on）。拖到哪儿（to）不算：落点不抢手指。
 * 两项 open 抓同一种地方，同一处按下去只拿得到先挂的那一个，后开的那一项就没声没息地用不了——场景当场报（scene.js 的 open）
 */
export function gestureGrabs(g) {
  const out = new Set();
  const add = (n) => { for (const x of [].concat(n || [])) out.add(PART_GRIPS.has(x) ? 'part' : x); };
  const ks = kindsOf(g);
  if (ks.some((k) => k === 'drop-on' || k === 'drop-at' || k === 'span' || k === 'line')) add(g.from);
  if (ks.includes('tap')) add(g.tap || g.on);
  if (ks.includes('write')) add(g.on);
  return out;
}

// 写的值是几（3、-2、3/2、0.5）：比 range 用；读不懂是 null（toAct 自己会说）
const numOf = (v) => {
  const m = String(normValue(v) ?? '').match(/^(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const d = m[2] == null ? 1 : Number(m[2]);
  return d ? Number(m[1]) / d : null;
};
/** 写一个值（键盘）时老师写了 range=：出了范围的说一句（不收）；没写 range 不限 */
export function writeRange(e, value) {
  if (e?.lo == null || e?.hi == null) return null;
  const x = numOf(value);
  if (x == null || (x >= e.lo - 1e-9 && x <= e.hi + 1e-9)) return null;
  return `这一格只能写 ${e.lo}～${e.hi} 之间的数`;
}
