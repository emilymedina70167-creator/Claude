// 镜头指令的读法（docs/stage-plan.md）：老师一行写一个动作，页面一行一行演。纯函数，有测试（tests/stage.test.js）。
//
//   array a = 49 38 65 97 76 13 27 49′ 55 04     造一排格子
//   say "{a.1} 往后隔 5 个，碰到 {a.6}"           说一句（{…} 是舞台上的东西，话里的它和图上的它是同一个）
//   hop a.1 -> a.6 label="隔 5 个"                从一格跳到另一格，留下一道弧
//   & paint a.1 a.6 g1                           行首 & ：和上一行一起演
//   ask tap a "{a.2} 和谁一组？"                  停下来等学生点
//
// 部件的写法：a（整个）、a.3（第 3 格，按现在的位置）、a.2-5（第 2 到 5 格）、a#8（一开始在第 8 格的那一个，跟着它走）
import { parseMeasure } from './rules.js';
import { isExactFunc } from '../exact.js';

/** 认得的指令（写错了页面报出来，不默默忽略）。这里是各种东西共用的；每种东西自己的指令（swap、insert、rowop……）由 types/ 注册进来 */
export const COMMANDS = new Set([
  'say', 'glow', 'unglow', 'lift', 'drop', 'paint', 'unpaint', 'link', 'unlink', 'pulse', 'compare',
  'label', 'retext', 'unlabel', 'dial', 'set', 'camera', 'wait', 'ask', 'clear', 'fly', 'remove',
  'dim', 'undim', 'cover', 'uncover',
  'open', 'close', 'goal', 'ungoal', 'hide', 'show', 'pick', 'unpick', 'keep', 'back', 'press',
]);
export function addCommands(list) { for (const c of list) COMMANDS.add(c); }

/**
 * 每条共用的指令认得的选项（名字=值）：写了不认得的当场报（最后一审 I4：hid=on、reveel=on、afer=insert 以前默默当没写，
 * 要藏的答案矩阵直接摆给学生看）。ask 按第几种分（ask tap 写 answer= 也是没用上）。各种东西自己的指令、造它的那一行
 * 在 types/ 的 options 里（造东西都认 hide=）。重放旧课（lenient）照收不报。改了指令认的选项，这里（或 types/ 的 options）跟着改
 */
export const OPTIONS = {
  label: ['side', 'tone'], fly: ['side'], dial: ['range', 'at'], pick: ['reveal'], keep: ['after'],
  open: ['back', 'wrong', 'call', 'undo', 'input', 'range'],
  goal: ['when', 'call', 'on', 'collect', 'n'],
  ask: {
    tap: ['expect', 'button'], drag: ['expect', 'button'], pick: ['expect', 'reveal', 'button'], next: ['button'], say: ['button'],
    value: ['answer', 'type', 'wrong', 'free', 'solve', 'button'],
  },
};
// 两个名字差几个字母（交换挨着的两个字母算一下）
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
/** 写错的选项名最像认得的哪一个（hid → hide、lay → layout、tpye → type）：少打了后半截的、差一两个字母的；都不像是 null */
export function optionNear(name, names) {
  const w = String(name).toLowerCase();
  const plain = names.filter((n) => typeof n === 'string');
  const pre = plain.find((n) => w.length >= 2 && n.startsWith(w));
  if (pre) return pre;
  let best = null, bestD = Infinity;
  for (const n of plain) {
    const dd = editDistance(w, n);
    if (dd < bestD && dd <= (n.length >= 4 ? 2 : 1)) { best = n; bestD = dd; }
  }
  return best;
}
/** 一行里不认得的选项写给老师的话：「hid=on」不是 matrix 认的写法：是不是 hide=on？（matrix 能写的：beside= vars= from= hide=） */
export function optionError(label, key, value, names) {
  const near = optionNear(key, names);
  const plain = names.filter((n) => typeof n === 'string');
  const can = plain.length ? `（${label} 能写的：${plain.map((n) => `${n}=`).join(' ')}）` : `（${label} 不写 名字=值）`;
  return `「${key}=${value}」不是 ${label} 认的写法${near ? `：是不是 ${near}=${value}？` : ''}${can}`;
}

/** s[at] 是 {：和它配对的 } 后面那一格（套着的也数着配）；没收尾就抛错，话直接给老师看 */
function braceEnd(s, at) {
  let depth = 0;
  for (let k = at; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}' && --depth === 0) return k + 1;
  }
  throw new Error(`「${s.slice(at, at + 16)}${s.length - at > 16 ? '…' : ''}」的 { 没有收尾：式子写在一对 {} 里（里面能带空格，比如 {A + B}）`);
}

