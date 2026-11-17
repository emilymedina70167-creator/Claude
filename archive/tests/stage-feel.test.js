// 样子页的三段试手感（proto/stage/feel.js）：照老师看的说明写的三段指令一行不落地演得上；学生照手势表做的几下（不碰 DOM：gestureAct 翻成一行、
// 过裁判、走场景，和舞台上手指拖的一样）做得到挑战、做得完、引出预写的那一句；走偏的那一下裁判怎么判、角上那一块写什么。
// 画面那一半（真的触摸、键盘、成分那一排）靠浏览器里走一遍
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun, pickAnswer } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { gestureAct, closeAct } from '../kit/src/stage/gestures.js';
import { FEELS, refereeEntry, goalEntry } from '../proto/stage/feel.js';

const setUp = (key) => { const s = new Scene(); for (const c of parseScript(FEELS[key].script)) s.apply(c); return s; };
const part = (s, ref) => s.parts(ref)[0];
/**
 * 学生照 open 的那一项做一下（和 stage.js 的 studentDo → exec 一样：先过裁判，被拦的不演；引出的预写照老师的行演，宽松地演，记成预写）。
 * 返回 { src, judged, fx, said（预写里说的话）}
 */
function student(s, action, ctx) {
  const e = [...s.opens.values()].find((x) => x.action === action);
  const r = gestureAct(s, e, ctx);
  assert.ok(!r.error, r.error);
  const [c] = parseScript(r.src);
  const j = s.judgeLine(c, { by: 'student', open: action });
  const fx = s.apply(c, { by: 'student', judged: j ?? null, open: action });
  const said = [];
  // 照 stage.js 的 react 演（lenient、prewrite：预写里写出的挑战接得上它自己的下一层 @g2）
  for (const x of fx.reactions || []) for (const rc of parseScript(x.src)) { s.apply({ ...rc, lenient: true, prewrite: true }); if (rc.cmd === 'say') said.push(rc.args.find((a) => a.t === 'str').v); }
  return { src: r.src, judged: j, fx, said };
}
// 舞台交给 onAct 的样子（stage.js 的 judgedAct）：角上那一块照它写
const actOf = ({ src, judged }) => ({
  src, verdict: { ...judged.verdict, next: typeof judged.verdict.next === 'string' ? judged.verdict.next : judged.verdict.next?.why ?? null },
  ...(judged.apply ? {} : { blocked: true }), ...(judged.mark ? { marked: true } : {}), facts: judged.apply ? judged.after || [] : [],
});

test('三段指令照说明写，一行不落都演得上（@ 的行写下时也在今天的舞台上试过）', () => {
  for (const [key, f] of Object.entries(FEELS)) {
    assert.deepEqual(dryRun(new Scene(), f.script), [], `${key} 有没演的行`);
    assert.ok(f.title && f.how, `${key} 要有名字和「怎么动」`);
  }
});

test('平衡二叉树：插之前转一下不让做；47 拖进树做到第一个挑战、换成 wrong=mark undo=on；转错淡淡圈着；在 40 左旋转平，演「平了」', () => {
  const s = setUp('avl');
  assert.equal(s.goals.get('g1').met, false);
  // 插之前就转（30 那里左旋）：树本来平衡，不是正确的下一步，开头写的是 wrong=block
  const early = student(s, 'rotate', { from: part(s, 't.40'), to: part(s, 't.30') });
  assert.equal(early.src, 'rotate t#1 left');
  assert.equal(early.judged.apply, false);
  assert.equal(early.judged.verdict.misread, '树已经平衡了，不用转');
  assert.equal(s.goals.get('g1').met, false, '转一下多出一层也不算（没让做）');
  // 47 拖进树：多了一层，做到 g1；预写换了开法、出了第二个挑战
  const ins = student(s, 'insert', { value: '47', to: { tree: 't' } });
  assert.equal(ins.src, 'insert t 47');
  assert.equal(ins.judged.verdict.right, true);
  assert.deepEqual(ins.fx.goalsMet, ['g1']);
  assert.match(ins.said.join(''), /失衡了/);
  assert.deepEqual(s.opens.get('t:rotate').policy, { wrong: 'mark', call: null, undo: true });
  assert.equal(s.goals.get('g2').met, false);
  // 转错：在 30 左旋（不是最小不平衡子树）——照做、淡淡圈着
  const snap = s.clone();
  const wrong = student(s, 'rotate', { from: part(s, 't.40'), to: part(s, 't.30') });
  assert.equal(wrong.judged.verdict.right, false);
  assert.equal(wrong.judged.mark, true);
  assert.ok(s.parts('t').some((p) => p.slip), '那一处淡淡圈着');
  assert.equal(s.goals.get('g2').met, false, '转错了树还失衡');
  const e = refereeEntry(actOf(wrong));
  assert.equal(e.tone, 'wrong');
  assert.deepEqual(e.lines.map(([k]) => k), ['正确的', '画面', '之后']);
  assert.match(e.lines[0][1], /在 40 左旋/);
  assert.match(e.lines[1][1], /淡淡圈了一下（wrong=mark）/);
  assert.match(e.lines[2][1], /还失衡/);
  // 照撤一步退回去（舞台照 log 重放；这里拿转之前的样子接着做）
  const right = student(snap, 'rotate', { from: part(snap, 't.45'), to: part(snap, 't.40') });
  assert.equal(right.judged.verdict.right, true);
  assert.deepEqual(right.fx.goalsMet, ['g2']);
  assert.deepEqual(right.fx.done, ['t']);
  assert.match(right.said.join(''), /^平了/);
});

