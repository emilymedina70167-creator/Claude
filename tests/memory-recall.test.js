// 记忆点（docs/review-plan.md）：要背的东西一条一条排期，每天自己想一遍（recall.js）；课堂里的 Claude 用 memo 的 recall 记。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { recallToday, rateRecall, recallDue, sameText, recallEvidence, recallLine, nextRecallId, RECALL_N } = await import('../kit/src/memory/recall.js');
const { parseMemoLines, planEntry, applyPending, pendingRecord, meChange, pendingTitle, voidedIds, SESSION_CAPS } = await import('../kit/src/memory/memo.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { sampleMemory } = await import('../kit/src/memory/sample.js');
const { memoryDigest } = await import('../kit/src/memory/digest.js');
const { spaceOfDoc, filterSpace } = await import('../kit/src/memory/space.js');

const TODAY = '2026-11-03';
const SID = 'c-20261103-1';
const K = (id, extra = {}) => ({ id, q: `问${id}`, a: `答${id}`, tier: 1, last: '2026-11-01', status: 'active', ...extra });

test('recallToday：到期的才出，没想起过多的、过期久的在前，挨着的尽量不同块；一次最多 RECALL_N 条', () => {
  const list = [
    K('K1', { block: 'L2.1.1', last: '2026-11-02' }), // 今天到期
    K('K2', { block: 'L2.1.1', last: '2026-10-20' }), // 过期久
    K('K3', { block: 'DS-L8.1.1', last: '2026-11-02', lapses: 2 }), // 没想起过两次
    K('K4', { block: 'L2.1.1', last: '2026-11-03' }), // 明天才到
    K('K5', { block: 'EN-L1.2.1', tier: 7, last: '2026-10-01', status: 'done' }), // 记牢了
    K('K6', { block: 'L2.1.1', last: '2026-11-02', status: 'void' }),
    K('K7', { block: 'EN-L1.2.1' , last: undefined }), // 还没想过：今天
  ];
  const r = recallToday(list, { today: TODAY });
  assert.deepEqual(r.items.map((x) => x.id), ['K3', 'K2', 'K7', 'K1']);
  assert.equal(r.total, 4);
  assert.deepEqual(r.bySpace, { cs: 1, math: 2, en: 1 });
  assert.equal(r.next, '2026-11-04');
  const many = Array.from({ length: 30 }, (_, i) => K(`K${i + 1}`, { last: '2026-10-01' }));
  assert.equal(recallToday(many, { today: TODAY }).items.length, RECALL_N);
  // 同一块挨着的错开
  const mix = recallToday([K('K1', { block: 'A', last: '2026-10-01' }), K('K2', { block: 'A', last: '2026-10-02' }), K('K3', { block: 'B', last: '2026-10-03' })], { today: TODAY });
  assert.deepEqual(mix.items.map((x) => x.block), ['A', 'B', 'A']);
});

test('rateRecall：想起来了升一档（30 天那档再想起来算记牢了）；模糊不动；没想起回 1 天、记一次', () => {
  assert.deepEqual(rateRecall(K('K1', { tier: 3 }), 'got', { today: TODAY }).patch, { tier: 7, last: TODAY, result: 'got' });
  assert.deepEqual(rateRecall(K('K1', { tier: 30 }), 'got', { today: TODAY }).patch, { last: TODAY, result: 'got', status: 'done' });
  assert.deepEqual(rateRecall(K('K1', { tier: 7 }), 'vague', { today: TODAY }).patch, { tier: 7, last: TODAY, result: 'vague' });
  assert.deepEqual(rateRecall(K('K1', { tier: 14, lapses: 1 }), 'miss', { today: TODAY }).patch, { tier: 1, last: TODAY, result: 'miss', lapses: 2 });
  assert.throws(() => rateRecall(K('K1'), 'maybe'), /只能是/);
  assert.equal(recallDue(K('K1', { tier: 7, last: '2026-11-01' }), TODAY).due, '2026-11-08');
  assert.ok(sameText(' 不稳定。', '不稳定'));
  assert.ok(!sameText('', '不稳定'));
  const ev = recallEvidence(K('K1', { block: 'L2.1.1' }), { typed: '答', rating: 'got', at: 5 });
  assert.equal(ev.src, 'recall');
  assert.equal(ev.comp, 'K1');
  assert.match(ev.id, /^ev-/);
  assert.equal(nextRecallId([{ id: 'K9' }, { id: 'K12' }]), 'K13');
  assert.match(recallLine(K('K1', { lapses: 2 }), TODAY), /问K1 → 答K1.*没想起过 2 次/);
});

test('memo 的 recall：新的一条从明天排；几乎一样的不收；能改问法、能停掉；一节课记几条不按条数挡', () => {
  const mem = sampleMemory(TODAY);
  mem.recall = [K('K1', { q: '快速排序稳定吗', a: '不稳定', block: 'L2.2.2', space: 'math' })];
  const ctx = { mem, evidence: [], session: SID, block: 'L2.2.2', date: TODAY };
  const one = (body) => planEntry(parseMemoLines(body).entries[0], ctx);
  const add = one('recall q="向量组线性相关的定义" a="存在不全为零的 k 使 k1a1+…+knan=0"');
  assert.equal(add.op, 'add');
  assert.equal(add.target, 'K2');
  assert.deepEqual([add.data.tier, add.data.last, add.data.block, add.data.space, add.data.session], [1, TODAY, 'L2.2.2', 'math', SID]);
  assert.match(one('recall q="快速排序稳定吗？" a="不"').error, /和 K1.*同一条/);
  assert.match(one('recall q="只有问法"').error, /q="问法" 和 a="标准答案"/);
  assert.match(one('recall id=K9 q="x"').error, /没有 K9/);
  assert.deepEqual(one('recall id=K1 a="不稳定：3 2 2\' 排完 2\' 在 2 前面"').patch, { a: '不稳定：3 2 2\' 排完 2\' 在 2 前面' });
  assert.deepEqual(one('recall id=K1 status=void why="会推"').patch, { status: 'void', why: '会推' });
  assert.match(one('recall id=K1 status=done').error, /只能写 void/);
  // 执行：状态类，档位记 log；自检过
  const pd = { ...pendingRecord(add, { session: SID }), status: 'open' };
  const { writes } = applyPending(pd, mem, { date: TODAY });
  const doc = writes.find((w) => w.coll === 'recall').doc;
  assert.ok(doc.log.some((l) => l.field === 'tier' && l.to === 1));
  const m2 = { ...mem, recall: [...mem.recall, { id: 'K2', ...doc }] };
  assert.deepEqual(checkMemory(m2, { today: TODAY }).problems.filter((p) => p.coll === 'recall' && !p.soft), []);
  assert.match(pendingTitle({ ...pd, status: 'done' }), /记忆点：向量组线性相关的定义 → 存在/);
  // 一节课记满 SESSION_CAPS.recall 条以后，不一样的照收
  const full = { ...ctx, mem: { ...mem, recall: Array.from({ length: SESSION_CAPS.recall }, (_, i) => K(`K${i + 10}`, { q: `第${i}条完全不同的问法${'甲乙丙丁戊己庚辛壬癸'[i]}`, session: SID })) } };
  assert.ok(!planEntry(parseMemoLines('recall q="又一条" a="x"').entries[0], full).error);
  // 停掉的不当真
  assert.ok(voidedIds({ recall: [K('K1', { status: 'void' })] }).has('recall/K1'));
});

test('我自己加一条、停掉一条；分科；课堂的记忆摘要带这一块要记的', () => {
  const mem = sampleMemory(TODAY);
  mem.recall = [K('K1', { q: '系动词有哪些', a: 'be、感官、变化、保持、表象', block: 'EN-L1.2.1' })];
  const pd = meChange('recall-add', mem, { q: '直接插入排序稳定吗', a: '稳定', block: 'DS-L8.2.1', date: TODAY });
  assert.deepEqual([pd.tier, pd.target, pd.data.space, pd.data.tier], ['me', 'K2', 'cs', 1]);
  assert.throws(() => meChange('recall-add', mem, { q: '系动词有哪些？', a: 'x', block: 'EN-L1.2.1' }), /差不多/);
  assert.throws(() => meChange('recall-add', mem, { q: '', a: 'x' }), /都要写/);
  assert.deepEqual(meChange('recall-void', mem, { id: 'K1' }).patch, { status: 'void', why: '我说不用记了' });
  assert.equal(spaceOfDoc('recall', mem.recall[0]), 'en');
  assert.deepEqual(filterSpace(mem, 'en').recall.map((x) => x.id), ['K1']);
  assert.deepEqual(filterSpace(mem, 'math').recall, []);
  // 课堂里：这一块要记的放进记忆摘要（课堂 Claude 知道记过什么，不重复记，也知道哪条老想不起）
  const m = sampleMemory(TODAY);
  const block = m.position.find((p) => p.id === 'now')?.block || 'L2.2.2';
  m.recall = [K('K1', { q: '外积的秩是多少', a: '1（两个都不是零向量时）', block, lapses: 2 })];
  const d = memoryDigest(m, { block, today: TODAY });
  assert.match(d.text, /## 要记的/);
  assert.match(d.text, /K1 外积的秩是多少 → 1/);
});

test('recallLine：刚记下的（建的时候就写了 last）是「还没想过」，评过一次才写档位', () => {
  const fresh = { id: 'K9', q: '问', a: '答', tier: 1, last: '2026-11-04' };
  assert.match(recallLine(fresh, '2026-11-05'), /还没想过/);
  assert.match(recallLine({ ...fresh, result: 'got', tier: 3 }, '2026-11-05'), /第 3 天那档/);
});
