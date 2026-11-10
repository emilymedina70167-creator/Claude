// 舞台课按事件叫老师（docs/stage-plan.md E 段）：学生在画面上随时动，做的事攒着，要老师接的时候一起发；老师边写边演；
// 学生在老师想的时候又做了要老师接的事、那一轮还一行没演，就作废那一轮带上新的再要；以「接着」结尾的一轮趁学生看的时候先把下一轮要来。
// 学习台的舞台课（classroom.js）和样子页的 Opus 上课（proto/stage/live.js）用的是这同一份：
// 以前样子页自己一轮一轮地等「这一问的回答」，遇上挑战（做到了是 cancel，不是回答）就停住了。
//
// host 给的：
//   stage                          舞台
//   call(input, opts) → res        叫老师（res.text、res.modelApplied）；没有就 null
//   messages({ next }) → input     拼好发给老师的整份（说明 + 对话；next 是还没存进对话的那一条学生的）
//   addTurn(row) → row             存一轮（带上 seq）；putTurn(row) 改一轮
//   runMemo?(text, seq)            老师这一轮的 memo 块写进记忆
//   thinking(on)、note(text)        「老师在想」、一行提示
//   cost({ bytes, why, ms, first }) 记这一次调用花了多少
//   report?(err, info)             出错记一笔
//   evidence?.goal(id, goal, seq) / evidence?.act(a, seq)   记成证据（学习台）
//   mock、model、teach（叫老师的参数）、quietMs、readOnly
import { HELP } from './stage.js';
import { turnMessage, gridsOf } from './doc.js';
import { eventOf, triggers, eventsText, tryCount, hasWork, undoneOf, TRY_MAX, QUIET_MS } from './events.js';
import { shapeText } from './goal.js';

const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null;
/**
 * 这一段学生做的事带着的「跟着变的」（stage.js 挂在每一下上的 act.derived）摊成一张，doc.js 的 turnMessage 再按东西写
 * （一格一行，矩阵变了一半以上写整张：要舞台现在每张矩阵的数，gridsOf）。
 * 撤回了的那一下（undone）不算：舞台已经退回去了，再写它引起的变化就和 [舞台现在] 对不上
 */
const derivedOf = (events) => events.flatMap((e) => (e.undone ? [] : e.act?.derived || []));
const bytes = (s) => (enc ? enc.encode(String(s)).length : String(s).length);
export const RETRY = new Set(['再试一次', '再要一次']);

