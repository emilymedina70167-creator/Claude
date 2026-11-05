// 教材板块的读法（docs/textbook-plan.md）：课堂里的 Claude 不一次读整本，每一轮只带「这节课要照着讲的那几条全文」+「这一讲的目录」，
// 别的用工具按编号取（textbook_read）、按词找（textbook_search）、看原页图（textbook_page）。纯函数，有测试。
// 一条：{ id: 'B1-045', book, seq, kind, title, chapter, section, page, pageEnd, pages, text, img? }
// 一本：{ id: 'B1', title, kind: textbook / transcript / slides / notes, space, subject, toc, status }

const one = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const bytes = (s) => (enc ? enc.encode(String(s)).length : Buffer.byteLength(String(s)));
export const BOOK_KINDS = { textbook: '教材', transcript: '视频文稿', slides: '讲义', notes: '笔记' };

/**
 * 一条在第几页（给 Claude 看的写法）：认出书页的（normalizeBooks 的 printed）写「书页 10」，和课程地图、书上的目录同一套；
 * 分段存的（「英语_p013-027」）写整本 PDF 的第几页；别的照旧是这份文件的第几页
 */
export function pageLabel(c) {
  if (!c?.page || c.kind === '文稿') return '';
  const span = (a, b) => `${a}${b && b !== a ? `–${b}` : ''}`;
  if (c.printed) return `书页 ${span(c.printed, c.printedEnd)}`;
  if (c.pdf) return `p.${span(c.pdf, c.pdfEnd)}`;
  return `p.${span(c.page, c.pageEnd)}`;
}

/** 目录里的一行：编号［类型］标题（第几页） */
export const chunkLine = (c) => `${c.id}［${c.kind}］${one(c.title, 30)}${pageLabel(c) ? `（${pageLabel(c)}）` : ''}`;

/** 一条的全文（给 Claude 读的样子）：标题行写出处 */
export function chunkText(c, book = null) {
  const where = [book ? `《${one(book.volTitle || book.title, 30)}》` : '', c.chapter, c.section, pageLabel(c)].filter(Boolean).join(' · ');
  return `### ${c.id}［${c.kind}］${c.title}${where ? `（${where}）` : ''}\n${c.text}`;
}

// —— 分段存的书拼回一本、认出书页（2026-11-05 一节英语课整节没有教材：书传成了 35 个分段文件，每段的页码从 1 数，
//    课程地图写的是书页「010–025」，页面对不上号；老师只能说「资料包里没有书页」）——
const SPLIT_RE = /^(.+?)[_\s-]+p(\d{1,4})\s*-\s*(\d{1,4})$/i;
/** 一本是不是一整本书拆开存的一段：标题或文件名是「名字_p013-027」。返回 { series, from, to } 或 null */
export function splitOf(book) {
  for (const s of [book?.title, String(book?.file || '').replace(/\.pdf$/i, '')]) {
    const m = String(s ?? '').trim().match(SPLIT_RE);
    if (m) return { series: m[1].trim(), from: Number(m[2]), to: Number(m[3]) };
  }
  return null;
}

