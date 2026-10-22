// 组件手册有多大：每门课系统里的精简版离 40 KiB 的上限还有多少（tests/subject.test.js 守着上限），哪几节最大。
// 加新组件的说明前后跑一下，超了就先把最大的几节里不常用的写法挪到「<!-- 完整写法 -->」后面。
//   npm run docs:size                 每门课的总数 + 线代 / 数据结构里最大的 8 节
//   npm run docs:size -- 操作系统 20  只看这门课，列出最大的 20 节
import fs from 'node:fs';
import { componentDocs } from '../kit/build-docs.js';
import { docsForSubject, docSections, SUBJECTS } from '../kit/src/subject.js';
import { buildSystem, SYSTEM_MAX } from '../kit/src/class/prompt.js';

const LIMIT = 40 * 1024;
const KiB = (n) => (n / 1024).toFixed(1).padStart(5);
const md = fs.readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
const docs = componentDocs(md);
const want = process.argv[2] && SUBJECTS.includes(process.argv[2]) ? [process.argv[2]] : null;
const top = Number(process.argv[want ? 3 : 2]) || 8;

console.log(`组件手册一共 ${KiB(Buffer.byteLength(docs))} KiB（第三节，含完整写法）\n`);
console.log('科目        精简版   离上限   整份说明（不含资料包）');
for (const s of SUBJECTS) {
  const d = Buffer.byteLength(docsForSubject(docs, s));
  const sys = Buffer.byteLength(buildSystem({ componentDocs: docs, subject: s, pack: {} }));
  const left = LIMIT - d;
  console.log(`${s.padEnd(6, '　')}  ${KiB(d)} KiB  ${left < 0 ? '超了' : '还剩'} ${KiB(Math.abs(left))} KiB   ${KiB(sys)} / ${SYSTEM_MAX / 1024} KiB${left < 1024 ? '  ← 紧' : ''}`);
}

// 哪几节最大（只算这门课带得上的：通用的 + 打了这门课标记的）
for (const s of want || ['线代', '数据结构']) {
  const rows = docSections(docs)
    .filter((x) => x.names.length && (!x.tags || x.tags.includes(s)))
    .map((x) => ({ head: x.head.replace(/^###\s*/, '').slice(0, 34), body: Buffer.byteLength(x.body.join('\n')), detail: x.detail ? Buffer.byteLength(x.detail.join('\n')) : 0, own: !!x.tags }))
    .sort((a, b) => b.body - a.body)
    .slice(0, top);
  console.log(`\n${s}：最大的 ${rows.length} 节（精简版 / 完整写法，字节；* 是这门课专用的）`);
  for (const r of rows) console.log(`  ${String(r.body).padStart(5)} / ${String(r.detail).padStart(5)}  ${r.own ? '*' : ' '} ${r.head}`);
}
