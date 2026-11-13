// 舞台的场景（docs/stage-plan.md）：舞台上有什么、在哪、什么颜色、连着谁、贴着什么字、拨数是几、在等学生做什么——
// 全是数据，不碰 DOM。纯函数 / 纯数据，有测试（tests/stage-scene.test.js）。
//
// 一行镜头指令先 check（写错了当场挡下，告诉老师哪里错，别的行照演），再 apply（改场景）；
// 画面（stage.js）只负责把场景的变化演出来。所以：
// - 老师边写边演时，每一行先在场景上试，不会把画面演坏；
// - 刷新、作废一轮：照记录（每一行指令，连学生拖、拨造成的变化）在新场景上重放一遍就回到原样；
// - 告诉老师「舞台上现在有什么」（stateText）是照场景写的，和画面一定对得上。
//
// 舞台上的东西分几种（一排格子、树、图、矩阵、平面、句子、式子……），每一种是 types/ 下的一个模块：
// 怎么造、部件怎么写（a.3 / t.A / m.2,3）、部件在哪、自己的指令（swap / insert / rowop……）、给老师看的现状。
// 这里只管各种东西共用的：点亮、染色、连线、贴字、拨数、镜头、说话、等学生。
import { QID_RE } from '../exam/fields.js';
import { parseScript, parseRef, parseRich, addCommands, OPTIONS, optionError } from './script.js';
import { TYPES, typeOf, CREATE } from './types/index.js';
import { bbox, columnSlot, cameraRoom } from './layout.js';
import { parseAt, COLS } from './compose/grid.js';
// numOf：数（整数、小数、分数 -3/4，′ 和真的减号也认），比大小用；和挑战判数是同一个
import { splitPicks, checkPick, varText, pickDeps, wordDialError, VERB, verbFact } from './pick.js';
import { parseGoal, parseWhen, evalGoal, evalWhen, altsOf, goalStatus, checkPreds, clauseKey, clauseMarks, sameMeasure, numOf, isExpr, exprMeasure } from './goal.js';
import { checkSpec } from './answer.js';
import { parseLive, evalLive, fillLine, liveOrder, termText } from './value.js';
import { rulesOf, done as nextDone, checkMeasure, measureLine, changedKeys, parseMeasure } from './rules.js';
import { followOf, followNames, startFollow, refreshFollow, followLine } from './follow.js';
import { judge } from './referee.js';
import { openGrabs, grabClash, placeOf, pressOf, PRESS_TEXT, ARMED_PRESS, armable, idleOf } from './gestures.js';

export const COLORS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
/** 扫一遍拨数：能拨到的值超过这么多就不扫（现状里只说一句太多，不让每一轮的现状变长、算得太久） */
export const SWEEP_MAX = 25;
export const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
export const OBJECT_GAP = 70; // 两样东西上下摆开隔多远
const LABEL_ROOM = 30; // 一行贴在东西上面的字，除了它自己的高还要留多少（离上面的东西、离它贴的东西各一段）
/**
 * 预写最多套几层（@g1 是第 1 层，@g1 里写出的 goal g2 的 @g2 是第 2 层……）：再多就是事先排好的一整段课，
 * 要等老师看着学生写（硬性规定：教学不预制，docs/superpowers/specs/2026-11-08-stage-base-2-design.md 6.1）
 */
export const PREWRITE_DEPTH = 3;
// 话里的 {名字}：光秃秃的一个名字（checkRich 查它是不是拨数、舞台上的东西）
const BARE_NAME = /^[A-Za-z_]\w*$/;
/** @ask.right 跟着的那一问页面判不了对错（或者没有那一问）时报的话 */
export const ASK_RIGHT_ERROR = '@ask.right 要跟着一个页面判得了对错的 ask';
/** 这一问页面判不判得了对错：点（写了 expect=）、点几样（写了 expect=）、填一个答案（写了 answer=） */
export const judgeable = (w) => !!w && ((w.kind === 'tap' && !!w.expect) || (w.kind === 'pick' && !!w.expect?.length) || (w.kind === 'value' && w.answer != null && w.answer !== ''));
/** 一组预写在什么时候演（套着的预写写给老师「g1 做到时才出」）：g1 → g1 做到，t.done → t 做完，ask.right#N → 学生答对那一问 */
function groupText(k) {
  const [id, kind] = String(k).split('.');
  return kind == null ? `${id} 做到` : id === 'ask' ? '学生答对那一问' : kind === 'done' ? `${id} 做完` : `学生在 ${id} 上做对一步`;
}
/** 一行预写里写出的挑战名（goal g2 "…" when=…）；不是 goal 那一行是 null */
const goalIdIn = (src) => String(src ?? '').trim().match(/^goal\s+([A-Za-z_]\w*)/)?.[1] || null;
const isColor = (w) => COLORS.includes(w);
const prime = (v) => String(v).replace(/[′']/g, '').replace(/[−–]/g, '-').trim();

/** 拨数的范围：1..5、-3..3、1-5（老写法）；读不懂给 [NaN, NaN] */
export function parseRange(r) {
  const m = String(r).trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:\.\.|~|～|-)\s*(-?\d+(?:\.\d+)?)$/);
  return m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
}

// 每种东西自己的指令也认（script.js 读一行时按这个判断是不是指令）
addCommands([...Object.keys(CREATE), ...Object.values(TYPES).flatMap((t) => Object.keys(t.commands || {}))]);

/** 两个值比大小（49′ 和 49 一样大）：-1 / 0 / 1；数比数，别的按字 */
export function compareValues(a, b) {
  const x = numOf(a), y = numOf(b);
  if (x != null && y != null) return x < y ? -1 : x > y ? 1 : 0;
  const s = prime(a), t = prime(b);
  return s < t ? -1 : s > t ? 1 : 0;
}

/**
 * 扣着的部件（cover）写成它在哪，不写值：学生看的小块（话里的 {a.3}、贴的字、比大小的牌子）照它写，扣着的常常就是要学生猜的。
 * 题卡的一行自己交 coverLabel（「第 3 行」）；别的照那种东西交的 coverName（一排格子「第 3 格」、矩阵「M 第 2 行第 3 列」、
 * 句子「第 3 个词」、树「t 里扣着的一个结点」……）；没交的、不知道是哪样东西的写「名字 里扣着的一个」。o 是部件所在的那样东西
 */
export function coverText(p, o = null) {
  if (p.coverLabel != null) return p.coverLabel;
  let name = null;
  try { name = o ? typeOf(o).coverName?.(p, o) : null; } catch { name = null; }
  return name || `${p.obj} 里扣着的一个`;
}
/** 一个部件画成学生看的小块写什么：label，没有就 value、key；扣着的写它在哪（coverText），不写值 */
export const chipTextOf = (p, o = null) => String(p.covered ? coverText(p, o) : p.label ?? p.value ?? p.key);
/**
 * 写给老师的那个字（学生点了哪一个、点过的几样变没变）：它的字；扣着的后面说一声「，扣着」（老师知道里面是几）。
 * 题卡扣着的一行照旧写「第 3 行，扣着」（一行常常是一整句答案，写给老师也不整句抄）
 */
export const tapValueOf = (p) => {
  const v = String(p.label ?? p.value ?? p.key);
  if (!p.covered) return v;
  return `${p.coverLabel != null ? p.coverLabel : v}，扣着`;
};

/** 一个部件在场景里的编号（画面用它找节点、话里的小块用它找部件）：'a:3'、't:A' */
export const pidOf = (p) => `${p.obj}:${p.key}`;

/** 这一行的原文（跟着算的东西记着它；行首的 & 不要） */
const lineOf = (c) => String(c.src ?? '').trim().replace(/^&\s*/, '');
/** 整样东西挪一挪（另起一列、show 摆回来）：origin 是左上角（x），式子是横着的中线（cx）；别的位置都跟着 origin 算 */
function shiftObject(o, dx, dy) {
  const g = { ...o.origin };
  if ('cx' in g) g.cx += dx; else g.x += dx;
  g.y += dy;
  o.origin = g;
}
const samePlace = (a, b) => !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);
/** 藏着的东西学生看不见、点不到：写下时报的话，现状里补的一句 */
const hiddenError = (ids) => `${ids.join('、')} 藏着，学生看不见：先 show ${ids.join(' ')}`;
const hiddenNote = (ids) => (ids.length ? `（${ids.join('、')} 藏着，学生点不到）` : '');
/** 造东西时的 hide=：on 藏着（照样算、现状照样写，画面上不摆），off 摆出来；不写的新东西摆着，同名重造照旧（留在原处） */
function hiddenOf(opts, old) {
  if (opts.hide == null) return !!old?.hidden;
  if (opts.hide !== 'on' && opts.hide !== 'off') throw new Error(`hide= 只能写 on（藏着：照样算、画面上不摆）或 off，没有「${opts.hide}」`);
  return opts.hide === 'on';
}

/** 一种东西能开放给学生直接动的：{ 动作: 给老师看的一句 } */
export function affordsOf(t) {
  return { ...(t.drag ? { drag: '拖' } : {}), ...(t.affords || {}) };
}

// 手势表里的动作（rules.js 的 gestures：rotate、rowop、mark……）给老师看的一句：按五种通用手势说
const GESTURE_TEXT = { tap: '点', 'drop-on': '拖到上面', 'drop-at': '拖到空处', span: '拉一段', line: '拉一条线', write: '写一个值' };
// 手势表自己写了 brief 的照它说（一排格子的 move：「拖到空处」说不清是对调还是插进去）
const gestureText = (g) => g?.brief || [].concat(g?.gesture || []).map((k) => GESTURE_TEXT[k] || k).join(' / ');
/** open 那一行老师事先定的：走偏了怎么办（wrong）、什么时候叫老师（call）、学生能不能撤一步（undo）。默认照做、只记下 */
const POLICY = {
  wrong: { quiet: '照做、只记下', mark: '照做、淡淡圈一下', block: '不让做、弹回去' },
  call: { wrong: '一走偏就叫你', done: '做完才叫你' },
  undo: { on: '学生能撤一步', off: '不能撤' },
};
const DEFAULT_POLICY = { wrong: 'quiet', call: null, undo: false };
// wrong= / call= 只对页面判对错的动作（规则的 judges）起作用：写在别的动作上（拨格子、拖、折起来）永远不生效，当场报，不默默收下
function policyIn(opts, rules, { label, id, action }) {
  for (const k of ['wrong', 'call', 'undo']) {
    if (opts[k] == null) continue;
    const ok = POLICY[k];
    if (!ok[opts[k]]) throw new Error(`${k}= 只能写 ${Object.keys(ok).join(' ')} 里的一个（${Object.entries(ok).map(([v, t]) => `${v} ${t}`).join('；')}），没有「${opts[k]}」`);
  }
  const judges = rules?.judges || [];
  if ((opts.wrong != null || opts.call != null) && !judges.includes(action)) {
    throw new Error(`${label}的 ${action} 页面判不了对错（${judges.length ? `判对错的是 ${judges.map((a) => `open ${id} ${a}`).join(' / ')}` : '没有规则'}），wrong= / call= 用不上：去掉它们再写`);
  }
  return { wrong: opts.wrong || DEFAULT_POLICY.wrong, call: opts.call || DEFAULT_POLICY.call, undo: opts.undo === 'on' };
}
/** 不是默认的那几项，照老师的写法写出来（舞台现状里给老师看） */
const policyText = (p) => (p ? [p.wrong !== 'quiet' ? `wrong=${p.wrong}` : '', p.call ? `call=${p.call}` : '', p.undo ? 'undo=on' : ''].filter(Boolean).join('、') : '');

const minus = (v) => String(v).replace(/-/g, '−');
/**
 * 学生能拨到的值（从小到大）：舞台上的拨数器一下 ±1、碰到两头停在头上（stage.js 的 dialNode），所以是从现在的值、从两头一格一格数过去的那几个。
 * 超过 SWEEP_MAX 个是 null
 */
