// 舞台上的手指（kit/src/stage/pointer.js）用真的触摸检查一遍：CDP Input.dispatchTouchEvent → pointerType: touch，和 iPad 上一样。
// 按偏一点也拿得到、松在两格中间吸到近的那一格、拖到一半浏览器取消（pointercancel）算松在那里、平面上的向量连着拖两次（第二次在吸格点的动画还没走完时）、
// 做到挑战时东西跳一下（pulse）和预写的行同时挪它，跳完不把它放回原处；同一项只换了 wrong= 再开一次，键盘、成分那一排照新的那一项交；
// 手指按「回到插入后」（open … back=）回到存着的样子、撤一步撤得了它；撤一步留住打了一半的字、外接键盘写进数字键盘、拖着悬上去照现在的舞台问（Task 14）。
// 第二轮的手势层（Task 11）：同一句上又拉又折又拖（滑、点、按住 0.35 秒再拖，每一下只交一种，哪种都不像就作罢、浮一句）、只开一种照旧按下就拖、
// ✕ 的点区 ≥ 44 收掉学生的括号和线、从钩拉线（词、外框）、整张矩阵拖去比 / 放进合计 / 并同类项、摘叶子和删、点小方块展开、按住一个词挪。
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
// 成分按钮交的是中文（点「主语」交 mark s.1-2 主语）
expect('只换了 wrong= 再开一次：点成分交出去了、照新的 wrong=mark 圈着', await lastAct(), 'mark s.1-2 主语 圈着');
// 7. 存档点：学生插进 47（页面替老师存成「插入后」）、又转了一下，手指按「回到插入后」：t 回到插入后的样子（这一下先在克隆上 check，
// 克隆上要有存档）；按钮至少 44px、还没存时按不了；撤一步撤的是这一下
await play('tree t = 30 20 40 10 25 _ 45 tray="47"\nopen t insert\nopen t rotate undo=on\nkeep t "插入后" after=insert\nopen t back="插入后"');
const backBtn = () => page.evaluate(() => { const b = document.querySelector('.st-back'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, off: b.disabled, text: b.textContent }; });
const levelT = () => page.evaluate(() => window.LAStage.scene.stateText().match(/树 t[^：]*：层序 ([^\n]*)/)?.[1] || '');
let bb = await backBtn();
expect('「回到插入后」按钮：还没存时按不了', JSON.stringify(bb && { off: bb.off, text: bb.text }), '{"off":true,"text":"回到插入后"}');
await page.evaluate(async () => { const st = window.LAStage; await st.studentDo('insert t 47', { type: 'gesture', open: 'insert' }); await st.studentDo('rotate t.40 left', { type: 'gesture', open: 'rotate' }); });
await page.waitForTimeout(900);
bb = await backBtn();
expect('「回到插入后」按钮至少 44px 高、学生插完以后按得了', String(bb.h >= 44 && bb.w >= 44 && !bb.off), 'true');
if (process.env.STAGE_TOUCH_SHOT) await page.screenshot({ path: process.env.STAGE_TOUCH_SHOT }); // 想看一眼按钮排得怎么样：STAGE_TOUCH_SHOT=存到哪.png
await tapAt(bb);
await page.waitForTimeout(1200);
expect('按「回到插入后」：t 回到插入后的样子', await levelT(), '30 20 40 10 25 _ 45 _ _ _ _ _ 47');
expect('课堂收到的这一下', await page.evaluate(() => window.LAStageDev.actText(window.LAStageDev.acts.at(-1))), '学生点了「回到插入后」：t 回到了插入后的样子（层序 30 20 40 10 25 _ 45 _ _ _ _ _ 47）');
expect('log 里是学生的一行 back、open 记成 back', await page.evaluate(() => JSON.stringify((({ src, by, open }) => ({ src, by, open }))(window.LAStage.log.at(-1)))), '{"src":"back t \\"插入后\\"","by":"student","open":"back"}');
const undoAt = await page.evaluate(() => { const b = document.querySelector('.st-undo'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, off: b.disabled }; });
await tapAt(undoAt);
await page.waitForTimeout(1200);
expect('撤一步撤的是按「回到插入后」那一下：回到转完的样子', await levelT(), '30 20 45 10 25 40 47');

