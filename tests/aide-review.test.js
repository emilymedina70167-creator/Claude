// 第九轮整支审查修的（每条先写这里的测试看它失败，再修）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDigest } from '../kit/src/memory/digest.js';
import { sampleMemory } from '../kit/src/memory/sample.js';
import { watchSection } from '../kit/src/aide/watch.js';
import { createWatcher } from '../kit/src/aide/watcher.js';
import { acceptCard, cardText, linesText, parseCard } from '../kit/src/aide/card.js';
import { moveStats } from '../kit/src/aide/moves.js';
import { cardWork } from '../kit/src/aide/fill.js';
import { needsSkills } from '../kit/src/memory/skills.js';
import { splitAfter } from '../kit/src/aide/after.js';
import { briefText } from '../kit/src/aide/brief.js';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { createLoop } from '../kit/src/stage/loop.js';

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

test('1. 助手的两节不挤掉规则和守则：守则那一段和没有助手时一样多', () => {
  const mem = sampleMemory('2026-11-13');
  mem.errors = [...mem.errors, ...Array.from({ length: 30 }, (_, i) => ({ id: `L2-${50 + i}`, block: 'L2.2.2', q: `题 ${i} ${'字'.repeat(400)}`, mine: '错的'.repeat(60), step: '一步', cause: '原因'.repeat(50), date: '2026-11-01' }))];
  mem.lessons = Array.from({ length: 12 }, (_, i) => ({ id: `T-${i + 1}`, text: `守则 ${i} ${'字'.repeat(130)}`, topic: '讲解', hits: 1, status: 'active', log: [] }));
  mem.rules = Array.from({ length: 40 }, (_, i) => ({ id: `rule-x-${i}`, cat: '讲解', text: '规则'.repeat(80), status: 'active' }));
  const aide = { brief: Array.from({ length: 15 }, (_, i) => `- 要点 ${i} ${'字'.repeat(120)}`).join('\n'), cards: Array.from({ length: 8 }, (_, i) => `### 学生卡：块${i}\n- 概括：${'字'.repeat(600)}`) };
  const count = (t) => (t.match(/^- T-\d+ /gm) || []).length;
  const a = memoryDigest(mem, { block: 'L2.2.2', budget: 28 * 1024 });
  const b = memoryDigest(mem, { block: 'L2.2.2', budget: 28 * 1024, aide });
  assert.ok(count(a.text) > 0);
  assert.equal(count(b.text), count(a.text));
  assert.equal(b.rules, a.rules);
});

// 假舞台：提前想要的那种（这一问只能点「接着」、手上没东西可动）
function specClass() {
  const scene = new Scene();
  for (const c of parseScript('array k = 1 2\nask next')) scene.apply(c);
  const stage = {
    log: [], errors: [], scene, teacherAudit: [], reacting: Promise.resolve(), studentChain: Promise.resolve(), pendingGoals: () => [],
    begin() { let r; const armed = new Promise((x) => { r = x; }); return { mark: 0, turn: 1, armed, push() {}, end() { r(); return new Promise(() => {}); }, drop() { r(); }, abort: async () => {} }; },
    play: async () => ({}), holdAsk() {}, cancelWait() {},
  };
  let calls = 0;
  const host = { stage, mock: true, model: 'm', teach: {}, quietMs: 5000, putTurn() {}, cost: (c) => c, thinking() {}, messages: () => [{ role: 'user', content: 'x' }], addTurn: (r) => ({ ...r, seq: 1 }), call: async () => { calls++; return new Promise(() => {}); } };
  return { host, calls: () => calls };
}

test('2. 旁听或档案在跑：不提前想（同一时刻最多两个调用）', async () => {
  const a = specClass();
  a.host.aideBusy = () => true;
  const loop = createLoop(a.host);
  await loop.resume({ lastClaude: 1 });
  await wait(20);
  assert.equal(a.calls(), 0);
  loop.close();
  const b = specClass();
  b.host.aideBusy = () => false;
  const loop2 = createLoop(b.host);
  await loop2.resume({ lastClaude: 1 });
  await wait(20);
  assert.equal(b.calls(), 1, '没有助手在跑时照旧提前想');
  loop2.close();
});

