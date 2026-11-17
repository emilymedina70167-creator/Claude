// 活板的运行：描述（lang.js）+ 学生的输入（拨的、拖的、折的）→ 每个量的值、条件成不成立、空的答案。
// 板很小（十几个量），学生一动就整块重算一遍（每个量算一次，按名字缓存），比维护依赖图简单，拖动时也够快。
// find：替老师找例子，按条件的差模拟退火（条件很少碰巧成立：Belady 异常在随机序列里大约百万分之一）。纯函数。
import { parseBoard, parseExpr, idents, HbError } from './lang.js';
import {
  Q, isQ, isNumber, isVector, isMatrix, f, q, qnum, add, mul, div, neg, scale, cmp, same, truthy, text, exactCall, checkAnswer,
} from './values.js';
import {
  isEngine, makeProcess, processMember, judgeProcess, sentence, sentenceMember, domain, sampleDomain, mutateDomain,
} from './objects.js';
import { calcValue } from '../exact.js';

const err = (m) => new HbError(m);
// 找例子最多想多久（毫秒）：iPad 上一般几十到几百毫秒就找到，这是找不到时的上限
export const FIND_MS = 1500;

// exact.js 里有的函数（精确算，算不出退回小数）：位置参数直接交给它
export const EXACT_FUNCS = new Set(('det inv T transpose tr rank rref diag col row dot cross proj lerp mat I E abs sign min max floor ceil round fact choose '
  + 'sqrt norm log2 mod div gcd lcm xor shl shr bit signed unsigned bin hex vmat qf factor expand same el sort sum cumsum fix sbin list dec '
  + 'next nextval faults victims wpl').split(' '));

// 活板自己的函数
const KFUNCS = {
  // u、v 共线且都不是零（拖到特征方向时成立）
  par: (u, v) => {
    if (!isVector(u) || !isVector(v) || u.length !== v.length) throw err('par 要两个一样长的向量');
    const a = f(u), b = f(v);
    const nu = Math.hypot(...a), nv = Math.hypot(...b);
    if (nu < 1e-9 || nv < 1e-9) return false;
    const d = a.reduce((s, x, i) => s + x * b[i], 0);
    return Math.abs(Math.abs(d) - nu * nv) < 1e-9 * nu * nv;
  },
  // Ax 是 x 的几倍（不共线时是投影的倍数）
  lam: (A, x) => {
    const Ax = mul(A, x);
    const xx = exactCall('dot', [x, x]);
    if (cmp(xx, Q.int(0)) === 0) throw err('x 是零向量');
    return div(exactCall('dot', [Ax, x]), xx);
  },
  // 2×2 的实特征值，从小到大（判别式是完全平方时精确）
  eigs: (A) => {
    if (!isMatrix(A) || A.length !== 2 || A[0].length !== 2) throw err('eigs 现在只算 2×2');
    const t = exactCall('tr', [A]), d = exactCall('det', [A]);
    const disc = add(mul(t, t), mul(Q.int(-4), d));
    if (cmp(disc, Q.int(0)) < 0) return [];
    if (cmp(disc, Q.int(0)) === 0) return [div(t, Q.int(2))];
    let r;
    try { r = exactCall('sqrt', [disc]); } catch { r = Math.sqrt(f(disc)); }
    return [div(add(t, r, -1), Q.int(2)), div(add(t, r), Q.int(2))];
  },
  allint: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => (isQ(x) ? x.integer : Math.abs(f(x) - Math.round(f(x))) < 1e-9)),
  len: (v) => Q.int(Array.isArray(v) ? v.length : typeof v === 'string' ? v.length : 0),
  count: (v, x) => Q.int((Array.isArray(v) ? v : []).filter((y) => same(y, x)).length),
  range: (a, b) => { const out = []; for (let i = Math.round(f(a)); i <= Math.round(f(b)); i++) out.push(Q.int(i)); return out; },
  sentence: (t) => sentence(t),
  '句子': (t) => sentence(t),
  '序列': (...a) => domain('seq', a),
  '整数': (...a) => domain('int', a),
  '向量': (...a) => domain('vec', a),
  '矩阵': (...a) => domain('mat', a),
};

