// 检验 408：construct、predict 的机器判（计划 4 Task 3；kit/src/check/judge.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe } from '../kit/src/check/spec.js';
import { measure, variantValues } from '../kit/src/engines/measures.js';
import { judgeMachine, teachFor, outcomeOf, itemLabel, claudeIds, parseVerdict, verdictPrompt } from '../kit/src/check/judge.js';

const P = (type, src) => { const r = parseProbe(type, src.trim()); if (r.error) throw new Error(r.error); return r.probe; };
const item = (r, id) => r.items.find((x) => x.id === id);

// —— construct ——

const SHELL = P('construct', `
id: p1
q: 造 8 个数，用增量 4 2 1 的希尔排序排完，相同的数先后变了；再写出变了先后的那一对
target: 以为希尔排序稳定
level: 核心
slots: A=seq(8) P=seq(2)
run r: sort algo=shell gaps="4 2 1" array=A
if: r.unstable >= 1 => 这一组排完，相同的数先后没变
if: P in r.flipped => 写的这一对不是被换了先后的那一对
example: A=4 7 4 1 2 5 7 8 P=[4 4']
teach if1: 增量大于 1 的那几趟，相隔很远的两个数会越过中间那个相同的数。`);

test('construct 408：满足的每一条 ok；页面加的撇号说一声，接在第一项 why 后面', () => {
  const r = judgeMachine(SHELL, { slots: { A: '4 7 4 1 2 5 7 8', P: '4 4' } });
  assert.deepEqual(r.items.map((x) => [x.id, x.ok]), [['if1', true], ['if2', true]]);
  assert.match(item(r, 'if1').why, /页面把第二个 4 记成 4′、第二个 7 记成 7′/);
  assert.equal(r.stop, false);
  assert.equal(r.needsClaude, false);
  assert.deepEqual(r.notes, ['页面把第二个 4 记成 4′、第二个 7 记成 7′']);
  // 写了撇号的也一样
  assert.deepEqual(judgeMachine(SHELL, { slots: { A: "4 7 4' 1 2 5 7 8", P: "4' 4" } }).items.map((x) => x.ok), [true, true]);
});

test('construct 408：不满足的那一条用外部写的话', () => {
  const r = judgeMachine(SHELL, { slots: { A: '49 38 65 97 76 13 27 49', P: '49 49' } });
  assert.equal(item(r, 'if1').ok, false);
  assert.match(item(r, 'if1').why, /^这一组排完，相同的数先后没变/);
  assert.equal(item(r, 'if2').ok, false);
  assert.equal(item(r, 'if2').why, '写的这一对不是被换了先后的那一对');
  const o = outcomeOf(SHELL, r.items);
  assert.equal(o.outcome, 'fail');
  assert.equal(teachFor(SHELL, o.failed, r.items).key, 'if1');
  // 换了先后，但写的不是那一对
  const w = judgeMachine(SHELL, { slots: { A: '4 7 4 1 2 5 7 8', P: '7 7' } });
  assert.deepEqual(w.items.map((x) => x.ok), [true, false]);
});

test('construct 408：引擎不收（AVL 里有重复的数）→ 一项 run，引擎原话，停下', () => {
  const avl = P('construct', `id: q\ntarget: x\nlevel: 基础\nslots: S=seq(4)\nrun t: avl avl=S\nif: t.LR >= 1 => 没有 LR\nexample: S=3 1 2 4`);
  const r = judgeMachine(avl, { slots: { S: '3 1 3 4' } });
  assert.deepEqual(r.items, [{ id: 'run', ok: false, why: 'avl: 关键字 3 写了两次（查找树里不放相同的关键字）' }]);
  assert.equal(r.stop, true);
  assert.equal(outcomeOf(avl, r.items).outcome, 'fail');
  assert.equal(itemLabel(avl, 'run'), '跑引擎');
  // 收的照判
  assert.deepEqual(judgeMachine(avl, { slots: { S: '3 1 2 4' } }).items.map((x) => [x.id, x.ok]), [['if1', true]]);
});

