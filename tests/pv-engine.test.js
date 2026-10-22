// 进程同步：信号量 P/V（engines/pv.js）：和王道的例子对答案（生产者消费者、读者写者、哲学家、吸烟者、苹果橘子），
// 再看写法、报错、先猜的问题、quiz / 填表、常见错法
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pvEngine, pvSearch, pvMove, pvStart, procInfo, readyList, scheduleText, initState, exec, badOf, MISTAKES } from '../kit/src/engines/pv.js';
import { parseFields } from '../kit/src/parse.js';
import { checkAsk, checkFill, fillSpec, misreadAnswer, misreadFill } from '../kit/src/stepperspec.js';
import { textAnswerSpec } from '../kit/src/textspec.js';

const go = (src) => {
  const { fields } = parseFields(pvEngine.head(src));
  const input = pvEngine.parse(fields, src);
  return { input, fields, r: pvEngine.run(input) };
};
const sys = (src) => go(src).input.sys;
const sems = (r) => r.final.sem;
const blockedOf = (input, s) => input.sys.procs.filter((_, p) => s.blk[p]).map((x) => x.name);
const asks = (r) => r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean);

test('生产者消费者（王道）：P 先减 1，减完 < 0 阻塞；V 加完 ≤ 0 唤醒队头', () => {
  const { r, input } = go('problem: 生产者消费者\nbuffer: 2\nrun: C P×6');
  // C 先来：full 0 → −1，阻塞
  assert.match(r.steps[1].msg, /full 从 0 减到 −1.*C \*\*阻塞\*\*/);
  assert.equal(r.steps[1].view.st.q.full.join(), '1');
  // P 一轮：生产、P(empty)、P(mutex)、放入、V(mutex)、V(full)：V(full) 把 full 从 −1 加到 0，唤醒 C
  assert.match(r.steps[7].msg, /full 从 −1 加到 0，≤ 0.*唤醒队头的 C/);
  assert.deepEqual(sems(r), { mutex: 1, empty: 1, full: 0 });
  assert.equal(r.final.buf.length, 1);
  assert.deepEqual(readyList(input.sys, r.final).map((p) => input.sys.procs[p].name), ['P', 'C']);
  // C 被唤醒以后从 P(full) 的下一句接着走
  assert.equal(procInfo(input, r.final, 1).text, 'P(mutex)');
});

test('生产者先 P(mutex) 再 P(empty)：run: deadlock 找到最短的死锁走法（缓冲区满了，生产者占着 mutex 等 empty）', () => {
  const { r, input } = go('problem: 生产者消费者\nbuffer: 2\nswap: P\nrun: deadlock');
  assert.equal(scheduleText(input.sys, r.order), 'P×15 C×2');
  assert.deepEqual(sems(r), { mutex: -1, empty: -1, full: 1 });
  assert.deepEqual(blockedOf(input, r.final), ['P', 'C']);
  assert.match(r.steps.at(-1).msg, /\*\*死锁了\*\*/);
  assert.equal(r.steps.at(-1).view.bad[0].kind, 'deadlock');
  assert.match(r.steps[0].msg, /P 的 P\(empty\) 和 P\(mutex\) 换了顺序/);
  // 显示的代码也换了
  assert.deepEqual(input.sys.temps[0].lines.slice(2, 4).map((l) => l.text), ['P(mutex);', 'P(empty);']);
  // 消费者换：缓冲区空的时候消费者占着 mutex 等 full，生产者 P(mutex) 就阻塞（更短）
  const cs = go('problem: 生产者消费者\nbuffer: 2\nswap: C\nrun: deadlock');
  assert.equal(scheduleText(cs.input.sys, cs.r.order), 'C×2 P×3');
  assert.deepEqual(blockedOf(cs.input, cs.r.final), ['P', 'C']);
});

test('经典问题的正确写法：怎么走都不会死锁、不会同时进临界区（所有状态都走一遍）', () => {
  for (const p of ['生产者消费者', '生产者消费者 P×2 C×2', '读者写者', '读者写者 写者优先', '哲学家 互斥', '哲学家 限四人', '哲学家 奇偶', '吸烟者', '苹果橘子']) {
    const s = sys(`problem: ${p}`);
    const d = pvSearch(s, 'bad');
    assert.ok(d.complete && !d.found, `${p}：${d.found ? d.bad.map((b) => b.kind).join() : '状态没走完'}`);
  }
});

