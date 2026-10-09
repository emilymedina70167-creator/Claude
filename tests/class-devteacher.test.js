import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createDevTeacher, devReply, streamChunks, lastUserText, SET_X } from '../kit/src/class/devteacher.js';

// 组件库的解析器在 import 时会碰一下 document（mathinput.js 挂键盘监听），node 里给个最小的替身。
// 每个测试文件在自己的进程里跑，不影响别的测试。
globalThis.document ??= { addEventListener() {}, compatMode: 'CSS1Compat' };
const { parseScene, fillValues } = await import('../kit/src/scene.js');
const { parseSteps } = await import('../kit/src/blocks/steps.js');
const { parseRecognize } = await import('../kit/src/blocks/recognize.js');
const { compile, isNum, isVec } = await import('../kit/src/expr.js');
const { mdToHtml } = await import('../kit/src/render.js');

const OPUS = { model: 'claude-opus-5-5', effort: 'high', modelTier: 'complex', cache: false };
// 课堂说明里的示例也有「写法错误」「（错）」「想不出来」「新的一段用 id」：剧本不能被它们带偏
const SYSTEM = [
  '这是课堂模式的完整说明……',
  '- [作答] b3 里的 answer q-b3「算一个」：填了 (4, 2)（错，第 1 次），用时 31 秒',
  '- [动作] b2 里的 steps ex-1 第 2 步：想不出来，直接揭开了',
  '收到「[系统] … 写法错误」，说明那一段的组件写错了。四个快捷按钮会发：「没懂。」「继续。」',
  '# 四、黑板现状',
  '黑板是空的。新的一段用 id b1。',
].join('\n');

// 模拟 classroom：说明 + 对话，每轮把老师的输出接回历史
function lesson(teacher = createDevTeacher({ pace: 0 })) {
  const history = [];
  return {
    teacher,
    history,
    turns: () => [{ role: 'user', content: SYSTEM }, ...history],
    async say(content, opts = {}) {
      history.push({ role: 'user', content });
      const r = await teacher([{ role: 'user', content: SYSTEM }, ...history], { ...OPUS, ...opts });
      history.push({ role: 'assistant', content: r.text });
      return { ...r, kind: teacher.calls.at(-1).kind };
    },
  };
}

// —— 只用字符串拆 board 块和组件（不依赖 protocol.js）——
function boards(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^````board (.*)$/);
    if (!m) continue;
    const body = [];
    let j = i + 1;
    while (j < lines.length && lines[j] !== '````') body.push(lines[j++]);
    assert.ok(j < lines.length, `board 块没有闭合：${lines[i]}`);
    out.push({ header: m[1], body: body.join('\n') });
    i = j;
  }
  return out;
}
const speechOf = (text) => text.replace(/^````board [^\n]*\n[\s\S]*?^````$/gm, '').trim();
const components = (body) => [...body.matchAll(/^```(\w+)\n([\s\S]*?)\n```$/gm)].map((m) => ({ lang: m[1], src: m[2] }));
const idOf = (src) => (src.match(/^id:\s*([\w\-.~:@+]+)\s*$/m) || [])[1];

// 写错的公式：语法错是 katex-error；不认识的命令（比如 \mathbx）会被染成红色 #cc0000
function assertTeX(md, where) {
  const html = mdToHtml(md);
  const bad = html.match(/katex-error[^>]*>([^<]*)|tex-error[^>]*>([^<]*)|mathcolor="#cc0000"><mtext>([^<]*)/);
  assert.ok(!bad, `${where} 里有公式渲染不出来：${bad?.slice(1).find(Boolean)}`);
}

