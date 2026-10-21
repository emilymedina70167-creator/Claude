// 栈的应用（组件 stack）：中缀转后缀、后缀表达式求值、括号匹配、出栈序列合不合法、n 个元素的出栈序列有几种（卡特兰数）。
// 一律按王道 3.3 的口径：中缀转后缀时运算符先弹出栈里优先级「高于或等于」它的，碰到 ( 或栈空停；后缀求值先弹出的是右操作数。
// 纯函数，不碰 DOM（tests/stack-engine.test.js）。
import { Frac } from '../linalg.js';
import { esc, chips } from './arrayview.js';
import { stackView, seqView, tapeView, vecCell, EMPTY_ALTS } from './linearview.js';

const has = (fields, k) => fields[k] !== undefined && String(fields[k]).trim() !== '';
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '×': 2, '÷': 2, '%': 2 };
const OPS = Object.keys(PREC);

export function parse(fields) {
  const modes = ['infix', 'postfix', 'brackets', 'push', 'count'].filter((k) => has(fields, k));
  if (!modes.length) {
    if (has(fields, 'pop')) throw new Error('pop: 要配 push:（入栈序列），如 push: 1 2 3 4 和 pop: 3 2 4 1');
    throw new Error('stack 要写 infix:（中缀转后缀）、postfix:（后缀表达式求值）、brackets:（括号匹配）、push: 加 pop:（出栈序列合不合法）或 count:（n 个元素有几种出栈序列）中的一个');
  }
  if (modes.length > 1) throw new Error(`stack 一次演示一种，现在写了 ${modes.map((k) => `${k}:`).join('、')}`);
  const mode = modes[0];
  if (mode === 'infix') return { mode, toks: parseInfix(fields.infix) };
  if (mode === 'postfix') return { mode, toks: parsePostfix(fields.postfix) };
  if (mode === 'brackets') return { mode, chars: parseBrackets(fields.brackets) };
  if (mode === 'count') {
    const n = Number(String(fields.count).trim());
    if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error(`count: 写元素个数 n（1～12 的整数），现在是「${fields.count}」`);
    return { mode, n };
  }
  const push = seqItems(fields.push, 'push');
  if (!has(fields, 'pop')) throw new Error('push: 要配 pop:（要判断的出栈序列），如 pop: 3 2 4 1');
  const pop = seqItems(fields.pop, 'pop');
  if (push.length > 10) throw new Error('push: 最多 10 个元素');
  if (new Set(push).size !== push.length) throw new Error('push: 里的元素不能重复（不然分不清出栈的是哪一个）');
  const a = [...push].sort().join(' '), b = [...pop].sort().join(' ');
  if (a !== b) throw new Error(`pop: 的元素要和 push: 一样，只是顺序不同（push 是 ${push.join(' ')}，pop 是 ${pop.join(' ')}）`);
  return { mode: 'legal', push, pop };
}

const seqItems = (src, name) => {
  const t = String(src ?? '').trim().split(/[\s,，、]+/).filter(Boolean);
  if (!t.length) throw new Error(`${name}: 写一串元素，空格隔开`);
  return t;
};

// 表达式拆成一个个符号：操作数（字母开头的名字、数）、运算符、括号。全角的括号、运算符也认
function lex(src, name) {
  const s = String(src ?? '').replace(/（/g, '(').replace(/）/g, ')').replace(/＋/g, '+').replace(/[－−–]/g, '-').replace(/＊/g, '*').replace(/／/g, '/');
  const out = [];
  const re = /\s*(?:([A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?)|([+\-*/×÷%])|([()]))/y;
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new Error(`${name}: 看不懂「${s.slice(i, i + 6)}」（能写的：字母或数、+ - * / × ÷ %、括号）`);
    out.push(m[1] !== undefined ? { t: m[1], type: 'opd' } : m[2] !== undefined ? { t: m[2], type: 'op' } : { t: m[3], type: m[3] });
    i = re.lastIndex;
  }
  return out.map((x, k) => ({ ...x, k }));
}

function parseInfix(src) {
  const toks = lex(src, 'infix');
  if (toks.length > 30) throw new Error('infix: 最多 30 个符号');
  // 检查是不是合法的中缀：操作数 / ( 和 运算符 / ) 交替；括号配对
  let want = 'opd', depth = 0;
  for (const x of toks) {
    if (want === 'opd') {
      if (x.type === '(') { depth++; continue; }
      if (x.type !== 'opd') throw new Error(`infix: 第 ${x.k + 1} 个符号「${x.t}」前面少了操作数`);
      want = 'op';
    } else {
      if (x.type === ')') { if (--depth < 0) throw new Error(`infix: 第 ${x.k + 1} 个符号「)」多了，前面没有配对的「(」`); continue; }
      if (x.type !== 'op') throw new Error(`infix: 第 ${x.k + 1} 个符号「${x.t}」前面少了运算符`);
      want = 'opd';
    }
  }
  if (!toks.length || want === 'opd') throw new Error('infix: 表达式要以操作数（或右括号）结尾');
  if (depth > 0) throw new Error('infix: 有「(」没有配对的「)」');
  return toks;
}

