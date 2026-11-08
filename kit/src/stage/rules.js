// 规则接口：每种东西（o.type）交一份规则，页面通用的裁判（referee.js）只通过这里问，不认识任何具体的东西。
// 纯函数，有测试（tests/stage-rules.test.js）。没交规则的东西照旧能用，只是不判。
// 形状见 docs/superpowers/specs/2026-11-06-stage-base-design.md 第 1 节：
//   next(o, scene) → { acts, why } | null       null 是做完了
//   check(o, act, scene) → { legal, right, misread, why, next }
//   predicates { 名字: (o, args, scene) → true | false | null }  null 是现在判不了（之后会有：乘积还空着）；
//                                               这样东西本身永远判不了（句子没写 key）就抛错，写下挑战时当场报
//   facts(before, after, act) → [话]
//   gestures { 动作: { gesture, from, to, toAct, ask?, pick?, choices? } }   五种通用手势在它这里是什么（gestures.js 照它翻成一行指令；
//                                               ask 说放下以后要不要先问一个值（倍数框），pick + choices 是拉好一段以后点的那一排）
//   slipRefs(o, act) → [部件的写法] | null（可选）  学生走偏的那一下淡淡圈哪儿，那一行没写部件时（rowop M r3 - 2r1 圈第 3 行）
//   standard(o) → { steps, variants }（可选）
//   actOf(o, c, h) → 动作 | null                一行镜头指令（rotate t#3 right、rowop M r2 - 2r1、mark s.2-4 V）→ check 认的动作；
//                                               不判的指令是 null。学生、老师的每一行都照它过裁判（场景里，所以重放出来一样）
//   judges [动作名]                              open 了这几个动作，学生做的每一下页面判对错：wrong= / call= / @名字.right 只对它们起作用
//                                               （矩阵的 edit、句子的 fold 也在手势表里，可页面不判对错，写了 wrong= 当场报）
//   doneBy [动作名]                              open 了这几个动作的东西，next 走到 null 才算「学生做完了」（@名字.done、叫老师）：
//                                               树的平衡、矩阵的阶梯形只对交给了学生做的东西有意义（一棵本来就平衡、没 open 的树不是学生做完的）
//   measures { 名字: (o, parts, scene) → 数 | null | undefined }（可选，docs/superpowers/specs/2026-11-08-stage-base-2-design.md 3.1）
//                                               页面数得出的量，写成 count(t)、height(t.50)：parts 是写了部件时的 scene.parts(…)，写整样东西是 null。
//                                               null 是现在还数不了（矩阵还空着，之后会有）；这样东西本身数不了（句子没写 key）就抛错，错误的话给老师看；
//                                               undefined 是这样东西本来就没有这个量（不是方阵的 det）。函数上可以挂两句话：
//                                               blank（null 的时候说什么，「还有空着的格」）、none（undefined 的时候括号里补一句为什么）
//   brief(o)、changed(before, after)（可选）     这一轮后面的任务用；没交是 null

const REGISTRY = new Map();

const DEFAULTS = {
  next: () => null,
  check: () => ({ legal: true, right: null }),
  predicates: {},
  facts: () => [],
  gestures: {},
  actOf: () => null,
  judges: [],
  doneBy: [],
  measures: {},
  brief: null,
  changed: null,
};

/** 登记一种东西的规则；缺的项给默认值（不判、不拦） */
export function registerRules(type, rules = {}) {
  const r = { ...DEFAULTS, ...rules };
  // 记下这种东西有没有交 next：没交的 next 默认 null，不能当成「做完了」
  const hasNext = typeof rules.next === 'function';
  // 显式写了 undefined / null 的也退回默认，免得裁判到处判空
  for (const k of Object.keys(DEFAULTS)) if (r[k] == null) r[k] = DEFAULTS[k];
  r.hasNext = hasNext;
  REGISTRY.set(type, r);
  return r;
}

/** 一样东西的规则；没交规则的是 null */
export function rulesOf(o) {
  return (o && REGISTRY.get(o.type)) || null;
}

/** 挑战用的判断式：(args) => true | false | null；这样东西没有这个判断式时是 null */
export function predicateOf(scene, objId, name) {
  const o = scene?.objects?.get(objId);
  const fn = rulesOf(o)?.predicates[name];
  return typeof fn === 'function' ? (args = []) => fn(o, args, scene) : null;
}

/** 通用手势在这种东西里是什么动作；没有就是 null */
export function gestureOf(o, action) {
  return rulesOf(o)?.gestures[action] ?? null;
}

/** 做完了：这种东西交了 next，而且 next 说没有下一步了（没规则的不算做完） */
export function done(scene, objId) {
  const o = scene?.objects?.get(objId);
  const r = rulesOf(o);
  return !!r && r.hasNext && r.next(o, scene) === null;
}

// —— 量（count(t)、height(t.50)、rank(M)、verbs(s.4-14)）：判断式答「是不是」，量答「几个」——
// 舞台现状、挑战、答案、话和贴的字四处用同一个写法、同一份算法；页面数，不是老师数

/** 量的写法 → { name, arg }：名字(东西或部件)，括号里没有空格、没有括号；别的写法是 null */
export function parseMeasure(word) {
  const m = String(word ?? '').trim().match(/^([A-Za-z_]\w*)\(\s*([^()\s]+)\s*\)$/);
  return m ? { name: m[1], arg: m[2] } : null;
}

// 那种东西叫什么（报错用）：真的场景问 types/，测试里假的场景没有，就写种类名
const labelOf = (scene, o) => { try { return scene.type(o).label; } catch { return o.type; } };

