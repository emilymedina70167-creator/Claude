// 黑板的视力（kit/src/class/boardsight.js）：纯函数那一半
import test from 'node:test';
import assert from 'node:assert/strict';
import { rawBits, boardSightIssues, boardSightText, sightSig } from '../kit/src/class/boardsight.js';
import { boardStateText } from '../kit/src/class/prompt.js';

const R = (x, y, w, h) => ({ x, y, w, h });
// 一条横线：从 (x0, y) 到 (x1, y) 取 21 个点
const line = (x0, x1, y) => Array.from({ length: 21 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 20, y }));

test('漏出来的源码：成对的 **、==、$…$、反斜杠命令', () => {
  assert.deepEqual(rawBits('为什么老是有 **两个星号** 呢'), ['**两个星号**']);
  assert.deepEqual(rawBits('要背的 ==be + done== 这里'), ['==be + done==']);
  // 代码里的比较两头是空格：不是漏出来的荧光笔（11-24 trace 的 predict 条件被报了）
  assert.deepEqual(rawBits('执行到 dk == 2 && i == 5 的时候'), []);
  assert.deepEqual(rawBits('答案是 $\\frac{1}{2}$'), ['$\\frac{1}{2}$']);
  assert.ok(rawBits('写成 \\frac{a}{b} 了').some((b) => b.startsWith('\\frac')));
  // 正文本来的符号不算
  assert.deepEqual(rawBits('花了 $5 买书，a = b，2 * 3'), []);
  assert.deepEqual(rawBits(''), []);
});

test('标注的线穿过输入框才报，圈在外面绕的不报', () => {
  const box = { where: 'c-basic', what: '输入框', rect: R(100, 100, 200, 40) };
  const through = boardSightIssues({ marks: [{ id: 'm3', pts: line(50, 350, 120), note: null }], controls: [box] });
  assert.equal(through.length, 1);
  assert.equal(through[0].kind, 'cross');
  assert.match(through[0].text, /标注 m3 的线穿过了 c-basic 的输入框/);
  // 圈在框外面（上面 10 像素）走过去
  const around = boardSightIssues({ marks: [{ id: 'm3', pts: line(50, 350, 90), note: null }], controls: [box] });
  assert.equal(around.length, 0);
  // 只擦过边（边上留 2 像素）
  const edge = boardSightIssues({ marks: [{ id: 'm3', pts: line(50, 350, 101), note: null }], controls: [box] });
  assert.equal(edge.length, 0);
});

test('旁注压着字、压着输入框', () => {
  const issues = boardSightIssues({
    marks: [{ id: 'm1', pts: [], note: R(100, 100, 120, 30) }],
    controls: [{ where: 'q1', what: '按钮', rect: R(200, 110, 80, 44) }],
    texts: [{ where: 'b7', rect: R(90, 105, 300, 20) }, { where: 'b7', rect: R(90, 300, 300, 20) }, { where: 'b9', rect: R(600, 100, 100, 20) }],
  });
  const texts = issues.map((x) => x.text);
  assert.ok(texts.includes('标注 m1 的旁注压着 q1 的按钮'));
  assert.ok(texts.includes('标注 m1 的旁注压着 b7 的字'));
  assert.ok(!texts.some((t) => t.includes('b9')));
  // 同一段压了好几行只报一次
  assert.equal(texts.filter((t) => t.includes('b7')).length, 1);
});

test('伸出板外、要横着滑、漏出源码、一栏太窄', () => {
  const issues = boardSightIssues({
    spill: [{ where: 'b4', what: '表', by: 38.4 }],
    scroll: [{ where: 'b5', what: '公式', need: 1320, have: 1140 }],
    raw: [{ where: 'b6', bits: ['**重点**'] }],
    narrow: [{ where: 'b8', width: 220, lines: 9 }],
  });
  const t = issues.map((x) => x.text);
  assert.deepEqual(t, [
    'b4 的表伸出板的右边 38 像素，学生那边被裁掉',
    'b5 的公式宽约 1320，这里只有 1140，学生要横着滑才看得全',
    'b6 的字里露出了没画出来的写法：「**重点**」',
    'b8 所在的那一栏只有 220 像素宽，一段话折成了 9 行',
  ]);
});

test('写成黑板现状的一节：干净的板什么都不写；多了只列前几条', () => {
  assert.equal(boardSightText([]), '');
  const many = Array.from({ length: 15 }, (_, i) => ({ kind: 'spill', key: `k${i}`, text: `b${i} 的表伸出板的右边 10 像素，学生那边被裁掉` }));
  const text = boardSightText(many);
  assert.match(text, /^版面（页面在学生屏幕上量的）：/);
  assert.match(text, /另有 3 处同类的没列/);
  // 只写事实：不写「你应该」「请」这类做法
  assert.doesNotMatch(text, /你应该|请|必须|建议/);
});

test('同一批问题的指纹不看先后', () => {
  const a = [{ key: 'x' }, { key: 'y' }], b = [{ key: 'y' }, { key: 'x' }];
  assert.equal(sightSig(a), sightSig(b));
  assert.notEqual(sightSig(a), sightSig([{ key: 'x' }]));
  assert.equal(sightSig([]), '');
});

test('黑板现状里带上这一节（有问题才有）', () => {
  const board = { segs: [{ id: 'b1', page: 1, place: 'board', title: '一', blocks: [] }], pages: [{ n: 1, title: '一' }], cur: 1, view: 1 };
  assert.doesNotMatch(boardStateText(board), /版面（页面在学生屏幕上量的）/);
  const text = boardStateText({ ...board, sight: '版面（页面在学生屏幕上量的）：\n- 标注 m1 的线穿过了 c1 的输入框' });
  assert.match(text, /标注 m1 的线穿过了 c1 的输入框/);
});
