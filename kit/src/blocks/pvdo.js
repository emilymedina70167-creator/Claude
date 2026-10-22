// pv 的「我自己排顺序」：不写 run:（或者写 mode: do）时，学生点一个进程，它就执行它的下一句——
// 这样能自己试出「换一种顺序会怎样」：什么时候阻塞、V 唤醒了谁、怎么走会死锁。
// find: deadlock / bad 是给学生的目标（找一种走法让它死锁 / 出错）；觉得怎么走都不会，点「不会」，页面把所有走法试一遍来判。
// ask: block / value / wake / deadlock / buffer：点了进程以后、执行之前先猜。
// 逻辑都在 engines/pv.js（pvStart / pvMove / procInfo / pvSearch，纯函数，有测试），这里只有画面、先猜和记录。
import { parseFields } from '../parse.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { markDraft } from '../drafts.js';
import { stepperBlock } from '../stepper.js';
import { calcFields, trackFields, parseAskField, checkAsk, askAnswerText } from '../stepperspec.js';
import { pvEngine, pvStart, pvMove, procInfo, pvSearch, pvIntro, scheduleText, isBad, MISTAKES } from '../engines/pv.js';

const MAX_MOVES = 200;
const ASK_TAGS = ['block', 'value', 'wake', 'deadlock', 'buffer'];
const plain = (s) => String(s ?? '').replace(/\*\*/g, '').replace(/\$[^$]*\$/g, (m) => m.slice(1, -1)).replace(/\s+/g, ' ').slice(0, 200);
const WHAT = { deadlock: '死锁', bad: '出错' };

// pv：写了 run:（或 mode: demo / quiz / fill）是一步步的演示（stepper.js 外壳）；没写 run: 是学生自己点
export function pvBlock() {
  const demo = stepperBlock(pvEngine);
  const f = (el, src) => {
    const { fields } = parseFields(pvEngine.head(src));
    const mode = String(fields.mode ?? '').trim().toLowerCase();
    return mode === 'do' || (!mode && !String(fields.run ?? '').trim()) ? pvDo(el, src) : demo(el, src);
  };
  f.stepper = true;
  return f;
}

