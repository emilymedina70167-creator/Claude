// 照引擎走的通用那一半（kit/src/stage/follow.js，主线第四轮）：路、现在在哪、盖在规则上面的判法、事实、量、现状。
// 用一个假的引擎和假的对应关系（接在一排格子上），不依赖真引擎
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { rulesOf, evalMeasure } from '../kit/src/stage/rules.js';
import { registerFollow, whereOf, traceOf } from '../kit/src/stage/follow.js';

// 假引擎：第 1 趟把头两个里大的换到后面，第 2 趟整个排好；错法（variant）第 1 趟换的是最后两个。数里有 9 的不收
const nums = (spec) => String(spec.array).split(/\s+/).map(Number);
const fakeEngine = {
  parse(f) { if (/\b9\b/.test(String(f.array))) throw new Error('fake 不收 9'); return { ...f }; },
  run(spec) {
    const v = nums(spec), ids = v.map((_, i) => i);
    const steps = [{ ids: [...ids] }];
    const p1 = [...ids];
    if (spec.variant) [p1[p1.length - 2], p1[p1.length - 1]] = [p1[p1.length - 1], p1[p1.length - 2]];
    else if (v[0] > v[1]) [p1[0], p1[1]] = [p1[1], p1[0]];
    steps.push({ ids: p1, pass: 1 });
    if (!spec.variant) steps.push({ ids: [...ids].sort((a, b) => v[a] - v[b]), pass: 2 });
    return { steps, values: v };
  },
  variants: (spec) => [{ label: '像是换了最后两个', input: { ...spec, variant: true } }],
};
registerFollow('fake', {
  engine: fakeEngine, types: ['array'], subjects: [], head: 'mode', unit: '趟', word: '格', title: () => 'fake',
  fields: (o, opts) => ({ ...opts, array: [...o.cells].sort((a, b) => a.slot - b.slot).map((c) => c.value).join(' ') }),
  snap: (o) => [...o.cells].sort((a, b) => a.slot - b.slot).map((c) => c.key),
  dataOf: (o) => [...o.cells].sort((a, b) => String(a.key).localeCompare(String(b.key))).map((c) => `${c.key}=${c.value}`).join(','),
  stateOf: (o, scene, snap) => [...o.cells].sort((a, b) => a.slot - b.slot).map((c) => snap.indexOf(c.key)).join(' '),
  cellsOf: (o) => [...o.cells].sort((a, b) => a.slot - b.slot).map((c) => c.value),
  nameOf: (i) => `第 ${i + 1} 格`,
  frames: (run) => run.steps.map((s) => ({ state: s.ids.join(' '), cells: s.ids.map((i) => String(run.values[i])), ...(s.pass ? { mark: s.pass } : {}) })),
});

