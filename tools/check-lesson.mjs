#!/usr/bin/env node
// 页面检查：把课件、实时黑板的段、课堂输出放进真的页面里跑一遍（预装的 Playwright + Chromium），
// 报出作者看不到的问题：写法错误、脚本报错、横向溢出、组件冲出版面、图里的字叠在一起、一块板一屏放不下。
// 课件作者（对话里的 Claude、课堂里的 Claude）看不到渲染效果，这个脚本替它看；验收题库（evals/）也靠它打分。
//
// 用法：node tools/check-lesson.mjs [选项] 文件…
//   *.md          课件 Markdown（front matter + 正文）
//   *.html        示例页（kit/examples/ 那种：一段 <script type="text/markdown">）
//   *.board.json  实时黑板的段：{ "unit", "subject", "steps": [{ "id", "seq", "page", "title", "md", "pin" }] }
//   *.class.json  课堂输出：{ "unit", "subject", "pack": { "main", "problems" }, "turns": [{ "student", "teacher" }] }
//                 （teacher 是课堂里的 Claude 一轮的完整输出：说的话 + board 围栏块；student 是这一轮之前学生发的话，
//                  第一轮是点「开始上课」，不用写）
// 选项：
//   --sizes ipad|all     ipad（默认）：820×1180、1180×820；all 再加手机 390×844
//   --themes default|all 风格：默认只看课件自己写的；all 五种都看
//   --shots 目录          存截图
//   --out 文件.json       结果写成 JSON
//   --no-walk            演示组件不一步步走（默认走到底，碰到先猜就点「想不出来」）
//   --quiet              只打印有问题的
//   --kit 文件            用别的 la-kit.js（比如验收基线那一版），默认 kit/dist/la-kit.js
// 退出码：有「错」就是 1（写法错误、脚本报错、横向溢出、组件冲出版面）；「注意」（字叠在一起、放不下、要横着滑）不算。
import { chromium } from './playwright.mjs';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'kit/dist/la-kit.js');
const SIZES = { ipad: [[820, 1180], [1180, 820]], all: [[820, 1180], [1180, 820], [390, 844]] };
const THEMES = ['', 'chalk', 'paper', 'midnight', 'white'];

export function parseArgs(argv) {
  const opt = { sizes: 'ipad', themes: 'default', shots: '', out: '', walk: true, quiet: false, kit: '', files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sizes') opt.sizes = argv[++i];
    else if (a === '--themes') opt.themes = argv[++i];
    else if (a === '--shots') opt.shots = argv[++i];
    else if (a === '--out') opt.out = argv[++i];
    else if (a === '--no-walk') opt.walk = false;
    else if (a === '--quiet') opt.quiet = true;
    else if (a === '--kit') opt.kit = argv[++i];
    else if (a.startsWith('--')) throw new Error(`不认识的选项 ${a}`);
    else opt.files.push(a);
  }
  if (!SIZES[opt.sizes]) throw new Error('--sizes 只能是 ipad 或 all');
  if (!['default', 'all'].includes(opt.themes)) throw new Error('--themes 只能是 default 或 all');
  return opt;
}

// 课件 front matter 里换风格（没有 front matter 就加一个）
export function withTheme(md, theme) {
  if (!theme) return md;
  const m = /^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(md);
  if (!m) return `---\ntheme: ${theme}\n---\n${md}`;
  const fm = m[1].split(/\r?\n/).filter((l) => !/^\s*theme\s*:/.test(l));
  fm.push(`theme: ${theme}`);
  return md.slice(0, m.index) + `---\n${fm.join('\n')}\n---\n` + md.slice(m.index + m[0].length);
}

export const pageHtml = (md, title = 'check') => `<!doctype html>
<meta charset="utf-8">
<title>${title.replace(/[<&]/g, '')}</title>
<script src="la-kit.js"></script>
<script type="text/markdown">
${md.replace(/<\/script/gi, '<\\/script')}
</script>
`;

// 示例页：把里面的课件 Markdown 拿出来换风格
function htmlWithTheme(html, theme) {
  if (!theme) return html;
  return html.replace(/(<script type="text\/(?:markdown|lesson)">\s*)([\s\S]*?)(<\/script>)/, (_, a, md, b) => a + withTheme(md, theme) + b);
}

