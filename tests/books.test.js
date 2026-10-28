// 教材板块（docs/textbook-plan.md）：读 zip、取 docx / pptx 的字、看图转写的结果拼成条目、目录、搜索、按编号取。纯函数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

const { zipEntries, unzip, textOf } = await import('../kit/src/books/zip.js');
const { docxParagraphs, pptxSlides } = await import('../kit/src/books/office.js');
const { transcribePrompt, parseTranscription, assembleChunks, transcriptChunks, slideChunks, splitText, textLayerUsable, nextBookCode, CHUNK_MAX } = await import('../kit/src/books/ingest.js');
const { bookCatalog, searchChunks, readChunks, chunkLine, chunkText, blockChunks } = await import('../kit/src/books/textbook.js');

// 造一个 zip（store 和 deflate 两种都有）
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let off = 0;
  const enc = new TextEncoder();
  for (const [name, content, deflate] of files) {
    const data = enc.encode(content);
    const body = deflate ? deflateRawSync(data) : data;
    const nm = enc.encode(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    locals.push(h, nm, body);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    centrals.push(c, nm);
    off += 30 + nm.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, e]));
}

test('读 zip：存储和 deflate 都能解；只解要的；不是 zip 报错', async () => {
  const z = makeZip([['a.txt', 'hello', false], ['word/document.xml', '你好'.repeat(50), true], ['ppt/media/x.png', 'img', false]]);
  assert.deepEqual(zipEntries(z).map((e) => e.name), ['a.txt', 'word/document.xml', 'ppt/media/x.png']);
  const files = await unzip(z, (n) => !n.startsWith('ppt/media/'));
  assert.equal(textOf(files.get('a.txt')), 'hello');
  assert.equal(textOf(files.get('word/document.xml')), '你好'.repeat(50));
  assert.ok(!files.has('ppt/media/x.png'));
  assert.throws(() => zipEntries(new Uint8Array(40)), /不是 zip/);
});

test('docx：一段一行，<w:t> 里的字按顺序拼起来，实体解码，空段去掉', async () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>矩阵</w:t></w:r><w:r><w:t xml:space="preserve">乘法 &amp; 转置</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>第二段</w:t><w:tab/><w:t>后面</w:t></w:r></w:p></w:body></w:document>';
  const files = await unzip(makeZip([['word/document.xml', xml, true]]));
  assert.deepEqual(docxParagraphs(files), ['矩阵乘法 & 转置', '第二段 后面']);
});

test('pptx：一页一条，标题占位符、正文、这页引用的图', async () => {
  const s1 = '<p:sld><p:sp><p:nvSpPr><p:ph type="title"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>分块矩阵</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>A = [A1 A2]</a:t></a:r></a:p></p:txBody></p:sp></p:sld>';
  const rel = '<Relationships><Relationship Id="rId2" Target="../media/image1.png"/><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/></Relationships>';
  const files = await unzip(makeZip([['ppt/slides/slide2.xml', s1.replace('分块矩阵', '第二页'), true], ['ppt/slides/slide1.xml', s1, true], ['ppt/slides/_rels/slide1.xml.rels', rel, false]]));
  const s = pptxSlides(files);
  assert.deepEqual(s.map((x) => x.n), [1, 2]);
  assert.equal(s[0].title, '分块矩阵');
  assert.equal(s[0].text, '分块矩阵\nA = [A1 A2]');
  assert.deepEqual(s[0].media, ['ppt/media/image1.png']);
  assert.deepEqual(s[1].media, []);
});

