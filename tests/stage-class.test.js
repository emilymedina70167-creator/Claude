// 学习台里的舞台课（kit/src/stage/classroom.js）不碰 DOM 的部分：老师这一轮哪些行上舞台、填的答案怎么判、
// 学生做了什么写给老师的那一句、每一轮的整份说明、开课用哪种形态
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageLines, sameAnswer, actText } from '../kit/src/stage/stage.js';
import { buildStageSystem, STAGE_MEMO_DOC, STAGE_SYSTEM_MAX, SUBJECT_TYPES, STAGE_DOC, stageDoc, stageSubject } from '../kit/src/stage/doc.js';
import { memoryDigest } from '../kit/src/memory/digest.js';
import { classForm, SESSION_KINDS, isTeach } from '../kit/src/memory/session.js';
import { sampleMemory } from '../kit/src/memory/sample.js';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { eventsText } from '../kit/src/stage/events.js';

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

// 最满的一份：记忆是 sample.js 加长到摘要用满 28 KiB，资料包的教材放 40 KiB 的字（设计第 13 节「整份 150 KiB」）
const KiB = 1024;
function fullMemory() {
  const mem = sampleMemory('2026-11-05');
  const long = (n) => '这是一条很长的规则，讲怎么讲课、怎么出题、怎么记录学生的作答，'.repeat(n);
  mem.rules = [...(mem.rules || []), ...Array.from({ length: 80 }, (_, i) => ({ id: `rule-g-${i + 1}`, cat: '讲解', text: `第 ${i + 1} 条：${long(3)}`, since: '2026-10-01', source: '我', status: 'active' }))];
  mem.profile = [...(mem.profile || []), ...Array.from({ length: 30 }, (_, i) => ({ id: `p-x${i}`, topic: '讲法', text: `关于学生 ${i}：${long(2)}` }))];
  mem.lessons = [...(mem.lessons || []), ...Array.from({ length: 12 }, (_, i) => ({ id: `T-${i + 10}`, text: `守则 ${i}：${long(3)}`, since: '2026-10-01', status: 'active' }))];
  return mem;
}
const sectionOf = (t, head, next) => t.slice(t.indexOf(head), next ? t.indexOf(next) : undefined);
const fullest = (subject, block, space) => {
  const mem = fullMemory();
  const textbook = '教材原文：'.padEnd(40 * KiB / 3, '王');
  return buildStageSystem({ pack: { main: { unit: '这一块', textbook }, problems: { items: [{ q: '一道题' }] } }, memory: { mem, block, space, session: 'c-20261108-1' }, title: '这一块', subject });
};
const BLOCK_OF = { 数据结构: ['DS-L2.1.1', 'cs'], 操作系统: ['OS-L3.2.1', 'cs'], 组成原理: ['CO-L1.1.1', 'cs'], 计网: ['CN-L1.1.1', 'cs'], 线代: ['L2.2.2', 'math'], 英语: ['EN-L1.1.1', 'en'] };

test('六门课最满的一份不超：记忆 28 KiB、教材 40 KiB，整份 ≤ 150 KiB，「这节课」那一节（资料包）≥ 12 KiB', () => {
  for (const subject of Object.keys(SUBJECT_TYPES)) {
    const [block, space] = BLOCK_OF[subject];
    // 记忆真的差不多用满了（不然量的不是最满的那一份）：摘要按条装，装不下一整条就停，到不了正好 28 KiB
    const d = memoryDigest(fullMemory(), { block, space, session: 'c-20261108-1', tools: false, budget: 28 * KiB });
    assert.ok(d.bytes > 26 * KiB, `${subject}：记忆摘要只有 ${d.bytes} 字节`);
    const t = fullest(subject, block, space);
    assert.ok(t.includes(stageDoc(subject)), `${subject}：带的是这门课的那一份`);
    assert.ok(Buffer.byteLength(t) <= STAGE_SYSTEM_MAX, `${subject}：整份 ${Buffer.byteLength(t)} 字节`);
    const pack = sectionOf(t, '# 三、这节课', '# 四、');
    assert.ok(Buffer.byteLength(pack) >= 12 * KiB, `${subject}：资料包只有 ${Buffer.byteLength(pack)} 字节`);
    assert.ok(t.includes(d.text.slice(0, 2000)), `${subject}：记忆那一节带的是这一份摘要`);
  }
});

test('推不出科目时全带那份也放得下：记忆 28 KiB、教材 40 KiB，整份 ≤ 150 KiB，资料包 ≥ 12 KiB（全带的那份本身不再限 24 KiB）', () => {
  const t = fullest('', 'DS-L2.1.1', 'cs');
  assert.ok(t.includes(STAGE_DOC), '推不出科目：全带');
  assert.ok(Buffer.byteLength(t) <= STAGE_SYSTEM_MAX, `整份 ${Buffer.byteLength(t)} 字节`);
  assert.ok(Buffer.byteLength(sectionOf(t, '# 三、这节课', '# 四、')) >= 12 * KiB);
});

