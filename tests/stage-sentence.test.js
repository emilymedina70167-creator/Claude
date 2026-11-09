// 舞台上的句子（kit/src/stage/types/sentence.js）：造、部件的写法（对的、写错报什么）、每个指令改了什么、排版（折行、括号分层不打架）、给老师看的现状、说明里的例子照抄能演
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { sentence, layout, splitSentence, matchWords, roleColor, spanText, sentenceText, brokenMarks, WRAP, WORD_H } from '../kit/src/stage/types/sentence.js';
import { overlaps } from '../kit/src/stage/layout.js';

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };
const err = (scene, line) => dryRun(scene, line)[0]?.error;
const words = (s, id = 's') => [...s.objects.get(id).words].sort((a, b) => a.slot - b.slot).map((w) => w.value);
const S1 = 'sentence s = "The man who lives next door is a doctor."';
const LONG = 'sentence t = "What is more, the researchers found that people who had been exposed to the new policy, which was introduced in 2019, were far less likely to report feeling anxious about their future."';

test('切词：标点贴着前一个词，开引号、开括号贴着后一个词，句末的标点单独记着；缩写、连字符、U.S. 算一个词', () => {
  const r = splitSentence('"Well-known" experts in the U.S. — especially those who\'ve studied it — say it\'s (mostly) harmless; others disagree.');
  assert.deepEqual(r.words.map((w) => w.value), ['Well-known', 'experts', 'in', 'the', 'U.S.', 'especially', 'those', "who've", 'studied', 'it', 'say', "it's", 'mostly', 'harmless', 'others', 'disagree']);
  assert.equal(r.words[0].lead, '"');
  assert.equal(r.words[0].punct, '"');
  assert.equal(r.words[4].punct, '—');
  assert.equal(r.words[12].lead, '(');
  assert.equal(r.words[12].punct, ')');
  assert.equal(r.words[13].punct, ';');
  assert.equal(r.end, '.');
  assert.equal(r.words.at(-1).punct, '', '句末的点不挂在 disagree 上（挪词时跟着排在最后的那个）');
  assert.equal(splitSentence('Is it true?').end, '?');
});

test('造：一句话变成一个个词（key 和位置都从 1 数），写错了说怎么写', () => {
  const s = run(new Scene(), S1);
  const o = s.objects.get('s');
  assert.equal(o.type, 'sentence');
  assert.deepEqual(words(s), ['The', 'man', 'who', 'lives', 'next', 'door', 'is', 'a', 'doctor']);
  assert.equal(o.end, '.');
  assert.ok(o.words.every((w) => w.key === w.slot && w.paint === null && w.glow === false && w.covered === false));
  const e = new Scene();
  assert.match(err(e, 'sentence s "x"'), /要写成 sentence 名字 = "英文句子"/);
  assert.match(err(e, 'sentence s = "，。"'), /引号里要有英文词/);
  assert.match(err(e, `sentence s = "${Array.from({ length: 61 }, () => 'w').join(' ')}"`), /一句最多 60 个词/);
  // 句子里有直引号：外面用「」
  assert.deepEqual(dryRun(e, 'sentence q = 「He said "no" twice.」'), []);
  // 放在已有东西的下面
  const two = run(new Scene(), 'array a = 1 2 3\n' + S1);
  assert.ok(two.objects.get('s').origin.y > 64);
});

