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
import { Stage, actText } from './stage.js';
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

  const addTurn = (t) => {
    const row = { ...t, seq: ++seq, at: Date.now(), session: sid };
    history.push(row);
    sink?.put('class_turns', { id: pad(row.seq), ...row });
    return row;
  };

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
  function messages(extra = null) {
    const live = history.filter((t) => !t.discarded && (t.role === 'claude' || t.role === 'student'));
    const msgs = [];
    let first = true;
    for (const t of live) {
      if (t.role === 'claude') { if (first) { msgs.push({ role: 'user', content: '开始上课。舞台现在是空的。写第一轮：先造出要用的东西，让学生看到一个具体的例子，以一个 ask 结尾。' }); first = false; } msgs.push({ role: 'assistant', content: t.text }); }
      else { first = false; msgs.push({ role: 'user', content: t.msg || t.text }); }
    }
    if (!msgs.length) msgs.push({ role: 'user', content: '开始上课。舞台现在是空的。写第一轮：先造出要用的东西，让学生看到一个具体的例子，以一个 ask 结尾。' });
    if (extra) {
      if (msgs.at(-1).role === 'user') msgs.at(-1).content += `\n\n${extra}`;
      else msgs.push({ role: 'user', content: extra });
    }
    // 第一条带上整份说明；太长就丢最早的几轮（成对丢，保持一问一答交替）
    const sys = system();
    while (msgs.length > 3 && bytes(sys) + msgs.reduce((n, m) => n + bytes(m.content), 0) > HISTORY_MAX) msgs.splice(1, 2);
    msgs[0] = { ...msgs[0], content: `${sys}\n\n${msgs[0].content}` };
    return msgs;
  }

  // —— 一轮：边写边演 → 核验 Opus 5.5 → 记忆块 → 等学生 → 学生的那一轮 ——
  async function teach(why = 'turn') {
    if (!call) { showNote('这里调不了 Claude：要在 claude.ai 的学习台里打开这节课。'); return; }
    busy = true;
    for (let tries = 0; ; tries++) {
      const input = messages();
      const inBytes = input.reduce((n, m) => n + bytes(m.content), 0);
      const turn = stage.begin();
      const t0 = performance.now();
      let first = null;
      thinking(true);
      stage.onLine = () => thinking(false);
      let res;
      try {
        res = await call(input, { ...TEACH, cache: false, onText: ({ text }) => { if (first === null && text.trim()) first = performance.now(); turn.push(text); } });
      } catch (err) {
        await turn.abort();
        thinking(false);
        addTurn({ role: 'system', kind: 'error', discarded: true, text: `调用出错：${err?.message || err?.code || err}`, cost: callCost({ bytes: inBytes, why: 'failed', ms: performance.now() - t0 }) });
        reportError(err, { what: '舞台课调用 Claude' });
        busy = false;
        const again = await stage.play('ask next "老师那边没连上。点一下再试。" button="再试一次"');
        if (again.act?.type === 'next') return teach(why);
        return null;
      }
      const cost = callCost({ bytes: inBytes, why, ms: performance.now() - t0, first: first ? first - t0 : undefined });
      // 只能 Opus 5.5：不是就整轮作废（先画上去的也退回去），再要一次（最多两次，不加退路模型）
      if (!mock && res?.modelApplied !== MODEL) {
        await turn.abort();
        thinking(false);
        addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，这一轮作废', modelApplied: res?.modelApplied || null, cost: { ...cost, why: 'failed' } });
        if (tries < 2) continue;
        busy = false;
        const again = await stage.play('ask next "这一轮不是 Opus 5.5 写的，作废了。点一下再要一次。" button="再要一次"');
        if (again.act?.type === 'next') return teach(why);
        return null;
      }
      const text = res.text || '';
      const mark = turn.mark;
      // 演完这一轮（等到 ask 那一行准备好），记下老师这一轮和它演了的行
      const ended0 = turn.end(text);
      await waitArmed();
      const teacherLog = stage.log.slice(mark).filter((r) => r.by !== 'student');
      const claude = addTurn({ role: 'claude', text, modelApplied: res.modelApplied || 'mock', cost, log: teacherLog });
      await runMemo(text, claude.seq);
      thinking(false);
      busy = false;
      const result = await ended0;
      if (result.dead || ended) return null;
      return onStudent(result, claude, mark + teacherLog.length);
    }
  }
  // end() 在等学生的时候不返回：等到舞台在等学生（或者这一轮演完）
  async function waitArmed() {
    for (let i = 0; i < 600 && !stage.scene.waiting; i++) await new Promise((r) => setTimeout(r, 50));
  }

  // 学生做完：证据、学生的一轮（带发给老师的整条），接着下一轮
  async function onStudent(result, claude, from) {
    const act = result.act;
    if (!act || act.type === 'cancel') return null;
    const said = actText(act);
    const msg = turnMessage({ act: said, state: stage.scene.stateText(), errors: result.errors });
    addTurn({ role: 'student', text: said, ...(act.type === 'say' ? { say: act.text } : {}), act: slimAct(act), msg, log: stage.log.slice(from).filter((r) => r.by === 'student') });
    return teach('turn');
  }
  const slimAct = (a) => JSON.parse(JSON.stringify({ ...a, tries: a.tries?.map((t) => ({ type: t.type, name: t.name, path: t.path })) }));

  // 学生的每个动作都是证据：有对错的（点了预期的那一个、填的答案）记成作答，别的记成动作，打的字记成说的话
  function onAct(a) {
    if (!sink || !a) return;
    const comp = `S${seq}`; // 这一问：老师第几轮的 ask（记忆块的 basis 写它）
    const w = stage.scene.waiting;
    const q = w?.prompt || stage.scene.say || '';
    if (a.type === 'tap' && a.expected) sink.record({ type: 'stage', block: comp, q, value: a.value, text: a.ref, ok: !!a.right, turn: seq });
    else if (a.type === 'value') sink.record({ type: 'stage', block: comp, q, value: a.text, text: a.text, ok: !!a.right, turn: seq });
    else if (a.type === 'say') sink.put('evidence', sayEvidence(a.text, { session: sid, block: desk.block, turn: seq }));
    else sink.event({ type: `stage-${a.type}`, block: comp, detail: { ...a, tries: undefined }, turn: seq });
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
    if (busy) { showNote('等 Claude 写完这一轮再下课'); return; }
    if (ended) return;
    const said = history.filter((t) => !t.discarded && t.role === 'claude');
    if (!said.length) { desk.onHome?.(); return; }
    const v = await choose('下课吗？Claude 会写这节课的小结、整理记忆。', [{ label: '接着上', value: 'no' }, { label: '下课', value: 'yes', primary: true }]);
    if (v !== 'yes') return;
    busy = true;
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
  const log = live.filter((t) => t.role === 'claude' || t.role === 'student').flatMap((t) => (t.log || []).map((r) => ({ ...r, turn: t.seq })));
  if (log.length) await stage.replay(log);
  if (closingTurn) {
    ended = true;
    const out = parseOutput(closingTurn.text, { final: true });
    showClosing(out.segments.filter((x) => x.type === 'speech').map((x) => x.text).join('\n\n').trim() || closingTurn.text, { turns: live.filter((t) => t.role === 'claude').length + 1, discarded: history.filter((t) => t.kind === 'fallback').length });
    return { stage, history };
  }
  if (readOnly) return { stage, history };
  const last = live.filter((t) => t.role === 'claude' || t.role === 'student').at(-1);
  if (!last) { teach('turn'); return { stage, history }; }
  if (last.role === 'student') { teach('turn'); return { stage, history }; }
  // 最后是老师那一轮：照它最后的 ask 接着等学生
  const askLine = [...(last.log || [])].reverse().find((r) => /^ask\b/.test(r.src))?.src || 'ask next';
  (async () => {
    const t = stage.begin();
    const mark = stage.log.length;
    const result = await t.end(askLine);
    // 重放时这一行 ask 又记了一次：它是老师上一轮的，不属于学生这一轮
    if (!result.dead && !ended) onStudent(result, last, mark + 1);
  })();
  return { stage, history };
}

export { firstMessage };
void VERSION;