// 用组件库自己的解析器检查一个组件：写法对、表达式能算、公式能渲染、写了 id:
function validate({ lang, src }) {
  assert.ok(idOf(src), `${lang} 没写 id:`);
  if (lang === 'scene' || lang === 'answer') {
    const { fields, cmds } = parseScene(src);
    const v = { step: 3, t: 0.5 }; // 绑定 steps 的图会有 step、t
    for (const c of cmds) {
      if (c.kind === 'let') v[c.name] = c.expr(v);
      if (c.kind === 'slider') v[c.name] = c.init;
    }
    for (const c of cmds) {
      if (c.kind === 'vector') { assert.ok(isVec(c.expr(v)), 'vector 要是向量'); if (c.from) c.from(v); }
      if (c.exprs) c.exprs.forEach((e) => e(v));
      if (c.kind === 'line') { c.p(v); c.d(v); }
      if (c.kind === 'curve') for (const s of [0, 90, 200]) assert.ok(isVec(c.expr({ ...v, [c.param]: s })));
      if (c.kind === 'show') { const errs = []; fillValues(c.text, v, errs); assert.deepEqual(errs, [], `show 算不出来：${c.text}`); assertTeX(c.text.replace(/\{[^{}]+\}/g, '1'), 'show'); }
    }
    if (lang === 'answer') {
      assert.ok(fields.answer, 'answer 需要 answer:');
      const val = compile(fields.answer)(v);
      assert.ok(isNum(val) || isVec(val), 'answer 要能算出数或向量');
    }
    for (const k of ['title', 'q', 'hint', 'explain']) if (fields[k]) assertTeX(fields[k], `${lang}.${k}`);
    return { fields, cmds };
  }
  if (lang === 'steps') {
    const r = parseSteps(src);
    for (const s of r.steps) for (const k of ['title', 'ask', 'show']) if (s[k]) assertTeX(s[k], `steps.${k}`);
    assertTeX(r.fields.q, 'steps.q');
    return r;
  }
  if (lang === 'recognize') {
    const r = parseRecognize(src);
    for (const it of r.items) { assertTeX(it.q, 'recognize.item'); assertTeX(it.why, 'recognize.why'); }
    return r;
  }
  if (lang === 'key') {
    const rest = src.replace(/^id:.*\n/, '');
    assert.match(rest, /^title: \S/, 'key 第一行（id 之后）是 title:');
    assertTeX(rest, 'key');
    return null;
  }
  assert.fail(`剧本里不该出现 ${lang}`);
}

// —— 流式 ——

test('流式：onText 拼起来等于最终 text，每块 6–20 个字符', async () => {
  const t = createDevTeacher({ pace: 0 });
  const seen = [];
  const r = await t([{ role: 'user', content: SYSTEM }, { role: 'user', content: '你好' }], { ...OPUS, onText: (e) => seen.push(e) });
  assert.ok(seen.length > 20, '应该分很多小块');
  assert.equal(seen.map((e) => e.delta).join(''), r.text);
  assert.equal(seen.at(-1).text, r.text);
  seen.forEach((e, i) => {
    const n = [...e.delta].length;
    if (i < seen.length - 1) assert.ok(n >= 6 && n <= 20, `第 ${i} 块 ${n} 个字符`);
    else assert.ok(n >= 1 && n <= 20);
    // 每次给的 text 都是到目前为止的全文
    assert.equal(e.text, seen.slice(0, i + 1).map((x) => x.delta).join(''));
  });
  assert.equal(r.truncated, false);
  assert.equal(r.modelTierApplied, 'complex');
});

test('流式：开头停 600ms，之后每 40–80ms 一块（假时钟）', async () => {
  const input = [{ role: 'user', content: SYSTEM }, { role: 'user', content: '你好' }];
  const parts = streamChunks(devReply(input).text);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const t = createDevTeacher();
    const seen = [];
    const p = t(input, { ...OPUS, onText: (e) => seen.push(e) });
    mock.timers.tick(599);
    assert.equal(seen.length, 0, '600ms 内不出字');
    mock.timers.tick(1);
    assert.equal(seen.length, 1);
    while (seen.length < parts.length) {
      const before = seen.length;
      mock.timers.tick(39);
      assert.equal(seen.length, before, '间隔不少于 40ms');
      let waited = 39;
      while (seen.length === before) { mock.timers.tick(1); waited++; assert.ok(waited <= 80, '间隔不超过 80ms'); }
      assert.equal(seen.length, before + 1);
    }
    const r = await p;
    assert.equal(r.text, parts.join(''));
  } finally {
    mock.timers.reset();
  }
});

test('流式切块：按码点切，emoji 不被拆开；同一段文字切法固定', () => {
  const text = '😀中文ab'.repeat(40);
  const parts = streamChunks(text);
  assert.equal(parts.join(''), text);
  for (const p of parts) assert.ok(!/^[\udc00-\udfff]|[\ud800-\udbff]$/.test(p), '代理对被拆开了');
  assert.deepEqual(streamChunks(text), parts);
  assert.deepEqual(streamChunks(''), []);
});

