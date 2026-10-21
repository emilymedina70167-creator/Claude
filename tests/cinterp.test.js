// C 子集解释器（kit/src/cinterp.js）和代码跟踪组件（engines/trace.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram, runProgram, parseExpression } from '../kit/src/cinterp.js';
import { traceEngine } from '../kit/src/engines/trace.js';
import { checkAsk } from '../kit/src/stepperspec.js';

const runMain = (code) => runProgram(parseProgram(code));
const runCall = (code, call, vars) => runProgram(parseProgram(code), { entry: { src: call, e: parseExpression(call) }, vars });
const arr = (r, name) => [...r.steps.at(-1).globals, ...r.steps.at(-1).frames.flatMap((f) => f.vars)].find((v) => v.name === name && v.data).data.join(' ');

const INSERT = `void InsertSort(ElemType A[], int n){
    int i, j;
    for(i=2;i<=n;i++)
        if(A[i]<A[i-1]){
            A[0]=A[i];
            for(j=i-1;A[0]<A[j];--j)
                A[j+1]=A[j];
            A[j+1]=A[0];
        }
}`;

test('王道的排序代码：直接插入（哨兵）、冒泡（swap）、快排（递归）', () => {
  let r = runCall(INSERT, 'InsertSort(A, 5)', { A: [0, 38, 49, 65, 13, 27] });
  assert.equal(r.error, null);
  assert.equal(arr(r, 'A'), '27 13 27 38 49 65', 'A[0] 是哨兵，最后留着 27');
  r = runCall(`void BubbleSort(int A[], int n){
  for(int i=0;i<n-1;i++){
    bool flag=false;
    for(int j=n-1;j>i;j--)
      if(A[j-1]>A[j]){ swap(A[j-1],A[j]); flag=true; }
    if(flag==false) return;
  }
}`, 'BubbleSort(A, 5)', { A: [5, 1, 4, 2, 3] });
  assert.equal(arr(r, 'A'), '1 2 3 4 5');
  r = runMain(`int Partition(int A[], int low, int high){
  int pivot=A[low];
  while(low<high){
    while(low<high&&A[high]>=pivot) --high;
    A[low]=A[high];
    while(low<high&&A[low]<=pivot) ++low;
    A[high]=A[low];
  }
  A[low]=pivot;
  return low;
}
void QuickSort(int A[], int low, int high){
  if(low<high){
    int pivotpos=Partition(A,low,high);
    QuickSort(A,low,pivotpos-1);
    QuickSort(A,pivotpos+1,high);
  }
}
int main(){
  int A[8]={49,38,65,97,76,13,27,49};
  QuickSort(A,0,7);
  for(int i=0;i<8;i++) printf("%d ", A[i]);
  return 0;
}`);
  assert.equal(r.out, '13 27 38 49 49 65 76 97 ');
  // 调用栈：递归时一层层叠起来
  assert.ok(r.steps.some((s) => s.frames.filter((f) => f.fn === 'QuickSort').length >= 3));
});

test('语法和语义：#define、typedef、引用参数、二维数组、整除和取余、char、double、?:、位运算、printf 格式', () => {
  const r = runMain(`#include <stdio.h>
#define N 3
typedef int ElemType;
void sw(int &a, int &b){ int t=a; a=b; b=t; }
int f(int n){ return n <= 1 ? 1 : n * f(n - 1); }
int main(){
  int x = 1, y = 2;
  sw(x, y);
  ElemType m[2][N] = {{1, 2, 3}, {4, 5, 6}};
  char c = 'A' + 2;
  double d = 7 / 2;
  printf("%d %d|%c|%.1f|%d|%d|%d|%5d|%-3d|%x\\n", x, y, c, d, -7 / 2, -7 % 2, m[1][2], f(5), 4, 255);
  printf("%d %d %d\\n", 6 & 3, 6 | 3, 1 << 4);
  int a[5] = {1, 2};
  printf("%d %d", a[1], a[4]);
  return 0;
}`);
  assert.equal(r.error, null);
  assert.equal(r.out, '2 1|C|3.0|-3|-1|6|  120|4  |ff\n2 7 16\n2 0');
});

