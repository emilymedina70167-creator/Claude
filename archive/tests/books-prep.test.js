// 第十四轮搬过来的备课测试（首页「让 Claude 备课」拿掉了，备课学生跟项目 Claude 说）。不跑；函数在 archive/kit/src/books/plan.js。

// —— 从 tests/books.test.js ——
test('备课出教案：规则清单、讲解顺序、每题用到的规则；页面核依赖（题用到没讲过的、讲得比题晚的报出来），资料包写成好读的文字', async () => {
  const { checkPrep, lessonPlanText } = await import('../kit/src/books/plan.js');
  const { packText } = await import('../kit/src/class/prompt.js');
  const block = { id: 'EN-L1.1.1', title: '五种句型' };
  const raw = JSON.stringify({
    unit: '五种句型', goal: '能标出五种句型的主干', route: '1. 一主一谓\n2. 划块\n3. 真题演练',
    review: [{ id: 'R19', how: '一句新的真题，圈全谓语' }, { id: 'R99', how: '不在到期里的' }],
    methods: [{ id: 'm1', title: '找谓语', steps: '按注释标的词性找 v.', teach: 1 }, { id: 'm2', title: '划块', steps: '名词连同前面的修饰词算一块；代词自己一块', teach: 3 }],
    sequence: [{ step: 1, point: '一主一谓', how: 'parse 演示' }, { step: 2, point: '及物不及物' }, { step: 3, point: '划块' }],
    problems: [
      { q: '标主干：Everybody loves a fat pay rise.', answer: '[S Everybody] [V loves] [O a fat pay rise]', needs: ['m1', 'm2'], after: 3 },
      { q: '标主干：Such characteristics make them perfect candidates.', answer: '…', needs: ['m1', 'm2'], after: 2 },
      { q: '标主干：It happened.', answer: '…', needs: ['m3'], after: 3 },
    ],
  });
  const { main, problems, warnings } = parsePrep(raw, { block, reviewIds: ['R19'] });
  assert.deepEqual(main.review.map((r) => r.id), ['R19'], '只留到期的复现组');
  assert.equal(main.methods.length, 2);
  assert.deepEqual(problems.items[0].needs, ['m1', 'm2']);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /第 2 题放在第 2 步之后，但它要用的 m2（划块）第 3 步才讲/);
  assert.match(warnings[1], /第 3 题要用的 m3 不在规则清单里/);
  assert.deepEqual(main.prepCheck, warnings);
  assert.deepEqual(checkPrep({ methods: [{ id: 'm1', steps: 'x' }] }, { items: [] }), ['规则 m1（）没排进讲解顺序（teach 写第几步讲）']);
  const t = lessonPlanText(main);
  assert.match(t.methods, /m2 划块（第 3 步讲）\n  名词连同前面的修饰词/);
  assert.match(t.sequence, /^1\. 一主一谓\n   怎么讲：parse 演示/);
  const pt = packText({ main, problems }).text;
  for (const k of ['【给学生看的路线', '【开头的复现】', '【这节课要用的可执行规则', '【讲解顺序', '【备课检查']) assert.ok(pt.includes(k), k);
  assert.ok(!pt.includes('"teach"'), '规则清单写成文字，不是 JSON');
  const p = prepPrompt({ block, due: '- R19 谓语识别（过期 4 天）', lessons: '- T-1 出题前逐题列出要用的规则' });
  assert.match(p, /到期的复现组/);
  assert.match(p, /T-1 出题前/);
  assert.match(p, /先讲后练/);
});

