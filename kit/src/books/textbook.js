// 教材板块的读法（docs/textbook-plan.md）：课堂里的 Claude 不一次读整本，每一轮只带「这节课要照着讲的那几条全文」+「这一讲的目录」，
// 别的用工具按编号取（textbook_read）、按词找（textbook_search）、看原页图（textbook_page）。纯函数，有测试。
// 一条：{ id: 'B1-045', book, seq, kind, title, chapter, section, page, pageEnd, pages, text, img? }
// 一本：{ id: 'B1', title, kind: textbook / transcript / slides / notes, space, subject, toc, status }

const one = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const bytes = (s) => (enc ? enc.encode(String(s)).length : Buffer.byteLength(String(s)));
export const BOOK_KINDS = { textbook: '教材', transcript: '视频文稿', slides: '讲义', notes: '笔记' };

/** 目录里的一行：编号［类型］标题（第几页） */
export const chunkLine = (c) => `${c.id}［${c.kind}］${one(c.title, 30)}${c.page && c.kind !== '文稿' ? `（p.${c.page}${c.pageEnd && c.pageEnd !== c.page ? `–${c.pageEnd}` : ''}）` : ''}`;

/** 一条的全文（给 Claude 读的样子）：标题行写出处 */
export function chunkText(c, book = null) {
  const where = [book?.title ? `《${one(book.title, 30)}》` : '', c.chapter, c.section, c.page && c.kind !== '文稿' ? `p.${c.page}${c.pageEnd && c.pageEnd !== c.page ? `–${c.pageEnd}` : ''}` : ''].filter(Boolean).join(' · ');
  return `### ${c.id}［${c.kind}］${c.title}${where ? `（${where}）` : ''}\n${c.text}`;
}

/**
 * 一本书（或几本）的目录，按章节分组，一条一行。around：这节课用到的条目编号，只列它们所在的那几讲（不给就全列）；
 * max：字节上限，超了就只列章、节和每节的条数
 */
export function bookCatalog(books = [], chunks = [], { around = null, max = 6 * 1024 } = {}) {
  const near = around && around.length ? new Set(chunks.filter((c) => around.includes(c.id)).map((c) => `${c.book}|${c.chapter}`)) : null;
  const lines = [];
  const brief = [];
  for (const b of books) {
    const mine = chunks.filter((c) => c.book === b.id && (!near || near.has(`${c.book}|${c.chapter}`))).sort((x, y) => x.seq - y.seq);
    if (!mine.length) continue;
    lines.push(`**${b.id}《${one(b.title, 30)}》${BOOK_KINDS[b.kind] ? `（${BOOK_KINDS[b.kind]}）` : ''}**`);
    brief.push(lines[lines.length - 1]);
    let ch = null;
    let sec = null;
    let n = 0;
    for (const c of mine) {
      if (c.chapter !== ch) { ch = c.chapter; sec = null; if (ch) { lines.push(`- ${ch}`); brief.push(`- ${ch}：${mine.filter((x) => x.chapter === ch).length} 条（${mine.find((x) => x.chapter === ch).id} 起）`); } }
      if (c.section !== sec) { sec = c.section; if (sec) lines.push(`  - ${sec}`); }
      lines.push(`${sec ? '    ' : '  '}- ${chunkLine(c)}`);
      n++;
    }
  }
  const full = lines.join('\n');
  return bytes(full) <= max ? full : brief.join('\n');
}

