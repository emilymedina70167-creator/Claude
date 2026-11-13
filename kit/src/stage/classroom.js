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
import { Stage, stageLines } from './stage.js';
import { QUIET_MS } from './events.js';
import { createLoop } from './loop.js';
import { buildStageSystem, turnMessage, firstMessage, stageSubject } from './doc.js';
import { actEvidence, makeSigger, goalSig } from './evidence.js';
import { examCheckOf } from '../exam/fields.js';
import { toDate } from '../memory/schema.js';
import { examForBlock } from '../exam/block.js';
import { examForClass } from '../exam/context.js';
import { targetOf } from '../exam/target.js';
import { fitHistory } from './history.js';
import { getAI } from '../ai.js';
import { createSink } from '../live/sync.js';
import { sayEvidence, observationRecord } from '../memory/session.js';
import { parseOutput } from '../class/protocol.js';
import { callCost } from '../class/usage.js';
import { closingPrompt } from '../class/prompt.js';
import { reportText } from '../memory/report.js';
import { slipsToFold, tidyDue, tidyText } from '../memory/memo.js';
import { spaceOfId } from '../memory/space.js';
import { textbookForClass } from '../books/textbook.js';
import { reportError } from '../errlog.js';
import { choose } from '../dialog.js';
import { stageMock } from './devteacher.js';
import { VERSION } from '../version.js';
import { supRuns, escapeHtml } from '../render.js';

export const MODEL = 'claude-opus-5-5';
const TEACH = { model: MODEL, effort: 'high', modelTier: 'complex' };
const HISTORY_MAX = 200 * 1024; // 对话放不下时，丢最早的几轮（第一条说明一直在）
const enc = new TextEncoder();
const bytes = (s) => enc.encode(String(s)).length;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(6, '0');

