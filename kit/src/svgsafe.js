// sketch 组件：课堂里的 Claude 当场写的 SVG 示意图，先过一遍这里（纯函数，有测试 tests/sketch.test.js）。
// 只放行图形元素和白名单里的属性：不能有脚本、外部链接、图片、foreignObject；颜色只认调色板的名字，
// 页面换成主题变量（各种黑板风格下都看得清）。写错的地方一条条报出来，课堂里会要求重写。
//
//   <rect x="20" y="20" width="120" height="80" class="blue"/>
//   <line x1="20" y1="60" x2="140" y2="60" class="dashed"/>
//   <path d="M 20 140 Q 80 100 140 140" class="arrow pink"/>
//   <text x="80" y="170">分块</text>
//   <tex x="80" y="10">A_{1}</tex>            公式（KaTeX 写在图上，可以用 \calc）

export const SKETCH_COLORS = { yellow: 'var(--yellow)', pink: 'var(--pink)', blue: 'var(--blue)', green: 'var(--green)', orange: 'var(--orange)', purple: 'var(--lav)', red: 'var(--coral)', white: 'var(--chalk)', gray: 'var(--muted)', grey: 'var(--muted)', chalk: 'var(--chalk)' };
// class 里认的：颜色名 + 这几个样式
export const SKETCH_CLASSES = ['dashed', 'dotted', 'thin', 'thick', 'arrow', 'fill', 'faint', 'bold', 'small', 'big'];
const SHAPES = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
const ELEMENTS = new Set([...SHAPES, 'g', 'text', 'tspan', 'tex']);
const NUM_ATTRS = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'dx', 'dy', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size']);
const ATTRS = {
  common: new Set(['class', 'transform', 'opacity', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity']),
  path: ['d'], line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], g: [], text: ['x', 'y', 'dx', 'dy', 'text-anchor', 'font-size', 'font-weight'],
  tspan: ['x', 'y', 'dx', 'dy', 'font-size', 'font-weight'], tex: ['x', 'y', 'anchor', 'color', 'size'],
};
const MAX_ELEMENTS = 400;
const NUM = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/**
 * 解析 + 清理。src：一串 SVG 元素（不写外面的 <svg>）。
 * 返回 { items: [节点], errors: [中文原因] }。节点：{ tag, attrs: { 名: 值 }, children, text }
 */
export function parseSketch(src) {
  const errors = [];
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let count = 0;
  const s = String(src ?? '');
  let i = 0;
  const err = (m) => { if (errors.length < 8) errors.push(m); };
  while (i < s.length) {
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s[i] === '<') {
      const close = s.indexOf('>', i);
      if (close < 0) { err(`「${s.slice(i, i + 20)}」没有写完（少了 >）`); break; }
      const raw = s.slice(i + 1, close);
      i = close + 1;
      if (raw.startsWith('/')) {
        const name = raw.slice(1).trim();
        const top = stack[stack.length - 1];
        if (stack.length === 1 || top.tag !== name) { err(`</${name}> 和前面的开头对不上`); continue; }
        stack.pop();
        continue;
      }
      if (/^[!?]/.test(raw)) { err(`不认「<${raw.slice(0, 12)}>」：示意图里只写图形元素`); continue; }
      const selfClose = raw.endsWith('/');
      const body = selfClose ? raw.slice(0, -1) : raw;
      const m = body.match(/^\s*([A-Za-z][\w:-]*)([\s\S]*)$/);
      if (!m) { err(`看不懂「<${raw.slice(0, 20)}>」`); continue; }
      const tag = m[1];
      if (!ELEMENTS.has(tag)) {
        err(tag === 'svg' ? '不用写 <svg>：只写里面的元素，大小用 width: / height: 字段' : `不认 <${tag}>：示意图只能用 ${[...SHAPES, 'g', 'text', 'tex'].join('、')}`);
        if (!selfClose) skipTo(tag);
        continue;
      }
      if (++count > MAX_ELEMENTS) { err(`元素太多了（最多 ${MAX_ELEMENTS} 个）`); break; }
      const node = { tag, attrs: parseAttrs(m[2], tag, err), children: [], text: '' };
      const parent = stack[stack.length - 1];
      if (parent.tag === 'text' && tag !== 'tspan') err(`<text> 里只能放 <tspan>（不能放 <${tag}>）`);
      else if (parent.tag !== 'text' && tag === 'tspan') err('<tspan> 只能写在 <text> 里');
      else if (parent.tag === 'tex' || parent.tag === 'tspan') err(`<${parent.tag}> 里只写文字`);
      parent.children.push(node);
      if (!selfClose && !['tex'].includes(tag) && !SHAPES.has(tag)) stack.push(node);
      else if (!selfClose && (SHAPES.has(tag) || tag === 'tex')) {
        // 图形元素写成 <line …></line> 也行；<tex>公式</tex> 读到 </tex> 为止
        const end = s.indexOf(`</${tag}>`, i);
        if (end < 0) { err(`<${tag}> 没有写 </${tag}>（或者写成 <${tag} … />）`); continue; }
        const inner = s.slice(i, end);
        if (tag === 'tex') node.text = decode(inner).trim();
        else if (inner.trim()) err(`<${tag}> 里面不放东西`);
        i = end + tag.length + 3;
      }
      continue;
    }
    const next = s.indexOf('<', i);
    const text = s.slice(i, next < 0 ? s.length : next);
    i = next < 0 ? s.length : next;
    const top = stack[stack.length - 1];
    if (!text.trim()) continue;
    if (top.tag === 'text' || top.tag === 'tspan') {
      if (top.tag === 'text') top.children.push({ tag: '#text', text: decode(text) });
      else top.text += decode(text);
    } else err(`多出来的文字「${text.trim().slice(0, 20)}」：写字用 <text x y>…</text>，公式用 <tex x y>…</tex>`);
  }
  if (stack.length > 1) err(`<${stack[stack.length - 1].tag}> 没有写 </${stack[stack.length - 1].tag}>`);
  if (!root.children.length && !errors.length) err('示意图里什么也没画');
  return { items: root.children, errors };

  // 不认的元素：连同它里面的东西一起跳过
  function skipTo(tag) {
    const end = s.indexOf(`</${tag}>`, i);
    if (end >= 0) i = end + tag.length + 3;
  }
}

