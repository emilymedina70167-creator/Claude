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
// 老师的行重放时不过裁判（stage.exec 在重放时不核老师的行）。
// 第二轮的量以后，矩阵、树、句子下面各多一行「页面算的 / 页面数不了」（逐行核过，别的一字不差、先后不变）
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
    state: ["（矩阵：名字.2,3 是第 2 行第 3 列，名字.r2 是第 2 行，名字.c3 是第 3 列；交换两行时数跟着走，名字.2,3 指的总是现在的第 2 行第 3 列）","矩阵 A（2×2）：","  第 1 行：1  1","  第 2 行：-1  -1","  页面算的：rank(A) = 1，rankA(A) = 1，free(A) = 1，det(A) = 0","矩阵 B（2×2）：","  第 1 行：2  -1","  第 2 行：-1  1","  页面算的：rank(B) = 2，rankA(B) = 2，free(B) = 0，det(B) = 1","矩阵 C = A B（2×2；算出来的 4 格跟着 A、B 自动重算）：","  第 1 行：1  0","  第 2 行：-1  0","  页面算的：rank(C) = 1，rankA(C) = 1，free(C) = 1，det(C) = 0","最后说的话：A、B 都不是 O，乘出来却是 O。","学生能直接动的：C explain（点乘积的一格，看它怎么一行乘一列算出来）；B edit（点一格，拨里面的数，-3～3）","挑战 g1「点出 AB 剩下的三格」when=\"C = O\"：做到了","挑战 g2「改 B 里的一个数，让 AB 不再是 O」when=\"C != O\"：做到了"],
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
    state: ["（树：名字.40 是值为 40 的结点；名字#3 是层序第 3 个结点，跟着结点走（值重复、换值以后用它）；名字.40* 是 40 和它下面整棵子树）","树 t（5 个结点，3 层）：层序 30 5 20 4 10","  30：左 5，右 20；5：左 4，右 10","  页面算的：count(t) = 5，height(t) = 3，tray(t) = 0；avl 是，bst 否","贴着的字：k「根」（贴在 t.20）","最后说的话：好","学生能直接动的：t drag（拖）"],
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
    state: ["（句子：名字.3 现在第 3 个词，名字.2-5 第 2 到 5 个，名字.who 这个词（出现几次写 名字.who:2），名字.who-door 从 who 到 door；括号里的 #k 是「一开始第 k 个的那个词」，写 名字#k 跟着它走）","句子 s（9 个词）：is The man who lives next door a doctor.","  词：1 is（#7）  2 The（#1）  3 man（#2）  4 who（#3）  5 lives（#4）  6 next（#5）  7 door（#6）  8 a  9 doctor","  括号（词下面）：s.2-7 主语（S），蓝；s.1 谓语（V），粉","  页面数不了：s 没写 key","学生能直接动的：s drag（拖）"],
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
    state: ["（矩阵：名字.2,3 是第 2 行第 3 列，名字.r2 是第 2 行，名字.c3 是第 3 列；交换两行时数跟着走，名字.2,3 指的总是现在的第 2 行第 3 列）","矩阵 A（2×2）：","  第 1 行：1  1","  第 2 行：-1  -1","  页面算的：rank(A) = 1，rankA(A) = 1，free(A) = 1，det(A) = 0","矩阵 B（2×2）：","  第 1 行：3  -1","  第 2 行：-1  1","  页面算的：rank(B) = 2，rankA(B) = 2，free(B) = 0，det(B) = 2","矩阵 C = A B（2×2；算出来的 4 格跟着 A、B 自动重算）：","  第 1 行：2  0","  第 2 行：-2  0","  页面算的：rank(C) = 1，rankA(C) = 1，free(C) = 1，det(C) = 0","学生能直接动的：B.1,1 edit（点一格，拨里面的数，-3～3）","挑战 g1「让 C.1,1 变成 2」when=\"C.1,1 = 2\"：做到了"],
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

// —— 整条分支的最终审查（I5、I6）——

