// 学习台（mode: desk）：一个长期存在的 artifact，它的数据库就是记忆库（docs/learner-memory-spec.md）。
// 第 1 批：记忆库本身。对话里的 Claude 用 ArtifactData 读写这些集合；页面打开时：
// - 按 last + tier 算复现组的到期日（不手填），首页「今天」列出过期和今天到期的
// - 自检（check.js）：编号、字段、证据、只增不改、改了记 log；结果写回 meta/memcheck，对话里的 Claude 写完读它
// 第 2 批：在学习台里上课。首页「开新课」开一节（sessions/{编号}，资料包抄一份进去），地址后面带 #编号 就进这节课：
// 课堂照旧是 class/classroom.js，数据放在 sessions/{编号}/ 下面，证据、观察进记忆库，每一轮带着记忆摘要。
// docs/desk-plan.md 第 1 批（记录能力）：下课时页面算课后报告（report.js）写进 sessions/{编号}/report/main；首页「补记」
// 学习台外面做的；「备份和用量」导出整个记忆库（backup.js）、看 assets 用了多少。
// 课程地图、弱点表、以前的课的页面（desk-plan 第 3 批）后面做。
import { sheetMd } from './sheet.js';
import { ask, choose } from '../dialog.js';
import { mdToHtml, escapeHtml } from '../render.js';
import { session } from '../session.js';
import { toast } from '../record.js';
import { getStore, getDownloads } from '../live/store.js';
import { VERSION, KIT_URL } from '../version.js';
import { COLLECTIONS, MEMORY_COLLECTIONS, ROLE_TEXT, UNDO_DAYS, assertWrite, toDate } from './schema.js';
import { sessionId, isSessionId, scopeDb, manualEvidence, SESSION_SCOPED, SESSION_KINDS, kindOf } from './session.js';
import { buildReport, reportLine, REPORT_VERSION, lastActivity, reportText } from './report.js';
import { needsDebrief, transcriptText, debriefPrompt, parseDebrief, debriefText, debriefView, DEBRIEF_VERSION } from './debrief.js';
import { backupFile, backupName, restorePlan, BOARD_COLLECTIONS, SESSION_EXTRA } from './backup.js';
import { createManualForm } from './manual.js';
import { createMemOps } from './memops.js';
import { createMemoView } from './memoview.js';
import { resolvedErrors, voidedIds, activeLessons } from './memo.js';
import { createPages } from './pages.js';
import { reviewPack, deskBrief, briefId, todayReviews, reviewIdsOf, REVIEW_MAX, plainTitle } from './views.js';
import { readOnlyDb } from './session.js';
import { SPACES, SPACE_KEYS, DEFAULT_SPACE, filterSpace, spaceOfDoc, spaceOfId, subjectOf, positionId, packIds, prefixOf } from './space.js';
import { dueList } from './schema.js';
import { masteryProposals, masteryPendingWrites } from './mastery.js';
import { pickDrills, harvestDrills, drillLine, DRILL_N } from './drills.js';
import { enterDrill } from './drillrun.js';
import { recallToday, spaceCounts } from './recall.js';
import { PICKS, MORE, applyTheme, isAuto, dayNight, setDayNight } from '../theme.js';
import { runRecall } from './recallrun.js';
import { purgePlan, purgeText } from './purge.js';
import { vocabRecalls } from './vocab.js';
import { countdownText, weekLines, progress, warmupDrills, backlogDays } from './journey.js';
import { needsSkills, skillsPrompt, parseSkills, skillSummary, pointCatalog, lessonLines, SKILLS_VERSION } from './skills.js';

// 正在看哪一科（这台设备记着；分科见 space.js）
const SPACE_KEY = 'la-desk-space';
const loadSpace = () => { try { const v = localStorage.getItem(SPACE_KEY); return SPACES[v] ? v : DEFAULT_SPACE; } catch { return DEFAULT_SPACE; } };
import { renderClass, MODEL } from '../class/classroom.js';
import { getAI } from '../ai.js';
import { createBooksView } from '../books/bookview.js';
import { createPlanner } from '../books/planview.js';
import { createDevAI } from '../books/devmock.js';
import { loadBooks } from '../books/importer.js';
import { readHistory } from '../books/textbook.js';
import { suggestBlock } from '../books/plan.js';
import { renderLive } from '../live/live.js';
import { renderGuided } from '../guided.js';
import { createSink } from '../live/sync.js';
import { checkMemory, memcheckRecord, fingerprint } from './check.js';
import { sampleMemory, sampleSpaces } from './sample.js';

const CHECK_DELAY = 800;
// 挂着没下课的课，停了这么久没动静，就先按证据算一份暂时的课后报告（fixReports）
const STALE_MS = 3 * 3600 * 1000; // 一次 batch 写进来好几类：停一下再查，不要每到一类查一遍
// 课堂每一轮要带的记忆（证据条数多、按需查，不订阅）。sessions 要带：记忆摘要里有「以前学这一块的课」、目录里有以前的课
// 题库（drills）课堂里用不上，不订阅
const MEMORY_FOR_CLASS = MEMORY_COLLECTIONS.filter((c) => c !== 'evidence' && c !== 'drills');

