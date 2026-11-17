import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARTER, DIAGNOSE, CHARTER_MAX, SUBJECT_FACTS, charterFor } from '../kit/src/class/charter.js';
import { defaultRules, memoryRules, buildSystem, PROTOCOL_DOC } from '../kit/src/class/prompt.js';

const bytes = (s) => Buffer.byteLength(s);
test('根本规则连同诊断的经验不超过上限', () => assert.ok(bytes(CHARTER) + bytes(DIAGNOSE) <= CHARTER_MAX, `${bytes(CHARTER) + bytes(DIAGNOSE)}`));
// 只许降不许涨：上限本身写死在这里，改大常量这条就红
test('上限只许降不许涨', () => assert.ok(CHARTER_MAX <= 2912, `${CHARTER_MAX}`));
test('三问、保险四条都在', () => {
  for (const s of ['终点：', '差距：', '动作：', '事实照资料', '不宣布掌握', '这节课要拿下的事开课先告诉学生', '让页面算']) assert.ok(CHARTER.includes(s), s);
});
test('不写规定形式、带方向的话', () => {
  for (const s of ['一次只推进一件事', '停下来等学生', '学生没有作答，就不往下推', '话要短', '给提示，不给答案', '三轮', '必须以', '主要花在', '先让学生动手', '最多', '多做', '少停']) {
    assert.ok(!defaultRules('线代').includes(s) && !defaultRules('操作系统').includes(s) && !defaultRules('英语').includes(s), s);
  }
});
test('提到学生不用他、她', () => { for (const k of Object.keys(SUBJECT_FACTS)) assert.ok(!/[他她]/.test(charterFor(k))); });
test('每门课的事实不超过 900 字节', () => { for (const [k, v] of Object.entries(SUBJECT_FACTS)) assert.ok(bytes(v) <= 900, k); });
test('记忆库有规则时根本规则还在，学生另外定的接在后面', () => {
  const r = memoryRules('线代', '- ［检验］复现要隔天、新题');
  assert.ok(r.indexOf('每一刻只问三件事') >= 0 && r.indexOf('每一刻只问三件事') < r.indexOf('这个学生另外定的规则'));
  assert.ok(r.includes('和上面冲突时以这里为准') && r.includes('复现要隔天、新题'));
});
test('说明里别处的形式话去掉了，字写在哪的那一句还在', () => {
  assert.ok(!PROTOCOL_DOC.includes('然后就停下') && !PROTOCOL_DOC.includes('一块板只放一件要学生动脑的事'));
  const s = buildSystem({ componentDocs: '', pack: {}, board: { segs: [], pages: [], cur: 0 }, subject: '线代', canvas: true });
  assert.ok(s.includes('讲解写在黑板上') && s.includes('# 一、你的角色和根本规则') && !s.includes('给提示，不给答案'));
});

// 设计 6.1「防止再长出来」：守则只收事实和判断上的教训，不收形式
test('守则不写形式：黑板课的记忆说明、下课整理的提示里都有这一句', async () => {
  const { LESSON_NO_FORM, CLASS_MEMO_DOC, MEMO_DOC, closingPrompt } = await import('../kit/src/class/prompt.js');
  const s = buildSystem({ componentDocs: '', pack: {}, board: [], subject: '线代', memory: { mem: {}, block: 'L2.1' } });
  assert.ok(s.includes(LESSON_NO_FORM) && CLASS_MEMO_DOC.includes(LESSON_NO_FORM));
  assert.ok(!s.includes('lesson="一块板一件事"') && s.includes('判错之前先看清学生写的是什么'), '例子换成判断上的教训');
  assert.ok(closingPrompt({ report: '报告', noForm: true }).includes(LESSON_NO_FORM));
  // 舞台课、一问一答、教研室用的那几份不变
  assert.ok(!MEMO_DOC.includes(LESSON_NO_FORM) && !closingPrompt({ report: '报告' }).includes(LESSON_NO_FORM));
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../kit/src/class/classroom.js', import.meta.url), 'utf8'), /noForm: !TALK/, '黑板课下课时传 noForm');
});
test('快捷按钮只说明是学生点的，不写怎么接', () => {
  for (const s of ['退一步', '先请学生试试', '缺思路']) assert.ok(!PROTOCOL_DOC.includes(s), s);
  assert.ok(PROTOCOL_DOC.includes('这四句是学生点底下的快捷按钮发来的'));
  assert.ok(!PROTOCOL_DOC.includes('学生跟上了'));
});

