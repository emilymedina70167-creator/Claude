// 检验英语：parse、translate、rewrite、discriminate 的两个按钮、errfind 的写法和判（计划 4 Task 6）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe, probeProblems, parseCheck, selfCheck } from '../kit/src/check/spec.js';
import { judgeMachine, itemLabel, claudeIds, verdictPrompt, teachFor, outcomeOf, bracketText } from '../kit/src/check/judge.js';
import { judgeSpans, parseBrackets } from '../kit/src/entext.js';

const P = (type, src) => { const r = parseProbe(type, src.trim()); if (r.error) throw new Error(r.error); return r.probe; };
const E = (type, src) => parseProbe(type, src.trim()).error || '';
const item = (r, id) => r.items.find((x) => x.id === id);
const pairs = (r) => r.items.map((x) => [x.id, x.ok]);

// —— parse ——
// The(0) houses(1) that(2) we(3) saw(4) were(5) painted(6) in(7) 1990(8) .(9)
const PARSE = `
id: p1
q: 标出句子的成分，从句标出来
key: [S The houses [RC that we saw]] [V were painted] [A in 1990].
target: 被动的谓语只标了 be
level: 方法
teach V: 被动语态的谓语是 be + 过去分词，两个词一起标。
teach default: 先找谓语。`;
const KEY = [{ role: 'S', from: 0, to: 4 }, { role: 'RC', from: 2, to: 4 }, { role: 'V', from: 5, to: 6 }, { role: 'A', from: 7, to: 8 }];

test('parse：读 key 的括号写法，每个成分一项（按句子先后），roles 不写照 key 里用到的', () => {
  const p = P('parse', PARSE);
  assert.equal(p.text, 'The houses that we saw were painted in 1990.');
  assert.deepEqual(p.spans.map((s) => [s.role, s.from, s.to]), KEY.map((s) => [s.role, s.from, s.to]));
  assert.deepEqual(p.roles.map((r) => r.key), ['S', 'RC', 'V', 'A']);
  assert.equal(p.facet, '能用');
  assert.deepEqual(claudeIds(p), []);
  const r = judgeMachine(p, { spans: KEY });
  assert.deepEqual(pairs(r), [['S', true], ['RC', true], ['V', true], ['A', true]]);
  assert.equal(r.needsClaude, false);
  assert.equal(outcomeOf(p, r.items).outcome, 'pass');
  // 宽严和一类 parse（judgeSpans）一样
  assert.equal(judgeSpans(KEY, parseBrackets(p.src.match(/key: (.*)/)[1]).spans).ok, true);
});

test('parse：被动谓语只标了 were → V 没标出来（说范围不对），那一段不再另列在「多标了」里', () => {
  const p = P('parse', PARSE);
  const mine = KEY.map((s) => (s.role === 'V' ? { role: 'V', from: 5, to: 5 } : s));
  const r = judgeMachine(p, { spans: mine });
  assert.equal(item(r, 'V').ok, 'missing');
  assert.match(item(r, 'V').why, /谓语的范围不对.*were/);
  assert.equal(item(r, 'extra'), undefined);
  assert.equal(r.items.filter((x) => x.id === 'V').length, 1);
  assert.equal(item(r, 'S').ok, true);
  assert.equal(r.stop, true);
  assert.equal(outcomeOf(p, r.items).outcome, 'fail');
  const t = teachFor(p, outcomeOf(p, r.items).failed, r.items);
  assert.equal(t.key, 'V');
  // 和 judgeSpans 一致：范围不一样就是漏了一个、多了一个
  const js = judgeSpans(mine, p.spans);
  assert.equal(js.missing.length, 1);
  assert.equal(js.extra.length, 1);
});

