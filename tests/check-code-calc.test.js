// 检验 408：tradeoff（recall 的别名）、calc（solve 加最后的值）、code（真跑测试）（计划 4 Task 5）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe, parseCheck, selfCheck, baseType } from '../kit/src/check/spec.js';
import { judgeMachine, itemLabel, claudeIds, verdictPrompt } from '../kit/src/check/judge.js';

const P = (type, src) => { const r = parseProbe(type, src.trim()); if (r.error) throw new Error(r.error); return r.probe; };
const item = (r, id) => r.items.find((x) => x.id === id);

test('tradeoff：读成 recall、type 存自己的名字；408 的块里默认测重建', () => {
  const p = P('tradeoff', `
id: t1
q: 链式存储和顺序存储，各在什么时候占便宜？
target: 只记得一边的好处
level: 方法
must: 顺序表随机访问 O(1)，插入删除要移动元素
must: 链表插入删除不用移动，找第 i 个要从头走`);
  assert.equal(p.type, 'tradeoff');
  assert.equal(baseType(p), 'recall');
  assert.equal(p.must.length, 2);
  assert.equal(p.facet, '重建');
  const { check } = parseCheck('check id=k1', 'block DS-L1.1 must=t1\n```tradeoff\nid: t1\nq: x\ntarget: y\nlevel: 方法\nmust: a\nretry: t2\nteach default: z\n```\n```tradeoff\nid: t2\nq: x\ntarget: y\nlevel: 方法\nmust: a\n```');
  assert.equal(check.probes.t1.facet, '重建');
  assert.deepEqual(judgeMachine(p, { text: '随便' }), { items: [], needsClaude: true, stop: false });
});

const CALC = `
id: c1
q: LRU 换页，3 个页框，引用串 1 2 3 4 1 2 5 1 2 3 4 5，缺页几次、缺页率多少？
target: 数缺页次数时把开头装入也漏了
level: 核心
run r: paging algo=lru frames=3 refs="1 2 3 4 1 2 5 1 2 3 4 5"
result: r.faults
steps:
s1 setup: 列出每次访问后页框里的页
s2 calc: 逐个对照，数出缺页的次数
s3 conclude: 缺页 10 次`;

test('calc：读成 solve，result 和 run 行读得懂，result 页面判，步骤照旧交 Claude', () => {
  const p = P('calc', CALC);
  assert.equal(p.type, 'calc');
  assert.equal(baseType(p), 'solve');
  assert.equal(p.result, 'r.faults');
  assert.equal(p.runs.length, 1);
  assert.deepEqual(p.steps.map((s) => s.id), ['s1', 's2', 's3']);
  assert.deepEqual(claudeIds(p), ['s1', 's2', 's3']);
  const ok = judgeMachine(p, { text: '…', result: '10' });
  assert.deepEqual(ok.items.map((x) => [x.id, x.ok]), [['result', true]]);
  assert.equal(ok.needsClaude, true);
  assert.equal(ok.stop, false);
  const bad = judgeMachine(p, { text: '…', result: '7' });
  assert.equal(item(bad, 'result').ok, false);
  assert.equal(bad.needsClaude, true, '最后的值错了步骤照样判');
  assert.equal(item(judgeMachine(p, { result: '' }), 'result').ok, false);
  assert.equal(itemLabel(p, 'result'), '最后的值');
  assert.match(verdictPrompt({ probe: p, answer: { text: 'x', result: '7' } }), /参考步骤/);
  assert.match(verdictPrompt({ probe: p, answer: { text: 'x', result: '7' } }), /最后的值.*7/);
});

test('solve 照旧：不写 result 就没有 result 一项；result 靠并列的量待核', () => {
  const s = P('solve', `
id: s1
q: 解方程
target: t
level: 方法
steps:
s1 setup: 列式
s2 conclude: x=2`);
  assert.deepEqual(judgeMachine(s, { text: 'x' }), { items: [], needsClaude: true, stop: false });
  const tie = P('calc', `
id: c2
q: OPT，3 个页框，引用串 1 2 3 4 1 2 5 1 2 3 4 5，换出的页依次是？
target: t
level: 核心
run r: paging algo=opt frames=3 refs="1 2 3 4 1 2 5 1 2 3 4 5"
result: r.victims
steps:
s1 calc: 逐次找最久不用的
s2 conclude: 写出换出的页`);
  const r = judgeMachine(tie, { text: 'x', result: '1 2 3' });
  assert.equal(item(r, 'result').ok, null);
  assert.equal(r.needsClaude, true);
});

test('calc：照考试样子的算法设计题（思想、代码、复杂度三步）读得懂', () => {
  const p = P('calc', `
id: c3
q: 设计算法，判断带头结点的单链表是否递增有序。（1）思想（2）代码（3）时间复杂度
target: 链表判有序漏了空表
level: 核心
steps:
s1 setup: 思想：用两个指针 p、q 依次比较相邻两个结点的值
s2 calc: 代码：for (p = L->next; p && p->next; p = p->next) if (p->data > p->next->data) return 0; return 1;
s3 conclude: 时间复杂度 O(n)，空间复杂度 O(1)`);
  assert.equal(baseType(p), 'solve');
  assert.equal(p.result, undefined);
  assert.deepEqual(judgeMachine(p, { text: '…' }).items, []);
});

