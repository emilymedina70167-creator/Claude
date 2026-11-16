// 黑板课的「这一块在考试里」（docs/superpowers/specs/2026-11-15-root-design.md 第 2 节「根」）：老师的根本规则第一问
// 「终点：难度和问法照真题」，要这一节每一轮都在说明里才是真的。舞台课的接法在 stage/classroom.js 里，黑板课的放这里：
// 拼这一节（boardExam）、板上组件写过的题号（askedOnBoard）、题号不能用的当场报（examLint）。
// 都不读数据库、不调用模型：考试资料是开课时按门课读一次的那一份（exam/load.js），每一轮只是照它现算。
// 纯函数，有测试（tests/class-exam.test.js）。
import { examForBlock } from '../exam/block.js';
import { examForClass } from '../exam/context.js';
import { targetOf } from '../exam/target.js';
import { QID_RE } from '../exam/fields.js';

// 组件里的一行 exam: 题号 / like: 题号（和 render.js 用的 takeExamFields 认的一样：独占一行，全角冒号也认）
const LINE = /^[ \t]*(exam|like)[ \t]*[:：][ \t]*(\S+)[ \t]*$/gm;

/** 一段（或几段）原文里组件写的真题题号：[{ field: 'exam' | 'like', id }]，照写的先后；不像题号的不算（render.js 也不收） */
function examLines(md) {
  const out = [];
  for (const m of String(md ?? '').matchAll(LINE)) if (QID_RE.test(m[2])) out.push({ field: m[1], id: m[2] });
  return out;
}

/** 板上现有的段（原文）里老师用 exam: / like: 写过的题号，不重复、照先后（顺序定了，前后两轮拼出来的才一样：抢跑要对指纹） */
export function askedOnBoard(mds = []) {
  return [...new Set((mds || []).flatMap((md) => examLines(md).map((x) => x.id)))];
}

/**
 * 这一轮的「这一块在考试里」。exam：这门课的考试资料（没读到是 null）；block：这节课的块；years：留作模考的年份；
 * mem：记忆库（考试档案 exam、页面算的真题级 exam_bar）；mds：板上各段的原文；today：'YYYY-MM-DD'。
 * 没读到、这一块没挂考点（没入库的科目）返回 ''——那就没有这一节，不写「暂无」。
 * 留作模考的卷在 examForBlock 里滤掉（usable）：板上写了留着的题号也不会把它的全文挪进来（只挪目录里有的）
 */
export function boardExam({ exam, block, years = [], mem = null, mds = [], today } = {}) {
  if (!exam || !block) return '';
  const info = examForBlock({ block, exam, years });
  if (!info) return '';
  const bar = (mem?.exam_bar || []).find((b) => b.id === block) || null;
  return examForClass({ target: targetOf(mem || {}), info, bar, today, asked: askedOnBoard(mds), form: 'board' });
}

/**
 * 一段原文里写的题号能不能用：check 是 exam/fields.js 的 examCheckOf（考试资料读到以后才有；没有就不查）。
 * 返回出错的话（空数组是都能用）。照舞台课 exam= 的做法当场报成写法错误，话里的写法换成组件的
 */
export function examLint(md, check) {
  if (typeof check !== 'function') return [];
  const out = [];
  for (const { field, id } of examLines(md)) {
    const why = check(id);
    if (why) out.push(`${field}: ${why.replace(/\b(exam|like)=/g, '$1:')}`);
  }
  return [...new Set(out)];
}
