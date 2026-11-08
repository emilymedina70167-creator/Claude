// 舞台上的手指（kit/src/stage/pointer.js）用真的触摸检查一遍：CDP Input.dispatchTouchEvent → pointerType: touch，和 iPad 上一样。
// 按偏一点也拿得到、松在两格中间吸到近的那一格、拖到一半浏览器取消（pointercancel）算松在那里、平面上的向量连着拖两次（第二次在吸格点的动画还没走完时）、
// 做到挑战时东西跳一下（pulse）和预写的行同时挪它，跳完不把它放回原处；同一项只换了 wrong= 再开一次，键盘、成分那一排照新的那一项交。
//   node tools/stage-touch.mjs        （先 node proto/stage/build.mjs）  没问题退出码 0
import { chromium } from './playwright.mjs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const PAGE = pathToFileURL(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'proto/stage/dist/local.html')).href;
const bad = [];
const expect = (what, got, want) => { const ok = got === want; console.log(`${ok ? '✓' : '✗'} ${what}：${got}${ok ? '' : `（应该是 ${want}）`}`); if (!ok) bad.push(what); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`${PAGE}?dev&blank`);
await page.waitForFunction(() => window.LAStage);
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
const drag = async (a, b, { steps = 10, cancelAt = null } = {}) => {
  await touch('touchStart', a.x, a.y);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await page.waitForTimeout(16); if (cancelAt === i) { await touch('touchCancel'); return; } }
  await touch('touchEnd');
};
const play = (src) => page.evaluate(async (src) => { const st = window.LAStage; st.cancelWait?.(); st.clearAll(); st.log = []; const t = st.begin(); t.end(src); await t.armed; await new Promise((r) => setTimeout(r, 600)); }, src);
const box = (pid) => page.evaluate((k) => { const r = window.LAStage.nodes.get(k).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, pid);
const vals = () => page.evaluate(() => window.LAStage.scene.objects.get('a').cells.sort((x, y) => x.slot - y.slot).map((x) => x.value).join(' '));
await play('array a = 3 1 2 5\nopen a');
// 1. 按在第 1 格上沿外面 18px（手指按偏），拖到第 2 格上：换
let A = await box('a:1'), B = await box('a:2');
await drag({ x: A.cx, y: A.y - 18 }, { x: B.cx, y: B.cy - 18 });
await page.waitForTimeout(900);
expect('按在格子上沿外面 18px（手指按偏）拖到第 2 格', await vals(), '1 3 2 5');
// 2. 松在两格中间偏右一点：吸到右边那一格
A = await box('a:4'); B = await box('a:3');
const C = await box('a:2');
await drag({ x: A.cx, y: A.cy }, { x: (B.x + B.w + C.x) / 2 - 6, y: B.cy });
await page.waitForTimeout(900);
expect('松在两格中间偏右', await vals(), '1 5 2 3');
// 3. 拖到一半浏览器取消（pointercancel）：在哪松算哪
A = await box('a:1'); B = await box('a:3');
await drag({ x: A.cx, y: A.cy }, { x: B.cx, y: B.cy }, { steps: 10, cancelAt: 10 });
await page.waitForTimeout(900);
expect('拖到最后浏览器取消（pointercancel）', await vals(), '1 5 3 2');
// 4. 平面：拖一下，吸格点的动画还没走完马上再拖一下
await play('plane p range=-3..3\nvec p u = 1 1\nopen p.u drag');
const tipOf = () => page.evaluate(() => { const st = window.LAStage; const it = st.scene.objects.get('p').items.find((x) => x.key === 'u'); return { x: it.x, y: it.y }; });
const tipScreen = () => page.evaluate(() => { const st = window.LAStage; const o = st.scene.objects.get('p'); const root = st.decors.get('p').get('root'); const a = root.__st.drawn.get('u'); const W = { x: o.origin.x + (a.x - o.xlo) * 60, y: o.origin.y + (o.yhi - a.y) * 60 }; const s = st.toScreenLive(W); const v = st.view.getBoundingClientRect(); return { x: s.x + v.left, y: s.y + v.top }; });
const unit = await page.evaluate(() => 60 * window.LAStage.liveCam().s);
let t = await tipScreen();
await drag(t, { x: t.x + unit * 1.1, y: t.y - unit * 0.9 }, { steps: 8 });
await page.waitForTimeout(120);
t = await tipScreen();
await drag(t, { x: t.x + unit * 1.0, y: t.y + unit * 2.0 }, { steps: 8 });
await page.waitForTimeout(900);
expect('平面上的向量连着拖两次（第二次在动画没走完时）', JSON.stringify(await tipOf()), '{"x":"3","y":"0"}');
// 5. 做到挑战时舞台让东西跳一下（celebrate 的 pulse），预写的 fold 同时让后面的词补位：跳完不能把词放回跳之前的地方
await play('sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."\nopen s mark\ngoal g1 "拆完" when="s parsed"\n@g1 fold s.3-6');
await page.evaluate(async () => { const st = window.LAStage; for (const src of ['mark s.1-6 S', 'mark s.3-6 RC', 'mark s.7 V']) await st.studentDo(src, { type: 'gesture', open: 'mark' }); });
A = await box('s:8'); B = await box('s:9');
await drag({ x: A.cx, y: A.cy }, { x: B.cx, y: B.cy });
await page.waitForTimeout(400);
const role = await page.evaluate(() => { const b = [...document.querySelectorAll('.st-choices .st-choice')].find((x) => x.querySelector('span')?.textContent === '表语'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
if (role) { await touch('touchStart', role.x, role.y); await page.waitForTimeout(40); await touch('touchEnd'); }
await page.evaluate(async () => { const st = window.LAStage; await st.studentChain; await st.reacting; });
await page.waitForTimeout(1500);
expect('做到挑战、预写的 fold 补位以后，每个词都在它该在的地方', await page.evaluate(() => {
  const st = window.LAStage;
  return [...st.nodes.entries()].filter(([k, n]) => k.startsWith('s:') && !n.classList.contains('is-folded')).filter(([, n]) => n.style.transform !== `translate(${n.__box.x}px, ${n.__box.y}px)`).map(([k, n]) => `${k} ${n.style.transform}`).join('、') || '都在';
}), '都在');
// 6. 同一项再开一次、只换了 wrong= / undo=（说明里写的「再写一遍 open 就是换掉它」）：手势要照新的那一项挂上。
// 以前只看部件、范围变没变，还挂着旧的那一项，键盘、成分那一排点「确定」时发现那一项已经不是开着的了，悄悄收起、什么都没交
const more = (src) => page.evaluate(async (src) => { const st = window.LAStage; const t = st.begin(); t.end(src); await t.armed; await new Promise((r) => setTimeout(r, 600)); }, src);
const tapAt = async (p) => { await touch('touchStart', p.x, p.y); await page.waitForTimeout(40); await touch('touchEnd'); };
const keyAt = (k) => page.evaluate((k) => { const b = [...document.querySelectorAll('.st-keypad .st-kp-k')].find((x) => x.textContent === k); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, k);
const lastAct = () => page.evaluate(() => { const a = window.LAStageDev.acts.at(-1); return a ? `${a.src || a.type}${a.blocked ? ' 没让做' : ''}${a.marked ? ' 圈着' : ''}` : '没有'; });
await play('matrix M = 1 2 / 3 4\nopen M rowop wrong=mark');
await more('open M rowop wrong=block undo=on');
const grip = await page.evaluate(() => { const r = window.LAStage.decors.get('M').get('grip:1').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
B = await box('M:2.1');
await drag(grip, { x: B.cx, y: B.cy });
await page.waitForTimeout(400);
for (const k of ['−', '1', '确定']) { const p = await keyAt(k); if (p) await tapAt(p); await page.waitForTimeout(90); }
await page.waitForTimeout(1200);
expect('只换了 wrong= 再开一次：键盘写的倍数交出去了、照新的 wrong=block 没让做', await lastAct(), 'rowop M r2 - r1 没让做');
expect('照新的 undo=on：右上角有「撤一步」', await page.evaluate(() => String(!!document.querySelector('.st-undo'))), 'true');
await play('sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."\nopen s mark');
await more('open s mark wrong=mark');
A = await box('s:1'); B = await box('s:2');
await drag({ x: A.cx, y: A.cy }, { x: B.cx, y: B.cy });
await page.waitForTimeout(400);
const subj = await page.evaluate(() => { const b = [...document.querySelectorAll('.st-choices .st-choice')].find((x) => x.querySelector('span')?.textContent === '主语'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
if (subj) await tapAt(subj);
await page.waitForTimeout(1200);
expect('只换了 wrong= 再开一次：点成分交出去了、照新的 wrong=mark 圈着', await lastAct(), 'mark s.1-2 S 圈着');
expect('页面报错', errs.join(' / ') || '没有', '没有');
await browser.close();
console.log(bad.length ? `\n${bad.length} 项没过` : '\n都过了');
process.exit(bad.length ? 1 : 0);
