// 学习前的整体排查（2026-11-21）：开场简报照第十五轮的角色写（外部是主讲，不是「只做开发」）
import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffText } from '../kit/src/memory/views.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

test('简报不再写「你只做开发」「首页让 Claude 备课」这些第十三、十四轮的角色', () => {
  const mem = { ...sampleMemory('2026-11-21'), pending: [{ id: 'P1', status: 'open', kind: 'note', title: 't' }] };
  const t = handoffText(mem, { today: '2026-11-21', pack: null, space: 'math' });
  assert.doesNotMatch(t, /只做开发|让 Claude 备课|不用你代写|学习台自己处理/, t);
  assert.match(t, /资料包/, '没写资料包的事实照样说');
});

// 以前的课：外部的课、检验的复测课以前都落成「课堂」（classRows 只认 talk / stage / live / unit）
import { classRows } from '../kit/src/memory/views.js';
test('以前的课：外部的课、复测课照自己的种类', () => {
  const rows = classRows({ sessions: [
    { id: 'c-20261118-1', kind: 'ext', date: '2026-11-18', status: 'closed' },
    { id: 'c-20261119-1', kind: 'check', date: '2026-11-19', status: 'closed' },
    { id: 'c-20261120-1', kind: 'class', date: '2026-11-20', status: 'closed' },
  ] });
  const k = Object.fromEntries(rows.map((r) => [r.id, r.kind]));
  assert.deepEqual(k, { 'c-20261118-1': 'ext', 'c-20261119-1': 'check', 'c-20261120-1': 'class' });
});

// 课后报告：一道题每次都对（刷新后又做了一遍）以前判「改对了」（attempts 按条数算成 3）
import { buildReport } from '../kit/src/memory/report.js';
test('课后报告：每次都对是一次对，中间错过才是改对了', () => {
  const ev = (id, at, ok) => ({ id, at, session: 's', src: 'record', type: 'stage', comp: 's-alg', q: '展开以后合并能合并的', ok });
  const r1 = buildReport({ session: { id: 's' }, evidence: [ev('a', 1, true), ev('b', 2, true), ev('c', 3, true)] });
  assert.equal(r1.items[0].outcome, 'first');
  const r2 = buildReport({ session: { id: 's' }, evidence: [ev('a', 1, true), ev('b', 2, false), ev('c', 3, true)] });
  assert.equal(r2.items[0].outcome, 'ok');
});

// 舞台挑战的作答：text 是写给老师的叙述（「学生做到了挑战 g1…（页面演了你预写的 1 行）」），不是学生写的答案；
// 以前被当成「后来写对了「…」」抄进给学生看的这节课的一页
import { lessonSheet } from '../kit/src/memory/sheet.js';
test('舞台挑战：写给老师的叙述不当成学生的答案', () => {
  const g = (id, at, ok, text) => ({ id, at, session: 's', src: 'record', type: 'stage', comp: 's-alg', goal: 'g1', q: '展开以后合并能合并的', ok, text });
  const rep = buildReport({ session: { id: 's' }, evidence: [
    g('a', 1, false, '学生按了「好了」，挑战 g1「展开以后合并能合并的」还没做到'),
    g('b', 2, true, '学生做到了挑战 g1「展开以后合并能合并的」（页面演了你预写的 1 行）'),
  ] });
  assert.equal(rep.items[0].last, '');
  assert.deepEqual(rep.items[0].wrongs, []);
  const sheet = JSON.stringify(lessonSheet({ items: rep.items, steps: [] }));
  assert.match(sheet, /展开以后合并/); // 这道题确实进了这一页
  assert.doesNotMatch(sheet, /页面演了|学生做到了|学生按了/);
});
