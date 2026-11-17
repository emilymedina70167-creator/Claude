// 舞台主线第十轮的第三把尺子（docs/superpowers/plans/2026-11-14-stage-sight.md 第 3 节）：真的老师拿到「画面自查」会不会改。
// 从一份试演文件里找出老师那几轮演完以后屏幕上压着、出了屏幕的画面，每个做成一题：截图 + 页面交回的那一段 + 舞台现在；
// 扮老师的 Opus（子代理）照整份舞台说明写一轮改画面，接在原来那一轮后面再演、再量。
//   node tools/stage-sight-eval.mjs prepare 文件.txt --out 目录 [--size 1180x734]   出题（cases.json、case-N.md、doc.txt、截图）
//   node tools/stage-sight-eval.mjs apply 目录                                    读 case-N.out.txt（老师写的那一轮），演、量、写 results.md
// 过了 = 改完那一刻学生拿到手的画面没压着、没出屏幕，而且那一问还挂着（老师没拿掉要学生做的东西）
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseTry } from './stage-try-lib.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...rest] = process.argv.slice(2);
const opt = { size: '1180x734', out: '', file: '', subject: '英语' };
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--size') opt.size = rest[++i];
  else if (rest[i] === '--out') opt.out = resolve(rest[++i]);
  else if (rest[i] === '--subject') opt.subject = rest[++i];
  else opt.file = resolve(rest[i]);
}
const must = (iss = []) => iss.filter((x) => x.what === '压着' || x.what === '出了屏幕');
const lineOf = (x) => `${x.an || x.a}${x.what === '压着' ? ` 和 ${x.bn || x.b} 压着` : ' 出了屏幕'}`;
function tryJson(file, { shots = '', sight = false } = {}) {
  const args = [join(ROOT, 'tools/stage-try.mjs'), file, '--json', ...(shots ? ['--shots', shots] : [])];
  const out = execFileSync('node', args, { env: { ...process.env, STAGE_TRY_SIZE: opt.size, ...(sight ? { STAGE_TRY_SIGHT: '1' } : {}) }, maxBuffer: 1 << 28, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const res = JSON.parse(out);
  return (Array.isArray(res) ? res[0] : res).views[0];
}
const srcOf = (steps) => steps.map((s) => s.src).join('\n');

if (cmd === 'prepare') {
  if (!opt.file || !opt.out) { console.error('用法：prepare 文件.txt --out 目录'); process.exit(2); }
  mkdirSync(join(opt.out, 'shots'), { recursive: true });
  const steps = parseTry(readFileSync(opt.file, 'utf8')).filter((s) => !s.fix);
  writeFileSync(join(opt.out, 'base.txt'), srcOf(steps));
  const v = tryJson(join(opt.out, 'base.txt'), { shots: join(opt.out, 'shots') });
  const { eventsText } = await import(pathToFileURL(join(ROOT, 'kit/src/stage/events.js')).href);
  const { STAGE_TEACH, stageDoc } = await import(pathToFileURL(join(ROOT, 'kit/src/stage/doc.js')).href);
  writeFileSync(join(opt.out, 'doc.txt'), `${STAGE_TEACH}\n\n${stageDoc(opt.subject)}`);
  const cases = [];
  v.steps.forEach((s, k) => {
    const bad = must(s.issues);
    if (s.step.kind !== 'teacher' || !bad.length) return;
    const lines = [...new Set(bad.map(lineOf))];
    const said = eventsText([{ kind: 'sight', text: lines.join('；'), n: 1, at: 0 }], { goals: new Map() });
    const id = `c${cases.length + 1}`;
    cases.push({ id, upto: k, problems: lines, shot: s.shot });
    writeFileSync(join(opt.out, `${id}.md`), [
      `# ${id}：老师第 ${k + 1} 步演完以后`,
      '', '这一轮你（老师）刚写的：', '```', s.step.src, '```',
      '', '页面发给你的这一条（画面图是 shots 里的那一张）：', '```', `[学生]\n${said}\n\n[舞台现在]\n${s.state}`, '```',
      '', `画面图：${s.shot}`,
    ].join('\n'));
  });
  writeFileSync(join(opt.out, 'cases.json'), JSON.stringify({ file: opt.file, size: opt.size, cases }, null, 1));
  console.log(`${cases.length} 题：${cases.map((c) => `${c.id}（${c.problems.join('；')}）`).join('\n')}`);
} else if (cmd === 'apply') {
  const dir = opt.file || opt.out;
  const { cases, size } = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
  opt.size = size;
  const steps = parseTry(readFileSync(join(dir, 'base.txt'), 'utf8'));
  const rows = [];
  for (const c of cases) {
    const outF = join(dir, `${c.id}.out.txt`);
    if (!existsSync(outF)) { rows.push(`| ${c.id} | ${c.problems.join('；')} | （没写） | | |`); continue; }
    const fix = readFileSync(outF, 'utf8').trim();
    // 第二次（页面最多交回两次）：老师看了第一次改完的样子再写的（round2 出的题）
    const out2 = join(dir, `${c.id}.out2.txt`);
    const fix2 = existsSync(out2) ? readFileSync(out2, 'utf8').trim() : '';
    const f = join(dir, `${c.id}.try.txt`);
    writeFileSync(f, `${srcOf(steps.slice(0, c.upto + 1))}\n自查:\n${fix}\n${fix2 ? `自查:\n${fix2}\n` : ''}`);
    mkdirSync(join(dir, 'after'), { recursive: true });
    const v = tryJson(f, { shots: join(dir, 'after') });
    const last = v.steps.at(-1);
    const bad = last.step.fix ? must(last.issues) : [{ what: '压着', an: '（改画面那一段没用上）', bn: '' }];
    const asking = /在等学生/.test(last.state || '');
    const ok = !bad.length && !last.veiled && asking;
    rows.push(`| ${c.id} | ${c.problems.join('；')} | ${fix.split('\n').length} 行${fix2 ? ` + 第二次 ${fix2.split('\n').length} 行` : ''} | ${bad.length ? bad.map(lineOf).join('；') : '干净'}${asking ? '' : '；那一问没了'} | ${ok ? '✓' : '✗'} |`);
    console.log(`${ok ? '✓' : '✗'} ${c.id}`);
  }
  const pass = rows.filter((r) => r.endsWith('✓ |')).length;
  writeFileSync(join(dir, 'results.md'), `# 画面自查：真的老师改得好不好\n\n${pass} / ${cases.length}\n\n| 题 | 页面量到的 | 老师写的 | 改完 | 过 |\n|---|---|---|---|---|\n${rows.join('\n')}\n`);
  console.log(`${pass} / ${cases.length}`);
} else if (cmd === 'round2') {
  // 第一次没改好的：照页面真会发的那样出第二题（改完以后的画面图、还剩的问题、第一次写的、没演上的行）
  const dir = opt.file || opt.out;
  const { cases, size } = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
  opt.size = size;
  const { eventsText } = await import(pathToFileURL(join(ROOT, 'kit/src/stage/events.js')).href);
  mkdirSync(join(dir, 'r2'), { recursive: true });
  for (const c of cases) {
    const f = join(dir, `${c.id}.try.txt`);
    if (!existsSync(f) || existsSync(join(dir, `${c.id}.out2.txt`))) continue;
    const v = tryJson(f, { shots: join(dir, 'r2') });
    const last = v.steps.at(-1);
    const bad = must(last.issues);
    if (!bad.length) continue;
    const lines = [...new Set(bad.map(lineOf))];
    const said = eventsText([{ kind: 'sight', text: lines.join('；'), n: 2, last: true, at: 0 }], { goals: new Map() });
    const errs = (last.errors || []).filter((e) => !e.kept).map((e) => `- 第 ${e.line} 行 ${e.src}：${e.error}`).join('\n');
    writeFileSync(join(dir, `${c.id}.r2.md`), [
      `# ${c.id} 第二次`, '', '你上一轮（第一次改画面）写的：', '```', readFileSync(join(dir, `${c.id}.out.txt`), 'utf8').trim(), '```',
      '', '页面发给你的这一条（画面图是改完以后的样子）：', '```', `[学生]\n${said}${errs ? `\n\n[上一轮没演的行]\n${errs}` : ''}\n\n[舞台现在]\n${last.state}`, '```', '', `画面图：${last.shot}`,
    ].join('\n'));
    console.log(`${c.id}：${lines.join('；')}`);
  }
} else {
  console.error('用法：prepare 文件.txt --out 目录 [--size] | apply 目录 | round2 目录');
  process.exit(2);
}
