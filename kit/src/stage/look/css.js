// look 画成什么样（第九轮）：老师写的属性换成行内样式；底座给学生的反馈（圈的错、点着的、染的色、亮着的、做到的勾）
// 那几条样式规则另抄一份加 !important 放在后面——行内样式盖得过任何普通规则，盖不过 !important，所以老师的样子再怎么写，
// 反馈照样看得见（设计 11.4）。不用 @layer：学习台别的样式表不在层里，层里的规则一律输给它们。纯函数。

// 选择器里有这些的是「反馈」：页面照学生的动作、老师的 paint 画的状态
export const STATE_TOKENS = ['is-glow', 'is-slip', 'is-pick', 'is-picking', 'is-pick-same', 'is-tap', 'is-press', 'is-met', 'is-was', 'is-wrong', 'is-right',
  'is-covered', 'is-drop', 'is-nodrop', 'is-lift', 'is-lifted', 'is-dim', 'is-hold', 'is-over', 'is-shake', 'is-focus', 'is-bad', 'is-good', 'data-paint'];
const STATE_RE = new RegExp(`(\\.(${STATE_TOKENS.filter((t) => t.startsWith('is-')).join('|')})(?![\\w-]))|\\[data-paint`);

/** 顶层的一条条规则：{ sel, body, raw }；@ 开头的整块是 { at: true, raw } */
function rules(css) {
  const src = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    let depth = 1, j = open + 1, quote = null;
    for (; j < src.length && depth; j++) {
      const ch = src[j];
      if (quote) { if (ch === quote && src[j - 1] !== '\\') quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    const raw = src.slice(i, j).trim();
    if (head.startsWith('@')) out.push({ at: true, raw });
    else out.push({ sel: head, body: src.slice(open + 1, j - 1), raw });
    i = j;
  }
  return out;
}

/** 分成 base（原样）和 state（选择器里有反馈记号的那些规则；@media、@keyframes 整块留在 base） */
export function splitState(css) {
  const base = [], state = [];
  for (const r of rules(css)) (r.at || !STATE_RE.test(r.sel) ? base : state).push(r.raw);
  return { base: base.join('\n'), state: state.join('\n') };
}

/** 每一条声明加 !important（已经有的不重复加） */
export function importantState(css) {
  return rules(css).map((r) => {
    if (r.at) return r.raw;
    const decls = r.body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => (/!important\s*$/.test(d) ? d : `${d} !important`));
    return `${r.sel} { ${decls.join('; ')}; }`;
  }).join('\n');
}

/** 舞台的整份样式：原来的 + 反馈规则的 important 副本（放在后面） */
export function stageStyles(css) {
  return `${css}\n/* 底座的反馈永远在老师的样子上面（look/css.js） */\n${importantState(splitState(css).state)}`;
}

export const COLOR_VAR = { ink: 'var(--st-ink)', muted: 'var(--st-muted)', brand: 'var(--st-brand)', gold: 'var(--st-gold)', red: 'var(--st-red)',
  g1: 'var(--st-g1)', g2: 'var(--st-g2)', g3: 'var(--st-g3)', g4: 'var(--st-g4)', g5: 'var(--st-g5)', g6: 'var(--st-g6)' };
const DROP = '0 10px 26px -18px rgb(var(--shade-rgb, 25 45 40) / 0.45)';
const FONT = { sans: 'var(--sans, sans-serif)', serif: 'var(--display, serif)', hand: 'var(--hand, cursive)', mono: 'ui-monospace, "SF Mono", Menlo, monospace' };
const PAD = { 0: '0', s: '4px 8px', m: '8px 14px', l: '14px 20px' };

// 每一类画面元素收哪些属性（表外的当场报「对它不适用」：apply.js）
export const APPLIES = {
  box: ['frame', 'bg', 'edge', 'radius', 'shadow', 'color', 'font', 'weight', 'align', 'opacity'],
  text: ['color', 'font', 'weight', 'align', 'opacity'],
  line: ['color', 'edge', 'opacity'],
  block: ['frame', 'bg', 'edge', 'radius', 'shadow', 'pad', 'text', 'color', 'font', 'weight', 'align', 'opacity'],
};

/**
 * 属性 → 行内样式（{ CSS 属性: 值 }）。role：box 有框的小件（格子、结点、贴的字的框……）、text 只有字、line SVG 画的线、
 * block 一整块字（话、挑战、贴的字、题卡的一行、画的字：才收 text= 字号、pad= 留白）
 */
export function lookStyle(props, role = 'box') {
  const ok = new Set(APPLIES[role] || []);
  const p = Object.fromEntries(Object.entries(props || {}).filter(([k]) => ok.has(k)));
  const st = {};
  if (role === 'line') {
    if (p.color) st.stroke = COLOR_VAR[p.color];
    if (p.edge) st['stroke-width'] = p.edge === 'none' ? '0' : p.edge === 'thick' ? '3' : p.edge === 'thin' ? '1.5' : '2';
    if (p.edge && COLOR_VAR[p.edge]) st.stroke = COLOR_VAR[p.edge];
    if (p.opacity) st.opacity = p.opacity;
    return st;
  }
  // 框：frame 定一个起点，bg / edge / shadow 再改其中一项
  let bg = null, ring = null, drop = null, touched = false;
  if (p.frame === 'none') { bg = 'transparent'; ring = ''; drop = ''; touched = true; st['border-color'] = 'transparent'; st['-webkit-backdrop-filter'] = 'none'; st['backdrop-filter'] = 'none'; }
  if (p.frame === 'line') { bg = 'transparent'; ring = '0 0 0 1px var(--st-line)'; drop = ''; touched = true; }
  if (p.frame === 'card') { bg = 'var(--st-card)'; ring = '0 0 0 0.5px var(--st-line)'; drop = DROP; touched = true; if (!p.radius) st['border-radius'] = '14px'; }
  if (p.bg) bg = p.bg === 'none' ? 'transparent' : p.bg === 'soft' ? 'color-mix(in srgb, var(--st-ink) 6%, transparent)' : p.bg === 'card' ? 'var(--st-card)' : `color-mix(in srgb, ${COLOR_VAR[p.bg]} 16%, var(--st-card))`;
  if (p.edge) { ring = p.edge === 'none' ? '' : p.edge === 'thin' ? '0 0 0 1px var(--st-line)' : p.edge === 'thick' ? '0 0 0 2px color-mix(in srgb, var(--st-ink) 45%, transparent)' : `0 0 0 1.5px ${COLOR_VAR[p.edge]}`; touched = true; }
  if (p.shadow) { drop = p.shadow === 'on' ? DROP : ''; touched = true; }
  if (bg != null) st.background = bg;
  if (touched) {
    // 没写到的那一半（只写了 shadow=off，框线照旧）：照框的样子补
    const parts = [ring ?? '0 0 0 1px var(--st-line)', drop ?? ''].filter(Boolean);
    st['box-shadow'] = parts.length ? parts.join(', ') : 'none';
  }
  if (p.radius) st['border-radius'] = `${p.radius}px`;
  if (p.pad) st.padding = PAD[p.pad];
  if (p.color) st.color = COLOR_VAR[p.color];
  if (p.font) st['font-family'] = FONT[p.font];
  if (p.weight) st['font-weight'] = p.weight === 'bold' ? '700' : '500';
  if (p.align) st['text-align'] = p.align;
  if (p.opacity) st.filter = `opacity(${p.opacity})`;
  if (p.text) st['font-size'] = `calc(${p.text}px * var(--ts, 1))`;
  return st;
}
