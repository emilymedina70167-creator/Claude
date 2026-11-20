// graph（函数图）和 space（三维图）：和 scene 一样有标题、题目、说明，也能 link: 到一个 steps
import { createGraph } from '../graph.js';
import { createSpace } from '../space.js';
import { session } from '../session.js';
import { link } from '../link.js';
import { widget, mdToHtml } from './common.js';
import { round2 } from '../plot.js';
import { floatVars } from '../exact.js';

function figure(el, src, create, { cls, title }) {
  const body = widget(el, { title: null, cls });
  const linkId = (src.match(/^\s*link\s*[:：]\s*(\S+)\s*$/m) || [])[1];
  const extra = linkId ? { step: link(linkId).step, t: 1 } : {};
  // 整节课的量（let 块）在图里也能直接用，和 scene 一样
  const api = create(body, src, { extraVars: extra, baseVars: floatVars(session.vars) });
  const { fields } = api;
  const titleText = fields.title || title;
  el.querySelector('.widget').insertAdjacentHTML('afterbegin', `<div class="w-title">${mdToHtml(titleText, { inline: true })}</div>`);
  if (fields.q) body.insertAdjacentHTML('beforebegin', `<div class="w-q">${mdToHtml(fields.q)}</div>`);
  if (fields.note) body.querySelector('.w-side').insertAdjacentHTML('beforeend', `<div class="w-note">${mdToHtml(fields.note)}</div>`);
  if (api.error) session.problem(el, cls, `图形描述有误：${api.error}`);
  // 写得通、但多半不是本意的（弧度的图里滑块按角度写）：软提醒
  for (const n of api.notes || []) session.problem(el, cls, n, { soft: true });
  el.dataset.scene = session.registerScene(el, api, titleText);
  // 学生拖完竖线（graph 的 let … drag）：课堂 / 实时黑板记成一个动作；三维图只能转，不发这个事件
  api.on('dragend', (name, value) => session.event('drag', el, { name, value: round2(value) }));
  if (linkId) {
    el.dataset.link = linkId;
    link(linkId).on((n) => { extra.step = n; extra.t = 0; api.draw(); api.animate('t', 0, 1, 800); });
  }
  tasks(el, api, titleText, body);
}

// 函数图里要学生做的事（goal：拖到、调到；pick：在图上点出来）：是关卡，全做到（或看了答案）才过；每次检查记一条作答
function tasks(el, api, titleText, body) {
  if (api.lonelyAfter) session.problem(el, 'graph', 'after / before 要配 goal 或 pick（图里没有要学生做的事，这两个修饰不管用）');
  const side = body.querySelector('.w-side');
  if (body.querySelector('.handle')) side.insertAdjacentHTML('beforeend', '<div class="w-hint">拖动圆点可以移动它。</div>');
  const nGoals = api.goals || 0, nPicks = api.picks || 0;
  if (!nGoals && !nPicks) return;
  if (nPicks) side.insertAdjacentHTML('beforeend', '<div class="w-hint">在图上点出来；点错了再点一下去掉。</div>');
  const done = session.gate(el, titleText);
  let goals = 0, picks = 0;
  const maybe = () => { if (goals >= nGoals && picks >= nPicks) done(); };
  api.on('goal', () => {
    goals++;
    if (goals >= nGoals) session.record({ type: 'graph', title: titleText, ok: true, el });
    maybe();
  });
  api.on('pick', (i, info) => {
    session.record({ type: 'graph', title: titleText, q: info.q, ok: info.ok, value: info.value, detail: info.text, attempts: info.attempts, ...(info.giveup ? { giveup: true, expected: info.expected } : {}), el });
    if (info.done) { picks++; maybe(); }
  });
}

export const graph = (el, src) => figure(el, src, createGraph, { cls: 'graph', title: '函数图 Graph' });
export const space = (el, src) => figure(el, src, createSpace, { cls: 'space', title: '三维图 3D' });
