// 每晚的定时任务就是项目 Claude（第十四轮任务 15）：提示词只写事实——东西在哪、怎么读写、写了记 journal；做什么由它定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORBIDDEN } from '../kit/src/project/system.js';
import { TODAY_KINDS } from '../kit/src/project/today.js';

const text = readFileSync(new URL('../docs/lab-prompt.md', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

test('每晚的提示词：项目指令、笔记本、journal、今天的写法都在，只写事实', () => {
  for (const x of ['meta/instructions', 'notebook', 'journal/', '"by": "night"', 'meta/today', 'dev_requests', 'CLAUDE-PROJECT.md']) assert.ok(text.includes(x), x);
  assert.ok(text.includes(TODAY_KINDS.join(' | ')), '今天的 kind 和首页认的一样');
  for (const w of FORBIDDEN) assert.ok(!text.includes(w), w);
  assert.ok(!/lab_brief|lab_inbox|单子/.test(text), '旧的单子做法不在了');
});
