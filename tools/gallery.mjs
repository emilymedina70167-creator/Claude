#!/usr/bin/env node
// 组件画廊：把示例页里的每个组件单独截一张图（演示组件停在最后一步），几种风格各截一遍，再拼成几张「联系表」，
// 一眼看完全部组件在各种风格下的样子（视觉统一、浅色风格里看不清的颜色、挤在一起的字）。只给开发时看，不进 CI。
//
// 用法：node tools/gallery.mjs [选项] 示例页…
//   --out 目录         截图和联系表放哪（必写）
//   --themes all|列表  all：五种风格；或者 default,paper,white（默认 all）
//   --width 820        页面宽度（默认 820，iPad 竖屏）
//   --only id1,id2     只截这几个组件（按 id）
//   --per 12           一张联系表放几个（默认 12）
// 出来的：目录/组件/页面-id-风格.png，目录/sheet-1.png……（一张联系表一行是一个组件的几种风格）
import { chromium } from './playwright.mjs';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { withTheme } from './check-lesson.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = ['default', 'chalk', 'paper', 'midnight', 'white'];
// 演示组件的名字（blocks/index.js 里用 stepperBlock 注册的，加上 elim）：给它们加 start: end，截最后一步
const STEPPERS = new Set([...readFileSync(join(ROOT, 'kit/src/blocks/index.js'), 'utf8').matchAll(/(\w+):\s*stepperBlock\(/g)].map((m) => m[1]).concat('elim'));

function parseArgs(argv) {
  const opt = { out: '', themes: THEMES, width: 820, only: null, per: 12, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opt.out = argv[++i];
    else if (a === '--themes') { const v = argv[++i]; opt.themes = v === 'all' ? THEMES : v.split(',').map((x) => x.trim()); }
    else if (a === '--width') opt.width = Number(argv[++i]);
    else if (a === '--only') opt.only = new Set(argv[++i].split(',').map((x) => x.trim()));
    else if (a === '--per') opt.per = Number(argv[++i]);
    else opt.files.push(a);
  }
  if (!opt.out || !opt.files.length) throw new Error('用法：node tools/gallery.mjs --out 目录 [--themes all] 示例页…');
  for (const t of opt.themes) if (!THEMES.includes(t)) throw new Error(`--themes 里的「${t}」不是风格（${THEMES.join('、')}）`);
  return opt;
}

// 课件里每个演示组件的围栏块，开头加一行 start: end（已经写了 start: 的不动），停在最后一步
export function toEnd(md) {
  // 先猜的问题去掉（有的放在第 1 步之前问，不去掉就停在第 0 步）
  return md.replace(/^(`{3,})(\w+)\n([\s\S]*?)^\1[ \t]*$/gm, (all, fence, name, body) => (STEPPERS.has(name) && !/^start\s*:/m.test(body) ? `${fence}${name}\nstart: end\n${body.replace(/^(ask|predict)\s*:.*\n/gm, '')}${fence}` : all));
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  mkdirSync(join(opt.out, '组件'), { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'gallery-'));
  copyFileSync(join(ROOT, 'kit/dist/la-kit.js'), join(dir, 'la-kit.js'));
  const browser = await chromium.launch();
  const shots = []; // { page, id, theme, file }
  for (const file of opt.files) {
    const src = readFileSync(file, 'utf8');
    for (const theme of opt.themes) {
      const html = src.replace(/(<script type="text\/(?:markdown|lesson)">\s*)([\s\S]*?)(<\/script>)/, (_, a, md, b) => a + toEnd(withTheme(md, theme === 'default' ? '' : theme)) + b);
      const name = `${basename(file, '.html')}-${theme}.html`;
      writeFileSync(join(dir, name), html);
      const ctx = await browser.newContext({ viewport: { width: opt.width, height: 1180 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(join(dir, name)).href);
      await page.waitForTimeout(900);
      await page.evaluate(() => { document.querySelectorAll('.stage[hidden]').forEach((s) => { s.hidden = false; }); window.dispatchEvent(new Event('resize')); });
      await page.waitForTimeout(400);
      const ids = await page.evaluate(() => [...document.querySelectorAll('.block[data-bid]')].map((b) => b.dataset.bid).filter(Boolean));
      for (const id of ids) {
        if (opt.only && !opt.only.has(id)) continue;
        const el = page.locator(`.block[data-bid="${id}"]`).first();
        if (!(await el.isVisible().catch(() => false))) continue;
        const out = join(opt.out, '组件', `${basename(file, '.html')}-${id}-${theme}.png`.replace(/[^\w.\-一-鿿]/g, '_'));
        try { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(250); await el.screenshot({ path: out }); shots.push({ page: basename(file), id, theme, file: out }); } catch { /* 太大或看不见的跳过 */ }
      }
      await ctx.close();
    }
  }
  // 联系表：一行一个组件，几种风格并排
  const rows = [];
  for (const s of shots) { let r = rows.find((x) => x.page === s.page && x.id === s.id); if (!r) rows.push((r = { page: s.page, id: s.id, cells: [] })); r.cells.push(s); }
  let n = 0;
  for (let i = 0; i < rows.length; i += opt.per) {
    const part = rows.slice(i, i + opt.per);
    const cols = opt.themes.length;
    const body = part.map((r) => `<div class="row"><div class="cap">${r.page}<br><b>${r.id}</b></div>${opt.themes.map((t) => { const c = r.cells.find((x) => x.theme === t); return `<div class="cell">${c ? `<img src="${pathToFileURL(c.file).href}">` : ''}<span>${t}</span></div>`; }).join('')}</div>`).join('');
    const sheet = join(dir, `sheet-${++n}.html`);
    writeFileSync(sheet, `<!doctype html><meta charset="utf-8"><style>body{margin:8px;background:#777;font:12px sans-serif;color:#fff}.row{display:grid;grid-template-columns:90px repeat(${cols},1fr);gap:6px;margin-bottom:8px;align-items:start}.cap{word-break:break-all}.cell{position:relative;background:#555}.cell img{width:100%;display:block}.cell span{position:absolute;top:2px;right:4px;background:#0008;padding:0 4px}</style>${body}`);
    const ctx = await browser.newContext({ viewport: { width: 300 * cols + 100, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(sheet).href);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(opt.out, `sheet-${n}.png`), fullPage: true });
    await ctx.close();
  }
  await browser.close();
  console.log(`${shots.length} 张截图（${rows.length} 个组件 × ${opt.themes.length} 种风格），${n} 张联系表：${opt.out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
