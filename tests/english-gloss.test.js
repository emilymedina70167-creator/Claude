// 英语组件第 7 批：要背的写进内容（==…==、\bei、remember 框、mark part=）、生词（gloss、点过的词进记忆点）、翻译按要点判
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { mdToHtml } = await import('../kit/src/render.js');
const { parsePoints, judgeTranslation, translationHint, parseGloss, glossMatches } = await import('../kit/src/entext.js');
const { parseMarkSpec, markWhere } = await import('../kit/src/markspec.js');
const { glossedWords, vocabRecalls, VOCAB_PER_SESSION, wordChips } = await import('../kit/src/memory/vocab.js');
const { buildReport, reportText } = await import('../kit/src/memory/report.js');
const { calloutsIn } = await import('../kit/src/memory/sheet.js');
const { actionText, actionTrigger } = await import('../kit/src/class/prompt.js');
const { checkMemory } = await import('../kit/src/memory/check.js');

test('要背的：==…== 和公式外面的 \\bei{…} 画成荧光底；公式里的 \\bei 是 data-lkbei；a == b 这种不动', () => {
  const r = (s) => mdToHtml(s, { inline: true });
  assert.equal(r('第三人称单数：==he / she / it=='), '第三人称单数：<mark class="lk-bei">he / she / it</mark>');
  assert.equal(r('==**be** 除外==，其余加 -s'), '<mark class="lk-bei"><strong>be</strong> 除外</mark>，其余加 -s');
  assert.equal(r('\\bei{不定代词}'), '<mark class="lk-bei">不定代词</mark>');
  assert.match(r('$\\bei{x^2}$'), /data-lkbei="1"/);
  assert.equal(r('if a == b then'), 'if a == b then');
  assert.equal(r('`==x==` 代码里不动'), '<code>==x==</code> 代码里不动');
  assert.match(r('==含公式 $a^2$=='), /^<mark class="lk-bei">含公式 <span class="katex">/);
});

test('remember 框进「这节课的一页」', () => {
  const md = '讲解\n\n```remember\ntitle: 第三人称单数\n- he / she / it\n- 不定代词\n```\n';
  assert.deepEqual(calloutsIn(md), [{ kind: 'remember', title: '第三人称单数', md: '- he / she / it\n- 不定代词' }]);
});

test('mark part=：段里第几部分 / 第几到第几部分；写错了说怎么写', () => {
  const a = parseMarkSpec('target=b4 part=2-4').spec;
  assert.deepEqual(a.sel, { kind: 'part', a: 2, b: 4 });
  assert.equal(a.style, 'box');
  assert.equal(markWhere(a), 'b4 里第 2–4 部分');
  assert.deepEqual(parseMarkSpec('target=b4 part=3 color=pink').spec.sel, { kind: 'part', a: 3, b: 3 });
  assert.match(parseMarkSpec('target=b4 part=4-2').error, /part 后面写/);
});

test('翻译按要点：都译出来算对；缺的只说英文；常见误译有提示；顺序；空的不算一次', () => {
  const spec = parsePoints(['- by 1830 = 到…为止 | 截至', '- had become = 已经 | 已', '- independent nations = 独立', '- !开始变成 = had become 是「已经成为」'], 'by 1830 < had become');
  assert.deepEqual(spec.problems, []);
  assert.equal(spec.points.length, 3);
  const ok = judgeTranslation('到 1830 年为止，以前西班牙和葡萄牙的殖民地已经成为独立的国家。', spec);
  assert.ok(ok.ok);
  assert.equal(translationHint(ok, 3), '要点 3 / 3');
  const bad = judgeTranslation('在1830年，以前的殖民地开始变成独立的区域', spec);
  assert.ok(!bad.ok);
  assert.deepEqual(bad.missing, ['by 1830', 'had become']);
  assert.equal(bad.misread, 'had become 是「已经成为」');
  assert.match(translationHint(bad, 3), /要点 1 \/ 3：had become 是「已经成为」；「by 1830」、「had become」的意思还没译出来/);
  // 没有误译提示时，缺的要点只说英文，不把中文说法露出来
  const miss = judgeTranslation('以前的殖民地成了独立的国家', spec);
  assert.doesNotMatch(translationHint(miss, 3), /到…为止|截至|已经/);
  const ord = judgeTranslation('殖民地已经独立了，到1830年为止', spec);
  assert.deepEqual(ord.orderBad, ['by 1830', 'had become']);
  assert.ok(judgeTranslation('  ', spec).empty);
  // 写法错误：没有要点、要点没写中文、order 写了不认识的
  assert.match(parsePoints([]).problems.join(), /至少要有一个要点/);
  assert.match(parsePoints(['- 只有英文']).problems.join(), /要写成/);
  assert.match(parsePoints(['- a = 甲'], 'a < b').problems.join(), /order/);
});