test('部件的写法：s.3、s.2-5、s.who、s.that:2、s.who-door、带连字符的词、s#3 跟着走；写错了说清楚', () => {
  const s = run(new Scene(), 'sentence s = "The book that I bought is the one that she wanted, a well-known novel from 2019."');
  const at = (ref) => s.parts(ref).map((w) => w.value);
  assert.deepEqual(at('s.3'), ['that']);
  assert.deepEqual(at('s.2-4'), ['book', 'that', 'I']);
  assert.deepEqual(at('s.I'), ['I']);
  assert.deepEqual(at('s.THE:2'), ['the'], '不分大小写');
  assert.deepEqual(at('s.that:2'), ['that']);
  assert.deepEqual(at('s.book-bought'), ['book', 'that', 'I', 'bought']);
  assert.deepEqual(at('s.well-known'), ['well-known'], '带连字符的词先当一个词');
  assert.deepEqual(at('s.2019'), ['2019'], '超出词数的数当成句子里的这个数');
  assert.deepEqual(at('s.3-book'), ['book', 'that'], '两头一个写数、一个写词也行');
  assert.throws(() => s.parts('s.that'), /「that」在 s 里出现了 2 次（第 3、9 个词）：写 s\.that:2 或 s\.9/);
  assert.throws(() => s.parts('s.that:3'), /只出现了 2 次/);
  assert.throws(() => s.parts('s.zebra'), /s 里没有「zebra」这个词/);
  assert.throws(() => s.parts('s.99'), /s 只有 16 个词，没有第 99 个/);
  assert.throws(() => s.parts('s#x'), /# 后面写数/);
  assert.throws(() => s.parts('s#40'), /没有#40/);
  // s#3 跟着它走：挪了以后 s.3 是别的词，s#3 还是 that
  run(s, 'move s.3 -> s.1');
  assert.deepEqual(at('s.1'), ['that']);
  assert.deepEqual(at('s#3'), ['that']);
  assert.equal(sentence.ref(s.parts('s#3')[0]), 's#3');
});

test('mark / unmark：括号下写成分，颜色按成分来，同一段再标就换掉；收的时候按这一段、按成分、整句', () => {
  const s = run(new Scene(), S1);
  const o = s.objects.get('s');
  run(s, 'mark s.1-6 主语\nmark s.3-6 定语从句\nmark s.7 谓语\nmark s.8-9 表语 g6');
  assert.deepEqual(o.marks.map((m) => [m.label, m.color, spanText(o, m.keys)]), [['主语', 'g1', 's.1-6'], ['定语从句', 'g5', 's.3-6'], ['谓语', 'g2', 's.7'], ['表语', 'g6', 's.8-9']]);
  run(s, 'mark s.8-9 "表语（名词）"');
  assert.equal(o.marks.length, 4, '同一段再标是换掉');
  assert.equal(o.marks[3].label, '表语（名词）');
  run(s, 'unmark s.3-6');
  assert.deepEqual(o.marks.map((m) => m.label), ['主语', '谓语', '表语（名词）']);
  run(s, 'unmark s 谓语');
  assert.deepEqual(o.marks.map((m) => m.label), ['主语', '表语（名词）']);
  run(s, 'mark s.3-6 定语从句\nunmark s.2-6');
  assert.deepEqual(o.marks.map((m) => m.label), ['主语', '表语（名词）'], '没有正好这一段的：收掉在这一段里面的');
  run(s, 'unmark s');
  assert.equal(o.marks.length, 0);
  assert.match(err(s, 'unmark s.1-3'), /s\.1-3 上没有括号/);
  assert.match(err(s, 'mark s.1-3'), /mark 后面要写成分/);
  assert.match(err(s, 'mark s.1-3 主语 g9'), /颜色只有 g1～g6/);
  assert.match(err(s, 'mark s.1-3 "这是一段非常非常长的解释文字超过十六个字了"'), /16 个字以内/);
  assert.match(err(s, 'mark x.1 主语'), /不是舞台上的东西/);
  assert.match(err(run(new Scene(), 'array a = 1 2\n' + S1), 'mark a.1 主语'), /一排格子没有「mark」（句子才有）/);
});

test('成分的颜色：从句跟着它作什么成分走', () => {
  assert.equal(roleColor('主语'), 'g1');
  assert.equal(roleColor('主语从句'), 'g1');
  assert.equal(roleColor('V'), 'g2');
  assert.equal(roleColor('谓语2'), 'g2');
  assert.equal(roleColor('非谓语'), 'g6');
  assert.equal(roleColor('宾语从句'), 'g3');
  assert.equal(roleColor('定语从句'), 'g5');
  assert.equal(roleColor('状语从句'), 'g4');
  assert.equal(roleColor('插入语'), null);
});

test('括号分层：套在里面的在里层、外面的一层层往下；一行里只数这一行有的几层；同一层的字不挤在一起', () => {
  const s = run(new Scene(), LONG);
  run(s, 'mark t.that-future 宾语从句\nmark t.people-2019 主语\nmark t.who-2019 定语从句\nmark t.which-2019 定语从句\nmark t.likely-future 表语');
  const L = layout(s.objects.get('t'));
  const lvOf = (label) => [...new Set(L.brackets.filter((b) => s.objects.get('t').marks.find((m) => m.id === b.mark).label === label).map((b) => b.level))];
  assert.deepEqual(lvOf('主语'), [3]);
  assert.deepEqual(lvOf('宾语从句'), [4]);
  const which = s.objects.get('t').marks.find((m) => m.keys.length === 5);
  assert.equal(L.brackets.find((b) => b.mark === which.id).level, 1, '最里面的从句在第 1 层');
  // 同一行里，外层的括号横线在里层的下面，竖线把里层的围住
  for (const line of L.lines.keys()) {
    const bs = L.brackets.filter((b) => b.line === line).sort((a, b) => a.depth - b.depth);
    for (let i = 1; i < bs.length; i++) if (bs[i].depth > bs[i - 1].depth) assert.ok(bs[i].y + bs[i].h > bs[i - 1].y + bs[i - 1].h, '外层更深');
  }
  // 最后一行只有表语和宾语从句：只占两层，不空出四层
  const last = L.lines.length - 1;
  assert.deepEqual([...new Set(L.brackets.filter((b) => b.line === last).map((b) => b.depth))].sort(), [1, 2]);
  // 括号下的字：同一行同一层的不压在一起
  for (const a of L.marks) for (const b of L.marks) if (a !== b && a.line === b.line && a.depth === b.depth) assert.ok(!overlaps(a, b), `${a.text} 和 ${b.text} 压在一起`);
});

test('折行：一行不超过 WRAP，词不压词；标签在词的上面，括号在词的下面，都不压着词', () => {
  const s = run(new Scene(), LONG);
  run(s, 'tag t.found V\ntag t.were 谓语2\nmark t.people-2019 主语\ncut t.more t.found');
  const L = layout(s.objects.get('t'));
  assert.ok(L.lines.length >= 3);
  for (const ln of L.lines) assert.ok(ln.w <= WRAP + 0.5, `一行 ${ln.w} 宽`);
  const boxes = L.items.map((it) => it.box);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i], boxes[j]), '词压着词');
  for (const g of [...L.tags, ...L.brackets, ...L.marks, ...L.cuts]) for (const b of boxes) assert.ok(!overlaps(g, b), '贴着的东西压着词');
  const found = L.items.find((it) => it.word?.value === 'found');
  const tag = L.tags.find((t) => t.text === 'V');
  assert.ok(tag.y + tag.h <= found.box.y && Math.abs(tag.x + tag.w / 2 - (found.box.x + found.box.w / 2)) < 1, 'V 在 found 的正上方');
  // 断开的地方词让开一道斜线的宽
  const before = layout(run(new Scene(), LONG).objects.get('t')).items.find((it) => it.word?.value === 'the').box.x;
  assert.ok(L.items.find((it) => it.word?.value === 'the').box.x > before + 15, 'more 后面断开，the 往右让');
});

