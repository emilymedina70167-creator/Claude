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
import { parseScript, parseRef, parseRich, addCommands } from './script.js';
import { TYPES, typeOf, CREATE } from './types/index.js';
import { bbox } from './layout.js';
import { parseGoal, evalGoal, goalStatus, checkPreds, clauseKey } from './goal.js';
import { checkSpec } from './answer.js';
import { parseLive, evalLive, fillLine, liveOrder } from './value.js';
import { rulesOf, done as nextDone, checkMeasure, measureLine } from './rules.js';
import { judge } from './referee.js';
import { gestureGrabs } from './gestures.js';

export const COLORS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
export const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
export const OBJECT_GAP = 70; // 两样东西上下摆开隔多远
const isColor = (w) => COLORS.includes(w);
const prime = (v) => String(v).replace(/[′']/g, '').replace(/[−–]/g, '-').trim();
// 数：整数、小数、分数（-3/4）
const numOf = (v) => {
  const t = prime(v);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = t.match(/^(-?\d+)\/(\d+)$/);
  return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
};

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

/** 一个部件在场景里的编号（画面用它找节点、话里的小块用它找部件）：'a:3'、't:A' */
export const pidOf = (p) => `${p.obj}:${p.key}`;

/** 这一行的原文（跟着算的东西记着它；行首的 & 不要） */
const lineOf = (c) => String(c.src ?? '').trim().replace(/^&\s*/, '');

/** 一种东西能开放给学生直接动的：{ 动作: 给老师看的一句 } */
export function affordsOf(t) {
  return { ...(t.drag ? { drag: '拖' } : {}), ...(t.affords || {}) };
}

// 手势表里的动作（rules.js 的 gestures：rotate、rowop、mark……）给老师看的一句：按五种通用手势说
const GESTURE_TEXT = { tap: '点', 'drop-on': '拖到上面', 'drop-at': '拖到空处', span: '拉一段', write: '写一个值' };
const gestureText = (g) => [].concat(g?.gesture || []).map((k) => GESTURE_TEXT[k] || k).join(' / ');
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

export class Scene {
  constructor() {
    this.objects = new Map(); // id → { type, id, origin, …（各种东西自己的数据） }
    this.links = new Map(); // key → { key, a: { obj, key }, b: { obj, key }, color, tier }
    this.labels = new Map(); // id → { id, refs, text, side, tone, link }
    this.vars = new Map(); // name → { v, lo, hi, at, shown }
    this.binds = []; // { kind, obj, v }：跟着拨的数变的
    this.focus = null; // null = 全部；或者部件的写法
    this.say = '';
    this.words = []; // 这一句话里能飞走的 [词]
    this.waiting = null; // { kind, refs, prompt, button, expect, answer }
    // —— 活的舞台（E 段）：学生随时能直接动的、挑战、挑战做到了马上演的 ——
    this.opens = new Map(); // 'B:edit' → { obj, action, refs, lo, hi }：开放给学生直接动的
    this.goals = new Map(); // id → { id, text, when, cond, met }
    this.reactions = new Map(); // 挑战 id → [行]：做到了的那一刻页面马上演（老师预写的确认和下一小问）
    this.labelRects = []; // 贴的字画在哪（stage.js 量了写回）：[{ x, y, w, h, objs }]，摆东西时后造的东西让开（reflow）
    // —— 裁判（referee.js）接进来以后 ——
    this.slips = new Map(); // 东西 id → { refs, src }：学生走偏的那一下淡淡圈着（open … wrong=mark），那样东西下一次变了就收掉
    this.doneState = new Map(); // 东西 id → 上一行以后做没做完（rules.js 的 done）：从没做完变成做完的那一行才算「学生做完了」
  }

  clone() {
    const s = new Scene();
    for (const [k, o] of this.objects) s.objects.set(k, structuredClone(o));
    for (const [k, l] of this.links) s.links.set(k, { ...l, a: { ...l.a }, b: { ...l.b } });
    for (const [k, l] of this.labels) s.labels.set(k, { ...l, refs: [...l.refs] });
    for (const [k, v] of this.vars) s.vars.set(k, { ...v });
    s.binds = this.binds.map((b) => ({ ...b }));
    s.focus = this.focus ? [...this.focus] : null;
    s.say = this.say;
    s.words = [...this.words];
    s.waiting = this.waiting ? { ...this.waiting } : null;
    for (const [k, v] of this.opens) s.opens.set(k, { ...v, refs: [...v.refs], ...(v.policy ? { policy: { ...v.policy } } : {}) });
    for (const [k, g] of this.goals) s.goals.set(k, structuredClone(g));
    for (const [k, r] of this.reactions) s.reactions.set(k, [...r]);
    s.labelRects = this.labelRects.map((r) => ({ ...r, objs: [...r.objs] }));
    for (const [k, v] of this.slips) s.slips.set(k, { ...v, refs: [...v.refs] });
    s.doneState = new Map(this.doneState);
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
    return t.pick(o, r.mark, r.sel, typeof word === 'string' ? word : `${r.obj}${r.mark}${r.sel}`);
  }
  /** 旧名字（只有一排格子的时候叫 cells） */
  cells(word) { return this.parts(word); }
  isRef(word) { const r = parseRef(word); return !!(r && this.objects.has(r.obj)); }
  /** 跟着它走的写法（a#3、t.A）：话里的小块、记录、给老师看都用它 */
  refOf(p) { return typeOf(this.objects.get(p.obj)).ref(p); }
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
  /** 各种东西挡着的地方（贴字时让开）：格子、序号、指针、树的边…… */
  obstacles() {
    return [...this.objects.values()].flatMap((o) => {
      const own = typeOf(o).obstacles ? typeOf(o).obstacles(o) : typeOf(o).parts(o).map((p) => typeOf(o).partBox(o, p));
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
    return x.v;
  }
  /** 新的一样东西放哪：已有东西的下面，和它们居中对齐 */
  slotFor(w) {
    if (!this.objects.size) return { x: 0, y: 0 };
    const b = bbox([...this.objects.keys()].map((id) => this.objectBox(id)));
    return { x: Math.round(b.x + b.w / 2 - w / 2), y: b.y + b.h + OBJECT_GAP };
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
      else if (p.k === 'measure' && !c?.lenient) checkMeasure(this, p.v, { run: true });
    }
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
    const target = this.ownTarget(c);
    const before = j?.by === 'student' && this.objects.has(j.obj) ? structuredClone(this.objects.get(j.obj)) : null; // 学生这一下以后的事实要比前后
    if (target) this.unslip(target); // 那样东西又变了：上一下淡淡圈着的收掉
    // 这一行是谁做的（unlive 写给老师「你 / 学生动过它的结构」）；重放时老师的行不给 by，当老师的
    this.actor = by === 'student' || j?.by === 'student' ? 'student' : 'teacher';
    let fx;
    try { fx = this.applyOne(c) || {}; } finally { this.actor = null; }
    this.reflow();
    const derived = [...(fx.derived || []), ...this.derive()];
    if (derived.length) fx.derived = derived;
    // 跟着算的重算以后可能变大了（{A B} 多了一行、格里的数变长）：摆在下面的往下让（乘积的一格照旧不重排，和以前一样）
    if (derived.some((d) => !d.part && d.changed.length)) this.reflow();
    const reactions = [];
    const ruleErrors = []; // 规则自己出错（facts、next 抛了）：不拦这一行，交给画面记进出错记录（stage.js）
    if (j) {
      fx.judged = j;
      const o = this.objects.get(j.obj);
      // 这一下以后写给老师的事实（规则交的：谁转上来了、哪一行变成什么、key 里还差几段）
      if (before && o) { try { j.after = rulesOf(o)?.facts(before, o, j.act) || []; } catch (err) { j.after = []; ruleErrors.push(`${typeOf(o).label}的规则写事实时出错：${err?.message || err}`); } }
      if (j.mark && o) this.slip(j.obj, c, j.act);
      // 学生做对一步：老师预写的确认、下一小问（@t.right，只演一次）
      if (j.by === 'student' && j.verdict?.right === true) reactions.push(...this.take(`${j.obj}.right`).map((src) => ({ right: j.obj, src })));
    }
    const met = this.checkGoals();
    if (met.length) {
      fx.goalsMet = met;
      reactions.push(...met.flatMap((id) => this.take(id).map((src) => ({ goal: id, src }))));
    }
    // 学生（或老师）这一行把交给学生做的东西做完了：@t.done 的行交出来，课堂按 by 决定叫不叫老师
    const fin = this.checkDone(ruleErrors);
    if (ruleErrors.length) fx.ruleErrors = ruleErrors;
    if (fin.length) {
      fx.done = fin;
      reactions.push(...fin.flatMap((id) => this.take(`${id}.done`).map((src) => ({ done: id, src }))));
    }
    if (reactions.length || met.length) fx.reactions = reactions;
    return fx;
  }
  /** 预写的行拿出来（演一次就没了） */
  take(key) { const r = this.reactions.get(key) || []; this.reactions.delete(key); return r; }

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
    try { act = rules.actOf(o, c, this.helpers(c)); } catch { act = null; } // 写得读不懂的：交给那种东西自己的指令报错
    if (!act) return null;
    const policy = by === 'student' ? this.policyOf(id, open, c.cmd) : {};
    const base = { obj: id, act, src: lineOf(c), by, policy };
    try {
      return { ...base, ...judge(this, id, act, policy, { by }) };
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
  /** 交给了学生做的东西（open 了规则 doneBy 里的动作）里，这一行从没做完变成做完了的；刚交给学生时已经做完的不算 */
  checkDone(errors = []) {
    const out = [];
    const seen = new Set();
    for (const e of this.opens.values()) {
      if (seen.has(e.obj) || !this.doneOpen(e.obj)) continue;
      seen.add(e.obj);
      let now = false;
      try { now = nextDone(this, e.obj); } catch (err) { now = false; errors.push(`${e.obj} 的规则算下一步时出错：${err?.message || err}`); }
      const was = this.doneState.get(e.obj);
      this.doneState.set(e.obj, now);
      if (now && was === false) out.push(e.obj);
    }
    for (const id of [...this.doneState.keys()]) if (!seen.has(id)) this.doneState.delete(id);
    return out;
  }
  /** 这样东西交给学生做了没有（open 了它的规则说「做完」要看的动作） */
  doneOpen(id) {
    const by = rulesOf(this.objects.get(id))?.doneBy || [];
    return [...this.opens.values()].some((e) => e.obj === id && by.includes(e.action));
  }

  // @g1 开头的行：先记着，g1 做到了再演。在现在的舞台上把这一挑战记着的行连着试一遍，写错了当场告诉老师
  stash(c) {
    if (String(c.on).includes('.')) return this.stashOn(c);
    const g = this.goals.get(c.on);
    if (!g) throw new Error(`先写 goal ${c.on} "给学生看的挑战" when="…"，再写 @${c.on} 开头的行`);
    if (g.met) throw new Error(`挑战 ${c.on} 已经做到了，@${c.on} 的行不会再演`);
    const list = this.reactions.get(c.on) || [];
    const trial = this.clone();
    trial.goals.get(c.on).met = true;
    trial.trial = true; // 这是在今天的舞台上试：真演的时候学生已经动过了（「现在就成立」这种检查不算数，换成比条件的字）
    for (const x of parseScript([...list, c.body].join('\n'))) {
      if (x.on) throw new Error('@ 的行里不能再写 @');
      if (c.lenient) x.lenient = true; // 重放旧课：预写的行当时收下了，照样收下（不加新的检查）
      const fx = trial.applyOne(x);
      // 预写的挑战，条件每一句都在 g1 的条件里：g1 一做到它就成立，学生不用再动手（今天的舞台上学生还没动，查不出来，所以比条件的字）
      if (fx?.goal && !c.lenient) {
        const mine = new Set(g.cond.map(clauseKey));
        if (trial.goals.get(fx.goal).cond.every((cl) => mine.has(clauseKey(cl)))) throw new Error(`挑战 ${fx.goal} 的条件在 ${c.on} 做到时就已经成立了，学生不用再动手；换一个要学生再动手才做得到的条件`);
      }
    }
    this.reactions.set(c.on, [...list, c.body]);
    return { stashed: c.on };
  }
  /**
   * @t.done / @t.right 开头的行：t 做完了（规则说没有下一步了）、学生在 t 上做对一步时页面马上演（硬性规定：只收做对了、做完了；
   * 走偏以后说什么永远等老师看着学生写）。在今天的舞台上连着试一遍，写错了当场告诉老师
   */
  stashOn(c) {
    const [name, kind] = String(c.on).split('.');
    if (kind === 'wrong') throw new Error('走偏以后怎么讲要等你看着学生写，不能预写');
    if (kind !== 'done' && kind !== 'right') throw new Error(`@${name}. 后面只能写 done（做完了）或 right（学生做对一步），没有「${kind}」`);
    const o = this.objects.get(name);
    if (!o) throw new Error(this.goals.has(name) ? `${name} 是挑战：做到了演的行写 @${name}，@名字.${kind} 写在舞台上的东西上` : `舞台上没有「${name}」`);
    const rules = rulesOf(o);
    if (!rules) throw new Error(`${typeOf(o).label}页面判不了对错（没有规则），@${name}.${kind} 的行不会演`);
    // 先查写下去能不能起作用：要交给学生的是页面判对错（.right）、能做完（.done）的动作；规则现在算得出下一步。起不了作用的当场说为什么
    const need = kind === 'done' ? rules.doneBy : rules.judges;
    const given = [...this.opens.values()].some((e) => e.obj === name && need.includes(e.action));
    if (!given) throw new Error(`先把要做的交给学生（${need.map((a) => `open ${name} ${a}`).join(' / ') || `${typeOf(o).label}没有页面判得了的动作`}），@${name}.${kind} 的行才会演`);
    if (!c.lenient) {
      let nx;
      try { nx = rules.next(o, this); } catch (err) { throw new Error(`页面算不出 ${name} 的下一步（${err.message}），@${name}.${kind} 的行不会演`); }
      if (nx === null) throw new Error(`${name} 现在就已经做完了（没有下一步），学生不用再动手，@${name}.${kind} 的行不会演`);
      if (!nx?.acts?.length) throw new Error(`页面判不了 ${name}：${nx?.why || '算不出下一步'}，@${name}.${kind} 的行不会演`);
    }
    const key = `${name}.${kind}`;
    const list = this.reactions.get(key) || [];
    const trial = this.clone();
    trial.trial = true;
    for (const x of parseScript([...list, c.body].join('\n'))) {
      if (x.on) throw new Error('@ 的行里不能再写 @');
      if (c.lenient) x.lenient = true;
      trial.applyOne(x);
    }
    this.reactions.set(key, [...list, c.body]);
    return { stashed: key };
  }

  applyOne(c) {
    if (!c.cmd) throw new Error(c.error || '看不懂这一行');
    const h = this.helpers(c);
    const { cmd } = c;
    const { args, opts, words, str, arrow, refsIn, partsIn, strayRefs } = h;
    // 造一样东西（array / tree / matrix……）
    if (CREATE[cmd]) {
      const t = CREATE[cmd];
      const id = words[0];
      if (!id || !/^[A-Za-z_]\w*$/.test(id)) throw new Error(`要写成 ${cmd} 名字 = …（名字用英文字母开头）`);
      if (id === 'say' || id.startsWith('dial')) throw new Error(`「${id}」这个名字留着别的用，换一个`);
      const old = this.objects.get(id);
      // 一排格子、图这类：造它的那一行里的 {…} 先算成数再造（依赖一变照新的数重新造，见 remake）；
      // 矩阵、平面自己拆 {…}（格子在原地改）；别的东西（题卡、句子、式子）的 {…} 写在引号里，是话里的小块
      const filled = t.remake ? fillLine(h.line, this) : null;
      const cc = filled ? parseScript(filled.text)[0] : c;
      if (!cc?.cmd) throw new Error(cc?.error || '看不懂这一行');
      const o = t.make(this, cc, filled ? this.helpers(cc) : h, old);
      // 式子里没用到舞台上的东西（{2^3}）就只是一个数，不算跟着算的
      if (filled?.deps.length) o.live = { line: h.line, exprs: filled.exprs, vals: filled.vals, deps: filled.deps };
      o.type = t.type;
      o.id = id;
      // 跟着算的不能转着圈（X 跟着 Y、Y 又跟着 X）：先查，写错了舞台上已有的东西不动
      this.liveCheck(this.nodesOf(o), id);
      if (old) this.dropObject(id, { keepLabels: true });
      this.objects.set(id, o);
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
        const parts = partsIn();
        if (parts.length !== 2) throw new Error('compare 要正好两个（比如 compare a.3 a.8）');
        return { a: parts[0], b: parts[1], sign: compareValues(parts[0].value, parts[1].value) };
      }
      case 'link': {
        strayRefs();
        const parts = partsIn();
        if (parts.length < 2) throw new Error('link 要至少两个');
        const color = words.find(isColor) || 'g1';
        const made = [];
        for (let i = 0; i + 1 < parts.length; i++) made.push(this.addLink(parts[i], parts[i + 1], color));
        return { links: made.filter(Boolean) };
      }
      case 'unlink': {
        strayRefs();
        const parts = refsIn().length ? partsIn() : null;
        const ids = parts ? new Set(parts.map(pidOf)) : null;
        const gone = [];
        for (const [k, l] of this.links) if (!ids || ids.has(`${l.a.obj}:${l.a.key}`) || ids.has(`${l.b.obj}:${l.b.key}`)) { this.links.delete(k); gone.push(k); }
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
        this.labels.set(id, { id, refs, text: str, side: opts.side || null, tone: opts.tone || null, link: null });
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
        for (const k of ids) { this.labels.delete(k); if (k.startsWith('dial:') && this.vars.get(k.slice(5))) this.vars.get(k.slice(5)).shown = false; }
        return { ids };
      }
      case 'dial': {
        // dial d = 5 range=1-5 at=a
        const [name, val] = words;
        if (!name || !/^[A-Za-z_]\w*$/.test(name)) throw new Error('要写成 dial 名字 = 值 range=1-9');
        const [lo, hi] = parseRange(opts.range || '1-9');
        if (!(lo <= hi)) throw new Error('range 要写成 小..大，比如 range=1..5、range=-3..3（1-5 也认）');
        const v = Number(val ?? lo);
        const at = opts.at || [...this.objects.keys()][0] || null;
        this.vars.set(name, { v: Math.max(lo, Math.min(hi, v)), lo, hi, at, shown: true });
        this.labels.set(`dial:${name}`, { id: `dial:${name}`, refs: at && this.objects.has(at) ? [at] : [], text: '', side: 'below', tone: 'dial', link: null, dial: name });
        return { name };
      }
      case 'set': {
        const x = this.vars.get(words[0]);
        if (!x) throw new Error(`没有叫「${words[0]}」的数`);
        const v = Number(words[1]);
        if (!Number.isFinite(v)) throw new Error('要写成 set 名字 值');
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
        if (!this.words[n - 1]) throw new Error(`上一句话里没有第 ${n} 个 [词]`);
        const id = args[arrow + 1]?.v;
        if (arrow < 0 || !id) throw new Error('要写成 fly say.1 -> 名字 贴在哪');
        const refs = refsIn(args.slice(arrow + 2));
        refs.forEach((r) => this.parts(r));
        this.labels.set(id, { id, refs, text: this.words[n - 1], side: opts.side || null, tone: 'key', link: null });
        return { id, word: n - 1 };
      }
      case 'ask': {
        const kind = words[0];
        if (!['tap', 'drag', 'next', 'say', 'value'].includes(kind)) throw new Error(`ask 后面写 tap / drag / next / say / value，没有「${kind}」`);
        if (str) this.checkRich(str, c);
        const refs = refsIn(args.slice(1));
        refs.forEach((r) => this.parts(r));
        if (kind === 'drag') {
          const ps = refs.flatMap((r) => this.parts(r));
          if (ps.length < 1) throw new Error('ask drag 要写能拖的东西');
          for (const o of new Set(ps.map((p) => p.obj))) if (!typeOf(this.objects.get(o)).drag) throw new Error(`${typeOf(this.objects.get(o)).label}不能拖`);
        }
        // ask value：answer= 可以不写（只收不判）、可以是 {式子}；type= wrong= free= 见 answer.js。
        // 写下时 {式子} 现算一遍、answer 和每条错答照 type 造好判法，对不上当场报；重放旧课不加新的检查（当时收下的照样收下）
        const spec = kind === 'value' ? { type: opts.type, answer: opts.answer, wrongs: opts.wrong, free: opts.free } : null;
        if (spec) checkSpec(spec, this, { strict: !c.lenient });
        if (str != null) { this.say = str; this.words = parseRich(str).filter((p) => p.k === 'word').map((p) => p.v); }
        this.waiting = { kind, refs, prompt: str ?? '', button: opts.button || null, expect: opts.expect || null, answer: opts.answer ?? null, type: spec?.type ?? null, wrongs: spec?.wrongs ?? null, free: spec?.free ?? null };
        if (opts.expect) this.parts(opts.expect);
        return { kind };
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
        // 跟着算的（{A + B}、{A v}）：数是页面照式子算的，学生拨了、拖了也会被算回去
        if (o.live || (r.mark && this.parts(target).some((p) => p.live))) throw new Error(`${o.live ? o.id : target} 是跟着算的，学生动不了`);
        t.canOpen?.(this, o, action, h);
        const policy = policyIn(opts, rules, { label: t.label, id: o.id, action });
        const e = { obj: o.id, action, refs: r.mark ? [target] : [], lo: null, hi: null, policy, gesture: gestures[action] || null };
        // input=keypad：写一个值的手势用数字键盘（open M edit input=keypad）；不写照旧（矩阵的 edit 是 ± 拨数器）
        if (opts.input != null) {
          if (opts.input !== 'keypad') throw new Error(`input= 只能写 keypad（数字键盘，能写分数、负数），没有「${opts.input}」`);
          if (!(gestures[action] && [].concat(gestures[action].gesture).includes('write'))) throw new Error(`input=keypad 只用在写一个值的动作上（${Object.entries(gestures).filter(([, g]) => [].concat(g.gesture).includes('write')).map(([k]) => `open ${o.id} ${k}`).join(' / ') || `${t.label}没有`}），${action} 用不上`);
          e.input = 'keypad';
        }
        // 拨数器默认 -9～9；键盘写的值不写 range= 就不限（写了照它收，gestures.js 的 writeRange）
        if (action === 'edit' && !(e.input && opts.range == null)) {
          const [lo, hi] = parseRange(opts.range || '-9..9');
          if (!(lo <= hi)) throw new Error('range 要写成 小..大，比如 range=-3..3');
          e.lo = lo; e.hi = hi;
        }
        // 同一样东西上另一项开着的、要用手指抓同一处的（open t 和 open t rotate 都拖结点、open t insert 和 place 都拖托盘、
        // open s mark 和 fold 都按词）：同一处按下去只拿得到先挂的那一个，后开的这一项学生永远用不上——当场报，不默默收下
        const grabs = (x) => (x.action === 'drag' || (affords[x.action] && !x.input) ? new Set(['part']) : gestureGrabs(x.gesture));
        const keysOf = (x) => { if (!x.refs.length) return null; try { return new Set(x.refs.flatMap((rf) => this.parts(rf)).map((p) => p.key)); } catch { return null; } };
        const meet = (a, b) => { const A = keysOf(a), B = keysOf(b); return !A || !B || [...A].some((k) => B.has(k)); };
        for (const [k, x] of this.opens) {
          if (x.obj !== o.id || k === `${o.id}:${action}`) continue;
          const shared = [...grabs(e)].filter((gr) => grabs(x).has(gr) && (gr !== 'part' || meet(e, x)));
          if (!shared.length) continue;
          const xwhat = (x.input ? null : affords[x.action]) || gestureText(x.gesture);
          throw new Error(`${o.id} 已经开着 ${x.action}（${xwhat}），${action} 也要用手指抓${shared.includes('part') ? '同样的部件' : '同一处'}，学生只做得了先开的那一种：一次开一种，先 close ${o.id} ${x.action} 再 open ${o.id} ${action}`);
        }
        this.opens.set(`${o.id}:${action}`, e);
        return { open: e };
      }
      case 'close': {
        // close B / close B edit / close（全收起）
        const ids = [...this.opens.keys()].filter((k) => { const e = this.opens.get(k); return (!words[0] || e.obj === parseRef(words[0])?.obj) && (!words[1] || e.action === words[1]); });
        if (words[0] && !ids.length) throw new Error(`「${words.join(' ')}」没有开放着`);
        ids.forEach((k) => this.opens.delete(k));
        return { closed: ids };
      }
      case 'goal': {
        // goal g1 "改 B 里的一个数，让 AB 还是 O" when="C = O"：给学生的挑战；页面每一下都判，做到了马上告诉老师
        const id = words[0];
        if (!id || !/^[A-Za-z_]\w*$/.test(id)) throw new Error('要写成 goal 名字 "给学生看的挑战" when="C = O, D != O"');
        if (this.objects.has(id)) throw new Error(`「${id}」是舞台上一样东西的名字，挑战换一个名字（g1、g2……）`);
        if (str == null) throw new Error(`要写成 goal ${id} "给学生看的挑战" when="…"（挑战的话写在引号里）`);
        if (!opts.when) throw new Error(`goal ${id} 要写 when="做到什么算做到"（比如 when="C = O, D != O"），页面照它判`);
        this.checkRich(str, c);
        const cond = parseGoal(opts.when);
        checkPreds(this, cond, { run: !c.lenient });
        // 老师当场写的挑战一写下就成立，多半是写错了，当场告诉老师；预写的行、重放的时候学生可能已经做到了：照收，下面马上算做到
        if (!this.trial && !c.lenient && evalGoal(this, cond)) throw new Error(`「${opts.when}」现在就已经成立了：挑战要学生动手以后才做得到`);
        this.goals.set(id, { id, text: str, when: opts.when, cond, met: false });
        this.reactions.delete(id);
        return { goal: id };
      }
      case 'ungoal': {
        const ids = words.length ? words : [...this.goals.keys()];
        for (const k of ids) if (!this.goals.has(k)) throw new Error(`没有叫「${k}」的挑战`);
        ids.forEach((k) => { this.goals.delete(k); this.reactions.delete(k); });
        return { ungoal: ids };
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
   * 东西长大了（树多长了一层、矩阵多了一行、题卡加了一行）：摆在它下面的往下让，不压着它。
   * 只往下推、不往上拉（老师和学生看惯了的位置不乱跳）；按摆上舞台的先后
   */
  reflow() {
    const list = [...this.objects.values()];
    const order = new Map(list.map((o, i) => [o.id, i]));
    for (let i = 1; i < list.length; i++) {
      const o = list[i];
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
      if (me.y < need && o.origin) o.origin = { ...o.origin, y: o.origin.y + (need - me.y) };
    }
  }

  linkKey(a, b) { return [pidOf(a), pidOf(b)].sort().join('~'); }
  addLink(a, b, color, tier = 0) {
    const key = this.linkKey(a, b);
    if (this.links.has(key)) { const l = this.links.get(key); l.color = color; return null; }
    this.links.set(key, { key, a: { obj: a.obj, key: a.key }, b: { obj: b.obj, key: b.key }, color, tier });
    return key;
  }
  dropObject(id, { keepLabels = false } = {}) {
    this.objects.delete(id);
    for (const [k, l] of this.links) if (l.a.obj === id || l.b.obj === id) this.links.delete(k);
    if (!keepLabels) for (const [k, l] of this.labels) if (l.refs.some((r) => parseRef(r)?.obj === id)) this.labels.delete(k);
    this.binds = this.binds.filter((b) => b.obj !== id);
    for (const [k, e] of this.opens) if (e.obj === id) this.opens.delete(k);
    // 换了一样新的：上一样淡淡圈着的、做没做完、预写的做完 / 做对一步都不算了
    this.slips.delete(id);
    this.doneState.delete(id);
    this.reactions.delete(`${id}.done`);
    this.reactions.delete(`${id}.right`);
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
    delete n.rec.error;
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
    const f = fillLine(L.line, this);
    if (!f) return { changed: [] };
    if (f.vals.every((v, i) => v === L.vals[i])) return { changed: [] };
    const c = parseScript(f.text)[0];
    if (!c?.cmd) throw new Error(c?.error || '看不懂这一行');
    const t = typeOf(o);
    const o2 = t.make(this, c, this.helpers(c), o);
    Object.assign(o2, { type: o.type, id: o.id, live: { line: L.line, exprs: f.exprs, vals: f.vals, deps: f.deps } });
    t.carry?.(o, o2);
    this.objects.set(o.id, o2);
    for (const [k, l] of this.links) if ((l.a.obj === o.id && !this.partOf(o.id, l.a.key)) || (l.b.obj === o.id && !this.partOf(o.id, l.b.key))) this.links.delete(k);
    const changed = f.vals.map((v, i) => (v === L.vals[i] ? null : { ref: o.id, expr: f.exprs[i], from: L.vals[i], to: v })).filter(Boolean);
    return { changed, parts: t.parts(o2).slice(0, 12) };
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
  /** 挑战判一遍：这一行以后刚做到的（做到了就一直算做到，不会因为学生接着拨又「没做到」） */
  checkGoals() {
    const met = [];
    for (const g of this.goals.values()) {
      if (g.met) continue;
      let ok = false;
      try { ok = evalGoal(this, g.cond); } catch { ok = false; }
      if (ok) { g.met = true; met.push(g.id); }
    }
    return met;
  }
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
    if (!this.objects.size) lines.push('舞台上还是空的。');
    const hints = new Set();
    for (const o of this.objects.values()) { const t = typeOf(o); if (t.hint) hints.add(t.hint); }
    for (const h of hints) lines.push(h);
    for (const o of this.objects.values()) {
      const t = typeOf(o);
      lines.push(...t.describe(o, this));
      // 页面数得出的量（rules.js 的 measures）和那种东西自己交的几句（树的 avl / bst），老师不用自己数
      const ml = measureLine(this, o, t.pageBits?.(o, this) || []);
      if (ml) lines.push(`  ${ml}`);
    }
    const lives = this.liveNodes().filter((n) => n.live);
    // 错误前面的「{式子}」和前面写的重了，去掉
    const why = (e) => e.replace(/^「\{[^{}]*\}」(算不出来：|里的)?/, '');
    if (lives.length) lines.push(`跟着算的（依赖一变，页面当场重算；学生动不了）：${lives.map((n) => `${n.text}${n.rec.error ? `（现在算不出来：${why(n.rec.error)}；停在上一次算出来的数）` : ''}`).join('；')}`);
    for (const o of this.objects.values()) if (o.unlived) lines.push(`${o.id} 已经不跟着 ${o.unlived.exprs.map((e) => `{${e}}`).join('、')} 变了：${o.unlived.by === 'student' ? '学生' : '你'}动过它的结构（${o.unlived.src}），现在照现在的样子留着`);
    const ls = [...this.links.values()];
    if (ls.length) lines.push(`连线：${ls.map((l) => `${this.refOfKey(l.a)}–${this.refOfKey(l.b)}${l.color ? ` ${COLOR_NAMES[l.color]}` : ''}`).join('，')}`);
    const labels = [...this.labels.values()].filter((l) => !l.dial);
    if (labels.length) lines.push(`贴着的字：${labels.map((l) => `${l.id}「${l.text}」${l.refs.length ? `（贴在 ${l.refs.join(' ')}）` : ''}`).join('；')}`);
    const dials = [...this.vars].filter(([, v]) => v.shown);
    if (dials.length) lines.push(`能拨的数：${dials.map(([n, v]) => `${n} = ${v.v}（${v.lo}～${v.hi}）`).join('，')}`);
    if (this.say) lines.push(`最后说的话：${this.say}`);
    if (this.waiting) lines.push(`在等学生：${{ tap: '点', drag: '拖', next: '点按钮', say: '打字回答', value: '填一个答案' }[this.waiting.kind]}${this.waiting.refs.length ? ` ${this.waiting.refs.join(' ')}` : ''}`);
    if (this.opens.size) lines.push(`学生能直接动的：${[...this.opens.values()].map((e) => { const o = this.objects.get(e.obj); const what = (e.input ? null : affordsOf(typeOf(o))[e.action]) || gestureText(e.gesture); const pol = [policyText(e.policy), e.input ? `input=${e.input}` : ''].filter(Boolean).join('、'); return `${e.refs.length ? e.refs.join(' ') : e.obj} ${e.action}（${what}${e.lo != null ? `，${e.lo}～${e.hi}` : ''}${pol ? `；${pol}` : ''}）`; }).join('；')}`);
    if (this.slips.size) lines.push(`淡淡圈着（学生走偏的那一下，照你写的 wrong=mark；那样东西再变就收掉）：${[...this.slips.values()].map((x) => `${x.refs.join(' ')}（${x.src}）`).join('；')}`);
    const pre = [...this.reactions].filter(([k, r]) => k.includes('.') && r.length).map(([k, r]) => { const [id, kind] = k.split('.'); return `${id} ${kind === 'done' ? '做完了' : '学生做对一步'}页面马上演你预写的 ${r.length} 行`; });
    if (pre.length) lines.push(`预写的：${pre.join('；')}`);
    for (const g of this.goals.values()) {
      const r = this.reactions.get(g.id);
      lines.push(`挑战 ${g.id}「${g.text}」when="${g.when}"：${goalStatus(this, g)}${r?.length ? `；做到了页面马上演你预写的 ${r.length} 行` : ''}`);
    }
    return lines.join('\n');
  }
  refOfKey(k) { const p = this.partOf(k.obj, k.key); return p ? this.refOf(p) : `${k.obj}:${k.key}`; }
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
