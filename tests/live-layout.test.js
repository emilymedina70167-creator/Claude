import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBoards, lintRecord, screenRecord, sameScreen, leadingHeading } from '../kit/src/live/layout.js';

const plan = (docs) => {
  const r = planBoards(docs);
  return { ...r, steps: Object.fromEntries(r.steps) };
};

test('planBoards：按 page 分板，板的标题是板上第一段的 title，最新那块是当前板', () => {
  const r = plan([
    { id: 's3', seq: 3, page: 2, title: '第二块' },
    { id: 's1', seq: 1, page: 1, title: 'Ax 落在哪' },
    { id: 's2', seq: 2, page: 1, title: '提示' },
  ]);
  assert.deepEqual(r.pages, [{ n: 1, title: 'Ax 落在哪', lead: 's1' }, { n: 2, title: '第二块', lead: 's3' }]);
  assert.deepEqual(r.steps, { s1: { page: 1, place: 'board', lead: true }, s2: { page: 1, place: 'board', lead: false }, s3: { page: 2, place: 'board', lead: true } });
  assert.equal(r.cur, 2);
});

test('planBoards：不写 page 就接着前一段的板；第一段不写是第 1 块；写错的板号当没写', () => {
  const r = plan([
    { id: 'a', seq: 1 },
    { id: 'b', seq: 2 },
    { id: 'c', seq: 3, page: 3 },
    { id: 'd', seq: 4 },
    { id: 'e', seq: 5, page: 'x' },
    { id: 'f', seq: 6, page: 0 },
    { id: 'g', seq: 7, page: '4' },
  ]);
  assert.deepEqual(Object.values(r.steps).map((s) => s.page), [1, 1, 3, 3, 3, 3, 4]);
  assert.deepEqual(r.pages.map((p) => p.n), [1, 3, 4]);
});

test('planBoards：常驻栏不占板；撤回的段不当板头，整块都撤回就没有这块板', () => {
  const r = plan([
    { id: 'k1', seq: 1, pin: true, title: '记号' },
    { id: 'k2', seq: 2, place: 'pin' },
    { id: 's1', seq: 3, page: 1, title: '旧标题', hidden: true },
    { id: 's2', seq: 4, title: '新标题' },
    { id: 's3', seq: 5, page: 2, hidden: true },
    { id: 's4', seq: 6 },
  ]);
  assert.deepEqual(r.steps.k1, { page: 0, place: 'pin', lead: false });
  assert.deepEqual(r.steps.k2, { page: 0, place: 'pin', lead: false });
  assert.deepEqual(r.pages, [{ n: 1, title: '新标题', lead: 's2' }, { n: 2, title: '', lead: 's4' }]);
  // s4 没写板号：接着前一段（撤回的 s3 也算）那块板
  assert.equal(r.steps.s4.page, 2);
  assert.deepEqual(plan([{ id: 'x', seq: 1, hidden: true }]).pages, []);
  assert.equal(plan([]).cur, 0);
});

test('planBoards：板上第一段没写 title，就用它开头的 ## 小标题当板的标题', () => {
  const r = plan([
    { id: 's1', seq: 1, page: 1, md: '\n## 1. Ax 落在哪 ##\n\n拖动 x' },
    { id: 's2', seq: 2, page: 2, title: '写了 title', md: '## 别的\n内容' },
    { id: 's3', seq: 3, page: 3, md: '先说一句\n\n## 中间的小标题' },
  ]);
  assert.deepEqual(r.pages.map((p) => p.title), ['1. Ax 落在哪', '写了 title', '']);
  assert.equal(leadingHeading('### 三级'), '');
  assert.equal(leadingHeading(undefined), '');
});

test('planBoards：seq 相同按 id 排；边界输入不抛错', () => {
  const r = plan([{ id: 'b', seq: 1, page: 1 }, { id: 'a', seq: 1, page: 1 }]);
  assert.equal(r.pages[0].lead, 'a');
  for (const bad of [undefined, null, 'x', [null, 3, { seq: 1 }]]) assert.doesNotThrow(() => planBoards(bad));
});