test('tag / untag：词上面的小标签；同一段再标就换掉', () => {
  const s = run(new Scene(), S1);
  const o = s.objects.get('s');
  run(s, 'tag s.7 V\ntag s.2 S\ntag s.7 谓语');
  assert.deepEqual(o.tags.map((t) => [spanText(o, t.keys), t.label, t.color]), [['s.7', '谓语', 'g2'], ['s.2', 'S', 'g1']]);
  run(s, 'untag s.7');
  assert.equal(o.tags.length, 1);
  run(s, 'untag s');
  assert.equal(o.tags.length, 0);
  assert.match(err(s, 'untag s'), /没有标签/);
  assert.match(err(s, 'tag s.1'), /tag 后面要写标签/);
});

test('fold / unfold：一段折成小方块（字用这一段括号下的），后面的词往前补位；展开回原样', () => {
  const s = run(new Scene(), S1);
  const o = s.objects.get('s');
  run(s, 'mark s.1-6 主语\nmark s.3-6 定语从句');
  const isX = layout(o).boxes.get(7).x;
  run(s, 'fold s.3-6');
  assert.equal(o.folds[0].label, '定语从句');
  let L = layout(o);
  assert.equal(L.items.length, 6, '四个词并成一个小方块');
  const pill = L.pills.get(o.folds[0].id);
  assert.deepEqual(L.boxes.get(4), pill, '折起来的词的框就是小方块');
  assert.ok(L.boxes.get(7).x < isX - 50, 'is 往前补位');
  assert.equal(L.brackets.filter((b) => b.mark === o.marks[1].id).length, 0, '整段折起来的括号不画（小方块就是它）');
  assert.match(sentenceText(o, { folds: true }), /The man ［定语从句］ is a doctor\./);
  // 套着折（第二轮）：折起来的那一段里面再折一段照演，里层留在外层的小方块里
  assert.equal(err(s, 'fold s.4-5'), undefined);
  assert.match(err(s, 'fold s.3-6'), /已经折起来了/);
  assert.match(err(s, 'fold s.2-4'), /交叉/);
  assert.match(err(s, 'fold s.1 s.8'), /要连成一段/);
  assert.match(err(s, 'fold s'), /fold 要写折哪一段/);
  assert.match(err(s, 'move s.4 after s.8'), /折起来的词不能挪/);
  assert.match(err(s, 'move s.8 after s.4'), /不能挪进折起来的那一段/);
  run(s, 'unfold s.5');
  assert.equal(o.folds.length, 0);
  assert.ok(Math.abs(layout(o).boxes.get(7).x - isX) < 0.01, '展开回原样');
  assert.match(err(s, 'unfold s'), /没有折起来的/);
  run(s, 'fold s.8-9 "表语"');
  assert.equal(o.folds[0].label, '表语');
  assert.match(err(run(new Scene(), 'sentence x = "Go now."'), 'fold x.1-2'), /整句都折起来/);
});

