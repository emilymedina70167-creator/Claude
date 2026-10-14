// C 子集的解释器（trace 组件用）：把一段王道风格的 C 代码真的跑一遍，每执行一行记一步（行号、各层的变量、数组、输出）。
// 支持：int / long / short / unsigned / char / double / float / bool（typedef 成别的名字也行，ElemType 默认是 int）、
//   #define 常量、全局 / 局部变量、一维二维数组（可以 {…} 初始化）、函数和递归、引用参数 int &a（王道的 C++ 写法）、
//   if / else、for、while、do-while、break、continue、return，运算符（算术、比较、逻辑、位运算、自增自减、复合赋值、?:），
//   printf / putchar / puts，内置 swap(a, b)（代码里没写 swap 时）、abs、max、min。
// 第一期不支持：指针、结构体、malloc、switch、goto……遇到了报「第几行：不支持……」。
// 纯函数，不碰 DOM（tests/cinterp.test.js）。
export const MAX_STEPS = 10000;
const MAX_DEPTH = 200;

export class CError extends Error {
  constructor(msg, line) {
    super(line ? `第 ${line} 行：${msg}` : msg);
    this.line = line;
  }
}

// —— 预处理：#include 去掉；#define 名字 值 换成值（只认常量）——
export function preprocess(src) {
  const defines = {};
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n').map((l, i) => {
    const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(l);
    if (!m) return l;
    if (m[1] === 'include') return '';
    if (m[1] === 'define') {
      const d = /^([A-Za-z_]\w*)\s+(.+?)\s*(?:\/\/.*)?$/.exec(m[2]);
      if (!d || d[1].includes('(')) throw new CError('#define 只支持常量（#define MaxSize 50）', i + 1);
      defines[d[1]] = d[2];
      return '';
    }
    throw new CError(`不支持 #${m[1]}`, i + 1);
  });
  return { text: lines.join('\n'), defines };
}