const normKey = (s) => String(s ?? '').replace(/[\s\u3000—\-－–·.,，、:：;；“”"'‘’《》<>()（）【】\[\]?？!！]/g, '').toLowerCase();
const TOC_LINE = /^\s*(.+?)\s*(?:[…\.·．‥⋯]{2,}|\s{2,}|\t)\s*(\d{1,4})\s*$/;
// 目录的一行：「标题 …… 010」，或者转写成表格「| 5.1.2 | 基本术语 | 125 |」「| 第1章　绪论 | 1 |」（最后一格是页码）。返回 [行, 标题, 页码] 或 null
function tocRow(line) {
  const t = String(line ?? '').trim();
  if (t.startsWith('|')) {
    const cells = t.split('|').map((x) => x.trim()).filter((x, i, a) => i > 0 && i < a.length - 1);
    if (cells.length < 2 || !/^\d{1,4}$/.test(cells.at(-1))) return null;
    const title = cells.slice(0, -1).join(' ').trim();
    return title && !/^[-:\s]+$/.test(title) ? [t, title, cells.at(-1)] : null;
  }
  return t.match(TOC_LINE);
}

/**
 * 书上印的页码比 PDF 的页数少几页（封面、前言不编页）：从书里的「目录」那一条读出「标题 …… 010」，
 * 在同一本书的条目里找这个标题（条目的标题、章、节）第一次出现在 PDF 第几页，差值投票，至少两条对得上才算。
 * list：同一本书的条目（带 pdf）。认不出来是 null
 */
export function tocOffset(list = []) {
  const tocs = list.filter((c) => /目\s*录|contents/i.test(String(c.title || '')));
  if (!tocs.length) return null;
  const first = new Map(); // 标题 → 第一次出现的 PDF 页
  for (const c of list) {
    if (tocs.includes(c) || !c.pdf) continue;
    for (const f of [c.title, c.section, c.chapter]) {
      const k = normKey(f);
      if (k.length >= 4 && (!first.has(k) || first.get(k) > c.pdf)) first.set(k, c.pdf);
    }
  }
  const votes = new Map();
  for (const t of tocs) {
    for (const line of String(t.text || '').split('\n')) {
      const m = tocRow(line);
      if (!m) continue;
      const k = normKey(m[1]);
      if (k.length < 4) continue;
      let at = first.get(k);
      if (at == null && k.length >= 6) for (const [f, p] of first) if (f.includes(k) && (at == null || p < at)) at = p;
      if (at == null) continue;
      const d = at - Number(m[2]);
      if (d >= 0) votes.set(d, (votes.get(d) || 0) + 1);
    }
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best && best[1] >= 2 ? best[0] : null;
}

/**
 * 课堂、备课用的书（不改数据库里的样子，备份照旧用 loadBooks 原样的）：
 * 分段存的几本拼成一本（每条多 vol：哪一本、vseq：在整本里的顺序、pdf：整本 PDF 的第几页），
 * 书上的目录认得出页码时每条多 printed（书页）。没分段、没目录的书只多 vol = 自己的编号、vseq = seq
 */
export function normalizeBooks({ books = [], chunks = [] } = {}) {
  const info = new Map();
  const outBooks = books.map((b) => {
    const sp = splitOf(b);
    const vol = sp ? `${b.space || ''}:${sp.series}` : b.id;
    info.set(b.id, { vol, from: sp ? sp.from : 1, split: !!sp });
    return sp ? { ...b, vol, volTitle: sp.series, from: sp.from } : { ...b, vol };
  });
  const out = chunks.map((c) => {
    const i = info.get(c.book) || { vol: c.book, from: 1, split: false };
    const base = i.from - 1;
    const x = { ...c, vol: i.vol };
    if (c.page) { x.pdf = Number(c.page) + base; if (c.pageEnd) x.pdfEnd = Number(c.pageEnd) + base; }
    return x;
  });
  const byVol = new Map();
  for (const c of out) (byVol.get(c.vol) || byVol.set(c.vol, []).get(c.vol)).push(c);
  for (const list of byVol.values()) {
    list.sort((a, b) => (info.get(a.book)?.from ?? 1) - (info.get(b.book)?.from ?? 1) || (a.seq ?? 0) - (b.seq ?? 0));
    list.forEach((c, k) => { c.vseq = k + 1; });
    const off = tocOffset(list);
    if (off == null) continue;
    for (const c of list) {
      if (!c.pdf || c.pdf - off < 1) continue;
      c.printed = c.pdf - off;
      if (c.pdfEnd && c.pdfEnd - off >= c.printed) c.printedEnd = c.pdfEnd - off;
    }
  }
  // 拆开存的书只把整本里的页码写进去；没拆的书 pdf 就是 page，不另写（少一点字，显示照旧）
  for (const c of out) if (!info.get(c.book)?.split) { delete c.pdf; delete c.pdfEnd; }
  return { books: outBooks, chunks: out };
}

const volOf = (c) => c.vol || c.book;
const pageLo = (c) => Number(c.printed ?? c.pdf ?? c.page);
const pageHi = (c) => Number(c.printed ? c.printedEnd ?? c.printed : c.pdf ? c.pdfEnd ?? c.pdf : c.pageEnd ?? c.page);
const vseqOf = (c) => c.vseq ?? c.seq ?? 0;
/** 按整本书里的顺序比（拼回去的分段算一本） */
const byBookOrder = (a, b) => (volOf(a) === volOf(b) ? vseqOf(a) - vseqOf(b) : String(volOf(a)).localeCompare(String(volOf(b)), undefined, { numeric: true }));

/**
 * 一本书（或几本）的目录，按章节分组，一条一行。around：这节课用到的条目编号，只列它们所在的那几讲（不给就全列）；
 * max：字节上限，超了就只列章、节和每节的条数
 */
export function bookCatalog(books = [], chunks = [], { around = null, max = 6 * 1024 } = {}) {
  // 分段存的几本（normalizeBooks 的 vol）当一本列：标题是整本的名字，后面写是哪几个编号拼的
  const key = (c) => `${volOf(c)}|${c.chapter || ''}`;
  const near = around && around.length ? new Set(chunks.filter((c) => around.includes(c.id)).map(key)) : null;
  const lines = [];
  const brief = [];
  const vols = [];
  for (const b of books) { const v = b.vol || b.id; if (!vols.some((x) => x.vol === v)) vols.push({ vol: v, books: books.filter((y) => (y.vol || y.id) === v) }); }
  for (const { vol, books: bs } of vols) {
    const ids = new Set(bs.map((b) => b.id));
    const mine = chunks.filter((c) => ids.has(c.book) && (!near || near.has(key(c)))).sort(byBookOrder);
    if (!mine.length) continue;
    const b = bs[0];
    const name = bs.length > 1 ? `${bs[0].id}～${bs.at(-1).id}《${one(b.volTitle || b.title, 30)}》（一本书分 ${bs.length} 段存的）` : `${b.id}《${one(b.volTitle || b.title, 30)}》`;
    lines.push(`**${name}${BOOK_KINDS[b.kind] ? `（${BOOK_KINDS[b.kind]}）` : ''}**`);
    brief.push(lines[lines.length - 1]);
    let ch = null;
    let sec = null;
    for (const c of mine) {
      if (c.chapter !== ch) { ch = c.chapter; sec = null; if (ch) lines.push(`- ${ch}`); }
      if (c.section !== sec) { sec = c.section; if (sec) lines.push(`  - ${sec}`); }
      lines.push(`${sec ? '    ' : '  '}- ${chunkLine(c)}`);
    }
    // 短的：每章（没有章的书按节）一行，几条、从哪条起、在哪一页
    const groups = [];
    for (const c of mine) {
      const g = c.chapter ? `- ${c.chapter}` : c.section ? `  - ${c.section}` : '';
      if (!g) continue;
      const last = groups.at(-1);
      if (last && last.g === g) last.n++;
      else groups.push({ g, n: 1, c });
    }
    for (const x of groups) brief.push(`${x.g}：${x.n} 条（${x.c.id} 起${pageLabel(x.c) ? `，${pageLabel(x.c)}` : ''}）`);
  }
  const full = lines.join('\n');
  if (bytes(full) <= max) return full;
  const short = brief.join('\n');
  if (bytes(short) <= max) return short;
  const keep = [];
  let used = 0;
  for (const l of brief) { if (used + bytes(l) + 1 > max - 40) break; keep.push(l); used += bytes(l) + 1; }
  return `${keep.join('\n')}\n……（后面还有，用 textbook_search 按词找）`;
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
    if (book && c.book !== book && c.vol !== book) continue;
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

/** 按编号、范围或书页取（textbook_read）：一次最多 max 字节，放不下的写在 more 里 */
export function readChunks(chunks = [], books = [], ids = [], { max = 48 * 1024, pages = '', book = '' } = {}) {
  // 一次取够（每取一次课堂要多跑一整轮：2026-11-02 一节课取了 21 次，一次一两条）：
  // 编号可以写范围「B1-10.1~B1-17.3」（按书里的顺序，含两头），也可以按书页取「10-17」
  // 按整本书里的顺序（以前只按 seq 排，几本书的 seq 混在一起，范围会串到别的书里）
  const order = [...chunks].sort((a, b) => byBookOrder(a, b) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const raw = (Array.isArray(ids) ? ids : String(ids || '').split(/[,，\s]+/)).map((x) => String(x).trim()).filter(Boolean);
  const want = [];
  const missing = [];
  for (const r of raw) {
    const m = r.split(/\s*[~～]\s*/);
    if (m.length === 2) {
      const a = order.findIndex((c) => c.id === m[0]);
      const b = order.findIndex((c) => c.id === m[1]);
      if (a < 0 || b < a) { missing.push(r); continue; }
      want.push(...order.slice(a, b + 1).map((c) => c.id));
    } else want.push(r);
  }
  const pm = String(pages || '').trim().match(/^(\d{1,4})(?:\s*[-~～—–到]\s*(\d{1,4}))?$/);
  if (pm) {
    const lo = Number(pm[1]), hi = Number(pm[2] ?? pm[1]);
    // 书页按目录里写的那一套（pageLabel：认出书页的是书页，分段存的是整本的页）
    want.push(...order.filter((c) => (!book || c.book === book || c.vol === book) && pageLo(c) <= Math.max(lo, hi) && pageHi(c) >= Math.min(lo, hi)).map((c) => c.id));
  }
  const out = [];
  const got = [];
  const more = [];
  let used = 0;
  // 一次最多 150 条（再多由 48 KB 的上限管）：多出来的也算进 more（以前悄悄截掉，2026-11-02 取「20-40 页」只拿到前半，它换着页码又取了 5 次）
  for (const [k, id] of [...new Set(want)].entries()) {
    if (k >= 150) { more.push(id); continue; }
    const c = chunks.find((x) => x.id === id);
    if (!c) { missing.push(id); continue; }
    const t = chunkText(c, books.find((b) => b.id === c.book));
    if (out.length && used + bytes(t) > max) { more.push(id); continue; }
    used += bytes(t);
    out.push(t);
    got.push(c.id);
  }
  return { text: out.join('\n\n'), ids: got, missing, more };
}

/**
 * 这节课 Claude 用 textbook_read 取到过的条目编号（最近取的在后面）。calls 是各轮记下的工具调用（class_turns 的 tools），
 * 按当时的参数再解析一遍：页面调用 Claude 不记得上一轮，工具的结果不进对话，所以取过的条目要页面替它留着——
 * 不留的话它每讲一段就要再取一次（2026-11-02 一节课 B1-17.3 取了十次，每次多等一整轮）
 */
export function readHistory(calls = [], chunks = [], books = []) {
  const seen = [];
  for (const c of calls || []) {
    if (c?.name !== 'textbook_read') continue;
    const inp = c.input || {};
    const { ids } = readChunks(chunks, books, inp.ids || [], { pages: inp.pages || '', book: inp.book || '' });
    for (const id of ids) { const i = seen.indexOf(id); if (i >= 0) seen.splice(i, 1); seen.push(id); }
  }
  return seen;
}

/**
 * 课程地图的一块写的书页：范围「书页 010–025」、教材出处「王道 2026 版 p.269」（只有一页就是那一页）。
 * 「教材第1讲 P1–8」这种一讲一讲编页的不算（和书上印的页码不是一套）。返回 [[lo, hi], …]
 */
export function blockPages(block) {
  const refs = [block?.scope, ...(Array.isArray(block?.textbook) ? block.textbook.map((t) => t?.ref) : [])].map((x) => String(x ?? ''));
  const out = [];
  const add = (a, b) => { const lo = Number(a), hi = Number(b ?? a); if (lo > 0 && hi >= lo && hi - lo < 80) out.push([lo, hi]); };
  for (const r of refs) {
    for (const m of r.matchAll(/书页\s*(\d{1,4})(?:\s*[–—\-~～至到]\s*(\d{1,4}))?/g)) add(m[1], m[2]);
    if (/讲|书页/.test(r)) continue;
    for (const m of r.matchAll(/(?:^|[^a-z])p\.?\s*(\d{1,4})(?:\s*[–—\-~～]\s*(\d{1,4}))?/gi)) add(m[1], m[2]);
  }
  return out;
}

/**
 * 课程地图的一块挂了哪些条目：curriculum 的 chunks 字段（按教材顺序）。
 * 没挂的（2026-11-05 课程地图 80 块一块都没挂）按这一块写的书页找：只认 normalizeBooks 认出书页（printed）的书，
 * 几本都对得上（同一本书以前转过一份不全的）取对上条数最多的那一本
 */
export function blockChunks(block, chunks = []) {
  const ids = Array.isArray(block?.chunks) ? block.chunks.map(String) : [];
  if (ids.length) return ids.map((id) => chunks.find((c) => c.id === id)).filter(Boolean);
  return chunksByPages(blockPages(block), chunks);
}

export function chunksByPages(ranges = [], chunks = []) {
  if (!ranges.length) return [];
  const hit = chunks.filter((c) => c.printed && ranges.some(([lo, hi]) => c.printed <= hi && (c.printedEnd ?? c.printed) >= lo));
  if (!hit.length) return [];
  const n = new Map();
  for (const c of hit) n.set(volOf(c), (n.get(volOf(c)) || 0) + 1);
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return hit.filter((c) => volOf(c) === best).sort(byBookOrder);
}

/**
 * 课堂里的教材（docs/textbook-plan.md）：资料包点名的条目（main.chunks，备课时挑的）全文放进资料包的「教材原文」，
 * 这一块挂着的、同一讲的条目列目录（按需取），点名条目的原页图给 image 组件按编号贴、view_image 自己看。
 * main：资料包；block：课程地图的这一块（chunks 字段）；tools：能不能用 textbook_read 这些工具。
 * 返回 { textbook（全文，没有就是空串）, catalog（目录 + 怎么取，没有书就是空串）, images: [{ name, id, title }] }
 */
// read：这节课取过的条目（readHistory，最近的在后面）。它们一直留在「教材原文」里，最多 readMax（最近取的优先）；
// 备课点名的条目照旧最多 max。取过的排在前面（资料包太长要截时从末尾截，先截的是备课点名、它还没取过的），各自按书里的顺序
// ahead：顺着往下讲是常态，取过的里最靠后的那条之后，再顺带放 aheadMax 的接下来几条（同一本书），讲到那里不用先取
// room：再往里放多少字节（课堂按这一轮整份说明还剩多少算好给，class/bookroom.js；0 就是上面这些）。
// 这一块所在的整章（点名的、挂着的、取过的条目所在的章）其余条目按离这些条目的远近往里放（同样远先放后面的：顺着往下讲是常态），
// 整章都放下了再放章外紧挨着的几条（最多 nearMax）。实测（2026-11-02、03 三节课 68 轮）老师调了 21 次 textbook_read，
// 每次多等一整轮（10 秒以上），而说明从 4 KB 加到 160 KB 出第一个字的时间看不出变化：多放原文比让它取划算得多
export function textbookForClass({ main = null, block = null, books = [], chunks = [], tools = true, max = 40 * 1024, read = [], readMax = 32 * 1024, aheadMax = 12 * 1024, room = 0, nearMax = 16 * 1024 } = {}) {
  if (!chunks.length) return { textbook: '', catalog: '', images: [] };
  const named = (Array.isArray(main?.chunks) ? main.chunks : []).map((id) => chunks.find((c) => c.id === id)).filter(Boolean);
  const mine = named.length ? named : blockChunks(block, chunks);
  const textOf = (c) => chunkText(c, books.find((b) => b.id === c.book));
  const pick = new Map(); // id → 全文
  let used = 0;
  // 先留取过的：最近取的优先，放不下的是最早取的
  const kept = [];
  let nRead;
  for (const id of [...(read || [])].reverse()) {
    const c = chunks.find((x) => x.id === id);
    if (!c || pick.has(id)) continue;
    const t = textOf(c);
    if (pick.size && used + bytes(t) > readMax) break;
    used += bytes(t);
    pick.set(id, t);
    kept.push(id);
  }
  if (kept.length && aheadMax > 0) {
    const last = chunks.find((c) => c.id === (read || []).at(-1));
    const after = last ? chunks.filter((c) => volOf(c) === volOf(last) && vseqOf(c) > vseqOf(last)).sort(byBookOrder) : [];
    nRead = kept.length;
    let room = aheadMax;
    for (const c of after) {
      if (pick.has(c.id)) continue;
      const t = textOf(c);
      if (bytes(t) > room) break;
      room -= bytes(t);
      used += bytes(t);
      pick.set(c.id, t);
      kept.push(c.id);
    }
  }
  const total = kept.length ? max + readMax + aheadMax : max;
  for (const c of mine) {
    if (pick.has(c.id)) continue;
    const t = textOf(c);
    if (pick.size && used + bytes(t) > total) break;
    used += bytes(t);
    pick.set(c.id, t);
  }
  // 整章：锚是点名 / 挂着的和取过的（接着往下顺带的不算：它可能已经跨进下一章）
  const readIds = kept.slice(0, nRead ?? kept.length);
  const fill = chapterFill({ chunks, anchors: [...mine.map((c) => c.id), ...readIds], pick, textOf, room, nearMax });
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const inOrder = (ids) => [...ids].sort((a, b) => byBookOrder(byId.get(a) || {}, byId.get(b) || {})).map((id) => pick.get(id));
  const full = [...inOrder(kept), ...inOrder([...pick.keys()].filter((id) => !kept.includes(id)))];
  if (fill.ids.length || fill.chapters.some((x) => x.all)) full.unshift(fillNote(fill, books));
  // 课程地图没挂条目、页面按这一块写的书页找到的：告诉老师这就是那几页，不用再让学生传（2026-11-05 老师以为没有书，要学生「把书页传进资料包」）
  if (!named.length && !(Array.isArray(block?.chunks) && block.chunks.length) && mine.length) {
    const pg = blockPages(block).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join('、');
    full.unshift(`（这一块在课程地图里写的是书页 ${pg}：页面按书页找到了这几页的 ${mine.length} 条原文，就在下面——这就是学生传进学习台的教材，照着讲，不要再让学生传。）`);
  }
  if (kept.length) {
    const n = nRead ?? kept.length;
    full.unshift(`（前面 ${kept.length} 条是页面替你留着的：其中 ${n} 条是你这节课用 textbook_read 取过的${kept.length > n ? `，${kept.length - n} 条是接着往下的几条` : ''}。这节课后面每一轮都带着，照着讲不用再取。）`);
  }
  // 目录跟着讲到的地方：备课点名的那几讲，加上取过的
  const around = [...new Set([...mine.map((c) => c.id), ...kept])];
  const cat = bookCatalog(books, chunks, { around: around.length ? around : null, max: 6 * 1024 });
  const how = tools
    ? (fill.chapters.some((x) => x.all) ? '这一章的原文都在「教材原文」里，一般不用 textbook_read。' : '')
      + '上面没放全文的条目，用 textbook_read 取（取过的页面会一直留在「教材原文」里，不用再取）：ids 写编号，连着的一串写范围「B1-10.1~B1-17.3」，或者 pages 写书页「10-17」——**要讲一整节就一次取一整节**，不要一条一条取；不知道在哪就用 textbook_search 按词找（比如「伴随矩阵」「克拉默」）；要核对转写、照原页讲，用 textbook_page 看那条的原页图，或者用 image 组件把原页贴上黑板（name 写条目编号）。每用一次工具要多等一整轮，挑准了再取。'
    : '这个查看方式不能用工具：目录里的条目取不了全文。';
  const images = mine.flatMap((c) => (Array.isArray(c.img) ? c.img.slice(0, 2) : []).map((id, i) => ({ name: i ? `${c.id}-${i + 1}` : c.id, id, title: `${c.title}（原页${c.page ? ` p.${c.page}` : ''}）` }))).slice(0, 16);
  return { textbook: full.join('\n\n'), catalog: cat ? `${cat}\n\n${how}` : '', images, fill: { ids: fill.ids, chapters: fill.chapters } };
}

const chapterKey = (c) => `${volOf(c)}|${c.chapter || ''}`;

/**
 * 往 pick 里按远近补整章（改 pick）。anchors：已经放进去的点名 / 挂着的 / 取过的条目编号；room：最多再放多少字节。
 * 一个方向（往后 / 往前）放不下就停在那个方向，不跳过去放更远的（原文中间不留洞）。
 * 返回 { ids: 补进去的, chapters: [{ book, chapter, n（这一章几条）, all（全放下了没有）}] }
 */
export function chapterFill({ chunks = [], anchors = [], pick, textOf, room = 0, nearMax = 16 * 1024 }) {
  const out = { ids: [], chapters: [] };
  const base = anchors.map((id) => chunks.find((c) => c.id === id)).filter(Boolean);
  if (!(room > 0) || !base.length) return out;
  const chs = new Set(base.map(chapterKey));
  const books = new Set(base.map(volOf));
  // 离最近的锚多远（按书里的顺序，分段存的按整本的顺序 vseq），往后的是 +1、往前的是 -1；同样远先放往后的
  const where = (c, from) => {
    let d = Infinity, dir = 1;
    for (const a of from) {
      if (volOf(a) !== volOf(c)) continue;
      const k = vseqOf(c) - vseqOf(a);
      if (Math.abs(k) < d || (Math.abs(k) === d && k > 0)) { d = Math.abs(k); dir = k > 0 ? 1 : -1; }
    }
    return { c, d, dir };
  };
  const byNear = (list, from = base) => list.map((c) => where(c, from)).sort((x, y) => x.d - y.d || y.dir - x.dir || vseqOf(x.c) - vseqOf(y.c));
  let left = room;
  const put = (cands, cap) => {
    const stop = new Set();
    let got = 0;
    for (const x of cands) {
      if (stop.has(x.dir)) continue;
      const w = bytes(textOf(x.c)) + 2; // 段与段之间的空行
      if (w > left || got + w > cap) { stop.add(x.dir); continue; }
      left -= w;
      got += w;
      pick.set(x.c.id, textOf(x.c));
      out.ids.push(x.c.id);
    }
  };
  put(byNear(chunks.filter((c) => chs.has(chapterKey(c)) && !pick.has(c.id))), Infinity);
  for (const k of chs) {
    const all = chunks.filter((c) => chapterKey(c) === k);
    const [book, ...rest] = k.split('|');
    out.chapters.push({ book, chapter: rest.join('|'), n: all.length, all: all.every((c) => pick.has(c.id)) });
  }
  // 整章都放下了：章外紧挨着的（同一本书，上一章的末尾、下一章的开头）再放一点，讲到边上不用先取。远近从这一章的两头量
  if (out.chapters.every((x) => x.all) && left > 0) {
    const edge = chunks.filter((c) => chs.has(chapterKey(c)));
    put(byNear(chunks.filter((c) => books.has(volOf(c)) && !chs.has(chapterKey(c)) && !pick.has(c.id)), edge), nearMax);
  }
  return out;
}

// 「教材原文」开头的一句：这一章的原文放了多少、要不要再取
function fillNote(fill, books = []) {
  const name = (x) => { const b = books.find((y) => (y.vol || y.id) === x.book); return x.chapter ? `「${one(x.chapter, 30)}」` : `《${one(b?.volTitle || b?.title || x.book, 30)}》`; };
  const all = fill.chapters.filter((x) => x.all);
  const part = fill.chapters.filter((x) => !x.all);
  return [
    '（页面开课时按这一块放好了整章的原文：',
    all.length ? `${all.map(name).join('、')}的 ${all.reduce((n, x) => n + x.n, 0)} 条全在下面，一般不用 textbook_read` : '',
    all.length && part.length ? '；' : '',
    part.length ? `${part.map(name).join('、')}放不下全部，下面是离这节课讲到的地方最近的那些，目录里没放全文的再取` : '',
    '。）',
  ].join('');
}
