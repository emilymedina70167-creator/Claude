// 通用手势（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）不碰 DOM 的那一半：手指的事都在 gesturedom.js，
// 这里只管「按下的部件、松手处的部件或空位、写的值 → 一行学生指令」和「撤一步」。纯函数，有测试（tests/stage-gestures.test.js）。
//
// 六种手势所有东西共用：tap 点一个部件、drop-on 拖到另一个部件上、drop-at 拖到空处（托盘里的拖进来）、span 从一个部件拉到另一个、
// line 从一个钩拉出一条线松在别处（句子的 refer）、write 往一个部件里写一个值。按法分三种（点、滑、按住再拖，PRESS_OF），
// 同一处按法不一样的能一起开，一下只认成一种（choosePress）；学生做的东西头上的 ✕ 照手势表的 close 翻（closeAct）。每种东西在规则文件里交一张手势表（rules.js 的 gestures）：这几种手势在它这里是什么动作、翻成哪一行指令
// （toAct），要不要先问一个值（ask：倍数框；pick + choices：成分标签）。这里不认识任何具体的东西。
import { gestureOf } from './rules.js';
import { parseScript } from './script.js';

/** 手势表那一项交的手势（一种或几种：矩阵的 rowop 是 drop-on 和 tap） */
export const kindsOf = (g) => [].concat(g?.gesture || []);

/**
 * 画面（gesturedom.js）现在真挂得上的手势（第二轮 Task 11 起六种都有：line 是从钩上拉线）。以后手势表里加了画面还没做的一种，
 * 先不放进来：开着这种手势的那一项，舞台现状不写进「学生能直接动的」（不能对老师说学生能动），单独写一句页面还画不了
 */
export const ARMED_GESTURES = new Set(['tap', 'drop-on', 'drop-at', 'span', 'write', 'line']);
/**
 * 画法（各种东西的 view.grips）现在交得出的把手，名字和手势表里 from / on / tap / to / close.on 写的一样（第二轮 Task 11 交了
 * 句子的钩 hook、空隙 gap、小方块 pill、✕ 的 xmark / xrefer、句子外框 sentence、矩阵整张的 whole、图的边 edge）。手势表里写了、画法还没交的：
 * 起点没有就拿不起来，落点没有就放不下——那一种手势算挂不上，和 ARMED_GESTURES 一样不对老师说学生能动
 */
export const ARMED_GRIPS = new Set(['node', 'parent', 'tray', 'tree', 'slot', 'row', 'label', 'cell', 'word', 'bracket', 'hook', 'gap', 'pill', 'xmark', 'xrefer', 'sentence', 'whole', 'edge', 'stand', 'end', 'stop']);
/**
 * 画面分不分得清同一处的几种按法：pointer.js 照 choosePress 分（第二轮 Task 11 接上，true）。分不清时（false）同一处开了几种按法，
 * 手指按下去只拿得到其中一种：舞台现状照实说（scene.js 的 stateText），不说几种都按得出
 */
export const ARMED_PRESS = { mixed: true };
const armedAny = (names) => names == null || [].concat(names).some((n) => ARMED_GRIPS.has(n));
/**
 * 一种手势在这一项上画面挂不挂得上：手势本身画面会做，起点（拖、拉的 from，点、写的 tap / on）、落点（to）画法都交得出。
 * 挂不上的那一种 gesturedom.js 就不挂（不然拎得起来放不下，还抢了同一处别的手势的手指）
 */
export function kindArmed(g, k) {
  if (!ARMED_GESTURES.has(k)) return false;
  if (k === 'tap') return armedAny(g.tap || g.on);
  if (k === 'write') return armedAny(g.on);
  return armedAny(g.from) && armedAny(g.to);
}
/** open 的这一项学生现在真动得了吗：不是手势表里的（拖、点开看）照旧动得了；手势表里的要有一种画面挂得上 */
export const armable = (g) => !g || kindsOf(g).some((k) => kindArmed(g, k));
/**
 * 画面挂得上、可是这样东西现在的样子让学生拿不到起点的（句子的钩挂在折起来的词上）：手势表那一项写 idle(o, e, scene) →
 * { all（一个起点都没有：学生现在动不了）, text（为什么，写给老师）} 或 null。没写、出错都当 null（照旧说学生能动）
 */
export function idleOf(scene, e) {
  const g = e?.gesture;
  const o = scene?.objects?.get(e?.obj);
  if (typeof g?.idle !== 'function' || !o) return null;
  try { return g.idle(o, e, scene) || null; } catch { return null; }
}