const frontOf = (unit, subject, mode, theme) => `---\nmode: ${mode}\nunit: ${unit}\n${subject ? `subject: ${subject}\n` : ''}${theme ? `theme: ${theme}\n` : ''}---\n`;

// —— 页面里跑的检查 ——
// 只看「写字的东西」：SVG 里的 text（图的标签、格子里的数）。同一个字写两遍做描边（halo）的不算叠
function inspectInPage(scopeSel) {
  const out = { problems: [], overflow: 0, spills: [], scrolls: [], overlaps: [], unfit: [] };
  const s = window.LAKit?.session;
  out.problems = (s?.problems || []).map((p) => ({ kind: p.kind, msg: p.msg, soft: !!p.soft }));
  const W = window.innerWidth;
  const sw = document.documentElement.scrollWidth;
  if (sw > W + 1) out.overflow = sw - W;
  const scope = scopeSel ? document.querySelector(scopeSel) || document : document;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]'); };
  const label = (el) => {
    const b = el.closest('.block');
    const name = b ? [...b.classList].find((c) => c.startsWith('block-') && c !== 'block-error')?.slice(6) : '';
    const id = b?.querySelector('[data-id]')?.dataset.id || b?.dataset.id || '';
    const title = b?.querySelector('.w-title, .sv-title, h3, .block-title')?.textContent?.trim().slice(0, 30) || '';
    return [name, id, title && `「${title}」`].filter(Boolean).join(' ');
  };
  for (const b of scope.querySelectorAll('.block')) {
    if (!visible(b)) continue;
    const host = b.parentElement?.closest('.la-lesson, .cb-seg, .stage-body, .lv-seg, section') || document.body;
    const r = b.getBoundingClientRect(), hr = host.getBoundingClientRect();
    if (r.right > Math.min(hr.right, W) + 2 || r.left < Math.max(hr.left, 0) - 2) out.spills.push(`${label(b)} 宽 ${Math.round(r.width)}，超出版面 ${Math.round(Math.max(r.right - Math.min(hr.right, W), Math.max(hr.left, 0) - r.left))}px`);
    // 里面有要横着滑才看得全的区域（演示的舞台、宽表格）
    for (const el of b.querySelectorAll('*')) {
      if (el.scrollWidth <= el.clientWidth + 2 || !visible(el)) continue;
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') { out.scrolls.push(`${label(b)} 里有一块要横着滑（${el.scrollWidth}/${el.clientWidth}px）`); break; }
    }
  }
  for (const svg of scope.querySelectorAll('svg')) {
    if (!visible(svg) || svg.closest('.katex')) continue;
    const texts = [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim() && visible(t) && getComputedStyle(t).opacity !== '0');
    const rects = texts.map((t) => t.getBoundingClientRect());
    const seen = new Set();
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = rects[i], c = rects[j];
        const w = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        if (w <= 0 || h <= 0) continue;
        const same = texts[i].textContent === texts[j].textContent && Math.abs(a.left - c.left) < 1.5 && Math.abs(a.top - c.top) < 1.5;
        if (same) continue;
        const small = Math.min(a.width * a.height, c.width * c.height);
        if (w * h < 0.25 * small) continue;
        const key = `${texts[i].textContent}|${texts[j].textContent}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.overlaps.push(`${label(svg)} 里「${texts[i].textContent.trim().slice(0, 16)}」和「${texts[j].textContent.trim().slice(0, 16)}」叠在一起`);
      }
    }
  }
  for (const el of scope.querySelectorAll('.is-overflow')) {
    if (!visible(el)) continue;
    const t = el.querySelector('.cb-page-title, .cb-board-title, h2, .bv-title')?.textContent?.trim() || '';
    out.unfit.push(`板${t ? `「${t.slice(0, 20)}」` : ''}一屏放不下`);
  }
  return out;
}

// 一个演示组件里 SVG 的字有没有叠（在页面里跑）：叠了的写成「甲」和「乙」
function measureOverlaps(el) {
  const res = [];
  for (const svg of el.querySelectorAll('svg')) {
    const texts = [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim() && t.getBoundingClientRect().width > 0);
    const rects = texts.map((t) => t.getBoundingClientRect());
    for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
      const p = rects[a], q = rects[b];
      const ww = Math.min(p.right, q.right) - Math.max(p.left, q.left), hh = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      if (ww <= 0 || hh <= 0) continue;
      if (texts[a].textContent === texts[b].textContent && Math.abs(p.left - q.left) < 1.5 && Math.abs(p.top - q.top) < 1.5) continue;
      if (ww * hh < 0.25 * Math.min(p.width * p.height, q.width * q.height)) continue;
      res.push(`「${texts[a].textContent.trim().slice(0, 12)}」和「${texts[b].textContent.trim().slice(0, 12)}」`);
    }
  }
  return res;
}

// 在页面里跑：每个有 step 这个变量的图（演示组件），figure set step 连着跳两次；返回出错的说法
function checkFigureSteps() {
  const out = [];
  for (const [id, sc] of window.LAKit?.session?.scenes || []) {
    const api = sc.api;
    if (!api?.set || !api.vars || !('step' in (api.vars() || {}))) continue;
    const name = sc.el?.closest?.('[data-bid]')?.dataset.bid || id;
    const last = Number(sc.el?.querySelector?.('.sv-scrub')?.max ?? 0);
    try {
      api.set('step', last);
      api.set('step', 0);
      if (api.vars().step !== 0) out.push(`课堂的 figure set step（${name}）：跳回 0 以后 step 是 ${api.vars().step}`);
    } catch (e) { out.push(`课堂的 figure set step（${name}）出错：${e.message}`); }
  }
  return out;
}

// 演示组件一步步走到底：碰到「先猜」就点「想不出来」，每走一步看一次图里的字有没有叠
async function walkSteppers(page) {
  const n = await page.locator('.sv-widget').count();
  const overlaps = [];
  for (let i = 0; i < n; i++) {
    const w = page.locator('.sv-widget').nth(i);
    if (!(await w.isVisible())) continue;
    for (let k = 0; k < 400; k++) {
      const ask = w.locator('.sv-ask');
      if (await ask.isVisible()) {
        const g = ask.locator('.sv-giveup');
        if (await g.isVisible()) { try { await g.click({ timeout: 3000 }); } catch { break; } continue; }
      }
      const next = w.locator('.sv-next');
      if (!(await next.isVisible()) || !(await next.isEnabled())) break;
      // 课堂里翻板、quiz 收起过程时按钮会在点之前藏起来：点不到就不走了（不算页面的错）
      try { await next.click({ timeout: 3000 }); } catch { break; }
      // 先量一次；量到叠着的，等这一步的滑动（morph 的 Web Animations，几百毫秒）走完再量：滑到一半时字会暂时叠着，不是真问题。
      // 颜色闪烁（CSS 动画、过渡）不挪位置，不等
      let o = await w.evaluate(measureOverlaps);
      if (o.length) {
        await w.evaluate((el) => {
          const moving = el.getAnimations({ subtree: true }).filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition) && a.effect?.getComputedTiming?.().iterations !== Infinity);
          return Promise.race([Promise.all(moving.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1000))]);
        });
        o = await w.evaluate(measureOverlaps);
      }
      const name = await w.evaluate((el) => [...(el.closest('.block')?.classList || [])].find((c) => c.startsWith('block-'))?.slice(6) || 'stepper');
      for (const x of o) overlaps.push(`${name} 第 ${k + 1} 步：${x} 叠在一起`);
    }
  }
  return [...new Set(overlaps)];
}

function newResult(file, size, theme, kind) {
  return { file, kind, size: `${size[0]}×${size[1]}`, theme: theme || '默认', problems: [], errors: [], overflow: 0, spills: [], scrolls: [], overlaps: [], unfit: [], notes: [] };
}

function merge(res, got, where = '') {
  const pre = where ? `${where}：` : '';
  for (const p of got.problems) if (!res.problems.some((q) => q.msg === p.msg && q.kind === p.kind)) res.problems.push(p);
  res.overflow = Math.max(res.overflow, got.overflow);
  // 同一个问题走完以后还在的，不再记一遍
  for (const k of ['spills', 'scrolls', 'overlaps', 'unfit']) for (const x of got[k]) { const v = pre + x; if (!res[k].includes(v) && !res[k].includes(x)) res[k].push(v); }
}

function hook(page, res) {
  page.on('pageerror', (e) => res.errors.push(`脚本报错：${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().split('\n')[0]; // 只留第一行，调用栈没用
    if (/fonts\.googleapis|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(t)) return; // 离线拿不到 Google 字体
    res.errors.push(`控制台：${t}`);
  });
}

