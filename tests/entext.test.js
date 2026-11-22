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

test('常见错答 !x=说明、选择式的空、errfind 的 decoys', async () => {
  const { parseCloze, parseAnswer, diagnose, parseChoices, parseDecoys, parseDrill } = await import('../kit/src/entext.js');
  const { actionText } = await import('../kit/src/class/prompt.js');
  const a = parseAnswer('had started | !has started=用成了现在完成时 | !started');
  assert.deepEqual(a.alts, ['had started']);
  assert.deepEqual(a.wrongs, [{ text: 'has started', why: '用成了现在完成时' }, { text: 'started', why: '' }]);
  assert.deepEqual(diagnose('Has  Started', a.wrongs), a.wrongs[0], '和对的答案一样宽松地比');
  assert.equal(diagnose('had begun', a.wrongs), null);
  assert.throws(() => parseAnswer('went | !went=x'), /和对的答案一样/);
  assert.throws(() => parseAnswer('went | !=x'), /! 后面写常见的错答/);
  const ch = parseChoices('that=逗号后面不用 that|*who|which');
  assert.deepEqual(ch.map((c) => [c.text, c.ok, c.why]), [['that', false, '逗号后面不用 that'], ['who', true, ''], ['which', false, '']]);
  assert.throws(() => parseChoices('that|who'), /用 \* 标出对的/);
  assert.throws(() => parseChoices('*that'), /至少要两个选项/);
  const c = parseCloze('A, {{[that=不用 that|*who]}} b {{has lived|!lives=要完成时}}.');
  assert.deepEqual(c.blanks, [['who'], ['has lived']]);
  assert.equal(c.specs[0].choices.length, 2);
  assert.deepEqual(c.specs[0].wrongs, [{ text: 'that', why: '不用 that' }]);
  assert.deepEqual(c.specs[1].wrongs, [{ text: 'lives', why: '要完成时' }]);
  assert.throws(() => parseCloze('x {{[a|b]}}'), /第 1 个空：选择式的空要用 \*/);
  const d = parseDecoys('Neither of the answers are correct.', 'Neither=neither 本身没错; the=冠词没错');
  assert.deepEqual(d.map((x) => [x.i, x.w]), [[0, 'Neither'], [2, 'the']]);
  assert.throws(() => parseDecoys('Neither of them is.', 'Neither'), /词=为什么它没错/);
  const items = parseDrill(['- They built it. => It was built. | !It built.=少了 be']);
  assert.deepEqual(items[0].wrongs, [{ text: 'It built.', why: '少了 be' }]);
  const t = actionText({ source: 'record', type: 'cloze', block: 'c1', step: 'b2', value: 'that | lives', ok: false, attempts: 1, detail: '第 1 空：不用 that', misread: '第 1 空写成「that」：不用 that' });
  assert.match(t, /页面看出来：第 1 空写成「that」/);
});

test('分步拆句 steps:、意群断句 chunk', async () => {
  const { parseSteps, parseBrackets, parseChunk, judgeChunks, chunkHint, chunksOf } = await import('../kit/src/entext.js');
  const { actionText } = await import('../kit/src/class/prompt.js');
  const ans = parseBrackets('[S The man [RC who lives next door]] [V gave] [IO me] [DO a book].');
  assert.deepEqual(parseSteps('V | S IO DO | RC', ans.spans), [['V'], ['S', 'IO', 'DO'], ['RC']]);
  assert.throws(() => parseSteps('V | AdvC', ans.spans), /第 2 步的 AdvC 在 answer 里没有标/);
  assert.throws(() => parseSteps('V | V S', ans.spans), /V 在 steps 里写了两次/);
  const c = parseChunk('The man who lives next door, / gave me a book / that I had wanted | for years.');
  assert.deepEqual([c.must, c.may], [[7, 11], [15]]);
  assert.equal(c.text, 'The man who lives next door, gave me a book that I had wanted for years.');
  assert.ok(judgeChunks([7, 11], c).ok);
  assert.ok(judgeChunks([7, 11, 15], c).ok, '| 的地方切不切都行');
  const r = judgeChunks([7, 9], c);
  assert.deepEqual([r.missing, r.extra], [[11], [9]]);
  assert.equal(chunkHint(r, c.tokens), '「book」后面还要切一刀；「me a」是一个意群，中间不用切');
  assert.deepEqual(chunksOf(c.tokens, [7, 11]), ['The man who lives next door,', 'gave me a book', 'that I had wanted for years.']);
  assert.throws(() => parseChunk('No cuts here.'), /用 \/ 标出要切的地方/);
  assert.match(actionText({ source: 'record', type: 'chunk', block: 'k1', detail: '译文', text: 'gave me a book → 给了我一本书' }), /按意群写的译文：\n.*给了我一本书/);
  assert.match(actionText({ source: 'record', type: 'parse', block: 'p2', value: '[S The man]', ok: false, attempts: 1, detail: '第 2 步（主语）', check: '1 处范围不对' }), /第 2 步（主语）：1 处范围不对/);
});

test('连线 link、phrase 带标点', async () => {
  const { parseLink, judgeLinks, linkHint, wordsIn, wordSpan } = await import('../kit/src/entext.js');
  const s = parseLink('My brother, who lives in Beijing, is a doctor.', 'who -> brother; !who -> Beijing=就近的名词不一定是先行词');
  assert.deepEqual(s.pairs, [{ from: 3, to: 1 }]);
  assert.deepEqual(s.wrongs, [{ from: 3, to: 6, why: '就近的名词不一定是先行词' }]);
  const bad = judgeLinks([{ from: 3, to: 6 }], s);
  assert.equal(linkHint(bad, s.tokens), '「who」连到「Beijing」不对：就近的名词不一定是先行词；还有 1 条没连');
  assert.ok(judgeLinks([{ from: 3, to: 1 }], s).ok);
  assert.throws(() => parseLink('He is here.', ''), /至少写一条/);
  assert.throws(() => parseLink('He is here.', 'He -> He'), /两头是同一个词/);
  assert.throws(() => parseLink('He is here.', 'He is'), /写成 词 -> 它连着的词/);
  const t = wordsIn('My brother, who lives in Beijing, is a doctor.', { punct: true }).map((x) => x.w);
  assert.deepEqual(wordSpan({ kind: 'phrase', text: ', who' }, t), { from: 2, to: 3 });
  assert.deepEqual(wordSpan({ kind: 'phrase', text: ',', n: 2 }, t), { from: 7, to: 7 });
  assert.equal(wordsIn('a, b').length, 2, '不带 punct 时只数词');
});

test('drill 拿不准时问 Claude：提示词带题目、答案、学生写的；回答读成 { ok, why }', async () => {
  const { regradePrompt, parseRegrade } = await import('../kit/src/entext.js');
  const p = regradePrompt({ q: 'They built it.', task: '改成被动', alts: ['It was built.'], given: 'It was built by them.' });
  assert.match(p, /原句：They built it\.[\s\S]*标准答案：It was built\.[\s\S]*学生写的：It was built by them\./);
  assert.ok(!/他|她/.test(p.replace(/其他/g, '')));
  assert.deepEqual(parseRegrade('好的 {"ok": true, "why": "加 by them 也对"}'), { ok: true, why: '加 by them 也对' });
  assert.equal(parseRegrade('看不懂'), null);
  assert.equal(parseRegrade('{"ok": "yes"}'), null);
});
