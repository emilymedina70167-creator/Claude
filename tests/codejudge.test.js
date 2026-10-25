// code 组件的判题（kit/src/codejudge.js）：跑测试、比数组 / 返回值 / 输出、估复杂度
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodeSpec, runTests, estimate, refEstimate, parseSignature, fitGrowth } from '../kit/src/codejudge.js';

const REVERSE = `void Reverse(int A[], int n) {
    int i, t;
    for (i = 0; i < n / 2; i++) {
        t = A[i];
        A[i] = A[n - 1 - i];
        A[n - 1 - i] = t;
    }
}`;

test('函数签名、默认的调用和起始代码', () => {
  const s = parseSignature('void Reverse(int A[], int n)');
  assert.deepEqual([s.ret, s.name, s.params], ['void', 'Reverse', ['A', 'n']]);
  assert.deepEqual(parseSignature('int Max(int A[][4], int m)').params, ['A', 'm']);
  const spec = parseCodeSpec({ fn: 'void Reverse(int A[], int n)', tests: 'A = [1, 2, 3], n = 3 -> A = [3, 2, 1]' });
  assert.equal(spec.call, 'Reverse(A, n)');
  assert.equal(spec.starter, 'void Reverse(int A[], int n) {\n    \n}');
  assert.throws(() => parseCodeSpec({ fn: 'Reverse', tests: 'A = [1]' }), /fn: 写函数的样子/);
  assert.throws(() => parseCodeSpec({ fn: 'void f(int n)' }), /要写 tests:/);
  assert.throws(() => parseCodeSpec({ fn: 'void f(int n)', tests: 'n = 3' }), /要么写上，要么给 ref:/);
  assert.throws(() => parseCodeSpec({ fn: 'void f(int n)', tests: 'n 3 -> n = 1' }), /要写成「名字 = 值」/);
});

test('跑测试：对的全过；错的指出哪个测试、哪个变量不对；运行出错报行号', () => {
  const spec = parseCodeSpec({ fn: 'void Reverse(int A[], int n)', tests: 'A = [1, 2, 3, 4, 5], n = 5 -> A = [5, 4, 3, 2, 1]\nA = [7, 8], n = 2 -> A = [8, 7]\nA = [9], n = 1 -> A = [9]' });
  assert.ok(runTests(REVERSE, spec).every((r) => r.ok));
  // 常见错：循环到 n（换了两遍，又换回去了）
  const twice = REVERSE.replace('i < n / 2', 'i < n');
  const r = runTests(twice, spec);
  assert.equal(r[0].ok, false);
  assert.deepEqual(r[0].diff, [{ what: 'A', want: '[5, 4, 3, 2, 1]', got: '[1, 2, 3, 4, 5]' }]);
  assert.equal(r[2].ok, true, '一个元素的照样对');
  // 越界：报行号
  const oob = REVERSE.replace('A[n - 1 - i]', 'A[n - i]');
  const e = runTests(oob, spec)[0];
  assert.equal(e.ok, false);
  assert.match(e.error, /下标|越界/);
  assert.equal(e.errLine, 5);
  // 语法错：每个测试都标出来
  const bad = runTests('void Reverse(int A[], int n) { int i = ; }', spec);
  assert.ok(bad.every((x) => !x.ok && x.compile));
});

test('返回值、用参考解法算期望、main 的输出', () => {
  const spec = parseCodeSpec({
    fn: 'int CountPos(int A[], int n)',
    tests: 'A = [1, -2, 3], n = 3 -> return = 2\nA = [-1, -2], n = 2',
    ref: 'int CountPos(int A[], int n) { int c = 0; for (int i = 0; i < n; i++) if (A[i] > 0) c++; return c; }',
  });
  const good = 'int CountPos(int A[], int n) {\n  int k = 0;\n  for (int i = 0; i < n; i++)\n    if (A[i] > 0) k++;\n  return k;\n}';
  assert.ok(runTests(good, spec).every((r) => r.ok));
  const off = runTests(good.replace('A[i] > 0', 'A[i] >= -1'), spec);
  assert.equal(off[0].ok, true);
  assert.equal(off[1].ok, false, '第二个测试的期望由参考解法算出 0');
  assert.deepEqual(off[1].diff, [{ what: '返回值', want: '0', got: '1' }]);
  // 只有 main：比输出
  const m = parseCodeSpec({ call: 'main()', tests: 'x = 0 -> out = "hello 3"' });
  assert.ok(runTests('int main() { printf("hello %d", 3); return 0; }', m)[0].ok);
  assert.equal(runTests('int main() { printf("hello %d", 4); return 0; }', m)[0].ok, false);
});