// 一问一答、舞台课不再新开，说明一字不改：共用的常量（MEMO_DOC、MSG_QUICK……）谁动了这条就红。
// 指纹是 2026-11-15 根本规则这一轮之前的说明算的（改了以后核过一字不差）
test('换板只是版面的限制，不定节奏；add / new 各是干什么的；replace 能照断的那一步改讲解', () => {
  assert.ok(!PROTOCOL_DOC.includes('下一轮再换新板') && PROTOCOL_DOC.includes('不是节奏的规定') && PROTOCOL_DOC.includes('不由板来定'));
  // 第十三轮：一块板放多少、讲多细不再规定（老师看得见板，样子和详略由它定）
  assert.ok(!PROTOCOL_DOC.includes('不要为了少换板把内容压缩') && !PROTOCOL_DOC.includes('先讲透'));
  assert.ok(!PROTOCOL_DOC.includes('同一件事时才用') && PROTOCOL_DOC.includes('在当前板上接着写'));
  assert.ok(PROTOCOL_DOC.includes('照学生断的那一步改原来的讲解'));
  assert.ok(PROTOCOL_DOC.includes('只是指令格式的示范') && !PROTOCOL_DOC.includes('放好了点「确定」'));
});
test('资料包的规则接在根本规则后面', () => {
  const s = buildSystem({ componentDocs: '', pack: { main: { rules: '只讲例题' } }, board: [], subject: '线代' });
  assert.ok(s.indexOf('每一刻只问三件事') >= 0 && s.indexOf('每一刻只问三件事') < s.indexOf('这节课的资料包另外定的规则（和上面冲突时以这里为准）：\n\n只讲例题'));
  assert.ok(s.includes('不宣布掌握'));
});
test('下课整理：只关乎形式的失误有出口（标看过了），例子是判断上的', async () => {
  const { closingPrompt } = await import('../kit/src/class/prompt.js');
  const c = closingPrompt({ report: '报告', noForm: true });
  assert.ok(c.includes('status=seen') && c.includes('只关乎形式的除外') && !c.includes('出一组题之前'));
  const old = closingPrompt({ report: '报告' });
  assert.ok(!old.includes('status=seen') && old.includes('出一组题之前'), '舞台课那份不变');
});
test('黑板课的记忆说明不说按条数挡', async () => {
  const { CLASS_MEMO_DOC } = await import('../kit/src/class/prompt.js');
  assert.ok(!CLASS_MEMO_DOC.includes('观察最多 3 条') && CLASS_MEMO_DOC.includes('条数本身不挡'));
});

// 复审 I1：老师一轮写了两个 board new 时页面发的 [系统] 提醒只说页面做了什么，不说以后该怎么排
test('并板的提醒只说事实', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../kit/src/class/classroom.js', import.meta.url), 'utf8');
  const note = src.match(/newBoards === 2\) notes\.push\('([^']+)'\)/)?.[1] || '';
  assert.ok(note.includes('一轮只开一块新板') && note.includes('并到了第一块新板上'), note);
  assert.ok(!note.includes('下一轮再') && !src.includes('下一轮再换新板'), note);
});
// 复审 M3：「一轮」只在页面的限制那一条里说一次，排板那一条不带
test('排板那一条不说一轮写一块', () => {
  assert.ok(!PROTOCOL_DOC.includes('一轮写一块') && !PROTOCOL_DOC.includes('按顺序分两三块板'));
  assert.equal(PROTOCOL_DOC.split('一轮最多开一块新板').length, 2);
});
// 复审 M4：示范里讲解一段、题一段——照 replace 改讲解不会把学生在题上的作答清掉
test('示范：讲解和 predict 分两段写', async () => {
  const { parseOutput } = await import('../kit/src/class/protocol.js');
  const ops = parseOutput(PROTOCOL_DOC, { final: true }).ops.slice(-2);
  assert.deepEqual(ops.map((o) => [o.op, o.id]), [['new', 'b5'], ['add', 'b6']]);
  assert.ok(!ops[0].body.includes('```') && ops[0].body.includes('落在哪只看'), '讲解那一段里没有组件');
  assert.ok(ops[1].body.trim().startsWith('```predict') && ops[1].body.includes('id: pred-b6'));
});
// 复审 M2：关于条数的话照代码现在真做的写（memo.js 不按条数挡）；舞台课那一路不动
test('黑板课：记忆点、守则的条数不说页面会挡', async () => {
  const { CLASS_MEMO_DOC, MEMO_DOC, closingPrompt } = await import('../kit/src/class/prompt.js');
  const { planEntry, parseMemoLines, LESSONS_MAX } = await import('../kit/src/memory/memo.js');
  assert.ok(!CLASS_MEMO_DOC.includes('一节课最多 8 条') && !CLASS_MEMO_DOC.includes('每一类有上限') && CLASS_MEMO_DOC.includes('和已有的几乎一样的页面不收'));
  assert.ok(MEMO_DOC.includes('一节课最多 8 条') && MEMO_DOC.includes('每一类有上限'));
  const c = closingPrompt({ report: '报告', noForm: true });
  assert.ok(!c.includes('页面不收新的') && c.includes(`一科的守则到了 ${LESSONS_MAX} 条先合并`));
  assert.ok(closingPrompt({ report: '报告' }).includes('一科最多 20 条，到了上限页面不收新的，先合并。'));
  // 代码真是这样：这节课已经记了 8 条记忆点，第 9 条照收
  const names = ['秩的定义', '迹等于特征值之和', '行列式按行展开', '伴随矩阵的公式', '正交矩阵的逆', '相似的必要条件', '二次型的标准形', '施密特正交化第二步'];
  const mem = { curriculum: [{ id: 'L2.1.1' }], recall: names.map((q, i) => ({ id: `K${i + 1}`, q, a: `答案 ${i}`, block: 'L2.1.1', tier: 1, last: '2026-11-16', lapses: 0, status: 'active', space: 'math', session: 'c-1' })) };
  const ch = planEntry(parseMemoLines('recall q="外积 αβᵀ 的秩是多少" a="1：每一列都是 α 的倍数"').entries[0], { mem, session: 'c-1', block: 'L2.1.1', date: '2026-11-16', evidence: [] });
  assert.ok(!ch.error && ch.target === 'K9', JSON.stringify(ch));
});