test('I5 撤一步以后：[跟着变的] 不再写撤掉的那一下引起的变化（[学生] 里那一下照写，后面跟着「撤回了」）', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const stage = { log: [], scene: new Scene(), teacherAudit: [], reacting: null, studentChain: null, pendingGoals: () => [] };
  const rows = [];
  const host = { stage, addTurn: (r) => { const x = { ...r, seq: rows.length + 1 }; rows.push(x); return x; }, putTurn: () => {}, note: () => {} };
  const loop = createLoop(host);
  // 学生拨了 B.1,1（乘积 C 跟着变）、又拨了 B.2,2（C.2,2 跟着变），再撤回最后那一下
  loop.onAct({ type: 'edit', open: 'edit', ref: 'B.1,1', from: '0', to: '1', line: 'write B.1,1 1', derived: [{ id: 'C', changed: [{ ref: 'C.1,1', from: '0', to: '1' }] }] });
  loop.onAct({ type: 'edit', open: 'edit', ref: 'B.2,2', from: '0', to: '2', line: 'write B.2,2 2', derived: [{ id: 'C', changed: [{ ref: 'C.2,2', from: '0', to: '4' }] }] });
  loop.onAct({ type: 'undo', src: 'write B.2,2 2', open: 'edit' });
  stage.onAnswer({ type: 'say', text: '好了' });
  await tick();
  const m = rows.find((r) => r.role === 'student' && !r.pending)?.msg || '';
  assert.match(m, /学生拨了 B\.2,2/);
  assert.match(m, /撤回了自己的上一下：write B\.2,2 2/);
  assert.match(m, /\[跟着变的\][^\n]*\n- C\.1,1 从 0 变成 1/, '没撤的那一下照写');
  assert.doesNotMatch(m, /C\.2,2/, '撤掉的那一下引起的变化不写');
});

test('I6 老师那一轮还在写的时候学生动了：学生那一段排在老师那一轮后面，发给老师的对话照先后、最后一条是学生的', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
  const history = [];
  let seq = 0;
  const addTurn = (t) => { const row = { ...t, seq: ++seq }; history.push(row); return row; };
  const scene = { goals: new Map(), waiting: { kind: 'say' }, clone() { return { ...this, stateText: () => 'S' }; }, stateText: () => 'S' };
  let resolveCall;
  const calls = [];
  const stage = {
    log: [], errors: [], reacting: Promise.resolve(), studentChain: Promise.resolve(), teacherAudit: [], scene,
    pendingGoals: () => [],
    begin() { const mark = this.log.length; let armedR; const armed = new Promise((r) => (armedR = r)); return { mark, push() {}, end() { armedR(); return new Promise(() => {}); }, drop() {}, abort: async () => {}, armed }; },
    play: async () => ({}),
  };
  const messages = () => history.filter((t) => !t.discarded && !t.pending && (t.role === 'claude' || t.role === 'student')).map((t) => `${t.role === 'claude' ? 'A' : 'U'}:${t.role === 'claude' ? t.text : t.msg}`);
  const host = {
    stage, mock: true, model: 'm', teach: {}, quietMs: 1e9,
    messages, addTurn, putTurn() {}, cost: (c) => c, thinking() {},
    call: (input) => { calls.push(input); return new Promise((r) => { resolveCall = r; }); },
  };
  const loop = createLoop(host);
  const p = loop.teach('turn');
  await wait();
  // 老师还在写（调用没返回）：学生动了一下（试，不叫老师）
  loop.onAct({ type: 'drag', open: 'drag', text: '学生拖了一下' });
  resolveCall({ text: 'say "x"', modelApplied: 'm' });
  await p;
  await wait();
  // 学生答了：叫老师
  stage.onAnswer({ type: 'say', text: '我答了' });
  await wait(50);
  const live = history.filter((t) => !t.discarded && (t.role === 'claude' || t.role === 'student'));
  assert.deepEqual(live.map((t) => t.role), ['claude', 'student'], history.map((t) => `${t.seq}:${t.role}${t.discarded ? '(作废)' : ''}`).join(' '));
  assert.ok(live[0].seq < live[1].seq);
  const input = calls[1];
  assert.match(input.at(-1), /^U:[\s\S]*学生拖了一下[\s\S]*我答了/);
  assert.match(input.at(-2), /^A:say "x"/);
});

