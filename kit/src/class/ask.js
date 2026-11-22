// 点着问（docs/board-plan.md 第 5 节）：学生点板上的一行、一个公式、steps 的一步、表格的一行，选「为什么 / 没看懂 / 举个例子」，
// 问题带着精确的位置发给课堂 Claude（它知道指的是哪儿，能直接 mark 出来讲）。
// Claude 可以预写每一步的「为什么」（board why），学生点开时页面当场显示，不调用；还不懂再问它。
// 纯函数，不碰 DOM（tests/class-ask.test.js）。
import { tokenize } from '../tokens.js';

export const ASK_KINDS = {
  why: { label: '为什么', say: '为什么？' },
  lost: { label: '没看懂', say: '这里没看懂。' },
  example: { label: '举个例子', say: '能举个具体的例子吗？' },
};
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,64}$/;

/**
 * board why target=ex-1 的块：一行一条「位置: 为什么」。位置：step=2（steps 的第 2 步）、term=mid（公式里 \hl{mid} 那一项）、
 * all（整段 / 整个组件）。target 是段 id 或组件 id。返回 { op: 'why', target, items: [{ where, text }], errors? } 或 { error }
 */
export function parseWhy(rest, body = '') {
  let target;
  for (const t of tokenize(String(rest ?? ''))) {
    if (t.key === 'target' || t.key === 'id') target = t.value;
    else if (!t.key && target === undefined) target = t.value;
  }
  if (!target) return { error: 'why 缺少 target（段的 id 或组件的 id），比如 why target=ex-1' };
  if (!ID_RE.test(target)) return { error: `why 的 target「${target}」不合法` };
  const items = [];
  const errors = [];
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.trim().replace(/^[-*]\s+/, '');
    if (!line) continue;
    const m = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    const where = m ? parseWhere(m[1]) : null;
    if (!m || !where) { errors.push(`「${line.slice(0, 40)}」：要写成「step=2: 为什么」「term=mid: …」或「all: …」`); continue; }
    items.push({ where, text: m[2].trim() });
  }
  if (!items.length) return { error: errors[0] || 'why 里一条也没写' };
  return { op: 'why', target, items, ...(errors.length ? { errors } : {}) };
}

function parseWhere(src) {
  const s = src.trim();
  if (/^(all|全部|整段)$/i.test(s)) return 'all';
  const m = s.match(/^(step|term)\s*[=＝]\s*([A-Za-z0-9_\-]+)$/i);
  if (!m) return null;
  if (m[1].toLowerCase() === 'step') return /^\d+$/.test(m[2]) && Number(m[2]) >= 1 ? `step=${Number(m[2])}` : null;
  return `term=${m[2]}`;
}

/** 学生点的地方 → 预写的「为什么」：先找这一处（第几步、哪一项），再找整个组件、整段的 all。whys：Map 目标 → [{ where, text }] */
export function matchWhy(whys, spot) {
  if (!whys || !spot) return null;
  const at = spot.step ? `step=${spot.step}` : spot.term ? `term=${spot.term}` : '';
  for (const t of [spot.block, spot.seg].filter(Boolean)) {
    const list = whys.get(t) || [];
    const exact = at && list.find((x) => x.where === at);
    if (exact) return exact.text;
  }
  for (const t of [spot.block, spot.seg].filter(Boolean)) {
    const all = (whys.get(t) || []).find((x) => x.where === 'all');
    if (all) return all.text;
  }
  return null;
}

const short = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/**
 * 学生点的那一处 → 给课堂 Claude 的一行，和它能用的 mark 写法。
 * spot：{ seg, segTitle, block, kind（组件名）, step, stepTitle, term, what（formula / line / row / item / title）, text }
 */
export function spotText(spot) {
  if (!spot) return '';
  const seg = spot.seg ? `${spot.seg}${spot.segTitle ? `「${short(spot.segTitle, 20)}」` : ''}` : '板上';
  const comp = spot.block ? ` 里的 ${spot.kind || '组件'} ${spot.block}` : '';
  const step = spot.step ? ` 第 ${spot.step} 步${spot.stepTitle ? `（${short(spot.stepTitle, 20)}）` : ''}` : '';
  const what = { formula: '公式', line: '这一行', row: '表格这一行', item: '这一条', title: '标题', term: '这一项' }[spot.what] || '';
  const text = spot.text ? `「${short(spot.text, 140)}」` : '';
  return `${seg}${comp}${step}${what && !step ? ` 的${what}` : ''}${text ? `：${text}` : ''}`;
}

/** 要指着讲时它能直接用的 mark 写法 */
export function markHint(spot) {
  if (!spot) return '';
  if (spot.block && spot.item) return `mark target=${spot.block} item=${spot.item}`;
  if (spot.block && spot.step) return `mark target=${spot.block} step=${spot.step}`;
  if (spot.term && spot.seg) return `mark target=${spot.seg} term=${spot.term}`;
  if (spot.block) return `mark target=${spot.block}`;
  return spot.seg ? `mark target=${spot.seg}` : '';
}

/** 发给课堂 Claude 的那条消息（学生打的字不上黑板，这条也一样） */
export function askMessage(spot, kind, extra = '') {
  const k = ASK_KINDS[kind] || ASK_KINDS.why;
  const hint = markHint(spot);
  return `[指着问] ${spotText(spot)}——${k.say}${extra ? ` ${extra}` : ''}${hint ? `（那一处的标法：${hint}）` : ''}`;
}

/** 页面当场显示了预写的「为什么」：跟着下一条一起告诉 Claude（不单独调用） */
export function whyShownText(spot) {
  return `[动作] 学生点开了你预写的「为什么」：${spotText(spot)}`;
}