/**
 * 量写得对不对：{ name, arg, o, fn, parts }。括号里不是东西或部件、东西不在、这种东西没有这个量、部件写错了都抛错，
 * 错误的话给老师看。写下挑战、话、贴的字时查的就是它。
 * run（写下新的一行时）还算一遍：以后也数不了的（这样东西本身数不了：句子没写 key；本来就没有：增广矩阵的 det）当场报——
 * 第一轮 I4 的规矩，永远判不了的挑战、永远是「?」的字是老师写错了；现在还空着的（乘积没算）之后数得了，照收。
 * 不 run（重放旧课）只查写法：当时收下的照样收下
 */
export function checkMeasure(scene, word, { run = false } = {}) {
  const m = parseMeasure(word);
  if (!m) throw new Error(`「${word}」不是量的写法：写成 count(t)、height(t.50)`);
  const id = m.arg.match(/^([A-Za-z_]\w*)([.#].+)?$/);
  if (!id) throw new Error(`「${word}」：括号里写舞台上的东西或部件（${m.name}(t)、${m.name}(t.50)）`);
  const o = scene.objects.get(id[1]);
  if (!o) {
    // 照场景自己的说法（「舞台上没有 q（有的是……）」）
    if (typeof scene.parts === 'function') scene.parts(m.arg);
    throw new Error(`舞台上没有「${id[1]}」`);
  }
  const ms = rulesOf(o)?.measures || {};
  const fn = ms[m.name];
  if (typeof fn !== 'function') {
    const names = Object.keys(ms);
    throw new Error(names.length ? `${labelOf(scene, o)}「${o.id}」没有量「${m.name}」，能写：${names.join('、')}` : `${labelOf(scene, o)}「${o.id}」没有量可写`);
  }
  const parts = id[2] ? scene.parts(m.arg) : null;
  if (run) {
    const r = runMeasure(scene, word);
    if (r.never) throw new Error(`「${word}」页面数不了，以后也数不了：${r.why}`);
  }
  return { ...m, o, fn, parts };
}

// 算一个量：{ value, why, none, never }。none 是这样东西本来就没有这个量（measureLine 不列它）；
// never 是以后也数不了：本来就没有，或者量自己抛错（这样东西本身数不了）。null 是现在还数不了，之后会有
function runMeasure(scene, word) {
  const m = checkMeasure(scene, word);
  let v;
  try { v = m.fn(m.o, m.parts, scene); } catch (err) { return { value: null, why: String(err?.message || err), none: false, never: true }; }
  if (v === undefined) return { value: null, why: `${m.arg} 没有 ${m.name}${m.fn.none ? `（${m.fn.none}）` : ''}`, none: true, never: true };
  if (v == null || !Number.isFinite(v)) return { value: null, why: m.fn.blank ? `${m.arg} ${m.fn.blank}` : `${m.arg} 现在还数不了 ${m.name}`, none: false, never: false };
  return { value: v, why: null, none: false, never: false };
}

/**
 * 量现在是几：{ value: 数 | null, why }，以后也数不了的多一项 never: true。东西不在、这种东西没有这个量抛错（写错了）；
 * 量自己抛的错（句子没写 key）不往外抛，变成 { value: null, why: 那句话, never: true }——挑战写「判不了」、答案写「页面没判成」、贴的字画「?」
 */
export function evalMeasure(scene, word) {
  const { value, why, never } = runMeasure(scene, word);
  return never ? { value, why, never } : { value, why };
}

/**
 * 话、贴的字、挑战、题卡里的 {量} 画成什么：数得出画数；数不了（还空着、没写 key、本来就没有）画「?」；
 * 不是量（旧课重放进来的 {f(x)}：x 不在舞台上、名字不是这样东西的量）照原样写字——和以前当成拨数原样写出来一样
 */
export function measureShown(scene, word) {
  let r;
  try { r = evalMeasure(scene, word); } catch { return word; }
  return r.value == null ? '?' : measureText(r.value);
}

/** 量写给人看：整数照写，不是整数的写成分数（det 可能是 1/2），实在凑不成分数的写小数 */
export function measureText(v) {
  if (Number.isInteger(v)) return String(v);
  for (let d = 2; d <= 1000; d++) {
    const n = Math.round(v * d);
    if (Math.abs(n / d - v) < 1e-9) return `${n}/${d}`;
  }
  return String(Math.round(v * 1e6) / 1e6);
}

/**
 * 舞台现状里每样东西多的一行：「页面算的：count(t) = 6，height(t) = 4；avl 否（…），bst 是；页面数不了：…」。
 * 只算写整样东西的量；extra 是那种东西自己交的几句（types/ 的 pageBits：树的 avl / bst）。数不了的写在最后；
 * 这样东西本来就没有的量（增广矩阵的 det）不列，也不算数不了——不然每一轮都多一句没用的。没交量的东西是 null
 */
export function measureLine(scene, o, extra = []) {
  const names = Object.keys(rulesOf(o)?.measures || {});
  if (!names.length) return null;
  const vals = [], miss = [];
  for (const name of names) {
    const w = `${name}(${o.id})`;
    let r;
    try { r = runMeasure(scene, w); } catch (err) { r = { value: null, why: String(err?.message || err), none: false }; }
    if (r.value != null) vals.push(`${w} = ${measureText(r.value)}`);
    else if (!r.none && !miss.includes(r.why)) miss.push(r.why);
  }
  const bits = [];
  if (vals.length || extra.length) bits.push(`页面算的：${[vals.join('，'), extra.join('，')].filter(Boolean).join('；')}`);
  if (miss.length) bits.push(`页面数不了：${miss.join('；')}`);
  return bits.length ? bits.join('；') : null;
}