test('课堂推科目（说明只带这门课的那一份）：块 → 资料包写的科目或块 → 这节课记着的科目 → 空间；408 别的都没有时推不出来', () => {
  assert.equal(stageSubject({ block: 'OS-L3.2.1', space: 'cs' }), '操作系统');
  assert.equal(stageSubject({ block: 'L2.2.2' }), '线代');
  // 没有块：资料包点名的块、写的科目
  assert.equal(stageSubject({ pack: { main: { block: 'DS-L2.1.1' } }, space: 'cs' }), '数据结构');
  assert.equal(stageSubject({ pack: { main: { subject: '计算机网络' } }, space: 'cs' }), '计网');
  // 资料包也没写：这节课 / 单元记着的科目
  assert.equal(stageSubject({ pack: { main: { unit: '秩' } }, session: { subject: '线代' }, space: 'cs' }), '线代');
  assert.equal(stageSubject({ session: { subject: '组成原理' } }), '组成原理');
  // 只知道空间：数学只有线代、英语只有英语
  assert.equal(stageSubject({ space: 'math' }), '线代');
  assert.equal(stageSubject({ space: 'en' }), '英语');
  // 408 有四门课：推不出来，发全带的那份
  assert.equal(stageSubject({ space: 'cs' }), '');
  assert.equal(stageSubject({ pack: { main: { subject: '概率论' } }, session: { subject: '' }, space: 'cs' }), '', '认不出的科目不算');
  assert.equal(stageSubject(), '');
  assert.ok(buildStageSystem({ subject: stageSubject({ space: 'cs' }) }).includes(STAGE_DOC));
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
// 第二轮 Task 7 以后，做到过、现在不成立的挑战照实写「做到过；现在不成立（…）」（matrix 那一课学生改 B 做到 g2 以后 C 不再是 O）
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
    state: ["（矩阵：名字.2,3 是第 2 行第 3 列，名字.r2 是第 2 行，名字.c3 是第 3 列；交换两行时数跟着走，名字.2,3 指的总是现在的第 2 行第 3 列）","矩阵 A（2×2）：","  第 1 行：1  1","  第 2 行：-1  -1","  页面算的：rank(A) = 1，rankA(A) = 1，free(A) = 1，det(A) = 0","矩阵 B（2×2）：","  第 1 行：2  -1","  第 2 行：-1  1","  页面算的：rank(B) = 2，rankA(B) = 2，free(B) = 0，det(B) = 1","矩阵 C = A B（2×2；算出来的 4 格跟着 A、B 自动重算）：","  第 1 行：1  0","  第 2 行：-1  0","  页面算的：rank(C) = 1，rankA(C) = 1，free(C) = 1，det(C) = 0","最后说的话：A、B 都不是 O，乘出来却是 O。","学生能直接动的：C explain（点乘积的一格，看它怎么一行乘一列算出来）；B edit（点一格，拨里面的数，-3～3）","挑战 g1「点出 AB 剩下的三格」when=\"C = O\"：做到过；现在不成立（C = O ✗）","挑战 g2「改 B 里的一个数，让 AB 不再是 O」when=\"C != O\"：做到了"],
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
    // 主线第三轮（底座留下的第 8 条）：挪到句首大小写跟着变——重放不等于旧课，照新的读（以前是「is The man …」）
    state: ["（句子：名字.3 现在第 3 个词，名字.2-5 第 2 到 5 个，名字.who 这个词（出现几次写 名字.who:2），名字.who-door 从 who 到 door；括号里的 #k 是「一开始第 k 个的那个词」，写 名字#k 跟着它走）","句子 s（9 个词）：Is the man who lives next door a doctor.","  词：1 Is（#7）  2 the（#1）  3 man（#2）  4 who（#3）  5 lives（#4）  6 next（#5）  7 door（#6）  8 a  9 doctor","  括号（词下面）：s.2-7 主语（S），蓝；s.1 谓语（V），粉","  页面数不了：s 没写 key","学生能直接动的：s drag（拖）"],
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
// 照 stage.js 的 replay：行带 lenient 和 replay（刷新重放自己的标记）；ask 不重放，它拿走的 @ask.right 一并丢掉
function replayInto(log) {
  const s = new Scene();
  for (const [by, src] of log) for (const c of parseScript(src)) {
    if (c.cmd === 'ask' && !c.on) { s.skipAsk(); continue; }
    try { s.apply({ ...c, lenient: true, replay: true }, { by: by === 's' ? 'student' : null }); } catch { /* 当时就没演 */ }
  }
  s.waiting = null;
  return s;
}
const replayScene = (log) => replayInto(log).stateText();

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

test('刷新以后 @ask.right 不挂到下一问：重放跳过 ask 时一并丢掉', () => {
  const s = replayInto([['t', 'array a = 3 1 2'], ['t', '@ask.right say "对"'], ['t', 'ask tap a "最大的是哪个？" expect=a.3']]);
  assert.equal(s.askRight, null);
  s.apply(parseScript('ask tap a "最小的是哪个？" expect=a.2')[0]);
  assert.equal(s.waiting.right, undefined);
});

// —— 学生手上没事了才叫老师（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 6.2）：假的舞台（真的场景），数叫了几次老师 ——
function fakeClass(src) {
  const scene = new Scene();
  for (const c of parseScript(src)) scene.apply(c);
  const stage = {
    log: [], errors: [], scene, teacherAudit: [], reacting: Promise.resolve(), studentChain: Promise.resolve(),
    pendingGoals: () => [...scene.goals.values()].filter((g) => !g.met),
    begin() { let armedR; const armed = new Promise((r) => { armedR = r; }); return { mark: this.log.length, turn: 1, push() {}, end() { armedR(); return new Promise(() => {}); }, drop() {}, abort: async () => {}, armed }; },
    play: async () => ({}),
    holds: 0, holdAsk() { this.holds++; },
    // 收起等着的那一问（和真的舞台一样：等着的那一问没了）
    cancelled: 0, cancelWait() { this.cancelled++; scene.waiting = null; },
  };
  const rows = [];
  let calls = 0;
  const host = {
    stage, mock: true, model: 'm', teach: {}, quietMs: 1e9, messages: () => [{ content: 'x' }], putTurn() {}, cost: (c) => c, thinking() {},
    addTurn: (r) => { const x = { ...r, seq: rows.length + 1 }; rows.push(x); return x; },
    call: async () => { calls++; return { text: 'say "好"', modelApplied: 'm' }; },
  };
  return { stage, scene, rows, host, calls: () => calls };
}
const sentRows = (rows) => rows.filter((r) => r.role === 'student' && !r.pending);
const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const stuLine = (scene, line, open = 'drag') => scene.apply(parseScript(line)[0], { by: 'student', open });

test('课堂循环：做到挑战以后学生手上还有事就攒着（预写出了一问），答完才叫；没事了叫（挂着的 ask next 先收起）；call=now 马上叫', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  // 做到 g1，预写出了一问：不叫，事件 quiet、带 held，页面替它挂「给个提示」
  const a = fakeClass('array k = 2 1 3\nopen k\ngoal g1 "排好" when="k sorted"');
  const la = createLoop(a.host);
  stuLine(a.scene, 'swap k.1 k.2');
  a.scene.apply(parseScript('ask tap k "最大的是哪个？" expect=k.3')[0]); // 预写的那一问（舞台演的）
  a.stage.onGoal(['g1'], { by: 'student', reacted: 2 });
  await wait();
  assert.equal(a.calls(), 0);
  const e = la.pending.events.find((x) => x.kind === 'goal');
  assert.equal(e.quiet, true);
  assert.deepEqual(e.held, ['还有一问没答（ask tap）']);
  assert.equal(a.stage.holds, 1);
  // 答完那一问：叫一次，[学生] 里有「没叫你」那一句
  a.scene.waiting = null;
  a.stage.onAnswer({ type: 'tap', ref: 'k.3', value: '3', key: 3, slot: 3, expected: 'k.3', right: true });
  await wait();
  assert.equal(a.calls(), 1);
  assert.match(sentRows(a.rows)[0].msg, /学生做到了挑战 g1「排好」（页面已经演了你预写的 2 行）；那时 还有一问没答（ask tap），没叫你\n学生点了 k\.3/);
  la.close();
  // 没事了：挂着的 ask next 先收起，叫老师
  const b = fakeClass('array k = 2 1 3\nopen k\ngoal g1 "排好" when="k sorted"\nask next "好了点我" button="好了"');
  const lb = createLoop(b.host);
  stuLine(b.scene, 'swap k.1 k.2');
  b.stage.onGoal(['g1'], { by: 'student', reacted: 1 });
  await wait();
  assert.equal(b.calls(), 1);
  assert.equal(b.stage.cancelled, 1);
  lb.close();
  // call=now：还有别的挑战没做到，照样马上叫
  const c = fakeClass('array k = 2 1 3\nopen k\ngoal g1 "排好" when="k sorted" call=now\narray q = 1 2\nopen q\ngoal g2 "倒过来" when="q sorted desc"');
  const lc = createLoop(c.host);
  stuLine(c.scene, 'swap k.1 k.2');
  c.stage.onGoal(['g1'], { by: 'student', reacted: 0 });
  await wait();
  assert.equal(c.calls(), 1);
  lc.close();
  // 一样的情形没写 call=now：攒着
  const d = fakeClass('array k = 2 1 3\nopen k\ngoal g1 "排好" when="k sorted"\narray q = 1 2\nopen q\ngoal g2 "倒过来" when="q sorted desc"');
  const ld = createLoop(d.host);
  stuLine(d.scene, 'swap k.1 k.2');
  d.stage.onGoal(['g1'], { by: 'student', reacted: 0 });
  await wait();
  assert.equal(d.calls(), 0);
  assert.deepEqual(ld.pending.events[0].held, ['挑战 g2「倒过来」还没做到']);
  // 做完了也一样：还有挑战没做到就攒着
  d.stage.onDone(['t'], { by: 'student', reacted: 1 });
  await wait();
  assert.equal(d.calls(), 0);
  assert.match(eventsText(ld.pending.events, { goals: d.scene.goals }), /学生把 t 做完了（页面已经演了你预写的 1 行）；那时 挑战 g2「倒过来」还没做到，没叫你/);
  ld.close();
});

test('课堂循环：刷新以后照旧规矩攒的事件只叫一次；新来的照 hasWork 攒着；瞬间重放不叫', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const f = fakeClass('array k = 2 1 3\nopen k\ngoal g1 "排好" when="k sorted"\narray q = 1 2\nopen q\ngoal g2 "倒过来" when="q sorted desc"');
  const lf = createLoop(f.host);
  stuLine(f.scene, 'swap k.1 k.2');
  // 刷新以前攒的：照旧规矩的 goal 事件（不带 quiet），舞台上学生还有事（g2 没做到）
  const pendingRow = f.host.addTurn({ role: 'student', pending: true, text: '', events: [{ kind: 'goal', ids: ['g1'], reacted: 1, at: 1 }], log: [] });
  await lf.resume({ pendingRow, askLine: 'ask next' });
  await wait(30);
  assert.equal(f.calls(), 1, '只叫一次，不因为现在学生手上有事就吞掉');
  // 新来的一件、学生还有事：攒着
  f.scene.apply(parseScript('goal g3 "倒过来排" when="k sorted desc"')[0]);
  stuLine(f.scene, 'swap k.1 k.3');
  f.stage.onGoal(['g3'], { by: 'student', reacted: 0 });
  await wait(30);
  assert.equal(f.calls(), 1);
  assert.equal(lf.pending.events.at(-1).quiet, true);
  // 瞬间重放（刷新、撤一步、作废）时的「做到」：不记、不叫
  const n = lf.pending.events.length;
  f.stage.onGoal(['g2'], { by: 'student', instant: true });
  f.stage.onDone(['t'], { by: 'student', instant: true });
  await wait(30);
  assert.equal(f.calls(), 1);
  assert.equal(lf.pending.events.length, n);
  lf.close();
});

