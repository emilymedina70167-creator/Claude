// 第十五轮（外部主 Claude 的修改意见第 4 节）：手册只写能做什么、写法、页面会怎么做。发布的那份（kit/dist/docs/CLAUDE-PROJECT.md：
// 第三节换成组件一览、第四节填进黑板指令）里不许有讲做法的词
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitProject, injectProtocol, PROTOCOL_MARK } from '../kit/build-split.js';
import { PROTOCOL_DOC, PROJECT_CLASS_DOC } from '../kit/src/class/prompt.js';

const src = readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
const WORDS = ['你应该', '必须先', '最重要', '推荐', '照做'];

test('发布的手册：第四节填进了黑板指令的写法', () => {
  assert.ok(src.includes(PROTOCOL_MARK), '仓库里的手册第四节留着标记');
  const main = injectProtocol(splitProject(src).main, `${PROTOCOL_DOC}\n\n${PROJECT_CLASS_DOC}`);
  assert.ok(!main.includes(PROTOCOL_MARK));
  for (const x of ['board new', 'board note', 'board memo', 'board aims']) assert.ok(main.includes(x), x);
});

test('发布的手册里没有讲做法的词', () => {
  const main = injectProtocol(splitProject(src).main, `${PROTOCOL_DOC}\n\n${PROJECT_CLASS_DOC}`);
  for (const w of WORDS) assert.ok(!main.includes(w), `手册里有「${w}」：${main.slice(Math.max(0, main.indexOf(w) - 60), main.indexOf(w) + 40)}`);
});
