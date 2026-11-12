// 翻回去看一幕（主线第六轮 3.5）：整屏盖一层只读的回看，里面是那一幕结束那一刻的样子——学生最后拖到哪、拨到哪原样停着，左边是那一幕说过的话。
// 做法：新建一个只读的 Stage，照 log 从头瞬间放到那一幕的最后一行（刷新、只读翻看就是这么放的）。不另存画面。
// 只读的那个 Stage：不传 onAct（不叫老师、不记证据、不写库）、input: false（不挂手势、键盘）、不占 window.LAStage；关上不销毁，下次直接显示
import { Stage } from './stage.js';

const KEEP = 4; // 一节课最多留几幕放好的（多了丢最早的）

const el = (tag, cls, parent) => { const n = document.createElement(tag); if (cls) n.className = cls; if (parent) parent.appendChild(n); return n; };

/**
 * 回看那一层。host：盖在哪（舞台的 root）。open(span, log, { title }) 打开第 n 幕；close() 关上；onClose(ms) 告诉外面看了多久。
 * cache 照幕号存放好的 Stage（同一幕第二次打开不再放一遍；放的 log 长度变了——那一幕后来又写了行——重放）
 */
export function createLookback(host, { onOpen = null, onClose = null } = {}) {
  const layer = el('div', 'st-look', host);
  layer.hidden = true;
  const bar = el('div', 'st-look-bar', layer);
  const name = el('div', 'st-look-name', bar);
  const back = el('button', 'st-look-back', bar);
  back.type = 'button';
  back.textContent = '回到现在 →';
  const keys = el('div', 'st-look-keys', layer);
  const body = el('div', 'st-look-body', layer);
  const cache = new Map(); // n → { stage, node, end }
  let cur = null, since = 0;
  const close = () => {
    if (!cur) return;
    const was = cur;
    cur = null;
    layer.hidden = true;
    back.classList.remove('has-new');
    onClose?.({ n: was.n, title: was.title, ms: Date.now() - since });
  };
  back.addEventListener('click', close);
  // 从左往右滑 80px 以上也回去（和 iOS 的返回一样）
  let x0 = null;
  layer.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  layer.addEventListener('pointerup', (e) => { if (x0 != null && e.clientX - x0 > 80) close(); x0 = null; });
  const open = async (span, log, { title = '' } = {}) => {
    if (cur) close();
    cur = { n: span.n, title: span.title };
    since = Date.now();
    name.textContent = `回看 · 第 ${span.n} 幕 ${span.title}`;
    keys.replaceChildren(...span.keys.map((k) => { const p = el('p', 'st-look-key'); p.textContent = k; return p; }));
    keys.hidden = !span.keys.length;
    layer.hidden = false;
    onOpen?.(cur);
    let got = cache.get(span.n);
    if (got && got.end !== span.end) { got.stage.destroy(); got.node.remove(); cache.delete(span.n); got = null; }
    for (const g of cache.values()) g.node.hidden = true;
    if (!got) {
      const node = el('div', 'st-look-stage', body);
      const stage = new Stage(node, { input: false });
      stage.lessonTitle = title;
      got = { stage, node, end: span.end };
      cache.set(span.n, got);
      while (cache.size > KEEP) { const [k, g] = cache.entries().next().value; g.stage.destroy(); g.node.remove(); cache.delete(k); }
      await stage.replay(log.slice(0, span.end + 1));
    }
    got.node.hidden = false;
    got.stage.noteView();
    await got.stage.refocus(false);
    return got.stage;
  };
  return {
    open,
    close,
    get open_() { return cur; },
    isOpen: () => !!cur,
    /** 回看开着的时候老师说话了：「回到现在」上亮一个点 */
    markNew: () => { if (cur) back.classList.add('has-new'); },
    stageOf: (n) => cache.get(n)?.stage || null,
  };
}
