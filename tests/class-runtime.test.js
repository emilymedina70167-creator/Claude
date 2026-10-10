// 课堂运行时里不碰 DOM 的规则：什么动作要告诉课堂 Claude、什么时候自动发起一轮、
// 刷新后哪一条还在等回答、超长时怎么缩、数据库写入的顺序。
// 整个流程（流式、退路作废、重写、恢复）在真浏览器里另外验（Playwright，scratchpad/rt/runtime.cjs）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reportable, actionTrigger, promptHistory, pendingTurn, fitTurns, buildTurns, buildSystem, boardStateText,
  DEFAULT_RULES, PROTOCOL_DOC, closingPrompt, compactionPrompt, bytes, KEEP_RECENT, PACK_BUDGET, CUT_NOTE, actionText,
} from '../kit/src/class/prompt.js';
import { parseOutput, parseCommand } from '../kit/src/class/protocol.js';
import { devReply } from '../kit/src/class/devteacher.js';

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { createSink } = await import('../kit/src/live/sync.js');

// —— 动作：报不报、怎么触发 ——

test('reportable：每次尝试报，最终结果只在看了答案 / 放弃时报；提问、提示不报', () => {
  assert.equal(reportable({ source: 'record', type: 'answer', liveOnly: true, value: '3', ok: false, attempts: 1 }), true);
  assert.equal(reportable({ source: 'record', type: 'answer', final: true, ok: true, attempts: 2 }), false, '答对的最终结果：每次尝试已经说过');
  assert.equal(reportable({ source: 'record', type: 'answer', final: true, revealed: true }), true);
  assert.equal(reportable({ source: 'record', type: 'steps', final: true, giveup: true }), true);
  assert.equal(reportable({ source: 'record', type: 'ask', question: '？' }), false);
  assert.equal(reportable({ source: 'record', type: 'findbug-hint' }), false);
  assert.equal(reportable({ source: 'record', type: 'conjecture-try', answer: '…' }), true);
  assert.equal(reportable({ source: 'event', type: 'reveal' }), true);
  assert.equal(reportable({ source: 'event', type: 'drag', name: 'x' }), true);
  assert.equal(reportable({ source: 'event', type: 'giveup' }), false, '放弃的作答记录已经说了，事件不重复');
  assert.equal(reportable({ source: 'event', type: 'open' }), false);
  assert.equal(reportable(null), false);
});

test('actionTrigger：想不出来马上发；作答、拖动等 1.5 秒；揭开中间一步跟着下一条；最后一步要发', () => {
  assert.equal(actionTrigger({ source: 'record', type: 'steps', giveup: true }), 'now');
  assert.equal(actionTrigger({ source: 'event', type: 'giveup' }), 'now', '不报告，但要马上发起');
  assert.equal(actionTrigger({ source: 'record', type: 'steps', value: '甲', ok: true }), 'soon');
  assert.equal(actionTrigger({ source: 'event', type: 'drag', name: 'x', value: [1, 2] }), 'soon');
  assert.equal(actionTrigger({ source: 'event', type: 'reveal', detail: { step: 1 } }), 'later');
  assert.equal(actionTrigger({ source: 'event', type: 'reveal', detail: { step: 3 } }, { lastStep: true }), 'soon');
  assert.equal(actionTrigger({ source: 'record', type: 'answer', final: true, ok: true }), null);
  assert.equal(actionTrigger({ source: 'event', type: 'open' }), null);
});

test('事件的 detail 摊开时不能盖掉段 id：动作里写清楚是哪一段', () => {
  // classroom 的写法：{ source, ...detail, ...e }
  const e = { type: 'giveup', step: 'b7', block: 'ex-1', detail: { step: 2, title: '再乘一次' } };
  const a = { source: 'event', ...e.detail, ...e };
  assert.equal(actionText(a), '[动作] b7 里的 steps ex-1 第 2 步（再乘一次）：想不出来，直接揭开了');
  const r = { source: 'event', ...{ step: 3, title: '写出 A²' }, type: 'reveal', step: 'b7', block: 'ex-1', detail: { step: 3, title: '写出 A²' } };
  assert.equal(actionText(r), '[动作] b7 里的 steps ex-1：揭开第 3 步（写出 A²）');
});

// —— 对话历史 ——

const T = (seq, role, text, extra = {}) => ({ seq, role, text, ...extra });

test('promptHistory：作废的轮、下课小结不进；有摘要时只留摘要和它之后的原文', () => {
  const h = [
    T(1, 'student', '开始'), T(2, 'claude', '好'), T(3, 'system', 'Opus 5.5 不可用', { kind: 'fallback', discarded: true }),
    T(4, 'student', '继续'), T(5, 'claude', '嗯'), T(6, 'system', '【到目前为止的课堂摘要】…', { kind: 'summary', upTo: 4 }),
    T(7, 'student', '再来'), T(8, 'system', '小结', { kind: 'closing' }),
  ];
  assert.deepEqual(promptHistory(h).map((t) => t.seq), [6, 5, 7]);
  assert.deepEqual(promptHistory(h.slice(0, 5)).map((t) => t.seq), [1, 2, 4, 5]);
});

