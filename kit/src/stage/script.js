// 镜头指令的读法（docs/stage-plan.md）：老师一行写一个动作，页面一行一行演。纯函数，有测试（tests/stage.test.js）。
//
//   array a = 49 38 65 97 76 13 27 49′ 55 04     造一排格子
//   say "{a.1} 往后隔 5 个，碰到 {a.6}"           说一句（{…} 是舞台上的东西，话里的它和图上的它是同一个）
//   hop a.1 -> a.6 label="隔 5 个"                从一格跳到另一格，留下一道弧
//   & paint a.1 a.6 g1                           行首 & ：和上一行一起演
//   ask tap a "{a.2} 和谁一组？"                  停下来等学生点
//
// 部件的写法：a（整个）、a.3（第 3 格，按现在的位置）、a.2-5（第 2 到 5 格）、a#8（一开始在第 8 格的那一个，跟着它走）

/** 认得的指令（写错了页面报出来，不默默忽略） */
export const COMMANDS = new Set([
  'array', 'say', 'glow', 'unglow', 'lift', 'drop', 'paint', 'unpaint', 'link', 'unlink', 'hop', 'swap',
  'group', 'split', 'merge', 'label', 'retext', 'unlabel', 'dial', 'set', 'camera', 'wait', 'ask', 'clear', 'pulse', 'fly',
  'move', 'write', 'compare', 'ptr', 'unptr', 'dim', 'undim', 'cover', 'uncover',
]);

/** 一行拆成记号：字符串（"…" 或 「…」）、箭头、key=value、别的词 */
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
    while (j < s.length && !/\s/.test(s[j]) && s[j] !== '"' && s[j] !== '「' && s[j] !== '“' && !s.startsWith('->', j) && s[j] !== '→') {
      // key="带空格的字"：等号后面紧跟引号时整个吃进来
      if (s[j] === '=' && j > i && (s[j + 1] === '"' || s[j + 1] === '「')) break;
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
    const eq = word.indexOf('=');
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
      out.push({ cmd, args, opts, par, line: k + 1, src: raw });
    } catch (err) {
      out.push({ cmd: null, error: err.message, line: k + 1, src: raw });
    }
  });
  return out;
}

/**
 * 部件的写法 → { obj, kind, lo, hi }：kind 是 all（整个）、slot（按现在的位置，lo..hi）、key（一开始在哪一格的那一个）。
 * 不是部件的写法给 null
 */
export function parseRef(word) {
  const m = String(word ?? '').match(/^([A-Za-z_]\w*)(?:([.#])(\d+)(?:-(\d+))?)?$/);
  if (!m) return null;
  if (!m[2]) return { obj: m[1], kind: 'all' };
  const lo = Number(m[3]), hi = Number(m[4] ?? m[3]);
  return { obj: m[1], kind: m[2] === '.' ? 'slot' : 'key', lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/**
 * 话里的写法拆成一段段：{a.2} 是舞台上的东西（画成和它一样颜色的小块，点了图上那个闪一下）、{d} 是拨的数、
 * $d$ 是式子里的字母、[不稳定] 是能飞到图上去的词。返回 [{ k: 'text' | 'ref' | 'var' | 'math' | 'word', v }]
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
      out.push(r && r.kind !== 'all' ? { k: 'ref', v: inner } : { k: 'var', v: inner });
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
  return parts.reduce((n, p) => n + (p.k === 'ref' ? 2 : String(p.v).length), 0);
}
