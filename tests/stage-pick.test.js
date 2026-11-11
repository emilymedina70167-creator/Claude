// 照拨盘挑一个（主线第二轮 C）：{t: 甲 | 乙 | 丙} 的读法、查法、现在是哪一段
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePick, splitPicks, hasPick, checkPick, pickNow, fillPicks, pickDeps, varText, dialSteps } from '../kit/src/stage/pick.js';

const T = { v: 2, lo: 1, hi: 3, options: ['过去', '现在', '将来'] };
const Z = { v: 1, lo: 1, hi: 2, options: ['一般', '进行'] };
const K = { v: 0, lo: -1, hi: 1 };
const vars = new Map([['t', T], ['z', Z], ['k', K]]);

test('读法：{名字: 段 | 段}；没有 | 的、别的 {…} 不是', () => {
  assert.deepEqual(parsePick('t: was holding | am holding | will be holding'), { name: 't', alts: ['was holding', 'am holding', 'will be holding'] });
  assert.equal(parsePick('k'), null);
  assert.equal(parsePick('a.3'), null);
  assert.equal(parsePick('A + B'), null);
  assert.equal(parsePick('x: y'), null);
  // 空的一段也行（这个状态没有这个词）；全角的冒号、竖线也认
  assert.deepEqual(parsePick('t： | not｜never').alts, ['', 'not', 'never']);
  const ps = splitPicks('I {t: was | am | will be} here, {k} 个。');
  assert.deepEqual(ps.map((p) => p.k), ['text', 'pick', 'text']);
  assert.equal(ps[1].raw, '{t: was | am | will be}');
  assert.equal(ps[2].v, ' here, {k} 个。');
  assert.equal(hasPick('第 {k} 个'), false);
  assert.equal(hasPick('{t: a | b | c}'), true);
});

test('现在是哪一段：拨词的照第几个词，拨数的从 range 的头一个数起；套一层', () => {
  assert.equal(varText(T), '现在');
  assert.equal(varText(K), '0');
  assert.deepEqual(dialSteps(K), { n: 3, i: 1 });
  assert.equal(fillPicks('I {t: was holding | am holding | will be holding} it.', vars), 'I am holding it.');
  assert.equal(fillPicks('{k: 负 | 零 | 正}', vars), '零');
  const nested = '{t: {z: held | was holding} | {z: hold | am holding} | {z: will hold | will be holding}}';
  assert.equal(fillPicks(nested, vars), 'hold');
  assert.equal(fillPicks(nested, new Map([['t', { ...T, v: 1 }], ['z', { ...Z, v: 2 }]])), 'was holding');
  assert.deepEqual(pickDeps(`x ${nested} y {k: a | b | c}`).sort(), ['k', 't', 'z']);
  // 拨盘不在：照原文留着（写下时另外报）
  assert.equal(fillPicks('{q: a | b}', vars), '{q: a | b}');
});

test('查：名字要是拨盘、段数要对、最多套一层、段里不能有别的 {…}', () => {
  const chk = (s) => checkPick(splitPicks(s).find((p) => p.k === 'pick'), vars);
  assert.doesNotThrow(() => chk('{t: a | b | c}'));
  assert.throws(() => chk('{q: a | b}'), /没有叫「q」的拨盘/);
  assert.throws(() => chk('{t: a | b}'), /写了 2 段，拨盘 t 能拨到 3 个（过去 \/ 现在 \/ 将来）/);
  assert.throws(() => chk('{k: a | b}'), /写了 2 段，拨盘 k 能拨到 3 个（-1～1）/);
  assert.doesNotThrow(() => chk('{t: {z: a | b} | c | d}'));
  assert.throws(() => chk('{t: {z: {k: 1 | 2 | 3} | b} | c | d}'), /最多套一层/);
  assert.throws(() => chk('{t: {t: a | b | c} | c | d}'), /另一个拨盘/);
  assert.throws(() => chk('{t: {a.3} | b | c}'), /只能写字/);
  assert.throws(() => checkPick({ name: 'h', alts: ['a', 'b'] }, new Map([['h', { v: 0.5, lo: 0, hi: 1 }]])), /不是一格一格的整数/);
});

// —— 场景这一半 ——
const { Scene, dryRun } = await import('../kit/src/stage/scene.js');
const { parseScript, parseRich } = await import('../kit/src/stage/script.js');
await import('../kit/src/stage/types/index.js');
const run = (s, src, extra = {}) => { for (const c of parseScript(src)) s.apply({ ...c, ...extra }); return s; };
const make = (src) => run(new Scene(), src);
const wordsOf = (s, id) => [...s.objects.get(id).words].sort((a, b) => a.slot - b.slot).map((w) => w.value).join(' ');

