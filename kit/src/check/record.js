// 检验的记录（设计 5.5；外部 review 必改 2）：证据（src: check）、每块的吸收 absorb/{块}、meta/state 那一行、
// 掌握参考用的题、ext_out 的字、最后没过的记错题。不碰 DOM，tests/check-record.test.js。
//
// 证据什么时候写：本题的结论定下来（final：过了、补上了、retry 用完、待核）时写一条；retry 判出来就写一条。
// 一条证据里有第一次的作答原文、每一项的结论、信心、用时、补讲、谁判的——外部看 since-analysis 就够，不用再来回问。
import { retestDates, bankId, fenceOf } from './bank.js';
import { baseType, traceTable, traceRows, traceRowName } from './spec.js';
import { bracketText } from './judge.js';
import { tokenizeSentence } from '../entext.js';

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clip = (t, n) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const SURE_TEXT = { sure: '很确定', maybe: '大概', guess: '蒙的' };
const FACET_TEXT = { ok: '✓', fixed: '补上', fail: '✗', pending: '待核' };
const FINAL_TEXT = { pass: '一次过', fixed: '补上', fail: '没吸收', pending: '待核' };
const valueText = (v) => (Array.isArray(v) ? `[${v.map(valueText).join(', ')}]` : String(v ?? '').trim() || '空');