test('parse：没标的 missing、角色标错 false、多标的一项 extra；全空全 missing', () => {
  const p = P('parse', PARSE);
  const noRc = judgeMachine(p, { spans: KEY.filter((s) => s.role !== 'RC') });
  assert.deepEqual(pairs(noRc), [['S', true], ['RC', 'missing'], ['V', true], ['A', true]]);
  const role = judgeMachine(p, { spans: KEY.map((s) => (s.role === 'S' ? { ...s, role: 'O' } : s)) });
  assert.equal(item(role, 'S').ok, false);
  assert.equal(item(role, 'S').why, '这是主语，标成了宾语');
  const extra = judgeMachine(p, { spans: [...KEY, { role: 'O', from: 3, to: 3 }, { role: 'A', from: 8, to: 8 }] });
  assert.deepEqual(extra.items.filter((x) => x.ok !== true).map((x) => x.id), ['extra']);
  assert.match(item(extra, 'extra').why, /多标了：「we」（宾语）、「1990」（状语）/);
  const empty = judgeMachine(p, { spans: [] });
  assert.ok(empty.items.every((x) => x.ok === 'missing'));
  assert.equal(empty.items.length, 4);
});

test('parse：重复的角色 RC、RC2；补讲 RC2 找不到退回 RC；itemLabel 写角色的名字', () => {
  const p = P('parse', `
id: p2
key: [S The man [RC who called]] [V met] [O the woman [RC who left]].
roles: S=主语 V=谓语 O=宾语 RC=定语从句
target: x
level: 核心
teach RC: 定语从句跟在它修饰的名词后面。`);
  assert.deepEqual(p.spans.map((s) => s.role), ['S', 'RC', 'V', 'O', 'RC']);
  const mine = p.spans.filter((_, i) => i !== 4).map(({ role, from, to }) => ({ role, from, to }));
  const r = judgeMachine(p, { spans: mine });
  assert.deepEqual(pairs(r), [['S', true], ['RC', true], ['V', true], ['O', true], ['RC2', 'missing']]);
  assert.equal(teachFor(p, ['RC2'], r.items).key, 'RC');
  assert.equal(itemLabel(p, 'RC'), '定语从句');
  assert.equal(itemLabel(p, 'RC2'), '定语从句（第 2 个）');
  assert.equal(itemLabel(p, 'extra'), '多标的');
  assert.equal(bracketText(p.tokens, p.spans), '[S The man [RC who called]] [V met] [O the woman [RC who left]].');
  const vp = verdictPrompt({ probe: p, answer: { spans: mine } });
  assert.match(vp, /The man who called met the woman who left\./);
  assert.match(vp, /\[S The man \[RC who called\]\] \[V met\] \[O the woman who left\]/);
});

test('parse：写法错误', () => {
  assert.match(E('parse', 'id: p\ntarget: x\nlevel: 方法'), /key:/);
  assert.match(E('parse', 'id: p\ntarget: x\nlevel: 方法\nkey: [S The man gave'), /没有配对/);
  assert.match(E('parse', 'id: p\ntarget: x\nlevel: 方法\nkey: [S Tom] [V ran].\nmust: 谓语是 ran'), /parse 不写 must/);
});

// —— rewrite ——
const REWRITE = `
id: r1
q: 改成被动语态
text: They painted these houses in 1990.
has: were …ed => 被动语态的谓语是 be + 过去分词，主语是复数用 were
has: these houses => 原来的宾语 these houses 做主语
not: they => 被动句里不再有原来的主语 they
example: These houses were painted in 1990.
target: 被动语态忘了 be
level: 方法`;

test('rewrite：has / not 页面判（were …ed 对上）；都过、没写 must 直接过', () => {
  const p = P('rewrite', REWRITE);
  assert.equal(p.text, 'They painted these houses in 1990.');
  assert.deepEqual(p.has.map((h) => [h.id, h.frag]), [['h1', 'were …ed'], ['h2', 'these houses']]);
  assert.deepEqual(p.not.map((h) => [h.id, h.frag]), [['n1', 'they']]);
  assert.equal(p.facet, '能用');
  const ok = judgeMachine(p, { text: 'These houses were painted in 1990.' });
  assert.deepEqual(pairs(ok), [['h1', true], ['h2', true], ['n1', true]]);
  assert.equal(ok.needsClaude, false);
  assert.equal(ok.stop, false);
  const bad = judgeMachine(p, { text: 'These houses was painted in 1990.' });
  assert.equal(item(bad, 'h1').ok, false);
  assert.match(item(bad, 'h1').why, /be \+ 过去分词/);
  assert.equal(bad.stop, true);
  const kept = judgeMachine(p, { text: 'They were painted these houses in 1990.' });
  assert.equal(item(kept, 'n1').ok, false);
  assert.match(item(kept, 'n1').why, /不再有原来的主语/);
  assert.equal(kept.stop, true);
  assert.equal(itemLabel(p, 'h1'), '要有的写法 1');
  assert.equal(itemLabel(p, 'n1'), '不该有的写法');
});

