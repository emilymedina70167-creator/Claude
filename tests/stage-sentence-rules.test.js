// 句子（拆成分）的规则（kit/src/stage/types/sentence.rules.js）：造句子时的 key=（老师给的正确拆法，页面不自己分析语法）、
// 逐词比、认四种错法（谓语只圈一半、非谓语当谓语、断早断晚、成分标错）、下一步、判断式、手势表。
// 句子取自缺口尺子 E2、E3 理想演法里的真题句（evals/stage-gaps/ideal/E3.md）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { sentenceRules as R, actSrc, roleName, bracketFacts } from '../kit/src/stage/types/sentence.rules.js';
import { rulesOf, predicateOf, gestureOf, done, evalMeasure, measureLine } from '../kit/src/stage/rules.js';
import { parseBrackets, judgeSpans } from '../kit/src/entext.js';
import { sentence, roleAbbr } from '../kit/src/stage/types/sentence.js';
import { askFor } from '../kit/src/stage/gestures.js';
import { eventOf, eventsText } from '../kit/src/stage/events.js';

const run = (s, src) => { for (const c of parseScript(src)) s.apply(c); return s; };
const make = (src) => run(new Scene(), src);
const S = (s) => s.objects.get('s');
const err = (scene, line) => dryRun(scene, line)[0]?.error;
const mk = (from, to, role) => ({ type: 'mark', from, to, role });
const MAN = 'sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] a doctor."';
// E3 第 8 幕：学生 8 月做错的那句（圈 help / designed 当谓语）
const POLICY = 'sentence s = "Policies designed to help small businesses often fail." key="[S Policies [NF designed to help small businesses]] often [V fail]."';
// E3 第 2 幕②：把 to pay 也圈进谓语
const HOUSE = 'sentence s = "Fortunately, the White House is starting to pay attention." key="Fortunately, [S the White House] [V is starting] [O to pay attention]."';
// E3 第 2 幕①：学生 10 月只圈了 is 的那句
const CAT = 'sentence s = "Every cat with an owner, for instance, is running a small-scale study in operant conditioning." key="[S Every cat with an owner], for instance, [V is running] [O a small-scale study] in operant conditioning."';

test('句子登记了规则；舞台上的成分名和 entext 的 ROLES 对上', () => {
  const s = make(MAN);
  assert.ok(rulesOf(S(s)), '句子交了规则');
  assert.equal(roleName('V'), '谓语');
  assert.equal(roleName('谓语'), '谓语');
  assert.equal(roleName('S'), '主语');
  assert.equal(roleName('主语'), '主语');
  assert.equal(roleName('O'), '宾语');
  assert.equal(roleName('RC'), '定语从句');
  assert.equal(roleName('定语从句'), '定语从句');
  assert.equal(roleName('NF'), '非谓语', '其余照 ROLES');
  assert.equal(roleName('P'), '表语');
  assert.equal(roleName('谓语1'), '谓语', '编了号的也认');
  // 舞台 mark 已有的写法（roleColor 认的那一批）：非谓语一族、从句（泛称）、状语一族
  for (const x of ['分词', '过去分词', '现在分词', '不定式', '动名词', 'to do', 'doing', 'done', '非谓语']) assert.equal(roleName(x), '非谓语', x);
  assert.equal(roleName('从句'), '从句', '泛称');
  assert.equal(roleName('非限制性定语从句'), '定语从句');
  assert.equal(roleName('时间状语从句'), '状语从句');
  for (const x of ['Adv', 'PP', '介词短语', '时间状语', 'A']) assert.equal(roleName(x), '状语', x);
  assert.equal(roleName('宾语补足语'), '宾补');
  // 只认完整的成分名和大写缩写：英文词 do、a、小写的 v 不是成分
  for (const x of ['do', 'a', 'v', 'nf', '插入语', '']) assert.equal(roleName(x), null, x);
});

test('key=：照括号写法读成正确拆法，存在 o.key（每段记词的编号，挪了词跟着走）', () => {
  const o = S(make(MAN));
  assert.deepEqual(o.key.spans.map((x) => [x.role, x.keys.join(' '), x.depth]), [
    ['S', '1 2 3 4 5 6', 0], ['RC', '3 4 5 6', 1], ['V', '7', 0],
  ]);
  // 大小写、标点前后的空格不管；句末的点写不写都行（只比词）
  const o2 = S(make('sentence s = "He has been running." key="[S he] [V HAS been running]"'));
  assert.deepEqual(o2.key.spans.map((x) => x.keys.join(' ')), ['1', '2 3 4']);
  const o3 = S(make('sentence s = "Fortunately, the White House is starting to pay attention." key="Fortunately , [S the White House] [V is starting] [O to pay attention] ."'));
  assert.deepEqual(o3.key.spans.map((x) => x.keys.join(' ')), ['2 3 4', '5 6', '7 8 9']);
  // 不写 key 的句子照旧，没有 o.key
  assert.equal(S(make('sentence s = "He runs."')).key, undefined);
});

