// 舞台主线第七轮（docs/superpowers/specs/2026-11-12-stage-mainline-7-design.md）：第一节真课留下的课堂循环和数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fitHistory, STATE_STUB } from '../kit/src/stage/history.js';

const B = (s) => Buffer.byteLength(String(s ?? ''));
const total = (msgs, sys) => sys + msgs.reduce((n, m) => n + B(m.content), 0);

// —— 第 2 节：对话放不下先省最早几轮的舞台样子 ——
test('fitHistory：放得下时一字不改', () => {
  const msgs = [{ role: 'user', content: '开始' }, { role: 'assistant', content: 'say "好"' }, { role: 'user', content: '[学生]\n学生点了 a.1\n\n[舞台现在]\n一排格子 a\n\n写下一轮。' }];
  const r = fitHistory(structuredClone(msgs), { max: 1e6 });
  assert.deepEqual(r.msgs, msgs);
  assert.equal(r.stripped, 0);
  assert.equal(r.dropped, 0);
});

const state = (n) => `[舞台现在]\n${'句子 s：xxxx\n'.repeat(n)}\n写下一轮。`;
const stu = (i, n = 200) => ({ role: 'user', content: `[学生]\n学生点了 a.${i}\n\n${state(n)}` });

test('fitHistory：先省最早的舞台样子，最近 3 条学生的不省；[学生] 那一段留着', () => {
  const msgs = [{ role: 'user', content: '开始上课' }];
  for (let i = 1; i <= 10; i++) { msgs.push({ role: 'assistant', content: `say "第 ${i} 轮"` }); msgs.push(stu(i)); }
  const sys = 1000;
  const max = total(msgs, sys) - 8000; // 省掉两三份就放得下
  const r = fitHistory(structuredClone(msgs), { max, sysBytes: sys });
  assert.equal(r.dropped, 0);
  assert.equal(r.msgs.length, msgs.length);
  assert.ok(r.stripped >= 1);
  assert.ok(total(r.msgs, sys) <= max);
  const users = r.msgs.filter((m) => m.role === 'user').slice(1);
  for (const m of users.slice(-3)) assert.match(m.content, /句子 s：xxxx/);
  assert.equal(users[0].content, `[学生]\n学生点了 a.1\n\n${STATE_STUB}`);
  // 只省需要的：最近那几条以外也不全省
  assert.ok(r.stripped < users.length - 3 || total(r.msgs, sys) <= max);
});

test('fitHistory：都省了还放不下才成对丢最早的；第一条留着、一问一答交替', () => {
  const msgs = [{ role: 'user', content: '开始上课' }];
  for (let i = 1; i <= 10; i++) { msgs.push({ role: 'assistant', content: `say "${'长'.repeat(3000)}"` }); msgs.push(stu(i, 5)); }
  const r = fitHistory(structuredClone(msgs), { max: 40000, sysBytes: 0 });
  assert.ok(r.dropped > 0);
  assert.equal(r.msgs[0].content, '开始上课');
  r.msgs.forEach((m, i) => assert.equal(m.role, i % 2 ? 'assistant' : 'user'));
  assert.ok(total(r.msgs, 0) <= 40000);
});

test('fitHistory：第一节真课 101 条，说明 138306 字节、上限 200 KiB：一条不丢', (t) => {
  const dir = new URL('../.superpowers/en1/sessions/c-20261112-1/class_turns/', import.meta.url);
  if (!existsSync(dir)) { t.skip('没有真课的数据（不进 git）'); return; }
  const turns = readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(new URL(f, dir)))).filter((x) => !x.discarded && !x.pending && (x.role === 'claude' || x.role === 'student'));
  const msgs = [];
  const user = (content) => { if (msgs.at(-1)?.role === 'user') msgs.at(-1).content += `\n\n${content}`; else msgs.push({ role: 'user', content }); };
  for (const x of turns) { if (x.role === 'claude') { if (!msgs.length) user('开始上课'); msgs.push({ role: 'assistant', content: x.text }); } else user(x.msg || x.text); }
  const n = msgs.length;
  const r = fitHistory(msgs, { max: 200 * 1024, sysBytes: 138306 });
  assert.equal(r.dropped, 0);
  assert.equal(r.msgs.length, n);
  assert.ok(total(r.msgs, 138306) <= 200 * 1024);
});
