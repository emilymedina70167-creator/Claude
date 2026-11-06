// 规则接口：每种东西（o.type）交一份规则，页面通用的裁判（referee.js）只通过这里问，不认识任何具体的东西。
// 纯函数，有测试（tests/stage-rules.test.js）。没交规则的东西照旧能用，只是不判。
// 形状见 docs/superpowers/specs/2026-11-06-stage-base-design.md 第 1 节：
//   next(o, scene) → { acts, why } | null       null 是做完了
//   check(o, act, scene) → { legal, right, misread, why, next }
//   predicates { 名字: (o, args, scene) → true | false | null }
//   facts(before, after, act) → [话]
//   gestures { tap / drag / ...: { gesture, ... } }
//   standard(o) → { steps, variants }（可选）

const REGISTRY = new Map();

const DEFAULTS = {
  next: () => null,
  check: () => ({ legal: true, right: null }),
  predicates: {},
  facts: () => [],
  gestures: {},
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
