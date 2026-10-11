import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { componentDocs } from '../kit/build-docs.js';
import {
  DEFAULT_RULES, PROTOCOL_DOC, bytes, buildSystem, boardStateText, nextSegmentId, packText, PACK_BUDGET, CUT_NOTE,
  actionText, actionsMessage, buildTurns, KEEP_RECENT, OMITTED, COMPACT_AT, needsCompaction, compactionPrompt,
  summaryTurn, SUMMARY_HEAD, closingPrompt,
} from '../kit/src/class/prompt.js';
import { compile } from '../kit/src/expr.js';

// scene.js 加载时会碰到页面对象：给最小的替身（同 live.test.js）
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { parseScene } = await import('../kit/src/scene.js');
// protocol.js 由别的模块实现；有的话顺便验证文档里的例子它都能解析
const protocolUrl = new URL('../kit/src/class/protocol.js', import.meta.url);
const protocol = existsSync(protocolUrl) ? await import(protocolUrl.href) : null;

const PROJECT = readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
const DOCS = componentDocs(PROJECT);
const KiB = 1024;
const sameBytes = (s) => assert.equal(bytes(s), Buffer.byteLength(s, 'utf8'), JSON.stringify(s.slice(0, 20)));
// 截断后不能留下半个代理对：UTF-8 往返一次应该不变
const wellFormed = (s) => assert.equal(Buffer.from(s, 'utf8').toString('utf8'), s);

// —— 构建期组件说明 ——

test('组件说明：从 CLAUDE-PROJECT.md 截出第三节，示例和表格都在', () => {
  for (const h of ['### scene', '### steps', '### graph', '### space', '### recognize', '### predict', '### answer', '### findbug']) {
    assert.ok(DOCS.includes(h), `缺少 ${h}`);
  }
  assert.ok(!DOCS.includes('## 四'), '截到了第四节');
  assert.ok(!/^## /m.test(DOCS.replace(/^```[\s\S]*?^```/gm, '')), '代码块外不应有二级标题');
  assert.ok(DOCS.includes('```scene\n'), '代码示例要保留');
  assert.ok(DOCS.includes('| 命令 | 作用 |'), '表格要保留');
  assert.ok(!DOCS.includes('### context'), 'context 在课堂里用不上');
  assert.ok(!DOCS.includes('### summary'), 'summary 在课堂里用不上');
  assert.ok(!DOCS.includes('\n\n\n'), '连续空行要去掉');
  assert.ok(!/^-{3,}$/m.test(DOCS), '分隔线要去掉');
  assert.ok(bytes(DOCS) < 40 * KiB, `组件说明太长：${bytes(DOCS)} 字节`);
});

test('组件说明：围栏里的「## 」不算节标题，代码块里的空行原样保留', () => {
  const md = [
    '# 说明', '## 二、别的', '正文', '```html', '## 三、组件参考', '```', '',
    '## 三、组件参考', '', '开头一句。', '', '', '', '### scene：图',
    '```scene', 'let x = 1', '', '', '## 不是标题', '```', '',
    '~~~', '## 也不是', '~~~', '---', '',
    '### context：背景', '这段要去掉', '```context', '## 里面', '```',
    '### 其他组件  ', '- 提示框', '',
    '## 四、读学习记录', '不要',
  ].join('\r\n');
  const out = componentDocs(md);
  assert.ok(out.startsWith('开头一句。'), out);
  assert.ok(out.includes('let x = 1\n\n\n## 不是标题'), '代码块内容要原样');
  assert.ok(out.includes('~~~\n## 也不是\n~~~'));
  assert.ok(!out.includes('这段要去掉'));
  assert.ok(!out.includes('## 里面'));
  assert.ok(out.includes('### 其他组件\n- 提示框'), '行尾空格去掉，下一个小节照常保留');
  assert.ok(!out.includes('不要'));
  assert.ok(!out.includes('---'));
  assert.ok(!out.includes('\r'));
  assert.ok(!out.includes('\n\n\n### scene'));
  assert.ok(componentDocs(md, { drop: [] }).includes('这段要去掉'), 'drop 可以改');
});

test('组件说明：找不到第三节时构建直接报错', () => {
  assert.throws(() => componentDocs('# 只有标题\n## 一、发布'), /组件参考/);
  assert.throws(() => componentDocs('```\n## 三、组件参考\n```'), /组件参考/);
});

// —— 字节 ——

test('bytes：和 UTF-8 编码一致（中文 3、emoji 4、落单代理项 3）', () => {
  for (const s of ['', 'abc', '中文', 'é', '😀', 'a中😀é\n', '\ud800', 'x\udc00y', '$\\mathbf x$，(1, 2)', '𝐱ᵀ𝐲 = 3']) sameBytes(s);
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647);
  for (let k = 0; k < 50; k++) {
    let s = '';
    for (let i = 0; i < 40; i++) s += String.fromCharCode(rnd() % 0xffff);
    sameBytes(s);
  }
  assert.equal(bytes(null), 0);
  assert.equal(bytes(undefined), 0);
  assert.equal(bytes(123), 3);
});

// —— 角色与红线、黑板指令 ——

test('默认红线：需求 2.3 第 1 条逐条都在', () => {
  const must = [
    '这节课的老师',
    '一次只推进一件事', '停下来等学生',
    '学生没有作答，就不往下推',
    '缺知识', '缺思路', '直接讲清楚', '给提示，不给答案',
    '三轮', '换一道同类的题',
    '没把握', '按没过处理',
    '已经掌握',
    '资料包里没有的教材内容不讲', '这个课后问对话里的 Claude',
    '话要短', '主要内容写在黑板上',
    '拖、点', '预测', '长段文字',
  ];
  for (const m of must) assert.ok(DEFAULT_RULES.includes(m), `红线缺「${m}」`);
});

