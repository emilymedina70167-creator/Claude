// 学习台的「教材」页（#books、#books/B1）：导入资料（PDF、截图、Word 文稿、PowerPoint 讲义）、看转写进度、
// 一条条对着原页图核对、改字、重转某几页、挂到课程地图（plan.js）。数据在 books/…（importer.js 写）。
import { mdToHtml, escapeHtml } from '../render.js';
import { toast } from '../record.js';
import { assetUrl } from '../live/store.js';
import { createImporter, kindOfFile, FILE_KINDS } from './importer.js';
import { nextBookCode, PAGES_PER_CALL } from './ingest.js';
import { openPdf } from './pdf.js';
import { BOOK_KINDS, chunkLine } from './textbook.js';
import { SPACES } from '../memory/space.js';

const esc = escapeHtml;
const md = (s) => { try { return mdToHtml(String(s ?? '')); } catch { return `<pre>${esc(String(s ?? ''))}</pre>`; } };
const docsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const STATUS = { importing: '正在导入', partial: '没转完', ready: '转好了' };

/**
 * host：放页面的元素；db、assets：学习台的；getAI()：取页面里的 Claude；space()：现在看着哪一科；model：转写用的模型；
 * plan：plan.js 的「挂到课程地图」（第 3 批，可以不给）
 */