test('pendingTurn：刷新后哪一条还在等 Claude 回答', () => {
  assert.equal(pendingTurn([]), null);
  assert.equal(pendingTurn([T(1, 'student', 'a'), T(2, 'claude', 'b')]), null);
  assert.equal(pendingTurn([T(1, 'student', 'a')]).seq, 1);
  // Opus 不可用作废之后：学生那条还在等
  assert.equal(pendingTurn([T(1, 'student', 'a'), T(2, 'system', 'x', { kind: 'fallback', discarded: true })]).seq, 1);
  // 要它重写、补发原图：在等
  assert.equal(pendingTurn([T(1, 'student', 'a'), T(2, 'claude', 'b'), T(3, 'system', '[系统] 写法错误', { kind: 'lint' })]).seq, 3);
  assert.equal(pendingTurn([T(1, 'student', 'a'), T(2, 'claude', 'b'), T(3, 'system', '[系统] 原图', { kind: 'images' })]).seq, 3);
  // 提醒、下课小结、摘要后面不需要 Claude 接话
  assert.equal(pendingTurn([T(1, 'student', 'a'), T(2, 'claude', 'b'), T(3, 'system', '[系统] 指令没执行', { kind: 'note' })]), null);
  assert.equal(pendingTurn([T(1, 'student', 'a'), T(2, 'claude', 'b'), T(3, 'system', '小结', { kind: 'closing' })]), null);
  assert.equal(pendingTurn([T(1, 'student', 'a'), T(2, 'claude', 'b'), T(3, 'system', '摘要', { kind: 'summary', upTo: 1 })]), null);
});

// —— 长度 ——

test('fitTurns：最近 20 条本身就超长时，逐步少留几条原文，保证不超过上限', () => {
  const big = 'x'.repeat(30 * 1024);
  const history = [];
  for (let i = 1; i <= 24; i++) history.push(T(i, i % 2 ? 'student' : 'claude', `${i} ${big}`));
  history.push(T(25, 'student', '最后一句'));
  const max = 200 * 1024;
  const plain = buildTurns({ system: '说明', history, maxBytes: max });
  assert.ok(plain.bytes > max, '只丢 20 条以前的还是超长（会被平台拒收 prompt_too_large）');
  const fit = fitTurns({ system: '说明', history, maxBytes: max });
  assert.equal(fit.fits, true);
  assert.ok(fit.bytes <= max);
  assert.ok(fit.keepRecent < KEEP_RECENT);
  assert.equal(fit.turns[0].content, '说明');
  assert.equal(fit.turns.at(-1).content, '最后一句');
  assert.equal(fit.turns.at(-1).role, 'user');
  // 不超长时和 buildTurns 一样
  const small = fitTurns({ system: '说明', history: history.slice(-3).map((t) => ({ ...t, text: t.text.slice(0, 10) })), maxBytes: max });
  assert.equal(small.keepRecent, KEEP_RECENT);
  assert.equal(small.dropped, 0);
});

test('buildTurns：keepRecent 可以调小；摘要一直保留', () => {
  const history = [T(1, 'system', '【到目前为止的课堂摘要】早先', { kind: 'summary' })];
  for (let i = 2; i <= 9; i++) history.push(T(i, i % 2 ? 'claude' : 'student', `${i} ${'y'.repeat(1000)}`));
  history.push(T(10, 'student', '现在'));
  const r = buildTurns({ system: 'S', history, maxBytes: 2500, keepRecent: 1 });
  assert.equal(r.turns[1].content, '[系统] 【到目前为止的课堂摘要】早先');
  assert.equal(r.turns.at(-1).content, '现在');
  assert.ok(r.dropped > 0);
});

test('buildSystem：资料包预算可以调小（prompt_too_large 之后再试）', () => {
  const pack = { main: { textbook: '定义。'.repeat(30000) } };
  const full = buildSystem({ componentDocs: 'D', pack, board: [] });
  const half = buildSystem({ componentDocs: 'D', pack, board: [], packBudget: PACK_BUDGET >> 2 });
  assert.ok(bytes(full) > bytes(half) + 60 * 1024);
  assert.ok(half.includes(CUT_NOTE));
});

// —— 黑板现状 ——