// 文档里的 board 块：外层 4 个反引号，内层组件 3 个
const boardBlocks = (s) => [...s.matchAll(/^````board (.+)\n([\s\S]*?)^````$/gm)].map((m) => ({ header: m[1], body: m[2] }));
const innerBlocks = (s) => [...s.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)].map((m) => ({ name: m[1], src: m[2] }));

test('黑板指令说明：每条规则都写到了', () => {
  for (const m of [
    '4 个反引号', '````board add id=', '````board replace id=', '````board hide id=', '````board figure target=',
    ' set ', ' play ', ' highlight ', 'play t 0 1 2s',
    '同一节课里不能重复', 'b1、b2', '每个组件都要写 `id:`',
    '好几个指令', '先说一两句', '话要短',
    '[系统]', '写法错误', '`board replace`', '`board add` 同一个 id',
    '[作答]', '[动作]', '只数命令行', '从 1 开始数',
    '【到目前为止的课堂摘要】',
  ]) assert.ok(PROTOCOL_DOC.includes(m) || DEFAULT_RULES.includes(m), `缺「${m}」`);
  assert.ok(!PROTOCOL_DOC.includes('ˋ'), '占位的反引号都换回来了');
});

test('黑板指令说明：例子本身写对了（指令格式、组件 id、图的命令、highlight 序号）', () => {
  const blocks = boardBlocks(PROTOCOL_DOC);
  assert.equal(blocks.length, 7);
  const ID = '[A-Za-z0-9_\\-.~:@+]{1,64}';
  const grammar = [
    new RegExp(`^add id=${ID}( title=("[^"]*"|“[^”]*”))?$`),
    new RegExp(`^replace id=${ID}( title=("[^"]*"|“[^”]*”))?$`),
    new RegExp(`^hide id=${ID}$`),
    new RegExp(`^figure target=${ID} (set( \\w+=\\S.*)+|play \\w+( \\S+ \\S+ \\S+)?|highlight \\d+)$`),
  ];
  for (const b of blocks) assert.ok(grammar.some((g) => g.test(b.header)), `指令写法不对：${b.header}`);

  const comps = blocks.flatMap((b) => innerBlocks(b.body));
  assert.deepEqual(comps.map((c) => c.name), ['scene', 'answer', 'predict']);
  for (const c of comps) assert.match(c.src, /^id: [\w-]+$/m, `${c.name} 没写 id:`);

  // 图：解析得了，highlight 4 指的是第 4 条命令 line
  const fig = comps.find((c) => /id: fig-b3/.test(c.src));
  const { cmds, fields } = parseScene(fig.src);
  assert.equal(fields.id, 'fig-b3');
  assert.equal(cmds[3].kind, 'line');
  assert.ok(blocks.some((b) => b.header === 'figure target=fig-b3 highlight 4'));
  assert.ok(PROTOCOL_DOC.includes('第 4 条是 `line [0, 0] dir [1, 2]`'), '文字说明和例子里的序号一致');
  assert.ok(cmds.some((c) => c.kind === 'let' && c.name === 'x' && c.mods.drag), 'set x=… 改的是可拖的 x');
  // 例子里的 play t 要在这张图上真能放：图里得有变量 t
  assert.ok(blocks.some((b) => b.header === 'figure target=fig-b3 play t'));
  assert.ok(cmds.some((c) => c.kind === 'slider' && c.name === 't'), 'fig-b3 有滑块 t，play t 才能执行');

  const pred = parseScene(comps.find((c) => c.name === 'predict').src);
  const predA = compile(pred.cmds.find((c) => c.kind === 'let' && c.name === 'A').src)({});
  assert.deepEqual(compile(pred.fields.answer)({ A: predA }), [2, 4]);

  const ans = comps.find((c) => c.name === 'answer').src;
  const A = compile(ans.match(/^let A = (.+)$/m)[1])({});
  assert.deepEqual(compile(ans.match(/^answer: (.+)$/m)[1])({ A }), [2, 4]);
  // 说明里举的作答例子要和题目对得上：填 (4, 2) 是错的
  assert.ok(PROTOCOL_DOC.includes('填了 (4, 2)（错，第 1 次）'));
});

test('黑板指令说明：protocol.js 能把文档里的例子都解析出来', { skip: !protocol && 'protocol.js 还不存在' }, () => {
  const { ops } = protocol.parseOutput(PROTOCOL_DOC, { final: true });
  assert.deepEqual(ops.map((o) => o.op + (o.action ? ':' + o.action : '')), ['add', 'replace', 'hide', 'figure:set', 'figure:play', 'figure:highlight', 'add']);
  assert.equal(ops[0].id, 'b3');
  assert.equal(ops[0].title, 'Ax 落在哪');
  assert.ok(ops[0].body.includes('```scene') && ops[0].body.includes('```answer'), '内层组件留在 add 的内容里');
  assert.deepEqual(ops[3].assigns, { x: '[1, 1]' });
  assert.equal(ops[5].index, 4);
  assert.deepEqual(protocol.parseCommand('figure target=fig-b3 set x=[1, 1] k=2').assigns, { x: '[1, 1]', k: '2' });
  assert.equal(protocol.parseCommand('figure target=fig-b3 play t 0 1 2s').ms, 2000);
});

// —— 资料包 ——

