// 步进器外壳：一步步走的演示（排序、遍历、查找、页面置换、调度……）都用它。
// 引擎（engines/*.js，纯函数）给出每一步的状态和说明，这里负责：
//   上一步 / 下一步 / 播放 / 拖进度条；ask：走到某一步之前先让学生猜（在图上点、选、写），猜完才揭晓；
//   mode: quiz：只给输入，学生写出结果、页面判分，做完可以看过程；
//   课堂里的 figure set step= / play step / highlight（第几个格子、第几个结点闪一下）；学生走到第几步记成动作（刷新后恢复）。
import { parseFields } from './parse.js';
import { session } from './session.js';
import { widget, mdToHtml, escapeHtml, calcProblems } from './blocks/common.js';
import { figureControls } from './plot.js';
import { commonSpec, resolveAsks, checkAsk, askAnswerText, stepLabel, parseAskField } from './stepperspec.js';
import { markDraft } from './drafts.js';
import { answerWidget, textAnswerSpec } from './blocks/answer.js';

const reduceMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const plainText = (s) => String(s || '').replace(/\$/g, '').replace(/\s+/g, ' ').slice(0, 200);

/**
 * 引擎 → 组件函数 (el, src)。引擎：
 *   name、title（默认标题）
 *   parse(fields, src) → 输入（写错抛出中文原因）
 *   run(输入) → { steps: [{ view, msg, ask? }] }（第 0 步是开始的样子）
 *   view(状态, 输入, { k }) → HTML。可以点的东西写 data-pick="值"（ask 的 pick 靠它），
 *     第 i 个格子 / 结点写 data-cmd="i"（课堂的 highlight i 靠它，从 1 数）
 *   quiz?(输入, run, fields) → { q, type: 'seq' | 'bin' | 'hex', answer, explain? }（mode: quiz 用）
 *   problems?(输入, run) → [中文提醒]（参数能用但不理想时，比如数据已经有序）
 *   defaultAsk?(输入) → 没写 ask: 时默认问哪些（trace 写了 predict: 就问 predict）
 */