test('construct 408：条件用到的量有并列 → 那一项 ok: null，别的照判', () => {
  const refs = '1 2 3 4 1 2 5 1 2 3 4 5';
  assert.deepEqual(measure('paging', { algo: 'opt', frames: '3', refs }).ties, ['victims']); // 这组数 OPT 有并列
  const opt = P('construct', `id: q\ntarget: x\nlevel: 核心\nslots: R=seq(12) V=seq(1)\nrun r: paging algo=opt frames=3 refs=R\nif: r.faults >= 7 => 缺页不到 7 次\nif: V in r.victims => 这一页没被换出去\nexample: R=1 2 3 4 1 2 3 4 1 2 3 4 V=4`);
  const r = judgeMachine(opt, { slots: { R: refs, V: '3' } });
  assert.equal(item(r, 'if1').ok, true);
  assert.equal(item(r, 'if2').ok, null);
  assert.equal(item(r, 'if2').why, '这组输入有并列，页面判不了');
  assert.equal(outcomeOf(opt, r.items).outcome, 'pending');
  assert.equal(r.stop, false);
});

test('construct 408：答案是空的也不抛', () => {
  const r = judgeMachine(SHELL, {});
  assert.ok(Array.isArray(r.items));
  assert.notEqual(outcomeOf(SHELL, r.items).outcome, 'pass');
});

// —— predict ——

// 1 2 3 4 1 2 5 1 2 3 4 5、3 个页框：LRU 缺 10 次、FIFO 9 次、少算开头 3 次是 7 次（三个都不一样）
const REFS = '1 2 3 4 1 2 5 1 2 3 4 5';
const LRU = (extra = '', against = 'against: fifo') => P('predict', `
id: p2
q: 3 个页框、LRU，访问 ${REFS}，缺页几次？最后换出的是哪一页？说说理由
target: LRU 当成 FIFO
level: 方法
run r: paging algo=lru frames=3 refs="${REFS}"
expect 缺页次数: r.faults
wrong w1: r.faults - 3 => 开头装进 3 个空页框的那 3 次也是缺页
expect x2 最后换出的页: 2
${against}
must: 换出的是最久没用过的那一页
wrong: 换出的是最早装进来的
teach tag=fifo: LRU 看的是最近一次用到的时候，不是装进来的时候。
teach w1: 一开始页框是空的，装进去也是缺页。
teach x2: 往前找，三页里最久没被访问的那一页。
${extra}`);

test('样板的数：LRU、FIFO、少 3 三个都不一样', () => {
  const f = { algo: 'lru', frames: '3', refs: REFS };
  const lru = measure('paging', f).values.faults;
  const fifo = variantValues('paging', f, 'fifo').values.faults;
  assert.equal(lru, 10);
  assert.equal(fifo, 9);
  assert.ok(new Set([lru, fifo, lru - 3]).size === 3);
});

test('predict：都对、写了 must → needsClaude；Claude 回的读不出来 → 理由全是 null、outcome pending', () => {
  const p = LRU();
  const r = judgeMachine(p, { expects: { x1: '10', x2: '2' }, text: '换出最久没用的' });
  assert.deepEqual(r.items.map((x) => [x.id, x.ok]), [['x1', true], ['x2', true]]);
  assert.equal(r.stop, false);
  assert.equal(r.needsClaude, true);
  const v = parseVerdict('我觉得写得挺好', claudeIds(p));
  assert.equal(v.unread, true);
  assert.ok(v.items.length > 0 && v.items.every((x) => x.ok === null));
  assert.equal(outcomeOf(p, [...r.items, ...v.items]).outcome, 'pending');
  // 没写 must 的：都对就不叫 Claude
  const bare = P('predict', `id: q\ntarget: x\nlevel: 基础\nrun r: paging algo=lru frames=3 refs="${REFS}"\nexpect: r.faults`);
  assert.equal(judgeMachine(bare, { expects: { x1: '10' } }).needsClaude, false);
});

test('predict：写了 FIFO 的缺页次数 → tag fifo、why 是错法的说法、补讲 tag=fifo', () => {
  const p = LRU();
  const r = judgeMachine(p, { expects: { x1: '9', x2: '2' } });
  const x1 = item(r, 'x1');
  assert.equal(x1.ok, false);
  assert.equal(x1.tag, 'fifo');
  assert.match(x1.why, /FIFO/);
  assert.deepEqual(x1.keys, ['tag=fifo', 'x1']);
  assert.equal(r.stop, true);
  assert.equal(r.needsClaude, false);
  const o = outcomeOf(p, r.items);
  assert.deepEqual(o.failed, ['x1']);
  assert.equal(teachFor(p, o.failed, r.items).key, 'tag=fifo');
});

test('predict：写了少 3 的 → hit w1、why 是外部写的说明、补讲 w1', () => {
  const p = LRU();
  const r = judgeMachine(p, { expects: { x1: '7', x2: '2' } });
  const x1 = item(r, 'x1');
  assert.equal(x1.ok, false);
  assert.equal(x1.hit, 'w1');
  assert.equal(x1.tag, undefined);
  assert.equal(x1.why, '开头装进 3 个空页框的那 3 次也是缺页');
  assert.deepEqual(x1.keys, ['w1', 'x1']);
  assert.equal(teachFor(p, ['x1'], r.items).key, 'w1');
});

