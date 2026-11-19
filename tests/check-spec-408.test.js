// 检验 408 的写法（计划 4 Task 2）：run 行、seq / text / procs 格子、字的条件、predict 的写法、against（kit/src/check/spec.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCheck, parseProbe, selfCheck, PROBE_TYPES, BASE_OF, baseType, facetDefault,
  slotProblems, runVars, runFields, evalIfs, parseNamed,
} from '../kit/src/check/spec.js';

const F = '```';
const fence = (type, body) => `${F}${type}\n${body.trim()}\n${F}`;
const errsOf = (body) => { const { check, errors } = parseCheck('check id=k1', body); return [...errors, ...(check ? selfCheck(check) : [])]; };
const probeOf = (type, body) => { const r = parseProbe(type, body.trim()); assert.equal(r.error, undefined, r.error); return r.probe; };

// 希尔排序不稳定：学生造 8 个数和换了先后的那一对
const SHELL = (id, extra = '') => `
id: ${id}
q: 造 8 个数，用增量 4 2 1 的希尔排序排完，相同的数先后变了；再写出变了先后的那一对
target: 以为希尔排序稳定
level: 核心
slots: A=seq(8) P=seq(2)
run r: sort algo=shell gaps="4 2 1" array=A
if: r.unstable >= 1 => 这一组排完，相同的数先后没变
if: P in r.flipped => 写的这一对不是被换了先后的那一对
example: A=4 7 4 1 2 5 7 8 P=[4 4']
teach if1: 增量大于 1 的那几趟，相隔很远的两个数会越过中间那个相同的数。
${extra}`;

test('常量：PROBE_TYPES 多了 408、英语的题型；tradeoff、calc 是别名', () => {
  for (const t of ['trace', 'predict', 'tradeoff', 'code', 'calc', 'parse', 'translate', 'rewrite', 'errfind']) assert.ok(PROBE_TYPES.includes(t), t);
  assert.deepEqual(BASE_OF, { tradeoff: 'recall', calc: 'solve' });
  assert.equal(baseType({ type: 'tradeoff' }), 'recall');
  assert.equal(baseType({ type: 'calc' }), 'solve');
  assert.equal(baseType({ type: 'construct' }), 'construct');
});

test('还没接上的题型报「这一种还没接上」；tradeoff 照 recall 读、type 存 tradeoff', () => {
  for (const t of ['trace', 'code', 'parse', 'translate', 'rewrite', 'errfind']) {
    assert.match(parseProbe(t, 'id: q\ntarget: x\nlevel: 基础').error, new RegExp(`${t}：这一种还没接上`));
  }
  const p = probeOf('tradeoff', 'id: q\nq: 链表和顺序表各好在哪\ntarget: x\nlevel: 方法\nmust: 随机存取');
  assert.equal(p.type, 'tradeoff');
  assert.equal(p.facet, '重建');
  assert.equal(p.must[0].text, '随机存取');
});

test('facetDefault：408 的块 construct 是边界，数学的照旧能用', () => {
  assert.equal(facetDefault('construct', 'DS-L8.3'), '边界');
  assert.equal(facetDefault('construct', 'OS-L3.2#opt'), '边界');
  assert.equal(facetDefault('construct', 'L2.1.4'), '能用');
  assert.equal(facetDefault('predict', 'DS-L8.3'), '能用');
  assert.equal(facetDefault('recall', 'CN-L1.1'), '重建');
});

