// 一次检验怎么走（设计 5.2、5.6′、5.6″）：纯函数 reducer，状态能整个 JSON 存取（存进 sessions/{编号}/check/{检验 id}，刷新、熄屏接着做）。
// 不读时间：时间都从事件里来（at、ms）。tests/check-flow.test.js
//
// 走法：
// - 一道一道往下做（先必做、再可选，按 block 行的先后）；只有当前那一道能交，交过的不再收（连点两下、两个标签页）。
// - 要页面里的 Claude 判的，交了马上做下一道；判回来没过的排进队里，当前这一道做完先补讲、再出 retry，再往下做新题。
// - 判出没过 → 补讲（外部写的 teach；没对上的要页面里的 Claude 写，needsFallback）→ retry 的下一道 → 过了算补上（fixed），
//   又错接着下一道，retry 用完记 fail。蒙对（sure: guess）也出 retry 确认。拿不准（pending）不补讲、不出 retry。
// - 可选题：这一块必做都一次过、都很确定、没有还在判的（写了 fast 的还要都在时间里）才跳过。
// - 限时只数第一次作答（不数补讲、retry）；过了 limit 交的记 late，做对最多算补上。
import { outcomeOf, teachFor, claudeIds } from './judge.js';

export const FINAL_RANK = { pass: 0, fixed: 1, pending: 2, fail: 3 };
const FACET_VALUE = { pass: 'ok', fixed: 'fixed', pending: 'pending', fail: 'fail' };

const clone = (s) => JSON.parse(JSON.stringify(s));

/** 新的一次检验（还没点开始） */
export function createFlow(check) {
  const todo = [];
  for (const b of check.blocks) {
    for (const id of b.must) todo.push({ id, kind: 'must', block: b.block });
    for (const id of b.optional) todo.push({ id, kind: 'optional', block: b.block });
  }
  return {
    v: 1, check, phase: 'intro', pausedFrom: null, cur: null, todo, results: {}, judging: {}, queue: [], teaching: null, owed: [],
    visibleMs: 0, limit: check.limit || 0, late: false, startedAt: null, endedAt: null,
  };
}

const probeOf = (s, id) => s.check.probes[id];
const origOf = (s, id) => s.results[id]?.of || id;
const usedRetries = (s, orig) => s.results[orig]?.retries || [];
const nextRetry = (s, orig) => probeOf(s, orig).retry.find((r) => !usedRetries(s, orig).includes(r)) || null;

function finalPass(s, orig) {
  const r = s.results[orig];
  r.final = r.late ? 'fixed' : 'pass';
}

/** 判出没过（或蒙对）：排进补讲的队 */
function enqueue(s, id, { guessed = false } = {}) {
  const r = s.results[id];
  const orig = origOf(s, id);
  const last = !nextRetry(s, orig);
  if (guessed) {
    if (last) { s.results[orig].final = 'fixed'; return; } // 蒙对了、没有 retry 能确认：最多算补上
    r.teach = { key: 'guess', text: null };
  } else {
    const own = teachFor(probeOf(s, id), r.failed, r.items, { giveup: r.giveup });
    const fromOrig = id !== orig ? teachFor(probeOf(s, orig), r.failed, r.items, { giveup: r.giveup }) : null;
    r.teach = own || fromOrig || { key: 'claude', text: null };
  }
  if (last && !guessed) s.results[orig].final = 'fail';
  s.queue.push({ id, of: orig, guessed, last });
}

/** 一道题判定下来了（机器判完、Claude 判回来、超时、想不出来、外部改判以外的） */
function resolve(s, id) {
  const r = s.results[id];
  const p = probeOf(s, id);
  const o = outcomeOf(p, r.items, { sure: r.sure });
  r.outcome = r.giveup ? 'fail' : o.outcome;
  r.failed = r.giveup ? ['giveup'] : o.failed;
  r.guessed = !r.giveup && o.guessed;
  const orig = origOf(s, id);
  if (r.outcome === 'pending') { s.results[orig].final ??= 'pending'; if (id !== orig) s.results[orig].final = 'pending'; return; }
  if (r.outcome === 'pass' && !r.guessed) {
    if (id === orig) finalPass(s, orig);
    else s.results[orig].final = 'fixed';
    return;
  }
  enqueue(s, id, { guessed: r.guessed });
}

/** 当前这一道做完（交了 / 补讲走完）以后往下走 */
function advance(s) {
  if (s.phase === 'paused') return;
  s.cur = null;
  if (s.queue.length) { s.teaching = s.queue.shift(); s.phase = 'teach'; return; }
  s.teaching = null;
  while (s.todo.length) {
    const next = s.todo[0];
    if (next.kind === 'optional' && canSkip(s, next.block)) {
      for (const t of s.todo.filter((x) => x.kind === 'optional' && x.block === next.block)) s.results[t.id] = { id: t.id, kind: 'optional', block: t.block, skipped: true };
      s.todo = s.todo.filter((x) => !(x.kind === 'optional' && x.block === next.block));
      continue;
    }
    s.todo.shift();
    s.cur = next;
    s.phase = 'probe';
    return;
  }
  s.phase = Object.keys(s.judging).length ? 'wait' : 'done';
}