test('运行出错：越界、没赋值就用、死循环、递归没出口、除以 0；不支持的写法', () => {
  assert.match(runMain('int main(){ int a[3]; a[3]=1; return 0; }').error.message, /a\[3\] 越界了（这一维只有 3 个，下标 0～2）/);
  assert.match(runMain('int main(){ int x; x = x + 1; return 0; }').error.message, /x 还没赋值就用了/);
  assert.match(runMain('int main(){ int i = 0; while(i < 3){} return 0; }').error.message, /死循环/);
  assert.match(runMain('int f(int n){ return f(n); } int main(){ f(1); return 0; }').error.message, /递归太深/);
  assert.match(runMain('int main(){ int x = 1/0; return 0; }').error.message, /除以 0/);
  assert.throws(() => parseProgram('int main(){ int **p; }'), /指针的指针/);
  assert.throws(() => parseProgram('union U { int x; };'), /union/);
  assert.match(runMain('int main(){ int a[2] = {1, 2}; int *p = a; p++; return 0; }').error.message, /不支持指针运算/);
  assert.throws(() => parseProgram('int main(){ switch(1){} }'), /switch/);
  assert.throws(() => parseProgram('int main(){ int x = 1 }'), /应该是「;」/);
  assert.throws(() => parseProgram('#define MAX(a,b) a'), /#define 只支持常量/);
  const r = runMain('int main(){ int i; for(i=0;i<2;i++){} return 0; }');
  assert.deepEqual(r.steps.map((s) => s.kind), ['start', 'call', 'decl', 'init', 'cond', 'update', 'cond', 'update', 'cond', 'return', 'end'], '每执行一行一步：调用、定义、for 的初始化、条件、第三部分、返回');
});

test('trace 组件：写法、先猜（执行完那一行之后取值）、quiz、提醒', () => {
  const src = `call: InsertSort(A, 5)\nlet A = [0, 38, 49, 65, 13, 27]\npredict: 7 if i == 4 -> j; 5 -> A[0]\ncode:\n${INSERT}`;
  const input = traceEngine.parse({}, src);
  const r = traceEngine.run(input);
  const asks = r.steps.filter((s) => s.ask?.tag === 'predict').map((s) => [s.ask.q, s.ask.answer]);
  assert.deepEqual(asks, [['执行第 5 行之后，A[0] 是多少？', 13], ['执行第 7 行（i == 4 的那一次）之后，j 是多少？', 3]]);
  assert.equal(traceEngine.defaultAsk(input), 'predict');
  for (const s of r.steps) assert.match(traceEngine.view(s.view, input), /tr-wrap/);
  assert.equal(traceEngine.quiz(input, r).answer, '27 13 27 38 49 65');
  assert.deepEqual(traceEngine.problems(input, r), []);
  const out = traceEngine.parse({}, 'code:\nint main(){ for(int i=1;i<=3;i++) printf("%d ", i*i); return 0; }');
  assert.equal(traceEngine.quiz(out, traceEngine.run(out)).answer, '1 4 9');
  // 没走到的 predict、运行出错：提醒作者
  const miss = traceEngine.parse({}, `${src.replace('7 if i == 4', '7 if i == 9')}`);
  assert.match(traceEngine.problems(miss, traceEngine.run(miss)).join('\n'), /一直没走到/);
  const bad = traceEngine.parse({}, 'code:\nint main(){ int a[2]; a[2] = 1; return 0; }');
  const br = traceEngine.run(bad);
  assert.match(br.steps.at(-1).msg, /运行出错/);
  assert.match(traceEngine.problems(bad, br)[0], /越界/);
  assert.throws(() => traceEngine.parse({}, 'call: f(1)'), /code:/);
  assert.throws(() => traceEngine.parse({}, 'code:\nvoid f(){}'), /没有 main/);
  assert.throws(() => traceEngine.parse({}, 'call: g()\ncode:\nvoid f(){}'), /没有函数 g/);
  assert.throws(() => traceEngine.parse({}, 'predict: 2 -> x++\ncode:\nint main(){ int x = 1; return 0; }'), /不能有赋值/);
  assert.throws(() => traceEngine.parse({}, 'let A = [1, [2]]\ncode:\nint main(){ return 0; }'), /let A/);
});

// —— 第二期：结构体、指针、malloc / free、链表 ——
const LNODE = `typedef struct LNode {
    ElemType data;
    struct LNode *next;
} LNode, *LinkList;
`;
const PRINT = `void Print(LinkList L){
    for (LNode *p = L->next; p != NULL; p = p->next) printf("%d ", p->data);
}
`;

test('王道的链表代码：头插法建表、就地逆置、两个有序表合并（带头结点）', () => {
  const r = runMain(`${LNODE}${PRINT}LinkList List_HeadInsert(LinkList &L, int a[], int n){
    LNode *s;
    L = (LinkList)malloc(sizeof(LNode));
    L->next = NULL;
    for (int i = 0; i < n; i++) {
        s = (LNode *)malloc(sizeof(LNode));
        s->data = a[i];
        s->next = L->next;
        L->next = s;
    }
    return L;
}
void Reverse(LinkList L){
    LNode *p = L->next, *r;
    L->next = NULL;
    while (p != NULL) { r = p->next; p->next = L->next; L->next = p; p = r; }
}
int main(){
    LinkList L;
    int a[4] = {1, 2, 3, 4};
    List_HeadInsert(L, a, 4);
    Print(L);
    Reverse(L);
    Print(L);
    return 0;
}`);
  assert.equal(r.error, null);
  assert.equal(r.out, '4 3 2 1 1 2 3 4 ', '头插法建出来是倒序，逆置回来');
  assert.deepEqual(r.leaks, []);
  const at = r.steps.find((s) => /L->next = s/.test(s.msg));
  assert.match(at.msg, /①\.next：NULL → ②/, '说明里写哪个结点的哪个成员从什么变成什么');
  assert.ok(r.steps.some((s) => /malloc 了新结点③/.test(s.msg)));
  // let 给链表（带头结点），call: 合并
  const m = runCall(`${LNODE}${PRINT}void Merge(LinkList &La, LinkList &Lb){
    LNode *pa = La->next, *pb = Lb->next, *r = La;
    while (pa && pb) {
        if (pa->data <= pb->data) { r->next = pa; r = pa; pa = pa->next; }
        else { r->next = pb; r = pb; pb = pb->next; }
    }
    r->next = pa ? pa : pb;
    free(Lb);
    Lb = NULL;
    Print(La);
}`, 'Merge(La, Lb)', { La: { list: ['1', '4', '7'], head: true }, Lb: { list: ['2', '3', '8'], head: true } });
  assert.equal(m.error, null);
  assert.equal(m.out, '1 2 3 4 7 8 ');
  assert.deepEqual(m.leaks, []);
});

test('二叉链表：let 给树，递归先序遍历（visit 没写时输出 data）', () => {
  const code = `typedef struct BiTNode {
    char data;
    struct BiTNode *lchild, *rchild;
} BiTNode, *BiTree;
void PreOrder(BiTree T){
    if (T != NULL) {
        visit(T);
        PreOrder(T->lchild);
        PreOrder(T->rchild);
    }
}`;
  const input = traceEngine.parse({}, `call: PreOrder(T)\nlet T = tree A(B(D, E), C(, F))\npredict: 8 if T->data == 'B' -> T->lchild\ncode:\n${code}`);
  const r = traceEngine.run(input);
  assert.equal(r.out, 'A B D E C F ');
  assert.ok(r.final.frames.length === 0 && r.steps.some((s) => s.view.frames.filter((f) => f.fn === 'PreOrder').length === 4), '递归一层层叠起来');
  // 先猜问指针：答它指向的结点的 data
  const ask = r.steps.find((s) => s.ask?.tag === 'predict').ask;
  assert.match(ask.q, /T->lchild 指向哪个结点/);
  assert.ok(checkAsk(ask, 'D').ok && !checkAsk(ask, 'E').ok && !checkAsk(ask, 'NULL').ok);
  const nul = traceEngine.run(traceEngine.parse({}, `call: PreOrder(T)\nlet T = tree A(B(D, E), C(, F))\npredict: 8 if T->data == 'D' -> T->lchild\ncode:\n${code}`)).steps.find((s) => s.ask?.tag === 'predict').ask;
  assert.ok(checkAsk(nul, 'NULL').ok && checkAsk(nul, '∧').ok, '空指针答 NULL');
  // 画面：结点框带 data-key（换步时滑过去），二叉链表画成树（有边）
  const html = traceEngine.view(r.steps[3].view, input);
  assert.match(html, /tr-heap-svg/);
  assert.match(html, /data-key="h1"/);
  assert.match(html, /data-label="T"/);
});

test('指针出错停在那一行：空指针、free 以后再用、free 两次、野指针；没人指着的结点算内存泄漏', () => {
  const nul = runMain(`${LNODE}int main(){
    LinkList L = (LinkList)malloc(sizeof(LNode));
    L->next = NULL;
    LNode *p = L->next;
    p->data = 5;
    return 0;
}`);
  assert.equal(nul.error.line, 9);
  assert.match(nul.error.message, /p 是 NULL（空指针），不能用 p->data/);
  const uaf = runMain(`${LNODE}int main(){
    LNode *p = (LNode *)malloc(sizeof(LNode));
    p->data = 1;
    free(p);
    int x = p->data;
    return 0;
}`);
  assert.equal(uaf.error.line, 9);
  assert.match(uaf.error.message, /p 指向的结点①已经 free 了，不能再用 p->data/);
  assert.ok(uaf.steps.some((s) => /释放了结点①（p 还指着它/.test(s.msg)));
  assert.match(runMain(`${LNODE}int main(){ LNode *p = (LNode *)malloc(sizeof(LNode)); LNode *q = p; free(p); free(q); return 0; }`).error.message, /free 两次/);
  assert.match(runMain(`${LNODE}int main(){ LNode *p; p->next = NULL; return 0; }`).error.message, /野指针/);
  // 内存泄漏不停：那一步提醒，最后一步再总结
  const leak = runMain(`${LNODE}int main(){
    LNode *p = (LNode *)malloc(sizeof(LNode));
    p = NULL;
    return 0;
}`);
  assert.equal(leak.error, null);
  assert.deepEqual(leak.leaks, [1]);
  assert.match(leak.steps.find((s) => s.line === 7).msg, /内存泄漏/);
  assert.match(leak.steps.at(-1).msg, /内存泄漏：①/);
  // trace 组件：出错的那一步红的是出错的那一行
  const bad = traceEngine.parse({}, `call: Del(L)\nlet L = list [头, 1]\ncode:\n${LNODE}void Del(LinkList L){\n    LNode *q = L->next->next;\n    L->next = q->next;\n}`);
  const br = traceEngine.run(bad);
  assert.equal(br.steps.at(-1).view.line, 7);
  assert.match(traceEngine.problems(bad, br)[0], /q 是 NULL/);
});
