// 学习台分科：一个学习台，三个空间（数学 / 408 / 英语），每科有自己的课程地图、下一节从哪接、资料包、页面，
// 课堂里带这门课的组件说明和教法；「关于我」、规则、两个 Claude 的教学失误、复现到期、统计、备份是全科共用的。
// 纯函数，有测试（tests/memory-space.test.js）。
//
// 怎么知道一条记忆是哪一科：看它指向的课程编号。课程编号带门课的前缀：DS-L2.1（数据结构第 2 讲第 1 节）、EN-L3.2.1；
// 不带前缀的 L2.2.1 是线代（分科之前的记忆都是线代，不用改）。错题 DS-L2-07 同理。
// 弱点、复现组的编号全科共用一套（W19、R3），按它挂的块 / 错题看是哪一科，也可以直接写 space。

export const SPACES = {
  math: { label: '数学', courses: ['LA'] },
  cs: { label: '408', courses: ['DS', 'OS', 'CO', 'CN'] },
  en: { label: '英语', courses: ['EN'] },
};
export const SPACE_KEYS = Object.keys(SPACES);
export const DEFAULT_SPACE = 'math';
// 门课：前缀 → 名字（subject.js 认得的科目名，课堂按它带组件说明和教法）、所在的空间
export const COURSES = {
  LA: { name: '线代', space: 'math' },
  DS: { name: '数据结构', space: 'cs' },
  OS: { name: '操作系统', space: 'cs' },
  CO: { name: '组成原理', space: 'cs' },
  CN: { name: '计网', space: 'cs' },
  EN: { name: '英语', space: 'en' },
};
const PREFIX_RE = /^([A-Z]{2})-/;

/** 课程编号（块、知识点、错题）是哪门课：DS-L2.1 → DS；不带前缀的是线代 LA */
export function courseOf(id) {
  const m = PREFIX_RE.exec(String(id || ''));
  return m && COURSES[m[1]] ? m[1] : 'LA';
}
export const spaceOfId = (id) => COURSES[courseOf(id)].space;
/** 这一块讲的是哪门课（subject.js 的科目名）：课堂按它带组件说明和教法 */
export const subjectOf = (block) => COURSES[courseOf(block)].name;
/** 门课的编号前缀：线代不带（老的记忆照旧），别的带 DS- 这样 */
export const prefixOf = (course) => (course && course !== 'LA' ? `${course}-` : '');

/** 每科的「下一节从哪接」：数学是原来的 now，别的科 now-cs、now-en */
export const positionId = (space) => (!space || space === DEFAULT_SPACE ? 'now' : `now-${space}`);
export const spaceOfPosition = (id) => (String(id) === 'now' ? DEFAULT_SPACE : String(id).replace(/^now-/, ''));
/** 每科的资料包：数学是原来的 pack/main、pack/problems，别的科 pack/main-cs、pack/problems-cs */
export const packIds = (space) => (!space || space === DEFAULT_SPACE ? { main: 'main', problems: 'problems' } : { main: `main-${space}`, problems: `problems-${space}` });

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);

/**
 * 一条记忆属于哪个空间；全科共用的（关于我、规则、失误）返回 null。
 * mem：整个记忆库（弱点、复现组要顺着错题 / 块找；观察要顺着那节课找）
 */
export function spaceOfDoc(coll, d, mem = {}) {
  if (!d) return null;
  if (d.space && SPACES[d.space]) return d.space;
  const byBlocks = (bs) => { const b = list(bs)[0]; return b ? spaceOfId(b) : null; };
  switch (coll) {
    case 'curriculum': case 'mastery': return spaceOfId(d.id);
    case 'errors': return spaceOfId(d.block || d.id);
    case 'position': return spaceOfPosition(d.id);
    case 'weaknesses': return byBlocks(d.blocks) || byBlocks(list(d.errors).map((e) => (mem.errors || []).find((x) => String(x.id) === e)?.block || e)) || DEFAULT_SPACE;
    case 'reviews': return byBlocks(d.blocks) || (list(d.weaknesses).map((w) => spaceOfDoc('weaknesses', (mem.weaknesses || []).find((x) => String(x.id) === w), mem)).find(Boolean)) || DEFAULT_SPACE;
    case 'sessions': return d.block ? spaceOfId(d.block) : DEFAULT_SPACE;
    case 'evidence': return d.block ? spaceOfId(d.block) : d.session ? spaceOfDoc('sessions', (mem.sessions || []).find((s) => s.id === d.session), mem) : null;
    case 'observations': case 'slips': return d.session ? spaceOfDoc('sessions', (mem.sessions || []).find((s) => s.id === d.session), mem) : d.block ? spaceOfId(d.block) : null;
    case 'pending': {
      const t = d.data || d.patch || {};
      if (d.coll === 'position') return spaceOfPosition(d.target);
      if (t.block || (Array.isArray(t.blocks) && t.blocks[0])) return spaceOfId(t.block || t.blocks[0]);
      return d.session ? spaceOfDoc('sessions', (mem.sessions || []).find((s) => s.id === d.session), mem) : null;
    }
    default: return null; // rules、profile、meta：全科共用
  }
}

// 全科共用、不按空间过滤的
const SHARED = new Set(['rules', 'profile', 'slips']);

/** 只要这个空间的记忆（共用的几类照旧全给；分不出科的历史条目也留着） */
export function filterSpace(mem = {}, space = DEFAULT_SPACE) {
  const out = {};
  for (const [c, docs] of Object.entries(mem || {})) {
    if (!Array.isArray(docs) || SHARED.has(c)) { out[c] = docs; continue; }
    out[c] = docs.filter((d) => { const s = spaceOfDoc(c, d, mem); return s === null || s === space; });
  }
  return out;
}

/** 首页顶上切换空间用：每科有没有东西（课程、位置、资料包、上过的课） */
export function spaceSummary(mem = {}) {
  return SPACE_KEYS.map((k) => ({
    key: k, label: SPACES[k].label,
    blocks: (mem.curriculum || []).filter((d) => spaceOfId(d.id) === k).length,
    sessions: (mem.sessions || []).filter((s) => spaceOfDoc('sessions', s, mem) === k).length,
  }));
}
