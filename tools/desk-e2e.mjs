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
    /** 开新课一律是舞台；旧的黑板 / 一问一答只有 ?dev&form=class / talk 还开得出来（它们的代码还在给以前的课用）：整页换成带 form 的首页 */
    async openForm(f) {
      await page.goto('about:blank'); await page.goto(`${BASE}&form=${f}`); await page.waitForLoadState('load');
      await t.waitFor(async () => (await t.text('.dk-class'))?.includes('开新课'), { what: `带 form=${f} 的首页画好` });
      await sleep(500);
    },
    /** 点了开课的按钮以后：等进到课堂（页面自己改地址、整页刷新）、开课页画好（舞台课一进来就开讲，没有「开始上课」） */
    async inClass(match = () => true) {
      await page.waitForURL((u) => /#c-\d{8}-\d+/.test(u.hash) && match(decodeURIComponent(u.hash.slice(1))), { timeout: 20000 });
      await page.waitForLoadState('load');
      await t.waitFor(() => page.evaluate(() => /开始上课|下一题|这次练习/.test(document.body?.innerText || '') || !!document.querySelector('.sc-root .st-stage')), { timeout: 20000, what: '课堂（舞台、练习）画出来' });
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

  // 「我改记忆」：第一次保存写失败（网络抖），编辑框留着、按钮能再点；第二次成功，编辑框收起、新的话画出来
  async mine(browser) {
    const t = await seeded(browser);
    await t.route('manage');
    await t.page.evaluate(() => { document.querySelector('.dk-mine-sec[data-sec="prefs"]').open = true; });
    // 一次写失败（网络抖）：写的出口自己重试，像没发生过
    await t.page.click('.dk-mine .dk-pref'); await sleep(200);
    await t.page.fill('.dk-mine textarea', '自动测试改的第一句');
    await t.page.evaluate(() => window.LAKitDev.failWrites(1));
    await t.page.click('.dk-mine .dk-pref-save');
    await t.waitFor(async () => !(await t.page.$('.dk-mine .mm-f')), { timeout: 8000, what: '失败一次（自己重试成了）以后编辑框收起' });
    check((await t.text('.dk-mine')).includes('自动测试改的第一句'), '失败一次自己重试以后列表里还是旧的话');
    // 一直写不进去（断网）：编辑框留着、按钮能再点；网好了再点就成
    t.expected = ['模拟的写入失败'];
    await t.page.evaluate(() => { document.querySelector('.dk-mine-sec[data-sec="prefs"]').open = true; });
    await t.page.click('.dk-mine .dk-pref'); await sleep(200);
    await t.page.fill('.dk-mine textarea', '自动测试改的一句：先让我自己试');
    await t.page.evaluate(() => window.LAKitDev.failWrites(20));
    await t.page.click('.dk-mine .dk-pref-save');
    await t.waitFor(() => t.page.$('.dk-mine .dk-pref-save:not([disabled])'), { timeout: 10000, what: '写不进去以后「保存」放开' });
    check(await t.page.$('.dk-mine .mm-f'), '写不进去以后编辑框没了（改的话丢了）');
    await t.page.evaluate(() => window.LAKitDev.failWrites(0));
    await t.page.click('.dk-mine .dk-pref-save');
    await t.waitFor(async () => !(await t.page.$('.dk-mine .mm-f')), { timeout: 8000, what: '保存成功以后编辑框收起' });
    check((await t.text('.dk-mine')).includes('自动测试改的一句'), '保存成功以后列表里还是旧的话');
    await t.waitFor(async () => ((await t.db())['meta/errors']?.list || []).some((e) => String(e.msg).includes('模拟的写入失败')), { timeout: 12000, what: '写不进去的那次记进 meta/errors（攒几秒才写）' });
    const prof = await t.docs('profile');
    check(prof.some((p) => String(p.text).includes('自动测试改的一句')), '数据库里的「关于我」没改');
    return t;
  },

  // 要想起来的：评分写失败一次再点，只记一条证据；第一张写「第一次想」；评完数量归零；评分途中点「先到这」不再翻出下一张
  // 410 分的进度（score.js）：首页那张卡、掌握一变数字跟着变、点开面板、关上
  async score(browser) {
    const t = await seeded(browser);
    const num = async () => Number((await t.text('.dk-score-n b')) || NaN);
    const n0 = await t.waitFor(async () => { const n = await num(); return Number.isFinite(n) ? n : null; }, { what: '首页的 410 卡画出来' });
    check((await t.text('.dk-score'))?.includes('410'), '410 卡上没写目标');
    // 一块写成复现通过 30 天那档（替身数据库直接放进去，刷新一下读到）：分跟着涨
    const db = await t.db();
    await plant(t, { 'mastery/L2.2.2': { ...(db['mastery/L2.2.2'] || {}), state: '复现通过', tier: 30 } });
    await t.page.reload(); await sleep(1500);
    const n1 = await t.waitFor(async () => { const n = await num(); return n > n0 ? n : null; }, { what: '掌握升档以后 410 卡上的分涨了' });
    check(n1 > n0, `分没涨：${n0} → ${n1}`);
    await t.page.click('.dk-score-btn'); await sleep(900);
    check(await t.page.$('.fl-panel .dk-sc-how'), '点 410 卡没出面板（或面板里没有「怎么算的」）');
    check((await t.text('.fl-panel'))?.includes('学习台里还没有这一部分'), '面板里没标出学习台里还没有的部分');
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

  // 一问一答（kind: talk，docs/talk-impl.md D.2）：自动测试开一节（首页不再给选，?dev&form=talk；连点两下只开一节）；活板上填错一次、填对一次，证据里记成 L… 的作答；
  // 上面的数变了、空重新打开再答（L…#2）；拨一下不调用，点「就这样」才调用；刷新以后空、选择、拨的值都在；直接下课，报告里有这几道题；
  // 「以前的课」能翻看（只读、不调用）
  async talk(browser) {
    const t = await seeded(browser);
    await t.openForm('talk');
    const before = (await t.docs('sessions')).length;
    await t.page.dblclick('.dk-class .dk-new');
    const sid = await t.inClass();
    const ss = await t.docs('sessions');
    check(ss.length === before + 1, '连点两下「开新课」开出了不止一节');
    check(ss.find((d) => d.id === sid)?.kind === 'talk', 'form=talk 开出来的课不是 kind: talk');
    const calls = () => t.page.evaluate(() => (window.LAKitEval?.teacher?.calls || []).filter((c) => c.method === 'call').length);
    const idle = (what) => t.waitFor(async () => !(await t.page.evaluate(() => window.LAKit?.classroom?.busy)), { timeout: 30000, what });
    await t.page.click('button:has-text("开始上课")');
    await t.waitFor(() => t.page.$('.hb-board .hb-now .hb-blank input'), { timeout: 30000, what: '模拟老师写出第一问（活板上有一个空）' });
    await idle('老师写完第一问');
    // 填错一次、填对一次（回车交也行，这里点「对吗」）
    const blank = '.hb-board .hb-blank';
    await t.page.fill(`${blank} input`, '8'); await t.page.click(`${blank} button`);
    await t.waitFor(() => t.page.$('.hb-echo span'), { what: '填错以后回显出来' });
    await t.page.fill(`${blank} input`, '9'); await t.page.click(`${blank} button`);
    const recs = await t.waitFor(async () => { const ev = (await t.docs('evidence')).filter((e) => e.session === sid && e.src === 'record' && /^L\d/.test(e.comp || '')); return ev.length >= 2 ? ev : null; }, { what: '证据里有 L… 的两条作答' });
    check(recs.some((e) => e.ok === false) && recs.some((e) => e.ok === true), '证据里的两条不是一错一对');
    check(recs.every((e) => e.q && !/\{/.test(e.q)), `作答记录的题面不是人读得懂的：${recs[0]?.q}`);
    // 第二问：set 改了页框数（上面的空重新打开）+ 一个选择
    await t.waitFor(() => t.page.$('.hb-now .hb-choice button'), { timeout: 30000, what: '第二问（选择）' });
    await idle('老师写完第二问');
    check(!(await t.page.$('.hb-blank.is-ok')), '页框数改了，上面那个空没有重新打开');
    await t.page.fill(`${blank} input`, '10'); await t.page.click(`${blank} button`);
    await t.page.evaluate(() => [...document.querySelectorAll('.hb-now .hb-choice button')].find((b) => b.textContent.includes('变多'))?.click());
    await t.waitFor(() => t.page.$('.hb-goal'), { timeout: 30000, what: '第三问（目标）' });
    await idle('老师写完第三问');
    // 拨一下：攒着，不调用；发送键变成「就这样」，点了才调用
    const n0 = await calls();
    await t.page.click('.hb-scrub button[aria-label="加一"]');
    await sleep(3000);
    check((await calls()) === n0, '在活板上拨了一下就调用了老师（应该攒着）');
    check((await t.text('.cb-send'))?.includes('就这样'), '拨过以后发送键没变成「就这样」');
    await t.page.click('.cb-send');
    await t.waitFor(async () => (await calls()) > n0, { what: '点「就这样」以后调用老师' });
    await idle('老师接着写完');
    const ev2 = (await t.docs('evidence')).filter((e) => e.session === sid && e.src === 'record');
    check(ev2.some((e) => /^L\d+#2$/.test(e.comp || '') && e.ok === true), '重新打开的空再答，证据里没有 L…#2 那一道');
    check(ev2.some((e) => e.explore && e.name === 'k'), '拨的那一下没记进证据');
    // 刷新：空的状态、选择、拨的值都在
    await t.page.reload(); await t.page.waitForLoadState('load');
    await t.waitFor(() => t.page.$('.hb-board .hb-now'), { timeout: 20000, what: '刷新以后活板画回来' });
    await sleep(800);
    check((await t.page.$eval('.hb-blank.is-ok input', (x) => x.value).catch(() => '')) === '10', '刷新以后空里答对的 10 没了');
    check(await t.page.$('.hb-choice button.is-ok'), '刷新以后选择的结果没了');
    check((await t.text('.hb-scrub .hb-n'))?.trim() === '1', `刷新以后拨的值没放回去（现在是 ${await t.text('.hb-scrub .hb-n')}）`);
    // 直接下课：报告里有这几道题
    await t.open(); await t.page.waitForSelector('.dk-class .dk-go', { state: 'attached', timeout: 15000 });
    await t.page.evaluate(() => document.querySelector('.dk-class .dk-close').click());
    await t.answer('直接下课');
    await t.waitFor(async () => { const x = (await t.docs('sessions')).find((d) => d.id === sid); return x?.status === 'closed' && x.report?.at ? x : null; }, { timeout: 20000, what: '直接下课以后报告写好' });
    const rep = (await t.db())[`sessions/${sid}/report/main`];
    check((rep?.items || []).filter((it) => /^L\d/.test(it.comp || '')).length >= 3, `报告里没有活板上的这几道题：${JSON.stringify((rep?.items || []).map((x) => x.comp))}`);
    // 翻看黑板：活板画出来，只读，不调用
    await t.open(`view/${sid}`);
    await t.waitFor(() => t.page.$('.hb-board.is-readonly .hb-turn'), { timeout: 20000, what: '只读的活板画出来' });
    await sleep(1500);
    check((await calls()) === 0, '翻看以前的课调用了老师');
    return t;
  },

  // 一问一答的几条边（复核员找到的）：作废的一轮退回去，学生答对的空还是答对的（预览不改作答状态）；
  // 学生拨到让旧行算不出来的值，老师下一轮写对了不被退回；写错退回带 memo 块的一轮，重写时原样再带，复现组只升一档；
  // 存下的 shown 是这一轮的字（不是上一轮、不带 KaTeX 的重复）；活板的控件 ≥ 44px
  async talkfix(browser) {
    const t = await seeded(browser);
    await t.openForm('talk');
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    const idle = (what) => t.waitFor(async () => !(await t.page.evaluate(() => window.LAKit?.classroom?.busy)), { timeout: 30000, what });
    const turns = async () => Object.entries(await t.db()).filter(([k]) => k.startsWith(`sessions/${sid}/class_turns/`)).map(([, v]) => v).sort((a, b) => a.seq - b.seq);
    const say = async (x) => { await t.page.fill('.cb-field textarea', x); await t.page.click('.cb-send'); await sleep(400); };
    const fallback = (on) => t.page.evaluate((v) => { const c = document.querySelector('.dev-fallback'); c.checked = v; c.dispatchEvent(new Event('change')); }, on);
    await t.page.click('button:has-text("开始上课")');
    await t.waitFor(() => t.page.$('.hb-board .hb-now .hb-blank input'), { timeout: 30000, what: '第一问' });
    await idle('老师写完第一问');
    // 触控目标
    const small = await t.page.evaluate(() => [...document.querySelectorAll('.hb-board .hb-scrub button, .hb-board .hb-blank input, .hb-board .hb-blank button')].map((x) => [x.className || x.tagName, x.getBoundingClientRect()]).filter(([, r]) => r.width && (r.height < 43.5 || r.width < 43.5)).map(([c, r]) => `${c} ${Math.round(r.width)}×${Math.round(r.height)}`));
    check(!small.length, `活板上有控件不到 44px：${small.join('、')}`);
    // 1. 作废的一轮（Opus 5.5 用不了）：预览里 set 改了页框数，退回去以后答对的空还是答对的
    await fallback(true);
    const blank = '.hb-board .hb-blank';
    await t.page.fill(`${blank} input`, '9'); await t.page.click(`${blank} button`);
    await t.waitFor(async () => (await turns()).some((x) => x.kind === 'fallback'), { timeout: 30000, what: '作废的一轮' });
    await idle('作废以后停下');
    await sleep(500);
    check(await t.page.$('.hb-blank.is-ok'), '这一轮作废、退回去以后，答对的空被清空了');
    check(!(await t.text('.hb-board'))?.includes('数变了'), '这一轮作废、退回去以后，空上挂着「数变了，再算一次」');
    const st0 = await t.page.evaluate(() => document.querySelector('.block-huoban')?._hb?.stateOf()?.blanks?.[0]);
    check(st0 && !st0.reopened && st0.id === 'L8', `作废以后活板现状里那个空记成了重开：${JSON.stringify(st0)}`);
    await fallback(false);
    await say('测试:除零');
    await t.waitFor(() => t.page.$('.hb-now .hb-scrub'), { timeout: 30000, what: '能拨到 0 的那一问' });
    await idle('老师写完能拨的那一问');
    // 2. 老师边写边显示时学生按着「对吗」：一行行画上来不打断这一下，松手照样交上去
    const dBlank = '.hb-now .hb-blank';
    await t.page.fill(`${dBlank} input`, '7');
    const dKey = await t.page.$eval(dBlank, (x) => x.dataset.key);
    const sayNow = (x) => t.page.evaluate((v) => { const a = document.querySelector('.cb-field textarea'); a.value = v; a.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.cb-form').requestSubmit(); }, x);
    // 在页面里一气做完（鼠标坐标会跟着滚动、预览一行行画上来，从外面按不准）：发一句话，预览一画上来就在那个空的「对吗」上按下，
    // 按着 1.5 秒（预览接着往上画），这期间按钮不该被换掉；松手、点击照样交上去
    const kept = await t.page.evaluate(async ({ k, v }) => {
      const a = document.querySelector('.cb-field textarea'); a.value = v; a.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.cb-form').requestSubmit();
      const t0 = Date.now();
      while (!document.querySelector('.hb-board')?.classList.contains('is-streaming')) { if (Date.now() - t0 > 15000) return 'no-stream'; await new Promise((r) => setTimeout(r, 10)); }
      const btn = document.querySelector(`.hb-blank[data-key="${k}"] button`);
      const o = { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true };
      btn.dispatchEvent(new PointerEvent('pointerdown', o));
      await new Promise((r) => setTimeout(r, 1500));
      const still = btn.isConnected;
      btn.dispatchEvent(new PointerEvent('pointerup', o));
      if (still) btn.click();
      return still ? 'ok' : 'replaced';
    }, { k: dKey, v: '先等等' });
    check(kept === 'ok', `边写边显示时按着「对吗」，按钮被重画换掉了（${kept}）：松手不算一次点击`);
    await idle('老师写完这一轮');
    await sleep(800);
    const evD = (await t.docs('evidence')).filter((e) => e.session === sid && e.src === 'record' && e.value === '7');
    check(evD.length === 1 && evD[0].ok === true, `边写边显示时按着「对吗」再松手，这次作答没记上（${evD.length} 条）`);
    // 答对了自动发给老师：等它接着写完（下一轮是目标）
    await t.waitFor(() => t.page.$('.hb-now .hb-goal'), { timeout: 30000, what: '答对以后老师写的下一轮（目标）' });
    await idle('老师写完目标那一轮');
    const goalTurn = (await turns()).filter((x) => x.role === 'claude').at(-1);
    check(goalTurn?.shown && /页框数 3，缺页 9 次/.test(goalTurn.shown) && /目标：/.test(goalTurn.shown) && !/模拟老师 ·|对吗/.test(goalTurn.shown), `存下的 shown 不是这一轮的字：${goalTurn?.shown}`);
    // 3. 学生拨到 0（旧行算不出来），老师下一轮写对：不退回、不要重写
    await t.page.evaluate((k) => document.querySelector(`.hb-blank[data-key="${k}"]`).closest('.hb-p').querySelector('.hb-scrub button[aria-label="减一"]').click(), dKey);
    await sleep(1200);
    const lint0 = (await turns()).filter((x) => x.kind === 'lint').length;
    const said0 = (await turns()).filter((x) => x.role === 'claude').length;
    await say('继续');
    await t.waitFor(async () => (await turns()).filter((x) => x.role === 'claude').length > said0, { timeout: 30000, what: '学生拨到 0 以后老师写的下一轮' });
    await idle('老师写完下一轮');
    check((await turns()).filter((x) => x.kind === 'lint').length === lint0, '学生把旧行拨到算不出来，老师写对的这一轮被当成写错退回了');
    const cl = (await turns()).filter((x) => x.role === 'claude').at(-1);
    check(cl?.shown && /想清楚了就选一个往下走/.test(cl.shown) && !/拨一拨这个数/.test(cl.shown), `学生拨到 0 以后老师写对的这一轮没收下（shown：${cl?.shown}）`);
    // 4. 写错带 memo（写错的是只有画出来才查得到的值），学生一直按着拨数不松手：页面等一会儿就硬画出来查，照样退回、要它重写；
    // 重写时原样再带的 memo 不再执行，复现组只升一档
    const r0 = (await t.docs('reviews')).find((r) => r.id === 'R3');
    const nb = await (await t.page.$('.hb-scrub .hb-n')).boundingBox();
    await t.page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
    await t.page.mouse.down();
    await sayNow('测试:写错带记');
    await sleep(7000);
    await t.page.mouse.up();
    await t.waitFor(async () => (await turns()).some((x) => x.kind === 'lint'), { timeout: 30000, what: '写错一行，要它重写' });
    await t.waitFor(async () => (await turns()).filter((x) => x.role === 'claude').at(-1)?.text?.includes('我改一下'), { timeout: 30000, what: '重写的那一轮' });
    await idle('重写完');
    await sleep(1500);
    const r1 = (await t.docs('reviews')).find((r) => r.id === 'R3');
    check(r1 && r1.tier !== r0?.tier, `写错的那一轮里的 memo 没执行（R3 档位 ${r0?.tier} → ${r1?.tier}）`);
    check(r1 && r1.tier === 7, `重写时原样再带的 memo 又执行了一次（R3 档位 ${r0?.tier} → ${r1?.tier}，应该是 7）`);
    const fix = (await turns()).filter((x) => x.role === 'claude' && x.shown).at(-1);
    check(fix && /2 \+ 3/.test(fix.shown) && !/2\+3=2 \+ 3/.test(fix.shown), `重写那一轮存下的 shown 不对：${fix?.shown}`);
    // 5. 三轮以前的轮折起来，但能拨舞台上那张置换表的那一轮（拨步数 k）、有重新打开还没答的空的那一轮（拨到 0 的 d）不折
    const fold = await t.page.evaluate(() => { const vis = (sel) => !!document.querySelector(sel)?.offsetParent; return { cur: document.querySelector('.block-huoban')?._hb?.cur, k: vis('.hb-turn[data-t="0"] .hb-scrub'), d: vis('.hb-turn[data-t="1"]'), t2: vis('.hb-turn[data-t="2"]'), more: document.querySelector('.hb-more')?.textContent || '' }; });
    check(fold.cur >= 5 && fold.k && fold.d && !fold.t2 && /前面还有 1 轮/.test(fold.more), `折旧轮不对：${JSON.stringify(fold)}（第 0 轮能拨舞台上的图、第 1 轮有重开的空，应该看得见；第 2 轮应该折起来）`);
    return t;
  },

  // 练一练：题库里放两道挂着到期复现组的题。做完（中间写证据失败一次）结果照样算进去；
  // 另开一节做一道错的就回首页「直接下课」，复现组照样记「没过」（以前直接下课会把复现结果丢掉）
  // 舞台课（kind: stage，docs/stage-plan.md D 段）：首页「开新课」（开新课一律是舞台），模拟老师一轮轮写镜头指令；
  // 点对一格（证据里一条 S… 的作答，ok）、填一个答案（页面当场判）；老师写的 memo 块写进记忆；写错的一行跳过、下一轮告诉老师；
  // 刷新以后舞台照记录放回、最后一问接着等；打一句话；交一次 ask pick（猜对了马上演 @ask.right、手上还有事不叫老师）、按一次「回到……」；
  // 下课：小结、整理单、课后报告里有 S… 的题；以前的课能翻看（只读、不调用）
  async stage(browser) {
    const t = await seeded(browser);
    check(!(await t.page.$('.dk-form, [data-form]')), '首页还有「黑板 / 一问一答 / 舞台」的选项');
    await t.page.click('.dk-class .dk-new');
    await t.page.waitForURL((u) => /#c-\d{8}-\d+/.test(u.hash), { timeout: 20000 });
    await t.page.waitForLoadState('load');
    await t.waitFor(() => t.page.$('.sc-root .st-stage'), { timeout: 20000, what: '舞台课画出来' });
    const sid = decodeURIComponent(new URL(t.page.url()).hash.slice(1));
    check((await t.docs('sessions')).find((d) => d.id === sid)?.kind === 'stage', '开新课开出来的不是舞台（kind: stage）');
    const node = (pid) => t.page.evaluate((k) => { const r = window.LAStage?.nodes.get(k)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, pid);
    const tap = async (pid) => { const p = await node(pid); check(p, `舞台上没有 ${pid}`); await t.page.mouse.move(p.x, p.y); await t.page.mouse.down(); await t.page.mouse.up(); };
    const turns = async () => Object.entries(await t.db()).filter(([k]) => k.startsWith(`sessions/${sid}/class_turns/`)).map(([, v]) => v).sort((a, b) => a.seq - b.seq);
    // 第一轮：一排格子、要找的数、比一次，等学生点
    await t.waitFor(() => t.page.$('.st-cell.is-tap'), { timeout: 30000, what: '模拟老师写出第一轮（舞台上能点格子）' });
    await sleep(500);
    await tap('a:9');
    const rec = await t.waitFor(async () => (await t.docs('evidence')).find((e) => e.session === sid && e.src === 'record' && /^S\d+$/.test(e.comp || '')), { what: '点对的那一格记成 S… 的作答' });
    check(rec.ok === true, `点了预期的那一格，作答记成了 ok=${rec.ok}`);
    // 第二轮：两句话连着演（上一句留在画面上）；故意写错的一行跳过，memo 块写进记忆，ask value 当场判
    await t.waitFor(() => t.page.$('.st-say.is-main input'), { timeout: 30000, what: '第二轮问一个要填的答案' });
    check(await t.page.evaluate(() => /对，在右边/.test(document.querySelector('.st-caption').textContent) && /灰掉的这一半/.test(document.querySelector('.st-caption').textContent)), '第二轮说过的两句话没有都留在画面上');
    const tt = await turns();
    check(tt.some((x) => x.role === 'claude' && Array.isArray(x.log) && x.log.some((r) => /^array a/.test(r.src))), '老师那一轮没把演了的行记进 class_turns');
    await t.waitFor(async () => (await t.docs('observations')).some((o) => o.session === sid && /第一次就能说出往哪边找/.test(o.text || '')), { what: 'memo 块里的 note 写进记忆' });
    await t.page.fill('#st-say-input', '5'); await t.page.click('.st-say-go');
    await t.waitFor(async () => (await t.docs('evidence')).some((e) => e.session === sid && e.src === 'record' && e.value === '5' && e.ok === true), { what: '填的答案记成作答（页面判对）' });
    const st = (await turns()).filter((x) => x.role === 'student').at(-1);
    check(/swap 要正好两格/.test(st?.msg || ''), '写错的那一行没在下一轮告诉老师');
    // 第三轮（活的舞台）：开放一排格子、一个挑战；页面替老师挂「给个提示」。挑战还没做到时刷新：照记录放回，挑战还在、接着等
    await t.waitFor(() => t.page.evaluate(() => !!document.querySelector('.st-goal') && window.LAStage?.scene.waiting?.button === '给个提示'), { timeout: 30000, what: '第三轮出挑战、挂上「给个提示」' });
    await t.page.reload(); await t.page.waitForLoadState('load');
    await t.waitFor(() => t.page.evaluate(() => window.LAStage?.scene.waiting?.button === '给个提示' && window.LAStage.scene.goals.has('g1')), { timeout: 20000, what: '刷新以后挑战还在、接着等' });
    const back = await t.page.evaluate(() => { const s = window.LAStage.scene; const a = s.objects.get('a'); return { dim: a.cells.filter((c) => c.dim).length, covered: a.cells.filter((c) => c.covered).length, ptr: a.ptrs.get('mid'), open: s.opens.has('b:drag') }; });
    check(back.dim === 6 && back.covered === 4 && back.ptr === 9 && back.open, `刷新以后舞台没照记录放回：${JSON.stringify(back)}`);
    check(await t.page.evaluate(() => /翻开是/.test(document.querySelector('.st-caption').textContent)), '刷新以后这一轮说过的话没放回画面上');
    // 学生自己拖：每拖一下页面当场照做；排好的那一刻挑战打勾、预写的一句和下一问马上出来，不叫老师（老师那一轮还没来）
    const claudeTurns = async () => (await turns()).filter((x) => x.role === 'claude').length;
    const before = await claudeTurns();
    const drag = async (from, to) => { const a = await node(from), b = await node(to); check(a && b, `舞台上没有 ${from} / ${to}`); await t.page.mouse.move(a.x, a.y); await t.page.mouse.down(); for (let i = 1; i <= 8; i++) await t.page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8); await t.page.mouse.up(); await sleep(900); };
    await drag('b:1', 'b:3');
    // 撤一步（open b undo=on）：多拖一下再撤，舞台退回去；刷新以后撤之前的那一下还在（撤的时候 log 只能少那一行，不然这一段学生做的存不进去）
    const order = () => t.page.evaluate(() => window.LAStage.scene.objects.get('b').cells.sort((x, y) => x.slot - y.slot).map((x) => x.value).join(' '));
    check(await order() === '2 1 3', `拖一下以后不是 2 1 3：${await order()}`);
    await drag('b:1', 'b:2');
    check(await order() === '2 3 1', `又拖一下以后不是 2 3 1：${await order()}`);
    const len0 = await t.page.evaluate(() => window.LAStage.log.length);
    await t.page.click('.st-undo');
    await t.waitFor(async () => (await order()) === '2 1 3', { timeout: 8000, what: '撤一步以后退回 2 1 3' });
    check(await t.page.evaluate(() => window.LAStage.log.length) === len0 - 1, '撤一步以后舞台的 log 不是正好少一行');
    check(await t.page.evaluate(() => window.LAStage.scene.waiting?.button === '给个提示'), '撤一步以后那一问（给个提示）没接着等');
    await t.waitFor(async () => { const p = (await turns()).filter((x) => x.role === 'student').at(-1); return p?.pending && (p.log || []).length === 1 && (p.events || []).some((e) => e.act?.type === 'undo'); }, { what: '撤一步以后存着的这一段只剩撤之前的那一下、记着撤了一步' });
    await t.page.reload(); await t.page.waitForLoadState('load');
    await t.waitFor(() => t.page.evaluate(() => window.LAStage?.scene.waiting?.button === '给个提示'), { timeout: 20000, what: '撤一步以后刷新，接着等' });
    check(await order() === '2 1 3', `撤一步以后刷新，撤之前的那一下没放回来：${await order()}`);
    await drag('b:3', 'b:2');
    await t.waitFor(() => t.page.evaluate(() => window.LAStage.scene.goals.get('g1')?.met && window.LAStage.scene.waiting?.kind === 'say'), { timeout: 15000, what: '排好以后挑战打勾、预写的下一问出来' });
    check(await t.page.$('.st-goal.is-met'), '做到的挑战没有打勾');
    await t.waitFor(async () => (await t.docs('evidence')).some((e) => e.session === sid && e.src === 'record' && e.value === 'goal' && e.ok === true), { what: '做到挑战记成作答' });
    await sleep(800);
    check(await claudeTurns() === before, '预写的下一问还在等学生，页面却又叫了老师');
    const pend = (await turns()).filter((x) => x.role === 'student').at(-1);
    check(pend?.pending && (pend.events || []).filter((e) => e.kind === 'try').length === 4, `学生拖的三下、撤的一下没攒进还没发出去的那一段：${JSON.stringify(pend?.events)}`);
    await t.page.fill('#st-say-input', '往左，因为 33 比 37 小'); await t.page.click('.st-say-go');
    await t.waitFor(async () => (await t.docs('evidence')).some((e) => e.session === sid && e.src === 'say' && /往左/.test(e.text || '')), { what: '打的字记成学生说的话' });
    const sent = await t.waitFor(async () => (await turns()).find((x) => x.role === 'student' && !x.pending && /往左/.test(x.msg || '')), { what: '学生说的话连同攒下的拖、做到挑战一起发给老师' });
    check(/学生拨了|学生把 3/.test(sent?.msg || '') || /拖到/.test(sent?.msg || ''), `发给老师的没写学生怎么拖的：${sent?.msg}`);
    check(/做到了挑战 g1/.test(sent?.msg || '') && /往左/.test(sent?.msg || ''), `发给老师的没写做到了挑战、学生说的话：${sent?.msg}`);
    check(/学生撤回了自己的上一下/.test(sent?.msg || ''), `发给老师的没写学生撤了一步：${sent?.msg}`);
    await t.waitFor(() => t.page.$('.st-next'), { timeout: 30000, what: '第四轮' });
    await sleep(1500);
    await t.page.click('.st-next');
    await t.waitFor(async () => (await turns()).filter((x) => x.role === 'claude').at(-1)?.cost?.spec === 'hit', { timeout: 30000, what: '点了「接着」以后接上提前想好的那一轮' });
    // 第五轮：一棵树交给学生插、存了「开始」；先猜插了 47 以后哪几个会变（ask pick）。猜对了马上演 @ask.right 的一句；
    // 树还没插完（学生手上还有事）就不叫老师，页面替它挂「给个提示」（学生还能打字），板顶那句话还在
    await t.waitFor(() => t.page.evaluate(() => window.LAStage?.scene.waiting?.kind === 'pick' && !!document.querySelector('.st-pick-go')), { timeout: 30000, what: '第五轮问「猜好了」那一问' });
    await sleep(800);
    const before5 = await claudeTurns();
    const pidOfRef = (ref) => t.page.evaluate((r) => { const p = window.LAStage.scene.parts(r)[0]; return `${p.obj}:${p.key}`; }, ref);
    for (const r of ['t.45', 't.40', 't.30']) { await tap(await pidOfRef(r)); await sleep(200); }
    await t.page.click('.st-pick-go');
    await t.waitFor(() => t.page.evaluate(() => /对，就是这三个/.test(document.querySelector('.st-caption')?.textContent || '') && window.LAStage?.scene.waiting?.button === '给个提示'), { timeout: 15000, what: '猜对了马上演 @ask.right 的一句、页面替它挂「给个提示」' });
    await sleep(800);
    check(await claudeTurns() === before5, '猜对了、树还没插完（学生手上还有事），页面却叫了老师');
    const treeNow = () => t.page.evaluate(() => { const s = window.LAStage.scene; return { open: s.opens.has('t:insert'), tray: (s.objects.get('t').tray || []).join(' '), state: s.stateText().split('\n').filter((l) => /^树 t/.test(l)).join('\n') }; });
    const t5 = await treeNow();
    check(t5.open && t5.tray === '47', `猜完以后树不是还交给学生插、托盘里还有 47：${JSON.stringify(t5)}`);
    check(await t.page.evaluate(() => /对，就是这三个/.test(document.querySelector('.st-caption')?.textContent || '')), '页面替它挂「给个提示」以后，板顶 @ask.right 那句话没了');
    // 按「回到开始」：t 照原样；再打一句话发出去，这一条 [学生] 里有点了「回到开始」、答对了没叫老师
    await t.page.click('.st-back');
    await t.waitFor(() => t.page.evaluate(() => window.LAStage.log.some((r) => /^back t "开始"/.test(r.src))), { timeout: 8000, what: '按「回到开始」记成学生的一行' });
    check(JSON.stringify(await treeNow()) === JSON.stringify(t5), `按「回到开始」以后 t 变了：${JSON.stringify(await treeNow())}`);
    await t.page.fill('#st-say-input', '47 插在 45 的右边'); await t.page.click('.st-say-go');
    const sent5 = await t.waitFor(async () => (await turns()).find((x) => x.role === 'student' && !x.pending && /47 插在 45 的右边/.test(x.msg || '')), { what: '学生说的话连同攒下的猜对、回到开始一起发给老师' });
    check(/学生点了「回到开始」/.test(sent5.msg || ''), `发给老师的没写学生点了「回到开始」：${sent5.msg}`);
    check(/学生答对了（页面已经演了你预写的 1 行）；那时 t 还没做完，没叫你/.test(sent5.msg || ''), `发给老师的没写答对了、那时为什么没叫老师：${sent5.msg}`);
    // 第六轮（和第四轮一样）
    await t.waitFor(() => t.page.evaluate(() => /模拟老师讲完了/.test(document.querySelector('.st-caption')?.textContent || '') && [...document.querySelectorAll('.st-next')].some((b) => /^好/.test(b.textContent.trim()))), { timeout: 30000, what: '第六轮' });
    // 老师把「下课吗？」递给学生（ask end，主线第七轮）：弹出和顶上「下课」同一个确认框；点「接着上」课还在、老师收到那一句
    const said = async (txt) => { await t.page.fill('#st-say-input', txt); await t.page.click('.st-say-go'); };
    await said('测试:下课');
    await t.waitFor(() => t.page.evaluate(() => /下课吗/.test(document.body.innerText)), { timeout: 20000, what: '老师递的「下课吗？」弹出来' });
    await t.answer('接着上');
    const goOn = await t.waitFor(async () => (await turns()).find((x) => x.role === 'student' && !x.pending && /学生点了「接着上」/.test(x.msg || '')), { timeout: 20000, what: '点了「接着上」发给老师' });
    check(goOn && (await t.docs('sessions')).find((d) => d.id === sid)?.status !== 'closed', '点了「接着上」课却结束了');
    // 下课：老师再递一次，这回点「下课」——小结、整理单（position 写进记忆）、报告里有 S… 的题
    await t.waitFor(() => t.page.$('#st-say-input'), { timeout: 20000, what: '接着上以后能打字' });
    // 开新的一幕（scene，主线第六轮）：上一幕收干净、幕条两幕；点①翻回去看（只读、不叫老师），回到现在；刷新以后幕条还在
    await said('测试:分幕');
    await t.waitFor(() => t.page.evaluate(() => document.querySelectorAll('.sc-scenes-slot .st-scene').length === 2), { timeout: 30000, what: '开新的一幕以后顶上幕条有两幕' });
    check(await t.page.evaluate(() => { const s = window.LAStage.scene; return [...s.objects.keys()].join(' ') === 't' && !s.goals.size; }), '开新的一幕以后上一幕的东西、挑战没收干净（keep=t 只该留下 t）');
    await t.waitFor(() => t.page.evaluate(() => window.LAStage?.scene.waiting?.button === '看好了'), { timeout: 30000, what: '开新一幕的那一轮演完、等学生点「看好了」' });
    await sleep(1200);
    const c6 = await claudeTurns();
    await t.page.click('.sc-scenes-slot .st-scene:not(.is-now)');
    await t.waitFor(() => t.page.evaluate(() => !!window.LAStage.looking && !!document.querySelector('.st-look:not([hidden]) .st-look-stage:not([hidden]) .st-stage')), { timeout: 15000, what: '点①盖上只读的回看' });
    check(await t.page.evaluate(() => { const s = window.LAStage.lookback.stageOf(1)?.scene; return !!s && s.objects.has('a'); }), '回看里不是第一幕最后的样子（没有第一幕的一排格子 a）');
    await sleep(600);
    await t.page.click('.st-look-back');
    await t.waitFor(() => t.page.evaluate(() => !window.LAStage.looking), { timeout: 8000, what: '点「回到现在」关上回看' });
    await sleep(800);
    check(await claudeTurns() === c6, '翻回去看了一幕，页面却叫了老师');
    await t.waitFor(async () => (await turns()).filter((x) => x.role === 'student').at(-1)?.events?.some((e) => e.kind === 'look'), { what: '回看攒进还没发出去的那一段' });
    await t.page.reload(); await t.page.waitForLoadState('load');
    await t.waitFor(() => t.page.evaluate(() => document.querySelectorAll('.sc-scenes-slot .st-scene').length === 2 && !window.LAStage.looking), { timeout: 20000, what: '刷新以后幕条还是两幕、回看关着' });
    // 自由构图（第八轮）：老师写 preview，页面排好把字画的版面交回、马上再叫老师；舞台现状里有「版面」
    await said('测试:预览');
    await t.waitFor(async () => (await turns()).some((x) => x.role === 'claude' && x.cost?.why === 'preview'), { timeout: 40000, what: '写了 preview 以后页面马上再叫老师（花费记 why: preview）' });
    check((await turns()).some((x) => x.role === 'student' && /\[预览\][\s\S]*版面（48 列/.test(x.msg || '')), '预览交回老师的那一条里没有版面');
    check(await t.page.evaluate(() => /版面（48 列/.test(window.LAStage.scene.stateText())), '舞台现状里没有「版面」');
    await t.waitFor(() => t.page.evaluate(() => window.LAStage?.scene.waiting?.button === '看好了'), { timeout: 30000, what: '预览以后的那一轮演完、等学生点「看好了」' });
    // 一直用的样子（第九轮）：老师写 look * frame=none always → meta/look 记下了
    await said('测试:不要框');
    await t.waitFor(async () => ((await t.db())['meta/look']?.looks || []).some((l) => l.target === '*' && l.props?.frame === 'none'), { timeout: 30000, what: 'look * frame=none always 存进 meta/look' });
    // 老师的眼睛（第九轮）：每轮调用都带着一张画面图，花费里记了图多大
    check(await t.page.evaluate(() => window.LAStageDev?.lastImages === 1), `老师那一轮没收到画面图（收到 ${await t.page.evaluate(() => window.LAStageDev?.lastImages)} 张）`);
    check((await turns()).some((x) => x.role === 'claude' && x.cost?.img > 0), '花费里没记画面图');
    // Apple Pencil 直接写在画面上 + 附图（2026-11-14）：Pencil 一碰画面就写（手指不写），写了字按钮变「给老师看」，
    // 附一张图有缩略图；点了以后老师收到画面图 + 附的那张、那一条里写着手写和附图；写的字留在画面上，按钮回到「说」
    await t.waitFor(() => t.page.$('#st-say-input'), { timeout: 20000, what: '写字之前输入框在' });
    await sleep(800);
    const inkC0 = await claudeTurns();
    await t.page.evaluate(() => {
      const v = document.querySelector('.sc-stage .st-view'), r = v.getBoundingClientRect();
      const fire = (type, x, y, kind = 'pen', id = 7) => v.dispatchEvent(new PointerEvent(type, { pointerType: kind, pointerId: id, isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, pressure: 0.5 }));
      fire('pointerdown', 120, 140); for (let i = 1; i <= 10; i++) fire('pointermove', 120 + i * 12, 140 + i * 4); fire('pointerup', 240, 180);
    });
    check(await t.page.evaluate(() => window.LAStage.pen?.count() === 1), 'Pencil 在画面上写了一笔，舞台没记下');
    check(await t.page.evaluate(() => !document.querySelector('.st-ink-bar').hidden), '写了字以后没出现「撤一笔」「擦掉」');
    check(await t.page.$eval('.st-say .st-say-go', (b) => b.textContent) === '给老师看', '写了字以后发送按钮不是「给老师看」');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64');
    await t.page.setInputFiles('.st-say input[type=file]', { name: 'shot.png', mimeType: 'image/png', buffer: png });
    await t.waitFor(() => t.page.$('.st-attach-thumb img'), { timeout: 8000, what: '附的图出现缩略图' });
    await t.page.click('.st-say-go');
    const inkTurn = await t.waitFor(async () => (await turns()).find((x) => x.role === 'student' && !x.pending && /Pencil 在画面上写了字/.test(x.msg || '') && /附了 1 张图/.test(x.msg || '')), { timeout: 20000, what: '给老师看：那一条里写着手写和附图' });
    check(!!inkTurn, '给老师看没发出去');
    await t.waitFor(async () => (await claudeTurns()) > inkC0, { timeout: 30000, what: '给老师看以后老师接了一轮' });
    check(await t.page.evaluate(() => window.LAStageDev?.lastImages === 2), `给老师看那一轮老师没收到画面图和附的图两张（收到 ${await t.page.evaluate(() => window.LAStageDev?.lastImages)} 张）`);
    check(await t.page.evaluate(() => window.LAStage.pen.count() === 1 && window.LAStage.pen.unsent() === 0), '给老师看以后写的字没留在画面上（我选的：留着，自己擦）');
    check(!(await t.page.$('.st-attach-thumb')), '发出去以后附图的缩略图还在');
    await t.page.click('.st-ink-clear');
    check(await t.page.evaluate(() => window.LAStage.pen.count() === 0 && document.querySelector('.st-ink-bar').hidden), '点「擦掉」以后字没擦干净');
    await t.waitFor(() => t.page.$('#st-say-input'), { timeout: 20000, what: '老师接完以后能打字' });
    await said('测试:下课');
    await t.waitFor(() => t.page.evaluate(() => /下课吗/.test(document.body.innerText)), { timeout: 20000, what: '老师又递了「下课吗？」' });
    await t.answer('下课');
    await t.waitFor(() => t.page.$('.sc-closing:not([hidden]) .sc-sum'), { timeout: 30000, what: '下课小结画出来' });
    const s = await t.waitFor(async () => { const x = (await t.docs('sessions')).find((d) => d.id === sid); return x?.status === 'closed' && x.report?.at ? x : null; }, { timeout: 20000, what: '下课以后报告写好' });
    check(s.verify?.turns >= 4, `下课时 verify 记得不对：${JSON.stringify(s.verify)}`);
    const rep = (await t.db())[`sessions/${sid}/report/main`];
    check((rep?.items || []).filter((it) => /^S\d/.test(it.comp || '')).length >= 2, `报告里没有舞台上的题：${JSON.stringify((rep?.items || []).map((x) => x.comp))}`);
    check((rep?.scenes || []).length === 2 && rep.scenes[1].title === '第二段' && /从下往上看平衡因子/.test(rep.scenes[1].keys.join('')), `报告里这节课的几幕不对：${JSON.stringify(rep?.scenes)}`);
    // 翻看：照记录放回，只读、不调用
    await t.open(`view/${sid}`);
    await t.waitFor(() => t.page.$('.sc-root .st-cell'), { timeout: 20000, what: '只读的舞台画出来' });
    await sleep(1200);
    check(!(await t.page.$('.sc-end')), '只读的舞台课还能点「下课」');
    check(/那今天就到这里/.test(await t.page.$eval('.st-caption', (n) => n.textContent)), '只读的舞台课上面没有最后说的那句话');
    return t;
  },

  // 舞台课卡住了：挑战还没做到、学生一直没动，页面自己叫老师（?dev&quiet=3 把等待缩成 3 秒），发过去的写着「几秒没动」
  async stagestuck(browser) {
    const t = await seeded(browser);
    await t.page.click('.dk-class .dk-new');
    await t.page.waitForURL((u) => /#c-\d{8}-\d+/.test(u.hash), { timeout: 20000 });
    await t.page.waitForLoadState('load');
    const sid = decodeURIComponent(new URL(t.page.url()).hash.slice(1));
    const turns = async () => Object.entries(await t.db()).filter(([k]) => k.startsWith(`sessions/${sid}/class_turns/`)).map(([, v]) => v).sort((a, b) => a.seq - b.seq);
    const node = (pid) => t.page.evaluate((k) => { const r = window.LAStage?.nodes.get(k)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, pid);
    await t.waitFor(() => t.page.$('.st-cell.is-tap'), { timeout: 30000, what: '第一轮' });
    await sleep(400);
    const p = await node('a:9'); await t.page.mouse.move(p.x, p.y); await t.page.mouse.down(); await t.page.mouse.up();
    await t.waitFor(() => t.page.$('.st-say.is-main input'), { timeout: 30000, what: '第二轮' });
    await t.page.fill('#st-say-input', '5'); await t.page.click('.st-say-go');
    await t.waitFor(() => t.page.evaluate(() => window.LAStage?.scene.waiting?.button === '给个提示'), { timeout: 30000, what: '第三轮的挑战' });
    // 带上 quiet=3 重新打开：照记录放回、接着等；3 秒不动就叫老师
    const url = new URL(t.page.url());
    url.search = `${url.search}${url.search ? '&' : '?'}quiet=3`;
    await t.page.goto(url.toString()); await t.page.waitForLoadState('load');
    const sent = await t.waitFor(async () => (await turns()).find((x) => x.role === 'student' && !x.pending && (x.events || []).some((e) => e.kind === 'stuck')), { timeout: 30000, what: '学生一直没动，页面自己叫老师' });
    check(/3 秒没动，挑战 g1 还没做到/.test(sent.msg || ''), `发给老师的没写学生几秒没动：${sent.msg}`);
    await t.waitFor(async () => (await turns()).some((x) => x.role === 'claude' && x.seq > sent.seq), { timeout: 30000, what: '老师接着写了一轮' });
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

  // 舞台上自己练（主线第四轮）：题库里放一道舞台题（黑板组件 stage）。练一练里它嵌一块没有老师的舞台，按住一张牌拖过去，
  // 页面照引擎判；走完算做对一道题（是原题换数：复现组档位不动）。第二节走到一半就回学习台、直接下课：记放弃，复现组记没过
  async stagedrill(browser) {
    const t = await seeded(browser);
    const plant = async (md) => t.page.evaluate((md) => {
      const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:'));
      const all = JSON.parse(localStorage.getItem(k));
      for (const p of Object.keys(all)) if (p.startsWith('drills/')) delete all[p];
      all['drills/d-stage-e2e'] = { block: 'L2.2.2', kind: 'stage', md, q: '照 直接插入排序 走一遍', title: '直接插入排序', src: 'stage', random: true, review: 'R3', fromSession: 'c-20261020-1', space: 'math', status: 'active', orig: 'wrong', at: Date.parse('2026-10-20T10:00:00+08:00') };
      localStorage.setItem(k, JSON.stringify(all));
    }, md);
    const start = async () => {
      await t.open(); await sleep(1500);
      await t.waitFor(() => t.page.$('.dk-trow[data-row="drill"]'), { what: '首页出现「练一练」' });
      await t.page.click('.dk-trow[data-row="drill"]'); await sleep(800);
      await t.page.click('.fl-panel .dk-drill-go');
      const id = await t.inClass();
      await t.waitFor(() => t.page.evaluate(() => !!document.querySelector('.block-stagedrill')?.__stage?.scene.objects.get('a')?.follow), { timeout: 15000, what: '舞台题演出来、照着引擎走' });
      await sleep(900);
      // 牌都在那块舞台的框里（主线第五轮：框改矮以后镜头照原来的高摆，带分组弧线的一排牌被裁到框外面）
      const cut = await t.page.evaluate(() => { const e = document.querySelector('.block-stagedrill'); const b = e.querySelector('.sd-stage').getBoundingClientRect(); const st = e.__stage; return st.scene.objects.get('a').cells.filter((c) => { const r = st.nodes.get(`a:${c.key}`).getBoundingClientRect(); return r.top < b.top - 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.right > b.right + 1; }).length; });
      check(cut === 0, `舞台题里有 ${cut} 张牌在框外面（被裁掉了）`);
      return id;
    };
    // 按住一张牌 0.45 秒，拖到另一张上（对调）。牌按现在在第几格找
    const swap = async (from, to) => {
      const at = (slot) => t.page.evaluate((slot) => { const st = document.querySelector('.block-stagedrill').__stage; const c = st.scene.objects.get('a').cells.find((x) => x.slot === slot); const r = st.nodes.get(`a:${c.key}`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, slot);
      await t.page.evaluate(() => document.querySelector('.block-stagedrill .sd-stage').scrollIntoView({ block: 'center' }));
      await sleep(300);
      const a = await at(from), b = await at(to);
      await t.page.mouse.move(a.x, a.y); await t.page.mouse.down(); await sleep(450);
      for (let i = 1; i <= 12; i++) { await t.page.mouse.move(a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12); await sleep(16); }
      await sleep(80); await t.page.mouse.up(); await sleep(1200);
    };
    const r0 = (await t.docs('reviews')).find((r) => r.id === 'R3');
    // 第一节：两张牌、每次换数（取出来一定是前大后小），拖一下就走完
    await plant('```stage\nid: d-stage-e2e\npick a = seq(2, 1, 9) distinct\n---\narray a = {a}\nfollow a sort insert\ngroup a stride=1\nopen a move\n```');
    const did = await start();
    // 题目一行大字、下面一句手怎么动（主线第五轮首课走查：以前是一行小灰字，没写怎么动）
    check(/照 直接插入排序 走一遍/.test(await t.text('.sd-q') || '') && /按住一张拖/.test(await t.text('.sd-lead') || ''), `舞台题的题目、手怎么动没写出来：${await t.text('.sd-q')}｜${await t.text('.sd-lead')}`);
    await swap(1, 2);
    await t.waitFor(() => t.page.evaluate(() => /走完了/.test(document.querySelector('.sd-note')?.textContent || '')), { timeout: 8000, what: '拖完页面说走完了' });
    await t.page.click('.dr-next');
    const d = await t.waitFor(async () => (await t.docs('sessions')).find((x) => x.id === did && x.status === 'closed' && x.drill), { timeout: 25000, what: '练一练做完写进 sessions' });
    check(d.drill.n === 1 && d.drill.clean === 1, `舞台题走完、一次做对，结果记成 ${JSON.stringify(d.drill)}`);
    const ev = (await t.docs('evidence')).filter((e) => e.session === did && e.comp === 'd-stage-e2e');
    check(ev.some((e) => e.kind === 'stage' && e.ok === true), `证据里没有舞台题做对的那一条：${JSON.stringify(ev).slice(0, 300)}`);
    const r1 = (await t.docs('reviews')).find((r) => r.id === 'R3');
    check(r1.tier === r0.tier, `舞台题是原题换数，都做对档位不该动（${r0.tier} → ${r1.tier}）`);
    // 第二节：三张牌、两趟。只做第一趟就回学习台、直接下课：记放弃
    await t.page.evaluate(() => { const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:')); const all = JSON.parse(localStorage.getItem(k)); for (const p of Object.keys(all)) if (p.startsWith('evidence/')) delete all[p]; localStorage.setItem(k, JSON.stringify(all)); });
    await plant('```stage\nid: d-stage-e2e\n---\narray a = 3 1 2\nfollow a sort insert\nopen a move\n```');
    const did2 = await start();
    await swap(1, 2); // 3 1 2 → 1 3 2：第 1 趟做完，还差一趟
    await t.waitFor(() => t.page.evaluate(() => /第 1 趟做完了/.test(document.querySelector('.sd-note')?.textContent || '')), { timeout: 8000, what: '第 1 趟做完页面说一声' });
    await t.page.click('.dr-home');
    await t.waitFor(() => t.page.evaluate(() => !location.hash && !!document.querySelector('.dk-class')), { timeout: 15000, what: '从练习回到学习台' });
    await t.page.waitForSelector('.dk-open .dk-close', { state: 'attached', timeout: 15000 });
    await t.page.evaluate((x) => document.querySelector(`.dk-open .dk-close[data-sid="${x}"]`)?.click(), did2);
    await t.answer('直接下课');
    const d2 = await t.waitFor(async () => (await t.docs('sessions')).find((x) => x.id === did2 && x.status === 'closed'), { timeout: 20000, what: '练一练直接下课' });
    check(d2.drill, '练一练直接下课以后没有算结果');
    const ev2 = (await t.docs('evidence')).filter((e) => e.session === did2);
    check(ev2.some((e) => e.kind === 'giveup' || e.giveup), `舞台题走到一半就走，没有记放弃：${JSON.stringify(ev2).slice(0, 300)}`);
    const r2 = (await t.docs('reviews')).find((r) => r.id === 'R3');
    check(r2.result !== r1.result || r2.last !== r1.last, `舞台题没走完，复现组 R3 没变（${JSON.stringify({ before: r1.result, after: r2.result })}）`);
    // 舞台课 → 题库：一节下了课的舞台课里老师写过 follow，首页打开时把它抄成一道舞台题（同一种只有一道）
    await t.page.evaluate(() => {
      const k = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((x) => x.startsWith('la-devdb:'));
      const all = JSON.parse(localStorage.getItem(k));
      all['sessions/c-20261101-9'] = { kind: 'stage', status: 'closed', block: 'DS-L8.2.3', space: 'cs', subject: '数据结构', date: '2026-11-01', startedAt: Date.parse('2026-11-01T10:00:00+08:00'), endedAt: Date.parse('2026-11-01T10:40:00+08:00'), report: { v: 99, items: 0, activeMs: 1000 } };
      all['sessions/c-20261101-9/class_turns/0001'] = { seq: 1, role: 'claude', session: 'c-20261101-9', at: Date.parse('2026-11-01T10:01:00+08:00'), text: 'array a = 49 38 65 97 76 13 27 49\nfollow a sort shell gaps="5 3 1"\nopen a move\nsay "隔 5 个一组"' };
      localStorage.setItem(k, JSON.stringify(all));
    });
    await t.open();
    const got = await t.waitFor(async () => (await t.docs('drills')).find((d) => d.id === 'd-stage-DS-L8_2_3-sort-algo_shell_gaps_5_3_1'), { timeout: 20000, what: '下了课的舞台课里的 follow 抄进题库' });
    check(got.kind === 'stage' && got.space === 'cs' && /pick a = seq\(8, 13, 97\) distinct/.test(got.md), `抄出来的舞台题不对：${JSON.stringify(got).slice(0, 300)}`);
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

  // 备课：首页「让 Claude 备课」（本地用模拟的 Claude），教案写进资料包；马上开课，课前预演最后也要到这节课自己的那份资料包里
  async prep(browser) {
    const t = await seeded(browser);
    await t.page.evaluate(() => { const f = document.querySelector('.dk-prepfold'); if (f) f.open = true; });
    await t.page.click('.dk-prep-go');
    if (await t.page.$('.la-dialog')) await t.answer('重新备课');
    const main = await t.waitFor(async () => { const m = (await t.db())['pack/main']; return m?.by === 'desk' && !m.usedBy ? m : null; }, { timeout: 30000, what: '备好的教案写进 pack/main' });
    check(main.unit || main.goal, '备好的教案没有标题和目标');
    await t.waitFor(() => t.page.evaluate(() => /备好的下一节/.test(document.querySelector('.dk-class')?.innerText || '')), { what: '主角卡换成「备好的下一节」' });
    await t.page.click('.dk-class .dk-new');
    const sid = await t.inClass();
    const sp = await t.waitFor(async () => (await t.db())[`sessions/${sid}/pack/main`]?.rehearsal, { timeout: 30000, what: '课前预演到这节课的资料包里（开课以后才写好的也要补进去）' });
    check(Array.isArray(sp.steps) || sp.fixes || sp.at, '课前预演是空的');
    const root = (await t.db())['pack/main'];
    check(root.usedBy === sid, '开了课，备好的教案没记成用掉了');
    return t;
  },

  // 对话里的 Claude 开的实时黑板、自学单元：打得开，「用完了 / 学完了」以后下课、首页补上报告
  async outside(browser) {
    const t = await seeded(browser);
    const today = await todayIn(t);
    const day = today.replace(/-/g, '');
    await plant(t, {
      [`sessions/c-${day}-7`]: { kind: 'live', status: 'open', date: today, block: 'L2.2.2', space: 'math', title: '实时黑板（自动测试）', startedAt: Date.now() - 60000 },
      [`sessions/c-${day}-8`]: { kind: 'unit', status: 'open', date: today, block: 'L2.2.2', space: 'math', title: '自学单元（自动测试）', startedAt: Date.now() - 60000 },
      [`sessions/c-${day}-8/unit/main`]: { md: '---\nmode: guided\n---\n\n# 自学单元\n\n## 第一节\n\n内积 $\\alpha^T\\beta$ 是一个数。\n\n```quiz\nid: u1\nq: $\\alpha^T\\beta$ 是\n- [x] 一个数\n- [ ] 一个矩阵\n```\n', session: `c-${day}-8` },
    });
    await t.open(`c-${day}-7`);
    await t.waitFor(() => t.page.evaluate(() => !!document.querySelector('.cb-end')), { timeout: 20000, what: '实时黑板画出来（有「这块黑板用完了」）' });
    await t.page.evaluate(() => document.querySelector('.cb-end').click());
    await t.answer('用完了');
    await t.waitFor(async () => (await t.docs('sessions')).find((x) => x.id === `c-${day}-7`)?.status === 'closed', { what: '实时黑板用完了记成下课' });
    await t.open(`c-${day}-8`);
    await t.waitFor(() => t.page.$('button:has-text("继续")'), { timeout: 20000, what: '自学单元画出来' });
    check(!(await t.page.evaluate(() => document.body.innerText.includes('mode: guided'))), '自学单元开头的 front matter 原样印在页面上');
    await t.page.click('button:has-text("继续")');
    await t.waitFor(() => t.page.evaluate(() => document.body.innerText.includes('内积')), { timeout: 10000, what: '自学单元第一节解锁' });
    await t.page.click('.dk-u-end');
    await t.answer('用完了');
    await t.waitFor(async () => (await t.docs('sessions')).find((x) => x.id === `c-${day}-8`)?.status === 'closed', { what: '自学单元学完了记成下课' });
    await t.open();
    await t.waitFor(async () => { const all = await t.docs('sessions'); return [7, 8].every((n) => all.find((x) => x.id === `c-${day}-${n}`)?.report?.at); }, { timeout: 25000, what: '首页给实时黑板、自学单元补上课后报告' });
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
    check(!obs.some((o) => o.session === sid && String(o.text).endsWith('想看守卫。')), '和第一条几乎一样的那条应该拒收');
    const turns = Object.entries(await t.db()).filter(([k]) => k.startsWith(`sessions/${sid}/class_turns/`)).map(([, v]) => v);
    check(turns.some((x) => x.role === 'system' && /没记/.test(String(x.text))), '拒收的那条应该在下一轮告诉课堂 Claude');
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

  // 云端教研室（docs/lab-plan.md）：首页照工作单拼单子 lab_brief；模拟教研室交回答 lab_inbox：
  // 补收尾（小结 + 整理单：引对了的照收、编原话的暂存）、出新题（好的进题库、写坏的不收）、备课（写进资料包），每份都有回执
  async lab(browser) {
    const t = await seeded(browser);
    const sid = 'c-20261101-1';
    const at = Date.parse('2026-11-01T10:00:00+08:00');
    await plant(t, {
      [`sessions/${sid}`]: { kind: 'class', status: 'closed', date: '2026-11-01', block: 'L2.2.2', space: 'math', subject: '线性代数', title: '内积', startedAt: at, endedAt: at + 1800000, report: { items: 2, activeMs: 900000, line: '两道题' } },
      [`sessions/${sid}/class_turns/1`]: { seq: 1, role: 'student', say: '内积算出来是一个数吗', text: '内积算出来是一个数吗', at: at + 1000, session: sid },
      [`sessions/${sid}/class_turns/2`]: { seq: 2, role: 'claude', text: '对，是一个数。看这道题。\n\n````board new id=b1 title="内积"\n```quiz\nid: qz-b1\nq: αᵀβ 是什么\n- [x] 一个数\n- [ ] 一个矩阵\n```\n````', modelApplied: 'claude-opus-5-5', at: at + 2000, session: sid },
      'reviews/R9': { title: '内积的形状', family: '形状', tier: 3, last: '2026-10-20', result: '过', blocks: ['L2.2.2'], log: [] },
      'evidence/ev-e2e-lab1': { kind: 'answer', session: sid, comp: 'qz-b1', block: 'L2.2.2', ok: false, value: '一个矩阵', src: 'record', at: at + 3000, turn: 2 },
    });
    await t.open('manage');
    const briefs = await t.waitFor(async () => { const b = await t.docs('lab_brief'); return b.some((x) => x.kind === 'backfill') && b.some((x) => x.kind === 'newproblems' || x.kind === 'probe') ? b : null; }, { timeout: 20000, what: '首页照工作单拼出教研室的单子（补收尾、出新题）' }).catch(async (e) => { if (process.env.E2E_DEBUG) { const all = await t.db(); console.log('WO', JSON.stringify(all['meta/workorder']?.items?.map((x) => [x.kind, x.ref])), 'BR', Object.keys(all).filter((k) => k.startsWith('lab_')), t.errors, JSON.stringify(all['meta/errors'])); } throw e; });
    const bf = briefs.find((x) => x.kind === 'backfill' && x.ref === sid);
    check(bf && bf.prompt.includes('内积算出来是一个数吗') && bf.prompt.includes('整理单'), '补收尾的单子里没有这节课的记录或下课的要求');
    check(!/[他她]/.test(bf.prompt.split('### 学生的记忆')[0].replace(/「[他她]」/g, '')), '单子开头的说明里称呼学生用了他 / 她');
    const np = briefs.find((x) => x.kind === 'newproblems' || x.kind === 'probe');
    const pp = briefs.find((x) => x.kind === 'prep');
    const quiz = '```quiz\nid: x\nq: 两个 3 维列向量 a、b，aᵀb 的结果是什么\n- [x] 一个数\n- [ ] 一个 3×3 矩阵\n- [ ] 一个 3 维向量\n```';
    await plantLive(t, {
      'lab_inbox/e2e-1': { brief: bf.id, key: bf.key, by: 'lab', model: 'claude-opus-5-5', at: Date.now(), text: '1. 这节课讲了什么：讲了内积，用了一道选择题 qz-b1。\n2. 学生哪里卡住：#1 学生问「内积算出来是一个数吗」，qz-b1 选成了一个矩阵。\n3. 哪里看起来懂了但证据不够：只做过一道。\n4. 建议下一节怎么接：先换数再测一次内积的结果是什么。\n\n````board memo\nnote text="#1 学生问「内积算出来是一个数吗」，下一节开头换数再测"\nslip text="#2 学生说「我早就背熟了」，老师没追问"\n````' },
      'lab_inbox/e2e-2': { brief: np.id, key: np.key, by: 'lab', at: Date.now() + 1, text: `=== 题 1\n针对：内积的结果是数还是矩阵\n${quiz}\n\n=== 题 2\n针对：写坏的\n\`\`\`answer\nid: y\nq: 这道题没有答案\n\`\`\`` },
      ...(pp ? { 'lab_inbox/e2e-3': { brief: pp.id, key: pp.key, by: 'lab', at: Date.now() + 2, text: '{"unit":"内积","goal":"会算内积、知道结果是一个数","route":"先猜再算","sequence":[{"step":1,"point":"内积的定义","how":"先让学生猜"}],"problems":[]}' } } : {}),
      'lab_inbox/e2e-4': { brief: 'backfill-nothing', key: 'x', by: 'lab', at: Date.now() + 3, text: '这张单子不存在，应该写一条过时的回执' },
    });
    const logs = await t.waitFor(async () => { const l = await t.docs('lab_inbox_log'); return l.length >= (pp ? 4 : 3) ? l : null; }, { timeout: 20000, what: '学习台读完教研室的回答、写回执' }).catch(async (e) => { if (process.env.E2E_DEBUG) { const all = await t.db(); console.log('KEYS', Object.keys(all).filter((k) => k.startsWith('lab_')), JSON.stringify(Object.entries(all).filter(([k]) => k.startsWith('lab_inbox_log')).map(([k, v]) => [k, v])), t.errors, JSON.stringify(all['meta/errors'])); } throw e; });
    check(!(await t.docs('lab_inbox')).length, '读过的回答没从收件箱删掉');
    const r1 = logs.find((x) => x.id === 'e2e-1');
    check(r1?.result === 'partial' && r1.took?.summary === 1 && r1.held >= 1, `补收尾的回执不对：${JSON.stringify(r1)}`);
    const obs = await t.docs('observations');
    const sum = obs.find((o) => o.session === sid && o.kind === 'summary');
    check(sum?.by === 'lab' && sum.backfill && String(sum.text).startsWith('1. 这节课讲了什么'), '补写的小结没写进去、或者没标事后补写');
    check((await t.docs('sessions')).find((x) => x.id === sid)?.summary === sum.id, '这节课没记上小结');
    const note = obs.find((o) => o.session === sid && String(o.text).includes('下一节开头换数再测'));
    check(note?.by === 'lab' && note.backfill && !note.guard, '引对了原话的那条应该照收（标事后补写）');
    const held = (await t.docs('pending')).find((p) => p.status === 'held' && p.by === 'lab' && String(p.line || '').includes('早就背熟了'));
    check(held && !(await t.docs('slips')).some((x) => String(x.text).includes('早就背熟了')), '编了原话的那条应该先暂存、不写进去');
    const r2 = logs.find((x) => x.id === 'e2e-2');
    check(r2?.result === 'partial' && r2.took?.drills === 1 && r2.rejected?.length === 1, `出新题的回执不对：${JSON.stringify(r2)}`);
    const dr = (await t.docs('drills')).filter((d) => d.src === 'lab');
    check(dr.length === 1 && dr[0].md.includes(`id: ${dr[0].id}`) && dr[0].block, '好的那道新题没进题库（或者编号没换）');
    if (pp) {
      check(logs.find((x) => x.id === 'e2e-3')?.result === 'ok', '备课的回执不对');
      check((await t.db())['pack/main']?.by === 'lab', '教研室备的课没写进资料包');
    }
    check(logs.find((x) => x.id === 'e2e-4')?.result === 'stale', '对不上单子的回答应该写过时的回执');
    await t.waitFor(async () => /云端教研室/.test(await t.text('.dk-work') || '') && /交回来的/.test(await t.text('.dk-work') || ''), { what: '管理页「后方的工作单」里写出教研室交回来的' });
    // 做完的单子撤掉了：补收尾那张没了
    await t.waitFor(async () => !(await t.docs('lab_brief')).some((x) => x.id === bf.id), { what: '做完的补收尾单子撤掉' });
    return t;
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

  // 备份：导出一份，原样「只补缺的」恢复回去，条数不变、页面不报错
  async backup(browser) {
    const t = await seeded(browser);
    await t.route('manage');
    const [dl] = await Promise.all([t.page.waitForEvent('download', { timeout: 15000 }), t.page.click('.dk-backup .dk-bgo')]);
    const path = await dl.path();
    const body = JSON.parse(readFileSync(path, 'utf8'));
    check(Array.isArray(body.docs) && body.docs.length > 10, '导出的备份里几乎没有东西');
    const n0 = Object.keys(await t.db()).length;
    await t.page.setInputFiles('.dk-brestore input', path); await sleep(1500);
    if (await t.page.$('.la-dialog')) await t.answer('只补缺的').catch(() => t.answer('补'));
    await sleep(2000);
    const n1 = Object.keys(await t.db()).length;
    check(n1 >= n0, `恢复以后数据库少了东西：${n0} → ${n1}`);
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
    // 后方的工作单（sentry.js）：首页算好写进 meta/workorder，管理页列出来
    const wo = await t.waitFor(async () => (await t.db())['meta/workorder'], { timeout: 15000, what: '工作单写进 meta/workorder' });
    check(Array.isArray(wo.items) && wo.recheck && typeof wo.recheck.math === 'string', 'meta/workorder 的样子不对');
    check((await t.text('.dk-work'))?.includes('后方的工作单'), '管理页看不到后方的工作单');
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
    await t.waitFor(async () => (await t.text('.fl-panel'))?.includes('这一周的时间怎么分'), { what: '「下一步学什么」的面板' });
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

  // 课堂助手（第九轮，aide/）：下了课的舞台课首页后台整理（复盘、归类、事实、学生卡，模拟 Claude）；开新的舞台课记 aide、说明里带学生卡
  async aide(browser) {
    const t = await seeded(browser);
    const sid = 'c-20261101-2';
    const at = Date.parse('2026-11-01T10:00:00+08:00');
    await plant(t, {
      [`sessions/${sid}`]: { kind: 'stage', aide: 1, status: 'closed', date: '2026-11-01', block: 'L2.2.2', space: 'math', subject: '线性代数', title: 'Aⁿ', startedAt: at, endedAt: at + 1800000, summary: 'ob-e2e-aide', report: { at: at + 1800000, items: 1, activeMs: 900000, line: '一道题' } },
      [`sessions/${sid}/class_turns/000001`]: { seq: 1, role: 'claude', text: 'say "βᵀα 是什么？"\nask text', modelApplied: 'claude-opus-5-5', at: at + 1000, session: sid },
      [`sessions/${sid}/class_turns/000002`]: { seq: 2, role: 'student', text: '一个矩阵', msg: '[学生]\n写了「一个矩阵」', at: at + 2000, session: sid },
      [`sessions/${sid}/report/main`]: { at: at + 1800000, session: sid, block: 'L2.2.2', totals: { items: 1, wrong: 1 }, items: [{ key: 'S1', comp: 'S1', q: 'βᵀα 是什么', seq: '×', outcome: 'wrong', tags: ['L2.2.2'], evidence: ['ev-e2e-aide1'] }] },
      'observations/ob-e2e-aide': { kind: 'summary', session: sid, text: '小结：内积和外积还没分开', at: at + 1800000, block: 'L2.2.2' },
      'evidence/ev-e2e-aide1': { kind: 'answer', session: sid, comp: 'S1', block: 'L2.2.2', ok: false, value: '一个矩阵', q: 'βᵀα 是什么', src: 'record', at: at + 3000, turn: 1 },
    });
    await t.open();
    const s = await t.waitFor(async () => { const x = (await t.db())[`sessions/${sid}`]; return x?.after?.at ? x : null; }, { timeout: 30000, what: '首页后台做完这节课的下课后整理' });
    check(s.debrief && s.skills?.items?.length === 1, `下课后整理没写复盘或归类：${JSON.stringify({ d: !!s.debrief, k: s.skills?.items?.length })}`);
    check(!(await t.docs('pending')).some((p) => p.status === 'held'), '助手写的东西挂起等放行了（不该有要我确认的）');
    const card = await t.waitFor(async () => (await t.db())['cards/L2.2.2'], { timeout: 10000, what: '这一块的学生卡写上' });
    check(card.by === 'aide' && /概括｜/.test(card.text), `学生卡不对：${JSON.stringify(card)}`);
    // 开一节新的舞台课：记 aide，说明里「你对学生的了解」带上学生卡
    await t.page.click('.dk-class .dk-new');
    await t.page.waitForURL((u) => /#c-\d{8}-\d+/.test(u.hash), { timeout: 20000 });
    await t.page.waitForLoadState('load');
    await t.waitFor(() => t.page.$('.sc-root .st-stage'), { timeout: 20000, what: '舞台课画出来' });
    const nid = decodeURIComponent(new URL(t.page.url()).hash.slice(1));
    check((await t.docs('sessions')).find((d) => d.id === nid)?.aide === 1, '新开的舞台课没记 aide');
    const sys = await t.waitFor(() => t.page.evaluate(() => window.LAStageClass?.system?.()), { timeout: 10000, what: '拿到这节课的说明' });
    check(sys.includes('### 学生卡：L2.2.2'), '新开的舞台课说明里没带学生卡');
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