// —— 同一处的三种按法（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 2.1 节）——
// 点一下就松（tap、write）、按下就滑（span、line：拉括号、拉线）、按住 0.35 秒托起来再拖（drop-on、drop-at：拖到上面、拖到空处）。
// 同一样东西的同一处按法不一样的能一起开（句子上又拉括号又折又挪），按法一样的抢同一下手指，第二项当场报（scene.js 的 open）
export const PRESS_OF = { tap: 'tap', write: 'tap', span: 'slide', line: 'slide', 'drop-on': 'hold', 'drop-at': 'hold' };
/** 按住多久算托起来（iOS 拖东西的手感） */
export const HOLD_MS = 350;
/** 给老师看的按法（舞台现状、open 冲突的报错） */
export const PRESS_TEXT = { tap: '点', slide: '滑', hold: '按住再拖' };
/** 不走手势表的几种（affords：拖、矩阵的拨格子、点乘积看怎么算）的按法：拖要按住再拖，拨、点开看是点 */
export const AFFORD_PRESS = { drag: 'hold', edit: 'tap', explain: 'tap' };

/**
 * 这一下按的是哪一种：presses 是这一处开着的几种按法（tap / slide / hold；写手势的名字 span、drop-at 也认），
 * moved 是挪过了（过了点的那几个像素）、ms 是从按下到这一刻（挪了的那一刻、到了 HOLD_MS 的那一刻、松手的那一刻）、up 是松手了。
 * 返回 'tap' | 'slide' | 'hold'，'none' 是作罢（这一下什么都不交、不留半截的拖），null 只表示还在等。定下以后不再变：
 * 画面在第一个定得下的时刻（挪了、到了 HOLD_MS、松手）问一次，拿到不是 null 就不再问。
 *   只有一种：点要松手前没挪（挪了是作罢）；滑、按住再拖照第一轮按下就是它（拉括号点一下松手是拉一个词）。
 *   好几种：没挪、不到 HOLD_MS 就松手——有点就是点；不到 HOLD_MS 就挪了——有滑就是滑；到了 HOLD_MS 还没挪——有按住再拖就是它，
 *   之后挪就拖它；没有就等松手，照点算（挪了是作罢）
 */
export function choosePress(presses = [], { moved = false, ms = 0, up = false } = {}) {
  const ks = new Set([].concat(presses || []).map((k) => PRESS_OF[k] || k).filter((k) => PRESS_TEXT[k]));
  if (!ks.size) return 'none';
  if (ks.size === 1) {
    const [k] = ks;
    if (k !== 'tap') return k;
    return moved ? 'none' : up ? 'tap' : null;
  }
  const held = ms >= HOLD_MS;
  if (moved) return held ? (ks.has('hold') ? 'hold' : 'none') : ks.has('slide') ? 'slide' : 'none';
  if (held && ks.has('hold')) return 'hold';
  if (up) return ks.has('tap') ? 'tap' : 'none';
  return null;
}

/** 写的值规整成指令里的写法：键盘上的减号（−）、全角斜线 */
export function normValue(v) {
  if (v == null) return v;
  return String(v).trim().replace(/[−–—]/g, '-').replace(/／/g, '/');
}

/**
 * 一下手势 → 一行学生指令：{ act, src } | { error }。
 * e 是场景里 open 的那一项（scene.opens 的值：{ obj, action, gesture, … }）；from / to 是部件（scene.parts 给的）或
 * 那种东西自己认的写法（{ row: 3 }、{ label: 3 }、{ slot: { parent, side } }、{ tree }、整张矩阵 { obj, whole: true }）；value 是写的值、托盘里的数；role 是点的成分
 */
export function gestureAct(scene, e, { from, to, value, role } = {}) {
  const o = scene?.objects?.get(e?.obj);
  if (!o) return { error: `舞台上没有「${e?.obj ?? ''}」` };
  const g = e.gesture || gestureOf(o, e.action);
  if (typeof g?.toAct !== 'function') return { error: `${o.id} 的 ${e.action} 不是通用手势` };
  let r;
  // scene 也交给它：整张拖到另一张上（矩阵的 put）要看落的那一张是不是收集用的
  // open：这一项是怎么开的（表的 edit：键盘、输入框还是一排选项，写的值照它查）
  try { r = g.toAct(o, { from, to, value: normValue(value), role, scene, open: e }); } catch (err) { return { error: err?.message || String(err) }; }
  // quiet：不算一次尝试（放回原处、没点到东西），不用告诉老师
  if (r?.error) return { error: r.error, ...(r.quiet ? { quiet: true } : {}) };
  if (!r?.src) return { error: '这一下翻不成一行指令' };
  return { act: r.act, src: r.src };
}