test('rewrite：句首大写、弯引号、多空格、句末标点、缩写不影响 has / not', () => {
  const p = P('rewrite', REWRITE);
  for (const t of ['these houses   were painted in 1990', 'THESE HOUSES WERE PAINTED IN 1990!', '“These houses were painted in 1990.”', '  These  houses were\tpainted in 1990 . ']) {
    assert.deepEqual(pairs(judgeMachine(p, { text: t })), [['h1', true], ['h2', true], ['n1', true]], t);
  }
  const q = P('rewrite', `
id: r2
text: He is not a doctor.
has: isn't => 否定写成缩写也行
example: He isn't a doctor.
target: x
level: 基础`);
  assert.equal(item(judgeMachine(q, { text: 'He is not a doctor' }), 'h1').ok, true);
  assert.equal(item(judgeMachine(q, { text: 'He isn’t a doctor.' }), 'h1').ok, true);
  assert.equal(item(judgeMachine(q, { text: 'He was a doctor.' }), 'h1').ok, false);
});

test('rewrite：都过、写了 must → 交页面里的 Claude；没写的 has 也照样判', () => {
  const p = P('rewrite', `${REWRITE}\nmust: 被动语态是 be + 过去分词，be 跟着新的主语变`);
  const r = judgeMachine(p, { text: 'These houses were painted in 1990.' });
  assert.equal(r.needsClaude, true);
  assert.deepEqual(claudeIds(p), ['m1']);
  const empty = judgeMachine(p, { text: '' });
  assert.ok(empty.items.filter((x) => x.id.startsWith('h')).every((x) => x.ok === false));
  assert.equal(empty.needsClaude, false);
});

test('rewrite：example 不满足 has / 写了 not 自检报；写法错误', () => {
  const p = P('rewrite', REWRITE.replace('example: These houses were painted in 1990.', 'example: These houses was painted in 1990.'));
  assert.match(probeProblems(p).join('\n'), /example 不满足 h1（were …ed）/);
  const q = P('rewrite', REWRITE.replace('example: These houses were painted in 1990.', 'example: They had these houses were painted.'));
  assert.match(probeProblems(q).join('\n'), /example 写了 n1 不该有的（they）/);
  assert.deepEqual(probeProblems(P('rewrite', REWRITE)), []);
  assert.match(E('rewrite', REWRITE.replace(/example:.*\n/, '')), /example:/);
  assert.match(E('rewrite', REWRITE.replace(/text:.*\n/, '')), /text:/);
  assert.match(E('rewrite', REWRITE.replace(/^has:.*\n/gm, '').replace(/^not:.*\n/gm, '')), /has:/);
});

// —— discriminate 的两个按钮 ——
const DIS = `
id: d1
q: The boy running in the park is my brother. 里的 running 是谓语还是非谓语？
options: 谓语 | 非谓语
answer: 非谓语
must: 句子的谓语是 is，running 前面没有 be，是现在分词作定语
target: 把 -ing 当成谓语
level: 方法`;

test('discriminate 的 options：两个按钮，一项 pick；选对有 must → needsClaude，选错停下', () => {
  const p = P('discriminate', DIS);
  assert.deepEqual(p.options, ['谓语', '非谓语']);
  assert.equal(p.answer, '非谓语');
  assert.equal(p.facet, '能辨');
  const ok = judgeMachine(p, { pick: '非谓语', text: 'is 是谓语' });
  assert.deepEqual(pairs(ok), [['pick', true]]);
  assert.equal(ok.needsClaude, true);
  assert.equal(ok.stop, false);
  const bad = judgeMachine(p, { pick: '谓语', text: '' });
  assert.deepEqual(pairs(bad), [['pick', false]]);
  assert.equal(bad.stop, true);
  assert.equal(bad.needsClaude, false);
  assert.equal(itemLabel(p, 'pick'), '选哪个');
  const vp = verdictPrompt({ probe: p, answer: { pick: '非谓语', text: 'is 是谓语' } });
  assert.match(vp, /两个选项：谓语 \| 非谓语/);
  assert.match(vp, /学生选的：非谓语/);
  assert.doesNotMatch(vp, /他|她/);
});

