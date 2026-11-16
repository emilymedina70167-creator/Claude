// 版面（docs/board-plan.md 第 4 节）：课堂里的 Claude 自己排板，但不写坐标——它说结构，页面按真实内容排。
// 一块板 = 从上往下几「层」：分栏的一层（cols=7/5：两栏，宽 7:5），或者横跨整块板的一段（col=all）。
// 每一段说放第几栏（col=2），同一栏里按先后从上往下接；页面量出每段多高，栏和栏之间画一道分隔线。
// 这样阅读顺序由结构决定（一栏从上往下读，左右两栏是两件事），也不用它估「这块要几行」。
// 纯函数，不碰 DOM（tests/class-canvas.test.js）。

export const MAX_COLS = 3;

/** cols=7/5、cols=1/1/1、cols=2（两栏等宽）。返回 [权重…] 或 { error } */
export function parseCols(v) {
  const s = String(v ?? '').trim().replace(/[：:，,|｜]/g, '/');
  if (/^[1-3]$/.test(s)) return Array(Number(s)).fill(1);
  const parts = s.split('/').map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.some((x) => !/^\d+(\.\d+)?$/.test(x) || Number(x) <= 0)) return { error: `cols「${v}」看不懂：写几栏的宽度比，比如 cols=7/5（两栏，左宽右窄）、cols=1/1/1（三栏等宽），或者 cols=2` };
  if (parts.length > MAX_COLS) return { error: `cols「${v}」：最多 ${MAX_COLS} 栏` };
  return parts.map(Number);
}

/** col=2 / col=all。返回 1…3、'all' 或 { error } */
export function parseCol(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'all' || s === '全' || s === '通栏') return 'all';
  if (/^[1-3]$/.test(s)) return Number(s);
  return { error: `col「${v}」看不懂：写第几栏（col=1、col=2），横跨整块板写 col=all` };
}

export const colsText = (cols) => (Array.isArray(cols) && cols.length > 1 ? cols.join('/') : '1');

/**
 * 一块板分成几层。segs：这块板上的段，按先后排好 [{ id, col }]（col：1…n 或 'all'，超出栏数的放最后一栏）。
 * 返回 [{ kind: 'cols', cols: [[id…], [id…]] } | { kind: 'all', id }]。col=all 的段自己一层，前后的段各成一层分栏。
 */
export function bandsOf(segs = [], cols = [1]) {
  const n = Math.max(1, Math.min(MAX_COLS, Array.isArray(cols) ? cols.length : 1));
  const out = [];
  let cur = null;
  for (const s of segs) {
    if (s.col === 'all' || n === 1) {
      if (n === 1 && s.col !== 'all') {
        if (!cur) { cur = { kind: 'cols', cols: [[]] }; out.push(cur); }
        cur.cols[0].push(s.id);
        continue;
      }
      out.push({ kind: 'all', id: s.id });
      cur = null;
      continue;
    }
    if (!cur) { cur = { kind: 'cols', cols: Array.from({ length: n }, () => []) }; out.push(cur); }
    const c = Math.max(1, Math.min(n, Number(s.col) || 1));
    cur.cols[c - 1].push(s.id);
  }
  return out;
}

const COL_NAME = (i, n) => (n === 2 ? ['左栏', '右栏'][i] : n === 3 ? ['左栏', '中栏', '右栏'][i] : '');

/**
 * 黑板现状里的「版式」：几栏、每栏从上往下是哪几段、各多高，整块板比一屏长多少。
 * bands：bandsOf 的结果；info(id) → { h（像素）, held, hidden }；widths：每栏大约多宽（像素）；screen：一屏能看多高；total：内容一共多高
 */
// stacked：页面因为两栏差得太多改成了一栏的层 [{ i（第几层，从 0 数）, h（两栏原来多高，「300/1400」）}]
// follow：两栏高矮差得多、但页面照老师排的留着分栏的层 [{ i, col（短的是第几栏，从 0 数）, h }]：短的那栏钉在屏幕上跟着走
export function layoutText({ cols = [1], bands = [], info = () => ({}), widths = [], screen = 0, total = 0, stacked = [], follow = [] } = {}) {
  const n = Array.isArray(cols) ? cols.length : 1;
  const lines = [];
  const seg = (id) => {
    const x = info(id) || {};
    return `${id}${x.held ? '（藏着）' : x.h ? `（高约 ${Math.round(x.h)}）` : ''}`;
  };
  lines.push(n > 1 ? `当前板分 ${n} 栏，宽 ${colsText(cols)}${widths.length ? `（${widths.map((w, i) => `${COL_NAME(i, n)}约 ${Math.round(w)}`).join('、')} 像素）` : ''}。` : `当前板是一栏（整块板宽${widths[0] ? `约 ${Math.round(widths[0])} 像素` : ''}）。`);
  bands.forEach((b, i) => {
    const head = bands.length > 1 ? `第 ${i + 1} 层` : '';
    if (b.kind === 'all') { lines.push(`- ${head ? `${head}：` : ''}横跨整块板 ${seg(b.id)}`); return; }
    if (b.cols.length === 1) { lines.push(`- ${head ? `${head}：` : ''}从上往下 ${b.cols[0].map(seg).join(' → ') || '（空）'}`); return; }
    lines.push(`- ${head ? `${head}（分栏）：` : ''}${b.cols.map((c, k) => `${COL_NAME(k, b.cols.length)} ${c.map(seg).join(' → ') || '（空）'}`).join('；')}`);
  });
  for (const s of stacked) lines.push(`（${bands.length > 1 ? `第 ${s.i + 1} 层` : '这块板'}两栏差得太多${s.h ? `（${s.h.split('/').map((x, k) => `${COL_NAME(k, n)} ${x}`).join('、')}）` : ''}，页面改成了一栏：先左栏、再右栏。分栏只给两边都短、差不多高的东西；长的讲解、长句子、大段英文用一栏。）`);
  for (const f of follow) lines.push(`（${bands.length > 1 ? `第 ${f.i + 1} 层` : '这块板'}两栏高矮差得多${f.h ? `（${f.h.split('/').map((x, k) => `${COL_NAME(k, n)} ${x}`).join('、')}）` : ''}：分栏照你排的留着，短的${COL_NAME(f.col, n)}钉在屏幕上，学生往下滑时它一直在旁边。）`);
  if (screen > 0 && total > 0) lines.push(total > screen + 24 ? `内容一共高约 ${Math.round(total)}，一屏能看约 ${Math.round(screen)}：学生要往下滑${total > screen * 1.6 ? '好几下' : '一下'}。` : `内容一共高约 ${Math.round(total)}，一屏放得下（约 ${Math.round(screen)}）。`);
  return lines.join('\n');
}