test('消元：倍数写错淡淡圈着第 2 行、说倍数不对；r₂ − 2r₁ 一步成阶梯形，演预写的那一句', () => {
  const s = setUp('elim');
  const snap = s.clone();
  const wrong = student(s, 'rowop', { from: { row: 1 }, to: { row: 2 }, value: '-1' });
  assert.equal(wrong.src, 'rowop M r2 - r1');
  assert.equal(wrong.judged.verdict.right, false);
  assert.ok(s.parts('M.r2').every((p) => p.slip) && !s.parts('M.r1').some((p) => p.slip), '只圈改了的第 2 行');
  const e = refereeEntry(actOf(wrong));
  assert.match(e.lines.find(([k]) => k === '像是')[1], /倍数不对/);
  assert.match(e.lines.find(([k]) => k === '正确的')[1], /r₂ − 2r₁/);
  const right = student(snap, 'rowop', { from: { row: 1 }, to: { row: 2 }, value: '-2' });
  assert.equal(right.src, 'rowop M r2 - 2r1');
  assert.deepEqual(right.fx.goalsMet, ['g1']);
  assert.deepEqual(right.fx.done, ['M']);
  assert.match(right.said.join(''), /成了阶梯形/);
});

test('拆句子：只拉 The man 当主语照做、那两个词淡淡圈着；四段拉对做完，演「对。」一次、折起从句、「拆完了」', () => {
  const s = setUp('parse');
  const w = (k) => part(s, `s#${k}`);
  const wrong = student(s, 'mark', { from: w(1), to: w(2), role: 'S' });
  assert.equal(wrong.src, 'mark s.1-2 S');
  assert.equal(wrong.judged.verdict.right, false);
  assert.equal(wrong.judged.apply, true);
  assert.equal(wrong.judged.mark, true);
  assert.deepEqual(s.parts('s').filter((p) => p.slip).map((p) => p.key), [1, 2], '拉错的那一段淡淡圈着');
  assert.match(refereeEntry(actOf(wrong)).lines.find(([k]) => k === '画面')[1], /淡淡圈了一下（wrong=mark）/);
  const t = setUp('parse');
  const v = (k) => part(t, `s#${k}`);
  const said = [];
  for (const [a, b, role] of [[1, 6, 'S'], [3, 6, 'RC'], [7, 7, 'V'], [8, 9, 'P']]) {
    const r = student(t, 'mark', { from: v(a), to: v(b), role });
    assert.equal(r.judged.verdict.right, true, `${a}-${b} ${role}`);
    said.push(...r.said);
    if (role === 'P') { assert.deepEqual(r.fx.goalsMet, ['g1']); assert.deepEqual(r.fx.done, ['s']); }
  }
  assert.deepEqual(said, ['对。接着拉别的成分。', '拆完了。从句折起来，主干就是 The man is a doctor.']);
  assert.equal(t.objects.get('s').folds.length, 1, '预写的 fold 折起了从句');
});

test('角上那一块只照裁判给的写：做不到、页面不判、撤一步、做到挑战', () => {
  assert.deepEqual(refereeEntry({ src: 'rowop M 0r1', verdict: { legal: false, right: false, why: 'r1 乘 0 做不到', next: null }, blocked: true }),
    { tone: 'cant', head: 'rowop M 0r1', src: '', verdict: '做不到', lines: [['为什么', 'r1 乘 0 做不到'], ['画面', '没演，弹回去了']] });
  assert.equal(refereeEntry({ src: 'write M.1,2 3/4' }).verdict, '页面不判这一下');
  assert.equal(refereeEntry({ type: 'undo', src: 'rotate t#1 left' }).head, '撤回了上一下');
  assert.equal(refereeEntry({ src: 'x', verdict: { legal: true, right: true, why: '40 左旋' }, facts: ['现在每个结点都平衡了'] }).lines[0][1], '现在每个结点都平衡了');
  assert.deepEqual(goalEntry([{ text: '把树转平' }], { reacted: 1 }), { tone: 'goal', head: '做到了挑战「把树转平」', src: '', verdict: '马上演了老师预写的 1 行', lines: [] });
});

