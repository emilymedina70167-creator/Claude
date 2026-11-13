// 一段一幕（主线第六轮第 3 节）：从舞台的 log 推出这节课的几幕——每一幕从哪一行到哪一行、叫什么、要点是哪几张重点卡。
// 不另存：log 本来就记着老师写的每一行（scene 和别的指令一样进 log），刷新、只读翻看、下课的报告都照 log 推一遍。纯函数，有测试（tests/stage-scenes.test.js）。
//
// 只认老师写的 scene：老师把台上拿光、接着又造新东西，一节真课里有 21 处，真正的段落只有 7 段上下（审查量过）——
// 页面替老师分会把幕条切碎，分段又是教学判断，所以页面只在舞台现状里说一句事实（swappedLine）。
import { parseScript } from './script.js';

// 这几种行不造东西、不改台上的东西：一幕里只有它们（老师连写两个 scene），这一幕是空的
const BARE = new Set(['scene', 'say', 'ask', 'wait', 'camera']);

/** 一行是不是 scene：{ title, keep: [] }；不是返回 null。照 parseScript 读（「」“” 的引号、开头的 & 和舞台演的时候一样认） */
export function sceneOf(src) {
  if (!/scene/.test(String(src || ''))) return null;
  let c;
  try { [c] = parseScript(String(src)); } catch { return null; }
  if (c?.cmd !== 'scene') return null;
  const title = (c.args || []).find((a) => a.t === 'str')?.v;
  if (title == null) return null;
  const keep = String(c.opts?.keep || '').split(/[\s,，]+/).filter(Boolean);
  return { title: String(title).trim(), keep };
}

const headOf = (src) => String(src || '').trim().replace(/^&\s*/, '').split(/\s+/)[0];

/**
 * log → [{ n, title, start, end, keep, keys }]。start / end 是这一幕第一行、最后一行在 log 里的下标（含）；scene 那一行是新一幕的第一行。
 * 第一幕从第 0 行起，叫 title（课堂给这节课的课名）。keys：这一幕里贴过的重点卡（label … tone=key）的字，同一张改写过取最后一次；
 * unlabel 过的照样留（要点是讲过的，不是还贴着的）。一样东西都没造、也没动过台上的幕（只有 scene、say、ask）并进后一幕
 */
export function sceneSpans(log = [], { title = '开头' } = {}) {
  const raw = [{ title, keep: [], start: 0 }];
  log.forEach((row, i) => {
    const sc = row?.by === 'student' ? null : sceneOf(row?.src);
    if (sc) raw.push({ title: sc.title, keep: sc.keep, start: i });
  });
  const spans = raw.map((s, k) => {
    const end = k + 1 < raw.length ? raw[k + 1].start - 1 : log.length - 1;
    const rows = log.slice(s.start, end + 1);
    const keyMap = new Map();
    let busy = false;
    for (const r of rows) {
      if (!BARE.has(headOf(r?.src))) busy = true;
      if (!/(^|\s)label\s/.test(` ${String(r?.src || '').replace(/^&\s*/, '')}`) || !/tone=key/.test(r.src)) continue;
      const [c] = parseScript(r.src);
      const id = c?.args?.find((a) => a.t === 'word')?.v;
      const text = c?.args?.find((a) => a.t === 'str')?.v;
      if (id && text) { keyMap.delete(id); keyMap.set(id, text); }
    }
    return { title: s.title, keep: s.keep, start: s.start, end, keys: [...keyMap.values()], busy };
  });
  // 空的幕并进后一幕（后一幕的标题、keep 照旧，从空的那一幕的第一行起）；最后一幕空着（刚写了 scene、还没造东西）照样留着：那是现在这一幕
  const out = [];
  for (let k = 0; k < spans.length; k++) {
    const s = spans[k];
    if (!s.busy && k < spans.length - 1) { spans[k + 1].start = s.start; spans[k + 1].keys = [...s.keys, ...spans[k + 1].keys]; continue; }
    out.push(s);
  }
  return out.map(({ busy, ...s }, i) => ({ n: i + 1, ...s }));
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
export const circled = (n) => CIRCLED[n - 1] || `(${n})`;

/** 舞台现状那一行：第 4 幕「过去完成时」（前面：① 一般时 ② 进行时 ③ 现在完成时）；只有一幕不写 */
export function sceneLine(spans = []) {
  if (spans.length < 2) return '';
  const cur = spans.at(-1);
  return `第 ${cur.n} 幕「${cur.title}」（前面：${spans.slice(0, -1).map((s) => `${circled(s.n)} ${s.title}`).join(' ')}）`;
}

/**
 * 老师这一轮把台上的东西全换了、又没写 scene：舞台现状里说一句事实（不替老师分幕，不动台上任何东西）。
 * before：这一轮开头台上东西的 id；after：这一轮演完台上东西的 id；wroteScene：这一轮写没写 scene
 */
export function swappedLine(before = [], after = [], wroteScene = false) {
  if (wroteScene || !before.length || !after.length) return '';
  const was = new Set(before);
  if (after.some((id) => was.has(id))) return '';
  return '台上的东西这一轮全换了（没写 scene：是新的一段就写 scene "标题"，学生才翻得回去）';
}

/** 学生回看过的几幕 → 跟着下一条告诉老师的一句（同一幕看了几次合成一句、秒数加起来） */
export function lookText(looks = []) {
  const by = new Map();
  for (const l of looks) {
    const k = l.n;
    const had = by.get(k);
    if (had) had.ms += l.ms || 0; else by.set(k, { n: l.n, title: l.title, ms: l.ms || 0 });
  }
  if (!by.size) return '';
  return `学生翻回去看了${[...by.values()].map((l) => `第 ${l.n} 幕「${l.title}」（${Math.max(1, Math.round(l.ms / 1000))} 秒）`).join('；')}`;
}
