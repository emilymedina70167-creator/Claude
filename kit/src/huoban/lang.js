// 活板的写法（docs/talk-plan.md）：几行描述 → 语法树。纯函数，不碰 DOM，tests/huoban-lang.test.js 守着。
//   let 名字 = 表达式 [拨 1..6 | 拖 吸附 0.5]、let 名字 = find v in 范围 where 条件
//   draw a, b "标签", r at k      画到板上（at：演示画到第几步）
//   when 条件：文字                条件成立才出现
//   goal 条件 => "做到时说的话"
//   普通的一行：正文；{表达式} 活的值、{表达式?} 空、{? 甲 | *乙} 选择、{f} 能拨的量
// 行的先后不要紧（量按名字找），所以老师可以先写那句话、再写 let：边写边画时话先出来。

export class HbError extends Error {
  constructor(msg) { super(msg); this.hb = true; }
}
const err = (m) => new HbError(m);

const ID = /[A-Za-z_一-鿿][\w一-鿿]*/y;
const TWO = ['==', '!=', '>=', '<=', '..', '=>'];

export function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || '') && src[i - 1] !== '.')) {
      // 小数点后面必须是数字，所以 1..6 读成 1、..、6
      const s = /^\d*\.?\d+/.exec(src.slice(i))[0];
      out.push({ t: 'num', v: s });
      i += s.length;
      continue;
    }
    if (c === '"' || c === '“' || c === '「') {
      const close = c === '"' ? '"' : c === '“' ? '”' : '」';
      const j = src.indexOf(close, i + 1);
      if (j < 0) throw err('字符串少了右引号');
      out.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    ID.lastIndex = i;
    const m = ID.exec(src);
    if (m) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (TWO.includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    const map = { '，': ',', '（': '(', '）': ')', '∥': '∥' };
    if ('+-*/^()[],.><\'=!'.includes(c) || map[c]) { out.push({ t: 'op', v: map[c] || c }); i++; continue; }
    throw err(`看不懂「${c}」`);
  }
  return out;
}

// 优先级：or < and < not < 比较 < .. < + - < * / < 负号 < ^ < 调用、取成员、转置
const BIN = { or: 1, '或': 1, and: 2, '且': 2, '==': 4, '!=': 4, '>': 4, '<': 4, '>=': 4, '<=': 4, '∥': 4, '..': 5, '+': 6, '-': 6, '*': 7, '/': 7, '^': 9 };

export function parseExpr(src) {
  const toks = tokenize(String(src));
  let p = 0;
  const at = (v) => toks[p] && (toks[p].t === 'op' || toks[p].t === 'id') && toks[p].v === v;
  const expect = (v) => { if (!at(v)) throw err(`这里少了「${v}」`); p++; };

  function primary() {
    const t = toks[p++];
    if (!t) throw err('表达式没写完');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'id') {
      if (t.v === 'not' || t.v === '非') return { k: 'un', op: 'not', a: expr(3) };
      return { k: 'id', name: t.v };
    }
    if (t.v === '(') { const e = expr(0); expect(')'); return e; }
    if (t.v === '[') {
      const items = [];
      if (!at(']')) { do { items.push(expr(0)); } while (at(',') && ++p); }
      expect(']');
      return { k: 'list', items };
    }
    if (t.v === '-') return { k: 'un', op: '-', a: expr(8) };
    if (t.v === '!') return { k: 'un', op: 'not', a: expr(3) };
    throw err(`这里不该是「${t.v}」`);
  }

  // 参数：位置参数，或者 字段=值（演示组件用字段名写：paging(refs=v, frames=3, algo=fifo)）
  function args() {
    const pos = [], named = {};
    if (at(')')) return { pos, named };
    do {
      if (toks[p]?.t === 'id' && toks[p + 1]?.t === 'op' && toks[p + 1].v === '=') {
        const name = toks[p].v;
        p += 2;
        named[name] = expr(0);
      } else pos.push(expr(0));
    } while (at(',') && ++p);
    return { pos, named };
  }

  function postfix(e) {
    for (;;) {
      if (at('(')) {
        if (e.k !== 'id') throw err('只有函数名后面能跟括号');
        p++;
        const { pos, named } = args();
        expect(')');
        e = { k: 'call', fn: e.name, args: pos, named: Object.keys(named).length ? named : null };
      } else if (at('.')) {
        p++;
        const t = toks[p++];
        if (!t || (t.t !== 'id' && t.t !== 'num')) throw err('「.」后面要写成员的名字，比如 r.faults');
        e = { k: 'mem', obj: e, name: String(t.v) };
      } else if (at("'")) { p++; e = { k: 'call', fn: 'T', args: [e], named: null }; }
      else return e;
    }
  }

  function expr(min) {
    let a = postfix(primary());
    for (;;) {
      const t = toks[p];
      if (!t || (t.t !== 'op' && t.t !== 'id')) break;
      const prec = BIN[t.v];
      if (prec === undefined || prec <= min) break;
      p++;
      const b = expr(t.v === '^' ? prec - 1 : prec);
      a = t.v === '..' ? { k: 'range', a, b } : { k: 'bin', op: t.v, a, b };
    }
    return a;
  }

  const e = expr(0);
  if (p < toks.length) throw err(`多出来「${toks[p].v}」`);
  return e;
}

