// 检验接进课堂（外部的课、页面里的老师的课）：board check 执行时开外壳、合书、判分调页面里的 Claude、写 ext_out、刷新接着做、
// board judge 指到检验里的题时改判。classroom.js 只调这里的 start / judge / has / resume（和计划 1 同时改的文件只加入口）
import { selfCheck } from './spec.js';
import { materialize } from './template.js';
import { step } from './flow.js';
import { claudeIds, verdictPrompt, parseVerdict, fallbackPrompt } from './judge.js';
import { extStart, extSummary } from './record.js';
import { canJudge, judgeOp } from './judgekit.js';
import { absorbOf } from './flow.js';
import { toFinish } from './shellkit.js';
import { floatVars } from '../exact.js';
import { mountCheck } from './shell.js';
import { createCheckDesk } from './checkdesk.js';
import { helperEvidence } from '../memory/session.js';
import { fitStrokes } from './inktime.js';
import { assetUrl } from '../live/store.js';

const LIVE = ['probe', 'teach', 'wait'];

/**
 * root：课堂的根（外壳挂在 .class-stage 里）；db：这节课的（scopeDb）；desk：学习台给课堂的（sid、space、memo）；
 * call(prompt, { images })：调页面里的 Claude（课堂给：Opus 5.5 high，不是它回 null）；tell(text)：告诉主讲（外部的课写进 ext_out，页面里的老师进下一轮）；
 * ctx()：{ turn, turns }；vars：这节课 let 定义的量（精确值；给函数时每次现取——课上 session.vars 会整个换掉）
 */
