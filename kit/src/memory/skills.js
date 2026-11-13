// 知识点归类（docs/data-plan.md 第 2 节）：一节课的课后报告写好以后，页面调用一次 Claude，把每道题归到一个具体的知识点
// （「双宾和宾补的区分」，不是整块），做错了而且正是某个弱点说的那件事的，挂上那个弱点。纯函数，有测试（tests/memory-skills.test.js）。
//
// 为什么要它：真课里课堂 Claude 几乎不在段上写 point=，证据只带着开课时的块，课上改讲别的块也跟着记错；
// 页面算掌握只能按整块数，简单题和难题混在一起，一会儿「基础题过」一会儿「掉了」；同一个误解第三次出现，弱点表也不知道。
// 花费：只发课后报告的每道题一行、这一科的课程地图、用过的知识点、弱点、小结开头，十几 KB；一节课一次，比上课的一轮小得多。
//
// 存在 sessions/{编号}.skills：{ v, reportAt, at, model, bytes, items: [{ k（报告里那道题的键）, p（知识点 块#短名）, w（弱点）}],
//   points: { 新起的知识点: 标题 }, sum: { 知识点: { n, first, fail, end, w } }, problems }
import { itemKey, OUTCOME_TEXT } from './report.js';

export const SKILLS_VERSION = 1;
export const SKILLS_HEAD = '你在给学生的一节课的题归类';
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,23}$/;
const POINT_RE = /^((?:[A-Z]{2}-)?L\d+(?:\.\d+){2})#([a-z0-9][a-z0-9-]{1,23})$/;

const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const blockOf = (p) => String(p || '').split('#')[0];
const CLEAN = (it) => it.outcome === 'first' && it.sure !== false;
const FAIL = (it) => ['wrong', 'giveup', 'revealed', 'ok'].includes(it.outcome);

/** 用过的知识点：{ 编号: { title, block, n（几节课用过）} }。来自每节课归类时新起的，和掌握里带标题的 */
export function pointCatalog(sessions = [], mastery = []) {
  const out = {};
  const ss = [...list(sessions)].filter((s) => s?.skills).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  for (const s of ss) {
    for (const [id, title] of Object.entries(s.skills.points || {})) if (!out[id]) out[id] = { title: String(title || ''), block: blockOf(id), n: 0 };
    for (const id of new Set(list(s.skills.items).map((x) => x.p).filter(Boolean))) {
      if (!out[id]) out[id] = { title: '', block: blockOf(id), n: 0 };
      out[id].n++;
    }
  }
  for (const m of list(mastery)) {
    const id = String(m?.id || '');
    if (id.includes('#') && !out[id]) out[id] = { title: String(m.title || ''), block: blockOf(id), n: 0 };
  }
  return out;
}

/** 这节课要不要（重新）归类：有报告、报告里有题、还没归过或者报告后来重算过 */
export function needsSkills(s) {
  if (!s || s.kind === 'drill' || !s.report || !(Number(s.report.items) > 0)) return false;
  // 下课后的助手一次做完（aide/after.js）；做完以后报告又重算了（报告的写法升级）：只重做归类（整次重做会把事实再写一遍）
  if (s.aide) return !!s.after?.at && (!s.skills || Number(s.skills.reportAt) !== Number(s.report.at));
  return !s.skills || (Number(s.skills.v) || 0) < SKILLS_VERSION || Number(s.skills.reportAt) !== Number(s.report.at);
}

/** 报告里的每道题写成一行（题号. ［块］「题面」：每次的对错 结果）：归类和下课后的助手共用 */
export function skillItemLines(report) {
  return list(report?.items).map((it, i) => {
    const res = it.guess ? '把选项试遍了才对' : OUTCOME_TEXT[it.outcome] || it.outcome;
    return `${i + 1}. ［${list(it.tags).filter((t) => !String(t).includes('#')).join(' ') || '没写块'}］${it.segTitle ? `（${cut(it.segTitle, 30)}）` : ''}「${cut(it.q, 90)}」：${it.seq || '·'} ${res}${it.last ? `；写的「${cut(it.last, 50)}」` : ''}${list(it.wrongs).length ? `；错过「${list(it.wrongs).slice(0, 2).map((w) => cut(w, 40)).join('」「')}」` : ''}`;
  });
}

