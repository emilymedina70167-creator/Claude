// elim 的 mode: do：学生自己一步步做行变换，页面精确地做出来（write: rows 时变了的那一行学生自己算，页面逐个数核对）。
// 逻辑都在 engines/elim.js 的 doStart / doParse / doApply / doStatus / doHint（纯函数，有测试），这里只有画面和记录。
import { parseFields } from '../parse.js';
import { session } from '../session.js';
import { widget, mdToHtml, tex2html, escapeHtml } from './common.js';
import { markDraft } from '../drafts.js';
import { elimEngine, doStart, doParse, doApply, doUndo, doStatus, doHint, doAutoCount, doOpText, doOpTeX, doChanged, doCheckRow } from '../engines/elim.js';
import { stepperBlock } from '../stepper.js';

const TARGET_GOAL = { ref: '化成行阶梯形', rref: '化成行最简形', E: '把左边化成单位矩阵 E' };

export function elimDo(el, src) {
  const { fields } = parseFields(src);
  const input = elimEngine.parse(fields, src);
  let state = doStart(input, fields);
  const write = /^(rows?|行|me|yes|true)$/i.test(String(fields.write ?? '').trim());
  const auto = doAutoCount(input);
  const title = fields.title || '自己做行变换';
  const body = widget(el, { title, cls: 'sv-widget sv-elim ed stepper-act' });
  const rows = state.m;
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="ed-goal muted">目标：${TARGET_GOAL[state.target]}。每一步写一个初等行变换，页面${write ? '核对你算的新的一行' : '替你算出来'}。</div>
    <div class="sv-stage ed-stage"></div>
    <div class="ed-status" aria-live="polite"></div>
    <ol class="ed-hist"></ol>
    <div class="ed-do">
      <div class="ed-line">
        <input type="text" class="ed-in" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="例：r2 - 2r1、r1 <-> r3、r2 / 3" aria-label="写一步行变换">
        <button type="button" class="btn btn-primary ed-go">做这一步</button>
      </div>
      <div class="ed-keys">${Array.from({ length: rows }, (_, i) => `<button type="button" class="btn btn-sm ed-key" data-k="r${i + 1}">r${i + 1}</button>`).join('')}<button type="button" class="btn btn-sm ed-key" data-k=" <-> " aria-label="交换">↔</button><button type="button" class="btn btn-sm ed-key" data-k=" + ">+</button><button type="button" class="btn btn-sm ed-key" data-k=" - ">−</button><button type="button" class="btn btn-sm ed-key" data-k=" / ">/</button><button type="button" class="btn btn-sm ed-key" data-k="⌫" aria-label="删掉一个字">⌫</button></div>
      <div class="ed-write" hidden></div>
      <div class="ed-fb" hidden></div>
      <div class="ed-ctrl">
        <button type="button" class="btn btn-sm ed-undo" disabled>撤回一步</button>
        <button type="button" class="btn btn-sm ed-hint">提示下一步</button>
      </div>
    </div>
    <div class="ed-after" hidden><button type="button" class="btn btn-sm ed-show">看页面一步步的做法</button><div class="ed-demo"></div></div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}`;
  const $ = (s) => body.querySelector(s);
  const stage = $('.ed-stage'), status = $('.ed-status'), hist = $('.ed-hist'), inp = $('.ed-in'), fb = $('.ed-fb'), wbox = $('.ed-write');
  const gate = session.gate(el, title);
  let hints = 0, wrongRows = 0, pendingOp = null, done = false, changedRows = [];

  // html：已经排好的（公式），不再当 Markdown 转一遍
  const say = (text, kind = '', { html = false } = {}) => { fb.hidden = !text; fb.className = `ed-fb${kind ? ` is-${kind}` : ''}`; fb.innerHTML = !text ? '' : html ? text : mdToHtml(text, { inline: true }); };
  const opsText = () => state.history.map((h) => doOpText(h.op));

  function draw() {
    stage.innerHTML = elimEngine.view({ M: state.M, changed: changedRows }, input, { tex: (t) => tex2html(t), md: mdToHtml });
    hist.innerHTML = state.history.map((h, i) => `<li><span class="ed-n">${i + 1}</span>${tex2html(doOpTeX(h.op))}</li>`).join('');
    const st = doStatus(state);
    status.textContent = st.text;
    status.className = `ed-status${st.done ? ' is-done' : ''}`;
    $('.ed-undo').disabled = done || !state.history.length;
    if (st.done && !done) finish(st);
  }

  function finish(st) {
    done = true;
    $('.ed-do').hidden = true;
    $('.ed-after').hidden = false;
    const extra = [`${state.history.length} 步（页面自己做是 ${auto} 步）`, hints ? `看了 ${hints} 次提示` : '', wrongRows ? `自己算错 ${wrongRows} 次` : ''].filter(Boolean).join('，');
    status.textContent = `${st.text}一共 ${extra}。`;
    session.record({ type: 'stepper', engine: 'elim', final: true, ok: true, title, q: plain(fields.q), value: opsText().join('；'), detail: `自己做完：${extra}`, ops: opsText(), el });
    gate();
  }

  // 一步做完（write: rows 时要先核对学生算的那一行）
  function commit(op) {
    const r = doApply(state, op);
    state = r.state;
    changedRows = op.kind === 'swap' ? [op.i, op.j] : [op.i];
    pendingOp = null;
    wbox.hidden = true;
    inp.value = '';
    say(r.note, r.note ? 'note' : '');
    session.record({ type: 'stepper', engine: 'elim', liveOnly: true, title, q: plain(fields.q), value: doOpText(op), detail: `自己做第 ${state.history.length} 步`, ops: opsText(), note: r.note || undefined, el });
    draw();
  }

  function tryOp() {
    if (done) return;
    let ops;
    try { ops = doParse(state, inp.value); } catch (e) { say(e.message, 'bad'); return; }
    if (ops.length > 1) { say('一次只写一步（做完这一步再写下一步）', 'bad'); return; }
    const op = ops[0];
    if (!write || !doChanged(op).length) { commit(op); return; }
    // 自己算：变了的那一行写出来
    pendingOp = { op, tries: 0 };
    const n = state.M[0].length;
    wbox.hidden = false;
    wbox.innerHTML = `<div class="ed-wq">${tex2html(doOpTeX(op))}：写出新的第 ${op.i + 1} 行（${n} 个数，分数写成 1/2）</div>
      <div class="ed-wrow">${Array.from({ length: n }, (_, j) => `<input type="text" class="ed-w" data-j="${j}" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="第 ${j + 1} 个数">`).join('')}</div>
      <div class="ed-wctrl"><button type="button" class="btn btn-primary btn-sm ed-wcheck">核对</button><button type="button" class="btn btn-sm ed-wcancel">换一步</button><button type="button" class="btn btn-sm ed-wshow" hidden>看这一行</button></div>`;
    say('');
    wbox.querySelector('.ed-w').focus();
  }

  function checkRow() {
    if (!pendingOp) return;
    const boxes = [...wbox.querySelectorAll('.ed-w')];
    const texts = boxes.map((b) => b.value);
    if (texts.some((t) => !t.trim())) { say('每个格子都要写（0 也要写）', 'bad'); return; }
    const bad = doCheckRow(state, pendingOp.op, texts);
    boxes.forEach((b, j) => b.classList.toggle('is-bad', bad.includes(j)));
    if (!bad.length) { commit(pendingOp.op); return; }
    pendingOp.tries++;
    wrongRows++;
    session.record({ type: 'stepper', engine: 'elim', liveOnly: true, title, q: plain(fields.q), value: `${doOpText(pendingOp.op)} 之后第 ${pendingOp.op.i + 1} 行写成 (${texts.map((t) => t.trim()).join(', ')})`, ok: false, attempts: pendingOp.tries, detail: `自己算，第 ${bad.map((j) => j + 1).join('、')} 个数不对`, el });
    say(`第 ${bad.map((j) => j + 1).join('、')} 个数不对，再算算。`, 'bad');
    if (pendingOp.tries >= 2) wbox.querySelector('.ed-wshow').hidden = false;
  }

  body.addEventListener('click', (e) => {
    const key = e.target.closest('.ed-key');
    if (key) {
      const k = key.dataset.k;
      if (k === '⌫') inp.value = inp.value.replace(/\s*\S\s*$/, '');
      else inp.value = (inp.value + k).replace(/\s{2,}/g, ' ');
      inp.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('.ed-go')) return tryOp();
    if (e.target.closest('.ed-wcheck')) return checkRow();
    if (e.target.closest('.ed-wcancel')) { pendingOp = null; wbox.hidden = true; say(''); return; }
    if (e.target.closest('.ed-wshow')) { const op = pendingOp.op; session.record({ type: 'stepper', engine: 'elim', liveOnly: true, title, q: plain(fields.q), revealed: true, detail: `自己算第 ${op.i + 1} 行，看了答案`, el }); commit(op); return; }
    if (e.target.closest('.ed-undo')) {
      if (!state.history.length || done) return;
      const last = state.history.at(-1).op;
      state = doUndo(state);
      changedRows = [];
      say(`撤回了 ${doOpText(last)}`);
      session.record({ type: 'stepper', engine: 'elim', liveOnly: true, title, q: plain(fields.q), value: `撤回 ${doOpText(last)}`, detail: `自己做，撤回一步`, ops: opsText(), el });
      draw();
      return;
    }
    if (e.target.closest('.ed-hint')) {
      const op = doHint(state);
      if (!op) { say('页面也找不到下一步了：看看是不是已经化好了。'); return; }
      hints++;
      say(`可以试试：${tex2html(doOpTeX(op))}（写成 <code>${escapeHtml(doOpText(op).replace(/−/g, '-').replace(/↔/g, '<->'))}</code>）`, 'note', { html: true });
      session.record({ type: 'stepper', engine: 'elim', liveOnly: true, title, q: plain(fields.q), value: `提示：${doOpText(op)}`, detail: `自己做，看了提示`, el });
      return;
    }
    if (e.target.closest('.ed-show')) {
      const demo = $('.ed-demo');
      e.target.closest('.ed-show').hidden = true;
      // 同一个输入，演示模式：页面一步步的做法（不问、不计关卡）
      const srcDemo = src.split('\n').filter((l) => !/^\s*(mode|write|target|ask|id)\s*[:：]/i.test(l)).join('\n');
      stepperBlock(elimEngine)(demo, `id: ${fields.id || 'el'}-demo\n${srcDemo}`);
    }
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tryOp(); } });
  inp.addEventListener('input', () => say(''));
  wbox.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('.ed-w')) return;
    e.preventDefault();
    const all = [...wbox.querySelectorAll('.ed-w')];
    const nx = all[all.indexOf(e.target) + 1];
    if (nx) nx.focus(); else checkRow();
  });
  markDraft(inp, () => (done ? '' : [inp.value.trim() ? `写着还没做的一步：${inp.value.trim()}` : '', pendingOp ? `在算 ${doOpText(pendingOp.op)} 之后的第 ${pendingOp.op.i + 1} 行` : ''].filter(Boolean).join('；')));

  // 刷新后（课堂）照记录把做过的步骤放回来：最后一条记录里的 ops 就是当时的样子
  el._replay = (list) => {
    const last = [...list].reverse().find((r) => Array.isArray(r.ops));
    if (!last) return;
    for (const t of last.ops) {
      try { const [op] = doParse(state, t); state = doApply(state, op).state; } catch { break; }
    }
    draw();
  };

  draw();
}

const plain = (s) => String(s ?? '').replace(/\$[^$]*\$/g, (m) => m.slice(1, -1)).slice(0, 200);
