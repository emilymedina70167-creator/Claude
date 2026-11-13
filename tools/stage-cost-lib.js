// 舞台主线的尺子（docs/superpowers/specs/2026-11-11-stage-mainline-1-design.md 第 2 节）：老师一轮写的字里，
// 多少是在「教」（说、问、交给学生、例子、指给学生看、自己演），多少是在「搭」（藏着的辅助、收拾、同名重造）。
// 回话的时间基本就是写字的时间，搭的字就是白等的时间。照表机械地分，不猜意图：要的是能反复量、前后能比。
// 纯函数，不开浏览器、不调用 Claude。脚本在 tools/stage-cost.mjs（试演文件）、tools/stage-lesson.mjs（真课）。

const bytes = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');

/** 造东西的指令：看得见的是「例子」，带 hide=on 的是「藏着的辅助」，重造已有的名字是「同名重造」 */
export const MAKERS = new Set(['array', 'tree', 'graph', 'matrix', 'product', 'plane', 'sentence', 'tex', 'card', 'table', 'timeline', 'stand', 'bar', 'event', 'vec', 'point', 'sum']);
// 平面里的箭头、点、和：名字是「平面.名字」（vec p v = 1 0）
const IN_PLANE = new Set(['vec', 'point', 'sum']);

const TALK = ['say', 'ask'];
const HAND = ['open', 'close', 'goal', 'watch', 'follow', 'keep', 'back', 'pick', 'unpick', 'press'];
const TIDY = ['remove', 'clear', 'ungoal', 'hide', 'scene', 'erase'];
// 第八轮的构图：摆哪、先看一眼，都是搭
const LAYOUT = ['place', 'preview', 'pos', 'style', 'look', 'arrange', 'scale'];
const SHOW = [
  'draw', 'glow', 'lift', 'drop', 'paint', 'link', 'pulse', 'label', 'retext', 'camera', 'wait', 'fly', 'dim', 'cover', 'uncover', 'show', 'compare', 'dial', 'set',
  'hop', 'ptr', 'group', 'pivot', 'stairs', 'tag', 'bf', 'heights', 'deg', 'mark', 'tally', 'magnify', 'strike', 'span', 'visit', 'choose', 'search', 'tick', 'cross',
];
const ACT = [
  'swap', 'move', 'write', 'split', 'merge', 'insert', 'append', 'delete', 'rotate', 'walk', 'traverse', 'relax', 'take',
  'rowop', 'mul', 'put', 'transform', 'untransform', 'fold', 'unfold', 'cut', 'refer', 'rewrite', 'retex', 'next', 'addline', 'addrow',
];
// un 开头的都是收拾，除了上面点了名的（uncover 是揭开、unfold 是展开、untransform 是变回去：都是演给学生看的）
const UNDO = [
  'unglow', 'unpaint', 'unlink', 'unlabel', 'undim', 'unptr', 'unpivot', 'unstairs', 'untag', 'unbf', 'unheights', 'undeg', 'unvisit', 'unchoose', 'untick',
  'unmark', 'untally', 'uncut', 'unrefer', 'unsum', 'unvec', 'unspan', 'unmagnify', 'unstrike',
];
/** 指令 → 类。kit/src/stage 认得的每一条都要在（tests/stage-cost.test.js 守着） */
export const CLASS_OF = Object.fromEntries([
  ...TALK.map((c) => [c, '说问']), ...HAND.map((c) => [c, '交给学生']), ...SHOW.map((c) => [c, '指给学生看']),
  ...ACT.map((c) => [c, '老师演']), ...TIDY.map((c) => [c, '收拾']), ...UNDO.map((c) => [c, '收拾']),
  ...LAYOUT.map((c) => [c, '摆']),
]);
/** 算「搭」的类 */
export const BUILD = new Set(['藏着的辅助', '收拾', '同名重造', '摆']);