// 归类的要求和输出格式：下课后的助手（aide/after.js）照抄同一份
export const SKILLS_RULES = [
  '- 每道题归到**一个**知识点：这道题主要考的那一件能练、能测的事（例如「双宾和宾补的区分（加『是』检验）」「系动词先查表」「谓语圈全」），不是一整块，也不要一道题一个。一节课一般 3～8 个。',
  '- 块按这道题实际考的内容从课程地图里挑（课上可能改讲了别的块，证据上记的块不一定对）。',
  '- 知识点编号写成「块编号#短名」，短名只用小写英文字母、数字、连字符，2～24 个字符，例如 EN-L1.1.1#dobj-oc。已经用过的知识点说的是同一件事就用原来的编号；没有合适的才新起，新起的要先写一行 point。',
  '- 学生这道题没有一次做对，而且错法正好是某个弱点说的那件事，后面写上弱点编号；做对的题、和弱点无关的错不写。',
  '- 和学习内容无关的（问安排、试一下页面）写 skip。',
  '',
  '## 输出格式（每行一条，不要别的字）',
  'point 编号 标题        ← 新起的知识点',
  'item 题号 编号 [弱点编号]',
  'skip 题号',
];

/**
 * 给 Claude 的提示词。report：sessions/{编号}/report/main；session：sessions/{编号}；curriculum：这一科的块；
 * catalog：pointCatalog 的结果（只带这一科的）；weaknesses：这一科还开着的弱点；summary：下课小结（没有就用 notes 老师当堂的笔记）
 */
export function skillsPrompt({ report, session = {}, curriculum = [], catalog = {}, weaknesses = [], summary = '', notes = [] } = {}) {
  const blocks = list(curriculum).filter((b) => b && /\.\d+\.\d+$/.test(String(b.id))).slice(0, 120);
  const lines = skillItemLines(report);
  const pts = Object.entries(catalog).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  const why = summary ? cut(summary, 3000) : list(notes).map((n) => `- ${cut(n.text || n, 200)}`).join('\n').slice(0, 2500);
  return [
    `${SKILLS_HEAD}：页面要按知识点（不是整块）记学生学到哪了、哪个误解又出现了。不用写解释，只按格式输出。`,
    '',
    `## 这节课：${session.id || ''}${session.date ? ` ${session.date}` : ''}${session.title ? ` ${cut(session.title, 60)}` : ''}${list(session.blocks).length ? `（课上讲过的块：${list(session.blocks).join('、')}）` : session.block ? `（开课时的块：${session.block}）` : ''}`,
    '',
    '## 这节课做的题（题号. ［证据上记的块］「题面」：每次的对错 结果）',
    ...lines,
    '',
    '## 课程地图（这一科的块）',
    ...blocks.map((b) => `${b.id} ${cut(b.title, 40)}`),
    '',
    '## 已经用过的知识点（能用就用原来的编号）',
    ...(pts.length ? pts.map(([id, x]) => `${id} ${x.title || ''}`) : ['（还没有）']),
    '',
    '## 这一科还开着的弱点（学生反复出现的误解）',
    ...(list(weaknesses).length ? list(weaknesses).map((w) => `${w.id} ${cut(w.title, 80)}`) : ['（没有）']),
    ...(why ? ['', `## ${summary ? '老师写的下课小结' : '老师当堂的笔记'}（看学生错在哪）`, why] : []),
    '',
    '## 要求',
    ...SKILLS_RULES,
  ].join('\n');
}

/**
 * 读回 Claude 写的。items：报告里的题（顺序和提示词里的题号一样）；blocks：课程地图里有的块编号；catalog：用过的知识点；
 * weaknesses：能挂的弱点。写错的行丢掉、记在 problems 里。返回 { items: [{ k, p, w? }], points: { 编号: 标题 }, problems: [] }
 */
