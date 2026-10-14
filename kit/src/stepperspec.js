// 步进器（一步步走的演示）的公共写法：模式、问哪几步、播放速度；以及「先猜再揭晓」的判分。
// 每个算法是一个引擎（engines/*.js）：parse(fields) → 输入，run(输入) → 每一步的状态和一句说明，view(状态) → 画面。
// 外壳（stepper.js）统一管上一步 / 下一步 / 播放、ask、quiz、课堂的 figure、记录。
// 这里是不碰 DOM 的部分，有测试（tests/stepper.test.js）。
import { parseSeqAnswer, checkSeq } from './textcheck.js';

/**
 * 每个引擎的步：{ view, msg, ask? }
 *   view：交给引擎的 view() 画的状态（随便什么结构）
 *   msg：这一步的说明（Markdown，可以有 $公式$）
 *   ask：走到这一步之前可以先问学生的问题（学生猜这一步会怎样）：
 *     { tag, q, kind: 'pick' | 'choice' | 'text', answer, choices?, count?, explain? }
 *     tag：问题的种类（作者用 ask: 种类 挑），pick：在图上点（answer 是 data-pick 的值，几个都对时写数组 alts），
 *     choice：选项按钮，text：写一个序列（answer 是序列原文，几种都对用 | 隔开）
 */

const BOOL = /^(true|yes|on|1|是)$/i;

/** 公共字段：mode（demo 演示 / quiz 只给输入、写出结果）、ask、start（一开始停在第几步）、speed（播放时每步几秒） */
export function commonSpec(fields = {}) {
  const mode = String(fields.mode || 'demo').trim().toLowerCase();
  if (!['demo', 'quiz'].includes(mode)) throw new Error(`mode: 只能是 demo（演示，默认）或 quiz（只给输入，写出结果）（现在是「${fields.mode}」）`);
  const speed = fields.speed === undefined || fields.speed === '' ? 1.2 : Number(String(fields.speed).replace(/s$/i, ''));
  if (!(speed >= 0.2 && speed <= 10)) throw new Error(`speed: 写 0.2 到 10 之间的秒数（现在是「${fields.speed}」）`);
  const start = fields.start === undefined || fields.start === '' ? 0 : String(fields.start).trim().toLowerCase();
  if (start !== 0 && start !== 'end' && !(Number.isInteger(Number(start)) && Number(start) >= 0)) throw new Error(`start: 写步号（0 是开始）或 end（现在是「${fields.start}」）`);
  return { mode, ask: parseAskField(fields.ask), speed, start: start === 'end' ? 'end' : Number(start), auto: BOOL.test(fields.auto || '') };
}

/** ask: all / 种类（几个用逗号）/ 步号（3, 5）/ 混着写。不写就是不问 */
export function parseAskField(src) {
  const s = String(src ?? '').trim();
  if (!s || /^(none|no|off|false|不问)$/i.test(s)) return null;
  const out = { all: false, tags: [], nums: [] };
  for (const t of s.split(/[\s,，、]+/).filter(Boolean)) {
    if (/^(all|every|全部|每一步)$/i.test(t)) out.all = true;
    else if (/^\d+$/.test(t)) out.nums.push(Number(t));
    else out.tags.push(t.toLowerCase());
  }
  return out;
}

/**
 * 按作者的 ask: 挑出要问的步（步号，从 1 数；第 0 步是开始的样子，不问）。
 * 返回 { asks: Set(步号), errors: [中文说明] }：点了没有问题可问的步号、或者不认识的种类，都报出来
 */
export function resolveAsks(ask, steps) {
  const asks = new Set();
  const errors = [];
  if (!ask) return { asks, errors };
  const tags = new Set();
  steps.forEach((s, k) => { if (k > 0 && s.ask) tags.add(s.ask.tag); });
  const askable = steps.map((s, k) => (k > 0 && s.ask ? k : -1)).filter((k) => k > 0);
  if (ask.all) askable.forEach((k) => asks.add(k));
  for (const t of ask.tags) {
    if (!tags.has(t)) { errors.push(`ask: 没有「${t}」这种问题${tags.size ? `（这个演示能问的：${[...tags].join('、')}）` : '（这个演示没有可以问的步）'}`); continue; }
    askable.forEach((k) => { if (steps[k].ask.tag === t) asks.add(k); });
  }
  for (const n of ask.nums) {
    if (n < 1 || n >= steps.length) errors.push(`ask: 没有第 ${n} 步（一共 ${steps.length - 1} 步）`);
    else if (!steps[n].ask) errors.push(`ask: 第 ${n} 步没有可以问的${askable.length ? `（能问的步：${askable.slice(0, 12).join('、')}${askable.length > 12 ? '……' : ''}）` : ''}`);
    else asks.add(n);
  }
  return { asks, errors };
}

const norm = (x) => String(x ?? '').trim().toUpperCase();

/**
 * 判一次猜测。given：pick 是点的值（count > 1 时是数组），choice 是选的选项，text 是写的文字。
 * 返回 { ok, msg, wrong? }
 */
export function checkAsk(ask, given) {
  if (ask.kind === 'number') {
    const g = readNumber(given);
    if (g === null) return { ok: false, msg: '写一个数（整数、小数或分数，如 2.5、5/2）。' };
    // 小数写到两位（四舍五入）也算对：ASL 这类常常除不尽
    const a = Number(ask.answer);
    const decimals = (String(given).trim().split('.')[1] || '').length;
    const tol = decimals && decimals <= 2 && !String(given).includes('/') ? 0.5 * 10 ** -decimals + 1e-9 : 1e-9;
    const ok = Math.abs(g - a) <= tol;
    return { ok, msg: ok ? '' : '不对，再算算。' };
  }
  if (ask.kind === 'text') {
    const r = checkSeq(given, parseSeqAnswer(ask.answer));
    return { ok: r.ok, msg: r.msg, wrong: r.wrong };
  }
  const alts = Array.isArray(ask.alts) ? ask.alts : [ask.answer];
  if (ask.kind === 'pick' && (ask.count || 1) > 1) {
    // 点几个：不管顺序（比如「哪两个交换」）
    const g = [...(Array.isArray(given) ? given : [given])].map(norm).sort();
    const ok = alts.some((a) => { const x = [].concat(a).map(norm).sort(); return x.length === g.length && x.every((v, i) => v === g[i]); });
    return { ok, msg: ok ? '' : '不对，再想想。' };
  }
  const ok = alts.some((a) => norm(a) === norm(given));
  return { ok, msg: ok ? '' : ask.kind === 'pick' ? '不是这个，再想想。' : '不对，再想想。' };
}

/** 答案写成一句话（看答案、记录用） */
export function askAnswerText(ask) {
  if (ask.display !== undefined) return String(ask.display);
  if (ask.kind === 'text') return String(ask.answer).split('|')[0].trim();
  const a = Array.isArray(ask.alts) ? ask.alts[0] : ask.answer;
  return Array.isArray(a) ? a.join('、') : String(a);
}

/** 第几步的计数文字：0 是「开始」 */
export const stepLabel = (k, n) => (k <= 0 ? '开始' : `第 ${k} / ${n} 步`);

// 学生写的数：整数、小数、分数（全角也认）
export function readNumber(text) {
  const s = String(text ?? '').trim().replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/／/g, '/').replace(/．/g, '.').replace(/−/g, '-');
  let m = /^(-?\d+(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(-?\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  return null;
}