test('课堂循环：答对一问、页面演了 @ask.right 预写的行——演完挂着新的一问不叫，什么都没有了才叫', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const a = fakeClass('array a = 3 1 2\nask tap a "最小的是哪个？" expect=a.2'); // 预写里的新一问已经挂上
  const la = createLoop(a.host);
  a.stage.onAnswer({ type: 'tap', ref: 'a.1', value: '3', key: 1, slot: 1, expected: 'a.1', right: true, reacted: 1 });
  await wait();
  assert.equal(a.calls(), 0);
  assert.deepEqual(la.pending.events[0].held, ['还有一问没答（ask tap）']);
  la.close();
  const b = fakeClass('array a = 3 1 2');
  const lb = createLoop(b.host);
  b.stage.onAnswer({ type: 'tap', ref: 'a.1', value: '3', key: 1, slot: 1, expected: 'a.1', right: true, reacted: 1 });
  await wait();
  assert.equal(b.calls(), 1);
  assert.match(sentRows(b.rows)[0].msg, /学生点了 a\.1（3）——你预期的是 a\.1，点对了\n学生答对了（页面已经演了你预写的 1 行）/);
  lb.close();
  // 答错了（或者这一问没预写）照旧马上叫
  const c = fakeClass('array a = 3 1 2\nask tap a "最小的是哪个？" expect=a.2');
  const lc = createLoop(c.host);
  c.stage.onAnswer({ type: 'tap', ref: 'a.1', value: '3', key: 1, slot: 1, expected: 'a.2', right: false });
  await wait();
  assert.equal(c.calls(), 1);
  lc.close();
});

