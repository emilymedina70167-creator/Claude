import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkScenario } from '../tools/teach-sim-lib.mjs';

const dir = new URL('../evals/teaching/scenarios/', import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
test('一共 10 个场景', () => assert.equal(files.length, 10));
for (const f of files) test(`场景 ${f} 守规矩`, () => {
  const sc = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
  assert.deepEqual(checkScenario(sc), []);
  const given = JSON.stringify(sc.pack);
  for (const p of sc.posttest) assert.ok(!given.includes(p.q), `课后题 ${p.id} 是资料包里的原题`);
});
test('三种学生用同一套资料包和课后题', () => {
  const r = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
  const [a, b, c] = [r('os-lru.json'), r('os-lru.zero.json'), r('os-lru.half.json')];
  assert.deepEqual(a.pack, b.pack); assert.deepEqual(a.pack, c.pack);
  assert.deepEqual(a.posttest, b.posttest); assert.deepEqual(a.posttest, c.posttest);
  assert.notEqual(a.persona, b.persona); assert.notEqual(a.persona, c.persona);
});
test('记忆样例不带个人信息', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../evals/teaching/memory/before.json', import.meta.url), 'utf8'));
  assert.ok(m.rules.length > 30 && m.lessons.length > 10 && m.asks.length > 5);
  assert.ok(!/加州|@|大学读/.test(JSON.stringify(m)));
});