function canSkip(s, block) {
  const b = s.check.blocks.find((x) => x.block === block);
  return b.must.every((id) => {
    const r = s.results[id];
    return r && r.final === 'pass' && r.sure === 'sure' && !s.judging[id] && (!b.fast || (Number(r.ms) || 0) <= b.fast);
  });
}

// 判回来的时候学生没在做题（在等最后几道判完）：接着走
const idle = (s) => s.phase === 'wait';

const ON = {
  start(s, ev) { if (s.phase !== 'intro') return; s.startedAt = ev.at ?? null; advance(s); },
  submit(s, ev) {
    if (s.phase !== 'probe' || !s.cur || s.cur.id !== ev.id || s.results[ev.id]?.submitted) return;
    const c = s.cur;
    const m = ev.machine || { items: [], needsClaude: false, stop: false };
    const r = s.results[ev.id] = {
      ...(s.results[ev.id] || {}), id: ev.id, kind: c.kind, block: c.block, ...(c.of ? { of: c.of } : {}),
      submitted: true, answer: ev.answer ?? null, sure: ev.sure || null, ms: ev.ms ?? null, msTotal: ev.msTotal ?? ev.ms ?? null,
      late: c.kind !== 'retry' && s.late, items: [...(m.items || [])], judgedBy: 'page', at: ev.at ?? null, ...(ev.resumed ? { resumed: true } : {}),
    };
    if (c.of) s.results[c.of].retries = [...usedRetries(s, c.of), ev.id].filter((x, i, a) => a.indexOf(x) === i);
    if (m.needsClaude && !m.stop) s.judging[ev.id] = ev.at ?? 0;
    else resolve(s, ev.id);
    void r;
    advance(s);
  },
  giveup(s, ev) {
    if (s.phase !== 'probe' || !s.cur || s.cur.id !== ev.id || s.results[ev.id]?.submitted) return;
    const c = s.cur;
    s.results[ev.id] = { ...(s.results[ev.id] || {}), id: ev.id, kind: c.kind, block: c.block, ...(c.of ? { of: c.of } : {}), submitted: true, giveup: true, answer: null, sure: null, ms: ev.ms ?? null, msTotal: ev.ms ?? null, late: c.kind !== 'retry' && s.late, items: [], judgedBy: 'page', at: ev.at ?? null };
    if (c.of) s.results[c.of].retries = [...usedRetries(s, c.of), ev.id].filter((x, i, a) => a.indexOf(x) === i);
    resolve(s, ev.id);
    advance(s);
  },
  verdict(s, ev) {
    if (s.judging[ev.id] === undefined) return; // 已经超时、或判过了
    delete s.judging[ev.id];
    const r = s.results[ev.id];
    const ids = claudeIds(probeOf(s, ev.id));
    r.items = [...r.items, ...(ev.items || []).filter((x) => ids.includes(x.id))];
    // 一项都没回的也补成 null（Claude 漏了的当拿不准）
    for (const id of ids) if (!r.items.some((x) => x.id === id)) r.items.push({ id, ok: null, why: '没判这一项', tag: '' });
    r.judgedBy = ev.judgedBy || 'claude';
    if (ev.lines) r.lines = ev.lines;
    if (ev.text) r.verdictText = ev.text;
    resolve(s, ev.id);
    if (idle(s)) advance(s);
  },
  timeout(s, ev) {
    if (s.judging[ev.id] === undefined) return;
    ON.verdict(s, { id: ev.id, items: [], judgedBy: 'timeout' });
  },
  teachText(s, ev) { const r = s.results[ev.id]; if (r?.teach?.key === 'claude') r.teach.text = String(ev.text ?? ''); },
  teachSeen(s, ev) {
    if (s.phase !== 'teach' || s.teaching?.id !== ev.id) return;
    const { of, last } = s.teaching;
    s.teaching = null;
    if (last) { advance(s); return; }
    const rid = nextRetry(s, of);
    if (!rid) { s.results[of].final = 'fail'; advance(s); return; }
    s.cur = { id: rid, kind: 'retry', of, block: s.results[of].block };
    s.phase = 'probe';
  },
  tick(s, ev) {
    if (s.phase !== 'probe' || !s.cur || s.cur.kind === 'retry') return;
    s.visibleMs += Math.max(0, Number(ev.ms) || 0);
    if (s.limit && s.visibleMs >= s.limit) s.late = true;
  },
  pause(s) { if (s.phase === 'paused' || s.phase === 'done') return; s.pausedFrom = s.phase; s.phase = 'paused'; },
  resume(s) { if (s.phase !== 'paused') return; s.phase = s.pausedFrom || 'probe'; s.pausedFrom = null; if (s.phase === 'wait' && !Object.keys(s.judging).length) advance(s); },
  ext(s, ev) {
    const r = s.results[ev.id];
    if (!r?.submitted) return;
    for (const it of ev.items || []) { const i = r.items.findIndex((x) => x.id === it.id); if (i >= 0) r.items[i] = { ...it }; else r.items.push({ ...it }); }
    const o = outcomeOf(probeOf(s, ev.id), r.items, { sure: r.sure });
    r.outcome = ev.result === 'pass' ? 'pass' : ev.result === 'fail' ? 'fail' : o.outcome;
    r.failed = r.outcome === 'fail' ? (o.failed.length ? o.failed : ['ext']) : [];
    r.judgedBy = 'ext';
    delete s.judging[ev.id];
    const orig = origOf(s, ev.id);
    const R = s.results[orig];
    if (ev.id === orig) {
      if (r.outcome === 'pass' && R.final !== 'fixed') R.final = R.late ? 'fixed' : 'pass';
      if (r.outcome === 'fail' && R.final !== 'fixed') {
        R.final = 'fail';
        for (const x of probeOf(s, orig).retry) if (!usedRetries(s, orig).includes(x) && !s.owed.includes(x)) s.owed.push(x);
      }
    } else {
      if (r.outcome === 'pass' && ['pending', 'fail'].includes(R.final)) R.final = 'fixed';
      if (r.outcome === 'fail' && ['pending', 'fixed'].includes(R.final)) R.final = 'fail';
    }
    // 拿走的是「还在判」的最后一道：接着走（不停在 wait）
    if (s.phase === 'wait' && !Object.keys(s.judging).length) advance(s);
  },
  end(s, ev) { s.endedAt = ev.at ?? null; },
  // 证据写了的题（record.js 的 toRecord 不再给）
  recorded(s, ev) { s.recorded = [...new Set([...(s.recorded || []), ...(ev.ids || [])])]; if (ev.evs) s.evidence = { ...(s.evidence || {}), ...ev.evs }; },
};