test('3. 同一份旁听发现只带进一轮（提前想和真发的那一条是同一轮，都带）', () => {
  const w = createWatcher({ call: null, material: () => '', check: () => ({}) });
  w.set({ upTo: 2, lines: [{ kind: '以前', text: 'x' }] });
  assert.ok(w.section(2));
  assert.ok(w.section(2), '同一轮再要一次（提前想、真发）照样有');
  assert.equal(w.section(3), '', '下一轮不再带');
  assert.equal(watchSection({ upTo: 1, lines: [{ kind: '以前', text: 'x' }] }, { seq: 3 }), '', '过了两轮也不带');
});

test('4. 旧卡原样留着、在中间插一行：算追加，不收', () => {
  const old = '概括｜稳定性没过关\n误解｜把稳定当后进先出\n先测｜再问一次';
  const next = linesText([...parseCard(old).lines, { sec: '误解', text: '下标从 1 数' }]);
  assert.equal(acceptCard(next, old).ok, false);
});

test('5. 讲法的数：下课时算好存在 sessions.moves 上，课堂里没有证据也算得出', () => {
  const sessions = [{ id: 'c-1', block: 'B', moves: [{ turn: 2, move: '反例', out: 'ok' }, { turn: 4, move: '反例', out: 'miss' }] }];
  assert.deepEqual(moveStats(sessions, [], 'B')['反例'], { n: 2, ok: 1 });
});

test('6. 教研室合并时写的卡：at 就是 labAt，下次不再为它出单子', () => {
  const cs = ['DS-L8.1.1', 'DS-L8.2.1', 'DS-L8.2.2'].map((b) => ({ id: b, block: b, at: 50, labAt: 50 }));
  assert.deepEqual(cardWork(cs), []);
});

test('8. 带 aide 的课：报告重算了，只重做归类', () => {
  const s = { aide: 1, kind: 'stage', status: 'closed', report: { at: 9, items: 2 }, after: { at: 5, v: 1 }, skills: { v: 1, reportAt: 5 } };
  assert.equal(needsSkills(s), true);
  assert.equal(needsSkills({ ...s, skills: { v: 1, reportAt: 9 } }), false);
  assert.equal(needsSkills({ ...s, after: null }), false, '下课后的整理还没做：等它');
});

test('照抄提示词里的「### 卡 X 现在是：」或别的标题：不把行并进上一节', () => {
  const s = splitAfter('## 事实\nnote text="x"\n\n### 卡 L2.2.2 现在是：\n概括｜新的\n\n## 其他\n乱写');
  assert.equal(s.cards['L2.2.2'], '概括｜新的');
  assert.ok(!/概括/.test(s.facts));
  assert.ok(!/乱写/.test(s.cards['L2.2.2']));
});

test('卡和档案给 Claude 看的字里不出现「他」「她」', () => {
  assert.ok(!/[他她](?!们)/.test(cardText({ block: 'B', text: '概括｜他把稳定当后进先出' })));
  assert.ok(!/[他她](?!们)/.test(briefText({ text: '要点｜她总是下标从 1 数' })));
});

test('旁听挂住不回：过了时限算失败，下一次还能开', async () => {
  let n = 0;
  const rows = [];
  const w = createWatcher({ call: () => { n++; return new Promise(() => {}); }, material: () => 'p', check: () => ({ lines: [] }), record: (r) => rows.push(r), timeoutMs: 20, gapMs: 0 });
  w.kick({ canPlay: true, upTo: 1 });
  await wait(60);
  assert.equal(w.busy, false);
  assert.ok(rows.some((r) => r.error));
  w.kick({ canPlay: true, upTo: 2 });
  assert.equal(n, 2);
});