export function createClassCheck({ root, db, desk = null, call, tell = () => {}, ctx = () => ({}), readOnly = false, vars = {}, upload = async () => null, imageOf = () => null } = {}) {
  // 检验判分、自检都按浮点算（expr.js），课上 let 的是精确值（exact.js 的 Q）：直接给会「无法相乘」
  const base = () => { try { return floatVars(typeof vars === 'function' ? vars() : vars); } catch { return {}; } };
  const cdesk = createCheckDesk(db, { sid: desk?.sid || null, space: desk?.space || null, memoOps: desk?.memo?.ops || null, ctx, readOnly, curriculum: () => desk?.mem?.curriculum || [] });
  let cur = null; // { id, api, host, check }
  const known = new Map(); // 题 id → 检验 id（这次打开页面以后见过的：改判用）
  const stageEl = () => root.querySelector('.class-stage') || root;
  const closedBook = (on) => document.body.classList.toggle('is-checking', !!on);

  // 手写的整页图：交的时候手上有；刷新以后从资源里取回来（取不到就只给文字，页面里的 Claude 看不到图的照实判不了 → 待核）
  async function inkImages(answer, given) {
    if (given?.length) return given;
    const id = answer?.ink?.final;
    if (!id) return [];
    const local = imageOf(id);
    if (local) return [local];
    try { const r = await fetch(assetUrl(id)); return r.ok ? [await r.blob()] : []; } catch { return []; }
  }
  async function judge(probe, answer, given = []) {
    const ids = claudeIds(probe);
    const images = await inkImages(answer, given);
    if (!canJudge(answer, images)) return null; // 手写的图取不到（上传失败、刷新以后取不回）又没打字：不猜，待核
    const res = await call(verdictPrompt({ probe, answer, ids, images: images.length }), images.length ? { images } : {});
    if (!res) return null;
    const r = parseVerdict(res.text, ids, { steps: probe.type === 'solve' });
    return { items: r.items, lines: r.lines, judgedBy: 'claude', text: res.text };
  }
  async function fallback(probe, answer, items) {
    const res = await call(fallbackPrompt({ probe, answer, items, extPrompt: cur?.check?.prompt || '' }));
    const text = String(res?.text || '').trim();
    if (text && desk?.sid && !readOnly) {
      const ev = { ...helperEvidence(text, { session: desk.sid, turn: ctx().turn }, { role: 'check', target: probe.id }), wroteAt: Date.now() };
      db.doc(`evidence/${ev.id}`).set(ev).catch(() => {});
    }
    return text;
  }

  function strip(check, state) {
    const el = document.createElement('div');
    el.className = 'ck-strip';
    const n = Object.values(state.results).filter((r) => r.submitted && !r.of).length;
    el.innerHTML = `<span>检验 ${check.id} · 做了 ${n} 道</span><button type="button" class="btn btn-sm">接着做</button>`;
    el.querySelector('button').addEventListener('click', () => { el.remove(); cur?.api?.resume(); });
    return el;
  }

  function mount(check, saved = null) {
    const host = document.createElement('div');
    host.className = 'ck-host';
    stageEl().prepend(host);
    for (const pid of check.order) known.set(pid, check.id);
    let told = false;
    let finished = false;
    let finishedAt = saved?.finishedAt || null;
    let closed = !!saved?.closed;
    let last = saved;
    // 存进度时带上「吸收、错题写完了」的时刻和「回到黑板了」（外壳的 state 里没有这两样）
    const persist = (s) => { last = s; cdesk.save(check.id, { ...s, ...(finishedAt ? { finishedAt } : {}), ...(closed ? { closed: true } : {}) }); };
    // 做完的那一刻就写吸收、记错题、写 ext_out（不等学生点「回到黑板」：下了课、关了页也不丢）；写完记 finishedAt
    const finish = (s) => {
      if (finished) return;
      finished = true;
      const st = step(s, { type: 'end', at: Date.now() });
      finishOnce(check, st).then((at) => { if (at) { finishedAt = at; persist(last || st); } });
    };
    const api = mountCheck(host, {
      check, vars: base(), saved,
      judge, fallback,
      save: (s) => {
        persist(s);
        closedBook(LIVE.includes(s.phase));
        if (s.phase === 'done') finish(s);
        if (s.phase !== 'intro' && !told && (!saved || saved.phase === 'intro')) { told = true; tell(extStart(check)); }
        if (s.phase === 'paused' && !host.querySelector('.ck-strip')) { host.querySelector('.ck-shell').hidden = true; host.prepend(strip(check, s)); }
        if (s.phase !== 'paused') { host.querySelector('.ck-strip')?.remove(); const sh = host.querySelector('.ck-shell'); if (sh) sh.hidden = false; }
      },
      record: (ids, s, o) => cdesk.record(ids, s, o),
      lockKey: desk?.sid ? `la-ck-lock-${desk.sid}-${check.id}` : '',
      upload,
      inkKey: (pid) => (desk?.sid ? `la-ck-${desk.sid}-${check.id}-${pid}` : ''),
      // 回放用的笔画：sessions/{编号}/ink/{检验 id}-{题 id}（fitStrokes 压到 200 KiB 以内）
      onInk: (pid, strokes, events) => { if (readOnly) return; const f = fitStrokes(strokes); db.doc(`ink/${check.id}-${pid}`).set({ check: check.id, probe: pid, ...f, events: (events || []).slice(-300), at: Date.now() }).catch(() => {}); },
      onPause: (s) => { api.flush(); tell(extSummary(s, check, Object.fromEntries(check.blocks.map((b) => [b.block, absorbOf(s, b.block)])))); },
      onEnd: ({ state }) => {
        closedBook(false);
        finish(state);
        closed = true;
        persist(state);
        api.destroy(); host.remove();
        cur = null;
      },
    });
    // 模板取好数的那一份（接着做的是存着的）：改判、ext_out 都照它
    check = api.check();
    for (const pid of check.order) known.set(pid, check.id);
    // 做完以后外部改判：同一次检验重算吸收（不另进 history、不再记错题）
    cur = { id: check.id, api, host, check, refinish: () => (finished ? cdesk.finish(api.state(), { errors: false }) : null) };
    return api;
  }

  // 写吸收、记错题、告诉主讲，一次检验一次；写完回那一刻（失败回 null，下次打开课堂再补）
  async function finishOnce(check, st) {
    try {
      const { absorbs, errors } = await cdesk.finish(st);
      tell([extSummary(st, check, absorbs), ...errors.map((x) => `[页面] 检验 ${check.id}：${x}`)].join('\n'));
      return Date.now();
    } catch { return null; }
  }

  return {
    /** board check：外部写错了（写法、自检）不开，原因照实回 */
    start(op) {
      if (readOnly) return { op: 'check', id: op.id, ok: false, error: '只读的课不能开检验' };
      if (cur) return { op: 'check', id: op.id, ok: false, error: `已经有一个检验（${cur.id}）开着：做完或停下以后再开` };
      const errs = [...(op.errors || []), ...selfCheck(op.check, base())];
      if (errs.length) return { op: 'check', id: op.id, ok: false, error: errs.slice(0, 4).join('；') };
      // 模板这一次取好数（某一组数自检不过的重取；还不行照实回）
      const m = materialize(op.check, { base: base() });
      if (m.errors.length) return { op: 'check', id: op.id, ok: false, error: m.errors.slice(0, 4).join('；') };
      cdesk.bankStore(op.check, base());
      mount(m.check);
      return { op: 'check', id: op.id, ok: true };
    },
    has: (pid) => known.has(pid),
    /** board judge target=题（检验里的）：一行一项，result=pass|fail 改整道题。开着的检验当场改（同步回）；做完了的读存着的进度改（回 Promise） */
    judge(op) {
      const cid = known.get(op.target);
      // 写错、没读懂的行照实回报（以前静默丢掉、照样说「改判了」）
      const bad = (r) => (r.errors?.length ? `；这几行没读懂、没改：${r.errors.slice(0, 3).join('；')}` : '');
      if (cur?.id === cid) {
        const r = judgeOp(op, cur.api.state());
        if (r.error) return { op: 'judge', target: op.target, ok: false, error: r.error };
        cur.api.rejudge(op.target, r.state.results[op.target].items, r.result);
        cdesk.record([op.target], cur.api.state(), { rejudged: true });
        cur.refinish();
        return { op: 'judge', target: op.target, ok: true, line: `检验 ${cid} 的 ${op.target} 改判了${bad(r)}` };
      }
      return (async () => {
        const saved = await cdesk.load(cid);
        if (!saved) return { op: 'judge', target: op.target, ok: false, error: `检验 ${cid} 的记录读不到` };
        const r = judgeOp(op, saved);
        if (r.error) return { op: 'judge', target: op.target, ok: false, error: r.error };
        cdesk.save(cid, r.state);
        cdesk.record([op.target], r.state, { rejudged: true });
        const { absorbs } = await cdesk.finish(r.state, { errors: false });
        return { op: 'judge', target: op.target, ok: true, line: `检验 ${cid} 的 ${op.target} 改判了；${Object.entries(absorbs).map(([b, a]) => `${b} 吸收 ${a?.state || '没做完'}`).join('、')}${bad(r)}` };
      })();
    },
    /** 刷新以后：还没做完的检验接着做（没点开始的照旧停在开始那一张） */
    async resume() {
      if (readOnly || cur) return;
      const rows = await cdesk.list();
      for (const row of rows) for (const pid of row.state?.check?.order || []) known.set(pid, row.id);
      // 做完那一刻刷新、关了页：吸收、错题、ext_out 那一份补写（finish 可以重入）
      for (const row of toFinish(rows)) finishOnce(row.state.check, step(row.state, { type: 'end', at: row.state.endedAt || Date.now() })).then((at) => { if (at) cdesk.save(row.id, { ...row.state, finishedAt: at }); });
      const open = rows.filter((x) => x.state && !x.state.closed && x.state.phase !== 'done').sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      if (open) mount(open.state.check, open.state);
    },
    pause() { cur?.api?.pause(); },
    /** 下课：开着的检验照「先停下」存着，交了没定下来的题补写证据，ext_out 写一份「先停下了」 */
    close() {
      if (!cur) return;
      const { api, check } = cur;
      api.pause();
      api.flush();
      const s = api.state();
      if (s.phase !== 'done') tell(extSummary(s, check, Object.fromEntries(check.blocks.map((b) => [b.block, absorbOf(s, b.block)]))));
    },
    current: () => cur,
  };
}
