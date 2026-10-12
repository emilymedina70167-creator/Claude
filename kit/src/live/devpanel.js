// 开发面板（地址带 ?dev 时出现）：扮演对话里的 Claude，往黑板上写段落（第几块板、常驻栏）、查看作答、
// 看页面写回来的写法检查（lint）和屏幕大小（meta/screen）。
// 数据存在这台设备的 localStorage 里，接口和真数据库一样，所以课件不用改就能在 iPad 上完整试一遍。
import { escapeHtml } from '../render.js';
import { assetUrl } from './store.js';

const SAMPLE = `## 先猜一猜

\`\`\`answer
id: warm-1
q: 计算 $\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\begin{bmatrix}1\\\\0\\end{bmatrix}$。
answer: [1, 3]
\`\`\``;

export function initDevPanel(store, root) {
  const { db } = store;
  const el = document.createElement('div');
  el.className = 'dev-panel';
  el.innerHTML = `
    <button type="button" class="dev-toggle">开发面板</button>
    <div class="dev-body" hidden>
      <div class="dev-tabs"><button type="button" data-tab="write" class="on">写黑板</button><button type="button" data-tab="answers">作答</button><button type="button" data-tab="events">事件</button><button type="button" data-tab="lint">写回</button><button type="button" data-tab="board">设置</button></div>
      <div class="dev-tab" data-tab="write">
        <div class="dev-row"><label>id <input class="dev-id" placeholder="s1" autocapitalize="off" autocomplete="off" spellcheck="false"></label><label>标题 <input class="dev-title" placeholder="可不填"></label></div>
        <div class="dev-row"><label>第几块板 <input class="dev-page" type="number" min="1" step="1" placeholder="不填就接着上一段"></label><label class="dev-check"><input type="checkbox" class="dev-pin"> 放进常驻栏</label></div>
        <textarea class="dev-md" rows="10" spellcheck="false" placeholder="这一段的课件 Markdown，可以含任何组件"></textarea>
        <div class="dev-row"><button type="button" class="btn btn-sm btn-primary dev-add">写上黑板</button><button type="button" class="btn btn-sm dev-sample">填入示例</button></div>
        <div class="dev-steps"></div>
      </div>
      <div class="dev-tab" data-tab="answers" hidden><div class="dev-list dev-answers"></div></div>
      <div class="dev-tab" data-tab="events" hidden><div class="dev-list dev-events"></div></div>
      <div class="dev-tab" data-tab="lint" hidden><div class="dev-list dev-now"></div><div class="dev-list dev-screen"></div><div class="dev-list dev-lint"></div></div>
      <div class="dev-tab" data-tab="board" hidden>
        <label>单元名 <input class="dev-unit"></label>
        <label>给页面里 Claude 的背景资料（context）<textarea class="dev-context" rows="5"></textarea></label>
        <div class="dev-row"><button type="button" class="btn btn-sm btn-primary dev-meta">保存</button><button type="button" class="btn btn-sm btn-danger dev-clear">清空黑板全部数据</button></div>
      </div>
    </div>`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  $('.dev-toggle').addEventListener('click', () => { $('.dev-body').hidden = !$('.dev-body').hidden; });
  el.querySelector('.dev-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    el.querySelectorAll('.dev-tabs button').forEach((b) => b.classList.toggle('on', b === t));
    el.querySelectorAll('.dev-tab').forEach((p) => (p.hidden = p.dataset.tab !== t.dataset.tab));
  });

  let steps = [];
  db.collection('steps').onSnapshot((snap) => {
    steps = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.seq - b.seq);
    $('.dev-steps').innerHTML = steps.length ? steps.map((s) => `<div class="dev-step${s.hidden ? ' is-hidden' : ''}"><code>${escapeHtml(s.id)}</code><span>#${s.seq} · ${s.pin ? '常驻栏' : `板 ${escapeHtml(String(s.page ?? '–'))}`}</span><span class="dev-step-t">${escapeHtml(s.title || (s.md || '').slice(0, 30))}</span><button type="button" class="link-btn" data-edit="${escapeHtml(s.id)}">编辑</button><button type="button" class="link-btn" data-hide="${escapeHtml(s.id)}">${s.hidden ? '恢复' : '撤回'}</button></div>`).join('') : '<p class="muted">黑板上还没有内容。</p>';
    if (!$('.dev-id').value) $('.dev-id').value = `s${steps.length + 1}`;
  });
  $('.dev-steps').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const s = steps.find((x) => x.id === ed.dataset.edit);
      $('.dev-id').value = s.id; $('.dev-title').value = s.title || ''; $('.dev-md').value = s.md || '';
      $('.dev-page').value = s.page ?? ''; $('.dev-pin').checked = !!s.pin;
      $('.dev-add').textContent = '更新这一段';
      return;
    }
    const hd = e.target.closest('[data-hide]');
    if (hd) {
      const s = steps.find((x) => x.id === hd.dataset.hide);
      await db.doc(`steps/${s.id}`).update({ hidden: !s.hidden });
    }
  });
  $('.dev-id').addEventListener('input', () => { $('.dev-add').textContent = steps.some((s) => s.id === $('.dev-id').value.trim()) ? '更新这一段' : '写上黑板'; });
  $('.dev-sample').addEventListener('click', () => { $('.dev-md').value = SAMPLE; });
  $('.dev-add').addEventListener('click', async () => {
    const id = $('.dev-id').value.trim() || `s${steps.length + 1}`;
    const md = $('.dev-md').value;
    if (!md.trim()) return;
    const old = steps.find((s) => s.id === id);
    const seq = old ? old.seq : Math.max(0, ...steps.map((s) => Number(s.seq) || 0)) + 1;
    const title = $('.dev-title').value.trim();
    const page = Number($('.dev-page').value);
    const pin = $('.dev-pin').checked;
    try {
      await db.doc(`steps/${id}`).set({ seq, md, ...(title ? { title } : {}), ...(pin ? { pin: true } : Number.isInteger(page) && page > 0 ? { page } : {}), hidden: false });
      $('.dev-md').value = ''; $('.dev-title').value = ''; $('.dev-pin').checked = false; $('.dev-id').value = `s${steps.length + 2}`;
      $('.dev-add').textContent = '写上黑板';
    } catch (err) { alert(err.message || String(err)); }
  });

  const fmtTime = (t) => new Date(t).toLocaleTimeString();
  db.collection('answers').onSnapshot((snap) => {
    const rows = snap.docs.map((d) => d.data()).sort((a, b) => b.at - a.at).slice(0, 40);
    $('.dev-answers').innerHTML = rows.length ? rows.map((a) => `<div class="dev-item"><div><b>${escapeHtml(a.kind)}</b> <code>${escapeHtml(a.step || '')}/${escapeHtml(a.block || '')}</code> ${a.ok === true ? '✓' : a.ok === false ? '✗' : ''} <span class="muted">${fmtTime(a.at)}${a.ms ? ` · ${Math.round(a.ms / 1000)}s` : ''}</span></div>${a.q ? `<div class="muted">${escapeHtml(a.q.slice(0, 80))}</div>` : ''}${a.text || a.value ? `<div>${escapeHtml(String(a.text || a.value).slice(0, 160))}</div>` : ''}${(a.images || []).map((id) => `<img src="${assetUrl(id)}" alt="手写原图">`).join('')}</div>`).join('') : '<p class="muted">还没有作答。</p>';
  });
  db.collection('events').onSnapshot((snap) => {
    const rows = snap.docs.map((d) => d.data()).sort((a, b) => b.at - a.at).slice(0, 40);
    $('.dev-events').innerHTML = rows.length ? rows.map((e) => `<div class="dev-item"><b>${escapeHtml(e.type)}</b> <code>${escapeHtml(e.step || '')}${e.block ? '/' + escapeHtml(e.block) : ''}</code> <span class="muted">${fmtTime(e.at)}</span>${e.detail ? `<div class="muted">${escapeHtml(JSON.stringify(e.detail).slice(0, 160))}</div>` : ''}</div>`).join('') : '<p class="muted">还没有事件。</p>';
  });

  db.collection('lint').onSnapshot((snap) => {
    const rows = snap.docs.map((d) => d.data()).sort((a, b) => (b.at || 0) - (a.at || 0));
    $('.dev-lint').innerHTML = rows.length ? rows.map((l) => `<div class="dev-item"><b>${escapeHtml(l.step || '')}</b> ${l.ok ? '✓ 没有错' : '✗ 有写法错误'} <span class="muted">${l.at ? fmtTime(l.at) : ''}</span>${(l.problems || []).map((p) => `<div class="muted">${escapeHtml(`${p.kind}：${p.msg}`)}</div>`).join('')}</div>`).join('') : '<p class="muted">还没有写法检查的记录（段都没写错）。</p>';
  });
  db.doc('meta/screen').onSnapshot((snap) => {
    const d = snap.exists ? snap.data() : null;
    $('.dev-screen').innerHTML = d ? `<div class="dev-item"><b>屏幕</b> ${d.landscape ? '横屏' : '竖屏'} ${d.w}×${d.h}${d.board ? ` · 一块板约 ${d.board.w}×${d.board.h}` : ''} · 当前第 ${d.page} 块${d.fits === false ? `，放不下（要 ${d.need}）` : d.fits ? '，放得下' : ''}</div>` : '<p class="muted">页面还没写回屏幕大小。</p>';
  });

  // 黑板现状 meta/now：对话里的 Claude 说「好了」时读的那一份
  db.doc('meta/now').onSnapshot((snap) => {
    const d = snap.exists ? snap.data() : null;
    if (!d) { $('.dev-now').innerHTML = '<p class="muted">页面还没写黑板现状。</p>'; return; }
    const li = (xs) => xs.map((x) => `<div class="muted">${escapeHtml(x)}</div>`).join('');
    $('.dev-now').innerHTML = `<div class="dev-item"><b>黑板现状</b> <span class="muted">${d.at ? fmtTime(d.at) : ''} · 当前第 ${d.board} 块，在看第 ${d.view} 块</span>
      ${d.recent?.length ? `<div>最近作答：</div>${li(d.recent.slice(-6).map((r) => r.line))}` : ''}
      ${d.drafts?.length ? `<div>草稿：</div>${li(d.drafts.map((x) => `${x.step}/${x.block}${x.label ? ' ' + x.label : ''}：${x.text}`))}` : ''}
      ${d.lint?.length ? `<div>写法错误：</div>${li(d.lint.map((x) => `${x.step}：${x.problems.join('；')}`))}` : ''}
      ${d.uploads?.length ? `<div>交来的截图：</div>${d.uploads.map((u) => `<div class="muted">${escapeHtml(u.note || '（没写说明）')}</div>${u.images.map((id) => `<img src="${assetUrl(id)}" alt="交来的截图">`).join('')}`).join('')}` : ''}</div>`;
  });

  db.doc('meta/board').get().then((s) => { const d = s.data() || {}; $('.dev-unit').value = d.unit || ''; $('.dev-context').value = d.context || ''; });
  $('.dev-meta').addEventListener('click', () => db.doc('meta/board').set({ unit: $('.dev-unit').value, context: $('.dev-context').value, updatedAt: Date.now() }));
  $('.dev-clear').addEventListener('click', () => { if (confirm('清空本地黑板的全部段落和作答？')) { db._clear?.(); location.reload(); } });
  root.dataset.dev = '1';
}
