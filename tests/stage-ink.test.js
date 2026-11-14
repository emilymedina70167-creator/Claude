// 舞台上用 Apple Pencil 直接写、附图（2026-11-14）：只有 Pencil 落在空处才写；发给老师的那一句写着手写和附图；证据里也记
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkStarts, INK_PASS } from '../kit/src/stage/stageink.js';
import { actText } from '../kit/src/stage/stage.js';
import { actEvidence } from '../kit/src/stage/evidence.js';

const target = (passes) => ({ closest: (sel) => (sel === INK_PASS && passes ? {} : null) });

test('只有 Pencil 写字：手指、落在按钮输入框上的 Pencil 都不写', () => {
  assert.equal(inkStarts({ pointerType: 'pen', button: 0, target: target(false) }), true);
  assert.equal(inkStarts({ pointerType: 'touch', button: 0, target: target(false) }), false);
  assert.equal(inkStarts({ pointerType: 'mouse', button: 0, target: target(false) }), false);
  assert.equal(inkStarts({ pointerType: 'pen', button: 0, target: target(true) }), false);
  assert.equal(inkStarts({ pointerType: 'pen', button: 2, target: target(false) }), false); // 笔上的侧键
});

test('发给老师：只写了字、附了图、说了话又写了字', () => {
  assert.match(actText({ type: 'say', text: '', ink: true }), /Pencil 在画面上写了字.*画面图/);
  assert.match(actText({ type: 'say', text: '', images: 2 }), /附了 2 张图/);
  const both = actText({ type: 'say', text: '我算到这里了', ink: true, images: 1 });
  assert.match(both, /^学生说：「我算到这里了」；/);
  assert.match(both, /写了字/);
  assert.match(both, /附了 1 张图/);
  assert.equal(actText({ type: 'say', text: '没懂' }), '学生说：「没懂」');
});

test('证据里那一句写着在画面上写了字、附了图', () => {
  assert.match(actEvidence({ type: 'say', text: '', ink: true, images: 1 }).say, /写了字.*附了 1 张图/);
  assert.equal(actEvidence({ type: 'say', text: '好' }).say, '好');
});
