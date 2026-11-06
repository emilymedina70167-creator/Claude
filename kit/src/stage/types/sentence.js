// 舞台上的一句英文（考研英语一的长难句，照田静《句句真研》的讲法：先找谓语，再分主干、从句、非谓语、插入语，最后按意群断开）：
// 数据和指令，不碰 DOM（画法在 sentence.view.js）。纯函数，有测试（tests/stage-sentence.test.js）。
//
// 词一个一个排开，标点贴着前一个词，长了自动折行。舞台上的「句子」能做的：
//   mark  一段词下面一道括号、括号下写成分（套着的从句一层一层往下排，不打架）
//   tag   词上面一个小标签（S / V / O、谓语1）
//   fold  一段折成一个小方块，只留主干（其余的词滑过去补位）；unfold 展开
//   move  一个词 / 一段挪到别处（讲倒装、还原语序），别的词让开
//   cut   两个词之间一道斜线（意群断句）
//   refer 箭头：which / it 指的是谁
//   rewrite 改写整句：同样的词滑到新位置，新的淡进来（「从句 → 非谓语」「倒装 → 正常语序」）
// 部件：s.3 现在第 3 个词、s.2-5 第 2 到 5 个、s.who 这个词（出现几次时 s.who:2）、s.who-door 从 who 到 door、
//      s#3 一开始第 3 个的那个词（挪了、改写了跟着它走）
import { bbox } from '../layout.js';

export const MAX_WORDS = 60;
export const WRAP = 800; // 一行最宽（世界坐标的像素；镜头再缩放到屏幕上）
export const FONT = 27; // 词的字号
export const WORD_H = 46; // 一个词的高（≥ 44，手指点得到）
export const PAD = 6; // 词的左右留白（染色、点亮时底色的边）
export const MIN_W = 28; // 一个词最窄（画面再往两边多给 8px 让手指点：a、I 也有 44px）
export const GAP = 4; // 两个词的框之间
export const TAG_ROOM = 28; // 每一行上面留给小标签的
export const BR_TOP = 9; // 第一层括号的横线离词多远
export const LEVEL_H = 30; // 括号一层多高（横线 + 下面的字）
export const LINE_GAP = 14; // 两行之间
export const CUT_W = 24; // 断开的斜线占多宽
export const PILL_H = 36; // 折起来的小方块多高
export const LIFT = 8;

const COLORS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
const isColor = (w) => COLORS.includes(w);

// —— 字多宽：浏览器里画面一开始就换成真的量法（canvas 量字，和画出来的一样宽）；node 里按常见无衬线体的字宽估 ——
export const FONTS = { word: { size: FONT, weight: 500 }, tag: { size: 14, weight: 700 }, mark: { size: 14, weight: 600 }, pill: { size: 16, weight: 500 } };
let measure = null, measureRev = 0;
/** 换一个量字的办法：fn(text, kind) → 像素宽（kind 是 FONTS 的键）；给 null 回到估的 */
export function setMeasure(fn) { measure = fn; measureRev++; }
// 每个字母的宽（千分之一个字号；Helvetica 一类的无衬线体）
const ADV = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333, '{': 334, '|': 260, '}': 334, '~': 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556,
  o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '’': 222, '‘': 222, '“': 333, '”': 333, '—': 1000, '–': 556, '…': 1000,
};
export function textWidth(text, kind = 'word') {
  const s = String(text ?? '');
  if (measure) { const w = measure(s, kind); if (w > 0) return w; }
  const f = FONTS[kind] || FONTS.word;
  let u = 0;
  for (const ch of s) u += ADV[ch] ?? (/[0-9]/.test(ch) ? 556 : /[　-鿿＀-￯]/.test(ch) ? 1000 : 600);
  return (u / 1000) * f.size * (f.weight >= 600 ? 1.06 : 1.03);
}

