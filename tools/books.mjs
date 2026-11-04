#!/usr/bin/env node
// 在 Claude Code 里转教材（docs/textbook-plan.md「在 Claude Code 里转」）。学习台里只存原页图、不调用 Claude；这边：
//   1. ArtifactData list 把书和页存到本地（out_dir）：books/B3.json、books/B3/pages/*.json
//   2. node tools/books.mjs plan  --dump 目录 --book B3 [--pages 64-81,55] [--per 4] --work 工作目录
//      → 每批一个 bNNN.prompt.txt（转写的规矩，和学习台里原来用的同一份 transcribePrompt）、bNNN.json（页码 → 原页图的 asset id）
//   3. 每批交给一个转写助手：取这几张原页图（Artifact read 的 path）、看图、照 prompt 写成 bNNN.out.txt
//   4. node tools/books.mjs apply --book B3 --work 工作目录 --by 模型
//      → 读每批的 out.txt（ingest.js 的 parseTranscription），拼成收件箱记录 inbox/*.json，打印 ArtifactData batch 的 writes
//   5. ArtifactData batch 写进 book_inbox；学习台打开时（bookview.js 的 takeInbox）并进各页、自己拼条目
// 收件箱每批一条新记录：不改已有的页、不用管版本号，学习台那边同时在存别的页也不冲突。
//
// PDF 放在我的私有仓库里时（不经过学习台存页）：
//   0. node tools/books.mjs render --pdf 文件 --book B3 --from 82 --to 412 --work 工作目录 [--title … --space cs --subject 数据结构] [--first 151 --total 412]
//      （PDF 超过 100 MB 拆成几份放进仓库时：--first 是这一份的第 1 页在原书里是第几页，--total 是原书一共几页；页码照原书记）
//      → 这边画页（pdftoppm，1200 像素宽）、按 crop.js 同一套规则裁白边、认空白页，写 pages.json 和每页的 jpg
//   1. 原页图传进学习台的 assets（Artifact publish asset，一次 25 张），把「页码 → asset id」记进 assets.json
//   2. plan 不带 --dump、带 --local：直接用这边的 jpg；apply 时收件箱带上书的信息和每页的原页图，学习台连书带页一起建
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { transcribePrompt, parseTranscription } from '../kit/src/books/ingest.js';
import { contentBox, scaleBox } from '../kit/src/books/crop.js';

const WIDTH = 1200; // 和学习台存的原页图一样宽
const SMALL = 400; // 找内容用的小图

/** 读 pdftoppm -gray 出的 PGM（P5） */
export function readPgm(buf) {
  let pos = 0;
  const next = () => {
    while (/\s/.test(String.fromCharCode(buf[pos]))) pos++;
    if (buf[pos] === 35) { while (buf[pos] !== 10) pos++; return next(); } // # 注释
    let s = '';
    while (!/\s/.test(String.fromCharCode(buf[pos]))) s += String.fromCharCode(buf[pos++]);
    return s;
  };
  if (next() !== 'P5') throw new Error('不是 P5 的 PGM');
  const w = Number(next()), h = Number(next()), max = Number(next());
  pos++; // 头后面一个空白
  if (max > 255) throw new Error('只认 8 位灰度');
  return { w, h, gray: buf.subarray(pos, pos + w * h) };
}