test('模型：默认 modelApplied 等于传进来的 model；fallback 时为 undefined（模拟 Opus 5.5 不可用）', async () => {
  const input = [{ role: 'user', content: '你好' }];
  const ok = await createDevTeacher({ pace: 0 })(input, OPUS);
  assert.equal(ok.modelApplied, 'claude-opus-5-5');
  const fb = createDevTeacher({ fallback: true, pace: 0 });
  assert.equal(fb.fallback, true);
  const r = await fb(input, OPUS);
  assert.equal(r.modelApplied, undefined);
  assert.equal(r.modelTierApplied, 'complex');
  assert.match(r.text, /board add id=b1/, '退路模型也照常输出，作废由页面判断');
  // 不讲课的小活（摘要）用 default 档、不传 model
  const s = await createDevTeacher({ pace: 0 })('请写「到目前为止的课堂摘要」。', { modelTier: 'default' });
  assert.equal(s.modelApplied, undefined);
  assert.equal(s.modelTierApplied, 'default');
});

test('中止：途中 abort 立刻 reject cancelled，text 是已经输出的部分，之后不再出字', async () => {
  const t = createDevTeacher({ pace: 0 });
  const ctl = new AbortController();
  const seen = [];
  const p = t([{ role: 'user', content: '你好' }], { ...OPUS, signal: ctl.signal, onText: (e) => { seen.push(e); if (seen.length === 3) ctl.abort(); } });
  await assert.rejects(p, (e) => e.code === 'cancelled' && e.text === seen[2].text && e.text.length > 0);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(seen.length, 3);
});

test('中止：调用前已经 abort、或者在「思考」的停顿里 abort，都马上 reject，text 为空', async () => {
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(createDevTeacher({ pace: 0 })([{ role: 'user', content: '你好' }], { signal: ctl.signal }), { code: 'cancelled', text: '' });

  const ctl2 = new AbortController();
  const t0 = Date.now();
  const onText = mock.fn();
  const p = createDevTeacher()([{ role: 'user', content: '你好' }], { signal: ctl2.signal, onText });
  setTimeout(() => ctl2.abort(), 20);
  await assert.rejects(p, { code: 'cancelled', text: '' });
  assert.ok(Date.now() - t0 < 400, '不用等 600ms 的停顿结束');
  assert.equal(onText.mock.callCount(), 0);

  // 已经结束的调用，再 abort 也没事
  const ctl3 = new AbortController();
  const r = await createDevTeacher({ pace: 0 })([{ role: 'user', content: '你好' }], { signal: ctl3.signal });
  ctl3.abort();
  assert.ok(r.text);
});

test('onText 抛错不打断这一轮', async () => {
  const err = mock.method(console, 'error', () => {});
  try {
    const r = await createDevTeacher({ pace: 0 })([{ role: 'user', content: '你好' }], { onText: () => { throw new Error('页面出错'); } });
    assert.match(r.text, /board add/);
    assert.ok(err.mock.callCount() > 0);
  } finally {
    err.mock.restore();
  }
});

// —— 剧本 ——

test('剧本 1：第一轮打招呼 + b1（steps ex-1 和绑定它的 scene fig-1）', async () => {
  const L = lesson();
  const r = await L.say('老师好');
  assert.equal(r.kind, 'first');
  const bs = boards(r.text);
  assert.equal(bs.length, 1);
  assert.match(bs[0].header, /^add id=b1 title="[^"]+"$/);
  const cs = components(bs[0].body);
  assert.deepEqual(cs.map((c) => c.lang), ['steps', 'scene']);
  const steps = validate(cs[0]);
  assert.equal(steps.fields.id, 'ex-1');
  assert.ok(steps.steps.length >= 2 && steps.steps.length <= 3);
  assert.ok(steps.steps.some((s) => s.choices && s.answer), '有选择题的一步');
  assert.ok(steps.steps.some((s) => s.do && s.num !== null), '有自己做、能判分的一步');
  const scene = validate(cs[1]);
  assert.equal(scene.fields.id, 'fig-1');
  assert.equal(scene.fields.link, 'ex-1');
  // 给 figure 指令留的变量：let x（可拖）和绑定提供的 t
  assert.ok(scene.cmds.some((c) => c.kind === 'let' && c.name === 'x' && c.mods.drag));
  assert.match(cs[1].src, /lerp\(x, A\*x, t\)/);
  // 秩一方阵 A = αβᵀ，α=[1,2]，β=[1,1]
  assert.match(cs[1].src, /let A = \[\[1, 1\], \[2, 2\]\]/);
  // 先说话再写黑板，写完补一句
  assert.ok(r.text.indexOf('我们接着') < r.text.indexOf('````board'));
  assert.ok(speechOf(r.text).length > 20);
});

