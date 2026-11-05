// 一问一答的课接进课堂（docs/talk-impl.md B、C、D）：老师那一轮 → 活板的行、新冒出来的写法错误、作答记录的编号、
// 给老师看的活板现状、一问一答的说明、模拟老师的剧本。纯函数（kit/src/huoban/talk.js、class/prompt.js、class/devteacher.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HB_ID, hbFence, hbSource, lineCount, talkLines, talkOps, newErrors, rewriteText, recordId, parseRecordId, questionText, encValue, decValue, talkStateText, talkMeta,
} from '../kit/src/huoban/talk.js';
import { parseProse, applyOps } from '../kit/src/huoban/lang.js';
import { Runtime } from '../kit/src/huoban/runtime.js';
import { Q, text } from '../kit/src/huoban/values.js';
import { buildSystem, actionTrigger, actionText, packText, talkObjectDocs, PROTOCOL_DOC, MEMO_DOC, SYSTEM_MAX } from '../kit/src/class/prompt.js';
import { devReply } from '../kit/src/class/devteacher.js';
import { resolveBasis } from '../kit/src/memory/memo.js';
import { componentDocs } from '../kit/build-docs.js';
import { itemsOf, itemKey } from '../kit/src/memory/report.js';
import { sureKey } from '../kit/src/confidence.js';
import { checkBoard } from '../kit/src/huoban/check.js';

const DOCS = componentDocs(readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8'));

test('活板这一段：源码用四个反引号的 huoban 围栏包着，取得回来；行数就是轮次的边界', () => {
  const src = 'let a = 2\n{a} 加 1 是几？{a + 1?}';
  assert.equal(HB_ID, 'hb');
  assert.equal(hbSource(hbFence(src)), src);
  assert.match(hbFence(src), /^````huoban\n/);
  assert.equal(hbSource(hbFence('')), '');
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount(src), 2);
  assert.equal(lineCount(applyOps(src, 'set a = 3\n再问一个：{? *是 | 否}')), 3);
});

test('talkLines：board 块不是活板的行；memo、plan 照执行，别的 board 指令不执行、提醒一句', () => {
  const out = talkLines([
    '对了。再看一个：',
    '',
    'set n = 4',
    '````board memo',
    'note text="学生把调入也算成缺页了" basis=L8',
    '````',
    '````board new id=b1 title="不该写"',
    '一段黑板',
    '````',
    '页框多了，缺页会？{? 变少 | *变多}',
  ].join('\n'), { final: true });
  assert.deepEqual(out.lines, ['对了。再看一个：', 'set n = 4', '页框多了，缺页会？{? 变少 | *变多}']);
  assert.deepEqual(out.ops.map((o) => o.op), ['memo']);
  assert.deepEqual(out.other, ['new']);
  assert.ok(out.notes.some((n) => /不写 board 块/.test(n)), out.notes.join('\n'));
});

test('talkLines：老师顺手用 ```huoban 包起来的照收；没闭合的 board 块、别的代码围栏不要；边写边显示只要写完的整行', () => {
  const wrapped = talkLines('看这里：\n```huoban\nlet a = 1\n{a}\n```\n', { final: true });
  assert.deepEqual(wrapped.lines, ['看这里：', 'let a = 1', '{a}']);
  const odd = talkLines('一行\n```js\nconsole.log(1)\n```\n````board memo\nnote text="没闭合"', { final: true });
  assert.deepEqual(odd.lines, ['一行']);
  assert.ok(odd.notes.some((n) => /没有闭合/.test(n)) && odd.notes.some((n) => /代码围栏/.test(n)), odd.notes.join('\n'));
  // 流式：最后一行还在写
  assert.deepEqual(talkLines('第一行\n第二行写了一半', { final: false }).lines, ['第一行']);
  assert.deepEqual(talkLines('第一行\n第二行\n', { final: false }).lines, ['第一行', '第二行']);
  // 流式时正在写的 board 块里的行不算
  assert.deepEqual(talkLines('话\n````board memo\nnote text="x"\n', { final: false }).lines, ['话']);
});

