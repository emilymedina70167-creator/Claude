// 检验的模板补上 408 的题型（计划 4 Task 7）：retry: self × N、新字段换数（run 行、trace 的引擎字段、expect、wrong、result、example），
// 取到的数分不开 against 的错法、用到的量有并列时重取（和 where 不满足一样）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck, parseProbe, selfCheck, drawProbe, probeProblems, seeded, TPL_ROUNDS } from '../kit/src/check/spec.js';
import { materialize, DRAW_TRIES } from '../kit/src/check/template.js';
import { measure } from '../kit/src/engines/measures.js';
import { judgeMachine } from '../kit/src/check/judge.js';

const F = '```';
const errs = (head, body) => { const r = parseCheck(head, body); return { ...r, self: r.check ? selfCheck(r.check) : null }; };

// 希尔：每次另取 8 个不重复的两位数；只填第 1 趟（只填一趟时 shellBlock 偶尔和对的一样，要重取）
const SHELL = (id, { retry = 'self × 2', more = '' } = {}) => `${F}trace
id: ${id}
pick v = seq(8, 10, 99) distinct
q: 对 \\calc{list(v)} 做希尔排序（增量 4 2 1），写出第 1 趟以后的序列
target: 希尔排序分组
level: 方法
use: sort
algo: shell
array: \\calc{list(v)}
gaps: 4 2 1
rows: 1
against: shellBlock
teach tag=shellBlock: 相隔 d 的元素才是一组。
teach default: 一组一组地做直接插入。
${more}retry: ${retry}
${F}`;

// OPT：10 次访问、页号 1～4（取到的串有一半 OPT 有并列）；问换出的页（用到 victims）
const OPT = (id, retry = 'self x 2') => `${F}predict
id: ${id}
pick v = seq(10, 1, 4)
q: 3 个页框、OPT，访问 \\calc{list(v)}，依次换出哪几页
target: OPT 往后看
level: 方法
run r: paging algo=opt frames=3 refs="\\calc{list(v)}"
expect 换出的页: r.victims
expect 缺页次数: r.faults
wrong w1: r.faults + 1 => 多数了一次
teach default: 往后看谁最晚再用。
retry: ${retry}
${F}`;

const REC = (id) => `${F}recall\nid: ${id}\nq: 写\ntarget: T-${id}\nlevel: 核心\nmust m1: 要点\nteach default: 先想定义。\n${F}`;

test('retry: self × 2 读成两次本题；× x * 有无空格都认，self 单写是一次；和别的 id 一起写', () => {
  const body = (r) => ['block DS-L8.3 must=p1', SHELL('p1', { retry: r }), REC('p1c')].join('\n');
  for (const r of ['self × 2', 'self×2', 'self x 2', 'self*2', 'self * 2', 'self X2']) {
    const { check } = parseCheck('check id=k1', body(r));
    assert.deepEqual(check.probes.p1.retry, ['p1', 'p1'], r);
  }
  assert.deepEqual(parseCheck('check id=k1', body('self')).check.probes.p1.retry, ['p1']);
  assert.deepEqual(parseCheck('check id=k1', body('self, self')).check.probes.p1.retry, ['p1', 'p1']);
  const mixed = parseCheck('check id=k1', ['block DS-L8.3 must=p1', SHELL('p1', { retry: 'self × 2, p1c' }), SHELL('p1c', { retry: 'self' }).replace(/retry: .*\n/, '')].join('\n'));
  assert.deepEqual(mixed.errors, []);
  assert.deepEqual(mixed.check.probes.p1.retry, ['p1', 'p1', 'p1c']);
  assert.deepEqual(selfCheck(mixed.check), []);
  const m = materialize(mixed.check, { rand: seeded('mix') });
  assert.deepEqual(m.errors, []);
  assert.deepEqual(m.check.probes.p1.retry, ['p1~2', 'p1~3', 'p1c']);
  assert.ok(m.check.probes.p1c.picked);
  // 写在后面也照先后
  assert.deepEqual(parseCheck('check id=k1', body('p1c, self × 3')).check.probes.p1.retry, ['p1c', 'p1', 'p1', 'p1']);
});

test('没有 pick 的题写 self：写法错误', () => {
  const plain = `${F}recall\nid: p1\nq: 写\ntarget: x\nlevel: 核心\nmust m1: 要点\nteach default: 先想。\nretry: self × 2\n${F}`;
  const r = parseCheck('check id=k1', ['block L2.1.1 must=p1', plain].join('\n'));
  assert.ok(r.errors.some((e) => e.includes('self 只能写在带 pick 的题里（每次另取一组数）')), r.errors.join('\n'));
  const r0 = parseCheck('check id=k1', ['block L2.1.1 must=p1', plain.replace('self × 2', 'self × 0')].join('\n'));
  assert.ok(r0.errors.length, '× 0 也报');
});