export function stepperBlock(engine) {
  block.stepper = true; // render.js：演示组件都是「图」（课堂 figure 能动），也可能有作答，要写 id
  return block;
  function block(el, src) {
    const { fields } = parseFields(src);
    const common = commonSpec(fields);
    const input = engine.parse(fields, src);
    // 有的引擎自带要问的（trace 的 predict:）：没写 ask: 时照它问
    if (!common.ask && engine.defaultAsk) { const d = engine.defaultAsk(input); if (d) common.ask = parseAskField(d); }
    const run = engine.run(input);
    const steps = run.steps;
    const last = steps.length - 1;
    const { asks, errors } = resolveAsks(common.ask, steps);
    for (const e of errors) session.problem(el, engine.name, e);
    for (const e of engine.problems?.(input, run) || []) session.problem(el, engine.name, e, { soft: true });
    for (const msg of calcProblems([fields.title, fields.q, fields.note])) session.problem(el, engine.name, msg);
    const quiz = common.mode === 'quiz' ? engine.quiz?.(input, run, fields) : null;
    if (common.mode === 'quiz' && !quiz) throw new Error(`${engine.name} 没有 quiz 模式`);

    const title = fields.title || engine.title;
    const acts = asks.size > 0 || !!quiz;
    const body = widget(el, { title, cls: `sv-widget sv-${engine.name}${acts ? ' stepper-act' : ''}` });
    body.innerHTML = `
      ${fields.q && !quiz ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
      <div class="sv-quiz" ${quiz ? '' : 'hidden'}></div>
      <div class="sv-demo" ${quiz ? 'hidden' : ''}>
        <div class="sv-stage"></div>
        <div class="sv-msg" aria-live="polite"></div>
        <div class="sv-ask" hidden></div>
        <div class="sv-ctrl">
          <button type="button" class="btn btn-sm sv-reset" title="回到开头" aria-label="回到开头">⏮</button>
          <button type="button" class="btn btn-sm sv-prev">◀ 上一步</button>
          <button type="button" class="btn btn-sm btn-primary sv-next">下一步 ▶</button>
          <button type="button" class="btn btn-sm sv-play">播放</button>
          <span class="sv-count muted"></span>
        </div>
        <input type="range" class="sv-scrub" min="0" max="${last}" step="1" value="0" aria-label="走到第几步">
      </div>
      ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}`;
    const demo = body.querySelector('.sv-demo');
    const stage = body.querySelector('.sv-stage');
    const msg = body.querySelector('.sv-msg');
    const askBox = body.querySelector('.sv-ask');
    const count = body.querySelector('.sv-count');
    const btnPrev = body.querySelector('.sv-prev');
    const btnNext = body.querySelector('.sv-next');
    const btnPlay = body.querySelector('.sv-play');
    const scrub = body.querySelector('.sv-scrub');

    // 关卡（guided 课件）：有 ask 的，问的都答过（或放弃）才算；quiz 做完算；纯演示不拦人
    const gate = acts ? session.gate(el, title) : null;
    const answered = new Set(); // 已经答过（或放弃）的步
    let k = 0; // 现在停在第几步
    let pending = null; // 正在问的：{ at（问的是第几步）, ask, attempts, picked: [] }
    let timer = 0;
    let verdict = ''; // 刚答完的一句（✓ 猜对了 / 看了答案），显示在下一步说明前面

    // —— 课堂操作：变量只有一个 step（停在第几步）；highlight i：第 i 个格子 / 结点闪一下 ——
    const slider = { kind: 'slider', name: 'step', min: 0, max: last, step: 1, init: 0, mods: {}, srcLine: 'step' };
    const cmds = [slider];
    const state = { slider: { step: 0 }, override: {} };
    const ctl = figureControls({ root: stage, cmds, state, extra: {}, env: () => ({ step: k }), draw: () => draw() });
    slider.sync = () => {};
    const want = () => Math.max(0, Math.min(last, Math.floor(Number(state.slider.step) + 1e-9)));

    function draw() {
      const to = want();
      const moved = to !== k;
      k = to;
      if (pending && pending.at !== k + 1) closeAsk();
      const s = steps[k];
      stage.innerHTML = engine.view(s.view, input, { k, picking: pending?.ask.kind === 'pick' });
      if (moved && !reduceMotion()) stage.querySelectorAll('.sv-new').forEach((x) => { x.classList.remove('sv-flash'); void x.offsetWidth; x.classList.add('sv-flash'); });
      // highlight 用的「命令」：画面里有几个 data-cmd 就有几条（从 1 数）
      const n = Math.max(0, ...[...stage.querySelectorAll('[data-cmd]')].map((x) => Number(x.dataset.cmd) || 0));
      cmds.length = 1;
      for (let i = 1; i <= n; i++) cmds.unshift({ kind: 'item', srcLine: `第 ${i} 个`, mods: {} });
      msg.innerHTML = `${verdict ? `<span class="sv-verdict">${verdict}</span>` : ''}${mdToHtml(s.msg || '', { inline: true })}`;
      verdict = '';
      count.textContent = stepLabel(k, last);
      scrub.value = String(k);
      btnPrev.disabled = k === 0;
      btnNext.disabled = k === last;
      if (pending?.ask.kind === 'pick') markPicked();
      ctl.mark();
      ctl.emit('change', { step: k });
      if (k === last) stopPlay();
      checkGate();
    }

    function checkGate() {
      if (!gate || quiz) return;
      if ([...asks].every((a) => answered.has(a)) && k === last) gate();
    }

    // 学生自己走：记成动作（课堂刷新后照它恢复，也跟着下一条消息告诉课堂 Claude）
    function go(to, { record = true } = {}) {
      const t = Math.max(0, Math.min(last, to));
      ctl.stop('step');
      state.slider.step = t;
      draw();
      if (record) session.event('drag', el, { name: 'step', value: k, beat: last });
    }
    // 往前走一步：下一步要问而还没问过，先问
    function forward() {
      if (k >= last) return false;
      const nx = k + 1;
      if (asks.has(nx) && !answered.has(nx)) { openAsk(nx); return false; }
      go(nx);
      return true;
    }

    // —— 先猜再揭晓 ——
    function openAsk(at) {
      stopPlay();
      const ask = steps[at].ask;
      pending = { at, ask, attempts: 0, picked: [], t0: Date.now() };
      const kind = ask.kind;
      askBox.hidden = false;
      askBox.innerHTML = `<div class="sv-ask-q"><span class="sv-ask-tag">先猜</span>${mdToHtml(ask.q, { inline: true })}</div>
        ${kind === 'choice' ? `<div class="sv-choices">${ask.choices.map((c) => `<button type="button" class="btn sv-choice" data-v="${escapeHtml(c)}">${mdToHtml(String(c), { inline: true })}</button>`).join('')}</div>` : ''}
        ${['text', 'number', 'bin', 'hex'].includes(kind) ? `<div class="sv-ask-row"><input type="text" class="sv-ask-input" inputmode="${kind === 'number' ? 'decimal' : kind === 'bin' ? 'numeric' : 'text'}" autocomplete="off" autocorrect="off" autocapitalize="${kind === 'hex' ? 'characters' : 'off'}" spellcheck="false" placeholder="${{ number: '写一个数（可以写分数）', bin: '写二进制，可以空格分组', hex: '写十六进制（可以带 0x 或 H）', text: '写在这里，用空格隔开' }[kind]}" aria-label="你的答案"><button type="button" class="btn btn-primary sv-ask-ok">确定</button></div>` : ''}
        ${kind === 'pick' ? `<div class="sv-ask-hint muted">在上面的图里点${(ask.count || 1) > 1 ? `出 ${ask.count} 个` : '一下'}。</div>${(ask.count || 1) > 1 ? '<button type="button" class="btn btn-primary sv-ask-ok">确定</button>' : ''}` : ''}
        <div class="sv-ask-fb" hidden></div>
        <div class="sv-ask-tools"><button type="button" class="link-btn sv-giveup">想不出来，直接看</button><button type="button" class="link-btn sv-reveal" hidden>看答案</button></div>`;
      stage.classList.toggle('sv-picking', kind === 'pick');
      btnNext.disabled = true;
      const inp = askBox.querySelector('.sv-ask-input');
      if (inp) {
        markDraft(inp, () => (pending ? inp.value.trim() : ''));
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(inp.value); } });
        inp.focus({ preventScroll: true });
      }
      askBox.querySelector('.sv-ask-ok')?.addEventListener('click', () => submit(inp ? inp.value : pending.picked.slice()));
      askBox.querySelectorAll('.sv-choice').forEach((b) => b.addEventListener('click', () => submit(b.dataset.v)));
      askBox.querySelector('.sv-giveup').addEventListener('click', () => finishAsk({ giveup: true }));
      askBox.querySelector('.sv-reveal').addEventListener('click', () => finishAsk({ revealed: true }));
      askBox.scrollIntoView?.({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }

    function closeAsk() {
      pending = null;
      askBox.hidden = true;
      askBox.innerHTML = '';
      stage.classList.remove('sv-picking');
    }

    function markPicked() {
      stage.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('sv-picked', !!pending?.picked.includes(x.dataset.pick)));
    }

    stage.addEventListener('click', (e) => {
      if (!pending || pending.ask.kind !== 'pick') return;
      const t = e.target.closest('[data-pick]');
      if (!t) return;
      const v = t.dataset.pick;
      if ((pending.ask.count || 1) <= 1) { submit(v); return; }
      const i = pending.picked.indexOf(v);
      if (i >= 0) pending.picked.splice(i, 1);
      else if (pending.picked.length < pending.ask.count) pending.picked.push(v);
      markPicked();
    });

    function submit(given) {
      if (!pending) return;
      const empty = Array.isArray(given) ? given.length === 0 : !String(given ?? '').trim();
      if (empty) return;
      const { ask, at } = pending;
      const r = checkAsk(ask, given);
      pending.attempts++;
      const shown = Array.isArray(given) ? given.join('、') : String(given).trim();
      session.record({ type: 'stepper', engine: engine.name, liveOnly: true, title, q: plainText(ask.q), value: shown, pick: ask.kind === 'pick' || undefined, ok: r.ok, attempts: pending.attempts, detail: `第 ${at} 步`, ms: Date.now() - pending.t0, el });
      if (r.ok) { finishAsk({ ok: true }); return; }
      const fb = askBox.querySelector('.sv-ask-fb');
      fb.hidden = false;
      fb.className = 'sv-ask-fb is-bad';
      fb.innerHTML = escapeHtml(r.msg || '不对，再想想。');
      if (pending.attempts >= 2) askBox.querySelector('.sv-reveal').hidden = false;
      if (ask.kind === 'pick') { pending.picked = []; markPicked(); }
    }

    function finishAsk({ ok = false, giveup = false, revealed = false }) {
      if (!pending) return;
      const { ask, at, attempts } = pending;
      answered.add(at);
      session.record({ type: 'stepper', engine: engine.name, final: true, title, q: plainText(ask.q), ok, attempts, giveup: giveup || undefined, revealed: revealed || undefined, expected: askAnswerText(ask), detail: `第 ${at} 步`, ms: Date.now() - pending.t0, el });
      if (giveup) session.event('giveup', el, { step: at, title: plainText(ask.q) });
      verdict = ok ? `✓ 猜对了${attempts > 1 ? `（第 ${attempts} 次）` : ''}` : `答案：${escapeHtml(askAnswerText(ask))}`;
      if (ask.explain) verdict += `　${mdToHtml(ask.explain, { inline: true })}`;
      closeAsk();
      go(at);
    }

    // —— 播放：到要问的步停下来问 ——
    function stopPlay() { clearInterval(timer); timer = 0; btnPlay.textContent = '播放'; }
    btnPlay.addEventListener('click', () => {
      if (timer) { stopPlay(); return; }
      if (k >= last) go(0);
      btnPlay.textContent = '暂停';
      timer = setInterval(() => { if (!el.isConnected || !forward()) stopPlay(); }, common.speed * 1000);
    });
    btnNext.addEventListener('click', () => { stopPlay(); forward(); });
    btnPrev.addEventListener('click', () => { stopPlay(); closeAsk(); go(k - 1); });
    body.querySelector('.sv-reset').addEventListener('click', () => { stopPlay(); closeAsk(); go(0); });
    // 拖进度条：不能越过还没答的问题
    scrub.addEventListener('input', () => {
      stopPlay();
      let to = Number(scrub.value);
      const blocker = [...asks].filter((a) => !answered.has(a) && a > k && a <= to).sort((a, b) => a - b)[0];
      if (blocker) { to = blocker - 1; go(to); openAsk(blocker); return; }
      closeAsk();
      go(to);
    });

    // —— quiz：只给输入，写出结果；做完可以看过程 ——
    if (quiz) {
      const qbox = body.querySelector('.sv-quiz');
      const spec = textAnswerSpec(quiz.type || 'seq', quiz.answer, { width: quiz.width });
      const q = fields.q ? `${fields.q}\n\n${quiz.q}` : quiz.q;
      const onTry = (t) => session.record({ type: 'stepper', engine: engine.name, liveOnly: true, title, q: plainText(q), value: t.text, ok: t.ok, attempts: t.attempts, detail: '写出结果', el });
      answerWidget(qbox, { q, qhtml: quiz.qhtml ? `<div class="sv-stage sv-stage-q">${quiz.qhtml}</div>` : '', text: spec, explain: quiz.explain, hint: fields.hint, onTry }, (r) => {
        session.record({ type: 'stepper', engine: engine.name, final: true, title, q: plainText(q), ok: r.ok, attempts: r.attempts, revealed: r.revealed || undefined, expected: spec.display, detail: '写出结果', el });
        gate?.();
        qbox.insertAdjacentHTML('beforeend', '<button type="button" class="btn sv-show-demo">看一步步的过程</button>');
        qbox.querySelector('.sv-show-demo').addEventListener('click', (e) => { e.currentTarget.remove(); demo.hidden = false; go(0, { record: false }); });
      });
    }

    // 一开始停在哪：start: end 直接看结果
    state.slider.step = common.start === 'end' ? last : Math.min(last, common.start);
    k = -1;
    draw();
    if (common.auto && !quiz && !asks.size) {
      // auto: true 出现在屏幕上以后自己播
      const startPlay = () => { if (!timer && k < last) btnPlay.click(); };
      if (typeof IntersectionObserver !== 'undefined') {
        const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); startPlay(); } });
        io.observe(el);
      } else startPlay();
    }

    // board mark 的 label=：按格子 / 结点上写的字找（data-label 优先，没有就用显示的文字）
    const labelOf = (x) => (x.dataset.label ?? x.textContent).trim();
    const api = {
      draw,
      cmdOfLabel(text) {
        const want = String(text ?? '').trim().toUpperCase();
        const hit = [...stage.querySelectorAll('[data-cmd]')].find((x) => labelOf(x).toUpperCase() === want);
        return hit ? Number(hit.dataset.cmd) : 0;
      },
      labels: () => [...new Set([...stage.querySelectorAll('[data-cmd]')].map(labelOf).filter(Boolean))].slice(0, 20),
      on: ctl.on,
      animate: ctl.animate,
      play: (name, from, to, ms) => { if (name !== 'step') throw new Error(`演示只有一个变量 step（停在第几步，0 到 ${last}）`); closeAsk(); return ctl.play('step', from, to, ms); },
      highlight: ctl.highlight,
      vars: () => ({ step: k }),
      snapshot: () => ({ step: k }),
      // 课堂里老师直接跳：不问（问题留给学生自己点「下一步」时）
      set(name, value) {
        if (name !== 'step') throw new Error(`演示只有一个变量 step（停在第几步，0 到 ${last}）`);
        const v = Math.round(Number(value));
        if (!(v >= 0 && v <= last)) throw new Error(`step 写 0 到 ${last} 之间的数`);
        stopPlay();
        closeAsk();
        if (quiz) demo.hidden = false;
        return ctl.set('step', v, { ms: 0 });
      },
    };
    const id = session.registerScene(el, api, title);
    el.dataset.scene = id;
  }
}
