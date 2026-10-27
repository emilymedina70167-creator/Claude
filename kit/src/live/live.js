// 实时黑板（mode: live，外部版）：页面只是一块黑板，内容一段一段从数据库来。
// 对话里的 Claude（有记忆的那个）往 steps/{id} 写一段课件 Markdown，带上写在第几块板（page）或放进常驻栏（pin）；
// 页面按课堂模式同一套「一屏一块板」摆出来（boardview.js），学生在板上作答，作答写回 answers / events。
// 对话里的 Claude 看不到页面，所以页面把它需要知道的写回数据库：写法错误 lint/{段 id}，
// 屏幕大小和当前板放不放得下 meta/screen，以及汇总的「黑板现状」meta/now（最近的作答、没提交的草稿、写法错误、
// 屏幕、交来的截图、教具指令的结果和板上的标注）——学生回对话说「好了」时，Claude 读这一份就够了。
// 老师的教具和课堂模式共用（class/boardtools.js）：对话里的 Claude 往 ops 集合写 mark / unmark / figure 指令
// （写法同课堂的 board 块），页面按 seq 执行；往 talk 集合写一句话，页面写在那块板的最上面。
// 说话主要在对话框里，黑板上不放对话，也没有页面里的「问 Claude」；学生在笔记软件里写的，用底部「交截图」交上来。
import { renderLesson, mdToHtml, escapeHtml } from '../render.js';
import { session } from '../session.js';
import { copyRecord, toast } from '../record.js';
import { getStore } from './store.js';
import { createSink } from './sync.js';
import { initDevPanel } from './devpanel.js';
import { createBoardView } from '../class/boardview.js';
import { extraProblems } from '../class/selfcheck.js';
import { createLiveBar } from './livebar.js';
import { planBoards, lintRecord, screenRecord, sameScreen, leadingHeading, statusRecord, sameStatus } from './layout.js';
import { actionText, reportable } from '../class/prompt.js';
import { draftsIn } from '../drafts.js';
import { VERSION } from '../version.js';
import { createBoardTools } from '../class/boardtools.js';
import { markText } from '../markspec.js';
import { compile } from '../expr.js';
import { parseLiveOp, opTargets, nextOps, resultLine, segSig, opKey, restorePlan, OP_WAIT, OP_SETTLE, OPS_KEEP } from './ops.js';

const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const SCREEN_DELAY = 1500; // 屏幕大小、放不放得下：停下来 1.5 秒再写，转屏、滚动时不连着写
const NOW_DELAY = 2000; // 黑板现状：有变化后 2 秒内写一次（打字、拖图时也是最多每 2 秒一次）