/** 地址后面的 #c-20261027-1：进这节课（刷新也还在这节课里） */
export const classHash = () => { const h = decodeURIComponent(String(location.hash || '').slice(1)); return isSessionId(h) ? h : ''; };
// 学习台自己的地址（启动语里用）：artifact 嵌在 claude.ai 的页面里，从 referrer 看得到时才有
const deskUrl = () => { const r = String(document.referrer || ''); return /^https:\/\/claude\.ai\/(?:code\/)?artifact\//.test(r) ? r.split('#')[0] : ''; };
/** #view/c-20261027-1：只读翻看以前那节课的黑板 */
export const viewHash = () => { const h = decodeURIComponent(String(location.hash || '').slice(1)); return h.startsWith('view/') && isSessionId(h.slice(5)) ? h.slice(5) : ''; };
// 给我看的改动单：编号换成名字（弱点、复现组、守则、偏好、课程地图的标题）
const nameIn = (get) => (coll, id) => { const d = (get()?.[coll] || []).find((x) => String(x.id) === String(id)); return d ? String(d.title || d.text || d.q || '') : ''; };

// 顶上那行日期：11月3日 · 周二
const todayLabel = (d = new Date()) => `${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]}`;

// 首页以外的页面（pages.js），换页不刷新
const PAGES = { map: '课程地图', books: '教材', weak: '弱点表', errors: '错题本', classes: '以前的课', stats: '统计' };
const goto = (hash) => { location.hash = hash; location.reload(); };

export async function renderDesk(root, meta) {
  session.mode = 'desk';
  session.live = true;
  const inClass = classHash();
  if (inClass) return enterClass(root, meta, inClass);
  const viewing = viewHash();
  if (viewing) return enterClass(root, meta, viewing, { readOnly: true });
  root.classList.add('is-desk');
  const unit = meta.unit || session.title || '学习台';
  root.innerHTML = `
    <header class="dk-head">
      <div class="dk-brand" title="${escapeHtml(String(unit))}"><span class="dk-date">${escapeHtml(todayLabel())}${countdownText(toDate(Date.now())) ? `<span class="dk-countdown"> · ${escapeHtml(countdownText(toDate(Date.now())))}</span>` : ''}</span><h1 class="dk-title">学习台</h1></div>
      <div class="dk-spaces" role="tablist" aria-label="科目">${SPACE_KEYS.map((k) => `<button type="button" role="tab" class="dk-space" data-space="${k}">${SPACES[k].label}</button>`).join('')}</div>
    </header>
    <nav class="dk-nav" aria-label="学习台的页面"><a href="#">首页</a>${Object.entries(PAGES).map(([k, v]) => `<a href="#${k}">${v}</a>`).join('')}<a href="#manage">管理</a></nav>
    <p class="dk-status muted">正在连接记忆库…</p>
    <div class="dk-pages" hidden></div>
    <div class="dk-bookpage" hidden></div>
    <div class="dk-home">
    <div class="dk-col">
    <section class="dk-card dk-class" hidden aria-label="上课"><div class="dk-body"></div></section>
    <section class="dk-card dk-group" aria-label="今天">
    <div class="dk-part dk-today" hidden><h2 class="dk-h">复现</h2><div class="dk-body"></div></div>
    <div class="dk-part dk-recall" hidden><h2 class="dk-h">要记的</h2><p class="dk-sub muted">先写出来，再看答案。隔 1、3、7、14、30 天各想一遍。</p><div class="dk-body"></div><details class="dk-fold dk-radd"><summary><span class="muted">自己加一条</span></summary><div class="dk-radd-f"></div></details></div>
    <div class="dk-part dk-drill" hidden><h2 class="dk-h">练一练</h2><p class="dk-sub muted">页面从以前课上的题里挑几道，不同块混着做，页面判分，不调用 Claude。</p><div class="dk-body"></div></div>
    <div class="dk-part dk-manual" hidden><details class="dk-fold"><summary><h2 class="dk-h">补记</h2><span class="muted">在学习台外面做的题，写一句或贴张图</span></summary><div class="dk-body"></div><div class="dk-mlist"></div></details></div>
    </section>
    </div>
    <div class="dk-col dk-col-side">
    <section class="dk-card dk-week" hidden><h2 class="dk-h">这一周</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-pending" hidden><h2 class="dk-h">还没写进去的</h2><p class="dk-sub muted">以前留下的，点「全部确认」写进去，或者「全部不要」。</p><div class="dk-popen"></div></section>
    </div>
    </div>
    <div class="dk-manage" hidden>
    <section class="dk-card dk-look"><h2 class="dk-h">样子</h2><p class="dk-sub muted">学习台和课堂一起换，这台设备记着。</p><div class="dk-body"></div></section>
    <section class="dk-card dk-recent"><h2 class="dk-h">最近记下的</h2><p class="dk-sub muted">课堂里的 Claude 和页面直接写进记忆的，不对就撤销（7 天内）。</p><div class="dk-pdone"></div></section>
    <section class="dk-card dk-mine" hidden><h2 class="dk-h">我改记忆</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-backup" hidden><h2 class="dk-h">备份</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-check" hidden><h2 class="dk-h">自检</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-colls" hidden><details class="dk-fold"><summary><h2 class="dk-h">记忆库</h2><span class="muted">每一类有几条、谁写</span></summary><div class="dk-body"></div></details></section>
    </div>
    <footer class="dk-foot">组件库 ${escapeHtml(VERSION)}</footer>`;
  const $ = (s) => root.querySelector(s);
  const status = $('.dk-status');

  const store = await getStore({ title: session.title });
  if (!store) {
    status.innerHTML = '这个页面没有拿到记忆库的数据库权限。<br>发布时要声明 <code>capabilities: {"sample": {"images": true}, "db": {}, "assets": {}, "downloads": true}</code>；本地试用请在地址后面加 <code>?dev</code>。';
    return;
  }
  const { db } = store;
  // 页面只写自己的 meta（自检结果、指纹）：写之前按记忆库的规矩拦一道
  const put = (coll, id, data) => { assertWrite('page', coll); return db.doc(`${coll}/${id}`).set(data); };

  const data = Object.fromEntries(MEMORY_COLLECTIONS.map((c) => [c, []]));
  // 改记忆（掌握直接写、我改记忆、撤销）：放在订阅前面，第一次自检算出掌握时就用得上
  const ops = createMemOps({ db, mem: () => data });
  const loaded = new Set();
  const failed = new Set();
  let ledger = null;
  let lastCheck = '';
  let lastLedger = '';
  let timer = 0;
  // 对话里的 Claude 备好的下一节课（资料包，每科一份：pack/main、pack/main-cs、pack/main-en）：开新课时抄一份进那节课
  let space = loadSpace();
  // 教材页（data 在下面订阅着；planner 用的时候才取）和自己备课（books/）：转写、挂课程地图、备课都用 Opus 5.5
  // 本地试用（?dev）没有页面里的 Claude：用模拟的把入库、挂地图、备课走通
  const deskAI = store.dev ? async () => (await getAI()) || createDevAI() : getAI;
  const planner = createPlanner({ db, getAI: deskAI, model: MODEL, getData: () => data, space: () => space });
  const booksView = createBooksView($('.dk-bookpage'), { db, assets: store.assets, getAI: deskAI, space: () => space, model: MODEL, plan: { open: (host, id) => planner.openMap(host, id) } });

  const packs = Object.fromEntries(SPACE_KEYS.map((k) => [k, { main: null, problems: null }]));
  for (const k of SPACE_KEYS) {
    const ids = packIds(k);
    db.doc(`pack/${ids.main}`).onSnapshot((s) => { packs[k].main = s.exists ? s.data() : null; if (k === space) paintClass(); }, () => {});
    db.doc(`pack/${ids.problems}`).onSnapshot((s) => { packs[k].problems = s.exists ? s.data() : null; }, () => {});
  }
  // 这一科的记忆（共用的几类全给）；pack 是这一科的资料包
  const sv = () => filterSpace(data, space);
  let pack = packs[space];
  // 还没用过的那份资料包（开过课的算用掉了，见 newClass）
  // 以前（还没有 usedBy 的时候）开过课的教案也算用掉：sessions 里抄着它的 unit、goal、updatedAt，对得上就是同一份
  // （2026-10-28 那份英语教案连着开了 5 节课，后来讲时态了还按第三章、开头 10 分钟复现开）
  const usedBefore = (m) => data.sessions.some((x) => x.pack && x.pack.unit === (m.unit || '') && x.pack.goal === (m.goal || '') && (x.pack.updatedAt ?? null) === (m.updatedAt ?? null));
  const livePack = () => (pack.main && !pack.main.usedBy && !usedBefore(pack.main) ? pack : { main: null, problems: null });
  let lastRes = null;
  function setSpace(k) {
    if (!SPACES[k]) return;
    space = k;
    pack = packs[k];
    try { localStorage.setItem(SPACE_KEY, k); } catch { /* 无痕模式 */ }
    root.querySelectorAll('.dk-space').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.space === k)));
    root.dataset.space = k;
    manualForm?.refreshBlocks();
    if (lastRes) paint(lastRes, toDate(Date.now()));
  }
  root.querySelector('.dk-spaces').addEventListener('click', (e) => { const b = e.target.closest('.dk-space'); if (b) setSpace(b.dataset.space); });
  root.querySelectorAll('.dk-space').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.space === space)));
  root.dataset.space = space; // 这一科的颜色（desk.css 的 --sp-rgb）
  const ledgerReady = db.doc('meta/ledger').get().then((s) => { ledger = s.exists ? s.data() : null; lastLedger = JSON.stringify(ledger); }).catch(() => {});
  for (const c of MEMORY_COLLECTIONS) {
    db.collection(c).onSnapshot((snap) => {
      data[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      loaded.add(c);
      failed.delete(c);
      if (c === 'sessions' || c === 'position') paintClass();
      if (c === 'sessions') { fixReports(); fixSkills(); fixDebriefs(); if (loaded.has('drills') && loaded.has('errors')) fixDrills(); }
      if (c === 'drills' && loaded.has('sessions')) fixDrills();
      if (c === 'evidence') { paintManual(); if (loaded.has('sessions')) fixReports(); if (lastRes) paintWeek(toDate(Date.now())); }
      if (c === 'curriculum') manualForm?.refreshBlocks();
      if (['curriculum', 'weaknesses', 'observations', 'mastery'].includes(c)) { fixSkills(); fixDebriefs(); }
      schedule();
    }, () => { failed.add(c); loaded.add(c); schedule(); });
  }
  // 隔夜再打开（iPad 上页面一直开着）：日期变了，到期要重算
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, CHECK_DELAY);
  }

  async function run() {
    if (loaded.size < MEMORY_COLLECTIONS.length) return;
    await ledgerReady;
    const today = toDate(Date.now());
    const res = checkMemory(data, { today, ledger });
    // 有哪一类没读到：这一次不更新指纹（不然没读到的条目会被当成删掉了）
    for (const c of failed) res.problems.unshift({ coll: c, id: '', msg: `读不到 ${c}（${COLLECTIONS[c].label}），这一次的自检不全` });
    paint(res, today);
    writeBriefs(today);
    if (!failed.size) { flushOpen(); proposeMastery(); }
    const rec = memcheckRecord(res, { kit: VERSION, today });
    const json = JSON.stringify(rec);
    if (json !== lastCheck) {
      lastCheck = json;
      put('meta', 'memcheck', { ...rec, at: Date.now() }).catch(() => {});
    }
    if (!failed.size) {
      const lj = JSON.stringify(res.ledger);
      if (lj !== lastLedger) {
        lastLedger = lj;
        ledger = res.ledger;
        put('meta', 'ledger', { ...res.ledger, at: Date.now() }).catch(() => {});
      }
    }
  }

  // 以前留下、还开着的改动单（以前要我一条条确认的）：打开学习台时直接写进去（2026-11-03：不要我确认，直接改），
  // 和点「确认」走同一条路（自动编号被占了换下一个）；写不进去的留着，在首页「还没写进去的」里能点「不要」
  let flushed = false;
  async function flushOpen() {
    if (flushed) return;
    flushed = true;
    const open = data.pending.filter((p) => p.status === 'open').sort((a, b) => (a.at || 0) - (b.at || 0));
    let n = 0;
    for (const pd of open) { try { await ops.confirm(pd); n++; } catch (err) { console.warn('没写进去', pd.id, err?.message || err); } }
    if (n) toast(`以前留下的 ${n} 条改动写进记忆了（不对能在「管理」里撤销）`);
  }

  // 掌握：页面按证据算（mastery.js），有变化就直接写进去（2026-11-03：不要我一条条确认），改动单记成 done，在「管理」里能撤销。
  // 刚写的订阅还没回来时，下一次算出同样的结论别再写一遍：先记在手上
  const myPd = new Map(); // 改动单 id → 刚写的那份
  let masteryBusy = false;
  async function proposeMastery() {
    if (masteryBusy) return;
    masteryBusy = true;
    try {
      const pend = [...data.pending.filter((p) => !myPd.has(p.id)), ...myPd.values()];
      const mine = { ...data, pending: pend, mastery: [...data.mastery.filter((m) => ![...myPd.values()].some((p) => p.target === m.id)), ...[...myPd.values()].map((p) => ({ id: p.target, ...(p.data || {}), ...(p.patch || {}) }))] };
      for (const w of masteryPendingWrites(masteryProposals(mine), pend)) {
        myPd.set(w.id, { id: w.id, ...w.doc });
        await ops.applyNow({ id: w.id, ...w.doc }).catch(() => myPd.delete(w.id));
      }
      for (const id of [...myPd.keys()]) if (data.pending.some((p) => p.id === id && p.status === 'done')) myPd.delete(id);
    } finally { masteryBusy = false; }
  }

  // 给对话里的 Claude 的开场简报（views.js 的 deskBrief）：每科一份，内容变了才写
  const lastBrief = {};
  function writeBriefs(today) {
    if (failed.size) return;
    for (const k of SPACE_KEYS) {
      const b = deskBrief(data, { space: k, today, kitUrl: KIT_URL, deskUrl: deskUrl(), pack: packs[k].main?.usedBy ? null : packs[k].main, books: booksView.books() });
      if (lastBrief[k] === b.text) continue;
      lastBrief[k] = b.text;
      put('meta', briefId(k), { space: k, text: b.text, kit: VERSION, today, at: Date.now() }).catch(() => {});
    }
  }

  function paint(res, today) {
    lastRes = res;
    status.hidden = true;
    for (const s of ['.dk-today', '.dk-check', '.dk-colls', '.dk-manual', '.dk-backup', '.dk-mine']) $(s).hidden = false;
    pagesView.refresh();
    paintClass();
    paintManual();
    paintBackup();
    paintPending();
    paintMine();
    paintDrill(today);
    paintWeek(today);
    paintRecall(today);
    const total = Object.values(res.counts).reduce((a, b) => a + b, 0);
    // 今天（这一科）：过期、今天到期的复现组，下一节从哪接、欠账；别的科有到期的提一句
    const mine = sv();
    const pos = mine.position.find((d) => d.id === positionId(space));
    const dues = dueList(mine.reviews, today);
    const soon = dues.filter((d) => d.days > 0).slice(0, 3);
    // 今天复现（views.js 的 todayReviews）：不分科，每门课一行——在学英语时也看得到线代积压了几组。
    // 一次只开一门课的（课堂按门课带组件说明和教法），按我的规则（rule-pre-2）先挑最该做的 REVIEW_MAX 组，其余排队不丢
    const groups = todayReviews(data, { today }).sort((a, b) => (b.space === space) - (a.space === space) || b.total - a.total);
    const allDue = groups.reduce((n, g) => n + g.total, 0);
    // 为什么排在这：从没复现过 / 上次没过（过期几天）/ 过期几天、今天到期
    const whyText = (x) => (x.rank === 2 ? (x.days < 0 ? `过期 ${-x.days} 天` : '今天到期') : `${x.why}${x.days < 0 && x.rank === 1 ? `，过期 ${-x.days} 天` : ''}`);
    const pickText = (x) => `${inline(x.title)}<span class="muted">（${escapeHtml(whyText(x))}）</span>`;
    const oneRow = (x) => `<div class="dk-row ${x.days < 0 ? 'is-over' : 'is-today'}"><span>${pickText(x)}</span><button type="button" class="btn btn-sm dk-review" data-rids="${escapeHtml(x.id)}">只复现这一组</button></div>`;
    const groupHtml = (g) => `<div class="dk-rv" data-space="${escapeHtml(g.space)}">
        <div class="dk-rv-head"><b>${escapeHtml(g.subject)}</b><span class="muted"><span class="dk-rv-n">${g.total}</span>组到期</span><button type="button" class="btn btn-sm ${g.space === space ? 'btn-primary' : ''} dk-review" data-rids="${escapeHtml(g.pick.map((x) => x.id).join(','))}">复现这 ${g.pick.length} 组</button></div>
        <ul class="dk-rv-pick">${g.pick.map((x) => `<li>${pickText(x)}</li>`).join('')}</ul>
        ${g.rest.length ? `<details class="dk-soft"><summary>排着的 ${g.rest.length} 组（这几组做完再轮到）</summary>${g.rest.map(oneRow).join('')}</details>` : ''}
      </div>`;
    $('.dk-today .dk-body').innerHTML = !total ? '<p class="muted">记忆库还是空的。</p>' : `
      <div class="dk-due">${backlogDays(allDue) ? `<p class="dk-sub muted">一共 ${allDue} 组到期：一次 3 组，${backlogDays(allDue)} 次清完（排在后面的不会丢）。</p>` : ''}${allDue ? groups.map(groupHtml).join('') : '<p class="dk-empty">今天没有要复现的。</p>'}
        ${soon.length ? `<p class="dk-soon muted">${SPACES[space].label}接下来：${soon.map((d) => `${inline(d.title)}（${escapeHtml(d.due.slice(5).replace('-', '/'))}）`).join('、')}</p>` : ''}</div>`;
    // 自检
    const hard = res.problems.filter((p) => !p.soft);
    const soft = res.problems.filter((p) => p.soft);
    const line = (p) => `${p.coll}${p.id ? `/${p.id}` : ''}：${p.msg}`;
    $('.dk-check .dk-body').innerHTML = !res.problems.length ? `<p class="dk-ok">都守规矩：编号、字段、证据、log 都对得上（${escapeHtml(today)}）。</p>` : `
      ${hard.length ? `<div class="lint"><div class="lint-head"><strong>${hard.length} 处不守规矩</strong><button type="button" class="btn btn-sm lint-copy">复制给 Claude</button></div><ol>${hard.slice(0, 40).map((p) => `<li>${escapeHtml(line(p))}</li>`).join('')}</ol><p class="lint-note">对话里的 Claude 写完会读到这些（meta/memcheck），一般会自己改。</p></div>` : '<p class="dk-ok">没有错。</p>'}
      ${soft.length ? `<details class="dk-soft"><summary>${soft.length} 条提醒</summary><ul>${soft.slice(0, 40).map((p) => `<li>${escapeHtml(line(p))}</li>`).join('')}</ul></details>` : ''}`;
    $('.dk-check .lint-copy')?.addEventListener('click', async () => {
      const text = `学习台的记忆库自检有 ${hard.length} 处不守规矩：\n${hard.map((p, i) => `${i + 1}. ${line(p)}`).join('\n')}`;
      try { await navigator.clipboard.writeText(text); toast('已复制，去对话里粘贴给 Claude'); } catch { toast('没能复制，请手动选中文字'); }
    });
    // 记忆库：每一类有几条、谁写
    $('.dk-colls .dk-body').innerHTML = `<div class="dk-table">${MEMORY_COLLECTIONS.map((c) => {
      const s = COLLECTIONS[c];
      return `<div class="dk-crow" title="${escapeHtml(s.writers.map((r) => ROLE_TEXT[r]).join('、'))}写"><span class="dk-cname">${escapeHtml(s.label)}<code>${c}</code></span><span class="dk-n">${res.counts[c]}</span><span class="dk-who">${s.writers.map((r) => ROLE_TEXT[r]).join('、')}写</span></div>`;
    }).join('')}</div>`;
  }

  // —— 上课：接着上没下课的那节，或者开一节新的；没备课就在这里让 Claude 备（books/planview.js）——
  let prepBusy = false;
  let prepMsg = '';
  function paintClass() {
    if (!loaded.has('sessions')) return;
    const box = $('.dk-class');
    box.hidden = false;
    const mine = sv();
    // 没下课的：课堂、对话里的 Claude 开的实时黑板、自学单元，都列出来（最新的在前）
    const opens = mine.sessions.filter((x) => x.status === 'open').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const open = opens.find((x) => kindOf(x) === 'class');
    // 上一节（这一科下了课的最近一节）：课后报告的要点、花了多少
    // 练一练、课前热身不算一节课：不然做完热身，「上一节」就成了那节练习，「下次先测」也跟着没了
    const last = mine.sessions.filter((x) => x.status === 'closed' && kindOf(x) !== 'drill').sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
    // 上一节：日期 + 报告那一行（做了几题、对了几题）；花了多少额度在「以前的课」里看，首页不放
    const lastLine = last ? String(last.report?.line || '') : '';
    // 上一节没稳的知识点（归过类才有）：这节开头先测
    const lastNext = last?.skills ? lessonLines(last.skills, pointCatalog(data.sessions, data.mastery)).next : [];
    // 上一节下课后的复盘（debrief.js）：只列还没解决的（还在、没真正测过、新冒出的），解决了的在「以前的课」里看
    const lastDebrief = debriefView(last?.debrief).filter((x) => x.kind === 'bad' || x.kind === 'warn');
    // 课前热身（journey.js）：上一节没稳的点在题库里有原题，开一节练习先做几道
    // 上一节以后已经开过热身（做完或还开着）就不再出按钮：还开着的在下面「没下课的」那一行接着做
    const warmed = last && mine.sessions.some((x) => x.warmup && (x.startedAt || 0) > (last.endedAt || 0));
    const warm = warmed ? [] : warmupDrills(data, last, lastNext);
    // 备好的资料包开过一节课就算用掉了（usedBy）：主角卡退回 position 的块和「下一节从哪接」，不再按旧教案重讲一遍
    const main = livePack().main;
    const block = main?.block || mine.position.find((d) => d.id === positionId(space))?.block || '';
    // 等我确认的改动单；上一节还没整理完（它的整理单里还有没点的）
    const openPd = (mine.pending || []).filter((p) => p.status === 'open');
    const blocksHere = mine.curriculum.filter((b) => (b.level || (String(b.id).replace(/^[A-Z]{2}-/, '').split('.').length === 3 ? 'block' : '')) === 'block').sort((a, b) => cmpId(a.id, b.id));
    // 主角（hero）：这一科现在到哪、下一节讲什么，一个大按钮；下面一行三个数（复现、要记的、上一节）。
    // 备课的表单收起来（还没备好的时候展开）：首页一打开不该是一张表单
    const pos = mine.position.find((d) => d.id === positionId(space));
    const today = toDate(Date.now());
    const heroT = main?.unit || (block ? data.curriculum.find((c) => String(c.id) === String(block))?.title || block : '') || '选一块开始';
    const heroS = main?.goal || pos?.next || '';
    const debts = listOf(pos?.debts).slice(0, 3);
    const dueN = todayReviews(data, { today }).reduce((n, g) => n + g.total, 0);
    const rc = recallToday(data.recall, { today });
    const stat = (cls, go, n, unit, k) => `<button type="button" class="dk-stat ${cls}" data-go="${go}"><span class="dk-stat-n">${n}</span><span class="dk-stat-u">${unit}</span><span class="dk-stat-k">${k}</span></button>`;
    const others = opens.filter((x) => x !== open);
    // 后台一写数据（补报告、归类、写掌握）就会重画这一块：正在填的备课表单（选的块、教材页、展开着）留住
    const keep = { open: box.querySelector('.dk-prepfold')?.open, block: box.querySelector('.dk-prep-block')?.value, pages: box.querySelector('.dk-prep-pages')?.value };
    box.querySelector('.dk-body').innerHTML = `
      ${openPd.length ? `<p><a class="dk-link dk-to-pending" href="#">还有 ${openPd.length} 条以前留下的没写进去 ↓</a></p>` : ''}
      <div class="dk-hero">
        <p class="dk-eyebrow">${escapeHtml(SPACES[space].label)} · ${open ? '这节课还没下课' : main ? '备好的下一节' : '下一节'}${main?.by === 'desk' ? '<span class="muted"> · 学习台备的</span>' : ''}</p>
        <h2 class="dk-hero-t">${supRuns(inline(open ? (open.title && open.title !== unit ? open.title : (open.block && data.curriculum.find((c) => String(c.id) === String(open.block))?.title) || heroT) : heroT))}</h2>
        ${heroS ? `<p class="dk-hero-s dk-goal" title="点一下看全文">${inline(heroS)}</p>` : ''}
        ${debts.length ? `<p class="dk-debts"><span class="dk-k">欠账</span>${debts.map((x) => `<span class="dk-chip">${inline(x)}</span>`).join('')}</p>` : ''}
        <div class="dk-hero-acts">
          ${open ? `<button type="button" class="btn btn-primary btn-lg dk-go" data-sid="${escapeHtml(open.id)}">接着上课</button>` : ''}
          <button type="button" class="btn ${open ? '' : 'btn-primary btn-lg'} dk-new"${prepBusy ? ' disabled' : ''}>开新课</button>
          ${open ? `<span class="dk-hero-more"><button type="button" class="link-btn dk-close" data-sid="${escapeHtml(open.id)}" title="不调用 Claude：只结束这节、页面算课后报告">直接下课</button><button type="button" class="link-btn dk-purge" data-sid="${escapeHtml(open.id)}" title="测试开的、不要的课：连黑板和记录一起删掉">删掉</button></span>` : ''}
        </div>
        <div class="dk-stats">
          ${stat('is-review', '.dk-today', dueN, '组', '复现到期')}
          ${stat('is-recall', '.dk-recall', rc.total, '条', '今天要记')}
          ${last ? `<a class="dk-stat is-last" href="#classes/${escapeHtml(last.id)}"><span class="dk-stat-n">${escapeHtml(String(last.date || '').slice(5).replace('-', '/'))}</span><span class="dk-stat-u"></span><span class="dk-stat-k">上一节${lastLine ? ` · ${escapeHtml(lastLine)}` : ''}</span></a>` : stat('is-last', '.dk-class', '—', '', '还没上过课')}
        </div>
        ${lastDebrief.length ? `<p class="dk-last muted"><span class="dk-k">复盘</span>${lastDebrief.map((x) => inline(x.text)).join('；')}</p>` : ''}
        ${lastNext.length ? `<p class="dk-last muted"><span class="dk-k">下次先测</span>${lastNext.map((x) => inline(x.name)).join('；')}${warm.length && !open ? ` <button type="button" class="btn btn-sm dk-warm" title="上一节没稳的那几个点，题库里的原题；页面判分，不调用 Claude">课前热身 ${warm.length} 题</button>` : ''}</p>` : ''}
      </div>
      ${others.map((x) => { const k = kindOf(x); return `<div class="dk-row dk-open is-${k}"><span class="dk-kind">${SESSION_KINDS[k]}</span><span>${inline(x.title || blockTitle(x.block) || x.id)}</span><button type="button" class="btn btn-primary dk-go" data-sid="${escapeHtml(x.id)}">${k === 'class' ? '接着上课' : '进去'}</button><button type="button" class="btn btn-sm dk-close" data-sid="${escapeHtml(x.id)}" title="不调用 Claude：只结束这节、页面算课后报告">直接下课</button><button type="button" class="btn btn-sm btn-danger dk-purge" data-sid="${escapeHtml(x.id)}" title="测试开的、不要的课：连黑板和记录一起删掉">删掉</button></div>`; }).join('')}
      ${blocksHere.length ? `<details class="dk-fold dk-prepfold"${prepBusy || prepMsg ? ' open' : ''}><summary><span class="dk-fold-t">${main ? '换一块 / 重新备课' : '让 Claude 备课'}</span><span class="muted">${main ? '' : '选一块，Claude 先备好教案（也可以直接开课）'}</span></summary>${planner.prepHtml({ suggested: main?.block || suggestBlock(blocksHere, pos), blocks: blocksHere, main, busy: prepBusy, msg: prepMsg })}</details>` : ''}`;
    {
      const fold = box.querySelector('.dk-prepfold');
      if (fold && keep.open) fold.open = true;
      const sel = box.querySelector('.dk-prep-block');
      if (sel && keep.block && [...sel.options].some((o) => o.value === keep.block)) sel.value = keep.block;
      const pg = box.querySelector('.dk-prep-pages');
      if (pg && keep.pages !== undefined && keep.pages !== '') pg.value = keep.pages;
    }
    box.querySelectorAll('.dk-stat[data-go]').forEach((b) => b.addEventListener('click', () => $(b.dataset.go)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
    box.querySelector('.dk-warm')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const sid = sessionId(today, data.sessions.map((x) => x.id));
        assertWrite('page', 'sessions');
        const why = `上一节没稳的：${lastNext.map((x) => x.name).join('、')}`;
        await db.doc(`sessions/${sid}`).set({ kind: 'drill', date: today, block: null, space, title: '课前热身', warmup: true, status: 'open', startedAt: Date.now(), items: warm, reviews: [], why: Object.fromEntries(warm.map((id) => [id, why])) });
        goto(sid);
      } catch (err) { toast(`没开成：${err?.message || err}`); e.currentTarget.disabled = false; }
    });
    // 资料包的目标常常很长：先收成三行，点一下展开
    box.querySelector('.dk-goal')?.addEventListener('click', (e) => e.currentTarget.classList.toggle('is-open'));
    box.querySelector('.dk-to-pending')?.addEventListener('click', (e) => { e.preventDefault(); $('.dk-pending').scrollIntoView({ behavior: 'smooth' }); });
    box.querySelectorAll('.dk-go').forEach((b) => b.addEventListener('click', (e) => goto(e.currentTarget.dataset.sid)));
    // 挂着没下课的旧课：直接结束（不写小结、不调用 Claude），课后报告由 fixReports 用代码补上，证据就有了归处
    box.querySelectorAll('.dk-close').forEach((b) => b.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const sid = btn.dataset.sid;
      if (!await ask(`直接结束这节课？\n不写小结、不调用 Claude，页面按证据算课后报告。`, { ok: '直接下课' })) return;
      btn.disabled = true;
      try {
        assertWrite('page', 'sessions');
        const cur = await db.doc(`sessions/${sid}`).get().then((x) => (x.exists ? x.data() : null));
        if (!cur) throw new Error('找不到这节课');
        await db.doc(`sessions/${sid}`).set({ ...cur, status: 'closed', endedAt: cur.endedAt || Date.now(), closedBy: 'me' });
        toast(`${sid} 下课了，课后报告马上补上`);
      } catch (err) { toast(`没结束成：${err?.message || err}`); btn.disabled = false; }
    }));
    box.querySelectorAll('.dk-purge').forEach((b) => b.addEventListener('click', (e) => purgeClass(e.currentTarget.dataset.sid, e.currentTarget)));
    box.querySelector('.dk-prep-go')?.addEventListener('click', async () => {
      const id = box.querySelector('.dk-prep-block').value;
      const pages = box.querySelector('.dk-prep-pages')?.value || '';
      if (livePack().main && !await ask(`重新备课会换掉现在备好的「${pack.main.unit || ''}」，接着？`, { ok: '重新备课' })) return;
      prepBusy = true;
      prepMsg = '开始备课…';
      paintClass();
      try { await planner.prep(id, { pages, onStep: (m) => { prepMsg = m; paintClass(); } }); prepMsg = '备好了：看一眼教案，没问题就开新课'; }
      catch (err) { prepMsg = `没备成：${err?.message || err?.code || err}`; }
      prepBusy = false;
      paintClass();
    });
    box.querySelector('.dk-new').addEventListener('click', (e) => { e.currentTarget.disabled = true; newClass(block).catch((err) => { toast(`没开成：${err?.message || err}`); e.currentTarget.disabled = false; }); });
  }

  // —— 删掉一节课（purge.js）：测试开的、不要的课，连黑板、对话、证据、这节课记下的笔记一起删 ——
  // 删之前先把自检的指纹里这几条去掉：不然自检会把「历史被删了」当成不守规矩报出来
  async function purgeClass(sid, btn) {
    const x = data.sessions.find((d) => d.id === sid);
    if (!x) { toast('找不到这节课'); return; }
    const plan = purgePlan(data, sid);
    const title = `${String(x.date || '').slice(5).replace('-', '/')} ${x.title || blockTitle(x.block) || sid}`.trim();
    if (!await ask(purgeText(plan, { title }), { ok: '删掉', danger: true })) return;
    if (btn) btn.disabled = true;
    const role = (c) => (COLLECTIONS[c]?.writers.includes('me') ? 'me' : 'page');
    try {
      if (ledger?.hist && (plan.ledger.length || plan.unlink.length)) {
        const hist = { ...ledger.hist };
        for (const k of plan.ledger) delete hist[k];
        // 只改指纹里本来就有的（历史类）：记忆点这类状态类不进 hist，加进去自检会当成「被删掉了」
        for (const u of plan.unlink) if (u.path in hist) hist[u.path] = fingerprint(u.doc);
        ledger = { ...ledger, hist };
        lastLedger = JSON.stringify(ledger);
        await put('meta', 'ledger', { ...ledger, at: Date.now() });
      }
      const rows = (snap) => (snap ? snap.docs.map((d) => d.id) : []);
      for (const c of plan.scoped) {
        const ids = await db.collection(`sessions/${sid}/${c}`).get().then(rows, () => []);
        for (const id of ids) await db.doc(`sessions/${sid}/${c}/${id}`).delete();
      }
      for (const u of plan.unlink) { const c = u.path.split('/')[0]; assertWrite(role(c), c); await db.doc(u.path).set(u.doc); }
      // 课本身最后删：中途断了，课还在列表里，能再点一次删
      for (const path of plan.docs) {
        const c = path.split('/')[0];
        assertWrite(role(c), c);
        await db.doc(path).delete();
      }
      // 删掉的课用过的教案：退回「还没用」，可以再按它开一节
      for (const k of SPACE_KEYS) {
        const m = packs[k].main;
        if (m?.usedBy === sid) { const { usedBy: _u, usedAt: _a, ...rest } = m; await db.doc(`pack/${packIds(k).main}`).set(rest).catch(() => {}); }
      }
      toast(`删掉了：${title}`);
      if (location.hash.slice(1) === `classes/${sid}`) location.hash = 'classes';
    } catch (err) {
      toast(`没删完：${err?.message || err}（再点一次接着删）`);
      if (btn) btn.disabled = false;
    }
  }

  // —— 这一周（journey.js）：连着学了几天、这周学了多久、真实的进步、每科讲到哪。不调用 Claude，只说真发生了的事 ——
  function paintWeek(today) {
    const box = $('.dk-week');
    if (!loaded.has('evidence') || !loaded.has('sessions')) return;
    const dueToday = todayReviews(data, { today }).reduce((n, g) => n + g.total, 0);
    const rc = recallToday(data.recall, { today }).total;
    const lines = weekLines(data, { today, space, dueToday, recallToday: rc });
    const prog = progress(data);
    box.hidden = !lines.length && !prog.length;
    const bar = (x) => `<div class="dk-prog${x.space === space ? ' is-here' : ''}" data-space="${x.space}"><span class="dk-prog-k">${escapeHtml(x.label)}</span><span class="dk-prog-bar" role="img" aria-label="${x.total} 块里讲过 ${x.taught} 块、过了 ${x.passed} 块"><i class="is-taught" style="width:${Math.round((x.taught / x.total) * 100)}%"></i><i class="is-passed" style="width:${Math.round((x.passed / x.total) * 100)}%"></i></span><span class="dk-prog-n muted">${x.taught} / ${x.total} 块</span></div>`;
    box.querySelector('.dk-body').innerHTML = `
      ${lines.length ? `<ul class="dk-week-l">${lines.map((l) => `<li class="is-${l.k}">${inline(l.text)}</li>`).join('')}</ul>` : ''}
      ${prog.length ? `<div class="dk-progs">${prog.map(bar).join('')}</div><p class="dk-sub muted">深色是过了的块（基础题过、复现通过），浅色是讲过的。</p>` : ''}`;
  }

  // —— 练一练（drills.js）：页面挑题、开一节 kind: drill 的练习 ——
  function paintDrill(today) {
    const box = $('.dk-drill');
    const pick = pickDrills(data, { space, today });
    const n = data.drills.filter((d) => d.status !== 'void' && !d.broken && (!d.space || d.space === space)).length;
    // 题库还是空的：整张卡不出现（首页只放现在点得动的东西）
    box.hidden = !n;
    box.querySelector('.dk-body').innerHTML = !pick.items.length
      ? `<p class="muted">${n ? '题库里的题最近都做对过，过一两天再来。' : '题库还是空的：上过的课下课时，页面会把课上判得了分的题抄进来（以前的课也会补抄）。'}</p>`
      : `<p>挑好了 ${pick.items.length} 道（题库里一共 ${n} 道）${pick.reviews.length ? `，顺便复习 ${pick.reviews.length} 组到期的` : ''}：</p>
        <ul class="dk-drill-why">${pick.items.slice(0, 4).map((x) => `<li>${blockTitle(x.block) || escapeHtml(x.block)}<span class="muted">　${escapeHtml(x.why)}</span></li>`).join('')}${pick.items.length > 4 ? '<li class="muted">……</li>' : ''}</ul>
        <button type="button" class="btn btn-primary dk-drill-go">开始（${pick.items.length} 道）</button>`;
    box.querySelector('.dk-drill-go')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const sid = sessionId(today, data.sessions.map((x) => x.id));
        assertWrite('page', 'sessions');
        await db.doc(`sessions/${sid}`).set({ kind: 'drill', date: today, block: null, space, title: '练习', status: 'open', startedAt: Date.now(), items: pick.items.map((x) => x.id), reviews: pick.reviews, why: Object.fromEntries(pick.items.map((x) => [x.id, x.why])) });
        goto(sid);
      } catch (err) { toast(`没开成：${err?.message || err}`); e.currentTarget.disabled = false; }
    });
  }

  // —— 要记的（recall.js / recallrun.js）：各科到期的记忆点混在一起想一遍，页面不调用 Claude ——
  let recalling = false; // 正在想的时候不重画（订阅一更新就会把正在写的冲掉）
  function paintRecall(today) {
    const box = $('.dk-recall');
    box.hidden = false;
    paintRecallAdd();
    box.querySelector('.dk-radd').hidden = recalling;
    if (recalling) return;
    const live = data.recall.filter((d) => (d.status || 'active') === 'active');
    const t = recallToday(data.recall, { today });
    const body = box.querySelector('.dk-body');
    body.innerHTML = t.items.length
      ? `<div class="dk-deckrow"><div class="dk-deck"><span class="dk-deck-n">${t.total}</span><span class="dk-deck-t">条今天要想<small>${escapeHtml(spaceCounts(t.bySpace))}${t.total > t.items.length ? ` · 这次先想 ${t.items.length} 条` : ''}</small></span></div>
        <button type="button" class="btn btn-primary dk-recall-go">开始</button></div>`
      : `<p class="muted">${live.length ? `今天没有要想的${t.next ? `，下一条 ${escapeHtml(t.next.slice(5).replace('-', '/'))} 到期` : ''}（一共在记 ${live.length} 条）。` : '还没有：上课时老师会把要背的（定义、结论、默写没写出的）记进来，也可以自己加一条。'}</p>`;
    body.querySelector('.dk-recall-go')?.addEventListener('click', () => {
      recalling = true;
      box.querySelector('.dk-radd').hidden = true;
      runRecall(body, { items: t.items, db, titleOf: (b) => data.curriculum.find((c) => String(c.id) === String(b))?.title || '', onDone: () => { recalling = false; paintRecall(toDate(Date.now())); } });
    });
  }
  // 自己加一条：挂这一科的哪一块（可以不挂）
  let raddWired = false;
  function paintRecallAdd() {
    const f = $('.dk-radd-f');
    const blocks = sv().curriculum.filter((b) => b.level === 'block' || String(b.id).replace(/^[A-Z]{2}-/, '').split('.').length === 3).sort((a, b) => cmpId(a.id, b.id));
    const opts = `<option value="">不挂块（${escapeHtml(SPACES[space].label)}）</option>${blocks.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(plainTitle(b.title) || b.id)}</option>`).join('')}`;
    if (raddWired) { const sel = f.querySelector('.dk-radd-b'); if (sel && sel.dataset.space !== space) { sel.innerHTML = opts; sel.dataset.space = space; } return; }
    raddWired = true;
    f.innerHTML = `<label class="mm-f"><span>问法（一条只问一件事）</span><textarea class="dk-radd-q" rows="2"></textarea></label>
      <label class="mm-f"><span>答案（写成能对着检查的样子）</span><textarea class="dk-radd-a" rows="2"></textarea></label>
      <label class="mm-f"><span>挂哪一块</span><select class="dk-radd-b" data-space="${space}">${opts}</select></label>
      <div class="dk-mrow"><span class="muted dk-radd-note" role="status">明天开始排。</span><button type="button" class="btn btn-primary dk-radd-go">加上</button></div>`;
    f.querySelector('.dk-radd-go').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const q = f.querySelector('.dk-radd-q').value;
      const a = f.querySelector('.dk-radd-a').value;
      btn.disabled = true;
      try {
        await ops.me('recall-add', { q, a, block: f.querySelector('.dk-radd-b').value, space });
        f.querySelector('.dk-radd-q').value = '';
        f.querySelector('.dk-radd-a').value = '';
        f.querySelector('.dk-radd-note').textContent = '加上了，明天开始排。';
      } catch (err) { f.querySelector('.dk-radd-note').textContent = `没加上：${err?.message || err}`; }
      btn.disabled = false;
    });
  }

  // —— 以前的课还没抄进题库的（这一版之前下的课）：补抄，一次最多 3 节 ——
  const harvesting = new Set();
  function fixDrills() {
    const todo = data.sessions.filter((x) => x.status === 'closed' && x.report && x.drills === undefined && kindOf(x) !== 'drill' && !harvesting.has(x.id)).slice(0, 3);
    for (const x of todo) {
      harvesting.add(x.id);
      const { id, ...doc } = x;
      harvestSession(db, id, { doc, update: (patch) => db.doc(`sessions/${id}`).set({ ...doc, ...patch }) }).catch((e) => console.warn('题没抄进题库', id, e));
    }
  }

  // —— 课后报告补写，一次最多 3 节（都是代码算，不调用 Claude）：
  // - 下了课却没有报告的（下课时没写成、旧版下的课）、报告是旧版算法算的（report.v 比 REPORT_VERSION 小）
  // - 挂着没下课、已经好几个小时没动静的（真课里一大半的课是这样不了了之的）：先按现有的证据算一份「暂时的」报告，
  //   课照旧挂着、能接着上；后来又有了动静、再停下来，再算一遍。不然这些课的作答一直没人整理
  const fixing = new Set();
  function fixReports() {
    const now = Date.now();
    const lastAct = (x) => lastActivity(x, data.evidence);
    const stale = (x) => x.status === 'open' && kindOf(x) !== 'drill' && now - lastAct(x) > STALE_MS && (!x.report || lastAct(x) > (Number(x.report.at) || 0));
    const todo = data.sessions.filter((x) => !fixing.has(x.id) && ((x.status === 'closed' && (!x.report || (Number(x.report.v) || 1) < REPORT_VERSION)) || (loaded.has('evidence') && stale(x)))).slice(0, 3);
    for (const x of todo) {
      fixing.add(x.id);
      const { id, ...doc } = x;
      writeReport(db, id, { doc, update: (patch) => db.doc(`sessions/${id}`).set({ ...doc, ...patch }) }).catch((e) => console.warn('课后报告没补写成', id, e));
    }
  }

  // —— 知识点归类（skills.js）：有了课后报告的课，页面调用一次 Claude，把每道题归到具体的知识点、挂上对得上的弱点。
  // 一节一节来（一次只跑一节，这次打开学习台最多 4 节）；调用不了 Claude（没权限）就不归，掌握照旧按整块算。
  // 花费：发出去的只有报告的每道题一行、这一科的课程地图和弱点、小结开头（十几 KB），比上课的一轮小得多
  const skilled = new Set();
  let skillBusy = false;
  async function fixSkills() {
    if (skillBusy || skilled.size >= 4 || !['sessions', 'curriculum', 'weaknesses', 'observations', 'mastery'].every((c) => loaded.has(c))) return;
    const x = data.sessions.filter((d) => !skilled.has(d.id) && needsSkills(d)).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))[0];
    if (!x) return;
    skillBusy = true;
    skilled.add(x.id);
    try {
      const ai = await deskAI();
      if (!ai) return;
      const report = await scopeDb(db, x.id).doc('report/main').get().then((r) => (r.exists ? r.data() : null));
      if (!report?.items?.length) return;
      const sp = spaceOfDoc('sessions', x, data) || space;
      const mine = filterSpace(data, sp);
      const gone = voidedIds(data);
      const blocks = mine.curriculum.filter((b) => /\.\d+\.\d+$/.test(String(b.id))).sort((a, b) => cmpId(a.id, b.id));
      const catalog = Object.fromEntries(Object.entries(pointCatalog(data.sessions.filter((d) => d.id !== x.id), data.mastery)).filter(([id]) => spaceOfId(id) === sp));
      const weak = mine.weaknesses.filter((w) => !['closed', 'merged', 'void'].includes(w.status) && !gone.has(`weaknesses/${w.id}`));
      const obs = data.observations.filter((o) => o.session === x.id);
      const summary = obs.find((o) => o.id === x.summary || o.kind === 'summary')?.text || '';
      const prompt = skillsPrompt({ report, session: x, curriculum: blocks, catalog, weaknesses: weak, summary, notes: obs.filter((o) => o.kind === 'note') });
      const res = await ai.call(prompt, { model: MODEL, effort: 'medium', modelTier: 'complex', cache: false });
      const got = parseSkills(res.text, { items: report.items, blocks: blocks.map((b) => b.id), catalog, weaknesses: weak });
      const skills = {
        v: SKILLS_VERSION, reportAt: Number(x.report?.at) || report.at || null, at: Date.now(), model: res.modelApplied || '', bytes: new TextEncoder().encode(prompt).length,
        items: got.items, points: got.points, sum: skillSummary(report, got.items), problems: got.problems.slice(0, 10),
      };
      // 读最新的再写（课堂、对话里的 Claude 可能刚改过这一条）
      const cur = await db.doc(`sessions/${x.id}`).get().then((r) => (r.exists ? r.data() : null));
      if (!cur) return;
      assertWrite('page', 'sessions');
      await db.doc(`sessions/${x.id}`).set({ ...cur, skills });
    } catch (err) {
      // 没权限、没网：这次不归了，下次打开学习台再试
      console.warn('知识点没归成', x.id, err?.message || err?.code || err);
    } finally {
      skillBusy = false;
      setTimeout(fixSkills, 500);
    }
  }

  // —— 下课后的复盘（debrief.js，docs/smart-plan.md 第 2 批）：下了课、报告写好的课，后台调用一次 Opus 通读整节课，
  // 判断误解消了没有、写好下一节开头先测什么，存在 sessions/{编号}.debrief，下一节的课堂和备课带着。
  // 新的课先复盘（下一节最要用的就是上一节的）；一次打开学习台最多 3 节；走后台（lane: 'bg'），不和别的调用抢。
  // 讲课只用 Opus 5.5 high，复盘决定下一节怎么开场，也用它；回的不是 Opus 5.5 就不存，下次再试
  const debriefed = new Set();
  let debriefBusy = false;
  async function fixDebriefs() {
    if (debriefBusy || debriefed.size >= 3 || !['sessions', 'weaknesses', 'observations'].every((c) => loaded.has(c))) return;
    const x = data.sessions.filter((d) => !debriefed.has(d.id) && needsDebrief(d)).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
    if (!x) return;
    debriefBusy = true;
    debriefed.add(x.id);
    try {
      const ai = await deskAI();
      if (!ai) return;
      const scoped = scopeDb(db, x.id);
      const [turns, rep] = await Promise.all([
        scoped.collection('class_turns').get().then((s) => s.docs.map((d) => d.data()), () => []),
        scoped.doc('report/main').get().then((r) => (r.exists ? r.data() : null), () => null),
      ]);
      if (!turns.length) return;
      const sp = spaceOfDoc('sessions', x, data) || space;
      const gone = voidedIds(data);
      const weak = filterSpace(data, sp).weaknesses.filter((w) => !['closed', 'merged', 'void'].includes(w.status) && !gone.has(`weaknesses/${w.id}`));
      // 上一节（同一科、比这节早）的复盘：对照误解有没有又出现
      const prevS = data.sessions.filter((d) => d.id !== x.id && d.debrief && (spaceOfDoc('sessions', d, data) || space) === sp && (d.startedAt || 0) < (x.startedAt || 0))
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
      const prompt = debriefPrompt({ session: x, transcript: transcriptText(turns), report: rep ? reportText(rep) : '', weaknesses: weak, prev: prevS ? debriefText(prevS.debrief) : '', subject: subjectOf(x.block || '') });
      const res = await ai.call(prompt, { model: MODEL, effort: 'high', modelTier: 'complex', cache: false, lane: 'bg' });
      if (res?.modelApplied && res.modelApplied !== MODEL) return;
      const got = parseDebrief(res.text);
      if (got.problems.includes('回的不是复盘')) { console.warn('复盘回的不是复盘', x.id, String(res.text).slice(0, 200)); return; }
      const debrief = { v: DEBRIEF_VERSION, at: Date.now(), model: res.modelApplied || '', bytes: new TextEncoder().encode(prompt).length, mis: got.mis, pace: got.pace, habit: got.habit, opening: got.opening, advice: got.advice };
      // 读最新的再写（报告、归类可能刚写过这一条）
      const cur = await db.doc(`sessions/${x.id}`).get().then((r) => (r.exists ? r.data() : null));
      if (!cur) return;
      assertWrite('page', 'sessions');
      await db.doc(`sessions/${x.id}`).set({ ...cur, debrief });
    } catch (err) {
      console.warn('复盘没做成', x.id, err?.message || err?.code || err);
    } finally {
      debriefBusy = false;
      setTimeout(fixDebriefs, 500);
    }
  }

  // —— 待确认：所有课的改动单（memoview.js）；我点了才写 ——
  const memoView = createMemoView({ db, ops, nameOf: nameIn(() => data) });
  let pendingWired = false;
  function paintPending() {
    // 都直接写了：首页只有以前留下、还没写进去的才出这张卡
    $('.dk-pending').hidden = !data.pending.some((p) => p.status === 'open' && (() => { const k = spaceOfDoc('pending', p, data); return !k || k === space; })());
    if (pendingWired) { memoView.refresh(); return; }
    pendingWired = true;
    const byAt = (a, b) => (b.at || 0) - (a.at || 0);
    // 只列这一科的（分不出科的，比如偏好，各科都列）
    const here = (p) => { const k = spaceOfDoc('pending', p, data); return !k || k === space; };
    memoView.attach($('.dk-popen'), () => memoView.all().filter((p) => p.status === 'open' && here(p)).sort(byAt), { mode: 'list', empty: '没有等你确认的。' });
    memoView.attach($('.dk-pdone'), () => memoView.all().filter((p) => p.status === 'done' && here(p) && p.doneAt > Date.now() - UNDO_DAYS * 86400000).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 12), { mode: 'list', empty: '这几天没有写进去的。' });
  }

  // —— 我改记忆：偏好的文字、错题标已解决、复现组暂停（memo.js 的 meChange，一样记改动单、能撤销）——
  const openSecs = new Set(); // 「我改记忆」里点开了的那几类，重画时照旧开着
  function paintMine() {
    const box = $('.dk-mine .dk-body');
    if (box.querySelector('.mm-f')) return; // 正在改的时候不重画
    const gone = voidedIds(data);
    const solved = resolvedErrors(data);
    const prefs = data.profile.filter((p) => !gone.has(`profile/${p.id}`)).sort((a, b) => cmpId(a.id, b.id));
    const mine = sv();
    const errs = mine.errors.filter((e) => !e.corrects && !gone.has(`errors/${e.id}`) && !solved.has(String(e.id))).sort((a, b) => cmpId(a.id, b.id));
    const revs = mine.reviews.filter((r) => !gone.has(`reviews/${r.id}`) && r.status !== 'done').sort((a, b) => cmpId(a.id, b.id));
    const recs = (mine.recall || []).filter((k) => (k.status || 'active') === 'active').sort((a, b) => cmpId(a.id, b.id));
    // 教学守则（这一科和不分科的）：课堂里的 Claude 下课时把失误归纳进来；我能改说法、不要某一条
    const lessons = activeLessons(data.lessons || [], space).sort((a, b) => (Number(b.hits) || 1) - (Number(a.hits) || 1) || cmpId(a.id, b.id));
    // 每一类收成一行，点开再看、再改（一下全摊开有上百行）；编号不显示，错题去「错题本」标已解决
    const fold = (key, title, n, body) => `<details class="dk-soft dk-mine-sec" data-sec="${key}"${openSecs.has(key) ? ' open' : ''}><summary>${title}（${n}）</summary>${body}</details>`;
    box.innerHTML = `
      ${fold('lessons', '教学守则：老师的失误归纳出来的', lessons.length, lessons.map((l) => `<div class="dk-edit-row" data-id="${escapeHtml(l.id)}"><span>${inline(l.text)}${(Number(l.hits) || 1) > 1 ? `<span class="muted">（犯过 ${Number(l.hits)} 次）</span>` : ''}</span><button type="button" class="btn btn-sm dk-lesson">改</button><button type="button" class="btn btn-sm dk-lesson-x">不用了</button></div>`).join('') || '<p class="muted">还没有：下课时课堂里的 Claude 会把这节课的失误归纳成守则。</p>')}
      ${fold('prefs', '关于我：讲法、习惯、目标', prefs.length, prefs.map((p) => `<div class="dk-edit-row" data-id="${escapeHtml(p.id)}"><span><span class="dk-k">${escapeHtml(p.topic || '')}</span>${inline(p.text)}</span><button type="button" class="btn btn-sm dk-pref">改</button></div>`).join('') || '<p class="muted">还没有。</p>')}
      ${fold('recall', '要记的：不用再记的停掉', recs.length, recs.map((k) => `<div class="dk-edit-row" data-id="${escapeHtml(k.id)}"><span>${inline(k.q)}<span class="muted"> → ${inline(k.a)}（${k.last ? `${Number(k.tier) || 1} 天那档` : '还没想过'}${Number(k.lapses) ? `，没想起过 ${Number(k.lapses)} 次` : ''}）</span></span><button type="button" class="btn btn-sm dk-rvoid">不用记了</button></div>`).join('') || '<p class="muted">还没有。</p>')}
      ${fold('revs', '复现组：不想做的可以先暂停', revs.length, revs.map((r) => `<div class="dk-edit-row" data-id="${escapeHtml(r.id)}"><span>${inline(r.title)}${r.status === 'paused' ? '<span class="muted">（暂停了）</span>' : ''}</span><button type="button" class="btn btn-sm dk-pause">${r.status === 'paused' ? '恢复' : '暂停'}</button></div>`).join('') || '<p class="muted">没有。</p>')}
      <p class="muted dk-mine-note">没解决的错题 ${errs.length} 道：在<a class="dk-link" href="#errors">错题本</a>里标已解决。</p>`;
  }
  $('.dk-mine .dk-body').addEventListener('toggle', (e) => { const d = e.target; if (d?.classList?.contains('dk-mine-sec')) { if (d.open) openSecs.add(d.dataset.sec); else openSecs.delete(d.dataset.sec); } }, true);
  $('.dk-mine .dk-body').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    const row = b?.closest('.dk-edit-row');
    if (!row) return;
    const id = row.dataset.id;
    const run = async (what, args, msg) => {
      b.disabled = true;
      try { await ops.me(what, { id, ...args }); toast(msg); } catch (err) { toast(`没成：${err?.message || err}`); b.disabled = false; }
    };
    if (b.classList.contains('dk-pref')) {
      const p = data.profile.find((x) => x.id === id);
      row.innerHTML = `<label class="mm-f" style="flex:1"><span>${escapeHtml(p?.topic || '')}</span><textarea rows="2">${escapeHtml(p?.text || '')}</textarea></label><button type="button" class="btn btn-sm btn-primary dk-pref-save">保存</button><button type="button" class="btn btn-sm dk-pref-x">算了</button>`;
      row.querySelector('textarea').focus();
    } else if (b.classList.contains('dk-pref-save')) await run('pref', { text: row.querySelector('textarea').value }, '改好了（7 天内能撤）').then(() => paintMine());
    else if (b.classList.contains('dk-pref-x') || b.classList.contains('dk-lesson-cancel')) { row.innerHTML = ''; paintMine(); }
    else if (b.classList.contains('dk-lesson')) {
      const l = (data.lessons || []).find((x) => x.id === id);
      row.innerHTML = `<label class="mm-f" style="flex:1"><span>改说法</span><textarea rows="3">${escapeHtml(l?.text || '')}</textarea></label><button type="button" class="btn btn-sm btn-primary dk-lesson-save">保存</button><button type="button" class="btn btn-sm dk-lesson-cancel">算了</button>`;
      row.querySelector('textarea').focus();
    } else if (b.classList.contains('dk-lesson-save')) await run('lesson', { text: row.querySelector('textarea').value }, '改好了（7 天内能撤）').then(() => paintMine());
    else if (b.classList.contains('dk-lesson-x')) { if (await ask('这条守则不用了？（7 天内能撤）', { ok: '不用了' })) await run('lesson-retire', {}, `${id} 不用了`); }
    else if (b.classList.contains('dk-solve')) { if (await ask('把这道错题标成已解决？（原条不动，加一条更正）', { ok: '已解决' })) await run('resolve', {}, `${id} 标了已解决`); }
    else if (b.classList.contains('dk-rvoid')) { if (await ask('这条不用再记了？（7 天内能撤）', { ok: '不用记了' })) await run('recall-void', {}, '这条不再排了'); }
    else if (b.classList.contains('dk-pause')) await run(b.textContent === '暂停' ? 'pause' : 'resume', {}, b.textContent === '暂停' ? `${id} 暂停了，不算到期` : `${id} 恢复了`);
  });

  // —— 补记：学习台外面做的，记成证据（src: manual）——
  let manualForm = null;
  function paintManual() {
    const box = $('.dk-manual');
    if (box.hidden) return;
    if (!manualForm) {
      manualForm = createManualForm(box.querySelector('.dk-body'), {
        images: !!store.assets,
        blocks: () => sv().curriculum.filter((b) => b.level === 'block' || String(b.id).split('.').length === 3).sort((a, b) => cmpId(a.id, b.id)).map((b) => ({ id: String(b.id), title: b.title })),
        onSave: async ({ text, blobs, block, verdict }) => {
          const images = [];
          for (const b of blobs) {
            const r = await store.assets.upload(b, { type: 'image/png' }).catch(() => null);
            if (!r?.id) throw new Error('图没传上去，再试一次');
            images.push(r.id);
          }
          const ev = manualEvidence({ text, images, block, verdict });
          const { id, ...rest } = ev;
          assertWrite('page', 'evidence');
          await db.doc(`evidence/${id}`).set(rest);
        },
      });
    }
    const recent = data.evidence.filter((e) => e.src === 'manual').sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 5);
    box.querySelector('.dk-mlist').innerHTML = recent.length ? `<p class="dk-k">最近补记的</p>${recent.map((e) => `<div class="dk-row"><b>${escapeHtml(toDate(e.at).slice(5))}</b><span>${escapeHtml(String(e.text || '').slice(0, 80)) || '（截图）'}${e.images?.length ? `<span class="muted">（${e.images.length} 张图）</span>` : ''}${e.block ? `<span class="muted"> · ${escapeHtml(e.block)}</span>` : ''}</span>${e.verdict ? `<em>${escapeHtml(e.verdict)}</em>` : ''}</div>`).join('')}` : '';
  }

  // —— 备份和用量：导出整个记忆库（backup.js），看 assets 用了多少 ——
  let assetUsage = null;
  let backupWired = false;
  if (store.assets?.list) store.assets.list().then((r) => { assetUsage = r?.usage || null; paintBackup(); }).catch(() => {});
  function paintBackup() {
    const box = $('.dk-backup');
    if (box.hidden) return;
    const total = MEMORY_COLLECTIONS.reduce((n, c) => n + data[c].length, 0);
    const usage = `<p><span class="dk-k">记忆库</span>${total} 条（证据 ${data.evidence.length} 条，${data.sessions.length} 节课）</p>
      ${assetUsage ? `<p><span class="dk-k">原图</span>${assetUsage.files ?? 0} 个文件，用了 ${mb(assetUsage.bytes)}${assetUsage.maxBytes ? ` / ${mb(assetUsage.maxBytes)}` : ''}</p>` : ''}`;
    if (!backupWired) {
      backupWired = true;
      box.querySelector('.dk-body').innerHTML = `<div class="dk-usage"></div>
        <div class="dk-bopts">
          <label class="dk-check-row"><input type="checkbox" class="dk-bev" checked> 带上证据（每次作答、说的话）</label>
          <label class="dk-check-row"><input type="checkbox" class="dk-bboard"> 带上各节课的黑板和课堂记录（文件会大很多）</label>
        </div>
        <div class="dk-mrow"><span class="dk-bnote muted" role="status">存成一个 JSON 文件。要恢复时点「从备份恢复」选那个文件。</span><button type="button" class="btn dk-bgo">导出备份</button>
          <label class="btn dk-brestore">从备份恢复<input type="file" accept="application/json,.json" hidden></label></div>`;
      box.querySelector('.dk-bgo').addEventListener('click', (e) => exportBackup(e.currentTarget));
      box.querySelector('.dk-brestore input').addEventListener('change', (e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) restoreBackup(f); });
    }
    box.querySelector('.dk-usage').innerHTML = usage;
  }

  async function exportBackup(btn) {
    const box = $('.dk-backup');
    const note = box.querySelector('.dk-bnote');
    const evidence = box.querySelector('.dk-bev').checked;
    const boards = box.querySelector('.dk-bboard').checked;
    btn.disabled = true;
    btn.textContent = '正在整理…';
    try {
      const dl = await getDownloads();
      if (!dl) throw new Error('这个学习台发布时没有声明 downloads，存不了文件：让开发那边重新发布一次');
      // 每节课下面的：pack、课后报告总是带；黑板、课堂记录看勾没勾
      const sessions = {};
      for (const x of data.sessions) {
        const sc = scopeDb(db, x.id);
        sessions[x.id] = {};
        for (const c of [...SESSION_EXTRA, ...(boards ? BOARD_COLLECTIONS : [])].filter((k) => SESSION_SCOPED.includes(k))) {
          const snap = await sc.collection(c).get().catch(() => null);
          sessions[x.id][c] = snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
        }
      }
      const today = toDate(Date.now());
      const books = await loadBooks(db).catch(() => null);
      const file = backupFile({ memory: data, packs, sessions, books, evidence, boards, kit: VERSION, today });
      const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
      await dl.save({ filename: backupName(today), data: blob });
      note.textContent = `导出了 ${file.docs.length} 条（${mb(blob.size)}）。`;
    } catch (err) {
      note.textContent = err?.code === 'declined' ? '没有存（取消了）。' : `没导出：${err?.message || err}`;
    } finally {
      btn.disabled = false;
      btn.textContent = '导出备份';
    }
  }
  const mb = (b) => `${((Number(b) || 0) / 1048576).toFixed(1)} MB`;

  // 从备份恢复（backup.js 的 restorePlan）：页面自己写回，不调用 Claude。默认只补缺的，覆盖要我再点一次
  async function restoreBackup(file) {
    const note = $('.dk-backup .dk-bnote');
    try {
      const b = JSON.parse(await file.text());
      const have = new Set(MEMORY_COLLECTIONS.flatMap((c) => data[c].map((d) => `${c}/${d.id}`)));
      // 资料包、教材、每节课下面的（报告、黑板）页面没订阅着：先看一遍数据库里有没有，
      // 不然「只补缺的」也会拿旧备份冲掉现在备好的教案、教材条目、报告
      const top = new Set(MEMORY_COLLECTIONS);
      const extra = (Array.isArray(b?.docs) ? b.docs : []).filter((d) => d?.collection && !top.has(d.collection)).map((d) => `${d.collection}/${d.doc_id}`);
      for (let i = 0; i < extra.length; i += 20) {
        note.textContent = `正在比对现在的数据（${Math.min(i + 20, extra.length)} / ${extra.length}）…`;
        await Promise.all(extra.slice(i, i + 20).map((path) => db.doc(path).get().then((x) => { if (x.exists) have.add(path); }, () => {})));
      }
      const all = restorePlan(b, { have, overwrite: true });
      const pick = await choose(`备份里有 ${all.total} 条（${b.today || ''}），现在的记忆库里已经有其中 ${all.clash} 条。\n只补缺的不会冲掉这段时间新写的。`, [
        { label: '算了', value: null },
        ...(all.clash ? [{ label: '全部用备份的', value: 'all', danger: true }] : []),
        { label: all.clash ? '只补缺的' : '恢复', value: 'fill', primary: true },
      ]);
      if (!pick) return;
      const overwrite = pick === 'all';
      const { writes } = overwrite ? all : restorePlan(b, { have });
      note.textContent = `正在写回 ${writes.length} 条…`;
      let n = 0;
      for (const w of writes) { await db.doc(w.path).set(w.data); n++; if (n % 50 === 0) note.textContent = `正在写回 ${n} / ${writes.length} 条…`; }
      note.textContent = `恢复好了：写回 ${n} 条${overwrite ? '' : `，已有的 ${all.clash} 条没动`}。`;
    } catch (err) {
      note.textContent = `没恢复：${err?.message || err}`;
    }
  }

  // 开一节新课：sessions/{编号}，资料包抄一份进 sessions/{编号}/pack（以后对话里的 Claude 备下一节、改 pack/main，不影响这一节）
  // use：复现课用页面自己拼的资料包（views.js 的 reviewPack），不用 pack/main
  async function newClass(block, use = null) {
    const fresh = livePack();
    const main = use ? use.main : fresh.main;
    const problems = use ? use.problems : fresh.problems;
    // 没备课时这节课的标题用块的标题（以前是学习台的名字「数学 · 408 · 英语」，以前的课列表里看不出是哪节）
    const blkTitle = block ? data.curriculum.find((d) => d.id === block)?.title || '' : '';
    const sid = await createClass(db, { block, main, problems, space, unit: blkTitle || unit, taken: data.sessions.map((x) => x.id) });
    if (!use && fresh.main) {
      // 记下这份教案用掉了；教案里补上的待办这时才算补了（备了没上、重新备别的块，待办还在）
      await db.doc(`pack/${packIds(space).main}`).set({ ...fresh.main, usedBy: sid, usedAt: Date.now() }).catch(() => {});
      const ids = (fresh.main.todos || []).map((t) => t.id).filter(Boolean);
      if (ids.length) {
        const snap = await db.doc('meta/todos').get().catch(() => null);
        const done = snap?.exists ? snap.data().done || [] : [];
        await db.doc('meta/todos').set({ done: [...new Set([...done, ...ids])].slice(-500), at: Date.now() }).catch(() => {});
      }
    }
    goto(sid);
  }

  // —— 复现课：到期的复现组（一组或同一门课的几组）一键开课，资料包页面自己拼（每组的内容、盯的弱点、错题原文、以前同一块的题）——
  $('.dk-today').addEventListener('click', async (e) => {
    const b = e.target.closest('.dk-review');
    if (!b) return;
    root.querySelectorAll('.dk-review').forEach((x) => { x.disabled = true; });
    try {
      const rids = String(b.dataset.rids || '').split(',').filter(Boolean);
      const blocks = [...new Set(rids.flatMap((rid) => { const r = data.reviews.find((x) => x.id === rid); return Array.isArray(r?.blocks) ? r.blocks.map(String) : []; }))];
      // 以前各节课的题（sessions/{编号}/pack/problems），只要同一块的
      const packs = [];
      const sheets = []; // 那几节课下课时整理的「这节课的一页」（课后报告里），复现课从它开始
      for (const x of data.sessions.filter((y) => blocks.includes(String(y.block || ''))).sort((p, q) => (p.startedAt || 0) - (q.startedAt || 0)).slice(-8)) {
        const [snap, rep] = await Promise.all([scopeDb(db, x.id).doc('pack/problems').get().catch(() => null), scopeDb(db, x.id).doc('report/main').get().catch(() => null)]);
        if (snap?.exists) packs.push({ ...snap.data(), block: x.block, session: x.id });
        const md = rep?.exists ? sheetMd(rep.data().sheet, { max: 3000 }) : '';
        if (md) sheets.push({ date: x.date || '', title: x.title || '', md });
      }
      const use = reviewPack(data, rids, { packs, sheets: sheets.slice(rids.length > 1 ? -3 : -2) });
      await newClass(use.main.block, use);
    } catch (err) {
      toast(`没开成：${err?.message || err}`);
      root.querySelectorAll('.dk-review').forEach((x) => { x.disabled = false; });
    }
  });

  // —— 样子（theme.js）：固定一种，或者跟着 iPad 白天晚上（白天一种浅色、晚上一种深色）；点了马上换，这台设备记着 ——
  function paintLook() {
    const auto = isAuto();
    const cur = document.documentElement.dataset.theme || 'graphite'; // 没有 data-theme 就是石墨（夜读）
    const { day, night } = dayNight();
    // 缩略图是一张迷你的学习台：印、标题、主角卡（两行字、一个主按钮），各种样子自己的小细节（远山、月亮、横线……）在 desk.css 按 data-sw 画
    const sw = (x) => `<span class="dk-sw" data-sw="${escapeHtml(x.id)}" aria-hidden="true" style="--sw-bg:${x.sw[0]};--sw-card:${x.sw[1]};--sw-ink:${x.sw[2]};--sw-acc:${x.sw[3]}"><span class="dk-sw-top"><span class="dk-sw-seal"></span><span class="dk-sw-name"></span></span><i class="dk-sw-card"><b class="dk-sw-l1"></b><b class="dk-sw-l2"></b><b class="dk-sw-btn"></b></i></span>`;
    const card = (x, slot, on) => `<button type="button" class="dk-look-btn" data-slot="${slot}" data-theme-id="${escapeHtml(x.id)}" aria-pressed="${on}">${sw(x)}<span class="dk-look-t"><b>${escapeHtml(x.name)}</b>${x.note ? `<span class="muted">${escapeHtml(x.note)}</span>` : ''}</span></button>`;
    const lights = PICKS.filter((x) => !x.dark), darks = PICKS.filter((x) => x.dark);
    const row = (title, list, slot, pick) => `<p class="dk-look-k">${title}</p><div class="dk-looks">${list.map((x) => card(x, slot, x.id === pick)).join('')}</div>`;
    const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    $('.dk-look .dk-body').innerHTML = `
      <div class="dk-spaces dk-look-mode" role="tablist" aria-label="怎么换"><button type="button" class="dk-space dk-look-m" data-mode="fixed" aria-selected="${!auto}">固定一种</button><button type="button" class="dk-space dk-look-m" data-mode="auto" aria-selected="${auto}">跟着 iPad 白天晚上</button></div>
      ${auto
        ? `<p class="dk-sub">iPad 是浅色时用「白天」那种，切到深色（设置 → 显示与亮度，可以设成日落后自动）就换成「晚上」那种。现在 iPad 是${dark ? '深色' : '浅色'}。</p>
          ${row('白天', lights, 'day', day)}${row('晚上', darks, 'night', night)}
          <details class="dk-soft"${MORE.some((x) => x.id === (x.dark ? night : day)) ? ' open' : ''}><summary>更多</summary><div class="dk-looks is-more">${MORE.map((x) => card(x, x.dark ? 'night' : 'day', x.id === (x.dark ? night : day))).join('')}</div></details>`
        : `${row('浅色', lights, 'fixed', cur)}${row('深色', darks, 'fixed', cur)}
          <details class="dk-soft"${MORE.some((x) => x.id === cur) ? ' open' : ''}><summary>更多</summary><div class="dk-looks is-more">${MORE.map((x) => card(x, 'fixed', x.id === cur)).join('')}</div></details>`}`;
  }
  paintLook();
  // iPad 自己切了深浅色：那一句「现在 iPad 是……」和选中的样子跟着重画（换风格本身 theme.js 管）
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => paintLook());
  $('.dk-look').addEventListener('click', (e) => {
    const m = e.target.closest('.dk-look-m');
    if (m) { applyTheme(m.dataset.mode === 'auto' ? 'auto' : (document.documentElement.dataset.theme || 'graphite'), { save: true }); paintLook(); return; }
    const b = e.target.closest('.dk-look-btn');
    if (!b) return;
    if (b.dataset.slot === 'fixed') applyTheme(b.dataset.themeId, { save: true });
    else { setDayNight(b.dataset.slot, b.dataset.themeId); applyTheme('auto', { save: true }); }
    paintLook();
  });

  // —— 首页以外的页面：课程地图、弱点表、错题本、以前的课、统计（pages.js，换页不刷新）——
  const pagesView = createPages($('.dk-pages'), { getData: sv, db, ops, goto, purge: (sid, btn) => purgeClass(sid, btn) });
  // 首页「别的科也有到期的」：点了切过去
  $('.dk-today').addEventListener('click', (e) => { const b = e.target.closest('.dk-space-go'); if (b) setSpace(b.dataset.space); });
  function route() {
    const h = decodeURIComponent(String(location.hash || '').slice(1));
    if (isSessionId(h) || viewHash()) { location.reload(); return; }
    const page = h.split('/')[0];
    const manage = page === 'manage';
    const home = !PAGES[page] && !manage;
    const books = page === 'books';
    $('.dk-home').hidden = !home;
    $('.dk-manage').hidden = !manage;
    $('.dk-pages').hidden = home || books || manage;
    $('.dk-bookpage').hidden = !books;
    root.querySelectorAll('.dk-nav a').forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${home ? '' : page}`)));
    if (books) booksView.show(h);
    else if (!home) pagesView.show(h);
  }
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
  route();

  const listOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean).map(String);
  // 课程地图的编号按数字排：L2.10 在 L2.9 后面
  const cmpId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const inline = (s) => { try { return mdToHtml(String(s ?? ''), { inline: true }); } catch { return escapeHtml(String(s ?? '')); } };
  function blockTitle(id) {
    const b = data.curriculum.find((d) => d.id === id);
    return b?.title ? ` ${inline(b.title)}` : '';
  }

  // 本地试用：填一份示例记忆看看页面（只在 ?dev 的替身数据库里）
  if (store.dev) {
    const bar = document.createElement('div');
    bar.className = 'dk-dev';
    bar.innerHTML = '<button type="button" class="btn btn-sm dk-seed">填入示例记忆</button><button type="button" class="btn btn-sm dk-clear">清空</button>';
    root.querySelector('.dk-foot').before(bar);
    bar.querySelector('.dk-seed').addEventListener('click', async () => {
      const today = toDate(Date.now());
      for (const src of [sampleMemory(today), sampleSpaces(today)]) for (const [c, docs] of Object.entries(src)) for (const d of docs) { const { id, ...rest } = d; await db.doc(`${c}/${id}`).set(rest); }
    });
    bar.querySelector('.dk-clear').addEventListener('click', async () => { if (await ask('清空本地的示例记忆？', { ok: '清空', danger: true })) { db._clear?.(); location.reload(); } });
  }
}

