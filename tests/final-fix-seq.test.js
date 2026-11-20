// dr-final-fix 第 2、3、4 条：检验里学生写的序列和最后的值（kit/src/check/values.js、spec.js、judge.js、engines/measures.js）
//   2. 先后顺序写箭头（P1→P3→P2→P4、150→160→184）判对；字的序列还认 - —；数的序列 - 照旧是负号、交之前挡
//   3. 相同的数：final、pass#、round# 带撇号；学生没写撇号只比数，写了连位置一起比
//   4. solve / calc 的最后的值、predict 的数：十六进制、二进制、式子都认；带单位交之前挡；判的时候还读不懂是待核 null
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe, probeIssues } from '../kit/src/check/spec.js';
import { judgeMachine, expectProblems, resultProblem } from '../kit/src/check/judge.js';
import { measure } from '../kit/src/engines/measures.js';
import { valueMatch } from '../kit/src/check/values.js';

const P = (type, src) => { const r = parseProbe(type, src); if (r.error) throw new Error(r.error); return r.probe; };
const item = (r, id) => r.items.find((x) => x.id === id);
const HEAD = 'id: q\nq: 题\ntarget: t\nlevel: 方法\n';

// —— 第 2 条：箭头 ——

const SJF = P('predict', `${HEAD}run r: sched algo=sjf procs="P1 0 7, P2 2 4, P3 4 1, P4 5 4"\nexpect 运行先后: r.order`);

test('predict 的运行先后：箭头、->、- 隔开都对，先后错了照旧不对', () => {
  for (const s of ['P1→P3→P2→P4', 'P1->P3->P2->P4', 'P1-P3-P2-P4', 'P1 → P3 → P2 → P4', 'P1—P3—P2—P4', 'P1⇒P3⇒P2⇒P4', 'P1 P3 P2 P4']) {
    assert.deepEqual(expectProblems(SJF, { x1: s }), [], s);
    assert.equal(item(judgeMachine(SJF, { expects: { x1: s } }), 'x1').ok, true, s);
  }
  assert.equal(item(judgeMachine(SJF, { expects: { x1: 'P1→P2→P3→P4' } }), 'x1').ok, false);
});

test('数的序列：150→160→184、7→0→1 对；150-160-184 照旧交之前挡（- 是负号）', () => {
  const d = P('predict', `${HEAD}run r: disk algo=fcfs head=100 requests="150 160 184"\nexpect 服务先后: r.order`);
  for (const s of ['150→160→184', '150->160->184', '150 > 160 > 184']) {
    assert.deepEqual(expectProblems(d, { x1: s }), [], s);
    assert.equal(item(judgeMachine(d, { expects: { x1: s } }), 'x1').ok, true, s);
  }
  assert.match(expectProblems(d, { x1: '150-160-184' })[0], /写一串数/);
  const f = P('predict', `${HEAD}run r: paging algo=fifo frames=3 refs="7 0 1 2 0 3 0 4"\nexpect 换出的页: r.victims`);
  assert.equal(item(judgeMachine(f, { expects: { x1: '7→0→1→2' } }), 'x1').ok, true);
  assert.equal(valueMatch('7→0→1', [7, 0, 1]), true);
});

test('construct 的 seq 格子也认箭头', () => {
  const k = P('construct', `${HEAD}slots: R=seq(3)\nrun r: disk algo=fcfs head=50 requests=R\nif: r.dist >= 100 => 太短\nexample: R=10 90 20`);
  const r = judgeMachine(k, { slots: { R: '10→90→20' } });
  assert.equal(item(r, 'if1').ok, true);
});

// —— 第 3 条：撇号 ——

test('简单选择排序 5 8 5′ 2 9：final、pass#、round# 带撇号', () => {
  const v = measure('sort', { algo: 'select', array: '5 8 5′ 2 9' }).values;
  assert.deepEqual(v.final, [2, '5′', 5, 8, 9]);
  assert.deepEqual(v.pass1, [2, 8, '5′', 5, 9]);
  const q = measure('sort', { algo: 'quick', array: '3 1 3 2' }).values;
  assert.deepEqual(q.round1, [2, 1, '3′', 3]);
  assert.deepEqual(q.final, [1, 2, '3′', 3]);
  // 没有相同的数：照旧全是数
  assert.deepEqual(measure('sort', { algo: 'insert', array: '3 1 2' }).values.final, [1, 2, 3]);
});

test('predict r.final：照实写撇号对、标反了不对、不写撇号只比数', () => {
  const p = P('predict', `${HEAD}run r: sort algo=select array="5 8 5′ 2 9"\nexpect 排完: r.final\nexpect 第一趟: r.pass1`);
  const ok = (x1, x2 = '2 8 5 5 9') => item(judgeMachine(p, { expects: { x1, x2 } }), 'x1').ok;
  assert.equal(ok('2 5′ 5 8 9'), true);
  assert.equal(ok("2 5' 5 8 9"), true);
  assert.equal(ok('2 5 5′ 8 9'), false, '撇号标反了');
  assert.equal(ok('2 5 5 8 9'), true, '不写撇号只比数');
  assert.equal(item(judgeMachine(p, { expects: { x1: '2 5 5 8 9', x2: '2 8 5′ 5 9' } }), 'x2').ok, true);
  assert.equal(item(judgeMachine(p, { expects: { x1: '2 5 5 8 9', x2: '2 8 5 5′ 9' } }), 'x2').ok, false);
});