test('newErrors：只看这一轮新冒出来的（按行的字 + 原因；同一行写了两次分得开）', () => {
  const before = [{ line: '{x?}', msg: '第 3 行：不认识「x」' }];
  const after = [{ line: '{x?}', msg: '第 3 行：不认识「x」' }, { line: '{x?}', msg: '第 9 行：不认识「x」' }, { line: 'goal a > 9', msg: '目标做不到' }];
  // 行号不同、字一样：算同一条（原来那条还在）+ 新的一条
  assert.deepEqual(newErrors(before, after).map((e) => e.msg), ['第 9 行：不认识「x」', '目标做不到']);
  assert.deepEqual(newErrors(after, after), []);
  assert.match(rewriteText(newErrors(before, after)), /^这一轮有 2 行看不懂/);
});

test('作答记录的编号：L12、同一行第二个控件 L12.2、数变了重开再答 L12#2，读得回来', () => {
  assert.equal(recordId({ n: 12 }), 'L12');
  assert.equal(recordId({ n: 12, k: 2 }), 'L12.2');
  assert.equal(recordId({ n: 12, k: 1, round: 2 }), 'L12#2');
  assert.equal(recordId({ n: 3, k: 2, round: 3 }), 'L3.2#3');
  for (const id of ['L12', 'L12.2', 'L12#2', 'L3.2#3']) assert.equal(recordId(parseRecordId(id)), id);
  assert.equal(parseRecordId('q-b5'), null);
  assert.equal(parseRecordId('L'), null);
});

test('题面：空写成 □，选择写出选项，活的值写成现在的值', () => {
  const rt = new Runtime();
  rt.load('let f = 3\n{f} 个页框：缺页几次？{f * 3?} 会变多吗 {? *会 | 不会}');
  const ln = rt.board.lines.find((l) => l.kind === 'prose');
  assert.equal(questionText(ln.segs, (sg) => text(rt.eval(sg.ast))), '3 个页框：缺页几次？□ 会变多吗 （会 / 不会）');
  // 取不到值就写表达式
  assert.equal(questionText(parseProse('值是 {y}'), () => { throw new Error('x'); }), '值是 y');
});

test('存进数据库的值：精确分数写成 { $q }，读回来还是精确的', () => {
  const v = [Q.int(3), new Q(1n, 2n), [Q.int(-1), Q.int(4)]];
  const e = encValue(v);
  assert.doesNotThrow(() => JSON.stringify(e));
  assert.deepEqual(JSON.parse(JSON.stringify(e)), [{ $q: '3' }, { $q: '1/2' }, [{ $q: '-1' }, { $q: '4' }]]);
  const back = decValue(JSON.parse(JSON.stringify(e)));
  assert.equal(text(back[1]), text(new Q(1n, 2n)));
  assert.ok(back[2][0] instanceof Q);
  assert.equal(decValue('lru'), 'lru');
});