function dialValues({ v, lo, hi }) {
  if (!(hi - lo <= SWEEP_MAX * 3)) return null;
  const vals = new Set([lo, hi]);
  for (const [start, step] of [[v, 1], [v, -1], [lo, 1], [hi, -1]]) for (let k = 0; ; k++) { const t = start + step * k; if (t < lo || t > hi) break; vals.add(t); }
  return vals.size > SWEEP_MAX ? null : [...vals].sort((a, b) => a - b);
}
// 「都是」「别的」后面空不空一格：中文接着写（别的唯一解），字母、数字开头的隔一格（别的 r = 2）
const spaced = (b) => (/^[A-Za-z0-9(]/.test(b) ? ` ${b}` : b);
/**
 * 扫一遍拨数写成一行（舞台现状里拨数那一行后面）：拨 l（−3～3）时 M：l = −1 无解（…）；l = 1 无穷多解（1 个自由变量）；别的唯一解。
 * 挨着的值要点一样并成一段（l = 2～3），值最多的那一种写成「别的…」，只有一种写「都是…」；算不出来的值写「算不出来」。
 * list 是 null（或者比 SWEEP_MAX 多）：能拨的值太多，没扫
 */
export function sweepLine(name, { lo, hi }, id, list) {
  if (!list || list.length > SWEEP_MAX) return `${name} 能拨的值太多，页面没扫`;
  const head = `拨 ${name}（${minus(lo)}～${minus(hi)}）时 ${id}`;
  const said = list.map((x) => ({ v: x.v, b: x.brief ?? '算不出来' }));
  const count = new Map();
  for (const x of said) count.set(x.b, (count.get(x.b) || 0) + 1);
  if (count.size <= 1) return `${head} 都是${spaced(said[0]?.b ?? '算不出来')}`;
  let most = null;
  for (const [b, n] of count) if (most == null || n > count.get(most)) most = b;
  const runs = [];
  for (const x of said) {
    const r = runs.at(-1);
    if (r && r.b === x.b) r.to = x.v; else runs.push({ b: x.b, from: x.v, to: x.v });
  }
  const at = (r) => `${name} = ${minus(r.from)}${r.to !== r.from ? `～${minus(r.to)}` : ''}`;
  return `${head}：${[...runs.filter((r) => r.b !== most).map((r) => `${at(r)} ${r.b}`), `别的${spaced(most)}`].join('；')}`;
}

// —— 存档点（keep / back，docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 7 节）：只管一样东西 ——
/** 一样东西最多存几个名字（同名的换掉；页面替老师存的 after= 也算一个） */
export const KEEP_MAX = 6;
/**
 * 回去时照现在留着、不倒回的：位置、身份，和老师、画面当时挂出来的样子——藏着、另起的那一列、画面量出来的大小、
 * 开着的子树高 / 平衡因子 / 句尾的数、树的排法（和 origin 是一对：排法换了 origin 的意思就变了）。
 * 它们不是这样东西的数据：倒回去会把存档以后老师挂上的一起撤掉
 */
// follow（照引擎走）也是老师挂上去的：回去以后照旧照着走（每一行之后 refreshFollow 照现在的样子重新看到了哪）
const AS_IS = ['origin', 'id', 'type', 'hidden', 'colStart', 'ext', 'heights', 'tally', 'bf', 'layout', 'follow'];
/** 部件上照 key 留着现在的：学生点着的圈（ask pick）、走偏的那一下淡淡圈着的 */
const PART_AS_IS = ['pick', 'slip'];
/** 存下一样东西现在的样子（存档、学生每一下之前）：整份拷一份，位置不要（回去时照现在的位置） */
export function snapOf(o) {
  const { origin, ...rest } = o;
  void origin;
  return structuredClone(rest);
}
/**
 * 一样东西回到存着的样子：只换数据（结构、值、托盘、染色、角上的字……），AS_IS 的照现在留着，部件上的圈照 key 留着现在的
 * （存档里没有的部件就没了）。在原地改：还是同一样东西
 */
export function restoreSnap(o, snap) {
  const t = typeOf(o);
  const now = Object.fromEntries(AS_IS.filter((k) => k in o).map((k) => [k, o[k]]));
  const marks = new Map(t.parts(o).map((p) => [p.key, PART_AS_IS.filter((f) => f in p).map((f) => [f, p[f]])]));
  for (const k of Object.keys(o)) delete o[k];
  Object.assign(o, structuredClone(snap));
  for (const k of AS_IS) delete o[k];
  Object.assign(o, now);
  for (const p of t.parts(o)) {
    for (const f of PART_AS_IS) delete p[f];
    for (const [f, v] of marks.get(p.key) || []) p[f] = v;
  }
  return o;
}

export class Scene {
  constructor() {
    this.objects = new Map(); // id → { type, id, origin, …（各种东西自己的数据） }
    this.links = new Map(); // key → { key, a: { obj, key }, b: { obj, key }, color, tier }
    this.labels = new Map(); // id → { id, refs, text, side, tone, link }
    this.vars = new Map(); // name → { v, lo, hi, at, shown }
    this.binds = []; // { kind, obj, v }：跟着拨的数变的
    this.focus = null; // null = 全部；或者部件的写法
    // 构图意图（第八轮）：老师写的 place / say near= 存成关系，id → [rel]（rel 的样子见 compose/solve.js）；'say' 是这一轮的话
    this.layout = new Map();
    this.say = '';
    this.words = []; // 这一句话里能飞走的 [词]
    this.waiting = null; // { kind, refs, prompt, button, expect, answer, pre（预写的行挂的：课堂循环看学生手上还有没有事用）, exam / like（真题题号）, shownAt }
    // 考情第 4 批：课堂读到这门课的考试资料以后挂上（exam/fields.js 的 examCheckOf），exam= / like= 写了库里没有、留作模考的当场报
    this.examCheck = null;
    // —— 活的舞台（E 段）：学生随时能直接动的、挑战、挑战做到了马上演的 ——
    this.opens = new Map(); // 'B:edit' → { obj, action, refs, lo, hi }：开放给学生直接动的
    this.goals = new Map(); // id → { id, text, when, alts, cond（各组摊平）, met, call, on, collect }
    this.reactions = new Map(); // 挑战 id → [行]：做到了的那一刻页面马上演（老师预写的确认和下一小问）
    // 套着的预写（@g1 goal g2 …、@g2 …）：g2 还没有，它做到时演的行先记在这里，g1 做到、演出 goal g2 那一刻挪进 reactions。
    // from 是写出 goal g2 的那一组预写（g1、t.done、ask.right 或者另一个还没有的挑战），depth 是 @g2 的行是第几层
    this.ahead = new Map(); // 挑战 id → { lines, depth, from }
    this.askRight = null; // @ask.right 的行：下一个 ask 拿走（waiting.right），学生答对那一问时页面马上演
    // 拿走 @ask.right 的那一问记一个编号（waiting.rightKey = ask.right#N）：它里面套着的预写（ahead 的 from）跟着这一问，
    // 这一问没答对就收尾、整组拿掉，不和下一问的 @ask.right 混在一起
    this.askSeq = 0;
    // @ask.right 跟着写在预写里的那一问（@ask.right say "对"、@g1 ask tap c … expect=c.1：第三次量 E3/幕3）：
    // 一组预写（g1、t.done、t.right）→ { lines, key（ask.right#N）, at（那一问是这一组的第几行）}；那一组演出来、那一问挂上时拿走
    this.preRight = new Map();
    // 话里光秃秃的一个名字现在还不是拨数、也不是舞台上的东西（{Xi} 写在造 Xi 之前，或者拼错了的 {kk}）：这一轮演完再看（looseProblems）
    this.loose = []; // [{ name, line, src }]
    this.notices = []; // 照演了、可要告诉老师一声的（[{ line, src, error, kept: true }]）：一轮演完和 loose 一起交（looseProblems）
    this.labelRects = []; // 贴的字画在哪（stage.js 量了写回）：[{ x, y, w, h, objs }]，摆东西时后造的东西让开（reflow）
    // —— 裁判（referee.js）接进来以后 ——
    this.slips = new Map(); // 东西 id → { refs, src }：学生走偏的那一下淡淡圈着（open … wrong=mark），那样东西下一次变了就收掉
    this.doneState = new Map(); // 东西 id → 上一行以后做没做完（rules.js 的 done）：从没做完变成做完的那一行才算「学生做完了」
    // —— 画面写回的（stage.js 量了写回，和 labelRects 一样）——
    this.view = null; // 屏幕多大 { w, h }：摆新东西时看往下摆会不会缩得太小、要不要另起一列（不知道就照旧往下摆）
    this.clipped = []; // 镜头摆好以后还出了屏幕的东西（id）：舞台现状里告诉老师「画面上看不全」
    this.tiny = null; // 整台缩得太小、字难认时：缩到了几成（stage.js 的 noteClipped 写回；layout.js 的 TINY_SCALE）
    // —— 一次点几样（ask pick 交的那一下，pick 那一行）——
    this.picked = null; // { obj, keys, refs, reveal, diffDone, changed? }：学生点着的几样（圈着，老师下一轮演完收掉）；changed 是之后第一次变时变了的 key
    // —— 存档点（keep / back）：只管一样东西的数据，都是 log 里的行引出来的，重放照样回来 ——
    this.keeps = new Map(); // 东西 id → Map(名字 → 那一刻的样子 snapOf)：keep t "插入后" 存，back t "插入后" 回去
    this.autoKeep = new Map(); // 东西 id → Map(名字 → 动作)：keep t "插入后" after=insert，学生每做完一次 insert 页面存成「插入后」
    this.lastBefore = new Map(); // 东西 id → 学生最后那一下之前它的样子（snapOf）：back t 回到那里，隔着老师的一轮也行
    // —— 拨数要挂在还没造的东西上（dial k … at=M 写在 matrix M = … {k} 之前）——
    this.dialAt = new Map(); // 拨数的名字 → 要挂上的东西 id：先记着，那样东西第一次造出来时挂上（同名重造不再挂）
    // 东西做完时的预写（@t.done）一组只演一次：演过了（played）、老师那一轮让它做完时拿掉了（dropped）记在这里。
    // 学生按「回到……」再做完一次时照实告诉老师，不说「你没预写做完以后的行」（最后一审 M2）
    this.spentDone = new Map(); // 东西 id → 'played' | 'dropped'
  }

  clone() {
    const s = new Scene();
    s.examCheck = this.examCheck;
    for (const [k, o] of this.objects) s.objects.set(k, structuredClone(o));
    for (const [k, l] of this.links) s.links.set(k, { ...l, a: { ...l.a }, b: { ...l.b } });
    for (const [k, l] of this.labels) s.labels.set(k, { ...l, refs: [...l.refs] });
    for (const [k, v] of this.vars) s.vars.set(k, { ...v });
    s.binds = this.binds.map((b) => ({ ...b }));
    s.focus = this.focus ? [...this.focus] : null;
    s.layoutInfo = this.layoutInfo ? [...this.layoutInfo] : null;
    s.layout = new Map([...this.layout].map(([k, rs]) => [k, rs.map((r) => ({ ...r, ...(Array.isArray(r.a) ? { a: [...r.a] } : {}) }))]));
    s.say = this.say;
    s.words = [...this.words];
    // ask pick 的 refs、expect 是数组：各拷一份（改副本的不动原来的）
    s.waiting = this.waiting ? { ...this.waiting, refs: [...this.waiting.refs], ...(Array.isArray(this.waiting.expect) ? { expect: [...this.waiting.expect] } : {}), ...(this.waiting.right ? { right: [...this.waiting.right] } : {}) } : null;
    for (const [k, v] of this.opens) s.opens.set(k, { ...v, refs: [...v.refs], ...(v.policy ? { policy: { ...v.policy } } : {}) });
    for (const [k, g] of this.goals) s.goals.set(k, structuredClone(g));
    for (const [k, r] of this.reactions) s.reactions.set(k, [...r]);
    // 套着的预写、@ask.right：@g2 先过 check、预写试演都在副本上跑，副本上没有就报「先写 goal g2」
    for (const [k, a] of this.ahead) s.ahead.set(k, { ...a, lines: [...a.lines] });
    s.askRight = this.askRight ? [...this.askRight] : null;
    s.askSeq = this.askSeq;
    for (const [k, p] of this.preRight) s.preRight.set(k, { ...p, lines: [...p.lines] });
    s.loose = this.loose.map((x) => ({ ...x }));
    s.notices = structuredClone(this.notices);
    s.labelRects = this.labelRects.map((r) => ({ ...r, objs: [...r.objs] }));
    for (const [k, v] of this.slips) s.slips.set(k, { ...v, refs: [...v.refs] });
    s.doneState = new Map(this.doneState);
    // 这一轮新加的场景状态都要带上：检查、试演、抢跑都在副本上跑，少带一项就在缺东西的副本上判
    s.view = this.view ? { ...this.view } : null;
    s.clipped = [...this.clipped];
    s.tiny = this.tiny;
    s.picked = this.picked ? { ...this.picked, keys: [...this.picked.keys], refs: [...this.picked.refs], ...(this.picked.changed ? { changed: [...this.picked.changed] } : {}) } : null;
    // 存档：学生按的 back 先过 check（在副本上试），副本上没有就报「没存过」
    for (const [k, m] of this.keeps) s.keeps.set(k, new Map([...m].map(([n, v]) => [n, structuredClone(v)])));
    for (const [k, m] of this.autoKeep) s.autoKeep.set(k, new Map(m));
    for (const [k, v] of this.lastBefore) s.lastBefore.set(k, structuredClone(v));
    s.dialAt = new Map(this.dialAt);
    s.spentDone = new Map(this.spentDone);
    return s;
  }

  // —— 部件 ——
  type(o) { return typeOf(o); }
  /** 部件的写法 → 部件（按那种东西自己的顺序排好）；写错了抛错（错误的话直接给老师看） */
  parts(word) {
    const r = typeof word === 'string' ? parseRef(word) : word;
    if (!r) throw new Error(`「${word}」不是舞台上的东西`);
    const o = this.objects.get(r.obj);
    if (!o) throw new Error(`舞台上没有「${r.obj}」${this.objects.size ? `（有的是：${[...this.objects.keys()].join('、')}）` : `（先造一个：${Object.keys(CREATE).join(' / ')}）`}`);
    const t = typeOf(o);
    if (!r.mark) return t.parts(o);
    const name = typeof word === 'string' ? word : `${r.obj}${r.mark}${r.sel}`;
    // 东西在、部件找不到（空树上的 t.34）：错误上带 part。预写的行写下时碰到它跳过（演的时候也许就有了），只查写法
    try { return t.pick(o, r.mark, r.sel, name); } catch (err) { if (err && typeof err === 'object') err.part = name; throw err; }
  }
  /** 旧名字（只有一排格子的时候叫 cells） */
  cells(word) { return this.parts(word); }
  isRef(word) { const r = parseRef(word); return !!(r && this.objects.has(r.obj)); }
  /** 跟着它走的写法（a#3、t.A）：话里的小块、记录、给老师看都用它 */
  refOf(p) { return typeOf(this.objects.get(p.obj)).ref(p); }
  /** 学生点的那一个写给老师的名字：有位置的（一排格子、句子的词）写第几个（a.3，和老师写 ask、expect 的写法一样），别的照那种东西的写法 */
  tapRef(p) { return p.slot != null ? `${p.obj}.${p.slot}` : this.refOf(p); }
  partBox(p) { const o = this.objects.get(p.obj); return typeOf(o).partBox(o, p); }
  cellBox(p) { return this.partBox(p); }
  /**
   * 一样东西占的地方：那种东西自己算的（按字数估的、按格子数算的）再加上画面量出来多出去的（o.ext，stage.js 的 measure 写回）。
   * 摆东西、贴字、镜头都用这一个：估小了别的东西就会摆上来压着它（2026-11-06 题卡的字折了两行，估的只有一行，压到了下面）
   */
  objectBox(id) {
    const o = this.objects.get(id);
    const b = typeOf(o).objectBox(o);
    const e = o.ext;
    return e ? { x: b.x - e.l, y: b.y - e.t, w: b.w + e.l + e.r, h: b.h + e.t + e.b } : b;
  }
  allParts() { return [...this.objects.values()].flatMap((o) => typeOf(o).parts(o)); }
  /** 画面上摆着的东西（藏着的不算）：画、镜头、摆新东西、往下让都只看这几样；照摆上舞台的先后 */
  shownIds() { return [...this.objects.values()].filter((o) => !o.hidden).map((o) => o.id); }
  /** ask / goal 的 exam= / like=：写的得是题号；课堂挂了 examCheck 时库里没有、留作模考的当场报（重放旧课不查） */
  examOpts(opts, c = {}) {
    const out = {};
    for (const k of ['exam', 'like']) {
      if (opts[k] == null) continue;
      const v = String(opts[k]).trim();
      if (!QID_RE.test(v)) { if (c.lenient) continue; throw new Error(`${k}= 写真题的题号（像 Q-408-2019-23：「这一块在考试里」那一节列着），不是「${v}」`); }
      const why = !c.lenient && this.examCheck ? this.examCheck(v) : '';
      if (why) throw new Error(why);
      out[k] = v;
    }
    return out;
  }
  /** 这几个写法（部件、整样东西）落在哪几样藏着的东西上 */
  hiddenIn(refs) { return [...new Set(refs.map((r) => parseRef(r)?.obj).filter((id) => this.objects.get(id)?.hidden))]; }
  /** 挑战的条件里提到的舞台上的东西（M、M.1,1、rank(M)、M same B） */
  /** 拿掉几条挑战（ungoal 和 scene 共用）：连同它们的预写 */
  ungoalIds(ids) { ids.forEach((k) => { this.goals.delete(k); this.reactions.delete(k); this.dropAhead(k); }); }
  /** 收掉几张贴的字（unlabel 和 scene 共用）：拨盘的字收了拨盘就不显示；贴在收掉的那几样（拨数、别的字）上面的字一起收（主线第一轮 D1-5） */
  unlabelIds(ids) {
    const out = [...ids];
    for (const k of ids) { this.labels.delete(k); if (k.startsWith('dial:') && this.vars.get(k.slice(5))) this.vars.get(k.slice(5)).shown = false; if (k.startsWith('dial:')) this.dialAt.delete(k.slice(5)); }
    const gone = new Set(out);
    for (let more = true; more;) {
      more = false;
      for (const [k, l] of this.labels) if ((l.refs || []).some((r) => gone.has(r))) { this.labels.delete(k); out.push(k); gone.add(k); more = true; }
    }
    return out;
  }
  /**
   * 挑战做到过、它的条件里提到的东西都不在台上了（东西拿掉了，拨盘跟着它的东西一起没了）：画面上收起（主线第六轮 3.8）。
   * 只看名字：东西、拨盘都不在了才算；一个名字都没提到（写的全是数）、写的是 {式子} 的，不算（照旧挂着）。场景里的记录不动，现状照旧写「做到过」
   */
  goalGone(g) {
    if (!g?.met || !g.cond?.length) return false;
    const names = new Set();
    for (const cl of g.cond) for (const w of [cl.l, cl.r, ...(cl.args || [])]) {
      const t = String(w ?? '');
      if (t.includes('{')) return false;
      // count(t) 里的 count 是量的名字，不是东西；O、I 是零矩阵、单位阵
      for (const m of t.matchAll(/[A-Za-z_]\w*(?!\w|\s*\()/g)) if (m[0] !== 'O' && m[0] !== 'I') names.add(m[0]);
    }
    if (!names.size) return false;
    return [...names].every((n) => !this.objects.has(n) && !this.vars.has(n));
  }
  objectsIn(cond) {
    const out = new Set();
    for (const cl of cond) for (const w of [cl.l, cl.r, ...(cl.args || [])]) for (const n of String(w ?? '').match(/[A-Za-z_]\w*/g) || []) if (this.objects.has(n)) out.add(n);
    return [...out];
  }
  /**
   * 学生要动这几样东西才做得到（挑战的条件）：摆着的、不是跟着算的动得到；跟着算的看它跟着的东西（别的东西、拨数）。
   * 一样都动不到、又是因为有东西藏着：交出藏着的那几样（写下时报、现状里说）；动得到、或者和藏着无关：[]。
   * 藏着的参照（M same R，R 是藏着的答案）不碍事：学生动的是 M
   */
  blockedByHidden(ids) {
    const hidden = new Set(), seen = new Set();
    const reach = (id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      const o = this.objects.get(id);
      if (!o) return !!this.vars.get(id)?.shown;
      const nodes = this.nodesOf(o);
      if (!nodes.length) { if (o.hidden) hidden.add(id); return !o.hidden; }
      // 摆着的东西里只有几个部件是跟着算的（平面上 b = {J a}，a 是学生拖的）：别的部件学生动得到
      // （主线第一轮 L3-4：以前只顺着跟着算的那几个往上找，找到藏着的 J 就说「先 show J」）
      // 乘积不算：它每一格都是跟着两个因子算的（它只有一个依赖结、却有好几格）
      if (!o.live && !o.product && !o.hidden && typeOf(o).parts(o).length > nodes.length) return true;
      return nodes.some((n) => (n.deps || []).some((d) => reach(parseRef(d)?.obj ?? d)));
    };
    return ids.some(reach) ? [] : [...hidden];
  }
  /** 各种东西挡着的地方（贴字时让开）：格子、序号、指针、树的边……（藏着的不挡） */
  // near：贴在这样东西自己部件上的字（它有 nearObstacles 时换成那一份，见 timeline.js）
  obstacles({ near = null } = {}) {
    return [...this.objects.values()].filter((o) => !o.hidden).flatMap((o) => {
      const t = typeOf(o);
      const own = o.id === near && t.nearObstacles ? t.nearObstacles(o) : t.obstacles ? t.obstacles(o) : t.parts(o).map((p) => t.partBox(o, p));
      // 量出来多出去的那几条（估的框外面还画着东西）也挡着
      const e = o.ext, b = typeOf(o).objectBox(o);
      if (!e) return own;
      const strips = [];
      if (e.t > 0) strips.push({ x: b.x - e.l, y: b.y - e.t, w: b.w + e.l + e.r, h: e.t });
      if (e.b > 0) strips.push({ x: b.x - e.l, y: b.y + b.h, w: b.w + e.l + e.r, h: e.b });
      if (e.l > 0) strips.push({ x: b.x - e.l, y: b.y, w: e.l, h: b.h });
      if (e.r > 0) strips.push({ x: b.x + b.w, y: b.y, w: e.r, h: b.h });
      return [...own, ...strips];
    });
  }
  num(v) {
    if (/^-?\d+(\.\d+)?$/.test(String(v))) return Number(v);
    const x = this.vars.get(v);
    if (!x) throw new Error(`没有叫「${v}」的数（先用 dial 造一个）`);
    if (x.options) throw new Error(wordDialError(v, x));
    return x.v;
  }
  /** 新的一样东西放哪：画面上摆着的东西的下面，和它们居中对齐（横屏放不下另起一列由 placeFresh 再看一眼） */
  slotFor(w) {
    const ids = this.shownIds();
    if (!ids.length) return { x: 0, y: 0 };
    const b = bbox(ids.map((id) => this.objectBox(id)));
    return { x: Math.round(b.x + b.w / 2 - w / 2), y: b.y + b.h + OBJECT_GAP };
  }
  /**
   * 刚造出来、照旧往下摆的那一样（各种东西自己用 slotFor 摆的）：屏幕一横、东西一多，往下摆整块要缩得太小，右边有地方就
   * 另起一列（layout.js 的 columnSlot；比的是镜头能用的那块屏幕 cameraRoom），整样挪过去。按它造出来的真实大小看，
   * 各种东西不用各自改摆法。again：show 摆回来，照摆新东西的规矩重新摆（往下或另起一列）
   */
  placeFresh(o, { again = false } = {}) {
    const ids = this.shownIds().filter((id) => id !== o.id);
    if (!ids.length || !o.origin) return;
    const boxes = new Map(ids.map((id) => [id, this.objectBox(id)]));
    const all = bbox([...boxes.values()]);
    const me = typeOf(o).objectBox(o);
    if (!again && me.y < all.y + all.h) return; // 不是摆在下面的（beside=、和 A、B 排成一行的乘积）：不动
    // 已经另起过一列：这一列是最后一个另起的那一样和它后面摆的
    const start = ids.findLastIndex((id) => this.objects.get(id).colStart);
    const last = start < 0 ? null : ids.slice(start).map((id) => boxes.get(id));
    const s = columnSlot([...boxes.values()], me, cameraRoom(this.view), { gap: OBJECT_GAP, last });
    if (!again && !s.column) return; // 照旧往下摆：各种东西自己摆的就是
    shiftObject(o, s.x - me.x, s.y - me.y);
    if (s.start) o.colStart = true; else delete o.colStart;
  }

  // —— 检查一行：写错了返回一句话（给老师看），没错返回 null ——
  check(c) {
    if (!c.cmd) return c.error || '看不懂这一行';
    try {
      this.clone().apply(c);
      return null;
    } catch (err) {
      return err.message;
    }
  }

  // 一行里常用的几样（各种东西的指令也拿它用）
  helpers(c) {
    const { args, opts } = c;
    const words = args.filter((a) => a.t === 'word').map((a) => a.v);
    const str = args.find((a) => a.t === 'str')?.v;
    const strs = args.filter((a) => a.t === 'str').map((a) => a.v);
    const arrow = args.findIndex((a) => a.t === 'arrow');
    const refsIn = (list = args) => list.filter((a) => a.t === 'word' && this.isRef(a.v)).map((a) => a.v);
    const partsIn = (list = args) => refsIn(list).flatMap((w) => this.parts(w));
    // 写了部件却不是部件的词（多半是写错了名字）：提醒出来，不默默忽略
    const strayRefs = (list = args, allow = []) => {
      for (const a of list) if (a.t === 'word' && !this.isRef(a.v) && !allow.includes(a.v) && /^[A-Za-z_]\w*[.#]./.test(a.v)) throw new Error(`「${a.v}」不是舞台上的东西`);
    };
    // 跟着算的量（value.js）：各种东西造的时候拆 {…}、算式子用；line 是这一行的原文
    return { args, opts, words, str, strs, arrow, refsIn, partsIn, cellsIn: partsIn, strayRefs, scene: this, isColor, COLORS, parseLive, liveValue: (src, ctx) => this.liveValue(src, ctx), line: lineOf(c) };
  }
  /** 算一个 {式子}（value.js 的 evalLive）：{ value, deps }；ctx.plane 是写在哪个平面上 */
  liveValue(src, ctx) { return evalLive(src, this, ctx); }
  /**
   * 话、贴的字、挑战的字、题卡里写的：{a.2} 要真有；{count(t)} 的量名、括号里的东西要对，以后也数不了的（没写 key）当场报
   * （现在还空着的照收，画「?」）。重放旧课（lenient）不查量：以前 {f(x)} 只是原样写出来的字，当时收下的照样收下。
   * replayRefs 是假的（retext、题卡的 rewrite 以前不查 {a.2}）：重放时 {a.2} 也照旧不查
   */
  checkRich(text, c, { replayRefs = true } = {}) {
    for (const p of parseRich(text)) {
      if (p.k === 'ref') { if (replayRefs || !c?.lenient) this.parts(p.v); }
      // {t: 甲 | 乙 | 丙}：名字要是拨盘、段数要和它能拨到的个数一样（pick.js）；重放旧课不查
      else if (p.k === 'pick') { if (!c?.lenient) checkPick(p, this.vars); }
      else if (p.k === 'measure' && !c?.lenient) checkMeasure(this, p.v, { run: true });
      // 光秃秃的一个名字（{kk}）现在既不是拨数、也不是舞台上的东西：同一轮后面造出来的（say 写在 matrix Xi 前面）是对的，
      // 到这一轮演完还不是的多半是拼错了，学生看到的是「kk」两个字母（复核修正，控制者裁定）。这一行照演，记下来，一轮演完舞台问 looseProblems。
      // 预写的试演（trial）照旧当场报：它写下时就在今天的舞台上试。只管新写的行、只管一个名字；带运算的（{k + 1}）、重放旧课照旧
      // 写成 名字(东西) 可又不是量（{inv(a)}：inv 是式子里的函数，话里不现算）：学生看到的是「inv(a)」几个字母。照量的规矩当场报
      // （主线第一轮 D1-6：以前不报）
      else if (p.k === 'var' && !c?.lenient && parseMeasure(p.v) && this.objects.has(parseRef(parseMeasure(p.v).arg)?.obj)) checkMeasure(this, p.v, { run: true });
      else if (p.k === 'var' && !c?.lenient && BARE_NAME.test(p.v) && !this.vars.has(p.v) && !this.objects.has(p.v)) {
        if (this.trial) throw new Error(this.looseText(p.v));
        this.loose.push({ name: p.v, line: c?.line ?? 0, src: String(c?.src ?? '').trim() });
      }
    }
  }

  looseText(name) {
    return `「{${name}}」不是拨数，也不是舞台上的东西，学生看到的是「${name}」几个字母（${this.vars.size ? `拨数有：${[...this.vars.keys()].join('、')}` : '拨数要先写 dial'}）`;
  }
  /**
   * 这一轮话里写的光秃秃的名字，到这一轮演完还不是拨数、也不是舞台上的东西的（舞台在一轮演完时问，和 askRightProblem 一样）：
   * [{ line, src, error, kept: true }]（kept：那一行照演了，写给老师时和没演的行分开）。问完清掉
   */
  looseProblems() {
    const seen = new Set();
    const out = [];
    for (const x of this.loose) {
      const k = `${x.line}|${x.name}`;
      if (seen.has(k) || this.vars.has(x.name) || this.objects.has(x.name)) continue;
      seen.add(k);
      out.push({ line: x.line, src: x.src, error: this.looseText(x.name), kept: true });
    }
    this.loose = [];
    // 照演了、要告诉老师一声的（同名重造收掉了字和 open）
    for (const n of this.notices) {
      if (!n.remade) { out.push(n); continue; }
      const { id, labels, acts } = n.remade;
      const reopened = [...this.opens.values()].some((e) => e.obj === id);
      const bits = [labels.length ? `贴在旧部件上的字（${labels.join('、')}）` : '', acts.length && !reopened ? `交给学生的动作（${acts.join('、')}）` : ''].filter(Boolean);
      if (bits.length) out.push({ line: n.line, src: n.src, kept: true, error: `重造了 ${id}：${bits.join('、')}都收了${acts.length && !reopened ? '。要学生接着动，再写一次 open' : ''}` });
    }
    this.notices = [];
    return out;
  }

  // —— 一行指令改场景（画面怎么演由 stage.js 管）。返回这一行的要点（画面用），写错了抛错 ——
  // 每一行之后：跟着别的东西算出来的（乘积……）重算（fx.derived），挑战判一遍，刚做到的（fx.goalsMet）把预写的行交出来（fx.reactions）。
  // by（'student' | 'teacher'）：这一行是谁做的，有规则的东西上的动作先过裁判（judgeLine）——学生的不合规则、老师不让做的不演
  // （fx.blocked，舞台一点不动）；老师的照演，结论在 fx.judged 里。不给 by（检查一行、老写法、重放老师的行）就不过裁判，和以前一样。
  // 裁判在场景里：重放（刷新、作废一轮）时学生的行照样过一遍，淡淡圈着的、预写的「做对一步」用掉没有，都和当时一样
  apply(c, { by = null, open = null, judged } = {}) {
    if (c.on) return this.stash(c);
    const j = judged !== undefined ? judged : by ? this.judgeLine(c, { by, open }) : null;
    if (j && !j.apply) return { blocked: true, judged: j };
    // back t 也算动了 t（淡淡圈着的收掉；学生按的是「学生最后那一下」）
    const target = this.ownTarget(c) || (c.cmd === 'back' ? this.backTarget(c) : null);
    const student = by === 'student' || j?.by === 'student';
    // 学生的一下：这一下之前那样东西的样子（back t 回到这里，隔着老师的一轮也行）
    const prev = student && target ? snapOf(this.objects.get(target)) : null;
    const before = j?.by === 'student' && this.objects.has(j.obj) ? structuredClone(this.objects.get(j.obj)) : null; // 学生这一下以后的事实要比前后
    // 学生点过几样（ask pick）、还没变过：这一行之前那样东西的样子，之后和真变了的比（只比一次）
    const pk = this.picked && !this.picked.diffDone && this.objects.has(this.picked.obj) ? this.picked : null;
    const pkBefore = pk ? structuredClone(this.objects.get(pk.obj)) : null;
    if (target) this.unslip(target); // 那样东西又变了：上一下淡淡圈着的收掉
    // 这一行是谁做的（unlive 写给老师「你 / 学生动过它的结构」）；重放时老师的行不给 by，当老师的
    this.actor = student ? 'student' : 'teacher';
    let fx;
    try { fx = this.applyOne(c) || {}; } finally { this.actor = null; }
    // 每一行之后：要跟着场景抄一份的东西抄一份（时间轴：拨盘在场景里，各样东西现在的位置抄到它身上，框是纯函数）
    for (const o of this.objects.values()) { typeOf(o).afterLine?.(this, o); if (o.follow) refreshFollow(o, this, { student }); }
    // 老师动过的那样东西：那种东西自己记一笔老师摆出来的样子（树：这棵是不是排序树——学生之后摆错了不改这个结论，tree.js 的 afterTeacher）
    if (!student) { const touched = this.objects.get(fx.created ? fx.id : target); if (touched) typeOf(touched).afterTeacher?.(touched); }
    this.reflow();
    const derived = [...(fx.derived || []), ...this.derive()];
    if (derived.length) fx.derived = derived;
    // 跟着算的重算以后可能变大了（{A B} 多了一行、格里的数变长）：摆在下面的往下让（乘积的一格照旧不重排，和以前一样）
    if (derived.some((d) => !d.part && d.changed.length)) this.reflow();
    // 学生这一下演上了：记下之前的样子；after= 替老师存的是重算完的样子（平面上跟着算的向量也到了位）
    if (prev && this.objects.has(target)) this.studentMoved(target, prev, c, open);
    const reactions = [];
    const ruleErrors = []; // 规则自己出错（facts、next 抛了）：不拦这一行，交给画面记进出错记录（stage.js）
    if (j) {
      fx.judged = j;
      const o = this.objects.get(j.obj);
      // 这一下以后写给老师的事实（规则交的：谁转上来了、哪一行变成什么、key 里还差几段）；带上场景：from=M0 的矩阵要找 M0
      if (before && o) { try { j.after = rulesOf(o)?.facts(before, o, j.act, this) || []; } catch (err) { j.after = []; ruleErrors.push(`${typeOf(o).label}的规则写事实时出错：${err?.message || err}`); } }
      if (j.mark && o) this.slip(j.obj, c, j.act);
      // 学生做对一步：老师预写的确认、下一小问（@t.right，只演一次）
      if (j.by === 'student' && j.verdict?.right === true) reactions.push(...this.pull(`${j.obj}.right`, { right: j.obj }));
    }
    // 点了以后第一次改了那样东西（谁改的都算，跟着拨数重算的也算）：哪几个真变了，和学生先点的比（fx.pickDiff：学生的一下写进事实，
    // 老师的一下画面交给课堂记一句）。规则交的 changed 说变了哪些；点过的部件这一下没了也算变了
    if (pk && this.picked === pk && this.objects.has(pk.obj)) {
      const now = this.objects.get(pk.obj);
      const partsOf = (x) => typeOf(x).parts(x);
      let keys = [];
      try { keys = changedKeys(now, pkBefore, now, partsOf, fx); } catch (err) { ruleErrors.push(`${typeOf(now).label}的规则算这一下变了哪些时出错：${err?.message || err}`); }
      const have = new Set(partsOf(now).map((p) => p.key));
      const gone = pk.keys.filter((k) => !have.has(k));
      if (keys.length || gone.length) {
        pk.diffDone = true;
        pk.changed = [...keys, ...gone];
        fx.pickDiff = pickDiffText(this, pk, pk.changed);
        // 老师自己演的一下要不要记一句告诉老师：这一问是让学生先猜哪几个会变（没写 expect=），或者写了 reveal=on（圈要分虚实）。
        // 写了 expect= 又没要 reveal 的，交的时候已经比过了，之后的变化和它无关（主线第一轮 D1-15：以前照发，是多余的话）
        fx.pickTell = !!pk.reveal || !pk.judged;
      }
    }
    if (this.picked) this.paintPicks(); // 照新的样子重画圈（跟着算的重新造过、reveal 刚分出虚实）
    // 预写的行只在学生的一下演（第一轮留下的小问题：预写不等老师那一轮、交错着演）。老师的行（连舞台演预写的行：带 lenient、不带 replay）
    // 让挑战成立、让东西做完：预写的行拿掉不演，交 fx.unplayed（舞台告诉老师「@g1 的行没演」）；刷新重放（replay）照第一轮拿掉
    // （当时演了的行本来就在 log 里），不说
    const unplayed = [];
    const fire = (key, tag) => {
      const done = tag.done;
      if (student) {
        const out = this.pull(key, tag);
        if (done && out.length) this.spentDone.set(done, 'played');
        return out;
      }
      const lines = this.take(key);
      if (lines.length) { this.dropAhead(key); if (!c.replay) unplayed.push(key); if (done) this.spentDone.set(done, 'dropped'); }
      return [];
    };
    const got = { collected: [] };
    // 按了按钮才判的（on=）：press 那一行判的（fx.onMet）；别的每一行都判
    const met = [...(fx.onMet || []), ...this.checkGoals({ student, out: got })];
    // 收集型的 @g1 每收一张都演：里面写出的挑战（goal g2）只在第一次出，之后舞台跳过（keepGoals），不然每收一张都重写 g2、@g2 的行就没了
    const keep = (id) => (this.goals.get(id)?.collect ? { keepGoals: true } : {});
    if (met.length) {
      fx.goalsMet = met;
      reactions.push(...met.flatMap((id) => fire(id, { goal: id, ...keep(id) })));
    }
    // 收集型挑战收了一张、还没收齐：@g1 的行每次都演（只看不拿）
    const more = got.collected.filter((id) => !met.includes(id));
    if (more.length) {
      fx.collected = more;
      reactions.push(...more.flatMap((id) => this.pull(id, { goal: id, collect: true, keepGoals: true }, { peek: true })));
    }
    // 学生（或老师）这一行把交给学生做的东西做完了：@t.done 的行交出来，课堂按 by 决定叫不叫老师
    const filled = [], ruled = [];
    const fin = this.checkDone(ruleErrors, filled, ruled);
    if (ruleErrors.length) fx.ruleErrors = ruleErrors;
    if (fin.length) {
      fx.done = fin;
      if (filled.length) fx.filled = filled;
      if (filled.some((id) => ruled.includes(id))) fx.ruled = ruled;
      // @M.done 只在规则判做完时演：开着 rowop 的矩阵只是写满了、还没消完，不演
      const fin2 = fin.filter((id) => ruled.includes(id) || !filled.includes(id));
      // 这一次没有预写可演、以前演过（拿掉过）的：交出来，课堂写给老师时照实说（fire 之前看：这一次演了的会记成 played）
      const before = Object.fromEntries(fin2.filter((id) => !this.reactions.get(`${id}.done`)?.length && this.spentDone.has(id)).map((id) => [id, this.spentDone.get(id)]));
      if (Object.keys(before).length) fx.doneBefore = before;
      reactions.push(...fin2.flatMap((id) => fire(`${id}.done`, { done: id })));
    }
    if (reactions.length || met.length || more.length) fx.reactions = reactions;
    if (unplayed.length) { fx.unplayed = unplayed; if (c.prewrite) fx.unplayedBy = 'prewrite'; }
    return fx;
  }
  /** 预写的行拿出来（演一次就没了） */
  take(key) { const r = this.reactions.get(key) || []; this.reactions.delete(key); return r; }
  /**
   * 一组预写的行 → 交给舞台演的几项（tag 是每一项都带的：goal / done / right）；这一组里跟着 @ask.right 的那一问带上
   * preRight（那几行）、preRightKey（stage.js 演它时交给 ask）。peek：收集型每收一张都演（只看不拿）
   */
  pull(key, tag, { peek = false } = {}) {
    const lines = peek ? this.reactions.get(key) || [] : this.take(key);
    const pr = this.preRight.get(key);
    if (pr && !peek) this.preRight.delete(key);
    return lines.map((src, i) => ({ ...tag, src, ...(pr && i === pr.at ? { preRight: [...pr.lines], preRightKey: pr.key } : {}) }));
  }
  /** 一组预写拿掉不演了：它里面写出的挑战（goal g2）的套着的预写也不会再有用，一层层拿掉（跟着这一组里那一问的 @ask.right 也是） */
  dropAhead(from) {
    for (const [id, a] of [...this.ahead]) if (a.from === from) { this.ahead.delete(id); this.dropAhead(id); }
    const pr = this.preRight.get(from);
    if (pr) { this.preRight.delete(from); this.dropAhead(pr.key); }
  }
  /** 跟着预写里那一问的 @ask.right（ask.right#N）是哪一组预写里的；不是是 null */
  rightParent(key) { for (const [k, p] of this.preRight) if (p.key === key) return k; return null; }
  /**
   * 一组预写的行是第几层：挑战、东西上的、@ask.right 是第 1 层；还没有的挑战（ahead 里的）照写出它的那一组往下数；
   * 跟着预写里那一问的 @ask.right 比那一组深一层
   */
  levelOf(key, seen = new Set()) {
    if (seen.has(key)) return 1;
    seen.add(key);
    const a = this.ahead.get(key);
    if (a) return this.levelOf(a.from, seen) + 1;
    const up = this.rightParent(key);
    return up ? this.levelOf(up, seen) + 1 : 1;
  }
  /** 套着的预写挪了一层（g2 真有了）：每一项照写出它的那一组重算第几层 */
  relevel() { for (const [k, a] of this.ahead) a.depth = this.levelOf(k); }
  /** 哪一组预写里写出了 goal id（套着的预写记在它名下）：挑战、东西上的（t.done）、还没有的挑战、@ask.right；没有是 null */
  aheadFrom(id) {
    const has = (lines) => (lines || []).some((l) => goalIdIn(l) === id);
    for (const [k, r] of this.reactions) if (has(r)) return k;
    for (const [k, a] of this.ahead) if (k !== id && has(a.lines)) return k;
    if (has(this.askRight)) return 'ask.right';
    if (has(this.waiting?.right)) return this.waiting.rightKey || 'ask.right';
    for (const p of this.preRight.values()) if (has(p.lines)) return p.key;
    return null;
  }
  /** 这一组预写（from）下面套着的全部（一层层往下）：[[挑战 id, 那一项]] */
  aheadUnder(from) {
    const out = [];
    for (const [id, a] of this.ahead) if (a.from === from) out.push([id, a], ...this.aheadUnder(id));
    return out;
  }
  /**
   * 这一问没答对就完了（答错、判不了、学生打了字、点了按钮）：它的 @ask.right 和里面套着的预写整组拿掉
   * （不然现状一直写「挑战 g2 还没出（学生答对那一问时才出）」，下一轮同名的挑战还会被当成它）
   */
  endAsk(w) {
    if (!w) return;
    if (w.rightKey) this.dropAhead(w.rightKey);
    delete w.right;
  }
  /** 这一轮演完 @ask.right 没着落（askRightProblem）：还没被拿走的、跟着一问判不了对错的，连同里面套着的拿掉 */
  dropAskRight() {
    if (this.askRight) { this.askRight = null; this.dropAhead('ask.right'); }
    const w = this.waiting;
    if (w?.right && !judgeable(w)) this.endAsk(w);
  }
  /** 刷新重放跳过一问（ask 不重放）：它拿走的 @ask.right 连同里面套着的一并丢掉（F2） */
  skipAsk() {
    this.askRight = null;
    this.dropAhead('ask.right');
  }
  /**
   * 一轮演完时问：没做到的 on= 挑战，学生手上的这一问有没有那个按钮（ask next 不写 button 是「接着」；ask pick 的按钮是交点的几样，不算）。
   * 没有就是学生按不到、挑战永远判不了：[一句话]
   */
  onProblems({ once = false } = {}) {
    const w = this.waiting;
    const btn = !w || w.kind === 'pick' ? null : w.button || (w.kind === 'next' ? '接着' : null);
    // once：告诉老师用的，一条挑战只说一次（记在挑战上 onTold；主线第一轮 D1-3：以前学生按过、老师换了下一问以后每一轮都报同一句）
    const bad = [...this.goals.values()].filter((g) => !g.met && g.on != null && g.on !== btn && !(once && g.onTold));
    if (once) for (const g of bad) g.onTold = true;
    return bad
      .map((g) => `挑战 ${g.id} 写了 on="${g.on}"，可学生手上的这一问没有「${g.on}」这个按钮：学生按不到，这个挑战判不了（ask next 写 button="${g.on}"）`);
  }

  // —— 存档点（keep / back）——
  /** back 那一行回的是哪样东西（舞台上没有就 null，applyOne 自己报） */
  backTarget(c) {
    const w = (c.args || []).find((a) => a.t === 'word')?.v;
    return w && this.objects.has(w) ? w : null;
  }
  /** 学生的一下演上了：记下这一下之前的样子；做的是老师 after= 写的那个动作（指令名或从哪一项 open 来的）就替老师存 */
  studentMoved(id, prev, c, open) {
    this.lastBefore.set(id, prev);
    for (const [name, act] of this.autoKeep.get(id) || []) if (act === c.cmd || act === open) this.saveKeep(id, name);
  }
  saveKeep(id, name) {
    if (!this.keeps.has(id)) this.keeps.set(id, new Map());
    this.keeps.get(id).set(name, snapOf(this.objects.get(id)));
  }
  /** keep / back / open … back= 写的那样东西：要是整样东西、在舞台上、不是跟着算的（数照式子算：存了、回去了也会被算回来） */
  keptObject(id, cmd) {
    if (!id) throw new Error(cmd === 'back' ? '要写成 back 舞台上的东西 "名字"（回到存着的那一刻，比如 back t "插入后"），或 back 舞台上的东西（回到学生最后那一下之前）' : `要写成 keep 舞台上的东西 "名字"（比如 keep t "插入后"）`);
    const r = parseRef(id);
    if (r?.mark && this.objects.has(r.obj)) throw new Error(`${cmd} 写整样东西的名字（${r.obj}）：存的、回去的是一整样`);
    const o = this.objects.get(id);
    if (!o) throw new Error(`舞台上没有「${id}」`);
    // 存不了档的东西（时间轴：它的小人、条的一头是场景里的拨盘，存档只存东西自己，回去以后两边对不上）
    if (typeOf(o).noKeep) throw new Error(typeOf(o).noKeep);
    // 跟着算的：用了 {…} 的（矩阵格里有 {k} 的也算）、乘积（整样跟着 A、B）
    if (this.nodesOf(o).some((n) => n.id === o.id)) throw new Error(cmd === 'back' ? `${id} 是跟着算的，回不去（数照式子算）` : `${id} 是跟着算的，不能存`);
    return o;
  }
  /** 没存过这个名字时的话：存着哪些；页面以后替老师存的说一声什么时候才存 */
  unsavedError(id, name) {
    const have = [...(this.keeps.get(id)?.keys() || [])];
    const act = this.autoKeep.get(id)?.get(name);
    return `${id} 没存过「${name}」（存着：${have.join('、') || '没有'}${act ? `；学生做完一次 ${act} 才存` : ''}）`;
  }
  /** 学生在这样东西上能做的动作（after= 收的）：指令名、open 的动作名 */
  actionsOf(o) {
    const t = typeOf(o);
    const opens = [...new Set([...Object.keys(affordsOf(t)), ...Object.keys(rulesOf(o)?.gestures || {})])];
    return { opens, all: new Set([...opens, ...Object.keys(t.commands || {})]) };
  }
  /** 一样东西现在的样子写成一句（告诉老师「回到了……的样子」）：那种东西交的 summary，没有就是现状的第一行 */
  summaryOf(o) {
    const t = typeOf(o);
    return t.summary ? t.summary(o) : t.describe(o, this)[0] || '';
  }
  /**
   * 撤一步撤得了这一行吗（gestures.js 的 undoPlan 问它；stage.js 的撤一步、测试同一处）：学生按的「回到……」（open … back=）都撤得了；
   * 别的只撤从写了 undo=on 的那一项来的（拨数、别的 open 来的撤不了）
   */
  undoable(row) {
    if (!row?.open) return false;
    if (row.open === 'back') return true;
    let id = null;
    try { id = this.ownTarget(parseScript(row.src)[0]); } catch { id = null; }
    const es = id ? [this.opens.get(`${id}:${row.open}`)] : [...this.opens.values()].filter((x) => x.action === row.open);
    return es.some((x) => x?.policy?.undo);
  }

  /** 两项 open 写的部件重不重叠（open s.1-3 fold 和 open s.5-9 mark 碰不到）：有一项没写部件（整样东西）、部件找不到了都算重叠 */
  opensMeet(a, b) {
    const keysOf = (x) => { if (!x?.refs?.length) return null; try { return new Set(x.refs.flatMap((rf) => this.parts(rf)).map((p) => p.key)); } catch { return null; } };
    const A = keysOf(a), B = keysOf(b);
    return !A || !B || [...A].some((k) => B.has(k));
  }
  /**
   * 一行在有规则的东西上做的动作，过裁判（referee.js 的 judge）：{ obj, act, src, by, policy, verdict, apply, call, facts, mark, failed? }
   * （apply 以后学生的那一下还多 after：规则交的「这一下以后」的事实）；
   * 不是动作（say、glow……）、那样东西没交规则、规则不判这种指令的，是 null。学生的照 open 那一行老师定的 wrong= / call= 办。
   * 规则自己出错（check 抛了）：当没判（right 是 null），照做、不拦学生，记下 failed（画面那边写进出错记录、告诉老师没判成）
   */
  judgeLine(c, { by = 'student', open = null } = {}) {
    if (!c?.cmd || c.on || (by !== 'student' && by !== 'teacher')) return null;
    const id = this.ownTarget(c);
    const o = id && this.objects.get(id);
    const rules = rulesOf(o);
    if (!rules) return null;
    let act = null;
    // 第四个参数：这一下是谁做的、学生从哪一项 open 做的（一排格子只让 open a move / edit 来的那一下过裁判，老写法 open a 照旧不过）
    try { act = rules.actOf(o, c, this.helpers(c), { by, open }); } catch { act = null; } // 写得读不懂的：交给那种东西自己的指令报错
    if (!act) return null;
    const policy = by === 'student' ? this.policyOf(id, open, c.cmd) : {};
    const base = { obj: id, act, src: lineOf(c), by, policy };
    try {
      return { ...base, ...judge(this, id, act, policy, { by, open }) };
    } catch (err) {
      return { ...base, verdict: { legal: true, right: null, misread: null, why: null, next: null }, apply: true, call: null, facts: [], mark: false, failed: err?.message || String(err) };
    }
  }
  /** 学生这一下是从哪一项 open 来的：那一项老师定的 policy（拿不准是哪一项就找这样东西开放着的任何一项） */
  policyOf(id, open, cmd) {
    const e = (open && this.opens.get(`${id}:${open}`)) || this.opens.get(`${id}:${cmd}`) || [...this.opens.values()].find((x) => x.obj === id && x.policy);
    return e?.policy || {};
  }
  /** 这一行是哪样东西自己的指令（rotate、rowop、mark、write……）、对哪一样做：那样东西的 id；不是就 null */
  ownTarget(c) {
    if (!c?.cmd || CREATE[c.cmd] || !Object.values(TYPES).some((t) => t.commands?.[c.cmd])) return null;
    for (const a of c.args || []) {
      if (a.t !== 'word') continue;
      const r = parseRef(a.v);
      if (r && this.objects.has(r.obj)) return r.obj;
    }
    return null;
  }
  /**
   * 学生走偏的那一下淡淡圈着：这一行写的部件；没写部件的（rowop M r3 - 2r1）问规则这一下改了哪儿（slipRefs：改了的那一行），
   * 规则也说不出就是整样东西。画面照部件上的 slip 画
   */
  slip(id, c, act = null) {
    const refs = this.helpers(c).refsIn().filter((w) => parseRef(w)?.obj === id && w !== id);
    let own = null;
    try { own = refs.length ? null : rulesOf(this.objects.get(id))?.slipRefs?.(this.objects.get(id), act); } catch { own = null; }
    const list = refs.length ? refs : own?.length ? own : [id];
    for (const r of list) for (const p of this.parts(r)) p.slip = true;
    this.slips.set(id, { refs: list, src: lineOf(c) });
  }
  unslip(id) {
    if (!this.slips.has(id)) return;
    this.slips.delete(id);
    const o = this.objects.get(id);
    if (o) for (const p of typeOf(o).parts(o)) delete p.slip;
  }
  /**
   * 交给了学生做的东西（open 了规则 doneBy 里的动作）里，这一行从没做完变成做完了的；刚交给学生时已经做完的不算。
   * 交给学生用键盘填的空格子（fillOpen）也一样：最后一格填上算做完了，记进 filled（写给老师「空格子都写满了」，不是规则算出来没有下一步）
   */
  // ruled：规则判做完了的（开着 rowop 又开着键盘的矩阵，写满和消完是两件：两件都在这一行做到时两个都有）
  checkDone(errors = [], filled = [], ruled = []) {
    const out = [];
    const seen = new Set();
    for (const e of this.opens.values()) {
      if (seen.has(e.obj)) continue;
      const rule = this.doneOpen(e.obj);
      const fill = this.fillOpen(e.obj);
      if (!rule && !fill) continue;
      seen.add(e.obj);
      const blank = this.blankLeft(e.obj);
      // 键盘填的空格子写满了：一件。同时交了规则的（开着 rowop），写满记在「id#fill」上，和规则判的做完分开记。
      // 这里交出的 done / filled 只认学生那一下的（课堂循环 by !== 'student' 的不理、不演预写）：老师自己的行也会让它「刚写满」——
      // rowop 和键盘都开着、写满了不是阶梯形，老师 close M1 rowop，写满的记录从「M1#fill」挪回「M1」，那里是规则留下的 false，
      // 这一行就算刚写满。现在没人看老师那一行的 fx.done；以后要照它做别的，先分清是谁的一下（复审 N10）
      if (fill) {
        const k = rule ? `${e.obj}#fill` : e.obj;
        seen.add(k);
        const was = this.doneState.get(k);
        this.doneState.set(k, !blank);
        if (!blank && was === false) { out.push(e.obj); filled.push(e.obj); }
      }
      if (!rule) continue;
      // 还空着的不是做完了（最后一审 M3）
      let now = false;
      if (!blank) try { now = nextDone(this, e.obj); } catch (err) { now = false; errors.push(`${e.obj} 的规则算下一步时出错：${err?.message || err}`); }
      const was = this.doneState.get(e.obj);
      this.doneState.set(e.obj, now);
      if (now && was === false) { if (!out.includes(e.obj)) out.push(e.obj); ruled.push(e.obj); }
    }
    for (const id of [...this.doneState.keys()]) if (!seen.has(id)) this.doneState.delete(id);
    return out;
  }
  /** 做完了的这样东西，学生开着的动作还能不能把它改回没做完（规则的 reopen：树开着删、摘，托盘里还有没插的数）；没交 reopen 的不能 */
  reopenable(id) {
    const o = this.objects.get(id);
    try { return !!rulesOf(o)?.reopen?.(o, this); } catch { return false; }
  }
  /** 这样东西交给学生做了没有（open 了它的规则说「做完」要看的动作） */
  doneOpen(id) {
    const by = rulesOf(this.objects.get(id))?.doneBy || [];
    return [...this.opens.values()].some((e) => e.obj === id && by.includes(e.action));
  }
  /**
   * 交给学生用键盘填的空格子（open M1 edit input=keypad，M1 里有 _）：填满了就是学生做完了这一件（第三次量：以前写满了页面不知道，
   * 只能等 45 秒没动再叫老师）。open 那一刻就没有空格子的，checkDone 照「刚交给学生时已经做完的不算」不报
   */
  fillOpen(id) {
    const o = this.objects.get(id);
    // 键盘写的才有「写满」：写了 input=keypad 的，或者这种东西的 edit 本来就只有键盘（一排格子：没有自己的拨数器）
    const typed = (e) => e.input === 'keypad' || (e.action === 'edit' && !affordsOf(typeOf(o)).edit && [].concat(e.gesture?.gesture || []).includes('write'));
    return !!o?.cells && !o.collect && !o.live && [...this.opens.values()].some((e) => e.obj === id && typed(e));
  }
  /** 还有没有空着的格（_） */
  blankLeft(id) {
    const o = this.objects.get(id);
    // 那种东西自己说（表：只看交给学生的那几格，只开一列时写满这一列就没有了）
    if (o && typeOf(o).blankLeft) return typeOf(o).blankLeft(this, o);
    return !!o?.cells?.some((x) => x.value === '');
  }

  // @g1 开头的行：先记着，g1 做到了再演。在现在的舞台上把这一挑战记着的行连着试一遍，写错了当场告诉老师。
  // 能套三层（PREWRITE_DEPTH）：@g1 里写出的 goal g2，接着写 @g2 …（g2 还没有，记进 ahead，g1 做到、演出 goal g2 时挪过去）
  stash(c) {
    if (String(c.on).includes('.')) return this.stashOn(c);
    const id = c.on;
    const g = this.goals.get(id);
    if (g?.watch) throw new Error(`watch 成立时页面只叫你，不演预写的行：${id} 成立以后要演什么，等叫你的时候写；要当场演就用 goal`);
    if (g?.met) throw new Error(`挑战 ${id} 已经做到了，@${id} 的行不会再演`);
    let entry = null;
    if (!g) {
      const from = this.ahead.get(id)?.from || this.aheadFrom(id);
      if (!from) throw new Error(`先写 goal ${id} "给学生看的挑战" when="…"，再写 @${id} 开头的行`);
      const depth = this.levelOf(from) + 1;
      if (depth > PREWRITE_DEPTH) throw new Error(`预写最多三层：@${id} 已经是第 ${depth} 层（再往下要等你看着学生写）`);
      entry = this.ahead.get(id) || { lines: [], depth, from };
    }
    const list = g ? this.reactions.get(id) || [] : entry.lines;
    const bind = this.bindPlan(id, c.body, list.length, entry ? entry.depth : this.levelOf(id));
    this.tryPrewrite(id, [...list, c.body], c, entry?.from);
    if (g) this.reactions.set(id, [...list, c.body]);
    else this.ahead.set(id, { ...entry, lines: [...list, c.body] });
    this.bindRight(bind);
    return { stashed: id };
  }
  /**
   * 预写的这一行是一问、前面写着还没着落的 @ask.right（第三次量 E3/幕3：@ask.right say "对"、@g1 ask tap c … expect=c.1）：
   * @ask.right 跟着这一问（预写那一组演出来、这一问挂上时拿走）。这一问页面判不了对错（ask next、没写 expect=）不跟，照旧这一轮演完报。
   * 跟着以后 @ask.right 比那一组深一层，里面套着的跟着深一层：超过三层当场报（还没改任何东西）。返回要做的（bindRight 照它改）或 null
   */
  bindPlan(group, body, at, level = this.levelOf(group)) {
    if (!this.askRight?.length) return null;
    const [x] = parseScript(body);
    if (x?.cmd !== 'ask') return null;
    const { opts, words } = this.helpers(x);
    const kind = words[0];
    const exp = kind === 'pick' && opts.expect ? String(opts.expect).trim().split(/\s+/).filter(Boolean) : opts.expect;
    if (!judgeable({ kind, expect: exp, answer: opts.answer })) return null;
    // 那一组是第 level 层（还没出的 @g2 照它在 ahead 里记的）：@ask.right 跟过去就是第 level + 1 层，里面套着的跟着往下挪
    const deepest = Math.max(1, ...this.aheadUnder('ask.right').map(([, a]) => a.depth)) + level;
    if (deepest > PREWRITE_DEPTH) throw new Error(`预写最多三层：@ask.right 跟着 @${group} 里的那一问，里面套着的成了第 ${deepest} 层（再往下要等你看着学生写）`);
    return { group, at };
  }
  bindRight(plan) {
    if (!plan) return;
    const key = `ask.right#${++this.askSeq}`;
    for (const a of this.ahead.values()) if (a.from === 'ask.right') a.from = key;
    this.preRight.set(plan.group, { lines: this.askRight, key, at: plan.at });
    this.askRight = null;
    this.relevel();
  }
  /**
   * 预写的行写下时在今天的舞台上照先后试一遍（克隆）：套着的从最外一层起，g1 算做到、演 g1 的行，g2 算做到、演 @g2 的行……
   * 最后演这一组（lines）。真演的时候学生已经动过了，「现在就成立」这种检查不算数（trial），换成比条件的字。
   * 指着还没有的部件（空树上的 t.34，err.part）跳过那一行（只查写法；演的时候还没有，舞台告诉老师没演上）
   */
  tryPrewrite(key, lines, c, from = this.ahead.get(key)?.from) {
    // 从最外一层（真有的挑战、东西上的、@ask.right）排到这一组
    const chain = [key];
    for (let k = from, n = 0; k && n < 8; k = this.ahead.get(k)?.from ?? this.rightParent(k), n++) chain.unshift(k);
    const trial = this.clone();
    trial.trial = true; // 这是在今天的舞台上试：真演的时候学生已经动过了
    const run = (list, check) => {
      for (const x of parseScript(list.join('\n'))) {
        if (x.on) throw new Error('@ 的行里不能再写 @');
        if (c.lenient) x.lenient = true; // 重放旧课：预写的行当时收下了，照样收下（不加新的检查）
        let fx;
        try { fx = trial.applyOne(x); } catch (err) { if (err?.part) continue; throw err; }
        check?.(fx);
      }
    };
    const linesOf = (k) => (k === 'ask.right' ? trial.askRight || []
      : k.startsWith('ask.right#') ? (trial.waiting?.rightKey === k ? trial.waiting.right || [] : [...trial.preRight.values()].find((p) => p.key === k)?.lines || [])
        : trial.reactions.get(k) || []);
    for (const k of chain.slice(0, -1)) {
      if (trial.goals.has(k)) trial.goals.get(k).met = true;
      run(linesOf(k));
    }
    const g = trial.goals.get(key);
    if (g) g.met = true;
    // 预写的挑战，条件每一句都在触发它的挑战里：那个挑战一做到它就成立，学生不用再动手（今天的舞台上学生还没动，查不出来，所以比条件的字）
    const mine = g && !c.lenient ? new Set(g.cond.map(clauseKey)) : null;
    run(lines, (fx) => {
      if (!fx?.goal || !mine) return;
      if (trial.goals.get(fx.goal).cond.every((cl) => mine.has(clauseKey(cl)))) throw new Error(`挑战 ${fx.goal} 的条件在 ${key} 做到时就已经成立了，学生不用再动手；换一个要学生再动手才做得到的条件`);
    });
  }
  /**
   * @t.done / @t.right 开头的行：t 做完了（规则说没有下一步了）、学生在 t 上做对一步时页面马上演（硬性规定：只收做对了、做完了；
   * 走偏以后说什么永远等老师看着学生写）。在今天的舞台上连着试一遍，写错了当场告诉老师。@ask.right 是下一问答对时演的
   */
  stashOn(c) {
    const [name, kind] = String(c.on).split('.');
    if (kind === 'wrong') throw new Error('走偏以后怎么讲要等你看着学生写，不能预写');
    if (name === 'ask') return this.stashAsk(c, kind);
    if (kind !== 'done' && kind !== 'right') throw new Error(`@${name}. 后面只能写 done（做完了）或 right（学生做对一步），没有「${kind}」`);
    const o = this.objects.get(name);
    if (!o) throw new Error(this.goals.has(name) ? `${name} 是挑战：做到了演的行写 @${name}，@名字.${kind} 写在舞台上的东西上` : `舞台上没有「${name}」`);
    const rules = rulesOf(o);
    // 交了规则但只有手势和量、不判对错的（一排格子、图）也一样
    if (!rules || !(rules.judges.length || rules.doneBy.length)) throw new Error(`${typeOf(o).label}页面判不了对错（没有规则），@${name}.${kind} 的行不会演`);
    // 先查写下去能不能起作用：要交给学生的是页面判对错（.right）、能做完（.done）的动作；规则现在算得出下一步。起不了作用的当场说为什么
    const need = kind === 'done' ? rules.doneBy : rules.judges;
    const given = [...this.opens.values()].some((e) => e.obj === name && need.includes(e.action));
    if (!given) throw new Error(`先把要做的交给学生（${need.map((a) => `open ${name} ${a}`).join(' / ') || `${typeOf(o).label}没有页面判得了的动作`}），@${name}.${kind} 的行才会演`);
    if (!c.lenient) {
      let nx;
      try { nx = rules.next(o, this); } catch (err) { throw new Error(`页面算不出 ${name} 的下一步（${err.message}），@${name}.${kind} 的行不会演`); }
      // 现在就做完了：学生开着的动作还能把它改回没做完（删一个结点再修平：第三次量 D2/分支 3），再做完时照样演，收下；改不回去的报
      if (nx === null && !(kind === 'done' && this.reopenable(name))) throw new Error(`${name} 现在就已经做完了（没有下一步），学生不用再动手，@${name}.${kind} 的行不会演`);
      // 还有空着的格（blank）：现在算不了，填满了照算，收下（最后一审 M3）
      if (nx !== null && !nx?.acts?.length && !nx?.blank) throw new Error(`页面判不了 ${name}：${nx?.why || '算不出下一步'}，@${name}.${kind} 的行不会演`);
    }
    const key = `${name}.${kind}`;
    const list = this.reactions.get(key) || [];
    const bind = this.bindPlan(key, c.body, list.length);
    this.tryPrewrite(key, [...list, c.body], c);
    this.reactions.set(key, [...list, c.body]);
    this.bindRight(bind);
    return { stashed: key };
  }
  /**
   * @ask.right 开头的行：写在这一轮的 ask 前面，下一个 ask 拿走（waiting.right），学生答对那一问（ask tap / pick 写了 expect=、
   * ask value 写了 answer=）那一刻页面马上演，只演一次。跟着的那一问页面判不了对错，这一轮演完舞台报 ASK_RIGHT_ERROR（askRightProblem）
   */
  stashAsk(c, kind) {
    if (kind !== 'right') throw new Error(`@ask. 后面只能写 right（学生答对下一问时页面马上演），没有「${kind}」`);
    const list = this.askRight || [];
    this.tryPrewrite('ask.right', [...list, c.body], c);
    this.askRight = [...list, c.body];
    return { stashed: 'ask.right' };
  }
  /**
   * 这一轮的 @ask.right 有没有着落（舞台在一轮演完时问）：还没被 ask 拿走的、拿走它的那一问页面判不了对错（ask tap / pick 没写 expect=、
   * ask value 没写 answer=、ask next / say / drag）都报 ASK_RIGHT_ERROR；没问题是 null
   */
  askRightProblem() {
    if (this.askRight?.length) return ASK_RIGHT_ERROR;
    const w = this.waiting;
    if (w?.right?.length && !judgeable(w)) return ASK_RIGHT_ERROR;
    return null;
  }
  /**
   * 预写的这一行现在演不演得上（舞台演预写的行之前问）：演不上返回告诉老师的那一句（写下时指着还没有的部件跳过了，演的时候还是没有），
   * 演得上是 null
   */
  missedPrewrite(c) {
    const err = this.check(c);
    return err ? `预写的这一行没演上：「${String(c.src ?? lineOf(c)).trim()}」——${err}` : null;
  }

  /**
   * 这一行的指令认得哪些选项：{ label（报错里怎么叫它：matrix、ask pick）, names（名字、正则；'*' 是它自己查） }。
   * 各种东西自己的指令按写的那一样东西认；认不出是哪一样、ask 后面写错了种是 null（那条指令自己报）。
   * 测试照它一条指令一条指令核「代码里读的选项都在这条指令自己的表里」（复审 N9）
   */
  optionNames(c) {
    const { cmd } = c;
    // table T engine=sort algo=shell …：别的 名字=值 是引擎的字段，引擎自己报写错的（enginetable.js）
    if (cmd === 'table' && c.opts?.engine != null) return { label: cmd, names: '*' };
    if (CREATE[cmd]) return { label: cmd, names: [...(CREATE[cmd].options?.[cmd] || []), 'hide'] };
    const owners = Object.values(TYPES).filter((t) => t.commands?.[cmd]);
    if (owners.length) {
      const ref = (c.args || []).map((a) => (a.t === 'word' ? parseRef(a.v) : null)).find((r) => r && this.objects.has(r.obj));
      const t = ref ? typeOf(this.objects.get(ref.obj)) : owners.length === 1 ? owners[0] : null;
      return t?.commands?.[cmd] ? { label: cmd, names: t.options?.[cmd] || [] } : null;
    }
    // follow 的字段是引擎的（gaps、pivot、from……）：不查，引擎自己报写错的
    if (cmd === 'follow') return { label: cmd, names: '*' };
    // pos 是页面自己记的（名字=x,y）：名字就是东西的名字
    if (cmd === 'pos') return { label: cmd, names: '*' };
    if (cmd === 'ask') {
      const kind = (c.args || []).find((a) => a.t === 'word')?.v;
      return OPTIONS.ask[kind] ? { label: `ask ${kind}`, names: OPTIONS.ask[kind] } : null;
    }
    return { label: cmd, names: OPTIONS[cmd] || [] };
  }

  /**
   * 这一行写的选项（名字=值）都是这条指令认得的（最后一审 I4）：不认得的当场报，话里给最像的那个（「hid=on」是不是 hide=on？）。
   * 以前默默当没写：matrix R = … hid=on 把要藏的答案摆给学生看、keep … afer=insert 不替老师存。各种东西自己的指令按写的那一样东西认；
   * 找不到是哪一样的不查（那条指令自己报「舞台上没有……」）
   */
  checkOptions(c) {
    const keys = Object.keys(c.opts || {});
    if (!keys.length) return;
    const { cmd } = c;
    const table = this.optionNames(c);
    if (!table || table.names === '*') return;
    const { label, names } = table;
    const bad = keys.find((k) => !names.some((n) => (n instanceof RegExp ? n.test(k) : n === k)));
    if (bad == null) return;
    // 等号两边没空格（matrix A=1 2 / 3 4、dial d=5、set d=3）：紧跟指令的名字被读成了选项。照那条指令原来的话说怎么写
    // （以前各条指令自己报「要写成 matrix 名字 = …」；查选项名抢在前面以后成了「A=1 不是 matrix 认的写法」，不告诉老师怎么改：复审 N5）。
    // 不让给指令自己报：matrix A=B C = 1 2 那样的会造出 C、把 A=B 默默丢掉
    if (c.lead === bad) {
      const glued = `（= 两边要空格：「${bad}=${c.opts[bad]}」连着写，页面读成了 名字=值）`;
      if (CREATE[cmd]) throw new Error(`要写成 ${cmd} 名字 = …${glued}`);
      if (cmd === 'dial') throw new Error(`要写成 dial 名字 = 值 range=1-9${glued}`);
      if (cmd === 'set') throw new Error('要写成 set 名字 值（中间是空格，不写 =）');
    }
    // 树、图的 tag t.50 h=3：小字里带 =，没写引号（它们的 tag 不认选项；写了引号还多出一个 名字=值 的照旧报不认得）
    if (cmd === 'tag' && !names.length && !(c.args || []).some((a) => a.t === 'str')) {
      const at = (c.args || []).find((a) => a.t === 'word')?.v;
      throw new Error(`「${bad}=${c.opts[bad]}」不是 tag 认的写法：小字里带 = 要写在引号里（tag ${at || 't.50'} "${bad}=${c.opts[bad]}"）`);
    }
    // 别的那几种 ask 认的（ask tap 写了 answer=）：说用在哪几种上。reveal=、solve= 由 ask 自己报（说明里写着那一句）
    if (cmd === 'ask') {
      const kinds = Object.entries(OPTIONS.ask).filter(([, ns]) => ns.includes(bad)).map(([k]) => `ask ${k}`);
      if (kinds.length && (bad === 'reveal' || bad === 'solve')) return;
      if (kinds.length) throw new Error(`「${bad}=${c.opts[bad]}」不是 ${label} 认的写法：${bad}= 只用在 ${kinds.join(' / ')} 上（${label} 能写的：${names.map((n) => `${n}=`).join(' ')}）`);
    }
    throw new Error(optionError(label, bad, c.opts[bad], names));
  }

  applyOne(c) {
    if (!c.cmd) throw new Error(c.error || '看不懂这一行');
    // anyOpts：刷新以后重新挂 log 里的最后一问（loop.js 的 resume）——旧课当时收下的选项照样收下，别的检查照旧
    if (!c.lenient && !c.anyOpts) this.checkOptions(c);
    const h = this.helpers(c);
    const { cmd } = c;
    const { args, opts, words, str, arrow, refsIn, partsIn, strayRefs } = h;
    // 造一样东西（array / tree / matrix……）
    if (CREATE[cmd]) {
      const t = CREATE[cmd];
      const id = words[0];
      if (!id || !/^[A-Za-z_]\w*$/.test(id)) throw new Error(`要写成 ${cmd} 名字 = …（名字用英文字母开头）`);
      if (id === 'say' || id.startsWith('dial') || (id === 'ask' && !c.lenient)) throw new Error(`「${id}」这个名字留着别的用，换一个`);
      const old = this.objects.get(id);
      // 一排格子、图这类：造它的那一行里的 {…} 先算成数再造（依赖一变照新的数重新造，见 remake）；
      // 矩阵、平面自己拆 {…}（格子在原地改）；别的东西（题卡、句子、式子）的 {…} 写在引号里，是话里的小块
      // raw：原样取一个部件时照它写的字（09、49′）——只给新写的一排格子（图的边权、树的结点值要的是数；重放旧课照当时画的数）
      const raw = t.type === 'array' && !c.lenient;
      const filled = t.remake ? fillLine(h.line, this, { raw }) : null;
      // 重新读出来的那一行带着这一行的 lenient / replay（重放旧课时那种东西的 make 里新加的检查才拦得住）
      const cc = filled ? { ...parseScript(filled.text)[0], ...(c.lenient ? { lenient: true } : {}), ...(c.replay ? { replay: true } : {}) } : c;
      if (!cc?.cmd) throw new Error(cc?.error || '看不懂这一行');
      const hidden = hiddenOf(opts, old);
      const o = t.make(this, cc, filled ? this.helpers(cc) : h, old);
      // 式子里没用到舞台上的东西（{2^3}）就只是一个数，不算跟着算的
      if (filled?.deps.length) o.live = { line: h.line, exprs: filled.exprs, vals: filled.vals, deps: filled.deps, ...(raw ? { raw: true } : {}) };
      o.type = t.type;
      o.id = id;
      if (hidden) o.hidden = true;
      // 跟着算的不能转着圈（X 跟着 Y、Y 又跟着 X）：先查，写错了舞台上已有的东西不动
      this.liveCheck(this.nodesOf(o), id);
      // 同名重造留在原处：各种东西的 make 照 old 留着位置时，在 objects 里的先后也不变——先后变了 reflow 会把它推到最底下。
      // 乘积翻在原来那一排上（sameRow：product P = B A 翻 AB）也算留在原处，因子大小不一样、乘积挪了一点也不排到最后。
      // 换了地方的（写了 beside=、乘积另起一行、换了一种东西）照旧排到最后，像新造的一样摆
      const kept = !!old && (samePlace(old.origin, o.origin) || !!o.sameRow);
      delete o.sameRow;
      // 同名重造不清存档（老师重造一样东西，还能回到以前存的那一刻）；换了一种东西才清（树的样子放不回一排格子上）
      // 重造以前：贴在旧部件上的字（「站定」贴在旧的 49 上）、交给学生的动作是说旧的那一份的——字收掉（贴在整样东西上的留着），
      // 动作收了要告诉老师（主线第一轮 D4-10：以前字留着贴到了新的第 1 格上，open 没了也不说）。重放时一样收（刷新前后要一样），只是不再说一遍
      if (old) {
        const onParts = [...this.labels].filter(([, l]) => !l.dial && (l.refs || []).some((r) => { const p = parseRef(r); return p?.obj === id && /[.#]/.test(r); })).map(([k]) => k);
        for (const k of onParts) this.labels.delete(k);
        const acts = [...this.opens.values()].filter((e) => e.obj === id).map((e) => `open ${id}${e.action && e.action !== 'drag' ? ` ${e.action}` : ''}`);
        // 这一句一轮演完才写成字（looseProblems）：同一轮里老师又 open 了它，就不说「交给学生的动作收了」
        if ((onParts.length || acts.length) && !c.replay && !this.trial) this.notices.push({ line: c.line ?? 0, src: String(c.src ?? '').trim(), kept: true, remade: { id, labels: onParts, acts: [...new Set(acts)] } });
      }
      if (old) this.dropObject(id, { keepLabels: true, keepPlace: kept, keepSaves: old.type === t.type });
      // 照引擎走的东西同名重造：照法带过去，从新的样子重新跑（每一行之后的 refreshFollow 看到数据变了会重跑；跑不了现状写「照不下去了」）
      if (old?.follow && old.type === t.type) o.follow = { name: old.follow.name, fields: { ...old.follow.fields }, data: null, ...(old.follow.call ? { call: old.follow.call } : {}) };
      if (kept) {
        if (old.colStart) o.colStart = true;
        this.replaceObject(id, o);
      } else {
        if (!hidden && !opts.beside) this.placeFresh(o);
        this.objects.set(id, o);
      }
      // 先写了要挂在它上面的拨数：第一次造出来时挂上，挂完就不记了（同名重造不再挂一遍）
      for (const [name, at] of this.dialAt) {
        if (at !== id) continue;
        this.dialAt.delete(name);
        const l = this.labels.get(`dial:${name}`);
        if (l) l.refs = [id];
      }
      return { id, created: true };
    }
    // 各种东西自己的指令：按第一个部件是哪种东西找（swap 给格子、rowop 给矩阵……）
    const own = this.ownerOf(c, h);
    if (own) {
      const fx = own(this, c, h);
      // 跟着算的一排格子、树上换了位置、长了 / 删了结点、改了值（那种东西的 reshape）：不再跟着算，不然依赖一变照造它的那一行
      // 重新造，老师这一步白做、还没人知道（像矩阵做了行变换一样）
      const id = this.ownTarget(c);
      const o = id && this.objects.get(id);
      if (o?.live && typeOf(o).reshape?.includes(cmd)) this.unlive(o, lineOf(c));
      return fx;
    }
    switch (cmd) {
      case 'say': {
        const text = str ?? '';
        this.checkRich(text, c); // 话里指着的东西要真有
        // 话贴着一处（near=s.had）或放在格子上（at=）；不写就照默认贴在这一轮讲的那样东西旁边
        if (opts.near != null || opts.at != null) this.layout.set('say', [this.placeRel('say', opts.at != null ? null : 'near', opts.near, { at: opts.at })]);
        else this.layout.delete('say');
        this.say = text;
        this.words = parseRich(text).filter((p) => p.k === 'word').map((p) => p.v);
        return {};
      }
      case 'glow': case 'unglow': case 'lift': case 'drop': case 'dim': case 'undim': case 'cover': case 'uncover': {
        strayRefs();
        const parts = refsIn().length ? partsIn() : (cmd.startsWith('un') || cmd === 'drop') ? this.allParts() : null;
        if (!parts) throw new Error(`${cmd} 后面要写对哪几个做`);
        const field = { glow: 'glow', unglow: 'glow', lift: 'lift', drop: 'lift', dim: 'dim', undim: 'dim', cover: 'covered', uncover: 'covered' }[cmd];
        const on = !cmd.startsWith('un') && cmd !== 'drop';
        parts.forEach((x) => { x[field] = on; });
        return { cells: parts, parts };
      }
      case 'pulse': {
        strayRefs();
        const parts = partsIn();
        if (!parts.length) throw new Error('pulse 后面要写哪几个');
        return { cells: parts, parts };
      }
      case 'paint': case 'unpaint': {
        strayRefs();
        const parts = partsIn();
        if (!parts.length) throw new Error(`${cmd} 后面要写哪几个`);
        const color = cmd === 'paint' ? words.find(isColor) || 'g1' : null;
        const bad = words.find((w) => /^g\d+$/.test(w) && !isColor(w));
        if (bad) throw new Error(`颜色只有 g1～g6（${COLORS.map((k) => `${k} ${COLOR_NAMES[k]}`).join('、')}）`);
        parts.forEach((x) => { x.paint = color; });
        return { cells: parts, parts, color };
      }
      case 'compare': {
        strayRefs();
        // 两头都是整张（compare P Q）、那种东西会逐格比（矩阵）：fx.compare 交不一样的格，两张都不变（学生拖去比的那一下照它写事实）
        const refs = refsIn();
        const ws = refs.length === 2 && refs.every((w) => !parseRef(w).mark) ? refs.map((w) => this.objects.get(w)) : null;
        if (ws && ws[0].type === ws[1].type && typeOf(ws[0]).compareWhole) return { compare: typeOf(ws[0]).compareWhole(ws[0], ws[1]) };
        const parts = partsIn();
        // 写的是两样整样的东西、可这种东西不会整张比（一排格子）：说清楚能比什么（主线第一轮 D1-14）
        if (ws && parts.length !== 2) throw new Error(`compare 比的是两个部件（compare a.3 a.8）或者两张矩阵（compare A B）${ws[0].type === ws[1].type ? `：${typeOf(ws[0]).label}不能整${ws[0].type === 'array' ? '排' : '样'}比，一格一格写` : `：${ws[0].id} 和 ${ws[1].id} 不是同一种东西`}`);
        if (parts.length !== 2) throw new Error('compare 要正好两个（比如 compare a.3 a.8）');
        // 空格子没有数可比（以前照字符串比，画成「3 > 空」）：当场报；重放旧课照旧
        if (!c.lenient) { const blank = parts.find((p) => p.value === ''); if (blank) throw new Error(`${this.tapRef(blank)} 还空着，比不了（先填上，或者比别的两格）`); }
        return { a: parts[0], b: parts[1], sign: compareValues(parts[0].value, parts[1].value) };
      }
      case 'link': {
        strayRefs();
        const color = words.find(isColor) || 'g1';
        const refs = refsIn();
        // 写整样东西的那一头（link AB BA、link f.l1 AA f.r1）连到那样东西上：一道弧（以前把它的每一格连成一串，满屏弧线，
        // unlink f 也收不掉块里的那几道）。只写一样东西（link a）照旧把它的部件依次连起来
        const ends = refs.length >= 2 ? refs.flatMap((w) => (parseRef(w).mark ? this.parts(w) : [{ obj: w, key: null }])) : partsIn();
        if (ends.length < 2) throw new Error('link 要至少两个');
        const made = [];
        for (let i = 0; i + 1 < ends.length; i++) {
          const a = ends[i], b = ends[i + 1];
          // 两头都是同一整样东西：连不出东西。新写的报，旧课（以前连成一串格）重放时跳过这一对，不挡这一行。
          // 一格连到它自己那样东西（link a.1 a）照连：一道弧，旧课里这样写的照样演
          if (a.obj === b.obj && a.key == null && b.key == null) {
            if (c.lenient) continue;
            throw new Error(`link 的两头是同一样东西 ${a.obj}（连 ${a.obj} 里面的两个部件写 ${a.obj}.…）`);
          }
          made.push(this.addLink(a, b, color));
        }
        return { links: made.filter(Boolean) };
      }
      case 'unlink': {
        strayRefs();
        const refs = refsIn();
        const parts = refs.length ? partsIn() : null;
        const ids = parts ? new Set(parts.map(pidOf)) : null;
        // 写整样东西（unlink AB）：连着它的线都收，整张连的、连着它里面部件的都算
        const objs = new Set(refs.filter((w) => !parseRef(w).mark));
        const hit = (e) => objs.has(e.obj) || (e.key != null && ids.has(`${e.obj}:${e.key}`));
        const gone = [];
        for (const [k, l] of this.links) if (!ids || hit(l.a) || hit(l.b)) { this.links.delete(k); gone.push(k); }
        // 跳格留下的字跟着弧走
        for (const [k, l] of this.labels) if (l.link && gone.includes(l.link)) this.labels.delete(k);
        return { gone };
      }
      case 'label': {
        const id = words[0];
        if (!id || this.isRef(id)) throw new Error('要写成 label 名字 贴在哪 "字"');
        const refs = args.slice(1).filter((a) => a.t === 'word' && (this.labels.has(a.v) || this.isRef(a.v))).map((a) => a.v);
        for (const r of refs) if (!this.labels.has(r)) this.parts(r);
        if (str == null) throw new Error('label 要有字（写在引号里）');
        this.checkRich(str, c);
        // asked：这一边是老师写的 side=（页面自己定边的字——hop、rowop 的——没有）：照它摆、摆不成在现状里说
        this.labels.set(id, { id, refs, text: str, side: opts.side || null, tone: opts.tone || null, link: null, ...(opts.side ? { asked: true } : {}) });
        return { id };
      }
      case 'retext': {
        const l = this.labels.get(words[0]);
        if (!l) throw new Error(`没有叫「${words[0]}」的字${this.labels.size ? `（有的是：${[...this.labels.keys()].join('、')}）` : ''}`);
        this.checkRich(str ?? '', c, { replayRefs: false });
        l.text = str ?? '';
        return { id: l.id };
      }
      case 'unlabel': {
        const ids = words.length ? words : [...this.labels.keys()].filter((k) => !k.startsWith('dial:'));
        return { ids: this.unlabelIds(ids) };
      }
      case 'dial': {
        // dial d = 5 range=1-5 at=a
        const [name, val] = words;
        if (!name || !/^[A-Za-z_]\w*$/.test(name)) throw new Error('要写成 dial 名字 = 值 range=1-9');
        if (name === VERB && !c.lenient) throw new Error('verb 这个名字留给 {verb: …}（页面拼谓语），拨盘换一个名字');
        if (this.vars.get(name)?.owner && !c.lenient) throw new Error(`${name} 是${typeOf(this.objects.get(this.vars.get(name).owner)).label} ${this.vars.get(name).owner} 上的（它的把手就是这个拨盘），不能另造一个同名的拨盘：换一个名字`);
        // options="过去 现在 将来"：拨词的拨盘（主线第二轮 C）。里面存的是第几个词（1 起），拨、存、重放和拨数的一样；写出来、比较是那个词
        let list = null;
        if (opts.options != null && !(c.lenient && opts.range != null)) {
          if (opts.range != null) throw new Error('range= 和 options= 只能写一个（options= 是拨词的拨盘，range= 是拨数的）');
          list = String(opts.options).trim().split(/\s+/).filter(Boolean);
          if (list.length < 2) throw new Error(`options= 里至少两个词，用空格隔开（dial ${name} = 现在 options="过去 现在 将来"）`);
          if (list.length > 8) throw new Error(`options= 最多 8 个词（写了 ${list.length} 个）`);
          const dup = list.find((w, i) => list.indexOf(w) !== i);
          if (dup) throw new Error(`options= 里「${dup}」重了`);
          const odd = list.find((w) => /[="「」“”{}|]/.test(w));
          if (odd) throw new Error(`options= 的词里不能有 = 、引号、花括号（「${odd}」）：学生一拨交的是 set ${name} ${odd}，读不成。换个写法（k是1、k取1）`);
          if (val != null && !list.includes(val)) throw new Error(`「${val}」不在 options= 里（${list.join('、')}）`);
        }
        const [lo, hi] = list ? [1, list.length] : parseRange(opts.range || '1-9');
        if (!(lo <= hi)) throw new Error('range 要写成 小..大，比如 range=1..5、range=-3..3（1-5 也认）');
        const v = list ? (val == null ? 1 : list.indexOf(val) + 1) : Number(val ?? lo);
        const at = opts.at || [...this.objects.keys()][0] || null;
        // at= 写成已有东西的部件（一条边 g.1~2、一格 a.3）：挂在那个部件旁边（主线第一轮 D3-2：以前当成「还没造」记着，
        // 拨盘一直浮着，现状每一轮写一句「g.1~2 还没造」）。那样东西在、部件写错了：照部件的错报
        const atObj = at && String(at).match(/^[A-Za-z_]\w*/)?.[0];
        const atPartRaw = !!at && !this.objects.has(at) && this.objects.has(atObj) && /[.#]/.test(at);
        let atPart = atPartRaw;
        if (atPart) { try { this.parts(at); } catch (err) { if (!c.lenient) throw err; atPart = false; } }
        const fresh = { v: Math.max(lo, Math.min(hi, v)), lo, hi, at, shown: true, ...(list ? { options: list } : {}) };
        // 同名重造一个拨盘：字里写了 {名字: … | …} 的（句子、贴的字、挑战）段数要还对得上，对不上当场报是谁（不留一句读不成的）
        const again = this.vars.has(name);
        if (again && !c.lenient) this.checkPickUsers(name, fresh);
        this.vars.set(name, fresh);
        this.labels.set(`dial:${name}`, { id: `dial:${name}`, refs: at && (this.objects.has(at) || atPart) ? [at] : [], text: '', side: 'below', tone: 'dial', link: null, dial: name });
        // at= 写的东西还没造（dial 写在 matrix M = … {k} 之前，造 M 要先有 k）：先记着，M 造出来时挂上（以前就一直浮着、不挂）
        if (at && !this.objects.has(at) && !atPart) this.dialAt.set(name, at); else this.dialAt.delete(name);
        // 重造的：跟着它的句子照新的值重排（画面照 set 演）
        const binds = again ? this.repick(name) : [];
        return { name, ...(binds.length ? { binds } : {}) };
      }
      case 'set': {
        const x = this.vars.get(words[0]);
        if (!x) throw new Error(`没有叫「${words[0]}」的数`);
        // 拨词的拨盘：写那个词（set t 将来）
        if (x.options && !x.options.includes(words[1])) throw new Error(`${words[0]} 只能拨到：${x.options.join('、')}（写成 set ${words[0]} ${x.options[0]}）`);
        const v = x.options ? x.options.indexOf(words[1]) + 1 : Number(words[1]);
        if (!Number.isFinite(v)) throw new Error('要写成 set 名字 值');
        // 这个拨盘是一样东西的把手（时间轴上的小人、条的一头）：那样东西先看一眼拨不拨得到（条的右端不能跑到左端前面）
        if (x.owner && this.objects.has(x.owner)) typeOf(this.objects.get(x.owner)).checkVar?.(this, this.objects.get(x.owner), words[0], Math.max(x.lo, Math.min(x.hi, v)));
        x.v = Math.max(x.lo, Math.min(x.hi, v));
        return this.onVar(words[0]);
      }
      case 'camera': {
        strayRefs();
        this.focus = words[0] === 'all' || !words.length ? null : refsIn();
        if (this.focus) for (const r of this.focus) this.parts(r);
        return {};
      }
      case 'wait': {
        const ms = Number(words[0] || 600);
        if (!(ms >= 0)) throw new Error('wait 后面写毫秒数');
        return { ms: Math.min(ms, 3000) };
      }
      case 'fly': {
        const n = Number(String(args[0]?.v || '').split('.')[1]) || 1;
        // 重放时照新读法数不到这个词：这一行是方括号换读法以前记下的（那时 A[i] 的 [i] 也算一个词），照旧读法找（最后一审 Y2：
        // 不能凡是重放都照旧读法——今天写的课一刷新、一撤一步，飞的就成了另一个词）
        if (!this.words[n - 1] && c.lenient) { const olds = parseRich(this.say, { old: true }).filter((p) => p.k === 'word').map((p) => p.v); if (olds[n - 1]) this.words = olds; }
        if (!this.words[n - 1]) throw new Error(`上一句话里没有第 ${n} 个 [词]`);
        const id = args[arrow + 1]?.v;
        if (arrow < 0 || !id) throw new Error('要写成 fly say.1 -> 名字 贴在哪');
        const refs = refsIn(args.slice(arrow + 2));
        refs.forEach((r) => this.parts(r));
        this.labels.set(id, { id, refs, text: this.words[n - 1], side: opts.side || null, tone: 'key', link: null, ...(opts.side ? { asked: true } : {}) });
        return { id, word: n - 1 };
      }
      case 'ask': {
        const kind = words[0];
        if (!['tap', 'drag', 'next', 'say', 'value', 'pick', 'end'].includes(kind)) throw new Error(`ask 后面写 tap / drag / next / say / value / pick / end，没有「${kind}」`);
        if (str) this.checkRich(str, c);
        const refs = refsIn(args.slice(1));
        refs.forEach((r) => this.parts(r));
        // 写了一个名字、舞台上却没有这样东西（上一行没造成、拼错了）：说没有它，不讲一遍 ask 的写法（主线第一轮 D4-6）
        if (['tap', 'drag', 'pick'].includes(kind) && !c.lenient) {
          const stray = args.slice(1).find((a) => a.t === 'word' && !this.isRef(a.v) && /^[A-Za-z_]\w*(?:[.#]\S+)?$/.test(a.v));
          const name = stray && String(stray.v).match(/^[A-Za-z_]\w*/)[0];
          if (stray && !this.objects.has(name)) throw new Error(`舞台上没有 ${name}（ask ${kind} 后面写的是要学生${kind === 'drag' ? '拖' : '点'}的东西：先把它造出来，或者把名字写对）`);
        }
        // ask tap / drag 的预期只有一个（一个部件、一段、一样东西）；写了几个的是想让学生点几样（主线第一轮 D3-7）
        if (kind !== 'pick' && opts.expect && /\s/.test(String(opts.expect).trim()) && !c.lenient) throw new Error(`expect= 只能写一个（一个部件 a.3、一段 a.1-3、一样东西 a）；要学生点几个，写 ask pick … expect="${String(opts.expect).trim()}"`);
        // ask pick 的 expect= 写几个，空格隔开（expect="t.50 t.45 t.40"）；别的 ask 照旧是一个
        const expects = kind === 'pick' && opts.expect ? String(opts.expect).trim().split(/\s+/).filter(Boolean) : null;
        // 要学生点、拖的东西藏着：学生看不见，永远等不来（重放旧课照收）
        const veiled = this.hiddenIn([...refs, ...(expects || (opts.expect && this.isRef(opts.expect) ? [opts.expect] : []))]);
        if (veiled.length && !c.lenient) throw new Error(hiddenError(veiled));
        if (opts.reveal != null && kind !== 'pick') throw new Error('reveal= 只用在 ask pick 上（之后哪一下改了学生点的几样，圈画成实线、虚线）');
        const reveal = kind === 'pick' ? revealOf(opts.reveal) : false;
        // order=on：顺序题（按 Kruskal 的先后点边）连先后一起比。没写的只比点了哪几个（主线第一轮 D3-8：以前先后错了也「一样」、当场演 @ask.right）
        if (opts.order != null && opts.order !== 'on') throw new Error('order= 只能写 on（ask pick 连先后一起比）');
        if (opts.order === 'on' && !expects?.length) throw new Error('order=on 要写 expect=（照 expect 里写的先后比）');
        const order = kind === 'pick' && opts.order === 'on';
        if (kind === 'pick') {
          // 一次点几样：只写东西名是哪个都能点，写部件是只能点这几个；交的那一行、圈都按一样东西记
          if (!refs.length) throw new Error(`ask pick 后面写能点的东西：ask pick t "…" 是 t 里哪个都能点，ask pick t#1 t#3 "…" 是只能点这几个`);
          const objs = [...new Set(refs.map((r) => parseRef(r).obj))];
          if (objs.length > 1) throw new Error(`ask pick 一次只点一样东西里的（写了 ${objs.join('、')}）：分成几问`);
          const can = new Set(refs.flatMap((r) => this.parts(r)).map(pidOf));
          for (const w of expects || []) {
            let ps;
            try { ps = this.parts(w); } catch (err) { const e = new Error(`expect 里的 ${w} 不在能点的里面（${err.message}）`); if (err?.part) e.part = err.part; throw e; }
            if (!ps.every((p) => can.has(pidOf(p)))) throw new Error(`expect 里的 ${w} 不在能点的里面（能点的是 ${refs.join(' ')}）`);
          }
        }
        if (kind === 'drag') {
          const ps = refs.flatMap((r) => this.parts(r));
          if (ps.length < 1) throw new Error('ask drag 要写能拖的东西');
          for (const o of new Set(ps.map((p) => p.obj))) if (!typeOf(this.objects.get(o)).drag) throw new Error(`${typeOf(this.objects.get(o)).label}不能拖`);
        }
        // ask value：answer= 可以不写（只收不判）、可以是 {式子}；type= wrong= free= 见 answer.js。
        // 写下时 {式子} 现算一遍、answer 和每条错答照 type 造好判法，对不上当场报；重放旧课不加新的检查（当时收下的照样收下）。
        // 重放旧课的这一问记着 lenient：{…} 算不出来（第一轮以前字面写的 answer={…}）照字面比。预写的行也带 lenient，
        // 可它写下时照新规矩验过了：判的时候算不出来是学生把舞台拨成了算不了的样子，照旧「页面没判成」，不照字面比（不然对的也判错）
        const oldAsk = !!c.lenient && !c.prewrite;
        if (opts.solve != null && kind !== 'value' && !c.lenient) throw new Error('solve= 只用在 ask value 上（type=matrix free=… 的一列通解按集合判）');
        // grid=off：矩阵的答案不给格子，学生自己写「0 0 / 0 0」——格子的个数会把答案的形状告诉学生，老师想看学生会不会写成一个数时关掉
        if (opts.grid != null && !c.lenient) {
          if (String(opts.grid) !== 'off') throw new Error(`grid= 只能写 off（矩阵的答案不给格子，学生自己写），没有「${opts.grid}」`);
          if (String(opts.type ?? '').trim().toLowerCase() !== 'matrix') throw new Error('grid=off 只用在 type=matrix 上（别的答案本来就是一个输入框）');
        }
        const spec = kind === 'value' ? { type: opts.type, answer: opts.answer, wrongs: opts.wrong, free: opts.free, ...(opts.solve != null ? { solve: opts.solve } : {}), ...(opts.grid != null ? { grid: String(opts.grid) } : {}), ...(oldAsk ? { lenient: true } : {}) } : null;
        if (spec) checkSpec(spec, this, { strict: !c.lenient, lenient: oldAsk });
        if (str != null) { this.say = str; this.words = parseRich(str).filter((p) => p.k === 'word').map((p) => p.v); }
        // 这一轮写在前面的 @ask.right 跟着这一问走（学生答对它时页面马上演，只演一次）。预写里的 ask（舞台演 @g1 的行时带 prewrite）不拿：
        // 那几行可能插在老师这一轮中间演，@ask.right 是写给这一轮最后那一问的
        // 预写里的那一问跟着的 @ask.right（写在它前面、跟到这一组里的：bindRight）由舞台演这一行时交来（preRight）
        const right = c.preRight?.length ? c.preRight : !c.prewrite && this.askRight?.length ? this.askRight : null;
        if (!c.prewrite) this.askRight = null;
        // 换掉的那一问还没答：它的 @ask.right（连同套着的）不会再演了
        if (this.waiting) this.endAsk(this.waiting);
        let rightKey = null;
        if (c.preRight?.length) rightKey = c.preRightKey || `ask.right#${++this.askSeq}`;
        else if (right) {
          rightKey = `ask.right#${++this.askSeq}`;
          for (const a of this.ahead.values()) if (a.from === 'ask.right') a.from = rightKey;
        } else if (!c.prewrite) this.dropAhead('ask.right');
        const ex = this.examOpts(opts, c);
        this.waiting = { ...ex, shownAt: Date.now(), kind, refs, prompt: str ?? '', button: opts.button || null, expect: kind === 'pick' ? expects : opts.expect || null, ...(order ? { order: true } : {}), answer: opts.answer ?? null, type: spec?.type ?? null, wrongs: spec?.wrongs ?? null, free: spec?.free ?? null, ...(spec?.grid ? { grid: spec.grid } : {}), ...(spec?.solve != null ? { solve: spec.solve } : {}), ...(spec?.lenient ? { lenient: true } : {}), ...(kind === 'pick' ? { reveal } : {}), ...(right ? { right, rightKey } : {}), ...(c.prewrite ? { pre: true } : {}) };
        if (opts.expect && kind !== 'pick') this.parts(opts.expect);
        return { kind };
      }
      case 'pick': {
        // pick t.45 t.40 reveal=on：学生一次点了这几个（ask pick 交的那一下：页面照学生点的写这一行，记进 log，刷新照它放回）。
        // 这一行自己带全、不读 waiting：刷新时 ask 不重放，等着的那一问是空的，reveal 只能从这一行拿；和 expect 比是交的那一刻页面比的，进回答
        strayRefs();
        const refs = refsIn();
        if (!refs.length) throw new Error('pick 后面写点了哪几个（比如 pick t.45 t.40）');
        if (refs.some((w) => !parseRef(w).mark)) throw new Error(`pick 写点了哪几个部件（${refs[0]}.…），不写整样东西`);
        const objs = [...new Set(refs.map((w) => parseRef(w).obj))];
        if (objs.length > 1) throw new Error(`pick 一次只点一样东西里的（写了 ${objs.join('、')}）`);
        if (this.objects.get(objs[0]).hidden && !c.lenient) throw new Error(hiddenError(objs));
        const reveal = revealOf(opts.reveal);
        const keys = [...new Set(partsIn().map((p) => p.key))];
        this.clearPicks(); // 新点的一次换掉上一次的
        // judged：这一问写了 expect=，交的那一刻页面已经和预期比过了（之后谁改了它们和这一问无关：不用再告诉老师）
        const judged = this.waiting?.kind === 'pick' && !!this.waiting.expect?.length;
        this.picked = { obj: objs[0], keys, refs, reveal, diffDone: false, ...(judged ? { judged: true } : {}) };
        this.paintPicks();
        return { picked: objs[0] };
      }
      case 'unpick': {
        // unpick / unpick t：收掉学生点着的（老师那一轮演完页面自己写一行 unpick，见 stage.js 的 begin）
        const id = words[0];
        if (id) {
          if (parseRef(id)?.mark) throw new Error(`unpick 写整样东西的名字（unpick ${parseRef(id).obj}），收掉那一样上点着的`);
          if (!this.objects.has(id)) throw new Error(`舞台上没有「${id}」`);
          if (this.picked?.obj !== id) throw new Error(`${id} 上没有学生点着的`);
        }
        const was = this.picked?.obj ?? null;
        this.clearPicks();
        this.picked = null;
        return { unpicked: was };
      }
      case 'clear': {
        this.labels.clear();
        this.say = '';
        this.words = [];
        for (const v of this.vars.values()) v.shown = false;
        return {};
      }
      case 'open': {
        // open B edit range=-3..3：学生随时能直接动它（拨格子、拖向量、点乘积看怎么算）；动的每一下页面当场算、记下来
        const target = words[0];
        if (!target || !this.isRef(target)) throw new Error(`要写成 open 舞台上的东西 动作（比如 open B edit range=-3..3）${target ? `：舞台上没有「${target}」` : ''}`);
        const r = parseRef(target);
        const o = this.objects.get(r.obj);
        // 藏着的东西学生看不见、动不了：开放给学生也是白开（重放旧课照收）
        if (o.hidden && !c.lenient) throw new Error(hiddenError([o.id]));
        // open t back="插入后"：学生那边一个「回到插入后」按钮（点了 = back t "插入后"）。back= 是选项不是动作名：先看它，
        // 不然下面会把动作默认成手势表的第一个（拖）。一个名字一项，能开好几个
        if (opts.back != null) {
          if (r.mark) throw new Error(`open … back= 写整样东西的名字（open ${r.obj} back="${opts.back}"）：回去的是一整样`);
          // 写法容错：back= 和动作写在一行（第一节真课 open r move undo=on back="原句"：整行被跳过，学生拖不了）。
          // 拆成两行照演：先 back 那一行（存过的名字照常查），再动作那一行；动作那一行出错就把 back 那一项收回，照常报那一行的错
          if (words[1]) {
            const { back, ...rest } = opts;
            const backFx = this.applyOne({ ...c, args: args.slice(0, 1), opts: { back } });
            try { this.applyOne({ ...c, opts: rest }); } catch (err) { this.opens.delete(`${o.id}:back:${back}`); throw err; }
            return { ...backFx, forgiven: 'open-back' };
          }
          const extra = Object.keys(opts).filter((k) => k !== 'back');
          if (extra.length) throw new Error(`open … back= 只写名字（学生那边一个「回到${opts.back}」按钮，点了撤得了），${extra.map((k) => `${k}=`).join(' ')} 用不上`);
          this.keptObject(o.id, 'back');
          if (!opts.back) throw new Error(`back= 写存过的名字（open ${o.id} back="插入后"）`);
          // 要回去的名字得存过，或者老师写了 after= 页面以后会替它存（还没存时按钮按不了）
          if (!c.lenient && !this.keeps.get(o.id)?.has(opts.back) && !this.autoKeep.get(o.id)?.has(opts.back)) throw new Error(`${this.unsavedError(o.id, opts.back)}：先 keep ${o.id} "${opts.back}"`);
          const e = { obj: o.id, action: 'back', name: opts.back, refs: [] };
          this.opens.set(`${o.id}:back:${opts.back}`, e);
          return { open: e };
        }
        const t = typeOf(o);
        const affords = affordsOf(t);
        // 手势表里的动作（open t rotate、open M rowop、open s mark）也认：学生的每一下页面先过裁判
        const rules = rulesOf(o);
        const gestures = rules?.gestures || {};
        const names = [...new Set([...Object.keys(affords), ...Object.keys(gestures)])];
        const what = (k) => affords[k] || gestureText(gestures[k]);
        if (!names.length) throw new Error(`${t.label}还不能开放给学生直接动`);
        const action = words[1] || names[0];
        if (!names.includes(action)) throw new Error(`${t.label}能开放的是：${names.map((k) => `${k}（${what(k)}）`).join('、')}，没有「${action}」`);
        if (r.mark) this.parts(target);
        // 跟着算的（{A + B}、{A v}）：数是页面照式子算的，学生拨了、拖了也会被算回去。手势表里写了 live 的照收
        // （矩阵整张拖去比、放进收集用的、并同类项：数照旧由式子定，学生拨不乱）
        if (!gestures[action]?.live && (o.live || (r.mark && this.parts(target).some((p) => p.live)))) throw new Error(`${o.live ? o.id : target} 是跟着算的，学生动不了`);
        t.canOpen?.(this, o, action, h);
        const policy = policyIn(opts, rules, { label: t.label, id: o.id, action });
        // seq：第几个开的（同一项再开一次算新开的）。画面照它的先后挂手指（stage.js 的 syncOpens），同一处按法分不清时先开的那一项按得出
        const seq = 1 + Math.max(0, ...[...this.opens.values()].map((x) => x.seq || 0));
        const e = { obj: o.id, action, refs: r.mark ? [target] : [], lo: null, hi: null, policy, gesture: gestures[action] || null, seq };
        // input=keypad：写一个值的手势用数字键盘（open M edit input=keypad）；不写照旧（矩阵的 edit 是 ± 拨数器）
        if (opts.input != null) {
          // 那种东西的手势自己说还认哪几种（表的 edit：input=text 是一个输入框，系统键盘写字）
          const more = [].concat(gestures[action]?.inputs || []);
          if (opts.input !== 'keypad' && !more.includes(opts.input)) throw new Error(`input= 只能写 keypad（数字键盘，能写分数、负数）${more.length ? `、${more.join('、')}` : ''}，没有「${opts.input}」`);
          if (!(gestures[action] && [].concat(gestures[action].gesture).includes('write'))) throw new Error(`input=keypad 只用在写一个值的动作上（${Object.entries(gestures).filter(([, g]) => [].concat(g.gesture).includes('write')).map(([k]) => `open ${o.id} ${k}`).join(' / ') || `${t.label}没有`}），${action} 用不上`);
          e.input = opts.input;
        }
        // choices="能 不能"：点一格出一排选项点一个（那种东西的手势说了能这样问的才收：表的 edit）
        if (opts.choices != null) {
          if (!gestures[action]?.choices) throw new Error(`choices= 只用在能点一个选项的动作上（表：open T edit choices="能 不能"），${t.label}的 ${action} 用不上`);
          if (opts.input != null) throw new Error('input= 和 choices= 只能写一个（键盘写，或者点一个选项）');
          const list = String(opts.choices).includes('|') ? String(opts.choices).split('|').map((x) => x.trim()).filter(Boolean) : String(opts.choices).trim().split(/\s+/).filter(Boolean);
          if (list.length < 2) throw new Error('choices= 里至少两个选项，用空格隔开（有空格的选项用 | 隔）');
          if (list.length > 8) throw new Error(`choices= 最多 8 个选项（写了 ${list.length} 个）`);
          e.choices = list;
        }
        // 拨数器默认 -9～9；键盘写的值不写 range= 就不限（写了照它收，gestures.js 的 writeRange）
        // 没有自己的拨数器的（一排格子的 edit 只有键盘）也一样：不写 range= 不限
        if (action === 'edit' && !((e.input || !affords.edit) && opts.range == null)) {
          const [lo, hi] = parseRange(opts.range || '-9..9');
          if (!(lo <= hi)) throw new Error('range 要写成 小..大，比如 range=-3..3');
          e.lo = lo; e.hi = hi;
        }
        // 同一样东西上另一项开着的、在同一处用同一种按法抓的（open t 和 open t rotate 都按住结点拖、open t insert 和 place 都按住托盘拖、
        // open t pluck 和 delete 都点结点）：同一处按下去只拿得到先挂的那一个，后开的这一项学生永远用不上——当场报，不默默收下。
        // 按法不一样的（点、滑、按住再拖：open s mark、fold、move）能一起开，一下只认成一种（gestures.js 的 choosePress）
        for (const [k, x] of this.opens) {
          if (x.obj !== o.id || k === `${o.id}:${action}`) continue;
          const { same } = grabClash(openGrabs(e, affords), openGrabs(x, affords), () => this.opensMeet(e, x));
          if (!same.length) continue;
          const press = PRESS_TEXT[pressOf(same[0])];
          const where = same.some((gr) => placeOf(gr) === 'part') ? '同样的部件' : '同一处';
          const xwhat = (x.input ? null : affords[x.action]) || gestureText(x.gesture);
          throw new Error(`${o.id} 已经开着 ${x.action}（${xwhat}），${action} 也要在${where}上${press}：两项都是${press}，学生只做得了先开的那一种；先 close ${o.id} ${x.action} 再 open ${o.id} ${action}（同一处按法不一样的才能一起开：点、滑、按住再拖）`);
        }
        this.opens.set(`${o.id}:${action}`, e);
        return { open: e };
      }
      case 'follow': {
        // follow a sort shell gaps="5 3 1"：照引擎走（follow.js）。第 2 个词是哪类算法的对应关系，第 3 个是它不写名字的那个字段，别的 字段=值 原样给引擎
        const [target, name, head] = words;
        const o = target && this.objects.get(target);
        if (!o) throw new Error(`要写成 follow 舞台上的东西 照法 …（比如 follow a sort shell gaps="5 3 1"）${target ? `：舞台上没有「${target}」` : ''}`);
        if (name === 'off') { delete o.follow; return { follow: null, id: o.id }; }
        const a = followOf(name);
        if (!a) throw new Error(`没有「${name || ''}」这种照法（有：${followNames().join('、') || '还没有'}）`);
        if (!a.types.includes(o.type)) throw new Error(`${name} 接不到${typeOf(o).label}上（能接：${a.types.map((k) => TYPES[k]?.label || k).join('、')}）`);
        // call=done 是给页面的（到一趟不叫你，走完才叫），不交给引擎
        const { call, ...eopts } = opts;
        if (call != null && call !== 'done' && !c.lenient) throw new Error(`follow 的 call= 只能写 done（到一趟不叫你，走完才叫；不写是每到一趟都叫你），没有「${call}」`);
        const fields = { ...eopts, ...(head != null && a.head ? { [a.head]: head } : {}) };
        // 引擎没有的字段当场报（引擎自己不报多写的：少写一个 s 就照默认值悄悄跑出另一条路）
        const known = [a.head, ...(a.known || [])].filter(Boolean);
        const stray = Object.keys(eopts).find((k) => !known.includes(k));
        if (stray && !c.lenient) throw new Error(`${name} 没有「${stray}」这个字段（能写：${(a.known || []).join('、') || '没有别的字段'}）`);
        // 字段里的 {式子} 不跟着算：拨盘变了页面不会重跑，当场说清
        const live = Object.entries(fields).find(([, v]) => /\{[^{}]*\}/.test(String(v)));
        if (live && !c.lenient) throw new Error(`follow 的字段写死的数（${live[0]}="${live[1]}" 里的 {…} 不会跟着变）：拨盘变了页面不会重跑`);
        // 接在表上：引擎的结果直接当表的答案（照表的做法逐格比），不走路
        if (o.type === 'table') {
          if (!a.toKey) throw new Error(`${name} 接不到表上`);
          // 接在表上只是给表一份答案，没有「到一趟」：call= 写了不起作用，当场说（不悄悄丢掉）
          if (call != null && !c.lenient) throw new Error('follow 接在表上只是把引擎的结果当表的答案（逐格比），没有「到一趟叫你」：去掉 call=');
          return a.toKey(o, fields, this);
        }
        try { startFollow(o, name, fields, this); if (call === 'done' && o.follow) o.follow.call = 'done'; } catch (err) { if (!c.lenient) throw err; }
        return { follow: name, id: o.id };
      }
      case 'close': {
        // close B / close B edit / close（全收起）
        const ids = [...this.opens.keys()].filter((k) => { const e = this.opens.get(k); return (!words[0] || e.obj === parseRef(words[0])?.obj) && (!words[1] || e.action === words[1]); });
        if (words[0] && !ids.length) throw new Error(`「${words.join(' ')}」没有开放着`);
        ids.forEach((k) => this.opens.delete(k));
        return { closed: ids };
      }
      case 'watch':
      case 'goal': {
        // goal g1 "改 B 里的一个数，让 AB 还是 O" when="C = O"：给学生的挑战；页面每一下都判，做到了马上告诉老师
        // watch w1 when="count(t) = 3"（主线第三轮：底座留下的第 7 条）：只叫老师、不打勾、不给学生看的条件——老师想在某一刻停下来看看，
        // 以前只能拿挑战凑，学生看到的是左上角一个勾（成了「做到了」）。数据上是一条 watch: true 的挑战（成立时马上叫老师一次、没有预写）
        const watch = cmd === 'watch';
        if (watch) {
          if (str != null) throw new Error(`watch 不写给学生看的字（学生看不到它）：watch ${words[0] || 'w1'} when="…"`);
          if (!opts.when) throw new Error(`watch ${words[0] || 'w1'} 要写 when="什么成立时叫你"（比如 when="count(t) = 3"）`);
        }
        const id = words[0];
        if (!id || !/^[A-Za-z_]\w*$/.test(id)) throw new Error('要写成 goal 名字 "给学生看的挑战" when="C = O, D != O"');
        if (this.objects.has(id)) throw new Error(`「${id}」是舞台上一样东西的名字，挑战换一个名字（g1、g2……）`);
        if (str == null && !watch) throw new Error(`要写成 goal ${id} "给学生看的挑战" when="…"（挑战的话写在引号里）`);
        if (!opts.when) throw new Error(`goal ${id} 要写 when="做到什么算做到"（比如 when="C = O, D != O"），页面照它判`);
        if (!watch) this.checkRich(str, c);
        // when= 用 | 隔开几组（「或」）：有一组都成立就算做到；cond 是各组摊平的（还要比条件的字的旧代码用）。
        // 重放旧课：以前 | 不是写法，读不成几组就照以前的读法（当时收下的照样收下）
        let alts;
        try { alts = parseWhen(opts.when); } catch (err) { if (!c.lenient) throw err; alts = [parseGoal(opts.when)]; }
        const cond = alts.flat();
        checkPreds(this, cond, { run: !c.lenient });
        // 要学生动的东西都藏着（跟着算的看它跟着谁）：学生做不到（重放旧课照收）
        const blocked = c.lenient ? [] : this.blockedByHidden(this.objectsIn(cond));
        if (blocked.length) throw new Error(hiddenError(blocked));
        // 这一轮新加的几个选项（call=、on=、collect= n=）：写错当场报；重放旧课（lenient）以前不认它们，当没写（当时收下的照样收下）
        const fresh = (fn) => { try { return fn(); } catch (err) { if (c.lenient) return null; throw err; } };
        // call=now：做到那一刻马上叫老师（不管学生手上还有没有事）；不写照默认（学生手上没事了才叫）。页面不替老师开
        // watch 只认 when=（别的选项写了，选项表那一关已经报了）：不读 call= / on= / collect=
        const call = watch ? 'now' : fresh(() => { if (opts.call != null && opts.call !== 'now') throw new Error(`goal 的 call= 只能写 now（做到那一刻马上叫你，不管学生手上还有没有事），没有「${opts.call}」`); return opts.call === 'now' ? 'now' : null; });
        // on="就这样"：只在学生按这一轮那个按钮时判
        const on = watch ? null : fresh(() => { const v = opts.on == null ? null : String(opts.on).trim(); if (v === '') throw new Error(`on= 写按钮上的字（goal ${id} "…" when="…" on="就这样"，学生按「就这样」时才判）`); return v; });
        let collect = watch ? null : fresh(() => (opts.collect == null ? null : this.collectSpec(opts, id)));
        if (!watch) fresh(() => { if (opts.collect == null && opts.n != null) throw new Error(`n= 跟着 collect= 写（goal ${id} "…" when="…" collect=B n=3：收齐 3 张不一样的 B 才算做到）`); });
        if (collect && on != null) { if (!c.lenient) throw new Error('collect= 和 on= 不能写在一个挑战上：收集型每做到一次就收一张，不等按钮'); collect = null; }
        // 老师当场写的挑战一写下就成立，多半是写错了，当场告诉老师；预写的行、重放的时候学生可能已经做到了：照收，下面马上算做到。
        // 每一组都判一遍（哪一组写错了照样当场报）；按了按钮才判的不查成不成立（学生按的时候才算，现在成立也要学生自己说「就这样」）
        // 撞名两头都当场报（不然一个悄悄换掉另一个：条件换了、预写的行没了，收集型里那一行悄悄跳过）：
        // 预写里写出、还没出来的挑战（套了 @g2 的在 ahead，没套的只在那一组预写的行里），老师当场直接写同名的；
        // 老师直接写的挑战已经在舞台上，预写里（写下时的试演）又写同名的。预写出的挑战（pre）不算：收集型每收一张照旧跳过它
        if (!this.trial && !c.lenient && !c.prewrite) {
          const from = this.ahead.get(id)?.from || (!this.goals.has(id) && this.aheadFrom(id));
          if (from) throw new Error(`${id} 是你预写的挑战（${groupText(from)}时才出），直接写会和它撞名：换一个名字`);
        }
        if (this.trial && !c.lenient && this.goals.has(id) && !this.goals.get(id).pre) throw new Error(`${id} 是你直接写的挑战（已经在舞台上），预写里再写会和它撞名：换一个名字`);
        if (!this.trial && !c.lenient) {
          const now = alts.map((x) => evalGoal(this, x));
          if (on == null && now.some(Boolean)) throw new Error(`「${opts.when}」现在就已经成立了：挑战要学生动手以后才做得到`);
        }
        // pre：预写的行造的（舞台演预写的行、写下时的试演），撞名时和老师直接写的分开
        // 挑战上不收 exam=：挑战只在做到时记一次作答（中间试错不记），「第一次碰到就一次做对」对它永远成立；对标的 like= 照收
        if (!watch && opts.exam != null && !c.lenient) throw new Error(`挑战上不写 exam=（挑战只记做到的那一下，算不了真题级）：真题原题用 ask value / tap / pick 问，写 exam=；挑战照着真题出的写 like=`);
        const ex = watch ? {} : this.examOpts({ ...opts, exam: null }, c);
        this.goals.set(id, { ...ex, id, text: str ?? '', when: opts.when, alts, cond, met: false, call: watch ? 'now' : call, on, collect, ...(watch ? { watch: true } : {}), ...(c.prewrite || this.trial ? { pre: true } : {}) });
        // 套着的预写（@g1 里写出 goal g2，@g2 的行先记在 ahead）：演出 goal g2 的那一刻（舞台演预写的行带 prewrite；写下时试演在克隆上）
        // 那几行挪过来。老师当场直接写的同名挑战不捡（那是另一个挑战，旧的预写不能在它做到时演）；重写一个挑战照旧清掉它的预写
        if ((c.prewrite || this.trial) && this.ahead.has(id)) {
          this.reactions.set(id, this.ahead.get(id).lines);
          this.ahead.delete(id);
          this.relevel();
        } else {
          this.reactions.delete(id);
          if (!this.ahead.has(id)) this.dropAhead(id); // 它以前的预写里套着的也不算了（ahead 里那一项的下一层留着：还归前一层管）
        }
        return { goal: id };
      }
      case 'ungoal': {
        const ids = words.length ? words : [...this.goals.keys()];
        for (const k of ids) if (!this.goals.has(k)) throw new Error(`没有叫「${k}」的挑战`);
        this.ungoalIds(ids);
        return { ungoal: ids };
      }
      case 'press': {
        // press "就这样"：学生按了这一轮的按钮（舞台照学生的一行记进 log，刷新照它放回）：on= 写的是它的挑战这时才判
        if (str == null) throw new Error('press 后面写按钮上的字（press "就这样"）');
        const onGoals = this.judgeOn(str);
        return { pressed: str, onGoals, onMet: onGoals.filter((x) => x.met).map((x) => x.id) };
      }
      case 'hide': case 'show': {
        // hide R / show R：藏起来（照样算、现状照样写，画面上不摆）、摆回来；哪种东西都能藏
        if (!words.length) throw new Error(`${cmd} 后面写舞台上东西的名字（比如 ${cmd} R）`);
        for (const w of words) {
          const r = parseRef(w);
          if (r?.mark && this.objects.has(r.obj)) throw new Error(`${cmd} 写整样东西的名字（${r.obj}），不写部件（${w}）`);
          if (!this.objects.has(w)) throw new Error(`舞台上没有「${w}」`);
        }
        for (const id of words) {
          const o = this.objects.get(id);
          if (cmd === 'hide') { if (!o.hidden) { o.hidden = true; this.closeGap(o); } continue; }
          if (!o.hidden) continue;
          delete o.hidden;
          // 藏着的时候没人给它让地方，它也没跟着别人往下让：原来的地方压着画面上的东西，或者在所有东西下面（hide=on 造的
          // 从来没摆过，是造的那一刻往下摆的地方；后来另起了一列的话该摆进那一列），照摆新东西的规矩重新摆、排到最后（像刚造的一样）。
          // 夹在中间、没压着的（beside= 摆的、摆过又藏起来的）留在原处
          const me = this.objectBox(id);
          const others = this.shownIds().filter((k) => k !== id).map((k) => this.objectBox(k));
          const all = bbox(others);
          const blocked = others.some((b) => b.x < me.x + me.w && me.x < b.x + b.w && b.y < me.y + me.h && me.y < b.y + b.h);
          if (all && (blocked || me.y >= all.y + all.h)) {
            this.placeFresh(o, { again: true });
            this.objects.delete(id);
            this.objects.set(id, o);
          }
        }
        return { [cmd === 'hide' ? 'hidden' : 'shown']: words };
      }
      case 'keep': {
        // keep t "插入后"：把 t 现在的样子存下（只存这样东西的数据）；同名的换掉。
        // keep t "插入后" after=insert：先只登记，以后学生每做完一次 insert 页面替老师存成「插入后」（老师自己做的不存）；after=off 停掉
        const id = words[0];
        const o = this.keptObject(id, 'keep');
        if (words.length > 1) throw new Error(`名字写在引号里：keep ${id} "${words.slice(1).join(' ')}"`);
        if (!str) throw new Error(`要写成 keep ${id} "名字"（back ${id} "名字" 回到这一刻）`);
        // after=off：不再替老师存这个名字（已经存下的照留着，back 照样回得去）
        if (opts.after === 'off') {
          const auto = this.autoKeep.get(id);
          if (!auto?.has(str)) throw new Error(`${id} 的「${str}」没写过 after=，用不着 off${auto?.size ? `（页面替你存的：${[...auto].map(([n, a]) => `「${n}」after=${a}`).join('、')}）` : ''}`);
          auto.delete(str);
          if (!auto.size) this.autoKeep.delete(id);
          return { keep: id, name: str, after: 'off' };
        }
        const names = new Set([...(this.keeps.get(id)?.keys() || []), ...(this.autoKeep.get(id)?.keys() || [])]);
        if (!names.has(str) && names.size >= KEEP_MAX) throw new Error(`${id} 最多存 ${KEEP_MAX} 个：同名的会换掉，先换掉一个`);
        if (opts.after != null) {
          const { opens, all } = this.actionsOf(o);
          if (!all.has(opts.after)) throw new Error(`after= 写学生的一种动作（${id} 上学生能做的：${opens.join(' / ') || '没有'}；不再替你存写 after=off），没有「${opts.after}」`);
          if (!this.autoKeep.has(id)) this.autoKeep.set(id, new Map());
          this.autoKeep.get(id).set(str, opts.after);
          return { keep: id, name: str, after: opts.after };
        }
        this.saveKeep(id, str);
        return { keep: id, name: str };
      }
      case 'back': {
        // back t "插入后"：t 回到存着的那一刻；back t：回到学生最后那一下之前（隔着老师的一轮也行）。
        // 只换这样东西的数据（restoreSnap）：位置、open、别的东西、贴的字、挑战都不动；之后照常重算跟着它的、判挑战、看做完了没有
        const id = words[0];
        const o = this.keptObject(id, 'back');
        if (words.length > 1) throw new Error(`名字写在引号里：back ${id} "${words.slice(1).join(' ')}"`);
        const snap = str != null ? this.keeps.get(id)?.get(str) : this.lastBefore.get(id);
        if (!snap) throw new Error(str != null ? this.unsavedError(id, str) : `${id} 上学生还没动过`);
        // 同名重造成了另一种东西：存的样子放不回去（同名重造不清存档，换了种类才清，这里再挡一下）
        if (snap.type !== o.type) throw new Error(`${id} 现在是${typeOf(o).label}，存的是以前的样子，回不去`);
        restoreSnap(o, snap);
        // 跟着拨盘变的句子：存的是那时拨盘的样子，回去以后照现在的拨盘重排（不然句子和拨盘对不上，现状还说它跟着）
        const repicked = o.picks && !o.picks.off ? typeOf(o).onPick?.(this, o) : null;
        // 回去以后没了的部件：连到它的线剪掉，跟着那道弧的字一起（和删掉结点、照新的数重新造一样）
        const lost = (e) => e.obj === id && e.key != null && !this.partOf(id, e.key);
        const cut = [];
        for (const [k, l] of this.links) if (lost(l.a) || lost(l.b)) { this.links.delete(k); cut.push(k); }
        for (const [k, l] of this.labels) if (l.link && cut.includes(l.link)) this.labels.delete(k);
        return { id, back: { id, name: str ?? null, summary: this.summaryOf(o) }, ...(repicked ? { binds: [repicked] } : {}) };
      }
      case 'scene': {
        // scene "过去完成时" [keep=tl]：开新的一幕（主线第六轮 3.2）。不在 keep 里的全部拿下，做法和老师一样一样拿的一样：
        // 东西走 remove 的 dropObject（它的贴的字、拨盘、学生开着的手、预写的 .done / .right、存档点、照引擎走跟着收），挑战走 ungoal 的，
        // 贴的字走 unlabel 的（贴在收掉的东西上的跟着收），等着的一问走换问时收旧问的 endAsk。不另写一套清表的
        if (str == null || !str.trim()) throw new Error('要写成 scene "这一幕叫什么"（比如 scene "过去完成时"；要带着东西进下一幕写 keep=tl）');
        const keep = String(opts.keep || '').split(/[\s,，]+/).filter(Boolean);
        for (const k of keep) {
          if (this.objects.has(k)) continue;
          if (this.labels.has(k) || this.vars.has(k)) throw new Error(`keep 只能写舞台上的东西（「${k}」是${this.labels.has(k) ? '贴的字' : '拨盘'}：跟着它贴着的那样东西一起带过去）`);
          throw new Error(`舞台上没有「${k}」（keep= 写要带进下一幕的东西的名字）`);
        }
        const kept = new Set(keep);
        const dropped = [...this.objects.keys()].filter((id) => !kept.has(id));
        // 贴的字先记下哪些贴在要收的东西上（dropObject 会顺手删掉它们，unlabel 的级联要拿这一份往外找）
        const gone = new Set(dropped);
        const onDropped = [...this.labels].filter(([, l]) => (l.refs || []).some((r) => gone.has(parseRef(r)?.obj))).map(([k]) => k);
        for (const id of dropped) this.dropObject(id);
        const goals = [...this.goals.keys()];
        this.ungoalIds(goals);
        // 剩下要收的字：不贴在任何东西上的拨盘（不在 keep 里）、连线没了的；贴在别的字上的跟着 unlabel 的级联走（贴着的那张还在就留着）
        const free = [...this.labels].filter(([k, l]) => (k.startsWith('dial:') ? !this.vars.get(k.slice(5))?.owner || !kept.has(this.vars.get(k.slice(5)).owner) : l.link ? !this.links.has(l.link) : false)).map(([k]) => k);
        const labs = this.unlabelIds([...onDropped, ...free]);
        if (this.waiting) this.endAsk(this.waiting);
        this.waiting = null;
        this.skipAsk();
        this.say = '';
        this.words = [];
        this.layout.delete('say');
        return { scene: str.trim(), keep, dropped, ungoal: goals, unlabeled: labs, removed: dropped.length > 0 };
      }
      case 'place': {
        // place s main / place gl right-of s align=top / place A B row / place k near s.had / place q at=6,4-30,12（第八轮）：
        // 只存构图意图，页面的求解器（compose/）照它排；同一样东西再写一次换掉它的关系
        const KINDS = ['main', 'right-of', 'left-of', 'above', 'below', 'near', 'row', 'col'];
        const ws = args.filter((a) => a.t === 'word').map((a) => a.v);
        const k = ws.findIndex((w) => KINDS.includes(w));
        const names = k < 0 ? ws : ws.slice(0, k);
        const kind = k < 0 ? null : ws[k];
        if (!names.length) throw new Error('要写成 place 名字 main / right-of 别的 / row …（或 at=6,4-30,12）');
        for (const n of names) if (!this.objects.has(n) && n !== 'say' && n !== 'goals') throw new Error(`place 写的「${n}」舞台上没有`);
        if (!kind && opts.at == null) throw new Error(`place ${names.join(' ')} 后面写怎么放：main / right-of 别的 / left-of / above / below / near 一处 / row / col，或 at=6,4-30,12`);
        if ((kind === 'row' || kind === 'col') && names.length < 2) throw new Error(`${kind} 前面写两样以上（place A B ${kind}）`);
        if (kind && kind !== 'row' && kind !== 'col' && names.length > 1) throw new Error(`${kind} 前面写一样东西（place ${names[0]} ${kind} …）`);
        const target = kind && kind !== 'main' && kind !== 'row' && kind !== 'col' ? ws[k + 1] : null;
        if (kind && kind !== 'main' && kind !== 'row' && kind !== 'col' && !target) throw new Error(`${kind} 后面写挨着哪一样（place ${names[0]} ${kind} s）`);
        const rel = this.placeRel(kind === 'row' || kind === 'col' ? names : names[0], opts.at != null ? null : kind, target, opts);
        this.layout.set(names[0], [rel]);
        return { place: names };
      }
      case 'pos': {
        // pos s=12.5,40 gl=30,4.5,600：页面的求解器摆好的地方（第八轮，compose/apply.js 的 posLine）。页面自己写进 log，
        // 刷新、回看、作废照它放回，排出来和当时一样。没了的东西跳过（重放时那样东西可能已经收了）
        const moved = [];
        for (const [id, v] of Object.entries(opts)) {
          const [x, y, w] = String(v).split(',').map(Number);
          if (!this.objects.has(id) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
          this.moveObject(id, x, y, Number.isFinite(w) ? w : null);
          moved.push(id);
        }
        return { moved };
      }
      case 'preview': {
        // preview：这一轮排好先给老师看一眼示意图（第八轮），画面上不演什么
        return { preview: true };
      }
      case 'remove': {
        // remove a：把一样东西拿下舞台
        const id = words[0];
        if (!this.objects.has(id)) throw new Error(`舞台上没有「${id}」`);
        this.dropObject(id);
        return { id, removed: true };
      }
      default:
        throw new Error(`没有「${cmd}」这个指令`);
    }
  }

  // 这一行是不是某种东西自己的指令：第一个部件（或者第一个词是东西的名字）是哪种东西，就问那种东西
  ownerOf(c, h) {
    const { cmd } = c;
    const owners = Object.values(TYPES).filter((t) => t.commands?.[cmd]);
    if (!owners.length) return null;
    let target = null;
    for (const a of c.args) {
      if (a.t !== 'word') continue;
      const r = parseRef(a.v);
      if (r && this.objects.has(r.obj)) { target = this.objects.get(r.obj); break; }
    }
    if (!target) {
      // 指令只有一种东西有：交给它（它自己报「舞台上没有……」）
      if (owners.length === 1) return owners[0].commands[cmd];
      throw new Error(`${cmd} 要写对哪一样东西做`);
    }
    const t = typeOf(target);
    if (!t.commands?.[cmd]) throw new Error(`${t.label}没有「${cmd}」（${owners.map((x) => x.label).join('、')}才有）`);
    void h;
    return t.commands[cmd];
  }

  /**
   * 藏起来的东西不占地方（hide）：它那一行（同一列里和它高度上有重叠的）没别的东西了，这一列里摆在它下面的整体往上收到它原来的上沿，
   * 和它不在时一样（以前空着一大块，竖屏中间一大块空）；那一行还有别的（beside= 摆在旁边的）就不收。一列是另起一列（colStart）的那一样
   * 和它后面摆的。只在藏的这一下往上收一次，别的时候照旧只往下推（reflow）。show 时原来的地方被占了，照摆新东西的规矩摆（placeFresh）
   */
  closeGap(o) {
    if (!o.origin) return;
    const all = [...this.objects.values()];
    const colOf = (x) => { let c = 0; for (const y of all) { if (y.colStart) c++; if (y === x) return c; } return c; };
    const c = colOf(o);
    const me = this.objectBox(o.id);
    const mates = all.filter((x) => x !== o && !x.hidden && x.origin && colOf(x) === c).map((x) => ({ x, b: this.objectBox(x.id) }));
    if (mates.some(({ b }) => b.y < me.y + me.h && me.y < b.y + b.h)) return;
    const below = mates.filter(({ b }) => b.y >= me.y + me.h);
    if (!below.length) return;
    const d = Math.min(...below.map(({ b }) => b.y)) - me.y;
    if (d > 0) for (const { x } of below) shiftObject(x, 0, -d);
  }

  /**
   * 东西长大了（树多长了一层、矩阵多了一行、题卡加了一行）：摆在它下面的往下让，不压着它。
   * 只往下推、不往上拉（老师和学生看惯了的位置不乱跳）；按摆上舞台的先后
   */
  reflow() {
    const list = [...this.objects.values()].filter((o) => !o.hidden); // 藏着的不推别人、也不被推
    const order = new Map(list.map((o, i) => [o.id, i]));
    for (let i = 1; i < list.length; i++) {
      const o = list[i];
      if (o.placed) continue; // 页面的求解器摆过的（第八轮）：位置归它，这里不推
      const me = this.objectBox(o.id);
      const tied = new Set(typeOf(o).anchors?.(o) || []); // 和它排成一体的（乘积和它的两个因子）不比
      let need = -Infinity;
      for (let j = 0; j < i; j++) {
        if (tied.has(list[j].id)) continue;
        const b = this.objectBox(list[j].id);
        // 横着有重叠的才算「在上面」
        if (b.x < me.x + me.w && me.x < b.x + b.w) need = Math.max(need, b.y + b.h + OBJECT_GAP / 2);
      }
      // 贴在先造的东西上的字也算：字找不到空地方、只好摆到后造的东西那里时，后造的往下让（字只躲东西，这样东西也给字让地方）。
      // 贴的东西里有它自己、有更晚造的，不算（贴在 A、B 两个上面的字不推 B）
      for (const r of this.labelRects) {
        if (!r.objs.length || r.objs.some((id) => !order.has(id) || order.get(id) >= i)) continue;
        if (r.x < me.x + me.w && me.x < r.x + r.w && r.y < me.y + me.h) need = Math.max(need, r.y + r.h + OBJECT_GAP / 3);
      }
      // 老师写了 side=above 贴在这样东西上的字：上面那样东西和它之间要放得下这一行字，放不下它往下让
      // （主线第一轮：以前字找不到地方就换到别的一边，side= 等于没写）。只管贴在它一样东西上的；让多少只看字多高，让过了不再让
      if (need > -Infinity) {
        const above = need - OBJECT_GAP / 2;
        for (const r of this.labelRects) if (r.want === 'above' && r.objs.length === 1 && r.objs[0] === o.id) need = Math.max(need, above + r.h + LABEL_ROOM);
      }
      if (me.y < need && o.origin) o.origin = { ...o.origin, y: o.origin.y + (need - me.y) };
    }
  }

  // 一头是整样东西（key 是 null）：那一头的编号就是东西的名字（部件的编号带「:」，撞不上）
  linkKey(a, b) { return [a, b].map((e) => (e.key == null ? e.obj : pidOf(e))).sort().join('~'); }
  /**
   * 连一道弧。一头可以是整样东西（{ obj, key: null }，link AB BA）：画面那一头用 objectBox；这样的线记 whole: true
   * （照新的数重新造时它那一头没有部件可找，不能当成部件没了剪掉）
   */
  addLink(a, b, color, tier = 0) {
    const key = this.linkKey(a, b);
    if (this.links.has(key)) { const l = this.links.get(key); l.color = color; return null; }
    const whole = a.key == null || b.key == null;
    this.links.set(key, { key, a: { obj: a.obj, key: a.key }, b: { obj: b.obj, key: b.key }, color, tier, ...(whole ? { whole: true } : {}) });
    return key;
  }
  /**
   * 同名重造：换成新造的那一份，在 objects 里的先后不变（先后变了 reflow 会把它推到最底下）。
   * Map 换一个还在的键的值不改先后（dropObject 的 keepPlace 留着键），objects 还是同一个 Map；不在了才排到最后
   */
  replaceObject(id, o) { this.objects.set(id, o); }
  // keepPlace：同名重造，objects 里留着它的位子（replaceObject 换进去），只清连线、open 这些
  // keepSaves：同名重造留着存档（keep / back，lastBefore 不留）；拿下舞台（remove，以后 merge 拿掉的那一张）连存档一起清
  /**
   * 一条构图关系（place / say near=）：查写法、指着的东西，拼成 compose/solve.js 认的样子。kind 是 null 时是 at=（定死在格子上）。
   * 名字写错、at= 写错、gap= / weight= / align= 写错当场报
   */
  placeRel(a, kind, target, opts) {
    const rel = {};
    if (kind == null) {
      const at = parseAt(opts.at);
      if (!at) throw new Error(`at= 写成 6,4-40,12：第几列第几行到第几列第几行（横 ${COLS} 列，从 0 数，后一个比前一个大）`);
      return { kind: 'at', a, at };
    }
    rel.kind = kind;
    rel.a = a;
    if (target != null) {
      const ref = parseRef(target);
      if (!ref || !this.objects.has(ref.obj) && !(target === 'say' || target === 'goals')) throw new Error(`place 写的「${target}」舞台上没有`);
      if (ref.mark && kind !== 'near') throw new Error(`${kind} 后面写一样东西的名字（${ref.obj}），贴着一个部件用 near ${target}`);
      if (ref.mark) this.parts(target);
      if (target === a) throw new Error(`${kind} 不能挨着自己`);
      rel.b = target;
    }
    const pick = (name, list) => {
      if (opts[name] == null) return;
      if (!list.includes(opts[name])) throw new Error(`${name}= 只能写 ${list.join(' / ')}`);
      rel[name] = opts[name];
    };
    pick('align', ['left', 'right', 'center', 'top', 'bottom']);
    pick('gap', ['s', 'm', 'l']);
    pick('weight', ['strong', 'medium', 'weak']);
    return rel;
  }

  /** 把一样东西整个挪到 (x, y)（它自己算的框的左上角，世界坐标；不带量出来的 ext，重放时没量也一样）；句子顺带换折行的宽 */
  moveObject(id, x, y, width = null) {
    const o = this.objects.get(id);
    if (!o) return;
    if (width && o.type === 'sentence') o.width = width;
    const b = this.type(o).objectBox(o);
    shiftObject(o, x - b.x, y - b.y);
    o.placed = true;
  }

  dropObject(id, { keepLabels = false, keepPlace = false, keepSaves = false } = {}) {
    // 构图里指着它的关系跟着没了（row / col 只剩一样就不算了）
    if (!keepPlace && this.layout.size) {
      const next = new Map();
      for (const rs of this.layout.values()) for (const r0 of rs) {
        const r = Array.isArray(r0.a) ? { ...r0, a: r0.a.filter((x) => x !== id) } : r0;
        if (Array.isArray(r.a) ? r.a.length < 2 : r.a === id) continue;
        if (r.b != null && parseRef(r.b)?.obj === id) continue;
        const k = Array.isArray(r.a) ? r.a[0] : r.a;
        next.set(k, [...(next.get(k) || []), r]);
      }
      this.layout = next;
    }
    if (!keepPlace) this.objects.delete(id);
    // 镜头对准的里有它（camera a.2 以后 remove a / scene）：去掉，不然镜头一直对着一样没了的东西、新造的不框（审查第 4 条）
    if (!keepPlace && this.focus) { this.focus = this.focus.filter((r) => r !== id && parseRef(r)?.obj !== id); if (!this.focus.length) this.focus = null; }
    for (const [k, l] of this.links) if (l.a.obj === id || l.b.obj === id) this.links.delete(k);
    if (!keepLabels) for (const [k, l] of this.labels) if (l.refs.some((r) => parseRef(r)?.obj === id)) this.labels.delete(k);
    this.binds = this.binds.filter((b) => b.obj !== id);
    // 这样东西自己的拨盘（时间轴上的小人、条能动的一头）跟着没了
    for (const [k, v] of this.vars) {
      if (v.owner !== id) continue;
      this.vars.delete(k);
      // 跟着这个拨盘变的字（句子）：拨盘没了，不再跟（不然下一次重排会把模板原文写进句子），现状里写明
      for (const o of this.objects.values()) if (o.picks?.deps?.includes(k) && !o.picks.off) o.picks.off = 'gone';
    }
    for (const [k, e] of this.opens) if (e.obj === id) this.opens.delete(k);
    // 换了一样新的：上一样淡淡圈着的、做没做完、预写的做完 / 做对一步都不算了
    this.slips.delete(id);
    this.doneState.delete(id);
    this.reactions.delete(`${id}.done`);
    this.reactions.delete(`${id}.right`);
    this.spentDone.delete(id);
    this.dropAhead(`${id}.done`);
    this.dropAhead(`${id}.right`);
    if (this.picked?.obj === id) this.picked = null; // 学生点的是上一样的部件：不算了
    if (!keepSaves) { this.keeps.delete(id); this.autoKeep.delete(id); }
    // 学生最后那一下之前的样子：重造了就不算了（不然老师重造以后一句 back t 把重造悄悄抹掉）；存档照留
    this.lastBefore.delete(id);
  }

  // —— 一次点几样（ask pick）——
  /** 学生点着的几样画成什么（部件上的 pick，画面照它画圈）：reveal=on、之后已经变过一次的，变了的 changed（实线）、没变的 same（虚线淡掉）；别的都是 on */
  paintPicks() {
    const k = this.picked;
    const o = k && this.objects.get(k.obj);
    if (!o) return;
    const on = new Set(k.keys), ch = new Set(k.changed || []);
    for (const p of typeOf(o).parts(o)) {
      if (on.has(p.key)) p.pick = k.reveal && k.diffDone ? (ch.has(p.key) ? 'changed' : 'same') : 'on';
      else delete p.pick;
    }
  }
  clearPicks() {
    const o = this.picked && this.objects.get(this.picked.obj);
    if (o) for (const p of typeOf(o).parts(o)) delete p.pick;
  }

  // —— 跟着算的量（value.js）——
  /**
   * 一样东西在依赖图里的结：用了 {…} 的东西自己是一个（live，要重算）；各种东西还可以交出别的（乘积跟着 A、B，
   * 平面上的向量跟着别的向量），这些只拿来排先后、查环，重算照旧是它们自己的 derive / refresh
   */
  nodesOf(o) {
    const t = typeOf(o);
    const out = [];
    if (o.live) out.push({ id: o.id, obj: o.id, deps: o.live.deps, live: true, rec: o.live, text: t.liveText?.(o) ?? o.live.line });
    for (const n of t.depNodes?.(o) || []) out.push({ obj: o.id, ...n });
    return out;
  }
  liveNodes() { return [...this.objects.values()].flatMap((o) => this.nodesOf(o)); }
  /**
   * 加进来这几个结以后会不会转着圈：会就抛错（错误里列出环上的名字）。obj：换掉的是哪样东西（它原来的结不算）。
   * 环上没有跟着算的（只是乘积换着乘：C = A B 以后 A = C B）不管，照旧收下
   */
  liveCheck(add, obj) {
    if (!add.length) return;
    const ids = new Set(add.map((n) => n.id));
    const nodes = [...this.liveNodes().filter((n) => n.obj !== obj && !ids.has(n.id)), ...add];
    try { liveOrder(nodes); } catch (err) {
      const by = new Map(nodes.map((n) => [n.id, n]));
      if (err.cycle?.some((id) => by.get(id)?.live)) throw err;
    }
  }
  /**
   * 重算一个跟着算的：在原地改的（矩阵改格、平面上的向量挪过去）交给那种东西的 relive，别的照新的数重新造（remake）。
   * 变了返回 { id, changed: [{ ref, from, to }], parts（画面闪的部件） }；算不出来（不可逆、拿掉了、维数对不上）原来的值不动，
   * 记在 rec.error 里（舞台现状写给老师），第一次出错时返回 { id, changed: [], error }
   */
  relive(n) {
    const o = this.objects.get(n.obj);
    const t = typeOf(o);
    let r;
    try {
      r = t.relive ? t.relive(this, o, n) : this.remake(o);
    } catch (err) {
      if (n.rec.error === err.message) return null;
      n.rec.error = err.message;
      return { id: o.id, changed: [], error: err.message };
    }
    // 有的格算不出来、画成了「?」（remake）：原因照旧记在 rec.error（现状写给老师、拿它说要点的地方知道它不全）
    if (r.error) { const rec = this.nodesOf(this.objects.get(n.obj)).find((x) => x.live)?.rec || n.rec; rec.error = r.error; rec.marked = true; }
    else { delete n.rec.error; delete n.rec.marked; }
    return r.changed.length ? { id: o.id, changed: r.changed, parts: r.parts || [] } : null;
  }
  /**
   * 跟着算的东西被老师动了结构（换位置、转、行变换）：从此是一样普通的东西，记一笔（舞台现状里告诉老师它不再跟着哪几个式子变了）
   */
  unlive(o, src) {
    const L = o.live;
    if (!L) return;
    const exprs = L.exprs || (L.whole ? [L.whole] : (L.cells || []).map((k) => k.expr));
    o.unlived = { exprs: [...new Set(exprs)], src, by: this.actor || 'teacher' };
    delete o.live;
  }
  /**
   * 一排格子、图这类：造它的那一行照新的数重新造一遍（名字、位置不变；连线只留部件还在的）。
   * 老师后来在它上面做的（染色、旁边的数、访问号、拿掉的结点……）交给那种东西的 carry 按部件带到新造的那一份
   */
  remake(o) {
    const L = o.live;
    // 有的格算不出来了：那一格写「?」、别的照算（fillLine 的 loose）；那种东西收不下「?」（图的边权）就照旧整行不动、报错
    let f = fillLine(L.line, this, { loose: L.deps || [], raw: !!L.raw });
    if (!f) return { changed: [] };
    if (f.vals.every((v, i) => v === L.vals[i])) return { changed: [], ...(f.error ? { error: f.error } : {}) };
    const t = typeOf(o);
    let c, o2;
    try {
      // 照新的数重新造的是当时已经收下的一行：那种东西的 make 里后来加的检查不拦它（带 lenient）
      c = { ...parseScript(f.text)[0], lenient: true };
      if (!c?.cmd) throw new Error(c?.error || '看不懂这一行');
      o2 = t.make(this, c, this.helpers(c), o);
    } catch (err) {
      if (!f.error) throw err;
      f = fillLine(L.line, this, { raw: !!L.raw }); // 照旧：抛出算不出来的原因
    }
    Object.assign(o2, { type: o.type, id: o.id, live: { line: L.line, exprs: f.exprs, vals: f.vals, deps: f.deps, ...(L.raw ? { raw: true } : {}) } });
    // 画面上的样子照旧：藏着的还藏着，另起的那一列还是那一列
    if (o.hidden) o2.hidden = true;
    if (o.colStart) o2.colStart = true;
    t.carry?.(o, o2);
    this.objects.set(o.id, o2);
    // 部件没了的连线剪掉；连到整样东西的那一头没有部件（partOf(obj, null) 是 null），不能当成部件没了剪掉
    const lost = (e) => e.obj === o.id && e.key != null && !this.partOf(o.id, e.key);
    for (const [k, l] of this.links) if (lost(l.a) || lost(l.b)) this.links.delete(k);
    const changed = f.vals.map((v, i) => (v === L.vals[i] ? null : { ref: o.id, expr: f.exprs[i], from: L.vals[i], to: v })).filter(Boolean);
    return { changed, parts: t.parts(o2).slice(0, 12), ...(f.error ? { error: f.error, marked: true } : {}) };
  }

  /**
   * 跟着别的东西算出来的：先重算用了 {…} 的（按依赖的先后），再跑各种东西自己的 derive（乘积 C = A B：A、B 变了 C 跟着变）；
   * 重算到不再变。没有跟着算的时候最多三遍（链着的乘积，和以前一样），每多一个跟着算的多一遍。
   * 乘积的一格照旧一格一条 { part, before, after }，多带 id、changed（和跟着算的一样写，给老师的事实用）
   */
  derive() {
    const out = [];
    const nodes0 = this.liveNodes();
    const passes = 3 + nodes0.filter((n) => n.live).length;
    for (let pass = 0; pass < passes; pass++) {
      let changed = false;
      const nodes = pass ? this.liveNodes() : nodes0;
      const live = new Map(nodes.filter((n) => n.live).map((n) => [n.id, n]));
      if (live.size) {
        let order;
        try { order = liveOrder(nodes); } catch { order = nodes.map((n) => n.id); }
        for (const id of order) {
          const n = live.get(id);
          if (!n || !this.objects.has(n.obj)) continue;
          const r = this.relive(n);
          if (r) { out.push(r); if (r.changed.length) changed = true; }
        }
      }
      for (const o of this.objects.values()) {
        const r = typeOf(o).derive?.(this, o) || [];
        if (r.length) {
          for (const d of r) out.push(Object.assign(d, { id: o.id, changed: [{ ref: this.refOf(d.part), from: d.before, to: d.after }] }));
          changed = true;
        }
      }
      if (!changed) break;
    }
    return out;
  }
  // —— 扫一遍拨数（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 3.3）——
  /** 照依赖图（liveOrder 那几条边）直接、间接跟着拨数 name 算的东西（按舞台上的先后） */
  dependents(name) {
    const nodes = this.liveNodes();
    const hit = new Set();
    const objOf = (d) => (this.objects.has(d) ? d : parseRef(d)?.obj);
    for (let grew = true; grew;) {
      grew = false;
      for (const n of nodes) {
        if (hit.has(n.obj) || !(n.deps || []).some((d) => d === name || hit.has(objOf(d)))) continue;
        hit.add(n.obj);
        grew = true;
      }
    }
    return [...this.objects.keys()].filter((id) => hit.has(id));
  }
  /** id 和它一路跟着算的上游里有没有这一下算不出来的（停在上一次算出来的数：拿它说要点就是说错） */
  staleFrom(id) {
    const seen = new Set();
    const todo = [id];
    while (todo.length) {
      const x = todo.pop();
      if (seen.has(x) || !this.objects.has(x)) continue;
      seen.add(x);
      for (const n of this.nodesOf(this.objects.get(x))) {
        if (n.live && n.rec.error) return true;
        for (const d of n.deps || []) todo.push(this.objects.has(d) ? d : parseRef(d)?.obj);
      }
    }
    return false;
  }
  /**
   * 把拨数 name 能拨到的每个值都算一遍（不真拨：每个值在副本上 set、跟着重算）：[{ id, list: [{ v, brief }] }]。
   * 只取跟着它算（直接或间接）、规则交了 brief 的东西；算不出来、说不出要点的值 brief 是 null。能拨的值太多（超过 SWEEP_MAX）list 是 null
   */
  sweep(name) {
    const x = this.vars.get(name);
    if (!x) return [];
    const ids = this.dependents(name).filter((id) => typeof rulesOf(this.objects.get(id))?.brief === 'function');
    if (!ids.length) return [];
    const vals = dialValues(x);
    if (!vals) return ids.map((id) => ({ id, list: null }));
    const lists = ids.map(() => []);
    for (const v of vals) {
      const s = this.clone();
      s.vars.get(name).v = v;
      try { s.onVar(name); } catch { /* 跟着算的算不出来记在各自的 rec.error 上，下面照它说算不出来 */ }
      ids.forEach((id, i) => {
        const o = s.objects.get(id);
        let b = null;
        if (o && !s.staleFrom(id)) { try { b = rulesOf(o).brief(o) ?? null; } catch { b = null; } }
        lists[i].push({ v, brief: b });
      });
    }
    return ids.map((id, i) => ({ id, list: lists[i] }));
  }

  /**
   * 照给的挑战（ids）判每一句现在成不成立：[{ goal, clause, ok: true | false | null }]，不管做没做到——
   * 拨数的路每停一次标 ✓ ✗（stage.js 的 studentDo），只看还没做到的，做到的那一停就标不出 ✓。没有的挑战跳过
   */
  clauseMarks(ids = []) {
    return ids.flatMap((id) => { const g = this.goals.get(id); return g ? clauseMarks(this, g).map((m) => ({ goal: id, ...m })) : []; });
  }
  /**
   * 挑战判一遍：这一行以后刚做到的（做到了就一直算做到，不会因为学生接着拨又「没做到」）。「或」有一组都成立就算。
   * 按了按钮才判的（on=）跳过（judgeOn 判）。收集型（collect=）：条件成立、那样东西和收过的都不一样才收一张，收齐了才算做到；
   * 只收学生的一下（student），收了的 id 写进 out.collected
   */
  checkGoals({ student = false, out = null } = {}) {
    const met = [];
    for (const g of this.goals.values()) {
      if (g.met || g.on) continue;
      let ok = false;
      try { ok = evalWhen(this, altsOf(g)); } catch { ok = false; }
      if (!ok) continue;
      if (g.collect) {
        if (!this.collectOne(g, student)) continue;
        out?.collected.push(g.id);
        if (g.collect.got.length < g.collect.n) continue;
      }
      g.met = true;
      met.push(g.id);
    }
    return met;
  }
  /**
   * 收集型挑战的条件成立了：那样东西现在的样子和上一次看到的一样就不算（学生动的是别的）；不一样时记下，
   * 学生的一下、和收过的都不一样（sameMeasure）收一张（返回 true），一样的 dup + 1。老师的一下只记下看到了（不替学生收）
   */
  collectOne(g, student) {
    const c = g.collect;
    const o = this.objects.get(c.obj);
    let m = null;
    if (c.expr) { try { m = exprMeasure(this, c.obj); } catch { m = null; } } else m = o && typeOf(o).measure ? typeOf(o).measure(o) : null;
    if (!m) return false;
    if (c.last && sameMeasure(c.last, m) === true) return false;
    c.last = structuredClone(m);
    if (!student) return false;
    if (c.got.some((x) => sameMeasure(x, m) === true)) { c.dup++; return false; }
    c.got.push(structuredClone(m));
    return true;
  }
  /**
   * 学生按了这一轮的按钮（ask next 的「就这样」）：on= 写的是它、还没做到的挑战这时才判，成立了算做到（打勾、演 @g1 和别的挑战一样）。
   * 返回 [{ id, met, status }]（status 是 goalStatus 那一句，写给老师「按了以后判了什么」）
   */
  judgeOn(button) {
    const out = [];
    for (const g of this.goals.values()) {
      if (g.met || g.on == null || g.on !== button) continue;
      let ok = false;
      try { ok = evalWhen(this, altsOf(g)); } catch { ok = false; }
      if (ok) g.met = true;
      out.push({ id: g.id, met: ok, status: goalStatus(this, g) });
    }
    return out;
  }
  /** goal … collect=B n=3：收哪样东西（要能整个拿来比）、收几张 */
  collectSpec(opts, id) {
    const obj = String(opts.collect).trim();
    const n0 = Number(opts.n);
    const needN = () => { if (opts.n == null || !Number.isInteger(n0) || n0 < 1 || n0 > 12) throw new Error(`collect= 要跟着 n= 写收几张（1～12 的整数），比如 goal ${id} "…" when="…" collect=${obj} n=3`); };
    // collect={A v}（主线第二轮 B）：收的是那一刻算出来的值（不用先藏一张跟着算的矩阵）。写错了当场报；还空着的照收（填上以后算得出）
    if (isExpr(obj)) { exprMeasure(this, obj); needN(); return { obj, expr: true, n: n0, got: [], dup: 0, last: null }; }
    const o = this.objects.get(obj);
    if (!o) throw new Error(`collect= 写舞台上一样东西的名字（goal ${id} "…" when="…" collect=B n=3）：舞台上没有「${obj}」`);
    if (!typeOf(o).measure) throw new Error(`${typeOf(o).label}「${obj}」还不能整个拿来比，收不了（collect= 写矩阵、一排格子这种能整个比的）`);
    const n = Number(opts.n);
    if (opts.n == null || !Number.isInteger(n) || n < 1 || n > 12) throw new Error(`collect= 要跟着 n= 写收几张（1～12 的整数），比如 goal ${id} "…" when="…" collect=${obj} n=3`);
    return { obj, n, got: [], dup: 0, last: null };
  }
  /** 字里写了 {name: … | …} 的东西（句子）照拨盘现在的值重排（那种东西自己的 onPick）：交给画面的那几份（照各自的 choreo 演） */
  repick(name) {
    const out = [];
    for (const o of this.objects.values()) {
      if (!o.picks?.deps?.includes(name) || o.picks.off) continue;
      const r = typeOf(o).onPick?.(this, o);
      if (r) out.push(r);
    }
    return out;
  }
  /**
   * 一样东西给自己造了一个拨盘（时间轴上的小人、条的一头）：和老师写 dial 一样先查用它的字段数对不对得上（对不上抛错），
   * 造好以后拨盘没了的句子（picks.off === 'gone'）要是又对得上了就接着跟，跟着它的句子照新的值重排
   */
  ownDial(name, x) {
    this.checkPickUsers(name, x);
    this.vars.set(name, x);
    for (const o of this.objects.values()) {
      if (o.picks?.off !== 'gone' || !o.picks.deps.every((d) => this.vars.has(d))) continue;
      try { for (const p of splitPicks(o.picks.src)) if (p.k === 'pick') checkPick(p, this.vars); } catch { continue; } // 段数对不上：照旧不跟
      delete o.picks.off;
    }
    this.repick(name);
  }
  /** 拨盘 name 要换成 x：用了 {name: … | …} 的句子、贴的字、挑战的字，段数还对不对得上；对不上抛错（说是谁） */
  checkPickUsers(name, x) {
    const vars = new Map(this.vars).set(name, x);
    const chk = (text, who) => {
      for (const p of splitPicks(text)) {
        if (p.k !== 'pick' || !pickDeps(p.raw).includes(name)) continue;
        try { checkPick(p, vars); } catch (err) { throw new Error(`${who}里的${err.message}（先改那一处，或者拨盘照原来的个数造）`); }
      }
    };
    for (const o of this.objects.values()) if (o.picks && !o.picks.off) chk(o.picks.src, `${typeOf(o).label} ${o.id} `);
    for (const o of this.objects.values()) if (o.type === 'card') for (const ln of o.lines || []) chk(ln.text, `题卡 ${o.id} `);
    for (const l of this.labels.values()) if (!l.dial && l.text) chk(l.text, `贴的字 ${l.id} `);
    for (const g of this.goals.values()) chk(g.text, `挑战 ${g.id} `);
  }
  /** 有没有按这个按钮才判的挑战（舞台照它决定按钮要不要记一行 press） */
  hasOn(button) { return [...this.goals.values()].some((g) => !g.met && g.on === button); }
  // 拨的数变了：跟着它的东西（分组、平面上的变换……）重新算
  onVar(name) {
    const out = { name, regroup: [], binds: [] };
    for (const b of this.binds) {
      if (b.v !== name || !this.objects.has(b.obj)) continue;
      const o = this.objects.get(b.obj);
      const t = typeOf(o);
      const r = t.onVar?.(this, o, b, this.vars.get(name).v);
      if (r) { out.binds.push(r); if (b.kind === 'group') out.regroup.push(r); }
    }
    // 字里写了 {名字: … | …} 的东西（句子）：照现在那一段重排
    out.binds.push(...this.repick(name));
    // 写了 {k} 的（格里的 {k}、{k A}……）当场跟着重算：变了的交给 apply 一起写进 fx.derived
    const derived = this.derive();
    if (derived.length) out.derived = derived;
    return out;
  }
  /** 一部件找回来（跟着它走的写法） */
  partOf(obj, key) {
    const o = this.objects.get(obj);
    return o ? typeOf(o).parts(o).find((p) => p.key === key) || null : null;
  }

  /** 给老师看的「舞台上现在有什么」：和画面一定对得上（照场景写） */
  stateText() {
    const lines = [];
    // 第几幕、前面有哪几幕（舞台照 log 推好写在 sceneNote 上）；这一轮台上全换了又没写 scene 的那一句（swapNote）
    if (this.sceneNote) lines.push(this.sceneNote);
    if (this.swapNote) lines.push(this.swapNote);
    if (!this.objects.size) lines.push('舞台上还是空的。');
    // 版面（第八轮）：页面的求解器摆成了什么样（舞台每次摆完写在 layoutInfo 上）
    else if (this.layoutInfo?.length) lines.push(...this.layoutInfo);
    const hints = new Set();
    for (const o of this.objects.values()) { const t = typeOf(o); if (t.hint) hints.add(t.hint); }
    for (const h of hints) lines.push(h);
    for (const o of this.objects.values()) {
      const t = typeOf(o);
      const d = t.describe(o, this);
      if (o.hidden && d.length) d[0] = `（藏着，画面上不摆）${d[0]}`;
      lines.push(...d);
      // 页面数得出的量（rules.js 的 measures）和那种东西自己交的几句（树的 avl / bst），老师不用自己数
      const ml = measureLine(this, o, t.pageBits?.(o, this) || []);
      if (ml) lines.push(`  ${ml}`);
      // 照引擎走的（follow）：到了第几趟、下一趟做完该是什么样——老师不用自己算
      const fl = followLine(o, this);
      if (fl) lines.push(`  ${fl}`);
    }
    const lives = this.liveNodes().filter((n) => n.live);
    // 错误前面的「{式子}」和前面写的重了，去掉
    const why = (e) => e.replace(/^「\{[^{}]*\}」(算不出来：|里的)?/, '');
    const liveItem = (n) => `${n.text}${n.rec.error ? `（现在算不出来：${why(n.rec.error)}；${n.rec.marked ? '算不出来的那一格画的是「?」' : '停在上一次算出来的数'}）` : ''}`;
    // 开着整张拖（手势表写了 live 的：矩阵的 compare / put / merge）的那几样学生拖得动，另起一行照实说；别的、旧课照旧一行
    const dragged = new Set([...this.opens.values()].filter((e) => e.gesture?.live).map((e) => e.obj));
    const still = lives.filter((n) => !dragged.has(n.obj)), drag = lives.filter((n) => dragged.has(n.obj));
    if (still.length) lines.push(`跟着算的（依赖一变，页面当场重算；学生动不了）：${still.map(liveItem).join('；')}`);
    if (drag.length) lines.push(`跟着算的（依赖一变，页面当场重算；学生拨不了，只能拖整张（compare / put / merge））：${drag.map(liveItem).join('；')}`);
    const clipped = this.clipped.filter((id) => this.objects.has(id) && !this.objects.get(id).hidden);
    if (clipped.length) lines.push(`画面上看不全：${clipped.join('、')}`);
    if (this.tiny != null) lines.push(`字难认：整台缩到了 ${this.tiny} 成才放得下（东西太多或者太宽：拿掉几样、话写短一点，或者 camera 对准要看的那一处）`);
    for (const o of this.objects.values()) if (o.unlived) lines.push(`${o.id} 已经不跟着 ${o.unlived.exprs.map((e) => `{${e}}`).join('、')} 变了：${o.unlived.by === 'student' ? '学生' : '你'}动过它的结构（${o.unlived.src}），现在照现在的样子留着`);
    const ls = [...this.links.values()];
    if (ls.length) lines.push(`连线：${ls.map((l) => `${this.refOfKey(l.a)}–${this.refOfKey(l.b)}${l.color ? ` ${COLOR_NAMES[l.color]}` : ''}`).join('，')}`);
    const labels = [...this.labels.values()].filter((l) => !l.dial);
    // 写了 side=、那一边放不下、画面换到了另一边的：照实写（主线第一轮：以前只写「贴在 b」，老师不知道字不在写的那一边）
    const SIDE = { above: '上面', below: '下面', left: '左边', right: '右边' };
    const moved = (l) => (l.asked && l.side && l.placed && l.placed !== l.side ? `；写的是${SIDE[l.side] || l.side}，放不下，在${SIDE[l.placed] || l.placed}` : '');
    if (labels.length) lines.push(`贴着的字：${labels.map((l) => `${l.id}「${l.text}」${l.refs.length ? `（贴在 ${l.refs.join(' ')}${moved(l)}）` : ''}`).join('；')}`);
    const dials = [...this.vars].filter(([, v]) => v.shown);
    if (dials.length) lines.push(`能拨的数：${dials.map(([n, v]) => (v.options ? `${n} = ${varText(v)}（${v.options.join(' / ')}）` : `${n} = ${v.v}（${v.lo}～${v.hi}）`)).join('，')}`);
    const waitAt = [...this.dialAt].filter(([n]) => this.labels.has(`dial:${n}`));
    if (waitAt.length) lines.push(`${waitAt.map(([n, at]) => `${n} 要挂在 ${at} 上，${at} 还没造`).join('；')}（造出来就挂上去）`);
    // 扫一遍拨数：跟着拨数算的东西，每个能拨到的值的要点（页面不真拨），老师不用自己一个个试；全都说不出的不写
    for (const [n, v] of dials) {
      for (const e of this.sweep(n)) {
        if (e.list && e.list.every((y) => y.brief == null)) continue;
        const line = sweepLine(n, v, e.id, e.list);
        if (!lines.includes(line)) lines.push(line);
      }
    }
    if (this.say) lines.push(`最后说的话：${this.say}`);
    // 学生点着的几样（画面上圈着）：老师这一轮演完页面收掉；reveal=on 的变过一次以后写哪几个画了实线、哪几个虚线
    if (this.picked && this.objects.has(this.picked.obj)) lines.push(pickedLine(this, this.picked));
    // 问的、开放的、挑战要动的东西后来藏起来了：照写，补一句学生点不到（不然老师等一个永远不来的回答）
    const w = this.waiting;
    const asked = w ? [...w.refs, ...(Array.isArray(w.expect) ? w.expect : w.expect && this.isRef(w.expect) ? [w.expect] : [])] : [];
    if (w) lines.push(`在等学生：${{ tap: '点', drag: '拖', next: '点按钮', say: '打字回答', value: '填一个答案', pick: '点几样' }[w.kind]}${w.refs.length ? ` ${w.refs.join(' ')}` : ''}${w.standin ? '（这一轮的提问没演上，这是页面替你挂的）' : ''}${hiddenNote(this.hiddenIn(asked))}`);
    // 话、贴的字、题卡、挑战、标准答案里的 {verb: …}：老师写的是原形，拼成了什么要看得到（句子里的写在那个句子下面）。
    // 照规则变的（表里没有）标出来：标准答案拼错了，学生写对的会被判错
    const vf = [];
    const verbsIn = (text, where) => { if (!/\{\s*verb\s*:/.test(String(text ?? ''))) return; for (const p of splitPicks(String(text))) if (p.k === 'pick' && p.name === VERB) { const f = verbFact(p, this.vars); if (f && !vf.some((x) => x.endsWith(f))) vf.push(`${where}：${f}`); } };
    verbsIn(this.say, '话里');
    if (w) { verbsIn(w.prompt, '问的那一句里'); verbsIn(w.answer, '标准答案里'); }
    for (const l of this.labels.values()) if (!l.dial && l.text) verbsIn(l.text, `贴的字 ${l.id} 里`);
    for (const o of this.objects.values()) if (o.type === 'card') for (const ln of o.lines || []) verbsIn(ln.text, `题卡 ${o.id} 里`);
    for (const g of this.goals.values()) verbsIn(g.text, `挑战 ${g.id} 里`);
    if (vf.length) lines.push('页面拼的谓语：', ...vf.slice(0, 8).map((x) => `  ${x}`));
    const backText = (e) => `back（按钮「回到${e.name}」${this.keeps.get(e.obj)?.has(e.name) ? '' : '；还没存，按不了'}）`;
    const polText = (e) => [policyText(e.policy), e.input ? `input=${e.input}` : ''].filter(Boolean).join('、');
    const rangeText = (e) => (e.lo != null ? `，${e.lo}～${e.hi}` : '');
    // 画面挂得上、起点现在拿不到的（钩挂在折起来的词上，gestures.js 的 idleOf）：后面带一句为什么
    const idleNote = (e) => { const x = idleOf(this, e); return x ? `（${x.text}）` : ''; };
    const openText = (e) => { if (e.action === 'back') return `${e.obj} ${backText(e)}`; const o = this.objects.get(e.obj); const what = (e.input ? null : affordsOf(typeOf(o))[e.action]) || gestureText(e.gesture); const pol = polText(e); return `${e.refs.length ? e.refs.join(' ') : e.obj} ${e.action}（${what}${rangeText(e)}${pol ? `；${pol}` : ''}）${idleNote(e)}${hiddenNote(this.hiddenIn([e.obj]))}`; };
    // 画面还挂不上的手势（gestures.js 的 ARMED_GESTURES、ARMED_GRIPS），和起点一个都拿不到的（idleOf 的 all）：不说学生能动，单独一句（开着、不默默吞掉）
    const opens = [...this.opens.values()];
    const usable = (e) => armable(e.gesture) && !idleOf(this, e)?.all;
    const can = opens.filter(usable), cannot = opens.filter((e) => !usable(e));
    // 一样东西同一处开着几种按法（mark 滑、fold 点、move 按住再拖）：这样东西开着的合成一行，每一项写怎么按（gestures.js 的 PRESS_TEXT）
    const grabsOf = (e) => openGrabs(e, affordsOf(typeOf(this.objects.get(e.obj))));
    const mixedOn = (id) => { const xs = can.filter((e) => e.obj === id); return xs.some((a, i) => xs.slice(i + 1).some((b) => grabClash(grabsOf(a), grabsOf(b), () => this.opensMeet(a, b)).mixed.length)); };
    const pressText = (e) => [...new Set([...grabsOf(e)].map(pressOf))].map((p) => PRESS_TEXT[p]).join(' / ');
    const itemText = (e) => { if (e.action === 'back') return backText(e); const pol = polText(e); return `${e.refs.length ? `${e.refs.join(' ')} ` : ''}${e.action}（${pressText(e)}${rangeText(e)}${pol ? `；${pol}` : ''}）${idleNote(e)}`; };
    // 画面分不清同一处的几种按法时（gestures.js 的 ARMED_PRESS.mixed 是 false；Task 11 起 pointer.js 照 choosePress 分，是 true）：同一处按下去
    // 只拿得到先挂的那一项，画面照 seq 先后挂（stage.js 的 syncOpens），所以照实写那一处现在按得出的是先开的哪一项
    const winners = (id) => {
      const xs = can.filter((e) => e.obj === id);
      const out = [];
      for (const gr of new Set(xs.flatMap((e) => [...grabsOf(e)]))) {
        const at = xs.filter((e) => [...grabsOf(e)].some((g) => placeOf(g) === placeOf(gr)));
        if (new Set(at.flatMap((e) => [...grabsOf(e)].filter((g) => placeOf(g) === placeOf(gr)).map(pressOf))).size < 2) continue;
        const first = at.reduce((a, b) => ((b.seq || 0) < (a.seq || 0) ? b : a));
        if (!out.includes(first)) out.push(first);
      }
      return out;
    };
    const mixNote = (id) => (ARMED_PRESS.mixed ? '' : `；页面还分不清同一处的几种按法，那一处现在只按得出先开的 ${winners(id).map((e) => e.action).join('、')}`);
    const canItems = [], merged = [];
    for (const e of can) {
      if (!mixedOn(e.obj)) { canItems.push(openText(e)); continue; }
      if (can.find((x) => x.obj === e.obj) !== e) continue;
      // 合成的那一行自己一行（「s 开着：…」，开着就是学生能直接动的），跟在「学生能直接动的」后面
      merged.push(`${e.obj} 开着：${can.filter((x) => x.obj === e.obj).map(itemText).join('、')}${mixNote(e.obj)}${hiddenNote(this.hiddenIn([e.obj]))}`);
    }
    if (canItems.length) lines.push(`学生能直接动的：${canItems.join('；')}`);
    lines.push(...merged);
    if (cannot.length) lines.push(`开着、页面还画不了的（学生现在动不了）：${cannot.map(openText).join('；')}`);
    // 存档点：每样东西存着哪几个名字（back t "名字" 回去）、页面以后替老师存的
    for (const id of this.objects.keys()) {
      const names = [...(this.keeps.get(id)?.keys() || [])];
      const auto = [...(this.autoKeep.get(id) || [])];
      if (names.length || auto.length) lines.push(`${id} 存着：${names.join('、') || '没有'}${auto.map(([n, a]) => `；学生每做完一次 ${a} 页面存成「${n}」`).join('')}`);
    }
    if (this.slips.size) lines.push(`淡淡圈着（学生走偏的那一下，照你写的 wrong=mark；那样东西再变就收掉）：${[...this.slips.values()].map((x) => `${x.refs.join(' ')}（${x.src}）`).join('；')}`);
    // 现在就是做完的样子（写在平了的树上、学生删了再修：reopenable）：照实说什么时候才演
    const now = (id) => (this.doneState.get(id) ? '（现在就是做完的样子：学生动了它、又做完时才演）' : '');
    const pre = [...this.reactions].filter(([k, r]) => k.includes('.') && r.length).map(([k, r]) => { const [id, kind] = k.split('.'); return `${id} ${kind === 'done' ? '做完了' : '学生做对一步'}页面马上演你预写的 ${r.length} 行${kind === 'done' ? now(id) : ''}`; });
    // @ask.right：跟着这一问（等着的那一问拿走了）、还没被拿走（下一问）
    if (this.waiting?.right?.length) pre.push(`学生答对这一问时页面马上演你预写的 ${this.waiting.right.length} 行`);
    if (this.askRight?.length) pre.push(`下一问学生答对时页面马上演你预写的 ${this.askRight.length} 行`);
    for (const [k, p] of this.preRight) pre.push(`${groupText(k)}时出的那一问，学生答对时页面马上演你预写的 ${p.lines.length} 行`);
    // 套着的预写：挑战还没出（前一层演出 goal 那一刻才出），做到了演的行先记着
    for (const [id, a] of this.ahead) if (a.lines.length) pre.push(`挑战 ${id} 还没出（${groupText(a.from)}时才出），做到了页面马上演你预写的 ${a.lines.length} 行（第 ${a.depth} 层）`);
    if (pre.length) lines.push(`预写的：${pre.join('；')}`);
    for (const g of this.goals.values()) {
      // watch：只叫老师的条件（学生看不到）
      if (g.watch) { const st = goalStatus(this, g); lines.push(`盯着 ${g.id} when="${g.when}"：${g.met ? `成立过${st === '做到了' ? '' : `；${st.replace(/^做到过；/, '')}`}` : `${st.replace('还没做到', '还没成立')}（学生看不到；成立时马上叫你一次）`}`); continue; }
      const r = this.reactions.get(g.id);
      // 怎么判、什么时候叫你：做到了以后就不用再说
      const how = g.met ? '' : [g.on != null ? `学生按「${g.on}」时才判` : '', g.call === 'now' ? 'call=now：做到那一刻马上叫你' : ''].filter(Boolean).map((x) => `；${x}`).join('');
      lines.push(`挑战 ${g.id}「${g.text}」when="${g.when}"：${goalStatus(this, g)}${how}${r?.length ? `；做到了页面马上演你预写的 ${r.length} 行${g.collect && !g.met ? '（每收一张演一次）' : ''}` : ''}${g.met ? '' : hiddenNote(this.blockedByHidden(this.objectsIn(g.cond)))}`);
    }
    return lines.join('\n');
  }
  refOfKey(k) {
    if (k.key == null) return k.obj; // 整样东西的连线
    const p = this.partOf(k.obj, k.key);
    return p ? this.refOf(p) : `${k.obj}:${k.key}`;
  }
}

// 比的那一格的数写给老师看：负号写 −，空着的写 □
const cellText = (v) => (v === '' || v == null ? '□' : String(v).replace(/^-/, '−'));
/** 逐格比（compare P Q）写出几格不一样时最多列几格（6×8 的矩阵全列出来太长） */
export const COMPARE_LIST = 8;
/**
 * 学生把一张矩阵拖到另一张上比（fx.compare，scene 的 compare 两头是整张时交的）写给老师的一句：
 * 「学生把 P 拖到 Q 上比：4 格里 2 格不一样——(1,2) 3 和 5，(2,1) −1 和 1（两张都没变）」。给 fx 或 fx.compare 都行；不是整张比是 null
 */
export function compareFact(x) {
  const c = x?.whole ? x : x?.compare;
  if (!c?.whole) return null;
  const head = `学生把 ${c.a} 拖到 ${c.b} 上比：`;
  if (!c.diff) return `${head}${c.a} 是 ${c.shape.a.join('×')} 的，${c.b} 是 ${c.shape.b.join('×')} 的，不一样大，页面没逐格比（两张都没变）`;
  if (!c.diff.length) return `${head}${c.total} 格都一样（两张都没变）`;
  const list = c.diff.slice(0, COMPARE_LIST).map((d) => `(${d.r},${d.c}) ${cellText(d.a)} 和 ${cellText(d.b)}`).join('，');
  const more = c.diff.length > COMPARE_LIST ? `，还有 ${c.diff.length - COMPARE_LIST} 格` : '';
  return `${head}${c.total} 格里 ${c.diff.length} 格不一样——${list}${more}（两张都没变）`;
}
/**
 * 老师自己写的 compare 的结果写成一句（底座第二轮留下的第 3 条：以前只是动画，现状和发给老师的话里都没有结果，老师要自己再比）：
 * 两个部件「你比了 a.2 和 a.4：38 < 97」，两张矩阵照学生拖去比的那一句（换成「你比了」）。一样的两格、不是 compare 是 null
 */
export function compareNote(scene, fx) {
  if (fx?.compare?.whole) return compareFact(fx).replace(/^学生把 (\S+) 拖到 (\S+) 上比：/, '你比了 $1 和 $2：').replace('（两张都没变）', '');
  if (!fx?.a || !fx?.b || fx.sign == null || fx.a === fx.b) return null;
  const name = (p) => { try { return scene.tapRef(p); } catch { return '?'; } };
  // 两边不都是数（2a 和 10a、The 和 cat）：照字比出来的先后不是大小，只说一样不一样
  const num = (v) => /^[-−+]?\d+(\.\d+)?(\/\d+)?$/.test(String(v ?? '').trim());
  const sign = num(fx.a.value) && num(fx.b.value) ? (fx.sign < 0 ? '<' : fx.sign > 0 ? '>' : '=') : (fx.sign === 0 ? '=' : '≠');
  return `你比了 ${name(fx.a)} 和 ${name(fx.b)}：${cellText(fx.a.value)} ${sign} ${cellText(fx.b.value)}`;
}
/**
 * 学生把 X 拖到 Y 上并同类项（fx.merge = { x, y, from, into, to }）写给老师的一句：「学生把 X（−2A）拖到 Y（−A）上：并成了 −3A」；
 * 并成 0 写「并成了 O（抵消了）」。X 已经不在舞台上，裁判那样东西拿不到，所以照 fx 交（stage.js 的 factsOf）
 */
export function mergeFact(m) {
  if (!m) return null;
  return `学生把 ${m.x}（${termText(m.from)}）拖到 ${m.y}（${termText(m.into)}）上：并成了 ${m.to.k.zero ? 'O（抵消了）' : termText(m.to)}`;
}

/** 一行演完交的「预写的行没演」（fx.unplayed）写成给老师的几句（舞台交 onNote） */
export const unplayedNotes = (fx) => (fx?.unplayed || []).map((k) => unplayedText(k, { prewrite: fx.unplayedBy === 'prewrite', fresh: fx.goal || null }));
/**
 * 老师的行让挑战成立、让东西做完时，预写的行拿掉没演（fx.unplayed 的一项）：告诉老师的那一句。
 * prewrite：是舞台演你预写的行时成立的（不是你这一轮写的）；fresh：这一行刚写出的挑战（预写出的挑战一出来就已经成立）
 */
export function unplayedText(key, { prewrite = false, fresh = null } = {}) {
  const [id, kind] = String(key).split('.');
  if (kind === 'done') return `${prewrite ? '你预写的行' : '你这一轮'}把 ${id} 做完了，@${key} 的行没演`;
  if (prewrite && fresh === id) return `预写出的挑战 ${id} 一出来就已经成立了，@${id} 的行没演`;
  return `${prewrite ? '你预写的行让' : '你这一轮让'}挑战 ${id} 成立了，@${id} 的行没演`;
}

/** reveal= 只认 on / off；不写是 off（圈的虚实挂不挂出来给学生看是老师定的，页面不替老师开） */
function revealOf(v) {
  if (v == null) return false;
  if (v !== 'on' && v !== 'off') throw new Error(`reveal= 只能写 on（之后哪一下改了学生点的几样，变了的圈画实线、没变的画虚线淡掉）或 off，没有「${v}」`);
  return v === 'on';
}

/**
 * 学生点的这一个是不是老师预期的（ask tap … expect=）：expect 写一个部件、一段（a.1-3）、整样东西（AB）都行，点到里面哪一个都算，
 * 哪种东西都一样。按东西 + key 比（重放过的场景是新的一份，部件不是同一个对象）。expect 现在不在舞台上（学生动过）：null，比不了
 */
export function expectHit(scene, expect, part) {
  let ps;
  try { ps = scene.parts(expect); } catch { return null; }
  return ps.some((p) => p.obj === part.obj && p.key === part.key);
}

/**
 * 学生点了一下（ask tap）：回答 { type: 'tap', ref, pid, key, slot, value, expected?, right? }。
 * part 是挂这一问时拿到的那个部件：提问以后东西可能变过（预写的 rewrite 换了句子、别的格子挪了），照点的这一刻它在哪报
 * （主线第一轮 E1-3：以前报成提问那一刻的位置，老师照那个编号写下一轮指到的是另一个词）。它已经不在了就照当时的写
 */
export function tapAnswer(scene, part, expect) {
  const x = scene.partOf(part.obj, part.key) || part;
  const act = { type: 'tap', ref: scene.tapRef(x), pid: pidOf(x), key: x.key, slot: x.slot, value: tapValueOf(x) };
  // expect 写整样东西或一段：点到里面哪一个都算；比不了（预期的那几个不在了）是 null
  if (expect) { act.expected = expect; act.right = expectHit(scene, expect, x); }
  return act;
}

const uniqParts = (ps) => { const seen = new Set(); return ps.filter((p) => { const k = pidOf(p); if (seen.has(k)) return false; seen.add(k); return true; }); };
/**
 * 学生交了 ask pick（点了 refs 这几个）：和老师的 expect 比 → 回答 { type: 'pick', refs, expected, same, extra, missing }。
 * 交的那一刻在舞台上比（那时等着的那一问还在）；expect 里写一段、写整样东西是里面每一个都要点到。名字照 tapRef（点的先后照学生点的）。
 * 没写 expect：expected 是 null、same 是 null；预期的部件这一刻不在舞台上了：same 是 null，why 说为什么（不当学生点错）
 */
export function pickAnswer(scene, refs, expect, { order = false } = {}) {
  const mine = uniqParts(refs.flatMap((r) => scene.parts(r)));
  const out = { type: 'pick', refs: mine.map((p) => scene.tapRef(p)), expected: expect?.length ? expect.join(' ') : null, same: null, extra: [], missing: [] };
  if (!out.expected) return out;
  let want;
  try { want = uniqParts(expect.flatMap((w) => scene.parts(w))); } catch (err) { return { ...out, why: err.message }; }
  const W = new Set(want.map(pidOf)), P = new Set(mine.map(pidOf));
  out.extra = mine.filter((p) => !W.has(pidOf(p))).map((p) => scene.tapRef(p));
  out.missing = want.filter((p) => !P.has(pidOf(p))).map((p) => scene.tapRef(p));
  out.same = !out.extra.length && !out.missing.length;
  // order=on：点的是这几个，再照 expect 写的先后比（学生点的先后就是 mine 的先后）
  if (order) {
    out.order = true;
    if (out.same && mine.some((p, i) => pidOf(p) !== pidOf(want[i]))) { out.same = false; out.misordered = true; }
  }
  return out;
}
/** ask pick 的回答写给老师：学生点了 4 个：t.45、t.50、t.40、t.20——你预期的是 t.50 t.45 t.40 t.20：一样（多点了 t.30，漏了 t.20） */
export function pickText(a) {
  const refs = a?.refs || [];
  const head = `学生点了 ${refs.length} 个：${refs.join('、')}`;
  if (a?.expected == null) return head;
  const diff = a.same === true ? (a.order ? '一样，先后也对' : '一样')
    : a.misordered ? '是这几个，先后不对'
    : a.same == null ? `页面比不了${a.why ? `（${a.why}）` : ''}`
      : [a.extra?.length ? `多点了 ${a.extra.join('、')}` : '', a.missing?.length ? `漏了 ${a.missing.join('、')}` : ''].filter(Boolean).join('，');
  return `${head}——你预期的是 ${a.expected}${a.order ? '（order=on）' : ''}：${diff}`;
}
/**
 * 变过以后写一个部件（写给老师）：tapRef；有位置的（一排格子、句子的词）后面带上它现在的字（s.5（three））——挪过以后位置变了，
 * 光写 s.3 会被读成学生交的时候点的那个 s.3。扣着的照 tapValueOf 说一声扣着
 */
const partName = (scene, p) => (p.slot != null ? `${scene.tapRef(p)}（${tapValueOf(p)}）` : scene.tapRef(p));
// 点着的每一个现在叫什么：还在的照 partName；这一下没了的，照交的那一行写的（一个部件一个写法时对得上），后面说没了
function pickedNames(scene, picked) {
  const o = scene.objects.get(picked.obj);
  const byKey = new Map((o ? typeOf(o).parts(o) : []).map((p) => [p.key, p]));
  const aligned = picked.refs.length === picked.keys.length;
  return picked.keys.map((k, i) => ({ k, t: byKey.has(k) ? partName(scene, byKey.get(k)) : `${aligned ? picked.refs[i] : `${picked.obj} 里点过的一个`}（没了）` }));
}
const listOr = (xs) => (xs.length ? xs.join('、') : '没有');
/**
 * 学生点了几样以后，第一次改了那样东西的一下：学生先点的 3 个里，这一下以后变了的：t.45、t.40；没变的：t.20；变了却没点的：t.30。
 * keys 是这一下变了的部件（rules.js 的 changedKeys，再加上点过、这一下没了的）；空的写「没有」
 */
export function pickDiffText(scene, picked, keys) {
  const ch = new Set(keys);
  const mine = pickedNames(scene, picked);
  const o = scene.objects.get(picked.obj);
  const missed = (o ? typeOf(o).parts(o) : []).filter((p) => ch.has(p.key) && !picked.keys.includes(p.key)).map((p) => partName(scene, p));
  return `学生先点的 ${picked.keys.length} 个里，这一下以后变了的：${listOr(mine.filter((x) => ch.has(x.k)).map((x) => x.t))}；没变的：${listOr(mine.filter((x) => !ch.has(x.k)).map((x) => x.t))}；变了却没点的：${listOr(missed)}`;
}
// 舞台现状里点着的那一行
function pickedLine(scene, picked) {
  const mine = pickedNames(scene, picked);
  const ch = new Set(picked.changed || []);
  // reveal=on 还没揭晓：老师这一轮演完页面不收（stage.js 的 end），等之后第一下改了它们
  if (picked.reveal && !picked.diffDone) return `圈着学生点的：${mine.map((x) => x.t).join('、')}（reveal=on：之后第一下改了它们，变了的画实线、没变的画虚线；揭晓以前页面不收，不要了写 unpick ${picked.obj}）`;
  const how = picked.reveal ? `；reveal=on：变了的实线 ${listOr(mine.filter((x) => ch.has(x.k)).map((x) => x.t))}，没变的虚线 ${listOr(mine.filter((x) => !ch.has(x.k)).map((x) => x.t))}` : '';
  return `圈着学生点的：${mine.map((x) => x.t).join('、')}（你这一轮演完页面收掉${how}）`;
}

/**
 * 一整段镜头指令先在场景的副本上走一遍：哪几行写错了、错在哪（不动真的场景）。
 * 老师写完一轮以后页面用它查（也给测试、检查脚本用）。返回 [{ line, src, error }]
 */
export function dryRun(scene, src) {
  const s = scene.clone();
  const out = [];
  for (const c of parseScript(src)) {
    try { s.apply(c); } catch (err) { out.push({ line: c.line, src: c.src?.trim(), error: err.message }); }
  }
  return out;
}