test('哲学家（每人先拿左边的筷子）：五个人都拿起左边，再都去拿右边 → 死锁', () => {
  const { r, input } = go('problem: 哲学家\nrun: deadlock');
  assert.equal(scheduleText(input.sys, r.order), 'P0 P1 P2 P3 P4 P0 P1 P2 P3 P4');
  for (let i = 0; i < 5; i++) {
    assert.equal(r.final.sem[`chopstick[${i}]`], -1);
    // P(i) 在等右边的 chopstick[(i+1)%5]
    assert.equal(r.final.blk[i], `chopstick[${(i + 1) % 5}]`);
  }
  assert.match(r.steps[6].msg, /P0 执行 P\(chopstick\[1\]\)：chopstick\[1\] 从 0 减到 −1/);
  // 人数可以改
  const three = go('problem: 哲学家 3\nrun: deadlock');
  assert.equal(three.r.order.length, 6);
});

test('读者写者：读者优先时后来的读者不用等写者；读写公平时排在写者后面（王道）', () => {
  // R1 进来读（count = 1，P(rw) 挡住写者），W 阻塞在 rw 上，R2 照样能进来读
  const rp = go('problem: 读者写者\nrun: R1×4 W R2×4');
  assert.deepEqual(blockedOf(rp.input, rp.r.final), ['W']);
  assert.equal(rp.r.final.vars.count, 2);
  assert.equal(procInfo(rp.input, rp.r.final, 1).text, '读文件');
  assert.deepEqual(badOf(rp.input.sys, rp.r.final), []); // 两个读者一起读不算冲突
  // 读写公平：W 先 P(w) 再阻塞在 rw 上，R2 卡在 P(w)
  const fair = go('problem: 读者写者 写者优先\nrun: R1×6 W×2 R2');
  assert.deepEqual(blockedOf(fair.input, fair.r.final), ['R2', 'W']);
  assert.equal(fair.r.final.blk[1], 'w');
  // if (count == 0) P(rw)：count 已经是 1，不做 P
  assert.match(rp.r.steps[7].msg, /R2 执行 if \(count == 0\)：count = 1，不成立，不执行 P\(rw\)/);
});

test('吸烟者、苹果橘子（王道）', () => {
  const sm = go('problem: 吸烟者\nrun: P1×5 P3');
  // num++ → 1，num % 3 = 1：V(offer2) 给有纸的 P3
  assert.equal(sm.r.final.vars.num, 1);
  assert.match(sm.r.steps[4].msg, /if \(num == 1\)：num = 1，成立，执行 V\(offer2\)/);
  assert.equal(sm.r.final.sem.offer2, 0);
  const fr = go('problem: 苹果橘子\nrun: 爸爸×4 妈妈×2 女儿×3');
  // 盘子里有苹果，妈妈阻塞在 plate 上；女儿取走苹果、V(plate) 唤醒妈妈
  assert.match(fr.r.steps[6].msg, /妈妈 \*\*阻塞\*\*/);
  assert.match(fr.r.steps.at(-1).msg, /唤醒队头的 妈妈/);
  assert.deepEqual(fr.r.final.buf, []);
});

test('页面看出来的毛病：同时进临界区、缓冲区满了还放 / 空了还取、取错了水果、只剩一个永远阻塞', () => {
  const noMutex = 'semaphore: empty = 2, full = 0\nbuffer: 2\ncode:\nP×2: while(1) { P(empty); 放入; V(full) }\nC: while(1) { P(full); 取出; V(empty) }';
  const race = pvSearch(sys(noMutex), 'bad');
  assert.ok(race.found);
  assert.equal(race.bad[0].kind, 'race');
  assert.equal(scheduleText(sys(noMutex), race.path), 'P1 P2');
  assert.equal(pvSearch(sys(noMutex), 'deadlock').found, false);
  // 没有 empty：放第 3 个时缓冲区满了
  const over = go('semaphore: mutex = 1, full = 0\nbuffer: 2\nrun: P×12\ncode:\nP: while(1) { P(mutex); 放入缓冲区; V(mutex); V(full) }\nC: while(1) { P(full); P(mutex); 取出; V(mutex) }');
  assert.ok(over.r.steps.some((s) => /已经满了（2 个位置）还往里放/.test(s.msg)));
  // 没有 full：消费者先取，缓冲区是空的
  const under = pvSearch(sys('semaphore: mutex = 1\nbuffer: 1\ncode:\nC: while(1) { P(mutex); 取出; V(mutex) }'), 'bad');
  assert.equal(under.bad[0].kind, 'underflow');
  // 女儿等的是 orange：取到的不是苹果
  const wrong = pvSearch(sys('semaphore: plate = 1, apple = 0, orange = 0\nbuffer: 盘子 1 苹果 橘子\ncode:\n妈妈: while(1) { P(plate); 把橘子放进盘子; V(orange) }\n女儿: while(1) { P(orange); 从盘子里取出苹果; V(plate) }'), 'bad');
  assert.equal(wrong.bad[0].kind, 'wrong');
  // 不循环的进程：P 做完了，C 第二次 P(full) 永远阻塞（只剩一个，不叫死锁）
  const once = go('semaphore: full = 0\nrun: P C×3\ncode:\nP: V(full);\nC: while(1) { P(full); 消费 }');
  assert.equal(once.r.steps.at(-1).view.bad[0].kind, 'stuck');
  assert.match(once.r.steps.at(-1).msg, /永远阻塞在 full 上/);
});

