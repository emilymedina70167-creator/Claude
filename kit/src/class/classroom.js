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
import { link } from '../link.js';
import { getAI, errorText, laned } from '../ai.js';
import { getStore, isDev, assetUrl } from '../live/store.js';
import { createSink } from '../live/sync.js';
import { copyRecord, toast } from '../record.js';
import { parseOutput, PLAN_MAX } from './protocol.js';
import {
  buildSystem, actionText, actionsMessage, fitTurns, needsCompaction, compactionPrompt, summaryTurn, closingPrompt,
  reportable, actionTrigger, promptHistory, pendingTurn, nextSegmentId, nextPinId, bytes, PACK_BUDGET, compactionSlice, worthCompacting, draftLine,
  lintDocs, docLookup, latestPlan,
} from './prompt.js';
import { FEATURES } from '../features.js';
import { specFor, specKey, specDiff, SPEC_DELAY } from './spec.js';
import { draftsIn } from '../drafts.js';
import { COMPONENT_DOCS } from './docs.js';
import { createDevTeacher } from './devteacher.js';
import { createClassBar, MODEL_TAG } from './bar.js';
import { createBoardView } from './boardview.js';
import { extraProblems } from './selfcheck.js';
import { initClassDevPanel, ensureDemoSlide } from './devpanel.js';
import { createBoardTools, applyAssigns } from './boardtools.js';
import { markText } from '../markspec.js';
import { calcValue, exactText } from '../exact.js';
import { strokesToBlob } from '../ink/engine.js';
import { shouldNudge, stuckText, STUCK_MS } from './stuck.js';
import { fromEvidence, sayEvidence, draftEvidence, observationRecord, slipRecord, memoryRead } from '../memory/session.js';
import { callCost, usageOf, usageText } from './usage.js';
import { reportText } from '../memory/report.js';
import { debriefText } from '../memory/debrief.js';
import { earlierClasses } from '../memory/digest.js';
import { choose } from '../dialog.js';
import { lessonSheet, sheetMd } from '../memory/sheet.js';
import { slipsToFold, blockSwitch, tidyDue, tidyText } from '../memory/memo.js';
import { spaceOfId, subjectOf } from '../memory/space.js';
import { textbookForClass, readChunks, searchChunks, readHistory } from '../books/textbook.js';
import { planLocal, markFired, reactNote, armedText, rebuildRules, dropForSeg } from './react.js';
import { beatPlan, shouldPlay, DEFERRED_OPS } from './beats.js';
import { ENGINES } from '../engines/registry.js';
import { bandsOf, layoutText } from './canvas.js';
import { askMessage, matchWhy, spotText, whyShownText } from './ask.js';
import { createAskHere } from './askhere.js';

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
 * updateSession(patch)（改 sessions/{sid}）, writeReport({ turns, steps })（下课后写课后报告）, onHome（回学习台首页）,
 * readOnly（「以前的课」翻看黑板：store 是只读的，不调用 Claude，不能发言）}
 */
// 版面里不并排的组件、角上带 ⤢ 放大的组件
const WIDE_NO = new Set(['scene', 'graph', 'space', 'image', 'sketch', 'predict']);
const ZOOMABLE = new Set([...WIDE_NO, 'matrix', 'derive', 'code', 'trace', 'frames']);

