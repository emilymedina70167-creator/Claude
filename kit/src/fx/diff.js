// 符号求导（计划 3，dr-calc-base Task 4；纯函数，tests/fx-diff.test.js）。
// 为什么不用差分：有限差分到二阶、三阶误差上 1e-4，判 f″、泰勒系数会把对的判成错。照语法树走链式法则，精确到浮点。
// 语法树和 expr.js 的同一种：num / var / neg / bin（+ - * / ^ 比较）/ call / list。
//   diffAst(ast, x, order)：对 x 求 order 阶导（偏导就是换个 x）；不认识的函数、矩阵抛「这个式子页面求不了导」
//   expandPrimes：实数题里 f' 是求导（T 调用换成导数），∫ 留给 int 自己
//   int(g) / int(g, t)：不定积分「g 的一个原函数」，对它的变量求导就是 g；
//   int(g, t, a, b)：变限积分，莱布尼茨：g 不含 x 时导数是 g(b)·b′ − g(a)·a′，含 x 的求不了导
import { parse, evaluate } from '../expr.js';
import { useDeriver } from './sample.js';
import { numIntegral } from './integral.js';

const N = (v) => ({ t: 'num', v });
const V = (name) => ({ t: 'var', name });
const C = (name, ...args) => ({ t: 'call', name, args });
const isNum = (n, v) => n.t === 'num' && (v === undefined || n.v === v);

// —— 化简：0、1 的加乘消掉，两个数直接算（不化简的话三阶导会膨胀成几千个结点）——
function neg(a) {
  if (isNum(a)) return N(-a.v);
  if (a.t === 'neg') return a.a;
  return { t: 'neg', a };
}
function add(a, b) {
  if (isNum(a, 0)) return b;
  if (isNum(b, 0)) return a;
  if (isNum(a) && isNum(b)) return N(a.v + b.v);
  if (b.t === 'neg') return sub(a, b.a);
  return { t: 'bin', op: '+', a, b };
}
function sub(a, b) {
  if (isNum(b, 0)) return a;
  if (isNum(a, 0)) return neg(b);
  if (isNum(a) && isNum(b)) return N(a.v - b.v);
  if (b.t === 'neg') return add(a, b.a);
  return { t: 'bin', op: '-', a, b };
}
function mul(a, b) {
  if (isNum(a, 0) || isNum(b, 0)) return N(0);
  if (isNum(a, 1)) return b;
  if (isNum(b, 1)) return a;
  if (isNum(a) && isNum(b)) return N(a.v * b.v);
  if (a.t === 'neg') return neg(mul(a.a, b));
  if (b.t === 'neg') return neg(mul(a, b.a));
  return { t: 'bin', op: '*', a, b };
}
function div(a, b) {
  if (isNum(a, 0)) return N(0);
  if (isNum(b, 1)) return a;
  if (a.t === 'neg') return neg(div(a.a, b));
  return { t: 'bin', op: '/', a, b };
}
function pow(a, b) {
  if (isNum(b, 0)) return N(1);
  if (isNum(b, 1)) return a;
  return { t: 'bin', op: '^', a, b };
}
const sq = (a) => pow(a, N(2));

/** 这个结点里有没有变量 x（变限积分看上下限；积分变量自己不算） */
export function has(n, x) {
  if (!n) return false;
  if (n.t === 'var') return n.name === x;
  // 变限积分 int(g, t, a, b)：积分变量 t 是约束变量，看 g（t 以外）和上下限；不定积分 int(g, t) 是 t 的函数
  if (n.t === 'call' && n.name === 'int' && n.args.length === 4 && n.args[1].t === 'var') {
    const [g, t, ...rest] = n.args;
    return (t.name !== x && has(g, x)) || rest.some((r) => has(r, x));
  }
  if (n.t === 'call' && n.name === 'int' && n.args[1]?.t === 'var') return n.args[1].name === x || has(n.args[0], x);
  return ['a', 'b'].some((k) => has(n[k], x)) || (n.args || n.items || []).some((m) => has(m, x));
}

