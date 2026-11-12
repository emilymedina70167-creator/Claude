// 练习（sessions 的 kind: drill）：页面自己挑的几道题一道一道做，页面判分，不调用 Claude（docs/learning-plan.md 第 3 节）。
// 挑题、结果、复现组的提议、开课的资料包都在 drills.js（纯函数）；这里是画面：一次一道，做完看小结。
// 作答照常进证据（组件 id 就是题库编号，按它对回块和知识点），掌握由首页照常算（mastery.js）。
// 题目上不写是哪一块（混练要自己认出该用什么方法），判出对错以后才告诉你。
import { renderLesson, escapeHtml, mdToHtml } from '../render.js';
import { session } from '../session.js';
import { toast } from '../record.js';
import { createSink } from '../live/sync.js';
import { assertWrite, toDate } from './schema.js';
import { drillOutcome, reviewPendings, drillPack } from './drills.js';
import { OUTCOME_TEXT } from './report.js';
import { createMemOps } from './memops.js';

const TEXT = { ...OUTCOME_TEXT, skip: '没做', giveup: '没做出来', wrong: '错', ok: '改对了', first: '一次对' };

/**
 * 一节练习做完（或者在首页点了「直接下课」）：按证据算结果，复现组的结果直接写进去（档位跟着变，不等我确认，
 * 不对能在「管理」里撤销），这节记成下课、写课后报告。已经下了课的只算不写。
 * drills / curriculum 不给就自己读。返回 { res, mem, doc }
 */
export async function closeDrill(db, sid, { doc, drills = null, curriculum = null, readOnly = false, writeReport = null }) {
  const rows = (snap) => (snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : []);
  if (!drills) {
    const ids = Array.isArray(doc.items) ? doc.items.map(String) : [];
    const all = rows(await db.collection('drills').get().catch(() => null));
    drills = ids.map((id) => all.find((d) => d.id === id)).filter(Boolean);
  }
  if (!curriculum) curriculum = rows(await db.collection('curriculum').get().catch(() => null));
  const evidence = rows(await db.collection('evidence').where('session', '==', sid).get().catch(() => null));
  const mem = { reviews: rows(await db.collection('reviews').get().catch(() => null)), errors: rows(await db.collection('errors').get().catch(() => null)), curriculum };
  // 教研室出的新题（src: lab）：以前别的课里没做过，这一次才算新题（复现组能升档）；做过的就是原题了
  const fresh = new Set();
  // 舞台题（src: stage）不算新题：换了数也是「原题换数」（我的规则 rule-rev-2），都做对档位不动，做错照样记没过
  // 真题做的题（src: exam，考情第 4 批）也一样：第一次做的是没见过的新题
  for (const d of drills.filter((x) => x.src === 'lab' || x.src === 'exam')) {
    const before = rows(await db.collection('evidence').where('comp', '==', d.id).get().catch(() => null));
    if (!before.some((e) => e.session && e.session !== sid)) fresh.add(d.id);
  }
  const res = drillOutcome({ drills, evidence, mem, reviews: Array.isArray(doc.reviews) ? doc.reviews : [], fresh });
  const today = toDate(Date.now());
  if (!readOnly && doc.status !== 'closed') {
    const ops = createMemOps({ db, mem: () => mem });
    for (const p of reviewPendings(res.reviewResults, { session: sid, date: today, mem })) await ops.applyNow({ id: p.id, ...p.doc }).catch(() => {});
    assertWrite('page', 'sessions');
    const summary = { n: res.rows.length, clean: res.rows.filter((x) => x.clean).length, wrong: res.wrong.length };
    doc = { ...doc, status: 'closed', endedAt: Date.now(), drill: summary };
    await db.doc(`sessions/${sid}`).set(doc).catch(() => {});
    await writeReport?.(doc).catch(() => {});
  }
  return { res, mem, doc };
}

/**
 * root：页面；ctx：{ db（学习台的数据库，没 scopeDb 过）, store, sid, doc（sessions 文档）, readOnly, goto, openClass(block, pack), writeReport() }
 */
