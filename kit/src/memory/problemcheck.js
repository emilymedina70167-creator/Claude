// 验题（第十四轮从 memory/lab.js、labdesk.js 抽出来；教研室的单子搬进了 archive/）：一段「=== 题 1」写法的题读成题库的条目、
// 先看写法（不碰 DOM）、再在页面上藏着画一遍。项目 Claude 往题库写题、首页验留着的题都用它。
import { fencesOf, withId } from './drills.js';
import { similarity } from './memo.js';
import { spaceOfId } from './space.js';
import { isCS, isEN } from '../subject.js';

const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const enc = new TextEncoder();
const bytesOf = (s) => enc.encode(String(s ?? '')).length;

/**
 * 读出新题的回答：[{ n, why, md, kind, fences }]；problems：整体的问题。
 * 每道题的组件编号换成题库编号 d-lab-{单子}-{第几题}（再出一次同一张单子会盖掉同一个编号，不会越堆越多）
 */
// batch：这一份回答的时间（题号里带着，下一次再给同一组出题不会盖掉上一批：做过的题要留着算原题）
export function parseProblems(text, { brief = '', block = null, target = {}, at = Date.now(), batch = at } = {}) {
  // 段头「=== 题 2」后面可以跟几个字（「=== 题 2：难一点」）
  const parts = String(text ?? '').replace(/\r\n?/g, '\n').split(/^===\s*题\s*(\d+)[^\n]*$/m);
  const out = [];
  const problems = [];
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    const body = parts[i + 1] || '';
    const why = body.match(/^\s*针对\s*[:：]\s*(.+)$/m)?.[1]?.trim() || '';
    const type = body.match(/^\s*类型\s*[:：]\s*(同类|迁移)\s*$/m)?.[1];
    const fences = fencesOf(body);
    const lets = fences.filter((f) => f.lang === 'let');
    const main = fences.filter((f) => f.lang !== 'let');
    if (!main.length) { problems.push(`题 ${n}：没有组件`); continue; }
    if (main.length > 1) problems.push(`题 ${n}：一段里有 ${main.length} 个组件，只收第一个`);
    const id = `d-lab-${brief}-${Number(batch).toString(36)}-${n}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
    const md = [...lets.map((f) => f.raw), withId(main[0], id)].join('\n\n');
    const sp = block ? spaceOfId(String(block)) : '';
    out.push({
      id, n, why, ...(type ? { far: type === '迁移' } : {}), kind: main[0].lang,
      doc: {
        block, kind: main[0].lang, md, q: cut(why, 160), title: cut(target.title || '', 80), src: 'lab', by: 'lab',
        ...(target.kind === 'review' ? { review: String(target.id) } : target.kind === 'weakness' ? { weakness: String(target.id) } : {}),
        ...(sp ? { space: sp } : {}), status: 'active', at,
      },
    });
  }
  if (!out.length && !problems.length) problems.push('回的不是题（没有「=== 题 1」这样的段）');
  return { items: out, problems };
}

// 页面核题之前先看的（不碰 DOM）：数学的 answer 手写了数字却没有 let / \calc，页面没法再算一遍，不收。
// 408 的答案常常本来就是一串（先序序列、散列表、调度顺序，type: seq 之类），算不成式子：不管，靠教研室自己在命令行里算过；英语的答案是字
const COMPUTED = /\\calc\{|^\s*```+\s*let\b|^\s*let\s+\w+\s*=|type\s*:\s*custom|^\s*use\s*:/m;
// exam：{ ids（能用的真题）, reserved（留作模考的）, blockOf: { 题号: 块 }, block（这张单子的块）}（考情第 4 批）：给了就要求
// 新题写 like: 题号（对标哪一道真题）和 harder: 易 / 相当 / 难，对标的要真有、能用、同一块
export function problemLint(item, { subject = '', exam = null } = {}) {
  const md = String(item?.doc?.md || '');
  const errs = [];
  if (exam) {
    const like = md.match(/^\s*like\s*[:：]\s*(\S+)\s*$/m)?.[1] || '';
    const harder = md.match(/^\s*harder\s*[:：]\s*(\S+)\s*$/m)?.[1] || '';
    if (!like) errs.push('要写 like: 题号（这道新题对标哪一道真题，从单子里「这一块的真题」挑）');
    else if (exam.reserved?.has(like)) errs.push(`对标的 ${like} 是留作模考的卷，不能用`);
    else if (!exam.ids?.has(like)) errs.push(`对标的 ${like} 库里没有`);
    else if (exam.block && exam.blockOf?.[like] && exam.blockOf[like] !== exam.block) errs.push(`对标的 ${like} 是别的块（${exam.blockOf[like]}）的题`);
    if (like && !['易', '相当', '难'].includes(harder)) errs.push('要写 harder: 易 / 相当 / 难（和对标的那道真题比）');
  }
  if (bytesOf(md) > 12 * 1024) errs.push('太长了（一道题不超过 12 KB）');
  if (!isCS(subject) && !isEN(subject) && !/^\s*type\s*:/m.test(md) && item.kind === 'answer' && /^\s*answer\s*[:：]\s*[-\d.\s/,;()[\]]+$/m.test(md) && !COMPUTED.test(md)) errs.push('答案是手写的数字，页面没法再算一遍：用 let 块和 \\calc 写');
  return errs;
}

/** 和题库里已有的几乎一样（照抄原题、两道新题一个样）：不收 */
export function twinOf(item, drills = []) {
  const body = (md) => String(md || '').replace(/^\s*id\s*[:：].*$/gm, '');
  const mine = body(item?.doc?.md);
  return (drills || []).find((d) => d && d.id !== item.id && d.status !== 'void' && similarity(body(d.md), mine) >= 0.9) || null;
}
