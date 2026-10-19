// 步进器外壳：一步步走的演示（排序、遍历、查找、页面置换、调度……）都用它。
// 引擎（engines/*.js，纯函数）给出每一步的状态和说明，这里负责：
//   上一步 / 下一步 / 播放 / 拖进度条；ask：走到某一步之前先让学生猜（在图上点、选、写），猜完才揭晓；
//   mode: quiz：只给输入，学生写出结果、页面判分，做完可以看过程；
//   课堂里的 figure set step= / play step / highlight（第几个格子、第几个结点闪一下）；学生走到第几步记成动作（刷新后恢复）。
import { parseFields } from './parse.js';
import { session } from './session.js';
import { widget, mdToHtml, tex2html, escapeHtml, calcProblems } from './blocks/common.js';
import { figureControls } from './plot.js';
import { commonSpec, resolveAsks, checkAsk, askAnswerText, stepLabel, parseAskField, fillSpec, checkFill, cellName, cellAnswer, fillOrder, misreadFill, misreadAnswer } from './stepperspec.js';
import { markDraft } from './drafts.js';
import { answerWidget, textAnswerSpec } from './blocks/answer.js';
import { snapshot, animateFrom, settle } from './morph.js';
import { cellOk as cellOkFor } from './stepperspec.js';

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
 *   table?(输入, run, fields) → 考试里那张表（mode: fill 用；格式见 stepperspec.js 的「自己填表」）
 *   variants?(输入, fields) → [{ label: '像是按 FIFO 换的', input: 换成那种错法的输入 }]：常见错法。
 *     学生答错时拿错法算一遍，对得上就在记录里写一句（只给老师看）
 *   problems?(输入, run) → [中文提醒]（参数能用但不理想时，比如数据已经有序）
 *   defaultAsk?(输入) → 没写 ask: 时默认问哪些（trace 写了 predict: 就问 predict）
 */
