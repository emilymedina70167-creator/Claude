// 截图作答：在笔记软件里手写，截图后上传（或直接粘贴），由页面里的 Claude 转写。
// 只在页面能把图片发给 Claude 时出现（课件发布时要声明 capabilities: {"sample": {"images": true}}）。
// 转写结果先给学生核对，再走原来的提交 / 检查流程，所以判分逻辑不变。
import { getAI, errorText } from './ai.js';
import { mdToHtml } from './render.js';
import { FEATURES } from './features.js';
import { imageToPng } from './flatten.js';

// 在 anchor 后面插入一行：按钮 + 提示 + 缩略图 + 状态。
// onPick(files, ui) 在学生选好或粘贴图片后调用；ui.status(html, cls) 用来显示进度和结果。
export function photoPicker(anchor, { label = '上传手写截图', root, onPick }) {
  // 暂时关掉（见 features.js）：不放粘贴框，也不接管粘贴、拖放
  if (!FEATURES.photo) return { box: null, ui: { status() {}, lock() {} }, disable() {} };
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
  // 透明底发给 Claude 可能变成黑底看不清（浅色笔迹会先压暗，见 flatten.js），TIFF / PDF 不在 Claude 接受的格式里。
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
  let emptyTimer = 0;
  let inserted = false;

  async function onPaste(e) {
    if (box.hidden || e._phDone) return;
    const dt = e.clipboardData;
    const hasFile = [...(dt?.items || [])].some((it) => it.kind === 'file') || (dt?.files?.length > 0);
    const hasHtmlImg = /<img/i.test(dt?.getData?.('text/html') || '');
    const inZone = e.currentTarget === pasteZone;
    if (!hasFile && !hasHtmlImg) {
      // 在 iPad 上实测：Notability 圈选「拷贝」后粘贴，paste 事件里什么都没有（types 是空的），
      // 但浏览器照常把图插进粘贴框（<img src="blob:…">），由下面的 input 处理。所以这里绝不能拦（以前拦了，图就进不来）；
      // 过一会儿框里还是什么都没有，才告诉学生剪贴板里没有图
      if (inZone) {
        inserted = false;
        clearTimeout(emptyTimer);
        emptyTimer = setTimeout(() => {
          if (!inserted && !busy) ui.status(`没收到图片（剪贴板里是：${escapeHtml(typesOf(dt))}）。在 Notability 里圈选后点「拷贝」，或者用系统截图「拷贝并删除」，再回来长按这个框选「粘贴」。`, 'is-bad');
        }, 1500);
      }
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
  // iPad 的 Safari 粘贴 Notability 圈选内容时不在 paste 事件里给图，而是直接把 <img src="blob:…"> 插进框里：从插进来的图取出来。
  // 先开始读图、再清空框（读图在设 src 时就开始了，不依赖框里那个元素还在）
  pasteZone.addEventListener('input', async () => {
    const srcs = [...pasteZone.querySelectorAll('img, object, embed')].map((n) => n.src || n.data || '').filter(Boolean);
    const typed = !srcs.length && pasteZone.textContent.trim();
    if (!srcs.length) {
      pasteZone.innerHTML = '';
      if (typed) ui.status('这个框只收图片。文字请打在上面的框里。', 'is-bad');
      return;
    }
    inserted = true;
    clearTimeout(emptyTimer);
    const jobs = srcs.slice(0, maxCount).map((src) => imgToBlob(src).catch(() => null));
    pasteZone.innerHTML = '';
    const blobs = (await Promise.all(jobs)).filter(Boolean);
    if (blobs.length) take(blobs);
    else ui.status(`框里出现了图片，但读不出来（${escapeHtml(srcs[0].slice(0, 40))}…）。换成系统截图「拷贝并删除」再粘贴试试。`, 'is-bad');
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
// 转成白底 PNG（透明底的浅色笔迹先压暗）；太大的按比例缩小。4 秒没解码完就算读不出来（有的格式既不成功也不报错）
function imgToBlob(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    const timer = setTimeout(() => reject(new Error('decode timeout')), 4000);
    im.onload = () => { clearTimeout(timer); imageToPng(im, MAX_SIDE).then(resolve, reject); };
    im.onerror = () => { clearTimeout(timer); reject(new Error('decode failed')); };
    im.src = src;
  });
}

async function toPng(f) {
  const url = URL.createObjectURL(f);
  try { return await imgToBlob(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

const RULES = `图片是学生的手写内容（笔记软件截图，或页面手写板导出的白底黑字图）。只转写学生写下的内容：原样照抄，包括写错的地方；不要纠正、不要补全、不要计算、不要评价。公式用 $...$（LaTeX），矩阵用 \\begin{bmatrix}...\\end{bmatrix}，分行的推导保留分行。划掉的内容不转写。看不清的地方写「[看不清]」。`;

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
