#!/usr/bin/env node
// 验收打分：把一轮验收（evals/runs/<轮>/）里扮演老师写的黑板课、课堂输出放进页面检查（check-lesson.mjs），
// 统计一次写对率、改一次之后的改对率、各种「注意」，写成 <轮>/score.md 和 score.json。
// 用法：node tools/eval-score.mjs evals/runs/<轮> [--kit 那一轮用的 la-kit.js] [--shots]
//   第一次写的是 <题号>.board.json / class.class.json；把报错发回去改过的是 <题号>.v2.board.json / class.v2.class.json。
import { readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { checkFiles, verdict } from './check-lesson.mjs';

const args = process.argv.slice(2);
const run = args.find((a) => !a.startsWith('--'));
if (!run) { console.error('用法：node tools/eval-score.mjs evals/runs/<轮> [--kit la-kit.js] [--shots]'); process.exit(2); }
const kit = args.includes('--kit') ? args[args.indexOf('--kit') + 1] : '';
const shots = args.includes('--shots') ? join(run, 'shots') : '';

const subjects = readdirSync(run).filter((d) => statSync(join(run, d)).isDirectory() && d !== 'shots');
const files = [];
for (const s of subjects) for (const f of readdirSync(join(run, s))) if (/\.(board|class)\.json$/.test(f)) files.push(join(run, s, f));
const results = await checkFiles(files, { kit, shots, walk: true });

// 按文件合并两个尺寸：一个文件只要有一个尺寸有错就算有错
const byFile = new Map();
for (const r of results) {
  const v = verdict(r);
  const cur = byFile.get(r.file) || { file: r.file, bad: 0, warn: 0, hard: new Set(), notes: new Set() };
  cur.bad += v.bad; cur.warn += v.warn;
  for (const p of r.problems) (p.soft ? cur.notes : cur.hard).add(`${p.kind}：${p.msg.split('\n')[0]}`);
  for (const e of r.errors) cur.hard.add(e);
  if (r.overflow) cur.hard.add(`整页横向溢出（${r.size}）`);
  for (const x of r.spills) cur.hard.add(`冲出版面（${r.size}）：${x}`);
  for (const x of r.unfit) cur.notes.add(`放不下（${r.size}）：${x}`);
  for (const x of r.overlaps) cur.notes.add(`字叠在一起：${x}`);
  for (const x of r.scrolls) cur.notes.add(`要横着滑（${r.size}）：${x}`);
  byFile.set(r.file, cur);
}

const key = (f) => basename(f).replace(/\.v2(?=\.(board|class)\.json$)/, '');
const rows = [];
let first = 0, firstOk = 0, fixed = 0, fixedOk = 0;
for (const s of subjects) {
  const mine = [...byFile.values()].filter((x) => x.file.includes(`/${s}/`));
  const v1 = mine.filter((x) => !/\.v2\./.test(x.file));
  const v2 = mine.filter((x) => /\.v2\./.test(x.file));
  first += v1.length; firstOk += v1.filter((x) => !x.bad).length;
  // 改对率：第一次有错的里面，改过的版本没错的比例
  for (const x of v1.filter((y) => y.bad)) {
    const again = v2.find((y) => key(y.file) === key(x.file));
    if (again) { fixed++; if (!again.bad) fixedOk++; }
  }
  rows.push({ s, v1, v2 });
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%（${a}/${b}）` : '—');
const lines = [`# 验收：${basename(run)}`, '', `- 一次写对（两种 iPad 尺寸都没有「错」）：${pct(firstOk, first)}`, `- 把报错发回去改一次后改对：${pct(fixedOk, fixed)}`, ''];
for (const { s, v1, v2 } of rows) {
  lines.push(`## ${s}`, '', '| 文件 | 第一次 | 改过 | 错 | 注意 |', '|---|---|---|---|---|');
  for (const x of v1) {
    const again = v2.find((y) => key(y.file) === key(x.file));
    lines.push(`| ${basename(x.file)} | ${x.bad ? '✗' : '✓'} | ${again ? (again.bad ? '✗' : '✓') : ''} | ${[...x.hard].length} | ${[...x.notes].length} |`);
  }
  lines.push('');
  for (const x of [...v1, ...v2]) {
    if (!x.hard.size && !x.notes.size) continue;
    lines.push(`### ${basename(x.file)}`, '');
    for (const h of x.hard) lines.push(`- 错：${h.replace(/\n/g, ' ')}`);
    for (const n of x.notes) lines.push(`- 注意：${n.replace(/\n/g, ' ')}`);
    lines.push('');
  }
}
writeFileSync(join(run, 'score.md'), lines.join('\n'));
writeFileSync(join(run, 'score.json'), JSON.stringify(results.map((r) => ({ ...r, file: relative(process.cwd(), r.file) })), null, 2));
console.log(lines.slice(0, 5).join('\n'));
console.log(`详细：${join(run, 'score.md')}`);
