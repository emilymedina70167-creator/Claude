// 记忆摘要的数据库这一层（第十三轮，docs/superpowers/specs/2026-11-16-mirror-design.md 6.1）：
// 当场记一条新笔记、课后把一节课（或班主任的一段对话）并进摘要重写一遍、学生自己改和退回。
// 判断都在 summary.js（纯函数）；这里只管读最新的、调用、核、写回去。首页（后台重写、管理页）、课堂（当场记）、班主任都用它。
import {
  SUMMARY_IDS, REWRITE_FAILS, QUIET_MS, summaryOn, addNote, noteOf, nextDoc, rollback, rewritePrompt, parseRewrite, checkRewrite,
  legacyText, needsRewrite, sinceOf, maxOf, utf8,
} from './summary.js';
import { transcriptText } from './debrief.js';
import { reportText } from './report.js';
import { aimLines, laterLine } from './holds.js';
import { spaceOfDoc, spaceOfId } from './space.js';
import { assertWrite } from './schema.js';
import { reportError } from '../errlog.js';

export const SUMMARY_MODEL = 'claude-opus-5-5';
export const SUMMARY_TIMEOUT = 6 * 60 * 1000;
const rowsOf = (snap) => (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
const clean = (s) => String(s ?? '').trim();

/**
 * db：学习台的数据库（没 scope 过的）；getData()：手上的记忆（summary、sessions、evidence，还有第一次重写要的旧规则那几类）；
 * ai()：拿到调用 Claude 的（没有就 null）；onChange()：摘要变了（管理页重画）
 */
export function createSummary({ db, getData, ai, now = () => Date.now(), onChange = () => {} }) {
  const running = new Map();

  const docs = () => Object.fromEntries(SUMMARY_IDS.map((id) => [id, (getData().summary || []).find((d) => d?.id === id) || null]));
  const on = () => summaryOn(getData());
  // 记忆库里一条旧的规则、守则、要求都没有（新的数据库）：一开始就走摘要，不用先攒一轮旧的再换
  const fresh = () => { const d = getData(); return !['rules', 'lessons', 'asks'].some((c) => (d[c] || []).length); };
  const ready = () => on() || fresh();

  // 手上的那份记忆跟着改（课堂里的记忆不订阅 summary：老师下一轮就要看到刚记的新笔记）
  function local(doc) {
    const d = getData();
    const list = Array.isArray(d.summary) ? d.summary : (d.summary = []);
    const i = list.findIndex((x) => x?.id === doc.id);
    if (i < 0) list.push(doc); else list[i] = doc;
    onChange();
  }
  // 读最新的那一条再改（课上、别的设备、后台重写可能刚写过）；同一条的几次写排队
  const chains = new Map();
  function patch(id, role, fn) {
    const run = async () => {
      const ref = db.doc(`summary/${id}`);
      const cur = await ref.get().then((r) => (r.exists ? { id, ...r.data() } : null));
      const next = fn(cur);
      if (!next) return null;
      assertWrite(role, 'summary');
      await ref.set(next);
      local(next);
      return next;
    };
    const p = (chains.get(id) || Promise.resolve()).then(run, run);
    chains.set(id, p.catch(() => {}));
    return p;
  }

  /** 当场记一条新笔记。space：'shared' 或 math / cs / en（别的都当共用） */
  async function note({ text, quote = '', space = 'shared', session = '', by = 'class' } = {}) {
    const id = SUMMARY_IDS.includes(space) ? space : 'shared';
    let out = { added: false, why: '' };
    await patch(id, by === 'me' ? 'me' : 'class', (cur) => {
      const r = addNote(cur, noteOf({ text, quote, session, by, at: now() }), { id });
      out = { added: r.added, why: r.why || '' };
      return r.added ? r.doc : null;
    });
    return out;
  }

  /** 学生自己改的一版 */
  async function save(id, text) {
    if (!SUMMARY_IDS.includes(id)) throw new Error(`没有 ${id} 这一份摘要`);
    if (utf8(clean(text)) > maxOf(id)) throw new Error(`太长了：这一份最多 ${maxOf(id)} 字节（约 ${Math.floor(maxOf(id) / 3)} 个字）`);
    return patch(id, 'me', (cur) => (clean(cur?.text) === clean(text) ? null : nextDoc(cur, { id, text, by: 'me', at: now() })));
  }
  /** 退回上一版。没有上一版返回 null */
  const back = (id) => patch(id, 'me', (cur) => (cur ? rollback(cur, { at: now() }) : null));
  /** 删一条新笔记（按它记下的时间认） */
  const dropNote = (id, at) => patch(id, 'me', (cur) => (cur && (cur.notes || []).some((n) => n.at === at) ? { ...cur, notes: cur.notes.filter((n) => n.at !== at) } : null));

  const needs = (s) => needsRewrite(s, { evidence: getData().evidence || [], now: now(), since: sinceOf(getData()) });

  async function call(prompt) {
    const c = await ai();
    if (!c) return null;
    let timer = null;
    const late = new Promise((r) => { timer = setTimeout(() => r(null), SUMMARY_TIMEOUT); timer?.unref?.(); });
    const res = await Promise.race([c.call(prompt, { model: SUMMARY_MODEL, effort: 'high', modelTier: 'complex', cache: false, lane: 'bg' }), late]).finally(() => clearTimeout(timer));
    // 讲课只认 Opus 5.5，写老师每一轮都要读的摘要也只认它：回的不是就不写
    return !res || res.modelApplied !== SUMMARY_MODEL ? null : res;
  }
  async function patchDoc(path, coll, sum) {
    const ref = db.doc(path);
    const cur = await ref.get().then((r) => (r.exists ? r.data() : null));
    if (!cur) return;
    if (coll === 'sessions') assertWrite('page', 'sessions');
    await ref.set({ ...cur, sum: { ...(cur.sum || {}), ...sum } });
  }
  const latest = (id) => db.doc(`summary/${id}`).get().then((r) => (r.exists ? { id, ...r.data() } : null));

  // 调用、读回、核、写两份（或只写共用）。返回 'done' / 'fail'
  async function rewrite({ space, prompt, startedAt, src }) {
    const res = await call(prompt);
    if (!res) return 'fail';
    const both = !!space;
    const got = parseRewrite(res.text, { both });
    if (got.problems.length) { reportError(`记忆摘要重写回来的格式不对：${got.problems.join('；')}`, { what: '记忆摘要', path: src, soft: true }); return 'fail'; }
    const [shared, subject] = await Promise.all([latest('shared'), both ? latest(space) : null]);
    const checks = [checkRewrite({ prev: shared?.text, next: got.shared, id: 'shared' }), both ? checkRewrite({ prev: subject?.text, next: got.subject, id: space }) : { ok: true }];
    const bad = checks.map((c, i) => (c.ok ? '' : `${i ? '这一科' : '共用'}那一份${c.why}`)).filter(Boolean);
    if (bad.length) { reportError(`记忆摘要重写回来的没收：${bad.join('；')}`, { what: '记忆摘要', path: src, soft: true }); return 'fail'; }
    await patch('shared', 'page', (cur) => nextDoc(cur, { id: 'shared', text: got.shared, by: 'page', at: now(), startedAt, src }));
    if (both) await patch(space, 'page', (cur) => nextDoc(cur, { id: space, text: got.subject, by: 'page', at: now(), startedAt, src }));
    return 'done';
  }

  /** 把一节课并进摘要：'done' / 'skip'（没有这节课、没有要并的）/ 'fail' */
  function runFor(sid) {
    const key = `sessions/${sid}`;
    if (running.has(key)) return running.get(key);
    const p = runClass(sid).catch((err) => { reportError(err, { what: '记忆摘要', path: key, soft: true }); return 'fail'; }).finally(() => running.delete(key));
    running.set(key, p);
    return p;
  }
  async function runClass(sid) {
    const s = await db.doc(`sessions/${sid}`).get().then((r) => (r.exists ? { id: sid, ...r.data() } : null));
    if (!s) return 'skip';
    const evidence = rowsOf(await db.collection('evidence').where('session', '==', sid).get());
    const last = Math.max(0, ...evidence.map((e) => Number(e.at) || 0));
    if (!last || last <= Math.max(Number(s.sum?.upTo) || 0, sinceOf(getData()))) return 'skip';
    const startedAt = now();
    // 调用之前先记一次「试过」：一两分钟的调用，学生一点进课堂整页刷新就断了，后面的 fail 记不上
    await patchDoc(`sessions/${sid}`, 'sessions', { fails: (Number(s.sum?.fails) || 0) + 1, tryAt: startedAt, failUpTo: last });
    const data = getData();
    const space = s.space || spaceOfDoc('sessions', s, data) || spaceOfId(s.block || '');
    const [turns, rep, shared, subject] = await Promise.all([
      db.collection(`sessions/${sid}/class_turns`).get().then(rowsOf, () => []),
      db.doc(`sessions/${sid}/report/main`).get().then((r) => (r.exists ? r.data() : null), () => null),
      latest('shared'), latest(space),
    ]);
    const said = evidence.filter((e) => e.src === 'say' && clean(e.text)).sort((a, b) => (a.at || 0) - (b.at || 0)).map((e) => ({ at: e.at, text: e.text }));
    const laters = (data.sessions || []).filter((x) => x.id !== sid && x.later?.n && (x.space || spaceOfDoc('sessions', x, data)) === space)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 5).map((x) => `- ${x.date || ''} ${x.title || ''}：${laterLine(x.later)}`).join('\n');
    const prompt = rewritePrompt({
      space, shared, subject, said, title: s.title || '', today: new Date(startedAt).toISOString().slice(0, 10),
      transcript: transcriptText(turns), report: rep ? reportText(rep) : '',
      aims: Array.isArray(s.aims) && s.aims.length ? aimLines(s, rep).map((l) => `- ${l}`).join('\n') : '',
      later: laters,
      // 这一科那一份还没有字：把以前一条条攒下的规则、守则、要求当原料给它（只给这一次）
      legacy: clean(subject?.text) ? '' : legacyText(data, space),
    });
    const r = await rewrite({ space, prompt, startedAt, src: `sessions/${sid}` });
    if (r === 'done') await patchDoc(`sessions/${sid}`, 'sessions', { at: now(), upTo: last, fails: 0 });
    return r;
  }

  /** 班主任的对话：有新的一轮、静下来了、没试满的那一段。返回对话的编号数组（早的在前） */
  async function chatsToDo() {
    const chats = rowsOf(await db.collection('chats').get().catch(() => null));
    const t = now();
    const since = sinceOf(getData());
    return chats.filter((c) => {
      const last = Number(c.last) || 0;
      const sum = c.sum || {};
      if (!last || last <= Math.max(Number(sum.upTo) || 0, since) || t - last < QUIET_MS) return false;
      return !((Number(sum.fails) || 0) >= REWRITE_FAILS && last <= (Number(sum.failUpTo) || 0));
    }).sort((a, b) => (a.last || 0) - (b.last || 0)).map((c) => c.id);
  }
  /** 把班主任的一段对话并进共用那一份 */
  function runForChat(cid) {
    const key = `chats/${cid}`;
    if (running.has(key)) return running.get(key);
    const p = runChat(cid).catch((err) => { reportError(err, { what: '记忆摘要', path: key, soft: true }); return 'fail'; }).finally(() => running.delete(key));
    running.set(key, p);
    return p;
  }
  async function runChat(cid) {
    const c = await db.doc(`chats/${cid}`).get().then((r) => (r.exists ? r.data() : null));
    const last = Number(c?.last) || 0;
    if (!c || last <= Math.max(Number(c.sum?.upTo) || 0, sinceOf(getData()))) return 'skip';
    const startedAt = now();
    await patchDoc(`chats/${cid}`, 'chats', { fails: (Number(c.sum?.fails) || 0) + 1, tryAt: startedAt, failUpTo: last });
    const turns = rowsOf(await db.collection(`chats/${cid}/turns`).get().catch(() => null)).filter((t) => !t.void && clean(t.text)).sort((a, b) => (a.at || 0) - (b.at || 0));
    const mine = turns.filter((t) => t.role !== 'head');
    if (!mine.length) return 'skip';
    const shared = await latest('shared');
    const prompt = rewritePrompt({
      shared, said: mine.map((t) => ({ at: t.at, text: t.text })), today: new Date(startedAt).toISOString().slice(0, 10),
      transcript: turns.map((t) => `${t.role === 'head' ? '班主任' : '学生'}：${String(t.shown || t.text).trim()}`).join('\n\n').slice(-60000),
      legacy: clean(shared?.text) ? '' : legacyText(getData(), ''),
    });
    const r = await rewrite({ space: '', prompt, startedAt, src: `chats/${cid}` });
    if (r === 'done') await patchDoc(`chats/${cid}`, 'chats', { at: now(), upTo: last, fails: 0 });
    return r;
  }

  return { on, ready, docs, note, save, back, dropNote, needs, runFor, chatsToDo, runForChat, busy: () => running.size > 0 };
}