export function createBooksView(host, { db, assets, getAI, space, model, plan = null }) {
  let route = '';
  let books = [];
  let picked = []; // 选好、还没开始导入的文件
  let progress = null; // { book, stage, done, total, msg }
  let importer = null;
  const chunksCache = new Map(); // 书号 → 条目（详情页读过的）
  const pagesCache = new Map();
  const open = new Set();
  let editing = null;
  let pdfPages = null; // 选好的 PDF 有几页（估算调用次数）

  db.collection('books').onSnapshot((s) => { books = docsOf(s); if (route) paint(); }, () => {});
  host.addEventListener('click', onClick);
  host.addEventListener('change', onChange);
  host.addEventListener('input', (e) => { if (e.target.matches('.bk-form input[name=from], .bk-form input[name=to]')) paintCost(); });

  async function getImporter() {
    if (importer) return importer;
    const ai = await getAI();
    if (!ai?.images) throw new Error('这个学习台现在不能把图片交给 Claude（发布时要声明 sample 的 images），转写不了扫描页');
    importer = createImporter({ db, assets, ai, model, onProgress: (p) => { progress = p; if (p.stage === 'done') { chunksCache.delete(p.book); pagesCache.delete(p.book); } paintProgress(); } });
    return importer;
  }

  function show(r) { route = r; paint(); }
  function paint() {
    if (host.contains(document.activeElement) && document.activeElement.matches('textarea, input[type="text"], input[type="number"]')) return;
    const [, arg] = route.split('/');
    const y = window.scrollY;
    host.innerHTML = arg ? bookPage(arg) : listPage();
    window.scrollTo(0, y);
    if (arg) loadBook(arg);
  }
  function paintProgress() {
    const el = host.querySelector('.bk-progress');
    if (el) el.outerHTML = progressHtml();
    else if (route) paint();
  }
  const progressHtml = () => {
    if (!progress) return '<div class="bk-progress" hidden></div>';
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    const running = !!importer?.busy;
    // 转完了：只留一行结果，不留进度条
    if (!running && progress.stage === 'done') return `<div class="bk-progress" role="status"><p class="dk-ok">${esc(progress.book || '')} ${esc(progress.msg || '')}</p></div>`;
    return `<div class="bk-progress" role="status"><div class="bk-bar"><i style="width:${pct}%"></i></div><p><b>${esc(progress.book || '')}</b> ${esc(progress.msg || '')}</p>${running ? '<button type="button" class="btn btn-sm bk-stop">停下（转好的会留着）</button>' : ''}</div>`;
  };

  /* —— 列表：导入 + 这一科的书 —— */
  function listPage() {
    const sp = space();
    const mine = books.filter((b) => !b.space || b.space === sp).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    return `<section class="dk-card"><h2 class="dk-h">导入资料</h2>
        <p class="dk-sub muted">教材 PDF（扫描版也行）、截图和照片、视频课文稿（Word）、讲义（PowerPoint）。扫描页由 Claude 看图转写成文字，公式写成 LaTeX，每页的原图留着核对；文稿和讲义里的字页面自己取，不花额度。转写好的资料按「一条一条」存（定义、定理、例题……），上课时 Claude 只取要用的那几条。</p>
        <label class="btn bk-pick">选文件<input type="file" class="bk-file" multiple accept=".pdf,.docx,.pptx,image/*" hidden></label>
        ${picked.length ? pickForm() : ''}
        ${progressHtml()}
      </section>
      <section class="dk-card"><h2 class="dk-h">${esc(SPACES[sp]?.label || '')}的资料</h2>
        ${mine.length ? mine.map((b) => `<a class="dk-class-row bk-row" href="#books/${esc(b.id)}">
            <span class="dk-cr-d"><b>${esc(b.id)}</b><span class="muted">${esc(BOOK_KINDS[b.kind] || b.kind || '')}</span></span>
            <span class="dk-cr-m">${esc(b.title || '')}<br><span class="muted">${b.chunks ? `${b.chunks} 条` : '还没有条目'}${b.pagesDone ? ` · 转好 ${b.pagesDone} 页` : ''}${b.pagesLeft ? ` · 还有 ${b.pagesLeft} 页没转` : ''}${b.cost?.calls ? ` · 调用 ${b.cost.calls} 次` : ''}</span></span>
            <span class="dk-cr-n"><span class="dk-tag ${b.status === 'ready' ? 'is-ok' : 'is-warn'}">${esc(STATUS[b.status] || b.status || '')}</span></span>
          </a>`).join('') : '<p class="muted">还没有资料。</p>'}
      </section>`;
  }

  function pickForm() {
    const sp = space();
    const first = picked[0];
    const kind = kindOfFile(first);
    const images = picked.every((f) => kindOfFile(f) === 'notes');
    const mine = books.filter((b) => !b.space || b.space === sp);
    const title = images ? '' : first.name.replace(/\.[^.]+$/, '');
    return `<form class="bk-form dk-mform">
        <p class="muted">选了 ${picked.length} 个文件：${esc(picked.slice(0, 4).map((f) => f.name).join('、'))}${picked.length > 4 ? '……' : ''}</p>
        ${images ? `<label class="mm-f"><span>加到哪本书</span><select name="book"><option value="">新的一本</option>${mine.map((b) => `<option value="${esc(b.id)}">${esc(b.id)} ${esc(b.title || '')}</option>`).join('')}</select></label>
          <label class="mm-f"><span>第一张是第几页（照书上的页码排，以后核对好找）</span><input type="number" name="start" min="1" value="1" inputmode="numeric"></label>` : ''}
        <label class="mm-f"><span>名字（书名、这一讲的名字）</span><input type="text" name="title" value="${esc(title)}" placeholder="比如：张宇 线代基础30讲"></label>
        ${sp === 'cs' ? `<label class="mm-f"><span>哪门课</span><select name="subject">${['数据结构', '操作系统', '组成原理', '计网'].map((x) => `<option>${x}</option>`).join('')}</select></label>` : ''}
        <label class="mm-f"><span>是什么</span><select name="kind">${Object.entries(BOOK_KINDS).map(([k, v]) => `<option value="${k}"${k === (images ? 'textbook' : kind) ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        ${/\.pdf$/i.test(first.name) && picked.length === 1 ? `<div class="dk-mrow"><label class="mm-f"><span>从第几页</span><input type="number" name="from" min="1" placeholder="1" inputmode="numeric"></label><label class="mm-f"><span>到第几页（空着就是到最后）</span><input type="number" name="to" min="1" placeholder="最后" inputmode="numeric"></label></div>
          <p class="muted bk-cost">${costText()}</p>` : ''}
        <p class="muted">放在「${esc(SPACES[sp]?.label || sp)}」。</p>
        <div class="dk-mrow dk-mfoot"><button type="button" class="btn bk-cancel">算了</button><button type="submit" class="btn btn-primary bk-go">开始导入</button></div>
      </form>`;
  }

  // 估算：扫描页每 PAGES_PER_CALL 页一次调用（每页一张图，约一两千 token，加上转出来的字）
  function costText(from = null, to = null) {
    const n = pdfPages ? Math.max(0, Math.min(pdfPages, to || pdfPages) - Math.max(1, from || 1) + 1) : null;
    return n === null ? `扫描页每 ${PAGES_PER_CALL} 页一次调用。整本几百页要几十次，花的额度不少：可以先转这一讲要用的几十页，以后再接着转别的页。`
      : `这个 PDF 一共 ${pdfPages} 页。转 ${n} 页约 ${Math.ceil(n / PAGES_PER_CALL)} 次调用（每次 ${PAGES_PER_CALL} 页），每页约两三千 token（图 + 转出来的字）。可以先转这一讲要用的几十页，以后再接着转。`;
  }
  function paintCost() {
    const f = host.querySelector('.bk-form');
    const el = f?.querySelector('.bk-cost');
    if (el) el.textContent = costText(Number(f.querySelector('[name=from]')?.value) || null, Number(f.querySelector('[name=to]')?.value) || null);
  }

  /* —— 一本书：目录、条目对着原页核对、页的状态 —— */
  function bookPage(id) {
    const b = books.find((x) => x.id === id);
    if (!b) return `<p class="muted">没有 ${esc(id)} 这本。</p><p><a class="dk-link" href="#books">← 资料</a></p>`;
    const chunks = chunksCache.get(id);
    const pages = pagesCache.get(id) || [];
    const bad = pages.filter((p) => p.status !== 'done');
    const checked = chunks ? chunks.filter((c) => c.checked).length : 0;
    return `<p><a class="dk-link" href="#books">← 资料</a></p>
      <section class="dk-card"><h2 class="dk-h">${esc(b.id)} ${esc(b.title || '')}</h2>
        <p class="muted">${esc(BOOK_KINDS[b.kind] || '')} · ${esc(STATUS[b.status] || '')}${b.chunks ? ` · ${b.chunks} 条` : ''}${chunks ? ` · 核对过 ${checked} 条` : ''}${b.pagesDone ? ` · 转好 ${b.pagesDone} 页` : ''}${b.cost?.calls ? ` · 调用 ${b.cost.calls} 次` : ''}</p>
        <div class="mm-acts">
          ${bad.length ? `<button type="button" class="btn btn-primary bk-resume" data-book="${esc(id)}">接着转（${bad.length} 页）</button>` : ''}
          ${plan ? `<button type="button" class="btn bk-plan" data-book="${esc(id)}">挂到课程地图</button>` : ''}
          <button type="button" class="btn bk-del" data-book="${esc(id)}">删掉这本</button>
        </div>
        ${progressHtml()}
        <div class="bk-plan-host"></div>
      </section>
      ${bad.length ? `<section class="dk-card"><h2 class="dk-h">没转好的页</h2><div class="bk-pages">${bad.map((p) => `<span class="dk-tag is-warn" title="${esc(p.err || '')}">第 ${p.n} 页${p.status === 'error' ? '（出错）' : ''}</span>`).join(' ')}</div></section>` : ''}
      <section class="dk-card"><h2 class="dk-h">条目</h2>
        ${!chunks ? '<p class="muted">正在读…</p>' : !chunks.length ? '<p class="muted">还没有条目。</p>' : chunkList(b, chunks)}
      </section>`;
  }

  function chunkList(b, chunks) {
    let ch = null;
    let sec = null;
    const out = [];
    for (const c of chunks) {
      if (c.chapter !== ch) { ch = c.chapter; sec = null; if (ch) out.push(`<div class="dk-sec-h">${esc(ch)}</div>`); }
      if (c.section !== sec) { sec = c.section; if (sec) out.push(`<div class="bk-sec muted">${esc(sec)}</div>`); }
      const isOpen = open.has(c.id);
      out.push(`<div class="bk-chunk${c.checked ? ' is-checked' : ''}" data-id="${esc(c.id)}">
          <button type="button" class="dk-blk-row bk-toggle" aria-expanded="${isOpen}"><span>${esc(chunkLine(c))}</span>${c.checked ? '<span class="dk-tag is-ok">核对过</span>' : ''}${c.fixed ? '<span class="dk-tag">改过</span>' : ''}</button>
          ${isOpen ? `<div class="bk-body">
            <div class="bk-text">${editing === c.id ? `<textarea class="dk-mtext bk-edit" rows="10">${esc(c.text)}</textarea>` : md(c.text)}</div>
            ${(c.img || []).length ? `<div class="bk-imgs">${c.img.map((id) => `<a href="${esc(assetUrl(id))}" target="_blank" rel="noopener"><img class="bk-img" src="${esc(assetUrl(id))}" alt="原页" loading="lazy"></a>`).join('')}</div>` : ''}
            <div class="mm-acts">
              ${editing === c.id ? '<button type="button" class="btn btn-primary bk-save">保存</button><button type="button" class="btn bk-unedit">算了</button>'
                : `<button type="button" class="btn btn-sm bk-check">${c.checked ? '取消核对' : '核对过了'}</button><button type="button" class="btn btn-sm bk-fix">改字</button>${(c.pages || []).length && (c.img || []).length ? `<button type="button" class="btn btn-sm bk-redo">重新转写第 ${esc(c.pages.join('、'))} 页</button>` : ''}`}
            </div></div>` : ''}
        </div>`);
    }
    return out.join('');
  }

  async function loadBook(id) {
    if (chunksCache.has(id)) return;
    chunksCache.set(id, null);
    const [chunks, pages] = await Promise.all([
      db.collection(`books/${id}/chunks`).get().then(docsOf, () => []),
      db.collection(`books/${id}/pages`).get().then(docsOf, () => []),
    ]);
    chunksCache.set(id, chunks.sort((a, b) => (a.seq || 0) - (b.seq || 0)));
    pagesCache.set(id, pages.sort((a, b) => a.n - b.n));
    if (route === `books/${id}`) paint();
  }

  function onChange(e) {
    if (e.target.matches('.bk-file')) {
      picked = [...(e.target.files || [])].filter((f) => kindOfFile(f));
      pdfPages = null;
      if (!picked.length) toast(`认得的有：${FILE_KINDS.map((k) => k.label).join('、')}`);
      paint();
      // PDF：先数一数有几页，算出要调用几次（花多少额度心里有数再开始）
      if (picked.length === 1 && /\.pdf$/i.test(picked[0].name)) {
        const f = picked[0];
        f.arrayBuffer().then(openPdf).then((doc) => { if (picked[0] === f) { pdfPages = doc.numPages; doc.destroy?.(); paintCost(); } }).catch(() => {});
      }
    }
  }

  async function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const card = b.closest('.bk-chunk');
    const id = card?.dataset.id;
    const bookId = route.split('/')[1];
    try {
      if (b.matches('.bk-cancel')) { picked = []; paint(); }
      else if (b.matches('.bk-go')) { e.preventDefault(); await startImport(b.closest('form')); }
      else if (b.matches('.bk-stop')) { importer?.stop(); toast('停下了：转好的页留着，下次点「接着转」'); }
      else if (b.matches('.bk-resume')) { const im = await getImporter(); run(() => im.transcribe(b.dataset.book)); }
      else if (b.matches('.bk-del')) await removeBook(b.dataset.book);
      else if (b.matches('.bk-plan')) plan?.open(host.querySelector('.bk-plan-host'), b.dataset.book);
      else if (b.matches('.bk-toggle')) { if (open.has(id)) open.delete(id); else open.add(id); paint(); }
      else if (b.matches('.bk-check')) await patch(bookId, id, (c) => ({ checked: !c.checked }));
      else if (b.matches('.bk-fix')) { editing = id; paint(); host.querySelector('.bk-edit')?.focus(); }
      else if (b.matches('.bk-unedit')) { editing = null; paint(); }
      else if (b.matches('.bk-save')) { const text = host.querySelector('.bk-edit').value; editing = null; await patch(bookId, id, () => ({ text, fixed: true, checked: true })); }
      else if (b.matches('.bk-redo')) {
        const c = chunksCache.get(bookId)?.find((x) => x.id === id);
        if (c?.fixed && !confirm('这一条你改过字，重新转写会盖掉改的。接着重转？')) return;
        if (c?.fixed) await patch(bookId, id, () => ({ fixed: false }));
        const im = await getImporter();
        run(() => im.transcribe(bookId, { pages: c.pages, force: true }));
      }
    } catch (err) {
      toast(`没成：${err?.message || err?.code || err}`);
    }
  }

  function run(job) {
    job().then(() => { chunksCache.clear(); pagesCache.clear(); paint(); }, (err) => { progress = { ...(progress || {}), msg: `停了：${err?.message || err?.code || err}` }; paint(); });
  }

  async function startImport(form) {
    const f = new FormData(form);
    const im = await getImporter();
    const sp = space();
    const images = picked.every((x) => kindOfFile(x) === 'notes');
    const book = (images && f.get('book')) || nextBookCode(books);
    const title = String(f.get('title') || '').trim() || books.find((x) => x.id === book)?.title || picked[0].name;
    const subject = String(f.get('subject') || '') || ({ math: '线代', en: '英语' })[sp] || '';
    const opts = { book, title, kind: String(f.get('kind') || ''), space: sp, subject, from: f.get('from'), to: f.get('to'), start: f.get('start') };
    const list = picked;
    picked = [];
    progress = { book, stage: 'read', msg: '开始…' };
    paint();
    run(async () => {
      if (images) await im.add(list[0], { ...opts, files: list });
      // 几个文件一起选：一个文件一本，编号往下排
      else {
        const used = [...books];
        for (let i = 0; i < list.length; i++) {
          const code = i ? nextBookCode(used) : book;
          used.push({ id: code });
          await im.add(list[i], { ...opts, book: code, title: i ? list[i].name.replace(/\.[^.]+$/, '') : title, kind: i ? kindOfFile(list[i]) : opts.kind });
        }
      }
      location.hash = `#books/${book}`;
    });
  }

  async function patch(book, id, fn) {
    const list = chunksCache.get(book) || [];
    const c = list.find((x) => x.id === id);
    if (!c) return;
    const next = { ...c, ...fn(c) };
    const rec = { ...next };
    delete rec.id;
    await db.doc(`books/${book}/chunks/${id}`).set(rec);
    Object.assign(c, next);
    paint();
  }

  async function removeBook(id) {
    const b = books.find((x) => x.id === id);
    if (!b || !confirm(`删掉 ${id}「${b.title || ''}」？条目、转写结果都删掉（原页图也删）。课程地图里挂着它的条目编号会失效。`)) return;
    const [chunks, pages] = await Promise.all([db.collection(`books/${id}/chunks`).get().then(docsOf), db.collection(`books/${id}/pages`).get().then(docsOf)]);
    for (const c of chunks) await db.doc(`books/${id}/chunks/${c.id}`).delete().catch(() => {});
    for (const p of pages) {
      for (const a of p.imgs || [p.img]) if (a) await assets?.delete?.(a).catch(() => {});
      await db.doc(`books/${id}/pages/${p.id}`).delete().catch(() => {});
    }
    await db.doc(`books/${id}`).delete();
    chunksCache.delete(id);
    location.hash = '#books';
  }

  return { show, refresh: () => { if (route) paint(); }, books: () => books };
}
