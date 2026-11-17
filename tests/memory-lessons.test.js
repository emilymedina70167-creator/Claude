// 教学守则（lessons）：失误归纳成守则，不再一条条往上堆（docs/teach-plan.md 第 1 节）。
// 上课时又犯一条守则记 again，新的失误才记 slip；下课时把还没归纳的失误并进守则；一科最多 LESSONS_MAX 条；
// 摘要只带守则和还没归纳的失误。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseMemoLines, planEntry, pendingRecord, applyPending, undoPending, absorbedSlips, slipsToFold, layoutOnly, similarity, LESSONS_MAX, pendingTitle } = await import('../kit/src/memory/memo.js');
const { memoryDigest } = await import('../kit/src/memory/digest.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { closingPrompt } = await import('../kit/src/class/prompt.js');

const TODAY = '2026-11-02';
const SID = 'c-20261102-1';
const base = () => ({
  slips: [
    { id: 'S-1102-1', by: 'class', date: '2026-11-02', text: '没讲划块就出了标主干的题，学生撞墙后才补规则', session: SID },
    { id: 'S-1102-2', by: 'class', date: '2026-11-02', text: '判据用了「中文像不像动作」，照着做不出来', session: SID },
    { id: 'S-0928-1', by: 'chat', date: '2026-09-28', text: '线代：一次给了三块板' },
  ],
  lessons: [
    { id: 'T-1', text: '出一组练习之前，逐题列出要用到的规则，没讲过的先讲完；讲不了的那题不出。', why: '边讲边出题', slips: ['S-0928-1'], hits: 1, since: '2026-10-01', last: '2026-10-01', status: 'active', log: [] },
  ],
  sessions: [{ id: SID, date: TODAY, block: 'EN-L1.1.1', space: 'en' }],
  curriculum: [{ id: 'EN-L1', title: '简单句', level: 'lecture' }, { id: 'EN-L1.1', title: '核心', level: 'section' }, { id: 'EN-L1.1.1', title: '五种句型', level: 'block' }],
});
const ctx = (mem = base()) => ({ mem, evidence: [], session: SID, block: 'EN-L1.1.1', date: TODAY });
const plan = (line, c = ctx()) => planEntry(parseMemoLines(line).entries[0], c);
function run(line, mem = base()) {
  const ch = plan(line, ctx(mem));
  if (ch.error) return { error: ch.error };
  const pd = pendingRecord(ch, { session: SID });
  const r = applyPending(pd, mem, { date: TODAY });
  const m = structuredClone(mem);
  for (const w of r.writes) { m[w.coll] = (m[w.coll] || []).filter((d) => String(d.id) !== w.id); m[w.coll].push({ id: w.id, ...w.doc }); }
  return { mem: m, pd: r.pd, ch };
}
const lesson = (m, id) => m.lessons.find((l) => l.id === id);

test('新守则：自动编号、带科目、hits 是归纳进来的失误条数；课堂直接写（不用我确认）', () => {
  const r = run('lesson text="判据用书上的清单和注释标的词性，不用中文意思当判据" why="中文像动作的不一定是动词" slips=S-1102-2 topic=讲解');
  assert.equal(r.ch.tier, 'direct');
  const l = lesson(r.mem, 'T-2');
  assert.equal(l.space, 'en');
  assert.deepEqual(l.slips, ['S-1102-2']);
  assert.equal(l.hits, 1);
  assert.equal(l.status, 'active');
  assert.match(pendingTitle(r.pd), /守则：判据用书上的清单/);
});

test('并进已有的一条：改写 text（记 log）、加上失误、hits 增加；又犯一次 again 只加次数和经过', () => {
  let r = run('lesson id=T-1 slips=S-1102-1 text="出一组练习之前，先把整组题读完，逐题列出要用的规则（划块、找谓语、判句型），没讲过的先讲完"');
  let l = lesson(r.mem, 'T-1');
  assert.deepEqual(l.slips, ['S-0928-1', 'S-1102-1']);
  assert.equal(l.hits, 2);
  assert.match(l.text, /先把整组题读完/);
  assert.ok(l.log.some((e) => e.field === 'text' && e.by === 'class'));
  r = run('lesson id=T-1 again="b24 代词没讲就考了划块"', r.mem);
  l = lesson(r.mem, 'T-1');
  assert.equal(l.hits, 3);
  assert.match(l.recent.at(-1), /^11-02 b24/);
  // 自检：守则都过（log 记了 text 的新值）
  const hard = checkMemory(r.mem, { today: TODAY }).problems.filter((p) => !p.soft && p.coll === 'lessons');
  assert.deepEqual(hard, []);
  // 撤销：hits、recent 退回去
  const u = undoPending(r.pd, r.mem, { date: TODAY });
  assert.equal(u.writes[0].doc.hits, 2);
});



test('摘要：守则紧跟规则、全文带；已经归纳进守则的失误不再带，只带还没归纳的', () => {
  const m = base();
  m.rules = [{ id: 'rule-1', cat: '红线', text: '没有输出就不推进', since: '2026-09-01', source: 'x' }];
  const d = memoryDigest(m, { block: 'EN-L1.1.1', session: SID, today: TODAY });
  assert.ok(d.text.includes('## 教学守则'));
  assert.ok(d.text.includes('T-1'));
  assert.ok(d.text.includes('## 还没归纳进守则的教学失误'));
  assert.ok(d.text.includes('S-1102-1'));
  assert.ok(!d.text.includes('S-0928-1'), '已经归纳进 T-1 的失误不再带');
  assert.deepEqual([...absorbedSlips(m.lessons)], ['S-0928-1']);
});

test('下课：还没归纳的失误全文交给课堂 Claude，整理单里要求并进守则', () => {
  const t = slipsToFold(base(), 'en');
  assert.match(t, /还没归纳进守则的教学失误（2 条）/);
  assert.ok(t.includes('S-1102-1') && t.includes('S-1102-2') && !t.includes('S-0928-1'));
  const p = closingPrompt({ report: '报告', slips: t });
  assert.ok(p.includes('归纳教学失误') && p.includes('S-1102-2') && p.includes('status=retired into='));
  assert.equal(slipsToFold({ slips: [], lessons: [] }, 'en'), '');
});

test('这节课改讲别的块：block id=… 查课程地图、同一科', async () => {
  const { blockSwitch } = await import('../kit/src/memory/memo.js');
  const e = (l) => parseMemoLines(l).entries[0];
  const mem = { curriculum: [{ id: 'EN-L1.1.1' }, { id: 'EN-L3.1.1' }, { id: 'L2.1.4' }] };
  assert.deepEqual(blockSwitch(e('block id=EN-L1.1.1'), { mem, block: 'EN-L3.1.1' }), { block: 'EN-L1.1.1' });
  assert.match(blockSwitch(e('block id=EN-L9.9.9'), { mem, block: 'EN-L3.1.1' }).error, /课程地图里没有/);
  assert.match(blockSwitch(e('block id=L2.1.4'), { mem, block: 'EN-L3.1.1' }).error, /不是这一科/);
  assert.match(blockSwitch(e('block'), { mem }).error, /写 block id=/);
});

// 守则只收事实和判断上的教训（prompt.js 的 LESSON_NO_FORM）：只关乎形式的失误下课时标「看过了、不归纳」，不硬并进守则
test('失误看过了、不归纳：status=seen 记一条更正，原条不动；下课不再列、摘要不带；守卫、自检都认', async () => {
  const { seenSlips, settledSlips } = await import('../kit/src/memory/memo.js');
  const { guardCandidate } = await import('../kit/src/memory/guard.js');
  const r = run('slip id=S-1102-1 status=seen why="只关乎形式：一次出了几道题"');
  assert.ok(!r.error, r.error);
  const fix = r.mem.slips.find((s) => s.id === 'S-1102-1-s');
  assert.ok(fix && fix.seen === true && fix.corrects === 'S-1102-1' && /只关乎形式/.test(fix.text));
  assert.ok(r.mem.slips.find((s) => s.id === 'S-1102-1').text.startsWith('没讲划块'), '原条不动');
  assert.deepEqual([...seenSlips(r.mem.slips)], ['S-1102-1']);
  assert.ok(settledSlips(r.mem).has('S-1102-1') && settledSlips(r.mem).has('S-0928-1'));
  const t = slipsToFold(r.mem, 'en');
  assert.match(t, /（1 条）/);
  assert.ok(t.includes('S-1102-2') && !t.includes('S-1102-1'));
  const d = memoryDigest(r.mem, { block: 'EN-L1.1.1', session: SID, today: TODAY });
  assert.ok(!d.text.includes('S-1102-1') && !d.text.includes('看过了，不归纳'), '原条和更正都不带');
  assert.deepEqual(checkMemory(r.mem, { today: TODAY }).problems.filter((p) => !p.soft && p.coll === 'slips'), []);
  // 守卫：更正照着原条写，不算重复；格式过
  const g = guardCandidate({ coll: 'slips', id: fix.id, doc: (({ id, ...x }) => x)(fix), author: 'class', session: SID }, { mem: base() });
  assert.equal(g.verdict, 'accept', JSON.stringify(g.checks));
  // 再标一次、编了一个没有的、想改原条的话：都不收
  assert.match(run('slip id=S-1102-1 status=seen why="x"', r.mem).error, /已经处理过了/);
  assert.match(run('slip id=S-0928-1 status=seen').error, /已经处理过了/);
  assert.match(run('slip id=S-9999 status=seen').error, /没有 S-9999/);
  assert.match(run('slip id=S-1102-2 text="改一改"').error, /只能写 status=seen/);
  // status=seen 只对已有的失误有意义：别的种类、没写 id 的新失误写了它都报错，不当成不用依据的整理记成新的一条（复审 M1）
  for (const l of ['error step="第 1 步" cause="换括号" status=seen', 'review title="秩一" family="x" content="y" status=seen', 'propose text="下次先讲定义再出题试试" status=seen', 'pref topic=讲法 text="先看图再推公式" status=seen', 'rule cat=讲解 text="先讲例子再讲定义" status=seen', 'note text="换括号那一步停了很久" status=seen']) {
    assert.match(run(l).error || '', /status=seen 只用在已有的教学失误上/, l);
  }
  assert.match(run('slip text="判分时没看清学生写的是哪一格" status=seen').error, /要写 id=/);
});

// 把写入、删课的计划落到一份记忆上（测试里当数据库）
const put = (mem, writes) => {
  const m = structuredClone(mem);
  for (const w of writes) { m[w.coll] = (m[w.coll] || []).filter((d) => String(d.id) !== String(w.id)); m[w.coll].push({ id: w.id, ...w.doc }); }
  return m;
};
const purge = (mem, plan) => {
  const m = structuredClone(mem);
  for (const p of plan.docs) { const [c, ...rest] = p.split('/'); m[c] = (m[c] || []).filter((d) => String(d.id) !== rest.join('/')); }
  for (const u of plan.unlink || []) { const [c, ...rest] = u.path.split('/'); m[c] = (m[c] || []).map((d) => (String(d.id) === rest.join('/') ? { id: d.id, ...u.doc } : d)); }
  return m;
};
const hardOf = (m) => checkMemory(m, { today: TODAY }).problems.filter((p) => !p.soft);

// 复审 I2 (a)：测试课「直接下课」（没有整理单，失误留着）→ 下一节真课下课时标看过了 → 之后删测试课。
// 更正的 session 抄原条的：删原条那节课时更正跟着走，不留下指着没有的编号的 corrects
test('看过了的更正跟着原条那节课：删原条那节课一起删，删标的那节课它留着；自检都没有硬错误', async () => {
  const { purgePlan } = await import('../kit/src/memory/purge.js');
  const { seenSlips } = await import('../kit/src/memory/memo.js');
  const A = 'c-20261101-9'; // 测试课，直接下课
  const m0 = base();
  m0.sessions.push({ id: A, date: '2026-11-01', block: 'EN-L1.1.1', space: 'en' });
  m0.slips.push({ id: 'S-20261101-9-1', by: 'class', date: '2026-11-01', text: '一轮里连着出了三道题，学生来不及看', session: A });
  m0.pending = [];
  assert.deepEqual(hardOf(m0), []);
  // 在下一节（SID）下课时标
  const r = run('slip id=S-20261101-9-1 status=seen why="只关乎形式：一次出几道题"', m0);
  assert.ok(!r.error, r.error);
  const fix = r.mem.slips.find((s) => s.id === 'S-20261101-9-1-s');
  assert.equal(fix.session, A, '抄原条的课号，不是标的那节课');
  assert.equal(r.pd.session, SID, '改动单还是记在标的那节课上');
  // 删测试课：原条和更正一起删
  const pa = purgePlan(r.mem, A);
  assert.ok(pa.docs.includes('slips/S-20261101-9-1') && pa.docs.includes('slips/S-20261101-9-1-s'));
  const afterA = purge(r.mem, pa);
  assert.deepEqual(hardOf(afterA), [], JSON.stringify(hardOf(afterA)));
  assert.ok(!afterA.slips.some((s) => s.corrects === 'S-20261101-9-1'));
  // 删标的那节课：更正留着，原条照旧算处理过了
  const pb = purgePlan(r.mem, SID);
  assert.ok(!pb.docs.includes('slips/S-20261101-9-1-s') && !pb.docs.includes('slips/S-20261101-9-1'));
  const afterB = purge(r.mem, pb);
  assert.deepEqual(hardOf(afterB), [], JSON.stringify(hardOf(afterB)));
  assert.ok(seenSlips(afterB.slips).has('S-20261101-9-1'));
  // 两条说法一样的看过了的更正：守卫不当重复（复审 M10：guard.js 的 !doc.corrects 真正要防的是这个）
  const { guardCandidate } = await import('../kit/src/memory/guard.js');
  const r2 = run('slip id=S-1102-1 status=seen why="只关乎形式：一次出几道题"', r.mem);
  const fix2 = r2.mem.slips.find((s) => s.id === 'S-1102-1-s');
  assert.equal(fix2.text, fix.text);
  assert.equal(guardCandidate({ coll: 'slips', id: fix2.id, doc: (({ id, ...x }) => x)(fix2), author: 'class', session: SID }, { mem: r.mem }).verdict, 'accept');
  // 原条没有课号（以前对话里记的）：更正也不写，不分科——别的科的摘要里也不再带它（复审 M5）
  const m1 = base();
  m1.slips.push({ id: 'S-0930-1', by: 'chat', date: '2026-09-30', text: '线代：板顶的话写了四句，太长' });
  m1.curriculum.push({ id: 'L2', title: '矩阵', level: 'lecture' }, { id: 'L2.1', title: '运算', level: 'section' }, { id: 'L2.1.1', title: '乘法', level: 'block' });
  const r1 = run('slip id=S-0930-1 status=seen', m1);
  assert.ok(!('session' in r1.mem.slips.find((s) => s.id === 'S-0930-1-s')));
  assert.ok(!memoryDigest(r1.mem, { block: 'L2.1.1', today: TODAY }).text.includes('S-0930-1'), '数学课的摘要里也不带');
});

// 复审 I2 (b)：下课提示写着「点开那行小字能撤销」——撤销要真起作用
test('看过了能撤销：撤了以后原条回到还没归纳的里面，能再标一次', async () => {
  const { seenSlips } = await import('../kit/src/memory/memo.js');
  const r = run('slip id=S-1102-1 status=seen why="只关乎形式"');
  const u = undoPending(r.pd, r.mem, { date: TODAY });
  const m = put(r.mem, u.writes);
  assert.ok(m.slips.some((s) => s.id === 'S-1102-1-s-x' && s.void && s.corrects === 'S-1102-1-s' && s.session === SID));
  assert.deepEqual([...seenSlips(m.slips)], []);
  const t = slipsToFold(m, 'en');
  assert.match(t, /（2 条）/);
  assert.ok(t.includes('S-1102-1') && !t.includes('S-1102-1-s'), '原条又列出来，更正本身不列');
  const d = memoryDigest(m, { block: 'EN-L1.1.1', session: SID, today: TODAY });
  assert.ok(d.text.includes('S-1102-1') && !d.text.includes('看过了，不归纳'));
  assert.deepEqual(hardOf(m).filter((p) => p.coll === 'slips'), []);
  // 再标一次：收下，编号接着往下（撤销过的那个编号还占着）
  const again = run('slip id=S-1102-1 status=seen why="还是只关乎形式"', m);
  assert.ok(!again.error, again.error);
  assert.equal(again.ch.target, 'S-1102-1-s2');
  assert.deepEqual([...seenSlips(again.mem.slips)], ['S-1102-1']);
  assert.ok(!slipsToFold(again.mem, 'en').includes('S-1102-1（'));
  assert.deepEqual(hardOf(again.mem).filter((p) => p.coll === 'slips'), []);
  // 归纳进守则也行（撤了就是一条普通的没归纳的失误）
  assert.ok(!run('lesson id=T-1 slips=S-1102-1', m).error);
});
