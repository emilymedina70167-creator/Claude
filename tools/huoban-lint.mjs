#!/usr/bin/env node
// 活板的检查工具（docs/talk-plan.md）：给写活板的人（开发、助手、验收）用。
//   node tools/huoban-lint.mjs 文件.board …        读写法、跑教学检查（kit/src/huoban/check.js），列出每个演示对象能取的成员
//   node tools/huoban-lint.mjs --members paging '字段=值, …'   只看一个演示对象：parse 成不成、能取哪些成员、每个成员现在的值、常见错法下的值
//   node tools/huoban-lint.mjs --page out.html 文件.board …     把几块板拼成一个示例页（```huoban 围栏），再交给 tools/check-lesson.mjs 在 iPad 尺寸下渲染、截图
// 一个 .board 文件就是一块板的源码；文件里用一行 `---` 隔开几块板也行。有 error 时退出码是 1。
import { readFileSync, writeFileSync } from 'node:fs';
import { Runtime } from '../kit/src/huoban/runtime.js';
import { checkBoard } from '../kit/src/huoban/check.js';
import { processTags, variantAnswers } from '../kit/src/huoban/objects.js';
import { text } from '../kit/src/huoban/values.js';
import { ENGINES } from '../kit/src/engines/registry.js';

const args = process.argv.slice(2);
let bad = 0;

function members(rt, name, v) {
  const tags = processTags(v);
  const lines = [`  ${name}：${v.engine.title || v.name}，${v.run.steps.length - 1} 步；能取：steps${tags.size ? '、' + [...tags.keys()].join('、') : ''}`];
  for (const [tag, list] of tags) {
    let val = '';
    try { val = text(rt.value(`${name}.${tag}`)); } catch (e) { val = `（${e.message}）`; }
    const vs = variantAnswers(v, tag).map((x) => `${x.label} → ${text(x.value)}`);
    lines.push(`    ${name}.${tag}${list.length > 1 ? `（${list.length} 次，${name}.${tag}.1 起取第几次）` : ''} = ${val}${vs.length ? `；常见错法：${vs.join('；')}` : ''}`);
  }
  return lines.join('\n');
}

function lintOne(src, label) {
  const rt = new Runtime();
  const b = rt.load(src);
  const out = [`== ${label}`];
  for (const e of b.errors) { out.push(`  error 第 ${e.n} 行：${e.msg}\n        ${e.line}`); bad++; }
  let probs = [];
  try { probs = checkBoard(rt); } catch (e) { out.push(`  error 检查没跑完：${e.message}`); bad++; }
  for (const p of probs) { out.push(`  ${p.level} ${p.code}：${p.msg}`); if (p.level === 'error') bad++; }
  for (const [name] of rt.cells) {
    let v; try { v = rt.get(name); } catch (e) { out.push(`  error ${name} 算不出来：${e.message}`); bad++; continue; }
    if (v && v.kind === 'process') out.push(members(rt, name, v));
  }
  if (!b.errors.length && !probs.length) out.push('  没有问题');
  return out.join('\n');
}

const boardsOf = (file) => readFileSync(file, 'utf8').split(/^---\s*$/m).map((s) => s.trim()).filter(Boolean);

if (args[0] === '--members') {
  const [, name, fields = ''] = args;
  if (!ENGINES[name]) { console.error(`没有演示「${name}」。有：${Object.keys(ENGINES).join(' ')}`); process.exit(1); }
  console.log(lintOne(`let p = ${name}(${fields})`, `${name}(${fields})`));
} else if (args[0] === '--page') {
  const [, outFile, ...files] = args;
  const parts = files.flatMap((f) => boardsOf(f).map((src, i) => `## ${f.replace(/^.*\//, '')}${i ? ` · ${i + 1}` : ''}\n\n\`\`\`huoban\n${src}\n\`\`\`\n`));
  writeFileSync(outFile, `<!doctype html>\n<meta charset="utf-8">\n<title>活板检查</title>\n<script src="la-kit.js"></script>\n<script type="text/markdown">\n${parts.join('\n')}</script>\n`);
  console.log(`写好了 ${outFile}（${parts.length} 块板）。和 kit/dist/la-kit.js 放在同一个目录里：node tools/check-lesson.mjs ${outFile} --shots 目录`);
} else {
  if (!args.length) { console.error('用法见文件开头的注释'); process.exit(2); }
  for (const f of args) boardsOf(f).forEach((src, i) => console.log(lintOne(src, `${f}${i ? ` · 第 ${i + 1} 块` : ''}`)));
}
process.exit(bad ? 1 : 0);
