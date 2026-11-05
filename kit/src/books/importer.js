// 资料入库的流程（docs/textbook-plan.md）：一个文件进来 → 一页一页（PDF 的页、截图、讲义里带图的幻灯片）先存原页图，再几页一次交给 Claude 看图转写，
// 每页的结果存在 books/{编号}/pages/{页码}；全部（或停下时已经转好的）按顺序拼成条目写进 books/{编号}/chunks。文稿（.docx）直接切条，不调用 Claude。
// 转写一半停了、关了页面：页的状态在数据库里，下次点「接着转」从没转的页开始（原页图在 assets 里，不用再选文件）。
// 改过文字、点过「已核对」的条目重新拼的时候保留（编号按页，重转别的页编号不变）。
import { unzip } from './zip.js';
import { docxParagraphs, pptxSlides } from './office.js';
import { transcribePrompt, parseTranscription, assembleChunks, transcriptChunks, PAGES_PER_CALL } from './ingest.js';
import { openPdf, renderScan, pageText, shrinkImage } from './pdf.js';
import { assetUrl } from '../live/store.js';
import { stashFile, dropStash } from './stash.js';

export const FILE_KINDS = [
  { re: /\.pdf$/i, kind: 'textbook', label: 'PDF（教材、讲义）' },
  { re: /\.docx$/i, kind: 'transcript', label: 'Word（视频课文稿）' },
  { re: /\.pptx$/i, kind: 'slides', label: 'PowerPoint（讲义、板书）' },
  { re: /\.(png|jpe?g|heic|webp|gif)$/i, kind: 'notes', label: '图片（截图、照片）' },
];
export const kindOfFile = (f) => FILE_KINDS.find((k) => k.re.test(f?.name || ''))?.kind || (String(f?.type || '').startsWith('image/') ? 'notes' : '');
const PAGE_WIDTH = 1200; // 存进学习台的原页图：核对够清楚，300 页约 40–50 MB（assets 一共 100 MB）
// 看图转写用 Haiku 5.5（2026-11-04 我定的：一本书三四百页，Opus 转太费额度；Haiku 的价钱约是 Opus 的四十分之一）。
// 转写是认字、不是讲课，课堂讲课照旧只用 Opus 5.5（classroom.js 的 TEACH）。modelTier 是平台给的退路档，
// 实际是哪个模型转的记在每一页的 by 和书的 cost.model 上，教材页显示出来
// 学习台里不再调用 Claude 转写（2026-11-04 我定的）：页面里的 Haiku 觉得整页照抄教材涉及版权、不肯转，Opus 又太费额度。
// 现在导入只存原页图（不调用），书上标「等转写」；转写在 Claude Code 那边做（tools/books.mjs，docs/textbook-plan.md「在 Claude Code 里转」）：
// 它读原页图、把每页的结果写回 books/{书}/pages/{页}，再在书上写 rebuild（时间），页面看到了自己拼条目（rebuild 是纯代码，不调用）。
// 页面里转写的代码留着：TRANSCRIBE_HERE 改回 true 就是原来那样
export const TRANSCRIBE_HERE = false;
export const TRANSCRIBE = { model: 'claude-haiku-5-5', modelTier: 'quick', effort: 'medium' };
export const modelName = (id) => ({ 'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5', codex: 'Codex', chat: '项目里的 Claude' })[id] || id || '';
const WORKERS = 3;
const UPLOADS = 4; // 只存不转时，同时传几页原图（传图主要是等网络） // 同时转写几批：被限流就自动少一批（limit），这次导入一直按少的来
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/**
 * db：学习台的数据库；assets：存原页图；ai：getAI() 的结果（要能发图）；model：不用了（转写用 TRANSCRIBE）；
 * onProgress({ book, stage, done, total, msg })：进度（stage：read / render / transcribe / save / done / error）
 */
