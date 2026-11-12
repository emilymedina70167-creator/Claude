// 学习台的体检（2026-11-04：学习台要成熟、不犯错）。首页每次打开、日子换了时跑一遍（不调用 Claude，纯函数）。
//
// 分两种：
// - 修（fix）：页面自己的、机械的数据出了毛病，按规则当场修好，记一行修了什么。只修页面能写的几类（schema.js 的 writers 有 page），
//   只动「状态、时间、科目、档位、默认值」这种机械字段：下了课没有结束时间、没写科目、档位不是 1/3/7/14/30……
// - 记（note）：拿不准、或者是课堂里的 Claude 写的内容（错题、弱点、守则、小结、要记的问法答案）——只记下来，不改。
//   课后的学习内容是 Claude 当场看着我的作答写的，体检不能把它们换成机械提取的东西（2026-11-04 我说的）。
//
// 和自检（check.js）的分工：自检查记忆库里写的东西守不守规矩（编号、必填、指向、log）；体检查页面自己留下的数据对不对得上
// （课和证据、课和报告、档位、同一科挂着几节没下课）。两边都不碰上课的速度：只在首页跑。
import { COLLECTIONS, REVIEW_TIERS, applyChange, toDate, daysBetween, isDate } from './schema.js';
import { spaceOfId } from './space.js';
import { lastActivity } from './report.js';
import { kindOf, isTeach } from './session.js';

export const HEALTH_VERSION = 1;
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const strip = ({ id: _, ...rest }) => rest;

/** 两份文档是不是同一份（不看字段的先后：真的数据库读回来、订阅回来的字段顺序不一定一样）；id 不算 */
export function sameDoc(a, b) {
  const norm = (v) => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter((k) => k !== 'id').sort().map((k) => [k, norm(v[k])])) : v ?? null);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** 档位只能是 1/3/7/14/30：别的数往下取最近的一档（宁可早一点再想一遍），不是数的回 1 */
export function snapTier(t) {
  const n = Number(t);
  if (REVIEW_TIERS.includes(n)) return n;
  if (!Number.isFinite(n) || n < REVIEW_TIERS[0]) return REVIEW_TIERS[0];
  return [...REVIEW_TIERS].reverse().find((x) => x <= n);
}

/**
 * mem：记忆库各类的数组（和首页的 data 一样）；返回 { fixes: [{ coll, id, doc, what }], notes: [{ coll, id, msg }] }。
 * fixes 里的 doc 是改好的整份（去掉 id），照着写回去就行；状态类里要记 log 的字段（tracked）已经用 applyChange 记好。
 */