const CODE = `
id: k1
q: 写 Reverse，把数组原地逆置
target: 循环到 n 又换回来
level: 核心
fn: void Reverse(int A[], int n)
tests:
# 一般的、两个、一个
A = [1, 2, 3, 4, 5], n = 5 -> A = [5, 4, 3, 2, 1]
A = [7, 8], n = 2 -> A = [8, 7]
A = [9], n = 1 -> A = [9]
ref:
void Reverse(int A[], int n) {
    int i, t;

    for (i = 0; i < n / 2; i++) {
        t = A[i]; A[i] = A[n - 1 - i]; A[n - 1 - i] = t;
    }
}`;
const GOOD = 'void Reverse(int A[], int n) {\n  int i, t;\n  for (i = 0; i < n / 2; i++) { t = A[i]; A[i] = A[n-1-i]; A[n-1-i] = t; }\n}';

test('code：每个测试一项，不调 Claude；对的全 ok', () => {
  const p = P('code', CODE);
  assert.equal(p.type, 'code');
  assert.equal(p.facet, '能用');
  assert.match(p.code.ref, /\n\n/, 'ref 里的空行留着');
  const r = judgeMachine(p, { code: GOOD });
  assert.deepEqual(r.items.map((x) => [x.id, x.ok]), [['t1', true], ['t2', true], ['t3', true]]);
  assert.equal(r.needsClaude, false);
  assert.equal(r.stop, false);
  assert.equal(itemLabel(p, 't2'), '测试 2');
});

test('code：第 2 个测试错 → t1 ok、t2 false，why 写想要和得到', () => {
  const p = P('code', CODE);
  // 两个数时不换：n==2 的写成循环到 n/2 - 1
  const bad = GOOD.replace('i < n / 2', 'i < (n > 2 ? n / 2 : 0)');
  const r = judgeMachine(p, { code: bad });
  assert.deepEqual(r.items.map((x) => x.ok), [true, false, true]);
  assert.match(item(r, 't2').why, /想要 \[8, 7\]，得到 \[7, 8\]/);
  assert.equal(r.stop, true);
});

test('code：死循环 → why 有「步」；编译错 → 一项 compile false；没写代码也不过', () => {
  const p = P('code', CODE);
  const loop = judgeMachine(p, { code: 'void Reverse(int A[], int n) { while (1) { n = n; } }' });
  assert.equal(item(loop, 't1').ok, false);
  assert.match(item(loop, 't1').why, /步/);
  const ce = judgeMachine(p, { code: 'void Reverse(int A[], int n) { int i = ; }' });
  assert.deepEqual(ce.items.map((x) => [x.id, x.ok]), [['compile', false]]);
  assert.ok(item(ce, 'compile').why);
  assert.equal(itemLabel(p, 'compile'), '编译');
  const empty = judgeMachine(p, { code: '  ' });
  assert.equal(empty.items.every((x) => x.ok === false), true);
  assert.equal(judgeMachine(p, {}).items.some((x) => x.ok === true), false);
});

test('code 自检：ref 过自己的全部测试；没 ref 每个测试要有期望', () => {
  const base = 'id: k1\nq: x\ntarget: y\nlevel: 核心\nfn: void Reverse(int A[], int n)\nteach default: z\nretry: k2\n';
  const ok = parseCheck('check id=k', `block DS-L1.1 must=k1\n\`\`\`code\n${base}tests: A = [1, 2], n = 2 -> A = [2, 1]\nref: ${GOOD.replace(/\n/g, ' ')}\n\`\`\`\n\`\`\`code\nid: k2\nq: x\ntarget: y\nlevel: 核心\nfn: void Reverse(int A[], int n)\ntests: A = [1, 2], n = 2 -> A = [2, 1]\nref: ${GOOD.replace(/\n/g, ' ')}\n\`\`\``).check;
  assert.deepEqual(selfCheck(ok, {}, { lenient: true }), []);
  const wrongRef = parseCheck('check id=k', `block DS-L1.1 must=k1\n\`\`\`code\n${base}tests: A = [1, 2], n = 2 -> A = [2, 1]\nref: void Reverse(int A[], int n) { }\n\`\`\`\n\`\`\`code\nid: k2\nq: x\ntarget: y\nlevel: 核心\nfn: void Reverse(int A[], int n)\ntests: A = [1, 2], n = 2 -> A = [2, 1]\nref: ${GOOD.replace(/\n/g, ' ')}\n\`\`\``).check;
  assert.match(selfCheck(wrongRef, {}, { lenient: true }).join('\n'), /k1.*ref.*t1/);
  // 没 ref、有测试没写期望（配 check 函数）：自检报
  const noRef = parseProbe('code', `id: k3\nq: x\ntarget: y\nlevel: 核心\nfn: void Reverse(int A[], int n)\ntests: A = [1, 2], n = 2\ncheck: int check(int A[], int A0[], int n) { return 1; }`);
  assert.ok(noRef.probe, noRef.error);
  const probs = selfCheck({ id: 'k', blocks: [{ block: 'DS-L1.1', must: ['k3', 'k4'], optional: [], fast: 0 }], spare: [], probes: { k3: noRef.probe, k4: noRef.probe }, order: ['k3', 'k4'] }, {}, { lenient: true });
  assert.match(probs.join('\n'), /k3.*期望/);
});

test('code：写法不对读时就报', () => {
  assert.match(parseProbe('code', 'id: k\nq: x\ntarget: y\nlevel: 核心\nfn: Reverse\ntests: A = [1]').error, /fn: 写函数的样子/);
  assert.match(parseProbe('code', 'id: k\nq: x\ntarget: y\nlevel: 核心\nfn: void f(int n)').error, /tests/);
});
