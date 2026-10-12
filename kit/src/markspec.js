// 板书标注的写法（课堂的 board mark 和 matrix 组件里的 mark 共用）。纯函数，有测试（tests/marks.test.js）。
//   target=b5 term=mid note="一个数"          公式里 \hl{mid}{…} 那一项，圈出来、旁边写字
//   target=m1 row 2 note="×2" color=pink       matrix 组件的第 2 行，框起来
//   target=fig-1 at=[1, 2] style=arrow note="Ax 在这"
// 解析成 { target, id, sel: { kind, … }, style, color, note, side, of, from, until }
import { tokenize } from './tokens.js';

export const MARK_STYLES = ['circle', 'box', 'underline', 'highlight', 'strike', 'arrow'];
export const MARK_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'red', 'white'];
const STYLE_ALIAS = { 圈: 'circle', 框: 'box', 下划线: 'underline', 涂: 'highlight', 划掉: 'strike', 箭头: 'arrow', cancel: 'strike', ring: 'circle', oval: 'circle', rect: 'box', square: 'box', hl: 'highlight' };
const COLOR_ALIAS = { gold: 'yellow', lav: 'purple', violet: 'purple', coral: 'red', 黄: 'yellow', 粉: 'pink', 蓝: 'blue', 绿: 'green', 橙: 'orange', 紫: 'purple', 红: 'red', 白: 'white' };
const SIDES = { right: 'right', left: 'left', above: 'above', below: 'below', top: 'above', bottom: 'below', 右: 'right', 左: 'left', 上: 'above', 下: 'below' };
// 要跟数字的选择：row 2、entry 2,3
const NUM_SEL = { row: 'row', col: 'col', column: 'col', entry: 'entry', cell: 'entry', block: 'block', step: 'step', item: 'item' };
const DIAG = new Set(['diag', 'diagonal', '对角线', '主对角线']);
const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,64}$/;
const validId = (id) => ID_RE.test(id) && id !== '.' && id !== '..';
const SEL_LIST = 'term=名字、row=2、col=3、diag、entry=2,3、block=1,2、step=2、label=Ax、item=4、at=[1, 2]';
// 矩阵的部位（matrix 组件里只能标这些）
export const MATRIX_SELS = ['row', 'col', 'diag', 'entry', 'block', 'all'];
export const MAX_NOTE = 80;

// 每种「标哪里」不写 style 时的画法
export function defaultStyle(kind) {
  return ['term', 'entry', 'at', 'label', 'item'].includes(kind) ? 'circle' : 'box';
}

function nums(s) {
  const t = String(s ?? '').replace(/[（(）)［\[\]］\s]/g, '').replace(/[，、]/g, ',');
  if (!t) return [];
  return t.split(',').map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
}

