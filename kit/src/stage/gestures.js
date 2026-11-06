// 通用手势（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）不碰 DOM 的那一半：手指的事都在 gesturedom.js，
// 这里只管「按下的部件、松手处的部件或空位、写的值 → 一行学生指令」和「撤一步」。纯函数，有测试（tests/stage-gestures.test.js）。
//
// 五种手势所有东西共用：tap 点一个部件、drop-on 拖到另一个部件上、drop-at 拖到空处（托盘里的拖进来）、span 从一个部件拉到另一个、
// write 往一个部件里写一个值。每种东西在规则文件里交一张手势表（rules.js 的 gestures）：五种手势在它这里是什么动作、翻成哪一行指令
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

/**
 * 撤一步（open … undo=on）：去掉最后一行学生的（老师的、页面的不动），不改原来的。from：这一回合从 log 的哪里开始，
 * 以前的不撤（老师已经看过、照它讲了）。没有能撤的就原样给回（长度一样）
 */
export function undoLines(lines = [], { from = 0 } = {}) {
  for (let i = lines.length - 1; i >= Math.max(0, from); i--) {
    if (lines[i]?.by === 'student') return [...lines.slice(0, i), ...lines.slice(i + 1)];
  }
  return [...lines];
}
