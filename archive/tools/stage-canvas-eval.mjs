// 设计要求单（舞台第九轮「画面归老师」的验收）：学生在真课里会说的 30 句「我不喜欢这个样子」，
// 模拟老师只看说明、画面图和舞台现状写一轮，页面照它演出来，评卷看前后两张图判做到没有。
//
//   node tools/stage-canvas-eval.mjs prepare <目录>   每个起始画面横屏演一遍、截图；每条要求写一份给模拟老师的 prompt-<id>.md
//   node tools/stage-canvas-eval.mjs apply <目录>     <目录>/<id>.lines.txt（模拟老师写的那一轮）接在起始画面后面演、截图，写 apply.json
//   node tools/stage-canvas-eval.mjs freeprep <目录>  自由排版（free.json）：学生没提要求，老师自己设计画面；每个开场一份 prompt-<名字>.md
//   node tools/stage-canvas-eval.mjs freeapply <目录> <目录>/<名字>.lines.txt 接在开场后面演、截图，写 free.json（老师的意图在 intent-<名字>.txt）
//
// 截图、现状都是横屏（学生只在横屏 iPad 上学）。模拟老师、评卷由开发那边派子代理做（这个脚本只当页面）
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGE_TEACH, stageDoc } from '../kit/src/stage/doc.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, dirArg] = process.argv.slice(2);
if (!['prepare', 'apply', 'freeprep', 'freeapply'].includes(cmd) || !dirArg) { console.error('用法：node tools/stage-canvas-eval.mjs prepare|apply|freeprep|freeapply <目录>'); process.exit(2); }
const dir = resolve(dirArg);
mkdirSync(dir, { recursive: true });
const spec = JSON.parse(readFileSync(join(ROOT, 'evals/stage-canvas/requests.json'), 'utf8'));
const SUBJECT = { modal: '英语', tense: '英语', matrix: '线代', tree: '数据结构' };

function tryRun(files, shots) {
  const out = execFileSync('node', [join(ROOT, 'tools/stage-try.mjs'), ...files, '--shots', shots, '--json'], { env: { ...process.env, STAGE_TRY_VIEWS: '横屏' }, maxBuffer: 64 * 1024 * 1024, timeout: 1500000 }).toString();
  return JSON.parse(out);
}
const lastStep = (r) => r.views?.[0]?.steps?.at(-1) || {};

if (cmd === 'prepare') {
  const files = Object.entries(spec.starts).map(([k, src]) => { const f = join(dir, `start-${k}.txt`); writeFileSync(f, `${src}\n`); return f; });
  const res = tryRun(files, join(dir, 'shots'));
  const state = {};
  res.forEach((r, i) => { const st = lastStep(r); state[Object.keys(spec.starts)[i]] = { state: st.state || '', shot: st.shot || '', errors: st.errors || [] }; });
  writeFileSync(join(dir, 'starts.json'), JSON.stringify(state, null, 2));
  for (const q of spec.requests) {
    const s = state[q.start];
    const doc = `${STAGE_TEACH}\n\n${stageDoc(SUBJECT[q.start])}`;
    writeFileSync(join(dir, `prompt-${q.id}.md`), `# 你是舞台课的老师（模拟）

下面是你每一轮都会收到的说明，然后是这一刻的舞台现状、画面图和学生刚说的话。照说明写这一轮（只写指令行）。

## 说明

${doc}

## [学生]

学生说：「${q.say}」

[画面] 附了一张这一刻的画面图（先看图再写）：${s.shot}

## [舞台现在]

${s.state}

写下一轮。
`);
  }
  console.log(`准备好了 ${spec.requests.length} 份（${dir}）；起始画面的截图在 shots/`);
}