test('剧本 2：[作答] / [动作] → 回应 + figure set、play + 新的一段 answer', async () => {
  const L = lesson();
  await L.say('开始吧');
  const right = await L.say('[作答] b1 里的 steps ex-1「A 再作用一次」 第 1 步：选了『一个数』（对），用时 9 秒');
  assert.equal(right.kind, 'actions');
  assert.match(right.text, /^对。/);
  assert.ok(right.text.includes(`\`\`\`\`board figure target=fig-1 set x=${SET_X}\n\`\`\`\``));
  assert.ok(right.text.includes('````board figure target=fig-1 play t\n````'));
  assert.ok(!right.text.includes('highlight'), '答对了不用指给他看');
  const add = boards(right.text).find((b) => b.header.startsWith('add'));
  assert.match(add.header, /^add id=b2 /);
  const [ans] = components(add.body);
  assert.equal(ans.lang, 'answer');
  assert.equal(idOf(ans.src), 'q-2');
  const { fields, cmds } = validate(ans);
  const v = {};
  for (const c of cmds) if (c.kind === 'let') v[c.name] = c.expr(v);
  assert.deepEqual(compile(fields.answer)(v), [2, 4], 'x=(3,-1)：βᵀx=2，Ax=2α');
  // 顺序：说话 → 图动起来 → 再说 → 新的一段
  const order = ['set x=', 'play t', 'board add'].map((s) => right.text.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order);

  const wrong = await L.say('[作答] b2 里的 answer q-2「先算一个数」：填了 (3, 6)（错，第 1 次），用时 40 秒');
  assert.match(wrong.text, /容易想岔/);
  assert.match(wrong.text, /board figure target=fig-1 highlight 3\n/);
  assert.match(wrong.text, /board add id=b3 /);

  const giveup = await L.say('[动作] b1 里的 steps ex-1 第 2 步：想不出来，直接揭开了');
  assert.equal(giveup.kind, 'actions');
  assert.match(giveup.text, /^没关系/);
  assert.match(giveup.text, /highlight 3/);
  // 换着用不同的 x，答案跟着变
  const answers = L.history.filter((t) => t.role === 'assistant').flatMap((t) => boards(t.content)).flatMap((b) => components(b.body)).filter((c) => c.lang === 'answer').map((c) => parseScene(c.src).fields.answer);
  assert.equal(new Set(answers).size, answers.length);
});

test('剧本 3：「继续」→ 故意写错的一段，组件库的自检会拦下来', async () => {
  const L = lesson();
  await L.say('开始');
  const r = await L.say('继续。');
  assert.equal(r.kind, 'broken');
  const [b] = boards(r.text);
  assert.match(b.header, /^add id=b2 title="Aⁿ 怎么写"$/);
  const cs = components(b.body);
  const scene = cs.find((c) => c.lang === 'scene');
  assert.ok(scene.src.includes('circle [0, 0] 1'));
  assert.throws(() => parseScene(scene.src), /看不懂这一行：circle \[0, 0\] 1/);
  // 其余组件是好的（只坏一处，重写时改这一处就行）
  validate(cs.find((c) => c.lang === 'answer'));
  cs.forEach((c) => assert.ok(idOf(c.src), '写错的段里组件也有 id:'));

  // 写错过一次以后，普通的话走兜底，不再故意写错
  const next = await L.say('好的');
  assert.equal(next.kind, 'fallback');
  // 暗号「测试:写错」再来一段：这次是 answer 少了 answer:
  const again = await L.say('测试:写错');
  assert.equal(again.kind, 'broken');
  const ans = components(boards(again.text)[0].body).find((c) => c.lang === 'answer');
  assert.equal(parseScene(ans.src).fields.answer, undefined, 'answer 组件会报「answer 需要 answer:」');
  validate(components(boards(again.text)[0].body).find((c) => c.lang === 'scene'));
});

