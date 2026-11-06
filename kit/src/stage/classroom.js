// 学习台里的舞台课（kind: stage，docs/stage-plan.md D 段）：整屏一块舞台，Opus 5.5 一轮一轮当场写镜头指令，学生在画面上动手。
// 不走黑板课的控制器（class/classroom.js 是一页往下长的板、段、拍子……舞台用不上），但用同一批零件：
// 记忆摘要（memory/digest.js）、资料包和教材原文（class/prompt.js 的 packText、books/textbook.js）、
// 记忆块（memo，memops.applyMemo，守卫照旧）、证据（live/sync.js 的 sink → evidence）、花费（class/usage.js）、
// 下课整理（closingPrompt + 课后报告 desk.writeReport）、只能 Opus 5.5 讲课（不是就整轮作废、退回去）。
//
// 每一轮存进这节课的 class_turns（和黑板课同一个集合，报告、复盘、守卫照样读）：
//   老师的一轮 { role: 'claude', text（原样）, log（这一轮演了的行）, modelApplied, cost }
//   学生的一轮 { role: 'student', text（写给老师看的那一句）, act, msg（发给老师的整条：学生做了什么 + 舞台现在）, log（学生拖、拨造成的行）}
// 刷新后照各轮的 log 瞬间重放，最后一问照旧等学生。
import { Stage, stageLines, HELP } from './stage.js';
import { eventOf, triggers, eventsText, tryCount, TRY_MAX, QUIET_MS } from './events.js';
import { buildStageSystem, turnMessage, firstMessage } from './doc.js';
import { getAI } from '../ai.js';
import { createSink } from '../live/sync.js';
import { sayEvidence, observationRecord } from '../memory/session.js';
import { parseOutput } from '../class/protocol.js';
import { callCost } from '../class/usage.js';
import { closingPrompt } from '../class/prompt.js';
import { reportText } from '../memory/report.js';
import { slipsToFold, tidyDue, tidyText } from '../memory/memo.js';
import { spaceOfId, subjectOf } from '../memory/space.js';
import { textbookForClass } from '../books/textbook.js';
import { reportError } from '../errlog.js';
import { choose } from '../dialog.js';
import { stageMock } from './devteacher.js';
import { VERSION } from '../version.js';

export const MODEL = 'claude-opus-5-5';
const TEACH = { model: MODEL, effort: 'high', modelTier: 'complex' };
const HISTORY_MAX = 200 * 1024; // 对话放不下时，丢最早的几轮（第一条说明一直在）
const enc = new TextEncoder();
const bytes = (s) => enc.encode(String(s)).length;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(6, '0');

/**
 * 开一节舞台课。desk：学习台给的（store 是这节课的数据库、sid、block、space、mem、books、prevRead、
 * updateSession、onHome、writeReport、makeReport、memo { ops }、review、opening、readOnly）
 */