test('活板现状：永远不为空；源码带行号、按轮分开；量、空、选择、目标、找到的例子都写出来', () => {
  const empty = talkStateText({ screen: '学生的屏幕：竖屏 820×1180。' });
  assert.match(empty, /活板还是空的：这一轮写的就是第一问/);
  assert.equal(empty, talkStateText({ src: '  ', screen: '学生的屏幕：竖屏 820×1180。' }), '开课抢跑的指纹：没有活板时两种写法一样');
  const s = talkStateText({
    src: 'let k = 0 拨 0..5\n现在第 {k} 步：缺页几次？{r.faults?}\n对了。会变多吗？{? *会 | 不会}\ngoal k > 3 => "走到了后面"',
    bounds: [2, 4],
    inputs: [{ name: 'k', now: '4', init: '0', range: '能拨 0..5' }],
    blanks: [{ id: 'L2#2', n: 2, expr: 'r.faults', status: '', val: '', tries: 0, expected: '10', reopened: true, prev: '9', draft: '1' }],
    choices: [{ id: 'L3', n: 3, options: ['会', '不会'], picked: [{ t: '不会', ok: false }, { t: '会', ok: true }] }],
    goals: [{ id: 'L4', n: 4, msg: '走到了后面', done: true }],
    finds: [{ name: 'v', value: '1 2 3' }],
    notes: ['提醒：第 2 行：分不开'],
    screen: '学生的屏幕：竖屏 820×1180。',
  });
  for (const want of ['第 1 轮：', '第 2 轮（最近这一轮）：', '   1 | let k = 0 拨 0..5', 'k：现在 4（初值 0）', 'L2#2', '重新打开了（之前答的是「9」）', '现在写着「1」还没交', '页面现在算的答案 10',
    '选过 「不会」（不对）、「会」（对）', 'L4（第 4 行「走到了后面」）：做到了', 'v = 1 2 3', '提醒：第 2 行：分不开', '竖屏 820×1180']) assert.ok(s.includes(want), `活板现状里少了「${want}」：\n${s}`);
  assert.ok(!/[他她]/.test(s + empty));
  assert.equal(talkMeta({ ms: 3200 }), 'Opus 5.5 · 3.2 秒');
  assert.equal(talkMeta({ mock: true }), '模拟老师');
});

