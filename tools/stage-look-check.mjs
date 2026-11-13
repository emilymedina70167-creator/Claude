// 第九轮（字号乘屏幕那一档：1180 宽时 0.96）：look 真的画上去了、底座的反馈盖不掉、底线 1 不照办（npm run check:stage 里跑）
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = `sentence s = "The company must make a quick decision."
glow s.3-4
card q = "第 10 句" "生词"
label n s.3 "情态动词" side=above tone=key
look * frame=none
look say text=30 color=brand
look s.5 color=red
look dock hide
say "看这里"`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1180, height: 820 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`file://${join(ROOT, 'proto/stage/dist/local.html')}?dev`);
await p.waitForFunction(() => window.LAStageDev?.Stage);
const r = await p.evaluate(async (src) => {
  document.getElementById('menu')?.remove();
  const host = document.getElementById('stage');
  const st = new window.LAStageDev.Stage(host, { input: true });
  await st.replay(src.split('\n').map((s) => ({ src: s, by: 'teacher', turn: 1 })));
  await st.compose({ animate: false });
  const css = (n) => (n ? getComputedStyle(n) : null);
  const card = host.querySelector('.st-card');
  const word = (k) => [...host.querySelectorAll('.sn-word')][k - 1];
  return {
    cardBg: css(card)?.backgroundColor, cardShadow: css(card)?.boxShadow,
    glowBg: css(word(3))?.backgroundColor, wordColor: css(word(5))?.color, plainColor: css(word(1))?.color,
    talk: css(host.querySelector('.st-caption .st-line'))?.fontSize,
    state: st.scene.stateText(),
  };
}, SRC);
await b.close();
const bad = [];
if (!/rgba\(0, 0, 0, 0\)|transparent/.test(r.cardBg) || r.cardShadow !== 'none') bad.push(`look * frame=none 以后题卡还带框：${r.cardBg} / ${r.cardShadow}`);
if (/rgba\(0, 0, 0, 0\)/.test(r.glowBg)) bad.push('亮着的词（底座的反馈）被老师的样子盖掉了');
if (r.wordColor === r.plainColor) bad.push('look s.5 color=red 没画上');
if (!(parseFloat(r.talk) >= 28)) bad.push(`look say text=30 没画上（${r.talk}）`);
if (!/没照办的样子：底下那一条不能藏/.test(r.state)) bad.push('look dock hide 没告诉老师「不能藏」');
if (errs.length) bad.push(`页面报错：${errs.join('；')}`);
if (bad.length) { console.error(`✗ look：\n- ${bad.join('\n- ')}`); process.exit(1); }
console.log('✓ look：画上去了、反馈盖不掉、底线 1 不照办');