export async function renderStageClass(root, meta = {}, desk) {
  const { store, sid } = desk;
  const db = store.db;
  const readOnly = !!desk.readOnly;
  root.replaceChildren();
  root.classList.add('sc-root');
  document.body.classList.add('is-stage-class');
  root.innerHTML = `
    <header class="sc-top">
      <button type="button" class="sc-home" aria-label="回学习台">← 学习台</button>
      <div class="sc-title" role="heading" aria-level="1"></div>
      <span class="sc-think" hidden></span>
      ${readOnly ? '<span class="sc-ro">只读</span>' : '<button type="button" class="sc-end">下课</button>'}
    </header>
    <div class="sc-stage"></div>
    <section class="sc-closing" hidden></section>`;
  const $ = (s) => root.querySelector(s);
  $('.sc-title').textContent = meta.unit || desk.title || '舞台课';
  $('.sc-home').addEventListener('click', () => desk.onHome?.());
  const think = $('.sc-think');

  const sink = readOnly ? null : createSink(store, { evidence: (rec) => ({ session: sid, block: desk.block, turn: rec?.turn }) });
  const stage = new Stage($('.sc-stage'), { input: !readOnly, onAct: (a) => onAct(a) });
  window.LAStage = stage;
  if (store.dev) window.LAStageClass = { stage, history: () => history };

  // —— 谁来讲课：claude.ai 里是真的 Opus 5.5；本地 ?dev 用模拟老师（不花额度）——
  const ai = readOnly ? null : await getAI();
  const mock = !readOnly && store.dev && !/[?&]teacher=real\b/.test(location.search) ? stageMock() : null;
  const call = mock || (ai ? (input, opts) => ai.call(input, opts) : null);

  // —— 读这节课已经有的 ——
  const turnsSnap = await db.collection('class_turns').get().catch(() => null);
  const history = (turnsSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  let seq = history.reduce((m, t) => Math.max(m, t.seq || 0), 0);
  const packSnap = await db.collection('pack').get().catch(() => null);
  const pack = { main: null, problems: null };
  for (const d of packSnap?.docs || []) pack[d.id] = d.data();
  let ended = false;
  let busy = false;
  // —— 活的舞台（docs/stage-plan.md E 段）：学生随时在画面上动，做的事攒在 pending（一条还没发出去的学生轮），
  // 要老师接的时候（答了问的、做到了挑战、打字、点提示、试了好多下、很久没动）一起发；老师在想的时候学生照样能动 ——
  let flight = null; // 正在叫老师：{ stale, playing }（还一行没演、学生又做了要老师接的事 → 这一轮作废，带上新的再要）
  let pending = null; // { row, events, base }：这一段学生做的事（row 是存着的那条学生轮，刷新也在）
  let logFrom = 0; // 这一段学生的行从 stage.log 的哪里开始
  let lastErrors = []; // 老师上一轮没演的行（跟着下一条告诉老师）
  let armedAt = 0; // 老师上一轮演完的时候
  let lastClaude = 0; // 老师最近那一轮的 seq（证据的 S 编号）
  let spec = null; // 提前想好的下一轮（只为一定会这么做的「接着」）
  let playing = Promise.resolve(); // 老师那一轮演完、存好
  let idleTimer = null;
  let saveTimer = null;
  const quietMs = store.dev && /[?&]quiet=(\d+)/.test(location.search) ? Number(location.search.match(/[?&]quiet=(\d+)/)[1]) * 1000 : QUIET_MS;
  const RETRY = new Set(['再试一次', '再要一次']);
  const OPENING = '开始上课。舞台现在是空的。写第一轮：先造出要用的东西，让学生看到一个具体的例子、能自己动手试，以一个 ask 或一个挑战 goal 结尾。';

  const putTurn = (row) => sink?.put('class_turns', { id: pad(row.seq), ...row });
  const addTurn = (t) => {
    const row = { ...t, seq: ++seq, at: Date.now(), session: sid };
    history.push(row);
    putTurn(row);
    return row;
  };
  // 一轮演了哪几行：存着的 log；还没演完就刷新了的（没有 log）照老师写的字一行一行放回（写错的行重放时照样挡下）
  const logOf = (t) => t.log || (t.role === 'claude' ? stageLines(t.text).filter((l) => l && l.trim() && !/^#/.test(l.trim())).map((src) => ({ src: src.trim(), by: 'teacher' })) : []);

  // —— 每一轮发给老师的：整份说明（每一轮现拼：记忆、资料包可能变了）+ 这节课的对话 ——
  function packWithBooks() {
    const b = desk.books;
    if (!b?.chunks?.length) return pack;
    const block = (desk.mem?.curriculum || []).find((x) => x.id === desk.block) || null;
    const tb = textbookForClass({ main: pack.main, block, books: b.books, chunks: b.chunks, tools: false, read: desk.prevRead || [], room: 40 * 1024 });
    if (!tb.textbook) return pack;
    const main = { ...(pack.main || {}) };
    main.textbook = [main.textbook, tb.textbook].filter((x) => x && (typeof x !== 'string' || x.trim())).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n\n');
    return { ...pack, main };
  }
  function system() {
    return buildStageSystem({ pack: packWithBooks(), memory: desk.mem ? { mem: desk.mem, block: desk.block, space: desk.space, session: sid } : null, title: meta.unit || '', subject: desk.block ? subjectOf(desk.block) : '' });
  }
  function messages(extra = null, { next = null } = {}) {
    const live = history.filter((t) => !t.discarded && !t.pending && (t.role === 'claude' || t.role === 'student'));
    const msgs = [];
    // 连着两条学生的（老师那一轮过时作废了）并成一条：一问一答交替
    const user = (content) => { if (msgs.at(-1)?.role === 'user') msgs.at(-1).content += `\n\n${content}`; else msgs.push({ role: 'user', content }); };
    for (const t of live) {
      if (t.role === 'claude') { if (!msgs.length) user(OPENING); msgs.push({ role: 'assistant', content: t.text }); }
      else user(t.msg || t.text);
    }
    if (!msgs.length) user(OPENING);
    if (next) user(next);
    if (extra) user(extra);
    // 第一条带上整份说明；太长就丢最早的几轮（成对丢，保持一问一答交替）
    const sys = system();
    while (msgs.length > 3 && bytes(sys) + msgs.reduce((n, m) => n + bytes(m.content), 0) > HISTORY_MAX) msgs.splice(1, 2);
    msgs[0] = { ...msgs[0], content: `${sys}\n\n${msgs[0].content}` };
    return msgs;
  }

  // —— 叫老师写一轮：边写边演 → 核验 Opus 5.5 → 记忆块 → 演完存好。学生答了什么不在这里等：事件来了 flush 再叫 ——
  // pre：提前想好的那一轮（spec）接上来，写过的先演、接着流式演
  async function teach(why = 'turn', pre = null) {
    if (!call) { showNote('这里调不了 Claude：要在 claude.ai 的学习台里打开这节课。'); return null; }
    busy = true;
    clearTimeout(idleTimer);
    for (let tries = 0; ; tries++) {
      const input = pre?.input || messages();
      const inBytes = input.reduce((n, m) => n + bytes(m.content), 0);
      const turn = stage.begin();
      const mark = turn.mark;
      const t0 = pre?.t0 ?? performance.now();
      let first = null;
      const f = flight = { stale: false, playing: false };
      thinking(true);
      stage.onLine = () => { thinking(false); f.playing = true; };
      const onText = ({ text }) => {
        if (f.stale && !f.playing) return; // 已经过时：先不演，等它写完扔掉
        if (first === null && text.trim()) first = performance.now();
        turn.push(text);
      };
      let res;
      try {
        res = pre ? await pre.attach(onText) : await call(input, { ...TEACH, cache: false, onText });
      } catch (err) {
        flight = null;
        if (f.playing) await turn.abort(); else turn.drop();
        thinking(false);
        addTurn({ role: 'system', kind: 'error', discarded: true, text: `调用出错：${err?.message || err?.code || err}`, cost: callCost({ bytes: inBytes, why: 'failed', ms: performance.now() - t0 }) });
        reportError(err, { what: '舞台课调用 Claude' });
        busy = false;
        const again = await stage.play('ask next "老师那边没连上。点一下再试。" button="再试一次"');
        if (again.act?.type === 'next') return teach(why);
        return null;
      }
      flight = null;
      const cost = { ...callCost({ bytes: inBytes, why, ms: performance.now() - t0, first: first ? first - t0 : undefined }), ...(pre?.spec ? { spec: 'hit' } : {}) };
      pre = null;
      // 学生在老师想的时候又做了要老师接的事、这一轮还一行没演：不演了（学生这期间动过的不退），带上新的再要
      if (f.stale && !f.playing) {
        turn.drop();
        thinking(false);
        addTurn({ role: 'system', kind: 'stale', discarded: true, text: '学生在老师想的时候又做了事：这一轮写的已经过时，没演', cost: { ...cost, why: 'stale' } });
        busy = false;
        return flush();
      }
      // 只能 Opus 5.5：不是就整轮作废（先画上去的也退回去），再要一次（最多两次，不加退路模型）
      if (!mock && res?.modelApplied !== MODEL) {
        if (f.playing) await turn.abort(); else turn.drop();
        thinking(false);
        addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，这一轮作废', modelApplied: res?.modelApplied || null, cost: { ...cost, why: 'failed' } });
        if (tries < 2) continue;
        busy = false;
        const again = await stage.play('ask next "这一轮不是 Opus 5.5 写的，作废了。点一下再要一次。" button="再要一次"');
        if (again.act?.type === 'next') return teach(why);
        return null;
      }
      const text = res.text || '';
      // 这一轮写完就先存下（演的时候刷新不能丢）；演完、挂好那一问，再补上演了的行（中间学生动的也在里面，先后照实）
      let donePlay;
      playing = new Promise((r) => { donePlay = r; });
      const ended0 = turn.end(text);
      const claude = addTurn({ role: 'claude', text, modelApplied: res.modelApplied || 'mock', cost });
      lastClaude = claude.seq;
      await runMemo(text, claude.seq);
      thinking(false);
      busy = false;
      await Promise.race([turn.armed, ended0]);
      claude.log = stage.log.slice(mark);
      putTurn(claude);
      logFrom = stage.log.length;
      if (pending) { pending.base = []; savePending(true); }
      lastErrors = [...stage.errors];
      armedAt = performance.now();
      donePlay();
      if (pending?.events.some(triggers)) { flush(); return claude; }
      armIdle();
      maybeSpec();
      return claude;
    }
  }

  // —— 学生做的事：答了问的、做到挑战马上叫老师；试（拨、拖、点开看）攒着 ——
  function addEvent(e) {
    if (!pending) pending = { row: addTurn({ role: 'student', pending: true, text: '', events: [] }), events: [], base: [] };
    pending.events.push(e);
    savePending();
  }
  // 还没发出去的那一段也存着（刷新以后接着攒）；连着拨的时候攒一会儿再写
  function savePending(now = false) {
    clearTimeout(saveTimer);
    const go = () => { if (!pending) return; Object.assign(pending.row, { events: pending.events, log: [...pending.base, ...stage.log.slice(logFrom)] }); putTurn(pending.row); };
    if (now) go(); else saveTimer = setTimeout(go, 800);
  }
  /** 这一段做成一条学生轮（发给老师的整条在 msg 里） */
  function finalize() {
    const events = pending.events;
    // 学生点「接着」叫的老师：不写过了几秒（提前想好的那一轮才对得上）
    const byNext = events.at(-1)?.act?.type === 'next';
    const said = eventsText(events, { goals: stage.scene.goals, secs: byNext || !armedAt ? null : Math.round((performance.now() - armedAt) / 1000) });
    const msg = turnMessage({ act: said, state: stage.scene.stateText(), errors: lastErrors });
    const say = events.filter((e) => e.act?.type === 'say').map((e) => e.act.text).join('\n');
    clearTimeout(saveTimer);
    Object.assign(pending.row, { pending: false, text: said, msg, events, log: [...pending.base, ...stage.log.slice(logFrom)], ...(say ? { say } : {}) });
    putTurn(pending.row);
    const row = pending.row;
    pending = null;
    logFrom = stage.log.length;
    lastErrors = [];
    return row;
  }
  // 有要老师接的事：等预写的行演完、学生那一下落定，发出去。老师正在想：还一行没演就作废那一轮（写完了自己再来叫）
  let flushing = false;
  async function flush() {
    if (ended || readOnly || !pending?.events.some(triggers)) return;
    if (flight) { if (!flight.playing) flight.stale = true; return; }
    if (busy || flushing) return;
    flushing = true;
    clearTimeout(idleTimer);
    let pre = null;
    try {
      await playing;
      await Promise.all([stage.reacting, stage.studentChain]).catch(() => {});
      if (ended || !pending || flight || busy) return;
      const row = finalize();
      // 提前想好的那一轮：学生真的只点了「接着」、发出去的一字不差，接上（写过的先演，不用再等老师想）
      if (spec && !spec.dead && spec.msg === row.msg) pre = adopt(spec);
      dropSpec();
    } finally { flushing = false; }
    if (!ended && !flight && !busy) teach('turn', pre);
  }
  stage.onAnswer = (act) => {
    if (ended || RETRY.has(act.button)) return;
    addEvent(eventOf(act, { help: HELP, at: Date.now() }));
    flush();
  };
  stage.onGoal = (ids, { instant, reacted = 0 } = {}) => {
    if (instant || ended || readOnly) return;
    for (const id of ids) { const g = stage.scene.goals.get(id); sink?.record({ type: 'stage', block: `S${lastClaude}`, q: g?.text || id, value: 'goal', text: id, ok: true, turn: lastClaude }); }
    const e = { kind: 'goal', ids, reacted, at: Date.now() };
    addEvent(e);
    // 预写的行演完再看：学生手上又有事了（预写里的一问、新的挑战），先不叫老师；什么都没了才叫
    Promise.resolve(stage.reacting).then(() => {
      const w = stage.scene.waiting;
      if ((w && w.button !== HELP) || stage.pendingGoals().length) { e.quiet = true; savePending(); armIdle(); maybeSpec(); return; }
      flush();
    });
  };
  // 挑战还没做到：试了好多下、很久没动，叫老师（老师当场看着学生怎么试的写提示；学生照样能接着试）
  function armIdle() {
    clearTimeout(idleTimer);
    if (ended || readOnly || flight || !stage.pendingGoals().length || pending?.stuck) return;
    idleTimer = setTimeout(() => {
      if (ended || flight || !stage.pendingGoals().length || pending?.stuck) return;
      addEvent({ kind: 'stuck', text: `学生 ${Math.round(quietMs / 1000)} 秒没动，挑战 ${stage.pendingGoals().map((g) => g.id).join('、')} 还没做到`, at: Date.now() });
      pending.stuck = true;
      flush();
    }, quietMs);
  }
  function onTry() {
    armIdle();
    if (!pending || pending.triedOut || !stage.pendingGoals().length) return;
    if (tryCount(pending.events) >= TRY_MAX) { pending.triedOut = true; addEvent({ kind: 'tries', at: Date.now() }); flush(); }
  }

  // —— 提前想：这一轮以「接着」结尾、学生只能点它，就趁学生看的时候先把下一轮要来（发出去的和真点了以后一字不差才接上）——
  function maybeSpec() {
    if (!call || ended || readOnly || spec || flight || pending?.events.some((x) => !x.quiet)) return;
    const w = stage.scene.waiting;
    if (!w || w.kind !== 'next' || w.button === HELP || RETRY.has(w.button) || stage.pendingGoals().length) return;
    const act = { type: 'next', button: w.button || '接着' };
    const said = eventsText([...(pending?.events || []), eventOf(act, { help: HELP })], { goals: stage.scene.goals });
    const after = stage.scene.clone();
    after.waiting = null;
    const msg = turnMessage({ act: said, state: after.stateText(), errors: lastErrors });
    const input = messages(null, { next: msg });
    const s = spec = { msg, input, text: '', res: null, err: null, listeners: [], t0: performance.now(), dead: false, done: false, adopted: false };
    s.record = () => addTurn({ role: 'system', kind: 'spec', discarded: true, text: '提前想好的下一轮没用上（学生做的和预想的不一样）', cost: callCost({ bytes: input.reduce((n, m) => n + bytes(m.content), 0), why: 'spec', ms: performance.now() - s.t0 }) });
    s.wait = call(input, { ...TEACH, cache: false, onText: ({ text }) => { s.text = text; for (const fn of s.listeners) fn({ text }); } })
      .then((r) => { s.res = r; }, (e) => { s.err = e; })
      .then(() => { s.done = true; if (s.dead) s.record(); });
  }
  function adopt(s) {
    s.adopted = true;
    return { input: s.input, t0: performance.now(), spec: true, attach: (onText) => { if (s.text) onText({ text: s.text }); s.listeners.push(onText); return s.wait.then(() => { if (s.err) throw s.err; return s.res; }); } };
  }
  function dropSpec() {
    const s = spec;
    spec = null;
    if (!s || s.adopted) return;
    s.dead = true;
    if (s.done) s.record();
  }

  // 学生的每个动作都是证据：有对错的（点了预期的那一个、填的答案）记成作答，别的记成动作，打的字记成说的话；
  // 开放给学生直接动的、拨数是「试」，攒进这一段
  function onAct(a) {
    if (!a) return;
    if (sink) {
      const comp = `S${lastClaude || seq}`; // 这一问：老师第几轮的（记忆块的 basis 写它）
      const w = stage.scene.waiting;
      const q = w?.prompt || stage.scene.say || '';
      if (a.type === 'tap' && a.expected) sink.record({ type: 'stage', block: comp, q, value: a.value, text: a.ref, ok: !!a.right, turn: lastClaude });
      else if (a.type === 'value') sink.record({ type: 'stage', block: comp, q, value: a.text, text: a.text, ok: !!a.right, turn: lastClaude });
      else if (a.type === 'say') sink.put('evidence', sayEvidence(a.text, { session: sid, block: desk.block, turn: lastClaude }));
      else sink.event({ type: `stage-${a.type}`, block: comp, detail: { ...a, tries: undefined }, turn: lastClaude });
    }
    if (ended || readOnly) return;
    if (a.open || a.type === 'dial') {
      addEvent(eventOf(a, { help: HELP, at: Date.now() }));
      onTry();
    }
  }

  // 老师这一轮的 ````board memo 块：写进记忆（守卫照旧）；没记成的下一轮告诉老师
  async function runMemo(text, turnSeq, { closing = false } = {}) {
    if (!desk.memo?.ops) return null;
    const out = parseOutput(text, { final: true });
    const entries = out.ops.filter((o) => o.op === 'memo').flatMap((o) => o.entries || []).filter((e) => e.kind !== 'block');
    if (!entries.length) return null;
    try {
      const r = await desk.memo.ops.applyMemo(entries, { session: sid, block: desk.block, space: desk.space, turn: turnSeq, turns: history.filter((t) => !t.discarded), closing });
      if (r?.rejected?.length) addTurn({ role: 'system', kind: 'note', text: `[系统] memo 里有 ${r.rejected.length} 条没记：\n${r.rejected.map((x) => `- ${x.line}\n  原因：${x.error}`).join('\n')}` });
      return r;
    } catch (e) {
      reportError(e, { what: '舞台课的 memo 没记成' });
      return null;
    }
  }

  // —— 下课：课后报告放进输入，小结和整理单同一次写；不是 Opus 5.5 就不算 ——
  async function endClass() {
    if (busy || flight) { showNote('等 Claude 写完这一轮再下课'); return; }
    if (ended) return;
    const said = history.filter((t) => !t.discarded && t.role === 'claude');
    if (!said.length) { desk.onHome?.(); return; }
    const v = await choose('下课吗？Claude 会写这节课的小结、整理记忆。', [{ label: '接着上', value: 'no' }, { label: '下课', value: 'yes', primary: true }]);
    if (v !== 'yes') return;
    busy = true;
    clearTimeout(idleTimer);
    dropSpec();
    stage.cancelWait?.();
    if (pending?.events.length) finalize();
    thinking(true, 'Claude 在写这节课的小结…');
    const repObj = desk.makeReport ? await desk.makeReport({ turns: history, steps: [] }).catch(() => null) : null;
    const report = repObj ? reportText(repObj) : '（这一次页面没算出课后报告：整理单按这节课的对话写，basis 写 S 开头的那一问的编号。）';
    const sp = desk.block ? spaceOfId(desk.block) : desk.space;
    const why = desk.mem ? tidyDue(desk.mem, sp, sid) : '';
    const tidy = why ? { why, text: tidyText(desk.mem, sp) } : null;
    const closing = closingPrompt({ report, review: desk.review, opening: desk.opening, slips: desk.mem ? slipsToFold(desk.mem, sp) : '', tidy, recheck: desk.recheck?.[sp] || '' })
      + '\n\n（舞台课：小结写成几行字，不写镜头指令；整理单照旧写在 ````board memo 块里。）';
    const input = messages(closing);
    const t0 = performance.now();
    let res;
    try {
      res = await call(input, { ...TEACH, cache: false });
    } catch (err) {
      thinking(false);
      busy = false;
      showNote(`小结没写成（${err?.message || err}），稍后再点「下课」。`);
      return;
    }
    thinking(false);
    const cost = callCost({ bytes: input.reduce((n, m) => n + bytes(m.content), 0), why: 'closing', ms: performance.now() - t0 });
    if (!mock && res?.modelApplied !== MODEL) {
      addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，下课小结作废', modelApplied: res?.modelApplied || null, cost });
      busy = false;
      showNote('Opus 5.5 暂时用不了，小结没写成，稍后再点「下课」。');
      return;
    }
    const out = parseOutput(res.text, { final: true });
    const summary = out.segments.filter((x) => x.type === 'speech').map((x) => x.text).join('\n\n').trim() || res.text;
    const verify = { turns: said.length + 1, discarded: history.filter((t) => t.kind === 'fallback').length };
    const closed = addTurn({ role: 'system', kind: 'closing', text: res.text, modelApplied: res.modelApplied || 'mock', cost });
    const ob = observationRecord({ kind: 'summary', text: summary, session: sid, block: desk.block, turn: closed.seq, verify });
    await sink?.put('observations', ob);
    await runMemo(res.text, closed.seq, { closing: true });
    await desk.updateSession?.({ status: 'closed', endedAt: Date.now(), summary: ob.id, verify, usage: usageSum() });
    await sink?.settled?.();
    if (desk.writeReport) desk.writeReport({ turns: history, steps: [] }).catch((e) => reportError(e, { what: '舞台课的课后报告没写成' }));
    ended = true;
    busy = false;
    showClosing(summary, verify);
  }
  const usageSum = () => {
    const calls = history.filter((t) => t.cost);
    return { calls: calls.length, bytes: calls.reduce((n, t) => n + (t.cost.bytes || 0), 0), ms: Math.round(calls.reduce((n, t) => n + (t.cost.ms || 0), 0)) };
  };

  // —— 画面上的几样：老师在想、提醒、下课小结 ——
  let thinkTimer = null;
  function thinking(on, label = '') {
    clearInterval(thinkTimer);
    if (!on) { think.hidden = true; return; }
    const t0 = performance.now();
    think.hidden = false;
    const paint = () => { think.textContent = `${label || `${mock ? '模拟老师' : 'Opus 5.5'} 在想…`} ${Math.round((performance.now() - t0) / 1000)} 秒`; };
    paint();
    thinkTimer = setInterval(paint, 500);
  }
  function showNote(text) {
    const n = document.createElement('div');
    n.className = 'sc-note';
    n.textContent = text;
    root.appendChild(n);
    setTimeout(() => n.remove(), 4200);
  }
  function showClosing(summary, verify) {
    const box = $('.sc-closing');
    box.hidden = false;
    box.innerHTML = `<div class="sc-card"><h2>这节课的小结</h2><div class="sc-sum"></div><p class="sc-foot"></p><button type="button" class="sc-back">回学习台</button></div>`;
    box.querySelector('.sc-sum').innerHTML = esc(summary).split(/\n+/).map((l) => `<p>${l}</p>`).join('');
    box.querySelector('.sc-foot').textContent = mock ? `（本地测试：${verify.turns} 轮都是模拟老师写的，没有调用 Claude。）` : `这节课 ${verify.turns} 轮讲课和小结全部由 Opus 5.5 回答（平台核验）${verify.discarded ? `；另有 ${verify.discarded} 轮平台换了别的模型，已作废、没有演出来` : ''}。`;
    box.querySelector('.sc-back').addEventListener('click', () => desk.onHome?.());
    $('.sc-end')?.remove();
  }
  $('.sc-end')?.addEventListener('click', endClass);

  // —— 开课 / 刷新后放回 ——
  const live = history.filter((t) => !t.discarded);
  const closingTurn = live.find((t) => t.kind === 'closing');
  const log = live.filter((t) => t.role === 'claude' || t.role === 'student').flatMap((t) => logOf(t).map((r) => ({ ...r, turn: t.seq })));
  if (log.length) await stage.replay(log);
  if (closingTurn) {
    ended = true;
    const out = parseOutput(closingTurn.text, { final: true });
    showClosing(out.segments.filter((x) => x.type === 'speech').map((x) => x.text).join('\n\n').trim() || closingTurn.text, { turns: live.filter((t) => t.role === 'claude').length + 1, discarded: history.filter((t) => t.kind === 'fallback').length });
    return { stage, history };
  }
  if (readOnly) return { stage, history };
  const turns = live.filter((t) => t.role === 'claude' || t.role === 'student');
  lastClaude = turns.filter((t) => t.role === 'claude').at(-1)?.seq || 0;
  const last = turns.at(-1);
  if (!last || (last.role === 'student' && !last.pending)) { logFrom = stage.log.length; teach('turn'); return { stage, history }; }
  // 最后是老师那一轮（或者它后面学生还没发出去的一段）：照最后那一问接着等；没发的那一段接着攒
  const askLine = [...log].reverse().find((r) => /^ask\b/.test(r.src))?.src || 'ask next';
  const t = stage.begin();
  t.end(askLine);
  await t.armed;
  logFrom = stage.log.length;
  if (last.pending) pending = { row: last, events: last.events || [], base: last.log || [] };
  armedAt = performance.now();
  if (pending?.events.some(triggers)) flush();
  else { armIdle(); maybeSpec(); }
  return { stage, history };
}

export { firstMessage };
void VERSION;