/** 走一步：返回新的状态（不改传进来的） */
export function step(state, event) {
  const s = clone(state);
  const f = ON[event?.type];
  if (f) f(s, event);
  if (s.phase === 'done' && !s.endedAt) s.endedAt = event?.at ?? null;
  return s;
}

/** 外壳照它画：{ show, id, kind, of, block, teach, left, waiting } */
export function view(s) {
  const left = s.limit ? Math.max(0, s.limit - s.visibleMs) : null;
  const waiting = Object.keys(s.judging).length;
  const base = { show: s.phase, left, waiting };
  if (s.phase === 'probe' && s.cur) return { ...base, id: s.cur.id, kind: s.cur.kind, of: s.cur.of || null, block: s.cur.block };
  if (s.phase === 'teach' && s.teaching) {
    const r = s.results[s.teaching.id];
    return { ...base, id: s.teaching.id, of: s.teaching.of, teach: { key: r.teach?.key ?? null, text: r.teach?.text ?? null, guessed: s.teaching.guessed, last: s.teaching.last, failed: r.failed || [], items: r.items || [] } };
  }
  return base;
}

/** 存着的「在判」的题（刷新、断了以后要重判一次） */
export const resumeJobs = (s) => Object.keys(s.judging || {});

/** 要页面里的 Claude 写补讲的题（外部写的 teach 没对上）：队里的、正在补讲的 */
export function needsFallback(s) {
  const ids = [...(s.teaching ? [s.teaching.id] : []), ...s.queue.map((q) => q.id)];
  return ids.filter((id) => s.results[id]?.teach?.key === 'claude' && s.results[id].teach.text === null);
}

/**
 * 一块的吸收（页面判的，待外部核）：没做完 null；有 fail 未；没有 fail、有 pending 待核；全 pass 成功；别的部分。
 * 返回 { state, facets, confidentWrong, debt, probes, done, must }
 */
export function absorbOf(s, block) {
  const b = s.check.blocks.find((x) => x.block === block);
  if (!b) return null;
  const done = b.must.filter((id) => s.results[id]?.final).length;
  const origs = [...b.must, ...b.optional].filter((id) => s.results[id] && !s.results[id].skipped);
  const unfinished = done < b.must.length || origs.some((id) => !s.results[id].final);
  const facets = {};
  for (const id of origs) {
    const f = s.results[id].final;
    if (!f) continue;
    const facet = probeOf(s, id).facet;
    const cur = facets[facet];
    if (!cur || FINAL_RANK[f] > FINAL_RANK[Object.keys(FACET_VALUE).find((k) => FACET_VALUE[k] === cur)]) facets[facet] = FACET_VALUE[f];
  }
  const finals = origs.map((id) => s.results[id].final);
  const state = unfinished ? null : finals.includes('fail') ? '未' : finals.includes('pending') ? '待核' : finals.every((f) => f === 'pass') ? '成功' : '部分';
  const confidentWrong = origs.filter((id) => s.results[id].sure === 'sure' && s.results[id].outcome === 'fail');
  const debt = [...new Set(origs.filter((id) => s.results[id].final === 'fail').map((id) => probeOf(s, id).target))];
  const probes = origs.flatMap((id) => [id, ...usedRetries(s, id)]);
  return { state, facets, confidentWrong, debt, probes, done, must: b.must.length };
}
