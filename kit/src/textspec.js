// 文字型答案的判法（type: seq / num / bin / hex）：answer、演示组件的 quiz 共用。纯函数，不碰 DOM（tests/engines-common.test.js 用它查每个 quiz 的答案自己判自己是对的）。
import { parseSeqAnswer, checkSeq, radixAnswer, checkRadix, groupDigits } from './textcheck.js';
import { calcValue, isQ } from './exact.js';
import { cellOk, normCell, readNumber } from './stepperspec.js';

/**
 * 文字型答案（type: seq / bin / hex）→ answerWidget 的 spec.text：{ shape, check(写的) → {ok, wrong, msg}, display, tex }。
 * 别的 type 返回 null。seq 的 answer 是序列原文（几种都对用 | 隔开）；bin / hex 的 answer 是表达式（精确地算），
 * width 是要求写几位（不写就只比数值，前导 0 不管）
 */
export function textAnswerSpec(type, answer, { scope = {}, width } = {}) {
  const t = String(type || '').toLowerCase().trim();
  if (t === 'seq' || t === 'sequence' || t === 'order') {
    const alts = parseSeqAnswer(answer);
    const single = alts.every((a) => a.every((x) => [...x].length === 1));
    const display = alts[0].join(' ');
    return { shape: { kind: 'seq', single }, check: (g) => checkSeq(g, alts), display, tex: `\\text{${alts[0].map(texSafe).join(' → ')}}` };
  }
  if (t === 'num' || t === 'number') {
    // 一个数（平均周转时间、ASL、命中率……）：分数、小数都认，除不尽的写到两位小数以上四舍五入对得上就算对
    const want = String(answer ?? '').trim();
    const cell = { v: want, num: true };
    return { shape: { kind: 'seq', single: false }, check: (g) => { const ok = cellOk(cell, g); return { ok, tokens: [], wrong: [], msg: ok ? '' : readNumber(normCell(g)) === null ? '写一个数（整数、小数或分数，如 2.5、61/4）。' : '不对，再算算（除不尽的写分数，或者写到两位小数）。' }; }, display: want, tex: `${texSafe(want)}` };
  }
  if (t === 'bin' || t === 'hex') {
    const base = t === 'bin' ? 2 : 16;
    const w = width === undefined || width === '' ? 0 : Number(width);
    if (!Number.isInteger(w) || w < 0 || w > 64) throw new Error(`width: 写 1 到 64 的整数（现在是「${width}」）`);
    let v = calcValue(answer, scope).value;
    if (isQ(v)) { if (!v.integer) throw new Error(`type: ${t} 的答案要是整数（现在是 ${v}）`); v = v.n; }
    const ans = radixAnswer(v, base, w);
    const shown = groupDigits(ans.digits);
    return { shape: { kind: 'radix', base, width: ans.width }, check: (g) => checkRadix(g, ans), display: shown, tex: `\\texttt{${shown.replace(/ /g, '\\,')}}${base === 16 ? '\\,\\text{H}' : ''}` };
  }
  return null;
}
const texSafe = (s) => String(s).replace(/[\\{}$&#^_%~]/g, (c) => `\\${c}`);