// —— 切词：词（缩写、连字符、所有格算一个，U.S. 算一个）和标点；标点贴着前一个词，开引号、开括号贴着后一个词 ——
const TOKEN = /(?:\p{L}\.){2,}|[\p{L}\p{N}]+(?:['’][\p{L}]+)*(?:-[\p{L}\p{N}]+(?:['’][\p{L}]+)*)*|\S/gu;
const OPEN = /^[([{“‘¿¡$]$/;
const FINAL = /[.?!…]/;
/** 一句英文 → { words: [{ value, lead, punct }], end（句末的标点，跟着排在最后的那个词） } */
export function splitSentence(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  const words = [];
  let lead = '';
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(s))) {
    const t = m[0];
    if (/[\p{L}\p{N}]/u.test(t)) { words.push({ value: t, lead, punct: '' }); lead = ''; continue; }
    // 直引号：前面是空格（或开头）就是开引号
    const opens = OPEN.test(t) || ((t === '"' || t === "'") && (m.index === 0 || s[m.index - 1] === ' '));
    if (opens || !words.length) lead += t;
    else words[words.length - 1].punct += t;
  }
  let end = '';
  const last = words[words.length - 1];
  if (last && FINAL.test(last.punct)) { end = last.punct; last.punct = ''; }
  return { words, end };
}
/** 标点画出来的样子：破折号前面空一格（后面的空由排版留） */
export const shownPunct = (p) => String(p ?? '').replace(/\s*([—–])\s*/g, ' $1').replace(/^ ([—–])(.)/, ' $1 $2');
const norm = (w) => String(w ?? '').toLowerCase().replace(/’/g, "'");

// —— 成分 → 颜色（老师可以自己写 g1～g6）：按句子里的作用分，从句跟着它作什么成分走——
// 主语（主语从句）蓝、谓语粉、宾语表语补语（宾语从句、表语从句）绿、定语同位语（定语从句、同位语从句）紫、状语（状语从句）金、非谓语橙；插入语这类不染
export function roleColor(label) {
  const s = String(label ?? '').trim();
  if (/非谓语|分词|不定式|动名词|^NF\d*$|^to do$|^doing$|^done$/i.test(s)) return 'g6';
  if (/谓语|^V\d*$/.test(s)) return 'g2';
  if (/主语|^S\d*$|^SC\d*$/.test(s)) return 'g1';
  if (/宾语|表语|补语|^(O|IO|DO|P|C|OC|ObC|PC)\d*$/.test(s)) return 'g3';
  if (/定语|同位语|^(RC|Attr|App|AppC)\d*$/.test(s)) return 'g5';
  if (/状语|介词|^(A|Adv|AdvC|PP)\d*$/.test(s)) return 'g4';
  if (/从句|^(NC|AC|Cl)\d*$/.test(s)) return 'g5';
  return null;
}

// —— 排版：词排成几行（折起来的一段是一个小方块），算出每个词、括号、标签、斜线、箭头在哪。纯函数 ——
/**
 * 返回 { items, lines, boxes: Map(词的 key → 框), pills: Map(折起来的 id → 框), brackets, marks（括号下的字）, tags, cuts, refers, box }。
 * 括号：同一段里套着的（短的在里层）、互相交叉的，各占一层，一层一层往下排；括号下的字不和同一层的挤在一起
 */
// 画面一次 sync 要问几十遍每个词在哪：同一个样子只排一次（检查一行时的副本是新对象，自己再排）
const laid = new WeakMap();
export function layout(o) {
  const sig = JSON.stringify([o.origin, o.width, o.end, o.words, o.marks, o.tags, o.folds, o.cuts, o.refers, measureRev]);
  const hit = laid.get(o);
  if (hit?.sig === sig) return hit.lay;
  const lay = place(o);
  laid.set(o, { sig, lay });
  return lay;
}
function place(o) {
  const ox = o.origin?.x ?? 0, oy = o.origin?.y ?? 0;
  const words = [...o.words].sort((a, b) => a.slot - b.slot);
  const foldOf = new Map();
  for (const f of o.folds || []) for (const k of f.keys) foldOf.set(k, f);
  // 1. 一个个排的东西：词，或者折起来的一段
  const items = [];
  const itemOf = new Map();
  for (const w of words) {
    const f = foldOf.get(w.key);
    const last = items[items.length - 1];
    if (f && last?.fold === f) { last.keys.push(w.key); itemOf.set(w.key, items.length - 1); continue; }
    items.push(f ? { fold: f, keys: [w.key] } : { word: w, keys: [w.key] });
    itemOf.set(w.key, items.length - 1);
  }
  // 2. 每一样多宽（句末的标点跟着最后一样）
  items.forEach((it, i) => {
    const end = i === items.length - 1 ? o.end || '' : '';
    if (it.word) {
      it.lead = it.word.lead || '';
      it.punct = (it.word.punct || '') + end;
      it.leadW = it.lead ? textWidth(it.lead) : 0;
      it.punctW = it.punct ? textWidth(shownPunct(it.punct)) : 0;
      it.padL = it.lead ? 1 : PAD;
      it.padR = it.punct ? 1 : PAD;
      it.boxW = Math.max(MIN_W, Math.ceil(it.padL + textWidth(it.word.value) + it.padR + 1));
      it.h = WORD_H;
    } else {
      it.label = it.fold.label || '……';
      it.lead = '';
      it.punct = end;
      it.leadW = 0;
      it.punctW = end ? textWidth(end) : 0;
      it.padL = it.padR = 0;
      it.boxW = Math.round(textWidth(it.label, 'pill') + 30);
      it.h = PILL_H;
    }
    it.w = it.leadW + it.boxW + it.punctW;
  });
  // 断开的地方：在哪一样的后面（折起来的那一段只认最后一个词后面；最后一样后面不断）
  const cutAfter = new Set();
  for (const k of o.cuts || []) {
    const i = itemOf.get(k);
    if (i == null || i === items.length - 1) continue;
    if (items[i].fold && items[i].keys.at(-1) !== k) continue;
    cutAfter.add(i);
  }
  // 3. 折行：放不下就换一行
  const width = o.width || WRAP;
  const lines = [];
  let line = null, x = 0;
  items.forEach((it, i) => {
    if (!line || (x > 0 && x + it.w > width)) { line = { items: [], levels: 0, arcRoom: 0 }; lines.push(line); x = 0; }
    it.x = x;
    it.line = lines.length - 1;
    line.items.push(i);
    it.after = GAP + (it.punct ? PAD : 0) + (cutAfter.has(i) ? CUT_W : 0);
    line.w = x + it.w;
    x += it.w + it.after;
  });
  const runsOf = (keys) => {
    const idx = [...new Set(keys.map((k) => itemOf.get(k)).filter((v) => v != null))].sort((a, b) => a - b);
    const runs = [];
    for (const i of idx) { const r = runs[runs.length - 1]; if (r && r[1] === i - 1) r[1] = i; else runs.push([i, i]); }
    return runs;
  };
  const inOneFold = (keys) => keys.length && keys.every((k) => foldOf.get(k) && foldOf.get(k) === foldOf.get(keys[0]));
  // 4. 括号分层：短的先排；套在里面的（含一样长的）在里层；同一层交叉的往外挪一层
  const brs = [];
  for (const m of o.marks || []) {
    if (inOneFold(m.keys)) continue; // 整段折起来了：小方块就代表它
    for (const [a, b] of runsOf(m.keys)) brs.push({ mark: m, a, b });
  }
  brs.sort((p, q) => (p.b - p.a) - (q.b - q.a) || p.a - q.a);
  const placed = [];
  for (const br of brs) {
    let lv = 1 + Math.max(0, ...placed.filter((q) => q.a >= br.a && q.b <= br.b).map((q) => q.level));
    while (placed.some((q) => q.level === lv && q.a <= br.b && br.a <= q.b)) lv++;
    br.level = lv;
    placed.push(br);
  }
  // 每一行只数这一行上有的几层（外层的括号跨到下一行，下一行里面没有内层时就贴着词画，不空出几层）
  const lineLevels = lines.map(() => new Set());
  for (const br of brs) for (let i = br.a; i <= br.b; i++) lineLevels[items[i].line].add(br.level);
  const depthOf = lineLevels.map((set) => { const m = new Map(); [...set].sort((a, b) => a - b).forEach((lv, k) => m.set(lv, k + 1)); return m; });
  lines.forEach((L, i) => { L.levels = lineLevels[i].size; });
  // 5. 竖着排：每一行上面留标签（和箭头）的地方，下面按括号有几层留地方
  const tagged = new Set();
  for (const t of o.tags || []) if (!inOneFold(t.keys)) for (const [a] of runsOf(t.keys)) tagged.add(a);
  // 指代：同一行拱一道箭头；不在同一行时一道线要横穿好几层括号，改成在 which 头上写「→ people」
  const arcs = [], hops = [];
  for (const r of o.refers || []) {
    const A = itemOf.get(r.from), B = itemOf.get(r.to);
    if (A == null || B == null || A === B) continue;
    if (items[A].line !== items[B].line) { hops.push({ refer: r, A, B }); tagged.add(A); continue; }
    const dx = Math.abs(items[A].x - items[B].x);
    const h = Math.max(18, Math.min(40, 14 + dx * 0.09));
    const lift = (i) => (tagged.has(i) ? TAG_ROOM - 4 : 4);
    arcs.push({ refer: r, A, B, h, lift });
    const L = lines[items[A].line];
    L.arcRoom = Math.max(L.arcRoom, Math.max(lift(A), lift(B)) + h + 6);
  }
  let y = 0;
  for (const L of lines) {
    L.top = y;
    L.wordY = y + Math.max(TAG_ROOM, L.arcRoom);
    L.bottom = L.wordY + WORD_H + (L.levels ? BR_TOP + L.levels * LEVEL_H - 6 : 4);
    y = L.bottom + LINE_GAP;
  }
  // 6. 每一样的框
  const boxes = new Map(), pills = new Map();
  items.forEach((it) => {
    const L = lines[it.line];
    it.box = { x: ox + it.x + it.leadW, y: oy + L.wordY + (WORD_H - it.h) / 2, w: it.boxW, h: it.h };
    if (it.fold) pills.set(it.fold.id, it.box);
    for (const k of it.keys) boxes.set(k, it.box);
  });
  const wordBottom = (L) => oy + L.wordY + WORD_H;
  // 7. 括号：一段跨了几行就分几截（接着上一行的那头不画竖的那一小截）；字写在最长的那一截下面
  const brackets = [], markLabels = [];
  for (const br of brs) {
    const segs = [];
    for (let i = br.a; i <= br.b; i++) {
      const it = items[i];
      const s = segs[segs.length - 1];
      if (s && s.line === it.line) s.i1 = i; else segs.push({ line: it.line, i0: i, i1: i });
    }
    let best = null;
    segs.forEach((s, k) => {
      const L = lines[s.line];
      const x0 = items[s.i0].box.x, x1 = items[s.i1].box.x + items[s.i1].box.w;
      const depth = depthOf[s.line].get(br.level);
      const lineY = wordBottom(L) + BR_TOP + (depth - 1) * LEVEL_H;
      const top = wordBottom(L) + 3;
      const seg = { id: `${br.mark.id}:${br.a}:${k}`, mark: br.mark.id, color: br.mark.color, level: br.level, depth, line: s.line, x: x0, y: top, w: x1 - x0, h: lineY - top, openL: k > 0, openR: k < segs.length - 1 };
      brackets.push(seg);
      if (!best || seg.w > best.w + 0.5) best = seg;
    });
    const w = Math.round(textWidth(br.mark.label, 'mark') + 8), h = 18;
    markLabels.push({ id: `${br.mark.id}:${br.a}`, mark: br.mark.id, text: br.mark.label, color: br.mark.color, level: br.level, depth: best.depth, line: best.line, x: best.x + best.w / 2 - w / 2, y: best.y + best.h + 3, w, h, seg: best });
  }
  // 括号下的字：先挪进外面那层括号里面（不压着外层的竖线），再把同一层挤着的推开
  for (const l of markLabels) {
    const outer = brackets.filter((b) => b.line === l.line && b.depth > l.depth && b.x <= l.seg.x + 0.5 && b.x + b.w >= l.seg.x + l.seg.w - 0.5).sort((p, q) => p.depth - q.depth)[0];
    if (outer && outer.w - 12 >= l.w) l.x = Math.max(outer.x + 6, Math.min(outer.x + outer.w - 6 - l.w, l.x));
  }
  spread(markLabels, (l) => `${l.line}:${l.depth}`);
  // 8. 词上面的小标签：贴在那一段第一截的正上方
  const tags = [];
  for (const t of o.tags || []) {
    if (inOneFold(t.keys)) continue;
    const runs = runsOf(t.keys);
    if (!runs.length) continue;
    const [a, b0] = runs[0];
    let b = a;
    while (b < b0 && items[b + 1].line === items[a].line) b++;
    const x0 = items[a].box.x, x1 = items[b].box.x + items[b].box.w;
    const L = lines[items[a].line];
    const w = Math.round(textWidth(t.label, 'tag') + 12), h = 20;
    tags.push({ id: t.id, text: t.label, color: t.color, line: items[a].line, x: (x0 + x1) / 2 - w / 2, y: oy + L.wordY - h - 3, w, h });
  }
  for (const hp of hops) {
    const it = items[hp.A], L = lines[it.line];
    const to = items[hp.B];
    const text = `→ ${to.word ? to.word.value : to.label}`;
    const w = Math.round(textWidth(text, 'tag') + 12), h = 20;
    tags.push({ id: `ref:${hp.refer.from}`, text, color: hp.refer.color || null, refer: true, line: it.line, x: it.box.x + it.box.w / 2 - w / 2, y: oy + L.wordY - h - 3, w, h });
  }
  spread(tags, (t) => String(t.line));
  // 9. 断开：斜线在两个词的字中间
  const cuts = [];
  for (const i of cutAfter) {
    const it = items[i], nx = items[i + 1];
    const end = it.box.x + it.box.w - it.padR + it.punctW;
    const sameLine = nx && nx.line === it.line;
    const cx = sameLine ? (end + nx.box.x + nx.padL - nx.leadW) / 2 : end + it.after / 2;
    const L = lines[it.line];
    cuts.push({ key: it.keys.at(-1), x: cx - 9, y: oy + L.wordY + 3, w: 18, h: WORD_H - 6 });
  }
  // 10. 箭头：拱在两个词上面（在小标签的上面过去）
  const refers = arcs.map((a) => {
    const P = items[a.A].box, Q = items[a.B].box;
    const r1 = (v) => Math.round(v * 10) / 10;
    const p = { x: P.x + P.w / 2, y: P.y - a.lift(a.A) }, q = { x: Q.x + Q.w / 2, y: Q.y - a.lift(a.B) };
    const top = Math.min(p.y, q.y) - a.h;
    const d = `M${r1(p.x)} ${r1(p.y)} C${r1(p.x)} ${r1(top)} ${r1(q.x)} ${r1(top)} ${r1(q.x)} ${r1(q.y)}`;
    return { from: a.refer.from, to: a.refer.to, color: a.refer.color || null, d, tip: { x: q.x, y: q.y }, box: { x: Math.min(p.x, q.x), y: top + a.h * 0.25 - 2, w: Math.abs(p.x - q.x), h: Math.max(p.y, q.y) - top - a.h * 0.25 + 2 } };
  });
  const all = [...items.map((it) => ({ x: it.box.x - it.leadW, y: it.box.y, w: it.w, h: it.box.h })), ...brackets, ...markLabels, ...tags, ...cuts, ...refers.map((r) => r.box)];
  const box = bbox(all) || { x: ox, y: oy, w: 1, h: 1 };
  return { items, lines, boxes, pills, brackets, marks: markLabels, tags, cuts, refers, box };
}

// 同一组（同一行、同一层）的字挤着的推开：挤在一起的几个合成一串，这一串整体摆在它们想去的地方的正中
function spread(list, groupOf, gap = 6) {
  const groups = new Map();
  for (const l of list) { const k = groupOf(l); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  const place = (cl) => {
    let off = 0, sum = 0;
    for (const it of cl.items) { sum += it.want - off; off += it.w + gap; }
    cl.x = sum / cl.items.length;
    cl.w = off - gap;
  };
  for (const g of groups.values()) {
    g.sort((a, b) => a.x - b.x);
    const clusters = [];
    for (const l of g) {
      l.want = l.x;
      const cl = { items: [l] };
      place(cl);
      clusters.push(cl);
      while (clusters.length > 1) {
        const a = clusters[clusters.length - 2], b = clusters[clusters.length - 1];
        if (a.x + a.w + gap <= b.x) break;
        clusters.splice(-2, 2, { items: [...a.items, ...b.items] });
        place(clusters[clusters.length - 1]);
      }
    }
    for (const cl of clusters) { let x = cl.x; for (const it of cl.items) { it.x = Math.round(x); x += it.w + gap; delete it.want; } }
  }
}

// —— 部件的写法 ——
function ordered(o) { return [...o.words].sort((a, b) => a.slot - b.slot); }
/** s.3 / s.who / s.who:2 → 现在第几个（从 1 数）；写错了抛错 */
function posOf(o, t, word) {
  const ws = ordered(o);
  if (/^\d+$/.test(t)) {
    const k = Number(t);
    if (k >= 1 && k <= ws.length) return k;
    // 句子里本来就有这个数（in 2019）：超出词数时当成这个词
    const same = ws.filter((w) => w.value === t);
    if (same.length === 1) return same[0].slot;
    throw new Error(`${o.id} 只有 ${ws.length} 个词，没有第 ${k} 个`);
  }
  const m = t.match(/^(.+?)(?::(\d+))?$/);
  const w = norm(m[1]);
  const hits = ws.filter((x) => norm(x.value) === w);
  if (!hits.length) throw new Error(`「${word}」：${o.id} 里没有「${m[1]}」这个词${ws.length <= 30 ? `（句子是：${ws.map((x) => x.value).join(' ')}）` : ''}`);
  if (m[2]) {
    const x = hits[Number(m[2]) - 1];
    if (!x) throw new Error(`「${m[1]}」在 ${o.id} 里只出现了 ${hits.length} 次`);
    return x.slot;
  }
  if (hits.length > 1) throw new Error(`「${m[1]}」在 ${o.id} 里出现了 ${hits.length} 次（第 ${hits.map((x) => x.slot).join('、')} 个词）：写 ${o.id}.${m[1]}:2 或 ${o.id}.${hits[1].slot}`);
  return hits[0].slot;
}
/** 部件的写法 → [从第几个, 到第几个]（现在的位置） */
function rangeOf(o, sel, word) {
  const n = /^(\d+)-(\d+)$/.exec(sel);
  if (n) {
    const [lo, hi] = [Number(n[1]), Number(n[2])].sort((a, b) => a - b);
    posOf(o, String(lo), word); posOf(o, String(hi), word);
    return [lo, hi];
  }
  if (!sel.includes('-')) { const p = posOf(o, sel, word); return [p, p]; }
  // well-known 这种带连字符的词先当一个词找；找不到再当「从哪个到哪个」
  try { const p = posOf(o, sel, word); return [p, p]; } catch (e0) {
    let err = e0;
    for (let i = sel.indexOf('-'); i > 0; i = sel.indexOf('-', i + 1)) {
      try {
        const a = posOf(o, sel.slice(0, i), word), b = posOf(o, sel.slice(i + 1), word);
        return [Math.min(a, b), Math.max(a, b)];
      } catch (e) { err = e; }
    }
    throw err;
  }
}

// —— 指令里常用的 ——
const ROOM_WORDS = new Set(['before', 'after']);
/** 这一行指着的句子和词：{ o, parts（按现在的顺序）, whole（写的是整句 s） } */
function target(h, cmd, { need = true } = {}) {
  const refs = h.refsIn().filter((w) => h.scene.objects.get(w.match(/^[A-Za-z_]\w*/)[0])?.type === 'sentence');
  if (!refs.length) {
    h.strayRefs(h.args, [...ROOM_WORDS]);
    if (!need) return null;
    throw new Error(`${cmd} 要写对哪一句的哪几个词做，比如 ${cmd} s.3-6`);
  }
  const nameOf = (r) => r.match(/^[A-Za-z_]\w*/)[0];
  const id = nameOf(refs[0]);
  if (refs.some((r) => nameOf(r) !== id)) throw new Error(`${cmd} 的词要在同一句里`);
  h.strayRefs(h.args, [...ROOM_WORDS]);
  const o = h.scene.objects.get(id);
  const whole = refs.some((r) => r === id);
  const seen = new Set();
  const parts = [];
  for (const r of refs) for (const p of h.scene.parts(r)) if (!seen.has(p.key)) { seen.add(p.key); parts.push(p); }
  parts.sort((a, b) => a.slot - b.slot);
  return { o, parts, whole, refs };
}
const restText = (h, refs) => h.str ?? h.words.filter((w) => !refs.includes(w) && !isColor(w)).join(' ');
const contiguous = (parts) => parts.every((p, i) => !i || p.slot === parts[i - 1].slot + 1);
const sameKeys = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
const foldOfKey = (o, k) => o.folds.find((f) => f.keys.includes(k));
/** 一组词按现在的位置写成 s.2-5、s.3 s.7 */
export function spanText(o, keys) {
  const slots = keys.map((k) => o.words.find((w) => w.key === k)?.slot).filter((v) => v != null).sort((a, b) => a - b);
  const runs = [];
  for (const s of slots) { const r = runs[runs.length - 1]; if (r && r[1] === s - 1) r[1] = s; else runs.push([s, s]); }
  return runs.map(([a, b]) => (a === b ? `${o.id}.${a}` : `${o.id}.${a}-${b}`)).join(' ');
}
/** 整句话照现在的顺序连起来（折起来的写成「……」） */
export function sentenceText(o, { folds = false } = {}) {
  const out = [];
  let lastFold = null;
  for (const w of ordered(o)) {
    const f = folds ? foldOfKey(o, w.key) : null;
    if (f) { if (f !== lastFold) out.push(`［${f.label || '……'}］`); lastFold = f; continue; }
    lastFold = null;
    out.push(`${w.lead || ''}${w.value}${shownPunct(w.punct)}`);
  }
  return `${out.join(' ')}${o.end || ''}`;
}

// —— 改写：新句子里的词和原来的词配对（同一个词，不管大小写；同样的词按先后配；剩下的前几个字母一样的也算同一个，比如 realize → realized）——
export function matchWords(oldWords, newWords) {
  const pairs = new Array(newWords.length).fill(null);
  const used = new Set();
  const byText = new Map();
  oldWords.forEach((w, i) => { const k = norm(w.value); if (!byText.has(k)) byText.set(k, []); byText.get(k).push(i); });
  newWords.forEach((w, j) => {
    const list = byText.get(norm(w.value));
    const i = list?.find((x) => !used.has(x));
    if (i != null) { pairs[j] = i; used.add(i); }
  });
  const stem = (a, b) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k >= 3 && k >= Math.min(a.length, b.length) / 2; };
  newWords.forEach((w, j) => {
    if (pairs[j] != null) return;
    let best = null, bd = Infinity;
    oldWords.forEach((o, i) => {
      if (used.has(i) || !stem(norm(o.value), norm(w.value))) return;
      const d = Math.abs(i / Math.max(1, oldWords.length) - j / Math.max(1, newWords.length));
      if (d < bd) { bd = d; best = i; }
    });
    if (best != null) { pairs[j] = best; used.add(best); }
  });
  return pairs; // 新的第 j 个词 → 原来的第几个（null 是新的）
}
/** 最长的一串保持原来先后的（剩下的就是「挪了位置」的，画面让它们走弧线） */
function keepOrder(seq) {
  const n = seq.length;
  const len = new Array(n).fill(1), prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (seq[j] < seq[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
  let best = -1;
  for (let i = 0; i < n; i++) if (best < 0 || len[i] > len[best]) best = i;
  const keep = new Set();
  for (let i = best; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

export const sentence = {
  type: 'sentence',
  label: '句子',
  create: ['sentence'],
  drag: true,
  hint: '（句子：名字.3 现在第 3 个词，名字.2-5 第 2 到 5 个，名字.who 这个词（出现几次写 名字.who:2），名字.who-door 从 who 到 door；括号里的 #k 是「一开始第 k 个的那个词」，写 名字#k 跟着它走）',
  make(scene, c, h, old) {
    if (!h.args.some((a) => a.t === 'eq') || h.str == null) throw new Error('要写成 sentence 名字 = "英文句子"');
    const { words, end } = splitSentence(h.str);
    if (!words.length) throw new Error('sentence 的引号里要有英文词');
    if (words.length > MAX_WORDS) throw new Error(`一句最多 ${MAX_WORDS} 个词（写了 ${words.length} 个）；太长就拆成两句`);
    const id = h.words[0];
    const o = {
      width: WRAP, end, marks: [], tags: [], folds: [], cuts: [], refers: [], seq: 1, nextKey: words.length + 1,
      words: words.map((w, i) => ({ obj: id, key: i + 1, slot: i + 1, value: w.value, lead: w.lead, punct: w.punct, paint: null, glow: false, lift: false, dim: false, covered: false })),
    };
    o.origin = old ? { ...old.origin } : scene.slotFor(layout({ ...o, origin: { x: 0, y: 0 } }).box.w);
    return o;
  },
  parts(o) { return ordered(o); },
  pick(o, mark, sel, word) {
    if (mark === '#') {
      const m = /^(\d+)(?:-(\d+))?$/.exec(sel);
      if (!m) throw new Error(`「${word}」：# 后面写数（${o.id}#3 是一开始第 3 个的那个词）；指一个词写 ${o.id}.${sel}`);
      const [lo, hi] = [Number(m[1]), Number(m[2] ?? m[1])].sort((a, b) => a - b);
      const out = [];
      for (let k = lo; k <= hi; k++) {
        const w = o.words.find((x) => x.key === k);
        if (!w) throw new Error(`${o.id} 里没有${k < o.nextKey ? `一开始第 ${k} 个的那个词了（改写时去掉了）` : `#${k}（一开始只有 ${o.nextKey - 1} 个词）`}`);
        out.push(w);
      }
      return out.sort((a, b) => a.slot - b.slot);
    }
    const [lo, hi] = rangeOf(o, sel, word);
    return ordered(o).filter((w) => w.slot >= lo && w.slot <= hi);
  },
  ref(p) { return `${p.obj}#${p.key}`; },
  partBox(o, p) {
    const b = layout(o).boxes.get(p.key);
    if (!b) return { x: o.origin.x, y: o.origin.y, w: 1, h: 1 };
    return p.lift && !foldOfKey(o, p.key) ? { ...b, y: b.y - LIFT } : { ...b };
  },
  objectBox(o) { return layout(o).box; },
  obstacles(o) {
    const L = layout(o);
    return [
      ...L.items.map((it) => ({ x: it.box.x - it.leadW - 2, y: it.box.y, w: it.w + 4, h: it.box.h })),
      ...L.brackets, ...L.marks, ...L.tags, ...L.cuts, ...L.refers.map((r) => r.box),
    ];
  },
  commands: {
    // mark s.1-6 主语：这一段词下面一道括号，括号下写成分（同一段再标就换掉）
    mark(scene, c, h) {
      const { o, parts, refs } = target(h, 'mark');
      const label = restText(h, refs).trim();
      if (!label) throw new Error('mark 后面要写成分，比如 mark s.1-6 主语（或 mark s.3-6 "定语从句"）');
      if (label.length > 16) throw new Error('括号下的字要短（16 个字以内），长的解释用 say 说');
      const bad = h.words.find((w) => /^g\d+$/.test(w) && !isColor(w));
      if (bad) throw new Error('颜色只有 g1～g6');
      const color = h.words.find(isColor) || (isColor(h.opts.color) ? h.opts.color : null) || roleColor(label);
      const keys = parts.map((p) => p.key);
      const had = o.marks.find((m) => sameKeys(m.keys, keys));
      if (had) Object.assign(had, { label, color });
      else {
        if (o.marks.length >= 24) throw new Error('一句上最多 24 道括号，先 unmark 几道');
        o.marks.push({ id: `m${o.seq++}`, keys, label, color });
      }
      return { id: o.id, mark: had?.id || o.marks.at(-1).id };
    },
    // unmark s.1-6：收掉这一段的括号（没有正好这一段的，收掉在这一段里面的）；unmark s 主语：按成分收；unmark s：全收
    unmark(scene, c, h) {
      const { o, parts, whole, refs } = target(h, 'unmark');
      const label = restText(h, refs).trim();
      const keys = parts.map((p) => p.key);
      let gone;
      if (whole) gone = o.marks.filter((m) => !label || m.label === label);
      else {
        gone = o.marks.filter((m) => sameKeys(m.keys, keys) && (!label || m.label === label));
        if (!gone.length) gone = o.marks.filter((m) => m.keys.every((k) => keys.includes(k)) && (!label || m.label === label));
      }
      if (!gone.length) throw new Error(`${whole ? o.id : refs.join(' ')} 上没有${label ? `「${label}」的` : ''}括号${o.marks.length ? `（有的是：${o.marks.map((m) => `${spanText(o, m.keys)} ${m.label}`).join('；')}）` : ''}`);
      o.marks = o.marks.filter((m) => !gone.includes(m));
      return { id: o.id };
    },
    // tag s.7 V：词上面一个小标签（同一段再标就换掉）
    tag(scene, c, h) {
      const { o, parts, refs } = target(h, 'tag');
      const label = restText(h, refs).trim();
      if (!label) throw new Error('tag 后面要写标签，比如 tag s.7 V（或 tag s.7 谓语1）');
      if (label.length > 8) throw new Error('词上的标签要短（8 个字以内）');
      const color = h.words.find(isColor) || (isColor(h.opts.color) ? h.opts.color : null) || roleColor(label);
      const keys = parts.map((p) => p.key);
      const had = o.tags.find((t) => sameKeys(t.keys, keys));
      if (had) Object.assign(had, { label, color });
      else {
        if (o.tags.length >= 24) throw new Error('一句上最多 24 个标签，先 untag 几个');
        o.tags.push({ id: `t${o.seq++}`, keys, label, color });
      }
      return { id: o.id };
    },
    untag(scene, c, h) {
      const { o, parts, whole } = target(h, 'untag');
      const keys = new Set(parts.map((p) => p.key));
      const gone = whole ? o.tags : o.tags.filter((t) => t.keys.some((k) => keys.has(k)));
      if (!gone.length) throw new Error(`${o.id} 上${whole ? '' : '这几个词'}没有标签`);
      o.tags = o.tags.filter((t) => !gone.includes(t));
      return { id: o.id };
    },
    // fold s.3-6 "定语从句"：折成一个小方块（不写字就用这一段括号下的字，没有就是「……」）
    fold(scene, c, h) {
      const { o, parts, whole, refs } = target(h, 'fold');
      if (whole) throw new Error('fold 要写折哪一段，比如 fold s.3-6');
      if (!contiguous(parts)) throw new Error('fold 的词要连成一段');
      if (parts.length === o.words.length) throw new Error('整句都折起来就什么都看不见了：只折修饰的那一段');
      if (parts.some((p) => foldOfKey(o, p.key))) throw new Error(`${refs.join(' ')} 里有已经折起来的词：先 unfold`);
      const keys = parts.map((p) => p.key);
      const label = restText(h, refs).trim() || o.marks.find((m) => sameKeys(m.keys, keys))?.label || '';
      if (label.length > 12) throw new Error('小方块上的字要短（12 个字以内）');
      const color = o.marks.find((m) => sameKeys(m.keys, keys))?.color ?? roleColor(label);
      const f = { id: `f${o.seq++}`, keys, label, color };
      o.folds.push(f);
      return { id: o.id, fold: f.id, keys };
    },
    // unfold s.3：展开含这个词的那一段；unfold s：全展开
    unfold(scene, c, h) {
      const { o, parts, whole } = target(h, 'unfold');
      const keys = new Set(parts.map((p) => p.key));
      const gone = whole ? o.folds : o.folds.filter((f) => f.keys.some((k) => keys.has(k)));
      if (!gone.length) throw new Error(`${o.id} 上${whole ? '' : '这几个词'}没有折起来的`);
      o.folds = o.folds.filter((f) => !gone.includes(f));
      return { id: o.id, keys: gone.flatMap((f) => f.keys), pills: gone.map((f) => f.id) };
    },
    // move s.3 after s.5 / move s.3-4 before s.1 / move s.6 -> s.1（挪到第 1 个）：别的词让开
    move(scene, c, h) {
      const { args } = h;
      const at = args.findIndex((a) => a.t === 'arrow' || (a.t === 'word' && ROOM_WORDS.has(a.v.toLowerCase())));
      if (at < 0) throw new Error('要写成 move s.3 after s.5（或 before s.1、-> s.1 挪到第 1 个）');
      const how = args[at].t === 'arrow' ? 'to' : args[at].v.toLowerCase();
      const src = target({ ...h, refsIn: () => h.refsIn(args.slice(0, at)) }, 'move');
      const dstRefs = h.refsIn(args.slice(at + 1));
      if (!dstRefs.length) throw new Error(`move 的${how === 'to' ? '箭头' : ` ${how} `}后面要写一个词，比如 move s.3 after s.5`);
      const { o, parts } = src;
      if (src.whole) throw new Error('move 要写挪哪几个词，不是整句');
      if (dstRefs.some((r) => !r.startsWith(`${o.id}.`) && !r.startsWith(`${o.id}#`))) throw new Error('只能挪到同一句里');
      if (!contiguous(parts)) throw new Error('一次挪的词要连成一段（不连着的分几行挪）');
      if (parts.some((p) => foldOfKey(o, p.key))) throw new Error('折起来的词不能挪：先 unfold');
      const moving = new Set(parts.map((p) => p.key));
      const order = ordered(o);
      const rest = order.filter((w) => !moving.has(w.key));
      const block = order.filter((w) => moving.has(w.key));
      let i;
      if (how === 'to') {
        const m = new RegExp(`^${o.id}\\.(\\d+)$`).exec(dstRefs[0]);
        if (!m) throw new Error(`-> 后面写第几个，比如 move s.6 -> ${o.id}.1；挪到某个词前后写 before / after`);
        const k = Number(m[1]);
        if (k > rest.length + 1) throw new Error(`挪 ${block.length} 个词，最远到第 ${rest.length + 1} 个`);
        i = k - 1;
      } else {
        const dest = h.scene.parts(dstRefs[0]);
        const w = how === 'before' ? dest[0] : dest[dest.length - 1];
        if (moving.has(w.key)) throw new Error('落点在要挪的那几个词里面');
        i = rest.indexOf(w) + (how === 'after' ? 1 : 0);
      }
      const f = foldOfKey(o, rest[i - 1]?.key);
      if (f && f === foldOfKey(o, rest[i]?.key)) throw new Error('不能挪进折起来的那一段：先 unfold');
      const next = [...rest.slice(0, i), ...block, ...rest.slice(i)];
      const before = new Map(order.map((w) => [w.key, w.slot]));
      next.forEach((w, k) => { w.slot = k + 1; });
      return { id: o.id, moved: block.map((w) => w.key), others: next.filter((w) => !moving.has(w.key) && w.slot !== before.get(w.key)).map((w) => w.key) };
    },
    // cut s.6：第 6 个词后面断开（写好几个就断好几处；一段写 s.3-6 就断在 6 后面）
    cut(scene, c, h) {
      const { o, refs } = target(h, 'cut');
      const n = o.words.length;
      const added = [];
      for (const r of refs) {
        if (r === o.id) throw new Error('cut 要写断在哪个词后面，比如 cut s.6');
        const ps = h.scene.parts(r);
        const w = ps[ps.length - 1];
        if (w.slot === n) throw new Error('最后一个词后面不用断');
        if (!o.cuts.includes(w.key)) { o.cuts.push(w.key); added.push(w.key); }
      }
      return { id: o.id, added };
    },
    uncut(scene, c, h) {
      const { o, parts, whole } = target(h, 'uncut');
      const keys = new Set(parts.map((p) => p.key));
      const gone = whole ? o.cuts : o.cuts.filter((k) => keys.has(k));
      if (!gone.length) throw new Error(`${o.id} 上${whole ? '' : '这几个词后面'}没有断开的地方`);
      o.cuts = o.cuts.filter((k) => !gone.includes(k));
      return { id: o.id };
    },
    // refer s.3 -> s.2：箭头（which / it / that 指的是谁）；unrefer s.3 / unrefer s
    refer(scene, c, h) {
      const { args, arrow } = h;
      if (arrow < 0) throw new Error('要写成 refer s.3 -> s.2（从 which 指到它说的那个词）');
      const a = target({ ...h, refsIn: () => h.refsIn(args.slice(0, arrow)) }, 'refer');
      const b = target({ ...h, refsIn: () => h.refsIn(args.slice(arrow + 1)) }, 'refer');
      if (a.o !== b.o) throw new Error('refer 的两头要在同一句里');
      if (a.whole || b.whole) throw new Error('refer 的两头各写一个词，比如 refer s.3 -> s.2');
      const from = a.parts[0].key, to = b.parts[b.parts.length - 1].key;
      if (from === to) throw new Error('refer 的两头是同一个词');
      const bad = h.words.find((w) => /^g\d+$/.test(w) && !isColor(w));
      if (bad) throw new Error('颜色只有 g1～g6');
      const color = h.words.find(isColor) || null;
      const o = a.o;
      o.refers = o.refers.filter((r) => r.from !== from);
      o.refers.push({ from, to, color });
      return { id: o.id, from, to };
    },
    unrefer(scene, c, h) {
      const { o, parts, whole } = target(h, 'unrefer');
      const keys = new Set(parts.map((p) => p.key));
      const gone = whole ? o.refers : o.refers.filter((r) => keys.has(r.from) || keys.has(r.to));
      if (!gone.length) throw new Error(`${o.id} 上${whole ? '' : '这几个词'}没有箭头`);
      o.refers = o.refers.filter((r) => !gone.includes(r));
      return { id: o.id };
    },
    // rewrite s "The man living next door is a doctor."：改写整句（同样的词滑过去，新的淡进来；括号、标签还连着的留着）
    rewrite(scene, c, h) {
      const { o, whole } = target(h, 'rewrite');
      if (!whole) throw new Error(`rewrite 写整句的名字：rewrite ${o.id} "改写以后的句子"`);
      if (h.str == null) throw new Error(`要写成 rewrite ${o.id} "改写以后的句子"`);
      const { words, end } = splitSentence(h.str);
      if (!words.length) throw new Error('rewrite 的引号里要有英文词');
      if (words.length > MAX_WORDS) throw new Error(`一句最多 ${MAX_WORDS} 个词`);
      const old = ordered(o);
      const pairs = matchWords(old, words);
      const next = words.map((w, j) => {
        const was = pairs[j] != null ? old[pairs[j]] : null;
        const base = was || { obj: o.id, key: o.nextKey++, paint: null, glow: false, lift: false, dim: false, covered: false };
        return { ...base, slot: j + 1, value: w.value, lead: w.lead, punct: w.punct, changed: !!was && was.value !== w.value };
      });
      const alive = new Set(next.map((w) => w.key));
      const removed = old.filter((w) => !alive.has(w.key)).map((w) => w.key);
      const kept = next.filter((w) => pairs[next.indexOf(w)] != null);
      const stay = keepOrder(kept.map((w) => old.findIndex((x) => x.key === w.key)));
      const moved = kept.filter((_, i) => !stay.has(i)).map((w) => w.key);
      const changed = next.filter((w) => w.changed).map((w) => w.key);
      next.forEach((w) => { delete w.changed; });
      o.words = next;
      o.end = end;
      // 括号、标签、折起来的：头尾两个词都还在、先后没反，就照新句子里头尾之间的词留着（中间换了的词也算进去）；
      // 断开、箭头：两头的词还在就留着
      const oldPos = new Map(old.map((w) => [w.key, w.slot]));
      const pos = new Map(next.map((w) => [w.key, w.slot]));
      const respan = (keys) => {
        const ks = [...keys].sort((a, b) => oldPos.get(a) - oldPos.get(b));
        const a = pos.get(ks[0]), b = pos.get(ks[ks.length - 1]);
        if (a == null || b == null || a > b) return null;
        return next.filter((w) => w.slot >= a && w.slot <= b).map((w) => w.key);
      };
      const keep = (list) => list.map((x) => { const keys = respan(x.keys); return keys ? { ...x, keys } : null; }).filter(Boolean);
      o.marks = keep(o.marks);
      o.tags = keep(o.tags);
      o.folds = keep(o.folds);
      o.cuts = o.cuts.filter((k) => alive.has(k) && pos.get(k) !== next.length);
      o.refers = o.refers.filter((r) => alive.has(r.from) && alive.has(r.to));
      return { id: o.id, removed, added: next.filter((w) => !old.some((x) => x.key === w.key)).map((w) => w.key), moved, changed };
    },
  },
  describe(o) {
    const L = layout(o);
    const tag = (w) => {
      const bits = [];
      if (w.key !== w.slot) bits.push(`#${w.key}`);
      if (w.paint) bits.push(COLOR_NAMES[w.paint]);
      if (w.glow) bits.push('亮');
      if (w.lift) bits.push('抬起');
      if (w.dim) bits.push('灰');
      if (w.covered) bits.push('扣着');
      return `${w.slot} ${w.value}${bits.length ? `（${bits.join('、')}）` : ''}`;
    };
    const lines = [`句子 ${o.id}（${o.words.length} 个词${L.lines.length > 1 ? `，排成 ${L.lines.length} 行` : ''}）：${sentenceText(o, { folds: true })}`];
    lines.push(`  词：${ordered(o).map(tag).join('  ')}`);
    const color = (c) => (c ? `，${COLOR_NAMES[c]}` : '');
    if (o.marks.length) {
      const lv = new Map(L.marks.map((m) => [m.mark, m.level]));
      lines.push(`  括号（词下面）：${o.marks.map((m) => `${spanText(o, m.keys)} ${m.label}${lv.get(m.id) > 1 ? `（第 ${lv.get(m.id)} 层${color(m.color)}）` : m.color ? `（${COLOR_NAMES[m.color]}）` : ''}`).join('；')}`);
    }
    if (o.tags.length) lines.push(`  标签（词上面）：${o.tags.map((t) => `${spanText(o, t.keys)} ${t.label}`).join('；')}`);
    if (o.folds.length) lines.push(`  折起来的：${o.folds.map((f) => `${spanText(o, f.keys)} →「${f.label || '……'}」`).join('；')}`);
    if (o.cuts.length) lines.push(`  断开：${[...o.cuts].map((k) => o.words.find((w) => w.key === k)).sort((a, b) => a.slot - b.slot).map((w) => `${o.id}.${w.slot} ${w.value} 后面`).join('，')}`);
    if (o.refers.length) {
      const at = (k) => { const w = o.words.find((x) => x.key === k); return `${o.id}.${w.slot} ${w.value}`; };
      lines.push(`  箭头：${o.refers.map((r) => `${at(r.from)} → ${at(r.to)}`).join('，')}`);
    }
    return lines;
  },
  doc: `句子（英语长难句：先找谓语，再分主干、从句、非谓语、插入语，按意群断开）：
sentence s = "The man who lives next door is a doctor."      造一句（标点贴着前一个词，长了自动折行；句子里有 " 就用「」括起来）
写法：s.3 现在第 3 个词；s.2-5 第 2 到 5 个；s.who 这个词（出现几次写 s.that:2）；s.who-door 从 who 到 door；s#3 一开始第 3 个的那个词（挪了、改写了跟着走）
mark s.1-6 主语 / unmark s.1-6     词下面一道括号、下面写成分（套着的一层层往下排；颜色按成分，也能写 g1～g6）
tag s.7 V / untag s.7             词上面的小标签（S、V、谓语1）
fold s.3-6 / unfold s.3           折成一个小方块只留主干（别的词滑过去补位；方块上写这一段的成分，也能 fold s.3-6 "从句"）
move s.3 after s.5                挪到别处讲倒装、还原语序（也能 before s.1、-> s.1），别的词让开
cut s.6 / uncut s                 第 6 个词后面断开（意群的斜线）
refer s.3 -> s.2 / unrefer s.3    箭头：which、it 指的是谁
rewrite s "The man living next door is a doctor."    改写整句：同样的词滑到新位置，新的淡进来
ask drag s.7 "把 is 挪到句首"         学生按住一个词拖到别处（页面照做，再告诉你）`,
  example: `sentence s = "The man who lives next door is a doctor."
tag s.7 V
say "先找谓语：{s.7}。它前面一长串都是主语。"
mark s.1-6 主语
mark s.3-6 定语从句
refer s.3 -> s.2
fold s.3-6
ask tap s "折起来以后只剩主干。主语的核心词是哪个？" expect=s.2`,
};
