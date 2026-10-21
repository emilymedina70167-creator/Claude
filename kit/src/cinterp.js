// C 子集的解释器（trace 组件用）：把一段王道风格的 C 代码真的跑一遍，每执行一行记一步（行号、各层的变量、数组、堆上的结点、输出）。
// 支持：int / long / short / unsigned / char / double / float / bool（typedef 成别的名字也行，ElemType 默认是 int）、
//   #define 常量、全局 / 局部变量、一维二维数组（可以 {…} 初始化）、函数和递归、引用参数 int &a（王道的 C++ 写法）、
//   if / else、for、while、do-while、break、continue、return，运算符（算术、比较、逻辑、位运算、自增自减、复合赋值、?:），
//   printf / putchar / puts，内置 swap(a, b)（代码里没写 swap 时）、abs、max、min、visit(p)（没写时输出结点的 data）。
// 第二期：结构体（typedef struct LNode { ElemType data; struct LNode *next; } LNode, *LinkList; 这类王道写法，
//   结构体里的数组 SqList、结构体数组、typedef 数组类型 AdjList）、. 和 ->、指针（*p、&x、NULL、== / !=、!p）、
//   指针参数、返回指针、LinkList &L（指针的引用）、malloc(sizeof(LNode))（也认 (LNode *)malloc(…)、malloc(sizeof(int) * n)）、free(p)。
//   出错停在那一行说清楚：空指针、野指针（没赋值的指针）、用了已经 free 的结点、free 两次；
//   没有指针指着、又没 free 的结点在那一步提醒「内存泄漏」（不停，最后一步再总结一次）。
// 不支持：指针运算（p + 1、p++）、指针的指针、union / enum、switch、goto、new / delete……遇到了报「第几行：不支持……」。
// 纯函数，不碰 DOM（tests/cinterp.test.js）。
export const MAX_STEPS = 10000;
const MAX_DEPTH = 200;
const MAX_HEAP = 200; // malloc 的次数上限：链表、树的题用不了这么多，超了多半是循环没停

export class CError extends Error {
  constructor(msg, line) {
    super(line ? `第 ${line} 行：${msg}` : msg);
    this.line = line;
  }
}

// —— 类型 ——
// 'int' | 'double' | 'char' | 'bool' | 'void'，指针 { ptr: 类型 }，结构体 { st: 结构体的标签 }；
// typedef 出来的数组类型（AdjList）是 { arr: 元素类型, dims: [表达式] }，只在别名里出现，定义变量时拆成元素类型 + 维数
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const isPtrT = (t) => !!t && typeof t === 'object' && 'ptr' in t;
export const isStT = (t) => !!t && typeof t === 'object' && 'st' in t;

/** 类型写成文字：int、LNode *、SqList */
export function typeText(t, structs = {}) {
  if (isPtrT(t)) return `${typeText(t.ptr, structs)} *`;
  if (isStT(t)) return structs[t.st]?.name || t.st;
  return String(t);
}

