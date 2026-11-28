#!/usr/bin/env node
// 写一轮（外部的课）：带着这节课的现状查一遍写法，自己填序号、after、时间，生成要写进 ext_in 的那条文档；写完以后查它执行了没有。
// 这个命令不碰学习台：读的是 ArtifactData 存下来的目录，写的是一个本地文件，往学习台写还是你自己来。
//   node tools/ext-turn.mjs --session 目录 --sid 课号 --next 一轮.txt [--said 话.json] [--model 名字] [--out 目录]
//   node tools/ext-turn.mjs --session 目录 --sid 课号 --status
//   node tools/ext-turn.mjs --link 课号
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { sessionDirs } from './ext-class.js';
import { nextTurn, turnStatus, classLink } from './ext-turn-lib.js';

function arg(name, def = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const num = (d) => Number(d?.seq) || Number(String(d?.id ?? '').replace(/\D/g, '')) || 0;

if (arg('link')) { console.log(classLink(arg('link'))); process.exit(0); }
const root = arg('session'), sid = arg('sid');
if (!root || !sid) { console.error('要写 --session 存数据的目录 和 --sid 课号（或者 --link 课号）'); process.exit(2); }
const s = sessionDirs(resolve(root), sid) || { id: sid, ins: [], outs: [] };

if (process.argv.includes('--status')) {
  if (!s.ins.length) console.log(`${sid} 在这个目录里没有 ext_in`);
  for (const d of [...s.ins].sort((a, b) => num(a) - num(b))) {
    const st = turnStatus(d);
    console.log(`${String(num(d)).padStart(3, '0')}：${st.state === 'done' ? '执行了' : '还没执行'}`);
    for (const l of st.lines) console.log(`  · ${l}`);
  }
  process.exit(0);
}

const nextFile = arg('next');
if (!nextFile) { console.error('要写 --next 这一轮.txt，或者 --status'); process.exit(2); }
const text = readFileSync(resolve(nextFile), 'utf8');
// 写法只报告、不拦：发不发由写的人定
const { lintTurn, blockNames, priorTexts, checkers } = await import('./ext-lint.js');
const r = lintTurn({ prior: priorTexts(s.ins), text, names: await blockNames(), ...(await checkers()), hints: { react: String(arg('hints', '')).split(',').includes('react') } });
const errs = r.problems.filter((p) => p.level !== 'hint'), hints = r.problems.filter((p) => p.level === 'hint');
console.log(`写法检查：${r.segments} 段、${r.components} 个组件，${errs.length ? `${errs.length} 处问题` : '没有问题'}${hints.length ? `；${hints.length} 条出题提示` : ''}`);
for (const p of errs) console.log(`  · ${p.where}：${p.msg}`);
for (const p of hints) console.log(`  · （提示）${p.where}：${p.msg}`);

const saidFile = arg('said');
const said = saidFile ? JSON.parse(readFileSync(resolve(saidFile), 'utf8')) : null;
const { id, doc } = nextTurn({ ins: s.ins, outs: s.outs, text, said, model: arg('model'), now: Date.now() });
const outDir = resolve(arg('out', '.superpowers/ext-turn'));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const file = join(outDir, `ext_in-${id}.json`);
writeFileSync(file, JSON.stringify(doc, null, 2));
console.log(`集合：sessions/${sid}/ext_in`);
console.log(`文档编号：${id}（after=${doc.after}）`);
console.log(`文件：${file}`);
