// 资料入库（docs/textbook-plan.md）：把教材扫描页、视频课文稿、讲义变成「一条一条」存进学习台，讲课时按需取。纯函数，有测试。
// - 扫描页（PDF 没有文字层、截图、照片）：页面把每页渲染成图，几页一次交给 Opus 5.5 看图转写成 JSON（transcribePrompt / parseTranscription），
//   每页的结果存下来（可以停了接着转、某页重转），最后按顺序拼成条目（assembleChunks）：标题条更新「第几讲 / 第几节」，
//   跨页的接到上一条，例题连解答、定理连证明在一条里，太长的按空行切开。
// - 文稿（.docx）、讲义（.pptx）：页面自己把字取出来（office.js），按段落拼成一千多字一条（transcriptChunks / slideChunks），不调用 Claude。
// 一条的样子：{ id: 'B1-23.1', book: 'B1', seq: 45, kind: '例题', title: '例2.1', chapter, section, page, pageEnd, text, pages: [23, 24] }
// 编号按「从第几页开始的第几条」编（B1-23.1）：重转某几页、后来再转别的页，别的条目编号不变，课程地图挂的编号不会错位；
// 目录里一眼看得出在第几页。文稿、讲义没有页，按顺序编（B2-5）。

export const KINDS = ['定义', '定理', '性质', '推论', '公式', '例题', '习题', '方法', '说明', '图表', '文稿', '讲义'];
const ITEM_KINDS = new Set(['标题', ...KINDS]);
export const CHUNK_MAX = 6000; // 一条最多多少字（太长的按空行切开：取的时候一次一条，别太大）
export const PAGES_PER_CALL = 3; // 一次交几页给 Claude 看（图越多一次越慢、输出越长；平台也限制一次几张图）

