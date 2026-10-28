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
