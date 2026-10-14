// C 子集解释器（kit/src/cinterp.js）和代码跟踪组件（engines/trace.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram, runProgram, parseExpression } from '../kit/src/cinterp.js';
import { traceEngine } from '../kit/src/engines/trace.js';

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
  assert.throws(() => parseProgram('int main(){ int *p; }'), /指针/);
  assert.throws(() => parseProgram('struct Node { int x; };'), /struct/);
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
