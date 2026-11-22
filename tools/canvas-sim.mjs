// 版面的验证：一个子代理扮课堂里的 Claude 自己排板，这个脚本当「页面」。
// 每一次 run 用真的 la-kit.js（课堂模式、?canvas）把已经写好的几轮按顺序放一遍，iPad 横屏截图，
// 再把下一句学生的话发出去，取下页面这一轮真要发给课堂 Claude 的内容（第一轮是整份说明，之后是黑板现状 + 学生的话）。
//
//   node tools/canvas-sim.mjs run <目录>
//
// 目录里：scenario.json（{ unit, subject, pack: { main, problems } }）；s-1.txt 是开课（不写就是点「开始上课」），
// t-1.md、t-2.md…… 是老师每一轮的输出，s-2.txt、s-3.txt…… 是老师那一轮之后学生说的话。
// 写出：shot-k.png（第 k 轮之后的一屏）、shot-k-full.png（整页）、to-teacher-(k+1).md（下一轮发给老师的）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(require('node:child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const [cmd, dirArg] = process.argv.slice(2);
if (cmd !== 'run' || !dirArg) { console.log('用法：node tools/canvas-sim.mjs run <目录>'); process.exit(1); }
const dir = path.resolve(dirArg);
const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../kit/dist/la-kit.js');
const sc = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
const unit = sc.unit || '版面验证';
const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null);
const turns = [];
for (let k = 1; read(`t-${k}.md`) !== null; k++) turns.push(read(`t-${k}.md`));
const k = turns.length;

// 页面放在目录下的 site/ 里（file:// 打开）
const site = path.join(dir, 'site');
fs.mkdirSync(site, { recursive: true });
fs.copyFileSync(KIT, path.join(site, 'la-kit.js'));
fs.writeFileSync(path.join(site, 'class.html'), `<!doctype html>\n<meta charset="utf-8">\n<title>${unit}</title>\n<script src="la-kit.js"></script>\n<script type="text/markdown">\n---\nmode: class\nunit: ${unit}\nsubject: ${sc.subject || '线代'}\n---\n</script>\n`);
const db = {};
if (sc.pack?.main) db['pack/main'] = sc.pack.main;
if (sc.pack?.problems) db['pack/problems'] = sc.pack.problems;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
await ctx.addInitScript(([key, data, script]) => {
  try { localStorage.clear(); localStorage.setItem(key, data); } catch { /* */ }
  window.LAKitDevScript = script;
  window.LAKitDevScriptWait = true;
  window.confirm = () => false;
}, [`la-devdb:${unit}`, JSON.stringify(db), turns]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(site, 'class.html')).href + '?dev&canvas');
await page.locator('.class-start').waitFor({ state: 'visible', timeout: 15000 });

// 只数按剧本交的轮（页面要求重写时模拟老师回一句「不改写」，不算）
const calls = () => page.evaluate(() => (window.LAKitEval?.teacher?.calls || []).filter((c) => c.kind === 'script' || c.kind === 'script-end').length);
const logNow = () => page.evaluate(() => (window.LAKitEval?.teacher?.log || []).slice());
const settle = async (want) => {
  for (let t = 0; t < 300 && (await calls()) < want; t++) await page.waitForTimeout(100);
  let last = -1;
  for (let t = 0; t < 40; t++) { const n = await calls(); if (n === last) break; last = n; await page.waitForTimeout(600); }
  await page.waitForTimeout(500);
};
const say = async (text) => {
  await page.locator('.cb-field textarea').fill(text);
  await page.locator('.cb-send').click();
};
// 页面发给老师的：第一次是整份；之后只要「黑板现状」那一节和最后几条 user 消息（老师子代理记得前面的说明）
const lastInput = () => page.evaluate(() => {
  const c = (window.LAKitEval?.teacher?.calls || []).filter((x) => x.kind === 'script' || x.kind === 'script-end').at(-1);
  return c ? c.input : null;
});

