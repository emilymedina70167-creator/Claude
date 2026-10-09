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
      <button type="button" class="btn ph-btn">${label}</button>
      <span class="ph-tip muted">在笔记软件里写好，截图后点这里选图，或者直接粘贴截图</span>
      <input type="file" class="ph-file" accept="image/*" multiple hidden>
    </div>
    <div class="ph-thumbs"></div>
    <div class="ph-status" hidden></div>`;
  anchor.insertAdjacentElement('afterend', box);
  const btn = box.querySelector('.ph-btn');
  const file = box.querySelector('.ph-file');
  const thumbs = box.querySelector('.ph-thumbs');
  const statusEl = box.querySelector('.ph-status');
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

  async function take(list) {
    const files = [...list].filter((f) => f && /^image\//.test(f.type)).slice(0, maxCount);
    if (!files.length || busy) return;
    busy = true;
    btn.disabled = true;
    thumbs.innerHTML = files.map((f) => `<img alt="你上传的截图" src="${URL.createObjectURL(f)}">`).join('');
    try { await onPick(files, ui); } finally { busy = false; btn.disabled = false; file.value = ''; }
  }

  btn.addEventListener('click', () => file.click());
  file.addEventListener('change', () => take(file.files));
  (root || box.parentElement).addEventListener('paste', (e) => {
    if (box.hidden) return;
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return;
    e.preventDefault();
    take(imgs);
  });

  getAI().then((ai) => {
    if (!ai?.images) return;
    box.hidden = false;
    maxCount = ai.images.maxCount || maxCount;
    if (ai.images.mediaTypes?.length) file.accept = ai.images.mediaTypes.join(',');
  });
  return { box, ui, disable() { box.hidden = true; } };
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
