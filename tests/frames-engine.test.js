import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framesEngine as F, head } from '../kit/src/engines/frames.js';
import { parseFields } from '../kit/src/parse.js';

const SRC = `id: f1
title: 中缀转后缀
---
array 中缀: a + b * c
stack:
> 开始：栈是空的。
---
array 中缀: ~a + b * c
array 输出: a
stack:
> 读到 a：操作数，直接输出。
---
array 输出: a b {{c}}
stack: + {{*}}
? 读到 c 之后输出串是什么？ = a b c
> 读到 c：直接输出。
---
?? 运算符 * 比栈顶的 + 优先级高，要不要先把 + 弹出来？ = 不弹，* 直接入栈 | 先弹出 +
| 步 | 栈 | 输出 |
|---|---|---|
| 5 | {{+ *}} | a b c |
> 最后依次弹出 * +：a b c * +。`;

test('frames：字段只读第一个 --- 之前；一帧一帧解析出格子、栈、说明、问题、空', () => {
  const { fields } = parseFields(head(SRC));
  assert.equal(fields.id, 'f1');
  assert.equal(fields.title, '中缀转后缀');
  assert.equal(fields.array, undefined); // 帧里的 array: 不会被当成字段
  const input = F.parse(fields, SRC);
  assert.equal(input.frames.length, 4);
  const [f1, f2, f3, f4] = input.frames;
  assert.equal(f1.items.length, 2);
  assert.equal(f1.items[1].type, 'stack');
  assert.equal(f2.items[0].cells[0].mark, '~');
  assert.equal(f3.blanks.length, 2);
  assert.deepEqual(f3.blanks[0].v, ['c']);
  assert.equal(f3.ask.kind, 'text');
  assert.equal(f4.ask.kind, 'choice');
  assert.equal(f4.ask.answer, '不弹，* 直接入栈');
  assert.equal(f4.ask.choices.length, 2);
  assert.equal(f4.blanks.length, 1);
  const r = F.run(input);
  assert.equal(r.steps.length, 4);
  assert.ok(r.steps[2].blanks && r.steps[2].ask);
});

test('frames：画面——格子带身份（换帧时能滑），空画成输入框或答案，帧里多排格子的 highlight 编号接着排', () => {
  const input = F.parse({}, SRC);
  const html = F.view({ i: 2 }, input, { md: (x) => `<p>${x}</p>`, blank: (i) => `<input data-b="${i}">` });
  assert.match(html, /data-key="v:a#0"/);
  assert.match(html, /<input data-b="0">/);
  assert.match(html, /<input data-b="1">/);
  assert.match(html, /data-cmd="4"/); // 第二排第一格接着编号
  const ans = F.view({ i: 2 }, input, { md: (x) => x });
  assert.match(ans, /sv-blank-a">c</);
  const md = F.view({ i: 3 }, input, { md: (x) => x, blank: (i) => `[${i}]` });
  assert.match(md, /\| 5 \| \[0\] \| a b c \|/);
});

test('frames：写错了报出来', () => {
  assert.throws(() => F.parse({}, 'id: x'), /---/);
  assert.throws(() => F.parse({}, 'id: x\n---\n? 第一帧就问 = 1'), /第 1 帧是开始的样子/);
  assert.throws(() => F.parse({}, 'id: x\n---\na\n---\n? 没有答案'), /第 2 帧：问题要写成/);
  assert.throws(() => F.parse({}, 'id: x\n---\na\n---\n$x = {{3}}$'), /不能写在公式/);
  assert.throws(() => F.parse({}, 'id: x\n---\na\n---\ntree: A(B'), /第 2 帧：tree:/);
  assert.throws(() => F.parse({}, 'id: x\n---\na\n---\n?? 选 = 只有一个'), /至少写两个选项/);
  const one = F.parse({}, 'id: x\n---\n只有一帧');
  assert.match(F.problems(one)[0], /至少写两帧/);
  // 代码块里的 --- 不算分帧
  const code = F.parse({}, 'id: x\n---\n```\n---\n```\n---\nb');
  assert.equal(code.frames.length, 2);
});

test('frames：树按结点的名字编身份（AVL 旋转时结点滑过去）', () => {
  const input = F.parse({}, 'id: t\n---\ntree: 15(3(, 7))\n---\ntree: 7(3, 15)\nhl: 7');
  const a = F.view({ i: 0 }, input, {}), b = F.view({ i: 1 }, input, {});
  assert.match(a, /data-key="t:7"/);
  assert.match(b, /data-key="t:7"/);
  assert.match(b, /class="sv-node sv-cur"[^>]*data-label="7"/);
});
