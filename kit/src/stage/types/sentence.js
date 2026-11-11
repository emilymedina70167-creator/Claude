// 舞台上的一句英文（考研英语一的长难句，照田静《句句真研》的讲法：先找谓语，再分主干、从句、非谓语、插入语，最后按意群断开）：
// 数据和指令，不碰 DOM（画法在 sentence.view.js）。纯函数，有测试（tests/stage-sentence.test.js）。
//
// 词一个一个排开，标点贴着前一个词，长了自动折行。舞台上的「句子」能做的：
//   mark  一段词下面一道括号、括号下写成分（套着的从句一层一层往下排，不打架）
//   tag   词上面一个小标签（S / V / O、谓语1）
//   fold  一段折成一个小方块，只留主干（其余的词滑过去补位）；unfold 展开
//   move  一个词 / 一段挪到别处（讲倒装、还原语序），别的词让开
//   cut   两个词之间一道斜线（意群断句）
//   refer 箭头：which / it 指的是谁（指一个词、一段、整句；links= 是老师给的答案，学生从钩上拉线时照它判）
//   rewrite 改写整句：同样的词滑到新位置，新的淡进来（「从句 → 非谓语」「倒装 → 正常语序」）
// 部件：s.3 现在第 3 个词、s.2-5 第 2 到 5 个、s.who 这个词（出现几次时 s.who:2）、s.who-door 从 who 到 door、
//      s#3 一开始第 3 个的那个词（挪了、改写了跟着它走）
// 正确拆法由老师给（页面不自己分析英语语法）：sentence s = "…" key="[S The man [RC who lives next door]] [V is] [P a doctor]."，
// 照黑板 parse 组件的括号写法（entext.js 的 parseBrackets）读成 o.key，判法在 sentence.rules.js
import { bbox } from '../layout.js';
import { parseBrackets, tokenizeSentence, ROLES } from '../../entext.js';
// 规则那边照 key 数的学生括号（舞台现状里写）。两个模块互相 import：都只在函数里用对方的东西，加载的先后不碍事
import { bracketFacts, tallyOf } from './sentence.rules.js';
import { splitPicks, hasPick, checkPick, fillPicks, pickDeps, pickNow, dialSteps, varText, VERB, verbFact } from '../pick.js';

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

// —— 成分名 → 成分（拆成分的判法用，sentence.rules.js；造句子读 key= 时也要查，所以和 roleColor 放在一起，认同一批写法）——
// 缩写照 entext.js 的 ROLES，外加 roleColor 认的 Adv、PP（状语）和 NC、AC、Cl（从句的泛称）；缩写分大小写（do、a 是英文词，不是成分）。
// 中文写完整的成分名；roleColor 按「含这几个字」认的（分词、不定式、动名词、谓语动词、时间状语、介词短语……）也认。
// 只写「从句」是泛称：对得上 key 里任何一种从句（sameRole）
export const CLAUSE_ROLES = ['定语从句', '主语从句', '宾语从句', '表语从句', '同位语从句', '状语从句'];
export const ROLE_NAMES = { ...ROLES, V: '谓语', S: '主语', O: '宾语', RC: '定语从句', Adv: '状语', PP: '状语', NC: '从句', AC: '从句', Cl: '从句' };
const ROLE_ZH = new Set([...Object.values(ROLES), '从句']);
// 含这几个字就认成这一种（先长后短：宾语补足语不是宾语，非谓语在前面先认掉了）
const ROLE_HAS = [[/宾补|宾语补足语/, '宾补'], [/补足语/, '补语'], [/谓语/, '谓语'], [/主语/, '主语'], [/间接宾语/, '间接宾语'], [/直接宾语/, '直接宾语'], [/宾语/, '宾语'],
  [/表语/, '表语'], [/补语/, '补语'], [/同位语/, '同位语'], [/定语/, '定语'], [/状语|介词/, '状语']];
/** 成分名 → 成分（「谓语1」「V2」编了号的去掉号）；认不出是 null */
export function roleName(label) {
  const s = String(label ?? '').trim().replace(/(\D)\d+$/, '$1');
  if (!s) return null;
  if (Object.hasOwn(ROLE_NAMES, s)) return ROLE_NAMES[s];
  if (/^(to do|doing|done)$/i.test(s) || /非谓语|分词|不定式|动名词/.test(s)) return '非谓语';
  const clause = CLAUSE_ROLES.find((c) => s.includes(c));
  if (clause) return clause;
  if (/从句/.test(s)) return '从句';
  if (ROLE_ZH.has(s)) return s;
  return ROLE_HAS.find(([re]) => re.test(s))?.[1] ?? null;
}
// 中文成分名 → 缩写（ROLES 倒过来，外加泛称「从句」）：舞台现状里括号写两种名字（s.2-6 定语（Attr）），老师认得出学生点的是哪一种
const ABBR = { ...Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [v, k])), 从句: 'Cl' };
/**
 * 成分名 → 缩写：「定语」→ Attr，「谓语1」→ V1；本来就是缩写的照老师写的（Adv 还是 Adv）；认不出的是 null。
 * 只给舞台现状的括号那一行用（括号上、事实里照括号上写的，一个名字）
 */
export function roleAbbr(label) {
  const s = String(label ?? '').trim();
  const base = s.replace(/(\D)\d+$/, '$1'), num = s.slice(base.length);
  if (Object.hasOwn(ROLE_NAMES, base)) return s;
  const name = roleName(s);
  return name && ABBR[name] ? `${ABBR[name]}${num}` : null;
}
/** 括号在舞台现状里的写法：中文（缩写），老师写缩写的也补上中文；认不出的照写 */
export function roleBoth(label) {
  const s = String(label ?? '').trim();
  const base = s.replace(/(\D)\d+$/, '$1'), num = s.slice(base.length);
  const abbr = roleAbbr(s);
  if (!abbr) return s;
  const zh = Object.hasOwn(ROLE_NAMES, base) ? `${ROLE_NAMES[base]}${num}` : s;
  return zh === abbr ? s : `${zh}（${abbr}）`;
}

/** 两个成分是不是一回事：一样，或者一边是泛称「从句」、另一边是某种从句 */
export function sameRole(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return (a === '从句' && CLAUSE_ROLES.includes(b)) || (b === '从句' && CLAUSE_ROLES.includes(a));
}

// —— 排版：词排成几行（折起来的一段是一个小方块），算出每个词、括号、标签、斜线、箭头在哪。纯函数 ——
/**
 * 返回 { items, lines, boxes: Map(词的 key → 框), pills: Map(折起来的 id → 框), brackets, marks（括号下的字）, tags, cuts, refers, box }。
 * 括号：同一段里套着的（短的在里层）、互相交叉的，各占一层，一层一层往下排；括号下的字不和同一层的挤在一起
 */
