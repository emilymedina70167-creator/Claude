// 舞台上的课发给老师的说明（kit/src/stage/doc.js）：说明里的例子照抄就能演；不用「他」「她」；每一轮的那条写清楚学生做了什么、舞台现在什么样、哪几行没演
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_TEACH, STAGE_DOC, stageSystem, firstMessage, turnMessage, TOPICS } from '../kit/src/stage/doc.js';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { COMMANDS, parseScript } from '../kit/src/stage/script.js';
import { TYPES } from '../kit/src/stage/types/index.js';

const bytes = (s) => Buffer.byteLength(s);

test('说明里提到学生不用「他」「她」', () => {
  for (const t of [STAGE_TEACH, STAGE_DOC, ...Object.values(TOPICS).map((x) => x.topic + x.material)]) assert.doesNotMatch(t, /[他她]/);
});

test('说明不长（每一轮都带）：教法 + 指令 ≤ 9 KB', () => {
  assert.ok(bytes(STAGE_TEACH + STAGE_DOC) <= 9 * 1024, `现在 ${bytes(STAGE_TEACH + STAGE_DOC)} 字节`);
});

test('说明里的例子照抄就能演：例子那一轮，和每一条「指令 …」开头的写法', () => {
  const ex = STAGE_DOC.split('例子（一轮）：\n')[1];
  const s = new Scene();
  const setup = 'array a = 49 38 65 97 76 13 27 49′ 55 04\ndial d = 5 range=1-5 at=a';
  assert.deepEqual(dryRun(s, `${setup}\n${ex}`), []);
  // 每一行指令说明的第一段（「 / 」前、两个空格前）都能在这块舞台上演。
  // 一排格子以外的各种东西（树、图……）的那一节，由它自己的测试在摆好它的舞台上照抄来演（tests/stage-tree.test.js 等）
  const others = new Set(Object.values(TYPES).filter((t) => t !== TYPES.array).flatMap((t) => (t.doc || '').split('\n')));
  const lines = STAGE_DOC.split('\n').filter((l) => !others.has(l)).map((l) => l.split(/\s{2,}|\s\/\s/)[0].trim()).filter((l) => COMMANDS.has(l.split(' ')[0]) && !l.startsWith('array'));
  const ready = new Scene();
  for (const src of [setup, 'label t a.1 "字"', 'say "看 [不稳定]"']) for (const c of parseScript(src)) ready.apply(c);
  const bad = [];
  for (const l of lines) { const e = dryRun(ready, l); if (e.length) bad.push(`${l} → ${e[0].error}`); }
  assert.deepEqual(bad, []);
  assert.ok(lines.length >= 25, `说明里的指令 ${lines.length} 条`);
});

test('第一轮：教法、指令、这节课、资料都在；舞台是空的、要以 ask 结尾', () => {
  const m = firstMessage(TOPICS.bsearch);
  assert.ok(m.includes(STAGE_TEACH) && m.includes(STAGE_DOC));
  assert.match(m, /## 这节课\n数据结构 · 折半查找/);
  assert.match(m, /## 资料/);
  assert.match(m, /舞台现在是空的/);
  assert.doesNotMatch(stageSystem({ topic: 'x' }), /## 资料/);
});

test('每一轮：学生做了什么、上一轮没演的行（第几行、原文、为什么）、舞台现在', () => {
  const m = turnMessage({ act: '学生点了 a.4（97）', state: '一排格子 a', errors: [{ line: 3, src: 'swap a.1', error: 'swap 要正好两格' }] });
  assert.match(m, /^\[学生\]\n学生点了 a\.4（97）/);
  assert.match(m, /第 3 行「swap a\.1」：swap 要正好两格/);
  assert.match(m, /\[舞台现在\]\n一排格子 a/);
  assert.match(m, /写下一轮。$/);
  assert.doesNotMatch(turnMessage({ act: 'x', state: 'y' }), /没演的行/);
});