test('boardStateText：写错还没显示的段、没画出来的段、图的变量', () => {
  const s = boardStateText([
    { id: 'b1', title: '图', summary: '拖一拖', blocks: [{ id: 'fig-1', kind: 'scene', vars: ['A', 'x', 't'], results: ['把 x 拖到 [1, 2]'] }, { id: 'q-1', kind: 'answer', results: [] }] },
    { id: 'b2', title: '写错了', pending: true, blocks: [] },
    { id: 'b3', title: '没画出来', failed: true, blocks: [] },
    { id: 'b4', hidden: true },
  ]);
  assert.match(s, /scene fig-1（变量：A、x、t） 的作答：/);
  assert.match(s, /answer q-1：还没有作答/);
  assert.match(s, /b2「写错了」（写法错误，还没显示，学生看不到；用 board replace id=b2 重写）/);
  assert.match(s, /b3「没画出来」（没画出来，学生只看到「这段没画出来」/);
  assert.match(s, /b4（已撤回，学生看不到）/);
  assert.match(s, /新的一段用 id b5/);
});

// —— 协议的边界 ——

test('protocol：id 不能只是 . 或 ..（数据库的文档名不收）', () => {
  assert.ok(parseCommand('add id=.').error);
  assert.ok(parseCommand('hide id=..').error);
  assert.ok(parseCommand('figure target=.. play t').error);
  assert.equal(parseCommand('add id=b.1').id, 'b.1');
  assert.equal(parseCommand('add id=...').id, '...');
});

test('protocol：没闭合的块在 final 时列出来（页面据此提醒 Claude），并且当文字', () => {
  const r = parseOutput('先说一句。\n````board add id=b2 title="x"\n```scene\nlet A = [[1, 2]]\n', { final: true });
  assert.deepEqual(r.ops, []);
  assert.equal(r.unclosed.length, 1);
  assert.deepEqual(r.unclosed[0].op, { op: 'add', id: 'b2', title: 'x' });
  assert.match(r.segments[0].text, /````board add id=b2/);
  // 流式时同样的文字是草稿，不算没闭合
  const d = parseOutput('先说一句。\n````board add id=b2 title="x"\n```scene\nlet A = [[1, 2]]\n');
  assert.deepEqual(d.unclosed, []);
  assert.equal(d.segments.at(-1).closed, false);
  // 下一块开始了、上一块还没闭合：上一块算没闭合
  const c = parseOutput('````board add id=b1\n甲\n````board add id=b2\n乙\n````', { final: true });
  assert.deepEqual(c.ops.map((o) => o.id), ['b2']);
  assert.equal(c.unclosed[0].op.id, 'b1');
});

