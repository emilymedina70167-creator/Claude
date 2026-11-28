#!/usr/bin/env node
// 外部的预检工具（第十五轮，外部主 Claude 的修改意见 3.2）：外部主 Claude 在自己的云端沙盒里，把这一轮要写进学习台的 ext_in
// 先在真的浏览器里跑一遍——和学习台同一份组件库（kit/dist/la-kit.js）、同一个解析（课堂的 parseOutput / finishTurn）——
// 出 iPad 两个尺寸的截图和问题列表。只是给外部用的东西，不是规定每一轮都要跑。
//
//   node tools/ext-check.mjs --next 这一轮.txt [--session 存数据的目录] [--sid c-20261118-1] [--unit 课名] [--subject 线代] [--shots 目录]
//   node tools/ext-check.mjs --next 这一轮.txt --lint [--session …]   ← 不开浏览器，一秒以内只查写法（tools/ext-lint.js）
//   --session 也可以是一个文件：每行一条 { id, data }（id 写 sessions/{编号}/ext_in/001 这样的路径），或者整个文件一个数组
//
// kit/dist/la-kit.js 是提交在仓库里的（和学习台发布的同一份），clone 下来 npm install 就能跑，不用 build。
// --session：用 ArtifactData 的 out_dir 存下来的那个目录（里面有 sessions/{编号}/ext_in/*.json、ext_out/*.json）；不给就只跑这一轮。
// 不用 npm install 以外的东西：Playwright 和 Chromium 用沙盒里预装的。
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extClass, sessionFromFile } from './ext-class.js';

const here = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(here, '../kit/dist/la-kit.js');

function arg(name, def = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const nextFile = arg('next');
if (!nextFile) { console.error('要写 --next 这一轮.txt（这一轮要写进 ext_in 的 text）'); process.exit(2); }
const LINT = process.argv.includes('--lint');
if (!LINT && !existsSync(KIT)) { console.error(`没有 ${KIT}：先 npm run build`); process.exit(2); }

// 存下来的 JSON：ArtifactData 的 out_dir 每条一个文件，内容可能是文档本身，也可能包了一层 { data }
const readDocs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { const j = JSON.parse(readFileSync(join(dir, f), 'utf8')); return { id: f.replace(/\.json$/, ''), ...(j.data || j) }; }) : []);
function sessionDirs(root, sid) {
  const base = join(root, 'sessions');
  if (!existsSync(base)) return null;
  const ids = sid ? [sid] : readdirSync(base).filter((x) => existsSync(join(base, x, 'ext_in'))).sort();
  const id = ids.at(-1);
  return id ? { id, ins: readDocs(join(base, id, 'ext_in')), outs: readDocs(join(base, id, 'ext_out')) } : null;
}

const root = arg('session');
// --session 是一个文件（每行一条 { id, data }，或一个数组）也认（dr-ext-round2）
const asFile = root && existsSync(resolve(root)) && statSync(resolve(root)).isFile();
const s = !root ? null : asFile ? (() => { const r = sessionFromFile(readFileSync(resolve(root), 'utf8')); if (r.bad.length) console.error(`--session 文件里第 ${r.bad.join('、')} 行读不懂（每行一条 { id, data }，或整个文件一个数组），跳过了`); return { id: arg('sid') || r.id || '外部的课', ins: r.ins, outs: r.outs }; })() : sessionDirs(resolve(root), arg('sid'));
// --lint：只查写法，不开浏览器
if (LINT) {
  const { lintTurn, blockNames, priorTexts, checkers } = await import('./ext-lint.js');
  const t0 = Date.now();
  const extra = await checkers();
  const r = lintTurn({ prior: priorTexts(s?.ins || []), text: readFileSync(resolve(nextFile), 'utf8'), names: await blockNames(), ...extra, hints: { react: String(arg('hints', '')).split(',').includes('react') } });
  const errs = r.problems.filter((p) => p.level !== 'hint'), hints = r.problems.filter((p) => p.level === 'hint');
  console.log(`写法检查：${r.segments} 段、${r.components} 个组件，${errs.length ? `${errs.length} 处问题` : '没有问题'}${hints.length ? `；${hints.length} 条出题提示` : ''}（${Date.now() - t0} 毫秒，没开浏览器；画出来的样子用不带 --lint 的跑）`);
  for (const p of errs) console.log(`  · ${p.where}：${p.msg}`);
  if (hints.length) { console.log('出题提示（只是提醒，不算写错）：'); for (const p of hints) console.log(`  · ${p.where}：${p.msg}`); }
  process.exit(errs.length ? 1 : 0);
}
const spec = extClass({ ins: s?.ins || [], outs: s?.outs || [], next: readFileSync(resolve(nextFile), 'utf8'), unit: arg('unit', s?.id || '外部的课'), subject: arg('subject') });
const tmp = mkdtempSync(join(tmpdir(), 'ext-check-'));
const file = join(tmp, `${(s?.id || 'ext').replace(/\W+/g, '-')}.class.json`);
writeFileSync(file, JSON.stringify(spec, null, 2));

// 这份组件库是哪一版：和学习台发布的对得上，跑出来的才和学生看到的一样
// 开浏览器的那一半才取 Playwright：--lint 写着不开浏览器，没装 Playwright 的地方（CI 的 test）也要跑得了
const { chromium } = await import('./playwright.mjs');
const browser = await chromium.launch();
let version = '?';
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  await page.addScriptTag({ path: KIT });
  version = await page.evaluate(() => window.LAKit?.version || '?');
} finally { await browser.close(); }
console.log(`组件库版本：${version}（${KIT}）`);
console.log(`这节课已有 ${s?.ins.length || 0} 轮 ext_in、${s?.outs.length || 0} 份 ext_out；这一轮是第 ${spec.turns.length} 轮`);

const shots = arg('shots');
const r = spawnSync(process.execPath, [join(here, 'check-lesson.mjs'), file, ...(shots ? ['--shots', resolve(shots)] : [])], { stdio: 'inherit' });
process.exit(r.status ?? 1);
