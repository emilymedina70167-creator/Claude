// 和基线比（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 13 节「旧课」）：两份 tools/stage-try.mjs --json 的结果，
// 原来演得上的，现在还演不演得上——每个文件、每种朝向、每一步，列出基线里没错、现在报错的行（改了说法的报错，同一行基线里也报了的不算），
// 老师那一段演上的行少了的，新多了没交给学生的，基线跑到、现在没跑到的步。现在演得上了的、多跑了的步不算。比法在 tools/stage-try-lib.js 的 tryDiff（有测试）。
//   node tools/stage-try-diff.mjs 基线.json 现在.json     没有不同退出码 0，有不同 1，读不了文件 2
// 同一个文件照每条结果的 path 对（tools/stage-try.mjs 现在会写；没有 path 的照文件名）
import { readFileSync } from 'node:fs';
import { tryDiff, diffText } from './stage-try-lib.js';

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('用法：node tools/stage-try-diff.mjs 基线.json 现在.json'); process.exit(2); }
const read = (f) => {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (err) { console.error(`读不了 ${f}：${err.message}`); process.exit(2); }
  return null;
};
const base = read(a), now = read(b);
if (!Array.isArray(base) || !Array.isArray(now)) { console.error('两份都要是 tools/stage-try.mjs --json 打出来的（一个数组）'); process.exit(2); }
const d = tryDiff(base, now);
// 写完了再退出（不同多的时候一大段，写进管道时 stdout 是异步的，直接 process.exit 会截掉后面的）
process.stdout.write(`${diffText(d)}\n\n（基线 ${base.length} 个文件，现在 ${now.length} 个）\n`, () => process.exit(d.length ? 1 : 0));
