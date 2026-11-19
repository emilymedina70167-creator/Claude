// 复测的课（kind: check，设计 5.6）：检验以后 1 天、7 天，从题库里挑没见过的同类题，整页是检验外壳，没有主讲。
// 题和它的 retry 一起从题库取出来、局部 id 重起（bank.js 的 retestCheck），证据带 bank 和 retest；进掌握的参考，不改吸收。
// 做完在 absorb/{块}.retests 那一次写 done / ok；没过的照样记错题（外部 review 必改 2）
import { parseCheck, baseType } from './spec.js';
import { retestCheck, attachBases } from './bank.js';
import { claudeIds, verdictPrompt, parseVerdict, fallbackPrompt } from './judge.js';
import { absorbOf } from './flow.js';
import { mountCheck } from './shell.js';
import { createCheckDesk } from './checkdesk.js';
import { scopeDb } from '../memory/session.js';
import { createMemOps } from '../memory/memops.js';
import { getAI } from '../ai.js';
import { isDev } from '../live/store.js';
import { createDevTeacher } from '../class/devteacher.js';
import { reportError } from '../errlog.js';
import { callerFor, canJudge, retestResults } from './judgekit.js';
import { assetUrl } from '../live/store.js';

const TEACH = { model: 'claude-opus-5-5', effort: 'high', modelTier: 'complex' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const rows = (snap) => (snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : []);

export async function enterRetest(root, { db, store, sid, doc, readOnly = false, goto }) {
  const leave = () => goto('');
  root.classList.add('is-desk-unit', 'is-check');
  const top = document.createElement('div');
  top.className = 'dk-unit-bar dr-bar';
  top.innerHTML = '<button type="button" class="btn btn-sm dr-home">← 学习台</button><span class="muted">复测</span>';
  root.before(top);
  top.querySelector('.dr-home').addEventListener('click', leave);
  const items = Array.isArray(doc.items) ? doc.items.map(String) : [];
  const bank = (await Promise.all(items.map(async (id) => { const d = await db.doc(`probes/${id}`).get().catch(() => null); return d?.exists ? { id, ...d.data() } : null; }))).filter(Boolean);
  // retry 的题也要读（retryBank）
  for (const b of [...bank]) for (const r of b.retryBank || []) if (!bank.some((x) => x.id === r)) { const d = await db.doc(`probes/${r}`).get().catch(() => null); if (d?.exists) bank.push({ id: r, ...d.data() }); }
  const built = retestCheck({ id: `rt-${sid}`, title: '复测', items, bank, retests: doc.retest || [] });
  const { check: raw, errors } = parseCheck(built.head, built.body);
  // 每道题带着存题库时抄下的课上的量（复测这一页没有那节课的量）
  const check = attachBases(raw, built.bases);
  if (!check || !check.order.length) {
    root.innerHTML = `<p class="dk-status">这次复测没有能出的题${built.dropped.length ? `（${built.dropped.map((x) => x.why).join('；')}）` : ''}。回学习台看「缺新题」。</p>`;
    if (errors.length) reportError(new Error(errors[0]), { what: '拼复测', soft: true });
    return;
  }
  const sc = scopeDb(db, sid);
  // 页面里的 Claude（判要点、写补讲）：只认 Opus 5.5 high；?dev 用模拟老师
  // 只有 ?dev 用模拟老师；claude.ai 里拿不到页面里的 Claude 就不判（待核），不拿模拟的冒充 Opus
  const dev = isDev() || !!store.dev;
  const ai = dev ? null : await getAI();
  const who = callerFor({ dev, ai });
  const mock = who === 'mock' ? createDevTeacher({ pace: 0.2 }) : null;
  const call = async (prompt, opts = {}) => {
    if (!who) return null;
    try { const r = mock ? await mock(prompt, { ...TEACH, ...opts }) : await ai.call(prompt, { ...TEACH, cache: false, ...opts }); return r?.modelApplied === TEACH.model ? r : null; } catch { return null; }
  };
  // 手写的整页图：交的时候手上有；刷新以后从资源取回来（取不到又没打字 → 不判）
  const inkImages = async (answer, given) => {
    if (given?.length || !answer?.ink?.final) return given || [];
    try { const r = await fetch(assetUrl(answer.ink.final)); return r.ok ? [await r.blob()] : []; } catch { return []; }
  };
  const mem = { errors: rows(await db.collection('errors').get().catch(() => null)), curriculum: rows(await db.collection('curriculum').get().catch(() => null)), weaknesses: rows(await db.collection('weaknesses').get().catch(() => null)), evidence: [] };
  const days = Number(doc.retest?.[0]?.days) || 1;
  const cdesk = createCheckDesk(sc, { sid, space: doc.space || 'math', memoOps: readOnly ? null : createMemOps({ db, mem }), bankOf: built.bankOf, retest: days, readOnly, curriculum: () => mem.curriculum });
  const saved = await cdesk.load(check.id);
  root.innerHTML = '';
  const host = document.createElement('div');
  root.appendChild(host);
  let finished = false;
  const finish = async (s) => {
    if (finished || readOnly) return;
    finished = true;
    await cdesk.finish(s);
    // 每块这一次复测过没过：必做都一次过（蒙的不算）→ ok；待核 null；没出题的块（缺新题、题被拿掉）不记
    const absorbs = Object.fromEntries(check.blocks.map((b) => [b.block, absorbOf(s, b.block)]));
    for (const r of retestResults(absorbs, doc.retest || [])) {
      const path = `absorb/${String(r.block).replace(/#/g, '~')}`;
      const cur = await db.doc(path).get().then((d) => (d.exists ? d.data() : null), () => null);
      if (!cur) continue;
      const retests = (cur.retests || []).map((x) => (x.days === r.days && !x.done ? { ...x, done: today(), ok: r.ok, session: sid } : x));
      await db.doc(path).update({ retests }).catch((e) => reportError(e, { what: '写复测结果', path, soft: true }));
    }
    await db.doc(`sessions/${sid}`).update({ status: 'closed', endedAt: Date.now() }).catch(() => {});
  };
  mountCheck(host, {
    check, saved,
    judge: async (probe, answer, given = []) => {
      const ids = claudeIds(probe);
      const images = await inkImages(answer, given);
      if (!canJudge(answer, images)) return null;
      const res = await call(verdictPrompt({ probe, answer, ids, images: images.length }), images.length ? { images } : {});
      if (!res) return null;
      const r = parseVerdict(res.text, ids, { steps: baseType(probe) === 'solve' });
      return { items: r.items, lines: r.lines, judgedBy: 'claude', text: res.text };
    },
    fallback: async (probe, answer, items) => String((await call(fallbackPrompt({ probe, answer, items })))?.text || '').trim(),
    save: (s) => { cdesk.save(check.id, s); if (s.phase === 'done') finish(s); },
    record: (ids, s, o) => cdesk.record(ids, s, o),
    lockKey: `la-ck-lock-${sid}-${check.id}`,
    upload: (blob) => (store.assets ? store.assets.upload(blob, { type: blob.type || 'image/png' }).then((r) => r.id).catch(() => null) : Promise.resolve(null)),
    inkKey: (pid) => `la-ck-${sid}-${check.id}-${pid}`,
    onEnd: ({ state }) => { finish(state).finally(leave); },
  });
}
