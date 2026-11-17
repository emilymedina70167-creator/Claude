// 点着问（kit/src/class/ask.js，docs/board-plan.md 第 5 节）：预写的「为什么」、指着问发给 Claude 的那一行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhy, matchWhy, spotText, markHint, askMessage, whyShownText } from '../kit/src/class/ask.js';
import { parseOutput } from '../kit/src/class/protocol.js';
import { classify } from '../kit/src/class/react.js';

test('parseWhy：一行一条，step= / term= / all', () => {
  const r = parseWhy('target=ex-1', 'step=2: 因为 k 是数\nterm=mid: 1×1\nall: 总的思路\n乱写一行');
  assert.equal(r.target, 'ex-1');
  assert.deepEqual(r.items.map((x) => x.where), ['step=2', 'term=mid', 'all']);
  assert.equal(r.errors.length, 1);
  assert.match(parseWhy('', 'all: x').error, /缺少 target/);
  assert.match(parseWhy('ex-1', '').error, /一条也没写/);
  const out = parseOutput('````board why target=b3\nall: 看中间\n````\n', { final: true });
  assert.equal(out.ops[0].op, 'why');
});

test('matchWhy：先找这一步 / 这一项，再找整个组件、整段的 all', () => {
  const whys = new Map([['ex-1', [{ where: 'step=2', text: '第二步' }, { where: 'all', text: '整题' }]], ['b3', [{ where: 'term=mid', text: '中间项' }]]]);
  assert.equal(matchWhy(whys, { seg: 'b3', block: 'ex-1', step: 2 }), '第二步');
  assert.equal(matchWhy(whys, { seg: 'b3', block: 'ex-1', step: 3 }), '整题');
  assert.equal(matchWhy(whys, { seg: 'b3', term: 'mid' }), '中间项');
  assert.equal(matchWhy(whys, { seg: 'b9' }), null);
});

test('askMessage：带着位置和 mark 写法发给 Claude', () => {
  const spot = { seg: 'b5', segTitle: '推到 Aⁿ', block: 'ex-pow', kind: 'steps', step: 2, stepTitle: '再乘一次', text: 'A³ = A²·A' };
  assert.equal(spotText(spot), 'b5「推到 Aⁿ」 里的 steps ex-pow 第 2 步（再乘一次）：「A³ = A²·A」');
  assert.equal(markHint(spot), 'mark target=ex-pow step=2');
  assert.match(askMessage(spot, 'why'), /^\[指着问\] .*——为什么？（那一处的标法：mark target=ex-pow step=2）$/);
  assert.match(askMessage({ seg: 'b2', what: 'formula', text: '$A^2=3A$' }, 'example'), /b2 的公式：「\$A\^2=3A\$」——能举个具体的例子吗？/);
  assert.equal(markHint({ seg: 'b2', term: 'mid' }), 'mark target=b2 term=mid');
  assert.match(whyShownText(spot), /^\[动作\] 学生点开了你预写的「为什么」/);
});

test('点开预写的「为什么」不叫老师（跟着下一条走），也不挡住预案', () => {
  assert.deepEqual(classify({ source: 'page', type: 'why', text: '…' }, 'later'), { kind: 'passive' });
  assert.equal(classify({ source: 'page', type: 'stuck', text: '…' }, 'soon'), null);
});
