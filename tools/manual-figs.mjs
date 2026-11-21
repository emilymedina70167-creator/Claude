#!/usr/bin/env node
// 手册（CLAUDE-PROJECT.md 第三节）里的函数图、三维图、概率组件的例子拼成一节课，交给 check-lesson 真的画一遍
// （tests/graph-docs、space-docs 只查读不读得懂；「照抄就能画」由这一步守着，npm run check:pages 里跑）。
//   node tools/manual-figs.mjs [输出的 .md，默认 .superpowers/manual-figs.md]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] || '.superpowers/manual-figs.md');
const manual = readFileSync(resolve(root, 'CLAUDE-PROJECT.md'), 'utf8');
const third = manual.slice(manual.indexOf('## 三、组件参考'), manual.indexOf('\n## 四、'));
const KINDS = ['graph', 'space', 'venn', 'ptree', 'joint', 'sim'];
const blocks = [];
for (const m of third.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)) {
  if (!KINDS.includes(m[1])) continue;
  // 例子里的 id 可能重复（手册里不在乎）：页面上每块一个新 id
  const body = m[2].replace(/^id:.*\n/m, '');
  blocks.push(`\`\`\`${m[1]}\nid: man-${m[1]}-${blocks.length + 1}\n${body}\`\`\``);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `---\nmode: guided\ntitle: 手册里的图\n---\n\n## 手册里的例子\n\n${blocks.join('\n\n')}\n`);
console.log(`${blocks.length} 个例子 → ${out}`);
