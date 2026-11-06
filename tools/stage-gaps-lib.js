// 缺口尺子（evals/stage-gaps/，docs/superpowers/specs/2026-11-06-stage-gap-ruler-design.md）：
// 助手交回来的理想演法、对照报告格式全不全。纯函数，有测试（tests/stage-gaps.test.js）；命令行在 tools/stage-gaps-check.mjs。

/** 理想演法里每一幕要有的七项 */
export const ACT_ITEMS = ['画面', '动', '老师说', '学生做', '页面当场', '事实', '老师凭什么接'];
/** 每个分支要有的三项 */
export const BRANCH_ITEMS = ['学生会怎么做', '老师想演什么', '页面要提供什么'];
/** 对照报告里每一幕要打标的项（「老师凭什么接」是老师自己的事，不打标） */
export const MARK_ITEMS = ['画面', '动', '老师说', '学生做', '页面当场', '事实'];
export const MARKS = ['✅', '⚠️', '❌'];

// 按标题切成一节一节：{ title, body }
function sections(md, level) {
  const re = new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm');
  const out = [];
  let m, last = null;
  while ((m = re.exec(md))) {
    if (last) last.body = md.slice(last.end, m.index);
    last = { title: m[1].trim(), end: re.lastIndex };
    out.push(last);
  }
  if (last) last.body = md.slice(last.end);
  return out.map(({ title, body }) => ({ title, body: body || '' }));
}
// 「- 项：内容」里这一项有没有写东西
const hasItem = (body, k) => new RegExp(`^- ${k}[：:][ \\t]*\\S`, 'm').test(body);

/** 一份理想演法 → 主线几幕、几个分支（读报告时对照用） */
export function idealShape(md) {
  const top = sections(md, 2);
  const main = top.find((s) => s.title === '主线');
  const acts = main ? sections(main.body, 3).map((s) => Number(s.title.match(/^第\s*(\d+)\s*幕/)?.[1])).filter(Boolean) : [];
  const branches = top.map((s) => Number(s.title.match(/^分支\s*(\d+)/)?.[1])).filter(Boolean);
  return { acts, branches };
}

/** 理想演法的问题（空就是合格） */
export function checkIdeal(md) {
  const out = [];
  const top = sections(md, 2);
  const main = top.find((s) => s.title === '主线');
  if (!main) out.push('没有「## 主线」');
  else {
    const acts = sections(main.body, 3).filter((s) => /^第\s*\d+\s*幕/.test(s.title));
    if (acts.length < 3) out.push(`主线只有 ${acts.length} 幕，至少要 3 幕`);
    for (const a of acts) for (const k of ACT_ITEMS) if (!hasItem(a.body, k)) out.push(`${a.title.split(/[：:]/)[0]}缺「${k}」，或者后面没写东西`);
  }
  const branches = top.filter((s) => /^分支\s*\d+/.test(s.title));
  if (branches.length < 2 || branches.length > 3) out.push(`分支有 ${branches.length} 个，要 2～3 个`);
  for (const b of branches) for (const k of BRANCH_ITEMS) if (!hasItem(b.body, k)) out.push(`${b.title.split(/[：:]/)[0]}缺「${k}」，或者后面没写东西`);
  return out;
}

/**
 * 对照报告的问题（空就是合格）。ideals：{ 块编号: 理想演法 }，只放这一科的。
 * 每一幕每一项、每个分支的「页面要提供什么」都要有一行打了标的；⚠️ 和 ❌ 下面要有「要的」「指令」「结果」
 */
export function checkReport(md, ideals) {
  const out = [];
  const blocks = new Map(sections(md, 2).map((s) => [s.title.split(/\s/)[0], s.body]));
  for (const [id, imd] of Object.entries(ideals)) {
    const body = blocks.get(id);
    if (body == null) { out.push(`${id}：报告里没有「## ${id}」这一节`); continue; }
    const lines = body.split('\n');
    const marked = new Map(); // 「第 2 幕·事实」→ 标
    lines.forEach((l, i) => {
      const m = l.match(/^- (✅|⚠️|❌)\s*((?:第\s*\d+\s*幕|分支\s*\d+)·[^：:]+)[：:]/);
      if (!m) return;
      const key = m[2].replace(/\s+/g, ' ').replace(/第 ?(\d+) ?幕/, '第 $1 幕').replace(/分支 ?(\d+)/, '分支 $1');
      marked.set(key, m[1]);
      if (m[1] === '✅') return;
      const sub = [];
      for (let j = i + 1; j < lines.length && /^\s+- /.test(lines[j]); j++) sub.push(lines[j].trim());
      for (const k of ['要的', '指令', '结果']) if (!sub.some((s) => new RegExp(`^- ${k}[：:][ \\t]*\\S`).test(s))) out.push(`${id} ${key}：${m[1]} 下面缺「${k}」`);
    });
    const { acts, branches } = idealShape(imd);
    for (const n of acts) for (const k of MARK_ITEMS) if (!marked.has(`第 ${n} 幕·${k}`)) out.push(`${id}：第 ${n} 幕的「${k}」没有打标`);
    for (const n of branches) if (!marked.has(`分支 ${n}·页面要提供什么`)) out.push(`${id}：分支 ${n} 的「页面要提供什么」没有打标`);
  }
  return out;
}
