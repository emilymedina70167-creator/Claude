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

export { saveInstructions, shownNotes };

const BY = { me: '我改的', class: '课上的老师', head: '班主任', after: '课后那一轮', organize: '第一次整理', chat: '开发那边' };
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
      body.innerHTML = `<p class="dk-sub muted">每一轮原样给上课的老师和班主任，放在最前面。写什么由你定；空着就是没有。</p>
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
    const docs = (getData()?.notebook || []).filter((d) => d && d.path);
    const live = docs.filter((d) => !d.deleted).sort((a, b) => a.path.localeCompare(b.path));
    const gone = docs.filter((d) => d.deleted && !d.movedTo);
    const cur = live.find((d) => d.path === openPath);
    body.innerHTML = `<p class="dk-sub muted">上课的老师、班主任自己写的笔记（写什么、怎么分由它定）。标了 pin 的每一轮都整份带着，标了 show 的在「笔记」页里。你可以直接改、退回以前的版本。</p>
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
      host.innerHTML = `<section class="dk-card"><h2 class="dk-h">笔记</h2>${list.length ? list.map((d) => `<a class="dk-row" href="#notes/${encodeURIComponent(d.id)}"><span class="dk-row-t">${escapeHtml(d.path)}<br><span class="muted">${day(d.at)}</span></span></a>`).join('') : '<p class="dk-sub muted">还没有。上课的老师、班主任觉得该给你整理什么，会放在这里。</p>'}</section>`;
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

  return {
    paintManage() { paintInstr(); wireNotes(); paintNotes(); },
    paintPage,
    instructions: () => instr,
    dir: () => notebookDir(getData()?.notebook || []),
  };
}