/** 语法树里用到的名字（不含函数名、成员名） */
export function idents(ast, out = new Set()) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.k === 'id') { out.add(ast.name); return out; }
  if (ast.k === 'mem') return idents(ast.obj, out);
  if (ast.k === 'call') { ast.args.forEach((a) => idents(a, out)); Object.values(ast.named || {}).forEach((a) => idents(a, out)); return out; }
  for (const v of Object.values(ast)) {
    if (Array.isArray(v)) v.forEach((x) => idents(x, out));
    else if (v && typeof v === 'object') idents(v, out);
  }
  return out;
}

/** 语法树里调用的函数：[{ fn, named }]（写法检查用） */
export function calls(ast, out = []) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.k === 'call') out.push({ fn: ast.fn, named: !!ast.named });
  for (const v of Object.values(ast)) {
    if (Array.isArray(v)) v.forEach((x) => calls(x, out));
    else if (v && typeof v === 'object') calls(v, out);
  }
  return out;
}

const NAME = '[A-Za-z_\\u4e00-\\u9fff][\\w\\u4e00-\\u9fff]*';
export const RE = {
  title: /^#\s*(.+)$/,
  let: new RegExp(`^let\\s+(${NAME})\\s*=\\s*(.+)$`),
  set: new RegExp(`^set\\s+(${NAME})\\s*=\\s*(.+)$`),
  draw: /^(?:draw|画)\s+(.+)$/,
  when: /^when\s+(.+?)\s*[：:]\s*(.*)$/,
  goal: /^goal\s+(.+?)(?:\s*=>\s*["“](.*)["”])?\s*$/,
  scrub: /\s+(?:拨|scrub)\s+(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)(?:\s+(?:步|step)\s+(\d+(?:\.\d+)?))?\s*$/,
  drag: /\s+(?:拖|drag)(?:\s+(?:吸附|snap)\s+(\d+(?:\.\d+)?))?\s*$/,
  find: new RegExp(`^find\\s+(${NAME})\\s+in\\s+(.+?)\\s+where\\s+(.+)$`),
  numList: /^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?)+$/,
};

/** 一行正文里的 {…}：值 / 能拨的量 / 空 / 选择 */
export function parseProse(text) {
  const segs = [];
  const re = /\{([^{}]*)\}/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) segs.push({ k: 'text', v: text.slice(last, m.index) });
    const inner = m[1].trim();
    if (/^[?？]/.test(inner)) {
      const opts = inner.slice(1).split('|').map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2) throw err('选择要至少两个选项：{? 甲 | *乙}');
      const choices = opts.map((o) => ({ t: o.replace(/^\*/, '').trim(), ok: o.startsWith('*') }));
      if (!choices.some((c) => c.ok)) throw err('选择里要给对的选项前面打 *');
      segs.push({ k: 'choice', choices, src: inner });
    } else if (/[?？]$/.test(inner)) {
      const src = inner.slice(0, -1).trim();
      segs.push({ k: 'blank', ast: parseExpr(src), src });
    } else {
      segs.push({ k: 'value', ast: parseExpr(inner), src: inner, bare: new RegExp(`^${NAME}$`).test(inner) ? inner : null });
    }
    last = re.lastIndex;
  }
  if (last < text.length) segs.push({ k: 'text', v: text.slice(last) });
  return segs;
}

