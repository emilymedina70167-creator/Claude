// sketch：当场画的示意图。课堂里的 Claude 直接写 SVG 元素（安全检查、配色在 svgsafe.js），
// 图上的公式写 <tex x y>…</tex>（KaTeX 盖在图上）。不用互动、偶尔用一次的图用它，比 scene 自由；
// 课堂里 figure highlight、board mark item= / label= 都能用。
import { parseSketch, sketchMarkup, sketchLabels, sketchTexts, sketchDefs } from '../svgsafe.js';
import { session } from '../session.js';
import { widget, mdToHtml, tex2html, escapeHtml, calcProblems } from './common.js';

const FIELD = /^\s*([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/;
const FIELDS = new Set(['id', 'title', 'width', 'height', 'note', 'caption', 'q']);
const FLASH_MS = 1600;

export function parseSketchBlock(src) {
  const fields = {};
  const svg = [];
  for (const line of String(src).split('\n')) {
    const m = line.match(FIELD);
    if (m && FIELDS.has(m[1].toLowerCase()) && !svg.some((l) => l.trim())) { fields[m[1].toLowerCase()] = m[2].trim(); continue; }
    svg.push(line);
  }
  return { fields, svg: svg.join('\n') };
}

export function sketch(el, src) {
  const { fields, svg } = parseSketchBlock(src);
  const W = Number(fields.width) || 400, H = Number(fields.height) || 240;
  if (!(W >= 40 && W <= 2000 && H >= 40 && H <= 2000)) throw new Error('width / height 写 40 到 2000 之间的数（示意图的坐标范围，图会按屏幕缩放）');
  const { items, errors } = parseSketch(svg);
  if (errors.length) throw new Error(`示意图写法有误：${errors.slice(0, 3).join('；')}`);
  const labels = sketchLabels(items);
  for (const msg of calcProblems([fields.title, fields.note, fields.caption, ...labels.map((l) => l.tex)])) session.problem(el, 'sketch', msg);
  const titleText = fields.title || '';
  const body = widget(el, { title: null, cls: 'sketch' });
  if (titleText) el.querySelector('.widget').insertAdjacentHTML('afterbegin', `<div class="w-title">${mdToHtml(titleText, { inline: true })}</div>`);
  body.innerHTML = `${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="sk-wrap" style="max-width:${Math.round(W * 1.5)}px;aspect-ratio:${W} / ${H}">
      <svg class="sketch-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(titleText || '示意图')}">${sketchDefs()}${sketchMarkup(items)}</svg>
      ${labels.map((l) => `<div class="sk-tex sk-a-${l.anchor}" data-cmd="${l.cmd}" style="left:${(l.x / W) * 100}%;top:${(l.y / H) * 100}%;font-size:calc(${l.size || 19} / ${W} * 100cqw)${l.color ? `;color:${l.color}` : ''}">${tex2html(l.tex)}</div>`).join('')}
    </div>
    ${fields.caption || fields.note ? `<div class="w-note">${mdToHtml(fields.caption || fields.note)}</div>` : ''}`;
  const svgEl = body.querySelector('svg');
  const texts = sketchTexts(items);
  const listeners = {};
  let flashTimer = 0;

  // 课堂：figure highlight / board mark。没有变量，set / play 报错说明
  const api = {
    highlight(index) {
      const i = Number(index);
      if (!Number.isInteger(i) || i < 1) throw new Error('highlight 后面要写第几个元素（从 1 数）');
      if (i > items.length) throw new Error(`示意图里只有 ${items.length} 个元素，没有第 ${i} 个`);
      clearTimeout(flashTimer);
      body.querySelectorAll('.sk-flash').forEach((e) => e.classList.remove('sk-flash'));
      void body.offsetWidth;
      const els = [...body.querySelectorAll(`[data-cmd="${i}"]`)];
      els.forEach((e) => e.classList.add('sk-flash'));
      flashTimer = setTimeout(() => els.forEach((e) => e.classList.remove('sk-flash')), FLASH_MS);
      return els.length > 0;
    },
    set() { throw new Error('示意图（sketch）没有变量，不能 set；要变的图用 scene 或 matrix'); },
    play() { throw new Error('示意图（sketch）没有变量，不能 play；要动的图用 scene 或 matrix'); },
    vars: () => ({}),
    snapshot: () => ({}),
    on(ev, f) { (listeners[ev] ||= []).push(f); return () => { const l = listeners[ev]; l.splice(l.indexOf(f), 1); }; },
    cmdOfLabel(text) {
      const t = String(text ?? '').trim();
      return (texts.find((x) => x.text === t) || texts.find((x) => x.text.replace(/\s+/g, '') === t.replace(/\s+/g, '')))?.cmd || 0;
    },
    labels: () => texts.map((x) => x.text).slice(0, 12),
    // 图上的坐标（和写 SVG 时一样：左上角是原点，向下是 y）→ 页面上的位置
    toClient([x, y]) {
      const r = svgEl.getBoundingClientRect();
      if (!r.width) return null;
      const k = Math.min(r.width / W, r.height / H);
      return { x: r.left + (r.width - W * k) / 2 + x * k, y: r.top + (r.height - H * k) / 2 + y * k };
    },
    range: () => null,
  };
  const id = session.registerScene(el, api, titleText || '示意图');
  el.dataset.scene = id;
}