// 画面一次 sync 要问几十遍每个词在哪：同一个样子只排一次（检查一行时的副本是新对象，自己再排）
const laid = new WeakMap();
export function layout(o) {
  const sig = JSON.stringify([o.origin, o.width, o.end, o.words, o.marks, o.tags, o.folds, o.cuts, o.refers, o.tally, measureRev]);
  const hit = laid.get(o);
  if (hit?.sig === sig) return hit.lay;
  const lay = place(o);
  laid.set(o, { sig, lay });
  return lay;
}
function place(o) {
  const ox = o.origin?.x ?? 0, oy = o.origin?.y ?? 0;
  const words = [...o.words].sort((a, b) => a.slot - b.slot);
  // 套着折的：词在最外层的那个小方块里（里层的小方块等外层展开了才画）
  const foldOf = new Map();
  for (const f of outerFolds(o)) for (const k of f.keys) foldOf.set(k, f);
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
  // 指代：同一行拱一道箭头；不在同一行时一道线要横穿好几层括号，改成在 which 头上写「→ people」。
  // 指到一段的（toKeys）：那一段连着、和 which 在同一行就拱到那一段的正中，上面一道小横线标出是哪一段；不然也写「→ The books」。
  // 指到整句的（whole，主句）：写「→ 整句」
  const arcs = [], hops = [];
  for (const r of o.refers || []) {
    const A = itemOf.get(r.from);
    if (A == null) continue;
    if (r.whole) { hops.push({ refer: r, A, text: '→ 整句' }); tagged.add(A); continue; }
    if (r.toKeys) {
      const idx = [...new Set(r.toKeys.map((k) => itemOf.get(k)).filter((v) => v != null))].sort((p, q) => p - q);
      if (!idx.length) continue;
      const B0 = idx[0], B1 = idx[idx.length - 1];
      const flat = B1 - B0 + 1 === idx.length && idx.every((i) => items[i].line === items[A].line) && !idx.includes(A);
      if (!flat) { hops.push({ refer: r, A, text: `→ ${shortPhrase(o, r.toKeys)}` }); tagged.add(A); continue; }
      const dx = Math.abs(items[A].x - (items[B0].x + items[B1].x + items[B1].w) / 2);
      const h = Math.max(18, Math.min(40, 14 + dx * 0.09));
      const lift = (i) => (tagged.has(i) ? TAG_ROOM - 4 : 4);
      arcs.push({ refer: r, A, B: B0, B1, h, lift });
      const L = lines[items[A].line];
      L.arcRoom = Math.max(L.arcRoom, Math.max(lift(A), ...idx.map(lift)) + h + 6);
      continue;
    }
    const B = itemOf.get(r.to);
    if (B == null || A === B) continue;
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
  // 7. 括号：一段跨了几行就分几截（接着上一行的那头不画竖的那一小截）；字写在最长的那一截下面。
  // 被挪开拆散了的（brokenMarks；老师本来就拉成两截的不算）：每一截画成断开的虚线，成分字变淡、带「?」（画面不说「它还是谓语」）。
  // tally s V 开着：学生的每道括号的字后面带一个数（里面 key 的谓语几个），剩下的写在句尾（tallyOf，sentence.rules.js）
  const broken = new Set(brokenMarks(o).filter((id) => !o.marks.find((m) => m.id === id)?.apart));
  const tal = o.tally ? tallyOf(o) : null;
  const TALLY_W = 22;
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
      if (broken.has(br.mark.id)) seg.broken = true;
      brackets.push(seg);
      if (!best || seg.w > best.w + 0.5) best = seg;
    });
    const text = broken.has(br.mark.id) ? `${br.mark.label}?` : br.mark.label;
    const n = tal?.each.get(br.mark.id);
    const w = Math.round(textWidth(text, 'mark') + 8 + (n != null ? TALLY_W : 0)), h = 18;
    const lab = { id: `${br.mark.id}:${br.a}`, mark: br.mark.id, text, color: br.mark.color, level: br.level, depth: best.depth, line: best.line, x: best.x + best.w / 2 - w / 2, y: best.y + best.h + 3, w, h, seg: best };
    if (broken.has(br.mark.id)) lab.broken = true;
    if (n != null) lab.tally = n;
    markLabels.push(lab);
  }
  // 括号下的字：先挪进外面那层括号里面（不压着外层的竖线），再把同一层挤着的推开
  for (const l of markLabels) {
    const outer = brackets.filter((b) => b.line === l.line && b.depth > l.depth && b.x <= l.seg.x + 0.5 && b.x + b.w >= l.seg.x + l.seg.w - 0.5).sort((p, q) => p.depth - q.depth)[0];
    if (outer && outer.w - 12 >= l.w) l.x = Math.max(outer.x + 6, Math.min(outer.x + outer.w - 6 - l.w, l.x));
  }
  // 两道括号交叠（不是一道套一道：「完成」罩 have been、「进行」罩 been doing）：深一层那道的竖线正好从浅一层的字上穿过去。
  // 字在自己那道括号下面左右让一让，挑离正中最近、又不骑在竖线上的位置；让不开的照旧
  for (const l of markLabels) {
    const xs = [];
    for (const b of brackets) {
      if (b.line !== l.line || b.depth <= l.depth || b.mark === l.mark) continue;
      if (!b.openL) xs.push(b.x);
      if (!b.openR) xs.push(b.x + b.w);
    }
    const hit = (x) => xs.some((v) => v > x - 3 && v < x + l.w + 3);
    if (!xs.length || !hit(l.x)) continue;
    const lo = l.seg.x, hi = l.seg.x + l.seg.w - l.w;
    const spots = xs.flatMap((v) => [v + 5, v - 5 - l.w]).filter((x) => x >= lo - 0.5 && x <= hi + 0.5 && !hit(x));
    if (spots.length) l.x = spots.sort((p, q) => Math.abs(p - l.x) - Math.abs(q - l.x))[0];
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
    const text = hp.text ?? `→ ${to.word ? to.word.value : to.label}`;
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
  // 10. 箭头：拱在两个词上面（在小标签的上面过去）；指到一段的拱到那一段的正中，那一段上面一道两头翘下去的小横线（cap）
  const r1 = (v) => Math.round(v * 10) / 10;
  const refers = arcs.map((a) => {
    const P = items[a.A].box, Q = items[a.B].box;
    if (a.B1 != null) {
      const Q1 = items[a.B1].box;
      const run = [];
      for (let i = a.B; i <= a.B1; i++) run.push(i);
      const capY = Math.min(...run.map((i) => items[i].box.y - a.lift(i)));
      const x0 = Q.x + 4, x1 = Q1.x + Q1.w - 4;
      const p = { x: P.x + P.w / 2, y: P.y - a.lift(a.A) }, q = { x: (x0 + x1) / 2, y: capY };
      const top = Math.min(p.y, q.y) - a.h;
      const d = `M${r1(p.x)} ${r1(p.y)} C${r1(p.x)} ${r1(top)} ${r1(q.x)} ${r1(top)} ${r1(q.x)} ${r1(q.y)}`;
      const cap = `M${r1(x0)} ${r1(capY + 5)} L${r1(x0)} ${r1(capY)} L${r1(x1)} ${r1(capY)} L${r1(x1)} ${r1(capY + 5)}`;
      const bx = Math.min(p.x, x0), bw = Math.max(p.x, x1) - bx;
      return { from: a.refer.from, to: a.refer.to, toKeys: a.refer.toKeys, color: a.refer.color || null, d, cap, tip: { x: q.x, y: q.y }, box: { x: bx, y: top + a.h * 0.25 - 2, w: bw, h: Math.max(p.y, capY + 5) - top - a.h * 0.25 + 2 } };
    }
    const p = { x: P.x + P.w / 2, y: P.y - a.lift(a.A) }, q = { x: Q.x + Q.w / 2, y: Q.y - a.lift(a.B) };
    const top = Math.min(p.y, q.y) - a.h;
    const d = `M${r1(p.x)} ${r1(p.y)} C${r1(p.x)} ${r1(top)} ${r1(q.x)} ${r1(top)} ${r1(q.x)} ${r1(q.y)}`;
    return { from: a.refer.from, to: a.refer.to, color: a.refer.color || null, d, tip: { x: q.x, y: q.y }, box: { x: Math.min(p.x, q.x), y: top + a.h * 0.25 - 2, w: Math.abs(p.x - q.x), h: Math.max(p.y, q.y) - top - a.h * 0.25 + 2 } };
  });
  // 11. tally 剩下的（括号外的几个）：句尾，最后一样的后面
  const tallies = [];
  if (tal && items.length) {
    const it = items[items.length - 1], L = lines[it.line];
    const text = `括号外 ${tal.rest}`;
    const w = Math.round(textWidth(text, 'tag') + 14), h = 22;
    tallies.push({ id: 'tally:rest', text, x: it.box.x + it.box.w + it.punctW + 10, y: oy + L.wordY + (WORD_H - h) / 2, w, h, line: it.line });
  }
  const all = [...items.map((it) => ({ x: it.box.x - it.leadW, y: it.box.y, w: it.w, h: it.box.h })), ...brackets, ...markLabels, ...tags, ...cuts, ...refers.map((r) => r.box), ...tallies];
  const box = bbox(all) || { x: ox, y: oy, w: 1, h: 1 };
  return { items, lines, boxes, pills, brackets, marks: markLabels, tags, cuts, refers, tallies, box };
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
export function ordered(o) { return [...o.words].sort((a, b) => a.slot - b.slot); }
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
/** 一行里部件以外写的字（mark s.2-4 主语 的「主语」；sentence.rules.js 的 actOf 也用它） */
export const restText = (h, refs) => h.str ?? h.words.filter((w) => !refs.includes(w) && !isColor(w)).join(' ');
const contiguous = (parts) => parts.every((p, i) => !i || p.slot === parts[i - 1].slot + 1);
const sameKeys = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
/**
 * 看得见的那几段折起来的（套着折时只算最外层：里层留在外层的小方块里，展开外层才露出来）。
 * 折起来的段要么套着、要么不沾边（fold 不收交叉的），最外层的就是没被别的段整个包住的
 */
export function outerFolds(o) {
  const fs = o?.folds || [];
  return fs.filter((f) => !fs.some((g) => g !== f && g.keys.length > f.keys.length && f.keys.every((k) => g.keys.includes(k))));
}
/**
 * open s refer 的钩挂在哪几个词上（画面 sentence.view.js 照它画钩，舞台现状照它说学生能不能拉）：open 写了部件就那几个；
 * 没写看 links= 的起头（对的、列的错连都算）；再没有就每个词。折起来的词上不挂钩（看不见）。
 * 返回 { keys（挂得上钩的）, folded（老师点了名、现在折着的：open 写的或 links= 的起头）}。parts(ref) 是场景的 parts
 */
export function hookWords(o, e, parts) {
  let keys, named = true;
  if (e?.refs?.length) keys = e.refs.flatMap((r) => { try { return parts(r); } catch { return []; } }).filter((p) => p?.obj === o.id && p.key != null).map((p) => p.key);
  else {
    const from = new Set([...(o.links?.pairs || []), ...(o.links?.wrongs || [])].map((p) => String(p.from)));
    named = from.size > 0;
    keys = named ? o.words.filter((w) => from.has(String(w.key))).map((w) => w.key) : ordered(o).map((w) => w.key);
  }
  const all = new Set((o.folds || []).flatMap((f) => f.keys));
  const uniq = [...new Set(keys)];
  return { keys: uniq.filter((k) => !all.has(k)), folded: named ? uniq.filter((k) => all.has(k)) : [] };
}
/** 这个词在哪一段折起来的里面（套着的算最外层那一段：画面上它就在那个小方块里）；没折是 undefined */
const foldOfKey = (o, k) => outerFolds(o).find((f) => f.keys.includes(k));
/**
 * 要折的这几个词和已经折起来的冲不冲突（fold 指令和点括号折的手势共用，sentence.rules.js）：正好是折起来的那一段——已经折起来了；
 * 和一段交叉（一头在里面一头在外面）——小方块排不出来。套着的（里层折着折外层、外层折着折里层）都行。不冲突是 null
 */
export function foldClash(o, keys) {
  const set = new Set(keys);
  for (const f of o?.folds || []) {
    const inside = f.keys.filter((k) => set.has(k)).length;
    if (!inside) continue;
    if (inside === f.keys.length && inside === set.size) return `${spanText(o, keys)} 已经折起来了`;
    // 先展开哪一段：看得见的那一段写它的第一个词；套在里层的（unfold 一个词先展开外层）写 unfold 整句
    if (inside < f.keys.length && inside < set.size) return `${spanText(o, keys)} 和折起来的 ${spanText(o, f.keys)} 交叉：先 unfold ${outerFolds(o).includes(f) ? spanText(o, f.keys).split(/[-\s]/)[0] : o.id}`;
  }
  return null;
}
/** unrefer a -> b 正好指着的那一条线：{ o, r }；写法不是「一个词 -> 一个词 / 一段 / 整句」、或者没有正好这一条，是 null */
function exactRefer(h) {
  let a, b;
  try {
    a = target({ ...h, refsIn: () => h.refsIn(h.args.slice(0, h.arrow)) }, 'unrefer');
    b = target({ ...h, refsIn: () => h.refsIn(h.args.slice(h.arrow + 1)) }, 'unrefer');
  } catch { return null; }
  if (a.o !== b.o || a.whole || a.parts.length !== 1) return null;
  const from = a.parts[0].key;
  const whole = !!b.whole && b.refs.every((r) => r === b.o.id);
  const to = b.parts.map((p) => p.key);
  const r = a.o.refers.find((x) => x.from === from && (whole ? x.whole : !x.whole && sameKeys(x.toKeys || [x.to], to)));
  return r ? { o: a.o, r } : null;
}
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
/** 箭头指到的一段写在词头上（「→ The books」）：长了只写开头两个词 */
function shortPhrase(o, keys) {
  const ws = o.words.filter((w) => keys.includes(w.key)).sort((a, b) => a.slot - b.slot);
  return ws.length > 3 ? `${phraseOf(ws.slice(0, 2))} …` : phraseOf(ws);
}
const BRACKETS = [['(', ')'], ['[', ']'], ['{', '}']];
const countOf = (s, ch) => s.split(ch).length - 1;
/**
 * 一段词照原句写出来（中间的标点、所有格的撇号照原句：workers' productivity）；头上的开引号、尾巴上的逗号句号不带。
 * 括号要配成对：段头的开括号、段尾的关括号，段里有和它配对的（或者头尾正好一对，一个词「(that)」）就带上——
 * 以前一律不带，「(that) they would learn …」引成了「that) they would learn …」（第三次量 E2 第 5 幕）
 */
export function phraseOf(words) {
  const n = words.length;
  const text = words.map((w, i) => {
    const tail = i < n - 1 ? shownPunct(w.punct) : (String(w.punct ?? '').match(/^['’]+/)?.[0] ?? '');
    return `${i ? w.lead || '' : ''}${w.value}${tail}`;
  }).join(' ');
  if (!n) return text;
  const lead = String(words[0].lead ?? ''), last = String(words[n - 1].punct ?? '');
  let pre = '', post = '';
  for (const [a, b] of BRACKETS) {
    const open = countOf(text, a), close = countOf(text, b);
    let pa = Math.min(Math.max(0, close - open), countOf(lead, a));
    let pb = Math.min(Math.max(0, open + pa - close), countOf(last, b));
    // 头上、尾巴上各剩一个能配成一对的（整段就是括号里的话）：一起带上
    const pair = Math.min(countOf(lead, a) - pa, countOf(last, b) - pb);
    pa += pair; pb += pair;
    pre += a.repeat(pa);
    post += b.repeat(pb);
  }
  return `${pre}${text}${post}`;
}
// —— 跟着拨盘变的句子（主线第二轮 C）：sentence s = "I {t: was holding | am holding | will be holding} it steady." ——
// 句子的原文（模板）留在 o.picks.src；拨盘一变（scene.js 的 onVar → onPick），照现在那一段重排：模板里一段一段对着认
//（原文的那几段词一个对一个；{…} 那一段里一样的词留着、别的换掉），所以没变的词编号不变、学生拉的括号照 rewrite 的规矩留。
// rewrite 换了整句、move 改了先后以后不再跟（再照模板重排会把它们冲掉），现状里写明。

/**
 * 模板照现在的拨盘写成一句、切成词，每个词记着它是模板的第几段（seg）：{ words, end, segs, now（每个 {…} 现在写出来的字）}。
 * {…} 贴着别的字写（walk{t: ed | s}）切出来的词数对不上：抛错（要和别的词用空格隔开）
 */
export function templateWords(src, vars) {
  const parts = splitPicks(src);
  const texts = parts.map((p) => (p.k === 'pick' ? pickNow(p, vars) : p.v));
  const { words, end } = splitSentence(texts.join(''));
  const counts = texts.map((t) => splitSentence(t).words.length);
  if (counts.reduce((a, b) => a + b, 0) !== words.length) throw new Error('{名字: … | …} 要和别的词用空格隔开，一段里写整个词（I {t: walked | walk} home，不是 walk{t: ed | s}）');
  const segs = counts.flatMap((n, i) => new Array(n).fill(i));
  return { words, end, segs, now: parts.map((p, i) => (p.k === 'pick' ? { raw: p.raw, text: texts[i].trim() } : null)).filter(Boolean) };
}
// 两串词里最长的一串先后一样的（{…} 那一段换了以后，一样的词留着）：新的第 j 个 → 原来的第几个（null 是新的）
function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = norm(a[i]) === norm(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = new Array(m).fill(null);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (norm(a[i]) === norm(b[j])) { pairs[j] = i; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return pairs;
}
// 拨盘的每一种拨法（几个拨盘一起）：[{ vars（照这种拨法的拨盘表）, text（「t 拨到「过去」」） }]；太多（> 64）只给现在这一种
function dialStates(names, vars) {
  const xs = names.map((n) => [n, vars.get(n)]).filter(([, x]) => x && dialSteps(x));
  const total = xs.reduce((k, [, x]) => k * dialSteps(x).n, 1);
  if (!xs.length || total > 64) return [{ vars, text: '' }];
  let out = [new Map(vars)];
  for (const [n, x] of xs) out = out.flatMap((m) => Array.from({ length: dialSteps(x).n }, (_, i) => new Map(m).set(n, { ...x, v: x.lo + i })));
  return out.map((m) => ({ vars: m, text: xs.map(([n]) => `${n} 拨到「${varText(m.get(n))}」`).join('、') }));
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

// —— 正确拆法 key= ——
/**
 * key 的括号写法 → { src, spans: [{ role（key 里写的缩写）, keys（这一段的词，按一开始的编号：挪了词跟着走）, depth（套在第几层）}] }。
 * key 里的词要和句子一个一个对上：两边都按 entext.js 的切法切（parse 组件判分用的就是它），只比词，不管大小写；
 * 标点不比（括号的头尾只落在词上），所以标点前后有没有空格、句末的点写没写都行。对不上的当场报错，写出第一个对不上的词
 */
export function parseKey(words, src) {
  const s = String(src ?? '').trim();
  if (!s.includes('[')) throw new Error('key= 要用 [成分 词…] 标出正确拆法，比如 key="[S The man] [V is] [P a doctor]."（成分写缩写：S、V、O、RC……）');
  if (/\[(?![A-Za-z])/.test(s)) throw new Error('key= 的括号里先写成分的英文缩写（S、V、O、P、RC、NF……），再写词，比如 [S The man]');
  // key 照英文的词对句子（主线第一轮 E1-4：中文的句子以前报「[V …] 里面没有词」，词明明在，照着改不出来）
  if (/\[[A-Za-z][\w/]*\s+[^\][]*[\u4e00-\u9fff]/.test(s)) throw new Error('key= 只认英文的词：中文的句子页面拆不了成分、判不了。中文的句子不写 key=（学生拉的括号页面照收，对不对你来看）');
  // 一段几种成分（[Attr/NF designed …]：定语、非谓语都对）：parseBrackets 的成分只认一个词，先换成一个记号，读完再拆开
  const OR = '_or_';
  if (/\[[A-Za-z]\w*(?:\/[A-Za-z]\w*)*\/(?![A-Za-z])/.test(s)) throw new Error('key= 里一段几种成分写成 [Attr/NF 词…]：/ 两边都写成分的缩写');
  let parsed;
  try { parsed = parseBrackets(s.replace(/\[([A-Za-z]\w*(?:\/[A-Za-z]\w*)+)(?=\s)/g, (_, r) => `[${r.split('/').join(OR)}`)); } catch (e) { throw new Error(`key= 写错了：${e.message.split(OR).join('/')}`); }
  for (const sp of parsed.spans) sp.roles = sp.role.split(OR);
  // 认不出的成分名当场报（照收的话学生标什么都对不上，又看不出为什么）
  const odd = parsed.spans.flatMap((sp) => sp.roles).find((r) => !roleName(r));
  if (odd) throw new Error(`key= 里的成分「${odd}」认不出，能写：${Object.entries(ROLE_NAMES).map(([k, v]) => `${k} ${v}`).join('、')}（编号 V1、V2 也行；一段几种写 Attr/NF）`);
  // 句子的词再按 entext 的切法切一遍（U.S. 会切成 U、S 两个）：每一小块记着它是句子里的哪个词
  const flat = [];
  for (const w of [...words].sort((a, b) => a.slot - b.slot)) {
    for (const t of tokenizeSentence(w.value)) if (t.word) flat.push({ w: t.w, word: w });
  }
  const mine = []; // key 里的词
  const ord = new Map(); // key 的记号下标 → 第几个词
  for (const t of parsed.tokens) if (t.word) { ord.set(t.i, mine.length); mine.push(t.w); }
  const n = Math.min(flat.length, mine.length);
  for (let i = 0; i < n; i++) {
    if (norm(flat[i].w) !== norm(mine[i])) throw new Error(`key= 里的词和句子对不上：句子第 ${flat[i].word.slot} 个词是「${flat[i].word.value}」，key 里是「${mine[i]}」（key 照抄句子，只加 [成分 …] 括号）`);
  }
  if (mine.length < flat.length) throw new Error(`key= 里少了词：句子从第 ${flat[n].word.slot} 个词「${flat[n].word.value}」起，key 里没有（key 照抄整句）`);
  if (mine.length > flat.length) throw new Error(`key= 里多了词：「${mine.slice(n).join(' ')}」句子里没有（key 照抄句子，只加 [成分 …] 括号）`);
  // 舞台上一段词只挂一道括号（同一段再 mark 就换掉），所以 key 里同一段词不能有两个成分
  const seen = new Map();
  const spans = parsed.spans.map((sp) => {
    const keys = [...new Set(flat.slice(ord.get(sp.from), ord.get(sp.to) + 1).map((x) => x.word.key))];
    const sig = keys.join(',');
    const role = sp.roles.join('/');
    if (seen.has(sig)) throw new Error(`key= 里 [${seen.get(sig)} …] 和 [${role} …] 是同一段词：舞台上一段词只挂一个成分，留一个（两种都算对写 [${seen.get(sig)}/${role} …]）`);
    seen.set(sig, role);
    // role 是第一种（写给老师、按钮的颜色照它），roles 是写了的每一种：学生标哪一种都算拉对
    return { role: sp.roles[0], roles: sp.roles, keys, depth: sp.depth };
  });
  return { src: s, spans };
}

// —— 指代的答案 links=（照黑板 link 组件的写法，entext.js 的 parseLink：几条用 ; 隔开，! 开头是常见的错连，= 后面是它说明了什么）——
/**
 * 一头的写法 → 词的 key（一开始的编号，挪了词跟着走）：词（句子里只有一个时）、s.6、s.1-2、s#6、s（整句，就是主句）。
 * 返回 { keys } 或 { whole: true }；写错了抛错
 */
function linkEnd(o, src, raw) {
  const t = String(src ?? '').trim();
  if (!t) throw new Error(`links= 的「${raw}」：两头都要写，比如 that -> books`);
  if (t === o.id) return { whole: true };
  const ref = t.match(/^([A-Za-z_]\w*)([.#])(.+)$/);
  if (ref && ref[1] !== o.id && !o.words.some((w) => norm(w.value) === norm(t))) throw new Error(`links= 的「${t}」：写 ${o.id} 里的词（${o.id}.6、${o.id}.1-2、整句写 ${o.id}）`);
  if (ref && ref[1] === o.id) return { keys: sentence.pick(o, ref[2], ref[3], t).map((w) => w.key) };
  const hits = ordered(o).filter((w) => norm(w.value) === norm(t));
  if (!hits.length) throw new Error(`links= 的「${raw}」：${o.id} 里没有「${t}」这个词（写词本身，或者写 ${o.id}.6 这样的部件）`);
  if (hits.length > 1) throw new Error(`links= 的「${t}」在句子里有 ${hits.length} 个，写成 ${o.id}.${hits[0].slot} 这样的部件`);
  return { keys: [hits[0].key] };
}
/** 一头写成比得上的字：'15'、'15-16'、'3,5'（按 key，挪了词照样比得上）、'整句' 写 's'（gestures、判法都照它比） */
export function targetKey(t) {
  if (!t) return '';
  if (t.whole) return 's';
  const ks = [...new Set(t.keys || [])].sort((a, b) => a - b);
  const runs = [];
  for (const k of ks) { const r = runs[runs.length - 1]; if (r && r[1] === k - 1) r[1] = k; else runs.push([k, k]); }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');
}
/** links="that -> books; !that -> shelf=就近连了名词" → { src, pairs: [{ from: key, to }], wrongs: [{ from, to, why }] }（to 是 linkEnd 的样子） */
export function parseLinks(o, src) {
  const pairs = [], wrongs = [];
  for (const raw of String(src ?? '').split(/[;；\n]/).map((x) => x.trim()).filter(Boolean)) {
    const bad = raw.startsWith('!');
    const body = bad ? raw.slice(1) : raw;
    const eq = bad ? body.indexOf('=') : -1;
    const m = /^(.+?)\s*(?:->|→|=>)\s*(.+)$/.exec((eq < 0 ? body : body.slice(0, eq)).trim());
    if (!m) throw new Error(`links= 要写成 词 -> 它指的词（${o.id}.6 -> ${o.id}.2、that -> books，几条用 ; 隔开，! 开头是常见的错连），「${raw}」看不懂`);
    const a = linkEnd(o, m[1], raw), b = linkEnd(o, m[2], raw);
    if (a.whole || a.keys.length !== 1) throw new Error(`links= 的左边写一个词（钩挂在它上面）：「${m[1].trim()}」`);
    if (!b.whole && b.keys.length === 1 && b.keys[0] === a.keys[0]) throw new Error(`links= 的「${raw}」：两头是同一个词`);
    const item = { from: a.keys[0], to: b };
    if (bad) wrongs.push({ ...item, why: eq < 0 ? '' : body.slice(eq + 1).trim() });
    else pairs.push(item);
  }
  if (!pairs.length) throw new Error(`links= 至少写一条正确的：词 -> 它指的词，比如 links="that -> books"（! 开头的是常见的错连）`);
  const seen = new Set();
  for (const p of pairs) {
    if (seen.has(p.from)) throw new Error(`links= 里「${o.words.find((w) => w.key === p.from).value}」连了两条：一个词只连一条`);
    seen.add(p.from);
  }
  return { src: String(src), pairs, wrongs };
}

/** key、links 是被什么作废的（写给老师）：rewrite 换了整句；拨盘换了词、原来的 key 对不上（key 里没写同样的 {t: … | …}） */
export const voidBy = (k) => (k?.void === 'dial' ? '拨盘换词' : 'rewrite');

/**
 * key 现在怎么样（没写 key 是 null）：{ n（几段）, void（被 rewrite 作废了）, split: [{ n（第几段）, role, text }]（被 move 拆散、拉不成一段的）}。
 * 「舞台现在」（describe）用它，老师看得到 key 收下了没有、为什么判不了（判法里的同一件事在 sentence.rules.js 的 keySpans）
 */
export function keyStatus(o) {
  if (!o?.key) return null;
  if (o.key.void) return { n: 0, void: o.key.void, split: [] };
  const slot = new Map(o.words.map((w) => [w.key, w.slot]));
  const split = [];
  o.key.spans.forEach((sp, i) => {
    const slots = sp.keys.map((k) => slot.get(k));
    if (slots.some((v) => v == null) || Math.max(...slots) - Math.min(...slots) + 1 !== slots.length) {
      split.push({ n: i + 1, role: sp.role, text: phraseOf(o.words.filter((w) => sp.keys.includes(w.key)).sort((a, b) => a.key - b.key)) });
    }
  });
  return { n: o.key.spans.length, void: null, split };
}

/**
 * 拆散了的括号（id）：括号记的词现在在句子里不挨着了（move 把中间的词挪走、或者把括号里的一个词挪出去）。
 * 拆散的不算一段（sentence.rules.js 的 markSpans 也跳过它们）：画面画成断开的虚线，现状里告诉老师
 */
export function brokenMarks(o) {
  const slot = new Map((o?.words || []).map((w) => [w.key, w.slot]));
  return (o?.marks || []).filter((m) => {
    const slots = m.keys.map((k) => slot.get(k));
    return slots.some((v) => v == null) || Math.max(...slots) - Math.min(...slots) + 1 !== slots.length;
  }).map((m) => m.id);
}

/**
 * 跟着拨盘变的句子写得对不对（写下新的一行时查）：每个 {…} 照 pick.js 查；拨盘的每一种拨法都切得成词、不超过词数上限；
 * 写了 key=、links= 的，每一种拨法都要对得上（对不上的说是哪一种拨法：key 里也照样写 {t: … | …}）
 */
function checkTemplate(scene, id, tpl, opts) {
  for (const p of splitPicks(tpl)) if (p.k === 'pick') checkPick(p, scene.vars);
  for (const src of [opts.key, opts.links]) if (src != null) for (const p of splitPicks(src)) if (p.k === 'pick') checkPick(p, scene.vars);
  for (const st of dialStates(pickDeps(tpl), scene.vars)) {
    const T = templateWords(tpl, st.vars);
    const when = st.text ? `${st.text}时` : '';
    if (!T.words.length) throw new Error(`${when}句子里一个词也没有`);
    if (T.words.length > MAX_WORDS) throw new Error(`${when}句子有 ${T.words.length} 个词，一句最多 ${MAX_WORDS} 个`);
    const ws = T.words.map((w, i) => ({ obj: id, key: i + 1, slot: i + 1, value: w.value, lead: w.lead, punct: w.punct }));
    if (opts.key != null) { try { parseKey(ws, fillPicks(opts.key, st.vars)); } catch (err) { throw new Error(`${when} key= 对不上：${err.message}${hasPick(opts.key) ? '' : `（句子跟着拨盘变，key= 里那一段也照样写 {${pickDeps(tpl)[0]}: … | …}）`}`); } }
    if (opts.links != null) { try { parseLinks({ words: ws, id, marks: [], end: T.end }, fillPicks(opts.links, st.vars)); } catch (err) { throw new Error(`${when} links= 对不上：${err.message}`); } }
  }
}

/**
 * 整句换成 words（rewrite、跟着拨盘重排共用）：pairs 是新的第 j 个词 → 原来的第几个（null 是新的）。同一个词留着它的编号和样子；
 * 括号、标签、折起来的、断开、箭头照下面的规矩留。返回画面要的 { id, removed, added, moved, changed }。
 * segs（跟着拨盘重排）：每个词是模板的第几段
 */
function rewriteWords(o, words, end, pairs, { segs = null } = {}) {
  const old = ordered(o);
  const next = words.map((w, j) => {
    const was = pairs[j] != null ? old[pairs[j]] : null;
    const base = was || { obj: o.id, key: o.nextKey++, paint: null, glow: false, lift: false, dim: false, covered: false };
    return { ...base, slot: j + 1, value: w.value, lead: w.lead, punct: w.punct, changed: !!was && was.value !== w.value, ...(segs ? { seg: segs[j] } : {}) };
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
  // 跟着拨盘重排（segs）：括号的头正好是 {…} 那一段的第一个词、尾正好是那一段的最后一个词，这个词换掉了就接到新那一段的头、尾上
  //（学生把「am holding」拉成谓语，拨到将来还是那一段「will be holding」；只圈了半段的照旧收掉）
  const headTo = new Map(), tailTo = new Map();
  if (segs) for (const g of new Set(segs)) {
    const a = old.filter((w) => w.seg === g), b = next.filter((w) => w.seg === g);
    if (!a.length || !b.length) continue;
    if (!alive.has(a[0].key)) headTo.set(a[0].key, b[0].key);
    if (!alive.has(a[a.length - 1].key)) tailTo.set(a[a.length - 1].key, b[b.length - 1].key);
  }
  const respan = (keys) => {
    const ks = [...keys].sort((a, b) => oldPos.get(a) - oldPos.get(b));
    const a = pos.get(ks[0]) ?? pos.get(headTo.get(ks[0])), b = pos.get(ks[ks.length - 1]) ?? pos.get(tailTo.get(ks[ks.length - 1]));
    if (a == null || b == null || a > b) return null;
    return next.filter((w) => w.slot >= a && w.slot <= b).map((w) => w.key);
  };
  const keep = (list) => list.map((x) => { const keys = respan(x.keys); return keys ? { ...x, keys } : null; }).filter(Boolean);
  o.marks = keep(o.marks);
  o.tags = keep(o.tags);
  o.folds = keep(o.folds);
  o.cuts = o.cuts.filter((k) => alive.has(k) && pos.get(k) !== next.length);
  // 跟着拨盘重排（segs）：指着 {…} 那一整段的箭头和括号一样接到新那一段上（学生从钩上拉到谓语那道括号的线，一拨不丢）
  o.refers = o.refers.map((r) => {
    if (!alive.has(r.from)) return null;
    if (r.whole) return r;
    if (!r.toKeys) return alive.has(r.to) ? r : null;
    if (r.toKeys.every((k) => alive.has(k)) && !segs) return r;
    const keys = segs ? respan(r.toKeys) : null;
    return keys && !keys.includes(r.from) ? { ...r, toKeys: keys, to: keys[keys.length - 1] } : null;
  }).filter(Boolean);
  // 原来的正确拆法是那一句的：改写以后对不上了，作废（不拿旧的去判新句子）；记着作废了，老师在「舞台现在」和下一步里看得到
  if (o.key) o.key = { src: o.key.src, spans: [], void: 'rewrite' };
  if (o.links) o.links = { src: o.links.src, pairs: [], wrongs: [], void: 'rewrite' };
  return { id: o.id, removed, added: next.filter((w) => !old.some((x) => x.key === w.key)).map((w) => w.key), moved, changed };
}

// 常见的句首词（挪走以后改回小写用；专名不在里面，认不出的不动）
const STARTERS = new Set(('the a an this that these those it its he she they we you there here what when where why how who which whose if as so but and or because although though while since after before until unless once then now today yesterday tomorrow in on at by for with from to of about into over under during without within between among through against despite not no never only even also still just all some any many most each every both either neither one two my your his her our their such few little much more less than whether however therefore thus hence meanwhile moreover instead otherwise perhaps maybe sometimes often always usually finally first second next last is are was were do does did have has had can could will would shall should may might must').split(' '));

export const sentence = {
  type: 'sentence',
  label: '句子',
  create: ['sentence'],
  // 认得的选项（名字=值，scene.js 的 checkOptions；造它的那一行另外都认 hide=）：写了不认得的当场报，不默默当没写
  options: { sentence: ['key', 'links'], mark: ['color'], tag: ['color'] },
  drag: true,
  hint: '（句子：名字.3 现在第 3 个词，名字.2-5 第 2 到 5 个，名字.who 这个词（出现几次写 名字.who:2），名字.who-door 从 who 到 door；括号里的 #k 是「一开始第 k 个的那个词」，写 名字#k 跟着它走）',
  make(scene, c, h, old) {
    if (!h.args.some((a) => a.t === 'eq') || h.str == null) throw new Error('要写成 sentence 名字 = "英文句子"');
    const id = h.words[0];
    // 句子里写了 {t: … | …}（跟着拨盘变，主线第二轮 C）：照现在那一段造；key=、links= 里写了同样的 {…} 的跟着换
    const tpl = hasPick(h.str) ? h.str : null;
    const keyTpl = tpl && h.opts.key != null && hasPick(h.opts.key) ? h.opts.key : null;
    const linksTpl = tpl && h.opts.links != null && hasPick(h.opts.links) ? h.opts.links : null;
    if (tpl && !c.lenient) checkTemplate(scene, id, tpl, h.opts);
    let T = null;
    if (tpl) { try { T = templateWords(tpl, scene.vars); } catch (err) { if (!c.lenient) throw err; } }
    const { words, end } = T || splitSentence(h.str);
    if (!words.length) throw new Error('sentence 的引号里要有英文词');
    if (words.length > MAX_WORDS) throw new Error(`一句最多 ${MAX_WORDS} 个词（写了 ${words.length} 个）；太长就拆成两句`);
    const o = {
      width: WRAP, end, marks: [], tags: [], folds: [], cuts: [], refers: [], seq: 1, nextKey: words.length + 1,
      words: words.map((w, i) => ({ obj: id, key: i + 1, slot: i + 1, value: w.value, lead: w.lead, punct: w.punct, paint: null, glow: false, lift: false, dim: false, covered: false, ...(T ? { seg: T.segs[i] } : {}) })),
    };
    if (T) o.picks = { src: tpl, deps: pickDeps(tpl), now: T.now, ...(keyTpl ? { key: keyTpl } : {}), ...(linksTpl ? { links: linksTpl } : {}) };
    const fill = (src) => (T ? fillPicks(src, scene.vars) : src);
    // 正确拆法（老师给的，页面拿它逐词比学生拉的括号；sentence.rules.js）
    if (h.opts.key != null) o.key = parseKey(o.words, fill(h.opts.key));
    // 指代的答案（老师给的，学生从钩上拉线时页面照它判；sentence.rules.js）
    if (h.opts.links != null) o.links = parseLinks({ ...o, id }, fill(h.opts.links));
    o.origin = old ? { ...old.origin } : scene.slotFor(layout({ ...o, origin: { x: 0, y: 0 } }).box.w);
    return o;
  },
  parts(o) { return ordered(o); },
  /** 扣着的词画成小块写它现在是第几个词（scene.js 的 coverText：不写词本身） */
  coverName: (p) => `第 ${p.slot} 个词`,
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
      ...L.brackets, ...L.marks, ...L.tags, ...L.cuts, ...L.refers.map((r) => r.box), ...L.tallies,
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
      // 谁拉的（这一行是学生做的还是老师写的，scene.js 的 apply 记着）：学生的括号页面另外数里面的谓语、多拉的、拆散的；
      // 同一段再标就换成这一回标的人
      const by = scene.actor === 'student' ? 'student' : 'teacher';
      // 拉的时候就不连着（did … realize 这种老师故意拉成两截的）：记着，画面不当成「被挪开拆散了」画虚线
      const apart = !contiguous(parts);
      if (had) { Object.assign(had, { label, color, by }); if (apart) had.apart = true; else delete had.apart; }
      else {
        if (o.marks.length >= 24) throw new Error('一句上最多 24 道括号，先 unmark 几道');
        o.marks.push({ id: `m${o.seq++}`, keys, label, color, by, ...(apart ? { apart: true } : {}) });
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
    // tally s V：每道学生的括号上标里面 key 的谓语（写别的成分就数那一种）几个，剩下的在句尾标（画面跟着变）；untally s 收起。
    // 照 key 数：没写 key 的句子以后也数不了，写下就报
    tally(scene, c, h) {
      const { o, whole, refs } = target(h, 'tally');
      if (!whole) throw new Error(`tally 写整句的名字：tally ${o.id} V`);
      const label = restText(h, refs).trim();
      if (!label) throw new Error(`tally 后面要写成分，比如 tally ${o.id} V（数每道学生括号里 key 的谓语几个）`);
      if (!roleName(label)) throw new Error(`tally 的成分「${label}」认不出（写 V、谓语、S、主语、O……）`);
      if (!c.lenient && (!o.key || o.key.void)) throw new Error(o.key?.void ? `${o.id} 的 key 跟着 ${voidBy(o.key)} 作废了，页面数不了，tally 标不出来` : `${o.id} 没写 key=（正确拆法），页面数不了，tally 标不出来`);
      o.tally = label;
      return { id: o.id };
    },
    untally(scene, c, h) {
      const { o } = target(h, 'untally');
      o.tally = null;
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
      const keys = parts.map((p) => p.key);
      // 套着折（第二轮）：里层折着也能折外层，外层折着也能折里层（里层留在外层的小方块里）；正好是折起来的那一段、交叉的不收
      const clash = foldClash(o, keys);
      if (clash) throw new Error(clash);
      const label = restText(h, refs).trim() || o.marks.find((m) => sameKeys(m.keys, keys))?.label || '';
      if (label.length > 12) throw new Error('小方块上的字要短（12 个字以内）');
      const color = o.marks.find((m) => sameKeys(m.keys, keys))?.color ?? roleColor(label);
      // 缩进小方块的词（画面的动画用）：已经折在里层的那几个本来就看不见，不再缩一次
      const shown = keys.filter((k) => !foldOfKey(o, k));
      const f = { id: `f${o.seq++}`, keys, label, color };
      o.folds.push(f);
      return { id: o.id, fold: f.id, keys: shown };
    },
    // unfold s.3：展开含这个词的那一段（套着的先展开看得见的外层，里层照旧折着）；unfold s：全展开
    unfold(scene, c, h) {
      const { o, parts, whole } = target(h, 'unfold');
      const keys = new Set(parts.map((p) => p.key));
      const gone = whole ? o.folds : outerFolds(o).filter((f) => f.keys.some((k) => keys.has(k)));
      if (!gone.length) throw new Error(`${o.id} 上${whole ? '' : '这几个词'}没有折起来的`);
      o.folds = o.folds.filter((f) => !gone.includes(f));
      // 露出来的词（画面的动画用）：展开的那几段里、还折在里层的不算
      const still = new Set(o.folds.flatMap((f) => f.keys));
      return { id: o.id, keys: [...new Set(gone.flatMap((f) => f.keys))].filter((k) => !still.has(k)), pills: gone.map((f) => f.id) };
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
      // 跟着拨盘变的句子（{t: … | …}）：先后改了，不再跟（再照模板重排会把挪好的冲掉）；现状里写明
      if (o.picks && !o.picks.off && next.some((w, k) => w !== order[k])) o.picks.off = 'move';
      // 这一段最后一个词贴着的分隔标点（「stopped,」的逗号）是这一段和后面那个词之间的，不是这一段的：留在原处——交给原来紧挨在
      // 这一段前面的那个词（它自己已经有标点就不重复），这一段在句首就不要了（以前跟着走，挪到句尾成了「stopped,.」）。
      // 段里面的标点、段尾的右引号右括号（和段头的左引号是一对）跟着走；段外面的词贴着的标点不动
      if (next.some((w, k) => w !== order[k])) {
        const tail = block[block.length - 1];
        const [, keep, sep] = String(tail.punct || '').match(/^(.*?)([,;:，；：—–\s]*)$/s);
        if (sep.trim()) {
          tail.punct = keep;
          const prev = order[order.indexOf(block[0]) - 1];
          if (prev && !prev.punct) prev.punct = sep;
        }
      }
      // 句首换了人：大小写跟着变（底座第二轮留下的第 8 条：以前「to read … today It is painful.」）。新的句首大写；
      // 原来句首的那个词，是常用的句首词（It、The、When……）或者句子里别处有它小写的样子才改小写——I、认不出的专名不动
      // 页面替它大写的词记一笔（upped）：离开句首照这一笔改回，不靠词表猜（学生拖到句首看看再拖回去，以前句中留一个大写的 Painful）。
      // 原来的句首本来就是小写的（一个片段「have been doing」）：这一句不讲大小写，两头都不动；词里面有大写的（iPhone）不动
      // 这一句讲不讲大小写，第一次换句首时看一眼原来的句首、记在句子上（之后 iPhone 这样的词到了句首，不能再照当时的句首看）
      if (next[0] !== order[0] && o.capital == null) o.capital = /^[A-Z]/.test(order[0].value);
      if (next[0] !== order[0] && o.capital) {
        const was = order[0], now = next[0];
        if (/^[a-z]/.test(now.value) && !/[A-Z]/.test(now.value.slice(1))) { now.value = now.value[0].toUpperCase() + now.value.slice(1); now.upped = true; }
        const low = was.value.toLowerCase();
        if (was.upped) { was.value = was.value[0].toLowerCase() + was.value.slice(1); delete was.upped; }
        else if (/^[A-Z][a-z'’]*$/.test(was.value) && was.value !== 'I' && !/^I['’]/.test(was.value) && (STARTERS.has(low) || order.some((w) => w !== was && w.value === low))) was.value = low;
      }
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
    // refer s.3 -> s.2：箭头（which / it / that 指的是谁）；指到一段 refer s.6 -> s.1-2、指到整句（主句）refer s.6 -> s；unrefer s.3 / unrefer s。
    // 一个词只连一条（再连就换掉）
    refer(scene, c, h) {
      const { args, arrow } = h;
      if (arrow < 0) throw new Error('要写成 refer s.3 -> s.2（从 which 指到它说的那个词；指一段写 s.1-2，指整句写 s）');
      const a = target({ ...h, refsIn: () => h.refsIn(args.slice(0, arrow)) }, 'refer');
      const b = target({ ...h, refsIn: () => h.refsIn(args.slice(arrow + 1)) }, 'refer');
      if (a.o !== b.o) throw new Error('refer 的两头要在同一句里');
      if (a.whole) throw new Error(`refer 从一个词连出去，比如 refer ${a.o.id}.3 -> ${a.o.id}.2`);
      const from = a.parts[0].key;
      // 指到一段（不只一个词）：toKeys 是那一段；一个词照旧 toKeys 是 null（第一轮的写法一字不变）；整句 whole
      const whole = !!b.whole && b.refs.every((r) => r === b.o.id);
      const span = !whole && b.parts.length > 1 ? b.parts.map((p) => p.key) : null;
      const to = whole ? null : b.parts[b.parts.length - 1].key;
      if (!whole && !span && from === to) throw new Error('refer 的两头是同一个词');
      if (span && !contiguous(b.parts)) throw new Error(`refer 指到的一段要连着（${b.refs.join(' ')} 不连着）`);
      if (span?.includes(from)) throw new Error(`refer 指到的那一段不能含 ${a.parts[0].value} 自己`);
      const bad = h.words.find((w) => /^g\d+$/.test(w) && !isColor(w));
      if (bad) throw new Error('颜色只有 g1～g6');
      const color = h.words.find(isColor) || null;
      const o = a.o;
      // 谁连的：学生拉的线以后头上有 ✕ 能自己收掉
      const by = scene.actor === 'student' ? 'student' : 'teacher';
      o.refers = o.refers.filter((r) => r.from !== from);
      o.refers.push({ from, to, toKeys: span, whole, color, by });
      return { id: o.id, from, to, ...(span ? { toKeys: span } : {}), ...(whole ? { whole: true } : {}) };
    },
    // unrefer s.4 -> s.1：正好有从 s.4 连到 s.1 的那一条，就只收它（学生点线头上的 ✕ 时，别的线也指着 s.4，页面写成这样，不连带收掉别的）；
    // 没有正好这一条的照以前的意思：箭头两边写的词都算，收掉两头有这些词的每一条（旧课照 log 放回一样）
    unrefer(scene, c, h) {
      const one = h.arrow >= 0 ? exactRefer(h) : null;
      if (one) {
        one.o.refers = one.o.refers.filter((r) => r !== one.r);
        return { id: one.o.id };
      }
      const { o, parts, whole } = target(h, 'unrefer');
      const keys = new Set(parts.map((p) => p.key));
      const gone = whole ? o.refers : o.refers.filter((r) => keys.has(r.from) || keys.has(r.to) || (r.toKeys || []).some((k) => keys.has(k)));
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
      // 跟着拨盘变的句子（{t: … | …}）：整句换了，不再跟（再照模板重排会把这一句冲掉）；现状里写明
      if (o.picks && !o.picks.off) o.picks.off = 'rewrite';
      return rewriteWords(o, words, end, matchWords(ordered(o), words));
    },
  },
  /**
   * 拨盘变了（scene.js 的 onVar）：照模板现在那一段重排，画面照 rewrite 演（choreo: 'rewrite'）。没变是 null。
   * 模板里一段一段对着认：原文的那几段词一个对一个，{…} 那一段里一样的词留着（lcsPairs）；key=、links= 照同样的拨法重读
   */
  onPick(scene, o) {
    const P = o.picks;
    if (!P || P.off) return null;
    // 用到的拨盘有一个不在了（时间轴拿掉了）：不再跟（照模板重排会把 {…} 原文写进句子）
    if (!P.deps.every((d) => scene.vars.has(d))) { P.off = 'gone'; return null; }
    let T;
    try { T = templateWords(P.src, scene.vars); } catch { return null; }
    const old = ordered(o);
    P.now = T.now;
    const pairs = new Array(T.words.length).fill(null);
    const segIds = [...new Set(T.segs)];
    for (const g of segIds) {
      const was = old.map((w, i) => ({ w, i })).filter((x) => x.w.seg === g);
      const js = T.segs.map((sg, j) => (sg === g ? j : -1)).filter((j) => j >= 0);
      const m = lcsPairs(was.map((x) => x.w.value), js.map((j) => T.words[j].value));
      js.forEach((j, k) => { if (m[k] != null) pairs[j] = was[m[k]].i; });
    }
    const same = old.length === T.words.length && T.words.every((w, j) => pairs[j] === j && old[j].value === w.value && old[j].punct === w.punct && old[j].lead === w.lead) && o.end === T.end;
    if (same) return null;
    const keyWas = o.key, linksWas = o.links;
    const fx = rewriteWords(o, T.words, T.end, pairs, { segs: T.segs });
    // 正确拆法、指代的答案照现在的拨法重读（里面写了同样的 {…} 的跟着换）；对不上了（重放旧课才会）作废，记着是拨盘换的
    const redo = (was, tpl, parse) => {
      if (!was) return undefined;
      const src = tpl ? fillPicks(tpl, scene.vars) : was.src;
      try { return parse(src); } catch { return { ...parse.blank(src), void: 'dial' }; }
    };
    const pk = (src) => parseKey(o.words, src); pk.blank = (src) => ({ src, spans: [] });
    const pl = (src) => parseLinks(o, src); pl.blank = (src) => ({ src, pairs: [], wrongs: [] });
    if (keyWas) o.key = redo(keyWas, P.key, pk);
    if (linksWas) o.links = redo(linksWas, P.links, pl);
    return { ...fx, choreo: 'rewrite' };
  },
  // 一句话写现在的样子（存档点 back 以后告诉老师，scene.js 的 summaryOf）：那一句（折起来的写成［…］，和现状一样）
  summary(o) { return sentenceText(o, { folds: true }); },
  describe(o, scene) {
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
    if (o.picks?.off) lines.push(`  不再跟着拨盘 ${o.picks.deps.join('、')} 变（${o.picks.off === 'rewrite' ? 'rewrite 换了整句' : o.picks.off === 'gone' ? '拨盘没了：重新造出同样个数的就接着跟' : 'move 挪过词'}；要再跟就重新造这句）`);
    else if (o.picks) {
      // {verb: …}（页面拼的谓语）另起一行说清拼的是什么；别的照旧说「跟着拨盘变」
      const ps = splitPicks(o.picks.src).filter((p) => p.k === 'pick');
      const dial = (o.picks.now || []).filter((x, k) => ps[k]?.name !== VERB);
      if (dial.length) lines.push(`  跟着拨盘变：${dial.map((x) => `${x.raw} 现在是「${x.text}」`).join('；')}`);
      for (const p of ps) if (p.name === VERB) { const f = verbFact(p, scene?.vars || new Map()); if (f) lines.push(`  谓语是页面拼的：${f}`); }
    }
    if (o.marks.length) {
      const lv = new Map(L.marks.map((m) => [m.mark, m.level]));
      // 成分写两种名字（定语（Attr）、谓语（V））：学生点的是中文、老师写的多半是缩写，两边都认得出（事实里照括号上写的，一个名字）
      const extra = (m) => [lv.get(m.id) > 1 ? `第 ${lv.get(m.id)} 层` : '', m.color ? COLOR_NAMES[m.color] : ''].filter(Boolean).join('，');
      lines.push(`  括号（词下面）：${o.marks.map((m) => `${spanText(o, m.keys)} ${roleBoth(m.label)}${extra(m) ? `，${extra(m)}` : ''}`).join('；')}`);
      // 学生拉的括号：里面 key 的谓语几个、多拉的、key 里没有的、被挪开拆散的（页面照 key 数，sentence.rules.js）
      for (const f of bracketFacts(o)) lines.push(`  ${f}`);
    }
    // tally s V：学生看到的数（每道学生括号上、句尾），照 key 数；数不了的说为什么
    if (o.tally) {
      const t = tallyOf(o);
      const head = `  标着的数（tally ${o.tally}${t ? `，key 的${roleName(o.tally)}` : ''}）：`;
      if (!t) lines.push(`${head}页面数不了（${o.key?.void ? `${o.id} 的 key 跟着 ${voidBy(o.key)} 作废了` : `${o.id} 没写 key`}），画面上没标`);
      else {
        const each = o.marks.filter((m) => t.each.has(m.id)).map((m) => `${spanText(o, m.keys)} ${m.label} ${t.each.get(m.id)} 个`);
        const boxes = o.marks.filter((m) => t.each.has(m.id));
        const mine = t.lamps ? `；学生自己标的${t.name} ${t.lamps} 处（${[...boxes.map((m) => `${spanText(o, m.keys)} 里 ${t.eachMine.get(m.id)} 处`), `括号外 ${t.restMine} 处`].join('，')}）` : '';
        lines.push(`${head}${[...each, `括号外 ${t.rest} 个`].join('；')}${mine}`);
      }
    }
    const ks = keyStatus(o);
    // 指代的答案收下了没有（和 key 一样，老师看得到 refer 判不判、为什么判不了）
    if (o.links) lines.push(`  links=：${o.links.void ? `作废了（${voidBy(o.links)} 换了句子；要判就重新造这句、带上新的 links=）` : `收下了（${o.links.pairs.length} 条${o.links.wrongs.length ? `，常见的错连 ${o.links.wrongs.length} 条` : ''}）`}`);
    if (ks) lines.push(`  key：${ks.void ? `作废了（${voidBy(o.key)} 换了句子；要判就重新造这句、带上新的 key=）` : ks.split.length ? ks.split.map((x) => `第 ${x.n} 段 [${x.role} ${x.text}] 被 move 拆散了，那一段不能再拉对`).join('；') : `收下了（${ks.n} 段）`}`);
    if (o.tags.length) lines.push(`  标签（词上面）：${o.tags.map((t) => `${spanText(o, t.keys)} ${t.label}`).join('；')}`);
    // 套着折的里层写一声在哪一段里面（画面上看不见，展开外层才露出来）
    if (o.folds.length) {
      const outer = new Set(outerFolds(o));
      const host = (f) => o.folds.find((g) => outer.has(g) && g !== f && f.keys.every((k) => g.keys.includes(k)));
      lines.push(`  折起来的：${o.folds.map((f) => `${spanText(o, f.keys)} →「${f.label || '……'}」${outer.has(f) ? '' : `（在 ${spanText(o, host(f)?.keys || [])} 里面）`}`).join('；')}`);
    }
    if (o.cuts.length) lines.push(`  断开：${[...o.cuts].map((k) => o.words.find((w) => w.key === k)).sort((a, b) => a.slot - b.slot).map((w) => `${o.id}.${w.slot} ${w.value} 后面`).join('，')}`);
    if (o.refers.length) {
      const at = (k) => { const w = o.words.find((x) => x.key === k); return `${o.id}.${w.slot} ${w.value}`; };
      const toText = (r) => (r.whole ? '整句' : r.toKeys ? `${spanText(o, r.toKeys)} ${phraseOf(o.words.filter((w) => r.toKeys.includes(w.key)).sort((a, b) => a.slot - b.slot))}` : at(r.to));
      lines.push(`  箭头：${o.refers.map((r) => `${at(r.from)} → ${toText(r)}`).join('，')}`);
    }
    return lines;
  },
  doc: `句子（英语长难句：先找谓语，再分主干、从句、非谓语、插入语，按意群断开）：
sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."      造一句（标点贴着前一个词，长了自动折行；句子里有 " 就用「」括起来）；key= 是正确拆法：照抄句子，加 [成分 词…]（成分写缩写 S V O P A Attr RC NF……），学生拉的括号页面照它判（key 没拉的段不判），不写不判
写法：s.3 现在第 3 个词；s.2-5 第 2 到 5 个；s.who 这个词（出现几次写 s.that:2）；s.who-door 从 who 到 door；s#3 一开始第 3 个的那个词（挪了、改写了跟着走）
mark s.1-6 主语 / unmark s.1-6     词下面一道括号、下面写成分（套着的一层层往下排；颜色按成分，也能写 g1～g6）
tag s.7 V / untag s.7             词上面的小标签（S、V、谓语1；最多 8 个字）
tally s V / untally s             学生拉的每道括号上标出里面 key 的谓语几个，句尾标括号外的几个（V 换成别的成分就数那一种；只写整句）
fold s.3-6 / unfold s.3           折成一个小方块只留主干（别的词滑过去补位；方块上写这一段的成分，也能 fold s.3-6 "从句"；套着折的 unfold 先展开外层）
move s.3 after s.5                挪到别处讲倒装、还原语序（也能 before s.1、-> s.1），别的词让开
cut s.6 / uncut s                 第 6 个词后面断开（意群的斜线）
refer s.3 -> s.2 / unrefer s.3    箭头：which、it 指的是谁（指一段写 s.1-2，指整句写 s）
rewrite s "The man living next door is a doctor."    改写整句：同样的词滑到新位置，新的淡进来
sentence s = "I {t: was holding | am holding | will be holding} it."  句子跟着拨盘 t 变（先 dial t … options=）：一拨就照 rewrite 重排，别的词编号不变、圈着那一整段的括号跟着走；key= 里那一段也写 {t: … | …}；rewrite / move 以后不再跟
sentence v = "It {verb: go on | t | 完成 | 单} for years."  页面拼谓语：{verb: 原形 | 时间 | 状态 | 主语 | 被动 | 否定}，后面的格可以不写（现在、一般、单、主动、肯定）。每格写词，或者一个拨词的拨盘的名字（跟着拨）：时间 过去 现在 将来 过去将来（也能写情态 must can should…），状态 一般 进行 完成 完成进行，主语 I you he she it we they 或 单 / 复。话、贴的字、题卡、answer="{verb: …}" 里也能写。页面只管拼得对（现状写拼的是什么）；该用哪种时态是你教。表里没有的不规则动词照规则变（现状会说），自己给：{verb: 原形/过去式/过去分词 | …}。疑问句的倒装不拼
ask drag s.7 "把 is 挪到句首"         学生按住一个词拖到别处（页面照做，再告诉你）
学生自己拆（mark 页面照 key 判每一下）：
open s mark wrong=mark              学生从一个词拉到另一个词，再点成分（常用的 8 个加 key 里有的，交中文）= mark s.1-6 主语；「从句」对得上 key 里任何一种从句，「定语」对得上定语从句；key 写 [Attr/NF …] 是两种都对；学生拉的括号上有 ✕，点了 = unmark s.1-6（不判）
open s fold                         学生点一道括号或括号里的词 = fold s.3-6，点小方块 = unfold s.3（页面不判；里层折着也能折外层）
open s move                         学生按住一道括号拖到两个词之间 = move s.3-6 after s.9（整段挪；按住一个词挪一个，挪到最前面 = move s.7 before s.1）；mark、fold、move 三种能一起开
open s.3 refer                      学生从 who 右上角的钩上拉线，松在词、括号、句子外框上 = refer s.3 -> s.2 / s.1-2 / s（整句）；造句子时写 links="who -> s.1-2; !who -> door=连到了从句里的名词" 就照它判（! 是常见的错连）；学生连的线头上有 ✕，点了 = unrefer s.3
判断式（when=）：s parsed（key 里每一段都拉对了，多拉的不管）、s exact（拉对了、也没多拉）、s main（主干拉对了）、s span s.2-5 = V（这一段现在挂着这个成分）、s linked（links= 每一条都连对了）；没写 key / links= 判不了，@s.done 也不收；量：verbs(s.4-9) 这一段里 key 的谓语几个（verbs(s) 整句）、left(s) key 里还没拉对的几段
句子里留空位让学生填词：现在没有写法（要填就 ask value … type=en）`,
  // 说明里要先有拨盘的那一条（句子跟着拨盘变）在这个舞台上演（tests/stage-doc.test.js）
  docSetup: 'dial t = 现在 options="过去 现在 将来"',
  example: `sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."
mark s.7 V
mark s.8-9 P
say "谓语是 {s.7}。它前面一长串是主语，里面还套着一个从句。"
open s mark wrong=mark
goal g1 "拉出主语，再拉出主语里的从句" when="s parsed"
@g1 fold s.3-6
@g1 ask tap s "对。折起来只剩主干：主语的核心词是哪个？" expect=s.2`,
};
