// 舞台上的题卡（把题拿上舞台）：题面、已知条件、一步步的提示，一行一个部件。数据和指令，不碰 DOM（画法在 card.view.js）。纯函数，有测试。
// 老师能对每一行做共用的事：点亮（读到这一句）、灰掉（这个条件用过了）、扣着（提示先不给看，到时候 uncover 翻开）；
// 学生答题用 ask value（页面当场判）或者在别的东西上点。话里的 {a.3}、$x$ 照样能写
import { parseRich } from '../script.js';

export const CARD_W = 560;
const PER_ROW = 30; // 一行大约几个字（18px 的字，560 宽减去两边的留白）
const ROW_H = 30, PAD = 14, GAP = 6;
const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };

/** 一行字大约占几行（中文一个字一份，英文、数字半份）；页面上量出来的会略有出入，镜头和贴字够用 */
export function rowsOf(text) {
  let n = 0;
  for (const p of parseRich(text)) n += p.k === 'ref' || p.k === 'measure' ? 2 : [...String(p.v)].reduce((k, ch) => k + (/[\u0000-\u00ff]/.test(ch) ? 0.5 : 1), 0);
  return Math.max(1, Math.ceil(n / PER_ROW));
}
// 一行多高：画面量过的（l.mh，card.view.js 写回：字折了几行只有画出来才知道）就用量的，没量过按字数估
export const lineH = (l) => l.mh ?? rowsOf(l.text) * ROW_H + 2 * 6;

function lineBox(o, l) {
  let y = o.origin.y + PAD;
  for (const x of o.lines) { if (x === l) break; y += lineH(x) + GAP; }
  return { x: o.origin.x + PAD, y, w: CARD_W - 2 * PAD, h: lineH(l) };
}
function objectBox(o) {
  const h = o.lines.reduce((n, l) => n + lineH(l) + GAP, 0) - GAP + 2 * PAD;
  return { x: o.origin.x, y: o.origin.y, w: CARD_W, h: Math.max(h, 2 * PAD + ROW_H) };
}
const LABEL_MAX = 20;
/**
 * 一行画出来的字（话里的小块写它的名字、$x$ 写 x），截到 20 个字：部件的 value / label。
 * [学生] 里「学生点了 f.3（laughing）」、话里的小块 {f.3} 都写它（以前写「第 3 行」，老师得回头数是哪一句）。
 * 一行全是空白（给了 key）：写「第 k 行」，不写成空的「（）」
 */
export function lineLabel(text, key = null) {
  const plain = parseRich(text).map((p) => p.v).join('').trim();
  if (!plain && key != null) return `第 ${key} 行`;
  const chars = [...plain];
  return chars.length > LABEL_MAX ? `${chars.slice(0, LABEL_MAX).join('')}…` : plain;
}
// coverLabel：扣着的时候小块写什么（scene.js 的 coverText）——扣着的一行常常是答案、提示，小块写了它的字就提前给学生看了
const mkLine = (obj, key, text) => ({ obj, key, text, value: lineLabel(text, key), label: lineLabel(text, key), coverLabel: `第 ${key} 行`, paint: null, glow: false, lift: false, dim: false, covered: false });

