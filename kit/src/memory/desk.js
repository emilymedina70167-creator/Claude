// 学习台（mode: desk）：一个长期存在的 artifact，它的数据库就是记忆库（docs/learner-memory-spec.md）。
// 第 1 批：记忆库本身。对话里的 Claude 用 ArtifactData 读写这些集合；页面打开时：
// - 按 last + tier 算复现组的到期日（不手填），首页「今天」列出过期和今天到期的
// - 自检（check.js）：编号、字段、证据、只增不改、改了记 log；结果写回 meta/memcheck，对话里的 Claude 写完读它
// 在学习台里上课（第 2 批）、课程地图和弱点表的页面（第 3 批）后面做。
import { mdToHtml, escapeHtml } from '../render.js';
import { session } from '../session.js';
import { toast } from '../record.js';
import { getStore } from '../live/store.js';
import { VERSION } from '../version.js';
import { COLLECTIONS, MEMORY_COLLECTIONS, assertWrite, toDate } from './schema.js';
import { checkMemory, memcheckRecord } from './check.js';
import { sampleMemory } from './sample.js';

const CHECK_DELAY = 800; // 一次 batch 写进来好几类：停一下再查，不要每到一类查一遍
const ROLE_TEXT = { chat: '对话里的 Claude', class: '课堂里的 Claude', page: '页面' };

export async function renderDesk(root, meta) {
  session.mode = 'desk';
  session.live = true;
  root.classList.add('is-desk');
  const unit = meta.unit || session.title || '学习台';
  root.innerHTML = `
    <header class="dk-head">
      <h1 class="dk-title">学习台</h1>
      <span class="dk-unit">${mdToHtml(String(unit), { inline: true })}</span>
      <span class="dk-ver" title="组件库版本">组件库 ${escapeHtml(VERSION)}</span>
    </header>
    <p class="dk-status muted">正在连接记忆库…</p>
    <section class="dk-card dk-today" hidden><h2 class="dk-h">今天</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-check" hidden><h2 class="dk-h">自检</h2><div class="dk-body"></div></section>
    <section class="dk-card dk-colls" hidden><h2 class="dk-h">记忆库</h2><div class="dk-body"></div></section>
    <p class="dk-later muted" hidden>在学习台里上课、课程地图、弱点表、课程列表在后面两批里做。现在课堂照旧每节课一个课堂 artifact。</p>`;
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
  const ledgerReady = db.doc('meta/ledger').get().then((s) => { ledger = s.exists ? s.data() : null; lastLedger = JSON.stringify(ledger); }).catch(() => {});
  for (const c of MEMORY_COLLECTIONS) {
    db.collection(c).onSnapshot((snap) => {
      data[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      loaded.add(c);
      failed.delete(c);
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
