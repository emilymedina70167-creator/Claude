// 实时黑板（mode: live）：页面只是一个壳，内容一段一段从数据库来。
// 对话里的 Claude 往 steps/{id} 写一段课件 Markdown，学生在页面上作答，作答写回 answers / events，
// 对话里的 Claude 读了再决定下一段写什么。往下走的决定权在对话里，页面没有「继续」和关卡。
import { renderLesson, mdToHtml, escapeHtml } from '../render.js';
import { session } from '../session.js';
import { copyRecord, toast } from '../record.js';
import { getStore } from './store.js';
import { createSink } from './sync.js';
import { initDevPanel } from './devpanel.js';

export async function renderLive(root, meta) {
  session.live = true;
  session.stages = [];
  const unitName = meta.unit || session.title;
  root.classList.add('is-live');
  root.innerHTML = `
    <div class="g-bar">
      <div class="g-name">${mdToHtml(unitName, { inline: true })}</div>
      <div class="g-dots" role="list"></div>
      <div class="g-tools">
        <span class="live-chip" data-state="wait"><i></i><span>连接中</span></span>
        <button type="button" class="btn btn-sm g-copy">复制学习记录</button>
      </div>
    </div>
    <div class="g-stages"></div>
    <div class="live-empty">
      <div class="live-empty-art" aria-hidden="true"><i></i><i></i><i></i></div>
      <p class="live-empty-text">正在连接黑板…</p>
    </div>`;
  const box = root.querySelector('.g-stages');
  const dots = root.querySelector('.g-dots');
  const empty = root.querySelector('.live-empty');
  const emptyText = root.querySelector('.live-empty-text');
  const chip = root.querySelector('.live-chip');
  root.querySelector('.g-copy').addEventListener('click', () => copyRecord(toast));
  const setChip = (state, text) => { chip.dataset.state = state; chip.querySelector('span').textContent = text; };

  const store = await getStore({ title: session.title });
  if (!store) {
    setChip('off', '没连上');
    emptyText.innerHTML = '这个页面没有拿到黑板的数据库权限。<br>发布时要声明 <code>capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}</code>；本地试用请在地址后面加 <code>?dev</code>。';
    return;
  }
  session.sink = createSink(store);
  setChip('on', store.dev ? '本地开发' : '实时黑板');
  emptyText.innerHTML = '黑板还是空的，回对话里让 Claude 开始。';
  if (store.dev) initDevPanel(store, root);
  session.event('open', null, { title: session.title, unit: unitName });

  // 黑板设置：单元名、给页面里 Claude 的背景资料
  store.db.doc('meta/board').onSnapshot((snap) => {
    const d = snap.exists ? snap.data() : {};
    if (d.unit) root.querySelector('.g-name').innerHTML = mdToHtml(String(d.unit), { inline: true });
    session.context = String(d.context || '');
  }, () => {});

  const steps = new Map(); // id → {sec, md, title, hidden, seq, stage, touched, done}
  let first = true;

  store.db.collection('steps').onSnapshot((snap) => {
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0) || (a.id > b.id ? 1 : -1));
    const seen = new Set();
    const fresh = [];
    for (const d of docs) {
      seen.add(d.id);
      const md = String(d.md ?? '');
      let s = steps.get(d.id);
      if (!s) {
        s = addStep(d);
        if (!d.hidden) fresh.push(s);
      } else {
        if (Number(d.seq) !== s.seq) { s.seq = Number(d.seq) || 0; place(s); }
        if (md !== s.md || (d.title || '') !== s.title) {
          s.md = md;
          s.title = d.title || '';
          if (s.touched) markUpdated(s); else draw(s);
        }
      }
      setHidden(s, !!d.hidden);
    }
    for (const [id, s] of steps) if (!seen.has(id)) setHidden(s, true);
    refresh();
    if (!first && fresh.length) announce(fresh[0]);
    first = false;
  }, () => setChip('off', '连接断了，刷新试试'));

  function addStep(d) {
    const sec = document.createElement('section');
    sec.className = 'stage live-step';
    sec.dataset.step = d.id;
    sec.dataset.stage = session.stages.length;
    const s = { id: d.id, sec, md: String(d.md ?? ''), title: d.title || '', seq: Number(d.seq) || 0, hidden: false, touched: false, done: false };
    session.stages.push({ id: d.id, title: s.title, src: s.md, el: sec });
    steps.set(d.id, s);
    // 学生动过这一段（输入、点按钮、拖图、写字）之后，内容更新不再自动替换
    const touch = () => { s.touched = true; };
    sec.addEventListener('input', touch);
    sec.addEventListener('click', (e) => { if (e.target.closest('.widget button, .widget .opt')) touch(); });
    sec.addEventListener('pointerdown', (e) => { if (e.target.closest('.handle, .pad-area, input[type=range]')) touch(); });
    place(s);
    draw(s);
    return s;
  }

  // 按 seq 放到正确的位置（新的一段通常在最后）
  function place(s) {
    const after = [...steps.values()].filter((o) => o !== s && o.sec.isConnected && o.seq > s.seq).sort((a, b) => a.seq - b.seq)[0];
    if (after) box.insertBefore(s.sec, after.sec); else box.appendChild(s.sec);
  }

  function draw(s) {
    const i = Number(s.sec.dataset.stage);
    const hasHeading = /^##\s+/m.test(s.md);
    const src = !hasHeading && s.title ? `## ${s.title}\n\n${s.md}` : s.md;
    session.stages[i].title = s.title || (s.md.match(/^##\s+(.+)$/m)?.[1] || '').trim();
    session.stages[i].src = src;
    session.problems = session.problems.filter((p) => p.stage !== i);
    for (const [k, sc] of session.scenes) if (sc.stage === i) session.scenes.delete(k);
    s.sec.innerHTML = `<div class="stage-body"></div>
      <div class="stage-foot">
        <button type="button" class="link-btn stage-ask" ${document.body.classList.contains('ai-on') ? '' : 'hidden'}>这一段有疑问？问 Claude</button>
        <button type="button" class="btn live-done">${s.done ? '再说一次：做完了' : '这段做完了'}</button>
      </div>`;
    renderLesson(src, s.sec.querySelector('.stage-body'));
    s.touched = false;
    lint(s, i);
  }

  function lint(s, i) {
    const ps = session.problems.filter((p) => p.stage === i);
    if (!ps.length) return;
    const text = `黑板上「${s.id}」这一段有 ${ps.length} 处写法问题：\n` + ps.map((p, k) => `${k + 1}. ${p.kind}：${p.msg}`).join('\n');
    const b = document.createElement('div');
    b.className = 'lint lint-step';
    b.innerHTML = `<div class="lint-head"><strong>这一段有 ${ps.length} 处写法问题</strong><button type="button" class="btn btn-sm lint-copy">复制给 Claude</button></div><ol>${ps.map((p) => `<li>${escapeHtml(`${p.kind}：${p.msg}`)}</li>`).join('')}</ol>`;
    b.querySelector('.lint-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); toast('已复制，去对话里粘贴给 Claude'); } catch { toast('没能复制，请手动选中文字'); }
    });
    s.sec.prepend(b);
  }

  function markUpdated(s) {
    if (s.sec.querySelector('.live-updated')) return;
    const b = document.createElement('div');
    b.className = 'live-updated';
    b.innerHTML = '<span>Claude 改了这一段。你已经在这里作答，所以先没替换。</span><button type="button" class="btn btn-sm btn-primary">看新版本</button>';
    b.querySelector('button').addEventListener('click', () => { draw(s); refresh(); });
    s.sec.querySelector('.stage-foot').before(b);
  }

  function setHidden(s, h) {
    if (s.hidden === h) return;
    s.hidden = h;
    s.sec.hidden = h;
  }

  function refresh() {
    const vis = [...box.querySelectorAll('.live-step')].filter((sec) => !sec.hidden);
    empty.hidden = vis.length > 0;
    // 小节编号：标题里没写编号的，按显示顺序补一个粉笔圈
    vis.forEach((sec, k) => {
      const h = sec.querySelector('.stage-body > h2');
      if (h && !h.querySelector('.h-num')) h.innerHTML = `<span class="h-num">${k + 1}</span><span>${h.innerHTML}</span>`;
    });
    dots.innerHTML = vis.map((sec, k) => {
      const s = steps.get(sec.dataset.step);
      const cls = s.done ? 'done' : k === vis.length - 1 ? 'current' : 'seen';
      const name = session.stages[sec.dataset.stage]?.title || `第 ${k + 1} 段`;
      return `<button type="button" role="listitem" class="g-dot ${cls}" data-step="${escapeHtml(s.id)}" title="${escapeHtml(name)}" aria-label="${escapeHtml(`第 ${k + 1} 段：${name}`)}"><span>${k + 1}</span></button>`;
    }).join('');
  }

  function announce(s) {
    s.sec.classList.remove('stage-enter');
    void s.sec.offsetWidth;
    s.sec.classList.add('stage-enter');
    root.querySelector('.g-bar').classList.add('g-flash');
    setTimeout(() => root.querySelector('.g-bar').classList.remove('g-flash'), 1600);
    toast('黑板上有新内容');
    setTimeout(() => s.sec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  box.addEventListener('click', (e) => {
    const done = e.target.closest('.live-done');
    if (done) {
      const sec = done.closest('.live-step');
      const s = steps.get(sec.dataset.step);
      s.done = true;
      session.event('done', sec, { title: session.stages[sec.dataset.stage]?.title || '' });
      done.textContent = '已告诉黑板 ✓';
      done.classList.add('is-done');
      setTimeout(() => { done.textContent = '再说一次：做完了'; done.classList.remove('is-done'); }, 2600);
      toast('回对话说一声，Claude 会看你的作答');
      refresh();
      return;
    }
    const ask = e.target.closest('.stage-ask');
    if (ask) session.openTutor?.(Number(ask.closest('.stage').dataset.stage));
  });
  dots.addEventListener('click', (e) => {
    const d = e.target.closest('.g-dot');
    if (d) steps.get(d.dataset.step)?.sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