// 标题里的 Unicode 上标（Aⁿ、tr(A)ⁿ⁻¹、αβᵀ）：宋体大字里这些字落到别的字体，又粗又高、基线不齐；
// 换回普通的字放进 <sup>，跟着标题的字体走
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n', '⁻': '−', '⁺': '+', 'ᵀ': 'T', 'ⁱ': 'i', 'ʲ': 'j', 'ᵏ': 'k' };
export const supRuns = (html) => String(html).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁻⁺ᵀⁱʲᵏ]+/g, (m) => `<sup class="dk-sup">${[...m].map((c) => SUP[c]).join('')}</sup>`);

// —— 在学习台里上一节课 ——
// 课堂的数据放在 sessions/{编号}/ 下面；记忆库一直订阅着（每一轮的记忆摘要用最新的）；sessions/{编号} 由页面改（核验、下课）
// readOnly：「以前的课」翻看黑板（#view/编号）：数据库只读，不调用 Claude，回去是那节课的报告
async function enterClass(root, meta, sid, { readOnly = false } = {}) {
  const store = await getStore({ title: session.title });
  if (!store) {
    root.innerHTML = '<p class="dk-status muted">这个页面没有拿到记忆库的数据库权限。发布时要声明 <code>capabilities: {"sample": {"images": true}, "db": {}, "assets": {}, "downloads": true}</code>。</p>';
    return;
  }
  const { db } = store;
  const snap = await db.doc(`sessions/${sid}`).get().catch(() => null);
  if (!snap?.exists) {
    root.innerHTML = `<p class="dk-status">学习台里没有 ${escapeHtml(sid)} 这节课。</p><button type="button" class="btn">回学习台</button>`;
    root.querySelector('button').addEventListener('click', () => goto(''));
    return;
  }
  let doc = snap.data();
  const mem = Object.fromEntries(MEMORY_FOR_CLASS.map((c) => [c, []]));
  for (const c of MEMORY_FOR_CLASS) db.collection(c).onSnapshot((s) => { mem[c] = s.docs.map((d) => ({ id: d.id, ...d.data() })); }, () => {});
  const updateSession = (patch) => {
    assertWrite('page', 'sessions');
    doc = { ...doc, ...patch };
    return db.doc(`sessions/${sid}`).set(doc).catch(() => {});
  };
  // 这节课记着的块（课上 memo 换过块也记在这里）优先；没记就用资料包写的
  const main = await scopeDb(db, sid).doc('pack/main').get().then((s) => (s.exists ? s.data() : null)).catch(() => null);
  // 改记忆（memo 块、整理单、确认 / 撤销）：用没 scopeDb 过的数据库，记忆库在根上
  const ops = createMemOps({ db, mem: () => mem });
  const block = String(doc.block || main?.block || '');
  // 分科：课堂按这一块的门课带组件说明和教法（学习台页面开头的 subject: 管不了每节课）
  // 块优先（课上换过门课 doc.subject 也跟着改了）；没块按这节课记的科：数学是线代，408、英语给那一科的第一门课
  const space = doc.space || (block ? spaceOfId(block) : 'math');
  session.subject = block ? subjectOf(block) : doc.subject || subjectOf(prefixOf(SPACES[space]?.courses?.[0]));
  const kind = kindOf(doc);
  const title = doc.title || meta.unit;
  // 实时黑板、自学单元是对话里的 Claude 开的：页面不写报告给课堂 Claude，用完了由谁点「用完了」都行，报告由首页补写（fixReports）
  const finish = async () => {
    if (!await ask(`${SESSION_KINDS[kind]}「${title}」用完了？以后在「以前的课」里还能翻看。`, { ok: '用完了' })) return;
    // 对话里的 Claude 也可能改着这条（改标题、块）：读最新的再改，不拿开页面时那份去盖
    const cur = await db.doc(`sessions/${sid}`).get().then((x) => (x.exists ? x.data() : doc)).catch(() => doc);
    assertWrite('page', 'sessions');
    await db.doc(`sessions/${sid}`).set({ ...cur, status: 'closed', endedAt: Date.now() });
    goto('');
  };
  if (kind === 'live') {
    const sc = scopeDb(db, sid);
    return renderLive(root, { ...meta, unit: title }, {
      store: { ...store, db: readOnly ? readOnlyDb(sc) : sc, assets: readOnly ? null : store.assets }, sid, block,
      onHome: () => goto(readOnly ? `classes/${sid}` : ''), onEnd: readOnly || doc.status === 'closed' ? null : finish,
    });
  }
  if (kind === 'drill') {
    return enterDrill(root, meta, {
      db, store, sid, doc, readOnly, goto,
      openClass: async (blk, use) => {
        const taken = (await db.collection('sessions').get().catch(() => null))?.docs.map((d) => d.id) || [];
        goto(await createClass(db, { block: blk, main: use.main, problems: use.problems, space: doc.space || 'math', unit: use.main.unit, taken }));
      },
      writeReport: (d) => writeReport(db, sid, { doc: d, update: (patch) => db.doc(`sessions/${sid}`).set({ ...d, ...patch }) }),
    });
  }
  if (kind === 'unit') return enterUnit(root, meta, { db, store, sid, doc, block, title, readOnly, finish });
  // 教材（books/）：这一科的书和条目，开课时读一次。资料包点名的条目全文放进资料包，别的课堂里按需取
  const books = await loadBooks(db, space).catch(() => ({ books: [], chunks: [] }));
  // 上一节同一块的课用 textbook_read 取过的教材：这节课一开始就放进「教材原文」（接着往下的几条页面也顺带放），
  // 不用开讲先取一轮——课程地图还没挂教材条目时，英语课每节都要先取（2026-11-02 三节课取了 30 次，每次多等一整轮）
  const prevRead = !readOnly && !doc.review && books.chunks.length && !(Array.isArray(main?.chunks) && main.chunks.length) ? await priorReads(db, mem.sessions || [], { sid, block, books }).catch(() => []) : [];
  if (readOnly) {
    return renderClass(root, { ...meta, unit: doc.title || meta.unit }, {
      store: { ...store, db: readOnlyDb(scopeDb(db, sid)), assets: null }, sid, block, space, mem, readOnly: true, books,
      updateSession: () => Promise.resolve(), onHome: () => goto(`classes/${sid}`),
      memo: { ops, view: createMemoView({ db, ops, nameOf: nameIn(() => mem) }) },
    });
  }
  return renderClass(root, { ...meta, unit: doc.title || meta.unit }, {
    store: { ...store, db: scopeDb(db, sid) }, sid, block, space, mem, updateSession, onHome: () => goto(''), books, prevRead,
    writeReport: ({ turns, steps } = {}) => writeReport(db, sid, { doc, turns, steps, update: updateSession }),
    // 下课时先算一份（还没下课：结束时间按现在算）放进给课堂 Claude 的输入
    makeReport: ({ turns, steps } = {}) => makeReport(db, sid, { doc: { ...doc, endedAt: doc.endedAt || Date.now() }, turns, steps }),
    memo: { ops, view: createMemoView({ db, ops, nameOf: nameIn(() => mem) }) },
    review: doc.review || null,
    opening: doc.opening || null,
  });
}

