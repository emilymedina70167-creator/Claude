// 黑板组件 stage：在黑板的一段里嵌一块舞台（kit/src/stage/，2026-11-18 从 archive/ 恢复），没有老师在旁边——
// 外部主讲写好镜头指令，页面照演；学生动手（open 交给学生的东西）、挑战（goal … when=）当场判，做到了、没做到、走偏了演预写的行。
//
// 舞台课那时，学生的每一下攒着、到了要老师接的那一刻（答了、做到了、做完了、call=wrong、试了好多下、很久没动）叫老师；
// 这里没有老师可叫，同一刻记一条动作 stage-call（detail 里是那时会发给老师的那一段），外部主讲从下一份 ext_out 里看到。
// 学生每一下记一条 stage-act；挑战做到 / 按了按钮没做到、答了那一问记成作答（type: 'stage'）。舞台现在什么样：stageBoxState(el)。
// 刷新、重画时从头演（不放回学生动过的样子）。字段的读法和写法错误的拼法在 stageboxspec.js（纯函数，有测试）。
import { Stage, actText, quoteText } from '../stage/stage.js';
import { eventOf, eventsText, triggers, hasWork, tryCount, TRY_MAX, QUIET_MS, verdictText } from '../stage/events.js';
import { parseStageBox, problemsOf, callLine } from '../stageboxspec.js';
import { session } from '../session.js';

const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 这块舞台现在的样子（舞台现状：每样东西、开着给学生的手、挑战做没做到、预写的、在等什么）；不是 stage 组件是 '' */
export function stageBoxState(el) {
  const st = el?.__stage;
  if (!st) return '';
  try { return st.scene.stateText(); } catch (e) { return `（舞台现状没写成：${e?.message || e}）`; }
}

