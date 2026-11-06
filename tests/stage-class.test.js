// 学习台里的舞台课（kit/src/stage/classroom.js）不碰 DOM 的部分：老师这一轮哪些行上舞台、填的答案怎么判、
// 学生做了什么写给老师的那一句、每一轮的整份说明、开课用哪种形态
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageLines, sameAnswer, actText } from '../kit/src/stage/stage.js';
import { buildStageSystem, STAGE_MEMO_DOC, STAGE_SYSTEM_MAX } from '../kit/src/stage/doc.js';
import { classForm, SESSION_KINDS, isTeach } from '../kit/src/memory/session.js';
import { sampleMemory } from '../kit/src/memory/sample.js';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';

test('老师这一轮：代码块记号不演，board memo 块里的行不上舞台（行号不变）', () => {
  const lines = stageLines('say "看"\n```\nglow a.1\n```\n````board memo\nnote text="x" basis=S1\n````\nask next "好"');
  assert.deepEqual(lines, ['say "看"', null, 'glow a.1', null, null, null, null, 'ask next "好"']);
  // 写到一半（memo 块还没收尾）：块里的照样不演
  assert.deepEqual(stageLines('````board memo\nnote text="x"'), [null, null]);
});

test('填的答案：数按数比（0.50 = .5 = 1/2），别的去掉空格、不分大小写', () => {
  assert.ok(sameAnswer('0.50', '1/2'));
  assert.ok(sameAnswer(' 5 ', '5'));
  assert.ok(sameAnswer('O(N^2)', 'o(n^2)'));
  assert.ok(!sameAnswer('4', '5'));
  assert.ok(!sameAnswer('1/0', '0'));
});