test('套着折：里层折着也能折外层；展开外层时里层照旧折着；点外层的小方块 = unfold 外层的第一个词', async () => {
  const { gestureAct } = await import('../kit/src/stage/gestures.js');
  // s.5-19 是宾语从句（that habits … grown adults），里面套着定语从句 s.7-10（which children form early）
  const s = run(new Scene(), 'sentence s = "Many experts now agree that habits which children form early can shape the way they think as grown adults, for better or worse."\nopen s fold');
  const o = s.objects.get('s');
  run(s, 'mark s.7-10 定语从句\nmark s.5-19 宾语从句');
  run(s, 'fold s.7-10');
  assert.equal(err(s, 'fold s.5-19'), undefined, '里层折着也能折外层');
  run(s, 'fold s.5-19');
  assert.equal(o.folds.length, 2);
  const [inner, outer] = o.folds;
  let L = layout(o);
  assert.ok(L.pills.has(outer.id) && !L.pills.has(inner.id), '只看得见外层的小方块');
  assert.deepEqual(L.boxes.get(8), L.pills.get(outer.id), '里层的词也在外层的小方块里');
  assert.equal(sentenceText(o, { folds: true }), 'Many experts now agree ［宾语从句］ for better or worse.');
  const folded = sentence.describe(o).find((l) => l.includes('折起来的：'));
  assert.match(folded, /s\.7-10 →「定语从句」（在 s\.5-19 里面）/);
  assert.match(folded, /s\.5-19 →「宾语从句」(；|$)/);
  // 点外层的小方块：unfold s.5（外层的第一个词）；里层的小方块看不见，点不到
  const e = s.opens.get('s:fold');
  assert.equal(gestureAct(s, e, { from: { pill: outer.id } }).src, 'unfold s.5');
  assert.ok(gestureAct(s, e, { from: { pill: inner.id } }).error, '里层的小方块在外层里面');
  assert.ok(gestureAct(s, e, { from: { pill: 'f99' } }).error);
  const fx = s.apply(parseScript('unfold s.5')[0]);
  assert.deepEqual(o.folds.map((f) => f.id), [inner.id], '展开外层，里层照旧折着');
  assert.deepEqual(fx.keys, [5, 6, 11, 12, 13, 14, 15, 16, 17, 18, 19], '露出来的是外层里、不在里层的词');
  L = layout(o);
  assert.ok(L.pills.has(inner.id), '里层的小方块露出来了');
  // 点里层的小方块：unfold s.7
  assert.equal(gestureAct(s, e, { from: { pill: inner.id } }).src, 'unfold s.7');
  // unfold s 全展开（里层一起）
  run(s, 'fold s.5-19\nunfold s');
  assert.equal(o.folds.length, 0);
  // 和里层交叉的：先全展开（unfold 一个词先展开的是外层）
  run(s, 'fold s.7-10\nfold s.5-19');
  assert.match(err(s, 'fold s.9-12'), /和折起来的 s\.7-10 交叉：先 unfold s$/);
  assert.match(err(s, 'fold s.3-6'), /和折起来的 s\.5-19 交叉：先 unfold s\.5$/);
  run(s, 'unfold s');
  // 先折外层、再折里层也照演（里层在外层的小方块里，展开外层才看见）
  run(s, 'fold s.5-19\nfold s.7-10\nunfold s.8');
  assert.deepEqual(o.folds.map((f) => spanText(o, f.keys)), ['s.7-10'], 'unfold 先展开看得见的外层');
});

test('move：after / before / -> 第几个；挪的那一段保持原来的先后，别的词让开', () => {
  const s = run(new Scene(), 'sentence s = "Only then did I realize the truth."');
  const fx = s.apply(parseScript('move s.did after s.I')[0]);
  assert.deepEqual(words(s), ['Only', 'then', 'I', 'did', 'realize', 'the', 'truth']);
  assert.deepEqual(fx.moved, [3]);
  assert.deepEqual(fx.others, [4], '只有 I 让了一格');
  run(s, 'move s.1-2 after s.truth');
  assert.deepEqual(words(s), ['I', 'did', 'realize', 'the', 'truth', 'Only', 'then']);
  run(s, 'move s.Only-then before s.I');
  assert.deepEqual(words(s), ['Only', 'then', 'I', 'did', 'realize', 'the', 'truth']);
  run(s, 'move s#3 -> s.3');
  assert.deepEqual(words(s), ['Only', 'then', 'did', 'I', 'realize', 'the', 'truth']);
  assert.equal(s.objects.get('s').end, '.', '句末的点还在最后');
  assert.match(err(s, 'move s.3'), /要写成 move s\.3 after s\.5/);
  assert.match(err(s, 'move s.3 after s.3'), /落点在要挪的那几个词里面/);
  assert.match(err(s, 'move s.1 s.3 after s.5'), /要连成一段/);
  assert.match(err(s, 'move s.1-2 -> s.7'), /最远到第 6 个/);
  assert.match(err(s, 'move s.1 -> s.I'), /-> 后面写第几个/);
});

