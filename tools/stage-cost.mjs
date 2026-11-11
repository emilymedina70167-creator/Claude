// 量老师的字花在哪（tools/stage-cost-lib.js）：试演文件里老师写的每一行归成「教」和「搭」，
// 每块搭占几成（按字节：字节就是等的时间），搭的写法排行榜（哪种写法、多少次、多少字）。不开浏览器、不调用 Claude。
//   node tools/stage-cost.mjs [文件或目录…]     不给就量 evals/stage-gaps/try3/
//   --top 15                                    排行榜列几条
//   --json                                      打印 { blocks, total, rank }
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { costOfTry, sumCost, rankBuild } from './stage-cost-lib.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = { top: 15, json: false, paths: [] };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--top') opt.top = Number(args[++i]) || 15;
  else if (args[i] === '--json') opt.json = true;
  else opt.paths.push(resolve(args[i]));
}
if (!opt.paths.length) opt.paths.push(join(ROOT, 'evals/stage-gaps/try3'));

const walk = (p) => (statSync(p).isDirectory() ? readdirSync(p).sort().flatMap((f) => walk(join(p, f))) : p.endsWith('.txt') ? [p] : []);
const missing = opt.paths.filter((p) => !existsSync(p));
if (missing.length) { console.error(`没有：${missing.join('、')}`); process.exit(2); }
const files = opt.paths.flatMap(walk).map((p) => ({ file: relative(ROOT, p), block: basename(dirname(p)), rounds: costOfTry(readFileSync(p, 'utf8')).rounds }));
if (!files.length) { console.error('没有找到试演文件（.txt）'); process.exit(2); }

const blocks = [...new Set(files.map((f) => f.block))].map((b) => {
  const mine = files.filter((f) => f.block === b);
  return { block: b, files: mine.length, ...sumCost(mine.flatMap((f) => f.rounds)) };
});
const total = { files: files.length, ...sumCost(files.flatMap((f) => f.rounds)) };
const rank = rankBuild(files);
const unknown = files.flatMap((f) => f.rounds.flat().filter((r) => r.cls === '没归类').map((r) => `${f.file}:${r.line} ${r.src}`));

if (opt.json) { console.log(JSON.stringify({ blocks, total, rank, unknown }, null, 1)); process.exit(0); }

const pct = (x) => `${Math.round(x * 100)}%`;
const per = (s) => (s.rounds ? Math.round(s.bytes / s.rounds) : 0);
const row = (name, s) => `${name.padEnd(6)} ${String(s.files).padStart(4)} 个文件 ${String(s.rounds).padStart(5)} 轮  每轮 ${String(per(s)).padStart(4)} 字节  搭 ${pct(s.share).padStart(4)}（${s.build.lines} 行 / ${s.lines} 行）  写死的数 ${s.suspects} 处`;
console.log('每块：');
for (const b of blocks) console.log(`  ${row(b.block, b)}`);
console.log(`  ${row('合计', total)}`);
console.log('\n按类（合计）：');
for (const [c, v] of Object.entries(total.byClass).sort((a, b) => b[1].bytes - a[1].bytes)) console.log(`  ${c.padEnd(8)} ${String(v.n).padStart(5)} 行 ${String(v.bytes).padStart(7)} 字节  ${pct(v.bytes / total.bytes)}`);
console.log(`\n搭的写法排行榜（前 ${opt.top} 条，一共 ${rank.length} 种）：`);
rank.slice(0, opt.top).forEach((r, i) => {
  console.log(`  ${String(i + 1).padStart(2)}. ${r.pattern}  ${r.n} 次  ${r.bytes} 字节`);
  for (const e of r.examples) console.log(`        ${e.file}:${e.line}  ${e.src.length > 90 ? `${e.src.slice(0, 90)}…` : e.src}`);
});
if (unknown.length) { console.log(`\n没归类的行（${unknown.length}）：`); for (const u of unknown.slice(0, 20)) console.log(`  ${u}`); }
