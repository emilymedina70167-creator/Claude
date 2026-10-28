// 学习台（mode: desk）：一个长期存在的 artifact，它的数据库就是记忆库（docs/learner-memory-spec.md）。
// 第 1 批：记忆库本身。对话里的 Claude 用 ArtifactData 读写这些集合；页面打开时：
// - 按 last + tier 算复现组的到期日（不手填），首页「今天」列出过期和今天到期的
// - 自检（check.js）：编号、字段、证据、只增不改、改了记 log；结果写回 meta/memcheck，对话里的 Claude 写完读它
// 第 2 批：在学习台里上课。首页「开新课」开一节（sessions/{编号}，资料包抄一份进去），地址后面带 #编号 就进这节课：
// 课堂照旧是 class/classroom.js，数据放在 sessions/{编号}/ 下面，证据、观察进记忆库，每一轮带着记忆摘要。
// docs/desk-plan.md 第 1 批（记录能力）：下课时页面算课后报告（report.js）写进 sessions/{编号}/report/main；首页「补记」
// 学习台外面做的；「备份和用量」导出整个记忆库（backup.js）、看 assets 用了多少。
// 课程地图、弱点表、以前的课的页面（desk-plan 第 3 批）后面做。
import { mdToHtml, escapeHtml } from '../render.js';
import { session } from '../session.js';
import { toast } from '../record.js';
import { getStore, getDownloads } from '../live/store.js';
import { VERSION, KIT_URL } from '../version.js';
import { COLLECTIONS, MEMORY_COLLECTIONS, ROLE_TEXT, UNDO_DAYS, assertWrite, toDate } from './schema.js';
import { sessionId, isSessionId, scopeDb, manualEvidence, SESSION_SCOPED, SESSION_KINDS, kindOf } from './session.js';
import { buildReport, reportLine } from './report.js';
import { backupFile, backupName, BOARD_COLLECTIONS, SESSION_EXTRA } from './backup.js';
import { createManualForm } from './manual.js';
import { usageText } from '../class/usage.js';
import { createMemOps } from './memops.js';
import { createMemoView } from './memoview.js';
import { resolvedErrors, voidedIds } from './memo.js';
import { createPages } from './pages.js';
import { reviewPack, handoffText } from './views.js';
import { readOnlyDb } from './session.js';
import { SPACES, SPACE_KEYS, DEFAULT_SPACE, filterSpace, spaceOfDoc, spaceOfId, subjectOf, positionId, packIds } from './space.js';
import { dueList } from './schema.js';

// 正在看哪一科（这台设备记着；分科见 space.js）
const SPACE_KEY = 'la-desk-space';
const loadSpace = () => { try { const v = localStorage.getItem(SPACE_KEY); return SPACES[v] ? v : DEFAULT_SPACE; } catch { return DEFAULT_SPACE; } };
import { renderClass } from '../class/classroom.js';
import { renderLive } from '../live/live.js';
import { renderGuided } from '../guided.js';
import { createSink } from '../live/sync.js';
import { checkMemory, memcheckRecord } from './check.js';
import { sampleMemory, sampleSpaces } from './sample.js';

const CHECK_DELAY = 800; // 一次 batch 写进来好几类：停一下再查，不要每到一类查一遍
// 课堂每一轮要带的记忆（证据条数多、按需查，不订阅）
const MEMORY_FOR_CLASS = MEMORY_COLLECTIONS.filter((c) => c !== 'evidence' && c !== 'sessions');