test('写法：王道的代码可以直接贴（semaphore / int 声明、大括号、do-while、// 临界区）；P+、(P C)×2', () => {
  const src = [
    'run: producer+ consumer+',
    'code:',
    'semaphore mutex = 1, empty = 1, full = 0;',
    'int count = 0;',
    'producer() {',
    '  do {',
    '    P(empty);',
    '    P(mutex);',
    '    count++;  // 临界区',
    '    V(mutex);',
    '    V(full);',
    '  } while (1);',
    '}',
    'consumer() {',
    '  while (1) {',
    '    P(full);',
    '    if (count > 0) {',
    '      count--;',
    '    }',
    '    V(empty);',
    '  }',
    '}',
  ].join('\n');
  const { input, r } = go(src);
  assert.deepEqual(input.sys.procs.map((p) => p.name), ['producer', 'consumer']);
  assert.deepEqual(input.sys.temps[0].lines.map((l) => l.text), ['do {', 'P(empty);', 'P(mutex);', 'count++;', 'V(mutex);', 'V(full);', '} while (1);']);
  assert.equal(input.sys.temps[1].lines[2].text, 'if (count > 0) {');
  // producer+ 一直走到阻塞（又一次 P(empty)）；consumer+ 取一个、V(empty) 唤醒它，再 P(full) 时阻塞
  assert.equal(scheduleText(input.sys, r.order), 'producer×6 consumer×5');
  assert.deepEqual(blockedOf(input, r.final), ['consumer']);
  assert.match(r.steps[10].msg, /唤醒队头的 producer/);
  // (P0 P1)×2：括号里的轮流走两遍
  assert.equal(scheduleText(sys('problem: 哲学家'), go('problem: 哲学家\nrun: (P0 P1)×2').r.order), 'P0 P1 P0 P1');
  // // 临界区 挂到前面那句上（标在 P / V 上不行：报出来）
  assert.equal(input.sys.temps[0].lines[3].cs, 'x');
  assert.throws(() => go('semaphore: s = 1\ncode:\nA: P(s); count++;\n'), /count 没有初值/);
  assert.throws(() => go('semaphore: s = 1\ncode:\nA: P(s); // 临界区\n'), /临界区.*不能标在 P\(s\) 上/);
  const marked = go('semaphore: s = 2\nrun: A B\ncode:\nA: P(s); 写文件; // 临界区\nB: P(s); 写文件 /* 临界区 */; V(s)');
  assert.equal(marked.r.steps.at(-1).view.bad[0].kind, 'race');
  assert.match(marked.r.steps.at(-1).msg, /A、B 同时在临界区里/);
});

test('写错了要报出来：没声明的信号量 / 变量、字段写到 code: 后面、run: 里的进程走不了', () => {
  assert.throws(() => go('code:\nP: P(mutex)'), /没有信号量 mutex/);
  assert.throws(() => go('semaphore: s = 1\ncode:\nP: P(s)\nrun: P P'), /run: 要写在 code: 前面/);
  assert.throws(() => go('semaphore: s = 1\ncode:\nP: if (n == 0) P(s)'), /n 没有初值/);
  assert.throws(() => go('problem: 生产者消费者\nrun: C C'), /第 2 步（C）要 C 走，可它阻塞在 full 上（这时能走的：P）/);
  assert.throws(() => go('problem: 读者写者\nrun: R W'), /R 有 2 个：写 R1、R2 里的一个/);
  assert.throws(() => go('problem: 读者写者\nrun: X'), /没有进程「X」/);
  assert.throws(() => go('problem: 生产者消费者\nrun: deadlock'), /怎么走都不会死锁（页面把所有 \d+ 种状态都试过了）/);
  assert.throws(() => go('problem: 哲学家 左撇子'), /不认识「左撇子」/);
  assert.throws(() => go('problem: 哲学家 限六人'), /限几人写 1～5/);
  // 限五人等于没限：照样会死锁；限四人不会
  assert.equal(pvSearch(sys('problem: 哲学家 限五人'), 'deadlock').found, true);
  assert.equal(sys('problem: 哲学家 最多 4 人'.replace(' 4 ', '4')).init.room, 4);
  assert.throws(() => go('problem: 吸烟者\nbuffer: 2'), /没有缓冲区/);
  assert.throws(() => go('semaphore: s[2] = 1\ncode:\nP(i)×3: P(s[i])'), /P2.*下标是 2，超出了 s\[0\]～s\[1\]/);
  assert.throws(() => go('problem: 生产者消费者\nswap: C1'), /swap: 没有进程 C1/);
  // P+ 一直不阻塞
  assert.throws(() => go('semaphore: s = 1\nrun: A+\ncode:\nA: while(1) { P(s); V(s) }'), /走了 60 句 A 也没有阻塞/);
});