function parsePostfix(src) {
  const toks = lex(src, 'postfix');
  if (toks.some((x) => x.type === '(' || x.type === ')')) throw new Error('postfix: 后缀表达式里没有括号');
  if (toks.some((x) => x.type === 'opd' && !/^\d/.test(x.t))) throw new Error('postfix: 要求值，操作数要写数（数之间用空格隔开，如 1 2 3 * + 4 -）');
  if (toks.length > 30) throw new Error('postfix: 最多 30 个符号');
  let depth = 0;
  for (const x of toks) {
    if (x.type === 'opd') depth++;
    else if (depth < 2) throw new Error(`postfix: 读到第 ${x.k + 1} 个符号「${x.t}」时栈里不到两个数，这不是合法的后缀表达式（数之间要用空格隔开）`);
    else depth--;
  }
  if (depth !== 1) throw new Error(`postfix: 读完以后栈里剩 ${depth} 个数（应该正好剩 1 个），少了运算符`);
  return toks;
}

const PAIR = { ')': '(', ']': '[', '}': '{' };
function parseBrackets(src) {
  const s = String(src ?? '').replace(/（/g, '(').replace(/）/g, ')').replace(/【/g, '[').replace(/】/g, ']').replace(/｛/g, '{').replace(/｝/g, '}').replace(/\s+/g, '');
  const chars = [...s];
  if (!chars.some((c) => '()[]{}'.includes(c))) throw new Error('brackets: 写一串括号，如 {[()()]}（别的字符会跳过）');
  if (chars.length > 30) throw new Error('brackets: 最多 30 个字符');
  return chars;
}

// —— 中缀转后缀：一步（读一个符号）。mistake：eqNoPop 同优先级不弹；parenOut 右括号弹栈时把 ( 也写进了后缀 ——
function infixStep(st, tok, mistake) {
  const stack = st.stack.slice(), out = st.out.slice(), popped = [];
  if (tok.type === 'opd') out.push(tok);
  else if (tok.type === '(') stack.push(tok);
  else if (tok.type === ')') {
    while (stack.length && stack.at(-1).type !== '(') { const x = stack.pop(); out.push(x); popped.push(x); }
    const l = stack.pop();
    if (mistake === 'parenOut' && l) out.push(l);
  } else {
    const p = PREC[tok.t];
    while (stack.length && stack.at(-1).type === 'op' && (mistake === 'eqNoPop' ? PREC[stack.at(-1).t] > p : PREC[stack.at(-1).t] >= p)) { const x = stack.pop(); out.push(x); popped.push(x); }
    stack.push(tok);
  }
  return { stack, out, popped };
}
const flush = (st) => ({ stack: [], out: [...st.out, ...st.stack.slice().reverse()], popped: st.stack.slice().reverse() });
const txt = (xs) => xs.map((x) => x.t).join(' ');
const topText = (stack) => (stack.length ? stack.at(-1).t : '栈空');

