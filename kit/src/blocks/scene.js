// scene：可交互图形（写了 goal 就是一个关卡，达成目标才能继续）
import { createScene } from '../scene.js';
import { session } from '../session.js';
import { widget, mdToHtml } from './common.js';

export function scene(el, src) {
  const body = widget(el, { title: null });
  const api = createScene(body, src);
  const { fields } = api;
  const titleText = fields.title || '探索 Explore';
  el.querySelector('.widget').insertAdjacentHTML('afterbegin', `<div class="w-title">${mdToHtml(titleText, { inline: true })}</div>`);
  if (fields.q) body.insertAdjacentHTML('beforebegin', `<div class="w-q">${mdToHtml(fields.q)}</div>`);
  if (fields.note) body.querySelector('.w-side').insertAdjacentHTML('beforeend', `<div class="w-note">${mdToHtml(fields.note)}</div>`);
  if (body.querySelector('.handle')) body.querySelector('.w-side').insertAdjacentHTML('beforeend', '<div class="w-hint">拖动圆点可以移动它。</div>');
  const id = session.registerScene(el, api, titleText);
  if (api.goals) {
    const done = session.gate(el, titleText);
    let hit = 0;
    api.on('goal', () => {
      hit++;
      if (hit >= api.goals) {
        done();
        session.record({ type: 'scene', title: titleText, ok: true, stage: session.stageOf(el) });
      }
    });
  }
  el.dataset.scene = id;
}