test('先猜的问题：会不会阻塞、值是多少、唤醒谁、死锁了没有；第 0 步不问；题面带步号（错法比对靠它对上同一步）', () => {
  const { r } = go('problem: 生产者消费者\nbuffer: 1\nswap: P\nrun: deadlock');
  assert.ok(!r.steps[0].ask);
  const all = asks(r);
  assert.equal(new Set(all.map((a) => a.q)).size, all.length);
  const tags = new Set(all.map((a) => a.tag));
  for (const t of ['block', 'value', 'wake', 'deadlock', 'buffer']) assert.ok(tags.has(t), t);
  const last = r.steps.at(-1);
  assert.equal(last.ask.answer, '会阻塞');
  assert.equal(last.asks.find((a) => a.tag === 'deadlock').answer, '死锁了');
  assert.equal(last.asks.find((a) => a.tag === 'value').answer, -1);
  assert.ok(checkAsk(last.asks.find((a) => a.tag === 'value'), '-1').ok);
  // 没人等的 V：唤醒谁 → 不唤醒
  const v = all.find((a) => a.tag === 'wake');
  assert.equal(v.answer, '不唤醒');
});

test('常见错法：值不变成负数、减到 0 就阻塞、V 不唤醒、唤醒最后一个；答案一样的不列', () => {
  const { input, r } = go('problem: 生产者消费者 C×2\nbuffer: 1\nrun: C1 C2 P×6');
  const vs = pvEngine.variants(input, {});
  assert.ok(vs.length >= 2);
  const labels = vs.map((v) => v.label).join('\n');
  assert.match(labels, /不会变成负数/);
  assert.match(labels, /唤醒了最后一个/);
  const diag = (ask, given) => misreadAnswer(given, vs.map((v) => { const rr = pvEngine.run(v.input); const a = asks(rr).find((x) => x.q === ask.q); return a ? { label: v.label, answer: String(a.answer) } : null; }).filter(Boolean));
  // C2 阻塞时 full 是 −2；按「不会是负数」算是 0
  const val = asks(r).find((a) => a.tag === 'value' && /第 2 步/.test(a.q));
  assert.equal(val.answer, -2);
  assert.match(diag(val, '0'), /不会变成负数/);
  // P 的 V(full)：唤醒队头 C1；点 C2 是「唤醒了最后一个」
  const wake = asks(r).find((a) => a.tag === 'wake' && a.answer !== '不唤醒');
  assert.equal(wake.answer, 'C1');
  assert.match(diag(wake, 'C2'), /唤醒了最后一个/);
  assert.match(diag(wake, '不唤醒'), /没去唤醒/);
  // 一个人都不等的顺序：V 的错法看不出来，不列
  const quiet = go('problem: 生产者消费者\nbuffer: 2\nrun: P×6');
  assert.ok(!pvEngine.variants(quiet.input, {}).some((v) => /唤醒/.test(v.label)));
  // 每种错法都有说明
  assert.equal(MISTAKES.length, 5);
});

