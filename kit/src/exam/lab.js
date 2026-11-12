// 教研室的三种新活（docs/exam-plan.md 第六节）：画像（一个考点「怎么考」和坑表）、映射（课程地图的块挂考点）、考情动态（招生简章、
// 复试线、大纲变化）。走现有的通路（lab_brief → lab_inbox → lab_inbox_log）：这里拼单子、读回答、核对，都是纯函数；
// labdesk.js 收的时候照这里核过再写（引的题号要真有、能用、挂在这个考点下；挂的块和考点要真有；同一个数两次独立抓到才算核过）。
// 有测试（tests/exam-lab.test.js）。
import { TYPES, HOW } from './taxonomy.js';
import { usable } from './reserve.js';

const flat = (s, n = 0) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return n && t.length > n ? `${t.slice(0, n)}…` : t; };
const QID = /Q-\d{3}-\d{4}-\d{1,2}/g;
const COURSE_NAME = { LA: '线代', HM: '高数', PS: '概率', DS: '数据结构', CO: '组成原理', OS: '操作系统', CN: '计网', EN: '英语', PO: '政治' };

/* ---------------- 工作单（sentry.js 的 workOrder 调） ---------------- */

/**
 * 考情这几种活：meta 是首页缓存的 meta/exam（stats[门课].stale、holes、heat）；today：YYYY-MM-DD；
 * 返回 [{ kind: 'profile' | 'map' | 'intel', ref, space, title, why, value, cost, key }]
 */
export function examWork(meta = null, { today = '', now = Date.now() } = {}) {
  const items = [];
  const SPACE = { LA: 'math', HM: 'math', PS: 'math', DS: 'cs', CO: 'cs', OS: 'cs', CN: 'cs', EN: 'en' };
  for (const [course, st] of Object.entries(meta?.stats || {})) {
    if (!SPACE[course]) continue;
    const heat = new Map((st.heat || []).map((h, i) => [h.id, i]));
    // 画像过时的考点：热度高的先（缓存里的 stale 已经按热度排好了）
    (st.stale?.profiles || []).forEach((id, i) => items.push({
      kind: 'profile', ref: id, space: SPACE[course], title: `${COURSE_NAME[course]}：${st.titles?.[id] || id}`, why: '这个考点进了新真题、标签改了，或者还没有画像',
      value: 55 - Math.min(20, heat.has(id) ? heat.get(id) : 12 + i), cost: '一次 Opus 5.5（读这个考点下的全部真题，写怎么考和坑表）', key: `${id}|${st.srcs?.[id] || ''}`,
    }));
    const holes = st.holes?.blocks || [];
    const stale = st.stale?.maps || [];
    if (holes.length || stale.length) items.push({
      kind: 'map', ref: course, space: SPACE[course], title: `${COURSE_NAME[course]}：${holes.length} 块没挂考点${stale.length ? `、${stale.length} 个映射过时` : ''}`,
      why: '课程地图加了块、改了块', value: 45, cost: '一次 Opus 5.5（照考点树和课程地图挂）', key: `${course}|${[...holes, ...stale].join(',')}`,
    });
  }
  // 考情动态：平时一周一次；大纲和招生简章发布的九十月、复试线公布的二三月每天
  const m = Number(String(today).slice(5, 7));
  const every = [2, 3, 9, 10].includes(m) ? 1 : 7;
  const last = Number(meta?.intelAt || 0);
  if (!last || now - last >= every * 86400000 - 3600000) items.push({ kind: 'intel', ref: 'target', space: '', title: '考情动态', why: every === 1 ? '发布的季节，每天看一眼' : '一周看一次', value: 35, cost: '一次 Opus 5.5（只用网页搜索）', key: `intel|${today}` });
  return items;
}

/* ---------------- 画像 ---------------- */

const qText = (q, course) => [`### ${q.id}（${q.year} 年第 ${q.n} 题，${TYPES[q.type] || q.type}，${q.points} 分${q.tags?.how ? `，${HOW[course]?.[q.tags.how] || q.tags.how}` : ''}）`, String(q.stem || '').trim(),
  ...Object.entries(q.options || {}).map(([k, v]) => `${k}. ${v}`), q.answer ? `答案：${q.answer}` : '', q.analysis ? `解析：${flat(q.analysis, 1200)}` : '', q.tags?.traps?.length ? `打标签时记的坑：${q.tags.traps.join('；')}` : ''].filter(Boolean).join('\n');

