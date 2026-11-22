// 去限制设计第 5 步：说明书不再发布。接口卡 meta/interface 从代码生成、只写事实；报错里写正确的写法和组件认的字段
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interfaceDoc } from '../kit/src/project/iface.js';
import { LAB_API, frameDoc } from '../kit/src/htmlseg.js';
import { inProblems } from '../kit/src/class/ext.js';
import { fieldHint, fieldHintText } from '../kit/src/subject.js';
import { COLLECTIONS } from '../kit/src/memory/schema.js';

const WORDS = ['你应该', '应该', '必须', '最重要', '推荐', '照做', '先读', '记得', '不要', '别'];

test('接口卡：6 条，取值从 schema 来，只写事实', () => {
  const d = interfaceDoc({ version: '2026-11-22x' });
  assert.equal(d.facts.length, 6);
  assert.deepEqual(d.facts.map((f) => f.what), ['开一节', '一轮写在哪', '自由段', 'lab 桥', '作答从哪读回来', '下课']);
  assert.equal(d.facts[0].doc.kind, 'ext');
  assert.ok(COLLECTIONS.sessions.enums.kind.includes('ext'));
  assert.equal(d.facts[0].doc.space, COLLECTIONS.sessions.enums.space.join(' | '));
  assert.match(d.text, /组件库 2026-11-22x/);
  assert.match(d.text, /board close/);
  assert.match(d.text, /sessions\/\{编号\}\/ext_in\/\{三位序号\}/);
  for (const w of WORDS) assert.ok(!d.text.includes(w), `接口卡里有讲做法的「${w}」`);
  assert.ok(!d.text.includes('CLAUDE-PROJECT'), '不指说明书');
});

test('lab 桥：接口卡列的函数和框里 window.lab 的一样', () => {
  const doc = frameDoc({ html: '', nonce: 'n' });
  const lab = doc.slice(doc.indexOf('window.lab = {'));
  const body = lab.slice(0, lab.indexOf('\n  };'));
  const have = [...body.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(have.sort(), LAB_API.map((x) => x.name).sort());
  const text = interfaceDoc().text;
  for (const x of LAB_API) assert.ok(text.includes(`lab.${x.call}`), x.name);
});

test('ext_in 写错：报错里写正确的写法', () => {
  const a = inProblems({ seq: 3 }, '003');
  assert.match(a.error, /ext_in\/003 没有 text：写成 \{ seq: 3, text: /);
  const b = inProblems({ seq: 2, text: ['x'] }, '002');
  assert.match(b.error, /写的是 数组/);
  const c = inProblems({ text: 'hi' }, '004');
  assert.equal(c.error, '');
  assert.match(c.notes[0], /没写 seq，按文档编号排的先后：写成 \{ seq: 4, text \}/);
  assert.deepEqual(inProblems({ seq: 1, text: '' }, '001'), { error: '', notes: [] });
});

const md = readFileSync(new URL('../kit/components.md', import.meta.url), 'utf8').split('\n');
const s3 = md.findIndex((l) => /^##\s*三/.test(l));
const DOCS = md.slice(s3 + 1, md.findIndex((l, i) => i > s3 && /^##\s*四/.test(l))).join('\n');

test('组件写错：附上它认的字段和一个能照抄的例子（从组件手册里的例子收）', () => {
  const h = fieldHint(DOCS, 'answer', '线代');
  for (const f of ['q', 'answer', 'type', 'formula', 'let']) assert.ok(h.fields.includes(f), f);
  assert.match(h.example, /^```answer\n[\s\S]*\n```$/);
  const t = fieldHintText(h);
  assert.match(t, /^answer 认的字段：/);
  assert.match(t, /例子：\n```answer/);
  // 这门课没有的组件、不是组件名的：不附
  assert.equal(fieldHint(DOCS, 'sort', '线代'), null);
  assert.ok(fieldHint(DOCS, 'sort', '数据结构').fields.includes('algo'));
  assert.equal(fieldHint(DOCS, '公式', '线代'), null);
  assert.equal(fieldHintText(null), '');
});