export function parseSkills(text, { items = [], blocks = [], catalog = {}, weaknesses = [] } = {}) {
  const okBlock = new Set(list(blocks).map(String));
  const okWeak = new Set(list(weaknesses).map((w) => String(w.id ?? w)));
  const points = {};
  const out = new Map();
  const problems = [];
  const rows = String(text || '').replace(/```[a-z]*\n?/g, '').split('\n').map((l) => l.replace(/^[\s>*-]+/, '').trim()).filter(Boolean);
  const known = (p) => p in catalog || p in points;
  const okPoint = (p) => { const m = POINT_RE.exec(p); return m && (!okBlock.size || okBlock.has(m[1])); };
  for (const row of rows) {
    const [cmd, ...rest] = row.split(/\s+/);
    if (cmd === 'point') {
      const [id, ...title] = rest;
      if (!okPoint(id || '')) { problems.push(`知识点编号不对：${row}`); continue; }
      if (!title.join(' ').trim()) { problems.push(`新起的知识点没写标题：${row}`); continue; }
      if (!(id in catalog)) points[id] = cut(title.join(' '), 60);
    } else if (cmd === 'item' || cmd === 'skip') {
      const n = Number(rest[0]);
      const it = items[n - 1];
      if (!Number.isInteger(n) || !it) { problems.push(`没有第 ${rest[0]} 题：${row}`); continue; }
      if (cmd === 'skip') { out.set(n, null); continue; }
      const p = rest[1] || '';
      if (!okPoint(p)) { problems.push(`知识点编号不对：${row}`); continue; }
      if (!known(p)) { problems.push(`${p} 是新的知识点，没先写 point：${row}`); continue; }
      const w = rest[2] && okWeak.has(rest[2]) && !CLEAN(it) ? rest[2] : '';
      if (rest[2] && !w) problems.push(`弱点 ${rest[2]} 挂不上（没有这个弱点，或者这题一次就做对了）`);
      out.set(n, { k: it.key, p, ...(w ? { w } : {}) });
    }
  }
  // 后面的 point 行也算（先写 item 后写 point 的）：重读一遍被丢掉的 item
  if (Object.keys(points).length) {
    for (const row of rows) {
      const [cmd, a, p, w] = row.split(/\s+/);
      const n = Number(a);
      if (cmd !== 'item' || out.has(n) || !items[n - 1] || !(p in points)) continue;
      const it = items[n - 1];
      out.set(n, { k: it.key, p, ...(w && okWeak.has(w) && !CLEAN(it) ? { w } : {}) });
      const i = problems.findIndex((x) => x.includes(`${p} 是新的知识点`) && x.includes(row));
      if (i >= 0) problems.splice(i, 1);
    }
  }
  const used = new Set([...out.values()].filter(Boolean).map((x) => x.p));
  for (const id of Object.keys(points)) if (!used.has(id)) delete points[id];
  return { items: [...out.values()].filter(Boolean), points, problems };
}

/** 这节课每个知识点：几道题、几道一次对、几道失手、最后一道的结果、挂上的弱点 */
export function skillSummary(report, mapped = []) {
  const byKey = new Map(list(mapped).map((x) => [x.k, x]));
  const sum = {};
  for (const it of list(report?.items)) {
    const m = byKey.get(it.key);
    if (!m) continue;
    const s = sum[m.p] || (sum[m.p] = { n: 0, first: 0, fail: 0, end: '', w: [] });
    s.n++;
    if (CLEAN(it)) s.first++;
    if (FAIL(it)) s.fail++;
    if (CLEAN(it) || FAIL(it)) s.end = CLEAN(it) ? 'clean' : 'fail';
    if (m.w && !s.w.includes(m.w)) s.w.push(m.w);
  }
  return sum;
}

/**
 * 证据换上归类以后的标签（掌握按它算）：这节课归过类的题，标签换成「真正的块 + 知识点」；没归过类的照旧。
 * 「有把握吗」那条按它记着的题的键找
 */
export function retagEvidence(evidence = [], sessions = []) {
  const maps = new Map();
  for (const s of list(sessions)) {
    if (!s?.id || !list(s.skills?.items).length) continue;
    maps.set(String(s.id), new Map(s.skills.items.map((x) => [x.k, x.p])));
  }
  if (!maps.size) return evidence;
  return list(evidence).map((e) => {
    const m = e && maps.get(String(e.session || ''));
    if (!m) return e;
    const k = e.kind === 'sure' && e.detail?.key ? String(e.detail.key) : itemKey(e);
    const p = m.get(k);
    return p ? { ...e, tags: [blockOf(p), p] } : e;
  });
}

/**
 * 每个弱点出现过几次（错题档案里挂着的 + 归类时挂上的），最近哪天；之后它牵涉的知识点一次做对过几道。
 * 返回 Map 弱点 → { n, sessions, last, after, points: [] }。页面的弱点表、课堂的记忆摘要用（只读，不写回弱点表）
 */
export function weaknessHits(mem = {}) {
  const out = new Map();
  const get = (w) => out.get(w) || (out.set(w, { n: 0, sessions: new Set(), days: new Set(), last: '', points: new Set() }), out.get(w));
  const ss = list(mem.sessions).filter((s) => s?.id);
  const fromSession = new Set();
  for (const s of ss) {
    for (const x of list(s.skills?.items)) {
      if (!x.w) continue;
      const h = get(x.w);
      h.n++;
      h.sessions.add(s.id);
      if (s.date) h.days.add(s.date);
      h.points.add(x.p);
      fromSession.add(`${x.w}|${s.id}`);
    }
  }
  for (const e of list(mem.errors)) {
    if (!e?.weakness || e.corrects) continue;
    // 同一节课里归类已经数过的，错题不再重复数
    if (e.session && fromSession.has(`${e.weakness}|${e.session}`)) continue;
    const h = get(String(e.weakness));
    h.n++;
    if (e.session) h.sessions.add(e.session);
    if (e.date) h.days.add(e.date);
  }
  for (const [w, h] of out) {
    h.last = [...h.days].sort().at(-1) || '';
    // 最后一次出现以后：牵涉的知识点一次做对过几道（以后的课）
    h.after = ss.filter((s) => s.date && s.date > h.last).reduce((n, s) => n + [...h.points].reduce((m, p) => m + (Number(s.skills?.sum?.[p]?.first) || 0), 0), 0);
    out.set(w, { n: h.n, sessions: h.sessions.size, last: h.last, after: h.after, points: [...h.points] });
  }
  return out;
}

/** 弱点表、记忆摘要里的那半句：出现 3 次（3 节课），最近 11-02；之后一次做对 0 道 */
export function hitText(h) {
  if (!h || !h.n) return '';
  return `出现 ${h.n} 次${h.sessions > 1 ? `（${h.sessions} 节课）` : ''}${h.last ? `，最近 ${h.last}` : ''}${h.points.length ? `；之后一次做对 ${h.after} 道` : ''}`;
}

/**
 * 这节课的三行（给我看的；下一节的课堂 Claude 也带着「下次先测」）：
 * solid：这节课一上来就做对、没失手的知识点；shaky：失手过的（当堂改过来的也算，要隔天再测）；next：下次开头先测的（失手多的在前，最多 3 个）
 */
export function lessonLines(skills, catalog = {}) {
  const sum = skills?.sum || {};
  const name = (p) => catalog[p]?.title || skills?.points?.[p] || p.split('#')[1] || p;
  const solid = [];
  const shaky = [];
  for (const [p, s] of Object.entries(sum)) {
    if (s.fail) shaky.push({ p, name: name(p), fail: s.fail, n: s.n, fixed: s.end === 'clean', w: s.w || [] });
    else if (s.first) solid.push({ p, name: name(p), n: s.first });
  }
  shaky.sort((a, b) => b.fail - a.fail || a.p.localeCompare(b.p));
  solid.sort((a, b) => b.n - a.n || a.p.localeCompare(b.p));
  return { solid, shaky, next: shaky.slice(0, 3) };
}

/** 三行写成文字（一行一类，空的不写） */
export function lessonLinesText(ll) {
  if (!ll) return [];
  const out = [];
  if (ll.solid.length) out.push(`会了：${ll.solid.map((x) => x.name).join('；')}`);
  if (ll.shaky.length) out.push(`还不稳：${ll.shaky.map((x) => `${x.name}（错 ${x.fail} 道${x.fixed ? '，当堂改过来了' : ''}）`).join('；')}`);
  if (ll.next.length) out.push(`下次先测：${ll.next.map((x) => x.name).join('；')}`);
  return out;
}