test('课堂循环：预写的行演不上（舞台记了 missed）照实数，不说「演了 N 行」', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const a = fakeClass('array a = 3 1 2');
  const la = createLoop(a.host);
  a.stage.onDone(['t'], { by: 'student', reacted: 1, reacts: [{ done: 't', src: 'ask tap t "x" expect=t.99', missed: true }] });
  await wait();
  assert.equal(a.calls(), 1);
  assert.match(sentRows(a.rows)[0].msg, /学生把 t 做完了（页面算出来没有下一步了）（你预写的行都没演上）/);
  la.close();
  const b = fakeClass('array a = 3 1 2');
  const lb = createLoop(b.host);
  b.stage.onAnswer({ type: 'tap', ref: 'a.1', value: '3', key: 1, slot: 1, expected: 'a.1', right: true, reacted: 2 }, null, { reacts: [{ ask: true, src: 'say "对"' }, { ask: true, src: 'ask tap a "x" expect=a.9', missed: true }] });
  await wait();
  assert.match(sentRows(b.rows)[0].msg, /学生答对了（页面已经演了你预写的 1 行）/);
  lb.close();
});

test('复核：open 写了 call=done 的东西做完了马上叫老师（老师明写的盖过「手上没事了才叫」）', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const a = fakeClass('tree t = 30 20 _ 10\nopen t rotate call=done\narray k = 2 1\nopen k\ngoal g2 "排" when="k sorted"');
  const la = createLoop(a.host);
  try {
    a.scene.apply(parseScript('rotate t.30 right')[0], { by: 'student', open: 'rotate' });
    a.stage.onDone(['t'], { by: 'student', reacted: 0 });
    await wait();
    assert.equal(a.calls(), 1);
  } finally { la.close(); }
});