test('看图转写：提示词写清楚页码、上一页停在哪、只出 JSON；读回结果，缺页报出来，kind 不认得的当说明', () => {
  const p = transcribePrompt({ title: '线代基础30讲', subject: '线代' }, [23, 24], { chapter: '第2讲 矩阵', last: { kind: '例题', title: '例2.1' } });
  assert.match(p, /依次是 PDF 的第 23、24 页/);
  assert.match(p, /上一页最后一条是 例题「例2\.1」/);
  assert.match(p, /只输出 JSON/);
  assert.ok(!/[他她]/.test(p));
  const r = parseTranscription('```json\n{"pages":[{"page":23,"items":[{"kind":"例题","title":"例2.2","text":"设 $A=\\\\begin{pmatrix}1&2\\\\end{pmatrix}$","cont":false},{"kind":"奇怪","text":"一段"}]}]}\n```', [23, 24]);
  assert.deepEqual(r.missing, [24]);
  assert.equal(r.pages.get(23)[1].kind, '说明');
  assert.match(r.pages.get(23)[0].text, /pmatrix/);
  assert.throws(() => parseTranscription('没有 JSON'), /不是 JSON/);
});

test('拼成条目：标题更新第几讲、第几节，跨页接上，碎的说明并起来，太长的切开，目录指向标题后面第一条', () => {
  const pages = [
    { page: 10, items: [{ kind: '标题', level: 1, title: '第2讲 矩阵' }, { kind: '标题', level: 2, title: '§1 矩阵的运算' }, { kind: '定义', title: '定义2.1', text: '由 m×n 个数排成的表' }, { kind: '例题', title: '例2.1', text: '求 $A^n$。' }] },
    { page: 11, items: [{ kind: '例题', title: '例2.1', text: '解：$A^n = 3^{n-1}A$。', cont: true }, { kind: '说明', title: '注意', text: '短的一句' }, { kind: '说明', title: '再说', text: '又一句' }] },
    { page: 12, items: [{ kind: '标题', level: 2, title: '§2 转置' }, { kind: '定理', title: '定理2.1', text: 'x'.repeat(CHUNK_MAX + 50) + '\n\n' + 'y'.repeat(100) }] },
  ];
  const { chunks, toc } = assembleChunks(pages, 'B1');
  assert.deepEqual(chunks.map((c) => [c.id, c.kind, c.title]), [['B1-10.1', '定义', '定义2.1'], ['B1-10.2', '例题', '例2.1'], ['B1-11.1', '说明', '注意'], ['B1-12.1', '定理', '定理2.1'], ['B1-12.2', '定理', '定理2.1（续 2）']]);
  assert.equal(chunks[1].text, '求 $A^n$。\n\n解：$A^n = 3^{n-1}A$。');
  assert.deepEqual(chunks[1].pages, [10, 11]);
  assert.equal(chunks[1].pageEnd, 11);
  assert.equal(chunks[2].text, '短的一句\n\n又一句');
  assert.equal(chunks[0].chapter, '第2讲 矩阵');
  assert.equal(chunks[3].section, '§2 转置');
  assert.deepEqual(toc.map((t) => [t.level, t.title, t.chunk]), [[1, '第2讲 矩阵', 'B1-10.1'], [2, '§1 矩阵的运算', 'B1-10.1'], [2, '§2 转置', 'B1-12.1']]);
  assert.ok(splitText('a'.repeat(10) + '\n\n' + 'b'.repeat(10), 15).length === 2);
});

test('文稿按段落拼成一千多字一条；讲义一页一条；文字层能不能直接用；书的编号', () => {
  const paras = Array.from({ length: 10 }, (_, i) => `第${i}段`.repeat(200));
  const t = transcriptChunks(paras, { book: 'B2', title: '第2讲文稿' });
  assert.ok(t.length >= 3 && t.length <= 6, String(t.length));
  assert.equal(t[0].id, 'B2-1');
  assert.equal(t[0].kind, '文稿');
  assert.equal(t[0].chapter, '第2讲文稿');
  const s = slideChunks([{ n: 1, title: '分块', text: 'A=…', media: ['ppt/media/a.png'] }, { n: 2, title: '', text: '', media: [] }], { book: 'B3' });
  assert.deepEqual(s.map((x) => x.id), ['B3-1']);
  assert.deepEqual(s[0].media, ['ppt/media/a.png']);
  assert.equal(textLayerUsable(['矩阵的乘法满足结合律'.repeat(20)]), true);
  assert.equal(textLayerUsable(['', ' ']), false);
  assert.equal(nextBookCode([{ id: 'B1' }, { id: 'B3' }]), 'B2');
});

