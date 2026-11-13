// 第九轮第 3 批：讲法打分（kit/src/aide/moves.js）：课后助手标讲法，页面按学生下一次作答算有没有用
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, MOVES_MIN, parseMoves, moveOutcome, moveStats, movesText } from '../kit/src/aide/moves.js';
import { aideForTurn } from '../kit/src/aide/brief.js';
import { splitAfter, afterPrompt } from '../kit/src/aide/after.js';

const ev = (turn, ok, extra = {}) => ({ session: 'c-1', src: 'record', turn, ok, at: turn * 10 + (extra.d || 0), ...extra });

test('读讲法：词不在表里的、轮不在这节课的丢掉', () => {
  const r = parseMoves('讲法｜#3｜反例\n讲法｜#4｜讲故事\n讲法｜#99｜反例\n讲法｜#5｜先猜再揭晓', { turns: new Set([3, 4, 5]) });
  assert.deepEqual(r, [{ turn: 3, move: '反例' }, { turn: 5, move: '先猜再揭晓' }]);
  assert.ok(MOVES.includes('反例'));
});

test('有没有用：讲完学生下一次作答一次对、没要提示才算', () => {
  assert.equal(moveOutcome({ turn: 3 }, [ev(3, true)]), 'ok');
  assert.equal(moveOutcome({ turn: 3 }, [ev(3, false), ev(3, true, { d: 1 })]), 'miss');
  assert.equal(moveOutcome({ turn: 3 }, [{ session: 'c-1', src: 'event', kind: 'stage-next', turn: 3, at: 29, detail: { button: '给个提示' } }, ev(3, true, { d: 5 })]), 'miss');
  assert.equal(moveOutcome({ turn: 3 }, [ev(4, true)]), null);
});

test('按块数几节课的，次数少不下结论', () => {
  const sessions = [{ id: 'c-1', block: 'DS-L8.2.1', moves: [{ turn: 3, move: '反例' }] }, { id: 'c-2', block: 'DS-L8.2.1', moves: [{ turn: 2, move: '反例' }, { turn: 4, move: '直接讲规则' }] }];
  const evidence = [ev(3, true), { ...ev(2, true), session: 'c-2' }, { ...ev(4, false), session: 'c-2' }];
  const st = moveStats(sessions, evidence, 'DS-L8.2.1');
  assert.deepEqual(st['反例'], { n: 2, ok: 2 });
  assert.deepEqual(st['直接讲规则'], { n: 1, ok: 0 });
  assert.match(movesText(st), /次数还少/);
  const many = { 反例: { n: MOVES_MIN + 2, ok: MOVES_MIN + 1 } };
  assert.match(movesText(many), /反例：5 次里 4 次讲完一次做对/);
});

test('学生卡给老师看的样子里带上讲法的数（页面算的）', () => {
  const curriculum = [{ id: 'DS-L8.2.1', level: 'block', title: '直接插入排序' }];
  const mem = { sessions: Array.from({ length: 3 }, (_, i) => ({ id: `c-${i}`, block: 'DS-L8.2.1', moves: [{ turn: 2, move: '反例' }] })), evidence: Array.from({ length: 3 }, (_, i) => ({ session: `c-${i}`, src: 'record', turn: 2, ok: true, at: 1 })) };
  const r = aideForTurn({ block: 'DS-L8.2.1', cards: [{ id: 'DS-L8.2.1', block: 'DS-L8.2.1', at: 1, text: '概括｜x' }], curriculum, space: 'cs', mem });
  assert.match(r.cards[0], /讲法：.*反例：3 次里 3 次/);
});

test('下课后的助手：要它标讲法，分得出这一节', () => {
  const p = afterPrompt({ session: { id: 'c-1' }, transcript: 'x' });
  assert.match(p, /## 讲法/);
  assert.match(splitAfter('## 讲法\n讲法｜#3｜反例').moves, /反例/);
});
