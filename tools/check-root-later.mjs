// 真实首页、真实练习和写入重试；用替身数据库，不调用模型。
// pnpm run build && node tools/check-root-later.mjs [截图目录]
import { chromium } from './playwright.mjs';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const server = createServer((q, r) => {
  const js = q.url.startsWith('/la-kit.js');
  r.setHeader('content-type', js ? 'application/javascript' : 'text/html');
  r.end(readFileSync(join(root, js ? 'kit/dist/la-kit.js' : 'kit/examples/desk-demo.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, ...(process.env.HOLDS_BROWSER ? { executablePath: process.env.HOLDS_BROWSER } : {}) });
try {
  for (const viewport of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    const context = await browser.newContext({ viewport, timezoneId: 'UTC', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-11-16T12:00:00Z') });
    await page.goto(`http://127.0.0.1:${server.address().port}/desk.html?dev`);
    await page.waitForSelector('.dk-rows');
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('la-devdb:'));
      const at = Date.now();
      const source = { kind: 'class', title: '排序的课后验', space: 'cs', block: 'DS-L1.1.1', status: 'closed', date: '2026-11-16', startedAt: at - 60000, endedAt: at, aims: [{ id: 'a1', can: '辨认稳定排序' }], holds: { ids: ['d-hold-one', 'd-hold-two'], at, made: 2, exam: 0 } };
      const all = { 'sessions/c-20261116-1': source };
      for (let i = 1; i <= 2; i++) all[`drills/d-hold-${i === 1 ? 'one' : 'two'}`] = { src: 'hold', hold: 'c-20261116-1', far: i === 2, block: source.block, space: 'cs', status: 'active', md: `\`\`\`quiz\nid: d-hold-${i === 1 ? 'one' : 'two'}\nq: 模拟题 ${i}：写出 ${i}+${i} 的结果\nanswer: ${i * 2}\n\`\`\`` };
      localStorage.setItem(key, JSON.stringify(all));
    });
    await page.reload();
    await page.waitForSelector('.dk-rows');
    assert.equal(await page.locator('[data-row="later"]').count(), 0);
    await page.clock.setFixedTime(new Date('2026-11-17T12:00:00Z'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForSelector('[data-row="later"]');
    const row = page.locator('[data-row="later"]');
    assert.match(await row.innerText(), /排序的课后验/);
    assert.ok((await row.boundingBox()).height >= 44);
    await page.waitForTimeout(800);
    if (shots) await page.screenshot({ path: join(shots, `${viewport.width}-首页.png`), fullPage: true, animations: 'disabled' });
    await row.click();
    await page.locator('.dk-later-go').click();
    await page.waitForSelector('.dr-host .q-input');
    await page.locator('.dr-host .q-input').fill('2');
    await page.locator('.dr-host .q-check').click();
    await page.locator('.dr-next').click();
    await page.locator('.dr-host .q-input').fill('4');
    await page.locator('.dr-host .q-check').click();
    await page.evaluate(() => LAKitDev.failWrites(1, 'sessions'));
    await page.locator('.dr-next').click();
    await page.waitForSelector('.dr-done .dr-back');
    await page.locator('.dr-done .dr-back').click();
    await page.waitForSelector('.dk-rows');
    assert.equal(await page.locator('[data-row="later"]').count(), 0);
    const result = await page.evaluate(() => {
      const all = JSON.parse(localStorage[Object.keys(localStorage).find(k => k.startsWith('la-devdb:'))]);
      return all['sessions/c-20261116-1'].later;
    });
    assert.equal(result.n, 2); assert.equal(result.right, 2); assert.equal(result.days, 1);
    assert.deepEqual(result.far, { n: 1, right: 1 });
    await page.locator('.dk-spaces[aria-label="科目"] [data-space="cs"]').click();
    await page.evaluate(() => { location.hash = '#classes/c-20261116-1'; });
    await page.waitForSelector('.dk-later-result');
    assert.match(await page.locator('.dk-later-result').innerText(), /隔 1 天做没见过的题：2 道对 2 道/);
    if (shots) await page.screenshot({ path: join(shots, `${viewport.width}-结果.png`), fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log(`通过 ${viewport.width}×${viewport.height}：跨日出现、做完消失、原课回写、失败重试和历史结果`);
    await context.close();
  }
} finally { await browser.close(); server.close(); }
