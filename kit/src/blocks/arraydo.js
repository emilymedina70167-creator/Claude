// array 的 mode: do：学生自己在数组上动手，页面记每一步（逻辑在 ../arraydo.js，这里只有画面和记录）。
// 点一个格子再点另一个：交换；后一个是空的就挪过去。点一个指针再点格子：指针挪过去。
import { sameWrong } from '../tries.js';
import { parseFields } from '../parse.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { doStart, doTap, doApply, doUndo, doReset, doOpText, doEncode, doDecode, doSeq, doOpsText, doCheck } from '../arraydo.js';

const plain = (s) => String(s ?? '').replace(/\$[^$]*\$/g, (m) => m.slice(1, -1)).slice(0, 200);

export function arrayDo(el, src) {
  const { fields } = parseFields(src);
  if (!fields.array) throw new Error('array 需要 array:（如 49 38 65 97）');
  let state = doStart(fields);
  const title = fields.title || '自己动手';
  const body = widget(el, { title, cls: 'sortarr ad' });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="arr-box ad-box"></div>
    <div class="ed-fb ad-fb" aria-live="polite" hidden></div>
    <div class="ed-ctrl ad-ctrl">
      <button type="button" class="btn btn-sm ad-undo" disabled>撤回一步</button>
      <button type="button" class="btn btn-sm ad-reset" disabled>重来</button>
      <button type="button" class="btn btn-primary btn-sm ad-done">做完了</button>
    </div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}`;
  const $ = (s) => body.querySelector(s);
  const box = $('.ad-box'), fb = $('.ad-fb');
  const gate = session.gate(el, title);
  let sel = null; // 先点的那个：{ cell } 或 { ptr }
  let done = false;
  let tries = 0;
  const again = sameWrong();
  let moved = [];

  const say = (text, kind = '') => { fb.hidden = !text; fb.className = `ed-fb ad-fb${kind ? ` is-${kind}` : ''}`; fb.textContent = text || ''; };
  const codes = () => state.history.map(doEncode);
  const rec = (extra) => session.record({ type: 'stepper', engine: 'array', title, q: plain(fields.q), ops: codes(), el, ...extra });

  function draw() {
    const first = state.temp ? 0 : 1;
    const cols = state.n + 1 - first;
    const isSel = (p) => sel?.cell === p;
    let h = `<div class="arr" style="--cols:${cols}"><div class="arr-row">`;
    for (let p = first; p <= state.n; p++) {
      const x = state.cells[p];
      const cls = ['arr-cell', 'ad-cell', x ? '' : 'arr-empty', p === 0 ? 'arr-zero' : '', isSel(p) ? 'arr-cmp' : '', moved.includes(p) ? 'arr-moved' : '', done ? 'arr-done' : ''].filter(Boolean).join(' ');
      const name = p === 0 ? state.temp : `第 ${p} 个`;
      h += `<button type="button" class="${cls}" data-p="${p}" aria-label="${escapeHtml(name)}：${x ? x.v : '空'}"${done ? ' disabled' : ''}>${x ? (x.mark ? `<u>${x.v}</u>` : x.v) : ''}</button>`;
    }
    h += '</div><div class="arr-row arr-idx">';
    for (let p = first; p <= state.n; p++) h += `<div>${p === 0 ? escapeHtml(state.temp) : p}</div>`;
    h += '</div>';
    if (state.ptrs.length) {
      h += '<div class="arr-row ad-ptrs">';
      for (let p = first; p <= state.n; p++) {
        h += `<div>${state.ptrs.filter((x) => x.at === p).map((x) => `<button type="button" class="ad-ptr${sel?.ptr === x.name ? ' is-sel' : ''}" data-ptr="${escapeHtml(x.name)}"${done ? ' disabled' : ''}><span aria-hidden="true">▲</span>${escapeHtml(x.name)}</button>`).join('')}</div>`;
      }
      h += '</div>';
    }
    box.innerHTML = `${h}</div>`;
    $('.ad-undo').disabled = done || !state.history.length;
    $('.ad-reset').disabled = done || !state.history.length;
    $('.ad-done').hidden = done;
  }

  function tap(t) {
    if (done) return;
    if (!sel) {
      // 空格子不能当第一下（没有东西可挪）
      if (t.cell !== undefined && !state.cells[t.cell]) return;
      sel = t; say(''); draw(); return;
    }
    // 再点一下自己：放下
    if ((sel.cell !== undefined && sel.cell === t.cell) || (sel.ptr !== undefined && sel.ptr === t.ptr)) { sel = null; draw(); return; }
    // 先点了一个，又点了指针：改成拿这个指针
    if (t.ptr !== undefined) { sel = t; draw(); return; }
    let op;
    try { op = doTap(state, sel, t); } catch (e) { sel = null; say(e.message, 'bad'); draw(); return; }
    const text = doOpText(op, state);
    state = doApply(state, op);
    moved = op.kind === 'swap' ? [op.i, op.j] : op.kind === 'move' ? [op.to] : [];
    sel = null;
    rec({ liveOnly: true, value: text, detail: `自己动手第 ${state.history.length} 步，现在是 ${doSeq(state)}` });
    draw();
  }

  body.addEventListener('click', (e) => {
    const ptr = e.target.closest('.ad-ptr');
    if (ptr) return tap({ ptr: ptr.dataset.ptr });
    const cell = e.target.closest('.ad-cell');
    if (cell) return tap({ cell: Number(cell.dataset.p) });
    if (e.target.closest('.ad-undo')) {
      if (done || !state.history.length) return;
      const before = doUndo(state);
      const text = doOpText(state.history.at(-1), before);
      state = before; sel = null; moved = []; say('');
      rec({ liveOnly: true, value: `撤回：${text}`, detail: '自己动手，撤回一步' });
      draw();
      return;
    }
    if (e.target.closest('.ad-reset')) {
      if (done || !state.history.length) return;
      const n = state.history.length;
      state = doReset(state); sel = null; moved = []; say('');
      rec({ liveOnly: true, value: '重来', detail: `自己动手，做了 ${n} 步以后重来` });
      draw();
      return;
    }
    if (e.target.closest('.ad-done')) {
      const ck = doCheck(state);
      const steps = doOpsText(state);
      const detail = `${steps.length} 步，最后是 ${doSeq(state)}`;
      const value = steps.join('；') || '（一步没动）';
      if (ck.ok === false) {
        const sig = codes().join(' ');
        if (again.repeat(sig)) return; // 没再动就又点「做完了」：不算新的一次
        again.after(sig, false);
        tries++;
        say(ck.why, 'bad');
        rec({ liveOnly: true, ok: false, attempts: tries, value, detail: `${detail}（${ck.why}）` });
        return;
      }
      done = true; sel = null; moved = [];
      say('');
      // 没写 goal：页面不判（ok 不写），步骤留给主讲看
      rec({ final: true, ...(ck.ok === true ? { ok: true, attempts: tries + 1 } : {}), value, detail });
      draw();
      gate();
    }
  });

  // 刷新后（课堂）照最后一条记录里的 ops 把做过的步骤放回来
  el._replay = (list) => {
    const last = [...list].reverse().find((r) => Array.isArray(r.ops));
    if (!last) return;
    state = doReset(state);
    for (const t of last.ops) {
      const op = doDecode(t);
      if (!op) break;
      state = doApply(state, op);
    }
    if (last.final) done = true;
    draw();
  };

  draw();
}