/**
 * 手势层当场弹回的那一下（翻不成一行指令：这个世界做不到——没有右孩子转不了、空格子拖不动、跨泳道）写成一句给老师
 * （底座第二轮留下的第 2 条：以前只在学生那边浮一句，叫老师时没有这一下，老师不知道学生想过这么做）。
 * 不算尝试的（r.quiet：放回原处）是 null。舞台交给课堂的 onNote：跟着下一条走，不单独叫老师
 */
export function bounceText(scene, e, ctx = {}, r = {}) {
  if (!r?.error || r.quiet) return null;
  const o = scene?.objects?.get(e?.obj);
  if (!o) return null;
  const name = (p) => {
    if (!p || p.obj == null || p.key == null) return '';
    let ref = '';
    try { const q = scene.partOf(p.obj, p.key); ref = q ? scene.tapRef(q) : ''; } catch { ref = ''; }
    if (!ref) return '';
    const v = p.value === '' ? '空格子' : p.value;
    return `${ref}${v != null && String(v) !== '' ? `（${v}）` : ''}`;
  };
  const a = name(ctx.from), b = name(ctx.to);
  const how = a && b ? `按住 ${a} 放到 ${b}` : a ? `在 ${a} 上` : b ? `在 ${b} 上` : '';
  return `学生想在 ${o.id} 上 ${e.action}${how ? `（${how}）` : ''}：页面没让做——${r.error}`;
}

/**
 * 这一下放下以后要不要先问一个值：{ input: 'keypad', prompt, hint? }（数字键盘）、{ pick, choices: [{ value, text, paint? }] }（点一个）或 null。
 * write 总是要写一个值；span 的手势表写了 pick 就要点一个（句子的成分）；别的看手势表的 ask（矩阵：倍加、倍乘要倍数，对调不用）
 */
export function askFor(g, o, kind, ctx = {}, e = null) {
  if (!g) return null;
  // e：这一项是怎么开的（open T edit input=text / choices="…"：问法跟着它）
  const own = typeof g.ask === 'function' ? g.ask(o, { kind, ...ctx, open: e }) : null;
  if (kind === 'write') return own || { input: 'keypad', prompt: '写一个数' };
  if (kind === 'span' && g.pick) return { pick: g.pick, choices: typeof g.choices === 'function' ? g.choices(o, ctx) : [] };
  return own || null;
}

/**
 * 照这一行学生指令，裁判会不会拦下，拿 scene 现在的样子问：null 是不拦；{ impossible, why }：impossible 是这个世界做不到
 * （legal: false，why 是规则说的为什么），不然是老师写的 wrong=block 拦下（走偏了；为什么不说）。问不成算不拦（松手以后照旧以裁判为准）
 */
export function blockOf(scene, e, src) {
  try {
    const [c] = parseScript(src);
    const j = scene?.judgeLine?.(c, { by: 'student', open: e?.action });
    if (!j || j.apply) return null;
    const impossible = j.verdict?.legal === false;
    return { impossible, why: impossible ? j.verdict.why || '这一下做不到' : '' };
  } catch { return null; }
}
/** 裁判会不会拦下（不管为什么）：放下的那一刻定拎着的那一份飞不飞回去 */
export const wouldBlock = (scene, e, src) => !!blockOf(scene, e, src);
/**
 * 拖着的这一下放在一个落点上会怎样，拿现在的舞台问（拖起来以后舞台还会变：前一下还在演、预写在演、老师插了一个数）：
 * { ask, r, why, blocked, impossible }。ask 是放下以后先问一个值（倍数框：这时还判不了，照旧能放）；r 是 gestureAct 翻成的那一行或 { error }；
 * blocked 是裁判会拦下，impossible 是其中这个世界做不到的（legal: false）；why 是放不下的那一句（翻不成指令的照手势说，做不到的照规则说）。
 * 悬停只标翻不成、做不到的：老师写的 wrong=block 拦下的悬上去照常（不然学生悬一遍就知道哪一下是对的，是页面替老师做了教学决定），
 * 放下以后才弹回去。只给画面用；松手以后照旧以裁判为准
 */
