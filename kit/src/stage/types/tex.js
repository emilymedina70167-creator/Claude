// 舞台上的式子（推导一步一步变形，像 3b1b / Manim 的 TransformMatchingTex）：数据和指令，不碰 DOM（画法在 tex.view.js）。纯函数，有测试（tests/stage-tex.test.js）。
//
//   tex f = "\hl{a}{x^2} + \hl{b}{2x} + 1"     造一个式子（KaTeX）；\hl{名字}{…} 给一项起名字，部件写 f.a
//   retex f "…"                                 换成新的式子：同名的项从旧位置滑到新位置，没名字的、新的淡出淡进
//   next f "= …"                                往下写一行：上一行留着、变淡，同名的项从上一行滑下来；等号自动对齐
//   magnify f.a / strike f.b                       一项单独放大（写在式子下面）/ 一项划掉（约掉、抵消）
// 项的位置要等 KaTeX 画出来才知道：画面量好以后写回 o.geo（带着 o.rev，式子一变旧的就不算数）；
// 没量过的时候（node 里、检查一行时的副本）按字数估一个位置，只给贴字、镜头用
import katex from 'katex';

export const TEX_FONT = 30; // 式子的字号（世界坐标的像素；KaTeX 自己再放大 1.21 倍）
export const MAX_LINES = 5; // 一个推导最多留几行（再写，最上面那行收掉）
export const LINE_GAP = 18; // 推导的两行之间
export const ZOOM = 2; // 放大几倍
export const ZOOM_GAP = 22; // 放大的那一项离式子多远
const MAX_SRC = 400;

const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
// \hl{名字}{…} → 带名字的一段（画面按 data-term 找到这一项）；& 是对齐的地方（不写就按第一个等号对齐）
const MACROS = { '\\hl': '\\htmlData{term=#1}{#2}' };
const trust = (ctx) => ctx.command === '\\htmlData';

/** 公式里 \hl{名字}{…} 一项一项找出来：[{ name, body, start, end }]。写错（少括号、名字不对、套着写、重名）抛错 */
export function scanTerms(src) {
  const s = String(src ?? '');
  const out = [];
  const group = (i) => {
    while (s[i] === ' ') i++;
    if (s[i] !== '{') return null;
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
    }
    return null;
  };
  for (let i = s.indexOf('\\hl'); i >= 0; i = s.indexOf('\\hl', i + 1)) {
    if (/[A-Za-z]/.test(s[i + 3] || '') || (i > 0 && s[i - 1] === '\\')) continue; // \hline、\\hl 不是
    const name = group(i + 3);
    const body = name && group(name.end);
    if (!name || !body) throw new Error('\\hl 要写成 \\hl{名字}{这一项}，比如 \\hl{a}{x^2}');
    if (!/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(name.text)) throw new Error(`项的名字「${name.text}」只用英文字母和数字（字母开头），比如 \\hl{a}{x^2}`);
    if (body.text.includes('\\hl')) throw new Error('\\hl 里面不能再套 \\hl：一项一项并排写');
    if (out.some((t) => t.name === name.text)) throw new Error(`一个式子里项的名字不能重：「${name.text}」用了两次（换个名字，比如 ${name.text}2）`);
    out.push({ name: name.text, body: body.text, start: i, end: body.end });
    i = body.end - 1;
  }
  return out;
}

/** 交给 KaTeX 的样子：行内排但用大号（分式不缩小），& 换成一个看不见的对齐点 */
export function prepTex(src) {
  let s = String(src ?? '');
  let seen = false;
  s = s.replace(/(^|[^\\])&/g, (m, pre) => { if (seen) return pre; seen = true; return `${pre}\\htmlData{anchor=1}{}`; });
  return `${PREFIX}${s}`;
}
const PREFIX = '\\displaystyle ';

