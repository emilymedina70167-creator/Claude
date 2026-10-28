// 学习台第 3、4 批（docs/desk-plan.md 第 5、6 节）：给我看的页面算的部分（views.js）、复现课的资料包、启动语、
// 课堂说明里按需带的组件手册、发布用的瘦身说明书。页面本身在真浏览器里另外验（desk-demo.html?dev 的 #map、#weak……）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  curriculumTree, blockDetail, blockTimeline, weaknessRows, errorRows, classRows, learningStats, reviewPack, handoffText, evidenceLine,
} = await import('../kit/src/memory/views.js');
const { sampleMemory } = await import('../kit/src/memory/sample.js');
const { addDays } = await import('../kit/src/memory/schema.js');
const { systemDocs, buildSystem, CORE_COMPONENTS } = await import('../kit/src/class/prompt.js');
const { componentDocs } = await import('../kit/build-docs.js');
const { splitProject } = await import('../kit/build-split.js');
const { docSections, sectionNames } = await import('../kit/src/subject.js');

const TODAY = '2026-10-28';
const M = () => {
  const m = sampleMemory(TODAY);
  m.evidence = [
    { id: 'ev-1', src: 'record', kind: 'answer', comp: 'q-b2', q: '求 A²', value: '3A', ok: true, block: 'L2.2.2', tags: ['L2.2.2', 'L2.2.2#tr'], session: 'c-1', at: Date.parse('2026-10-27T10:00:00Z') },
    { id: 'ev-2', src: 'say', kind: 'say', text: '没懂', block: 'L2.2.2', tags: ['L2.2.2'], session: 'c-1', at: Date.parse('2026-10-27T10:05:00Z') },
    { id: 'ev-3', src: 'event', kind: 'drag', block: 'L2.2.2', tags: ['L2.2.2'], at: 3 },
    { id: 'ev-4', src: 'record', kind: 'quiz', ok: false, block: 'L2.2.1', tags: ['L2.2.1'], at: 4 },
  ];
  m.sessions = [
    { id: 'c-20261026-1', date: '2026-10-26', block: 'L2.2.1', title: '秩一', status: 'closed', startedAt: 1, summary: 'ob-s1', report: { activeMs: 30 * 60000, items: 4, first: 1, line: '4 题，一次对 1' }, usage: { calls: 6, bytes: 400000 } },
    { id: 'c-20261027-1', date: '2026-10-27', block: 'L2.2.2', title: 'Aⁿ', status: 'closed', startedAt: 2, report: { activeMs: 45 * 60000, items: 5, first: 4 } },
    { id: 'c-20261028-1', date: '2026-10-28', block: 'L2.2.2', title: '接着', status: 'open', startedAt: 3 },
  ];
  m.observations = [{ id: 'ob-s1', kind: 'summary', text: '1. **这节课讲了什么**：秩一方阵。\n2. 卡住……', session: 'c-20261026-1', at: 1 }];
  return m;
};

test('课程地图：讲 → 节 → 块，块按掌握上色、知识点挂在块上，上一级按块汇总', () => {
  const m = M();
  m.mastery.push({ id: 'L2.2.2#tr', state: '基础题过', basis: ['ev-1'] });
  const [l2] = curriculumTree(m);
  assert.equal(l2.id, 'L2');
  const sec = l2.children[0];
  assert.equal(sec.id, 'L2.2');
  assert.deepEqual(sec.children.map((b) => [b.id, b.state]), [['L2.2.1', '基础题过'], ['L2.2.2', '讲过']]);
  assert.deepEqual(sec.children[1].points.map((p) => [p.id, p.state]), [['L2.2.2#tr', '基础题过']]);
  assert.deepEqual(l2.count, { 基础题过: 1, 讲过: 1 });
  const d = blockDetail(m, 'L2.2.2');
  assert.deepEqual(d.errors.map((e) => e.id), ['L2-07']);
  assert.deepEqual(d.weaknesses.map((w) => w.id), ['W19']);
  assert.deepEqual(d.reviews.map((r) => r.id).sort(), ['R3', 'R5']);
});

