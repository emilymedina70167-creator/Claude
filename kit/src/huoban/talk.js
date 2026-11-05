// 一问一答的课（kind: talk，docs/talk-impl.md）里课堂控制器要的小规则：老师那一轮的输出 → 活板的几行、
// 这一轮新冒出来的写法错误、作答记录的编号、给老师看的「活板现状」。纯函数，不碰 DOM（tests/huoban-talk.test.js）。
import { parseOutput } from '../class/protocol.js';
import { Q, isQ } from './values.js';

// 活板在课堂里就是一段 steps：id 固定，md 是整份源码（四个反引号的 huoban 围栏包住）
export const HB_ID = 'hb';
export const hbFence = (src) => `\`\`\`\`huoban\n${String(src ?? '').replace(/\s+$/, '')}\n\`\`\`\``;
/** 段的 md → 活板源码（不是围栏包着的就原样当源码） */
export function hbSource(md) {
  const m = String(md ?? '').match(/^\s*(`{3,}|~{3,})\s*huoban[^\n]*\n([\s\S]*?)\n?\1\s*$/);
  return m ? m[2] : String(md ?? '');
}
/** 源码有几行（applyOps 只往后接、set 只改已有的行，所以行号就是轮次的边界） */
export const lineCount = (src) => (String(src ?? '').trim() ? String(src).replace(/\s+$/, '').split('\n').length : 0);

// 围栏开头 / 结尾：``` 或 ~~~，三个以上
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*(.*)$/;

/**
 * 老师这一轮的输出 → 活板的几行。围栏里的东西都不是活板的行：board 块（memo、plan 照常执行，别的不执行）、
 * 没闭合、看不懂的块原文都去掉；老师顺手用 ```huoban 包起来的几行照收（说明里说了不要包，包了也不为难）。
 * final 为假（边写边显示）时只要写完了的整行，最后一行还在写，先不算。
 * 返回 { lines（活板的行，去掉了空行）, ops（memo / plan，要执行的）, other（写了但不执行的 board 指令名）, notes（给老师的提醒）}
 */
export function talkLines(text, { final = false } = {}) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  let rows = src.split('\n');
  if (!final) rows = rows.slice(0, -1);
  const lines = [];
  const notes = [];
  const odd = new Set();
  let fence = null;
  for (const row of rows) {
    const m = row.match(FENCE);
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && !m[2].trim()) { fence = null; continue; }
      if (fence.keep && row.trim()) lines.push(row.replace(/\s+$/, ''));
      continue;
    }
    if (m) {
      const info = m[2].trim();
      // 一行写完的短指令：````board hide id=b5````
      if (m[1][0] === '`' && /`{3,}\s*$/.test(info)) continue;
      const lang = info.split(/\s+/)[0].toLowerCase();
      fence = { ch: m[1][0], len: m[1].length, keep: lang === 'huoban' || lang === '' };
      if (lang && lang !== 'huoban' && lang !== 'board') odd.add(lang);
      continue;
    }
    if (row.trim()) lines.push(row.replace(/\s+$/, ''));
  }
  const out = parseOutput(src, { final });
  const ops = out.ops.filter((o) => o.op === 'memo' || o.op === 'plan');
  const other = out.ops.filter((o) => o.op !== 'memo' && o.op !== 'plan').map((o) => o.op);
  if (final) {
    if (other.length) notes.push(`一问一答里不写 board 块（这一轮的 ${[...new Set(other)].map((o) => `board ${o}`).join('、')} 没执行），要画、要问就写活板的行。`);
    for (const r of out.rejected) notes.push(`有一个 board 块看不懂（${r.error}），没用：board ${String(r.header).slice(0, 60)}`);
    for (const u of out.unclosed) notes.push(`有一个 board 块没有闭合，没用：board ${String(u.header).slice(0, 60)}`);
    if (odd.size) notes.push(`活板的行不要放进代码围栏（这一轮的 \`\`\`${[...odd].join('、```')} 没用）。`);
  }
  return { lines, ops, other, notes };
}

/**
 * 这一轮新冒出来的写法错误：after 里有、before 里没有的（按「行的文字 + 原因」比，同一行写了两次的照样分得开）。
 * 每一项 { line, msg }
 */
export function newErrors(before = [], after = []) {
  const left = new Map();
  for (const e of before) { const k = errKey(e); left.set(k, (left.get(k) || 0) + 1); }
  const out = [];
  for (const e of after) {
    const k = errKey(e);
    if (left.get(k)) { left.set(k, left.get(k) - 1); continue; }
    out.push(e);
  }
  return out;
}
const errKey = (e) => `${String(e?.line ?? '').trim()}\u0000${String(e?.msg ?? '').replace(/^第 \d+ 行[:：]\s*/, '').trim()}`;

/** 要它整轮重写时的那句提醒 */
export function rewriteText(errs) {
  const list = errs.map((e) => `「${String(e.line || '').slice(0, 120)}」${String(e.msg || '').replace(/^第 \d+ 行[:：]\s*/, '')}`);
  return `这一轮有 ${errs.length} 行看不懂，学生看到的还是上一轮的活板：${list.join('；')}`;
}

// —— 作答记录的编号：第 12 行那一问是 L12；同一行第二个控件 L12.2；上面的数变了、同一个空重新打开再答，算新的一道 L12#2 ——
export function recordId({ n, k = 1, round = 1 } = {}) {
  return `L${n}${k > 1 ? `.${k}` : ''}${round > 1 ? `#${round}` : ''}`;
}
export function parseRecordId(id) {
  const m = String(id ?? '').match(/^L(\d+)(?:\.(\d+))?(?:#(\d+))?$/);
  return m ? { n: Number(m[1]), k: Number(m[2] || 1), round: Number(m[3] || 1) } : null;
}

/**
 * 人读得懂的题面：那一行的话，空写成 □，选择写出选项，活的值写成现在的值。
 * segs：lang.js 的 parseProse；valueOf(seg)：活的值现在的样子（取不到就写表达式）
 */
export function questionText(segs = [], valueOf = null) {
  return segs.map((sg) => {
    if (sg.k === 'text') return sg.v;
    if (sg.k === 'blank') return '□';
    if (sg.k === 'choice') return `（${sg.choices.map((c) => c.t).join(' / ')}）`;
    let v = null;
    try { v = valueOf ? valueOf(sg) : null; } catch { v = null; }
    return v === null || v === undefined || v === '' ? sg.src : String(v);
  }).join('').replace(/\s+/g, ' ').trim();
}

// —— 存进数据库的值：精确分数写成 { $q: 'n/d' }（BigInt 写不进 JSON），数组照样拆开 ——
export function encValue(v) {
  if (isQ(v)) return { $q: v.toString() };
  if (Array.isArray(v)) return v.map(encValue);
  if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return v;
  return null;
}
export function decValue(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.$q === 'string') {
    const [n, d = '1'] = v.$q.split('/');
    try { return new Q(BigInt(n), BigInt(d)); } catch { return null; }
  }
  if (Array.isArray(v)) return v.map(decValue);
  return v;
}

/** 这一轮框上的小字：谁写的、等了几秒 */
export function talkMeta({ ms = 0, mock = false } = {}) {
  const s = Number(ms) > 0 ? ` · ${(Number(ms) / 1000).toFixed(1)} 秒` : '';
  return `${mock ? '模拟老师' : 'Opus 5.5'}${s}`;
}

const q1 = (s, n = 80) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/**
 * 给老师看的「活板现状」（每一轮都在说明的最后一节）：永远不为空。
 * s：{ src, bounds（每一轮写完时有几行）, inputs: [{ name, type, now, init, range }], blanks: [{ id, n, expr, status, val, draft, tries, expected, reopened, prev, visible }],
 *      choices: [{ id, n, options, picked: [{ t, ok }], done }], goals: [{ id, n, msg, done }], finds: [{ name, value }], notes: [...], screen }
 */
export function talkStateText(s = {}) {
  const screen = s.screen ? `\n${s.screen}` : '';
  const src = String(s.src ?? '');
  if (!src.trim()) return `活板还是空的：这一轮写的就是第一问。${screen}`;
  const rows = src.replace(/\s+$/, '').split('\n');
  const bounds = Array.isArray(s.bounds) && s.bounds.length ? s.bounds : [rows.length];
  const out = [`活板上现在的源码（行号 | 内容；你每一轮写的接在后面，set 改的是原来那一行；学生看到的是画出来的样子，当前这一问在最下面）：`];
  let from = 0;
  bounds.forEach((b, i) => {
    const to = Math.min(rows.length, b);
    if (to <= from) { out.push(`第 ${i + 1} 轮：（只改了上面的量，没有新的行）`); return; }
    out.push(`第 ${i + 1} 轮${i === bounds.length - 1 ? '（最近这一轮）' : ''}：`);
    for (let n = from + 1; n <= to; n++) if (rows[n - 1].trim()) out.push(`${String(n).padStart(4)} | ${rows[n - 1]}`);
    from = to;
  });
  if (from < rows.length) for (let n = from + 1; n <= rows.length; n++) if (rows[n - 1].trim()) out.push(`${String(n).padStart(4)} | ${rows[n - 1]}`);

  const inputs = s.inputs || [];
  if (inputs.length) {
    out.push('学生能动的量（现在的值；初值是你写的）：');
    for (const x of inputs) out.push(`- ${x.name}：现在 ${q1(x.now, 60)}${x.now !== x.init ? `（初值 ${q1(x.init, 60)}）` : '（还没动过）'}${x.range ? `，${x.range}` : ''}`);
  }
  const blanks = s.blanks || [];
  if (blanks.length) {
    out.push('空（页面按当时的值判对错；编号就是作答记录里的 L…）：');
    for (const b of blanks) {
      const bits = [];
      if (b.visible === false) bits.push('这一行还没出现（when 的条件没成立）');
      if (b.reopened) bits.push(`数变了，重新打开了${b.prev ? `（之前答的是「${q1(b.prev, 40)}」）` : ''}`);
      if (b.tries) bits.push(`交过 ${b.tries} 次，最后一次「${q1(b.val, 40)}」${b.status === 'ok' ? '对' : '不对'}`);
      else if (!b.reopened) bits.push('还没交');
      if (b.draft) bits.push(`现在写着「${q1(b.draft, 40)}」还没交`);
      bits.push(`页面现在算的答案 ${b.expected === undefined ? '（算不出来）' : q1(b.expected, 60)}`);
      out.push(`- ${b.id}（第 ${b.n} 行 {${b.expr}?}）：${bits.join('；')}`);
    }
  }
  const choices = s.choices || [];
  if (choices.length) {
    out.push('选择：');
    for (const c of choices) {
      const picked = (c.picked || []).map((p) => `「${q1(p.t, 30)}」（${p.ok ? '对' : '不对'}）`);
      out.push(`- ${c.id}（第 ${c.n} 行，${(c.options || []).map((o) => q1(o, 30)).join(' / ')}）：${picked.length ? `选过 ${picked.join('、')}` : '还没选'}`);
    }
  }
  const goals = s.goals || [];
  if (goals.length) {
    out.push('目标：');
    for (const g of goals) out.push(`- ${g.id}（第 ${g.n} 行「${q1(g.msg, 60)}」）：${g.done ? '做到了' : '还没做到'}`);
  }
  const finds = s.finds || [];
  if (finds.length) out.push(`页面替你找的例子：${finds.map((x) => `${x.name} = ${q1(x.value, 80)}`).join('；')}`);
  const notes = (s.notes || []).filter(Boolean);
  if (notes.length) out.push('页面检查的提醒（还没告诉过你的）：', ...notes.map((x) => `- ${x}`));
  if (s.screen) out.push(s.screen);
  return out.join('\n');
}
