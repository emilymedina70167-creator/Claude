// 英语组件的判分和写法（entext.js）：填空、找错、成分标注、句型操练。组件的画面在浏览器里另外验（kit/examples/en-demo.html）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  normText, matchText, textHint, parseCloze, tokenizeSentence, findWrong, parseBrackets, judgeSpans, spanText, spansHint, parseRoles, parseDrill, joinWords,
} = await import('../kit/src/entext.js');

test('比对：大小写、弯引号、空格、缩写、句末标点都不算错；词不对说第几个词', () => {
  assert.equal(normText('  I DON’T  know . '), 'i do not know.');
  assert.ok(matchText("doesn't", 'does not').ok);
  assert.ok(matchText('Can not', 'cannot').ok);
  assert.ok(matchText('won’t', 'will not').ok);
  assert.ok(matchText('has been living', 'has lived | has been living').ok);
  assert.ok(matchText('This bridge was built in 1990', 'This bridge was built in 1990.', { sentence: true }).ok);
  const r = matchText('This bridge is built in 1990.', 'This bridge was built in 1990.', { sentence: true });
  assert.equal(r.ok, false);
  assert.equal(r.at, 3);
  assert.equal(textHint(r), '从第 3 个词开始不对');
  const cs = matchText('london', 'London', { caseSensitive: true });
  assert.equal(cs.near, true);
  assert.equal(textHint(cs), '词都对了，大小写或标点不对');
  assert.equal(matchText('  ', 'a').empty, true);
});

test('填空：{{答案}}，几种写法 | 隔开；没有空、空着、括号不配对都报错', () => {
  const c = parseCloze('By the time we arrived, the film {{had started}} (start). She {{has lived|has been living}} here.');
  assert.equal(c.blanks.length, 2);
  assert.deepEqual(c.blanks[1], ['has lived', 'has been living']);
  assert.equal(c.parts[0].text, 'By the time we arrived, the film ');
  assert.throws(() => parseCloze('no blanks here'), /要有空/);
  assert.throws(() => parseCloze('a {{}} b'), /没写答案/);
  assert.throws(() => parseCloze('a {{x b'), /没有配对/);
});

test('切词：缩写、连字符、所有格算一个词，标点单独', () => {
  const t = tokenizeSentence("Tom's well-known book doesn't sell, does it?");
  assert.deepEqual(t.map((x) => x.w), ["Tom's", 'well-known', 'book', "doesn't", 'sell', ',', 'does', 'it', '?']);
  assert.deepEqual(t.filter((x) => !x.word).map((x) => x.i), [5, 8]);
  assert.equal(joinWords(t.map((x) => x.w)), "Tom's well-known book doesn't sell, does it?");
});

test('找错：wrong 定位到第几个词；出现两次要写 #2', () => {
  assert.equal(findWrong('Neither of the answers are correct.', 'are'), 4);
  assert.equal(findWrong('He go to school and he go home.', 'go#2'), 6);
  assert.throws(() => findWrong('He go to school and he go home.', 'go'), /出现了 2 次/);
  assert.throws(() => findWrong('He goes.', 'went'), /没有「went」/);
});

test('成分标注：括号能套从句；判分分出对的、成分错的、少的、多的', () => {
  const p = parseBrackets('[S The man [RC who lives next door]] [V gave] [IO me] [DO a book].');
  assert.equal(p.text, 'The man who lives next door gave me a book.');
  assert.deepEqual(p.spans.map((s) => [s.role, s.from, s.to]), [['S', 0, 5], ['RC', 2, 5], ['V', 6, 6], ['IO', 7, 7], ['DO', 8, 9]]);
  assert.equal(spanText(p.tokens, p.spans[1]), 'who lives next door');
  const all = judgeSpans(p.spans, p.spans);
  assert.equal(all.ok, true);
  const mine = [{ role: 'S', from: 0, to: 1 }, { role: 'V', from: 6, to: 6 }, { role: 'O', from: 7, to: 7 }];
  const r = judgeSpans(mine, p.spans);
  assert.equal(r.ok, false);
  assert.equal(r.right.length, 1);
  assert.deepEqual(r.wrongRole.map((x) => x.should), ['IO']);
  assert.equal(r.extra.length, 1);
  assert.equal(r.missing.length, 3);
  assert.equal(spansHint(r, parseRoles('S V IO DO')), '对了 1 处；1 处范围对了、成分标错了（宾语）；1 处范围不对；还少 3 处');
  // 标点不算进成分的尾巴
  assert.deepEqual(parseBrackets('[S Tom ,] [V left].').spans[0], { role: 'S', from: 0, to: 0, depth: 0 });
  assert.throws(() => parseBrackets('[S The man'), /没有配对/);
  assert.throws(() => parseBrackets('The man] left'), /多了一个 \]/);
  assert.throws(() => parseBrackets('no brackets'), /要用 \[角色/);
  assert.deepEqual(parseRoles('S=主语 RC=定语从句').map((x) => x.name), ['主语', '定语从句']);
  assert.deepEqual(parseRoles('', ['S', 'V']).map((x) => x.name), ['主语', '谓语']);
});

test('句型操练：一行一题，=> 后面是答案', () => {
  const d = parseDrill(['- They built this bridge in 1990. => This bridge was built in 1990.', '- People say he is rich. => He is said to be rich. | It is said that he is rich.', 'not an item']);
  assert.equal(d.length, 2);
  assert.equal(d[1].alts.length, 2);
  assert.throws(() => parseDrill(['nothing']), /一行一题/);
});
