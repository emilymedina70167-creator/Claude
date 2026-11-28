#!/usr/bin/env node
// 课后收尾：把你写好的清单（定的掌握状态、小结、失误、学生的偏好、记忆点）排成 ArtifactData batch 的写入。
// 内容全照清单，这里只排编号、接着已有的 log / notes 往后加、每条配一条能撤销的 journal、按 50 条分批。
// 这个命令不碰学习台：读的是 ArtifactData 存下来的目录，生成的是本地文件，往学习台写还是你自己来。
//   node tools/ext-wrap.mjs --input 清单.json --dump 目录 [--versions 版本.json] [--out 目录]
//   node tools/ext-wrap.mjs --verify --input 清单.json --dump 写之前存的目录 --after 写完重新存的目录 [--versions 版本.json]
// 清单：{ sid, space, date, mastery: [{ block, state, note, why, basis }], summary: { title, block, taught, stuck, thin, next },
//        slips: [{ text, lesson }], notes: [{ text, quote, when }], recall: [{ q, a, block }] }，每一栏都可以不写。
// 版本.json：{ "mastery/EN-G9.1": 3, "summary/en": 10 }（ArtifactData 存文件时版本号只打在结果里，不在文件里；改已有文档要带）。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readDocs } from './ext-class.js';
import { wrapPlan, splitBatches, wrapVerify } from './ext-wrap-lib.js';

function arg(name, def = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const inputFile = arg('input'), dump = arg('dump');
if (!inputFile || !dump) { console.error('要写 --input 清单.json 和 --dump 存数据的目录'); process.exit(2); }
const COLLS = ['mastery', 'slips', 'recall', 'summary', 'curriculum', 'observations', 'journal'];
const load = (dir) => Object.fromEntries(COLLS.map((c) => [c, readDocs(join(resolve(dir), c))]));
const input = JSON.parse(readFileSync(resolve(inputFile), 'utf8'));
const versions = arg('versions') ? JSON.parse(readFileSync(resolve(arg('versions')), 'utf8')) : {};
const have = load(dump);
for (const c of ['mastery', 'slips', 'recall', 'summary']) if (!have[c].length && (c === 'summary' ? input.notes?.length : input[c]?.length)) console.log(`提醒：${dump} 里没有存 ${c}，编号从头排、已有的文档认不出来；先把这一类存下来再跑`);

const outDir = resolve(arg('out', '.superpowers/ext-wrap'));
const planFile = join(outDir, 'wrap-plan.json');
if (process.argv.includes('--verify')) {
  const after = arg('after');
  if (!after) { console.error('--verify 要写 --after 写完重新存的目录'); process.exit(2); }
  // 核对的是当时生成的那一份（编号里有时间和随机数，重排一次对不上）
  if (!existsSync(planFile)) { console.error(`没有 ${planFile}：先不带 --verify 跑一次`); process.exit(2); }
  const v = wrapVerify({ writes: JSON.parse(readFileSync(planFile, 'utf8')), have: load(after) });
  console.log(`写上了 ${v.ok.length} 条${v.missing.length ? `，${v.missing.length} 条不对：` : '，都对得上'}`);
  for (const m of v.missing) console.log(`  · ${m}`);
  process.exit(v.missing.length ? 1 : 0);
}

const { writes, warnings } = wrapPlan({ input, have, versions, now: Date.now() });
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(planFile, JSON.stringify(writes, null, 2));
const batches = splitBatches(writes);
batches.forEach((b, i) => writeFileSync(join(outDir, `wrap-batch-${i + 1}.json`), JSON.stringify(b, null, 2)));
const real = writes.filter((w) => w.collection !== 'journal');
console.log(`${real.length} 条改动（各配一条 journal），分 ${batches.length} 批：`);
for (const w of real) console.log(`  · ${w.op} ${w.collection}/${w.doc_id}${w.if_version ? `（版本 ${w.if_version}）` : ''}`);
batches.forEach((b, i) => console.log(`文件：${join(outDir, `wrap-batch-${i + 1}.json`)}（${b.length} 条，内容就是 ArtifactData batch 的 writes）`));
if (warnings.length) { console.log('提醒（照样生成了）：'); for (const w of warnings) console.log(`  · ${w}`); }
