// 改动单的画面（docs/desk-plan.md 4.1～4.3）：课堂里板顶那句话下面的小字（「记下了：偏好 1 条；待你确认：错题 1 条」，点开看每一条）、
// 下课小结那块板上的整理单、学习台首页的「待确认」。每一条：说的什么、为什么、依据（点开看那次作答原文）、
// 等确认的「确认 / 改 / 不要」，写进去了的「撤销」（UNDO_DAYS 天内）。
// 确认、不要、撤销只在这里由我点按钮触发（memops.js），课堂里的 Claude 的输出碰不到。
import { escapeHtml } from '../render.js';
import { toast } from '../record.js';
import { pendingTitle, memoLine, canUndo } from './memo.js';
import { UNDO_DAYS } from './schema.js';

const TIER_TEXT = { direct: '已记下', confirm: '等你确认', me: '你改的' };
const STATUS_TEXT = { done: '已写进去', rejected: '没要', undone: '已撤销' };
// 「改」里能改的：自由写的文字（编号、证据级这类有规矩的取值不在这里改）
const EDITABLE = { q: '题面', mine: '我的答案', step: '错在哪一步', cause: '根因', text: '内容', lesson: '下次怎么做', title: '标题', next: '下一节从哪接', family: '机制族', source: '出处' };
const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/**
 * db：学习台的数据库；ops：memops.js 的 createMemOps。返回 { attach(el, ids(), mode), refresh() }。
 * mode：line（板顶下的一行小字，点开是列表）/ list（整张列出来：小结板上的整理单、首页）
 */