/** 画像的单子：node 是考点（syllabus 的一条）；questions：挂在它下面的能用的真题；old：现在的画像（有的话） */
export function profileBrief({ node, questions = [], old = null, head = '' }) {
  return [head,
    `## 这一张：写考点「${node.title}」（${node.id}，${COURSE_NAME[node.course] || node.course}）的画像`,
    '画像会放进学生上这一块的每一节课的说明里，给讲课的老师看：这个考点在考研真题里怎么考、学生最容易掉进哪些坑。**只能根据下面这些真题写**，每一句判断都要能指到题号；凭印象的、下面没有题支撑的不写。',
    `大纲原文：${node.level ? `（${node.level}）` : ''}${flat(node.text, 600)}`,
    old?.how ? `## 现在的画像（上一次写的；新进了题、标签改了，所以要重写）\n${flat(old.how, 1500)}\n${(old.traps || []).map((t) => `- ${t.id}：${t.text}（${(t.qs || []).join('、')}）`).join('\n')}` : '',
    `## 这个考点下的真题（${questions.length} 道）\n${questions.map((q) => qText(q, node.course)).join('\n\n')}`,
    '## 回答的格式（只写这些行）',
    '怎么考｜三到六句话：常见的题型和考法、这几年的变化、考到多深（要做到哪一步）、和哪些考点一起考；句子里引题号（Q-408-2019-26）',
    '坑｜一句话（学生具体会怎么错：「把 FIFO 当成 LRU 换出」，不要写「概念不清」）｜Q-…,Q-…（这个坑出现在哪几道题，至少一道）',
    '坑最多 6 条；一行一个。',
  ].filter(Boolean).join('\n\n');
}

/** 读画像的回答：{ how, traps: [{ id, text, qs }], problems }；引的题号必须在 qids（这个考点下能用的题）里 */
export function parseProfile(text, { node, qids = new Set() }) {
  const problems = [];
  let how = '';
  const traps = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*•]\s*/, '');
    if (!line) continue;
    const f = line.split(/\s*[｜|]\s*/);
    if (f[0] === '怎么考' && f[1]) how = flat(f.slice(1).join('｜'), 2000);
    else if (f[0] === '坑' && f[1]) {
      const qs = (f[2] || '').match(QID) || [];
      if (!qs.length) { problems.push(`坑「${flat(f[1], 30)}」没写出现在哪几道题`); continue; }
      const bad = qs.filter((q) => !qids.has(q));
      if (bad.length) { problems.push(`坑「${flat(f[1], 30)}」引的 ${bad.join('、')} 不是这个考点下能用的题`); continue; }
      if (traps.length < 6) traps.push({ id: `${node.id}#t${traps.length + 1}`, text: flat(f[1], 200), qs });
    }
  }
  const cited = (how.match(QID) || []).filter((q) => !qids.has(q));
  if (cited.length) problems.push(`「怎么考」里引的 ${[...new Set(cited)].join('、')} 不是这个考点下能用的题`);
  if (!how) problems.push('没写「怎么考」');
  return { how, traps, problems };
}

/** 一个考点下能用的题（画像只看能用的：留着的卷不进画像，免得经画像漏进课堂） */
export const profileQuestions = (node, questions = [], years = []) => questions.filter((q) => (q.tags?.syl || []).includes(node.id) && usable(q, years));

/* ---------------- 映射 ---------------- */

/** 挂块的单子：course；nodes：这门课的考点树；blocks：要挂的块（没挂的、映射过时的块）[{ id, title, scope }] */
export function mapBrief({ course, nodes = [], blocks = [], head = '' }) {
  return [head,
    `## 这一张：给${COURSE_NAME[course] || course}课程地图的 ${blocks.length} 块挂考点`,
    '学习台的课程地图是按教材排的一块一块；考试大纲切成了考点树。挂上以后，学生上一块课时页面就知道这一块在考试里怎么考。一块可以挂几个考点，一个考点也可以挂在几块上。只挂真的讲到了的。',
    `## 考点树\n${nodes.map((n) => `- ${n.id} ${n.title}${n.level ? `（${n.level}）` : ''}`).join('\n')}`,
    `## 要挂的块\n${blocks.map((b) => `- ${b.id} ${b.title || ''}${b.scope ? `：${flat(b.scope, 200)}` : ''}`).join('\n')}`,
    '## 回答的格式（一块一行，只写这些行）',
    '块｜块的编号｜考点编号,考点编号（这一块讲到的；一个都对不上就写「无」）',
  ].filter(Boolean).join('\n\n');
}

/** 读挂块的回答：{ map: { 块: [考点] }, problems }；块、考点都要在给的里面 */
export function parseMap(text, { blockIds = new Set(), sylIds = new Set() }) {
  const map = {};
  const problems = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const f = raw.trim().replace(/^[-*•]\s*/, '').split(/\s*[｜|]\s*/);
    if (f[0] !== '块' || !f[1]) continue;
    const b = f[1].trim();
    if (!blockIds.has(b)) { problems.push(`块 ${b} 不在这张单子里`); continue; }
    if (/^无$/.test((f[2] || '').trim())) { map[b] = []; continue; }
    const ids = (f[2] || '').split(/[,，、\s]+/).filter(Boolean);
    const bad = ids.filter((x) => !sylIds.has(x));
    if (bad.length) problems.push(`块 ${b} 挂的 ${bad.join('、')} 在考点树里没有`);
    map[b] = ids.filter((x) => sylIds.has(x));
  }
  return { map, problems };
}

