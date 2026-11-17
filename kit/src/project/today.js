// 首页「今天」（第十四轮任务 14）：今天做什么由项目 Claude 定——它用 write 写 meta/today，页面照着画；
// 没写（或写的不是今天）就只摆事实：到期了几组、要记的几条、留着没做的题、题库几道。页面不替它挑。纯函数。
import { dueList } from '../memory/schema.js';
import { recallToday } from '../memory/recall.js';
import { dueHolds } from '../memory/holds.js';

export const TODAY_KINDS = ['class', 'review', 'drill', 'recall', 'later'];
const ids = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const live = (d) => d && !['void', 'done', 'paused', 'merged'].includes(d.status);

/** 页面数得出的几个数（不挑、不排） */
function counts(data = {}, today) {
  const due = dueList(data.reviews || [], today).filter((x) => x.days <= 0).length;
  const recall = recallToday(data.recall || [], { today }).total;
  const holds = dueHolds((data.sessions || []).filter((s) => s && !s.deleting), today).length;
  const drills = (data.drills || []).filter((d) => live(d) && !d.broken && d.md).length;
  return { due, recall, holds, drills };
}

/** 事实行：{ kind: 'fact', text, row? }（row 是首页原来那一段：点开看全部） */
function factRows(data, today) {
  const c = counts(data, today);
  const rows = [];
  if (c.due) rows.push({ kind: 'fact', text: `到期的复现组 ${c.due} 组`, row: 'today' });
  if (c.recall) rows.push({ kind: 'fact', text: `要记的 ${c.recall} 条到期`, row: 'recall' });
  if (c.holds) rows.push({ kind: 'fact', text: `隔天验：${c.holds} 节课留的题`, row: 'later' });
  if (c.drills) rows.push({ kind: 'fact', text: `题库里能练的 ${c.drills} 道` });
  if (!rows.length) rows.push({ kind: 'fact', text: '今天没有到期的复现、要记的和留着的题' });
  return rows;
}

/**
 * meta：meta/today 那一份（{ date, note, items: [{ kind, why, block?, ids?, label? }] }）；data：首页的数据；today：YYYY-MM-DD。
 * 返回一行一项：Claude 排的 { kind, why, label, ids?, block? }、它写的话 { kind: 'note', text }、事实 { kind: 'fact', text, row? }
 */
export function todayRows(meta, data = {}, today) {
  const out = [];
  if (meta && meta.date === today && Array.isArray(meta.items)) {
    if (str(meta.note, 600)) out.push({ kind: 'note', text: str(meta.note, 600) });
    const rev = new Map((data.reviews || []).map((r) => [String(r.id), r]));
    const blk = new Map((data.curriculum || []).map((b) => [String(b.id), b]));
    for (const it of meta.items) {
      const kind = String(it?.kind || '');
      if (!TODAY_KINDS.includes(kind)) continue;
      const row = { kind, why: str(it.why), label: str(it.label, 80) };
      if (kind === 'review' || kind === 'drill') {
        row.ids = ids(it.ids);
        if (!row.ids.length) continue;
        if (!row.label) row.label = kind === 'review' ? row.ids.map((x) => rev.get(x)?.title || x).join('、') : `练 ${row.ids.length} 道`;
        // 练一练做完算进哪几组复现（结果写到那几组上）
        if (kind === 'drill' && ids(it.reviews).length) row.reviews = ids(it.reviews);
      }
      if (kind === 'class') {
        row.block = str(it.block, 40);
        if (!row.block) continue;
        if (!row.label) row.label = blk.get(row.block)?.title || row.block;
      }
      if (kind === 'recall' && !row.label) row.label = '要记的';
      if (kind === 'later' && !row.label) row.label = '验上次学的';
      out.push(row);
    }
  }
  return [...out, ...factRows(data, today)];
}

/** 给项目 Claude 的事实（放进「学习台里有什么」）：首页照哪里画、现在的几个数、复现到期和掌握参考在哪 */
export function todayFacts(data = {}, today) {
  const c = counts(data, today);
  return [
    `- 首页「今天」：照 meta/today 画（{ date: 'YYYY-MM-DD', note, items: [{ kind: ${TODAY_KINDS.join(' | ')}, why, label, block（class 开这一块的课）, ids（review 是复现组编号、drill 是题库编号）, reviews（drill 做完的结果记到哪几组复现上） }] }）；date 不是今天时首页只列事实。`,
    `  现在：到期的复现组 ${c.due} 组、要记的 ${c.recall} 条到期、隔天验 ${c.holds} 节课留的题、题库里能练的 ${c.drills} 道（写进 drills 的题页面先画一遍，画不出来的标 broken，练一练不挑）。`,
    '- 复现组写了 due（YYYY-MM-DD）首页按它算到期；那天以后做过了（last 不早于 due）或没写，按 last + tier。页面按作答算的掌握参考在 meta/mastery-calc（mastery 本身页面不改）。',
  ].join('\n');
}

/** 开某一块的课时备好的资料包能不能用：没指定块、或者资料包就是这一块的才用（Claude 在「今天」里排的别的块不借用） */
export function packForBlock(pack, block) {
  if (!block || !pack?.main || String(pack.main.block || '') === String(block)) return pack;
  return { main: null, problems: null };
}