export function stepperBlock(engine) {
  block.stepper = true; // render.js：演示组件都是「图」（课堂 figure 能动），也可能有作答，要写 id
  return block;
  function block(el, src) {
    // frames 这种正文里自己有「key: 值」的行的：字段只从开头那一段读（engine.head）
    const { fields } = parseFields(engine.head ? engine.head(src) : src);
    const common = commonSpec(fields);
    const input = engine.parse(fields, src);
    // 有的引擎自带要问的（trace 的 predict:）：没写 ask: 时照它问
    if ((fields.ask === undefined || fields.ask === '') && engine.defaultAsk) { const d = engine.defaultAsk(input); if (d) common.ask = parseAskField(d); }
    const run = engine.run(input);
    const steps = run.steps;
    const last = steps.length - 1;
    const { asks, which, errors } = resolveAsks(common.ask, steps);
    for (const e of errors) session.problem(el, engine.name, e);
    for (const e of engine.problems?.(input, run) || []) session.problem(el, engine.name, e, { soft: true });
    for (const msg of calcProblems([fields.title, fields.q, fields.note])) session.problem(el, engine.name, msg);
    const quiz = common.mode === 'quiz' ? engine.quiz?.(input, run, fields) : null;
    if (common.mode === 'quiz' && !quiz) throw new Error(`${engine.name} 没有 quiz 模式`);
    let fill = null;
    if (common.mode === 'fill') {
      const t = engine.table?.(input, run, fields);
      if (!t) throw new Error(`${engine.name} 还没有 fill（自己填表）模式，用 mode: quiz 或 ask:`);
      const r = fillSpec(t, fields);
      for (const e of r.errors) session.problem(el, engine.name, e);
      fill = r.table;
    }
    // 常见错法：学生答错时拿来比（第一次用到时才算）
    let variantRuns = null;
    const variants = () => {
      if (variantRuns) return variantRuns;
      variantRuns = [];
      for (const v of engine.variants?.(input, fields) || []) {
        try { variantRuns.push({ label: v.label, input: v.input, run: engine.run(v.input) }); } catch { /* 这种错法在这组数上算不了 */ }
      }
      return variantRuns;
    };

    const title = fields.title || engine.title;
    const acts = asks.size > 0 || !!quiz || !!fill;
    const body = widget(el, { title, cls: `sv-widget sv-${engine.name}${acts ? ' stepper-act' : ''}` });
    body.innerHTML = `
      ${fields.q && !quiz && !fill ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
      <div class="sv-quiz" ${quiz ? '' : 'hidden'}></div>
      <div class="sv-fill" ${fill ? '' : 'hidden'}></div>
      <div class="sv-demo" ${quiz || fill ? 'hidden' : ''}>
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
    const blankDone = new Set(); // 挖了空的步：已经填对（或看了答案）的
    let blanking = -1; // 正在填空的那一步（-1：没有）
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
      // 一步一步走（下一步、上一步、播放）时补过渡：挪了位置的滑过去、变了颜色的渐变；一下跳好几步就直接换
      const glide = moved && k >= 0 && Math.abs(to - k) === 1 && !reduceMotion() && !!stage.animate;
      let snap = null;
      if (glide) { settle(stage); snap = snapshot(stage); }
      k = to;
      if (pending && pending.at !== k + 1) closeAsk();
      const s = steps[k];
      if (blanking >= 0 && blanking !== k) blanking = -1;
      const filling = blanking === k;
      stage.innerHTML = engine.view(s.view, input, {
        k, md: mdToHtml, tex: (t) => tex2html(t), picking: pending && ['pick', 'order'].includes(pending.ask.kind),
        // 挖空：正在填的这一步画成输入框；填过的、往回翻的画成答案
        blank: (i) => (filling ? `<input type="text" class="sv-blank" data-b="${i}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="第 ${i + 1} 个空">` : `<span class="sv-blank-a">${escapeHtml(String([].concat(s.blanks?.[i]?.v ?? '')[0]))}</span>`),
      });
      if (filling) openBlanks(k);
      if (snap) animateFrom(stage, snap, { ms: Math.min(360, common.speed * 600) });
      if (moved && !reduceMotion()) stage.querySelectorAll('.sv-new').forEach((x) => { x.classList.remove('sv-flash'); void x.offsetWidth; x.classList.add('sv-flash'); });
      // highlight 用的「命令」：画面里有几个 data-cmd 就有几条（从 1 数）
      const n = Math.max(0, ...[...stage.querySelectorAll('[data-cmd]')].map((x) => Number(x.dataset.cmd) || 0));
      cmds.length = 1;
      for (let i = 1; i <= n; i++) cmds.unshift({ kind: 'item', srcLine: `第 ${i} 个`, mods: {} });
      // 正在填空时先不给说明（说明里常常就有答案）
      msg.innerHTML = filling ? '<span class="muted">把上面的空填好，点「检查」。</span>' : `${verdict ? `<span class="sv-verdict">${verdict}</span>` : ''}${mdToHtml(s.msg || '', { inline: true })}`;
      if (!filling) verdict = '';
      count.textContent = stepLabel(k, last);
      scrub.value = String(k);
      btnPrev.disabled = k === 0;
      btnNext.disabled = k === last || filling;
      if (pending && ['pick', 'order'].includes(pending.ask.kind)) markPicked();
      ctl.mark();
      ctl.emit('change', { step: k });
      if (k === last) stopPlay();
      checkGate();
    }

    function checkGate() {
      if (!gate || quiz || fill) return;
      const blanksOk = steps.every((x, i) => !x.blanks || blankDone.has(i));
      if ([...asks].every((a) => answered.has(a)) && blanksOk && k === last) gate();
    }

    // —— 挖空（frames 的 {{答案}}）：走到这一步先把空填上，检查对了才往下 ——
    let blankTries = 0, blankT0 = 0;
    function openBlanks(at) {
      const bl = steps[at].blanks || [];
      askBox.hidden = false;
      askBox.innerHTML = `<div class="sv-ask-q"><span class="sv-ask-tag">填空</span>这一步有 ${bl.length} 个空，填好再往下。</div>
        <div class="sv-ask-row"><button type="button" class="btn btn-primary sv-blank-ok">检查</button></div>
        <div class="sv-ask-fb" hidden></div>
        <div class="sv-ask-tools"><button type="button" class="link-btn sv-blank-show" ${blankTries >= 2 ? '' : 'hidden'}>看答案</button><button type="button" class="link-btn sv-blank-give">想不出来，直接看</button></div>`;
      const inputs = [...stage.querySelectorAll('.sv-blank')];
      markDraft(askBox, () => (blanking === at ? inputs.map((x, i) => (x.value.trim() ? `第 ${i + 1} 个空：${x.value.trim()}` : '')).filter(Boolean).join('，') : ''));
      inputs.forEach((x, i) => x.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; e.preventDefault(); (inputs[i + 1] || askBox.querySelector('.sv-blank-ok')).focus(); }));
      inputs.forEach((x) => x.addEventListener('input', () => x.classList.remove('is-bad')));
      askBox.querySelector('.sv-blank-ok').addEventListener('click', () => {
        const vals = inputs.map((x) => x.value);
        if (vals.every((v) => !v.trim())) return;
        blankTries++;
        const bad = bl.map((b, i) => (cellOkFor(b, vals[i] ?? '') ? -1 : i)).filter((i) => i >= 0);
        inputs.forEach((x, i) => { x.classList.toggle('is-bad', bad.includes(i)); x.classList.toggle('is-ok', !bad.includes(i) && !!vals[i]?.trim()); });
        session.record({ type: 'stepper', engine: engine.name, liveOnly: true, title, q: plainText(steps[at].msg ? `第 ${at} 步的空` : ''), value: vals.map((v, i) => `${i + 1}:${v.trim() || '（空）'}`).join(' '), ok: !bad.length, attempts: blankTries, detail: `第 ${at} 步的空`, ms: Date.now() - blankT0, el });
        if (!bad.length) { finishBlanks(at, { ok: true }); return; }
        const fb = askBox.querySelector('.sv-ask-fb');
        fb.hidden = false;
        fb.className = 'sv-ask-fb is-bad';
        fb.textContent = bad.length === 1 ? `第 ${bad[0] + 1} 个空不对，再想想。` : `有 ${bad.length} 个空不对（第 ${bad.map((i) => i + 1).join('、')} 个），再想想。`;
        if (blankTries >= 2) askBox.querySelector('.sv-blank-show').hidden = false;
        inputs[bad[0]]?.focus({ preventScroll: true });
      });
      askBox.querySelector('.sv-blank-show').addEventListener('click', () => finishBlanks(at, { revealed: true }));
      askBox.querySelector('.sv-blank-give').addEventListener('click', () => finishBlanks(at, { giveup: true }));
    }
    function finishBlanks(at, { ok = false, revealed = false, giveup = false }) {
      blankDone.add(at);
      session.record({ type: 'stepper', engine: engine.name, final: true, title, q: `第 ${at} 步的空`, ok, attempts: blankTries, revealed: revealed || undefined, giveup: giveup || undefined, expected: (steps[at].blanks || []).map((b) => [].concat(b.v)[0]).join('、'), detail: `第 ${at} 步的空`, ms: Date.now() - blankT0, el });
      if (giveup) session.event('giveup', el, { step: at, title: '填空' });
      verdict = ok ? `✓ 填对了${blankTries > 1 ? `（第 ${blankTries} 次）` : ''}` : '答案已经写上了。';
      blanking = -1;
      closeAsk();
      draw();
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
      if (k >= last || blanking === k) return false;
      const nx = k + 1;
      if (asks.has(nx) && !answered.has(nx)) { openAsk(nx); return false; }
      enter(nx);
      return blanking !== nx;
    }
    // 走到一步：这一步有没填的空，就进入填空
    function enter(to, opts) {
      if (steps[to]?.blanks && !blankDone.has(to)) { blanking = to; blankTries = 0; blankT0 = Date.now(); }
      go(to, opts);
    }

    // —— 先猜再揭晓 ——
    function openAsk(at) {
      stopPlay();
      const ask = which.get(at) || steps[at].ask;
      pending = { at, ask, attempts: 0, picked: [], t0: Date.now() };
      const kind = ask.kind;
      askBox.hidden = false;
      askBox.innerHTML = `<div class="sv-ask-q"><span class="sv-ask-tag">先猜</span>${mdToHtml(ask.q, { inline: true })}</div>
        ${kind === 'choice' ? `<div class="sv-choices">${ask.choices.map((c) => `<button type="button" class="btn sv-choice" data-v="${escapeHtml(c)}">${mdToHtml(String(c), { inline: true })}</button>`).join('')}</div>` : ''}
        ${['text', 'number', 'bin', 'hex'].includes(kind) ? `<div class="sv-ask-row"><input type="text" class="sv-ask-input" inputmode="${kind === 'number' ? 'decimal' : kind === 'bin' ? 'numeric' : 'text'}" autocomplete="off" autocorrect="off" autocapitalize="${kind === 'hex' ? 'characters' : 'off'}" spellcheck="false" placeholder="${{ number: '写一个数（可以写分数）', bin: '写二进制，可以空格分组', hex: '写十六进制（可以带 0x 或 H）', text: '写在这里，用空格隔开' }[kind]}" aria-label="你的答案"><button type="button" class="btn btn-primary sv-ask-ok">确定</button></div>` : ''}
        ${kind === 'pick' ? `<div class="sv-ask-hint muted">在上面的图里点${(ask.count || 1) > 1 ? `出 ${ask.count} 个` : '一下'}。</div>${(ask.count || 1) > 1 ? '<button type="button" class="btn btn-primary sv-ask-ok">确定</button>' : ''}` : ''}
        ${kind === 'order' ? `<div class="sv-ask-hint muted">在上面的图里按顺序一个个点，点过的标上 1、2、3……</div><div class="sv-ask-row"><span class="sv-order-seq" aria-live="polite"></span><button type="button" class="btn sv-order-undo">撤销一个</button><button type="button" class="btn btn-primary sv-ask-ok">确定</button></div>` : ''}
        <div class="sv-ask-fb" hidden></div>
        <div class="sv-ask-tools"><button type="button" class="link-btn sv-giveup">想不出来，直接看</button><button type="button" class="link-btn sv-reveal" hidden>看答案</button></div>`;
      stage.classList.toggle('sv-picking', kind === 'pick' || kind === 'order');
      askBox.querySelector('.sv-order-undo')?.addEventListener('click', () => { pending?.picked.pop(); markPicked(); });
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
      const picked = pending?.picked || [];
      stage.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('sv-picked', picked.includes(x.dataset.pick)));
      // 按顺序点：点过的标上第几个（SVG 里的结点加一个小圆牌，格子里加一个角标）
      stage.querySelectorAll('.sv-order-badge').forEach((b) => b.remove());
      if (pending?.ask.kind !== 'order') return;
      picked.forEach((v, i) => {
        const x = [...stage.querySelectorAll('[data-pick]')].find((y) => y.dataset.pick === v);
        if (!x) return;
        if (x instanceof SVGElement) {
          const box = x.getBBox?.();
          if (!box) return;
          const ns = 'http://www.w3.org/2000/svg';
          const g = document.createElementNS(ns, 'g');
          g.setAttribute('class', 'sv-order-badge');
          const c = document.createElementNS(ns, 'circle');
          c.setAttribute('cx', box.x + box.width); c.setAttribute('cy', box.y); c.setAttribute('r', 9);
          const t = document.createElementNS(ns, 'text');
          t.setAttribute('x', box.x + box.width); t.setAttribute('y', box.y);
          t.textContent = String(i + 1);
          g.append(c, t);
          x.appendChild(g);
        } else x.insertAdjacentHTML('beforeend', `<span class="sv-order-badge">${i + 1}</span>`);
      });
      const seq = askBox.querySelector('.sv-order-seq');
      if (seq) seq.textContent = picked.length ? picked.join(' → ') : '（还没点）';
    }

    stage.addEventListener('click', (e) => {
      if (!pending || !['pick', 'order'].includes(pending.ask.kind)) return;
      const t = e.target.closest('[data-pick]');
      if (!t) return;
      const v = t.dataset.pick;
      if (pending.ask.kind === 'order') {
        // 再点最后一个 = 撤销它；点过的别的不再收（序列里一般不重复）
        if (pending.picked.at(-1) === v) pending.picked.pop();
        else if (!pending.picked.includes(v)) pending.picked.push(v);
        markPicked();
        return;
      }
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
      // 错了：同一个问题（题面一样）在常见错法下的答案和学生的一样，就是那种错法
      const misread = r.ok ? '' : misreadAnswer(given, variants().map((v) => {
        const a = v.run.steps.flatMap((x) => [x.ask, ...(x.asks || [])]).find((y) => y && y.q === ask.q && y.kind === ask.kind);
        return a ? { label: v.label, answer: Array.isArray(a.alts) ? a.alts.map((z) => [].concat(z).join(' ')).join(' | ') : [].concat(a.answer).join(' ') } : null;
      }).filter(Boolean));
      session.record({ type: 'stepper', engine: engine.name, liveOnly: true, title, q: plainText(ask.q), value: shown, pick: ask.kind === 'pick' || undefined, ok: r.ok, attempts: pending.attempts, detail: `第 ${at} 步`, misread: misread || undefined, ms: Date.now() - pending.t0, el });
      if (r.ok) { finishAsk({ ok: true }); return; }
      const fb = askBox.querySelector('.sv-ask-fb');
      fb.hidden = false;
      fb.className = 'sv-ask-fb is-bad';
      fb.innerHTML = escapeHtml(r.msg || '不对，再想想。');
      if (pending.attempts >= 2) askBox.querySelector('.sv-reveal').hidden = false;
      if (ask.kind === 'pick') { pending.picked = []; markPicked(); }
      // 按顺序点：留着前面对的那几个，错的那个和后面的撤掉，接着点
      if (ask.kind === 'order') { pending.picked = pending.picked.slice(0, r.prefix || 0); markPicked(); }
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
      enter(at);
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
    btnPrev.addEventListener('click', () => { stopPlay(); closeAsk(); blanking = -1; go(k - 1); });
    body.querySelector('.sv-reset').addEventListener('click', () => { stopPlay(); closeAsk(); blanking = -1; go(0); });
    // 拖进度条：不能越过还没答的问题、还没填的空
    scrub.addEventListener('input', () => {
      stopPlay();
      let to = Number(scrub.value);
      const blocker = [...asks].filter((a) => !answered.has(a) && a > k && a <= to).sort((a, b) => a - b)[0];
      const hole = steps.findIndex((x, i) => i > k && i <= to && x.blanks && !blankDone.has(i));
      if (blocker && (hole < 0 || blocker <= hole)) { to = blocker - 1; blanking = -1; go(to); openAsk(blocker); return; }
      closeAsk();
      if (hole >= 0) { enter(hole); return; }
      blanking = -1;
      go(to);
    });

    // —— quiz：只给输入，写出结果；做完可以看过程 ——
    if (quiz) {
      const qbox = body.querySelector('.sv-quiz');
      const spec = textAnswerSpec(quiz.type || 'seq', quiz.answer, { width: quiz.width });
      const q = fields.q ? `${fields.q}\n\n${quiz.q}` : quiz.q;
      const onTry = (t) => {
        const same = quiz.type === 'num' ? (a, b) => cellOkFor({ v: a, num: true }, b) : undefined;
        const misread = t.ok ? '' : misreadAnswer(t.text, variants().map((v) => { try { const a = engine.quiz(v.input, v.run, fields); return a ? { label: v.label, answer: String(a.answer) } : null; } catch { return null; } }).filter(Boolean), same);
        session.record({ type: 'stepper', engine: engine.name, liveOnly: true, title, q: plainText(q), value: t.text, ok: t.ok, attempts: t.attempts, detail: '写出结果', misread: misread || undefined, el });
      };
      answerWidget(qbox, { q, qhtml: quiz.qhtml ? `<div class="sv-stage sv-stage-q">${quiz.qhtml}</div>` : '', text: spec, explain: quiz.explain, hint: fields.hint, onTry }, (r) => {
        session.record({ type: 'stepper', engine: engine.name, final: true, title, q: plainText(q), ok: r.ok, attempts: r.attempts, revealed: r.revealed || undefined, expected: spec.display, detail: '写出结果', el });
        gate?.();
        qbox.insertAdjacentHTML('beforeend', '<button type="button" class="btn sv-show-demo">看一步步的过程</button>');
        qbox.querySelector('.sv-show-demo').addEventListener('click', (e) => { e.currentTarget.remove(); demo.hidden = false; go(0, { record: false }); });
      });
    }

    if (fill) buildFill();

    // —— fill：自己把整张表填出来，逐格判，只指出第一处不对 ——
    function buildFill() {
      const box = body.querySelector('.sv-fill');
      const t = fill;
      const order = fillOrder(t);
      const values = t.rows.map((row) => row.cells.map(() => ''));
      values.extra = (t.extra || []).map(() => '');
      const q = [fields.q, t.q || '把下面这张表填完整，点「检查」。'].filter(Boolean).join('\n\n');
      const pic = t.qhtml ?? engine.view(steps[0].view, input, { k: 0 });
      const width = (cell) => Math.max(2, Math.min(9, Math.max(...[].concat(cell.v).map((x) => String(x ?? '').length)) + 1));
      const cellHtml = (cell, r, c) => {
        if (cell.given) return `<td class="sv-fill-given">${escapeHtml(cellAnswer(cell) === '（空）' ? '' : cellAnswer(cell))}</td>`;
        if (cell.mark) return `<td><button type="button" class="sv-fill-mark" data-r="${r}" data-c="${c}" aria-pressed="false" aria-label="${escapeHtml(cellName(t, r, c))}：点一下打勾"></button></td>`;
        return `<td><input type="text" class="sv-fill-in" data-r="${r}" data-c="${c}" size="${width(cell)}" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" aria-label="${escapeHtml(cellName(t, r, c))}"></td>`;
      };
      const copyBtn = (r) => (t.copy && r > 0 ? `<button type="button" class="btn btn-sm sv-fill-copy" data-r="${r}" title="把上一${t.dir === 'col' ? '列' : '行'}抄过来，再改不一样的格子">照抄</button>` : '');
      let grid = '';
      if (t.dir === 'col') {
        grid += `<tr><th></th>${t.rows.map((row) => `<th scope="col">${escapeHtml(row.label ?? '')}</th>`).join('')}</tr>`;
        t.head.forEach((h, c) => { grid += `<tr><th scope="row">${escapeHtml(h)}</th>${t.rows.map((row, r) => cellHtml(row.cells[c], r, c)).join('')}</tr>`; });
        if (t.copy) grid += `<tr class="sv-fill-copyrow"><th></th>${t.rows.map((_, r) => `<td>${copyBtn(r)}</td>`).join('')}</tr>`;
      } else {
        grid += `<tr><th></th>${t.head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}${t.copy ? '<th></th>' : ''}</tr>`;
        t.rows.forEach((row, r) => { grid += `<tr><th scope="row">${escapeHtml(row.label ?? '')}</th>${row.cells.map((cell, c) => cellHtml(cell, r, c)).join('')}${t.copy ? `<td>${copyBtn(r)}</td>` : ''}</tr>`; });
      }
      box.innerHTML = `<div class="w-q">${mdToHtml(q)}</div>
        ${pic ? `<div class="sv-stage sv-stage-q">${pic}</div>` : ''}
        <div class="sv-fill-wrap"><table class="sv-fill-t${t.dir === 'col' ? ' sv-fill-cols' : ''}">${grid}</table></div>
        ${(t.extra || []).length ? `<div class="sv-fill-extra">${t.extra.map((x, i) => `<label class="sv-fill-x"><span>${escapeHtml(x.label)}</span><input type="text" class="sv-fill-in sv-fill-xin" data-x="${i}" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="${escapeHtml(x.label)}"></label>`).join('')}</div>` : ''}
        ${t.note ? `<div class="w-note">${mdToHtml(t.note)}</div>` : ''}
        <div class="sv-fill-fb" aria-live="polite" hidden></div>
        <div class="sv-fill-ctrl"><button type="button" class="btn btn-primary sv-fill-check">检查</button><button type="button" class="btn sv-fill-reveal" hidden>看这一格的答案</button><button type="button" class="link-btn sv-fill-giveup">想不出来，看过程</button></div>`;
      const fb = box.querySelector('.sv-fill-fb');
      // first 可能是表下面的一格（{ extra: i }）
      const elOf = (r, c) => (r && typeof r === 'object' ? box.querySelector(`[data-x="${r.extra}"]`) : box.querySelector(`[data-r="${r}"][data-c="${c}"]`));
      const at = (f) => (f.extra !== undefined ? f : f.r);
      const read = () => {
        box.querySelectorAll('.sv-fill-in:not(.sv-fill-xin)').forEach((x) => { values[x.dataset.r][x.dataset.c] = x.value; });
        box.querySelectorAll('.sv-fill-xin').forEach((x) => { values.extra[x.dataset.x] = x.value; });
        box.querySelectorAll('.sv-fill-mark').forEach((x) => { values[x.dataset.r][x.dataset.c] = x.getAttribute('aria-pressed') === 'true' ? '√' : ''; });
        return values;
      };
      let attempts = 0, done = false, revealed = 0, last = null;
      const t0 = Date.now();
      // 草稿：填了几格、写的是什么（课堂发下一轮时一起告诉老师）
      markDraft(box.querySelector('.sv-fill-wrap'), () => {
        if (done) return '';
        read();
        const filled = order.filter(({ r, c }) => String(values[r][c]).trim());
        const xs = (t.extra || []).map((x, i) => [x.label, String(values.extra[i]).trim()]).filter(([, v]) => v);
        if (!filled.length && !xs.length) return '';
        return `填了 ${filled.length}/${order.length} 格：` + filled.slice(0, 24).map(({ r, c }) => `${t.rows[r].label ?? r + 1}·${t.head[c]}=${values[r][c]}`).join('，') + xs.map(([k, v]) => `；${k}=${v}`).join('');
      });
      box.addEventListener('click', (e) => {
        const m = e.target.closest('.sv-fill-mark');
        if (m && !done) { const on = m.getAttribute('aria-pressed') !== 'true'; m.setAttribute('aria-pressed', on ? 'true' : 'false'); m.textContent = on ? '√' : ''; m.closest('td').classList.remove('is-bad', 'is-ok'); return; }
        const cp = e.target.closest('.sv-fill-copy');
        if (cp && !done) {
          const r = Number(cp.dataset.r);
          t.rows[r].cells.forEach((cell, c) => {
            const from = elOf(r - 1, c), to = elOf(r, c);
            if (!to || !from) return;
            if (to.matches('input') && from.matches('input') && !to.value) to.value = from.value;
            else if (to.matches('input') && !to.value && !from.matches('button')) { const g = t.rows[r - 1].cells[c]; if (g.given) to.value = cellAnswer(g) === '（空）' ? '' : cellAnswer(g); }
          });
        }
      });
      box.addEventListener('input', (e) => { e.target.closest('td, .sv-fill-x')?.classList.remove('is-bad', 'is-ok'); });
      // 回车跳到下一格
      box.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.matches('.sv-fill-in')) return;
        e.preventDefault();
        const all = [...order.map(({ r, c }) => elOf(r, c)), ...(t.extra || []).map((_, i) => elOf({ extra: i }))].filter((x) => x?.matches('input'));
        const nx = all[all.indexOf(e.target) + 1];
        if (nx) nx.focus(); else box.querySelector('.sv-fill-check').focus();
      });
      const cellBox = (x) => x?.closest('td, .sv-fill-x');
      const show = (res) => {
        box.querySelectorAll('.is-ok, .is-bad').forEach((x) => x.classList.remove('is-ok', 'is-bad'));
        order.slice(0, res.okCount).forEach(({ r, c }) => cellBox(elOf(r, c))?.classList.add('is-ok'));
        (t.extra || []).forEach((_, i) => { if (order.length + i < res.okCount) cellBox(elOf({ extra: i }))?.classList.add('is-ok'); });
        if (res.first) cellBox(elOf(at(res.first), res.first.c))?.classList.add('is-bad');
      };
      const finish = (how) => {
        done = true;
        box.querySelectorAll('.sv-fill-in').forEach((x) => { x.readOnly = true; });
        box.querySelector('.sv-fill-check').hidden = true;
        box.querySelector('.sv-fill-reveal').hidden = true;
        box.querySelector('.sv-fill-giveup').hidden = true;
        session.record({ type: 'stepper', engine: engine.name, final: true, title, q: plainText(q), ok: how === 'ok', attempts, revealed: revealed || undefined, giveup: how === 'giveup' || undefined, detail: '填表', ms: Date.now() - t0, el });
        gate?.();
        box.insertAdjacentHTML('beforeend', '<button type="button" class="btn sv-show-demo">看一步步的过程</button>');
        box.querySelector('.sv-show-demo').addEventListener('click', (e) => { e.currentTarget.remove(); demo.hidden = false; go(0, { record: false }); });
      };
      box.querySelector('.sv-fill-check').addEventListener('click', () => {
        if (done) return;
        read();
        const res = checkFill(t, values);
        attempts++;
        show(res);
        fb.hidden = false;
        if (res.ok) {
          fb.className = 'sv-fill-fb is-ok';
          fb.textContent = attempts === 1 && !revealed ? '✓ 全对。' : `✓ 全对（检查了 ${attempts} 次${revealed ? `，看了 ${revealed} 格答案` : ''}）。`;
          session.record({ type: 'stepper', engine: engine.name, liveOnly: true, title, q: plainText(q), value: '全部填对', ok: true, attempts, detail: '填表', el });
          finish('ok');
          return;
        }
        last = res.first;
        const name = cellName(t, at(res.first), res.first.c);
        const said = res.first.extra !== undefined ? values.extra[res.first.extra] : values[res.first.r][res.first.c];
        fb.className = 'sv-fill-fb is-bad';
        fb.textContent = res.first.empty ? `${name}还空着（前面 ${res.okCount} 格都对）。` : `${name}不对（前面 ${res.okCount} 格都对）。改好再检查。`;
        if (attempts >= 2) box.querySelector('.sv-fill-reveal').hidden = false;
        elOf(at(res.first), res.first.c)?.focus?.({ preventScroll: true });
        const misread = misreadFill(t, values, variants().map((v) => { try { const vt = engine.table(v.input, v.run, fields); return vt ? { label: v.label, table: fillSpec(vt, fields).table } : null; } catch { return null; } }).filter(Boolean));
        session.record({ type: 'stepper', engine: engine.name, liveOnly: true, title, q: plainText(q), value: res.first.empty ? `填到${name}还空着` : `${name}写的「${said}」`, ok: false, attempts, detail: `填表：前 ${res.okCount}/${res.total} 格对`, misread: misread || undefined, el });
      });
      box.querySelector('.sv-fill-reveal').addEventListener('click', () => {
        if (!last || done) return;
        const cell = last.extra !== undefined ? t.extra[last.extra] : t.rows[last.r].cells[last.c];
        const x = elOf(at(last), last.c);
        if (x?.matches('input')) x.value = cellAnswer(cell) === '（空）' ? '' : cellAnswer(cell);
        else if (x) { const on = cellAnswer(cell) === '√'; x.setAttribute('aria-pressed', on ? 'true' : 'false'); x.textContent = on ? '√' : ''; }
        cellBox(x)?.classList.remove('is-bad');
        cellBox(x)?.classList.add('is-revealed');
        revealed++;
        box.querySelector('.sv-fill-reveal').hidden = true;
        fb.textContent = `${cellName(t, at(last), last.c)}是「${cellAnswer(cell)}」。接着填，再检查。`;
      });
      box.querySelector('.sv-fill-giveup').addEventListener('click', () => {
        if (done) return;
        // 想不出来：把整张表的答案写上，再看过程
        order.forEach(({ r, c }) => {
          const x = elOf(r, c), cell = t.rows[r].cells[c];
          if (x?.matches('input')) { if (!cellOkFor(cell, x.value)) { x.value = cellAnswer(cell) === '（空）' ? '' : cellAnswer(cell); x.closest('td').classList.add('is-revealed'); } }
          else if (x) { const on = cellAnswer(cell) === '√'; x.setAttribute('aria-pressed', on ? 'true' : 'false'); x.textContent = on ? '√' : ''; }
        });
        (t.extra || []).forEach((cell, i) => { const x = elOf({ extra: i }); if (x && !cellOkFor(cell, x.value)) { x.value = cellAnswer(cell); cellBox(x).classList.add('is-revealed'); } });
        session.event('giveup', el, { step: 0, title: '填表' });
        fb.hidden = false;
        fb.className = 'sv-fill-fb';
        fb.textContent = '答案已经填上（改过的格子标成了紫色）。看一步步的过程，找找哪里想岔了。';
        finish('giveup');
        demo.hidden = false;
        go(0, { record: false });
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
        blanking = -1;
        if (quiz || fill) demo.hidden = false;
        return ctl.set('step', v, { ms: 0 });
      },
    };
    const id = session.registerScene(el, api, title);
    el.dataset.scene = id;
  }
}