test('估复杂度：逆置 O(n)、冒泡 O(n²)、折半 O(log n)；递归的空间 O(n)；参考解法也估', () => {
  const lin = parseCodeSpec({ fn: 'void Reverse(int A[], int n)', tests: 'A = [1], n = 1 -> A = [1]', scale: 'n = 8 16 32 64; A = rand(n)' });
  const t = estimate(REVERSE, lin);
  assert.equal(t.time, 'O(n)');
  assert.equal(t.space, 'O(1)');
  const bubble = `void Sort(int A[], int n) {
    for (int i = 0; i < n - 1; i++)
        for (int j = 0; j < n - 1 - i; j++)
            if (A[j] > A[j + 1]) { int t = A[j]; A[j] = A[j + 1]; A[j + 1] = t; }
}`;
  const sq = parseCodeSpec({ fn: 'void Sort(int A[], int n)', tests: 'A = [2, 1], n = 2 -> A = [1, 2]', scale: 'n = 4 8 16 32; A = rev(n)', ref: bubble });
  assert.equal(estimate(bubble, sq).time, 'O(n²)');
  assert.equal(refEstimate(sq).time, 'O(n²)');
  const bs = `int Find(int A[], int n, int k) {
    int lo = 0, hi = n - 1;
    while (lo <= hi) { int mid = (lo + hi) / 2; if (A[mid] == k) return mid; if (A[mid] < k) lo = mid + 1; else hi = mid - 1; }
    return -1;
}`;
  const lg = parseCodeSpec({ fn: 'int Find(int A[], int n, int k)', tests: 'A = [1, 2], n = 2, k = 2 -> return = 1', scale: 'n = 16 32 64 128 256; A = range(n), k = 0' });
  assert.equal(estimate(bs, lg).time, 'O(log n)');
  const rec = `void R(int A[], int lo, int hi) { if (lo >= hi) return; int t = A[lo]; A[lo] = A[hi]; A[hi] = t; R(A, lo + 1, hi - 1); }`;
  const rs = parseCodeSpec({ fn: 'void R(int A[], int lo, int hi)', call: 'R(A, 0, n - 1)', tests: 'A = [1, 2], n = 2 -> A = [2, 1]', scale: 'n = 8 16 32 64; A = rand(n)' });
  const re = estimate(rec, rs);
  assert.equal(re.time, 'O(n)');
  assert.equal(re.space, 'O(n)');
  assert.equal(fitGrowth([4, 8, 16, 32], [10, 10, 10, 10]), 'O(1)');
});

test('check:：答案不唯一时用老师写的 C 函数判（A 是跑完的，A0 是原来的）；printf 的就是没过的原因', () => {
  const spec = parseCodeSpec({
    fn: 'void Move(int A[], int n)',
    tests: 'A = [3, -1, 2, -5, 4], n = 5\nA = [1, 2], n = 2',
    check: `int check(int A[], int A0[], int n) {
    int i, neg = 0, sum = 0;
    for (i = 0; i < n; i++) { sum += A[i] - A0[i]; if (A0[i] < 0) neg++; }
    if (sum != 0) { printf("元素变了"); return 0; }
    for (i = 0; i < neg; i++) if (A[i] >= 0) { printf("前 %d 个应该都是负数", neg); return 0; }
    return 1;
}`,
  });
  assert.equal(spec.checkCall, 'check(A, A0, n)');
  // 一种做法：前后两个指针交换（次序和参考解法不一样也对）
  const two = 'void Move(int A[], int n) {\n  int i = 0, j = n - 1;\n  while (i < j) {\n    if (A[i] < 0) i++;\n    else { int t = A[i]; A[i] = A[j]; A[j] = t; j--; }\n  }\n}';
  assert.ok(runTests(two, spec).every((r) => r.ok));
  const none = runTests('void Move(int A[], int n) { }', spec);
  assert.equal(none[0].ok, false);
  assert.match(none[0].diff[0].want, /前 2 个应该都是负数/);
  assert.equal(none[1].ok, true, '没有负数的，不动也对');
});

test('说明里的 code 例子照抄能用', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseFields } = await import('../kit/src/parse.js');
  const md = readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
  const src = /^````code\n([\s\S]*?)^````$/m.exec(md)[1];
  const spec = parseCodeSpec(parseFields(src).fields);
  const ok = 'void Reverse(int A[], int n) {\n    for (int i = 0; i < n / 2; i++) { int t = A[i]; A[i] = A[n - 1 - i]; A[n - 1 - i] = t; }\n}';
  assert.ok(runTests(ok, spec).every((r) => r.ok));
  assert.equal(estimate(ok, spec).time, 'O(n)');
});

test('链表题：list [...] 建好带头结点的单链表，跑完读回来比', () => {
  const spec = parseCodeSpec({ fn: 'void Reverse(LinkList &L)', tests: 'L = list [1, 2, 3, 4] -> L = list [4, 3, 2, 1]\nL = list [] -> L = list []', scale: 'n = 8 16 32 64; L = rand(n)' });
  assert.match(spec.starter, /typedef struct LNode/);
  const good = 'void Reverse(LinkList &L) {\n    LNode *p = L->next, *r;\n    L->next = NULL;\n    while (p != NULL) { r = p->next; p->next = L->next; L->next = p; p = r; }\n}';
  assert.deepEqual(runTests(good, spec).map((t) => t.ok), [true, true]);
  assert.equal(estimate(good, spec).time, 'O(n)');
  const loop = runTests('void Reverse(LinkList &L) {\n    L->next->next = L->next;\n}', spec)[0];
  assert.match(loop.diff[0].got, /成环/);
  const crash = runTests('void Reverse(LinkList &L) {\n    LNode *p = NULL;\n    p->next = L;\n}', spec)[0];
  assert.equal(crash.errLine, 3); // 前面补的 typedef 那一行不算
  const nohead = parseCodeSpec({ fn: 'int Len(LinkList L)', head: 'no', tests: 'L = list [1, 2, 3] -> return = 3' });
  assert.ok(runTests('int Len(LinkList L) {\n    int k = 0;\n    while (L != NULL) { k++; L = L->next; }\n    return k;\n}', nohead)[0].ok);
});
