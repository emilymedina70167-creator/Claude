// 教学尺子（evals/teaching/）：一整套场景各跑一节模拟课（每节一个 tools/teach-run.mjs 子进程），写一张表。
//
//   node tools/teach-suite.mjs <输出目录> --arm <名字> [--system-dir 目录] [--memory 文件] [--only a,b] [--parallel 3]
//        [--teacher 模型] [--student 模型] [--grader 模型]
//
// 每节课在 <输出目录>/<场景 id>/；--system-dir 里有 <场景 id>.system.md 就让老师读它（旧版规则那一版用），没有就照现在的代码拼。
// 一节失败不影响别的：表里那一行写「没跑完：停在第 N 轮」。写 <输出目录>/summary.json 和 summary.md。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { summaryRow, summaryMd } from './teach-run-lib.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const out = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv[0]) : null;
const arm = opt('--arm');
if (!out || !arm) { console.error('用法：node tools/teach-suite.mjs <输出目录> --arm <名字> [--system-dir 目录] [--memory 文件] [--only a,b] [--parallel 3]'); process.exit(2); }
const parallel = Math.max(1, Number(opt('--parallel', 3)) || 3);
const only = opt('--only') ? new Set(opt('--only').split(',').map((s) => s.trim()).filter(Boolean)) : null;
const systemDir = opt('--system-dir') ? path.resolve(opt('--system-dir')) : null;
const RUN = new URL('./teach-run.mjs', import.meta.url).pathname;
const SCEN = new URL('../evals/teaching/scenarios/', import.meta.url).pathname;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

const scenarios = fs.readdirSync(SCEN).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ file: path.join(SCEN, f), sc: readJson(path.join(SCEN, f)) }))
  .filter(({ sc }) => sc && (!only || only.has(sc.id)));
if (!scenarios.length) { console.error('没有要跑的场景'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

function runOne({ file, sc }) {
  const dir = path.join(out, sc.id);
  fs.mkdirSync(dir, { recursive: true });
  const args = [RUN, dir, file];
  const sys = systemDir && path.join(systemDir, `${sc.id}.system.md`);
  if (sys && fs.existsSync(sys)) args.push('--system', sys);
  if (opt('--memory')) args.push('--memory', path.resolve(opt('--memory')));
  for (const k of ['--teacher', '--student', '--grader']) if (opt(k)) args.push(k, opt(k));
  // 一节的输出很长，存进它自己的 run.log；这里只报开始和结束
  const log = fs.openSync(path.join(dir, 'run.log'), 'w');
  console.log(`开始：${sc.id}`);
  return new Promise((resolve) => {
    const p = spawn('node', args, { stdio: ['ignore', log, log] });
    p.on('close', (code) => {
      fs.closeSync(log);
      const run = readJson(path.join(dir, 'run.json'));
      console.log(`${code === 0 ? '跑完' : '没跑完'}：${sc.id}${run?.stoppedAt !== undefined && !run.ok ? `（停在第 ${run.stoppedAt} 轮）` : ''}`);
      resolve(summaryRow({ scenario: sc, run, metrics: readJson(path.join(dir, 'metrics.json')), grade: readJson(path.join(dir, 'grade.json')) }));
    });
    p.on('error', (e) => { fs.closeSync(log); resolve(summaryRow({ scenario: sc, run: { ok: false, stoppedWhat: `开不了子进程：${e.message}` } })); });
  });
}

const rows = new Array(scenarios.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(parallel, scenarios.length) }, async () => {
  while (next < scenarios.length) { const i = next++; rows[i] = await runOne(scenarios[i]); }
}));
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ arm, at: new Date().toISOString(), rows }, null, 1));
fs.writeFileSync(path.join(out, 'summary.md'), summaryMd(rows, arm));
console.log(`写了 ${path.join(out, 'summary.md')}`);
