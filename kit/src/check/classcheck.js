// 检验接进课堂（外部的课、页面里的老师的课）：board check 执行时开外壳、合书、判分调页面里的 Claude、写 ext_out、刷新接着做、
// board judge 指到检验里的题时改判。classroom.js 只调这里的 start / judge / has / resume（和计划 1 同时改的文件只加入口）
import { selfCheck } from './spec.js';
import { step } from './flow.js';
import { claudeIds, verdictPrompt, parseVerdict, fallbackPrompt } from './judge.js';
import { extStart, extSummary } from './record.js';
import { mountCheck } from './shell.js';
import { createCheckDesk } from './checkdesk.js';
import { parseJudge } from '../solvespec.js';
import { helperEvidence } from '../memory/session.js';

const LIVE = ['probe', 'teach', 'wait'];

/**
 * root：课堂的根（外壳挂在 .class-stage 里）；db：这节课的（scopeDb）；desk：学习台给课堂的（sid、space、memo）；
 * call(prompt, { images })：调页面里的 Claude（课堂给：Opus 5.5 high，不是它回 null）；tell(text)：告诉主讲（外部的课写进 ext_out，页面里的老师进下一轮）；
 * ctx()：{ turn, turns }
 */
export function createClassCheck({ root, db, desk = null, call, tell = () => {}, ctx = () => ({}), readOnly = false, vars = {} } = {}) {
  const cdesk = createCheckDesk(db, { sid: desk?.sid || null, space: desk?.space || null, memoOps: desk?.memo?.ops || null, ctx, readOnly, curriculum: () => desk?.mem?.curriculum || [] });
  let cur = null; // { id, api, host, check }
  const known = new Map(); // 题 id → 检验 id（这次打开页面以后见过的：改判用）
  const stageEl = () => root.querySelector('.class-stage') || root;
  const closedBook = (on) => document.body.classList.toggle('is-checking', !!on);

  async function judge(probe, answer) {
    const ids = claudeIds(probe);
    const res = await call(verdictPrompt({ probe, answer, ids, images: 0 }));
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
    // 做完的那一刻就写吸收、记错题、写 ext_out（不等学生点「回到黑板」：下了课、关了页也不丢）
    const finish = (s) => {
      if (finished) return;
      finished = true;
      const st = step(s, { type: 'end', at: Date.now() });
      cdesk.finish(st).then(({ absorbs, errors }) => tell([extSummary(st, check, absorbs), ...errors.map((x) => `[页面] 检验 ${check.id}：${x}`)].join('\n')));
    };
    const api = mountCheck(host, {
      check, vars, saved,
      judge, fallback,
      save: (s) => {
        cdesk.save(check.id, s);
        closedBook(LIVE.includes(s.phase));
        if (s.phase === 'done') finish(s);
        if (s.phase !== 'intro' && !told && !saved) { told = true; tell(extStart(check)); }
        if (s.phase === 'paused' && !host.querySelector('.ck-strip')) { host.querySelector('.ck-shell').hidden = true; host.prepend(strip(check, s)); }
        if (s.phase !== 'paused') { host.querySelector('.ck-strip')?.remove(); const sh = host.querySelector('.ck-shell'); if (sh) sh.hidden = false; }
      },
      record: (ids, s) => cdesk.record(ids, s),
      onPause: (s) => tell(extSummary(s, check, {})),
      onEnd: ({ state }) => {
        closedBook(false);
        finish(state);
        cdesk.save(check.id, { ...state, closed: true });
        api.destroy(); host.remove();
        cur = null;
      },
    });
    cur = { id: check.id, api, host, check };
    return api;
  }

  return {
    /** board check：外部写错了（写法、自检）不开，原因照实回 */
    start(op) {
      if (readOnly) return { op: 'check', id: op.id, ok: false, error: '只读的课不能开检验' };
      if (cur) return { op: 'check', id: op.id, ok: false, error: `已经有一个检验（${cur.id}）开着：做完或停下以后再开` };
      const errs = [...(op.errors || []), ...selfCheck(op.check, vars)];
      if (errs.length) return { op: 'check', id: op.id, ok: false, error: errs.slice(0, 4).join('；') };
      cdesk.bankStore(op.check);
      mount(op.check);
      return { op: 'check', id: op.id, ok: true };
    },
    has: (pid) => known.has(pid),
    /** board judge target=题（检验里的）：一行一项，result=pass|fail 改整道题。开着的检验当场改（同步回）；做完了的读存着的进度改（回 Promise） */
    judge(op) {
      const cid = known.get(op.target);
      const lines = String(op.body || '').split('\n');
      const result = lines.map((l) => l.trim().match(/^result\s*=\s*(pass|fail)$/i)?.[1]?.toLowerCase()).find(Boolean) || null;
      const rest = lines.filter((l) => !/^\s*result\s*=/.test(l)).join('\n');
      const apply = (state) => {
        const r = state.results[op.target];
        if (!r?.submitted) return { state, error: `${op.target} 还没交` };
        const ids = [...new Set([...(r.items || []).map((x) => x.id), ...claudeIds(state.check.probes[op.target])])];
        const parsed = rest.trim() ? parseJudge(rest, ids.map((id) => ({ id }))) : { steps: [], errors: [] };
        const items = parsed.steps.filter((x) => rest.includes(x.id));
        return { state: step(state, { type: 'ext', id: op.target, items, result, at: Date.now() }), errors: parsed.errors };
      };
      if (cur?.id === cid) { const s = cur.api.state(); const r = apply(s); if (r.error) return { op: 'judge', target: op.target, ok: false, error: r.error }; cur.api.rejudge(op.target, r.state.results[op.target].items, result); cdesk.record([op.target], cur.api.state(), { rejudged: true }); return { op: 'judge', target: op.target, ok: true, line: `检验 ${cid} 的 ${op.target} 改判了` }; }
      return (async () => {
      const saved = await cdesk.load(cid);
      if (!saved) return { op: 'judge', target: op.target, ok: false, error: `检验 ${cid} 的记录读不到` };
      const r = apply(saved);
      if (r.error) return { op: 'judge', target: op.target, ok: false, error: r.error };
      cdesk.save(cid, r.state);
      cdesk.record([op.target], r.state, { rejudged: true });
      const { absorbs } = await cdesk.finish(r.state, { errors: false });
      return { op: 'judge', target: op.target, ok: true, line: `检验 ${cid} 的 ${op.target} 改判了；${Object.entries(absorbs).map(([b, a]) => `${b} 吸收 ${a?.state || '没做完'}`).join('、')}` };
      })();
    },
    /** 刷新以后：还没做完的检验接着做（没点开始的照旧停在开始那一张） */
    async resume() {
      if (readOnly || cur) return;
      const rows = await cdesk.list();
      for (const row of rows) for (const pid of row.state?.check?.order || []) known.set(pid, row.id);
      const open = rows.filter((x) => x.state && !x.state.closed && x.state.phase !== 'done').sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      if (open) mount(open.state.check, open.state);
    },
    pause() { cur?.api?.pause(); },
    current: () => cur,
  };
}