test('复核 撤一步跳过没演上的那一下（M4）：同一行先演上、后来又没演上，撤的是演上的那一下', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const stage = { log: [], scene: new Scene(), teacherAudit: [], reacting: null, studentChain: null, pendingGoals: () => [] };
  const rows = [];
  const host = { stage, addTurn: (r) => { const x = { ...r, seq: rows.length + 1 }; rows.push(x); return x; }, putTurn: () => {}, note: () => {} };
  const loop = createLoop(host);
  loop.onAct({ type: 'edit', open: 'edit', ref: 'B.1,1', from: '0', to: '1', line: 'write B.1,1 1', derived: [{ id: 'C', changed: [{ ref: 'C.1,1', from: '0', to: '1' }] }] });
  loop.onAct({ type: 'edit', open: 'edit', ref: 'B.1,1', from: '1', to: '1', line: 'write B.1,1 1', error: '这一下演不了' });
  loop.onAct({ type: 'undo', src: 'write B.1,1 1', open: 'edit' });
  stage.onAnswer({ type: 'say', text: '好了' });
  await tick();
  const m = rows.find((r) => r.role === 'student' && !r.pending)?.msg || '';
  assert.doesNotMatch(m, /\[跟着变的\]/, '演上的那一下撤掉了，它引起的变化不写');
});

test('课堂循环：页面记下的一句（老师演的那一下改了学生先点的几样）不叫老师、跟着下一条发；「再看一遍」重演不重复记；作废的那一轮记的不算', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  const stage = { log: [], scene: new Scene(), teacherAudit: [], reacting: null, studentChain: null, pendingGoals: () => [] };
  const rows = [];
  const host = { stage, addTurn: (r) => { const x = { ...r, seq: rows.length + 1 }; rows.push(x); return x; }, putTurn: () => {}, note: () => {} };
  const loop = createLoop(host);
  const note = '学生先点的 3 个里，这一下以后变了的：t.45、t.40；没变的：t.20；变了却没点的：t.30（你演的 insert t 47）';
  stage.onNote(note, { turn: 4 });
  stage.onNote(note, { turn: 4 });
  await wait();
  assert.equal(rows.filter((r) => r.role === 'student' && !r.pending).length, 0, '不叫老师');
  assert.equal(loop.pending.events.length, 1, '重演同一行不重复记');
  stage.onAnswer({ type: 'say', text: '原来 30 也变了' });
  await wait();
  const m = rows.find((r) => r.role === 'student' && !r.pending)?.msg || '';
  assert.ok(m.includes(`${note}\n学生说：「原来 30 也变了」`), m);

  // 作废的那一轮（不是指定的模型）：演的时候记下的那一句跟着退回去
  const s2 = {
    log: [], errors: [], reacting: Promise.resolve(), studentChain: Promise.resolve(), teacherAudit: [], scene: new Scene(), pendingGoals: () => [],
    begin() { const armed = new Promise(() => {}); return { mark: 0, turn: 9, push() {}, end() { return new Promise(() => {}); }, drop() {}, abort: async () => {}, armed }; },
    play: () => new Promise(() => {}),
  };
  const rows2 = [];
  let calls = 0;
  const host2 = {
    stage: s2, mock: false, model: 'want', teach: {}, quietMs: 1e9, messages: () => [{ content: 'x' }], putTurn() {}, cost: (c) => c, thinking() {},
    addTurn: (r) => { const x = { ...r, seq: rows2.length + 1 }; rows2.push(x); return x; },
    call: async () => {
      if (++calls > 1) return new Promise(() => {});
      s2.onLine(); // 演上了一行
      s2.onNote(note, { turn: 9 });
      return { text: 'insert t 47', modelApplied: 'other' };
    },
  };
  const loop2 = createLoop(host2);
  loop2.teach('turn');
  await wait(20);
  assert.ok(rows2.some((r) => r.kind === 'fallback'));
  assert.deepEqual((loop2.pending?.events || []).filter((e) => e.kind === 'note'), []);
});