function runInfix(input) {
  const { toks, mistake } = input;
  const steps = [];
  const depth = maxDepth(toks);
  const ops = [...new Set(toks.filter((x) => x.type === 'op').map((x) => x.t))];
  const topChoices = [...ops, ...(toks.some((x) => x.type === '(') ? ['('] : []), '栈空'];
  const v = (at, st, extra = {}) => ({ at, stack: st.stack, out: st.out, depth, ...extra });
  steps.push({ view: v(-1, { stack: [], out: [] }), msg: '从左往右一个个读：**操作数**直接写进后缀表达式；**(** 入栈；**)** 把栈里的运算符依次弹出写进后缀，直到弹出 (（括号不写）；**运算符**先把栈里优先级**高于或等于**它的依次弹出写进后缀（碰到 ( 或栈空就停），再入栈。读完把栈里剩下的依次弹出。' });
  let st = { stack: [], out: [] };
  // 正确的过程一直往下走；有错法时，每一问的答案是「在正确的上一步上按错法走这一步」（学生看着的是正确的画面）
  let wrong = { stack: [], out: [] }; // 从头到尾都按错法走的（读完以后问的整串用它）
  const rows = [];
  for (const tok of toks) {
    const before = st;
    const next = infixStep(before, tok, null);
    const mine = mistake ? infixStep(before, tok, mistake) : next;
    if (mistake) wrong = infixStep(wrong, tok, mistake);
    const n = tok.k + 1;
    const asks = [];
    if (tok.type === 'op' || tok.type === ')') {
      asks.push({ tag: 'out', kind: 'text', q: `读完第 ${n} 个符号「${tok.t}」之后，后缀表达式写到了哪儿？（写出目前的整串）`, answer: txt(mine.out) });
      asks.push({ tag: 'top', kind: 'choice', q: `处理完第 ${n} 个符号「${tok.t}」之后，栈顶是？`, choices: topChoices, answer: topText(mine.stack) });
    }
    if (tok.type === 'op') {
      // 能弹出的：栈顶往下连着的运算符，碰到 ( 或栈底为止
      const run = [];
      for (let i = before.stack.length - 1; i >= 0 && before.stack[i].type === 'op'; i--) run.push(before.stack[i].t);
      if (run.length) {
        const choices = ['不弹出', ...run.map((_, m) => `弹出 ${run.slice(0, m + 1).join('、')}`)];
        asks.push({ tag: 'pop', kind: 'choice', q: `读到第 ${n} 个符号「${tok.t}」：要从栈里弹出哪些写进后缀？`, choices, answer: choices[mine.popped.length] });
      }
    }
    st = next;
    rows.push({ label: `读入 ${tok.t}`, stack: txt((mistake ? wrong : st).stack).replace(/ /g, ''), out: txt((mistake ? wrong : st).out) });
    steps.push({ view: v(tok.k, st, { fresh: freshKeys(before, st) }), msg: infixMsg(tok, before, st), ...(asks.length ? { ask: asks[0], asks: asks.slice(1) } : {}) });
  }
  const before = st;
  st = flush(st);
  const fin = mistake ? flush(wrong) : st;
  rows.push({ label: '读完', stack: '', out: txt(fin.out) });
  steps.push({
    view: v(toks.length, st, { fresh: freshKeys(before, st), done: true }),
    msg: before.stack.length ? `表达式读完了：把栈里剩下的 ${before.stack.slice().reverse().map((x) => x.t).join('、')} 依次弹出写进后缀。后缀表达式是 **${txt(st.out)}**。` : `表达式读完了，栈已经空了。后缀表达式是 **${txt(st.out)}**。`,
    ask: { tag: 'out', kind: 'text', q: '表达式读完了，把栈里剩下的依次弹出：最后的后缀表达式是？', answer: txt(fin.out) },
  });
  return { steps, rows, result: txt(fin.out) };
}
const maxDepth = (toks) => { let st = { stack: [], out: [] }, d = 0; for (const t of toks) { st = infixStep(st, t, null); d = Math.max(d, st.stack.length); } return d; };
const freshKeys = (a, b) => { const old = new Set([...a.stack, ...a.out].map((x) => x.k)); return [...b.stack, ...b.out].filter((x) => !old.has(x.k)).map((x) => x.k).concat(b.out.filter((x) => a.stack.includes(x)).map((x) => x.k)); };
function infixMsg(tok, before, after) {
  const c = `「${tok.t}」`;
  if (tok.type === 'opd') return `读到操作数${c}：直接写进后缀表达式。`;
  if (tok.type === '(') return `读到${c}：直接入栈（它像一道隔板，后面的运算符弹栈时到它为止）。`;
  if (tok.type === ')') return `读到${c}：把栈里的${after.popped.length ? ` ${after.popped.map((x) => x.t).join('、')} 依次弹出写进后缀，` : '运算符依次弹出（这次没有运算符），'}直到弹出「(」；括号不写进后缀。`;
  const p = PREC[tok.t];
  const top = before.stack.at(-1);
  const stop = after.stack.length > 1 ? after.stack.at(-2) : null;
  const why = !before.stack.length ? '栈是空的，不用弹' : top.type === '(' ? '栈顶是「(」，停' : after.popped.length
    ? `栈顶${after.popped.map((x) => `「${x.t}」`).join('')}的优先级 ≥ ${c}，依次弹出写进后缀${stop ? (stop.type === '(' ? '；碰到「(」，停' : `；「${stop.t}」比${c}低，停`) : '；栈空了，停'}`
    : `栈顶「${top.t}」的优先级比${c}低，不弹`;
  return `读到运算符${c}：${why}。然后${c}入栈。`;
}

// —— 后缀表达式求值。mistake：swap 减法 / 除法的两个操作数弄反；noPush 算完没把结果压回栈 ——
const fracText = (f) => f.toString();
const apply = (op, a, b) => {
  if ((op === '/' || op === '÷' || op === '%') && b.isZero()) throw new Error('postfix: 除数是 0');
  if (op === '+') return a.add(b);
  if (op === '-') return a.sub(b);
  if (op === '*' || op === '×') return a.mul(b);
  if (op === '%') { if (a.d !== 1 || b.d !== 1) throw new Error('postfix: % 只能对整数取余'); return new Frac(a.n % b.n); }
  return a.div(b);
};
const OPNAME = { '+': '+', '-': '−', '*': '×', '×': '×', '/': '÷', '÷': '÷', '%': 'mod' };