export const card = {
  type: 'card',
  label: '题卡',
  create: ['card'],
  // 认得的选项（名字=值，scene.js 的 checkOptions；造它的那一行另外都认 hide=）：写了不认得的当场报，不默默当没写
  options: { addline: ['covered'] },
  hint: '（题卡：名字.2 是第 2 行，扣着的行学生看不见，uncover 翻开）',
  make(scene, c, h, old) {
    const id = h.words[0];
    const texts = h.strs;
    if (!texts.length) throw new Error('要写成 card 名字 = "第一行" "第二行"……（每一行一对引号）');
    if (texts.length > 12) throw new Error('一张题卡最多 12 行');
    for (const t of texts) scene.checkRich(t, c); // 话里的 {a.3} 要真有，{count(t)} 的量名要对
    const origin = old ? { ...old.origin } : scene.slotFor(CARD_W);
    return { origin, lines: texts.map((t, i) => mkLine(id, i + 1, t)) };
  },
  parts(o) { return o.lines; },
  pick(o, mark, sel, word) {
    const m = String(sel).match(/^(\d+)(?:-(\d+))?$/);
    // q#2 也认：一排格子的 # 是第几格，老师顺手写成 # 的不少（第一节真课的 ask tap q#2 q#3 就是这样没演上）
    if ((mark !== '.' && mark !== '#') || !m) throw new Error(`「${word}」：题卡写 ${o.id}.2（第 2 行）或 ${o.id}.2-3`);
    const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
    const out = o.lines.filter((l) => l.key >= Math.min(lo, hi) && l.key <= Math.max(lo, hi));
    if (!out.length || out.length !== Math.abs(hi - lo) + 1) throw new Error(`${o.id} 只有 ${o.lines.length} 行`);
    return out;
  },
  ref(p) { return `${p.obj}.${p.key}`; },
  partBox: lineBox,
  objectBox,
  obstacles(o) { return [objectBox(o)]; },
  commands: {
    // addline q "提示：……"：题卡下面再加一行（推进到下一问、给一个提示）
    addline(scene, c, h) {
      const o = scene.objects.get(h.words[0]);
      if (!o || o.type !== 'card') throw new Error(`舞台上没有叫「${h.words[0]}」的题卡`);
      if (h.str == null) throw new Error('要写成 addline 名字 "这一行的字"');
      if (o.lines.length >= 12) throw new Error('一张题卡最多 12 行');
      scene.checkRich(h.str, c);
      const l = mkLine(o.id, o.lines.length + 1, h.str);
      if (h.opts.covered === 'on' || h.words.includes('covered')) l.covered = true;
      o.lines.push(l);
      return { line: l };
    },
    // rewrite q.2 "……"：改一行的字
    rewrite(scene, c, h) {
      const [l] = h.partsIn();
      if (!l || scene.objects.get(l.obj).type !== 'card') throw new Error('要写成 rewrite q.2 "新的字"');
      if (h.str == null) throw new Error('rewrite 要有新的字（写在引号里）');
      scene.checkRich(h.str, c, { replayRefs: false }); // 和造题卡一样查（以前不查 {a.3}，重放旧课时照旧不查）
      l.text = h.str;
      l.value = l.label = lineLabel(h.str, l.key);
      return { line: l };
    },
  },
  describe(o) {
    const tag = (l) => [l.paint && COLOR_NAMES[l.paint], l.glow && '亮', l.dim && '灰', l.covered && '扣着'].filter(Boolean);
    return [`题卡 ${o.id}（${o.lines.length} 行）：`, ...o.lines.map((l) => `  ${o.id}.${l.key}${tag(l).length ? `（${tag(l).join('、')}）` : ''}：${l.text}`)];
  },
  doc: `题卡（把题拿上舞台：题面、已知、一步步的提示）：
card q = "有序表 7 10 13 16 19 29 32 33 37 41 43，折半查找 33。" "第一次比较的是哪个数？" "提示：mid = ⌊(low + high) / 2⌋"
写法：q.2 第 2 行；q.2-3 第 2 到 3 行（一行一对引号，最多 12 行；话里的 {a.3} 照样能写；$x$ 只是斜体字母、不排公式，矩阵（pmatrix）、分式写不了：矩阵就造 matrix，公式用 tex）
cover q.3 / uncover q.3          提示先扣着，到时候翻开（共用的点亮、灰掉对每一行都有用）
addline q "第二次比较的是哪个数？"    下面再加一行（covered=on 加一行扣着的提示）
rewrite q.2 "……"                  改一行的字
ask value "第一次比较的是哪个数？" answer=29     学生填答案，页面当场判`,
  example: `card q = "有序表 7 10 13 16 19 29 32 33 37 41 43，折半查找 33。" "第一次比较的是哪个数？" "提示：mid = ⌊(low + high) / 2⌋"
cover q.3
glow q.2
ask value "第一次比较的是哪个数？" answer=29`,
};
