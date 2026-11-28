// 按题汇总的作答表（sessions/{课号}/meta/answers）：只列事实，一道题一行
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerSheet } from '../kit/src/class/sheet.js';

const rec = (comp, at, ok, extra = {}) => ({ id: `ev-${at}`, src: 'record', kind: 'parse', comp, step: 'b1', at, ok, q: `题 ${comp}`, title: '句子成分', value: `v${at}`, detail: ok ? '' : '1 处范围不对', ms: 1000, ...extra });
const ev = (comp, at, kind, detail) => ({ id: `ev-${at}`, src: 'event', kind, type: kind, comp, step: 'b1', at, detail });

test('一道题一行：交了几次、第几次对、每次怎么答、页面怎么说', () => {
  const s = answerSheet([rec('rt-1', 30, true), rec('rt-1', 10, false), rec('rt-1', 20, false, { detail: '2 处范围不对' }), rec('rt-2', 40, true)], { at: 99 });
  assert.equal(s.at, 99); assert.equal(s.n, 2);
  assert.deepEqual(s.rows.map((r) => r.comp), ['rt-1', 'rt-2'], '按第一次动它的先后排');
  const r = s.rows[0];
  assert.equal(r.n, 3); assert.equal(r.okAt, 3); assert.equal(r.step, 'b1'); assert.equal(r.kind, 'parse'); assert.equal(r.title, '句子成分'); assert.equal(r.q, '题 rt-1');
  assert.deepEqual(r.tries, [{ at: 10, ok: false, value: 'v10', why: '1 处范围不对', ms: 1000 }, { at: 20, ok: false, value: 'v20', why: '2 处范围不对', ms: 1000 }, { at: 30, ok: true, value: 'v30', ms: 1000 }]);
  assert.equal(s.rows[1].okAt, 1);
});

test('还没对是 0；页面说的话取 detail / fail / wrong', () => {
  const s = answerSheet([rec('c1', 1, false, { kind: 'code', detail: undefined, fail: '第 2 行：应该是「{」' }), rec('q1', 2, false, { kind: 'quiz', value: null, detail: undefined, wrong: ['B. 2, 16'] })]);
  assert.equal(s.rows[0].okAt, 0); assert.equal(s.rows[0].tries[0].why, '第 2 行：应该是「{」');
  assert.equal(s.rows[1].tries[0].why, '选了 B. 2, 16'); assert.equal('value' in s.rows[1].tries[0], false);
});

test('点开过的生词、演示走到第几步、点了放弃，记在那道题的那一行', () => {
  const s = answerSheet([
    ev('rt-1', 1, 'gloss', { word: 'meeting', gloss: '会议' }), ev('rt-1', 2, 'gloss', { word: 'meeting', gloss: '会议' }), ev('rt-1', 3, 'gloss', { word: 'plan', gloss: '计划' }),
    rec('rt-1', 5, false), ev('rt-1', 6, 'giveup', { title: '句子成分' }),
    ev('demo-1', 7, 'drag', { name: 'step', value: 3 }), ev('demo-1', 8, 'drag', { name: 'step', value: 9 }), ev('demo-1', 9, 'drag', { name: 'step', value: 4 }),
    ev('st-1', 10, 'reveal', { step: 2, title: '第二步' }), ev('g-1', 11, 'drag', { name: 'a', value: 2 }),
  ]);
  const by = Object.fromEntries(s.rows.map((r) => [r.comp, r]));
  assert.deepEqual(by['rt-1'].gloss, [{ word: 'meeting', gloss: '会议', n: 2 }, { word: 'plan', gloss: '计划', n: 1 }]);
  assert.equal(by['rt-1'].giveup, true); assert.equal(by['rt-1'].n, 1);
  assert.equal(by['demo-1'].n, 0); assert.equal(by['demo-1'].reached, 9); assert.deepEqual(by['demo-1'].tries, []);
  assert.equal(by['st-1'].revealed, 2);
  assert.equal('g-1' in by, false, '拖图上的变量不是这张表的事（现状在 meta/now）');
});

test('不进表的：学生说的话、助手的话、没有组件 id 的、想记忆点的', () => {
  const s = answerSheet([{ src: 'say', kind: 'say', text: '好了', at: 1 }, { src: 'helper', kind: 'helper', text: 'x', at: 2 }, { src: 'event', kind: 'open', comp: null, at: 3 }, { src: 'recall', kind: 'recall', comp: 'K1', at: 4 }, null]);
  assert.deepEqual(s.rows, []);
});

test('只列事实：没有「掌握」「建议」这类栏；长的截短、次数多的只留最后 12 次', () => {
  const many = Array.from({ length: 15 }, (_, i) => rec('x', i + 1, false, { value: 'v'.repeat(900), q: 'q'.repeat(500) }));
  const s = answerSheet(many);
  const r = s.rows[0];
  assert.equal(r.n, 15); assert.equal(r.tries.length, 12); assert.equal(r.tries[0].at, 4);
  assert.ok(r.tries[0].value.length <= 401); assert.ok(r.q.length <= 201);
  assert.deepEqual(Object.keys(r).sort(), ['comp', 'kind', 'n', 'okAt', 'q', 'step', 'title', 'tries']);
  assert.deepEqual(Object.keys(s).sort(), ['at', 'n', 'rows']);
});

test('内容一样，算出来的就一样（不带时间时 at 是最后一条证据的时刻）', () => {
  const evs = [rec('a', 5, true), rec('b', 9, false)];
  assert.deepEqual(answerSheet(evs), answerSheet(evs.slice().reverse()));
  assert.equal(answerSheet(evs).at, 9);
});

test('只给主讲看的那一句（check）跟在页面说的话后面', () => {
  const s = answerSheet([rec('rt-1', 1, false, { check: '主语：标了「the manager quickly」，多圈了 quickly' })]);
  assert.equal(s.rows[0].tries[0].why, '1 处范围不对｜主语：标了「the manager quickly」，多圈了 quickly');
});
