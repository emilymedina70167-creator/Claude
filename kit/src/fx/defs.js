// 函数图里的函数定义和撇号求导（视觉交互第 1 批；纯函数，tests/fx-defs.test.js）。
//   f(x) = x^3 - 3x        定义一次，后面的命令、读数、目标里写 f(x)、f(a+h)、f'(x)、f''(x)
// 为什么：以前切线的斜率、f′ 的曲线、割线的方程都要主讲把式子手算出来再写一遍，写错一处图就错了；
// 现在只写 f，导数由页面符号求导（fx/diff.js），和曲线一定对得上。
// 做法：定义存成语法树；用到的地方把调用换成它的式子（参数代进去），所以求值、求导都是对一棵普通的树做。
import { parse, evaluate, isFuncName } from '../expr.js';
import { diffAst } from './diff.js';

const DEF_RE = /^([A-Za-z][A-Za-z0-9]{0,7})\s*\(\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*\)\s*=(?!=)\s*(\S.*)$/;
// 特殊形式里绑定的字母（expr.js 的 SPECIAL）：at 是写着字母的那个参数（没有 at 的是固定的名字 name），over 是它管的参数
const B4 = (at, over) => ({ n: 4, binds: [{ at, over: [over] }] });
const BINDERS = {
  sum: B4(0, 3), prod: B4(0, 3), maxof: B4(0, 3), minof: B4(0, 3), int: B4(1, 0), maxon: B4(1, 0), minon: B4(1, 0), roots: B4(1, 0),
  // int2(式子, x, a, b, y, 下, 上)：x 管式子和内层的上下限，y 管式子
  int2: { n: 7, binds: [{ at: 1, over: [0, 5, 6] }, { at: 4, over: [0] }] },
  // lineint(P, Q, x(t), y(t), t, a, b)：t 管前四个；P、Q 里的 x、y 是曲线上的点（固定的名字，定义里换成第 8、9 个参数）
  lineint: { n: 7, binds: [{ at: 4, over: [0, 1, 2, 3] }, { name: 'x', slot: 7, over: [0, 1] }, { name: 'y', slot: 8, over: [0, 1] }] },
};
function binderOf(n) {
  const b = n.t === 'call' ? BINDERS[n.name] : null;
  if (!b || (n.args.length !== b.n && !(n.name === 'lineint' && n.args.length === 9))) return null;
  if (!b.binds.every((k) => k.at === undefined || n.args[k.at].t === 'var')) return null;
  // 每个绑定现在叫什么名字
  return b.binds.map((k) => ({ ...k, bound: k.at !== undefined ? n.args[k.at].name : n.args[k.slot]?.name || k.name }));
}

/** 一行是不是函数定义：是就回 { name, params, src }，不是回 null；名字撞了页面自带的函数就抛 */
export function parseDef(line) {
  const m = DEF_RE.exec(String(line ?? '').trim());
  if (!m) return null;
  const [, name, ps, src] = m;
  if (isFuncName(name)) throw new Error(`${name} 是页面自带的函数，定义自己的函数换个名字（如 f、g、F）`);
  const params = ps.split(',').map((s) => s.trim());
  if (new Set(params).size !== params.length) throw new Error(`${name} 的定义里参数重名`);
  return { name, params, src: src.trim() };
}

export const makeDefs = () => new Map();

const mapKids = (n, f) => {
  const out = { ...n };
  if (n.a) out.a = f(n.a);
  if (n.b) out.b = f(n.b);
  if (n.args) out.args = n.args.map(f);
  if (n.items) out.items = n.items.map(f);
  return out;
};

// 几个名字一起换成各自的树；特殊形式绑定的字母挡住同名的替换（只挡它管的那几个参数）
function substAll(n, map) {
  if (!n || n.t === 'num') return n;
  if (n.t === 'var') return Object.hasOwn(map, n.name) ? map[n.name] : n;
  const bs = binderOf(n);
  if (bs) {
    const letters = new Set(bs.filter((k) => k.at !== undefined).map((k) => k.at).concat(n.args.length === 9 ? [7, 8] : []));
    return { ...n, args: n.args.map((m, i) => {
      if (letters.has(i)) return m;
      const hide = bs.filter((k) => k.over.includes(i) && Object.hasOwn(map, k.bound));
      if (!hide.length) return substAll(m, map);
      const inner = { ...map };
      for (const k of hide) delete inner[k.bound];
      return substAll(m, inner);
    }) };
  }
  return mapKids(n, (m) => substAll(m, map));
}

// 定义里绑定的字母改成别处写不出来的名字：q(x) = sum(k, 1, 3, x^k) 调用成 q(k) 时，实参的 k 不会被求和的 k 抓走。
// lineint 里曲线上的点（固定叫 x、y）也一样：换了名字以后记在第 8、9 个参数上
function renameBound(n, tag) {
  if (!n || n.t === 'num' || n.t === 'var') return n;
  const bs = binderOf(n);
  if (!bs) return mapKids(n, (m) => renameBound(m, tag));
  const fresh = bs.map((k) => ({ ...k, v: { t: 'var', name: `${k.bound}#${tag}` } }));
  const args = n.args.map((m, i) => {
    const mine = fresh.find((k) => k.at === i);
    if (mine) return mine.v;
    if (i >= 7 && n.name === 'lineint') return m;
    const ren = {};
    for (const k of fresh) if (k.over.includes(i)) ren[k.bound] = k.v;
    return renameBound(Object.keys(ren).length ? substAll(m, ren) : m, tag);
  });
  for (const k of fresh) if (k.slot !== undefined) args[k.slot] = k.v;
  return { ...n, args };
}

