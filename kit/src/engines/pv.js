// 进程同步：信号量 P / V（组件 pv）。几个进程并发执行，每一步是某一个进程执行它的下一句。
// 口径按王道的记录型信号量：P(S)：S − 1，减完 < 0 就阻塞，排进 S 的等待队列；V(S)：S + 1，加完 ≤ 0 就唤醒队头的一个。
// S 可以是负数，|S| 就是等着的进程数。
// 执行顺序：作者写 run:（P P C、P×3、P+ 一直走到阻塞或做完、(P C)×2），或者 run: deadlock 让页面自己找一种最短的死锁走法；
// 不写 run: 时是学生自己点进程（画面在 blocks/pvdo.js，用的纯函数也在这里：pvStart / pvMove / pvSearch……）。
// 页面看得出来的毛病：死锁（没有进程能走、至少两个阻塞着）、两个进程同时在临界区（缓冲区的放入 / 取出、标了 /* 临界区 */ 的句子）、
// 缓冲区满了还放 / 空了还取 / 取错了东西。会不会死锁：把所有交替执行的状态都走一遍（状态不多，宽度优先，找到的是最短的）。
// 经典问题一行写完：problem: 生产者消费者 / 读者写者 / 哲学家 / 吸烟者 / 苹果橘子（代码照王道写）。
// 纯函数，不碰 DOM（tests/pv-engine.test.js）。
import { esc } from './arrayview.js';

const KEYWORDS = new Set(['while', 'if', 'else', 'do', 'for', 'int', 'semaphore', 'process', 'void', 'return', 'break', 'true', 'false']);
// 写在 code: 下面的这些名字，多半是把字段写到了 code: 后面
const FIELD_NAMES = new Set(['id', 'title', 'q', 'note', 'link', 'mode', 'ask', 'start', 'speed', 'auto', 'given', 'rows', 'cols', 'hint', 'problem', 'semaphore', 'sem', 'semaphores', 'var', 'vars', 'buffer', 'swap', 'run', 'find', 'code']);
const MAX_PROCS = 8, MAX_STATES = 40000, MAX_STEPS = 200, PLUS_CAP = 60;
const CS = '\u0001'; // 注释里的「临界区」先换成这个记号，挂到前面那句上
const NOWAKE = '不唤醒';
const fmt = (x) => (x < 0 ? `−${-x}` : String(x));

// ================= 表达式（条件、赋值、数组下标）：整数，C 的写法 =================

const OPS = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

export function parseExpr(src, known, where = '') {
  const text = String(src ?? '').trim();
  const toks = text.match(/\d+|[A-Za-z_]\w*|==|!=|<=|>=|&&|\|\||[-+*/%()<>!]/g) || [];
  const bad = () => new Error(`${where}看不懂「${text}」（只认整数、变量，和 + − * / % == != < <= > >= && || ! 括号）`);
  if (!toks.length || toks.join('') !== text.replace(/\s+/g, '')) throw bad();
  let i = 0;
  const level = (d) => {
    if (d === OPS.length) return unary();
    let a = level(d + 1);
    while (OPS[d].includes(toks[i])) { const op = toks[i++]; a = { op, a, b: level(d + 1) }; }
    return a;
  };
  const unary = () => {
    const t = toks[i++];
    if (t === undefined) throw bad();
    if (t === '!' || t === '-') return { un: t, a: unary() };
    if (t === '(') { const e = level(0); if (toks[i++] !== ')') throw bad(); return e; }
    if (/^\d+$/.test(t)) return { n: Number(t) };
    if (t === 'true') return { n: 1 };
    if (t === 'false') return { n: 0 };
    if (/^[A-Za-z_]/.test(t)) {
      if (!known(t)) throw new Error(`${where}${t} 没有初值（共享变量写在 var: 里，如 var: ${t} = 0）`);
      return { id: t };
    }
    throw bad();
  };
  const e = level(0);
  if (i < toks.length) throw bad();
  return e;
}

export function evalExpr(e, env) {
  if ('n' in e) return e.n;
  if ('id' in e) return env[e.id];
  if (e.un) { const v = evalExpr(e.a, env); return e.un === '!' ? (v ? 0 : 1) : -v; }
  const a = evalExpr(e.a, env), b = evalExpr(e.b, env);
  switch (e.op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': if (!b) throw new Error('除以 0 了'); return Math.trunc(a / b);
    case '%': if (!b) throw new Error('对 0 取余了'); return a % b;
    case '==': return a === b ? 1 : 0;
    case '!=': return a !== b ? 1 : 0;
    case '<': return a < b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '>': return a > b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    case '&&': return a && b ? 1 : 0;
    default: return a || b ? 1 : 0;
  }
}
const idsOf = (e, out = new Set()) => { if (!e) return out; if ('id' in e) out.add(e.id); if (e.a) idsOf(e.a, out); if (e.b) idsOf(e.b, out); return out; };

// ================= 声明：semaphore: mutex = 1, chopstick[5] = 1；var: count = 0 =================

