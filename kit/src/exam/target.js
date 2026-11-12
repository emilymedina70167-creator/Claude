// 考试档案 exam/target（docs/exam-plan.md 1.2）：目标院校、专业、考哪几门、总分目标和四科分配、考试日期、留作模考的年份。
// 410 分的进度（memory/score.js）、距考研天数（memory/journey.js 的调用处）都读它；没有档案时用 DEFAULT_TARGET（和以前写死的数一样）。
// 首页第一次读到「记忆库里没有档案」时以 page 写一份默认（只写一次），我在「管理 → 考试」改（exam/examview.js）。
// 纯函数，有测试（tests/exam-target.test.js）。
import { isDate } from '../memory/schema.js';

// 2026-11-12 我说的：南京大学智能科学与技术学院（也可能是人工智能学院，没定的话按智科），考 11408；专业代码先空着。
// 考试日期是 2026-11-03 我说的初试第一天；四科分配是以前 score.js 写死的
export const DEFAULT_TARGET = {
  school: '南京大学', code: '10284', dept: '智能科学与技术学院', alt: ['人工智能学院'], major: '', majorCode: '', degree: '',
  subjects: ['101', '201', '301', '408'], full: { 101: 100, 201: 100, 301: 150, 408: 150 },
  goal: 410, split: { math: 130, cs: 135, en: 75, pol: 70 }, date: '2027-12-21',
  reserve: null, lines: [],
};
const SPLIT_KEYS = ['math', 'cs', 'en', 'pol'];
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const okNum = (v) => Number.isFinite(num(v)) && num(v) >= 0;

/** 记忆库里的那一份（缺的字段用默认补）；没有就是默认 */
export function targetOf(mem = {}) {
  const d = (Array.isArray(mem.exam) ? mem.exam : []).find((x) => x?.id === 'target');
  return d ? { ...DEFAULT_TARGET, ...d } : { ...DEFAULT_TARGET };
}

/** 考试日期：不是合法日期就回退默认 */
export const examDateOf = (t) => (isDate(t?.date) ? t.date : DEFAULT_TARGET.date);

/**
 * 总分目标和四科分配：不是数的、负的用默认；四科加起来不等于目标时照旧用（我自己定的），warn 里写一句给页面提醒，不替我改
 */
export function goalOf(t = {}) {
  const goal = okNum(t.goal) && num(t.goal) > 0 ? num(t.goal) : DEFAULT_TARGET.goal;
  const split = Object.fromEntries(SPLIT_KEYS.map((k) => [k, okNum(t.split?.[k]) ? num(t.split[k]) : DEFAULT_TARGET.split[k]]));
  const sum = SPLIT_KEYS.reduce((n, k) => n + split[k], 0);
  return { goal, split, warn: Math.abs(sum - goal) > 1e-9 ? `四科加起来是 ${sum}，不是目标的 ${goal}` : '' };
}

/** 首页要不要写一份默认档案：只在 exam 这一类读到了（不是失败）、而且一条都没有的时候 */
export const needsDefault = ({ loaded, failed, docs }) => !!loaded && !failed && !(docs || []).some((d) => d?.id === 'target');

/** 「南京大学 智能科学与技术学院」（专业写了就接上专业） */
export const schoolLine = (t = {}) => [t.school, t.dept, t.major].filter(Boolean).join(' ');

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// 留作模考的年份写法：空的是默认（最近三年，null）；「不留」是一张都不留（[]）；几个四位的年份。
// 写了字却认不出一个四位年份（「25, 26」「二〇二五」、写错一个字）不许存：存成 [] 就等于悄悄不留了，那几年的真题会进课堂
const NONE = /^(?:不留|一张都不留|无|没有|none)$/i;
function parseReserve(v) {
  if (Array.isArray(v)) return v.map(Number);
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (NONE.test(t)) return [];
  const parts = t.split(/[,，、\s]+/).filter(Boolean);
  const ys = parts.map(Number);
  if (!parts.length || ys.some((y) => !Number.isInteger(y) || y < 2009 || y > 2099)) throw new Error(`留作模考的「${t}」认不出年份：写四位的年份（2025, 2026），一张都不留写「不留」，空着是最近三年`);
  return [...new Set(ys)].sort((a, b) => a - b);
}
/** 表单里怎么写留作模考：默认是空的，一张都不留写「不留」 */
export const reserveText = (t) => (Array.isArray(t?.reserve) ? (t.reserve.length ? t.reserve.join(', ') : '不留') : '');

/**
 * 「管理 → 考试」表单 → 改了哪些字段（只交改了的，存的时候 applyChange 照它记 log）。
 * form 里是表单的字：goal、split 的四项转成数；reserve 写几个年份（「2025, 2026」），空的是回到默认（null）
 */
export function targetPatch(cur = {}, form = {}) {
  const next = {};
  for (const [k, v] of Object.entries(form)) {
    if (k === 'goal') next.goal = num(v);
    else if (k === 'split') next.split = Object.fromEntries(SPLIT_KEYS.map((x) => [x, num(v?.[x] ?? cur.split?.[x])]));
    else if (k === 'reserve') next.reserve = parseReserve(v);
    else next[k] = typeof v === 'string' ? v.trim() : v;
  }
  return Object.fromEntries(Object.entries(next).filter(([k, v]) => !sameJson(cur[k], v)));
}

const SUBJECT_OF = { math: ['301', '数学一'], cs: ['408', '408'], en: ['201', '英语一'], pol: ['101', '政治'] };
/**
 * 存着的档案哪里不对（页面照旧用默认算，不崩；这一句给「管理 → 考试」那张卡提醒）：日期坏了、四科里有不是数 / 负数、
 * 超过了那一门的满分、四科加起来不等于目标。都对返回 ''
 */
export function targetWarn(t = {}) {
  const out = [];
  if (t.date !== undefined && !isDate(t.date)) out.push(`存着的考试日期「${t.date}」不对，现在按 ${DEFAULT_TARGET.date} 算`);
  for (const k of SPLIT_KEYS) {
    const v = t.split?.[k];
    const [code, label] = SUBJECT_OF[k];
    if (v !== undefined && !okNum(v)) out.push(`${label}的分数「${v}」不对，现在按 ${DEFAULT_TARGET.split[k]} 算`);
    else if (okNum(v) && num(v) > Number(t.full?.[code] ?? DEFAULT_TARGET.full[code])) out.push(`${label} ${num(v)} 分超过了满分 ${t.full?.[code] ?? DEFAULT_TARGET.full[code]}`);
  }
  const g = goalOf(t).warn;
  if (g) out.push(g);
  return out.join('；');
}