async function checkStatic(browser, file, opt, dir) {
  const results = [];
  const src = readFileSync(file, 'utf8');
  const isHtml = /\.html?$/i.test(file);
  const themes = opt.themes === 'all' ? THEMES : [''];
  for (const theme of themes) {
    const html = isHtml ? htmlWithTheme(src, theme) : pageHtml(withTheme(src, theme), basename(file));
    const name = `${basename(file).replace(/\W+/g, '-')}-${theme || 'default'}.html`;
    writeFileSync(join(dir, name), html);
    for (const size of SIZES[opt.sizes]) {
      const res = newResult(file, size, theme, isHtml ? 'page' : 'lesson');
      const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      hook(page, res);
      await page.goto(pathToFileURL(join(dir, name)).href);
      await page.waitForTimeout(900);
      // guided 课件：后面几节先藏着，检查时全部打开
      await page.evaluate(() => { document.querySelectorAll('.stage[hidden]').forEach((s) => { s.hidden = false; }); window.dispatchEvent(new Event('resize')); });
      await page.waitForTimeout(300);
      merge(res, await page.evaluate(inspectInPage));
      if (opt.shots) await page.screenshot({ path: join(opt.shots, `${basename(file)}-${theme || 'default'}-${size[0]}.png`), fullPage: true });
      if (opt.walk) {
        for (const x of await walkSteppers(page)) if (!res.overlaps.includes(x)) res.overlaps.push(x);
        merge(res, await page.evaluate(inspectInPage), '走完以后');
      }
      // 课堂里老师用的 figure set step：每个演示组件连着跳两次（跳到最后、再跳回开头），出错就是「错」（以前第二次会丢了 step）
      for (const x of await page.evaluate(checkFigureSteps)) res.errors.push(x);
      results.push(res);
      await ctx.close();
    }
  }
  return results;
}