test('protocol：真实输出的每个前缀（含 CRLF、中文引号、看不懂的指令）都不抛异常，草稿不执行', () => {
  const text = [
    '好。\r\n',
    '````board add id=b2 title=“Ax 在哪”\r\n```scene\r\nid: fig-2\r\nlet x = [1, 2] drag\r\nvector x\r\n```\r\n````\r\n',
    '```board spin id=b2\r\n```\r\n',
    '````board figure target=fig-2 set x=[2, 1] k = (1, 2)\r\n````\r\n',
    '````board hide id=b1````\r\n',
    '最后一句，没换行',
  ].join('');
  for (let i = 0; i <= text.length; i++) {
    const pre = text.slice(0, i);
    const r = parseOutput(pre);
    for (const s of r.segments) if (s.type === 'board' && !s.closed) assert.ok(!r.ops.some((o) => o.body === s.body && o.id === s.op?.id && s.body), '没闭合的块不进 ops');
    parseOutput(pre, { final: true });
  }
  const r = parseOutput(text, { final: true });
  assert.deepEqual(r.ops.map((o) => `${o.op}:${o.id || o.target}`), ['add:b2', 'figure:fig-2', 'hide:b1']);
  assert.equal(r.ops[0].title, 'Ax 在哪');
  assert.deepEqual(r.ops[1].assigns, { x: '[2, 1]', k: '(1, 2)' });
  assert.equal(r.rejected.length, 1);
  assert.match(r.segments.map((s) => s.text || '').join('\n'), /```board spin id=b2/);
});

// —— 提到学生不用性别代词 ——

test('发给课堂 Claude 的说明、小结要求、模拟老师的小结：提到学生不用「他」「她」', () => {
  const he = /(?<!其)[他她]/;
  for (const [name, s] of [
    ['DEFAULT_RULES', DEFAULT_RULES],
    ['PROTOCOL_DOC', PROTOCOL_DOC],
    ['closingPrompt', closingPrompt()],
    ['compactionPrompt', compactionPrompt({ summary: '', turns: [T(1, 'student', '没懂')] })],
  ]) {
    const bad = s.split('\n').filter((l) => he.test(l.replace(/不用「他」「她」/g, '')));
    assert.deepEqual(bad, [], `${name} 里有性别代词`);
  }
  assert.match(DEFAULT_RULES, /不用「他」「她」/);
  assert.match(closingPrompt(), /不用「他」「她」/);
  const closing = devReply([{ role: 'user', content: '说明' }, { role: 'assistant', content: '好' }, { role: 'user', content: '下课' }]).text;
  assert.ok(!he.test(closing), closing);
});

// —— 数据库写入：同一个文档按顺序、旧的失败不覆盖新的 ——

test('createSink.put：同一个文档的写入按顺序到达（先 add 再 hide，刷新后仍是 hide）', async () => {
  const stored = new Map();
  let n = 0;
  const store = {
    db: {
      collection: (c) => ({
        doc: (id) => ({
          // 第一次写入故意慢：并发的话第二次会先到
          set: (data) => new Promise((res) => setTimeout(() => { stored.set(`${c}/${id}`, data); res(); }, n++ === 0 ? 40 : 1)),
        }),
      }),
    },
  };
  const sink = createSink(store);
  const a = sink.put('steps', { id: 'b3', hidden: false });
  const b = sink.put('steps', { id: 'b3', hidden: true });
  await Promise.all([a, b]);
  assert.equal(stored.get('steps/b3').hidden, true);
});

test('createSink.put：旧版本写失败、新版本已经排上：旧的不进「没存上」（不会在重试时盖掉新的）', async () => {
  const stored = new Map();
  let calls = 0;
  const store = {
    db: {
      collection: (c) => ({
        doc: (id) => ({
          set: async (data) => {
            calls++;
            if (calls === 1) throw { code: 'invalid_argument', message: 'nope' }; // 不重试的错误
            stored.set(`${c}/${id}`, data);
          },
        }),
      }),
    },
  };
  const sink = createSink(store);
  const r1 = sink.put('steps', { id: 'b1', md: '旧' });
  const r2 = sink.put('steps', { id: 'b1', md: '新' });
  assert.equal(await r1, false);
  assert.equal(await r2, true);
  assert.equal(stored.get('steps/b1').md, '新');
});

test('摘要：要压缩的是摘要之后、最近 20 条之前的；能压的太少时不值得多花一轮', async () => {
  const { compactionSlice, worthCompacting, needsCompaction } = await import('../kit/src/class/prompt.js');
  const big = (i) => T(i, i % 2 ? 'student' : 'claude', `${i} ${'z'.repeat(4500)}`);
  // 摘要之后又攒了 22 条，每条 4.5 KB：总量超过 80 KiB，但能压的只有 2 条
  const h = [T(1, 'system', '【到目前为止的课堂摘要】…', { kind: 'summary', upTo: 0 }), ...Array.from({ length: 22 }, (_, k) => big(k + 2))];
  const ph = promptHistory(h);
  assert.equal(needsCompaction(ph), true);
  const { prev, old } = compactionSlice(ph);
  assert.equal(prev.seq, 1);
  assert.deepEqual(old.map((t) => t.seq), [2, 3]);
  assert.equal(worthCompacting(ph), false, '只压 2 条：不值得每一轮先等一次摘要');
  // 攒够了再压
  const more = [...h, ...Array.from({ length: 6 }, (_, k) => big(k + 24))];
  assert.equal(worthCompacting(promptHistory(more)), true);
});

test('课堂模式里组件自己发起的调用：只有带图的转写能发，其余（找错提示、猜想批改）不发', async () => {
  const { session } = await import('../kit/src/session.js');
  const seen = [];
  const sample = async (input, opts) => { seen.push(opts); return { text: 'ok', truncated: false, modelTierApplied: opts.modelTier || 'default', modelApplied: opts.model }; };
  sample.json = async (input, opts) => { seen.push(opts); return { transcript: 'x' }; };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 4 } });
  globalThis.window.claude = { use: async (n) => (n === 'sample' ? sample : null) };
  const { getAI, AI_PERMANENT } = await import('../kit/src/ai.js');
  const ai = await getAI();
  const before = session.mode;
  try {
    session.mode = 'class';
    await assert.rejects(ai.ask('提示一句', { modelTier: 'quick' }), (e) => e.code === 'capability_disabled' && AI_PERMANENT.has(e.code));
    await assert.rejects(ai.json('批改', { modelTier: 'quick' }), (e) => e.code === 'capability_disabled');
    assert.deepEqual(await ai.json('转写', { images: [{}], modelTier: 'default' }), { transcript: 'x' });
    const r = await ai.call([{ role: 'user', content: '讲课' }], { model: 'claude-opus-5-5', effort: 'high', modelTier: 'complex' });
    assert.equal(r.modelApplied, 'claude-opus-5-5');
    assert.equal(seen.length, 2, '被拦下的两次没有发出去');
    session.mode = 'live';
    assert.equal(await ai.ask('提示一句', { modelTier: 'quick' }), 'ok', '别的模式照常');
  } finally {
    session.mode = before;
  }
});
