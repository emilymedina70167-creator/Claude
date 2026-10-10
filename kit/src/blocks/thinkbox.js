// 写想法的小输入区：打字框 + 「✎ 手写」（Apple Pencil，Claude 转成文字）+「截图」（粘贴笔记软件的截图）。
// steps / recognize / findbug 里所有让学生写理由的地方都用它。手写原图交给 session.keepImages 存起来。
import { getAI } from '../ai.js';
import { createPad } from '../ink/pad.js';
import { photoPicker, transcribe, photoError } from '../photo.js';
import { session } from '../session.js';
import { escapeHtml } from './common.js';
import { FEATURES } from '../features.js';

export function thinkBox(host, { placeholder = '我觉得……', rows = 2, q = '', owner, padHeight = 200, padHint = '用 Apple Pencil 写，写完点「转成文字」' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'tb';
  wrap.innerHTML = `
    <textarea class="tb-text" rows="${rows}" placeholder="${escapeHtml(placeholder)}"></textarea>
    <div class="tb-tools" hidden>
      <button type="button" class="link-btn tb-pen">✎ 手写</button>
      <button type="button" class="link-btn tb-shot">截图</button>
    </div>
    <div class="tb-pad" hidden></div>
    <div class="tb-photo" hidden></div>
    <div class="tb-status muted" hidden></div>`;
  host.appendChild(wrap);
  const ta = wrap.querySelector('.tb-text');
  const padBox = wrap.querySelector('.tb-pad');
  const photoBox = wrap.querySelector('.tb-photo');
  const statusEl = wrap.querySelector('.tb-status');
  const say = (t) => { statusEl.hidden = !t; statusEl.textContent = t || ''; };
  let via = '';
  let pad = null;
  let anchor = null;

  const append = (t) => {
    ta.value = ta.value.trim() ? `${ta.value.trim()}\n${t}` : t;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  getAI().then((ai) => {
    if (!ai?.images || !(FEATURES.handwriting || FEATURES.photo)) return;
    wrap.querySelector('.tb-tools').hidden = false;
    wrap.querySelector('.tb-pen').hidden = !FEATURES.handwriting;
    wrap.querySelector('.tb-shot').hidden = !FEATURES.photo;
    if (!FEATURES.photo) return;
    // 截图一行平时收起来，点「截图」才展开；直接粘贴（在这个组件里）任何时候都可以
    anchor = document.createElement('div');
    photoBox.appendChild(anchor);
    photoPicker(anchor, {
      label: '选截图',
      root: wrap,
      async onPick(files, ui) {
        photoBox.hidden = false;
        ui.status('Claude 正在认你的手写…', 'is-wait');
        session.keepImages(owner || wrap, files);
        try {
          const t = await transcribe(files, q);
          if (!t) { ui.status('没认出文字，换一张清楚点的截图，或者直接打字。', 'is-bad'); return; }
          append(t);
          via = '截图';
          ui.status('已转写到上面的框里，核对一下再提交。', 'is-ok');
        } catch (e) { ui.status(photoError(e), 'is-bad'); }
      },
    });
  });

  wrap.querySelector('.tb-shot').addEventListener('click', () => { photoBox.hidden = !photoBox.hidden; padBox.hidden = true; });
  wrap.querySelector('.tb-pen').addEventListener('click', () => {
    if (!pad) {
      pad = createPad(padBox, {
        height: padHeight,
        hint: padHint,
        actions: [{
          label: '转成文字', primary: true, onClick: async (p) => {
            say('Claude 正在看你写的内容…');
            try {
              const blob = await p.toBlob();
              session.keepImages(owner || wrap, blob);
              const t = await transcribe([blob], q);
              if (!t) { say('没认出文字，写清楚一点再试一次，或者直接打字。'); return; }
              append(t);
              via = '手写';
              say('已转成文字，看看对不对再提交。');
              p.clear();
              padBox.hidden = true;
            } catch (e) { say(photoError(e)); }
          },
        }],
      });
    }
    padBox.hidden = !padBox.hidden;
    photoBox.hidden = true;
  });

  return {
    el: wrap,
    ta,
    get value() { return ta.value.trim(); },
    get via() { return via; },
    clear() { ta.value = ''; via = ''; say(''); },
    lock(on = true) { ta.readOnly = on; wrap.classList.toggle('is-locked', on); padBox.hidden = true; photoBox.hidden = true; },
    focus() { ta.focus({ preventScroll: true }); },
  };
}