function runPostfix(input) {
  const { toks, mistake } = input;
  const steps = [];
  const depth = Math.max(...toks.reduce((acc, x) => { const d = (acc.at(-1) ?? 0) + (x.type === 'opd' ? 1 : -1); return [...acc, d]; }, []));
  let stack = []; // [{ v: Frac, key }]
  let wrong = []; // 按错法从头走的（noPush 走不下去时为 null）
  const rows = [];
  steps.push({ view: { at: -1, stack: [], depth }, msg: '后缀表达式从左往右读：**数**入栈；**运算符**就从栈里弹出两个数——**先弹出的是右操作数**，后弹出的是左操作数——算出来再压回栈。读完以后栈里只剩一个数，就是结果。' });
  let id = 0;
  for (const tok of toks) {
    const n = tok.k + 1;
    if (tok.type === 'opd') {
      stack = [...stack, { v: Frac.from(tok.t), key: `p${id++}` }];
      if (wrong) wrong = [...wrong, { v: Frac.from(tok.t) }];
      rows.push({ label: `读入 ${tok.t}`, stack: (mistake ? wrong : stack)?.map((x) => fracText(x.v)) ?? null });
      steps.push({ view: { at: tok.k, stack, depth, fresh: [stack.at(-1).key] }, msg: `读到数 ${tok.t}：入栈。` });
      continue;
    }
    const b = stack.at(-1), a = stack.at(-2);
    const val = apply(tok.t, a.v, b.v);
    // 这一步按错法会得到的栈顶（在正确的上一步上走）
    let mine = val;
    if (mistake === 'swap' && ['-', '/', '÷', '%'].includes(tok.t)) mine = apply(tok.t, b.v, a.v);
    if (mistake === 'noPush') mine = stack.length > 2 ? stack.at(-3).v : null;
    if (wrong) {
      if (mistake === 'noPush') wrong = wrong.length >= 2 ? wrong.slice(0, -2) : null;
      else { const y = wrong.at(-1).v, x = wrong.at(-2).v; let r; try { r = mistake === 'swap' && ['-', '/', '÷', '%'].includes(tok.t) ? apply(tok.t, y, x) : apply(tok.t, x, y); } catch { r = null; } wrong = r ? [...wrong.slice(0, -2), { v: r }] : null; }
      if (wrong && !wrong.length && mistake === 'noPush') wrong = null;
    }
    stack = [...stack.slice(0, -2), { v: val, key: `p${id++}` }];
    rows.push({ label: `读入 ${tok.t}`, stack: (mistake ? wrong : stack)?.map((x) => fracText(x.v)) ?? null });
    const ask = mine === null ? null : { tag: 'top', kind: 'number', q: `读到第 ${n} 个符号「${tok.t}」：算完压回栈以后，栈顶是多少？`, answer: mine.valueOf(), display: fracText(mine) };
    steps.push({
      view: { at: tok.k, stack, depth, fresh: [stack.at(-1).key], calc: `${fracText(a.v)} ${OPNAME[tok.t]} ${fracText(b.v)} = ${fracText(val)}` },
      msg: `读到运算符「${tok.t}」：先弹出 ${fracText(b.v)}（右操作数），再弹出 ${fracText(a.v)}（左操作数），算 ${fracText(a.v)} ${OPNAME[tok.t]} ${fracText(b.v)} = ${fracText(val)}，压回栈。`,
      ...(ask ? { ask } : {}),
    });
  }
  const value = stack[0].v;
  const fin = mistake ? (wrong && wrong.length === 1 ? wrong[0].v : null) : value;
  steps.push({
    view: { at: toks.length, stack, depth, done: true },
    msg: `读完了，栈里只剩一个数 **${fracText(value)}**，就是表达式的值。`,
    ...(fin ? { ask: { tag: 'value', kind: 'number', q: '读完以后，表达式的值是多少？', answer: fin.valueOf(), display: fracText(fin) } } : {}),
  });
  return { steps, rows, value: fin, result: fin ? fracText(fin) : null };
}

