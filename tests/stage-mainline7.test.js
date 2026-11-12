// 舞台主线第七轮（docs/superpowers/specs/2026-11-12-stage-mainline-7-design.md）：第一节真课留下的课堂循环和数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fitHistory, STATE_STUB } from '../kit/src/stage/history.js';

const B = (s) => Buffer.byteLength(String(s ?? ''));
const total = (msgs, sys) => sys + msgs.reduce((n, m) => n + B(m.content), 0);

// —— 第 2 节：对话放不下先省最早几轮的舞台样子 ——
test('fitHistory：放得下时一字不改', () => {
  const msgs = [{ role: 'user', content: '开始' }, { role: 'assistant', content: 'say "好"' }, { role: 'user', content: '[学生]\n学生点了 a.1\n\n[舞台现在]\n一排格子 a\n\n写下一轮。' }];
  const r = fitHistory(structuredClone(msgs), { max: 1e6 });
  assert.deepEqual(r.msgs, msgs);
  assert.equal(r.stripped, 0);
  assert.equal(r.dropped, 0);
});

const state = (n) => `[舞台现在]\n${'句子 s：xxxx\n'.repeat(n)}\n写下一轮。`;
const stu = (i, n = 200) => ({ role: 'user', content: `[学生]\n学生点了 a.${i}\n\n${state(n)}` });

test('fitHistory：先省最早的舞台样子，最近 3 条学生的不省；[学生] 那一段留着', () => {
  const msgs = [{ role: 'user', content: '开始上课' }];
  for (let i = 1; i <= 10; i++) { msgs.push({ role: 'assistant', content: `say "第 ${i} 轮"` }); msgs.push(stu(i)); }
  const sys = 1000;
  const max = total(msgs, sys) - 8000; // 省掉两三份就放得下
  const r = fitHistory(structuredClone(msgs), { max, sysBytes: sys });
  assert.equal(r.dropped, 0);
  assert.equal(r.msgs.length, msgs.length);
  assert.ok(r.stripped >= 1);
  assert.ok(total(r.msgs, sys) <= max);
  const users = r.msgs.filter((m) => m.role === 'user').slice(1);
  for (const m of users.slice(-3)) assert.match(m.content, /句子 s：xxxx/);
  assert.equal(users[0].content, `[学生]\n学生点了 a.1\n\n${STATE_STUB}`);
  // 只省需要的：最近那几条以外也不全省
  assert.ok(r.stripped < users.length - 3 || total(r.msgs, sys) <= max);
});

test('fitHistory：都省了还放不下才成对丢最早的；第一条留着、一问一答交替', () => {
  const msgs = [{ role: 'user', content: '开始上课' }];
  for (let i = 1; i <= 10; i++) { msgs.push({ role: 'assistant', content: `say "${'长'.repeat(3000)}"` }); msgs.push(stu(i, 5)); }
  const r = fitHistory(structuredClone(msgs), { max: 40000, sysBytes: 0 });
  assert.ok(r.dropped > 0);
  assert.equal(r.msgs[0].content, '开始上课');
  r.msgs.forEach((m, i) => assert.equal(m.role, i % 2 ? 'assistant' : 'user'));
  assert.ok(total(r.msgs, 0) <= 40000);
});

test('fitHistory：第一节真课 101 条，说明 138306 字节、上限 200 KiB：一条不丢', (t) => {
  const dir = new URL('../.superpowers/en1/sessions/c-20261112-1/class_turns/', import.meta.url);
  if (!existsSync(dir)) { t.skip('没有真课的数据（不进 git）'); return; }
  const turns = readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(new URL(f, dir)))).filter((x) => !x.discarded && !x.pending && (x.role === 'claude' || x.role === 'student'));
  const msgs = [];
  const user = (content) => { if (msgs.at(-1)?.role === 'user') msgs.at(-1).content += `\n\n${content}`; else msgs.push({ role: 'user', content }); };
  for (const x of turns) { if (x.role === 'claude') { if (!msgs.length) user('开始上课'); msgs.push({ role: 'assistant', content: x.text }); } else user(x.msg || x.text); }
  const n = msgs.length;
  const r = fitHistory(msgs, { max: 200 * 1024, sysBytes: 138306 });
  assert.equal(r.dropped, 0);
  assert.equal(r.msgs.length, n);
  assert.ok(total(r.msgs, 138306) <= 200 * 1024);
});