test('cut / uncut：在词后面断开（好几处一起写），最后一个词后面不断', () => {
  const s = run(new Scene(), S1);
  const o = s.objects.get('s');
  run(s, 'cut s.6 s.2');
  assert.deepEqual(o.cuts, [6, 2]);
  run(s, 'cut s.3-6');
  assert.deepEqual(o.cuts, [6, 2], '一段写 s.3-6 就断在 6 后面（已经断了）');
  assert.equal(layout(o).cuts.length, 2);
  assert.match(err(s, 'cut s.9'), /最后一个词后面不用断/);
  run(s, 'uncut s.2');
  assert.deepEqual(o.cuts, [6]);
  run(s, 'uncut s');
  assert.deepEqual(o.cuts, []);
  assert.match(err(s, 'uncut s'), /没有断开的地方/);
});

test('refer：同一行拱一道箭头（行上面留出地方）；不在同一行改成在词头上写「→ 那个词」', () => {
  const s = run(new Scene(), S1);
  const o = s.objects.get('s');
  const y0 = layout(o).boxes.get(1).y;
  run(s, 'refer s.3 -> s.2');
  const L = layout(o);
  assert.equal(L.refers.length, 1);
  assert.match(L.refers[0].d, /^M[\d.]+ [\d.]+ C/);
  assert.ok(L.refers[0].box.y < L.boxes.get(3).y, '箭头在词上面');
  assert.ok(L.boxes.get(1).y >= y0, '箭头高了，词往下让');
  assert.match(err(s, 'refer s.3 s.2'), /要写成 refer s\.3 -> s\.2/);
  assert.match(err(s, 'refer s.3 -> s.3'), /同一个词/);
  run(s, 'unrefer s.3');
  assert.equal(o.refers.length, 0);
  const t = run(new Scene(), LONG);
  run(t, 'refer t.who -> t.people');
  const T = layout(t.objects.get('t'));
  const who = T.items.find((it) => it.word?.value === 'who'), people = T.items.find((it) => it.word?.value === 'people');
  if (who.line !== people.line) {
    assert.equal(T.refers.length, 0);
    assert.ok(T.tags.some((g) => g.refer && g.text === '→ people'));
  } else assert.equal(T.refers.length, 1);
});

test('旧的 refer 照旧：refer s.3 -> s.2（词到词）演出来、画出来、写给老师的和第一轮一字不差', () => {
  const s = run(new Scene(), S1);
  const fx = s.apply(parseScript('refer s.3 -> s.2')[0]);
  assert.deepEqual(fx, { id: 's', from: 3, to: 2 });
  const o = s.objects.get('s');
  // 改之前量下来的（第一轮的样子）
  assert.deepEqual(layout(o).refers, [{ from: 3, to: 2, color: null, d: 'M169.5 26.5 C169.5 6 99 6 99 26.5', tip: { x: 99, y: 26.48 }, box: { x: 99, y: 9.120000000000001, w: 70.5, h: 17.36 } }]);
  assert.deepEqual(layout(o).tags, []);
  assert.deepEqual(sentence.describe(o), ['句子 s（9 个词）：The man who lives next door is a doctor.', '  词：1 The  2 man  3 who  4 lives  5 next  6 door  7 is  8 a  9 doctor', '  箭头：s.3 who → s.2 man']);
  assert.deepEqual(o.refers.map((r) => [r.from, r.to, r.toKeys, r.whole, r.color]), [[3, 2, null, false, null]]);
  // 不在同一行的照旧写「→ people」
  const t = run(new Scene(), `${LONG}\nrefer t.who -> t.people`);
  assert.deepEqual(layout(t.objects.get('t')).refers.map((r) => r.d), ['M714.2 29.1 C714.2 6 629.2 6 629.2 29.1']);
});