// 一行拆成：前面的 & 和 @名字、指令、后面的
function headOf(src) {
  let s = String(src ?? '').trim();
  if (s.startsWith('&')) s = s.slice(1).trim();
  let on = null;
  const m = s.match(/^@(\S+)\s+(.*)$/);
  if (m) { on = m[1]; s = m[2].trim(); }
  const cmd = s.match(/^[A-Za-z]+/)?.[0] || '';
  return { on, cmd, rest: s.slice(cmd.length).trim(), text: s };
}
// 造的是哪个名字（array a = …、vec p v = …）；不是造东西的行是 null
function madeName(cmd, rest) {
  if (!MAKERS.has(cmd)) return null;
  const w = rest.split(/\s+/);
  if (IN_PLANE.has(cmd)) return w[0] && w[1] && w[2] === '=' ? `${w[0]}.${w[1]}` : null;
  return w[0] && /^[A-Za-z_]\w*$/.test(w[0]) ? w[0] : null;
}
// 这一行 {…} 里用到的函数和运算（排好序、不重复）：藏着的辅助在算什么
function usesOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const e = m[1];
    for (const f of e.matchAll(/\b([a-zA-Z]+)\s*\(/g)) out.add(f[1]);
    if (/\^\s*-\s*1/.test(e)) out.add('^-1');
    if (/\^\s*T\b|'/.test(e)) out.add('转置');
    const bare = e.replace(/\b[a-zA-Z]+\s*\(/g, '(');
    if (/[*·×]/.test(bare) || /[\w)'](?:\^-?\w+)?\s+[A-Za-z_(]/.test(bare)) out.add('乘');
    if (/[\w)]\s*[+−-]\s*[\w(]/.test(bare)) out.add('加减');
  }
  return [...out].sort();
}
// 写死的数：话、贴的字、题卡里有阿拉伯数字，而这一行没有 {…}（页面算得出的数也许被手写了；只标疑似）
const QUOTED = new Set(['say', 'label', 'retext', 'card']);
const hasLiteral = (cmd, text) => QUOTED.has(cmd) && !text.includes('{') && [...text.matchAll(/"([^"]*)"/g)].some((m) => /\d/.test(m[1]));

/**
 * 一轮老师的行 → 每行 { line, src, cmd, on, cls, build, bytes, suspect, uses }。
 * names：到这一轮为止造过的名字（这里往上加：下一轮接着用同一个 Set）
 */
export function classifyRound(lines = [], names = new Set()) {
  return lines.map(({ line, src }) => {
    const h = headOf(src);
    const made = madeName(h.cmd, h.rest);
    let cls;
    if (MAKERS.has(h.cmd)) {
      cls = /\bhide=on\b/.test(h.rest) ? '藏着的辅助' : made && names.has(made) ? '同名重造' : '例子';
      if (made) names.add(made);
    } else cls = CLASS_OF[h.cmd] || '没归类';
    return { line, src: String(src).trim(), cmd: h.cmd, on: h.on, cls, build: BUILD.has(cls), bytes: bytes(String(src).trim()), suspect: hasLiteral(h.cmd, h.text), uses: usesOf(h.text) };
  });
}

/** 试演文件的文字 → { rounds }：一轮 = 两个学生动作之间老师的行（# 注释、空行不算；行号是文件里的行号） */
export function costOfTry(text) {
  const rounds = [];
  const names = new Set();
  let cur = [];
  const flush = () => { if (cur.length) rounds.push(classifyRound(cur, names)); cur = []; };
  String(text ?? '').split('\n').forEach((raw, i) => {
    const s = raw.trim();
    if (!s || s.startsWith('#')) return;
    if (/^学生\s*[:：]/.test(s)) { flush(); return; }
    cur.push({ line: i + 1, src: s });
  });
  flush();
  return { rounds };
}

/** 合计：{ rounds, lines, bytes, build: { lines, bytes }, share（搭占几成，按字节）, byClass, suspects } */
export function sumCost(rounds = []) {
  const rows = rounds.flat();
  const byClass = {};
  for (const r of rows) { const c = (byClass[r.cls] ||= { n: 0, bytes: 0 }); c.n++; c.bytes += r.bytes; }
  const total = rows.reduce((n, r) => n + r.bytes, 0);
  const built = rows.filter((r) => r.build);
  const b = built.reduce((n, r) => n + r.bytes, 0);
  return { rounds: rounds.length, lines: rows.length, bytes: total, build: { lines: built.length, bytes: b }, share: total ? b / total : 0, byClass, suspects: rows.filter((r) => r.suspect).length };
}

const patternOf = (r) => `${r.cls}·${r.cmd}${r.cls === '藏着的辅助' && r.uses.length ? `（${r.uses.join('、')}）` : ''}`;
/** 搭的写法排行榜：[{ pattern, n, bytes, examples: [{ file, line, src }]（最多 3 个） }]，按字节从大到小 */
export function rankBuild(files = []) {
  const map = new Map();
  for (const { file, rounds } of files) for (const r of rounds.flat()) {
    if (!r.build) continue;
    const p = patternOf(r);
    const it = map.get(p) || { pattern: p, n: 0, bytes: 0, examples: [] };
    it.n++; it.bytes += r.bytes;
    if (it.examples.length < 3) it.examples.push({ file, line: r.line, src: r.src });
    map.set(p, it);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes || b.n - a.n);
}

// —— 读一节真课（tools/stage-lesson.mjs）：学习台里舞台课每一轮存着的 class_turns ——
// 老师的一轮 { role: 'claude', text（原样）, cost: { bytes, ms, first } }，学生的一轮 { role: 'student', msg（发给老师的整条） }
// （kit/src/stage/classroom.js 开头）。老师没演上的行在下一条学生的 msg 里「[上一轮没演的行]」那一段。

/** ask value 的 type（和 kit/src/stage/answer.js 的 ANSWER_TYPES 同一份，测试守着） */
export const VALUE_TYPES = ['num', 'formula', 'matrix', 'set', 'equation', 'seq', 'en'];
const MEASURES = ['count', 'height', 'tray', 'rank', 'rankA', 'free', 'det', 'verbs', 'left'];
const lineOf = (cmd) => new RegExp(`^[ \\t]*(?:&[ \\t]*)?(?:@\\S+[ \\t]+)?${cmd}\\b`, 'gm');
/** 说明里的每一种写法：[{ name, re }]（re 带 g，数次数用） */
export const FEATURES = [
  ...[...new Set([...Object.keys(CLASS_OF), ...MAKERS])].map((c) => ({ name: c, re: lineOf(c) })),
  ...['tap', 'drag', 'pick', 'next', 'say', 'value'].map((k) => ({ name: `ask ${k}`, re: lineOf(`ask[ \\t]+${k}`) })),
  ...VALUE_TYPES.map((t) => ({ name: `ask value type=${t}`, re: new RegExp(`\\bask[ \\t]+value\\b.*\\btype=${t}\\b`, 'g') })),
  ...['wrong', 'call', 'undo'].map((k) => ({ name: `open ${k}=`, re: new RegExp(`\\bopen\\b.*\\b${k}=`, 'g') })),
  { name: 'goal collect=', re: /\bgoal\b.*\bcollect=/g },
  { name: '@挑战', re: /^[ \t]*(?:&[ \t]*)?@[A-Za-z_]\w*[ \t]/gm },
  { name: '@名字.done', re: /^[ \t]*(?:&[ \t]*)?@[A-Za-z_]\w*\.done\b/gm },
  { name: '@名字.right', re: /^[ \t]*(?:&[ \t]*)?@(?!ask\.)[A-Za-z_]\w*\.right\b/gm },
  { name: '@ask.right', re: /^[ \t]*(?:&[ \t]*)?@ask\.right\b/gm },
  { name: '{式子}', re: /\{[^{}\n]+\}/g },
  { name: 'hide=on', re: /\bhide=on\b/g },
  { name: '& 一起演', re: /^[ \t]*&/gm },
  ...MEASURES.map((m) => ({ name: `${m}(`, re: new RegExp(`\\b${m}\\(`, 'g') })),
];

/** 老师每一轮的原文 → { used: { 写法: 次数 }, unused: [一次没碰的写法] } */
export function featureUse(texts = []) {
  const all = texts.join('\n');
  const used = {};
  const unused = [];
  for (const f of FEATURES) { const n = (all.match(f.re) || []).length; if (n) used[f.name] = n; else unused.push(f.name); }
  return { used, unused };
}

// 老师一轮的原文里是镜头指令的行（```board memo``` 这样的块是记给学习台的，不算）
function stageLinesOf(text) {
  const out = [];
  let fence = false;
  String(text ?? '').split('\n').forEach((raw, i) => {
    const s = raw.trim();
    if (s.startsWith('```')) { fence = !fence; return; }
    if (fence || !s) return;
    out.push({ line: i + 1, src: s });
  });
  return out;
}
// 学生那一条里「[上一轮没演的行]」一段 → [{ src, error }]
function missedOf(msg) {
  const m = String(msg ?? '').match(/\[上一轮没演的行\][^\n]*\n((?:- .*\n?)+)/);
  if (!m) return [];
  return m[1].split('\n').filter(Boolean).map((l) => { const x = l.match(/^- 第 \d+ 行「(.*)」：(.*)$/); return x ? { src: x[1], error: x[2] } : { src: '', error: l.replace(/^- /, '') }; });
}
const HANDS_RE = /^[ \t]*(?:&[ \t]*)?(?:open|goal|ask[ \t]+(?:tap|drag|pick|value))\b/m;

/**
 * 一节课的 class_turns（照 seq 排好）→
 *   { turns: [{ seq, lines, played, missed: [{ src, error }], bytes, build（搭的字节）, ms, first, hands }],
 *     total: sumCost 的合计 + { missed, ms, first }, features: featureUse 的结果, talkRuns: 最长连着几轮学生手上没事 }
 * 作废的轮（discarded）、不是老师的轮不算。hands：这一轮老师交了事给学生（open、goal、要点要拖要填的问）；只有话和「接着」是 false
 */
export function lessonCost(turns = []) {
  const names = new Set();
  const out = [];
  const rounds = [];
  let last = null;
  for (const t of turns) {
    if (t.role === 'student') { if (last) { last.missed = missedOf(t.msg || t.text); last.played = last.lines - last.missed.length; last = null; } continue; }
    if (t.role !== 'claude' || t.discarded) continue;
    const rows = classifyRound(stageLinesOf(t.text), names);
    rounds.push(rows);
    const s = sumCost([rows]);
    last = { seq: t.seq, lines: rows.length, played: rows.length, missed: [], bytes: s.bytes, build: s.build.bytes, ms: t.cost?.ms ?? null, first: t.cost?.first ?? null, hands: HANDS_RE.test(String(t.text ?? '')) };
    out.push(last);
  }
  const add = (k) => out.reduce((n, t) => n + (t[k] || 0), 0);
  let run = 0;
  let talkRuns = 0;
  for (const t of out) { run = t.hands ? 0 : run + 1; talkRuns = Math.max(talkRuns, run); }
  return { turns: out, total: { ...sumCost(rounds), missed: out.reduce((n, t) => n + t.missed.length, 0), ms: add('ms'), first: add('first') }, features: featureUse(turns.filter((t) => t.role === 'claude' && !t.discarded).map((t) => t.text || '')), talkRuns };
}
