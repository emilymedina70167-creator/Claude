// 首页「记书上的题」（dr-batch4 第 2 条）的表单：选书 / 篇 / 科、章、题号（一次多题），每题点 对 / 错 / 拿不准 / 没做出，
// 可附照片（附在错的、没做出的那几道上；都对就附在全部上）、写一句话、可选挂到某一块。贴图照「补记」那一套（manual.js）。
// 写库在 desk.js（onSave），这里只管画和收。纯函数在 bookq.js。
import { escapeHtml } from '../render.js';
import { clipboardImages, htmlImageSrcs, toPng, srcToPng } from '../class/bar.js';
import { BOOK_VERDICTS, parseNos, bookList, newBook, bookLabel } from './bookq.js';
import { plainTitle } from './views.js';

const MAX_UP = 4;
const opt = (v, label = v) => `<option value="${escapeHtml(v)}">${escapeHtml(label)}</option>`;

/**
 * box：放表单的元素；books()：学生加过的书；blocks()：可挂的块；images：能不能存图；
 * onSave({ items: [{ book, verdict }], text, blobs, block })；onAddBook(book)：存一本新书
 */
export function createBookForm(box, { books = () => [], blocks = () => [], images = true, onSave, onAddBook }) {
  box.innerHTML = `
    <div class="dk-mform dk-bform">
      <div class="dk-mrow">
        <label class="dk-mblock"><span class="dk-k">书</span><select class="dk-bbook" aria-label="哪本书"></select></label>
        <label class="dk-mblock"><span class="dk-k">篇</span><select class="dk-bpart" aria-label="哪一篇"></select></label>
        <label class="dk-mblock"><span class="dk-k">科</span><select class="dk-bsubj" aria-label="哪一科"></select></label>
      </div>
      <div class="dk-mrow">
        <label class="dk-mblock"><span class="dk-k">第几章</span><input class="dk-bch" inputmode="numeric" pattern="[0-9]*" placeholder="2" aria-label="第几章"></label>
        <label class="dk-mblock dk-bnos-l"><span class="dk-k">题号</span><input class="dk-bnos" inputmode="numeric" placeholder="3, 5, 7-9" aria-label="题号"></label>
      </div>
      <div class="dk-blist"></div>
      <textarea class="dk-mtext" rows="2" placeholder="一句话（可空）：错在哪、卡在哪" aria-label="一句话"></textarea>
      ${images ? `<div class="dk-mshot">
        <div class="dk-mzone cb-paste-zone" contenteditable="true" data-hint="在这里长按，粘贴照片（附在错的那几道上）" aria-label="粘贴照片"></div>
        <button type="button" class="btn dk-mpick">选图</button>
        <input type="file" class="dk-mfile" accept="image/*" multiple hidden>
      </div>
      <div class="dk-mthumbs" hidden></div>` : ''}
      <div class="dk-mrow"><label class="dk-mblock"><span class="dk-k">挂到</span><select class="dk-bblock" aria-label="挂到哪一块"></select></label></div>
      <details class="dk-badd"><summary>加一本书</summary>
        <div class="dk-mrow"><input class="dk-bnt" placeholder="书名" aria-label="书名"><input class="dk-bnp" placeholder="篇（逗号隔开，可空）" aria-label="篇"><input class="dk-bns" placeholder="科（可空）" aria-label="科"><button type="button" class="btn dk-bnadd">加上</button></div>
      </details>
      <div class="dk-mrow dk-mfoot"><span class="dk-mnote muted" role="status"></span><button type="button" class="btn btn-primary dk-bsave" disabled>记下来</button></div>
    </div>`;
  const $ = (s) => box.querySelector(s);
  const selBook = $('.dk-bbook'), selPart = $('.dk-bpart'), selSubj = $('.dk-bsubj'), selBlock = $('.dk-bblock');
  const chIn = $('.dk-bch'), nosIn = $('.dk-bnos'), list = $('.dk-blist'), ta = $('.dk-mtext'), save = $('.dk-bsave'), note = $('.dk-mnote');
  const zone = $('.dk-mzone'), thumbs = $('.dk-mthumbs');
  let picked = [];
  let verdicts = new Map(); // 题号 → right / wrong / unsure / stuck
  let nos = [];
  let busy = false;
  const say = (msg, warn = false) => { note.textContent = msg; note.classList.toggle('is-warn', warn); };

  function fillBooks(keep = selBook.value) {
    const all = bookList(books());
    selBook.innerHTML = all.map((b, i) => opt(String(i), b.title)).join('');
    const i = all.findIndex((b) => b.title === keep);
    selBook.value = String(i >= 0 ? i : 0);
    fillParts();
  }
  function cur() { return bookList(books())[Number(selBook.value) || 0] || bookList()[0]; }
  function fillParts() {
    const b = cur();
    selPart.innerHTML = b.parts.length ? b.parts.map((p) => opt(p)).join('') : opt('', '（不分篇）');
    selSubj.innerHTML = b.subjects.length ? b.subjects.map((p) => opt(p)).join('') : opt('', '（不分科）');
    if (b.subjects.includes('线代')) selSubj.value = '线代';
  }
  function fillBlocks() {
    const keep = selBlock.value;
    const l = blocks();
    selBlock.innerHTML = `<option value="">不挂（等外部归块）</option>${l.map((b) => opt(b.id, plainTitle(b.title).slice(0, 30) || b.id)).join('')}`;
    if (l.some((b) => b.id === keep)) selBlock.value = keep;
  }
  fillBooks();
  fillBlocks();
  selBook.addEventListener('change', () => fillParts());

  function renderList() {
    try { nos = nosIn.value.trim() ? parseNos(nosIn.value) : []; say(''); } catch (e) { nos = []; say(e.message, true); }
    for (const k of [...verdicts.keys()]) if (!nos.includes(k)) verdicts.delete(k);
    list.innerHTML = nos.map((n) => `<div class="dk-brow" data-no="${n}"><b>第 ${n} 题</b><span class="dk-mverdict" role="group" aria-label="第 ${n} 题的结果">${Object.entries(BOOK_VERDICTS).map(([k, v]) => `<button type="button" class="btn dk-mv" data-v="${k}" aria-pressed="${verdicts.get(n) === k}">${v.label}</button>`).join('')}</span></div>`).join('');
    sync();
  }
  const sync = () => { save.disabled = busy || !nos.length || nos.some((n) => !verdicts.get(n)) || !(Number(chIn.value) > 0); };
  nosIn.addEventListener('input', renderList);
  chIn.addEventListener('input', sync);
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.dk-mv');
    if (!b) return;
    const n = Number(b.closest('.dk-brow').dataset.no);
    verdicts.set(n, b.dataset.v);
    b.closest('.dk-mverdict').querySelectorAll('.dk-mv').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    sync();
  });

  function renderPicked() {
    if (!thumbs) return;
    thumbs.hidden = !picked.length;
    thumbs.innerHTML = picked.map((p, i) => `<figure class="cb-thumb"><img src="${p.url}" alt="第 ${i + 1} 张"><button type="button" class="cb-unattach" data-i="${i}" aria-label="去掉第 ${i + 1} 张">×</button></figure>`).join('');
  }
  async function take(files) {
    const room = MAX_UP - picked.length;
    if (room <= 0) { say(`一次最多 ${MAX_UP} 张`, true); return; }
    const out = [];
    for (const f of [...files].slice(0, room)) { try { out.push(await (typeof f === 'string' ? srcToPng(f) : toPng(f))); } catch { /* 读不出来的跳过 */ } }
    if (!out.length) { say('这张图读不出来，换成系统截图「拷贝并删除」再粘贴试试', true); return; }
    picked = [...picked, ...out.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))];
    renderPicked();
  }
  if (zone) {
    const file = $('.dk-mfile');
    $('.dk-mpick').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => { await take(file.files || []); file.value = ''; });
    // 和补记一样：剪贴板里有图片文件就直接拿；没有就不拦，等浏览器把图插进框里再从框里取（Notability 的坑）
    zone.addEventListener('paste', (e) => {
      const files = clipboardImages(e.clipboardData);
      const srcs = files.length ? [] : htmlImageSrcs(e.clipboardData?.getData?.('text/html'));
      if (!files.length && !srcs.length) return;
      e.preventDefault();
      take(files.length ? files : srcs);
    });
    zone.addEventListener('beforeinput', (e) => { if (!/^insertFrom(Paste|Drop)/.test(e.inputType || '')) e.preventDefault(); });
    zone.addEventListener('input', async () => {
      const srcs = [...zone.querySelectorAll('img')].map((n) => n.src).filter(Boolean);
      zone.innerHTML = '';
      if (srcs.length) await take(srcs);
    });
    thumbs.addEventListener('click', (e) => {
      const b = e.target.closest('.cb-unattach');
      if (!b) return;
      const [gone] = picked.splice(Number(b.dataset.i), 1);
      if (gone) URL.revokeObjectURL(gone.url);
      renderPicked();
    });
  }

  $('.dk-bnadd').addEventListener('click', async () => {
    try {
      const b = newBook({ title: $('.dk-bnt').value, parts: $('.dk-bnp').value, subjects: $('.dk-bns').value });
      await onAddBook?.(b);
      ['.dk-bnt', '.dk-bnp', '.dk-bns'].forEach((s) => { $(s).value = ''; });
      fillBooks(b.title);
      say(`加上了：${b.title}`);
    } catch (e) { say(e?.message || '没加上', true); }
  });

  save.addEventListener('click', async () => {
    if (busy || save.disabled) return;
    busy = true;
    sync();
    save.textContent = '正在记…';
    const b = cur();
    const base = { title: b.title, ...(selPart.value ? { part: selPart.value } : {}), ...(selSubj.value ? { subject: selSubj.value } : {}), ch: Number(chIn.value) };
    try {
      const items = nos.map((no) => ({ book: { ...base, no }, verdict: verdicts.get(no) }));
      const r = await onSave({ items, text: ta.value.trim(), blobs: picked.map((p) => p.blob), block: selBlock.value || null });
      picked.forEach((p) => setTimeout(() => URL.revokeObjectURL(p.url), 1000));
      picked = [];
      renderPicked();
      verdicts = new Map();
      nosIn.value = '';
      ta.value = '';
      renderList();
      say(`记下了 ${items.length} 道（${bookLabel({ ...base })}）${r?.errors ? `，${r.errors} 道进了错题本` : ''}${r?.notes?.length ? `；${r.notes.join('；')}` : ''}`);
    } catch (err) {
      say(err?.message || '没记上，再试一次', true);
    } finally {
      busy = false;
      save.textContent = '记下来';
      sync();
    }
  });
  return { refreshBlocks: fillBlocks, refreshBooks: () => fillBooks() };
}