// —— 括号匹配。mistake：typeBlind 只数个数、不看种类；noEmptyCheck 读完没看栈空不空 ——
function runBrackets(input) {
  const { chars, mistake } = input;
  const steps = [];
  const br = chars.map((c, i) => ({ c, i })).filter((x) => '()[]{}'.includes(x.c));
  const depth = (() => { let d = 0, m = 0; for (const x of br) { if (PAIR[x.c]) d = Math.max(0, d - 1); else m = Math.max(m, ++d); } return m; })();
  const matched = {};
  const v = (at, stack, extra = {}) => ({ at, stack, depth, matched: { ...matched }, ...extra });
  steps.push({ view: v(-1, []), msg: '从左往右读：**左括号**入栈；**右括号**就看栈顶——是配对的左括号就弹出（这一对配上了），栈空或配不上就是不匹配，停下。读完以后**栈也要是空的**才算匹配（不然左括号多了）。' + (br.length < chars.length ? '括号以外的字符跳过。' : '') });
  let stack = [];
  let ok = true, why = '';
  const rows = [];
  for (const x of br) {
    const n = x.i + 1;
    if (!PAIR[x.c]) {
      stack = [...stack, x];
      rows.push({ label: `读入 ${x.c}`, stack: stack.map((y) => y.c).join('') });
      steps.push({ view: v(x.i, stack, { fresh: [x.i] }), msg: `读到左括号「${x.c}」：入栈。` });
      continue;
    }
    const top = stack.at(-1);
    const fits = !!top && top.c === PAIR[x.c];
    const mineFits = mistake === 'typeBlind' ? !!top : fits;
    const ask = { tag: 'match', kind: 'choice', q: `读到第 ${n} 个字符「${x.c}」：${top ? `和栈顶的「${top.c}」` : '栈是空的，'}配得上吗？`, choices: ['配得上，弹出栈顶', '配不上，不匹配'], answer: mineFits ? '配得上，弹出栈顶' : '配不上，不匹配' };
    if (fits) {
      stack = stack.slice(0, -1);
      matched[top.i] = matched[x.i] = true;
      rows.push({ label: `读入 ${x.c}`, stack: stack.map((y) => y.c).join('') });
      steps.push({ view: v(x.i, stack), msg: `读到右括号「${x.c}」：栈顶是「${top.c}」，配上了，弹出。`, ask });
      continue;
    }
    ok = false;
    why = top ? `读到「${x.c}」时栈顶是「${top.c}」，配不上` : `读到「${x.c}」时栈是空的，右括号多了`;
    rows.push({ label: `读入 ${x.c}`, stack: '', stop: true });
    steps.push({ view: v(x.i, stack, { bad: x.i, badTop: top?.i }), msg: `读到右括号「${x.c}」：${top ? `栈顶是「${top.c}」，不是「${PAIR[x.c]}」` : '栈是空的，没有左括号和它配'}——**不匹配**，停下。`, ask });
    break;
  }
  if (ok && stack.length) { ok = false; why = `读完了栈里还剩 ${stack.map((y) => `「${y.c}」`).join('')}，左括号多了`; }
  // 按错法从头走一遍得出的结论
  const mineOk = mistake ? judgeBrackets(chars, mistake) : ok;
  steps.push({
    view: v(chars.length, stack, { done: true, ok }),
    msg: ok ? '读完了，栈也空了：每个右括号都配上了，**匹配**。' : `结论：**不匹配**（${why}）。`,
    ask: { tag: 'result', kind: 'choice', q: '这串括号匹配吗？', choices: ['匹配', '不匹配'], answer: mineOk ? '匹配' : '不匹配' },
  });
  // 填表：没读到的（不匹配停下以后）空着
  for (const x of br.slice(rows.length)) rows.push({ label: `读入 ${x.c}`, stack: '' });
  return { steps, rows: mistake ? bracketRows(br, mistake) : rows, ok: mineOk, result: mineOk ? '匹配' : '不匹配' };
}
// 按错法从头走一遍的表（错法只看个数时，配不上的种类也弹）
function bracketRows(br, mistake) {
  const st = [], rows = [];
  let stop = false;
  for (const x of br) {
    if (stop) { rows.push({ label: `读入 ${x.c}`, stack: '' }); continue; }
    if (!PAIR[x.c]) st.push(x.c);
    else if (st.length && (mistake === 'typeBlind' || st.at(-1) === PAIR[x.c])) st.pop();
    else { stop = true; rows.push({ label: `读入 ${x.c}`, stack: '' }); continue; }
    rows.push({ label: `读入 ${x.c}`, stack: st.join('') });
  }
  return rows;
}
function judgeBrackets(chars, mistake) {
  const st = [];
  for (const c of chars) {
    if ('([{'.includes(c)) st.push(c);
    else if (PAIR[c]) { if (!st.length || (mistake !== 'typeBlind' && st.at(-1) !== PAIR[c])) return false; st.pop(); }
  }
  return mistake === 'noEmptyCheck' || !st.length;
}