test('predict：错法和外部的错答案都对上（noInitial 就是少 3）→ 两种都记进 tags、不挑一种：keys 是 x1 → default（dr-plan4-fix 3）', () => {
  const p = LRU('', 'against: fifo, noInitial');
  const r = judgeMachine(p, { expects: { x1: '7', x2: '2' } });
  const x1 = item(r, 'x1');
  assert.deepEqual(x1.tags, ['noInitial', 'w1']);
  assert.equal(x1.tag, undefined);
  assert.equal(x1.hit, undefined);
  assert.equal(x1.tagFit, 'exact');
  assert.match(x1.why, /^这几种错法在这组数上答案一样：.*没把一开始调入.*；开头装进 3 个空页框/);
  assert.deepEqual(x1.keys, ['x1', 'default']);
  // 有 tag=noInitial、w1 的补讲也不挑：没有 teach x1 时是 default
  const p2 = LRU('teach tag=noInitial: 开头的也算。\nteach default: 兜底。', 'against: fifo, noInitial');
  assert.equal(teachFor(p2, ['x1'], judgeMachine(p2, { expects: { x1: '7', x2: '2' } }).items).key, 'default');
  // 只对上一种：照旧
  const p3 = P('predict', `id: q\ntarget: x\nlevel: 基础\nrun r: paging algo=lru frames=3 refs="${REFS}"\nexpect: r.faults\nwrong w1: r.faults - 3 => 少了\nagainst: fifo\nteach x1: 按项的。\nteach default: 兜底。`);
  const r3 = judgeMachine(p3, { expects: { x1: '7' } });
  assert.equal(item(r3, 'x1').hit, 'w1');
  assert.deepEqual(item(r3, 'x1').keys, ['w1', 'x1']);
  assert.equal(teachFor(p3, ['x1'], r3.items).key, 'x1');
  const r4 = judgeMachine(p3, { expects: { x1: '4' } });
  assert.deepEqual(item(r4, 'x1').keys, ['x1']);
  assert.equal(teachFor(p3, ['x1'], r4.items).key, 'x1');
  const p5 = P('predict', `id: q\ntarget: x\nlevel: 基础\nrun r: paging algo=lru frames=3 refs="${REFS}"\nexpect: r.faults\nteach default: 兜底。`);
  assert.equal(teachFor(p5, ['x1'], judgeMachine(p5, { expects: { x1: '4' } }).items).key, 'default');
});

test('predict：没写 against 看这个引擎的全部错法；答案一样的几种都记', () => {
  const p = LRU('', '');
  const r = judgeMachine(p, { expects: { x1: '9', x2: '2' } });
  assert.deepEqual(item(r, 'x1').tags, ['fifo', 'clock']); // fifo、clock 都是 9：分不清
  const n = judgeMachine(p, { expects: { x1: '7', x2: '2' } });
  assert.ok(n.items[0].tags.includes('w1'));
  assert.ok(n.items[0].tags.some((t) => ['opt', 'noInitial'].includes(t)));
});

test('predict：哪个都没对上 → why「不对」、keys 只有 x1；第二项错也是 stop', () => {
  const p = LRU();
  const r = judgeMachine(p, { expects: { x1: '11', x2: '2' } });
  assert.equal(item(r, 'x1').ok, false);
  assert.equal(item(r, 'x1').tag, undefined);
  assert.equal(item(r, 'x1').hit, undefined);
  assert.deepEqual(item(r, 'x1').keys, ['x1']);
  const r2 = judgeMachine(p, { expects: { x1: '10', x2: '3' } });
  assert.equal(item(r2, 'x2').ok, false);
  assert.equal(r2.stop, true);
  assert.equal(teachFor(p, ['x2'], r2.items).key, 'x2');
});

test('predict：没写、读不懂 → false', () => {
  const p = LRU();
  const r = judgeMachine(p, { expects: { x2: '2' } });
  assert.equal(item(r, 'x1').ok, false);
  assert.match(item(r, 'x1').why, /没写缺页次数/);
  const u = judgeMachine(p, { expects: { x1: '十', x2: '2' } });
  assert.equal(item(u, 'x1').ok, false);
  assert.match(item(u, 'x1').why, /读不懂/);
});