test('时间线：这一块（和它的知识点）的作答，最近的在前；拖图不算', () => {
  const tl = blockTimeline(M().evidence, 'L2.2.2');
  assert.deepEqual(tl.map((x) => x.id), ['ev-2', 'ev-1']);
  assert.equal(tl[1].line, 'answer「求 A²」：3A（对）');
  assert.equal(evidenceLine({ src: 'manual', text: '纸上做了', verdict: '错' }), '补记：纸上做了（错）');
});

test('弱点表：通用 → 链条 → 局部、证据级高的在前，关了的最后；错题本按块 / 弱点 / 解决没有筛', () => {
  const m = M();
  m.weaknesses.push({ id: 'W20', title: '通用的', scope: '通用', level: 'L1', errors: ['L2-07'], status: 'active' });
  m.weaknesses.push({ id: 'W21', title: '链条 L3', scope: '链条', level: 'L3', basis: ['x'], status: 'active' });
  m.weaknesses.push({ id: 'W22', title: '关了', scope: '通用', level: 'L3', basis: ['x'], status: 'closed' });
  assert.deepEqual(weaknessRows(m).map((w) => w.id), ['W20', 'W21', 'W19', 'W22']);
  assert.equal(weaknessRows(m).find((w) => w.id === 'W19').levelLog.length, 1);
  m.errors.push({ id: 'L2-08', source: 's', q: 'q', mine: 'm', step: 's', cause: 'c', date: '2026-10-27', block: 'L2.2.1' });
  m.errors.push({ id: 'L2-09', source: 's', q: 'q', mine: 'm', step: 's', cause: 'c', date: '2026-10-28', corrects: 'L2-07', resolved: true, block: 'L2.2.2' });
  assert.deepEqual(errorRows(m, { state: 'open' }).map((e) => e.id), ['L2-08']);
  assert.deepEqual(errorRows(m, { state: 'resolved' }).map((e) => e.id), ['L2-07']);
  assert.equal(errorRows(m, { state: 'resolved' })[0].fixes[0].id, 'L2-09');
  assert.deepEqual(errorRows(m, { block: 'L2.2.1' }).map((e) => e.id), ['L2-08']);
  assert.deepEqual(errorRows(m, { weakness: 'W19' }).map((e) => e.id), ['L2-07']);
});

test('以前的课：最近的在前，带时长、小结第一句、花费；统计按天、按块、按课', () => {
  const rows = classRows(M());
  assert.deepEqual(rows.map((r) => r.id), ['c-20261028-1', 'c-20261027-1', 'c-20261026-1']);
  assert.equal(rows[2].minutes, 30);
  assert.equal(rows[2].summary, '这节课讲了什么：秩一方阵。');
  const st = learningStats(M(), { today: TODAY, days: 3 });
  assert.deepEqual(st.daily.map((d) => [d.date, d.minutes]), [['2026-10-26', 30], ['2026-10-27', 45], ['2026-10-28', 0]]);
  assert.equal(st.total, 75);
  assert.equal(st.studyDays, 2);
  assert.deepEqual(st.blocks.map((b) => [b.block, b.minutes]), [['L2.2.2', 45], ['L2.2.1', 30]]);
  assert.deepEqual(st.trend.map((x) => x.rate), [25, 80]);
});

test('复现课：页面自己拼资料包（这一组、盯的弱点、错题原文、以前同一块的题），课堂按复现课上', () => {
  const m = M();
  m.reviews[0].blocks = ['L2.2.2'];
  const { main, problems } = reviewPack(m, 'R3', { today: TODAY, packs: [{ block: 'L2.2.2', session: 'c-1', items: [{ q: '求 A^5', answer: '81A' }, { q: '求 A^5', answer: 'dup' }] }, { block: 'L9', items: [{ q: '别的' }] }] });
  assert.equal(main.review, 'R3');
  assert.equal(main.block, 'L2.2.2');
  assert.match(main.unit, /^复现 R3/);
  assert.match(main.student, /W19 内积和外积分不清/);
  assert.match(main.student, /L2-07：题「求 A²，A = αβᵀ」/);
  assert.match(main.plan, /review id=R3 result=过/);
  assert.deepEqual(problems.items.map((x) => x.q), ['求 A^5']);
  assert.throws(() => reviewPack(m, 'R99'), /没有 R99/);
});