export const CONSTS = { true: true, false: false, '是': true, '否': false };

const known = (fn) => fn in KFUNCS || EXACT_FUNCS.has(fn);

/** 写法检查（parseBoard 的 check）：每一行用到的名字、函数要有 */
function checker(asts, local, cells) {
  const bad = [];
  const walk = (a, inArg) => {
    if (!a || typeof a !== 'object') return;
    if (a.k === 'id') {
      if (!cells.has(a.name) && !(a.name in CONSTS) && !local.has(a.name) && !inArg) bad.push(`不认识「${a.name}」：先用 let 定义它`);
      return;
    }
    if (a.k === 'call') {
      if (a.named) { if (!isEngine(a.fn)) bad.push(`没有「${a.fn}」这个演示（字段名写法只给演示用）`); }
      else if (!known(a.fn)) bad.push(isEngine(a.fn) ? `${a.fn} 是演示：用字段名写，比如 ${a.fn}(字段=值)` : `没有函数「${a.fn}」`);
      a.args.forEach((x) => walk(x, true));
      Object.values(a.named || {}).forEach((x) => walk(x, true));
      return;
    }
    if (a.k === 'mem') return walk(a.obj, inArg);
    for (const v of Object.values(a)) {
      if (Array.isArray(v)) v.forEach((x) => walk(x, inArg));
      else if (v && typeof v === 'object') walk(v, inArg);
    }
  };
  asts.forEach((a) => walk(a, false));
  return bad;
}

export class Runtime {
  constructor() {
    this.inputs = new Map(); // 名字|初值写法 → 当前值（学生拨的、拖的）
    this.folds = new Map(); // 名字|句子 → 折起的段
    this.findCache = new Map();
    this.found = []; // 这次重算里新找到的例子（给页面记一笔）
    this.load('');
  }

  load(src) {
    this.src = String(src);
    this.board = parseBoard(this.src, { check: checker });
    this.cells = this.board.cells;
    this.fresh();
    return this.board;
  }

  fresh() { this.cache = new Map(); this.busy = new Set(); this.cellErr = new Map(); }

  inputKey(cell) { return `${cell.name}|${cell.src}`; }

  get(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    if (this.cellErr.has(name)) throw this.cellErr.get(name);
    const cell = this.cells.get(name);
    if (!cell) return undefined;
    if (cell.bad) { const e = err(cell.bad); this.cellErr.set(name, e); throw e; }
    if (this.busy.has(name)) throw err(`「${name}」用到了它自己`);
    this.busy.add(name);
    try {
      let v;
      if (cell.input) {
        const key = this.inputKey(cell);
        if (!this.inputs.has(key)) {
          const init = this.eval(cell.ast);
          if (cell.input.type === 'scrub' && !isNumber(init)) throw err('能拨的量要一个数');
          if (cell.input.type === 'drag' && !(isVector(init) && init.length === 2)) throw err('能拖的量要一个二维向量，比如 [1, 0]');
          this.inputs.set(key, init);
        }
        v = this.inputs.get(key);
      } else if (cell.find) v = this.runFind(cell);
      else v = this.eval(cell.ast);
      if (v && v.kind === 'sentence') {
        const key = `${name}|${v.text}`;
        if (!this.folds.has(key)) this.folds.set(key, new Set());
        v = { ...v, cell: name, folded: this.folds.get(key) };
      }
      this.cache.set(name, v);
      return v;
    } catch (e) {
      const e2 = e.hb ? e : err(String(e.message || e));
      this.cellErr.set(name, e2);
      throw e2;
    } finally {
      this.busy.delete(name);
    }
  }

  /** 学生拨了 / 拖了：数换成精确的（吸附到 0.5 的格子，所以都是分数） */
  setInput(name, value) {
    const cell = this.cells.get(name);
    if (!cell || !cell.input) return false;
    const v = Array.isArray(value) ? value.map(q) : q(value);
    this.inputs.set(this.inputKey(cell), v);
    this.fresh();
    return true;
  }

