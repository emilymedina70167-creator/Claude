// 舞台主线第十轮：交给学生之前先量一遍（loop.js）。压着就盖上、马上把画面交回老师改，只改画面；干净了揭开；
// 画面没问题不多叫一次；最多改两次，还不行照样交给学生
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { createLoop, SIGHT_MAX } from '../kit/src/stage/loop.js';

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const OVER = { issues: [{ what: '压着', a: 'obj:q', b: 'obj:tl', an: 'q', bn: 'tl', area: 900 }] };
const CLEAN = { issues: [{ what: '贴的字太小', a: 'label:lm', an: '贴的字 lm' }] };

// 假的舞台：老师那一轮的字一到就演完（armed）；sightCheck 按给的一串依次返回；veil 记下开关
function sightClass(sights, { selfCheck } = {}) {
  const scene = new Scene();
  for (const c of parseScript('card q = "题"\ncard tl = "轴"')) scene.apply(c);
  const stage = {
    log: [], errors: [], scene, teacherAudit: [], reacting: Promise.resolve(), studentChain: Promise.resolve(),
    pendingGoals: () => [], veils: [], veiled: false,
    begin() {
      this.errors = [];
      let armedR; const armed = new Promise((r) => { armedR = r; });
      const me = this;
      return { mark: this.log.length, turn: 1, armed, push() { me.onLine?.(); }, end(text) { for (const src of text.split('\n').filter(Boolean)) me.log.push({ src, by: 'teacher' }); armedR(); return new Promise(() => {}); }, drop() { armedR(); }, abort: async () => {} };
    },
    sightCheck: async () => (sights.length ? sights.shift() : CLEAN),
    veil(on) { this.veiled = !!on; this.veils.push(!!on); },
    play: async () => ({}), holdAsk() {}, cancelWait() { scene.waiting = null; },
  };
  const sent = [];
  const calls = [];
  const host = {
    stage, mock: true, model: 'm', teach: {}, quietMs: 5, putTurn() {}, cost: (c) => c, thinking() {}, ...(selfCheck === false ? { selfCheck: false } : {}),
    messages: ({ next } = {}) => [{ role: 'user', content: next || 'x' }],
    addTurn: (r) => { const x = { ...r, seq: sent.length + 1 }; sent.push(x); return x; },
    call: async () => { calls.push(loop.state.callWhy || 'turn'); return { text: calls.length === 1 ? 'say "看"\nask next' : 'place q at=4,4-44,8', modelApplied: 'm' }; },
  };
  const loop = createLoop(host);
  return { stage, sent, calls, loop };
}
const studentMsgs = (rows) => rows.filter((r) => r.role === 'student' && !r.pending).map((r) => r.msg || '');

test('压着：盖上、马上交回老师改画面（发过去写着量到了什么、只改画面），改完干净就揭开', async () => {
  const a = sightClass([OVER, CLEAN]);
  await a.loop.teach('turn');
  await wait(80);
  assert.deepEqual(a.calls, ['turn', 'sight']);
  const msg = studentMsgs(a.sent).at(-1);
  assert.match(msg, /\[画面自查\]/);
  assert.match(msg, /q 和 tl 压着/);
  assert.match(msg, /只改画面/);
  assert.deepEqual(a.stage.veils, [true, false], '先盖上、改好揭开');
  assert.equal(a.stage.veiled, false);
  a.loop.close();
});

test('画面没问题：不多叫一次老师，也不盖', async () => {
  const a = sightClass([CLEAN]);
  await a.loop.teach('turn');
  await wait(60);
  assert.deepEqual(a.calls, ['turn']);
  assert.ok(!a.stage.veils.includes(true));
  a.loop.close();
});

test(`改了 ${SIGHT_MAX} 次还压着：照样交给学生（揭开），不再叫；最后一次发过去时说明是最后一次`, async () => {
  const a = sightClass([OVER, OVER, OVER, OVER]);
  await a.loop.teach('turn');
  await wait(120);
  assert.deepEqual(a.calls, ['turn', 'sight', 'sight']);
  assert.match(studentMsgs(a.sent).at(-1), /最后一次/);
  assert.equal(a.stage.veiled, false);
  a.loop.close();
});

test('selfCheck: false（以前的试演文件、没有老师的舞台）不量', async () => {
  const a = sightClass([OVER], { selfCheck: false });
  await a.loop.teach('turn');
  await wait(60);
  assert.deepEqual(a.calls, ['turn']);
  assert.deepEqual(a.stage.veils, []);
  a.loop.close();
});

test('量的那一会儿学生已经答了：那一条照常是讲课的一轮（不写「只改画面、不要说话」）', async () => {
  const a = sightClass([]);
  a.stage.sightCheck = async () => { a.stage.onAnswer({ type: 'say', text: '我答了' }, null); await wait(5); return OVER; };
  await a.loop.teach('turn');
  await wait(80);
  const msg = studentMsgs(a.sent).find((m) => /画面自查/.test(m));
  assert.ok(msg, '发了画面自查');
  assert.match(msg, /我答了/);
  assert.match(msg, /已经接着做了/);
  assert.doesNotMatch(msg, /不要说话/);
  a.loop.close();
});

test('这一轮的提问没演上（askfail 要马上重写）：不另外自查', async () => {
  const a = sightClass([CLEAN]); // 没演上那一轮不量（量了也是 OVER）；重写的那一轮量到干净
  a.stage.askMissed = true;
  const begin = a.stage.begin;
  a.stage.begin = function () { const t = begin.call(this); if (a.calls.length) this.askMissed = false; return t; }; // 重写的那一轮演上了
  await a.loop.teach('turn');
  await wait(80);
  assert.equal(a.calls[1], 'turn', '马上叫老师的是重写那一问（askfail），不是改画面');
  assert.ok(!a.stage.veils.includes(true));
  a.loop.close();
});

test('改满两次还剩的同一组问题：下一轮不再盖、不再叫（改不掉的不每轮来回）', async () => {
  const a = sightClass([OVER, OVER, OVER, OVER]);
  await a.loop.teach('turn');
  await wait(120);
  assert.deepEqual(a.calls, ['turn', 'sight', 'sight']);
  a.stage.veils.length = 0;
  await a.loop.teach('turn');
  await wait(80);
  assert.equal(a.calls.length, 4, '下一轮照常讲，没再叫改画面');
  assert.ok(!a.stage.veils.includes(true));
  a.loop.close();
});
