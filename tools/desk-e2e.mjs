// 学习台整条流程的自动测试：在真的浏览器里把学习台从头用一遍，哪一步不对就报出来（退出码 1）。
// 单元测试只管纯函数；这里管跨好几步的流程——点了保存以后、网络写失败一次、连点两下、过了午夜、下课以后报告写没写。
// 2026-11-04 全面排查时查出来的二十来处问题，大半是这类流程上的，这个脚本守着它们不再回来。
//
// 用法：
//   npm run build && node tools/desk-e2e.mjs            # 全部跑一遍
//   node tools/desk-e2e.mjs --only recall,class        # 只跑几段（段名见下面 SUITES）
//   node tools/desk-e2e.mjs --shots 目录                # 每一段结束存一张截图（失败的那一步一定存）
//   node tools/desk-e2e.mjs --headed                    # 开着窗口看（本地）
//
// 用的是 ?dev 的本地替身数据库（localStorage），不碰真的学习台；替身能注入故障（kit/src/live/store.js 的 window.LAKitDev）。
// 不调用 Claude：课堂里是模拟老师（devteacher.js），归类、复盘是 books/devmock.js。
import { chromium } from './playwright.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPaper } from '../kit/src/exam/ingest.js';
import { DEV_CHECK, DEV_CHECK_HEAD, DEV_CHECK_BODY, DEV_CHECK_408, DEV_CHECK_EN, DEV_CHECK_EN_HEAD, DEV_CHECK_EN_BODY } from '../kit/src/check/devsample.js';
import { parseCheck, traceTable } from '../kit/src/check/spec.js';
import { parseItemIds } from '../kit/src/check/judge.js';
import { measure, variantValues } from '../kit/src/engines/measures.js';
import { bankDocs } from '../kit/src/check/bank.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'kit/dist/la-kit.js');
const PAGE = join(ROOT, 'kit/examples/desk-demo.html');

const args = process.argv.slice(2);
const opt = { only: null, shots: '', headed: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--only') opt.only = new Set(args[++i].split(','));
  else if (args[i] === '--shots') opt.shots = resolve(args[++i]);
  else if (args[i] === '--headed') opt.headed = true;
}
if (!existsSync(KIT)) { console.error(`没有 ${KIT}：先 npm run build`); process.exit(2); }
if (opt.shots) mkdirSync(opt.shots, { recursive: true });