export function pvDo(el, src) {
  const calced = calcFields(parseFields(pvEngine.head(src)).fields, session.vars);
  for (const e of calced.errors) session.problem(el, 'pv', e);
  const tracked = trackFields(calced.fields);
  const { fields } = tracked;
  void fields.mode;
  const input = pvEngine.parse(fields, src);
  const sys = input.sys;
  if (input.run) session.problem(el, 'pv', 'mode: do 是学生自己点进程，run: 用不上（要演示固定的顺序就去掉 mode: do）', { soft: true });
  const ask = parseAskField(fields.ask);
  if (ask) {
    const bad = ask.tags.filter((t) => !ASK_TAGS.includes(t));
    if (bad.length) session.problem(el, 'pv', `ask: 没有「${bad.join('、')}」这种问题（自己点的时候能问：${ASK_TAGS.join('、')}）`);
    if (ask.nums.length) session.problem(el, 'pv', 'ask: 学生自己点的时候没有固定的第几步，写问题的种类（block、value、wake、deadlock、buffer）');
  }
  const find = input.findSet ? input.find : null;
  const title = fields.title || '自己排执行顺序';
  const body = widget(el, { title, cls: 'sv-widget sv-pv pvd stepper-act' });
  const goal = find
    ? `目标：找一种执行顺序，让它<b>${WHAT[find]}</b>${find === 'bad' ? '（死锁、两个进程同时在临界区、缓冲区满了还放 / 空了还取，哪种都算）' : '（没有进程能往下走）'}。觉得怎么走都不会，就点「我觉得不会${WHAT[find]}」。`
    : '点下面的进程，它就执行它的下一句。看信号量的值和等待队列怎么变；能不能找出一种顺序让它死锁？';
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="pvd-goal muted">${goal}</div>
    <div class="sv-stage pvd-stage"></div>
    <div class="sv-msg pvd-msg" aria-live="polite"></div>
    <div class="sv-ask" hidden></div>
    <div class="pvd-go-row"><span class="pvd-go-h">下一步让谁走</span><div class="pvd-gos"></div></div>
    <div class="pvd-ctrl">
      <button type="button" class="btn pvd-btn pvd-undo">撤回一步</button>
      <button type="button" class="btn pvd-btn pvd-reset">从头再来</button>
      ${find ? `<button type="button" class="btn pvd-btn pvd-never">我觉得不会${WHAT[find]}</button>` : ''}
      <span class="sv-count muted pvd-count"></span>
    </div>
    <div class="pvd-fb" aria-live="polite" hidden></div>
    <div class="pvd-hist muted"></div>
    <div class="pvd-after" hidden></div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}`;
  const $ = (s) => body.querySelector(s);
  const stage = $('.pvd-stage'), msg = $('.pvd-msg'), askBox = $('.sv-ask'), gos = $('.pvd-gos'), fb = $('.pvd-fb');
  const gate = find ? session.gate(el, title) : null;
  const s0 = pvStart(input);
  let hist = []; // [{ s, step, p }]
  let pending = null; // 正在先猜：{ a, r, p, attempts, t0 }
  let verdict = '';
  let reached = false; // find 的目标做到了（或判对了「不会」）
  let nevers = 0;
  const cur = () => (hist.length ? hist.at(-1).s : s0);
  const moves = () => hist.map((h) => sys.procs[h.p].name);
  const say = (text, kind = '') => { fb.hidden = !text; fb.className = `pvd-fb${kind ? ` is-${kind}` : ''}`; fb.innerHTML = text ? mdToHtml(text, { inline: true }) : ''; };

  function draw() {
    const last = hist.at(-1);
    stage.innerHTML = pvEngine.view(last ? last.step.view : { st: s0, ev: null, bad: [] }, input);
    msg.innerHTML = `${verdict ? `<span class="sv-verdict">${verdict}</span>` : ''}${mdToHtml(last ? last.step.msg : pvIntro(input), { inline: true })}`;
    verdict = '';
    const s = cur();
    const full = hist.length >= MAX_MOVES;
    gos.innerHTML = sys.procs.map((pr, p) => {
      const info = procInfo(input, s, p);
      return `<button type="button" class="btn pvd-go pvd-${info.state}" data-p="${p}"${info.state !== 'ready' || full || pending ? ' disabled' : ''}><b>${escapeHtml(info.name)}</b><small>${escapeHtml(info.state === 'ready' ? `→ ${info.text}` : info.text)}</small></button>`;
    }).join('');
    $('.pvd-undo').disabled = !hist.length || !!pending;
    $('.pvd-reset').disabled = !hist.length || !!pending;
    $('.pvd-count').textContent = hist.length ? `走了 ${hist.length} 步` : '';
    $('.pvd-hist').textContent = hist.length ? `走过的顺序：${scheduleText(sys, hist.map((h) => h.p))}` : '';
    if (full) say(`走了 ${MAX_MOVES} 步了：撤回几步，或者从头再来。`);
    stage.classList.toggle('sv-picking', pending?.a.kind === 'pick');
  }

  function record(extra) {
    session.record({ type: 'stepper', engine: 'pv', liveOnly: true, title, q: plain(fields.q), moves: moves(), el, ...extra });
  }

  // 点了一个进程：要先猜就先问，不然直接走
  function tap(p) {
    if (pending || hist.length >= MAX_MOVES || procInfo(input, cur(), p).state !== 'ready') return;
    const r = pvMove(input, cur(), p, hist.length + 1);
    const can = [r.step.ask, ...(r.step.asks || [])].filter(Boolean);
    const a = ask && (ask.tags.map((t) => can.find((x) => x.tag === t)).find(Boolean) || (ask.all ? can[0] : null));
    if (a) { openAsk(a, r, p); return; }
    commit(r, p);
  }

  function commit(r, p) {
    hist.push({ s: r.state, step: r.step, p });
    say('');
    record({ value: `${sys.procs[p].name}：${r.ev.text}`, detail: `自己走第 ${hist.length} 步`, note: r.bad.length ? plain(r.bad.map((b) => b.kind).join('、')) : undefined });
    if (find && !reached && r.bad.some(isBad(find))) {
      reached = true;
      const how = scheduleText(sys, hist.map((h) => h.p));
      session.record({ type: 'stepper', engine: 'pv', final: true, ok: true, title, q: plain(fields.q), value: `${WHAT[find]}了：${how}`, detail: `自己找到了${WHAT[find]}的走法（${hist.length} 步）`, moves: moves(), el });
      gate?.();
      verdict = `${verdict ? `${verdict}　` : ''}✓ 找到了，${hist.length} 步。`;
    }
    draw();
  }

  // —— 先猜 ——
  function openAsk(a, r, p) {
    pending = { a, r, p, attempts: 0, t0: Date.now() };
    askBox.hidden = false;
    askBox.innerHTML = `<div class="sv-ask-q"><span class="sv-ask-tag">先猜</span>${mdToHtml(a.q, { inline: true })}</div>
      ${a.kind === 'choice' ? `<div class="sv-choices">${a.choices.map((c) => `<button type="button" class="btn sv-choice" data-v="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</div>` : ''}
      ${a.kind === 'number' ? '<div class="sv-ask-row"><input type="text" class="sv-ask-input" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="写一个数（负数写 -1）" aria-label="你的答案"><button type="button" class="btn btn-primary sv-ask-ok">确定</button></div>' : ''}
      ${a.kind === 'pick' ? '<div class="sv-ask-hint muted">在上面的图里点那个进程。</div>' : ''}
      <div class="sv-ask-fb" hidden></div>
      <div class="sv-ask-tools"><button type="button" class="link-btn sv-giveup">想不出来，直接看</button><button type="button" class="link-btn sv-reveal" hidden>看答案</button></div>`;
    const inp = askBox.querySelector('.sv-ask-input');
    if (inp) {
      markDraft(inp, () => (pending ? inp.value.trim() : ''));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(inp.value); } });
      inp.focus({ preventScroll: true });
    }
    askBox.querySelector('.sv-ask-ok')?.addEventListener('click', () => submit(inp.value));
    askBox.querySelectorAll('.sv-choice').forEach((b) => b.addEventListener('click', () => submit(b.dataset.v)));
    askBox.querySelector('.sv-giveup').addEventListener('click', () => finishAsk({ giveup: true }));
    askBox.querySelector('.sv-reveal').addEventListener('click', () => finishAsk({ revealed: true }));
    draw();
    askBox.scrollIntoView?.({ block: 'nearest' });
  }

  function submit(given) {
    if (!pending || !String(given ?? '').trim()) return;
    const { a, p } = pending;
    const res = checkAsk(a, given);
    pending.attempts++;
    // 错了：同一步按常见的错误口径算，答案和学生的一样，就是那种错法（只给老师看）
    let misread = '';
    if (!res.ok) {
      for (const [mistake, label] of MISTAKES) {
        try {
          const rr = pvMove({ ...input, mistake }, cur(), p, hist.length + 1);
          const b = [rr.step.ask, ...(rr.step.asks || [])].find((x) => x && x.tag === a.tag);
          if (b && checkAsk(b, given).ok) { misread = label; break; }
        } catch { /* 这种错法在这一步算不了 */ }
      }
    }
    record({ q: plain(a.q), value: String(given).trim(), pick: a.kind === 'pick' || undefined, ok: res.ok, attempts: pending.attempts, detail: `自己走第 ${hist.length + 1} 步之前先猜`, misread: misread || undefined, ms: Date.now() - pending.t0 });
    if (res.ok) { finishAsk({ ok: true }); return; }
    const box = askBox.querySelector('.sv-ask-fb');
    box.hidden = false;
    box.className = 'sv-ask-fb is-bad';
    box.textContent = res.msg || '不对，再想想。';
    if (pending.attempts >= 2) askBox.querySelector('.sv-reveal').hidden = false;
  }

  function finishAsk({ ok = false, giveup = false, revealed = false }) {
    const { a, r, p, attempts, t0 } = pending;
    session.record({ type: 'stepper', engine: 'pv', final: true, title, q: plain(a.q), ok, attempts, giveup: giveup || undefined, revealed: revealed || undefined, expected: askAnswerText(a), detail: `自己走第 ${hist.length + 1} 步之前先猜`, ms: Date.now() - t0, el });
    if (giveup) session.event('giveup', el, { step: hist.length + 1, title: plain(a.q) });
    pending = null;
    askBox.hidden = true;
    askBox.innerHTML = '';
    verdict = ok ? `✓ 猜对了${attempts > 1 ? `（第 ${attempts} 次）` : ''}` : `答案：${escapeHtml(askAnswerText(a))}`;
    commit(r, p);
  }

  // —— 「我觉得不会死锁」：页面把所有走法都试一遍 ——
  function never() {
    if (pending || reached) return;
    say('页面在把所有走法都试一遍……');
    setTimeout(() => {
      const res = pvSearch(sys, find);
      nevers++;
      if (!res.complete) { say('状态太多了，页面没法把所有走法都试一遍。'); return; }
      if (!res.found) {
        reached = true;
        say(`✓ 对：页面把所有 ${res.states} 种状态都走了一遍，怎么走都不会${WHAT[find]}。`, 'ok');
        session.record({ type: 'stepper', engine: 'pv', final: true, ok: true, title, q: plain(fields.q), value: `判断不会${WHAT[find]}`, attempts: nevers, detail: `判断对了：怎么走都不会${WHAT[find]}`, moves: moves(), el });
        gate?.();
        body.querySelector('.pvd-never').disabled = true;
        return;
      }
      record({ value: `判断不会${WHAT[find]}`, ok: false, attempts: nevers, detail: `其实能${WHAT[find]}（最短 ${res.path.length} 步）` });
      say(`其实能${WHAT[find]}：最短的一种只要 ${res.path.length} 步。再找找${nevers >= 2 ? '，或者看看页面找到的走法' : ''}。`, 'bad');
      if (nevers >= 2) showDemo();
    }, 30);
  }

  // 页面找到的走法：同一段代码，run: deadlock / bad 的演示
  function showDemo() {
    const after = $('.pvd-after');
    if (!after.hidden) return;
    after.hidden = false;
    after.innerHTML = '<button type="button" class="btn pvd-btn pvd-show">看页面找到的走法</button><div class="pvd-demo"></div>';
    after.querySelector('.pvd-show').addEventListener('click', (e) => {
      e.currentTarget.remove();
      const lines = src.split('\n');
      const at = lines.findIndex((l) => /^\s*code\s*[:：]\s*$/i.test(l));
      const headLines = (at < 0 ? lines : lines.slice(0, at)).filter((l) => !/^\s*(mode|ask|find|run|id|title|q|note)\s*[:：]/i.test(l));
      const code = at < 0 ? [] : lines.slice(at);
      session.record({ type: 'stepper', engine: 'pv', liveOnly: true, title, revealed: true, detail: '看了页面找到的走法', el });
      stepperBlock(pvEngine)(after.querySelector('.pvd-demo'), [`id: ${fields.id || 'pv'}-demo`, `title: 页面找到的${WHAT[find]}走法`, ...headLines, `run: ${find === 'bad' ? 'bad' : 'deadlock'}`, ...code].join('\n'));
    });
  }

  body.addEventListener('click', (e) => {
    const go = e.target.closest('.pvd-go');
    if (go) { tap(Number(go.dataset.p)); return; }
    if (e.target.closest('.pvd-undo')) {
      if (!hist.length || pending) return;
      const last = hist.pop();
      say(`撤回了 ${sys.procs[last.p].name} 的「${last.step.view.ev.text}」`);
      record({ value: '撤回一步', detail: `自己走，撤回到第 ${hist.length} 步` });
      draw();
      return;
    }
    if (e.target.closest('.pvd-reset')) {
      if (pending) return;
      hist = [];
      say('');
      record({ value: '从头再来', detail: '自己走，从头再来' });
      draw();
      return;
    }
    if (e.target.closest('.pvd-never')) { never(); return; }
  });
  // 在图上点：先猜「唤醒谁」时是作答；平时点进程就是让它走一句
  stage.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pick]');
    if (!t) return;
    if (pending) { if (pending.a.kind === 'pick') submit(t.dataset.pick); return; }
    const p = sys.procs.findIndex((x) => x.name === t.dataset.pick);
    if (p >= 0) tap(p);
  });

  // 刷新后（课堂）照记录把走过的步放回来：最后一条记录里的 moves 就是当时的顺序
  el._replay = (list) => {
    const last = [...list].reverse().find((r) => Array.isArray(r.moves));
    if (!last) return;
    hist = [];
    for (const name of last.moves) {
      const p = sys.procs.findIndex((x) => x.name === name);
      if (p < 0 || procInfo(input, cur(), p).state !== 'ready') break;
      const r = pvMove(input, cur(), p, hist.length + 1);
      hist.push({ s: r.state, step: r.step, p });
      if (find && r.bad.some(isBad(find))) reached = true;
    }
    draw();
  };

  draw();
  for (const m of tracked.unknown()) session.problem(el, 'pv', m, { soft: true });
}
