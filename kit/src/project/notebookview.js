// 第十四轮的画面（docs/superpowers/specs/2026-11-17-project-claude-design.md 6.1、6.3）：
// 「管理 → 项目指令」学生自己写的那一份（每一轮原样给项目 Claude）；「管理 → 笔记本」项目 Claude 自己的笔记，学生看、改、退回、恢复；
// 导航的「笔记」页：它标了 show 的文件照课件画出来，能作答（证据记 session: 'note'）。
// 纯函数在 instructions.js（tests/project-instructions.test.js）。
import { escapeHtml, renderLesson } from '../render.js';
import { toast } from '../record.js';
import { ask } from '../dialog.js';
import { session } from '../session.js';
import { createSink } from '../live/sync.js';
import { reportError } from '../errlog.js';
import { notebookDir } from './notebook.js';
import { saveInstructions, shownNotes } from './instructions.js';
import { undoJournal, journalId, changedSince } from './journal.js';

export { saveInstructions, shownNotes };

const BY = { me: '我改的', class: '课上的老师', head: '班主任', after: '课后那一轮', organize: '第一次整理', night: '夜班', ext: '外部主讲', chat: '开发那边' };
const day = (at) => (at ? new Date(Number(at)).toISOString().slice(0, 10) : '');
const fit = (ta) => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, 640)}px`; };

/**
 * db：学习台的数据库；store：页面的 store（作答写证据用）；getData()：首页手上的数据（notebook 一类）；
 * notebook：notebookdesk 的 { run }；charter：以前的根本规则全文（只给学生看、能复制）
 * $：在首页里找元素
 */
export function createProjectView({ db, store, getData, notebook, charter = '', $ }) {
  let instr = null;
  db.doc('meta/instructions').onSnapshot((s) => { instr = s.exists ? s.data() : null; paintInstr(); }, () => {});

  // —— 管理 → 项目指令 ——
  function paintInstr() {
    const body = $('.dk-instr .dk-body');
    if (!body) return;
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      body.innerHTML = `
        <div class="sm-doc"><textarea class="sm-text dk-instr-text" rows="8" spellcheck="false" aria-label="项目指令" placeholder="（还没写）"></textarea>
        <div class="sm-foot"><span class="muted dk-instr-meta"></span><span class="sm-btns"><button type="button" class="btn btn-primary dk-instr-save" disabled>存</button><button type="button" class="btn dk-instr-old">以前的版本</button></span></div>
        <div class="sm-old dk-instr-hist" hidden></div></div>
        ${charter ? `<details class="dk-fold dk-instr-charter"><summary class="muted">以前开发写的「根本规则」（已经不发了；想要哪句自己抄上去）</summary><pre class="dk-pre">${escapeHtml(charter)}</pre></details>` : ''}`;
      const ta = body.querySelector('.dk-instr-text');
      ta.addEventListener('input', () => { fit(ta); body.querySelector('.dk-instr-save').disabled = ta.value.trim() === (ta.dataset.saved || ''); });
      body.querySelector('.dk-instr-save').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          const next = saveInstructions(instr, ta.value, Date.now());
          if (next !== instr) await db.doc('meta/instructions').set(next);
          ta.dataset.saved = ta.value.trim();
          toast('存好了，下一轮就带着');
        } catch (err) { reportError(err, { what: '存项目指令' }); toast('没存上，再点一次'); e.target.disabled = false; }
      });
      body.querySelector('.dk-instr-old').addEventListener('click', () => {
        const box = body.querySelector('.dk-instr-hist');
        box.hidden = !box.hidden;
        box.innerHTML = (instr?.history || []).map((h, i) => `<div class="dk-row"><span class="dk-row-t"><span class="muted">${day(h.at)} ${escapeHtml(BY[h.by] || '')}</span><br>${escapeHtml(h.text || '（空）')}</span><button type="button" class="btn dk-instr-back" data-i="${i}">用这一版</button></div>`).join('') || '<p class="muted">还没有以前的版本。</p>';
      });
      body.querySelector('.dk-instr-hist').addEventListener('click', async (e) => {
        const b = e.target.closest('.dk-instr-back');
        if (!b) return;
        const h = instr?.history?.[Number(b.dataset.i)];
        if (!h || !await ask('换回这一版？现在这版会留在以前的版本里。', { ok: '换回' })) return;
        try { await db.doc('meta/instructions').set(saveInstructions(instr, h.text, Date.now())); toast('换回去了'); } catch (err) { reportError(err, { what: '退回项目指令' }); }
      });
    }
    const ta = body.querySelector('.dk-instr-text');
    const text = String(instr?.text || '');
    if (ta.dataset.saved === undefined || ta.value.trim() === (ta.dataset.saved || '')) { ta.value = text; ta.dataset.saved = text.trim(); fit(ta); }
    body.querySelector('.dk-instr-meta').textContent = instr?.at ? `${day(instr.at)} · ${BY[instr.by] || ''}` : '';
    body.querySelector('.dk-instr-save').disabled = ta.value.trim() === (ta.dataset.saved || '');
  }

  // —— 管理 → 笔记本 ——
  let openPath = '';
  function paintNotes() {
    const body = $('.dk-notebook .dk-body');
    if (!body) return;
    // 正在改一个文件（框里有没存的字）：后台又写了笔记本也先不重画，免得把我打的字冲掉；存了以后再画
    const open = body.querySelector('.dk-nb-text');
    if (open && !body.querySelector('.dk-nb-save')?.disabled) return;
    const docs = (getData()?.notebook || []).filter((d) => d && d.path);
    const live = docs.filter((d) => !d.deleted).sort((a, b) => a.path.localeCompare(b.path));
    const gone = docs.filter((d) => d.deleted && !d.movedTo);
    const cur = live.find((d) => d.path === openPath);
    body.innerHTML = `
      ${live.length ? live.map((d) => `<button type="button" class="dk-row dk-nb-row${d.path === openPath ? ' is-open' : ''}" data-path="${escapeHtml(d.path)}"><span class="dk-row-t">${escapeHtml(d.path)}<br><span class="muted">${d.pin ? 'pin · ' : ''}${d.show ? 'show · ' : ''}${day(d.at)} ${escapeHtml(BY[d.by] || '')}${d.quotes?.length ? ` · <span class="bad">${d.quotes.length} 句引号在记录里没找到</span>` : ''}</span></span></button>`).join('') : '<p class="muted">笔记本还是空的。</p>'}
      ${cur ? `<div class="sm-doc dk-nb-open" data-path="${escapeHtml(cur.path)}"><textarea class="sm-text dk-nb-text" rows="10" spellcheck="false" aria-label="${escapeHtml(cur.path)}"></textarea>
        ${cur.quotes?.length ? `<p class="dk-sub bad">这几句引号在记录里没找到：${cur.quotes.map((q) => `「${escapeHtml(q)}」`).join('、')}</p>` : ''}
        <div class="sm-foot"><span class="muted">第 ${Number(cur.v) || 1} 版</span><span class="sm-btns"><button type="button" class="btn btn-primary dk-nb-save" disabled>存</button><button type="button" class="btn dk-nb-hist">以前的版本</button><button type="button" class="btn dk-nb-del">删</button></span></div>
        <div class="sm-old dk-nb-old" hidden></div></div>` : ''}
      ${gone.length ? `<details class="dk-fold"><summary class="muted">删掉的 ${gone.length} 个</summary>${gone.map((d) => `<div class="dk-row"><span class="dk-row-t">${escapeHtml(d.path)}</span><button type="button" class="btn dk-nb-restore" data-path="${escapeHtml(d.path)}">恢复</button></div>`).join('')}</details>` : ''}`;
    const ta = body.querySelector('.dk-nb-text');
    if (ta) { ta.value = cur.text || ''; fit(ta); ta.addEventListener('input', () => { fit(ta); body.querySelector('.dk-nb-save').disabled = ta.value === (cur.text || ''); }); }
  }
  async function wireNotes() {
    const card = $('.dk-notebook');
    if (!card || card.dataset.wired) return;
    card.dataset.wired = '1';
    card.addEventListener('click', async (e) => {
      const row = e.target.closest('.dk-nb-row');
      if (row) { openPath = openPath === row.dataset.path ? '' : row.dataset.path; paintNotes(); return; }
      const box = card.querySelector('.dk-nb-open');
      const path = box?.dataset.path;
      const doc = (getData()?.notebook || []).find((d) => d.path === path && !d.deleted);
      try {
        if (e.target.closest('.dk-nb-save') && doc) {
          // 我改的：整篇换成框里的，版本照留
          const text = card.querySelector('.dk-nb-text').value;
          const r = text === (doc.text || '') ? { ok: true } : await notebook.run({ kind: 'write', path, text }, { by: 'me' });
          toast(r.ok ? '存好了' : `没存上：${r.error}`);
          if (r.ok) { card.querySelector('.dk-nb-save').disabled = true; paintNotes(); }
        } else if (e.target.closest('.dk-nb-hist') && doc) {
          const old = card.querySelector('.dk-nb-old');
          old.hidden = !old.hidden;
          old.innerHTML = (doc.history || []).map((h, i) => `<div class="dk-row"><span class="dk-row-t"><span class="muted">第 ${h.v} 版 · ${day(h.at)} ${escapeHtml(BY[h.by] || '')}</span><br>${escapeHtml(String(h.text || '').slice(0, 600))}</span><button type="button" class="btn dk-nb-back" data-i="${i}">用这一版</button></div>`).join('') || '<p class="muted">还没有以前的版本。</p>';
        } else if (e.target.closest('.dk-nb-back') && doc) {
          const h = doc.history?.[Number(e.target.closest('.dk-nb-back').dataset.i)];
          if (h && await ask('换回这一版？现在的会留在以前的版本里。', { ok: '换回' })) {
            const r = await notebook.run({ kind: 'write', path, text: h.text || '' }, { by: 'me' });
            toast(r.ok ? '换回去了' : `没换成：${r.error}`);
          }
        } else if (e.target.closest('.dk-nb-del') && doc) {
          if (await ask(`删掉「${path}」？能在「删掉的」里恢复。`, { ok: '删' })) { await notebook.run({ kind: 'delete', path }, { by: 'me' }); openPath = ''; }
        } else if (e.target.closest('.dk-nb-restore')) {
          await notebook.run({ kind: 'restore', path: e.target.closest('.dk-nb-restore').dataset.path }, { by: 'me' });
        }
      } catch (err) { reportError(err, { what: '改笔记本' }); toast('没改成，再试一次'); }
    });
  }

  // —— 「笔记」页：show 的文件 ——
  let sinkSet = false;
  function paintPage(hash = '') {
    const host = $('.dk-notespage');
    if (!host) return;
    const list = shownNotes(getData()?.notebook);
    const want = decodeURIComponent(String(hash).split('/').slice(1).join('/'));
    const cur = list.find((d) => d.id === want) || null;
    if (!cur) {
      host.innerHTML = `<section class="dk-card"><h2 class="dk-h">笔记</h2>${list.length ? list.map((d) => `<a class="dk-row" href="#notes/${encodeURIComponent(d.id)}"><span class="dk-row-t">${escapeHtml(d.path)}<br><span class="muted">${day(d.at)}</span></span></a>`).join('') : '<p class="dk-sub muted">还没有。</p>'}</section>`;
      return;
    }
    if (host.dataset.open === cur.id && host.dataset.v === String(cur.v || 0)) return;
    host.dataset.open = cur.id;
    host.dataset.v = String(cur.v || 0);
    host.innerHTML = `<div class="dk-unit-bar"><a class="btn btn-sm" href="#notes">← 笔记</a><span class="muted">${escapeHtml(cur.path)}</span></div><article class="la-lesson dk-note-body"></article>`;
    if (!sinkSet && store) {
      // 作答照常记成证据（session: 'note'，不属于哪节课；掌握、报告这一轮不算它）
      session.sink = createSink({ ...store, db }, { evidence: () => ({ session: 'note', block: null }) });
      sinkSet = true;
    }
    try { renderLesson(String(cur.text || ''), host.querySelector('.dk-note-body')); } catch (err) { reportError(err, { what: '画笔记', path: cur.path }); }
  }

  // —— 管理 → Claude 改过的（journal）：最近 50 条，看前后、一条一条撤销；撤销本身也记一条 ——
  async function paintJournal() {
    const body = $('.dk-journal .dk-body');
    if (!body) return;
    let rows = [];
    try { rows = (await db.collection('journal').get()).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 50); } catch { rows = []; }
    const short = (v) => escapeHtml(JSON.stringify(v ?? null).slice(0, 300));
    body.innerHTML = rows.length ? rows.map((j) => `<details class="dk-fold dk-jrow"><summary><span class="dk-row-t">${escapeHtml(j.path)} · ${escapeHtml(j.op)}<br><span class="muted">${day(j.at)} ${escapeHtml(BY[j.by] || j.by || '')}${j.undid ? ' · 已撤销' : ''}</span></span></summary><p class="muted">改之前：${short(j.before)}</p><p class="muted">改之后：${short(j.after)}</p>${j.undid ? '' : `<button type="button" class="btn dk-jundo" data-id="${escapeHtml(j.id)}">撤销这一条</button>`}</details>`).join('') : '<p class="muted">还没有。Claude 改了学习台里的东西，会一条条列在这里。</p>';
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('.dk-jundo');
        if (!b) return;
        const j = (await db.doc(`journal/${b.dataset.id}`).get()).data();
        const u = undoJournal(j);
        if (!u) return;
        const now = await db.doc(u.path).get().then((x) => (x.exists ? x.data() : null)).catch(() => null);
        // 后来又被改过（比如练一练写了复现组的结果）：撤销会把后来的也盖掉，先说清楚
        const later = changedSince(j, now) ? '\n这一条后来又被改过，撤销会把后来的改动也一起盖掉。' : '';
        if (!await ask(`撤销对「${j.path}」的这一次改动？会写回改之前的样子。${later}`, { ok: '撤销', ...(later ? { danger: true } : {}) })) return;
        try {
          if (u.op === 'delete') await db.doc(u.path).delete(); else await db.doc(u.path).set(u.data);
          const at = Date.now();
          await db.doc(`journal/${journalId(at)}`).set({ at, by: 'me', path: u.path, op: `undo-${j.op}`, before: now, after: u.op === 'delete' ? null : u.data });
          await db.doc(`journal/${b.dataset.id}`).set({ ...j, undid: at });
          toast('撤销了');
          paintJournal();
        } catch (err) { reportError(err, { what: '撤销 Claude 的改动' }); toast('没撤销成，再试一次'); }
      });
    }
  }

  // —— 管理 → 给开发的（dev_requests）：项目 Claude 记下的、要改页面代码的事；开发那边开工先读，学生能删 ——
  function paintDev() {
    const body = $('.dk-dev .dk-body');
    if (!body) return;
    const rows = [...(getData()?.dev_requests || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
    body.innerHTML = rows.length ? rows.map((r) => `<div class="dk-row"><span class="dk-row-t">${escapeHtml(r.text || '')}${r.quote ? `<br><span class="muted">你说：${escapeHtml(r.quote)}</span>` : ''}<br><span class="muted">${day(r.at)} ${escapeHtml(BY[r.by] || r.by || '')}${r.status === 'done' ? ' · 做好了' : r.status === 'design' ? ' · 设计稿，等你和主讲审' : ''}</span></span><button type="button" class="btn btn-sm dk-devdel" data-id="${escapeHtml(r.id)}">删掉</button></div>`).join('') : '<p class="muted">还没有。你在对话里让改、要改页面代码才做得到的事，Claude 会记在这里。</p>';
    if (body.dataset.wired) return;
    body.dataset.wired = '1';
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('.dk-devdel');
      if (!b || !await ask('删掉这一条？', { ok: '删掉' })) return;
      try {
        const ref = db.doc(`dev_requests/${b.dataset.id}`);
        const before = await ref.get().then((x) => (x.exists ? x.data() : null));
        await ref.delete();
        const at = Date.now();
        await db.doc(`journal/${journalId(at)}`).set({ at, by: 'me', path: `dev_requests/${b.dataset.id}`, op: 'delete', before, after: null });
      } catch (err) { reportError(err, { what: '删给开发的' }); toast('没删成，再试一次'); }
    });
  }

  return {
    paintDev,
    paintManage() { paintInstr(); wireNotes(); paintNotes(); paintJournal(); paintDev(); },
    paintPage,
    instructions: () => instr,
    dir: () => notebookDir(getData()?.notebook || []),
  };
}