test('剧本 4：[系统] … 写法错误 → 「我改一下」+ board replace 同一个 id，写对的版本', async () => {
  const L = lesson();
  await L.say('开始');
  await L.say('继续。');
  const r = await L.say('[系统] b2「Aⁿ 怎么写」有写法错误，没有显示：\n  1. scene：看不懂这一行：circle [0, 0] 1\n请用 board replace（id 不变）把上面没显示的段重新写对。只写这几段，不用再对学生说别的。');
  assert.equal(r.kind, 'fix');
  assert.match(r.text, /^我改一下/);
  const bs = boards(r.text);
  assert.equal(bs.length, 1);
  assert.equal(bs[0].header, 'replace id=b2');
  const cs = components(bs[0].body);
  assert.deepEqual(cs.map((c) => [c.lang, idOf(c.src)]), [['scene', 'fig-2'], ['answer', 'q-2']], '组件 id 和写错时一样');
  cs.forEach(validate);
  assert.ok(!r.text.includes('circle'));

  // 系统消息点名哪段就改哪段；一次点了两段就改两段
  const two = devReply([{ role: 'user', content: SYSTEM }, { role: 'assistant', content: 'x' }, { role: 'user', content: '[系统] b7「甲」有写法错误，没有显示：\n  1. …\nb9 有写法错误，没有显示：\n  1. …' }]);
  assert.deepEqual(boards(two.text).map((b) => b.header), ['replace id=b7', 'replace id=b9']);
  assert.ok(two.text.includes('id: fig-7') && two.text.includes('id: q-9'));
  // 认不出 id：改上次故意写错的那段
  const memo = { seq: 0, broken: 0 };
  devReply([{ role: 'user', content: '开始' }, { role: 'assistant', content: 'x' }, { role: 'user', content: '继续' }], memo);
  const fix = devReply([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'x' }, { role: 'user', content: '[系统] 上一段有写法错误' }], memo);
  assert.deepEqual(boards(fix.text).map((b) => b.header), [`replace id=${memo.lastBroken}`]);
});

test('「一直写错」：重写也是错的（两种错法轮换），用来测页面显示「这段没画出来」', async () => {
  const L = lesson();
  await L.say('开始');
  await L.say('一直写错');
  const lint = '[系统] b2「Aⁿ 怎么写」有写法错误，没有显示：\n  1. …';
  const r1 = await L.say(lint);
  const r2 = await L.say(lint);
  assert.equal(r1.kind, 'fix-broken');
  assert.equal(r2.kind, 'fix-broken');
  const broken = (text) => {
    const cs = components(boards(text)[0].body);
    try { cs.forEach(validate); return null; } catch (e) { return e.message; }
  };
  assert.ok(broken(r1.text), '第一次重写还是错的');
  assert.ok(broken(r2.text), '第二次重写还是错的');
  assert.notEqual(broken(r1.text), broken(r2.text), '两次错法不一样');
});

test('剧本 5：没懂 / 换个说法 / 想不出来 → 一段 key 提示框', async () => {
  const L = lesson();
  await L.say('开始');
  const seen = new Set();
  for (const [msg, open] of [['没懂。', '退一步'], ['换个说法讲讲？', '具体的数'], ['想不出来。', '提示']]) {
    const r = await L.say(msg);
    assert.equal(r.kind, 'confused');
    assert.ok(r.text.includes(open), msg);
    const [b] = boards(r.text);
    assert.match(b.header, /^add id=b\d+ title="[^"]+"$/);
    const [key] = components(b.body);
    assert.equal(key.lang, 'key');
    validate(key);
    // 段标题和提示框标题不重复
    assert.notEqual(b.header.match(/title="([^"]+)"/)[1], key.src.match(/^title: (.*)$/m)[1]);
    seen.add(key.src);
  }
  assert.equal(seen.size, 3, '三种说法内容不同');
});

test('剧本 6：下课 → 四点小结，不写黑板；数得出卡住的次数', async () => {
  const L = lesson();
  await L.say('开始');
  await L.say('[作答] b1 里的 steps ex-1 第 1 步：选了『一个向量』（错），用时 12 秒');
  await L.say('没懂。');
  const r = await L.say('[系统] 下课了。请写这节课的小结，给项目对话里的 Claude 课后看：它会据此判断学生掌握得怎么样、下一节从哪里接。');
  assert.equal(r.kind, 'closing');
  assert.equal(boards(r.text).length, 0);
  for (const k of ['1. **这节课讲了什么**', '2. **学生哪里卡住**', '3. **哪里看起来懂了但证据不够**', '4. **建议下一节怎么接**']) assert.ok(r.text.includes(k), k);
  assert.match(r.text, /答错 1 次/);
  assert.match(r.text, /说「没懂」1 次/);
  assert.match(r.text, /黑板上一共写了 3 段/);
  assert.ok(!/已经掌握/.test(r.text), '不宣布学生「已经掌握」');
  assertTeX(r.text, '小结');
  // 学生自己打「下课」也一样
  assert.equal(devReply([{ role: 'user', content: '下课' }]).kind, 'closing');
});