/**
 * 自学单元（kind: unit）：对话里的 Claude 把一次写完的课件（guided）写进 sessions/{编号}/unit/main 的 md，在学习台里打开。
 * 作答进 evidence（和课堂、黑板一样），进度记在这台设备上（guided 照旧）。
 */
async function enterUnit(root, meta, { db, store, sid, doc, block, title, readOnly, finish }) {
  const sc = scopeDb(db, sid);
  const u = await sc.doc('unit/main').get().then((x) => (x.exists ? x.data() : null)).catch(() => null);
  root.classList.add('is-desk-unit');
  const top = document.createElement('div');
  top.className = 'dk-unit-bar';
  top.innerHTML = `<button type="button" class="btn btn-sm dk-u-home">← 学习台</button><span class="muted">${SESSION_KINDS.unit} · ${escapeHtml(sid)}</span>${readOnly || doc.status === 'closed' ? '' : '<button type="button" class="btn btn-sm dk-u-end">学完了</button>'}`;
  root.before(top);
  top.querySelector('.dk-u-home').addEventListener('click', () => goto(readOnly ? `classes/${sid}` : ''));
  top.querySelector('.dk-u-end')?.addEventListener('click', finish);
  if (!u?.md) {
    root.innerHTML = `<p class="dk-status">这个自学单元还没有内容（sessions/${escapeHtml(sid)}/unit/main 是空的）。回对话里让 Claude 写进来。</p>`;
    return;
  }
  session.reset(title);
  session.subject = doc.subject || subjectOf(block);
  if (!readOnly) {
    const sink = createSink({ ...store, db: sc }, { evidence: () => ({ session: sid, block }) });
    session.sink = sink;
  }
  renderGuided(String(u.md), root, { ...meta, unit: u.unit || title });
}

