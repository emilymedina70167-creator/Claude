// 2026-11-14：挂着的课一夜没动静当作下了课；下课后的整理调用之前先记一次「试过」，断在半路也算；
// 以前上完、复盘一直没做成的舞台课并进下课后的助手
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleClose, IDLE_CLOSE_MS, afterSession } from '../kit/src/memory/session.js';
import { needsAfter, AFTER_FAILS } from '../kit/src/aide/after.js';
import { needsDebrief } from '../kit/src/memory/debrief.js';

const NOW = Date.UTC(2026, 10, 14, 12);

test('挂着一夜没动静的上课当作下了课；练习、删着的、刚动过的不算', () => {
  const open = { id: 'c-1', kind: 'stage', status: 'open', startedAt: NOW - 2 * IDLE_CLOSE_MS };
  assert.equal(idleClose(open, NOW - IDLE_CLOSE_MS - 1, NOW), true);
  assert.equal(idleClose(open, NOW - 3600e3, NOW), false); // 一小时前还在动：中途走开不算
  assert.equal(idleClose({ ...open, kind: 'drill' }, 0, NOW), false);
  assert.equal(idleClose({ ...open, kind: 'live' }, 0, NOW), false);
  assert.equal(idleClose({ ...open, deleting: NOW }, 0, NOW), false);
  assert.equal(idleClose({ ...open, status: 'closed' }, 0, NOW), false);
  assert.equal(idleClose({ ...open, kind: undefined }, 0, NOW), true); // 旧的黑板课：kindOf 认成 class
});

test('下课后的助手：新课都归它；以前的舞台课没复盘的也归它，复盘过的不重跑；黑板课照旧走复盘', () => {
  const rep = { report: { at: 1, v: 2 }, status: 'closed' };
  const old = { id: 'c-20261112-1', kind: 'stage', ...rep };
  assert.equal(afterSession(old), true);
  assert.equal(needsAfter(old), true);
  assert.equal(needsDebrief(old), false);
  const done = { ...old, debrief: { v: 1 } };
  assert.equal(afterSession(done), false);
  assert.equal(needsAfter(done), false);
  const board = { id: 'c-2', kind: 'class', ...rep };
  assert.equal(afterSession(board), false);
  assert.equal(needsDebrief(board), true);
  assert.equal(needsAfter({ ...old, after: { fails: AFTER_FAILS } }), false); // 试满了：交给教研室
  assert.equal(needsAfter({ ...old, after: { fails: AFTER_FAILS - 1, tryAt: 1 } }), true);
  assert.equal(needsAfter({ ...old, report: { at: 1, provisional: true } }), false);
});