// f'( → __d1_f(：撇号本来是转置，「名字 + 撇号 + 括号」而且名字是定义过的函数时才当求导
function primesToCalls(src, defs) {
  // 从公式里抄来的 ′ ″（Unicode 的撇号）和键盘上的 ' 一样
  return partialsToCalls(String(src).replace(/″/g, "''").replace(/′/g, "'").replace(/(?<![A-Za-z_.])([A-Za-z][A-Za-z0-9]*)('{1,3})\s*\(/g, (m, name, ps) => (defs.has(name) ? `__d${ps.length}_${name}(` : m)), defs);
}

// 偏导和梯度：f_x( → __p_x_f(，f_xy( → __p_xy_f(，f_grad( → __g_f(。
// 下划线前面是定义过的函数、后面跟着括号时才算（a_x 这样的普通名字、没有括号的 f_x 都不动）
function partialsToCalls(src, defs) {
  return src.replace(/(?<![A-Za-z_.0-9])([A-Za-z][A-Za-z0-9]*)_([A-Za-z]{1,4})\s*\(/g, (m, name, sub) => {
    const def = defs.get(name);
    if (!def) return m;
    if (sub === 'grad') return `__g_${name}(`;
    const bad = [...sub].find((ch) => !def.params.includes(ch));
    if (bad) throw new Error(`${name} 没有参数 ${bad}（${name} 的参数是 ${def.params.join('、')}；偏导写成 ${name}_${def.params[0]}(…)）`);
    if (sub.length > 3) throw new Error(`${name}_${sub}：偏导最多求到三阶`);
    return `__p_${sub}_${name}(`;
  });
}

const INNER = /^__(?:d([123])|p_([A-Za-z]{1,3})|(g))_(.+)$/;
const N0 = { t: 'num', v: 0 };
// f 没定义的地方导数也没定义：ln x 的导数 1/x 在 x < 0 算得出数，但那里没有 ln。加上 0·f，f 是 NaN 时导数也是 NaN
const guarded = (d, f) => ({ t: 'bin', op: '+', a: d, b: { t: 'bin', op: '*', a: N0, b: f } });

// 把定义过的函数的调用换成它的式子
function inline(n, defs) {
  if (!n || n.t === 'num' || n.t === 'var') return n;
  const out = mapKids(n, (m) => inline(m, defs));
  if (out.t !== 'call') return out;
  const dm = INNER.exec(out.name);
  const def = defs.get(dm ? dm[4] : out.name);
  if (!def) return out;
  // 多元函数只给了一个实参：当成一个点（向量），分量依次代进去——f(P)、f_grad(P)
  let args = out.args;
  if (def.params.length > 1 && args.length === 1 && args[0].t !== 'num') args = def.params.map((_, i) => ({ t: 'call', name: 'el', args: [args[0], { t: 'num', v: i + 1 }] }));
  if (args.length !== def.params.length) throw new Error(`${def.name} 要 ${def.params.length} 个参数（这里写了 ${out.args.length} 个）${def.params.length > 1 ? `，或者给一个 ${def.params.length} 维的点` : ''}`);
  const diff = (body, x, order = 1) => {
    try { return diffAst(body, x, order); } catch (e) {
      throw new Error(`${def.name} 页面求不了导：${String(e.message).replace(/^这个式子页面求不了导：/, '')}`);
    }
  };
  let body = def.ast;
  if (dm?.[1]) body = guarded(diff(body, def.params[0], Number(dm[1])), def.ast);
  else if (dm?.[2]) body = guarded([...dm[2]].reduce((b, x) => diff(b, x), body), def.ast);
  else if (dm?.[3]) body = { t: 'list', items: def.params.map((x) => guarded(diff(def.ast, x), def.ast)) };
  return substAll(body, Object.fromEntries(def.params.map((p, i) => [p, args[i]])));
}

const usesCall = (n, name) => !!n && ((n.t === 'call' && (n.name === name || INNER.exec(n.name)?.[4] === name)) || ['a', 'b'].some((k) => usesCall(n[k], name)) || (n.args || n.items || []).some((m) => usesCall(m, name)));

/** 式子原文 → 语法树：撇号读成求导，定义过的函数展开 */
export function expandSrc(src, defs) {
  if (!defs || !defs.size) return parse(src);
  // 自己写的求和字母先改个名：sum(a, 1, 3, p(2)) 里 p 的定义用到外面的 a 时，不被求和的 a 抓走
  return inline(renameBound(parse(primesToCalls(src, defs)), '0'), defs);
}

/** 加一条定义（parseDef 的结果）。定义里用到的前面的函数先展开；用到自己就抛 */
export function addDef(defs, def) {
  if (!def) return defs;
  const raw = parse(primesToCalls(def.src, new Map([...defs, [def.name, def]])));
  if (usesCall(raw, def.name)) throw new Error(`${def.name} 的定义里用到了它自己`);
  defs.set(def.name, { ...def, ast: renameBound(inline(raw, defs), def.name) });
  return defs;
}

/** 编译：回 (vars) => 值。opts 同 expr.js 的 evaluate（图里不传：弧度） */
export function compileWith(src, defs, opts) {
  const ast = expandSrc(src, defs);
  return (vars = {}) => evaluate(ast, vars, opts);
}

/** 哪些定义算一次很贵（定义的式子里用到了 forms 里的特殊形式，如 int2）：图里据此少取点、拖动时先不重算 */
export function heavyNames(defs, forms) {
  return [...defs].filter(([, d]) => forms.some((f) => usesCall(d.ast, f))).map(([name]) => name);
}