// —— 第 1 节：叫老师的理由没了，那一轮剩下的不演 ——
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { createLoop } from '../kit/src/stage/loop.js';

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
// 假的舞台（真的场景）：老师那一轮的字一到就「开演」，drop 记次数；errors 照真舞台那样每轮开头清空
function lateClass(src) {
  const scene = new Scene();
  for (const c of parseScript(src)) scene.apply(c);
  const stage = {
    log: [], errors: [], scene, teacherAudit: [], reacting: Promise.resolve(), studentChain: Promise.resolve(),
    pendingGoals: () => [...scene.goals.values()].filter((g) => !g.met),
    drops: 0, pushed: [],
    begin() {
      this.errors = [];
      let armedR; const armed = new Promise((r) => { armedR = r; });
      const me = this;
      return {
        mark: this.log.length, turn: 1, armed,
        push(text) { me.pushed.push(text); me.onLine?.(); },
        end(text) { const lines = text.split('\n').filter(Boolean); for (const src of lines.slice(0, me.dropAt ?? lines.length)) me.log.push({ src, by: 'teacher' }); armedR(); return new Promise(() => {}); },
        drop() { me.drops++; me.dropAt = me.pushed.at(-1)?.split('\n').filter(Boolean).length ?? 0; armedR(); },
        abort: async () => {},
      };
    },
    play: async () => ({}), holdAsk() {}, cancelWait() { scene.waiting = null; },
  };
  const sent = [];
  let script = null;
  const host = {
    stage, mock: true, model: 'm', teach: {}, quietMs: 5, putTurn() {}, cost: (c) => c, thinking() {},
    messages: ({ next } = {}) => [{ role: 'user', content: next || 'x' }],
    addTurn: (r) => { const x = { ...r, seq: sent.length + 1 }; sent.push(x); return x; },
    call: async (input, { onText }) => { const s = script ?? (async () => ({ text: 'say "好"', modelApplied: 'm' })); script = null; return s(onText, input); },
  };
  return { stage, scene, sent, host, setScript: (f) => { script = f; } };
}
const studentRows = (rows) => rows.filter((r) => r.role === 'student' && !r.pending);

test('叫老师的理由是 g1 很久没做到、老师演到一半学生做到了 g1：剩下的不演，下一轮告诉老师', async () => {
  const a = lateClass('array k = 2 1\nopen k\ngoal g1 "排好" when="k sorted"');
  const loop = createLoop(a.host);
  let second = null;
  a.setScript(async (onText) => {
    onText({ text: 'paint k.1 g1\nsay "操作：按住一张牌拖过去。"\n' });
    await wait(5);
    a.scene.apply(parseScript('swap k.1 k.2')[0], { by: 'student', open: 'drag' });
    a.stage.onGoal(['g1'], { by: 'student' });
    await wait(5);
    return { text: 'paint k.1 g1\nsay "操作：按住一张牌拖过去。"\nsay "提示：小的放前面。"\nask next', modelApplied: 'm' };
  });
  await loop.resume({ lastClaude: 1 });
  await wait(60);
  assert.equal(a.stage.drops, 1, '老师那一轮停了');
  const rows = studentRows(a.sent);
  const last = rows.at(-1);
  assert.match(last.msg, /做到了挑战 g1/);
  assert.match(last.msg, /学生在那之前做到了 g1，这一行起没演（你这一轮是因为它很久没做到才被叫来的）/);
  loop.close();
});

test('理由是 g1 很久没做到、学生做到的是另一条 g2：照旧全演', async () => {
  const a = lateClass('array k = 2 1\narray q = 1 2\nopen k\nopen q\ngoal g1 "排好" when="k sorted"\ngoal g2 "倒过来" when="q sorted desc"');
  const loop = createLoop(a.host);
  a.setScript(async (onText) => {
    onText({ text: 'paint k.1 g1\n' });
    await wait(5);
    a.scene.goals.get('g2').met = false; // 叫老师那一刻 g2 不在理由里（先当它做到过）
    a.scene.apply(parseScript('swap q.1 q.2')[0], { by: 'student', open: 'drag' });
    a.stage.onGoal(['g2'], { by: 'student' });
    await wait(5);
    return { text: 'paint k.1 g1\nsay "提示"\nask next', modelApplied: 'm' };
  });
  // 理由只有 g1：叫老师那一刻 g2 先当它做到过（不在「还没做到」里）
  a.scene.goals.get('g2').met = true;
  await loop.resume({ lastClaude: 1 });
  await wait(60);
  assert.equal(a.stage.drops, 0);
  loop.close();
});