export const chunkId = (book, seq, k = 0) => (k ? `${book}-${seq}.${k}` : `${book}-${seq}`);
const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const firstLine = (s, n = 24) => { const t = clean(s).replace(/\$+/g, '').replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * 看图转写的提示词。book：{ title, subject }；pages：这次附的几页的页码（PDF 里的第几页，按图的顺序）；
 * ctx：{ chapter, section, last: { kind, title } }（上一页停在哪，好判断第一条是不是接着上一页）；
 * kind：'slides' 是讲义里的图；layer：{ 页码: 文字层 }（PDF 有文字层时给它对照汉字、数字）
 */
export function transcribePrompt(book = {}, pages = [], ctx = {}) {
  const where = [ctx.chapter ? `现在在「${ctx.chapter}」` : '', ctx.section ? `「${ctx.section}」` : ''].filter(Boolean).join('');
  return [
    `你在把一本教材的扫描页逐页转写成文字，存进学生的学习台；以后课堂里的老师（也是 Claude）讲课时按需取用这些文字，学生手边没有书，所以一个字、一个数都不能错。`,
    `教材：${book.title || '（没写书名）'}${book.subject ? `（${book.subject}）` : ''}。这次附了 ${pages.length} 张图，依次是 PDF 的第 ${pages.join('、')} 页。${where ? `${where}。` : ''}${ctx.last ? `上一页最后一条是 ${ctx.last.kind}「${ctx.last.title}」，这次第一页开头如果接着它写，那一条标 "cont": true。` : ''}`,
    '',
    '要求：',
    '1. 忠实转写：不总结、不改写、不补充、不纠正原书。每个数字、符号、上下标、矩阵元素都照原页。看不清的地方写【看不清】，不要猜。',
    '2. 公式用 LaTeX：行内 $…$，单独成行的 $$…$$；矩阵 \\begin{pmatrix}…\\end{pmatrix}，行列式 \\begin{vmatrix}…\\end{vmatrix}，方程组 \\begin{cases}…\\end{cases}。正文里的普通文字不要放进 $ 里。',
    `3. 按内容切成「条」，kind 只能是：标题、${KINDS.filter((k) => k !== '文稿' && k !== '讲义').join('、')}。例题连同它的解答放在同一条，定理连同证明放在同一条；一段讲解是一条「说明」。`,
    '4. 标题条写 level：1 是章（讲）、2 是节、3 是小节；title 写标题原文，text 留空字符串。',
    '5. 每条的 title：例题、定义、定理照书上的编号和名字写（如「例2.1」「定理3（克拉默法则）」）；说明写这段讲什么（十个字以内）。',
    '6. 一条跨页：下一页开头接着写的那一条标 "cont": true，text 只写这一页上的部分，title 照抄上一页那条的。',
    '7. 图：kind 写「图表」，text 用一两句话说图里画了什么（坐标、箭头、标的字）。表格用 Markdown 表格转写。',
    '8. 页眉、页脚、页码、书名水印、广告不要。整页是空白或只有图片装饰，items 写空数组。',
    ...(ctx.kind === 'slides' ? ['', '这些图是讲义（幻灯片、板书截图）里的图：同样照上面的规矩转写图里的字和公式；图里没有字的（照片、装饰）items 写空数组。'] : []),
    ...(ctx.layer && Object.values(ctx.layer).some(Boolean) ? ['', '下面是这几页 PDF 自带的文字层（可能错行、断字，公式是乱的）：汉字、数字可以对照它，公式、矩阵一律以图为准。', ...Object.entries(ctx.layer).filter(([, t]) => t).map(([n, t]) => `【第 ${n} 页的文字层】\n${String(t).slice(0, 4000)}`)] : []),
    '',
    '只输出 JSON，不要别的文字：',
    '{"pages":[{"page":页码,"items":[{"kind":"例题","title":"例2.1","text":"…","cont":false}]}]}',
  ].join('\n');
}

/** 读 Claude 回的 JSON（可能包在 ```json 里）；检查每一页都在、每条的 kind 认得 */
export function parseTranscription(raw, pages = []) {
  let obj = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('回的不是 JSON');
    obj = JSON.parse(m[0]);
  }
  const list = Array.isArray(obj?.pages) ? obj.pages : null;
  if (!list) throw new Error('JSON 里没有 pages');
  const out = new Map();
  list.forEach((p, i) => {
    const n = Number(p?.page ?? pages[i]);
    if (!Number.isInteger(n)) return;
    const items = (Array.isArray(p.items) ? p.items : []).map((it) => ({
      kind: ITEM_KINDS.has(String(it?.kind)) ? String(it.kind) : '说明',
      title: clean(it?.title).slice(0, 80),
      text: clean(it?.text),
      cont: !!it?.cont,
      ...(it?.kind === '标题' ? { level: [1, 2, 3].includes(Number(it.level)) ? Number(it.level) : 2 } : {}),
    })).filter((it) => it.kind === '标题' ? it.title : it.text || it.title);
    out.set(n, items);
  });
  const missing = pages.filter((n) => !out.has(n));
  return { pages: out, missing };
}

/**
 * 每页的结果拼成条目。pageItems：[{ page, items }]（按页码排好）；book：书的编号（B1）。
 * 返回 { chunks, toc: [{ level, title, page, chunk }]（目录：章、节、小节，chunk 是它后面第一条的编号）}
 */
export function assembleChunks(pageItems = [], book = 'B1') {
  const chunks = [];
  const toc = [];
  let chapter = '';
  let section = '';
  let pendingToc = []; // 还没有条目跟在后面的标题：等下一条出来再记它指向谁
  for (const { page, items } of [...pageItems].sort((a, b) => a.page - b.page)) {
    for (const it of items || []) {
      if (it.kind === '标题') {
        if (it.level === 1) { chapter = it.title; section = ''; } else if (it.level === 2) section = it.title;
        const t = { level: it.level, title: it.title, page, chunk: null };
        toc.push(t);
        pendingToc.push(t);
        continue;
      }
      const last = chunks[chunks.length - 1];
      if (it.cont && last && last.pageEnd >= page - 1) {
        last.text = clean(`${last.text}\n\n${it.text}`);
        last.pageEnd = page;
        if (!last.pages.includes(page)) last.pages.push(page);
        continue;
      }
      // 同一节里连着的两小段「说明」并成一条（单独一条太碎，取的时候也不好认）
      if (it.kind === '说明' && last && last.kind === '说明' && last.section === section && last.chapter === chapter && (last.text.length + it.text.length) < 1200 && !pendingToc.length) {
        last.text = clean(`${last.text}\n\n${it.text}`);
        if (!last.pages.includes(page)) last.pages.push(page);
        last.pageEnd = page;
        continue;
      }
      const c = { book, kind: it.kind, title: it.title || firstLine(it.text), chapter, section, page, pageEnd: page, pages: [page], text: clean(it.text) };
      chunks.push(c);
      for (const t of pendingToc) t.chunk = c;
      pendingToc = [];
    }
  }
  // 太长的按空行切开（标题后面写「（续 2）」）
  const out = [];
  for (const c of chunks) {
    if (c.text.length <= CHUNK_MAX) { out.push(c); continue; }
    const parts = splitText(c.text, CHUNK_MAX);
    parts.forEach((text, i) => out.push({ ...c, text, title: i ? `${c.title}（续 ${i + 1}）` : c.title }));
  }
  const onPage = new Map();
  out.forEach((c, i) => { c.seq = i + 1; const k = (onPage.get(c.page) || 0) + 1; onPage.set(c.page, k); c.id = chunkId(book, c.page, k); });
  for (const t of toc) t.chunk = t.chunk ? out.find((c) => c.page === t.chunk.page && c.title === t.chunk.title)?.id || null : null;
  return { chunks: out, toc };
}

