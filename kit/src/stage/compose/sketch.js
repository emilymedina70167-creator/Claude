// 预览的示意图（第八轮）：照求解器排好的框画一张 SVG 交回老师——格子线、行列号、每样东西的框、名字和字的开头。
// 不把网页本身截下来：iPad 的 Safari 栅格化网页坑太多，示意图一定画得出，构图要看的也正是这些。纯函数（sketchPng 要浏览器）。

const NAME = { say: '话', goals: '挑战' };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** items：[{ id, text? }]（text 是这样东西的字的开头，没有就只写名字） */
export function sketchSvg({ boxes, grid, items = [] }) {
  const k = grid.cell;
  const W = Math.round(grid.cols * k), H = Math.round(grid.rows * k);
  const pad = 22;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W + pad}" height="${H + pad}" viewBox="${-pad} ${-pad} ${W + pad} ${H + pad}" font-family="sans-serif">`];
  out.push(`<rect x="${-pad}" y="${-pad}" width="${W + pad}" height="${H + pad}" fill="#fbfaf6"/>`);
  // 格子线：每 4 格一道，边上标列号、行号
  for (let c = 0; c <= grid.cols; c += 4) {
    out.push(`<line x1="${c * k}" y1="0" x2="${c * k}" y2="${H}" stroke="#d9d6cc" stroke-width="1"/>`);
    if (c < grid.cols) out.push(`<text x="${c * k + 2}" y="-6" font-size="11" fill="#8a877c">${c}</text>`);
  }
  if ((grid.cols - 1) % 4) out.push(`<text x="${(grid.cols - 1) * k + 2}" y="-6" font-size="11" fill="#8a877c">${grid.cols - 1}</text>`);
  for (let r = 0; r <= grid.rows; r += 4) {
    out.push(`<line x1="0" y1="${r * k}" x2="${W}" y2="${r * k}" stroke="#d9d6cc" stroke-width="1"/>`);
    if (r < grid.rows) out.push(`<text x="-${pad - 2}" y="${r * k + 12}" font-size="11" fill="#8a877c">${r}</text>`);
  }
  const text = new Map(items.map((it) => [it.id, it.text]));
  for (const [id, b] of boxes) {
    const rigid = id === 'say' || id === 'goals';
    out.push(`<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" rx="8" fill="${rigid ? '#efe8f2' : '#ffffff'}" stroke="${rigid ? '#7b4a86' : '#2b3330'}" stroke-width="1.5"/>`);
    out.push(`<text x="${(b.x + 6).toFixed(1)}" y="${(b.y + 16).toFixed(1)}" font-size="13" font-weight="700" fill="#2b3330">${esc(NAME[id] || id)}</text>`);
    const t = String(text.get(id) || '').slice(0, 20);
    if (t && b.h > 30) out.push(`<text x="${(b.x + 6).toFixed(1)}" y="${(b.y + 32).toFixed(1)}" font-size="12" fill="#5e6b66">${esc(t)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

/** 浏览器里把示意图画成 PNG（给老师看的图） */
export function sketchPng(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('示意图画不出来'))), 'image/png');
    };
    img.onerror = () => reject(new Error('示意图画不出来'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * 预览交回老师的那张「图」（字画的）：一格一个字，每样东西用一个字母填满它占的格子，话是 #、挑战是 *，空着是 ·；
 * 上面一行标列号（每 4 列），下面一行写哪个字母是哪样东西。课堂发给老师的都是文字，这样不多带图、也一定画得出
 */
export function sketchText({ boxes, grid }) {
  const { cols, rows } = grid;
  const map = Array.from({ length: rows }, () => new Array(cols).fill('·'));
  const used = new Set();
  const legend = [];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for (const [id, b] of boxes) {
    let ch = id === 'say' ? '#' : id === 'goals' ? '*' : /^[A-Za-z]$/.test(id) && !used.has(id) ? id : [...letters].find((x) => !used.has(x)) || '?';
    used.add(ch);
    legend.push(`${ch} ${NAME[id] || id}`);
    const c0 = Math.max(0, Math.floor(b.x / grid.cell + 1e-6)), c1 = Math.min(cols, Math.ceil((b.x + b.w) / grid.cell - 1e-6));
    const r0 = Math.max(0, Math.floor(b.y / grid.cell + 1e-6)), r1 = Math.min(rows, Math.ceil((b.y + b.h) / grid.cell - 1e-6));
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) map[r][c] = ch;
  }
  const head = Array.from({ length: cols }, (_, c) => (c % 4 === 0 ? String(c % 10) : ' ')).join('');
  const out = [`    ${head}`];
  map.forEach((row, r) => out.push(`${String(r).padStart(3)} ${row.join('')}`));
  out.push(`（${legend.join('，')}）`);
  return out.join('\n');
}
