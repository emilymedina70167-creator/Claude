// 舞台主线第十轮的尺子（docs/superpowers/plans/2026-11-14-stage-sight.md 第 3 节）：一份试演文件照真课的屏幕演，
// 学生每一次拿到手的画面（没盖着「老师在调画面」的那一刻）都要没压着、没出屏幕。
//   node tools/stage-sight.mjs [文件.txt …]   不给文件就跑 evals/stage-sight/*-fixed.txt
//   --size 1180x734                           屏幕大小（默认 1180x734：2026-11-14 那节课 iPad 横屏、Safari 地址栏占掉一截）
// 用 tools/stage-try.mjs 的同一套演法（--json）；有一帧不干净退出码 1
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let size = '1180x734';
const files = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--size') size = args[++i]; else files.push(resolve(args[i])); }
if (!files.length) { const dir = join(ROOT, 'evals/stage-sight'); for (const f of readdirSync(dir)) if (f.endsWith('-fixed.txt')) files.push(join(dir, f)); }
let bad = 0;
for (const f of files) {
  const out = execFileSync('node', [join(ROOT, 'tools/stage-try.mjs'), f, '--json'], { env: { ...process.env, STAGE_TRY_SIZE: size }, maxBuffer: 1 << 28, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const res = JSON.parse(out);
  const views = (Array.isArray(res) ? res[0] : res).views;
  for (const v of views) {
    console.log(`## ${f.split('/').pop()}（${v.tag}）`);
    v.steps.forEach((s, i) => {
      const must = (s.issues || []).filter((x) => x.what === '压着' || x.what === '出了屏幕');
      const seen = !s.veiled;
      const tag = s.step.kind === 'teacher' ? (s.step.fix ? '老师改画面' : '老师') : `学生 ${s.step.src.replace(/^学生\s*[:：]\s*/, '')}`;
      const why = s.called?.why ? `（叫老师：${s.called.why}）` : '';
      const line = must.length ? must.map((x) => `${x.an || x.a}${x.what === '压着' ? ` 和 ${x.bn || x.b} 压着` : ' 出了屏幕'}`).join('；') : '干净';
      const fail = seen && must.length;
      if (fail) bad++;
      console.log(`${fail ? '✗' : '✓'} ${i + 1}. ${tag}${why}：${s.veiled ? '盖着（老师在改）' : line}`);
    });
  }
}
console.log(bad ? `\n${bad} 帧学生看到了压着的画面` : '\n学生拿到手的每一帧都没压着');
process.exit(bad ? 1 : 0);