/** 把 name 换成 rep（变限积分代上下限用） */
export function substitute(n, name, rep) {
  if (!n) return n;
  if (n.t === 'var') return n.name === name ? rep : n;
  if (n.t === 'num') return n;
  if (n.t === 'call' && n.name === 'int' && n.args[1]?.t === 'var' && n.args[1].name === name) return { ...n, args: [n.args[0], n.args[1], ...n.args.slice(2).map((m) => substitute(m, name, rep))] };
  const out = { ...n };
  if (n.a) out.a = substitute(n.a, name, rep);
  if (n.b) out.b = substitute(n.b, name, rep);
  if (n.args) out.args = n.args.map((m) => substitute(m, name, rep));
  if (n.items) out.items = n.items.map((m) => substitute(m, name, rep));
  return out;
}

const cannot = (why) => { throw new Error(`这个式子页面求不了导：${why}`); };

// 每个函数对它的参数 u 的导数（再乘 u′）
const RULES = {
  sin: (u) => C('cos', u),
  cos: (u) => neg(C('sin', u)),
  tan: (u) => div(N(1), sq(C('cos', u))),
  cot: (u) => neg(div(N(1), sq(C('sin', u)))),
  sec: (u) => div(C('sin', u), sq(C('cos', u))),
  csc: (u) => neg(div(C('cos', u), sq(C('sin', u)))),
  arcsin: (u) => div(N(1), C('sqrt', sub(N(1), sq(u)))),
  arccos: (u) => neg(div(N(1), C('sqrt', sub(N(1), sq(u))))),
  arctan: (u) => div(N(1), add(N(1), sq(u))),
  ln: (u) => div(N(1), u),
  lg: (u) => div(N(1), mul(u, C('ln', N(10)))),
  exp: (u) => C('exp', u),
  sqrt: (u) => div(N(1), mul(N(2), C('sqrt', u))),
  abs: (u) => div(u, C('abs', u)),
  norm: (u) => div(u, C('abs', u)),
  Phi: (u) => C('phi', u),
  phi: (u) => neg(mul(u, C('phi', u))),
};

function d(n, x) {
  switch (n.t) {
    case 'num': return N(0);
    case 'var': return N(n.name === x ? 1 : 0);
    case 'neg': return neg(d(n.a, x));
    case 'list': return { t: 'list', items: n.items.map((m) => d(m, x)) };
    case 'bin': {
      const { op, a, b } = n;
      if (op === '+') return add(d(a, x), d(b, x));
      if (op === '-') return sub(d(a, x), d(b, x));
      if (op === '*') return add(mul(d(a, x), b), mul(a, d(b, x)));
      if (op === '/') {
        if (!has(b, x)) return div(d(a, x), b);
        return div(sub(mul(d(a, x), b), mul(a, d(b, x))), sq(b));
      }
      if (op === '^') {
        const ha = has(a, x), hb = has(b, x);
        if (!ha && !hb) return N(0);
        if (!hb) return mul(mul(b, pow(a, sub(b, N(1)))), d(a, x));
        // a^g：a 不含 x（e^g 的 ln e = 1）
        const lnA = a.t === 'var' && a.name === 'e' ? N(1) : C('ln', a);
        if (!ha) return mul(mul(n, lnA), d(b, x));
        // 幂指函数 f^g = e^(g ln f)
        return mul(n, add(mul(d(b, x), C('ln', a)), div(mul(b, d(a, x)), a)));
      }
      return N(0); // 比较：分段函数 (x>0)*x 的那一段是常数 0 或 1
    }
    case 'call': {
      if (!has(n, x)) return N(0);
      const { name, args } = n;
      if (name === 'T') return d(d(args[0], x), x); // 实数题里 f' 是 f 的导数
      if (name === 'int') {
        if (args.length <= 2) {
          // 不定积分 int(g) / int(g, t)：对它自己的变量求导就是 g
          const t = args[1]?.t === 'var' ? args[1].name : x;
          if (t !== x) cannot(`∫ … d${t} 对 ${x} 求导`);
          return args[0];
        }
        const [g, tv, lo, hi] = args;
        if (tv?.t !== 'var') cannot('变限积分写成 int(被积函数, 积分变量, 下限, 上限)');
        if (tv.name !== x && has(g, x)) cannot('被积函数里有 x 的变限积分');
        return sub(mul(substitute(g, tv.name, hi), d(hi, x)), mul(substitute(g, tv.name, lo), d(lo, x)));
      }
      if (name === 'log') {
        if (args.length === 2 && has(args[1], x)) return d(div(C('ln', args[0]), C('ln', args[1])), x);
        const b = args.length === 2 ? args[1] : N(10);
        return mul(div(N(1), mul(args[0], C('ln', b))), d(args[0], x));
      }
      const rule = RULES[name];
      if (!rule || args.length !== 1) cannot(`${name}()`);
      return mul(rule(args[0]), d(args[0], x));
    }
  }
  return cannot('写法');
}

