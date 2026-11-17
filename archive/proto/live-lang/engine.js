// 活板（测试版）的引擎：读几行描述 → 量和它们之间的依赖 → 算值、判条件、替老师找例子。不碰 DOM，node 里也能跑。
// 页面（index.html）只负责画和手势：值从这里取，学生一动就改输入、整块板重算一遍。
// 板很小（十几个量），每次全部重算比维护依赖图简单，也够快；正式做进 la-kit 时再换成按依赖增量重算。
var HB = (function () {
  'use strict';

  // —— 读表达式 ——

  const ID = /[A-Za-z_一-鿿][\w一-鿿]*/y;
  const TWO = ['==', '!=', '>=', '<=', '..', '=>'];

  function err(msg) { const e = new Error(msg); e.hb = true; return e; }

  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || '') && src[i - 1] !== '.')) {
        // 小数点后面必须是数字，所以 1..6 读成 1、..、6
        const s = /^\d*\.?\d+/.exec(src.slice(i))[0];
        out.push({ t: 'num', v: parseFloat(s) });
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
      if ('+-*/^()[],.><\'∥=!'.includes(c)) { out.push({ t: 'op', v: c === '∥' ? '∥' : c }); i++; continue; }
      if (c === '，') { out.push({ t: 'op', v: ',' }); i++; continue; }
      if (c === '（') { out.push({ t: 'op', v: '(' }); i++; continue; }
      if (c === '）') { out.push({ t: 'op', v: ')' }); i++; continue; }
      throw err(`看不懂「${c}」`);
    }
    return out;
  }

  // 优先级：or < and < not < 比较 < .. < + - < * / < 负号 < ^ < 调用、取成员、转置
  const BIN = { or: 1, '或': 1, and: 2, '且': 2, '==': 4, '!=': 4, '>': 4, '<': 4, '>=': 4, '<=': 4, '∥': 4, '..': 5, '+': 6, '-': 6, '*': 7, '/': 7, '^': 9 };

  function parseExpr(src) {
    const toks = tokenize(String(src));
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => toks[p] && (toks[p].t === 'op' || toks[p].t === 'id') && toks[p].v === v;
    const expect = (v) => { if (!isOp(v)) throw err(`这里少了「${v}」`); p++; };

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
        if (!isOp(']')) { do { items.push(expr(0)); } while (isOp(',') && ++p); }
        expect(']');
        return { k: 'list', items };
      }
      if (t.v === '-') return { k: 'un', op: '-', a: expr(8) };
      if (t.v === '!') return { k: 'un', op: 'not', a: expr(3) };
      throw err(`这里不该是「${t.v}」`);
    }

    function postfix(e) {
      for (;;) {
        if (isOp('(')) {
          if (e.k !== 'id') throw err('只有函数名后面能跟括号');
          p++;
          const args = [];
          if (!isOp(')')) { do { args.push(expr(0)); } while (isOp(',') && ++p); }
          expect(')');
          e = { k: 'call', fn: e.name, args };
        } else if (isOp('.') ) {
          p++;
          const t = toks[p++];
          if (!t || (t.t !== 'id' && t.t !== 'num')) throw err('「.」后面要写成员的名字，比如 r.faults');
          e = { k: 'mem', obj: e, name: String(t.v) };
        } else if (isOp("'")) { p++; e = { k: 'call', fn: 'T', args: [e] }; }
        else return e;
      }
    }

    function expr(min) {
      let a = postfix(primary());
      for (;;) {
        const t = peek();
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

  function idents(ast, out = new Set()) {
    if (!ast || typeof ast !== 'object') return out;
    if (ast.k === 'id') out.add(ast.name);
    for (const v of Object.values(ast)) {
      if (Array.isArray(v)) v.forEach((x) => idents(x, out));
      else if (v && typeof v === 'object') idents(v, out);
    }
    return out;
  }

  // —— 值 ——

  const isNum = (v) => typeof v === 'number';
  const isVec = (v) => Array.isArray(v) && v.length > 0 && v.every(isNum);
  const isMat = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => isVec(r)) && v.every((r) => r.length === v[0].length);
  const num = (v, what = '这里') => { if (!isNum(v) || Number.isNaN(v)) throw err(`${what}要一个数`); return v; };

  function add(a, b, s = 1) {
    if (isNum(a) && isNum(b)) return a + s * b;
    if (typeof a === 'string' && s === 1) return a + String(b);
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) throw err('长度不一样的两个东西不能相加');
      return a.map((x, i) => add(x, b[i], s));
    }
    throw err(s === 1 ? '这两个东西不能相加' : '这两个东西不能相减');
  }
  function scale(k, v) { return Array.isArray(v) ? v.map((x) => scale(k, x)) : k * v; }
  function mul(a, b) {
    if (isNum(a) && isNum(b)) return a * b;
    if (isNum(a) && Array.isArray(b)) return scale(a, b);
    if (Array.isArray(a) && isNum(b)) return scale(b, a);
    if (isMat(a) && isVec(b)) {
      if (a[0].length !== b.length) throw err(`${a.length}×${a[0].length} 的矩阵不能乘 ${b.length} 维的向量`);
      return a.map((r) => r.reduce((s, x, j) => s + x * b[j], 0));
    }
    if (isMat(a) && isMat(b)) {
      if (a[0].length !== b.length) throw err('矩阵的形状对不上，不能相乘');
      return a.map((r) => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)));
    }
    if (isVec(a) && isVec(b)) throw err('两个向量相乘写 dot(u, v)');
    throw err('这两个东西不能相乘');
  }

  const EPS = 1e-9;
  function same(a, b) {
    if (isNum(a) && isNum(b)) return Math.abs(a - b) < 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
    if (typeof a === 'string' && typeof b === 'string') return normText(a) === normText(b);
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
    return a === b;
  }
  const normText = (s) => String(s).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim().replace(/[.!?。]+$/, '');

  function det(M) {
    if (!isMat(M) || M.length !== M[0].length) throw err('det 要一个方阵');
    const a = M.map((r) => r.slice());
    const n = a.length;
    let d = 1;
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
      if (Math.abs(a[piv][c]) < EPS) return 0;
      if (piv !== c) { [a[piv], a[c]] = [a[c], a[piv]]; d = -d; }
      d *= a[c][c];
      for (let r = c + 1; r < n; r++) { const f = a[r][c] / a[c][c]; for (let k = c; k < n; k++) a[r][k] -= f * a[c][k]; }
    }
    return Math.abs(d) < EPS ? 0 : d;
  }
  function inv(M) {
    const n = M.length;
    if (!isMat(M) || n !== M[0].length) throw err('inv 要一个方阵');
    const a = M.map((r, i) => [...r, ...r.map((_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
      if (Math.abs(a[piv][c]) < EPS) throw err('这个矩阵不可逆（行列式是 0）');
      [a[piv], a[c]] = [a[c], a[piv]];
      const p0 = a[c][c];
      a[c] = a[c].map((x) => x / p0);
      for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; a[r] = a[r].map((x, k) => x - f * a[c][k]); }
    }
    return a.map((r) => r.slice(n));
  }
  const transpose = (M) => (isVec(M) ? [M.slice()] : M[0].map((_, j) => M.map((r) => r[j])));
  const dot = (u, v) => { if (!isVec(u) || !isVec(v) || u.length !== v.length) throw err('dot 要两个一样长的向量'); return u.reduce((s, x, i) => s + x * v[i], 0); };
  const norm = (v) => Math.hypot(...v);

  function eigs(M) {
    if (!isMat(M) || M.length !== 2 || M[0].length !== 2) throw err('eigs 现在只算 2×2');
    const [[a, b], [c, d]] = M;
    const tr = a + d, dt = a * d - b * c, disc = tr * tr - 4 * dt;
    if (disc < -EPS) return [];
    const r = Math.sqrt(Math.max(0, disc));
    return disc < EPS ? [tr / 2] : [(tr - r) / 2, (tr + r) / 2];
  }

  // —— 页面置换：按教材的表，换出的页让出它的那一格 ——

  function paging(refs, f, alg) {
    if (!isVec(refs)) throw err('paging 的第一个参数要一串页号');
    f = Math.round(num(f, 'paging 的块数'));
    if (f < 1 || f > 12) throw err('块数要在 1 到 12 之间');
    alg = String(alg || 'fifo').toLowerCase();
    if (!['fifo', 'lru', 'opt'].includes(alg)) throw err('算法只有 fifo、lru、opt');
    const slots = Array(f).fill(null);
    const loaded = Array(f).fill(-1);
    const used = Array(f).fill(-1);
    const cols = [];
    let faults = 0;
    refs.forEach((p, t) => {
      const at = slots.indexOf(p);
      if (at >= 0) { used[at] = t; cols.push({ ref: p, slots: slots.slice(), miss: false, slot: at, victim: null }); return; }
      faults++;
      let k = slots.indexOf(null);
      let victim = null;
      if (k < 0) {
        if (alg === 'fifo') k = loaded.indexOf(Math.min(...loaded));
        else if (alg === 'lru') k = used.indexOf(Math.min(...used));
        else {
          let far = -1;
          slots.forEach((q, i) => { const nx = refs.indexOf(q, t + 1); const d = nx < 0 ? Infinity : nx; if (d > far) { far = d; k = i; } });
        }
        victim = slots[k];
      }
      slots[k] = p; loaded[k] = t; used[k] = t;
      cols.push({ ref: p, slots: slots.slice(), miss: true, slot: k, victim });
    });
    return { kind: 'paging', refs: refs.slice(), f, alg, cols, faults, hits: refs.length - faults };
  }

  // —— 句子：方括号里是能折起的一段 ——

  function sentence(text) {
    text = String(text);
    const parts = [];
    const re = /\[([^\]]*)\]/g;
    let last = 0, m, g = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push({ t: text.slice(last, m.index), fold: false });
      parts.push({ t: m[1], fold: true, i: g++ });
      last = re.lastIndex;
    }
    if (last < text.length) parts.push({ t: text.slice(last), fold: false });
    if (!g) throw err('句子里至少要有一段用 [ ] 括起来，学生才有东西可折');
    return { kind: 'sentence', text, parts, folded: new Set() };
  }
  function restOf(s) {
    const raw = s.parts.filter((p) => !(p.fold && s.folded.has(p.i))).map((p) => p.t).join(' ');
    return raw.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').trim();
  }

  // —— 找例子的范围 ——
  function domain(type, args) {
    const rangeArg = args.find((a) => a && a.kind === 'range');
    const n = args.find(isNum);
    if (!rangeArg) throw err(`${type} 要写取值范围，比如 1..5`);
    const lo = Math.ceil(rangeArg.lo), hi = Math.floor(rangeArg.hi);
    if (hi < lo) throw err('取值范围是空的');
    if (type !== 'int' && !(n >= 1 && n <= 40)) throw err(`${type === 'seq' ? '序列' : type === 'mat' ? '矩阵' : '向量'}要写长度（1 到 40）`);
    return { kind: 'domain', type, n: type === 'int' ? 1 : Math.round(n), lo, hi };
  }

  const FUNCS = {
    det: (A) => det(A),
    inv: (A) => inv(A),
    T: (A) => transpose(A),
    tr: (A) => A.reduce((s, r, i) => s + r[i], 0),
    dot, norm: (v) => norm(v),
    col: (A, j) => A.map((r) => r[Math.round(j) - 1]),
    row: (A, i) => A[Math.round(i) - 1].slice(),
    par: (u, v) => {
      if (!isVec(u) || !isVec(v)) throw err('par 要两个向量');
      const nu = norm(u), nv = norm(v);
      if (nu < 1e-9 || nv < 1e-9) return false;
      return Math.abs(Math.abs(dot(u, v)) - nu * nv) < 1e-6 * nu * nv;
    },
    lam: (A, x) => { const d = dot(x, x); if (d < 1e-12) return NaN; return dot(mul(A, x), x) / d; },
    eigs,
    paging,
    faults: (refs, f, alg) => paging(refs, f, alg).faults,
    sentence, '句子': sentence,
    len: (v) => (Array.isArray(v) ? v.length : typeof v === 'string' ? v.length : num(v)),
    sum: (v) => v.reduce((s, x) => s + x, 0),
    min: (...a) => Math.min(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a)),
    max: (...a) => Math.max(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a)),
    abs: (x) => Math.abs(x), sqrt: (x) => Math.sqrt(x), round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
    range: (a, b) => { const out = []; for (let i = Math.round(a); i <= Math.round(b); i++) out.push(i); return out; },
    allint: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => Math.abs(x - Math.round(x)) < 1e-9),
    count: (v, x) => v.filter((y) => same(y, x)).length,
    '序列': (...a) => domain('seq', a), seq: (...a) => domain('seq', a),
    '整数': (...a) => domain('int', a), int: (...a) => domain('int', a),
    '向量': (...a) => domain('vec', a), vec: (...a) => domain('vec', a),
    '矩阵': (...a) => domain('mat', a), mat: (...a) => domain('mat', a),
  };
  const CONSTS = { fifo: 'fifo', lru: 'lru', opt: 'opt', FIFO: 'fifo', LRU: 'lru', OPT: 'opt', true: true, false: false, '是': true, '否': false, pi: Math.PI, I: [[1, 0], [0, 1]] };

  function member(o, name) {
    if (o && o.kind === 'paging') {
      if (name in o && name !== 'cols') return o[name];
      throw err(`置换过程只有 .faults（缺页次数）、.hits（命中次数）、.f、.refs`);
    }
    if (o && o.kind === 'sentence') {
      if (name === 'rest') return restOf(o);
      if (name === 'folded') return o.folded.size;
      if (name === 'text') return o.parts.map((p) => p.t).join(' ').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
      throw err('句子只有 .rest（折完剩下的）、.folded（折起了几段）、.text');
    }
    if (Array.isArray(o) && /^\d+$/.test(name)) { const v = o[Number(name) - 1]; if (v === undefined) throw err(`没有第 ${name} 个`); return v; }
    throw err(`取不到 .${name}`);
  }

  // —— 一块板：几行描述 ——

  const RE = {
    title: /^#\s*(.+)$/,
    let: /^let\s+([A-Za-z_一-鿿][\w一-鿿]*)\s*=\s*(.+)$/,
    set: /^set\s+([A-Za-z_一-鿿][\w一-鿿]*)\s*=\s*(.+)$/,
    draw: /^(?:draw|画)\s+(.+)$/,
    when: /^when\s+(.+?)\s*[：:]\s*(.*)$/,
    goal: /^goal\s+(.+?)(?:\s*=>\s*["“](.*)["”])?\s*$/,
    scrub: /\s+(?:拨|scrub)\s+(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)(?:\s+(?:步|step)\s+(\d+(?:\.\d+)?))?\s*$/,
    drag: /\s+(?:拖|drag)(?:\s+(?:吸附|snap)\s+(\d+(?:\.\d+)?))?\s*$/,
    find: /^find\s+([A-Za-z_一-鿿][\w一-鿿]*)\s+in\s+(.+?)\s+where\s+(.+)$/,
    numList: /^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?)+$/,
  };

  // 一行文字里的 {…}：值 / 能拨的量 / 空 / 选择
  function parseProse(text) {
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
        segs.push({ k: 'value', ast: parseExpr(inner), src: inner, bare: /^[A-Za-z_一-鿿][\w一-鿿]*$/.test(inner) ? inner : null });
      }
      last = re.lastIndex;
    }
    if (last < text.length) segs.push({ k: 'text', v: text.slice(last) });
    return segs;
  }

  function parseBoard(src) {
    const lines = [];
    const errors = [];
    const cells = new Map();
    String(src).split('\n').forEach((raw, idx) => {
      const n = idx + 1;
      const line = raw.replace(/\s+$/, '');
      if (!line.trim() || /^\s*\/\//.test(line)) return;
      const s = line.trim();
      try {
        let m;
        if ((m = RE.title.exec(s))) { lines.push({ n, kind: 'title', text: m[1] }); return; }
        if ((m = RE.let.exec(s))) {
          const name = m[1];
          let rhs = m[2].trim();
          let input = null;
          let mm;
          if ((mm = RE.scrub.exec(rhs))) { input = { type: 'scrub', lo: +mm[1], hi: +mm[2], step: mm[3] ? +mm[3] : 1 }; rhs = rhs.slice(0, mm.index).trim(); }
          else if ((mm = RE.drag.exec(rhs))) { input = { type: 'drag', snap: mm[1] ? +mm[1] : 0.5 }; rhs = rhs.slice(0, mm.index).trim(); }
          if (RE.numList.test(rhs)) rhs = `[${rhs.split(/\s+/).join(', ')}]`;
          let ast, find = null;
          if ((mm = RE.find.exec(rhs))) find = { v: mm[1], dom: parseExpr(mm[2]), cond: parseExpr(mm[3]), src: rhs };
          else ast = parseExpr(rhs);
          if (cells.has(name)) throw err(`「${name}」第 ${cells.get(name).n} 行已经定义过；要改它的值写 set ${name} = …`);
          const cell = { n, name, ast, find, src: rhs, input };
          cells.set(name, cell);
          lines.push({ n, kind: 'let', cell });
          return;
        }
        if ((m = RE.set.exec(s))) throw err('set 只在追问时用（改已经有的量），板上直接写 let');
        if ((m = RE.draw.exec(s))) {
          const items = splitTop(m[1]).map((t) => {
            const lm = /^(.*?)\s+["“](.*)["”]$/.exec(t);
            const src = (lm ? lm[1] : t).trim();
            return { src, ast: parseExpr(src), label: lm ? lm[2] : null };
          });
          lines.push({ n, kind: 'draw', items });
          return;
        }
        if ((m = RE.when.exec(s))) { lines.push({ n, kind: 'when', cond: parseExpr(m[1]), condSrc: m[1], segs: parseProse(m[2]), text: m[2] }); return; }
        if ((m = RE.goal.exec(s))) { lines.push({ n, kind: 'goal', cond: parseExpr(m[1]), src: m[1], msg: m[2] || '做到了' }); return; }
        lines.push({ n, kind: 'prose', segs: parseProse(s), text: s });
      } catch (e) {
        if (!e.hb) throw e;
        errors.push({ n, msg: e.message, line: s });
        lines.push({ n, kind: 'error', msg: e.message, line: s });
      }
    });
    // 第二遍：每一行用到的名字、函数都要有（写错了在这一行报出来，不等到画的时候）
    for (const ln of lines) {
      if (ln.kind === 'error') continue;
      const local = ln.kind === 'let' && ln.cell.find ? new Set([ln.cell.find.v]) : new Set();
      const asts = ln.kind === 'let' ? (ln.cell.find ? [ln.cell.find.dom, ln.cell.find.cond] : [ln.cell.ast])
        : ln.kind === 'draw' ? ln.items.map((x) => x.ast)
        : ln.kind === 'goal' ? [ln.cond]
        : ln.kind === 'when' ? [ln.cond, ...ln.segs.filter((g) => g.ast).map((g) => g.ast)]
        : ln.kind === 'prose' ? ln.segs.filter((g) => g.ast).map((g) => g.ast) : [];
      const bad = [];
      const walk = (a) => {
        if (!a || typeof a !== 'object') return;
        if (a.k === 'id' && !cells.has(a.name) && !(a.name in CONSTS) && !local.has(a.name)) bad.push(`不认识「${a.name}」：先用 let 定义它`);
        if (a.k === 'call' && !FUNCS[a.fn]) bad.push(`没有函数「${a.fn}」${suggest(a.fn)}`);
        for (const v of Object.values(a)) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
      };
      asts.forEach(walk);
      if (bad.length) {
        const msg = [...new Set(bad)].join('；');
        errors.push({ n: ln.n, msg, line: ln.text || ln.cell?.src || '' });
        if (ln.kind !== 'let') { ln.kind = 'error'; ln.msg = msg; ln.line = ln.text || ''; }
      }
    }
    errors.sort((a, b) => a.n - b.n);
    return { lines, errors, cells };
  }

  function suggest(name) {
    const all = Object.keys(FUNCS);
    const near = all.filter((f) => f.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(f.toLowerCase()));
    return near.length ? `（是不是 ${near.slice(0, 3).join('、')}？）` : `（能用的：${all.filter((f) => /^[a-z]/.test(f)).join(' ')}）`;
  }

  // 顶层按逗号切开（括号里的逗号不算）
  function splitTop(s) {
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

  // —— 运行：输入（学生拨的、拖的、折的）+ 描述 → 每个量的值 ——

  function Runtime() {
    this.inputs = new Map(); // 名字|初值写法 → 当前值
    this.folds = new Map(); // 名字|句子 → Set
    this.findCache = new Map();
    this.found = []; // 这次重算里新找到的例子（给页面记一笔）
    this.load('');
  }

  Runtime.prototype.load = function (src) {
    this.src = String(src);
    this.board = parseBoard(this.src);
    this.cells = this.board.cells;
    this.fresh();
    return this.board;
  };

  Runtime.prototype.fresh = function () { this.cache = new Map(); this.busy = new Set(); this.cellErr = new Map(); };

  Runtime.prototype.inputKey = function (cell) { return `${cell.name}|${cell.src}`; };

  Runtime.prototype.get = function (name) {
    if (this.cache.has(name)) return this.cache.get(name);
    if (this.cellErr.has(name)) throw this.cellErr.get(name);
    const cell = this.cells.get(name);
    if (!cell) return undefined;
    if (this.busy.has(name)) throw err(`「${name}」用到了它自己`);
    this.busy.add(name);
    try {
      let v;
      if (cell.input) {
        const key = this.inputKey(cell);
        if (!this.inputs.has(key)) {
          const init = this.eval(cell.ast);
          if (cell.input.type === 'scrub' && !isNum(init)) throw err('能拨的量要一个数');
          if (cell.input.type === 'drag' && !(isVec(init) && init.length === 2)) throw err('能拖的量要一个二维向量，比如 [1, 0]');
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
      if (!e2.cell) e2.cell = name;
      this.cellErr.set(name, e2);
      throw e2;
    } finally {
      this.busy.delete(name);
    }
  };

  Runtime.prototype.setInput = function (name, value) {
    const cell = this.cells.get(name);
    if (!cell || !cell.input) return;
    this.inputs.set(this.inputKey(cell), value);
    this.fresh();
  };

  Runtime.prototype.toggleFold = function (name, i) {
    const v = this.get(name);
    if (!v || v.kind !== 'sentence') return;
    if (v.folded.has(i)) v.folded.delete(i); else v.folded.add(i);
    this.fresh();
  };

  Runtime.prototype.eval = function (ast, scope) {
    const ev = (a) => this.eval(a, scope);
    switch (ast.k) {
      case 'num': return ast.v;
      case 'str': return ast.v;
      case 'id': {
        if (scope && Object.prototype.hasOwnProperty.call(scope, ast.name)) return scope[ast.name];
        if (this.cells.has(ast.name)) return this.get(ast.name);
        if (ast.name in CONSTS) return CONSTS[ast.name];
        throw err(`不认识「${ast.name}」：先用 let 定义它`);
      }
      case 'list': return ast.items.map(ev);
      case 'range': return { kind: 'range', lo: num(ev(ast.a)), hi: num(ev(ast.b)) };
      case 'mem': return member(ev(ast.obj), ast.name);
      case 'un': {
        const a = ev(ast.a);
        if (ast.op === 'not') return !truthy(a);
        if (isNum(a) || Array.isArray(a)) return scale(-1, a);
        throw err('负号只能用在数、向量、矩阵前面');
      }
      case 'call': {
        const f = FUNCS[ast.fn];
        if (!f) throw err(`没有函数「${ast.fn}」`);
        return f(...ast.args.map(ev));
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
          case '/': if (isNum(b)) return scale(1 / b, a); throw err('只能除以一个数');
          case '^': {
            if (isMat(a) && isNum(b) && Number.isInteger(b) && b >= 0) { let r = a.map((row, i) => row.map((_, j) => (i === j ? 1 : 0))); for (let k = 0; k < b; k++) r = mul(r, a); return r; }
            return Math.pow(num(a), num(b));
          }
          case '==': return same(a, b);
          case '!=': return !same(a, b);
          case '>': return num(a) > num(b) + EPS;
          case '<': return num(a) < num(b) - EPS;
          case '>=': return num(a) >= num(b) - EPS;
          case '<=': return num(a) <= num(b) + EPS;
          case '∥': return FUNCS.par(a, b);
        }
      }
    }
    throw err('看不懂这个表达式');
  };

  const truthy = (v) => (Array.isArray(v) ? v.length > 0 : !!v);

  // —— 替老师找例子：find v in 范围 where 条件 ——
  // 条件很少碰巧成立（Belady 异常在随机序列里大约百万分之一），所以不是瞎试，而是「往更接近成立的方向改」：
  // 比较式的差当分数（a > b 时分数是 a − b），and 取最小、or 取最大，模拟退火一点点改，分数 ≥ 0 就是找到了。

  function softScore(rt, ast, scope) {
    if (ast.k === 'bin') {
      const op = ast.op;
      if (op === 'and' || op === '且') return Math.min(softScore(rt, ast.a, scope), softScore(rt, ast.b, scope));
      if (op === 'or' || op === '或') return Math.max(softScore(rt, ast.a, scope), softScore(rt, ast.b, scope));
      if (['>', '<', '>=', '<=', '==', '!='].includes(op)) {
        const a = rt.eval(ast.a, scope), b = rt.eval(ast.b, scope);
        if (isNum(a) && isNum(b)) {
          const d = a - b;
          if (op === '>') return d > EPS ? 0 : d - 1;
          if (op === '>=') return d >= -EPS ? 0 : d;
          if (op === '<') return d < -EPS ? 0 : -d - 1;
          if (op === '<=') return d <= EPS ? 0 : -d;
          if (op === '==') return Math.abs(d) < 1e-7 ? 0 : -Math.abs(d);
          return Math.abs(d) > 1e-7 ? 0 : -1;
        }
      }
    }
    if (ast.k === 'un' && ast.op === 'not') return truthy(rt.eval(ast, scope)) ? 0 : -1;
    return truthy(rt.eval(ast, scope)) ? 0 : -1;
  }

  function rng(seed) {
    let s = seed | 0;
    return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };

  function sampleDom(d, r) {
    const pick = () => d.lo + Math.floor(r() * (d.hi - d.lo + 1));
    if (d.type === 'int') return pick();
    if (d.type === 'seq' || d.type === 'vec') return Array.from({ length: d.n }, pick);
    return Array.from({ length: d.n }, () => Array.from({ length: d.n }, pick));
  }
  function mutate(d, v, r) {
    const pick = () => d.lo + Math.floor(r() * (d.hi - d.lo + 1));
    if (d.type === 'int') return r() < 0.5 ? Math.min(d.hi, Math.max(d.lo, v + (r() < 0.5 ? -1 : 1))) : pick();
    if (d.type === 'mat') { const m = v.map((row) => row.slice()); const i = Math.floor(r() * d.n), j = Math.floor(r() * d.n); m[i][j] = pick(); return m; }
    const c = v.slice();
    const k = Math.floor(r() * c.length);
    c[k] = pick();
    if (d.type === 'seq' && r() < 0.3) { const j = Math.floor(r() * c.length); [c[k], c[j]] = [c[j], c[k]]; }
    return c;
  }

  Runtime.prototype.runFind = function (cell) {
    const f = cell.find;
    const dom = this.eval(f.dom);
    if (!dom || dom.kind !== 'domain') throw err('find … in 后面要写范围：序列(15, 1..6)、整数(1..9)、向量(2, -3..3)、矩阵(2, -3..3)');
    const deps = [...idents(f.cond), ...idents(f.dom)].filter((x) => x !== f.v && this.cells.has(x));
    const key = `${f.src}|${JSON.stringify(deps.map((x) => this.get(x)), (k, v) => (v instanceof Set ? [...v] : v))}`;
    if (this.findCache.has(key)) { const c = this.findCache.get(key); if (c.error) throw err(c.error); return c.value; }
    const r = rng(hash(key));
    const t0 = Date.now();
    let tries = 0, found = null;
    const scoreOf = (v) => { tries++; try { return softScore(this, f.cond, { [f.v]: v }); } catch (e) { if (e.hb) throw e; return -1e9; } };
    outer: for (let restart = 0; restart < 200 && Date.now() - t0 < 400; restart++) {
      let v = sampleDom(dom, r);
      let sc = scoreOf(v);
      for (let it = 0; it < 3000; it++) {
        if (sc >= 0) { found = v; break outer; }
        const T = 1.2 * (1 - it / 3000) + 0.05;
        const c = mutate(dom, v, r);
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
  };

  // —— 追问：set 改量，别的行接在最后 ——
  function applyOps(src, ops) {
    const lines = String(src).replace(/\s+$/, '').split('\n');
    const added = [];
    for (const raw of String(ops).split('\n')) {
      const s = raw.trim();
      if (!s) continue;
      const m = RE.set.exec(s);
      if (m) {
        const at = lines.findIndex((l) => new RegExp(`^\\s*let\\s+${m[1]}\\s*=`).test(l));
        if (at >= 0) {
          // 只给了新值、没写 拨 / 拖 时，留着原来的手势
          const old = lines[at];
          const keep = /\s(拨|scrub|拖|drag)\s|\s(拖|drag)\s*$/.test(old) && !/\s(拨|scrub|拖|drag)(\s|$)/.test(m[2]) ? (RE.scrub.exec(old) || RE.drag.exec(old) || [''])[0] : '';
          lines[at] = `let ${m[1]} = ${m[2].trim()}${keep}`;
        } else lines.push(`let ${m[1]} = ${m[2].trim()}`);
        continue;
      }
      added.push(raw.replace(/\s+$/, ''));
    }
    return [...lines, ...added].join('\n');
  }

  // —— 显示 ——
  function fmtNum(x) {
    if (!isFinite(x)) return Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞';
    const r = Math.round(x);
    if (Math.abs(x - r) < 1e-9) return String(r).replace('-', '−');
    for (let d = 2; d <= 12; d++) {
      const n = Math.round(x * d);
      if (Math.abs(x * d - n) < 1e-9) return `${n < 0 ? '−' : ''}${Math.abs(n)}/${d}`;
    }
    return String(Math.round(x * 100) / 100).replace('-', '−');
  }
  function fmt(v) {
    if (isNum(v)) return fmtNum(v);
    if (typeof v === 'boolean') return v ? '是' : '否';
    if (typeof v === 'string') return v;
    if (isMat(v)) return `[${v.map((r) => r.map(fmtNum).join(' ')).join('; ')}]`;
    if (isVec(v)) return v.length <= 3 ? `(${v.map(fmtNum).join(', ')})` : v.map(fmtNum).join(' ');
    if (Array.isArray(v)) return v.map(fmt).join(' ');
    if (v && v.kind === 'paging') return `${v.alg.toUpperCase()} ${v.f} 块的置换过程`;
    if (v && v.kind === 'sentence') return restOf(v);
    if (v && v.kind === 'range') return `${v.lo}..${v.hi}`;
    return String(v);
  }

  // 学生写的答案 → 值（数、分数、向量、文字）
  function readAnswer(s) {
    const t = String(s).trim().replace(/[（(]/g, '(').replace(/[）)]/g, ')').replace(/，/g, ',').replace(/−/g, '-');
    const n = (x) => { const m = /^(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(x.trim()); return m ? (m[2] ? +m[1] / +m[2] : +m[1]) : null; };
    if (n(t) !== null) return n(t);
    const inner = t.replace(/^\(|\)$/g, '');
    const parts = inner.split(/\s*,\s*|\s+/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => n(p) !== null)) return parts.map(n);
    return t;
  }
  function checkAnswer(given, expected) {
    const g = readAnswer(given);
    if (isNum(expected) && isNum(g)) {
      if (Math.abs(g - expected) < 1e-6 * Math.max(1, Math.abs(expected))) return true;
      // 不是整数的答案，写成保留两位的小数也算对
      return !Number.isInteger(expected) && Math.abs(g - expected) < 0.006;
    }
    if (isVec(expected) && isVec(g)) return same(g, expected);
    return normText(fmt(g)) === normText(fmt(expected));
  }

  return { parseExpr, parseBoard, parseProse, Runtime, applyOps, fmt, fmtNum, checkAnswer, idents, isVec, isMat, isNum, paging, restOf, err };
})();
if (typeof module !== 'undefined') module.exports = HB;