test('drawProbe 换 trace 的引擎字段：每一道是新对象、新的 fields，traceTable 照取到的数排', () => {
  const p = parseCheck('check id=k1', ['block DS-L8.3 must=p1', SHELL('p1')].join('\n')).check.probes.p1;
  const a = drawProbe(p, { rand: seeded('a') });
  const b = drawProbe(p, { rand: seeded('b') });
  assert.notEqual(a.probe, b.probe);
  assert.notEqual(a.probe.fields, p.fields);
  assert.notEqual(a.probe.fields, b.probe.fields);
  assert.ok(!a.probe.fields.array.includes('\\calc'));
  assert.equal(a.probe.fields.array.split(' ').length, 8);
  assert.ok(!a.probe.q.includes('\\calc'));
  assert.equal(p.fields.array, '\\calc{list(v)}'); // 模板本身不动
  assert.notEqual(a.probe.fields.array, b.probe.fields.array);
  assert.match(a.picked, /^v=/);
});

test('trace 模板 against: shellBlock：materialize 出来的每一道都分得开（分不开的取数重取）', () => {
  const { check } = parseCheck('check id=k1', ['block DS-L8.3 must=p1', SHELL('p1')].join('\n'));
  const p = check.probes.p1;
  // 只取不查时确实会取到分不开的（证明重取那条路走得到）
  let raw = 0;
  const r = seeded('raw');
  for (let i = 0; i < 400; i++) if (probeProblems(drawProbe(p, { rand: r }).probe).some((m) => /shellBlock.*分不开/.test(m))) raw++;
  assert.ok(raw > 0, '400 组里没有一组分不开：这条测试量不到重取');
  for (let s = 0; s < 120; s++) {
    const m = materialize(check, { rand: seeded(`shell${s}`) });
    assert.deepEqual(m.errors, []);
    assert.deepEqual(m.check.order, ['p1', 'p1~2', 'p1~3']);
    for (const id of m.check.order) {
      const inst = m.check.probes[id];
      assert.deepEqual(probeProblems(inst), [], `${s} ${id} 取 ${inst.picked}`);
    }
  }
  assert.deepEqual(selfCheck(check), []);
});

test('predict 模板：run 行、expect、wrong 换数；OPT 取到并列重取，materialize 出来的每一道 victims 都没有并列', () => {
  const { check, errors } = parseCheck('check id=k1', ['block OS-L3.4 must=p2', OPT('p2')].join('\n'));
  assert.deepEqual(errors, []);
  const p = check.probes.p2;
  const d = drawProbe(p, { rand: seeded('one') });
  const refs = d.probe.runs[0].fields.refs;
  assert.ok(!refs.includes('\\calc') && refs.split(' ').length === 10, refs);
  assert.equal(p.runs[0].fields.refs, '\\calc{list(v)}');
  assert.notEqual(d.probe.runs, p.runs);
  assert.ok(!d.probe.q.includes('\\calc'));
  // 取到的那一组照样判
  const m0 = measure('paging', { algo: 'opt', frames: '3', refs });
  const right = judgeMachine(d.probe, { expects: { x1: m0.values.victims.join(' '), x2: String(m0.values.faults) } });
  assert.equal(right.items.find((x) => x.id === 'x2').ok, true, JSON.stringify(right.items));
  let ties = 0;
  for (let s = 0; s < 60; s++) {
    const m = materialize(check, { rand: seeded(`opt${s}`) });
    assert.deepEqual(m.errors, []);
    for (const id of m.check.order) {
      const inst = m.check.probes[id];
      const f = inst.runs[0].fields;
      assert.deepEqual(measure('paging', { algo: f.algo, frames: f.frames, refs: f.refs }).ties, [], `${s} ${id} 取 ${inst.picked}`);
      assert.deepEqual(probeProblems(inst), []);
    }
  }
  const r = seeded('tie');
  for (let i = 0; i < 40; i++) {
    const inst = drawProbe(p, { rand: r }).probe;
    if (probeProblems(inst).some((x) => /victims/.test(x) && /并列/.test(x))) ties++;
  }
  assert.ok(ties > 0, '40 组里没有并列：这条测试量不到重取');
  // 自检照 TPL_ROUNDS 组取：有并列的重取，不报
  assert.deepEqual(selfCheck(check), []);
  assert.ok(TPL_ROUNDS >= 8 && DRAW_TRIES >= 20);
});

