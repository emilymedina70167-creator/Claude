// 410 分的进度（docs/score-plan.md）：不猜考多少分，只数「已经攒下的分」。全是页面按掌握记录算的，
// 不调用 Claude，也不进发给课堂 Claude 的说明（不影响回复的快慢）。纯函数，有测试（tests/memory-score.test.js）。
//
// 怎么算（每一层都写着依据，改数就改这一个文件）：
// 1. 410 分到四科（SUBJECTS 的 target）；每一科再按考试大纲的分值分到各部分（parts，有课的部分挂着课程前缀）。
// 2. 一部分的分平分到它在课程地图里的各章（章上写 weight 就按 weight 比；「入门」那种不考的章 weight 0），
//    一章的分再平分到这一章的块。课程地图里还没排块的章、学习台里还没有的部分：分照样占着，攒到的是 0——
//    缺口在哪一眼看得到，不会因为数学只有线代就显得数学快学完了。
// 3. 一块攒到几成看这一块的掌握（mastery.js 按证据算的，不是 Claude 说的）：LADDER。
//    考场在几个月以后：只会当场做的题考场上常丢，隔了 30 天还一次做对才算稳拿。
// 4. 这 7 天攒了多少：按掌握的 log 把 7 天前的状态退回去，用同一套算法再算一遍，相减。
import { addDays, toDate } from './schema.js';
import { voidedIds } from './memo.js';
import { courseOf } from './space.js';
import { daysLeft } from './journey.js';
import { targetOf, goalOf, examDateOf } from '../exam/target.js';

// 没有考试档案时的目标（exam/target.js 的 DEFAULT_TARGET 是同一个数）；有档案时 scoreBoard 读档案
export const GOAL = 410;

/**
 * 四科：full 是卷面满分，target 是 410 里给这一科的目标分；parts 按大纲的分值，course 是课程地图里的门课（没有就是学习台里还没有）。
 * basis 写给我看：这个数从哪来。
 */
export const SUBJECTS = [
  {
    key: 'math', label: '数学一', full: 150, target: 130, rgb: 'blue',
    parts: [
      { key: 'HM', label: '高数', points: 90, course: 'HM', basis: '大纲：高等数学约占 60%' },
      { key: 'LA', label: '线代', points: 30, course: 'LA', basis: '大纲：线性代数约占 20%' },
      { key: 'PS', label: '概率', points: 30, course: 'PS', basis: '大纲：概率论与数理统计约占 20%' },
    ],
  },
  {
    key: 'cs', label: '408', full: 150, target: 135, rgb: 'green',
    parts: [
      { key: 'DS', label: '数据结构', points: 45, course: 'DS', basis: '大纲：数据结构 45 分' },
      { key: 'CO', label: '组成原理', points: 45, course: 'CO', basis: '大纲：计算机组成原理 45 分' },
      { key: 'OS', label: '操作系统', points: 35, course: 'OS', basis: '大纲：操作系统 35 分' },
      { key: 'CN', label: '计网', points: 25, course: 'CN', basis: '大纲：计算机网络 25 分' },
    ],
  },
  {
    key: 'en', label: '英语一', full: 100, target: 75, rgb: 'pink',
    parts: [
      // 卷面：完形 10、阅读 A 40、新题型 10、翻译 10、写作 30。学习台的英语课是语法和长难句：
      // 翻译全靠它、完形和阅读里的难句也靠它，估成 30 分；阅读做题和写作要另外练，学习台里还没有
      { key: 'EN', label: '语法和长难句', points: 30, course: 'EN', basis: '估：翻译 10 分 + 完形 10 分 + 阅读里的难句约 10 分' },
      { key: 'RD', label: '阅读和新题型', points: 40, course: null, basis: '卷面：阅读 A 40 分、新题型 10 分，扣掉算进长难句的 10 分' },
      { key: 'WR', label: '写作', points: 30, course: null, basis: '卷面：小作文 10 分、大作文 20 分' },
    ],
  },
  {
    key: 'pol', label: '政治', full: 100, target: 70, rgb: 'chalk',
    parts: [{ key: 'PO', label: '政治', points: 100, course: null, basis: '学习台里还没有政治' }],
  },
];

/**
 * 一块攒到几成（达成什么、加几成）。复现通过按档位（隔几天还做得对）往上加。
 * 「掉了」：以前过了、后来又错了，退回和「讲过」一样。
 */