/** 一行公式 → KaTeX 的 HTML（画面用；写错了抛错，话给老师看） */
export function texHtml(src) {
  try {
    return katex.renderToString(prepTex(src), { throwOnError: true, strict: false, trust, macros: { ...MACROS }, output: 'html' });
  } catch (e) {
    // 去掉 KaTeX 标出错处的下划线、页面自己加的 \displaystyle（位置也往回数），老师看到的是自己写的那一串
    const msg = String(e?.message || e).replace(/^KaTeX parse error:\s*/, '').replace(/̲/g, '')
      .replace(/…?\\?(?:d?i?s?p?l?a?y)?style /, '…').replace(/at position (\d+)/, (m, k) => `at position ${Math.max(1, Number(k) - PREFIX.length)}`).slice(0, 120);
    throw new Error(`公式写错了（KaTeX：${msg}）`);
  }
}

/** 一行写法 → { src, terms: [{ name, body }] }；顺便让 KaTeX 试一遍，写错当场挡下 */
export function parseLine(src) {
  const s = String(src ?? '').trim();
  if (!s) throw new Error('公式是空的');
  if (s.length > MAX_SRC) throw new Error(`一行公式太长（${s.length} 个字符，最多 ${MAX_SRC}）：拆成几行用 next 往下写`);
  const terms = scanTerms(s);
  texHtml(s);
  return { src: s, terms: terms.map(({ name, body }) => ({ name, body })) };
}