test('并列每一组都躲不开（全是同一页）：自检报，报的话里写取到的数', () => {
  // 引用串 1 2 3 再加一页 5～9：第 4 次访问要换出 1、2、3 里的一页，三页以后都不再用，每一组都有并列
  const allTie = OPT('p2').replace('pick v = seq(10, 1, 4)', 'pick v = int(5, 9)').replaceAll('\\calc{list(v)}', '\\calc{v}').replace('refs="\\calc{v}"', 'refs="1 2 3 \\calc{v}"');
  const { check } = parseCheck('check id=k1', ['block OS-L3.4 must=p2', allTie].join('\n'));
  const e = selfCheck(check);
  assert.ok(e.some((x) => /p2（取 v=\d 时）/.test(x) && /victims/.test(x) && /并列/.test(x)), e.join('\n'));
  const m = materialize(check, { rand: seeded('all') });
  assert.ok(m.errors.some((x) => /取 v=/.test(x) && /并列/.test(x)), m.errors.join('\n'));
});

test('solve 的 result、construct 的 seq 格子 example 换数（\\calc 在公式外是纯文字）', () => {
  const solve = `${F}calc\nid: s1\npick a = int(2, 4)\nq: 求 $\\calc{a}^2$\ntarget: x\nlevel: 核心\nresult: \\calc{a^2}\nsteps:\ns1 calc: $\\calc{a}^2 = \\calc{a^2}$\n${F}`;
  const p = parseCheck('check id=k1', ['block L2.1.1 must=s1', solve].join('\n')).check.probes.s1;
  const inst = drawProbe(p, { rand: () => 0 }).probe;
  assert.equal(inst.result, '4');
  assert.deepEqual(probeProblems(inst), []);
  const con = `${F}construct
id: c1
pick v = seq(6, 10, 99) distinct
q: 把 \\calc{list(v)} 和一个数 x 拼起来，造一个让希尔排序不稳定的序列
target: 希尔不稳定
level: 方法
slots: S=seq(7)
run r: sort algo=shell array=S gaps="3 1"
if: r.unstable == 1 => 这一组排完相同的数没换先后
example: S=49 38 65 97 76 13 27
teach default: 让两个相同的数分在不同的组。
${F}`;
  const cp = parseCheck('check id=k1', ['block DS-L8.3 must=c1', con].join('\n')).check.probes.c1;
  const ci = drawProbe(cp, { rand: seeded('c') }).probe;
  assert.equal(ci.example.S, '49 38 65 97 76 13 27');
  const con2 = con.replace('example: S=49 38 65 97 76 13 27', 'example: S=\\calc{list(v)} 5');
  const ci2 = drawProbe(parseCheck('check id=k1', ['block DS-L8.3 must=c1', con2].join('\n')).check.probes.c1, { rand: seeded('c') }).probe;
  assert.ok(!ci2.example.S.includes('\\calc'));
  assert.equal(ci2.example.S.split(' ').length, 7);
  assert.equal(ci2.calcErrors.length, 0);
});

test('main 上的模板照旧：construct 的 self、TPL_ROUNDS 组自检', () => {
  const tpl = `${F}construct
id: p1
pick k = int(2, 5)
q: 造一个 2 阶矩阵 $A$，使 $A^2 = \\calc{k}A$
target: L2-14
level: 基础
slots: A=mat(2)
if: A*A == k*A => $A^2$ 不等于 \\calc{k}$A$
if: A != k*E => 写成了 $\\calc{k}E$
if: A != O => 零矩阵不算
example: A=[[k,0],[0,0]]
teach if1: 先想 $A$ 的列满足什么。
retry: self × 2
${F}`;
  const r = errs('check id=k1', ['block L2.1.1 must=p1', tpl].join('\n'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.self, []);
  const m = materialize(r.check, { rand: seeded('k') });
  assert.deepEqual(m.check.order, ['p1', 'p1~2', 'p1~3']);
  assert.notEqual(m.check.probes['p1~2'].picked, m.check.probes['p1~3'].picked);
});

test('英语、code 不做模板：照旧报', () => {
  assert.match(parseProbe('code', 'id: c\nq: 写\ntarget: x\nlevel: 核心\npick k = int(1, 3)\ntests:\nf(1) -> 1\nref: int f(int x){return x;}').error || '', /模板/);
});