test('能拨字的拨盘：dial t = 现在 options="…"；set t 将来；现状写词；只能拨到写了的词', () => {
  const s = make('dial t = 现在 options="过去 现在 将来"');
  const x = s.vars.get('t');
  assert.deepEqual([x.v, x.lo, x.hi, x.options], [2, 1, 3, ['过去', '现在', '将来']]);
  assert.match(s.stateText(), /能拨的数：t = 现在（过去 \/ 现在 \/ 将来）/);
  run(s, 'set t 将来');
  assert.equal(s.vars.get('t').v, 3);
  assert.match(dryRun(s, 'set t 未来')[0].error, /t 只能拨到：过去、现在、将来/);
  // 不写起头的词从第一个起；range= 和 options= 只能写一个；词不能重、至少两个
  assert.equal(make('dial u options="a b"').vars.get('u').v, 1);
  assert.match(dryRun(new Scene(), 'dial t = 现在 options="过去 现在" range=1..2')[0].error, /range= 和 options= 只能写一个/);
  assert.match(dryRun(new Scene(), 'dial t = 以后 options="过去 现在"')[0].error, /「以后」不在 options/);
  assert.match(dryRun(new Scene(), 'dial t options="过去"')[0].error, /至少两个/);
  assert.match(dryRun(new Scene(), 'dial t options="a b a"')[0].error, /重了/);
  // 没写 options= 的拨盘一点不变
  const k = make('dial k = 2 range=1..5');
  assert.equal(k.vars.get('k').options, undefined);
  assert.match(k.stateText(), /能拨的数：k = 2（1～5）/);
});

test('审查盯 4：能拨字的拨盘在只认数的地方当场报，不默默当成数', () => {
  const s = make('dial t = 现在 options="过去 现在 将来"\narray a = 5 3 8 1\nmatrix M = 1 2 / 3 4');
  assert.match(dryRun(s, 'matrix N = {t + 1} 2 / 3 4')[0].error, /t 是拨词的拨盘/);
  assert.match(dryRun(s, 'group a stride=t')[0].error, /拨词的拨盘/);
  assert.match(dryRun(s, 'ask value "几？" answer={t}')[0].error, /拨词的拨盘/);
  assert.match(dryRun(s, 'goal g "x" when="{t + 1} = 3"')[0].error, /拨词的拨盘/);
});

test('挑战里比拨盘的词：when="t = 将来"；只能比一样不一样，词要是拨得到的', () => {
  const s = make('dial t = 现在 options="过去 现在 将来"');
  assert.match(dryRun(s, 'goal g "x" when="t = 未来"')[0].error, /拨不到「未来」/);
  assert.match(dryRun(s, 'goal g "x" when="t > 现在"')[0].error, /只能比一样不一样/);
  assert.match(dryRun(s, 'goal g "x" when="t = 现在"')[0].error, /现在就已经成立/);
  run(s, 'goal g1 "拨到将来" when="t = 将来"\ngoal g2 "离开现在" when="t != 现在"');
  assert.match(s.stateText(), /g1[^\n]*还没做到（t = 将来 ✗）/);
  const fx = s.apply(parseScript('set t 将来')[0], { by: 'student' });
  assert.deepEqual(fx.goalsMet.sort(), ['g1', 'g2']);
});

test('话、贴的字、挑战的字里的 {t: …} 和 {t}：写下时查；parseRich 交 pick', () => {
  assert.deepEqual(parseRich('I {t: was | am | will be} here {t}').map((p) => p.k), ['text', 'pick', 'text', 'var']);
  const s = make('dial t = 现在 options="过去 现在 将来"\narray a = 1 2');
  assert.equal(dryRun(s, 'label n a "{t}：{t: 做过了 | 正在做 | 还没做}"\nsay "时间是{t: 昨天 | 今天 | 明天}。"\ngoal g "拨到{t: 过去 | 现在 | 将来}以外" when="t != 现在"').length, 0);
  assert.match(dryRun(s, 'label n a "{t: 做过了 | 正在做}"')[0].error, /写了 2 段，拨盘 t 能拨到 3 个/);
  assert.match(dryRun(s, 'say "{q: a | b}"')[0].error, /没有叫「q」的拨盘/);
  // 重放旧课不查
  assert.doesNotThrow(() => run(s.clone(), 'say "{q: a | b}"', { lenient: true, replay: true }));
});

test('句子跟着拨盘变：造出来是现在那一段；拨了照 rewrite 重排、别的词的编号不变；拨回去变回来', () => {
  const s = make('dial t = 现在 options="过去 现在 将来"\nsentence s = "I {t: was holding | am holding | will be holding} it steady."');
  assert.equal(wordsOf(s, 's'), 'I am holding it steady');
  const keys = () => Object.fromEntries(s.objects.get('s').words.map((w) => [w.value, w.key]));
  const k0 = keys();
  const fx = s.apply(parseScript('set t 过去')[0], { by: 'student' });
  assert.equal(wordsOf(s, 's'), 'I was holding it steady');
  // 没变的词（连那一段里一样的 holding）编号不变
  for (const w of ['I', 'holding', 'it', 'steady']) assert.equal(keys()[w], k0[w], w);
  // 画面照 rewrite 演：交出去掉的、新来的
  const r = fx.binds.find((b) => b.id === 's');
  assert.deepEqual([r.removed.length, r.added.length], [1, 1]);
  run(s, 'set t 将来');
  assert.equal(wordsOf(s, 's'), 'I will be holding it steady');
  run(s, 'set t 现在');
  assert.equal(wordsOf(s, 's'), 'I am holding it steady');
  for (const w of ['I', 'holding', 'it', 'steady']) assert.equal(keys()[w], k0[w], w);
  // 现状里说它跟着谁、现在是哪一段
  assert.match(s.stateText(), /跟着拨盘变：\{t: was holding \| am holding \| will be holding\} 现在是「am holding」/);
  // 克隆以后照样跟
  const c = s.clone();
  run(c, 'set t 过去');
  assert.equal(wordsOf(c, 's'), 'I was holding it steady');
  assert.equal(wordsOf(s, 's'), 'I am holding it steady');
});

