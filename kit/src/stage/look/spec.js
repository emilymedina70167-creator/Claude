// look 的写法（第九轮「画面归老师」）：画面上每一样看得见的东西长什么样，都由老师用一行 look 定。纯函数。
//
// 目标：* 全部 < 种类名（card、sentence……：这一类的所有，包括以后新造的）< 固定的几块（say goals dock bar）、东西、贴的字、画的东西
// < 部件（s.3、a.2-5）。同一档按写的先后，后写的盖前写的。属性只写有名字的档（不写 CSS 原文：免得写错、免得把要点的地方压坏），
// 颜色只写名字，每种风格自己定是什么颜色。页面自己的默认样子（DEFAULT_LOOK）也是这种写法，所以没有老师改不了的地方。

export const FIXED = ['say', 'goals', 'dock', 'bar', '*'];
export const KINDS = ['card', 'sentence', 'array', 'matrix', 'tree', 'graph', 'table', 'timeline', 'plane', 'tex', 'node', 'label', 'dial', 'draw'];
export const COLOR = ['ink', 'muted', 'brand', 'gold', 'red', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6'];

// 每个属性能写的值：数组是档，{ min, max } 是数
export const PROPS = {
  frame: ['none', 'line', 'card'],
  bg: ['none', 'soft', 'card', ...COLOR],
  edge: ['none', 'thin', 'thick', ...COLOR],
  radius: { min: 0, max: 24 },
  shadow: ['on', 'off'],
  pad: ['0', 's', 'm', 'l'],
  text: { min: 10, max: 64 },
  font: ['sans', 'serif', 'hand', 'mono'],
  weight: ['normal', 'bold'],
  color: COLOR,
  align: ['left', 'center', 'right'],
  opacity: { min: 0.2, max: 1 },
};

// 页面自己的默认样子：话不带框（2026-11-13 学生说字旁边都是框看着不舒服）；别的不写＝各种东西原来的样子
export const DEFAULT_LOOK = [{ target: 'say', rank: 2, props: { frame: 'none' }, hide: null, base: true }];

/** 一个属性的值对不对；对了返回规整的字符串，不对抛中文 */
export function checkValue(prop, v) {
  const spec = PROPS[prop];
  const s = String(v ?? '').trim();
  if (Array.isArray(spec)) {
    if (!spec.includes(s)) throw new Error(`${prop}= 只能写 ${spec.join(' / ')}`);
    return s;
  }
  const n = Number(s);
  if (!s || !Number.isFinite(n) || n < spec.min || n > spec.max) throw new Error(`${prop}= 写 ${spec.min} 到 ${spec.max} 的数`);
  return String(n);
}

/**
 * 一行 look 读成 { targets: [{ name, rank }], props, hide, always, reset }。
 * has：{ object(w), part(w), label(w), draw(w) } 问舞台上有没有。写错抛中文
 */
export function parseLook(words, opts = {}, has = {}) {
  const flags = new Set();
  const targets = [];
  for (const w of words) {
    if (['hide', 'show', 'always', 'reset'].includes(w)) { flags.add(w); continue; }
    if (w === '*') targets.push({ name: w, rank: 0 });
    else if (KINDS.includes(w)) targets.push({ name: w, rank: 1 });
    else if (FIXED.includes(w) || has.object?.(w) || has.label?.(w) || has.draw?.(w)) targets.push({ name: w, rank: 2 });
    else if (has.part?.(w)) targets.push({ name: w, rank: 3 });
    else throw new Error(`look 写的「${w}」：舞台上没有「${w}」（写 say goals dock bar *、种类名 ${KINDS.slice(0, 4).join(' ')}…，或者东西、部件、贴的字、画的东西的名字）`);
  }
  const props = {};
  for (const [k, v] of Object.entries(opts)) {
    if (!PROPS[k]) throw new Error(`look 没有 ${k}=（能写的：${Object.keys(PROPS).map((p) => `${p}=`).join(' ')}）`);
    props[k] = checkValue(k, v);
  }
  if (!targets.length) throw new Error('要写成 look 目标… 属性=值…（比如 look say frame=none text=24、look card frame=none、look s.3 color=g2）');
  const reset = flags.has('reset');
  const hide = flags.has('hide') ? true : flags.has('show') ? false : null;
  if (!reset && hide == null && !Object.keys(props).length) throw new Error(`look ${targets.map((t) => t.name).join(' ')} 后面写要改什么（frame= bg= text= color=…，或者 hide / show）`);
  const always = flags.has('always');
  if (always) for (const t of targets) if (t.rank !== 0 && t.rank !== 1 && !FIXED.includes(t.name)) throw new Error(`always 只收种类名和 say / goals / dock / bar / *（下节课没有「${t.name}」这个名字；所有题卡写 card）`);
  return { targets, props, hide, always, reset };
}

/**
 * 一个画面元素最后的样子：looks 里和它对得上的（*、它的种类、它的名字、它这个部件）照档、再照先后合并。
 * 返回 { props, hide }（hide 是最后写的 hide / show，没写是 null）
 */
export function resolveLook(looks, { name, kind = null, part = null }) {
  const hit = (t) => t === '*' || (kind && t === kind) || t === name || (part && t === part);
  const list = looks.map((l, i) => ({ l, i })).filter(({ l }) => hit(l.target)).sort((a, b) => a.l.rank - b.l.rank || a.i - b.i);
  const props = {};
  let hide = null;
  for (const { l } of list) {
    Object.assign(props, l.props || {});
    if (l.hide != null) hide = l.hide;
  }
  return { props, hide };
}

// 现状里给老师看的一句
const WORDS = {
  frame: { none: '不带框', line: '细线框', card: '卡片' }, shadow: { on: '有影子', off: '没影子' }, weight: { bold: '粗体', normal: '常规粗细' },
  align: { left: '靠左', center: '居中', right: '靠右' }, font: { sans: '黑体', serif: '宋体', hand: '手写体', mono: '等宽' },
};
const NAMES = { say: '话', goals: '挑战', dock: '底下那一条', bar: '顶上那一条', '*': '全部' };
export function lookWords(props, hide) {
  const bits = Object.entries(props).map(([k, v]) => {
    if (WORDS[k]?.[v]) return WORDS[k][v];
    if (k === 'text') return `字 ${v}`;
    if (k === 'color') return `${v} 色`;
    if (k === 'bg') return `底 ${v}`;
    if (k === 'edge') return `边 ${v}`;
    return `${k}=${v}`;
  });
  if (hide === true) bits.push('藏着');
  return bits.join('、');
}
export const lookName = (t) => NAMES[t] || t;