// 搜索：中文按两个字一组（「伴随」「随矩」「矩阵」）比，英文、数字按词。标题命中算三倍
const grams = (s) => {
  const t = String(s ?? '').toLowerCase();
  const out = new Set();
  for (const w of t.match(/[a-z0-9]+/g) || []) out.add(w);
  const zh = t.replace(/[^一-龥]/g, ' ').split(/\s+/).filter(Boolean);
  for (const w of zh) { if (w.length === 1) out.add(w); for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2)); }
  return out;
};
export function searchChunks(chunks = [], query = '', { limit = 8, book = '' } = {}) {
  const q = grams(query);
  if (!q.size) return [];
  const raw = String(query).trim().toLowerCase();
  const scored = [];
  for (const c of chunks) {
    if (book && c.book !== book) continue;
    const title = String(c.title || '').toLowerCase();
    const body = String(c.text || '').toLowerCase();
    let s = 0;
    for (const g of q) { if (title.includes(g)) s += 3; if (body.includes(g)) s += 1; }
    if (raw && (title.includes(raw) || body.includes(raw))) s += 5;
    if (s > 0) scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s || a.c.seq - b.c.seq);
  // 只沾了一个常见词（「矩阵」）的不算：分数不到最高的三分之一就不列
  const top = scored[0]?.s || 0;
  return scored.filter((x) => x.s * 3 >= top).slice(0, limit).map(({ c, s }) => {
    const body = String(c.text || '');
    const hit = [...q].map((g) => body.toLowerCase().indexOf(g)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
    return { id: c.id, kind: c.kind, title: c.title, page: c.page, score: s, snippet: one(body.slice(Math.max(0, hit - 40), hit + 120), 160) };
  });
}

/** 按编号取几条（textbook_read）：一次最多 max 字节，放不下的写在 more 里 */
export function readChunks(chunks = [], books = [], ids = [], { max = 24 * 1024 } = {}) {
  const want = [...new Set((Array.isArray(ids) ? ids : String(ids).split(/[,，\s]+/)).map((x) => String(x).trim()).filter(Boolean))].slice(0, 12);
  const out = [];
  const missing = [];
  const more = [];
  let used = 0;
  for (const id of want) {
    const c = chunks.find((x) => x.id === id);
    if (!c) { missing.push(id); continue; }
    const t = chunkText(c, books.find((b) => b.id === c.book));
    if (out.length && used + bytes(t) > max) { more.push(id); continue; }
    used += bytes(t);
    out.push(t);
  }
  return { text: out.join('\n\n'), missing, more };
}

/** 课程地图的一块挂了哪些条目：curriculum 的 chunks 字段（按教材顺序） */
export function blockChunks(block, chunks = []) {
  const ids = Array.isArray(block?.chunks) ? block.chunks.map(String) : [];
  return ids.map((id) => chunks.find((c) => c.id === id)).filter(Boolean);
}

/**
 * 课堂里的教材（docs/textbook-plan.md）：资料包点名的条目（main.chunks，备课时挑的）全文放进资料包的「教材原文」，
 * 这一块挂着的、同一讲的条目列目录（按需取），点名条目的原页图给 image 组件按编号贴、view_image 自己看。
 * main：资料包；block：课程地图的这一块（chunks 字段）；tools：能不能用 textbook_read 这些工具。
 * 返回 { textbook（全文，没有就是空串）, catalog（目录 + 怎么取，没有书就是空串）, images: [{ name, id, title }] }
 */
export function textbookForClass({ main = null, block = null, books = [], chunks = [], tools = true, max = 40 * 1024 } = {}) {
  if (!chunks.length) return { textbook: '', catalog: '', images: [] };
  const named = (Array.isArray(main?.chunks) ? main.chunks : []).map((id) => chunks.find((c) => c.id === id)).filter(Boolean);
  const mine = named.length ? named : blockChunks(block, chunks);
  let used = 0;
  const full = [];
  for (const c of mine) {
    const t = chunkText(c, books.find((b) => b.id === c.book));
    if (full.length && used + bytes(t) > max) break;
    used += bytes(t);
    full.push(t);
  }
  const around = mine.map((c) => c.id);
  const cat = bookCatalog(books, chunks, { around: around.length ? around : null, max: 6 * 1024 });
  const how = tools
    ? '上面没放全文的条目，用 textbook_read 按编号取（ids 一次写几条）；不知道在哪就用 textbook_search 按词找（比如「伴随矩阵」「克拉默」）；要核对转写、照原页讲，用 textbook_page 看那条的原页图，或者用 image 组件把原页贴上黑板（name 写条目编号）。每用一次工具要多等一整轮，挑准了再取。'
    : '这个查看方式不能用工具：目录里的条目取不了全文。';
  const images = mine.flatMap((c) => (Array.isArray(c.img) ? c.img.slice(0, 2) : []).map((id, i) => ({ name: i ? `${c.id}-${i + 1}` : c.id, id, title: `${c.title}（原页${c.page ? ` p.${c.page}` : ''}）` }))).slice(0, 16);
  return { textbook: full.join('\n\n'), catalog: cat ? `${cat}\n\n${how}` : '', images };
}
