// 首页的课堂助手（docs/superpowers/specs/2026-11-13-aide-design.md 5.1、5.2、5.3）：读写数据库、调用 Claude 都在这里，判断全在纯函数里
// （after.js、card.js、fill.js、brief.js）。一次只做一件，一件做完隔 0.5 秒看下一件：
//   1. 下课后的整理（这一轮以后开的舞台课：复盘、归类、事实、学生卡一次写完）——新的课先；
//   2. 补学生卡（没有卡、过时了的块）；
//   3. 每一科的课前档案（猜得到下一节讲哪块就提前写；能用就不写）。
// 都走后台（lane: 'bg'：讲课、备课的调用在跑时不开）；只认 Opus 5.5，回的不是它、出错、看不懂一律不写，下次再做。
// 引的出处对不上的：事实那一条守卫不收，卡和档案那一行删掉；都不挂起等我放行（我说过不要再加要我确认的东西）。
import { scopeDb } from '../memory/session.js';
import { filterSpace, spaceOfId, spaceOfDoc, subjectOf, positionId } from '../memory/space.js';
import { voidedIds } from '../memory/memo.js';
import { pointCatalog, skillSummary, SKILLS_VERSION } from '../memory/skills.js';
import { DEBRIEF_VERSION, transcriptText, debriefText, debriefTraps } from '../memory/debrief.js';
import { guardDebrief, buildCorpus } from '../memory/guard.js';
import { reportText } from '../memory/report.js';
import { memoryDigest } from '../memory/digest.js';
import { assertWrite } from '../memory/schema.js';
import { lessonPlanText } from '../books/plan.js';
import { reportError } from '../errlog.js';
import { AFTER_VERSION, needsAfter, afterPrompt, parseAfter } from './after.js';
import { parseMoves, moveOutcome } from './moves.js';
import { parseCard, linesText, checkCardLines, acceptCard, cardSrc, cardIdsFor, cardText } from './card.js';
import { fillQueue, cardPrompt, crossPrompt } from './fill.js';
import { briefPrompt, parseBrief, briefSig, briefUsable, guessBlocks, BRIEF_MODEL } from './brief.js';
import { loadCards, loadAllCards, loadBrief, trapsFor, markTraps } from './load.js';
import { AIDE_SPACES } from './schema.js';