export function stage(el, src) {
  const spec = parseStageBox(src);
  el.classList.add('block-stage');
  el.innerHTML = `${spec.title ? `<div class="sb-title">${escapeHtml(spec.title)}</div>` : ''}<div class="sb-stage"></div>`;
  for (const p of spec.problems) session.problem(el, 'stage', p);
  const host = el.querySelector('.sb-stage');
  host.style.height = `${spec.height}px`;
  if (!spec.script.trim()) return;
  // prewrite: all（这一段写的）或整节课的开关 session.extPrewrite（外部的课由课堂打开）：预写也收 .wrong / .miss
  const prewrite = spec.prewrite || (session.extPrewrite ? 'all' : null);
  const id = spec.id || el.dataset.bid || '';
  let alive = true;
  let pending = []; // 上一次「叫老师」以后学生做的事（events.js 的写法），到了要叫的那一刻写成一段
  let triedOut = false, stuckOut = false, idleTimer = null;

  const st = new Stage(host, { input: true, talk: false, embed: true, prewrite, onAct });
  el.__stage = st; // 黑板现状、自动测试、调试找得到这块舞台
  const goals = () => st.scene.goals;
  const ev = (type, detail) => { if (alive) session.event(type, el, { stage: id, ...detail }); };

  // —— 叫老师的那一刻：记一条 stage-call，攒着的清掉 ——
  function call(why) {
    clearTimeout(idleTimer);
    const text = eventsText(pending, { goals: goals() });
    pending = [];
    triedOut = false;
    stuckOut = false;
    ev('stage-call', { why, text: callLine(id, why, text) });
    armIdle();
  }
  // 做到了、答对了、做完了：等预写的行演完再看学生手上还有没有事（有就攒着，跟着下一件要接的事一起记）；call=now 马上记
  function settle(why, now = false) {
    if (now) { call(why); return; }
    Promise.resolve(st.reacting).then(() => {
      if (!alive) return;
      if (hasWork(st.scene).length) { armIdle(); return; }
      call(why);
    });
  }
  // 挑战还没做到、学生很久没动（QUIET_MS）：记一次（舞台课那时叫老师）
  function armIdle() {
    clearTimeout(idleTimer);
    if (!alive || stuckOut || !st.pendingGoals().length) return;
    idleTimer = setTimeout(() => {
      if (!alive || !el.isConnected || !st.pendingGoals().length) return;
      stuckOut = true;
      pending.push({ kind: 'stuck', text: `学生 ${Math.round(QUIET_MS / 1000)} 秒没动，挑战 ${st.pendingGoals().map((g) => g.id).join('、')} 还没做到`, at: Date.now() });
      call('stuck');
    }, QUIET_MS);
  }

  // —— 学生的每一下 ——
  function onAct(a) {
    if (!a || !alive) return;
    if (a.type === 'look') return; // 翻回去看一幕：只是看
    // 交给学生的手（open）、拨数是「试」：一下记一条，攒进这一段
    if (a.open || a.type === 'dial' || a.type === 'undo') {
      ev('stage-act', { text: `${actText(a)}${verdictText(a)}`, ...(a.line ? { line: a.line } : {}), ...(a.verdict?.right != null ? { ok: a.verdict.right } : {}), ...(a.blocked ? { blocked: true } : {}) });
      const e = eventOf(a, { at: Date.now() });
      pending.push(e);
      if (e.now && !a.reached) { call('wrong'); return; }
      armIdle();
      if (!triedOut && st.pendingGoals().length && tryCount(pending) >= TRY_MAX) {
        triedOut = true;
        pending.push({ kind: 'tries', goals: st.pendingGoals().map((g) => g.id), at: Date.now() });
        call('tries');
      }
    }
  }
  // 答了等着的那一问（ask tap / pick / value / say / next）
  st.onAnswer = (act, w) => {
    if (!alive || act.type === 'end') return;
    const right = act.type === 'pick' ? act.same ?? null : act.right ?? null;
    const judged = w && (w.kind === 'tap' || w.kind === 'pick' || w.kind === 'value');
    const answer = act.type === 'pick' ? act.words || (act.refs || []).join(' ') : act.type === 'tap' ? act.ref : act.text ?? act.button ?? '';
    if (judged || act.type === 'say') session.record({ type: 'stage', q: w?.prompt || '（舞台上的一问）', ok: judged ? right : null, value: String(answer ?? ''), el, stage: id, text: actText(act) });
    else ev('stage-act', { text: actText(act) });
    // 按了按钮才判的挑战（goal … on=）判成没做到：记成作答（ok: false）；做到了的由 onGoal 记
    for (const x of act.onGoals || []) {
      const g = goals().get(x.id);
      if (!x.met && g) session.record({ type: 'stage', q: g.text, ok: false, el, stage: id, goal: x.id, text: `学生按了「${g.on}」，挑战 ${x.id}「${g.text}」${x.status || '还没做到'}` });
    }
    const e = eventOf(act, { at: Date.now() });
    pending.push(e);
    // 按了按钮、写了 on= 的挑战还没做到：舞台课那时老师接着讲、再挂一问；这里没有老师，预写演完把同一个按钮再挂上，学生改了能再交
    if (act.type === 'next' && act.button) rehang(act.button);
    // 按了按钮才判的挑战（on=）：做没做到由 onGoal / 下面记；答对了、页面演了预写的：学生手上还有事就攒着
    if (act.reacted) { e.reacted = act.reacted; settle('answer'); return; }
    if (triggers(e)) call('answer');
  };
  function rehang(button) {
    Promise.resolve(st.reacting).then(() => {
      if (!alive || st.scene.waiting) return;
      if (![...goals().values()].some((g) => !g.met && !g.watch && g.on === button)) return;
      const t = st.begin({ auto: false, unpick: false });
      t.end(`ask next button=${quoteText(button)}`).catch(() => {});
    });
  }
  // 挑战做到了（学生做的）；老师的行、预写的行让它成立的只攒着
  st.onGoal = (ids, { by = 'student', reacted = 0, pressed = false } = {}) => {
    if (!alive) return;
    if (by !== 'student') { pending.push({ kind: 'goal-by-teacher', ids, at: Date.now() }); return; }
    const watch = ids.filter((g) => goals().get(g)?.watch);
    for (const gid of ids) {
      const g = goals().get(gid);
      if (g && !g.watch) session.record({ type: 'stage', q: g.text, ok: true, el, stage: id, goal: gid, text: `学生做到了挑战 ${gid}「${g.text}」${reacted ? `（页面演了你预写的 ${reacted} 行）` : ''}` });
    }
    pending.push({ kind: 'goal', ids, reacted, at: Date.now() });
    if (pressed) return; // 按了按钮才判的：那一下本身是回答，叫不叫由 onAnswer 定
    const now = watch.length > 0 || ids.some((gid) => goals().get(gid)?.call === 'now');
    settle(watch.length && watch.length === ids.length ? 'watch' : 'goal', now);
  };
  // 交给学生的东西做完了（规则算出没有下一步了）
  st.onDone = (ids, { by = 'student', reacted = 0, filled = [], ruled = [] } = {}) => {
    if (!alive || by !== 'student') return;
    pending.push({ kind: 'done', ids, reacted, at: Date.now(), ...(filled.length ? { filled } : {}), ...(ruled.length ? { ruled } : {}) });
    const told = ids.some((x) => [...st.scene.opens.values()].some((o) => o.obj === x && o.policy?.call === 'done'));
    settle('done', told);
  };
  // 页面记下的一句（手势弹回去的那一下、预写的行没演上、老师的行改了学生点的几样）：攒着，不叫
  st.onNote = (text, { tried = false } = {}) => {
    if (!alive || !text) return;
    pending.push({ kind: 'note', text, at: Date.now() });
    ev(tried ? 'stage-act' : 'stage-note', { text });
  };

  // 演镜头指令：演完（或者挂上了那一问、在等学生）那一刻，没演上的行报成写法错误
  const turn = st.begin({ auto: false });
  const done = turn.end(spec.script).catch((e) => { session.problem(el, 'stage', `舞台没演完：${e?.message || e}`); });
  const report = () => {
    if (!alive) return;
    for (const p of problemsOf(st.errors, spec.offset)) session.problem(el, 'stage', p.msg, { soft: p.soft });
    armIdle();
  };
  Promise.race([turn.armed, done]).then(report);
  // 这一段被换掉、拿下黑板：舞台清掉（ResizeObserver、键盘的监听一直留着会漏）
  const timer = setInterval(() => {
    if (el.isConnected) return;
    alive = false;
    clearInterval(timer);
    clearTimeout(idleTimer);
    try { st.destroy(); } catch { /* 已经拆过了 */ }
  }, 1000);
}
