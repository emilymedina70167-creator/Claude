// 矛盾修复 T1：「看答案」几次出、同一个错答案连点算不算新的一次，全部作答组件同一个规矩（照第 4 批起的新规矩）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { REVEAL_TRIES, canReveal, sameWrong } from '../kit/src/tries.js';

test('三次没对才出「看答案」', () => {
  assert.equal(REVEAL_TRIES, 3);
  assert.equal(canReveal(2), false);
  assert.equal(canReveal(3), true);
});

test('同一个错答案连着再交不算新的一次；改了、对了、换了以后再交照算', () => {
  const r = sameWrong();
  assert.equal(r.repeat('a'), false);
  r.after('a', false);
  assert.equal(r.repeat('a'), true, '同一个错答案');
  assert.equal(r.repeat('b'), false, '改了');
  r.after('b', false);
  assert.equal(r.repeat('a'), false, '改回以前错过的那个，中间交过别的：算新的一次');
  r.after('a', true);
  assert.equal(r.repeat('a'), false, '对了以后不拦');
  r.after('c', null);
  assert.equal(r.repeat('c'), false, '页面判不了的不拦');
});

// 结构上守着：会出「看答案」的组件都照 tries.js 算，不再各写各的 2 / 3
const SRC = new URL('../kit/src/', import.meta.url);
const files = ['stepper.js', 'graph.js', 'space.js', ...readdirSync(new URL('blocks/', SRC)).map((f) => `blocks/${f}`)].filter((f) => f.endsWith('.js'));
test('组件里不再写死「几次以后看答案」', () => {
  const bad = [];
  for (const f of files) {
    const s = readFileSync(new URL(f, SRC), 'utf8');
    if (/(attempts|tries)\s*(>=|<)\s*[23]\b/.test(s)) bad.push(`${f}：写死了次数`);
    if (/const\s+TRIES\s*=\s*\d/.test(s)) bad.push(`${f}：自己定了 TRIES`);
    if (/看答案|en-show|sv-reveal|sv-fill-reveal|fb-show|pl-show|ed-wshow/.test(s) && /(attempts|tries)\s*(\+\+|\+=)/.test(s) && !/from '\.\.?\/(\.\.\/)?tries\.js'/.test(s)) bad.push(`${f}：没用 tries.js`);
  }
  assert.deepEqual(bad, []);
});

test('每个数次数的检查都先问一句是不是同一个错答案', () => {
  const bad = [];
  for (const f of files) {
    const s = readFileSync(new URL(f, SRC), 'utf8');
    const lines = s.split('\n');
    lines.forEach((ln, i) => {
      if (!/\b(attempts|tries)\s*\+\+/.test(ln)) return;
      const before = lines.slice(Math.max(0, i - 12), i + 1).join('\n');
      if (!/\.repeat\(|lastWrong|wrongPairs|sameAs/.test(before)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('quiz 的「看解析」也是三次没对才出（以前错一次就出）', () => {
  const s = readFileSync(new URL('blocks/quiz.js', SRC), 'utf8');
  assert.match(s, /canReveal\(tries\)/);
});