// 学生一步一步来：s-1、s-2……（.txt 是说的话；.json 是 { "answers": { "组件 id": ["格子 1", "格子 2"] | "选项的字" }, "steps": { "组件 id": ["每一步写的想法"] }, "say": "…" }）。
// 每一步之后等页面安静：调用了老师，模拟老师就交下一段 t-…；预案接住了就不调用
const steps = [];
for (let i = 1; ; i++) {
  const j = read(`s-${i}.json`);
  const t = read(`s-${i}.txt`);
  if (j === null && t === null) break;
  steps.push(j !== null ? JSON.parse(j) : { say: t.trim() });
}
const settleAll = async () => {
  let last = -1;
  for (let t = 0; t < 60; t++) { const n = await calls(); if (n === last && t > 3) break; last = n; await page.waitForTimeout(500); }
  await page.waitForTimeout(600);
};
const answer = async (bid, v) => {
  const blk = page.locator(`.block[data-bid="${bid}"]`).first();
  if (Array.isArray(v)) {
    const ins = blk.locator('input');
    for (let i = 0; i < v.length; i++) await ins.nth(i).fill(String(v[i]));
    await blk.locator('.ans-check').first().click();
  } else {
    await blk.locator('button, label', { hasText: String(v) }).first().click();
    const chk = blk.locator('.ans-check, .qz-check');
    if (await chk.count()) await chk.first().click().catch(() => {});
  }
  await page.waitForTimeout(400);
};
let logBefore = 0;
for (let i = 0; i < steps.length; i++) {
  const st = steps[i];
  if (i === steps.length - 1) logBefore = (await logNow()).length;
  if (i === 0 && !st.say && !st.answers) await page.locator('.class-start').click();
  for (const [bid, v] of Object.entries(st.answers || {})) await answer(bid, v);
  // steps：每一步先写想法、点「写好了」、再揭开（{ "steps": { "ex-1": ["想法 1", "想法 2"] } }）
  for (const [bid, list] of Object.entries(st.steps || {})) {
    const blk = page.locator(`.block[data-bid="${bid}"]`).first();
    for (const idea of list) {
      const item = blk.locator('.st-item:not([hidden])').last();
      await item.locator('textarea').first().fill(String(idea)).catch(() => {});
      await item.locator('.st-submit').first().click().catch(() => {});
      await page.waitForTimeout(300);
      await item.locator('.st-reveal').first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  if (st.say) await say(st.say);
  await settleAll();
}
const n = await calls();
const lintAfter = (await logNow()).slice(logBefore);
const tag = `s${steps.length}`;
// 截和 iPad 一样大的屏：先回到最上面截一张，板比一屏长就往下滚一屏（扣掉底部的条）再截，直到底（不截整页长图：
// 固定在底部的输入条会被画到长图中间，看着和真的不一样）
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(dir, `shot-${tag}.png`) });
for (let i = 2; i <= 4; i++) {
  const more = await page.evaluate(() => {
    const se = document.scrollingElement;
    const bar = document.querySelector('.class-bar')?.getBoundingClientRect().height || 120;
    if (se.scrollTop + innerHeight >= se.scrollHeight - 4) return false;
    window.scrollBy(0, innerHeight - bar - 60);
    return true;
  });
  if (!more) break;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, `shot-${tag}-${i}.png`) });
}
// 最后一步调用了老师、而 t-n 还没写：把这一次页面发给老师的写出来
if (n > k) {
  const input = await lastInput();
  const text = (m) => (typeof m?.content === 'string' ? m.content : (m?.content || []).map((p) => p.text || '').join(''));
  let out;
  if (n === 1) out = input.map((m) => `【${m.role}】\n${text(m)}`).join('\n\n');
  else {
    const sys = text(input[0]);
    const state = sys.slice(sys.lastIndexOf('黑板现状'));
    let j = input.length - 1;
    while (j > 0 && input[j - 1].role !== 'assistant') j--;
    const msgs = input.slice(j).map(text).filter((t) => !lintAfter.includes(t));
    out = `【页面这一轮发给你的】\n\n# ${state}\n\n# 这一轮的消息\n\n${[...lintAfter, ...msgs].join('\n\n')}`;
  }
  fs.writeFileSync(path.join(dir, `to-teacher-${n}.md`), out);
  console.log(`这一步调用了老师：写了 to-teacher-${n}.md（${Buffer.byteLength(out)} 字节），等 t-${n}.md`);
} else console.log(`这一步没调用老师（预案接住了，或者只是在看）`);
console.log(`截图 shot-${tag}.png；老师一共被调用 ${n} 次`);
const log = await page.evaluate(() => window.LAKitEval?.teacher?.log || []);
if (log.length) console.log(`页面发的系统消息：\n${log.join('\n')}`);
if (errors.length) console.log(`控制台报错：\n${errors.join('\n')}`);
await browser.close();