test('剧本 7：兜底 → recognize 认方法小练；系统的其他提示也走兜底', async () => {
  const L = lesson();
  await L.say('开始');
  await L.say('继续');
  const r = await L.say('我觉得我懂了');
  assert.equal(r.kind, 'fallback');
  const [b] = boards(r.text);
  const [rec] = components(b.body);
  assert.equal(rec.lang, 'recognize');
  const parsed = validate(rec);
  assert.ok(parsed.items.length >= 3);
  assert.equal(parsed.reason, true);
  const sys = await L.say('[系统] 指令 figure fig-9 没执行：黑板上没有这个图');
  assert.equal(sys.kind, 'fallback', '[系统] 的其他提示不触发「故意写错」或提示框');
});

test('课堂摘要：compactionPrompt 是一整段字符串，回摘要正文，不写黑板', async () => {
  const t = createDevTeacher({ pace: 0 });
  const r = await t('你是这节课的老师（课堂模式）。……\n请写「到目前为止的课堂摘要」。要求：……\n[学生]\n没懂。\n[学生]\n继续', { modelTier: 'default', cache: false });
  assert.equal(t.calls[0].kind, 'compact');
  assert.equal(boards(r.text).length, 0);
  assert.match(r.text, /已经讲到哪/);
  assert.ok(Buffer.byteLength(r.text) < 1500 * 3);
});

test('段号：b1、b2…递增；同样的输入再调一次也不重号；跟着黑板现状和之前的输出往后编', async () => {
  const t = createDevTeacher({ pace: 0 });
  const input = [{ role: 'user', content: SYSTEM }, { role: 'assistant', content: '````board add id=b1\n…\n````' }, { role: 'user', content: '没懂' }];
  const a = await t(input, OPUS);
  const b = await t(input, OPUS);
  assert.match(a.text, /board add id=b2 /);
  assert.match(b.text, /board add id=b3 /);
  // 黑板现状说「新的一段用 id b8」（取说明里最后一处）
  const hinted = devReply([{ role: 'user', content: `${SYSTEM.replace('b1。', 'b3。')}\n……\n新的一段用 id b8（用过的 id……）` }, { role: 'assistant', content: '好' }, { role: 'user', content: '没懂' }]);
  assert.match(hinted.text, /board add id=b8 /);
  assert.match(hinted.text, /id: key-8/);
  // 之前的输出里用到过 b12（比如换了一个模拟老师实例）
  const after = devReply([{ role: 'user', content: SYSTEM }, { role: 'assistant', content: '````board replace id=b12\n…\n````' }, { role: 'user', content: '没懂' }]);
  assert.match(after.text, /board add id=b13 /);
  // 同时发出的两轮也不重号
  const t2 = createDevTeacher({ pace: 0 });
  const [x, y] = await Promise.all([t2(input, OPUS), t2(input, OPUS)]);
  assert.notEqual(x.text.match(/add id=(b\d+)/)[1], y.text.match(/add id=(b\d+)/)[1]);
});

test('课堂说明里的示例不会带偏剧本（说明里有「写法错误」「（错）」「想不出来」）', () => {
  assert.equal(devReply([{ role: 'user', content: SYSTEM }, { role: 'user', content: '你好' }]).kind, 'first');
  const conv = [{ role: 'user', content: SYSTEM }, { role: 'user', content: '你好' }, { role: 'assistant', content: '……' }, { role: 'user', content: '继续' }];
  assert.equal(devReply(conv).kind, 'broken', '说明里的「写法错误」不算写错过');
});

