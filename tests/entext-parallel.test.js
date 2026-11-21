// 视觉交互第 5 批 Task 4：平行结构的写法、排成对齐的几行、判法（kit/src/entext.js，纯函数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseParallel, parallelRows, judgeStarts, judgeOdd, fixOptions } from '../kit/src/entext.js';

const w = (p, a, b) => p.tokens.slice(a, b + 1).map((t) => t.w).join(' ');
const show = (p) => parallelRows(p).map((r) => `${r.lead.length ? `${r.lead.map((i) => p.tokens[i].w).join(' ')} ` : ''}${r.item ? `[${w(p, r.item.from, r.item.to)}]` : ''}${r.trail.length ? ` ${r.trail.map((i) => p.tokens[i].w).join(' ')}` : ''}`.trim());

test('写法：方括号括出并列的几项；前面是公共的开头，最后一项前面是连接词', () => {
  const p = parseParallel('She likes [reading novels], [writing letters], and [to swim].');
  assert.equal(p.text, 'She likes reading novels, writing letters, and to swim.');
  assert.equal(p.items.length, 3);
  assert.deepEqual(p.items.map((it) => w(p, it.from, it.to)), ['reading novels', 'writing letters', 'to swim']);
  assert.equal(w(p, p.stem.from, p.stem.to), 'She likes');
  assert.equal(p.tokens[p.conj].w, 'and');
  assert.deepEqual(show(p), ['She likes [reading novels] ,', '[writing letters] ,', 'and [to swim] .']);
});

test('两项、没有逗号；连接词 or / but；项后面还有话；公共的开头是空的', () => {
  const a = parseParallel('He is [tall] and [strong].');
  assert.deepEqual(show(a), ['He is [tall]', 'and [strong] .']);
  const b = parseParallel('You can [take the bus] or [walk there] every morning.');
  assert.equal(b.tokens[b.conj].w, 'or');
  assert.deepEqual(show(b), ['You can [take the bus]', 'or [walk there]', 'every morning .']);
  const c = parseParallel('[To see] is [to believe].');
  assert.equal(c.stem, null);
  assert.equal(c.conj, -1, '没有并列连词');
  assert.deepEqual(show(c), ['[To see]', 'is [to believe] .']);
  const d = parseParallel('The plan is not only [to cut costs] but also [to raise quality].');
  assert.deepEqual(show(d), ['The plan is not only [to cut costs]', 'but also [to raise quality] .']);
});

test('写错的：不到两项、括号不配对、括号套括号', () => {
  assert.throws(() => parseParallel('She likes [reading].'), /至少两项/);
  assert.throws(() => parseParallel('She likes [reading and [writing].'), /括号/);
  assert.throws(() => parseParallel('She likes reading] and [writing].'), /括号/);
  assert.throws(() => parseParallel('She likes [reading [novels]] and [writing].'), /括号/);
  assert.throws(() => parseParallel(''), /text/);
});

test('点出每一项的第一个词：都点对才过；不说是哪几个', () => {
  const p = parseParallel('She likes [reading novels], [writing letters], and [to swim].');
  const heads = p.items.map((it) => it.from);
  assert.deepEqual(judgeStarts(heads, p), { ok: true, right: 3, extra: 0, missing: 0, text: '对，这三处是并列的三项的开头。' });
  const r = judgeStarts([heads[0], heads[1]], p);
  assert.equal(r.ok, false); assert.match(r.text, /还差 1 项/);
  const s = judgeStarts([heads[0], heads[1], heads[2], 0], p);
  assert.match(s.text, /有 1 处不是/);
  assert.equal(judgeStarts([], p).ok, null);
  const two = parseParallel('He is [tall] and [strong].');
  assert.equal(judgeStarts(two.items.map((it) => it.from), two).text, '对，这两处是并列的两项的开头。');
});

test('挑出不平行的那一项，再选改法', () => {
  const p = parseParallel('She likes [reading novels], [writing letters], and [to swim].');
  assert.deepEqual(judgeOdd(2, { answer: 3 }), { ok: true, text: '对，是这一项：它的形式和另外几项不一样。' });
  assert.equal(judgeOdd(0, { answer: 3 }).ok, false);
  assert.match(judgeOdd(0, { answer: 3 }).text, /这一项的形式和别的一样/);
  // 改法的选项：对的 + 错的，顺序固定（同一道题每次一样），不总把对的放第一个
  const o = fixOptions({ fix: 'swimming', decoys: 'swim | swam | to swimming' }, p.text);
  assert.deepEqual([...o.options].sort(), ['swam', 'swim', 'swimming', 'to swimming']);
  assert.equal(o.options[o.right], 'swimming');
  assert.deepEqual(fixOptions({ fix: 'swimming', decoys: 'swim | swam | to swimming' }, p.text), o, '同一道题每次一样');
  const firsts = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => fixOptions({ fix: 'RIGHT', decoys: 'w1 | w2 | w3' }, `seed ${x}`).right);
  assert.ok(new Set(firsts).size > 1, '对的那个不总在同一个位置');
  assert.deepEqual(fixOptions({ fix: 'swimming' }, p.text), { options: ['swimming'], right: 0 });
});
