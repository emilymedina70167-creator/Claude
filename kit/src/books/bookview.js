// 学习台的「教材」页（#books、#books/B1）：导入资料（PDF、截图、Word 文稿、PowerPoint 讲义）、看转写进度、
// 一条条对着原页图核对、改字、重转某几页、挂到课程地图（plan.js）。数据在 books/…（importer.js 写）。
import { ask } from '../dialog.js';
import { mdToHtml, escapeHtml } from '../render.js';
import { toast } from '../record.js';
import { assetUrl } from '../live/store.js';
import { createImporter, kindOfFile, FILE_KINDS, TRANSCRIBE, TRANSCRIBE_HERE, modelName } from './importer.js';
import { nextBookCode, PAGES_PER_CALL, parseTranscription } from './ingest.js';
import { stashedFile } from './stash.js';
import { openPdf } from './pdf.js';
import { BOOK_KINDS, chunkLine } from './textbook.js';
import { SPACES } from '../memory/space.js';

const esc = escapeHtml;
const md = (s) => { try { return mdToHtml(String(s ?? '')); } catch { return `<pre>${esc(String(s ?? ''))}</pre>`; } };
const docsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const STATUS = { importing: '正在导入', partial: TRANSCRIBE_HERE ? '没转完' : '等转写', ready: '转好了' };
// 页码连成段：[82, 83, …, 412] → 「第 82–412 页」（等转写的页可能几百页，一页一个标签放不下）
export function pageRanges(nums = []) {
  const ns = [...new Set(nums.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(i === j ? `${ns[i]}` : `${ns[i]}–${ns[j]}`);
    i = j;
  }
  return out.length ? `第 ${out.join('、')} 页` : '';
}

/**
 * host：放页面的元素；db、assets：学习台的；getAI()：取页面里的 Claude；space()：现在看着哪一科；model：不用了（转写用 importer.js 的 TRANSCRIBE）；
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

  // Claude Code 转好的结果放在收件箱 book_inbox/{书-批}：{ book, pages: { 页码: items }, by, at }（每批一条新记录，它那边不用改已有的页、
  // 不用管版本号）。页面看到了就并进各页（status done），删掉这条，再把这本书拼一遍条目（rebuild 是纯代码，不调用 Claude）
  // 以前是一条一条串着做、一本书做完再做下一本，整个收件箱要把页面开着等几十分钟，中途关了页面就停在半路（书目还显示「等转写」）。
  // 现在：几本书同时做（同一本书里按记录编号的顺序，同一页有新旧两版时后写的盖在后面），一条记录里的各页同时写，
  // 一本书的记录做完马上拼条目（书目跟着变）；做的时候又来了新的快照不丢，做完再跑一遍；某一条出错不挡着后面的
  let inboxBusy = false;
  let inboxLatest = null;
  const inboxDone = new Set(); // 这次已经并进去、删掉的记录，旧快照里还有它也不重复做
  const needRebuild = new Set(); // 记录已经并进页、但条目还没拼成（拼的时候出错）的书，下一轮接着拼
  // 收件箱里每本书还有几批没并（书目、书页上写「正在并入转写，还剩 N 批」：以前并的时候什么都不显示，
  // 书一直写「等转写」，看着像没转；并完一整本才拼条目、书目才变）
  let inboxDocs = [];
  const rebuilding = new Set(); // 正在拼条目的书（几百页的书要拼一两分钟）
  const inboxLeft = (book) => inboxDocs.filter((d) => String(d.book || '') === book && !inboxDone.has(d.id)).length;
  // 并的时候屏幕别熄：iPad 熄屏页面就停，几百页的书要并几分钟（和存 PDF 时一样请求常亮）
  let inboxLock = null;
  const holdAwake = async () => { try { if (!inboxLock && document.visibilityState === 'visible') { inboxLock = await navigator.wakeLock?.request?.('screen'); inboxLock?.addEventListener?.('release', () => { inboxLock = null; }); } } catch { inboxLock = null; } };
  document.addEventListener('visibilitychange', () => { if (inboxBusy && document.visibilityState === 'visible') holdAwake(); });
  const letSleep = () => { try { inboxLock?.release?.(); } catch { /* */ } inboxLock = null; };
  const INBOX_BOOKS = 2; // 同时做几本书（一下子写得太多，数据库会限流，出错就停在半路，所以宁可慢一点）
  // 写数据库偶尔被限流或网络抖一下：歇一会儿再试（以前一出错整轮就停了，剩下的记录也没有人再去碰）
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function retry(fn, tries = 5) {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= tries - 1) throw e; await sleep(1200 * (i + 1)); }
    }
  }
  async function takeOne(d) {
    const book = String(d.book || '');
    // 项目对话里的 Claude（或别处）直接写转写原文：{ book, text: '=== 第 82 页\n--- 定义 | …', by }，这里读懂（和页面里转写同一个 parseTranscription），
    // 学习台里还没有的页照样建（原页图以后「存进学习台」时补）；读的结果写一条回执 book_inbox_log/{同一个 id}，它下次能查
    if (typeof d.text === 'string') {
      let log = { book, at: Date.now() };
      try {
        const { pages } = parseTranscription(d.text, []);
        d.pages = Object.fromEntries([...pages].map(([n, items]) => [n, items]));
        d.meta = { ...Object.fromEntries([...pages.keys()].map((n) => [n, {}])), ...(d.meta || {}) };
        const ns = [...pages.keys()].sort((a, b) => a - b);
        const gaps = [];
        for (let i = 1; i < ns.length; i++) for (let n = ns[i - 1] + 1; n < ns[i]; n++) gaps.push(n);
        log = { ...log, pages: ns, items: ns.reduce((s, n) => s + pages.get(n).length, 0), gaps, unclear: ns.filter((n) => pages.get(n).some((it) => /【看不清】/.test(it.text || ''))) };
      } catch (e) {
        d.pages = {};
        log = { ...log, error: String(e?.message || e) };
      }
      await retry(() => db.doc(`book_inbox_log/${d.id}`).set(log)).catch(() => {});
    }
    // 从仓库里的 PDF 转的：书、页在学习台里可能还没有，收件箱带着书的信息（info）和每页的原页图（meta）一起建
    if (d.info) {
      const bref = db.doc(`books/${book}`);
      const bs = await retry(() => bref.get());
      if (!bs.exists) await retry(() => bref.set({ ...d.info, status: 'importing', createdAt: Date.now(), at: Date.now() }));
      else if (d.info.pages && !bs.data().pages) await retry(() => bref.set({ ...bs.data(), pages: d.info.pages }));
    }
    let skipped = 0;
    await Promise.all(Object.entries(d.pages || {}).map(async ([n, items]) => {
      if (!Array.isArray(items)) return;
      const ref = db.doc(`books/${book}/pages/${n}`);
      const snap = await retry(() => ref.get());
      const m = d.meta?.[n];
      if (!snap.exists && !m) { skipped++; return; } // 这页还没存进学习台：这条记录留着，页存好以后再并（以前是直接删掉，转好的字就丢了）
      const base = snap.exists ? snap.data() : { n: Number(n), img: m.img || '', imgs: m.img ? [m.img] : [], layer: '', ...(m.size ? { size: m.size } : {}), ...(m.blank ? { blank: true } : {}) };
      if (m?.img && !base.img) Object.assign(base, { img: m.img, imgs: [m.img] });
      const rec = { ...base, items, status: 'done', err: '', by: m?.blank ? 'page' : d.by || '', via: 'claude-code', at: Date.now() };
      delete rec.redo;
      await retry(() => ref.set(rec));
    }));
    if (skipped) return 'skip';
    await retry(() => db.doc(`book_inbox/${d.id}`).delete());
    return 'ok';
  }
  async function takeInbox(docs) {
    inboxDocs = docs || [];
    if (route && !inboxBusy) paint();
    if (inboxBusy) { inboxLatest = docs; return; }
    if (!docs.length && !needRebuild.size) return;
    inboxBusy = true;
    holdAwake();
    let failed = false;
    try {
      let todo = docs;
      while (todo?.length || needRebuild.size) {
        const byBook = new Map();
        for (const d of todo || []) {
          const book = String(d.book || '');
          if (!/^B\d+$/.test(book) || inboxDone.has(d.id)) continue;
          if (!byBook.has(book)) byBook.set(book, []);
          byBook.get(book).push(d);
        }
        for (const b of needRebuild) if (!byBook.has(b)) byBook.set(b, []);
        const names = [...byBook.keys()];
        let next = 0;
        const worker = async () => {
          while (next < names.length) {
            const book = names[next++];
            if (byBook.get(book).length) await retry(() => db.doc(`books/${book}`).update({ needsRebuild: true }), 3).catch(() => {});
            for (const d of byBook.get(book).sort((x, y) => (x.id < y.id ? -1 : 1))) {
              try {
                const r = await takeOne(d);
                if (r === 'ok') { inboxDone.add(d.id); needRebuild.add(book); if (route) paint(); }
              } catch { failed = true; }
            }
            if (!needRebuild.has(book)) continue;
            rebuilding.add(book);
            if (route) paint();
            try {
              const im = await getImporter();
              await retry(() => im.rebuild(book), 3);
              needRebuild.delete(book);
            } catch { failed = true; }
            chunksCache.delete(book);
            pagesCache.delete(book);
            rebuilding.delete(book);
            if (route) paint();
          }
        };
        await Promise.all(Array.from({ length: Math.min(INBOX_BOOKS, names.length) }, worker));
        todo = inboxLatest;
        inboxLatest = null;
        if (!todo) break;
      }
    } finally {
      inboxBusy = false;
      letSleep();
      if (route) paint();
      // 有出错的（被限流、网络抖）：过一会儿重新读一遍收件箱接着做，不用等谁来碰一下
      if (failed) setTimeout(() => { db.collection('book_inbox').get().then((snap) => takeInbox(docsOf(snap)), () => {}); }, 10000);
    }
  }
  db.collection('book_inbox').onSnapshot((s) => takeInbox(docsOf(s)), () => {});
  // 上次并完了页、条目没拼完就关了页面（书上还记着 needsRebuild，收件箱已经空了）：打开时接着拼。
  // 已经写好的条目 writeChunks 会跳过，只补没写的
  db.collection('books').onSnapshot((s) => {
    books = docsOf(s);
    const left = books.filter((b) => b.needsRebuild && !inboxLeft(b.id) && !needRebuild.has(b.id) && !rebuilding.has(b.id));
    if (left.length) { for (const b of left) needRebuild.add(b.id); takeInbox(inboxDocs); }
    if (route) paint();
  }, () => {});
  host.addEventListener('click', onClick);
  host.addEventListener('change', onChange);
  host.addEventListener('input', (e) => { if (e.target.matches('.bk-form input[name=from], .bk-form input[name=to]')) paintCost(); });

  async function getImporter() {
    if (importer) return importer;
    const ai = TRANSCRIBE_HERE ? await getAI() : null; // 只存原页图、拼条目，用不着 Claude
    if (TRANSCRIBE_HERE && !ai?.images) throw new Error('这个学习台现在不能把图片交给 Claude（发布时要声明 sample 的 images），转写不了扫描页');
    importer = createImporter({ db, assets, ai, onProgress: (p) => { progress = p; if (p.stage === 'done') { chunksCache.delete(p.book); pagesCache.delete(p.book); } paintProgress(); } });
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
        <p class="dk-sub muted">教材 PDF（扫描版也行）、截图和照片、视频课文稿（Word）、讲义（PowerPoint）。${TRANSCRIBE_HERE ? '扫描页由 Claude 看图转写成文字' : '扫描页这里只存原页图（不花额度），存好以后回 Claude Code 说「转 B几」，它看图转写成文字写回来'}，公式写成 LaTeX，每页的原图留着核对；文稿和讲义里的字页面自己取，不花额度。转写好的资料按「一条一条」存（定义、定理、例题……），上课时 Claude 只取要用的那几条。</p>
        <label class="btn bk-pick">选文件<input type="file" class="bk-file" multiple accept=".pdf,.docx,.pptx,image/*" hidden></label>
        ${picked.length ? pickForm() : ''}
        ${progressHtml()}
      </section>
      <section class="dk-card"><h2 class="dk-h">${esc(SPACES[sp]?.label || '')}的资料</h2>
        ${mine.length ? mine.map((b) => `<a class="dk-class-row bk-row" href="#books/${esc(b.id)}">
            <span class="dk-cr-d"><b>${esc(b.id)}</b><span class="muted">${esc(BOOK_KINDS[b.kind] || b.kind || '')}</span></span>
            <span class="dk-cr-m">${esc(b.title || '')}<br><span class="muted">${b.chunks ? `${b.chunks} 条` : '还没有条目'}${b.pagesDone ? ` · 转好 ${b.pagesDone} 页` : ''}${b.pagesLeft ? ` · 还有 ${b.pagesLeft} 页没转` : ''}${b.storing && importer?.busy !== b.id ? ' · 上次没存完' : ''}${b.cost?.calls ? ` · 调用 ${b.cost.calls} 次` : ''}</span></span>
            <span class="dk-cr-n"><span class="dk-tag ${b.status === 'ready' ? 'is-ok' : 'is-warn'}">${esc(statusOf(b))}</span></span>
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
        ${/\.pdf$/i.test(first.name) && picked.length === 1 && mine.length ? `<label class="mm-f"><span>存进哪本书（同一本书分几次存，就选它）</span><select name="book"><option value="">新的一本</option>${mine.map((b) => `<option value="${esc(b.id)}"${b.file && b.file === first.name ? ' selected' : ''}>${esc(b.id)} ${esc(b.title || '')}</option>`).join('')}</select></label>` : ''}
        ${/\.pdf$/i.test(first.name) && picked.length === 1 ? `<div class="dk-mrow"><label class="mm-f"><span>从第几页</span><input type="number" name="from" min="1" placeholder="1" inputmode="numeric"></label><label class="mm-f"><span>到第几页（空着就是到最后）</span><input type="number" name="to" min="1" placeholder="最后" inputmode="numeric"></label></div>
          <p class="muted bk-cost">${costText()}</p>` : ''}
        <p class="muted">放在「${esc(SPACES[sp]?.label || sp)}」。</p>
        <div class="dk-mrow dk-mfoot"><button type="button" class="btn bk-cancel">算了</button><button type="submit" class="btn btn-primary bk-go">${TRANSCRIBE_HERE ? "开始导入" : "存进学习台"}</button></div>
      </form>`;
  }

  // 裁白边、跳过空白页让看图少花了多少（importer.js 记在 cost 里）
  function savedText(c) {
    if (!c?.imgFull) return '';
    const pct = Math.round((1 - (c.imgTokens || 0) / c.imgFull) * 100);
    return pct > 0 ? ` · 看图少花 ${pct}%${c.blank ? `（${c.blank} 页空白没转）` : ''}` : '';
  }

  // 估算：扫描页每 PAGES_PER_CALL 页一次调用（每页一张图，约一两千 token，加上转出来的字）
  function costText(from = null, to = null) {
    const n = pdfPages ? Math.max(0, Math.min(pdfPages, to || pdfPages) - Math.max(1, from || 1) + 1) : null;
    if (!TRANSCRIBE_HERE) return `${n === null ? '' : `这个 PDF 一共 ${pdfPages} 页，存 ${n} 页。`}这里只存原页图（每页先裁掉白边），不调用 Claude、不花额度；存好以后回 Claude Code 说「转 B几」，它转好写回来，这里自己拼成条目。`;
    return n === null ? `扫描页每 ${PAGES_PER_CALL} 页一次调用（用 ${modelName(TRANSCRIBE.model)} 转写）。整本几百页要几十次：可以先转这一讲要用的几十页，以后再接着转别的页。`
      : `这个 PDF 一共 ${pdfPages} 页。转 ${n} 页约 ${Math.ceil(n / PAGES_PER_CALL)} 次调用（每次 ${PAGES_PER_CALL} 页），用 ${modelName(TRANSCRIBE.model)} 转写（比 Opus 省得多），图先裁掉白边、空白页不调用。可以先转这一讲要用的几十页，以后再接着转。`;
  }
  function paintCost() {
    const f = host.querySelector('.bk-form');
    const el = f?.querySelector('.bk-cost');
    if (el) el.textContent = costText(Number(f.querySelector('[name=from]')?.value) || null, Number(f.querySelector('[name=to]')?.value) || null);
  }

  const statusOf = (b) => (inboxLeft(b.id) ? `正在并入转写（还剩 ${inboxLeft(b.id)} 批）` : rebuilding.has(b.id) || b.needsRebuild ? '正在拼条目' : b.storing && importer?.busy !== b.id ? '没存完' : b.status === 'importing' && importer?.busy !== b.id ? '没存完' : STATUS[b.status] || b.status || '');
  // 上次没存完（中途退出、刷新、屏幕熄了）：书上记着 storing（哪个文件、哪几页），给一个「接着存」
  function resumeCard(b) {
    const s = b.storing;
    if (!s || importer?.busy === b.id) return '';
    const range = s.to ? `第 ${s.from}–${s.to} 页` : `第 ${s.from} 页到最后`;
    return `<section class="dk-card"><h2 class="dk-h">上次没存完</h2>
      <p>「${esc(s.file || '')}」${esc(range)}还没存完。已经存好的页都在，接着存只存剩下的。</p>
      <div class="mm-acts"><button type="button" class="btn btn-primary bk-continue" data-book="${esc(b.id)}">接着存</button></div>
      <input type="file" class="bk-refile" data-book="${esc(b.id)}" accept=".pdf" hidden>
    </section>`;
  }
  async function continueStore(bookId, file, fromStash) {
    const b = books.find((x) => x.id === bookId);
    const s = b?.storing;
    if (!b || !s) return;
    const im = await getImporter();
    progress = { book: bookId, stage: 'read', msg: fromStash ? '用上次留在这台设备上的 PDF 接着存…' : '接着存…' };
    paint();
    run(() => im.add(file, { book: bookId, title: b.title, kind: b.kind, space: b.space, subject: b.subject, from: s.from, to: s.to || '', fromStash }));
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
        <p class="muted">${esc(BOOK_KINDS[b.kind] || '')} · ${esc(statusOf(b))}${b.chunks ? ` · ${b.chunks} 条` : ''}${chunks ? ` · 核对过 ${checked} 条` : ''}${b.pagesDone ? ` · 转好 ${b.pagesDone} 页` : ''}${b.cost?.calls ? ` · 调用 ${b.cost.calls} 次` : ''}${savedText(b.cost)}${b.cost?.model ? ` · ${esc(modelName(b.cost.model))} 转写` : ''}</p>
        <div class="mm-acts">
          ${bad.length && TRANSCRIBE_HERE ? `<button type="button" class="btn btn-primary bk-resume" data-book="${esc(id)}">接着转（${bad.length} 页）</button>` : ''}
          ${plan ? `<button type="button" class="btn bk-plan" data-book="${esc(id)}">挂到课程地图</button>` : ''}
          <button type="button" class="btn bk-del" data-book="${esc(id)}">删掉这本</button>
        </div>
        ${progressHtml()}
        <div class="bk-plan-host"></div>
      </section>
      ${resumeCard(b)}
      ${b.storeFailed?.length ? `<section class="dk-card"><h2 class="dk-h">没存上的页</h2><p>${esc(pageRanges(b.storeFailed))}没传上去（网络断了一下之类）。再选一次这本 PDF、存进这本书，只会补这些页，已经存好的不重复存。</p></section>` : ''}
      ${!inboxLeft(id) && (rebuilding.has(id) || b.needsRebuild) ? `<section class="dk-card"><h2 class="dk-h">正在拼条目</h2><p>转写都并进来了，正在把这本书拼成一条一条的（几百页要一两分钟）。学习台开着才会拼，屏幕别熄；中途关了，下次打开接着拼。</p></section>` : ''}
      ${inboxLeft(id) ? `<section class="dk-card"><h2 class="dk-h">正在并入转写</h2><p>已经转好了，还剩 ${inboxLeft(id)} 批（一批 4 页）在往书里并。学习台开着才会并，屏幕别熄；并完这一本自己拼成条目，这里就变成「转好了」。</p></section>` : ''}
      ${bad.length && !TRANSCRIBE_HERE && !inboxLeft(id) && !b.needsRebuild ? `<section class="dk-card"><h2 class="dk-h">等转写的页</h2><p>${esc(pageRanges(bad.map((p) => p.n)))}，一共 ${bad.length} 页。回到 Claude Code 说「转 ${esc(id)}」，转好写回来以后这里自己拼成条目。${b.pages && b.pagesStored && b.pagesStored < b.pages ? `PDF 一共 ${b.pages} 页，存进来了 ${b.pagesStored} 页；没存的页重新选这个 PDF、写好页码范围再存。` : ''}</p></section>` : ''}
      ${bad.length && TRANSCRIBE_HERE ? `<section class="dk-card"><h2 class="dk-h">没转好的页</h2><div class="bk-pages">${bad.map((p) => `<span class="dk-tag is-warn" title="${esc(p.err || '')}">第 ${p.n} 页${p.status === 'error' ? '（出错）' : ''}</span>`).join(' ')}</div></section>` : ''}
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
                : `<button type="button" class="btn btn-sm bk-check">${c.checked ? '取消核对' : '核对过了'}</button><button type="button" class="btn btn-sm bk-fix">改字</button>${(c.pages || []).length && (c.img || []).length ? `<button type="button" class="btn btn-sm bk-redo">${TRANSCRIBE_HERE ? '重新转写' : '标成要重转'}第 ${esc(c.pages.join('、'))} 页</button>` : ''}`}
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

  async function onChange(e) {
    if (e.target.matches('.bk-refile')) {
      const f = e.target.files?.[0];
      const id = e.target.dataset.book;
      const s = books.find((x) => x.id === id)?.storing;
      if (!f || !s) return;
      if (f.name !== s.file && f.size !== s.size && !await ask(`上次存的是「${s.file}」，这次选的是「${f.name}」。是同一本书吗？不是的话页码会对不上。`, { ok: '是同一本，接着存' })) return;
      continueStore(id, f, false);
      return;
    }
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
      else if (b.matches('.bk-continue')) {
        // 先用这台设备上留的那份；没有（清了数据、换了设备）就让我再选一次同一个 PDF
        const f = await stashedFile(b.dataset.book);
        if (f) continueStore(b.dataset.book, f, true);
        else { toast('这台设备上没留着这个 PDF，再选一次同一个文件就接着存'); host.querySelector(`.bk-refile[data-book="${b.dataset.book}"]`)?.click(); }
      }
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
        if (c?.fixed && !await ask('这一条你改过字，重新转写会盖掉改的。接着重转？', { ok: '重转' })) return;
        if (c?.fixed) await patch(bookId, id, () => ({ fixed: false }));
        if (!TRANSCRIBE_HERE) {
          // 不在这里转：把这几页标回「等转写」，Claude Code 下次转的时候一起转
          for (const n of c.pages || []) {
            const snap = await db.doc(`books/${bookId}/pages/${n}`).get();
            if (snap.exists) await db.doc(`books/${bookId}/pages/${n}`).set({ ...snap.data(), status: 'todo', redo: true, at: Date.now() });
          }
          pagesCache.delete(bookId);
          chunksCache.delete(bookId);
          paint();
          toast(`第 ${c.pages.join('、')} 页标成了要重转：回 Claude Code 说「转 ${bookId}」`);
          return;
        }
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
    // 截图、同一本 PDF 分几次存：都能选已有的书接着存（页码照 PDF 的页码，不会和已有的页混）
    const single = picked.length === 1 && /\.pdf$/i.test(picked[0].name);
    const book = ((images || single) && f.get('book')) || nextBookCode(books);
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
    if (!b || !await ask(`删掉「${b.title || id}」？条目、转写结果都删掉（原页图也删）。课程地图里挂着它的条目会失效。`, { ok: '删掉', danger: true })) return;
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