test('格子：seq(n)、seq、text、procs(n)、procs(n, prio)', () => {
  const p = probeOf('construct', `id: q\ntarget: x\nlevel: 基础\nslots: A=seq(8) B=seq T=text Q=procs(3) R=procs(2, prio)\nif: A == A\nexample: A=1 2 3 4 5 6 7 8 B=1 T=甲 Q=P1 0 3, P2 1 2, P3 2 1 R=P1 0 3 1, P2 1 2 2`);
  assert.deepEqual(p.slots, [
    { name: 'A', kind: 'seq', n: 8 }, { name: 'B', kind: 'seq', n: null }, { name: 'T', kind: 'text' },
    { name: 'Q', kind: 'procs', n: 3, prio: false }, { name: 'R', kind: 'procs', n: 2, prio: true },
  ]);
  // example 里这几种收原文
  assert.equal(p.example.A, '1 2 3 4 5 6 7 8');
  assert.equal(p.example.Q, 'P1 0 3, P2 1 2, P3 2 1');
  assert.equal(parseNamed('A=[4 4\'] B=[[1,2],[3,4]]', {}, [{ name: 'A', kind: 'seq', n: 2 }, { name: 'B', kind: 'mat', r: 2, c: 2 }]).A, "4 4'");
});

test('slotProblems：数的个数、不是数、进程少一格；格式对的是空的', () => {
  const S8 = { name: 'A', kind: 'seq', n: 8 };
  assert.deepEqual(slotProblems(S8, '1 2 3 4 5 6 7'), ['要 8 个数，写了 7 个']);
  assert.deepEqual(slotProblems(S8, '[1, 2, 3, 4, 5, 6, 7, 8]'), []);
  assert.deepEqual(slotProblems(S8, "49 38 65 97 76 13 27 49'"), []);
  assert.match(slotProblems(S8, '1 2 3 4 5 6 7 x').join(), /「x」不是数/);
  assert.match(slotProblems({ name: 'B', kind: 'seq', n: null }, Array.from({ length: 25 }, (_, i) => i).join(' ')).join(), /最多 24 个/);
  const Q = { name: 'Q', kind: 'procs', n: 2, prio: false };
  assert.deepEqual(slotProblems(Q, 'P1 0 3, P2 1 2'), []);
  assert.match(slotProblems(Q, 'P1 0 3, P2 1').join(), /P2 少一格/);
  assert.match(slotProblems(Q, 'P1 0 3').join(), /要 2 个进程，写了 1 个/);
  assert.match(slotProblems({ name: 'R', kind: 'procs', n: 1, prio: true }, 'P1 0 3').join(), /P1 少一格.*优先级/);
  assert.match(slotProblems({ name: 'T', kind: 'text' }, '  ').join(), /要写/);
  assert.deepEqual(slotProblems({ name: 'A', kind: 'mat', r: 2, c: 2 }, [['1']]), []); // 矩阵的格子不归这里管
});

test('希尔不稳定的 construct：run 行、条件里的量、字的条件；selfCheck 是空的；408 的块默认边界', () => {
  const p = probeOf('construct', SHELL('p1'));
  assert.deepEqual(p.runs, [{ name: 'r', engine: 'sort', fields: { algo: 'shell', gaps: '4 2 1', array: 'A' } }]);
  assert.equal(p.example.A, '4 7 4 1 2 5 7 8');
  const body = ['block DS-L8.2 must=p1', fence('construct', SHELL('p1', 'retry: p1a, p1b')), fence('construct', SHELL('p1a')), fence('construct', SHELL('p1b'))].join('\n');
  const { check } = parseCheck('check id=k1', body);
  assert.equal(check.probes.p1.facet, '边界');
  assert.deepEqual(selfCheck(check), []);
  // 写了 facet 的照写的
  const own = parseCheck('check id=k1', ['block DS-L8.2 must=p1', fence('construct', SHELL('p1', 'facet: 能用\nretry: p1a, p1b')), fence('construct', SHELL('p1a')), fence('construct', SHELL('p1b'))].join('\n')).check;
  assert.equal(own.probes.p1.facet, '能用');
});