// —— 词法 ——
const OPS = ['<<=', '>>=', '...', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '->', ...'+-*/%<>=!&|^~?:;,.()[]{}'.split('')];
const KEYWORDS = new Set(['int', 'long', 'short', 'unsigned', 'signed', 'char', 'double', 'float', 'bool', 'void', 'const', 'static', 'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'return', 'typedef', 'true', 'false', 'struct', 'union', 'enum', 'switch', 'case', 'default', 'goto', 'sizeof']);

export function tokenize(text, defines = {}) {
  const toks = [];
  let i = 0, line = 1;
  const s = text;
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (s.startsWith('//', i)) { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (s.startsWith('/*', i)) { const e = s.indexOf('*/', i + 2); const end = e < 0 ? s.length : e + 2; line += (s.slice(i, end).match(/\n/g) || []).length; i = end; continue; }
    const start = i;
    let m;
    if ((m = /^(0[xX][0-9a-fA-F]+|\d+\.\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?)[uUlLfF]*/.exec(s.slice(i)))) {
      const t = m[1];
      const isFloat = /[.eE]/.test(t) && !/^0[xX]/.test(t);
      toks.push({ k: 'num', v: isFloat ? parseFloat(t) : Number(t), float: isFloat, line, pos: start, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (c === "'") {
      const m2 = /^'(\\.|[^'\\])'/.exec(s.slice(i));
      if (!m2) throw new CError('字符常量写错了', line);
      toks.push({ k: 'char', v: unescape(m2[1]).charCodeAt(0), line, pos: start, end: i + m2[0].length });
      i += m2[0].length;
      continue;
    }
    if (c === '"') {
      const m2 = /^"((?:\\.|[^"\\\n])*)"/.exec(s.slice(i));
      if (!m2) throw new CError('字符串没有结束的引号', line);
      toks.push({ k: 'str', v: unescape(m2[1]), line, pos: start, end: i + m2[0].length });
      i += m2[0].length;
      continue;
    }
    if ((m = /^[A-Za-z_]\w*/.exec(s.slice(i)))) {
      const w = m[0];
      i += w.length;
      if (Object.prototype.hasOwnProperty.call(defines, w)) {
        // #define 的常量：把值再切一遍，行号算在用到它的这一行
        for (const t of tokenize(defines[w], {})) if (t.k !== 'eof') toks.push({ ...t, line, pos: start, end: i });
        continue;
      }
      toks.push({ k: KEYWORDS.has(w) ? 'kw' : 'id', v: w, line, pos: start, end: i });
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (!op) throw new CError(`看不懂的字符「${c}」`, line);
    toks.push({ k: 'op', v: op, line, pos: start, end: i + op.length });
    i += op.length;
  }
  toks.push({ k: 'eof', v: '', line, pos: s.length, end: s.length });
  return toks;
}
function unescape(s) {
  return s.replace(/\\(n|t|0|\\|'|"|r)/g, (_, c) => ({ n: '\n', t: '\t', 0: '\0', '\\': '\\', "'": "'", '"': '"', r: '\r' }[c]));
}

// —— 语法 ——
// 二元运算的优先级，从低到高
const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
const BASE = new Set(['int', 'long', 'short', 'unsigned', 'signed', 'char', 'double', 'float', 'bool', 'void']);

export function parseProgram(src) {
  const { text, defines } = preprocess(src);
  const toks = tokenize(text, defines);
  const aliases = { ElemType: 'int', Status: 'int', KeyType: 'int', InfoType: 'int', VertexType: 'char', DataType: 'int', BOOL: 'bool' };
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const next = () => toks[p++];
  const is = (v, o = 0) => { const t = peek(o); return (t.k === 'op' || t.k === 'kw') && t.v === v; };
  const eat = (v) => { if (is(v)) { p++; return true; } return false; };
  const expect = (v) => { if (!eat(v)) { const t = peek(); throw new CError(`这里应该是「${v}」${t.k === 'eof' ? '（代码不完整）' : `，写的是「${t.v}」`}`, t.line); } };
  const srcOf = (a, b) => text.slice(a, b).replace(/\s+/g, ' ').trim();
  const isType = (o = 0) => {
    const t = peek(o);
    if (t.k === 'kw' && (BASE.has(t.v) || t.v === 'const' || t.v === 'static')) return true;
    if (t.k === 'kw' && ['struct', 'union', 'enum'].includes(t.v)) throw new CError(`第一期还不支持 ${t.v}（结构体、链表第二期做）`, t.line);
    return t.k === 'id' && Object.prototype.hasOwnProperty.call(aliases, t.v);
  };
  const readType = () => {
    const words = [];
    while (isType()) {
      const t = next();
      if (t.k === 'id') words.push(aliases[t.v]);
      else if (t.v !== 'const' && t.v !== 'static') words.push(t.v);
    }
    if (is('*')) throw new CError('第一期还不支持指针（第二期做链表、二叉链表时加）', peek().line);
    if (words.includes('double') || words.includes('float')) return 'double';
    if (words.includes('char')) return 'char';
    if (words.includes('bool')) return 'bool';
    if (words.includes('void')) return 'void';
    return 'int';
  };

  const program = { funcs: {}, globals: [], line: 1 };
  while (peek().k !== 'eof') {
    if (eat('typedef')) {
      // typedef 类型 新名字;（新名字可能本来就认识，比如 ElemType：最后一个词是新名字）
      const words = [];
      while (!is(';')) { const t = next(); if (t.k === 'eof') throw new CError('typedef 少了分号', t.line); if (is('[')) throw new CError('不支持 typedef 数组类型', t.line); words.push(t); }
      const name = words.pop();
      if (!name || name.k !== 'id' || !words.length) throw new CError('typedef 的写法：typedef int ElemType;', name?.line);
      if (words.some((w) => w.k === 'kw' && ['struct', 'union', 'enum'].includes(w.v))) throw new CError(`第一期还不支持 ${words.find((w) => w.k === 'kw').v}（结构体、链表第二期做）`, name.line);
      if (words.some((w) => w.k === 'op' && w.v === '*')) throw new CError('第一期还不支持指针', name.line);
      const v = words.map((w) => (w.k === 'id' ? aliases[w.v] : w.v));
      if (v.some((x) => x === undefined)) throw new CError(`typedef 里有不认识的类型 ${words.find((w) => w.k === 'id' && !aliases[w.v]).v}`, name.line);
      aliases[name.v] = v.includes('double') || v.includes('float') ? 'double' : v.includes('char') ? 'char' : v.includes('bool') ? 'bool' : 'int';
      expect(';');
      continue;
    }
    if (!isType()) { const t = peek(); throw new CError(`这里应该是函数或者全局变量的定义，写的是「${t.v}」`, t.line); }
    const tStart = peek();
    const type = readType();
    const name = next();
    if (name.k !== 'id') throw new CError(`类型后面要写名字，写的是「${name.v}」`, name.line);
    if (is('(')) {
      program.funcs[name.v] = parseFunc(type, name);
      continue;
    }
    p--;
    program.globals.push(parseDeclRest(type, tStart.line));
  }
  return program;

  function parseFunc(ret, name) {
    expect('(');
    const params = [];
    if (!is(')')) {
      if (is('void') && peek(1).v === ')') next();
      else {
        do {
          const type = readType();
          const ref = eat('&');
          const id = next();
          if (id.k !== 'id') throw new CError('参数要有名字', id.line);
          let dims = 0;
          while (eat('[')) { while (!is(']')) next(); expect(']'); dims++; }
          params.push({ name: id.v, type, ref, array: dims > 0 });
        } while (eat(','));
      }
    }
    expect(')');
    if (eat(';')) return { name: name.v, ret, params, body: null, line: name.line }; // 只是声明
    const body = parseBlock();
    return { name: name.v, ret, params, body, line: name.line, endLine: toks[p - 1].line };
  }
  function parseDeclRest(type, line) {
    const decls = [];
    do {
      const ref = eat('&');
      const id = next();
      if (id.k !== 'id') throw new CError(`这里应该是变量名，写的是「${id.v}」`, id.line);
      const dims = [];
      while (eat('[')) {
        if (is(']')) { dims.push(null); next(); continue; }
        dims.push(parseExpr());
        expect(']');
      }
      let init = null;
      if (eat('=')) init = is('{') ? parseInitList() : parseAssign();
      decls.push({ name: id.v, dims, init, ref });
    } while (eat(','));
    expect(';');
    return { t: 'decl', type, decls, line, src: srcOf(toks.find((x) => x.line === line)?.pos ?? 0, toks[p - 1].end) };
  }
  function parseInitList() {
    expect('{');
    const items = [];
    if (!is('}')) do { if (is('}')) break; items.push(is('{') ? parseInitList() : parseAssign()); } while (eat(','));
    expect('}');
    return { t: 'init', items };
  }
  function parseBlock() {
    const open = peek();
    expect('{');
    const body = [];
    while (!is('}')) { if (peek().k === 'eof') throw new CError('少了右花括号 }', open.line); body.push(parseStmt()); }
    expect('}');
    return { t: 'block', body, line: open.line };
  }
  function parseStmt() {
    const t = peek();
    if (is('{')) return parseBlock();
    if (t.k === 'kw') {
      if (['switch', 'goto', 'case', 'default'].includes(t.v)) throw new CError(`第一期还不支持 ${t.v}`, t.line);
      if (eat('if')) {
        expect('(');
        const c0 = peek().pos;
        const cond = parseExpr();
        const csrc = srcOf(c0, toks[p - 1].end);
        expect(')');
        const then = parseStmt();
        const els = eat('else') ? parseStmt() : null;
        return { t: 'if', cond, csrc, then, els, line: t.line };
      }
      if (eat('while')) {
        expect('(');
        const c0 = peek().pos;
        const cond = parseExpr();
        const csrc = srcOf(c0, toks[p - 1].end);
        expect(')');
        return { t: 'while', cond, csrc, body: parseStmt(), line: t.line };
      }
      if (eat('do')) {
        const body = parseStmt();
        const wl = peek().line;
        expect('while');
        expect('(');
        const c0 = peek().pos;
        const cond = parseExpr();
        const csrc = srcOf(c0, toks[p - 1].end);
        expect(')');
        expect(';');
        return { t: 'do', body, cond, csrc, line: t.line, condLine: wl };
      }
      if (eat('for')) {
        expect('(');
        let init = null;
        const i0 = peek().pos;
        if (isType()) { const ty = readType(); init = parseDeclRest(ty, t.line); }
        else { if (!is(';')) init = { t: 'expr', e: parseExpr(true), line: t.line }; expect(';'); }
        const isrc = srcOf(i0, toks[p - 1].end).replace(/;$/, '');
        const c0 = peek().pos;
        const cond = is(';') ? null : parseExpr();
        const csrc = srcOf(c0, toks[p - 1].end);
        expect(';');
        const u0 = peek().pos;
        const update = is(')') ? null : parseExpr(true);
        const usrc = srcOf(u0, toks[p - 1].end);
        expect(')');
        return { t: 'for', init, isrc, cond, csrc, update, usrc, body: parseStmt(), line: t.line };
      }
      if (eat('break')) { expect(';'); return { t: 'break', line: t.line }; }
      if (eat('continue')) { expect(';'); return { t: 'continue', line: t.line }; }
      if (eat('return')) {
        const e0 = peek().pos;
        const e = is(';') ? null : parseExpr();
        const esrc = srcOf(e0, toks[p - 1].end);
        expect(';');
        return { t: 'return', e, esrc, line: t.line };
      }
      if (isType()) { const ty = readType(); return parseDeclRest(ty, t.line); }
    }
    if (eat(';')) return { t: 'empty', line: t.line };
    if (isType()) { const ty = readType(); return parseDeclRest(ty, t.line); }
    const e0 = t.pos;
    const e = parseExpr(true);
    const src2 = srcOf(e0, toks[p - 1].end);
    expect(';');
    return { t: 'expr', e, src: src2, line: t.line };
  }

  // 表达式（优先级从低到高）
  function parseExpr(comma = false) {
    let e = parseAssign();
    while (comma && is(',')) { next(); e = { t: 'comma', a: e, b: parseAssign(), line: e.line }; }
    return e;
  }
  function parseAssign() {
    const lhs = parseCond();
    const t = peek();
    if (t.k === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) {
      next();
      if (!['var', 'index'].includes(lhs.t)) throw new CError(`「${t.v}」左边要是变量或者数组元素`, t.line);
      return { t: 'assign', op: t.v, target: lhs, value: parseAssign(), line: t.line };
    }
    return lhs;
  }
  function parseCond() {
    const c = parseBin(0);
    if (is('?')) { const l = next().line; const a = parseExpr(); expect(':'); return { t: 'cond', c, a, b: parseCond(), line: l }; }
    return c;
  }
  function parseBin(level) {
    if (level >= LEVELS.length) return parseUnary();
    let a = parseBin(level + 1);
    for (;;) {
      const t = peek();
      if (t.k === 'op' && LEVELS[level].includes(t.v)) { next(); a = { t: 'bin', op: t.v, a, b: parseBin(level + 1), line: t.line }; } else return a;
    }
  }
  function parseUnary() {
    const t = peek();
    if (t.k === 'op' && ['-', '+', '!', '~'].includes(t.v)) { next(); return { t: 'unary', op: t.v, a: parseUnary(), line: t.line }; }
    if (t.k === 'op' && (t.v === '++' || t.v === '--')) { next(); const a = parseUnary(); if (!['var', 'index'].includes(a.t)) throw new CError(`${t.v} 只能用在变量上`, t.line); return { t: 'incdec', op: t.v, pre: true, a, line: t.line }; }
    if (t.k === 'op' && (t.v === '*' || t.v === '&')) throw new CError('第一期还不支持指针（* 和 & 取地址）', t.line);
    if (t.k === 'kw' && t.v === 'sizeof') throw new CError('不支持 sizeof', t.line);
    // 强制类型转换 (int)x
    if (is('(') && isType(1)) { next(); const ty = readType(); expect(')'); return { t: 'cast', to: ty, a: parseUnary(), line: t.line }; }
    return parsePostfix();
  }
  function parsePostfix() {
    let a = parsePrimary();
    for (;;) {
      const t = peek();
      if (is('[')) { next(); const i = parseExpr(); expect(']'); a = { t: 'index', a, i, line: t.line }; continue; }
      if (is('++') || is('--')) { next(); if (!['var', 'index'].includes(a.t)) throw new CError(`${t.v} 只能用在变量上`, t.line); a = { t: 'incdec', op: t.v, pre: false, a, line: t.line }; continue; }
      if (is('.') || is('->')) throw new CError('第一期还不支持结构体（. 和 ->）', t.line);
      return a;
    }
  }
  function parsePrimary() {
    const t = next();
    if (t.k === 'num') return { t: 'num', v: t.v, float: t.float, line: t.line };
    if (t.k === 'char') return { t: 'num', v: t.v, char: true, line: t.line };
    if (t.k === 'str') return { t: 'str', v: t.v, line: t.line };
    if (t.k === 'kw' && (t.v === 'true' || t.v === 'false')) return { t: 'num', v: t.v === 'true' ? 1 : 0, bool: true, line: t.line };
    if (t.k === 'id') {
      if (is('(')) {
        next();
        const args = [];
        if (!is(')')) do args.push(parseAssign()); while (eat(','));
        expect(')');
        return { t: 'call', name: t.v, args, line: t.line };
      }
      return { t: 'var', name: t.v, line: t.line };
    }
    if (t.k === 'op' && t.v === '(') { const e = parseExpr(true); expect(')'); return e; }
    throw new CError(t.k === 'eof' ? '代码不完整' : `看不懂「${t.v}」`, t.line);
  }
}

// —— 运行 ——

// 值：{ t: 'int' | 'char' | 'double' | 'bool', v: 数 }；数组：{ arr: true, id, name, type, dims: [..], data: [..] }
const num = (t, v) => ({ t, v });
function convert(type, val, line) {
  if (val === undefined || val === null) return undefined;
  if (val.arr) throw new CError('数组不能直接赋给一个变量', line);
  let v = val.v;
  if (type === 'double') return num('double', v);
  if (type === 'bool') return num('bool', v ? 1 : 0);
  v = Math.trunc(v);
  if (type === 'char') return num('char', ((v % 256) + 256) % 256);
  return num('int', v);
}
const arith = (a, b) => (a.t === 'double' || b.t === 'double' ? 'double' : 'int');

/** 显示一个值：char 写成 'a'，bool 写成 true / false，double 去掉多余的 0 */
export function show(val) {
  if (val === undefined) return '?';
  if (val.arr) return `${val.name}[…]`;
  if (val.t === 'char') return val.v >= 32 && val.v < 127 ? `'${String.fromCharCode(val.v)}'` : String(val.v);
  if (val.t === 'bool') return val.v ? 'true' : 'false';
  if (val.t === 'double') return String(Number(val.v.toPrecision(10)));
  return String(val.v);
}

function printf(fmt, args, line) {
  let k = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d+))?(l{0,2}|h)?([dicfsuxXe%])/g, (m, flags, width, prec, len, conv) => {
    if (conv === '%') return '%';
    const a = args[k++];
    if (a === undefined) throw new CError('printf 的参数比格式里的 % 少', line);
    let s;
    if (conv === 's') s = a.str ?? show(a);
    else if (conv === 'c') s = String.fromCharCode(a.v);
    else if (conv === 'f') s = a.v.toFixed(prec === undefined ? 6 : Number(prec));
    else if (conv === 'e') s = a.v.toExponential(prec === undefined ? 6 : Number(prec));
    else if (conv === 'x' || conv === 'X') { s = (a.v >>> 0).toString(16); if (conv === 'X') s = s.toUpperCase(); }
    else if (conv === 'u') s = String(a.v >>> 0);
    else s = String(Math.trunc(a.v));
    const w = Number(width || 0);
    if (s.length < w) s = flags.includes('-') ? s.padEnd(w) : flags.includes('0') && conv !== 's' ? s.padStart(w, '0') : s.padStart(w);
    return s;
  });
}

