// 老师自己画的东西（第九轮「画面归老师」）：draw 名字 arrow / circle / box / brace / underline / text / svg。
// 现成的几种复用黑板的手绘形状（markdraw.js：圈、下划线、箭头），和板书标注一个手感；svg 是任意示意图，过 svgsafe.js 的白名单。
// 贴在部件上的跟着那样东西走（每次照部件现在在画面上的框重画），画在格子上的钉在那里。纯函数。

import { shapeFor, arrowPath } from '../markdraw.js';
import { parseSketch, sketchMarkup } from '../svgsafe.js';
import { parseAt, fromCells } from './compose/grid.js';

export const DRAW_KINDS = ['arrow', 'circle', 'box', 'brace', 'underline', 'text', 'svg'];
const KIND_NAMES = { arrow: '箭头', circle: '圈', box: '框', brace: '括号', underline: '下划线', text: '字', svg: '示意图' };

/**
 * 一行 draw 读成 { name, kind, from, to, on, under, over, at, text, svg, color }。
 * has(ref)：舞台上有没有这个部件 / 东西（写错就抛它自己的话）。写错抛中文
 */
export function parseDraw(words, opts, strs, has) {
  const [name, kind] = words;
  if (!name || !/^[A-Za-z_]\w*$/.test(name)) throw new Error('要写成 draw 名字 画法 …（比如 draw d1 arrow from=s.3 to=tl.fr）');
  if (!DRAW_KINDS.includes(kind)) throw new Error(`画法只有 ${DRAW_KINDS.join(' / ')}（draw ${name} circle on=s.3）`);
  const spec = { name, kind };
  const ref = (k) => { if (opts[k] == null) return; has(opts[k]); spec[k] = String(opts[k]); };
  if (kind === 'arrow') {
    if (opts.from == null || opts.to == null) throw new Error(`arrow 要写 from= 和 to=（draw ${name} arrow from=s.3 to=tl.fr）`);
    ref('from'); ref('to');
  } else if (kind === 'brace') {
    if (opts.under == null && opts.over == null) throw new Error(`brace 要写 under= 或 over=（draw ${name} brace under=s.3-4 "谓语"）`);
    ref('under'); ref('over');
    if (strs[0]) spec.text = strs[0];
  } else if (kind === 'text' || kind === 'svg') {
    const at = parseAt(opts.at);
    if (!at) throw new Error(`${kind} 要写 at= 格子：at= 写成 6,4-40,12（第几列第几行到第几列第几行）`);
    spec.at = at;
    if (!strs[0]) throw new Error(`${kind} 后面写${kind === 'text' ? '字' : ' SVG（不写外面的 <svg>，坐标按 0～100 的方框）'}，用引号括起来`);
    if (kind === 'svg') {
      const { errors } = parseSketch(strs[0]);
      if (errors.length) throw new Error(`svg 里有页面不画的：${errors.join('；')}`);
      spec.svg = strs[0];
    } else spec.text = strs[0];
  } else {
    if (opts.on == null) throw new Error(`${kind} 要写 on=（draw ${name} ${kind} on=s.3-4）`);
    ref('on');
  }
  if (opts.color != null) spec.color = String(opts.color);
  return spec;
}

/** 这一笔指着哪几样东西（东西拿掉了它跟着没） */
export function drawObjects(spec) {
  return ['from', 'to', 'on', 'under', 'over'].map((k) => spec[k]).filter(Boolean).map((r) => String(r).match(/^[A-Za-z_]\w*/)?.[0]).filter(Boolean);
}

/** 现状里的一句：d1 箭头 s.3→tl.fr */
export function drawText(spec) {
  const where = spec.kind === 'arrow' ? `${spec.from}→${spec.to}` : spec.at ? `${spec.at.c0},${spec.at.r0}-${spec.at.c1},${spec.at.r1}` : spec.on || spec.under || spec.over;
  return `${spec.name} ${KIND_NAMES[spec.kind]} ${where}${spec.text ? `「${spec.text.slice(0, 12)}」` : ''}`;
}