export async function renderClass(root, meta, desk = null) {
  // 版面模式（canvas.js，docs/canvas-plan.md）：课堂 Claude 自己排板。先在开关后面试：features.js 的 canvas，或地址带 ?canvas
  const CANVAS = FEATURES.canvas || /[?&]canvas\b/.test(location.search);
  if (CANVAS) { root.classList.add('is-canvas'); document.body.classList.add('class-canvas'); }
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
    onBeat: (n, k) => beatGo(n, k),
    canvas: CANVAS,
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
  const mockLaned = laned((input, opts) => mock(input, opts));
  // 验收脚本、浏览器里的测试读模拟老师的记录（调用过什么、工具的结果）
  if (mock) window.LAKitEval = { teacher: mock };
  // 旧版接口（window.claude.complete）不能指定模型、也不说是谁答的：每一轮都只能作废，干脆不开课
  const legacy = !mock && !!ai?.legacy;
  const off = { tools: false, images: false }; // 这个查看方式明确说了不支持的（tools_unavailable / images_unavailable）
  const readOnly = !!desk?.readOnly;
  const teacher = {
    get available() { return !readOnly && !!(mock || (ai?.call && !legacy)); },
    // 模拟老师也走调用让路（lane.js；ai.call 自己已经走了）
    call: (input, opts) => (mock ? mockLaned(input, opts) : ai.call(input, opts)),
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
  let raf = 0, pendingText = '', pendingStatus = ''; // 草稿：一帧最多画一次
  let firstAt = 0; // 这一次调用黑板上出现第一个字的时候（performance.now）
  // 抢跑（spec.js）：{ say, key, ctl, promise, text（已经写出来的）, onText（接上以后画黑板的）, staged, bytes }
  let spec = null;
  let specTimer = null;
  let ended = false; // 下课小结写过了：之后不再抢跑
  let stream = null; // 边写边显示：这一轮先画出来的段（streamOps）
  let streamPage = null; // 核验过了：先开的那块新板留着，finishTurn 的 board new 直接用它
  let committing = false; // finishTurn 正在把先画出来的段换成正式的：正式的不再播淡入（不闪一下）
  let lastVerify = { turns: 0, discarded: 0 }; // 学习台里：上次写进 sessions/{编号} 的核验轮数
  let lastUsage = ''; // 学习台里：上次写进 sessions/{编号} 的花费
  let turnMemos = []; // 这一轮 memo 块里读懂的条目（执行完黑板指令、记下这一轮以后再写进记忆库）
  // 预案（react.js，docs/board-plan.md）：组件 id → { target, seq（哪一轮写的）, seg（组件所在的段）, by, cases }
  const reacts = new Map();
  const trigs = new WeakMap(); // 排着的动作 → actionTrigger 算的（'later' 的是学生在看、在试，不用老师）
  let opTurn = { seq: 0, by: '' }; // 正在执行的这一轮（预案记它是哪一轮、谁写的）
  // 拍子（beats.js）：正在播的这一轮。{ page, n（几拍）, max（播到第几拍）, segs: 拍 → [段 id], deferred: [{ b, op }], told（这一轮的记录）}
  let beat = null;
  const whys = new Map(); // 预写的「为什么」（board why）：段 id / 组件 id → [{ where, text }]
  // 每条「为什么」挂在哪一段、哪一轮写的：段被改写 / 撤回时，之前几轮写的跟着作废（不然点「为什么」当场显示旧题的依据）
  const whySeg = new Map();
  const setWhy = (target, items, seg, seq) => { whys.set(target, items); whySeg.set(target, { seg: seg || target, seq }); };
  const dropWhys = (segId, seq) => { for (const [k, v] of whySeg) if (v.seg === segId && v.seq < seq) { whys.delete(k); whySeg.delete(k); } };

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
    onQuick: (label) => {
      if (busy) return;
      // 「继续」：这一轮还有没播的拍子时只走下一拍，不调用 Claude
      if (label === '继续' && beat && !beat.done) { bv.go(beat.page); beatGo(beat.page, (pages.get(beat.page)?.beat ?? beat.max) + 1); return; }
      bv.go(bv.cur);
      enqueueStudent(QUICK_SAY[label] || label, [], true);
    },
    onNav: (n) => bv.go(n),
    onStop: () => ctl?.abort(),
    onRetry: () => retryRun(),
    onEnd: () => endClass(),
    onCopy: () => copyRecord(toast),
    onHome: desk?.onHome || null,
  });
  bv.attachBar(bar);
  // 点着问（askhere.js）：点板上一行、一个公式、steps 的一步，问「为什么 / 没看懂 / 举个例子」；预写的「为什么」页面当场显示
  const askHere = readOnly ? null : createAskHere({
    board,
    onAsk: (spot, kind) => { if (teacher.available) enqueueStudent(askMessage(spot, kind), [], true); },
    onWhy: (spot) => matchWhy(whys, spot),
    onOther: (spot) => { bar.prefill(`[指着问] ${spotText(spot)}——`); bar.focus(); },
    onShown: (spot) => { const a = { source: 'page', type: 'why', text: whyShownText(spot) }; trigs.set(a, 'later'); queue.actions.push(a); lastActive = Date.now(); },
  });
  if (readOnly) {
    bar.setEnabled(false);
    bar.setStatus('notice', '这是以前的课：只能翻看。作答不会记下来，也不调用 Claude。');
  } else if (!teacher.available) {
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
    // 资料包点名的教材条目的原页图：image 组件写条目编号就能贴（books/textbook.js 的 textbookForClass）
    if (desk?.books) session.packImages.push(...textbookNow().images.map((x) => ({ name: x.name, id: x.id, title: x.title })));
    // 没点名的条目也能贴：image 组件写任何条目编号，取它的第一张原页图
    session.chunkImage = desk?.books ? (name) => { const c = desk.books.chunks.find((x) => x.id === name); return c?.img?.[0] ? { name, id: c.img[0], title: `${c.title}（原页${c.page ? ` p.${c.page}` : ''}）` } : null; } : null;
    if (mock && !session.packImages.length) { const demo = ensureDemoSlide(); if (demo) session.packImages = [demo]; }
  }
  // 学习台里的教材（desk.books）：点名条目的全文并进资料包的「教材原文」，目录作为资料包的一节；没有书就是原来的资料包
  function textbookNow(tools = true) {
    const b = desk?.books;
    if (!b?.chunks?.length) return { textbook: '', catalog: '', images: [] };
    const block = (desk.mem?.curriculum || []).find((x) => x.id === (desk.block || pack.main?.block));
    // 这节课取过的条目一直留着（只算 Opus 5.5 讲完的轮：作废的轮不进 history 的有效记录）
    const calls = history.filter((t) => t && !t.discarded && t.role === 'claude' && Array.isArray(t.tools)).flatMap((t) => t.tools);
    // 上一节同一块取过的（desk.prevRead）排在前面，这节课取的在后面（最近取的优先留着）
    const mine = calls.length ? readHistory(calls, b.chunks, b.books) : [];
    const read = [...(desk.prevRead || []).filter((id) => !mine.includes(id)), ...mine];
    return textbookForClass({ main: pack.main, block, books: b.books, chunks: b.chunks, tools, read });
  }
  function packForPrompt(tools) {
    const tb = textbookNow(tools);
    if (!tb.textbook && !tb.catalog && !earlier) return pack;
    const main = { ...(pack.main || {}) };
    if (tb.textbook) main.textbook = [main.textbook, tb.textbook].filter((x) => x && (typeof x !== 'string' || x.trim())).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n\n');
    if (tb.catalog) main['教材目录（按需取）'] = tb.catalog;
    if (earlier) main[EARLIER_LABEL] = earlier;
    return { ...pack, main };
  }
  syncPackImages();
  // 以前的课：开课时页面先取好（和 memory_read 取 sessions 给的一样），放进资料包，第一轮不用先取一整轮再开讲
  const EARLIER_LABEL = '以前的课（页面开课时替你取好的，和 memory_read 取 sessions 给的一样，不用再取）';
  // 记忆库是订阅着读进来的，刚开课时可能还没到：开课 2 秒后、或者第一次调用时再挑（只挑一次）
  let earlier = '';
  let earlierReady = null;
  const fetchEarlier = () => (earlierReady ??= desk && !readOnly ? (async () => {
    const ids = earlierClasses(desk.mem?.sessions || [], { session: desk.sid, block: desk.block });
    if (!ids.length) return;
    const { items } = await sessionRows(ids);
    earlier = items.filter((x) => !x.error).map((x) => [
      `### ${x.id}（${x.date || ''} ${x.block || ''}${x.status === 'closed' ? '' : '，没点下课'}）${x.title || ''}`,
      x.summary ? `- 小结：${String(x.summary).slice(0, 1500)}` : '',
      ...(x.notes || []).slice(0, 8).map((n) => `- ${String(n).slice(0, 300)}`),
      x.report ? `- 课后报告：\n${String(x.report).slice(0, 3000)}` : '',
      // 下课后的复盘（debrief.js）：误解消了没有、这节开头先测什么
      x.debrief ? `- 下课后的复盘（教研员通读整节课写的）：\n${x.debrief}` : '',
    ].filter(Boolean).join('\n')).join('\n\n');
  })().catch((e) => console.warn('以前的课没取到', e)) : Promise.resolve());
  if (desk && !readOnly) setTimeout(fetchEarlier, 2000);
  db.doc('pack/main').onSnapshot((s) => applyMain(s.exists ? s.data() : null), () => {});
  db.doc('pack/problems').onSnapshot((s) => { pack.problems = s.exists ? s.data() : null; }, () => {});

  // —— 恢复：资料包、黑板（板和段）、课堂记录、作答 ——
  await restore();
  syncUsage();
  session.event('open', null, { title: session.title, unit: unitName, mode: 'class' });
  // 打开页面之前写的板书（存在这台设备上）不再发：只发这次上课新写的
  for (const s of window.LAKit?.ink?.strokes || []) toldInk.add(s);
  inkSeeded = true;
  // 开课页：先按「开始上课」抢跑（以前的课取好、资料包读进来以后）
  if (!started && !readOnly) fetchEarlier().then(() => specSoon(1500));

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
        // 分拍播过的板顶那句话：刷新后停在最后一拍（段都已经露出来了），还能倒回去看前面几拍的话
        if (Array.isArray(d.beats) && d.beats.length > 1) Object.assign(p, { beats: d.beats.map(String), beat: d.beats.length - 1, beatFocus: [] });
        if (CANVAS && Array.isArray(d.cols) && d.cols.length) p.cols = d.cols.map(Number);
        if (d.sheet) p.sheet = String(d.sheet);
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
        const seg = { id: d.id, seq: d.seq || 0, page, place, title: d.title || '', md: String(d.md || ''), hidden: !!d.hidden, held: !!d.held, failed: !!d.failed, pending: false, sec: null, ...(d.point ? { point: d.point } : {}), ...(CANVAS && d.col !== undefined ? { col: d.col } : {}), ...(Number.isFinite(d.ord) ? { ord: d.ord } : {}) };
        segs.set(seg.id, seg);
        if (old) legacy.push(seg);
        if (!seg.hidden) mountRestored(seg);
      }
      for (const p of pages.values()) { bv.paint(p); layoutPage(p.n); }
      // 旧版的段分好板就存回去：以后新开的板接在它们后面，下次打开顺序也不变
      for (const seg of legacy) { saveSeg(seg); savePage(pages.get(seg.page)); }
      tu.docs.map((d) => d.data()).filter((t) => Number.isFinite(t?.seq)).sort((a, b) => a.seq - b.seq).forEach((t) => { history.push(t); turnSeq = Math.max(turnSeq, t.seq); });
      // 还没用掉的预案（组件还在黑板上的）
      for (const [k, r] of rebuildRules(history)) reacts.set(k, r);
      // 预写的「为什么」：按先后放回去（后写的盖掉先写的）
      for (const t of history) {
        if (t.role !== 'claude' || t.discarded) continue;
        for (const o of t.boardOps || []) {
          if (o?.op === 'why' && o.ok) setWhy(o.target, o.items || [], o.seg, t.seq);
          else if (o?.ok && ['replace', 'hide', 'unpin'].includes(o.op)) dropWhys(o.id, t.seq);
        }
      }
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
        else applyAssigns(api, e.args?.assigns);
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

  // 边写边显示时先开好的那块新板：核验过了就是它（不再另开一块）
  function adoptPage(p, op) {
    Object.assign(p, { title: op.title || '', ...(CANVAS ? { cols: op.cols || [1] } : {}) });
    delete p.preview;
    streamPage = null;
    bv.cur = p.n;
    bv.paint(p);
    savePage(p);
    return p;
  }

  function savePage(p) {
    sink.put('class_pages', { id: pad3(p.n), n: p.n, title: p.title || '', talk: p.talk || '', talkBy: p.talkBy || '', lead: p.lead || '', kind: p.kind || '', body: p.body || '', foot: p.foot || '', ...(p.memo?.length ? { memo: p.memo } : {}), ...(p.beats ? { beats: p.beats } : {}), ...(p.cols ? { cols: p.cols } : {}), ...(p.sheet ? { sheet: p.sheet } : {}), at: Date.now() });
  }

  // —— 学习台里改记忆（memory/memo.js）：都直接写进去了，上课时板上什么都不挂（不打扰学生）；
  // 下课小结那块板上只有一行小字「这节课记下了……」，点开才一条条看、能撤销（2026-11-03：一节课结束甩几十条没必要）——
  function decoratePage(p) {
    if (!desk?.memo) return;
    const ids = p.kind === 'closing' ? p.memo || [] : [];
    let el = p.sec.querySelector(':scope > .class-memo, :scope > .class-page-body > .class-memo');
    if (!ids.length) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'class-memo';
      const closing = p.kind === 'closing' && p.bodyEl.querySelector(':scope > .class-closing');
      if (closing) closing.after(el);
      else p.talkEl.after(el);
    }
    desk.memo.view.attach(el, () => p.memo || [], { mode: 'line' });
  }

  // 执行一轮里的 memo 块：都直接写；没记成的告诉课堂 Claude（不多跑一轮：跟着下一轮的提醒）
  async function runMemo(entries0, seq, pageN) {
    // 改讲别的块：页面自己改（sessions 记下来，之后的证据、记忆摘要都按新的块），不进改动单
    const switches = entries0.filter((e) => e.kind === 'block');
    const entries = entries0.filter((e) => e.kind !== 'block');
    for (const e of switches) {
      const r = blockSwitch(e, { mem: desk.mem, block: desk.block, space: desk.space });
      if (r.error) { addTurn({ role: 'system', kind: 'note', text: `[系统] memo 里「${e.line}」没生效：${r.error}` }); continue; }
      const was = desk.block;
      desk.block = r.block;
      desk.blocks = [...new Set([...(desk.blocks || [was].filter(Boolean)), r.block])];
      // 同一科换了门课（DS- → OS-）：组件说明、教法跟着换成那门课的
      session.subject = subjectOf(r.block);
      desk.space = spaceOfId(r.block);
      desk.updateSession({ block: r.block, blocks: desk.blocks, subject: session.subject });
    }
    if (!entries.length) return { pds: [], rejected: [] };
    try {
      const r = await desk.memo.ops.applyMemo(entries, { session: desk.sid, block: desk.block, space: desk.space, turn: seq });
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
  // beats：这一轮分拍播时每一拍的话（板顶一次只显示一拍，boardview.js 画「‹ 2 / 4 下一拍 ›」）
  function setTalk(p, md, by = '', beats = null) {
    const talk = String(md || '').trim();
    const list = Array.isArray(beats) && beats.length > 1 ? beats : null;
    if (p.talk === talk && p.talkBy === by && !list && !p.beats) return false;
    p.talk = talk;
    p.talkBy = by;
    p.beats = list;
    p.beat = list ? 0 : undefined;
    p.beatFocus = list ? [] : undefined;
    bv.paint(p);
    savePage(p);
    return true;
  }

  // —— 拍子：一拍一拍地播（docs/board-plan.md 第 2 节）——
  // 一拍要指给学生看的段：这一拍写的、圈的、让动的、揭开的
  function focusOf(ops) {
    const ids = [];
    for (const o of ops || []) {
      if (!o?.ok) continue;
      if (['add', 'new', 'replace', 'pin', 'show'].includes(o.op)) ids.push(o.id);
      else if (o.op === 'mark' || o.op === 'figure') {
        const t = o.target || o.id;
        const seg = segs.has(t) ? t : board.querySelector(`[data-bid="${CSS.escape(String(t || ''))}"]`)?.closest('[data-step]')?.dataset.step;
        if (seg) ids.push(seg);
      }
    }
    return [...new Set(ids)];
  }

  // 播到第 b 拍：这一拍写的段露出来，推迟的指令（圈、让图动、擦掉）现在执行，记进这一轮的 boardOps
  function revealBeat(b) {
    if (!beat || b <= beat.max || b >= beat.n) return;
    beat.max = b;
    for (const id of beat.segs.get(b) || []) {
      const sec = segs.get(id)?.sec;
      if (!sec) continue;
      sec.classList.remove('beat-wait');
      if (!reduceMotion()) sec.classList.add('beat-in');
    }
    const notes = [];
    const ran = beat.deferred.filter((d) => d.b === b).map((d) => execOp(d.op, [], notes));
    for (const o of ran) if (!o.ok || o.error) notes.push(`指令 ${o.op}${o.action ? ` ${o.action}` : ''} ${o.id || o.target || ''} 没执行：${o.error || ''}`);
    const p = pages.get(beat.page);
    if (p?.beatFocus) p.beatFocus[b] = [...(beat.segs.get(b) || []), ...focusOf(ran)];
    if (beat.told && ran.length) {
      beat.told.boardOps = [...(beat.told.boardOps || []), ...ran];
      sink.put('class_turns', { id: pad6(beat.told.seq), ...beat.told });
    }
    if (notes.length) addTurn({ role: 'system', kind: 'note', text: `[系统] ${[...new Set(notes)].join('\n')}` });
    if (beat.max >= beat.n - 1) beat.done = true;
  }

  // 学生点「‹」「下一拍 ›」（或快捷回答「继续」）：往后走就先播到那一拍；往回只是换回那一拍的话、指一下那几段
  function beatGo(n, k) {
    const p = pages.get(n);
    if (!p?.beats) return;
    const to = Math.max(0, Math.min(p.beats.length - 1, k));
    if (beat && beat.page === n) while (beat.max < to) revealBeat(beat.max + 1);
    p.beat = to;
    bv.paint(p);
    focusBeat(p, to);
    lastActive = Date.now();
    bv.scheduleFit();
  }

  // 这一拍的段亮、别的淡（播到最后一拍全都恢复），滚到屏幕中间
  function focusBeat(p, k, { scroll = true } = {}) {
    if (!p) return;
    const ids = (p.beatFocus?.[k] || []).filter((id) => segs.get(id)?.sec && !segs.get(id).sec.hidden);
    p.sec.querySelectorAll('.class-seg.beat-focus').forEach((x) => x.classList.remove('beat-focus'));
    const last = !p.beats || k >= p.beats.length - 1;
    p.sec.classList.toggle('is-beating', !last && ids.length > 0);
    for (const id of ids) segs.get(id).sec.classList.add('beat-focus');
    if (!scroll || bv.view !== p.n) return;
    const el = ids.length ? segs.get(ids.at(-1)).sec : p.talkEl;
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: ids.length ? 'center' : 'start' });
  }

  // 剩下的拍子一下子播完：学生作答、说话，或者要调用 Claude 之前（Claude 看到的黑板总是完整的）
  function finishBeats() {
    if (!beat) return;
    const b = beat;
    if (!b.done) {
      while (b.max < b.n - 1) revealBeat(b.max + 1);
      const p = pages.get(b.page);
      if (p?.beats) { p.beat = p.beats.length - 1; bv.paint(p); focusBeat(p, p.beat, { scroll: false }); }
    }
    beat = null;
  }

  // —— 预案：这一批作答页面自己接（react.js）。返回 true 表示接了，不用调用 Claude ——
  function tryLocal() {
    // 只读的「以前的课」、用不了 Claude 的页面：不当场接（不改板顶的话、不揭开藏着的段）
    if (!teacher.available || busy || !queue.triggered || queue.texts.length || queue.images.length || hasFreshInk()) return false;
    const items = queue.actions.map((a) => ({ a, trig: trigs.get(a) }));
    const live = liveBlockIds();
    const plan = planLocal({ items, rules: reacts, present: (id) => live.has(id) });
    if (!plan) return false;
    clearTimeout(timer);
    const actions = queue.actions.splice(0);
    queue.triggered = false;
    queue.now = false;
    started = true;
    addTurn({ role: 'student', text: actionsMessage(actions), say: '', actions: actions.map(actionText), page: bv.cur || undefined });
    const by = reacts.get(plan.fired[0].target)?.by;
    markFired(reacts, plan);
    const notes = [];
    const shown = plan.show.map((id) => execOp({ op: 'show', id }, [], notes)).filter((o) => o.ok);
    const cur = pages.get(bv.cur);
    if (plan.talk && cur && cur.kind !== 'closing') setTalk(cur, plan.talk, by === 'mock' ? 'mock' : 'pre');
    addTurn({ role: 'system', kind: 'react', text: reactNote(plan), fired: plan.fired.map(({ target, seq, index, kind }) => ({ target, seq, index, kind })) });
    syncUsage();
    refresh();
    if (bv.view !== bv.cur) bv.show(bv.cur, { animate: true });
    const el = shown.map((o) => segs.get(o.id)?.sec).filter(Boolean).at(-1) || (plan.talk ? cur?.talkEl : null);
    el?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: shown.length ? 'nearest' : 'start' });
    nudged = false;
    lastActive = Date.now();
    bar.setStatus('idle', '');
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
    sec.className = `stage live-step class-seg class-pending${seg.place === 'pin' ? ' class-pin' : ''}${committing ? ' no-anim' : ''}`;
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
    if (seg.place !== 'pin' && !CANVAS) bv.splitFigure(sec.querySelector('.stage-body'));
    return { sec, errors, soft: probs.filter((p) => p.soft) };
  }

  function dropScenesOf(sec) {
    for (const [k, sc] of session.scenes) if (sec.contains(sc.el)) session.scenes.delete(k);
  }

  function mountRestored(seg) {
    if (seg.failed) { seg.sec = failedSec(seg); return; }
    const { sec } = renderSeg(seg);
    sec.classList.remove('class-pending');
    if (seg.held) sec.hidden = true;
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
    if (op.warn) notes.push(`${op.op} ${op.id || ''}：${op.warn}`);
    // 教学计划：不上黑板；下一轮从对话历史里取最新的一份放进说明（prompt.js 的 latestPlan）
    if (op.op === 'plan') return { op: 'plan', ok: true, ...(op.cut ? { note: `plan 写了 ${op.cut} 个字，只留了前 ${PLAN_MAX} 个` } : {}) };
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
          page = op.op === 'new' || !cur || cur.kind === 'closing' ? (op.op === 'new' && streamPage && streamPage.lead === op.id && pages.get(streamPage.n) === streamPage ? adoptPage(streamPage, op) : newPage({ lead: op.id, title: op.title || '', ...(CANVAS && op.op === 'new' ? { cols: op.cols || [1] } : {}) })).n : bv.cur;
        }
        seg = { id: op.id, seq: ++segSeq, page, place: toPin ? 'pin' : 'board', title: '', md: '', hidden: false, failed: false, pending: false, sec: null };
      }
      const next = { ...seg, title: op.title ?? seg.title, md: op.body || '', ...(op.point ? { point: op.point } : {}) };
      // 藏着的段（add … hold，等预案揭开）：改写时还藏着；写错了等重写时记着要藏
      const held = op.op === 'replace' ? !!seg.held : op.op === 'add' && (!!op.hold || !!(seg.pending && seg.held));
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
        if (isNew || seg.pending) { seg.pending = true; seg.title = next.title; seg.held = held; segs.set(seg.id, seg); }
        failures.push({ key: op.id, id: op.id, title: next.title, errors, isNew: !seg.sec });
        return { op: op.op, id: op.id, ok: false, page: seg.page || undefined, error: errors.map((p) => `${p.kind}：${p.msg}`).join('；') };
      }
      if (seg.sec) { dropScenesOf(seg.sec); seg.sec.remove(); }
      tools.dropMarks(seg.id);
      sec.classList.remove('class-pending');
      Object.assign(seg, next, { sec, hidden: false, held, failed: false, pending: false, softNotes: soft.length ? soft.map((p) => p.msg) : undefined });
      if (held) sec.hidden = true;
      // 版面：放在 at= 写的地方（replace 不写就留在原处；new / add 不写就找空处）
      if (CANVAS && seg.place !== 'pin') seg.col = colFor(seg, op);
      // 改写了：之前几轮挂在这一段组件上的预案作废（这一轮后面再写的 react 照常挂上）
      if (!isNew) { dropForSeg(reacts, seg.id, opTurn.seq); dropWhys(seg.id, opTurn.seq); }
      segs.set(seg.id, seg);
      // 版面：登记好了再排（排的时候按 segs 里这块板上的段搭结构）
      if (CANVAS && seg.place !== 'pin') layoutPage(seg.page);
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
      dropForSeg(reacts, seg.id, opTurn.seq);
      dropWhys(seg.id, opTurn.seq);
      saveSeg(seg);
      return { op: 'hide', id: op.id, ok: true };
    }
    // 版面：挪一段、改大小（不重画，作答都在）
    if (op.op === 'move') {
      const seg = segs.get(op.id);
      if (!CANVAS) return { op: 'move', id: op.id, ok: false, error: '这节课没开版面，move 用不了' };
      if (!seg?.sec || seg.place === 'pin') return { op: 'move', id: op.id, ok: false, error: seg ? `${op.id} 在常驻栏里，不能挪` : `黑板上没有 ${op.id}` };
      // 挪到那一栏的最下面（同一栏里按先后从上往下）
      seg.col = op.col;
      seg.ord = Math.max(0, ...[...segs.values()].filter((x) => x.page === seg.page).map(ordOf)) + 1;
      saveSeg(seg);
      layoutPage(seg.page);
      return { op: 'move', id: op.id, ok: true, col: op.col, page: seg.page || undefined };
    }
    // 版面：换当前板的分栏
    if (op.op === 'layout') {
      const pg = pages.get(bv.cur);
      if (!CANVAS) return { op: 'layout', ok: false, error: '这节课没开版面，layout 用不了' };
      if (!pg || pg.kind === 'closing') return { op: 'layout', ok: false, error: '还没有板（或者当前是下课小结）：先 board new' };
      pg.cols = op.cols;
      savePage(pg);
      layoutPage(pg.n);
      return { op: 'layout', ok: true, cols: op.cols, page: pg.n };
    }
    // 揭开藏着的段（add … hold）或撤回过的段
    if (op.op === 'show') {
      const seg = segs.get(op.id);
      if (!seg?.sec || seg.failed || seg.pending) return { op: 'show', id: op.id, ok: false, error: seg ? `${op.id} 没画出来，揭不开` : `黑板上没有 ${op.id}` };
      if (!seg.held && !seg.hidden) return { op: 'show', id: op.id, ok: true };
      seg.held = false;
      seg.hidden = false;
      seg.sec.hidden = false;
      seg.sec.classList.add('beat-in');
      // 版面：藏着时不占地方，揭开时放回它写的 at=（被别的段长过去占了，就放到最近的空处）
      saveSeg(seg);
      return { op: 'show', id: op.id, ok: true, page: seg.page || undefined };
    }
    // 预写的「为什么」：学生点着问「为什么」时页面当场显示（ask.js）
    if (op.op === 'why') {
      if (!segs.has(op.target) && !liveBlockIds().has(op.target)) return { op: 'why', target: op.target, ok: false, error: `黑板上没有 ${op.target}（写段的 id 或组件的 id:）` };
      if (op.errors?.length) notes.push(`why ${op.target} 里有 ${op.errors.length} 行没读懂：\n${op.errors.map((e) => `  - ${e}`).join('\n')}`);
      const wseg = segs.has(op.target) ? op.target : liveBlockIds().get(op.target);
      setWhy(op.target, op.items, wseg, opTurn.seq);
      return { op: 'why', target: op.target, ok: true, items: op.items, seg: wseg };
    }
    // 预案：学生在这个组件上作答以后页面当场接的话（react.js）
    if (op.op === 'react') {
      const seg = liveBlockIds().get(op.target);
      if (!seg) return { op: 'react', target: op.target, ok: false, error: `黑板上没有组件 ${op.target}（target 写组件的 id:，不是段的 id）` };
      if (op.errors?.length) notes.push(`react ${op.target} 里有 ${op.errors.length} 行没用：\n${op.errors.map((e) => `  - ${e}`).join('\n')}`);
      const unknown = [...new Set(op.cases.flatMap((c) => c.show || []))].filter((id) => !segs.has(id));
      if (unknown.length) notes.push(`react ${op.target} 的 show= 写了黑板上没有的段：${unknown.join('、')}（到时候揭不开）`);
      if (!op.cases.length) { reacts.delete(op.target); return { op: 'react', target: op.target, seg, ok: true, cases: [] }; }
      const cases = op.cases.map((c) => ({ ...c }));
      reacts.set(op.target, { target: op.target, seq: opTurn.seq, seg, by: opTurn.by, cases: cases.map((c) => ({ ...c, used: false })) });
      return { op: 'react', target: op.target, seg, by: opTurn.by, ok: true, cases };
    }
    if (op.op === 'figure') return tools.figureOp(op, notes);
    if (op.op === 'mark') return tools.markOp(op);
    if (op.op === 'unmark') return tools.unmarkOp(op);
    return { op: op.op, ok: false, error: '看不懂的指令' };
  }

  // —— 版面（canvas.js）：Claude 说结构（这块板分几栏、每段放第几栏），页面按真实内容排：同一栏从上往下接，
  // 栏和栏之间一道竖线（不估高度、不写坐标；阅读顺序由结构定：一栏从上往下读，左右是两件事）——
  // （WIDE_NO、ZOOMABLE 在文件开头：刷新时 restore 先于这里跑到 layoutPage，放在这里会碰上暂时性死区，整份课堂记录读不出来）
  function langsOf(md) { return [...String(md).matchAll(/^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z][\w-]*)/gm)].map((m) => m[1].toLowerCase()); }
  function ordOf(s) { return s.ord ?? s.seq; }
  // 一段放第几栏：写了就用；没写就接着这块板上一段的栏（顺着往下写）；这块板的第一段放第 1 栏
  function colFor(seg, op) {
    if (op?.col !== undefined) return op.col;
    if (seg.col !== undefined) return seg.col;
    const prev = [...segs.values()].filter((x) => x !== seg && x.page === seg.page && x.place !== 'pin' && x.col !== undefined).sort((x, y) => ordOf(x) - ordOf(y)).at(-1);
    return prev ? prev.col : 1;
  }
  // 按结构把段放进一层层、一栏栏里。结构没变就不动 DOM（学生正在某个输入框里打字时不被打断）
  function layoutPage(n) {
    const p = pages.get(n);
    if (!CANVAS || !p || p.kind === 'closing') return;
    const cols = p.cols?.length ? p.cols : [1];
    const list = [...segs.values()].filter((x) => x.page === n && x.place !== 'pin' && x.sec?.isConnected !== false && x.sec).sort((x, y) => ordOf(x) - ordOf(y));
    const bands = bandsOf(list.map((x) => ({ id: x.id, col: x.col ?? 1 })), cols);
    const sig = JSON.stringify([cols, bands]);
    for (const x of list) ensureZoom(x);
    if (p.cvSig === sig && list.every((x) => x.sec.parentElement?.closest('.cv-band'))) return;
    p.cvSig = sig;
    const body = p.bodyEl;
    const made = bands.map((b) => {
      const el = document.createElement('div');
      el.className = `cv-band${b.kind === 'all' ? ' is-all' : ''}`;
      if (b.kind === 'all') { el.appendChild(segs.get(b.id).sec); return el; }
      if (b.cols.length > 1) el.style.gridTemplateColumns = cols.slice(0, b.cols.length).map((w) => `minmax(0, ${w}fr)`).join(' ');
      for (const ids of b.cols) {
        const c = document.createElement('div');
        c.className = 'cv-col';
        for (const id of ids) c.appendChild(segs.get(id).sec);
        el.appendChild(c);
      }
      return el;
    });
    body.querySelectorAll(':scope > .cv-band').forEach((x) => x.remove());
    body.append(...made);
    for (const el of made) watchBand(el);
  }
  // 两栏差得太多（一栏短、另一栏一直往下长）就改成一栏：先左栏的、再右栏的，阅读顺序不变，竖线也不画了。
  // 2026-11-03 我说：左边空一大片、右边窄窄一条往下长，像看书一样，不行。Claude 看不到页面，估不准一段英文在窄栏里折成几行，所以页面量
  const STACK_RATIO = 1.7;
  function balanceBand(el) {
    const cols = [...el.children].filter((c) => c.classList.contains('cv-col'));
    if (cols.length < 2 || !el.isConnected) return;
    const was = el.classList.contains('is-stacked');
    el.classList.remove('is-stacked'); // 先按分栏量（同一帧里量完再决定，不会闪）
    const hs = cols.map((c) => c.getBoundingClientRect().height);
    const hi = Math.max(...hs), lo = Math.min(...hs);
    // 这一层从哪开始、到底部那条之间能看见多高（停在板的最上面时）
    const top = el.getBoundingClientRect().top + window.scrollY;
    const screen = Math.max(200, window.innerHeight - top - (bar?.height || 110));
    // 只有长的那栏超出一屏（学生往下滑时一边空着、一边还在往下长）才改：一屏之内一栏短一点，像黑板上留白，不用改
    // 差得特别多（一栏只有几行、另一栏一大段）时长到快一屏就改；差得没那么多时要明显超出一屏才改（只多出一点点，滑一下就完了）
    const stack = hi - lo > screen * 0.3 && (hi > lo * 3 && hi > screen * 0.8 || hi > lo * STACK_RATIO && hi > screen * 1.15);
    el.classList.toggle('is-stacked', stack);
    el.dataset.cvH = hs.map(Math.round).join('/');
    if (stack !== was) el._cvMuteUntil = performance.now() + 120;
  }
  function watchBand(el) {
    requestAnimationFrame(() => balanceBand(el));
    if (!window.ResizeObserver) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (!el.isConnected) { ro.disconnect(); return; }
      if ((el._cvMuteUntil || 0) > performance.now()) return; // 自己换栏引起的尺寸变化不算
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => balanceBand(el));
    });
    for (const c of el.children) ro.observe(c);
  }
  // ⤢ 只给图、演示这类要看细节、要拖的块（字和题不用放大，角上不多一个钮）
  function ensureZoom(seg) {
    const sec = seg.sec;
    if (!sec || sec.querySelector(':scope > .cv-zoom') || !langsOf(seg.md).some((l) => ZOOMABLE.has(l) || ENGINES[l])) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cv-zoom';
    b.setAttribute('aria-label', '放大这一块');
    b.textContent = '⤢';
    b.addEventListener('click', () => zoomSeg(seg));
    sec.appendChild(b);
  }
  // 点 ⤢：这一块铺满整块黑板（大的交互图在大屏上拖），再点一下回去
  function zoomSeg(seg) {
    const sec = seg.sec;
    const on = !sec.classList.contains('is-zoomed');
    sec.classList.toggle('is-zoomed', on);
    const btn = sec.querySelector(':scope > .cv-zoom');
    btn.textContent = on ? '×' : '⤢';
    btn.setAttribute('aria-label', on ? '缩回去' : '放大这一块');
    window.dispatchEvent(new Event('resize'));
  }
  // 黑板现状里的「版式」：几栏、每栏从上往下是哪几段、各多高，整块板比一屏长多少
  function canvasState() {
    if (!CANVAS) return null;
    const p = pages.get(bv.cur);
    if (!p || p.kind === 'closing') return { text: '版面：整块横屏，这块板分几栏由你定（board new 的 cols=）。' };
    const cols = p.cols?.length ? p.cols : [1];
    const list = [...segs.values()].filter((x) => x.page === p.n && x.place !== 'pin' && !x.hidden && x.sec).sort((x, y) => ordOf(x) - ordOf(y));
    const bands = bandsOf(list.map((x) => ({ id: x.id, col: x.col ?? 1 })), cols);
    const band = p.bodyEl.querySelector(':scope > .cv-band:not(.is-all):not(.is-stacked)') || p.bodyEl.querySelector(':scope > .cv-band:not(.is-all)');
    const widths = band?.classList.contains('is-stacked') ? [] : band ? [...band.children].map((c) => c.getBoundingClientRect().width) : [p.bodyEl.clientWidth];
    // 页面改成一栏的层：按层的先后记下两栏原来多高
    const stacked = [...p.bodyEl.querySelectorAll(':scope > .cv-band')].map((el, i) => (el.classList.contains('is-stacked') ? { i, h: el.dataset.cvH || '' } : null)).filter(Boolean);
    const top = p.bodyEl.getBoundingClientRect().top + window.scrollY;
    const screen = window.innerHeight - top - (bar?.height || 110);
    const total = p.sec.hidden ? 0 : p.bodyEl.getBoundingClientRect().height;
    const info = (id) => { const x = segs.get(id); return { h: x?.sec && !x.sec.hidden ? x.sec.getBoundingClientRect().height : 0, held: !!x?.held }; };
    return { text: layoutText({ cols, bands, info, widths, screen, total, stacked }) };
  }

  function saveSeg(seg) {
    sink.put('steps', { id: seg.id, seq: seg.seq, page: seg.page || 0, place: seg.place || 'board', md: seg.md, title: seg.title || '', hidden: !!seg.hidden, failed: !!seg.failed, ...(seg.held ? { held: true } : {}), ...(seg.col !== undefined ? { col: seg.col } : {}), ...(Number.isFinite(seg.ord) ? { ord: seg.ord } : {}), ...(seg.point ? { point: seg.point } : {}), by: 'class', at: Date.now() });
  }

  function refresh() {
    syncVerify();
    const any = pages.size > 0;
    welcome.hidden = any || busy;
    hero.hidden = any || !busy;
    if (!any && !busy) {
      welcomeText.innerHTML = readOnly ? '这节课的黑板上什么也没有。' : !teacher.available ? '课堂现在开不了：这个页面用不了 Claude。<br>看看底部的提示。'
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
        outline: tools.figureOutline(b),
        results: (results.get(b.dataset.bid) || []).slice(-6).map((r) => r.line),
        draft: draftsIn(b).map((d) => (d.label ? `${d.label}：${d.text}` : d.text)).join('；'),
        react: armedText(reacts.get(b.dataset.bid)) || undefined,
      })) : [];
      const text = texText(seg.sec?.querySelector('.stage-body > p'));
      const summary = [clipTex(text, 140), seg.softNotes?.length ? `（${seg.softNotes.join('；')}）` : ''].filter(Boolean).join(' ');
      const segMarks = seg.hidden ? [] : [...marks.values()].filter((m) => m.seg === seg.id).map((m) => markText(m.id, m.spec));
      return { id: seg.id, page: seg.page || 0, place: seg.place || 'board', title: seg.title || seg.sec?.querySelector('h2')?.textContent?.trim() || '', summary, hidden: seg.hidden, held: !!seg.held,  pending: !!seg.pending, failed: !!seg.failed, blocks, marks: segMarks.length ? segMarks : undefined };
    });
    const vw = window.innerWidth, vh = window.innerHeight;
    // 这节课的量（let 块）：课堂说明被压缩成摘要以后，Claude 也知道有哪些量、值是多少
    const lessonVars = Object.entries(session.vars || {}).map(([k, v]) => { try { return `${k} = ${exactText(v)}`; } catch { return k; } });
    return {
      segs: list,
      canvas: canvasState(),
      vars: lessonVars.length ? lessonVars : undefined,
      nextMark: tools.nextMark,
      pages: [...pages.values()].sort((a, b) => a.n - b.n).map((p) => ({ n: p.n, title: p.title, talk: p.talk, kind: p.kind })),
      cur: bv.cur,
      view: bv.view,
      screen: { w: vw, h: vh, landscape: vw > vh, board: bv.fit ? { w: bv.fit.w, h: bv.fit.avail } : null },
      fit: bv.fit && pages.has(bv.cur) ? { fits: bv.fit.fits, need: bv.fit.need, avail: bv.fit.avail, ...(bv.fit.screens ? { screens: bv.fit.screens } : {}) } : null,
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
      trigs.set(a, trig);
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
  // after：这一轮完了以后接着发排着的、对话长了在后台写摘要；下课那一轮不要（下课以后再跑就是白花一整轮）
  async function exclusive(fn, { after = true } = {}) {
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
      if (ok && after) { schedule(false); compactLater(); specSoon(); }
    }
  }

  function flush() {
    if (busy || !queue.triggered) return Promise.resolve();
    ended = false;
    // 学生有动作了：这一轮剩下的拍子一下子播完；预案接得住就不调用 Claude
    finishBeats();
    if (tryLocal()) return Promise.resolve();
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
    compacting = compact({ background: true }).finally(() => { compacting = null; specSoon(); });
  }

  async function compact({ background = false } = {}) {
    const { prev, old } = compactionSlice(promptHistory(history));
    if (!old.length) return;
    if (!background) bar.setStatus('thinking', '对话有点长了，先整理一下前面的内容…');
    try {
      const input = compactionPrompt({ summary: prev?.text || '', turns: old });
      const r = await teacher.call(input, { ...TEACH, cache: false, signal: background ? undefined : ctl?.signal, ...(background ? { lane: 'bg' } : {}) });
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

  // 这一轮要发给课堂 Claude 的整份内容（说明 + 对话）。hist：对话记录（抢跑时多一条假定的学生的话）
  function buildInput(hist) {
    bv.measureFit();
    const level = Math.min(budgetLevel, 3);
    const system = buildSystem({ rules: pack.main?.rules, componentDocs: COMPONENT_DOCS, pack: packForPrompt(teacher.tools), board: boardState(), packBudget: PACK_BUDGET >> level, subject: session.subject, tools: teacher.tools, memory: memoryArg(), canvas: CANVAS, ...planArg() });
    const maxBytes = Math.round(promptLimit() * [1, 0.85, 0.7, 0.55][level]);
    const fit = fitTurns({ system, history: promptHistory(hist), maxBytes, stub: teacher.tools });
    return { fit, system, maxBytes, level };
  }

  // —— 抢跑（spec.js，docs/smart-plan.md 第 1 批）——
  // 一轮讲完、板上没事可做时，先按「学生点了继续」调用；开课页先按「开始上课」调用。学生真点了、整份内容一字不差才用。
  function specState() {
    const anyDraft = [...segs.values()].some((seg) => seg.sec && !seg.hidden && !seg.failed && !seg.pending && [...seg.sec.querySelectorAll('.block[data-bid]')].some((b) => draftsIn(b).length));
    return {
      on: FEATURES.spec !== false, available: teacher.available, busy, ended, started, compacting: !!compacting,
      liveTurns: history.filter((t) => t && !t.discarded).length,
      pending: !!pendingTurn(history),
      queued: queue.triggered || queue.texts.length + queue.actions.length + queue.images.length > 0,
      drafts: anyDraft, ink: hasFreshInk(), waiting: started ? waitingBlocks().length : 0,
      beatsLeft: !!(beat && !beat.done), away: started && bv.view !== bv.cur,
    };
  }
  function specSoon(delay = SPEC_DELAY) {
    clearTimeout(specTimer);
    specTimer = setTimeout(startSpec, delay);
  }
  function startSpec() {
    if (spec) return;
    const say = specFor(specState());
    if (!say) return;
    let input;
    try { input = buildInput([...history, { role: 'student', text: say, say, seq: turnSeq + 1 }]); } catch (e) { console.warn('抢跑没拼出来', e); return; }
    const key = specKey(input.fit.turns);
    if (!key) return;
    const s = { say, key, ctl: new AbortController(), text: '', onText: null, staged: { notes: [], slips: [], images: [], ids: [], calls: [] }, bytes: input.fit.bytes };
    const opts = { ...TEACH, cache: false, signal: s.ctl.signal, onText: (u) => { s.text = u.text; s.onText?.(u); } };
    if (teacher.tools) opts.tools = classTools(s.staged, { view: true });
    s.promise = teacher.call(input.fit.turns, opts);
    s.promise.catch(() => {}); // 没接上的抢跑出错不报
    spec = s;
  }
  // key 一样就交出去（之后归这一轮管）；不一样就停掉、记一笔白花的
  function takeSpec(key) {
    const s = spec;
    if (!s) return null;
    if (key && s.key === key) { spec = null; return s; }
    dropSpec(key);
    return null;
  }
  // key：这一刻要发的内容（有的话，把和抢跑那份第一处不同的地方记下来：以后看真课的记录，知道为什么没接上）
  function dropSpec(key = null) {
    clearTimeout(specTimer);
    const s = spec;
    if (!s) return;
    spec = null;
    s.ctl.abort();
    const diff = key ? specDiff(s.key, key) : '';
    addTurn({ role: 'system', kind: 'spec', discarded: true, text: `抢跑「${s.say}」没用上（学生做了别的，或者黑板、记忆变了）`, ...(diff ? { diff } : {}), cost: callCost({ bytes: s.bytes, why: 'spec' }) });
  }

  // —— 讲课：一次调用（画不出来的段会自动再要一轮重写，同一段最多 2 次）。返回 true 表示 Opus 5.5 讲完了这一轮 ——
  // why：这一轮为什么调用（usage.js：turn 学生引起的、stuck 停久了的提醒）；同一轮里再要的几次记成 lint（重写）/ images（看原图）
  async function converse(images = [], { why: firstWhy = 'turn' } = {}) {
    if (!teacher.available) return false;
    finishBeats();
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
      // 开课时取的以前的课：最多等 3 秒（一般早就取好了）
      await Promise.race([fetchEarlier(), new Promise((r) => setTimeout(r, 3000))]);
      const { fit, system, maxBytes, level } = buildInput(history);
      lastPrompt = { bytes: fit.bytes, maxBytes, keepRecent: fit.keepRecent, dropped: fit.dropped, turns: fit.turns.length, level, ...(dev ? { system } : {}) };
      // 抢跑（spec.js）：这一刻要发的和抢跑发的一字不差就接着用；不一样就先停掉它（让出平台的位子），照常调用
      const pre = round === 0 && !(imgs.length && teacher.images) ? takeSpec(specKey(fit.turns)) : (dropSpec(), null);
      // 工具做的事先记着，确认是 Opus 5.5 讲的才算数（退路模型记的观察、要看的图都不留）
      let staged = { notes: [], slips: [], images: [], ids: [], calls: [] };
      const opts = { ...TEACH, cache: false, signal, onText: ({ text }) => drawDraft(text) };
      if (imgs.length && teacher.images) opts.images = imgs.slice(0, maxImages);
      if (teacher.tools) opts.tools = classTools(staged, { view: !followed });
      let res;
      // 这一次调用花了多少：发出去的字节；它调了几次工具（每次平台多跑一整轮）
      const t0 = performance.now();
      firstAt = 0;
      const cost = (w) => callCost({ bytes: fit.bytes, why: w, tools: staged.calls.length, ms: performance.now() - t0, first: firstAt ? firstAt - t0 : undefined, spec: adopted ? 'hit' : undefined });
      let adopted = false;
      if (pre) {
        // 接上抢跑：已经写出来的先画上，后面的接着画；停止按钮停它
        ctl = pre.ctl;
        pre.onText = opts.onText;
        if (pre.text) { drawDraft(pre.text); firstAt = performance.now(); }
        try {
          res = await pre.promise;
          staged = pre.staged;
          adopted = true;
        } catch (e) {
          // 接上以后被取消的只能是学生点了停止：和平常一样停下。别的错（抢跑那次出了错）学生不知道有过抢跑，照常再调用一次
          if (e?.code === 'cancelled') { clearDraft(); dropPreviews({ rollback: true }); failTurn(e, '这一轮', cost('failed')); return false; }
          res = null;
          dropPreviews({ rollback: true });
          clearDraft();
          ensureDraft({ keepTalk: rewriting });
          ctl = new AbortController();
          opts.signal = ctl.signal;
          firstAt = 0;
        }
      }
      if (!res) try {
        res = await teacher.call(fit.turns, opts);
      } catch (e) {
        clearDraft();
        dropPreviews({ rollback: true });
        failTurn(e, '这一轮', cost('failed'));
        return false;
      }
      clearDraft();
      if (res?.modelApplied !== MODEL) {
        // 边写边显示先画上去的：作废的轮一样都不留
        dropPreviews({ rollback: true });
        // 平台换了退路模型：整段作废（不显示、不执行、不进对话历史），只留一条记录
        addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，这一轮作废', modelApplied: res?.modelApplied || null, modelTierApplied: res?.modelTierApplied || null, cost: cost('failed') });
        bar.setStatus('error', 'Opus 5.5 暂时用不了，稍后点重试。');
        return false;
      }
      budgetLevel = 0;
      saveNotes(staged);
      streamPage = dropPreviews();
      committing = true;
      let out;
      try { out = finishTurn(res, staged.calls, { keepTalk: rewriting, cost: cost(why) }); } finally { committing = false; streamPage = null; }
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
    opTurn = { seq: turnSeq + 1, by: mock ? 'mock' : res.modelApplied || '' };
    // 拍子（beats.js）：说一句、写一段、再说一句……一拍一拍地播。重写写错的段那一轮不播
    const opSegs = segments.filter(isOp);
    const plan = beatPlan(segments, isOp);
    const play = FEATURES.beats && !FEATURES.stream && !keepTalk && shouldPlay(plan, opSegs.map((s) => s.op));
    const deferred = []; // 到了那一拍才执行的指令 { b, op }
    const beatSegs = new Map(); // 拍 → 这一拍写的段 id（先藏着）
    // 一轮最多开一块新板（2026-11-03 我说：一下子给好几块板、每块一点点，很影响学习）：同一轮第二个 board new 起都并到这块板上
    let newBoards = 0;
    opSegs.forEach((s, i) => {
      const n = failures.length;
      let op = { ...s.op, body: s.body };
      if (op.op === 'new' && ++newBoards > 1) {
        op = { ...op, op: 'add' };
        if (newBoards === 2) notes.push('一轮只开一块新板：这一轮后面的 board new 都并到了第一块新板上。下一个点下一轮再换新板。');
      }
      const b = play ? plan.opBeat[i] : 0;
      if (b > 0 && DEFERRED_OPS.has(op.op)) { deferred.push({ b, op }); return; }
      const r = execOp(op, failures, notes);
      failures.slice(n).forEach((f) => { f.at = boardOps.length; });
      boardOps.push(r);
      if (b > 0 && r.ok && ['add', 'replace', 'pin'].includes(op.op)) beatSegs.set(b, [...(beatSegs.get(b) || []), op.id]);
    });
    // 同一轮里先写错、后面又写对了同一段（add 错了紧跟一个 replace）：不用再要求重写
    failures = failures.filter((f) => !boardOps.some((o, i) => i > f.at && o.ok && o.id === f.id && ['add', 'new', 'replace', 'pin'].includes(o.op)));
    // 说的话：写在当前板的最上面（换了新板就写在新板上），把上一句换掉。还没有板就开一块只有话的板
    const talk = segments.filter((s) => s.type === 'speech').map((s) => s.text).join('\n\n').trim();
    let talkPage;
    if (talk && !keepTalk) {
      const cur = pages.get(bv.cur);
      const p = cur && cur.kind !== 'closing' ? cur : newPage();
      setTalk(p, talk, mock ? 'mock' : res.modelApplied, play ? plan.talks : null);
      talkPage = p.n;
    }
    // 后面几拍写的段先藏着（段已经画好、存好了，只是还没轮到）
    if (play && talkPage) {
      for (const ids of beatSegs.values()) for (const id of ids) segs.get(id)?.sec?.classList.add('beat-wait');
      beat = { page: talkPage, n: plan.talks.length, max: 0, segs: beatSegs, deferred, told: null };
      const later = new Set([...beatSegs.values()].flat());
      pages.get(talkPage).beatFocus = [focusOf(boardOps).filter((id) => !later.has(id))];
    } else {
      beat = null;
      // 没开成拍子（没说话）：推迟的指令照常执行
      for (const d of deferred) boardOps.push(execOp(d.op, failures, notes));
    }
    const turnedPage = bv.cur !== pageBefore;
    refresh();
    // 换了新板：翻过去、从头看。只改了当前板：回到当前板（学生翻到以前的板去作答时也拉回来）；
    // 这一轮在当前板上新写、改写的段露不全，就滚到刚好露出来（滚得最少，板顶尽量留着）；没写段时，板顶的话不在视野里就滚上去
    const smooth = reduceMotion() ? 'auto' : 'smooth';
    if (turnedPage) bv.show(bv.cur, { animate: true });
    else if (pages.has(bv.cur)) {
      if (bv.view !== bv.cur) bv.show(bv.cur, { animate: true });
      const fresh = boardOps.filter((o) => o.ok && (o.op === 'add' || o.op === 'replace') && o.page === bv.cur).map((o) => segs.get(o.id)?.sec).filter((sec) => sec && !sec.hidden && !sec.classList.contains('beat-wait')).at(-1);
      if (fresh) {
        const r = fresh.getBoundingClientRect();
        if (r.bottom > window.innerHeight - bar.height || r.top < 0) fresh.scrollIntoView({ behavior: smooth, block: 'nearest' });
      } else if (talkPage) {
        const t = pages.get(bv.cur).talkEl;
        if (t.getBoundingClientRect().top < 0) t.scrollIntoView({ behavior: smooth, block: 'start' });
      }
    }
    const told = addTurn({ role: 'claude', text: res.text, boardOps, page: bv.cur || undefined, talkPage, modelApplied: res.modelApplied, truncated: !!res.truncated, tools: toolCalls.length ? toolCalls : undefined, cost });
    if (beat) { beat.told = told; focusBeat(pages.get(beat.page), 0, { scroll: false }); }
    askHere?.clearAsked();
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
        if (o.warn) notes.push(`指令 mark 提醒：${o.warn}`);
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

  function drawDraft(text, status = 'Claude 正在写黑板…') {
    pendingText = text;
    pendingStatus = status;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      try {
        const { segments } = parseOutput(pendingText);
        bar.setStatus('writing', pendingStatus);
        const d = ensureDraft();
        const talk = d.keepTalk ? '' : segments.filter((s) => s.type === 'speech').map((s) => s.text).join('\n\n').trim();
        if (!firstAt && (talk || segments.some((s) => s.type === 'board'))) firstAt = performance.now();
        d.talk.hidden = !talk;
        if (talk) d.talk.innerHTML = mdToHtml(previewMd(talk));
        // 边写边显示：写完了的段先画上黑板（核验之前学生看得到、点不了）；还在写的、圈画这类到最后才做的，照旧列成一行提示
        const shown = FEATURES.stream && !d.keepTalk ? streamOps(segments) : new Set();
        const ops = segments.filter((s, i) => s.type === 'board' && !shown.has(s));
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
        : op.op === 'figure' ? `让图 ${escapeHtml(op.target || '')} 动一下` : op.op === 'mark' ? `在 ${escapeHtml(op.target || '板')} 上圈一下` : op.op === 'unmark' ? '擦掉标注' : op.op === 'plan' ? '想一想下一步' : op.op === 'memo' ? '记一笔' : '写黑板';
    return `<span class="class-draft-op${b.closed ? '' : ' is-writing'}">${label}</span>`;
  }

  // 末尾还没写完的 $…（公式没闭合）先不显示，免得露出半截 TeX
  function previewMd(md) {
    const dollars = (md.replace(/\\\$/g, '').match(/\$/g) || []).length;
    return dollars % 2 ? md.slice(0, md.lastIndexOf('$')) + ' …' : md;
  }

  // —— 边写边显示（features.js 的 stream）：这一轮写完了的段先画出来；核验是 Opus 5.5 以后由 finishTurn 照常执行（换成正式的），
  // 不是就全部撤掉。stream：{ done（处理过的块）, list（先画出来的段）, page（先开的新板）, prev（开新板前的当前板）, hidden（被改写、先藏起来的原段）} ——
  function streamOps(segments) {
    const out = new Set();
    // vars / book：先画的段里的 let 块、答案会写进 session：这一轮作废时退回去（不然作废那一轮定义的量留着，之后的 \calc 用错值）
    if (!stream) stream = { done: new Map(), list: [], page: null, prev: bv.cur, hidden: [], vars: { ...session.vars }, book: session.answerBook ? new Map(session.answerBook) : null };
    let i = 0;
    for (const s of segments) {
      if (!isOp(s)) continue;
      const key = `${i++}`;
      if (!['new', 'add', 'replace'].includes(s.op.op)) continue;
      // 藏着的段（add … hold，或改写一段藏着的）不先画：多半是答案的讲解、下一小问，等预案揭开
      if (s.op.hold || (s.op.op === 'replace' && segs.get(s.op.id)?.held)) continue;
      if (stream.done.has(key)) { if (stream.done.get(key)) out.add(s); continue; }
      const ok = previewSeg(s.op, s.body);
      stream.done.set(key, ok);
      if (ok) out.add(s);
    }
    return out;
  }
  function previewSeg(op, body) {
    const existing = segs.get(op.id);
    if (op.op !== 'replace' && existing && !existing.pending) return false; // 撞了 id：交给最后的自检
    if (op.op === 'replace' && !existing?.sec) return false;
    let page = existing?.page;
    if (op.op === 'new' && !stream.page) {
      const p = bv.addPage({ lead: op.id, title: op.title || '', ...(CANVAS ? { cols: op.cols || [1] } : {}) });
      p.preview = true;
      stream.page = p;
      bv.show(p.n, { animate: true });
    }
    if (!page) page = stream.page?.n || (pages.get(bv.cur)?.kind === 'closing' ? 0 : bv.cur);
    if (!page) return false;
    const seg = { id: `~${op.id}`, preview: true, seq: (existing?.seq ?? segSeq + 1) + 0.001 * (stream.list.length + 1), page, place: 'board', title: op.title ?? existing?.title ?? '', md: body || '', hidden: false, failed: false, pending: false, sec: null };
    if (CANVAS) seg.col = op.col ?? existing?.col ?? colFor(seg, null);
    const r = renderSeg(seg);
    if (r.errors.length) { dropScenesOf(r.sec); r.sec.remove(); return false; }
    r.sec.classList.remove('class-pending');
    r.sec.classList.add('is-preview');
    seg.sec = r.sec;
    segs.set(seg.id, seg);
    stream.list.push(seg);
    if (op.op === 'replace' && existing.sec) { existing.sec.hidden = true; stream.hidden.push(existing.sec); }
    if (CANVAS) layoutPage(page);
    if (op.op !== 'new') {
      const rect = r.sec.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - bar.height) r.sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
    return true;
  }
  // 先画出来的段拿掉（核验过了要换成正式的；或者这一轮作废了）
  function dropPreviews({ rollback = false } = {}) {
    if (!stream) return;
    for (const seg of stream.list) { dropScenesOf(seg.sec); seg.sec.remove(); segs.delete(seg.id); }
    for (const sec of stream.hidden) sec.hidden = false;
    if (rollback) {
      session.vars = stream.vars;
      if (stream.book) session.answerBook = stream.book; else delete session.answerBook;
    }
    if (rollback && stream.page) {
      bv.cur = stream.prev;
      bv.removePage(stream.page.n);
      bv.show(bv.cur, { scroll: false });
    }
    const page = stream.page;
    stream = null;
    return rollback ? null : page;
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

  // 教学计划（docs/learning-plan.md 第 5 节）：开关关着时说明里不提，也不带
  function planArg() {
    if (FEATURES.plan === false) return { planDoc: false };
    return { planDoc: true, plan: latestPlan(history) };
  }

  // 学习台里：每一轮带着的记忆（页面一直订阅着记忆库，拼摘要在 prompt.js）
  function memoryArg() {
    return desk ? { mem: desk.mem, block: desk.block, space: desk.space, session: desk.sid } : null;
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

  // memory_read 查以前的课：sessions 那一条的要点、课后报告（大的只给要点）、下课小结和观察
  async function sessionRows(ids) {
    const out = [];
    for (const sid of ids.slice(0, 4)) {
      const doc = (desk.mem.sessions || []).find((x) => x.id === sid);
      if (!doc) { out.push({ id: sid, error: '没有这节课' }); continue; }
      const rep = await db.doc(`sessions/${sid}/report/main`).get().then((x) => (x.exists ? x.data() : null)).catch(() => null);
      const obs = (desk.mem.observations || []).filter((o) => o.session === sid);
      out.push({
        id: sid, kind: doc.kind || 'class', date: doc.date, block: doc.block, title: doc.title, status: doc.status,
        summary: obs.find((o) => o.kind === 'summary')?.text, notes: obs.filter((o) => o.kind !== 'summary').map((o) => `${o.kind}：${o.text}`).slice(0, 12),
        report: rep ? reportText(rep).slice(0, 6000) : doc.report?.line || '（这节课还没有课后报告）',
        ...(doc.debrief ? { debrief: debriefText(doc.debrief) } : {}),
      });
    }
    return { collection: 'sessions', items: out };
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
        // 较早几轮的段原文在对话里被省略了（prompt.js 的 stubBoardText）：要照着原文改、要对上记号时取回来
        name: 'board_read',
        description: '取黑板上几段的原文（你以前写的 Markdown，最后的版本）。ids 写段的 id 数组，比如 ["b3","b5"]，一次可以取好几段。对话里较早的段原文被页面省略了，要照着原文改写、要和以前写的记号对上时用。取回的段，接下来几轮的对话里页面不再省略它的原文，不用再取。每调用一次你要多等一整轮。',
        inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
        async execute(input) {
          const ids = (Array.isArray(input?.ids) ? input.ids : String(input?.ids ?? '').split(/[,，\s]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
          staged.calls.push({ name: 'board_read', input: { ids } });
          if (!ids.length) throw new Error('要写 ids（段的 id 数组）');
          let room = 24 * 1024;
          return ids.map((id) => {
            const g = segs.get(id);
            if (!g) return { id, error: '黑板上没有这一段' };
            const md = String(g.md ?? '');
            const text = md.length > room ? md.slice(0, Math.max(0, room)) + '…（太长，截掉了）' : md;
            room -= text.length;
            return { id, page: g.place === 'pin' ? '常驻栏' : g.page, title: g.title || '', hidden: !!g.hidden || undefined, md: text };
          });
        },
      },
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
        description: '记一条观察，存进学习台的 observations（以后的课会带着）。kind：note 是观察（比如学生反复出现的错误），proposal 是提议。改弱点、错题、复现组直接写 memo 块，比这个工具省一整轮。about 写相关的编号（W19、L2-07、L2.2.1#tr……）。',
        inputSchema: { type: 'object', properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['note', 'proposal'] }, about: { type: 'array', items: { type: 'string' } } }, required: ['text'] },
        async execute(input) {
          const text = String(input?.text ?? '').trim().slice(0, 2000);
          const kind = input?.kind === 'proposal' ? 'proposal' : 'note';
          const about = Array.isArray(input?.about) ? input.about.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : [];
          staged.calls.push({ name: 'lesson_note', input: { text, kind, about: about.length ? about : undefined } });
          if (!text) throw new Error('要写 text');
          staged.notes.push({ text, kind, about });
          return kind === 'proposal' ? '记下了这条提议。要改记忆就直接写 memo 块。' : '记下了。';
        },
      } : {
        name: 'lesson_note',
        description: '记一条观察（比如学生反复出现的错误），以后的课会带着。',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute(input) {
          const text = String(input?.text ?? '').trim().slice(0, 2000);
          staged.calls.push({ name: 'lesson_note', input: { text } });
          if (!text) throw new Error('要写 text');
          staged.notes.push({ text, kind: 'note' });
          return '记下了。';
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
        description: '查学习台的记忆库（只读）。collection 写集合名：rules、profile、curriculum、errors、weaknesses、mastery、reviews、recall、position、slips、lessons、observations、sessions、evidence。ids 写编号数组，一次取好几条的全文（比如 collection errors、ids ["L2-07","L2-31"]；同一类的放一起取）；id 取一条。sessions 写课的编号，给那节课的要点、课后报告和小结。不写 id / ids 时列出这一类（可以写 block 只要挨着这一块的）。evidence 按 block 或 session（这节课是 ' + desk.sid + '）查最近的 30 条。每调用一次你要多等一整轮：照记忆里的目录挑准了编号，一次取够。',
        inputSchema: { type: 'object', properties: { collection: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, id: { type: 'string' }, block: { type: 'string' }, session: { type: 'string' } }, required: ['collection'] },
        async execute(input) {
          const q = { collection: String(input?.collection ?? '').trim(), ids: Array.isArray(input?.ids) ? input.ids.map(String) : undefined, id: input?.id, block: input?.block, session: input?.session };
          staged.calls.push({ name: 'memory_read', input: Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) });
          const r = memoryRead(desk.mem, q);
          if (!r.needDb) return r;
          if (q.collection === 'sessions') return sessionRows(r.ids);
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
      ...(desk?.books?.chunks?.length ? [{
        name: 'textbook_read',
        description: '取教材、文稿、讲义的全文（学习台的资料；资料包里的「教材目录」有编号）。ids 写条目编号数组（B1-23.1），连着的一串写范围「B1-10.1~B1-17.3」；或者 pages 写书页「10-17」（book 写哪本，不写就是全部）。**一次取够一整节**：每调用一次你要多等一整轮、整份说明再读一遍，一条一条取很贵。取到的全文页面会一直留在资料包的「教材原文」里（这节课后面每一轮都带着），**取过的不要再取**。',
        inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, pages: { type: 'string' }, book: { type: 'string' } } },
        async execute(input) {
          const ids = Array.isArray(input?.ids) ? input.ids.map(String) : String(input?.ids ?? '').split(/[,，\s]+/).filter(Boolean);
          const pages = String(input?.pages ?? '').trim();
          const book = String(input?.book ?? '').trim();
          staged.calls.push({ name: 'textbook_read', input: { ids, ...(pages ? { pages } : {}), ...(book ? { book } : {}) } });
          if (!ids.length && !pages) throw new Error('要写 ids（条目编号或范围）或者 pages（书页）');
          const r = readChunks(desk.books.chunks, desk.books.books, ids, { pages, book });
          return { text: r.text || '（一条都没找到）', ...(r.missing.length ? { missing: r.missing } : {}), ...(r.more.length ? { more: r.more, note: `一次放不下，还有 ${r.more.length} 条没给：要的话 ids 写 ["${r.more[0]}~${r.more.at(-1)}"] 再取一次（别换着页码重取前面已经给了的）` } : {}) };
        },
      }, {
        name: 'textbook_search',
        description: '在学习台的教材、文稿、讲义里按词找条目（比如「伴随矩阵」「克拉默法则」「例2.5」），返回最像的几条的编号、标题和一小段原文；要全文再用 textbook_read。每调用一次你要多等一整轮。',
        inputSchema: { type: 'object', properties: { q: { type: 'string' }, book: { type: 'string' } }, required: ['q'] },
        async execute(input) {
          const q = String(input?.q ?? '').trim();
          staged.calls.push({ name: 'textbook_search', input: { q, book: input?.book } });
          if (!q) throw new Error('要写 q（找什么）');
          const hits = searchChunks(desk.books.chunks, q, { book: String(input?.book || '') });
          return hits.length ? { hits } : { hits: [], note: '没找到：换个说法，或者看资料包里的教材目录' };
        },
      }, {
        name: 'textbook_page',
        description: '把一条教材条目的原页图（扫描页）附在下一条消息里给你看：核对转写的数、照原页讲时用。id 写条目编号。每调用一次你要多等一整轮。要贴上黑板给学生看，用 image 组件（name 写条目编号）。',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        async execute(input) {
          const id = String(input?.id ?? '').trim();
          staged.calls.push({ name: 'textbook_page', input: { id } });
          const c = desk.books.chunks.find((x) => x.id === id);
          if (!c) throw new Error(`没有 ${id} 这一条`);
          const img = (c.img || [])[0];
          if (!img) throw new Error(`${id} 没有原页图（文稿、只有字的讲义没有）`);
          if (staged.images.length >= maxImages) throw new Error(`这一轮已经附了 ${maxImages} 张图`);
          const r = await fetch(assetUrl(String(img)));
          if (!r.ok) throw new Error('原页图没取到');
          staged.images.push(await r.blob());
          staged.ids.push(String(img));
          return { id, title: c.title, page: c.page, attachedNextMessage: 1 };
        },
      }] : []),
      {
        name: 'component_doc',
        description: '取一个组件的完整写法（课堂说明里有的组件只写了最常用的写法，末尾写着「更多写法」）。name 写组件名，比如 elim、sched、answer；黑板指令（mark 标注、figure）也能查。每调用一次你要多等一整轮，只在要用说明里没写到的字段时用；照精简版写错了，页面会自动把完整写法附在提醒里，不用先查。',
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
  async function endClass() {
    if (busy) { toast('等 Claude 说完这一轮再下课'); return; }
    if (!history.length) { toast('还没开始上课'); return; }
    if (!teacher.available) return;
    // 下课：抢跑的「继续」用不上了，先停掉（让出平台的位子给小结）
    dropSpec();
    // 已经写过小结、之后没再上课：再点「下课」先问一句（11-02 那节课小结写了两遍，第二遍又等了一分半）
    const last = [...history].reverse().find((t) => t && !t.discarded && (t.role === 'student' || t.kind === 'closing'));
    if (last?.kind === 'closing') {
      const v = await choose('这节课的小结已经写好了，下课以后没有再上课。', [{ label: '重新写一份', value: 'again' }, { label: '看小结', value: 'show', primary: true }]);
      if (v !== 'again') { if (v === 'show' && last.page) bv.show(last.page, { animate: true }); return; }
      if (busy) return;
    }
    finishBeats();
    exclusive(async () => {
      // 学习台里：下课那一刻还没提交的草稿记成证据（写了一半的不丢）。小结没写成、再点下课时，没变的草稿不重复记
      if (desk) for (const d of allDrafts()) sink.put('evidence', draftEvidence(d, evCtx(d.step)));
      // 刚作答完就点了下课（还在 1.5 秒的合并里）：这几下并进历史给小结看，不在小结之后再讲一轮
      clearTimeout(timer);
      if (queue.actions.length) {
        const actions = queue.actions.splice(0);
        addTurn({ role: 'student', text: actionsMessage(actions), say: '', actions: actions.map(actionText), page: bv.cur || undefined });
      }
      queue.triggered = false;
      queue.now = false;
      bar.setStatus('thinking', 'Claude 在写这节课的小结…');
      ensureDraft();
      ctl = new AbortController();
      // md、seq、point：下课时把判得了分的题抄进题库（desk.js 的 harvestSession）
      const steps = () => [...segs.values()].filter((x) => !String(x.id).startsWith('~')).map((x) => ({ id: x.id, page: x.page, title: x.title || x.sec?.querySelector('h2')?.textContent?.trim() || '', place: x.place, md: x.md, seq: x.seq, ...(x.point ? { point: x.point } : {}), ...(x.failed ? { failed: true } : {}), ...(x.hidden ? { hidden: true } : {}) }));
      // 学习台里：先用代码算一份课后报告放进这次的输入，小结和整理单同一次写（docs/desk-plan.md 4.2，不多调用一次）
      const repObj = desk?.makeReport ? await desk.makeReport({ turns: history, steps: steps() }).catch(() => null) : null;
      const report = repObj ? reportText(repObj) : '';
      // 这节课的一页（memory/sheet.js）：页面自己拼，写在小结那块板的下面
      const sheet = sheetMd(repObj?.sheet || lessonSheet({ steps: steps() }));
      const system = buildSystem({ rules: pack.main?.rules, componentDocs: COMPONENT_DOCS, pack: packForPrompt(false), board: boardState(), subject: session.subject, memory: memoryArg(), canvas: CANVAS, ...planArg() });
      // 每几节课（或者某一类到了上限）顺带整理：合并重复的弱点、复现组、关于学生的记录（memo.js 的 tidyDue）
      const sp = desk?.block ? spaceOfId(desk.block) : desk?.space || spaceOfId('');
      const why = desk ? tidyDue(desk.mem, sp, desk.sid) : '';
      const tidy = why ? { why, text: tidyText(desk.mem, sp) } : null;
      const fit = fitTurns({ system, history: [...promptHistory(history), { role: 'system', text: closingPrompt({ report, review: desk?.review, opening: desk?.opening, slips: desk ? slipsToFold(desk.mem, sp) : '', plan: FEATURES.plan === false ? null : latestPlan(history), tidy }) }], maxBytes: promptLimit(), stub: teacher.tools });
      // 小结边写边显示（以前要干等一两分钟才一下子出来），也记下等了多久
      const t0 = performance.now();
      firstAt = 0;
      const cost = (why) => callCost({ bytes: fit.bytes, why, ms: performance.now() - t0, first: firstAt ? firstAt - t0 : undefined });
      let res;
      try {
        res = await teacher.call(fit.turns, { ...TEACH, cache: false, signal: ctl.signal, onText: ({ text }) => drawDraft(text, 'Claude 在写这节课的小结…') });
      } catch (e) {
        dropPreviews({ rollback: true });
        failTurn(e, '下课小结', cost('failed'));
        return false;
      }
      // 小结里不执行黑板指令：边写边显示时先画上来的段（小结里写了 board add 之类）都撤掉
      dropPreviews({ rollback: true });
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
      const p = newPage({ title: '这节课的小结', kind: 'closing', body: summary, foot, ...(sheet ? { sheet } : {}) });
      ended = true;
      const closed = addTurn({ role: 'system', kind: 'closing', text: res.text, modelApplied: res.modelApplied, page: p.n, cost: cost('closing') });
      bv.show(p.n, { animate: true });
      // 整理单：都直接写进去，小结下面只有一行小字（点开能撤销）
      const memo = memoEntries.length ? await runMemo(memoEntries, closed.seq, p.n) : null;
      // 课后报告（memory/report.js，页面代码算，不调用 Claude）：sessions/{编号}/report/main
      if (desk?.writeReport) desk.writeReport({ turns: history, steps: steps() }).catch((e) => { console.warn('课后报告没写成', e); toast('课后报告没写成，回学习台首页会再试'); });
      bar.setStatus('notice', !desk ? '下课了。小结已经存好，回对话告诉 Claude「下课了」。' : '下课了。小结和课后报告已经存进学习台。');
      session.event('end', null, { turns: history.length });
      return true;
    }, { after: false });
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
      history, segs, pages, queue, boardState, flush, specState, get spec() { return spec ? { say: spec.say, text: spec.text.length } : null; }, retry: retryRun, showPage: (n) => bv.go(n), measureFit: bv.measureFit,
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
