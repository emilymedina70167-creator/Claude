// 入口：artifact 里引入 la-kit.js 后，自动渲染 <script type="text/markdown"> 里的课件
import css from './styles.css';
import katexCss from 'virtual:katex-css';
import { renderLesson, mdToHtml, frontMatter, lessonTitle } from './render.js';
import { blocks } from './blocks/index.js';
import { session } from './session.js';
import { renderGuided } from './guided.js';
import { initTutor } from './tutor.js';
import { recordText } from './record.js';

function injectStyles() {
  if (document.getElementById('la-kit-style')) return;
  const style = document.createElement('style');
  style.id = 'la-kit-style';
  style.textContent = katexCss + '\n' + css;
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
    if (/^(guided|引导)$/i.test(meta.mode || '')) renderGuided(body, article, meta);
    else {
      session.stages = [{ title: '', src: body, el: article }];
      renderLesson(body, article);
    }
  });
  initTutor();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderAll);
else renderAll();

// 留给高级用法：window.LAKit.render(markdown, element)
window.LAKit = { render: (md, el) => { injectStyles(); el.classList.add('la-lesson'); renderLesson(md, el); }, mdToHtml, blocks: Object.keys(blocks), session, recordText };