// 读一行，不补默认值（块里各行要沿用开头那行写了的东西，得分清写了没写）。写错了抛出中文原因
function readMark(src, inherit = {}, component = false) {
  const spec = {};
  for (const k of ['target', 'color', 'style', 'side', 'of']) if (inherit[k] !== undefined && !(component && k === 'target')) spec[k] = inherit[k];
  let pending = null; // 等着后面跟数字的选择（row、entry……）
  const setSel = (kind, val) => {
    if (spec.sel) throw new Error(`一条标注只能标一处（已经有 ${spec.sel.kind}），要标好几处就写好几行`);
    spec.sel = { kind, ...val };
  };
  const fillNum = (kind, raw) => {
    const ns = nums(raw);
    const two = kind === 'entry' || kind === 'block';
    if (ns.length !== (two ? 2 : 1) || ns.some((n) => !(n >= 1))) {
      throw new Error(two ? `${kind} 后面写两个从 1 数的序号，比如 ${kind}=2,3` : `${kind} 后面写一个从 1 数的序号，比如 ${kind}=2`);
    }
    if (two) setSel(kind, { i: ns[0], j: ns[1] });
    else setSel(kind, kind === 'row' ? { i: ns[0] } : kind === 'col' ? { j: ns[0] } : { k: ns[0] });
  };
  for (const t of tokenize(String(src ?? '').trim())) {
    if (pending && !t.key) {
      fillNum(pending, t.value);
      pending = null;
      continue;
    }
    if (pending) throw new Error(`${pending} 后面要写序号，比如 ${pending}=2`);
    if (t.key) {
      const k = t.key;
      const v = t.value.trim();
      if (k === 'target') { if (component) throw new Error('组件里的 mark 不写 target（标的就是这个组件）'); spec.target = v; }
      else if (k === 'id') spec.id = v;
      else if (k === 'of') { if (!NAME_RE.test(v)) throw new Error(`of 后面写矩阵的名字（只能用字母、数字、- 和 _），比如 of=A`); spec.of = v; }
      else if (k === 'term') { if (!NAME_RE.test(v)) throw new Error(`term 的名字「${v}」只能用字母、数字、- 和 _`); setSel('term', { name: v }); }
      else if (k === 'label') { if (!v) throw new Error('label 后面写图里那个东西的标签，比如 label=Ax'); setSel('label', { text: v }); }
      else if (k === 'at') { if (!/^\[.*\]$/.test(v)) throw new Error('at 后面写图里的坐标，比如 at=[1, 2]'); setSel('at', { expr: v }); }
      else if (NUM_SEL[k]) fillNum(NUM_SEL[k], v);
      else if (k === 'diag') setSel('diag', {});
      else if (k === 'style') { const s = STYLE_ALIAS[v] || v.toLowerCase(); if (!MARK_STYLES.includes(s)) throw new Error(`style 只认 ${MARK_STYLES.join(' / ')}`); spec.style = s; }
      else if (k === 'color' || k === 'colour') { const c = COLOR_ALIAS[v] || COLOR_ALIAS[v.toLowerCase()] || v.toLowerCase(); if (!MARK_COLORS.includes(c)) throw new Error(`color 只认 ${MARK_COLORS.join(' / ')}`); spec.color = c; }
      else if (k === 'note' || k === 'text') spec.note = v;
      else if (k === 'side') { const s = SIDES[v.toLowerCase()] || SIDES[v]; if (!s) throw new Error('side 只认 right / left / above / below'); spec.side = s; }
      else if (k === 'from' || k === 'until') { if (!/^\d+$/.test(v)) throw new Error(`${k} 后面写第几步（数字）`); spec[k] = Number(v); }
      else throw new Error(`看不懂「${k}=」：标哪里用 ${SEL_LIST}；画法用 style=，颜色 color=，旁注 note=`);
      continue;
    }
    const w = t.value;
    const low = w.toLowerCase();
    if (t.quoted) { if (spec.note === undefined) { spec.note = w; continue; } throw new Error(`多了一段引号里的字「${w.slice(0, 20)}」：旁注写成 note="…"`); }
    if (MARK_STYLES.includes(low) || STYLE_ALIAS[w] || STYLE_ALIAS[low]) spec.style = STYLE_ALIAS[w] || STYLE_ALIAS[low] || low;
    else if (MARK_COLORS.includes(low) || COLOR_ALIAS[w] || COLOR_ALIAS[low]) spec.color = COLOR_ALIAS[w] || COLOR_ALIAS[low] || low;
    else if (DIAG.has(low)) setSel('diag', {});
    else if (NUM_SEL[low]) pending = NUM_SEL[low];
    else if (/^(row|col|column|entry|cell|block|step|item)\d/.test(low)) fillNum(NUM_SEL[low.match(/^[a-z]+/)[0]], low.replace(/^[a-z]+/, ''));
    else throw new Error(`看不懂「${w.slice(0, 30)}」：标哪里用 ${SEL_LIST}`);
  }
  if (pending) throw new Error(`${pending} 后面要写序号，比如 ${pending}=2`);
  return spec;
}

// 补上默认值、查一遍。写错了抛出中文原因
function finishMark(raw, component = false) {
  const spec = { ...raw };
  if (!spec.sel) spec.sel = { kind: 'all' };
  if (component && !MATRIX_SELS.includes(spec.sel.kind)) {
    throw new Error(`matrix 组件里的 mark 只能标 row、col、diag、entry、block（「${spec.sel.kind}」用在 board mark 里）`);
  }
  if (!component && (spec.from !== undefined || spec.until !== undefined)) throw new Error('from / until 只用在 matrix 组件里的 mark（跟着 step 出现）；board mark 写了就一直在，用 board unmark 擦掉');
  if (spec.id !== undefined && !validId(spec.id)) throw new Error(`标注的 id「${spec.id}」只能用字母、数字和 _ - . ~ : @ +`);
  if (!component && !spec.target) throw new Error('mark 缺少 target（段的 id，或者组件的 id:），比如 mark target=b5 term=mid');
  if (!component && !validId(spec.target)) throw new Error(`target「${spec.target}」不合法`);
  spec.color ||= 'yellow';
  spec.style ||= defaultStyle(spec.sel.kind);
  if (spec.note !== undefined) {
    spec.note = String(spec.note).trim();
    if (!spec.note) delete spec.note;
    else if ([...spec.note].length > MAX_NOTE) throw new Error(`旁注太长了（最多 ${MAX_NOTE} 个字），要说的多就写在板上`);
  }
  return spec;
}

/**
 * 解析一条标注。opts.inherit：沿用的字段（块里各行沿用开头那行的 target、颜色……）；
 * opts.component：写在 matrix 组件里（没有 target，只能标矩阵的部位）。
 * 返回 { spec } 或 { error }（中文原因）
 */
export function parseMarkSpec(src, { inherit = {}, component = false } = {}) {
  try {
    return { spec: finishMark(readMark(src, inherit, component), component) };
  } catch (e) {
    return { error: e.message };
  }
}

