// scene：可交互图形（写了 goal 就是一个关卡，达成目标才能继续）
import { createScene } from '../scene.js';
import { session } from '../session.js';
import { widget, mdToHtml } from './common.js';
import { link } from '../link.js';
import { round2 } from '../plot.js';

export function scene(el, src) {
  const body = widget(el, { title: null });
  // link: 某个 steps 的 id → 表达式里可以用 step（已揭开的步数）和 t（每揭开一步从 0 动到 1）
  const linkId = (src.match(/^\s*link\s*[:：]\s*(\S+)\s*$/m) || [])[1];
  const extra = linkId ? { step: link(linkId).step, t: 1 } : {};
  const api = createScene(body, src, { extraVars: extra });
  if (linkId) {
    el.dataset.link = linkId;
    link(linkId).on((n) => {
      extra.step = n;
      extra.t = 0;
      api.draw();
      api.animate('t', 0, 1, 800);
    });
  }
  const { fields } = api;
  const titleText = fields.title || '探索 Explore';
  el.querySelector('.widget').insertAdjacentHTML('afterbegin', `<div class="w-title">${mdToHtml(titleText, { inline: true })}</div>`);
  if (fields.q) body.insertAdjacentHTML('beforebegin', `<div class="w-q">${mdToHtml(fields.q)}</div>`);
  if (fields.note) body.querySelector('.w-side').insertAdjacentHTML('beforeend', `<div class="w-note">${mdToHtml(fields.note)}</div>`);
  if (body.querySelector('.handle')) body.querySelector('.w-side').insertAdjacentHTML('beforeend', '<div class="w-hint">拖动圆点可以移动它。</div>');
  const id = session.registerScene(el, api, titleText);
  // 学生拖完一个点（真的挪了位置才算）：课堂 / 实时黑板记成一个动作，数保留两位小数
  api.on('dragend', (name, value) => session.event('drag', el, { name, value: round2(value) }));
  if (api.goals) {
    const done = session.gate(el, titleText);
    let hit = 0;
    api.on('goal', () => {
      hit++;
      if (hit >= api.goals) {
        done();
        session.record({ type: 'scene', title: titleText, ok: true, el });
      }
    });
  }
  el.dataset.scene = id;
}