test('discriminate 的 options：三个、一个、和 can 一起写、answer 不是其中一个都报；数学的 can 照旧', () => {
  assert.match(E('discriminate', DIS.replace('谓语 | 非谓语', '谓语 | 非谓语 | 都不是')), /options: 只收两个.*3 个/);
  assert.match(E('discriminate', DIS.replace('谓语 | 非谓语', '谓语')), /options: 只收两个.*1 个/);
  assert.match(E('discriminate', `${DIS}\ncan: 能`), /options: 和 can: 只写一个/);
  assert.match(E('discriminate', DIS.replace('answer: 非谓语', 'answer: 定语')), /answer: 写两个选项里的一个/);
  assert.match(E('discriminate', DIS.replace(/answer:.*\n/, '')), /answer:/);
  assert.match(E('discriminate', DIS.replace(/must:.*\n/, '')), /must:/);
  assert.match(E('discriminate', 'id: d\ntarget: x\nlevel: 方法\ncan: 能\nanswer: 能\nmust: 理由'), /answer: 只和 options: 一起写/);
  const m = P('discriminate', 'id: d\ntarget: x\nlevel: 方法\ncan: 能\nmust: 理由');
  assert.deepEqual(pairs(judgeMachine(m, { can: true })), [['can', true]]);
  assert.equal(m.options, undefined);
});

// —— errfind ——
// I(0) have(1) know(2) him(3) since(4) we(5) were(6) children(7) ,(8) and(9) I(10) know(11) his(12) family(13) well(14) .(15)
const ERR = `
id: e1
text: I have know him since we were children, and I know his family well.
word: know#1
fix: known | !knew=过去式不能接在 have 后面
decoys: have=have 是对的，现在完成时要 have + 过去分词; were=we were children 说的是过去，were 是对的
target: 现在完成时写成 have + 原形
level: 方法
teach decoy=have: 现在完成时的 have 没错，错在它后面的动词。`;

test('errfind：word: know#1 → 第 2 个记号；fix 对上 known（大小写、句末标点不管）', () => {
  const p = P('errfind', ERR);
  assert.equal(p.wordAt, 2);
  assert.equal(p.facet, '边界');
  assert.deepEqual(p.decoys.map((d) => [d.i, d.w]), [[1, 'have'], [6, 'were']]);
  const ok = judgeMachine(p, { word: 2, fix: 'Known.' });
  assert.deepEqual(pairs(ok), [['word', true], ['fix', true]]);
  assert.equal(ok.needsClaude, false);
  assert.equal(outcomeOf(p, ok.items).outcome, 'pass');
  const knew = judgeMachine(p, { word: 2, fix: 'knew' });
  assert.equal(item(knew, 'fix').ok, false);
  assert.match(item(knew, 'fix').why, /常见的错法「knew」：过去式不能接在 have 后面/);
  assert.equal(knew.stop, true);
  assert.match(item(judgeMachine(p, { word: 2, fix: 'knows' }), 'fix').why, /改得不对/);
  assert.match(item(judgeMachine(p, { word: 2, fix: '' }), 'fix').why, /没写改成什么/);
  assert.equal(itemLabel(p, 'word'), '错的词');
  assert.equal(itemLabel(p, 'fix'), '改法');
});

test('errfind：点了 decoy 的词 why 写那条、停下、补讲找 decoy=…；点了别的没错的词', () => {
  const p = P('errfind', ERR);
  const d = judgeMachine(p, { word: 1, fix: 'has' });
  assert.deepEqual(pairs(d), [['word', false]]);
  assert.match(item(d, 'word').why, /现在完成时要 have \+ 过去分词/);
  assert.equal(d.stop, true);
  assert.equal(teachFor(p, ['word'], d.items).key, 'decoy=have');
  const o = judgeMachine(p, { word: 11, fix: 'knew' });
  assert.match(item(o, 'word').why, /「know」用得没错/);
  assert.equal(o.stop, true);
  assert.equal(item(judgeMachine(p, {}), 'word').ok, false);
  const vp = verdictPrompt({ probe: { ...p, must: [{ id: 'm1', text: 'have 后面接过去分词' }] }, answer: { word: 1, fix: 'has', text: '' } });
  assert.match(vp, /I have know him since we were children/);
  assert.match(vp, /学生点的词：「have」（第 2 个词）/);
  assert.match(vp, /学生写的改法：has/);
});