// exam：首页缓存的 meta/exam（考情第 6 批）：没打标签的真题、没挂考点的块、过时的画像、没核过的答案、一年没核的分数线，只记不改
export function healthCheck(mem = {}, { today = toDate(Date.now()), now = Date.now(), exam = null } = {}) {
  const fixes = [], notes = [];
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);
  const fix = (coll, d, patch, what) => {
    const tracked = COLLECTIONS[coll]?.tracked || [];
    const base = strip(d);
    const plain = Object.fromEntries(Object.entries(patch).filter(([k]) => !tracked.includes(k)));
    const logged = Object.fromEntries(Object.entries(patch).filter(([k]) => tracked.includes(k)));
    let doc = { ...base, ...plain };
    if (Object.keys(logged).length) doc = strip(applyChange({ id: d.id, ...doc }, logged, { date: today, by: 'page', note: `体检：${what}` }));
    fixes.push({ coll, id: String(d.id), doc, what });
  };
  const note = (coll, id, msg) => notes.push({ coll, id: String(id || ''), msg });
  const evidence = get('evidence');
  const sessions = get('sessions');

  // —— 每节课（页面开的、页面写的）——
  for (const s of sessions) {
    if (!s?.id) continue;
    const patch = {};
    const why = [];
    const started = Number(s.startedAt) || 0;
    if (!isDate(s.date) && started) { patch.date = toDate(started); why.push('补上日期'); }
    if (!['open', 'closed'].includes(s.status)) note('sessions', s.id, `状态是「${s.status ?? '空'}」，不是没下课 / 下了课（没改）`);
    if (s.status === 'closed') {
      const last = lastActivity(s, evidence);
      const end = Number(s.endedAt) || 0;
      if (!end) { patch.endedAt = Math.max(last, started) || now; why.push('下了课却没有结束时间：按最后一次动静补上'); }
      else if (started && end < started) { patch.endedAt = Math.max(last, started); why.push('结束时间比开始还早：按最后一次动静改'); }
    }
    if (!s.space) {
      const blk = s.block || list(s.blocks)[0];
      const sp = blk ? spaceOfId(String(blk)) : '';
      if (sp) { patch.space = sp; why.push(`没写是哪一科：按块补成 ${sp}`); }
      else if (isTeach(s)) note('sessions', s.id, '没写是哪一科、也没有块：首页分科时可能放错地方');
    }
    if (Object.keys(patch).length) fix('sessions', s, patch, why.join('；'));
    // 挂着的练习：练一练做到一半走了，几天都没回来（首页「直接下课」会照已做的算复现结果）
    if (s.status === 'open' && kindOf(s) === 'drill' && started && now - started > 2 * 86400000) note('sessions', s.id, `练习挂了 ${Math.floor((now - started) / 86400000)} 天没做完：首页那一行能直接下课（照已经做的算）`);
    // 下了课超过一天还没有报告：首页打开时补报告（fixReports）一直没写成
    if (s.status === 'closed' && kindOf(s) !== 'drill' && !s.report && Number(s.endedAt) && now - Number(s.endedAt) > 86400000) note('sessions', s.id, '下了课一天多了还没有课后报告：补报告一直没写成（看「页面出过的错」）');
  }
  // 同一科挂着好几节没下课的课：上课时只接最新那一节，别的就一直挂着
  const openBy = {};
  for (const s of sessions) if (s?.status === 'open' && isTeach(s)) (openBy[s.space || spaceOfId(String(s.block || ''))] ||= []).push(s.id);
  for (const [sp, ids] of Object.entries(openBy)) if (ids.length > 2) note('sessions', '', `${sp} 挂着 ${ids.length} 节没下课的课（${ids.slice(0, 4).join('、')}…）：用不着的在首页直接下课或删掉`);

  // —— 记忆点、复现组：档位和状态（页面每天想一遍、练一练的结果会改它们）——
  for (const k of get('recall')) {
    if (!k?.id) continue;
    const patch = {};
    const why = [];
    if (k.tier === undefined || snapTier(k.tier) !== Number(k.tier)) { patch.tier = snapTier(k.tier); why.push(`档位 ${k.tier ?? '空'} 不是 1/3/7/14/30：改成 ${patch.tier}`); }
    if (!k.status) { patch.status = 'active'; why.push('没写状态：当成还在记'); }
    if (k.last && !isDate(k.last)) note('recall', k.id, `上次想的日期「${k.last}」看不懂（没改）`);
    else if (k.last && daysBetween(today, k.last) > 1) note('recall', k.id, `上次想的日期 ${k.last} 在将来（时区？没改）`);
    if (!String(k.q || '').trim() || !String(k.a || '').trim()) note('recall', k.id, '问法或答案是空的：是课堂里写的，体检不替它写');
    if (Object.keys(patch).length) fix('recall', k, patch, why.join('；'));
  }
  for (const r of get('reviews')) {
    if (!r?.id) continue;
    if (r.tier !== undefined && snapTier(r.tier) !== Number(r.tier)) fix('reviews', r, { tier: snapTier(r.tier) }, `档位 ${r.tier} 不是 1/3/7/14/30：改成 ${snapTier(r.tier)}`);
    if (r.last && isDate(r.last) && daysBetween(today, r.last) > 1) note('reviews', r.id, `上次复现的日期 ${r.last} 在将来（时区？没改）`);
  }

  // —— 题库：抄过来的题没有内容（课上的段被删了？）——
  for (const d of get('drills')) if (d?.id && d.status !== 'void' && !d.broken && !String(d.md || '').trim()) fix('drills', d, { broken: true, brokenWhy: '体检：题目是空的' }, '题目是空的：以后不再挑');

  // —— 证据：指着已经没有的课（删课会连证据一起删；剩下的是别处出的岔子）——
  const have = new Set(sessions.map((s) => String(s.id)));
  const orphan = evidence.filter((e) => e?.session && !have.has(String(e.session)));
  if (orphan.length) note('evidence', '', `${orphan.length} 条证据指着已经没有的课（${[...new Set(orphan.map((e) => e.session))].slice(0, 3).join('、')}）：报告、掌握算不到它们`);

  // —— 考情（只记不改：标签、映射、画像、答案的核对由开发那边和教研室补）——
  const NAME = { LA: '线代', HM: '高数', PS: '概率', DS: '数据结构', CO: '组成原理', OS: '操作系统', CN: '计网', EN: '英语', PO: '政治' };
  for (const [c, st] of Object.entries(exam?.stats || {})) {
    if (st.untagged) note('exam', c, `${NAME[c] || c}：${st.untagged} 道真题还没打标签（统计、考情一节算不到它们）`);
    if (st.holes?.blocks?.length) note('exam', c, `${NAME[c] || c}：${st.holes.blocks.length} 块没挂考点（上这几块课时没有考情）`);
    if (st.stale?.profiles?.length && exam.statsAt && now - exam.statsAt > 7 * 86400000) note('exam', c, `${NAME[c] || c}：${st.stale.profiles.length} 个考点的画像过时一周以上（教研室还没重写）`);
    else if (st.stale?.profiles?.length) note('exam', c, `${NAME[c] || c}：${st.stale.profiles.length} 个考点的画像过时（等教研室重写）`);
    if (st.unverified) note('exam', c, `${NAME[c] || c}：${st.unverified} 道真题的答案没核过（验算的式子算不出来）`);
  }
  const target = (Array.isArray(mem.exam) ? mem.exam : []).find((x) => x?.id === 'target');
  const oldLines = (target?.lines || []).filter((l) => !l?.src?.at || now - Number(l.src.at) > 365 * 86400000);
  if (oldLines.length) note('exam', 'target', `考试档案里 ${oldLines.length} 条分数线一年多没核了（${oldLines.map((l) => `${l.year} ${l.kind}`).slice(0, 3).join('、')}）`);

  return { fixes, notes };
}

/** 写进 meta/health 的那一份：这一次的提醒，加上最近修过的（最多 40 行，新的在前） */
export function healthRecord(prev, res, { now = Date.now(), kit = '' } = {}) {
  const fixed = [...res.fixes.map((f) => ({ at: now, coll: f.coll, id: f.id, what: f.what })), ...(Array.isArray(prev?.fixed) ? prev.fixed : [])].slice(0, 40);
  return { v: HEALTH_VERSION, at: now, kit, fixed, notes: res.notes.slice(0, 40), runs: (Number(prev?.runs) || 0) + 1 };
}