test('复核：只因为东西没做完攒着（没有挑战）：照样很久没动、试了好几下叫老师，写那时什么没做完', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const loops = [];
  const pickRight = (st) => st.onAnswer({ type: 'pick', refs: ['t.45'], expected: 't.45', same: true, extra: [], missing: [], reacted: 1 }, null, { reacts: [{ ask: true, src: 'say "对"' }] });
  try {
    // e2e 第五轮的情形：猜对了、演了 @ask.right，树还没插完
    const a = fakeClass('tree t = 30 20 40 10 25 _ 45 tray="47"\nopen t insert');
    a.host.quietMs = 40;
    const la = createLoop(a.host);
    loops.push(la);
    pickRight(a.stage);
    await wait(20);
    assert.equal(a.calls(), 0, '先攒着');
    await wait(80);
    assert.equal(a.calls(), 1);
    assert.match(sentRows(a.rows)[0].msg, /学生 0 秒没动；那时 t 还没做完/);
    // 试了好几下
    const b = fakeClass('tree t = 30 20 40 10 25 _ 45 tray="47"\nopen t insert');
    const lb = createLoop(b.host);
    loops.push(lb);
    pickRight(b.stage);
    await wait();
    for (let i = 0; i < 8; i++) lb.onAct({ type: 'drag', open: 'insert', text: '学生拖了一下' });
    await wait();
    assert.equal(b.calls(), 1);
    assert.match(sentRows(b.rows)[0].msg, /学生试了 8 下；那时 t 还没做完/);
    // 挂着一问攒着的（学生看得见问题）：不加定时
    const c = fakeClass('tree t = 30 20 40 10 25 _ 45 tray="47"\nopen t insert\nask tap t "点 45" expect=t.45');
    c.host.quietMs = 40;
    const lc = createLoop(c.host);
    loops.push(lc);
    pickRight(c.stage);
    await wait(120);
    assert.equal(c.calls(), 0);
  } finally { for (const l of loops) l.close(); }
});

test('复核（回归）：做到挑战后预写里出了 ask next（学生要按的按钮）：攒着，按了才叫老师；早就挂着的 ask next 照旧当学生按了、叫老师', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  // 预写的行（舞台演的，带 prewrite）在 reacting 里挂出一问：和真的舞台一样，onGoal 那一刻还没演
  const preAsk = (fc, line) => { const [c] = parseScript(line); fc.stage.reacting = Promise.resolve().then(() => fc.scene.apply({ ...c, lenient: true, prewrite: true })); };
  const a = fakeClass('array k = 2 1 3\nopen k\ngoal g1 "排好" when="k sorted"');
  const la = createLoop(a.host);
  stuLine(a.scene, 'swap k.1 k.2');
  preAsk(a, 'ask next "看好了点下面" button="看到了"');
  a.stage.onGoal(['g1'], { by: 'student', reacted: 2 });
  await wait();
  // 学生只能按「看到了」：页面趁学生读的时候先把下一轮要来（抢跑，calls 里算一次），这一段不发出去
  assert.equal(sentRows(a.rows).length, 0, '学生还没按「看到了」');
  assert.equal(a.stage.cancelled, 0, '预写的那一问不收起');
  const e = la.pending.events.find((x) => x.kind === 'goal');
  assert.equal(e.quiet, true);
  assert.deepEqual(e.held, ['你预写的「看到了」还没按']);
  a.scene.waiting = null;
  a.stage.onAnswer({ type: 'next', button: '看到了' });
  await wait();
  assert.equal(sentRows(a.rows).length, 1);
  assert.match(sentRows(a.rows)[0].msg, /学生做到了挑战 g1「排好」（页面已经演了你预写的 2 行）；那时 你预写的「看到了」还没按，没叫你\n学生点了「看到了」/);
  la.close();
  // @ask.right 里的 ask next 也一样
  const b = fakeClass('array a = 3 1 2');
  const lb = createLoop(b.host);
  preAsk(b, 'ask next "接着" button="好"');
  b.stage.onAnswer({ type: 'tap', ref: 'a.1', value: '3', key: 1, slot: 1, expected: 'a.1', right: true, reacted: 2 }, null, { reacts: [{ ask: true, src: 'say "对"' }, { ask: true, src: 'ask next "接着" button="好"' }] });
  await wait();
  assert.equal(sentRows(b.rows).length, 0);
  lb.close();
  // 预写之前就挂着的 ask next（老师这一轮写的「拼好点下面」）：学生做到了就当按了它，收起、叫老师（设计 6.2）
  const c = fakeClass('array k = 2 1 3\nopen k\ngoal g1 "排好" when="k sorted"\nask next "拼好点下面" button="拼好了"');
  const lc = createLoop(c.host);
  stuLine(c.scene, 'swap k.1 k.2');
  c.stage.reacting = Promise.resolve();
  c.stage.onGoal(['g1'], { by: 'student', reacted: 1 });
  await wait();
  assert.equal(c.calls(), 1);
  assert.equal(c.stage.cancelled, 1);
  lc.close();
});

