// 点词查义（kit/src/dict.js）：变形还原、查词、词组
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normWord, ruleLemmas, lookupWord, lookupPhrases, wordsOf, shortMean } from '../kit/src/dict.js';

const dict = {
  w: { reader: 'n. 读者', know: 'v. 知道', known: 'a. 知名的', study: 'v. 学习', stop: 'v. 停止', make: 'v. 制造', primarily: 'adv. 主要地', account: 'n. 账户\nv. 解释', as: 'adv. 同样地', well: 'adv. 好' },
  p: { 'as well as': '也, 又', 'account for': '解释；占' },
  x: { readers: 'reader', known: 'know', made: 'make', accounted: 'account' },
};

test('规范：小写、弯撇号、所有格', () => {
  assert.equal(normWord('Readers'), 'readers');
  assert.equal(normWord('reader’s'), 'reader');
  assert.equal(normWord("'tis'"), 'tis');
});

test('按规则猜原形', () => {
  assert.ok(ruleLemmas('studies').includes('study'));
  assert.ok(ruleLemmas('stopped').includes('stop'));
  assert.ok(ruleLemmas('making').includes('make'));
  assert.deepEqual(ruleLemmas('is'), []);
});

test('查词：本身、变形表、规则', () => {
  assert.deepEqual(lookupWord(dict, 'Readers'), [{ head: 'reader', mean: 'n. 读者', of: 'readers' }]);
  // 自己也是词的变形：两条都给
  assert.deepEqual(lookupWord(dict, 'known').map((x) => x.head), ['known', 'know']);
  assert.deepEqual(lookupWord(dict, 'studies'), [{ head: 'study', mean: 'v. 学习', of: 'studies' }]);
  assert.deepEqual(lookupWord(dict, 'stopped')[0].head, 'stop');
  assert.deepEqual(lookupWord(dict, 'zzzz'), []);
  assert.deepEqual(lookupWord(null, 'reader'), []);
});

test('词组：点哪个词都认，第一个词的变形也认', () => {
  const s = wordsOf('Paid media, as well as owned media, accounted for most of it.').map((w) => w.word);
  const i = s.indexOf('well');
  assert.deepEqual(lookupPhrases(dict, s, i).map((x) => x.head), ['as well as']);
  assert.deepEqual(lookupPhrases(dict, s, s.indexOf('as')).map((x) => x.head), ['as well as']);
  assert.deepEqual(lookupPhrases(dict, s, s.indexOf('for')).map((x) => x.head), ['account for']);
  assert.deepEqual(lookupPhrases(dict, s, s.indexOf('Paid')), []);
});

test('切词和给老师的那句意思', () => {
  assert.deepEqual(wordsOf("It's a well-known fact — readers’ era").map((w) => w.word), ["It's", 'a', 'well-known', 'fact', 'readers', 'era']);
  assert.equal(shortMean([{ mean: 'n. 账户\nv. 解释' }]), 'n. 账户');
  assert.equal(shortMean([]), '');
});

// 真的词典（tools/dict-build.mjs 生成、提交在 kit/dist/dict/en.json）：课上问过的词都查得到
test('真词典：课上问过、点过的词都在', () => {
  const p = new URL('../kit/dist/dict/en.json', import.meta.url);
  const real = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.match(real.src, /ECDICT/);
  for (const w of ['instance', 'readers', 'cars', 'primarily', 'oxytocin', 'era', 'majority', 'immigrant', 'surrounded', 'known']) {
    assert.ok(lookupWord(real, w).length, `${w} 查不到`);
  }
  const s = ['as', 'well', 'as'];
  assert.ok(lookupPhrases(real, s, 1).some((x) => x.head === 'as well as'));
});
