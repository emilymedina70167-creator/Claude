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
