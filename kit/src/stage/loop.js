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
import { turnMessage } from './doc.js';
import { eventOf, triggers, eventsText, tryCount, TRY_MAX, QUIET_MS } from './events.js';

const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null;
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
        if (f.playing) await turn.abort(); else turn.drop();
        host.thinking?.(false);
        host.addTurn({ role: 'system', kind: 'error', discarded: true, text: `调用出错：${err?.message || err?.code || err}`, cost: host.cost({ bytes: nb, why: 'failed', ms: performance.now() - t0 }) });
        host.report?.(err, { what: '舞台课调用 Claude' });
        S.busy = false;
        if (S.ended) return null;
        const again = await stage.play('ask next "老师那边没连上。点一下再试。" button="再试一次"');
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
        if (f.playing) await turn.abort(); else turn.drop();
        host.thinking?.(false);
        host.addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，这一轮作废', modelApplied: res?.modelApplied || null, cost: { ...cost, why: 'failed' } });
        if (tries < 2) continue;
        S.busy = false;
        const again = await stage.play('ask next "这一轮不是 Opus 5.5 写的，作废了。点一下再要一次。" button="再要一次"');
        if (again.act?.type === 'next' && !S.ended) return teach(why);
        return null;
      }
      const text = res.text || '';
      // 这一轮写完就先存下（演的时候刷新不能丢）；演完、挂好那一问，再补上演了的行（中间学生动的也在里面，先后照实）
      let donePlay;
      S.playing = new Promise((r) => { donePlay = r; });
      const ended0 = turn.end(text);
      const claude = host.addTurn({ role: 'claude', text, modelApplied: res.modelApplied || 'mock', cost });
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

  // —— 学生做的事：答了问的、做到挑战马上叫老师；试（拨、拖、点开看）攒着 ——
  function addEvent(e) {
    if (!S.pending) S.pending = { row: host.addTurn({ role: 'student', pending: true, text: '', events: [] }), events: [], base: [] };
    S.pending.events.push(e);
    savePending();
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
    const msg = turnMessage({ act: said, state: stage.scene.stateText(), errors: S.lastErrors });
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
      if (S.ended || !S.pending || S.flight || S.busy) return;
      const row = finalize();
      // 提前想好的那一轮：学生真的只点了「接着」、发出去的一字不差，接上
      if (S.spec && !S.spec.dead && S.spec.msg === row.msg) pre = adopt(S.spec);
      dropSpec();
    } finally { S.flushing = false; }
    if (!S.ended && !S.flight && !S.busy) teach('turn', pre);
  }
  function onAnswer(act) {
    if (S.ended || RETRY.has(act.button)) return;
    addEvent(eventOf(act, { help: HELP, at: Date.now() }));
    flush();
  }
  function onGoal(ids, { by = 'student', instant, reacted = 0 } = {}) {
    if (instant || S.ended || host.readOnly) return;
    // 老师（或页面替老师补的行）让挑战成立了：不是学生做到的，不叫老师，攒着跟下一条发
    if (by !== 'student') { addEvent({ kind: 'goal-by-teacher', ids, at: Date.now() }); return; }
    for (const id of ids) host.evidence?.goal?.(id, stage.scene.goals.get(id), S.lastClaude);
    const e = { kind: 'goal', ids, reacted, at: Date.now() };
    addEvent(e);
    // 预写的行演完再看：学生手上又有事了（预写里的一问、新的挑战），先不叫老师；什么都没了才叫
    Promise.resolve(stage.reacting).then(() => {
      const w = stage.scene.waiting;
      if ((w && w.button !== HELP) || stage.pendingGoals().length) { e.quiet = true; savePending(); armIdle(); maybeSpec(); return; }
      flush();
    });
  }
  // 挑战还没做到：试了好多下、很久没动，叫老师（老师当场看着学生怎么试的写提示；学生照样能接着试）
  function armIdle() {
    clearTimeout(S.idleTimer);
    if (S.ended || host.readOnly || S.flight || !stage.pendingGoals().length || S.pending?.stuck) return;
    S.idleTimer = setTimeout(() => {
      if (S.ended || S.flight || !stage.pendingGoals().length || S.pending?.stuck) return;
      addEvent({ kind: 'stuck', text: `学生 ${Math.round(quietMs / 1000)} 秒没动，挑战 ${stage.pendingGoals().map((g) => g.id).join('、')} 还没做到`, at: Date.now() });
      S.pending.stuck = true;
      flush();
    }, quietMs);
  }
  function onTry() {
    armIdle();
    const p = S.pending;
    if (!p || p.triedOut || !stage.pendingGoals().length) return;
    if (tryCount(p.events) >= TRY_MAX) { p.triedOut = true; addEvent({ kind: 'tries', at: Date.now() }); flush(); }
  }

  // —— 提前想：这一轮以「接着」结尾、学生只能点它，就趁学生看的时候先把下一轮要来（发出去的和真点了以后一字不差才接上）——
  function maybeSpec() {
    if (!host.call || S.ended || host.readOnly || S.spec || S.flight || S.pending?.events.some((x) => !x.quiet)) return;
    const w = stage.scene.waiting;
    if (!w || w.kind !== 'next' || w.button === HELP || RETRY.has(w.button) || stage.pendingGoals().length) return;
    const act = { type: 'next', button: w.button || '接着' };
    const said = eventsText([...(S.pending?.events || []), eventOf(act, { help: HELP })], { goals: stage.scene.goals });
    const after = stage.scene.clone();
    after.waiting = null;
    const msg = turnMessage({ act: said, state: after.stateText(), errors: S.lastErrors });
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

  // 学生的每个动作：证据交给 host；开放给学生直接动的、拨数是「试」，攒进这一段
  function onAct(a) {
    if (!a) return;
    host.evidence?.act?.(a, S.lastClaude);
    if (S.ended || host.readOnly) return;
    if (a.open || a.type === 'dial') {
      addEvent(eventOf(a, { help: HELP, at: Date.now() }));
      onTry();
    }
  }

  /**
   * 刷新以后接着上：老师最后那一轮的那一问重新挂上，没发出去的那一段接着攒（有要老师接的就发），不然接着等、提前想
   * last：最后一条（老师那一轮，或者它后面学生还没发出去的那一段）；askLine：要重新挂的那一问
   */
  async function resume({ lastClaude = 0, pendingRow = null, askLine = 'ask next' } = {}) {
    S.lastClaude = lastClaude;
    const t = stage.begin();
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