test('refer 指到一段、整句：同一行拱到那一段的正中，那一段上面一道小横线；整句、跨行的在词头上写「→ …」', () => {
  const s = run(new Scene(), 'sentence s = "The books on the shelf that I bought yesterday are new."');
  const o = s.objects.get('s');
  const fx = s.apply(parseScript('refer s.6 -> s.1-2')[0]);
  assert.deepEqual(fx, { id: 's', from: 6, to: 2, toKeys: [1, 2] });
  let L = layout(o);
  assert.equal(L.refers.length, 1);
  const [r] = L.refers;
  const b1 = L.boxes.get(1), b2 = L.boxes.get(2);
  assert.ok(Math.abs(r.tip.x - (b1.x + b2.x + b2.w) / 2) < 0.5, '箭头尖在 The books 的正中');
  assert.match(r.cap, /^M[\d.]+ [\d.]+ L/, '那一段上面一道小横线');
  assert.ok(r.box.x <= b1.x + 4.5 && r.box.x + r.box.w >= b2.x + b2.w - 4.5, '占的地方把那道小横线框进去（别的东西、贴字让开）');
  assert.match(err(s, 'refer s.6 -> s.5-7'), /指到的那一段不能含 that 自己/);
  assert.match(err(s, 'refer s -> s.2'), /refer 从一个词连出去/);
  // 整句：词头上写「→ 整句」
  s.apply(parseScript('refer s.6 -> s')[0]);
  L = layout(o);
  assert.equal(L.refers.length, 0);
  assert.ok(L.tags.some((g) => g.refer && g.text === '→ 整句'));
  assert.deepEqual(o.refers.map((x) => [x.from, x.to, x.toKeys, x.whole]), [[6, null, null, true]]);
  // 收掉照旧
  run(s, 'unrefer s.6');
  assert.equal(o.refers.length, 0);
  // 挪开以后那一段不连着了：改成在词头上写，不拱一道穿过别的词的线
  const m = run(new Scene(), 'sentence s = "The books on the shelf that I bought yesterday are new."\nrefer s.6 -> s.1-2\nmove s.1 after s.4');
  const M = layout(m.objects.get('s'));
  assert.equal(M.refers.length, 0);
  assert.ok(M.tags.some((g) => g.refer && /^→ /.test(g.text)));
});

test('rewrite：同样的词配上原来的（不分大小写、realize → realized 也算），新的词另起 key；括号按头尾留着', () => {
  const s = run(new Scene(), 'sentence s = "Only then did I realize how much the old man, who had lived alone for years, needed help."');
  const o = s.objects.get('s');
  run(s, 'mark s.how-help 宾语从句\nmark s.who-years 定语从句\ntag s.realize V\nrefer s.who -> s.man\npaint s.man g3');
  const fx = s.apply(parseScript('rewrite s "I realized only then how much the old man, living alone for years, needed help."')[0]);
  assert.deepEqual(words(s).slice(0, 4), ['I', 'realized', 'only', 'then']);
  const key = (v) => o.words.find((w) => w.value === v).key;
  assert.equal(key('realized'), 5, 'realize → realized 是同一个词');
  assert.equal(key('only'), 1, 'Only → only 是同一个词');
  assert.equal(key('living'), 13, 'lived → living 是同一个词');
  assert.deepEqual(fx.removed.sort((a, b) => a - b), [3, 11, 12], 'did、who、had 去掉了');
  assert.ok(fx.changed.includes(5) && fx.changed.includes(1));
  assert.ok(['4,5', '1,2'].includes([...fx.moved].sort((a, b) => a - b).join()), 'I realized 和 only then 换了先后：其中一对走弧线');
  assert.equal(o.words.find((w) => w.value === 'man').paint, 'g3', '颜色跟着词走');
  assert.deepEqual(o.marks.map((m) => m.label), ['宾语从句'], '头尾都在的括号留着；定语从句的头 who 没了');
  assert.equal(spanText(o, o.marks[0].keys), 's.5-15');
  assert.equal(o.refers.length, 0);
  assert.deepEqual(o.tags.map((t) => spanText(o, t.keys)), ['s.2']);
  assert.match(err(s, 'rewrite s.1 "x"'), /rewrite 写整句的名字/);
  assert.match(err(s, 'rewrite s'), /要写成 rewrite s "改写以后的句子"/);
  // 配对本身：同样的词按先后配
  assert.deepEqual(matchWords([{ value: 'the' }, { value: 'cat' }, { value: 'the' }], [{ value: 'The' }, { value: 'the' }, { value: 'dog' }]), [0, 2, null]);
});

test('共用的指令对词都有用：点亮、染色、扣过去、抬起、学生点和拖', () => {
  const s = run(new Scene(), S1);
  run(s, 'glow s.2\npaint s.3-6 g5\ncover s.7\nlift s.1\ndim s.8-9');
  const o = s.objects.get('s');
  assert.ok(o.words[1].glow && o.words[2].paint === 'g5' && o.words[6].covered && o.words[0].lift && o.words[8].dim);
  assert.ok(sentence.partBox(o, o.words[0]).y < layout(o).boxes.get(1).y, '抬起来的往上');
  assert.deepEqual(dryRun(s, 'ask tap s "主语的核心词？" expect=s.man'), []);
  assert.deepEqual(dryRun(s, 'ask drag s.7 "挪回去"'), []);
  assert.deepEqual(dryRun(s, 'say "看 {s.man} 和 {s.who-door}"'), []);
  assert.deepEqual(dryRun(s, 'label n s.1-2 "主语" side=below tone=note'), []);
});

