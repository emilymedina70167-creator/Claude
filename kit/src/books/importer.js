// 资料入库的流程（docs/textbook-plan.md）：一个文件进来 → 一页一页（PDF 的页、截图、讲义里带图的幻灯片）先存原页图，再几页一次交给 Claude 看图转写，
// 每页的结果存在 books/{编号}/pages/{页码}；全部（或停下时已经转好的）按顺序拼成条目写进 books/{编号}/chunks。文稿（.docx）直接切条，不调用 Claude。
// 转写一半停了、关了页面：页的状态在数据库里，下次点「接着转」从没转的页开始（原页图在 assets 里，不用再选文件）。
// 改过文字、点过「已核对」的条目重新拼的时候保留（编号按页，重转别的页编号不变）。
import { unzip } from './zip.js';
import { docxParagraphs, pptxSlides } from './office.js';
import { transcribePrompt, parseTranscription, assembleChunks, transcriptChunks, PAGES_PER_CALL } from './ingest.js';
import { openPdf, renderPage, pageText, shrinkImage } from './pdf.js';
import { assetUrl } from '../live/store.js';

export const FILE_KINDS = [
  { re: /\.pdf$/i, kind: 'textbook', label: 'PDF（教材、讲义）' },
  { re: /\.docx$/i, kind: 'transcript', label: 'Word（视频课文稿）' },
  { re: /\.pptx$/i, kind: 'slides', label: 'PowerPoint（讲义、板书）' },
  { re: /\.(png|jpe?g|heic|webp|gif)$/i, kind: 'notes', label: '图片（截图、照片）' },
];
export const kindOfFile = (f) => FILE_KINDS.find((k) => k.re.test(f?.name || ''))?.kind || (String(f?.type || '').startsWith('image/') ? 'notes' : '');
const PAGE_WIDTH = 1200; // 存进学习台的原页图：核对够清楚，300 页约 40–50 MB（assets 一共 100 MB）
const WORKERS = 2; // 同时转写几批（太多会被限流）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/**
 * db：学习台的数据库；assets：存原页图；ai：getAI() 的结果（要能发图）；model：转写用的模型；
 * onProgress({ book, stage, done, total, msg })：进度（stage：read / render / transcribe / save / done / error）
 */