test('备课：提示词带范围、挂着的原文、全部规则、记忆、能用的组件；读回来只留挂着的条目和认得的组件；下一块按 position 推', () => {
  const block = { id: 'L2.1.4', title: '可交换的情形', scope: '数量矩阵可交换', points: ['(A+B)²'], requires: ['L2.1.3'] };
  const material = [{ id: 'B1-52.1', book: 'B1', kind: '定义', title: '数量矩阵', text: '$kE$ 叫数量矩阵' }];
  const p = prepPrompt({ block, material, books: [{ id: 'B1', title: '线代30讲' }], memoryText: '学生容易把 AB 写成 BA', rulesText: '- ［细则］资料包要放文稿原文', components: ['answer', 'matrix'], subject: '线代' });
  assert.match(p, /## 这节课：L2\.1\.4 可交换的情形/);
  assert.match(p, /### B1-52\.1［定义］数量矩阵/);
  assert.match(p, /资料包要放文稿原文/);
  assert.match(p, /只输出 JSON/);
  assert.ok(!/[他她]/.test(p));
  const { main, problems } = parsePrep('```json\n{"unit":"可交换","goal":"能说清 (A+B)² 为什么不能写成…","plan":"1. 先收 L2-56","chunks":["B1-52.1","B1-99.1"],"components":["matrix","circle"],"problems":[{"q":"算 (A+B)²","answer":"A²+AB+BA+B²","point":"展开"},{"answer":"没题面"}]}\n```', { block, chunkIds: ['B1-52.1'], components: ['answer', 'matrix'] });
  assert.deepEqual(main.chunks, ['B1-52.1']);
  assert.deepEqual(main.components, ['matrix']);
  assert.equal(main.block, 'L2.1.4');
  assert.equal(problems.items.length, 1);
  assert.throws(() => parsePrep('{"unit":"x"}', { block }), /没有目标和讲解顺序/);
  const cur = [{ id: 'L2.1.3', level: 'block' }, { id: 'L2.1.4', level: 'block' }, { id: 'L2.1.5', level: 'block' }];
  assert.equal(suggestBlock(cur, { block: 'L2.1.3', next: '重讲块4' }), 'L2.1.4');
  assert.equal(suggestBlock(cur, { block: 'L2.1.3', next: '接着讲 L2.1.5' }), 'L2.1.5');
  assert.equal(suggestBlock(cur, null), 'L2.1.3');
});

// —— 从 tests/exam-use.test.js ——
test('备课：带考情一节、要一个 examBar；读回只收能用的真题，不能用的报进备课检查；写成给老师的一行', () => {
  const p = prepPrompt({ block: { id: 'OS-L3.2.1', title: '页面置换' }, exam: '## 统计\n- 考了 5 次' });
  assert.match(p, /## 这一块在考试里[\s\S]*考了 5 次/);
  assert.match(p, /"examBar"/);
  const raw = JSON.stringify({ goal: 'g', sequence: [{ step: 1, point: 'p' }], examBar: { id: 'Q-408-2019-26', why: '最典型的 LRU 缺页次数' } });
  const r = parsePrep(raw, { block: { id: 'OS-L3.2.1' }, examIds: new Set(['Q-408-2019-26']) });
  assert.deepEqual(r.main.examBar, { id: 'Q-408-2019-26', why: '最典型的 LRU 缺页次数' });
  assert.match(lessonPlanText(r.main).examBar, /Q-408-2019-26.*最典型/);
  assert.match(packText({ main: r.main }).text, /这节课结束时学生要能做的真题/);
  const bad = parsePrep(JSON.stringify({ goal: 'g', sequence: [{ step: 1, point: 'p' }], examBar: { id: 'Q-408-2025-3', why: 'x' } }), { block: { id: 'OS-L3.2.1' }, examIds: new Set(['Q-408-2019-26']) });
  assert.equal(bad.main.examBar, undefined);
  assert.match(bad.main.prepCheck.join(), /Q-408-2025-3.*不是这一块能用的真题/);
});

// —— 从 tests/memory-autonomy.test.js ——
test('待办：课上记、备课带上、补上了写进教案，课堂看得到', () => {
  const { mem } = write(sampleMemory(TODAY), 'todo text="学生问了相似对角化的几何意义"');
  const todo = mem.observations.find((o) => o.kind === 'todo');
  assert.equal(todo.status, 'open');
  assert.deepEqual(hard(mem), []);
  const open = openTodos(mem, 'math');
  assert.equal(open.length, 1);
  assert.equal(openTodos(mem, 'math', [todo.id]).length, 0);
  assert.equal(openTodos(mem, 'en').length, 0);
  const prompt = prepPrompt({ block: { id: 'L2.2.2', title: 'x' }, todos: open });
  assert.ok(prompt.includes(todo.id) && prompt.includes('"todos"'));
  const raw = JSON.stringify({ goal: 'g', sequence: [{ step: 1, point: 'p' }], todos: [todo.id, 'ob-nope'] });
  const { main } = parsePrep(raw, { block: { id: 'L2.2.2' }, todos: open });
  assert.deepEqual(main.todos, [{ id: todo.id, text: '学生问了相似对角化的几何意义' }]);
  assert.match(lessonPlanText(main).todos, /相似对角化/);
});

// —— 从 tests/memory-base-review.test.js ——
test('备课提示词：有摘要时不再规定课的形式；没有摘要逐字照旧', () => {
  const args = { block: { id: 'L5-01', title: '特征值' }, subject: '线代', memoryText: '（记忆）', components: ['answer'], due: '- R1 秩' };
  const off = prepPrompt(args);
  assert.match(off, /照着上/);
  assert.match(off, /一步一块板/);
  assert.match(off, /按内容分步，讲透为先/);
  const on = prepPrompt({ ...args, summary: true });
  for (const w of ['照着上', '一步一块板', '先讲后练', '讲透为先', '按学生的规则', '感觉像不像', '三到六行']) assert.ok(!on.includes(w), `有摘要时备课提示词里还有「${w}」`);
  // 底线留着：题目用到的规则出题前要讲过、答案先自己算
  assert.match(on, /题目要用的规则[\s\S]{0,40}讲过/);
  assert.match(on, /答案自己先算一遍/);
  // JSON 的字段不变（页面照它读回、核依赖）
  for (const k of ['"unit"', '"goal"', '"route"', '"review"', '"methods"', '"sequence"', '"problems"', '"needs"', '"after"']) assert.ok(on.includes(k), k);
});