export function createMemoView({ db, ops }) {
  const docs = new Map();
  const spots = new Set();
  let ready = false;
  db.collection('pending').onSnapshot((snap) => {
    docs.clear();
    for (const d of snap.docs) docs.set(d.id, { id: d.id, ...d.data() });
    ready = true;
    refresh();
  }, () => {});

  function refresh() { for (const s of [...spots]) { if (!s.el.isConnected && s.once) spots.delete(s); else paint(s); } }

  /** el：放的地方；ids()：要列哪几张（返回 id 数组，或者直接返回改动单）；opts：{ mode, empty（一条都没有时的话）, title } */
  function attach(el, ids, opts = {}) {
    let s = [...spots].find((x) => x.el === el);
    if (!s) {
      s = { el, ids, opts, open: false, once: !!opts.once };
      spots.add(s);
      el.addEventListener('click', (e) => onClick(s, e));
    } else Object.assign(s, { ids, opts });
    paint(s);
  }

  function list(s) {
    const raw = s.ids() || [];
    return raw.map((x) => (typeof x === 'string' ? docs.get(x) : x && docs.get(x.id) ? docs.get(x.id) : x)).filter(Boolean);
  }

  function paint(s) {
    const pds = list(s);
    const { mode = 'list', empty = '', title = '' } = s.opts;
    if (!pds.length) {
      s.el.hidden = !empty;
      s.el.innerHTML = empty && ready ? `<p class="mm-empty muted">${escapeHtml(empty)}</p>` : '';
      return;
    }
    s.el.hidden = false;
    const editing = s.el.querySelector('.mm-edit:not([hidden])')?.closest('.mm-item')?.dataset.id;
    const shown = new Set([...s.el.querySelectorAll('.mm-evbox:not([hidden])')].map((b) => b.closest('.mm-item')?.dataset.id));
    const items = `<div class="mm-items">${pds.map((p) => item(p)).join('')}</div>`;
    if (mode === 'line') {
      s.el.innerHTML = `<button type="button" class="mm-toggle" aria-expanded="${s.open}">${escapeHtml(memoLine(pds))}<span class="mm-chev" aria-hidden="true">${s.open ? '收起' : '点开'}</span></button><div class="mm-pop"${s.open ? '' : ' hidden'}>${items}</div>`;
    } else {
      s.el.innerHTML = `${title ? `<div class="mm-head" role="heading" aria-level="3">${escapeHtml(title)}</div>` : ''}${items}`;
    }
    // 重画以后，正在改的、点开了证据的照旧开着
    if (editing) openEdit(s.el.querySelector(`.mm-item[data-id="${CSS.escape(editing)}"]`));
    for (const id of shown) showEvidence(s.el.querySelector(`.mm-item[data-id="${CSS.escape(id)}"]`), false);
  }

  function item(p) {
    const tier = p.tier || 'confirm';
    const badge = p.status === 'open' ? TIER_TEXT.confirm : STATUS_TEXT[p.status] || '';
    const acts = p.status === 'open'
      ? '<button type="button" class="btn btn-sm btn-primary mm-ok">确认</button><button type="button" class="btn btn-sm mm-edit-btn">改</button><button type="button" class="btn btn-sm mm-no">不要</button>'
      : p.status === 'done' && canUndo(p) ? `<button type="button" class="btn btn-sm mm-undo" title="${UNDO_DAYS} 天内能撤">撤销</button>` : '';
    const basis = (p.basis || []).slice(0, 8);
    return `<div class="mm-item is-${escapeHtml(p.status)} tier-${escapeHtml(tier)}" data-id="${escapeHtml(p.id)}">
      <div class="mm-top"><span class="mm-badge">${escapeHtml(badge)}</span><span class="mm-title">${escapeHtml(pendingTitle(p))}</span></div>
      ${p.reason ? `<p class="mm-why">${escapeHtml(cut(p.reason, 200))}</p>` : ''}
      ${basis.length ? `<div class="mm-basis"><span class="muted">依据</span>${basis.map((b) => `<button type="button" class="mm-ev" data-ev="${escapeHtml(b)}">${escapeHtml(b)}</button>`).join('')}</div><div class="mm-evbox" hidden></div>` : ''}
      ${acts ? `<div class="mm-acts">${acts}</div>` : ''}
      <form class="mm-edit" hidden></form>
    </div>`;
  }

  async function onClick(s, e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('mm-toggle')) { s.open = !s.open; paint(s); return; }
    const box = t.closest('.mm-item');
    const pd = box && docs.get(box.dataset.id);
    if (!pd) return;
    if (t.classList.contains('mm-ev')) { showEvidence(box, true, t.dataset.ev); return; }
    if (t.classList.contains('mm-edit-btn')) { openEdit(box, true); return; }
    if (t.classList.contains('mm-edit-cancel')) { box.querySelector('.mm-edit').hidden = true; return; }
    const act = t.classList.contains('mm-ok') ? 'confirm' : t.classList.contains('mm-no') ? 'reject' : t.classList.contains('mm-undo') ? 'undo' : t.classList.contains('mm-edit-save') ? 'save' : '';
    if (!act) return;
    if (act === 'undo' && !confirm(`撤销「${cut(pendingTitle(pd), 40)}」？`)) return;
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      if (act === 'confirm') await ops.confirm(pd);
      else if (act === 'reject') await ops.reject(pd);
      else if (act === 'undo') await ops.undo(pd);
      else await ops.confirm(pd, readEdit(box, pd));
      toast({ confirm: '写进去了', reject: '不要了（留着记录）', undo: '撤销了', save: '改好写进去了' }[act]);
    } catch (err) {
      toast(`没成：${err?.message || err}`);
      box.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  }

  function fields(pd) {
    const src = pd.op === 'add' ? pd.data || {} : pd.patch || {};
    return Object.keys(EDITABLE).filter((k) => typeof src[k] === 'string').map((k) => [k, src[k]]);
  }
  function openEdit(box, focus = false) {
    if (!box) return;
    const pd = docs.get(box.dataset.id);
    const form = box.querySelector('.mm-edit');
    if (!pd || !form) return;
    const fs = fields(pd);
    if (!fs.length) { toast('这一条没有能改的文字，不对就点「不要」'); return; }
    if (form.hidden) {
      form.innerHTML = `${fs.map(([k, v]) => `<label class="mm-f"><span>${EDITABLE[k]}</span><textarea name="${k}" rows="${v.length > 40 ? 3 : 1}">${escapeHtml(v)}</textarea></label>`).join('')}
        <div class="mm-acts"><button type="button" class="btn btn-sm btn-primary mm-edit-save">改好了，确认</button><button type="button" class="btn btn-sm mm-edit-cancel">算了</button></div>`;
      form.hidden = false;
      if (focus) form.querySelector('textarea')?.focus();
    }
  }
  function readEdit(box, pd) {
    const out = {};
    const src = pd.op === 'add' ? pd.data || {} : pd.patch || {};
    for (const ta of box.querySelectorAll('.mm-edit textarea')) {
      const v = ta.value.trim();
      if (!v) throw new Error(`${EDITABLE[ta.name]}不能空着`);
      if (v !== src[ta.name]) out[ta.name] = v;
    }
    return Object.keys(out).length ? out : null;
  }

  // 依据：证据就读出那次作答 / 说的话；记忆里的编号就说是哪一条
  async function showEvidence(box, toggle, id) {
    if (!box) return;
    const ev = box.querySelector('.mm-evbox');
    if (!ev) return;
    const want = id || ev.dataset.ev;
    if (toggle && !ev.hidden && ev.dataset.ev === want) { ev.hidden = true; return; }
    ev.dataset.ev = want;
    ev.hidden = false;
    if (!/^ev-/.test(want)) { ev.textContent = `${want}：记忆库里的一条（错题、弱点或观察），在学习台首页的记忆库里看`; return; }
    ev.textContent = '正在读…';
    const snap = await db.doc(`evidence/${want}`).get().catch(() => null);
    const d = snap?.exists ? snap.data() : null;
    if (!d) { ev.textContent = `${want}：没找到`; return; }
    const ok = d.ok === true ? '对' : d.ok === false ? '错' : '';
    if (d.src === 'say') { ev.innerHTML = `<b>学生说的话</b><div>「${escapeHtml(cut(d.text || '（附了图）', 300))}」${d.images?.length ? `<span class="muted">（${d.images.length} 张图）</span>` : ''}</div>`; return; }
    ev.innerHTML = `<b>${escapeHtml(d.kind || '')}</b>${d.comp ? ` <code>${escapeHtml(d.comp)}</code>` : ''}${d.q ? `<div>题：${escapeHtml(cut(d.q, 200))}</div>` : ''}${d.value || d.text ? `<div>写的：${escapeHtml(cut(d.value ?? d.text, 300))}${ok ? `（${ok}${d.attempts ? `，第 ${d.attempts} 次` : ''}）` : ''}</div>` : ''}${d.images?.length ? `<div class="muted">有 ${d.images.length} 张原图</div>` : ''}`;
  }

  return { attach, refresh, get: (id) => docs.get(id), all: () => [...docs.values()] };
}