test('希尔 49 38 65 97 76 13 27 49′（增量 4 2 1，稳定）：49 49′ 对、49′ 49 错', () => {
  const p = P('predict', `${HEAD}run r: sort algo=shell array="49 38 65 97 76 13 27 49′"\nexpect 排完: r.final`);
  const ok = (s) => item(judgeMachine(p, { expects: { x1: s } }), 'x1').ok;
  assert.equal(ok('13 27 38 49 49′ 65 76 97'), true);
  assert.equal(ok('13 27 38 49′ 49 65 76 97'), false);
  assert.equal(ok('13 27 38 49 49 65 76 97'), true);
});

test('construct 的条件：P in r.flipped、r.unstable 照旧；r.final 和 seq 格子比照撇号的规矩', () => {
  const sh = P('construct', `${HEAD}slots: A=seq(8) P=seq(2)\nrun r: sort algo=shell gaps="4 2 1" array=A\nif: r.unstable >= 1 => 稳定\nif: P in r.flipped => 这一对没换\nexample: A=4 7 4 1 2 5 7 8 P=4 4'`);
  const r = judgeMachine(sh, { slots: { A: '4 7 4 1 2 5 7 8', P: "4 4'" } });
  assert.equal(item(r, 'if1').ok, true);
  assert.equal(item(r, 'if2').ok, true);
  const k = P('construct', `${HEAD}slots: A=seq(5) B=seq(5)\nrun r: sort algo=select array=A\nif: B == r.final => 不是排完的样子\nexample: A=5 8 5 2 9 B=2 5′ 5 8 9`);
  assert.equal(item(judgeMachine(k, { slots: { A: '5 8 5 2 9', B: '2 5 5 8 9' } }), 'if1').ok, true, '没写撇号只比数');
  assert.equal(item(judgeMachine(k, { slots: { A: '5 8 5 2 9', B: '2 5′ 5 8 9' } }), 'if1').ok, true);
  assert.equal(item(judgeMachine(k, { slots: { A: '5 8 5 2 9', B: '2 5 5′ 8 9' } }), 'if1').ok, false);
});

test('错法照旧认得出来（错法那一遍只有数，比数）', () => {
  const p = P('predict', `${HEAD}run r: sort algo=shell gaps="4 2 1" array="49 38 65 97 76 13 27 49"\nexpect 第一趟: r.pass1\nagainst: shellBlock`);
  const right = item(judgeMachine(p, { expects: { x1: '49 13 27 49′ 76 38 65 97' } }), 'x1');
  assert.equal(right.ok, true);
});

// —— 第 4 条：最后的值 ——

const HEXQ = (result) => P('calc', `${HEAD}steps:\ns1 calc: 换算\nresult: ${result}`);

test('calc result: 0x3A3C：0x3A3C、3A3CH、3a3ch、14908 都对，3A3DH 不对', () => {
  const p = HEXQ('0x3A3C');
  for (const s of ['0x3A3C', '3A3CH', '3a3ch', '14908', '３Ａ３ＣＨ']) {
    assert.equal(resultProblem(p, s), '', s);
    assert.equal(item(judgeMachine(p, { text: '…', result: s }), 'result').ok, true, s);
  }
  assert.equal(item(judgeMachine(p, { text: '…', result: '3A3DH' }), 'result').ok, false);
});

test('二进制 1011B、0b1011 和对的值按数比', () => {
  const p = HEXQ('11');
  for (const s of ['1011B', '0b1011', '11']) assert.equal(item(judgeMachine(p, { text: '…', result: s }), 'result').ok, true, s);
  assert.equal(item(judgeMachine(p, { text: '…', result: '1010B' }), 'result').ok, false);
});

test('高数的 solve：result: pi/4 写 π/4、e^2、ln 2、√2/2、2^10、1/√2 照式子算', () => {
  const cases = [['pi/4', ['π/4', 'pi/4', '0.25π']], ['e^2', ['e^2', 'e²']], ['ln(2)', ['ln 2', 'ln2']], ['sqrt(2)/2', ['√2/2', '1/√2']], ['1024', ['2^10']]];
  for (const [result, writes] of cases) {
    const p = P('solve', `${HEAD}steps:\ns1 calc: 算\nresult: ${result}`);
    for (const s of writes) {
      assert.equal(resultProblem(p, s), '', `${result} ${s}`);
      assert.equal(item(judgeMachine(p, { text: '…', result: s }), 'result').ok, true, `${result} ${s}`);
    }
    assert.equal(item(judgeMachine(p, { text: '…', result: '1/0' }), 'result').ok, false, `${result} 1/0`);
  }
  const q = P('solve', `${HEAD}steps:\ns1 calc: 算\nresult: pi/4`);
  assert.equal(item(judgeMachine(q, { text: '…', result: 'π/3' }), 'result').ok, false);
  assert.equal(item(judgeMachine(q, { text: '…', result: '∞' }), 'result').ok, false);
});