function decode(t) {
  return String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseAttrs(src, tag, err) {
  const out = {};
  const re = /\s*([A-Za-z_:][\w:.-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/y;
  let i = 0;
  const allowed = new Set([...ATTRS.common, ...(ATTRS[tag] || [])]);
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m || m.index !== i) { err(`<${tag}> 的属性写错了：「${src.slice(i, i + 20).trim()}」`); break; }
    i = re.lastIndex;
    const name = m[1].toLowerCase();
    const value = decode(m[3] ?? m[4] ?? m[5] ?? '');
    if (/^on/.test(name) || name.includes('href') || name === 'style' || name === 'id' || name === 'filter' || name === 'mask' || name === 'clip-path') {
      err(`<${tag}> 不能写 ${name}=${name === 'style' ? '（颜色写 class="blue"，粗细写 stroke-width）' : ''}`);
      continue;
    }
    if (!allowed.has(name)) { err(`<${tag}> 不认 ${name}=`); continue; }
    const bad = checkValue(name, value, tag);
    if (bad) { err(bad); continue; }
    out[name] = value;
  }
  return out;
}

function checkValue(name, v, tag) {
  if (NUM_ATTRS.has(name)) return NUM.test(v.trim()) ? '' : `<${tag}> 的 ${name}="${v.slice(0, 16)}" 要写数（不带单位）`;
  if (name === 'd') return /^[\sMmLlHhVvCcSsQqTtAaZz0-9eE.,+-]*$/.test(v) && /[Mm]/.test(v) ? '' : `<path> 的 d 只能写路径命令（M L H V C S Q T A Z）和数`;
  if (name === 'points') return /^[\s0-9eE.,+-]+$/.test(v) ? '' : `<${tag}> 的 points 只写数`;
  if (name === 'transform') return /^(\s*(translate|rotate|scale|skewX|skewY|matrix)\s*\([\s0-9eE.,+-]*\)\s*,?)+$/.test(v) ? '' : `<${tag}> 的 transform 只认 translate / rotate / scale 这类`;
  if (name === 'stroke-dasharray') return /^[\s0-9.,]+$/.test(v) ? '' : 'stroke-dasharray 只写数';
  if (name === 'fill' || name === 'stroke' || name === 'color') {
    const c = v.trim().toLowerCase();
    return c === 'none' || (c === 'currentcolor' && name !== 'color') || SKETCH_COLORS[c] ? '' : `颜色只认 ${Object.keys(SKETCH_COLORS).filter((k) => k !== 'grey' && k !== 'chalk').join(' / ')}（或 none），写成 ${name}="blue"、class="blue"（「${v.slice(0, 12)}」不认）`;
  }
  if (name === 'class') {
    const bad = v.split(/\s+/).filter(Boolean).filter((c) => !SKETCH_COLORS[c] && !SKETCH_CLASSES.includes(c));
    return bad.length ? `class 只认颜色名和 ${SKETCH_CLASSES.join(' / ')}（「${bad[0].slice(0, 16)}」不认）` : '';
  }
  if (name === 'text-anchor' || name === 'anchor') return /^(start|middle|end)$/.test(v) ? '' : `${name} 只认 start / middle / end`;
  if (name === 'stroke-linecap') return /^(butt|round|square)$/.test(v) ? '' : 'stroke-linecap 只认 butt / round / square';
  if (name === 'stroke-linejoin') return /^(miter|round|bevel)$/.test(v) ? '' : 'stroke-linejoin 只认 miter / round / bevel';
  if (name === 'font-weight') return /^(normal|bold|\d{3})$/.test(v) ? '' : 'font-weight 只认 normal / bold';
  if (name === 'size') return NUM.test(v.trim()) ? '' : 'size 写数（字号）';
  return '';
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 清理过的节点 → SVG 标记（不含 <tex>，<tex> 由组件画成 HTML 盖在图上）。
 * 每个顶层元素带 data-cmd（从 1 数）：figure highlight、board mark item= 用。颜色换成主题变量（写在 style 里，var() 只在 CSS 里生效）
 */
export function sketchMarkup(items) {
  const out = [];
  items.forEach((n, k) => { if (n.tag !== 'tex') out.push(nodeMarkup(n, k + 1)); });
  return out.join('');
}

function nodeMarkup(n, cmd) {
  if (n.tag === '#text') return esc(n.text);
  const a = { ...n.attrs };
  const cls = String(a.class || '').split(/\s+/).filter(Boolean);
  delete a.class;
  const style = [];
  const color = cls.find((c) => SKETCH_COLORS[c]);
  for (const k of ['fill', 'stroke']) {
    const v = String(a[k] || '').toLowerCase();
    if (SKETCH_COLORS[v]) { style.push(`${k}:${SKETCH_COLORS[v]}`); delete a[k]; }
  }
  if (color) style.push(`--sk:${SKETCH_COLORS[color]}`);
  const classes = ['sk', `sk-${n.tag}`, ...cls.filter((c) => SKETCH_CLASSES.includes(c)).map((c) => `sk-${c}`)];
  // 字号没写时给个默认（写在属性上：CSS 里写字号会盖掉 font-size 属性）
  if ((n.tag === 'text') && a['font-size'] === undefined) a['font-size'] = cls.includes('small') ? '14' : cls.includes('big') ? '24' : '18';
  const attrs = Object.entries(a).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  // 箭头：每种颜色一个 marker（marker 里的颜色不跟着引用它的线走）
  const strokeName = String(n.attrs.stroke || '').toLowerCase();
  const arrowColor = SKETCH_COLORS[strokeName] ? strokeName : color || 'chalk';
  const marker = cls.includes('arrow') && ['path', 'line', 'polyline'].includes(n.tag) ? ` marker-end="url(#lk-sk-a-${arrowColor === 'grey' ? 'gray' : arrowColor})"` : '';
  const head = `<${n.tag}${cmd ? ` data-cmd="${cmd}"` : ''} class="${classes.join(' ')}"${style.length ? ` style="${style.join(';')}"` : ''}${attrs}${marker}`;
  if (n.tag === 'tspan') return `${head}>${esc(n.text)}</tspan>`;
  if (!n.children.length) return `${head}/>`;
  return `${head}>${n.children.map((c) => nodeMarkup(c, 0)).join('')}</${n.tag}>`;
}

/** 图上的公式（<tex>）：[{ cmd, x, y, anchor, color, size, tex }] */
export function sketchLabels(items) {
  return items.map((n, k) => (n.tag === 'tex' ? {
    cmd: k + 1, x: Number(n.attrs.x || 0), y: Number(n.attrs.y || 0), anchor: n.attrs.anchor || 'middle',
    color: n.attrs.color ? SKETCH_COLORS[n.attrs.color.toLowerCase()] : null, size: n.attrs.size ? Number(n.attrs.size) : null, tex: n.text,
  } : null)).filter(Boolean);
}

/** 每个顶层元素的文字（label= 找东西用）：[{ cmd, text }] */
export function sketchTexts(items) {
  const textOf = (n) => (n.tag === '#text' ? n.text : n.tag === 'tex' ? n.text : n.tag === 'tspan' ? n.text : (n.children || []).map(textOf).join(''));
  return items.map((n, k) => ({ cmd: k + 1, text: textOf(n).trim() })).filter((x) => x.text);
}

/** 箭头的 marker（每种颜色一个，id 在整页通用，几张图重复定义也一样） */
export function sketchDefs() {
  const names = Object.keys(SKETCH_COLORS).filter((k) => k !== 'grey');
  return `<defs>${names.map((c) => `<marker id="lk-sk-a-${c}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" style="fill:${SKETCH_COLORS[c]}"/></marker>`).join('')}</defs>`;
}