export function dropVerdict(scene, e, ctx = {}, kind) {
  const o = scene?.objects?.get(e?.obj);
  const ask = askFor(e?.gesture || gestureOf(o, e?.action), o, kind, ctx, e);
  if (ask) return { ask, r: null, why: '', blocked: false, impossible: false };
  const r = gestureAct(scene, e, ctx);
  if (r.error) return { ask: null, r, why: r.error, blocked: false, impossible: false };
  const b = blockOf(scene, e, r.src);
  return { ask: null, r, why: b?.impossible ? b.why : '', blocked: !!b, impossible: !!b?.impossible };
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
 * 手势表那一项要抓的「地方|按法」（'part|slide'、'bracket|hold'）：拖、拉的起点（from），点、写的地方（tap / on），按法照 PRESS_OF。
 * 拖到哪儿（to）不算：落点不抢手指；✕（close）是自己的把手，也不算。
 * 两项 open 抓同一种地方、按法又一样，同一处按下去只拿得到先挂的那一个，后开的那一项就没声没息地用不了——场景当场报（scene.js 的 open）；
 * 按法不一样的画面照 choosePress 分开
 */
export function gestureGrabs(g) {
  const out = new Set();
  const add = (n, press) => { for (const x of [].concat(n || [])) out.add(`${PART_GRIPS.has(x) ? 'part' : x}|${press}`); };
  for (const k of kindsOf(g)) {
    const press = PRESS_OF[k];
    if (!press) continue;
    if (k === 'tap') add(g.tap || g.on, press);
    else if (k === 'write') add(g.on, press);
    else add(g.from, press);
  }
  return out;
}
/**
 * open 的一项抓的「地方|按法」：手势表里的照 gestureGrabs；不走手势表的（affords 里的拖、拨格子、点开看，写了 input=keypad 的
 * edit 走手势表的 write）抓部件，按法照 AFFORD_PRESS。affords 是那种东西能开的（scene.js 的 affordsOf）；「回到……」按钮不抓舞台上的东西
 */
export function openGrabs(e, affords = {}) {
  if (!e) return new Set();
  if (e.action === 'drag' || (affords[e.action] && !e.input)) return new Set([`part|${AFFORD_PRESS[e.action] || 'hold'}`]);
  return gestureGrabs(e.gesture);
}
/** 「地方|按法」拆开 */
export const placeOf = (grab) => String(grab).slice(0, String(grab).lastIndexOf('|'));
export const pressOf = (grab) => String(grab).slice(String(grab).lastIndexOf('|') + 1);
/**
 * 两项 open（抓的「地方|按法」A、B）碰在哪：same 是同一处、同一种按法（抢同一下手指，第二项当场报），mixed 是同一处、按法不一样
 * （能一起开，画面照 choosePress 分，现状合成一行）。meet() 说两项写的部件重不重叠：只对部件问（写的部件不重叠就碰不到）
 */
export function grabClash(A, B, meet = () => true) {
  const same = new Set(), mixed = new Set();
  for (const a of A) {
    for (const b of B) {
      if (placeOf(a) !== placeOf(b) || (placeOf(a) === 'part' && !meet())) continue;
      (pressOf(a) === pressOf(b) ? same : mixed).add(a);
    }
  }
  return { same: [...same], mixed: [...mixed] };
}

/**
 * 点学生做的东西头上的 ✕（学生拉的括号、连的线）→ 一行学生指令：{ act, src } | { error }。照手势表那一项的 close.toAct 翻
 * （句子的 mark 收括号 = unmark s.2-5，refer 收线 = unrefer s.23）。e 是 open 的那一项：开着 mark 才收得了括号、开着 refer 才收得了线；
 * from 是 ✕ 交的（{ mark: 括号 id }、{ refer: 线的 from 的 key }）。老师画的收不了（toAct 说）
 */
export function closeAct(scene, e, { from } = {}) {
  const o = scene?.objects?.get(e?.obj);
  if (!o) return { error: `舞台上没有「${e?.obj ?? ''}」` };
  const g = e.gesture || gestureOf(o, e.action);
  if (typeof g?.close?.toAct !== 'function') return { error: `${o.id} 的 ${e.action} 没有 ✕（学生拉出来的括号、连的线才收得掉）` };
  let r;
  try { r = g.close.toAct(o, { from }); } catch (err) { return { error: err?.message || String(err) }; }
  if (r?.error) return { error: r.error };
  if (!r?.src) return { error: '这一下翻不成一行指令' };
  return { act: r.act, src: r.src };
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