/**
 * 开一节舞台课。desk：学习台给的（store 是这节课的数据库、sid、block、space、subject（这节课记着的科目）、mem、books、prevRead、
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
      <div class="sc-scenes-slot"></div>
      <span class="sc-think" hidden></span>
      ${readOnly ? '<span class="sc-ro">只读</span>' : '<button type="button" class="sc-end">下课</button>'}
    </header>
    <div class="sc-stage"></div>
    <section class="sc-closing" hidden></section>`;
  const $ = (s) => root.querySelector(s);
  // 课名里的 Unicode 上标（Aⁿ、ⁿ⁻¹）换成 <sup>：原样写会落到别的字体上，粗细对不上（和学习台主角卡同一个办法）
  const titleHtml = supRuns(escapeHtml(meta.unit || desk.title || '舞台课'));
  $('.sc-title').innerHTML = titleHtml;
  $('.sc-home').addEventListener('click', () => desk.onHome?.());
  const think = $('.sc-think');

  const sink = readOnly ? null : createSink(store, { evidence: (rec) => ({ session: sid, block: desk.block, turn: rec?.turn }) });
  // 幕条放在顶上那一条里（课名和「下课」之间，本来就空着；主线第六轮 3.4）
  const stage = new Stage($('.sc-stage'), { input: !readOnly, onAct: (a) => onAct(a), scenesHost: $('.sc-scenes-slot'), eyes: !readOnly });
  stage.lessonTitle = meta.unit || desk.title || '开头';
  window.LAStage = stage;
  // 这门课的考试资料（desk.js 按门课读，不等它）：读到了以后 exam= / like= 写了库里没有、留作模考的当场报
  desk.exam?.then?.((ex) => {
    if (!ex) return;
    desk.examData = ex;
    stage.examCheck = examCheckOf(ex, typeof desk.reserve === 'function' ? desk.reserve() : desk.reserve || []);
    stage.scene.examCheck = stage.examCheck;
  });
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
  // 活的舞台按事件叫老师：loop.js（和样子页同一份）
  const quietMs = store.dev && /[?&]quiet=(\d+)/.test(location.search) ? Number(location.search.match(/[?&]quiet=(\d+)/)[1]) * 1000 : QUIET_MS;
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
  // 说明只带这门课用得上的那几种东西：块 → 资料包 → 这节课记着的科目 → 空间，推不出来（408 的课既没块也没记科目）发全带的那份
  function system() {
    const subject = stageSubject({ block: desk.block, pack, session: { subject: desk.subject }, space: desk.space });
    return buildStageSystem({ pack: packWithBooks(), memory: desk.mem ? { mem: desk.mem, block: desk.block, space: desk.space, session: sid } : null, title: meta.unit || '', subject, exam: examSection() });
  }
  // 「这一块在考试里」（exam/context.js）：这门课的考试资料读到了、这一块挂了考点才有；学生的真题情况读记忆库里页面算的 exam_bar。
  // 老师这节课用 exam= / like= 写过的题号挪进代表题（下一轮有全文）
  const examAsked = new Set();
  function examSection() {
    const ex = desk.examData;
    if (!ex || !desk.block) return '';
    const w = stage.scene.waiting;
    for (const x of [w?.exam, w?.like, ...[...stage.scene.goals.values()].flatMap((g) => [g.exam, g.like])]) if (x) examAsked.add(x);
    const years = typeof desk.reserve === 'function' ? desk.reserve() : desk.reserve || [];
    const info = examForBlock({ block: desk.block, exam: ex, years });
    const bar = (desk.mem?.exam_bar || []).find((b) => b.id === desk.block) || null;
    return examForClass({ target: targetOf(desk.mem || {}), info, bar, today: toDate(Date.now()), asked: [...examAsked] });
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
    // 第一条带上整份说明；放不下时先省最早几轮的舞台样子，还不够才丢最早的几轮（history.js）
    const sys = system();
    const fit = fitHistory(msgs, { max: HISTORY_MAX, sysBytes: bytes(sys) }).msgs;
    fit[0] = { ...fit[0], content: `${sys}\n\n${fit[0].content}` };
    return fit;
  }

  // 这一问的指纹（报告按它分题）：同一个空紧挨着重问是同一道（evidence.js 的 makeSigger）
  const sigOf = makeSigger();
  const loop = createLoop({
    stage, call, mock: !!mock, model: MODEL, teach: TEACH, quietMs, readOnly,
    // 能不能带图（第九轮：每轮把画面截图给老师）：平台给了看图的能力、或者本地的模拟老师
    images: !!(ai?.images || mock),
    messages: ({ next } = {}) => messages(null, { next }),
    addTurn, putTurn,
    runMemo: (text, seq0) => runMemo(text, seq0),
    thinking: (on) => thinking(on),
    note: (t) => showNote(t),
    cost: (c) => callCost(c),
    report: (err, info) => reportError(err, info),
    // 学生的每个动作都是证据：有对错的（点了预期的那一个、填的答案、做到了挑战）记成作答，别的记成动作，打的字记成说的话
    evidence: sink ? {
      goal: (id, g, at) => sink.record({ type: 'stage', block: `S${at}`, q: g?.text || id, value: 'goal', text: id, ok: true, turn: at, ...(goalSig(g) ? { sig: goalSig(g) } : {}), ...(g?.exam ? { exam: g.exam } : {}), ...(g?.like ? { like: g.like } : {}) }),
      act: (a, at) => {
        const comp = `S${at || seq}`; // 这一问的编号：页面在每一轮的 [学生] 后面告诉老师（记忆块的 basis 写它）
        const w = stage.scene.waiting;
        const q = w?.prompt || stage.scene.say || '';
        const ev = actEvidence(a, { comp, q, goalText: (id) => stage.scene.goals.get(id)?.text || id, sig: sigOf(w, stage.scene, at || seq), goalSig: (id) => goalSig(stage.scene.goals.get(id)), wait: w });
        for (const r of ev.records) sink.record({ ...r, turn: at });
        if (ev.say != null) sink.put('evidence', sayEvidence(ev.say, { session: sid, block: desk.block, turn: at }));
        if (ev.event) sink.event({ type: `stage-${a.type}`, block: comp, detail: { ...a, tries: undefined }, turn: at });
      },
    } : null,
  });
  function onAct(a) { loop.onAct(a); }
  const teach = (why) => loop.teach(why);

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
  // asked：老师写的 ask end 递过来的（主线第七轮）——这一问是老师这一轮演完才挂的，不看「老师还在写」；
  // answered(下没下课)：点了确认框马上告诉舞台（下课要写小结，整个走完要一两分钟）
  async function endClass({ asked = false, answered = null } = {}) {
    if (!asked && (busy || loop.busy || loop.flight)) { showNote('等 Claude 写完这一轮再下课'); return; }
    if (ended) { answered?.(true); return; }
    const said = history.filter((t) => !t.discarded && t.role === 'claude');
    if (!said.length) { answered?.(true); desk.onHome?.(); return; }
    const v = await choose('下课吗？Claude 会写这节课的小结、整理记忆。', [{ label: '接着上', value: 'no' }, { label: '下课', value: 'yes', primary: true }]);
    answered?.(v === 'yes');
    if (v !== 'yes') return;
    busy = true;
    loop.close();
    stage.cancelWait?.();
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
      loop.reopen(); // 没下成课：接着上
      showNote(`小结没写成（${err?.message || err}），稍后再点「下课」。`);
      return;
    }
    thinking(false);
    const cost = callCost({ bytes: input.reduce((n, m) => n + bytes(m.content), 0), why: 'closing', ms: performance.now() - t0 });
    if (!mock && res?.modelApplied !== MODEL) {
      addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，下课小结作废', modelApplied: res?.modelApplied || null, cost });
      busy = false;
      loop.reopen();
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
    // 第一轮还没来、舞台是空的：中间一张开场卡（课名、「正在准备第一幕」），不让学生对着一块白屏等（主线第五轮首课走查）。
    // 第一行一演（loop.js 在 stage.onLine 里关掉 thinking）就收起
    const empty = on && !label && !stage.scene.objects.size && !stage.log.length;
    let card = $('.sc-opening');
    if (empty && !card) {
      card = document.createElement('div');
      card.className = 'sc-opening';
      card.innerHTML = '<div class="sc-opening-badge">课</div><div class="sc-opening-title"></div><div class="sc-opening-sub">正在准备第一幕<span class="sc-dots"><i></i><i></i><i></i></span></div>';
      card.querySelector('.sc-opening-title').innerHTML = titleHtml;
      $('.sc-stage').appendChild(card);
    } else if (!empty && card) card.remove();
    // 不是第一轮：学生刚答完、刚做完，眼睛在画面下半（刚才的输入框那里）——那里也放三个点，右上角那一小条容易看不见
    let wait = $('.sc-wait');
    if (on && !empty && !label && !wait) {
      wait = document.createElement('div');
      wait.className = 'sc-wait';
      wait.innerHTML = '<span class="sc-dots"><i></i><i></i><i></i></span>';
      wait.setAttribute('aria-label', '老师在想');
      // 横屏放进左边的栏里这一问下面（主线第六轮 2.3）；竖屏照旧在画面下半
      if (!stage.placeWait?.(wait)) $('.sc-stage').appendChild(wait);
    } else if ((!on || empty || label) && wait) wait.remove();
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
  $('.sc-end')?.addEventListener('click', () => endClass());
  // 老师写了 ask end：弹出和顶上「下课」同一个确认框，学生点了才下课
  if (!readOnly) stage.onEndAsk = () => new Promise((res) => { endClass({ asked: true, answered: res }); });

  // —— 开课 / 刷新后放回 ——
  const live = history.filter((t) => !t.discarded);
  const closingTurn = live.find((t) => t.kind === 'closing');
  const log = live.filter((t) => t.role === 'claude' || t.role === 'student').flatMap((t) => logOf(t).map((r) => ({ ...r, turn: t.seq })));
  if (log.length) await stage.replay(log);
  if (closingTurn) {
    ended = true;
    loop.close();
    const out = parseOutput(closingTurn.text, { final: true });
    showClosing(out.segments.filter((x) => x.type === 'speech').map((x) => x.text).join('\n\n').trim() || closingTurn.text, { turns: live.filter((t) => t.role === 'claude').length + 1, discarded: history.filter((t) => t.kind === 'fallback').length });
    return { stage, history };
  }
  if (readOnly) return { stage, history };
  const turns = live.filter((t) => t.role === 'claude' || t.role === 'student');
  loop.lastClaude = turns.filter((t) => t.role === 'claude').at(-1)?.seq || 0;
  const last = turns.at(-1);
  if (!last || (last.role === 'student' && !last.pending)) { loop.logFrom = stage.log.length; teach('turn'); return { stage, history }; }
  // 最后是老师那一轮（或者它后面学生还没发出去的一段）：照最后那一问接着等；没发的那一段接着攒
  await loop.resume({ lastClaude: loop.lastClaude, pendingRow: last.pending ? last : null, askLine: [...log].reverse().find((r) => /^ask\b/.test(r.src))?.src || 'ask next' });
  return { stage, history };
}

export { firstMessage };
void VERSION;