// 项在话里的小块写成什么（舞台的小块只能放字）：常见的写法换成普通的字
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω' };
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ' };
const SYM = { cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', infty: '∞', to: '→', Rightarrow: '⇒', in: '∈', sum: 'Σ', int: '∫', partial: '∂', cdots: '⋯', ldots: '…' };
export function texPlain(tex) {
  let s = String(tex ?? '');
  for (let k = 0; k < 4; k++) s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)').replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
  s = s.replace(/\^\{([^{}]*)\}|\^(\S)/g, (m, a, b) => { const t = a ?? b; return [...t].every((ch) => SUP[ch]) ? [...t].map((ch) => SUP[ch]).join('') : `^${t}`; });
  s = s.replace(/\\(left|right|displaystyle|textstyle|,|;|!|quad|qquad|big|Big|bigl|bigr)\b/g, '');
  s = s.replace(/\\([A-Za-z]+)/g, (m, w) => GREEK[w] ?? SYM[w] ?? w);
  s = s.replace(/[{}]/g, '').replace(/\(([^()]{1,2})\)\//g, '$1/').replace(/\/\(([^()]{1,2})\)/g, '/$1').replace(/&/g, '').replace(/\s+/g, ' ').trim();
  return s || tex;
}

// —— 没量过时的估法：按字数 ——
function estimateLine(line) {
  const plain = texPlain(line.src);
  const tall = /\\[dt]?frac|\\sum|\\int|\\prod|\\binom|\\begin/.test(line.src);
  const w = Math.max(TEX_FONT, Math.round(plain.length * TEX_FONT * 0.62));
  const h = Math.round(TEX_FONT * (tall ? 2.5 : 1.55));
  // 每一项按它在字里的位置分一段
  const terms = {};
  let at = 0;
  for (const t of line.terms) {
    const before = texPlain(line.src.slice(0, Math.max(0, line.src.indexOf(`{${t.body}}`, at))).replace(/\\hl\{[^{}]*\}\{/g, '')).length;
    const len = Math.max(1, texPlain(t.body).length);
    terms[t.name] = { x: Math.round(before * TEX_FONT * 0.62), y: 0, w: Math.round(len * TEX_FONT * 0.62), h };
    at = Math.max(at, line.src.indexOf(`{${t.body}}`, at) + 1);
  }
  return { w, h, eq: null, terms };
}

/** 式子现在的几何：量过的（o.geo 对得上 o.rev）就用量的，没量过就估。坐标都是世界坐标 */
export function geometry(o) {
  if (o.geo && o.geo.rev === o.rev) return o.geo;
  const lines = [];
  let y = o.origin.y;
  for (const l of o.lines) {
    const e = estimateLine(l);
    const x = Math.round(o.origin.cx - e.w / 2);
    lines.push({ id: l.id, x, y, w: e.w, h: e.h, terms: Object.fromEntries(Object.entries(e.terms).map(([k, b]) => [k, { ...b, x: x + b.x, y }])) });
    y += e.h + LINE_GAP;
  }
  return { rev: o.rev, estimated: true, lines };
}
const currentLine = (o) => o.lines[o.lines.length - 1];
const lineGeo = (o, g = geometry(o)) => g.lines.find((l) => l.id === currentLine(o).id) || g.lines[g.lines.length - 1];
/** 放大的那一项在哪：现在这一行的正下方（那儿是空的，离那一项也近），横着对准那一项 */
export function zoomBox(o, g = geometry(o)) {
  if (!o.zoom) return null;
  const L = lineGeo(o, g);
  const t = L?.terms[o.zoom];
  if (!t) return null;
  const w = t.w * ZOOM, h = t.h * ZOOM;
  return { x: t.x + t.w / 2 - w / 2, y: L.y + L.h + ZOOM_GAP, w, h };
}

function makeTerms(id, line, carry = new Map()) {
  return line.terms.map((t) => {
    const was = carry.get(t.name);
    return { obj: id, key: t.name, value: t.body, label: texPlain(t.body), paint: was?.paint ?? null, glow: false, lift: false, dim: was?.dim ?? false, covered: was?.covered ?? false, struck: false };
  });
}

// retex / next 共用：读新的一行、哪一项从哪一项来（同名的；a2=a 这样写的从 a 分出来）
function nextLine(scene, c, h, cmd) {
  const ref = h.words[0];
  const o = scene.objects.get(ref);
  if (!o || o.type !== 'tex') throw new Error(`要写成 ${cmd} 式子的名字 "新的公式"${o ? `（「${ref}」不是式子）` : `（舞台上没有叫「${ref}」的式子）`}`);
  if (h.str == null) throw new Error(`要写成 ${cmd} ${o.id} "新的公式"`);
  const line = parseLine(h.str);
  const old = currentLine(o);
  const names = new Set(line.terms.map((t) => t.name));
  const oldNames = new Set(old.terms.map((t) => t.name));
  const from = new Map();
  for (const [k, v] of Object.entries(h.opts)) {
    if (!names.has(k)) throw new Error(`${cmd} 的 ${k}=${v}：新的式子里没有叫 ${k} 的项`);
    if (!oldNames.has(v)) throw new Error(`${cmd} 的 ${k}=${v}：原来的式子里没有叫 ${v} 的项`);
    from.set(k, v);
  }
  for (const n of names) if (!from.has(n) && oldNames.has(n)) from.set(n, n);
  const carry = new Map();
  for (const [n, src] of from) carry.set(n, o.terms.find((t) => t.key === src));
  return { o, line, from, carry, old };
}

export const tex = {
  type: 'tex',
  label: '式子',
  create: ['tex'],
  // 认得的选项（名字=值，scene.js 的 checkOptions；造它的那一行另外都认 hide=）；retex / next 的 a2=a 是项从哪来，自己查
  options: { retex: '*', next: '*' },
  hint: '（式子：名字.a 是用 \\hl{a}{…} 起了名字的那一项；只有最下面那一行（现在的式子）的项能指）',
  make(scene, c, h, old) {
    if (!h.args.some((a) => a.t === 'eq') || h.str == null) throw new Error('要写成 tex 名字 = "公式"（给一项起名字：\\hl{a}{x^2}，部件写 名字.a）');
    const line = parseLine(h.str);
    const id = h.words[0];
    const est = estimateLine(line);
    const origin = old ? { ...old.origin } : (() => { const s = scene.slotFor(est.w); return { cx: s.x + est.w / 2, y: s.y }; })();
    return { origin, rev: 1, seq: 1, lines: [{ id: 1, ...line }], terms: makeTerms(id, line), zoom: null, geo: null, anchor: null, last: null };
  },
  parts(o) { return o.terms; },
  /** 扣着的一项画成小块不写它的内容（scene.js 的 coverText） */
  coverName: (p, o) => `${o.id} 里扣着的一项`,
  pick(o, mark, sel, word) {
    const names = o.terms.map((t) => t.key);
    if (mark === '#') throw new Error(`「${word}」：式子的项写 ${o.id}.名字（${names.length ? `有的是：${names.map((n) => `${o.id}.${n}`).join('、')}` : '这个式子里还没有起名字的项，用 \\hl{名字}{…} 起'}）`);
    const t = o.terms.find((x) => x.key === sel);
    if (!t) throw new Error(`${o.id} 现在这一行没有叫「${sel}」的项${names.length ? `（有的是：${names.join('、')}）` : '（用 \\hl{名字}{…} 给一项起名字）'}`);
    return [t];
  },
  ref(p) { return `${p.obj}.${p.key}`; },
  partBox(o, p) {
    const g = geometry(o);
    const t = lineGeo(o, g)?.terms[p.key];
    return t ? { ...t } : { x: o.origin.cx, y: o.origin.y, w: 1, h: 1 };
  },
  objectBox(o) {
    const g = geometry(o);
    const boxes = g.lines.map(({ x, y, w, h }) => ({ x, y, w, h }));
    const z = zoomBox(o, g);
    if (z) boxes.push(z);
    const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
    return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
  },
  obstacles(o) {
    const g = geometry(o);
    const out = g.lines.map(({ x, y, w, h }) => ({ x, y, w, h }));
    const z = zoomBox(o, g);
    if (z) out.push(z);
    return out;
  },
  commands: {
    // retex f "…"：换成新的式子（现在这一行），同名的项滑过去、带着颜色
    retex(scene, c, h) {
      const { o, line, from, carry, old } = nextLine(scene, c, h, 'retex');
      const id = ++o.seq;
      o.lines[o.lines.length - 1] = { id, ...line };
      o.terms = makeTerms(o.id, line, carry);
      if (o.zoom && !o.terms.some((t) => t.key === o.zoom)) o.zoom = null;
      o.rev++;
      o.last = { mode: 'retex', from: old.id, to: id, pairs: [...from] };
      return { id: o.id, mode: 'retex', fromLine: old.id, toLine: id, pairs: [...from], gone: old.terms.map((t) => t.name).filter((n) => ![...from.values()].includes(n)) };
    },
    // next f "= …"：往下写一行，上一行留着变淡；同名的项从上一行滑下来
    next(scene, c, h) {
      const { o, line, from, carry, old } = nextLine(scene, c, h, 'next');
      const id = ++o.seq;
      o.lines.push({ id, ...line });
      const dropped = o.lines.length > MAX_LINES ? o.lines.shift().id : null;
      o.terms = makeTerms(o.id, line, carry);
      o.zoom = null;
      o.rev++;
      o.last = { mode: 'next', from: old.id, to: id, pairs: [...from] };
      return { id: o.id, mode: 'next', fromLine: old.id, toLine: id, pairs: [...from], dropped };
    },
    // magnify f.a：这一项放大写在式子下面；unmagnify f 收回
    magnify(scene, c, h) {
      h.strayRefs();
      const ps = h.partsIn();
      if (ps.length !== 1 || scene.objects.get(ps[0].obj)?.type !== 'tex') throw new Error('magnify 要指着式子里的一项，比如 magnify f.a');
      const o = scene.objects.get(ps[0].obj);
      o.zoom = ps[0].key;
      return { id: o.id, term: ps[0].key };
    },
    unmagnify(scene, c, h) {
      const o = scene.objects.get(String(h.words[0] || '').split('.')[0]);
      if (!o || o.type !== 'tex') throw new Error('要写成 unmagnify 式子的名字');
      const was = o.zoom;
      o.zoom = null;
      return { id: o.id, term: was };
    },
    // strike f.b f.c：划掉（约掉、抵消）；unstrike f 全擦掉
    strike(scene, c, h) {
      h.strayRefs();
      const ps = h.partsIn();
      if (!ps.length || ps.some((p) => scene.objects.get(p.obj)?.type !== 'tex')) throw new Error('strike 要指着式子里的项，比如 strike f.b');
      if (h.refsIn().some((r) => !r.includes('.'))) throw new Error('strike 要写划掉哪一项（f.b），不是整个式子');
      ps.forEach((p) => { p.struck = true; });
      return { id: ps[0].obj, terms: ps.map((p) => p.key) };
    },
    unstrike(scene, c, h) {
      h.strayRefs();
      const ps = h.partsIn();
      if (!ps.length) throw new Error('要写成 unstrike f.b（或 unstrike f 全擦掉）');
      ps.forEach((p) => { p.struck = false; });
      return { id: ps[0].obj };
    },
  },
  describe(o) {
    const lines = [`式子 ${o.id}${o.lines.length > 1 ? `（推导写了 ${o.lines.length} 行，上面的变淡留着，最下面一行是现在的）` : ''}：`];
    o.lines.forEach((l, i) => lines.push(`  ${i === o.lines.length - 1 ? '现在' : `第 ${i + 1} 行`}：${l.src}`));
    const bits = (t) => {
      const b = [];
      if (t.paint) b.push(COLOR_NAMES[t.paint]);
      if (t.glow) b.push('亮');
      if (t.dim) b.push('灰');
      if (t.covered) b.push('扣着');
      if (t.struck) b.push('划掉');
      if (o.zoom === t.key) b.push('放大着');
      return b.length ? `（${b.join('、')}）` : '';
    };
    if (o.terms.length) lines.push(`  有名字的项：${o.terms.map((t) => `${o.id}.${t.key}「${t.value}」${bits(t)}`).join('，')}`);
    else lines.push('  现在这一行没有起名字的项（要指着某一项讲，用 \\hl{名字}{…} 起名字）');
    return lines;
  },
  doc: `式子（推导一步一步变形）：
tex f = "\\hl{a}{x^2} + \\hl{b}{2x} + 1"     造一个式子（KaTeX 的写法；\\hl{名字}{…} 给一项起名字，部件写 f.a）
retex f "\\hl{b}{2x} + \\hl{a}{x^2} + 1"     换掉最后一行（原来那一行就没了，要留着就用 next）：同名的项滑到新位置（带着颜色），别的淡出淡进
next f "= \\hl{a}{x^2} + \\hl{b}{2x}"        往下写一行：上一行变淡留着，同名的项从上一行滑下来；等号自动对齐（也能写 & 指定对齐的地方）
retex f "\\hl{a}{x}+\\hl{a2}{x}" a2=a      新的项 a2 也从 a 那里分出来（一项拆成几项）
magnify f.a / unmagnify f             这一项单独放大（写在式子下面）
strike f.b / unstrike f               划掉一项（约掉、抵消）
paint、glow、dim、cover（挖空让学生填）、pulse、ask tap f 对项都有用`,
  example: `tex f = "\\hl{a}{x^2} + \\hl{b}{2x} + \\hl{c}{1}"
paint f.a g1
paint f.c g3
say "这三项能凑成一个完全平方吗？先看两头。"
next f "= \\hl{a}{x^2} + \\hl{b}{2\\cdot x\\cdot 1} + \\hl{c}{1^2}"
glow f.b
ask tap f "中间这一项里的 x 和 1，分别从哪一项来？点一项。"`,
};