/** 挂块的结果并进考点树：{ 考点: 新的 blocks }（这张单子管的块先从所有考点上摘掉，再照回答挂上） */
export function applyMap(nodes = [], map = {}) {
  const touched = new Set(Object.keys(map));
  const out = {};
  for (const n of nodes) {
    const keep = (n.blocks || []).filter((b) => !touched.has(b));
    const add = Object.entries(map).filter(([, ids]) => ids.includes(n.id)).map(([b]) => b);
    const next = [...new Set([...keep, ...add])];
    if (JSON.stringify(next) !== JSON.stringify(n.blocks || [])) out[n.id] = next;
  }
  return out;
}

/* ---------------- 考情动态 ---------------- */

export const INTEL_KINDS = { brochure: '招生简章', catalog: '专业目录', line: '复试线', syllabus: '大纲变化', ratio: '报录比', other: '别的' };

/** 考情动态的单子：target 是考试档案；recent：最近存着的动态（exam_intel）。只能用网页搜索（打不开的官网写「打不开」，不猜） */
export function intelBrief({ target = {}, recent = [], today = '', head = '' }) {
  return [head,
    `## 这一张：查考情动态（今天 ${today}）`,
    `学生考 ${target.school || ''}${target.dept ? ` ${target.dept}` : ''}${target.alt?.length ? `（也在考虑 ${target.alt.join('、')}）` : ''}，${(target.subjects || []).join('、')}，初试 ${target.date || ''}。`,
    '用网页搜索（WebSearch）查：这个学校研究生院和这几个学院的官网、研招网（yz.chsi.com.cn）上**新的**招生简章、专业目录、复试分数线、报录比、四门课考试大纲的变化。打不开的官网写「打不开」，**不猜、不凭印象写数**；每一条都要有链接和原文摘录。',
    recent.length ? `## 已经记着的（不用再报，除非这次查到的和它不一样）\n${recent.slice(0, 20).map((x) => `- ${INTEL_KINDS[x.kind] || x.kind}：${flat(x.text, 120)}${x.value != null ? `（${x.value}）` : ''}｜${x.url || ''}｜核过 ${x.checks || 1} 次`).join('\n')}` : '',
    '## 回答的格式（一条一行；什么新的都没有就写「没有新的」）',
    `动态｜种类（${Object.keys(INTEL_KINDS).join(' / ')}）｜原文摘录（照网页抄，不改写）｜数（复试线、报录比写数字，别的写「-」）｜链接｜网页上写的日期`,
  ].filter(Boolean).join('\n\n');
}

/** 读考情动态的回答：[{ kind, text, value, url, date }]；没有链接、种类不对的不收 */
export function parseIntel(text) {
  const items = [];
  const problems = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const f = raw.trim().replace(/^[-*•]\s*/, '').split(/\s*[｜|]\s*/);
    if (f[0] !== '动态') continue;
    const [, kind, quote, value, url, date] = f;
    if (!INTEL_KINDS[kind]) { problems.push(`种类「${kind}」不认得`); continue; }
    if (!/^https?:\/\//.test(url || '')) { problems.push(`「${flat(quote, 30)}」没有链接`); continue; }
    if (!quote) { problems.push('有一条没有原文摘录'); continue; }
    const v = value && value !== '-' ? (Number.isFinite(Number(value)) ? Number(value) : flat(value, 40)) : null;
    items.push({ kind, text: flat(quote, 600), value: v, url: String(url).trim(), date: flat(date, 30) });
  }
  return { items, problems };
}

/**
 * 一条新抓到的动态并进已有的：种类一样、数一样（没有数的比摘录）的算同一条，核过的次数加一（两次独立抓到同样的数才算核过）；
 * 返回 { id, doc, isNew }
 */
export function mergeIntel(existing = [], item, { at = Date.now(), seq = 1 } = {}) {
  // 哪一年的（复试线每年一条：两年的数一样也是两条）：摘录里的年份，没有就网页上写的日期
  const yearOf = (x) => Number(String(x.text || '').match(/(20\d{2})/)?.[1]) || Number(String(x.date || '').slice(0, 4)) || 0;
  const same = existing.find((x) => x.kind === item.kind && yearOf(x) === yearOf(item) && (item.value != null ? x.value === item.value : flat(x.text, 80) === flat(item.text, 80)));
  if (same) {
    // 另一晚又抓到同样的数算一次独立核对；同一晚重复交的不算
    const day = (t) => new Date(Number(t) || 0).toISOString().slice(0, 10);
    const again = day(at) !== day(same.lastAt || same.at);
    const urls = [...new Set([...(same.urls || [same.url]), item.url])];
    const { id: _, ...rest } = same;
    return { id: same.id, doc: { ...rest, urls, checks: (same.checks || 1) + (again ? 1 : 0), lastAt: at }, isNew: false };
  }
  const id = `ix-${new Date(at).toISOString().slice(0, 10).replace(/-/g, '')}-${seq}`;
  return { id, doc: { ...item, urls: [item.url], checks: 1, at, by: 'lab' }, isNew: true };
}