const PAD = 6;
const r1 = (v) => Math.round(v * 10) / 10;
function bboxOf(list) {
  const x0 = Math.min(...list.map((b) => b.x)), y0 = Math.min(...list.map((b) => b.y));
  return { x: x0, y: y0, w: Math.max(...list.map((b) => b.x + b.w)) - x0, h: Math.max(...list.map((b) => b.y + b.h)) - y0 };
}
/** 横着的大括号（under 在下面开口朝上、尖朝下；over 反过来）：{ d, tip } */
function hBrace(b, down) {
  const y = down ? b.y + b.h + 4 : b.y - 4, s = down ? 1 : -1, x0 = b.x, x1 = b.x + b.w, m = (x0 + x1) / 2, q = 7;
  const d = `M${r1(x0)} ${r1(y)} Q${r1(x0)} ${r1(y + s * q)} ${r1(x0 + q)} ${r1(y + s * q)} L${r1(m - q)} ${r1(y + s * q)} Q${r1(m)} ${r1(y + s * q)} ${r1(m)} ${r1(y + s * 2 * q)} Q${r1(m)} ${r1(y + s * q)} ${r1(m + q)} ${r1(y + s * q)} L${r1(x1 - q)} ${r1(y + s * q)} Q${r1(x1)} ${r1(y + s * q)} ${r1(x1)} ${r1(y)}`;
  return { d, tip: { x: m, y: y + s * 2 * q } };
}

/**
 * 一笔画成什么：{ strokes: [d], texts: [{ x, y, text, anchor }], markup, box（svg 画在哪个框里）, bbox }，都是世界坐标。
 * boxOf(ref)：部件现在在画面上的框（世界坐标，scale 过的照放大的）；grid、s：格子换成世界坐标（画布像素 ÷ 镜头倍数）
 */
export function drawGeometry(spec, boxOf, { grid, s = 1 }) {
  const out = { strokes: [], texts: [], markup: '', box: null, bbox: null };
  const seed = `draw:${spec.name}`;
  const cellBox = (at) => { const b = fromCells(at, grid); return { x: b.x / s, y: b.y / s, w: b.w / s, h: b.h / s }; };
  if (spec.kind === 'arrow') {
    const A = boxOf(spec.from), B = boxOf(spec.to);
    if (!A || !B) return out;
    out.strokes.push(arrowPath(A, B, seed));
    out.bbox = bboxOf([A, B]);
    return out;
  }
  if (spec.kind === 'text' || spec.kind === 'svg') {
    const b = cellBox(spec.at);
    out.bbox = b;
    if (spec.kind === 'text') out.texts.push({ x: b.x, y: b.y + Math.min(b.h, 28) * 0.8, text: spec.text, anchor: 'start' });
    else { out.box = b; out.markup = sketchMarkup(parseSketch(spec.svg).items); }
    return out;
  }
  const target = boxOf(spec.on || spec.under || spec.over);
  if (!target) return out;
  if (spec.kind === 'circle' || spec.kind === 'underline') {
    // 圈一小格（矩阵的一格、格子里的一个数）：格子的框比里面的字大一圈，照框圈会和隔壁那格的圈叠在一起、压着括号（r24）：
    // 圈中间那一块（字在那里），挨着的几格各圈各的
    const cell = spec.kind === 'circle' && target.w <= 90 && target.h <= 90;
    const t = cell ? (() => { const w = Math.max(24, target.w * 0.5), h = Math.max(24, target.h * 0.5); return { x: target.x + (target.w - w) / 2, y: target.y + (target.h - h) / 2, w, h }; })() : target;
    const sh = shapeFor(spec.kind, cell ? { box: t, tight: true, room: { top: 6, bottom: 6, left: 6, right: 6 } } : { box: t }, seed);
    out.strokes.push(...sh.strokes);
    out.bbox = sh.bbox || target;
  } else if (spec.kind === 'box') {
    const b = { x: target.x - PAD, y: target.y - PAD, w: target.w + 2 * PAD, h: target.h + 2 * PAD };
    out.strokes.push(`M${r1(b.x + 6)} ${r1(b.y)} H${r1(b.x + b.w - 6)} Q${r1(b.x + b.w)} ${r1(b.y)} ${r1(b.x + b.w)} ${r1(b.y + 6)} V${r1(b.y + b.h - 6)} Q${r1(b.x + b.w)} ${r1(b.y + b.h)} ${r1(b.x + b.w - 6)} ${r1(b.y + b.h)} H${r1(b.x + 6)} Q${r1(b.x)} ${r1(b.y + b.h)} ${r1(b.x)} ${r1(b.y + b.h - 6)} V${r1(b.y + 6)} Q${r1(b.x)} ${r1(b.y)} ${r1(b.x + 6)} ${r1(b.y)} Z`);
    out.bbox = b;
  } else if (spec.kind === 'brace') {
    const br = hBrace(target, !!spec.under);
    out.strokes.push(br.d);
    if (spec.text) out.texts.push({ x: br.tip.x, y: spec.under ? br.tip.y + 20 : br.tip.y - 6, text: spec.text, anchor: 'middle' });
    out.bbox = spec.under ? { x: target.x, y: target.y, w: target.w, h: target.h + 46 } : { x: target.x, y: target.y - 46, w: target.w, h: target.h + 46 };
  }
  return out;
}