// —— 出栈序列合不合法：照着出栈序列模拟（要出的不在栈顶就接着入栈，入栈序列用完了还不在栈顶就不合法）——
// mistake：reverseOnly 以为只有倒过来才合法；queueLike 当成了先进先出（和入栈一样才合法）
function runLegal(input) {
  const { push, pop, mistake } = input;
  const steps = [];
  let i = 0, stack = [], out = [];
  const legal = simulateLegal(push, pop);
  const mineLegal = mistake === 'reverseOnly' ? pop.join(' ') === push.slice().reverse().join(' ') : mistake === 'queueLike' ? pop.join(' ') === push.join(' ') : legal;
  const v = (extra = {}) => ({ push, pop, i, stack: stack.slice(), out: out.slice(), ...extra });
  steps.push({ view: v(), msg: `入栈序列 ${push.join(' ')}（按这个顺序入栈，中间随时可以出栈）。照着出栈序列 ${pop.join(' ')} 一个个来：要出栈的在栈顶就出栈；不在栈顶，就把入栈序列里的接着入栈，直到它到栈顶；它被压在栈里面、又不在栈顶，就**不合法**。` });
  const rows = [];
  let first = true;
  const opAsk = (target) => {
    const choices = [...(i < push.length ? [`入栈 ${push[i]}`] : []), ...(stack.length ? [`出栈 ${stack.at(-1)}`] : []), '不合法，停下'];
    const answer = stack.at(-1) === target ? `出栈 ${target}` : i < push.length && !stack.includes(target) ? `入栈 ${push[i]}` : '不合法，停下';
    return { tag: 'op', kind: 'choice', q: `现在要让 ${target} 出栈${stack.length ? `（栈顶是 ${stack.at(-1)}）` : '（栈是空的）'}：下一步做什么？`, choices, answer };
  };
  const legalAsk = () => ({ tag: 'legal', kind: 'choice', q: `入栈序列 ${push.join(' ')}，出栈序列 ${pop.join(' ')} 合法吗？`, choices: ['合法', '不合法'], answer: mineLegal ? '合法' : '不合法' });
  const withAsks = (step, target) => { const a = opAsk(target); if (first) { first = false; return { ...step, ask: legalAsk(), asks: [a] }; } return { ...step, ask: a }; };
  for (let p = 0; p < pop.length; p++) {
    const target = pop[p];
    const pushed = [];
    while (stack.at(-1) !== target && i < push.length && !stack.includes(target)) {
      const s = withAsks({}, target);
      pushed.push(push[i]);
      stack.push(push[i++]);
      steps.push({ view: v({ want: p, fresh: [stack.at(-1)] }), msg: `要出栈的是 ${target}，${stack.length > 1 ? `栈顶是 ${stack.at(-2)}，` : ''}还不在栈顶：把 ${stack.at(-1)} 入栈。`, ...s });
    }
    if (stack.at(-1) !== target) {
      const s = withAsks({}, target);
      steps.push({ view: v({ want: p, bad: target }), msg: `要出栈的是 ${target}，可它被压在栈里面（栈顶是 ${stack.at(-1)}），后进的 ${stack.at(-1)} 必须先出：**不合法**。`, ...s });
      rows.push({ label: `${target} 出栈`, pushed: null });
      for (let q = p + 1; q < pop.length; q++) rows.push({ label: `${pop[q]} 出栈`, pushed: null });
      break;
    }
    const s = withAsks({}, target);
    stack.pop();
    out.push(target);
    rows.push({ label: `${target} 出栈`, pushed, after: stack.slice() });
    steps.push({ view: v({ want: p + 1, fresh: [target] }), msg: `${target} 在栈顶：出栈。`, ...s });
  }
  steps.push({ view: v({ want: pop.length, done: true }), msg: legal ? `出栈序列 ${pop.join(' ')} 一个不差地走完了：**合法**。` : `出栈序列 ${pop.join(' ')} **不合法**。（判断的窍门：出栈序列里每个元素后面、比它先入栈的那些，必须按入栈的逆序出现。）` });
  return { steps, rows, legal: mineLegal, result: mineLegal ? '合法' : '不合法' };
}
export function simulateLegal(push, pop) {
  const st = [];
  let i = 0;
  for (const x of pop) {
    while (st.at(-1) !== x && i < push.length && !st.includes(x)) st.push(push[i++]);
    if (st.at(-1) !== x) return false;
    st.pop();
  }
  return true;
}

// —— n 个不同元素依次入栈，出栈序列有几种：卡特兰数 C(2n, n) / (n + 1)。mistake：noDivide 忘了除以 n+1；factorial 当成全排列 n! ——
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
export const catalan = (n) => binom(2 * n, n) / (n + 1);
const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
// 所有合法的出栈序列（n ≤ 5 时画出来）
export function allPopSeqs(n) {
  const out = [];
  const rec = (next, st, seq) => {
    if (seq.length === n) { out.push(seq.join(' ')); return; }
    if (st.length) rec(next, st.slice(0, -1), [...seq, st.at(-1)]);
    if (next <= n) rec(next + 1, [...st, next], seq);
  };
  rec(1, [], []);
  return out.sort();
}
function runCount(input) {
  const { n, mistake } = input;
  const c = catalan(n);
  const mine = mistake === 'noDivide' ? binom(2 * n, n) : mistake === 'factorial' ? fact(n) : c;
  const seqs = n <= 5 ? allPopSeqs(n) : [];
  return {
    steps: [
      { view: { n }, msg: `1, 2, …, ${n} 依次入栈（中间随时可以出栈），能得到几种不同的出栈序列？不是 ${n}! 种全排列：后入栈的压着先入栈的，有些排列做不到（比如 ${n >= 3 ? '3 1 2' : '…'}）。` },
      { view: { n, seqs, c }, msg: `是卡特兰数：$\\dfrac{1}{n+1}C_{2n}^{n} = \\dfrac{1}{${n + 1}}C_{${2 * n}}^{${n}} = \\dfrac{${binom(2 * n, n)}}{${n + 1}} = ${c}$ 种。${seqs.length ? '下面列出了全部。' : ''}`, ask: { tag: 'count', kind: 'number', q: `${n} 个不同的元素依次入栈，出栈序列一共有几种？`, answer: mine } },
    ],
    result: String(mine),
  };
}

export function run(input) {
  if (input.mode === 'infix') return runInfix(input);
  if (input.mode === 'postfix') return runPostfix(input);
  if (input.mode === 'brackets') return runBrackets(input);
  if (input.mode === 'legal') return runLegal(input);
  return runCount(input);
}