const PACK = {
  main: {
    unit: '第2讲 §2 · 秩一方阵',
    goal: '看到行成比例的方阵能认出秩一，并用 tr 写出 Aⁿ',
    scope: '只讲 2×2 和 3×3',
    textbook: '定义 2.1 若 $A=\\alpha\\beta^T$ ……',
    plan: ['先看 Ax 落在哪', '再看 A²x'],
    student: '上次在第二段卡住：以为 Ax 会跑出那条线',
    rules: '',
    updatedAt: 1760000000000,
    model: 'claude-haiku-4-5',
    note: '多用图',
  },
  problems: { items: [{ q: '求 $A^{10}$', answer: '2^9 A', point: '秩一公式', source: '例 2.1' }, { q: '判断秩', answer: '1' }] },
};

test('资料包：按字段原样放进去，题目一行一道 JSON；rules / 模型字段不进正文', () => {
  const { text, truncated, empty } = packText(PACK);
  assert.equal(truncated, false);
  assert.equal(empty, false);
  for (const v of ['【单元】\n第2讲 §2 · 秩一方阵', '【这节课的目标】', '【范围和详略', '【教材原文', '定义 2.1 若 $A=\\alpha\\beta^T$', '【建议的推进顺序', '先看 Ax 落在哪\n再看 A²x', '【学生的情况】', '【note】\n多用图']) {
    assert.ok(text.includes(v), `缺「${v}」`);
  }
  assert.ok(text.includes(`\n${JSON.stringify(PACK.problems.items[0])},\n${JSON.stringify(PACK.problems.items[1])}\n]`));
  assert.ok(!text.includes('claude-haiku'), '模型由页面固定，资料包里的不理');
  assert.ok(!text.includes('1760000000000'));
  // 字段顺序：单元 → 目标 → 范围 → 教材 → 计划 → 学生 → 其他 → 题
  const order = ['【单元】', '【这节课的目标】', '【范围和详略', '【教材原文', '【建议的推进顺序', '【学生的情况】', '【note】', '【可以用的题】'].map((k) => text.indexOf(k));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('资料包：空的时候注明只讲最基本的', () => {
  for (const p of [null, undefined, {}, { main: null, problems: null }, { main: { rules: '只有规则', updatedAt: 1 } }, { main: { unit: '  ' }, problems: { items: [] } }]) {
    const r = packText(p);
    assert.equal(r.empty, true, JSON.stringify(p));
    assert.match(r.text, /还没有资料包：只讲最基本的、不确定的内容说课后问对话里的 Claude/);
  }
  assert.match(buildSystem({ pack: null }), /还没有资料包/);
  assert.equal(packText({ problems: { items: [{ q: 1 }] } }).empty, false, '只有题也算有资料包');
});

test('资料包：300 KiB 的教材按预算截断，注明已截断，小字段不动，字符不被切坏', () => {
  const line = '定义 2.1：秩一方阵 $A=\\alpha\\beta^T$。😀\n';
  const textbook = line.repeat(Math.ceil(300 * KiB / bytes(line)) + 1);
  assert.ok(bytes(textbook) > 300 * KiB);
  const pack = { main: { ...PACK.main, textbook } , problems: PACK.problems };
  const { text, truncated } = packText(pack);
  assert.equal(truncated, true);
  assert.ok(text.includes(CUT_NOTE));
  assert.ok(bytes(text) <= PACK_BUDGET + 2 * KiB, `资料包 ${bytes(text)} 字节`);
  assert.ok(bytes(text) > PACK_BUDGET - 4 * KiB, '预算要用足');
  assert.ok(text.includes(PACK.main.goal) && text.includes(PACK.main.student), '小字段原样保留');
  assert.ok(text.includes(JSON.stringify(PACK.problems.items[1])), '题目没超预算，不截');
  assert.ok(text.includes('【教材原文（教材内容只能用这里的）】\n定义 2.1：秩一方阵'), '教材从头开始保留');
  assert.match(text, /。😀\n（资料包太长，已截断）/, '在换行处截断');
  wellFormed(text);

  const sys = buildSystem({ componentDocs: DOCS, pack, board: [] });
  assert.ok(sys.includes(CUT_NOTE));
  assert.ok(bytes(sys) < 200 * KiB, `说明 ${bytes(sys)} 字节`);
});

test('资料包：几个大字段平分预算；题目按整道截掉', () => {
  const big = 'x'.repeat(200 * KiB);
  const { text } = packText({ main: { textbook: big, plan: big, goal: '目标' } });
  const tb = text.split('【建议的推进顺序')[0];
  const plan = text.split('【建议的推进顺序')[1];
  assert.ok(Math.abs(bytes(tb) - bytes(plan)) < 2 * KiB, '两个大字段差不多');
  assert.ok(text.includes('【这节课的目标】\n目标'));

  const items = Array.from({ length: 3000 }, (_, i) => ({ q: `第 ${i + 1} 题：求 $A^{${i}}$`, answer: 'αβᵀ'.repeat(10) }));
  const r = packText({ problems: { items } });
  assert.equal(r.truncated, true);
  assert.ok(bytes(r.text) <= PACK_BUDGET + KiB);
  const kept = r.text.split('\n').filter((l) => l.startsWith('{"q"'));
  kept.forEach((l) => JSON.parse(l.replace(/,$/, ''))); // 每道题都是完整的 JSON
  assert.match(r.text, new RegExp(`（资料包太长，已截断）后面还有 ${items.length - kept.length} 道题没放进来`));
});

// —— 黑板现状 ——

const BOARD = [
  { id: 'b1', title: '秩一方阵长什么样', summary: '看 $A=\\alpha\\beta^T$\n第二行', hidden: false, blocks: [
    { id: 'ex-1', kind: 'steps', results: [
      'b1 里的 steps ex-1「例2.1」第 2 步（换个括号）：选了『一个 2×2 矩阵』（错），用时 44 秒',
      { source: 'event', type: 'giveup', step: 3, block: 'ex-1', title: '推到 n 次', detail: { step: 3, title: '推到 n 次' } },
    ] },
    { id: 'fig-1', kind: 'scene', results: [] },
    { id: 'fig-2', kind: 'scene', results: ['在 b1 里的图 fig-2：把 x 拖到 [2, -1]'] },
  ] },
  { id: 'b2', title: '写错了的', hidden: true, blocks: [{ id: 'q-2', kind: 'answer', results: [] }] },
  { id: 'b3', hidden: false, blocks: [{ id: 'q-3', kind: 'answer', results: [] }, { id: 'pad', kind: 'draft', results: [] }] },
];

test('黑板现状：每段 id、标题、摘要、作答；撤回的注明；给出下一个 id', () => {
  const t = boardStateText(BOARD);
  assert.match(t, /^黑板上现在有 2 段（从上到下），另有 1 段已撤回：/);
  assert.ok(t.includes('- b1「秩一方阵长什么样」：看 $A=\\alpha\\beta^T$ / 第二行'), '摘要压成一行');
  assert.ok(t.includes('  - steps ex-1 的作答：\n    - 第 2 步（换个括号）：选了『一个 2×2 矩阵』（错），用时 44 秒'), '重复的位置前缀去掉');
  assert.ok(t.includes('    - 第 3 步（推到 n 次）：想不出来，直接揭开了'), '作答记录是对象时也能写成文字');
  assert.ok(t.includes('  - scene fig-1\n'), '图没有动作时不写「还没有作答」');
  assert.ok(t.includes('    - 把 x 拖到 [2, -1]'));
  assert.ok(t.includes('- b2「写错了的」（已撤回，学生看不到）'));
  assert.ok(!t.includes('q-2'), '撤回的段不列组件');
  assert.ok(t.includes('- b3\n  - answer q-3：还没有作答\n  - draft pad\n'));
  assert.ok(t.endsWith('新的一段用 id b4（用过的 id，包括撤回的，都不要再用）。'));
});

test('黑板现状：去掉位置前缀时 id 要整段匹配（ex-1 不吃掉 ex-10）', () => {
  const t = boardStateText([{ id: 'b1', blocks: [
    { id: 'ex-1', kind: 'steps', results: ['b1 里的 steps ex-10「别的」第 1 步：选了『a』（对）'] },
    { id: 'q.1', kind: 'answer', results: ['b1 里的 answer q.1：填了 2（对，第 1 次）', '没有位置前缀的一条'] },
  ] }]);
  assert.ok(t.includes('    - b1 里的 steps ex-10「别的」第 1 步：选了『a』（对）'));
  assert.ok(t.includes('    - 填了 2（对，第 1 次）\n    - 没有位置前缀的一条'));
});

test('黑板现状：空黑板；下一个 id 只看 b 编号', () => {
  for (const b of [[], undefined, null, [null]]) assert.equal(boardStateText(b), '黑板是空的。新的一段用 id b1。');
  assert.equal(nextSegmentId([{ id: 'b1' }, { id: 'B9' }, { id: 'intro' }, { id: 'b10x' }]), 'b10');
  assert.equal(nextSegmentId([{ id: 'intro' }]), 'b1');
  assert.match(boardStateText([{ id: 'b1', hidden: true }]), /没有显示的段（1 段都已撤回）[\s\S]*新的一段用 id b2/);
});

// —— 第一条消息 ——

test('buildSystem：顺序是 角色与红线 → 组件说明 → 黑板指令 → 资料包 → 黑板现状', () => {
  const sys = buildSystem({ componentDocs: DOCS, pack: PACK, board: BOARD });
  const marks = [
    '# 一、你的角色和红线', DEFAULT_RULES.slice(0, 30),
    '# 二、组件写法和黑板指令', '### scene', '### recognize', PROTOCOL_DOC.slice(0, 30),
    '# 三、这节课的资料包', '【单元】\n第2讲',
    '# 四、黑板现状', '黑板上现在有 2 段',
  ].map((m) => {
    const i = sys.indexOf(m);
    assert.ok(i >= 0, `缺「${m.slice(0, 20)}」`);
    return i;
  });
  assert.deepEqual(marks, [...marks].sort((a, b) => a - b));
  assert.ok(sys.indexOf('【单元】') > sys.lastIndexOf('### 其他组件'), '资料包在组件说明之后');
  assert.ok(sys.includes('文中的「我」指学生'), '组件说明是写给项目 Claude 的，要提醒');
});

test('buildSystem：rules（参数或资料包里的）覆盖默认红线，空白不算', () => {
  const custom = '你是助教，只出题不讲解。';
  let sys = buildSystem({ rules: custom, componentDocs: DOCS, pack: PACK, board: [] });
  assert.ok(sys.includes(`# 一、你的角色和红线\n\n${custom}`));
  assert.ok(!sys.includes(DEFAULT_RULES));
  assert.ok(sys.includes(PROTOCOL_DOC), '覆盖的只是红线，黑板指令照常');

  sys = buildSystem({ componentDocs: DOCS, pack: { ...PACK, main: { ...PACK.main, rules: custom } }, board: [] });
  assert.ok(sys.includes(custom) && !sys.includes(DEFAULT_RULES));
  assert.equal(sys.split(custom).length, 2, 'rules 不再在资料包里重复一遍');

  sys = buildSystem({ rules: '   \n ', componentDocs: DOCS, pack: PACK, board: [] });
  assert.ok(sys.includes(DEFAULT_RULES));
  sys = buildSystem({ rules: ['第一条', '第二条'], pack: PACK });
  assert.ok(sys.includes('第一条\n第二条'));
});

test('buildSystem：缺组件说明时也能拼，且注明', () => {
  const sys = buildSystem({});
  assert.ok(sys.includes('组件说明没有打包进来'));
  assert.ok(sys.includes('黑板是空的'));
  assert.ok(sys.includes(PROTOCOL_DOC));
});

// —— 学生的动作 ——

test('actionText：steps 的选择、填数、自由作答、想不出来、看答案', () => {
  const base = { source: 'record', type: 'steps', step: 'b7', block: 'ex-1', title: '例2.1', stage: 3, at: 1 };
  assert.equal(
    actionText({ ...base, q: '跑哪去了｜Ax 在哪条线上？', detail: '第 3 步', value: '跑到线外去', ok: false, ms: 44000 }),
    '[作答] b7 里的 steps ex-1「例2.1」第 3 步（跑哪去了）：选了『跑到线外去』（错），用时 44 秒',
  );
  assert.equal(
    actionText({ ...base, q: '算一个数｜', detail: '第 2 步', value: '3', ok: true, attempts: 2, transcript: '1×1+2×1=3', ms: 9400 }),
    '[作答] b7 里的 steps ex-1「例2.1」第 2 步（算一个数）：填了 3（对，第 2 次）；手写过程（转写）：「1×1+2×1=3」，用时 9 秒',
  );
  assert.equal(
    actionText({ ...base, detail: '第 1 步', text: '先把\nβᵀα 算出来', via: '手写', ok: null }),
    '[作答] b7 里的 steps ex-1「例2.1」第 1 步：写了「先把 / βᵀα 算出来」（手写转写）',
  );
  assert.equal(actionText({ ...base, detail: '第 2 步', giveup: true, ok: null, ms: 61000 }), '[作答] b7 里的 steps ex-1「例2.1」第 2 步：想不出来，用时 1 分 1 秒');
  assert.match(actionText({ ...base, detail: '第 3 步', final: true, revealed: true, attempts: 3, value: '(1, 2)' }), /第 3 步：没做出来，看了答案（试了 3 次），最后填的是 \(1, 2\)$/);
  assert.match(actionText({ ...base, detail: '第 3 步', text: '' }), /交了，但什么也没写$/);
});

test('actionText：answer / practice 的每次尝试和最终结果', () => {
  const a = { source: 'record', type: 'answer', step: 'b3', block: 'q-2', title: '算一算', q: '计算 A(1,2)' };
  assert.equal(actionText({ ...a, value: '(1, 4)', ok: true, attempts: 2 }), '[作答] b3 里的 answer q-2「算一算」：填了 (1, 4)（对，第 2 次）');
  assert.equal(actionText({ ...a, value: '7', ok: false, attempts: 1, transcript: '2-2=0\n1+6=7' }), '[作答] b3 里的 answer q-2「算一算」：填了 7（错，第 1 次）；手写过程（转写）：「2-2=0 / 1+6=7」');
  assert.equal(actionText({ ...a, final: true, revealed: true, ok: false, attempts: 2, expected: '(0, 7)' }), '[作答] b3 里的 answer q-2「算一算」：试了 2 次没做对，看了答案（正确答案 (0, 7)）');
  assert.equal(actionText({ ...a, final: true, ok: true, attempts: 1, expected: '(0, 7)' }), '[作答] b3 里的 answer q-2「算一算」：做对了（共 1 次）');
  // 练习题是程序出的，要把题目带上
  assert.equal(
    actionText({ source: 'record', type: 'practice', step: 'b5', block: 'p-1', title: '矩阵乘向量', q: '计算 [[2,1],[0,3]]·(1,-1)', value: '(1, -3)', ok: true, attempts: 1, ms: 15000 }),
    '[作答] b5 里的 practice p-1「矩阵乘向量」：题目「计算 [[2,1],[0,3]]·(1,-1)」，填了 (1, -3)（对，第 1 次），用时 15 秒',
  );
  // 数据库里读回来的记录（kind、text、null 字段）
  assert.equal(actionText({ source: 'record', kind: 'answer', step: 'b3', block: 'q-2', title: '算一算', value: '(1, 4)', ok: false, attempts: 1, text: null, transcript: null }), '[作答] b3 里的 answer q-2「算一算」：填了 (1, 4)（错，第 1 次）');
});

test('actionText：conjecture（手写转写、自评、页面批改；数据库形状）', () => {
  const c = { source: 'record', type: 'conjecture', step: 'b4', block: 'cj-1', title: '你发现了什么' };
  assert.equal(actionText({ ...c, answer: 'Ax 都在 (1,2) 这条线上', attempts: 1, verdict: '已交，等 Claude 看', via: '手写' }), '[作答] b4 里的 conjecture cj-1「你发现了什么」：写了「Ax 都在 (1,2) 这条线上」（手写转写）');
  assert.equal(actionText({ ...c, answer: '都一样', attempts: 2, verdict: '已交，等 Claude 看' }), '[作答] b4 里的 conjecture cj-1「你发现了什么」：写了「都一样」（第 2 次交）');
  assert.match(actionText({ ...c, answer: '在线上', verdict: '自评：部分一致' }), /写了「在线上」，自评「部分一致」$/);
  assert.match(actionText({ ...c, answer: '在线上', verdict: '看了参考答案' }), /，看了参考答案$/);
  assert.match(actionText({ ...c, type: 'conjecture-try', answer: '不知道', verdict: 'Claude：不正确' }), /^\[作答\] b4 里的 conjecture cj-1「你发现了什么」：写了「不知道」，页面批改：不正确$/);
  assert.match(actionText({ source: 'record', kind: 'conjecture', step: 'b4', block: 'cj-1', text: '截图里写的', via: '截图' }), /写了「截图里写的」（截图转写）$/);
});

test('actionText：recognize / findbug / quiz / predict / scene', () => {
  const at = (x) => actionText({ source: 'record', step: 'b6', ...x });
  assert.equal(
    at({ type: 'recognize', block: 'rec-1', title: '认方法', q: 'A 三行成比例，求 A^10', value: '试算低次幂', ok: false, expected: '秩一公式', text: '看着像', ms: 8200, attempts: 1 }),
    '[作答] b6 里的 recognize rec-1「认方法」：「A 三行成比例，求 A^10」选了「试算低次幂」（错，应为「秩一公式」），理由：「看着像」，用时 8 秒',
  );
  assert.match(at({ type: 'recognize', block: 'rec-1', q: '求 A^8', value: '拆 kE+B', ok: true, detail: '重做' }), /^\[作答\] b6 里的 recognize rec-1（重做）：「求 A\^8」选了「拆 kE\+B」（对）$/);
  assert.equal(at({ type: 'recognize-sum', block: 'rec-1', title: '认方法', value: '4/5', ok: false, ms: 9000, detail: '平均 9 秒，错 1 题' }), '[作答] b6 里的 recognize rec-1「认方法」：做完一轮，认对 4/5，平均 9 秒，错 1 题');
  assert.equal(at({ type: 'findbug', block: 'bug-1', title: '错在哪', value: '第 2 行', ok: true, attempts: 1, text: '长度要平方', via: '手写' }), '[作答] b6 里的 findbug bug-1「错在哪」：指出错在第 2 行（对，第 1 次），说明：「长度要平方」（手写转写）');
  assert.equal(at({ type: 'findbug', block: 'bug-1', value: '看了答案（点过第 1、3 行）', ok: false, revealed: true, expected: '第 2 行' }), '[作答] b6 里的 findbug bug-1：看了答案（点过第 1、3 行），第一处错在第 2 行');
  assert.equal(at({ type: 'quiz', block: 'qz-1', q: '若 det A = 0，下列哪项一定成立？', ok: true, attempts: 2, wrong: ['A 可逆'] }), '[作答] b6 里的 quiz qz-1：「若 det A = 0，下列哪项一定成立？」做对了（共 2 次），选错过：「A 可逆」');
  assert.equal(at({ type: 'predict', block: 'pred-1', title: '先猜', guess: [1.2, 3.4], answer: [2, 4], ok: false }), '[作答] b6 里的 predict pred-1「先猜」：猜在 (1.2, 3.4)，实际在 (2, 4)（差得比较远）');
  assert.equal(at({ type: 'predict', block: 'pred-1', value: '1.9,4.1', ok: true }), '[作答] b6 里的 predict pred-1：猜在 (1.9, 4.1)（猜得准）');
  assert.equal(at({ type: 'scene', block: 'fig-1', title: '让 Ax 命中目标', ok: true }), '[作答] b6 里的图 fig-1「让 Ax 命中目标」：达成了图里的目标');
});

test('actionText：事件（想不出来、揭开、拖动、这段做完了），兼容 detail 摊开和不摊开', () => {
  const ev = { source: 'event', type: 'giveup', step: 'b7', block: 'ex-1', detail: { step: 2, title: '换个括号' } };
  assert.equal(actionText(ev), '[动作] b7 里的 steps ex-1 第 2 步（换个括号）：想不出来，直接揭开了');
  // classroom.js 把 detail 摊开到顶层：step 变成第几步（数）
  assert.equal(actionText({ ...ev, ...ev.detail }), '[动作] steps ex-1 第 2 步（换个括号）：想不出来，直接揭开了');
  assert.equal(actionText({ source: 'event', type: 'reveal', step: 'b7', block: 'ex-1', detail: { step: 3, title: '推到 n 次' } }), '[动作] b7 里的 steps ex-1：揭开第 3 步（推到 n 次）');
  const drag = { source: 'event', type: 'drag', step: 'b2', block: 'fig-1', detail: { name: 'x', value: [2, -1] } };
  assert.equal(actionText(drag), '[动作] b2 里的图 fig-1：把 x 拖到 [2, -1]');
  assert.equal(actionText({ ...drag, ...drag.detail, value: [0.1 + 0.2, -0] }), '[动作] b2 里的图 fig-1：把 x 拖到 [0.3, 0]');
  assert.equal(actionText({ source: 'event', type: 'done', step: 'b5', detail: { title: '秩一' } }), '[动作] 点了 b5「秩一」的「这段做完了」');
});

test('actionText：不认识的写成 [动作] + JSON 简写；字符串原样；一行；过长截断', () => {
  const u = actionText({ source: 'event', type: 'wiggle', step: 'b1', block: 'fig-1', detail: { n: 3 }, at: 5 });
  assert.match(u, /^\[动作\] wiggle（b1 里的 fig-1）：\{"detail":\{"n":3\}\}$/);
  assert.match(actionText({ source: 'record', type: 'mystery', foo: 'bar' }), /^\[动作\] mystery：\{"foo":"bar"\}$/);
  assert.equal(actionText('[作答] 已经是文字'), '[作答] 已经是文字');
  assert.equal(actionText(null), '');
  const long = actionText({ source: 'record', type: 'conjecture', block: 'c', answer: '很长的猜想'.repeat(500) });
  assert.ok(!long.includes('\n'));
  assert.ok(long.length < 800 && long.includes('…'));
  assert.equal(actionText({ source: 'record', type: 'answer', block: 'page', value: '1', ok: true, attempts: 1 }), '[作答] answer：填了 1（对，第 1 次）', 'page 不是组件 id');
  assert.match(actionText({ source: 'record', type: 'steps', block: 'e', detail: '第 1 步', value: 'x', ok: null, ms: 120000 }), /选了『x』，用时 2 分钟$/);
});

test('actionsMessage：一行一个动作，空的跳过', () => {
  const msg = actionsMessage([
    { source: 'record', type: 'answer', step: 'b3', block: 'q-2', value: '(1, 4)', ok: true, attempts: 1 },
    null,
    '[动作] 手写的一行',
    { source: 'event', type: 'drag', step: 'b2', block: 'fig-1', name: 'x', value: [1, 1] },
  ]);
  assert.equal(msg, '[作答] b3 里的 answer q-2：填了 (1, 4)（对，第 1 次）\n[动作] 手写的一行\n[动作] b2 里的图 fig-1：把 x 拖到 [1, 1]');
  assert.equal(actionsMessage([]), '');
  assert.equal(actionsMessage(undefined), '');
});

// —— 多轮对话 ——

const SYS = '课堂说明';
const turn = (role, text, extra = {}) => ({ role, text, ...extra });

test('buildTurns：角色映射、跳过作废和空的、系统消息加前缀、首尾都是 user', () => {
  const { turns, bytes: n, historyBytes, dropped } = buildTurns({
    system: SYS,
    history: [
      turn('student', '开始上课。'),
      turn('claude', '好，先看图。\n````board add id=b1\n…\n````'),
      turn('system', '[系统] b1 有写法错误'),
      turn('claude', '作废的一轮', { discarded: true }),
      turn('system', 'Opus 5.5 不可用', { discarded: true, kind: 'fallback' }),
      turn('claude', '我改一下'),
      turn('claude', '   '),
      turn('student', '[作答] b1 里的 answer q-1：填了 3（对，第 1 次）'),
      turn('system', '下课了，写小结'),
      turn('other', '不认识的角色'),
    ],
  });
  assert.deepEqual(turns, [
    { role: 'user', content: SYS },
    { role: 'user', content: '开始上课。' },
    { role: 'assistant', content: '好，先看图。\n````board add id=b1\n…\n````' },
    { role: 'user', content: '[系统] b1 有写法错误' },
    { role: 'assistant', content: '我改一下' },
    { role: 'user', content: '[作答] b1 里的 answer q-1：填了 3（对，第 1 次）' },
    { role: 'user', content: '[系统] 下课了，写小结' },
  ]);
  assert.equal(n, turns.reduce((s, t) => s + Buffer.byteLength(t.content), 0));
  assert.equal(historyBytes, n - bytes(SYS));
  assert.equal(dropped, 0);
  assert.ok(turns.every((t) => t.content.trim()));
});

test('buildTurns：最后一条不是 user 时报错；没有说明时报错；没有历史时只有说明', () => {
  assert.throws(() => buildTurns({ system: SYS, history: [turn('student', '你好'), turn('claude', '好')] }), /最后一条/);
  assert.throws(() => buildTurns({ system: '  ', history: [turn('student', '你好')] }), /课堂说明/);
  assert.deepEqual(buildTurns({ system: SYS }).turns, [{ role: 'user', content: SYS }]);
  // 最后的 claude 那轮作废了：照样以 user 结尾
  assert.equal(buildTurns({ system: SYS, history: [turn('student', '你好'), turn('claude', '退路模型', { discarded: true })] }).turns.at(-1).role, 'user');
});

const convo = (n, size) => Array.from({ length: n }, (_, i) => turn(i % 2 ? 'claude' : 'student', `#${i} ` + '讲'.repeat(Math.floor(size / 3))));

test('buildTurns：超长时从最早的丢，在说明后面注明已省略，最近 20 条一定保留', () => {
  const history = convo(61, 10 * KiB); // 0..60，最后一条是学生
  const max = 262144;
  const r = buildTurns({ system: SYS, history, maxBytes: max });
  assert.ok(r.bytes <= max, `${r.bytes} > ${max}`);
  assert.ok(r.dropped > 0);
  assert.deepEqual(r.turns[0], { role: 'user', content: SYS });
  assert.deepEqual(r.turns[1], { role: 'user', content: OMITTED });
  assert.equal(r.turns.length, 2 + history.length - r.dropped);
  assert.ok(r.turns[2].content.startsWith(`#${r.dropped} `), '丢的是最早的那几条');
  assert.deepEqual(r.turns.slice(-KEEP_RECENT).map((t) => t.content), history.slice(-KEEP_RECENT).map((t) => t.text));
  assert.equal(r.turns.at(-1).role, 'user');
  // 不多丢：再放回一条就会超
  assert.ok(r.bytes + bytes(history[r.dropped - 1].text) > max);

  // 最近 20 条本身就超了：照样保留（调用方会先压缩）
  const huge = buildTurns({ system: SYS, history: convo(25, 20 * KiB), maxBytes: 100 * KiB });
  assert.equal(huge.dropped, 5);
  assert.equal(huge.turns.length, 2 + KEEP_RECENT);
  assert.ok(huge.bytes > 100 * KiB);

  // 不超时不插省略提示
  assert.ok(!buildTurns({ system: SYS, history: convo(41, KiB) }).turns.some((t) => t.content === OMITTED));
});

test('buildTurns：摘要那一条不会被丢，省略提示放在缺口处', () => {
  const history = [summaryTurn('学生卡在第 2 步。'), ...convo(41, 12 * KiB)];
  const r = buildTurns({ system: SYS, history, maxBytes: 262144 });
  assert.ok(r.dropped > 0);
  assert.equal(r.turns[1].content, `[系统] ${SUMMARY_HEAD}\n学生卡在第 2 步。`);
  assert.equal(r.turns[2].content, OMITTED);
});

test('needsCompaction：未作废的历史超过 80 KiB 且多于 20 条', () => {
  const sized = (n, total) => convo(n, Math.ceil(total / n));
  assert.equal(needsCompaction(sized(21, COMPACT_AT + 2 * KiB)), true);
  assert.equal(needsCompaction(sized(20, 200 * KiB)), false, '条数不够');
  assert.equal(needsCompaction(sized(30, 70 * KiB)), false, '字节不够');
  const withDiscarded = [...sized(21, 70 * KiB), turn('claude', '讲'.repeat(20 * KiB), { discarded: true })];
  assert.equal(needsCompaction(withDiscarded), false, '作废的不算');
  assert.equal(needsCompaction([]), false);
  assert.equal(needsCompaction(undefined), false);
  // 正好 80 KiB 不算超
  const exact = Array.from({ length: 21 }, () => turn('student', 'a'.repeat(COMPACT_AT / 21)));
  exact.push(turn('student', 'a'.repeat(COMPACT_AT - exact.reduce((s, t) => s + t.text.length, 0))));
  assert.equal(exact.reduce((s, t) => s + bytes(t.text), 0), COMPACT_AT);
  assert.equal(needsCompaction(exact), false);
  exact.push(turn('student', 'a'));
  assert.equal(needsCompaction(exact), true);
});

test('compactionPrompt：要求和记录都在，更早的摘要并进来，超长的条目截断', () => {
  const p = compactionPrompt({
    summary: `${SUMMARY_HEAD}\n上次卡在 βᵀα。`,
    turns: [turn('student', '没懂。'), turn('claude', '换个说法：……'), turn('system', '[系统] b3 有写法错误'), turn('claude', '作废', { discarded: true })],
  });
  for (const m of ['到目前为止的课堂摘要', '1500', '学生卡在哪', '错过什么', '已经讲到哪', '黑板上有哪些段', '不要编']) assert.ok(p.includes(m), `缺「${m}」`);
  assert.ok(p.includes('【更早的摘要】（把它也并进新的摘要里）\n上次卡在 βᵀα。'), '更早的摘要去掉标题再放进来');
  assert.ok(p.includes('[学生]\n没懂。') && p.includes('[你（课堂里的 Claude）]\n换个说法') && p.includes('[系统]\n[系统] b3'));
  assert.ok(!p.includes('作废'));
  assert.ok(p.indexOf('没懂。') < p.indexOf('换个说法'));
  assert.ok(!compactionPrompt({ turns: [turn('student', '你好')] }).includes('更早的摘要'));

  const big = compactionPrompt({ turns: convo(30, 30 * KiB) });
  assert.ok(bytes(big) < 230 * KiB, `${bytes(big)} 字节`);
  assert.ok(big.includes('这一条太长，后面省略'));
  wellFormed(big);
});

test('summaryTurn / closingPrompt', () => {
  assert.deepEqual(summaryTurn('  学生卡在第 2 步。\n'), { role: 'system', kind: 'summary', text: '【到目前为止的课堂摘要】\n学生卡在第 2 步。' });
  assert.equal(summaryTurn(`${SUMMARY_HEAD}\n已经有标题`).text, `${SUMMARY_HEAD}\n已经有标题`, '标题不重复');
  const c = closingPrompt();
  for (const m of ['下课', '小结', '1. ', '2. ', '3. ', '4. ', '讲了什么', '卡住', '看起来懂了但证据不够', '下一节怎么接', '已经掌握']) assert.ok(c.includes(m), `缺「${m}」`);
  // 作为 system 消息进对话
  assert.ok(buildTurns({ system: SYS, history: [turn('student', '下课'), turn('system', c)] }).turns.at(-1).content.startsWith('[系统] 下课了'));
});

test('整轮拼起来：真实组件说明 + 300 KiB 教材 + 长对话，不超过 256 KiB', () => {
  const pack = { main: { ...PACK.main, textbook: '教材原文。'.repeat(300 * KiB / 15) }, problems: PACK.problems };
  const system = buildSystem({ componentDocs: DOCS, pack, board: BOARD });
  assert.ok(bytes(system) < 160 * KiB, `说明 ${bytes(system)} 字节`);
  // 刚到压缩线的对话：说明 + 80 KiB 历史直接放得下，一条都不用丢
  const atLine = convo(81, KiB);
  assert.equal(needsCompaction(atLine), true);
  let r = buildTurns({ system, history: atLine });
  assert.ok(r.bytes <= 262144, `${r.bytes} 字节`);
  assert.equal(r.dropped, 0);
  // 压缩没赶上（比如摘要失败）：丢最早的，照样不超
  r = buildTurns({ system, history: convo(81, 3 * KiB) });
  assert.ok(r.bytes <= 262144, `${r.bytes} 字节`);
  assert.ok(r.dropped > 0);
  assert.equal(r.turns[0].content, system);
  assert.equal(r.turns.at(-1).role, 'user');
});

// —— 2026-10 布局修订：说的话写在黑板上；手写、截图暂时关掉 ——

test('课堂说明：说的话写在黑板上，不再提对话框 / 消息区', () => {
  assert.doesNotMatch(DEFAULT_RULES + PROTOCOL_DOC, /对话框|消息区|对话条/);
  assert.match(PROTOCOL_DOC, /也写在黑板上/);
  assert.match(PROTOCOL_DOC, /接在黑板最后面/, 'replace 的段留在原位，话接在最后：要写清是哪一段');
  assert.match(DEFAULT_RULES, /输入框/);
});

test('组件手册：手写、截图功能关着的时候，手册里写明暂时关掉、不要让学生用', async () => {
  const { FEATURES } = await import('../kit/src/features.js');
  if (FEATURES.handwriting || FEATURES.photo) return; // 打开以后这条不适用
  assert.match(DOCS, /暂时关掉了/);
  assert.match(DOCS, /不要让我用它们/);
  assert.doesNotMatch(DOCS, /「✎ 手写作答」：我/, '不能再把手写作答写成可用的功能');
  assert.doesNotMatch(DOCS, /拿给 Claude 看」会把草稿/);
});
