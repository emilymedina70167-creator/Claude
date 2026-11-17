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
    check(await t.page.$('.dk-nav a[href="#chat"][aria-current="true"]'), '导航里「班主任」没选中');
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

  // 第十五轮：练习教练。主讲在 meta/today 里排一项 coach，首页出这一行，点开是页面里的老师带的课，资料包里有主讲写的
  async coach(browser) {
    const t = await seeded(browser);
    const today = await t.page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
    await plant(t, { 'meta/today': { date: today, items: [{ kind: 'coach', block: 'L2.2.2', why: '到期了', focus: '把 AB 写成 BA' }] } });
    await t.open();
    await t.waitFor(() => t.page.$('.dk-crow[data-ckind="coach"]'), { timeout: 15000, what: '首页出现主讲排的练习那一行' });
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

  // 照 claude.ai 的记忆（第十四轮）：笔记本空着先在后台整理一次以前的记录；之后每节下了课的课后台给项目 Claude 一轮
  async after(browser) {
    const t = await seeded(browser);
    // 真库里 meta/exam 的 papers 是「门课 → 年份 → 题」：第一次整理拼说明时要读得懂（2026-11-17 这里崩过）
    await plant(t, { 'meta/exam': { counts: { questions: 3, papers: 2 }, papers: { 408: { 2009: [], 2026: [] } } } });
    await t.open();
    const first = await t.waitFor(async () => (await t.docs('notebook')).find((d) => d.path === '学生/底子.md' && d.pin), { timeout: 30000, what: '首页后台做了第一次整理，写了一个 pin 的笔记' });
    check(first.by === 'organize', `第一次整理的作者不对：${first.by}`);
    await t.waitFor(async () => (await t.db())['meta/project']?.since, { what: '第一次整理以后记下从什么时候起' });
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    await t.page.click('button:has-text("开始上课")');
    await t.waitFor(() => t.page.$('button:has-text("一个数")'), { timeout: 30000, what: '模拟老师写出第一道题' });
    await sleep(1500);
    await t.open(); await t.page.waitForSelector('.dk-class .dk-go', { state: 'attached', timeout: 15000 });
    await t.page.evaluate(() => document.querySelector('.dk-class .dk-close').click());
    await t.answer('直接下课');
    const s = await t.waitFor(async () => { const x = (await t.docs('sessions')).find((d) => d.id === sid); return x?.after?.at ? x : null; }, { timeout: 40000, what: '下课以后后台给了项目 Claude 一轮' });
    check(s.after.model === 'claude-opus-5-5', `课后那一轮的模型不对：${s.after.model}`);
    const log = (await t.docs('notebook')).find((d) => d.path === '课/记录.md');
    check(log && log.by === 'after' && log.text.includes(sid), `课后那一轮没写笔记：${JSON.stringify(log)}`);
    // 再打开首页：同一节不再给第二次
    await t.open(); await sleep(3000);
    const again = (await t.docs('sessions')).find((d) => d.id === sid);
    check(again.after.rounds === 1, `同一节课给了不止一次：${JSON.stringify(again.after)}`);
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
