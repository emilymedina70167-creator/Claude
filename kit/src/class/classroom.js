// 课堂模式（mode: class）：一屏就是一块黑板。课堂里的 Claude 每次回应要么擦掉重写一块新板（board new），
// 要么在当前这块板上改（add / replace / hide / figure）；旧板收进历史，翻页看。它说的话写在当前板的最上面，
// 学生说的话不上黑板。这节课一直要看的东西（记号、关键结论）放在常驻栏（board pin）。
// 学生在黑板上的作答会自动发给它，它接着往下教。只用 Opus 5.5（effort high）讲课：
// 返回的不是 Opus 5.5 时，这一轮整段作废（不显示、不执行黑板指令、不进对话历史，工具里记的观察也不留）。
// 数据都在这个 artifact 的数据库里：黑板段落 steps（带 page / place）、每块板 class_pages（标题、板顶的话）、
// 作答 answers / events、课堂记录 class_turns、课后小结 class_notes、资料包 pack。
import { renderLesson, mdToHtml, escapeHtml } from '../render.js';
import { session } from '../session.js';
import { compile } from '../expr.js';
import { link } from '../link.js';
import { getAI, errorText } from '../ai.js';
import { getStore, isDev, assetUrl } from '../live/store.js';
import { createSink } from '../live/sync.js';
import { copyRecord, toast } from '../record.js';
import { parseOutput } from './protocol.js';
import {
  buildSystem, actionText, actionsMessage, fitTurns, needsCompaction, compactionPrompt, summaryTurn, closingPrompt,
  reportable, actionTrigger, promptHistory, pendingTurn, nextSegmentId, nextPinId, bytes, PACK_BUDGET, compactionSlice, worthCompacting,
} from './prompt.js';
import { COMPONENT_DOCS } from './docs.js';
import { createDevTeacher } from './devteacher.js';
import { createClassBar, MODEL_TAG } from './bar.js';
import { initClassDevPanel } from './devpanel.js';

export const MODEL = 'claude-opus-5-5';
// 学生明确要求：讲课只能是 Opus 5.5、effort high；modelTier 只是平台要求的退路（退路的输出会被丢弃）
export const TEACH = { model: MODEL, effort: 'high', modelTier: 'complex' };
const DEBOUNCE = 1500;
const MAX_REWRITES = 2;
const MAX_ROUNDS = 6; // 一次学生发言最多连着几轮（重写、看手写原图）；防止意外的死循环
const TURN_TEXT_MAX = 200 * 1024; // 数据库一个文档最多 256 KiB
const pad6 = (n) => String(n).padStart(6, '0');
const pad3 = (n) => String(n).padStart(3, '0');
const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// 一块板超出一屏多少才算放不下（KaTeX、图的取整会差几个像素）
const FIT_SLACK = 12;
// 在这些东西上划动不算翻页：要拖的图、要选的字、要横着滚的公式
const NO_SWIPE = 'input, textarea, select, button, a, label, [contenteditable=""], [contenteditable="true"], svg, canvas, .keypad, .ink-bar, .class-pins';
const QUICK_SAY = { 没懂: '没懂。', 想不出来: '想不出来。', 换个说法: '换个说法讲讲？', 继续: '继续。' };