test('复核（回归）：做到挑战、收了一张的那一下不说「试了 8 下还没做到」，之前试的从头算；键盘一格一格写满一张不是「试了好多下」', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const loops = [];
  try {
    // 两个挑战：第 8 下做到 g1（g2 还没做到）——攒着，不叫「试了 8 下」
    const a = fakeClass('array k = 2 1 3\nopen k\ngoal g1 "排好" when="k sorted"\narray q = 1 2\nopen q\ngoal g2 "倒过来" when="q sorted desc"');
    const la = createLoop(a.host);
    loops.push(la);
    const drag = (extra = {}) => la.onAct({ type: 'drag', open: 'drag', src: 'swap k.1 k.2', ...extra });
    for (let i = 0; i < 7; i++) drag();
    drag({ reached: ['g1'] });
    a.stage.onGoal(['g1'], { by: 'student', reacted: 0 });
    await wait();
    assert.equal(a.calls(), 0);
    assert.ok(!la.pending.events.some((e) => e.kind === 'tries'), '做到的那一下不是「还没做到」');
    for (let i = 0; i < 7; i++) drag();
    await wait();
    assert.equal(a.calls(), 0, '做到以后从头算：又试了 7 下');
    drag();
    await wait();
    assert.equal(a.calls(), 1);
    assert.match(sentRows(a.rows)[0].msg, /学生试了 8 下还没做到/);
    // 收集型：每收一张从头算
    const b = fakeClass('matrix A = 1 1 / 0 1\nmatrix B = 0 0 / 1 0\nopen B edit range=-3..3\nmatrix D = {A B - B A}\ngoal g1 "再找一张 B" when="D = O" collect=B n=3');
    const lb = createLoop(b.host);
    loops.push(lb);
    const tick = (extra = {}) => lb.onAct({ type: 'drag', open: 'drag', src: 'x', ...extra });
    for (let i = 0; i < 7; i++) tick();
    tick({ reached: ['g1'] });
    for (let i = 0; i < 7; i++) tick();
    await wait();
    assert.equal(b.calls(), 0, '收了一张以后又试了 7 下');
    // 键盘一格一格写满一张 3×4（挑战还没做到）：在填，不叫老师
    const c = fakeClass('matrix A = 1 2 3 4 / 5 6 7 8 / 9 10 11 12\nmatrix M = _ _ _ _ / _ _ _ _ / _ _ _ _\nopen M edit input=keypad\ngoal g1 "抄一遍" when="M = A"');
    const lc = createLoop(c.host);
    loops.push(lc);
    let v = 0;
    for (let r = 1; r <= 3; r++) for (let k = 1; k <= 4; k++) { const src = `write M.${r},${k} ${++v}`; lc.onAct({ type: 'write', r, c: k, value: String(v), gesture: 'write', open: 'edit', src, line: src }); }
    await wait();
    assert.equal(c.calls(), 0, '写满 12 格不是试了 12 下');
  } finally { for (const l of loops) l.close(); }
});

test('复核（回归）：@ask.right 演完，剩下的学生做不了（只开了 rotate、托盘还有数，插不进去）：马上叫老师；做得了的攒着，45 秒没动照样叫', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const loops = [];
  const pickRight = (st) => st.onAnswer({ type: 'pick', refs: ['t.30'], expected: 't.30', same: true, extra: [], missing: [], reacted: 1 }, null, { reacts: [{ ask: true, src: 'say "对"' }] });
  try {
    const a = fakeClass('tree t = 20 10 30 tray="40"\nopen t rotate');
    const la = createLoop(a.host);
    loops.push(la);
    pickRight(a.stage);
    await wait();
    assert.equal(a.calls(), 1, '学生手上其实没事');
    // 做得了（开着 insert）：攒着；页面替它挂的「给个提示」和真的舞台一样挂到场景上，45 秒兜底照样起作用
    const b = fakeClass('tree t = 20 10 30 tray="40"\nopen t insert');
    b.stage.holdAsk = function () { this.holds++; b.scene.apply(parseScript('ask next button="给个提示"')[0]); };
    b.host.quietMs = 40;
    const lb = createLoop(b.host);
    loops.push(lb);
    pickRight(b.stage);
    await wait(20);
    assert.equal(b.calls(), 0, '先攒着');
    assert.equal(b.stage.holds, 1);
    await wait(80);
    assert.equal(b.calls(), 1);
    assert.match(sentRows(b.rows)[0].msg, /学生 0 秒没动；那时 t 还没做完/);
  } finally { for (const l of loops) l.close(); }
});

test('复核：预写出的挑战一出来就成立，写给老师的那一句照实说', () => {
  assert.equal(eventsText([{ kind: 'goal-by-teacher', ids: ['g2'], fresh: ['g2'] }], { goals: new Map([['g2', { text: '第二格是 2' }]]) }), '预写出的挑战 g2「第二格是 2」一出来就已经成立了（不是学生做到的）');
  assert.equal(eventsText([{ kind: 'goal-by-teacher', ids: ['g2'], pre: true }], { goals: new Map([['g2', { text: '第二格是 2' }]]) }), '你预写的行让挑战 g2「第二格是 2」成立了（不是学生做到的）');
});

