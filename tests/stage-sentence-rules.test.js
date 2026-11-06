// 句子（拆成分）的规则（kit/src/stage/types/sentence.rules.js）：造句子时的 key=（老师给的正确拆法，页面不自己分析语法）、
// 逐词比、认四种错法（谓语只圈一半、非谓语当谓语、断早断晚、成分标错）、下一步、判断式、手势表。
// 句子取自缺口尺子 E2、E3 理想演法里的真题句（evals/stage-gaps/ideal/E3.md）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { sentenceRules as R, actSrc, roleName } from '../kit/src/stage/types/sentence.rules.js';
import { rulesOf, predicateOf, gestureOf, done } from '../kit/src/stage/rules.js';
import { parseBrackets, judgeSpans } from '../kit/src/entext.js';

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
  assert.equal(roleName('v'), '谓语', '缩写不管大小写');
});

test('key=：照括号写法读成正确拆法，存在 o.key（每段记词的编号，挪了词跟着走）', () => {
  const o = S(make(MAN));
  assert.deepEqual(o.key.spans.map((x) => [x.role, x.keys.join(' '), x.depth]), [
    ['S', '1 2 3 4 5 6', 0], ['RC', '3 4 5 6', 1], ['V', '7', 0],
  ]);
  // 大小写、标点前后的空格不管；句末的点写不写都行（只比词）
  const o2 = S(make('sentence s = "He has been running." key="[s he] [V HAS been running]"'));
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
    const ans = parseBrackets(key);
    const tokOf = ans.tokens.filter((t) => t.word).map((t) => t.i); // 第几个词 → 记号下标
    const roles = [...new Set(ans.spans.map((x) => x.role))];
    for (let a = 1; a <= o.words.length; a++) {
      for (let b = a; b <= Math.min(o.words.length, a + 4); b++) {
        for (const role of roles) {
          const mine = judgeSpans([{ role, from: tokOf[a - 1], to: tokOf[b - 1] }], ans.spans).right.length === 1;
          assert.equal(R.check(o, mk(a, b, role), s).right, mine, `${text.slice(0, 20)}… s.${a}-${b} ${role}`);
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

test('把非谓语当成了谓语：圈的是 to do / doing / done，key 里它不是谓语', () => {
  const s = make(POLICY);
  const o = S(s);
  // 圈 help（前面是 to）、to help、designed、整段非谓语
  for (const [a, b] of [[4, 4], [3, 4], [2, 2], [2, 6]]) {
    const v = R.check(o, mk(a, b, 'V'), s);
    assert.equal(v.right, false);
    assert.match(v.misread, /把非谓语当成了谓语/, `圈 s.${a}-${b} 当谓语`);
  }
  assert.match(R.check(o, mk(4, 4, 'V'), s).misread, /to help 是 to do/);
  assert.match(R.check(o, mk(2, 2, 'V'), s).misread, /designed 是 done/);
  assert.equal(R.check(o, mk(8, 8, 'V'), s).right, true, '真的谓语是 fail');
  // 把后面的 to pay 也圈进了谓语
  const h = make(HOUSE);
  const v = R.check(S(h), mk(5, 8, 'V'), h);
  assert.match(v.misread, /把非谓语当成了谓语/);
  assert.match(v.misread, /to pay/);
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
  // 写的成分 key 里没有：看别的成分的一段
  assert.match(R.check(o, mk(3, 7, '从句'), s).misread, /从句断晚了：定语从句是「who lives next door」/);
  // 不是断错了地方的不硬说：lives 标成谓语（从句里的谓语，key 没拉）、running 标成非谓语（它在谓语 has been running 里）
  assert.equal(R.check(o, mk(4, 4, 'V'), s).misread, null);
  const r = make('sentence s = "He has been running." key="[S He] [V has been running]."');
  assert.equal(R.check(S(r), mk(4, 4, '非谓语'), r).misread, null);
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
  assert.equal(R.predicates.parsed(o), null, '没有 key 判不了');
  assert.equal(R.predicates.main(o), null);
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

test('改写整句以后原来的 key 不再对得上：作废，不判', () => {
  const s = make(MAN);
  run(s, 'rewrite s "The man living next door is a doctor."');
  assert.equal(S(s).key, undefined);
  assert.equal(R.check(S(s), mk(7, 7, 'V'), s).right, null);
});
