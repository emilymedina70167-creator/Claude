// 舞台上的课发给老师的说明（kit/src/stage/doc.js）：说明里的例子照抄就能演；不用「他」「她」；每一轮的那条写清楚学生做了什么、舞台现在什么样、哪几行没演
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_TEACH, STAGE_DOC, STAGE_COMMON, stageSystem, firstMessage, turnMessage, TOPICS } from '../kit/src/stage/doc.js';
import { TYPES } from '../kit/src/stage/types/index.js';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { COMMANDS, parseScript } from '../kit/src/stage/script.js';

const bytes = (s) => Buffer.byteLength(s);

test('说明里提到学生不用「他」「她」', () => {
  for (const t of [STAGE_TEACH, STAGE_DOC, ...Object.values(TOPICS).map((x) => x.topic + x.material)]) assert.doesNotMatch(t, /[他她]/);
});

test('说明不长（每一轮都带）：教法 + 指令 ≤ 24 KB（说明长短不影响出第一个字的快慢，docs/talk-plan.md 量过；这里防的是写成长篇）', () => {
  assert.ok(bytes(STAGE_TEACH + STAGE_DOC) <= 24 * 1024, `现在 ${bytes(STAGE_TEACH + STAGE_DOC)} 字节`);
});

test('说明里的例子照抄就能演：例子那一轮；共用的每一条写法；每一种东西那一节的每一条写法', () => {
  const ex = STAGE_DOC.split('例子（一轮）：\n')[1];
  assert.deepEqual(dryRun(new Scene(), ex), []);
  // 一条说明的第一段（「 / 」前、两个空格前）都能演
  // 引号外面的第一个「两个以上空格」或「 / 」之前是写法，后面是说明
  const head = (l) => { let q = null; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === q) q = null; continue; } if (ch === '"') { q = '"'; continue; } if (ch === '「') { q = '」'; continue; } if (l.startsWith('  ', i) || l.startsWith(' / ', i)) return l.slice(0, i).trim(); } return l.trim(); };
  const firsts = (doc) => doc.split('\n').map(head).filter((l) => COMMANDS.has(l.split(' ')[0]));
  const ready = (src) => { const sc = new Scene(); for (const c of parseScript(src)) if (c.cmd !== 'ask') sc.apply(c); return sc; };
  const bad = [];
  // 共用的：在一排格子上演（先造好拨数、贴好字、说一句带 [词] 的话）
  const base = ready('array a = 49 38 65 97 76 13 27 49′ 55 04\ndial d = 5 range=1-5 at=a\nlabel t a.1 "字"\nsay "看 [不稳定]"');
  for (const l of firsts(STAGE_COMMON)) { const e = dryRun(base, l); if (e.length) bad.push(`${l} → ${e[0].error}`); }
  // 每一种东西：在它自己的例子演完的舞台上演（造它的那一行另外再演一遍也行）
  let n = 0;
  for (const t of Object.values(TYPES)) {
    if (!t.doc) continue;
    assert.ok(t.example, `${t.label}要有能照抄的例子`);
    assert.deepEqual(dryRun(new Scene(), t.example), [], `${t.label}的例子`);
    const sc = ready(`${t.example}\ndial d = 5 range=1-5`);
    for (const l of firsts(t.doc)) { n++; const e = dryRun(sc, l); if (e.length) bad.push(`${t.label}：${l} → ${e[0].error}`); }
  }
  assert.deepEqual(bad, []);
  assert.ok(n >= 10, `各种东西的说明里一共 ${n} 条写法`);
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