/** 对 x 求 order 阶导；ast 可以是原文 */
export function diffAst(ast, x = 'x', order = 1) {
  let n = typeof ast === 'string' ? parse(ast) : ast;
  n = expandPrimes(n, x);
  for (let k = 0; k < order; k++) n = d(n, x);
  return n;
}

/** 实数题里的 f'：T 调用换成 f 对 x 的导数（里面套着的也换） */
export function expandPrimes(n, x = 'x') {
  if (!n || n.t === 'num' || n.t === 'var') return n;
  if (n.t === 'call' && n.name === 'T') return d(expandPrimes(n.args[0], x), x);
  const out = { ...n };
  if (n.a) out.a = expandPrimes(n.a, x);
  if (n.b) out.b = expandPrimes(n.b, x);
  if (n.args) out.args = n.args.map((m) => expandPrimes(m, x));
  if (n.items) out.items = n.items.map((m) => expandPrimes(m, x));
  return out;
}

// 树里有 T 调用吗、有变限积分吗
const hasPrime = (n) => !!n && ((n.t === 'call' && n.name === 'T') || ['a', 'b'].some((k) => hasPrime(n[k])) || (n.args || n.items || []).some(hasPrime));
const hasInt = (n) => !!n && ((n.t === 'call' && n.name === 'int' && n.args.length === 4) || ['a', 'b'].some((k) => hasInt(n[k])) || (n.args || n.items || []).some(hasInt));

/** 变限积分 int(g, t, a, b) 在这一组取值上换成数值（数值积分；算不出来是 NaN，判的时候这一点跳过） */
export function evalInts(n, vars) {
  if (!n || n.t === 'num' || n.t === 'var') return n;
  if (n.t === 'call' && n.name === 'int' && n.args.length === 4 && n.args[1].t === 'var') {
    const [g, tv, lo, hi] = n.args.map((m, i) => (i === 1 ? m : evalInts(m, vars)));
    let v = NaN;
    try {
      const a = evaluate(lo, vars), b = evaluate(hi, vars);
      const r = numIntegral((t) => evaluate(g, { ...vars, [tv.name]: t }), a, b);
      v = r.ok === true ? r.value : NaN;
    } catch { v = NaN; }
    return { t: 'num', v };
  }
  const out = { ...n };
  if (n.a) out.a = evalInts(n.a, vars);
  if (n.b) out.b = evalInts(n.b, vars);
  if (n.args) out.args = n.args.map((m) => evalInts(m, vars));
  if (n.items) out.items = n.items.map((m) => evalInts(m, vars));
  return out;
}

// fxEval（fx/sample.js）求值前先把 ' 换成导数：对哪个变量求，按这一组取值里有的——有 x 用 x，否则只有一个实数变量就用它
useDeriver((node, vars = {}) => {
  let out = node;
  if (hasPrime(out)) {
    const names = Object.keys(vars).filter((k) => typeof vars[k] === 'number' && !['e', 'pi'].includes(k));
    const x = 'x' in vars || !names.length ? 'x' : names.length === 1 ? names[0] : 'x';
    out = expandPrimes(out, x);
  }
  return hasInt(out) ? evalInts(out, vars) : out;
});
