// encode 的 mode: do：学生自己画波形。每个半码元点上半格是高、下半格是低；画完点「检查」，页面指出第几位不对、
// 认得出常见错法（约定反了、画成了别的编码，只告诉老师）。判分在 engines/netcode.js 的 judgeDrawn（纯函数，有测试）。
import { canReveal, sameWrong } from '../tries.js';
import { parseFields } from '../parse.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { markDraft } from '../drafts.js';
import { encodeEngine, encodeBits, judgeDrawn, halvesText, ENCODE_NAMES, ENCODE_LEVEL } from '../engines/netcode.js';
import { calcFields, trackFields } from '../stepperspec.js';

export function encodeDo(el, src) {
  const calced = calcFields(parseFields(src).fields, session.vars);
  for (const e of calced.errors) session.problem(el, 'encode', e);
  const tracked = trackFields(calced.fields);
  const { fields } = tracked;
  void fields.mode;
  const input = encodeEngine.parse(fields, src);
  if (input.halves) throw new Error('mode: do 是我自己画波形：写 bits:（要编的比特），不要写 levels:');
  if (input.codes.length !== 1) throw new Error('mode: do 一次画一种编码：code: 只写一种');
  const code = input.codes[0];
  const n = input.bits.length;
  const want = encodeBits(input.bits, code, { start: input.start, up: input.up });
  const drawn = input.bits.map(() => [null, null]);
  const title = fields.title || `画出${ENCODE_NAMES[code]}的波形`;
  const body = widget(el, { title, cls: 'sv-widget sv-encode stepper-act' });
  const pre = code === 'nrzi' || code === 'diffman';
  body.innerHTML = `
    <div class="w-q">${fields.q ? mdToHtml(fields.q) : `把 <b>${input.bits.join('')}</b> 编成${ENCODE_NAMES[code]}${pre ? `（开始之前是${ENCODE_LEVEL[input.start]}电平）` : ''}。`}　<span class="muted">每半个码元点上半格是高、点下半格是低。</span></div>
    <div class="sv-stage ecd-stage"></div>
    <div class="ecd-fb" aria-live="polite" hidden></div>
    <div class="sv-ctrl">
      <button type="button" class="btn btn-primary ecd-check">检查</button>
      <button type="button" class="btn btn-sm ecd-clear">清空</button>
      <button type="button" class="btn btn-sm ecd-reveal" hidden>看答案</button>
      <button type="button" class="btn btn-sm ecd-giveup">想不出来</button>
    </div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}`;
  const stage = body.querySelector('.ecd-stage');
  const fb = body.querySelector('.ecd-fb');
  const btnReveal = body.querySelector('.ecd-reveal');
  const gate = session.gate(el, title);
  let attempts = 0, done = false, bad = -1, t0 = Date.now();

  // 画面：上面一排比特，下面一条波形（画了的实线，没画的半格是虚的中线），每半格分成上下两块可以点
  const slot = 22, lab = 24, top = 26, hgt = 44;
  function draw() {
    const W = n * 2 * slot;
    const H = top + hgt + 18;
    const y = (v) => (v ? top : top + hgt);
    let g = `<svg class="ec-svg ecd-svg" viewBox="${-lab} 0 ${W + lab + 4} ${H}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="画波形">`;
    for (let i = 0; i < n; i++) {
      g += `<text x="${(2 * i + 1) * slot}" y="17" class="ec-bit${bad === i ? ' ecd-badbit' : ''}">${input.bits[i]}</text>`;
      g += `<line x1="${2 * i * slot}" y1="${top - 4}" x2="${2 * i * slot}" y2="${top + hgt + 4}" class="ec-grid"/>`;
      if (bad === i) g += `<rect x="${2 * i * slot}" y="${top - 4}" width="${2 * slot}" height="${hgt + 8}" class="ecd-bad"/>`;
    }
    g += `<line x1="${W}" y1="${top - 4}" x2="${W}" y2="${top + hgt + 4}" class="ec-grid"/>`;
    g += `<line x1="0" y1="${top + hgt / 2}" x2="${W}" y2="${top + hgt / 2}" class="ec-mid"/>`;
    if (pre) g += `<polyline points="-16,${y(input.start)} 0,${y(input.start)}" class="ec-pre"/>`;
    // 波形：连着画了的半格连成一段（中间跳变画竖线）；没画的那半格留空
    let prev = pre ? input.start : null;
    let pts = [];
    const flush = () => { if (pts.length > 1) g += `<polyline points="${pts.join(' ')}" class="ec-line"/>`; pts = []; };
    for (let k = 0; k < 2 * n; k++) {
      const v = drawn[k >> 1][k & 1];
      const x = k * slot;
      if (v == null) { flush(); prev = null; g += `<line x1="${x + 3}" y1="${top + hgt / 2}" x2="${x + slot - 3}" y2="${top + hgt / 2}" class="ecd-empty"/>`; continue; }
      if (prev != null && !pts.length) pts.push(`${x},${y(prev)}`);
      pts.push(`${x},${y(v)}`, `${x + slot},${y(v)}`);
      prev = v;
    }
    flush();
    // 点的地方：每半格上下两块（透明），触控目标够大
    for (let k = 0; k < 2 * n; k++) for (const v of [1, 0]) {
      g += `<rect x="${k * slot}" y="${v ? top - 10 : top + hgt / 2}" width="${slot}" height="${hgt / 2 + 10}" class="ecd-hit" data-k="${k}" data-v="${v}"/>`;
    }
    stage.innerHTML = `${g}</svg>`;
  }
  stage.addEventListener('click', (e) => {
    if (done) return;
    const t = e.target.closest('[data-k]');
    if (!t) return;
    const k = Number(t.dataset.k);
    drawn[k >> 1][k & 1] = Number(t.dataset.v);
    if (bad === k >> 1) bad = -1;
    fb.hidden = true;
    draw();
  });
  markDraft(body, () => (done || drawn.every((h) => h[0] == null && h[1] == null) ? '' : `画到：${halvesText(drawn)}`));

  const say = (cls, html) => { fb.hidden = false; fb.className = `ecd-fb sv-fill-fb ${cls}`; fb.innerHTML = html; };
  const finish = (ok, how = {}) => {
    done = true;
    session.record({ type: 'stepper', engine: 'encode', final: true, title, q: `把 ${input.bits.join('')} 编成${ENCODE_NAMES[code]}，自己画波形`, ok, attempts, revealed: how.revealed || undefined, giveup: how.giveup || undefined, expected: halvesText(want), detail: '画波形', ms: Date.now() - t0, el });
    body.querySelectorAll('.ecd-check, .ecd-clear, .ecd-reveal, .ecd-giveup').forEach((b) => { b.hidden = true; });
    gate?.();
  };
  const showAnswer = () => { want.forEach((h, i) => { drawn[i] = h.slice(); }); bad = -1; draw(); };

  const again = sameWrong();
  body.querySelector('.ecd-check').addEventListener('click', () => {
    if (done) return;
    const r = judgeDrawn(input, drawn);
    if (r.empty >= 0) { bad = -1; draw(); say('is-bad', `第 ${r.empty + 1} 位还没画完（两个半码元都要点）。`); return; }
    const sig = halvesText(drawn);
    if (again.repeat(sig)) return; // 同一个错答案连着再交：不算新的一次，上一次的提示还在
    again.after(sig, r.ok);
    attempts++;
    session.record({ type: 'stepper', engine: 'encode', liveOnly: true, title, q: `把 ${input.bits.join('')} 编成${ENCODE_NAMES[code]}，自己画波形`, value: halvesText(drawn), ok: r.ok, attempts, detail: r.ok ? '画波形' : `画波形：第 ${r.bad + 1} 位开始不对`, misread: r.misread || undefined, el });
    if (r.ok) { bad = -1; draw(); say('is-ok', attempts === 1 ? '✓ 全对。' : `✓ 全对（检查了 ${attempts} 次）。`); finish(true); return; }
    bad = r.bad;
    draw();
    say('is-bad', `第 ${r.bad + 1} 位（是 ${input.bits[r.bad]}）不对${r.bad ? `，前面 ${r.bad} 位都对` : ''}。${pre ? '想想上一位结束时是什么电平。' : ''}`);
    if (canReveal(attempts)) btnReveal.hidden = false;
  });
  body.querySelector('.ecd-clear').addEventListener('click', () => { if (done) return; drawn.forEach((h) => { h[0] = null; h[1] = null; }); bad = -1; fb.hidden = true; draw(); });
  btnReveal.addEventListener('click', () => { showAnswer(); say('', '答案画上了。对着看看第几位想岔了。'); finish(false, { revealed: true }); });
  body.querySelector('.ecd-giveup').addEventListener('click', () => { session.event('giveup', el, { title }); showAnswer(); say('', '答案画上了：每一位先看中间（或开头）该不该跳。'); finish(false, { giveup: true }); });
  draw();
  for (const msg of tracked.unknown()) session.problem(el, 'encode', msg, { soft: true });
}