// 实时黑板：段先写进开发用的替身数据库（localStorage），页面按板号分板；每块板翻过去看一遍
async function checkBoard(browser, file, opt, dir) {
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const unit = spec.unit || basename(file);
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  const db = {};
  steps.forEach((s, i) => {
    const id = String(s.id || `s${i + 1}`);
    const { id: _, ...rest } = s;
    db[`steps/${id}`] = { seq: i + 1, ...rest };
  });
  const results = [];
  const themes = opt.themes === 'all' ? THEMES : [spec.theme || ''];
  for (const theme of themes) {
    const name = `${basename(file).replace(/\W+/g, '-')}-${theme || 'default'}.html`;
    writeFileSync(join(dir, name), pageHtml(frontOf(unit, spec.subject, 'live', theme), unit));
    for (const size of SIZES[opt.sizes]) {
      const res = newResult(file, size, theme, 'live');
      const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
      await ctx.addInitScript(([key, data]) => { try { localStorage.clear(); localStorage.setItem(key, data); } catch { /* */ } }, [`la-devdb:${unit}`, JSON.stringify(db)]);
      const page = await ctx.newPage();
      hook(page, res);
      await page.goto(pathToFileURL(join(dir, name)).href + '?dev');
      await page.waitForTimeout(1500);
      // 翻到第一块板，再一块块往后
      for (let k = 0; k < 60; k++) {
        const prev = page.locator('.cb-prev');
        if (!(await prev.isVisible()) || !(await prev.isEnabled())) break;
        await prev.click();
        await page.waitForTimeout(150);
      }
      for (let k = 0; k < 60; k++) {
        const n = (await page.locator('.cb-nav-n').first().textContent().catch(() => '')) || String(k + 1);
        await page.waitForTimeout(250);
        merge(res, await page.evaluate(inspectInPage), `第 ${n.trim()} 块板`);
        if (opt.shots) await page.screenshot({ path: join(opt.shots, `${basename(file)}-${theme || 'default'}-${size[0]}-b${n.trim()}.png`) });
        if (opt.walk) for (const x of await walkSteppers(page)) { const v = `第 ${n.trim()} 块板：${x}`; if (!res.overlaps.includes(v)) res.overlaps.push(v); }
        const next = page.locator('.cb-next');
        if (!(await next.isVisible()) || !(await next.isEnabled())) break;
        await next.click();
      }
      // 页面写回的写法错误（lint/段 id）
      const back = await page.evaluate((key) => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }, `la-devdb:${unit}`);
      for (const [k, v] of Object.entries(back)) {
        if (!k.startsWith('lint/') || !v || v.ok !== false && !(v.problems || []).length) continue;
        for (const p of v.problems || []) if (!res.problems.some((q) => q.msg === p.msg)) res.problems.push({ kind: p.kind, msg: `${v.step || k.slice(5)}：${p.msg}`, soft: !!p.soft });
      }
      results.push(res);
      await ctx.close();
    }
  }
  return results;
}