test('runVars：学生的格子代进 run；量写成 r__unstable；条件判得出来', () => {
  const p = probeOf('construct', SHELL('p1'));
  const good = runVars(p, { A: '4 7 4 1 2 5 7 8', P: "4' 4" });
  assert.equal(good.error, undefined);
  assert.equal(good.vars.r__unstable, 1);
  assert.deepEqual(good.vars.r__flipped, ['4 4′']);
  assert.deepEqual(good.ties, []);
  assert.deepEqual(evalIfs(p.ifs, { A: '4 7 4 1 2 5 7 8', P: "4' 4" }, good.vars, p.slots).map((x) => x.ok), [true, true]);
  // P 写成「4 4」也是那一对（后一个页面记成 4′）
  assert.deepEqual(evalIfs(p.ifs, { A: '4 7 4 1 2 5 7 8', P: '4 4' }, good.vars, p.slots).map((x) => x.ok), [true, true]);
  // 写了不是那一对
  assert.deepEqual(evalIfs(p.ifs, { A: '4 7 4 1 2 5 7 8', P: '7 7' }, good.vars, p.slots).map((x) => x.ok), [true, false]);
  // 造的数排完是稳定的
  const stable = runVars(p, { A: '49 38 65 97 76 13 27 49', P: '49 49' });
  assert.equal(stable.vars.r__unstable, 0);
  assert.deepEqual(evalIfs(p.ifs, { A: '49 38 65 97 76 13 27 49', P: '49 49' }, stable.vars, p.slots).map((x) => x.ok), [false, false]);
});

test('runVars：相同的数页面加撇号，notes 里说一声', () => {
  const p = probeOf('construct', `id: q\ntarget: x\nlevel: 基础\nslots: A=seq(3)\nrun r: sort algo=insert array=A\nif: r.unstable == 0\nexample: A=1 2 3`);
  const v = runVars(p, { A: '49 38 49' });
  assert.deepEqual(v.notes, ['页面把第二个 49 记成 49′']);
  assert.deepEqual(runVars(p, { A: '1 2 3' }).notes, []);
});

test('runVars：引擎不收（AVL 里有重复的数）error 是引擎原话', () => {
  const p = probeOf('construct', `id: q\ntarget: x\nlevel: 基础\nslots: S=seq(4)\nrun t: avl avl=S\nif: t.LR >= 1 => 没有 LR\nexample: S=3 1 2 4`);
  const v = runVars(p, { S: '3 1 3 4' });
  assert.deepEqual(v.error, { run: 't', msg: 'avl: 关键字 3 写了两次（查找树里不放相同的关键字）' });
});

test('数学的 construct 照旧能用：facet 能用、if 的样子不变', () => {
  const p = probeOf('construct', 'id: q\ntarget: x\nlevel: 基础\nslots: A=mat(2) B=mat(2)\nif: A != B => 相等了\nexample: A=[[1,0],[0,0]] B=[[0,0],[0,1]]');
  assert.deepEqual(p.ifs, [{ id: 'if1', text: 'A != B', msg: '相等了' }]);
  assert.equal(p.runs, undefined);
  const { check } = parseCheck('check id=k1', `block L2.1.1 must=q\n${fence('construct', 'id: q\ntarget: x\nlevel: 基础\nslots: A=mat(2) B=mat(2)\nif: A != B => 相等了\nexample: A=[[1,0],[0,0]] B=[[0,0],[0,1]]\nteach default: 一\nretry: q, q')}`);
  assert.equal(check.probes.q.facet, '能用');
  assert.deepEqual(evalIfs(p.ifs, { A: [[1, 0], [0, 0]], B: [[1, 0], [0, 0]] }).map((x) => x.ok), [false]);
});