// 按逗号切，大括号里的逗号不切（chopstick[3] = {1, 1, 0}）
const splitTop = (s) => { const out = []; let d = 0, cur = ''; for (const c of String(s)) { if (c === '{' || c === '[') d++; if (c === '}' || c === ']') d--; if ((c === ',' || c === '，' || c === ';' || c === '；') && !d) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };

function parseSems(src, out) {
  for (const part of splitTop(src)) {
    const m = /^([A-Za-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?\s*(?:=\s*(.+))?$/.exec(part);
    if (!m) throw new Error(`semaphore: 看不懂「${part}」，写成 mutex = 1（数组写 chopstick[5] = 1）`);
    const [, name, size, init] = m;
    if (KEYWORDS.has(name) || /^[PV]$/.test(name)) throw new Error(`semaphore: 信号量不能叫 ${name}`);
    if (init === undefined) throw new Error(`semaphore: ${name} 要写初值，如 ${name} = 1`);
    if (out.some((x) => x.name === name)) throw new Error(`semaphore: ${name} 写了两次`);
    const n = size === undefined ? null : Number(size);
    if (n !== null && !(n >= 1 && n <= 8)) throw new Error(`semaphore: ${name}[${size}] 的个数写 1～8`);
    let vals;
    const list = /^\{(.*)\}$/.exec(init.trim());
    if (list) vals = list[1].split(/[,，\s]+/).filter(Boolean);
    else vals = [init.trim()];
    if (!vals.every((v) => /^-?\d+$/.test(v))) throw new Error(`semaphore: ${name} 的初值要是整数（现在是「${init}」）`);
    vals = vals.map(Number);
    if (n === null && vals.length !== 1) throw new Error(`semaphore: ${name} 不是数组，只写一个初值`);
    if (n !== null && vals.length !== 1 && vals.length !== n) throw new Error(`semaphore: ${name}[${n}] 写了 ${vals.length} 个初值`);
    out.push({ name, size: n, init: n === null ? vals : Array.from({ length: n }, (_, k) => vals[vals.length === 1 ? 0 : k]) });
  }
  return out;
}

function parseVars(src, out) {
  for (const part of splitTop(src)) {
    const m = /^([A-Za-z_]\w*)\s*(?:=\s*(-?\d+))?$/.exec(part);
    if (!m) throw new Error(`var: 看不懂「${part}」，写成 count = 0`);
    if (KEYWORDS.has(m[1])) throw new Error(`var: 变量不能叫 ${m[1]}`);
    if (m[1] in out) throw new Error(`var: ${m[1]} 写了两次`);
    out[m[1]] = m[2] === undefined ? 0 : Number(m[2]);
  }
  return out;
}

// buffer: 2、buffer: 盘子 1 苹果 橘子（名字、容量、放的几种东西；名字和东西可以不写）
function parseBuffer(src) {
  const t = String(src ?? '').trim().split(/[\s,，、]+/).filter(Boolean);
  if (!t.length) return null;
  const at = t.findIndex((x) => /^\d+$/.test(x));
  if (at < 0) throw new Error(`buffer: 写缓冲区有几个位置，如 buffer: 2（盘子写成 buffer: 盘子 1 苹果 橘子）`);
  const cap = Number(t[at]);
  if (!(cap >= 1 && cap <= 8)) throw new Error('buffer: 缓冲区的位置写 1～8 个');
  return { cap, name: t.slice(0, at).join(''), items: t.slice(at + 1), unit: '' };
}

// 缓冲区操作：按句子里的字认（放入 / 取出），只在写了 buffer: 时认
const PUT = /^(放|put\b|add\b|insert\b|append\b)|放入|放进|放到|放在/i;
const TAKE = /^(取|拿|take\b|remove\b|get\b)|取出|取走|拿走|拿出/i;
function classify(text, buffer) {
  if (!buffer) return null;
  const op = PUT.test(text) ? 'put' : TAKE.test(text) ? 'take' : null;
  if (!op) return null;
  return { op, item: buffer.items.find((x) => text.includes(x)) || '' };
}

// ================= 进程的代码 =================

// 注释去掉；/* 临界区 */、// 临界区（读）换成记号，挂到它前面那一句上
function stripComments(code) {
  return code.replace(/\/\*([\s\S]*?)\*\/|\/\/([^\n]*)/g, (m, a, b) => {
    const t = a ?? b;
    if (/临界区|critical/i.test(t)) return `${CS}${/读|共享|read|share/i.test(t) ? 's' : 'x'}${CS}`;
    return a !== undefined && a.includes('\n') ? '\n' : ' ';
  });
}

const HEAD_RE = /^(?:(?:process|void)\s+|进程\s*)?([A-Za-z_一-鿿][\w一-鿿]*)/;
// 一个进程的开头：P:、P() {、P(i)×5:、R×2（读者）:、process producer() {
function headerAt(s, i) {
  const m = HEAD_RE.exec(s.slice(i, i + 200));
  if (!m || KEYWORDS.has(m[1])) return null;
  let j = i + m[0].length, param = null, label = '', copies = null;
  for (let g = 0; g < 4; g++) {
    while (s[j] === ' ' || s[j] === '\t') j++;
    const c = s[j];
    if (c === '(' || c === '（') {
      const k = s.indexOf(c === '(' ? ')' : '）', j + 1);
      if (k < 0 || s.slice(j + 1, k).includes('\n')) return null;
      const inner = s.slice(j + 1, k).trim();
      if (c === '(' && /^[A-Za-z_]\w*$/.test(inner)) param = inner;
      else if (inner) label = inner;
      j = k + 1;
      continue;
    }
    if (c === '×' || c === '*') {
      const mm = /^[×*]\s*(\d+)/.exec(s.slice(j));
      if (!mm) return null;
      copies = Number(mm[1]);
      j += mm[0].length;
      continue;
    }
    break;
  }
  while (s[j] === ' ' || s[j] === '\t') j++;
  const c = s[j];
  if (c === ':' || c === '：' || c === '{') return { name: m[1], param, label, copies, form: c === '{' ? '{' : ':', end: j + 1 };
  return null;
}
const atLineStart = (s, i) => { let k = i - 1; while (k >= 0 && (s[k] === ' ' || s[k] === '\t')) k--; return k < 0 || s[k] === '\n'; };

function skipWs(s, pos, semis = true) {
  while (pos.i < s.length && (/\s/.test(s[pos.i]) || (semis && (s[pos.i] === ';' || s[pos.i] === '；')))) pos.i++;
}
function readParen(s, pos, ctx) {
  // pos 在 ( 后面：读到配对的 )
  let d = 1, j = pos.i;
  for (; j < s.length; j++) { if (s[j] === '(') d++; else if (s[j] === ')' && !--d) break; if (s[j] === '\n' || s[j] === '{') break; }
  if (s[j] !== ')') throw new Error(`${ctx.where}括号没配对：「${s.slice(pos.i - 1, pos.i + 30).split('\n')[0]}」`);
  const inner = s.slice(pos.i, j);
  pos.i = j + 1;
  return inner.trim().replace(/\s+/g, ' ');
}
function readMark(s, pos) {
  const k = s.indexOf(CS, pos.i + 1);
  const m = s.slice(pos.i + 1, k);
  pos.i = k + 1;
  return m;
}
// 一句的结尾：分号（可以没有），后面同一行的 // 临界区 挂到这一句上
function endStmt(s, pos, st, ctx) {
  for (;;) {
    while (s[pos.i] === ' ' || s[pos.i] === '\t') pos.i++;
    if (s[pos.i] === ';' || s[pos.i] === '；') { pos.i++; continue; }
    if (s[pos.i] === CS) { mark(st, readMark(s, pos), ctx); continue; }
    return st;
  }
}
function mark(st, m, ctx) {
  if (!st || (st.t !== 'work' && st.t !== 'set')) throw new Error(`${ctx.where}「临界区」要标在临界区里的那句操作后面（比如 写文件; // 临界区），${st ? `不能标在 ${st.text} 上` : '前面没有句子'}`);
  st.cs = m;
}

function parseSemRef(text, ctx) {
  const m = /^([A-Za-z_]\w*)\s*(?:\[(.+)\])?$/.exec(text.trim());
  if (!m) throw new Error(`${ctx.where}P / V 的括号里写信号量的名字（现在是「${text}」）`);
  const sem = ctx.sems.find((x) => x.name === m[1]);
  if (!sem) throw new Error(`${ctx.where}没有信号量 ${m[1]}${ctx.sems.length ? `（声明了：${ctx.sems.map((x) => x.name).join('、')}）` : ''}：在 semaphore: 里写上初值，如 semaphore: ${m[1]} = 1`);
  if (sem.size === null && m[2] !== undefined) throw new Error(`${ctx.where}${m[1]} 不是数组，不能写 ${text}`);
  if (sem.size !== null && m[2] === undefined) throw new Error(`${ctx.where}${m[1]} 是数组（${sem.size} 个），要写下标，如 ${m[1]}[i]`);
  const index = m[2] === undefined ? null : parseExpr(m[2], ctx.known, `${ctx.where}${text} 的下标：`);
  return { name: m[1], index, text: m[2] === undefined ? m[1] : `${m[1]}[${m[2].replace(/\s+/g, '')}]` };
}

function parseBody(s, pos, ctx) {
  skipWs(s, pos, false);
  // 写了大括号的照样显示成一块（if (…) { count--; } 不缩成一行）
  if (s[pos.i] === '{') { pos.i++; const b = parseStmts(s, pos, ctx, '}'); b.braced = true; return b; }
  return [parseStmt(s, pos, ctx)];
}

function parseStmts(s, pos, ctx, until) {
  const out = [];
  for (;;) {
    skipWs(s, pos);
    if (pos.i >= s.length) { if (until === '}') throw new Error(`${ctx.where}少了一个 }`); return out; }
    if (s[pos.i] === '}') { if (until !== '}') throw new Error(`${ctx.where}多了一个 }`); pos.i++; return out; }
    if (until === 'header' && atLineStart(s, pos.i) && headerAt(s, pos.i)) return out;
    if (s[pos.i] === CS) { mark(out.at(-1), readMark(s, pos), ctx); continue; }
    out.push(parseStmt(s, pos, ctx));
    if (out.length > 40) throw new Error(`${ctx.where}句子太多了（一个进程最多 40 句）`);
  }
}

function parseStmt(s, pos, ctx) {
  const rest = s.slice(pos.i, pos.i + 400);
  let m;
  const cond = (text) => (/^(1|true)$/.test(text) ? null : parseExpr(text, ctx.known, `${ctx.where}条件 `));
  if ((m = /^while\s*\(/.exec(rest))) {
    pos.i += m[0].length;
    const c = readParen(s, pos, ctx);
    return { t: 'while', cond: cond(c), condText: c, body: parseBody(s, pos, ctx) };
  }
  if ((m = /^for\s*\(\s*;\s*;\s*\)/.exec(rest))) { pos.i += m[0].length; return { t: 'while', cond: null, condText: '1', body: parseBody(s, pos, ctx) }; }
  if (/^for\b/.test(rest)) throw new Error(`${ctx.where}for 只认 for(;;)（一直循环）；别的循环写成 while (条件)`);
  if ((m = /^do\s*\{/.exec(rest))) {
    pos.i += m[0].length;
    const body = parseStmts(s, pos, ctx, '}');
    skipWs(s, pos, false);
    const w = /^while\s*\(/.exec(s.slice(pos.i, pos.i + 20));
    if (!w) throw new Error(`${ctx.where}do { … } 后面要写 while (1);`);
    pos.i += w[0].length;
    const c = readParen(s, pos, ctx);
    endStmt(s, pos, null, ctx);
    return { t: 'while', do: true, cond: cond(c), condText: c, body };
  }
  if ((m = /^if\s*\(/.exec(rest))) {
    pos.i += m[0].length;
    const c = readParen(s, pos, ctx);
    const st = { t: 'if', cond: parseExpr(c, ctx.known, `${ctx.where}条件 `), condText: c, then: parseBody(s, pos, ctx), else: null };
    const save = pos.i;
    skipWs(s, pos);
    if (/^else\b/.test(s.slice(pos.i, pos.i + 5))) { pos.i += 4; st.else = parseBody(s, pos, ctx); } else pos.i = save;
    return st;
  }
  if (/^else\b/.test(rest)) throw new Error(`${ctx.where}else 前面没有 if`);
  if (/^[{]/.test(rest)) throw new Error(`${ctx.where}多了一个 {（while / if 后面才有大括号）`);
  if ((m = /^(P|V|wait|signal)\s*\(/.exec(rest))) {
    pos.i += m[0].length;
    const op = m[1] === 'P' || m[1] === 'wait' ? 'P' : 'V';
    const ref = parseSemRef(readParen(s, pos, ctx), ctx);
    return endStmt(s, pos, { t: op, sem: ref, text: `${op}(${ref.text})` }, ctx);
  }
  // 赋值：count++、--count、num = (num + 1) % 3、count += 1（变量要在 var: 里）
  const asg = /^(\+\+|--)\s*([A-Za-z_]\w*)/.exec(rest) || /^([A-Za-z_]\w*)\s*(\+\+|--)/.exec(rest) || /^([A-Za-z_]\w*)\s*([+\-*/%]?=)(?!=)/.exec(rest);
  if (asg) {
    const pre = asg[1] === '++' || asg[1] === '--';
    const name = pre ? asg[2] : asg[1], op = pre ? asg[1] : asg[2];
    const asVar = name in ctx.vars, asSem = ctx.sems.some((x) => x.name === name);
    if (asSem) throw new Error(`${ctx.where}信号量 ${name} 只能用 P、V 改，不能写 ${name}${op}`);
    if (asVar || /^(\+\+|--)$/.test(op)) {
      if (!asVar) throw new Error(`${ctx.where}${name} 没有初值（共享变量写在 var: 里，如 var: ${name} = 0）`);
      pos.i += asg[0].length;
      let expr = null, text = pre ? `${op}${name}` : `${name}${op}`;
      if (!/^(\+\+|--)$/.test(op)) {
        let j = pos.i;
        while (j < s.length && !/[;；\n}]/.test(s[j]) && s[j] !== CS) j++;
        const e = s.slice(pos.i, j).trim().replace(/\s+/g, ' ');
        pos.i = j;
        expr = parseExpr(e, ctx.known, `${ctx.where}${name} ${op} 后面：`);
        text = `${name} ${op} ${e}`;
      }
      return endStmt(s, pos, { t: 'set', var: name, op, expr, text }, ctx);
    }
  }
  // 别的都是「做一件事」（生产一个产品、读文件、吃饭）：写到分号、换行或 } 为止
  let j = pos.i;
  while (j < s.length && !/[;；\n}]/.test(s[j]) && s[j] !== CS) j++;
  const text = s.slice(pos.i, j).trim().replace(/\s+/g, ' ');
  pos.i = j;
  if (!text) return endStmt(s, pos, null, ctx);
  const st = { t: 'work', text, cs: /临界区/.test(text) ? (/读/.test(text) ? 's' : 'x') : null, buf: classify(text, ctx.buffer) };
  return endStmt(s, pos, st, ctx);
}

// 整个 code: 段：semaphore / int 声明（王道的写法，可以直接贴）和一个个进程
function parseCode(code, sems, vars, buffer) {
  const lines = String(code).split('\n');
  const rest = [];
  for (const l of lines) {
    const m = /^\s*(semaphore|int)\s+(.+?)\s*[;；]?\s*$/.exec(l.replace(/\/\/.*$/, ''));
    if (m) { if (m[1] === 'semaphore') parseSems(m[2], sems); else parseVars(m[2], vars); continue; }
    rest.push(l);
  }
  const s = stripComments(rest.join('\n'));
  const pos = { i: 0 };
  const temps = [];
  const ctx = { sems, vars, buffer, where: '', param: null };
  for (;;) {
    skipWs(s, pos);
    if (pos.i >= s.length) break;
    const h = headerAt(s, pos.i);
    if (!h) {
      const line = s.slice(pos.i).split('\n')[0].trim();
      throw new Error(`code: 看不懂「${line.slice(0, 40)}」：每个进程写成「名字: 语句; 语句; …」或「名字() { … }」${/^(while|if|do|for)\b/.test(line) ? '（这一句要写在某个进程里面）' : ''}`);
    }
    if (FIELD_NAMES.has(h.name.toLowerCase())) throw new Error(`${h.name}: 要写在 code: 前面（code: 放在最后，下面只写进程）`);
    if (h.copies !== null && !(h.copies >= 1 && h.copies <= MAX_PROCS)) throw new Error(`进程 ${h.name}×${h.copies}：个数写 1～${MAX_PROCS}`);
    pos.i = h.end;
    ctx.where = `进程 ${h.name}：`;
    ctx.known = (id) => id === h.param || id in vars;
    if (h.param && h.param in vars) throw new Error(`${ctx.where}参数 ${h.param} 和共享变量重名了`);
    const body = parseStmts(s, pos, ctx, h.form === '{' ? '}' : 'header');
    if (!body.length) throw new Error(`${ctx.where}没有句子`);
    temps.push({ ...h, body });
  }
  if (!temps.length) throw new Error('code: 下面没有进程：一行一个，如「P: while(1) { P(empty); P(mutex); 放入; V(mutex); V(full) }」');
  return temps;
}

// swap: P：把进程 P 里挨着的头两个 P 操作换一下（「先 P(mutex) 再 P(empty)」会怎样）
function swapFirstPs(body) {
  for (let k = 0; k + 1 < body.length; k++) if (body[k].t === 'P' && body[k + 1].t === 'P') { [body[k], body[k + 1]] = [body[k + 1], body[k]]; return [body[k + 1].text, body[k].text]; }
  for (const st of body) {
    for (const sub of [st.body, st.then, st.else]) if (Array.isArray(sub)) { const r = swapFirstPs(sub); if (r) return r; }
  }
  return null;
}

// AST → 显示的代码行（一句一行，照王道的格式缩进）+ 指令（每条有 line；jmp 不算一步）
const SIMPLE = new Set(['P', 'V', 'set', 'work']);
function compile(t, where) {
  const lines = [], code = [];
  const L = (text, depth, extra = {}) => { lines.push({ text, depth, ...extra }); return lines.length - 1; };
  const ins = (st, line) => ({ op: st.t, sem: st.sem, var: st.var, aop: st.op, expr: st.expr, text: st.text, cs: st.cs || null, buf: st.buf || null, line });
  const inlineIf = (st) => st.t === 'if' && !st.then.braced && st.then.length === 1 && SIMPLE.has(st.then[0].t) && (!st.else || (!st.else.braced && st.else.length === 1 && (SIMPLE.has(st.else[0].t) || inlineIf(st.else[0]))));
  const loopCheck = (from) => { if (!code.slice(from).some((x) => x.op !== 'jmp')) throw new Error(`${where}循环里没有句子`); };
  function chain(st, depth, prefix) {
    const line = L(`${prefix}if (${st.condText}) ${st.then[0].text};`, depth, { step: true, cs: st.then[0].cs || null });
    const g = { op: 'guard', cond: st.cond, condText: st.condText, inner: ins(st.then[0], line), line };
    code.push(g);
    if (st.else) {
      g.jf = code.length;
      const e = st.else[0];
      if (SIMPLE.has(e.t)) code.push(ins(e, L(`else ${e.text};`, depth, { step: true, cs: e.cs || null })));
      else chain(e, depth, 'else ');
    }
    g.next = code.length;
    if (!st.else) g.jf = g.next;
  }
  function emit(list, depth) {
    for (const st of list) {
      if (SIMPLE.has(st.t)) { code.push(ins(st, L(`${st.text};`, depth, { step: true, cs: st.cs || null }))); continue; }
      if (inlineIf(st)) { chain(st, depth, ''); continue; }
      if (st.t === 'if') {
        const test = { op: 'test', kind: 'if', cond: st.cond, condText: st.condText, line: L(`if (${st.condText}) {`, depth, { step: true }) };
        code.push(test);
        emit(st.then, depth + 1);
        if (st.else) {
          const j = { op: 'jmp' };
          code.push(j);
          L('} else {', depth);
          test.jf = code.length;
          emit(st.else, depth + 1);
          L('}', depth);
          j.to = code.length;
        } else { L('}', depth); test.jf = code.length; }
        continue;
      }
      // 循环
      if (st.do) {
        L('do {', depth);
        const start = code.length;
        emit(st.body, depth + 1);
        loopCheck(start);
        if (!st.cond) { L('} while (1);', depth); code.push({ op: 'jmp', to: start }); }
        else code.push({ op: 'test', kind: 'do', cond: st.cond, condText: st.condText, jt: start, line: L(`} while (${st.condText});`, depth, { step: true }) });
      } else if (!st.cond) {
        L('while (1) {', depth);
        const start = code.length;
        emit(st.body, depth + 1);
        loopCheck(start);
        code.push({ op: 'jmp', to: start });
        L('}', depth);
      } else {
        const at = code.length;
        const test = { op: 'test', kind: 'while', cond: st.cond, condText: st.condText, line: L(`while (${st.condText}) {`, depth, { step: true }) };
        code.push(test);
        emit(st.body, depth + 1);
        code.push({ op: 'jmp', to: at });
        L('}', depth);
        test.jf = code.length;
      }
    }
  }
  emit(t.body, 0);
  return { lines, code };
}

// pc 跳过 jmp（循环回到开头不算一步）
function settle(code, pc) {
  for (let g = 0; g <= code.length && code[pc]?.op === 'jmp'; g++) pc = code[pc].to;
  return pc;
}

// ================= 经典问题（代码照王道） =================

const PROBLEMS = [
  ['pc', /^(生产者消费者|生产者-消费者|生产者与消费者|生产者和消费者|生产者|pc|producer-consumer|producer)$/i],
  ['rw', /^(读者写者|读者-写者|读者与写者|读者和写者|读写|rw|readers-writers|reader-writer)$/i],
  ['dp', /^(哲学家|哲学家进餐|哲学家就餐|dp|philosophers|dining)$/i],
  ['smoker', /^(吸烟者|抽烟者|smoker|smokers)$/i],
  ['fruit', /^(苹果橘子|水果|多生产者多消费者|多生产者-多消费者|fruit|apple)$/i],
];
const ROOM = /^(?:(?:限|最多|至多)(\d+|[一二两三四五六七八九])个?人|room|limit)$/i;
const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const PROBLEM_LIST = '生产者消费者、读者写者（可加「写者优先」）、哲学家（可加「互斥」「限四人」「奇偶」）、吸烟者、苹果橘子';

function preset(src, bufferField) {
  const t = String(src).trim().split(/[\s,，、]+/).filter(Boolean);
  const kind = PROBLEMS.find(([, re]) => re.test(t[0] || ''))?.[0];
  if (!kind) throw new Error(`problem: 不认识「${t[0] || ''}」（认得：${PROBLEM_LIST}）`);
  const copies = {};
  const mods = [];
  let count = null;
  for (const x of t.slice(1)) {
    const m = /^(.+?)[×*](\d+)$/.exec(x);
    if (m) copies[m[1]] = Number(m[2]);
    else if (/^\d+$/.test(x)) count = Number(x);
    else mods.push(x);
  }
  const cp = (name, d) => { const n = copies[name] ?? d; delete copies[name]; return n === 1 ? '' : `×${n}`; };
  let out;
  const modIs = (re) => { const i = mods.findIndex((x) => re.test(x)); if (i < 0) return false; mods.splice(i, 1); return true; };
  if (kind === 'pc') {
    const buf = { cap: 2, items: [], ...bufferField, name: bufferField?.name || '缓冲区' };
    const n = buf.cap;
    out = {
      sems: `mutex = 1, empty = ${n}, full = 0`, buffer: { ...buf, unit: '个产品' },
      code: `P${cp('P', 1)}（生产者）: while(1) { 生产一个产品; P(empty); P(mutex); 把产品放入缓冲区; V(mutex); V(full); }\nC${cp('C', 1)}（消费者）: while(1) { P(full); P(mutex); 从缓冲区取出一个产品; V(mutex); V(empty); 消费这个产品; }`,
      about: `生产者消费者：缓冲区有 ${n} 个位置。empty 是空位数，full 是产品数，mutex 让大家互斥地访问缓冲区。`,
    };
  } else if (kind === 'fruit') {
    const buf = { cap: 1, ...bufferField, name: bufferField?.name || '盘子' };
    buf.items = [...new Set([...(bufferField?.items || []), '苹果', '橘子'])];
    out = {
      sems: `plate = ${buf.cap}, apple = 0, orange = 0`, buffer: { ...buf, unit: '个水果' },
      code: `爸爸: while(1) { 准备一个苹果; P(plate); 把苹果放进盘子; V(apple); }\n妈妈: while(1) { 准备一个橘子; P(plate); 把橘子放进盘子; V(orange); }\n女儿: while(1) { P(apple); 从盘子里取出苹果; V(plate); 吃掉苹果; }\n儿子: while(1) { P(orange); 从盘子里取出橘子; V(plate); 吃掉橘子; }`,
      about: `一个${buf.name}${buf.cap === 1 ? '只能放一个水果' : `能放 ${buf.cap} 个水果`}：爸爸放苹果给女儿，妈妈放橘子给儿子。plate 是${buf.name}的空位，apple、orange 是${buf.name}里的苹果、橘子。`,
    };
  } else {
    if (bufferField) throw new Error(`problem: ${t[0]} 没有缓冲区，不用写 buffer:`);
    if (kind === 'rw') {
      const fair = modIs(/^(写者优先|写优先|读写公平|公平|fair|writer)$/i);
      modIs(/^(读者优先|读优先|reader)$/i);
      const w = fair ? 'P(w); ' : '';
      out = {
        sems: `rw = 1, mutex = 1${fair ? ', w = 1' : ''}`, vars: 'count = 0',
        code: `R${cp('R', 2)}（读者）: while(1) { ${w}P(mutex); if (count == 0) P(rw); count++; V(mutex); ${fair ? 'V(w); ' : ''}读文件 /* 临界区 读 */; P(mutex); count--; if (count == 0) V(rw); V(mutex); }\nW${cp('W', 1)}（写者）: while(1) { ${w}P(rw); 写文件 /* 临界区 */; V(rw); ${fair ? 'V(w); ' : ''}}`,
        about: fair ? '读者写者（读写公平）：多了一个 w，写者来了以后，后来的读者要排在它后面。count 记有几个读者在读，mutex 保护 count。' : '读者写者（读者优先）：count 记有几个读者在读；第一个读者 P(rw) 把写者挡在外面，最后一个读者 V(rw)；mutex 保护 count。',
      };
    } else if (kind === 'dp') {
      const n = count ?? copies.P ?? 5;
      delete copies.P;
      if (!(n >= 2 && n <= MAX_PROCS)) throw new Error(`problem: 哲学家的人数写 2～${MAX_PROCS}`);
      const L = 'P(chopstick[i])', R = `P(chopstick[(i+1)%${n}])`, VL = 'V(chopstick[i])', VR = `V(chopstick[(i+1)%${n}])`;
      let body, sems = `chopstick[${n}] = 1`, about = `哲学家进餐：${n} 个哲学家围着桌子，第 i 个左边是 chopstick[i]，右边是 chopstick[(i+1)%${n}]，两根都拿到才能吃饭。`;
      if (modIs(/^(互斥|mutex)$/i)) { sems += ', mutex = 1'; body = `P(mutex); ${L}; ${R}; V(mutex); 吃饭; ${VL}; ${VR}; 思考;`; about += '拿两根筷子的动作用 mutex 互斥。'; }
      else if (mods.some((x) => ROOM.test(x))) {
        // 限四人 / 最多 4 人 / room（默认 n − 1）；限 n 人等于没限，也让写（演示「这样还是会死锁」）
        const m = ROOM.exec(mods.splice(mods.findIndex((x) => ROOM.test(x)), 1)[0]);
        const k = m[1] ? (m[1] === '两' ? 2 : CN_NUM.indexOf(m[1]) >= 0 ? CN_NUM.indexOf(m[1]) : Number(m[1])) : n - 1;
        if (!(k >= 1 && k <= n)) throw new Error(`problem: 限几人写 1～${n}（现在是「${m[0]}」）`);
        sems += `, room = ${k}`;
        body = `P(room); ${L}; ${R}; 吃饭; ${VL}; ${VR}; V(room); 思考;`;
        about += `room = ${k}：最多 ${k} 个人同时去拿筷子。`;
      }
      else if (modIs(/^(奇偶|odd)$/i)) { body = `if (i % 2 == 1) { ${L}; ${R}; } else { ${R}; ${L}; } 吃饭; ${VL}; ${VR}; 思考;`; about += '奇数号先拿左边，偶数号先拿右边。'; }
      else body = `${L}; ${R}; 吃饭; ${VL}; ${VR}; 思考;`;
      out = { sems, code: `P(i)×${n}（哲学家）: while(1) { ${body} }`, about };
    } else {
      out = {
        sems: 'offer1 = 0, offer2 = 0, offer3 = 0, finish = 0', vars: 'num = 0',
        code: 'P1（供应者）: while(1) { num++; num = num % 3; if (num == 0) V(offer1); else if (num == 1) V(offer2); else V(offer3); 把两种材料放到桌上; P(finish); }\nP2（有烟草）: while(1) { P(offer3); 拿纸和胶水，卷烟，抽掉; V(finish); }\nP3（有纸）: while(1) { P(offer2); 拿烟草和胶水，卷烟，抽掉; V(finish); }\nP4（有胶水）: while(1) { P(offer1); 拿烟草和纸，卷烟，抽掉; V(finish); }',
        about: '吸烟者：供应者每次在桌上放两种材料（offer1 是烟草和纸、offer2 是烟草和胶水、offer3 是纸和胶水），缺这两种的吸烟者拿去卷烟，抽完用 finish 告诉供应者。',
      };
    }
  }
  if (Object.keys(copies).length) throw new Error(`problem: 这个问题里没有进程 ${Object.keys(copies).join('、')}`);
  if (mods.length) throw new Error(`problem: 不认识「${mods.join(' ')}」（认得：${PROBLEM_LIST}；进程个数写成 R×3）`);
  return out;
}

// ================= 解析 =================

// 字段只在 code: 前面（代码里的「名字:」不能当成字段）
export function head(src) {
  const lines = String(src ?? '').split('\n');
  const at = lines.findIndex((l) => /^\s*code\s*[:：]\s*$/i.test(l));
  return (at < 0 ? lines : lines.slice(0, at)).join('\n');
}

const FIND = { deadlock: 'deadlock', 死锁: 'deadlock', bad: 'bad', 出错: 'bad', 错误: 'bad', error: 'bad' };

function parse(fields, src) {
  const lines = String(src ?? '').split('\n');
  const at = lines.findIndex((l) => /^\s*code\s*[:：]\s*$/i.test(l));
  void fields.code;
  const code = at < 0 ? '' : lines.slice(at + 1).join('\n');
  const semSrc = fields.semaphore ?? fields.sem ?? fields.semaphores;
  const varSrc = fields.var ?? fields.vars;
  let buffer = fields.buffer !== undefined && String(fields.buffer).trim() !== '' ? parseBuffer(fields.buffer) : null;
  const sems = [], vars = {};
  let about = '', text = code;
  if (fields.problem !== undefined && String(fields.problem).trim() !== '') {
    if (code.trim() || semSrc !== undefined || varSrc !== undefined) throw new Error('problem: 和 code: / semaphore: / var: 只写一种（经典问题的代码页面自己写）');
    const p = preset(fields.problem, buffer);
    parseSems(p.sems, sems);
    if (p.vars) parseVars(p.vars, vars);
    buffer = p.buffer || null;
    text = p.code;
    about = p.about;
  } else {
    if (!code.trim()) throw new Error('pv 要写 problem:（生产者消费者、读者写者、哲学家……）或者 code:（单独一行，放在最后，下面一行一个进程，如「P: while(1) { P(empty); P(mutex); 放入; V(mutex); V(full) }」）');
    if (semSrc !== undefined) parseSems(semSrc, sems);
    if (varSrc !== undefined) parseVars(varSrc, vars);
    if (buffer) buffer.name ||= '缓冲区';
  }
  const temps = parseCode(text, sems, vars, buffer);
  if (!sems.length) throw new Error('没有信号量：写 semaphore: mutex = 1, empty = 2, full = 0（或者在 code: 里写 semaphore mutex = 1;）');
  // swap: P, C
  const swapped = [];
  for (const name of String(fields.swap ?? '').split(/[\s,，、]+/).filter(Boolean)) {
    const t = temps.find((x) => x.name === name) || temps.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) throw new Error(`swap: 没有进程 ${name}（有：${temps.map((x) => x.name).join('、')}）`);
    const r = swapFirstPs(t.body);
    if (!r) throw new Error(`swap: 进程 ${name} 里没有挨着的两个 P 操作`);
    swapped.push({ name: t.name, pair: r });
  }
  // 编译、生成进程（P×2 → P1 P2；P(i)×5 → P0…P4，i = 0…4）
  const sys = { temps: [], procs: [], sems, keys: [], init: {}, vars, varNames: Object.keys(vars), buffer };
  for (const s of sems) {
    if (s.size === null) { sys.keys.push(s.name); sys.init[s.name] = s.init[0]; }
    else s.init.forEach((v, k) => { const key = `${s.name}[${k}]`; sys.keys.push(key); sys.init[key] = v; });
  }
  if (sys.keys.length > 12) throw new Error('信号量太多了（最多 12 个，数组的每一个都算）');
  sys.keyIdx = Object.fromEntries(sys.keys.map((k, i) => [k, i]));
  temps.forEach((t, ti) => {
    const { lines, code: c } = compile(t, `进程 ${t.name}：`);
    const n = t.copies ?? 1;
    const names = t.param ? Array.from({ length: n }, (_, i) => `${t.name}${i}`) : n === 1 ? [t.name] : Array.from({ length: n }, (_, i) => `${t.name}${i + 1}`);
    const T = { name: t.name, label: t.label, param: t.param, lines, code: c, procs: [] };
    names.forEach((name, i) => { T.procs.push(sys.procs.length); sys.procs.push({ name, t: ti, env: t.param ? { [t.param]: i } : {} }); });
    sys.temps.push(T);
  });
  if (sys.procs.length > MAX_PROCS) throw new Error(`进程太多了（最多 ${MAX_PROCS} 个）`);
  const seen = new Set();
  for (const p of sys.procs) { if (seen.has(p.name.toLowerCase())) throw new Error(`进程 ${p.name} 重名了`); seen.add(p.name.toLowerCase()); }
  // 只和参数有关的下标先算一遍：越界现在就报
  sys.procs.forEach((pr, p) => {
    for (const x of sys.temps[pr.t].code) {
      const y = x.op === 'guard' ? x.inner : x;
      if (!y.sem?.index || [...idsOf(y.sem.index)].some((id) => id in vars)) continue;
      semKey(sys, y.sem, pr.env, `进程 ${pr.name}：`);
    }
  });
  const used = new Set();
  for (const T of sys.temps) for (const x of T.code) { const y = x.op === 'guard' ? x.inner : x; if (y.sem) used.add(y.sem.name); }
  const findSrc = String(fields.find ?? '').trim();
  const find = findSrc ? FIND[findSrc.toLowerCase()] : 'deadlock';
  if (!find) throw new Error(`find: 写 deadlock（找死锁，默认）或 bad（死锁、同时进临界区、缓冲区满了还放 / 空了还取都算）（现在是「${fields.find}」）`);
  const runSrc = String(fields.run ?? '').trim();
  const input = { sys, about, swapped, find, findSet: !!findSrc, unused: sems.filter((s) => !used.has(s.name)).map((s) => s.name), run: null, runText: '', mistake: '', order: null };
  if (runSrc) { input.run = parseRun(runSrc, sys); input.runText = runSrc.replace(/\s+/g, ' '); }
  return input;
}

// run: P P C、P×3、P+、(P C)×2；或者 deadlock / bad（页面找最短的走法）
function parseRun(src, sys) {
  if (/^(deadlock|死锁)$/i.test(src)) return { search: 'deadlock' };
  if (/^(bad|出错|错误)$/i.test(src)) return { search: 'bad' };
  const norm = src.replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[→,，、;；]/g, ' ');
  const toks = norm.match(/\(|\)|[×*]\s*\d+|\+|[^\s()×*+]+/g) || [];
  let i = 0;
  const who = (name) => {
    const p = sys.procs.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
    if (p >= 0) return p;
    const t = sys.temps.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (t) throw new Error(`run: ${name} 有 ${t.procs.length} 个：写 ${t.procs.map((q) => sys.procs[q].name).join('、')} 里的一个`);
    throw new Error(`run: 没有进程「${name}」（有：${sys.procs.map((x) => x.name).join('、')}）`);
  };
  const seq = (inner) => {
    const out = [];
    while (i < toks.length) {
      const t = toks[i++];
      let items;
      if (t === '(') { items = seq(true); }
      else if (t === ')') { if (!inner) throw new Error('run: 多了一个 )'); return out; }
      else if (/^[×*]/.test(t) || t === '+') throw new Error(`run: 「${t}」前面要有进程名（如 P×3、P+）`);
      else items = [{ p: who(t), n: 1, src: t }];
      const suf = toks[i];
      if (suf && /^[×*]/.test(suf)) {
        i++;
        const n = Number(suf.replace(/^[×*]\s*/, ''));
        if (!(n >= 1 && n <= MAX_STEPS)) throw new Error(`run: ${t}${suf} 的次数写 1～${MAX_STEPS}`);
        if (items.length === 1 && t !== '(') items = [{ ...items[0], n, src: `${t}×${n}` }];
        else { const one = items; items = []; for (let k = 0; k < n; k++) items.push(...one); }
      } else if (suf === '+') {
        i++;
        if (t === '(') throw new Error('run: 括号后面不能写 +（+ 是让一个进程一直走到阻塞或做完：P+）');
        items = [{ ...items[0], n: 'plus', src: `${t}+` }];
      }
      out.push(...items);
    }
    if (inner) throw new Error('run: 少了一个 )');
    return out;
  };
  const items = seq(false);
  if (!items.length) throw new Error('run: 写执行顺序，如 run: P P C（每个名字是那个进程执行一句），P×3 是连走 3 句，P+ 是一直走到阻塞');
  if (items.reduce((a, x) => a + (x.n === 'plus' ? 1 : x.n), 0) > MAX_STEPS) throw new Error(`run: 太长了（最多 ${MAX_STEPS} 步）`);
  return { items };
}

// ================= 执行 =================

function semKey(sys, ref, env, where = '') {
  if (!ref.index) return ref.name;
  const k = evalExpr(ref.index, env);
  const s = sys.sems.find((x) => x.name === ref.name);
  if (!(k >= 0 && k < s.size)) throw new Error(`${where}${ref.text} 的下标是 ${k}，超出了 ${ref.name}[0]～${ref.name}[${s.size - 1}]`);
  return `${ref.name}[${k}]`;
}

export function initState(sys) {
  return {
    pc: sys.procs.map((p) => settle(sys.temps[p.t].code, 0)),
    blk: sys.procs.map(() => null),
    sem: { ...sys.init },
    q: Object.fromEntries(sys.keys.map((k) => [k, []])),
    vars: { ...sys.vars },
    buf: sys.buffer ? [] : null,
  };
}
// 找死锁时要克隆、比较几万个状态：写得省一点
function cloneState(s) {
  const q = {};
  for (const k in s.q) q[k] = s.q[k].slice();
  return { pc: s.pc.slice(), blk: s.blk.slice(), sem: { ...s.sem }, q, vars: { ...s.vars }, buf: s.buf ? s.buf.slice() : null };
}
// 状态的键：小整数一个字一个（pc、阻塞在哪个信号量、信号量的值、等待队列），短的字符串查得快
const ch = (n) => String.fromCharCode(200 + n);
function stateKey(s, sys) {
  let k = '';
  for (const x of s.pc) k += ch(x);
  for (const b of s.blk) k += b === null ? '.' : ch(sys.keyIdx[b]);
  for (const x in s.sem) k += ch(s.sem[x]);
  for (const x in s.q) { const q = s.q[x]; if (q.length) { k += `/${ch(sys.keyIdx[x])}`; for (const p of q) k += ch(p); } }
  if (sys.varNames.length) { k += '|'; for (const x in s.vars) k += `${s.vars[x]},`; }
  return s.buf ? `${k}|${s.buf.join('.')}` : k;
}
const codeOf = (sys, p) => sys.temps[sys.procs[p].t].code;
export const isReady = (sys, s, p) => !s.blk[p] && s.pc[p] < codeOf(sys, p).length;
export const readyList = (sys, s) => sys.procs.map((_, p) => p).filter((p) => isReady(sys, s, p));

// 一句的样子（下标代进去：P(chopstick[(i+1)%5]) → P(chopstick[1])）
function insText(sys, p, x, env) {
  if (x.op === 'P' || x.op === 'V') return `${x.op}(${semKey(sys, x.sem, env)})`;
  if (x.op === 'guard') return `if (${x.condText}) ${insText(sys, p, x.inner, env)}`;
  if (x.op === 'test') return x.kind === 'while' ? `while (${x.condText})` : x.kind === 'do' ? `} while (${x.condText})` : `if (${x.condText})`;
  return x.text;
}

/**
 * 进程 p 执行它的下一句。mistake（只在算常见错法时用）：
 *   nonneg  「信号量不会是负数」：P 时值 > 0 才减，否则阻塞（值不变）；V 时有人等就直接唤醒（值不变），没人等才加 1
 *   le      P 减完 ≤ 0 就阻塞（王道：< 0 才阻塞）
 *   noWake  V 只加 1，不唤醒
 *   wakeLt  V 加完 < 0 才唤醒（王道：≤ 0 就唤醒）
 *   lifo    V 唤醒等待队列里最后一个
 * 返回 { s（新状态）, ev（这一步发生了什么，说明和问题用） }
 */
export function exec(sys, s0, p, mistake = '', lite = false) {
  const pr = sys.procs[p];
  const code = codeOf(sys, p);
  const s = cloneState(s0);
  const pc = s.pc[p];
  const x = code[pc];
  // 变量只有这一句的赋值会改，而赋值是这一句最后做的：开头取一次就够
  const E = sys.varNames.length ? { ...s.vars, ...pr.env } : pr.env;
  const env = () => E;
  const ev = { p, t: pr.t, pc, line: x.line, op: x.op, text: lite ? '' : insText(sys, p, x, E) };
  const resume = (w) => { const y = codeOf(sys, w)[s.pc[w]]; return settle(codeOf(sys, w), y.op === 'guard' ? y.next : s.pc[w] + 1); };
  const run1 = (y) => { // 一句简单的：返回是否阻塞
    if (y.op === 'P') {
      const key = semKey(sys, y.sem, env(), `进程 ${pr.name}：`);
      const before = s.sem[key];
      let blocked;
      if (mistake === 'nonneg') { blocked = before <= 0; if (!blocked) s.sem[key]--; }
      else { s.sem[key]--; blocked = mistake === 'le' ? s.sem[key] <= 0 : s.sem[key] < 0; }
      if (blocked) { s.q[key].push(p); s.blk[p] = key; }
      Object.assign(ev, { kind: 'P', key, before, after: s.sem[key], blocked });
      return blocked;
    }
    if (y.op === 'V') {
      const key = semKey(sys, y.sem, env(), `进程 ${pr.name}：`);
      const before = s.sem[key];
      let wake;
      if (mistake === 'nonneg') { wake = s.q[key].length > 0; if (!wake) s.sem[key]++; }
      else { s.sem[key]++; wake = mistake === 'noWake' ? false : mistake === 'wakeLt' ? s.sem[key] < 0 : s.sem[key] <= 0; }
      let woken = null;
      if (wake && s.q[key].length) {
        woken = mistake === 'lifo' ? s.q[key].pop() : s.q[key].shift();
        s.blk[woken] = null;
        s.pc[woken] = resume(woken);
      }
      Object.assign(ev, { kind: 'V', key, before, after: s.sem[key], woken });
      return false;
    }
    if (y.op === 'set') {
      const before = s.vars[y.var];
      // count++、count--、count = 式子、count += 式子
      s.vars[y.var] = y.aop === '++' ? before + 1 : y.aop === '--' ? before - 1 : y.aop === '=' ? evalExpr(y.expr, env()) : evalExpr({ op: y.aop[0], a: { n: before }, b: y.expr }, env());
      Object.assign(ev, { kind: 'set', var: y.var, before, after: s.vars[y.var] });
      return false;
    }
    // 做一件事；缓冲区的放入 / 取出
    ev.kind = 'work';
    if (y.buf && s.buf) {
      const B = sys.buffer;
      let err = null;
      if (y.buf.op === 'put') { if (s.buf.length >= B.cap) err = 'overflow'; s.buf.push(y.buf.item); }
      else if (!s.buf.length) err = 'underflow';
      else if (y.buf.item) { const j = s.buf.indexOf(y.buf.item); if (j < 0) err = 'wrong'; else s.buf.splice(j, 1); }
      else s.buf.shift();
      ev.buf = { op: y.buf.op, item: y.buf.item, err, n: s.buf.length };
    }
    return false;
  };
  let next = pc + 1;
  try {
    if (x.op === 'test') {
      ev.cond = !!evalExpr(x.cond, env());
      if (!lite) ev.vals = [...idsOf(x.cond)].map((id) => `${id} = ${env()[id]}`);
      next = x.kind === 'do' ? (ev.cond ? x.jt : pc + 1) : ev.cond ? pc + 1 : x.jf;
    } else if (x.op === 'guard') {
      ev.cond = !!evalExpr(x.cond, env());
      if (!lite) ev.vals = [...idsOf(x.cond)].map((id) => `${id} = ${env()[id]}`);
      ev.innerOp = x.inner.op;
      if (!lite) ev.itext = insText(sys, p, x.inner, E);
      if (ev.cond) next = run1(x.inner) ? null : x.next;
      else { next = x.jf; if (x.inner.sem) ev.key = semKey(sys, x.inner.sem, env()); }
    } else if (run1(x)) next = null;
  } catch (e) { throw new Error(`${e.message.startsWith('进程') ? '' : `进程 ${pr.name} 执行 ${ev.text}：`}${e.message}`); }
  if (next !== null) s.pc[p] = settle(code, next);
  ev.done = next !== null && s.pc[p] >= code.length;
  return { s, ev };
}

// 进程正在做的这一句算不算临界区：标了 /* 临界区 */ 的、缓冲区的放入 / 取出
function csOf(sys, x) {
  if (!x || (x.op !== 'work' && x.op !== 'set')) return null;
  if (x.cs) return { group: '临界区', shared: x.cs === 's' };
  if (x.buf && sys.buffer) return { group: sys.buffer.name, shared: false };
  return null;
}

/** 这个状态有什么毛病：deadlock（没有进程能走、至少两个阻塞）、stuck（只剩一个阻塞着，别的都做完了）、race、overflow / underflow / wrong */
export function badOf(sys, s, ev = null) {
  const out = [];
  const ready = readyList(sys, s);
  const blocked = sys.procs.map((_, p) => p).filter((p) => s.blk[p]);
  if (!ready.length && blocked.length >= 2) out.push({ kind: 'deadlock', procs: blocked });
  else if (!ready.length && blocked.length === 1) out.push({ kind: 'stuck', procs: blocked });
  const groups = {};
  sys.procs.forEach((_, p) => {
    if (s.blk[p]) return;
    const cs = csOf(sys, codeOf(sys, p)[s.pc[p]]);
    if (cs) (groups[cs.group] ||= []).push({ p, shared: cs.shared });
  });
  for (const [group, list] of Object.entries(groups)) if (list.length >= 2 && list.some((x) => !x.shared)) out.push({ kind: 'race', group, procs: list.map((x) => x.p) });
  if (ev?.buf?.err) out.push({ kind: ev.buf.err, p: ev.p, item: ev.buf.item });
  return out;
}
export const isBad = (want) => (b) => (want === 'deadlock' ? b.kind === 'deadlock' : b.kind !== 'stuck');

/**
 * 把所有交替执行走一遍（宽度优先），找最近的一个毛病。want：deadlock / bad。
 * 返回 { found, path（进程下标）, bad, states, complete（状态都走完了；超过上限是 false） }。
 * 缓冲区出了错的状态不再往下走（缓冲区会越放越多，状态就数不完了）
 */
export function pvSearch(sys, want = 'deadlock', { limit = MAX_STATES } = {}) {
  sys._search ||= {};
  if (sys._search[want]) return sys._search[want];
  const s0 = initState(sys);
  const k0 = stateKey(s0, sys);
  const parent = new Map([[k0, null]]);
  const queue = [[s0, k0]];
  let res = null;
  for (let h = 0; h < queue.length && !res; h++) {
    const [s, k] = queue[h];
    for (const p of readyList(sys, s)) {
      const r = exec(sys, s, p, '', true);
      const nk = stateKey(r.s, sys);
      if (parent.has(nk)) continue;
      parent.set(nk, [k, p]);
      const bad = badOf(sys, r.s, r.ev).filter(isBad(want));
      if (bad.length) {
        const path = [];
        for (let x = nk; parent.get(x); x = parent.get(x)[0]) path.push(parent.get(x)[1]);
        res = { found: true, path: path.reverse(), bad, states: parent.size, complete: true };
        break;
      }
      if (parent.size > limit) { res = { found: false, path: null, states: parent.size, complete: false }; break; }
      if (!r.ev.buf?.err) queue.push([r.s, nk]);
    }
  }
  res ||= { found: false, path: null, states: parent.size, complete: true };
  // 最短的走法常常有好几种，宽度优先找到的那种不一定好懂：轮流一句一句走、一个进程一直走到阻塞再换下一个，
  // 这两种「自然」的走法要是一样短，就用它（哲学家：五个人先都拿起左边的筷子，再都去拿右边的）
  if (res.found) {
    const tries = [...sys.procs.map((_, p) => ['block', p]), ['rr', 0]];
    for (const [policy, from] of tries) {
      const nat = natural(sys, policy, res.path.length, from);
      const bad = nat && badOf(sys, nat.s, nat.ev).filter(isBad(want));
      if (bad?.length) { res.path = nat.order; res.bad = bad; break; }
    }
  }
  sys._search[want] = res;
  return res;
}

// 按一种规则走 len 步：rr 轮流一句一句走；block 从进程 from 开始，一个进程一直走到阻塞（或做完）再换下一个
function natural(sys, policy, len, from = 0) {
  let s = initState(sys), ev = null, p = from;
  const order = [];
  while (order.length < len) {
    const rs = readyList(sys, s);
    if (!rs.length) return null;
    const q = policy === 'block' && isReady(sys, s, p) ? p : rs.find((x) => x >= p) ?? rs[0];
    const r = exec(sys, s, q);
    s = r.s; ev = r.ev;
    order.push(q);
    if (order.length < len && badOf(sys, s, ev).some(isBad('bad'))) return null;
    p = policy === 'rr' ? q + 1 : q;
  }
  return { s, ev, order };
}

// 没写 run: 又找不到毛病时：各进程轮流一句一句走
function roundRobin(sys) {
  const order = [];
  let s = initState(sys);
  const max = Math.min(40, sys.temps.reduce((a, T) => a + T.procs.length * T.code.filter((x) => x.op !== 'jmp').length * 2, 0));
  let p = 0;
  while (order.length < max) {
    const rs = readyList(sys, s);
    if (!rs.length) break;
    const q = rs.find((x) => x >= p) ?? rs[0];
    const r = exec(sys, s, q);
    s = r.s;
    order.push(q);
    p = q + 1;
    if (badOf(sys, s, r.ev).some(isBad('bad'))) break;
  }
  return order;
}

// 顺序写短：P P P C → P×3 C
export function scheduleText(sys, order) {
  const out = [];
  for (const p of order) { const last = out.at(-1); if (last && last.p === p) last.n++; else out.push({ p, n: 1 }); }
  return out.map((x) => `${sys.procs[x.p].name}${x.n > 1 ? `×${x.n}` : ''}`).join(' ');
}

// ================= 说明和问题 =================

const names = (sys, ps) => ps.map((p) => sys.procs[p].name).join('、');
function badText(sys, b, s) {
  if (b.kind === 'deadlock') return `**死锁**：${names(sys, b.procs)} 都阻塞着（${b.procs.map((p) => `${sys.procs[p].name} 等 ${s.blk[p]}`).join('，')}），能执行 V 唤醒它们的进程也在等，谁都走不下去。`;
  if (b.kind === 'stuck') return `${names(sys, b.procs)} 永远阻塞在 ${s.blk[b.procs[0]]} 上：别的进程都做完了，没人能唤醒它。`;
  if (b.kind === 'race') return `**${names(sys, b.procs)} 同时在${b.group}里**：互斥被破坏了。`;
  const B = sys.buffer;
  if (b.kind === 'overflow') return `**${B.name}已经满了（${B.cap} 个位置）还往里放**。`;
  if (b.kind === 'underflow') return `**${B.name}是空的，没有东西可取**。`;
  return `**${B.name}里没有${b.item}**，取错了。`;
}

function msgOf(sys, s0, s, ev, bad, before) {
  const pr = sys.procs[ev.p];
  const who = pr.name;
  const text = ev.op === 'guard' ? ev.itext : ev.text;
  const pv = () => {
    if (ev.kind === 'P') return `${text}：${ev.key} 从 ${fmt(ev.before)} 减到 ${fmt(ev.after)}，${ev.blocked ? `${ev.after < 0 ? '小于 0' : '不能往下走'}：${who} **阻塞**，排进 ${ev.key} 的等待队列（${names(sys, s.q[ev.key])}）` : '不小于 0，接着往下走'}`;
    if (ev.kind === 'V') return `${text}：${ev.key} 从 ${fmt(ev.before)} 加到 ${fmt(ev.after)}，${ev.woken !== null && ev.woken !== undefined ? `≤ 0，说明有进程在等：唤醒队头的 ${sys.procs[ev.woken].name}（从阻塞变成就绪，下次轮到它时从 P 后面接着走）` : ev.after > 0 ? '大于 0，没有进程在等' : '没有唤醒谁'}`;
    if (ev.kind === 'set') return `${text}：${ev.var} 从 ${ev.before} 变成 ${ev.after}`;
    let m = text;
    if (ev.buf) {
      const B = sys.buffer;
      if (!ev.buf.err) m += `，${B.name}里现在有 ${ev.buf.n} 个（一共 ${B.cap} 个位置）`;
    }
    return m;
  };
  let m;
  if (ev.op === 'test') m = `${who} 判断 ${ev.text.replace(/^\} /, '')}：${ev.vals.join('，')}，${ev.cond ? '成立' : '不成立'}。`;
  else if (ev.op === 'guard') m = `${who} 执行 if (${codeOf(sys, ev.p)[ev.pc].condText})：${ev.vals.join('，')}，${ev.cond ? `成立，执行 ${pv()}` : `不成立，不执行 ${text}`}。`;
  else m = ev.kind === 'work' ? `${who}：${pv()}。` : `${who} 执行 ${pv()}。`;
  if (ev.done) m += ` ${who} 做完了。`;
  // 新出现的毛病（同时在临界区会一直持续，只在刚出现时说）
  const had = new Set(before.map((b) => `${b.kind}:${b.group || ''}:${(b.procs || []).join(',')}`));
  // 死锁的细节（谁在等谁）在画面下面的提示框里，这里只说一句
  for (const b of bad) if (!had.has(`${b.kind}:${b.group || ''}:${(b.procs || []).join(',')}`)) m += ` ${b.kind === 'deadlock' ? '**死锁了**：所有进程都阻塞着，谁都走不下去。' : badText(sys, b, s)}`;
  return m;
}

// 这一步能问的：会不会阻塞、执行完值是多少、唤醒谁、现在死锁了吗、缓冲区里有几个
function asksOf(sys, s0, s, ev, k, bad) {
  const who = sys.procs[ev.p].name;
  const x = codeOf(sys, ev.p)[ev.pc];
  const y = x.op === 'guard' ? x.inner : x;
  const list = [];
  if (y.op === 'P' || y.op === 'V') {
    const key = ev.key ?? semKey(sys, y.sem, { ...s0.vars, ...sys.procs[ev.p].env });
    const val = { tag: 'value', kind: 'number', q: `第 ${k} 步：${who} 执行 ${ev.text} 以后，${key} 是多少？`, answer: s.sem[key] };
    if (y.op === 'P') {
      const blocked = !!s.blk[ev.p];
      list.push({ tag: 'block', kind: 'choice', q: `第 ${k} 步：${who} 执行 ${ev.text}，会阻塞吗？`, choices: ['会阻塞', '不会阻塞'], answer: blocked ? '会阻塞' : '不会阻塞' }, val);
      if (blocked) list.push({ tag: 'deadlock', kind: 'choice', q: `第 ${k} 步：${who} 阻塞了。现在死锁了吗？`, choices: ['死锁了', '还没有'], answer: bad.some((b) => b.kind === 'deadlock') ? '死锁了' : '还没有' });
    } else {
      const w = ev.woken;
      list.push({ tag: 'wake', kind: 'pick', q: `第 ${k} 步：${who} 执行 ${ev.text}，唤醒谁？在图上点那个进程（谁也不唤醒就点「${NOWAKE}」）。`, answer: w !== null && w !== undefined ? sys.procs[w].name : NOWAKE }, val);
    }
  }
  if (ev.buf && !ev.buf.err) list.push({ tag: 'buffer', kind: 'number', q: `第 ${k} 步：${who} ${ev.text}，${sys.buffer.name}里现在有几${sys.buffer.unit || '个'}？`, answer: ev.buf.n });
  return list.length ? { ask: list[0], ...(list.length > 1 ? { asks: list.slice(1) } : {}) } : {};
}

/** 进程 p 走一句，出一步（说明、能问的问题、画面）。k 是第几步（问题的题面里有，错法比对靠它对上同一步） */
export function pvMove(input, s, p, k) {
  const sys = input.sys;
  const before = badOf(sys, s);
  const { s: ns, ev } = exec(sys, s, p, input.mistake);
  const bad = badOf(sys, ns, ev);
  const step = { view: { st: ns, ev, bad }, msg: msgOf(sys, s, ns, ev, bad, before), ...asksOf(sys, s, ns, ev, k, bad) };
  return { state: ns, step, ev, bad };
}

export const pvStart = (input) => initState(input.sys);

/** 学生自己点的时候：每个进程的样子（名字、状态、下一句） */
export function procInfo(input, s, p) {
  const sys = input.sys;
  const pr = sys.procs[p];
  const code = codeOf(sys, p);
  const env = { ...s.vars, ...pr.env };
  if (s.blk[p]) return { name: pr.name, state: 'blk', text: `阻塞在 ${s.blk[p]}` };
  if (s.pc[p] >= code.length) return { name: pr.name, state: 'done', text: '做完了' };
  let next;
  try { next = insText(sys, p, code[s.pc[p]], env); } catch { next = code[s.pc[p]].text || ''; }
  return { name: pr.name, state: 'ready', text: next };
}

export const pvIntro = (input) => intro(input, '');
function intro(input, how) {
  const sw = input.swapped.map((x) => `${x.name} 的 ${x.pair[0]} 和 ${x.pair[1]} 换了顺序`).join('，');
  return `${input.about ? `${input.about}` : ''}${sw ? `（${sw}。）` : ''}王道的记录型信号量：P(S) 先 S − 1，减完小于 0 就阻塞，排进 S 的等待队列；V(S) 先 S + 1，加完 ≤ 0 就唤醒队头的一个。S 是负数时，|S| 是等着的进程数。${how}`;
}

function run(input) {
  const sys = input.sys;
  let s = initState(sys);
  let order = input.order, plan = null, how;
  if (!order) {
    if (input.run?.search) {
      const r = pvSearch(sys, input.run.search);
      if (!r.found) {
        throw new Error(r.complete
          ? `run: ${input.run.search === 'deadlock' ? 'deadlock：这段代码怎么走都不会死锁' : 'bad：这段代码怎么走都不会出错'}（页面把所有 ${r.states} 种状态都试过了）。要演示就写具体的顺序，如 run: ${sys.procs.slice(0, 2).map((x) => x.name).join(' ')}`
          : `run: 状态太多了（超过 ${MAX_STATES} 种），页面找不完：少几个进程或者把缓冲区改小`);
      }
      order = r.path;
      how = `下面是页面找到的一种最短的${input.run.search === 'deadlock' ? '死锁' : '出错的'}走法：${scheduleText(sys, order)}（每一步是这个进程执行它的下一句）。`;
    } else if (input.run) {
      plan = input.run.items;
      how = `执行顺序：${input.runText}（每一步是这个进程执行它的下一句）。`;
    } else {
      const r = pvSearch(sys, input.find);
      order = r.found ? r.path : roundRobin(sys);
      how = r.found ? `下面是页面找到的一种最短的${input.find === 'deadlock' ? '死锁' : '出错的'}走法：${scheduleText(sys, order)}。` : '下面是各进程轮流一句一句走的一种顺序。';
    }
  } else how = `执行顺序：${scheduleText(sys, order)}。`;
  const steps = [{ view: { st: s, ev: null, bad: [] }, msg: intro(input, how) }];
  const did = [];
  // 轮到的进程走不了：作者写错了顺序（错法算的时候到这里就停）
  const go = (p, it) => {
    if (!isReady(sys, s, p)) {
      if (input.mistake) return false;
      const rs = readyList(sys, s);
      throw new Error(`run: 第 ${did.length + 1} 步${it ? `（${it.src}）` : ''}要 ${sys.procs[p].name} 走，可它${s.blk[p] ? `阻塞在 ${s.blk[p]} 上` : '已经做完了'}${rs.length ? `（这时能走的：${names(sys, rs)}）` : '（这时已经没有进程能走了）'}`);
    }
    const r = pvMove(input, s, p, did.length + 1);
    s = r.state;
    steps.push(r.step);
    did.push(p);
    return true;
  };
  if (order) { for (const p of order) if (!go(p)) break; }
  else {
    outer: for (const it of plan) {
      if (it.n === 'plus') {
        if (!go(it.p, it)) break;
        for (let c = 1; isReady(sys, s, it.p); c++) {
          if (c >= PLUS_CAP) { if (input.mistake) break outer; throw new Error(`run: ${it.src} 走了 ${PLUS_CAP} 句 ${sys.procs[it.p].name} 也没有阻塞：写成 ${sys.procs[it.p].name}×几`); }
          go(it.p, it);
        }
      } else for (let c = 0; c < it.n; c++) if (!go(it.p, it)) break outer;
    }
  }
  return { steps, order: did, final: s };
}

// ================= 画 =================

const ST_TEXT = { ready: '就绪', run: '运行', done: '完成' };
function view(v, input) {
  const sys = input.sys;
  const s = v.st, ev = v.ev;
  const n = sys.procs.length;
  const stOf = (p) => (s.blk[p] ? 'blk' : s.pc[p] >= codeOf(sys, p).length ? 'done' : ev && ev.p === p ? 'run' : 'ready');
  const cards = sys.temps.map((T, ti) => {
    const here = {};
    for (const p of T.procs) { const x = T.code[s.pc[p]]; if (x) (here[x.line] ||= []).push(p); }
    const chips = T.procs.map((p) => { const st = stOf(p); return `<span class="pv-proc pv-${st}" data-pick="${esc(sys.procs[p].name)}" data-cmd="${p + 1}" data-label="${esc(sys.procs[p].name)}"><b>${esc(sys.procs[p].name)}</b><small>${st === 'blk' ? `阻塞 · ${esc(s.blk[p])}` : ST_TEXT[st]}</small></span>`; }).join('');
    const lines = T.lines.map((L, li) => {
      const ps = here[li] || [];
      const cls = ['pv-line', ev && ev.t === ti && ev.line === li ? 'pv-ran' : '', ps.some((p) => s.blk[p]) ? 'pv-blkline' : '', L.step ? '' : 'pv-brace'].filter(Boolean).join(' ');
      const mks = ps.map((p) => `<span class="pv-mk${s.blk[p] ? ' pv-mk-blk' : ''}" data-key="pv-m${p}">${T.procs.length > 1 ? esc(sys.procs[p].name) : '◀'}</span>`).join('');
      const cs = L.cs ? `<em class="pv-cs">// 临界区${L.cs === 's' ? '（读）' : ''}</em>` : '';
      return `<span class="${cls}"><span class="pv-txt" style="padding-left:${(L.depth * 1.3).toFixed(1)}em">${esc(L.text)}${cs}</span>${mks ? `<span class="pv-mks">${mks}</span>` : ''}</span>`;
    }).join('');
    return `<div class="pv-card${ev && ev.t === ti ? ' pv-card-on' : ''}"><div class="pv-head">${T.label ? `<span class="pv-tname">${esc(T.label)}</span>` : ''}${chips}</div><pre class="pv-code">${lines}</pre></div>`;
  }).join('');
  const rows = sys.keys.map((key, j) => {
    const chg = ev && ev.key === key && (ev.kind === 'P' || ev.kind === 'V');
    const q = s.q[key].length ? s.q[key].map((p) => `<span class="pv-qp" data-key="pv-q${p}">${esc(sys.procs[p].name)}</span>`).join('<i>←</i>') : '<span class="muted">—</span>';
    return `<tr data-cmd="${n + j + 1}" data-label="${esc(key)}"${chg ? ' class="pv-chg sv-new"' : ''}><td><b>${esc(key)}</b></td><td class="pv-val${s.sem[key] < 0 ? ' pv-neg' : ''}">${fmt(s.sem[key])}</td><td class="pv-q">${q}</td></tr>`;
  }).join('');
  let side = `<div class="sv-gtbl-wrap"><table class="sv-gtbl sv-tab pv-sems"><thead><tr><th>信号量</th><th>值</th><th>等待队列<small>队头在左</small></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  if (sys.buffer) {
    const B = sys.buffer;
    const cells = [];
    for (let i = 0; i < Math.max(B.cap, s.buf.length); i++) {
      const x = s.buf[i];
      cells.push(`<span class="pv-slot${x !== undefined ? ' pv-full' : ''}${i >= B.cap ? ' pv-over' : ''}">${x === undefined ? '' : esc(x || '●')}</span>`);
    }
    side += `<div class="pv-buf${ev?.buf ? ' pv-chg' : ''}"><span class="pv-buf-h">${esc(B.name)}</span><span class="pv-slots">${cells.join('')}</span><span class="pv-buf-n">${s.buf.length} / ${B.cap}</span></div>`;
  }
  if (sys.varNames.length) side += `<div class="pv-vars">${sys.varNames.map((x) => `<span class="pv-var${ev?.kind === 'set' && ev.var === x ? ' pv-chg sv-new' : ''}"><b>${esc(x)}</b> ${fmt(s.vars[x])}</span>`).join('')}</div>`;
  side += `<div class="pv-nowake-row"><span class="pv-nowake" data-pick="${NOWAKE}">${NOWAKE}</span><span class="muted">V 谁也不唤醒时点这里</span></div>`;
  const alerts = (v.bad || []).map((b) => `<div class="pv-alert pv-al-${b.kind}">${badHtml(sys, b, s)}</div>`).join('');
  return `<div class="pv"><div class="pv-procs">${cards}</div><div class="pv-side">${side}</div></div>${alerts}`;
}
const badHtml = (sys, b, s) => esc(badText(sys, b, s).replace(/\*\*/g, ''));

// ================= 考卷 =================

// 有 run:：走完以后各信号量的值；没有：会不会死锁（find: bad 时问会不会出错）
function quiz(input, r) {
  const sys = input.sys;
  const qhtml = view({ st: initState(sys), ev: null, bad: [] }, input);
  if (input.run) {
    const text = input.run.search ? scheduleText(sys, r.order) : input.runText;
    return { q: `按 ${text} 的顺序执行（每个名字是这个进程执行它的下一句），走完以后 ${sys.keys.join('、')} 各是多少？按这个顺序写，用空格隔开（负数写成 -1）。`, qhtml, type: 'seq', answer: sys.keys.map((k) => r.final.sem[k]).join(' ') };
  }
  const res = pvSearch(sys, input.find);
  if (!res.complete) throw new Error(`状态太多了（超过 ${MAX_STATES} 种），页面判断不了：少几个进程或者把缓冲区改小`);
  const what = input.find === 'deadlock' ? '死锁' : '出错（死锁、两个进程同时进临界区、缓冲区满了还放 / 空了还取）';
  return {
    q: `这几个进程并发执行，执行顺序任意。有没有可能${what}？写「会」或「不会」。`, qhtml, type: 'seq',
    answer: res.found ? '会 | 能 | 可能 | 有可能 | 会死锁' : '不会 | 不能 | 不可能 | 不会死锁',
    explain: res.found ? `会：比如按 ${scheduleText(sys, res.path)} 的顺序走（页面找到的最短的一种），${res.bad.map((b) => badText(sys, b, replay(sys, res.path)).replace(/\*\*/g, '')).join('')}` : `不会：页面把所有 ${res.states} 种可能的状态都走了一遍，哪一种都没有${input.find === 'deadlock' ? '死锁' : '出错'}。`,
  };
}
function replay(sys, order) { let s = initState(sys); for (const p of order) s = exec(sys, s, p).s; return s; }

// 考卷上那张表：每个 P / V（和改共享变量）之后各信号量的值
function table(input, r) {
  const sys = input.sys;
  const head = [...sys.keys, ...sys.varNames];
  const rows = [];
  r.steps.forEach((st, k) => {
    const ev = st.view.ev;
    if (!k || !ev) return;
    const op = ev.op === 'guard' ? ev.innerOp : ev.op;
    if (!['P', 'V', 'set'].includes(op)) return;
    if (op === 'set' && !sys.varNames.length) return;
    rows.push({ label: `${k}. ${sys.procs[ev.p].name}：${ev.text}`, cells: head.map((h) => ({ v: String(sys.keys.includes(h) ? st.view.st.sem[h] : st.view.st.vars[h]), num: true })) });
  });
  // 第一行是开始时的值（直接给出），第 1 步也能「照抄」
  const s0 = initState(sys);
  if (rows.length) rows.unshift({ label: '开始', cells: head.map((h) => ({ v: String(sys.keys.includes(h) ? s0.sem[h] : s0.vars[h]), given: true })) });
  const text = input.run && !input.run.search ? input.runText : scheduleText(sys, r.order);
  return { q: `按 ${text} 的顺序执行，填出每一步之后各信号量${sys.varNames.length ? '和变量' : ''}的值（没变的点「照抄」；负数写成 -1）。`, qhtml: view({ st: initState(sys), ev: null, bad: [] }, input), dir: 'row', head, rows, copy: true };
}

// 常见错法（只给老师看）：照同一个执行顺序，用错的口径再算一遍；答案和对的一样的不列
export const MISTAKES = [
  ['nonneg', '像是按「信号量不会变成负数」算的：值是 0 时 P 直接阻塞、不再减 1（王道的记录型信号量：P 先减 1，减完小于 0 才阻塞，负数的绝对值是等着的进程数）'],
  ['le', '像是把「减 1 以后等于 0」也当成阻塞了（王道：P 减 1 以后小于 0 才阻塞）'],
  ['noWake', '像是 V 只加了 1，没去唤醒等着的进程（王道：V 加 1 以后 ≤ 0，说明有进程在等，要唤醒一个）'],
  ['wakeLt', '像是 V 加 1 以后等于 0 时没唤醒（王道：加完 ≤ 0 就要唤醒，等于 0 说明刚好有一个在等）'],
  ['lifo', '像是 V 唤醒了最后一个排队的（王道：唤醒等待队列的队头，先排的先醒）'],
];
function sig(input, r) {
  const asks = r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean).map((a) => [a.q, a.answer]);
  let qz = null, t = null;
  if (input.run) { try { qz = quiz(input, r).answer; } catch { /* */ } }
  try { t = table(input, r).rows.map((row) => row.cells.map((c) => c.v)); } catch { /* */ }
  return JSON.stringify([asks, qz, t]);
}
function variants(input) {
  const base = run(input);
  const right = sig(input, base);
  const out = [];
  for (const [mistake, label] of MISTAKES) {
    const v = { ...input, mistake, order: base.order };
    try { if (sig(v, run(v)) !== right) out.push({ label, input: v }); } catch { /* 这组数上算不了 */ }
  }
  return out;
}

function problems(input, r) {
  const sys = input.sys;
  const out = [];
  const all = sys.temps.flatMap((T) => T.code.map((x) => (x.op === 'guard' ? x.inner : x)));
  if (sys.buffer && !all.some((x) => x.buf)) out.push('写了 buffer:，代码里却没有放入 / 取出缓冲区的句子（页面按「放入」「取出」这些字认）');
  for (const name of input.unused) out.push(`信号量 ${name} 声明了，代码里没有用到`);
  if (input.run && !input.run.search && !r.steps.some((s) => s.view.ev && ['P', 'V'].includes(s.view.ev.kind))) out.push('run: 走的这几步里没有 P、V 操作');
  return out;
}

export const pvEngine = { name: 'pv', title: '信号量 P/V', head, parse, run, view, quiz, table, variants, problems };