test('给老师看的现状：一个个词带编号和状态、括号（第几层）、标签、折起来的、断开、箭头', () => {
  const s = run(new Scene(), S1);
  run(s, 'mark s.1-6 主语\nmark s.3-6 定语从句\ntag s.7 V\nrefer s.3 -> s.2\ncut s.6\npaint s.7 g2\nmove s.9 -> s.8');
  const t = s.stateText();
  assert.match(t, /名字\.3 现在第 3 个词/);
  assert.match(t, /句子 s（9 个词）：The man who lives next door is doctor a\./);
  assert.match(t, /1 The {2}2 man {2}3 who .* 7 is（粉） {2}8 doctor（#9） {2}9 a（#8）/);
  // 成分写两种名字（中文（缩写）），后面是第几层、颜色
  assert.match(t, /括号（词下面）：s\.1-6 主语（S），第 2 层，蓝；s\.3-6 定语从句（RC），紫/);
  assert.match(t, /标签（词上面）：s\.7 V/);
  assert.match(t, /断开：s\.6 door 后面/);
  assert.match(t, /箭头：s\.3 who → s\.2 man/);
  run(s, 'fold s.3-6');
  assert.match(s.stateText(), /折起来的：s\.3-6 →「定语从句」/);
  assert.match(s.stateText(), /The man ［定语从句］ is/);
});

test('说明里的例子照抄能演（一行不错），每一条指令写法也能演', () => {
  const s = new Scene();
  assert.deepEqual(dryRun(s, sentence.example), []);
  run(s, sentence.example);
  // 例子是活的一轮：老师标好谓语，把拉括号交给学生（页面照 key 判），挑战做到了预写的两行折起从句、问主语的核心词
  assert.ok(s.opens.has('s:mark') && s.goals.has('g1') && s.reactions.get('g1').length === 2);
  const did = (src) => s.apply(parseScript(src)[0], { by: 'student', open: 'mark' });
  assert.equal(did('mark s.1-6 S').judged.verdict.right, true);
  const fx = did('mark s.3-6 RC');
  assert.deepEqual(fx.goalsMet, ['g1']);
  for (const r of fx.reactions) for (const c of parseScript(r.src)) s.apply({ ...c, lenient: true });
  assert.equal(s.waiting.kind, 'tap');
  assert.match(s.stateText(), /折起来的：s\.3-6/);
  // 说明里每一行「指令 …」的第一段，在刚造好的句子上都能演
  const ready = run(new Scene(), sentence.example.split('\n')[0]);
  const lines = sentence.doc.split('\n').map((l) => l.split(/\s{2,}|\s\/\s/)[0].trim()).filter((l) => /^[a-z]+ /.test(l));
  assert.ok(lines.length >= 9, `说明里的指令 ${lines.length} 条`);
  const bad = [];
  for (const l of lines) { const e = dryRun(ready, l); if (e.length) bad.push(`${l} → ${e[0].error}`); }
  assert.deepEqual(bad, []);
  assert.doesNotMatch(sentence.doc + sentence.hint + sentence.example, /[他她]/);
  assert.equal(sentence.drag, true);
  assert.ok(WORD_H >= 44, '词能点（至少 44px 高）');
});

const KEY2 = 'sentence s = "The man who lives next door is a doctor." key="[S The man [RC who [V lives] next door]] [V is] a doctor."';

test('tally / untally：标学生括号里 key 的某种成分几个（o.tally）；不写成分、认不出、没写 key 报错', () => {
  const s = run(new Scene(), `${KEY2}\ntally s V`);
  assert.equal(s.objects.get('s').tally, 'V');
  run(s, 'untally s');
  assert.equal(s.objects.get('s').tally, null);
  assert.match(err(s, 'tally s') || '', /tally 后面要写成分/);
  assert.match(err(s, 'tally s xyz') || '', /认不出/);
  assert.match(err(s, 'tally s.3-6 V') || '', /tally 写整句的名字/);
  assert.match(err(run(new Scene(), S1), 'tally s V') || '', /没写 key/);
});

test('拆散的括号：括号记的词被挪开、不挨着了（brokenMarks）；没挪的时候是空的', () => {
  const s = run(new Scene(), `${KEY2}\nmark s.7-9 O`);
  const id = s.objects.get('s').marks[0].id;
  assert.deepEqual(brokenMarks(s.objects.get('s')), []);
  run(s, 'move s.8 after s.1');
  assert.deepEqual(brokenMarks(s.objects.get('s')), [id]);
  run(s, 'move s.2 after s.8');
  assert.deepEqual(brokenMarks(s.objects.get('s')), [], '挪回来又挨着了');
});

test('拆散的括号画成断开的虚线、成分字带「?」；老师本来就拉成两截的照旧画实线', () => {
  const s = run(new Scene(), `${KEY2}\nmark s.7-9 O`);
  const o = s.objects.get('s');
  assert.ok(layout(o).brackets.every((b) => !b.broken));
  run(s, 'move s.8 after s.1');
  const L = layout(o);
  assert.ok(L.brackets.length >= 2 && L.brackets.every((b) => b.broken), '断开的每一截都是虚线');
  assert.ok(L.marks.every((m) => m.broken && m.text === 'O?'), L.marks.map((m) => m.text).join(' '));
  // 老师拉成两截的（did … realize 这种）：不是被挪开拆散的
  const t = run(new Scene(), 'sentence s = "Only then did I realize it."\nmark s.3 s.5 谓语');
  assert.ok(layout(t.objects.get('s')).brackets.every((b) => !b.broken));
  assert.ok(layout(t.objects.get('s')).marks.every((m) => m.text === '谓语'));
});

test('tally s V：每道学生的括号上标里面 key 的谓语几个，剩下的在句尾标；画出来的数和现状写的一样', () => {
  const s = run(new Scene(), `${KEY2}\nopen s mark\ntally s V`);
  const o = s.objects.get('s');
  let L = layout(o);
  assert.deepEqual(L.tallies.map((t) => t.text), ['括号外 2'], '还没拉括号：两个谓语都在括号外');
  s.apply(parseScript('mark s.3-6 定语从句')[0], { by: 'student', open: 'mark' });
  run(s, 'mark s.1-2 主语'); // 老师拉的不标
  L = layout(o);
  const mine = o.marks.find((m) => m.by === 'student');
  assert.deepEqual(L.marks.filter((m) => m.tally != null).map((m) => [m.mark, m.tally]), [[mine.id, 1]]);
  assert.deepEqual(L.tallies.map((t) => t.text), ['括号外 1']);
  assert.match(s.stateText(), /\n {2}标着的数（tally V，key 的谓语）：s\.3-6 定语从句 1 个；括号外 1 个/);
  // 括号上的数不压着别的字
  const pieces = [...L.marks, ...L.tallies, ...L.tags];
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) assert.ok(!overlaps(pieces[i], pieces[j], 0), `${pieces[i].text} 压着 ${pieces[j].text}`);
  run(s, 'untally s');
  assert.deepEqual(layout(o).tallies, []);
  assert.ok(layout(o).marks.every((m) => m.tally == null));
});