/** 结点编号写成 ①②③（50 以后写 #51） */
export function circ(n) {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCharCode(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCharCode(0x32b1 + n - 36);
  return `#${n}`;
}

/**
 * 结构体的样子（画法和 let 建表都要用）：哪个成员是 data、next、prior，是不是二叉链表（lchild / rchild）。
 * sd：parseProgram 的 structs[标签]
 */
export function structShape(sd) {
  const fields = sd?.fields || [];
  const selfPtr = fields.filter((f) => !f.dims.length && isPtrT(f.type) && isStT(f.type.ptr) && f.type.ptr.st === sd.tag);
  const find = (re) => selfPtr.find((f) => re.test(f.name))?.name || null;
  const left = find(/^(l|left|lchild|lc|lson|lnode)$/i);
  const right = find(/^(r|right|rchild|rc|rson|rnode)$/i);
  const tree = !!(left && right);
  const prior = tree ? null : find(/^(prior|pre|prev|before|last)$/i);
  const next = tree ? null : find(/^(next|link|nextarc|succ|after)$/i) || selfPtr.find((f) => f.name !== prior)?.name || null;
  const key = fields.find((f) => !f.dims.length && !isPtrT(f.type) && !isStT(f.type))?.name || null;
  return { tree, left: tree ? left : null, right: tree ? right : null, next, prior, key };
}

/** 给画面用的结构体说明：{ 标签: { name, fields: [{ name, ptr（指向的结构体标签，'' 是指向别的）, arr }], shape } } */
export function structMeta(program) {
  const out = {};
  for (const [tag, sd] of Object.entries(program?.structs || {})) {
    if (!sd.fields) continue;
    out[tag] = {
      name: sd.name || '结构体',
      fields: sd.fields.map((f) => ({ name: f.name, ptr: isPtrT(f.type) ? (isStT(f.type.ptr) ? f.type.ptr.st : '') : null, arr: f.dims.length > 0 })),
      shape: structShape(sd),
    };
  }
  return out;
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
      if (hasOwn(defines, w)) {
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
const LVALUES = ['var', 'index', 'member', 'deref'];

export function parseProgram(src) {
  const { text, defines } = preprocess(src);
  const toks = tokenize(text, defines);
  const aliases = { ElemType: 'int', Status: 'int', KeyType: 'int', InfoType: 'int', VertexType: 'char', DataType: 'int', BOOL: 'bool' };
  const structs = {};
  let anon = 0;
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const next = () => toks[p++];
  const is = (v, o = 0) => { const t = peek(o); return (t.k === 'op' || t.k === 'kw') && t.v === v; };
  const eat = (v) => { if (is(v)) { p++; return true; } return false; };
  const expect = (v) => { if (!eat(v)) { const t = peek(); throw new CError(`这里应该是「${v}」${t.k === 'eof' ? '（代码不完整）' : `，写的是「${t.v}」`}`, t.line); } };
  const srcOf = (a, b) => text.slice(a, b).replace(/\s+/g, ' ').trim();
  const isType = (o = 0) => {
    const t = peek(o);
    if (t.k === 'kw' && (BASE.has(t.v) || ['const', 'static', 'struct'].includes(t.v))) return true;
    if (t.k === 'kw' && (t.v === 'union' || t.v === 'enum')) throw new CError(`不支持 ${t.v}（结构体用 struct）`, t.line);
    return t.k === 'id' && hasOwn(aliases, t.v);
  };
  // 类型：几个基本类型的关键字（unsigned long int），或者一个名字（别名、struct 标签）。后面的 * 归声明的那个名字
  const readType = () => {
    const words = [];
    let named = null;
    for (;;) {
      const t = peek();
      if (t.k === 'kw' && (t.v === 'const' || t.v === 'static')) { next(); continue; }
      if (named) break;
      if (t.k === 'kw' && BASE.has(t.v)) { words.push(next().v); continue; }
      if (words.length) break;
      if (t.k === 'kw' && t.v === 'struct') { next(); named = readStruct(t); continue; }
      if (t.k === 'kw' && (t.v === 'union' || t.v === 'enum')) throw new CError(`不支持 ${t.v}（结构体用 struct）`, t.line);
      if (t.k === 'id' && hasOwn(aliases, t.v)) { next(); named = aliases[t.v]; continue; }
      break;
    }
    if (named) return named;
    if (!words.length) { const t = peek(); throw new CError(`这里应该是类型，写的是「${t.v}」`, t.line); }
    if (words.includes('double') || words.includes('float')) return 'double';
    if (words.includes('char')) return 'char';
    if (words.includes('bool')) return 'bool';
    if (words.includes('void')) return 'void';
    return 'int';
  };
  // struct 标签 { 成员… }，或者只有 struct 标签（前面定义过、或者后面再定义）
  const readStruct = (kw) => {
    let tag = peek().k === 'id' ? next().v : null;
    if (!is('{')) {
      if (!tag) throw new CError('struct 后面要写名字或者 { 成员 }', kw.line);
      structs[tag] ||= { tag, name: tag, fields: null, line: kw.line };
      return { st: tag };
    }
    if (!tag) tag = `#${++anon}`; // 没名字的 typedef struct { … } SqList;：名字由 typedef 给
    const sd = (structs[tag] ||= { tag, name: tag.startsWith('#') ? '' : tag, fields: null, line: kw.line });
    if (sd.fields) throw new CError(`结构体 ${tag} 定义了两次`, kw.line);
    next();
    const fields = [];
    while (!is('}')) {
      if (peek().k === 'eof') throw new CError('结构体少了右花括号 }', kw.line);
      const ft = readType();
      do {
        const d = readDeclarator(ft);
        if (d.ref) throw new CError('结构体的成员不能是引用 &', d.line);
        if (isStT(d.type) && d.type.st === tag) throw new CError(`结构体不能包含它自己（要写成指针：struct ${tag} *${d.name}）`, d.line);
        if (fields.some((f) => f.name === d.name)) throw new CError(`成员 ${d.name} 写了两次`, d.line);
        if (d.dims.some((x) => x === null)) throw new CError(`成员 ${d.name} 是数组，要写大小`, d.line);
        fields.push({ name: d.name, type: d.type, dims: d.dims, line: d.line });
      } while (eat(','));
      expect(';');
    }
    expect('}');
    if (!fields.length) throw new CError('结构体里一个成员都没有', kw.line);
    sd.fields = fields;
    return { st: tag };
  };
  // 一个声明的名字：前面的 *（指针）、&（引用）、名字、后面的 [大小]（[] 是不写大小）
  const readDeclarator = (base, { optional = false } = {}) => {
    let type = base;
    let dims0 = [];
    if (base && typeof base === 'object' && 'arr' in base) { type = base.arr; dims0 = base.dims; }
    let stars = 0;
    while (eat('*')) stars++;
    if (stars > 1) throw new CError('不支持指针的指针（王道的写法是引用：LinkList &L）', peek().line);
    if (stars && dims0.length) throw new CError('不支持指向数组类型的指针', peek().line);
    if (stars) type = { ptr: type };
    const ref = eat('&');
    if (optional && (is(',') || is(')'))) return { name: null, type, dims: dims0, ref, line: peek().line };
    const id = next();
    if (id.k !== 'id') throw new CError(`这里应该是名字，写的是「${id.v}」${id.k === 'kw' ? '（这是关键字）' : ''}`, id.line);
    const dims = [...dims0];
    while (eat('[')) {
      if (is(']')) { dims.push(null); next(); continue; }
      dims.push(parseExpr());
      expect(']');
    }
    return { name: id.v, type, dims, ref, line: id.line };
  };
  // 类型转换、sizeof 里的类型：(LNode *)、(LinkList)
  const readCastType = () => {
    let t = readType();
    if (t && typeof t === 'object' && 'arr' in t) throw new CError('不支持转换成数组类型', peek().line);
    let stars = 0;
    while (eat('*')) stars++;
    if (stars > 1) throw new CError('不支持指针的指针', peek().line);
    if (stars) t = { ptr: t };
    return t;
  };

  const program = { funcs: {}, globals: [], structs, line: 1 };
  while (peek().k !== 'eof') {
    if (eat('typedef')) {
      // typedef 类型 新名字, *指针名, 数组名[N];（王道：typedef struct LNode {…} LNode, *LinkList;）
      const first = peek();
      const base = readType();
      let named = false;
      do {
        const d = readDeclarator(base);
        if (d.ref) throw new CError('typedef 里不能写 &', d.line);
        if (d.dims.some((x) => x === null)) throw new CError('typedef 的数组类型要写大小', d.line);
        const t = d.dims.length ? { arr: d.type, dims: d.dims } : d.type;
        aliases[d.name] = t;
        // 结构体在画面上叫 typedef 的名字（LNode、SqList）
        if (!named && isStT(t) && structs[t.st]) { structs[t.st].name = d.name; named = true; }
      } while (eat(','));
      if (!is(';')) throw new CError(`typedef 的写法：typedef int ElemType;（这里写的是「${peek().v}」）`, first.line);
      expect(';');
      continue;
    }
    if (!isType()) { const t = peek(); throw new CError(`这里应该是函数或者全局变量的定义，写的是「${t.v}」`, t.line); }
    const tStart = peek();
    const base = readType();
    if (eat(';')) continue; // 只定义了结构体：struct LNode { … };
    const save = p;
    let ret = base;
    let stars = 0;
    while (eat('*')) stars++;
    const name = next();
    if (name.k !== 'id') throw new CError(`类型后面要写名字，写的是「${name.v}」`, name.line);
    if (is('(')) {
      if (stars > 1) throw new CError('不支持返回指针的指针', name.line);
      if (stars) ret = { ptr: ret };
      program.funcs[name.v] = parseFunc(ret, name);
      continue;
    }
    p = save;
    program.globals.push(parseDeclRest(base, tStart.line));
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
          const d = readDeclarator(type, { optional: true });
          params.push({ name: d.name, type: d.type, ref: d.ref, array: d.dims.length > 0 });
        } while (eat(','));
      }
    }
    expect(')');
    if (eat(';')) return { name: name.v, ret, params, body: null, line: name.line }; // 只是声明
    if (params.some((x) => !x.name)) throw new CError(`${name.v} 的参数要有名字`, name.line);
    const body = parseBlock();
    return { name: name.v, ret, params, body, line: name.line, endLine: toks[p - 1].line };
  }
  function parseDeclRest(base, line) {
    const decls = [];
    do {
      const d = readDeclarator(base);
      let init = null;
      if (eat('=')) init = is('{') ? parseInitList() : parseAssign();
      decls.push({ name: d.name, type: d.type, dims: d.dims, init, ref: d.ref });
    } while (eat(','));
    expect(';');
    return { t: 'decl', type: decls[0].type, decls, line, src: srcOf(toks.find((x) => x.line === line)?.pos ?? 0, toks[p - 1].end) };
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
    if (t.k === 'id' && t.v === 'delete' && peek(1).k === 'id') throw new CError('不支持 delete：释放结点写 free(p)', t.line);
    if (t.k === 'kw') {
      if (['switch', 'goto', 'case', 'default'].includes(t.v)) throw new CError(`还不支持 ${t.v}`, t.line);
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
      if (!LVALUES.includes(lhs.t)) throw new CError(`「${t.v}」左边要是变量、数组元素或者结构体成员`, t.line);
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
    if (t.k === 'op' && (t.v === '++' || t.v === '--')) { next(); const a = parseUnary(); if (!LVALUES.includes(a.t)) throw new CError(`${t.v} 只能用在变量上`, t.line); return { t: 'incdec', op: t.v, pre: true, a, line: t.line }; }
    if (t.k === 'op' && t.v === '*') { next(); return { t: 'deref', a: parseUnary(), line: t.line }; }
    if (t.k === 'op' && t.v === '&') { next(); return { t: 'addr', a: parseUnary(), line: t.line }; }
    if (t.k === 'kw' && t.v === 'sizeof') {
      next();
      if (is('(') && isType(1)) { next(); const ty = readCastType(); expect(')'); return { t: 'sizeof', type: ty, line: t.line }; }
      return { t: 'sizeof', e: parseUnary(), line: t.line };
    }
    // 强制类型转换 (int)x、(LNode *)malloc(…)
    if (is('(') && isType(1)) { next(); const ty = readCastType(); expect(')'); return { t: 'cast', to: ty, a: parseUnary(), line: t.line }; }
    return parsePostfix();
  }
  function parsePostfix() {
    let a = parsePrimary();
    for (;;) {
      const t = peek();
      if (is('[')) { next(); const i = parseExpr(); expect(']'); a = { t: 'index', a, i, line: t.line }; continue; }
      if (is('++') || is('--')) { next(); if (!LVALUES.includes(a.t)) throw new CError(`${t.v} 只能用在变量上`, t.line); a = { t: 'incdec', op: t.v, pre: false, a, line: t.line }; continue; }
      if (is('.') || is('->')) {
        next();
        const f = next();
        if (f.k !== 'id') throw new CError(`${t.v} 后面要写成员的名字`, f.line);
        a = { t: 'member', a, f: f.v, arrow: t.v === '->', line: t.line };
        continue;
      }
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
      if (t.v === 'NULL' || t.v === 'nullptr') return { t: 'null', line: t.line };
      if (t.v === 'new' && peek().k === 'id') throw new CError('不支持 new：写成 (LNode *)malloc(sizeof(LNode))', t.line);
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

/** 表达式写回文字（报错、说明里用）：p->next->data、L.data[i]、*p */
export function exprText(e) {
  if (!e) return '';
  switch (e.t) {
    case 'var': return e.name;
    case 'num': return e.char ? `'${String.fromCharCode(e.v)}'` : String(e.v);
    case 'null': return 'NULL';
    case 'member': return `${e.a.t === 'deref' ? `(${exprText(e.a)})` : exprText(e.a)}${e.arrow ? '->' : '.'}${e.f}`;
    case 'index': return `${exprText(e.a)}[${exprText(e.i)}]`;
    case 'deref': return `*${exprText(e.a)}`;
    case 'addr': return `&${exprText(e.a)}`;
    case 'call': return `${e.name}(${e.args.map(exprText).join(', ')})`;
    case 'bin': return `${exprText(e.a)} ${e.op} ${exprText(e.b)}`;
    case 'unary': return `${e.op}${exprText(e.a)}`;
    case 'cast': return exprText(e.a);
    default: return '…';
  }
}

// —— 运行 ——

// 值：{ t: 'int' | 'char' | 'double' | 'bool', v: 数 }；
//   指针 { t: 'ptr', v: 0（NULL）/ 1, to: 指向的类型, obj（指向结构体）| lv（&变量）| arr + off（数组、malloc 来的一串）}；
//   结构体 { t: 'struct', obj }，obj = { oid, tag, fields: Map(成员 → 格子), heap（malloc 来的）, hid（堆上的编号）, freed, owner }；
//   数组：{ arr: true, id, name, type, dims, data: [..] }
const num = (t, v) => ({ t, v });
const NULLP = Object.freeze({ t: 'ptr', v: 0, to: 'void' });
const arith = (a, b) => (a.t === 'double' || b.t === 'double' ? 'double' : 'int');

/** 显示一个值：char 写成 'a'，bool 写成 true / false，double 去掉多余的 0，指针写成指向的结点 ③ 或 NULL */
export function show(val) {
  if (val === undefined) return '?';
  if (val.arr === true) return `${val.name}[…]`;
  if (val.t === 'ptr') {
    if (!val.v) return 'NULL';
    if (val.obj) return val.obj.heap ? circ(val.obj.hid) : `&${val.obj.owner}`;
    if (val.lv) return `&${val.lvName}`;
    if (val.blk) return val.blk.heap ? circ(val.blk.hid) : `&${val.blk.name}[${val.off || 0}]`;
    return '?';
  }
  if (val.t === 'struct') return '{…}';
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
    if (a.t === 'ptr' || a.t === 'struct') throw new CError(`printf 的 %${conv} 给的是${a.t === 'ptr' ? '指针' : '结构体'}（要输出结点里的数，写 p->data）`, line);
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
 *   vars 里还可以是 { list: [值…], head: true/false }（单链表，带不带头结点）、{ tree: { root, nodes } }（二叉链表，tree.js 的 parseTree）
 *   watchers：[{ line, cond(scopeEval) → bool, take(scopeEval) → 值 }]：走到那一行之前判断 cond，执行完取值（先猜用）
 * 返回 { steps: [{ line, kind, msg, frames, globals, out, heap? }], arrays（id → 名字）, error?, out, leaks（泄漏的结点编号） }
 */
export function runProgram(program, { entry: start = null, vars = {}, maxSteps = MAX_STEPS, watchers = [] } = {}) {
  const structs = program.structs || {};
  const globals = new Map();
  const arrays = [];
  const heap = []; // malloc 来的结点和数组，按先后编号（从 1 数）；free 了的也留着，标 freed
  let arrSeq = 0, objSeq = 0;
  let out = '';
  const steps = [];
  const stack = []; // { fn, scopes: [Map], args }
  const done = new Set();
  const temps = []; // 正在传的值（实参、返回值）：还没落到变量里，判断泄漏时也算有人指着
  let notes = []; // 这一步要额外说的：新建、释放了哪个结点
  let error = null;
  const tname = (t) => typeText(t, structs);

  const mkArray = (name, type, dims, fill) => {
    const size = dims.reduce((a, b) => a * b, 1);
    if (size > 400) throw new CError(`数组 ${name} 太大了（${size} 个元素），这里最多 400 个`);
    const a = { arr: true, id: ++arrSeq, name, type, dims, data: Array.from({ length: size }, (_, k) => (typeof fill === 'function' ? fill(k) : fill)) };
    arrays.push(a);
    return a;
  };
  const scopeLookup = (name) => {
    const f = stack[stack.length - 1];
    if (f) for (let i = f.scopes.length - 1; i >= 0; i--) if (f.scopes[i].has(name)) return f.scopes[i].get(name);
    return globals.get(name);
  };
  const unsetErr = (name, type, line) => new CError(isPtrT(type) ? `${name} 还没赋值就用了（野指针：还没让它指向任何结点）` : `${name} 还没赋值就用了`, line);

  // —— 结构体 ——
  // 一个结构体对象：每个成员一个格子（和变量的格子一样：{ type, val } 或 { type, arr }）
  function mkObj(tag, { zero = false, owner = '', onHeap = false, line } = {}) {
    const sd = structs[tag];
    if (!sd?.fields) throw new CError(`结构体 ${tag} 只写了名字，没有定义成员`, line);
    const obj = { oid: ++objSeq, tag, fields: new Map(), heap: onHeap, owner, freed: false };
    if (onHeap) {
      if (heap.length >= MAX_HEAP) throw new CError(`malloc 了 ${MAX_HEAP} 次了：可能是循环没停`, line);
      heap.push(obj);
      obj.hid = heap.length;
    }
    const prefix = onHeap ? circ(obj.hid) : owner;
    for (const f of sd.fields) obj.fields.set(f.name, mkCell(f.type, f.dims, zero, `${prefix}.${f.name}`, line));
    return obj;
  }
  function mkCell(type, dims, zero, name, line) {
    if (dims.length) {
      const ds = dims.map((de) => {
        if (de === null) throw new CError(`数组 ${name} 要写大小`, line);
        const v = constEval(de, line);
        if (!(v?.v > 0) || v.t === 'double') throw new CError(`数组 ${name} 的大小要是正整数`, line);
        return v.v;
      });
      return { arr: mkArray(name, type, ds, (k) => initVal(type, zero, `${name}[${k}]`, line)), type };
    }
    return { type, val: initVal(type, zero, name, line) };
  }
  // 新定义的东西的初值：全局的是 0 / NULL（C 的规定），局部的没有值；结构体每个成员照这个来
  function initVal(type, zero, owner, line) {
    if (isStT(type)) return { t: 'struct', obj: mkObj(type.st, { zero, owner, line }) };
    return zero ? convert(type, num('int', 0), line) : undefined;
  }
  function copyObj(src, owner) {
    const obj = { oid: ++objSeq, tag: src.tag, fields: new Map(), heap: false, owner, freed: false };
    for (const [f, c] of src.fields) {
      if (c.arr) obj.fields.set(f, { type: c.type, arr: mkArray(`${owner}.${f}`, c.arr.type, c.arr.dims, (k) => copyVal(c.arr.data[k], `${owner}.${f}[${k}]`)) });
      else obj.fields.set(f, { type: c.type, val: copyVal(c.val, `${owner}.${f}`) });
    }
    return obj;
  }
  const copyVal = (v, owner) => (v?.t === 'struct' ? { t: 'struct', obj: copyObj(v.obj, owner) } : v);
  // *p = *q、L1 = L2：把成员一个个抄过去（指着这个对象的指针还指着它）
  function assignInto(dst, src) {
    for (const [f, c] of dst.fields) {
      const s = src.fields.get(f);
      if (c.arr) s.arr.data.forEach((x, k) => { c.arr.data[k] = copyVal(x, `${c.arr.name}[${k}]`); });
      else c.val = copyVal(s.val, `${dst.owner}.${f}`);
    }
  }

  // 类型转换（赋值、传参、返回都经过这里）：指针只能接指针、NULL / 0、数组；结构体整个拷贝一份
  function convert(type, val, line, owner) {
    if (val === undefined || val === null) return undefined;
    if (isPtrT(type)) {
      if (val.t === 'ptr') {
        const want = type.ptr, got = val.to;
        const bad = got !== 'void' && want !== 'void' && got !== undefined && (isStT(want) || isStT(got)) && !(isStT(want) && isStT(got) && want.st === got.st);
        if (bad) throw new CError(`类型对不上：${tname(type)} 不能指向 ${tname(got)}`, line);
        return val.to === want ? val : { ...val, to: want };
      }
      if (val.arr === true) {
        if (val.sub) throw new CError('不支持把二维数组的一行当成指针', line);
        return { t: 'ptr', v: 1, blk: val, off: 0, to: type.ptr };
      }
      if (['int', 'bool', 'char'].includes(val.t) && val.v === 0) return { ...NULLP, to: type.ptr };
      throw new CError(`${tname(type)} 是指针，不能把 ${show(val)} 赋给它（指针只能是 NULL、malloc 来的、或者 &变量）`, line);
    }
    if (isStT(type)) {
      if (val.t !== 'struct') throw new CError(`这里要的是结构体 ${tname(type)}，给的是 ${show(val)}`, line);
      if (val.obj.tag !== type.st) throw new CError(`类型对不上：要 ${tname(type)}，给的是 ${tname({ st: val.obj.tag })}`, line);
      return { t: 'struct', obj: copyObj(val.obj, owner || val.obj.owner) };
    }
    if (val.t === 'ptr') throw new CError('指针不能当成数用（判断空不空写 p == NULL 或者 !p）', line);
    if (val.arr) throw new CError('数组不能直接赋给一个变量', line);
    if (val.t === 'struct') throw new CError('结构体不能当成数用（要写成员，比如 L.length）', line);
    let v = val.v;
    if (type === 'double') return num('double', v);
    if (type === 'bool') return num('bool', v ? 1 : 0);
    v = Math.trunc(v);
    if (type === 'char') return num('char', ((v % 256) + 256) % 256);
    return num('int', v);
  }
  // sizeof：按 32 位算（int 4、指针 4、double 8），结构体把成员加起来
  function sizeOf(t, line) {
    if (isPtrT(t)) return 4;
    if (isStT(t)) {
      const sd = structs[t.st];
      if (!sd?.fields) throw new CError(`结构体 ${t.st} 没有定义成员`, line);
      return sd.fields.reduce((s, f) => s + sizeOf(f.type, line) * f.dims.reduce((x, d) => x * constEval(d, line).v, 1), 0);
    }
    return { char: 1, bool: 1, double: 8, void: 1 }[t] || 4;
  }
  function sizeOfVal(v, line) {
    if (v?.arr === true) return v.dims.reduce((x, y) => x * y, 1) * sizeOf(v.type, line);
    if (v?.t === 'ptr') return 4;
    if (v?.t === 'struct') return sizeOf({ st: v.obj.tag }, line);
    return { char: 1, bool: 1, double: 8 }[v?.t] || 4;
  }

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
    if (notes.length) {
      // 新建、释放的说明接在这一句后面；释放的那个还有谁指着，到这一步才知道
      const base = s.msg.replace(/。$/, '');
      s.msg = `${base}${base.includes('：') ? '；' : '：'}${notes.map((x) => (typeof x === 'function' ? x() : x)).join('；')}。`;
      notes = [];
    }
    if (heap.length) {
      const { seen, pointed } = reach();
      // main 结束时局部变量都没了：那时不算泄漏（程序结束，系统会收回）
      if (!(kind === 'end' && !start)) {
        const lost = heap.filter((o) => !o.freed && !o.leaked && !seen.has(o));
        lost.forEach((o) => { o.leaked = true; });
        if (lost.length) s.msg += ` ⚠ ${lost.map((o) => circ(o.hid)).join('')} 现在没有指针指着了，又没有 free：内存泄漏（这块空间再也找不回来了）。`;
      }
      if (kind === 'end') {
        const leaked = heap.filter((o) => o.leaked);
        if (leaked.length) s.msg += `\n⚠ 内存泄漏：${leaked.map((o) => circ(o.hid)).join('')} 没有 free，也没有指针指着。`;
      }
      s.heap = heap.filter((o) => !o.freed || o.freedAt === steps.length || pointed.has(o)).map(nodeView);
    }
    steps.push(s);
    return s;
  }
  function varView(name, cell) {
    if (cell.ref) {
      const target = cell.ref;
      if (target.arr) return { name, ref: true, type: tname(cell.type), arr: target.id };
      let v;
      try { v = refGet(target); } catch { v = undefined; }
      return { name, ref: true, type: tname(refType(target)), value: show(v), ...ptrInfo(v, refType(target)), ...structInfo(v) };
    }
    if (cell.arr) return { name, type: tname(cell.arr.type), arr: cell.arr.id, dims: cell.arr.dims, data: cell.arr.data.map(show), ...elemsInfo(cell.arr) };
    return { name, type: tname(cell.type), value: show(cell.val), ...ptrInfo(cell.val, cell.type), ...structInfo(cell.val) };
  }
  // 指针：to 是指向的堆结点编号（NULL 是 null），指向变量的写 target；没赋值的是 wild
  function ptrInfo(v, type) {
    if (v === undefined) return isPtrT(type) ? { ptr: true, wild: true } : {};
    if (v.t !== 'ptr') return {};
    if (!v.v) return { ptr: true, to: null };
    const o = v.obj || v.blk;
    if (o?.heap) return { ptr: true, to: o.hid, ...(o.freed ? { dangling: true } : {}) };
    return { ptr: true, target: show(v) };
  }
  const structInfo = (v) => (v?.t === 'struct' ? { struct: tname({ st: v.obj.tag }), tag: v.obj.tag, fields: fieldViews(v.obj) } : {});
  const elemsInfo = (a) => (isStT(a.type) ? { tag: a.type.st, elems: a.data.map((x) => (x?.t === 'struct' ? fieldViews(x.obj) : null)) } : {});
  const fieldViews = (obj) => [...obj.fields].map(([name, c]) => (c.arr
    ? { name, type: tname(c.type), arr: c.arr.id, dims: c.arr.dims, data: c.arr.data.map(show), ...elemsInfo(c.arr) }
    : { name, type: tname(c.type), value: show(c.val), ...ptrInfo(c.val, c.type), ...structInfo(c.val) }));
  function nodeView(o) {
    if (o.arr) return { id: o.hid, block: true, arr: o.id, type: tname(o.type), data: o.data.map(show), freed: o.freed, leaked: !!o.leaked };
    return { id: o.hid, tag: o.tag, fields: fieldViews(o), freed: o.freed, leaked: !!o.leaked };
  }

  // 从变量出发（各层的局部变量、全局变量、正在传的值）顺着指针能走到哪些对象：走不到的堆结点就是泄漏了。
  // free 了的结点不往下走（它里面的指针不能再用）
  function reach() {
    const seen = new Set(), pointed = new Set();
    const val = (v) => {
      if (!v || typeof v !== 'object') return;
      if (v.t === 'ptr') {
        const o = v.obj || v.blk;
        if (o) { pointed.add(o); if (!o.freed) (v.obj ? obj(o) : arr(o)); }
      } else if (v.t === 'struct') obj(v.obj);
      else if (v.arr === true) arr(v);
    };
    const obj = (o) => { if (seen.has(o)) return; seen.add(o); for (const c of o.fields.values()) cell(c); };
    const arr = (a) => { if (seen.has(a)) return; seen.add(a); a.data.forEach(val); };
    const cell = (c) => { if (c.arr) arr(c.arr); else if (!c.ref) val(c.val); };
    for (const c of globals.values()) cell(c);
    for (const f of stack) for (const sc of f.scopes) for (const c of sc.values()) cell(c);
    temps.forEach(val);
    return { seen, pointed };
  }
  // 当前这一层和全局里还指着 o 的指针变量
  function danglers(o) {
    const out2 = [];
    const f = stack[stack.length - 1];
    const look = (name, c) => {
      let v;
      try { v = c.ref ? (c.ref.arr ? undefined : refGet(c.ref)) : c.val; } catch { v = undefined; }
      if (v?.t === 'ptr' && (v.obj === o || v.blk === o) && !out2.includes(name)) out2.push(name);
    };
    if (f) for (const sc of f.scopes) for (const [n, c] of sc) look(n, c);
    for (const [n, c] of globals) look(n, c);
    return out2;
  }

  // —— 左值：变量、数组元素、结构体成员、*p ——
  // 引用：{ cell, name }（变量、成员的格子）、{ a, i, idx }（数组元素）、{ obj, name }（*p：整个结构体）
  function refGet(r) {
    if (r.obj) return { t: 'struct', obj: r.obj };
    if (r.cell) return r.cell.ref ? refGet(r.cell.ref) : r.cell.val;
    return r.a.data[r.i];
  }
  function refSet(r, v) {
    if (r.obj) return assignInto(r.obj, v.obj);
    if (r.cell) { if (r.cell.ref) return refSet(r.cell.ref, v); r.cell.val = v; return; }
    r.a.data[r.i] = v;
  }
  const refType = (r) => (r.obj ? { st: r.obj.tag } : r.cell ? (r.cell.ref ? refType(r.cell.ref) : r.cell.type) : r.a.type);
  const refName = (r) => (r.obj || r.cell ? r.name : `${r.a.name}${r.idx.map((x) => `[${x}]`).join('')}`);

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
    if (e.t === 'member') {
      const m = yield* member(e);
      if (m.cell.arr) throw new CError(`${m.name} 是数组，要写下标`, e.line);
      return { cell: m.cell, name: m.name };
    }
    if (e.t === 'deref') return yield* derefRef(e);
    throw new CError('这里要的是变量、数组元素或者结构体成员', e.line);
  }
  // 解引用之前查一遍：空指针、已经 free 的
  function checkDeref(p, what, use, line) {
    if (!p.v) throw new CError(`${what} 是 NULL（空指针），不能用 ${use}`, line);
    const o = p.obj || p.blk;
    if (o?.freed) throw new CError(`${what} 指向的${p.obj ? '结点' : '空间'}${circ(o.hid)}已经 free 了，不能再用 ${use}（悬空指针）`, line);
  }
  // p->f、s.f：找到成员的格子
  function* member(e) {
    const what = exprText(e.a);
    const use = `${what}${e.arrow ? '->' : '.'}${e.f}`;
    const base = yield* evalExpr(e.a);
    let obj;
    if (e.arrow) {
      if (base?.t === 'struct') throw new CError(`${what} 是结构体，不是指针：要写 ${what}.${e.f}`, e.line);
      if (base?.t !== 'ptr') throw new CError(`${what} 不是指针，不能写 ${use}`, e.line);
      checkDeref(base, what, use, e.line);
      if (!base.obj) throw new CError(`${what} 指向的不是结构体，没有成员 ${e.f}`, e.line);
      obj = base.obj;
    } else {
      if (base?.t === 'ptr') throw new CError(`${what} 是指针：要写 ${what}->${e.f}`, e.line);
      if (base?.t !== 'struct') throw new CError(`${what} 不是结构体，没有成员 ${e.f}`, e.line);
      obj = base.obj;
    }
    const cell = obj.fields.get(e.f);
    if (!cell) throw new CError(`${tname({ st: obj.tag })} 里没有成员 ${e.f}（有 ${[...obj.fields.keys()].join('、')}）`, e.line);
    return { cell, name: use, obj };
  }
  function* derefRef(e) {
    const what = exprText(e.a);
    const p = yield* evalExpr(e.a);
    if (p?.t !== 'ptr') throw new CError(`${what} 不是指针，不能写 *${what}`, e.line);
    checkDeref(p, what, `*${what}`, e.line);
    if (p.obj) return { obj: p.obj, name: `*${what}` };
    if (p.lv) return p.lv;
    return { a: p.blk, i: p.off || 0, idx: [p.off || 0] };
  }
  function* addrOf(e) {
    const x = e.a;
    if (x.t === 'deref') return yield* evalExpr(x.a); // &*p 就是 p
    if (x.t === 'var') {
      const cell = scopeLookup(x.name);
      if (!cell) throw new CError(`没有定义变量 ${x.name}`, e.line);
      const a = cell.arr || (cell.ref?.arr ? cell.ref : null);
      if (a) return { t: 'ptr', v: 1, blk: a, off: 0, to: a.type };
    }
    if (x.t === 'member') {
      const m = yield* member(x);
      if (m.cell.arr) return { t: 'ptr', v: 1, blk: m.cell.arr, off: 0, to: m.cell.arr.type };
    }
    const r = yield* lvalue(x);
    const cur = refGet(r);
    if (cur?.t === 'struct') return { t: 'ptr', v: 1, obj: cur.obj, to: { st: cur.obj.tag } };
    return { t: 'ptr', v: 1, lv: r, lvName: refName(r), to: refType(r) };
  }
  // 能写下标的东西：数组变量、数组参数、结构体里的数组、指向数组（malloc 来的一串）的指针
  function arrOf(v, name, line) {
    if (v?.t !== 'ptr') return null;
    if (!v.v) throw new CError(`${name} 是 NULL（空指针），不能写 ${name}[…]`, line);
    if (v.obj) throw new CError(`${name} 指向的是一个结点，不是数组，不能写下标`, line);
    if (v.lv) throw new CError(`${name} 指向的是一个变量，不是数组，不能写下标`, line);
    if (v.blk.freed) throw new CError(`${name} 指向的空间${circ(v.blk.hid)}已经 free 了，不能再用（悬空指针）`, line);
    return v.blk;
  }
  // A[i][j]：一层层算出偏移
  function* arrayPart(e) {
    if (e.t === 'var' || e.t === 'member') {
      let a;
      if (e.t === 'var') {
        const cell = scopeLookup(e.name);
        if (!cell) throw new CError(`没有定义数组 ${e.name}`, e.line);
        a = cell.ref?.arr ? cell.ref : cell.arr;
        if (!a) {
          const v = cell.ref ? refGet(cell.ref) : cell.val;
          if (v === undefined && isPtrT(cell.ref ? refType(cell.ref) : cell.type)) throw unsetErr(e.name, { ptr: 'int' }, e.line);
          a = arrOf(v, e.name, e.line);
        }
      } else {
        const m = yield* member(e);
        if (!m.cell.arr && m.cell.val === undefined && isPtrT(m.cell.type)) throw unsetErr(m.name, m.cell.type, e.line);
        a = m.cell.arr || arrOf(m.cell.val, m.name, e.line);
      }
      if (!a) throw new CError(`${exprText(e)} 不是数组，不能写下标`, e.line);
      return { a, off: 0, dims: a.dims.slice(), idx: [] };
    }
    if (e.t === 'index') {
      const base = yield* arrayPart(e.a);
      if (!base.dims.length) throw new CError(`${base.a.name} 的下标写多了`, e.line);
      const iv = yield* evalExpr(e.i);
      if (iv === undefined) throw new CError(`下标里的变量还没赋值`, e.line);
      if (iv.t === 'double') throw new CError('下标要是整数', e.line);
      if (iv.t === 'ptr' || iv.t === 'struct') throw new CError('下标要是整数，这里给的是指针或者结构体', e.line);
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
      case 'null': return NULLP;
      case 'var': {
        const cell = scopeLookup(e.name);
        if (!cell) throw new CError(`没有定义变量 ${e.name}`, e.line);
        if (cell.ref) {
          if (cell.ref.arr) return cell.ref;
          const v = refGet(cell.ref);
          if (v === undefined) throw unsetErr(e.name, refType(cell.ref), e.line);
          return v;
        }
        if (cell.arr) return cell.arr;
        if (cell.val === undefined) throw unsetErr(e.name, cell.type, e.line);
        return cell.val;
      }
      case 'index': {
        const { a, off, dims, idx } = yield* arrayPart(e);
        if (dims.length) return { arr: true, sub: true, id: a.id, name: `${a.name}${idx.map((x) => `[${x}]`).join('')}`, type: a.type, dims, data: a.data, off };
        const v = a.data[off];
        if (v === undefined) throw unsetErr(`${a.name}${idx.map((x) => `[${x}]`).join('')}`, a.type, e.line);
        return v;
      }
      case 'member': {
        const m = yield* member(e);
        if (m.cell.arr) return m.cell.arr;
        if (m.cell.val === undefined) throw unsetErr(m.name, m.cell.type, e.line);
        return m.cell.val;
      }
      case 'deref': {
        const r = yield* derefRef(e);
        const v = refGet(r);
        if (v === undefined) throw unsetErr(refName(r), refType(r), e.line);
        return v;
      }
      case 'addr': return yield* addrOf(e);
      case 'sizeof': {
        if (e.type) return num('int', sizeOf(e.type, e.line));
        return num('int', sizeOfVal(yield* evalExpr(e.e), e.line));
      }
      case 'assign': {
        const r = yield* lvalue(e.target);
        let v = yield* evalExpr(e.value);
        const rt = refType(r);
        if (v?.arr === true && !isPtrT(rt)) throw new CError('数组不能整个赋值', e.line);
        if (e.op !== '=') v = binop(e.op.slice(0, -1), refGet(r), v, e.line, refName(r));
        // 结构体整个赋值：把成员抄进原来的对象（指着它的指针不受影响）
        const cur = isStT(rt) ? refGet(r) : undefined;
        if (cur?.t === 'struct') {
          if (v?.t !== 'struct' || v.obj.tag !== cur.obj.tag) convert(rt, v, e.line);
          if (v.obj !== cur.obj) assignInto(cur.obj, v.obj);
          return cur;
        }
        const nv = convert(rt, v, e.line, refName(r));
        refSet(r, nv);
        return nv;
      }
      case 'incdec': {
        const r = yield* lvalue(e.a);
        const old = refGet(r);
        if (old === undefined) throw unsetErr(refName(r), refType(r), e.line);
        if (old.t === 'ptr') throw new CError(`不支持指针运算（${refName(r)}${e.op}）：链表往后走写 p = p->next`, e.line);
        if (old.t === 'struct') throw new CError('结构体不能自增自减', e.line);
        const nv = convert(refType(r), num(old.t, old.v + (e.op === '++' ? 1 : -1)), e.line);
        refSet(r, nv);
        return e.pre ? nv : old;
      }
      case 'unary': {
        const a = yield* evalExpr(e.a);
        if (a?.t === 'ptr') {
          if (e.op === '!') return num('int', a.v ? 0 : 1);
          throw new CError(`指针不能做「${e.op}」运算`, e.line);
        }
        if (a?.t === 'struct') throw new CError('结构体不能直接参加运算（要写成员）', e.line);
        if (a?.arr) throw new CError('数组不能参加运算', e.line);
        if (e.op === '-') return num(a.t === 'double' ? 'double' : 'int', -a.v);
        if (e.op === '+') return num(a.t === 'double' ? 'double' : 'int', a.v);
        if (e.op === '!') return num('int', a.v ? 0 : 1);
        return num('int', ~a.v);
      }
      case 'cast': {
        const a = yield* evalExpr(e.a);
        if (e.to === 'void') return num('int', 0);
        return convert(e.to, a, e.line);
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
  // 两个指针是不是指向同一个地方（和 0 比就是和 NULL 比）
  function samePtr(a, b, line) {
    const norm = (x) => {
      if (x?.t === 'ptr') return x;
      if (x && ['int', 'char', 'bool'].includes(x.t) && x.v === 0) return NULLP;
      throw new CError('指针只能和指针、NULL 比较', line);
    };
    const x = norm(a), y = norm(b);
    if (!x.v || !y.v) return !x.v && !y.v;
    if (x.obj || y.obj) return x.obj === y.obj;
    if (x.blk || y.blk) return x.blk === y.blk && (x.off || 0) === (y.off || 0);
    return x.lv && y.lv && (x.lv.cell ? x.lv.cell === y.lv.cell : x.lv.a === y.lv.a && x.lv.i === y.lv.i);
  }
  function binop(op, a, b, line, what) {
    if (a === undefined || b === undefined) throw new CError(`${what || '变量'} 还没赋值就用了`, line);
    if (a.t === 'ptr' || b.t === 'ptr') {
      if (op === '==' || op === '!=') { const same = samePtr(a, b, line); return num('int', +(op === '==' ? same : !same)); }
      throw new CError(`不支持指针运算（「${op}」）：链表往后走写 p = p->next`, line);
    }
    if (a.arr === true || b.arr === true) throw new CError('数组不能参加运算（要写下标）', line);
    if (a.t === 'struct' || b.t === 'struct') throw new CError('结构体不能直接参加运算（要写成员，比如 L.length）', line);
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
    const t0 = temps.length;
    for (let k = 0; k < f.params.length; k++) {
      const prm = f.params[k], arg = e.args[k];
      if (prm.ref) {
        const r = yield* lvalue(arg);
        scope.set(prm.name, { ref: r, type: prm.type });
        argText.push(`${prm.name} 是 ${refName(r)} 的引用`);
        continue;
      }
      let v = yield* evalExpr(arg);
      if (prm.array && v?.t === 'ptr' && v.blk) v = arrOf(v, exprText(arg), e.line);
      if (prm.array) {
        if (v?.arr !== true) throw new CError(`${e.name} 的第 ${k + 1} 个参数要传数组`, e.line);
        if (v.sub) throw new CError('还不支持把二维数组的一行传进函数', e.line);
        scope.set(prm.name, { ref: v, type: prm.type });
        argText.push(prm.name === v.name ? `数组 ${v.name}` : `${prm.name} 就是数组 ${v.name}`);
        continue;
      }
      if (v?.arr === true && !isPtrT(prm.type)) throw new CError(`${e.name} 的第 ${k + 1} 个参数是 ${tname(prm.type)}，不能传数组`, e.line);
      const cv = convert(prm.type, v, e.line, prm.name);
      temps.push(cv); // 后面的实参里还有函数调用时，这个值还没落到形参里
      scope.set(prm.name, { type: prm.type, val: cv });
      argText.push(isStT(prm.type) ? `${prm.name} 是 ${exprText(arg)} 的一份拷贝` : `${prm.name} = ${show(cv)}`);
    }
    temps.length = t0;
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
    return ret;
  }
  // malloc(sizeof(LNode))：一个结点；malloc(sizeof(int) * n)：一串
  function mallocShape(arg, line) {
    const sz = (x) => (x?.t === 'sizeof' && x.type ? x.type : null);
    if (sz(arg)) return { type: sz(arg), count: null };
    if (arg?.t === 'bin' && arg.op === '*') {
      if (sz(arg.a)) return { type: sz(arg.a), count: arg.b };
      if (sz(arg.b)) return { type: sz(arg.b), count: arg.a };
    }
    throw new CError('malloc 里要写 sizeof(类型)：一个结点 malloc(sizeof(LNode))，一串 malloc(sizeof(int) * n)', line);
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
    if (e.name === 'malloc') {
      if (e.args.length !== 1) throw new CError('malloc 要一个参数：malloc(sizeof(LNode))', e.line);
      const { type, count } = mallocShape(e.args[0], e.line);
      if (count === null && isStT(type)) {
        const obj = mkObj(type.st, { onHeap: true, line: e.line });
        notes.push(`malloc 了新结点${circ(obj.hid)}（成员还没有值）`);
        return { t: 'ptr', v: 1, obj, to: type };
      }
      const n = count === null ? 1 : (yield* evalExpr(count)).v;
      if (!(n >= 1) || !Number.isInteger(n)) throw new CError(`malloc 的个数要是正整数（现在是 ${n}）`, e.line);
      if (heap.length >= MAX_HEAP) throw new CError(`malloc 了 ${MAX_HEAP} 次了：可能是循环没停`, e.line);
      const a = mkArray(circ(heap.length + 1), type, [n], (k) => initVal(type, false, `${circ(heap.length + 1)}[${k}]`, e.line));
      a.heap = true;
      a.freed = false;
      heap.push(a);
      a.hid = heap.length;
      notes.push(`malloc 了一块能放 ${n} 个 ${tname(type)} 的空间${circ(a.hid)}`);
      return { t: 'ptr', v: 1, blk: a, off: 0, to: type };
    }
    if (e.name === 'free') {
      if (e.args.length !== 1) throw new CError('free 要一个参数：free(p)', e.line);
      const what = exprText(e.args[0]);
      const p = yield* evalExpr(e.args[0]);
      if (p?.t !== 'ptr') throw new CError(`free 的参数要是指针，${what} 不是`, e.line);
      if (!p.v) { notes.push('free(NULL) 什么也不做'); return num('int', 0); }
      const o = p.obj || p.blk;
      if (!o?.heap) throw new CError(`free 只能释放 malloc 来的空间，${what} 指向的是变量${p.obj ? ` ${p.obj.owner}` : ''}`, e.line);
      if (o.freed) throw new CError(`${what} 指向的${p.obj ? '结点' : '空间'}${circ(o.hid)}已经 free 过了，这里又 free 了一次（free 两次）`, e.line);
      o.freed = true;
      o.freedAt = steps.length; // 这一步还画出来（标成已释放），之后没人指着就不画了
      notes.push(() => { const who = danglers(o); return `释放了${p.obj ? '结点' : '空间'}${circ(o.hid)}${who.length ? `（${who.join('、')} 还指着它：悬空指针，别再通过${who.length > 1 ? '它们' : ` ${who[0]} `}访问）` : ''}`; });
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
      case 'visit': {
        // 王道的遍历里 visit(T) 常常不写：输出结点的 data，后面跟一个空格
        if (args.length !== 1) throw new CError('visit 要一个参数：visit(T)', e.line);
        let v = args[0];
        if (v?.t === 'ptr') {
          checkDeref(v, exprText(e.args[0]), `visit(${exprText(e.args[0])})`, e.line);
          if (!v.obj) throw new CError('visit 的参数要是指向结点的指针', e.line);
          const key = structShape(structs[v.obj.tag]).key;
          v = key ? v.obj.fields.get(key).val : undefined;
          if (v === undefined) throw new CError(`${exprText(e.args[0])} 指向的结点${key ? ` ${key}` : ''}还没赋值`, e.line);
        }
        if (v?.t === 'struct') throw new CError('visit 的参数要是指向结点的指针', e.line);
        out += `${v.t === 'char' ? String.fromCharCode(v.v) : show(v)} `;
        return num('int', 0);
      }
      case 'abs': return num(args[0].t === 'double' ? 'double' : 'int', Math.abs(args[0].v));
      case 'max': return num(arith(args[0], args[1]), Math.max(args[0].v, args[1].v));
      case 'min': return num(arith(args[0], args[1]), Math.min(args[0].v, args[1].v));
      case 'sqrt': return num('double', Math.sqrt(args[0].v));
      case 'pow': return num('double', args[0].v ** args[1].v);
      case 'scanf': case 'gets': case 'getchar':
        throw new CError(`不支持 ${e.name}（输入用 let / call 给好）`, e.line);
      case 'calloc': case 'realloc':
        throw new CError(`不支持 ${e.name}，写 malloc(sizeof(类型))`, e.line);
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
  // 数组大小、成员数组的大小：常量（#define 的、数），不能调用函数
  function constEval(expr, line) {
    try { return scopeEval(expr); } catch (x) { throw new CError(`数组的大小要是常量：${x.message}`, line); }
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
  // 先猜问的是指针时：指向哪个结点（data 是几）、还是 NULL
  function ptrAnswer(p) {
    if (!p.v) return { null: true };
    const o = p.obj;
    if (o?.heap) {
      const key = structShape(structs[o.tag]).key;
      const kv = key ? o.fields.get(key).val : undefined;
      return { id: o.hid, field: key, key: kv === undefined ? undefined : show(kv), freed: o.freed, tree: structShape(structs[o.tag]).tree };
    }
    return { other: show(p) };
  }
  function* unit(line, kind, msg, extra, hits = []) {
    const s = snapshot(line, kind, msg, extra);
    for (const w of hits) {
      let v, val;
      try { val = scopeEval(w.take); v = show(val); } catch (x) { v = undefined; w.error = x.message; }
      const more = val?.t === 'ptr' ? { ptr: ptrAnswer(val) } : val?.t === 'struct' || val?.arr === true ? { whole: true } : {};
      s.asks = [...(s.asks || []), { w, value: v, ...more }];
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
        for (const d of s.decls) yield* declare(d, f.scopes[f.scopes.length - 1], s.line);
        const blank = s.decls.filter((d) => !d.init && !d.dims.length).map((d) => d.name);
        const msg = blank.length === s.decls.length ? `定义 ${blank.join('、')}（还没有值）。` : describe(before, s.src);
        yield* unit(s.line, 'decl', msg, undefined, hits);
        return;
      }
      case 'expr': {
        const hits = arm(s.line);
        const before = diffBase();
        const outBefore = out;
        const n0 = steps.length;
        yield* evalExpr(s.e);
        yield* unit(s.line, 'expr', describe(before, s.src, outBefore, steps.length > n0), undefined, hits);
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
            if (s.init.t === 'decl') for (const d of s.init.decls) yield* declare(d, f.scopes[f.scopes.length - 1], s.line);
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
        const rv = v !== undefined && fn.ret !== 'void' ? convert(fn.ret, v, s.line, `${fn.name} 的返回值`) : undefined;
        if (rv !== undefined) temps.push(rv); // 返回值还没落到变量里：这一步不算泄漏
        try {
          yield* unit(s.line, 'return', rv !== undefined ? `${fn.name} 返回 ${show(rv)}${s.esrc && s.esrc !== show(rv) ? `（${s.esrc}）` : ''}。` : `${fn.name} 结束，返回。`, undefined, hits);
        } finally { if (rv !== undefined) temps.pop(); }
        throw { kind: 'return', value: rv };
      }
    }
    throw new CError('看不懂的语句', s.line);
  }

  function* declare(d, scope, line) {
    const type = d.type;
    if (d.ref) throw new CError('局部的引用变量还不支持', line);
    if (scope.has(d.name)) throw new CError(`${d.name} 在这里已经定义过了`, line);
    if (type === 'void') throw new CError(`${d.name} 不能是 void（void 只能写在函数返回值、void * 里）`, line);
    const zero = scope === globals;
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
      const a = mkArray(d.name, type, dims, (k) => initVal(type, zero, `${d.name}${idxText({ dims }, k)}`, line));
      if (d.init) {
        if (d.init.t !== 'init') throw new CError(`数组 ${d.name} 要用 {…} 初始化`, line);
        if (isStT(type)) throw new CError('还不支持给结构体数组写 {…} 初始化', line);
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
    if (isStT(type)) {
      const obj = mkObj(type.st, { zero, owner: d.name, line });
      if (d.init?.t === 'init') {
        // SqList L = {{1, 2, 3}, 3}：按成员的顺序给
        const fs = [...obj.fields.values()];
        if (d.init.items.length > fs.length) throw new CError(`${d.name} 只有 ${fs.length} 个成员，初始化写多了`, line);
        for (const [k, x] of d.init.items.entries()) {
          const c = fs[k];
          if (c.arr) {
            if (x.t !== 'init') throw new CError(`${d.name} 的第 ${k + 1} 个成员是数组，要写 {…}`, line);
            c.arr.data.fill(convert(c.arr.type, num('int', 0)));
            for (const [j, y] of x.items.entries()) { if (j >= c.arr.data.length) throw new CError('初始化写多了', line); c.arr.data[j] = convert(c.arr.type, yield* evalExpr(y), line); }
          } else c.val = convert(c.type, yield* evalExpr(x), line);
        }
      } else if (d.init) {
        const v = yield* evalExpr(d.init);
        const cv = convert(type, v, line, d.name);
        assignInto(obj, cv.obj);
      }
      scope.set(d.name, { type, val: { t: 'struct', obj } });
      return;
    }
    let val = zero ? convert(type, num('int', 0)) : undefined;
    if (d.init) {
      if (d.init.t === 'init') throw new CError(`${d.name} 不是数组，不能用 {…} 初始化`, line);
      const v = yield* evalExpr(d.init);
      if (v?.arr === true && !isPtrT(type)) throw new CError('数组不能直接赋给一个变量', line);
      val = convert(type, v, line, d.name);
    }
    scope.set(d.name, { type, val });
  }

  // —— 一步的说明：哪些变量、成员、数组元素变了 ——
  // 看得见的地方：当前这一层（里层的变量挡住外层的同名变量）、全局、堆上的结点。[名字, 显示的值]
  function places() {
    const out2 = [];
    const seen = new Set();
    const f = stack[stack.length - 1];
    const put = (name, v) => {
      if (v?.t === 'struct') { for (const [fn, c] of v.obj.fields) if (!c.arr) put(`${name}.${fn}`, c.val); return; }
      out2.push([name, show(v)]);
    };
    const look = (name, cell) => {
      if (seen.has(name)) return;
      seen.add(name);
      if (cell.arr || cell.ref?.arr) return;
      let v;
      try { v = cell.ref ? refGet(cell.ref) : cell.val; } catch { return; }
      put(name, v);
    };
    if (f) for (let i = f.scopes.length - 1; i >= 0; i--) for (const [n, c] of f.scopes[i]) look(n, c);
    for (const [n, c] of globals) look(n, c);
    for (const o of heap) if (!o.freed && !o.arr) for (const [fn, c] of o.fields) if (!c.arr) put(`${circ(o.hid)}.${fn}`, c.val);
    return out2;
  }
  function diffBase() {
    return { vals: new Map(places()), arrs: arrays.map((a) => a.data.map(show)) };
  }
  function changes(before) {
    const out2 = [];
    for (const [name, now] of places()) {
      const old = before.vals.get(name);
      if (old === undefined) { if (now !== '?') out2.push(`${name} = ${now}`); }
      else if (old !== now) out2.push(old === '?' ? `${name} = ${now}` : `${name}：${old} → ${now}`);
    }
    arrays.forEach((a, k) => {
      const old = before.arrs[k] || [];
      if (a.freed) return;
      a.data.forEach((x, i) => {
        const now = show(x);
        if (old[i] !== undefined && old[i] !== now) out2.push(old[i] === '?' ? `${a.name}${idxText(a, i)} = ${now}` : `${a.name}${idxText(a, i)}：${old[i]} → ${now}`);
      });
    });
    return out2;
  }
  // called：这一句里调用了函数（里面每一步都说过了）：只说这一层的变量变成了什么，结点、数组的变化不再重复
  function describe(before, src, outBefore, called = false) {
    let ch = changes(before);
    if (called) {
      ch = ch.filter((x) => !/^[^：=]*[.[]/.test(x) && !/^[\u2460-\u2473\u3251-\u325f\u32b1-\u32bf#]/.test(x));
      if (ch.length > 4) ch = [...ch.slice(0, 3), `等 ${ch.length} 处`];
    }
    const printed = outBefore !== undefined && out.length > outBefore.length ? out.slice(outBefore.length) : '';
    const bits = [];
    if (ch.length) bits.push(ch.join('，'));
    if (printed) bits.push(`输出「${printed.replace(/\n/g, '⏎')}」`);
    return `${src}${bits.length ? `：${bits.join('；')}` : ''}。`;
  }
  // 条件里用到的变量的值：（i = 3，n = 8）、（p = ②，p->data = 5）
  function valuesIn(expr) {
    const items = [];
    const add = (text, ast) => { if (text && !items.some(([t]) => t === text)) items.push([text, ast]); };
    const walk = (x) => {
      if (!x || typeof x !== 'object') return;
      if (x.t === 'var') { add(x.name, x); return; }
      if (x.t === 'index') { add(indexText(x), x); walk(x.i); return; }
      if (x.t === 'member') { walk(x.a); add(exprText(x), x); return; }
      for (const k of ['a', 'b', 'c', 'i', 'value', 'target']) if (x[k] && typeof x[k] === 'object') walk(x[k]);
      if (x.args) x.args.forEach(walk);
    };
    walk(expr);
    const parts = [];
    for (const [text, ast] of items) {
      try {
        let v;
        if (ast.t === 'var') {
          const cell = scopeLookup(text);
          if (!cell || cell.arr || cell.ref?.arr) continue;
          v = cell.ref ? refGet(cell.ref) : cell.val;
        } else v = scopeEval(ast);
        if (v?.arr === true || v?.t === 'struct') continue;
        parts.push(`${text} = ${show(v)}`);
      } catch { /* 越界、没赋值、空指针：不写 */ }
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

  // —— let 给的链表、二叉树 ——
  // 用哪种结点：先看 call: 里把它传给了哪个形参（LinkList L → LNode），再看代码里有没有唯一一种合适的结构体
  function pickStruct(name, kind) {
    const fits = (tag) => { const sh = structShape(structs[tag]); return kind === 'tree' ? sh.tree : !!sh.next; };
    const what = kind === 'tree' ? '二叉链表的结点（有 lchild、rchild）' : '链表的结点（有 next）';
    if (start?.e?.t === 'call') {
      const f = program.funcs[start.e.name];
      const k = start.e.args.findIndex((a) => a.t === 'var' && a.name === name);
      const t = f && k >= 0 ? f.params[k]?.type : null;
      if (isPtrT(t) && isStT(t.ptr) && structs[t.ptr.st]?.fields) {
        if (!fits(t.ptr.st)) throw new CError(`let ${name}：${start.e.name} 的第 ${k + 1} 个参数是 ${tname(t)}，不是${what}`);
        return t.ptr.st;
      }
    }
    const cands = Object.keys(structs).filter((tag) => structs[tag].fields && fits(tag));
    if (cands.length === 1) return cands[0];
    if (!cands.length) throw new CError(`let ${name}：代码里没有${what}的结构体${kind === 'tree' ? '（typedef struct BiTNode { … struct BiTNode *lchild, *rchild; } BiTNode, *BiTree;）' : '（typedef struct LNode { … struct LNode *next; } LNode, *LinkList;）'}`);
    throw new CError(`let ${name}：代码里有好几种结点（${cands.map((t) => tname({ st: t })).join('、')}），看不出 ${name} 是哪种：在 call: 里把 ${name} 传给函数`);
  }
  function setKey(o, sh, raw, name) {
    const c = o.fields.get(sh.key);
    const s = String(raw);
    if (c.type === 'char') {
      if ([...s].length !== 1) throw new CError(`let ${name}：结点的 ${sh.key} 是 char，「${s}」不是一个字符`);
      c.val = num('char', s.charCodeAt(0));
      return;
    }
    const v = Number(s);
    if (s.trim() === '' || !Number.isFinite(v)) throw new CError(`let ${name}：结点的 ${sh.key} 是 ${tname(c.type)}，写的是「${s}」`);
    c.val = convert(c.type, num(Number.isInteger(v) ? 'int' : 'double', v));
  }
  function buildLinked(name, v) {
    const tag = pickStruct(name, v.tree ? 'tree' : 'list');
    const sh = structShape(structs[tag]);
    if (!sh.key) throw new CError(`let ${name}：结点 ${tname({ st: tag })} 里没有放数据的成员`);
    const node = (raw) => {
      const o = mkObj(tag, { onHeap: true, zero: true });
      if (raw === undefined) o.fields.get(sh.key).val = undefined; // 头结点的 data 不用
      else setKey(o, sh, raw, name);
      return o;
    };
    const type = { ptr: { st: tag } };
    const ptr = (o) => (o ? { t: 'ptr', v: 1, obj: o, to: { st: tag } } : { ...NULLP, to: { st: tag } });
    if (v.tree) {
      const walk = (id) => {
        if (id === null || id === undefined) return null;
        const n = v.tree.nodes[id];
        const o = node(n.key); // 先序建：编号和先序一致
        o.fields.get(sh.left).val = ptr(walk(n.left));
        o.fields.get(sh.right).val = ptr(walk(n.right));
        return o;
      };
      return { type, val: ptr(walk(v.tree.root)) };
    }
    const items = v.head ? [undefined, ...v.list] : v.list;
    const os = items.map(node);
    os.forEach((o, k) => {
      o.fields.get(sh.next).val = ptr(os[k + 1] || null);
      if (sh.prior) o.fields.get(sh.prior).val = ptr(os[k - 1] || null);
    });
    return { type, val: ptr(os[0] || null) };
  }

  // —— 入口 ——
  const runner = (function* main() {
    const gscope = globals;
    // 全局变量：代码里定义的，加上 let 给的（数组、数、链表、树）
    stack.push({ fn: { name: '全局', ret: 'void' }, scopes: [gscope], argText: '' });
    for (const g of program.globals) for (const d of g.decls) yield* declare(d, gscope, g.line);
    for (const [name, v] of Object.entries(vars)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && (v.list || v.tree)) { gscope.set(name, buildLinked(name, v)); continue; }
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
    if (r !== undefined) temps.push(r);
    snapshot(0, 'end', `结束${start && r && !r.arr && program.funcs[start.e.name]?.ret !== 'void' ? `：${start.e.name} 返回 ${show(r)}` : ''}。${out ? `\n输出：${out}` : ''}`);
  })();
  try {
    for (let r = runner.next(); !r.done; r = runner.next()) { /* 每一步都在 snapshot 里记好了 */ }
  } catch (x) {
    if (x instanceof CError) error = x;
    else if (x && x.kind) error = new CError(x.kind === 'return' ? 'return 用在了函数外面' : `${x.kind} 用在了循环外面`);
    else throw x;
  }
  return { steps, arrays: arrays.map((a) => ({ id: a.id, name: a.name, dims: a.dims })), error, out, leaks: heap.filter((o) => o.leaked).map((o) => o.hid) };
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