test('selfCheck：example 不满足报出来；量名写错报出这个引擎的量；引擎不交量', () => {
  const bad = SHELL('p1').replace('A=4 7 4 1 2 5 7 8', 'A=49 38 65 97 76 13 27 49').replace("P=[4 4']", 'P=49 49');
  const e1 = errsOf(['block DS-L8.2 optional=p1', 'block DS-L8.3 must=p0', fence('construct', bad)].join('\n'));
  assert.ok(e1.some((e) => /p1/.test(e) && /example 不满足 if1/.test(e)), e1.join('\n'));
  const typo = SHELL('p1').replace('r.unstable >= 1', 'r.unstabel >= 1');
  const e2 = errsOf(['block DS-L8.2 optional=p1', fence('construct', typo)].join('\n'));
  assert.ok(e2.some((e) => /unstabel/.test(e) && /sort/.test(e) && /flipped/.test(e)), e2.join('\n'));
  const noEngine = SHELL('p1').replace('run r: sort', 'run r: elim');
  const e3 = errsOf(['block DS-L8.2 optional=p1', fence('construct', noEngine)].join('\n'));
  assert.ok(e3.some((e) => /elim/.test(e) && /不交量/.test(e)), e3.join('\n'));
  // example 的格式不对也报
  const short = SHELL('p1').replace('A=4 7 4 1 2 5 7 8', 'A=4 7 4 1 2 5 7');
  const e4 = errsOf(['block DS-L8.2 optional=p1', fence('construct', short)].join('\n'));
  assert.ok(e4.some((e) => /example 的 A/.test(e) && /要 8 个数，写了 7 个/.test(e)), e4.join('\n'));
});

test('construct 不写 against；run 名字和格子撞了报', () => {
  assert.match(parseProbe('construct', SHELL('p1', 'against: shellBlock')).error, /against/);
  assert.match(parseProbe('construct', SHELL('p1').replace('run r:', 'run A:').replace(/r\./g, 'A.')).error, /A/);
});

test('字的条件：== != in；不管空格、逗号、大小写、撇号', () => {
  const slots = [{ name: 'P', kind: 'seq', n: null }, { name: 'T', kind: 'text' }];
  const ifs = [
    { id: 'if1', text: 'P == r.order', msg: '' },
    { id: 'if2', text: 'T != "p3"', msg: '' },
    { id: 'if3', text: 'P in r.flipped', msg: '' },
    { id: 'if4', text: 'T in "P1 | p2"', msg: '' },
    { id: 'if5', text: 'r.faults == 9', msg: '' },
    { id: 'if6', text: 'r.rate < 1', msg: '' },
  ];
  const vars = { r__order: ['2', "3'", '1'], r__flipped: ['5 5′', '3 3′'], r__faults: 9, r__rate: 0.75 };
  const ok = evalIfs(ifs, { P: '[2, 3’, 1]', T: 'P2' }, vars, slots);
  assert.deepEqual(ok.map((x) => x.ok), [true, true, false, true, true, true]);
  const ok2 = evalIfs(ifs, { P: '3,3_', T: 'p3' }, vars, slots);
  assert.deepEqual(ok2.map((x) => x.ok), [false, false, true, false, true, true]);
  // == 有先后，in 不论先后
  assert.equal(evalIfs([ifs[0]], { P: '1 2 3′' }, vars, slots)[0].ok, false);
  assert.equal(evalIfs([ifs[2]], { P: "3' 3" }, vars, slots)[0].ok, true);
});

test('条件的写法不对在读的时候报', () => {
  assert.match(parseProbe('construct', SHELL('p1').replace('r.unstable >= 1', 'r.unstable')).error, /==|写成/);
});

// LRU：缺页次数（认 fifo、noInitial）、最后换出的页
const LRU = (id, extra = '') => `
id: ${id}
q: 3 个页框、LRU，访问 1 2 3 4 1 2 5 1 2 3 4 5，缺页几次？最后换出的是哪一页？说说理由
target: LRU 当成 FIFO
level: 方法
run r: paging algo=lru frames=3 refs="1 2 3 4 1 2 5 1 2 3 4 5"
expect 缺页次数: r.faults
wrong w1: r.faults - 3 => 开头装进 3 个空页框的那 3 次也是缺页
expect x2 最后换出的页: 2
against: fifo, noInitial
must: 换出的是最久没用过的那一页
wrong: 换出的是最早装进来的
teach tag=fifo: LRU 看的是最近一次用到的时候，不是装进来的时候。
teach w1: 一开始页框是空的，装进去也是缺页。
teach x2: 往前找，三页里最久没被访问的那一页。
${extra}`;

