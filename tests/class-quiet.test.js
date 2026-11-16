// 不打扰：学生正在写、翻到了别的板时，页面不替学生滚、不翻板
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldScroll } from '../kit/src/class/quiet.js';

test('学生没在写、看着当前板：照常滚到新内容', () => assert.equal(shouldScroll({ writing: false, away: false }), true));
test('学生正在写：不滚', () => assert.equal(shouldScroll({ writing: true, away: false }), false));
test('学生翻到了别的板：不拉回来', () => assert.equal(shouldScroll({ writing: false, away: true }), false));
test('两样都占：不滚；什么都不传当作能滚', () => { assert.equal(shouldScroll({ writing: true, away: true }), false); assert.equal(shouldScroll(), true); });