export async function enterDrill(root, meta, { db, store, sid, doc, readOnly = false, goto, openClass, writeReport }) {
  const rows = (snap) => (snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : []);
  const ids = Array.isArray(doc.items) ? doc.items.map(String) : [];
  const all = rows(await db.collection('drills').get().catch(() => null));
  const drills = ids.map((id) => all.find((d) => d.id === id)).filter(Boolean);
  const byId = new Map(drills.map((d) => [d.id, d]));
  const curriculum = rows(await db.collection('curriculum').get().catch(() => null));
  const titleOf = (b) => curriculum.find((c) => String(c.id) === String(b))?.title || '';

  root.classList.add('is-desk-unit', 'is-drill');
  const top = document.createElement('div');
  top.className = 'dk-unit-bar dr-bar';
  top.innerHTML = `<button type="button" class="btn btn-sm dr-home">← 学习台</button><span class="muted dr-count"></span>`;
  root.before(top);
  top.querySelector('.dr-home').addEventListener('click', () => leave());
  if (!drills.length) {
    root.innerHTML = '<p class="dk-status">这次练习没有题（题库里的题被删了？）。回学习台再点一次「练一练」。</p>';
    return;
  }

  session.reset(`练习 ${sid}`);
  session.mode = 'desk';
  session.live = true;
  if (!readOnly) session.sink = createSink({ ...store, db }, { evidence: (rec) => { const d = byId.get(String(rec.block || '')); return { session: sid, block: d?.block || null, point: d?.point || '' }; } });

  // 第几道、每道判出来了没有（作答记录挂在 session.hooks 上，组件不用改）
  let at = 0;
  const judged = new Set();
  const answers = {};
  session.hooks.push((e) => {
    const id = String(e.block || '');
    if (!byId.has(id)) return;
    if (e.value !== undefined && e.value !== null) answers[id] = String(e.value);
    if (typeof e.ok === 'boolean' || e.final || e.revealed || e.giveup) {
      if (!judged.has(id)) { judged.add(id); paintNav(); }
    }
  });

  root.innerHTML = `
    <div class="dr-stage">
      <p class="dr-lead muted">页面挑的 ${drills.length} 道，不同块的混在一起（题目上不写是哪一章：先认出该用什么方法）。做完一道点「下一题」，页面判分，不调用 Claude。</p>
      <div class="dr-item"></div>
      <p class="dr-where muted" hidden></p>
      <div class="dr-nav"><button type="button" class="btn dr-next">下一题 →</button></div>
    </div>
    <div class="dr-done" hidden></div>`;
  const $ = (s) => root.querySelector(s);
  const box = $('.dr-item');

  function show(i) {
    at = i;
    const d = drills[i];
    top.querySelector('.dr-count').textContent = `练习 · 第 ${i + 1} / ${drills.length} 题`;
    box.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'dr-host';
    box.appendChild(host);
    const before = session.problems.length;
    try {
      renderLesson(String(d.md), host);
    } catch (err) {
      host.innerHTML = `<div class="block-error">这道题抄过来坏了：${escapeHtml(err?.message || String(err))}</div>`;
    }
    // 抄过来的组件在这里出错（课上靠前面的段才成立）：记下来以后不再挑
    const bad = session.problems.slice(before).filter((p) => !p.soft);
    if (bad.length && !readOnly) {
      assertWrite('page', 'drills');
      db.doc(`drills/${d.id}`).set({ ...stripId(d), broken: true, brokenWhy: bad.map((p) => p.msg).join('；').slice(0, 300) }).catch(() => {});
      host.insertAdjacentHTML('beforeend', '<p class="muted">这道题抄过来不完整，以后不再挑它。点「下一题」跳过。</p>');
    }
    paintNav();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function paintNav() {
    const d = drills[at];
    const done = judged.has(d.id);
    const next = $('.dr-next');
    next.textContent = at === drills.length - 1 ? (done ? '做完了，看结果' : '跳过，看结果') : done ? '下一题 →' : '跳过这题';
    next.classList.toggle('btn-primary', done);
    const w = $('.dr-where');
    w.hidden = !done;
    // 给我看的不写编号：有标题写标题
    if (done) w.innerHTML = titleOf(d.block) ? `这题是「${mdToHtml(titleOf(d.block), { inline: true })}」的` : `这题是 ${escapeHtml(d.block || '')} 的`;
  }

  // 做错了还没做完就走（下一题、跳过、回学习台、关页面）：选择题只在答对 / 揭开时才记一条，错的那几下没进证据，
  // 这道题会被算成「没做」，复现组的结果也跟着丢。走的时候补一条「没做出来」（giveup），和课上点「想不出来」一样算
  function leaveItem() {
    const d = drills[at];
    if (!d || readOnly || judged.has(d.id)) return;
    const host = box.querySelector('.dr-host');
    // 舞台题（blocks/stagedrill.js）：没走完（还挂着 data-sd-open）、动过手才算；没动过就是跳过
    const sd = host?.querySelector('[data-sd-open]');
    if (sd && !sd.dataset.sdTouched) return;
    if (!sd && !host?.querySelector('.is-wrong, .is-bad')) return;
    judged.add(d.id);
    session.event('giveup', host.querySelector('[data-bid]') || host, { why: '做错了没做完就走了' });
  }
  async function leave() {
    leaveItem();
    // 等这一条写进去再离开（整页刷新会把还在写的截断），最多 3 秒
    await Promise.race([session.sink?.settled?.(), new Promise((r) => setTimeout(r, 3000))]);
    goto('');
  }
  addEventListener('pagehide', () => leaveItem());

  $('.dr-next').addEventListener('click', () => {
    leaveItem();
    if (at < drills.length - 1) show(at + 1);
    else finish();
  });

  async function finish() {
    $('.dr-stage').hidden = true;
    const out = $('.dr-done');
    out.hidden = false;
    out.innerHTML = '<p class="muted">正在算结果…</p>';
    // 证据可能还在排队写（网络不好时第一次失败要 1～2 秒后重试）：等它们都落地再读，不然最后几题算成没做。
    // 最多等 10 秒；先让组件把最后一次作答交给 sink
    await new Promise((r) => setTimeout(r, 300));
    const lost = await Promise.race([session.sink?.settled?.() ?? 0, new Promise((r) => setTimeout(() => r(-1), 10000))]);
    if (lost) console.warn('练一练：还有作答没存上', lost);
    const { res, mem, doc: after } = await closeDrill(db, sid, { doc, drills, curriculum, readOnly, writeReport });
    doc = after;
    const clean = res.rows.filter((x) => x.clean).length;
    const groupName = (id) => String(mem.reviews.find((r) => String(r.id) === id)?.title || id);
    out.innerHTML = `
      <h2 class="dk-h">做完了：${clean} / ${res.rows.length} 道一次对</h2>
      <div class="dr-rows">${res.rows.map((x, i) => `<div class="dk-row"><b>${i + 1}</b><span>${titleOf(x.block) ? mdToHtml(titleOf(x.block), { inline: true }) : escapeHtml(x.block)}　<span class="muted">${mdToHtml(String(byId.get(x.id)?.title || '').slice(0, 60), { inline: true }) || escapeHtml(String(x.q).replace(/\\[a-zA-Z]+/g, '').slice(0, 60))}</span></span><em class="${x.clean ? 'dr-ok' : 'dr-bad'}">${escapeHtml(TEXT[x.outcome] || x.outcome)}${x.sure === false ? '（没把握）' : ''}</em></div>`).join('')}</div>
      ${res.reviewResults.length ? `<p>复现组：${res.reviewResults.map((r) => `${escapeHtml(groupName(r.id))} 没过（下次 ${r.tier} 天后）`).join('；')}，已经记下了。</p>` : ''}
      ${res.practiced?.length ? `<p class="muted">${res.practiced.map((r) => escapeHtml(groupName(r.id))).join('、')}：原题都对了。练一练的题是课上的原题，不算复现通过——要在「今天复现」里做新题才算。</p>` : ''}
      <div class="dr-acts">${res.wrong.length && !readOnly ? `<button type="button" class="btn btn-primary dr-class">带着没过的 ${res.wrong.length} 道开课</button>` : ''}<button type="button" class="btn dr-back">回学习台</button></div>`;
    out.querySelector('.dr-back').addEventListener('click', () => goto(''));
    out.querySelector('.dr-class')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const use = drillPack(res.rows, drills, { answers, mem });
      try { await openClass(use.main.block, use); } catch (err) { toast(`没开成：${err?.message || err}`); e.currentTarget.disabled = false; }
    });
    top.querySelector('.dr-count').textContent = `练习 · 做完了`;
  }

  if (doc.status === 'closed') finish();
  else show(0);
}

const stripId = (d) => { const { id: _, ...rest } = d || {}; return rest; };
