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

test('不累加：和已有一条几乎一样的新守则不收；满了也照收（条数只叫下课整理）；合并 retired + into', () => {
  const dup = plan('lesson text="出一组练习之前，逐题列出要用到的规则，没讲过的先讲完；讲不了的那题不出"');
  assert.match(dup.error, /和 T-1.*同一件事/);
  const many = base();
  for (let i = 2; i <= LESSONS_MAX + 1; i++) many.lessons.push({ id: `T-${i}`, text: `第 ${i} 条守则：${'甲乙丙丁戊己庚辛'.slice(i % 8)}${i}`, since: TODAY, status: i === LESSONS_MAX + 1 ? 'retired' : 'active', into: 'T-1' });
  assert.ok(!plan('lesson text="写完板先自己读一遍有没有没讲过的词"', ctx(many)).error);
  // 别的科的守则不占这一科的名额
  const other = base();
  for (let i = 2; i <= LESSONS_MAX + 1; i++) other.lessons.push({ id: `T-${i}`, text: `数学守则 ${i}`, since: TODAY, status: 'active', space: 'math' });
  assert.ok(!plan('lesson text="写完板先自己读一遍有没有没讲过的词"', ctx(other)).error);
  const r = run('lesson id=T-1 status=retired into=T-1');
  assert.match(r.error, /别的守则/);
  const m = base();
  m.lessons.push({ id: 'T-2', text: '一块板只放一个点', since: TODAY, status: 'active' });
  const r2 = run('lesson id=T-2 status=retired into=T-1', m);
  assert.equal(lesson(r2.mem, 'T-2').status, 'retired');
  assert.match(plan('lesson id=T-2 again="又犯"', ctx(r2.mem)).error, /已经并进了 T-1/);
});

test('板放不下的失误不收（页面会自动分屏）；讲法上的照收', () => {
  assert.ok(layoutOnly('b21 超出一屏（约 617）：一句目的 + 一个带长题面和长解析的 parse 就放不下'));
  assert.ok(!layoutOnly('k1 划块规则没写名词\'s 也算前置修饰，学生把 the 21st century\'s culture machine 拆成了两块；b22 又超出一屏'));
  assert.match(plan('slip text="b8 超出一屏（约 915）"').error, /不用记成失误/);
  // 和已有的守则说的是同一件事：不另记失误，改写成「又犯一次」（2026-11-03：别反复累加）
  assert.match(plan('slip text="没讲划块就出题，学生做错了才补规则"').error, /守则 T-1.*again|已经记过了/);
  assert.ok(!plan('slip text="判分时把学生写对的被动语态判成错，没看清助动词"').error);
  assert.ok(similarity('一块板只讲一个概念', '一块板只讲一个概念。') > 0.9);
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