test('写给老师的那一句：点了哪一格、对没对；拖；填的答案；打的字；中间拨过的数', () => {
  assert.equal(actText({ type: 'tap', ref: 'a.4', value: '97', key: 4, slot: 4, expected: 'a.7', right: false }), '学生点了 a.4（97）——你预期的是 a.7，点的不是它');
  assert.match(actText({ type: 'tap', ref: 'a.3', value: '49′', key: 8, slot: 3 }), /a\.3（49′，#8）/);
  assert.match(actText({ type: 'value', text: '5', answer: '5', right: true }), /填了「5」——正确答案是 5，填对了/);
  assert.equal(actText({ type: 'say', text: '不懂' }), '学生说：「不懂」');
  assert.match(actText({ type: 'next', button: '看出来了', tries: [{ type: 'dial', name: 'd', path: [5, 3, 2] }] }), /学生拨了 d：5 → 3 → 2（停在 2）\n学生点了「看出来了」/);
});

test('每一轮的整份说明：怎么教、舞台的写法、资料包、记忆；不用「他」「她」；不超过上限', () => {
  const mem = sampleMemory('2026-11-05');
  const t = buildStageSystem({ pack: { main: { unit: '希尔排序', textbook: '王道原文：希尔排序……' } }, memory: { mem, block: 'L2.1.4', space: 'math', session: 'c-20261106-1' }, title: '希尔排序' });
  assert.match(t, /# 一、怎么教/);
  assert.match(t, /# 二、舞台的写法/);
  assert.match(t, /# 三、这节课：希尔排序/);
  assert.match(t, /王道原文：希尔排序/);
  assert.match(t, /# 四、你对学生的了解/);
  assert.match(t, /board memo/);
  assert.doesNotMatch(t, /[他她]/);
  assert.ok(Buffer.byteLength(t) < STAGE_SYSTEM_MAX);
  // 记忆的依据写舞台上那一问的编号
  assert.match(STAGE_MEMO_DOC, /basis=S5/);
  assert.doesNotMatch(STAGE_MEMO_DOC, /q-b5/);
  // 没有记忆（不在学习台里）：没有那一节
  assert.doesNotMatch(buildStageSystem({}), /你对学生的了解/);
});

test('开新课一律是舞台；只有自动测试（?dev&form=）还能开出旧的两种；舞台课算讲课的课（报告、复盘、掌握照黑板课那样算）', () => {
  assert.equal(classForm(''), 'stage');
  assert.equal(classForm('?form=class'), 'stage', '不是 ?dev 的地址不认 form');
  assert.equal(classForm('?dev&form=class'), 'class');
  assert.equal(classForm('?dev&form=talk'), 'talk');
  assert.equal(classForm('?dev&form=瞎写'), 'stage');
  // node 里没有 location：不传就读全局的，也是舞台
  assert.equal(classForm(), 'stage');
  assert.equal(SESSION_KINDS.stage, '舞台');
  assert.ok(isTeach({ kind: 'stage' }));
});

// 旧课的 log（改裁判之前照样子页、试演的几种课边演边记下来的：老师的行、学生拨 / 点 / 拖 / 挪词、做到挑战时预写的行），
// 和改之前照它重放出来的「舞台现在」。照 stage.js 的 replay 放：ask 不重放、行带 lenient，学生的行带上 by（裁判要看），
// 老师的行重放时不过裁判（stage.exec 在重放时不核老师的行）
const OLD_LOGS = {
  matrix: {
    log: [
      ["t", "matrix A = 1 1 / -1 -1"],
      ["t", "matrix B = 1 -1 / -1 1 beside=A"],
      ["t", "product C = A B"],
      ["t", "mul C.1,1"],
      ["t", "say \"{C.1,1} 是 A 的第 1 行乘 B 的第 1 列。剩下三格你来：点一格，看它怎么算出来。\""],
      ["t", "open C explain"],
      ["t", "goal g1 \"点出 AB 剩下的三格\" when=\"C = O\""],
      ["t", "@g1 say \"A、B 都不是 O，乘出来却是 O。\""],
      ["t", "@g1 open B edit range=-3..3"],
      ["t", "@g1 goal g2 \"改 B 里的一个数，让 AB 不再是 O\" when=\"C != O\""],
      ["s", "mul C.1,2"],
      ["s", "mul C.2,1"],
      ["s", "mul C.2,2"],
      ["t", "say \"A、B 都不是 O，乘出来却是 O。\""],
      ["t", "open B edit range=-3..3"],
      ["t", "goal g2 \"改 B 里的一个数，让 AB 不再是 O\" when=\"C != O\""],
      ["s", "write B.1,1 2"],
    ],
    state: ["（矩阵：名字.2,3 是第 2 行第 3 列，名字.r2 是第 2 行，名字.c3 是第 3 列；交换两行时数跟着走，名字.2,3 指的总是现在的第 2 行第 3 列）","矩阵 A（2×2）：","  第 1 行：1  1","  第 2 行：-1  -1","矩阵 B（2×2）：","  第 1 行：2  -1","  第 2 行：-1  1","矩阵 C = A B（2×2；算出来的 4 格跟着 A、B 自动重算）：","  第 1 行：1  0","  第 2 行：-1  0","最后说的话：A、B 都不是 O，乘出来却是 O。","学生能直接动的：C explain（点乘积的一格，看它怎么一行乘一列算出来）；B edit（点一格，拨里面的数，-3～3）","挑战 g1「点出 AB 剩下的三格」when=\"C = O\"：做到了","挑战 g2「改 B 里的一个数，让 AB 不再是 O」when=\"C != O\"：做到了"],
  },
  tree: {
    log: [
      ["t", "tree t = 30 20 _ 10"],
      ["t", "say \"插完 10，30 失衡了。\""],
      ["t", "rotate t.30 right"],
      ["t", "insert t 5"],
      ["t", "insert t 4"],
      ["t", "rotate t.10 right"],
      ["t", "open t drag"],
      ["t", "ask next \"看出来了吗\""],
      ["s", "swap t#1 t#2"],
      ["t", "label k t.20 \"根\""],
      ["t", "say \"好\""],
    ],
    state: ["（树：名字.40 是值为 40 的结点；名字#3 是层序第 3 个结点，跟着结点走（值重复、换值以后用它）；名字.40* 是 40 和它下面整棵子树）","树 t（5 个结点，3 层）：层序 30 5 20 4 10","  30：左 5，右 20；5：左 4，右 10","贴着的字：k「根」（贴在 t.20）","最后说的话：好","学生能直接动的：t drag（拖）"],
  },
  sentence: {
    log: [
      ["t", "sentence s = \"The man who lives next door is a doctor.\""],
      ["t", "mark s.1-6 主语"],
      ["t", "mark s.7 谓语"],
      ["t", "open s drag"],
      ["t", "ask next \"把 is 拖到前面看看\" button=\"好了\""],
      ["s", "move s#7 -> s.1"],
    ],
    state: ["（句子：名字.3 现在第 3 个词，名字.2-5 第 2 到 5 个，名字.who 这个词（出现几次写 名字.who:2），名字.who-door 从 who 到 door；括号里的 #k 是「一开始第 k 个的那个词」，写 名字#k 跟着它走）","句子 s（9 个词）：is The man who lives next door a doctor.","  词：1 is（#7）  2 The（#1）  3 man（#2）  4 who（#3）  5 lives（#4）  6 next（#5）  7 door（#6）  8 a  9 doctor","  括号（词下面）：s.2-7 主语（蓝）；s.1 谓语（粉）","学生能直接动的：s drag（拖）"],
  },
  array: {
    log: [
      ["t", "array a = 3 1 2"],
      ["t", "open a"],
      ["t", "goal g1 \"排好\" when=\"a sorted\""],
      ["t", "@g1 say \"排好了\""],
      ["t", "say \"排一排\""],
      ["s", "swap a#1 a#2"],
      ["s", "swap a#1 a#3"],
      ["t", "say \"排好了\""],
    ],
    state: ["（一排格子：名字.k 是现在第 k 格；括号里的 #k 是「一开始在第 k 格的那一个」，写 名字#k 跟着它走）","一排格子 a（3 格）：","  第 1～3 格：1（#2） 2（#3） 3（#1）","最后说的话：排好了","学生能直接动的：a drag（拖）","挑战 g1「排好」when=\"a sorted\"：做到了"],
  },
  edit: {
    log: [
      ["t", "matrix A = 1 1 / -1 -1"],
      ["t", "matrix B = 1 -1 / -1 1 beside=A"],
      ["t", "product C = A B"],
      ["t", "mul C"],
      ["t", "open B.1,1 edit range=-3..3"],
      ["t", "goal g1 \"让 C.1,1 变成 2\" when=\"C.1,1 = 2\""],
      ["s", "write B.1,1 2"],
      ["s", "write B.1,1 3"],
    ],
    state: ["（矩阵：名字.2,3 是第 2 行第 3 列，名字.r2 是第 2 行，名字.c3 是第 3 列；交换两行时数跟着走，名字.2,3 指的总是现在的第 2 行第 3 列）","矩阵 A（2×2）：","  第 1 行：1  1","  第 2 行：-1  -1","矩阵 B（2×2）：","  第 1 行：3  -1","  第 2 行：-1  1","矩阵 C = A B（2×2；算出来的 4 格跟着 A、B 自动重算）：","  第 1 行：2  0","  第 2 行：-2  0","学生能直接动的：B.1,1 edit（点一格，拨里面的数，-3～3）","挑战 g1「让 C.1,1 变成 2」when=\"C.1,1 = 2\"：做到了"],
  },
  plane: {
    log: [
      ["t", "plane p range=-3..3"],
      ["t", "point p P = 1 2"],
      ["t", "vec p u = 1 1"],
      ["t", "vec p w = {2 u}"],
      ["t", "open p drag"],
      ["s", "vec p u = 2 1"],
    ],
    state: ["（平面：名字.u 是向量 u（从原点出发的箭头），名字.P 是点 P；坐标是数学里的 (x, y)，y 朝上）","平面 p（x 从 -3 到 3，y 从 -3 到 3；一格是 1）：","  点 P = (1, 2)","  向量 u = (2, 1)（蓝）","  向量 w = {2 u} = (4, 2)（粉、出了网格）","跟着算的（依赖一变，页面当场重算；学生动不了）：p.w = {2 u}","学生能直接动的：p drag（拖）"],
  },
};
function replayScene(log) {
  const s = new Scene();
  for (const [by, src] of log) for (const c of parseScript(src)) {
    if (c.cmd === 'ask' && !c.on) continue;
    try { s.apply({ ...c, lenient: true }, { by: by === 's' ? 'student' : null }); } catch { /* 当时就没演 */ }
  }
  s.waiting = null;
  return s.stateText();
}

test('旧 log 照放：没有新写法的课，重放出来的「舞台现在」和改裁判之前一字不差', () => {
  for (const [k, { log, state }] of Object.entries(OLD_LOGS)) assert.equal(replayScene(log), state.join('\n'), k);
});

test('给老师的那一段：页面核过你上一轮的几步、跟着变的，只在有内容时出现', async () => {
  const { turnMessage } = await import('../kit/src/stage/doc.js');
  const m = turnMessage({ act: 'x', state: 'y', audit: ['你在 50 右旋，现在正确的是先在 30 左旋（LR 型）'] });
  assert.match(m, /\[页面核过你上一轮的几步\][^\n]*\n- 你在 50 右旋，现在正确的是先在 30 左旋（LR 型）/);
  const d = turnMessage({ act: 'x', state: 'y', derived: [
    { part: {}, before: '0', after: '1', id: 'C', changed: [{ ref: 'C.1,1', from: '0', to: '1' }] },
    { id: 'S', changed: [{ ref: 'S.1,2', from: '2', to: '3' }, { ref: 'S.2,2', from: '4', to: '5' }], parts: [] },
    { id: 'P', changed: [], error: '「{A^-1}」算不出来：A 不可逆' },
    { id: 'a', changed: [{ ref: 'a', expr: 'k + 1', from: 2, to: 3 }] },
  ] });
  assert.match(d, /\[跟着变的\]/);
  assert.match(d, /C\.1,1 从 0 变成 1/);
  assert.match(d, /S\.2,2 从 4 变成 5/);
  assert.match(d, /P 算不出来：A 不可逆/);
  assert.match(d, /a 里的 \{k \+ 1\} 从 2 变成 3/);
  // 同一格变了几次：从第一次之前变成最后的；变回原样的不写
  const twice = turnMessage({ act: 'x', state: 'y', derived: [{ id: 'C', changed: [{ ref: 'C.1,1', from: '0', to: '1' }] }, { id: 'C', changed: [{ ref: 'C.1,1', from: '1', to: '2' }] }, { id: 'C', changed: [{ ref: 'C.2,1', from: '0', to: '1' }] }, { id: 'C', changed: [{ ref: 'C.2,1', from: '1', to: '0' }] }] });
  assert.match(twice, /C\.1,1 从 0 变成 2/);
  assert.doesNotMatch(twice, /C\.2,1/);
  const plain = turnMessage({ act: 'x', state: 'y' });
  assert.doesNotMatch(plain, /页面核过|跟着变的/);
});

test('课堂循环：call=wrong 走偏的一下马上叫老师；做完了没预写就叫、老师做完的不叫；发出去的那一条带核过的几步、跟着变的，说过就清掉', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const make = () => {
    const stage = { log: [], scene: new Scene(), teacherAudit: ['你在 50 右旋，现在正确的是先在 30 左旋（LR 型）'], reacting: null, studentChain: null, pendingGoals: () => [] };
    const rows = [];
    const host = { stage, addTurn: (r) => { const x = { ...r, seq: rows.length + 1 }; rows.push(x); return x; }, putTurn: () => {}, note: () => {} };
    return { stage, rows, loop: createLoop(host) };
  };
  const sent = (rows) => rows.filter((r) => r.role === 'student' && !r.pending);
  // 走偏的一下（裁判说马上叫）
  const a = make();
  a.loop.onAct({ type: 'rotate', open: 'rotate', src: 'rotate t#1 right', call: 'now', verdict: { legal: true, right: false, misread: null, why: '50 右旋', next: '先在 30 左旋' }, derived: [{ id: 'C', changed: [{ ref: 'C.1,1', from: '0', to: '1' }] }] });
  await tick();
  const m = sent(a.rows)[0]?.msg || '';
  assert.match(m, /学生 rotate t#1 right（50 右旋）——不是正确的下一步；正确的是先在 30 左旋/);
  assert.match(m, /\[跟着变的\][^\n]*\n- C\.1,1 从 0 变成 1/);
  assert.match(m, /\[页面核过你上一轮的几步\][^\n]*\n- 你在 50 右旋/);
  assert.deepEqual(a.stage.teacherAudit, [], '核过的说过就清掉');
  // 不判的一下（拨格子）照旧攒着
  const b = make();
  b.loop.onAct({ type: 'edit', open: 'edit', ref: 'B.1,1', from: '1', to: '2' });
  await tick();
  assert.equal(sent(b.rows).length, 0);
  // 做完了：老师做完的不叫；学生做完的、没预写就叫
  const c = make();
  c.stage.onDone(['t'], { by: 'teacher', reacted: 0 });
  await tick();
  assert.equal(c.rows.length, 0);
  c.stage.onDone(['t'], { by: 'student', reacted: 0 });
  await tick();
  assert.match(sent(c.rows)[0]?.msg || '', /学生把 t 做完了/);
});