test('目录、搜索、按编号取：一条一行；中文按两个字比，标题命中算得多；取的时候写出处，放不下的写 more', () => {
  const books = [{ id: 'B1', title: '线代基础30讲', kind: 'textbook' }];
  const chunks = [
    { id: 'B1-001', book: 'B1', seq: 1, kind: '定义', title: '伴随矩阵', chapter: '第2讲', section: '§3', page: 15, pageEnd: 15, text: '把代数余子式排成的矩阵叫伴随矩阵 $A^*$。' },
    { id: 'B1-002', book: 'B1', seq: 2, kind: '例题', title: '例2.5', chapter: '第2讲', section: '§3', page: 16, pageEnd: 17, text: '求 $A^*$，其中伴随矩阵满足 $AA^*=|A|E$。' },
    { id: 'B1-003', book: 'B1', seq: 3, kind: '定义', title: '秩', chapter: '第3讲', section: '§1', page: 30, pageEnd: 30, text: '矩阵的秩是非零子式的最高阶数。' },
  ];
  assert.equal(chunkLine(chunks[1]), 'B1-002［例题］例2.5（p.16–17）');
  const cat = bookCatalog(books, chunks, { around: ['B1-001'] });
  assert.match(cat, /\*\*B1《线代基础30讲》（教材）\*\*/);
  assert.match(cat, /B1-002［例题］例2\.5/);
  assert.ok(!cat.includes('B1-003'), '只列这一讲的');
  const hits = searchChunks(chunks, '伴随矩阵');
  assert.deepEqual(hits.map((h) => h.id), ['B1-001', 'B1-002']);
  assert.match(hits[1].snippet, /伴随矩阵/);
  assert.deepEqual(searchChunks(chunks, '   '), []);
  const r = readChunks(chunks, books, ['B1-002', 'B1-009']);
  assert.match(r.text, /^### B1-002［例题］例2\.5（《线代基础30讲》 · 第2讲 · §3 · p\.16–17）\n求/);
  assert.deepEqual(r.missing, ['B1-009']);
  const big = readChunks([{ ...chunks[0], text: 'x'.repeat(30000) }, chunks[1]], books, 'B1-001, B1-002', { max: 20000 });
  assert.deepEqual(big.more, ['B1-002']);
  assert.match(chunkText(chunks[2]), /^### B1-003/);
  assert.deepEqual(blockChunks({ chunks: ['B1-003', 'B1-001'] }, chunks).map((c) => c.id), ['B1-003', 'B1-001']);
});

const { mapPrompt, parseMap, expandIds, mapDoc, prepPrompt, parsePrep, suggestBlock } = await import('../kit/src/books/plan.js');

test('挂课程地图：提示词带现有的块和条目；读回来展开范围，已有的块只加条目，新块要编号合规、上一级存在', () => {
  const chunks = ['B1-10.1', 'B1-10.2', 'B1-11.1', 'B1-12.1'].map((id, i) => ({ id, book: 'B1', seq: i + 1, kind: '例题', title: `例${i}`, chapter: '第2讲', page: 10 + i }));
  const curriculum = [{ id: 'L2', level: 'lecture', title: '第2讲' }, { id: 'L2.1', level: 'section', title: '§1', parent: 'L2' }, { id: 'L2.1.1', level: 'block', title: '运算', parent: 'L2.1', chunks: ['B1-10.1'] }];
  const p = mapPrompt({ book: { id: 'B1', title: '线代30讲', kind: 'textbook' }, chunks, curriculum });
  assert.match(p, /L2\.1\.1 运算（已挂 1 条）/);
  assert.match(p, /B1-11\.1［例题］例2/);
  assert.ok(!/[他她]/.test(p));
  assert.deepEqual(expandIds(['B1-10.2~B1-12.1', 'B1-10.1', 'B1-99'], chunks), ['B1-10.2', 'B1-11.1', 'B1-12.1', 'B1-10.1']);
  const r = parseMap({ blocks: [
    { id: 'L2.1.1', chunks: ['B1-10.1~B1-10.2'] },
    { id: 'L2.2', new: true, level: 'section', parent: 'L2', title: '§2 转置' },
    { id: 'L2.2.1', new: true, level: 'block', parent: 'L2.2', title: '转置', scope: '转置的性质', points: ['(AB)ᵀ=BᵀAᵀ'], requires: ['L2.1.1', 'L9'], chunks: ['B1-11.1', 'B1-77'] },
    { id: 'L5.1.1', new: true, level: 'block', parent: 'L5.1', title: '没有上一级' },
    { id: 'L2.1.1x', new: true, title: '编号错' },
  ], notes: '前言没挂' }, { chunks, curriculum });
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  assert.deepEqual(by['L2.1.1'].add, ['B1-10.2']);
  assert.equal(by['L2.1.1'].isNew, false);
  assert.deepEqual(by['L2.2.1'].requires, ['L2.1.1']);
  assert.match(by['L2.2.1'].problems.join(), /没有这些条目：B1-77/);
  assert.match(by['L5.1.1'].problems.join(), /上一级 L5\.1 不存在/);
  assert.match(by['L2.1.1x'].problems.join(), /编号不合规矩/);
  assert.equal(r.notes, '前言没挂');
  assert.deepEqual(mapDoc(by['L2.1.1'], curriculum[2]).chunks, ['B1-10.1', 'B1-10.2']);
  const nd = mapDoc(by['L2.2.1'], null, { today: '2026-10-29', book: 'B1' });
  assert.equal(nd.level, 'block');
  assert.equal(nd.parent, 'L2.2');
  assert.match(nd.source, /B1/);
});

test('备课：提示词带范围、挂着的原文、全部规则、记忆、能用的组件；读回来只留挂着的条目和认得的组件；下一块按 position 推', () => {
  const block = { id: 'L2.1.4', title: '可交换的情形', scope: '数量矩阵可交换', points: ['(A+B)²'], requires: ['L2.1.3'] };
  const material = [{ id: 'B1-52.1', book: 'B1', kind: '定义', title: '数量矩阵', text: '$kE$ 叫数量矩阵' }];
  const p = prepPrompt({ block, material, books: [{ id: 'B1', title: '线代30讲' }], memoryText: '学生容易把 AB 写成 BA', rulesText: '- ［细则］资料包要放文稿原文', components: ['answer', 'matrix'], subject: '线代' });
  assert.match(p, /## 这节课：L2\.1\.4 可交换的情形/);
  assert.match(p, /### B1-52\.1［定义］数量矩阵/);
  assert.match(p, /资料包要放文稿原文/);
  assert.match(p, /只输出 JSON/);
  assert.ok(!/[他她]/.test(p));
  const { main, problems } = parsePrep('```json\n{"unit":"可交换","goal":"能说清 (A+B)² 为什么不能写成…","plan":"1. 先收 L2-56","chunks":["B1-52.1","B1-99.1"],"components":["matrix","circle"],"problems":[{"q":"算 (A+B)²","answer":"A²+AB+BA+B²","point":"展开"},{"answer":"没题面"}]}\n```', { block, chunkIds: ['B1-52.1'], components: ['answer', 'matrix'] });
  assert.deepEqual(main.chunks, ['B1-52.1']);
  assert.deepEqual(main.components, ['matrix']);
  assert.equal(main.block, 'L2.1.4');
  assert.equal(problems.items.length, 1);
  assert.throws(() => parsePrep('{"unit":"x"}', { block }), /没有目标和推进计划/);
  const cur = [{ id: 'L2.1.3', level: 'block' }, { id: 'L2.1.4', level: 'block' }, { id: 'L2.1.5', level: 'block' }];
  assert.equal(suggestBlock(cur, { block: 'L2.1.3', next: '重讲块4' }), 'L2.1.4');
  assert.equal(suggestBlock(cur, { block: 'L2.1.3', next: '接着讲 L2.1.5' }), 'L2.1.5');
  assert.equal(suggestBlock(cur, null), 'L2.1.3');
});