/**
 * 跑程序。opts：
 *   entry：{ src, e }，从哪个调用开始（如 InsertSort(A, 8)，e 是 parseExpression 的结果），配 vars（全局变量：数或数组）；不给就跑 main
 *   watchers：[{ line, cond(scopeEval) → bool, take(scopeEval) → 值 }]：走到那一行之前判断 cond，执行完取值（先猜用）
 * 返回 { steps: [{ line, kind, msg, frames, out, changed }], arrays（id → 名字）, error? }
 */
export function runProgram(program, { entry: start = null, vars = {}, maxSteps = MAX_STEPS, watchers = [] } = {}) {
  const globals = new Map();
  const arrays = [];
  let arrSeq = 0;
  let out = '';
  const steps = [];
  const stack = []; // { fn, scopes: [Map], args }
  const done = new Set();
  let error = null;

  const mkArray = (name, type, dims, fill) => {
    const size = dims.reduce((a, b) => a * b, 1);
    if (size > 400) throw new CError(`数组 ${name} 太大了（${size} 个元素），这里最多 400 个`);
    const a = { arr: true, id: ++arrSeq, name, type, dims, data: Array.from({ length: size }, () => fill) };
    arrays.push(a);
    return a;
  };
  const scopeLookup = (name) => {
    const f = stack[stack.length - 1];
    if (f) for (let i = f.scopes.length - 1; i >= 0; i--) if (f.scopes[i].has(name)) return f.scopes[i].get(name);
    return globals.get(name);
  };

  // —— 快照 ——
  function snapshot(line, kind, msg, extra = {}) {
    if (steps.length >= maxSteps) throw new CError(`已经走了 ${maxSteps} 步还没结束：可能是死循环（看看循环条件和变量有没有变）`, line);
    const frames = stack.map((f) => ({
      fn: f.fn.name,
      args: f.argText,
      vars: f.scopes.flatMap((sc) => [...sc.entries()].map(([name, cell]) => varView(name, cell))),
    }));
    const g = [...globals.entries()].map(([name, cell]) => varView(name, cell));
    const s = { line, kind, msg, frames, globals: g, out, ...extra };
    steps.push(s);
    return s;
  }
  function varView(name, cell) {
    if (cell.ref) { const target = cell.ref; return { name, ref: true, type: cell.type, ...(target.arr ? { arr: target.id } : { value: show(refGet(target)) }) }; }
    if (cell.arr) return { name, type: cell.arr.type, arr: cell.arr.id, dims: cell.arr.dims, data: cell.arr.data.map(show) };
    return { name, type: cell.type, value: show(cell.val) };
  }

  // —— 左值：变量、数组元素 ——
  function refGet(r) { if (r.cell) return r.cell.ref ? refGet(r.cell.ref) : r.cell.val; return r.a.data[r.i]; }
  function refSet(r, v) { if (r.cell) { if (r.cell.ref) return refSet(r.cell.ref, v); r.cell.val = v; return; } r.a.data[r.i] = v; }
  const refType = (r) => (r.cell ? (r.cell.ref ? refType(r.cell.ref) : r.cell.type) : r.a.type);
  const refName = (r) => (r.cell ? r.name : `${r.a.name}${r.idx.map((x) => `[${x}]`).join('')}`);

  function* lvalue(e) {
    if (e.t === 'var') {
      const cell = scopeLookup(e.name);
      if (!cell) throw new CError(`没有定义变量 ${e.name}`, e.line);
      if (cell.arr && !cell.ref) throw new CError(`${e.name} 是数组，要写下标`, e.line);
      return { cell, name: e.name };
    }
    if (e.t === 'index') {
      const { a, off, dims, idx } = yield* arrayPart(e);
      if (dims.length !== 0) throw new CError(`${a.name} 是 ${a.dims.length} 维数组，下标写少了`, e.line);
      return { a, i: off, idx };
    }
    throw new CError('这里要的是变量或者数组元素', e.line);
  }
  // A[i][j]：一层层算出偏移
  function* arrayPart(e) {
    if (e.t === 'var') {
      let cell = scopeLookup(e.name);
      if (!cell) throw new CError(`没有定义数组 ${e.name}`, e.line);
      const a = cell.ref?.arr ? cell.ref : cell.arr;
      if (!a) throw new CError(`${e.name} 不是数组，不能写下标`, e.line);
      return { a, off: 0, dims: a.dims.slice(), idx: [] };
    }
    if (e.t === 'index') {
      const base = yield* arrayPart(e.a);
      if (!base.dims.length) throw new CError(`${base.a.name} 的下标写多了`, e.line);
      const iv = yield* evalExpr(e.i);
      if (iv === undefined) throw new CError(`下标里的变量还没赋值`, e.line);
      if (iv.t === 'double') throw new CError('下标要是整数', e.line);
      const n = base.dims[0];
      const i = iv.v;
      if (i < 0 || i >= n) throw new CError(`${base.a.name}${base.idx.map((x) => `[${x}]`).join('')}[${i}] 越界了（这一维只有 ${n} 个，下标 0～${n - 1}）`, e.line);
      const rest = base.dims.slice(1);
      const stride = rest.reduce((x, y) => x * y, 1);
      return { a: base.a, off: base.off + i * stride, dims: rest, idx: [...base.idx, i] };
    }
    throw new CError('只有数组能写下标', e.line);
  }

  // —— 表达式（生成器：里面有函数调用时，要能一步步走进去）——
  function* evalExpr(e) {
    switch (e.t) {
      case 'num': return num(e.float ? 'double' : e.char ? 'char' : e.bool ? 'bool' : 'int', e.v);
      case 'str': return { t: 'str', str: e.v, v: 0 };
      case 'var': {
        const cell = scopeLookup(e.name);
        if (!cell) throw new CError(`没有定义变量 ${e.name}`, e.line);
        if (cell.ref) return cell.ref.arr ? cell.ref : refGet(cell.ref);
        if (cell.arr) return cell.arr;
        if (cell.val === undefined) throw new CError(`${e.name} 还没赋值就用了`, e.line);
        return cell.val;
      }
      case 'index': {
        const { a, off, dims, idx } = yield* arrayPart(e);
        if (dims.length) return { arr: true, sub: true, id: a.id, name: `${a.name}${idx.map((x) => `[${x}]`).join('')}`, type: a.type, dims, data: a.data, off };
        const v = a.data[off];
        if (v === undefined) throw new CError(`${a.name}${idx.map((x) => `[${x}]`).join('')} 还没赋值就用了`, e.line);
        return v;
      }
      case 'assign': {
        const r = yield* lvalue(e.target);
        let v = yield* evalExpr(e.value);
        if (v?.arr) throw new CError('数组不能整个赋值', e.line);
        if (e.op !== '=') v = binop(e.op.slice(0, -1), refGet(r), v, e.line, refName(r));
        const nv = convert(refType(r), v, e.line);
        refSet(r, nv);
        return nv;
      }
      case 'incdec': {
        const r = yield* lvalue(e.a);
        const old = refGet(r);
        if (old === undefined) throw new CError(`${refName(r)} 还没赋值就用了`, e.line);
        const nv = convert(refType(r), num(old.t, old.v + (e.op === '++' ? 1 : -1)), e.line);
        refSet(r, nv);
        return e.pre ? nv : old;
      }
      case 'unary': {
        const a = yield* evalExpr(e.a);
        if (a?.arr) throw new CError('数组不能参加运算', e.line);
        if (e.op === '-') return num(a.t === 'double' ? 'double' : 'int', -a.v);
        if (e.op === '+') return num(a.t === 'double' ? 'double' : 'int', a.v);
        if (e.op === '!') return num('int', a.v ? 0 : 1);
        return num('int', ~a.v);
      }
      case 'cast': {
        const a = yield* evalExpr(e.a);
        return convert(e.to === 'void' ? 'int' : e.to, a, e.line);
      }
      case 'bin': {
        if (e.op === '&&' || e.op === '||') {
          const a = yield* evalExpr(e.a);
          if (e.op === '&&' && !a.v) return num('int', 0);
          if (e.op === '||' && a.v) return num('int', 1);
          const b = yield* evalExpr(e.b);
          return num('int', b.v ? 1 : 0);
        }
        const a = yield* evalExpr(e.a);
        const b = yield* evalExpr(e.b);
        return binop(e.op, a, b, e.line);
      }
      case 'cond': {
        const c = yield* evalExpr(e.c);
        return c.v ? yield* evalExpr(e.a) : yield* evalExpr(e.b);
      }
      case 'comma': { yield* evalExpr(e.a); return yield* evalExpr(e.b); }
      case 'call': return yield* call(e);
    }
    throw new CError('看不懂的表达式', e.line);
  }
  function binop(op, a, b, line, what) {
    if (a?.arr || b?.arr) throw new CError('数组不能参加运算（要写下标）', line);
    if (a === undefined || b === undefined) throw new CError(`${what || '变量'} 还没赋值就用了`, line);
    const t = arith(a, b);
    const x = a.v, y = b.v;
    switch (op) {
      case '+': return num(t, x + y);
      case '-': return num(t, x - y);
      case '*': return num(t, x * y);
      case '/':
        if (y === 0) throw new CError('除以 0 了', line);
        return num(t, t === 'int' ? Math.trunc(x / y) : x / y);
      case '%':
        if (t === 'double') throw new CError('% 只能用在整数上', line);
        if (y === 0) throw new CError('对 0 取余了', line);
        return num('int', x % y);
      case '<': return num('int', +(x < y));
      case '<=': return num('int', +(x <= y));
      case '>': return num('int', +(x > y));
      case '>=': return num('int', +(x >= y));
      case '==': return num('int', +(x === y));
      case '!=': return num('int', +(x !== y));
      case '&': return num('int', x & y);
      case '|': return num('int', x | y);
      case '^': return num('int', x ^ y);
      case '<<': return num('int', x << y);
      case '>>': return num('int', x >> y);
    }
    throw new CError(`看不懂运算 ${op}`, line);
  }

  // —— 函数调用 ——
  function* call(e) {
    const f = program.funcs[e.name];
    if (!f || !f.body) return yield* builtin(e);
    if (f.params.length !== e.args.length) throw new CError(`${e.name} 要 ${f.params.length} 个参数，这里给了 ${e.args.length} 个`, e.line);
    if (stack.length >= MAX_DEPTH) throw new CError(`递归太深了（超过 ${MAX_DEPTH} 层）：可能没有写递归出口`, e.line);
    const scope = new Map();
    const argText = [];
    for (let k = 0; k < f.params.length; k++) {
      const prm = f.params[k], arg = e.args[k];
      if (prm.ref) {
        const r = yield* lvalue(arg);
        scope.set(prm.name, { ref: r, type: prm.type });
        argText.push(`${prm.name} 是 ${refName(r)} 的引用`);
        continue;
      }
      const v = yield* evalExpr(arg);
      if (prm.array) {
        if (!v?.arr) throw new CError(`${e.name} 的第 ${k + 1} 个参数要传数组`, e.line);
        if (v.sub) throw new CError('第一期还不支持把二维数组的一行传进函数', e.line);
        scope.set(prm.name, { ref: v, type: prm.type });
        argText.push(prm.name === v.name ? `数组 ${v.name}` : `${prm.name} 就是数组 ${v.name}`);
        continue;
      }
      if (v?.arr) throw new CError(`${e.name} 的第 ${k + 1} 个参数是 ${prm.type}，不能传数组`, e.line);
      scope.set(prm.name, { type: prm.type, val: convert(prm.type, v, e.line) });
      argText.push(`${prm.name} = ${show(convert(prm.type, v, e.line))}`);
    }
    stack.push({ fn: f, scopes: [scope], argText: argText.join('，') });
    yield* unit(f.line, 'call', `调用 ${f.name}(${argText.join('，')})。`, undefined, arm(f.line));
    let ret;
    try {
      yield* stmt(f.body, { fnScope: true });
    } catch (x) {
      if (!x || x.kind !== 'return') throw x;
      ret = x.value;
    }
    stack.pop();
    if (f.ret === 'void') return num('int', 0);
    if (ret === undefined) throw new CError(`${f.name} 应该返回一个值，但没有执行到 return`, f.endLine || f.line);
    return convert(f.ret, ret, f.line);
  }
  function* builtin(e) {
    const args = [];
    if (e.name === 'swap') {
      if (e.args.length !== 2) throw new CError('swap 要两个参数', e.line);
      const a = yield* lvalue(e.args[0]);
      const b = yield* lvalue(e.args[1]);
      const x = refGet(a), y = refGet(b);
      refSet(a, convert(refType(a), y, e.line));
      refSet(b, convert(refType(b), x, e.line));
      return num('int', 0);
    }
    for (const a of e.args) args.push(yield* evalExpr(a));
    switch (e.name) {
      case 'printf': {
        if (args[0]?.t !== 'str') throw new CError('printf 的第一个参数要是格式字符串', e.line);
        const s = printf(args[0].str, args.slice(1), e.line);
        out += s;
        return num('int', s.length);
      }
      case 'puts': out += `${args[0]?.str ?? show(args[0])}\n`; return num('int', 0);
      case 'putchar': out += String.fromCharCode(args[0].v); return args[0];
      case 'abs': return num(args[0].t === 'double' ? 'double' : 'int', Math.abs(args[0].v));
      case 'max': return num(arith(args[0], args[1]), Math.max(args[0].v, args[1].v));
      case 'min': return num(arith(args[0], args[1]), Math.min(args[0].v, args[1].v));
      case 'sqrt': return num('double', Math.sqrt(args[0].v));
      case 'pow': return num('double', args[0].v ** args[1].v);
      case 'scanf': case 'gets': case 'malloc': case 'free': case 'getchar':
        throw new CError(`不支持 ${e.name}${['malloc', 'free'].includes(e.name) ? '（指针、链表第二期做）' : '（输入用 let / call 给好）'}`, e.line);
    }
    throw new CError(`没有函数 ${e.name}`, e.line);
  }

  // —— 一步：执行一个「单元」（一条语句、一次条件判断）——
  // 先看有没有 watcher 要在这里问（判断用执行前的变量），执行完再取答案
  function scopeEval(expr) {
    const g = evalExpr(expr);
    let r = g.next();
    if (!r.done) throw new CError('先猜的表达式里不能调用函数');
    return r.value;
  }
  // 走到第 line 行之前：看哪些 watcher 的条件成立（用执行前的变量），执行完由 unit 取答案
  function arm(line) {
    const hits = [];
    for (const w of watchers) {
      if (done.has(w) || w.line !== line) continue;
      let hit = false;
      try { hit = !w.cond || !!scopeEval(w.cond)?.v; } catch { hit = false; }
      if (hit) { done.add(w); hits.push(w); }
    }
    return hits;
  }
  function* unit(line, kind, msg, extra, hits = []) {
    const s = snapshot(line, kind, msg, extra);
    for (const w of hits) {
      let v;
      try { v = show(scopeEval(w.take)); } catch (x) { v = undefined; w.error = x.message; }
      s.asks = [...(s.asks || []), { w, value: v }];
    }
    yield s;
  }

  // 语句。控制流（break / continue / return）用抛出的对象传出去
  function* stmt(s, { fnScope = false } = {}) {
    const f = stack[stack.length - 1];
    switch (s.t) {
      case 'block': {
        if (!fnScope) f.scopes.push(new Map());
        try { for (const x of s.body) yield* stmt(x); } finally { if (!fnScope) f.scopes.pop(); }
        return;
      }
      case 'empty': return;
      case 'decl': {
        const hits = arm(s.line);
        const before = diffBase();
        for (const d of s.decls) yield* declare(d, s.type, f.scopes[f.scopes.length - 1], s.line);
        const blank = s.decls.filter((d) => !d.init && !d.dims.length).map((d) => d.name);
        const msg = blank.length === s.decls.length ? `定义 ${blank.join('、')}（还没有值）。` : describe(before, s.src);
        yield* unit(s.line, 'decl', msg, undefined, hits);
        return;
      }
      case 'expr': {
        const hits = arm(s.line);
        const before = diffBase();
        const outBefore = out;
        yield* evalExpr(s.e);
        yield* unit(s.line, 'expr', describe(before, s.src, outBefore), undefined, hits);
        return;
      }
      case 'if': {
        const hits = arm(s.line);
        const c = yield* evalExpr(s.cond);
        yield* unit(s.line, 'cond', `条件 ${s.csrc} ${c.v ? '成立' : '不成立'}${valuesIn(s.cond)}${c.v ? '' : s.els ? '，走 else' : '，跳过'}。`, { cond: !!c.v }, hits);
        if (c.v) yield* stmt(s.then);
        else if (s.els) yield* stmt(s.els);
        return;
      }
      case 'while': {
        for (;;) {
          const hits = arm(s.line);
          const c = yield* evalExpr(s.cond);
          yield* unit(s.line, 'cond', `循环条件 ${s.csrc} ${c.v ? '成立，进循环体' : '不成立，循环结束'}${valuesIn(s.cond)}。`, { cond: !!c.v }, hits);
          if (!c.v) return;
          try { yield* stmt(s.body); } catch (x) { if (x?.kind === 'break') return; if (x?.kind !== 'continue') throw x; }
        }
      }
      case 'do': {
        for (;;) {
          try { yield* stmt(s.body); } catch (x) { if (x?.kind === 'break') return; if (x?.kind !== 'continue') throw x; }
          const hits = arm(s.condLine);
          const c = yield* evalExpr(s.cond);
          yield* unit(s.condLine, 'cond', `循环条件 ${s.csrc} ${c.v ? '成立，再来一次' : '不成立，循环结束'}${valuesIn(s.cond)}。`, { cond: !!c.v }, hits);
          if (!c.v) return;
        }
      }
      case 'for': {
        f.scopes.push(new Map());
        try {
          if (s.init) {
            const hits = arm(s.line);
            const before = diffBase();
            if (s.init.t === 'decl') for (const d of s.init.decls) yield* declare(d, s.init.type, f.scopes[f.scopes.length - 1], s.line);
            else yield* evalExpr(s.init.e);
            yield* unit(s.line, 'init', `for 的初始化：${describe(before, s.isrc)}`, undefined, hits);
          }
          for (;;) {
            if (s.cond) {
              const hits = arm(s.line);
              const c = yield* evalExpr(s.cond);
              yield* unit(s.line, 'cond', `循环条件 ${s.csrc} ${c.v ? '成立，进循环体' : '不成立，循环结束'}${valuesIn(s.cond)}。`, { cond: !!c.v }, hits);
              if (!c.v) return;
            }
            try { yield* stmt(s.body); } catch (x) { if (x?.kind === 'break') return; if (x?.kind !== 'continue') throw x; }
            if (s.update) {
              const hits = arm(s.line);
              const before = diffBase();
              yield* evalExpr(s.update);
              yield* unit(s.line, 'update', `for 的第三部分：${describe(before, s.usrc)}`, undefined, hits);
            }
          }
        } finally { f.scopes.pop(); }
      }
      case 'break': yield* unit(s.line, 'jump', 'break：跳出循环。', undefined, arm(s.line)); throw { kind: 'break' };
      case 'continue': yield* unit(s.line, 'jump', 'continue：直接进下一轮循环。', undefined, arm(s.line)); throw { kind: 'continue' };
      case 'return': {
        const hits = arm(s.line);
        const v = s.e ? yield* evalExpr(s.e) : undefined;
        const fn = f.fn;
        const rv = v !== undefined && fn.ret !== 'void' ? convert(fn.ret, v, s.line) : undefined;
        yield* unit(s.line, 'return', rv !== undefined ? `${fn.name} 返回 ${show(rv)}${s.esrc && s.esrc !== show(rv) ? `（${s.esrc}）` : ''}。` : `${fn.name} 结束，返回。`, undefined, hits);
        throw { kind: 'return', value: rv };
      }
    }
    throw new CError('看不懂的语句', s.line);
  }

  function* declare(d, type, scope, line) {
    if (d.ref) throw new CError('局部的引用变量第一期不支持', line);
    if (scope.has(d.name)) throw new CError(`${d.name} 在这里已经定义过了`, line);
    if (d.dims.length) {
      const dims = [];
      for (const [k, de] of d.dims.entries()) {
        if (de === null) {
          if (k > 0 || !d.init) throw new CError(`数组 ${d.name} 要写大小`, line);
          dims.push(d.init.items.length);
          continue;
        }
        const v = yield* evalExpr(de);
        if (!(v.v > 0) || v.t === 'double') throw new CError(`数组 ${d.name} 的大小要是正整数`, line);
        dims.push(v.v);
      }
      const a = mkArray(d.name, type, dims, scope === globals ? convert(type, num('int', 0)) : undefined);
      if (d.init) {
        if (d.init.t !== 'init') throw new CError(`数组 ${d.name} 要用 {…} 初始化`, line);
        // 写了初始化：没写到的元素是 0（C 的规定）
        a.data.fill(convert(type, num('int', 0)));
        const flat = [];
        const walk = (it, depth) => { for (const x of it.items) { if (x.t === 'init') { const start = flat.length; walk(x, depth + 1); const row = dims.slice(depth + 1).reduce((p, q) => p * q, 1); while (flat.length < start + row) flat.push(null); } else flat.push(x); } };
        walk(d.init, 0);
        if (flat.length > a.data.length) throw new CError(`数组 ${d.name} 只有 ${a.data.length} 个元素，初始化写多了`, line);
        for (const [k, x] of flat.entries()) if (x) a.data[k] = convert(type, yield* evalExpr(x), line);
      }
      scope.set(d.name, { arr: a, type });
      return;
    }
    let val = scope === globals ? convert(type, num('int', 0)) : undefined;
    if (d.init) {
      if (d.init.t === 'init') throw new CError(`${d.name} 不是数组，不能用 {…} 初始化`, line);
      const v = yield* evalExpr(d.init);
      val = convert(type, v, line);
    }
    scope.set(d.name, { type, val });
  }

  // —— 一步的说明：哪些变量、数组元素变了 ——
  function diffBase() {
    const vals = new Map();
    const f = stack[stack.length - 1];
    const add = (name, cell) => { if (!cell.arr && !cell.ref) vals.set(name, show(cell.val)); };
    for (const [n, c] of globals) add(n, c);
    if (f) for (const sc of f.scopes) for (const [n, c] of sc) add(n, c);
    return { vals, arrs: arrays.map((a) => a.data.map(show)) };
  }
  function changes(before) {
    const out2 = [];
    const f = stack[stack.length - 1];
    const seen = new Set();
    const look = (name, cell) => {
      if (seen.has(name)) return;
      seen.add(name);
      if (cell.arr || cell.ref) return;
      const now = show(cell.val), old = before.vals.get(name);
      if (old === undefined) out2.push(`${name} = ${now}`);
      else if (old !== now) out2.push(`${name}：${old} → ${now}`);
    };
    if (f) for (let i = f.scopes.length - 1; i >= 0; i--) for (const [n, c] of f.scopes[i]) look(n, c);
    for (const [n, c] of globals) look(n, c);
    arrays.forEach((a, k) => {
      const old = before.arrs[k] || [];
      a.data.forEach((x, i) => {
        const now = show(x);
        if (old[i] !== undefined && old[i] !== now) out2.push(`${a.name}${idxText(a, i)}：${old[i]} → ${now}`);
      });
    });
    return out2;
  }
  function describe(before, src, outBefore) {
    const ch = changes(before);
    const printed = outBefore !== undefined && out.length > outBefore.length ? out.slice(outBefore.length) : '';
    const bits = [];
    if (ch.length) bits.push(ch.join('，'));
    if (printed) bits.push(`输出「${printed.replace(/\n/g, '⏎')}」`);
    return `${src}${bits.length ? `：${bits.join('；')}` : ''}。`;
  }
  // 条件里用到的变量的值：（i = 3，n = 8）
  function valuesIn(expr) {
    const names = [];
    const walk = (x) => {
      if (!x) return;
      if (x.t === 'var' && !names.includes(x.name)) names.push(x.name);
      if (x.t === 'index') { const s2 = indexText(x); if (s2 && !names.includes(s2)) names.push(s2); walk(x.i); return; }
      for (const k of ['a', 'b', 'c', 'i', 'value', 'target']) if (x[k] && typeof x[k] === 'object') walk(x[k]);
      if (x.args) x.args.forEach(walk);
    };
    walk(expr);
    const parts = [];
    for (const n of names) {
      try {
        if (n.includes('[')) {
          const v = scopeEval(parseIndexExpr(n, expr));
          parts.push(`${n.replace(/\[(.+?)\]/g, (m) => m)} = ${show(v)}`);
        } else {
          const cell = scopeLookup(n);
          if (!cell || cell.arr) continue;
          parts.push(`${n} = ${show(cell.ref ? refGet(cell.ref) : cell.val)}`);
        }
      } catch { /* 越界、没赋值：不写 */ }
    }
    return parts.length ? `（${parts.slice(0, 5).join('，')}）` : '';
  }
  // A[j] 这种：写成「A[3]」（算出下标）
  function indexText(x) {
    try {
      const g = arrayPart(x);
      let r = g.next();
      if (!r.done) return '';
      const { a, idx, dims } = r.value;
      if (dims.length) return '';
      return `${a.name}${idx.map((k) => `[${k}]`).join('')}`;
    } catch { return ''; }
  }
  function parseIndexExpr(text, root) {
    // 找到语法树里对应的 index 节点（valuesIn 按算出的下标找回去）
    let found = null;
    const walk = (x) => { if (!x || found) return; if (x.t === 'index' && indexText(x) === text) { found = x; return; } for (const k of ['a', 'b', 'c', 'i', 'value', 'target']) if (x[k] && typeof x[k] === 'object') walk(x[k]); };
    walk(root);
    return found;
  }

  // —— 入口 ——
  const runner = (function* main() {
    const gscope = globals;
    // 全局变量：代码里定义的，加上 let 给的（数组、数）
    stack.push({ fn: { name: '全局', ret: 'void' }, scopes: [gscope], argText: '' });
    for (const g of program.globals) for (const d of g.decls) yield* declare(d, g.type, gscope, g.line);
    for (const [name, v] of Object.entries(vars)) {
      if (Array.isArray(v)) {
        const two = Array.isArray(v[0]);
        const dims = two ? [v.length, v[0].length] : [v.length];
        const type = v.flat().some((x) => typeof x === 'string') ? 'char' : v.flat().some((x) => !Number.isInteger(x)) ? 'double' : 'int';
        const a = mkArray(name, type, dims, undefined);
        v.flat().forEach((x, k) => { a.data[k] = typeof x === 'string' ? num('char', x.charCodeAt(0)) : num(type, x); });
        gscope.set(name, { arr: a, type });
      } else if (typeof v === 'string') gscope.set(name, { type: 'char', val: num('char', v.charCodeAt(0)) });
      else gscope.set(name, { type: Number.isInteger(v) ? 'int' : 'double', val: num(Number.isInteger(v) ? 'int' : 'double', v) });
    }
    stack.pop();
    snapshot(0, 'start', start ? `开始：调用 ${start.src}。` : '开始：从 main 进入。');
    const entry = start ? start.e : { t: 'call', name: 'main', args: [], line: program.funcs.main?.line || 1 };
    if (!start && !program.funcs.main) throw new CError('代码里没有 main：写 call:（从哪个函数开始，如 call: InsertSort(A, 8)）');
    const r = yield* evalExpr(entry);
    snapshot(0, 'end', `结束${start && r && !r.arr && program.funcs[start.e.name]?.ret !== 'void' ? `：${start.e.name} 返回 ${show(r)}` : ''}。${out ? `\n输出：${out}` : ''}`);
  })();
  try {
    for (let r = runner.next(); !r.done; r = runner.next()) { /* 每一步都在 snapshot 里记好了 */ }
  } catch (x) {
    if (x instanceof CError) error = x;
    else if (x && x.kind) error = new CError(x.kind === 'return' ? 'return 用在了函数外面' : `${x.kind} 用在了循环外面`);
    else throw x;
  }
  return { steps, arrays: arrays.map((a) => ({ id: a.id, name: a.name, dims: a.dims })), error, out };
}

function idxText(a, i) {
  if (a.dims.length === 1) return `[${i}]`;
  const out = [];
  let r = i;
  for (let k = a.dims.length - 1; k >= 0; k--) { out.unshift(r % a.dims[k]); r = Math.floor(r / a.dims[k]); }
  return out.map((x) => `[${x}]`).join('');
}

/** 一段表达式（先猜、call 用）：用同一个解析器 */
export function parseExpression(src) {
  // 借 parseProgram 的表达式解析：包成一个函数体
  const prog = parseProgram(`int __e__(){ return ${src}; }`);
  return prog.funcs.__e__.body.body[0].e;
}
