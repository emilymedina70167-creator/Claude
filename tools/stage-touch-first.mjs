// 首课走查的真手指（主线第五轮）：三节课里学生最要紧的那几下，在课上那样的舞台上用真的触摸（CDP touch）做一遍。
// tools/stage-touch.mjs 是一条线跑到底的整套（慢）；这里一段一节课，改了那一节用到的手势只跑那一段：
//   node tools/stage-touch-first.mjs [--only shell,tense,power]     （先 node proto/stage/build.mjs）  没问题退出码 0
import { chromium } from './playwright.mjs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const PAGE = pathToFileURL(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'proto/stage/dist/local.html')).href;
const only = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1].split(',') : null; })();
const bad = [];
const expect = (what, got, want) => { const ok = got === want; console.log(`${ok ? '✓' : '✗'} ${what}：${got}${ok ? '' : `（应该是 ${want}）`}`); if (!ok) bad.push(what); };
const browser = await chromium.launch();
const errs = [];

async function open(view = { width: 820, height: 1180 }) {
  const ctx = await browser.newContext({ viewport: view, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${PAGE}?dev&blank`);
  await page.waitForFunction(() => window.LAStage);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
  const T = {
    page, ctx,
    wait: (ms) => page.waitForTimeout(ms),
    // 按下就拖（只开了一种按法的东西）
    drag: async (a, b, { steps = 12 } = {}) => {
      await touch('touchStart', a.x, a.y);
      for (let i = 1; i <= steps; i++) { await touch('touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await page.waitForTimeout(16); }
      await page.waitForTimeout(60);
      await touch('touchEnd');
    },
    // 拖出去再拖回原处松手
    dragBack: async (a, b, { steps = 10 } = {}) => {
      await touch('touchStart', a.x, a.y);
      for (let i = 1; i <= steps; i++) { await touch('touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await page.waitForTimeout(16); }
      for (let i = steps - 1; i >= 0; i--) { await touch('touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await page.waitForTimeout(16); }
      await page.waitForTimeout(60);
      await touch('touchEnd');
    },
    holdDrag: async (a, b, { ms = 400, steps = 12 } = {}) => {
      await touch('touchStart', a.x, a.y);
      await page.waitForTimeout(ms);
      for (let i = 1; i <= steps; i++) { await touch('touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await page.waitForTimeout(16); }
      await page.waitForTimeout(60);
      await touch('touchEnd');
    },
    tap: async (p) => { await touch('touchStart', p.x, p.y); await page.waitForTimeout(40); await touch('touchEnd'); },
    play: (src) => page.evaluate(async (src) => { const st = window.LAStage; st.cancelWait?.(); st.clearAll(); st.log = []; const t = st.begin(); t.end(src); await t.armed; await new Promise((r) => setTimeout(r, 700)); }, src),
    box: (pid) => page.evaluate((k) => { const r = window.LAStage.nodes.get(k).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, pid),
    sel: (css) => page.evaluate((css) => { const n = document.querySelector(css); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, css),
    srcs: () => page.evaluate(() => window.LAStage.log.map((r) => r.src)),
    vals: (id) => page.evaluate((id) => [...window.LAStage.scene.objects.get(id).cells].sort((x, y) => x.slot - y.slot).map((c) => (c.value === '' ? '□' : c.value)).join(' '), id),
    state: () => page.evaluate(() => window.LAStage.scene.stateText()),
  };
  T.added = async (before) => (await T.srcs()).slice(before.length).join(' | ') || '没有';
  return T;
}
const SECTIONS = {};

// —— 希尔排序（DS-L8.2.3）：10 格、分了组、照引擎走、open a move undo=on ——
SECTIONS.shell = async () => {
  for (const [tag, view] of [['竖屏', { width: 820, height: 1180 }], ['横屏', { width: 1180, height: 820 }]]) {
    const T = await open(view);
    await T.play('array a = 49 38 65 97 76 13 27 49′ 55 04\ngroup a stride=5\nfollow a sort shell gaps="5 3 1"\nopen a move undo=on\nsay "每组里把小的拖到前面。"');
    const cell = await T.box('a:1');
    expect(`${tag}：10 格的一排，一格手指按得到（≥ 44）`, String(Math.min(cell.w, cell.h) >= 44), 'true');
    // 1. 按下就拖（只开了 move）：49 拖到隔 5 格的 13 上，对调
    let before = await T.srcs();
    let A = await T.box('a:1'), B = await T.box('a:6');
    await T.drag({ x: A.cx, y: A.cy }, { x: B.cx, y: B.cy });
    await T.wait(1200);
    expect(`${tag}：按下就拖，49 拖到隔 5 格的 13 上`, `${await T.added(before)}｜${await T.vals('a')}`, 'swap a#1 a#6｜13 38 65 97 76 49 27 49′ 55 04');
    // 2. 拖一半又放回原处：什么都不变、不记一下
    before = await T.srcs();
    A = await T.box('a:2'); B = await T.box('a:7');
    await T.dragBack({ x: A.cx, y: A.cy }, { x: (A.cx + B.cx) / 2, y: A.cy - 30 });
    await T.wait(900);
    expect(`${tag}：拖一半放回原处`, `${await T.added(before)}｜${await T.vals('a')}`, '没有｜13 38 65 97 76 49 27 49′ 55 04');
    // 3. 组间拖错（65 拖到挨着的 97 上）：照做；点「撤一步」回去
    before = await T.srcs();
    A = await T.box('a:3'); B = await T.box('a:4');
    await T.drag({ x: A.cx, y: A.cy }, { x: B.cx, y: B.cy });
    await T.wait(1200);
    expect(`${tag}：拖到挨着的那一张上（组间）`, `${await T.added(before)}｜${await T.vals('a')}`, 'swap a#3 a#4｜13 38 97 65 76 49 27 49′ 55 04');
    const undo = await T.sel('.st-undo');
    expect(`${tag}：「撤一步」手指按得到（≥ 44 高）`, String(!!undo && undo.h >= 44), 'true');
    if (undo) { await T.tap({ x: undo.cx, y: undo.cy }); await T.wait(1500); }
    expect(`${tag}：点「撤一步」`, await T.vals('a'), '13 38 65 97 76 49 27 49′ 55 04');
    // 4. 最后一趟的手：按住 04 拖到第 1 格前面（两格之间的缝很窄：松在第 1 格左半边也算插到它前面）
    await T.play('array a = 13 04 49′ 38 27 49 55 65 97 76\nfollow a sort insert\nopen a move undo=on');
    before = await T.srcs();
    A = await T.box('a:2'); B = await T.box('a:1');
    await T.holdDrag({ x: A.cx, y: A.cy }, { x: B.x - 6, y: B.cy });
    await T.wait(1300);
    expect(`${tag}：按住 04 拖到第 1 格前面，插进去`, `${await T.added(before)}｜${await T.vals('a')}`, 'move a#2 -> a.1｜04 13 49′ 38 27 49 55 65 97 76');
    // 5. 按住 27 拖到 49′ 和 38 之间的缝上（第 3、4 格之间）
    before = await T.srcs();
    A = await T.box('a:5'); B = await T.box('a:3'); const C = await T.box('a:4');
    await T.holdDrag({ x: A.cx, y: A.cy }, { x: (B.x + B.w + C.x) / 2, y: B.cy });
    await T.wait(1300);
    expect(`${tag}：按住 27 拖到第 3、4 格之间的缝上`, `${await T.added(before)}｜${await T.vals('a')}`, 'move a#5 -> a.4｜04 13 49′ 27 38 49 55 65 97 76');
    await T.ctx.close();
  }
};

// —— 时态（EN-L1.2.1）：两个拨词的拨盘 + 页面拼谓语的句子；时间轴上的小人 ——
SECTIONS.tense = async () => {
  for (const [tag, view] of [['竖屏', { width: 820, height: 1180 }], ['横屏', { width: 1180, height: 820 }]]) {
    const T = await open(view);
    const words = (id) => T.page.evaluate((id) => [...window.LAStage.scene.objects.get(id).words].sort((a, b) => a.slot - b.slot).map((w) => w.value).join(' '), id);
    const dial = (name) => T.page.evaluate((name) => { const n = window.LAStage.labelNodes.get(`dial:${name}`)?.node; if (!n) return null; const r = n.getBoundingClientRect(); const bs = [...n.querySelectorAll('.st-dial-b')].map((b) => { const q = b.getBoundingClientRect(); return { cx: q.x + q.width / 2, cy: q.y + q.height / 2, w: q.width, h: q.height }; }); return { x: r.x, y: r.y, w: r.width, h: r.height, dec: bs[0], inc: bs[1], text: n.querySelector('.st-dial-v').textContent }; }, name);
    await T.play('dial t = 现在 options="过去 现在 将来" at=s\ndial z = 一般 options="一般 进行 完成 完成进行" at=s\nsentence s = "Railroads {verb: combine | t | z | 复} with each other."\nsay "两个拨盘随便拨。"');
    let dt = await dial('t'), dz = await dial('z');
    expect(`${tag}：拨词的拨盘只写词，不写「t =」`, `${dt.text}｜${dz.text}`, '现在｜一般');
    expect(`${tag}：拨盘的 ‹ › 手指按得到（≥ 44）`, String(Math.min(dt.inc.w, dt.inc.h, dz.dec.w, dz.dec.h) >= 44), 'true');
    // 连着点同一个地方三下（不重新量位置）：拨盘不能在手指下面跑
    dz = await dial('z'); const spot = { x: dz.inc.cx, y: dz.inc.cy };
    for (let i = 0; i < 3; i++) { await T.tap(spot); await T.wait(350); }
    const tspot = { x: dt.inc.cx, y: dt.inc.cy }; // 一开始量的 t 的 ›：拨了 z 以后还在原处
    await T.tap(tspot); await T.wait(2600);
    expect(`${tag}：点 › 拨到将来、完成进行，句子跟着变`, await words('s'), 'Railroads will have been combining with each other');
    dt = await dial('t'); dz = await dial('z');
    expect(`${tag}：「完成进行」不折成两行（两个拨盘一样高）`, String(Math.abs(dz.h - dt.h) < 2), 'true');
    expect(`${tag}：两个拨盘还是照造的先后排（t 在 z 上面），没有上下换位置`, String(dt.y < dz.y), 'true');
    // 句子里的词点得到（ask pick 要点四个词）
    const w3 = await T.box('s:3');
    expect(`${tag}：句子里的一个词手指按得到（高 ≥ 40）`, String(w3.h >= 40), 'true');
    // 时间轴：按住小人拖到「过去」那个停靠点
    await T.play('timeline tl = 过去 现在 将来 now=现在\nstand tl me = 现在\nsentence h = "Home prices {verb: hold | me | 进行 | 复} steady."\nopen tl.me move');
    const tick = (k) => T.page.evaluate((k) => { const r = window.LAStage.decors.get('tl').get(`tick:${k}`).getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, k);
    let me = await T.box('tl:me');
    expect(`${tag}：小人手指按得到（≥ 44）`, String(Math.min(me.w, me.h) >= 44), 'true');
    let before = await T.srcs();
    const past = await tick(1);
    await T.drag({ x: me.cx, y: me.cy }, { x: past.cx, y: me.cy });
    await T.wait(1200);
    expect(`${tag}：小人拖到「过去」，句子跟着变`, `${await T.added(before)}｜${await words('h')}`, 'set me 过去｜Home prices were holding steady');
    // 等着学生点词的时候句子重排了：新换上来的词（were）也点得了
    await T.play('timeline tl = 过去 现在 将来 now=现在\nstand tl me = 现在\nsentence h = "Home prices {verb: hold | me | 进行 | 复} steady."\nopen tl.me move\nask tap h "哪个词管时间？点它"');
    me = await T.box('tl:me');
    await T.drag({ x: me.cx, y: me.cy }, { x: (await tick(1)).cx, y: me.cy });
    await T.wait(1300);
    const tappable = await T.page.evaluate(() => { const st = window.LAStage; return [...st.scene.objects.get('h').words].sort((a, b) => a.slot - b.slot).map((w) => `${w.value}:${st.nodes.get(`h:${w.key}`)?.classList.contains('is-tap') ? '能点' : '不能点'}`).join(' '); });
    expect(`${tag}：等着点词时拖了小人，新换上来的 were 也能点`, tappable, 'Home:能点 prices:能点 were:能点 holding:能点 steady:能点');
    before = await T.srcs();
    const were = await T.box(await T.page.evaluate(() => { const o = window.LAStage.scene.objects.get('h'); return `h:${o.words.find((w) => w.value === 'were').key}`; }));
    await T.tap({ x: were.cx, y: were.cy }); await T.wait(600);
    expect(`${tag}：点 were：这一问收下了`, String(await T.page.evaluate(() => window.LAStage.scene.waiting == null)), 'true');
    await T.play('timeline tl = 过去 现在 将来 now=现在\nstand tl me = 过去\nsentence h = "Home prices {verb: hold | me | 进行 | 复} steady."\nopen tl.me move');
    // 松在两个停靠点中间偏将来一点：吸到将来
    me = await T.box('tl:me'); before = await T.srcs();
    const now = await tick(2), fut = await tick(3);
    await T.drag({ x: me.cx, y: me.cy }, { x: now.cx + (fut.cx - now.cx) * 0.62, y: me.cy });
    await T.wait(1200);
    expect(`${tag}：松在「现在」「将来」中间偏将来，吸到将来`, `${await T.added(before)}｜${await words('h')}`, 'set me 将来｜Home prices will be holding steady');
    await T.ctx.close();
  }
};

for (const [name, fn] of Object.entries(SECTIONS)) {
  if (only && !only.includes(name)) continue;
  console.log(`\n—— ${name} ——`);
  await fn();
}
await browser.close();
if (errs.length) { console.log(`页面报错：\n${errs.join('\n')}`); bad.push('页面报错'); }
console.log(bad.length ? `\n${bad.length} 处不对` : '\n都对');
process.exit(bad.length ? 1 : 0);
