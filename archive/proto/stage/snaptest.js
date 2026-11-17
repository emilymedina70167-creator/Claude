// 截图试验页（第九轮「画面归老师」的第一步）：iPad 的 Safari 上，页面能不能把舞台画面重画成一张图（html2canvas-pro），像不像。
// 只是试验：一块真的舞台摆几样东西，右上角「截一张」把截出来的图盖在画面上，点图来回比。
import html2canvas from 'html2canvas-pro';
import { Stage } from '../../kit/src/stage/stage.js';
import css from '../../kit/src/stage/stage.css';
import { viewCss } from '../../kit/src/stage/types/views.js';
import katexCss from 'virtual:katex-css';

for (const t of [`${css}\n${viewCss()}`, katexCss]) { const s = document.createElement('style'); s.textContent = t; document.head.appendChild(s); }

const SCENES = {
  句子: `dial m = must options="不加 must can should may"
sentence s = "The company {m: makes | must make | can make | should make | may make} a quick decision."
place s main
glow s.3-4
card q = "这段要回答：谓语前面加上 must、can 这类词，谓语会怎么变？" "must 必须｜can 能够｜should 应该｜may 可能"
place q below s
label n s.3 "情态动词" side=above tone=key
goal g1 "拨到 can，看 make 变不变" when="m = can"
say "看亮着的两个词：must 进来以后，后面那个词和原来的 makes 比，哪里不一样了？"
ask say "make 和 makes 比，少了什么？"`,
  矩阵和树: `matrix A = 1 2 / 0 1
matrix B = 2 0 / 1 3
matrix AB = {A B}
place A B AB row gap=l
tree t = 40 30 45 20 35 42 50
place t below A
paint t.45 g2
label k t.45 "插 47 会挂在这里" side=right tone=note
tex f = "\\det(AB)=\\det A\\cdot\\det B"
place f right-of t
say "左边两张乘起来是右边那张；下面这棵树先猜一猜。"
ask next "看好了点这里" button="看好了"`,
};

const host = document.getElementById('stage');
const hud = document.getElementById('hud');
let stage = null;

async function show(name) {
  stage?.destroy();
  stage = new Stage(host, { input: true });
  window.LAStage = stage;
  hud.textContent = `正在摆「${name}」…`;
  try {
    // 一下子摆好（照刷新放回的走法），不等动画
    await stage.replay(SCENES[name].split('\n').map((src) => ({ src, by: 'teacher', turn: 1 })));
    hud.textContent = `「${name}」摆好了。点右上角「截一张」。`;
  } catch (e) { hud.textContent = `摆不出来：${e.message}`; }
}

async function snap() {
  const shot = document.getElementById('shot');
  hud.textContent = '正在截…';
  const t0 = performance.now();
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    const canvas = await html2canvas(host, { backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : null, scale: 1, logging: false, useCORS: true });
    const ms = Math.round(performance.now() - t0);
    let url = '';
    try { url = canvas.toDataURL('image/png'); } catch (e) { throw new Error(`截出来了但取不出图（Safari 把画布当成了「不能读」）：${e.message}`); }
    const kb = Math.round((url.length * 3) / 4 / 1024);
    shot.querySelector('img').src = url;
    shot.querySelector('.s-info').textContent = `截图用了 ${ms} 毫秒，${canvas.width}×${canvas.height}，约 ${kb} KB。点图在「截图」和「真画面」之间来回切，看哪里不一样。`;
    shot.hidden = false;
    shot.classList.remove('is-peek');
    hud.textContent = `截好了（${ms} 毫秒）。`;
  } catch (e) {
    hud.textContent = `截图失败：${e?.message || e}`;
  }
}

document.getElementById('snap').addEventListener('click', snap);
document.getElementById('shot').addEventListener('click', (e) => {
  if (e.target.closest('.s-close')) { document.getElementById('shot').hidden = true; return; }
  document.getElementById('shot').classList.toggle('is-peek');
});
for (const b of document.querySelectorAll('[data-scene]')) b.addEventListener('click', () => show(b.dataset.scene));
show('句子');
