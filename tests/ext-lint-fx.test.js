// 计划 3（dr-calc-base）：外部的预检认 answer 的 formula: / calc:（和页面同一个 formulaSpec，不受页面 50 ms 的限）
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintTurn, answerProblems } from '../tools/ext-lint.js';

const turn = (body) => `\`\`\`board add id=s1\n\`\`\`answer\nid: q1\n${body}\n\`\`\`\n\`\`\``;
const names = new Set(['answer']);
const errs = (r) => r.problems.filter((p) => p.level !== 'hint');

test('外部写错的原函数报错', () => {
  const r = lintTurn({ text: turn('q: 求 ∫ x e^x dx\nanswer: x*e^x + e^x\ncalc: antideriv of=x*e^x'), names });
  assert.ok(errs(r).some((p) => /求导以后不等于/.test(p.msg)), JSON.stringify(r.problems));
});
test('对的不报', () => {
  const r = lintTurn({ text: turn('q: 求极限\nanswer: 1/2\ncalc: limit of=(tan(x)-sin(x))/x^3 at=0'), names });
  assert.deepEqual(errs(r), []);
});
test('页面核不了的是提示，不算错', () => {
  const p = answerProblems('answer: 0\ncalc: limit of=x*sin(1/x) at=0');
  assert.ok(p.length && p.every((x) => x.level === 'hint'));
});
test('calc: 写错、范围写反照实说', () => {
  assert.match(answerProblems('answer: 1\ncalc: lmit of=x at=0')[0].msg, /calc: 能写/);
  assert.match(answerProblems('answer: ln(x)\nformula: x in (1, 0)')[0].msg, /写反/);
});
test('整数取点的变量在 ln、sqrt 里：提醒要实数写 in', () => {
  const p = answerProblems('answer: ln(p)\nformula: p');
  assert.ok(p.some((x) => x.level === 'hint' && /p in/.test(x.msg)));
});
test('块里的 let 也算', () => {
  assert.deepEqual(answerProblems('let a = 2\nanswer: a*x\nformula: x'), []);
});