function render() {
  const pdf = opt('pdf'), book = opt('book'), work = opt('work');
  if (!pdf || !book || !work) throw new Error('要 --pdf 文件 --book B3 --work 工作目录');
  const count = Number(execFileSync('pdfinfo', [pdf]).toString().match(/Pages:\s+(\d+)/)?.[1] || 0);
  const shift = (Number(opt('first', 1)) || 1) - 1; // 拆开的一份：这份第 k 页 = 原书第 k + shift 页
  const total = Number(opt('total', 0)) || count + shift;
  // --from / --to 写原书的页码
  const from = Math.max(1 + shift, Number(opt('from', 1 + shift)) || 1 + shift), to = Math.min(count + shift, Number(opt('to', count + shift)) || count + shift);
  const dir = path.join(work, book, 'pages');
  fs.mkdirSync(dir, { recursive: true });
  const listFile = path.join(work, book, 'pages.json');
  const old = fs.existsSync(listFile) ? readJson(listFile) : null;
  const have = new Map((old?.pages || []).map((p) => [p.n, p]));
  const tmp = path.join(work, book, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  for (let n = from; n <= to; n++) {
    if (have.has(n) && fs.existsSync(have.get(n).file || '')) continue;
    const base = path.join(tmp, `s${n}`);
    const k = n - shift; // 这一份 PDF 里的第几页
    execFileSync('pdftoppm', ['-f', k, '-l', k, '-gray', '-scale-to-x', SMALL, '-scale-to-y', -1, '-singlefile', pdf, base].map(String));
    const { w, h, gray } = readPgm(fs.readFileSync(`${base}.pgm`));
    fs.rmSync(`${base}.pgm`);
    const found = contentBox(gray, w, h);
    const H = Math.round((h * WIDTH) / w);
    const box = found.box ? scaleBox(found.box, WIDTH / w, WIDTH, H) : { x: 0, y: 0, w: WIDTH, h: H };
    const out = path.join(dir, `p${pad(n)}`);
    execFileSync('pdftoppm', ['-f', k, '-l', k, '-jpeg', '-jpegopt', 'quality=80', '-scale-to-x', WIDTH, '-scale-to-y', -1,
      '-x', box.x, '-y', box.y, '-W', box.w, '-H', box.h, '-singlefile', pdf, out].map(String));
    let layer = '';
    try { layer = execFileSync('pdftotext', ['-f', k, '-l', k, pdf, '-'].map(String)).toString().replace(/[ \t]+/g, ' ').trim().slice(0, 6000); } catch { /* 没有文字层 */ }
    have.set(n, { n, file: path.resolve(`${out}.jpg`), size: [box.w, box.h], blank: !!found.blank && !layer, layer });
    if (n % 20 === 0) console.error(`画到第 ${n} 页`);
  }
  const info = { title: opt('title', old?.info?.title || path.basename(pdf, '.pdf')), kind: opt('kind', old?.info?.kind || 'textbook'), space: opt('space', old?.info?.space || 'cs'), subject: opt('subject', old?.info?.subject || ''), pages: total, file: old?.info?.file || path.basename(pdf) };
  const pages = [...have.values()].sort((a, b) => a.n - b.n);
  fs.writeFileSync(listFile, JSON.stringify({ book, info, pages }, null, 1));
  console.log(JSON.stringify({ book, total, rendered: pages.length, blank: pages.filter((p) => p.blank).map((p) => p.n) }));
}

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const pad = (n) => String(n).padStart(3, '0');

/** 「64-81,55」→ [55, 64, 65, …, 81] */
export function parseRange(s = '') {
  const out = new Set();
  for (const part of String(s).split(/[,，、\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:[-–~](\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2] || m[1]);
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/** 要转的页分批：连着的页才放一批，一批最多 per 页 */
export function batchesOf(nums = [], per = 4) {
  const out = [];
  for (const n of [...nums].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last.length < per && last[last.length - 1] === n - 1) last.push(n);
    else out.push([n]);
  }
  return out;
}

// 上一页停在哪（和 importer.js 的 ctxBefore 一样）：给转写判断这几页开头是不是接着上一页
function ctxBefore(pages, n) {
  let chapter = '', section = '';
  for (const p of pages.filter((x) => x.n < n && x.status === 'done').sort((a, b) => a.n - b.n)) {
    for (const it of p.items || []) if (it.kind === '标题') { if (it.level === 1) { chapter = it.title; section = ''; } else if (it.level === 2) section = it.title; }
  }
  const prev = pages.find((x) => x.n === n - 1 && x.status === 'done');
  const it = prev ? [...(prev.items || [])].reverse().find((x) => x.kind !== '标题') : null;
  return { chapter, section, last: it ? { kind: it.kind, title: it.title } : null };
}

function loadDump(dir, book) {
  const info = readJson(path.join(dir, 'books', `${book}.json`));
  const pdir = path.join(dir, 'books', book, 'pages');
  const pages = fs.readdirSync(pdir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(pdir, f))).map((p) => ({ ...p, n: Number(p.n) }));
  return { info, pages: pages.sort((a, b) => a.n - b.n) };
}

// 告诉转写的模型这是什么：学生自己的书，转了只存进学生私人的学习台自己复习（页面里的 Haiku 以为是要外传，不肯转）
const CONTEXT = '（这些是学生自己手里这本教材的扫描页。转写的文字只存进学生私人的学习台，上课时给讲课的老师按条取用，不对外发布。）';
// 小模型常把「第 N 页」写成页眉上印的页码：写明用我给的编号（apply 读回时万一没照做，也按顺序对回去）
const pageRule = (nums) => `\n【页码】分页行「=== 第 N 页」里的 N 一律用我给的编号 ${nums.join('、')}（按图的先后顺序），不要用页面上印的页码。\n`;

function plan() {
  const dir = opt('dump'), book = opt('book'), work = opt('work');
  const local = args.includes('--local');
  if ((!dir && !local) || !book || !work) throw new Error('要 --dump 目录（或 --local）--book B3 --work 工作目录');
  const per = Number(opt('per', 4)) || 4;
  // --local：用这边画好的页（pages.json）；带了 --dump 时，学习台里已经转好的页拿来判断「接着上一页」
  const dumped = dir ? loadDump(dir, book) : { info: null, pages: [] };
  const mine = local ? readJson(path.join(work, book, 'pages.json')) : null;
  const info = mine?.info || dumped.info;
  const pages = local ? [...dumped.pages.filter((p) => p.status === 'done' && !mine.pages.some((x) => x.n === p.n)), ...mine.pages.map((p) => ({ ...p, status: 'todo', img: p.file }))].sort((a, b) => a.n - b.n) : dumped.pages;
  const byN = new Map(pages.map((p) => [p.n, p]));
  const want = opt('pages') ? parseRange(opt('pages')).filter((n) => byN.has(n)) : pages.filter((p) => p.status !== 'done' && !p.blank).map((p) => p.n);
  const noImg = want.filter((n) => !byN.get(n).img);
  const todo = want.filter((n) => byN.get(n).img);
  const out = path.join(work, book);
  fs.mkdirSync(out, { recursive: true });
  const rows = [];
  for (const nums of batchesOf(todo, per)) {
    const id = `b${pad(nums[0])}`;
    const layer = Object.fromEntries(nums.map((n) => [n, byN.get(n).layer || '']));
    const prompt = `${CONTEXT}\n${pageRule(nums)}\n${transcribePrompt({ title: info.title, subject: info.subject }, nums, { ...ctxBefore(pages, nums[0]), kind: info.kind, layer })}`;
    fs.writeFileSync(path.join(out, `${id}.prompt.txt`), prompt);
    const imgs = Object.fromEntries(nums.map((n) => [n, byN.get(n).img]));
    fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify({ book, pages: nums, imgs }, null, 1));
    rows.push({ id, pages: nums, imgs });
  }
  console.log(JSON.stringify({ book, title: info.title, pages: todo.length, batches: rows.length, noImg, rows }, null, 1));
}

function apply() {
  const book = opt('book'), work = opt('work'), by = opt('by', '');
  if (!book || !work) throw new Error('要 --book B3 --work 工作目录');
  const dir = path.join(work, book);
  const inbox = path.join(dir, 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const writes = [];
  const report = [];
  const stamp = Date.now().toString(36);
  // 从仓库的 PDF 转的：书的信息、每页的原页图（assets.json：页码 → 学习台 assets 的 id）一起带上
  const mine = fs.existsSync(path.join(dir, 'pages.json')) ? readJson(path.join(dir, 'pages.json')) : null;
  const ids = fs.existsSync(path.join(dir, 'assets.json')) ? readJson(path.join(dir, 'assets.json')) : {};
  const metaOf = (nums) => (mine ? Object.fromEntries(nums.map((n) => [n, mine.pages.find((p) => p.n === Number(n))]).filter(([, p]) => p).map(([n, p]) => [n, { img: ids[n] || '', size: p.size, ...(p.blank ? { blank: true } : {}) }])) : null);
  if (mine) {
    const noId = mine.pages.filter((p) => !ids[p.n]).map((p) => p.n);
    if (noId.length) report.push(`第 ${noId.join('、')} 页还没传原页图（assets.json 里没有），写进学习台以后这些条目没有原图可核对`);
    // 空白页不转：收件箱里直接记成转好了（没有内容）
    const blanks = mine.pages.filter((p) => p.blank).map((p) => p.n);
    if (blanks.length && !fs.existsSync(path.join(dir, 'blank.sent'))) {
      const docId = `${book}-blank-${stamp}`;
      const file = path.join(inbox, `${docId}.json`);
      fs.writeFileSync(file, JSON.stringify({ book, batch: 'blank', info: mine.info, pages: Object.fromEntries(blanks.map((n) => [n, []])), meta: metaOf(blanks), by: 'page', at: Date.now() }));
      writes.push({ op: 'set', collection: 'book_inbox', doc_id: docId, file_path: path.resolve(file), _batch: 'blank' });
    }
  }
  for (const f of fs.readdirSync(dir).filter((x) => /^b\d+\.json$/.test(x)).sort()) {
    const { pages: nums } = readJson(path.join(dir, f));
    const id = f.replace(/\.json$/, '');
    const outFile = path.join(dir, `${id}.out.txt`);
    if (!fs.existsSync(outFile)) { report.push(`${id}：没有结果（${nums.join('、')} 页）`); continue; }
    if (fs.existsSync(path.join(dir, `${id}.sent`))) continue; // 已经写进学习台了
    const raw = fs.readFileSync(outFile, 'utf8');
    let parsed;
    try { parsed = parseTranscription(raw, nums); } catch (e) { report.push(`${id}：${e.message}：${raw.replace(/\s+/g, ' ').slice(0, 100)}`); continue; }
    // 一页都对不上、但页数一样：它写的是书上印的页码，按顺序对回我给的编号
    if (parsed.missing.length === nums.length && parsed.pages.size === nums.length) {
      const got = [...parsed.pages.keys()].sort((a, b) => a - b);
      parsed = { pages: new Map(got.map((k, i) => [nums[i], parsed.pages.get(k)])), missing: [] };
      report.push(`${id}：页码写成了 ${got[0]}–${got[got.length - 1]}，已按顺序对回 ${nums[0]}–${nums[nums.length - 1]}`);
    }
    const got = Object.fromEntries(nums.filter((n) => parsed.pages.has(n)).map((n) => [n, parsed.pages.get(n)]));
    if (parsed.missing.length) report.push(`${id}：第 ${parsed.missing.join('、')} 页没转出来`);
    if (!Object.keys(got).length) continue;
    const docId = `${book}-${pad(nums[0])}-${stamp}`;
    const file = path.join(inbox, `${docId}.json`);
    fs.writeFileSync(file, JSON.stringify({ book, batch: id, pages: got, by, at: Date.now(), ...(mine ? { info: mine.info, meta: metaOf(Object.keys(got)) } : {}) }));
    writes.push({ op: 'set', collection: 'book_inbox', doc_id: docId, file_path: path.resolve(file), _batch: id });
  }
  // 一次 batch 最多 50 条、1 MiB：按大小切
  const groups = [];
  let cur = [], size = 0;
  for (const w of writes) {
    const n = fs.statSync(w.file_path).size;
    if (cur.length && (cur.length >= 50 || size + n > 900 * 1024)) { groups.push(cur); cur = []; size = 0; }
    cur.push(w); size += n;
  }
  if (cur.length) groups.push(cur);
  console.log(JSON.stringify({ book, inbox: writes.length, report, groups: groups.map((g) => g.map(({ _batch, ...w }) => w)) }, null, 1));
}

/**
 * Codex（或别的地方）写好的转写文本：--src 目录下所有 .txt，照「=== 第 N 页 / --- 类型 | 名字」的格式。
 * node tools/books.mjs text --book B3 --src 目录 --work 工作目录 [--by codex] [--pages 82-412] [--title 书名 --space cs --subject 数据结构 --total 412（新书）]
 * 每 8 页拼一条收件箱记录（学习台里还没有这一页也照样建，原页图以后在学习台里「存进学习台」时补上），打印 batch 的 writes 和检查结果
 */
function text() {
  const book = opt('book'), src = opt('src'), work = opt('work'), by = opt('by', 'codex');
  if (!book || !src || !work) throw new Error('要 --book B3 --src 文本目录 --work 工作目录');
  const files = fs.readdirSync(src, { recursive: true }).map(String).filter((f) => f.endsWith('.txt')).sort();
  const pages = new Map();
  const report = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(src, f), 'utf8');
    try {
      const { pages: got } = parseTranscription(raw, []);
      for (const [n, items] of got) {
        if (pages.has(n)) report.push(`第 ${n} 页在两个文件里都有（用 ${f} 的）`);
        pages.set(n, items);
      }
    } catch (e) { report.push(`${f}：${e.message}`); }
  }
  const only = opt('pages') ? new Set(parseRange(opt('pages'))) : null;
  const nums = [...pages.keys()].filter((n) => !only || only.has(n)).sort((a, b) => a - b);
  // 检查：中间缺的页、整页没内容的页、看不清的地方、写得特别短的页（可能漏了）
  const gaps = [];
  for (let i = 1; i < nums.length; i++) for (let n = nums[i - 1] + 1; n < nums[i]; n++) gaps.push(n);
  if (gaps.length) report.push(`中间缺这些页：${gaps.join('、')}`);
  const empty = nums.filter((n) => !pages.get(n).length);
  if (empty.length) report.push(`这些页没有内容（空白页没事，不是空白就要重转）：${empty.join('、')}`);
  const unclear = nums.filter((n) => pages.get(n).some((it) => /【看不清】/.test(it.text || '')));
  if (unclear.length) report.push(`这些页有【看不清】：${unclear.join('、')}`);
  const short = nums.filter((n) => { const len = pages.get(n).reduce((s, it) => s + (it.text || '').length, 0); return pages.get(n).length && len < 150; });
  if (short.length) report.push(`这些页字特别少，看看是不是漏了：${short.join('、')}`);
  const inbox = path.join(work, book, 'inbox-text');
  fs.mkdirSync(inbox, { recursive: true });
  const stamp = Date.now().toString(36);
  const writes = [];
  for (let i = 0; i < nums.length; i += 8) {
    const part = nums.slice(i, i + 8);
    const docId = `${book}-${pad(part[0])}-${stamp}`;
    const file = path.join(inbox, `${docId}.json`);
    // meta 每页给一个空对象：学习台里还没有这一页时也建出来（没有原图）
    // 学习台里还没有这本书时（新书先让 Codex 转）：带上 --title 等，书也一起建
    const info = opt('title') ? { title: opt('title'), kind: opt('kind', 'textbook'), space: opt('space', 'cs'), subject: opt('subject', ''), ...(opt('total') ? { pages: Number(opt('total')) } : {}) } : null;
    fs.writeFileSync(file, JSON.stringify({ book, batch: `t${pad(part[0])}`, pages: Object.fromEntries(part.map((n) => [n, pages.get(n)])), meta: Object.fromEntries(part.map((n) => [n, {}])), by, at: Date.now(), ...(info ? { info } : {}) }));
    writes.push({ op: 'set', collection: 'book_inbox', doc_id: docId, file_path: path.resolve(file) });
  }
  const groups = [];
  for (let i = 0; i < writes.length; i += 40) groups.push(writes.slice(i, i + 40));
  console.log(JSON.stringify({ book, files: files.length, pages: nums.length, from: nums[0], to: nums[nums.length - 1], report, groups }, null, 1));
}

/** 写进学习台以后记一下，下次 apply 不再重发 */
function sent() {
  const book = opt('book'), work = opt('work');
  const dir = path.join(work, book);
  for (const f of fs.readdirSync(path.join(dir, 'inbox'))) {
    const d = readJson(path.join(dir, 'inbox', f));
    fs.writeFileSync(path.join(dir, `${d.batch}.sent`), f);
  }
  console.log('记下了');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (cmd === 'render') render();
    else if (cmd === 'plan') plan();
    else if (cmd === 'apply') apply();
    else if (cmd === 'sent') sent();
    else if (cmd === 'text') text();
    else console.log('用法：node tools/books.mjs plan|apply|sent …（见文件开头）');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
