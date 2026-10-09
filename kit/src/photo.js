// 截图作答：在笔记软件里手写，截图后上传（或直接粘贴），由页面里的 Claude 转写。
// 只在页面能把图片发给 Claude 时出现（课件发布时要声明 capabilities: {"sample": {"images": true}}）。
// 转写结果先给学生核对，再走原来的提交 / 检查流程，所以判分逻辑不变。
import { getAI, errorText } from './ai.js';
import { mdToHtml } from './render.js';

// 在 anchor 后面插入一行：按钮 + 提示 + 缩略图 + 状态。
// onPick(files, ui) 在学生选好或粘贴图片后调用；ui.status(html, cls) 用来显示进度和结果。
export function photoPicker(anchor, { label = '上传手写截图', root, onPick }) {
  const box = document.createElement('div');
  box.className = 'ph';
  box.hidden = true;
  box.innerHTML = `
    <div class="ph-row">
      <div class="ph-paste" contenteditable="true" role="textbox" aria-label="在这里粘贴截图" spellcheck="false" autocorrect="off" autocapitalize="off"></div>
      <button type="button" class="btn ph-btn">${label}</button>
      <input type="file" class="ph-file" accept="image/*,application/pdf" multiple hidden>
    </div>
    <div class="ph-thumbs"></div>
    <div class="ph-status" hidden></div>`;
  anchor.insertAdjacentElement('afterend', box);
  const btn = box.querySelector('.ph-btn');
  const file = box.querySelector('.ph-file');
  const thumbs = box.querySelector('.ph-thumbs');
  const statusEl = box.querySelector('.ph-status');
  const pasteZone = box.querySelector('.ph-paste');
  let maxCount = 4;
  let busy = false;

  const ui = {
    status(html, cls = '') {
      statusEl.hidden = !html;
      statusEl.className = `ph-status ${cls}`;
      statusEl.innerHTML = html || '';
    },
    lock(on = true) { btn.disabled = on; },
  };

  // 收到的东西统一转成白底 PNG 再发：Notability 等笔记软件「拷贝」出来的常是透明底 PNG、TIFF 或 PDF，
  // 透明底发给 Claude 可能变成黑底看不清，TIFF / PDF 不在 Claude 接受的格式里。
  async function take(list) {
    const raw = [...list].filter(Boolean).slice(0, maxCount);
    pasteZone.innerHTML = '';
    if (!raw.length || busy) return;
    busy = true;
    btn.disabled = true;
    ui.status('正在读取图片…', 'is-wait');
    try {
      const files = [];
      for (const f of raw) {
        try { files.push(await toPng(f)); } catch { /* 下面统一报错 */ }
      }
      if (!files.length) {
        ui.status(`读不出这张图（格式：${escapeHtml(raw.map((f) => f.type || '未知').join('、'))}）。截一张屏幕截图再粘贴，或者用「${label}」按钮选图。`, 'is-bad');
        return;
      }
      thumbs.innerHTML = files.map((f) => `<img alt="你上传的手写" src="${URL.createObjectURL(f)}">`).join('');
      ui.status('');
      await onPick(files, ui);
    } finally { busy = false; btn.disabled = false; file.value = ''; }
  }

  btn.addEventListener('click', () => file.click());
  file.addEventListener('change', () => take(file.files));

  // 粘贴：iPad 上要先有一个可编辑的地方才会出现「粘贴」菜单，所以放一个粘贴框。
  // 剪贴板里的图可能在 items（iOS 上 files 常为空）、files，或者只在 text/html 里的 <img>。
  async function fromClipboard(dt) {
    const out = [];
    for (const it of dt?.items || []) if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f); }
    if (!out.length) for (const f of dt?.files || []) out.push(f);
    if (!out.length) {
      const html = dt?.getData?.('text/html') || '';
      for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
        try { const b = await imgToBlob(m[1].replace(/&amp;/g, '&')); if (b) out.push(b); } catch { /* 读不到就算了 */ }
      }
    }
    return out;
  }
  const typesOf = (dt) => [...new Set([...(dt?.types || []), ...[...(dt?.items || [])].map((it) => it.type)])].filter(Boolean).join('、') || '空';

  async function onPaste(e) {
    if (box.hidden || e._phDone) return;
    const dt = e.clipboardData;
    const hasFile = [...(dt?.items || [])].some((it) => it.kind === 'file') || (dt?.files?.length > 0);
    const hasHtmlImg = /<img/i.test(dt?.getData?.('text/html') || '');
    const inZone = e.currentTarget === pasteZone;
    if (!hasFile && !hasHtmlImg) {
      if (inZone) { e.preventDefault(); ui.status(`剪贴板里没有图片（里面是：${escapeHtml(typesOf(dt))}）。在 Notability 里圈选后点「拷贝」，再回来长按这个框选「粘贴」。`, 'is-bad'); }
      return; // 在文本框里粘贴文字，照常
    }
    e.preventDefault();
    e._phDone = true;
    const files = await fromClipboard(dt);
    if (files.length) take(files);
    else ui.status(`收到了粘贴，但取不出图片（剪贴板类型：${escapeHtml(typesOf(dt))}）。把这行字发给 Claude，我来适配。`, 'is-bad');
  }
  pasteZone.addEventListener('paste', onPaste);
  (root || box.parentElement).addEventListener('paste', onPaste);
  // 有的浏览器不在 paste 事件里给图片，而是直接把 <img> 插进框里：从插进来的图取出来
  pasteZone.addEventListener('input', async () => {
    const img = pasteZone.querySelector('img, object, embed');
    const src = img?.src || img?.data || '';
    pasteZone.innerHTML = '';
    if (!src) return;
    try {
      const blob = await imgToBlob(src);
      if (blob) take([blob]);
      else throw new Error('empty');
    } catch { ui.status(`框里出现了图片，但读不出来（${escapeHtml(src.slice(0, 40))}…）。把这行字发给 Claude，我来适配。`, 'is-bad'); }
  });
  // 只接收图片，不让在框里打字
  pasteZone.addEventListener('beforeinput', (e) => { if (!/^insertFromPaste|^insertFromDrop/.test(e.inputType)) e.preventDefault(); });
  // iPad 分屏时可以把图片从笔记里直接拖过来
  box.addEventListener('dragover', (e) => { if (!box.hidden) { e.preventDefault(); pasteZone.classList.add('is-over'); } });
  box.addEventListener('dragleave', () => pasteZone.classList.remove('is-over'));
  box.addEventListener('drop', async (e) => {
    pasteZone.classList.remove('is-over');
    if (box.hidden) return;
    e.preventDefault();
    const files = await fromClipboard(e.dataTransfer);
    if (files.length) take(files);
  });

  getAI().then((ai) => {
    if (!ai?.images) return;
    box.hidden = false;
    maxCount = ai.images.maxCount || maxCount;
  });
  return { box, ui, disable() { box.hidden = true; } };
}