/**
 * 同一块最近一节（不算练习）课堂里 textbook_read 取到过的条目编号（最近取的在后面）。只看最近两节，取不到就是空的
 */
async function priorReads(db, sessions, { sid, block, books }) {
  if (!block) return [];
  const prev = sessions.filter((x) => x && x.id !== sid && x.block === block && kindOf(x) === 'class').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 2);
  for (const x of prev) {
    const snap = await scopeDb(db, x.id).collection('class_turns').get().catch(() => null);
    const calls = (snap ? snap.docs.map((d) => d.data()) : []).filter((t) => t && !t.discarded && t.role === 'claude' && Array.isArray(t.tools)).sort((a, b) => (a.seq || 0) - (b.seq || 0)).flatMap((t) => t.tools);
    const ids = calls.length ? readHistory(calls, books.chunks, books.books) : [];
    if (ids.length) return ids;
  }
  return [];
}

/**
 * 开一节课堂：sessions/{编号}，资料包抄一份进去。首页「开新课」「开复现课」、练习做完「带着没过的开课」共用。
 * main / problems：这节课的资料包；space：没有块时算哪一科；taken：已经有的课的编号（不撞号）。返回新课的编号
 */
export async function createClass(db, { block = null, main = null, problems = null, space = 'math', unit = '学习台', taken = [] } = {}) {
  const today = toDate(Date.now());
  const sid = sessionId(today, taken);
  assertWrite('page', 'sessions');
  // 这节课是哪一科、哪门课：按块看（没有块就是现在看着的这一科），课堂按它带组件说明和教法
  const sp = block ? spaceOfId(block) : space;
  await db.doc(`sessions/${sid}`).set({
    date: today, block: block || null, title: String(main?.unit || unit), status: 'open', startedAt: Date.now(), space: sp, ...(block ? { subject: subjectOf(block) } : {}),
    pack: main ? { unit: main.unit || '', goal: main.goal || '', updatedAt: main.updatedAt || null } : null,
    // 复现课（views.js 的 reviewPack，reviewClass）记 review：这节课就是复现这几组；备课写的开头复现（[{ id, how }]）记 opening
    ...(main?.reviewClass && reviewIdsOf(main.review).length ? { review: reviewIdsOf(main.review) } : {}),
    ...(!main?.reviewClass && reviewIdsOf(main?.review).length ? { opening: reviewIdsOf(main.review) } : {}),
  });
  const scoped = scopeDb(db, sid);
  if (main) await scoped.doc('pack/main').set({ ...main, block: block || main.block || null });
  if (problems) await scoped.doc('pack/problems').set(problems);
  return sid;
}