// 课堂：模拟老师按剧本原样回放（window.LAKitDevScript），学生的话照写的发；每一轮之后看一遍当前板
async function checkClass(browser, file, opt, dir) {
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const unit = spec.unit || basename(file);
  const turns = Array.isArray(spec.turns) ? spec.turns : [];
  const db = {};
  if (spec.pack?.main) db['pack/main'] = spec.pack.main;
  if (spec.pack?.problems) db['pack/problems'] = spec.pack.problems;
  const results = [];
  const themes = opt.themes === 'all' ? THEMES : [spec.theme || ''];
  for (const theme of themes) {
    const name = `${basename(file).replace(/\W+/g, '-')}-${theme || 'default'}.html`;
    writeFileSync(join(dir, name), pageHtml(frontOf(unit, spec.subject, 'class', theme), unit));
    for (const size of SIZES[opt.sizes]) {
      const res = newResult(file, size, theme, 'class');
      const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
      await ctx.addInitScript(([key, data, script]) => {
        try { localStorage.clear(); localStorage.setItem(key, data); } catch { /* */ }
        window.LAKitDevScript = script;
      }, [`la-devdb:${unit}`, JSON.stringify(db), turns.map((t) => String(t.teacher ?? ''))]);
      const page = await ctx.newPage();
      hook(page, res);
      await page.goto(pathToFileURL(join(dir, name)).href + '?dev');
      const start = page.locator('.class-start');
      await start.waitFor({ state: 'visible', timeout: 15000 });
      const settle = async (want) => {
        // 等模拟老师交完第 want 段，再等页面安静下来（自检、重写请求都处理完）
        for (let t = 0; t < 200; t++) {
          const got = await page.evaluate(() => (window.LAKitEval?.teacher?.calls || []).filter((c) => c.kind === 'script' || c.kind === 'script-end').length);
          if (got >= want) break;
          await page.waitForTimeout(100);
        }
        let last = -1;
        for (let t = 0; t < 40; t++) {
          const n = await page.evaluate(() => (window.LAKitEval?.teacher?.calls || []).length);
          if (n === last) break;
          last = n;
          await page.waitForTimeout(700);
        }
        await page.waitForTimeout(400);
      };
      await start.click();
      for (let i = 0; i < turns.length; i++) {
        if (i > 0) {
          const box = page.locator('.cb-field textarea');
          await box.fill(String(turns[i].student || '继续。'));
          await page.locator('.cb-send').click();
        }
        await settle(i + 1);
        merge(res, await page.evaluate(inspectInPage), `第 ${i + 1} 轮`);
        if (opt.shots) await page.screenshot({ path: join(opt.shots, `${basename(file)}-${theme || 'default'}-${size[0]}-t${i + 1}.png`) });
        if (opt.walk) for (const x of await walkSteppers(page)) { const v = `第 ${i + 1} 轮：${x}`; if (!res.overlaps.includes(v)) res.overlaps.push(v); }
      }
      // 页面要求重写的（写法错误）、作废的：都在模拟老师收到的 [系统] 消息里
      const log = await page.evaluate(() => window.LAKitEval?.teacher?.log || []);
      for (const t of log) {
        if (/写法错误|没有显示|看不懂/.test(t)) res.problems.push({ kind: 'class', msg: t.replace(/^\[系统\]\s*/, '').slice(0, 600), soft: false });
        else res.notes.push(t.slice(0, 300));
      }
      results.push(res);
      await ctx.close();
    }
  }
  return results;
}