/** board mark 开头那行（不含 mark）：先查一遍写法，块里的内容等块闭合后再拼（parseMarkBlock）。返回 { head } 或 { error } */
export function parseMarkHead(src) {
  try {
    const head = readMark(src);
    if (head.target !== undefined && !validId(head.target)) throw new Error(`target「${head.target}」不合法`);
    return { head };
  } catch (e) {
    return { error: e.message };
  }
}

// 块里一行：空行、# 开头的说明不算
const markLines = (body) => String(body ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(#|\/\/)/.test(l));

/**
 * 一个 board mark 块：开头那行 + 块里每行一条。
 *   开头那行的 target、颜色、画法、side、of 块里各行沿用（各行自己写了就用自己的）；
 *   开头那行自己指了地方（term= row= …）或写了旁注，它也算一条；块里没有内容时开头那行就是一条
 *   （只写 target 就是框住整个目标）。
 * 返回 { marks: [spec], errors: ['第 2 行：…'] }；开头那行就写错了时返回 { error }
 */
export function parseMarkBlock(headSrc, body) {
  const h = parseMarkHead(headSrc);
  if (h.error) return { error: h.error };
  const head = h.head;
  const marks = [];
  const errors = [];
  const lines = markLines(body);
  if (!lines.length || head.sel || head.note !== undefined) {
    try { marks.push(finishMark(head)); } catch (e) { errors.push(lines.length ? `开头那行：${e.message}` : e.message); }
  }
  const inherit = { target: head.target, color: head.color, style: head.style, side: head.side, of: head.of };
  lines.forEach((line, k) => {
    try { marks.push(finishMark(readMark(line, inherit))); } catch (e) { errors.push(`第 ${k + 1} 行「${line.slice(0, 30)}」：${e.message}`); }
  });
  return { marks, errors };
}

/**
 * board unmark：unmark id=m3 / unmark m3 m4 / unmark target=b5 / unmark all。
 * 不带 key 的词：像 m3 这样的是标注 id，别的当 target（页面执行时还会按标注 id 再找一遍）。
 * 返回 { ids, targets, all } 或 { error }
 */
export function parseUnmark(src) {
  const out = { ids: [], targets: [], all: false };
  const bad = (v) => ({ error: `看不懂「${String(v).slice(0, 30)}」：写 unmark id=m3、unmark target=b5 或 unmark all` });
  for (const t of tokenize(String(src ?? '').trim())) {
    const low = t.value.toLowerCase();
    if (t.key === 'id') { if (!validId(t.value)) return bad(t.value); out.ids.push(t.value); }
    else if (t.key === 'target') { if (!validId(t.value)) return bad(t.value); out.targets.push(t.value); }
    else if (t.key) return bad(`${t.key}=`);
    else if (low === 'all' || t.value === '全部') out.all = true;
    else if (/^m\d+$/i.test(t.value)) out.ids.push(t.value);
    else if (validId(t.value)) out.targets.push(t.value);
    else return bad(t.value);
  }
  if (!out.all && !out.ids.length && !out.targets.length) return { error: 'unmark 后面写 id=m3（一条标注）、target=b5（这个目标上的全部）或 all（全部）' };
  return out;
}

const SEL_TEXT = {
  all: () => '整个',
  term: (s) => `\\hl{${s.name}}`,
  row: (s) => `第 ${s.i} 行`,
  col: (s) => `第 ${s.j} 列`,
  diag: () => '主对角线',
  entry: (s) => `(${s.i}, ${s.j}) 元`,
  block: (s) => `子块 (${s.i}, ${s.j})`,
  step: (s) => `第 ${s.k} 步`,
  label: (s) => `标签 ${s.text}`,
  item: (s) => `第 ${s.k} 条命令`,
  at: (s) => `点 ${s.expr}`,
};
const STYLE_TEXT = { circle: '圈', box: '框', underline: '下划线', highlight: '涂色', strike: '划掉', arrow: '箭头' };

/** 标在哪（不带 id 和画法）：「b5 的 \hl{mid}」「m1 里 A 的第 2 行」 */
export function markWhere(spec) {
  if (!spec?.sel) return '';
  const sel = (SEL_TEXT[spec.sel.kind] || (() => spec.sel.kind))(spec.sel);
  const of = spec.of ? `${spec.of} 的` : '';
  if (!spec.target) return `${of}${sel}`;
  return spec.sel.kind === 'all' && !of ? `整个 ${spec.target}` : `${spec.target} 里${of}${sel}`;
}

/** 一条标注的中文说明（黑板现状里列给课堂 Claude 看）：m1：b5 里\hl{mid}（圈）「一个数」 */
export function markText(id, spec) {
  if (!spec?.sel) return String(id);
  return `${id}：${markWhere(spec)}（${STYLE_TEXT[spec.style] || spec.style}${spec.color && spec.color !== 'yellow' ? `，${spec.color}` : ''}）${spec.note ? `「${spec.note}」` : ''}`;
}