/**
 * 一节课的题抄进题库（drills.js 的 harvestDrills）：页面判得了分的组件连同 let 块。下课写报告时抄；以前的课首页补抄。
 * sessions/{编号}.drills 记抄了几道（0 也记，免得每次打开都再抄一遍）
 */
export async function harvestSession(db, sid, { doc, report = null, steps = null, update }) {
  const rows = (snap) => (snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : []);
  const scoped = scopeDb(db, sid);
  const [r, st, errors, existing] = await Promise.all([
    report ? report : scoped.doc('report/main').get().then((x) => (x.exists ? x.data() : null), () => null),
    steps ? steps : scoped.collection('steps').get().then(rows, () => []),
    db.collection('errors').get().then(rows, () => []),
    db.collection('drills').where('fromSession', '==', sid).get().then(rows, () => []),
  ]);
  const out = harvestDrills({ session: { ...doc, id: sid }, steps: st, report: r, mem: { errors }, existing });
  assertWrite('page', 'drills');
  for (const d of out) await db.doc(`drills/${d.id}`).set(d.doc);
  await update({ drills: out.length + existing.length });
  return out.length;
}

/**
 * 课后报告（report.js，页面代码算、不调用 Claude）写进 sessions/{编号}/report/main，要点（首页「上一节」那一行）记在 sessions/{编号}.report。
 * 读这节课的证据、观察、失误，上一节课下课以后的补记；turns、steps 下课时课堂直接给（还在排队写进数据库的也算上），补写时从数据库读。
 * update(patch)：改 sessions/{编号}（课堂里用 updateSession，免得和它手上的那份打架）
 */