export function createImporter({ db, assets, ai, onProgress = () => {} }) {
  let stopFlag = false;
  let busy = null; // 正在转的书的编号
  const report = (p) => { try { onProgress(p); } catch { /* 画面的错不影响入库 */ } };
  const blobs = new Map(); // 这次刚画好的页图（不用再从 assets 下载）：'B1/23' → Blob
  let calls = 0; // 这次调用了 Claude 几次（拼条目时记进书的 cost）
  let saved = { tokens: 0, full: 0, blank: 0 }; // 裁白边、跳过空白页省下的（拼条目时记进书的 cost）
  let noEffort = false;
  let usedModel = ''; // 平台实际用哪个模型转的（拼条目时记进书的 cost.model）
  let limit = WORKERS;

  async function upload(blob) {
    if (!assets) throw new Error('学习台没有 assets 权限，存不了原页图');
    const r = await assets.upload(blob, { type: blob.type || 'image/jpeg' });
    return r.id;
  }
  const savePage = (book, n, data) => db.doc(`books/${book}/pages/${n}`).set({ n, ...data, at: Date.now() });
  const pagesOf = async (book) => docsOf(await db.collection(`books/${book}/pages`).get()).sort((a, b) => a.n - b.n);

  /** 一个文件入库。opts：{ book（编号）, title, kind, space, subject, from, to（PDF 只转这几页）, start（截图的起始页码）, files（多张截图）} */
  // 存的时候不让屏幕自己熄（熄了页面就停了）；切回来再要一次（切走时浏览器会收回）
  let lock = null;
  const keepAwake = async () => { try { if (busy && document.visibilityState === 'visible' && !lock) { lock = await navigator.wakeLock?.request?.('screen'); lock?.addEventListener?.('release', () => { lock = null; }); } } catch { lock = null; } };
  try { document.addEventListener('visibilitychange', keepAwake); } catch { /* 没有 document（测试） */ }

  async function add(file, opts) {
    if (busy) throw new Error(`正在转 ${busy}，等它完了（或者停下）再导入`);
    busy = opts.book;
    stopFlag = false;
    keepAwake();
    try {
      const kind = opts.kind || kindOfFile(file);
      const pdf = /\.pdf$/i.test(file?.name || '') && !TRANSCRIBE_HERE;
      // PDF 这次要存哪个文件、哪几页：中途退出了，教材页靠它显示「上次没存完 · 接着存」；存完清掉
      const storing = pdf ? { file: file.name, size: file.size, from: Math.max(1, Number(opts.from) || 1), to: Number(opts.to) || 0, at: Date.now() } : null;
      if (pdf && !opts.fromStash) stashFile(opts.book, file); // 在这台设备的浏览器里留一份，「接着存」不用再选文件（不等它）
      const meta = { title: opts.title || file?.name || '没有名字', kind, space: opts.space || 'math', subject: opts.subject || '', file: file?.name || '', status: 'importing', at: Date.now(), ...(storing ? { storing } : {}) };
      const old = await db.doc(`books/${opts.book}`).get().then((s) => (s.exists ? s.data() : null)).catch(() => null);
      await db.doc(`books/${opts.book}`).set({ ...(old || {}), ...meta, createdAt: old?.createdAt || Date.now() });
      if (/\.docx$/i.test(file?.name || '')) return await addDocx(file, opts, meta);
      if (/\.pptx$/i.test(file?.name || '')) await addPptx(file, opts);
      else if (/\.pdf$/i.test(file?.name || '')) {
        const r = await addPdf(file, opts, meta);
        if (pdf && !stopFlag && !r?.failed) {
          const now = (await db.doc(`books/${opts.book}`).get()).data() || {};
          await db.doc(`books/${opts.book}`).set({ ...now, storing: null });
          dropStash(opts.book);
        }
      }
      else await addImages(opts.files || [file], opts);
      // 停下了就只拼已经转好的；没停：剩下没转的、转坏的再转一遍（PDF 是第二次机会）
      if (stopFlag || !TRANSCRIBE_HERE) return await rebuild(opts.book);
      return await transcribe(opts.book, { meta, fresh: false });
    } finally {
      busy = null;
      try { await lock?.release?.(); } catch { /* 已经收回了 */ }
      lock = null;
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
        if (blob) { const id = await upload(blob); imgs.push(id); if (TRANSCRIBE_HERE) blobs.set(`${opts.book}/${s.n}/${id}`, blob); }
      }
      // 有图的页交给 Claude 看图转写（板书截图里的公式只有图上有）；只有字的页直接成一条
      if (imgs.length) await savePage(opts.book, s.n, { img: imgs[0], imgs, layer: s.text, title: s.title, status: 'todo' });
      else await savePage(opts.book, s.n, { items: [{ kind: '讲义', title: s.title, text: s.text }], status: 'done', title: s.title });
    }
  }

  // PDF：画一页存一页，凑够一批（PAGES_PER_CALL 页）马上交给转写，画和转同时进行（以前每 12 页先全画完再转、转完再画下一段，
  // 画的时候 Claude 闲着、转的时候画布闲着）。画得太靠前（排着没开始转的批 ≥ 同时转的批数）就等一等，iPad 上不囤太多图。
  // 每页先裁白边、认空白页（pdf.js 的 renderScan）：空白页直接记成转好了，不调用 Claude
  async function addPdf(file, opts, meta) {
    report({ book: opts.book, stage: 'read', msg: '打开 PDF…' });
    const doc = await openPdf(await file.arrayBuffer());
    const from = Math.max(1, Number(opts.from) || 1);
    const to = Math.min(doc.numPages, Number(opts.to) || doc.numPages);
    await db.doc(`books/${opts.book}`).set({ ...(await db.doc(`books/${opts.book}`).get()).data(), pages: doc.numPages });
    const all = await pagesOf(opts.book);
    const have = new Map(all.map((p) => [p.n, p]));
    const want = [];
    // 转好了但还没有原页图的页（Codex 在别处先转好写回来的）也要画、存图，只是不动它的转写
    // 已经存过原图的页不再存（不在这里转时 todo 的页也一样：同一本分几次存、存到一半重来，不重复占空间）
    const stored = (p) => p?.img && (p.status === 'done' || !TRANSCRIBE_HERE);
    for (let n = from; n <= to; n++) if (!(stored(have.get(n)) && !opts.force)) want.push(n);
    const run = runner(opts.book, { info: meta, all, total: want.length, range: `（第 ${from}–${to} 页）` });
    const per = perCall();
    let buf = [];
    // 只存不转时：画（吃 CPU）一页接一页，传图、写记录（等网络）同时进行 UPLOADS 页——以前画完一页要等它传完才画下一页，
    // 一页一两秒都在等网络（实测画一页只要零点几秒）。一页传失败不停下：记下来，存完再说；没存上的页再存一次就补上
    const inflight = new Set();
    const failed = [];
    let doneCount = 0;
    const t0 = Date.now();
    const eta = () => {
      if (doneCount < 3) return '';
      const each = (Date.now() - t0) / doneCount / 1000;
      const left = Math.round((each * (want.length - doneCount)) / 60);
      return `，每页约 ${each < 1 ? each.toFixed(1) : Math.round(each)} 秒${left >= 1 ? `，还要约 ${left} 分钟` : ''}`;
    };
    const progress = (n) => report({ book: opts.book, stage: 'render', done: doneCount, total: want.length, msg: `存好 ${doneCount} / ${want.length} 页（第 ${from}–${to} 页${eta()}）…${n ? ` 正在画第 ${n} 页` : ''}` });
    async function store(n, pic, layer) {
      let id = null;
      for (let attempt = 0; attempt < 3 && !id; attempt++) {
        try { id = await upload(pic.blob); } catch (e) {
          if (e?.code === 'quota_or_state') { stopFlag = true; throw new Error('学习台的存储满了（1 GB 或 5000 个文件），先腾出地方再存'); }
          if (attempt === 2) throw e;
          await sleep(1500 * (attempt + 1)); // 网络抖一下、被限流：歇一下再传
        }
      }
      const blank = pic.blank && !layer.trim();
      const was = have.get(n);
      const kept = was?.status === 'done' && !was.img && !opts.force; // 先转好、后存图：保留转写
      const rec = kept ? { ...was, n, img: id, imgs: [id], size: [pic.w, pic.h] } : { n, img: id, imgs: [id], layer: layer.slice(0, 6000), size: [pic.w, pic.h],
        ...(blank ? { items: [], status: 'done', blank: true, by: 'page' } : { status: 'todo' }) };
      delete rec.id;
      await savePage(opts.book, n, rec);
      const k = all.findIndex((x) => x.n === n);
      if (k >= 0) all[k] = rec; else all.push(rec);
      return { rec, id, kept, blank };
    }
    try {
      for (const n of want) {
        if (stopFlag || run.fatal) break;
        if (TRANSCRIBE_HERE) run.note(`存第 ${n} 页的原页图`);
        else progress(n);
        const pic = await renderScan(doc, n, { width: PAGE_WIDTH, quality: 0.8 });
        const layer = await pageText(doc, n).catch(() => '');
        if (!TRANSCRIBE_HERE) {
          while (inflight.size >= UPLOADS) await Promise.race(inflight);
          if (stopFlag) break;
          const job = store(n, pic, layer).then(({ kept, blank }) => {
            if (!kept) { if (blank) saved.blank++; else saved.tokens += pic.tokens; saved.full += pic.full; }
          }).catch((e) => { failed.push(n); if (stopFlag) report({ book: opts.book, stage: 'error', msg: e.message }); })
            .finally(() => { inflight.delete(job); doneCount++; progress(); });
          inflight.add(job);
          continue;
        }
        const { rec, id, kept, blank } = await store(n, pic, layer);
        if (kept) continue;
        if (blank) { saved.blank++; saved.full += pic.full; run.skip(n); continue; }
        saved.tokens += pic.tokens;
        saved.full += pic.full;
        blobs.set(`${opts.book}/${n}/${id}`, pic.blob);
        buf.push(rec);
        if (buf.length >= per) { run.push(buf); buf = []; }
        await run.room();
      }
      await Promise.all(inflight);
      if (buf.length && !stopFlag) run.push(buf);
      await run.finish();
    } finally {
      doc.destroy?.();
    }
    // 没存上的页记在书上（教材页提示再存一次）；这次全存上了就清掉以前记的
    const bk = (await db.doc(`books/${opts.book}`).get()).data() || {};
    if (failed.length || bk.storeFailed?.length) await db.doc(`books/${opts.book}`).set({ ...bk, storeFailed: failed.sort((x, y) => x - y) });
    if (run.fatal) { await rebuild(opts.book); throw run.fatal; }
    return { failed: failed.length };
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
      if (TRANSCRIBE_HERE) blobs.set(`${opts.book}/${n}/${id}`, blob);
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

  const perCall = () => Math.max(1, Math.min(PAGES_PER_CALL, ai?.images?.maxCount || PAGES_PER_CALL));

  /**
   * 转写的队列：push(几页) 排进去，最多 limit 批同时转；room() 等到排着的少于 limit；finish() 等全部转完（停下了就等正在转的）。
   * info：书的信息；all：这本书所有的页（转好一批就更新，给下一批判断「接着上一页」）；total：这次一共要转几页（进度用）
   */
  function runner(book, { info, all, total, range = '' }) {
    const queue = [];
    let active = 0;
    let done = 0;
    let rendering = '';
    const waiters = [];
    const out = { fatal: null };
    const wake = () => { for (const w of waiters.splice(0)) w(); };
    const say = (msg) => report({ book, stage: 'transcribe', done, total, msg });
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
    const keep = (rec) => {
      const k = all.findIndex((x) => x.n === rec.n);
      if (k >= 0) all[k] = rec; else all.push(rec);
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
          // 这个查看方式不认 effort 时去掉它再试
          const { effort, ...pick } = TRANSCRIBE;
          res = await ai.call(prompt, { ...pick, ...(noEffort ? {} : { effort }), images, cache: false });
          if (res?.modelApplied) usedModel = res.modelApplied;
        } catch (e) {
          if (!noEffort && ['invalid_argument', 'invalid_request', 'bad_request', 'unsupported_option'].includes(e?.code)) { noEffort = true; attempt--; continue; }
          if (e?.code === 'rate_limited' && attempt === 0) {
            limit = Math.max(1, limit - 1); // 同时转得太多：以后少一批
            say('请求太快，歇 20 秒…');
            await sleep(20000);
            continue;
          }
          if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'images_unavailable'].includes(e?.code)) out.fatal = e;
          throw e;
        }
      }
      let parsed;
      try { parsed = parseTranscription(res.text, nums); } catch (e) {
        // 留下回复的开头：以后看得出是模型回了别的格式、说了看不清，还是平台换了模型
        const head = String(res?.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        throw new Error(`${e.message}${res?.modelApplied ? `（${modelName(res.modelApplied)}）` : ''}：${head || '回复是空的'}`);
      }
      for (const p of batch) {
        const items = parsed.pages.get(p.n);
        const rec = items ? { ...p, items, status: 'done', err: '', by: res.modelApplied || '' } : { ...p, status: 'error', err: '这一页没转出来' };
        delete rec.id;
        delete rec.blank;
        await savePage(book, p.n, rec);
        keep({ ...rec, n: p.n });
        if (items) for (const id of p.imgs || [p.img]) blobs.delete(`${book}/${p.n}/${id}`); // 转好了，这一页的图不用再留在内存里
      }
      done += batch.length;
      say(`转好了第 ${nums.join('、')} 页${range}${rendering}`);
    }
    const pump = () => {
      while (!stopFlag && !out.fatal && active < limit && queue.length) {
        const b = queue.shift();
        active++;
        one(b).catch(async (e) => {
          for (const p of b) { const rec = { ...p, status: 'error', err: String(e?.message || e?.code || e).slice(0, 200) }; delete rec.id; await savePage(book, p.n, rec).catch(() => {}); keep({ ...rec, n: p.n }); }
          done += b.length;
          say(`第 ${b.map((p) => p.n).join('、')} 页没转成：${e?.message || e?.code || e}`);
        }).finally(() => { active--; pump(); wake(); });
      }
      wake();
    };
    const until = (ok) => new Promise((r) => { const check = () => (ok() ? r() : waiters.push(check)); check(); });
    out.push = (batch) => { queue.push(batch); pump(); };
    out.skip = (n) => { done++; say(`第 ${n} 页是空白页，不用转${range}`); };
    out.note = (msg) => { rendering = ` · ${msg}`; say(`转好 ${done} / ${total} 页${range}${rendering}`); };
    out.room = () => until(() => stopFlag || out.fatal || queue.length < limit);
    out.finish = () => until(() => active === 0 && (stopFlag || out.fatal || !queue.length));
    return out;
  }

  /**
   * 把还没转（todo）和转坏了（error）的页交给 Claude 看图转写，再拼成条目。pages：只转这几页（重转用，force 也转已经好的）
   */
  async function transcribe(book, { pages = null, force = false, meta = null, rebuild: again = true, fresh = true } = {}) {
    busy = busy || book;
    if (fresh) stopFlag = false;
    const info = meta || (await db.doc(`books/${book}`).get()).data() || {};
    const all = await pagesOf(book);
    const todo = all.filter((p) => (pages ? pages.includes(p.n) && (force || p.status !== 'done') : p.status === 'todo' || p.status === 'error'));
    const per = perCall();
    const run = runner(book, { info, all, total: todo.length });
    report({ book, stage: 'transcribe', done: 0, total: todo.length, msg: todo.length ? `开始转写 ${todo.length} 页（${Math.ceil(todo.length / per)} 次调用）…` : '没有要转的页' });
    for (let i = 0; i < todo.length; i += per) run.push(todo.slice(i, i + per));
    await run.finish();
    if (run.fatal) { await rebuild(book); throw run.fatal; }
    if (!again) return null;
    const r = await rebuild(book);
    if (fresh) busy = null;
    return r;
  }

  /** 把转好的页拼成条目写进去；改过、核对过的条目保留 */
  async function rebuild(book) {
    report({ book, stage: 'save', msg: '拼成条目…' });
    // needsRebuild 是 bookview 记的「还要拼条目」：拼完这一下就去掉
    const { needsRebuild: _rb, ...info } = (await db.doc(`books/${book}`).get()).data() || {};
    const pages = await pagesOf(book);
    const ready = pages.filter((p) => p.status === 'done').map((p) => ({ page: p.n, items: p.items || [] }));
    const { chunks, toc } = assembleChunks(ready, book);
    // 每条记下原页图（核对、课堂里看原页用）
    const imgOf = new Map(pages.map((p) => [p.n, p.imgs || (p.img ? [p.img] : [])]));
    for (const c of chunks) c.img = [...new Set(c.pages.flatMap((n) => imgOf.get(n) || []))].slice(0, 4);
    await writeChunks(book, chunks, { replace: true });
    const left = pages.filter((p) => p.status !== 'done').length;
    // 图的 token：裁白边以后实际交出去的、不裁要交的（空白页整页算省下的），给教材页显示省了多少
    const was = info.cost || {};
    const cost = { calls: (was.calls || 0) + calls, pages: pages.filter((p) => p.status === 'done').length,
      imgTokens: (was.imgTokens || 0) + saved.tokens, imgFull: (was.imgFull || 0) + saved.full, blank: (was.blank || 0) + saved.blank,
      ...(modelOfPages(pages) || usedModel || was.model ? { model: modelOfPages(pages) || usedModel || was.model } : {}) };
    calls = 0;
    saved = { tokens: 0, full: 0, blank: 0 };
    await db.doc(`books/${book}`).set({ ...info, status: left ? 'partial' : 'ready', chunks: chunks.length, toc, pagesDone: cost.pages, pagesLeft: left, pagesStored: pages.length, cost, at: Date.now(), rebuiltAt: Date.now() });
    report({ book, stage: 'done', done: chunks.length, total: chunks.length, msg: TRANSCRIBE_HERE || !left ? `${chunks.length} 条${left ? `，还有 ${left} 页没转好` : ''}` : `存好了，${left} 页等转写（回 Claude Code 说「转 ${book}」）${chunks.length ? `；已有 ${chunks.length} 条` : ''}` });
    return { chunks: chunks.length, left };
  }

  /** 写条目：replace 时删掉已经没有的；改过文字（fixed）、核对过（checked）的保留 */
  async function writeChunks(book, chunks, { replace = false } = {}) {
    const old = new Map(docsOf(await db.collection(`books/${book}/chunks`).get()).map((c) => [c.id, c]));
    // 一本书几百条，一条一条等太慢：五条一组同时写（再多数据库会限流）
    const jobs = [];
    for (const c of chunks) {
      const o = old.get(c.id);
      const keep = o?.fixed ? { text: o.text, title: o.title, kind: o.kind, fixed: true } : {};
      const rec = { ...c, ...keep, ...(o?.checked ? { checked: true } : {}) };
      delete rec.id;
      delete rec.media;
      const same = o && JSON.stringify({ ...o, id: undefined }) === JSON.stringify({ ...rec, id: undefined });
      if (!same) jobs.push(() => db.doc(`books/${book}/chunks/${c.id}`).set(rec));
      old.delete(c.id);
    }
    if (replace) for (const id of old.keys()) jobs.push(() => db.doc(`books/${book}/chunks/${id}`).delete().catch(() => {}));
    for (let i = 0; i < jobs.length; i += 5) await Promise.all(jobs.slice(i, i + 5).map((f) => f()));
  }

  return { add, transcribe, rebuild, writeChunks, stop: () => { stopFlag = true; }, get busy() { return busy; } };
}