const run = (s, src, opt) => { let fx; for (const c of parseScript(src)) fx = s.apply(c, opt); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const stu = (s, src) => s.apply(parseScript(src)[0], { by: 'student', open: 'move' });
const obj = (s, id = 'a') => s.objects.get(id);
const pick = (w) => ({ at: w.at, passed: w.passed, total: w.total, done: w.done, like: w.like, off: w.off });
const said = (fx) => [...(fx.judged?.facts || []), ...(fx.judged?.after || [])].join('\n');

test('follow：写下就让引擎跑；现状里有下一趟做完该是什么样', () => {
  const s = make('array a = 3 1 2\nfollow a fake\nopen a move');
  assert.deepEqual(pick(whereOf(obj(s), s)), { at: 0, passed: 0, total: 2, done: false, like: null, off: false });
  assert.match(s.stateText(), /a 照 fake 走：还没做完第 1 趟（共 2 趟）。第 1 趟做完该是：1 3 2/);
  assert.equal(traceOf(obj(s), s).variants.length, 1);
});

test('学生到了检查点：对（right true）、事实里说到了哪一趟；全做完才算做完', () => {
  const s = make('array a = 3 1 2\nfollow a fake\nopen a move');
  let fx = stu(s, 'swap a#1 a#2'); // 3 1 2 → 1 3 2
  assert.equal(fx.judged.verdict.right, true);
  assert.match(said(fx), /到了第 1 趟做完的样子（和引擎算的一样）/);
  assert.deepEqual(fx.done || [], []);
  assert.equal(evalMeasure(s, 'pass(a)').value, 1);
  assert.match(s.stateText(), /a 照 fake 走：做完了第 1 趟（共 2 趟）。第 2 趟做完该是：1 2 3/);
  fx = stu(s, 'swap a#1 a#3'); // → 1 2 3
  assert.equal(fx.judged.verdict.right, true);
  assert.equal(whereOf(obj(s), s).done, true);
  assert.deepEqual(fx.done, ['a']);
  assert.match(s.stateText(), /a 照 fake 走：2 趟都做完了/);
  assert.match(dryRun(s, 'goal g "x" when="a done"')[0].error, /成立/);
});

test('不在路上：页面不判（right null），事实里说离这一趟差哪几格；差得多只说几格', () => {
  const s = make('array a = 3 1 2 4 5 6\nfollow a fake\nopen a move');
  let fx = stu(s, 'swap a#2 a#3'); // → 3 2 1 4 5 6，该是 1 3 2 4 5 6
  assert.equal(fx.judged.verdict.right, null);
  assert.match(said(fx), /和第 1 趟做完该有的样子差 3 格：第 1 格（现在 3，该是 1）、第 2 格（现在 2，该是 3）、第 3 格（现在 1，该是 2）/);
  assert.deepEqual(pick(whereOf(obj(s), s)), { at: null, passed: 0, total: 2, done: false, like: null, off: true });
  assert.match(s.stateText(), /a 照 fake 走：不在引擎走的那条路上；离第 1 趟做完差 3 格/);
  fx = stu(s, 'swap a#4 a#6'); // 再乱一点：差 5 格，超过一半
  assert.match(said(fx), /和第 1 趟做完该有的样子差 5 格$/m);
  // 学生自己走回路上：照样认
  stu(s, 'swap a#4 a#6'); stu(s, 'swap a#2 a#3');
  fx = stu(s, 'swap a#1 a#2');
  assert.equal(fx.judged.verdict.right, true);
});

test('到了引擎认得的错法的检查点：right false、说像哪种；默认照做不标，wrong=block 才不让做', () => {
  const s = make('array a = 3 1 2\nfollow a fake\nopen a move');
  const fx = stu(s, 'swap a#2 a#3'); // → 3 2 1：错法的第 1 趟
  assert.equal(fx.judged.verdict.right, false);
  assert.match(fx.judged.verdict.misread, /^换了最后两个/); // 开头的「像是」去掉了：叫老师的那一句自己会加
  assert.equal(whereOf(obj(s), s).like, '像是换了最后两个');
  assert.match(s.stateText(), /a 照 fake 走：像是换了最后两个（和这种错法做完第 1 趟的样子一样）/);
  const b = make('array a = 3 1 2\nfollow a fake\nopen a move wrong=block');
  const fb = stu(b, 'swap a#2 a#3');
  assert.equal(fb.blocked, true);
  assert.equal(whereOf(obj(b), b).at, 0);
});

test('判断式、预写、关掉、存一份', () => {
  const s = make('array a = 3 1 2\nfollow a fake\nopen a move\n@a.right say "这一趟对了"\n@a.done say "都做完了"\ngoal g1 "做完第 1 趟" when="a pass=1"');
  let fx = stu(s, 'swap a#1 a#2');
  assert.deepEqual(fx.goalsMet, ['g1']);
  assert.ok((fx.reactions || []).some((r) => /这一趟对了/.test(r.src)));
  const c = s.clone();
  assert.deepEqual(pick(whereOf(obj(c), c)), pick(whereOf(obj(s), s)));
  run(s, 'follow a off');
  assert.equal(obj(s).follow, undefined);
  assert.equal(rulesOf(obj(s)).hasNext, false);
  assert.doesNotMatch(s.stateText(), /照 fake 走/);
});

test('当场报：没有这样东西、没有这个对应关系、接不上这种东西、引擎不收', () => {
  const s = make('array a = 3 1 2\ntree t = 5 3 8');
  assert.match(dryRun(s, 'follow b fake')[0].error, /舞台上没有「b」/);
  assert.match(dryRun(s, 'follow a nosuch')[0].error, /没有「nosuch」这种照法（有：.*fake/);
  assert.match(dryRun(s, 'follow t fake')[0].error, /fake 接不到树上（能接：一排格子）/);
  const n = make('array a = 3 9 2');
  assert.match(dryRun(n, 'follow a fake')[0].error, /fake 不收 9/);
});

test('老师改了数据：从新的样子重跑；引擎不收了就说照不下去了、不再判', () => {
  const s = make('array a = 3 1 2\nfollow a fake\nopen a move');
  stu(s, 'swap a#1 a#2'); // 1 3 2，过了第 1 趟
  run(s, 'write a.3 0'); // 老师把最后一格改成 0：现在是 1 3 0，从这里重跑
  // 新的数据里第 1 趟没有要动的（1 < 3）：一上来就算过了第 1 趟，可不是学生做的
  assert.deepEqual(pick(whereOf(obj(s), s)), { at: 0, passed: 1, total: 2, done: false, like: null, off: false });
  assert.match(s.stateText(), /第 2 趟做完该是：0 1 3/);
  run(s, 'write a.1 9');
  assert.match(s.stateText(), /a 照 fake 走：照不下去了（fake 不收 9）/);
  const fx = stu(s, 'swap a#1 a#2');
  assert.equal(fx.judged?.verdict?.right ?? null, null);
});

test('一上来就在最后（数据本来就排好了）：不算学生做完的，@a.done 当场报', () => {
  const s = make('array a = 1 2 3\nfollow a fake\nopen a move');
  assert.equal(whereOf(obj(s), s).done, true);
  assert.match(s.stateText(), /a 照 fake 走：一上来就已经是做完的样子/);
  assert.match(dryRun(s, '@a.done say "完"')[0].error, /现在就已经做完了/);
});
