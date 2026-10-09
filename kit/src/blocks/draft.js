// draft：草稿区。一块可以用 Apple Pencil 演算的黑板，写的内容保存在这台设备上；
// 写完可以「拿给 Claude 看」，草稿会作为图片附在提问里。
import { parseFields } from '../parse.js';
import { session } from '../session.js';
import { getAI } from '../ai.js';
import { createPad } from '../ink/pad.js';
import { widget, mdToHtml } from './common.js';

let n = 0;
export function draft(el, src) {
  const { fields } = parseFields(src);
  const body = widget(el, { title: fields.title || '草稿 Scratch', cls: 'draft' });
  if (fields.note || fields.q) body.insertAdjacentHTML('beforeend', `<div class="w-note">${mdToHtml(fields.note || fields.q)}</div>`);
  const actions = [];
  const pad = createPad(body, {
    height: Math.min(900, Math.max(160, Number(fields.height) || 320)),
    hint: fields.hint || '在这里演算。用 Apple Pencil 写，手指可以照常滚动页面',
    storageKey: `la-draft:${session.title}:${n++}`,
    actions,
  });
  getAI().then((ai) => {
    if (!ai?.images) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-primary';
    b.textContent = '拿给 Claude 看';
    b.disabled = pad.isEmpty();
    b.addEventListener('click', async () => {
      session.openTutor?.(session.stageOf(el), '这是我的演算过程，帮我看看哪里不对，或者下一步该怎么做？', await pad.toBlob(), el);
    });
    pad.el.querySelector('.pad-bar').appendChild(b);
    new MutationObserver(() => (b.disabled = pad.isEmpty())).observe(pad.el.querySelector('.pad-hint'), { attributes: true });
  });
}
