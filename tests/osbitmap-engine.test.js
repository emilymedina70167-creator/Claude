// 位示图（kit/src/engines/osbitmap.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseFields } from '../kit/src/parse.js';
import { trackFields, resolveAsks, commonSpec, fillSpec, checkAsk } from '../kit/src/stepperspec.js';
import { bitmapEngine as B, locate } from '../kit/src/engines/osbitmap.js';

// 2015 年统考选择题：位图存在 32～127 号块，每块 1024 字节，盘块和块内字节都从 0 编号，释放 409612 号盘块：
// 要改的位在 82 号盘块、块内第 1 个字节（409612 = 50 × 8192 + 12，32 + 50 = 82，12 ÷ 8 = 1 余 4），答案 C
test('2015 年统考：位示图存在磁盘上', () => {
  const input = B.parse({ at: 32, block: '1KB', ops: 'free 409612' });
  const r = B.run(input);
  const w = locate(input, 409612);
  assert.deepEqual([w.disk, w.i, w.j], [82, 1, 4]);
  assert.deepEqual(r.steps.filter((s) => s.ask).map((s) => [s.ask.tag, s.ask.answer]), [['disk', 82], ['word', 1], ['bit', 4]]);
  assert.equal(B.quiz(input, r).answer, '82 1');
  const by = Object.fromEntries(B.variants(input).map((v) => [v.input.mistake, locate(v.input, 409612)]));
  // 一块当成 1024 位：32 + 400 = 432；忘了加 32：50；从 1 编号：409611 = 50 × 8192 + 11 → 82、块内第 2 个字节（B 选项）
  assert.equal(by.byteBits.disk, 432);
  assert.equal(by.noAt.disk, 50);
  assert.deepEqual([by.base.disk, by.base.i], [82, 2]);
});

// 汤小丹 / 王道书上的公式（行、列、盘块号都从 1 数）：b = n(i − 1) + j；i = (b − 1) DIV n + 1，j = (b − 1) MOD n + 1
test('从 1 编号的公式：盘块号 ↔ 字号、位号', () => {
  const input = B.parse({ word: 16, base: 1, ops: 'where 37, block 3 5, where 16' });
  const r = B.run(input);
  assert.deepEqual(r.steps.filter((s) => s.ask).map((s) => s.ask.answer), [3, 5, 37, 1, 16]);
  assert.deepEqual(B.variants(input).map((v) => v.input.mistake), ['base', 'swap']);
  // 都从 0 数：b = n × i + j
  const z = B.run(B.parse({ word: 16, ops: 'where 37, block 2 5' }));
  assert.deepEqual(z.steps.filter((s) => s.ask).map((s) => s.ask.answer), [2, 5, 37]);
  // 分开写：字号、位号从 1，盘块号从 0（b = n(i − 1) + (j − 1)）
  const mix = B.run(B.parse({ word: 16, base: 'word=1 bit=1 block=0', ops: 'block 3 5' }));
  assert.equal(mix.steps.find((s) => s.ask).ask.answer, 36);
});

test('分配前 k 个空闲块、回收；错法', () => {
  const input = B.parse({ map: '1111 0011 1010 0000; 0000 1111 1111 1110', ops: 'alloc 3, free 5, alloc 2' });
  const r = B.run(input);
  const asks = r.steps.filter((s) => s.ask).map((s) => s.ask);
  assert.deepEqual(asks[0].alts, [['4', '5', '9']]);
  assert.ok(checkAsk(asks[0], ['9', '4', '5']).ok);
  assert.equal(asks[1].answer, '4 5 9');
  // 回收 5 以后再分 2 块：5 和 11
  assert.equal(asks.at(-1).answer, '5 11');
  assert.equal(B.quiz(input, r).answer, '4 5 9');
  const vs = B.variants(input).map((v) => v.input.mistake);
  assert.deepEqual(vs, ['base', 'swap', 'flip']);
  const flip = B.run({ ...input, mistake: 'flip' }).steps.find((s) => s.ask?.tag === 'alloc').ask;
  assert.deepEqual(flip.alts, [['0', '1', '2']]);
  const t = B.table(input, r);
  assert.equal(t.rows.length, 3 + 1 + 2);
  assert.deepEqual(t.rows[0].cells.map((c) => c.v), ['0', '4', '4']);
  assert.throws(() => B.parse({ map: '1111 0000', ops: 'free 5' }) && B.run(B.parse({ map: '1111 0000', ops: 'free 5' })), /本来就是空闲/);
  assert.throws(() => B.parse({ word: 16, ops: 'alloc 2' }), /map:/);
  assert.throws(() => B.parse({ map: '1111; 00', ops: 'where 1' }), /一样长/);
  // words + used 也能建位示图；idle: 1 时 1 是空闲
  const u = B.run(B.parse({ word: 8, words: 2, used: '0-2, 5', ops: 'alloc 2' }));
  assert.deepEqual(u.steps.find((s) => s.ask).ask.alts, [['3', '4']]);
  const one = B.run(B.parse({ map: '0011 1100', idle: 1, ops: 'alloc 1' }));
  assert.equal(one.steps.find((s) => s.ask).ask.answer, '2');
});

test('示例页和说明里的 bitmap 例子：解析得了、ask 都问得到、字段都用上', () => {
  const srcs = ['kit/examples/os2-demo.html', 'docs/drafts/os2.md'].filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8'));
  let n = 0;
  for (const src of srcs) {
    for (const m of src.matchAll(/^```bitmap\n([\s\S]*?)^```/gm)) {
      n++;
      const tracked = trackFields(parseFields(m[1]).fields);
      const input = B.parse(tracked.fields);
      const r = B.run(input);
      const spec = commonSpec(tracked.fields);
      assert.ok(!r.steps[0].ask);
      assert.deepEqual(resolveAsks(spec.ask, r.steps).errors, [], m[1]);
      if (spec.mode === 'fill') assert.deepEqual(fillSpec(B.table(input, r), tracked.fields).errors, []);
      if (spec.mode === 'quiz') assert.ok(B.quiz(input, r));
      assert.deepEqual(tracked.unknown(), [], m[1]);
    }
  }
  assert.ok(n >= 3);
});
