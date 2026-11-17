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
  // 系统这一层的几个数（第一节真课以后加的）：提前想好的一轮用上几次、记忆块被拒收几条、对话放不下丢了几轮、屏幕多大缩到几成、学生多久没动
  const spec = { hit: turns.filter((t) => t.cost?.spec === 'hit').length, miss: turns.filter((t) => t.kind === 'spec').length };
  const refused = turns.filter((t) => t.kind === 'note').reduce((n, t) => n + Number(/memo 里有 (\d+) 条没记/.exec(t.text || '')?.[1] || 0), 0);
  const stuck = turns.filter((t) => t.role === 'student' && !t.discarded && /^学生 \d+ 秒没动/.test(t.text || '')).length;
  const tiny = turns.filter((t) => t.role === 'student' && /字难认：整台缩到了/.test(t.msg || '')).length;
  const views = turns.map((t) => t.view).filter(Boolean);
  const view = views.length ? { w: views.at(-1).w, h: views.at(-1).h, minScale: Math.min(...views.map((v) => v.s)) } : null;
  const B = (x) => Buffer.byteLength(String(x || ''));
  const live = turns.filter((t) => !t.discarded && !t.pending && (t.role === 'claude' || t.role === 'student'));
  const hist = live.reduce((n, t) => n + B(t.role === 'claude' ? t.text : t.msg || t.text), 0);
  const stateB = live.filter((t) => t.role === 'student').reduce((n, t) => { const m = String(t.msg || ''); const i = m.indexOf('[舞台现在]'); return n + (i >= 0 ? B(m.slice(i)) : 0); }, 0);
  const sys = { spec, refused, stuck, tiny, view, hist, stateB, maxBytes: Math.max(0, ...turns.map((t) => t.cost?.bytes || 0)) };
  return { id: s.id, date: s.date || s.start || '', subject: s.subject || s.space || '', block: s.block || '', title: s.title || '', sys, turns: turns.length, ...lessonCost(turns), texts: turns.filter((t) => t.role === 'claude' && !t.discarded).map((t) => t.text || '') };
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
  const y = l.sys;
  console.log(`  提前想好的一轮：接上 ${y.spec.hit} 次，白跑 ${y.spec.miss} 次；记忆块被拒收 ${y.refused} 条；学生很久没动叫老师 ${y.stuck} 次；报「字难认」${y.tiny} 轮`);
  console.log(`  对话 ${Math.round(y.hist / 1024)} KiB（其中每轮一份的「舞台现在」${Math.round(y.stateB / 1024)} KiB），发出去最大的一次 ${Math.round(y.maxBytes / 1024)} KiB；屏幕${y.view ? ` ${y.view.w}×${y.view.h}，最小缩到 ${y.view.minScale}` : '没记（这节课是记屏幕以前上的）'}`);
  for (const x of l.turns) for (const m of x.missed) console.log(`    没演上（第 ${x.seq} 轮）：${m.src} —— ${m.error}`);
  console.log(`  用过的写法：${Object.entries(l.features.used).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  ')}`);
}
const sum = (f) => lessons.reduce((n, l) => n + f(l), 0);
const N = sum((l) => l.turns.length);
console.log(`\n合计 ${lessons.length} 节、老师 ${N} 轮：每轮平均 ${Math.round(sum((l) => l.total.bytes) / N)} 字节，搭 ${pct(sum((l) => l.total.build.bytes) / (sum((l) => l.total.bytes) || 1))}，没演上 ${pct(sum((l) => l.total.missed) / (sum((l) => l.total.lines) || 1))}，每轮等 ${sec(sum((l) => l.total.ms), N)} 秒，出第一个字 ${sec(sum((l) => l.total.first), N)} 秒`);
console.log(`所有课一次都没碰的写法（${all.unused.length}）：${all.unused.join('  ')}`);
