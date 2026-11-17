#!/usr/bin/env node
// 外部的预检工具（第十五轮，外部主 Claude 的修改意见 3.2）：外部主 Claude 在自己的云端沙盒里，把这一轮要写进学习台的 ext_in
// 先在真的浏览器里跑一遍——和学习台同一份组件库（kit/dist/la-kit.js）、同一个解析（课堂的 parseOutput / finishTurn）——
// 出 iPad 两个尺寸的截图和问题列表。只是给外部用的东西，不是规定每一轮都要跑。
//
//   node tools/ext-check.mjs --next 这一轮.txt [--session 存数据的目录] [--sid c-20261118-1] [--unit 课名] [--subject 线代] [--shots 目录]
//
// --session：用 ArtifactData 的 out_dir 存下来的那个目录（里面有 sessions/{编号}/ext_in/*.json、ext_out/*.json）；不给就只跑这一轮。
// 不用 npm install 以外的东西：Playwright 和 Chromium 用沙盒里预装的。
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from './playwright.mjs';
import { extClass } from './ext-class.js';

const here = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(here, '../kit/dist/la-kit.js');

function arg(name, def = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const nextFile = arg('next');
if (!nextFile) { console.error('要写 --next 这一轮.txt（这一轮要写进 ext_in 的 text）'); process.exit(2); }
if (!existsSync(KIT)) { console.error(`没有 ${KIT}：先 npm run build`); process.exit(2); }

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
const s = root ? sessionDirs(resolve(root), arg('sid')) : null;
const spec = extClass({ ins: s?.ins || [], outs: s?.outs || [], next: readFileSync(resolve(nextFile), 'utf8'), unit: arg('unit', s?.id || '外部的课'), subject: arg('subject') });
const tmp = mkdtempSync(join(tmpdir(), 'ext-check-'));
const file = join(tmp, `${(s?.id || 'ext').replace(/\W+/g, '-')}.class.json`);
writeFileSync(file, JSON.stringify(spec, null, 2));

// 这份组件库是哪一版：和学习台发布的对得上，跑出来的才和学生看到的一样
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