test('mode: quiz：有 run: 问走完以后的值，没有问会不会死锁；mode: fill：每个 P / V 之后的值', () => {
  const a = go('problem: 生产者消费者\nbuffer: 1\nrun: C P×6');
  const q = pvEngine.quiz(a.input, a.r, a.fields);
  assert.equal(q.answer, '1 0 0');
  assert.ok(textAnswerSpec('seq', q.answer).check('1 0 0').ok);
  const neg = go('problem: 生产者消费者\nrun: C');
  assert.equal(pvEngine.quiz(neg.input, neg.r, neg.fields).answer, '1 2 -1');
  assert.ok(textAnswerSpec('seq', '1 2 -1').check('1 2 -1').ok);
  const d = go('problem: 哲学家\nmode: quiz');
  const dq = pvEngine.quiz(d.input, d.r, d.fields);
  assert.ok(textAnswerSpec('seq', dq.answer).check('会').ok);
  assert.match(dq.explain, /P0 P1 P2 P3 P4 P0 P1 P2 P3 P4/);
  const ok = go('problem: 哲学家 互斥\nmode: quiz');
  assert.ok(textAnswerSpec('seq', pvEngine.quiz(ok.input, ok.r, ok.fields).answer).check('不会').ok);
  // find: bad：问会不会出错
  const nm = go('semaphore: empty = 1, full = 0\nbuffer: 1\nfind: bad\nmode: quiz\ncode:\nP×2: while(1) { P(empty); 放入; V(full) }\nC: while(1) { P(full); 取出; V(empty) }');
  assert.match(pvEngine.quiz(nm.input, nm.r, nm.fields).q, /有没有可能出错/);
  // 填表
  const t = pvEngine.table(a.input, a.r, a.fields);
  assert.deepEqual(t.head, ['mutex', 'empty', 'full']);
  assert.equal(t.rows[0].label, '开始');
  assert.ok(t.rows[0].cells.every((c) => c.given));
  assert.equal(t.rows[1].label, '1. C：P(full)');
  assert.deepEqual(t.rows[1].cells.map((c) => c.v), ['1', '1', '-1']);
  assert.equal(t.rows.length, 6); // 开始，C 的 P(full)，P 的 P(empty)、P(mutex)、V(mutex)、V(full)
  const spec = fillSpec(t, {}).table;
  const right = spec.rows.map((row) => row.cells.map((c) => c.v));
  assert.ok(checkFill(spec, right).ok);
  // 按「不会是负数」填的（−1 写成 0）：看得出来
  const wrong = right.map((row) => row.slice());
  wrong[1][2] = '0';
  const vs = pvEngine.variants(a.input, {}).map((v) => ({ label: v.label, table: pvEngine.table(v.input, pvEngine.run(v.input), {}) }));
  assert.match(misreadFill(spec, wrong, vs), /不会变成负数/);
});

test('自己点（pvdo 用的纯函数）：一步一步走、看每个进程的下一句；和 run 出来的一样', () => {
  const { input, r } = go('problem: 生产者消费者\nbuffer: 2\nswap: P\nrun: deadlock');
  let s = pvStart(input);
  assert.deepEqual(input.sys.procs.map((_, p) => procInfo(input, s, p).text), ['生产一个产品', 'P(full)']);
  r.order.forEach((p, k) => { s = pvMove(input, s, p, k + 1).state; });
  assert.deepEqual(s, r.final);
  assert.equal(procInfo(input, s, 0).state, 'blk');
  assert.equal(procInfo(input, s, 0).text, '阻塞在 empty');
  // exec 不改原来的状态
  const s0 = initState(input.sys);
  const copy = JSON.stringify(s0);
  exec(input.sys, s0, 1);
  assert.equal(JSON.stringify(s0), copy);
});

test('示例页 pv-demo.html 里的例子都能用：解析、走完、ask 都问得到、没有用不上的字段', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolveAsks, commonSpec, trackFields } = await import('../kit/src/stepperspec.js');
  const page = readFileSync(new URL('../kit/examples/pv-demo.html', import.meta.url), 'utf8');
  const found = [...page.matchAll(/^```pv\n([\s\S]*?)^```\s*$/gm)].map((m) => m[1]);
  assert.ok(found.length >= 5);
  for (const src of found) {
    const where = src.split('\n').find((l) => /^id:/.test(l)) || src.split('\n')[0];
    const tracked = trackFields(parseFields(pvEngine.head(src)).fields);
    const { fields } = tracked;
    const mode = String(fields.mode ?? '').trim();
    const input = pvEngine.parse(fields, src);
    const run = pvEngine.run(input);
    if (mode !== 'do') {
      const spec = commonSpec(fields);
      assert.deepEqual(resolveAsks(spec.ask, run.steps).errors, [], `${where}：ask 写的问不到`);
      if (spec.mode === 'quiz') assert.ok(pvEngine.quiz(input, run, fields), where);
      if (spec.mode === 'fill') assert.deepEqual(fillSpec(pvEngine.table(input, run, fields), fields).errors, [], where);
    }
    assert.deepEqual(pvEngine.problems(input, run), [], `${where}：自检有提醒`);
    fields.find; fields.ask; // 学生自己点的时候这两个字段由 pvdo.js 读
    assert.deepEqual(tracked.unknown(), [], `${where}：有用不上的字段`);
  }
});
