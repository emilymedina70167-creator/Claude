// 自由段 html 的画面（读法、桥上的判在 htmlseg.js）：板上一个隔离框，里面是主讲写的整页小网页。
// 框高跟着内容；桥上来的作答进证据（session.record，带 judgedBy）、草稿进 drafts、报错记成动作进 ext_out；
// 状态存在课堂给的 session.htmlState（学习台里是 sessions/{编号}/html_state/{组件 id}），再画时放回。
import { session } from '../session.js';
import { markDraft } from '../drafts.js';
import { calcScope } from './common.js';
import { parseHtmlSeg, frameDoc, recordOf, bridgeCalc, bridgeSame, judgeCheck } from '../htmlseg.js';

// 所有框共用一个监听：按消息是哪个框发的找到它（框被挪动会重新载入，contentWindow 跟着换，每次现取）
const frames = new Set();
let listening = false;
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (e) => {
    for (const f of frames) {
      if (!f.frame.isConnected || e.source !== f.frame.contentWindow) continue;
      const m = e.data;
      if (m && typeof m === 'object' && m.lab === f.nonce && typeof m.type === 'string') f.handle(m.type, m.data && typeof m.data === 'object' ? m.data : {});
      return;
    }
  });
}
// 段被换掉、整块板删掉的框：连着两次清点都不在页面上才放掉（挪位置的那一下只断开一瞬间）
function sweep() {
  for (const f of frames) {
    if (f.frame.isConnected) { f.gone = false; continue; }
    if (f.gone) frames.delete(f); else f.gone = true;
  }
}

const nonceOf = () => {
  try { return [...crypto.getRandomValues(new Uint32Array(2))].map((x) => x.toString(36)).join(''); } catch { return Math.random().toString(36).slice(2); }
};

// 页面现在的字色、字体、深浅：框里默认跟着
function lookOf(el) {
  try {
    const cs = getComputedStyle(el);
    const rgb = (cs.color.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const light = rgb.length === 3 ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 0;
    return { color: cs.color, font: cs.fontFamily, dark: light > 0.6 };
  } catch { return {}; }
}

export function htmlBlock(el, src) {
  sweep();
  listen();
  const { html } = parseHtmlSeg(src);
  const id = el.dataset.bid;
  el.classList.add('block-htmlseg');
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', '主讲写的一段');
  frame.className = 'hs-frame';
  el.appendChild(frame);
  const nonce = nonceOf();
  const drafts = new Map(); // q → 草稿
  const errors = new Map(); // 同一句报错只记一次
  const anchorEls = new Map();
  let saveT = 0;
  const store = session.htmlState || null;

  // 草稿：交给 drafts.js，课堂发下一轮时一起带上
  const draftEl = document.createElement('div');
  draftEl.hidden = true;
  el.appendChild(draftEl);
  markDraft(draftEl, () => [...drafts].map(([q, v]) => (q ? `${q}：${v}` : v)).join('\n'));

  const reply = (rid, r) => {
    try { frame.contentWindow?.postMessage({ lab: nonce, type: 'reply', data: { id: rid, ...r } }, '*'); } catch { /* 框已经没了 */ }
  };
  const handle = (type, d) => {
    switch (type) {
      case 'height': {
        const h = Math.max(0, Math.min(20000, Number(d.h) || 0));
        frame.style.height = `${h}px`;
        return;
      }
      case 'record':
        session.record({ ...recordOf(d), el });
        return;
      case 'draft': {
        const q = String(d.q ?? ''), v = d.value === undefined || d.value === null ? '' : typeof d.value === 'string' ? d.value : JSON.stringify(d.value);
        if (v.trim()) drafts.set(q, v); else drafts.delete(q);
        return;
      }
      case 'calc': reply(d.id, bridgeCalc(d.src, calcScope())); return;
      case 'same': reply(d.id, bridgeSame(d.a, d.b, { loose: !!d.loose })); return;
      case 'check': {
        const opts = d.opts && typeof d.opts === 'object' ? d.opts : {};
        const r = judgeCheck(d.value, d.answer, d.how, opts, calcScope());
        session.record({ type: 'html', q: String(opts.q ?? ''), value: typeof d.value === 'string' ? d.value : JSON.stringify(d.value ?? ''), ok: r.ok, judgedBy: 'page', how: String(d.how || 'value'), ...(r.why ? { why: r.why } : {}), el });
        reply(d.id, { value: r.ok });
        return;
      }
      case 'state':
        if (!store?.put || !id) return;
        clearTimeout(saveT);
        saveT = setTimeout(() => { try { store.put(id, { state: d.state ?? {}, at: Date.now() }); } catch (e) { console.error(e); } }, 600);
        return;
      case 'error': {
        const text = String(d.text ?? '').trim() || '出错了';
        if (errors.has(text) || errors.size >= 8) return;
        errors.set(text, true);
        session.event('html-error', el, { text });
        return;
      }
      case 'anchors': placeAnchors(Array.isArray(d.list) ? d.list : []); return;
      case 'wide': session.event('html-note', el, { text: `内容比框宽：内容 ${Math.round(Number(d.content) || 0)}px，框 ${Math.round(Number(d.frame) || 0)}px，右边学生看不到（框里能横着滑）` }); return;
      case 'shot': { const w = shots.get(d.id); if (w) { shots.delete(d.id); w(typeof d.url === 'string' && d.url.startsWith('data:image/png') ? d.url : null); } return; }
      default:
    }
  };
  // 锚点：框外面盖一个透明的小块，board mark target=<id>-<名字> 找得到它（标注画在框外面这一层）
  function placeAnchors(list) {
    if (!id) return;
    for (const a of list.slice(0, 40)) {
      const r = a?.rect || {};
      const name = String(a?.name ?? '').replace(/[^\w\-.~:@+]/g, '').slice(0, 40);
      if (!name) continue;
      let box = anchorEls.get(name);
      if (!box) { box = document.createElement('div'); box.className = 'hs-anchor'; box.dataset.bid = `${id}-${name}`; el.appendChild(box); anchorEls.set(name, box); }
      Object.assign(box.style, { left: `${frame.offsetLeft + (Number(r.x) || 0)}px`, top: `${frame.offsetTop + (Number(r.y) || 0)}px`, width: `${Math.max(0, Number(r.w) || 0)}px`, height: `${Math.max(0, Number(r.h) || 0)}px` });
    }
  }
  // 截图：问框里要一张它自己拍的图（3 秒没回就算了）
  const shots = new Map();
  let shotSeq = 0;
  frame._shot = () => new Promise((ok) => {
    const sid = ++shotSeq;
    const t = setTimeout(() => { shots.delete(sid); ok(null); }, 3000);
    shots.set(sid, (url) => { clearTimeout(t); ok(url); });
    try { frame.contentWindow?.postMessage({ lab: nonce, type: 'shot', data: { id: sid } }, '*'); } catch { clearTimeout(t); shots.delete(sid); ok(null); }
  });
  frames.add({ frame, nonce, handle, gone: false });

  // 刷新前存的状态拿到了（或者等了 1.5 秒还没有）再装进框里
  let started = false;
  const start = (state) => {
    if (started) return;
    started = true;
    frame.srcdoc = frameDoc({ html, nonce, state, look: lookOf(el) });
  };
  if (store?.get && id) {
    const t = setTimeout(() => start(null), 1500);
    Promise.resolve().then(() => store.get(id)).then((doc) => { clearTimeout(t); start(doc?.state ?? null); }, () => { clearTimeout(t); start(null); });
  } else start(null);
}