// —— 画面 ——
export function view(s, input) {
  if (input.mode === 'count') {
    const list = s.seqs?.length ? `<div class="ln-seqs">${s.seqs.map((q) => `<span class="ln-chip">${esc(q)}</span>`).join('')}</div>` : '';
    return `${chips([['n', s.n], ...(s.c !== undefined ? [['出栈序列', `${s.c} 种`]] : [])])}${list}`;
  }
  if (input.mode === 'legal') {
    const rest = s.push.slice(s.i).map((x) => ({ text: x, key: `e:${x}`, cls: 'ln-in' }));
    const stack = s.stack.map((x) => ({ text: x, key: `e:${x}`, cls: [s.fresh?.includes(x) ? 'sv-new' : '', s.bad && x === s.bad ? 'ln-bad' : ''].filter(Boolean).join(' ') }));
    const out = s.out.map((x) => ({ text: x, key: `e:${x}`, cls: `ln-ok${s.fresh?.includes(x) ? ' sv-new' : ''}` }));
    const target = s.pop.map((x, k) => `<span class="ln-tok${k < s.want ? ' ln-read' : ''}${k === s.want && !s.done ? ' ln-now' : ''}${s.bad === x ? ' ln-bad' : ''}" data-cmd="${k + 1}" data-label="${esc(x)}">${esc(x)}</span>`).join('');
    return `<div class="ln-tape"><span class="ln-tape-h">要的出栈序列</span>${target}</div>
      <div class="ln-main">${stackView(stack, { depth: s.push.length })}<div class="ln-side">${seqView(rest, { label: '还没入栈', empty: '（都入栈了）' })}${seqView(out, { label: '已经出栈', empty: '（还没有）' })}</div></div>`;
  }
  if (input.mode === 'brackets') {
    const cls = {};
    for (const i of Object.keys(s.matched || {})) cls[i] = 'ln-ok';
    if (s.bad !== undefined) cls[s.bad] = 'ln-bad';
    const stack = s.stack.map((x) => ({ text: x.c, key: `b${x.i}`, cls: [s.fresh?.includes(x.i) ? 'sv-new' : '', s.badTop === x.i ? 'ln-bad' : ''].filter(Boolean).join(' ') }));
    const verdict = s.done ? `<div class="ln-verdict ${s.ok ? 'ln-ok' : 'ln-bad'}">${s.ok ? '匹配' : '不匹配'}</div>` : '';
    return `${tapeView(input.chars, s.at, { label: '读入', cls })}<div class="ln-main">${stackView(stack, { depth: s.depth })}<div class="ln-side">${verdict}</div></div>`;
  }
  const toks = input.toks.map((x) => x.t);
  if (input.mode === 'postfix') {
    const stack = s.stack.map((x) => ({ text: x.v.toString(), key: x.key, cls: s.fresh?.includes(x.key) ? 'sv-new' : '' }));
    return `${tapeView(toks, s.at, { label: '后缀' })}<div class="ln-main">${stackView(stack, { depth: s.depth })}<div class="ln-side">${s.calc ? chips([['算', s.calc]]) : ''}${s.done ? chips([['值', s.stack[0].v.toString()]]) : ''}</div></div>`;
  }
  const fresh = new Set(s.fresh || []);
  const stack = s.stack.map((x) => ({ text: x.t, key: `t${x.k}`, cls: fresh.has(x.k) ? 'sv-new' : '' }));
  const out = s.out.map((x) => ({ text: x.t, key: `t${x.k}`, cls: [x.type === 'op' ? 'ln-op' : '', fresh.has(x.k) ? 'sv-new' : ''].filter(Boolean).join(' ') }));
  return `${tapeView(toks, s.at, { label: '中缀' })}<div class="ln-main">${stackView(stack, { depth: s.depth, label: '运算符栈' })}<div class="ln-side">${seqView(out, { label: '后缀表达式' })}</div></div>`;
}

// —— mode: quiz ——
export function quiz(input, r) {
  const qhtml = input.mode === 'infix' ? tapeView(input.toks.map((x) => x.t), -1, { label: '中缀' }) : input.mode === 'postfix' ? tapeView(input.toks.map((x) => x.t), -1, { label: '后缀' }) : input.mode === 'brackets' ? tapeView(input.chars, -1) : '';
  if (input.mode === 'infix') return { q: '把上面的中缀表达式转成后缀表达式（王道的方法：用一个运算符栈）。', qhtml, type: 'seq', answer: r.result };
  if (input.mode === 'postfix') return r.result === null ? null : { q: '求上面这个后缀表达式的值。', qhtml, type: 'seq', answer: r.value.d === 1 ? r.result : `${r.result} | ${r.value.valueOf()}` };
  if (input.mode === 'brackets') return { q: '这串括号匹配吗？写「匹配」或「不匹配」。', qhtml, type: 'seq', answer: r.result };
  if (input.mode === 'legal') return { q: `入栈序列是 ${input.push.join(' ')}，出栈序列 ${input.pop.join(' ')} 合法吗？写「合法」或「不合法」。`, type: 'seq', answer: r.result };
  return { q: `${input.n} 个不同的元素依次入栈，出栈序列一共有几种？`, type: 'seq', answer: r.result };
}

