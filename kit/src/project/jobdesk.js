// 外部交给页面的后台活（需求 R2，jobs.js）的数据库那一层：订阅 ext_jobs（全局的；课堂里再加这节课的），一件一件跑。
// 调用只用 Opus 5.5 high、lane: 'bg'（等讲课的调用跑完再发）；不是 Opus 5.5 就记 failed、不写结果。
import { checkJob, pendingJobs, jobPrompt, jobOutDoc } from './jobs.js';
import { projectTools } from './tools.js';
import { journalId } from './journal.js';
import { reportError } from '../errlog.js';

const MODEL = 'claude-opus-5-5';

/**
 * db：原样的数据库（不换路径）；getAI：() => Promise<ai>；paths：要订阅的集合（'ext_jobs'、'sessions/c-…/ext_jobs'）；
 * getData / getBooks：给只读工具用的手上的数据。返回 { stop, counts() }
 */
export function startJobs({ db, getAI, paths = ['ext_jobs'], getData = () => ({}), getBooks = () => null, onChange = () => {} } = {}) {
  const latest = new Map(); // 集合 → 文档
  const doing = new Set();
  let busy = false;
  const unsubs = [];
  for (const path of paths) {
    try {
      unsubs.push(db.collection(path).onSnapshot((x) => { latest.set(path, x.docs.map((d) => ({ id: d.id, ...d.data() }))); onChange(); next(); }, () => {}));
    } catch { /* 这个集合订阅不了：不跑它 */ }
  }
  async function next() {
    if (busy) return;
    const pick = [...latest.entries()].flatMap(([path, docs]) => pendingJobs(docs).map((d) => ({ path, d }))).find((x) => !doing.has(`${x.path}/${x.d.id}`));
    if (!pick) return;
    busy = true;
    const key = `${pick.path}/${pick.d.id}`;
    doing.add(key);
    try { await run(pick.path, pick.d); } catch (e) { reportError(e, { what: '跑外部交的后台活', path: key, soft: true }); } finally { busy = false; }
    next();
  }
  async function run(path, d) {
    const ref = db.doc(`${path}/${d.id}`);
    const chk = checkJob(d);
    if (chk.error) { await ref.update({ status: 'failed', error: chk.error, at: d.at || Date.now(), endedAt: Date.now() }).catch(() => {}); return; }
    const job = chk.job;
    const t0 = Date.now();
    await ref.update({ status: 'running', startedAt: t0 }).catch(() => {});
    const read = [];
    for (const p of job.see) read.push({ path: p, data: await db.doc(p).get().then((x) => (x.exists ? x.data() : null), () => null) });
    const used = [];
    const tools = projectTools({ db, getData, getBooks, by: 'ext-delegate', write: false, used }).filter((t) => job.tools.includes(t.name));
    const ai = await getAI();
    if (!ai?.call) { await ref.update({ status: 'queued', note: '这个页面现在用不了 Claude，下次打开再跑' }).catch(() => {}); return; }
    let res;
    try {
      res = await ai.call(jobPrompt(job, read), { model: MODEL, effort: 'high', modelTier: 'complex', cache: false, lane: 'bg', ...(tools.length && ai.tools !== false ? { tools } : {}) });
    } catch (e) {
      await ref.update({ status: 'failed', error: String(e?.code || e?.message || e).slice(0, 200), endedAt: Date.now() }).catch(() => {});
      return;
    }
    if (res?.modelApplied !== MODEL) {
      await ref.update({ status: 'failed', error: `平台回的模型是 ${res?.modelApplied || '不知道'}，不是 Opus 5.5，没写结果`, endedAt: Date.now() }).catch(() => {});
      return;
    }
    const before = await db.doc(job.out).get().then((x) => (x.exists ? x.data() : null), () => null);
    const after = jobOutDoc({ id: d.id, text: res.text, model: res.modelApplied, from: `${path}/${d.id}` });
    await db.doc(job.out).set(after);
    // 写进学习台的都记一条 journal：「管理 → Claude 改过的」看得到、能撤销
    const at = Date.now();
    db.doc(`journal/${journalId(at)}`).set({ at, by: 'ext-delegate', path: job.out, op: 'set', before, after, job: `${path}/${d.id}` }).catch(() => {});
    await ref.update({ status: 'done', endedAt: at, ms: at - t0, bytes: new TextEncoder().encode(String(res.text || '')).length, tools: used.length }).catch(() => {});
  }
  return {
    stop() { for (const u of unsubs) try { u?.(); } catch { /* */ } },
    docs: () => [...latest.values()].flat(),
  };
}
