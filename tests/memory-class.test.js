// 在学习台里上课（docs/learner-memory-spec.md 第 2 批）：记忆摘要、证据、每节课的数据分开、课堂 Claude 能写什么、memory_read。
// 课堂里实际走一遍（开新课、讲课、作答、刷新、下课）在真浏览器里另外验（Playwright，desk-demo.html?dev + 「测试:记忆」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 本地替身数据库要 localStorage / window；组件模块加载时挂页面事件
const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k) };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };

const { memoryDigest, nearBlocks, utf8 } = await import('../kit/src/memory/digest.js');
const {
  sessionId, isSessionId, scopeDb, toEvidence, fromEvidence, evidenceTags, sayEvidence, observationRecord, slipRecord, memoryRead, SESSION_SCOPED, MEMORY_READ_MAX,
} = await import('../kit/src/memory/session.js');
const { sampleMemory } = await import('../kit/src/memory/sample.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { fakeDb } = await import('../kit/src/live/store.js');
const { createSink, toAnswer } = await import('../kit/src/live/sync.js');
const { buildSystem, SYSTEM_MAX, MEMORY_BUDGET, DESK_DOC, memoryRules, DEFAULT_RULES } = await import('../kit/src/class/prompt.js');
const { parseCommand, parseOutput } = await import('../kit/src/class/protocol.js');
const { componentDocs } = await import('../kit/build-docs.js');
const { readFileSync } = await import('node:fs');
// 组件手册：构建时从 CLAUDE-PROJECT.md 第三节截出来（docs.js 是构建时的虚拟模块，测试里直接截）
const COMPONENT_DOCS = componentDocs(readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8'));

const TODAY = '2026-10-27';
const M = () => sampleMemory(TODAY);

// —— 记忆摘要 ——

test('记忆摘要：按优先级带规则、学生、这一块、相关的弱点和错题原文、掌握、失误、上一节停在哪', () => {
  const d = memoryDigest(M(), { block: 'L2.2.2', session: 'c-20261027-1' });
  assert.match(d.rules, /［红线］课堂不能宣布我「掌握了」/);
  assert.match(d.rules, /［教法］交互优先/);
  const t = d.text;
  for (const s of ['c-20261027-1', '## 学生（profile）', '考研数学一', '### 这节课的块：L2.2.2', '- 范围：用结合律推出 Aⁿ', '准入依赖：L2.2.1',
    '### 相邻的块（只给范围）', 'L2.2.1 行成比例 → 秩一', 'W19 内积和外积分不清（链条，证据级 L1', 'L2-07（第2讲例2.1）', '题面：求 A²，A = αβᵀ', '根因：没看出 βᵀα 是一个数',
    'L2.2.2：讲过', 'L2.2.1：基础题过', '## 别再犯', '一次写了五块板', '## 上一节停在哪', '这一节从哪接：先收 L2-07 的同类题']) {
    assert.ok(t.includes(s), `摘要里有「${s}」`);
  }
  // 顺序：学生 → 课程地图 → 弱点 → 错题 → 掌握 → 失误 → 位置
  const at = (s) => t.indexOf(s);
  assert.ok(at('## 学生') < at('## 课程地图') && at('## 课程地图') < at('## 相关的弱点') && at('## 相关的弱点') < at('## 相关的错题')
    && at('## 相关的错题') < at('## 掌握状态') && at('## 掌握状态') < at('## 别再犯') && at('## 别再犯') < at('## 上一节停在哪'));
  assert.deepEqual(d.cut, []);
  // 作废的规则不带
  const m = M();
  m.rules[1].status = 'void';
  assert.ok(!memoryDigest(m, { block: 'L2.2.2' }).rules.includes('交互优先'));
});

test('记忆摘要：没写块就用 position 的；只挑挨着这一块的错题和弱点（通用的弱点都带）', () => {
  const m = M();
  m.curriculum.push({ id: 'L5', level: 'lecture', title: '第5讲' }, { id: 'L5.1', level: 'section', title: '§1', parent: 'L5' }, { id: 'L5.1.1', level: 'block', title: '远处的块', parent: 'L5.1' });
  m.errors.push({ id: 'L5-01', source: 's', q: '远处的错题', mine: 'm', step: 's', cause: 'c', date: TODAY, block: 'L5.1.1', weakness: 'W30' });
  m.weaknesses.push({ id: 'W30', title: '远处的弱点', scope: '局部', level: 'L0', errors: ['L5-01'], blocks: ['L5.1.1'] });
  m.weaknesses.push({ id: 'W31', title: '审题不全', scope: '通用', level: 'L2', basis: ['x'] });
  const t = memoryDigest(m, {}).text; // position.block 是 L2.2.2
  assert.match(t, /这节课的块：L2.2.2/);
  assert.ok(!t.includes('远处的错题') && !t.includes('远处的弱点'));
  assert.match(t, /W31 审题不全（通用/);
  assert.match(memoryDigest(m, { block: 'L5.1.1' }).text, /远处的错题/);
  assert.match(memoryDigest(m, { block: 'L9.9.9' }).text, /课程地图里还没有块 L9.9.9/);
  assert.match(memoryDigest({}, {}).text, /这节课没有指定块/);
});

test('nearBlocks：依赖的块、依赖它的块、同一节里前后紧挨着的块', () => {
  const cur = [
    { id: 'L1.1.1', level: 'block' }, { id: 'L2.1', level: 'section' },
    { id: 'L2.1.1', level: 'block', parent: 'L2.1' }, { id: 'L2.1.2', level: 'block', parent: 'L2.1', requires: ['L1.1.1'] },
    { id: 'L2.1.3', level: 'block', parent: 'L2.1' }, { id: 'L2.1.4', level: 'block', parent: 'L2.1' }, { id: 'L3.1.1', level: 'block', requires: ['L2.1.2'] },
  ];
  assert.deepEqual(nearBlocks(cur, 'L2.1.2').near.map((d) => d.id).sort(), ['L1.1.1', 'L2.1.1', 'L2.1.3', 'L3.1.1']);
  assert.deepEqual(nearBlocks(cur, 'L9').near, []);
});

test('记忆摘要的预算：放不下从后往前截，写明还有几条、用 memory_read 查；规则最先放', () => {
  const m = M();
  for (let i = 0; i < 60; i++) m.slips.push({ id: `S-x-${i}`, by: 'class', date: `2026-10-${String(1 + (i % 26)).padStart(2, '0')}`, text: '很长的失误'.repeat(30) });
  for (let i = 0; i < 40; i++) m.errors.push({ id: `L2-${50 + i}`, source: 's', q: '同类题'.repeat(60), mine: 'm', step: 's', cause: 'c', date: TODAY, block: 'L2.2.2', weakness: 'W19' });
  const d = memoryDigest(m, { block: 'L2.2.2', budget: 8 * 1024 });
  assert.ok(d.bytes <= 8 * 1024 + 200, `${d.bytes}`);
  assert.match(d.rules, /红线/);
  assert.ok(d.cut.some((c) => c.coll === 'errors'));
  assert.match(d.text, /（放不下，没带：errors \d+ 条.*要用就用 memory_read 查。）/);
  // 默认预算下全部放得下的就不截
  assert.deepEqual(memoryDigest(M(), { block: 'L2.2.2' }).cut, []);
  assert.ok(utf8('中') === 3);
});

// —— 课堂说明里带上记忆 ——

test('buildSystem：学习台里多一节「你对学生的了解」，记忆库的规则替换内置红线，资料包让一点；整份不超过 SYSTEM_MAX', () => {
  const pack = { main: { unit: '秩一', plan: '计划'.repeat(40000) } };
  for (const subject of ['线代', '数据结构', '操作系统', '组成原理', '计算机网络']) {
    const s = buildSystem({ componentDocs: COMPONENT_DOCS, pack, board: [], subject, memory: { mem: M(), block: 'L2.2.2', session: 'c-20261027-1' } });
    assert.ok(utf8(s) <= SYSTEM_MAX, `${subject}：${utf8(s)}`);
    assert.match(s, /# 三、你对学生的了解（学习台的记忆库）/);
    assert.match(s, /# 四、这节课的资料包/);
    assert.match(s, /# 五、黑板现状/);
    assert.match(s, /学生定下的规则（学习台记忆库的 rules，替换组件库内置的红线）/);
    assert.ok(!s.includes('1. 一次只推进一件事'), '内置红线被替换了');
    assert.match(s, /不用「他」「她」/, '角色那一段照旧');
    assert.match(s, /board memo/);
    assert.match(s, /W19/);
  }
  // 不在学习台里：和以前一样
  const plain = buildSystem({ componentDocs: COMPONENT_DOCS, pack: { main: { unit: 'x' } }, board: [] });
  assert.match(plain, /# 三、这节课的资料包/);
  assert.match(plain, /1\. 一次只推进一件事/);
  assert.ok(!plain.includes('你对学生的了解'));
  // 记忆库里还没有规则：用内置的红线
  const m = M();
  m.rules = [];
  assert.match(buildSystem({ componentDocs: COMPONENT_DOCS, pack: null, board: [], memory: { mem: m, block: 'L2.2.2' } }), /1\. 一次只推进一件事/);
  // 不支持工具：说明换成不提工具的那份
  assert.ok(!buildSystem({ componentDocs: COMPONENT_DOCS, pack: null, board: [], tools: false, memory: { mem: M(), block: 'L2.2.2' } }).includes('memory_read 工具查（'));
  assert.ok(MEMORY_BUDGET <= 40 * 1024);
});

test('学习台里的说明、规则那一段、记忆摘要的开头：提到学生不用「他」「她」', () => {
  const he = /(?<!其)[他她]/;
  for (const [name, s] of [['DESK_DOC', DESK_DOC], ['memoryRules', memoryRules('线代', '- 规则')], ['摘要', memoryDigest({}, {}).text]]) {
    const bad = s.split('\n').filter((l) => he.test(l.replace(/不用「他」「她」/g, '')));
    assert.deepEqual(bad, [], name);
  }
  assert.match(memoryRules('线代', '- x'), /不用「他」「她」/);
  assert.ok(DEFAULT_RULES.length > 0);
});

// —— 每节课 ——

test('sessionId：c-日期-第几节，同一天往下编', () => {
  assert.equal(sessionId(TODAY), 'c-20261027-1');
  assert.equal(sessionId(TODAY, ['c-20261027-1', 'c-20261027-2', 'c-20261026-3']), 'c-20261027-3');
  assert.ok(isSessionId('c-20261027-12'));
  assert.ok(!isSessionId('c-1027') && !isSessionId('') && !isSessionId('#c-20261027-1'));
});

test('scopeDb：课堂自己的集合放进 sessions/{编号}/ 下面并带上 session；记忆库、证据原样', async () => {
  const db = fakeDb('t-scope');
  db._clear();
  const s1 = scopeDb(db, 'c-20261027-1');
  const s2 = scopeDb(db, 'c-20261027-2');
  await s1.collection('steps').doc('b1').set({ md: '第一节' });
  await s2.doc('steps/b1').set({ md: '第二节' });
  await s1.doc('pack/main').set({ unit: 'u' });
  await s1.collection('evidence').doc('ev-1').set({ kind: 'answer' });
  await new Promise((r) => setTimeout(r, 5));
  const all = db._dump();
  assert.deepEqual(all['sessions/c-20261027-1/steps/b1'], { md: '第一节', session: 'c-20261027-1' });
  assert.deepEqual(all['sessions/c-20261027-2/steps/b1'], { md: '第二节', session: 'c-20261027-2' });
  assert.deepEqual(all['sessions/c-20261027-1/pack/main'], { unit: 'u', session: 'c-20261027-1' });
  assert.deepEqual(all['evidence/ev-1'], { kind: 'answer' }, '证据不进 sessions/ 下面');
  assert.equal(all['steps/b1'], undefined);
  // 读也换：两节课的 b1 互不相干
  assert.equal((await s1.collection('steps').get()).docs[0].data().md, '第一节');
  assert.equal((await s2.doc('steps/b1').get()).data().md, '第二节');
  assert.equal((await s1.collection('steps').where('md', '==', '第一节').get()).size, 1);
  assert.deepEqual(SESSION_SCOPED, ['steps', 'class_pages', 'class_turns', 'pack', 'uploads', 'report', 'talk', 'ops', 'ops_done', 'lint', 'meta', 'unit']);
});

// —— 证据 ——

test('证据：作答、动作写进 evidence（一条写入路径，不另写 answers / events），带这节课、块、知识点；读回来能重放', async () => {
  const db = fakeDb('t-ev');
  db._clear();
  const ctx = { session: 'c-20261027-1', block: 'L2.2.1', point: 'tr' };
  const sink = createSink({ db }, { evidence: () => ctx });
  await sink.record({ type: 'answer', block: 'q-b3', step: 'b3', q: '算一个', value: '[1, 3]', ok: false, attempts: 2, ms: 52000 });
  await sink.event({ type: 'reveal', block: 'ex-1', step: 'b4', detail: { step: 2 } });
  const all = db._dump();
  const keys = Object.keys(all);
  assert.equal(keys.filter((k) => k.startsWith('evidence/ev-')).length, 2);
  assert.ok(!keys.some((k) => k.startsWith('answers/') || k.startsWith('events/')), '不写两遍');
  const ev = Object.values(all);
  const rec = ev.find((e) => e.src === 'record');
  assert.deepEqual([rec.kind, rec.comp, rec.step, rec.block, rec.session, rec.ok, rec.attempts], ['answer', 'q-b3', 'b3', 'L2.2.1', 'c-20261027-1', false, 2]);
  assert.deepEqual(rec.tags, ['L2.2.1', 'L2.2.1#tr']);
  const evt = ev.find((e) => e.src === 'event');
  assert.deepEqual([evt.kind, evt.type, evt.comp], ['reveal', 'reveal', 'ex-1']);
  // 读回来：组件 id 回到 block，作答 / 动作分开
  const back = fromEvidence(rec);
  assert.equal(back.kind, 'record');
  assert.equal(back.rec.block, 'q-b3');
  assert.equal(back.rec.kind, 'answer');
  assert.equal(fromEvidence(evt).kind, 'event');
  assert.equal(fromEvidence(evt).rec.type, 'reveal');
  assert.equal(fromEvidence(evt).rec.detail.step, 2);
  // 单独的课堂、实时黑板：照旧写 answers / events
  const db2 = fakeDb('t-ev2');
  db2._clear();
  const plain = createSink({ db: db2 });
  await plain.record({ type: 'answer', block: 'q' });
  assert.ok(Object.keys(db2._dump()).some((k) => k.startsWith('answers/')));
  // 自检认这样的证据
  const m = M();
  m.sessions = [{ id: 'c-20261027-1', date: TODAY, block: 'L2.2.1', status: 'open' }];
  m.evidence = ev.map((e) => ({ ...e }));
  assert.deepEqual(checkMemory(m, { today: TODAY }).problems, []);
  assert.ok(toAnswer({ type: 'answer' }).id);
});

test('学生说的话、附的图：kind say / photo；标签', () => {
  const ctx = { session: 'c-1', block: 'L2.2.1' };
  const a = sayEvidence('我觉得是 3', ctx);
  assert.deepEqual([a.src, a.kind, a.text, a.session, a.block], ['say', 'say', '我觉得是 3', 'c-1', 'L2.2.1']);
  assert.match(a.id, /^ev-/);
  assert.equal(sayEvidence('', ctx, ['asset1']).kind, 'photo');
  assert.deepEqual(sayEvidence('看图', ctx, ['a', 'b']).images, ['a', 'b']);
  assert.deepEqual(evidenceTags({}), []);
  assert.deepEqual(evidenceTags({ block: 'L1.1.1' }), ['L1.1.1']);
});

// —— 课堂里的 Claude 能写什么 ——

test('课堂里的 Claude 只能写观察和自己的失误；记录的样子过得了自检', () => {
  const ob = observationRecord({ kind: 'proposal', text: 'W19 可以降一级', about: ['W19'], session: 'c-20261027-1', block: 'L2.2.1', turn: 7 });
  assert.deepEqual([ob.kind, ob.by, ob.session, ob.block, ob.turn], ['proposal', 'class', 'c-20261027-1', 'L2.2.1', 7]);
  assert.match(ob.id, /^ob-/);
  assert.equal(observationRecord({ kind: 'weird', text: 'x' }).kind, 'note');
  const sl = slipRecord({ text: '一次出了两道题', lesson: '一块板一件事', session: 'c-20261027-1' }, 2);
  assert.deepEqual([sl.id, sl.by, sl.session], ['S-20261027-1-2', 'class', 'c-20261027-1']);
  const m = M();
  m.sessions = [{ id: 'c-20261027-1', date: TODAY, block: 'L2.2.1' }];
  m.observations = [ob];
  m.slips.push(sl);
  assert.deepEqual(checkMemory(m, { today: TODAY }).problems, []);
});

test('memory_read：按集合、编号查（只读）；不写编号列这一类，可以按块缩小；太长截短', () => {
  const m = M();
  const w = memoryRead(m, { collection: 'weaknesses' });
  assert.equal(w.count, 1);
  assert.equal(w.items[0].id, 'W19');
  assert.equal(memoryRead(m, { collection: 'errors', id: 'L2-07' }).doc.cause, '没看出 βᵀα 是一个数');
  assert.throws(() => memoryRead(m, { collection: 'errors', id: 'L9-99' }), /errors 里没有 L9-99（有：L2-07）/);
  assert.throws(() => memoryRead(m, { collection: 'meta' }), /collection 只能是/);
  assert.throws(() => memoryRead(m, { collection: 'sessions' }), /collection 只能是/);
  assert.deepEqual(memoryRead(m, { collection: 'evidence' }), { needDb: true });
  assert.deepEqual(memoryRead(m, { collection: 'mastery', block: 'L2.2.1' }).items.map((x) => x.id), ['L2.2.1']);
  assert.deepEqual(memoryRead(m, { collection: 'curriculum', block: 'L2.2' }).items.map((x) => x.id).sort(), ['L2.2', 'L2.2.1', 'L2.2.2']);
  const big = { curriculum: [{ id: 'L1.1.1', title: 't', transcript: '原文'.repeat(20000) }] };
  const r = memoryRead(big, { collection: 'curriculum', id: 'L1.1.1' });
  assert.match(r.note, /太长/);
  assert.ok(JSON.stringify(r).length < MEMORY_READ_MAX + 500);
  const many = { errors: Array.from({ length: 400 }, (_, i) => ({ id: `L1-${i}`, q: '题'.repeat(100) })) };
  const r2 = memoryRead(many, { collection: 'errors' });
  assert.ok(r2.more > 0 && JSON.stringify(r2).length <= MEMORY_READ_MAX);
});

// —— 段标知识点 ——

test('board new / add / replace / pin 可以写 point=（这一段练的知识点）', () => {
  assert.deepEqual(parseCommand('new id=b3 title="内积还是外积" point=tr'), { op: 'new', id: 'b3', title: '内积还是外积', point: 'tr' });
  assert.equal(parseCommand('add id=b4 point=ab-c_1').point, 'ab-c_1');
  assert.match(parseCommand('add id=b4 point=a.b').error, /point「a.b」只能用字母、数字、- 和 _/);
  assert.equal(parseCommand('hide id=b4 point=x').point, undefined);
  const out = parseOutput('````board new id=b5 point=tr\n内容\n````', { final: true });
  assert.equal(out.ops[0].point, 'tr');
});

test('一个学习台：实时黑板、自学单元也是 sessions 里的一节，黑板的集合换到这节课下面，学习台自己的 meta 不动', async () => {
  const { kindOf, SESSION_KINDS } = await import('../kit/src/memory/session.js');
  assert.equal(kindOf({}), 'class');
  assert.equal(kindOf({ kind: 'live' }), 'live');
  assert.equal(kindOf({ kind: 'nope' }), 'class');
  assert.deepEqual(Object.keys(SESSION_KINDS), ['class', 'live', 'unit']);
  const seen = [];
  const fake = { doc: (p) => { seen.push(p); return { set: async () => {} }; }, collection: (p) => { seen.push(p); return { doc: () => ({ set: async () => {} }) }; } };
  const sc = scopeDb(fake, 'c-20261029-1');
  sc.doc('meta/now'); sc.collection('talk'); sc.collection('ops'); sc.doc('unit/main'); sc.collection('evidence');
  assert.deepEqual(seen, ['sessions/c-20261029-1/meta/now', 'sessions/c-20261029-1/talk', 'sessions/c-20261029-1/ops', 'sessions/c-20261029-1/unit/main', 'evidence']);
  // 对话里的 Claude 能开实时黑板、自学单元（写 sessions），课堂里的 Claude 不能
  const { canWrite } = await import('../kit/src/memory/schema.js');
  assert.equal(canWrite('chat', 'sessions'), true);
  assert.equal(canWrite('class', 'sessions'), false);
});