/** 一行拆成记号：字符串（"…" 或 「…」）、箭头、key=value、别的词（{式子} 连同里面的空格算一个词） */
export function tokenize(line) {
  const out = [];
  let i = 0;
  const s = String(line);
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"' || ch === '「' || ch === '“') {
      const close = ch === '"' ? '"' : ch === '「' ? '」' : '”';
      const j = s.indexOf(close, i + 1);
      if (j < 0) throw new Error(`引号没有收尾：${s.slice(i, i + 20)}`);
      out.push({ t: 'str', v: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (s.startsWith('->', i) || ch === '→') { out.push({ t: 'arrow' }); i += ch === '→' ? 1 : 2; continue; }
    let j = i;
    // 花括号外面的第一个 =：选项只在这里切。{k >= 1}、{k == 2} 里的 = 是式子的一部分（以前照整个词里第一个 = 切，
    // array vis = {k >= 1} … 的那一格成了名字是「{k >」的选项：matrix 默默丢一格，查选项名以后 array、tree 报「不是认的写法」，复审 N1）
    let eqAt = -1;
    while (j < s.length && !/\s/.test(s[j]) && s[j] !== '"' && s[j] !== '「' && s[j] !== '“' && !s.startsWith('->', j) && s[j] !== '→') {
      // key="带空格的字"：等号后面紧跟引号时整个吃进来
      if (s[j] === '=' && j > i && (s[j + 1] === '"' || s[j + 1] === '「')) break;
      // {式子}（value.js）：配对的一对 {} 整个留在这个词里，里面能带空格（answer={A + B}、vec p w = {A v}、A-B:{k + 1}）
      if (s[j] === '{') { j = braceEnd(s, j); continue; }
      if (s[j] === '}') throw new Error(`多了一个 }：「${s.slice(i, j + 1)}」（式子写在一对 {} 里）`);
      if (s[j] === '=' && eqAt < 0) eqAt = j - i;
      j++;
    }
    const word = s.slice(i, j);
    if (s[j] === '=' && (s[j + 1] === '"' || s[j + 1] === '「')) {
      const open = s[j + 1], close = open === '"' ? '"' : '」';
      const k = s.indexOf(close, j + 2);
      if (k < 0) throw new Error(`引号没有收尾：${s.slice(j, j + 20)}`);
      out.push({ t: 'opt', k: word, v: s.slice(j + 2, k) });
      i = k + 1;
      continue;
    }
    const eq = eqAt;
    if (eq > 0 && eq < word.length - 1) out.push({ t: 'opt', k: word.slice(0, eq), v: word.slice(eq + 1) });
    else if (word === '=') out.push({ t: 'eq' });
    else out.push({ t: 'word', v: word });
    i = j;
  }
  return out;
}

/**
 * 一段镜头指令 → 一条条指令 { cmd, args, opts, par, line }。args 里是记号（字符串、词、箭头），opts 是 key=value。
 * 空行和 # 开头的行跳过。读不懂的行不抛错，记成 { cmd: null, error }，让页面报给老师
 */
export function parseScript(src) {
  const out = [];
  String(src ?? '').split('\n').forEach((raw, k) => {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    // @g1 开头：挑战 g1 做到了的那一刻页面马上演的行（先记着，不演）；@t.done / @t.right：t 做完了、学生做对一步时（scene.js 的 stash 再查后半截）
    let on = null;
    const at = line.match(/^@([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s+(.+)$/);
    const body = at ? at[2].trim() : null;
    if (at) { on = at[1]; line = body; } else if (line.startsWith('@')) { out.push({ cmd: null, error: '要写成 @挑战的名字 一行指令（比如 @g1 say "对！"），或 @东西.done / @东西.right 一行指令', line: k + 1, src: raw }); return; }
    let par = false;
    if (line.startsWith('&')) { par = true; line = line.slice(1).trim(); }
    try {
      const toks = tokenize(line);
      const head = toks.shift();
      if (!head || head.t !== 'word') throw new Error('一行要以指令开头');
      const cmd = head.v.toLowerCase();
      if (!COMMANDS.has(cmd)) throw new Error(`没有「${head.v}」这个指令`);
      const opts = {};
      const args = [];
      for (const t of toks) if (t.t === 'opt') opts[t.k] = t.v; else args.push(t);
      // lead：紧跟指令的那个词是 名字=值（matrix A=1 2 的「A=1」）。等号两边没空格时页面把名字读成了选项，
      // 查选项名的地方（scene.js 的 checkOptions）照它说「= 两边要空格」（复审 N5）
      const lead = toks[0]?.t === 'opt' ? toks[0].k : null;
      out.push({ cmd, args, opts, par, line: k + 1, src: raw, ...(on ? { on, body } : {}), ...(lead != null ? { lead } : {}) });
    } catch (err) {
      out.push({ cmd: null, error: err.message, line: k + 1, src: raw });
    }
  });
  return out;
}

/**
 * 部件的写法 → { obj, mark, sel }：a（整个，mark 是 null）、a.3 / t.A / m.2,3（mark 是 '.'）、a#8（mark 是 '#'）。
 * sel 怎么读由那种东西自己定（types/）；sel 是数或「数-数」时顺带给 kind / lo / hi（一排格子用：slot 按现在的位置、key 按一开始的位置）。
 * 不是部件的写法给 null
 */
export function parseRef(word) {
  const m = String(word ?? '').match(/^([A-Za-z_]\w*)(?:([.#])([^\s{}"「」]+))?$/);
  if (!m) return null;
  if (!m[2]) return { obj: m[1], mark: null, sel: null, kind: 'all' };
  const out = { obj: m[1], mark: m[2], sel: m[3] };
  const n = m[3].match(/^(\d+)(?:-(\d+))?$/);
  if (n) {
    const lo = Number(n[1]), hi = Number(n[2] ?? n[1]);
    Object.assign(out, { kind: m[2] === '.' ? 'slot' : 'key', lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
  }
  return out;
}

// 引号里的字（话、贴的字、挑战、问题、题卡）里也当量的 exact.js 函数名：量名里撞上 exact.js 函数的就这两个（tests/stage-value.test.js 守着）。
// 引号外面（answer=、格里、when=）照旧：value.js 的 evalLive 把 {det(A)}、{rank(M)} 交给 exact.js（写满时两边算的一样）。
// 有意的不同（Task 15 复核，控制者裁定）：旧课引号里写过 {det(A)} 的，重放时画成数，以前照原样写「det(A)」
export const RICH_MEASURES = new Set(['rank', 'det']);

/**
 * 话里的写法拆成一段段：{a.2} 是舞台上的东西（画成和它一样颜色的小块，点了图上那个闪一下）、{d} 是拨的数、
 * {count(t)} 是页面数的量（画成现在的数，跟着变；数不了画「?」）、$d$ 是式子里的字母、[不稳定] 是能飞到图上去的词。
 * 返回 [{ k: 'text' | 'ref' | 'var' | 'measure' | 'math' | 'word', v }]
 */
export function parseRich(text) {
  const out = [];
  const s = String(text ?? '');
  const re = /\{([^{}]+)\}|\$([^$]+)\$|\[([^\]]+)\]/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ k: 'text', v: s.slice(last, m.index) });
    if (m[1] != null) {
      const inner = m[1].trim();
      const r = parseRef(inner);
      // 量：名字(东西或部件)。名字是 exact.js 本来就有的函数的不算（{inv(A)} 照旧是式子），只有 rank、det 例外（RICH_MEASURES）：
      // 引号里没有 exact.js 现算，以前它们落成拨数的名字，学生看到的是「rank(M)」几个字母。
      // 这里看不到舞台：括号里的东西在不在、名字是不是它的量，场景写下这一行时查（scene.js 的 checkRich）
      const ms = !r && parseMeasure(inner);
      // v 照原样（连空格）：不是量的（旧课的 {f(x)}）画回原来的字
      if (ms && (!isExactFunc(ms.name) || RICH_MEASURES.has(ms.name)) && parseRef(ms.arg)) out.push({ k: 'measure', v: inner });
      else out.push(r && r.kind !== 'all' ? { k: 'ref', v: inner } : { k: 'var', v: inner });
    }
    else if (m[2] != null) out.push({ k: 'math', v: m[2] });
    else out.push({ k: 'word', v: m[3] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ k: 'text', v: s.slice(last) });
  return out;
}

/** 话里一共几个字（出字动画、留多久给人读按它算） */
export function richLength(parts) {
  return parts.reduce((n, p) => n + (p.k === 'ref' || p.k === 'measure' ? 2 : String(p.v).length), 0);
}
