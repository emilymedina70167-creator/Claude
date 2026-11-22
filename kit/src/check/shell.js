// 检验的外壳（设计 5.2）：一个和黑板分开的控制器。外部的课（board check）、页面里的老师的课、复测的课（kind: check）三处共用。
// 怎么走由 flow.js 定（纯函数）；这里只画、收作答、计时、调判分、写回。合书（藏起板书）由调用方给 body 加 is-checking。
//
// mountCheck(host, { check, vars, saved, judge, fallback, save, record, onEnd, onPause })
//   judge(probe, answer) → Promise<{ items, lines, judgedBy, text }>：页面里的 Claude 判要点 / 步骤（调用方用 Opus 5.5 high）
//   fallback(probe, answer, items) → Promise<string>：外部没写到的错法，叫它写补讲
//   save(state)：存进度（sessions/{编号}/check/{检验 id}）；record(ids, state)：写这几道的证据；onEnd({ state, absorbs })：结束、回到黑板
import { createFlow, step, view, resumeJobs, needsFallback, absorbOf } from './flow.js';
import { materialize } from './template.js';
import { judgeMachine, JUDGE_WAIT, itemLabel, traceReview } from './judge.js';
import { fillTableView } from './filltable.js';
import { toRecord } from './record.js';
import { probeView } from './probes.js';
import { createTimer } from '../timing.js';
import { tickMs, screenKey, tooSoon, lockState } from './shellkit.js';
import { sweepInk } from './inkstore.js';
import { flushIds } from './record.js';
import { mdToHtml, escapeHtml } from '../blocks/common.js';

