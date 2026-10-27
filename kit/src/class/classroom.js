// 课堂模式（mode: class）：一屏就是一块黑板。课堂里的 Claude 每次回应要么擦掉重写一块新板（board new），
// 要么在当前这块板上改（add / replace / hide / figure）；旧板收进历史，翻页看。它说的话写在当前板的最上面，
// 学生说的话不上黑板。这节课一直要看的东西（记号、关键结论）放在常驻栏（board pin）。
// 学生在黑板上的作答会自动发给它，它接着往下教。只用 Opus 5.5（effort high）讲课：
// 返回的不是 Opus 5.5 时，这一轮整段作废（不显示、不执行黑板指令、不进对话历史，工具里记的观察也不留）。
// 数据都在这个 artifact 的数据库里：黑板段落 steps（带 page / place）、每块板 class_pages（标题、板顶的话）、
// 作答 answers / events、课堂记录 class_turns、课后小结 class_notes、资料包 pack。
// 在学习台里上课（desk，docs/learner-memory-spec.md 第 2 批）：这节课的数据放在 sessions/{编号}/ 下面（memory/session.js 的 scopeDb），
// 作答和动作只写进 evidence（证据），观察、下课小结写进 observations，课堂 Claude 每一轮带着记忆摘要，多两个工具 slip_note、memory_read。
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
  reportable, actionTrigger, promptHistory, pendingTurn, nextSegmentId, nextPinId, bytes, PACK_BUDGET, compactionSlice, worthCompacting, draftLine,
  lintDocs, docLookup,
} from './prompt.js';
import { draftsIn } from '../drafts.js';
import { COMPONENT_DOCS } from './docs.js';
import { createDevTeacher } from './devteacher.js';
import { createClassBar, MODEL_TAG } from './bar.js';
import { createBoardView } from './boardview.js';
import { extraProblems } from './selfcheck.js';
import { initClassDevPanel, ensureDemoSlide } from './devpanel.js';
import { createBoardTools } from './boardtools.js';
import { markText } from '../markspec.js';
import { calcValue, exactText } from '../exact.js';
import { strokesToBlob } from '../ink/engine.js';
import { shouldNudge, stuckText, STUCK_MS } from './stuck.js';
import { fromEvidence, sayEvidence, draftEvidence, observationRecord, slipRecord, memoryRead } from '../memory/session.js';
import { callCost, usageOf, usageText } from './usage.js';
import { reportText } from '../memory/report.js';

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
const QUICK_SAY = { 没懂: '没懂。', 想不出来: '想不出来。', 换个说法: '换个说法讲讲？', 继续: '继续。' };

/**
 * desk（在学习台里上课时才有）：{ store（已经 scopeDb 过的）, sid, block, mem（记忆库各类的数组，页面一直在更新）,
 * updateSession(patch)（改 sessions/{sid}）, writeReport({ turns, steps })（下课后写课后报告）, onHome（回学习台首页）}
 */
