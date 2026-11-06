// 缺口尺子的格式检查：助手交回来的理想演法（ideal）、对照报告（report）全不全。
//   node tools/stage-gaps-check.mjs ideal     查 evals/stage-gaps/ideal/*.md
//   node tools/stage-gaps-check.mjs report    再查 evals/stage-gaps/report/{线代,数据结构,英语}.md（对着这一科的理想演法）
// 有问题退出码 1
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkIdeal, checkReport } from './stage-gaps-lib.js';

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'evals/stage-gaps');
const SUBJECT = { 线代: 'L', 数据结构: 'D', 英语: 'E' };
const what = process.argv[2];
if (!['ideal', 'report'].includes(what)) { console.error('用法：node tools/stage-gaps-check.mjs ideal|report'); process.exit(2); }

const ideals = {};
const idir = join(DIR, 'ideal');
for (const f of existsSync(idir) ? readdirSync(idir).filter((x) => x.endsWith('.md')).sort() : []) ideals[basename(f, '.md')] = readFileSync(join(idir, f), 'utf8');
let bad = 0;
const show = (name, ps) => { if (ps.length) { bad += ps.length; console.log(`✗ ${name}`); for (const p of ps) console.log(`    ${p}`); } else console.log(`✓ ${name}`); };

if (!Object.keys(ideals).length) { console.log('还没有理想演法（evals/stage-gaps/ideal/）'); process.exit(1); }
if (what === 'ideal') for (const [id, md] of Object.entries(ideals)) show(`ideal/${id}.md`, checkIdeal(md));
else for (const [sub, pre] of Object.entries(SUBJECT)) {
  const f = join(DIR, 'report', `${sub}.md`);
  const mine = Object.fromEntries(Object.entries(ideals).filter(([id]) => id.startsWith(pre)));
  if (!Object.keys(mine).length) continue;
  show(`report/${sub}.md`, existsSync(f) ? checkReport(readFileSync(f, 'utf8'), mine) : ['还没有这份报告']);
}
console.log(bad ? `\n${bad} 处要补` : '\n格式都全');
process.exit(bad ? 1 : 0);