test('角上那一块：ask pick 交上来的几样照页面和 expect 比的写（一样、多点、漏点、没写 expect 不判）', () => {
  assert.deepEqual(refereeEntry({ type: 'pick', refs: ['BA.1,1', 'BA.2,2'], expected: 'BA.1,1 BA.2,2', same: true, extra: [], missing: [] }),
    { tone: 'right', head: '点了 BA.1,1、BA.2,2', src: '', verdict: '和预期的一样', lines: [] });
  assert.deepEqual(refereeEntry({ type: 'pick', refs: ['BA.1,1', 'BA.1,2'], expected: 'BA.1,1 BA.2,2', same: false, extra: ['BA.1,2'], missing: ['BA.2,2'] }).lines, [['多点了', 'BA.1,2'], ['漏了', 'BA.2,2']]);
  assert.equal(refereeEntry({ type: 'pick', refs: ['t.45'], expected: null, same: null, extra: [], missing: [] }).verdict, '页面不判这一下');
});

// —— 第二轮的三段（树：插、转、回到、摘；整张矩阵：比、合计、并；同一句上：拉、折、拖、连线）——
// 学生交的一行照舞台那样走（studentDo → exec → apply，带 open）；不是手势表里的（back、pick、compare 不过裁判）直接交那一行
const line = (s, src, open) => {
  const [c] = parseScript(src);
  const j = s.judgeLine(c, { by: 'student', open });
  const fx = s.apply(c, { by: 'student', judged: j ?? null, open });
  const said = [];
  for (const x of fx.reactions || []) for (const rc of parseScript(x.src)) { s.apply({ ...rc, lenient: true, prewrite: true }); if (rc.cmd === 'say') said.push(rc.args.find((a) => a.t === 'str').v); }
  return { judged: j, fx, said };
};
const treeLine = (s) => s.stateText().match(/^树 t[^\n]*/m)?.[0] || '';