const FACET_TEXT = { ok: '✓', fixed: '补上', fail: '✗', pending: '待核' };
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function mountCheck(host, { check, vars = {}, saved = null, judge, fallback, save = () => {}, record = () => {}, onEnd = () => {}, onPause = () => {}, upload = async () => null, inkKey = () => '', onInk = () => {}, lockKey = '', now = () => Date.now() } = {}) {
  // 接着做：照存着的那一份（模板取好的数不变）；新开：模板先取好数（template.js，已经取过的原样）
  if (saved?.check?.id === check.id && saved.check.probes) check = saved.check;
  else check = materialize(check, { base: vars }).check;
  let state = saved?.check?.id === check.id ? saved : createFlow(check);
  const root = document.createElement('div');
  root.className = 'ck-shell';
  root.innerHTML = '<div class="ck-head"></div><div class="ck-main"></div>';
  host.appendChild(root);
  const head = root.querySelector('.ck-head');
  const main = root.querySelector('.ck-main');
  const timer = createTimer({ now });
  const inFlight = new Set();
  const writing = new Set();
  let shown = null; // 现在画着的是哪一屏（shellkit.js 的 screenKey）
  let shownAt = 0; // 这一屏什么时候画上的：太快的那一下点不算（tooSoon）
  let pv = null; // 当前这道题的画面
  let kept = null; // 「先停下」时留着的那一道（{ id, card, pv }）：接着做时放回去，打的字、填的格子不丢
  let sure = null;
  let dead = false;
  let lastSave = 0;
  let submitting = false;
  const images = new Map(); // 题 id → 交的时候手写的整页图（给页面里的 Claude 判；刷新以后没有了由调用方从资源里取）
  // 刷新、熄屏回来时正在做的那一道：照旧算第一次作答，证据记 resumed（设计 5.6″）
  const resumedId = saved?.phase === 'probe' ? saved.cur?.id : null;

  function dispatch(ev, { quiet = false } = {}) {
    if (dead) return;
    state = step(state, { at: now(), ...ev });
    const due = toRecord(state);
    if (due.length) {
      let docs = [];
      try { docs = record(due, state) || []; } catch { /* 写证据的地方自己重试、报错 */ }
      // 记下每道题的证据编号（刷新以后记错题、写吸收还要用）
      state = step(state, { type: 'recorded', ids: due, evs: Object.fromEntries((Array.isArray(docs) ? docs : []).filter((d) => d?.probe && d?.id).map((d) => [d.probe, d.id])) });
    }
    if (!quiet || now() - lastSave > 10000) { lastSave = now(); try { save(state); } catch { /* 存不上下次再存 */ } }
    paint();
    jobs();
  }

  // 后台的活：判分（每道一次，最多等 JUDGE_WAIT）、写补讲
  function jobs() {
    for (const id of resumeJobs(state)) {
      if (inFlight.has(id) || !judge) continue;
      inFlight.add(id);
      const probe = check.probes[id];
      const answer = state.results[id]?.answer || {};
      let done = false;
      const timeout = setTimeout(() => { if (!done) { done = true; inFlight.delete(id); dispatch({ type: 'timeout', id }); } }, JUDGE_WAIT);
      Promise.resolve().then(() => judge(probe, answer, images.get(id) || [])).then((r) => {
        if (done) return;
        done = true; clearTimeout(timeout); inFlight.delete(id);
        if (!r) { dispatch({ type: 'timeout', id }); return; }
        dispatch({ type: 'verdict', id, items: r.items || [], lines: r.lines, judgedBy: r.judgedBy || 'claude', text: r.text });
      }).catch(() => { if (done) return; done = true; clearTimeout(timeout); inFlight.delete(id); dispatch({ type: 'timeout', id }); });
    }
    for (const id of needsFallback(state)) {
      if (writing.has(id)) continue;
      writing.add(id);
      const r = state.results[id];
      Promise.resolve().then(() => (fallback ? fallback(check.probes[id], r.answer || {}, r.items || []) : '')).then((text) => dispatch({ type: 'teachText', id, text: String(text || '') }))
        .catch(() => dispatch({ type: 'teachText', id, text: '' }));
    }
  }

  // 页头：每秒的 tick 只改那一行字，按钮不重建（以前每秒整个重画，iPad 上「先停下」偶尔点不中）
  let headKey = null;
  function paintHead(v) {
    const total = check.blocks.reduce((n, b) => n + b.must.length, 0);
    const done = check.blocks.reduce((n, b) => n + b.must.filter((id) => state.results[id]?.submitted).length, 0);
    const meta = v.show === 'intro' || v.show === 'done' ? null : `必做 ${done}/${total}${v.left !== null ? ` · 剩 ${mmss(v.left)}` : ''}${state.late ? ' · 时间到了' : ''}${v.waiting ? ` · 在判 ${v.waiting} 道` : ''}`;
    const pause = ['probe', 'teach', 'wait'].includes(v.show);
    const key = `${meta !== null}:${pause}`;
    if (key !== headKey) {
      headKey = key;
      head.innerHTML = `<span class="ck-title">检验${check.title ? ` · ${escapeHtml(check.title)}` : ''}</span>`
        + (meta !== null ? '<span class="ck-meta"></span>' : '')
        + (pause ? '<button type="button" class="btn btn-sm ck-pause">先停下</button>' : '');
      head.querySelector('.ck-pause')?.addEventListener('click', () => { if (!['probe', 'teach', 'wait'].includes(state.phase)) return; dispatch({ type: 'pause' }); onPause(state); });
    }
    const m = head.querySelector('.ck-meta');
    if (m && m.textContent !== meta) m.textContent = meta;
  }

  function paint() {
    const v = view(state);
    paintHead(v);
    const key = screenKey(v);
    if (key === shown) { syncSubmit(); return; }
    shown = key;
    shownAt = now();
    if (pv && v.show !== 'probe') {
      timer.set(pv.el.dataset.probe, false);
      const card = main.querySelector('.ck-probe-card');
      if (v.show === 'paused' && card) kept = { id: pv.el.dataset.probe, card, pv, sure };
      else pv.destroy();
      pv = null;
    }
    if (kept && !(v.show === 'paused' || (v.show === 'probe' && v.id === kept.id))) { kept.pv.destroy(); kept = null; }
    main.innerHTML = '';
    sure = null;
    if (v.show === 'intro') return paintIntro();
    if (v.show === 'probe') return paintProbe(v);
    if (v.show === 'teach') return paintTeach(v);
    if (v.show === 'wait') { main.innerHTML = `<div class="ck-card ck-wait"><p>还在判 ${v.waiting} 道…（每道最多等 ${Math.round(JUDGE_WAIT / 1000)} 秒）</p></div>`; return; }
    if (v.show === 'paused') return paintPaused();
    if (v.show === 'done') return paintDone();
  }

  function paintIntro() {
    const must = check.blocks.reduce((n, b) => n + b.must.length, 0);
    main.innerHTML = `<div class="ck-card ck-intro">
      <h3>检验${check.title ? `：${escapeHtml(check.title)}` : ''}</h3>
      <p class="ck-sub">${check.blocks.length} 块 · ${must} 道必做${check.limit ? ` · 限时 ${Math.round(check.limit / 60000)} 分钟` : ''}</p>
      <ul class="ck-rules"><li>合书：开始以后板书收起来，做完放回来。</li><li>第一次作答算数；没有提示、没有「看答案」；想不出来可以点「想不出来」。</li><li>错了会指出错在哪、补一两句，再出一道同类的让你自己做。</li></ul>
      <button type="button" class="btn btn-primary ck-start">开始</button></div>`;
    main.querySelector('.ck-start').addEventListener('click', () => dispatch({ type: 'start' }));
  }

  function paintProbe(v) {
    // 停下以前就在这一道：把原来那张卡放回去（不重画、不丢字）
    if (kept && kept.id === v.id) {
      main.appendChild(kept.card);
      pv = kept.pv;
      sure = kept.sure;
      kept = null;
      timer.set(v.id, visible());
      syncSubmit();
      return;
    }
    const probe = check.probes[v.id];
    const card = document.createElement('div');
    card.className = `ck-card ck-probe-card${v.kind === 'retry' ? ' is-retry' : ''}`;
    card.innerHTML = `<div class="ck-tag">${v.kind === 'retry' ? '同类的一道' : v.kind === 'optional' ? '可选' : '必做'} · ${escapeHtml(v.block || '')}</div><div class="ck-body"></div>
      <div class="ck-actions"><button type="button" class="btn btn-primary ck-submit" disabled>交</button><button type="button" class="btn ck-giveup">想不出来</button><span class="ck-warn" aria-live="polite"></span></div>`;
    main.appendChild(card);
    pv = probeView(card.querySelector('.ck-body'), probe, { onChange: syncSubmit, inkKey: inkKey(v.id) || '', pause: check.pause, base: vars });
    timer.set(v.id, visible());
    card.querySelector('.ck-submit').addEventListener('click', () => { if (!tooSoon(shownAt, now())) submit(v.id); });
    card.querySelector('.ck-giveup').addEventListener('click', () => {
      if (tooSoon(shownAt, now()) || submitting || state.results[v.id]?.submitted) return;
      const t = timer.submit(v.id) || {};
      const view1 = pv;
      dispatch({ type: 'giveup', id: v.id, ms: t.ms ?? null });
      if (state.results[v.id]?.submitted) view1?.clearInk?.();
    });
    syncSubmit();
  }

  function syncSubmit() {
    const btn = main.querySelector('.ck-submit');
    if (!btn || !pv) return;
    const warn = main.querySelector('.ck-warn');
    const problem = pv.problem();
    const empty = pv.empty();
    // 2026-11-22 我说「有多大把握」是我自己说的、不是事实：不再问，写了就能交
    btn.disabled = empty || !!problem;
    warn.textContent = problem || '';
  }

  async function submit(id) {
    if (submitting || !pv || pv.problem() || pv.empty()) { syncSubmit(); return; }
    submitting = true;
    const probe = check.probes[id];
    const sureNow = sure;
    const t = timer.submit(id) || {};
    timer.set(id, false);
    const view0 = pv;
    view0.lock();
    const warn = main.querySelector('.ck-warn');
    // 手写的：整页图、快照传进资源（慢一点，先写一句）
    let c;
    try { if (warn) warn.textContent = '在交…'; c = await view0.collect(upload); } catch { c = { answer: view0.answer(), images: [] }; }
    submitting = false;
    if (dead) return;
    if (c.images?.length) images.set(id, c.images);
    if (c.strokes) { try { onInk(id, c.strokes, c.events); } catch { /* 回放存不上不影响作答 */ } }
    const machine = judgeMachine(probe, c.answer, vars);
    dispatch({ type: 'submit', id, answer: c.answer, sure: sureNow, ms: t.ms ?? null, msTotal: t.msTotal ?? t.ms ?? null, machine, ...(id === resumedId ? { resumed: true } : {}) });
    // 交上了才删本地的笔画（传图的那几秒里点了「先停下」，这一下交不进去，笔画得留着）
    if (state.results[id]?.submitted) view0.clearInk?.();
  }

  // 失败的一项写成学生看得懂的一句（不露编号）：构造的条件用外部写的话；要点写「没写到：要点」；错说法写「写了常见的错说法」；步骤写第几步。
  // 408、英语的项先问 judge.js 的 itemLabel（「第 2 趟（d = 2）」「缺页次数」「谓语」「测试 2」）；按学生自己的上一行推对了的（carried）不列
  function itemLine(probe, it) {
    if (it.carried && it.ok === true) return '';
    const lab = itemLabel(probe, it.id);
    if (lab) {
      const w = it.why ? mdToHtml(it.why, { inline: true }) : '';
      const html = it.ok === null ? `${escapeHtml(lab)}：页面拿不准，主讲会核${w ? `（${w}）` : ''}`
        : it.why && (it.why.includes(lab) || it.why.includes(lab.replace(/的$/, ''))) ? w // why 里已经说了是哪一项（「第 2 趟……」「多标了……」）
        : `${escapeHtml(lab)}${w ? `：${w}` : it.ok === 'missing' ? '没写' : '不对'}`;
      return `<li class="ck-item">${html}</li>`;
    }
    const pt = [...(probe.must || []), ...(probe.may || [])].find((x) => x.id === it.id);
    const wr = (probe.wrong || []).find((x) => x.id === it.id);
    const stepN = (probe.steps || []).findIndex((x) => x.id === it.id);
    const why = it.why ? mdToHtml(it.why, { inline: true }) : '';
    const html = it.ok === null ? `这一处页面拿不准，主讲会核${why ? `：${why}` : ''}`
      : pt ? `${it.ok === 'missing' ? '没写到' : '写错了'}：${mdToHtml(pt.text, { inline: true })}${it.ok !== 'missing' && why ? `（${why}）` : ''}`
      : wr ? `写了一个常见的错说法：${mdToHtml(wr.text, { inline: true })}`
      : stepN >= 0 ? `第 ${stepN + 1} 步${it.ok === 'missing' ? '没写' : it.tag ? ` ${escapeHtml(it.tag)}` : '不对'}${why ? `：${why}` : ''}`
      : why || '不对';
    return `<li class="ck-item">${html}</li>`;
  }

  // 构造题的 notes 判的时候也接在第一项的 why 后面（证据里留着）：画面上另起一行写，项里不重复
  const dropNotes = (why, notes) => notes.reduce((w, n) => String(w ?? '').split('；').filter((x) => x !== n).join('；'), why);

  function paintTeach(v) {
    const t = v.teach;
    const bad = (t.items || []).filter((x) => x.ok !== true && t.failed.includes(x.id));
    // 页面替学生做了的事（408 的构造题：「页面把第二个 49 记成 49′」）：机器判交出来的 notes，flow 存在这道题的结果上
    const notes = state.results[v.id]?.notes || [];
    const text = t.guessed ? '蒙对的不算吸收：再做一道同类的确认一下。' : t.text === null && t.key === 'claude' ? '页面在写补讲…' : t.text ? t.text : '';
    main.innerHTML = `<div class="ck-card ck-teach">
      <div class="ck-tag">${t.guessed ? '蒙对了' : '没过'} · ${escapeHtml(v.id)}</div>
      ${bad.length ? `<ul class="ck-items">${bad.map((it) => itemLine(check.probes[v.id], { ...it, why: dropNotes(it.why, notes) })).join('')}</ul>` : t.failed.includes('giveup') ? '<p>想不出来。</p>' : ''}
      ${notes.length ? `<p class="ck-note">${notes.map((x) => escapeHtml(x)).join('；')}</p>` : ''}
      <div class="ck-review-slot"></div>
      ${text ? `<div class="ck-teach-text">${mdToHtml(text)}</div>` : ''}
      <button type="button" class="btn btn-primary ck-next"${t.text === null && t.key === 'claude' ? ' disabled' : ''}>${t.last ? '接着做' : '做一道同类的'}</button></div>`;
    // 手推（trace）：把交的表只读地重画一遍，错的格标红、按自己的上一行推对了的行画淡（光看一句话找不到自己写错的那几格）
    const slot = main.querySelector('.ck-review-slot');
    const answer = state.results[v.id]?.answer;
    let rv = null;
    try { rv = answer && !t.guessed ? traceReview(check.probes[v.id], answer) : null; } catch { rv = null; }
    if (rv) {
      slot.innerHTML = '<div class="ck-label">你交的表</div>';
      fillTableView(slot, rv.table, rv.cells, rv);
    } else slot.remove();
    // 补讲还在写（页面里的 Claude）：按钮先灰着，字到了这一屏重画（screenKey 变了）
    main.querySelector('.ck-next').addEventListener('click', () => { if (!tooSoon(shownAt, now())) dispatch({ type: 'teachSeen', id: v.id }); });
  }

  function paintPaused() {
    const n = Object.values(state.results).filter((r) => r.submitted && !r.of).length;
    main.innerHTML = `<div class="ck-card ck-paused"><p>检验 ${escapeHtml(check.id)} 停下了 · 做了 ${n} 道</p><button type="button" class="btn btn-primary ck-resume">接着做</button></div>`;
    main.querySelector('.ck-resume').addEventListener('click', () => dispatch({ type: 'resume' }));
  }

  function absorbs() { return Object.fromEntries(check.blocks.map((b) => [b.block, absorbOf(state, b.block)])); }

  function paintDone() {
    const a = absorbs();
    main.innerHTML = `<div class="ck-card ck-done"><h3>检验做完了</h3>
      <ul class="ck-absorb">${check.blocks.map((b) => { const x = a[b.block]; return `<li><b>${escapeHtml(b.block)}</b> 吸收：${x?.state || '没做完'}<span class="ck-sub">（页面判，待主讲核）</span>${x?.facets ? ` · ${Object.entries(x.facets).map(([k, f]) => `${k} ${FACET_TEXT[f] || f}`).join(' ')}` : ''}</li>`; }).join('')}</ul>
      <button type="button" class="btn btn-primary ck-back">回到黑板</button></div>`;
    main.querySelector('.ck-back').addEventListener('click', () => onEnd({ state, absorbs: a }));
  }

  // 计时：题在屏幕上、页面在前台才走（timing.js）；第一次作答的总时间（limit）每秒交一次 tick
  const visible = () => document.visibilityState !== 'hidden' && root.isConnected && root.getClientRects().length > 0;
  const onVis = () => { last = now(); const id = view(state).id; if (id && state.phase === 'probe') timer.set(id, visible()); };
  document.addEventListener('visibilitychange', onVis);
  let last = now();
  const tickT = setInterval(() => {
    const t = now();
    const ms = tickMs(last, t); // 熄屏时定时器停住：亮屏后的第一下最多算 2 秒
    last = t;
    if (state.phase === 'probe' && visible()) dispatch({ type: 'tick', ms }, { quiet: true });
  }, 1000);

  // 两个标签页：别的页刚写过心跳（这次检验在那边开着）就不开，免得各写各的进度、各记一份证据
  // 这个标签页是谁：存在 sessionStorage（同一个标签页刷新以后还是它自己，不把自己当成别的页）
  let tab = '';
  try { tab = sessionStorage.getItem('la-ck-tab') || ''; if (!tab) { tab = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('la-ck-tab', tab); } } catch { tab = Math.random().toString(36).slice(2, 10); }
  const readLock = () => { try { return JSON.parse(localStorage.getItem(lockKey) || 'null'); } catch { return null; } };
  const writeLock = () => { try { localStorage.setItem(lockKey, JSON.stringify({ id: tab, at: now() })); } catch { /* 存不了就不锁 */ } };
  let beat = null;
  if (lockKey && lockState(readLock(), tab, now()) === 'other') {
    dead = true;
    clearInterval(tickT);
    main.innerHTML = '<div class="ck-card"><p>这次检验在另一个标签页里开着：在那边接着做（关掉那边，过几秒刷新这一页也行）。</p></div>';
    return { el: root, state: () => state, check: () => check, pause() {}, resume() {}, flush() {}, rejudge() {}, absorbs: () => ({}), destroy() { root.remove(); } };
  }
  const release = () => { if (lockKey && readLock()?.id === tab) { try { localStorage.removeItem(lockKey); } catch { /* 无 */ } } };
  if (lockKey) { writeLock(); beat = setInterval(writeLock, 2000); addEventListener('pagehide', release); }
  // 这台设备上存了 7 天以上、没交的手写（做到一半不做了的）清掉
  try { sweepInk(localStorage, now()); } catch { /* 无 */ }
  // 还没点开始也先存一份：开始卡停着时刷新，检验照样在
  if (!saved) { try { save(state); } catch { /* 下次再存 */ } }
  paint();
  jobs();
  return {
    el: root,
    state: () => state,
    /** 这一次检验（模板取好数的） */
    check: () => check,
    pause() { if (!['paused', 'done', 'intro'].includes(state.phase)) dispatch({ type: 'pause' }); },
    resume() { if (state.phase === 'paused') dispatch({ type: 'resume' }); },
    rejudge(id, items, result) { dispatch({ type: 'ext', id, items, result }); },
    absorbs,
    /** 停下、下课：交了还没写证据的题照现在的样子补写（final 还没定） */
    flush() {
      const ids = flushIds(state);
      if (!ids.length) return;
      let docs = [];
      try { docs = record(ids, state, { partial: true }) || []; } catch { /* 写证据的地方自己报 */ }
      dispatch({ type: 'recorded', ids, evs: Object.fromEntries((Array.isArray(docs) ? docs : []).filter((d) => d?.probe && d?.id).map((d) => [d.probe, d.id])) });
    },
    destroy() {
      dead = true; clearInterval(tickT); clearInterval(beat); document.removeEventListener('visibilitychange', onVis);
      pv?.destroy(); kept?.pv?.destroy();
      release();
      removeEventListener('pagehide', release);
      root.remove();
    },
  };
}
