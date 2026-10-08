import { renderLesson, lessonTitle, escapeHtml } from './render.js';

const KEY = 'la-studio-lessons';
const view = document.getElementById('view');

// —— 本地课件存储（只存在这台 iPad 的浏览器里）——
const store = {
  all() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  },
  save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
  },
  get(id) { return this.all().find((l) => l.id === id); },
  put(lesson) {
    const list = this.all().filter((l) => l.id !== lesson.id);
    list.unshift(lesson);
    return this.save(list);
  },
  remove(id) { this.save(this.all().filter((l) => l.id !== id)); },
};

let draft = ''; // localStorage 不可用时，至少当前会话里还能看

async function fetchText(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.text();
}

// —— 页面 ——
async function home() {
  document.title = '线代学习台';
  const mine = store.all();
  let examples = [];
  try { examples = JSON.parse(await fetchText('lessons/index.json')); } catch { /* 没有示例也能用 */ }
  view.innerHTML = `
    <section class="hero">
      <h1>线代学习台</h1>
      <p>Claude 写课件，这里把它变成能动手的课：变换动画、可拖动向量、逐步行化简、即时反馈的练习。</p>
      <div class="hero-actions">
        <a class="btn btn-primary btn-lg" href="#/paste">粘贴新课件</a>
        <a class="btn btn-lg" href="#/setup">设置 Claude 项目</a>
      </div>
    </section>
    <section>
      <h2 class="sec-title">我的课件</h2>
      ${mine.length ? `<ul class="lesson-list">${mine.map((l) => `
        <li><a href="#/l/${l.id}"><span class="ll-title">${escapeHtml(l.title)}</span><span class="ll-date">${new Date(l.updated).toLocaleDateString('zh-CN')}</span></a></li>`).join('')}</ul>`
      : '<p class="empty">还没有。在 Claude 里让它讲一节课，复制回答，点上面的「粘贴新课件」。</p>'}
    </section>
    ${examples.length ? `<section>
      <h2 class="sec-title">示例课件</h2>
      <ul class="lesson-list">${examples.map((e) => `<li><a href="#/r/${encodeURIComponent(e.file)}"><span class="ll-title">${escapeHtml(e.title)}</span><span class="ll-date">${escapeHtml(e.tag || '')}</span></a></li>`).join('')}</ul>
    </section>` : ''}`;
}

function paste(id) {
  const existing = id ? store.get(id) : null;
  document.title = existing ? '编辑课件' : '粘贴新课件';
  view.innerHTML = `
    <div class="page-head"><a class="back" href="${existing ? `#/l/${id}` : '#/'}">‹ 返回</a><h1>${existing ? '编辑课件' : '粘贴新课件'}</h1></div>
    <p class="muted">在 Claude 回复下方点「复制」，然后粘贴到这里。可以连续粘贴多条回复。</p>
    <div class="paste-actions">
      <button type="button" class="btn" id="clip">从剪贴板粘贴</button>
      <button type="button" class="btn btn-primary" id="go">生成课件</button>
    </div>
    <textarea id="src" spellcheck="false" placeholder="# 第 3 课：特征值与特征向量&#10;&#10;……">${escapeHtml(existing ? existing.md : '')}</textarea>`;
  const ta = view.querySelector('#src');
  view.querySelector('#clip').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      ta.value = ta.value.trim() ? `${ta.value.trim()}\n\n${text}` : text;
    } catch {
      ta.focus();
      toast('浏览器不让直接读剪贴板，请长按输入框选择「粘贴」');
    }
  });
  view.querySelector('#go').addEventListener('click', () => {
    const md = ta.value.trim();
    if (!md) return toast('先粘贴内容');
    const lesson = { id: existing?.id || Date.now().toString(36), title: lessonTitle(md), md, updated: Date.now() };
    if (!store.put(lesson)) {
      draft = md;
      toast('浏览器禁止保存（可能是无痕模式），本次只能临时查看');
      return go('#/draft');
    }
    go(`#/l/${lesson.id}`);
  });
}

function lessonPage(md, { id, source } = {}) {
  const title = lessonTitle(md);
  document.title = title;
  view.innerHTML = `
    <div class="lesson-bar">
      <a class="back" href="#/">‹ 课件库</a>
      <div class="lesson-tools">
        ${id ? `<a class="btn btn-sm" href="#/edit/${id}">编辑</a><button type="button" class="btn btn-sm btn-danger" id="del">删除</button>` : ''}
        ${source ? `<button type="button" class="btn btn-sm" id="copy-src">复制源码</button>` : ''}
      </div>
    </div>
    <article class="lesson"></article>`;
  renderLesson(md, view.querySelector('.lesson'));
  view.querySelector('#del')?.addEventListener('click', () => {
    if (confirm(`删除「${title}」？`)) { store.remove(id); go('#/'); }
  });
  view.querySelector('#copy-src')?.addEventListener('click', () => copy(md));
}

async function setup() {
  document.title = '设置 Claude 项目';
  let text = '';
  try { text = await fetchText('claude-instructions.md'); } catch (e) { text = `加载失败：${e.message}`; }
  view.innerHTML = `
    <div class="page-head"><a class="back" href="#/">‹ 返回</a><h1>设置 Claude 项目</h1></div>
    <ol class="setup-steps">
      <li>点下面的按钮，复制「课件格式说明」。</li>
      <li>在 Claude 里打开你的线性代数项目 → <strong>Project instructions（项目指令）</strong>，把它粘贴进去（放在你原来指令的后面即可）。也可以存成文件上传到项目的知识库。</li>
      <li>之后对 Claude 说「用学习台格式讲 …」，它就会输出带互动组件的课件。</li>
      <li>复制 Claude 的回复，回到这里「粘贴新课件」。</li>
    </ol>
    <button type="button" class="btn btn-primary btn-lg" id="copy">复制格式说明</button>
    <details class="fold"><summary><span>查看格式说明全文</span><span class="fold-tap">点击展开</span></summary><pre class="raw">${escapeHtml(text)}</pre></details>`;
  view.querySelector('#copy').addEventListener('click', () => copy(text));
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch {
    toast('复制失败，请展开全文手动复制');
  }
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function go(hash) { location.hash = hash; }

async function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, arg] = [h.split('/')[0], decodeURIComponent(h.split('/').slice(1).join('/'))];
  window.scrollTo(0, 0);
  try {
    if (page === 'paste') return paste();
    if (page === 'edit') return paste(arg);
    if (page === 'setup') return setup();
    if (page === 'draft') return lessonPage(draft || '# 没有临时课件');
    if (page === 'l') {
      const l = store.get(arg);
      return l ? lessonPage(l.md, { id: l.id }) : home();
    }
    if (page === 'r') {
      if (!/^[\w\-.]+\.md$/.test(arg)) throw new Error('无效的课件路径');
      return lessonPage(await fetchText(`lessons/${arg}`), { source: true });
    }
    return home();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="block-error">出错了：${escapeHtml(e.message)}</div><p><a href="#/">回到课件库</a></p>`;
  }
}

window.addEventListener('hashchange', route);
route();