export async function renderClass(root, meta) {
  session.mode = 'class';
  session.live = true; // 共用 live 的行为：猜想默认不批改、作答逐次记录、组件要有 id
  session.stages = [];
  const unitName = meta.unit || session.title;
  root.classList.add('is-live', 'is-class');
  // 常驻栏（横屏在右边一栏，竖屏在顶上一条）+ 黑板。黑板里一块板一个 section，只显示正在看的那块
  root.innerHTML = `
    <div class="class-app">
      <aside class="class-pins" hidden aria-label="常驻栏"><div class="class-pins-head"><span class="class-unit">${mdToHtml(unitName, { inline: true })}</span></div><div class="class-pins-body"></div></aside>
      <main class="class-stage" aria-label="黑板">
        <div class="class-pages"></div>
        <div class="class-hero" hidden></div>
        <div class="class-welcome">
          <div class="live-empty-art" aria-hidden="true"><i></i><i></i><i></i></div>
          <p class="class-welcome-text">正在准备课堂…</p>
          <button type="button" class="btn btn-primary btn-lg class-start" hidden>开始上课</button>
        </div>
      </main>
    </div>`;
  const board = root.querySelector('.class-app');
  const stage = root.querySelector('.class-stage');
  const pagesBox = root.querySelector('.class-pages');
  const pinsBox = root.querySelector('.class-pins');
  const pinsBody = root.querySelector('.class-pins-body');
  const hero = root.querySelector('.class-hero');
  const welcome = root.querySelector('.class-welcome');
  const welcomeText = root.querySelector('.class-welcome-text');

  const store = await getStore({ title: session.title });
  if (!store) {
    welcomeText.innerHTML = '这个页面没有拿到课堂的数据库权限。<br>发布时要声明 <code>capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}</code>；本地试用请在地址后面加 <code>?dev</code>。';
    return;
  }
  const { db } = store;
  const sink = createSink(store);

  // —— 谁来讲课：claude.ai 里是真的 Claude；本地 ?dev 用模拟老师（剧本回放，不花额度）——
  const ai = await getAI();
  const dev = store.dev || isDev();
  const useMock = dev && !/[?&]teacher=real\b/.test(location.search);
  let mock = useMock ? createDevTeacher() : null;
  // 旧版接口（window.claude.complete）不能指定模型、也不说是谁答的：每一轮都只能作废，干脆不开课
  const legacy = !mock && !!ai?.legacy;
  const off = { tools: false, images: false }; // 这个查看方式明确说了不支持的（tools_unavailable / images_unavailable）
  const teacher = {
    get available() { return !!(mock || (ai?.call && !legacy)); },
    call: (input, opts) => (mock ? mock(input, opts) : ai.call(input, opts)),
    get tools() { return !mock && !!ai?.tools && !off.tools; },
    get images() { return !!(ai?.images || mock) && !off.images; },
  };
  const maxImages = ai?.images?.maxCount || 4;
  // 留一点余量给平台的包装（maxPromptBytes 按 UTF-8 字节算全部 content）
  const promptLimit = () => Math.max(64 * 1024, (Number(ai?.limits?.maxPromptBytes) || 262144) - 2048);

  // —— 状态 ——
  const segs = new Map(); // id → { id, seq, page, place: 'board' | 'pin', title, md, hidden, failed, pending, sec, softNotes }
  let segSeq = 0;
  const pages = new Map(); // 板号 → { n, title, talk, lead, kind, body, sec, head, talkEl, bodyEl }
  let pageSeq = 0; // 开过几块板（板号从 1 编）
  let curPage = 0; // 当前板：最新的那块，Claude 改的、说话写的都是它
  let viewPage = 0; // 学生正在看的板：翻回去看历史时和 curPage 不同
  let lastFit = null; // 当前板放不放得下一屏：{ fits, need, avail, w }
  const rewrites = new Map(); // 段 id（或 dup:id）→ 已经要求重写了几次；画好了就清零
  const history = []; // { seq, role, text, kind, discarded, ... } 和数据库 class_turns 一一对应
  let turnSeq = 0;
  const results = new Map(); // 组件 id → [{ line, key }]（给课堂 Claude 看的黑板现状）
  const pack = { main: null, problems: null };
  const localImages = new Map(); // asset id → Blob（这次打开页面时上传的原图，重试和 view_handwriting 用）
  // 等着发给课堂 Claude 的：学生的话、图、黑板动作。triggered：有要马上（或 1.5 秒后）发的；now：要马上发
  const queue = { texts: [], images: [], actions: [], triggered: false, now: false };
  let lastImages = { seq: 0, blobs: [] }; // 最近一条学生发言带的原图：重试时再发一次
  let busy = false;
  let ctl = null;
  let timer = null;
  let draft = null; // 正在写的这一轮：{ box, host, talk, ops }
  let started = false;
  let compactNext = false;
  let compactRetryAt = 0; // 摘要失败后，等对话再长几轮才再试（不要每一轮都卡在失败的摘要上）
  let budgetLevel = 0; // prompt_too_large 之后逐级缩小这一轮的内容；成功一轮就复原
  let lastPrompt = null; // 开发面板看：上一轮发了多少字节
  // 下面这些被函数声明用到、而 restore() 在函数定义之前就会调到那些函数：都要在这里先有值（let / const 有暂时性死区）
  let fitRaf = 0; // 量一屏放不放得下：一帧最多一次
  let raf = 0, pendingText = ''; // 草稿：一帧最多画一次
  // 当前板超出一屏、下面还有内容没露出来时，输入框上方给一个「下面还有」
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'class-more';
  more.hidden = true;
  more.textContent = '下面还有 ↓';
  more.addEventListener('click', () => window.scrollBy({ top: Math.round(window.innerHeight * 0.6), behavior: reduceMotion() ? 'auto' : 'smooth' }));
  document.body.appendChild(more);

  const bar = createClassBar({
    images: teacher.images,
    tag: mock ? `${MODEL_TAG} · 模拟老师` : MODEL_TAG,
    onSend: ({ text, images }) => { goPage(curPage); enqueueStudent(text, images, true); },
    onQuick: (label) => { if (busy) return; goPage(curPage); enqueueStudent(QUICK_SAY[label] || label, [], true); },
    onNav: (n) => goPage(n),
    onStop: () => ctl?.abort(),
    onRetry: () => retryRun(),
    onEnd: () => endClass(),
    onCopy: () => copyRecord(toast),
  });
  if (!teacher.available) {
    bar.setEnabled(false);
    bar.setStatus('error', legacy ? '这个查看方式不能指定 Opus 5.5，课堂开不了。请在新版 claude.ai 里打开这个页面。'
      : ai === null ? '需要允许这个页面使用 Claude，课堂才能开始。' : '这个页面现在用不了 Claude。');
  }

  // 草稿区「拿给 Claude 看」、手写附件：都进底部输入框
  session.openTutor = (i, prefill, image) => {
    if (image && bar.attach(image) === false) toast(teacher.images ? '图已经附满了，先发出去再附' : '这个查看方式发不了图片，请用文字说');
    if (prefill) bar.prefill(prefill);
    bar.focus();
  };

  // —— 作答和动作：写进数据库（同 live），同时攒起来自动发给课堂 Claude ——
  session.sink = {
    record(e) { sink.record(e); onAction({ source: 'record', ...e }); },
    // detail 摊开放在前面：detail.step 是 steps 里的第几步（数），不能盖掉 e.step（段 id）
    event(e) { sink.event(e); onAction({ source: 'event', ...(e.detail && typeof e.detail === 'object' ? e.detail : {}), ...e }); },
    images(key, blobs) {
      const ups = sink.images(key, blobs);
      ups.forEach((p, i) => p.then((id) => id && localImages.set(id, blobs[i])));
      queue.images.push(...blobs.map((blob, i) => ({ blob, id: ups[i] || Promise.resolve(null) })));
      return ups;
    },
  };

  if (dev) initClassDevPanel({ db, root, setFallback: (on) => { if (mock) mock = createDevTeacher({ fallback: on }); }, history: () => history, stats: () => lastPrompt });

  // —— 资料包（课前由项目对话写入；课中改了，下一轮自动用新版）——
  const applyMain = (data) => {
    pack.main = data || null;
    if (pack.main?.unit) root.querySelector('.class-unit').innerHTML = mdToHtml(String(pack.main.unit), { inline: true });
    session.context = pack.main ? [pack.main.goal, pack.main.scope].filter(Boolean).join('\n') : '';
    syncNav();
  };
  db.doc('pack/main').onSnapshot((s) => applyMain(s.exists ? s.data() : null), () => {});
  db.doc('pack/problems').onSnapshot((s) => { pack.problems = s.exists ? s.data() : null; }, () => {});

  initSwipe();
  initFit();
  // 竖屏时常驻栏是横着的一条，长的卡片先收着：点一下展开 / 收起
  pinsBody.addEventListener('click', (e) => {
    const card = e.target.closest('.class-pin');
    if (!card || e.target.closest('button, a, input, textarea, svg, .keypad')) return;
    if (!card.classList.contains('is-clipped') && !card.classList.contains('is-open')) return;
    card.classList.toggle('is-open');
    scheduleFit();
  });

  // —— 恢复：资料包、黑板（板和段）、课堂记录、作答 ——
  await restore();
  session.event('open', null, { title: session.title, unit: unitName, mode: 'class' });

  async function restore() {
    try {
      // 资料包也在这里读一次：第一轮不能赶在资料包到之前发出去（那样课堂 Claude 会以为没有资料包）
      const [st, pg, tu, an, ev, pm, pp] = await Promise.all([
        db.collection('steps').get(), db.collection('class_pages').get().catch(() => ({ docs: [] })),
        db.collection('class_turns').get(), db.collection('answers').get(), db.collection('events').get(),
        db.doc('pack/main').get().catch(() => null), db.doc('pack/problems').get().catch(() => null),
      ]);
      if (pm?.exists && !pack.main) applyMain(pm.data());
      if (pp?.exists && !pack.problems) pack.problems = pp.data();
      for (const d of pg.docs.map((x) => x.data()).filter((p) => Number.isFinite(p?.n) && p.n > 0).sort((a, b) => a.n - b.n)) {
        const p = ensurePage(d.n);
        Object.assign(p, { title: String(d.title || ''), talk: String(d.talk || ''), lead: d.lead || '', kind: d.kind || '', body: String(d.body || '') });
        paintPage(p);
      }
      const docs = st.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.seq || 0) - (b.seq || 0));
      const legacy = [];
      for (const d of docs) {
        segSeq = Math.max(segSeq, d.seq || 0);
        const place = d.place === 'pin' ? 'pin' : 'board';
        // 旧版课堂（还没有分板）的段没有 page：一段算一块板，接在已有的板后面
        let page = place === 'pin' ? 0 : Number(d.page) || 0;
        const old = place === 'board' && !page;
        if (old) {
          page = pageSeq + 1;
          Object.assign(ensurePage(page), { lead: d.id, title: d.title || '' });
        }
        if (page) ensurePage(page);
        const seg = { id: d.id, seq: d.seq || 0, page, place, title: d.title || '', md: String(d.md || ''), hidden: !!d.hidden, failed: !!d.failed, pending: false, sec: null };
        segs.set(seg.id, seg);
        if (old) legacy.push(seg);
        if (!seg.hidden) mountRestored(seg);
      }
      for (const p of pages.values()) paintPage(p);
      // 旧版的段分好板就存回去：以后新开的板接在它们后面，下次打开顺序也不变
      for (const seg of legacy) { saveSeg(seg); savePage(pages.get(seg.page)); }
      tu.docs.map((d) => d.data()).filter((t) => Number.isFinite(t?.seq)).sort((a, b) => a.seq - b.seq).forEach((t) => { history.push(t); turnSeq = Math.max(turnSeq, t.seq); });
      // 黑板现状里的作答结果：作答记录 + 揭开 / 拖动（按时间重放，规则和上课时一样）
      const recs = [
        ...an.docs.map((d) => d.data()).map((r) => ({ source: 'record', ...r, type: r.kind, answer: r.kind === 'conjecture' ? r.text : undefined })),
        ...ev.docs.map((d) => d.data()).map((e) => ({ source: 'event', ...(e.detail && typeof e.detail === 'object' ? e.detail : {}), ...e })),
      ].sort((a, b) => (a.at || 0) - (b.at || 0));
      recs.forEach((a) => { if (reportable(a)) addResult(a); });
      replayStudentWork(recs);
    } catch (e) {
      console.error(e);
      toast('课堂记录没读出来，先从头开始');
    }
    curPage = pageSeq;
    started = history.length > 0;
    showPage(curPage, { scroll: false });
    refresh();
    if (pendingTurn(history) && teacher.available) bar.setStatus('error', '上一轮 Claude 还没回完，点重试接着上。');
  }

  // —— 刷新后把学生的作答放回黑板 ——
  // steps 照记录重放（对照、联动的图都回到原样）；图恢复到刷新前的样子（老师的 figure set / play、学生的拖动）；
  // 别的组件在下面注明「刷新前的作答」。重放期间 session.replaying：不记录、不发给 Claude
  function replayStudentWork(recs) {
    const byBlock = new Map();
    for (const r of recs) if (r.block) { if (!byBlock.has(r.block)) byBlock.set(r.block, []); byBlock.get(r.block).push(r); }
    const on = (bid, sel = '') => board.querySelector(`.class-seg:not([hidden]) .block${sel}[data-bid="${CSS.escape(bid)}"]`);
    session.replaying = true;
    try {
      for (const [bid, list] of byBlock) {
        const el = on(bid, '.block-steps');
        if (!el?._replay) continue;
        try { el._replay(list.filter((r) => r.type === 'steps' || (r.source === 'event' && r.type === 'reveal'))); } catch (e) { console.warn('steps 没能重放', e); }
      }
      restoreFigures(recs);
    } finally {
      session.replaying = false;
    }
    for (const [bid] of byBlock) {
      const el = on(bid);
      if (!el || ['block-steps', 'block-scene', 'block-graph', 'block-space'].some((c) => el.classList.contains(c))) continue;
      const lines = (results.get(bid) || []).map((r) => r.line.replace(/^[^：]*：/, '')).filter(Boolean);
      if (!lines.length) continue;
      el.insertAdjacentHTML('beforeend', `<div class="class-prev"><div class="class-prev-tag">刷新前的作答</div><ul>${lines.slice(-4).map((l) => `<li>${mdToHtml(l, { inline: true })}</li>`).join('')}</ul></div>`);
    }
  }

  function restoreFigures(recs) {
    const tl = [];
    for (const t of history) {
      if (t.role !== 'claude' || t.discarded || !Array.isArray(t.boardOps)) continue;
      t.boardOps.forEach((o, i) => {
        if (!o?.ok) return;
        const at = (t.at || 0) + i / 1000; // 同一轮里的先后
        if (['add', 'new', 'replace', 'pin'].includes(o.op)) tl.push({ at, kind: 'render', seg: o.id });
        else if (o.op === 'figure' && (o.action === 'set' || o.action === 'play')) tl.push({ at, kind: o.action, target: o.id, args: o.args });
      });
    }
    for (const r of recs) if (r.source === 'event' && r.type === 'drag' && r.block) tl.push({ at: r.at || 0, kind: 'drag', target: r.block, name: r.name, value: r.value });
    tl.sort((a, b) => a.at - b.at);
    const rendered = new Map();
    for (const e of tl) if (e.kind === 'render') rendered.set(e.seg, e.at);
    for (const e of tl) {
      if (e.kind === 'render') continue;
      const el = board.querySelector(`.class-seg:not([hidden]) [data-bid="${CSS.escape(e.target)}"][data-scene]`);
      const api = el && session.scenes.get(el.dataset.scene)?.api;
      if (!api) continue;
      // 这张图所在的段后来整段重画过：重画之前的改动不算
      if (e.at <= (rendered.get(el.closest('[data-step]')?.dataset.step) ?? -Infinity)) continue;
      try {
        if (e.kind === 'drag') api.set(e.name, e.value);
        else if (e.kind === 'play') api.set(e.args?.name, e.args?.to ?? 1);
        else for (const [name, src] of Object.entries(e.args?.assigns || {})) api.set(name, compile(src)((api.vars || api.snapshot)?.call(api) || {}));
      } catch { /* 恢复不了就保持初始的样子 */ }
    }
  }

  // —— 板：一屏一块。都写成函数声明：刷新后恢复（restore）在这些定义之前就会用到 ——

  function ensurePage(n) {
    let p = pages.get(n);
    if (p) return p;
    const sec = document.createElement('section');
    sec.className = 'class-page';
    sec.dataset.page = String(n);
    sec.hidden = true;
    sec.setAttribute('aria-label', `第 ${n} 块板`);
    sec.innerHTML = '<header class="class-page-head" hidden><h2 class="class-page-title"></h2></header><div class="class-talk" hidden></div><div class="class-page-body"></div>';
    p = { n, title: '', talk: '', lead: '', kind: '', body: '', sec, head: sec.querySelector('.class-page-head'), titleEl: sec.querySelector('.class-page-title'), talkEl: sec.querySelector('.class-talk'), bodyEl: sec.querySelector('.class-page-body') };
    pages.set(n, p);
    // 按板号插：恢复时板号可能不是按顺序来的
    const after = [...pagesBox.children].find((c) => Number(c.dataset.page) > n);
    pagesBox.insertBefore(sec, after || null);
    pageSeq = Math.max(pageSeq, n);
    return p;
  }

  // 擦掉黑板，开一块新板（成为当前板）
  function newPage(fields = {}) {
    const p = ensurePage(pageSeq + 1);
    Object.assign(p, fields);
    curPage = p.n;
    paintPage(p);
    savePage(p);
    return p;
  }

  // 板的标题、板顶的话、小结正文画出来
  function paintPage(p) {
    p.titleEl.innerHTML = p.title ? mdToHtml(p.title, { inline: true }) : '';
    p.head.hidden = !p.title;
    p.talkEl.innerHTML = p.talk ? mdToHtml(p.talk) : '';
    p.talkEl.hidden = !p.talk;
    p.sec.classList.toggle('is-closing', p.kind === 'closing');
    let closing = p.bodyEl.querySelector(':scope > .class-closing');
    if (p.kind === 'closing') {
      if (!closing) { closing = document.createElement('div'); closing.className = 'class-closing'; p.bodyEl.prepend(closing); }
      closing.innerHTML = mdToHtml(p.body || '');
    } else closing?.remove();
  }

  function savePage(p) {
    sink.put('class_pages', { id: pad3(p.n), n: p.n, title: p.title || '', talk: p.talk || '', lead: p.lead || '', kind: p.kind || '', body: p.body || '', at: Date.now() });
  }

  function setTalk(p, md) {
    const talk = String(md || '').trim();
    if (p.talk === talk) return false;
    p.talk = talk;
    paintPage(p);
    savePage(p);
    return true;
  }

  // 只显示一块板。scroll：回到页面顶上（换了板，从板的开头看）
  function showPage(n, { scroll = true, animate = false } = {}) {
    const target = pages.has(n) ? n : curPage;
    const changed = target !== viewPage;
    viewPage = target;
    for (const p of pages.values()) p.sec.hidden = p.n !== viewPage;
    const shown = pages.get(viewPage);
    if (changed && animate && shown && !reduceMotion()) {
      shown.sec.classList.remove('is-enter');
      void shown.sec.offsetWidth; // 重新播一次进场
      shown.sec.classList.add('is-enter');
    }
    if (changed && scroll) window.scrollTo({ top: 0, behavior: 'auto' });
    // 板书挂在段上：翻走的板上的笔迹不画，翻出来的板上的笔迹画回来
    if (changed) window.LAKit?.ink?.redraw?.();
    syncNav();
    scheduleFit();
  }

  function goPage(n) {
    if (!pages.size) return;
    const target = Math.max(1, Math.min(pageSeq, Number(n) || curPage));
    if (target === viewPage) return;
    showPage(target, { animate: true });
  }

  function syncNav() {
    bar.setNav({
      view: viewPage, cur: curPage,
      items: [...pages.values()].sort((a, b) => a.n - b.n).map((p) => ({ n: p.n, title: p.title || (p.kind === 'closing' ? '这节课的小结' : '') })),
      busy,
    });
  }

  // —— 一屏放不放得下：黑板可用的高度给 CSS（--board-h），当前板的内容高度报给课堂 Claude ——
  function scheduleFit() {
    if (fitRaf) return;
    fitRaf = requestAnimationFrame(() => { fitRaf = 0; measureFit(); });
  }
  function initFit() {
    window.addEventListener('resize', scheduleFit, { passive: true });
    window.addEventListener('orientationchange', scheduleFit, { passive: true });
    window.addEventListener('scroll', syncMoreHint, { passive: true });
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(scheduleFit);
      ro.observe(pagesBox);
      ro.observe(pinsBox);
      ro.observe(bar.el);
    }
  }
  function measureFit() {
    const sr = stage.getBoundingClientRect();
    // 横屏时常驻栏在右边一栏：输入框只放在黑板那一栏下面（CSS 用 --cb-l / --cb-r 当左右边距）
    const docked = !pinsBox.hidden && pinsBox.getBoundingClientRect().left >= sr.right - 1;
    document.body.classList.toggle('class-docked', docked);
    if (docked) {
      document.body.style.setProperty('--cb-l', `${Math.round(sr.left)}px`);
      document.body.style.setProperty('--cb-r', `${Math.max(0, Math.round(document.documentElement.clientWidth - sr.right))}px`);
    }
    // 竖屏常驻栏是一条：放不下的卡底下渐隐，点开看全部
    for (const card of pinsBody.children) card.classList.toggle('is-clipped', !card.classList.contains('is-open') && card.scrollHeight > card.clientHeight + 2);
    const top = sr.top + window.scrollY;
    const avail = Math.max(240, Math.round(window.innerHeight - bar.height - top - 10));
    board.style.setProperty('--board-h', `${avail}px`);
    const p = pages.get(curPage);
    if (p && !p.sec.hidden) {
      const r = p.sec.getBoundingClientRect();
      const last = [...p.sec.querySelectorAll(':scope > *, :scope > .class-page-body > *')].filter((el) => !el.hidden && el.offsetParent !== null).at(-1);
      const need = Math.round(last ? last.getBoundingClientRect().bottom - r.top : 0);
      lastFit = { fits: need <= avail + FIT_SLACK, need, avail, w: Math.round(r.width) };
      p.sec.classList.toggle('is-overflow', !lastFit.fits);
    }
    syncMoreHint();
  }
  function syncMoreHint() {
    const p = pages.get(viewPage);
    if (!p || p.sec.hidden) { more.hidden = true; return; }
    const bottom = p.sec.getBoundingClientRect().bottom;
    more.hidden = !(bottom > window.innerHeight - bar.height + 24);
  }

  // —— 左右划动翻板（只认手指；在图、输入框、按钮上划不算；屏幕边缘留给系统的返回手势）——
  function initSwipe() {
    let s = null;
    const scrollsSideways = (el) => {
      for (let n = el; n && n !== stage; n = n.parentElement) if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
      return false;
    };
    stage.addEventListener('touchstart', (e) => {
      s = null;
      if (e.touches.length !== 1 || pages.size < 2) return;
      if (document.body.classList.contains('ink-on') || document.body.classList.contains('has-keypad')) return;
      const t = e.touches[0];
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest(NO_SWIPE) || scrollsSideways(target)) return;
      if (t.clientX < 28 || t.clientX > window.innerWidth - 28) return;
      s = { x: t.clientX, y: t.clientY, t: performance.now(), sy: window.scrollY };
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x, dy = t.clientY - s.y, dt = performance.now() - s.t;
      const scrolled = Math.abs(window.scrollY - s.sy) > 12;
      s = null;
      if (scrolled || dt > 700 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.5) return;
      goPage(viewPage + (dx < 0 ? 1 : -1));
    }, { passive: true });
    stage.addEventListener('touchcancel', () => { s = null; }, { passive: true });
    // 外接键盘：← → 翻板（在输入框里打字时不算）
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .keypad, .cb-menu, .cb-pages')) return;
      goPage(viewPage + (e.key === 'ArrowRight' ? 1 : -1));
    });
  }

  // —— 黑板段落 ——
  // 一块板的第一段（board new 写的那段）的标题就是板的标题，写在板头上；同一块板上后加的段照常有自己的小标题
  function segSource(seg) {
    const lead = seg.place !== 'pin' && pages.get(seg.page)?.lead === seg.id;
    if (lead || /^##\s+/m.test(seg.md) || !seg.title) return seg.md;
    return `## ${seg.title}\n\n${seg.md}`;
  }

  // 渲染一段：先隐藏着画，自检通过才显示。返回 { sec, errors, soft }
  function renderSeg(seg) {
    const idx = session.stages.length;
    const sec = document.createElement('section');
    sec.className = `stage live-step class-seg class-pending${seg.place === 'pin' ? ' class-pin' : ''}`;
    sec.dataset.step = seg.id;
    sec.dataset.stage = idx;
    sec.innerHTML = '<div class="stage-body"></div>';
    const src = segSource(seg);
    session.stages.push({ id: seg.id, title: seg.title || (seg.md.match(/^##\s+(.+)$/m)?.[1] || '').trim(), src, el: sec });
    place(seg, sec);
    const before = session.problems.length;
    const errors = [];
    try {
      renderLesson(src, sec.querySelector('.stage-body'));
    } catch (e) {
      console.error(e);
      errors.push({ kind: '渲染', msg: `这段画不出来：${e?.message || e}` });
    }
    const probs = session.problems.slice(before).filter((p) => p.stage === idx);
    errors.push(...probs.filter((p) => !p.soft));
    // 图的 id: / title: / link: 只有一行。多出来的行是写错的命令被当成了续行（比如 title 下面一行写成 vectr …），
    // 组件自检不报，但那条命令就这样悄悄没了：当写法错误处理
    for (const el of sec.querySelectorAll('[data-scene]')) {
      const fields = session.scenes.get(el.dataset.scene)?.api?.fields || {};
      for (const k of ['id', 'title', 'link']) {
        const extra = String(fields[k] ?? '').split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
        if (extra.length) errors.push({ kind: [...el.classList].find((c) => c.startsWith('block-'))?.slice(6) || '图', msg: `看不懂这一行：${extra[0].slice(0, 80)}（不是认得的命令，被当成了 ${k}: 的续行）` });
      }
    }
    // 公式写错了（KaTeX 画成红字）：组件自检不管这个，但学生会看到一串红色的源码，也要重写
    const bad = [...sec.querySelectorAll('.katex-error, .tex-error')].slice(0, 3);
    for (const el of bad) {
      const why = String(el.getAttribute('title') || '').replace(/^ParseError:\s*/, '').slice(0, 160);
      errors.push({ kind: '公式', msg: `$${el.textContent.trim().slice(0, 80)}$ 写不出来${why ? `（${why}）` : ''}` });
    }
    if (seg.place !== 'pin') splitFigure(sec.querySelector('.stage-body'));
    return { sec, errors, soft: probs.filter((p) => p.soft) };
  }

  // 一段里正好有一张图（scene / graph / space，不是绑定了 steps 的那种）和别的内容：宽屏时排成左图右文。
  // 只记下图要占几行，排版交给 CSS 的容器查询（窄屏照原来的顺序上下排）
  // 图占左栏、跨过右栏所有的行，最后一行是 1fr：图比右栏高时多出来的高度都给最后一行，右栏的内容之间不被拉开
  function splitFigure(body) {
    const kids = [...body.children];
    const figs = kids.filter((el) => el.matches('.block-scene, .block-graph, .block-space') && !el.dataset.link);
    if (figs.length !== 1 || body.querySelector(':scope > .steps-pair')) return;
    const heads = kids.filter((el) => el.tagName === 'H2');
    if (heads.length > 1 || (heads.length && kids[0] !== heads[0])) return; // 小标题不在开头：照原样排
    const text = kids.filter((el) => el !== figs[0] && el.tagName !== 'H2');
    if (!text.length) return;
    const head = heads.length ? 1 : 0;
    body.classList.add('seg-split');
    figs[0].classList.add('split-fig');
    body.style.setProperty('--split-rows', `${head ? 'auto ' : ''}repeat(${text.length}, auto) 1fr`);
    figs[0].style.setProperty('--fig-row', `${1 + head} / span ${text.length + 1}`);
  }

  // 放进它那块板（按 seq 排）或常驻栏；替换时放在原位置
  function place(seg, sec) {
    if (seg.sec?.isConnected) { seg.sec.after(sec); return; }
    const host = seg.place === 'pin' ? pinsBody : ensurePage(seg.page || curPage || newPage().n).bodyEl;
    const after = [...host.children].find((c) => (segs.get(c.dataset.step)?.seq ?? Infinity) > seg.seq);
    host.insertBefore(sec, after || null);
  }

  function dropScenesOf(sec) {
    for (const [k, sc] of session.scenes) if (sec.contains(sc.el)) session.scenes.delete(k);
  }

  function mountRestored(seg) {
    if (seg.failed) { seg.sec = failedSec(seg); return; }
    const { sec } = renderSeg(seg);
    sec.classList.remove('class-pending');
    seg.sec = sec;
  }

  function failedSec(seg) {
    const sec = document.createElement('section');
    sec.className = `stage live-step class-seg class-failed${seg.place === 'pin' ? ' class-pin' : ''}`;
    sec.dataset.step = seg.id;
    sec.innerHTML = `<div class="class-failed-box">这段没画出来${seg.title ? `（${escapeHtml(seg.title)}）` : ''}。课堂接着往下。</div>`;
    place(seg, sec);
    return sec;
  }

  // 一段课件里各组件写的 id（不渲染也能看出来：撞号要在渲染之前拦下，免得新组件动了旧组件的联动）
  function componentIds(md) {
    const ids = [];
    let fence = null;
    for (const line of String(md).split('\n')) {
      const f = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
        else { const m = line.match(/^\s*id\s*[:：]\s*([\w\-.~:@+]+)\s*$/); if (m) ids.push(m[1]); }
      } else if (f && f[2].trim()) fence = f[1];
    }
    return ids;
  }

  // 黑板上（看得到的段里，所有板和常驻栏）已经有的组件 id → 所在段
  function liveBlockIds(exceptSeg) {
    const out = new Map();
    for (const s of segs.values()) {
      if (s === exceptSeg || !s.sec?.isConnected || s.hidden) continue;
      s.sec.querySelectorAll('[data-bid]').forEach((b) => out.set(b.dataset.bid, s.id));
    }
    return out;
  }

  // 执行一条黑板指令。返回 { op, id, ok, error?, ... }；画不出来的 new/add/replace/pin 记进 failures 等着重写
  function execOp(op, failures, notes) {
    if (op.op === 'unpin') {
      const seg = segs.get(op.id);
      if (!seg || seg.place !== 'pin') return { op: 'unpin', id: op.id, ok: false, error: seg ? `${op.id} 不在常驻栏里，是黑板上的段：要撤回用 board hide id=${op.id}` : `常驻栏里没有 ${op.id}` };
      const r = execOp({ op: 'hide', id: op.id }, failures, notes);
      return { ...r, op: 'unpin' };
    }
    if (['add', 'new', 'replace', 'pin'].includes(op.op)) {
      let seg = segs.get(op.id);
      const toPin = op.op === 'pin';
      const nextId = toPin ? nextPinId([...segs.values()]) : nextSegmentId([...segs.values()]);
      // 用了已经有的 id：多半是忘了用过。不覆盖学生正在做的那段，请它换个新 id
      if ((op.op === 'add' || op.op === 'new') && seg && !seg.pending && !seg.failed) {
        const where = seg.hidden ? '（已撤回）' : seg.place === 'pin' ? '（在常驻栏）' : '';
        const msg = `${op.id} 已经用过了${seg.title ? `（「${seg.title}」${where}）` : where}，这次的 ${op.op} 没有执行。新的一段换一个没用过的 id（下一个可用的是 ${nextId}）重新 ${op.op}；要改 ${op.id} 就用 board replace id=${op.id}。`;
        failures.push({ key: `dup:${op.id}`, id: op.id, title: op.title || '', errors: [{ kind: 'id', msg }], dup: true });
        return { op: op.op, id: op.id, ok: false, error: msg };
      }
      // pin 用了黑板上的段 id、或者 new / add 撞上常驻栏的 id：两边的 id 分开用
      if (toPin && seg && seg.place !== 'pin') {
        const msg = `${op.id} 是黑板上的段，不能放进常驻栏。常驻栏用另一个 id（下一个可用的是 ${nextId}）。`;
        failures.push({ key: `dup:${op.id}`, id: op.id, title: op.title || '', errors: [{ kind: 'id', msg }], dup: true });
        return { op: 'pin', id: op.id, ok: false, error: msg };
      }
      const isNew = !seg;
      if (!seg) {
        let page = 0;
        if (!toPin) {
          // new：擦掉黑板换一块新板，这一段是新板的第一段（标题就是板的标题）。
          // add / replace 一个没见过的 id：加在当前板上；还没有板、或者当前板是下课小结，就开一块新的
          const cur = pages.get(curPage);
          page = op.op === 'new' || !cur || cur.kind === 'closing' ? newPage({ lead: op.id, title: op.title || '' }).n : curPage;
        }
        seg = { id: op.id, seq: ++segSeq, page, place: toPin ? 'pin' : 'board', title: '', md: '', hidden: false, failed: false, pending: false, sec: null };
      }
      const next = { ...seg, title: op.title ?? seg.title, md: op.body || '' };
      const errors = [];
      // 组件 id 撞号：同一段里重复，或者和黑板上别的段重复（figure、作答记录、link: 都靠 id 找组件）
      const taken = liveBlockIds(seg);
      const ids = componentIds(next.md);
      for (const [i, id] of ids.entries()) {
        if (ids.indexOf(id) !== i) errors.push({ kind: 'id', msg: `组件 id「${id}」在这一段里写了两次` });
        else if (taken.has(id)) errors.push({ kind: 'id', msg: `组件 id「${id}」已经在 ${taken.get(id)} 里用过了，换一个整节课没用过的` });
      }
      let sec = null, soft = [];
      // 渲染时 steps 会把联动（link:）重置到第 0 步：替换失败要把旧段的联动还原
      const links = new Map();
      if (seg.sec) seg.sec.querySelectorAll('.block-steps[data-bid]').forEach((b) => links.set(b.dataset.bid, link(b.dataset.bid).step));
      if (!errors.length) {
        const r = renderSeg(next);
        sec = r.sec;
        soft = r.soft;
        errors.push(...r.errors);
      }
      if (errors.length) {
        if (sec) { dropScenesOf(sec); sec.remove(); }
        for (const [id, step] of links) if (link(id).step !== step) link(id).set(step);
        // 记住 id、板、顺序和标题，重写时放回原位（重写多半不再写 title=）
        if (isNew || seg.pending) { seg.pending = true; seg.title = next.title; segs.set(seg.id, seg); }
        failures.push({ key: op.id, id: op.id, title: next.title, errors, isNew: !seg.sec });
        return { op: op.op, id: op.id, ok: false, page: seg.page || undefined, error: errors.map((p) => `${p.kind}：${p.msg}`).join('；') };
      }
      if (seg.sec) { dropScenesOf(seg.sec); seg.sec.remove(); }
      sec.classList.remove('class-pending');
      Object.assign(seg, next, { sec, hidden: false, failed: false, pending: false, softNotes: soft.length ? soft.map((p) => p.msg) : undefined });
      segs.set(seg.id, seg);
      rewrites.delete(seg.id);
      saveSeg(seg);
      // 板的第一段改了标题：板头跟着改
      const pg = pages.get(seg.page);
      if (pg && pg.lead === seg.id && op.title !== undefined && pg.title !== seg.title) { pg.title = seg.title; paintPage(pg); savePage(pg); }
      return { op: op.op, id: op.id, ok: true, title: seg.title, isNew, page: seg.page || undefined };
    }
    if (op.op === 'hide') {
      const seg = segs.get(op.id);
      if (!seg) return { op: 'hide', id: op.id, ok: false, error: `黑板上没有 ${op.id}` };
      seg.hidden = true;
      seg.pending = false;
      if (seg.sec) seg.sec.hidden = true;
      saveSeg(seg);
      return { op: 'hide', id: op.id, ok: true };
    }
    if (op.op === 'figure') return figureOp(op, notes);
    return { op: op.op, ok: false, error: '看不懂的指令' };
  }

  function figureOp(op, notes) {
    const args = op.action === 'set' ? { assigns: op.assigns } : op.action === 'play' ? { name: op.name, from: op.from, to: op.to, ms: op.ms } : { index: op.index };
    const base = { op: 'figure', id: op.target, action: op.action, args };
    const all = [...board.querySelectorAll(`.class-seg [data-bid="${CSS.escape(op.target)}"]`)];
    // 撤回的段不算；翻板只是藏起来，不算撤回（下面再看在不在当前板上）
    const el = all.find((e) => e.dataset.scene && !e.closest('.class-seg[hidden]'));
    const sc = el && session.scenes.get(el.dataset.scene);
    if (!sc) {
      const figs = [...board.querySelectorAll('.class-seg:not([hidden]) [data-scene][data-bid]')].filter((e) => onCurrent(e)).map((e) => e.dataset.bid);
      const other = all.find((e) => !e.closest('.class-seg[hidden]'));
      const kind = other && [...other.classList].find((c) => c.startsWith('block-'))?.slice(6);
      const error = other ? `${op.target} 是 ${kind || '组件'}，不是图`
        : all.length ? `${op.target} 所在的段已经撤回了`
          : `黑板上没有 id 为 ${op.target} 的图${figs.length ? `（当前板上的图：${figs.join('、')}）` : ''}`;
      return { ...base, ok: false, error };
    }
    // 在以前的板上：学生现在看不到，动了也白动
    if (!onCurrent(el)) {
      const n = Number(el.closest('.class-page')?.dataset.page);
      return { ...base, ok: false, error: `${op.target} 在第 ${n} 块板上，不在当前板上，学生现在看不到它。要用这张图，就在当前板上重新画一张（换个新 id）` };
    }
    const api = sc.api;
    try {
      if (op.action === 'set') {
        const vars = (api.vars || api.snapshot)?.call(api) || {};
        for (const [name, src] of Object.entries(op.assigns || {})) api.set(name, compile(src)(vars));
      } else if (op.action === 'play') {
        if (api.play) api.play(op.name, op.from ?? 0, op.to ?? 1, op.ms ?? 1200);
        else api.animate?.(op.name, op.from ?? 0, op.to ?? 1, op.ms ?? 1200);
      } else if (op.action === 'highlight') {
        const hit = api.highlight?.(op.index);
        if (hit === false) notes.push(`figure ${op.target} highlight ${op.index}：第 ${op.index} 条命令不画东西（比如 let），没有闪`);
      }
      // 板超出一屏、图不在视野里时滚过去（学生正看着当前板时才动页面）
      if (viewPage === curPage) el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
      return { ...base, ok: true };
    } catch (e) {
      return { ...base, ok: false, error: e?.message || String(e) };
    }
  }

  // 元素在当前板上，或者在常驻栏里（常驻栏一直看得到）
  function onCurrent(el) {
    if (el.closest('.class-pins')) return true;
    return Number(el.closest('.class-page')?.dataset.page) === curPage;
  }

  function saveSeg(seg) {
    sink.put('steps', { id: seg.id, seq: seg.seq, page: seg.page || 0, place: seg.place || 'board', md: seg.md, title: seg.title || '', hidden: !!seg.hidden, failed: !!seg.failed, by: 'class', at: Date.now() });
  }

  function refresh() {
    const any = pages.size > 0;
    welcome.hidden = any || busy;
    hero.hidden = any || !busy;
    if (!any && !busy) {
      welcomeText.innerHTML = !teacher.available ? '课堂现在开不了：这个页面用不了 Claude。<br>看看底部的提示。'
        : started ? '黑板现在是空的。在下面说一句话，Claude 会接着讲。' : '准备好了就点「开始上课」。<br>Claude 会在黑板上一块一块地讲、出题、画图；你在黑板上作答，它马上接着教。';
      root.querySelector('.class-start').hidden = started || !teacher.available;
    }
    const pinned = [...pinsBody.children].some((c) => !c.hidden);
    pinsBox.hidden = !pinned;
    board.classList.toggle('has-pins', pinned);
    bar.setQuick({ show: started && any && teacher.available, enabled: !busy });
    syncNav();
    scheduleFit();
  }
  root.querySelector('.class-start').addEventListener('click', () => enqueueStudent('开始上课。', [], true));

  // —— 黑板现状（每轮都告诉课堂 Claude）——
  function figureVars(b) {
    const sc = b.dataset.scene && session.scenes.get(b.dataset.scene);
    if (!sc) return undefined;
    let v = {};
    try { v = (sc.api.vars || sc.api.snapshot)?.call(sc.api) || {}; } catch { v = {}; }
    // predict 的 guess 是学生的猜测，不让课堂 Claude 改
    return Object.keys(v).filter((k) => !(b.classList.contains('block-predict') && k === 'guess'));
  }

  // 一段文字给课堂 Claude 看：公式换回 $TeX$（KaTeX 渲染后的文字是乱的，比如「x\mathbf xx」）
  function texText(p) {
    if (!p) return '';
    const c = p.cloneNode(true);
    c.querySelectorAll('.katex').forEach((k) => {
      const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      k.replaceWith(tex ? `$${tex}$` : k.textContent);
    });
    return c.textContent.replace(/\s+/g, ' ').trim();
  }

  // 截短但不把公式截成半截（$ 要成对）
  function clipTex(t, n) {
    if (t.length <= n) return t;
    let c = t.slice(0, n);
    if ((c.match(/(?<!\\)\$/g) || []).length % 2) c = c.slice(0, c.lastIndexOf('$'));
    return c.trimEnd() + '…';
  }

  function boardState() {
    const list = [...segs.values()].sort((a, b) => a.seq - b.seq).map((seg) => {
      const blocks = seg.sec && !seg.failed ? [...seg.sec.querySelectorAll('.block[data-bid]')].map((b) => ({
        id: b.dataset.bid,
        kind: [...b.classList].find((c) => c.startsWith('block-'))?.slice(6) || '',
        vars: figureVars(b),
        results: (results.get(b.dataset.bid) || []).slice(-6).map((r) => r.line),
      })) : [];
      const text = texText(seg.sec?.querySelector('.stage-body > p'));
      const summary = [clipTex(text, 140), seg.softNotes?.length ? `（${seg.softNotes.join('；')}）` : ''].filter(Boolean).join(' ');
      return { id: seg.id, page: seg.page || 0, place: seg.place || 'board', title: seg.title || seg.sec?.querySelector('h2')?.textContent?.trim() || '', summary, hidden: seg.hidden, pending: !!seg.pending, failed: !!seg.failed, blocks };
    });
    const vw = window.innerWidth, vh = window.innerHeight;
    return {
      segs: list,
      pages: [...pages.values()].sort((a, b) => a.n - b.n).map((p) => ({ n: p.n, title: p.title, talk: p.talk, kind: p.kind })),
      cur: curPage,
      view: viewPage,
      screen: { w: vw, h: vh, landscape: vw > vh, board: lastFit ? { w: lastFit.w, h: lastFit.avail } : null },
      fit: lastFit && pages.has(curPage) ? { fits: lastFit.fits, need: lastFit.need, avail: lastFit.avail } : null,
    };
  }

  function addResult(a) {
    if (!a.block) return;
    const list = results.get(a.block) || [];
    const line = actionText(a).replace(/^\[(作答|动作)\]\s*/, '');
    // 拖同一个变量只留最后一次，免得几次拖动把真正的作答挤出去
    const key = a.type === 'drag' ? `drag:${a.name ?? ''}` : '';
    if (key) { const i = list.findIndex((r) => r.key === key); if (i >= 0) list.splice(i, 1); }
    list.push({ line, key });
    results.set(a.block, list.slice(-12));
  }

  // steps 揭开的是不是最后一步（学生走完了一道题，在等 Claude）
  function isLastStep(a) {
    const n = Number(a.detail?.step);
    const el = a.block && board.querySelector(`.block-steps[data-bid="${CSS.escape(a.block)}"]`);
    return !!el && n >= el.querySelectorAll('.st-item').length;
  }

  function onAction(a) {
    const trig = actionTrigger(a, { lastStep: a.source === 'event' && a.type === 'reveal' && isLastStep(a) });
    if (!trig) return;
    if (reportable(a)) {
      addResult(a);
      // 连着拖同一个点，只留最后一次
      if (a.type === 'drag') {
        const i = queue.actions.findIndex((x) => x.type === 'drag' && x.block === a.block && x.name === a.name);
        if (i >= 0) queue.actions.splice(i, 1);
      }
      queue.actions.push(a);
    }
    if (trig === 'later') return; // 只是往下翻、拖一拖：跟着下一条一起说
    queue.triggered = true;
    schedule(trig === 'now');
  }

  function enqueueStudent(text, images = [], urgent = true) {
    if (!teacher.available) return;
    if (text) queue.texts.push(text);
    for (const blob of images) {
      const id = store.assets ? store.assets.upload(blob, { type: blob.type || 'image/png' }).then((r) => { localImages.set(r.id, blob); return r.id; }).catch(() => null) : Promise.resolve(null);
      queue.images.push({ blob, id });
    }
    queue.triggered = true;
    schedule(urgent);
  }

  function schedule(urgent) {
    if (urgent) queue.now = true;
    clearTimeout(timer);
    if (busy || !queue.triggered) return; // 正在讲：等这一轮说完再发
    timer = setTimeout(flush, queue.now ? 0 : DEBOUNCE);
  }

  // 一次只跑一件事（讲一轮、重试、下课小结）。fn 返回 true 表示这一轮顺利结束：排着的动作接着发；
  // 失败了就先留着，等学生点重试或者再有新动作（不自动重试）
  async function exclusive(fn) {
    if (busy) return;
    busy = true;
    clearTimeout(timer);
    bar.setBusy(true);
    refresh();
    let ok = false;
    try {
      ok = await fn();
    } catch (e) {
      console.error(e);
      clearDraft();
      bar.setStatus('error', '出了点问题，这一轮没完成。点重试接着上。');
    } finally {
      busy = false;
      ctl = null;
      clearDraft();
      bar.setBusy(false);
      refresh();
      if (ok) schedule(false);
    }
  }

  function flush() {
    if (busy || !queue.triggered) return Promise.resolve();
    return exclusive(async () => {
      // 先占住（busy），再等图片上传：上传慢的时候，后来的动作不会抢先发出去、也不会把顺序弄乱
      const actions = queue.actions.splice(0);
      const texts = queue.texts.splice(0);
      const imgs = queue.images.splice(0).slice(-maxImages);
      queue.triggered = false;
      queue.now = false;
      if (!actions.length && !texts.length && !imgs.length) return true;
      started = true;
      const say = texts.join('\n');
      const ids = (await Promise.all(imgs.map((x) => x.id))).filter(Boolean);
      let text = [actions.length ? actionsMessage(actions) : '', say].filter(Boolean).join('\n\n');
      if (imgs.length) text += teacher.images ? `\n（附了 ${imgs.length} 张图：学生的手写或截图，白底黑字。）` : `\n（学生附了 ${imgs.length} 张图，但这个查看方式发不了图，你看不到；需要的话请学生用文字说。）`;
      // 学生说的话不上黑板，只进课堂记录
      const turn = addTurn({ role: 'student', text: text.trim() || '（学生附了图）', say, actions: actions.map(actionText), images: ids, page: curPage || undefined });
      const blobs = imgs.map((x) => x.blob);
      lastImages = { seq: turn.seq, blobs };
      return converse(blobs);
    });
  }

  function addTurn(t) {
    const turn = { at: Date.now(), ...t, seq: t.seq ?? turnSeq + 1 };
    turnSeq = Math.max(turnSeq, turn.seq);
    if (typeof turn.text === 'string' && bytes(turn.text) > TURN_TEXT_MAX) turn.text = turn.text.slice(0, 60000) + '\n（太长，后面省略）';
    history.push(turn);
    sink.put('class_turns', { id: pad6(turn.seq), ...turn });
    return turn;
  }

  async function compact() {
    const { prev, old } = compactionSlice(promptHistory(history));
    if (!old.length) return;
    bar.setStatus('thinking', '对话有点长了，先整理一下前面的内容…');
    try {
      // 摘要不是讲课，按需求用 default 档
      const r = await teacher.call(compactionPrompt({ summary: prev?.text || '', turns: old }), { modelTier: 'default', cache: false, signal: ctl?.signal });
      addTurn({ ...summaryTurn(r.text), upTo: old.at(-1).seq, modelTierApplied: r.modelTierApplied || null });
      compactRetryAt = 0;
    } catch (e) {
      if (e?.code === 'cancelled') throw e;
      console.warn('摘要失败', e);
      compactRetryAt = history.length + 6;
    }
  }

  // —— 讲课：一次调用（画不出来的段会自动再要一轮重写，同一段最多 2 次）。返回 true 表示 Opus 5.5 讲完了这一轮 ——
  async function converse(images = []) {
    if (!teacher.available) return false;
    let imgs = images;
    let followed = false; // 这次已经补发过 view_handwriting 要的图了
    let rewriting = false; // 这一轮是在重写写错的段：它说的话不换掉板顶的话（学生没见过写错的那段）
    for (let round = 0; round < MAX_ROUNDS; round++) {
      bar.setStatus('thinking', round ? 'Claude 在接着写…' : 'Claude 在想…');
      ensureDraft();
      ctl = new AbortController();
      const signal = ctl.signal;
      try {
        const ph = promptHistory(history);
        const due = compactNext || (needsCompaction(ph) && worthCompacting(ph) && history.length >= compactRetryAt);
        if (due) { compactNext = false; await compact(); bar.setStatus('thinking', 'Claude 在想…'); }
      } catch (e) {
        failTurn(e);
        return false;
      }
      measureFit();
      const level = Math.min(budgetLevel, 3);
      const system = buildSystem({ rules: pack.main?.rules, componentDocs: COMPONENT_DOCS, pack, board: boardState(), packBudget: PACK_BUDGET >> level });
      const maxBytes = Math.round(promptLimit() * [1, 0.85, 0.7, 0.55][level]);
      const fit = fitTurns({ system, history: promptHistory(history), maxBytes });
      lastPrompt = { bytes: fit.bytes, maxBytes, keepRecent: fit.keepRecent, dropped: fit.dropped, turns: fit.turns.length, level };
      // 工具做的事先记着，确认是 Opus 5.5 讲的才算数（退路模型记的观察、要看的图都不留）
      const staged = { notes: [], images: [], ids: [], calls: [] };
      const opts = { ...TEACH, cache: false, signal, onText: ({ text }) => drawDraft(text) };
      if (imgs.length && teacher.images) opts.images = imgs.slice(0, maxImages);
      if (teacher.tools) opts.tools = classTools(staged, { view: !followed });
      let res;
      try {
        res = await teacher.call(fit.turns, opts);
      } catch (e) {
        clearDraft();
        failTurn(e);
        return false;
      }
      clearDraft();
      if (res?.modelApplied !== MODEL) {
        // 平台换了退路模型：整段作废（不显示、不执行、不进对话历史），只留一条记录
        addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，这一轮作废', modelApplied: res?.modelApplied || null, modelTierApplied: res?.modelTierApplied || null });
        bar.setStatus('error', 'Opus 5.5 暂时用不了，稍后点重试。');
        return false;
      }
      budgetLevel = 0;
      for (const text of staged.notes) sink.put('class_notes', { kind: 'note', text, at: Date.now(), turn: turnSeq + 1 });
      const out = finishTurn(res, staged.calls, { keepTalk: rewriting });
      // 要它重写的段、它用 view_handwriting 要看的原图：再要一轮
      const wantImages = staged.images.length > 0 && !followed;
      if (round === MAX_ROUNDS - 1 && (out.retry.length || wantImages)) {
        // 连着要了太多轮：不再要，留一条提醒，下一次学生说话时它会看到
        addTurn({ role: 'system', kind: 'note', text: `[系统] ${[...out.retry, ...out.notes].join('\n')}\n（这一轮已经连着改了好几次，先停在这里。）` });
        return true;
      }
      if (!out.retry.length && !wantImages) {
        if (out.notes.length) addTurn({ role: 'system', kind: 'note', text: `[系统] ${out.notes.join('\n')}` });
        return true;
      }
      const lines = [...out.retry, ...out.notes];
      if (wantImages) {
        followed = true;
        lines.push(`附上你用 view_handwriting 要看的手写原图（${staged.images.length} 张）。看完接着上课，话要短。`);
      }
      rewriting = out.retry.length > 0 && !wantImages;
      const ask = out.retry.length ? `\n请把上面没显示的段重新写对：${out.asks.join('；')}。只写这几段，不用再对学生说别的。` : '';
      const turn = addTurn({ role: 'system', kind: out.retry.length ? 'lint' : 'images', text: `[系统] ${lines.join('\n')}${ask}`, images: wantImages ? staged.ids : undefined });
      imgs = wantImages ? staged.images : [];
      lastImages = { seq: turn.seq, blobs: imgs };
    }
    return true;
  }

  // 重试：排着没发的动作一起发；没有的话，把还在等回答的那一条重新问一遍（原图也再发）
  function retryRun() {
    if (busy || !teacher.available) return;
    if (queue.actions.length || queue.texts.length || queue.images.length) {
      queue.triggered = true;
      flush();
      return;
    }
    const p = pendingTurn(history);
    if (!p) { bar.setStatus('idle', ''); return; } // 已经回过了，不用重试
    exclusive(async () => converse(await imagesOf(p)));
  }

  async function imagesOf(turn) {
    if (lastImages.seq === turn.seq) return lastImages.blobs;
    const ids = Array.isArray(turn.images) ? turn.images : [];
    const blobs = await Promise.all(ids.map(loadImage));
    return blobs.filter(Boolean);
  }

  // asset id → 原图 Blob：这次上传过的直接用；刷新之后从 assets 取（取不到就算了）
  async function loadImage(id) {
    if (localImages.has(id)) return localImages.get(id);
    try {
      const url = assetUrl(String(id));
      if (!url) return null;
      const r = await fetch(url);
      if (!r.ok) return null;
      const b = await r.blob();
      if (!/^image\//.test(b.type)) return null;
      localImages.set(id, b);
      return b;
    } catch { return null; }
  }

  // 执行一轮的输出：指令按顺序执行，说的话写在（执行完之后的）当前板最上面。返回 { retry: [要它重写的说明], asks, notes: [提醒] }
  function finishTurn(res, toolCalls = [], { keepTalk = false } = {}) {
    const { segments, rejected, unclosed } = parseOutput(res.text, { final: true });
    let failures = [];
    const notes = [];
    const pageBefore = curPage;
    const boardOps = [];
    for (const s of segments) {
      if (!isOp(s)) continue;
      const n = failures.length;
      const r = execOp({ ...s.op, body: s.body }, failures, notes);
      failures.slice(n).forEach((f) => { f.at = boardOps.length; });
      boardOps.push(r);
    }
    // 同一轮里先写错、后面又写对了同一段（add 错了紧跟一个 replace）：不用再要求重写
    failures = failures.filter((f) => !boardOps.some((o, i) => i > f.at && o.ok && o.id === f.id && ['add', 'new', 'replace', 'pin'].includes(o.op)));
    // 说的话：写在当前板的最上面（换了新板就写在新板上），把上一句换掉。还没有板就开一块只有话的板
    const talk = segments.filter((s) => s.type === 'speech').map((s) => s.text).join('\n\n').trim();
    let talkPage;
    if (talk && !keepTalk) {
      const cur = pages.get(curPage);
      const p = cur && cur.kind !== 'closing' ? cur : newPage();
      setTalk(p, talk);
      talkPage = p.n;
    }
    const turnedPage = curPage !== pageBefore;
    refresh();
    // 换了新板：翻过去、从头看。只改了当前板：回到当前板（学生翻到以前的板去作答时也拉回来）；
    // 这一轮在当前板上新写、改写的段露不全，就滚到刚好露出来（滚得最少，板顶尽量留着）；没写段时，板顶的话不在视野里就滚上去
    const smooth = reduceMotion() ? 'auto' : 'smooth';
    if (turnedPage) showPage(curPage, { animate: true });
    else if (pages.has(curPage)) {
      if (viewPage !== curPage) showPage(curPage, { animate: true });
      const fresh = boardOps.filter((o) => o.ok && (o.op === 'add' || o.op === 'replace') && o.page === curPage).map((o) => segs.get(o.id)?.sec).filter((sec) => sec && !sec.hidden).at(-1);
      if (fresh) {
        const r = fresh.getBoundingClientRect();
        if (r.bottom > window.innerHeight - bar.height || r.top < 0) fresh.scrollIntoView({ behavior: smooth, block: 'nearest' });
      } else if (talkPage) {
        const t = pages.get(curPage).talkEl;
        if (t.getBoundingClientRect().top < 0) t.scrollIntoView({ behavior: smooth, block: 'start' });
      }
    }
    addTurn({ role: 'claude', text: res.text, boardOps, page: curPage || undefined, talkPage, modelApplied: res.modelApplied, truncated: !!res.truncated, tools: toolCalls.length ? toolCalls : undefined });
    bar.setStatus(res.truncated ? 'notice' : 'idle', res.truncated ? '这一轮太长，被截断了。' : '');

    const retry = [];
    const asks = [];
    for (const f of failures) {
      const n = (rewrites.get(f.key) || 0) + 1;
      rewrites.set(f.key, n);
      const head = `${f.id}${f.title ? `「${f.title}」` : ''}`;
      if (n <= MAX_REWRITES) {
        retry.push(f.dup ? `${head}：${f.errors[0].msg}` : `${head}有写法错误，没有显示：\n${f.errors.map((p, i) => `  ${i + 1}. ${p.kind}：${p.msg}`).join('\n')}`);
        asks.push(f.dup ? `用一个没用过的新 id 重新写这一段（黑板上的 ${f.id} 不动）` : `board replace id=${f.id}`);
        continue;
      }
      rewrites.delete(f.key);
      // 重写了还不行：原来画好的段保留原样；新段显示「这段没画出来」，课堂继续
      const seg = segs.get(f.id);
      if (f.dup || !seg) continue;
      if (!seg.sec?.isConnected) {
        seg.failed = true;
        seg.pending = false;
        seg.title = f.title || seg.title;
        seg.sec = failedSec(seg);
        saveSeg(seg);
        refresh();
        notes.push(`${head} 重写了 ${MAX_REWRITES} 次还是画不出来，学生看到的是「这段没画出来」。换个更简单的写法，或者先不用这一段。`);
      } else {
        notes.push(`${head} 的改写还是有写法错误，黑板上保留原来的内容。`);
      }
    }
    for (const o of boardOps) if (!o.ok && !['add', 'new', 'replace', 'pin'].includes(o.op)) notes.push(`指令 ${o.op}${o.action ? ' ' + o.action : ''} ${o.id || ''} 没执行：${o.error}`);
    for (const r of rejected) notes.push(`有一个 board 块看不懂（${r.error}），已经当普通文字写在板顶了：board ${r.header.slice(0, 60)}`);
    for (const u of unclosed) notes.push(`有一个 board 块没有闭合，已经当普通文字写在板顶了：board ${u.header.slice(0, 60)}${res.truncated ? '（这一轮太长被截断了，下次写短一点）' : ''}`);
    return { retry, asks: [...new Set(asks)], notes };
  }
  // 和 parseOutput 的 ops 同一个口径：闭合了、看得懂的 board 块
  function isOp(s) { return s.type === 'board' && s.closed && s.op && !s.op.error; }

  // 这一轮没成功（停止、出错）：课后复原时要看得出这里断过，所以也记一条作废的记录；不进对话历史
  function failTurn(e, what = '这一轮') {
    const code = String(e?.code || 'unknown');
    addTurn({ role: 'system', kind: 'error', discarded: true, code, text: `${what}没成功（${code === 'cancelled' ? '学生点了停止' : code}），Claude 的输出没有用` });
    handleError(e);
  }

  function handleError(e) {
    const code = e?.code;
    if (code === 'cancelled') return bar.setStatus('error', '已停止这一轮。点重试让 Claude 重新回答，或者直接再说一句。');
    if (code === 'rate_limited') return bar.setStatus('error', '请求太频繁，等一下再说。');
    if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') {
      // 这次打开页面时拒绝过，就一直是拒绝：要在权限设置里允许后刷新页面
      return bar.setStatus('error', '这个页面还没获准使用 Claude：在页面的权限设置里允许后，刷新页面再继续。');
    }
    if (code === 'session_expired') return bar.setStatus('error', '登录过期了：重新登录 Claude 后点重试。');
    if (code === 'prompt_too_large') {
      compactNext = true;
      budgetLevel++;
      return bar.setStatus('error', '这节课的记录太长了，点重试会先整理前面的内容、少发一些。');
    }
    if (code === 'refused') return bar.setStatus('error', 'Claude 没有回答这一轮，换个说法再试。');
    if (code === 'image_rejected' || code === 'images_unavailable') {
      // 再发同样的图还是会被拒：重试时不带图
      lastImages = { seq: lastImages.seq, blobs: [] };
      if (code === 'images_unavailable') { off.images = true; bar.setImages?.(false); } // 这个查看方式发不了图：收起手写 / 截图按钮
      // 还在等回答的那条学生发言里说「附了图」：改成没发出去，重试时 Claude 不会去找看不到的图
      const p = pendingTurn(history);
      if (p?.role === 'student' && /附了 \d+ 张图/.test(p.text)) {
        p.text = p.text.replace(/（附了 (\d+) 张图[^）]*）/, '（学生附了 $1 张图，但没发出去，你看不到；需要的话请学生用文字说。）');
        sink.put('class_turns', { id: pad6(p.seq), ...p });
      }
      return bar.setStatus('error', code === 'image_rejected' ? '图片发不出去（格式或大小不对），点重试会不带图再问一次。' : '这个查看方式发不了图片，点重试会只发文字。');
    }
    if (code === 'tools_unavailable') { off.tools = true; return bar.setStatus('error', '这一轮没成功，点重试。'); }
    if (code === 'empty_completion') return bar.setStatus('error', 'Claude 这次什么也没写，点重试再问一次，或者换个说法。');
    if (code === 'invalid_request' || code === 'transform_error') console.error('课堂调用出错', e);
    bar.setStatus('error', errorText(e));
  }

  // —— 正在写的这一轮：写在当前板最上面（板顶原来的话先藏起来），还没有板时写在黑板中间。
  // 确认是 Opus 5.5 之前都是草稿：话边生成边出现，要写的黑板内容只列出来（写什么、写在哪），不画 ——
  function ensureDraft() {
    const host = pages.get(curPage) || null;
    if (draft && draft.host === (host?.n || 0)) return draft;
    clearDraft();
    const box = document.createElement('div');
    box.className = 'class-draft';
    box.innerHTML = '<div class="class-draft-talk" hidden></div><div class="class-draft-ops" hidden></div>';
    box.prepend(bar.indicator);
    if (host) { host.talkEl.before(box); host.sec.classList.add('is-drafting'); }
    else hero.appendChild(box);
    draft = { box, host: host?.n || 0, talk: box.querySelector('.class-draft-talk'), ops: box.querySelector('.class-draft-ops') };
    refresh();
    return draft;
  }

  function drawDraft(text) {
    pendingText = text;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      try {
        const { segments } = parseOutput(pendingText);
        bar.setStatus('writing', 'Claude 正在写黑板…');
        const d = ensureDraft();
        const talk = segments.filter((s) => s.type === 'speech').map((s) => s.text).join('\n\n').trim();
        d.talk.hidden = !talk;
        if (talk) d.talk.innerHTML = mdToHtml(previewMd(talk));
        const ops = segments.filter((s) => s.type === 'board');
        d.ops.hidden = !ops.length;
        if (ops.length) d.ops.innerHTML = ops.map(opChip).join('');
        scheduleFit();
      } catch (e) {
        // 草稿只是预览：画不出来就先不画，等这一轮结束
        console.warn('草稿没画出来', e);
      }
    });
  }

  function opChip(b) {
    const op = b.op || {};
    const t = op.title ? `「${escapeHtml(op.title)}」` : '';
    const label = op.op === 'new' ? `换一块新板${t}` : op.op === 'add' ? `在这块板上加一段${t}` : op.op === 'replace' ? `改写 ${escapeHtml(op.id || '')}${t}`
      : op.op === 'hide' ? `擦掉 ${escapeHtml(op.id || '')}` : op.op === 'pin' ? `常驻栏${t || ` ${escapeHtml(op.id || '')}`}` : op.op === 'unpin' ? `从常驻栏撤下 ${escapeHtml(op.id || '')}`
        : op.op === 'figure' ? `让图 ${escapeHtml(op.target || '')} 动一下` : '写黑板';
    return `<span class="class-draft-op${b.closed ? '' : ' is-writing'}">${label}</span>`;
  }

  // 末尾还没写完的 $…（公式没闭合）先不显示，免得露出半截 TeX
  function previewMd(md) {
    const dollars = (md.replace(/\\\$/g, '').match(/\$/g) || []).length;
    return dollars % 2 ? md.slice(0, md.lastIndexOf('$')) + ' …' : md;
  }

  function clearDraft() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!draft) return;
    pages.get(draft.host)?.sec.classList.remove('is-drafting');
    bar.indicator.remove();
    draft.box.remove();
    draft = null;
    scheduleFit();
  }

  // —— 可选工具（这个查看方式支持 tools 时才给）。有副作用的先记在 staged 里，确认是 Opus 5.5 才生效 ——
  function classTools(staged, { view = true } = {}) {
    const cut = (v, n) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v);
    const tools = [
      {
        name: 'get_answers',
        description: '读黑板上某个组件（按组件 id）的全部作答记录，包括每次尝试、手写转写和用时。返回最近 30 条。',
        inputSchema: { type: 'object', properties: { blockId: { type: 'string' } }, required: ['blockId'] },
        async execute(input) {
          const blockId = String(input?.blockId ?? '').trim();
          staged.calls.push({ name: 'get_answers', input: { blockId } });
          if (!blockId) throw new Error('要写 blockId（组件的 id）');
          const s = await db.collection('answers').where('block', '==', blockId).get();
          return s.docs.map((d) => d.data()).sort((a, b) => a.at - b.at).slice(-30).map((a) => ({
            id: a.id, kind: a.kind, q: cut(a.q, 200), text: cut(a.text, 500), value: cut(a.value, 200), ok: a.ok, attempts: a.attempts,
            transcript: cut(a.transcript, 500), detail: a.detail, giveup: a.giveup, revealed: a.revealed, ms: a.ms, images: (a.images || []).length,
          }));
        },
      },
      {
        name: 'view_handwriting',
        description: '把某条作答（answerId，get_answers 返回的 id）的手写原图附在下一条消息里给你看。返回这条作答的转写和图片数量。',
        inputSchema: { type: 'object', properties: { answerId: { type: 'string' } }, required: ['answerId'] },
        async execute(input) {
          const answerId = String(input?.answerId ?? '').trim();
          staged.calls.push({ name: 'view_handwriting', input: { answerId } });
          if (!answerId) throw new Error('要写 answerId（get_answers 返回的 id）');
          const s = await db.collection('answers').doc(answerId).get();
          if (!s.exists) throw new Error('没有这条作答');
          const a = s.data();
          const ids = (a.images || []).slice(0, maxImages);
          const blobs = (await Promise.all(ids.map(loadImage))).filter(Boolean);
          const room = maxImages - staged.images.length;
          staged.images.push(...blobs.slice(0, room));
          staged.ids.push(...ids.slice(0, room));
          return { transcript: cut(a.transcript || a.text || '', 1000), images: (a.images || []).length, attachedNextMessage: Math.min(blobs.length, room) };
        },
      },
      {
        name: 'lesson_note',
        description: '记一条给课后看的观察（比如学生反复出现的错误），项目对话里的 Claude 课后会读。',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute(input) {
          const text = String(input?.text ?? '').trim().slice(0, 2000);
          staged.calls.push({ name: 'lesson_note', input: { text } });
          if (!text) throw new Error('要写 text');
          staged.notes.push(text);
          return '记下了，下课后给项目对话里的 Claude 看。';
        },
      },
    ];
    return view && teacher.images ? tools : tools.filter((t) => t.name !== 'view_handwriting');
  }

  // —— 下课：让课堂 Claude 写一份小结，存进 class_notes（同样只收 Opus 5.5 写的），写在最后一块板上 ——
  function endClass() {
    if (busy) { toast('等 Claude 说完这一轮再下课'); return; }
    if (!history.length) { toast('还没开始上课'); return; }
    if (!teacher.available) return;
    exclusive(async () => {
      bar.setStatus('thinking', 'Claude 在写这节课的小结…');
      ensureDraft();
      ctl = new AbortController();
      const system = buildSystem({ rules: pack.main?.rules, componentDocs: COMPONENT_DOCS, pack, board: boardState() });
      const { turns } = fitTurns({ system, history: [...promptHistory(history), { role: 'system', text: closingPrompt() }], maxBytes: promptLimit() });
      let res;
      try {
        res = await teacher.call(turns, { ...TEACH, cache: false, signal: ctl.signal });
      } catch (e) {
        failTurn(e, '下课小结');
        return false;
      }
      if (res?.modelApplied !== MODEL) {
        addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，下课小结作废', modelApplied: res?.modelApplied || null, modelTierApplied: res?.modelTierApplied || null });
        bar.setStatus('error', 'Opus 5.5 暂时用不了，小结没写成，稍后再点「下课」。');
        return false;
      }
      clearDraft();
      await sink.put('class_notes', { kind: 'summary', text: res.text, at: Date.now(), turn: turnSeq + 1 });
      const p = newPage({ title: '这节课的小结', kind: 'closing', body: res.text });
      addTurn({ role: 'system', kind: 'closing', text: res.text, modelApplied: res.modelApplied, page: p.n });
      showPage(p.n, { animate: true });
      bar.setStatus('notice', '下课了。小结已经存好，回对话告诉 Claude「下课了」。');
      session.event('end', null, { turns: history.length });
      return true;
    });
  }

  window.LAKit = {
    ...(window.LAKit || {}),
    classroom: {
      history, segs, pages, queue, boardState, flush, retry: retryRun, showPage: (n) => goPage(n), measureFit,
      runClaude: () => exclusive(async () => converse()),
      get busy() { return busy; },
      get curPage() { return curPage; },
      get viewPage() { return viewPage; },
      get pending() { return pendingTurn(history); },
      get lastPrompt() { return lastPrompt; },
      get budgetLevel() { return budgetLevel; },
    },
  };
  refresh();
}
