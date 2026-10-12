// derive：分拍板书。一段推导一行一行写出来（像老师在黑板上一行行写），等号对齐，旁边可以写一句。
// 学生点「下一行」往下写；写了 auto: 1.5 就每 1.5 秒自动写一行；课堂里的 Claude 也能 figure set / play step 控制写到第几行、
// highlight 让某一行闪一下、board mark item= 圈某一行。写法在 derivespec.js
import { parseDerive } from '../derivespec.js';
import { session } from '../session.js';
import { link } from '../link.js';
import { widget, mdToHtml, tex2html, calcProblems } from './common.js';
import { figureControls } from '../plot.js';

const reduceMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function derive(el, src) {
  const { fields, lines, start, auto } = parseDerive(src);
  for (const msg of calcProblems([fields.title, fields.q, fields.note, ...lines.map((l) => l.tex), ...lines.map((l) => l.note)])) session.problem(el, 'derive', msg);
  const n = lines.length;
  const titleText = fields.title || '';
  const body = widget(el, { title: null, cls: 'derive' });
  if (titleText) el.querySelector('.widget').insertAdjacentHTML('afterbegin', `<div class="w-title">${mdToHtml(titleText, { inline: true })}</div>`);
  const hasLeft = lines.some((l) => l.left);
  const hasNote = lines.some((l) => l.note);
  body.innerHTML = `${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="dv-scroll"><table class="dv"><tbody>${lines.map((l, k) => `<tr class="dv-line" data-cmd="${k + 1}"${k + 1 > start ? ' hidden' : ''}>
      ${hasLeft ? `<td class="dv-l">${l.left ? tex2html(l.left) : ''}</td>` : ''}<td class="dv-r">${tex2html(l.right)}</td>${hasNote ? `<td class="dv-note">${l.note ? mdToHtml(l.note, { inline: true }) : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    <div class="dv-actions"${start >= n ? ' hidden' : ''}><button type="button" class="btn dv-next">下一行 ↓</button><button type="button" class="btn dv-all">全部写出来</button><span class="dv-count muted"></span></div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}`;
  const rows = [...body.querySelectorAll('.dv-line')];
  const actions = body.querySelector('.dv-actions');
  const count = body.querySelector('.dv-count');

  // 写到第几行：一个叫 step 的「滑块」变量（figure set step=3 / play step 1 4 4s 都走它）
  const slider = { kind: 'slider', name: 'step', min: 1, max: n, step: 1, init: start, mods: {}, srcLine: 'step' };
  const cmds = [...lines.map((l) => ({ kind: 'line', srcLine: l.tex, mods: {} })), slider];
  const state = { slider: { step: start }, override: {} };
  const extra = {};
  const ctl = figureControls({ root: el, cmds, state, extra, env: () => ({ step: shownCount() }), draw: () => draw() });
  slider.sync = () => {};
  let shown = start;
  const shownCount = () => Math.max(1, Math.min(n, Math.floor(Number(state.slider.step) + 1e-9)));

  function draw() {
    const want = shownCount();
    const animate = !reduceMotion();
    rows.forEach((r, k) => {
      const on = k < want;
      if (on && r.hidden) {
        r.hidden = false;
        // 新写的一行：从左往右写出来（一格一格地晚一点）
        if (animate) { r.classList.remove('dv-in'); void r.offsetWidth; r.classList.add('dv-in'); }
      } else if (!on && !r.hidden) r.hidden = true;
    });
    shown = want;
    actions.hidden = shown >= n;
    count.textContent = `${shown} / ${n}`;
    ctl.mark();
    ctl.emit('change', { step: shown });
  }

  // 学生自己往下写：记成动作（课堂刷新后照它恢复，也跟着下一条消息告诉课堂 Claude）
  function advance(to) {
    stopAuto();
    ctl.stop('step');
    state.slider.step = Math.min(n, to);
    draw();
    session.event('drag', el, { name: 'step', value: shown, beat: n });
  }
  body.querySelector('.dv-next').addEventListener('click', () => advance(shown + 1));
  body.querySelector('.dv-all').addEventListener('click', () => advance(n));

  // auto：出现在屏幕上以后，每隔几秒自动写一行
  let autoTimer = 0, io = null;
  function stopAuto() { clearInterval(autoTimer); autoTimer = 0; io?.disconnect(); io = null; }
  if (auto && shown < n) {
    const go = () => {
      if (autoTimer) return;
      autoTimer = setInterval(() => {
        if (!el.isConnected || shown >= n) { stopAuto(); return; }
        state.slider.step = shown + 1;
        draw();
      }, auto * 1000);
    };
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io?.disconnect(); io = null; go(); } });
      io.observe(el);
    } else go();
  }

  if (fields.link) {
    el.dataset.link = fields.link;
    link(fields.link).on((s) => { if (s >= 1) { state.slider.step = Math.min(n, Math.max(shown, s)); draw(); } });
  }

  draw();
  const api = {
    draw,
    on: ctl.on,
    animate: ctl.animate,
    play: ctl.play,
    highlight: ctl.highlight,
    vars: () => ({ step: shown }),
    snapshot: () => ({ step: shown }),
    // 写到第几行：直接跳（新写出来的行自己有从左往右的动画），不补间
    set(name, value) {
      if (name !== 'step') throw new Error(`推导（derive）只有一个变量 step（写到第几行，1 到 ${n}）`);
      const v = Math.round(Number(value));
      if (!(v >= 1 && v <= n)) throw new Error(`step 写 1 到 ${n} 之间的数`);
      stopAuto();
      return ctl.set('step', v, { ms: 0 });
    },
  };
  const id = session.registerScene(el, api, titleText || '推导');
  el.dataset.scene = id;
}