export async function renderClass(root, meta, desk = null) {
  session.mode = 'class';
  session.live = true; // 共用 live 的行为：猜想默认不批改、作答逐次记录、组件要有 id
  session.stages = [];
  const unitName = meta.unit || session.title;
  root.classList.add('is-live', 'is-class');
  // 一屏一块板（boardview.js，实时黑板也用）：常驻栏 + 黑板；黑板区里另有「Claude 在想」和开课前的欢迎牌
  // segs、busy 在下面才有值：这两个回调要到用户操作或恢复时才会调到
  const bv = createBoardView({
    root,
    unitHtml: mdToHtml(unitName, { inline: true }),
    stageExtra: `
        <div class="class-hero" hidden></div>
        <div class="class-welcome">
          <div class="live-empty-art" aria-hidden="true"><i></i><i></i><i></i></div>
          <p class="class-welcome-text">正在准备课堂…</p>
          <button type="button" class="btn btn-primary btn-lg class-start" hidden>开始上课</button>
        </div>`,
    isBusy: () => busy,
    seqOf: (id) => segs.get(id)?.seq,
    decorate: (p) => decoratePage(p),
  });
  const { board, pages } = bv;
  const hero = root.querySelector('.class-hero');
  const welcome = root.querySelector('.class-welcome');
  const welcomeText = root.querySelector('.class-welcome-text');

  const store = desk?.store || await getStore({ title: session.title });
  if (!store) {
    welcomeText.innerHTML = '这个页面没有拿到课堂的数据库权限。<br>发布时要声明 <code>capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}</code>；本地试用请在地址后面加 <code>?dev</code>。';
    return;
  }
  const { db } = store;
  // 学习台里：作答、动作写成证据，带上这节课、这一块、这一段标的知识点（point=）
  const sink = createSink(store, desk ? { evidence: (rec) => evCtx(rec.step) } : {});
  // turn：这时课堂进行到第几轮（最近一轮的 seq），课后报告按它和课堂记录对齐
  const evCtx = (step) => ({ session: desk?.sid, block: desk?.block, point: segs.get(step)?.point, turn: turnSeq });

  // —— 谁来讲课：claude.ai 里是真的 Claude；本地 ?dev 用模拟老师（剧本回放，不花额度）——
  const ai = await getAI();
  const dev = store.dev || isDev();
  const useMock = dev && !/[?&]teacher=real\b/.test(location.search);
  // 验收脚本（tools/check-lesson.mjs）在打开页面前放好 window.LAKitDevScript：模拟老师按它原样回放
  const script = useMock && Array.isArray(window.LAKitDevScript) ? window.LAKitDevScript : null;
  let mock = useMock ? createDevTeacher(script ? { script, pace: 0 } : {}) : null;
  // 验收脚本、浏览器里的测试读模拟老师的记录（调用过什么、工具的结果）
  if (mock) window.LAKitEval = { teacher: mock };
  // 旧版接口（window.claude.complete）不能指定模型、也不说是谁答的：每一轮都只能作废，干脆不开课
  const legacy = !mock && !!ai?.legacy;
  const off = { tools: false, images: false }; // 这个查看方式明确说了不支持的（tools_unavailable / images_unavailable）
  const teacher = {
    get available() { return !!(mock || (ai?.call && !legacy)); },
    call: (input, opts) => (mock ? mock(input, opts) : ai.call(input, opts)),
    // 模拟老师在学习台里也给工具：「测试:记忆」会真的调用 memory_read、lesson_note、slip_note（单独的课堂照旧不给）
    get tools() { return mock ? !!desk : !!ai?.tools && !off.tools; },
    get images() { return !!(ai?.images || mock) && !off.images; },
  };
  const maxImages = ai?.images?.maxCount || 4;
  // 留一点余量给平台的包装（maxPromptBytes 按 UTF-8 字节算全部 content）
  const promptLimit = () => Math.max(64 * 1024, (Number(ai?.limits?.maxPromptBytes) || 262144) - 2048);

  // —— 状态 ——
  const segs = new Map(); // id → { id, seq, page, place: 'board' | 'pin', title, md, hidden, failed, pending, sec, softNotes }
  let segSeq = 0;
  // 板（pages、当前板 bv.cur、正在看的板 bv.view、放不放得下 bv.fit）在 boardview.js；当前板是最新的那块，Claude 改的、说话写的都是它
  const rewrites = new Map(); // 段 id（或 dup:id）→ 已经要求重写了几次；画好了就清零
  const history = []; // { seq, role, text, kind, discarded, ... } 和数据库 class_turns 一一对应
  let turnSeq = 0;
  const results = new Map(); // 组件 id → [{ line, key }]（给课堂 Claude 看的黑板现状）
  // 教具（board mark / unmark / figure，课堂和实时黑板共用 boardtools.js）。
  // 板上现有的标注 marks：id → { id, seg（所在的段）, spec, host（画在哪一段上）}。段被改写、撤回时一起擦掉
  const tools = createBoardTools({ bv, segs });
  const { marks } = tools;
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
  const toldInk = new WeakSet(); // 已经发给课堂 Claude 的板书笔画
  let inkSeeded = false; // 打开页面前写的板书已经记成「发过了」（之前不认任何笔画是新写的）
  let lastActive = Date.now(); // 学生最后一次有动静（点、写、打字）
  let nudged = false; // 这一轮已经提醒过「停了很久」
  let lastPrompt = null; // 开发面板看：上一轮发了多少字节
  // 被函数声明用到、而 restore() 在函数定义之前就会调到那些函数：要在这里先有值（let / const 有暂时性死区）
  let raf = 0, pendingText = ''; // 草稿：一帧最多画一次
  let lastVerify = { turns: 0, discarded: 0 }; // 学习台里：上次写进 sessions/{编号} 的核验轮数
  let lastUsage = ''; // 学习台里：上次写进 sessions/{编号} 的花费
  let turnMemos = []; // 这一轮 memo 块里读懂的条目（执行完黑板指令、记下这一轮以后再写进记忆库）

  // 察觉卡住的开关（学生在「⋯」里可以开；记在这台设备上）。每提醒一次就是一整轮调用，默认关（docs/desk-plan.md 第 7 节）。
  // 本地试用带 ?stuck=秒数 时自动开
  const stuckKey = `la-class-stuck:${session.title}`;
  let stuckOn = (() => { if (isDev() && /[?&]stuck=\d+/.test(location.search)) return true; try { return localStorage.getItem(stuckKey) === 'on'; } catch { return false; } })();
  const bar = createClassBar({
    images: teacher.images,
    tag: mock ? `${MODEL_TAG} · 模拟老师` : MODEL_TAG,
    stuck: { on: stuckOn, onChange: (v) => { stuckOn = v; lastActive = Date.now(); try { localStorage.setItem(stuckKey, v ? 'on' : 'off'); } catch { /* 无痕模式 */ } } },
    onSend: ({ text, images }) => { bv.go(bv.cur); enqueueStudent(text, images, true); },
    inkPending: () => hasFreshInk(),
    onQuick: (label) => { if (busy) return; bv.go(bv.cur); enqueueStudent(QUICK_SAY[label] || label, [], true); },
    onNav: (n) => bv.go(n),
    onStop: () => ctl?.abort(),
    onRetry: () => retryRun(),
    onEnd: () => endClass(),
    onCopy: () => copyRecord(toast),
    onHome: desk?.onHome || null,
  });
  bv.attachBar(bar);
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
    syncPackImages();
    bv.syncNav();
  };
  // 讲义原图（image 组件按 name 找）。本地模拟老师上课时补一张模拟的，「测试:原图」用
  function syncPackImages() {
    session.packImages = Array.isArray(pack.main?.images) ? pack.main.images.filter((x) => x && x.name) : [];
    if (mock && !session.packImages.length) { const demo = ensureDemoSlide(); if (demo) session.packImages = [demo]; }
  }
  syncPackImages();
  db.doc('pack/main').onSnapshot((s) => applyMain(s.exists ? s.data() : null), () => {});
  db.doc('pack/problems').onSnapshot((s) => { pack.problems = s.exists ? s.data() : null; }, () => {});

  // —— 恢复：资料包、黑板（板和段）、课堂记录、作答 ——
  await restore();
  syncUsage();
  session.event('open', null, { title: session.title, unit: unitName, mode: 'class' });
  // 打开页面之前写的板书（存在这台设备上）不再发：只发这次上课新写的
  for (const s of window.LAKit?.ink?.strokes || []) toldInk.add(s);
  inkSeeded = true;

  async function restore() {
    try {
      // 资料包也在这里读一次：第一轮不能赶在资料包到之前发出去（那样课堂 Claude 会以为没有资料包）
      const [st, pg, tu, work, pm, pp] = await Promise.all([
        db.collection('steps').get(), db.collection('class_pages').get().catch(() => ({ docs: [] })),
        db.collection('class_turns').get(), studentWork(),
        db.doc('pack/main').get().catch(() => null), db.doc('pack/problems').get().catch(() => null),
      ]);
      const { an, ev } = work;
      if (pm?.exists && !pack.main) applyMain(pm.data());
      if (pp?.exists && !pack.problems) pack.problems = pp.data();
      for (const d of pg.docs.map((x) => x.data()).filter((p) => Number.isFinite(p?.n) && p.n > 0).sort((a, b) => a.n - b.n)) {
        const p = bv.ensurePage(d.n);
        Object.assign(p, { title: String(d.title || ''), talk: String(d.talk || ''), talkBy: d.talkBy || '', lead: d.lead || '', kind: d.kind || '', body: String(d.body || ''), foot: String(d.foot || ''), memo: Array.isArray(d.memo) ? d.memo.map(String) : [] });
        bv.paint(p);
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
          page = bv.seq + 1;
          Object.assign(bv.ensurePage(page), { lead: d.id, title: d.title || '' });
        }
        if (page) bv.ensurePage(page);
        const seg = { id: d.id, seq: d.seq || 0, page, place, title: d.title || '', md: String(d.md || ''), hidden: !!d.hidden, failed: !!d.failed, pending: false, sec: null, ...(d.point ? { point: d.point } : {}) };
        segs.set(seg.id, seg);
        if (old) legacy.push(seg);
        if (!seg.hidden) mountRestored(seg);
      }
      for (const p of pages.values()) bv.paint(p);
      // 旧版的段分好板就存回去：以后新开的板接在它们后面，下次打开顺序也不变
      for (const seg of legacy) { saveSeg(seg); savePage(pages.get(seg.page)); }
      tu.docs.map((d) => d.data()).filter((t) => Number.isFinite(t?.seq)).sort((a, b) => a.seq - b.seq).forEach((t) => { history.push(t); turnSeq = Math.max(turnSeq, t.seq); });
      // 黑板现状里的作答结果：作答记录 + 揭开 / 拖动（按时间重放，规则和上课时一样）
      const recs = [
        ...an.map((r) => ({ source: 'record', ...r, type: r.kind, answer: r.kind === 'conjecture' ? r.text : undefined })),
        ...ev.map((e) => ({ source: 'event', ...(e.detail && typeof e.detail === 'object' ? e.detail : {}), ...e })),
      ].sort((a, b) => (a.at || 0) - (b.at || 0));
      recs.forEach((a) => { if (reportable(a)) addResult(a); });
      replayStudentWork(recs);
    } catch (e) {
      console.error(e);
      toast('课堂记录没读出来，先从头开始');
    }
    bv.cur = bv.seq;
    started = history.length > 0;
    bv.show(bv.cur, { scroll: false });
    refresh();
    if (pendingTurn(history) && teacher.available) bar.setStatus('error', '上一轮 Claude 还没回完，点重试接着上。');
  }

  // 学生在黑板上的作答和动作：单独的课堂在 answers / events 里；学习台里在 evidence 里（按这节课的编号找，组件 id 放回 block）
  async function studentWork() {
    if (!desk) {
      const [a, e] = await Promise.all([db.collection('answers').get(), db.collection('events').get()]);
      return { an: a.docs.map((d) => d.data()), ev: e.docs.map((d) => d.data()) };
    }
    const s = await db.collection('evidence').where('session', '==', desk.sid).get();
    const an = [], ev = [];
    for (const d of s.docs) {
      const x = fromEvidence({ id: d.id, ...d.data() });
      if (x.kind === 'record') an.push(x.rec);
      else if (x.kind === 'event') ev.push(x.rec);
    }
    return { an, ev };
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
      // 会自己重放的组件（steps、elim 的 mode: do）：照记录放回去
      for (const [bid, list] of byBlock) {
        const el = on(bid);
        if (!el?._replay) continue;
        const mine = el.classList.contains('block-steps') ? list.filter((r) => r.type === 'steps' || (r.source === 'event' && r.type === 'reveal')) : list;
        try { el._replay(mine); } catch (e) { console.warn('作答没能重放', e); }
      }
      restoreFigures(recs);
    } finally {
      session.replaying = false;
    }
    for (const [bid] of byBlock) {
      const el = on(bid);
      if (!el || el._replay || ['block-steps', 'block-scene', 'block-graph', 'block-space'].some((c) => el.classList.contains(c))) continue;
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
        // 标注的编号接着往下编（撤掉的也算，免得重复）
        for (const m of o?.marks || []) tools.bumpSeq(m.id);
        if (!o?.ok) return;
        const at = (t.at || 0) + i / 1000; // 同一轮里的先后
        if (['add', 'new', 'replace', 'pin'].includes(o.op)) tl.push({ at, kind: 'render', seg: o.id });
        else if (o.op === 'hide' || o.op === 'unpin') tl.push({ at, kind: 'drop', seg: o.id });
        else if (o.op === 'figure' && (o.action === 'set' || o.action === 'play')) tl.push({ at, kind: o.action, target: o.id, args: o.args });
        else if (o.op === 'mark') tl.push({ at, kind: 'mark', marks: o.marks || [] });
        else if (o.op === 'unmark') tl.push({ at, kind: 'unmark', ids: o.ids || [] });
      });
    }
    for (const r of recs) if (r.source === 'event' && r.type === 'drag' && r.block) tl.push({ at: r.at || 0, kind: 'drag', target: r.block, name: r.name, value: r.value });
    tl.sort((a, b) => a.at - b.at);
    const rendered = new Map();
    for (const e of tl) if (e.kind === 'render') rendered.set(e.seg, e.at);
    // 标注：按时间走一遍，留下现在还在的（段重画、撤回时，上面的标注跟着擦掉）
    const kept = new Map();
    for (const e of tl) {
      if (e.kind === 'render' || e.kind === 'drop') { for (const [id, m] of kept) if (m.seg === e.seg) kept.delete(id); }
      else if (e.kind === 'mark') e.marks.forEach((m) => { if (m?.id && m.spec) kept.set(m.id, m); });
      else if (e.kind === 'unmark') e.ids.forEach((id) => kept.delete(id));
    }
    for (const e of tl) {
      if (['render', 'drop', 'mark', 'unmark'].includes(e.kind)) continue;
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
    // 图都回到原样了，再把标注画回去（标在图上的要按图现在的样子摆）
    for (const m of kept.values()) tools.placeMark({ ...m.spec, id: m.id }, { animate: false, restore: true });
  }

  // —— 板（摆放、翻板、测量在 boardview.js）。都写成函数声明：刷新后恢复（restore）在这些定义之前就会用到 ——

  // 擦掉黑板，开一块新板（成为当前板），存进 class_pages
  function newPage(fields = {}) {
    const p = bv.addPage(fields);
    savePage(p);
    return p;
  }

  function savePage(p) {
    sink.put('class_pages', { id: pad3(p.n), n: p.n, title: p.title || '', talk: p.talk || '', talkBy: p.talkBy || '', lead: p.lead || '', kind: p.kind || '', body: p.body || '', foot: p.foot || '', ...(p.memo?.length ? { memo: p.memo } : {}), at: Date.now() });
  }

  // —— 学习台里改记忆（memory/memo.js）：这一轮 memo 块记的改动单挂在板顶那句话下面（小结板上整张列出来，逐条确认）——
  function decoratePage(p) {
    if (!desk?.memo) return;
    const ids = p.memo || [];
    let el = p.sec.querySelector(':scope > .class-memo, :scope > .class-page-body > .class-memo');
    if (!ids.length) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'class-memo';
      const closing = p.kind === 'closing' && p.bodyEl.querySelector(':scope > .class-closing');
      if (closing) closing.after(el);
      else p.talkEl.after(el);
    }
    desk.memo.view.attach(el, () => p.memo || [], p.kind === 'closing'
      ? { mode: 'list', title: '整理单：等你确认的，点「确认」才写进学习台' }
      : { mode: 'line' });
  }

  // 执行一轮里的 memo 块：直接写的马上写，等确认的记成改动单；没记成的告诉课堂 Claude（不多跑一轮：跟着下一轮的提醒）
  async function runMemo(entries, seq, pageN) {
    try {
      const r = await desk.memo.ops.applyMemo(entries, { session: desk.sid, block: desk.block, turn: seq });
      const p = pages.get(pageN);
      if (p && r.pds.length) { p.memo = [...(p.memo || []), ...r.pds.map((x) => x.id)]; savePage(p); bv.paint(p); }
      if (r.rejected.length) addTurn({ role: 'system', kind: 'note', text: `[系统] memo 里有 ${r.rejected.length} 条没记：\n${r.rejected.map((x) => `- ${x.line}\n  原因：${x.error}`).join('\n')}` });
      return r;
    } catch (e) {
      console.warn('memo 没记成', e);
      addTurn({ role: 'system', kind: 'note', text: `[系统] memo 没记成（${e?.message || e}），这一轮的改动都没写。` });
      return null;
    }
  }

  // by：这句话是谁说的（平台回报的 modelApplied；模拟老师是 'mock'），板顶那句话后面标出来
  function setTalk(p, md, by = '') {
    const talk = String(md || '').trim();
    if (p.talk === talk && p.talkBy === by) return false;
    p.talk = talk;
    p.talkBy = by;
    bv.paint(p);
    savePage(p);
    return true;
  }

  // 这节课核验过几轮（平台回报是 Opus 5.5 的讲课和小结）、作废了几轮（平台换了别的模型）
  function verifyCounts() {
    let turns = 0, discarded = 0;
    for (const t of history) {
      if (t.kind === 'fallback') discarded++;
      else if ((t.role === 'claude' || t.kind === 'closing') && t.modelApplied === MODEL) turns++;
    }
    return { turns, discarded };
  }
  function syncVerify() {
    const { turns, discarded } = verifyCounts();
    // 学习台里：这节课核验了几轮、作废了几轮记在 sessions/{编号}（有变化才写）
    if (desk && (turns !== lastVerify.turns || discarded !== lastVerify.discarded)) {
      lastVerify = { turns, discarded };
      if (turns || discarded) desk.updateSession({ verify: { turns, discarded } });
    }
    bar.setTag(`${MODEL_TAG}${mock ? ' · 模拟老师' : ''}${turns || discarded ? `，已核验 ${turns} 轮${discarded ? `，作废 ${discarded} 轮` : ''}` : ''}`);
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
    bv.place(seg, sec);
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
    // 组件自检管不到的：图里写错的命令被当成续行、公式写不出来（selfcheck.js）
    errors.push(...extraProblems(sec));
    if (seg.place !== 'pin') bv.splitFigure(sec.querySelector('.stage-body'));
    return { sec, errors, soft: probs.filter((p) => p.soft) };
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
    bv.place(seg, sec);
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
    if (op.op === 'memo') {
      if (!desk?.memo) return { op: 'memo', ok: false, error: 'memo 只在学习台里上课时能用（单独的课堂没有记忆库）' };
      turnMemos.push(...op.entries);
      if (op.errors?.length) notes.push(`memo 里有 ${op.errors.length} 行没读懂，没记：\n${op.errors.map((e) => `  - ${e}`).join('\n')}`);
      return { op: 'memo', ok: true, n: op.entries.length };
    }
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
          const cur = pages.get(bv.cur);
          page = op.op === 'new' || !cur || cur.kind === 'closing' ? newPage({ lead: op.id, title: op.title || '' }).n : bv.cur;
        }
        seg = { id: op.id, seq: ++segSeq, page, place: toPin ? 'pin' : 'board', title: '', md: '', hidden: false, failed: false, pending: false, sec: null };
      }
      const next = { ...seg, title: op.title ?? seg.title, md: op.body || '', ...(op.point ? { point: op.point } : {}) };
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
      tools.dropMarks(seg.id);
      sec.classList.remove('class-pending');
      Object.assign(seg, next, { sec, hidden: false, failed: false, pending: false, softNotes: soft.length ? soft.map((p) => p.msg) : undefined });
      segs.set(seg.id, seg);
      rewrites.delete(seg.id);
      saveSeg(seg);
      // 板的第一段改了标题：板头跟着改
      const pg = pages.get(seg.page);
      if (pg && pg.lead === seg.id && op.title !== undefined && pg.title !== seg.title) { pg.title = seg.title; bv.paint(pg); savePage(pg); }
      return { op: op.op, id: op.id, ok: true, title: seg.title, isNew, page: seg.page || undefined };
    }
    if (op.op === 'hide') {
      const seg = segs.get(op.id);
      if (!seg) return { op: 'hide', id: op.id, ok: false, error: `黑板上没有 ${op.id}` };
      seg.hidden = true;
      seg.pending = false;
      if (seg.sec) seg.sec.hidden = true;
      tools.dropMarks(seg.id);
      saveSeg(seg);
      return { op: 'hide', id: op.id, ok: true };
    }
    if (op.op === 'figure') return tools.figureOp(op, notes);
    if (op.op === 'mark') return tools.markOp(op);
    if (op.op === 'unmark') return tools.unmarkOp(op);
    return { op: op.op, ok: false, error: '看不懂的指令' };
  }

  function saveSeg(seg) {
    sink.put('steps', { id: seg.id, seq: seg.seq, page: seg.page || 0, place: seg.place || 'board', md: seg.md, title: seg.title || '', hidden: !!seg.hidden, failed: !!seg.failed, ...(seg.point ? { point: seg.point } : {}), by: 'class', at: Date.now() });
  }

  function refresh() {
    syncVerify();
    const any = pages.size > 0;
    welcome.hidden = any || busy;
    hero.hidden = any || !busy;
    if (!any && !busy) {
      welcomeText.innerHTML = !teacher.available ? '课堂现在开不了：这个页面用不了 Claude。<br>看看底部的提示。'
        : started ? '黑板现在是空的。在下面说一句话，Claude 会接着讲。' : '准备好了就点「开始上课」。<br>Claude 会在黑板上一块一块地讲、出题、画图；你在黑板上作答，它马上接着教。';
      root.querySelector('.class-start').hidden = started || !teacher.available;
    }
    bv.syncPins();
    bar.setQuick({ show: started && any && teacher.available, enabled: !busy });
    bv.syncNav();
    bv.scheduleFit();
  }
  root.querySelector('.class-start').addEventListener('click', () => enqueueStudent('开始上课。', [], true));

  // —— 黑板现状（每轮都告诉课堂 Claude）——
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
        vars: tools.figureVars(b),
        results: (results.get(b.dataset.bid) || []).slice(-6).map((r) => r.line),
        draft: draftsIn(b).map((d) => (d.label ? `${d.label}：${d.text}` : d.text)).join('；'),
      })) : [];
      const text = texText(seg.sec?.querySelector('.stage-body > p'));
      const summary = [clipTex(text, 140), seg.softNotes?.length ? `（${seg.softNotes.join('；')}）` : ''].filter(Boolean).join(' ');
      const segMarks = seg.hidden ? [] : [...marks.values()].filter((m) => m.seg === seg.id).map((m) => markText(m.id, m.spec));
      return { id: seg.id, page: seg.page || 0, place: seg.place || 'board', title: seg.title || seg.sec?.querySelector('h2')?.textContent?.trim() || '', summary, hidden: seg.hidden, pending: !!seg.pending, failed: !!seg.failed, blocks, marks: segMarks.length ? segMarks : undefined };
    });
    const vw = window.innerWidth, vh = window.innerHeight;
    // 这节课的量（let 块）：课堂说明被压缩成摘要以后，Claude 也知道有哪些量、值是多少
    const lessonVars = Object.entries(session.vars || {}).map(([k, v]) => { try { return `${k} = ${exactText(v)}`; } catch { return k; } });
    return {
      segs: list,
      vars: lessonVars.length ? lessonVars : undefined,
      nextMark: tools.nextMark,
      pages: [...pages.values()].sort((a, b) => a.n - b.n).map((p) => ({ n: p.n, title: p.title, talk: p.talk, kind: p.kind })),
      cur: bv.cur,
      view: bv.view,
      screen: { w: vw, h: vh, landscape: vw > vh, board: bv.fit ? { w: bv.fit.w, h: bv.fit.avail } : null },
      fit: bv.fit && pages.has(bv.cur) ? { fits: bv.fit.fits, need: bv.fit.need, avail: bv.fit.avail } : null,
    };
  }

  // —— 草稿：学生写了、还没点「检查」「提交」的东西。不单独发，跟着下一轮一起告诉 Claude（每份只在变了的时候说一次）——
  const toldDrafts = new WeakMap(); // 放草稿的元素 → 上次告诉 Claude 的文字
  // 下课时：板上（没撤回的段里）所有还没提交的草稿；已经记成证据、内容没变的跳过
  const loggedDrafts = new WeakMap();
  function allDrafts() {
    const out = [];
    for (const seg of [...segs.values()].sort((a, b) => a.seq - b.seq)) {
      if (!seg.sec || seg.hidden || seg.failed || seg.pending) continue;
      for (const b of seg.sec.querySelectorAll('.block[data-bid]')) {
        for (const d of draftsIn(b)) {
          if (loggedDrafts.get(d.el) === d.text) continue;
          loggedDrafts.set(d.el, d.text);
          out.push({ step: seg.id, block: b.dataset.bid, kind: [...b.classList].find((c) => c.startsWith('block-'))?.slice(6) || '', title: texText(b.querySelector('.w-title')), label: d.label, text: d.text });
        }
      }
    }
    return out;
  }

  function freshDrafts() {
    const out = [];
    for (const seg of [...segs.values()].sort((a, b) => a.seq - b.seq)) {
      if (!seg.sec || seg.hidden || seg.failed || seg.pending) continue;
      for (const b of seg.sec.querySelectorAll('.block[data-bid]')) {
        for (const d of draftsIn(b)) {
          if (toldDrafts.get(d.el) === d.text) continue;
          toldDrafts.set(d.el, d.text);
          out.push({ step: seg.id, block: b.dataset.bid, kind: [...b.classList].find((c) => c.startsWith('block-'))?.slice(6) || '', title: texText(b.querySelector('.w-title')), label: d.label, text: d.text });
        }
      }
    }
    return out;
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

  // 图存进 assets（课后项目对话里的 Claude 能看）；返回 asset id 的 Promise（失败为 null）
  function uploadImage(blob) {
    return store.assets ? store.assets.upload(blob, { type: blob.type || 'image/png' }).then((r) => { localImages.set(r.id, blob); return r.id; }).catch(() => null) : Promise.resolve(null);
  }

  function enqueueStudent(text, images = [], urgent = true) {
    if (!teacher.available) return;
    if (text) queue.texts.push(text);
    for (const blob of images) queue.images.push({ blob, id: uploadImage(blob) });
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
      if (ok) { schedule(false); compactLater(); }
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
      // 学生只在板上写了、输入框空着点发送：这一轮只发板书（下面导出成图）
      if (!actions.length && !texts.length && !imgs.length && !hasFreshInk()) return true;
      // 板上手写：这之后在当前板、常驻栏上新写的板书，导出成图一起发
      const ink = teacher.images ? await freshInk(Math.min(2, maxImages - imgs.length)) : null;
      if (ink) imgs.push(...ink.blobs.map((blob) => ({ blob, id: uploadImage(blob) })));
      // 只有板书、却没导出来：这一轮没东西可发（草稿留着，跟下一条发）
      if (!actions.length && !texts.length && !imgs.length) return true;
      started = true;
      const say = texts.join('\n');
      const drafts = freshDrafts().map(draftLine).filter(Boolean);
      let text = [actions.length ? actionsMessage(actions) : '', drafts.join('\n'), ink?.line || '', say].filter(Boolean).join('\n\n');
      if (imgs.length) text += teacher.images ? `\n（附了 ${imgs.length} 张图：学生的手写或截图，白底黑字。）` : `\n（学生附了 ${imgs.length} 张图，但这个查看方式发不了图，你看不到；需要的话请学生用文字说。）`;
      // 学生说的话不上黑板，只进课堂记录
      const turn = addTurn({ role: 'student', text: text.trim() || '（学生附了图）', say, actions: actions.map(actionText), drafts: drafts.length ? drafts : undefined, images: [], page: bv.cur || undefined });
      // 学习台里：学生说的话也是证据（附的图等传完再记，带上原图的 id）
      const evOf = (images = []) => sayEvidence(say, evCtx(null), images);
      if (desk && say.trim() && !imgs.length) sink.put('evidence', { ...evOf(), turn: turn.seq });
      // 图直接交给 Claude，不用等它传进 assets 再开讲（截图传得慢时能省几秒）；传完再把原图的 id 补进这一轮的记录
      if (imgs.length) {
        Promise.all(imgs.map((x) => x.id)).then((all) => {
          const ids = all.filter(Boolean);
          // ink：其中几张是学生在板上用 Pencil 写的板书（导出成图），排在附图后面
          if (desk && (ids.length || say.trim())) sink.put('evidence', { ...evOf(ids), turn: turn.seq, ...(ink?.blobs.length ? { ink: ink.blobs.length } : {}) });
          if (!ids.length) return;
          turn.images = ids;
          sink.put('class_turns', { id: pad6(turn.seq), ...turn });
        });
      }
      const blobs = imgs.map((x) => x.blob);
      lastImages = { seq: turn.seq, blobs };
      // 只有「停久了」的提醒、学生什么都没说没做：这一轮是页面要的，记成 stuck（省额度的统计里单列）
      const why = !texts.length && !imgs.length && actions.length && actions.every((a) => a.source === 'page' && a.type === 'stuck') ? 'stuck' : 'turn';
      return converse(blobs, { why });
    });
  }

  function addTurn(t) {
    const turn = { at: Date.now(), ...t, seq: t.seq ?? turnSeq + 1 };
    turnSeq = Math.max(turnSeq, turn.seq);
    if (typeof turn.text === 'string' && bytes(turn.text) > TURN_TEXT_MAX) turn.text = turn.text.slice(0, 60000) + '\n（太长，后面省略）';
    history.push(turn);
    sink.put('class_turns', { id: pad6(turn.seq), ...turn });
    if (turn.cost) syncUsage();
    return turn;
  }

  // 这节课调用 Claude 花了多少（usage.js）：「⋯」菜单里显示；学习台里记进 sessions/{编号}（有变化才写）
  function syncUsage() {
    const u = usageOf(history);
    bar.setUsage?.(usageText(u));
    const json = JSON.stringify(u);
    if (desk && u.calls && json !== lastUsage) { lastUsage = json; desk.updateSession({ usage: u }); }
  }

  // —— 对话太长时的摘要（摘要就是它对前半节课的记忆，所以和讲课一样只用 Opus 5.5 high）——
  // 平时在一轮讲完、学生在想的时候后台写，不让学生等；只有平台说「太长发不了」时才先写完再讲
  let compacting = null;
  function compactLater() {
    if (compacting || !teacher.available) return;
    const ph = promptHistory(history);
    if (!(needsCompaction(ph) && worthCompacting(ph) && history.length >= compactRetryAt)) return;
    compacting = compact({ background: true }).finally(() => { compacting = null; });
  }

  async function compact({ background = false } = {}) {
    const { prev, old } = compactionSlice(promptHistory(history));
    if (!old.length) return;
    if (!background) bar.setStatus('thinking', '对话有点长了，先整理一下前面的内容…');
    try {
      const input = compactionPrompt({ summary: prev?.text || '', turns: old });
      const r = await teacher.call(input, { ...TEACH, cache: false, signal: background ? undefined : ctl?.signal });
      // 平台换了别的模型写的摘要不用：照旧发原文（太长时最早的几轮会被省略），过几轮再试
      if (r?.modelApplied !== MODEL) throw Object.assign(new Error('摘要不是 Opus 5.5 写的，没用'), { code: 'fallback' });
      addTurn({ ...summaryTurn(r.text), upTo: old.at(-1).seq, modelApplied: r.modelApplied, cost: callCost({ bytes: bytes(input), why: 'compact' }) });
      compactRetryAt = 0;
    } catch (e) {
      if (e?.code === 'cancelled' && !background) throw e;
      console.warn('摘要失败', e);
      compactRetryAt = history.length + 6;
    }
  }

  // —— 讲课：一次调用（画不出来的段会自动再要一轮重写，同一段最多 2 次）。返回 true 表示 Opus 5.5 讲完了这一轮 ——
  // why：这一轮为什么调用（usage.js：turn 学生引起的、stuck 停久了的提醒）；同一轮里再要的几次记成 lint（重写）/ images（看原图）
  async function converse(images = [], { why: firstWhy = 'turn' } = {}) {
    if (!teacher.available) return false;
    let imgs = images;
    let why = firstWhy;
    let followed = false; // 这次已经补发过 view_handwriting 要的图了
    let rewriting = false; // 这一轮是在重写写错的段：它说的话不换掉板顶的话（学生没见过写错的那段）
    for (let round = 0; round < MAX_ROUNDS; round++) {
      bar.setStatus('thinking', round ? 'Claude 在接着写…' : 'Claude 在想…');
      ensureDraft({ keepTalk: rewriting });
      ctl = new AbortController();
      const signal = ctl.signal;
      try {
        // 平台说上一轮太长发不了：这次先把摘要写完再讲（后台正在写的话就等它）
        if (compactNext) { compactNext = false; await (compacting || compact()); bar.setStatus('thinking', 'Claude 在想…'); }
      } catch (e) {
        failTurn(e);
        return false;
      }
      bv.measureFit();
      const level = Math.min(budgetLevel, 3);
      const system = buildSystem({ rules: pack.main?.rules, componentDocs: COMPONENT_DOCS, pack, board: boardState(), packBudget: PACK_BUDGET >> level, subject: session.subject, tools: teacher.tools, memory: memoryArg() });
      const maxBytes = Math.round(promptLimit() * [1, 0.85, 0.7, 0.55][level]);
      const fit = fitTurns({ system, history: promptHistory(history), maxBytes });
      lastPrompt = { bytes: fit.bytes, maxBytes, keepRecent: fit.keepRecent, dropped: fit.dropped, turns: fit.turns.length, level };
      // 工具做的事先记着，确认是 Opus 5.5 讲的才算数（退路模型记的观察、要看的图都不留）
      const staged = { notes: [], slips: [], images: [], ids: [], calls: [] };
      const opts = { ...TEACH, cache: false, signal, onText: ({ text }) => drawDraft(text) };
      if (imgs.length && teacher.images) opts.images = imgs.slice(0, maxImages);
      if (teacher.tools) opts.tools = classTools(staged, { view: !followed });
      let res;
      // 这一次调用花了多少：发出去的字节；它调了几次工具（每次平台多跑一整轮）
      const cost = (w) => callCost({ bytes: fit.bytes, why: w, tools: staged.calls.length });
      try {
        res = await teacher.call(fit.turns, opts);
      } catch (e) {
        clearDraft();
        failTurn(e, '这一轮', cost('failed'));
        return false;
      }
      clearDraft();
      if (res?.modelApplied !== MODEL) {
        // 平台换了退路模型：整段作废（不显示、不执行、不进对话历史），只留一条记录
        addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，这一轮作废', modelApplied: res?.modelApplied || null, modelTierApplied: res?.modelTierApplied || null, cost: cost('failed') });
        bar.setStatus('error', 'Opus 5.5 暂时用不了，稍后点重试。');
        return false;
      }
      budgetLevel = 0;
      saveNotes(staged);
      const out = finishTurn(res, staged.calls, { keepTalk: rewriting, cost: cost(why) });
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
        lines.push(`附上你要看的图（view_handwriting 的手写原图、view_image 的讲义原图，共 ${staged.images.length} 张）。看完接着上课，话要短。`);
      }
      rewriting = out.retry.length > 0 && !wantImages;
      why = out.retry.length ? 'lint' : 'images';
      const ask = out.retry.length ? `\n请把上面没显示的段重新写对：${out.asks.join('；')}。只写这几段，不用再对学生说别的。` : '';
      // 写错的组件有完整写法的，附在后面（课堂说明里只有精简版）
      const docs = out.retry.length ? lintDocs(COMPONENT_DOCS, session.subject, out.kinds) : '';
      if (docs) lines.push(`\n${docs}`);
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
  function finishTurn(res, toolCalls = [], { keepTalk = false, cost = undefined } = {}) {
    const { segments, rejected, unclosed } = parseOutput(res.text, { final: true });
    let failures = [];
    const notes = [];
    const pageBefore = bv.cur;
    const boardOps = [];
    turnMemos = [];
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
      const cur = pages.get(bv.cur);
      const p = cur && cur.kind !== 'closing' ? cur : newPage();
      setTalk(p, talk, mock ? 'mock' : res.modelApplied);
      talkPage = p.n;
    }
    const turnedPage = bv.cur !== pageBefore;
    refresh();
    // 换了新板：翻过去、从头看。只改了当前板：回到当前板（学生翻到以前的板去作答时也拉回来）；
    // 这一轮在当前板上新写、改写的段露不全，就滚到刚好露出来（滚得最少，板顶尽量留着）；没写段时，板顶的话不在视野里就滚上去
    const smooth = reduceMotion() ? 'auto' : 'smooth';
    if (turnedPage) bv.show(bv.cur, { animate: true });
    else if (pages.has(bv.cur)) {
      if (bv.view !== bv.cur) bv.show(bv.cur, { animate: true });
      const fresh = boardOps.filter((o) => o.ok && (o.op === 'add' || o.op === 'replace') && o.page === bv.cur).map((o) => segs.get(o.id)?.sec).filter((sec) => sec && !sec.hidden).at(-1);
      if (fresh) {
        const r = fresh.getBoundingClientRect();
        if (r.bottom > window.innerHeight - bar.height || r.top < 0) fresh.scrollIntoView({ behavior: smooth, block: 'nearest' });
      } else if (talkPage) {
        const t = pages.get(bv.cur).talkEl;
        if (t.getBoundingClientRect().top < 0) t.scrollIntoView({ behavior: smooth, block: 'start' });
      }
    }
    const told = addTurn({ role: 'claude', text: res.text, boardOps, page: bv.cur || undefined, talkPage, modelApplied: res.modelApplied, truncated: !!res.truncated, tools: toolCalls.length ? toolCalls : undefined, cost });
    if (turnMemos.length) runMemo(turnMemos.splice(0), told.seq, talkPage || bv.cur);
    // Claude 又说了话：重新计「停了多久」
    nudged = false;
    lastActive = Date.now();
    bar.setStatus(res.truncated ? 'notice' : 'idle', res.truncated ? '这一轮太长，被截断了。' : '');

    const retry = [];
    const asks = [];
    const kinds = [];
    for (const f of failures) {
      const n = (rewrites.get(f.key) || 0) + 1;
      rewrites.set(f.key, n);
      const head = `${f.id}${f.title ? `「${f.title}」` : ''}`;
      if (n <= MAX_REWRITES) {
        retry.push(f.dup ? `${head}：${f.errors[0].msg}` : `${head}有写法错误，没有显示：\n${f.errors.map((p, i) => `  ${i + 1}. ${p.kind}：${p.msg}`).join('\n')}`);
        asks.push(f.dup ? `用一个没用过的新 id 重新写这一段（黑板上的 ${f.id} 不动）` : `board replace id=${f.id}`);
        if (!f.dup) kinds.push(...f.errors.map((p) => p.kind).filter(Boolean));
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
    for (const o of boardOps) {
      if (o.op === 'mark' || o.op === 'unmark') {
        if (o.error) notes.push(o.ok ? `指令 ${o.op} 有的没执行：${o.error}` : `指令 ${o.op}${o.id ? ` ${o.id}` : ''} 没执行：${o.error}`);
        continue;
      }
      if (!o.ok && !['add', 'new', 'replace', 'pin'].includes(o.op)) notes.push(`指令 ${o.op}${o.action ? ' ' + o.action : ''} ${o.id || ''} 没执行：${o.error}`);
    }
    // 说的话里算不出来的 \calc：学生看到的是一个红框
    const talkErr = talkPage ? [...(pages.get(talkPage)?.talkEl?.querySelectorAll('.calc-error') || [])].map((x) => x.dataset.calcError) : [];
    if (talkErr.length) notes.push(`你说的话里有 ${talkErr.join('；')}（学生看到的是红框；下一轮说话时改过来）`);
    for (const r of rejected) notes.push(`有一个 board 块看不懂（${r.error}），已经当普通文字写在板顶了：board ${r.header.slice(0, 60)}`);
    for (const u of unclosed) notes.push(`有一个 board 块没有闭合，已经当普通文字写在板顶了：board ${u.header.slice(0, 60)}${res.truncated ? '（这一轮太长被截断了，下次写短一点）' : ''}`);
    return { retry, asks: [...new Set(asks)], notes, kinds };
  }
  // 和 parseOutput 的 ops 同一个口径：闭合了、看得懂的 board 块
  function isOp(s) { return s.type === 'board' && s.closed && s.op && !s.op.error; }

  // 这一轮没成功（停止、出错）：课后复原时要看得出这里断过，所以也记一条作废的记录；不进对话历史
  // cost：这次调用花了多少。没发出去的（没权限、太频繁、太长、图被拒……）不算
  const NOT_SENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'rate_limited', 'session_expired', 'prompt_too_large', 'image_rejected', 'images_unavailable', 'tools_unavailable']);
  function failTurn(e, what = '这一轮', cost = undefined) {
    const code = String(e?.code || 'unknown');
    addTurn({ role: 'system', kind: 'error', discarded: true, code, text: `${what}没成功（${code === 'cancelled' ? '学生点了停止' : code}），Claude 的输出没有用`, cost: cost && !NOT_SENT.has(code) ? cost : undefined });
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
  // keepTalk：这一轮只是重写写错的段，说的话不会换到板顶上，原来那句话照常露着、也不预览这一轮的话
  function ensureDraft({ keepTalk = false } = {}) {
    const host = pages.get(bv.cur) || null;
    if (draft && draft.host === (host?.n || 0)) return draft;
    clearDraft();
    const box = document.createElement('div');
    box.className = 'class-draft';
    box.innerHTML = '<div class="class-draft-talk" hidden></div><div class="class-draft-ops" hidden></div>';
    box.prepend(bar.indicator);
    if (host) { host.talkEl.before(box); if (!keepTalk) host.sec.classList.add('is-drafting'); }
    else hero.appendChild(box);
    draft = { box, host: host?.n || 0, keepTalk, talk: box.querySelector('.class-draft-talk'), ops: box.querySelector('.class-draft-ops') };
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
        const talk = d.keepTalk ? '' : segments.filter((s) => s.type === 'speech').map((s) => s.text).join('\n\n').trim();
        d.talk.hidden = !talk;
        if (talk) d.talk.innerHTML = mdToHtml(previewMd(talk));
        const ops = segments.filter((s) => s.type === 'board');
        d.ops.hidden = !ops.length;
        if (ops.length) d.ops.innerHTML = ops.map(opChip).join('');
        bv.scheduleFit();
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
        : op.op === 'figure' ? `让图 ${escapeHtml(op.target || '')} 动一下` : op.op === 'mark' ? `在 ${escapeHtml(op.target || '板')} 上圈一下` : op.op === 'unmark' ? '擦掉标注' : '写黑板';
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
    bv.scheduleFit();
  }

  // 学习台里：每一轮带着的记忆（页面一直订阅着记忆库，拼摘要在 prompt.js）
  function memoryArg() {
    return desk ? { mem: desk.mem, block: desk.block, session: desk.sid } : null;
  }

  // 工具记下的观察、失误：确认是 Opus 5.5 讲的这一轮才写。学习台里写进记忆库（observations、slips），单独的课堂写进 class_notes
  let slipSeq = 0;
  function saveNotes(staged) {
    for (const n of staged.notes) {
      if (desk) sink.put('observations', observationRecord({ kind: n.kind, text: n.text, about: n.about, session: desk.sid, block: desk.block, turn: turnSeq + 1 }));
      else sink.put('class_notes', { kind: 'note', text: n.text, at: Date.now(), turn: turnSeq + 1 });
    }
    if (desk) {
      for (const sl of staged.slips) {
        slipSeq = Math.max(slipSeq, ...(desk.mem.slips || []).map((x) => Number(String(x.id).match(new RegExp(`^S-${desk.sid.slice(2)}-(\\d+)$`))?.[1]) || 0));
        sink.put('slips', slipRecord({ ...sl, session: desk.sid }, ++slipSeq));
      }
    }
  }

  // 一个组件的全部作答：单独的课堂在 answers 里；学习台里在这节课的 evidence 里（组件 id 是 comp）
  async function answersOf(blockId) {
    if (!desk) return (await db.collection('answers').where('block', '==', blockId).get()).docs.map((d) => d.data());
    const s = await db.collection('evidence').where('session', '==', desk.sid).get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.src === 'record' && d.comp === blockId).map((d) => ({ ...fromEvidence(d).rec, id: d.id }));
  }

  // memory_read 查证据：按块或者按节课，最近的 30 条，一条一行要点
  async function evidenceRows({ block, session: sid, id }) {
    if (id) {
      const s = await db.collection('evidence').doc(String(id)).get();
      if (!s.exists) throw new Error(`evidence 里没有 ${id}`);
      return { collection: 'evidence', doc: s.data() };
    }
    const [k, v] = block ? ['block', String(block)] : ['session', String(sid || desk.sid)];
    const s = await db.collection('evidence').where(k, '==', v).get();
    const rows = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-30)
      .map((d) => ({ id: d.id, at: d.at, session: d.session, kind: d.kind, comp: d.comp || undefined, ok: d.ok ?? undefined, q: typeof d.q === 'string' ? d.q.slice(0, 120) : undefined, text: typeof d.text === 'string' ? d.text.slice(0, 200) : undefined, value: d.value ?? undefined, tags: d.tags }));
    return { collection: 'evidence', [k]: v, count: rows.length, items: rows };
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
          const list = await answersOf(blockId);
          return list.sort((a, b) => a.at - b.at).slice(-30).map((a) => ({
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
          const s = await db.collection(desk ? 'evidence' : 'answers').doc(answerId).get();
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
      desk ? {
        name: 'lesson_note',
        description: '记一条给课后看的观察，存进学习台的 observations，项目对话里的 Claude 课后会读。kind：note 是观察（比如学生反复出现的错误），proposal 是提议（弱点、掌握、复现这些你不能改，看到该改的就提议，比如「W19 这节课两次都对了，可以考虑降一级」）。about 写相关的编号（W19、L2-07、L2.2.1#tr……）。',
        inputSchema: { type: 'object', properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['note', 'proposal'] }, about: { type: 'array', items: { type: 'string' } } }, required: ['text'] },
        async execute(input) {
          const text = String(input?.text ?? '').trim().slice(0, 2000);
          const kind = input?.kind === 'proposal' ? 'proposal' : 'note';
          const about = Array.isArray(input?.about) ? input.about.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : [];
          staged.calls.push({ name: 'lesson_note', input: { text, kind, about: about.length ? about : undefined } });
          if (!text) throw new Error('要写 text');
          staged.notes.push({ text, kind, about });
          return kind === 'proposal' ? '记下了这条提议，课后由项目对话里的 Claude 决定采不采纳。' : '记下了，下课后给项目对话里的 Claude 看。';
        },
      } : {
        name: 'lesson_note',
        description: '记一条给课后看的观察（比如学生反复出现的错误），项目对话里的 Claude 课后会读。',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute(input) {
          const text = String(input?.text ?? '').trim().slice(0, 2000);
          staged.calls.push({ name: 'lesson_note', input: { text } });
          if (!text) throw new Error('要写 text');
          staged.notes.push({ text, kind: 'note' });
          return '记下了，下课后给项目对话里的 Claude 看。';
        },
      },
      ...(desk ? [{
        name: 'slip_note',
        description: '记一条你自己这节课的教学失误（比如「一次写了三块板没等学生答」「小问的答案就印在板上」），存进学习台的 slips，以后上课会提醒你别再犯。text 写失误，lesson 写下次怎么做。',
        inputSchema: { type: 'object', properties: { text: { type: 'string' }, lesson: { type: 'string' } }, required: ['text'] },
        async execute(input) {
          const text = String(input?.text ?? '').trim().slice(0, 1000);
          const lesson = String(input?.lesson ?? '').trim().slice(0, 500);
          staged.calls.push({ name: 'slip_note', input: { text, lesson: lesson || undefined } });
          if (!text) throw new Error('要写 text');
          staged.slips.push({ text, lesson });
          return '记下了。';
        },
      }, {
        name: 'memory_read',
        description: '查学习台的记忆库（只读）。collection 写集合名：rules、profile、curriculum、errors、weaknesses、mastery、reviews、position、slips、observations、evidence。写 id 查一条的全文（比如 errors 的 L2-07、curriculum 的 L2.2.1）；不写 id 时列出这一类（可以写 block 只要挨着这一块的）。evidence 按 block 或 session（这节课是 ' + desk.sid + '）查最近的 30 条。每调用一次你要多等一整轮，只在记忆摘要里没有、又确实需要时用。',
        inputSchema: { type: 'object', properties: { collection: { type: 'string' }, id: { type: 'string' }, block: { type: 'string' }, session: { type: 'string' } }, required: ['collection'] },
        async execute(input) {
          const q = { collection: String(input?.collection ?? '').trim(), id: input?.id, block: input?.block, session: input?.session };
          staged.calls.push({ name: 'memory_read', input: Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) });
          const r = memoryRead(desk.mem, q);
          if (!r.needDb) return r;
          return evidenceRows(q);
        },
      }] : []),
      {
        name: 'view_image',
        description: '把资料包里的一张讲义原图（images 里的 name）附在下一条消息里给你看。每用一次你要多等一整轮；只在要照着原图讲、但资料包的文字说不清的时候用。要贴上黑板给学生看，用 image 组件。',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        async execute(input) {
          const name = String(input?.name ?? '').trim();
          staged.calls.push({ name: 'view_image', input: { name } });
          const list = session.packImages || [];
          const img = list.find((x) => String(x.name) === name);
          if (!img) throw new Error(`资料包里没有叫「${name}」的图${list.length ? `（有的是：${list.map((x) => x.name).slice(0, 8).join('、')}）` : ''}`);
          const url = img.src || img.url || (img.id ? assetUrl(String(img.id)) : '');
          if (!url) throw new Error('这张图没有地址');
          if (staged.images.length >= maxImages) throw new Error(`这一轮已经附了 ${maxImages} 张图`);
          const r = await fetch(url);
          if (!r.ok) throw new Error('图没取到');
          const blob = await r.blob();
          if (!/^image\//.test(blob.type)) throw new Error('这不是一张图');
          staged.images.push(blob);
          staged.ids.push(String(img.id || name));
          return { name, title: img.title || '', attachedNextMessage: 1 };
        },
      },
      {
        name: 'component_doc',
        description: '取一个组件的完整写法（课堂说明里有的组件只写了最常用的写法，末尾写着「更多写法」）。name 写组件名，比如 elim、sched、answer。每调用一次你要多等一整轮，只在要用说明里没写到的字段时用；照精简版写错了，页面会自动把完整写法附在提醒里，不用先查。',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        async execute(input) {
          const name = String(input?.name ?? '').trim();
          staged.calls.push({ name: 'component_doc', input: { name } });
          if (!name) throw new Error('要写 name（组件名）');
          return docLookup(COMPONENT_DOCS, session.subject, name);
        },
      },
      {
        name: 'calc',
        description: '精确地算一个表达式（分数不丢精度；det、inv、rank、rref、tr 都是精确的），返回结果的文字和 TeX。可以用这节课 let 块里定义的量；vars 里可以临时给几个量（值写成表达式，比如 {"A": "[[1, 2], [3, 4]]"}）。注意：每调用一次工具，你都要多等一整轮（整份课堂说明重读一遍），很慢。只在改数出新题、得先知道结果才能决定怎么出题时用；要写上黑板的数，直接在公式里写 \\calc{表达式}，页面会算好再写上去，不用先调这个工具。',
        inputSchema: { type: 'object', properties: { expr: { type: 'string' }, vars: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['expr'] },
        async execute(input) {
          const expr = String(input?.expr ?? '').trim();
          const given = input?.vars && typeof input.vars === 'object' ? input.vars : {};
          staged.calls.push({ name: 'calc', input: { expr: cut(expr, 300), vars: Object.keys(given).length ? given : undefined } });
          if (!expr) throw new Error('要写 expr（表达式）');
          const scope = { ...session.vars };
          for (const [k, src] of Object.entries(given)) {
            if (!/^[A-Za-z_][\w]*$/.test(k)) throw new Error(`变量名「${k}」只能用字母、数字和下划线`);
            scope[k] = calcValue(String(src), scope).value;
          }
          const r = calcValue(expr, scope);
          return { text: r.text, tex: r.tex, exact: r.exact };
        },
      },
    ];
    // 附图的工具（看手写原图、看讲义原图）：这个查看方式发不了图、或者这一轮已经补发过图，就不给
    return view && teacher.images ? tools : tools.filter((t) => t.name !== 'view_handwriting' && t.name !== 'view_image');
  }

  // —— 下课：让课堂 Claude 写一份小结，存进 class_notes（同样只收 Opus 5.5 写的），写在最后一块板上 ——
  function endClass() {
    if (busy) { toast('等 Claude 说完这一轮再下课'); return; }
    if (!history.length) { toast('还没开始上课'); return; }
    if (!teacher.available) return;
    exclusive(async () => {
      // 学习台里：下课那一刻还没提交的草稿记成证据（写了一半的不丢）。小结没写成、再点下课时，没变的草稿不重复记
      if (desk) for (const d of allDrafts()) sink.put('evidence', draftEvidence(d, evCtx(d.step)));
      bar.setStatus('thinking', 'Claude 在写这节课的小结…');
      ensureDraft();
      ctl = new AbortController();
      const steps = () => [...segs.values()].map((x) => ({ id: x.id, page: x.page, title: x.title || x.sec?.querySelector('h2')?.textContent?.trim() || '', place: x.place }));
      // 学习台里：先用代码算一份课后报告放进这次的输入，小结和整理单同一次写（docs/desk-plan.md 4.2，不多调用一次）
      const report = desk?.makeReport ? await desk.makeReport({ turns: history, steps: steps() }).then(reportText, () => '') : '';
      const system = buildSystem({ rules: pack.main?.rules, componentDocs: COMPONENT_DOCS, pack, board: boardState(), subject: session.subject, memory: memoryArg() });
      const fit = fitTurns({ system, history: [...promptHistory(history), { role: 'system', text: closingPrompt({ report }) }], maxBytes: promptLimit() });
      const cost = (why) => callCost({ bytes: fit.bytes, why });
      let res;
      try {
        res = await teacher.call(fit.turns, { ...TEACH, cache: false, signal: ctl.signal });
      } catch (e) {
        failTurn(e, '下课小结', cost('failed'));
        return false;
      }
      if (res?.modelApplied !== MODEL) {
        addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，下课小结作废', modelApplied: res?.modelApplied || null, modelTierApplied: res?.modelTierApplied || null, cost: cost('failed') });
        bar.setStatus('error', 'Opus 5.5 暂时用不了，小结没写成，稍后再点「下课」。');
        return false;
      }
      clearDraft();
      // 小结那块板的最后一行由页面写：这节课的讲课是不是都由 Opus 5.5 回答（平台核验），作废了几轮
      const v = verifyCounts();
      v.turns++; // 这份小结本身也是 Opus 5.5 写的
      // 学习台里：整理单写在 memo 块里，小结正文是 memo 块以外的文字
      let summary = res.text;
      let memoEntries = [];
      if (desk?.memo) {
        const out = parseOutput(res.text, { final: true });
        const memos = out.ops.filter((o) => o.op === 'memo');
        if (memos.length) {
          memoEntries = memos.flatMap((o) => o.entries);
          summary = out.segments.filter((x) => x.type === 'speech').map((x) => x.text).join('\n\n').trim() || res.text;
        }
      }
      if (desk) {
        const ob = observationRecord({ kind: 'summary', text: summary, session: desk.sid, block: desk.block, turn: turnSeq + 1, verify: v });
        await sink.put('observations', ob);
        desk.updateSession({ status: 'closed', endedAt: Date.now(), summary: ob.id, verify: v });
      } else {
        await sink.put('class_notes', { kind: 'summary', text: res.text, at: Date.now(), turn: turnSeq + 1, verify: v });
      }
      const foot = mock ? `（本地测试：${v.turns} 轮都是模拟老师回放的，没有调用 Claude。）`
        : `这节课 ${v.turns} 轮讲课和小结全部由 Opus 5.5 回答（平台核验）${v.discarded ? `；另有 ${v.discarded} 轮平台换了别的模型，已作废、没有显示` : ''}。`;
      const p = newPage({ title: '这节课的小结', kind: 'closing', body: summary, foot });
      const closed = addTurn({ role: 'system', kind: 'closing', text: res.text, modelApplied: res.modelApplied, page: p.n, cost: cost('closing') });
      bv.show(p.n, { animate: true });
      // 整理单：直接写的马上写，等确认的挂在小结下面让我逐条点
      const memo = memoEntries.length ? await runMemo(memoEntries, closed.seq, p.n) : null;
      // 课后报告（memory/report.js，页面代码算，不调用 Claude）：sessions/{编号}/report/main
      if (desk?.writeReport) desk.writeReport({ turns: history, steps: steps() }).catch((e) => { console.warn('课后报告没写成', e); toast('课后报告没写成，回学习台首页会再试'); });
      const open = memo?.pds.filter((x) => x.status === 'open').length || 0;
      bar.setStatus('notice', !desk ? '下课了。小结已经存好，回对话告诉 Claude「下课了」。'
        : open ? `下课了。小结和课后报告存进学习台了；小结下面的整理单有 ${open} 条等你确认。` : '下课了。小结和课后报告已经存进学习台。');
      session.event('end', null, { turns: history.length });
      return true;
    });
  }

  // —— 板上手写：学生用 Pencil 在当前板（和常驻栏）上新写的板书，跟着下一条消息导出成图发给课堂 Claude ——
  // 笔画的坐标是相对各自那一段的；按段在板上的位置挪到一张图里，排列和黑板上一样。返回 { blobs, line } 或 null
  async function freshInk(room) {
    const api = window.LAKit?.ink;
    if (!api || !inkSeeded || room <= 0) return null;
    const fresh = api.strokes.filter((s) => !toldInk.has(s) && inkPlace(s));
    if (!fresh.length) return null;
    const groups = [];
    const pageEl = pages.get(bv.cur)?.sec;
    const anchorOf = (a) => (a === `p${bv.cur}` ? pageEl : segs.get(a)?.sec);
    for (const [where, host] of [['board', pageEl], ['pin', root.querySelector('.class-pins')]]) {
      if (!host || !host.getClientRects().length) continue;
      const hb = host.getBoundingClientRect();
      const list = [], orig = [];
      const names = new Set();
      for (const s of fresh) {
        const el = anchorOf(s.a);
        if (!el || el.hidden || !host.contains(el)) continue;
        if (inkPlace(s) !== where) continue;
        const seg = segs.get(s.a);
        const r = el.getBoundingClientRect();
        const dx = r.left - hb.left, dy = r.top - hb.top;
        // 笔画的点是一串 x, y, r, x, y, r…
        list.push({ ...s, pts: s.pts.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v)), bbox: [s.bbox[0] + dx, s.bbox[1] + dy, s.bbox[2] + dx, s.bbox[3] + dy] });
        orig.push(s);
        if (seg) names.add(`${seg.id}${seg.title ? `「${seg.title}」` : ''}`);
      }
      if (list.length) groups.push({ where, list, orig, names: [...names] });
    }
    // 真导出成图的才记成「发过了」：图位不够（room）或导出失败的留着，下一条消息再发
    const blobs = [], sent = [];
    for (const g of groups.slice(0, room)) {
      try {
        const b = await strokesToBlob(g.list);
        if (b) { blobs.push(b); sent.push(g); g.orig.forEach((s) => toldInk.add(s)); }
      } catch (e) { console.warn('板书没导出来', e); }
    }
    if (!blobs.length) return null;
    const where = sent.flatMap((g) => (g.where === 'pin' ? ['常驻栏'] : g.names.length ? g.names : [`第 ${bv.cur} 块板`]));
    return { blobs, line: `[板书] 学生用 Pencil 在黑板上写了东西（写在 ${[...new Set(where)].join("、")}上），附在这一轮：${blobs.length} 张图，白底黑字，只有学生的笔迹，排列和黑板上一样。` };
  }

  // 一笔板书写在哪：当前板 'board'、常驻栏 'pin'；翻回旧板写的（和撤回了的段上的）不发，返回 null
  function inkPlace(s) {
    if (s.a === `p${bv.cur}`) return 'board';
    const seg = segs.get(s.a);
    if (!seg?.sec || seg.hidden) return null;
    if (seg.place === 'pin') return 'pin';
    return seg.page === bv.cur ? 'board' : null;
  }
  // 有没有这次上课新写、还没发给课堂 Claude 的板书（输入条的发送键据此亮起；查看方式发不了图时不算）
  function hasFreshInk() {
    const api = window.LAKit?.ink;
    return !!(teacher.images && inkSeeded && api?.strokes?.some((s) => !toldInk.has(s) && inkPlace(s)));
  }

  // —— 察觉卡住：当前板上有题没做、学生很久没动静，提醒课堂 Claude 轻轻问一句（stuck.js）——
  for (const ev of ['pointerdown', 'keydown', 'input', 'wheel']) document.addEventListener(ev, () => { lastActive = Date.now(); }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { lastActive = Date.now(); });
  // 当前板上等着学生的组件：还没作答的题、走到一半的 steps、还没交的练习
  const WAITING = new Set(['answer', 'steps', 'predict', 'practice', 'quiz', 'conjecture', 'recognize', 'findbug', 'sortpass']);
  function waitingBlocks() {
    const out = [];
    for (const seg of segs.values()) {
      if (seg.hidden || seg.failed || seg.pending || !seg.sec || seg.place === 'pin' || seg.page !== bv.cur) continue;
      for (const b of seg.sec.querySelectorAll('.block[data-bid]')) {
        const kind = [...b.classList].find((c) => c.startsWith('block-'))?.slice(6) || '';
        if (!WAITING.has(kind)) continue;
        const busyHere = b.querySelector('.st-item.is-current, .ans-check:not(:disabled), .pred-go:not(:disabled)');
        if (busyHere || !(results.get(b.dataset.bid) || []).length) out.push({ id: b.dataset.bid, kind, seg: seg.id });
      }
    }
    return out;
  }
  // 本地试用可以把等待时间改短：?dev&stuck=8（秒）
  const stuckMs = (dev && Number(/[?&]stuck=(\d+)/.exec(location.search)?.[1]) * 1000) || STUCK_MS;
  setInterval(() => {
    const waiting = waitingBlocks();
    if (!shouldNudge({ now: Date.now(), lastActive, waiting, nudged, enabled: stuckOn, busy, hidden: document.hidden, started: started && teacher.available && bv.view === bv.cur, limit: stuckMs })) return;
    nudged = true;
    queue.actions.push({ source: 'page', type: 'stuck', text: stuckText({ minutes: Math.max(1, Math.round(stuckMs / 60000)), waiting }) });
    queue.triggered = true;
    schedule(true);
  }, Math.min(15000, Math.max(1000, stuckMs / 4)));

  window.LAKit = {
    ...(window.LAKit || {}),
    classroom: {
      history, segs, pages, queue, boardState, flush, retry: retryRun, showPage: (n) => bv.go(n), measureFit: bv.measureFit,
      runClaude: () => exclusive(async () => converse()),
      get busy() { return busy; },
      get curPage() { return bv.cur; },
      get viewPage() { return bv.view; },
      get pending() { return pendingTurn(history); },
      get lastPrompt() { return lastPrompt; },
      get budgetLevel() { return budgetLevel; },
    },
  };
  refresh();
}