// —— 静态服务器：学习台和 la-kit.js、pdf/ 放在一个目录下（和发布的样子一样）——
const files = { '/desk.html': PAGE, '/la-kit.js': KIT };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer((q, r) => {
  const path = decodeURIComponent(q.url.split('?')[0]);
  const f = files[path] || (path.startsWith('/pdf/') ? join(ROOT, 'kit/dist', path) : null);
  if (!f || !existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((ok) => server.listen(0, ok));
const BASE = `http://127.0.0.1:${server.address().port}/desk.html?dev`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;

/** 一个浏览器页面加上收集页面报错、读替身数据库的小工具 */
async function openPage(browser, { clock = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`页面报错：${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`控制台：${m.text().slice(0, 300)}`); });
  // 和 claude.ai 的沙箱一样：系统弹框直接当「取消」
  await page.addInitScript(() => { window.confirm = () => false; window.alert = () => {}; window.prompt = () => null; });
  if (clock) await page.clock.install({ time: clock });
  const t = {
    page, ctx, errors,
    /** 替身数据库的全部内容：{ 'sessions/c-…': {...}, … } */
    async db() {
      return page.evaluate(() => {
        let best = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k.startsWith('la-devdb:')) continue;
          try { const v = JSON.parse(localStorage.getItem(k) || '{}'); if (Object.keys(v).length > Object.keys(best).length) best = v; } catch { /* */ }
        }
        return best;
      });
    },
    async docs(coll) { const all = await t.db(); return Object.entries(all).filter(([k]) => k.startsWith(`${coll}/`) && k.split('/').length === 2).map(([k, v]) => ({ id: k.split('/')[1], ...v })); },
    async text(sel) { return page.evaluate((s) => document.querySelector(s)?.innerText ?? null, sel); },
    async waitFor(fn, { timeout = 15000, every = 200, what = '条件' } = {}) {
      const t0 = Date.now();
      for (;;) {
        // 页面正在整页刷新（进课堂、换地址）：这一次读不到，等一下再读
        let v = null;
        try { v = await fn(); } catch (e) { if (!/context was destroyed|navigat|Target closed|detached/i.test(e.message)) throw e; }
        if (v) return v;
        if (Date.now() - t0 > timeout) throw new Error(`等了 ${timeout / 1000} 秒还没等到：${what}`);
        await sleep(every);
      }
    },
    /** 页面自己画的问一句（dialog.js）：点文字对得上的那个按钮 */
    async answer(label) {
      await page.waitForSelector('.la-dialog', { timeout: 5000 });
      await page.evaluate((l) => { const b = [...document.querySelectorAll('.la-dialog .btn')].find((x) => x.textContent.trim() === l || x.textContent.includes(l)); if (!b) throw new Error(`对话框里没有「${l}」`); b.click(); }, label);
      await sleep(300);
    },
    async home() { await page.evaluate(() => { location.hash = ''; }); await sleep(600); },
    /** 整页打开到某个地址（先离开，免得和页面自己的 location.reload 撞在一起） */
    async open(hash = '') { await page.goto('about:blank'); await page.goto(`${BASE}${hash ? `#${hash}` : ''}`); await page.waitForLoadState('load'); await sleep(800); },
    /** 整页换成带参数的首页（form=class 以前用来选课的形式，现在只有黑板；后面还能跟别的参数，比如 &examwait=1） */
    async openForm(f) {
      await page.goto('about:blank'); await page.goto(`${BASE}&form=${f}`); await page.waitForLoadState('load');
      await t.waitFor(async () => (await t.text('.dk-class'))?.includes('开新课'), { what: `带 form=${f} 的首页画好` });
      await sleep(500);
    },
    /** 点了开课的按钮以后：等进到课堂（页面自己改地址、整页刷新）、开课页画好 */
    async inClass(match = () => true) {
      await page.waitForURL((u) => /#c-\d{8}-\d+/.test(u.hash) && match(decodeURIComponent(u.hash.slice(1))), { timeout: 20000 });
      await page.waitForLoadState('load');
      await t.waitFor(() => page.evaluate(() => /开始上课|下一题|这次练习/.test(document.body?.innerText || '')), { timeout: 20000, what: '课堂（练习）画出来' });
      return decodeURIComponent(new URL(page.url()).hash.slice(1));
    },
    async route(h) { await page.evaluate((x) => { location.hash = x; }, h); await sleep(700); },
  };
  return t;
}

async function seeded(browser) {
  const t = await openPage(browser);
  await t.page.goto(BASE);
  await t.page.waitForSelector('.dk-seed', { timeout: 15000 });
  await t.page.click('.dk-seed');
  await t.waitFor(async () => (await t.page.$('.dk-trow')) && (await t.text('.dk-class'))?.includes('开新课'), { what: '填入示例记忆后首页画好' });
  await sleep(800);
  return t;
}

/** 往替身数据库里直接放几条（模拟对话里的 Claude、别的设备写的） */
async function plant(t, docs) {
  await t.page.evaluate((docs) => {
    const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:'));
    const all = JSON.parse(localStorage.getItem(k));
    Object.assign(all, docs);
    localStorage.setItem(k, JSON.stringify(all));
  }, docs);
}
// 计划 4：408、英语的检验样板（devsample.js；?dev 的暗号「测试:检验408」「测试:检验英语」写的就是这两条）放进一节外部的课，做完一遍
const ckCard = (t) => t.page.evaluate(() => { const c = document.querySelector('.ck-teach, .ck-done, .ck-probe'); return c ? (c.classList.contains('ck-teach') ? 'teach' : c.classList.contains('ck-done') ? 'done' : c.dataset.probe) : ''; });
const ckSure = (t) => t.page.click('.ck-sure-btn[data-sure="sure"]');
async function ckSubmit(t) { await sleep(500); await t.page.click('.ck-submit'); }
async function ckType(t, sel, text) { const tab = await t.page.$('.ck-card .ck-tab[data-tab="type"]'); if (tab) await tab.click(); await t.page.fill(sel, text); }
async function ckOpen(t, sid, today, block, space, text) {
  // 页面开着（上一段停在「以前的课」）：从另一页写，免得开着的那页拿手上的旧副本盖掉
  await plantLive(t, {
    [`sessions/${sid}`]: { date: today, kind: 'ext', status: 'open', block, title: `外部（检验 ${space}）`, space, startedAt: Date.now() },
    [`sessions/${sid}/ext_in/001`]: { seq: 1, text: `检验。\n\n${text}\n`, at: Date.now() },
  });
  await t.open(sid);
  await t.waitFor(() => t.page.$('.ck-start'), { timeout: 20000, what: '检验的开始卡' });
  await sleep(500);
  await t.page.click('.ck-start');
}
async function ckDone(t, sid, cid, block) {
  await t.waitFor(async () => (await ckCard(t)) === 'done', { timeout: 30000, what: `检验 ${cid} 做完了` });
  const key = `absorb/${block.replace(/#/g, '~')}`;
  const all = await t.waitFor(async () => { const d = await t.db(); return d[key] ? d : null; }, { timeout: 15000, what: `${key} 写进去了` });
  const evs = Object.values(all).filter((d) => d?.src === 'check' && d.session === sid && d.check === cid);
  const outs = await t.waitFor(async () => { const o = Object.entries(await t.db()).filter(([k]) => k.startsWith(`sessions/${sid}/ext_out/`)).map(([, v]) => v.text).join('\n'); return new RegExp(`检验 ${cid}.*做完了`).test(o) ? o : null; }, { timeout: 10000, what: `ext_out 写了检验 ${cid} 做完了` });
  return { all, evs, absorb: all[key], outs };
}
const ckState = async (t, sid, cid) => (await t.db())[`sessions/${sid}/check/${cid}`]?.state || null;
async function check408(t, today) {
  const sid = `c-${today.replace(/-/g, '')}-5`;
  await ckOpen(t, sid, today, 'DS-L8.2.3', 'cs', DEV_CHECK_408);
  await t.waitFor(async () => (await ckCard(t)) === 'p1', { timeout: 8000, what: '408：trace 那一道' });
  // 模板取的数在存着的进度里：照它算整张表（和页面同一个 traceTable）
  const st = await t.waitFor(async () => { const s = await ckState(t, sid, 'k408'); return s?.check?.probes?.p1 ? s : null; }, { timeout: 8000, what: '检验的进度存下来了' });
  const rows = traceTable(st.check.probes.p1).table.rows;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].cells.length; c++) {
    const cell = rows[r].cells[c];
    if (cell.given || cell.mark) continue;
    const v = [].concat(cell.v)[0];
    await t.page.fill(`.ck-card .sv-fill-in[data-r="${r}"][data-c="${c}"]`, v === '' ? '-' : String(v));
  }
  await ckSure(t); await ckSubmit(t);
  // construct：一排有序的数（排完稳定）→ 补讲；retry p2a 写两个 49 → 作答下面写「页面把第二个 49 记成 49′」，过了
  await t.waitFor(async () => (await ckCard(t)) === 'p2', { timeout: 8000, what: '408：construct 那一道' });
  const slots = async (a, p) => { const ins = await t.page.$$('.ck-card .ck-slot input'); await ins[0].fill(a); await ins[1].fill(p); };
  await slots('1 2 3 4 5 6 7 8', '1 1'); await ckSure(t); await ckSubmit(t);
  await t.waitFor(async () => (await ckCard(t)) === 'teach', { timeout: 8000, what: 'construct 错了出补讲' });
  check(/相同的数先后没变/.test(await t.text('.ck-teach')), 'construct 的补讲没写外部的那句');
  await sleep(500); await t.page.click('.ck-next');
  await t.waitFor(async () => (await ckCard(t)) === 'p2a', { timeout: 8000, what: 'construct 的 retry' });
  await slots('13 97 49 49 27 38', '49 49');
  check(/记成 49′/.test((await t.text('.ck-card .ck-note')) || ''), '一排数里有两个 49，作答下面没写「页面把第二个 49 记成 49′」');
  await ckSure(t); await ckSubmit(t);
  // predict：数组写成「相邻的分成一组」算出来的 → 页面认出错法（tag shellBlock），补讲照 teach tag=shellBlock
  await t.waitFor(async () => (await ckCard(t)) === 'p3', { timeout: 8000, what: '408：predict 那一道' });
  const pass1 = (p, key) => { const f = { algo: 'shell', gaps: '3', array: p.runs[0].fields.array }; return [].concat(key ? variantValues('sort', f, key).values.pass1 : measure('sort', f).values.pass1).join(' '); };
  const predict = async (x2, why) => { const ins = await t.page.$$('.ck-card .ck-in'); await ins[0].fill('2 5 8'); await ins[1].fill(x2); await ckType(t, '.ck-card .ck-text', why); };
  await predict(pass1((await ckState(t, sid, 'k408')).check.probes.p3, 'shellBlock'), '相隔 3 的是一组'); await ckSure(t); await ckSubmit(t);
  await t.waitFor(async () => (await ckCard(t)) === 'teach', { timeout: 8000, what: 'predict 写了错法的数组出补讲' });
  check(/不是连着的一段/.test(await t.text('.ck-teach')), `predict 认出错法以后补讲不是 tag=shellBlock 那一条：${(await t.text('.ck-teach')).slice(0, 200)}`);
  await sleep(500); await t.page.click('.ck-next');
  await t.waitFor(async () => (await ckCard(t)) === 'p3~2', { timeout: 8000, what: 'predict 的 retry（换一组数的同一道）' });
  await predict(pass1((await ckState(t, sid, 'k408')).check.probes['p3~2']), '相隔 3 的是一组：第 2、5、8 个'); await ckSure(t); await ckSubmit(t);
  // tradeoff：要点交页面里的 Claude（模拟的都对）
  await t.waitFor(async () => (await ckCard(t)) === 'p4', { timeout: 15000, what: '408：tradeoff 那一道' });
  await ckType(t, '.ck-card .ck-text', '大间隔先消掉离得远的逆序，最后一趟几乎不用挪；链表不能按下标隔 d 取元素'); await ckSure(t); await ckSubmit(t);
  const { evs, absorb } = await ckDone(t, sid, 'k408', 'DS-L8.2.3');
  check(['部分', '待核'].includes(absorb.state), `DS-L8.2.3 的吸收：${absorb.state}`);
  for (const id of ['p1', 'p2', 'p2a', 'p3', 'p3~2', 'p4']) check(evs.some((e) => e.probe === id), `408 的 ${id} 没写证据（src: check）`);
  const ev3 = evs.find((e) => e.probe === 'p3');
  check(ev3?.items?.find((x) => x.id === 'x2')?.tag === 'shellBlock', `predict 的证据没认出错法：${JSON.stringify(ev3?.items)}`);
  check(evs.find((e) => e.probe === 'p1')?.picked, 'trace 模板的证据没记取的数');
}
async function checkEn(t, today) {
  const sid = `c-${today.replace(/-/g, '')}-4`;
  const en = parseCheck(DEV_CHECK_EN_HEAD, DEV_CHECK_EN_BODY).check;
  await ckOpen(t, sid, today, 'EN-L1.2.3', 'en', DEV_CHECK_EN);
  // parse：先点头一个词、再点尾一个词、再点成分
  await t.waitFor(async () => (await ckCard(t)) === 'p1', { timeout: 8000, what: '英语：parse 那一道' });
  for (const { span } of parseItemIds(en.probes.p1)) {
    await t.page.click(`.ck-card .pz-w[data-i="${span.from}"]`);
    await t.page.click(`.ck-card .pz-w[data-i="${span.to}"]`);
    await t.page.click(`.ck-card .pz-role[data-role="${span.role}"]`);
  }
  await ckSure(t); await ckSubmit(t);
  await t.waitFor(async () => (await ckCard(t)) === 'p2', { timeout: 8000, what: '英语：rewrite 那一道' });
  await ckType(t, '.ck-card .ck-text', 'The bridge was built by the villagers in 1990.'); await ckSure(t); await ckSubmit(t);
  await t.waitFor(async () => (await ckCard(t)) === 'p3', { timeout: 15000, what: '英语：discriminate 那一道' });
  await t.page.click('.ck-card .ck-pick[data-v="非谓语"]'); await ckType(t, '.ck-card .ck-text', '谓语是 show，collected 修饰 data'); await ckSure(t); await ckSubmit(t);
  // errfind：点对了词、改成常见的错法 knew → 补讲；retry 点对改对
  const errfind = async (id, fix) => {
    await t.waitFor(async () => (await ckCard(t)) === id, { timeout: 15000, what: `英语：errfind ${id}` });
    await t.page.click(`.ck-card .en-word[data-i="${en.probes[id].wordAt}"]`);
    await t.page.fill('.ck-card .ck-fixrow .ck-in', fix); await ckSure(t); await ckSubmit(t);
  };
  await errfind('p4', 'knew');
  await t.waitFor(async () => (await ckCard(t)) === 'teach', { timeout: 8000, what: 'errfind 改成 knew 出补讲' });
  check(/known/.test(await t.text('.ck-teach')), 'errfind 的补讲不是外部写的那一条');
  await sleep(500); await t.page.click('.ck-next');
  await errfind('p4a', 'written');
  const { evs, absorb } = await ckDone(t, sid, 'ken', 'EN-L1.2.3');
  check(['部分', '待核'].includes(absorb.state), `EN-L1.2.3 的吸收：${absorb.state}`);
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p4a']) check(evs.some((e) => e.probe === id), `英语的 ${id} 没写证据（src: check）`);
  check(evs.find((e) => e.probe === 'p1')?.outcome === 'pass', 'parse 一次过的证据不是 pass');
}

/** 页面开着的时候往替身数据库里放（像别的设备写的）：在同一个站点的另一页里写，开着的那页收到 storage 事件重读，不会被它手上的旧副本盖掉 */
async function plantLive(t, docs) {
  const p = await t.ctx.newPage();
  await p.goto(BASE.replace('desk.html?dev', 'la-kit.js'));
  await p.evaluate((docs) => {
    const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:'));
    const all = JSON.parse(localStorage.getItem(k));
    Object.assign(all, docs);
    localStorage.setItem(k, JSON.stringify(all));
  }, docs);
  await p.close();
}
const todayIn = (t) => t.page.evaluate(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });

function check(cond, msg) { if (!cond) throw new Error(msg); }

// —— 每一段：一个独立的浏览器上下文（数据库从空开始），按顺序做几件事、核对结果 ——
const SUITES = {
  // 首页每一块都画出来、每一页都打得开、换科目不清掉「样子」的选中
  async pages(browser) {
    const t = await seeded(browser);
    const days = await t.text('.dk-tag-n');
    const want = await t.page.evaluate(() => { const d = new Date(); const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); return String(Math.round((Date.UTC(2027, 11, 21) - a) / 86400000)); });
    check(days === want, `距考研写的是 ${days}，按今天算应该是 ${want}`);
    for (const pg of ['map', 'books', 'weak', 'errors', 'classes', 'stats', 'manage']) {
      await t.route(pg);
      const txt = await t.page.evaluate(() => [...document.querySelectorAll('.dk-pages, .dk-bookpage, .dk-manage')].find((e) => !e.hidden)?.innerText || '');
      check(txt.trim().length >= 4, `「${pg}」那一页是空的`);
    }
    await t.route('manage');
    const before = await t.page.$$eval('.dk-look [aria-selected="true"]', (x) => x.map((e) => e.textContent));
    await t.page.click('.dk-space[data-space="cs"]'); await sleep(400);
    await t.page.click('.dk-space[data-space="en"]'); await sleep(400);
    const after = await t.page.$$eval('.dk-look [aria-selected="true"]', (x) => x.map((e) => e.textContent));
    check(JSON.stringify(before) === JSON.stringify(after) && after.length === 2, `换科目以后「样子」的选中变了：${before} → ${after}`);
    await t.page.click('.dk-space[data-space="math"]'); await sleep(300);
    // 小组件版式：切过去首页照样画
    await t.page.click('.dk-look-l[data-layout="grid"]'); await sleep(1500);
    check((await t.page.evaluate(() => document.querySelector('.is-desk')?.dataset.layout)) === 'grid', '切到小组件版式没切过去');
    check(await t.page.$('.dk-days-slot .dk-spine'), '小组件版式里没有距考研那一格');
    // 面板：每一行点开、关上，不留下遮罩
    await t.route('manage'); await t.page.click('.dk-look-l[data-layout="list"]'); await sleep(1500);
    for (const r of await t.page.$$eval('.dk-trow', (x) => x.map((e) => e.dataset.row))) {
      await t.page.click(`.dk-trow[data-row="${r}"]`); await sleep(800);
      check(await t.page.$('.fl-panel'), `点「${r}」那一行没出面板`);
      await t.page.click('.fl-close'); await sleep(800);
      check(!(await t.page.$('.fl-panel')), `「${r}」的面板关不上`);
      check((await t.page.evaluate((k) => getComputedStyle(document.querySelector(`.dk-trow[data-row="${k}"]`)).visibility, r)) === 'visible', `关了「${r}」的面板，那一行还藏着`);
    }
    return t;
  },

  // 「项目指令」（第十四轮）：第一次保存写失败（网络抖），写的出口自己重试；一直写不进去时框里的字留着、按钮能再点；网好了再点就成
  async mine(browser) {
    const t = await seeded(browser);
    await t.route('manage');
    await t.page.waitForSelector('.dk-instr .dk-instr-text', { timeout: 15000 });
    await t.page.fill('.dk-instr .dk-instr-text', '自动测试的第一句');
    await t.page.evaluate(() => window.LAKitDev.failWrites(1));
    await t.page.click('.dk-instr .dk-instr-save');
    await t.waitFor(async () => (await t.db())['meta/instructions']?.text === '自动测试的第一句', { timeout: 8000, what: '失败一次（自己重试成了）以后存进去' });
    t.expected = ['模拟的写入失败'];
    await t.page.fill('.dk-instr .dk-instr-text', '自动测试的第二句：先让我自己试');
    await t.page.evaluate(() => window.LAKitDev.failWrites(20));
    await t.page.click('.dk-instr .dk-instr-save');
    await t.waitFor(() => t.page.$('.dk-instr .dk-instr-save:not([disabled])'), { timeout: 10000, what: '写不进去以后「存」放开' });
    check(await t.page.inputValue('.dk-instr .dk-instr-text') === '自动测试的第二句：先让我自己试', '写不进去以后框里的字丢了');
    await t.page.evaluate(() => window.LAKitDev.failWrites(0));
    await t.page.click('.dk-instr .dk-instr-save');
    await t.waitFor(async () => (await t.db())['meta/instructions']?.text === '自动测试的第二句：先让我自己试', { timeout: 8000, what: '网好了再存就成' });
    await t.waitFor(async () => ((await t.db())['meta/errors']?.list || []).some((e) => String(e.msg).includes('模拟的写入失败')), { timeout: 12000, what: '写不进去的那次记进 meta/errors（攒几秒才写）' });
    return t;
  },

  // 要想起来的：评分写失败一次再点，只记一条证据；第一张写「第一次想」；评完数量归零；评分途中点「先到这」不再翻出下一张
  // 410 分（forecast/，第十轮的测量）：首页那张卡写「如果今天考」、作答一多数字跟着变、点开面板、关上
  async score(browser) {
    const t = await seeded(browser);
    const num = async () => Number((await t.text('.dk-score-n b')) || NaN);
    const n0 = await t.waitFor(async () => { const n = await num(); return Number.isFinite(n) ? n : null; }, { what: '首页的 410 卡画出来' });
    const card = await t.text('.dk-score');
    check(card?.includes('如果今天考') && card?.includes('410'), '410 卡上没写「如果今天考」和目标');
    check(/范围 \d+–\d+/.test(card || ''), '410 卡上没写范围');
    check(/测出来|估的/.test(card || ''), '410 卡上没写几成是测出来的');
    // 一块做对三道真题级的题（替身数据库直接放进去，刷新一下读到）：预测分跟着涨
    const at = Date.now() - 3600e3;
    const ev = (i) => ({ src: 'record', comp: `e2e-q${i}`, q: '题', ok: true, attempts: 1, final: true, at: at + i * 60e3, kind: 'answer', session: 'c-e2e-score', block: 'L2.2.2', tags: ['L2.2.2'], exam: `Q-301-2015-0${i}` });
    await plant(t, Object.fromEntries([1, 2, 3].map((i) => [`evidence/ev-e2e-score-${i}`, { id: `ev-e2e-score-${i}`, ...ev(i) }])));
    await t.page.reload(); await sleep(1500);
    const n1 = await t.waitFor(async () => { const n = await num(); return n > n0 ? n : null; }, { what: '做对了真题级的题以后 410 卡上的分涨了' });
    check(n1 > n0, `分没涨：${n0} → ${n1}`);
    await t.page.click('.dk-score-btn'); await sleep(900);
    check(await t.page.$('.fl-panel .dk-sc-how'), '点 410 卡没出面板（或面板里没有「怎么算的」）');
    const panel = await t.text('.fl-panel');
    check(panel?.includes('学习台里还没有'), '面板里没标出学习台里还没有的部分');
    check(panel?.includes('到考试那天'), '面板里没有「不再学到考试那天」');
    await t.page.click('.fl-close'); await sleep(800);
    check(!(await t.page.$('.fl-panel')), '410 的面板关不上');
    return t;
  },

  async recall(browser) {
    const t = await seeded(browser);
    // 首页的数字会往上滚（feel.js 的 rollNumber），滚的那一下字里有新旧两个数：等它停下来再读
    const count = () => t.waitFor(async () => { const v = String((await t.text('.dk-trow[data-row="recall"] .dk-ic')) ?? '').trim(); return /^\d+$/.test(v) ? Number(v) + 1 : null; }, { timeout: 8000, what: '「要想起来的」那一行的数字' }).then((n) => n - 1);
    const due = await count();
    const stamp = (k) => JSON.stringify([k.tier, k.last, k.result, k.lapses]);
    const before = new Map((await t.docs('recall')).map((k) => [k.id, stamp(k)]));
    check(due >= 2, `示例记忆里今天要想的只有 ${due} 条，测不了`);
    await t.page.click('.dk-trow[data-row="recall"]'); await sleep(800);
    await t.page.click('.fl-panel .dk-recall-go'); await sleep(600);
    // 第一张：故意让写记忆点失败一次
    await t.page.fill('.rc-typed', '随便写一句');
    await t.page.click('.rc-show'); await sleep(900);
    const where = await t.text('.rc-where');
    check(/第一次想|上次/.test(where || ''), '翻过来以后没有「第一次想 / 上次…」那一行');
    t.expected = ['模拟的写入失败'];
    await t.page.evaluate(() => window.LAKitDev.failWrites(20, 'recall/'));
    await t.page.click('.rc-r[data-r="got"]');
    await t.waitFor(() => t.page.$('.rc-r[data-r="got"]:not([disabled])'), { timeout: 10000, what: '写不进去以后评分按钮放开' });
    await t.page.evaluate(() => window.LAKitDev.failWrites(0));
    await t.page.click('.rc-r[data-r="got"]');
    await t.waitFor(() => t.page.$('.rc-show'), { timeout: 8000, what: '评完第一张翻出第二张' });
    // 第二张：评分的同时点「先到这」
    await t.page.click('.rc-show'); await sleep(900);
    await t.page.evaluate(() => window.LAKitDev.slowWrites(600));
    await t.page.click('.rc-r[data-r="vague"]');
    await sleep(100);
    await t.page.evaluate(() => document.querySelector('.rc-stop')?.click());
    await t.page.evaluate(() => window.LAKitDev.slowWrites(0));
    await sleep(2500);
    check(!(await t.page.$('.rc-show')), '评分途中点了「先到这」，还是翻出了下一张');
    check((await t.text('.fl-panel'))?.includes('想了'), '点「先到这」以后没出小结');
    const ev = (await t.docs('evidence')).filter((e) => e.src === 'recall');
    check(ev.length === 2, `想了 2 条，证据里记了 ${ev.length} 条（写失败重试不该多记）`);
    const rated = (await t.docs('recall')).filter((k) => before.get(k.id) !== stamp(k));
    check(rated.length === 2, `想了 2 条，记忆点里变了的有 ${rated.length} 条`);
    await t.page.click('.fl-close'); await sleep(800);
    await sleep(800);
    const left = await count();
    check(left === due - 2, `想完 2 条，首页还写今天要想 ${left} 条（原来 ${due}）`);
    return t;
  },

  // 补记：写一句、记下来，证据里多一条 src: manual
  async manual(browser) {
    const t = await seeded(browser);
    await t.page.click('.dk-trow[data-row="manual"]'); await sleep(800);
    await t.page.fill('.fl-panel .dk-mtext', '自动测试：书上 2.3 节第 5 题做错了，符号弄反');
    await t.page.evaluate(() => [...document.querySelectorAll('.fl-panel .dk-mv')].find((b) => b.textContent.includes('错'))?.click());
    await t.page.click('.fl-panel .dk-msave'); await sleep(1500);
    const ev = (await t.docs('evidence')).filter((e) => e.src === 'manual');
    check(ev.length === 1, `补记以后证据里 src: manual 有 ${ev.length} 条`);
    return t;
  },

  // 一整节课：连点两下「开新课」只开一节；上课、作答；回首页直接下课；报告是正式的；以前的课、翻看黑板都打得开
  async class(browser) {
    const t = await seeded(browser);
    await t.openForm('class');
    const before = (await t.docs('sessions')).length;
    await t.page.dblclick('.dk-class .dk-new');
    const sid = await t.inClass();
    check((await t.docs('sessions')).length === before + 1, '连点两下「开新课」开出了不止一节');
    await t.page.click('button:has-text("开始上课")');
    await t.waitFor(() => t.page.$('.st-choice, .quiz-opt, button:has-text("一个数（1×1）")'), { timeout: 30000, what: '模拟老师写出第一道题' });
    await sleep(1500);
    await t.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('一个数（1×1）'))?.click());
    await sleep(2500);
    const input = t.page.locator('textarea:visible, [contenteditable="true"]:visible').first();
    await input.click(); await t.page.keyboard.type('测试:记忆'); await t.page.keyboard.press('Enter');
    await sleep(8000);
    // 回首页：这节课挂着，主角卡写「接着上课」
    await t.open(); await t.page.waitForSelector('.dk-class .dk-go', { state: 'attached', timeout: 15000 });
    await t.page.evaluate(() => document.querySelector('.dk-class .dk-close').click());
    await t.answer('直接下课');
    const s = await t.waitFor(async () => { const x = (await t.docs('sessions')).find((d) => d.id === sid); return x?.status === 'closed' && x.report?.at ? x : null; }, { timeout: 20000, what: '直接下课以后报告写好' });
    check(!s.report.provisional, '下了课的报告还是「暂时的」');
    await t.route('classes');
    check((await t.text('.dk-pages'))?.includes('分钟'), '以前的课里没有这节课');
    await t.route(`classes/${sid}`);
    await t.waitFor(async () => !(await t.text('.dk-pages'))?.includes('还没有课后报告') && (await t.text('.dk-pages'))?.length > 40, { what: '这节课那一页读到报告' });
    // 翻看黑板（只读的课堂）
    await t.open(`view/${sid}`);
    await t.waitFor(() => t.page.evaluate(() => document.body.innerText.includes('这节课的记号') || document.querySelectorAll('.bd-seg, .seg, section').length > 2), { timeout: 20000, what: '只读的黑板画出来' });
    return t;
  },

  async drill(browser) {
    const t = await seeded(browser);
    const plant = async () => t.page.evaluate(() => {
      const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:'));
      const all = JSON.parse(localStorage.getItem(k));
      const q = (id, text) => ({ block: 'L2.2.2', kind: 'quiz', md: '```quiz\nid: ' + id + '\nq: ' + text + '\n- [x] 一个数\n- [ ] 一个矩阵\n```', q: text, title: text, src: 'board', from: { session: 'c-20261020-1', comp: id }, fromSession: 'c-20261020-1', orig: 'wrong', errors: ['L2-07'], space: 'math', status: 'active', at: Date.parse('2026-10-20T10:00:00+08:00') });
      all['drills/d-e2e-1'] = q('d-e2e-1', 'βᵀα 是什么');
      all['drills/d-e2e-2'] = q('d-e2e-2', 'αᵀβ 是什么');
      // 第十四轮：挑哪几道由项目 Claude 写在 meta/today 里，首页照着开
      all['meta/today'] = { date: new Date().toLocaleDateString('sv-SE'), items: [{ kind: 'drill', ids: ['d-e2e-1', 'd-e2e-2'], reviews: ['R3'], why: '上次错过' }] };
      localStorage.setItem(k, JSON.stringify(all));
    });
    await plant(); await t.open(); await sleep(1500);
    await t.waitFor(() => t.page.$('.dk-trow[data-row="drill"]'), { what: '首页出现「练一练」' });
    const run = async () => {
      const n0 = (await t.docs('sessions')).length;
      await t.page.click('.dk-trow[data-row="drill"]'); await sleep(800);
      await t.page.dblclick('.fl-panel .dk-drill-go'); // 手指一抖点了两下：只开一节
      const id = await t.inClass();
      await sleep(800);
      check((await t.docs('sessions')).length === n0 + 1, '连点两下「开始」开出了不止一节练习');
      return id;
    };
    // 点一个选项；答对的等页面判完（「这题是……的」那一行出来），答错的等「再想想」
    const pick = async (label) => {
      await t.waitFor(() => t.page.$('.dr-stage .q-opt'), { timeout: 10000, what: '题目画出来' });
      await t.page.evaluate((l) => { const b = [...document.querySelectorAll('.dr-stage .q-opt')].find((x) => x.textContent.trim().endsWith(l)); b?.click(); }, label);
      await t.waitFor(() => t.page.$('.dr-where:not([hidden]), .dr-stage .q-opt.is-wrong'), { timeout: 8000, what: `点了「${label}」以后页面判出来` });
      await sleep(400);
    };
    // 第一节：做完，第一题作答时写证据失败一次（sink 自己重试）
    const did = await run();
    await t.page.evaluate(() => window.LAKitDev.failWrites(1, 'evidence/'));
    for (let i = 0; i < 4 && !(await t.page.$('.dr-done:not([hidden])')); i++) { await pick('一个数'); await t.page.click('.dr-next').catch(() => {}); await sleep(900); }
    const d = await t.waitFor(async () => (await t.docs('sessions')).find((x) => x.id === did && x.status === 'closed' && x.drill), { timeout: 25000, what: '练一练做完写进 sessions' });
    check(d.drill.n === 2 && d.drill.clean === 2, `两道都一次做对，结果记成 ${JSON.stringify(d.drill)}（写失败的那题算成没做了？）`);
    // 第二节：故意做错一道就走，在首页直接下课
    const r0 = (await t.docs('reviews')).find((r) => r.id === 'R3');
    await plant(); await t.open(); await sleep(1500);
    await t.page.evaluate(() => { const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:')); const all = JSON.parse(localStorage.getItem(k)); for (const p of Object.keys(all)) if (p.startsWith('evidence/') && String(all[p].comp || '').startsWith('d-e2e')) all[p].at = Date.parse('2026-10-01T10:00:00+08:00'); localStorage.setItem(k, JSON.stringify(all)); });
    await t.open(); await sleep(1500);
    if (!(await t.page.$('.dk-trow[data-row="drill"]'))) { results.push({ note: '刚做对的题今天不再挑，第二节练一练没开成，直接下课那一半没测' }); return t; }
    const did2 = await run();
    await pick('一个矩阵');
    await t.page.click('.dr-home');
    await t.waitFor(() => t.page.evaluate(() => !location.hash && !!document.querySelector('.dk-class')), { timeout: 15000, what: '从练习回到学习台' });
    await t.page.waitForSelector('.dk-open .dk-close', { state: 'attached', timeout: 15000 });
    await t.page.evaluate((x) => document.querySelector(`.dk-open .dk-close[data-sid="${x}"]`)?.click(), did2);
    await t.answer('直接下课');
    const d2 = await t.waitFor(async () => (await t.docs('sessions')).find((x) => x.id === did2 && x.status === 'closed'), { timeout: 20000, what: '练一练直接下课' });
    check(d2.drill, '练一练直接下课以后没有算结果');
    const r1 = (await t.docs('reviews')).find((r) => r.id === 'R3');
    check(r1 && (r1.result !== r0?.result || r1.last !== r0?.last), `做错了一道就直接下课，复现组 R3 没变（${JSON.stringify({ before: r0?.result, after: r1?.result })}）`);
    return t;
  },

  // 复现课：「复现」那一行点开，「复现这 N 组」开一节复现课，这节课记着复现哪几组；连点两下只开一节
  async review(browser) {
    const t = await seeded(browser);
    const n0 = (await t.docs('sessions')).length;
    await t.page.click('.dk-trow[data-row="today"]'); await sleep(800);
    const want = await t.page.$eval('.fl-panel .dk-rv .dk-review', (b) => b.dataset.rids.split(','));
    await t.page.dblclick('.fl-panel .dk-rv .dk-review');
    const sid = await t.inClass();
    await sleep(1000);
    const all = await t.docs('sessions');
    check(all.length === n0 + 1, '连点两下「复现这几组」开出了不止一节');
    const s = all.find((x) => x.id === sid);
    check(Array.isArray(s.review) && want.every((r) => s.review.includes(r)), `复现课没记着要复现的组（要 ${want}，记的 ${JSON.stringify(s.review)}）`);
    const pk = (await t.db())[`sessions/${sid}/pack/main`];
    check(pk && (pk.reviewClass || pk.review), '复现课的资料包里没有复现组');
    return t;
  },

  // 主角卡的「⋯」小菜单：点开有「直接下课」「删掉这节课」，点「直接下课」走的是同一个流程
  async menu(browser) {
    const t = await seeded(browser);
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    await t.open(); await t.page.waitForSelector('.dk-class .dk-more', { timeout: 15000 });
    await t.page.click('.dk-class .dk-more'); await sleep(500);
    const items = await t.page.$$eval('.fl-menu button', (x) => x.map((b) => b.textContent.trim()));
    check(items.some((x) => x.includes('直接下课')) && items.some((x) => x.includes('删掉')), `「⋯」菜单里是 ${items.join(' / ')}`);
    await t.page.evaluate(() => [...document.querySelectorAll('.fl-menu button')].find((b) => b.textContent.includes('直接下课')).click());
    await t.answer('直接下课');
    await t.waitFor(async () => (await t.docs('sessions')).find((x) => x.id === sid)?.status === 'closed', { what: '从「⋯」菜单直接下课' });
    check(!(await t.page.$('.fl-menu')), '菜单点完没收起');
    return t;
  },

  // 守卫：课堂里的 Claude 写 memo 块，对得上的收下、编原话 / 编证据编号的挂提醒（话不改）、重复的拒收（下一轮告诉它）；
  // 管理页「自检 → 守卫」看得到
  async guard(browser) {
    const t = await seeded(browser);
    await t.openForm('class'); // 模拟老师的「测试:守卫」在黑板课里；守卫本身两种课共用（memops.applyMemo）
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    await t.page.click('button:has-text("开始上课")');
    // 等模拟老师第一轮讲完（板上出了题）再说话：老师还在写的时候，发送键是「停止」
    await t.waitFor(() => t.page.$('button:has-text("一个数")'), { timeout: 30000, what: '模拟老师写出第一道题' });
    await sleep(2500);
    const input = t.page.locator('textarea:visible, [contenteditable="true"]:visible').first();
    await input.click(); await t.page.keyboard.type('测试:守卫'); await t.page.keyboard.press('Enter');
    const logs = await t.waitFor(async () => { const l = Object.entries(await t.db()).filter(([k]) => k.startsWith('guard_log/')).map(([, v]) => v); return l.length >= 2 ? l : null; }, { timeout: 30000, what: '守卫记下挂提醒的几条' }).catch(async (e) => {
      if (process.env.E2E_DEBUG) { const all = await t.db(); console.log('DBG turns', JSON.stringify(Object.entries(all).filter(([k]) => k.includes('/class_turns/')).map(([k, v]) => [k, v.role, String(v.text || v.say || '').slice(0, 300)]), null, 1)); console.log('DBG obs', JSON.stringify((await t.docs('observations')).filter((o) => o.session === sid))); console.log('ERRS', t.errors); }
      throw e;
    });
    const obs = await t.docs('observations');
    const good = obs.find((o) => o.session === sid && String(o.text).includes('想看守卫') && !String(o.text).endsWith('。'));
    check(good && !good.guard, '引了学生刚说的原话那条应该照收、不挂提醒');
    const slip = (await t.docs('slips')).find((x) => x.session === sid && String(x.text).includes('早就会了'));
    check(slip?.guard?.verdict === 'flag' && slip.guard.checks.some((c) => c.code === 'quote-miss'), '编了原话的那条应该照写但挂提醒');
    check(String(slip.text).includes('这一块我早就会了不用讲'), '挂提醒的那条，Claude 写的话被改了');
    const fake = obs.find((o) => o.session === sid && String(o.text).includes('换一种题再测'));
    check(fake?.guard?.checks?.some((c) => c.code === 'basis-dropped'), '编了证据编号的那条应该挂提醒');
    // 第十四轮：学习的账只记不拦——和第一条几乎一样的那条也照收
    check(obs.some((o) => o.session === sid && String(o.text).endsWith('想看守卫。')), '和第一条几乎一样的那条第十四轮起照收');
    await t.open('manage');
    await t.waitFor(async () => /守卫/.test(await t.text('.dk-check') || '') && /挂提醒 [1-9]/.test(await t.text('.dk-guard') || ''), { timeout: 15000, what: '管理页的守卫一段写出挂提醒几条' });
    // 下课整理单被拒的（carry）：下一节同一科开课时进资料包，带过就清掉
    await plant(t, { 'meta/guard': { ...((await t.db())['meta/guard'] || {}), carry: { math: [{ line: 'error q="…" basis=ev-x', error: '守卫：依据 ev-x 在记忆库里找不到', session: sid, at: Date.now() }] } } });
    await t.open();
    await t.page.waitForSelector('.dk-class .dk-more', { timeout: 15000 });
    await t.page.evaluate(() => document.querySelector('.dk-class .dk-close')?.click());
    await t.answer('直接下课');
    await t.waitFor(async () => (await t.docs('sessions')).find((x) => x.id === sid)?.status === 'closed', { what: '先把这节下课' });
    await t.page.click('.dk-class .dk-new');
    const next = await t.inClass((h) => h !== sid);
    const pk = (await t.db())[`sessions/${next}/pack/main`];
    check(/没收的原因：依据 ev-x/.test(pk?.carry || ''), '下一节的资料包里没有带上上一节没收的那条');
    check(!((await t.db())['meta/guard']?.carry?.math || []).length, '带过的 carry 没清掉');
    return t;
  },

  // 第十一轮 B1：首页上的班主任（#chat）：开一段新对话、发一句、边写边显示、刷新还在；说的要求经 memo 块记进「我的要求」（by: head），
  // 我那一句也过一次话的账
  async chat(browser) {
    const t = await seeded(browser);
    await t.open('chat');
    await t.waitFor(() => t.page.$('.dk-chatpage:not([hidden]) .hd-empty'), { what: '班主任那一页画出来（空的时候有开场）' });
    check(!(await t.page.$('.dk-nav a[href="#chat"]')), '导航里还列着「班主任」（第十五轮收起来了）');
    await t.page.fill('.hd-input', '我 408 现在怎么样');
    await t.page.click('.hd-send');
    await t.waitFor(() => t.page.$('.hd-msgs .hd-me'), { what: '我的话出现在右边' });
    await t.waitFor(async () => /模拟班主任/.test(await t.text('.hd-msgs .hd-head:not(.is-live)') || ''), { timeout: 20000, what: '班主任回了一段' });
    const chats = await t.docs('chats');
    check(chats.length === 1 && chats[0].title === '我 408 现在怎么样', `对话没存好：${JSON.stringify(chats)}`);
    const cid = chats[0].id;
    check(decodeURIComponent(new URL(t.page.url()).hash) === `#chat/${cid}`, `地址没换成这段对话：${t.page.url()}`);
    const ev = (await t.docs('evidence')).find((e) => e.chat === cid);
    check(ev && ev.src === 'say' && ev.text === '我 408 现在怎么样', '我说的话没记成证据');
    // 刷新：还在这段对话里
    await t.page.reload();
    await t.page.waitForLoadState('load');
    await t.waitFor(async () => /模拟班主任/.test(await t.text('.hd-msgs') || ''), { what: '刷新以后对话还在' });
    check(await t.page.$(`.hd-chip[data-cid="${cid}"][aria-selected="true"]`), '上面那排没选中这段对话');
    // 第十四轮：班主任是项目 Claude。它用工具在笔记本里记了一笔（pin），下一轮的说明里就有
    await t.page.fill('.hd-input', '测试:笔记 以后开场复习只做两三句');
    await t.page.click('.hd-send');
    const nb = await t.waitFor(async () => (await t.docs('notebook')).find((d) => d.path === '学生/模拟.md' && d.pin), { timeout: 30000, what: '班主任用工具在笔记本里记了一笔' });
    check(nb.by === 'head', `笔记的作者不是班主任：${JSON.stringify(nb)}`);
    await t.waitFor(async () => (await t.page.locator('.hd-msgs .hd-head:not(.is-live)').count()) >= 2, { timeout: 20000, what: '班主任回了第二段' });
    await t.page.fill('.hd-input', '下一句');
    await t.page.click('.hd-send');
    await t.waitFor(async () => (await t.page.locator('.hd-msgs .hd-head:not(.is-live)').count()) >= 3, { timeout: 20000, what: '班主任回了第三段' });
    const sys = await t.waitFor(() => t.page.evaluate(() => (window.LAKitDevAI || []).findLast?.((x) => x.startsWith('# 学习台')) || ''), { what: '拿到班主任这一轮的说明' });
    check(sys.includes('### 笔记：学生/模拟.md'), '下一轮的说明里没有 pin 的笔记');
    check(!/学生的要求|开场简报|怎么改记忆/.test(sys), '班主任的说明里还有开发写的那几段');
    // 新对话
    await t.page.click('.hd-new');
    await t.waitFor(() => t.page.$('.hd-empty'), { what: '点「新对话」回到空的' });
  },

  // 删掉一节课以后同一天再开课：不拿到同一个课号
  async purge(browser) {
    const t = await seeded(browser);
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    await t.open(); await t.page.waitForSelector('.dk-class .dk-purge', { state: 'attached', timeout: 15000 });
    // 删课留下来的东西还记着这个课号：挂在弱点上的错题删课时留着（purge.js），模拟一条
    await t.page.evaluate((s) => { const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:')); const all = JSON.parse(localStorage.getItem(k)); all['errors/L2-99'] = { source: '课上', q: '删课以后留下的错题', mine: '错的', step: '第 1 步', cause: '自动测试', date: '2026-11-04', session: s, block: 'L2.1.1' }; for (let i = 1; i <= 20; i++) all[`sessions/${s}/class_turns/${String(i).padStart(6, '0')}`] = { seq: i, role: 'student', text: `第 ${i} 轮`, session: s }; const w = Object.keys(all).find((x) => x.startsWith('weaknesses/')); all[w] = { ...all[w], errors: [...(all[w].errors || []), 'L2-99'] }; localStorage.setItem(k, JSON.stringify(all)); }, sid);
    await t.page.reload(); await t.page.waitForSelector('.dk-class .dk-purge', { state: 'attached', timeout: 15000 });
    // 删课要快（2026-11-14）：点了「删掉」马上从首页消失；后台删到一半关掉了页面（写数据库调慢、半路刷新），刷新以后接着删完
    await t.page.evaluate(() => window.LAKitDev.slowWrites(1500));
    await t.page.evaluate(() => document.querySelector('.dk-class .dk-purge').click());
    await t.answer('删掉');
    await sleep(500);
    check(!(await t.page.$('.dk-class .dk-purge')), '点了「删掉」半秒以后这节课还挂在首页');
    await sleep(2200);
    const sdoc = (await t.docs('sessions')).find((x) => x.id === sid);
    check(sdoc?.deleting, `删到一半，课上没记 deleting（关了页面就接不上）：${JSON.stringify(sdoc)?.slice(0, 200)}；出错：${JSON.stringify((await t.db())['meta/errors']?.list?.map((e) => e.msg))?.slice(0, 300)}`);
    await t.page.reload();
    await t.waitFor(async () => !(await t.docs('sessions')).some((x) => x.id === sid), { timeout: 20000, what: '刷新以后接着把这节课删完' });
    await sleep(800);
    await t.page.click('.dk-class .dk-new');
    const again = await t.inClass();
    check(again !== sid, `删课以后再开课又拿到了 ${sid}`);
    return t;
  },

  // 挂着一夜没动静的课当作下了课（2026-11-14）：课后报告跟着按下了课重算，不再是暂时的
  async idle(browser) {
    const t = await seeded(browser);
    const sid = 'c-20261101-9';
    await t.page.evaluate((s) => { const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:')); const all = JSON.parse(localStorage.getItem(k)); all[`sessions/${s}`] = { kind: 'stage', status: 'open', block: 'L2.1.1', space: 'math', subject: 'linear-algebra', title: '挂了一夜的课', date: '2026-11-01', startedAt: Date.now() - 2 * 86400e3 }; localStorage.setItem(k, JSON.stringify(all)); }, sid);
    await t.page.reload();
    await t.waitFor(async () => { const d = (await t.docs('sessions')).find((x) => x.id === sid); return d?.status === 'closed' && d.closedBy === 'idle' && d.report && !d.report.provisional; }, { timeout: 20000, what: '挂了两天的课当作下了课、报告按下了课算' });
    const d = (await t.docs('sessions')).find((x) => x.id === sid);
    check(d.endedAt && d.endedAt < Date.now() - 86400e3, `下课时间应当是最后一个动静，不是现在：${d.endedAt}`);
    return t;
  },

  // 备份：导出一份，原样「只补缺的」恢复回去，条数不变、页面不报错
  async backup(browser) {
    const t = await seeded(browser);
    // 记忆摘要（老师每一轮读的那一份）跟着备份走：两份带新笔记和以前几版的
    const sumDocs = {
      'summary/shared': { text: '学生在备考 2027 年考研。', v: 2, at: 5, since: Date.now(), by: 'page', notes: [{ text: '喜欢先看结论', quote: '先给我结论', session: '', by: 'class', at: 6 }], history: [{ text: '第一版', v: 1, at: 1, by: 'chat' }] },
      'summary/math': { text: '线代用张宇 30 讲。', v: 1, at: 1, since: Date.now(), by: 'chat', notes: [], history: [] },
    };
    await plant(t, sumDocs);
    await t.open('manage');
    await t.page.waitForSelector('.dk-backup .dk-bgo', { state: 'attached', timeout: 15000 });
    const [dl] = await Promise.all([t.page.waitForEvent('download', { timeout: 15000 }), t.page.click('.dk-backup .dk-bgo')]);
    const path = await dl.path();
    const body = JSON.parse(readFileSync(path, 'utf8'));
    check(Array.isArray(body.docs) && body.docs.length > 10, '导出的备份里几乎没有东西');
    for (const [k, want] of Object.entries(sumDocs)) {
      const got = body.docs.find((d) => `${d.collection}/${d.doc_id}` === k)?.data;
      check(got && got.text === want.text && got.v === want.v && JSON.stringify(got.notes) === JSON.stringify(want.notes) && JSON.stringify(got.history) === JSON.stringify(want.history), `备份里的 ${k} 和数据库里的不一样：${JSON.stringify(got)?.slice(0, 200)}`);
    }
    // 数学那一份丢了、共用那一份后来又改过：「只补缺的」把丢的补回来，不盖掉改过的
    await t.page.evaluate(() => {
      const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:'));
      const all = JSON.parse(localStorage.getItem(k));
      delete all['summary/math'];
      all['summary/shared'] = { ...all['summary/shared'], text: '学生后来自己改过的一版。', v: 3, by: 'me' };
      localStorage.setItem(k, JSON.stringify(all));
    });
    await t.open('manage');
    await t.page.waitForSelector('.dk-brestore input', { state: 'attached', timeout: 15000 });
    const n0 = Object.keys(await t.db()).length;
    await t.page.setInputFiles('.dk-brestore input', path); await sleep(1500);
    if (await t.page.$('.la-dialog')) await t.answer('只补缺的').catch(() => t.answer('补'));
    await sleep(2000);
    const n1 = Object.keys(await t.db()).length;
    check(n1 >= n0, `恢复以后数据库少了东西：${n0} → ${n1}`);
    const back = await t.waitFor(async () => (await t.db())['summary/math'] || null, { timeout: 15000, what: '丢了的那份摘要从备份补回来' });
    check(back.text === '线代用张宇 30 讲。' && back.v === 1, `补回来的摘要不对：${JSON.stringify(back)}`);
    check((await t.db())['summary/shared']?.text === '学生后来自己改过的一版。', '「只补缺的」把后来改过的摘要盖掉了');
    return t;
  },

  // 过了午夜：页面一直开着，日期、距考研自己换；iPad 熄屏一夜（定时器停了）再点亮也换
  async midnight(browser) {
    const t = await openPage(browser, { clock: new Date('2026-11-04T23:58:00+08:00') });
    await t.page.goto(BASE);
    await t.page.clock.runFor(3000);
    await t.page.click('.dk-seed');
    await t.page.clock.runFor(4000);
    const d0 = await t.text('.dk-date'), n0 = Number(await t.text('.dk-tag-n'));
    check(d0?.includes('11月4日'), `开始时日期写的是 ${d0}`);
    await t.page.clock.runFor(3 * 60 * 1000);
    const d1 = await t.text('.dk-date'), n1 = Number(await t.text('.dk-tag-n'));
    check(d1?.includes('11月5日') && n1 === n0 - 1, `过了午夜：日期 ${d0} → ${d1}，距考研 ${n0} → ${n1}`);
    await t.page.clock.pauseAt(new Date('2026-11-05T00:30:00+08:00'));
    await t.page.clock.setSystemTime(new Date('2026-11-07T08:00:00+08:00'));
    await t.page.clock.resume();
    await t.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await t.page.clock.runFor(3000);
    const d2 = await t.text('.dk-date'), n2 = Number(await t.text('.dk-tag-n'));
    check(d2?.includes('11月7日') && n2 === n0 - 3, `熄屏两天再点亮：日期 ${d2}，距考研 ${n2}（应该是 ${n0 - 3}）`);
    return t;
  },

  // 体检和出错记录：打开学习台以后写了 meta/health；整个流程里没有页面报错被记进 meta/errors
  async health(browser) {
    const t = await seeded(browser);
    await t.waitFor(async () => (await t.db())['meta/health'], { timeout: 20000, what: '体检写进 meta/health' });
    // 故意留一个机械的毛病：下了课却没有结束时间、没有科目；体检应该自己补上
    await t.page.evaluate(() => { const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:')); const all = JSON.parse(localStorage.getItem(k)); all['sessions/c-20261101-1'] = { date: '2026-11-01', status: 'closed', block: 'L2.1.1', title: '体检用的旧课', startedAt: Date.parse('2026-11-01T10:00:00+08:00') }; localStorage.setItem(k, JSON.stringify(all)); });
    await t.page.reload();
    const s = await t.waitFor(async () => { const x = (await t.db())['sessions/c-20261101-1']; return x?.endedAt && x.space ? x : null; }, { timeout: 20000, what: '体检补上旧课的结束时间和科目' });
    check(s.title === '体检用的旧课', '体检改了课的标题（不该碰写的内容）');
    const h = (await t.db())['meta/health'];
    check(Array.isArray(h.fixed) && h.fixed.some((f) => String(f.id).includes('c-20261101-1')), 'meta/health 里没记这次修了什么');
    await t.route('manage');
    check((await t.text('.dk-check'))?.includes('体检'), '管理页的自检里看不到体检的结果');
    return t;
  },

  // 考情第 1 批（docs/exam-plan.md）：默认的考试档案、收件箱并真卷（好的进库、坏的整卷不收）、「管理 → 考试」改目标、首页不读考试资料的整类
  async exam(browser) {
    const t = await seeded(browser);
    const target = await t.waitFor(async () => { const x = (await t.db())['exam/target']; return x?.school ? x : null; }, { what: '页面写了一份默认的考试档案' });
    check(target.dept === '智能科学与技术学院' && target.goal === 410 && target.by === 'page', `默认档案不对：${JSON.stringify(target).slice(0, 200)}`);
    const fx = (f) => readFileSync(join(ROOT, 'tests/fixtures/exam', f), 'utf8');
    const good = buildPaper({ subject: '408', year: 2019, paperText: fx('408-2019.paper.txt'), answersText: fx('408-2019.answers.txt'), source: 'e2e' });
    // 第 1 题打上标签、挂到一个考点上（考情页、410 分的权重要看得到）
    good.questions[0].tags = { syl: ['G-DS-1.2.1'], how: 'process' };
    const bad = buildPaper({ subject: '408', year: 2018, paperText: fx('408-2019.paper.txt'), answersText: fx('408-2019.answers.txt') });
    bad.questions[3].type = 'mcq';
    await plant(t, {
      'syllabus/G-DS-1.2.1': { course: 'DS', space: 'cs', title: '顺序存储', year: 2026, blocks: ['DS-L1.1.1'], status: 'active' },
      'exam_inbox/X-408-2019': { kind: 'paper', paper: good.paper, questions: good.questions, passages: good.passages, by: 'dev', at: 1 },
      'exam_inbox/X-408-2018': { kind: 'paper', paper: bad.paper, questions: bad.questions, passages: [], by: 'dev', at: 1 },
    });
    await t.page.reload(); await sleep(1500);
    const all = await t.waitFor(async () => { const x = await t.db(); return !x['exam_inbox/X-408-2019'] && !x['exam_inbox/X-408-2018'] ? x : null; }, { timeout: 30000, what: '收件箱的两条都处理完' });
    check(all['exam_inbox_log/X-408-2019']?.ok === true, '好的那卷回执不是 ok');
    check(all['exam_inbox_log/X-408-2018']?.ok === false && /Q-408-2018-4/.test(JSON.stringify(all['exam_inbox_log/X-408-2018'].problems)), '坏的那卷回执没写哪一题');
    check(all['papers/X-408-2019'] && Object.keys(all).filter((k) => k.startsWith('questions/Q-408-2019-')).length === 47, '好的那卷没有整卷进库');
    check(!all['papers/X-408-2018'] && !Object.keys(all).some((k) => k.startsWith('questions/Q-408-2018-')), '坏的那卷有题进了库');
    check(all['meta/exam']?.counts?.questions === 47, `计数不对：${JSON.stringify(all['meta/exam'])}`);
    // 并完以后首页重算考情缓存：每门课的热度、每块平均每年几分
    const meta = await t.waitFor(async () => { const m = (await t.db())['meta/exam']; return m?.stats?.DS ? m : null; }, { what: '首页算好考情缓存' });
    check(meta.stats.DS.heat[0]?.title === '顺序存储' && meta.blockPerYear['DS-L1.1.1'] > 0, `考情缓存不对：${JSON.stringify(meta.stats.DS).slice(0, 200)}`);
    // 考情页：408 那一科看得到数据结构的热度，点「看真题」列出 2019 年的题、点开一道看题面
    await t.page.click('.dk-spaces[aria-label="科目"] .dk-space[data-space="cs"]');
    await t.route('exam');
    await t.waitFor(async () => (await t.text('.dk-exampage'))?.includes('顺序存储'), { what: '考情页画出数据结构的考点热度' });
    await t.page.click('.ex-heat .ex-bank[data-course="DS"]');
    await t.waitFor(() => t.page.$('.ex-q[data-q="Q-408-2019-1"]'), { what: '真题库列出 2019 年的题' });
    await t.page.click('.ex-q[data-q="Q-408-2019-1"]');
    await t.waitFor(async () => (await t.text('.ex-detail'))?.includes('假题 1'), { what: '点开一道看到题面' });
    await t.home();
    // 真题级：一次带真题题号的作答（第一次就做对）→ 首页按门课算出这一块真题级过了，写进 exam_bar；「下一步」那一行点得开
    await plantLive(t, { 'evidence/ev-exam-1': { kind: 'answer', src: 'answer', type: 'quiz', exam: 'Q-408-2019-1', ok: true, attempts: 1, ms: 30000, session: 'c-exam', block: 'DS-L1.1.1', tags: ['DS-L1.1.1'], at: Date.now() } });
    const bar = await t.waitFor(async () => { const b = (await t.db())['exam_bar/DS-L1.1.1']; return b?.passed ? b : null; }, { timeout: 20000, what: '真题级写进 exam_bar' });
    check(bar.timed === true && bar.done[0].id === 'Q-408-2019-1', `真题级不对：${JSON.stringify(bar)}`);
    await t.page.click('.dk-trow[data-row="next"]');
    await t.waitFor(async () => (await t.text('.fl-panel'))?.includes('还能攒'), { what: '「每块还能攒几分」的面板' });
    await t.page.keyboard.press('Escape').catch(() => {});
    await t.open();
    // 首页不订阅、不整类读考试的资料（收件箱除外）
    const reads = await t.page.evaluate(() => [...(window.LAKitDev?.reads || [])]);
    for (const c of ['questions', 'syllabus', 'papers', 'passages', 'exam_profiles']) check(!reads.includes(c), `首页整类读了 ${c}`);
    // 「管理 → 考试」：目标改成 400，存
    await t.route('manage');
    await t.waitFor(() => t.page.$('.dk-exam input[name=goal]'), { what: '管理页画出考试那张卡' });
    check((await t.text('.dk-exam'))?.includes('47 道真题'), '考试卡没写库里有几道真题');
    // 放考试资料：传一份 PDF → exam_uploads 多一条等入库；不是 PDF 的不收
    await t.page.setInputFiles('.dk-exup input[type=file]', [{ name: '2019年408真题.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 假的真题卷') }, { name: '笔记.docx', mimeType: 'application/msword', buffer: Buffer.from('x') }]);
    const upl = await t.waitFor(async () => (await t.docs('exam_uploads')).find((d) => d.name === '2019年408真题.pdf'), { what: '传的 PDF 记进 exam_uploads' });
    check(upl.kind === 'paper' && upl.subject === '408' && upl.year === 2019 && upl.status === 'waiting' && upl.asset, `传的资料记得不对：${JSON.stringify(upl)}`);
    check((await t.docs('exam_uploads')).length === 1, '不是 PDF 的也收了');
    await t.waitFor(async () => (await t.text('.dk-exup'))?.includes('1 份等入库'), { what: '卡上写几份等入库' });
    await t.page.fill('.dk-exam input[name=goal]', '400');
    await t.page.fill('.dk-exam input[name="split.math"]', '120');
    await t.page.click('.dk-exam .dk-exsave');
    const saved = await t.waitFor(async () => { const x = (await t.db())['exam/target']; return x?.goal === 400 ? x : null; }, { what: '档案的目标改成 400' });
    check(saved.split.math === 120 && saved.log.some((l) => l.by === 'me' && l.field === 'goal' && l.to === 400), `改档案没记 log：${JSON.stringify(saved.log)}`);
    await t.home();
    await t.waitFor(async () => (await t.text('.dk-score'))?.includes('目标 400 分'), { what: '首页 410 分那张卡换成目标 400 分' });
    // 收件箱那一行（2026-11-15 真机上 37 份只并进第一份，学生什么都看不到）。上面整页刷新过：开头那份坏卷从回执里现取，照样列着
    const another = (year) => {
      const id = `X-408-${year}`;
      return { kind: 'paper', by: 'dev', at: 1, passages: [], paper: { ...good.paper, id, year }, questions: good.questions.map((q) => ({ ...q, id: q.id.replace('2019', String(year)), year, paper: id })) };
    };
    await t.waitFor(async () => (await t.text('.dk-examinbox'))?.includes('有 1 份考试资料没并进去'), { what: '刷新以后从回执里列出整份不收的那份' });
    await t.page.click('.dk-examinbox summary');
    const first = await t.text('.dk-examinbox');
    check(first.includes('408 2018 年真题') && /total|Q-408-2018-4/.test(first), `整份不收的那份没写原因：${first}`);
    // 放两份新的，加上改好重新放进来的那份坏卷（同号、新的 at）：并的时候写着并到哪，并完这一行消失
    await t.page.evaluate(() => window.LAKitDev.slowWrites(250)); // 慢一点才看得到并到一半
    await plantLive(t, { 'exam_inbox/X-408-2017': another(2017), 'exam_inbox/X-408-2016': another(2016), 'exam_inbox/X-408-2018': { ...another(2018), at: 2 } });
    await t.waitFor(async () => /考试资料还在并进来：\d \/ 3，停在这一页/.test((await t.text('.dk-examinbox')) || ''), { timeout: 10000, what: '首页那一行写着并到第几份' });
    await t.waitFor(async () => { const x = await t.db(); return !x['exam_inbox/X-408-2017'] && !x['exam_inbox/X-408-2016'] && x['exam_inbox_log/X-408-2018']?.ok && (await t.page.$eval('.dk-examinbox', (e) => e.hidden)); }, { timeout: 30000, what: '三份都并完（改好的那份也并成了）、首页那一行消失' });
    await t.page.evaluate(() => window.LAKitDev.slowWrites(0));
    // 一直写不进去：试两轮（中间隔 10 秒）就停，那一行写明哪一份没并进去、为什么；原件留着下次再试
    t.expected = ['模拟的写入失败'];
    await t.page.evaluate(() => window.LAKitDev.failWrites(1e9, 'questions/Q-408-2015-', 'permission_denied'));
    await plantLive(t, { 'exam_inbox/X-408-2015': another(2015) });
    await t.waitFor(async () => (await t.text('.dk-examinbox'))?.includes('有 1 份考试资料没并进去'), { timeout: 30000, what: '一直写不进去：首页那一行写着没并进去' });
    await t.page.click('.dk-examinbox summary');
    const row = await t.text('.dk-examinbox');
    check(row.includes('408 2015 年真题') && row.includes('模拟的写入失败'), `没写明哪一份、为什么：${row}`);
    check((await t.db())['exam_inbox/X-408-2015'], '没并进去的原件被删了');
    await t.page.evaluate(() => window.LAKitDev.failWrites(0));
    // 进了课堂接着并（学生的习惯是打开首页就进课堂）：?dev&examwait=1 开课 1 秒以后开始。先进课堂再放两份，免得首页先并了
    await t.openForm('class&examwait=1'); // 首页这一下把刚才的 X-408-2015 并掉（不再写失败）
    await t.waitFor(async () => !(await t.db())['exam_inbox/X-408-2015'], { timeout: 20000, what: '首页把上次没并进去的那份并掉' });
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    await plantLive(t, { 'exam_inbox/X-408-2014': another(2014), 'exam_inbox/X-408-2013': another(2013) });
    const inClassDb = await t.waitFor(async () => { const x = await t.db(); return !x['exam_inbox/X-408-2014'] && !x['exam_inbox/X-408-2013'] ? x : null; }, { timeout: 30000, what: '在课堂里把两份并完' });
    check(inClassDb['papers/X-408-2014'] && inClassDb['papers/X-408-2013'] && inClassDb['exam_inbox_log/X-408-2014']?.ok && inClassDb['exam_inbox_log/X-408-2013']?.ok, '课堂里并的两套卷没进库');
    check(decodeURIComponent(new URL(t.page.url()).hash.slice(1)) === sid && !(await t.page.$('.dk-examinbox')), '课堂里并的时候换了页面、画了那一行');
    // 回到首页：课堂里都并完了，那一行不出现
    await t.open();
    await sleep(1500);
    check(await t.page.$eval('.dk-examinbox', (e) => e.hidden), `回到首页那一行还在：${await t.text('.dk-examinbox')}`);
    return t;
  },

  // 教材的收件箱（Claude Code 转好写进 book_inbox）：并进各页、删掉记录、拼成条目，书目从「等转写」变成「转好了」
  async inbox(browser) {
    const t = await seeded(browser);
    const page = (n) => ({ n, img: '', imgs: [], layer: '', size: [1200, 1600], status: 'todo', at: 1 });
    await plant(t, {
      'books/B90': { title: '测试用的习题册', kind: 'textbook', space: 'math', subject: '线代', status: 'partial', pages: 2, pagesDone: 0, pagesLeft: 2, pagesStored: 2, chunks: 0, toc: [], createdAt: 1, at: 1 },
      'books/B90/pages/1': page(1),
      'books/B90/pages/2': page(2),
      'book_inbox/B90-001-a': { book: 'B90', batch: 'b001', by: 'test', at: 1, pages: { 1: [{ kind: '标题', level: 1, title: '第1章 行列式', text: '', cont: false }, { kind: '习题', title: '1', text: '计算 $\\det A$.', cont: false }], 2: [{ kind: '习题', title: '2', text: '求 $A^{-1}$.', cont: false }] } },
    });
    await t.page.reload(); await sleep(1500);
    await t.route('books');
    const b = await t.waitFor(async () => { const x = (await t.db())['books/B90']; return x?.status === 'ready' && x.chunks > 0 ? x : null; }, { timeout: 20000, what: '收件箱并进书里、拼成条目' });
    check(b.pagesDone === 2, `转好的页数不对：${b.pagesDone}`);
    check(!(await t.db())['book_inbox/B90-001-a'], '并完了收件箱的记录没删');
    await sleep(600);
    check((await t.text('.dk-bookpage'))?.includes('转好了'), '教材页没写「转好了」');
    check(!b.needsRebuild, '拼完了书上还记着「还要拼条目」');
    // 上次并完了页、条目没拼完就关了页面（书上记着 needsRebuild，收件箱已经空了）：再打开接着拼
    const done = (n, title) => ({ ...page(n), status: 'done', items: [{ kind: '习题', title, text: `第 ${title} 题.`, cont: false }] });
    await plant(t, {
      'books/B91': { title: '拼到一半的书', kind: 'textbook', space: 'math', subject: '线代', status: 'partial', pages: 2, pagesDone: 0, pagesLeft: 2, pagesStored: 2, chunks: 0, toc: [], needsRebuild: true, createdAt: 1, at: 1 },
      'books/B91/pages/1': done(1, '1'),
      'books/B91/pages/2': done(2, '2'),
    });
    await t.page.reload(); await sleep(1500);
    const b2 = await t.waitFor(async () => { const x = (await t.db())['books/B91']; return x?.status === 'ready' && x.chunks === 2 && !x.needsRebuild ? x : null; }, { timeout: 20000, what: '打开学习台后接着把没拼完的书拼成条目' });
    check(b2.pagesDone === 2, `接着拼以后转好的页数不对：${b2.pagesDone}`);
    return t;
  },

  // 黑板课每一轮带「这一块在考试里」（2026-11-15 的「根」）：进课堂时按门课读一次考试资料（不等它），说明里多这一节——
  // 数是页面算的、留作模考的卷不在里面；核题号的函数挂上；开课的抢跑照样接得上（考试资料读到以后才抢）
  // 这节课要拿下的事（第十二轮，class/aims.js）：黑板课开课时文档上有空的 aims；模拟老师「测试:目标」写 board aims 两件、两道各挂一件的题；
  // 板上方那一条出现（0/2）；答对一道变 1/2（选择题点一下算带着做到）；点开看得到两件事和状态、不显示编号；证据上带 aim；
  // 刷新以后还在；「测试:目标改」换掉一件（算另一件事）、加一件；点下课，框里列着每件事的状态；报告里有这一节
  async aims(browser) {
    const t = await seeded(browser);
    await t.openForm('class');
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    check(Array.isArray((await t.docs('sessions')).find((d) => d.id === sid)?.aims), '新开的黑板课文档上没有 aims（空的也要有）');
    await t.page.click('button:has-text("开始上课")');
    await t.waitFor(() => t.page.$('button:has-text("一个数")'), { timeout: 30000, what: '模拟老师写出第一道题' });
    await sleep(2500);
    check(!(await t.page.$('.class-aims:not([hidden])')), '还没定要拿下的事，板上方那一条就出现了');
    const sys0 = await t.page.evaluate(() => window.LAKit.classroom.lastPrompt?.system || '');
    check(sys0.includes('这节课还没定要拿下的事') && sys0.includes('board aims'), '还没定的时候，老师的说明里没提醒先写 board aims');
    const say = async (x) => { const input = t.page.locator('textarea:visible, [contenteditable="true"]:visible').first(); await input.click(); await t.page.keyboard.type(x); await t.page.keyboard.press('Enter'); };
    await say('测试:目标');
    await t.waitFor(async () => /0\/2 有证据/.test(await t.text('.class-aims') || ''), { timeout: 30000, what: '板上方出现「这节课要拿下的 · 0/2 有证据」' });
    check((await t.docs('sessions')).find((d) => d.id === sid)?.aims?.length === 2, '老师写的两件事没存进这节课');
    await sleep(1500);
    await t.page.evaluate(() => [...document.querySelectorAll('.block[data-bid^="q-aim-"] .q-opt')].find((b) => b.textContent.includes('3×3 矩阵'))?.click());
    await t.waitFor(async () => /1\/2 有证据/.test(await t.text('.class-aims') || ''), { timeout: 15000, what: '答对挂在第一件上的题以后变成 1/2' });
    await t.page.click('.class-aims-line');
    const list = await t.waitFor(async () => { const x = await t.text('.class-aims-list'); return x && x.length > 10 ? x : null; }, { what: '点开那一条看到清单' });
    check(list.includes('带着做到') && list.includes('还没证据') && list.includes('判断两个向量相乘'), `清单不对：${list}`);
    check(!/\ba[12]\b/.test(list), '清单里显示了编号');
    // 去点别处：清单收回一行
    await t.page.click('.class-page-title:visible'); await sleep(400);
    check(await t.page.evaluate(() => document.querySelector('.class-aims-list')?.hidden === true), '点了别处，清单没收回去');
    const ev = await t.waitFor(async () => Object.entries(await t.db()).filter(([k]) => k.startsWith('evidence/')).map(([, v]) => v).find((v) => v.session === sid && v.aim === 'a1'), { what: '作答的证据上带着 aim' });
    check(!ev.tags?.includes('a1'), 'aim 进了 tags');
    // 老师下一轮看到的黑板现状里有每件事和页面算的状态
    await sleep(4000);
    const sys1 = await t.page.evaluate(() => window.LAKit.classroom.lastPrompt?.system || '');
    check(/这节课要拿下的事（状态是页面按学生的作答算的）：\n- a1（带着做到，1 道题）/.test(sys1), '老师的说明里没有要拿下的事和状态');
    // 刷新：那一条、状态都在
    await t.open(sid);
    await t.waitFor(async () => /1\/2 有证据/.test(await t.text('.class-aims') || ''), { timeout: 20000, what: '刷新以后那一条还是 1/2' });
    // 课上改：a2 换了内容、多一件
    await sleep(1500);
    await say('测试:目标改');
    await t.waitFor(async () => /1\/3 有证据/.test(await t.text('.class-aims') || ''), { timeout: 30000, what: '老师改了以后变成 1/3' });
    const doc = (await t.docs('sessions')).find((d) => d.id === sid);
    check(doc.aims.find((a) => a.id === 'a2')?.since > 0 && !doc.aims.find((a) => a.id === 'a1').since && doc.aimsLog?.length === 2, `改了以后存的不对：${JSON.stringify(doc.aims)}`);
    // 下课：框里列着每件事的状态，只点一次「下课」不用再点第二下
    await sleep(2500);
    await t.page.click('.cb-more'); await sleep(300); await t.page.click('.cb-end');
    await t.page.waitForSelector('.la-dialog', { timeout: 5000 });
    const dlg = await t.text('.la-dialog-text');
    check(/下课吗/.test(dlg) && dlg.includes('带着做到') && dlg.includes('还没证据') && !/\ba[123]\b/.test(dlg), `下课的框不对：${dlg}`);
    await t.answer('下课');
    const s = await t.waitFor(async () => { const x = (await t.docs('sessions')).find((d) => d.id === sid); return x?.status === 'closed' && x.report?.at ? x : null; }, { timeout: 40000, what: '下课以后报告写好' });
    const rep = (await t.db())[`sessions/${sid}/report/main`];
    check(rep?.aims?.length === 3 && rep.aims.find((a) => a.id === 'a1')?.status === 'led' && rep.aims.find((a) => a.id === 'a2')?.status === 'none', `报告里要拿下的事不对：${JSON.stringify(rep?.aims)}`);
    check(s.aims.length === 3, '下课以后这节课的 aims 没了');
    return t;
  },

  // 整条最小的一圈（第十二轮第 1 批）：开黑板课 → 老师定要拿下的事 → 两道题各做对 → 下课（框里有两件事）→ 回首页，后台给这节课留隔天的题
  // （?dev 用模拟的模型）→ 当天首页没有「验上次学的」→ 这节课变成昨天上的 → 这一行出现 → 点开做完（中间写数据库失败一次）→ 这一行消失 →
  // 那节课的文档上有 aims、holds、later →「以前的课」里那节课写着隔 1 天做没见过的题和要拿下的两件事
  async root(browser) {
    const t = await seeded(browser);
    await t.openForm('class');
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    await t.page.click('button:has-text("开始上课")');
    await t.waitFor(() => t.page.$('button:has-text("一个数")'), { timeout: 30000, what: '模拟老师写出第一道题' });
    await sleep(2500);
    const input = t.page.locator('textarea:visible, [contenteditable="true"]:visible').first();
    await input.click(); await t.page.keyboard.type('测试:目标'); await t.page.keyboard.press('Enter');
    await t.waitFor(async () => /0\/2 有证据/.test(await t.text('.class-aims') || ''), { timeout: 30000, what: '板上方出现要拿下的两件事' });
    await sleep(1500);
    const pick = (label) => t.page.evaluate((l) => { const all = [...document.querySelectorAll('.block[data-bid^="q-aim-"]')]; for (const b of all) { if (b.querySelector('.q-opt.is-correct, .q-opt[disabled]')) continue; const o = [...b.querySelectorAll('.q-opt')].find((x) => x.textContent.includes(l)); if (o) { o.click(); return true; } } return false; }, label);
    await pick('3×3 矩阵');
    await t.waitFor(async () => /1\/2 有证据/.test(await t.text('.class-aims') || ''), { timeout: 15000, what: '第一件有证据' });
    await sleep(6000); // 模拟老师回完这一轮
    await t.page.evaluate(() => { const b = [...document.querySelectorAll('.block[data-bid^="q-aim-"]')].at(-1); [...b.querySelectorAll('.q-opt')].find((x) => x.textContent.includes('一个数'))?.click(); });
    await t.waitFor(async () => /2\/2 有证据/.test(await t.text('.class-aims') || ''), { timeout: 15000, what: '两件都有证据' });
    await sleep(6000);
    await t.page.click('.cb-more'); await sleep(300); await t.page.click('.cb-end');
    await t.page.waitForSelector('.la-dialog', { timeout: 8000 });
    check((await t.text('.la-dialog-text')).split('带着做到').length === 3, `下课的框里应该两件都是带着做到：${await t.text('.la-dialog-text')}`);
    await t.answer('下课');
    await t.waitFor(async () => { const x = (await t.docs('sessions')).find((d) => d.id === sid); return x?.status === 'closed' && x.report?.at; }, { timeout: 40000, what: '下课、报告写好' });
    // 第十四轮：留不留、留什么由项目 Claude 定（页面不再自动出题）。这里模拟它写进题库和这节课的 holds
    const hid = `d-hold-${sid}-1`;
    const cur0 = (await t.docs('sessions')).find((d) => d.id === sid);
    await plant(t, {
      [`drills/${hid}`]: { block: cur0.block, kind: 'quiz', md: `\`\`\`quiz\nid: ${hid}\nq: 秩一矩阵能不能可逆（阶数大于 1）？\n- [ ] 是\n- [x] 否\n\`\`\``, q: '1+1', src: 'hold', by: 'head', hold: sid, aim: 'a1', far: false, status: 'active', at: Date.now() },
      [`sessions/${sid}`]: { ...cur0, id: undefined, holds: { ids: [hid], at: Date.now(), exam: 0, made: 1 } },
    });
    await t.open();
    const held = await t.waitFor(async () => (await t.docs('sessions')).find((d) => d.id === sid)?.holds, { timeout: 10000, what: '这节课记着留的题' });
    check(held.ids.length === 1, `留着的题记得不对：${JSON.stringify(held)}`);
    await sleep(800);
    check(!(await t.page.$('[data-row="later"]')), '刚下课当天就出现了「验上次学的」');
    // 这节课变成昨天上的（页面按「今天」减下课那天算满没满一天）
    const all = await t.db();
    const cur = all[`sessions/${sid}`];
    await plant(t, { [`sessions/${sid}`]: { ...cur, endedAt: cur.endedAt - 86400000, startedAt: cur.startedAt - 86400000 } });
    await t.open();
    await t.page.waitForSelector('[data-row="later"]', { timeout: 15000 });
    check(!/c-\d{8}|d-hold/.test(await t.text('[data-row="later"]')), '「验上次学的」那一行显示了编号');
    await t.page.click('[data-row="later"]'); await sleep(500);
    await t.page.click('.dk-later-go');
    const did = await t.inClass((h) => h !== sid);
    check((await t.docs('sessions')).find((d) => d.id === did)?.hold === sid, '开出来的练习没记是验哪节课的');
    // 一道一道做：填空的写答案，选择的点对的那个（模拟出的两道：a+b=5、「否」）；最后一道之前让写这节课失败一次
    for (let i = 0; i < held.ids.length; i++) {
      await t.waitFor(() => t.page.$('.dr-item .ans-check, .dr-item .q-opt'), { timeout: 15000, what: `第 ${i + 1} 道留着的题画出来` });
      if (i === 0) check(/上一节课留到今天的/.test(await t.text('.dr-lead') || ''), '验上次学的练习，开头那句还写着「页面挑的、不同块混在一起」');
      if (await t.page.$('.dr-item .ans-check')) { const box = t.page.locator('.dr-item .ans-input input, .dr-item .ans-input textarea, .dr-item .ans-input [contenteditable="true"]').first(); await box.click(); await t.page.keyboard.type('5'); await t.page.click('.dr-item .ans-check'); }
      else await t.page.evaluate(() => [...document.querySelectorAll('.dr-item .q-opt')].find((x) => x.textContent.includes('否'))?.click());
      await sleep(600);
      if (i === held.ids.length - 1) await t.page.evaluate(() => window.LAKitDev.failWrites(1, 'sessions'));
      await t.page.click('.dr-next'); await sleep(600);
    }
    await t.page.waitForSelector('.dr-done .dr-back', { timeout: 20000 });
    const later = await t.waitFor(async () => (await t.docs('sessions')).find((d) => d.id === sid)?.later, { timeout: 15000, what: '做完以后结果记回那节课' });
    check(later.n === held.ids.length && later.days === 1 && later.right <= later.n && later.drill === did, `记回去的不对：${JSON.stringify(later)}`);
    const src = (await t.docs('sessions')).find((d) => d.id === sid);
    check(src.aims?.length === 2 && src.holds && src.later && src.status === 'closed', '那节课的文档上 aims / holds / later 不全，或者被盖掉了别的字段');
    await t.page.click('.dr-done .dr-back');
    await t.page.waitForSelector('.dk-rows', { timeout: 15000 });
    await sleep(800);
    check(!(await t.page.$('[data-row="later"]')), '做完以后「验上次学的」还在');
    await t.route(`classes/${sid}`);
    const pg = await t.waitFor(async () => { const x = await t.text('.dk-pages'); return x && /隔 1 天做没见过的题/.test(x) ? x : null; }, { timeout: 15000, what: '以前的课里那节课写着课后那一行' });
    check(pg.includes('判断两个向量相乘') && pg.includes('带着做到'), `以前的课里没列要拿下的事和状态：${pg.slice(0, 300)}`);
    return t;
  },

  // 不打扰（第十二轮，class/quiet.js）：学生在输入框里打了字没发，老师这一轮写的新内容不在眼前——页面不替学生滚、不翻板，
  // 输入条上方出一小条，点它才过去；没在写的时候照常翻到新板
  async quiet(browser) {
    const t = await seeded(browser);
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    check(!(await t.docs('sessions')).find((d) => d.id === sid)?.kind, '首页开出来的新课不是黑板课');
    await t.page.click('button:has-text("开始上课")');
    await t.waitFor(() => t.page.$('button:has-text("一个数")'), { timeout: 30000, what: '模拟老师写出第一道题' });
    await sleep(2500);
    // 发一句让模拟老师换一块新板的暗号，老师还在写的时候马上在输入框里打几个字不发
    const input = t.page.locator('.cb-field textarea').first();
    await input.click(); await t.page.keyboard.type('测试:教具'); await t.page.keyboard.press('Enter');
    await sleep(300);
    await input.click(); await t.page.keyboard.type('我想问');
    const view0 = await t.page.evaluate(() => document.querySelector('.class-page:not([hidden]) .class-page-title')?.textContent);
    await t.waitFor(() => t.page.$('.class-talk-echo'), { timeout: 30000, what: '老师写了新的一块板，输入条上方出现那一小条' });
    const view1 = await t.page.evaluate(() => document.querySelector('.class-page:not([hidden]) .class-page-title')?.textContent);
    check(view0 === view1, `学生正在打字，页面还是翻走了：${view0} → ${view1}`);
    check((await input.inputValue()) === '我想问', '打了一半的字没了');
    check(((await t.page.locator('.class-talk-echo').boundingBox())?.height || 0) >= 44, '那一小条不够 44px 高');
    await t.page.click('.class-talk-echo');
    await sleep(800);
    const view2 = await t.page.evaluate(() => document.querySelector('.class-page:not([hidden]) .class-page-title')?.textContent);
    check(!(await t.page.$('.class-talk-echo')) && view2 !== view1, `点了那一小条没翻到新板：${view1} → ${view2}`);
    return t;
  },

  async classexam(browser) {
    const t = await seeded(browser);
    const q = (year, n, how) => ({ course: 'DS', space: 'cs', paper: `X-408-${year}`, year, n, type: 'single', points: 2, stem: `顺序表第 i 个位置插入要移动几个元素（${year} 年第 ${n} 题）`, options: { A: '1', B: '2', C: '3', D: '4' }, answer: 'B', analysis: '从后往前挪', tags: { syl: ['G-DS-2.1'], how } });
    await plant(t, {
      'syllabus/G-DS-2.1': { course: 'DS', space: 'cs', title: '顺序表', level: '掌握', text: '顺序表的插入和删除', year: 2026, blocks: ['DS-L2.1.1'], status: 'active' },
      'papers/X-408-2019': { subject: '408', space: 'cs', year: 2019, count: 1, total: 150 },
      'papers/X-408-2021': { subject: '408', space: 'cs', year: 2021, count: 1, total: 150 },
      'papers/X-408-2025': { subject: '408', space: 'cs', year: 2025, count: 1, total: 150, reserve: true },
      'questions/Q-408-2019-1': q(2019, 1, 'process'), 'questions/Q-408-2021-2': q(2021, 2, 'concept'), 'questions/Q-408-2025-3': q(2025, 3, 'process'),
    });
    await t.openForm('class');
    await t.page.click('.dk-spaces[aria-label="科目"] .dk-space[data-space="cs"]'); await sleep(600);
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    check((await t.docs('sessions')).find((d) => d.id === sid)?.block === 'DS-L2.1.1', '开出来的不是数据结构那一块的课');
    const sec = await t.waitFor(() => t.page.evaluate(() => window.LAKit?.classroom?.examSection), { timeout: 10000, what: '黑板课读到这门课的考试资料、拼出「这一块在考试里」' });
    check(sec.includes('### Q-408-2021-2') && sec.includes('顺序表（掌握）') && sec.includes('考了 3 次') && sec.includes('`exam: 题号`'), `这一节不对：${sec.slice(0, 300)}`);
    check(!/Q-408-2025-3|2025 年第 3 题/.test(sec) && sec.includes('另有 1 道在留作模考的卷里'), '留作模考的卷进了这一节');
    const why = await t.page.evaluate(() => ['Q-408-2019-1', 'Q-408-2025-3', 'Q-408-2019-9'].map((id) => window.LAKit.classroom.examCheck?.(id)));
    check(why[0] === '' && /留作模考/.test(why[1]) && /库里没有/.test(why[2]), `核题号的函数不对：${JSON.stringify(why)}`);
    await sleep(4500); // 等开课的抢跑发出去（考试资料读到以后 1.5 秒）
    await t.page.click('button:has-text("开始上课")');
    const sys = await t.waitFor(() => t.page.evaluate(() => window.LAKit.classroom.lastPrompt?.system), { timeout: 20000, what: '第一轮的说明发出去' });
    // 第十四轮：说明是项目 Claude 的那一份，课堂的几段在后面：这一节在「这节课的资料」后面、「黑板现状」前面
    check(/^# 这一块在考试里（页面从入库的真题和考试大纲算的）/m.test(sys) && sys.indexOf('这一块在考试里（') > sys.indexOf('# 这节课的资料') && sys.indexOf('这一块在考试里（') < sys.indexOf('# 黑板现状'), '说明里没有这一节，或者不在资料后面、黑板现状前面');
    check(!/Q-408-2025-3|2025 年第 3 题/.test(sys), '留作模考的卷进了说明');
    const turns = async () => Object.entries(await t.db()).filter(([k]) => k.startsWith(`sessions/${sid}/class_turns/`)).map(([, v]) => v);
    await t.waitFor(async () => (await turns()).some((x) => x.role === 'claude' && !x.discarded), { timeout: 30000, what: '模拟老师讲完第一轮' });
    check((await turns()).find((x) => x.role === 'claude' && !x.discarded)?.cost?.spec === 'hit', `带着考情，开课的抢跑没接上：${JSON.stringify((await turns()).filter((x) => x.kind === 'spec').map((x) => x.diff))}`);
    // 没入库的科目（数学）：没有这一节，不写占地方的话
    await t.open();
    await t.page.click('.dk-spaces[aria-label="科目"] .dk-space[data-space="math"]'); await sleep(600);
    await t.openForm('class');
    await t.page.evaluate(() => document.querySelector('.dk-class .dk-new').click());
    const mid = await t.inClass((id) => id !== sid);
    await sleep(3000);
    check((await t.page.evaluate(() => window.LAKit?.classroom?.examSection)) === '', '数学还没入库，黑板课却有「这一块在考试里」');
    await t.page.click('button:has-text("开始上课")');
    const sys2 = await t.waitFor(() => t.page.evaluate(() => window.LAKit.classroom.lastPrompt?.system), { timeout: 20000, what: '数学课第一轮的说明发出去' });
    check(!sys2.includes('这一块在考试里') && mid !== sid, '数学课的说明里有考情那一节');
    return t;
  },

  // 第十四轮：项目指令（我写的，每一轮原样给项目 Claude）、笔记本（它写的，我看改退回）、「笔记」页（它标 show 的能作答）
  async project(browser) {
    const t = await seeded(browser);
    await t.open('manage');
    await t.page.waitForSelector('.dk-instr .dk-instr-text', { timeout: 15000 });
    await t.page.fill('.dk-instr .dk-instr-text', '老师把内容讲透，我来学。');
    await t.page.click('.dk-instr .dk-instr-save');
    await t.waitFor(async () => (await t.db())['meta/instructions']?.text === '老师把内容讲透，我来学。', { what: '项目指令存进去' });
    await t.open('manage');
    await t.page.waitForSelector('.dk-instr .dk-instr-text', { timeout: 15000 });
    check(await t.page.inputValue('.dk-instr .dk-instr-text') === '老师把内容讲透，我来学。', '刷新以后项目指令不在了');
    // 它建的一个给我看的页面（show），里面有一道题
    const md = '# 情态动词一页\n\n```quiz\nq: may 后面接什么？\n- [x] 动词原形\n- [ ] 过去式\n```';
    await plant(t, { 'notebook/bm90ZS5tZA': { path: 'note.md', text: md, show: true, pin: false, v: 1, at: Date.now(), by: 'head', history: [] } });
    await t.open('notes');
    await t.page.waitForSelector('.dk-notespage a.dk-row', { timeout: 15000 });
    await t.page.click('.dk-notespage a.dk-row');
    await t.page.waitForSelector('.dk-note-body .q-opt', { timeout: 15000 });
    await t.page.click('.dk-note-body .q-opt:has-text("动词原形")');
    await t.waitFor(async () => (await t.docs('evidence')).some((e) => e.session === 'note'), { timeout: 15000, what: '「笔记」页的作答记成证据（session: note）' });
    // 管理 → 笔记本：看得到它、能改
    await t.open('manage');
    await t.page.waitForSelector('.dk-notebook .dk-nb-row', { timeout: 15000 });
    await t.page.click('.dk-notebook .dk-nb-row[data-path="note.md"]');
    await t.page.fill('.dk-notebook .dk-nb-text', '我改过了');
    await t.page.click('.dk-notebook .dk-nb-save');
    const nbd = await t.waitFor(async () => { const d = (await t.db())["notebook/bm90ZS5tZA"]; return d?.text === "我改过了" ? d : null; }, { what: "管理页里改了笔记" });
    check(nbd.by === "me" && nbd.history?.[0]?.text === md, `改了以后作者或旧的一版不对：${JSON.stringify({ by: nbd.by, h: nbd.history?.[0] })}`);
    // 课上：老师就是项目 Claude。说明里有我写的指令、没有根本规则；它写 board note，笔记本里多了 pin 的和 show 的，对不上的下一轮告诉它
    await t.open();
    await t.openForm('class');
    await t.page.click('.dk-class .dk-new');
    await t.inClass();
    await t.page.click('button:has-text("开始上课")');
    await t.waitFor(() => t.page.$('button:has-text("一个数")'), { timeout: 30000, what: '模拟老师写出第一道题' });
    await sleep(2500);
    const sys0 = await t.page.evaluate(() => window.LAKit.classroom.lastPrompt?.system || '');
    check(sys0.includes('老师把内容讲透，我来学。') && sys0.includes('# 学生写的项目指令'), '老师的说明里没有我写的项目指令');
    check(!sys0.includes('你是这个学生一对一的老师') && !sys0.includes('你对学生的了解'), '老师的说明里还有根本规则或「你对学生的了解」');
    check(sys0.includes('board note'), '老师的说明里没有 board note 的写法');
    const say = async (x) => { const input = t.page.locator('textarea:visible, [contenteditable="true"]:visible').first(); await input.click(); await t.page.keyboard.type(x); await t.page.keyboard.press('Enter'); };
    await say('测试:笔记');
    const pinned = await t.waitFor(async () => (await t.docs('notebook')).find((d) => d.path === '学生/课上.md' && d.pin), { timeout: 30000, what: '老师用 board note 记了一个 pin 的笔记' });
    check(pinned.by === 'class', `笔记的作者不是课上的老师：${pinned.by}`);
    check((await t.docs('notebook')).some((d) => d.path === '给你/一页.md' && d.show), '老师建的 show 页面没写进去');
    await sleep(1500);
    await say('下一句');
    const call = await t.waitFor(() => t.page.evaluate(() => { const c = (window.LAKitEval?.teacher?.calls || []).filter((x) => String(x.input.at(-1).content).includes('下一句')).at(-1); return c ? { sys: String(c.input[0].content), last: c.input.map((m) => String(m.content)).join('\n') } : null; }), { timeout: 20000, what: '学生又说一句以后调用老师' });
    check(call.sys.includes('### 笔记：学生/课上.md'), '下一轮老师的说明里没有 pin 的笔记');
    check(/笔记没改成/.test(call.last), '对不上的 str_replace 没告诉老师');
    return t;
  },

  // 第十四轮：项目 Claude 有整个学习台的读写权；每一次写都记进 journal，管理页「Claude 改过的」里能撤销
  async write(browser) {
    const t = await seeded(browser);
    const errs0 = await t.docs('errors');
    await t.open('chat');
    await t.waitFor(() => t.page.$('.dk-chatpage:not([hidden]) .hd-input'), { what: '班主任那一页画出来' });
    await t.page.fill('.hd-input', '测试:改');
    await t.page.click('.hd-send');
    const changed = await t.waitFor(async () => (await t.docs('errors')).find((x) => x.cause === '模拟班主任改的根因'), { timeout: 20000, what: '班主任用 write 改了一道错题' });
    const e0 = errs0.find((x) => x.id === changed.id);
    const j = (await t.docs('journal')).find((x) => x.path === `errors/${e0.id}`);
    check(j && j.by === 'head' && j.before?.cause === e0.cause, `journal 没记下改之前的样子：${JSON.stringify(j)}`);
    await t.open('manage');
    await t.page.click('.dk-journal summary');
    await t.page.waitForSelector('.dk-jrow', { timeout: 15000 });
    await t.page.click('.dk-jrow summary');
    await t.page.click('.dk-jundo');
    await t.answer('撤销');
    await t.waitFor(async () => (await t.docs('errors')).find((x) => x.id === e0.id)?.cause === e0.cause, { timeout: 10000, what: '撤销以后错题的根因回到原来的' });
    // 给开发的（dev_requests）：它记下的要改代码的事，管理页列出来，我能删
    await plant(t, { 'dev_requests/dr-e2e': { at: Date.now(), by: 'head', text: '首页能按周排', quote: '首页按周排吧', status: 'open' } });
    await t.open('manage');
    await t.page.click('.dk-dev summary');
    await t.page.waitForSelector('.dk-dev .dk-devdel', { timeout: 15000 });
    check((await t.text('.dk-dev'))?.includes('首页按周排吧'), '管理页「给开发的」没列出原话');
    await t.page.click('.dk-dev .dk-devdel');
    await t.answer('删掉');
    await t.waitFor(async () => !(await t.db())['dev_requests/dr-e2e'], { timeout: 10000, what: '「给开发的」删掉一条' });
    return t;
  },

  // 第十五轮审查找出的几处：页面正忙时到的 ext_in 不丢、两个标签页只执行一次、预案当场接住的作答也写 ext_out、
  // 切走时只有草稿也写、刷新以后助教还在、点「下课」不调用页面自己的模型
  async extfix(browser) {
    const t = await seeded(browser);
    const F4 = '````', F3 = '```';
    const today = await t.page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
    const sid = `c-${today.replace(/-/g, '')}-8`;
    const db = () => t.db();
    const ans = (id, a) => `${F3}answer\nid: ${id}\nq: ${a} 等于几？\nanswer: ${eval(a)}\n${F3}`;
    const t1 = `第一题。\n\n${F4}board new id=b1 title="算"\n${ans('a1', '2+2')}\n${F4}\n\n${F4}board react target=a1\nright: 对了。\n${F4}\n\n${F4}board coach target=a1 upto=只提示是加法\n${F4}\n`;
    await plant(t, {
      [`sessions/${sid}`]: { date: today, kind: 'ext', status: 'open', block: 'L2.1.4', title: '外部（审查）', space: 'math', startedAt: Date.now() },
      [`sessions/${sid}/ext_in/001`]: { seq: 1, text: t1, at: Date.now() },
    });
    await t.open(sid);
    await t.waitFor(() => t.page.$('[data-bid="a1"] .ans-check'), { timeout: 20000, what: '第一轮画上板' });
    // 两个标签页同时开着：后面的 ext_in 只执行一次
    const p2 = await t.ctx.newPage();
    await p2.goto(t.page.url());
    await sleep(3000);
    const nTurns = async () => Object.keys(await db()).filter((k) => k.startsWith(`sessions/${sid}/class_turns/`)).length;
    const n0 = await nTurns();
    await plantLive(t, { [`sessions/${sid}/ext_in/002`]: { seq: 2, text: `第二题。\n\n${F4}board add id=b2 title="再算"\n${ans('a2', '3+3')}\n${F4}\n`, at: Date.now() } });
    await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/002`]?.done, { timeout: 15000, what: 'ext_in/002 执行' });
    await sleep(2500);
    check(await nTurns() === n0 + 1, `两个标签页开着，ext_in/002 执行了 ${await nTurns() - n0} 次`);
    await p2.close();
    // 刷新以后助教还在：a1 写错 → 助教那一句
    await t.open(sid);
    await t.waitFor(() => t.page.$('[data-bid="a1"] .ans-check'), { timeout: 20000, what: '刷新以后板放回来' });
    const typeIn = async (id, v) => { const box = t.page.locator(`[data-bid="${id}"] .ans-input input, [data-bid="${id}"] .ans-input textarea, [data-bid="${id}"] .ans-input [contenteditable="true"]`).first(); await box.click(); await t.page.keyboard.type(v); };
    await typeIn('a1', '5'); await t.page.click('[data-bid="a1"] .ans-check');
    await t.waitFor(() => t.page.evaluate(() => /助教：模拟助教/.test(document.body.innerText)), { timeout: 15000, what: '刷新以后助教照样在' });
    // 预案当场接住的那一下也写进 ext_out
    const outs = async () => Object.entries(await db()).filter(([k]) => k.startsWith(`sessions/${sid}/ext_out/`)).map(([, v]) => v);
    const before = (await outs()).length;
    await t.page.locator('[data-bid="a1"] .ans-input input, [data-bid="a1"] .ans-input textarea, [data-bid="a1"] .ans-input [contenteditable="true"]').first().fill('4').catch(async () => { await typeIn('a1', '\b4'); });
    await t.page.click('[data-bid="a1"] .ans-check');
    await t.waitFor(async () => (await outs()).length > before && (await outs()).some((o) => /a1/.test(o.text) && /对/.test(o.text)), { timeout: 8000, what: '预案接住的作答也写进 ext_out' });
    // 只有草稿：切走时也写
    const before2 = (await outs()).length;
    await typeIn('a2', '7');
    await t.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await t.waitFor(async () => (await outs()).length > before2 && (await outs()).some((o) => /草稿|没交|7/.test(o.text)), { timeout: 4000, what: '切走时只有草稿也写进 ext_out' });
    await t.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
    // 页面正忙（写 ext_out 慢）时外部写进来的一轮不丢
    await t.page.evaluate(() => window.LAKitDev.slowWrites(2500));
    await typeIn('a2', '\b\b6'); await t.page.click('[data-bid="a2"] .ans-check');
    await sleep(1700);
    await plantLive(t, { [`sessions/${sid}/ext_in/003`]: { seq: 3, text: `第三块。\n\n${F4}board add id=b3 title="第三块"\n这是第三块。\n${F4}\n`, at: Date.now() } });
    await t.waitFor(() => t.page.evaluate(() => /这是第三块/.test(document.body.innerText)), { timeout: 20000, what: '页面忙的时候到的 ext_in 也画上板' });
    await t.page.evaluate(() => window.LAKitDev.slowWrites(0));
    // 点「下课」：不调用页面自己的模型，照直接下课
    const calls0 = await t.page.evaluate(() => (window.LAKitEval?.teacher?.calls || []).length);
    await t.page.click('.cb-more'); await sleep(300); await t.page.click('.cb-end'); await sleep(300); await t.page.click('.cb-end').catch(() => {});
    await t.answer('下课').catch(() => {});
    const s = await t.waitFor(async () => { const x = (await db())[`sessions/${sid}`]; return x?.status === 'closed' ? x : null; }, { timeout: 15000, what: '点下课以后这节课下课' });
    const calls1 = await t.page.evaluate(() => (window.LAKitEval?.teacher?.calls || []).filter((c) => c.kind !== 'coach').length);
    const calls0b = calls0 - (await t.page.evaluate(() => (window.LAKitEval?.teacher?.calls || []).filter((c) => c.kind === 'coach').length));
    check(calls1 <= calls0b, `外部的课点下课调用了页面自己的模型（${calls1 - calls0b} 次）`);
    check(s.kind === 'ext', '下课以后 kind 变了');
    return t;
  },

  // 计划 2（检验，check/）：外部写 board check → 合书、构造题错三次（retry 用完）、recall 先做下一道判回来插补讲、刷新接着做、
  // 连点两下「交」只记一次、做完写吸收、最后没过的记错题、ext_out 开始和做完各一份
  async check(browser) {
    const t = await seeded(browser);
    const today = await todayIn(t);
    const sid = `c-${today.replace(/-/g, '')}-7`;
    const db = () => t.db();
    await plant(t, {
      [`sessions/${sid}`]: { date: today, kind: 'ext', status: 'open', block: 'L2.1.4', title: '外部（检验）', space: 'math', startedAt: Date.now() },
      [`sessions/${sid}/ext_in/001`]: { seq: 1, text: `先讲一句。\n\n\`\`\`\`board new id=b1 title="可交换"\n板上的字。\n\`\`\`\`\n\n${DEV_CHECK}\n`, at: Date.now() },
    });
    await t.open(sid);
    await t.waitFor(() => t.page.$('.ck-start'), { timeout: 20000, what: '检验的开始卡画出来' });
    // 审查 6：开始卡停着时刷新，检验照样在
    await sleep(500);
    await t.open(sid);
    await t.waitFor(() => t.page.$('.ck-start'), { timeout: 20000, what: '开始卡停着时刷新，检验照样在' });
    const in1 = (await db())[`sessions/${sid}/ext_in/001`];
    check(in1?.result?.ops?.some((o) => o.op === 'check' && o.ok), `ext_in 的回报里没有 check：${JSON.stringify(in1?.result?.ops)}`);
    const probes = Object.keys(await db()).filter((k) => k.startsWith('probes/pr-'));
    check(probes.length === 18, `题库里应有 18 道（6 道 + 各 2 道同构），有 ${probes.length}`);
    await t.page.click('.ck-start');
    check(await t.page.evaluate(() => document.body.classList.contains('is-checking') && getComputedStyle(document.querySelector('.class-pages')).display === 'none'), '开始以后板书没收起来（合书）');
    const fill = async (vals) => { const cells = await t.page.$$('.ck-card .mi-cell'); for (let i = 0; i < vals.length; i++) await cells[i].fill(String(vals[i])); };
    const sure = (k = 'sure') => t.page.click(`.ck-sure-btn[data-sure="${k}"]`);
    const card = () => t.page.evaluate(() => { const c = document.querySelector('.ck-teach, .ck-done, .ck-probe'); return c ? (c.classList.contains('ck-teach') ? 'teach' : c.classList.contains('ck-done') ? 'done' : c.dataset.probe) : ''; });
    // p1 构造：两次都写成相等的，第三次想不出来（retry 用完 → 未吸收、记错题）
    for (let i = 0; i < 2; i++) {
      await t.waitFor(async () => /^p1/.test(await card()), { timeout: 8000, what: `第 ${i + 1} 次的构造题` });
      await sure(); await fill([1, 0, 0, 1, 1, 0, 0, 1]);
      await sleep(500);
      await t.page.click('.ck-submit');
      await t.waitFor(async () => (await card()) === 'teach', { timeout: 8000, what: '构造题错了出补讲' });
      check(/这两个相等了/.test(await t.text('.ck-teach')), '补讲没写那一条自己的话');
      await sleep(500); // 换屏以后马上的那一下点不算（连点防误触）
      await t.page.click('.ck-next');
    }
    // 审查 3：想不出来、外部没写 giveup / default → 页面里的 Claude 写补讲，写回来要显示出来
    await t.waitFor(async () => (await card()) === 'p1b', { timeout: 8000, what: '第三次的构造题' });
    await sleep(500);
    await t.page.click('.ck-giveup');
    await t.waitFor(async () => /模拟补讲/.test(await t.text('.ck-teach') || ''), { timeout: 10000, what: '页面里的 Claude 写的补讲显示出来' });
    await sleep(500);
    await t.page.click('.ck-next');
    // p2 全过程（solve）：打字交整道题，页面里的 Claude 逐步判（模拟的都对）
    await t.waitFor(async () => (await card()) === 'p2', { timeout: 8000, what: '全过程那一道' });
    await t.page.fill('.ck-card .ck-text', '|-3A^T| = (-3)^3 |A^T| = -27 · (-2) = 54'); await sure();
    await sleep(500);
    await t.page.click('.ck-submit');
    // p3 recall：写「错」（模拟判没写到）；连点两下「交」
    await t.waitFor(async () => (await card()) === 'p3', { timeout: 8000, what: 'recall 那一道' });
    await t.page.fill('.ck-card .ck-text', '我写错了：(A+B)^2=A^2+2AB+B^2'); await sure('maybe');
    await sleep(500);
    await t.page.dblclick('.ck-submit');
    // 在判的时候刷新：接着做（在判的那道重判一次）
    await sleep(300);
    await t.open(sid);
    await t.waitFor(async () => !!(await card()), { timeout: 20000, what: '刷新以后检验接着做' });
    // 照现在出来的是什么一道一道往下做，直到结束
    // Apple Pencil 写两行、划掉第一行（合成 pointerType: pen 的事件）
    const penWrite = async () => {
      await t.page.click('.ck-card .ck-tab[data-tab="hand"]');
      await t.page.waitForSelector('.ck-card .ck-pad-area canvas');
      const line = (x0, y, n = 6) => t.page.evaluate(({ x0, y, n }) => {
        const c = document.querySelector('.ck-card .ck-pad-area canvas');
        const r = c.getBoundingClientRect();
        const ev = (type, x) => c.dispatchEvent(new PointerEvent(type, { pointerType: 'pen', pointerId: 7, clientX: r.left + x, clientY: r.top + y, pressure: 0.5, bubbles: true, cancelable: true }));
        ev('pointerdown', x0);
        for (let i = 1; i <= n; i++) ev('pointermove', x0 + i * 12);
        ev('pointerup', x0 + n * 12);
      }, { x0, y, n });
      await line(20, 40); await line(120, 44); await line(20, 120); await line(120, 118);
      await t.page.click('.ck-card .ck-pad-strike');
      await line(10, 42, 20);
      await t.page.click('.ck-card .ck-pad-step');
      await sure();
    };
    // 用过 Pencil 以后写字的地方默认是手写：打字的先点「打字」
    const typeIn = async (text) => { const tab = await t.page.$('.ck-card .ck-tab[data-tab="type"]'); if (tab) await tab.click(); await t.page.fill('.ck-card .ck-text', text); };
    const answerNow = async (id) => {
      if (id === 'p3a') await penWrite();
      else if (/^p2/.test(id)) { await typeIn('|-3A^T| = (-3)^3 |A^T|（|kA| = k^n|A|）= -27 · |A|（|A^T| = |A|）= -27 · (-2) = 54'); await sure(); }
      else if (/^p3/.test(id)) { await typeIn('(A+B)^2=A^2+AB+BA+B^2，AB=BA 时才能并'); await sure(); }
      else if (/^p5/.test(id)) { await t.page.click('.ck-pick[data-v="false"]'); await fill([1, 0, 0, 0, 0, 1, 1, 0]); await sure(); }
      else if (/^p6/.test(id)) {
        await t.page.click('.ck-line[data-n="2"]'); await typeIn('AB 和 BA 不一定相等'); await sure();
        // 审查 15：先停下、接着做，打的字还在；审查（升格）：「接着做」至少 44px
        await t.page.click('.ck-pause');
        await t.waitFor(() => t.page.$('.ck-strip .btn'), { timeout: 5000, what: '停下以后有「接着做」' });
        check(await t.page.$eval('.ck-strip .btn', (b) => b.getBoundingClientRect().height) >= 44, '「接着做」不到 44px');
        await t.page.click('.ck-strip .btn');
        await t.waitFor(() => t.page.$('.ck-card .ck-locate'), { timeout: 5000, what: '接着做回到 locate' });
        check(await t.page.$eval('.ck-card .ck-text', (x) => x.value) === 'AB 和 BA 不一定相等', '先停下再接着做，打的字没了');
        // 审查 8：写证据失败一次也不丢（自己重试）
        await t.page.evaluate(() => window.LAKitDev.failWrites(1, 'evidence/'));
      }
      else if (/^p7/.test(id)) { await t.page.click('.ck-pick[data-v="true"]'); await typeIn('E 和任何方阵可交换'); await t.page.fill('.ck-card .fi-text', 'E+5A'); await sure(); }
      await sleep(500);
      await t.page.click('.ck-submit');
    };
    for (let n = 0; n < 20; n++) {
      const c = await card();
      if (c === 'done') break;
      if (c === 'teach') await t.page.click('.ck-next');
      else if (c) await answerNow(c);
      await sleep(400);
    }
    await t.waitFor(async () => (await card()) === 'done', { timeout: 30000, what: '检验做完了' });
    const all = await t.waitFor(async () => { const d = await db(); return d['absorb/L2.1.1'] && d['absorb/L2.1.4'] ? d : null; }, { timeout: 15000, what: '吸收写进去了' });
    check(all['absorb/L2.1.1'].state === '未' && all['absorb/L2.1.1'].checked === false, `L2.1.1 应是「未」：${JSON.stringify(all['absorb/L2.1.1'].state)}`);
    check(['部分', '待核'].includes(all['absorb/L2.1.4'].state), `L2.1.4：${all['absorb/L2.1.4'].state}`);
    check(all['absorb/L2.1.4'].retests?.length === 2, '没排两次复测');
    const evs = Object.values(all).filter((d) => d?.src === 'check' && d.session === sid);
    check(evs.filter((e) => e.probe === 'p3' && !e.rejudged).length === 1, `p3 记了 ${evs.filter((e) => e.probe === 'p3').length} 条证据（连点两下应只有一条）`);
    check(evs.some((e) => e.probe === 'p1' && e.final === 'fail'), 'p1 的证据没写 final: fail');
    // 手写的那一道：证据带整页图、时间线（有划掉），笔画存了一份给回放
    const inkEv = evs.find((e) => e.probe === 'p3a');
    check(inkEv?.ink?.final && /划掉 L1/.test(inkEv.ink.timeline || '') && inkEv.ink.shots?.length >= 1, `手写的证据不全：${JSON.stringify(inkEv?.ink)}`);
    check(all[`sessions/${sid}/ink/k1-p3a`]?.s?.length === 4, '笔画没存给回放');
    const outsNow = async () => Object.entries(await db()).filter(([k]) => k.startsWith(`sessions/${sid}/ext_out/`)).map(([, v]) => v.text).join('\n');
    const err = await t.waitFor(async () => Object.entries(await db()).find(([k, v]) => k.startsWith('errors/') && v?.check === 'k1' && v?.probe === 'p1'), { timeout: 10000, what: 'retry 用完的那道记进错题本' })
      .catch(async (e) => { throw new Error(`${e.message}；ext_out 里：${(await outsNow()).split('\n').filter((l) => /错题本|检验/.test(l)).join(' / ').slice(0, 600)}`); });
    check(err[1].target === 'L2-14', `错题的 target：${err[1].target}`);
    // 走的是 memo 那条路：有一张改动单（「管理 → 最近记下的」照它列、能撤销）
    const eid = err[0].split('/')[1];
    check(Object.entries(await db()).some(([k, v]) => k.startsWith('pending/') && v?.coll === 'errors' && v?.target === eid && v?.status === 'done'), `错题 ${eid} 没有改动单（撤不了）`);
    check(!Object.entries(await db()).some(([k, v]) => k.startsWith('errors/') && v?.check === 'k1' && v?.probe === 'p3'), '补上了的 p3 不该记错题');
    check((await db())[`sessions/${sid}/check/k1`]?.state?.phase === 'done', '进度里不是 done');
    const outs = Object.entries(await db()).filter(([k]) => k.startsWith(`sessions/${sid}/ext_out/`)).map(([, v]) => v.text).join('\n');
    check(/检验 k1「第二讲第一节」开始/.test(outs) && /检验 k1 做完了/.test(outs), 'ext_out 没写开始、做完');
    // 审查 4：结束一屏还开着时外部改判（p5 判成没过）：吸收重算；板上同名的解答题照旧给板上的（审查升格：board judge 分流）
    await plantLive(t, { [`sessions/${sid}/ext_in/002`]: { seq: 2, text: `改判。\n\n\`\`\`\`board judge target=p5\nresult=fail\n\`\`\`\`\n`, after: 1, at: Date.now() } });
    await t.waitFor(async () => (await db())['absorb/L2.1.4']?.state === '未', { timeout: 15000, what: '结束一屏开着时外部改判，吸收重算' });
    await t.page.click('.ck-back');
    check(await t.page.evaluate(() => !document.body.classList.contains('is-checking') && /板上的字/.test(document.body.innerText)), '回到黑板以后板书没放回来');
    // 板上同一个 id 的解答题（计划 1 的 solve，p2）：board judge 给板上的，不给检验里的 p2
    const SOLVE = '```solve\nid: p2\nq: 板上的一道\nsteps:\ns1 calc: 54\njudge: ext\n```';
    await plantLive(t, { [`sessions/${sid}/ext_in/003`]: { seq: 3, text: `板上一道。\n\n\`\`\`\`board add id=b3 title="板上的解答题"\n${SOLVE}\n\`\`\`\`\n\n\`\`\`\`board judge target=p2\ns1 ok\n\`\`\`\`\n`, after: 2, at: Date.now() } });
    await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/003`]?.done, { timeout: 15000, what: 'ext_in/003 执行' });
    await sleep(1500);
    check(!Object.values(await db()).some((d) => d?.src === 'check' && d.probe === 'p2' && d.rejudged), 'board judge 被检验抢走了（板上有同名的解答题）');
    // 「以前的课」里这节课：检验那一节、手写的题能回放
    await t.page.goto(BASE);
    await t.waitFor(async () => (await t.text('.dk-class'))?.includes('开新课'), { timeout: 20000, what: '回到首页' });
    await t.route(`#classes/${sid}`);
    await t.waitFor(() => t.page.$('[data-ckreplay]'), { timeout: 20000, what: '以前的课里有「回放手写」' });
    check(/吸收：未/.test(await t.text('.dk-shell') || await t.page.evaluate(() => document.body.innerText)), '以前的课里没写吸收');
    await t.page.click('[data-ckreplay]');
    await t.waitFor(() => t.page.$('.ck-replay canvas'), { timeout: 8000, what: '回放画出来' });
    await check408(t, today);
    await checkEn(t, today);
    return t;
  },

  // 计划 2（审查 7）：检验开着时下课：交了还没定下来的题补写证据，ext_out 写「先停下了」
  async checkclose(browser) {
    const t = await seeded(browser);
    const today = await todayIn(t);
    const sid = `c-${today.replace(/-/g, '')}-6`;
    await plant(t, {
      [`sessions/${sid}`]: { date: today, kind: 'ext', status: 'open', block: 'L2.1.4', title: '外部（检验下课）', space: 'math', startedAt: Date.now() },
      [`sessions/${sid}/ext_in/001`]: { seq: 1, text: `检验。\n\n${DEV_CHECK}\n`, at: Date.now() },
    });
    await t.open(sid);
    await t.waitFor(() => t.page.$('.ck-start'), { timeout: 20000, what: '开始卡' });
    await sleep(500);
    await t.page.click('.ck-start');
    await t.waitFor(() => t.page.$('.ck-card .mi-cell'), { timeout: 8000, what: '第一道' });
    const cells = await t.page.$$('.ck-card .mi-cell');
    for (let i = 0; i < 8; i++) await cells[i].fill(String([1, 0, 0, 1, 1, 0, 0, 1][i]));
    await t.page.click('.ck-sure-btn[data-sure="sure"]');
    await sleep(500);
    await t.page.click('.ck-submit');
    await t.waitFor(() => t.page.$('.ck-teach'), { timeout: 8000, what: '补讲' });
    // 下课（外部的课：点两下「下课」）
    await t.page.click('.cb-more'); await sleep(300); await t.page.click('.cb-end'); await sleep(300); await t.page.click('.cb-end').catch(() => {});
    await t.answer('下课').catch(() => {});
    await t.waitFor(async () => (await t.db())[`sessions/${sid}`]?.status === 'closed', { timeout: 15000, what: '下课' });
    const all = await t.waitFor(async () => { const d = await t.db(); return Object.values(d).some((x) => x?.src === 'check' && x.session === sid && x.probe === 'p1') ? d : null; }, { timeout: 10000, what: '下课时补写了 p1 的证据' });
    const ev = Object.values(all).find((x) => x?.src === 'check' && x.probe === 'p1');
    check(ev.partial === true && ev.outcome === 'fail', `补写的证据不对：${JSON.stringify({ partial: ev.partial, outcome: ev.outcome })}`);
    const outs = Object.entries(all).filter(([k]) => k.startsWith(`sessions/${sid}/ext_out/`)).map(([, v]) => v.text).join('\n');
    check(/检验 k1 先停下了/.test(outs), 'ext_out 没写「先停下了」');
    return t;
  },

  // 计划 2：检验以后 1 天的复测。首页「复测」那一行 → 开 kind: check 的课 → 题库里没见过的同类题（不挑那次检验的 retry）→ 做完写 retests.done、题库记见过
  async retest(browser) {
    const t = await seeded(browser);
    const today = await todayIn(t);
    const sample = parseCheck(DEV_CHECK_HEAD, DEV_CHECK_BODY).check;
    const bank = bankDocs(sample, { session: 'c-20261101-1', at: Date.now() });
    const docs = Object.fromEntries(bank.map(({ id, doc }) => [`probes/${id}`, doc]));
    // 本题 p3 见过了：复测要挑同一类（L2.1.4/L2-56）里没见过的
    const p3 = bank.find((b) => b.doc.from.as === 'probe' && /展开/.test(b.doc.fence)).id;
    docs[`probes/${p3}`] = { ...docs[`probes/${p3}`], seen: [{ at: 1, session: 'c-20261101-1', as: 'first' }] };
    docs['absorb/L2.1.4'] = { block: 'L2.1.4', space: 'math', state: '部分', checked: false, by: 'page', check: 'k1', session: 'c-20261101-1', date: '2026-11-01', families: ['L2.1.4/L2-56'], retests: [{ days: 1, due: today, done: null }, { days: 7, due: '2099-01-01', done: null }], log: [{ date: '2026-11-01', by: 'page', field: 'state', from: null, to: '部分' }, { date: '2026-11-01', by: 'page', field: 'checked', from: null, to: false }] };
    await plant(t, docs);
    await t.page.reload();
    await t.waitFor(() => t.page.$('.dk-trow[data-row="retest"]'), { timeout: 15000, what: '首页出现「复测」那一行' });
    await t.page.click('.dk-trow[data-row="retest"]');
    await t.waitFor(() => t.page.$('.dk-retest-go'), { timeout: 8000, what: '复测面板有「开始」' });
    await t.page.click('.dk-retest-go');
    await t.page.waitForURL((u) => /#c-\d{8}-\d+/.test(u.hash), { timeout: 20000 });
    const sid = decodeURIComponent(new URL(t.page.url()).hash.slice(1));
    await t.waitFor(() => t.page.$('.ck-start'), { timeout: 20000, what: '复测的检验画出来' });
    const s0 = (await t.db())[`sessions/${sid}`];
    check(s0?.kind === 'check' && s0.items?.length === 1 && s0.items[0] !== p3, `复测挑的题不对：${JSON.stringify(s0?.items)}`);
    await t.page.click('.ck-start');
    // 挑到的是同一类的 locate（p6）
    await t.waitFor(() => t.page.$('.ck-locate'), { timeout: 8000, what: '复测的题是 locate' });
    await t.page.click('.ck-line[data-n="2"]');
    const tab = await t.page.$('.ck-card .ck-tab[data-tab="type"]'); if (tab) await tab.click();
    await t.page.fill('.ck-card .ck-text', 'AB 和 BA 不一定相等');
    await t.page.click('.ck-sure-btn[data-sure="sure"]');
    await sleep(500);
    await t.page.click('.ck-submit');
    await t.waitFor(() => t.page.$('.ck-done'), { timeout: 20000, what: '复测做完' });
    const all = await t.waitFor(async () => { const d = await t.db(); return d['absorb/L2.1.4']?.retests?.[0]?.done ? d : null; }, { timeout: 10000, what: '复测的结果写进 absorb' });
    check(all['absorb/L2.1.4'].retests[0].ok === true, `复测应过了：${JSON.stringify(all['absorb/L2.1.4'].retests[0])}`);
    check(all['absorb/L2.1.4'].state === '部分', '复测不该改吸收');
    const ev = Object.values(all).find((d) => d?.src === 'check' && d.session === sid);
    check(ev?.retest === 1 && /^pr-/.test(ev.bank || ''), `复测的证据没带 retest、bank：${JSON.stringify({ retest: ev?.retest, bank: ev?.bank })}`);
    check(all[`probes/${ev.bank}`]?.seen?.some((x) => x.as === 'retest'), '题库没记见过');
    check(all[`sessions/${sid}`]?.status === 'closed', '复测的课没关');
    return t;
  },

  // 第十五轮：练习教练。主讲在 meta/today 里排一项 coach，首页出这一行，点开是页面里的老师带的课，资料包里有主讲写的
  async coach(browser) {
    const t = await seeded(browser);
    const today = await t.page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
    await plant(t, { 'meta/today': { date: today, items: [{ kind: 'coach', block: 'L2.2.2', why: '到期了', focus: '把 AB 写成 BA' }] } });
    await t.open();
    await t.waitFor(() => t.page.$('.dk-crow[data-ckind="coach"]'), { timeout: 15000, what: '首页出现主讲排的练习那一行' });
    // 页面算的事实、学习台里有什么：首页写好给外部读
    const facts = await t.waitFor(async () => (await t.db())['meta/facts'], { what: '首页写 meta/facts' });
    check(facts.today === today && facts.spaces?.math, `meta/facts 不对：${JSON.stringify(facts).slice(0, 200)}`);
    check(/meta\/today/.test((await t.db())['meta/catalog']?.text || ''), 'meta/catalog 里没有「学习台里有什么」');
    await t.page.click('.dk-crow[data-ckind="coach"]');
    const sid = await t.inClass();
    const pk = (await t.db())[`sessions/${sid}/pack/main`];
    check(pk?.block === 'L2.2.2' && /把 AB 写成 BA/.test(pk?.coach || ''), `练习课的资料包里没有主讲写的：${JSON.stringify(pk)}`);
    check((await t.docs('sessions')).find((x) => x.id === sid)?.kind !== 'ext', '练习教练的课开成了外部的课');
    return t;
  },

  // 第十五轮：外部主 Claude 的课（kind: ext）。外部写 ext_in，页面画上板、写 done；学生作答页面写 ext_out；
  // 写错的进下一份 ext_out 最前面；board snap 带截图；board close 下课；刷新只放回不重复执行
  async ext(browser) {
    const t = await seeded(browser);
    const F4 = '````', F3 = '```';
    const today = await t.page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
    const sid = `c-${today.replace(/-/g, '')}-9`;
    const quiz = (id) => `${F3}quiz\nid: ${id}\nq: AB 和 BA 一定相等吗？\n- [ ] 一定相等\n- [x] 不一定\n${F3}`;
    const turn1 = `我们从可交换开始。\n\n${F4}board new id=b1 title="可交换"\n先想一想：\n\n${quiz('q1')}\n${F4}\n`;
    await plant(t, {
      [`sessions/${sid}`]: { date: today, kind: 'ext', status: 'open', block: 'L2.1.4', title: '可交换（外部）', space: 'math', startedAt: Date.now() },
      [`sessions/${sid}/ext_in/001`]: { seq: 1, text: turn1, model: 'claude-opus-5-5', said: '我们从可交换开始吧', at: Date.now() },
    });
    await t.open(sid);
    await t.waitFor(() => t.page.$('.block-quiz .q-opt'), { timeout: 20000, what: '外部写的第一轮画上板' });
    const db = async () => t.db();
    check((await db())[`sessions/${sid}/ext_in/001`]?.done, 'ext_in/001 执行完没写 done');
    // 选择题判完了才记（先错后对）：记下来的那一条带着错过的选项
    await t.page.click('.block-quiz .q-opt:has-text("一定相等")');
    await t.page.click('.block-quiz .q-opt:has-text("不一定")');
    const out1 = await t.waitFor(async () => (await db())[`sessions/${sid}/ext_out/001`], { timeout: 10000, what: '作答以后写 ext_out/001' });
    check(/作答/.test(out1.text) && /q1/.test(out1.text), `ext_out/001 里没有那一行作答：${out1.text.slice(0, 200)}`);
    check((await t.docs('evidence')).some((e) => e.session === sid && e.src === 'say' && /从可交换开始/.test(e.text || '')), '外部抄进来的学生原话没记成证据');
    // 第二轮：一段写错的组件 + board snap
    const turn2 = `再看一个。\n\n${F4}board add id=b2 title="写错的"\n${F3}scene\ncircle 0 0 r=2 lol\n${F3}\n${F4}\n\n${F4}board add id=b3 title="再一题"\n${quiz('q2')}\n${F4}\n\n${F4}board snap\n${F4}\n`;
    await plantLive(t, { [`sessions/${sid}/ext_in/002`]: { seq: 2, text: turn2, after: 1, at: Date.now() } });
    await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/002`]?.done, { timeout: 15000, what: 'ext_in/002 执行' });
    // 切到 claude.ai（分屏）：手上排着的马上写掉
    await t.waitFor(() => t.page.$('[data-bid="q2"] .q-opt'), { timeout: 10000, what: '第二轮的题画上板' });
    await t.page.click('[data-bid="q2"] .q-opt:has-text("不一定")');
    await t.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    // 不等 1.5 秒的合并：切走就马上写
    const out2 = await t.waitFor(async () => (await db())[`sessions/${sid}/ext_out/002`], { timeout: 1200, what: '切到后台以后马上写 ext_out/002' });
    check(/b2/.test(out2.text.split('\n')[0]), `写错的那段没排在 ext_out/002 最前面：${out2.text.slice(0, 160)}`);
    check(Array.isArray(out2.shots) && out2.shots.length > 0, 'board snap 以后 ext_out/002 没带截图');
    // 课上整页刷新：已经执行过的只放回，不再执行一遍
    const nTurns = async () => Object.keys(await db()).filter((k) => k.startsWith(`sessions/${sid}/class_turns/`)).length;
    const before = await nTurns();
    await t.open(sid);
    await t.waitFor(() => t.page.$('.block-quiz .q-opt'), { timeout: 20000, what: '刷新以后板放回来' });
    await sleep(1500);
    check(await nTurns() === before, `刷新以后又执行了一遍 ext_in（class_turns ${before} → ${await nTurns()}）`);
    // 第三轮：开了板边助教的一题，学生做错，助教写一句（只在这一题）
    const ans = `${F3}answer\nid: a1\nq: 2+2 等于几？\nanswer: 4\n${F3}`;
    await plantLive(t, { [`sessions/${sid}/ext_in/003`]: { seq: 3, text: `算一下。\n\n${F4}board add id=b4 title="算一下"\n${ans}\n${F4}\n\n${F4}board coach target=a1 upto=只提示看清是加法\n${F4}\n`, after: 2, at: Date.now() } });
    await t.waitFor(() => t.page.$('[data-bid="a1"] .ans-check'), { timeout: 15000, what: '第三轮的题画上板' });
    const box = t.page.locator('[data-bid="a1"] .ans-input input, [data-bid="a1"] .ans-input textarea, [data-bid="a1"] .ans-input [contenteditable="true"]').first();
    await box.click(); await t.page.keyboard.type('5'); await t.page.click('[data-bid="a1"] .ans-check');
    await t.waitFor(() => t.page.evaluate(() => /助教：模拟助教/.test(document.body.innerText)), { timeout: 15000, what: '做错以后板上出现助教那一句' });
    await t.waitFor(async () => Object.entries(await db()).some(([k, v]) => k.startsWith(`sessions/${sid}/ext_out/`) && /\[助教\] 在 a1 下面写了/.test(v.text)), { timeout: 8000, what: '助教那一句写进 ext_out' });
    // 第四轮：下课
    await plantLive(t, { [`sessions/${sid}/ext_in/004`]: { seq: 4, text: `今天就到这里。\n\n${F4}board close\n${F4}\n`, after: 3, at: Date.now() } });
    const s = await t.waitFor(async () => { const x = (await db())[`sessions/${sid}`]; return x?.status === 'closed' && x.report?.at ? x : null; }, { timeout: 20000, what: 'board close 以后下课、出报告' });
    check(s.kind === 'ext', `下课以后 kind 被盖成了 ${s.kind}`);
    // 故意写错的那一行：渲染时控制台照例报一次（课堂里写错的组件都这样），不算页面出错
    t.errors.splice(0, t.errors.length, ...t.errors.filter((e) => !/看不懂这一行：circle 0 0 r=2 lol/.test(e)));
    const rep = (await db())[`sessions/${sid}/report/main`];
    check(rep?.ext?.n >= 2, `报告里的来回时间不对：${JSON.stringify(rep?.ext)}`);
    return t;
  },


  // 外部主讲的操控权（dev_requests/dr-ext-control）：截图入口关着（R11）、执行完当场回报和 meta/now（R3）、
  // board claude 答错时叫页面里的 Claude、越权的不执行、停掉助手（R1）、预案收 wrong match=（R6）、ext_jobs 后台活和 from=（R2）、
  // board edit 改字不丢作答（R9）、一轮两块新板（R7）、指以前的板（R8）、预备板「下一块」（R7）、叫主讲（R10）
  async extctl(browser) {
    const t = await seeded(browser);
    const F4 = '````', F3 = '```';
    const today = await t.page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
    const sid = `c-${today.replace(/-/g, '')}-8`;
    const db = async () => t.db();
    const ans = (id, q, a) => `${F3}answer\nid: ${id}\nq: ${q}\nanswer: ${a}\n${F3}`;
    const turn1 = [
      '先做两题。',
      `${F4}board new id=b1 title="第一题"\n第一题先算：\n\n${ans('q1', '2+3 等于几？', '5')}\n\n${ans('q2', '3+4 等于几？', '7')}\n${F4}`,
      `${F4}board claude id=cl1 on=wrong target=q1 turns=2\nsee: target, board\ncan: say, mark\n<<<\n学生错了就指出看哪一步，一句话。\n>>>\n${F4}`,
      `${F4}board react target=q2\nwrong match="12": 是不是把加号看成乘号了？\nwrong: 再算一遍。\n${F4}`,
      `${F4}board queue id=b9 title="预备的一块" after=button\n预备好的下一块板。\n${F4}`,
      `${F4}board snap\n${F4}`,
    ].join('\n\n');
    await plant(t, {
      [`sessions/${sid}`]: { date: today, kind: 'ext', status: 'open', block: 'L2.1.4', title: '操控权（外部）', space: 'math', startedAt: Date.now() },
      [`sessions/${sid}/ext_in/001`]: { seq: 1, text: turn1, at: Date.now() },
    });
    await t.open(sid);
    await t.waitFor(() => t.page.$('[data-bid="q1"] .ans-check'), { timeout: 20000, what: '外部的第一轮画上板' });
    // R3：执行完当场写结果、截图；meta/now 有黑板现状
    const r1 = await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/001`]?.result, { timeout: 10000, what: 'ext_in/001 写 result' });
    check(r1.ok && r1.ops.some((o) => o.op === 'claude' && o.ok) && r1.ops.some((o) => o.op === 'queue' && o.ok), `result 不对：${JSON.stringify(r1).slice(0, 300)}`);
    check(Array.isArray(r1.shots) && r1.shots.length === 1 && /整块板一张/.test(r1.shotNote || ''), `board snap 以后 result 里不是一张长图：${JSON.stringify({ n: r1.shots?.length, note: r1.shotNote })}`);
    const now = await t.waitFor(async () => (await db())[`sessions/${sid}/meta/now`], { timeout: 8000, what: '写 meta/now' });
    check(/q1/.test(now.text) && Array.isArray(now.board?.segs), `meta/now 不对：${String(now.text).slice(0, 200)}`);
    // R11：外部的课里组件下面没有截图入口
    check(!(await t.page.$('[data-bid="q1"] .ph-btn')), '外部的课里 answer 下面还有「截图作答」');
    const type = async (id, v) => { const box = t.page.locator(`[data-bid="${id}"] .ans-input input, [data-bid="${id}"] .ans-input textarea, [data-bid="${id}"] .ans-input [contenteditable="true"]`).first(); await box.click(); await box.fill?.('').catch(() => {}); await t.page.keyboard.type(v); await t.page.click(`[data-bid="${id}"] .ans-check`); };
    const outs = async () => Object.entries(await db()).filter(([k]) => k.startsWith(`sessions/${sid}/ext_out/`)).map(([, v]) => v.text).join('\n');
    // R1：q1 答错 → 助手说一句、圈一下；越权的 new 不执行、写进 ext_out
    await type('q1', '6');
    await t.waitFor(() => t.page.evaluate(() => /模拟助手/.test(document.body.innerText)), { timeout: 15000, what: '答错以后板上出现助手的话' });
    await t.waitFor(async () => /\[助手 cl1\]/.test(await outs()) && /没执行（越权）：new hb9/.test(await outs()), { timeout: 10000, what: '助手的全文和越权的写进 ext_out' });
    // dr-ext-round2：ext_out 只写增量（黑板现状在 meta/now）；meta/since 攒着 ext_in/001 执行完以后的全部
    check(!/黑板现在是第/.test(await outs()), 'ext_out 里还在重写黑板现状');
    const since = await t.waitFor(async () => { const x = (await db())[`sessions/${sid}/meta/since`]; return x && /助手 cl1/.test(x.text) ? x : null; }, { timeout: 8000, what: 'meta/since 攒着新的事' });
    check(since.from === '001', `meta/since 从哪一条算起不对：${since.from}`);
    check(!(await t.page.$('[data-step="hb9"]')), '越权的 board new 被执行了');
    // 停掉助手：再答错也不叫
    await t.page.click('.class-ext-btn[data-act="stop"]');
    const nHelp = (await outs()).split('[助手 cl1]').length;
    await type('q1', '7');
    await sleep(3500);
    check((await outs()).split('[助手 cl1]').length === nHelp, '停掉助手以后还在叫');
    check((await db())[`sessions/${sid}`]?.helperOff === true, '停掉助手没记进这节课');
    // R6：预写的答错按 match= 当场接（不调用）
    await type('q2', '12');
    await t.waitFor(() => t.page.evaluate(() => /把加号看成乘号/.test(document.body.innerText)), { timeout: 8000, what: '预写的答错当场接' });
    // R2：后台活跑完、结果写进 out、记 journal；from= 直接上板
    await plantLive(t, { 'ext_jobs/j1': { prompt: '改编一道加法题', see: [`sessions/${sid}`], out: 'drafts/j1', at: Date.now() } });
    const out = await t.waitFor(async () => (await db())['drafts/j1'], { timeout: 20000, what: '后台活的结果写进 drafts/j1' });
    check(/job-q1/.test(out.text) && out.by === 'ext-delegate', `后台活的结果不对：${JSON.stringify(out).slice(0, 200)}`);
    check((await db())['ext_jobs/j1']?.status === 'done', '后台活没写 done');
    check((await t.docs('journal')).some((j) => j.by === 'ext-delegate' && j.path === 'drafts/j1'), '后台活写进学习台没记 journal');
    // R9：改字不丢作答（q1 上的作答还在）；R2 from=；R7 一轮两块新板
    const turn2 = [
      `${F4}board edit id=b1\n<<<\n第一题先算\n===\n第 1 题先算\n>>>\n${F4}`,
      `${F4}board add id=b5 from=drafts/j1 title="改编的"\n${F4}`,
      `${F4}board new id=b6 title="第二块"\n第二块。\n${F4}`,
      `${F4}board new id=b7 title="第三块"\n第三块。\n${F4}`,
    ].join('\n\n');
    await plantLive(t, { [`sessions/${sid}/ext_in/002`]: { seq: 2, text: turn2, after: 1, at: Date.now() } });
    await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/002`]?.result, { timeout: 15000, what: 'ext_in/002 执行' });
    check(await t.page.evaluate(() => /第 1 题先算/.test(document.querySelector('[data-step="b1"]')?.innerText || '')), 'board edit 没改上字');
    check(await t.page.evaluate(() => { const f = document.querySelector('[data-bid="q1"] .ans-feedback'); return !!f && !f.hidden; }), 'board edit 以后 q1 上的作答没了');
    check(!!(await t.page.$('[data-bid="job-q1"]')), 'from= 的后台活结果没上板');
    check(await t.page.evaluate(() => document.querySelectorAll('.class-page').length >= 3), '一轮两块新板没都开出来');
    // R8：标以前的板（b1 在第 1 块），学生在别的板上：板上方一条，点了过去
    await plantLive(t, { [`sessions/${sid}/ext_in/003`]: { seq: 3, text: `${F4}board mark target=b1 text="第 1 题"\n${F4}`, after: 1, at: Date.now() } });
    await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/003`]?.result?.ok, { timeout: 15000, what: 'ext_in/003 标以前的板执行成' });
    await t.waitFor(() => t.page.$('.class-ext-jump'), { timeout: 5000, what: '标了以前的板，板上方出提醒' });
    await t.page.click('.class-ext-jump');
    check(await t.page.evaluate(() => window.LAKit.classroom.extState().away === 0), '点了提醒以后还挂着');
    // R7：预备板，点「下一块」页面自己开
    await t.page.click('.class-ext-btn[data-act="next"]');
    await t.waitFor(() => t.page.$('[data-step="b9"]:not([hidden])'), { timeout: 10000, what: '点「下一块」开预备板' });
    // R5：board stage（舞台底座，按钮判挑战、没做到演 .wrong）、board widget（la.drag 拖着排、la.goal 记作答）
    const stageBody = ['tex e = "(A+B)(A+B)"', 'array a = BA B² A² AB _ _ _ _', 'array k = A² AB BA B² hide=on', 'open a move',
      'goal g1 "按先后排好四项" when="a.5 = k.1, a.6 = k.2, a.7 = k.3, a.8 = k.4" on="排好了"', '@g1 say "对。"', '@g1.wrong say "再看先后。"', 'ask next "排好了点下面" button="排好了"'].join('\n');
    const widgetBody = "const want = ['$A^2$', '$AB$', '$BA$', '$B^2$'];\nconst d = la.drag({ items: want, slots: 4 });\nla.button('交了', () => la.goal('四项按左右顺序', la.compare(d.order(), want).ok, { value: d.order() }), { primary: true });\nla.md(la.same('AB+BA', '2AB') === false ? '判定：AB+BA 不等于 2AB' : '判定不对');";
    await plantLive(t, { [`sessions/${sid}/ext_in/004`]: { seq: 4, text: `${F4}board new id=b20 title="动手"\n先排一排。\n${F4}\n\n${F4}board stage id=s1 title="排四项"\n${stageBody}\n${F4}\n\n${F4}board widget id=w1 title="拖着排"\n${widgetBody}\n${F4}`, after: 1, at: Date.now() } });
    const r4 = await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/004`]?.result, { timeout: 15000, what: 'ext_in/004 执行' });
    check(r4.ok, `stage / widget 段没画成：${JSON.stringify(r4).slice(0, 400)}`);
    check(await t.page.evaluate(() => /判定：AB\+BA 不等于 2AB/.test(document.querySelector('[data-bid="w1"]')?.innerText || '')), 'widget 里 la.same 的判定不对');
    await t.page.locator('[data-bid="s1"] button:has-text("排好了")').first().click();
    await t.waitFor(async () => /\[作答\][^\n]*stage[^\n]*没做到/.test(await outs()), { timeout: 10000, what: '舞台按钮没做到的作答写进 ext_out' });
    for (let i = 0; i < 4; i++) { await t.page.click(`[data-bid="w1"] .wg-chip[data-k="${i}"]`); await t.page.click(`[data-bid="w1"] .wg-slot[data-i="${i}"]`); }
    await t.page.locator('[data-bid="w1"] button:has-text("交了")').click();
    await t.waitFor(async () => /\[作答\][^\n]*widget[^\n]*「四项按左右顺序」[^\n]*做到了/.test(await outs()), { timeout: 10000, what: 'widget 的作答写进 ext_out' });
    check(/舞台现在/.test((await db())[`sessions/${sid}/meta/now`]?.text || ''), 'meta/now 里没有舞台现状');
    // dr-ext-live-fixes 4：只有一行式子的舞台不再占 420 高
    await plantLive(t, { [`sessions/${sid}/ext_in/005`]: { seq: 5, text: `${F4}board stage id=s2 title="一行式子"\ntex e = "(A+B)^2" alg=on\nopen e expand\n${F4}`, after: 1, at: Date.now() } });
    await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/005`]?.result?.ok, { timeout: 15000, what: 'ext_in/005 执行' });
    const sh = await t.waitFor(async () => { const h = await t.page.evaluate(() => document.querySelector('[data-bid="s2"] .sb-stage')?.offsetHeight || 0); return h && h < 400 ? h : null; }, { timeout: 8000, what: '一行式子的舞台按内容缩' });
    check(sh >= 160, `舞台缩得太矮：${sh}`);
    // dr-trail-fix 3：学生展开过的式子，刷新以后照样是展开的（不回到 (A+B)²）
    const exprOf = () => t.page.evaluate(() => document.querySelector('[data-bid="s2"]')?.__stage?.scene.stateText().split('\n').find((l) => /^\s*现在：/.test(l)) || '');
    const before = await exprOf();
    // 学生点一项展开（舞台的手指走 pointerType: touch；这里照真手指那一下最后交给舞台的那一行走 studentDo，和舞台自己的手指检查一样）
    await t.page.evaluate(async () => { const st = document.querySelector('[data-bid="s2"]').__stage; await st.studentDo('expand e t1', { type: 'expand', obj: 'e', key: 't1', open: 'expand', line: 'expand e t1' }); });
    const after = await t.waitFor(async () => { const x = await exprOf(); return x && x !== before ? x : null; }, { timeout: 8000, what: '点一项展开括号' });
    await t.waitFor(async () => (await db())[`sessions/${sid}/stage_logs/s2`]?.rows?.some((r) => r.by === 'student'), { timeout: 5000, what: '舞台的 log 存进 stage_logs' });
    await t.page.reload();
    await t.page.waitForSelector('[data-bid="s2"] .sb-stage', { timeout: 15000 });
    await t.waitFor(async () => (await exprOf()) === after, { timeout: 10000, what: `刷新以后舞台放回展开过的样子（${after.slice(0, 80)}）` });
    check(!(await t.page.$('[data-bid="s2"] .class-prev')), '舞台放回了还列「刷新前的作答」');
    // dr-batch4 第 1、3 条：解答题交了 → 外部 board judge 逐步判 → 证据、错题本按步骤；预案挂在预备板里的组件上；unqueue
    const solveBody = `${F3}solve\nid: p1\nq: 设 $A=E+B$，$B^2=O$，求 $A^n$。\nsteps:\ns1 setup: 写成 A = E + B\ns2 rule: E 和 B 可交换，用二项式定理\ns3 calc: A^n = E + nB\ns4 conclude: 写出 A^n\n${F3}`;
    const turn6 = [
      `${F4}board new id=b30 title="解答题"\n${solveBody}\n${F4}`,
      `${F4}board queue id=b31 title="预备 1" after=button\n${ans('q31', '1+1 等于几？', '2')}\n${F4}`,
      `${F4}board react target=q31\nwrong: 再数一遍。\n${F4}`,
      `${F4}board queue id=b32 title="预备 2" after=button\n不要了的一块。\n${F4}`,
      `${F4}board unqueue id=b32\n${F4}`,
    ].join('\n\n');
    await plantLive(t, { [`sessions/${sid}/ext_in/006`]: { seq: 6, text: turn6, after: 1, at: Date.now() } });
    const r6 = await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/006`]?.result, { timeout: 15000, what: 'ext_in/006 执行' });
    check(r6.ok && r6.ops.some((o) => o.op === 'react' && o.ok) && r6.ops.some((o) => o.op === 'unqueue' && o.ok), `预备板里的预案 / unqueue 没成：${JSON.stringify(r6.ops).slice(0, 400)}`);
    await t.page.locator('[data-bid="p1"] .sv-text').fill('A^n = E^n + B^n = E + B');
    await t.page.click('[data-bid="p1"] .sv-send');
    await t.waitFor(async () => /交了整道题：打字：「A\^n = E\^n \+ B\^n = E \+ B」/.test(await outs()), { timeout: 10000, what: '解答题交了写进 ext_out' });
    await plantLive(t, { [`sessions/${sid}/ext_in/007`]: { seq: 7, text: `${F4}board judge target=p1\ns1 ok\ns2 unsure why="照片里看不清"\ns3 wrong tag=规则用错 why="把 (E+B)^n 写成 E^n+B^n"\ns4 missing\n${F4}`, after: 1, at: Date.now() } });
    const r7 = await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/007`]?.result, { timeout: 15000, what: 'ext_in/007 执行' });
    check(r7.ops.some((o) => o.op === 'judge' && o.ok), `board judge 没执行：${JSON.stringify(r7.ops)}`);
    const jtxt = await t.page.evaluate(() => [...document.querySelectorAll('[data-bid="p1"] .sv-judged')].map((x) => `${x.hidden}|${x.innerText}`).join(' ## '));
    check(/规则用错/.test(jtxt), `题下面没画出逐步的判定：${jtxt.slice(0, 200)}`);
    const judged = await t.waitFor(async () => (await t.docs('evidence')).find((e) => e.session === sid && e.kind === 'solve' && e.judged), { timeout: 8000, what: '判定记成证据' });
    check(judged.steps?.[1]?.unsure === true && judged.steps[1].ok === null && judged.steps?.[2]?.ok === false && judged.steps[2].tag === '规则用错' && judged.steps[3].ok === 'missing' && /第 2 步 待核/.test(judged.value || ''), `证据里的逐步结论不对：${JSON.stringify(judged.steps)}`);
    const err = await t.waitFor(async () => (await t.docs('errors')).find((e) => e.session === sid && Array.isArray(e.steps)), { timeout: 10000, what: '错题本按步骤记' });
    check(/第 3 步（规则用错）/.test(err.step) && /E\^n\+B\^n/.test(err.cause), `错题本那一条不对：${JSON.stringify(err).slice(0, 300)}`);
    await t.waitFor(async () => /\[页面\] 解答题 p1：错题本记了/.test(await outs()), { timeout: 10000, what: '错题本记了写进 ext_out' });
    // R10：叫主讲 → 马上写一份，最前面「学生在等你」
    await t.page.click('.class-ext-btn[data-act="call"]');
    await t.waitFor(async () => Object.entries(await db()).some(([k, v]) => k.startsWith(`sessions/${sid}/ext_out/`) && /^学生在等你/.test(v.text)), { timeout: 5000, what: '叫主讲写 ext_out' });
    return t;
  },

  // 每一步都有记录、每一条都被分析（dev_requests/dr-learning-trail、dr-memcheck）：对话里的话进证据（T1）、memo 记成没有（T2）、
  // 讲过（coverage，T4）、助手的话进证据（T6）；首页写 since-analysis、state、简报最前面两行（T3、T5、memcheck 3）
  async trail(browser) {
    const t = await seeded(browser);
    const F4 = '````', F3 = '```';
    const today = await t.page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
    const sid = `c-${today.replace(/-/g, '')}-7`;
    const db = async () => t.db();
    const turn1 = [
      `${F4}board new id=b1 title="可交换" block=L2.1.4\n${F3}answer\nid: q1\nq: 2+3 等于几？\nanswer: 5\n${F3}\n${F4}`,
      `${F4}board memo\ntodo text="测试：下次补讲幂"\nfoo bar\n${F4}`,
      `${F4}board claude id=cl1 on=wrong target=q1\n<<<\n一句话\n>>>\n${F4}`,
    ].join('\n\n');
    await plant(t, {
      [`sessions/${sid}`]: { date: today, kind: 'ext', status: 'open', block: 'L2.1.4', title: '记录（外部）', space: 'math', startedAt: Date.now() },
      [`sessions/${sid}/ext_in/001`]: { seq: 1, text: turn1, said: [{ text: '对话里的第一句', at: Date.now() - 60000 }, { text: '对话里的第二句' }], at: Date.now() },
    });
    await t.open(sid);
    const r = await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/001`]?.result?.memo, { timeout: 20000, what: 'result.memo（memo 每一行记成没有）' });
    check(r.some((x) => x.ok && /todo/.test(x.line)) && r.some((x) => !x.ok), `result.memo 不对：${JSON.stringify(r).slice(0, 300)}`);
    const says = (await t.docs('evidence')).filter((e) => e.session === sid && e.src === 'say' && e.via === 'chat');
    check(says.length === 2, `对话里的两句没都记成证据：${says.length}`);
    await t.waitFor(async () => (await db())['coverage/L2.1.4']?.sessions?.includes(sid), { timeout: 8000, what: '板上画了 block=L2.1.4 的段，记「讲过」' });
    const box = t.page.locator('[data-bid="q1"] .ans-input input, [data-bid="q1"] .ans-input textarea, [data-bid="q1"] .ans-input [contenteditable="true"]').first();
    await box.click(); await t.page.keyboard.type('6'); await t.page.click('[data-bid="q1"] .ans-check');
    await t.waitFor(async () => (await t.docs('evidence')).some((e) => e.session === sid && e.src === 'helper' && e.role === 'helper'), { timeout: 15000, what: '助手的话记成证据 src: helper' });
    // dr-batch4 第 4 条：作答带这题在屏幕上的时间（ms 到第一次交、msTotal 到这一次）
    const rec = (await t.docs('evidence')).find((e) => e.session === sid && e.src === 'record' && e.comp === 'q1');
    check(Number(rec?.ms) >= 0 && Number(rec?.msTotal) >= Number(rec?.ms), `作答没带屏幕计时：${JSON.stringify({ ms: rec?.ms, msTotal: rec?.msTotal })}`);
    // 首页：since-analysis、state、简报最前面的两行
    await t.open();
    const since = await t.waitFor(async () => { const x = (await db())['meta/since-analysis-math']; return x && /对话里的第一句/.test(x.text) && /外部叫来的助手/.test(x.text) ? x : null; }, { timeout: 20000, what: 'meta/since-analysis-math 有对话里的话和助手的话' });
    check(since.n > 0, 'since-analysis 没数到证据');
    const st = await t.waitFor(async () => { const x = (await db())['meta/state-math']; return x?.rows?.some((r) => r.block === 'L2.1.4' && r.taught) ? x : null; }, { timeout: 15000, what: 'meta/state-math 里 L2.1.4 讲过' });
    check(typeof st.text === 'string' && Array.isArray(st.conflicts), 'meta/state-math 不全');
    const brief = await t.waitFor(async () => { const x = (await db())['meta/brief']; return x && /^现状快照/.test(x.text) && /分析游标/.test(x.text) ? x : null; }, { timeout: 15000, what: '开场简报最前面写快照和分析游标' });
    // 外部挪了游标：since-analysis 跟着只剩以后的
    await plantLive(t, { 'meta/cursor-math': { at: Date.now(), by: 'ext' } });
    await t.waitFor(async () => (await db())['meta/since-analysis-math']?.n === 0, { timeout: 15000, what: '挪了游标以后 since-analysis 清零' });
    check(!!brief, '');
    // dr-trail-fix 2：外部补写的话（at 是学生说话的时候，早于游标）照写入时间进 since-analysis，不漏
    await t.open(sid);
    await plantLive(t, { [`sessions/${sid}/ext_in/002`]: { seq: 2, text: '接着说。', said: [{ text: '十分钟前说的那句', at: Date.now() - 600000 }], at: Date.now() } });
    await t.waitFor(async () => (await db())[`sessions/${sid}/ext_in/002`]?.done, { timeout: 15000, what: 'ext_in/002 执行' });
    await t.open();
    const late = await t.waitFor(async () => { const x = (await db())['meta/since-analysis-math']; return x && /十分钟前说的那句.*（写入/.test(x.text) ? x : null; }, { timeout: 20000, what: '游标以前说的、游标以后写进来的话进 since-analysis' });
    check(late.upTo > Number((await db())['meta/cursor-math'].at), `since-analysis 的 upTo 不对：${late.upTo}`);
    // dr-trail-fix 1：学习台以前的课（错题本、「旧记录」的依据）：讲过照旧记录算、掌握照算标旧记录；页面补 coverage/legacy-…
    await plantLive(t, {
      'errors/L1-T91': { block: 'L1.1.1', date: '2026-09-27', result: '没过', q: '测试的检验题', mine: '测试', source: '复习对话' },
      'mastery/L1.1.1': { state: '掉了', log: [{ field: 'state', date: '2026-10-27', by: 'chat', from: null, to: '掉了', basis: ['L1-T91'] }] },
      'mastery/L1.1.2': { state: '基础题过', log: [{ field: 'state', date: '2026-10-27', by: 'chat', from: null, to: '基础题过', basis: ['旧记录：复习对话 块1（09-28 当堂题对）'] }] },
    });
    const old = await t.waitFor(async () => { const x = (await db())['meta/state-math']; return x && /L1\.1\.2[^\n]*讲过（9 月，旧记录）；掌握 基础题过（旧记录/.test(x.text) && /L1\.1\.1[^\n]*讲过（9 月，旧记录）；掌握 掉了（旧记录：错题本 L1-T91/.test(x.text) ? x : null; }, { timeout: 20000, what: 'meta/state-math 把学习台以前的课写成「讲过（9 月，旧记录）」' });
    check(!old.conflicts.some((c) => /^L1\.1\.[12]$/.test(c.block)), `旧记录的块还报矛盾：${JSON.stringify(old.conflicts).slice(0, 300)}`);
    const lg = (await db())['coverage/legacy-L1.1.2'];
    check(lg?.kind === 'legacy' && lg.by === 'page', `页面没补 coverage/legacy-L1.1.2：${JSON.stringify(lg)}`);
    return t;
  },

  // 记书上的题（dev_requests/dr-batch4 第 2 条）：首页一行 → 选书章题号 → 每题对 / 错 / 拿不准，错的附照片；
  // 每题一条证据 src: book，错的进错题本（带书名题号），meta/state 的作答行写书名题号
  async bookq(browser) {
    const t = await seeded(browser);
    await t.page.click('.dk-trow[data-row="book"]');
    await t.waitFor(() => t.page.$('.dk-bform .dk-bnos'), { timeout: 8000, what: '「记书上的题」面板打开' });
    await t.page.fill('.dk-bform .dk-bch', '2');
    await t.page.fill('.dk-bform .dk-bnos', '3, 4-5');
    await t.waitFor(() => t.page.$$eval('.dk-bform .dk-brow', (l) => l.length === 3), { timeout: 4000, what: '题号展开成三行' });
    for (const [no, v] of [[3, 'right'], [4, 'wrong'], [5, 'unsure']]) await t.page.click(`.dk-bform .dk-brow[data-no="${no}"] .dk-mv[data-v="${v}"]`);
    await t.page.fill('.dk-bform .dk-mtext', '第 4 题第二步符号错');
    // 一张照片（附在错的那一道上）
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await t.page.setInputFiles('.dk-bform .dk-mfile', { name: 'p.png', mimeType: 'image/png', buffer: png });
    await t.waitFor(() => t.page.$('.dk-bform .dk-mthumbs img'), { timeout: 5000, what: '照片附上' });
    await t.page.click('.dk-bform .dk-bsave');
    await t.waitFor(async () => /记下了 3 道/.test(await t.text('.dk-bform .dk-mnote') || ''), { timeout: 10000, what: '记下了 3 道' });
    const evs = (await t.docs('evidence')).filter((e) => e.src === 'book');
    check(evs.length === 3 && evs.every((e) => e.book?.title === '张宇 1000 题' && e.book.ch === 2), `书上的题的证据不对：${JSON.stringify(evs.map((e) => e.book))}`);
    const wrong = evs.find((e) => e.book.no === 4);
    check(wrong.ok === false && wrong.images?.length === 1 && evs.find((e) => e.book.no === 3).images.length === 0, `照片没附在错的那道上：${JSON.stringify(evs.map((e) => [e.book.no, e.images?.length]))}`);
    check(evs.find((e) => e.book.no === 5).ok === null, '拿不准的 ok 不是 null');
    const errs = (await t.docs('errors')).filter((e) => e.book);
    check(errs.length === 1 && errs[0].book.no === 4 && /^L2-\d+$/.test(errs[0].id) && errs[0].evidence?.[0] === wrong.id, `错题本那一条不对：${JSON.stringify(errs)}`);
    await t.waitFor(async () => /1000 题 基础篇 线代 第 2 章 第 4 题：错/.test((await t.db())['meta/state-math']?.text || '') || /1000 题 基础篇 线代 第 2 章 第 4 题：错/.test((await t.db())['meta/since-analysis-math']?.text || ''), { timeout: 15000, what: 'meta/state 或 since-analysis 写书名题号' });
    return t;
  },

  // 被迭代掉的几种课（舞台、一问一答、实时黑板、自学单元，第十四轮搬进 archive/）：以前上过的点进去只出文字，不报错
  async oldclass(browser) {
    const t = await seeded(browser);
    const sid = 'c-20261112-7';
    await plant(t, {
      [`sessions/${sid}`]: { kind: 'stage', status: 'closed', block: 'EN-L1.2.1', space: 'en', subject: '英语', title: '旧的舞台课', date: '2026-11-12', startedAt: Date.now() - 5 * 86400e3, endedAt: Date.now() - 5 * 86400e3 + 3600e3 },
      [`sessions/${sid}/class_turns/0001`]: { seq: 1, role: 'student', text: '开始上课。', at: Date.now() - 5 * 86400e3 },
      [`sessions/${sid}/class_turns/0002`]: { seq: 2, role: 'claude', text: '这一幕看现在完成时。', at: Date.now() - 5 * 86400e3 + 1000 },
    });
    await t.open(`view/${sid}`);
    const txt = await t.waitFor(async () => { const x = await t.text('.dk-oldclass'); return x && x.includes('画面已经停用') ? x : null; }, { timeout: 15000, what: '旧的舞台课只出文字' });
    check(txt.includes('这一幕看现在完成时') && txt.includes('开始上课'), `旧课的文字里少了那两轮：${txt.slice(0, 200)}`);
    return t;
  },

  async errors(browser) {
    const t = await seeded(browser);
    // 故意制造一个没接住的错误：应该被记进 meta/errors，管理页能看到
    await t.page.evaluate(() => { setTimeout(() => { throw new Error('自动测试故意抛的错'); }, 0); });
    await t.waitFor(async () => { const e = (await t.db())['meta/errors']; return e?.list?.some((x) => String(x.msg).includes('自动测试故意抛的错')); }, { timeout: 15000, what: '没接住的错误写进 meta/errors' });
    // 这个是故意的：从收集的页面报错里拿掉
    t.errors.splice(0, t.errors.length, ...t.errors.filter((e) => !e.includes('自动测试故意抛的错')));
    await t.route('manage');
    check((await t.text('.dk-check'))?.includes('自动测试故意抛的错'), '管理页看不到页面出过的错');
    return t;
  },
};

const browser = await chromium.launch({ headless: !opt.headed });
const t0 = Date.now();
for (const [name, fn] of Object.entries(SUITES)) {
  if (opt.only && !opt.only.has(name)) continue;
  const s0 = Date.now();
  let t = null;
  try {
    t = await fn(browser);
    if (t?.errors.length) throw new Error(`流程走完了，但页面报了错：\n      ${t.errors.slice(0, 8).join('\n      ')}`);
    // 代码里接住了、但报给 errlog 的（写数据库失败没重试成、体检拿不准……）也算：等它攒完写进去再看
    if (t && name !== 'errors' && name !== 'midnight') {
      await sleep(4500);
      const logged = ((await t.db().catch(() => ({})))['meta/errors']?.list || []).filter((e) => !e.soft && !t.expected?.some((x) => String(e.msg).includes(x)));
      if (logged.length) throw new Error(`流程走完了，但页面记下了错误（meta/errors）：\n      ${logged.slice(0, 6).map((e) => `${e.where}：${e.msg}${e.what ? `（${e.what}）` : ''}`).join('\n      ')}`);
    }
    results.push({ name, ok: true, ms: Date.now() - s0 });
    if (opt.shots && t) await t.page.screenshot({ path: join(opt.shots, `${name}.png`), fullPage: true }).catch(() => {});
  } catch (e) {
    failures++;
    results.push({ name, ok: false, ms: Date.now() - s0, msg: e.message });
    const pages = browser.contexts().flatMap((c) => c.pages());
    const p = t?.page || pages[pages.length - 1];
    if (p && opt.shots !== null) {
      const dir = opt.shots || join(ROOT, '.e2e-fail');
      mkdirSync(dir, { recursive: true });
      await p.screenshot({ path: join(dir, `${name}-失败.png`), fullPage: true }).catch(() => {});
    }
  } finally {
    for (const c of browser.contexts()) await c.close().catch(() => {});
  }
}
await browser.close();
server.close();

for (const r of results) {
  if (r.note) { console.log(`  （${r.note}）`); continue; }
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}  ${(r.ms / 1000).toFixed(1)} 秒${r.ok ? '' : `\n    ${r.msg}`}`);
}
console.log(`\n${results.filter((r) => !r.note).length} 段，${failures} 段没过，共 ${((Date.now() - t0) / 1000).toFixed(0)} 秒。`);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, results.map((r) => (r.note ? `- （${r.note}）` : `- ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `：${r.msg}`}`)).join('\n') + '\n', { flag: 'a' });
process.exit(failures ? 1 : 0);