test('理由里还有学生打的字：照旧全演', async () => {
  const a = lateClass('array k = 2 1\nopen k\ngoal g1 "排好" when="k sorted"');
  const loop = createLoop(a.host);
  a.setScript(async (onText) => {
    onText({ text: 'say "嗯"\n' });
    await wait(5);
    a.scene.apply(parseScript('swap k.1 k.2')[0], { by: 'student', open: 'drag' });
    a.stage.onGoal(['g1'], { by: 'student' });
    await wait(5);
    return { text: 'say "嗯"\nsay "提示"\nask next', modelApplied: 'm' };
  });
  await loop.resume({ lastClaude: 1 });
  a.stage.onAnswer({ type: 'say', text: '我不会拖' });
  await wait(60);
  assert.equal(a.stage.drops, 0);
  loop.close();
});

// —— 第 3 节 ①：两种写法容错 ——
const mk = (src) => { const s = new Scene(); for (const c of parseScript(src)) s.apply(c); return s; };

test('一整句中文没写 say：当成话照演', () => {
  const [c] = parseScript('would 选对了：搬家在说话之后。但 would 后面要用原形 move，不能写 moved。');
  assert.equal(c.cmd, 'say');
  assert.equal(c.forgiven, 'say');
  const s = new Scene();
  s.apply(c);
  assert.equal(s.say, 'would 选对了：搬家在说话之后。但 would 后面要用原形 move，不能写 moved。');
});

test('拼错的指令照旧报错，不当成话', () => {
  assert.equal(parseScript('lable a.1 "主语"')[0].cmd, null);
  assert.equal(parseScript('pnt s.2 g1')[0].cmd, null);
  assert.equal(parseScript('labl k a "重点：过去完成时"')[0].cmd, null);
});

test('open … back= 写在一行：拆成两行照演', () => {
  const s = mk('array a = 3 1 2\nkeep a "原样"');
  const fx = s.apply(parseScript('open a move undo=on back="原样"')[0]);
  assert.equal(fx.forgiven, 'open-back');
  assert.ok(s.opens.has('a:move'));
  assert.equal(s.opens.get('a:move').policy?.undo, true);
  assert.ok(s.opens.has('a:back:原样'));
});

test('open … back= 拆出来的一行错了照报', () => {
  const s = mk('array a = 3 1 2');
  assert.throws(() => s.apply(parseScript('open a move back="没存过"')[0]), (e) => /没存过/.test(e.message) && !/自己是一项/.test(e.message));
});

// —— 第 3 节 ②：交给学生的手没演上，学生手上没东西可动：马上叫老师 ——
import { handMissed, triggers, eventsText } from '../kit/src/stage/events.js';
// 照舞台那样一行行演，没演上的记进 errors（kept 的不算没演上）
const playErr = (src) => {
  const s = new Scene(); const errors = [];
  for (const c of parseScript(src)) { if (!c.cmd) { errors.push({ src: c.src, error: c.error }); continue; } try { s.apply(c); } catch (e) { errors.push({ src: c.src, error: e.message }); } }
  return { s, errors };
};

test('课上那一下：open 没演上、手上只剩一个按钮：要马上叫老师', () => {
  const { s, errors } = playErr('sentence r = "Each year researchers publish papers."\nkeep r "原句"\nopen r move undo=on back="原句" wrong=zz\nask next "拖好点下面" button="就这样"');
  assert.equal(errors.length, 1);
  assert.equal(handMissed(errors, s), true);
});

test('学生手上还有一问可答、或者这一轮没写 open：不叫', () => {
  let r = playErr('array a = 1 2\nopen zz move\nask tap a "点大的" expect=a.2');
  assert.equal(handMissed(r.errors, r.s), false);
  r = playErr('array a = 1 2\nsay "看一看"\nask next "看清了"');
  assert.equal(handMissed(r.errors, r.s), false);
  // 别的手开着
  r = playErr('array a = 1 2\nopen a\nopen zz move\nask next');
  assert.equal(handMissed(r.errors, r.s), false);
});

test('handfail：要马上叫老师，写给老师的那一句', () => {
  assert.equal(triggers({ kind: 'handfail' }), true);
  assert.match(eventsText([{ kind: 'handfail', at: 1 }]), /你这一轮交给学生的手（open）没演上，学生手上没有能动的：页面马上叫了你，重写那几行/);
});

test('课堂循环：handMissed 时马上叫一次；连着两轮都这样不再自动叫', async () => {
  const a = lateClass('array k = 1 2');
  a.stage.handMissed = true;
  const loop = createLoop(a.host);
  let calls = 0;
  const call0 = a.host.call;
  a.host.call = async (...x) => { calls++; return call0(...x); };
  await loop.teach('turn');
  await wait(30);
  assert.equal(calls, 2, '演完那一轮马上又叫了一次');
  assert.match(studentRows(a.sent).at(-1).msg, /交给学生的手（open）没演上/);
  await wait(30);
  assert.equal(calls, 2, '第二轮还是这样：不再自动叫');
  loop.close();
});

