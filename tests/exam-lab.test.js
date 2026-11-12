// 教研室的三种新活（kit/src/exam/lab.js）：画像、映射、考情动态
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examWork, profileBrief, parseProfile, mapBrief, parseMap, applyMap, intelBrief, parseIntel, mergeIntel } from '../kit/src/exam/lab.js';

const meta = { stats: { OS: { heat: [{ id: 'G-OS-3.2' }, { id: 'G-OS-2.3' }], stale: { profiles: ['G-OS-3.2', 'G-OS-2.3'], maps: [] }, titles: { 'G-OS-3.2': '页面置换' }, srcs: { 'G-OS-3.2': 'abc' }, holes: { blocks: ['OS-L9.1.1'], nodes: [] } } }, intelAt: 0 };

test('工作单：过时的画像（热度高的价值高）、没挂考点的块、考情动态（平时一周一次，九十月每天）', () => {
  const w = examWork(meta, { today: '2026-11-12', now: Date.parse('2026-11-12') });
  const p = w.filter((x) => x.kind === 'profile');
  assert.deepEqual(p.map((x) => x.ref), ['G-OS-3.2', 'G-OS-2.3']);
  assert.ok(p[0].value > p[1].value);
  assert.equal(p[0].key, 'G-OS-3.2|abc');
  assert.ok(w.some((x) => x.kind === 'map' && x.ref === 'OS'));
  assert.ok(w.some((x) => x.kind === 'intel'));
  const now = Date.parse('2026-11-12');
  assert.ok(!examWork({ ...meta, intelAt: now - 3 * 86400000 }, { today: '2026-11-12', now }).some((x) => x.kind === 'intel'), '11 月三天前查过：不查');
  assert.ok(examWork({ ...meta, intelAt: now - 2 * 86400000 }, { today: '2026-10-12', now }).some((x) => x.kind === 'intel'), '10 月每天查');
});

const node = { id: 'G-OS-3.2', title: '页面置换', course: 'OS', level: '掌握', text: '掌握 FIFO、LRU' };
const qs = [{ id: 'Q-408-2019-26', year: 2019, n: 26, type: 'single', points: 2, stem: '题面一', answer: 'B', tags: { syl: ['G-OS-3.2'], how: 'calc' } }];

test('画像：单子里有大纲原文和题；坑要引这个考点下能用的题；不提他她', () => {
  const b = profileBrief({ node, questions: qs });
  assert.match(b, /掌握 FIFO、LRU/);
  assert.match(b, /### Q-408-2019-26/);
  assert.doesNotMatch(b.replace(/题面一/g, ''), /[他她]/);
  const r = parseProfile('怎么考｜常考缺页次数（Q-408-2019-26）\n坑｜把 FIFO 当 LRU｜Q-408-2019-26\n坑｜编的｜Q-408-2025-1\n坑｜没写题', { node, qids: new Set(['Q-408-2019-26']) });
  assert.match(r.how, /缺页次数/);
  assert.deepEqual(r.traps, [{ id: 'G-OS-3.2#t1', text: '把 FIFO 当 LRU', qs: ['Q-408-2019-26'] }]);
  assert.equal(r.problems.length, 2);
  assert.match(parseProfile('怎么考｜见 Q-408-2018-1', { node, qids: new Set() }).problems.join(), /Q-408-2018-1/);
});

test('映射：只收单子里的块、考点树里有的考点；并进去时这张单子管的块先摘再挂', () => {
  const r = parseMap('块｜OS-L9.1.1｜G-OS-3.2, G-OS-9\n块｜OS-L0｜G-OS-3.2\n块｜OS-L9.2.1｜无', { blockIds: new Set(['OS-L9.1.1', 'OS-L9.2.1']), sylIds: new Set(['G-OS-3.2']) });
  assert.deepEqual(r.map, { 'OS-L9.1.1': ['G-OS-3.2'], 'OS-L9.2.1': [] });
  assert.equal(r.problems.length, 2);
  const out = applyMap([{ id: 'G-OS-3.2', blocks: ['OS-L3.2.1', 'OS-L9.2.1'] }, { id: 'G-OS-2.3', blocks: [] }], r.map);
  assert.deepEqual(out, { 'G-OS-3.2': ['OS-L3.2.1', 'OS-L9.1.1'] });
  assert.match(mapBrief({ course: 'OS', nodes: [node], blocks: [{ id: 'OS-L9.1.1', title: '新块' }] }), /OS-L9\.1\.1 新块/);
});

test('考情动态：只收有链接、种类对的；同一个数另一晚又抓到才算核过两次', () => {
  const r = parseIntel('动态｜line｜2026 年复试线 330 分｜330｜https://yz.nju.edu.cn/x｜2026-03-10\n动态｜line｜没链接｜1｜-｜x\n动态｜rumor｜a｜-｜https://a.b/c｜');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].value, 330);
  assert.equal(r.problems.length, 2);
  const d1 = Date.parse('2026-03-10T20:00:00Z');
  const a = mergeIntel([], r.items[0], { at: d1 });
  assert.equal(a.isNew, true);
  assert.equal(a.doc.checks, 1);
  const same = mergeIntel([{ id: a.id, ...a.doc }], r.items[0], { at: d1 + 3600000 });
  assert.equal(same.doc.checks, 1, '同一晚重复交的不算');
  const next = mergeIntel([{ id: a.id, ...a.doc }], r.items[0], { at: d1 + 86400000 });
  assert.equal(next.doc.checks, 2);
  assert.match(intelBrief({ target: { school: '南京大学', subjects: ['408'] }, today: '2026-11-12' }), /WebSearch/);
});
test('映射、考情动态的单子：不提他她', () => {
  assert.doesNotMatch(mapBrief({ course: 'OS', nodes: [node], blocks: [{ id: 'OS-L9.1.1', title: '新块' }] }), /[他她]/);
  assert.doesNotMatch(intelBrief({ target: { school: '南京大学', dept: '智能科学与技术学院', alt: ['人工智能学院'], subjects: ['408'], date: '2027-12-21' }, today: '2026-11-12', recent: [{ kind: 'line', text: '复试线', value: 330, url: 'https://x.y/z' }] }), /[他她]/);
});
