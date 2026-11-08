// 样子页的三段试手感（proto/stage/feel.js）：照老师看的说明写的三段指令一行不落地演得上；学生照手势表做的几下（不碰 DOM：gestureAct 翻成一行、
// 过裁判、走场景，和舞台上手指拖的一样）做得到挑战、做得完、引出预写的那一句；走偏的那一下裁判怎么判、角上那一块写什么。
// 画面那一半（真的触摸、键盘、成分那一排）靠浏览器里走一遍
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { gestureAct } from '../kit/src/stage/gestures.js';
import { FEELS, refereeEntry, goalEntry } from '../proto/stage/feel.js';

const setUp = (key) => { const s = new Scene(); for (const c of parseScript(FEELS[key].script)) s.apply(c); return s; };
const part = (s, ref) => s.parts(ref)[0];
/**
 * 学生照 open 的那一项做一下（和 stage.js 的 studentDo → exec 一样：先过裁判，被拦的不演；引出的预写照老师的行演，宽松地演）。
 * 返回 { src, judged, fx, said（预写里说的话）}
 */
function student(s, action, ctx) {
  const e = [...s.opens.values()].find((x) => x.action === action);
  const r = gestureAct(s, e, ctx);
  assert.ok(!r.error, r.error);
  const [c] = parseScript(r.src);
  const j = s.judgeLine(c, { by: 'student', open: action });
  const fx = s.apply(c, { judged: j ?? null });
  const said = [];
  for (const x of fx.reactions || []) for (const rc of parseScript(x.src)) { s.apply({ ...rc, lenient: true }); if (rc.cmd === 'say') said.push(rc.args.find((a) => a.t === 'str').v); }
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

test('拆句子：只拉 The man 当主语照做、只记下；四段拉对做完，演「对。」一次、折起从句、「拆完了」', () => {
  const s = setUp('parse');
  const w = (k) => part(s, `s#${k}`);
  const wrong = student(s, 'mark', { from: w(1), to: w(2), role: 'S' });
  assert.equal(wrong.src, 'mark s.1-2 S');
  assert.equal(wrong.judged.verdict.right, false);
  assert.equal(wrong.judged.apply, true);
  assert.match(refereeEntry(actOf(wrong)).lines.find(([k]) => k === '画面')[1], /只记下（wrong=quiet）/);
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
  assert.deepEqual(goalEntry([{ text: '把树转平' }], { reacted: 1 }).lines, [['预写', '马上演了老师预写的 1 行']]);
});
