// 句子变换 shift（视觉第 5 批）：主动变被动、强调句、倒装还原……上面一行是原句，每个成分一个带颜色的块；
// mode: show 一步一步播：一个成分带着颜色到新位置，原来的位置留一个虚线的影子，变了的词标出来、新加的框架词另一种底色；
// mode: do 学生自己排：点一个成分放进下一个空位（或者拖到某个空位上），点已经放好的拿回去；排完检查，只说第几个位置不对。
// 两行怎么配、谁变了在 enshift.js（纯函数）。
import { REVEAL_TRIES, sameWrong } from '../tries.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { markDraft } from '../drafts.js';
import { parseFields } from '../parse.js';
import { parseShift, shiftPlan, judgeOrder, lineText, shiftFieldProblems, shiftDecoys } from '../enshift.js';
import { roleName, fixOptions } from '../entext.js';
import { figureControls } from '../plot.js';

const short = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function shift(el, src) {
  const { fields } = parseFields(src);
  // mode 写错了画不出来，直接报；多写、写错名字的字段只提醒
  for (const msg of shiftFieldProblems(fields)) {
    if (/^mode/.test(msg)) throw new Error(msg);
    session.problem(el, 'shift', msg, { soft: true });
  }
  const s = parseShift({ from: fields.from, to: fields.to });
  const plan = shiftPlan(s);
  const doing = /^do$/i.test(fields.mode || '');
  const title = fields.title || '句子变换';
  const body = widget(el, { title, cls: 'en-shift' });
  const keys = s.from.filter((x) => x.key).map((x) => x.key);
  const color = (k) => `pz-c${keys.indexOf(k) % 6}`;
  const fromOf = (k) => s.from.find((x) => x.key === k), toOf = (k) => s.to.find((x) => x.key === k);
  const changed = new Map(plan.changed.map((c) => [c.key, c]));
  const added = new Set(plan.added.map((t) => t.toLowerCase())), dropped = new Set(plan.dropped.map((t) => t.toLowerCase()));
  // 成分名：原句那一行照 from 写的，变换以后照 to 写的（[O=S The plan]：原来的宾语，现在是主语）
  const label = (k, row = 'from') => escapeHtml(roleName((row === 'to' ? toOf(k) : fromOf(k)).role));
  const roleMoved = s.from.filter((x) => x.key && toOf(x.key).role !== x.role);
  // decoys: V = approved | has approved（排对以后，变了形式的成分让学生选）
  // decoys: V = 错的 | 错的（排对以后，变了形式的成分让学生选）；写错的报出来，不然那一步悄悄不问
  const { decoys, problems: decoyProblems } = shiftDecoys(fields.decoys, s, plan);
  for (const msg of decoyProblems) session.problem(el, 'shift', msg, { soft: true });

  // 原句那一行：gone 里的成分只剩影子
  const fromRow = (gone, { pick = false } = {}) => s.from.map((x) => {
    if (x.punct) return `<span class="sh-punct">${escapeHtml(x.text)}</span>`;
    if (!x.key) return `<span class="sh-loose${dropped.has(x.text.toLowerCase()) ? ' is-dropped' : ''}">${escapeHtml(x.text)}</span>`;
    const g = gone.has(x.key);
    const inner = `<span class="sh-text">${escapeHtml(x.text)}</span><small>${label(x.key)}</small>`;
    return pick && !g ? `<button type="button" class="sh-chunk ${color(x.key)}" data-key="${x.key}">${inner}</button>` : `<span class="sh-chunk ${color(x.key)}${g ? ' is-ghost' : ''}" data-key="${x.key}">${inner}</span>`;
  }).join(' ');
  // 变换以后那一行：placed[i] 是第 i 个位置上放的成分（没放是 undefined）；final：写变了以后的词
  const toRow = (placed, { final = false, slots = false, bad = -1 } = {}) => {
    let n = -1;
    return s.to.map((x) => {
      if (x.punct) return `<span class="sh-punct">${escapeHtml(x.text)}</span>`;
      if (!x.key) return `<span class="sh-loose${added.has(x.text.toLowerCase()) ? ' is-added' : ''}">${escapeHtml(x.text)}</span>`;
      n++;
      const k = placed[n];
      if (k === undefined) return slots ? `<button type="button" class="sh-slot${bad === n ? ' is-bad' : ''}" data-slot="${n}" aria-label="第 ${n + 1} 个位置"></button>` : '<span class="sh-slot is-empty"></span>';
      const ch = changed.get(k), text = final ? toOf(k).text : fromOf(k).text;
      const was = final ? `<small${ch ? ' class="sh-was"' : ''}>${label(k, 'to')}${ch ? ` · 原来：${escapeHtml(ch.before)}` : ''}</small>` : `<small>${label(k)}</small>`;
      const cls = `sh-chunk ${color(k)}${final && ch ? ' is-changed' : ''}${bad === n ? ' is-bad' : ''}`;
      return slots ? `<button type="button" class="${cls}" data-slot="${n}" data-key="${k}"><span class="sh-text">${escapeHtml(text)}</span>${was}</button>` : `<span class="${cls}" data-key="${k}"><span class="sh-text">${escapeHtml(text)}</span>${was}</span>`;
    }).join(' ');
  };
  const head = fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : '';
  const explain = fields.explain ? mdToHtml(fields.explain) : '';
  const notes = () => [
    plan.added.length ? `新加的词：${plan.added.map((t) => `「${t}」`).join('、')}` : '',
    plan.dropped.length ? `去掉的词：${plan.dropped.map((t) => `「${t}」`).join('、')}` : '',
    ...plan.changed.map((c) => `${roleName(fromOf(c.key).role)}：${c.before} → ${c.after}`),
    ...roleMoved.map((x) => `「${toOf(x.key).text}」原来是${roleName(x.role)}，现在是${roleName(toOf(x.key).role)}`),
    !plan.added.length && !plan.dropped.length && !plan.changed.length && !roleMoved.length ? '词一个没变，只是顺序变了。' : '',
  ].filter(Boolean).map((t) => `<div class="sh-note">${escapeHtml(t)}</div>`).join('');

  if (!doing) {
    // 一步一步播：第 k 步把变换以后的第 k 个成分放上去。走到第几步是变量 step（课堂里 figure set step=2 / play step 0 4 4s）
    const n = plan.order.length;
    let step = 0;
    const slider = { kind: 'slider', name: 'step', min: 0, max: n, step: 1, init: 0, mods: {}, srcLine: 'step' };
    const state = { slider: { step: 0 }, override: {} };
    const ctl = figureControls({ root: el, cmds: [slider], state, extra: {}, env: () => ({ step }), draw: () => {
      const want = Math.max(0, Math.min(n, Math.floor(Number(state.slider.step) + 1e-9)));
      const moved = want === step + 1 ? plan.order[want - 1] : null;
      step = want; paint(moved); ctl.mark(); ctl.emit('change', { step });
    } });
    slider.sync = () => {};
    // 学生自己点：记成动作（课堂刷新后照它放回，也跟着下一条消息告诉主讲）
    const go = (to) => { ctl.stop('step'); state.slider.step = to; const moved = to === step + 1 ? plan.order[to - 1] : null; step = to; paint(moved); ctl.mark(); ctl.emit('change', { step }); session.event('drag', el, { name: 'step', value: step, beat: n }); };
    body.innerHTML = `${head}<div class="sh-cap">原句</div><div class="sh-row sh-from"></div><div class="sh-cap">变换以后</div><div class="sh-row sh-to"></div>
      <div class="sh-ctl"><button type="button" class="btn btn-primary sh-next">下一步</button><button type="button" class="btn sh-all">一下子变完</button><button type="button" class="btn sh-reset">重来</button><span class="sh-count"></span></div>
      <div class="sh-notes"></div>`;
    const paint = (moved = null) => {
      const placed = plan.order.slice(0, step), fin = step >= plan.order.length;
      body.querySelector('.sh-from').innerHTML = fromRow(new Set(placed));
      body.querySelector('.sh-to').innerHTML = toRow(placed, { final: true });
      body.querySelector('.sh-count').textContent = `${step} / ${plan.order.length}`;
      body.querySelector('.sh-next').disabled = fin; body.querySelector('.sh-all').disabled = fin;
      body.querySelector('.sh-notes').innerHTML = fin ? `${notes()}${explain}` : '';
      // 刚挪过去的那一块：从原来的位置滑过来
      if (moved) {
        const a = body.querySelector(`.sh-from [data-key="${moved}"]`), b = body.querySelector(`.sh-to [data-key="${moved}"]`);
        if (a && b && b.animate) { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); b.animate([{ transform: `translate(${ra.left - rb.left}px, ${ra.top - rb.top}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
      }
    };
    body.querySelector('.sh-next').addEventListener('click', () => { if (step < n) go(step + 1); });
    body.querySelector('.sh-all').addEventListener('click', () => go(n));
    body.querySelector('.sh-reset').addEventListener('click', () => go(0));
    paint();
    // 课堂里 figure set step=2 / figure play step 0 4 4s：一步一步跳，挪过去的那一块自己有滑过去的动画，不补间
    const api = {
      draw: () => paint(), on: ctl.on, animate: ctl.animate, play: ctl.play, highlight: ctl.highlight,
      vars: () => ({ step }), snapshot: () => ({ step }),
      set(name, value) {
        if (name !== 'step') throw new Error(`句子变换（shift）只有一个变量 step（挪到第几个成分，0 到 ${n}）`);
        const v = Math.round(Number(value));
        if (!(v >= 0 && v <= n)) throw new Error(`step 写 0 到 ${n} 之间的数`);
        return ctl.set('step', v, { ms: 0 });
      },
    };
    el.dataset.scene = session.registerScene(el, api, title);
    return;
  }

  // 学生自己排
  const done = session.gate(el, title);
  const placed = Array(plan.order.length).fill(undefined);
  // 排顺序是第 1 步、选形式是第 2 步：记录里分开算两道题，次数各数各的
  const again = sameWrong(), formAgain = sameWrong();
  let attempts = 0, formTries = 0, closed = false, bad = -1, tried = '', stage = 'order', formAt = 0;
  const forms = plan.changed.filter((c) => decoys[c.key]).map((c) => ({ ...c, opts: fixOptions({ fix: c.after, decoys: decoys[c.key] }, `${lineText(s.to)}|${c.key}`) }));
  body.innerHTML = `${head}<div class="sh-cap">原句</div><div class="sh-row sh-from"></div>
    <div class="sh-cap">变换以后<span class="muted">（点上面的成分放进下一个空位；点放好的拿回去；也能拖到某个空位上）</span></div><div class="sh-row sh-to"></div>
    <div class="ans-actions"><button type="button" class="btn btn-primary sh-check" disabled>检查</button><button type="button" class="btn sh-clear">清空</button></div>
    <div class="sh-form" hidden></div><div class="q-feedback" hidden></div>`;
  const fb = body.querySelector('.q-feedback'), formBox = body.querySelector('.sh-form');
  const filled = () => placed.filter((k) => k !== undefined);
  const said = () => placed.map((k) => (k === undefined ? '＿' : fromOf(k).text)).join(' / ');
  const rec = (extra) => session.record({ type: 'shift', title, q: short(lineText(s.from)), el, ...extra });
  const paint = () => {
    const fin = closed || stage === 'form';
    body.querySelector('.sh-from').innerHTML = fromRow(new Set(filled()), { pick: !fin });
    body.querySelector('.sh-to').innerHTML = toRow(fin ? plan.order : placed, { final: closed, slots: !fin, bad });
    body.querySelector('.sh-check').disabled = fin || filled().length < placed.length;
    body.querySelector('.ans-actions').hidden = fin;
  };
  const put = (key, at) => {
    const old = placed.indexOf(key);
    if (old >= 0) placed[old] = undefined;
    const i = at ?? placed.indexOf(undefined);
    if (i < 0) return;
    if (placed[i] !== undefined && old >= 0) placed[old] = placed[i]; // 拖到有东西的位置上：两个对调
    placed[i] = key; bad = -1; paint();
  };
  const say = (ok, text, extra = '') => { fb.hidden = false; fb.className = `q-feedback ${ok ? 'is-ok' : 'is-bad'}`; fb.innerHTML = `<div class="q-verdict">${ok ? '✓ 对了' : '✗ 再想想'}</div><div>${escapeHtml(text)}</div>${extra}`; };
  const finish = (ok, revealed = false) => {
    closed = true; done(); formBox.hidden = true;
    const second = stage === 'form';
    rec({ final: true, ok, attempts: second ? formTries : attempts, detail: second ? '第 2 步：形式' : undefined, revealed: revealed || undefined, value: said(), expected: lineText(s.to) });
    paint();
    fb.insertAdjacentHTML('beforeend', `${notes()}${explain}`);
  };
  const askForm = () => {
    if (formAt >= forms.length) { finish(true); return; }
    stage = 'form';
    const f = forms[formAt];
    formBox.hidden = false;
    formBox.innerHTML = `<div class="sh-form-q">顺序对了。${escapeHtml(roleName(fromOf(f.key).role))}「${escapeHtml(f.before)}」在新的句子里写成什么？</div><div class="sh-form-opts">${f.opts.options.map((o, i) => `<button type="button" class="btn sh-opt" data-i="${i}">${escapeHtml(o)}</button>`).join('')}</div>`;
    paint();
  };
  body.querySelector('.sh-from').addEventListener('click', (e) => { const b = e.target.closest('button.sh-chunk'); if (b && !closed && stage === 'order' && !dragged) put(b.dataset.key); });
  body.querySelector('.sh-to').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-slot]');
    if (!b || closed || stage !== 'order' || dragged) return;
    const i = Number(b.dataset.slot);
    if (placed[i] !== undefined) { placed[i] = undefined; bad = -1; paint(); }
  });
  body.querySelector('.sh-clear').addEventListener('click', () => { if (closed) return; placed.fill(undefined); bad = -1; paint(); });
  body.querySelector('.sh-check').addEventListener('click', () => {
    if (closed || stage !== 'order') return;
    const r = judgeOrder(placed, s);
    if (r.ok === null) return;
    if (again.repeat(said())) return; // 同一个排法连点检查：不算新的一次
    again.after(said(), r.ok);
    attempts++; tried = said();
    rec({ liveOnly: true, ok: r.ok, attempts, value: tried, detail: r.ok ? '' : r.text, more: (r.ok && forms.length > 0) || undefined });
    if (r.ok) { bad = -1; say(true, forms.length ? '顺序对了。' : '顺序对了：看看哪些词变了。'); askForm(); return; }
    bad = r.firstWrong; paint();
    say(false, r.text, attempts >= REVEAL_TRIES ? ' <button type="button" class="link-btn sh-show">看答案</button>' : '');
  });
  fb.addEventListener('click', (e) => {
    if (!e.target.closest('.sh-show') || closed) return;
    fb.className = 'q-feedback is-reveal'; fb.innerHTML = `<div>${escapeHtml(lineText(s.to))}</div>`;
    finish(false, true);
  });
  formBox.addEventListener('click', (e) => {
    const b = e.target.closest('.sh-opt');
    if (!b || closed) return;
    const f = forms[formAt], i = Number(b.dataset.i), ok = i === f.opts.right;
    if (formAgain.repeat(`${formAt}:${i}`)) return; // 点错的选项已经按不了；万一按到了也不算新的一次
    formAgain.after(`${formAt}:${i}`, ok);
    formTries++;
    rec({ liveOnly: true, ok, attempts: formTries, value: `${roleName(fromOf(f.key).role)}写成 ${f.opts.options[i]}`, detail: ok ? '第 2 步：形式' : '第 2 步：形式不对' });
    if (ok) { formAt++; say(true, `${f.before} → ${f.after}`); askForm(); } else { b.disabled = true; b.classList.add('is-wrong'); say(false, '形式不对：看它在新句子里和谁搭配。'); }
  });
  // 拖：按住一个成分拖到下面的某个位置上（手指挪了 8px 以上才算拖，不然是点）
  let drag = null, dragged = false;
  // 上面一行的成分拖下来；下面已经放好的也能拖到别的位置（有东西就对调）
  body.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.sh-from button.sh-chunk, .sh-to button.sh-chunk');
    if (!b || closed || stage !== 'order') return;
    drag = { key: b.dataset.key, x: e.clientX, y: e.clientY, id: e.pointerId, moving: false, el: b };
    dragged = false;
  });
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moving && Math.hypot(dx, dy) < 8) return;
    drag.moving = true; dragged = true;
    e.preventDefault();
    drag.el.style.transform = `translate(${dx}px, ${dy}px)`; drag.el.classList.add('is-drag');
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.sh-to [data-slot]');
    body.querySelectorAll('.sh-to [data-slot]').forEach((x) => x.classList.toggle('is-over', x === under));
  };
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.moving) return;
    d.el.style.transform = ''; d.el.classList.remove('is-drag');
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.sh-to [data-slot]');
    if (under) put(d.key, Number(under.dataset.slot)); else paint();
    setTimeout(() => { dragged = false; }, 0); // 松手后那一下 click 不算点
  };
  const cancel = (e) => { if (drag && e.pointerId === drag.id) { drag.el.style.transform = ''; drag.el.classList.remove('is-drag'); drag = null; dragged = false; paint(); } };
  // 监听挂在 window 上（拖出块外也接得住）；块被换掉了就撤掉，不越积越多
  const guard = (fn) => (e) => { if (!el.isConnected) { off(); return; } fn(e); };
  const moveG = guard(move), upG = guard(up), cancelG = guard(cancel);
  function off() { window.removeEventListener('pointermove', moveG); window.removeEventListener('pointerup', upG); window.removeEventListener('pointercancel', cancelG); }
  window.addEventListener('pointermove', moveG, { passive: false });
  window.addEventListener('pointerup', upG);
  window.addEventListener('pointercancel', cancelG);
  // 切到后台：拖到一半的放回原处
  document.addEventListener('visibilitychange', () => { if (document.hidden && drag) cancel({ pointerId: drag.id }); });
  markDraft(body, () => (!closed && filled().length && said() !== tried ? `排了 ${said()}，还没检查` : ''));
  paint();
}