test('生词：读 gloss 块；在英文里找词（认 -s / -ed / -ing，词组中间空白不论，不分大小写，不匹配半个词）', () => {
  const g = parseGloss('breakthrough = 突破\nas well as = 和……一样\npredict = 预言\n- rise: 上涨');
  assert.deepEqual(g.items.map((x) => x.word), ['breakthrough', 'as well as', 'predict', 'rise']);
  assert.deepEqual(g.problems, []);
  assert.match(parseGloss('乱写').problems[0], /一行写一个/);
  const ms = glossMatches('Pearson also Predicts a breakthrough, as  well as others; prices rise. Surprise!', g.items);
  assert.deepEqual(ms.map((m) => m.item.word), ['predict', 'breakthrough', 'as well as', 'rise']);
  assert.equal(glossMatches('enterprise', g.items).length, 0);
});

const gl = (word, gloss, at, session = 'c-20261104-1') => ({ id: `ev-${word}-${at}`, src: 'event', kind: 'gloss', session, at, detail: { word, gloss } });

test('点过的生词：下课进记忆点（同一个词不重复、在记的不再加、一节课最多 20 个），自检干净', () => {
  const evs = [gl('breakthrough', '突破', 1), gl('Breakthrough', '突破', 2), gl('instance', '例子', 3), gl('other', 'x', 4, 'c-other')];
  assert.deepEqual(glossedWords(evs, 'c-20261104-1').map((w) => w.word), ['breakthrough', 'instance']);
  const recall = [{ id: 'K3', q: 'instance', a: '例子', kind: 'word', tier: 3, status: 'active' }];
  const out = vocabRecalls({ evidence: evs, recall, session: { id: 'c-20261104-1', block: 'EN-L1.2.1', space: 'en' }, now: Date.parse('2026-11-04T10:00:00+08:00') });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'K4');
  assert.deepEqual({ q: out[0].doc.q, a: out[0].doc.a, kind: out[0].doc.kind, tier: out[0].doc.tier, block: out[0].doc.block, space: out[0].doc.space, last: out[0].doc.last }, { q: 'breakthrough', a: '突破', kind: 'word', tier: 1, block: 'EN-L1.2.1', space: 'en', last: '2026-11-04' });
  const many = Array.from({ length: 30 }, (_, i) => gl(`word${String.fromCharCode(97 + (i % 26))}${i}`, '意思', i));
  assert.equal(vocabRecalls({ evidence: many, recall: [], session: { id: 'c-20261104-1' } }).length, VOCAB_PER_SESSION);
  const mem = { recall: [...recall, ...out.map((r) => ({ id: r.id, ...r.doc }))], curriculum: [{ id: 'EN-L1.2.1', title: '时态' }], sessions: [{ id: 'c-20261104-1', date: '2026-11-04' }], evidence: evs };
  const res = checkMemory(mem, { today: '2026-11-04' });
  assert.deepEqual(res.problems.filter((p) => p.coll === 'recall' && !p.soft), []);
});

test('课后报告列出查过的生词；给课堂 Claude 的报告里也有', () => {
  const r = buildReport({ session: { id: 'c-20261104-1' }, evidence: [gl('breakthrough', '突破', 1), gl('breakthrough', '突破', 2), gl('instance', '例子', 3)] });
  assert.deepEqual(r.words, [{ word: 'breakthrough', gloss: '突破' }, { word: 'instance', gloss: '例子' }]);
  assert.match(reportText(r), /点开看过意思的生词（不认识的）：breakthrough、instance/);
});

test('课堂：点开生词不单独调用，跟着下一条说；翻译的作答原文给老师', () => {
  const g = { source: 'event', type: 'gloss', detail: { word: 'breakthrough', gloss: '突破' } };
  assert.equal(actionTrigger(g), 'later');
  assert.match(actionText(g), /点开了生词「breakthrough」看意思（突破）/);
  const t = { source: 'record', type: 'translate', q: 'By 1830 …', value: '在1830年，殖民地开始变成独立国家', ok: false, attempts: 1, detail: '要点 1 / 3：「by 1830」的意思还没译出来' };
  assert.equal(actionTrigger(t), 'soon');
  assert.match(actionText(t), /\[作答\].*翻译.*译成「在1830年，殖民地开始变成独立国家」.*页面按要点判：要点 1 \/ 3/);
});

test('以前的课里查过的生词：一个词一个，已经在要记的里的标出来（作废的不算）', () => {
  const chips = wordChips([{ word: 'Meeting', gloss: '会议' }, { word: 'meeting', gloss: '会议' }, { word: 'plan', gloss: '计划' }, { word: 'task', gloss: '任务' }, { word: '' }],
    [{ id: 'K1', q: 'meeting', a: '会议', status: 'active' }, { id: 'K2', q: 'plan', a: '计划', status: 'void' }]);
  assert.deepEqual(chips, [{ word: 'Meeting', gloss: '会议', in: true }, { word: 'plan', gloss: '计划', in: false }, { word: 'task', gloss: '任务', in: false }]);
});