/** 顶层按逗号切开（括号、引号里的逗号不算） */
export function splitTop(s) {
  const out = [];
  let d = 0, q = false, cur = '';
  for (const c of s) {
    if (c === '"' || c === '“' || c === '”') q = !q;
    if (!q && '([（'.includes(c)) d++;
    if (!q && ')]）'.includes(c)) d--;
    if (!q && d === 0 && (c === ',' || c === '，')) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// draw 的一项：表达式 ["标签"] [at 第几步]
function drawItem(t) {
  let rest = t.trim(), atAst = null, atSrc = null, label = null;
  const am = /\s+at\s+(.+)$/.exec(rest);
  if (am) { atSrc = am[1].trim(); atAst = parseExpr(atSrc); rest = rest.slice(0, am.index).trim(); }
  const lm = /^(.*?)\s+["“](.*)["”]$/.exec(rest);
  if (lm) { label = lm[2]; rest = lm[1].trim(); }
  return { src: rest, ast: parseExpr(rest), label, at: atAst, atSrc };
}

/**
 * 读整块板。返回 { lines, errors, cells }：lines 按行号（从 1 数），写错的一行变成 kind: 'error'，不连累别的行。
 * check(ast 列表, 本行的局部名字) → [中文问题]：名字、函数要有（runtime 给，免得这里知道有哪些函数）
 */
export function parseBoard(src, { check } = {}) {
  const lines = [];
  const errors = [];
  const cells = new Map();
  String(src).split('\n').forEach((raw, idx) => {
    const n = idx + 1;
    const s = raw.trim();
    if (!s || s.startsWith('//')) return;
    try {
      let m;
      if ((m = RE.title.exec(s))) { lines.push({ n, kind: 'title', text: m[1] }); return; }
      if ((m = RE.let.exec(s))) {
        const name = m[1];
        let rhs = m[2].trim(), input = null, mm;
        if ((mm = RE.scrub.exec(rhs))) { input = { type: 'scrub', lo: +mm[1], hi: +mm[2], step: mm[3] ? +mm[3] : 1 }; rhs = rhs.slice(0, mm.index).trim(); }
        else if ((mm = RE.drag.exec(rhs))) { input = { type: 'drag', snap: mm[1] ? +mm[1] : 0.5 }; rhs = rhs.slice(0, mm.index).trim(); }
        if (input?.type === 'scrub' && !(input.hi > input.lo)) throw err('拨的范围要从小到大：拨 1..6');
        if (RE.numList.test(rhs)) rhs = `[${rhs.split(/\s+/).join(', ')}]`;
        let ast = null, find = null;
        if ((mm = RE.find.exec(rhs))) find = { v: mm[1], dom: parseExpr(mm[2]), cond: parseExpr(mm[3]), src: rhs };
        else ast = parseExpr(rhs);
        if (cells.has(name)) throw err(`「${name}」第 ${cells.get(name).n} 行已经定义过；要改它的值写 set ${name} = …`);
        const cell = { n, name, ast, find, src: rhs, input };
        cells.set(name, cell);
        lines.push({ n, kind: 'let', cell, text: s });
        return;
      }
      if (RE.set.test(s)) throw err('set 只用来改已经有的量（追问时）；板上第一次写用 let');
      if ((m = RE.draw.exec(s))) { lines.push({ n, kind: 'draw', items: splitTop(m[1]).map(drawItem), text: s }); return; }
      if ((m = RE.when.exec(s))) { lines.push({ n, kind: 'when', cond: parseExpr(m[1]), condSrc: m[1], segs: parseProse(m[2]), text: s }); return; }
      if ((m = RE.goal.exec(s))) { lines.push({ n, kind: 'goal', cond: parseExpr(m[1]), src: m[1], msg: m[2] || '做到了', text: s }); return; }
      lines.push({ n, kind: 'prose', segs: parseProse(s), text: s });
    } catch (e) {
      if (!e.hb) throw e;
      errors.push({ n, msg: e.message, line: s });
      lines.push({ n, kind: 'error', msg: e.message, line: s });
    }
  });
  // 第二遍：每一行用到的名字、函数都要有（写错了在这一行报出来，不等到画的时候）
  if (check) {
    for (const ln of lines) {
      if (ln.kind === 'error') continue;
      const local = ln.kind === 'let' && ln.cell.find ? [ln.cell.find.v] : [];
      const asts = astsOf(ln);
      const bad = check(asts, new Set(local), cells);
      if (bad.length) {
        const msg = [...new Set(bad)].join('；');
        errors.push({ n: ln.n, msg, line: ln.text });
        if (ln.kind !== 'let') Object.assign(ln, { kind: 'error', msg, line: ln.text });
        else ln.cell.bad = msg;
      }
    }
    errors.sort((a, b) => a.n - b.n);
  }
  return { lines, errors, cells };
}

export function astsOf(ln) {
  if (ln.kind === 'let') return ln.cell.find ? [ln.cell.find.dom, ln.cell.find.cond] : [ln.cell.ast];
  if (ln.kind === 'draw') return ln.items.flatMap((x) => [x.ast, x.at].filter(Boolean));
  if (ln.kind === 'goal') return [ln.cond];
  if (ln.kind === 'when') return [ln.cond, ...ln.segs.filter((g) => g.ast).map((g) => g.ast)];
  if (ln.kind === 'prose') return ln.segs.filter((g) => g.ast).map((g) => g.ast);
  return [];
}

/**
 * 追问：set 改量（留着原来的手势），别的行接在最后。
 * 返回新的源码；不认识的 set（还没有这个量）当成 let 接在最后。
 */
export function applyOps(src, ops) {
  const lines = String(src).replace(/\s+$/, '').split('\n');
  if (lines.length === 1 && !lines[0].trim()) lines.length = 0;
  const added = [];
  for (const raw of String(ops).split('\n')) {
    const s = raw.trim();
    if (!s) continue;
    const m = RE.set.exec(s);
    if (!m) { added.push(raw.replace(/\s+$/, '')); continue; }
    const at = lines.findIndex((l) => new RegExp(`^\\s*let\\s+${m[1]}\\s*=`).test(l));
    if (at < 0) { added.push(`let ${m[1]} = ${m[2].trim()}`); continue; }
    const gesture = (RE.scrub.exec(lines[at]) || RE.drag.exec(lines[at]) || [''])[0];
    const hasOwn = RE.scrub.test(` ${m[2]}`) || RE.drag.test(` ${m[2]}`);
    lines[at] = `let ${m[1]} = ${m[2].trim()}${hasOwn ? '' : gesture}`;
  }
  return [...lines, ...added].join('\n');
}
