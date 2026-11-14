// 2026-11-14 第二节英语舞台课（时态 → 情态）以后修的三处：拨盘挂错地方摆到屏幕外、学生说的偏好满了全被拒、答案框里一句中文问话被判成填错
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };

const { Scene } = await import('../kit/src/stage/scene.js');
const { parseScript } = await import('../kit/src/stage/script.js');
await import('../kit/src/stage/types/index.js');
const { asksBack } = await import('../kit/src/stage/answer.js');
const { parseMemoLines, planEntry, CAPS, PROFILE_SPILL } = await import('../kit/src/memory/memo.js');

test('没写 at= 的拨盘记一笔 auto（画面改挂到用它的句子旁边）；写了 at= 的不记', () => {
  const sc = new Scene();
  for (const c of parseScript('card m = "题卡"\ndial md = 现在 options="现在 can must"\nsentence s4 = "Online education {verb: supplement | md | 一般 | 单} the traditional kind."\ndial k = 1 range=1-3 at=s4')) sc.apply(c);
  assert.equal(sc.labels.get('dial:md').auto, true);
  assert.ok(!sc.labels.get('dial:k').auto);
  assert.deepEqual(sc.objects.get('s4').picks.deps, ['md']);
});

test('答案是英文、学生写了一整句中文：是对老师说话，不算填错', () => {
  assert.equal(asksBack('就是你现在如何评价你的教学环境', { answer: 'would be' }), true);
  assert.equal(asksBack('would be', { answer: 'would be' }), false);
  assert.equal(asksBack('3', { answer: '3' }), false);
  assert.equal(asksBack('过去将来时', { answer: '过去将来时' }), false); // 答案本来就是中文：照常判
});

test('关于学生满了：学生亲口说的偏好（basis=say）还收，别的照旧拒', () => {
  const profile = Array.from({ length: CAPS.profile }, (_, i) => ({ id: `p-${i}`, topic: '偏好', text: `第 ${i} 条完全不同的偏好 ${'甲乙丙丁戊己庚辛壬癸'[i % 10]}${i * 7}`, status: 'active' }));
  const ctx = { mem: { profile, evidence: [] }, evidence: [{ id: 'ev-s', src: 'say', kind: 'say', text: '排版不许重叠', session: 'c-1', at: 1 }], session: 'c-1', block: 'EN-L1.2.1', date: '2026-11-14' };
  const said = planEntry(parseMemoLines('pref topic=偏好 text="画面上主角放正中，题卡放角落缩小" basis=say').entries[0], ctx);
  assert.ok(!said.error, said.error);
  const other = planEntry(parseMemoLines('pref topic=偏好 text="喜欢先看例子再看定义的讲法" basis=ev-s').entries[0], ctx);
  assert.match(other.error || '', /最多 30/);
  assert.ok(PROFILE_SPILL > 0);
});

const { layoutLines } = await import('../kit/src/stage/compose/report.js');
const { gridOf } = await import('../kit/src/stage/compose/grid.js');

test('话压着挑战条：版面里照实写「压着」（老师才知道要挪）', () => {
  const grid = gridOf({ w: 1148, h: 692 });
  const lines = layoutLines({ boxes: new Map([['goals', { x: 0, y: 0, w: 300, h: 44 }], ['say', { x: 96, y: 20, w: 700, h: 100 }], ['s', { x: 96, y: 200, w: 700, h: 100 }]]), grid });
  assert.ok(lines.some((l) => /压着：.*话 和 挑战|压着：.*挑战 和 话/.test(l)), lines.join('\n'));
});