// —— mode: fill：王道那张「每读一个符号，栈里有什么、输出了什么」的表 ——
export function table(input, r) {
  if (input.mode === 'infix') {
    return {
      q: '中缀转后缀：每读一个符号，写出处理完以后栈里的运算符（从栈底写到栈顶，如「+*(」，空了写 -）和目前的后缀表达式。',
      qhtml: tapeView(input.toks.map((x) => x.t), -1, { label: '中缀' }),
      dir: 'row', head: ['栈（底→顶）', '后缀表达式'],
      rows: r.rows.map((x) => ({ label: x.label, cells: [{ v: x.stack }, { v: x.out.replace(/ /g, '') }] })),
    };
  }
  if (input.mode === 'postfix') {
    return {
      q: '后缀求值：每读一个符号，写出处理完以后栈里的数（从栈底写到栈顶，空格隔开）；最后写出表达式的值。',
      qhtml: tapeView(input.toks.map((x) => x.t), -1, { label: '后缀' }),
      dir: 'row', head: ['栈（底→顶）'],
      rows: r.rows.map((x) => ({ label: x.label, cells: [x.stack ? vecCell(x.stack) : { v: EMPTY_ALTS, vec: true }] })),
      extra: r.result === null ? [] : [{ label: '表达式的值', v: r.result, num: true }],
    };
  }
  if (input.mode === 'brackets') {
    return {
      q: '括号匹配：每读一个括号，写出处理完以后栈里的（从栈底写到栈顶，空了写 -）；配不上就停，后面的空着。最后写「匹配」或「不匹配」。',
      qhtml: tapeView(input.chars, -1),
      dir: 'row', head: ['栈（底→顶）'],
      rows: r.rows.map((x) => ({ label: x.label, cells: [{ v: x.stack }] })),
      extra: [{ label: '结论', v: r.result }],
    };
  }
  if (input.mode === 'legal') {
    return {
      q: `入栈序列 ${input.push.join(' ')}。照着出栈序列一个个来：写出每个元素出栈之前要先入栈的（没有写 -），和它出栈以后栈里剩下的（从栈底写到栈顶）。走不下去就停，后面的空着；最后写「合法」或「不合法」。`,
      dir: 'row', head: ['先入栈的', '出栈后的栈（底→顶）'],
      rows: r.rows.map((x) => ({ label: x.label, cells: x.pushed ? [vecCell(x.pushed), vecCell(x.after)] : [{ v: EMPTY_ALTS, vec: true }, { v: EMPTY_ALTS, vec: true }] })),
      extra: [{ label: '合法吗', v: r.result }],
    };
  }
  return null;
}

export function problems(input) {
  const out = [];
  if (input.mode === 'infix' && !input.toks.some((x) => x.type === 'op' && PREC[x.t] === 2) && !input.toks.some((x) => x.type === '(')) out.push('infix: 只有 + − 、没有括号，看不出优先级和括号怎么处理，换一个带 * / 或括号的');
  return out;
}

// 常见错法（只给老师看）。和正确的答案完全一样的不列
const VARIANTS = {
  infix: [
    ['eqNoPop', '像是同优先级的没有弹栈，只弹了比它高的（王道：读到运算符时，栈里优先级高于**或等于**它的都要先弹出）'],
    ['parenOut', '像是把左括号也写进了后缀表达式（王道：右括号弹栈弹到「(」为止，括号不写进后缀）'],
  ],
  postfix: [
    ['swap', '像是减法、除法的两个操作数弄反了（王道：先弹出的是右操作数，后弹出的是左操作数，算「后弹出的 op 先弹出的」）'],
    ['noPush', '像是算完没把结果压回栈（王道：两个操作数出栈，算出来的结果要再入栈）'],
  ],
  brackets: [
    ['typeBlind', '像是只数了括号的个数、没看种类（王道：右括号要和栈顶的**同一种**左括号配对）'],
    ['noEmptyCheck', '像是读完没检查栈空不空（王道：读完以后栈里还有左括号，也是不匹配）'],
  ],
  legal: [
    ['reverseOnly', '像是以为出栈序列只能是入栈序列倒过来（王道：入栈、出栈可以交替进行，每次出的是当时的栈顶就行）'],
    ['queueLike', '像是当成了先进先出，以为出栈顺序要和入栈一样（王道：栈是后进先出）'],
  ],
  count: [
    ['noDivide', '像是用了 $C_{2n}^{n}$，忘了除以 n+1（王道：卡特兰数 $\\frac{1}{n+1}C_{2n}^{n}$）'],
    ['factorial', '像是当成了全排列 n!（王道：后入栈的压着先入栈的，有的排列做不到，是卡特兰数 $\\frac{1}{n+1}C_{2n}^{n}$）'],
  ],
};

// 一个 run 里学生能答的：每一问的答案、quiz 的答案、表里的答案
function answersOf(input, r) {
  const asks = r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean).map((a) => [a.q, a.answer]);
  let q = null, t = null;
  try { q = quiz(input, r)?.answer ?? null; } catch { /* 没有 */ }
  try { t = table(input, r)?.rows.map((row) => row.cells.map((c) => c.v)) ?? null; } catch { /* 没有 */ }
  return JSON.stringify([asks, q, t]);
}
export function variants(input) {
  const base = answersOf(input, run(input));
  return (VARIANTS[input.mode] || []).map(([mistake, label]) => ({ label, input: { ...input, mistake } })).filter((v) => { try { return answersOf(v.input, run(v.input)) !== base; } catch { return false; } });
}

export const stackEngine = { name: 'stack', title: '栈的应用', parse, run, view, quiz, table, problems, variants };