export function createLoop(host) {
  const { stage } = host;
  const quietMs = host.quietMs || QUIET_MS;
  const S = {
    ended: false,
    busy: false,
    flight: null, // 正在叫老师：{ stale, playing }
    pending: null, // { row, events, base }：这一段学生做的事（row 是存着的那条学生轮，刷新也在）
    logFrom: stage.log.length, // 这一段学生的行从 stage.log 的哪里开始
    lastErrors: [], // 老师上一轮没演的行（跟着下一条告诉老师）
    armedAt: 0, // 老师上一轮演完的时候
    lastClaude: 0, // 老师最近那一轮的 seq（证据的 S 编号）
    spec: null, // 提前想好的下一轮
    playing: Promise.resolve(), // 老师那一轮演完、存好
    idleTimer: null,
    saveTimer: null,
    flushing: false,
  };
  const inBytes = (input) => input.reduce((n, m) => n + bytes(m.content), 0);

  // —— 叫老师写一轮：边写边演 → 核验 → 记忆块 → 演完存好。学生答了什么不在这里等：事件来了 flush 再叫 ——
  // pre：提前想好的那一轮（spec）接上来，写过的先演、接着流式演
  async function teach(why = 'turn', pre = null) {
    if (!host.call) { host.note?.('这里调不了 Claude：要在 claude.ai 里打开这节课。'); return null; }
    S.busy = true;
    clearTimeout(S.idleTimer);
    for (let tries = 0; ; tries++) {
      const input = pre?.input || host.messages({});
      const nb = inBytes(input);
      const turn = stage.begin();
      const mark = turn.mark;
      const t0 = pre?.t0 ?? performance.now();
      let first = null;
      const f = S.flight = { stale: false, playing: false };
      host.thinking?.(true);
      stage.onLine = () => { host.thinking?.(false); f.playing = true; };
      const onText = ({ text }) => {
        if (f.stale && !f.playing) return; // 已经过时：先不演，等它写完扔掉
        if (first === null && text.trim()) first = performance.now();
        turn.push(text);
      };
      let res;
      try {
        res = pre ? await pre.attach(onText) : await host.call(input, { ...host.teach, cache: false, onText });
      } catch (err) {
        S.flight = null;
        if (f.playing) { await turn.abort(); dropNotes(turn.turn); } else turn.drop();
        host.thinking?.(false);
        host.addTurn({ role: 'system', kind: 'error', discarded: true, text: `调用出错：${err?.message || err?.code || err}`, cost: host.cost({ bytes: nb, why: 'failed', ms: performance.now() - t0 }) });
        host.report?.(err, { what: '舞台课调用 Claude' });
        S.busy = false;
        if (S.ended) return null;
        const again = await stage.play('ask next "老师那边没连上。点一下再试。" button="再试一次"', { unpick: false });
        if (again.act?.type === 'next' && !S.ended) return teach(why);
        return null;
      }
      S.flight = null;
      if (S.ended) { turn.drop(); host.thinking?.(false); S.busy = false; return null; }
      const cost = { ...host.cost({ bytes: nb, why, ms: performance.now() - t0, first: first ? first - t0 : undefined }), ...(pre?.spec ? { spec: 'hit' } : {}) };
      pre = null;
      // 学生在老师想的时候又做了要老师接的事、这一轮还一行没演：不演了（学生这期间动过的不退），带上新的再要
      if (f.stale && !f.playing) {
        turn.drop();
        host.thinking?.(false);
        host.addTurn({ role: 'system', kind: 'stale', discarded: true, text: '学生在老师想的时候又做了事：这一轮写的已经过时，没演', cost: { ...cost, why: 'stale' } });
        S.busy = false;
        return flush();
      }
      // 只能是指定的模型（Opus 5.5）：不是就整轮作废（先画上去的也退回去），再要一次（最多两次，不加退路模型）
      if (!host.mock && res?.modelApplied !== host.model) {
        if (f.playing) { await turn.abort(); dropNotes(turn.turn); } else turn.drop();
        host.thinking?.(false);
        host.addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，这一轮作废', modelApplied: res?.modelApplied || null, cost: { ...cost, why: 'failed' } });
        if (tries < 2) continue;
        S.busy = false;
        const again = await stage.play('ask next "这一轮不是 Opus 5.5 写的，作废了。点一下再要一次。" button="再要一次"', { unpick: false });
        if (again.act?.type === 'next' && !S.ended) return teach(why);
        return null;
      }
      const text = res.text || '';
      // 这一轮写完就先存下（演的时候刷新不能丢）；演完、挂好那一问，再补上演了的行（中间学生动的也在里面，先后照实）
      let donePlay;
      S.playing = new Promise((r) => { donePlay = r; });
      const ended0 = turn.end(text);
      const claude = host.addTurn({ role: 'claude', text, modelApplied: res.modelApplied || 'mock', cost });
      // 老师写着的时候学生攒下的那一段，存成的学生轮在老师这一轮前面：挪到后面（发给老师的对话照先后，最后一条是学生的）
      if (S.pending && S.pending.row.seq < claude.seq) movePending();
      S.lastClaude = claude.seq;
      await host.runMemo?.(text, claude.seq);
      host.thinking?.(false);
      S.busy = false;
      await Promise.race([turn.armed, ended0]);
      claude.log = stage.log.slice(mark);
      host.putTurn(claude);
      S.logFrom = stage.log.length;
      if (S.pending) { S.pending.base = []; savePending(true); }
      S.lastErrors = [...stage.errors];
      S.armedAt = performance.now();
      donePlay();
      if (S.pending?.events.some(triggers)) { flush(); return claude; }
      armIdle();
      maybeSpec();
      return claude;
    }
  }

  // —— 页面记下的一句（老师演的那一下改了学生先点的几样，stage.js 的 onNote）：不叫老师、不算「试」，跟着下一条发 ——
  // quiet：攒着它不挡提前想（发出去的整条照样带着它，对得上）。「再看一遍」重演同一行又来一句一样的：不重复记
  function onNote(text, { turn } = {}) {
    if (S.ended || host.readOnly || !text) return;
    if (S.pending?.events.some((e) => e.kind === 'note' && e.text === text && e.turn === turn)) return;
    addEvent({ kind: 'note', text, at: Date.now(), quiet: true, ...(turn != null ? { turn } : {}) });
  }
  // 作废的那一轮演过的行退回去了：它演的时候记下的几句也不算（不然告诉老师一个已经退回去的变化）
  function dropNotes(no) {
    const p = S.pending;
    if (!p) return;
    const n = p.events.length;
    p.events = p.events.filter((e) => !(e.kind === 'note' && e.turn === no));
    if (p.events.length !== n) savePending(true);
  }

  // —— 学生做的事：答了问的、做到挑战马上叫老师；试（拨、拖、点开看）攒着 ——
  function addEvent(e) {
    if (!S.pending) S.pending = { row: host.addTurn({ role: 'student', pending: true, text: '', events: [] }), events: [], base: [] };
    S.pending.events.push(e);
    savePending();
  }
  /**
   * 这一段的学生轮挪到最新：原来那一条作废（刷新、拼对话都不再看它），换一条新的 seq 接着攒。
   * 学生轮一有事就先存（刷新也在），所以老师那一轮还在写时就有了一条，seq 比老师那一轮小
   */
  function movePending() {
    const p = S.pending;
    clearTimeout(S.saveTimer);
    Object.assign(p.row, { discarded: true, moved: true });
    host.putTurn(p.row);
    p.row = host.addTurn({ role: 'student', pending: true, text: '', events: p.events, log: p.row.log || [] });
    savePending(true);
  }
  // 还没发出去的那一段也存着（刷新以后接着攒）；连着拨的时候攒一会儿再写
  function savePending(now = false) {
    clearTimeout(S.saveTimer);
    const go = () => { const p = S.pending; if (!p) return; Object.assign(p.row, { events: p.events, log: [...p.base, ...stage.log.slice(S.logFrom)] }); host.putTurn(p.row); };
    if (now) go(); else S.saveTimer = setTimeout(go, 800);
  }
  /** 这一段做成一条学生轮（发给老师的整条在 msg 里） */
  function finalize() {
    const p = S.pending;
    const events = p.events;
    // 学生点「接着」叫的老师：不写过了几秒（提前想好的那一轮才对得上）
    const byNext = events.at(-1)?.act?.type === 'next';
    const said = eventsText(events, { goals: stage.scene.goals, secs: byNext || !S.armedAt ? null : Math.round((performance.now() - S.armedAt) / 1000) });
    // 页面核过老师上一轮的几步（不是正确的下一步的）、学生动了以后跟着变的：一起写进这一条，核过的说过就清掉
    const msg = turnMessage({ act: said, state: stage.scene.stateText(), errors: S.lastErrors, audit: stage.teacherAudit || [], derived: derivedOf(events), grids: gridsOf(stage.scene) });
    stage.teacherAudit = [];
    const say = events.filter((e) => e.act?.type === 'say').map((e) => e.act.text).join('\n');
    clearTimeout(S.saveTimer);
    Object.assign(p.row, { pending: false, text: said, msg, events, log: [...p.base, ...stage.log.slice(S.logFrom)], ...(say ? { say } : {}) });
    host.putTurn(p.row);
    S.pending = null;
    S.logFrom = stage.log.length;
    S.lastErrors = [];
    return p.row;
  }
  // 有要老师接的事：等预写的行演完、学生那一下落定，发出去。老师正在想：还一行没演就作废那一轮（写完了自己再来叫）
  async function flush() {
    if (S.ended || host.readOnly || !S.pending?.events.some(triggers)) return;
    if (S.flight) { if (!S.flight.playing) S.flight.stale = true; return; }
    if (S.busy || S.flushing) return;
    S.flushing = true;
    clearTimeout(S.idleTimer);
    let pre = null;
    try {
      await S.playing;
      await Promise.all([stage.reacting, stage.studentChain]).catch(() => {});
      // 等的时候那件事可能已经攒起来了（预写演完，学生手上又有事：settle 把它记成 quiet）：没有要老师接的就不叫
      if (S.ended || !S.pending || S.flight || S.busy || !S.pending.events.some(triggers)) return;
      const row = finalize();
      // 提前想好的那一轮：学生真的只点了「接着」、发出去的一字不差，接上
      if (S.spec && !S.spec.dead && S.spec.msg === row.msg) pre = adopt(S.spec);
      dropSpec();
    } finally { S.flushing = false; }
    if (!S.ended && !S.flight && !S.busy) teach('turn', pre);
  }
  /**
   * 做到挑战、做完、答对一问以后，学生手上还有事就攒着，没事了才叫老师（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 6.2）。
   * 等预写的行演完再看（events.js 的 hasWork）：挑战写了 call=now 就马上叫；还有事：这件事 quiet、记下那时有什么事（held，
   * 跟着下一条告诉老师「没叫你」），舞台手上没有一问时替它挂「给个提示」（学生还能打字）；没事了：挂着的 ask next 先收起，叫老师
   */
  function settle(e, { now = false, reacts = null } = {}) {
    // 预写演之前等着的那一问：演完换成了预写挂的 ask next，是学生要按的那一下（freshNext）
    const w0 = stage.scene.waiting;
    Promise.resolve(stage.reacting).then(() => {
      if (S.ended || host.readOnly) return;
      // 预写的行真演了几行（演不上的舞台记了 missed，也另告诉了老师）：照实写，不说「演了 N 行」的假话
      if (reacts?.length) {
        const n = reacts.filter((r) => !r.missed).length;
        if (n !== e.reacted) { e.reacted = n; e.missed = reacts.length - n; savePending(true); }
      }
      const held = now ? [] : [...hasWork(stage.scene), ...freshNext(w0)];
      if (held.length) {
        e.quiet = true;
        e.held = held;
        savePending(true);
        if (!S.flight && !S.busy) stage.holdAsk?.();
        armIdle();
        maybeSpec();
        return;
      }
      if (stage.scene.waiting?.kind === 'next') stage.cancelWait?.();
      flush();
    });
  }
  /**
   * 预写刚挂出来的 ask next（@g1 ask next "看好了点下面" button="看到了"）：老师要学生读完那一句、自己按一下再接着讲，是学生手上的一件事
   * （以前一做到挑战就当学生按了它、收起来叫老师：那一句还没读完按钮就没了，老师的下一轮紧跟着盖上来）。
   * 早就挂着的 ask next（老师这一轮写的「拼好点下面」、以前预写挂的）照旧不算：学生做到了就当按了它（设计 6.2）
   */
  const freshNext = (w0) => {
    const w = stage.scene.waiting;
    return w && w !== w0 && w.pre && w.kind === 'next' ? [`你预写的「${w.button || '接着'}」还没按`] : [];
  };
  const callNow = (ids) => ids.some((id) => stage.scene.goals.get(id)?.call === 'now');
  function onAnswer(act, w, { reacts = null } = {}) {
    if (S.ended || RETRY.has(act.button)) return;
    const e = eventOf(act, { help: HELP, at: Date.now() });
    addEvent(e);
    // 按了按钮才判的挑战（on=）做到了：和别的挑战一样看学生手上还有没有事；没做到照常叫老师（这一下本身是回答）
    const met = e.kind === 'answer' ? (act.onGoals || []).filter((x) => x.met).map((x) => x.id) : [];
    if (met.length) { settle(e, { now: callNow(met) }); return; }
    // 答对了、页面演了 @ask.right 预写的行：学生手上还有事就攒着
    if (e.kind === 'answer' && act.reacted) { e.reacted = act.reacted; settle(e, { reacts }); return; }
    flush();
  }
  // 交给学生做的东西（open t rotate、open M rowop……）做完了（规则说没有下一步了）：学生手上没事了才叫老师（预写了 @t.done 的演完再看）。
  // 老师做完的不叫（预写的行也不演，舞台告诉老师「@t.done 的行没演」）
  // 键盘填的空格子写满了（filled，scene.js 的 fillOpen）也是这一件：写给老师「空格子都写满了」
  // before：这一次没有预写可演、上一次做完时演过（或老师那一轮做完时拿掉了）的（scene.js 的 doneBefore）：写给老师照实说
  function onDone(ids, { by = 'student', instant, reacted = 0, reacts = null, filled = [], ruled = [], before = null } = {}) {
    if (instant || S.ended || host.readOnly || by !== 'student') return;
    const e = { kind: 'done', ids, reacted, at: Date.now(), ...(filled?.length ? { filled } : {}), ...(ruled?.length ? { ruled } : {}), ...(before ? { before } : {}) };
    addEvent(e);
    // 老师在 open 那一行写了 call=done（做完叫你）：明写的盖过「手上没事了才叫」，马上叫。开着 rowop 又开着键盘的矩阵只是写满了
    // （filled、规则还没判做完）不算「做完」（最后一审 M3）
    const told = ids.filter((id) => !filled?.includes(id) || ruled?.includes(id)).some((id) => [...stage.scene.opens.values()].some((x) => x.obj === id && x.policy?.call === 'done'));
    settle(e, { reacts, now: told });
  }
  function onGoal(ids, { by = 'student', instant, reacted = 0, reacts = null, pressed = false, prewrite = false, fresh = null } = {}) {
    if (instant || S.ended || host.readOnly) return;
    // 老师（或页面替老师补的行）让挑战成立了：不是学生做到的，不叫老师，攒着跟下一条发。舞台演预写的行时成立的（pre）、
    // 预写出的挑战一出来就成立的（fresh）照实写，不说「你这一轮让它成立了」
    if (by !== 'student') { addEvent({ kind: 'goal-by-teacher', ids, at: Date.now(), ...(prewrite ? { pre: true } : {}), ...(prewrite && fresh && ids.includes(fresh) ? { fresh: [fresh] } : {}) }); return; }
    for (const id of ids) host.evidence?.goal?.(id, stage.scene.goals.get(id), S.lastClaude);
    const e = { kind: 'goal', ids, reacted, at: Date.now() };
    // 收集型：收齐的那几张照那一刻的样子记下（发出去时写「学生收齐了 g1 的 3 张：B = …」）
    const col = {};
    for (const id of ids) { const c = stage.scene.goals.get(id)?.collect; if (c) col[id] = { obj: c.obj, n: c.n, got: c.got.map(shapeText), dup: c.dup }; }
    if (Object.keys(col).length) e.collected = col;
    // 学生按了按钮才判的（press）：这一下本身是回答，叫不叫老师由回答那一件事定（onAnswer），这一件跟着它
    if (pressed) {
      e.quiet = true;
      addEvent(e);
      // 演不上的预写照实数（叫不叫老师由回答那一件事定）
      if (reacts?.length) Promise.resolve(stage.reacting).then(() => { const n = reacts.filter((r) => !r.missed).length; if (n !== e.reacted) { e.reacted = n; e.missed = reacts.length - n; savePending(true); } });
      return;
    }
    addEvent(e);
    settle(e, { now: callNow(ids), reacts });
  }
  // 挑战还没做到：试了好多下、很久没动，叫老师（老师当场看着学生怎么试的写提示；学生照样能接着试）
  /**
   * 学生手上的事没人看着、该兜底的：还没做到的挑战（goals）；或者叫老师的事攒着了、只因为交给学生的东西还没做完（left）——
   * 学生看不见自己还有事（不像挂着一问，问题就在眼前），不兜底就僵在那里。挂着要答的一问时不算
   */
  function idleWhy() {
    const goals = stage.pendingGoals();
    if (goals.length) return { goals };
    const w = stage.scene.waiting;
    if ((w && w.kind !== 'next') || !S.pending?.events.some((e) => e.held?.length)) return null;
    const left = undoneOf(stage.scene);
    return left.length ? { left } : null;
  }
  // 挑战还没做到、或者攒着等东西做完：很久没动叫老师（老师当场看着学生怎么试的写提示；学生照样能接着试）
  function armIdle() {
    clearTimeout(S.idleTimer);
    if (S.ended || host.readOnly || S.flight || !idleWhy() || S.pending?.stuck) return;
    S.idleTimer = setTimeout(() => {
      const why = idleWhy();
      if (S.ended || S.flight || !why || S.pending?.stuck) return;
      const secs = Math.round(quietMs / 1000);
      addEvent({ kind: 'stuck', text: why.goals ? `学生 ${secs} 秒没动，挑战 ${why.goals.map((g) => g.id).join('、')} 还没做到` : `学生 ${secs} 秒没动；那时 ${why.left.join('、')} 还没做完`, at: Date.now() });
      S.pending.stuck = true;
      flush();
    }, quietMs);
  }
  function onTry() {
    armIdle();
    const p = S.pending;
    const why = idleWhy();
    if (!p || p.triedOut || !why) return;
    if (tryCount(p.events) >= TRY_MAX) { p.triedOut = true; addEvent({ kind: 'tries', ...(why.goals ? {} : { text: `学生试了 ${TRY_MAX} 下；那时 ${why.left.join('、')} 还没做完` }), at: Date.now() }); flush(); }
  }

  // —— 提前想：这一轮以「接着」结尾、学生只能点它，就趁学生看的时候先把下一轮要来（发出去的和真点了以后一字不差才接上）——
  function maybeSpec() {
    if (!host.call || S.ended || host.readOnly || S.spec || S.flight || S.pending?.events.some((x) => !x.quiet)) return;
    const w = stage.scene.waiting;
    if (!w || w.kind !== 'next' || w.button === HELP || RETRY.has(w.button) || stage.pendingGoals().length) return;
    // 按了这个按钮才判的挑战（on=）：点了会判、会记一行，提前想的那一份一定对不上
    if (stage.scene.hasOn?.(w.button || '接着')) return;
    const act = { type: 'next', button: w.button || '接着' };
    const said = eventsText([...(S.pending?.events || []), eventOf(act, { help: HELP })], { goals: stage.scene.goals });
    const after = stage.scene.clone();
    after.waiting = null;
    const msg = turnMessage({ act: said, state: after.stateText(), errors: S.lastErrors, audit: stage.teacherAudit || [], derived: derivedOf(S.pending?.events || []), grids: gridsOf(stage.scene) });
    const input = host.messages({ next: msg });
    const s = S.spec = { msg, input, text: '', res: null, err: null, listeners: [], t0: performance.now(), dead: false, done: false, adopted: false };
    s.record = () => host.addTurn({ role: 'system', kind: 'spec', discarded: true, text: '提前想好的下一轮没用上（学生做的和预想的不一样）', cost: host.cost({ bytes: inBytes(input), why: 'spec', ms: performance.now() - s.t0 }) });
    s.wait = host.call(input, { ...host.teach, cache: false, onText: ({ text }) => { s.text = text; for (const fn of s.listeners) fn({ text }); } })
      .then((r) => { s.res = r; }, (e) => { s.err = e; })
      .then(() => { s.done = true; if (s.dead) s.record(); });
  }
  function adopt(s) {
    s.adopted = true;
    return { input: s.input, t0: performance.now(), spec: true, attach: (onText) => { if (s.text) onText({ text: s.text }); s.listeners.push(onText); return s.wait.then(() => { if (s.err) throw s.err; return s.res; }); } };
  }
  function dropSpec() {
    const s = S.spec;
    S.spec = null;
    if (!s || s.adopted) return;
    s.dead = true;
    if (s.done) s.record();
  }

  // 学生的每个动作：证据交给 host；开放给学生直接动的、拨数是「试」，攒进这一段。
  // 老师在 open 那一行写了 call=wrong、裁判说这一下走偏了（act.call === 'now'）：这一件事马上叫老师
  function onAct(a) {
    if (!a) return;
    host.evidence?.act?.(a, S.lastClaude);
    if (S.ended || host.readOnly) return;
    // 撤一步：这一段里最后一件撤掉的那一行（src 对得上、还没撤过、真的演上了：没让做的、没演上的不在 log 里）记成撤回了，
    // 它引起的「跟着变的」不再写给老师
    if (a.type === 'undo' && S.pending) {
      const hit = S.pending.events.findLast((e) => e.kind === 'try' && !e.undone && !e.act?.blocked && !e.act?.error && e.act?.type !== 'undo' && (e.act?.src ?? e.act?.line) === a.src);
      if (hit) hit.undone = true;
    }
    if (a.open || a.type === 'dial') {
      const e = eventOf(a, { help: HELP, at: Date.now() });
      addEvent(e);
      if (triggers(e)) { flush(); return; }
      onTry();
    }
  }

  /**
   * 刷新以后接着上：老师最后那一轮的那一问重新挂上，没发出去的那一段接着攒（有要老师接的就发），不然接着等、提前想
   * last：最后一条（老师那一轮，或者它后面学生还没发出去的那一段）；askLine：要重新挂的那一问
   */
  async function resume({ lastClaude = 0, pendingRow = null, askLine = 'ask next' } = {}) {
    S.lastClaude = lastClaude;
    // 只是把最后那一问重新挂上，不是老师的一轮：学生点着的几样（ask pick 的圈）留着，等老师下一轮演完再收。
    // 这一问是 log 里的（当时收下了）：不查选项名——升级以前写的 hint=on 这类当时默默收下，现在查的话这一问挂不上，
    // 页面替它挂「用话答」的一问，expect= 不判了（复审 N6）。别的检查照旧（这一问要重新判答案，不借 lenient 的照字面比）
    const t = stage.begin({ unpick: false, anyOpts: true });
    t.end(askLine);
    await t.armed;
    S.logFrom = stage.log.length;
    if (pendingRow) S.pending = { row: pendingRow, events: pendingRow.events || [], base: pendingRow.log || [] };
    S.armedAt = performance.now();
    if (S.pending?.events.some(triggers)) flush();
    else { armIdle(); maybeSpec(); }
  }

  /** 下课 / 离开：不再叫老师；还没发出去的那一段做成一条学生轮（小结看得到） */
  function close() {
    S.ended = true;
    clearTimeout(S.idleTimer);
    dropSpec();
    if (S.pending?.events.length) finalize();
  }

  /** 下课没下成（小结没写出来）：接着上 */
  function reopen() { S.ended = false; armIdle(); }

  stage.onAnswer = onAnswer;
  stage.onGoal = onGoal;
  stage.onDone = onDone;
  stage.onNote = onNote;
  return {
    teach, flush, finalize, dropSpec, resume, close, reopen, onAct,
    get busy() { return S.busy; },
    get flight() { return S.flight; },
    get lastClaude() { return S.lastClaude; },
    set lastClaude(v) { S.lastClaude = v; },
    get pending() { return S.pending; },
    set logFrom(v) { S.logFrom = v; },
    state: S,
  };
}