// —— 第 4 节：ask end ——
import { STAGE_TEACH, stageDoc } from '../kit/src/stage/doc.js';

test('ask end 写得进去；带不认得的选项报错', () => {
  const s = mk('say "那今天就到这里。"\nask end "今天先到这里？"');
  assert.equal(s.waiting.kind, 'end');
  assert.throws(() => mk('array a = 1\nask end "x" expect=a.1'), /expect=/);
});

test('说明里每门课有 ask end 那一行、都不超字节', () => {
  for (const sub of ['线代', '英语', '数据结构', '操作系统', '组成原理', '计网']) {
    const doc = STAGE_TEACH + stageDoc(sub);
    assert.match(doc, /ask end "今天先到这里？"/, sub);
    assert.ok(Buffer.byteLength(doc) <= 24576, `${sub} ${Buffer.byteLength(doc)}`);
  }
});

test('写给老师：点了「接着上」、点了「下课」；下课不叫老师', () => {
  assert.match(eventsText([{ kind: 'answer', act: { type: 'next', button: '接着上' }, at: 1 }]), /学生点了「接着上」/);
  const e = { kind: 'answer', act: { type: 'end' }, at: 1 };
  assert.match(eventsText([e]), /学生点了「下课」/);
});

// —— 第 5 节：同一个空算一道题；答案框里的问话不算作答 ——
import { asksBack } from '../kit/src/stage/answer.js';
import { askSig, actEvidence } from '../kit/src/stage/evidence.js';
import { itemsOf } from '../kit/src/memory/report.js';

test('asksBack：答案框里打的是一句问话', () => {
  assert.equal(asksBack('simply什么意思', { answer: 'would happen' }), true);
  assert.equal(asksBack('would happen', { answer: 'would happen' }), false);
  assert.equal(asksBack('过去', { answer: '过去' }), false);
  assert.equal(asksBack('is it would?', { answer: 'would happen' }), true);
  assert.equal(asksBack('  5  ', { answer: '5' }), false);
});

test('同一个空问两次、先错后对：报告里一道「改对了」', () => {
  const sig = askSig({ kind: 'value', type: 'en', answer: 'would happen' }, new Scene());
  const recs = [
    { src: 'record', comp: 'S41', type: 'stage', q: '用 happen 的正确形式填空', value: 'will happen', ok: false, sig, at: 1 },
    { src: 'record', comp: 'S43', type: 'stage', q: '再填一次：用 happen 的正确形式填空', value: 'would happen', ok: true, sig, at: 2 },
  ];
  const items = itemsOf(recs);
  assert.equal(items.length, 1);
  assert.equal(items[0].outcome, 'ok');
});

test('同一个名字造成两句不同的句子：问的是两道题', () => {
  const s = mk('sentence r = "Each year researchers publish papers."');
  const a = askSig({ kind: 'tap', expect: ['r.4'] }, s);
  s.apply(parseScript('sentence r = "Readers are migrating away from print."')[0]);
  const b = askSig({ kind: 'tap', expect: ['r.4'] }, s);
  assert.notEqual(a, b);
  // 同一句问两次（再找一次）是同一道
  const s2 = mk('sentence r = "Each year researchers publish papers."');
  assert.equal(askSig({ kind: 'tap', expect: ['r.4'] }, s2), a);
});

test('问话记成说的话，不出作答；作答带上 sig', () => {
  const ev = actEvidence({ type: 'value', text: 'simply什么意思', asks: true, right: null }, { comp: 'S39', q: '填空', sig: 'value||would happen' });
  assert.deepEqual(ev.records, []);
  assert.equal(ev.say, 'simply什么意思');
  const ok = actEvidence({ type: 'value', text: 'would happen', right: true }, { comp: 'S43', q: '填空', sig: 'value||would happen' });
  assert.equal(ok.records[0].sig, 'value||would happen');
});

test('以前的证据（没有 sig）照旧按每一问分', () => {
  const recs = [
    { src: 'record', comp: 'S41', type: 'stage', q: '用 happen 的正确形式填空', value: 'will happen', ok: false, at: 1 },
    { src: 'record', comp: 'S43', type: 'stage', q: '再填一次：用 happen 的正确形式填空', value: 'would happen', ok: true, at: 2 },
  ];
  assert.equal(itemsOf(recs).length, 2);
});