export function createImporter({ db, assets, ai, model, onProgress = () => {} }) {
  let stopFlag = false;
  let busy = null; // 正在转的书的编号
  const report = (p) => { try { onProgress(p); } catch { /* 画面的错不影响入库 */ } };
  const blobs = new Map(); // 这次刚画好的页图（不用再从 assets 下载）：'B1/23' → Blob

  async function upload(blob) {
    if (!assets) throw new Error('学习台没有 assets 权限，存不了原页图');
    const r = await assets.upload(blob, { type: blob.type || 'image/jpeg' });
    return r.id;
  }
  const savePage = (book, n, data) => db.doc(`books/${book}/pages/${n}`).set({ n, ...data, at: Date.now() });
  const pagesOf = async (book) => docsOf(await db.collection(`books/${book}/pages`).get()).sort((a, b) => a.n - b.n);

  /** 一个文件入库。opts：{ book（编号）, title, kind, space, subject, from, to（PDF 只转这几页）, start（截图的起始页码）, files（多张截图）} */
  async function add(file, opts) {
    if (busy) throw new Error(`正在转 ${busy}，等它完了（或者停下）再导入`);
    busy = opts.book;
    stopFlag = false;
    try {
      const kind = opts.kind || kindOfFile(file);
      const meta = { title: opts.title || file?.name || '没有名字', kind, space: opts.space || 'math', subject: opts.subject || '', file: file?.name || '', status: 'importing', at: Date.now() };
      const old = await db.doc(`books/${opts.book}`).get().then((s) => (s.exists ? s.data() : null)).catch(() => null);
      await db.doc(`books/${opts.book}`).set({ ...(old || {}), ...meta, createdAt: old?.createdAt || Date.now() });
      if (/\.docx$/i.test(file?.name || '')) return await addDocx(file, opts, meta);
      if (/\.pptx$/i.test(file?.name || '')) await addPptx(file, opts);
      else if (/\.pdf$/i.test(file?.name || '')) await addPdf(file, opts);
      else await addImages(opts.files || [file], opts);
      return await transcribe(opts.book, { meta });
    } finally {
      busy = null;
    }
  }

  async function addDocx(file, opts, meta) {
    report({ book: opts.book, stage: 'read', msg: '读文稿…' });
    const files = await unzip(new Uint8Array(await file.arrayBuffer()), (n) => n === 'word/document.xml');
    const chunks = transcriptChunks(docxParagraphs(files), { book: opts.book, title: meta.title });
    await writeChunks(opts.book, chunks, { replace: true });
    await db.doc(`books/${opts.book}`).set({ ...meta, status: 'ready', chunks: chunks.length, toc: [], at: Date.now() });
    report({ book: opts.book, stage: 'done', done: chunks.length, total: chunks.length, msg: `文稿切成了 ${chunks.length} 条` });
    return { chunks: chunks.length };
  }

  async function addPptx(file, opts) {
    report({ book: opts.book, stage: 'read', msg: '读讲义…' });
    const files = await unzip(new Uint8Array(await file.arrayBuffer()), (n) => n.startsWith('ppt/slides/') || n.startsWith('ppt/media/'));
    const slides = pptxSlides(files);
    let i = 0;
    for (const s of slides) {
      if (stopFlag) break;
      report({ book: opts.book, stage: 'render', done: ++i, total: slides.length, msg: `存第 ${s.n} 页的图…` });
      const imgs = [];
      for (const m of s.media.slice(0, 3)) {
        const raw = files.get(m);
        if (!raw) continue;
        const blob = await shrinkImage(new Blob([raw]), { width: PAGE_WIDTH, quality: 0.8 }).catch(() => null);
        if (blob) { const id = await upload(blob); imgs.push(id); blobs.set(`${opts.book}/${s.n}/${id}`, blob); }
      }
      // 有图的页交给 Claude 看图转写（板书截图里的公式只有图上有）；只有字的页直接成一条
      if (imgs.length) await savePage(opts.book, s.n, { img: imgs[0], imgs, layer: s.text, title: s.title, status: 'todo' });
      else await savePage(opts.book, s.n, { items: [{ kind: '讲义', title: s.title, text: s.text }], status: 'done', title: s.title });
    }
  }

  async function addPdf(file, opts) {
    report({ book: opts.book, stage: 'read', msg: '打开 PDF…' });
    const doc = await openPdf(await file.arrayBuffer());
    const from = Math.max(1, Number(opts.from) || 1);
    const to = Math.min(doc.numPages, Number(opts.to) || doc.numPages);
    await db.doc(`books/${opts.book}`).set({ ...(await db.doc(`books/${opts.book}`).get()).data(), pages: doc.numPages });
    const have = new Map((await pagesOf(opts.book)).map((p) => [p.n, p]));
    for (let n = from; n <= to; n++) {
      if (stopFlag) break;
      if (have.get(n)?.status === 'done' && !opts.force) continue;
      report({ book: opts.book, stage: 'render', done: n - from + 1, total: to - from + 1, msg: `存第 ${n} 页的原页图…` });
      const blob = await renderPage(doc, n, { width: PAGE_WIDTH, quality: 0.8 });
      const layer = await pageText(doc, n).catch(() => '');
      const id = await upload(blob);
      blobs.set(`${opts.book}/${n}/${id}`, blob);
      await savePage(opts.book, n, { img: id, imgs: [id], layer: layer.slice(0, 6000), status: 'todo' });
    }
    doc.destroy?.();
  }

  async function addImages(list, opts) {
    const start = Math.max(1, Number(opts.start) || 1);
    const have = await pagesOf(opts.book);
    let n = Math.max(start, have.length ? Math.max(...have.map((p) => p.n)) + 1 : start);
    let i = 0;
    for (const f of list) {
      if (stopFlag) break;
      report({ book: opts.book, stage: 'render', done: ++i, total: list.length, msg: `存第 ${i} 张图…` });
      const blob = await shrinkImage(f, { width: PAGE_WIDTH, quality: 0.8 });
      const id = await upload(blob);
      blobs.set(`${opts.book}/${n}/${id}`, blob);
      await savePage(opts.book, n, { img: id, imgs: [id], layer: '', status: 'todo' });
      n++;
    }
  }

  async function imagesOf(book, p) {
    const out = [];
    for (const id of p.imgs || [p.img]) {
      if (!id) continue;
      const cached = blobs.get(`${book}/${p.n}/${id}`);
      if (cached) { out.push(cached); continue; }
      const r = await fetch(assetUrl(id));
      if (!r.ok) throw new Error(`第 ${p.n} 页的原页图取不到`);
      out.push(await r.blob());
    }
    return out;
  }

  /**
   * 把还没转（todo）和转坏了（error）的页交给 Claude 看图转写，再拼成条目。pages：只转这几页（重转用，force 也转已经好的）
   */
  async function transcribe(book, { pages = null, force = false, meta = null } = {}) {
    busy = busy || book;
    stopFlag = false;
    const info = meta || (await db.doc(`books/${book}`).get()).data() || {};
    const all = await pagesOf(book);
    const todo = all.filter((p) => (pages ? pages.includes(p.n) && (force || p.status !== 'done') : p.status === 'todo' || p.status === 'error'));
    const per = Math.max(1, Math.min(PAGES_PER_CALL, ai?.images?.maxCount || PAGES_PER_CALL));
    const batches = [];
    for (let i = 0; i < todo.length; i += per) batches.push(todo.slice(i, i + per));
    let done = 0;
    let calls = 0;
    let fatal = null;
    // 上一页停在哪（最后一条、所在的讲和节）：给 Claude 判断这几页开头是不是接着上一页
    const ctxBefore = (n) => {
      let chapter = '', section = '';
      for (const p of all.filter((x) => x.n < n && x.status === 'done').sort((a, b) => a.n - b.n)) {
        for (const it of p.items || []) if (it.kind === '标题') { if (it.level === 1) { chapter = it.title; section = ''; } else if (it.level === 2) section = it.title; }
      }
      const prev = all.find((x) => x.n === n - 1 && x.status === 'done');
      const it = prev ? [...(prev.items || [])].reverse().find((x) => x.kind !== '标题') : null;
      return { chapter, section, last: it ? { kind: it.kind, title: it.title } : null };
    };
    async function one(batch) {
      const nums = batch.map((p) => p.n);
      const images = [];
      for (const p of batch) images.push(...(await imagesOf(book, p)).slice(0, 1)); // 一页一张图（讲义一页有几张时取第一张）
      const ctx = { ...ctxBefore(nums[0]), kind: info.kind, layer: Object.fromEntries(batch.map((p) => [p.n, p.layer || ''])) };
      const prompt = transcribePrompt({ title: info.title, subject: info.subject }, nums, ctx);
      let res = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          calls++;
          res = await ai.call(prompt, { model, effort: 'medium', modelTier: 'complex', images, cache: false });
        } catch (e) {
          if (e?.code === 'rate_limited' && attempt === 0) { report({ book, stage: 'transcribe', done, total: todo.length, msg: '请求太快，歇 20 秒…' }); await sleep(20000); continue; }
          if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'images_unavailable'].includes(e?.code)) fatal = e;
          throw e;
        }
      }
      const parsed = parseTranscription(res.text, nums);
      for (const p of batch) {
        const items = parsed.pages.get(p.n);
        const rec = items ? { ...p, items, status: 'done', err: '', by: res.modelApplied || '' } : { ...p, status: 'error', err: '这一页没转出来' };
        delete rec.id;
        await savePage(book, p.n, rec);
        const k = all.findIndex((x) => x.n === p.n);
        if (k >= 0) all[k] = { ...rec, n: p.n };
      }
      done += batch.length;
      report({ book, stage: 'transcribe', done, total: todo.length, msg: `转好了 ${done} / ${todo.length} 页` });
    }
    let next = 0;
    const worker = async () => {
      while (!stopFlag && !fatal && next < batches.length) {
        const b = batches[next++];
        try { await one(b); } catch (e) {
          for (const p of b) { const rec = { ...p, status: 'error', err: String(e?.message || e?.code || e).slice(0, 200) }; delete rec.id; await savePage(book, p.n, rec).catch(() => {}); }
          done += b.length;
          report({ book, stage: 'transcribe', done, total: todo.length, msg: `第 ${b.map((p) => p.n).join('、')} 页没转成：${e?.message || e?.code || e}` });
        }
      }
    };
    report({ book, stage: 'transcribe', done: 0, total: todo.length, msg: todo.length ? `开始转写 ${todo.length} 页（${batches.length} 次调用）…` : '没有要转的页' });
    await Promise.all(Array.from({ length: Math.min(WORKERS, batches.length) }, worker));
    const r = await rebuild(book, { calls });
    busy = null;
    if (fatal) throw fatal;
    return r;
  }

  /** 把转好的页拼成条目写进去；改过、核对过的条目保留 */
  async function rebuild(book, { calls = 0 } = {}) {
    report({ book, stage: 'save', msg: '拼成条目…' });
    const info = (await db.doc(`books/${book}`).get()).data() || {};
    const pages = await pagesOf(book);
    const ready = pages.filter((p) => p.status === 'done').map((p) => ({ page: p.n, items: p.items || [] }));
    const { chunks, toc } = assembleChunks(ready, book);
    // 每条记下原页图（核对、课堂里看原页用）
    const imgOf = new Map(pages.map((p) => [p.n, p.imgs || (p.img ? [p.img] : [])]));
    for (const c of chunks) c.img = [...new Set(c.pages.flatMap((n) => imgOf.get(n) || []))].slice(0, 4);
    await writeChunks(book, chunks, { replace: true });
    const left = pages.filter((p) => p.status !== 'done').length;
    const cost = { calls: (info.cost?.calls || 0) + calls, pages: pages.filter((p) => p.status === 'done').length };
    await db.doc(`books/${book}`).set({ ...info, status: left ? 'partial' : 'ready', chunks: chunks.length, toc, pagesDone: cost.pages, pagesLeft: left, cost, at: Date.now() });
    report({ book, stage: 'done', done: chunks.length, total: chunks.length, msg: `${chunks.length} 条${left ? `，还有 ${left} 页没转好` : ''}` });
    return { chunks: chunks.length, left };
  }

  /** 写条目：replace 时删掉已经没有的；改过文字（fixed）、核对过（checked）的保留 */
  async function writeChunks(book, chunks, { replace = false } = {}) {
    const old = new Map(docsOf(await db.collection(`books/${book}/chunks`).get()).map((c) => [c.id, c]));
    for (const c of chunks) {
      const o = old.get(c.id);
      const keep = o?.fixed ? { text: o.text, title: o.title, kind: o.kind, fixed: true } : {};
      const rec = { ...c, ...keep, ...(o?.checked ? { checked: true } : {}) };
      delete rec.id;
      delete rec.media;
      const same = o && JSON.stringify({ ...o, id: undefined }) === JSON.stringify({ ...rec, id: undefined });
      if (!same) await db.doc(`books/${book}/chunks/${c.id}`).set(rec);
      old.delete(c.id);
    }
    if (replace) for (const id of old.keys()) await db.doc(`books/${book}/chunks/${id}`).delete().catch(() => {});
  }

  return { add, transcribe, rebuild, writeChunks, stop: () => { stopFlag = true; }, get busy() { return busy; } };
}

/** 学习台里某一科的书和全部条目（课堂开课时读一次；条目多，不订阅） */
export async function loadBooks(db, space = null) {
  const books = docsOf(await db.collection('books').get()).filter((b) => !space || !b.space || b.space === space);
  const chunks = [];
  for (const b of books) chunks.push(...docsOf(await db.collection(`books/${b.id}/chunks`).get()).map((c) => ({ ...c, book: c.book || b.id })));
  chunks.sort((a, b) => (a.book === b.book ? (a.seq || 0) - (b.seq || 0) : String(a.book).localeCompare(String(b.book), undefined, { numeric: true })));
  return { books, chunks };
}