export const AIDE_MODEL = BRIEF_MODEL;
export const AIDE_TIMEOUT = 6 * 60 * 1000; // 一次下课后整理读整节课，平时一两分钟
const LIMITS = { after: 3, fill: 6 }; // 这次打开首页最多做几件（后台调用一次要一两分钟）
const docsOf = (snap) => (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
const bytesOf = (s) => new TextEncoder().encode(String(s ?? '')).length;
const cmpId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/**
 * db：学习台的数据库（guardDb 过的）；getData()：首页订阅着的记忆；ops：memops.js；ai()：拿到调用 Claude 的（没有就 null）；
 * packs()：各科的资料包 { math: { main, problems }, … }；ready()：记忆读齐了没有
 */
export function createAideDesk({ db, getData, ops, ai, packs = () => ({}), ready = () => true }) {
  let busy = false;
  let lastCards = null; // 最近读到的全部学生卡（工作单按章合并要用）；还没读过是 null
  const tried = { after: new Set(), fill: new Set(), brief: new Set() };
  const opts = (extra = {}) => ({ model: AIDE_MODEL, effort: 'high', modelTier: 'complex', cache: false, lane: 'bg', ...extra });

  async function callOpus(prompt, extra) {
    const c = await ai();
    if (!c) return null;
    // 挂住不回：过了 AIDE_TIMEOUT 算失败（不然这次打开首页再也不做、后台那一条道也一直堵着）
    let timer = null;
    const late = new Promise((r) => { timer = setTimeout(() => r(null), AIDE_TIMEOUT); });
    const res = await Promise.race([c.call(prompt, opts(extra)), late]).finally(() => clearTimeout(timer));
    // 没写是哪个模型（旧接口）也当不是 Opus：只认平台核验过的
    return !res || res.modelApplied !== AIDE_MODEL ? null : res;
  }
  // 读最新的那条再写（课堂、对话里的 Claude、别的设备可能刚改过）
  async function patchSession(sid, patch) {
    const cur = await db.doc(`sessions/${sid}`).get().then((r) => (r.exists ? r.data() : null));
    if (!cur) return;
    assertWrite('page', 'sessions');
    await db.doc(`sessions/${sid}`).set({ ...cur, ...patch });
  }
  async function countDropped(n) {
    if (!n) return;
    const ref = db.doc('meta/guard');
    const cur = await ref.get().then((s) => (s.exists ? s.data() : {})).catch(() => ({}));
    await ref.set({ ...cur, counts: { ...(cur.counts || {}), aide: (cur.counts?.aide || 0) + n }, at: Date.now() }).catch(() => {});
  }
  // 几节课的记录（核卡里引的轮次、原话用）
  async function corporaFor(sids) {
    const out = {};
    for (const sid of [...new Set(sids)].slice(0, 4)) {
      const sc = scopeDb(db, sid);
      const turns = await sc.collection('class_turns').get().then((s) => s.docs.map((d) => d.data()), () => []);
      const evidence = await db.collection('evidence').where('session', '==', sid).get().then(docsOf, () => []);
      out[sid] = buildCorpus({ turns, evidence });
    }
    return out;
  }
  // 一张卡：核出处、过上限，写进去。返回 { ok, dropped }
  async function writeCard(id, parsed, { old = null, data, corpora, session = null, model = AIDE_MODEL, space = '', labAt = 0 }) {
    const { keep, dropped } = checkCardLines(parsed.lines, { mem: data, corpora });
    const text = linesText(keep);
    const acc = acceptCard(text, old?.text || '');
    if (!acc.ok) return { ok: false, dropped: dropped.length + 1, why: acc.why };
    const isCross = id.startsWith('x-');
    assertWrite('page', 'cards');
    await db.doc(`cards/${id}`).set({ ...(isCross ? { space: space || id.slice(2) } : { block: id, space: spaceOfId(id) }), text, src: isCross ? '' : cardSrc(id, data), at: labAt || Date.now(), model, by: 'aide', ...(session ? { session } : {}), ...(labAt || old?.labAt ? { labAt: labAt || old.labAt } : {}) });
    return { ok: true, dropped: dropped.length };
  }

  /* ---------------- 1. 下课后的整理 ---------------- */
  // 材料（首页自己做、每晚教研室做用同一份）：返回 { prompt, ... } 或 { why }
  async function afterInput(sid) {
    const data = getData();
    const s = (data.sessions || []).find((x) => x.id === sid);
    if (!s) return { why: '这节课没了' };
    const sc = scopeDb(db, sid);
    const [turns, rep] = await Promise.all([
      sc.collection('class_turns').get().then((x) => x.docs.map((d) => d.data()), () => []),
      sc.doc('report/main').get().then((r) => (r.exists ? r.data() : null), () => null),
    ]);
    if (!turns.length) return { why: '没有记录' };
    const sp = spaceOfDoc('sessions', s, data) || s.space || spaceOfId(s.block || '');
    const mine = filterSpace(data, sp);
    const gone = voidedIds(data);
    const weak = (mine.weaknesses || []).filter((w) => !['closed', 'merged', 'void'].includes(w.status) && !gone.has(`weaknesses/${w.id}`));
    const prevS = (data.sessions || []).filter((d) => d.id !== sid && d.debrief && (spaceOfDoc('sessions', d, data) || '') === sp && (d.startedAt || 0) < (s.startedAt || 0)).sort((x, y) => (y.startedAt || 0) - (x.startedAt || 0))[0];
    const traps = await trapsFor(db, s.block);
    const blocks = (mine.curriculum || []).filter((x) => /\.\d+\.\d+$/.test(String(x.id))).sort((x, y) => cmpId(x.id, y.id));
    const catalog = Object.fromEntries(Object.entries(pointCatalog((data.sessions || []).filter((d) => d.id !== sid), data.mastery)).filter(([id]) => spaceOfId(id) === sp));
    const cardIds = [...new Set([s.block, ...(Array.isArray(s.blocks) ? s.blocks : [])].filter((x) => x && blocks.some((y) => y.id === x)))];
    const cards = await loadCards(db, cardIds);
    const notes = turns.filter((t) => t.kind === 'aide' && t.text).map((t) => ({ upTo: t.upTo, text: t.text }));
    const items = rep?.items || [];
    const prompt = afterPrompt({ session: s, transcript: transcriptText(turns), report: rep ? reportText(rep) : '', weaknesses: weak, prev: prevS ? debriefText(prevS.debrief) : '', subject: s.block ? subjectOf(s.block) : '', traps, items, curriculum: blocks, catalog, cards: cardIds.map((id) => ({ id, text: cards.find((c) => c.id === id)?.text || '' })), notes });
    return { prompt, s, sp, turns, rep, items, weak, traps, blocks, catalog, cardIds, cards };
  }
  // 写回答：复盘、归类、事实、卡。返回 { ok, why?, took }
  async function afterApply(sid, text, model, inp) {
    const { s, sp, turns, rep, items, weak, traps, blocks, catalog, cardIds, cards, prompt } = inp;
    const r = parseAfter(text, { items, blocks: blocks.map((b) => b.id), catalog, weaknesses: weak, cardIds: new Set(cardIds) });
    if (r.problems.includes('回的不是课后整理')) return { ok: false, why: '回的不是课后整理' };
    const now = Date.now();
    const data = getData();
    const evidence = await db.collection('evidence').where('session', '==', sid).get().then(docsOf, () => []);
    const corpus = buildCorpus({ turns, evidence });
    // 复盘：守卫照旧（对不上的挪进 held，下一节不带）；对上的坑记进 exam_bar
    const raw = { v: DEBRIEF_VERSION, at: now, model, bytes: bytesOf(prompt), mis: r.debrief.mis, pace: r.debrief.pace, habit: r.debrief.habit, opening: r.debrief.opening, advice: r.debrief.advice };
    const { debrief } = guardDebrief(raw, { session: sid, mem: data, corpus });
    const hit = debriefTraps(debrief, new Set(traps.map((t) => t.id)));
    const skills = items.length ? { v: SKILLS_VERSION, reportAt: Number(s.report?.at) || rep?.at || null, at: now, model, bytes: bytesOf(prompt), items: r.skills.items, points: r.skills.points, sum: skillSummary(rep, r.skills.items), problems: r.skills.problems.slice(0, 10) } : null;
    // 事实：作者 aide，守卫对不上的直接不收。写完先记一笔 factsAt：后面写卡、改这节课时出错整次重做，事实不再写一遍
    const fresh = await db.doc(`sessions/${sid}`).get().then((x) => (x.exists ? x.data() : null)).catch(() => null);
    const done = !!fresh?.after?.factsAt;
    const mr = r.memo.length && !done ? await ops.applyMemo(r.memo, { session: sid, block: s.block, space: sp, turns, author: 'aide' }) : { pds: [], rejected: [] };
    const factsAt = fresh?.after?.factsAt || now;
    if (!done) await patchSession(sid, { after: { ...(fresh?.after || {}), v: AFTER_VERSION, factsAt } });
    let cardsOk = 0;
    let dropped = 0;
    for (const [id, parsed] of Object.entries(r.cards)) {
      const w = await writeCard(id, parsed, { old: cards.find((c) => c.id === id), data: getData(), corpora: { [sid]: corpus }, session: sid, model });
      dropped += w.dropped;
      if (w.ok) cardsOk++;
    }
    const took = { facts: mr.pds.length, cards: cardsOk };
    // 讲法（第 3 批）：只认老师那几轮的编号、词表里的词；有没有用页面按证据算（moves.js），这里只存标了什么
    const moves = parseMoves(r.moves, { turns: new Set(turns.filter((t) => t.role === 'claude' && !t.discarded).map((t) => Number(t.seq))) }).map((m) => ({ ...m, out: moveOutcome(m, evidence) }));
    await patchSession(sid, { debrief, ...(skills ? { skills } : {}), moves, after: { v: AFTER_VERSION, at: now, factsAt, model, bytes: bytesOf(prompt), took, rejected: mr.rejected.length, dropped, problems: r.problems.slice(0, 10) } });
    await markTraps(db, s.block, hit).catch(() => {});
    await countDropped(dropped);
    return { ok: true, took, rejected: mr.rejected.map((x) => ({ line: x.line, error: x.error })), dropped };
  }
  async function afterOne(sid) {
    const s = (getData().sessions || []).find((x) => x.id === sid);
    if (!s) return false;
    tried.after.add(sid);
    // 失败也留着 factsAt（事实已经写了的，重做时不再写）；次数从数据库里最新的那份往上加
    const fail = async (why) => {
      console.warn('下课后的整理没做成', sid, why);
      const cur = await db.doc(`sessions/${sid}`).get().then((x) => (x.exists ? x.data() : null)).catch(() => null);
      const prev = cur?.after || s.after || {};
      await patchSession(sid, { after: { v: AFTER_VERSION, fails: (Number(prev.fails) || 0) + 1, lastFail: Date.now(), why: String(why).slice(0, 200), ...(prev.factsAt ? { factsAt: prev.factsAt } : {}) } });
      return false;
    };
    try {
      const inp = await afterInput(sid);
      if (!inp.prompt) return fail(inp.why);
      const res = await callOpus(inp.prompt);
      if (!res) return fail('调用不了，或者回的不是 Opus 5.5');
      const out = await afterApply(sid, res.text, res.modelApplied || AIDE_MODEL, inp);
      return out.ok ? true : fail(out.why);
    } catch (err) {
      reportError(err, { what: '下课后的整理', path: `sessions/${sid}`, soft: true });
      return fail(err?.message || err?.code || err);
    }
  }

  /** 教研室合并完的一张卡（labdesk.js）：照同样的核法写；这一章的卡都记上 labAt */
  async function saveCard(id, parsed, { model = 'lab', labAt = Date.now() } = {}) {
    const data = getData();
    const all = await loadAllCards(db);
    const sids = (data.sessions || []).filter((x) => x.block === id || (Array.isArray(x.blocks) && x.blocks.includes(id))).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).map((x) => x.id);
    const w = await writeCard(id, parsed, { old: all.find((c) => c.id === id) || null, data, corpora: await corporaFor(sids), model, labAt });
    await countDropped(w.dropped);
    return w;
  }
  /** 一章合并过了：没改的卡也记上 labAt（下次不再为它们出单子） */
  async function markMerged(ids, labAt = Date.now()) {
    for (const c of await loadCards(db, ids)) { const { id, ...rest } = c; if ((rest.labAt || 0) < labAt) { assertWrite('page', 'cards'); await db.doc(`cards/${id}`).set({ ...rest, labAt }); } }
  }

  /* ---------------- 2. 补学生卡 ---------------- */
  async function fillOne() {
    const data = getData();
    const all = lastCards = await loadAllCards(db);
    for (const space of AIDE_SPACES) {
      const near = guessBlocks(data, space, packs());
      const id = fillQueue(data, all, { space, near }).find((x) => !tried.fill.has(x));
      if (!id) continue;
      tried.fill.add(id);
      try {
        const old = all.find((c) => c.id === id) || null;
        let prompt;
        let corpora = {};
        if (id.startsWith('x-')) {
          const firsts = all.filter((c) => c.block && spaceOfId(c.block) === space).map((c) => ({ id: c.id, line: parseCard(c.text).lines.find((l) => l.sec === '概括')?.text || '' })).filter((f) => f.line);
          const general = filterSpace(data, space).weaknesses?.filter((w) => w.scope === '通用' && !['closed', 'merged', 'void'].includes(w.status)).map((w) => `- ${w.id} ${w.title || ''}`).join('\n') || '';
          prompt = crossPrompt({ space, firsts, old: old?.text || '', weaknesses: general });
        } else {
          const block = (data.curriculum || []).find((b) => b.id === id) || { id };
          const raw = memoryDigest(data, { block: id, budget: 24 * 1024, tools: false }).text;
          prompt = cardPrompt({ block: id, title: block.title || '', scope: block.scope || '', raw, old: old?.text || '' });
          const sids = (data.sessions || []).filter((s) => s.block === id || (Array.isArray(s.blocks) && s.blocks.includes(id))).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).map((s) => s.id);
          corpora = await corporaFor(sids);
        }
        const res = await callOpus(prompt);
        if (!res) return true;
        const w = await writeCard(id, parseCard(res.text), { old, data: getData(), corpora, model: res.modelApplied || AIDE_MODEL, space });
        if (!w.ok) console.warn('学生卡没收', id, w.why);
        await countDropped(w.dropped);
      } catch (err) {
        reportError(err, { what: '补学生卡', path: `cards/${id}`, soft: true });
      }
      return true;
    }
    return false;
  }

  /* ---------------- 3. 课前档案 ---------------- */
  // 档案的指纹按这几块开课时会读的那几张卡算（课堂里拿到的就是这几张，对得上才用）；内容跨着这一科全部的卡写
  const nearCards = (all, blocks, data, space) => { const ids = new Set(blocks.flatMap((b) => cardIdsFor(b, data.curriculum || [], space))); return all.filter((c) => ids.has(c.id)); };
  async function briefFor(space, blocks, { now = false } = {}) {
    if (!blocks?.length) return null;
    const data = getData();
    const all = await loadAllCards(db);
    const near = nearCards(all, blocks, data, space);
    const cur = await loadBrief(db, space);
    if (briefUsable(cur, { blocks, cards: near })) return cur;
    const mine = all.filter((c) => (c.block ? spaceOfId(c.block) === space : c.space === space));
    if (!mine.length) return null; // 一张卡都还没有：没东西可挑
    const pos = (data.position || []).find((p) => p?.id === positionId(space)) || null;
    const main = packs()?.[space]?.main;
    const plan = main && blocks.includes(main.block) ? lessonPlanText(main) : '';
    const rules = memoryDigest(data, { block: blocks[0], budget: 12 * 1024, tools: false }).rules;
    // 复现课（几块）：这几块挂着的复现组，档案要写「这几组以前错在哪」
    const review = blocks.length > 1 ? (data.reviews || []).filter((r) => r.status !== 'void' && (r.blocks || []).some((b) => blocks.includes(String(b)))).slice(0, 6).map((r) => `- ${r.id} ${r.title || ''}（${r.result ? `上次${r.result}` : '还没复现过'}${(r.errors || []).length ? `，错题 ${r.errors.join('、')}` : ''}）`).join('\n') : '';
    const prompt = briefPrompt({ space, blocks, cards: mine, plan, position: pos, rules, review });
    // now：开课那一刻和老师第一轮同时写（不排在讲课后面：排了就要等这一轮讲完）
    const res = await callOpus(prompt, now ? { lane: undefined } : {});
    if (!res) return null;
    const { lines } = parseBrief(res.text);
    const corpora = await corporaFor((data.sessions || []).filter((s) => blocks.includes(s.block)).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).map((s) => s.id));
    const { keep, dropped } = checkCardLines(lines.map((text) => ({ sec: '要点', text })), { mem: getData(), corpora });
    await countDropped(dropped.length);
    if (!keep.length) return null;
    const doc = { space, blocks: [...blocks], text: keep.map((l) => `要点｜${l.text}`).join('\n'), at: Date.now(), sig: briefSig(blocks, near), model: res.modelApplied || AIDE_MODEL, by: 'aide' };
    assertWrite('page', 'aide_briefs');
    await db.doc(`aide_briefs/${space}`).set(doc);
    return { id: space, ...doc };
  }

  /* ---------------- 调度 ---------------- */
  async function step() {
    const data = getData();
    const todo = (data.sessions || []).filter((s) => needsAfter(s) && !tried.after.has(s.id)).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    if (todo.length && tried.after.size < LIMITS.after) { await afterOne(todo[0].id); return true; }
    if (tried.fill.size < LIMITS.fill && await fillOne()) return true;
    for (const space of AIDE_SPACES) {
      if (tried.brief.has(space)) continue;
      tried.brief.add(space);
      const blocks = guessBlocks(data, space, packs());
      if (!blocks.length) continue;
      try { await briefFor(space, blocks); } catch (err) { reportError(err, { what: '课前档案', path: `aide_briefs/${space}`, soft: true }); }
      return true;
    }
    return false;
  }
  /** 做一件（once：测试用，做完不接着排下一件） */
  async function tick({ once = false } = {}) {
    if (busy || !ready()) return;
    busy = true;
    let did = false;
    try { did = await step(); } finally { busy = false; }
    if (did && !once) setTimeout(() => tick(), 500);
  }
  // 工作单要的全部卡：还没读过时先读一次（读到以前别拼工作单，不然 card 单子会被当成没了撤掉）
  const ensureCards = async () => { if (!lastCards) lastCards = await loadAllCards(db); return lastCards; };
  return { tick, afterOne, afterInput, afterApply, saveCard, markMerged, fillOne, briefFor, cards: () => lastCards, ensureCards, cardsFor: (block, space) => loadCards(db, cardIdsFor(block, getData().curriculum || [], space)), cardText };
}
