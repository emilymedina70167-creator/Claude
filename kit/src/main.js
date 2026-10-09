// 入口：artifact 里引入 la-kit.js 后，自动渲染 <script type="text/markdown"> 里的课件
import css from './styles.css';
import katexCss from 'virtual:katex-css';
import { renderLesson, mdToHtml, frontMatter, lessonTitle } from './render.js';
import { blocks } from './blocks/index.js';
import { session } from './session.js';
import { renderGuided } from './guided.js';
import { initTutor } from './tutor.js';
import { recordText, toast } from './record.js';
import { escapeHtml } from './render.js';
import { initBoardInk } from './ink/overlay.js';
import { renderLive } from './live/live.js';
import { renderClass } from './class/classroom.js';
import classCss from './class/class.css';
import classBoardCss from './class/board.css';

// 粉笔手写体：数字和字母用 Caveat（1 和 7 容易分辨），中文用龙藏体。
// Google Fonts 是 artifact 唯一允许的外部样式来源；加载不到时退回系统楷体
const HAND_FONT = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&family=Long+Cang&display=swap';

// 粉笔质感滤镜：给线条加颗粒和毛边
const CHALK_FILTER = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  <filter id="la-chalk" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -1.4 1.25" result="speck"/>
    <feComposite in="SourceGraphic" in2="speck" operator="in" result="grain"/>
    <feDisplacementMap in="grain" in2="n" scale="2" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="la-chalk-v" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="3" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -0.9 1.45" result="speck"/>
    <feComposite in="SourceGraphic" in2="speck" operator="in" result="grain"/>
    <feDisplacementMap in="grain" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
  </filter></defs></svg>`;

function injectStyles() {
  if (document.getElementById('la-kit-style')) return;
  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = HAND_FONT;
  document.head.appendChild(font);
  document.body.insertAdjacentHTML('afterbegin', CHALK_FILTER);
  const style = document.createElement('style');
  style.id = 'la-kit-style';
  style.textContent = katexCss + '\n' + css + '\n' + classCss + '\n' + classBoardCss;
  document.head.appendChild(style);
  if (!document.querySelector('meta[name="viewport"]')) {
    const m = document.createElement('meta');
    m.name = 'viewport';
    m.content = 'width=device-width, initial-scale=1';
    document.head.appendChild(m);
  }
}

// 去掉公共缩进，避免 Claude 把整段缩进后被当成代码块
function dedent(text) {
  const lines = text.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length);
  const n = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(n)).join('\n');
}

function renderAll() {
  injectStyles();
  const sources = document.querySelectorAll('script[type="text/markdown"], script[type="text/lesson"]');
  if (!sources.length) {
    document.body.insertAdjacentHTML('beforeend', '<div class="la-lesson"><div class="block-error">没找到课件内容：请把课件放在 &lt;script type="text/markdown"&gt; 里。</div></div>');
    return;
  }
  sources.forEach((s) => {
    const article = document.createElement('article');
    article.className = 'la-lesson';
    // 课件脚本可能被解析进 <head>（页面没写 <body> 时），那就放进 body
    if (s.closest('head')) document.body.appendChild(article);
    else s.after(article);
    const { meta, body } = frontMatter(dedent(s.textContent));
    session.reset(meta.unit || lessonTitle(body));
    session.subject = meta.subject || '线性代数';
    if (/^(class|课堂)$/i.test(meta.mode || '')) renderClass(article, meta);
    else if (/^(live|实时)$/i.test(meta.mode || '')) renderLive(article, meta);
    else if (/^(guided|引导)$/i.test(meta.mode || '')) renderGuided(body, article, meta);
    else {
      session.stages = [{ title: '', src: body, el: article }];
      renderLesson(body, article);
    }
    if (!session.live) showProblems(article);
    article.insertAdjacentHTML('beforeend', '<div class="la-tray" aria-hidden="true"><i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s4"></i><i class="eraser"></i></div>');
    if (!window.LAKit?.ink) (window.LAKit ||= {}).ink = initBoardInk(article);
  });
  // 课堂模式里「问 Claude」就是底部对话框，不再单独出现
  if (session.mode !== 'class') initTutor();
}

// 课件本身写错的地方集中列在顶部，方便复制给 Claude 修改
function showProblems(article) {
  const ps = session.problems;
  if (!ps.length) return;
  const where = (p) => (session.stages.length > 1 ? `第 ${p.stage + 1} 节${p.title ? `「${p.title}」` : ''}` : '');
  const text = `课件「${session.title}」里有 ${ps.length} 处组件写法错误，请对照组件说明修正后重新发布：\n` + ps.map((p, i) => `${i + 1}. ${where(p)} ${p.kind}：${p.msg}`).join('\n');
  const box = document.createElement('div');
  box.className = 'lint';
  box.innerHTML = `<div class="lint-head"><strong>这份课件有 ${ps.length} 处写法错误</strong><button type="button" class="btn btn-sm lint-copy">复制给 Claude</button></div>
    <ol>${ps.map((p) => `<li>${escapeHtml(`${where(p)} ${p.kind}：${p.msg}`)}</li>`).join('')}</ol>
    <p class="muted">把错误信息粘贴到对话里，让 Claude 改好后重新发布。下面出错的组件会显示红框。</p>`;
  const bar = article.querySelector('.g-bar');
  if (bar) bar.after(box); else article.prepend(box);
  box.querySelector('.lint-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); toast('已复制，去对话里粘贴给 Claude'); }
    catch { box.querySelector('ol').insertAdjacentHTML('afterend', `<textarea class="lint-text" readonly>${escapeHtml(text)}</textarea>`); }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderAll);
else renderAll();

// 留给高级用法：window.LAKit.render(markdown, element)
window.LAKit = { ...(window.LAKit || {}), render: (md, el) => { injectStyles(); el.classList.add('la-lesson'); renderLesson(md, el); }, mdToHtml, blocks: Object.keys(blocks), session, recordText };