/** 时长写成「1 分 20 秒」「45 秒」 */
export function msText(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} 分${s % 60 ? ` ${s % 60} 秒` : ''}` : `${s} 秒`;
}

/** 学生这次交的写成一段字（证据的 first；记错题的 mine 也用它，守卫核「我写的」要一字不差） */
export function answerSummary(probe, answer, r = {}) {
  if (r.giveup) return '想不出来';
  const a = answer || {};
  const slots = a.slots ? Object.entries(a.slots).map(([k, v]) => `${k}=${valueText(v)}`).join(' ') : '';
  const exprs = a.exprs ? (probe.exprs || []).filter((e) => a.exprs[e.id]).map((e) => `${e.label}：${a.exprs[e.id]}`).join('；') : '';
  const written = r.lines?.length ? r.lines.map((l) => `L${l.n}${l.struck ? '（划掉）' : ''}：${l.text}`).join('\n') : String(a.text ?? '').trim();
  const parts = [];
  if (probe.type === 'trace') {
    // 学生填的表：一行一行照写的抄（直接给出的行不抄；空格子写「空」）
    try {
      const { table } = traceTable(probe);
      const rowsOf = traceRows(table).map((x) => `${traceRowName(table, x.r)}：${table.rows[x.r].cells.map((c, j) => (c.given ? '（给出）' : String(a.cells?.[x.r]?.[j] ?? '').trim() || '空')).join(' | ')}`);
      const extra = Array.isArray(a.cells?.extra) && a.cells.extra.some((x) => String(x ?? '').trim()) ? [`表下面：${a.cells.extra.map((x) => String(x ?? '').trim() || '空').join(' | ')}`] : [];
      parts.push(...rowsOf, ...extra);
    } catch { /* 表都出不来：没有可写的 */ }
  }
  if (probe.type === 'predict' && a.expects) parts.push((probe.expects || []).map((e) => `${e.label || e.id}：${String(a.expects[e.id] ?? '').trim() || '空'}`).join('；') || '');
  if (probe.type === 'code' && a.code) parts.push(clip(String(a.code).replace(/\s+$/, ''), 300));
  if (probe.type === 'parse') parts.push((a.spans || []).length ? bracketText(probe.tokens || [], a.spans) : '（一处都没标）');
  if (probe.type === 'errfind') {
    const k = a.word === undefined || a.word === null || a.word === '' ? -1 : Number(a.word);
    const w = k >= 0 ? tokenizeSentence(probe.text || '')[k]?.w : '';
    parts.push(w ? `点了 ${w}，改成 ${String(a.fix ?? '').trim() || '（没写）'}` : `没点词${String(a.fix ?? '').trim() ? `，改成 ${String(a.fix).trim()}` : ''}`);
  }
  if (probe.type === 'claim') parts.push(`判${a.truth ? '真' : '假'}`);
  if (probe.type === 'discriminate') parts.push(probe.options ? String(a.pick ?? '').trim() || '（没选）' : a.can ? '能用' : '不能用');
  if (probe.type === 'locate') parts.push(`错在第 ${a.line} 行`);
  if (slots) parts.push(slots);
  if (exprs) parts.push(exprs);
  if (a.proof?.length) parts.push(a.proof.join(' = '));
  if (written) parts.push(written);
  if (a.result) parts.push(`结果：${a.result}`);
  if (a.fix && probe.type !== 'errfind') parts.push(`改成：${a.fix}`);
  if (a.ink?.final) parts.push(`（手写，整页图 ${a.ink.final}）`);
  return parts.filter(Boolean).join('；') || '（空的）';
}

const itemText = (it) => `${it.id} ${it.ok === 'missing' ? '没写到' : it.ok === null ? '待核' : String(it.id).startsWith('if') ? '不满足' : '不对'}${it.why ? `：${it.why}` : ''}`;

/** 一道题的一条证据。ctx：{ session, turn }；bankOf：复测时局部 id → 题库编号；retest：1 / 7 */
export function evidenceOf(s, id, { ctx = {}, bankOf = null, retest = null, rejudged = false, partial = false, renumbered = false } = {}) {
  const r = s.results[id];
  const p = s.check.probes[id];
  const orig = r.of ? s.results[r.of] : r;
  const teach = r.teach ? (r.teach.key === 'claude' ? { teach: 'claude', teachText: r.teach.text } : { teach: r.teach.key }) : {};
  return {
    id: `ev-ck-${newId()}`, src: 'check', kind: p.type, comp: `${s.check.id}:${id}`,
    session: ctx.session || null, block: p.block, tags: p.block ? [p.block] : [], ...(Number.isFinite(ctx.turn) && ctx.turn > 0 ? { turn: ctx.turn } : {}),
    check: s.check.id, probe: id, ...(r.of ? { retryOf: r.of } : {}), target: p.target, level: p.level, facet: p.facet,
    // text：和课上作答的证据同一个字段（守卫核「我写的」、话的语料都读它）
    q: clip(p.claim || p.q, 300), first: answerSummary(p, r.answer, r), text: answerSummary(p, r.answer, r), answer: r.answer ?? null,
    items: r.items || [], ...(baseType(p) === 'solve' ? { steps: (r.items || []).filter((x) => x.id !== 'result') } : {}), ...(r.lines ? { lines: r.lines } : {}),
    outcome: r.outcome ?? null, final: r.of ? null : orig.final ?? null, ...(r.of ? {} : { retries: orig.retries || [] }),
    sure: r.sure ?? null, late: !!r.late, giveup: !!r.giveup, ...(r.resumed ? { resumed: true } : {}),
    ms: r.ms ?? null, msTotal: r.msTotal ?? null, ...teach, judgedBy: r.judgedBy || 'page',
    ...(r.answer?.ink ? { ink: r.answer.ink } : {}), ...(retest ? { retest } : {}), ...(bankOf?.[id] ? { bank: bankOf[id] } : {}),
    ...(renumbered && !r.of ? { renumbered: true } : {}), ...(rejudged ? { rejudged: true } : {}), ...(partial ? { partial: true } : {}),
    // 模板取了数的题：取到的数、是哪个模板（外部照数核、看是不是换了数还错）
    ...(p.picked ? { picked: p.picked, template: p.tplOf || id } : {}),
    at: r.at || Date.now(),
  };
}

/** 该写证据的题：本题定下来了、retry 判出来了，还没写过的 */
export function toRecord(s) {
  const done = new Set(s.recorded || []);
  return Object.values(s.results).filter((r) => r.submitted && !done.has(r.id) && (r.of ? r.outcome && r.outcome !== 'pending' || (r.outcome === 'pending' && s.results[r.of]?.final) : r.final)).map((r) => r.id);
}

/** 停下、下课时：交了还没写证据的题（本题还没定下来、retry 在判），照现在的样子补写一条（final 是 null） */
export function flushIds(s) {
  const done = new Set([...(s.recorded || []), ...toRecord(s)]);
  return Object.values(s.results).filter((r) => r.submitted && !done.has(r.id)).map((r) => r.id);
}

/**
 * 一块的吸收文档（absorb/{块}）。result 是 flow.js 的 absorbOf；owed 是 flow 的 owed（局部 id，这里换成题库编号）；evidence 是这块的证据编号
 */
export function absorbDoc(prev, result, { check, session = null, space = null, at = Date.now(), today, families = [], owed = [], evidence = [] } = {}) {
  const history = prev ? [...(prev.history || []), { check: prev.check, session: prev.session, at: prev.at, state: prev.state, facets: prev.facets }].slice(-5) : [];
  // 状态类的 log：改了的字段一条一条记（schema.js 的 lastLog，自检要 to 是新值）
  const note = `检验 ${check.id}${session ? `（${session}）` : ''}`;
  // 同一次检验重算（外部改判、刷新以后补写）而且结论没变：主讲核过的照旧算核过（不被页面改回待核）
  const keep = !!(prev && prev.check === check.id && prev.session === session && prev.checked && prev.state === result.state);
  const log = [...(prev?.log || [])];
  for (const [field, to] of [['state', result.state], ['checked', keep]]) {
    const from = prev ? prev[field] ?? null : null;
    if (prev && from === to) continue;
    log.push({ date: today, by: 'page', field, from, to, basis: evidence.slice(0, 20), note });
  }
  return {
    block: result.block || prev?.block || check.blocks.find((b) => b.must.some((id) => result.probes?.includes(id)))?.block || null,
    space, state: result.state, facets: result.facets, by: keep ? prev.by || 'page' : 'page', checked: keep, check: check.id, session, at, date: today,
    probes: evidence, confidentWrong: result.confidentWrong || [], debt: result.debt || [], families,
    retests: retestDates(today), retryOwed: owed.filter((x) => check.probes[x]).map((x) => bankId(fenceOf(check.probes[x]))),
    history, log,
  };
}

/**
 * 补写以前做完的检验（刷新以后 classcheck.js 的 toFinish）时，这一块的吸收已经是别的检验、比它晚写的：不盖回去
 * （prev 是 absorb/{块} 现在的样子，cur：{ check, session, endedAt }）
 */
export function absorbStale(prev, { check, session, endedAt } = {}) {
  if (!prev) return false;
  if (prev.check === check && prev.session === session) return false;
  return (Number(prev.at) || 0) > (Number(endedAt) || 0);
}

/** meta/state-{科} 那一块的一行 */
export function stateLine(a) {
  if (!a?.state) return '';
  const md = (d) => String(d || '').slice(5);
  const facets = Object.entries(a.facets || {}).map(([k, v]) => `${k} ${FACET_TEXT[v] || v}`).join(' ');
  const rts = (a.retests || []).map((r) => `${md(r.due)}${r.done ? ` ${r.ok === false ? '✗' : '✓'}` : ''}`).join('、');
  const seven = (a.retests || []).find((r) => r.days === 7 && r.done && r.ok !== false);
  return [`吸收：${a.state}（${a.checked ? '主讲核过' : '页面判，待主讲核'}）`, md(a.date), facets, rts ? `复测 ${rts}${(a.retests || []).some((r) => r.renumbered) ? '（复测用的是换了数的同一道题）' : ''}${seven ? '（7 天复测过了，进不进复现由外部定）' : ''}` : ''].filter(Boolean).join(' · ').replace('） · ', '）· ');
}

const OUTCOME_ITEM = { pass: 'first', fail: 'wrong', pending: 'open' };

/** 掌握参考用的题（形状照 report.js 的 itemsOf）：本题（不要 retry）、不要外部改判追加的那条 */
export function checkItems(evidence = []) {
  return (evidence || []).filter((e) => e?.src === 'check' && !e.retryOf && !e.rejudged && e.outcome).map((e) => ({
    key: `${e.session || ''}§ck:${e.session || ''}:${e.bank || e.comp}`, comp: e.comp, session: e.session || null, tags: e.tags || (e.block ? [e.block] : []),
    outcome: e.giveup ? 'giveup' : OUTCOME_ITEM[e.outcome] || 'open', sure: e.sure !== 'guess',
    first: e.at, end: e.at, evidence: [e.id], ...(e.retest ? { retest: e.retest } : {}), ...(e.renumbered ? { renumbered: true } : {}), check: true,
  }));
}

/** 一条检验证据写成一行（since-analysis、ext_out、给外部看的作答行；trail.js 在前面加时间和课） */
export function checkLine(ev) {
  const head = `检验 ${ev.check} · ${ev.kind} ${ev.probe}${ev.retryOf ? `（${ev.retryOf} 的同构题）` : `（${ev.block || '?'}，打 ${ev.target}）`}`;
  const bad = (ev.items || []).filter((x) => x.ok !== true && !(x.ok === null && ev.outcome !== 'pending'));
  const what = ev.retryOf
    ? `retry ${ev.probe}（${ev.retryOf} 的同构题）${ev.outcome === 'pass' ? '对' : ev.outcome === 'pending' ? '待核' : '没过'}`
    : ev.outcome === 'pass' ? (ev.final === 'fixed' ? '过了（蒙的 / 超时，算补上）' : '一次过') : ev.outcome === 'pending' ? '待核' : `第一次没过 → ${FINAL_TEXT[ev.final] || '没做完'}`;
  const tail = [
    bad.length && ev.outcome !== 'pass' ? bad.map(itemText).join('；') : '',
    ev.teach ? `补讲 ${ev.teach}` : '',
    ev.retries?.length ? `retry ${ev.retries.join('、')}` : '',
    SURE_TEXT[ev.sure] || (ev.giveup ? '想不出来' : ''),
    ev.picked ? `取 ${ev.picked}` : '',
    ev.late ? '超时以后交的' : '',
    ev.ms ? msText(ev.ms) : '',
    ev.judgedBy && ev.judgedBy !== 'page' ? `${{ claude: '页面里的 Claude', ext: '主讲', timeout: '判分超时' }[ev.judgedBy] || ev.judgedBy}判的` : '',
  ].filter(Boolean);
  return `${ev.retryOf ? `检验 ${ev.check} · ${what}` : `${head}${what}`}${tail.length ? ` · ${tail.join(' · ')}` : ''}`;
}

/** ext_out：开始时那一行 */
export function extStart(check) {
  const must = check.blocks.reduce((n, b) => n + b.must.length, 0);
  return `[页面] 检验 ${check.id}${check.title ? `「${check.title}」` : ''}开始（${check.blocks.length} 块、${must} 道必做${check.limit ? `、限时 ${Math.round(check.limit / 60000)} 分钟` : ''}）`;
}

/** ext_out：做完（或停下）时一份：每块的吸收、每道一行、拿不准的、手写的 asset 编号和时间线 */
export function extSummary(s, check, absorbs = {}) {
  const out = [`[页面] 检验 ${check.id} ${s.phase === 'done' ? '做完了' : '先停下了'}（第一次作答用了 ${msText(s.visibleMs)}${check.limit ? `，限时 ${Math.round(check.limit / 60000)} 分钟` : ''}）`];
  for (const b of check.blocks) {
    const a = absorbs[b.block];
    out.push(a?.state ? `${b.block}：吸收 ${a.state}（页面判，待主讲核）· ${Object.entries(a.facets || {}).map(([k, v]) => `${k} ${FACET_TEXT[v] || v}`).join(' ')}${a.debt?.length ? ` · 没吸收：${a.debt.join('、')}` : ''}`
      : `${b.block}：没做完（做了 ${a?.done ?? 0}/${b.must.length} 道必做）`);
  }
  for (const b of check.blocks) for (const id of [...b.must, ...b.optional]) {
    const r = s.results[id];
    if (!r) continue;
    if (r.skipped) { out.push(`- ${id}：可选，跳过了（必做都一次过、很确定）`); continue; }
    const p = check.probes[id];
    const bad = (r.items || []).filter((x) => x.ok !== true);
    out.push(`- ${id}（${p.type}，打 ${p.target}${p.picked ? `，取 ${p.picked}` : ''}）：${FINAL_TEXT[r.final] || '没做完'}${r.sure === 'sure' && r.outcome === 'fail' ? '，很确定却错了' : ''} · 第一次：${clip(answerSummary(p, r.answer, r), 200)}${bad.length ? ` · ${bad.map(itemText).join('；')}` : ''}${r.retries?.length ? ` · retry ${r.retries.map((x) => `${x}${check.probes[x]?.picked ? `（取 ${check.probes[x].picked}）` : ''} ${s.results[x]?.outcome === 'pass' ? '对' : s.results[x]?.outcome === 'pending' ? '待核' : '没过'}`).join('、')}` : ''} · ${SURE_TEXT[r.sure] || (r.giveup ? '想不出来' : '')} · ${msText(r.ms)}`);
    const ink = r.answer?.ink;
    if (ink) out.push(`  手写：整页图 ${ink.final}${ink.shots?.length ? `；快照 ${ink.shots.map((x) => `${x.asset}（${x.why}）`).join('、')}` : ''}${ink.timeline ? `\n  ${ink.timeline}` : ''}`);
  }
  const pend = Object.values(s.results).filter((r) => r.final === 'pending' || (r.items || []).some((x) => x.ok === null && x.unsure));
  if (pend.length) out.push(`待主讲核的：${pend.map((r) => r.id).join('、')}（board judge target=题的 id 改判；或者直接写 absorb/{块}）`);
  return out.join('\n');
}

/**
 * 最后没过的、很确定却错了的题 → 给 memops.js 的 applyMemo 的 memo 条目（kind: error）。同一个 target 一次检验只记一道；补上了（且不是很确定却错的）、待核的不记。
 * evidence：题 id → 那条证据的编号（basis）
 */
export function errorEntries(s, check, { evidence = {} } = {}) {
  const out = [];
  const seen = new Set();
  for (const b of check.blocks) for (const id of [...b.must, ...b.optional]) {
    const r = s.results[id];
    if (!r?.submitted || r.skipped) continue;
    const confidentWrong = r.sure === 'sure' && r.outcome === 'fail';
    if (!(r.final === 'fail' || confidentWrong)) continue;
    const p = check.probes[id];
    if (seen.has(p.target)) continue;
    seen.add(p.target);
    const bad = (r.items || []).filter((x) => x.ok === false || x.ok === 'missing');
    const attrs = {
      q: clip(p.claim || p.q, 300), mine: answerSummary(p, r.answer, r),
      step: (r.giveup ? '想不出来' : bad.map(itemText).join('；')) || '没过',
      cause: p.target, block: p.block, basis: evidence[id] ? [evidence[id]] : [], check: check.id, probe: id, target: p.target, items: r.items || [],
    };
    out.push({ kind: 'error', attrs, line: `error q="${clip(attrs.q, 60)}" step="${clip(attrs.step, 60)}" cause="${attrs.cause}" basis=${attrs.basis.join(',')} check=${check.id} probe=${id}` });
  }
  return out;
}