/** 地址后面的 #c-20261027-1：进这节课（刷新也还在这节课里） */
export const classHash = () => { const h = decodeURIComponent(String(location.hash || '').slice(1)); return isSessionId(h) ? h : ''; };
// 学习台自己的地址（启动语里用）：artifact 嵌在 claude.ai 的页面里，从 referrer 看得到时才有
const deskUrl = () => { const r = String(document.referrer || ''); return /^https:\/\/claude\.ai\/(?:code\/)?artifact\//.test(r) ? r.split('#')[0] : ''; };
/** #view/c-20261027-1：只读翻看以前那节课的黑板 */
export const viewHash = () => { const h = decodeURIComponent(String(location.hash || '').slice(1)); return h.startsWith('view/') && isSessionId(h.slice(5)) ? h.slice(5) : ''; };
// 首页以外的页面（pages.js），换页不刷新
const PAGES = { map: '课程地图', weak: '弱点表', errors: '错题本', classes: '以前的课', stats: '统计' };
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
      <div class="dk-brand"><h1 class="dk-title">学习台</h1><span class="dk-unit">${mdToHtml(String(unit), { inline: true })}</span></div>
      <div class="dk-spaces" role="tablist" aria-label="科目">${SPACE_KEYS.map((k) => `<button type="button" role="tab" class="dk-space" data-space="${k}">${SPACES[k].label}</button>`).join('')}</div>
    </header>
    <nav class="dk-nav" aria-label="学习台的页面"><a href="#">首页</a>${Object.entries(PAGES).map(([k, v]) => `<a href="#${k}">${v}</a>`).join('')}</nav>
    <p class="dk-status muted">正在连接记忆库…</p>
    <div class="dk-pages" hidden></div>
    <div class="dk-home">
    <div class="dk-col">
    <section class="dk-card dk-class" hidden><h2 class="dk-h">上课</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-today" hidden><h2 class="dk-h">今天</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-pending" hidden><h2 class="dk-h">待确认</h2><p class="dk-sub muted">课堂里的 Claude 提的错题、弱点、复现组、下一节：点「确认」才写进记忆库。写进去的 7 天内能撤销。</p><div class="dk-popen"></div><div class="dk-memo-sub" role="heading" aria-level="3">最近写进去的</div><div class="dk-pdone"></div></section>
    <section class="dk-card dk-manual" hidden><h2 class="dk-h">补记</h2><p class="dk-sub muted">在学习台外面做的（纸上、Notability、对话里）：写一句、贴张截图，下一节课的课后报告会列出来。</p><div class="dk-body"></div><div class="dk-mlist"></div></section>
    </div>
    <div class="dk-col dk-col-side">
    <section class="dk-card dk-mine" hidden><h2 class="dk-h">我改记忆</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-check" hidden><h2 class="dk-h">自检</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-colls" hidden><h2 class="dk-h">记忆库</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-backup" hidden><h2 class="dk-h">备份和用量</h2><div class="dk-body"></div></section>
    </div>
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
  const loaded = new Set();
  const failed = new Set();
  let ledger = null;
  let lastCheck = '';
  let lastLedger = '';
  let timer = 0;
  // 对话里的 Claude 备好的下一节课（资料包，每科一份：pack/main、pack/main-cs、pack/main-en）：开新课时抄一份进那节课
  let space = loadSpace();
  const packs = Object.fromEntries(SPACE_KEYS.map((k) => [k, { main: null, problems: null }]));
  for (const k of SPACE_KEYS) {
    const ids = packIds(k);
    db.doc(`pack/${ids.main}`).onSnapshot((s) => { packs[k].main = s.exists ? s.data() : null; if (k === space) paintClass(); }, () => {});
    db.doc(`pack/${ids.problems}`).onSnapshot((s) => { packs[k].problems = s.exists ? s.data() : null; }, () => {});
  }
  // 这一科的记忆（共用的几类全给）；pack 是这一科的资料包
  const sv = () => filterSpace(data, space);
  let pack = packs[space];
  let lastRes = null;
  function setSpace(k) {
    if (!SPACES[k]) return;
    space = k;
    pack = packs[k];
    try { localStorage.setItem(SPACE_KEY, k); } catch { /* 无痕模式 */ }
    root.querySelectorAll('.dk-space').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.space === k)));
    manualForm?.refreshBlocks();
    if (lastRes) paint(lastRes, toDate(Date.now()));
  }
  root.querySelector('.dk-spaces').addEventListener('click', (e) => { const b = e.target.closest('.dk-space'); if (b) setSpace(b.dataset.space); });
  root.querySelectorAll('.dk-space').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.space === space)));
  const ledgerReady = db.doc('meta/ledger').get().then((s) => { ledger = s.exists ? s.data() : null; lastLedger = JSON.stringify(ledger); }).catch(() => {});
  for (const c of MEMORY_COLLECTIONS) {
    db.collection(c).onSnapshot((snap) => {
      data[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      loaded.add(c);
      failed.delete(c);
      if (c === 'sessions' || c === 'position') paintClass();
      if (c === 'sessions') fixReports();
      if (c === 'evidence') paintManual();
      if (c === 'curriculum') manualForm?.refreshBlocks();
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

  function paint(res, today) {
    lastRes = res;
    status.hidden = true;
    for (const s of ['.dk-today', '.dk-check', '.dk-colls', '.dk-manual', '.dk-backup', '.dk-pending', '.dk-mine']) $(s).hidden = false;
    pagesView.refresh();
    paintClass();
    paintManual();
    paintBackup();
    paintPending();
    paintMine();
    const total = Object.values(res.counts).reduce((a, b) => a + b, 0);
    // 今天（这一科）：过期、今天到期的复现组，下一节从哪接、欠账；别的科有到期的提一句
    const mine = sv();
    const pos = mine.position.find((d) => d.id === positionId(space));
    const dues = dueList(mine.reviews, today);
    const due = dues.filter((d) => d.days <= 0);
    const soon = dues.filter((d) => d.days > 0).slice(0, 3);
    const elsewhere = SPACE_KEYS.filter((k) => k !== space).map((k) => [k, dueList(filterSpace(data, k).reviews, today).filter((d) => d.days <= 0).length]).filter(([, n]) => n);
    $('.dk-today .dk-body').innerHTML = !total ? '<p class="muted">记忆库还是空的。回对话里让 Claude 把记忆搬进来（说明书第七节「迁移」）。</p>' : `
      <div class="dk-due">${due.length ? due.map((d) => `<div class="dk-row ${d.days < 0 ? 'is-over' : 'is-today'}"><b>${escapeHtml(d.id)}</b><span>${inline(d.title)}</span><em>${d.days < 0 ? `过期 ${-d.days} 天` : '今天'}</em><button type="button" class="btn btn-sm dk-review" data-rid="${escapeHtml(d.id)}">开复现课</button></div>`).join('') : '<p class="muted">今天没有到期的复现组。</p>'}
        ${soon.length ? `<p class="dk-soon muted">接下来：${soon.map((d) => `${escapeHtml(d.id)}（${escapeHtml(d.due.slice(5))}）`).join('、')}</p>` : ''}
        ${elsewhere.length ? `<p class="dk-soon">别的科也有到期的：${elsewhere.map(([k, n]) => `<button type="button" class="btn btn-sm dk-space-go" data-space="${k}">${SPACES[k].label} ${n} 组</button>`).join(' ')}</p>` : ''}</div>
      ${pos ? `<div class="dk-pos"><div><span class="dk-k">下一节</span>${inline(pos.next)}</div>${pos.block ? `<div><span class="dk-k">学到</span>${escapeHtml(pos.block)}${blockTitle(pos.block)}</div>` : ''}${listOf(pos.debts).length ? `<div><span class="dk-k">欠账</span>${listOf(pos.debts).map((x) => inline(x)).join('；')}</div>` : ''}</div>` : ''}`;
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

  // —— 上课：接着上没下课的那节，或者开一节新的 ——
  function paintClass() {
    if (!loaded.has('sessions')) return;
    const box = $('.dk-class');
    box.hidden = false;
    const mine = sv();
    // 没下课的：课堂、对话里的 Claude 开的实时黑板、自学单元，都列出来（最新的在前）
    const opens = mine.sessions.filter((x) => x.status === 'open').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const open = opens.find((x) => kindOf(x) === 'class');
    // 上一节（这一科下了课的最近一节）：课后报告的要点、花了多少
    const last = mine.sessions.filter((x) => x.status === 'closed').sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
    const lastLine = last ? [last.report?.line || '', usageText(last.usage)].filter(Boolean).join('；') : '';
    const main = pack.main;
    const block = main?.block || mine.position.find((d) => d.id === positionId(space))?.block || '';
    // 等我确认的改动单；上一节还没整理完（它的整理单里还有没点的）
    const openPd = (mine.pending || []).filter((p) => p.status === 'open');
    const lastOpen = last ? openPd.filter((p) => p.session === last.id).length : 0;
    box.querySelector('.dk-body').innerHTML = `
      ${lastOpen ? `<p class="dk-warn">上一节的整理单还有 ${lastOpen} 条没确认：<a class="dk-link" href="#classes/${escapeHtml(last.id)}">去看那节课</a> 或者在下面「待确认」里点。</p>` : openPd.length ? `<p><a class="dk-link dk-to-pending" href="#">待确认 ${openPd.length} 条 ↓</a></p>` : ''}
      ${last ? `<p class="dk-last"><span class="dk-k">上一节</span>${escapeHtml(last.id)}${last.block ? `（${escapeHtml(last.block)}）` : ''}${lastLine ? `<span class="muted">：${escapeHtml(lastLine)}</span>` : ''}</p>` : ''}
      ${opens.map((x) => { const k = kindOf(x); return `<div class="dk-row dk-open is-${k}"><span class="dk-kind">${SESSION_KINDS[k]}</span><span>${inline(x.title || x.id)}${x.block ? `<span class="muted">（${escapeHtml(x.block)}）</span>` : ''}</span><button type="button" class="btn btn-primary dk-go" data-sid="${escapeHtml(x.id)}">${k === 'class' ? '接着上课' : '进去'}</button></div>`; }).join('')}
      <div class="dk-next">${main ? `<p><span class="dk-k">备好的课</span>${inline(main.unit || '（资料包没写 unit）')}${block ? `<span class="muted">（${escapeHtml(block)}）</span>` : ''}</p>${main.goal ? `<p class="dk-goal muted" title="点一下看全文">${inline(main.goal)}</p>` : ''}`
        : `<p class="muted">对话里的 Claude 还没备${SPACES[space].label}的课（pack/${packIds(space).main} 是空的）。也可以直接开课：课堂里的 Claude 带着记忆，但没有这节课的安排。</p>`}
        <button type="button" class="btn ${open ? '' : 'btn-primary'} dk-new">开新课</button></div>
      <div class="dk-mrow dk-handoff"><button type="button" class="btn btn-sm dk-copy-handoff">复制给外部 Claude 的启动语</button><span class="muted">贴进任何一个对话，它就知道去哪读说明、学到哪了、要做什么。</span></div>`;
    // 资料包的目标常常很长：先收成三行，点一下展开
    box.querySelector('.dk-goal')?.addEventListener('click', (e) => e.currentTarget.classList.toggle('is-open'));
    box.querySelector('.dk-to-pending')?.addEventListener('click', (e) => { e.preventDefault(); $('.dk-pending').scrollIntoView({ behavior: 'smooth' }); });
    box.querySelector('.dk-copy-handoff').addEventListener('click', async () => {
      const text = handoffText(sv(), { kitUrl: KIT_URL, deskUrl: deskUrl(), pack: pack.main, space });
      try { await navigator.clipboard.writeText(text); toast('复制好了，去对话里粘贴'); } catch { prompt('没能自动复制，长按全选后复制：', text); }
    });
    box.querySelectorAll('.dk-go').forEach((b) => b.addEventListener('click', (e) => goto(e.currentTarget.dataset.sid)));
    box.querySelector('.dk-new').addEventListener('click', (e) => { e.currentTarget.disabled = true; newClass(block).catch((err) => { toast(`没开成：${err?.message || err}`); e.currentTarget.disabled = false; }); });
  }

  // —— 下了课却没有课后报告的（下课时没写成、旧版下的课）：补写，一次最多 3 节 ——
  const fixing = new Set();
  function fixReports() {
    const todo = data.sessions.filter((x) => x.status === 'closed' && !x.report && !fixing.has(x.id)).slice(0, 3);
    for (const x of todo) {
      fixing.add(x.id);
      const { id, ...doc } = x;
      writeReport(db, id, { doc, update: (patch) => db.doc(`sessions/${id}`).set({ ...doc, ...patch }) }).catch((e) => console.warn('课后报告没补写成', id, e));
    }
  }

  // —— 待确认：所有课的改动单（memoview.js）；我点了才写 ——
  const ops = createMemOps({ db, mem: () => data });
  const memoView = createMemoView({ db, ops });
  let pendingWired = false;
  function paintPending() {
    if (pendingWired) { memoView.refresh(); return; }
    pendingWired = true;
    const byAt = (a, b) => (b.at || 0) - (a.at || 0);
    // 只列这一科的（分不出科的，比如偏好，各科都列）
    const here = (p) => { const k = spaceOfDoc('pending', p, data); return !k || k === space; };
    memoView.attach($('.dk-popen'), () => memoView.all().filter((p) => p.status === 'open' && here(p)).sort(byAt), { mode: 'list', empty: '没有等你确认的。' });
    memoView.attach($('.dk-pdone'), () => memoView.all().filter((p) => p.status === 'done' && here(p) && p.doneAt > Date.now() - UNDO_DAYS * 86400000).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 12), { mode: 'list', empty: '这几天没有写进去的。' });
  }

  // —— 我改记忆：偏好的文字、错题标已解决、复现组暂停（memo.js 的 meChange，一样记改动单、能撤销）——
  function paintMine() {
    const box = $('.dk-mine .dk-body');
    if (box.querySelector('.mm-f')) return; // 正在改的时候不重画
    const gone = voidedIds(data);
    const solved = resolvedErrors(data);
    const prefs = data.profile.filter((p) => !gone.has(`profile/${p.id}`)).sort((a, b) => cmpId(a.id, b.id));
    const mine = sv();
    const errs = mine.errors.filter((e) => !e.corrects && !gone.has(`errors/${e.id}`) && !solved.has(String(e.id))).sort((a, b) => cmpId(a.id, b.id));
    const revs = mine.reviews.filter((r) => !gone.has(`reviews/${r.id}`) && r.status !== 'done').sort((a, b) => cmpId(a.id, b.id));
    box.innerHTML = `
      <div class="dk-memo-sub" role="heading" aria-level="3">关于我（讲法、习惯……）</div>${prefs.map((p) => `<div class="dk-edit-row" data-id="${escapeHtml(p.id)}"><span><span class="dk-k">${escapeHtml(p.topic || '')}</span>${inline(p.text)}</span><button type="button" class="btn btn-sm dk-pref">改</button></div>`).join('') || '<p class="muted">还没有。</p>'}
      <div class="dk-memo-sub" role="heading" aria-level="3">没解决的错题</div>${errs.map((e) => `<div class="dk-edit-row" data-id="${escapeHtml(e.id)}"><span><b>${escapeHtml(e.id)}</b> ${inline(String(e.cause || e.q || '').slice(0, 80))}</span><button type="button" class="btn btn-sm dk-solve">已解决</button></div>`).join('') || '<p class="muted">没有。</p>'}
      <div class="dk-memo-sub" role="heading" aria-level="3">复现组</div>${revs.map((r) => `<div class="dk-edit-row" data-id="${escapeHtml(r.id)}"><span><b>${escapeHtml(r.id)}</b> ${inline(r.title)}${r.status === 'paused' ? '<span class="muted">（暂停了）</span>' : ''}</span><button type="button" class="btn btn-sm dk-pause">${r.status === 'paused' ? '恢复' : '暂停'}</button></div>`).join('') || '<p class="muted">没有。</p>'}`;
  }
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
    else if (b.classList.contains('dk-pref-x')) { row.innerHTML = ''; paintMine(); }
    else if (b.classList.contains('dk-solve')) { if (confirm(`把 ${id} 标成已解决？（原条不动，加一条更正）`)) await run('resolve', {}, `${id} 标了已解决`); }
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
        <div class="dk-mrow"><span class="dk-bnote muted" role="status">存成一个 JSON 文件。要恢复时把文件交给项目对话里的 Claude（说明书第七节「备份和恢复」）。</span><button type="button" class="btn dk-bgo">导出备份</button></div>`;
      box.querySelector('.dk-bgo').addEventListener('click', (e) => exportBackup(e.currentTarget));
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
      if (!dl) throw new Error('这个学习台发布时没有声明 downloads，存不了文件：让对话里的 Claude 照说明书第七节重新发布一次');
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
      const file = backupFile({ memory: data, pack, sessions, evidence, boards, kit: VERSION, today });
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

  // 开一节新课：sessions/{编号}，资料包抄一份进 sessions/{编号}/pack（以后对话里的 Claude 备下一节、改 pack/main，不影响这一节）
  // use：复现课用页面自己拼的资料包（views.js 的 reviewPack），不用 pack/main
  async function newClass(block, use = null) {
    const today = toDate(Date.now());
    const sid = sessionId(today, data.sessions.map((x) => x.id));
    assertWrite('page', 'sessions');
    const main = use ? use.main : pack.main || null;
    const problems = use ? use.problems : pack.problems;
    // 这节课是哪一科、哪门课：按块看（没有块就是现在看着的这一科），课堂按它带组件说明和教法
    const sp = block ? spaceOfId(block) : space;
    await db.doc(`sessions/${sid}`).set({
      date: today, block: block || null, title: String(main?.unit || unit), status: 'open', startedAt: Date.now(), space: sp, ...(block ? { subject: subjectOf(block) } : {}),
      pack: main ? { unit: main.unit || '', goal: main.goal || '', updatedAt: main.updatedAt || null } : null,
      ...(main?.review ? { review: main.review } : {}),
    });
    const scoped = scopeDb(db, sid);
    if (main) await scoped.doc('pack/main').set({ ...main, block: block || main.block || null });
    if (problems) await scoped.doc('pack/problems').set(problems);
    goto(sid);
  }

  // —— 复现课：到期的复现组一键开课，资料包页面自己拼（这一组的内容、盯的弱点、错题原文、以前同一块的题）——
  $('.dk-today').addEventListener('click', async (e) => {
    const b = e.target.closest('.dk-review');
    if (!b) return;
    b.disabled = true;
    try {
      const r = data.reviews.find((x) => x.id === b.dataset.rid);
      const blocks = Array.isArray(r?.blocks) ? r.blocks.map(String) : [];
      // 以前各节课的题（sessions/{编号}/pack/problems），只要同一块的
      const packs = [];
      for (const x of data.sessions.filter((y) => blocks.includes(String(y.block || ''))).slice(-8)) {
        const snap = await scopeDb(db, x.id).doc('pack/problems').get().catch(() => null);
        if (snap?.exists) packs.push({ ...snap.data(), block: x.block, session: x.id });
      }
      const use = reviewPack(data, b.dataset.rid, { packs });
      await newClass(use.main.block, use);
    } catch (err) {
      toast(`没开成：${err?.message || err}`);
      b.disabled = false;
    }
  });

  // —— 首页以外的页面：课程地图、弱点表、错题本、以前的课、统计（pages.js，换页不刷新）——
  const pagesView = createPages($('.dk-pages'), { getData: sv, db, ops, goto });
  // 首页「别的科也有到期的」：点了切过去
  $('.dk-today').addEventListener('click', (e) => { const b = e.target.closest('.dk-space-go'); if (b) setSpace(b.dataset.space); });
  function route() {
    const h = decodeURIComponent(String(location.hash || '').slice(1));
    if (isSessionId(h) || viewHash()) { location.reload(); return; }
    const page = h.split('/')[0];
    const home = !PAGES[page];
    $('.dk-home').hidden = !home;
    $('.dk-pages').hidden = home;
    root.querySelectorAll('.dk-nav a').forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${home ? '' : page}`)));
    if (!home) pagesView.show(h);
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
    bar.querySelector('.dk-clear').addEventListener('click', () => { if (confirm('清空本地的示例记忆？')) { db._clear?.(); location.reload(); } });
  }
}

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
  // 资料包写了块就用它的；没写就用开课时记下的
  const main = await scopeDb(db, sid).doc('pack/main').get().then((s) => (s.exists ? s.data() : null)).catch(() => null);
  // 改记忆（memo 块、整理单、确认 / 撤销）：用没 scopeDb 过的数据库，记忆库在根上
  const ops = createMemOps({ db, mem: () => mem });
  const block = String(main?.block || doc.block || '');
  // 分科：课堂按这一块的门课带组件说明和教法（学习台页面开头的 subject: 管不了每节课）
  session.subject = doc.subject || subjectOf(block);
  const kind = kindOf(doc);
  const title = doc.title || meta.unit;
  // 实时黑板、自学单元是对话里的 Claude 开的：页面不写报告给课堂 Claude，用完了由谁点「用完了」都行，报告由首页补写（fixReports）
  const finish = async () => {
    if (!confirm(`${SESSION_KINDS[kind]}「${title}」用完了？以后在「以前的课」里还能翻看。`)) return;
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
  if (kind === 'unit') return enterUnit(root, meta, { db, store, sid, doc, block, title, readOnly, finish });
  if (readOnly) {
    return renderClass(root, { ...meta, unit: doc.title || meta.unit }, {
      store: { ...store, db: readOnlyDb(scopeDb(db, sid)), assets: null }, sid, block, mem, readOnly: true,
      updateSession: () => Promise.resolve(), onHome: () => goto(`classes/${sid}`),
      memo: { ops, view: createMemoView({ db, ops }) },
    });
  }
  return renderClass(root, { ...meta, unit: doc.title || meta.unit }, {
    store: { ...store, db: scopeDb(db, sid) }, sid, block, mem, updateSession, onHome: () => goto(''),
    writeReport: ({ turns, steps } = {}) => writeReport(db, sid, { doc, turns, steps, update: updateSession }),
    // 下课时先算一份（还没下课：结束时间按现在算）放进给课堂 Claude 的输入
    makeReport: ({ turns, steps } = {}) => makeReport(db, sid, { doc: { ...doc, endedAt: doc.endedAt || Date.now() }, turns, steps }),
    memo: { ops, view: createMemoView({ db, ops }) },
    review: doc.review || null,
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
 * 课后报告（report.js，页面代码算、不调用 Claude）写进 sessions/{编号}/report/main，要点（首页「上一节」那一行）记在 sessions/{编号}.report。
 * 读这节课的证据、观察、失误，上一节课下课以后的补记；turns、steps 下课时课堂直接给（还在排队写进数据库的也算上），补写时从数据库读。
 * update(patch)：改 sessions/{编号}（课堂里用 updateSession，免得和它手上的那份打架）
 */
export async function writeReport(db, sid, { doc, turns = null, steps = null, update }) {
  assertWrite('page', 'sessions');
  const report = await makeReport(db, sid, { doc, turns, steps });
  await scopeDb(db, sid).doc('report/main').set(report);
  await update({ report: { at: report.at, line: reportLine(report), items: report.totals.items, first: report.totals.first, activeMs: report.time.activeMs } });
  return report;
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
