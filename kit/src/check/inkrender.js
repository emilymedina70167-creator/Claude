// 检验手写的图（设计 5.4）：从笔画数据重画——整页图、某一刻的快照（frameAt 的结果）、回放。
// 白底黑字（给页面里的 Claude 和主讲看，对比度最高）；划掉的灰色带一道线；左边空白处淡淡写行号 L1、L2…（转写、时间线按它对）
import { drawStroke } from '../ink/engine.js';
import { frameAt } from './inktime.js';

const MARGIN = 44; // 左边留给行号
const PAD = 20;

function boundsOf(strokes) {
  if (!strokes.length) return [0, 0, 400, 200];
  return strokes.reduce((a, s) => [Math.min(a[0], s.bbox[0]), Math.min(a[1], s.bbox[1]), Math.max(a[2], s.bbox[2]), Math.max(a[3], s.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);
}

/** 画一张图：strokes 里 struckNow / struck 的画成划掉的。lines：linesOf 的结果（行号）；box：整页的范围（快照和整页用同一个，位置对得上） */
export function drawFrame(canvas, strokes, { lines = [], numbers = true, box = boundsOf(strokes), maxSide = 1600, scale = 2 } = {}) {
  const w = box[2] - box[0] + PAD * 2 + MARGIN, h = box[3] - box[1] + PAD * 2;
  const k = Math.min(scale, maxSide / Math.max(w, h));
  canvas.width = Math.ceil(w * k);
  canvas.height = Math.ceil(h * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(k, k);
  const ox = PAD + MARGIN - box[0], oy = PAD - box[1];
  for (const s of strokes) {
    const struck = s.struckNow ?? (s.struck !== undefined && s.struck !== null);
    drawStroke(ctx, s, ox, oy, struck ? '#b4b4b4' : '#111111');
    if (struck) {
      // 划掉：一道线穿过这一笔（留痕，和纸上一样）
      const y = (s.bbox[1] + s.bbox[3]) / 2 + oy;
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(s.bbox[0] + ox, y); ctx.lineTo(s.bbox[2] + ox, y); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  if (numbers) {
    ctx.fillStyle = '#9a9a9a';
    ctx.font = '13px -apple-system, "PingFang SC", sans-serif';
    ctx.textBaseline = 'middle';
    for (const L of lines) ctx.fillText(`L${L.n}`, 8, (L.top + L.bottom) / 2 + oy);
  }
  ctx.restore();
  return canvas;
}

/** 一张 PNG（Blob） */
export function renderFrame(strokes, opts = {}) {
  const c = drawFrame(document.createElement('canvas'), strokes, opts);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

/** 回放：照时间重画，能拖进度、能播放（「以前的课」里那道题下面） */
export function replay(host, strokes = [], events = [], { lines = [] } = {}) {
  const end = strokes.reduce((m, s) => Math.max(m, s.t1 || 0, s.struck || 0), 0) || 1;
  const box = boundsOf(strokes);
  const el = document.createElement('div');
  el.className = 'ck-replay';
  el.innerHTML = '<canvas class="ck-replay-canvas"></canvas><div class="ck-replay-bar"><button type="button" class="btn btn-sm ck-replay-play">播放</button><input type="range" min="0" step="100" class="ck-replay-range" aria-label="回放到哪一刻"></div>';
  host.appendChild(el);
  const canvas = el.querySelector('canvas');
  const range = el.querySelector('input');
  range.max = String(end);
  range.value = String(end);
  const draw = (t) => drawFrame(canvas, frameAt(strokes, t), { lines, box, scale: 1.5 });
  range.addEventListener('input', () => draw(Number(range.value)));
  let timer = null;
  el.querySelector('.ck-replay-play').addEventListener('click', () => {
    clearInterval(timer);
    let t = 0;
    const stepMs = Math.max(200, end / 150);
    timer = setInterval(() => { t = Math.min(end, t + stepMs); range.value = String(t); draw(t); if (t >= end) clearInterval(timer); }, 50);
  });
  draw(end);
  return { el, destroy() { clearInterval(timer); el.remove(); } };
}
