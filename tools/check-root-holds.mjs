// 留题真正走一遍：首页调度、藏着渲染验题、写库、刷新不重出、练习首次新题。
// 不调用真实模型、不写真实学习台；用法：node tools/check-root-holds.mjs。
import { build } from 'esbuild';
import { chromium } from './playwright.mjs';
import { componentDocs } from '../kit/build-docs.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'holds-check-'));
const bundle = join(out, 'check.js');
await build({ stdin: { contents: `export * from './kit/src/memory/holds.js'; export * from './kit/src/memory/labdesk.js'; export * from './kit/src/memory/drillrun.js'; export * from './kit/src/books/devmock.js'; export { renderDesk } from './kit/src/memory/desk.js'; export { getStore } from './kit/src/live/store.js'; export { session } from './kit/src/session.js'; export { REPORT_VERSION } from './kit/src/memory/report.js';`, resolveDir: resolve('.') }, bundle: true, format: 'iife', globalName: 'H', outfile: bundle, loader: { '.css': 'text' }, plugins: [{ name: 'docs', setup(b) { b.onResolve({ filter: /^virtual:component-docs$/ }, () => ({ path: 'docs', namespace: 'docs' })); b.onLoad({ filter: /.*/, namespace: 'docs' }, () => ({ contents: componentDocs(readFileSync('CLAUDE-PROJECT.md', 'utf8')), loader: 'text' })); } }] });
const server = createServer((q, r) => { r.setHeader('content-type', q.url.startsWith('/check.js') ? 'application/javascript' : 'text/html'); r.end(q.url.startsWith('/check.js') ? readFileSync(bundle) : '<!doctype html><meta charset="utf-8"><main id="host"></main><script src="/check.js"></script>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.HOLDS_BROWSER ? { executablePath: process.env.HOLDS_BROWSER } : {}) });
  for (const mode of ['生成', '真题', '失败', '错模型']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('页面', m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?dev`);
    await page.evaluate(async mode => {
      const sid = 'c-20261116-1', at = Date.now();
      H.session.title = `留题测试-${mode}`;
      const { db } = await H.getStore({ title: H.session.title });
      window.testDb = db;
      const s = { kind: 'class', status: 'closed', block: 'DS-L1.1.1', space: 'cs', date: '2026-11-16', startedAt: at - 10000, endedAt: at, aims: [{ id: 'a1', can: '手算一趟排序' }, { id: 'a2', can: '辨认稳定排序' }], report: { v: H.REPORT_VERSION, at }, skills: { v: 999, reportAt: at }, debrief: { at } };
      await db.doc(`sessions/${sid}/report/main`).set({ items: [], aims: s.aims, at, v: H.REPORT_VERSION });
      await db.doc(`sessions/${sid}`).set(s);
      if (mode === '真题') for (let i = 1; i <= 2; i++) await db.doc(`drills/d-q-${i}`).set({ block: s.block, src: 'exam', status: 'active', exam: `Q-408-2022-0${i}`, aim: `a${i}`, md: '```quiz\nq: 真题\nanswer: 1\n```' });
      if (mode === '失败' || mode === '错模型') {
        const sample = async prompt => { if (mode === '失败') throw new Error('模拟出题失败'); return { ...await H.createDevAI().call(prompt), modelApplied: '别的模型' }; };
        sample.limits = async () => ({});
        window.claude = { use: async name => name === 'sample' ? sample : null };
      }
      await H.renderDesk(document.querySelector('#host'), {});
    }, mode);
    const deadline = Date.now() + 15000;
    for (;;) {
      const ready = await page.evaluate(async mode => { const s = JSON.parse(localStorage.getItem(`la-devdb:留题测试-${mode}`))['sessions/c-20261116-1']; return ['失败', '错模型'].includes(mode) ? s?.holdTries : s?.holds?.ids?.length; }, mode);
      if (ready) break;
      if (Date.now() > deadline) { console.log(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith("la-devdb:")).map(k => [k, JSON.parse(localStorage[k])])))); throw new Error(`等不到留题：${mode}`); }
      await new Promise(r => setTimeout(r, 200));
    }
    if (['失败', '错模型'].includes(mode)) await page.waitForTimeout(1000);
    const result = await page.evaluate(mode => { const all = JSON.parse(localStorage.getItem(`la-devdb:留题测试-${mode}`)); return { session: all['sessions/c-20261116-1'], drills: Object.entries(all).filter(([p]) => p.startsWith('drills/')).map(([p,d]) => ({ id:p.split('/')[1], ...d })) }; }, mode);
    assert.deepEqual(errors, []);
    if (['失败', '错模型'].includes(mode)) { assert.equal(result.session.holds, undefined); assert.equal(result.session.holdTries, 1); }
    else {
      assert.equal(result.session.holds.ids.length, 2);
      assert.equal(result.session.holds[mode === '生成' ? 'made' : 'exam'], 2);
      if (mode === '生成') assert.deepEqual(result.drills.filter(d => d.src === 'hold').map(d => d.far), [false, true]);
      await page.reload();
      await page.evaluate(async mode => { H.session.title = `留题测试-${mode}`; window.testDb = (await H.getStore({ title: H.session.title })).db; await H.renderDesk(document.querySelector('#host'), {}); }, mode);
      await page.waitForTimeout(1000);
      assert.equal(await page.evaluate(async () => (await testDb.doc('sessions/c-20261116-1').get()).data().holdTries), result.session.holdTries);
      const check = await page.evaluate(async () => {
        const oldVars = H.session.vars;
        const bad = await H.renderCheck('```quiz\nid: bad\n```');
        const id = 'd-hold-c-20261116-1-1';
        const run = () => H.closeDrill(testDb, '练习二', { doc: { status: 'closed' }, drills: [{ id, src: 'hold' }], curriculum: [], readOnly: true });
        const first = (await run()).res.rows[0].fresh;
        await testDb.doc('evidence/old').set({ session: '练习一', comp: id });
        const again = (await run()).res.rows[0].fresh;
        return { bad: bad.length, restored: H.session.vars === oldVars, first, again };
      });
      assert.ok(check.bad); assert.ok(check.restored); assert.equal(check.first, true); assert.equal(check.again, false);
    }
    console.log(`通过：${mode}，holds=${JSON.stringify(result.session.holds || null)}`);
    await page.close();
  }
} finally {
  await browser?.close(); server.close(); rmSync(out, { recursive: true, force: true });
}
