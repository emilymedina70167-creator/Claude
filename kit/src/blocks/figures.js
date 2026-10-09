// graph（函数图）和 space（三维图）：和 scene 一样有标题、题目、说明，也能 link: 到一个 steps
import { createGraph } from '../graph.js';
import { createSpace } from '../space.js';
import { session } from '../session.js';
import { link } from '../link.js';
import { widget, mdToHtml } from './common.js';

function figure(el, src, create, { cls, title }) {
  const body = widget(el, { title: null, cls });
  const linkId = (src.match(/^\s*link\s*[:：]\s*(\S+)\s*$/m) || [])[1];
  const extra = linkId ? { step: link(linkId).step, t: 1 } : {};
  const api = create(body, src, { extraVars: extra });
  const { fields } = api;
  const titleText = fields.title || title;
  el.querySelector('.widget').insertAdjacentHTML('afterbegin', `<div class="w-title">${mdToHtml(titleText, { inline: true })}</div>`);
  if (fields.q) body.insertAdjacentHTML('beforebegin', `<div class="w-q">${mdToHtml(fields.q)}</div>`);
  if (fields.note) body.querySelector('.w-side').insertAdjacentHTML('beforeend', `<div class="w-note">${mdToHtml(fields.note)}</div>`);
  if (api.error) session.problem(el, cls, `图形描述有误：${api.error}`);
  el.dataset.scene = session.registerScene(el, api, titleText);
  if (linkId) {
    el.dataset.link = linkId;
    link(linkId).on((n) => { extra.step = n; extra.t = 0; api.draw(); api.animate('t', 0, 1, 800); });
  }
}

export const graph = (el, src) => figure(el, src, createGraph, { cls: 'graph', title: '函数图 Graph' });
export const space = (el, src) => figure(el, src, createSpace, { cls: 'space', title: '三维图 3D' });
