// 科目：组件说明按科目挑、教法按科目换（kit/src/subject.js、class/prompt.js 的 defaultRules）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subjectKey, isCS, docsForSubject, parseTag, SUBJECTS, sectionNames, componentDoc, detailNames, allNames } from '../kit/src/subject.js';
import { componentDocs } from '../kit/build-docs.js';
import { buildSystem, defaultRules, DEFAULT_RULES, bytes, lintDocs, docLookup, packComponents, DETAIL_BUDGET } from '../kit/src/class/prompt.js';

const PROJECT = readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
const DOCS = componentDocs(PROJECT);
const KiB = 1024;

test('科目的写法：中英文、简称都认，不认识的是空', () => {
  assert.equal(subjectKey('线性代数'), '线代');
  assert.equal(subjectKey(' 数据结构 '), '数据结构');
  assert.equal(subjectKey('DS'), '数据结构');
  assert.equal(subjectKey('计算机组成原理'), '组成原理');
  assert.equal(subjectKey('计组'), '组成原理');
  assert.equal(subjectKey('Operating Systems'), '操作系统');
  assert.equal(subjectKey('计算机网络'), '计网');
  assert.equal(subjectKey('概率论'), '');
  assert.equal(subjectKey(undefined), '');
  assert.ok(isCS('os') && !isCS('线性代数') && !isCS(''));
  assert.deepEqual(parseTag('<!-- 科目：数据结构 操作系统 -->'), ['数据结构', '操作系统']);
  assert.deepEqual(parseTag('<!--科目:计组、计算机网络-->'), ['组成原理', '计网']);
  assert.equal(parseTag('<!-- 别的注释 -->'), null);
});