test('predict：run、expect（编号、标签、值）、带 => 的 wrong 挂在上面最近的 expect、against、理由', () => {
  const p = probeOf('predict', LRU('p2'));
  assert.equal(p.type, 'predict');
  assert.equal(p.facet, '能用');
  assert.deepEqual(p.runs, [{ name: 'r', engine: 'paging', fields: { algo: 'lru', frames: '3', refs: '1 2 3 4 1 2 5 1 2 3 4 5' } }]);
  assert.deepEqual(p.expects, [
    { id: 'x1', label: '缺页次数', value: 'r.faults', wrongs: [{ id: 'w1', expr: 'r.faults - 3', msg: '开头装进 3 个空页框的那 3 次也是缺页' }] },
    { id: 'x2', label: '最后换出的页', value: '2', wrongs: [] },
  ]);
  assert.deepEqual(p.against, ['fifo', 'noInitial']);
  // 不带 => 的 wrong 是理由里的常见错说法，编号不和上面的 w1 撞
  assert.deepEqual(p.must.map((m) => m.text), ['换出的是最久没用过的那一页']);
  assert.deepEqual(p.wrong, [{ id: 'w2', text: '换出的是最早装进来的' }]);
  assert.equal(p.teach['tag=fifo'], 'LRU 看的是最近一次用到的时候，不是装进来的时候。');
  const v = runVars(p, {});
  assert.equal(v.vars.r__faults, 10);
});

test('predict：带 => 的 wrong 写在 expect 前面报；要有 run 和 expect', () => {
  assert.match(parseProbe('predict', 'id: q\ntarget: x\nlevel: 基础\nrun r: paging algo=lru frames=3 refs="1 2 3"\nwrong w1: 3 => 说明\nexpect: r.faults').error, /expect/);
  assert.match(parseProbe('predict', 'id: q\ntarget: x\nlevel: 基础\nexpect: 3').error, /run/);
  assert.match(parseProbe('predict', 'id: q\ntarget: x\nlevel: 基础\nrun r: paging algo=lru frames=3 refs="1 2 3"').error, /expect/);
});

const wrap = (type, body) => ['block OS-L3.4 must=p2', fence(type, body + 'retry: p2a, p2b'), fence(type, body.replace(/id: p2/, 'id: p2a')), fence(type, body.replace(/id: p2/, 'id: p2b'))].join('\n');

test('predict 的 selfCheck：样板是空的；expect 算不出来、量名写错报', () => {
  assert.deepEqual(errsOf(wrap('predict', LRU('p2'))), []);
  const e = errsOf(wrap('predict', LRU('p2').replace('expect 缺页次数: r.faults', 'expect 缺页次数: r.fault')));
  assert.ok(e.some((x) => /r\.fault\b|fault」/.test(x) && /paging/.test(x)), e.join('\n'));
});

test('OPT 的固定题用到 victims：这组数有并列，报', () => {
  const opt = `
id: p2
q: 3 个页框、OPT，访问 1 2 3 4 1 2 5 1 2 3 4 5，依次换出哪几页
target: OPT 往后看
level: 方法
run r: paging algo=opt frames=3 refs="1 2 3 4 1 2 5 1 2 3 4 5"
expect 换出的页: r.victims
teach default: 往后看谁最晚再用。
`;
  const e = errsOf(wrap('predict', opt));
  assert.ok(e.some((x) => /victims/.test(x) && /并列/.test(x)), e.join('\n'));
  // 只问缺页次数没有并列
  assert.deepEqual(errsOf(wrap('predict', opt.replace('r.victims', 'r.faults'))), []);
});

