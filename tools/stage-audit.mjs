// 舞台的排版检查（docs/stage-plan.md「排版」）：一批镜头指令在 iPad 竖屏、横屏上演到最后，量画面上每一样东西实际占的地方，
// 报出压在一起的、跑出屏幕的、画到自己地方外面的（objectBox 报小了，别的东西就会摆上来压着它）。
// 不靠看截图：每一样东西的节点都带 data-obj（stage.js 的 partNode / decor 打上的），这里取它们在屏幕上的框拼起来。
//
//   node tools/stage-audit.mjs                 跑内置的一批（每种东西的例子、几样摆在一起的、真课里的几轮）
//   node tools/stage-audit.mjs 文件.txt …      跑这几个文件（一个文件一段指令）
//   --shots 目录                               有问题的存截图
//   --live                                     一行一行真演（慢，看演的过程里有没有压着；默认瞬间放到最后）
// 没问题退出码 0，有问题 1（tests 之外的一道：改了排版、加了新东西先跑它）
import { chromium } from './playwright.mjs';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure } from './stage-measure.mjs';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'proto/stage/dist/local.html');
const args = process.argv.slice(2);
const opt = { shots: '', live: false, files: [] };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--shots') opt.shots = resolve(args[++i]);
  else if (args[i] === '--live') opt.live = true;
  else opt.files.push(resolve(args[i]));
}
if (!existsSync(PAGE)) { console.error('没有 proto/stage/dist/local.html：先 node proto/stage/build.mjs'); process.exit(2); }

// —— 内置的一批：每种东西的例子 + 几样摆在一起 + 真课里出过的 ——
async function corpus() {
  const { TYPES } = await import(pathToFileURL(join(ROOT, 'kit/src/stage/types/index.js')).href);
  const out = [];
  for (const [k, t] of Object.entries(TYPES)) if (t.example) out.push({ name: `例子:${k}`, src: t.example });
  out.push({ name: '乘法:AB 和 BA', src: `matrix A = 1 1 / -1 -1
matrix B = 1 -1 / -1 1 beside=A
product C = A B
mul C
product D = B A
mul D
label t1 C "零矩阵 O（zero matrix）：每格都是 0 的一张表" side=below tone=key
label t2 A B "都 ≠ O" side=above tone=note
say "同样的 {A}、{B}，换个顺序：{C} 是 O，{D} 却不是。"
open B edit range=-3..3
goal g1 "改 B 的一个数，让 BA 的左上角变成 0" when="D.1,1 = 0"
goal g2 "再让 AB 也不是 O" when="C != O"` });
  out.push({ name: '格子+题卡+拨数', src: `array a = 49 38 65 97 76 13 27 49′ 55 04
dial d = 5 range=1-5 at=a
hop a.1 -> a.6 color=g1
label t a.1 a.6 "一组：隔 {d} 个" side=below tone=note
ptr i a.1
ptr j a.6
card q = "希尔排序：增量 d = 5 时，第一组是哪几个？" "提示：从第 1 个开始，每隔 d 个取一个"
cover q.2
say "从 {a.1} 往后跳 {d} 下，落在 {a.6}。"
ask tap a "那 {a.2} 和谁一组？"` });
  out.push({ name: '矩阵+平面', src: `plane p range=-3..3
vec p u = 2 1
vec p v = -1 2
matrix M = 1 1 / 0 1
transform p M
say "{M} 把整张网格推斜了。"
open p.u drag
goal g1 "把 u 拖到 (1, 1)" when="p.u = (1, 1)"` });
  out.push({ name: '树+格子', src: `array a = 50 30 70 20 40 60 80
tree t = 50 30 70 20 40 60 80
glow t.50
label k t.50 "根" side=above tone=key
say "按顺序插进二叉排序树：{a.1} 是根。"
ask tap t "40 插在哪？"` });
  out.push({ name: '句子', src: TYPES.sentence?.example || '' });
  // 真课第三轮（同一节）：BA 另起一行、比一格、贴字、题卡
  out.push({ name: '真课:乘法第三轮', src: `matrix A = 1 1 / -1 -1
matrix B = 1 -1 / -1 1 beside=A
product C = A B
mul C
product D = B A
mul D.1,1
mul D
compare C.1,1 D.1,1
say "同样是 {A} 和 {B}，换个顺序：{C} 全是 0，{D} 却是 2、2、−2、−2。"
label t3 C D "这一组：AB = O，BA ≠ O，两者不相等" side=below tone=note
say "数有 ab=ba；矩阵换了左右，算的是另一批行和列。"
card q = "根据这类例子，矩阵乘法该怎么说？" "AB 和 BA 一定不相等" "AB 和 BA 不一定相等"
ask tap q.2 q.3 "哪一句说得对？" expect=q.3` });
  // 扮老师的助手照真的说明写的一轮（活的舞台）
  out.push({ name: '扮老师:活的一轮', src: `matrix A = 1 1 / 2 2
matrix B = 1 1 / 1 -1
product C = A B
mul C.1,1
say "{C.1,1} 是 {A.r1} 乘 {B.c1}：1·1 + 1·1 = 2。"
mul C
open B edit range=-3..3
& open C explain
say "点 {B} 的一格能拨数，{C} 跟着变。"
goal g1 "改 {B} 里的一个数，让 {C} 全变成 0" when="C = O"
@g1 say "{A}、{B} 都不是 O，乘出来却是 O！"
@g1 product D = B A
@g1 mul D
@g1 ask say "同样的 {A}、{B}，换成 BA，{D} 是 O 吗？你发现了什么？"` });
  out.push({ name: '式子三行', src: `tex f = "\\hl{a}{(x+1)^2}"
next f "= \\hl{b}{x^2} + \\hl{c}{2x} + \\hl{d}{1}"
next f "= \\hl{b}{x^2} + \\hl{c}{2x} + \\hl{d}{1} - \\hl{e}{1}"
say "一项一项看：{f.c} 是怎么来的？"
ask tap f "点出 2x 是哪两项乘出来的"` });
  // 真课第一轮（2026-11-05 线代「乘法的规律与三条不能用」，c-20261105-4）
  out.push({ name: '真课:乘法第一轮', src: `say "这块要回答：数的乘法规律，哪些能原样搬到矩阵上？先看一组例子。"
matrix A = 1 1 / -1 -1
matrix B = 1 -1 / -1 1 beside=A
product C = A B
mul C
glow C
say "{A} 和 {B} 都不是全零，乘出来的 {C} 却每一格都是 0。"
label t1 C "零矩阵 O（zero matrix）：每格都是 0 的一张表，不是数 0" side=below tone=key
label t2 A B "都 ≠ O" side=above tone=note
say "数的乘法里 ab=0 必有一个是 0，这里两个都不是。"
ask next "换个顺序乘成 BA，结果还会是 O 吗？先自己猜，想好了点下面看" button="算 BA"` });
  return out.filter((x) => x.src);
}

