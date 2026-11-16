// 这节课学生打的原话一直在老师的说明里（清点第二节第 4 条）：话的账停了以后，对话一长被压缩，
// 学生第 10 分钟说的那句只剩转述。页面照抄、不调用模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saidNow } from '../kit/src/memory/summary.js';
import { memoryDigest } from '../kit/src/memory/digest.js';
import { buildSystem, compactionSlice, summaryTurn } from '../kit/src/class/prompt.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

const utf8 = (s) => new TextEncoder().encode(s).length;
const stu = (seq, say, extra = {}) => ({ role: 'student', seq, say, text: say, ...extra });
const tea = (seq) => ({ role: 'teacher', seq, text: '老师讲了一段。' });

const withSummary = () => {
  const mem = sampleMemory('2026-11-01');
  mem.summary = [
    { id: 'shared', text: '学生在备考 2027 年考研。', v: 1, at: 1, by: 'chat' },
    { id: 'math', text: '线代学到特征值。', v: 1, at: 1, by: 'chat' },
  ];
  return mem;
};

test('学生打的三句原话都在，页面的快捷回答「继续。」「开始上课。」不在', () => {
  const turns = [
    stu(1, '开始上课。'), tea(2),
    stu(3, '别再一上来给我九句话，先给我结论'), tea(4),
    stu(5, '继续。'), tea(6),
    stu(7, '这里的 that 为什么不是关系代词？'), tea(8),
    stu(9, '', { actions: ['答对了'] }), tea(10),
    stu(11, '表格比一段话好认'),
  ];
  const text = saidNow(turns);
  assert.match(text, /第 3 轮：别再一上来给我九句话，先给我结论/);
  assert.match(text, /第 7 轮：这里的 that 为什么不是关系代词？/);
  assert.match(text, /第 11 轮：表格比一段话好认/);
  assert.doesNotMatch(text, /继续。|开始上课。/);
  assert.equal(text.split('\n').length, 3, '只有作答、没打字的那一轮不占一行');
  assert.ok(text.indexOf('第 3 轮') < text.indexOf('第 11 轮'), '新的在后');
});

test('没打过字是空的', () => {
  assert.equal(saidNow([stu(1, '开始上课。'), tea(2), stu(3, '继续。')]), '');
  assert.equal(saidNow([]), '');
  assert.equal(saidNow(), '');
});

test('四十句长话：不超 1536 字节，最后 6 句一句不少，写明省略了几句', () => {
  const turns = [];
  for (let i = 0; i < 40; i++) turns.push(stu(2 * i + 1, `第${i}句：${'这一句话比较长'.repeat(8)}`), tea(2 * i + 2));
  const text = saidNow(turns);
  assert.ok(utf8(text) <= 1536, `${utf8(text)} 字节`);
  for (let i = 34; i < 40; i++) assert.ok(text.includes(`第${i}句：`), `最后 6 句里的第 ${i} 句`);
  const m = text.match(/更早的 (\d+) 句省略了/);
  assert.ok(m, '写了省略几句');
  const kept = text.split('\n').filter((l) => /^第 \d+ 轮：/.test(l)).length;
  assert.equal(kept + Number(m[1]), 40);
  assert.ok(!text.includes('第0句：'), '从最早的丢');
});

test('一句特别长的话截短，不让它一句占满', () => {
  const text = saidNow([stu(1, '啊'.repeat(2000)), tea(2), stu(3, '短的一句')]);
  assert.ok(utf8(text) <= 1536);
  assert.match(text, /第 1 轮：啊+…/);
  assert.match(text, /第 3 轮：短的一句/);
});

test('多行的一句话压成一行', () => {
  assert.equal(saidNow([stu(1, '第一行\n第二行')]), '第 1 轮：第一行 第二行');
});

test('有摘要时记忆那一节带着「这节课学生打的话」，话的账写的那一节不再带', () => {
  const mem = withSummary();
  mem.saidOnce = [{ text: '这一次先不讲证明' }];
  const said = saidNow([stu(3, '别再一上来给我九句话'), tea(4)]);
  const d = memoryDigest(mem, { block: 'L5-01', space: 'math', session: 'c-20261101-1', saidNow: said });
  assert.match(d.text, /## 这节课学生打的话（原话，页面照抄的；这些是当面说的）\n\n第 3 轮：别再一上来给我九句话/);
  assert.doesNotMatch(d.text, /这节课学生说的（只管这节课）/);
  // 放在摘要后面、学习的账前面
  assert.ok(d.text.indexOf('学生在备考 2027 年考研') < d.text.indexOf('这节课学生打的话'));
  // 没打过字就没有这一节
  assert.doesNotMatch(memoryDigest(mem, { block: 'L5-01', space: 'math' }).text, /这节课学生打的话/);
});

test('没有摘要时一切照旧：不带这一节，话的账的那一节照样在', () => {
  const mem = sampleMemory('2026-11-01');
  mem.saidOnce = [{ text: '这一次先不讲证明' }];
  const a = memoryDigest(mem, { block: 'L5-01', space: 'math', saidNow: '第 3 轮：别再一上来给我九句话' });
  const b = memoryDigest(mem, { block: 'L5-01', space: 'math' });
  assert.equal(a.text, b.text);
  assert.match(a.text, /这节课学生说的（只管这节课）/);
});

test('对话被压缩成摘要以后，早先那句原话仍在老师的说明里', () => {
  const history = [stu(1, '开始上课。'), tea(2), stu(3, '别再一上来给我九句话，先给我结论'), tea(4)];
  for (let i = 0; i < 30; i++) history.push(stu(5 + 2 * i, '继续。'), tea(6 + 2 * i));
  // 压缩：前面的轮次换成一条摘要（转述里没有那句原话）
  history.push({ ...summaryTurn('学生希望讲得简洁一些。'), seq: 99, upTo: 40 });
  const { old } = compactionSlice(history);
  assert.ok(Array.isArray(old));
  const system = buildSystem({
    componentDocs: '', pack: {}, board: '', subject: '线代',
    memory: { mem: withSummary(), block: 'L5-01', space: 'math', session: 'c-20261101-1', saidNow: saidNow(history) },
  });
  assert.match(system, /第 3 轮：别再一上来给我九句话，先给我结论/);
});

test('学生打的话逐字照抄：原话里说别人的「他」「她」不换成「学生」', () => {
  const mem = withSummary();
  const said = saidNow([stu(3, '他为什么用过去时？她不是现在才来吗'), tea(4)]);
  const d = memoryDigest(mem, { block: 'L5-01', space: 'math', session: 'c-1', saidNow: said });
  assert.match(d.text, /第 3 轮：他为什么用过去时？她不是现在才来吗/);
});
