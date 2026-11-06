// 缺口尺子（evals/stage-gaps/）：助手交回来的理想演法、对照报告，格式全不全
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIdeal, checkReport } from '../tools/stage-gaps-lib.js';

const act = (n, skip = '') => [`### 第 ${n} 幕：一句话`, ...['画面', '动', '老师说', '学生做', '页面当场', '事实', '老师凭什么接'].filter((k) => k !== skip).map((k) => `- ${k}：写了东西`)].join('\n');
const branch = (n) => [`## 分支 ${n}：把 BA 当成 AB`, '- 学生会怎么做：…', '- 老师想演什么：…', '- 页面要提供什么：…'].join('\n');
const ideal = ({ skip = {}, branches = 2 } = {}) => ['# L1 方阵的幂', '## 主线', act(1), act(2, skip[2]), act(3), ...Array.from({ length: branches }, (_, i) => branch(i + 1))].join('\n\n');

test('合格的理想演法：没有问题', () => {
  assert.deepEqual(checkIdeal(ideal()), []);
});
test('理想演法：一幕缺了一项', () => {
  const p = checkIdeal(ideal({ skip: { 2: '事实' } }));
  assert.ok(p.some((x) => x.includes('第 2 幕') && x.includes('事实')), p.join('\n'));
});
test('理想演法：只有一个分支', () => {
  const p = checkIdeal(ideal({ branches: 1 }));
  assert.ok(p.some((x) => x.includes('分支')), p.join('\n'));
});
test('理想演法：一项写了标签但后面是空的', () => {
  const p = checkIdeal(ideal().replace('- 动：写了东西', '- 动：'));
  assert.ok(p.some((x) => x.includes('动')), p.join('\n'));
});

const marks = (n, skip = '') => ['画面', '动', '老师说', '学生做', '页面当场', '事实'].filter((k) => k !== skip).map((k) => `- ✅ 第 ${n} 幕·${k}：做到了`);
const report = ({ skip = {}, bad = '' } = {}) => ['## L1', ...marks(1), ...marks(2), ...marks(3, skip[3]), '- ✅ 分支 1·页面要提供什么：有', '- ✅ 分支 2·页面要提供什么：有', bad].join('\n');

test('合格的对照报告：没有问题', () => {
  assert.deepEqual(checkReport(report(), { L1: ideal() }), []);
});
test('对照报告：漏了第 3 幕的「动」', () => {
  const p = checkReport(report({ skip: { 3: '动' } }), { L1: ideal() });
  assert.ok(p.some((x) => x.includes('第 3 幕') && x.includes('动')), p.join('\n'));
});
test('对照报告：❌ 没有「结果」', () => {
  const p = checkReport(report({ bad: '- ❌ 第 2 幕·页面当场：做不了\n  - 要的：…\n  - 指令：`try/L1/幕2.txt`' }), { L1: ideal() });
  assert.ok(p.some((x) => x.includes('结果')), p.join('\n'));
});
test('对照报告：理想里有的块，报告里整节没有', () => {
  const p = checkReport(report(), { L1: ideal(), L2: ideal() });
  assert.ok(p.some((x) => x.includes('L2')), p.join('\n'));
});