if (cmd === 'apply') {
  const todo = spec.requests.filter((q) => existsSync(join(dir, `${q.id}.lines.txt`)));
  const files = todo.map((q) => {
    const f = join(dir, `after-${q.id}.txt`);
    // 起始画面一轮（以一问结尾）→ 学生说那句话 → 老师写的那一轮
    writeFileSync(f, `${spec.starts[q.start]}\n学生: say ${q.say}\n${readFileSync(join(dir, `${q.id}.lines.txt`), 'utf8').trim()}\n`);
    return f;
  });
  const res = files.length ? tryRun(files, join(dir, 'shots')) : [];
  const starts = JSON.parse(readFileSync(join(dir, 'starts.json'), 'utf8'));
  const out = todo.map((q, i) => {
    const st = lastStep(res[i] || {});
    return { id: q.id, say: q.say, want: q.want, before: starts[q.start].shot, after: st.shot || '', errors: (st.errors || []).filter((e) => !starts[q.start].errors.some((x) => x.src === e.src)), state: st.state || '' };
  });
  writeFileSync(join(dir, 'apply.json'), JSON.stringify(out, null, 2));
  console.log(`演了 ${out.length} 条；没演上的行：${out.filter((o) => o.errors.length).map((o) => o.id).join('、') || '没有'}`);
}

// —— 自由排版：老师自己设计画面 ——
if (cmd === 'freeprep' || cmd === 'freeapply') {
  const free = JSON.parse(readFileSync(join(ROOT, 'evals/stage-canvas/free.json'), 'utf8'));
  const names = Object.keys(free.starts);
  if (cmd === 'freeprep') {
    const files = names.map((k) => { const f = join(dir, `start-${k}.txt`); writeFileSync(f, `${free.starts[k].src}\n`); return f; });
    const res = tryRun(files, join(dir, 'shots'));
    const starts = {};
    res.forEach((r, i) => { const st = lastStep(r); starts[names[i]] = { state: st.state || '', shot: st.shot || '', errors: st.errors || [] }; });
    writeFileSync(join(dir, 'starts.json'), JSON.stringify(starts, null, 2));
    for (const k of names) {
      const s0 = starts[k];
      const doc = `${STAGE_TEACH}\n\n${stageDoc(free.starts[k].subject)}`;
      writeFileSync(join(dir, `prompt-${k}.md`), `# 你是舞台课的老师（模拟）\n\n下面是你每一轮都会收到的说明，然后是这一刻的舞台现状、画面图。照说明写这一轮（只写指令行）。\n\n## 说明\n\n${doc}\n\n## [学生]\n\n${free.ask}\n\n[画面] 附了一张这一刻的画面图（先看图再写）：${s0.shot}\n\n## [舞台现在]\n\n${s0.state}\n\n先在 intent-${k}.txt 里用两三句话写你想要的画面（什么在哪、长什么样、为什么这样好教），再写这一轮的指令行（${k}.lines.txt）。\n`);
    }
    const bad = names.filter((k) => starts[k].errors.length);
    console.log(`准备好了 ${names.length} 份（${dir}）${bad.length ? `；开场有没演上的行：${bad.join('、')}` : ''}`);
  } else {
    const todo = names.filter((k) => existsSync(join(dir, `${k}.lines.txt`)));
    const files = todo.map((k) => { const f = join(dir, `after-${k}.txt`); writeFileSync(f, `${free.starts[k].src}\n${free.starts[k].act}\n${readFileSync(join(dir, `${k}.lines.txt`), 'utf8').trim()}\n`); return f; });
    const res = files.length ? tryRun(files, join(dir, 'shots')) : [];
    const starts = JSON.parse(readFileSync(join(dir, 'starts.json'), 'utf8'));
    const out = todo.map((k, i) => {
      const steps = res[i]?.views?.[0]?.steps || [];
      const st = steps.at(-1) || {};
      const errors = steps.flatMap((x) => x.errors || []).filter((e) => !starts[k].errors.some((y) => y.src === e.src));
      return { id: k, intent: existsSync(join(dir, `intent-${k}.txt`)) ? readFileSync(join(dir, `intent-${k}.txt`), 'utf8').trim() : '', before: starts[k].shot, after: st.shot || '', errors, state: st.state || '' };
    });
    writeFileSync(join(dir, 'free.json'), JSON.stringify(out, null, 2));
    console.log(`演了 ${out.length} 个；没演上的行：${out.filter((o) => o.errors.length).map((o) => `${o.id}（${o.errors.length}）`).join('、') || '没有'}`);
  }
}