test('predict：外部写的错答案算出来和对的一样 → 这一条不用；错法这组数上和对的一样 → 跳过', () => {
  // 1 2 3 4 2 5：LRU、FIFO 都缺 5 次
  const p = P('predict', `id: q\ntarget: x\nlevel: 基础\nrun r: paging algo=lru frames=3 refs="1 2 3 4 2 5"\nexpect: r.faults\nwrong w1: r.faults + 0 => 一样的\nwrong w2: 4 => 少了一次`);
  assert.equal(item(judgeMachine(p, { expects: { x1: '5' } }), 'x1').ok, true);
  const r = judgeMachine(p, { expects: { x1: '4' } });
  assert.equal(item(r, 'x1').hit, 'w2');
  assert.notEqual(item(r, 'x1').tag, 'fifo');
});

test('predict：答案是序列、复杂度、小数', () => {
  const sort = P('predict', `id: q\ntarget: x\nlevel: 方法\nrun r: sort algo=shell gaps="4 2 1" array="49 38 65 97 76 13 27 49"\nexpect 第一趟: r.pass1\nexpect 复杂度: "O(n log n)"`);
  const pass1 = measure('sort', { algo: 'shell', gaps: '4 2 1', array: '49 38 65 97 76 13 27 49' }).values.pass1;
  const r = judgeMachine(sort, { expects: { x1: pass1.join(', '), x2: 'O(nlgn)' } });
  assert.deepEqual(r.items.map((x) => x.ok), [true, true]);
  const rate = P('predict', `id: q\ntarget: x\nlevel: 基础\nrun r: paging algo=lru frames=3 refs="${REFS}"\nexpect 缺页率: r.rate`);
  assert.equal(item(judgeMachine(rate, { expects: { x1: '83.33%' } }), 'x1').ok, true);
  assert.equal(item(judgeMachine(rate, { expects: { x1: '10/12' } }), 'x1').ok, true);
  assert.equal(item(judgeMachine(rate, { expects: { x1: '0.8' } }), 'x1').ok, false);
});

test('predict：外部写的式子算出来不是数（除以 0）→ ok: null，不怪学生', () => {
  const p = P('predict', `id: q\ntarget: x\nlevel: 基础\nrun r: paging algo=lru frames=3 refs="${REFS}"\nexpect 怪的: r.faults / 0`);
  const r = judgeMachine(p, { expects: { x1: '10' } });
  assert.equal(item(r, 'x1').ok, null);
  assert.match(item(r, 'x1').why, /页面算不了/);
  assert.equal(r.stop, false);
  assert.equal(outcomeOf(p, r.items).outcome, 'pending');
});

test('predict：用到的量有并列 → ok: null', () => {
  const p = P('predict', `id: q\ntarget: x\nlevel: 方法\nrun r: paging algo=opt frames=3 refs="${REFS}"\nexpect 换出的页: r.victims\nexpect 缺页: r.faults`);
  const r = judgeMachine(p, { expects: { x1: '3 4 1 2', x2: '7' } });
  assert.equal(item(r, 'x1').ok, null);
  assert.equal(item(r, 'x1').why, '这组输入有并列，页面判不了');
  assert.equal(item(r, 'x2').ok, true);
});

test('itemLabel：expect 的标签、run；别的 null', () => {
  const p = LRU();
  assert.equal(itemLabel(p, 'x1'), '缺页次数');
  assert.equal(itemLabel(p, 'x2'), '最后换出的页');
  assert.equal(itemLabel(p, 'run'), '跑引擎');
  assert.equal(itemLabel(p, 'm1'), null);
  assert.equal(itemLabel(SHELL, 'if1'), null);
});

test('verdictPrompt 认 predict：学生写的结果、理由；不提他她', () => {
  const p = LRU();
  const t = verdictPrompt({ probe: p, answer: { expects: { x1: '10', x2: '2' }, text: '换出最久没用的' } });
  assert.match(t, /缺页次数.*10/);
  assert.match(t, /最后换出的页.*2/);
  assert.match(t, /换出最久没用的/);
  assert.doesNotMatch(t, /[他她]/);
});

test('teachFor：没有 keys 的照旧（先编号、再 tag、最后 default）', () => {
  const p = LRU('teach if9: 编号的\nteach default: 兜底');
  assert.equal(teachFor(p, ['x2'], [{ id: 'x2', ok: false }]).key, 'x2');
  assert.equal(teachFor(p, ['m1'], [{ id: 'm1', ok: false, tag: 'fifo' }]).key, 'tag=fifo');
  assert.equal(teachFor(p, ['m1'], [{ id: 'm1', ok: false }]).key, 'default');
});