  toggleFold(name, i) {
    const v = this.get(name);
    if (!v || v.kind !== 'sentence') return false;
    if (v.folded.has(i)) v.folded.delete(i); else v.folded.add(i);
    this.fresh();
    return v.folded.has(i);
  }

  value(src) { return this.eval(typeof src === 'string' ? parseExpr(src) : src); }

  eval(ast, scope, inArg = false) {
    const ev = (a, arg = false) => this.eval(a, scope, arg);
    switch (ast.k) {
      case 'num': return qnum(ast.v);
      case 'str': return ast.v;
      case 'id': {
        if (scope && Object.prototype.hasOwnProperty.call(scope, ast.name)) return scope[ast.name];
        if (this.cells.has(ast.name)) return this.get(ast.name);
        if (ast.name in CONSTS) return CONSTS[ast.name];
        // 函数参数里没定义的名字当成一个词：paging(…, algo=fifo)、faults(v, 3, lru)
        if (inArg) return ast.name;
        throw err(`不认识「${ast.name}」：先用 let 定义它`);
      }
      case 'list': return ast.items.map((x) => ev(x));
      case 'range': return { kind: 'range', lo: ev(ast.a), hi: ev(ast.b) };
      case 'mem': return this.member(ev(ast.obj), ast.name);
      case 'un': {
        const a = ev(ast.a);
        return ast.op === 'not' ? !truthy(a) : neg(a);
      }
      case 'call': {
        if (ast.named) {
          const named = {};
          for (const [k, v] of Object.entries(ast.named)) named[k] = ev(v, true);
          return makeProcess(ast.fn, named);
        }
        const args = ast.args.map((x) => ev(x, true));
        if (KFUNCS[ast.fn]) return KFUNCS[ast.fn](...args);
        if (EXACT_FUNCS.has(ast.fn)) return exactCall(ast.fn, args);
        if (isEngine(ast.fn)) throw err(`${ast.fn} 是演示：用字段名写，比如 ${ast.fn}(字段=值)`);
        throw err(`没有函数「${ast.fn}」`);
      }
      case 'bin': {
        const op = ast.op;
        if (op === 'and' || op === '且') return truthy(ev(ast.a)) && truthy(ev(ast.b));
        if (op === 'or' || op === '或') return truthy(ev(ast.a)) || truthy(ev(ast.b));
        const a = ev(ast.a), b = ev(ast.b);
        switch (op) {
          case '+': return add(a, b);
          case '-': return add(a, b, -1);
          case '*': return mul(a, b);
          case '/': return div(a, b);
          case '^': {
            try { return calcValue('__a ^ __b', { __a: a, __b: b }).value; } catch (e) { throw err(e.message); }
          }
          case '==': return same(a, b);
          case '!=': return !same(a, b);
          case '>': return cmp(a, b) > 0;
          case '<': return cmp(a, b) < 0;
          case '>=': return cmp(a, b) >= 0;
          case '<=': return cmp(a, b) <= 0;
          case '∥': return KFUNCS.par(a, b);
        }
      }
    }
    throw err('看不懂这个表达式');
  }

  member(o, name) {
    if (o && o.kind === 'process') return processMember(o, name);
    if (o && o.kind === 'sentence') return sentenceMember(o, name);
    if (Array.isArray(o) && /^\d+$/.test(name)) {
      const v = o[Number(name) - 1];
      if (v === undefined) throw err(`没有第 ${name} 个（一共 ${o.length} 个，从 1 数）`);
      return v;
    }
    throw err(`取不到 .${name}`);
  }

  /**
   * 判一个空：学生写了 given。返回 { ok, expected, misread }。
   * 空是演示过程的成员（{r.faults?}、{r.victim.2?}）时用引擎自己的判法，错了还看像哪种常见错法。
   */
  judge(ast, given) {
    let expected;
    try { expected = this.eval(ast); } catch (e) { return { ok: false, error: e.message }; }
    const pm = this.processRef(ast);
    if (pm) {
      const r = judgeProcess(pm.proc, pm.name, pm.idx, given);
      if (r) return { ok: r.ok, expected, misread: r.misread || '', msg: r.msg || '' };
    }
    return { ok: checkAnswer(given, expected), expected, misread: '' };
  }

