// 教学尺子（evals/teaching/）：一整套场景各跑一节模拟课（每节一个 tools/teach-run.mjs 子进程），写一张表。
//
//   node tools/teach-suite.mjs <输出目录> --arm <名字> [--system-dir 目录] [--memory 文件] [--only a,b] [--parallel 2]
//        [--teacher 模型] [--student 模型] [--grader 模型] [--cli 命令]
//
// 每节课在 <输出目录>/<场景 id>/；--system-dir 里有 <场景 id>.system.md 就让老师读它（旧版规则那一版用），没有就照现在的代码拼。
// 一节失败不影响别的。有一节撞了用量上限停下（paused）就不再开新的课，等正在跑的结束——接着开只会一节节都撞上。
// 再跑一遍同一条命令就接着跑：已经跑完的不重跑，停下的、失败的 --continue，没开始的从头（teach-run-lib.mjs 的 resumeAction）。
// 几节课的启动错开两秒：几个 claude 进程同时写用户目录下的配置文件有过写坏的先例。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { summaryRow, summaryMd, resumeAction } from './teach-run-lib.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const out = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv[0]) : null;
const arm = opt('--arm');
if (!out || !arm) { console.error('用法：node tools/teach-suite.mjs <输出目录> --arm <名字> [--system-dir 目录] [--memory 文件] [--only a,b] [--parallel 2]'); process.exit(2); }
const parallel = Math.max(1, Number(opt('--parallel', 2)) || 2);
const STAGGER_MS = 2000;
const only = opt('--only') ? new Set(opt('--only').split(',').map((s) => s.trim()).filter(Boolean)) : null;
const systemDir = opt('--system-dir') ? path.resolve(opt('--system-dir')) : null;
const RUN = new URL('./teach-run.mjs', import.meta.url).pathname;
const SCEN = new URL('../evals/teaching/scenarios/', import.meta.url).pathname;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

const all = fs.readdirSync(SCEN).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ file: path.join(SCEN, f), sc: readJson(path.join(SCEN, f)) }));
// 每节课的目录按 id 起名：两个场景 id 一样会互相盖掉
const seen = new Map();
for (const { file, sc } of all) {
  if (!sc?.id) { console.error(`场景 ${file} 读不出 id`); process.exit(2); }
  if (seen.has(sc.id)) { console.error(`两个场景的 id 都是 ${sc.id}：${seen.get(sc.id)} 和 ${file}`); process.exit(2); }
  seen.set(sc.id, file);
}
const scenarios = all.filter(({ sc }) => !only || only.has(sc.id));
if (!scenarios.length) { console.error('没有要跑的场景'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

let stopNew = false; // 有一节停在用量上限：不再开新的
let lastStart = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rowOf({ sc }, dir, code) {
  const run = readJson(path.join(dir, 'run.json'));
  // 子进程退出码非 0 时不信 run.json 里的 ok（可能是上一次留下的、或者写到一半）
  const trusted = run && code !== 0 ? { ...run, ok: false } : run;
  return summaryRow({ scenario: sc, run: trusted, metrics: readJson(path.join(dir, 'metrics.json')), grade: readJson(path.join(dir, 'grade.json')) });
}

async function runOne(item) {
  const { file, sc } = item;
  const dir = path.join(out, sc.id);
  fs.mkdirSync(dir, { recursive: true });
  const action = resumeAction(readJson(path.join(dir, 'run.json')));
  if (action === 'skip') { console.log(`已经跑完：${sc.id}`); return rowOf(item, dir, 0); }
  if (stopNew) return { id: sc.id, failed: '没开始：前面有一节撞了用量上限' };
  const wait = lastStart + STAGGER_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + STAGGER_MS);
  if (wait > 0) await sleep(wait);
  if (stopNew) return { id: sc.id, failed: '没开始：前面有一节撞了用量上限' };
  let args;
  if (action === 'continue') args = [RUN, dir, '--continue'];
  else {
    // 从头跑：上一次留下的指标、评卷先删掉，免得这一次没跑完时被当成这一次的
    for (const f of ['metrics.json', 'grade.json', 'run.json']) fs.rmSync(path.join(dir, f), { force: true });
    args = [RUN, dir, file];
    const sys = systemDir && path.join(systemDir, `${sc.id}.system.md`);
    if (sys && fs.existsSync(sys)) args.push('--system', sys);
    if (opt('--memory')) args.push('--memory', path.resolve(opt('--memory')));
    for (const k of ['--teacher', '--student', '--grader', '--cli']) if (opt(k)) args.push(k, opt(k));
  }
  // 一节的输出很长，存进它自己的 run.log；这里只报开始和结束
  const log = fs.openSync(path.join(dir, 'run.log'), action === 'continue' ? 'a' : 'w');
  console.log(`${action === 'continue' ? '接着跑' : '开始'}：${sc.id}`);
  const code = await new Promise((resolve) => {
    const p = spawn('node', args, { stdio: ['ignore', log, log] });
    p.on('close', (c) => resolve(c));
    p.on('error', () => resolve(-1));
  });
  fs.closeSync(log);
  if (code === 2) stopNew = true;
  console.log(`${code === 0 ? '跑完' : code === 2 ? '暂停（用量上限）' : '没跑完'}：${sc.id}`);
  return rowOf(item, dir, code);
}

const rows = new Array(scenarios.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(parallel, scenarios.length) }, async () => {
  while (next < scenarios.length) { const i = next++; rows[i] = await runOne(scenarios[i]); }
}));
const unfinished = rows.filter((r) => r.failed);
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ arm, at: new Date().toISOString(), rows }, null, 1));
let md = summaryMd(rows, arm);
if (unfinished.length) md += `\n没跑完的 ${unfinished.length} 节：${unfinished.map((r) => r.id).join('、')}。再跑一遍同一条命令就接着跑（跑完的不重跑，停下的、失败的从停下的那一步接着跑）。\n`;
fs.writeFileSync(path.join(out, 'summary.md'), md);
console.log(`写了 ${path.join(out, 'summary.md')}`);
process.exit(unfinished.length ? 1 : 0);