/** 按空行（没有就按换行、句号）切成每段不超过 max 字；$$…$$ 公式块不拆开 */
export function splitText(text, max = CHUNK_MAX) {
  const paras = String(text).split(/\n{2,}/);
  const out = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > max) { out.push(cur); cur = ''; }
    if (p.length > max) {
      // 一段就超长：按句号切
      for (const s of p.split(/(?<=[。！？；.!?])\s*/)) {
        if (cur && cur.length + s.length > max) { out.push(cur); cur = ''; }
        cur += s;
      }
      continue;
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 视频课文稿（docx 的段落）：按段落拼成约 target 字一条，不调用 Claude。
 * 自动转录没有标题，title 用这条开头的一句；chapter 写文稿的名字（一讲一个文件）
 */
export function transcriptChunks(paras = [], { book = 'B1', title = '', target = 1600 } = {}) {
  const out = [];
  let cur = [];
  let len = 0;
  const flush = () => { if (!cur.length) return; const text = clean(cur.join('\n\n')); out.push({ book, kind: '文稿', title: firstLine(text, 20), chapter: title, section: '', page: out.length + 1, pageEnd: out.length + 1, pages: [], text }); cur = []; len = 0; };
  for (const p of paras.map((x) => clean(x)).filter(Boolean)) {
    if (len && len + p.length > target) flush();
    if (p.length > CHUNK_MAX) { flush(); splitText(p, target).forEach((s) => { cur = [s]; len = s.length; flush(); }); continue; }
    cur.push(p);
    len += p.length;
  }
  flush();
  out.forEach((c, i) => { c.seq = i + 1; c.id = chunkId(book, c.seq); });
  return out;
}

/** 讲义（pptx）：一页幻灯片一条；media 是这页的图（页面上传进 assets 后换成 img 里的 asset id） */
export function slideChunks(slides = [], { book = 'B1', title = '' } = {}) {
  return slides.filter((s) => s.text || s.media?.length).map((s, i) => ({
    book, kind: '讲义', title: firstLine(s.title || s.text || `第 ${s.n} 页`, 24), chapter: title, section: '', page: s.n, pageEnd: s.n, pages: [s.n], text: clean(s.text) || '（这一页只有图）', media: s.media || [], seq: i + 1, id: chunkId(book, i + 1),
  }));
}

/** PDF 的文字层能不能直接用（有字、不是乱码）：每页平均一百个字以上、汉字或字母占大多数 */
export function textLayerUsable(pagesText = []) {
  const all = pagesText.join('');
  if (!pagesText.length || all.length / pagesText.length < 100) return false;
  const good = (all.match(/[一-龥A-Za-z0-9，。、；：（）()=+\-]/g) || []).length;
  return good / all.length > 0.6;
}

/** 下一本书的编号：B1、B2…（短，目录里每条都要写，越短越省） */
export function nextBookCode(books = []) {
  const used = new Set(books.map((b) => String(b.id || b.code)));
  let n = 1;
  while (used.has(`B${n}`)) n++;
  return `B${n}`;
}