test('result: 0.85：85%、17/20 照旧对', () => {
  const p = HEXQ('0.85');
  for (const s of ['85%', '17/20', '0.85']) assert.equal(item(judgeMachine(p, { text: '…', result: s }), 'result').ok, true, s);
});

test('带单位交之前挡；判的时候还读不懂是待核 null，不是 false（predict、calc、solve）', () => {
  const p = HEXQ('200');
  assert.match(resultProblem(p, '200ns'), /只写数.*不写单位/);
  assert.match(resultProblem(HEXQ('1024'), '1KB'), /只写数.*不写单位/);
  assert.equal(resultProblem(p, ''), '');
  const r = item(judgeMachine(p, { text: '…', result: '200ns' }), 'result');
  assert.equal(r.ok, null);
  const s = P('solve', `${HEAD}steps:\ns1 calc: 算\nresult: pi/4`);
  assert.equal(item(judgeMachine(s, { text: '…', result: '四分之π' }), 'result').ok, null);
  const lru = P('predict', `${HEAD}run r: paging algo=lru frames=3 refs="1 2 3 4 1 2 5 1 2 3 4 5"\nexpect 缺页次数: r.faults`);
  assert.match(expectProblems(lru, { x1: '10次' })[0], /不写单位/);
  assert.equal(item(judgeMachine(lru, { expects: { x1: '10次' } }), 'x1').ok, null);
});

test('predict 的数也用同一个读法：十六进制、式子', () => {
  const lru = P('predict', `${HEAD}run r: paging algo=lru frames=3 refs="1 2 3 4 1 2 5 1 2 3 4 5"\nexpect 缺页次数: r.faults\nexpect 缺页率: r.rate`);
  assert.deepEqual(expectProblems(lru, { x1: 'AH', x2: '10/12' }), []);
  const r = judgeMachine(lru, { expects: { x1: 'AH', x2: '5/6' } });
  assert.equal(item(r, 'x1').ok, true);
  assert.equal(item(r, 'x2').ok, true);
});

// —— 裁定（第二次提交）：后缀的进制和单位分不清时待核；带撇号的量不拿来算 ——

test('100B、10h：按进制对得上 → 对；按进制对不上、当十进制对得上 → 待核 null；都对不上 → 错', () => {
  const r = (right, s) => item(judgeMachine(HEXQ(String(right)), { text: '…', result: s }), 'result');
  assert.equal(r(100, '100B').ok, null);
  assert.match(r(100, '100B').why, /「100B」是二进制还是 100 个字节？页面判不了，主讲会核/);
  assert.equal(r(4, '100B').ok, true);
  assert.equal(r(7, '100B').ok, false);
  assert.equal(r(5, '5h').ok, true, '按十六进制读已经对得上');
  assert.equal(r(10, '10B').ok, null);
  assert.equal(r(2, '10B').ok, true);
  assert.equal(r(10, '10h').ok, null);
  assert.match(r(10, '10h').why, /十六进制还是 10 小时/);
  assert.equal(r(16, '10H').ok, true);
  assert.equal(r(100, '0b100').ok, false, '带前缀的不含糊');
  const lru = P('predict', `${HEAD}run r: paging algo=lru frames=3 refs="1 2 3 4 1 2 5 1 2 3 4 5"\nexpect 缺页次数: r.faults`);
  assert.equal(item(judgeMachine(lru, { expects: { x1: '10B' } }), 'x1').ok, null);
  assert.equal(item(judgeMachine(lru, { expects: { x1: '1010B' } }), 'x1').ok, true);
});

test('自检：r.final、r.pass#、r.round# 放进算式里报写法错误，整串比不报', () => {
  const bad = P('predict', `${HEAD}run r: sort algo=select array="5 8 5′ 2 9"\nexpect 和: sum(r.final)`);
  assert.ok(probeIssues(bad).hard.some((m) => /r\.final 有相同的数时带撇号，是一串字，不拿来算/.test(m)), JSON.stringify(probeIssues(bad)));
  const bad2 = P('calc', `${HEAD}steps:\ns1 calc: 算\nrun r: sort algo=select array="5 8 5′ 2 9"\nresult: el(r.pass1, 2) + 1`);
  assert.ok(probeIssues(bad2).hard.some((m) => /r\.pass1 有相同的数时带撇号/.test(m)));
  const ok = P('predict', `${HEAD}run r: sort algo=select array="5 8 5′ 2 9"\nexpect 排完: r.final\nexpect 比较: r.cmp`);
  assert.ok(!probeIssues(ok).hard.some((m) => /带撇号/.test(m)));
  const k = P('construct', `${HEAD}slots: A=seq(5) B=seq(5)\nrun r: sort algo=select array=A\nif: B == r.final => 不是排完的样子\nexample: A=5 8 5 2 9 B=2 5′ 5 8 9`);
  assert.ok(!probeIssues(k).hard.some((m) => /带撇号/.test(m)));
});
