// 平行结构 parallel（视觉第 5 批）：并列的几项上下对齐——公共的开头在左边，每一项另起一行、开头的词加粗，连接词标出来。
// ask: starts 学生在一行的句子上点出每一项的第一个词（点对了才排成对齐的样子）；ask: odd 挑出不平行的那一项、再选改法。
// 写法、排行、判法在 entext.js（纯函数）。
import { canReveal, sameWrong } from '../tries.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { markDraft } from '../drafts.js';
import { parseFields } from '../parse.js';
import { parseParallel, parallelRows, judgeStarts, judgeOdd, fixOptions, joinWords } from '../entext.js';

const short = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function parallel(el, src) {
  const { fields } = parseFields(src);
  const p = parseParallel(fields.text || '');
  const ask = String(fields.ask || '').trim().toLowerCase();
  if (ask && !['odd', 'starts'].includes(ask)) throw new Error(`ask 只能写 starts（点出每一项的第一个词）或 odd（挑出不平行的那一项），现在是 ${fields.ask}`);
  const answer = Number(fields.answer);
  if (ask === 'odd' && !(Number.isInteger(answer) && answer >= 1 && answer <= p.items.length)) throw new Error(`ask: odd 要写 answer: 第几项不平行（1 到 ${p.items.length}）`);
  const title = fields.title || '平行结构';
  const body = widget(el, { title, cls: 'en-parallel' });
  const txt = (idx) => escapeHtml(joinWords(idx.map((i) => p.tokens[i].w)));
  const itemHtml = (it, { fixed } = {}) => {
    if (fixed !== undefined) return `<span class="pl-fixed">${escapeHtml(fixed)}</span>`;
    const ws = []; for (let i = it.from; i <= it.to; i++) ws.push(i);
    return `<b>${escapeHtml(p.tokens[it.from].w)}</b>${ws.length > 1 ? ` ${txt(ws.slice(1))}` : ''}`;
  };
  // 对齐的样子。pick：每一项能点；state：某一项的样子（对、错、改过）
  const grid = ({ pick = false, state = {} } = {}) => `<div class="pl-grid">${parallelRows(p).map((r) => {
    const k = r.item ? p.items.indexOf(r.item) : -1;
    const lead = `<div class="pl-lead${k > 0 ? ' is-conj' : ''}">${txt(r.lead)}</div>`;
    if (!r.item) return `<div class="pl-rest">${txt(r.lead)}${txt(r.trail)}</div>`;
    const inner = `${itemHtml(r.item, { fixed: state[k]?.fixed })}<span class="pl-trail">${txt(r.trail)}</span>`;
    const cls = `pl-item${state[k]?.cls ? ` ${state[k].cls}` : ''}`;
    return `${lead}${pick ? `<button type="button" class="${cls}" data-k="${k}">${inner}</button>` : `<div class="${cls}">${inner}</div>`}`;
  }).join('')}</div>`;

  const head = fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : '';
  const explain = fields.explain ? mdToHtml(fields.explain) : '';
  if (!ask) { body.innerHTML = `${head}${grid()}${explain}`; return; }

  const done = session.gate(el, title);
  const rec = (extra) => session.record({ type: 'parallel', title, q: short(p.text), el, ...extra });
  let attempts = 0, closed = false;
  const again = sameWrong(), fixAgain = sameWrong();

  if (ask === 'starts') {
    const picked = new Set();
    let tried = '';
    body.innerHTML = `${head}
      <div class="w-hint">点出并列的每一项的第一个词（再点一下去掉）。</div>
      <div class="pl-sent en-words">${p.tokens.map((t, i) => (t.word ? `<button type="button" class="pz-w" data-i="${i}">${escapeHtml(t.w)}</button>` : `<span class="en-punct">${escapeHtml(t.w)}</span>`)).join(' ')}</div>
      <div class="ans-actions"><button type="button" class="btn btn-primary pl-check" disabled>检查</button><button type="button" class="btn pl-show" hidden>看答案</button></div>
      <div class="q-feedback" hidden></div>`;
    const sent = body.querySelector('.pl-sent'), fb = body.querySelector('.q-feedback');
    const said = () => [...picked].sort((a, b) => a - b).map((i) => p.tokens[i].w).join('、');
    const finish = (ok, revealed = false) => {
      closed = true; done();
      rec({ final: true, ok, attempts, revealed: revealed || undefined, value: said(), expected: p.items.map((it) => p.tokens[it.from].w).join('、') });
      sent.outerHTML = grid();
      body.querySelector('.w-hint')?.remove();
      body.querySelector('.ans-actions').hidden = true;
    };
    sent.addEventListener('click', (e) => {
      const b = e.target.closest('.pz-w');
      if (!b || closed) return;
      const i = Number(b.dataset.i);
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      b.classList.toggle('is-sel', picked.has(i));
      body.querySelector('.pl-check').disabled = !picked.size;
    });
    body.querySelector('.pl-check').addEventListener('click', () => {
      if (closed || !picked.size) return;
      const r = judgeStarts([...picked], p);
      if (again.repeat(said())) return; // 同一个错答案连着再交：不算新的一次，上一次的提示还在
      again.after(said(), r.ok);
      attempts++; tried = said();
      rec({ liveOnly: true, ok: r.ok, attempts, value: tried, detail: r.text });
      fb.hidden = false; fb.className = `q-feedback ${r.ok ? 'is-ok' : 'is-bad'}`;
      fb.innerHTML = `<div class="q-verdict">${r.ok ? '✓ 对了' : '✗ 再想想'}</div><div>${escapeHtml(r.text)}</div>${r.ok ? explain : ''}`;
      if (r.ok) finish(true); else if (canReveal(attempts)) body.querySelector('.pl-show').hidden = false;
    });
    body.querySelector('.pl-show').addEventListener('click', () => {
      fb.hidden = false; fb.className = 'q-feedback is-reveal';
      fb.innerHTML = `<div>并列的 ${p.items.length} 项排在下面了：每一项开头加粗的那个词决定它的形式。</div>${explain}`;
      finish(false, true);
    });
    markDraft(body, () => (!closed && picked.size && said() !== tried ? `点了 ${said()}，还没检查` : ''));
    return;
  }

  // ask: odd：挑出不平行的那一项，再选改法
  const opts = fields.fix ? fixOptions({ fix: fields.fix, decoys: fields.decoys }, p.text) : null;
  const state = {};
  let stage = 'pick', fixTries = 0;
  const nth = (k) => `第 ${k + 1} 项「${short(joinWords(p.tokens.slice(p.items[k].from, p.items[k].to + 1).map((t) => t.w)), 40)}」`;
  body.innerHTML = `${head}<div class="w-hint">哪一项和别的不平行？点它。</div><div class="pl-slot"></div><div class="pl-fix" hidden></div><div class="q-feedback" hidden></div>`;
  const slot = body.querySelector('.pl-slot'), fixBox = body.querySelector('.pl-fix'), fb = body.querySelector('.q-feedback');
  const paint = () => { slot.innerHTML = grid({ pick: stage === 'pick' && !closed, state }); };
  const say = (ok, text, extra = '') => { fb.hidden = false; fb.className = `q-feedback ${ok ? 'is-ok' : 'is-bad'}`; fb.innerHTML = `<div class="q-verdict">${ok ? '✓ 对了' : '✗ 再想想'}</div><div>${escapeHtml(text)}</div>${extra}`; };
  const finish = (ok, revealed = false) => {
    closed = true; done();
    for (const key of Object.keys(state)) delete state[key]; // 前面点错的那一项不再标红
    state[answer - 1] = fields.fix ? { cls: 'is-right', fixed: fields.fix } : { cls: 'is-right' };
    // 到了改法那一步：最后这一条记在「第 2 步」上（挑出那一项是第 1 步，另算一道题），次数是改法试了几次
    const second = stage === 'fix' && !!opts;
    rec({ final: true, ok, attempts: second ? fixTries : attempts, revealed: revealed || undefined, detail: second ? '第 2 步：改法' : undefined, expected: `${nth(answer - 1)}${fields.fix ? ` → ${fields.fix}` : ''}` });
    fixBox.hidden = true; body.querySelector('.w-hint')?.remove();
    paint();
  };
  const askFix = () => {
    stage = 'fix';
    if (!opts) { finish(true); return; }
    fixBox.hidden = false;
    fixBox.innerHTML = `<div class="pl-fix-q">这一项改成什么，才和别的平行？</div><div class="pl-fix-opts">${opts.options.map((o, i) => `<button type="button" class="btn pl-opt" data-i="${i}">${escapeHtml(o)}</button>`).join('')}</div>`;
    paint();
  };
  slot.addEventListener('click', (e) => {
    const b = e.target.closest('.pl-item[data-k]');
    if (!b || closed || stage !== 'pick') return;
    const k = Number(b.dataset.k), r = judgeOdd(k, { answer });
    if (again.repeat(k)) return; // 再点刚点错的那一项：不算新的一次
    again.after(k, r.ok);
    attempts++;
    rec({ liveOnly: true, ok: r.ok, attempts, value: `点了${nth(k)}`, detail: r.text, more: (r.ok && !!opts) || undefined });
    for (const key of Object.keys(state)) delete state[key];
    state[k] = { cls: r.ok ? 'is-right' : 'is-wrong' };
    say(r.ok, r.text);
    if (r.ok) askFix(); else { paint(); if (canReveal(attempts) && !body.querySelector('.pl-show')) { fb.insertAdjacentHTML('beforeend', ' <button type="button" class="link-btn pl-show">看答案</button>'); } }
  });
  fb.addEventListener('click', (e) => {
    if (!e.target.closest('.pl-show') || closed) return;
    fb.className = 'q-feedback is-reveal';
    fb.innerHTML = `<div>不平行的是${escapeHtml(nth(answer - 1))}${fields.fix ? `，改成「${escapeHtml(fields.fix)}」` : ''}。</div>${explain}`;
    finish(false, true);
  });
  fixBox.addEventListener('click', (e) => {
    const b = e.target.closest('.pl-opt');
    if (!b || closed) return;
    const i = Number(b.dataset.i), ok = i === opts.right;
    if (fixAgain.repeat(i)) return; // 点错的选项已经按不了；万一按到了也不算新的一次
    fixAgain.after(i, ok);
    fixTries++;
    rec({ liveOnly: true, ok, attempts: fixTries, value: `改成 ${opts.options[i]}`, detail: ok ? '第 2 步：改法' : '第 2 步：改法，改得不对' });
    b.classList.add(ok ? 'is-right' : 'is-wrong');
    if (ok) { say(true, '改成这样就和另外几项的形式一样了。', explain); finish(true); } else { b.disabled = true; say(false, '这样改还是不平行：看别的几项开头的那个词是什么形式。'); if (canReveal(fixTries)) { fb.insertAdjacentHTML('beforeend', ' <button type="button" class="link-btn pl-show">看答案</button>'); } }
  });
  paint();
}