test('一问一答的说明：怎么教在前，带活板的写法和演示对象、活板现状；不带黑板指令、版面；整份在上限以内、不称呼学生他她', () => {
  const he = /(?<!其)[他她]/;
  const mem = { mem: {}, block: 'OS-L3.2.1', space: 'cs', session: 'c-20261105-1' };
  for (const subject of ['线代', '操作系统', '英语']) {
    const s = buildSystem({ componentDocs: DOCS, pack: { main: { sequence: ['先算 FIFO'] }, problems: { items: [{ q: '缺页几次' }] } }, board: '活板还是空的：这一轮写的就是第一问。', subject, memory: mem, talk: true });
    assert.ok(s.startsWith('这是一问一答的课的完整说明'));
    assert.ok(s.indexOf('# 一、怎么教') < s.indexOf('# 二、活板的写法') && s.indexOf('# 二、活板的写法') < s.indexOf('# 三、这节课的资料包') && s.indexOf('# 五、活板现状') > 0, '五节的顺序不对');
    assert.ok(s.includes('怎么教：一对一') && s.includes('活板：你写几行') && s.includes('## 活板对象') && s.includes('## 你会收到的消息'));
    assert.ok(!s.includes('### new：擦掉黑板') && !s.includes('版面：你自己排板'), '一问一答里不该带黑板指令、版面的说明');
    assert.ok(s.includes('推进顺序') && s.includes('在活板上用 {x?}'), '资料包没换成一问一答的说法');
    assert.ok(!/q-b5|point=tr/.test(s), '记忆的写法还是黑板的编号');
    assert.ok(s.includes('basis=L12'));
    assert.ok(Buffer.byteLength(s) <= SYSTEM_MAX, `${subject}：说明 ${Buffer.byteLength(s)} 字节，超了`);
    const bad = s.split('\n').filter((l) => he.test(l.replace(/不用「他」「她」/g, '')));
    assert.deepEqual(bad, [], `${subject} 的一问一答说明里有性别代词`);
  }
  // 资料包写了 rules：只换红线，开场和怎么教照旧在前
  const custom = buildSystem({ componentDocs: '', pack: { main: { rules: '只讲 FIFO。' } }, board: '', talk: true });
  assert.ok(custom.includes('只讲 FIFO。') && custom.includes('怎么教：一对一') && !custom.includes('下面是红线'));
  // 演示对象：408 的带页面置换，线代不带
  assert.match(talkObjectDocs(DOCS, '操作系统'), /paging/);
  assert.doesNotMatch(talkObjectDocs(DOCS, '线代'), /### sched/);
});

test('课堂（不是一问一答）的说明一字不变：共用的几条消息说明还在原处', () => {
  assert.match(PROTOCOL_DOC, /- 学生打的字，原样给你。四个快捷按钮会发/);
  assert.match(PROTOCOL_DOC, /- 附了图片时，是学生的手写或截图/);
  assert.match(PROTOCOL_DOC, /「【到目前为止的课堂摘要】」是更早的对话/);
  assert.match(MEMO_DOC, /basis=q-b5/);
  const pk = { main: { sequence: ['一'] }, problems: { items: [{ q: 'x' }] } };
  assert.match(packText(pk).text, /【讲解顺序/);
  assert.doesNotMatch(packText(pk).text, /在活板上用/);
});

test('活板上的动作：试（拨、拖、折）攒着，作答照旧；记录写成「第 n 行」', () => {
  assert.equal(actionTrigger({ source: 'record', type: 'huoban', explore: true, text: '拨 k：0 → 1' }), 'later');
  assert.equal(actionTrigger({ source: 'record', type: 'huoban', ok: false, text: '填空' }), 'soon');
  assert.equal(actionText({ source: 'record', type: 'huoban', step: 'hb', block: 'L8', n: 8, ok: false, text: '填空 {r.faults?}：写了 8，不对', ms: 31000 }), '[作答] 第 8 行：填空 {r.faults?}：写了 8，不对，用时 31 秒');
  assert.equal(actionText({ source: 'record', type: 'huoban', step: 'hb', explore: true, text: '拨 k：0 → 1' }), '[动作] 活板：拨 k：0 → 1');
  // 不是一问一答的活板（课件里的 huoban 块）：照原来的写法
  assert.equal(actionText({ source: 'record', type: 'huoban', step: 'b3', block: 'hb-1', text: '填空' }), '[作答] b3 里的活板 hb-1：填空');
});

test('memo 的依据写 L12：第 12 行那一问的全部作答（同一行第二个控件、重开再答的都算），L120 不算', () => {
  const evidence = [{ id: 'e1', comp: 'L12', at: 1 }, { id: 'e2', comp: 'L12#2', at: 2 }, { id: 'e3', comp: 'L12.2', at: 3 }, { id: 'e4', comp: 'L120', at: 4 }];
  assert.deepEqual(resolveBasis(['L12'], { evidence }).ids, ['e1', 'e2', 'e3']);
  assert.deepEqual(resolveBasis(['L12#2'], { evidence }).ids, ['e2']);
});

test('模拟老师的一问一答剧本：置换表 + 一个空 → set 改块数 + 选择 → 目标；答错给提示不往前走；写错一行、要重写时改对', () => {
  const sys = { role: 'user', content: buildSystem({ componentDocs: '', board: '', talk: true }) };
  const conv = [sys];
  const say = (text) => { conv.push({ role: 'user', content: text }); const r = devReply(conv.slice()); conv.push({ role: 'assistant', content: r.text }); return r; };
  const r1 = say('开始上课。');
  assert.equal(r1.kind, 'talk');
  const lines1 = talkLines(r1.text, { final: true }).lines;
  let src = applyOps('', lines1.join('\n'));
  const rt = new Runtime();
  rt.load(src);
  assert.deepEqual(rt.board.errors, []);
  assert.equal(text(rt.value('r.faults')), '9');
  assert.equal(say('[作答] 第 8 行：填空 {r.faults?}：写了 8，不对（页面算的是 9）').kind, 'talk-hint');
  const r2 = say('[作答] 第 8 行：填空 {r.faults?}：写了 9，对（第 2 次）');
  assert.match(r2.text, /set f = 4/);
  src = applyOps(src, talkLines(r2.text, { final: true }).lines.join('\n'));
  rt.load(src);
  assert.deepEqual(rt.board.errors, []);
  assert.equal(text(rt.value('r.faults')), '10', 'set 改了块数，空的答案跟着变');
  assert.equal(say('测试:写错').kind, 'talk-broken');
  assert.equal(say('[系统] 这一轮有 1 行看不懂，学生看到的还是上一轮的活板：…').kind, 'talk-fix');
  const r3 = say('[作答] 第 11 行：选择：选了「变多」，对');
  assert.match(r3.text, /goal g > 3/);
  rt.load(applyOps(src, talkLines(r3.text, { final: true }).lines.join('\n')));
  assert.deepEqual(rt.board.errors, []);
  assert.equal(say('[动作] 学生点了「就这样」').kind, 'talk-more');
  assert.ok(!/[他她]/.test(conv.filter((t) => t.role === 'assistant').map((t) => t.content).join('\n')));
});

test('写错退回再重写：重写的那一轮不再执行 memo 块（上一次已经记过），plan 照常；提醒里说 memo 已经记下了', () => {
  const ops = [{ op: 'memo', lines: ['review id=R3 result=过'] }, { op: 'plan', text: '下一步' }];
  assert.deepEqual(talkOps(ops).ops, ops);
  assert.deepEqual(talkOps(ops, { rewriting: true }).ops, ops); // 上一次没执行过 memo：照常执行
  const r = talkOps(ops, { rewriting: true, memoRan: true });
  assert.deepEqual(r.ops.map((o) => o.op), ['plan']);
  assert.equal(r.skipped, 1);
  assert.deepEqual(talkOps(ops, { memoRan: true }).ops, ops); // 不是重写（学生的新一轮）：照常
  assert.match(rewriteText([{ line: '{x?}', msg: '不认识「x」' }], { memoRan: true }), /memo 块已经记下了/);
  assert.doesNotMatch(rewriteText([{ line: '{x?}', msg: '不认识「x」' }]), /memo/);
});

test('活板的作答归题：同一个 L 编号是一道题，题面里活的值变了也不拆开（先错后对 = 改对了，不是一次对）', () => {
  const ev = (q, ok, at) => ({ src: 'record', kind: 'answer', type: 'huoban', comp: 'L3', step: 'hb', sub: 'blank', q, ok, value: ok ? '2' : '1', at, session: 's1' });
  const evs = [ev('现在 t = 1，det = 3；t 等于几时 det 为 0？t = □', false, 1), ev('现在 t = 2，det = 0；t 等于几时 det 为 0？t = □', true, 2)];
  const items = itemsOf(evs);
  assert.equal(items.length, 1);
  assert.equal(items[0].outcome, 'ok');
  // 重开再答（L3#2）是另一道；别的组件照旧按题面分
  assert.notEqual(itemKey({ ...evs[0], comp: 'L3#2' }), itemKey(evs[0]));
  assert.equal(itemKey({ src: 'record', comp: 'L3', type: 'answer', q: '甲' }), 'L3|甲');
  // 「有把握吗」的键和报告对得上
  assert.equal(sureKey({ block: 'L3', type: 'huoban', q: '别的字' }), itemKey(evs[1]));
});

test('写法错误的基线按学生现在拨到的值量：学生把量拨到让旧行算不出来，老师这一轮写对了不算新错', () => {
  // classroom.js 的 finishTalk 先把上一轮的板按现在的值画一遍、量一次，再画这一轮：这里用运行时和检查复现那两次量
  const errsOf = (rt) => checkBoard(rt).filter((p) => p.level === 'error').map((p) => ({ line: (rt.src.split('\n')[p.n - 1] || '').trim(), msg: p.msg }));
  const base = 'let k = 1 拨 0..4\n拨一拨：{6/k}，算 {6/k + 1?}';
  const rt = new Runtime();
  rt.load(base);
  const stale = errsOf(rt); // 上一轮画成功时（k = 1）
  assert.deepEqual(stale, []);
  rt.setInput('k', 0);
  rt.fresh();
  const nowBase = errsOf(rt); // 学生拨到 0 以后再量上一轮
  assert.ok(nowBase.length >= 1);
  rt.load(applyOps(base, '好，换个问题：{2 + 3?}'));
  rt.fresh();
  const after = errsOf(rt);
  assert.ok(newErrors(stale, after).length >= 1, '拿旧的基线比，会把老师没碰过的那一行当成新错');
  assert.deepEqual(newErrors(nowBase, after), []);
});
