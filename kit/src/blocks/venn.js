// 文氏图 venn（概率第 4 批）：一到三个事件。式子涂色、学生点区域 / 填概率、概率页面算。
// 写法和判法在 prob/vennspec.js，几何在 prob/venngeom.js（都是纯函数）；这里只管画和点。
import { session } from '../session.js';
import { widget, mdToHtml, tex2html, escapeHtml } from './common.js';
import { markDraft } from '../drafts.js';
import { parseVenn, judgeRegion, judgeProb, atomName, readoutOf, atomTexts } from '../prob/vennspec.js';
import { vennLayout, atomAt } from '../prob/venngeom.js';
import { qTeX, qText } from '../prob/num.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const TRIES = 3; // 检查几次没对出「看答案」
// 这一块的式子：A\overline{B}
const atomTeX = (k, names) => names.map((nm, i) => { const t = nm.replace(/^([A-Z])(\d)$/, '$1_$2'); return (k >> i) & 1 ? t : `\\overline{${t}}`; }).join('');
const atomWords = (k, names) => names.map((nm, i) => `${nm} ${(k >> i) & 1 ? '发生' : '不发生'}`).join('、');

export function venn(el, src) {
  const v = parseVenn(src);
  const title = v.fields.title || '文氏图 Venn';
  const body = widget(el, { cls: 'venn', title });
  for (const msg of v.problems) session.problem(el, 'venn', msg);
  if (!v.n || v.n > 3 || v.problems.some((m) => /sets|名字|1 到 3 个/.test(m))) {
    body.innerHTML = `<div class="block-error">文氏图画不出来：${escapeHtml(v.problems[0] || '要写 sets: A B')}</div>`;
    return;
  }
  const L = vennLayout(v.n);
  const hasProbAsk = v.asks.some((a) => a.kind === 'prob');
  const showProbs = v.fields.probs ? !/^(off|no|否)$/i.test(v.fields.probs) : !hasProbAsk;
  const texts = showProbs ? atomTexts(v) : null;

  body.innerHTML = `
    ${v.fields.q ? `<div class="w-q">${mdToHtml(v.fields.q)}</div>` : ''}
    <div class="vn-body">
      <div class="vn-plot"></div>
      <div class="vn-side">
        ${v.shades.length ? `<div class="vn-legend">${v.shades.map((s, i) => `<span class="vn-key"><i class="vn-swatch s${i % 4}"></i>${tex2html(s.tex)}</span>`).join('')}</div>` : ''}
        ${v.finds.length ? `<div class="vn-finds">${v.finds.map((f) => `<div class="vn-find">${mdToHtml(readoutOf(f, v), { inline: true })}</div>`).join('')}</div>` : ''}
        <div class="vn-tip" hidden></div>
        <div class="vn-ask" hidden></div>
        ${v.fields.note ? `<div class="w-note">${mdToHtml(v.fields.note)}</div>` : ''}
      </div>
    </div>`;

  // —— 图 ——
  const svg = svgEl('svg', { viewBox: `0 0 ${L.w} ${L.h}`, class: 'venn-svg', role: 'img', 'aria-label': `${v.names.join('、')} 的文氏图` }, body.querySelector('.vn-plot'));
  const atomEls = L.atoms.map((a) => svgEl('path', { d: a.d, class: 'vn-atom', 'fill-rule': 'evenodd', 'data-k': a.k }, svg));
  v.shades.forEach((s, i) => { for (const k of s.atoms) svgEl('path', { d: L.atoms[k].d, class: `vn-shade s${i % 4}`, 'fill-rule': 'evenodd' }, svg); });
  const pickLayer = svgEl('g', { class: 'vn-picks' }, svg);
  svgEl('rect', { x: 1, y: 1, width: L.w - 2, height: L.h - 2, rx: 10, class: 'vn-frame' }, svg);
  L.circles.forEach((c, i) => {
    svgEl('circle', { cx: c.cx, cy: c.cy, r: c.r, class: 'vn-ring' }, svg);
    const t = svgEl('text', { x: c.label.x, y: c.label.y, class: 'vn-name' }, svg);
    t.textContent = v.names[i];
  });
  svgEl('text', { x: L.w - 14, y: 22, class: 'vn-name vn-omega' }, svg).textContent = 'Ω';
  if (texts) L.atoms.forEach((a, k) => { if (texts[k] !== null) svgEl('text', { x: a.at.x, y: a.at.y, class: 'vn-p' }, svg).textContent = v.probs.status === 'unique' ? qText(v.probs.p[k]) : qText(v.probs.lo[k]); });

  // —— 学生要做的 ——
  const askBox = body.querySelector('.vn-ask'), tip = body.querySelector('.vn-tip');
  const state = { i: 0, picked: new Set(), tries: 0, done: !v.asks.length, shown: null, checked: '' };
  const gateDone = v.asks.length ? session.gate(el, title) : null;
  const cur = () => (state.done ? null : v.asks[state.i]);
  const names = (ks) => [...ks].sort((a, b) => a - b).map((k) => atomName(k, v.names)).join('、');

  function paintPicks() {
    pickLayer.textContent = '';
    const a = cur();
    const show = state.shown || (a && a.kind === 'region' ? { atoms: [...state.picked], cls: 'is-picked' } : null);
    if (!show) return;
    for (const k of show.atoms) svgEl('path', { d: L.atoms[k].d, class: `vn-pick ${show.cls}`, 'fill-rule': 'evenodd' }, pickLayer);
  }
  function record(a, ok, extra) {
    session.record({ type: 'venn', title, q: a.q.replace(/\s+/g, ' ').slice(0, 120), ok, attempts: state.tries, el, ...extra });
  }
  function next() {
    state.i++; state.picked = new Set(); state.tries = 0; state.shown = null; state.checked = '';
    if (state.i >= v.asks.length) { state.done = true; gateDone?.(); }
    paintAsk(); paintPicks();
  }
  function settle(a, html, cls) {
    // 这一问有了结果（对了，或者看了答案）：留着画面，给「下一问」
    const last = state.i >= v.asks.length - 1;
    askBox.querySelector('.vn-fb').className = `vn-fb ${cls}`;
    askBox.querySelector('.vn-fb').innerHTML = html;
    askBox.querySelector('.vn-actions').innerHTML = last ? '' : '<button type="button" class="btn btn-primary vn-next">下一问 ›</button>';
    askBox.querySelector('.vn-input')?.setAttribute('disabled', '');
    askBox.dataset.settled = '1';
    if (last) { state.done = true; state.settledLast = true; gateDone?.(); }
    askBox.querySelector('.vn-next')?.addEventListener('click', next);
  }
  function check() {
    const a = cur();
    if (!a || askBox.dataset.settled) return;
    if (a.kind === 'region') {
      const r = judgeRegion(a, [...state.picked]);
      state.tries++;
      record(a, r.ok, { value: names(state.picked) || '（没点）', detail: r.text });
      state.checked = names(state.picked);
      if (r.ok) { state.shown = { atoms: a.atoms, cls: 'is-right' }; paintPicks(); settle(a, `✓ ${escapeHtml(r.text)}`, 'is-ok'); return; }
      fail(a, r.text);
    } else {
      const input = askBox.querySelector('.vn-input').value;
      const r = judgeProb(a, input);
      if (r.ok === null) { askBox.querySelector('.vn-fb').className = 'vn-fb is-hint'; askBox.querySelector('.vn-fb').textContent = r.text; return; }
      state.tries++;
      record(a, r.ok, { value: input.trim(), detail: r.text, ...(r.tag ? { misread: r.tag } : {}) });
      state.checked = input.trim();
      if (r.ok) { settle(a, `✓ ${mdToHtml(`$${a.term.tex} = ${qTeX(a.value)}$`, { inline: true })}`, 'is-ok'); return; }
      fail(a, r.text);
    }
  }
  function fail(a, text) {
    const fb = askBox.querySelector('.vn-fb');
    fb.className = 'vn-fb is-bad';
    fb.innerHTML = `✗ ${escapeHtml(text)}${state.tries >= TRIES ? ' <button type="button" class="link-btn vn-reveal">看答案</button>' : ''}`;
    fb.querySelector('.vn-reveal')?.addEventListener('click', () => {
      if (a.kind === 'region') {
        record(a, false, { value: names(state.picked) || '（没点）', giveup: true, expected: names(a.atoms) || '（一块都没有）' });
        state.shown = { atoms: a.atoms, cls: 'is-answer' }; paintPicks();
        settle(a, `答案是涂出来的这 ${a.atoms.length} 块${a.atoms.length ? '' : '（空集：一块都不点）'}。`, 'is-reveal');
      } else {
        record(a, false, { value: askBox.querySelector('.vn-input').value.trim(), giveup: true, expected: qText(a.value) });
        settle(a, `答案：${mdToHtml(`$${a.term.tex} = ${qTeX(a.value)}$`, { inline: true })}`, 'is-reveal');
      }
    });
  }
  function paintAsk() {
    const a = cur();
    delete askBox.dataset.settled;
    if (!a) { if (!state.settledLast) askBox.hidden = true; return; }
    askBox.hidden = false;
    const count = v.asks.length > 1 ? `<span class="vn-count">${state.i + 1} / ${v.asks.length}</span>` : '';
    askBox.innerHTML = `
      <div class="vn-q">${count}${mdToHtml(a.q, { inline: true })}</div>
      ${a.kind === 'region' ? '<div class="w-hint">在图上点区域（圆外面那一块也能点）；点错了再点一下去掉。</div>'
    : '<div class="vn-fill"><input class="vn-input" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="分数或小数，如 7/10" aria-label="填概率"></div>'}
      <div class="vn-actions"><button type="button" class="btn btn-primary vn-check">检查</button></div>
      <div class="vn-fb" aria-live="polite"></div>`;
    askBox.querySelector('.vn-check').addEventListener('click', check);
    askBox.querySelector('.vn-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  }

  // 点图：有正在做的点区域题就是选 / 不选；别的时候告诉学生这一块是什么
  svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect();
    const k = atomAt(L, ((e.clientX - r.left) * L.w) / r.width, ((e.clientY - r.top) * L.h) / r.height);
    if (k === null) return;
    const a = cur();
    if (a && a.kind === 'region' && !askBox.dataset.settled) {
      if (state.picked.has(k)) state.picked.delete(k); else state.picked.add(k);
      paintPicks();
      return;
    }
    atomEls.forEach((p, i) => p.classList.toggle('is-on', i === k));
    const p = texts && texts[k] !== null ? `，概率 $${texts[k]}$` : '';
    tip.hidden = false;
    tip.innerHTML = mdToHtml(`这一块是 $${atomTeX(k, v.names)}$（${atomWords(k, v.names)}）${p}`, { inline: true });
  });

  // 草稿：点了还没检查的区域、填了还没检查的数，老师下一轮看得到
  markDraft(body, () => {
    const a = cur();
    if (!a || askBox.dataset.settled) return '';
    if (a.kind === 'region') { const s = names(state.picked); return s && s !== state.checked ? `点了 ${s}` : ''; }
    const val = askBox.querySelector('.vn-input')?.value.trim() || '';
    return val && val !== state.checked ? val : '';
  });
  paintAsk();
  paintPicks();
}