test('复核（第三次量）：拨数从 0 拨到 8（连着按 8 下 ›）是一下「试」，不叫老师「试了 8 下还没做到」；拨几个不同的数照样数', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const loops = [];
  try {
    const a = fakeClass('dial k = 0 range=0-9\nmatrix A = {k} 0 / 0 1\ngoal g1 "让 A 是单位阵" when="A = I"');
    const la = createLoop(a.host);
    loops.push(la);
    for (let v = 1; v <= 8; v++) la.onAct({ type: 'dial', name: 'k', value: v, from: v - 1 });
    await wait();
    assert.equal(a.calls(), 0, '拨 0 → 8 是一条路');
    assert.ok(!la.pending.events.some((e) => e.kind === 'tries'));
    // 拨一个数、拖一下、再拨：一下一下数，第 8 下叫老师
    const b = fakeClass('dial k = 0 range=0-9\nmatrix A = {k} 0 / 0 1\narray q = 2 1\nopen q\ngoal g1 "左上是 9" when="A.1,1 = 9"');
    const lb = createLoop(b.host);
    loops.push(lb);
    for (let i = 0; i < 4; i++) {
      lb.onAct({ type: 'dial', name: 'k', value: i + 1, from: i });
      lb.onAct({ type: 'drag', open: 'drag', src: 'swap q.1 q.2' });
    }
    await wait();
    assert.equal(b.calls(), 1);
    assert.match(sentRows(b.rows)[0].msg, /学生试了 8 下还没做到/);
  } finally { for (const l of loops) l.close(); }
});

test('复核（第三次量）：键盘填空格子写满了算做完了——挂着的「写好了点下面」当按了、叫老师；还挂着一问就攒着；写到一半不叫', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const loops = [];
  // 真的舞台那样：学生写一格（场景照做），场景报做完了才交 onDone
  const write = (fc, lp, ref, v) => {
    const src = `write ${ref} ${v}`;
    const fx = fc.scene.apply(parseScript(src)[0], { by: 'student', open: 'edit' });
    lp.onAct({ type: 'write', value: String(v), gesture: 'write', open: 'edit', src, line: src, ...(fx.done ? { reached: fx.done } : {}) });
    if (fx.done) fc.stage.onDone(fx.done, { by: 'student', reacted: 0, filled: fx.filled || [] });
  };
  try {
    const a = fakeClass('matrix M1 = _ _ / _ _\nopen M1 edit input=keypad\nask next "写好了点下面" button="写好了"');
    const la = createLoop(a.host);
    loops.push(la);
    write(a, la, 'M1.1,1', 1); write(a, la, 'M1.1,2', 2); write(a, la, 'M1.2,1', 0);
    await wait();
    assert.equal(a.calls(), 0, '写到一半');
    write(a, la, 'M1.2,2', 3);
    await wait();
    assert.equal(a.calls(), 1, '最后一格填上：当按了「写好了」，叫老师（不等 45 秒）');
    assert.equal(a.stage.cancelled, 1);
    assert.match(sentRows(a.rows)[0].msg, /学生把 M1 的空格子都写满了（页面不判写得对不对）/);
    // 还挂着一问（这一步做了什么）：攒着，答了才叫
    const b = fakeClass('matrix M1 = _ _ / _ _\nopen M1 edit input=keypad\nask value "这一步做了什么？"');
    const lb = createLoop(b.host);
    loops.push(lb);
    for (const [r, v] of [['1,1', 1], ['1,2', 2], ['2,1', 0], ['2,2', 3]]) write(b, lb, `M1.${r}`, v);
    await wait();
    assert.equal(b.calls(), 0);
    assert.deepEqual(lb.pending.events.find((e) => e.kind === 'done').held, ['还有一问没答（ask value）']);
  } finally { for (const l of loops) l.close(); }
});

test('最后一审 M3：有空格子的矩阵开着 rowop（call=done）又开着键盘——写满了还没消完不算「做完」，不马上叫；学生手上还有事攒着；消完才叫', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const a = fakeClass('matrix M1 = 1 2 3 / _ _ _ / _ _ _\nopen M1 rowop call=done\nopen M1 edit input=keypad');
  const la = createLoop(a.host);
  // 真的舞台那样：学生这一下场景照做，场景报做完了才交 onDone（带 filled、ruled）
  const act = (src, open) => {
    const fx = a.scene.apply(parseScript(src)[0], { by: 'student', open });
    la.onAct({ type: open === 'edit' ? 'write' : 'rowop', open, src, line: src, ...(fx.done ? { reached: fx.done } : {}) });
    if (fx.done) a.stage.onDone(fx.done, { by: 'student', reacted: 0, filled: fx.filled || [], ruled: fx.ruled || [] });
    return fx;
  };
  try {
    for (const [k, v] of [['2,1', 2], ['2,2', 4], ['2,3', 7], ['3,1', 0], ['3,2', 0], ['3,3', 0]]) act(`write M1.${k} ${v}`, 'edit');
    await wait();
    assert.equal(a.calls(), 0, '写满了、还要消：call=done 不算做完');
    assert.deepEqual(la.pending.events.find((e) => e.kind === 'done').held, ['M1 还没做完']);
    act('rowop M1 r2 - 2r1', 'rowop');
    await wait();
    assert.equal(a.calls(), 1, '消完了：call=done 马上叫');
    assert.match(sentRows(a.rows)[0].msg, /学生把 M1 的空格子都写满了（页面不判写得对不对）/);
    assert.match(sentRows(a.rows)[0].msg, /学生把 M1 做完了/);
  } finally { la.close(); }
});