test('against：名字不是这个引擎的错法、这组数分不开，各报一条', () => {
  const e1 = errsOf(wrap('predict', LRU('p2').replace('against: fifo, noInitial', 'against: fifoo')));
  assert.ok(e1.some((x) => /fifoo/.test(x) && /不是 paging 的错法/.test(x) && /分不开/.test(x) && /fifo、opt、clock、noInitial/.test(x)), e1.join('\n'));
  // 1 2 3 4 2 5：LRU 和 FIFO 都缺 5 次（换出的页不一样，但这道题只问次数）
  const same = LRU('p2').replace('refs="1 2 3 4 1 2 5 1 2 3 4 5"', 'refs="1 2 3 4 2 5"').replace('expect x2 最后换出的页: 2\n', '').replace('against: fifo, noInitial', 'against: fifo');
  const e2 = errsOf(wrap('predict', same));
  assert.ok(e2.some((x) => /fifo/.test(x) && /分不开/.test(x)), e2.join('\n'));
});

test('run 行只在 construct、predict 里认：英语 recall 的续行「run out: …」照旧是续行；expect 能手写编号', () => {
  const r = probeOf('recall', 'id: q\nq: 写\ntarget: x\nlevel: 核心\nmust: 一\nanswer: we\nrun out: of time');
  assert.equal(r.answer, 'we\nrun out: of time');
  const p = probeOf('predict', 'id: q\ntarget: x\nlevel: 基础\nrun r: sort algo=shell gaps="4 2 1" array="49 38 65 97 76 13 27 49"\nexpect x3 第二趟: r.pass2\nexpect 名: "P1 P2"');
  assert.deepEqual(p.expects.map((e) => [e.id, e.label]), [['x3', '第二趟'], ['x2', '名']]);
});

test('一串的量和一个数比（r.flipped != 0）：不静默算满足，报写法；example 上 selfCheck 报出来', () => {
  const p = probeOf('construct', SHELL('p1').replace('r.unstable >= 1', 'r.flipped != 0'));
  const v = runVars(p, { A: '49 38 65 97 76 13 27 49', P: '49 49' }); // 稳定：flipped 是 []
  const [r] = evalIfs(p.ifs, { A: '49 38 65 97 76 13 27 49', P: '49 49' }, v.vars, p.slots);
  assert.equal(r.ok, false);
  assert.match(r.error, /r\.flipped 是一串/);
  const e = errsOf(['block DS-L8.2 optional=p1', fence('construct', SHELL('p1').replace('r.unstable >= 1', 'r.flipped != r.unstable'))].join('\n'));
  assert.ok(e.some((x) => /if1/.test(x) && /是一串/.test(x)), e.join('\n'));
  // 数学的条件照旧：矩阵和一个 let 的数比不报
  const m = probeOf('construct', 'id: q\ntarget: x\nlevel: 基础\nslots: A=mat(2)\nlet k = 2\nif: A != k\nexample: A=[[1,0],[0,0]]');
  assert.equal(evalIfs(m.ifs, m.example, { k: 2 }, m.slots)[0].error, undefined);
});

test('expect / wrong 少写了 r.（expect 缺页: faults）：selfCheck 报「是量的名字」', () => {
  const e = errsOf(wrap('predict', LRU('p2').replace('expect 缺页次数: r.faults', 'expect 缺页次数: faults')));
  assert.ok(e.some((x) => /x1/.test(x) && /faults 是量的名字：写 r\.faults/.test(x)), e.join('\n'));
  const w = errsOf(wrap('predict', LRU('p2').replace('wrong w1: r.faults - 3', 'wrong w1: faults - 3')));
  assert.ok(w.some((x) => /wrong w1/.test(x) && /写 r\.faults/.test(x)), w.join('\n'));
});

test('runFields：字段值碰巧是 toString 这类名字不当成格子', () => {
  assert.deepEqual(runFields({ slots: [] }, { fields: { array: 'toString' } }), { array: 'toString' });
});