export async function renderLive(root, meta) {
  session.mode = 'live';
  session.live = true;
  session.stages = [];
  const unitName = meta.unit || session.title;
  root.classList.add('is-live', 'is-class');

  const steps = new Map(); // id → { id, seq, page, place, lead, title, md, hidden, sec, stage, touched, drawn（画在板上的那一版 { md, title }）}
  // 黑板现状的定时器：放在最前面，数据库一订阅就可能马上回调（回调里会排一次写）
  let nowTimer = 0;
  // 板顶的话、教具指令的状态也一样（订阅的回调里就会用到）
  const talks = new Map(); // 板号 → 板顶的话（md）
  const opDocs = new Map(); // id → ops 里的那条
  const opSeen = new Map(); // id → { key, at }：这次打开页面后第一次看到这一版的时间
  const opDone = new Map(); // id → 执行过的那一版的指纹（opKey）
  const opPlaced = new Map(); // id → 这条指令画上的标注 id（同一个 doc_id 改写成新指令时，先擦掉旧版画的）
  let opTimer = 0;
  let opsBusy = false;
  let opsLoaded = false; // 上次执行过的记录读回来、标注和图的状态放回去了
  let stepsLoaded;
  const stepsReady = new Promise((r) => { stepsLoaded = r; });
  let lastNow = null;
  let unseen = false; // 翻回旧板看的时候，当前板上来了新东西：「回到当前板」闪
  const bv = createBoardView({
    root,
    unitHtml: mdToHtml(unitName, { inline: true }),
    stageExtra: `
        <div class="class-welcome">
          <div class="live-empty-art" aria-hidden="true"><i></i><i></i><i></i></div>
          <p class="class-welcome-text">正在连接黑板…</p>
        </div>`,
    isBusy: () => unseen,
    seqOf: (id) => steps.get(id)?.seq,
    onShow: (n) => { if (n === bv.cur && unseen) { unseen = false; bv.syncNav(); } scheduleNow(); },
    onMeasure: () => scheduleScreen(),
  });
  // 教具（和课堂模式共用）：板上的标注、让图动。只动当前板和常驻栏上的东西
  const tools = createBoardTools({ bv, segs: steps });
  const welcome = root.querySelector('.class-welcome');
  const welcomeText = root.querySelector('.class-welcome-text');
  const bar = createLiveBar({ onNav: (n) => bv.go(n), onCopy: () => copyRecord(toast), onUpload: (blobs, note) => upload(blobs, note) });
  bv.attachBar(bar);

  const store = await getStore({ title: session.title });
  if (!store) {
    bar.setChip('off', '没连上');
    welcomeText.innerHTML = '这个页面没有拿到黑板的数据库权限。<br>发布时要声明 <code>capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}</code>；本地试用请在地址后面加 <code>?dev</code>。';
    return;
  }
  const sink = createSink(store);
  // 作答、动作照常写进 answers / events，同时记一行进黑板现状（写法和课堂模式发给课堂 Claude 的一样）
  session.sink = {
    ...sink,
    record(e) { const p = sink.record(e); noteAction({ source: 'record', ...e }); return p; },
    event(e) { const p = sink.event(e); noteAction({ source: 'event', ...(e.detail && typeof e.detail === 'object' ? e.detail : {}), ...e }); return p; },
  };
  bar.setChip('on', store.dev ? '本地开发' : '实时黑板');
  welcomeText.innerHTML = '黑板还是空的。<br>回对话里让 Claude 开始。';
  if (store.dev) initDevPanel(store, root);
  session.event('open', null, { title: session.title, unit: unitName });

  // 黑板设置：单元名、给页面里 Claude 的背景资料（转写手写时用）
  store.db.doc('meta/board').onSnapshot((snap) => {
    const d = snap.exists ? snap.data() : {};
    if (d.unit) root.querySelector('.class-unit').innerHTML = mdToHtml(String(d.unit), { inline: true });
    session.context = String(d.context || '');
  }, () => {});

  // 数据库里已经记着的写法检查结果：没变化就不重复写
  const lintDb = new Map();
  store.db.collection('lint').onSnapshot((snap) => {
    lintDb.clear();
    for (const d of snap.docs) lintDb.set(d.id, d.data());
    scheduleNow();
  }, () => {});

  // 黑板现状里接着上次的「最近作答」和交来的截图（刷新页面不丢）
  const recent = []; // { line, at, key }
  const uploads = []; // { id, images, note, page, at }
  const opLines = []; // 教具指令的结果，一条一行（刷新前的也接着，执行过的不再报一遍）
  const opResults = []; // 这次打开页面后的结果 { id, ok, partial, line }（本地检查脚本读）
  const seeded = store.db.doc('meta/now').get().then((snap) => {
    const d = snap.exists ? snap.data() : null;
    if (Array.isArray(d?.recent)) recent.unshift(...d.recent.filter((r) => r && r.line));
    if (Array.isArray(d?.uploads)) uploads.unshift(...d.uploads.filter((u) => u && u.id));
    if (Array.isArray(d?.ops)) opLines.unshift(...d.ops.filter((l) => typeof l === 'string' && l));
  }).catch(() => {});
  // 学生在黑板上打字、点、拖：草稿可能变了
  for (const type of ['input', 'click', 'pointerup', 'change']) root.addEventListener(type, () => scheduleNow(), { capture: true, passive: true });

  let first = true;
  store.db.collection('steps').onSnapshot((snap) => {
    apply(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    stepsLoaded();
    pumpOps();
  }, () => bar.setChip('off', '连接断了，刷新试试'));

  // —— 板顶的话：talk/{板号} = { page, md }。写在那块板的最上面；md 写空就去掉 ——
  store.db.collection('talk').onSnapshot((snap) => {
    talks.clear();
    for (const d of snap.docs) {
      const x = d.data() || {};
      const n = Number(x.page ?? d.id);
      if (Number.isInteger(n) && n >= 1) talks.set(n, String(x.md ?? ''));
    }
    syncTalks();
    bv.scheduleFit();
    scheduleNow();
  }, () => {});

  // 数据库里的段 → 板上。新出现、改了的段画出来；撤回的藏起来；换了板的挪过去
  function apply(docs) {
    const plan = planBoards(docs);
    const prevCur = bv.cur;
    const fresh = [];
    const seen = new Set();
    for (const pg of plan.pages) {
      const p = bv.ensurePage(pg.n);
      if (p.title !== pg.title || p.lead !== pg.lead) { p.title = pg.title; p.lead = pg.lead; bv.paint(p); }
    }
    syncTalks();
    const ordered = docs.filter((d) => plan.steps.has(String(d.id))).sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
    for (const d of ordered) {
      const id = String(d.id);
      const pos = plan.steps.get(id);
      seen.add(id);
      const md = String(d.md ?? '');
      const title = String(d.title ?? '').trim();
      const seq = Number(d.seq) || 0;
      let s = steps.get(id);
      if (!s) {
        s = { id, seq, page: pos.page, place: pos.place, lead: pos.lead, title, md, hidden: !!d.hidden, sec: null, stage: -1, touched: false };
        steps.set(id, s);
        if (!s.hidden) { draw(s); fresh.push(s); }
        continue;
      }
      const moved = s.page !== pos.page || s.place !== pos.place || s.seq !== seq;
      // 挪到别的板、进出常驻栏：段上的标注擦掉（同一块板上换个先后不算）
      if (s.page !== pos.page || s.place !== pos.place) tools.dropMarks(id);
      const leadChanged = s.lead !== pos.lead;
      Object.assign(s, { seq, page: pos.page, place: pos.place, lead: pos.lead });
      if (d.hidden) { hide(s); continue; }
      const wasHidden = s.hidden;
      s.hidden = false;
      if (moved && s.sec) { const sec = s.sec; sec.remove(); bv.place(s, sec); }
      const changed = md !== s.md || title !== s.title;
      if (changed || leadChanged || !s.sec?.isConnected) {
        s.md = md;
        s.title = title;
        // 学生已经在这一段里作答了：内容的更新先不自动替换，免得作答被冲掉
        if (s.touched && s.sec?.isConnected && changed) markUpdated(s);
        else if (!s.touched || !s.sec?.isConnected) { draw(s); fresh.push(s); }
      } else if (wasHidden) {
        s.sec.hidden = false;
        fresh.push(s);
      }
    }
    for (const [id, s] of steps) if (!seen.has(id)) hide(s);
    // 段都撤回了的板拿掉（先定好当前板：正看着被拿掉的板时，翻到新的当前板）
    bv.cur = plan.cur;
    const live = new Set(plan.pages.map((p) => p.n));
    for (const n of [...bv.pages.keys()]) if (!live.has(n)) bv.removePage(n);
    welcome.hidden = plan.pages.length > 0 || [...steps.values()].some((s) => !s.hidden && s.place === 'pin');
    bv.syncPins();
    announce(fresh, prevCur);
    first = false;
    bv.syncNav();
    bv.scheduleFit();
    scheduleNow();
  }

  // 换了新板：翻过去从头看。当前板上加了段：正看着就滚到刚好露出来，在看旧板就让「回到当前板」闪
  function announce(fresh, prevCur) {
    if (!bv.cur) return;
    if (first || !bv.pages.has(bv.view)) { bv.show(bv.cur, { scroll: !first }); return; }
    if (bv.cur > prevCur) { unseen = false; bv.show(bv.cur, { animate: true }); return; }
    const here = fresh.filter((s) => s.place === 'board' && s.page === bv.cur && s.sec);
    if (!here.length) return;
    if (bv.view === bv.cur) {
      const sec = here.at(-1).sec;
      requestAnimationFrame(() => {
        const r = sec.getBoundingClientRect();
        if (r.bottom > window.innerHeight - bar.height || r.top < 0) sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
      });
    } else {
      unseen = true;
      toast('当前板上有新内容');
    }
  }

  function hide(s) {
    tools.dropMarks(s.id);
    if (s.hidden && !s.sec?.isConnected) return;
    s.hidden = true;
    if (s.sec) s.sec.hidden = true;
  }

  // 一块板的第一段的标题就是板的标题，写在板头上；同一块板上后面的段照常有自己的小标题。
  // 板上第一段开头又写了一样的 ## 小标题（或者板的标题就是从它来的）：去掉，免得写两遍
  function segSource(s) {
    if (s.place !== 'pin' && s.lead) {
      const h = leadingHeading(s.md);
      return h && (!s.title || h === s.title) ? s.md.trimStart().replace(/^##[^\n]*\n?/, '') : s.md;
    }
    if (/^##\s+/m.test(s.md) || !s.title) return s.md;
    return `## ${s.title}\n\n${s.md}`;
  }

  // 画在板上的这一段现在是什么样：指令执行时记下来，刷新后段变了（改了内容、挪了板、撤回了）就不再放回标注和图的状态
  function sigOf(id) {
    const s = steps.get(String(id));
    return s && !s.hidden && s.sec?.isConnected && s.drawn ? segSig({ page: s.page, place: s.place, title: s.drawn.title, md: s.drawn.md }) : undefined;
  }

  function draw(s) {
    const old = s.sec;
    // 内容没变、只是重画（板的第一段换了、段从页面上掉了）：标注照原样放回去；内容变了就擦掉
    const same = s.drawn && s.drawn.md === s.md && s.drawn.title === s.title;
    const keep = same ? [...tools.marks.values()].filter((m) => m.seg === s.id) : [];
    tools.dropMarks(s.id);
    if (s.stage < 0) { s.stage = session.stages.length; session.stages.push({ id: s.id, title: '', src: '', el: null }); }
    const i = s.stage;
    const sec = document.createElement('section');
    sec.className = `stage live-step class-seg${s.place === 'pin' ? ' class-pin' : ''}`;
    sec.dataset.step = s.id;
    sec.dataset.stage = i;
    sec.innerHTML = '<div class="stage-body"></div>';
    const src = segSource(s);
    Object.assign(session.stages[i], { title: s.title || (s.md.match(/^##\s+(.+)$/m)?.[1] || '').trim(), src, el: sec });
    session.problems = session.problems.filter((p) => p.stage !== i);
    for (const [k, sc] of session.scenes) if (sc.stage === i || (old && old.contains(sc.el))) session.scenes.delete(k);
    bv.place(s, sec); // 替换时放在旧的后面
    old?.remove();
    s.sec = sec;
    s.touched = false;
    try {
      renderLesson(src, sec.querySelector('.stage-body'));
    } catch (e) {
      console.error(e);
      session.problems.push({ stage: i, title: s.title, kind: '渲染', msg: `这段画不出来：${e?.message || e}` });
    }
    if (s.place !== 'pin') bv.splitFigure(sec.querySelector('.stage-body'));
    s.drawn = { md: s.md, title: s.title };
    for (const m of keep) tools.placeMark({ ...m.spec, id: m.id }, { animate: false, restore: true });
    const problems = [...session.problems.filter((p) => p.stage === i), ...extraProblems(sec)];
    showLint(s, problems);
    reportLint(s, problems);
    // 学生动过这一段（输入、点按钮、拖图、写字）之后，内容更新不再自动替换
    const touch = () => { s.touched = true; };
    sec.addEventListener('input', touch);
    sec.addEventListener('click', (e) => { if (e.target.closest('.widget button, .widget .opt')) touch(); });
    sec.addEventListener('pointerdown', (e) => { if (e.target.closest('.handle, .pad-area, input[type=range]')) touch(); });
  }

  // 写错的地方：这一段顶上列出来（Claude 自己也会在数据库里读到）
  function showLint(s, problems) {
    const hard = problems.filter((p) => !p.soft);
    if (!hard.length) return;
    const text = `黑板上「${s.id}」这一段有 ${hard.length} 处写法问题：\n` + hard.map((p, k) => `${k + 1}. ${p.kind}：${p.msg}`).join('\n');
    const b = document.createElement('div');
    b.className = 'lint lint-step';
    b.innerHTML = `<div class="lint-head"><strong>这一段有 ${hard.length} 处写法问题</strong><button type="button" class="btn btn-sm lint-copy">复制给 Claude</button></div><ol>${hard.map((p) => `<li>${escapeHtml(`${p.kind}：${p.msg}`)}</li>`).join('')}</ol><p class="lint-note">对话里的 Claude 写完会读到这些，一般会自己改；没改再复制给它。</p>`;
    b.querySelector('.lint-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); toast('已复制，去对话里粘贴给 Claude'); } catch { toast('没能复制，请手动选中文字'); }
    });
    s.sec.prepend(b);
  }

  // 写回数据库：lint/{段 id}。有问题、或者以前的问题改好了才写
  function reportLint(s, problems) {
    const rec = lintRecord(s.id, s.title, problems.map((p) => ({ kind: p.kind, msg: p.msg, soft: !!p.soft })), lintDb.get(s.id));
    if (!rec) return;
    lintDb.set(s.id, rec);
    sink.put('lint', { ...rec, at: Date.now() });
    scheduleNow();
  }

  function markUpdated(s) {
    if (s.sec.querySelector('.live-updated')) return;
    const b = document.createElement('div');
    b.className = 'live-updated';
    b.innerHTML = '<span>Claude 改了这一段。你已经在这里作答，所以先没替换。</span><button type="button" class="btn btn-sm btn-primary">看新版本</button>';
    b.querySelector('button').addEventListener('click', () => { draw(s); bv.scheduleFit(); });
    s.sec.append(b);
  }

  // —— 板顶的话：写在那块板的最上面（课堂模式那一行），不标模型（说话的是对话里的 Claude）——
  function syncTalks() {
    for (const p of bv.pages.values()) {
      const md = (talks.get(p.n) || '').trim();
      if (p.talk === md && !p.talkBy) continue;
      p.talk = md;
      p.talkBy = '';
      bv.paint(p);
      // 公式写错、\calc 算不出来：学生看到红字，结果里告诉对话里的 Claude
      const bad = [...p.talkEl.querySelectorAll('.calc-error, .katex-error, .tex-error')].slice(0, 3)
        .map((e) => e.dataset.calcError || `$${e.textContent.trim().slice(0, 60)}$ 写不出来（${String(e.getAttribute('title') || '').replace(/^ParseError:\s*/, '').slice(0, 120)}）`);
      // 刷新后重画同一句不再报一遍（报过的在接着的结果里）
      const line = `talk ${p.n}：板顶的话里有写法错误（学生看到的是红字）：${bad.join('；')}`;
      if (bad.length) seeded.then(() => { if (!opLines.includes(line)) { noteOp(line); opResults.push({ id: `talk ${p.n}`, ok: false, line }); } });
    }
  }

  // —— 教具指令：ops/{id} = { seq, cmd, body }，写法同课堂模式的 board 块（只收 mark / unmark / figure）——
  // 按 seq 依次执行；指向的段、组件还没画出来就先等（最多 OP_WAIT），前一条在等，后面的也等。
  // 执行过的记在 ops_done/{id}（刷新后只把标注、图的状态放回去，不再报一遍结果）
  // 打开页面时：等第一批段画好、上次执行过的记录读回来，先把标注和图的状态放回去，再执行新的指令
  (async () => {
    let recs = [];
    try { recs = (await store.db.collection('ops_done').get()).docs.map((d) => ({ id: d.id, ...d.data() })); } catch { recs = []; }
    await Promise.all([stepsReady, seeded]);
    for (const r of recs) {
      if (r.key) opDone.set(String(r.id), r.key);
      if (r.kind === 'mark') opPlaced.set(String(r.id), (r.marks || []).map((m) => m.id));
    }
    try { restoreOps(recs); } catch (e) { console.error(e); }
    opsLoaded = true;
    pumpOps();
  })();
  store.db.collection('ops').onSnapshot((snap) => {
    opDocs.clear();
    const now = Date.now();
    for (const d of snap.docs) {
      const doc = { id: d.id, ...d.data() };
      opDocs.set(d.id, doc);
      const key = opKey(doc);
      if (opSeen.get(d.id)?.key !== key) opSeen.set(d.id, { key, at: now });
    }
    pumpOps();
  }, () => {});

  function restoreOps(recs) {
    const plan = restorePlan(recs, sigOf);
    plan.ids.forEach((id) => tools.bumpSeq(id));
    session.replaying = true;
    try {
      for (const f of plan.figures) {
        const el = bv.board.querySelector(`.class-seg:not([hidden]) [data-bid="${CSS.escape(f.target)}"][data-scene]`);
        const api = el && session.scenes.get(el.dataset.scene)?.api;
        if (!api) continue;
        try {
          if (f.action === 'play') api.set(f.args.name, f.args.to ?? 1);
          else for (const [name, src] of Object.entries(f.args.assigns || {})) api.set(name, compile(src)((api.vars || api.snapshot)?.call(api) || {}));
        } catch { /* 放不回去就保持初始的样子 */ }
      }
    } finally {
      session.replaying = false;
    }
    // 图回到刷新前的样子了，再把标注画回去（标在图上的要按图现在的样子摆）
    for (const m of plan.marks) tools.placeMark({ ...m.spec, id: m.id }, { animate: false, restore: true });
    scheduleNow();
  }

  const isDone = (d) => opDone.get(String(d.id)) === opKey(d);
  // 目标在不在黑板上：段（撤回的也算，执行时说「已经撤回」）、组件；组件写在已经画了的段里却没画出来（写法错误）也算到了
  function targetState(t) {
    if (steps.has(t)) return { ok: true };
    if (bv.board.querySelector(`.class-seg [data-bid="${CSS.escape(t)}"]`)) return { ok: true };
    const re = new RegExp(`^[ \\t]*id[ \\t]*[:：][ \\t]*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm');
    const home = [...steps.values()].find((s) => s.sec?.isConnected && re.test(s.drawn?.md || ''));
    if (home) return { ok: false, broken: `${t} 没画出来：它所在的 ${home.id} 有写法错误，见 lint，先改好 ${home.id}` };
    return { ok: false };
  }

  function pumpOps() {
    if (opsBusy || !opsLoaded) return;
    opsBusy = true;
    try {
      clearTimeout(opTimer);
      opTimer = 0;
      for (const d of nextOps([...opDocs.values()], isDone)) {
        const p = parseLiveOp(d);
        if (p.error) { finishOp(d, { ok: false, error: p.error }); continue; }
        const age = Date.now() - (opSeen.get(d.id)?.at ?? 0);
        if (age < OP_SETTLE) { opTimer = setTimeout(pumpOps, OP_SETTLE - age + 20); break; }
        const states = opTargets(p.op).map((t) => [t, targetState(t)]);
        const broken = states.find(([, st]) => st.broken);
        if (broken) { finishOp(d, { ok: false, error: broken[1].broken }); continue; }
        const missing = states.filter(([, st]) => !st.ok).map(([t]) => t);
        if (missing.length && age < OP_WAIT) { opTimer = setTimeout(pumpOps, 250); break; }
        if (missing.length) { finishOp(d, { ok: false, error: `${missing.join('、')} 还没画出来：等了 ${OP_WAIT / 1000} 秒，黑板上还没有它；段要先写进 steps，组件要写 id:` }); continue; }
        runOp(d, p.op);
      }
    } finally {
      opsBusy = false;
    }
  }

  function runOp(d, op) {
    // 学生正看着当前板才播动画；在看旧板时直接画成最后的样子（翻回来看到结果就行）
    const animate = bv.view === bv.cur && !document.hidden;
    const notes = [];
    // 改写了一条执行过的指令（多半是改错）：旧版画的标注先擦掉，免得新旧两份都在板上
    const old = opPlaced.get(String(d.id)) || [];
    if (old.length) tools.unmarkOp({ ids: old.filter((id) => tools.marks.has(id)) });
    let res;
    try {
      res = op.op === 'mark' ? tools.markOp(op, { animate })
        : op.op === 'unmark' ? tools.unmarkOp(op)
          : tools.figureOp(op, notes, { animate });
    } catch (e) {
      console.error(e);
      res = { ok: false, error: `执行出错：${e?.message || e}` };
    }
    finishOp(d, res, notes, op);
  }

  // 记下执行过了：结果写进黑板现状，标注和图的改动写进 ops_done（刷新后放回去用）
  function finishOp(d, res, notes = [], op = null) {
    const id = String(d.id);
    const key = opKey(d);
    opDone.set(id, key);
    const line = resultLine(id, d.cmd, res, notes);
    noteOp(line);
    opResults.push({ id, ok: !!res?.ok, partial: !!(res?.ok && res.error), line });
    const rec = { id, seq: Number(d.seq) || 0, key, ok: !!res?.ok, at: Date.now() };
    opPlaced.set(id, res?.op === 'mark' ? (res.marks || []).map((m) => m.id) : []);
    if (res?.op === 'mark') {
      rec.kind = 'mark';
      rec.marks = (res.marks || []).map((m) => ({ id: m.id, seg: m.seg, spec: m.spec, sig: sigOf(m.seg) ?? null }));
    } else if (res?.op === 'unmark') {
      rec.kind = 'unmark';
      rec.ids = res.ids || [];
    } else if (res?.op === 'figure' && res.ok && op && (op.action === 'set' || op.action === 'play')) {
      const seg = bv.board.querySelector(`.class-seg:not([hidden]) [data-bid="${CSS.escape(op.target)}"][data-scene]`)?.closest('[data-step]')?.dataset.step || '';
      Object.assign(rec, { kind: 'figure', action: op.action, target: op.target, args: res.args, seg, sig: sigOf(seg) ?? null });
    }
    sink.put('ops_done', rec);
  }

  function noteOp(line) {
    opLines.push(line);
    if (opLines.length > OPS_KEEP * 3) opLines.splice(0, opLines.length - OPS_KEEP * 3);
    scheduleNow();
  }

  // 本地检查（tools/check-lesson.mjs）：等页面把写进来的指令都处理完再看
  if (store.dev) window.LAKitLive = { pendingOps: () => (opsLoaded ? nextOps([...opDocs.values()], isDone).length : -1), results: () => opResults.slice() };

  // 黑板现状里的标注：一段一行，按段的先后
  function currentMarks() {
    const by = new Map();
    for (const m of tools.marks.values()) {
      if (!by.has(m.seg)) by.set(m.seg, []);
      by.get(m.seg).push(markText(m.id, m.spec));
    }
    return [...by.entries()].sort((a, b) => (steps.get(a[0])?.seq ?? 0) - (steps.get(b[0])?.seq ?? 0)).map(([step, list]) => ({ step, list }));
  }
  // 当前板和常驻栏上的图，能用 figure set / play 改的变量
  function currentFigures() {
    const out = [];
    for (const s of [...steps.values()].sort((a, b) => a.seq - b.seq)) {
      if (s.hidden || !s.sec?.isConnected || !(s.place === 'pin' || s.page === bv.cur)) continue;
      for (const b of s.sec.querySelectorAll('.block[data-bid][data-scene]')) {
        const vars = tools.figureVars(b);
        if (vars) out.push({ id: b.dataset.bid, kind: [...b.classList].find((c) => c.startsWith('block-'))?.slice(6) || '', step: s.id, vars });
      }
    }
    return out;
  }

  // —— 屏幕大小和当前板放不放得下：写回 meta/screen，对话里的 Claude 照着控制一块板写多少 ——
  let screenTimer = 0;
  let lastScreen = null;
  function scheduleScreen() {
    clearTimeout(screenTimer);
    screenTimer = setTimeout(reportScreen, SCREEN_DELAY);
  }
  function reportScreen() {
    const fit = bv.fit;
    const rec = screenRecord({ w: window.innerWidth, h: window.innerHeight, board: fit ? { w: fit.w, h: fit.avail } : null, page: bv.cur, fit: bv.cur ? fit : null });
    if (sameScreen(rec, lastScreen)) return;
    lastScreen = rec;
    sink.put('meta', { ...rec, at: Date.now() });
    scheduleNow();
  }

  // —— 黑板现状 meta/now：对话里的 Claude 一次 get 就知道学生那边的全部情况 ——
  // 有变化后最多 2 秒写一次：已经排着就不往后推（学生一直在打字、拖图时也不会一直不写）；写的时候取最新的状态
  function scheduleNow() {
    if (nowTimer) return;
    nowTimer = setTimeout(() => { nowTimer = 0; writeNow(); }, NOW_DELAY);
  }
  function noteAction(a) {
    if (reportable(a)) {
      const line = actionText(a);
      // 连着拖同一个点只留最后一次，免得几次拖动把真正的作答挤出去
      const key = a.source === 'event' && a.type === 'drag' ? `drag:${a.block ?? ''}:${a.name ?? ''}` : '';
      if (key && recent.at(-1)?.key === key) recent.pop();
      if (line) recent.push({ line, at: Date.now(), ...(key ? { key } : {}) });
      if (recent.length > 60) recent.splice(0, recent.length - 60);
    }
    scheduleNow();
  }
  function currentDrafts() {
    const out = [];
    for (const s of [...steps.values()].sort((a, b) => a.seq - b.seq)) {
      if (!s.sec?.isConnected || s.hidden) continue;
      for (const b of s.sec.querySelectorAll('.block[data-bid]')) {
        for (const d of draftsIn(b)) out.push({ step: s.id, block: b.dataset.bid, label: d.label, text: d.text });
      }
    }
    return out;
  }
  async function writeNow() {
    await seeded;
    const pages = [...bv.pages.values()].sort((a, b) => a.n - b.n).map((p) => ({ n: p.n, title: p.title }));
    const lint = [...lintDb.values()].filter((l) => { const s = steps.get(String(l.step ?? l.id)); return s && !s.hidden; });
    const rec = statusRecord({ cur: bv.cur, view: bv.view, pages, recent, drafts: currentDrafts(), lint, screen: lastScreen, uploads, kit: VERSION, ops: opLines, marks: currentMarks(), figures: currentFigures() });
    if (sameStatus(rec, lastNow)) return;
    lastNow = rec;
    sink.put('meta', { ...rec, at: Date.now() });
  }

  // —— 交截图：图存进 assets，记一条 uploads，黑板现状里列出来（对话里的 Claude 用 asset id 看原图）——
  async function upload(blobs, note) {
    if (!store.assets) throw new Error('这个页面存不了图：发布时要声明 assets');
    const ids = [];
    for (const b of blobs) {
      try { ids.push((await store.assets.upload(b, { type: b.type || 'image/png' })).id); } catch { /* 这一张没传上 */ }
    }
    if (!ids.length) throw new Error('图没传上，检查一下网络再交一次');
    const rec = { id: `up-${Date.now().toString(36)}`, images: ids, note: note || '', page: bv.view || bv.cur || 0, at: Date.now() };
    const ok = await sink.put('uploads', rec);
    if (ok === false) throw new Error('没存上，再交一次');
    await seeded;
    uploads.push(rec);
    if (uploads.length > 20) uploads.splice(0, uploads.length - 20);
    scheduleNow();
    toast(ids.length < blobs.length ? `交了 ${ids.length} 张（有 ${blobs.length - ids.length} 张没传上）。回对话说一声` : '已交给 Claude，回对话说一声');
  }
}
