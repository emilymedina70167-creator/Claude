// 死锁检测：资源分配图的化简（kit/src/engines/osdeadlock.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseFields } from '../kit/src/parse.js';
import { trackFields, resolveAsks, commonSpec, fillSpec, checkAsk, checkFill } from '../kit/src/stepperspec.js';
import { deadlockEngine as D, hasCycle } from '../kit/src/engines/osdeadlock.js';
import { checkSeq, parseSeqAnswer } from '../kit/src/textcheck.js';

const seqOk = (answer, text) => checkSeq(text, parseSeqAnswer(answer)).ok;

// 王道「死锁定理」那张资源分配图：R1 3 个、R2 2 个；P1 占 2 个 R1、请求 1 个 R2；P2 占 1 个 R1 和 1 个 R2、请求 1 个 R1。
// 可用 (0, 1)：先化简 P1（还回 2 个 R1），再化简 P2，能完全化简，不死锁——图里有环 P1→R2→P2→R1→P1
const WD = { res: 'R1 3, R2 2', edges: 'R1->P1 2, P1->R2, R1->P2, R2->P2, P2->R1' };

test('王道的资源分配图：有环，但能完全化简', () => {
  const input = D.parse(WD);
  const r = D.run(input);
  assert.deepEqual(r.avail0, [0, 1]);
  assert.deepEqual(r.order.map((i) => input.procs[i]), ['P1', 'P2']);
  assert.deepEqual(r.left, []);
  assert.ok(hasCycle(input));
  assert.ok(!r.steps[0].ask);
  assert.equal(r.steps.find((s) => s.ask?.tag === 'avail').ask.answer, '0 1');
  assert.equal(r.steps.at(-1).ask.answer, '没有死锁');
  // 有环就判死锁、拿总数和请求比、化简后没还资源：答案都和对的不一样
  const vs = D.variants(input);
  assert.deepEqual(vs.map((v) => v.input.mistake), ['cycle', 'total', 'noRelease']);
  const cyc = vs.find((v) => v.input.mistake === 'cycle');
  assert.equal(D.run(cyc.input).steps.at(-1).ask.answer, '有死锁');
  // 没还资源：化简 P1 以后可用还是 (0, 1)，P2 请求的 R1 满足不了
  assert.deepEqual(D.run({ ...input, mistake: 'noRelease' }).left, [1]);
  const q = D.quiz(input, r);
  assert.ok(seqOk(q.answer, '无'));
});

// Silberschatz《操作系统概念》图 7.3（有死锁）：R1 1、R2 2、R3 1、R4 3；P1 占 R2、要 R1；P2 占 R1 和 R2、要 R3；P3 占 R3、要 R2
// 图 7.4（有环不死锁）：R1、R2 各 2 个；P1 要 R1、占 R2；P2 占 R1；P3 占 R1、要 R2；P4 占 R2
test('Silberschatz 的两张图：一张死锁，一张有环不死锁', () => {
  const dead = D.parse({ res: 'R1 1, R2 2, R3 1, R4 3', edges: 'R1->P2, R2->P1, R2->P2, R3->P3, P1->R1, P2->R3, P3->R2' });
  const r = D.run(dead);
  assert.deepEqual(r.left.map((i) => dead.procs[i]), ['P1', 'P2', 'P3']);
  const who = r.steps.at(-1).ask;
  assert.ok(checkAsk(who, ['P3', 'P1', 'P2']).ok && !checkAsk(who, ['P1', 'P2']).ok);
  assert.equal(r.steps.find((s) => s.ask?.tag === 'dead').ask.answer, '有死锁');
  assert.ok(seqOk(D.quiz(dead, r).answer, 'P2 P3 P1'));
  const ok = D.parse({ res: 'R1 2, R2 2', edges: 'P1->R1, R1->P2, R1->P3, P3->R2, R2->P1, R2->P4' });
  const r2 = D.run(ok);
  assert.ok(hasCycle(ok));
  assert.deepEqual(r2.left, []);
  // 一开始 P2、P4 都能化简：两个都算对
  assert.deepEqual(r2.steps.find((s) => s.ask?.tag === 'next').ask.alts, ['P2', 'P4']);
});

test('矩阵写法、填表、写错的地方', () => {
  const input = D.parse({ res: 'R1 2, R2 1', alloc: 'P1 1 0; P2 1 0; P3 0 1', request: 'P1 0 1; P2 0 0; P3 1 0' });
  const r = D.run(input);
  assert.deepEqual(r.order.map((i) => input.procs[i]), ['P2', 'P3', 'P1']);
  const t = D.table(input, r);
  assert.deepEqual(fillSpec(t, {}).errors, []);
  const vals = [['', '0 0'], ['P2', '1 0'], ['P3', '1 1'], ['P1', '2 1']];
  vals.extra = ['没有'];
  assert.ok(checkFill(t, vals).ok);
  // 死锁时表的行数照样是进程数 + 1（不泄露能化简几个）
  const d = D.parse({ res: '1 1', alloc: 'P1 1 0; P2 0 1', request: 'P1 0 1; P2 1 0' });
  const dt = D.table(d, D.run(d));
  assert.equal(dt.rows.length, 3);
  assert.throws(() => D.parse({ res: 'R1 1', edges: 'R1->P1 2' }), /分多了/);
  assert.throws(() => D.parse({ res: 'R1 1', edges: 'R1->R1' }), /一头是进程/);
  assert.throws(() => D.parse({ res: 'R1 1' }), /edges:/);
  assert.deepEqual(D.problems(D.parse({ res: 'R1 1', edges: 'P1->R1 2' })).length, 1);
});

test('示例页和说明里的 deadlock 例子：解析得了、ask 都问得到、字段都用上', () => {
  const srcs = ['kit/examples/os2-demo.html', 'docs/drafts/os2.md'].filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8'));
  let n = 0;
  for (const src of srcs) {
    for (const m of src.matchAll(/^```deadlock\n([\s\S]*?)^```/gm)) {
      n++;
      const tracked = trackFields(parseFields(m[1]).fields);
      const input = D.parse(tracked.fields);
      const r = D.run(input);
      const spec = commonSpec(tracked.fields);
      assert.ok(!r.steps[0].ask);
      assert.deepEqual(resolveAsks(spec.ask, r.steps).errors, [], m[1]);
      if (spec.mode === 'fill') assert.deepEqual(fillSpec(D.table(input, r), tracked.fields).errors, []);
      if (spec.mode === 'quiz') assert.ok(D.quiz(input, r));
      assert.deepEqual(D.problems(input), []);
      assert.deepEqual(tracked.unknown(), [], m[1]);
    }
  }
  assert.ok(n >= 3);
});
