// 学习台（mode: desk）：一个长期存在的 artifact，它的数据库就是记忆库（docs/learner-memory-spec.md）。
// 第 1 批：记忆库本身。对话里的 Claude 用 ArtifactData 读写这些集合；页面打开时：
// - 按 last + tier 算复现组的到期日（不手填），首页「今天」列出过期和今天到期的
// - 自检（check.js）：编号、字段、证据、只增不改、改了记 log；结果写回 meta/memcheck，对话里的 Claude 写完读它
// 第 2 批：在学习台里上课。首页「开新课」开一节（sessions/{编号}，资料包抄一份进去），地址后面带 #编号 就进这节课：
// 课堂照旧是 class/classroom.js，数据放在 sessions/{编号}/ 下面，证据、观察进记忆库，每一轮带着记忆摘要。
// 课程地图、弱点表、课程列表的页面（第 3 批）后面做。
import { mdToHtml, escapeHtml } from '../render.js';
import { session } from '../session.js';
import { toast } from '../record.js';
import { getStore } from '../live/store.js';
import { VERSION } from '../version.js';
import { COLLECTIONS, MEMORY_COLLECTIONS, assertWrite, toDate } from './schema.js';
import { sessionId, isSessionId, scopeDb } from './session.js';
import { renderClass } from '../class/classroom.js';
import { checkMemory, memcheckRecord } from './check.js';
import { sampleMemory } from './sample.js';

const CHECK_DELAY = 800; // 一次 batch 写进来好几类：停一下再查，不要每到一类查一遍
const ROLE_TEXT = { chat: '对话里的 Claude', class: '课堂里的 Claude', page: '页面' };
// 课堂每一轮要带的记忆（证据条数多、按需查，不订阅）
const MEMORY_FOR_CLASS = MEMORY_COLLECTIONS.filter((c) => c !== 'evidence' && c !== 'sessions');

/** 地址后面的 #c-20261027-1：进这节课（刷新也还在这节课里） */
export const classHash = () => { const h = decodeURIComponent(String(location.hash || '').slice(1)); return isSessionId(h) ? h : ''; };
const goto = (hash) => { location.hash = hash; location.reload(); };