export const LADDER = [
  { state: '讲过', credit: 0.1, text: '上过这一块的课' },
  { state: '基础题过', credit: 0.5, text: '两道不同的题一次做对' },
  { state: '复现通过', tier: 1, credit: 0.6, text: '隔 1 天还一次做对' },
  { state: '复现通过', tier: 3, credit: 0.65, text: '隔 3 天还一次做对' },
  { state: '复现通过', tier: 7, credit: 0.75, text: '隔 7 天还一次做对' },
  { state: '复现通过', tier: 14, credit: 0.85, text: '隔 14 天还一次做对' },
  { state: '复现通过', tier: 30, credit: 1, text: '隔 30 天还一次做对（稳拿）' },
];
const DROPPED = 0.1;

/** 这个状态（和档位）值几成 */
export function creditOf(state, tier = null) {
  if (state === '掉了') return DROPPED;
  if (state === '复现通过') {
    const t = Number(tier) || 1;
    let c = LADDER.find((x) => x.state === '复现通过').credit;
    for (const x of LADDER) if (x.state === '复现通过' && t >= x.tier) c = x.credit;
    return c;
  }
  return LADDER.find((x) => x.state === state)?.credit || 0;
}

/** 状态的一句话（给我看的）：基础题过、复现通过（第 7 天那档） */
export const stateText = (state, tier) => (state === '复现通过' && tier ? `复现通过（第 ${tier} 天那档）` : state || '未学');

const list = (v) => (Array.isArray(v) ? v : []);
const round1 = (x) => Math.round(x * 10) / 10;
const isBlock = (b) => b?.level === 'block' || /\.\d+\.\d+$/.test(String(b?.id || ''));
const isChapter = (b) => b?.level === 'lecture' || /^(?:[A-Z]{2}-)?L\d+$/.test(String(b?.id || ''));
// 不考的章：「入门」「预备」这类（线代的第 0 讲），或者章上写了 weight: 0
const chapterWeight = (c) => (Number.isFinite(Number(c.weight)) && c.weight !== '' && c.weight !== null && c.weight !== undefined ? Math.max(0, Number(c.weight)) : /入门|预备/.test(String(c.title || '')) ? 0 : 1);
const naturally = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

/**
 * 某一天的掌握状态：log 里那天以前最后一次改 state / tier 的值；那天以前一条都没有，就是第一条改动之前的值（from）；
 * 没有 log 就当一直是现在这样。date 不给就是现在
 */
export function stateAt(doc, date = null) {
  if (!doc) return { state: '未学', tier: null };
  if (!date) return { state: doc.state || '未学', tier: doc.state === '复现通过' ? Number(doc.tier) || null : null };
  const at = (field, now) => {
    const ls = list(doc.log).filter((l) => l && l.field === field && l.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!ls.length) return now;
    const before = ls.filter((l) => String(l.date) <= date);
    return before.length ? before.at(-1).to : ls[0].from;
  };
  const state = at('state', doc.state || '未学') || '未学';
  const tier = state === '复现通过' ? Number(at('tier', doc.tier)) || null : null;
  return { state, tier };
}

/**
 * 每一块值几分：{ 块编号: { points, part, subject, chapter } }，加上每一部分、每一章的结构（给面板画）。
 * 课程地图里的块按门课前缀（courseOf）归到部分；高数、概率现在还没有前缀（以后加了 HM- / PS- 就自己算进来）。
 */
// split：四科各给多少（考试档案的 split）；不给就用 SUBJECTS 的 target
export function scoreMap(curriculum = [], split = null) {
  const all = list(curriculum).filter((b) => b?.id && b.status !== 'void');
  const blocks = {};
  const parts = [];
  for (const s of SUBJECTS) {
    const scale = (split?.[s.key] ?? s.target) / s.full;
    for (const p of s.parts) {
      const pts = p.points * scale;
      const mine = p.course ? all.filter((b) => courseOf(b.id) === p.course && !(p.course === 'LA' && /^[A-Z]{2}-/.test(b.id))) : [];
      const chapters = mine.filter(isChapter).sort((a, b) => naturally(a.id, b.id));
      const wsum = chapters.reduce((n, c) => n + chapterWeight(c), 0);
      const chs = [];
      for (const c of chapters) {
        const w = chapterWeight(c);
        if (!w) continue;
        const cpts = wsum ? (pts * w) / wsum : 0;
        const bs = mine.filter((b) => isBlock(b) && String(b.id).startsWith(`${c.id}.`)).sort((a, b) => naturally(a.id, b.id));
        for (const b of bs) blocks[b.id] = { points: cpts / bs.length, part: p.key, subject: s.key, chapter: c.id, title: b.title || '' };
        chs.push({ id: c.id, title: c.title || c.id, points: cpts, blocks: bs.map((b) => b.id) });
      }
      parts.push({ subject: s.key, key: p.key, label: p.label, basis: p.basis, points: pts, inDesk: chs.length > 0, chapters: chs });
    }
  }
  return { blocks, parts };
}