// —— 舞台主线第一轮 E1-6：老师挂的「拨好了」还没按，学生做到挑战页面就叫了老师——照设计（做到了马上接），但要告诉老师 ——
test('E1-6：做到挑战时老师挂的按钮还没按：照旧马上叫老师，那一条里写明「还没按」和怎么写才等学生按（on=）', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const run = (s, src) => { for (const c of parseScript(src)) s.apply(c); return s; };
  const scene = run(new Scene(), 'array a = 2 1\nopen a\ngoal g1 "排好" when="a sorted"\nask next "排好了点下面" button="排好了"');
  scene.apply(parseScript('swap a.1 a.2')[0], { by: 'student', open: 'drag' });
  assert.equal(scene.goals.get('g1').met, true);
  const stage = { log: [], scene, teacherAudit: [], reacting: null, studentChain: null, pendingGoals: () => [] };
  const rows = [];
  createLoop({ stage, addTurn: (r) => { const x = { ...r, seq: rows.length + 1 }; rows.push(x); return x; }, putTurn: () => {}, note: () => {} });
  stage.onGoal(['g1'], { by: 'student', reacted: 0 });
  await tick(); await tick();
  const m = rows.find((r) => r.role === 'student' && !r.pending)?.msg || '';
  assert.match(m, /学生做到了挑战 g1「排好」/);
  assert.match(m, /你挂的「排好了」学生还没按：做到了页面就叫你了。要等学生自己按了再叫，挑战写 on="排好了"/);
  // 页面替挂的「给个提示」不说这一句
  assert.doesNotMatch(eventsText([{ kind: 'goal', ids: ['g1'], reacted: 0 }], { goals: scene.goals }), /还没按/);
});

test('D1-2：课堂循环里同一下做到两条挑战，发给老师的那一条各写各的预写行数', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const scene = new Scene();
  for (const c of parseScript('array a = 2 1\nopen a\ngoal g5 "第 5 条" when="a sorted"\ngoal g6 "第 6 条" when="a.1 = 1"')) scene.apply(c);
  scene.apply(parseScript('swap a.1 a.2')[0], { by: 'student', open: 'drag' });
  assert.ok(scene.goals.get('g5').met && scene.goals.get('g6').met);
  const stage = { log: [], scene, teacherAudit: [], reacting: null, studentChain: null, pendingGoals: () => [] };
  const rows = [];
  createLoop({ stage, addTurn: (r) => { const x = { ...r, seq: rows.length + 1 }; rows.push(x); return x; }, putTurn: () => {}, note: () => {} });
  stage.onGoal(['g5', 'g6'], { by: 'student', reacted: 3, reacts: [{ goal: 'g5', src: 'say "一"' }, { goal: 'g6', src: 'say "二"' }, { goal: 'g6', src: 'glow a' }] });
  await tick(); await tick();
  const m = rows.find((r) => r.role === 'student' && !r.pending)?.msg || '';
  assert.match(m, /g5「第 5 条」（页面已经演了你预写的 1 行）/);
  assert.match(m, /g6「第 6 条」（页面已经演了你预写的 2 行）/);
});

test('提前想好下一轮：学生只能点按钮时才想；手上有东西可动（画面上有拨盘、老师开着的手）就不想——真课上 6 次只接上 1 次', async () => {
  const { createLoop } = await import('../kit/src/stage/loop.js');
  // 只有一个按钮：提前想
  const a = fakeClass('array k = 1 2 3\nsay "看这一排。"\nask next "看清了点下面" button="看清了"');
  const la = createLoop(a.host);
  await la.resume({ lastClaude: 1 });
  await wait();
  assert.equal(a.calls(), 1);
  la.close();
  // 画面上有拨盘：学生多半先拨几下，不想
  const b = fakeClass('dial t = 现在 options="过去 现在 将来"\nsentence v = "He {t: was | is | will be} here."\nask next "拨一拨，看清了点下面" button="看清了"');
  const lb = createLoop(b.host);
  await lb.resume({ lastClaude: 1 });
  await wait();
  assert.equal(b.calls(), 0);
  lb.close();
  // 老师开着的手：不想
  const c = fakeClass('array k = 2 1 3\nopen k\nask next "换一换，看清了点下面" button="看清了"');
  const lc = createLoop(c.host);
  await lc.resume({ lastClaude: 1 });
  await wait();
  assert.equal(c.calls(), 0);
  lc.close();
});