const VIEWS = [{ w: 820, h: 1180, tag: '竖屏' }, { w: 1180, h: 820, tag: '横屏' }];

const browser = await chromium.launch();
let bad = 0;
const list = opt.files.length ? opt.files.map((f) => ({ name: basename(f), src: readFileSync(f, 'utf8') })) : await corpus();
if (opt.shots) mkdirSync(opt.shots, { recursive: true });
for (const v of VIEWS) {
  const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${pathToFileURL(PAGE).href}?dev&blank`);
  await page.waitForFunction(() => window.LAStage);
  await page.evaluate(`window.__measure = ${measure.toString()}`);
  for (const it of list) {
    await page.evaluate(async ({ src, live }) => {
      const st = window.LAStage;
      st.cancelWait?.();
      if (live) {
        st.clearAll(); st.log = [];
        window.__samples = [];
        const timer = setInterval(() => { try { window.__samples.push(window.__measure(true)); } catch { /* 正在换 */ } }, 250);
        const t = st.begin({ auto: true }); t.end(src); await t.armed;
        clearInterval(timer);
      }
      else {
        // 瞬间放到最后，再照老师那一轮的样子挂上最后一问（底下一条也要量）
        const lines = src.split('\n').filter((l) => l.trim());
        await st.replay(lines.map((s) => ({ src: s, by: 'teacher' })));
        const ask = [...lines].reverse().find((l) => /^ask\b/.test(l.trim()));
        const t = st.begin({ auto: true }); t.end(ask || ''); await t.armed;
      }
      await new Promise((r) => setTimeout(r, 900));
    }, { src: it.src, live: opt.live });
    const r = await page.evaluate(measure);
    // 演的过程里量到的（同一对只报一次，标上「演的时候」）
    const seen = new Set(r.issues.map((x) => `${x.what}|${x.a}|${x.b}`));
    const during = opt.live ? (await page.evaluate(() => window.__samples || [])).flatMap((m) => m.issues).filter((x) => { const k = `${x.what}|${x.a}|${x.b}`; if (seen.has(k)) return false; seen.add(k); return true; }).map((x) => ({ ...x, what: `演的时候${x.what}` })) : [];
    const issues = [...r.issues, ...during, ...errs.splice(0).map((e) => ({ what: '页面报错', a: e, b: '' }))];
    if (issues.length) {
      bad++;
      console.log(`✗ ${it.name}（${v.tag}）`);
      for (const x of issues) console.log(`    ${x.what}：${x.a}${x.b ? ` 和 ${x.b}` : ''}${x.area ? `（${x.area}）` : ''}${x.r ? ` ${x.r.join(',')}` : ''}`);
      if (opt.shots) await page.screenshot({ path: join(opt.shots, `${it.name.replace(/[:/]/g, '-')}-${v.tag}.png`) });
    } else console.log(`✓ ${it.name}（${v.tag}）`);
  }
  await page.close();
}
await browser.close();
console.log(bad ? `\n${bad} 处有问题` : '\n都没压着');
process.exit(bad ? 1 : 0);