// —— 第二轮的手势层画面（Task 11）：同一处三种按法分开（点、滑、按住 0.35 秒再拖）、从钩拉线、整张矩阵拖、✕ 收掉、摘叶子、拖一段 ——
const srcs = () => page.evaluate(() => window.LAStage.log.map((r) => r.src));
const added = async (before) => (await srcs()).slice(before.length).join(' | ') || '没有';
// 一样东西画在旁边的（括号 br:m2…、钩 hk:6、✕ xm:m3…、小方块 fold:…）：第一个键以 pre 开头的那一个在屏幕上的框
const decorBox = (obj, pre) => page.evaluate(([obj, pre]) => {
  const m = window.LAStage.decors.get(obj);
  for (const [k, n] of m || []) if (k.startsWith(pre)) { const r = n.getBoundingClientRect(); if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }
  return null;
}, [obj, pre]);
// 句子里第几个词（现在的次序）的屏幕框
const wordBox = (obj, slot) => page.evaluate(([obj, slot]) => { const st = window.LAStage; const w = st.scene.objects.get(obj).words.find((x) => x.slot === slot); const r = st.nodes.get(`${obj}:${w.key}`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, [obj, slot]);
// 括号那一截的中间偏下一点（手指按在括号那一道线上）；括号的 id 照 s.marks 里第几个
const markId = (obj, keys) => page.evaluate(([obj, keys]) => window.LAStage.scene.objects.get(obj).marks.find((m) => m.keys.join(' ') === keys)?.id || '', [obj, keys]);
// 按住 ms 毫秒不动，再一步步挪过去、松手
const holdDrag = async (a, b, { ms = 400, steps = 12 } = {}) => {
  await touch('touchStart', a.x, a.y);
  await page.waitForTimeout(ms);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await page.waitForTimeout(16); }
  await page.waitForTimeout(60);
  await touch('touchEnd');
};
const pickRole = async (name) => { const p = await page.evaluate((name) => { const b = [...document.querySelectorAll('.st-choices .st-choice')].find((x) => x.querySelector('span')?.textContent === name); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, name); if (p) await tapAt(p); return !!p; };
// 树上值是 v 的结点在屏幕上的框
const treeBox = (obj, v) => page.evaluate(([obj, v]) => { const st = window.LAStage; const p = st.scene.objects.get(obj).nodes.find((x) => String(x.value) === String(v)); const n = p && st.nodes.get(`${obj}:${p.key}`); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, [obj, v]);
const settle = () => page.evaluate(async () => { const st = window.LAStage; await st.studentChain; await st.reacting; await new Promise((r) => setTimeout(r, 900)); });

// 8. 同一句上又拉又折又拖：open s mark / fold / move 一起开，每一下只认成一种、只多一行
await play(`sentence s = "The man who lives next door is a doctor in our town." key="[S The man [RC who lives next door]] [V is] [P a doctor] [A in our town]."
mark s.8-9 P
open s mark
open s fold
open s move`);
let before = await srcs();
A = await wordBox('s', 2); B = await wordBox('s', 4);
await drag({ x: A.cx, y: A.cy }, { x: B.cx, y: B.cy }, { steps: 8 });
await page.waitForTimeout(400);
const rowShown = await page.evaluate(() => !!document.querySelector('.st-choices .st-choice'));
expect('同一句上：从 s.2 滑到 s.4 出成分那一排', String(rowShown), 'true');
await pickRole('主语');
await settle();
expect('滑：只多一行 mark', await added(before), 'mark s.2-4 主语');
before = await srcs();
const studentBr = await decorBox('s', `br:${await markId('s', '2 3 4')}:`);
if (studentBr) await tapAt({ x: studentBr.cx - studentBr.w / 4, y: studentBr.y + studentBr.h - 1 });
await settle();
expect('点一道括号：只多一行 fold', await added(before), 'fold s.2-4');
before = await srcs();
const pBr = await decorBox('s', `br:${await markId('s', '8 9')}:`);
const gapAt = async (after) => { const a = await wordBox('s', after), b = await wordBox('s', after + 1); return { x: (a.x + a.w + b.x) / 2, y: a.cy }; };
if (pBr) await holdDrag({ x: pBr.cx, y: pBr.y + pBr.h - 1 }, await gapAt(11));
await settle();
expect('按住 0.4 秒再把括号拖到 s.11 后面：只多一行 move', await added(before), 'move s.8-9 after s.11');
expect('拖完：没有留着跟着手的那一份、句子里没有托着的词', await page.evaluate(() => String(document.querySelectorAll('.st-g-ghost, .sn-word.is-lifted, .sn-word.is-hold').length)), '0');
const freeNow = () => page.evaluate(() => String(!window.LAStage.dragging && !window.LAStage.pointer.s));
expect('手指松开以后舞台不再等手指（镜头、老师的行照常走）', await freeNow(), 'true');
// 括号上（只有点和按住）按下就挪：哪种都不像，作罢（什么都不交、不留半截的拖），浮一句这里能怎么按
await page.waitForTimeout(1900);
before = await srcs();
const pBr2 = await decorBox('s', `br:${await markId('s', '8 9')}:`);
if (pBr2) await drag({ x: pBr2.cx, y: pBr2.y + pBr2.h - 1 }, { x: pBr2.cx + 120, y: pBr2.y + 60 }, { steps: 8 });
await settle();
expect('括号上按下就挪（点、按住都不是）：什么都不交', await added(before), '没有');
expect('作罢时浮一句这里能怎么按', await page.evaluate(() => document.querySelector('.st-g-note')?.textContent || ''), '这一下没认出来：点一下，或者按住一会儿再拖');
expect('作罢以后没有半截的拖', `${await page.evaluate(() => String(document.querySelectorAll('.st-g-ghost, .sn-gap').length))} ${await freeNow()}`, '0 true');
// 同一个词上按住等满再挪：挪这个词；按住时拎起来的那一份当场「弹」一下、放大（手指还没挪就看得出托起来了）
before = await srcs();
A = await wordBox('s', 1);
await touch('touchStart', A.cx, A.cy);
await page.waitForTimeout(420);
const popped = await page.evaluate(() => { const g = document.querySelector('.st-g-ghost'); return g ? String(g.classList.contains('is-pop') && /scale\(1\.08\)/.test(g.style.transform)) : '没有托起来'; });
const gEnd = await gapAt(9);
for (let i = 1; i <= 12; i++) { await touch('touchMove', A.cx + (gEnd.x - A.cx) * i / 12, A.cy + (gEnd.y - A.cy) * i / 12); await page.waitForTimeout(16); }
await page.waitForTimeout(60);
await touch('touchEnd');
await settle();
expect('按住 0.35 秒：拎起来的那一份放大、弹一下', popped, 'true');
expect('按住一个词等满再拖到 s.9 后面：只多一行 move', await added(before), 'move s.1 after s.9');
// 同一个词上点一下：折起含这个词的那道括号（a 在 P 那道括号里）；不在括号里的词点了浮一句为什么、什么都不交
before = await srcs();
A = await wordBox('s', 10);
await tapAt({ x: A.cx, y: A.cy });
await settle();
expect('在词上点一下：只多一行 fold（不拉括号、不拖）', await added(before), 'fold s.10-11');
await page.waitForTimeout(1900);
before = await srcs();
A = await wordBox('s', 7);
await tapAt({ x: A.cx, y: A.cy });
await page.waitForTimeout(300);
expect('点不在括号里的词：什么都不交', await added(before), '没有');
expect('浮一句为什么（不在哪一道括号里）', await page.evaluate(() => String(/不在哪一道括号里/.test(document.querySelector('.st-g-note')?.textContent || ''))), 'true');
// 按住托起来以后浏览器取消了这一下（pointercancel）：没挪就是放回原处，什么都不交、不卡住
before = await srcs();
A = await wordBox('s', 12);
await touch('touchStart', A.cx, A.cy);
await page.waitForTimeout(420);
await touch('touchCancel');
await settle();
expect('按住托起来、没挪就被取消：什么都不交，拎起来的那一份收掉', `${await added(before)} ${await page.evaluate(() => String(document.querySelectorAll('.st-g-ghost, .is-lifted').length))} ${await freeNow()}`, '没有 0 true');

// 9. 只开一种按法时照旧按下就拖（不用先按住）
await play('tree t = 30 20 40 _ _ 35 50\nopen t rotate');
before = await srcs();
A = await treeBox('t', 40); B = await treeBox('t', 30);
await drag({ x: A.cx, y: A.cy }, { x: B.cx, y: B.cy }, { steps: 8 });
await settle();
expect('只开 rotate：按下马上拖照样转', (await added(before)).replace(/ .*$/, ''), 'rotate');
// 9b. 按中序排（一个结点一列）的 15 个结点的二叉排序树：竖屏镜头缩到约 0.6 倍，结点在屏幕上不到 44 像素；
// 手指按在结点中心往右下偏 21 像素（44 见方的角上，朝着它的右孩子）照样拎起它（pointer.js 的 FINGER 按偏 30 以内、挑近的）
await play('tree t = 8 4 12 2 6 10 14 1 3 5 7 9 11 13 15\nopen t rotate');
before = await srcs();
A = await treeBox('t', 6); B = await treeBox('t', 4);
const nodePx = Math.round(A.w);
await drag({ x: A.cx + 21, y: A.cy + 21 }, { x: B.cx, y: B.cy }, { steps: 8 });
await settle();
expect(`15 个结点的二叉排序树（竖屏，结点 ${nodePx} 像素）：按在中心偏 21 像素拖到父亲上照样转`, await added(before), 'rotate t#2 left');

// 10. 学生拉的括号上的 ✕：点区至少 44×44，点了收掉（unmark）
await play(`sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."
open s mark`);
await page.evaluate(async () => { await window.LAStage.studentDo('mark s.7 谓语', { type: 'gesture', open: 'mark' }); });
await page.waitForTimeout(700);
const xr = await page.evaluate(() => { const t = [...window.LAStage.pointer.targets.values()].find((x) => String(x.name || '').startsWith('xm:')); const r = t?.rect(); return r ? `${Math.round(r.w) >= 44 && Math.round(r.h) >= 44}` : '没有 ✕'; });
expect('学生拉的括号上有 ✕、点区至少 44×44', xr, 'true');
expect('老师那句话的词上没有 ✕（只挂学生拉的）', await page.evaluate(() => String([...(window.LAStage.decors.get('s')?.keys() || [])].filter((k) => k.startsWith('xm:')).length)), '1');
before = await srcs();
const xm = await decorBox('s', 'xm:');
if (xm) await tapAt({ x: xm.cx, y: xm.cy });
await settle();
expect('点 ✕：多一行 unmark', await added(before), 'unmark s.7');
// 两道学生拉的括号紧挨着（开着 mark、fold）：点右边那道的左端是折它，不收掉左边那道；点左边那道的 ✕ 正中才收掉
await play(`sentence s = "The books on the shelf that I bought yesterday are new." key="[S The books on the shelf [RC that I [V bought] yesterday]] [V are] [P new]."
open s mark
open s fold`);
await page.evaluate(async () => { for (const src of ['mark s.6-9 定语从句', 'mark s.10 谓语']) await window.LAStage.studentDo(src, { type: 'gesture', open: 'mark' }); });
await page.waitForTimeout(800);
before = await srcs();
const rightBr = await decorBox('s', `br:${await markId('s', '10')}:`);
if (rightBr) await tapAt({ x: rightBr.x + 3, y: rightBr.y + rightBr.h - 1 });
await settle();
expect('点右边那道括号的左端：折它（不收掉紧挨着的左边那道）', `${await added(before)} | ${await markId('s', '6 7 8 9') ? '左边那道还在' : '左边那道没了'}`, 'fold s.10 | 左边那道还在');
await page.waitForTimeout(1900);
before = await srcs();
const leftX = await decorBox('s', `xm:${await markId('s', '6 7 8 9')}`);
if (leftX) await tapAt({ x: leftX.cx, y: leftX.cy });
await settle();
expect('点左边那道的 ✕ 正中：收掉它', await added(before), 'unmark s.6-9');

// 11. 从钩上拉线：open s.6 refer，钩只挂在 that 上；拉到 books 上松手
await play(`sentence s = "The books on the shelf that I bought yesterday are new." key="[S The books on the shelf [RC that I [V bought] yesterday]] [V are] [P new]." links="that -> s.2"
open s mark
open s.6 refer`);
expect('钩只挂在 open 写的那个词上', await page.evaluate(() => [...(window.LAStage.decors.get('s')?.keys() || [])].filter((k) => k.startsWith('hk:')).join(' ')), 'hk:6');
const hk = await decorBox('s', 'hk:');
expect('钩的点区至少 44×44', await page.evaluate(() => { const t = [...window.LAStage.pointer.targets.values()].find((x) => String(x.name || '').startsWith('hk:')); const r = t?.rect(); return r ? `${Math.round(r.w) >= 44 && Math.round(r.h) >= 44}` : '没有钩'; }), 'true');
before = await srcs();
B = await wordBox('s', 2);
if (hk) await drag({ x: hk.cx, y: hk.cy }, { x: B.cx, y: B.cy }, { steps: 12 });
await settle();
expect('从钩拉到 s.2：多一行 refer', await added(before), 'refer s.6 -> s.2');
expect('拉完：跟着手的那道线收掉了', await page.evaluate(() => String(document.querySelectorAll('.st-g-line, .st-g-linedot').length)), '0');
// 线头上的 ✕：收掉学生连的线
before = await srcs();
const xl = await decorBox('s', 'xr:');
if (xl) await tapAt({ x: xl.cx, y: xl.cy });
await settle();
expect('点线上的 ✕：多一行 unrefer', await added(before), 'unrefer s.6');
// 钩和词上拉括号不抢：从 that 这个词的正中滑到 I，还是拉括号
before = await srcs();
A = await wordBox('s', 6); B = await wordBox('s', 7);
await drag({ x: A.cx, y: A.cy + 6 }, { x: B.cx, y: B.cy + 6 }, { steps: 8 });
await page.waitForTimeout(400);
expect('在有钩的词上滑：照旧出成分那一排（拉括号）', await page.evaluate(() => String(!!document.querySelector('.st-choices .st-choice'))), 'true');
await pickRole('主语');
await settle();
expect('只多一行 mark', await added(before), 'mark s.6-7 主语');
// 拉到句子外框上：refer s.6 -> s（整句）
before = await srcs();
const frameAt = await page.evaluate(() => { const st = window.LAStage; const b = st.scene.objectBox('s'); const p = st.toScreenLive({ x: b.x + b.w / 2, y: b.y + b.h }); const v = st.view.getBoundingClientRect(); return { x: p.x + v.left, y: p.y + v.top + 34 }; });
const hk2 = await decorBox('s', 'hk:');
if (hk2) await drag({ x: hk2.cx, y: hk2.cy }, frameAt, { steps: 14 });
await settle();
expect('从钩拉到句子外框：多一行 refer … -> s', await added(before), 'refer s.6 -> s');
// 钩挂着的词折起来了：画面上没有钩，现状照实说学生现在拉不了
await play(`sentence s = "The books on the shelf that I bought yesterday are new." key="[S The books on the shelf [RC that I [V bought] yesterday]] [V are] [P new]."
mark s.6-9 RC
fold s.6-9
open s.6 refer`);
expect('钩挂着的词折着：没有钩，现状写「s.6 折着，展开以后才能拉」', `${await page.evaluate(() => [...(window.LAStage.decors.get('s')?.keys() || [])].filter((k) => k.startsWith('hk:')).length)} | ${await page.evaluate(() => String(/页面还画不了的[^\n]*s\.6 refer[^\n]*s\.6 折着，展开以后才能拉/.test(window.LAStage.scene.stateText())))}`, '0 | true');

// 12. 整张矩阵拖去比：按住 P 的括号拖到 Q 上，逐格比、两张都不变、不一样的格闪两下，P 弹回去
await play('matrix P = 1 3 / -1 4\nmatrix Q = 1 5 / 1 4 beside=P\nopen P compare');
await page.evaluate(() => { window.__flash = new Set(); new MutationObserver((ms) => ms.forEach((m) => { if (m.target.classList?.contains('is-flash')) window.__flash.add(m.target.__pid); })).observe(window.LAStage.layer, { attributes: true, attributeFilter: ['class'], subtree: true }); });
before = await srcs();
const bl = await decorBox('P', 'bl');
B = await box('Q:1.2');
if (bl) await drag({ x: bl.cx, y: bl.cy }, { x: B.cx, y: B.cy }, { steps: 12 });
await settle();
const mx = (id) => page.evaluate((id) => window.LAStage.scene.objects.get(id).cells.map((x) => x.value).join(' '), id);
expect('整张拖到 Q 上：多一行 compare', await added(before), 'compare P Q');
expect('P、Q 的数不变', `${await mx('P')} | ${await mx('Q')}`, '1 3 -1 4 | 1 5 1 4');
expect('不一样的两格带过 is-flash', await page.evaluate(() => [...window.__flash].sort().join(' ')), 'P:1.2 P:2.1 Q:1.2 Q:2.1');
expect('P 弹回去了（没有留着跟着手的那一份）', await page.evaluate(() => String(document.querySelectorAll('.st-g-ghost').length)), '0');
expect('P 原来那一张恢复了（不淡着）', await page.evaluate(() => String(document.querySelectorAll('.is-lifted').length)), '0');
// 按在整张中间的格上（格上没开别的）也拎得起来
before = await srcs();
A = await box('P:2.2'); B = await box('Q:2.2');
await drag({ x: A.cx, y: A.cy }, { x: B.cx, y: B.cy }, { steps: 12 });
await settle();
expect('按在 P 的格上拖到 Q 上：照样 compare', await added(before), 'compare P Q');

// 13. 放进合计：AB 整张拖进收集用的 Sum
await play('matrix A = 1 2 / 3 4\nmatrix B = 0 1 / 1 0 beside=A\nmatrix AB = {A B}\nmatrix Sum = collect\nopen AB put');
before = await srcs();
const abl = await decorBox('AB', 'bl');
B = await box('Sum:1.1');
if (abl) await drag({ x: abl.cx, y: abl.cy }, { x: B.cx, y: B.cy }, { steps: 12 });
await settle();
expect('AB 拖进 Sum：多一行 put', await added(before), 'put AB Sum');
expect('Sum 跟着 AB 算出来了', await mx('Sum'), '2 1 4 3');

// 14. 并同类项：X（−2A）拖到 Y（−A）上，并成 −3A，X 拿下舞台
await play('matrix A = 1 2 / 3 4\nmatrix X = {-2 A}\nmatrix Y = {-A} beside=X\nopen X merge');
before = await srcs();
const xbl = await decorBox('X', 'bl');
B = await box('Y:1.1');
if (xbl) await drag({ x: xbl.cx, y: xbl.cy }, { x: B.cx, y: B.cy }, { steps: 12 });
await settle();
expect('X 拖到 Y 上：多一行 merge', await added(before), 'merge X Y');
expect('X 拿下了舞台、Y 并成了 −3A', `${await page.evaluate(() => String(window.LAStage.scene.objects.has('X')))} | ${await mx('Y')}`, 'false | -3 -6 -9 -12');

// 15. 摘叶子：点叶子删掉；点里面的结点晃一下、浮一句「只能摘叶子」，什么都不交
await play('tree t = 30 20 40 10 25\nopen t pluck');
before = await srcs();
A = await treeBox('t', 10);
await tapAt({ x: A.cx, y: A.cy });
await settle();
expect('点叶子 10：多一行 delete', (await added(before)).replace(/#\d+$/, '#…'), 'delete t#…');
before = await srcs();
A = await treeBox('t', 20);
await tapAt({ x: A.cx, y: A.cy });
await page.waitForTimeout(300);
expect('点里面的结点 20：log 不变', await added(before), '没有');
expect('浮出「只能摘叶子」', await page.evaluate(() => String(/只能摘叶子/.test(document.querySelector('.st-g-note')?.textContent || ''))), 'true');
expect('点的那个结点晃了一下', await page.evaluate(() => { const st = window.LAStage; const p = st.scene.objects.get('t').nodes.find((x) => String(x.value) === '20'); return String(!!st.nodes.get(`t:${p.key}`)?.classList.contains('is-shake')); }), 'true');
await page.waitForTimeout(1800);
// open t delete：点哪个删哪个
await play('tree t = 30 20 40 10 25\nopen t delete');
before = await srcs();
A = await treeBox('t', 20);
await tapAt({ x: A.cx, y: A.cy });
await settle();
expect('open t delete 点 20：多一行 delete t.20', await added(before), 'delete t.20');

// 16. 点小方块展开：折起来的一段点它展开（open s fold，里层折着也是先展开外层）
await play(`sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."
mark s.3-6 RC
fold s.3-6
open s fold`);
before = await srcs();
const pill = await decorBox('s', 'fold:');
if (pill) await tapAt({ x: pill.cx, y: pill.cy });
await settle();
expect('点小方块：多一行 unfold', await added(before), 'unfold s.3');

// 17. 只开 move：按住一个词马上就拖（一种按法照旧按下就拖），放在两个词之间
await play(`sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."
open s move`);
before = await srcs();
A = await wordBox('s', 3);
const g5 = await (async () => { const a = await wordBox('s', 5), b = await wordBox('s', 6); return { x: (a.x + a.w + b.x) / 2, y: a.cy }; })();
await drag({ x: A.cx, y: A.cy }, g5, { steps: 12 });
await settle();
expect('只开 move：按下拖一个词到 s.5 后面', await added(before), 'move s.3 after s.5');

// 18. ask value 照 type 换写法（复核：以前全是数字键盘，英文、方程、数集、式子在 iPad 上几乎打不进去）：
// 全是数的数字键盘；要打字母、括号、= 的普通键盘，不许 iPad 替学生改大小写、改拼写；式子是一个式子框配符号小键盘。每一种写一个答案交上去，页面判对
const centerOf = (sel) => page.evaluate((sel) => { const n = document.querySelector(sel); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
const lastRight = () => page.evaluate(() => { const a = window.LAStageDev.acts.at(-1); return a?.type === 'value' ? `${a.text} ${a.right}` : '没交'; });
const field = () => page.evaluate(() => {
  const i = document.querySelector('#st-say-input');
  if (!i) return '没有输入框';
  const fs = parseFloat(getComputedStyle(i).fontSize), h = i.getBoundingClientRect().height;
  return `${i.inputMode} 大写${i.getAttribute('autocapitalize')} 纠错${i.getAttribute('autocorrect')} 拼写${i.spellcheck}${fs >= 16 ? '' : ` 字 ${fs}px`}${h >= 44 ? '' : ` 高 ${h}px`}`;
});
const KEYS = [
  ['type=num', 'type=num answer=3/4', '0.75', 'decimal'],
  ['type=matrix（全是数）', 'type=matrix answer={A^2}', '7 10 / 15 22', 'decimal'],
  ['不写 type、答案是数', 'answer={a.3-a.1}', '16', 'decimal'],
  ['type=en', 'type=en answer="had started"', 'had started', 'text'],
  ['type=seq', 'type=seq answer="A C B"', 'A C B', 'text'],
  ['type=equation', 'type=equation answer="x + y = 3"', 'x+y=3', 'text'],
  ['type=set', 'type=set answer={1, 5}', '{1, 5}', 'text'],
  ['不写 type、答案是字', 'answer="x + 1"', 'x+1', 'text'],
];
for (const [what, opts, ans, mode] of KEYS) {
  await play(`matrix A = 1 2 / 3 4\narray a = 49 38 65\nask value "答案是？" ${opts}`);
  expect(`${what}：输入框`, await field(), `${mode} 大写off 纠错off 拼写false`);
  await page.fill('#st-say-input', ans);
  const go = await centerOf('.st-say-go');
  await tapAt(go);
  await page.waitForTimeout(300);
  expect(`${what}：写「${ans}」交上去`, await lastRight(), `${ans} true`);
}
// type=formula：一个式子框（inputmode none，不弹系统键盘），点进去出符号小键盘，点 2、n、对吗
await play('ask value "第 n 项是？" type=formula free=n answer=2n');
expect('type=formula：一个式子框、不弹系统键盘', await page.evaluate(() => { const i = document.querySelector('.st-fone .fi-text'); return i ? `${i.getAttribute('inputmode')} ${parseFloat(getComputedStyle(i).fontSize) >= 16} ${i.getBoundingClientRect().height >= 44}` : '没有'; }), 'none true true');
await tapAt(await centerOf('.st-fone .fi-text'));
await page.waitForTimeout(300);
expect('type=formula：点进去出符号小键盘、有 n 键', await page.evaluate(() => { const k = document.querySelector('.keypad.show [data-k="n"]'); if (!k) return '没有'; const r = k.getBoundingClientRect(); return String(Math.min(r.width, r.height) >= 44); }), 'true');
expect('type=formula：小键盘不压着式子框和「对吗」', await page.evaluate(() => { const kp = document.querySelector('.keypad.show').getBoundingClientRect(); return String(document.querySelector('.st-fone').getBoundingClientRect().bottom <= kp.top); }), 'true');
for (const k of ['2', 'n']) { await tapAt(await centerOf(`.keypad.show [data-k="${k}"]`)); await page.waitForTimeout(60); }
expect('type=formula：小键盘写进了框里', await page.evaluate(() => document.querySelector('.st-fone .fi-text').value), '2n');
await tapAt(await centerOf('.st-fone .st-say-go'));
await page.waitForTimeout(500);
expect('type=formula：交上去页面判对、小键盘收起', `${await lastRight()} ${await page.evaluate(() => !document.querySelector('.keypad.show'))}`, '2n true true');
// type=matrix free=n：一格一个式子框，填满交上去（写给老师的是一行字）
await play('ask value "Aⁿ = ？" type=matrix free=n answer="1 n / 0 1"');
const cells = await page.$$('.st-fgrid .fi-text');
expect('type=matrix free=n：四格式子框、不弹系统键盘', `${cells.length} ${await page.evaluate(() => [...document.querySelectorAll('.st-fgrid .fi-text')].every((i) => i.getAttribute('inputmode') === 'none'))}`, '4 true');
for (const [i, v] of ['1', 'n', '0', '1'].entries()) await cells[i].fill(v);
await tapAt(await centerOf('.st-fgrid .st-say-go'));
await page.waitForTimeout(500);
expect('type=matrix free=n：交上去页面判对', await lastRight(), '1 n / 0 1 true');
// 写式子的两种底下也有对老师说的一行（回归：以前只给式子框，学生想说「写在哪？」「我不会」都没处说）；
// 小键盘开着时点那一行：小键盘收起、字写得进去（那一行一直在，不跟着小键盘出没：按「对吗」的那一下小键盘先收起，版面一跳手指就按空了）
const sayRow = () => page.evaluate(() => {
  const i = document.querySelector('.st-dock > .st-say:not(.st-fgrid) #st-say-input');
  if (!i) return '没有';
  const r = i.getBoundingClientRect();
  return `${i.getAttribute('aria-label')}${parseFloat(getComputedStyle(i).fontSize) >= 16 ? '' : ' 字小'}${r.height >= 44 ? '' : ' 矮'}`;
});
for (const [what, src, cell] of [['type=matrix free=n', 'ask value "Aⁿ = ？" type=matrix free=n answer="1 n / 0 1"', '.st-fgrid .fi-text'], ['type=formula', 'ask value "第 n 项是？" type=formula free=n answer=2n', '.st-fone .fi-text']]) {
  await play(src);
  expect(`${what}：底下还有对老师说的一行`, await sayRow(), '对老师说');
  await tapAt(await centerOf(cell));
  await page.waitForTimeout(300);
  await tapAt(await centerOf('#st-say-input'));
  await page.waitForTimeout(800); // 底下那一条等小键盘收起 0.4 秒以后才落回去（armFormula 的 lift），落定了再按
  expect(`${what}：小键盘开着时点那一行：小键盘收起`, await page.evaluate(() => String(!document.querySelector('.keypad.kp-formula.show'))), 'true');
  await page.fill('#st-say-input', '写在哪？');
  await tapAt(await centerOf('.st-dock > .st-say:not(.st-fgrid) .st-say-go'));
  await page.waitForTimeout(400);
  expect(`${what}：说一句交上去是「学生说」、不判`, await page.evaluate(() => { const a = window.LAStageDev.acts.at(-1); return a ? `${a.type} ${a.text}${a.right != null ? ' 判了' : ''}` : '没交'; }), 'say 写在哪？');
}
// 19. 第一轮留下的（Task 14）：撤一步留住打了一半的字（输入框、按格的每一格）；外接键盘写进数字键盘；拖着悬上去拿现在的舞台问
await play('array a = 3 1 2\nopen a undo=on\nask say "为什么这样换？"');
await page.evaluate(async () => { await window.LAStage.studentDo('swap a.1 a.2', { type: 'drag', open: 'drag' }); });
await page.waitForTimeout(400);
await page.fill('#st-say-input', '因为左边比');
await tapAt(await centerOf('.st-undo'));
await page.waitForTimeout(1200);
expect('撤一步：数回去了、打了一半的字还在', `${await page.evaluate(() => window.LAStage.scene.objects.get('a').cells.sort((x, y) => x.slot - y.slot).map((x) => x.value).join(' '))}｜${await page.evaluate(() => document.querySelector('#st-say-input')?.value)}`, '3 1 2｜因为左边比');
await play('array a = 3 1 2\nopen a undo=on\nask value "Aⁿ 是？" type=matrix free=n answer="1 n / 0 1"');
await page.evaluate(async () => { await window.LAStage.studentDo('swap a.1 a.2', { type: 'drag', open: 'drag' }); });
await page.waitForTimeout(400);
const half = await page.$$('.st-fgrid .fi-text');
await half[0].fill('1');
await half[1].fill('n+');
await page.evaluate(() => document.activeElement?.blur?.());
await page.waitForTimeout(500);
await tapAt(await centerOf('.st-undo'));
await page.waitForTimeout(1200);
expect('撤一步：按格的每一格照原样', await page.evaluate(() => [...document.querySelectorAll('.st-fgrid .fi-text')].map((n) => n.value).join('|')), '1|n+||');
await page.evaluate(() => document.activeElement?.blur?.());
await page.waitForTimeout(500);
// 对老师说的那一行聚焦着时点一格：键盘接过外接键盘的键（那一行失焦），字不进那一行
await play('matrix M = 1 2 / 3 4\nopen M edit input=keypad\nask say "随便说"');
await page.focus('#st-say-input');
B = await box('M:1.1');
await tapAt({ x: B.cx, y: B.cy });
await page.waitForTimeout(400);
await page.keyboard.type('-3/2');
expect('外接键盘：那一行聚焦着时点一格，字不进那一行', JSON.stringify(await page.evaluate(() => document.querySelector('#st-say-input')?.value)), '""');
expect('外接键盘：数字键盘上写着 −3/2', await page.evaluate(() => document.querySelector('.st-keypad .st-kp-v')?.textContent), '−3/2');
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
expect('外接键盘：回车交上去、键盘收起', `${await lastAct()}｜${!!(await page.$('.st-keypad'))}`, 'write M.1,1 -3/2｜false');
// 屏幕上的小数点键：每个键至少 44 见方、确定占两格；点 0 . 5 确定，矩阵记成精确的 1/2
await tapAt({ x: B.cx, y: B.cy });
await page.waitForTimeout(400);
expect('数字键盘：每个键至少 44 见方、最后一行 0 . 确定', await page.evaluate(() => { const ks = [...document.querySelectorAll('.st-keypad .st-kp-k')]; const small = ks.filter((k) => { const r = k.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length; return `${small} ${ks.slice(-3).map((k) => k.textContent).join(' ')}`; }), '0 0 . 确定');
for (const k of ['0', '.', '5']) { await tapAt(await keyAt(k)); await page.waitForTimeout(60); }
expect('数字键盘：点出 0.5', await page.evaluate(() => document.querySelector('.st-keypad .st-kp-v')?.textContent), '0.5');
await tapAt(await keyAt('确定'));
await page.waitForTimeout(900);
expect('数字键盘：0.5 交上去、记成 1/2', `${await lastAct()}｜${await page.evaluate(() => window.LAStage.scene.parts('M.1,1')[0].value)}`, 'write M.1,1 1/2｜1/2');
// 扣着的格点开看怎么算：A.1,2（11）、C.1,1（1×5 + 11×7 = 82）扣着，点 C.1,1——演的时候学生看得到的字里没有 11、82（画成 ?），写给老师的照实说
await play('matrix A = 1 11 / 3 4\nmatrix B = 5 6 / 7 8 beside=A\nproduct C = A B\ncover C.1,1\ncover A.1,2\nopen C explain');
await page.evaluate(() => {
  const seen = window.__seen = [];
  const look = () => { for (const n of document.querySelectorAll('.mx-work, .mx-ghost')) seen.push(n.innerText); seen.push(window.LAStage.view.innerText); };
  window.__mo = new MutationObserver(look);
  window.__mo.observe(window.LAStage.view, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] });
});
B = await box('C:1.1');
await tapAt({ x: B.cx, y: B.cy });
await page.waitForTimeout(5200);
expect('点开看怎么算：扣着的数没出现在学生看得到的字里', await page.evaluate(() => { window.__mo.disconnect(); const all = window.__seen.join('\n'); return /11|82/.test(all) ? all.match(/.*(11|82).*/)[0] : '没有'; }), '没有');
expect('点开看怎么算：算式里扣着的画成 ?', await page.evaluate(() => String(window.__seen.some((t) => /1\s*×\s*5\s*\+\s*\?\s*×\s*7\s*=\s*\?/.test(t)))), 'true');
expect('点开看怎么算：写给老师的照实说', await page.evaluate(() => window.LAStageDev.actText(window.LAStageDev.acts.at(-1))), '学生点了 C.1,1，看它怎么一行乘一列算出来（扣着的演成了 ?：C.1,1（82，扣着）、A.1,2（11，扣着））');
// 扣着的格不打开拨数器（上面写着它的数），浮一句「这一格还扣着」
await play('matrix B = 5 6 / 7 8\ncover B.1,1\nopen B edit range=-9..9');
B = await box('B:1.1');
await tapAt({ x: B.cx, y: B.cy });
await page.waitForTimeout(400);
expect('扣着的格点了不出拨数器、浮一句', `${!!(await page.$('.mx-step'))}｜${await page.evaluate(() => document.querySelector('.st-g-note')?.textContent || '')}`, 'false｜这一格还扣着');
B = await box('B:1.2');
await tapAt({ x: B.cx, y: B.cy });
await page.waitForTimeout(400);
expect('没扣着的格照旧出拨数器', await page.evaluate(() => document.querySelector('.mx-step .mx-step-v')?.textContent || '没有'), '6');
// 平衡的 50-30：30 拖到 50 上会被 wrong=block 拦下——悬上去照常说会怎样（不先说对错），放下以后才弹回去、照样交给课堂
await play('tree t = 50 30\nopen t rotate wrong=block');
const tnode = (v) => page.evaluate((v) => { const st = window.LAStage; const n = st.scene.objects.get('t').nodes.find((x) => x.value === String(v)); return `t:${n.key}`; }, v);
const hoverOf = (el) => page.evaluate((k) => { const st = window.LAStage; const el = k.startsWith('.') ? document.querySelector(k) : st.nodes.get(k); const h = document.querySelector('.st-g-note.is-hint'); return `${el?.classList.contains('is-over') ? 'over' : ''}${el?.classList.contains('is-nodrop') ? 'nodrop' : ''}｜${h?.textContent || ''}`; }, el);
const p50 = await tnode(50);
A = await box(await tnode(30)); B = await box(p50);
const slide = async (a, b) => { for (let i = 1; i <= 10; i++) { await touch('touchMove', a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10); await page.waitForTimeout(16); } };
await touch('touchStart', A.cx, A.cy);
await slide({ x: A.cx, y: A.cy }, { x: B.cx, y: B.cy });
await page.waitForTimeout(100);
expect('悬在 wrong=block 会拦的落点上：照常说会怎样，不先说对错', await hoverOf(p50), 'over｜在 50 右旋');
await touch('touchEnd');
await page.waitForTimeout(1200);
expect('放下以后裁判拦下、弹回去，照样交给课堂', `${await lastAct()}｜${await page.evaluate(() => window.LAStage.log.some((r) => /^rotate/.test(r.src)))}`, 'rotate t#1 right 没让做｜false');
// 这个世界做不到的（一条 7 层的链，托盘里的 90 拖起来；拖着的时候老师插了 80，再插就 9 层，放不下）：悬上去照现在的舞台说为什么
await play('tree t = 10 tray="90"\ninsert t 20\ninsert t 30\ninsert t 40\ninsert t 50\ninsert t 60\ninsert t 70\nopen t insert');
const trayAt = await decorBox('t', 'tray:90');
const zone = await page.evaluate(() => { const st = window.LAStage; const n = st.scene.objects.get('t').nodes.find((x) => x.value === '40'); const r = st.nodes.get(`t:${n.key}`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await touch('touchStart', trayAt.cx, trayAt.cy);
await slide({ x: trayAt.cx, y: trayAt.cy }, { x: trayAt.cx + 120, y: trayAt.cy + 40 });
await page.evaluate(() => window.LAStage.scene.apply(window.LAStageDev.parseScript('insert t 80')[0]));
await slide({ x: trayAt.cx + 120, y: trayAt.cy + 40 }, zone);
await page.waitForTimeout(100);
expect('拖着的时候舞台变了：悬上去照现在的说做不到', await hoverOf('.tr-zone'), 'nodrop｜树最多 8 层，再长就放不下了');
await touch('touchEnd');
await page.waitForTimeout(1200);
expect('松手照裁判：没插进去', await page.evaluate(() => String(window.LAStage.scene.objects.get('t').nodes.some((n) => n.value === '90'))), 'false');

// 20. 正在等的 ask pick 不抢整张矩阵的把手（试演时找到的）：ask pick 等着 M 的格、又开着 open M compare——
// 以前格子是 prio 2 的点，手指 30 像素以内独吞，按 M 的括号拎不起来。现在点一下是点格子，按住 0.35 秒再拖是整张拖去比
await play('matrix M = 1 3 / -1 4\nmatrix N = 1 5 / 1 4 beside=M\nopen M compare\nask pick M "哪几格和 N 不一样？" button="点好了" expect="M.1,2 M.2,1"');
before = await srcs();
const mbl = await decorBox('M', 'bl');
B = await box('N:1.2');
if (mbl) await holdDrag({ x: mbl.cx, y: mbl.cy }, { x: B.cx, y: B.cy });
await settle();
expect('ask pick 等着：按住 M 的括号拖到 N 上，多一行 compare', await added(before), 'compare M N');
expect('拖完那一问还等着、一格也没圈上', await page.evaluate(() => `${window.LAStage.scene.waiting?.kind}｜${document.querySelectorAll('.is-picking').length}`), 'pick｜0');
// 按在格子上按住再拖：也是整张（手指在整张的框里）
before = await srcs();
A = await box('M:2.2'); B = await box('N:2.2');
await holdDrag({ x: A.cx, y: A.cy }, { x: B.cx, y: B.cy });
await settle();
expect('按住 M 的一格再拖到 N 上：照样 compare（不圈格子）', `${await added(before)}｜${await page.evaluate(() => document.querySelectorAll('.is-picking').length)}`, 'compare M N｜0');
// 点一下格子：圈上那一格（那一问），不拖
before = await srcs();
for (const k of ['M:1.2', 'M:2.1']) { A = await box(k); await tapAt({ x: A.cx, y: A.cy }); await page.waitForTimeout(150); }
expect('点 M.1,2、M.2,1：两格圈上了、没多一行', `${await page.evaluate(() => document.querySelectorAll('.is-picking').length)}｜${await added(before)}`, '2｜没有');
const pickGo = await page.evaluate(() => { const b = document.querySelector('.st-pick-go'); if (!b || b.disabled) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
if (pickGo) await tapAt(pickGo);
await settle();
expect('点「点好了」：交上去、和预期的一样', await page.evaluate(() => { const a = window.LAStageDev.acts.at(-1); return a?.type === 'pick' ? `${a.refs.join(' ')}｜${a.same}` : '没交'; }), 'M.1,2 M.2,1｜true');
// 21. ask pick … reveal=on 猜错了（第三次量 D2/幕1）：猜错叫老师照旧，可老师那一轮演完页面不再自己 unpick——还没揭晓（学生插进去之前），
// 圈留着；刷新（照 log 重放）也留着；学生插进去揭晓了（变了的实线、没变的虚线），老师下一轮演完才收
const teacher = (src) => page.evaluate(async (src) => { const st = window.LAStage; st.cancelWait?.(); const t = st.begin(); t.end(src); await t.armed; await new Promise((r) => setTimeout(r, 300)); }, src);
const rings = () => page.evaluate(() => `${document.querySelectorAll('.is-pick').length}｜${document.querySelectorAll('.is-pick-same').length}｜${window.LAStage.scene.picked ? '圈着' : '没圈'}`);
await play('tree t = 20 10 40 5 15 30 50 _ _ _ _ 25 35 45 tray="47"\nbf t\nopen t insert\nask pick t "点出会变的结点" button="猜好了" expect="t.45 t.50 t.40 t.20" reveal=on');
for (const v of [45, 50, 20, 10]) { const b = await treeBox('t', v); await tapAt({ x: b.cx, y: b.cy }); await page.waitForTimeout(120); }
const goBtn = await page.evaluate(() => { const b = document.querySelector('.st-pick-go'); if (!b || b.disabled) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
if (goBtn) await tapAt(goBtn);
await settle();
expect('reveal=on 猜错（漏了 40、多了 10）：交上去', await page.evaluate(() => { const a = window.LAStageDev.acts.at(-1); return a?.type === 'pick' ? String(a.same) : '没交'; }), 'false');
await teacher('say "把 47 拖进去，看看谁真的变了。"\nask next "插好了点下面" button="插好了"');
expect('老师那一轮演完：还没揭晓，圈留着（log 里没有 unpick）', `${await rings()}｜${await page.evaluate(() => window.LAStage.log.some((r) => r.src === 'unpick'))}`, '4｜0｜圈着｜false');
const stBefore = await page.evaluate(() => window.LAStage.scene.stateText().split('\n').find((l) => l.startsWith('圈着学生点的')) || '');
await page.evaluate(async () => { const st = window.LAStage; await st.replay(st.log.slice()); await new Promise((r) => setTimeout(r, 300)); });
expect('刷新（照 log 重放）：圈照样留着、现状那一行一字不差', `${await rings()}｜${await page.evaluate((b) => (window.LAStage.scene.stateText().split('\n').find((l) => l.startsWith('圈着学生点的')) || '') === b, stBefore)}`, '4｜0｜圈着｜true');
await page.evaluate(async () => { const st = window.LAStage; await st.studentDo('insert t 47', { type: 'gesture', open: 'insert' }); });
await settle();
expect('学生插进 47：揭晓——变了的 45、50、20 实线，没变的 10 虚线', await rings(), '4｜1｜圈着');
await teacher('say "看：10 没变。"\nask next "好" button="好"');
expect('揭晓以后老师下一轮演完：收掉', await rings(), '0｜0｜没圈');

expect('页面报错', errs.join(' / ') || '没有', '没有');
await browser.close();
console.log(bad.length ? `\n${bad.length} 项没过` : '\n都过了');
process.exit(bad.length ? 1 : 0);