test('按科目挑小节：没标的通用，标了的只给那几门课；代码块里的 ### 不算', () => {
  const md = [
    '开头的话', '',
    '### a：通用', 'a 的内容', '',
    '### b：线代的', '', '<!-- 科目：线代 -->', '', 'b 的内容', '```x', '### 代码里的标题', '<!-- 科目：计网 -->', '```', '',
    '### c：数据结构和操作系统', '<!-- 科目：数据结构 操作系统 -->', 'c 的内容', '',
    '### d：又是通用', 'd 的内容',
  ].join('\n');
  const la = docsForSubject(md, '线性代数');
  assert.match(la, /a 的内容[\s\S]*b 的内容[\s\S]*### 代码里的标题\n<!-- 科目：计网 -->[\s\S]*d 的内容/);
  assert.doesNotMatch(la, /c 的内容/);
  assert.doesNotMatch(la, /^<!-- 科目：线代 -->$/m, '标记行去掉');
  const os = docsForSubject(md, '操作系统');
  assert.match(os, /a 的内容[\s\S]*c 的内容[\s\S]*d 的内容/);
  assert.doesNotMatch(os, /b 的内容/);
  assert.match(os, /^开头的话/);
  // 不认识的科目：全留着
  const all = docsForSubject(md, '概率论');
  for (const x of ['a', 'b', 'c', 'd']) assert.match(all, new RegExp(`${x} 的内容`));
  assert.doesNotMatch(all, /\n{3,}/);
});

test('真的组件说明：线代课没有排序，数据结构课没有 scene / matrix，通用的都在', () => {
  const la = docsForSubject(DOCS, '线代');
  const ds = docsForSubject(DOCS, '数据结构');
  assert.match(la, /### scene/);
  assert.match(la, /### matrix/);
  assert.doesNotMatch(la, /### 排序/);
  assert.match(ds, /### 排序/);
  assert.doesNotMatch(ds, /### scene|### matrix|### graph|### space|### rref|### steps 联动/);
  for (const d of [la, ds]) {
    for (const h of ['### answer', '### steps', '### practice', '### quiz', '### derive', '### sketch', '### 公式里的三个工具', '### recognize', '### findbug', '### 其他组件']) {
      assert.ok(d.includes(h), `缺 ${h}`);
    }
    assert.doesNotMatch(d, /^<!-- 科目/m, "标记行都去掉了");
  }
  assert.ok(bytes(ds) < bytes(DOCS), '计算机课的说明比全部的短');
});

test('教法按科目：线代照旧，计算机课不附英文、要用演示组件；都不用「他」「她」', () => {
  assert.equal(defaultRules('线性代数'), DEFAULT_RULES);
  assert.equal(defaultRules('概率论'), DEFAULT_RULES, '不认识的科目用线代那套');
  const cs = defaultRules('数据结构');
  assert.notEqual(cs, DEFAULT_RULES);
  assert.equal(cs.split('教法：')[0], DEFAULT_RULES.split('教法：')[0], '红线一样');
  assert.match(DEFAULT_RULES, /附英文/);
  assert.match(cs, /不用附英文/);
  assert.match(cs, /演示组件/);
  assert.match(cs, /王道/);
  const he = /(?<!其)[他她]/;
  for (const s of SUBJECTS.map(defaultRules)) {
    assert.deepEqual(s.split('\n').filter((l) => he.test(l.replace(/不用「他」「她」/g, ''))), []);
  }
});

test('课堂说明按科目拼：每门课加上最大的资料包都不超过 160 KiB', () => {
  const pack = { main: { unit: 'u', textbook: '教材原文。'.repeat(300 * KiB / 15) }, problems: { items: [] } };
  for (const subject of SUBJECTS) {
    const sys = buildSystem({ componentDocs: DOCS, pack, board: [], subject });
    assert.ok(bytes(sys) < 160 * KiB, `${subject}：说明 ${bytes(sys)} 字节`);
    // 资料包以外的部分（红线、组件说明、指令）长了，资料包让一点；但至少给资料包留 96 KiB
    const rest = bytes(buildSystem({ componentDocs: DOCS, pack: {}, board: [], subject }));
    assert.ok(rest < 160 * KiB - 96 * KiB, `${subject}：资料包以外 ${rest} 字节，留给资料包的不到 96 KiB`);
  }
  const ds = buildSystem({ componentDocs: DOCS, pack: {}, board: [], subject: '数据结构' });
  assert.match(ds, /### 排序/);
  assert.match(ds, /不用附英文/);
  const la = buildSystem({ componentDocs: DOCS, pack: {}, board: [] });
  assert.doesNotMatch(la, /### 排序/, '不写科目就是线代');
});

test('完整写法：精简版一直带着，后半段按名字取；写错了附上', () => {
  const md = [
    '### elim：消元', '<!-- 科目：线代 -->', '', 'elim 的精简', '', '<!-- 完整写法 -->', '', 'elim 的完整', '```elim', '<!-- 完整写法 -->', '```', '',
    '### sched / paging：操作系统', '<!-- 科目：操作系统 -->', 'sched 的精简', '<!-- 完整写法 -->', 'sched 的完整', '',
    '### answer：作答', 'answer 的内容', '',
    '### answer 的线代写法：基', '<!-- 科目：线代 -->', '线代的 answer', '<!-- 完整写法 -->', '线代 answer 的完整', '',
    '### 公式里的三个工具：`\\calc`、`\\hl`', '工具',
  ].join('\n');
  assert.deepEqual(sectionNames('### sched / paging / banker：操作系统的过程'), ['sched', 'paging', 'banker']);
  assert.deepEqual(sectionNames('### trace：代码逐行跟踪（真的把 C 代码跑一遍）'), ['trace']);
  assert.deepEqual(sectionNames('### 公式里的三个工具：`\\calc`、`\\hl`'), ['calc', 'hl']);
  const la = docsForSubject(md, '线代');
  assert.match(la, /elim 的精简\n\n（更多写法：component_doc 取 elim）/);
  assert.doesNotMatch(la, /elim 的完整|线代 answer 的完整|sched/);
  assert.doesNotMatch(la, /完整写法 -->/);
  assert.match(docsForSubject(md, '线代', { lookup: false }), /elim 的精简\n\n（还有更多写法）/);
  // 点名的带完整写法；代码块里的标记不算
  const named = docsForSubject(md, '线代', { full: ['elim'] });
  assert.match(named, /elim 的完整\n```elim\n<!-- 完整写法 -->\n```/);
  assert.doesNotMatch(named, /线代 answer 的完整/);
  assert.match(docsForSubject(md, '线代', { full: true }), /线代 answer 的完整/);
  // 按名字取：同名的小节拼起来，只要这门课的
  assert.match(componentDoc(md, 'answer', '线代'), /answer 的内容[\s\S]*线代的 answer\n\n?线代 answer 的完整/);
  assert.equal(componentDoc(md, 'answer', '操作系统'), '### answer：作答\nanswer 的内容');
  assert.match(componentDoc(md, 'paging', '操作系统'), /sched 的精简\nsched 的完整/);
  assert.equal(componentDoc(md, 'paging', '线代'), null);
  assert.match(componentDoc(md, '公式里', '线代'), /工具/, '中文名按标题找');
  assert.deepEqual(detailNames(md, '线代'), ['elim', 'answer']);
  assert.deepEqual(allNames(md, '操作系统'), ['sched', 'paging', 'answer', 'calc', 'hl']);
  // 页面：写错的组件附完整写法（没有完整写法的不附）；工具找不到时列出有哪些
  const lint = lintDocs(md, '线代', ['elim', 'ELIM', 'scene']);
  assert.match(lint, /^【elim 的完整写法】\n### elim：消元[\s\S]*elim 的完整/);
  assert.equal(lint.match(/【/g).length, 1);
  assert.match(docLookup(md, '线代', 'elim'), /elim 的完整/);
  assert.throws(() => docLookup(md, '线代', 'foo'), /没有叫「foo」的组件（这门课有：elim、answer、calc、hl）/);
  assert.deepEqual(packComponents({ main: { components: 'elim, det、`eig` elim' } }), ['elim', 'det', 'eig']);
  assert.deepEqual(packComponents({ main: { components: ['Quad'] } }), ['quad']);
  assert.deepEqual(packComponents({}), []);
});

test('真的组件说明：每门课系统里的组件说明 ≤ 40 KiB；资料包点名全部组件也不超', () => {
  for (const subject of SUBJECTS) {
    const d = docsForSubject(DOCS, subject);
    assert.ok(bytes(d) <= 40 * KiB, `${subject}：组件说明 ${bytes(d)} 字节，超过 40 KiB`);
    const names = detailNames(DOCS, subject);
    for (const n of names) assert.ok(componentDoc(DOCS, n, subject), `${subject} 的 ${n} 取不到`);
    const pack = { main: { components: names, textbook: '教材原文。'.repeat(300 * KiB / 15) } };
    const sys = buildSystem({ componentDocs: DOCS, pack, board: [], subject });
    assert.ok(bytes(sys) < 160 * KiB, `${subject}：说明 ${bytes(sys)} 字节`);
    const rest = bytes(buildSystem({ componentDocs: DOCS, pack: { main: { components: names } }, board: [], subject }));
    assert.ok(rest < 160 * KiB - 96 * KiB + DETAIL_BUDGET, `${subject}：点名组件以后资料包以外 ${rest} 字节`);
  }
});