/** 这本书转好的页大多是哪个模型转的（教材页显示「… 转写」） */
export function modelOfPages(pages = []) {
  const n = new Map();
  for (const p of pages) if (p.status === 'done' && p.by && p.by !== 'page') n.set(p.by, (n.get(p.by) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

/**
 * 学习台里某一科的书和全部条目（课堂开课时读一次；条目多，不订阅）。
 * 几本同时读（以前一本接一本：英语传成 35 段，开课 8 秒没读完，整节课没有教材，2026-11-05）；
 * 一本读不到再试一次，还不行跳过这一本、记在 failed 里（不让一本拖垮全部）
 */
export async function loadBooks(db, space = null, { parallel = 6 } = {}) {
  const books = docsOf(await db.collection('books').get()).filter((b) => !space || !b.space || b.space === space);
  const per = new Array(books.length);
  const failed = [];
  let next = 0;
  const one = async (b) => {
    for (let k = 0; ; k++) {
      try { return docsOf(await db.collection(`books/${b.id}/chunks`).get()).map((c) => ({ ...c, book: c.book || b.id })); }
      catch (err) { if (k >= 1) throw err; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, books.length) }, async () => {
    while (next < books.length) {
      const i = next++;
      try { per[i] = await one(books[i]); } catch { per[i] = []; failed.push(books[i].id); }
    }
  }));
  const chunks = per.flat();
  chunks.sort((a, b) => (a.book === b.book ? (a.seq || 0) - (b.seq || 0) : String(a.book).localeCompare(String(b.book), undefined, { numeric: true })));
  return failed.length ? { books, chunks, failed } : { books, chunks };
}