test('审查盯 3：句子重排以后学生拉的括号照 rewrite 的规矩留；key= 里写同样的 {t: …} 跟着换；key 对不上的状态写下时当场报', () => {
  const src = 'dial t = 现在 options="过去 现在 将来"\nsentence s = "I {t: was holding | am holding | will be holding} it steady." key="[S I] [V {t: was holding | am holding | will be holding}] [O it] steady."\nopen s mark';
  const s = make(src);
  // 学生拉了主语、谓语两道括号
  s.apply(parseScript('mark s.1 S')[0], { by: 'student', open: 'mark' });
  s.apply(parseScript('mark s.2-3 V')[0], { by: 'student', open: 'mark' });
  run(s, 'set t 将来');
  const o = s.objects.get('s');
  const span = (m) => m.keys.map((k) => o.words.find((w) => w.key === k)?.value).join(' ');
  // 主语那道还在；谓语那道正好圈着 {…} 那一整段：跟着那一段走（头上的 am 换成了 will）
  assert.deepEqual(o.marks.map(span), ['I', 'will be holding']);
  run(s, 'set t 过去');
  assert.deepEqual(o.marks.map(span), ['I', 'was holding']);
  // 只圈了半段的（只圈 was）：那个词换掉了，括号照 rewrite 的规矩收掉，不留一道指着别的词的
  const half = make(src);
  half.apply(parseScript('mark s.2 V')[0], { by: 'student', open: 'mark' });
  run(half, 'set t 将来');
  assert.deepEqual(half.objects.get('s').marks.length, 0);
  // key 跟着换：现在的谓语是 was holding，没有作废
  assert.equal(o.key.void, undefined);
  assert.ok(o.key.spans.some((sp) => sp.role === 'V' && span(sp) === 'was holding'));
  assert.doesNotMatch(s.stateText(), /key：作废/);
  // key 里没写 {t: …}：拨到别的词就对不上——写下时当场报（哪个状态对不上）
  const bad = dryRun(new Scene(), 'dial t = 现在 options="过去 现在 将来"\nsentence s = "I {t: was | am | will be} here." key="[S I] [V am] here."');
  assert.match(bad[0].error, /t 拨到「过去」时 key= 对不上/);
  // 改写、挪词以后不再跟着拨盘（rewrite 换了整句、move 改了先后：再照模板重排会把它们冲掉），现状里写明
  const m = make(src);
  run(m, 'rewrite s "I held it steady."');
  run(m, 'set t 过去');
  assert.equal(wordsOf(m, 's'), 'I held it steady');
  assert.match(m.stateText(), /不再跟着拨盘 t 变（rewrite 换了整句；/);
});

test('句子里 {t: …} 的写法查：要和别的词用空格隔开；每个状态最多 40 个词', () => {
  assert.match(dryRun(new Scene(), 'dial t options="a b"\nsentence s = "I walk{t: ed | s} home."')[0].error, /用空格隔开/);
  assert.match(dryRun(new Scene(), 'sentence s = "I {t: was | am} here."')[0].error, /没有叫「t」的拨盘/);
});

test('拨盘同名重造：跟着它的句子照新的那一个词重排；段数对不上了当场报（不留一句读不成的）', () => {
  const s = make('dial t = 现在 options="过去 现在 将来"\nsentence s = "I {t: was | am | will be} here."\nlabel n s "{t: 昨天 | 今天 | 明天}"');
  // 换了起头的词：句子跟着换
  const fx = s.apply(parseScript('dial t = 将来 options="过去 现在 将来"')[0]);
  assert.equal(wordsOf(s, 's'), 'I will be here');
  assert.ok((fx.binds || []).some((b) => b.id === 's'));
  // 个数变了：句子、贴的字里的段数对不上，当场报是谁
  const bad = dryRun(s, 'dial t = 现在 options="过去 现在"');
  assert.match(bad[0].error, /句子 s[^\n]*写了 3 段，拨盘 t 能拨到 2 个/);
  const s2 = make('dial t = 现在 options="过去 现在 将来"\narray a = 1 2\nlabel n a "{t: 昨天 | 今天 | 明天}"');
  assert.match(dryRun(s2, 'dial t = 1 range=1..2')[0].error, /贴的字 n[^\n]*写了 3 段，拨盘 t 能拨到 2 个/);
  // 换成一样多格的拨数拨盘：照收（从 range 头一个起）
  assert.equal(dryRun(s2, 'dial t = 2 range=1..3').length, 0);
});