export async function writeReport(db, sid, { doc, turns = null, steps = null, update }) {
  assertWrite('page', 'sessions');
  const report = await makeReport(db, sid, { doc, turns, steps });
  await scopeDb(db, sid).doc('report/main').set(report);
  const patch = { report: { v: REPORT_VERSION, at: report.at, line: reportLine(report), items: report.totals.items, first: report.totals.first, activeMs: report.time.activeMs, ...(doc.status === 'open' ? { provisional: true } : {}) } };
  await update(patch);
  // 课上点开看过意思的生词收进「要记的」（vocab.js，不调用 Claude）
  await harvestVocab(db, sid, { doc }).catch((e) => console.warn('生词没收进要记的', sid, e));
  // 课上判得了分的题抄进题库（练习用，不调用 Claude）
  if (kindOf(doc) !== 'drill') await harvestSession(db, sid, { doc: { ...doc, ...patch }, report, steps, update: (p) => update({ ...patch, ...p }) }).catch((e) => console.warn('题没抄进题库', sid, e));
  return report;
}

/** 这节课点开过的生词 → 新的记忆点（同一个词已经在记的不加） */
export async function harvestVocab(db, sid, { doc }) {
  const rows = (snap) => (snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : []);
  const evidence = await db.collection('evidence').where('session', '==', sid).get().then(rows, () => []);
  if (!evidence.some((e) => e.kind === 'gloss')) return 0;
  const recall = await db.collection('recall').get().then(rows, () => []);
  const out = vocabRecalls({ evidence, recall, session: { ...doc, id: sid } });
  assertWrite('page', 'recall');
  for (const r of out) await db.doc(`recall/${r.id}`).set(r.doc);
  return out.length;
}

