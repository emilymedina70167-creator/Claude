// 函数图里的函数定义和撇号求导（视觉交互第 1 批；纯函数，tests/fx-defs.test.js）。
//   f(x) = x^3 - 3x        定义一次，后面的命令、读数、目标里写 f(x)、f(a+h)、f'(x)、f''(x)
// 为什么：以前切线的斜率、f′ 的曲线、割线的方程都要主讲把式子手算出来再写一遍，写错一处图就错了；
// 现在只写 f，导数由页面符号求导（fx/diff.js），和曲线一定对得上。
// 做法：定义存成语法树；用到的地方把调用换成它的式子（参数代进去），所以求值、求导都是对一棵普通的树做。
import { parse, evaluate, isFuncName } from '../expr.js';
import { diffAst } from './diff.js';

const DEF_RE = /^([A-Za-z][A-Za-z0-9]{0,7})\s*\(\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*\)\s*=(?!=)\s*(\S.*)$/;
// 特殊形式里绑定的字母在第几个参数、它管哪个参数（expr.js 的 SPECIAL）
const BINDERS = { sum: [0, 3], prod: [0, 3], maxof: [0, 3], minof: [0, 3], int: [1, 0], maxon: [1, 0], minon: [1, 0], roots: [1, 0] };
const binderOf = (n) => (n.t === 'call' && BINDERS[n.name] && n.args.length === 4 && n.args[BINDERS[n.name][0]].t === 'var' ? BINDERS[n.name] : null);

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

// 几个名字一起换成各自的树；特殊形式绑定的字母挡住同名的替换（只挡它管的那个参数）
function substAll(n, map) {
  if (!n || n.t === 'num') return n;
  if (n.t === 'var') return Object.hasOwn(map, n.name) ? map[n.name] : n;
  const b = binderOf(n);
  if (b) {
    const bound = n.args[b[0]].name;
    if (Object.hasOwn(map, bound)) {
      const inner = { ...map };
      delete inner[bound];
      return { ...n, args: n.args.map((m, i) => (i === b[0] ? m : substAll(m, i === b[1] ? inner : map))) };
    }
    return { ...n, args: n.args.map((m, i) => (i === b[0] ? m : substAll(m, map))) };
  }
  return mapKids(n, (m) => substAll(m, map));
}

// 定义里绑定的字母改成别处写不出来的名字：q(x) = sum(k, 1, 3, x^k) 调用成 q(k) 时，实参的 k 不会被求和的 k 抓走
function renameBound(n, tag) {
  if (!n || n.t === 'num' || n.t === 'var') return n;
  const b = binderOf(n);
  if (!b) return mapKids(n, (m) => renameBound(m, tag));
  const old = n.args[b[0]].name, fresh = `${old}#${tag}`;
  const v = { t: 'var', name: fresh };
  return { ...n, args: n.args.map((m, i) => (i === b[0] ? v : renameBound(i === b[1] ? substAll(m, { [old]: v }) : m, tag))) };
}

// f'( → __d1_f(：撇号本来是转置，「名字 + 撇号 + 括号」而且名字是定义过的函数时才当求导
function primesToCalls(src, defs) {
  // 从公式里抄来的 ′ ″（Unicode 的撇号）和键盘上的 ' 一样
  return String(src).replace(/″/g, "''").replace(/′/g, "'").replace(/(?<![A-Za-z_.])([A-Za-z][A-Za-z0-9]*)('{1,3})\s*\(/g, (m, name, ps) => (defs.has(name) ? `__d${ps.length}_${name}(` : m));
}

// 把定义过的函数的调用换成它的式子
function inline(n, defs) {
  if (!n || n.t === 'num' || n.t === 'var') return n;
  const out = mapKids(n, (m) => inline(m, defs));
  if (out.t !== 'call') return out;
  const dm = /^__d([123])_(.+)$/.exec(out.name);
  const def = defs.get(dm ? dm[2] : out.name);
  if (!def) return out;
  if (out.args.length !== def.params.length) throw new Error(`${def.name} 要 ${def.params.length} 个参数（这里写了 ${out.args.length} 个）`);
  let body = def.ast;
  if (dm) {
    try { body = diffAst(body, def.params[0], Number(dm[1])); } catch (e) {
      throw new Error(`${def.name}${"′".repeat(Number(dm[1]))} 页面求不了导：${String(e.message).replace(/^这个式子页面求不了导：/, '')}`);
    }
    // f 没定义的地方 f′ 也没定义：ln x 的导数 1/x 在 x < 0 算得出数，但那里没有 ln。加上 0·f，f 是 NaN 时导数也是 NaN
    body = { t: 'bin', op: '+', a: body, b: { t: 'bin', op: '*', a: { t: 'num', v: 0 }, b: def.ast } };
  }
  return substAll(body, Object.fromEntries(def.params.map((p, i) => [p, out.args[i]])));
}

const usesCall = (n, name) => !!n && ((n.t === 'call' && (n.name === name || n.name.endsWith(`_${name}`) && /^__d[123]_/.test(n.name))) || ['a', 'b'].some((k) => usesCall(n[k], name)) || (n.args || n.items || []).some((m) => usesCall(m, name)));

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
