// 外部的课里的几条板指令（学习台 dev_requests/dr-ext-control）。纯函数，tests/class-extboard.test.js
//   R7 预备板：board queue id=b5 title="…" after=q-b4:right|done|button —— 块里是那块板第一段的内容，先存着，
//      条件到了页面自己开那块板、翻过去（button：板上方「下一块 →」）。
//   R9 改字不丢作答：board edit id=b3，块里一处或几处 <<<旧 === 新>>>（=== 单独一行），只改那段的文字；
//      原文没变的组件留着学生的作答和草稿。
import { tokenize } from '../tokens.js';

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,64}$/;
export const QUEUE_WHEN = ['right', 'done', 'submit', 'button'];

/** board queue 的开头那行 → { op: 'queue', id, title, after: { target, kinds: [...], button } } 或 { error } */
export function parseQueue(rest = '') {
  let id, title, after;
  for (const t of tokenize(String(rest))) {
    if (t.key === 'id') id = t.value;
    else if (t.key === 'title') title = t.value;
    else if (t.key === 'after') after = t.value;
    else if (!t.key && id === undefined) id = t.value;
  }
  if (!id) return { error: 'queue 缺少 id：board queue id=b5 after=q-b4:right|button' };
  if (!ID_RE.test(id)) return { error: `id「${id}」不合法` };
  if (!after) return { error: 'queue 要写什么时候翻过去：after=题的 id:right|done（答对 / 看完）或 after=button（学生点「下一块」）' };
  let target = '';
  const kinds = [];
  let button = false;
  for (const part of String(after).split('|').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^([^:：]+)[:：](.+)$/);
    const kind = (m ? m[2] : part).toLowerCase();
    if (m) target = m[1];
    if (kind === 'button') { button = true; continue; }
    if (!QUEUE_WHEN.includes(kind)) return { error: `after= 只认 题的 id:${QUEUE_WHEN.filter((k) => k !== 'button').join(' / ')} 和 button，看不懂「${part}」` };
    kinds.push(kind);
  }
  if (kinds.length && !target) return { error: 'after= 的 right / done 要写是哪一题：after=q-b4:right' };
  if (target && !ID_RE.test(target)) return { error: `after= 的题 id「${target}」不合法` };
  return { op: 'queue', id, ...(title !== undefined ? { title: String(title).trim() } : {}), after: { target, kinds, button } };
}

/** 学生这件事（kind 在 target 上）到没到这一块预备板的条件 */
export function queueDue(q, { kind, target } = {}) {
  if (!q || q.opened) return false;
  if (kind === 'button') return !!q.after?.button;
  return !!q.after?.target && String(q.after.target) === String(target) && q.after.kinds.includes(kind);
}

/** board edit 块里的改动：[{ from, to }]；一处也没读出来 { error } */
export function parseEdits(body = '') {
  const src = String(body ?? '').replace(/\r/g, '');
  const out = [];
  const re = /<<<\n?([\s\S]*?)\n?^===[ \t]*$\n?([\s\S]*?)\n?>>>/gm;
  let m;
  while ((m = re.exec(src))) out.push({ from: m[1], to: m[2] });
  if (!out.length) return { error: 'edit 的块里写 <<<旧的字、单独一行 ===、新的字>>>（可以写几处）' };
  const empty = out.find((e) => !e.from);
  if (empty) return { error: '<<< 和 === 之间要写原来的字（要改哪里）' };
  return { edits: out };
}

/** 照改动改一段的 Markdown：每一处的旧字要在这一段里正好出现一次 → { md } 或 { error } */
export function applyEdits(md = '', edits = []) {
  let s = String(md ?? '');
  for (const [i, e] of edits.entries()) {
    const n = s.split(e.from).length - 1;
    if (n !== 1) return { error: `第 ${i + 1} 处：原来的字「${e.from.slice(0, 40)}」在这一段里出现了 ${n} 次（要正好一次；多写几个字把它认准）` };
    s = s.replace(e.from, () => e.to);
  }
  return { md: s };
}

/** 一段里每个组件（写了 id: 的）原文：id → 整块原文。改字以后原文一字没变的组件留着 */
export function componentSources(md = '') {
  const out = new Map();
  const lines = String(md ?? '').split('\n');
  let open = null;
  for (const line of lines) {
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      open.lines.push(line);
      if (f && f[1][0] === open.fence[0] && f[1].length >= open.fence.length && !f[2].trim()) {
        const id = open.lines.join('\n').match(/^\s*id\s*[:：]\s*([\w\-.~:@+]+)\s*$/m)?.[1];
        if (id) out.set(id, open.lines.join('\n'));
        open = null;
      }
    } else if (f && f[2].trim()) open = { fence: f[1], lines: [line] };
  }
  return out;
}

/** 改字前后哪些组件原文没变（留着学生的作答） */
export function keptComponents(before = '', after = '') {
  const a = componentSources(before), b = componentSources(after);
  return [...b.keys()].filter((id) => a.get(id) === b.get(id));
}

/**
 * 预案、「为什么」挂的组件不在黑板上时照实说缘故（2026-11-22：以前一律回「黑板上没有组件 X」，
 * 组件其实写了、只是那一段有写法错误没画出来或藏着，读的人以为 id 写错了）。纯函数。
 * segs：[{ id, md, failed, pending, hidden, error }]；md 是那一段写的原文（没画出来的段用它想写的那份）
 */
export function missingTarget(target, segs = []) {
  const t = String(target ?? '');
  for (const s of segs || []) {
    if (!s || !(s.failed || s.pending || s.hidden) || !componentSources(s.md).has(t)) continue;
    const why = s.error ? `（${s.error}）` : '';
    if (s.failed) return `组件 ${t} 写在 ${s.id} 里，${s.id} 没画出来${why}，预案没挂上`;
    if (s.pending) return `组件 ${t} 写在 ${s.id} 里，${s.id} 有写法错误还没画出来${why}，预案没挂上`;
    return `组件 ${t} 写在 ${s.id} 里，${s.id} 现在藏着，预案没挂上`;
  }
  if ((segs || []).some((s) => String(s?.id) === t)) return `${t} 是段的 id：target 写组件的 id:`;
  return `黑板上没有组件 ${t}`;
}
