// 「管理 → 记忆摘要」（第十三轮，docs/superpowers/specs/2026-11-16-mirror-design.md 6.1）：四份摘要全文给学生看，
// 能直接改、看上一版、退回上一版；还没并进去的新笔记列在下面，能删。照 claude.ai 的记忆：学生看得到老师脑子里对自己的了解，不对就改。
import { escapeHtml } from '../render.js';
import { ask } from '../dialog.js';
import { toast } from '../record.js';
import { SUMMARY_IDS, maxOf, spaceName, utf8 } from './summary.js';
import { toDate } from './schema.js';

const BY = { page: '课后页面重写的', me: '我改的', chat: '开发那边写的', class: '课上记的', head: '班主任记的', lab: '课后补写的' };
const day = (at) => (at ? toDate(Number(at)).slice(5) : '');
const chars = (bytes) => Math.round(bytes / 3);

/** sum：summarydesk.js 的那一层；host()：放它的那张卡（里面要有 .dk-body） */
export function createSummaryView({ sum, host }) {
  let wired = null;

  const head = (d) => (d?.v ? `第 ${d.v} 版${d.at ? ` · ${day(d.at)}` : ''}${BY[d.by] ? ` · ${BY[d.by]}` : ''}` : '还没有');
  const notesHtml = (d) => {
    const notes = d?.notes || [];
    if (!notes.length) return '';
    return `<details class="sm-notes" open><summary>还没并进去的新笔记 ${notes.length} 条</summary><ul>${notes.map((n) => `<li><span>${escapeHtml(n.text)}${n.quote ? `<span class="muted">　原话「${escapeHtml(n.quote)}」</span>` : ''}<span class="muted">　${day(n.at)}${BY[n.by] ? ` ${BY[n.by]}` : ''}</span></span><button type="button" class="btn sm-drop" data-at="${Number(n.at) || 0}" aria-label="删掉这条笔记">删</button></li>`).join('')}</ul></details>`;
  };
  const docHtml = (id, d) => `<div class="sm-doc" data-id="${id}">
      <div class="sm-head"><b>${escapeHtml(spaceName(id))}</b><span class="muted sm-meta">${escapeHtml(head(d))}</span></div>
      <textarea class="sm-text" rows="6" spellcheck="false" aria-label="${escapeHtml(spaceName(id))}的记忆摘要" placeholder="还没有。上完一节课以后页面会写；你也可以自己先写几句。"></textarea>
      <div class="sm-foot"><span class="muted sm-size"></span><span class="sm-btns"><button type="button" class="btn btn-primary sm-save" disabled>存</button><button type="button" class="btn sm-prev" hidden>看上一版</button><button type="button" class="btn sm-back" hidden>退回上一版</button></span></div>
      <div class="sm-old" hidden></div>
      <div class="sm-notes-slot"></div>
    </div>`;

  function fit(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, 560)}px`; }
  function sync(box) {
    const id = box.dataset.id;
    const ta = box.querySelector('.sm-text');
    const n = utf8(ta.value.trim());
    const over = n > maxOf(id);
    box.querySelector('.sm-size').textContent = `${chars(n)} / ${chars(maxOf(id))} 字${over ? '（太长了）' : ''}`;
    box.querySelector('.sm-size').classList.toggle('is-over', over);
    box.querySelector('.sm-save').disabled = over || ta.value.trim() === (ta.dataset.saved || '');
  }

  function paint() {
    const root = host();
    const body = root?.querySelector('.dk-body');
    if (!body) return;
    if (wired !== body) {
      body.innerHTML = `<p class="dk-sub muted">上课的老师每一轮带着「三科共用」和那一科的这一份，当背景了解你；每节课后页面会把它重写一遍。哪里不对直接改。</p>${SUMMARY_IDS.map((id) => docHtml(id, null)).join('')}`;
      wire(body);
      wired = body;
    }
    const docs = sum.docs();
    for (const id of SUMMARY_IDS) {
      const box = body.querySelector(`.sm-doc[data-id="${id}"]`);
      const d = docs[id];
      const ta = box.querySelector('.sm-text');
      const text = String(d?.text || '').trim();
      // 学生正在改这一份（有没存的字）：不盖掉，只换别的
      if (ta.value.trim() === (ta.dataset.saved || '') || ta.dataset.saved === undefined) { ta.value = text; ta.dataset.saved = text; fit(ta); }
      box.querySelector('.sm-meta').textContent = head(d);
      const has = !!d?.history?.length;
      box.querySelector('.sm-prev').hidden = !has;
      box.querySelector('.sm-back').hidden = !has;
      box.querySelector('.sm-notes-slot').innerHTML = notesHtml(d);
      sync(box);
    }
  }

  function wire(body) {
    body.addEventListener('input', (e) => { const box = e.target.closest?.('.sm-doc'); if (box && e.target.matches('.sm-text')) { fit(e.target); sync(box); } });
    body.addEventListener('click', async (e) => {
      const box = e.target.closest?.('.sm-doc');
      if (!box) return;
      const id = box.dataset.id;
      const ta = box.querySelector('.sm-text');
      try {
        if (e.target.closest('.sm-save')) {
          e.target.disabled = true;
          await sum.save(id, ta.value);
          ta.dataset.saved = ta.value.trim();
          toast('存好了，下一节课的老师就带着这一版');
          paint();
        } else if (e.target.closest('.sm-prev')) {
          const old = box.querySelector('.sm-old');
          const prev = sum.docs()[id]?.history?.[0];
          old.hidden = !old.hidden;
          if (!old.hidden && prev) old.innerHTML = `<p class="muted">上一版（第 ${prev.v} 版${prev.at ? `，${day(prev.at)}` : ''}${BY[prev.by] ? `，${BY[prev.by]}` : ''}）</p><pre>${escapeHtml(prev.text)}</pre>`;
        } else if (e.target.closest('.sm-back')) {
          if (!(await ask(`把「${spaceName(id)}」退回上一版？现在这一版会留着，还能再退回来。`, { ok: '退回' }))) return;
          await sum.back(id);
          delete ta.dataset.saved;
          box.querySelector('.sm-old').hidden = true;
          paint();
        } else if (e.target.closest('.sm-drop')) {
          await sum.dropNote(id, Number(e.target.closest('.sm-drop').dataset.at));
          paint();
        }
      } catch (err) {
        toast(err?.message || '没存成，再试一次');
        sync(box);
      }
    });
  }

  return { paint };
}