test('一整节课：除了故意写错的那段，黑板内容都能被组件库解析；组件 id 不重复；link 指向存在的 steps', async () => {
  const L = lesson();
  const script = [
    '老师好',
    '[作答] b1 里的 steps ex-1 第 1 步：选了『一个数』（对），用时 9 秒',
    '[动作] b1 里的图 fig-1：把 x 拖到 [2, 1]',
    '继续。',
    '[系统] b4「Aⁿ 怎么写」有写法错误，没有显示：\n  1. scene：看不懂这一行：circle [0, 0] 1',
    '没懂。',
    '换个说法讲讲？',
    '想不出来。',
    '嗯',
    '[作答] b4 里的 answer q-4「推到 n 次」：填了 9（对，第 1 次），用时 20 秒',
    '[系统] 下课了。请写这节课的小结',
  ];
  const kinds = [];
  for (const msg of script) kinds.push((await L.say(msg)).kind);
  assert.deepEqual(kinds, ['first', 'actions', 'actions', 'broken', 'fix', 'confused', 'confused', 'confused', 'fallback', 'actions', 'closing']);

  const live = new Map(); // 段 id → 组件
  const added = [];
  for (const [i, t] of L.history.entries()) {
    if (t.role !== 'assistant') continue;
    assertTeX(speechOf(t.content), `第 ${i} 条的话`);
    for (const b of boards(t.content)) {
      const m = b.header.match(/^(add|replace) id=(\S+)/);
      if (!m) { assert.match(b.header, /^figure target=fig-1 (set x=\[|play t$|highlight 3$)/); assert.equal(b.body, ''); continue; }
      if (m[1] === 'add') added.push(m[2]);
      const cs = components(b.body);
      assert.ok(cs.length > 0);
      if (kinds[(i - 1) / 2] === 'broken') { assert.throws(() => cs.forEach(validate)); live.set(m[2], []); continue; }
      cs.forEach(validate);
      live.set(m[2], cs);
      // 段里组件以外的文字也要能渲染
      assertTeX(b.body.replace(/^```\w+\n[\s\S]*?\n```$/gm, ''), `${m[2]} 的文字`);
    }
  }
  assert.equal(new Set(added).size, added.length, '段 id 不重复');
  const ids = [...live.values()].flat().map((c) => idOf(c.src));
  assert.equal(new Set(ids).size, ids.length, `组件 id 不重复：${ids.join(' ')}`);
  for (const cs of live.values()) for (const c of cs) {
    const link = c.src.match(/^link:\s*(\S+)/m)?.[1];
    if (link) assert.ok(ids.includes(link), `link: ${link} 指向的组件不在黑板上`);
  }
  // figure 指令操作的图在黑板上，变量在图里
  assert.ok(ids.includes('fig-1'));
});

// —— 错误、附图、边界 ——

test('出错：暗号「测试:rate_limited」等按错误码 reject；超长、图片不合规也会 reject', async () => {
  const t = createDevTeacher({ pace: 0 });
  const conv = (msg) => [{ role: 'user', content: SYSTEM }, { role: 'assistant', content: '……' }, { role: 'user', content: msg }];
  await assert.rejects(t(conv('测试:rate_limited'), OPUS), { code: 'rate_limited' });
  await assert.rejects(t(conv('测试：not_granted'), OPUS), { code: 'not_granted' });
  await assert.rejects(t(conv('测试:refused'), OPUS), { code: 'refused' });
  assert.equal(devReply(conv('测试:whatever')).kind, 'broken', '不认识的错误码当普通文字');
  await assert.rejects(t([{ role: 'user', content: '字'.repeat(90000) }], OPUS), { code: 'prompt_too_large' });
  const png = { type: 'image/png', size: 1000 };
  await assert.rejects(t(conv('看图'), { ...OPUS, images: [png, png, png, png, png] }), { code: 'image_rejected' });
  await assert.rejects(t(conv('看图'), { ...OPUS, images: [{ type: 'image/gif', size: 10 }] }), { code: 'image_rejected' });
  await assert.rejects(t(conv('看图'), { ...OPUS, images: [{ type: 'image/png', size: 25e6 }] }), { code: 'image_rejected' });
});

test('附图：照常回答，并说明模拟老师不读图；只有图没有字时走兜底', async () => {
  const t = createDevTeacher({ pace: 0 });
  const img = { type: 'image/png', size: 2048 };
  const conv = (msg) => [{ role: 'user', content: SYSTEM }, { role: 'assistant', content: '……' }, { role: 'user', content: msg }];
  const r = await t(conv('没懂。\n（附了 1 张图：学生的手写或截图，白底黑字。）'), { ...OPUS, images: [img] });
  assert.equal(t.calls.at(-1).kind, 'confused');
  assert.match(r.text, /^（模拟老师：图收到了/);
  assert.equal(t.calls.at(-1).opts.images.length, 1);
  assert.equal(devReply(conv('（学生附了图）'), undefined, { images: 1 }).kind, 'fallback');
});

test('边界输入：空的、字符串、content 是块数组，都不抛错', async () => {
  const t = createDevTeacher({ pace: 0 });
  for (const input of [undefined, null, '', [], [null, 3], '你好']) {
    const r = await t(input, OPUS);
    assert.match(r.text, /board add id=b\d+/, String(input));
  }
  assert.equal(lastUserText([{ role: 'user', content: [{ type: 'text', text: '没懂' }, { type: 'image', source: {} }] }]), '没懂');
  assert.equal(devReply([{ role: 'user', content: SYSTEM }, { role: 'assistant', content: [{ type: 'text', text: '好' }] }, { role: 'user', content: [{ type: 'text', text: '没懂。' }] }]).kind, 'confused');
  // 最后一条意外是 assistant 时，按最后一条 user 消息挑
  assert.equal(lastUserText([{ role: 'user', content: '下课' }, { role: 'assistant', content: '好' }]), '下课');
  // 中文全角冒号、首尾空白
  assert.equal(devReply([{ role: 'user', content: SYSTEM }, { role: 'assistant', content: '好' }, { role: 'user', content: '  没懂  ' }]).kind, 'confused');
});

test('teacher.json：转写、读最终答案、批改、其他', async () => {
  const t = createDevTeacher({ pace: 0 });
  const tr = await t.json('图片是学生的手写内容……只回复一个 JSON 对象：{"transcript": "转写结果"}', { images: [{ type: 'image/png', size: 10 }], modelTier: 'default' });
  assert.match(tr.transcript, /^（模拟转写）/);
  const vec = await t.json('要读出的最终答案形状：一个含 2 个分量的向量，写成数组。只回复一个 JSON 对象：{"transcript": "转写结果", "final": 按形状的答案或 null}');
  assert.deepEqual(vec.final, ['1', '2']);
  const mat = await t.json('要读出的最终答案形状：一个 2×3 的矩阵，按行写成二维数组。{"transcript": "…", "final": …}');
  assert.deepEqual(mat.final, [['1', '2', '3'], ['4', '5', '6']]);
  const num = await t.json('要读出的最终答案形状：一个数，例如 "-3/4"。{"transcript": "…", "final": …}');
  assert.equal(num.final, '1');
  const v = await t.json('…只回复一个 JSON 对象：{"verdict": "correct" | "partial" | "incorrect", "feedback": "…", "followup": "…"}', { modelTier: 'quick' });
  assert.equal(v.verdict, 'partial');
  assert.ok(v.feedback && v.followup);
  const other = await t.json([{ role: 'user', content: '随便说点什么' }]);
  assert.equal(typeof other.text, 'string');
  assert.deepEqual(t.calls.map((c) => c.method), ['json', 'json', 'json', 'json', 'json', 'json']);
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(t.json('x', { signal: ctl.signal }), { code: 'cancelled' });
});

test('limits、calls、reset', async () => {
  const t = createDevTeacher({ pace: 0 });
  const lim = t.limits();
  assert.deepEqual(lim, { maxPromptBytes: 262144, images: { maxCount: 4, maxInputBytes: 20000000, mediaTypes: ['image/png', 'image/jpeg'] } });
  lim.images.mediaTypes.push('image/gif');
  assert.deepEqual(t.limits().images.mediaTypes, ['image/png', 'image/jpeg'], '改了返回值不影响下一次');

  const ctl = new AbortController();
  const input = [{ role: 'user', content: '你好' }];
  const tools = [{ name: 'lesson_note', description: '记一条', inputSchema: { type: 'object' }, execute: async () => 'ok' }];
  await t(input, { ...OPUS, signal: ctl.signal, onText: () => {}, tools });
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0].input, input);
  assert.notEqual(t.calls[0].input, input, '记下的是副本');
  assert.deepEqual(t.calls[0].opts, { ...OPUS, tools: [{ name: 'lesson_note', description: '记一条', inputSchema: { type: 'object' } }] });
  assert.equal(t.calls[0].kind, 'first');
  assert.equal(t.calls[0].method, 'call');

  const calls = t.calls;
  t.reset();
  assert.equal(t.calls.length, 0);
  assert.equal(calls, t.calls, 'reset 清空同一个数组，别处拿着的引用还能用');
  const again = await t(input, OPUS);
  assert.match(again.text, /board add id=b1 /, 'reset 后段号从头编');
});