/** 只算不写（下课时放进给课堂 Claude 的输入；writeReport 也用它） */
export async function makeReport(db, sid, { doc, turns = null, steps = null }) {
  const rows = (snap) => (snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : []);
  const mine = (coll) => db.collection(coll).where('session', '==', sid).get().then(rows, () => []);
  const scoped = scopeDb(db, sid);
  const [evidence, observations, slips, sessions, manual, t, st] = await Promise.all([
    mine('evidence'), mine('observations'), mine('slips'),
    db.collection('sessions').get().then(rows, () => []),
    db.collection('evidence').where('src', '==', 'manual').get().then(rows, () => []),
    turns ? turns : scoped.collection('class_turns').get().then((s) => s.docs.map((d) => d.data()), () => []),
    steps ? steps : scoped.collection('steps').get().then(rows, () => []),
  ]);
  // 补记归到下一节课：上一节下课（这节开课前最近的那次下课）之后、这节下课之前记的
  const start = Number(doc.startedAt) || 0;
  const end = Number(doc.endedAt) || Date.now();
  const prevEnd = Math.max(0, ...sessions.filter((x) => x.id !== sid && Number(x.endedAt) && Number(x.endedAt) <= start).map((x) => Number(x.endedAt)));
  return buildReport({
    session: { ...doc, id: sid }, evidence, observations, slips, turns: t, steps: st,
    manual: manual.filter((e) => Number(e.at) > prevEnd && Number(e.at) <= end),
  });
}
