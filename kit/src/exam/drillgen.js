// 真题做成练一练的题（docs/exam-plan.md 第二节第 5 步、4.3）：页面判得了分的真题生成一段黑板组件，进题库 drills（src: exam，带题号 exam）。
// 单选 → quiz；有验算式的填空 → answer（变量写成 let、答案写式子，不手写数）；只有数值答案的填空 → quiz 的填空；
// 标了引擎的过程题 → 那个演示组件 mode: fill（字段原样交给它）。证明、写代码、翻译、作文、阅读的主观题不做；留着的卷不做。
// tools/exam.mjs drills 生成以后先在两种 iPad 尺寸下画一遍，有写法错误的不收。纯函数，有测试（tests/exam-drillgen.test.js）。
import { usable } from './reserve.js';
import { DRILL_MAX } from '../memory/drills.js';
import '../algofuncs.js';
import { calcValue } from '../exact.js';

const flat = (s) => String(s ?? '').replace(/\r?\n+/g, ' ').trim();
const NUMERIC = /^-?\d+(?:\.\d+)?(?:\/\d+)?$/;
const vecText = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v));

/** 一道真题 → 一条题库记录（{ id, md, src: 'exam', exam, block, space, title, q, kind, status }）；做不成练习的返回 null */
export function drillOf(q = {}, { years = [], passage = null } = {}) {
  if (!q.id || !usable(q, years)) return null;
  const tag = `（${q.year} 年第 ${q.n} 题）`;
  const stem = `${tag}${flat(q.stem)}`;
  const pre = passage?.text ? `${flat(passage.text)}\n\n` : '';
  let md = null;
  let kind = '';
  const head = (name) => [`\`\`\`${name}`, `exam: ${q.id}`];
  if (q.type === 'single' || q.type === 'multi' || q.type === 'cloze' || q.type === 'reading' || q.type === 'newtype') {
    const keys = Object.keys(q.options || {});
    const right = new Set(String(q.answer || '').toUpperCase().split(''));
    if (keys.length < 2 || !keys.some((k) => right.has(k))) return null;
    md = [...head('quiz'), `q: ${pre ? flat(pre) + ' ' : ''}${stem}`, ...keys.map((k) => `- [${right.has(k) ? 'x' : ' '}] ${flat(q.options[k])}`), ...(q.analysis ? [`explain: ${flat(q.analysis)}`] : []), '```'];
    kind = 'quiz';
  } else if (q.type === 'fill' && q.check?.expr) {
    // answer 组件的式子认不得引擎函数（faults、victims…只在精确计算里注册了）：这里用引擎算好，答案写算出来的值（不是手写的数）
    let got;
    try { got = calcValue(String(q.check.expr), q.check.vars || {}).text; } catch { return null; }
    const seq = /^\s*list\(/.test(q.check.expr);
    md = [...head('answer'), `q: ${stem}`, `answer: ${got}`, ...(seq ? ['type: seq'] : []), ...(q.analysis ? [`explain: ${flat(q.analysis)}`] : []), '```'];
    kind = 'answer';
  } else if (q.type === 'fill' && NUMERIC.test(String(q.answer || '').trim())) {
    md = [...head('quiz'), `q: ${stem}`, `answer: ${String(q.answer).trim()}`, ...(q.analysis ? [`explain: ${flat(q.analysis)}`] : []), '```'];
    kind = 'quiz';
  } else if (q.tags?.engine?.name) {
    const { name, ...fields } = q.tags.engine;
    md = [...head(name), 'mode: fill', `q: ${stem}`, ...Object.entries(fields).map(([k, v]) => `${k}: ${vecText(v)}`), '```'];
    kind = name;
  }
  if (!md) return null;
  const text = md.join('\n');
  if (new TextEncoder().encode(text).length > DRILL_MAX) return null;
  return {
    id: `d-q-${String(q.id).replace(/^Q-/, '').toLowerCase()}`, md: text, src: 'exam', exam: q.id,
    block: q.tags?.blocks?.[0] || '', space: q.space, title: `${q.year} 年第 ${q.n} 题`, q: stem.slice(0, 160), kind, status: 'active',
  };
}