test('errfind：fix 写删掉；写了 must 都过才交 Claude；写法错误', () => {
  const p = P('errfind', `
id: e2
text: He married with her last year.
word: with
fix: 删掉
target: x
level: 方法
must: marry 是及物动词，直接接宾语`);
  for (const f of ['删掉', 'del', '-', '（删）']) assert.equal(item(judgeMachine(p, { word: 2, fix: f }), 'fix').ok, true, f);
  assert.equal(judgeMachine(p, { word: 2, fix: '删' }).needsClaude, true);
  assert.deepEqual(claudeIds(p), ['m1']);
  assert.match(E('errfind', ERR.replace('know#1', 'know')), /word: know#2/);
  assert.match(E('errfind', ERR.replace('know#1', 'knowing')), /没有「knowing」/);
  assert.match(E('errfind', ERR.replace(/fix:.*\n/, '')), /fix:/);
  assert.match(E('errfind', ERR.replace(/text:.*\n/, '')), /text:/);
  assert.match(E('errfind', ERR.replace('have=have', 'have')), /decoys/);
});

// —— translate ——
const TR = `
id: t1
q: 翻译成中文
text: It is not until you lose your health that you realize how important it is.
must: 「直到……才……」的强调句译出来
must: how important it is 译成「它有多重要」
wrong: 译成「直到你失去健康，你意识到……」（没有「才」）
answer: 直到失去健康，你才意识到它有多重要。
target: 强调句没译出「才」
level: 核心`;

test('translate：照 recall 交页面里的 Claude；verdictPrompt 有原句、采分点、参考译文，没有「他」「她」', () => {
  const p = P('translate', TR);
  assert.equal(p.text, 'It is not until you lose your health that you realize how important it is.');
  assert.equal(p.facet, '能用');
  assert.deepEqual(claudeIds(p), ['m1', 'm2', 'w1']);
  assert.deepEqual(judgeMachine(p, { text: '直到失去健康你才知道它多重要' }), { items: [], needsClaude: true, stop: false });
  const vp = verdictPrompt({ probe: p, answer: { text: '直到失去健康你才知道它多重要' } });
  assert.match(vp, /原句：It is not until you lose your health/);
  assert.match(vp, /m1：「直到……才……」的强调句译出来/);
  assert.match(vp, /m2：how important it is/);
  assert.match(vp, /参考译文：直到失去健康，你才意识到它有多重要。/);
  assert.match(vp, /直到失去健康你才知道它多重要/);
  assert.doesNotMatch(vp, /他|她/);
  assert.match(E('translate', TR.replace(/text:.*\n/, '')), /text:/);
  assert.match(E('translate', TR.replace(/^must:.*\n/gm, '')), /must:/);
});

test('五种英语题放进 board check 里能过自检', () => {
  const F = '```';
  const body = [
    'block EN-L1.1 must=p1,r1',
    'spare d1, e1, t1',
    `${F}parse\n${PARSE.trim()}\nretry: p1a, p1b\n${F}`,
    `${F}parse\n${PARSE.trim().replace('id: p1', 'id: p1a')}\n${F}`,
    `${F}parse\n${PARSE.trim().replace('id: p1', 'id: p1b')}\n${F}`,
    `${F}rewrite\n${REWRITE.trim()}\nretry: r1a, r1b\nteach default: 先找谓语。\n${F}`,
    `${F}rewrite\n${REWRITE.trim().replace('id: r1', 'id: r1a')}\n${F}`,
    `${F}rewrite\n${REWRITE.trim().replace('id: r1', 'id: r1b')}\n${F}`,
    `${F}discriminate\n${DIS.trim()}\n${F}`,
    `${F}errfind\n${ERR.trim()}\n${F}`,
    `${F}translate\n${TR.trim()}\n${F}`,
  ].join('\n');
  const { check, errors } = parseCheck('check id=k1', body);
  assert.deepEqual(errors, []);
  assert.deepEqual(selfCheck(check), []);
});

// —— 复查修正：整词比、点了标点、改法带引号、要点编号和页面判的项撞了 ——

test('rewrite：has / not 按整词比（is 不对上 This、…ed 只接在挨着的词上、they 认 They\'re、was not 认 wasn\'t）', async () => {
  const { fragRe } = await import('../kit/src/check/spec.js');
  const mk = (lines) => P('rewrite', `id: r9\ntext: x\n${lines}\nexample: The houses were painted.\ntarget: x\nlevel: 基础`);
  const is = mk('has: is\nhas: houses');
  assert.equal(item(judgeMachine(is, { text: 'This house was red.' }), 'h1').ok, false);
  assert.equal(item(judgeMachine(is, { text: 'This house is red.' }), 'h1').ok, true);
  const were = mk('has: were …ed');
  assert.equal(item(judgeMachine(were, { text: 'This house were given a red card.' }), 'h1').ok, false);
  assert.equal(item(judgeMachine(were, { text: 'The houses were painted.' }), 'h1').ok, true);
  assert.equal(item(judgeMachine(mk('has: were ...ed'), { text: 'The houses were painted.' }), 'h1').ok, true);
  const they = mk('has: houses\nnot: they');
  assert.equal(item(judgeMachine(they, { text: 'They’re painted, the houses.' }), 'n1').ok, false);
  assert.equal(item(judgeMachine(they, { text: 'These houses were painted.' }), 'n1').ok, true, 'these 不是 they');
  const was = mk('has: houses\nnot: was not');
  assert.equal(item(judgeMachine(was, { text: "The houses wasn't painted." }), 'n1').ok, false);
  // 单独的 … 是中间隔 0～3 个词；| 是几种写法
  const gap = mk('has: were … painted | was … painted');
  assert.equal(item(judgeMachine(gap, { text: 'The houses were all freshly painted.' }), 'h1').ok, true);
  assert.equal(item(judgeMachine(gap, { text: 'The house was painted.' }), 'h1').ok, true);
  assert.equal(item(judgeMachine(gap, { text: 'The houses were one two three four painted.' }), 'h1').ok, false);
  assert.equal(fragRe('…'), null);
  assert.match(E('rewrite', 'id: r\ntext: x\nhas: …\nexample: y\ntarget: x\nlevel: 基础'), /片段里没有字/);
});

test('errfind：点了标点当没点词；改法带引号照认', () => {
  const p = P('errfind', ERR);
  const r = judgeMachine(p, { word: 8, fix: 'known' }); // 8 是逗号
  assert.equal(item(r, 'word').why, '没点错的词');
  const vp = verdictPrompt({ probe: { ...p, must: [{ id: 'm1', text: 'x' }] }, answer: { word: 8, fix: 'known' } });
  assert.match(vp, /学生没点词/);
  assert.doesNotMatch(vp, /学生点的词/);
  for (const f of ['"known"', '“known”', '‘known’', "'Known.'"]) assert.equal(item(judgeMachine(p, { word: 2, fix: f }), 'fix').ok, true, f);
});

test('手写的要点编号和页面判的项撞了报错', () => {
  assert.match(E('rewrite', `${REWRITE}\nmust h1: 被动`), /要点编号 h1 和页面判的项撞了/);
  assert.match(E('rewrite', `${REWRITE}\nwrong n2: 写了 they`), /要点编号 n2 和页面判的项撞了/);
  assert.match(E('errfind', `${ERR}\nmust word: have 后面接过去分词`), /要点编号 word 和页面判的项撞了/);
  assert.match(E('errfind', `${ERR}\nmust fix: x`), /要点编号 fix/);
  assert.match(E('discriminate', `${DIS}\nmust pick: x`), /要点编号 pick/);
  assert.match(E('parse', `${PARSE}\nmust extra: x`), /要点编号 extra/);
  assert.equal(E('rewrite', `${REWRITE}\nmust m1: 被动`), '');
});
