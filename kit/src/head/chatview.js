// 班主任那一页（#chat、#chat/h-…，第十一轮 B1）：照学习台的紫藤 iOS——上面一排以前的对话（最近的在前，「新对话」），
// 中间是对话（我的话是右边南大紫的气泡，它的话是左边的毛玻璃卡，Markdown 和公式照常画、边写边显示，「在想」是三个点），
// 底下一个输入框（字号 16px；回车换行不发，发送键发）和停止键。B1 只收字。数据都在 headdesk.js。
import { mdToHtml, escapeHtml } from '../render.js';
import { toDate } from '../memory/schema.js';

const STARTERS = ['我现在学得怎么样？', '接下来一周怎么排比较好？', '我说过的要求你都记着吗？'];

export function createChatPage(host, { head, goto = (h) => { location.hash = h; } }) {
  let cid = '';
  let busy = null; // 正在回的那一次：{ ctl }
  let list = [];
  // 第十五轮：主讲在 claude.ai 的项目对话里；首页导航不再列这一页，以前的对话在 #chat 还能翻看、接着说
  host.innerHTML = `<div class="hd-page">
    <div class="hd-chats" role="tablist" aria-label="以前的对话"></div>
    <section class="dk-card hd-chat" aria-label="和班主任说话">
      <div class="hd-msgs" aria-live="polite"></div>
      <form class="hd-form" novalidate>
        <textarea class="hd-input" rows="1" placeholder="跟班主任说…" aria-label="跟班主任说"></textarea>
        <button type="submit" class="hd-send" aria-label="发送" disabled><span aria-hidden="true">↑</span></button>
      </form>
    </section></div>`;
  const $ = (s) => host.querySelector(s);
  const msgs = $('.hd-msgs');
  const ta = $('.hd-input');
  const send = $('.hd-send');

  const md = (t) => { try { return mdToHtml(String(t ?? '')); } catch { return `<p>${escapeHtml(String(t ?? ''))}</p>`; } };
  const memoLine = (m) => (m ? `<p class="hd-memo muted">${m.n ? `记进记忆 ${m.n} 条（「管理 → 最近记下的」能撤销）` : ''}${m.n && m.rejected?.length ? ' · ' : ''}${m.rejected?.length ? `${m.rejected.length} 条没记上` : ''}</p>` : '');
  function turnHtml(t) {
    if (t.role === 'me') return `<div class="hd-me"><span>${escapeHtml(String(t.text || '')).replace(/\n/g, '<br>')}</span></div>`;
    if (t.void) return `<div class="hd-head is-void">${t.text ? md(t.text) : ''}<p class="hd-err">${escapeHtml(t.why || '这一轮作废了')}</p></div>`;
    return `<div class="hd-head">${md(t.shown ?? t.text)}${memoLine(t.memo)}</div>`;
  }
  function empty() {
    msgs.innerHTML = `<div class="hd-empty"><span class="hd-badge" aria-hidden="true">班</span><div class="hd-hello">班主任</div>
      <p class="muted">学习台里的每一节课、每一条记忆、预测分它都看得到。问它学得怎么样、怎么安排、想改学习台的哪里；你说的要求它会记进「我的要求」，下一节课的老师一定读到。</p>
      <div class="hd-starters">${STARTERS.map((s) => `<button type="button" class="hd-starter">${escapeHtml(s)}</button>`).join('')}</div></div>`;
  }
  const atBottom = () => host.ownerDocument.defaultView?.scrollTo?.({ top: host.ownerDocument.body.scrollHeight, behavior: 'smooth' });

  function paintList() {
    const box = $('.hd-chats');
    box.innerHTML = `<button type="button" class="hd-chip hd-new" aria-selected="${!cid}">＋ 新对话</button>${list.slice(0, 20).map((c) => `<button type="button" class="hd-chip" data-cid="${escapeHtml(c.id)}" aria-selected="${c.id === cid}"><b>${escapeHtml(c.title || '对话')}</b><small>${escapeHtml(toDate(c.last || c.startedAt || 0).slice(5).replace('-', '月'))}日</small></button>`).join('')}`;
  }
  async function refreshList() {
    list = await head.chats().catch(() => []);
    paintList();
  }
  async function openChat(id) {
    cid = id || '';
    paintList();
    if (!cid) { empty(); return; }
    msgs.innerHTML = '<p class="muted hd-loading">正在读这段对话…</p>';
    const turns = await head.turnsOf(cid).catch(() => []);
    if (cid !== id) return; // 读的时候又换了一段
    msgs.innerHTML = turns.length ? turns.map(turnHtml).join('') : '';
    if (!turns.length) empty();
    atBottom();
  }

  function sync() {
    const has = !!ta.value.trim();
    send.disabled = !busy && !has;
    send.classList.toggle('is-stop', !!busy);
    send.setAttribute('aria-label', busy ? '停止' : '发送');
    send.innerHTML = busy ? '<span class="hd-stopic" aria-hidden="true"></span>' : '<span aria-hidden="true">↑</span>';
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }
  ta.addEventListener('input', sync);

  async function say(text) {
    const t = String(text ?? '').trim();
    if (!t || busy) return;
    ta.value = '';
    sync();
    msgs.querySelector('.hd-empty')?.remove();
    msgs.insertAdjacentHTML('beforeend', turnHtml({ role: 'me', text: t }));
    const box = document.createElement('div');
    box.className = 'hd-head is-live';
    box.innerHTML = '<span class="hd-dots" aria-label="在想"><i></i><i></i><i></i></span>';
    msgs.appendChild(box);
    atBottom();
    const ctl = new AbortController();
    busy = { ctl };
    sync();
    const was = cid;
    let r;
    try {
      r = await head.send(cid, t, { signal: ctl.signal, onText: (shown) => { if (shown) box.innerHTML = md(shown); } });
    } catch (err) {
      r = { cid, error: `没发出去：${err?.message || err}` };
    }
    busy = null;
    sync();
    box.classList.remove('is-live');
    if (r.turn) box.outerHTML = turnHtml(r.turn);
    else {
      box.querySelector('.hd-dots')?.remove();
      box.insertAdjacentHTML('beforeend', `<p class="hd-err">${escapeHtml(r.error || '没回成')}</p>`);
    }
    if (r.cid && r.cid !== was) {
      cid = r.cid;
      // 新对话：地址换成这一段（刷新也在），不重画（hashchange 那边认得出是同一段）
      history.replaceState(null, '', `#chat/${cid}`);
    }
    await refreshList();
    atBottom();
  }

  $('.hd-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) { busy.ctl.abort(); return; }
    say(ta.value);
  });
  host.addEventListener('click', (e) => {
    const s = e.target.closest('.hd-starter');
    if (s) { say(s.textContent); return; }
    const c = e.target.closest('.hd-chip');
    if (!c || busy) return;
    goto(c.dataset.cid ? `#chat/${c.dataset.cid}` : '#chat');
  });

  return {
    /** h：地址 # 后面的（chat 或 chat/h-…） */
    async show(h = 'chat') {
      const id = String(h).split('/')[1] || '';
      await refreshList();
      if (busy && id === cid) return;
      if (id !== cid || !msgs.childElementCount) await openChat(id);
      sync();
    },
  };
}