test('lintRecord：有问题才写；问题改好了写一条 ok；没变化不重复写', () => {
  assert.equal(lintRecord('s1', '', [], undefined), null, '一直没问题：不写');
  const bad = lintRecord('s1', '图', [{ kind: 'scene', msg: '看不懂这一行：circle' }], undefined);
  assert.deepEqual(bad, { id: 's1', step: 's1', title: '图', ok: false, problems: [{ kind: 'scene', msg: '看不懂这一行：circle' }] });
  assert.equal(lintRecord('s1', '图', [{ kind: 'scene', msg: '看不懂这一行：circle' }], bad), null, '和数据库里一样：不写');
  const fixed = lintRecord('s1', '图', [], bad);
  assert.deepEqual(fixed, { id: 's1', step: 's1', title: '图', ok: true, problems: [] });
  assert.equal(lintRecord('s1', '图', [], fixed), null);
  const soft = lintRecord('s2', '', [{ kind: 'steps', msg: '缺少 id', soft: true }], undefined);
  assert.equal(soft.ok, true, '只有提醒没有错：ok');
  assert.equal(soft.problems[0].soft, true);
});

test('screenRecord / sameScreen：取整到 10 像素，差一两个像素不算变', () => {
  const a = screenRecord({ w: 820, h: 1180, board: { w: 781, h: 857 }, page: 2, fit: { fits: true, need: 640 } });
  assert.deepEqual(a, { id: 'screen', w: 820, h: 1180, landscape: false, board: { w: 780, h: 860 }, page: 2, fits: true, need: 640 });
  const b = screenRecord({ w: 820, h: 1180, board: { w: 779, h: 858 }, page: 2, fit: { fits: true, need: 642 } });
  assert.ok(sameScreen({ ...a, at: 1 }, { ...b, at: 2 }));
  const c = screenRecord({ w: 1180, h: 820, board: null, page: 0, fit: null });
  assert.deepEqual(c, { id: 'screen', w: 1180, h: 820, landscape: true, board: null, page: 0, fits: null, need: null });
  assert.ok(!sameScreen(a, c));
  assert.ok(!sameScreen(null, a));
});

test('statusRecord：一份黑板现状，各项有上限；软提醒不算写法错误', async () => {
  const { statusRecord, sameStatus, NOW_LIMITS } = await import('../kit/src/live/layout.js');
  const recent = Array.from({ length: 40 }, (_, i) => ({ line: `[作答] 第 ${i} 条`, at: i }));
  const r = statusRecord({
    cur: 3, view: 2, pages: [{ n: 1, title: '一' }, { n: 3, title: '三' }], recent,
    drafts: [{ step: 's4', block: 'q-4', kind: 'answer', label: '', text: '(3, □)' }, { step: 's4', block: 'x', text: '  ' }],
    lint: [{ step: 's2', ok: false, problems: [{ kind: 'scene', msg: '看不懂这一行' }, { kind: 'steps', msg: '缺 id', soft: true }] }, { step: 's1', ok: true, problems: [] }],
    screen: { w: 740, h: 730, landscape: true, board: { w: 700, h: 440 }, fits: false, need: 510 },
    uploads: [{ id: 'u1', images: ['a1'], note: '第二题过程', page: 3, at: 5 }],
  });
  assert.equal(r.id, 'now');
  assert.equal(r.board, 3);
  assert.equal(r.view, 2);
  assert.equal(r.recent.length, NOW_LIMITS.recent);
  assert.equal(r.recent.at(-1).line, '[作答] 第 39 条');
  assert.deepEqual(r.drafts, [{ step: 's4', block: 'q-4', text: '(3, □)' }]);
  assert.deepEqual(r.lint, [{ step: 's2', problems: ['scene：看不懂这一行'] }]);
  assert.deepEqual(r.screen, { w: 740, h: 730, landscape: true, board: { w: 700, h: 440 }, fits: false });
  assert.deepEqual(r.uploads, [{ id: 'u1', images: ['a1'], note: '第二题过程', page: 3, at: 5 }]);
  assert.ok(sameStatus({ ...r, at: 1 }, { ...r, at: 2 }));
  assert.ok(!sameStatus(r, { ...r, view: 3 }));
  assert.doesNotThrow(() => statusRecord());
  assert.equal(statusRecord({ kit: '2026-10-26' }).kit, '2026-10-26', '黑板现状带上组件库版本');
  assert.ok(JSON.stringify(statusRecord({ recent: Array.from({ length: 30 }, () => 'x'.repeat(5000)) })).length < 20000, '再长也不会撑爆一个文档');
});