const MAX_SIDE = 2400;
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 用浏览器解码（iPad 的 Safari 能直接解码 PNG、JPEG、HEIC、TIFF，以及 PDF 的第一页），
// 画到白底画布上，导出 PNG；太大的按比例缩小。
function imgToBlob(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
      if (!w || !h) { reject(new Error('empty image')); return; }
      const k = Math.min(1, MAX_SIDE / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(im, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    };
    im.onerror = () => reject(new Error('decode failed'));
    im.src = src;
  });
}

async function toPng(f) {
  const url = URL.createObjectURL(f);
  try { return await imgToBlob(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

const RULES = `图片是学生在笔记软件里手写后截的图。只转写学生写下的内容：原样照抄，包括写错的地方；不要纠正、不要补全、不要计算、不要评价。公式用 $...$（LaTeX），矩阵用 \\begin{bmatrix}...\\end{bmatrix}，分行的推导保留分行。划掉的内容不转写。看不清的地方写「[看不清]」。`;

// 把手写的文字回答转写成文本
export async function transcribe(files, question) {
  const ai = await getAI();
  const r = await ai.json(`${RULES}

题目（供你理解学生在写什么）：${question}

只回复一个 JSON 对象：{"transcript": "转写结果"}`, { images: files, modelTier: 'default' });
  return String(r?.transcript || '').trim();
}

const SHAPE_TEXT = {
  number: () => '一个数，例如 "-3/4"',
  vector: (s) => `一个含 ${s.n} 个分量的向量，写成数组，例如 [${Array.from({ length: s.n }, (_, i) => `"${i + 1}"`).join(', ')}]`,
  array: (s) => `${s.n} 个数，按题目要求的顺序写成数组`,
  matrix: (s) => `一个 ${s.r}×${s.c} 的矩阵，按行写成二维数组（${s.r} 行，每行 ${s.c} 个）`,
  vectors: (s) => `${s.count} 个向量，每个 ${s.n} 个分量，写成二维数组（每个向量一行）`,
};

// 读出手写解答里的最终答案（不判对错，只读）：返回 {transcript, final}
export async function readFinal(files, question, shape) {
  const ai = await getAI();
  const r = await ai.json(`${RULES}

题目：${question}
要读出的最终答案形状：${(SHAPE_TEXT[shape.kind] || SHAPE_TEXT.number)(shape)}。每个数写成字符串：整数、小数或分数（如 "-3/4"）。

任务：(1) 转写整张解答；(2) 找出学生写的最终答案（通常在最后、或被圈出 / 写在等号后），按上面的形状给出。只读学生写下的数，不要自己算；学生没写出最终答案、或形状对不上时，final 写 null。

只回复一个 JSON 对象：{"transcript": "转写结果", "final": 按形状的答案或 null}`, { images: files, modelTier: 'default' });
  return { transcript: String(r?.transcript || '').trim(), final: r?.final ?? null };
}

// 校验并展平最终答案，个数不对返回 null
export function flatFinal(final, shape) {
  if (final === null || final === undefined) return null;
  const flat = (Array.isArray(final) ? final.flat(2) : [final]).map((x) => String(x).trim()).filter((x) => x !== '');
  const need = shape.kind === 'number' ? 1
    : shape.kind === 'matrix' ? shape.r * shape.c
    : shape.kind === 'vectors' ? shape.count * shape.n
    : shape.n;
  return flat.length === need ? flat : null;
}

export const photoError = (e) => (e?.code === 'image_rejected' ? '这张图发不出去（格式不支持或太大），换一张截图试试。' : errorText(e));
// 认出的内容按公式渲染出来，方便学生对照自己的手写核对
export const transcriptHtml = (t, open = false) => `<details class="ph-transcript"${open ? ' open' : ''}><summary>Claude 认出的内容</summary><div class="ph-render">${mdToHtml(t)}</div></details>`;
