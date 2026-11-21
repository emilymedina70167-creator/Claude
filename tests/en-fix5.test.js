// 第 5 批留下的小毛病（2026-11-21 一次修完）：一条一个能重现的测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrackets } from '../kit/src/entext.js';
import { parseShift } from '../kit/src/enshift.js';

const msg = (f) => { try { f(); return ''; } catch (e) { return e.message; } };

test('括号的写法错误说在写错的地方，不再一律「多了一个 ]」「括号不配对」', () => {
  const a = msg(() => parseBrackets('[S~ The rumor] [V spread]'));
  assert.match(a, /\[S~/); assert.match(a, /~1|数字/); assert.doesNotMatch(a, /多了一个/);
  const b = msg(() => parseBrackets('[S~1=O The rumor] [V spread]'));
  assert.match(b, /=/); assert.doesNotMatch(b, /多了一个/);
  const c = msg(() => parseBrackets('[A#2 The rumor] [V spread]'));
  assert.match(c, /#/); assert.doesNotMatch(c, /多了一个/);
  const d = msg(() => parseShift({ from: '[S~1 Tom] [V wrote] [O it]', to: '[O=S It] was written [S=A by Tom]' }));
  assert.match(d, /~/); assert.doesNotMatch(d, /不配对/);
  // 真的不配对照旧
  assert.match(msg(() => parseBrackets('[S The rumor] ] [V spread]')), /多了一个 \]/);
  assert.match(msg(() => parseBrackets('[S The rumor [V spread]')), /没有配对/);
});

import { layerRows } from '../kit/src/entext.js';
const rowsText = (src) => { const p = parseBrackets(src); return layerRows(p).map((r) => ({ clause: r.clause === null ? null : p.spans[r.clause].role, text: r.pieces.map((x) => p.tokens.slice(x.from, x.to + 1).map((t) => t.w).join(' ')).join(' | '), punct: r.pieces.map((x) => !!x.punct) })); };

test('层次图：句末的点留在主干那一行，不挪进最后一个从句里', () => {
  const r = rowsText('[S Tom] [V said] [ObC that he was ill].');
  const main = r.filter((x) => x.clause === null);
  assert.match(main.at(-1).text, /\.$/, JSON.stringify(r));
  assert.doesNotMatch(r.find((x) => x.clause === 'ObC').text, /\./);
});
test('层次图：句首状语从句后面的逗号跟着那个从句收尾，不起主干那一行', () => {
  const r = rowsText('[AdvC When he came], [S I] [V left].');
  const main = r.find((x) => x.clause === null);
  assert.doesNotMatch(main.text, /^,/, JSON.stringify(r));
  assert.match(r.find((x) => x.clause === 'AdvC').text, /,$/);
});
test('层次图：只是标点的一段标出来（画的时候前面不空格）', () => {
  const r = rowsText('[S Tom] [V left].');
  assert.equal(r[0].punct.at(-1), true);
  assert.equal(r[0].punct[0], false);
});

import { spansMarkup } from '../kit/src/entext.js';
test('写回括号写法（记录里的 expected）带着 ~n：老师看得出哪两段是分裂的', () => {
  const p = parseBrackets('[S~1 The rumor] [V spread] [AppC~1 that he had resigned].');
  const m = spansMarkup(p.tokens, p.spans);
  assert.match(m, /\[S~1 The rumor\]/);
  assert.match(m, /\[AppC~1 that he had resigned\]/);
  assert.deepEqual(parseBrackets(m).spans, p.spans, '写回去的读得回来');
  const q = parseBrackets('[S The man [RC who came]] [V left].');
  assert.equal(spansMarkup(q.tokens, q.spans), '[S The man [RC who came]] [V left].');
});