test('key 对不上句子：造句子时当场报错，写出第一个对不上的词', () => {
  const e = new Scene();
  assert.match(err(e, 'sentence s = "The man who lives next door is a doctor." key="[S The man [RC who live next door]] [V is] a doctor."'), /对不上.*第 4 个词.*lives.*live/);
  assert.match(err(e, 'sentence s = "He has been running." key="[S He] [V has been]"'), /少了词.*running/);
  assert.match(err(e, 'sentence s = "He runs." key="[S He] [V runs] fast"'), /多了.*fast/);
  assert.match(err(e, 'sentence s = "He runs." key="[S He] [V runs"'), /key=.*没有配对/);
  assert.match(err(e, 'sentence s = "He runs." key="He runs."'), /key=.*\[成分/);
  assert.match(err(e, 'sentence s = "He runs." key="[主语 He] [V runs]"'), /英文缩写/);
  assert.match(err(e, 'sentence s = "He runs." key="[S [SC He]] [V runs]"'), /同一段词/);
  // key 里写了认不出的成分名：当场报错，列出能写的（照收的话学生标什么都对不上）
  assert.match(err(e, 'sentence s = "He left early." key="[S He] [V left] [Xyz early]"'), /成分「Xyz」认不出，能写：.*S 主语.*V 谓语/);
  assert.match(err(e, 'sentence s = "He left early." key="[S He] [v left]"'), /成分「v」认不出/);
  assert.equal(err(e, 'sentence s = "He left early." key="[S He] [V left] [Adv early]"'), undefined, 'Adv 认得（舞台 roleColor 认的缩写）');
});

test('全对：照 key 拉三段以后 parsed 成立、做完了；next 一次给所有还没拉对的段，从外到里', () => {
  const s = make(MAN);
  const o = S(s);
  assert.equal(R.predicates.parsed(o), false);
  assert.equal(done(s, 's'), false);
  const nx = R.next(o);
  assert.deepEqual(nx.acts, [mk(1, 6, 'S'), mk(7, 7, 'V'), mk(3, 6, 'RC')], '外层的主语、谓语在前，里层的定语从句在后');
  assert.match(nx.why, /s\.1-6 主语（The man who lives next door）/);
  for (const a of nx.acts) assert.equal(R.check(o, a, s).right, true, `next 给的 ${actSrc(o, a)} 要判对`);
  assert.deepEqual(nx.acts.map((a) => actSrc(o, a)), ['mark s.1-6 S', 'mark s.7 V', 'mark s.3-6 RC']);
  // 先拉哪一段都行：先拉里层的定语从句
  run(s, 'mark s.3-6 定语从句');
  assert.deepEqual(R.next(S(s)).acts, [mk(1, 6, 'S'), mk(7, 7, 'V')]);
  run(s, 'mark s.1-6 主语\nmark s.7 谓语');
  assert.equal(R.predicates.parsed(S(s)), true);
  assert.equal(R.next(S(s)), null);
  assert.equal(done(s, 's'), true);
  assert.equal(predicateOf(s, 's', 'parsed')(), true);
});

// E2 原句里带撇号、连字符的一句（审查量的那一句）
const E2W = ["It hoped they would learn how shop-floor lighting affected workers' productivity.",
  "[S It] [V hoped] [ObC they [V would learn] [ObC how shop-floor lighting [V affected] workers' productivity]]."];
// E2 第 1、2 幕的真题句：几层从句套着（括号里还有谓语）
const E2 = [
  ['The great question is who should benefit from the analysis of all the data that our lives now generate.',
    '[S The great question] [V is] [PC who [V should benefit] from the analysis of all the data [RC that our lives now [V generate]]].'],
  ['The hardest task that television asks of anyone is to turn the power off after he has turned it on.',
    '[S The hardest task [RC that television [V asks] of anyone]] [V is] [P to turn the power off [AdvC after he [V has turned] it on]].'],
];

test('E2 的两句：照 next 拉完就 parsed；每一段判得和 entext 的 judgeSpans 一样', () => {
  for (const [text, key] of E2) {
    const s = make(`sentence s = "${text}" key="${key}"`);
    const o = S(s);
    // 和 judgeSpans 对拍：学生拉任意一段（一到五个词）、标成 key 里出现过的任一成分，check 判对 ⟺ judgeSpans 在记号下标里判对
    // （判不对的里面，和 key 不冲突的段是 null：页面不判，见 I2 那几条）
    const ans = parseBrackets(key);
    const tokOf = ans.tokens.filter((t) => t.word).map((t) => t.i); // 第几个词 → 记号下标
    const roles = [...new Set(ans.spans.map((x) => x.role))];
    for (let a = 1; a <= o.words.length; a++) {
      for (let b = a; b <= Math.min(o.words.length, a + 4); b++) {
        for (const role of roles) {
          const mine = judgeSpans([{ role, from: tokOf[a - 1], to: tokOf[b - 1] }], ans.spans).right.length === 1;
          assert.equal(R.check(o, mk(a, b, role), s).right === true, mine, `${text.slice(0, 20)}… s.${a}-${b} ${role}`);
        }
      }
    }
    for (let i = 0; i < 20 && R.next(S(s)); i++) for (const a of R.next(S(s)).acts.slice(0, 1)) run(s, actSrc(S(s), a));
    assert.equal(R.predicates.parsed(S(s)), true, `${text.slice(0, 20)}… 照 next 拉完`);
    assert.equal(R.predicates.main(S(s)), true);
  }
  // 只点亮了 benefit、should 没亮（E2 第 1 幕「只点了一半的」）：情态动词加动词，说整段
  const s = make(`sentence s = "${E2[0][0]}" key="${E2[0][1]}"`);
  assert.match(R.check(S(s), mk(7, 7, 'V'), s).misread, /谓语只圈了一半（谓语是「should benefit」这一整段）/);
  // has turned 只圈了 has
  const t = make(`sentence s = "${E2[1][0]}" key="${E2[1][1]}"`);
  assert.match(R.check(S(t), mk(17, 17, 'V'), t).misread, /be\/have 和后面的分词合起来是一个谓语：has turned/);
  // 定语从句断晚了：把主句的谓语 is 也圈了进去
  assert.match(R.check(S(t), mk(4, 9, 'RC'), t).misread, /从句断晚了.*多圈了 is/);
});

test('判对：同一段、同一成分（成分写中文、缩写都行）', () => {
  const s = make(MAN);
  const o = S(s);
  for (const role of ['RC', '定语从句']) {
    const v = R.check(o, mk(3, 6, role), s);
    assert.equal(v.legal, true);
    assert.equal(v.right, true);
    assert.equal(v.misread, null);
    assert.equal(v.next, null);
    assert.match(v.why, /s\.3-6 标成/);
  }
  assert.equal(R.check(o, mk(6, 3, '定语从句'), s).right, true, '从后往前拉也一样');
});

test('谓语只圈了一半：key 是 be/have + 分词，学生只圈了 be 或 have', () => {
  const s = make('sentence s = "He has been running." key="[S He] [V has been running]."');
  const o = S(s);
  const v = R.check(o, mk(2, 2, 'V'), s);
  assert.equal(v.legal, true);
  assert.equal(v.right, false);
  assert.match(v.misread, /谓语只圈了一半/);
  assert.match(v.misread, /be\/have 和后面的分词合起来是一个谓语/);
  assert.match(v.why, /s\.2 标成V（has）/);
  assert.match(v.next.why, /谓语是 s\.2-4（has been running）/, '现在正确的先说谓语那一段');
  assert.deepEqual(v.next.acts[0], mk(2, 4, 'V'));
  assert.match(R.check(o, mk(2, 3, '谓语'), s).misread, /只圈了一半/, 'has been 也只是一半');
  // 猫那句：只圈了 is
  const c = make(CAT);
  assert.match(R.check(S(c), mk(8, 8, 'V'), c).misread, /只圈了一半/);
});

test('把非谓语当成了谓语：只在 key 印证时说（标成谓语的那一截落在 key 的非谓语里），只引那一段里的词', () => {
  const s = make(POLICY);
  const o = S(s);
  // 圈 help、to help、designed、整段非谓语：都落在 key 的 [NF designed to help small businesses] 里
  for (const [a, b] of [[4, 4], [3, 4], [2, 2], [2, 6]]) {
    const v = R.check(o, mk(a, b, 'V'), s);
    assert.equal(v.right, false);
    assert.match(v.misread, /把非谓语当成了谓语/, `圈 s.${a}-${b} 当谓语`);
    assert.match(v.next.why, /^谓语是 s\.8（fail）/, '现在正确的先说真的谓语');
  }
  assert.equal(R.check(o, mk(4, 4, 'V'), s).misread, '把非谓语当成了谓语：help 在非谓语「designed to help small businesses」里，不是谓语');
  assert.equal(R.check(o, mk(2, 6, 'V'), s).misread, '把非谓语当成了谓语：「designed to help small businesses」是非谓语，不是谓语');
  // 只引落在非谓语里的那几个词，不带进 Policies
  assert.equal(R.check(o, mk(1, 2, 'V'), s).misread, '把非谓语当成了谓语：designed 在非谓语「designed to help small businesses」里，不是谓语');
  assert.equal(R.check(o, mk(8, 8, 'V'), s).right, true, '真的谓语是 fail');
  // 把后面的 to pay 也圈进了谓语（key 把 to pay attention 标成非谓语时）
  const h = make('sentence s = "Fortunately, the White House is starting to pay attention." key="Fortunately, [S the White House] [V is starting] [NF to pay attention]."');
  assert.equal(R.check(S(h), mk(5, 8, 'V'), h).misread, '把非谓语当成了谓语：to pay 在非谓语「to pay attention」里，不是谓语');
  // key 写成 done / doing 的一段也算非谓语
  const p = make('sentence s = "Passing the cafe, I saw a friend." key="[doing Passing the cafe], [S I] [V saw] [O a friend]."');
  assert.equal(R.check(S(p), mk(1, 4, 'V'), p).misread, '把非谓语当成了谓语：「Passing the cafe」是非谓语，不是谓语', '不带进 I');
});

test('key 没说是非谓语的不说「把非谓语当成了谓语」：从句里 key 没拉的谓语、to + 名词、名词', () => {
  const none = (src, key, a, b, role = 'V') => {
    const s = make(`sentence s = "${src}" key="${key}"`);
    const v = R.check(S(s), mk(a, b, role), s);
    assert.notEqual(v.right, true);
    assert.doesNotMatch(v.misread ?? '', /非谓语/, `${src} s.${a}-${b}：${v.misread}`);
    return v.misread;
  };
  // key 没拉的（从句里的谓语、主语里的一个词）：和 key 不冲突，页面不判
  const free = (src, key, a, b, role = 'V') => { const s = make(`sentence s = "${src}" key="${key}"`); return R.check(S(s), mk(a, b, role), s).right; };
  assert.equal(free('The man who lived next door is a doctor.', '[S The man [RC who lived next door]] [V is] a doctor.', 4, 4), null);
  assert.equal(free('The building collapsed.', '[S The building] [V collapsed].', 2, 2), null);
  assert.equal(free('He went to the station.', '[S He] [V went] to the station.', 2, 5), false, '和 key 里的谓语沾边、范围不一样：照旧判错');
  // 从句里的过去式谓语（key 没拉从句里的 V）
  assert.equal(none('The man who lived next door is a doctor.', '[S The man [RC who lived next door]] [V is] a doctor.', 4, 4), null);
  assert.equal(none('The report that he made last year is wrong.', '[S The report [RC that he made last year]] [V is] wrong.', 5, 5, '谓语'), null);
  assert.equal(none("It hoped they would learn how shop-floor lighting affected workers' productivity.", "[S It] [V hoped] [O they would learn how shop-floor lighting affected workers' productivity].", 9, 9), null);
  // 谓语多圈了介词短语：是断晚了，不是 to do
  assert.match(none('Millions of mothers have gone to work.', '[S Millions of mothers] [V have gone] to work.', 4, 7), /谓语这一段断晚了.*多圈了 to work/);
  none('He went to the station.', '[S He] [V went] to the station.', 2, 5);
  assert.match(none('Every morning she walks to school.', 'Every morning [S she] [V walks] to school.', 4, 6), /断晚了/);
  // 名词
  assert.equal(none('The building collapsed.', '[S The building] [V collapsed].', 2, 2), null);
});

test('断早、断晚：一段的边界和 key 差一两个词', () => {
  const s = make(MAN);
  const o = S(s);
  const late = R.check(o, mk(3, 7, '定语从句'), s);
  assert.equal(late.right, false);
  assert.match(late.misread, /从句断晚了/);
  assert.match(late.misread, /多圈了 is/);
  assert.match(late.next.why, /定语从句是 s\.3-6（who lives next door）/);
  const early = R.check(o, mk(3, 5, 'RC'), s);
  assert.match(early.misread, /从句断早了/);
  assert.match(early.misread, /还差 door/);
  assert.match(R.check(o, mk(2, 6, 'RC'), s).misread, /从句断早了.*多圈了 man/, '开头早了一个词');
  // 不是从句的一段：第 3 幕右把手停在 driving 上
  const t = make('sentence s = "To anticipate every imaginable driving situation is a difficult programming problem." key="[S To anticipate every imaginable driving situation] [V is] a difficult programming problem."');
  assert.match(R.check(S(t), mk(1, 5, 'S'), t).misread, /主语这一段断早了.*还差 situation/);
  // 差得远的不算断早断晚
  assert.equal(R.check(o, mk(3, 3, 'RC'), s).misread, null);
  // 写泛称「从句」：对得上 key 里的定语从句
  assert.match(R.check(o, mk(3, 7, '从句'), s).misread, /从句断晚了：定语从句是「who lives next door」/);
  // 别的成分不改看别的成分的一段（成分也错了，不只是断错了地方）
  const th = make('sentence s = "Thinking is essentially a process of making connections in the brain." key="[S Thinking] [V is] essentially [P a process of making connections in the brain]."');
  assert.equal(R.check(S(th), mk(1, 2, '定语从句'), th).misread, null);
  assert.equal(R.check(S(th), mk(1, 2, 'P'), th).misread, null);
  // 不是断错了地方的不硬说：lives 标成谓语（从句里的谓语，key 没拉）、running 标成非谓语（它在谓语 has been running 里）
  assert.equal(R.check(o, mk(4, 4, 'V'), s).misread, null);
  const r = make('sentence s = "He has been running." key="[S He] [V has been running]."');
  assert.equal(R.check(S(r), mk(4, 4, '非谓语'), r).misread, null);
});

test('成分名：舞台已有的写法都认；分词、to do 和非谓语是一回事，「从句」对得上任何一种从句', () => {
  const s = make(POLICY);
  for (const r of ['非谓语', 'NF', '不定式', '分词', '过去分词', 'to do', 'done', '动名词']) assert.equal(R.check(S(s), mk(2, 6, r), s).right, true, r);
  const m = make(MAN);
  for (const r of ['从句', '定语从句', 'RC', '非限制性定语从句']) assert.equal(R.check(S(m), mk(3, 6, r), m).right, true, r);
  assert.equal(R.check(S(m), mk(3, 6, '宾语从句'), m).misread, '成分标错了：这一段是定语从句，不是宾语从句', '写了另一种从句是错的');
  assert.equal(R.check(S(m), mk(1, 6, '从句'), m).misread, '成分标错了：这一段是主语，不是从句', '泛称只对得上从句');
  // 学生写泛称，拉完照样算 parsed
  run(m, 'mark s.1-6 主语\nmark s.7 谓语\nmark s.3-6 从句');
  assert.equal(R.predicates.parsed(S(m)), true);
  assert.equal(predicateOf(m, 's', 'span')(['s.3-6', '=', '定语从句']), true);
  assert.throws(() => predicateOf(m, 's', 'span')(['s.3-6', '=', 'Xyz']), /认不出/);
  // key 用 roleColor 认的缩写 Adv、A：学生标「状语」
  for (const k of ['Adv', 'A']) {
    const e = make(`sentence s = "He left early." key="[S He] [V left] [${k} early]."`);
    assert.equal(R.check(S(e), mk(3, 3, '状语'), e).right, true, k);
  }
  // 认不出的成分名：判错，话里照学生写的
  assert.equal(R.check(S(m), mk(3, 6, '插入语'), m).misread, '成分标错了：这一段是定语从句，不是插入语');
});

test('段对了、成分不对', () => {
  const s = make(MAN);
  const o = S(s);
  const v = R.check(o, mk(3, 6, '主语'), s);
  assert.equal(v.right, false);
  assert.equal(v.misread, '成分标错了：这一段是定语从句，不是主语');
  const h = make(HOUSE);
  assert.equal(R.check(S(h), mk(2, 4, 'O'), h).misread, '成分标错了：这一段是主语，不是宾语');
  // 不是 to do / doing / done 的一段当成谓语：成分标错
  assert.equal(R.check(S(h), mk(2, 4, 'V'), h).misread, '成分标错了：这一段是主语，不是谓语');
});

test('没写 key 不判；拉不了的一段是这个世界的物理（legal: false）', () => {
  const s = make('sentence s = "The man who lives next door is a doctor."');
  const o = S(s);
  const v = R.check(o, mk(7, 7, 'V'), s);
  assert.equal(v.legal, true);
  assert.equal(v.right, null);
  // 没有 key 永远判不了：判断式抛错（写下挑战时当场报，见 stage-goal 的 I4）
  assert.throws(() => R.predicates.parsed(o), /s 没写 key=（正确拆法），页面判不了 parsed/);
  assert.throws(() => R.predicates.main(o), /页面判不了 main/);
  assert.equal(done(s, 's'), false, '没写 key 的句子不算做完');
  assert.deepEqual(R.next(o).acts, []);
  const k = make(MAN);
  assert.equal(R.check(S(k), mk(3, 12, 'RC'), k).legal, false, '没有第 12 个词');
  assert.equal(R.check(S(k), mk(3, 6, ''), k).legal, false, '要写成分');
  assert.deepEqual(R.check(S(k), { type: 'fold', from: 3, to: 6 }, k), { legal: true, right: null }, '折起来不判');
});

test('判断式：parsed（全对）、main（主干对了）、span（这一段是什么成分，不靠 key）', () => {
  const s = make(MAN);
  run(s, 'mark s.1-6 主语\nmark s.7 V');
  assert.equal(R.predicates.main(S(s)), true, '主语、谓语对了：主干对了');
  assert.equal(R.predicates.parsed(S(s)), false, '定语从句还没拉');
  run(s, 'mark s.3-7 定语从句');
  assert.equal(R.predicates.parsed(S(s)), false, '拉错的一段不算');
  run(s, 'mark s.3-6 定语从句');
  assert.equal(R.predicates.parsed(S(s)), true, '拉对了；之前拉错的那道还在也不碍事');
  const h = make(HOUSE);
  run(h, 'mark s.2-4 S\nmark s.5-6 V');
  assert.equal(predicateOf(h, 's', 'main')(), false, '宾语还没拉');
  run(h, 'mark s.7-9 宾语');
  assert.equal(predicateOf(h, 's', 'main')(), true);
  // span：照 goal.js 拆出来的参数原样（s span s.7 = V → ['s.7', '=', 'V']）
  const span = predicateOf(s, 's', 'span');
  assert.equal(span(['s.7', '=', 'V']), true);
  assert.equal(span(['s.7=谓语']), true);
  assert.equal(span(['7', 'V']), true);
  assert.equal(span(['s.1-6', '=', 'S']), true);
  assert.equal(span(['s.1-6', '=', 'V']), false);
  assert.equal(span(['s.2-6', '=', 'S']), false);
  assert.throws(() => span([]), /span s\.2-5 = V/);
  assert.throws(() => span(['s.20', '=', 'V']), /只有 9 个词/);
  const bare = make('sentence s = "He runs."\nmark s.2 V');
  assert.equal(predicateOf(bare, 's', 'span')(['s.2', '=', 'V']), true, '没写 key 也能判这一段');
});

test('挑战：when="s parsed"、when="s span s.7 = V" 学生拉对了才做到', () => {
  const s = make(MAN);
  run(s, 'goal g1 "找出谓语" when="s span s.7 = V"\ngoal g2 "拆完" when="s parsed"');
  assert.equal(s.apply(parseScript('mark s.6 V')[0]).goalsMet, undefined);
  assert.deepEqual(s.apply(parseScript('mark s.7 谓语')[0]).goalsMet, ['g1']);
  run(s, 'mark s.1-6 主语');
  assert.deepEqual(s.apply(parseScript('mark s.3-6 RC')[0]).goalsMet, ['g2']);
});

test('手势表：从一个词拉到另一个词再点成分 → mark；点一段 → fold', () => {
  const s = make(MAN);
  const o = S(s);
  const word = (k) => o.words.find((w) => w.slot === k);
  const g = gestureOf(o, 'mark');
  assert.equal(g.gesture, 'span');
  assert.deepEqual(g.toAct(o, { from: word(2), to: word(4), value: 'V' }), { act: mk(2, 4, 'V'), src: 'mark s.2-4 V' });
  assert.deepEqual(g.toAct(o, { from: { slot: 6 }, to: { slot: 3 }, value: '定语从句' }).src, 'mark s.3-6 定语从句', '从后往前拉');
  assert.equal(g.toAct(o, { from: word(7), to: word(7), value: 'V' }).src, 'mark s.7 V');
  assert.equal(g.toAct(o, { from: word(7), to: word(8), value: 'to do' }).src, 'mark s.7-8 "to do"');
  assert.ok(g.toAct(o, { from: word(2), to: word(4) }).error, '还没点成分');
  assert.ok(g.toAct(o, { value: 'V' }).error, '没拉');
  // 翻出来的那一行照演，舞台上真的有了那道括号
  run(s, g.toAct(o, { from: word(3), to: word(6), value: 'RC' }).src);
  assert.equal(predicateOf(s, 's', 'span')(['s.3-6', '=', '定语从句']), true);
  const f = gestureOf(S(s), 'fold');
  assert.equal(f.gesture, 'tap');
  const m = S(s).marks[0];
  assert.deepEqual(f.toAct(S(s), { to: { mark: m.id } }), { act: { type: 'fold', from: 3, to: 6 }, src: 'fold s.3-6' });
  assert.equal(f.toAct(S(s), { to: word(4) }).src, 'fold s.3-6', '点括号里的一个词：折起最里层那一段');
  assert.ok(f.toAct(S(s), { to: word(8) }).error, '这个词不在括号里');
  run(s, 'fold s.3-6');
  assert.equal(S(s).folds.length, 1);
  assert.ok(f.toAct(S(s), { to: { mark: m.id } }).error, '已经折起来了');
});

test('key 的状态：收下了 / rewrite 以后作废 / move 拆散了一段，老师在「舞台现在」和下一步里看得到', () => {
  const desc = (s) => sentence.describe(S(s)).join('\n');
  const s = make(MAN);
  assert.match(desc(s), /\n {2}key：收下了（3 段）/);
  assert.doesNotMatch(sentence.describe(S(make('sentence s = "He runs."'))).join('\n'), /key：/, '没写 key 不提');
  // rewrite：作废，不判，下一步说清楚是作废了（不是没写）
  run(s, 'goal g1 "拆完" when="s parsed"');
  run(s, 'rewrite s "The man living next door is a doctor."');
  assert.equal(S(s).key.void, 'rewrite');
  assert.equal(R.check(S(s), mk(6, 6, 'V'), s).right, null);
  assert.throws(() => R.predicates.parsed(S(s)), /key 跟着 rewrite 作废了，页面判不了 parsed/);
  assert.throws(() => R.predicates.main(S(s)), /作废/);
  assert.match(R.next(S(s)).why, /key 跟着 rewrite 作废了，要判就重写 key/);
  assert.deepEqual(R.next(S(s)).acts, []);
  assert.equal(done(s, 's'), false);
  assert.match(desc(s), /key：作废了（rewrite/);
  assert.deepEqual(R.facts(S(s), S(s), mk(6, 6, 'V')), [], 'key 作废了不写事实');
  // move 把 lives 挪到 a 后面：主语、定语从句都拆散了，只剩谓语拉得成
  const m = make(MAN);
  run(m, 'move s.4 after s.8');
  const nx = R.next(S(m));
  assert.deepEqual(nx.acts.map((a) => a.role), ['V']);
  assert.match(nx.why, /定语从句（who lives next door）被 move 拆散了，拉不成一段/);
  assert.match(desc(m), /key：第 1 段 \[S The man who lives next door\] 被 move 拆散了，那一段不能再拉对；第 2 段 \[RC who lives next door\] 被 move 拆散了/);
  run(m, 'mark s.6 V');
  assert.equal(R.check(S(m), mk(6, 6, 'V'), m).right, true, 'is 挪到第 6 个了，照样判对');
  assert.equal(R.predicates.parsed(S(m)), false, '拆散了的那几段拉不对');
  assert.notEqual(R.next(S(m)), null);
  assert.equal(done(m, 's'), false);
});

test('写给老师的事实：拉了一段以后这一段对不对、key 里还差哪几段（用原句的词）', () => {
  const step = (s, line) => { const before = structuredClone(S(s)); const c = parseScript(line)[0]; s.apply(c); return before; };
  const act = (line) => { const m = line.match(/^mark s\.(\d+)(?:-(\d+))? (.+)$/); return mk(Number(m[1]), Number(m[2] ?? m[1]), m[3]); };
  const s = make(MAN);
  let b = step(s, 'mark s.3-6 定语从句');
  assert.deepEqual(R.facts(b, S(s), act('mark s.3-6 定语从句')), [
    '这一段对了：s.3-6 标成定语从句（who lives next door）',
    'key 里还差 2 段没拉对：s.1-6 主语（The man who lives next door）、s.7 谓语（is）',
  ]);
  b = step(s, 'mark s.7-8 V');
  assert.deepEqual(R.facts(b, S(s), act('mark s.7-8 V')), [
    '这一段不对：s.7-8 标成V（is a）（谓语这一段断晚了：谓语是「is」（结尾多圈了 a））',
    'key 里还差 2 段没拉对：s.1-6 主语（The man who lives next door）、s.7 谓语（is）',
  ]);
  b = step(s, 'mark s.8-9 宾语');
  assert.equal(R.facts(b, S(s), act('mark s.8-9 宾语'))[0], 's.8-9 标成宾语（a doctor）：页面不判（key 里没有这一段）');
  step(s, 'mark s.1-6 主语');
  b = step(s, 'mark s.7 谓语');
  assert.deepEqual(R.facts(b, S(s), act('mark s.7 谓语')), ['这一段对了：s.7 标成谓语（is）', '正确拆法的每一段都拉对了']);
  // 撇号、连字符照原句（workers' productivity）
  const e = make(`sentence s = "${E2W[0]}" key="${E2W[1]}"`);
  b = step(e, 'mark s.2 V');
  const f = R.facts(b, S(e), act('mark s.2 V'));
  assert.match(f[1], /how shop-floor lighting affected workers' productivity/);
  // 没写 key、折起来：不写
  const k = make('sentence s = "He runs."\nmark s.2 V');
  assert.deepEqual(R.facts(S(k), S(k), mk(2, 2, 'V')), []);
  assert.deepEqual(R.facts(S(s), S(s), { type: 'fold', from: 3, to: 6 }), []);
});

// —— 整条分支的最终审查（I2）：key 不全的时候，页面只判 key 说得上的段 ——
const E2Q = 'sentence s = "The great question is who should benefit from the analysis of all the data that our lives now generate." key="The great question [V is] [Cl who [V should benefit] from the analysis of all the data [Cl that our lives now [V generate]]]."';

test('I2 key 没拉的一段：不跨 key 里一段的边界、不和 key 抢同一段词、不和 key 里同一种成分沾边，页面不判（right 是 null）', () => {
  const s = make(MAN); // key 没拉 a doctor
  const v = R.check(S(s), mk(8, 9, '表语'), s);
  assert.equal(v.right, null);
  assert.equal(v.misread, null);
  // 照说明的例子写了 wrong=mark call=wrong：不圈、不叫
  const sc = make(`${MAN}\nopen s mark wrong=mark call=wrong`);
  const fx = sc.apply(parseScript('mark s.8-9 表语')[0], { by: 'student', open: 'mark' });
  assert.equal(fx.judged.verdict.right, null);
  assert.equal(fx.judged.mark, false);
  assert.equal(fx.judged.call, null);
  assert.match(fx.judged.after[0], /s\.8-9 标成表语（a doctor）：页面不判（key 里没有这一段）/);
  // E2：key 没拉主语，学生拉了主语
  const e = make(E2Q);
  assert.equal(R.check(S(e), mk(1, 3, '主语'), e).right, null);
});

test('I2 和 key 冲突的照旧判错：跨过 key 里一段的边界、和 key 里同一种成分沾边（范围不一样）', () => {
  const s = make(MAN);
  const x = R.check(S(s), mk(6, 7, '主语'), s); // door is：跨过了主语的边界
  assert.equal(x.right, false);
  const before = structuredClone(S(s));
  s.apply(parseScript('mark s.6-7 主语')[0]);
  assert.match(R.facts(before, S(s), mk(6, 7, '主语'))[0], /^这一段不对：s\.6-7 标成主语（door is）（和 key 里的主语「The man who lives next door」交叉）/);
  assert.equal(R.check(S(s), mk(1, 2, '主语'), s).right, false, 'key 里主语是 s.1-6：同一种成分、范围不一样');
  const e = make(E2Q);
  assert.equal(R.check(S(e), mk(3, 5, '主语'), e).right, false, '跨过了 who 那个从句的边界');
  assert.equal(R.check(S(make('sentence s = "He went to the station." key="[S He] [V went] to the station."')), mk(2, 5, 'V'), null).right, false, '谓语多圈了好几个词');
});

test('I2 定语 / Attr 对得上 key 里的定语从句（和泛称「从句」一样放宽）；key 写的是定语、学生写定语从句不放宽', () => {
  const s = make(MAN);
  for (const r of ['定语', 'Attr']) assert.equal(R.check(S(s), mk(3, 6, r), s).right, true, r);
  run(s, 'mark s.1-6 主语\nmark s.7 谓语\nmark s.3-6 定语');
  assert.equal(R.predicates.parsed(S(s)), true);
  assert.equal(predicateOf(s, 's', 'span')(['s.3-6', '=', '定语从句']), true);
  const a = make('sentence s = "The man living next door is a doctor." key="[S The man [Attr living next door]] [V is] [P a doctor]."');
  assert.equal(R.check(S(a), mk(3, 5, '定语从句'), a).right, false);
});

// —— 复核（final-rereview.md）：套着的从句里的成分，不拿去和外面一层同一种成分的一段比 ——
test('复核 key 里套着的从句：从句里的主语（who、he、I）不拿去和外面一层的主语比，key 没拆这个从句就不判', () => {
  const full = 'sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."';
  const s = make(full);
  const v = R.check(S(s), mk(3, 3, '主语'), s);
  assert.equal(v.right, null, 'who 是定语从句的主语：key 没拆这个从句');
  assert.equal(v.misread, null);
  // 照说明的例子写了 wrong=mark call=wrong：不圈、不叫，事实写「页面不判」
  const sc = make(`${full}\nopen s mark wrong=mark call=wrong`);
  const fx = sc.apply(parseScript('mark s.3 主语')[0], { by: 'student', open: 'mark' });
  assert.equal(fx.judged.mark, false);
  assert.equal(fx.judged.call, null);
  assert.match(fx.judged.after[0], /页面不判/);
  // 外面一层的照旧：主语是 s.1-6，标 s.1-2 是主语还是不对
  assert.equal(R.check(S(s), mk(1, 2, '主语'), s).right, false);
  // that 从句里的 he、省略了关系词的从句里的 I：不判，也不说断早断晚
  const f = make('sentence s = "The fact that he left surprised us." key="[S The fact [Cl that he left]] [V surprised] [O us]."');
  assert.equal(R.check(S(f), mk(4, 4, '主语'), f).right, null);
  const b = make('sentence s = "The book I read is good." key="[S The book [RC I read]] [V is] [P good]."');
  const bv = R.check(S(b), mk(3, 3, '主语'), b);
  assert.equal(bv.right, null);
  assert.equal(bv.misread, null, '不能说「主语这一段开头断晚了」');
  // 从句里的谓语不说是「非谓语」：外面一层的非谓语不拿来比从句里面
  const p = make('sentence s = "Policies designed to help people who need help often fail." key="[S Policies [NF designed to help people [RC who need help]]] often [V fail]."');
  const pv = R.check(S(p), mk(7, 7, '谓语'), p);
  assert.notEqual(pv.right, false, 'need 是定语从句的谓语');
  assert.doesNotMatch(pv.misread ?? '', /非谓语/);
});

test('复核 key 拆了从句：从句里的一段照从句自己的那几段判（对、错都照它）；从句本身断早断晚照旧', () => {
  const s = make('sentence s = "The man who lives next door is a doctor." key="[S The man [RC [S who] [V lives] next door]] [V is] [P a doctor]."');
  assert.equal(R.check(S(s), mk(3, 3, '主语'), s).right, true, 'key 说 who 是从句的主语');
  assert.equal(R.check(S(s), mk(3, 4, '主语'), s).right, false, '和从句自己的主语沾边、范围不一样');
  assert.equal(R.check(S(s), mk(4, 4, '谓语'), s).right, true);
  assert.match(R.check(S(s), mk(3, 5, '定语从句'), s).misread, /从句断早了/, '从句自己的边界照旧说');
  assert.equal(R.check(S(s), mk(1, 2, '主语'), s).right, false, '外面一层照旧');
});

test('谓语几个：照 key 数，key 的段整个落在范围里才算；key 还差几段；没写 key 数不了', () => {
  const s = make('sentence s = "The man who lives next door is a doctor." key="[S The man [RC who [V lives] next door]] [V is] a doctor."');
  assert.equal(evalMeasure(s, 'verbs(s)').value, 2);
  assert.equal(evalMeasure(s, 'verbs(s.3-6)').value, 1);
  assert.equal(evalMeasure(s, 'verbs(s.3-4)').value, 1);
  assert.equal(evalMeasure(s, 'verbs(s.5-9)').value, 1, 'lives 不在 5-9 里');
  assert.equal(evalMeasure(s, 'left(s)').value, 4);
  run(s, 'mark s.7 V');
  assert.equal(evalMeasure(s, 'left(s)').value, 3);
  assert.equal(evalMeasure(s, 'left(s.3-6)').value, 2, '这一段里还差 RC、V 两段');
  const t = make('sentence s2 = "The man is a doctor."');
  const r = evalMeasure(t, 'verbs(s2)');
  assert.equal(r.value, null);
  assert.match(r.why, /s2 没写 key/);
  assert.equal(r.never, true, '没写 key 以后也数不了');
  assert.equal(measureLine(t, t.objects.get('s2')), '页面数不了：s2 没写 key');
});

// —— 学生的括号（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 3.2）——
const TWO_V = 'sentence s = "The man who lives next door is a doctor." key="[S The man [RC who [V lives] next door]] [V is] a doctor."';
const stuMark = (s, line) => s.apply(parseScript(line)[0], { by: 'student', open: 'mark' });

test('学生括号里的谓语数：每道学生的括号里 key 的谓语几个、括号外几个；多拉的；被挪开拆散的；老师拉的不算', () => {
  const s = make(`${TWO_V}\nopen s mark\nmark s.1-2 S`);
  assert.deepEqual(bracketFacts(S(s)), [], '老师拉的括号不算');
  stuMark(s, 'mark s.3-6 定语从句');
  assert.equal(S(s).marks.at(-1).by, 'student');
  assert.equal(S(s).marks[0].by, 'teacher');
  assert.ok(bracketFacts(S(s)).includes('学生的括号：s.3-6 定语从句（who lives next door）里有 key 的谓语 1 个；括号外有 key 的谓语 1 个'), bracketFacts(S(s)).join('\n'));
  stuMark(s, 'mark s.8-9 O');
  const f = bracketFacts(S(s));
  // key 里一个宾语都没标：页面不知道它对不对，不说「多拉的」
  assert.ok(f.includes('key 里没有的：s.8-9 O（a doctor）'), f.join('\n'));
  assert.ok(!f.some((x) => x.startsWith('多拉的')), f.join('\n'));
  assert.ok(f.includes('学生的括号：s.3-6 定语从句（who lives next door）里有 key 的谓语 1 个；s.8-9 O（a doctor）里有 key 的谓语 0 个；括号外有 key 的谓语 1 个'), f.join('\n'));
  // 现状里也写
  assert.match(s.stateText(), /\n {2}key 里没有的：s\.8-9 O（a doctor）/);
  // key 标了主语（s.1-6）、学生又拉了一道主语 s.1-2：这才是多拉的
  stuMark(s, 'mark s.1-2 S');
  assert.ok(bracketFacts(S(s)).includes('多拉的：s.1-2 S（The man；key 里没有这一段）'), bracketFacts(S(s)).join('\n'));
  assert.ok(bracketFacts(S(s)).includes('key 里没有的：s.8-9 O（a doctor）'));
  // 拉了 s.7-9 O 以后 a 挪到句首：那道括号拆散了，不算一段
  const m = make(`${TWO_V}\nopen s mark`);
  stuMark(m, 'mark s.7-9 O');
  run(m, 'move s.8 after s.1');
  assert.ok(bracketFacts(S(m)).some((x) => /^拆散的：.*被挪开拆散了，不算一段$/.test(x)), bracketFacts(S(m)).join('\n'));
  assert.ok(bracketFacts(S(m)).includes('拆散的：s.2 s.8-9 那道 O 被挪开拆散了，不算一段'));
  assert.ok(!bracketFacts(S(m)).some((x) => x.startsWith('学生的括号')), '拆散的不当一段数');
  // 没写 key：不数谓语，拆散的照说
  const k = make('sentence s = "The man who lives next door is a doctor."\nopen s mark');
  stuMark(k, 'mark s.3-6 定语从句');
  assert.deepEqual(bracketFacts(S(k)), []);
});

test('学生括号的事实：拉了一道以后只写变了的那几行', () => {
  const s = make(`${TWO_V}\nopen s mark`);
  let fx = stuMark(s, 'mark s.3-6 定语从句');
  assert.ok(fx.judged.after.includes('学生的括号：s.3-6 定语从句（who lives next door）里有 key 的谓语 1 个；括号外有 key 的谓语 1 个'), fx.judged.after.join('\n'));
  // 多拉一道：学生的括号那一行变了、key 里没有的那一行是新的
  fx = stuMark(s, 'mark s.8-9 O');
  assert.ok(fx.judged.after.includes('key 里没有的：s.8-9 O（a doctor）'));
  // 同一道再标一次成分：key 里没有的那一行没变，不写
  fx = stuMark(s, 'mark s.3-6 RC');
  assert.ok(!fx.judged.after.some((x) => x.startsWith('key 里没有的')), fx.judged.after.join('\n'));
  assert.ok(fx.judged.after.some((x) => x.startsWith('学生的括号：s.3-6 RC')), '成分改了，那一行变了');
  // 前后一样的行一概不进
  const before = bracketFacts(S(s));
  fx = stuMark(s, 'mark s.3-6 RC');
  assert.deepEqual(fx.judged.after.filter((x) => before.includes(x)), []);
});

test('学生括号：key 一个谓语都没标时不说谓语几个（key 说不了）；拆散的、key 里没有的照说', () => {
  const s = make('sentence s = "The man next door is a doctor." key="[S The man next door] is a doctor."\nopen s mark');
  stuMark(s, 'mark s.1-4 S');
  assert.deepEqual(bracketFacts(S(s)), [], '拉对了主语，又没有谓语可数：什么都不写');
  stuMark(s, 'mark s.6-7 O');
  assert.deepEqual(bracketFacts(S(s)), ['key 里没有的：s.6-7 O（a doctor）']);
  assert.doesNotMatch(s.stateText(), /谓语 0 个/);
});

// —— 拉一条线：links= 和 refer（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 2.2）——
// that 指的是 books（定语从句 that I bought yesterday 修饰 books：are new 的是书），就近的 shelf 是常见的错连
const BOOKS_S = 'sentence s = "The books on the shelf that I bought yesterday are new."';
const BOOKS = `${BOOKS_S} links="that -> books; !that -> shelf=就近连了名词"`;
/**
 * 学生照 open 的那一项做一下：过裁判、演（和 stage.js 的 studentDo 一样），再照 stage.js 的 judgedAct 拼出挂在这一下上的样子
 * （events.js 写给老师的就是它）
 */
function stu(s, line, open) {
  const [c] = parseScript(line);
  const j = s.judgeLine(c, { by: 'student', open });
  const fx = s.apply(c, { judged: j ?? null });
  const v = j?.verdict || {};
  const next = v.next == null ? null : typeof v.next === 'string' ? v.next : v.next.why || null;
  const act = { type: c.cmd, open, src: j?.src ?? line, ...(j ? { verdict: { legal: v.legal !== false, right: v.right ?? null, misread: v.misread ?? null, why: v.why ?? null, next } } : {}),
    ...(j?.mark ? { marked: true } : {}), ...(fx?.judged?.after?.length ? { facts: fx.judged.after } : {}) };
  return { j, fx, act };
}

test('links= 判连线：连到正确的那一条是对的；对上 ! 那一条说像哪种错（老师写的）；正确的下一步是正确那一条', () => {
  const s = make(`${BOOKS}\nopen s.6 refer`);
  const o = S(s);
  // 下标换成词的 key（挪了词跟着走）
  assert.deepEqual(o.links.pairs, [{ from: 6, to: { keys: [2] } }]);
  assert.deepEqual(o.links.wrongs, [{ from: 6, to: { keys: [5] }, why: '就近连了名词' }]);
  const wrong = stu(s, 'refer s.6 -> s.5', 'refer');
  assert.deepEqual(wrong.j.act, { type: 'refer', from: 6, to: { from: 5, to: 5 } });
  assert.equal(wrong.j.verdict.legal, true);
  assert.equal(wrong.j.verdict.right, false);
  assert.equal(wrong.j.verdict.why, 'that 连到 shelf');
  assert.equal(wrong.j.verdict.misread, '就近连了名词（你在 links= 里写的）');
  assert.equal(eventsText([eventOf(wrong.act)]), '学生 refer s.6 -> s.5（that 连到 shelf）——不是正确的下一步，像是就近连了名词（你在 links= 里写的）；正确的是把 that 连到 s.2（books）');
  assert.equal(R.predicates.linked(o), false);
  assert.match(s.stateText(), /\n {2}links=：收下了（1 条，常见的错连 1 条）/);
  // rewrite 以后作废（和 key 一样）：不判、linked 判不了，现状里写
  const rw = make(`${BOOKS}\nopen s.6 refer`);
  run(rw, 'rewrite s "The books that I bought yesterday on the shelf are new."');
  assert.equal(stu(rw, 'refer s.3 -> s.2', 'refer').j.verdict.right, null);
  assert.throws(() => R.predicates.linked(S(rw)), /links= 跟着 rewrite 作废了/);
  assert.match(rw.stateText(), /links=：作废了/);
  // 改成连到 books：对了，linked 成立
  const right = stu(s, 'refer s.6 -> s.2', 'refer');
  assert.equal(right.j.verdict.right, true);
  assert.equal(right.j.verdict.why, 'that 连到 books');
  assert.deepEqual(o.refers.map((r) => [r.from, r.to, r.toKeys, r.whole, r.by]), [[6, 2, null, false, 'student']], '一个词只连一条：换掉了连到 shelf 的那条');
  assert.equal(R.predicates.linked(o), true);
  assert.deepEqual(right.fx.judged.after, ['links= 的每一条都连对了']);
  // 对不上 ! 的错连：不对，可页面说不出像哪种错
  const odd = stu(make(`${BOOKS}\nopen s.6 refer`), 'refer s.6 -> s.9', 'refer');
  assert.equal(odd.j.verdict.right, false);
  assert.equal(odd.j.verdict.misread, null);
  assert.equal(odd.j.verdict.next.why, '把 that 连到 s.2（books）');
  // 挑战照它判
  const g = make(`${BOOKS}\nopen s.6 refer\ngoal g1 "that 连到它指的词" when="s linked"`);
  assert.equal(stu(g, 'refer s.6 -> s.5', 'refer').fx.goalsMet, undefined);
  assert.deepEqual(stu(g, 'refer s.6 -> s.2', 'refer').fx.goalsMet, ['g1']);
});

test('links= 的写法：一头写词（只出现一次时）、s.6、s.1-2、s（整句）；同一个词有好几个、写错了当场报', () => {
  assert.deepEqual(S(make(`${BOOKS_S} links="s.6 -> s.2"`)).links.pairs, [{ from: 6, to: { keys: [2] } }]);
  assert.deepEqual(S(make(`${BOOKS_S} links="that -> s.1-2"`)).links.pairs, [{ from: 6, to: { keys: [1, 2] } }]);
  assert.deepEqual(S(make(`${BOOKS_S} links="that -> s"`)).links.pairs, [{ from: 6, to: { whole: true } }]);
  assert.equal(S(make(BOOKS_S)).links, undefined, '不写 links= 就没有');
  const e = new Scene();
  assert.equal(err(e, `${BOOKS_S} links="the -> books"`), 'links= 的「the」在句子里有 2 个，写成 s.1 这样的部件');
  assert.match(err(e, `${BOOKS_S} links="that -> cats"`), /links= .*没有「cats」/);
  assert.match(err(e, `${BOOKS_S} links="that books"`), /links= 要写成/);
  assert.match(err(e, `${BOOKS_S} links="that -> that"`), /两头是同一个词/);
  assert.match(err(e, `${BOOKS_S} links="s.1-2 -> s.6"`), /links= 的左边写一个词/);
  assert.match(err(e, `${BOOKS_S} links="that -> books; that -> shelf"`), /「that」连了两条/);
  assert.match(err(e, `${BOOKS_S} links="!that -> shelf"`), /至少写一条/);
  assert.match(err(e, `${BOOKS_S} links="that -> t.2"`), /写 s 里的词/);
});

test('连到一段、整句（同一句）：refer s.6 -> s.1-2、refer s.6 -> s 照 links= 判', () => {
  const span = make(`${BOOKS_S} links="that -> s.1-2"\nopen s.6 refer`);
  const a = stu(span, 'refer s.6 -> s.1-2', 'refer');
  assert.deepEqual(a.j.act, { type: 'refer', from: 6, to: { from: 1, to: 2 } });
  assert.equal(a.j.verdict.right, true);
  assert.equal(a.j.verdict.why, 'that 连到 The books');
  assert.deepEqual(S(span).refers.map((r) => [r.from, r.toKeys, r.whole]), [[6, [1, 2], false]]);
  assert.equal(R.predicates.linked(S(span)), true);
  // 只连到 books 一个词：不是 links= 写的那一段
  const b = stu(make(`${BOOKS_S} links="that -> s.1-2"\nopen s.6 refer`), 'refer s.6 -> s.2', 'refer');
  assert.equal(b.j.verdict.right, false);
  assert.equal(b.j.verdict.next.why, '把 that 连到 s.1-2（The books）');
  // 整句（只测连到整句的写法：英语上 that 连不到整句，别抄进说明）
  const whole = make(`${BOOKS_S} links="that -> s"\nopen s.6 refer`);
  const w = stu(whole, 'refer s.6 -> s', 'refer');
  assert.deepEqual(w.j.act, { type: 'refer', from: 6, to: { whole: true } });
  assert.equal(w.j.verdict.right, true);
  assert.equal(w.j.verdict.why, 'that 连到整句');
  assert.deepEqual(S(whole).refers.map((r) => [r.from, r.toKeys, r.whole]), [[6, null, true]]);
  assert.match(whole.stateText(), /箭头：s\.6 that → 整句/);
  assert.match(span.stateText(), /箭头：s\.6 that → s\.1-2 The books/);
});

test('没写 links= 不判：refer 的 right 是 null；when="s linked" 写下就报', () => {
  const s = make(`${BOOKS_S}\nopen s.6 refer`);
  const r = stu(s, 'refer s.6 -> s.5', 'refer');
  assert.equal(r.j.verdict.legal, true);
  assert.equal(r.j.verdict.right, null);
  assert.equal(r.j.verdict.why, 'that 连到 shelf', '连的是什么照样写');
  assert.equal(eventsText([eventOf(r.act)]), '学生 refer s.6 -> s.5（that 连到 shelf）');
  assert.deepEqual(r.fx.judged.after, []);
  assert.match(err(s, 'goal g1 "连好" when="s linked"'), /没写 links=/);
  assert.throws(() => R.predicates.linked(S(s)), /s 没写 links=，页面判不了 linked/);
  // links= 里没写 that 连谁的词：也不判
  const x = make(`${BOOKS_S} links="that -> books"\nopen s refer`);
  assert.equal(stu(x, 'refer s.8 -> s.2', 'refer').j.verdict.right, null);
  // 连到自己：这一下做不到
  assert.equal(x.judgeLine(parseScript('refer s.6 -> s.6')[0], { by: 'student', open: 'refer' }).verdict.legal, false);
});

test('refer 进了页面判对错的动作：能写 wrong=（mark 一样），fold 照旧不能；做完照旧只看 mark', () => {
  assert.doesNotThrow(() => make(`${BOOKS}\nopen s.6 refer wrong=mark`));
  assert.throws(() => make(`${BOOKS}\nopen s fold wrong=mark`), /判不了对错/);
  assert.deepEqual(R.judges, ['mark', 'refer']);
  assert.deepEqual(R.doneBy, ['mark']);
  // wrong=mark：连错的那一下照做、淡淡圈着
  const s = make(`${BOOKS}\nopen s.6 refer wrong=mark`);
  const r = stu(s, 'refer s.6 -> s.5', 'refer');
  assert.equal(r.j.mark, true);
  assert.equal(S(s).refers.length, 1);
  // 钩和拉括号抓的地方不一样：同一句上能一起开
  assert.doesNotThrow(() => make(`${BOOKS}\nopen s mark\nopen s.6 refer`));
  // 拉线不算「做完」：只开了 refer 的句子不会因为连对了就叫「做完了」
  const k = make(`${BOOKS_S} key="[S The books on the shelf [RC that I bought yesterday]] [V are] [P new]." links="that -> books"\nopen s.6 refer`);
  assert.equal(k.doneOpen('s'), false);
});

test('Attr/NF：key 里一段写几种成分，哪一种都算对；学生把它当谓语时说「把非谓语当成了谓语」', () => {
  const FUND = 'sentence s = "A fund designed to help small businesses grew." key="[S A fund [Attr/NF designed [NF to help small businesses]]] [V grew]."';
  const o = S(make(FUND));
  assert.deepEqual(o.key.spans.map((x) => [x.role, x.roles, x.keys.join(' ')]), [
    ['S', ['S'], '1 2 3 4 5 6 7'], ['Attr', ['Attr', 'NF'], '3 4 5 6 7'], ['NF', ['NF'], '4 5 6 7'], ['V', ['V'], '8'],
  ]);
  const s = make(FUND);
  assert.equal(R.check(S(s), mk(3, 7, '定语'), s).right, true);
  assert.equal(R.check(S(s), mk(3, 7, 'NF'), s).right, true);
  assert.equal(R.check(S(s), mk(3, 7, '非谓语'), s).right, true);
  assert.equal(R.check(S(s), mk(3, 7, 'Attr'), s).right, true);
  assert.match(R.check(S(s), mk(3, 3, 'V'), s).misread, /把非谓语当成了谓语/);
  assert.match(R.check(S(s), mk(3, 7, '主语'), s).misread, /成分标错了：这一段是定语或非谓语，不是主语/);
  // 拉成哪一种，parsed 都算这一段拉对了
  run(s, 'mark s.1-7 S\nmark s.3-7 非谓语\nmark s.4-7 NF\nmark s.8 V');
  assert.equal(R.predicates.parsed(S(s)), true);
  // 写错了照旧当场报
  assert.match(err(new Scene(), 'sentence s = "A fund grew." key="[S A fund] [V/Xyz grew]."'), /成分「Xyz」认不出/);
});

test('两种错一起：成分不对、范围差一两个词时，挑重叠最多的那一段 key，范围和成分一起说', () => {
  const GOAL = 'sentence s = "The goal is to direct these funds better." key="[S The goal] [V is] [P to direct these funds better]."';
  const s = make(GOAL);
  const v = R.check(S(s), mk(4, 7, 'O'), s);
  assert.equal(v.right, false);
  assert.equal(v.misread, '成分标错了，范围也差一点：这一段是表语（to direct these funds better），学生拉的少了 better');
  // 从同一个词起头、多拉了：照说「多了」
  const cat = make(CAT);
  assert.equal(R.check(S(cat), mk(10, 13, 'P'), cat).misread, '成分标错了，范围也差一点：这一段是宾语（a small-scale study），学生拉的多了 in');
  // 跨过 key 一段的边（本来就和 key 冲突）：照说，头尾差在哪都说
  const man = make(MAN);
  const x = R.check(S(man), mk(2, 5, 'P'), man);
  assert.equal(x.right, false);
  assert.equal(x.misread, '成分标错了，范围也差一点：这一段是定语从句（who lives next door），学生拉的少了 door，多了 man');
  // 不说假话（复核找到的反例）：整个落在 key 一段里、不从同一个词起头的，可能正是 key 没拆的那一层——these funds 是 directing 的宾语
  for (const [src, a, b] of [['sentence s = "His job is directing these funds." key="[S His job] [V is] [P directing these funds]."', 5, 6], ['sentence s = "Their aim is helping small firms." key="[S Their aim] [V is] [P helping small firms]."', 5, 6]]) {
    const t = make(src);
    for (const role of ['O', '宾语']) {
      const r = R.check(S(t), mk(a, b, role), t);
      assert.equal(r.right, null, `${src} ${a}-${b} ${role}`);
      assert.equal(r.misread ?? null, null);
    }
  }
  // 简报那一句里也一样：只占了那一段的一小半、不从同一个词起头（these funds）不判；包住 is 又不从同一个词起头的（is to direct …）也不判
  assert.equal(R.check(S(s), mk(6, 7, 'O'), s).right, null);
  assert.equal(R.check(S(s), mk(3, 8, 'O'), s).right, null);
  // 从同一个词起头、可成分和 key 那一段不是一类：可能是换个角度说同一段（to pay 标非谓语说的是动词的样子），不说
  assert.equal(R.check(S(s), mk(4, 7, '状语'), s).right, null);
  const house = make(HOUSE);
  assert.equal(R.check(S(house), mk(7, 8, '非谓语'), house).right, null);
  assert.match(R.check(S(house), mk(7, 8, '表语'), house).misread, /^成分标错了，范围也差一点：这一段是宾语（to pay attention），学生拉的少了 attention$/);
  // 范围对了、成分不对，照旧只说成分；成分对了、范围不对，照旧说断早断晚
  assert.match(R.check(S(s), mk(4, 8, 'O'), s).misread, /^成分标错了：这一段是表语，不是宾语$/);
  assert.match(R.check(S(s), mk(4, 7, 'P'), s).misread, /表语这一段断早了/);
});

test('exact：key 的每一段都拉对了、也没多拉；parsed 不管多拉的', () => {
  const s = make(`${MAN}\nopen s mark\ngoal g1 "拆完、不多拉" when="s exact"`);
  for (const l of ['mark s.1-6 S', 'mark s.3-6 RC', 'mark s.7 V']) stuMark(s, l);
  assert.equal(s.goals.get('g1').met, true, '刚好拉对');
  const t = make(`${MAN}\nopen s mark`);
  for (const l of ['mark s.1-6 S', 'mark s.3-6 RC', 'mark s.7 V', 'mark s.8-9 P']) stuMark(t, l);
  assert.equal(R.predicates.parsed(S(t)), true);
  assert.equal(R.predicates.exact(S(t)), false, '多拉了 a doctor');
  run(t, 'unmark s.8-9');
  assert.equal(R.predicates.exact(S(t)), true);
  // 拉对的段成分写错一道：parsed、exact 都不成立
  stuMark(t, 'mark s.8-9 P');
  stuMark(t, 'mark s.7 S');
  assert.equal(R.predicates.parsed(S(t)), false);
  assert.equal(R.predicates.exact(S(t)), false);
  // 老师自己拉的、key 里没有的括号不算学生多拉的
  const u = make(`${MAN}\nmark s.8-9 表语\nopen s mark`);
  for (const l of ['mark s.1-6 S', 'mark s.3-6 RC', 'mark s.7 V']) stuMark(u, l);
  assert.equal(R.predicates.exact(S(u)), true);
  assert.throws(() => R.predicates.exact(S(make('sentence s = "He runs."'))), /没写 key=.*判不了 exact/);
});

test('中文的括号字：学生点「定语」交出 mark s.2-6 定语；现状里两种名字都写，事实只写括号上的那一个', () => {
  const s = make('sentence s = "Policies designed to help small businesses often fail." key="[S Policies [Attr designed [NF to help small businesses]]] often [V fail]."\nopen s mark');
  const o = S(s);
  const word = (k) => o.words.find((w) => w.slot === k);
  const g = gestureOf(o, 'mark');
  const pick = askFor(g, o, 'span', { from: word(2), to: word(6) });
  const attr = pick.choices.find((c) => c.text === '定语');
  assert.deepEqual([attr.value, attr.sub], ['定语', 'Attr'], '按钮上中文、小字缩写，交中文');
  const r = g.toAct(o, { from: word(2), to: word(6), role: attr.value });
  assert.equal(r.src, 'mark s.2-6 定语');
  const fx = stuMark(s, r.src);
  assert.equal(fx.judged.verdict.right, true);
  assert.match(s.stateText(), /s\.2-6 定语（Attr）/);
  assert.ok(fx.judged.after.some((f) => f.includes('标成定语（designed to help small businesses）')), fx.judged.after.join('\n'));
  assert.ok(fx.judged.after.every((f) => !f.includes('（Attr）')), fx.judged.after.join('\n'));
  // 老师写缩写：现状里也写成两种名字
  const t = make('sentence s = "Policies designed to help small businesses often fail."\nmark s.2-6 Attr\nmark s.8 V\nmark s.1 主语');
  assert.match(t.stateText(), /括号（词下面）：s\.2-6 定语（Attr），紫；s\.8 谓语（V），粉；s\.1 主语（S），蓝/);
  assert.equal(roleAbbr('定语'), 'Attr');
  assert.equal(roleAbbr('谓语1'), 'V1');
  assert.equal(roleAbbr('Adv'), 'Adv', '缩写照老师写的');
  assert.equal(roleAbbr('插入语'), null);
});