test('启动语：说明书地址、学到哪、上一节、到期的复现组、等外部做的事', () => {
  const m = M();
  m.pending = [{ id: 'pd-1', kind: 'error', label: '错题', target: 'L2-08', status: 'open', data: { cause: '换括号' } }];
  const t = handoffText(m, { kitUrl: 'https://claude.ai/artifact/KIT', today: TODAY });
  assert.match(t, /path: "CLAUDE-PROJECT.md"/);
  assert.match(t, /学到 L2\.2\.2；下一节：先收 L2-07/);
  assert.match(t, /上一节：c-20261027-1/);
  assert.match(t, /有一节还没下课：c-20261028-1/);
  assert.match(t, /备下一节数学课：往学习台写资料包 pack\/main/);
  assert.match(t, /这一科：数学/);
  assert.match(handoffText(m, { today: TODAY, space: "en" }), /pack\/main-en/);
  assert.match(t, /1 张改动单等我确认/);
  assert.match(t, /到期的复现组：R3/);
  assert.match(t, /地址问我要/);
});

const DOCS = componentDocs(readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8'));

test('组件手册按需带：资料包点了名时，只带常用的和点名的，别的只留标题；没有工具时照旧全带', () => {
  const all = systemDocs(DOCS, '线代', []).docs;
  const some = systemDocs(DOCS, '线代', ['elim']).docs;
  assert.ok(Buffer.byteLength(some) < Buffer.byteLength(all) - 8 * 1024);
  assert.match(some, /### elim：/);
  assert.match(some, /### det：行列式的计算\n\n（这节课没点名，只留了标题。要用时 component_doc 取 det/);
  for (const c of ['answer', 'steps', 'quiz']) assert.ok(CORE_COMPONENTS.includes(c));
  assert.match(some, /### steps：一步步揭开的例题/);
  assert.ok(!/这节课没点名/.test(systemDocs(DOCS, '线代', ['elim'], { lookup: false }).docs));
  // 整份说明照样在上限以内
  const s = buildSystem({ componentDocs: DOCS, pack: { main: { components: ['elim'] } }, board: [] });
  assert.match(s, /没点名的不常用组件只留了标题/);
});

test('说明书瘦身：主说明不到一半大小，别的几节原样，第三节变成一览；每个组件一份写法，一览里的文件都有', () => {
  const src = readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
  const { main, files, index } = splitProject(src, { kitUrl: 'https://claude.ai/artifact/KIT' });
  assert.ok(Buffer.byteLength(main) < Buffer.byteLength(src) * 0.5);
  assert.match(main, /版本：\d{4}-\d{2}-\d{2}/);
  for (const h of ['## 一、发布课件', '## 二、怎么设计一个单元', '## 六、课堂模式', '## 七、学习台']) assert.ok(main.includes(h), h);
  assert.equal(main.slice(main.indexOf('## 七、学习台')), src.slice(src.indexOf('## 七、学习台')));
  assert.match(main, /### 组件一览/);
  assert.match(main, /### let：/); // 每节课都用的留在主说明里
  for (const x of index) assert.ok(files[x.file], x.file);
  // 课堂里认得的组件名，一览里都有
  const listed = new Set(index.flatMap((x) => x.names));
  for (const sec of docSections(DOCS)) {
    const n = sectionNames(sec.head.split(/[：:]/)[0])[0];
    if (sec.names.length && n) assert.ok(listed.has(n), n);
  }
  assert.match(files['components/answer.md'], /### answer：自己算/);
  assert.ok(!/<!-- 科目/.test(files['components/sched.md']));
  assert.match(files['components/elim.md'], /```elim/);
});