/** 按某一天（不给就是现在）的掌握，每一块攒了几分：{ 块编号: { got, state, tier } } */
function gotAt(mem, map, date = null) {
  const gone = voidedIds(mem);
  const docs = new Map(list(mem.mastery).filter((m) => m?.id && !gone.has(`mastery/${m.id}`)).map((m) => [String(m.id), m]));
  const out = {};
  for (const [id, b] of Object.entries(map.blocks)) {
    const st = stateAt(docs.get(id), date);
    out[id] = { ...st, got: b.points * creditOf(st.state, st.tier) };
  }
  return out;
}

/**
 * 首页和面板用的整张表：
 * { goal, total, subjects: [{ key, label, target, full, got, rgb, parts: [{ key, label, basis, points, got, inDesk, chapters: [{ id, title, points, got, blocks, done }] }] }],
 *   week: { delta, ups: [{ id, title, from, to, delta }], downs: […] }, pace: { left, weeks, perWeek } }
 */
export function scoreBoard(mem = {}, { today = toDate(Date.now()), days = 7 } = {}) {
  // 目标、四科分配、考试日期读考试档案（没有档案时和以前写死的一样）
  const target = targetOf(mem);
  const { goal, split } = goalOf(target);
  const map = scoreMap(mem.curriculum, split);
  const now = gotAt(mem, map);
  const then = gotAt(mem, map, addDays(today, -days));
  const sumOf = (ids, g) => ids.reduce((n, id) => n + (g[id]?.got || 0), 0);
  const subjects = SUBJECTS.map((s) => {
    const parts = map.parts.filter((p) => p.subject === s.key).map((p) => {
      const chapters = p.chapters.map((c) => ({ ...c, got: sumOf(c.blocks, now), done: c.blocks.filter((id) => now[id].state !== '未学').length }));
      return { key: p.key, label: p.label, basis: p.basis, points: p.points, inDesk: p.inDesk, got: chapters.reduce((n, c) => n + c.got, 0), chapters };
    });
    return { key: s.key, label: s.label, full: s.full, target: split[s.key], rgb: s.rgb, parts, got: parts.reduce((n, p) => n + p.got, 0) };
  });
  const total = subjects.reduce((n, s) => n + s.got, 0);
  const moves = Object.keys(map.blocks).map((id) => ({ id, title: map.blocks[id].title, subject: map.blocks[id].subject, from: stateText(then[id].state, then[id].tier), to: stateText(now[id].state, now[id].tier), delta: now[id].got - then[id].got })).filter((x) => Math.abs(x.delta) > 1e-9);
  const delta = moves.reduce((n, x) => n + x.delta, 0);
  const left = Math.max(0, goal - total);
  const weeks = Math.max(1, Math.ceil(Math.max(0, daysLeft(today, examDateOf(target))) / 7));
  return {
    goal, total, subjects,
    week: { days, delta, ups: moves.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta), downs: moves.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta) },
    pace: { left, weeks, perWeek: left / weeks },
  };
}

/** 分数怎么写：一位小数，整数不带 .0 */
export const fmt = (x) => { const r = round1(x); return Number.isInteger(r) ? String(r) : r.toFixed(1); };
/** 带正负号：+2.5 / −0.4 */
export const signed = (x) => (round1(x) > 0 ? `+${fmt(x)}` : round1(x) < 0 ? `−${fmt(-x)}` : '0');

/** 首页那一张卡下面一行小字（这 7 天攒了几分在大数字旁边另有一枚）：还差 403 分，每周要攒 6.8 */
export function scoreLine(b) {
  return b.pace.left > 0 ? `还差 ${Math.ceil(b.pace.left)} 分，每周要攒 ${fmt(b.pace.perWeek)}` : `攒够 ${b.goal ?? GOAL} 了`;
}