export function verdict(r) {
  const hard = r.problems.filter((p) => !p.soft);
  const bad = hard.length + r.errors.length + (r.overflow ? 1 : 0) + r.spills.length;
  const warn = r.problems.length - hard.length + r.overlaps.length + r.unfit.length + r.scrolls.length;
  return { bad, warn };
}

function report(results, quiet) {
  const lines = [];
  for (const r of results) {
    const { bad, warn } = verdict(r);
    if (quiet && !bad && !warn) continue;
    lines.push(`${bad ? '✗' : warn ? '△' : '✓'} ${r.file}  ${r.size}  ${r.theme}${bad ? `  错 ${bad}` : ''}${warn ? `  注意 ${warn}` : ''}`);
    for (const p of r.problems) lines.push(`    ${p.soft ? '提醒' : '写法'}：${p.kind}：${p.msg.replace(/\n/g, '\n      ')}`);
    for (const e of r.errors) lines.push(`    ${e}`);
    if (r.overflow) lines.push(`    整页横向溢出 ${r.overflow}px`);
    for (const x of r.spills) lines.push(`    冲出版面：${x}`);
    for (const x of r.unfit) lines.push(`    放不下：${x}`);
    for (const x of r.overlaps) lines.push(`    字叠在一起：${x}`);
    for (const x of r.scrolls) lines.push(`    要横着滑：${x}`);
    for (const x of r.notes) lines.push(`    （${x}）`);
  }
  return lines.join('\n');
}

export async function checkFiles(files, opt = {}) {
  opt = { sizes: 'ipad', themes: 'default', shots: '', walk: true, ...opt };
  const kit = opt.kit ? resolve(opt.kit) : KIT;
  if (!existsSync(kit)) throw new Error(`没有 ${kit}：先 npm run build`);
  const dir = mkdtempSync(join(tmpdir(), 'la-check-'));
  copyFileSync(kit, join(dir, 'la-kit.js'));
  if (opt.shots) mkdirSync(opt.shots, { recursive: true });
  const browser = await chromium.launch();
  const all = [];
  try {
    for (const f of files) {
      const file = resolve(f);
      try {
        if (/\.board\.json$/i.test(file)) all.push(...await checkBoard(browser, file, opt, dir));
        else if (/\.class\.json$/i.test(file)) all.push(...await checkClass(browser, file, opt, dir));
        else all.push(...await checkStatic(browser, file, opt, dir));
      } catch (e) {
        const r = newResult(file, [0, 0], '', 'error');
        r.errors.push(`检查脚本没跑完：${e.message}`);
        all.push(r);
      }
    }
  } finally {
    await browser.close();
  }
  for (const r of all) {
    r.file = r.file.startsWith(ROOT) ? r.file.slice(ROOT.length + 1) : r.file;
    // 组件写错时页面也会在控制台打一遍同样的话：已经记成写法错误的不再算一次脚本报错
    r.errors = [...new Set(r.errors)].filter((e) => !r.problems.some((p) => e.includes(p.msg.split('\n')[0].replace(/^[^：]*：/, ''))));
  }
  return all;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.files.length) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 23).map((l) => l.slice(3)).join('\n'));
    process.exit(2);
  }
  const results = await checkFiles(opt.files, opt);
  console.log(report(results, opt.quiet));
  const sum = results.reduce((a, r) => { const v = verdict(r); a.bad += v.bad ? 1 : 0; a.warn += !v.bad && v.warn ? 1 : 0; return a; }, { bad: 0, warn: 0 });
  console.log(`\n共 ${results.length} 次（文件 × 尺寸 × 风格）：${sum.bad} 次有错，${sum.warn} 次只有「注意」。`);
  if (opt.out) writeFileSync(opt.out, JSON.stringify(results, null, 2));
  process.exit(sum.bad ? 1 : 0);
}