test('扣着的词：学生看的小块写「第 k 个词」，不写词本身；挪了跟着变；写给老师的写词、说一声扣着', async () => {
  const { chipTextOf, tapValueOf } = await import('../kit/src/stage/scene.js');
  const s = run(new Scene(), `${S1}\ncover s.7`);
  const o = s.objects.get('s');
  const [p] = s.parts('s.7');
  assert.equal(chipTextOf(p, o), '第 7 个词');
  assert.doesNotMatch(chipTextOf(p, o), /is/);
  assert.equal(tapValueOf(p), 'is，扣着');
});

test('move 挪一段不带走旁边的标点：这一段和后面隔着的逗号留在原处（交给原来紧挨在前面的词，句首就不要了），段里面的标点、引号跟着走', () => {
  const text = (s) => sentenceText(s.objects.get('s'));
  // 句首的状语从句挪到句尾：以前是「…play When the rain stopped,.」
  const a = run(new Scene(), 'sentence s = "When the rain stopped, the children who had waited inside ran out to play."\nmove s.1-4 after s.14');
  assert.equal(text(a), 'the children who had waited inside ran out to play When the rain stopped.');
  // 夹在中间的一段：后面的逗号交给前面的词（它本来没标点）；挪到的那一处前面的词照旧带着自己的逗号
  const b = run(new Scene(), 'sentence s = "The boss called yesterday at noon, and then left."\nmove s.4-6 before s.1');
  assert.equal(text(b), 'yesterday at noon The boss called, and then left.');
  // 前面的词已经有逗号：不重复成「,,」
  const c = run(new Scene(), 'sentence s = "Apples, pears, plums are cheap."\nmove s.2 after s.4');
  assert.equal(text(c), 'Apples, plums are pears cheap.');
  // 段里面的逗号、段尾的右引号跟着走（右引号和段头的左引号是一对）；句末的点留在最后
  const d = run(new Scene(), 'sentence s = "He said “wait, please” and left."\nmove s.3-4 after s.6');
  assert.equal(text(d), 'He said and left “wait, please”.');
  // 一个词挪也一样：However 后面的逗号留在句首（前面没有词），不要了
  const e = run(new Scene(), 'sentence s = "However, the plan failed."\nmove s.1 after s.4');
  assert.equal(text(e), 'the plan failed However.');
  // 挪回原处也照这一条（以前的逗号不会自己回来）：要原样回去用撤一步、back
  assert.equal(words(a).join(' '), 'the children who had waited inside ran out to play When the rain stopped');
});