test('树（第二轮）：80 拖进树做到 g1、开转和「回到插入后」；转错淡淡圈着，点「回到插入后」照原样；在 60 左旋转平换成摘叶子；点里面的结点只能摘叶子，摘一片还平，演最后一句', () => {
  const s = setUp('bst');
  assert.equal(s.objects.get('t').layout, 'inorder', '二叉排序树按中序排');
  const ins = student(s, 'insert', { value: '80', to: { tree: 't' } });
  assert.equal(ins.src, 'insert t 80');
  assert.deepEqual(ins.fx.goalsMet, ['g1']);
  assert.match(ins.said.join(''), /^失衡了/);
  assert.ok(s.opens.has('t:rotate') && s.opens.has('t:back:插入后'), '@g1 开了转和「回到插入后」');
  assert.deepEqual(s.opens.get('t:rotate').policy, { wrong: 'mark', call: null, undo: false });
  const saved = treeLine(s);
  assert.match(saved, /层序 40 20 60 10 30 _ 70 _ _ _ _ _ 80$/);
  // 转错：在根 40 左旋（最小不平衡子树的根是 60）——照做、淡淡圈着
  const wrong = student(s, 'rotate', { from: part(s, 't.60'), to: part(s, 't.40') });
  assert.equal(wrong.judged.verdict.right, false);
  assert.equal(wrong.judged.mark, true);
  assert.notEqual(treeLine(s), saved);
  line(s, 'back t "插入后"', 'back');
  assert.equal(treeLine(s), saved, '回到插入后的样子');
  const right = student(s, 'rotate', { from: part(s, 't.70'), to: part(s, 't.60') });
  assert.equal(right.judged.verdict.right, true);
  assert.deepEqual(right.fx.goalsMet, ['g2']);
  assert.match(right.said.join(''), /^平了/);
  assert.ok(!s.opens.has('t:rotate') && s.opens.has('t:pluck'), '@g2 收了转、开了摘叶子');
  const e = s.opens.get('t:pluck');
  assert.match(gestureAct(s, e, { from: part(s, 't.20') }).error, /只能摘叶子/);
  const pl = student(s, 'pluck', { from: part(s, 't.10') });
  assert.match(pl.src, /^delete t#\d+$/);
  assert.deepEqual(pl.fx.goalsMet, ['g3']);
  assert.match(pl.said.join(''), /^摘完还是平的/);
});

test('整张矩阵（第二轮）：AB 拖到 BA 上逐格比（两张都不变）；点对 BA 里不一样的两格演 @ask.right、开放进合计；AB、BA 都放进 Sum 做到 g1，出 X、Y；X 并进 Y 做到 g2', () => {
  const s = setUp('whole');
  const cells = (id) => s.objects.get(id).cells.map((x) => x.value).join(' ');
  const [ab, ba] = [cells('AB'), cells('BA')];
  const cmp = gestureAct(s, s.opens.get('AB:compare'), { from: { obj: 'AB', whole: true }, to: { obj: 'BA', whole: true } });
  assert.equal(cmp.src, 'compare AB BA');
  const c = line(s, cmp.src, 'compare');
  assert.ok(c.fx.compare, '逐格比的结果交给了老师那一句');
  assert.deepEqual([cells('AB'), cells('BA')], [ab, ba], '两张都没变');
  // 那一问：点 BA 里和 AB 不一样的两格，答对了才演 @ask.right
  const w = s.waiting;
  assert.equal(w.kind, 'pick');
  assert.equal(pickAnswer(s, ['BA.1,1', 'BA.2,2'], w.expect).same, true);
  assert.equal(pickAnswer(s, ['BA.1,1'], w.expect).same, false);
  const said = [];
  for (const src of w.right) for (const rc of parseScript(src)) { s.apply({ ...rc, lenient: true, prewrite: true }); if (rc.cmd === 'say') said.push(rc.args.find((a) => a.t === 'str').v); }
  assert.match(said.join(''), /^对，换了先后就不一样/);
  assert.ok(!s.opens.has('AB:compare') && s.opens.has('AB:put') && s.opens.has('BA:put'));
  const put = (id) => line(s, gestureAct(s, s.opens.get(`${id}:put`), { from: { obj: id, whole: true }, to: { obj: 'Sum', whole: true } }).src, 'put');
  assert.deepEqual(put('AB').fx.goalsMet || [], [], '只放进 AB：Sum.1,1 是 7');
  const p2 = put('BA');
  assert.deepEqual(p2.fx.goalsMet, ['g1']);
  assert.equal(cells('Sum'), '8 4 6 8');
  assert.match(p2.said.join(''), /并不成一项/);
  const m = line(s, gestureAct(s, s.opens.get('X:merge'), { from: { obj: 'X', whole: true }, to: { obj: 'Y', whole: true } }).src, 'merge');
  assert.deepEqual(m.fx.goalsMet, ['g2']);
  assert.ok(!s.objects.has('X'), 'X 拿下了舞台');
  assert.equal(cells('Y'), '-1 -2 0 -1');
  assert.match(m.said.join(''), /^2A − 3A 并成了 −A/);
});

test('同一句上（第二轮）：mark、fold、move 一起开；拉错了点 ✕ 收掉；三段拉对出 who 的钩；连对了出把从句挪回 man 后面的挑战，挪完演最后一句；再点括号折起来', () => {
  const s = setUp('hands');
  for (const a of ['mark', 'fold', 'move']) assert.ok(s.opens.has(`s:${a}`), `开着 ${a}`);
  const w = (k) => part(s, `s#${k}`);
  // 拉错：came into 当谓语（key 的谓语只有 came）——照做、淡淡圈着；点 ✕ 收掉
  const bad = student(s, 'mark', { from: w(3), to: w(4), role: '谓语' });
  assert.equal(bad.judged.verdict.right, false);
  assert.equal(bad.judged.mark, true);
  const m = s.objects.get('s').marks.find((x) => x.by === 'student');
  const x = closeAct(s, s.opens.get('s:mark'), { from: { mark: m.id } });
  assert.equal(x.src, 'unmark s.3-4');
  line(s, x.src, 'mark');
  assert.equal(s.objects.get('s').marks.length, 0);
  const said = [];
  for (const [a, b, role] of [[1, 2, '主语'], [3, 3, '谓语'], [7, 12, '定语从句']]) {
    const r = student(s, 'mark', { from: w(a), to: w(b), role });
    assert.equal(r.judged.verdict.right, true, `${a}-${b} ${role}`);
    said.push(...r.said);
  }
  assert.equal(s.goals.get('g1').met, true);
  assert.match(said.join(''), /^对。who 指的是谁/);
  assert.ok(s.opens.has('s:refer'));
  const ref = student(s, 'refer', { from: w(7), to: w(2) });
  assert.equal(ref.src, 'refer s.7 -> s.2');
  assert.deepEqual(ref.fx.goalsMet, ['g2']);
  assert.match(ref.said.join(''), /^连对了/);
  // 按住从句的括号拖到 man 后面：挪完是 A man who was wearing a red hat came into the room.
  const rc = s.objects.get('s').marks.find((mk) => mk.keys.length === 6);
  const mv = student(s, 'move', { from: { mark: rc.id }, to: { gap: { after: 2 } } });
  assert.equal(mv.src, 'move s.7-12 after s.2');
  assert.deepEqual(mv.fx.goalsMet, ['g3']);
  assert.match(mv.said.join(''), /^从句回到 man 后面/);
  assert.equal(student(s, 'fold', { from: { mark: rc.id } }).src, 'fold s.3-8');
});
