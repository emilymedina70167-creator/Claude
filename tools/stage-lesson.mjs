// 读真课（tools/stage-cost-lib.js 的 lessonCost）：学习台里上过的舞台课，老师每一轮写了多少字、搭占几成、等了几秒、
// 多少行没演上、哪些写法一次没碰、学生手上有没有事。只读本地文件，不碰学习台、不调用 Claude。
//   1. 用 ArtifactData 的 list（out_dir）把学习台的 sessions 存到 <目录>/sessions/<课号>.json，
//      每节舞台课的 class_turns 存到 <目录>/sessions/<课号>/class_turns/<seq>.json（和 tools/guard-audit.mjs 同一个目录约定）；
//   2. node tools/stage-lesson.mjs <目录> [课号…] [--json]        不写课号量全部舞台课（kind: stage）
// 数据是私人的：目录放 .superpowers/ 下面，不进 git。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lessonCost, featureUse } from './stage-cost-lib.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const [dir, ...ids] = args.filter((a) => !a.startsWith('--'));
if (!dir || !existsSync(join(dir, 'sessions'))) { console.error('用法：node tools/stage-lesson.mjs <存数据的目录> [课号…] [--json]（目录下要有 sessions/）'); process.exit(2); }

const readColl = (p) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => ({ id: f.slice(0, -5), ...JSON.parse(readFileSync(join(p, f), 'utf8')) })) : []);
const sessions = readColl(join(dir, 'sessions')).filter((s) => s.kind === 'stage' && (!ids.length || ids.includes(s.id))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
const lessons = sessions.map((s) => {
  const turns = readColl(join(dir, 'sessions', s.id, 'class_turns')).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  return { id: s.id, date: s.date || s.start || '', subject: s.subject || s.space || '', block: s.block || '', title: s.title || '', turns: turns.length, ...lessonCost(turns), texts: turns.filter((t) => t.role === 'claude' && !t.discarded).map((t) => t.text || '') };
}).filter((l) => l.turns.length);

const all = featureUse(lessons.flatMap((l) => l.texts));
if (json) { console.log(JSON.stringify({ lessons: lessons.map(({ texts, ...l }) => l), unusedEverywhere: all.unused, usedEverywhere: all.used }, null, 1)); process.exit(0); }
if (!lessons.length) { console.log('没有找到舞台课（sessions 里 kind: stage、又存了 class_turns 的）'); process.exit(0); }

const pct = (x) => `${Math.round(x * 100)}%`;
const sec = (ms, n) => (n ? (ms / n / 1000).toFixed(1) : '?');
for (const l of lessons) {
  const n = l.turns.length;
  const t = l.total;
  console.log(`\n${l.id}  ${l.date}  ${l.subject} ${l.block} ${l.title}`.trimEnd());
  console.log(`  老师 ${n} 轮，写了 ${t.lines} 行；没演上 ${t.missed} 行（${pct(t.lines ? t.missed / t.lines : 0)}）`);
  console.log(`  每轮平均 ${Math.round(t.bytes / n)} 字节，搭 ${pct(t.share)}，写死的数 ${t.suspects} 处；每轮等 ${sec(t.ms, n)} 秒，出第一个字 ${sec(t.first, n)} 秒`);
  console.log(`  学生手上有事的 ${l.turns.filter((x) => x.hands).length} 轮，只有话的 ${l.turns.filter((x) => !x.hands).length} 轮，最长连着 ${l.talkRuns} 轮只有话`);
  for (const x of l.turns) for (const m of x.missed) console.log(`    没演上（第 ${x.seq} 轮）：${m.src} —— ${m.error}`);
  console.log(`  用过的写法：${Object.entries(l.features.used).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  ')}`);
}
const sum = (f) => lessons.reduce((n, l) => n + f(l), 0);
const N = sum((l) => l.turns.length);
console.log(`\n合计 ${lessons.length} 节、老师 ${N} 轮：每轮平均 ${Math.round(sum((l) => l.total.bytes) / N)} 字节，搭 ${pct(sum((l) => l.total.build.bytes) / (sum((l) => l.total.bytes) || 1))}，没演上 ${pct(sum((l) => l.total.missed) / (sum((l) => l.total.lines) || 1))}，每轮等 ${sec(sum((l) => l.total.ms), N)} 秒，出第一个字 ${sec(sum((l) => l.total.first), N)} 秒`);
console.log(`所有课一次都没碰的写法（${all.unused.length}）：${all.unused.join('  ')}`);