export async function renderDesk(root, meta) {
  session.mode = 'desk';
  session.live = true;
  const inClass = classHash();
  if (inClass) return enterClass(root, meta, inClass);
  root.classList.add('is-desk');
  const unit = meta.unit || session.title || '学习台';
  root.innerHTML = `
    <header class="dk-head">
      <h1 class="dk-title">学习台</h1>
      <span class="dk-unit">${mdToHtml(String(unit), { inline: true })}</span>
      <span class="dk-ver" title="组件库版本">组件库 ${escapeHtml(VERSION)}</span>
    </header>
    <p class="dk-status muted">正在连接记忆库…</p>
    <section class="dk-card dk-class" hidden><h2 class="dk-h">上课</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-today" hidden><h2 class="dk-h">今天</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-check" hidden><h2 class="dk-h">自检</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-colls" hidden><h2 class="dk-h">记忆库</h2><div class="dk-body"></div></section>
    <p class="dk-later muted" hidden>课程地图、弱点表、以前的课的列表在下一批里做。</p>`;
  const $ = (s) => root.querySelector(s);
  const status = $('.dk-status');

  const store = await getStore({ title: session.title });
  if (!store) {
    status.innerHTML = '这个页面没有拿到记忆库的数据库权限。<br>发布时要声明 <code>capabilities: {"db": {}, "assets": {}}</code>；本地试用请在地址后面加 <code>?dev</code>。';
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
  // 对话里的 Claude 备好的下一节课（资料包）：开新课时抄一份进那节课
  let pack = { main: null, problems: null };
  db.doc('pack/main').onSnapshot((s) => { pack.main = s.exists ? s.data() : null; paintClass(); }, () => {});
  db.doc('pack/problems').onSnapshot((s) => { pack.problems = s.exists ? s.data() : null; }, () => {});
  const ledgerReady = db.doc('meta/ledger').get().then((s) => { ledger = s.exists ? s.data() : null; lastLedger = JSON.stringify(ledger); }).catch(() => {});
  for (const c of MEMORY_COLLECTIONS) {
    db.collection(c).onSnapshot((snap) => {
      data[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      loaded.add(c);
      failed.delete(c);
      if (c === 'sessions' || c === 'position') paintClass();
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
    status.hidden = true;
    for (const s of ['.dk-today', '.dk-check', '.dk-colls', '.dk-later']) $(s).hidden = false;
    paintClass();
    const total = Object.values(res.counts).reduce((a, b) => a + b, 0);
    // 今天：过期、今天到期的复现组，下一节从哪接、欠账
    const pos = data.position.find((d) => d.id === 'now');
    const due = res.due.filter((d) => d.days <= 0);
    const soon = res.due.filter((d) => d.days > 0).slice(0, 3);
    $('.dk-today .dk-body').innerHTML = !total ? '<p class="muted">记忆库还是空的。回对话里让 Claude 把记忆搬进来（说明书第七节「迁移」）。</p>' : `
      <div class="dk-due">${due.length ? due.map((d) => `<div class="dk-row ${d.days < 0 ? 'is-over' : 'is-today'}"><b>${escapeHtml(d.id)}</b><span>${inline(d.title)}</span><em>${d.days < 0 ? `过期 ${-d.days} 天` : '今天'}</em></div>`).join('') : '<p class="muted">今天没有到期的复现组。</p>'}
        ${soon.length ? `<p class="dk-soon muted">接下来：${soon.map((d) => `${escapeHtml(d.id)}（${escapeHtml(d.due.slice(5))}）`).join('、')}</p>` : ''}</div>
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
      return `<div class="dk-crow"><span class="dk-cname">${escapeHtml(s.label)}<code>${c}</code></span><span class="dk-n">${res.counts[c]}</span><span class="dk-who">${s.writers.map((r) => ROLE_TEXT[r]).join('、')}写</span></div>`;
    }).join('')}</div>`;
  }

  // —— 上课：接着上没下课的那节，或者开一节新的 ——
  function paintClass() {
    if (!loaded.has('sessions')) return;
    const box = $('.dk-class');
    box.hidden = false;
    const open = data.sessions.filter((x) => x.status === 'open').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
    const main = pack.main;
    const block = main?.block || data.position.find((d) => d.id === 'now')?.block || '';
    box.querySelector('.dk-body').innerHTML = `
      ${open ? `<div class="dk-row"><b>${escapeHtml(open.id)}</b><span>${inline(open.title || '')}${open.block ? `<span class="muted">（${escapeHtml(open.block)}）</span>` : ''}</span><button type="button" class="btn btn-primary dk-go" data-sid="${escapeHtml(open.id)}">接着上课</button></div>` : ''}
      <div class="dk-next">${main ? `<p><span class="dk-k">备好的课</span>${inline(main.unit || '（资料包没写 unit）')}${block ? `<span class="muted">（${escapeHtml(block)}）</span>` : ''}</p>${main.goal ? `<p class="muted">${inline(main.goal)}</p>` : ''}`
        : '<p class="muted">对话里的 Claude 还没备课（pack/main 是空的）。也可以直接开课：课堂里的 Claude 带着记忆，但没有这节课的安排。</p>'}
        <button type="button" class="btn ${open ? '' : 'btn-primary'} dk-new">开新课</button></div>`;
    box.querySelector('.dk-go')?.addEventListener('click', (e) => goto(e.currentTarget.dataset.sid));
    box.querySelector('.dk-new').addEventListener('click', (e) => { e.currentTarget.disabled = true; newClass(block).catch((err) => { toast(`没开成：${err?.message || err}`); e.currentTarget.disabled = false; }); });
  }

  // 开一节新课：sessions/{编号}，资料包抄一份进 sessions/{编号}/pack（以后对话里的 Claude 备下一节、改 pack/main，不影响这一节）
  async function newClass(block) {
    const today = toDate(Date.now());
    const sid = sessionId(today, data.sessions.map((x) => x.id));
    assertWrite('page', 'sessions');
    const main = pack.main || null;
    await db.doc(`sessions/${sid}`).set({
      date: today, block: block || null, title: String(main?.unit || unit), status: 'open', startedAt: Date.now(),
      pack: main ? { unit: main.unit || '', goal: main.goal || '', updatedAt: main.updatedAt || null } : null,
    });
    const scoped = scopeDb(db, sid);
    if (main) await scoped.doc('pack/main').set({ ...main, block: block || main.block || null });
    if (pack.problems) await scoped.doc('pack/problems').set(pack.problems);
    goto(sid);
  }

  const listOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean).map(String);
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
    root.append(bar);
    bar.querySelector('.dk-seed').addEventListener('click', async () => {
      const today = toDate(Date.now());
      for (const [c, docs] of Object.entries(sampleMemory(today))) for (const d of docs) { const { id, ...rest } = d; await db.doc(`${c}/${id}`).set(rest); }
    });
    bar.querySelector('.dk-clear').addEventListener('click', () => { if (confirm('清空本地的示例记忆？')) { db._clear?.(); location.reload(); } });
  }
}

// —— 在学习台里上一节课 ——
// 课堂的数据放在 sessions/{编号}/ 下面；记忆库一直订阅着（每一轮的记忆摘要用最新的）；sessions/{编号} 由页面改（核验、下课）
async function enterClass(root, meta, sid) {
  const store = await getStore({ title: session.title });
  if (!store) {
    root.innerHTML = '<p class="dk-status muted">这个页面没有拿到记忆库的数据库权限。发布时要声明 <code>capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}</code>。</p>';
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
  const block = String(main?.block || doc.block || '');
  return renderClass(root, { ...meta, unit: doc.title || meta.unit }, {
    store: { ...store, db: scopeDb(db, sid) }, sid, block, mem, updateSession, onHome: () => goto(''),
  });
}
