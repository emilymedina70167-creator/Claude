// 视觉交互第 5 批 Task 5：句子变换的计划（kit/src/enshift.js，纯函数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShift, shiftPlan, judgeOrder, lineText } from '../kit/src/enshift.js';

test('主动变被动：宾语到句首、动词变形、主语前面加 by', () => {
  const s = parseShift({ from: '[S The committee] [V approved] [O the plan] [A yesterday].', to: '[O The plan] [V was approved] [S by the committee] [A yesterday].' });
  assert.equal(lineText(s.from), 'The committee approved the plan yesterday.');
  assert.equal(lineText(s.to), 'The plan was approved by the committee yesterday.');
  assert.deepEqual(s.from.filter((x) => x.key).map((x) => x.key), ['S', 'V', 'O', 'A']);
  const plan = shiftPlan(s);
  assert.deepEqual(plan.order, ['O', 'V', 'S', 'A']);
  assert.deepEqual(plan.moves.map((m) => `${m.key}:${m.from}→${m.to}`), ['S:0→2', 'O:2→0']);
  assert.deepEqual(plan.changed.map((c) => `${c.key}:${c.before}→${c.after}`), ['S:The committee→by the committee', 'V:approved→was approved']);
  assert.deepEqual(plan.added, []);
});

test('强调句：It was … that 是加的框架；只有顺序变的不算词变了', () => {
  const s = parseShift({ from: '[S The committee] [V approved] [O the plan] [A yesterday].', to: 'It was [A yesterday] that [S the committee] [V approved] [O the plan].' });
  const plan = shiftPlan(s);
  assert.deepEqual(plan.added, ['It was', 'that']);
  assert.deepEqual(plan.order, ['A', 'S', 'V', 'O']);
  assert.deepEqual(plan.changed, [], '句首大小写不算变');
  assert.deepEqual(plan.moves.map((m) => m.key), ['S', 'V', 'O', 'A']);
});

test('部分倒装还原；同名的成分按次序配；明着写 #n', () => {
  const s = parseShift({ from: '[Adv Never] [Aux have] [S I] [V seen] [O such a mess].', to: '[S I] [Aux have] [Adv never] [V seen] [O such a mess].' });
  const plan = shiftPlan(s);
  assert.deepEqual(plan.order, ['S', 'Aux', 'Adv', 'V', 'O']);
  assert.deepEqual(plan.changed, []);
  assert.deepEqual(plan.moves.map((m) => m.key).sort(), ['Adv', 'S']);
  const two = parseShift({ from: '[A In 2020] [S he] [V moved] [A to Paris].', to: '[S He] [V moved] [A#2 to Paris] [A#1 in 2020].' });
  assert.deepEqual(two.from.filter((x) => x.key).map((x) => x.key), ['A', 'S', 'V', 'A#2']);
  assert.deepEqual(shiftPlan(two).order, ['S', 'V', 'A#2', 'A']);
  // 去掉的词（there、do 支撑）
  const d = parseShift({ from: 'There [V is] [S a book] [A on the desk].', to: '[S A book] [V is] [A on the desk].' });
  assert.deepEqual(shiftPlan(d).dropped, ['There']);
});

test('两行对不上的报错；括号写错的报错', () => {
  assert.throws(() => parseShift({ from: '[S He] [V left].', to: '[S He] [V left] [A early].' }), /A.*from 里没有/);
  assert.throws(() => parseShift({ from: '[S He] [V left] [A early].', to: '[S He] [V left].' }), /A.*to 里没有/);
  assert.throws(() => parseShift({ from: '[S He [V left].', to: '[S He] [V left].' }), /括号/);
  assert.throws(() => parseShift({ from: 'He left.', to: '[S He] [V left].' }), /from.*成分/);
  assert.throws(() => parseShift({ from: '', to: '' }), /from/);
});

test('学生排的顺序：对；不对时只说第几个位置', () => {
  const s = parseShift({ from: '[S The committee] [V approved] [O the plan] [A yesterday].', to: '[O The plan] [V was approved] [S by the committee] [A yesterday].' });
  assert.deepEqual(judgeOrder(['O', 'V', 'S', 'A'], s), { ok: true, text: '顺序对了。' });
  const r = judgeOrder(['O', 'S', 'V', 'A'], s);
  assert.equal(r.ok, false); assert.equal(r.firstWrong, 1); assert.match(r.text, /第 2 个位置/);
  assert.equal(judgeOrder(['O', 'V'], s).ok, null, '没排完不判');
  assert.match(judgeOrder(['O', 'V'], s).text, /还有 2 个/);
});

test('空着的位置（undefined）也算没排完，不判', () => {
  const s = parseShift({ from: '[S The committee] [V approved] [O the plan].', to: '[O The plan] [V was approved] [S by the committee].' });
  const r = judgeOrder(['O', undefined, 'S'], s);
  assert.equal(r.ok, null);
  assert.match(r.text, /还有 1 个/);
});

test('不认识的字段报出来', async () => {
  const { shiftFieldProblems } = await import('../kit/src/enshift.js');
  assert.deepEqual(shiftFieldProblems({ title: 'x', from: 'a', to: 'b', mode: 'do', decoys: '', q: '', explain: '', id: 'a1' }), []);
  assert.match(shiftFieldProblems({ from: 'a', to: 'b', answr: '1' })[0], /answr/);
  assert.match(shiftFieldProblems({ from: 'a', to: 'b', mode: 'drag' })[0], /mode/);
});