  // r.faults → { proc: r, name: 'faults', idx: null }；r.victim.2 → idx 1
  processRef(ast) {
    try {
      if (ast.k === 'mem' && /^\d+$/.test(ast.name) && ast.obj.k === 'mem') {
        const p = this.eval(ast.obj.obj);
        if (p && p.kind === 'process') return { proc: p, name: ast.obj.name, idx: Number(ast.name) - 1 };
      }
      if (ast.k === 'mem') {
        const p = this.eval(ast.obj);
        if (p && p.kind === 'process') return { proc: p, name: ast.name, idx: null };
      }
    } catch { /* 算不出来就按普通的值判 */ }
    return null;
  }

  runFind(cell) {
    const fd = cell.find;
    const dom = this.eval(fd.dom);
    if (!dom || dom.kind !== 'domain') throw err('find … in 后面写范围：序列(15, 1..6)、整数(1..9)、向量(2, -3..3)、矩阵(2, -3..3)');
    const deps = [...idents(fd.cond), ...idents(fd.dom)].filter((x) => x !== fd.v && this.cells.has(x));
    const key = `${fd.src}|${deps.map((x) => text(this.get(x))).join('|')}`;
    if (this.findCache.has(key)) { const c = this.findCache.get(key); if (c.error) throw err(c.error); return c.value; }
    const r = rng(hash(key));
    const t0 = Date.now();
    let tries = 0, found = null;
    const scoreOf = (v) => { tries++; try { return softScore(this, fd.cond, { [fd.v]: v }); } catch (e) { if (e.hb && /不认识|没有函数/.test(e.message)) throw e; return -1e9; } };
    outer: for (let restart = 0; restart < 400 && Date.now() - t0 < FIND_MS; restart++) {
      let v = sampleDomain(dom, r);
      let sc = scoreOf(v);
      for (let it = 0; it < 3000; it++) {
        if (sc >= 0) { found = v; break outer; }
        const T = 1.2 * (1 - it / 3000) + 0.05;
        const c = mutateDomain(dom, v, r);
        const cs = scoreOf(c);
        if (cs >= sc || r() < Math.exp((cs - sc) / T)) { v = c; sc = cs; }
      }
    }
    if (!found) {
      const msg = `find 找了 ${tries} 个都不满足：条件太严，或者范围太小（序列长一点、取值多几种试试）`;
      this.findCache.set(key, { error: msg });
      throw err(msg);
    }
    this.findCache.set(key, { value: found });
    this.found.push({ name: cell.name, value: found, tries, ms: Date.now() - t0 });
    return found;
  }
}

// 条件离成立还差多少（≥ 0 就是成立）：a > b 的分数是 a − b，and 取最小、or 取最大，别的成立是 0、不成立是 −1
function softScore(rt, ast, scope) {
  if (ast.k === 'bin') {
    const op = ast.op;
    if (op === 'and' || op === '且') return Math.min(softScore(rt, ast.a, scope), softScore(rt, ast.b, scope));
    if (op === 'or' || op === '或') return Math.max(softScore(rt, ast.a, scope), softScore(rt, ast.b, scope));
    if (['>', '<', '>=', '<=', '=='].includes(op)) {
      const a = rt.eval(ast.a, scope), b = rt.eval(ast.b, scope);
      if (isNumber(a) && isNumber(b)) {
        const c = cmp(a, b), d = f(a) - f(b);
        if (op === '>') return c > 0 ? 0 : d - 1;
        if (op === '>=') return c >= 0 ? 0 : d;
        if (op === '<') return c < 0 ? 0 : -d - 1;
        if (op === '<=') return c <= 0 ? 0 : -d;
        return c === 0 ? 0 : -Math.abs(d);
      }
    }
  }
  return truthy(rt.eval(ast, scope)) ? 0 : -1;
}

function rng(seed) {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }

export { text, scale };
