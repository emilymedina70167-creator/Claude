// 舞台上的课发给老师的说明（kit/src/stage/doc.js）：说明里的例子照抄就能演；不用「他」「她」；每一轮的那条写清楚学生做了什么、舞台现在什么样、哪几行没演
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_TEACH, STAGE_DOC, STAGE_COMMON, stageSystem, firstMessage, turnMessage, TOPICS } from '../kit/src/stage/doc.js';
import { TYPES, CREATE } from '../kit/src/stage/types/index.js';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { COMMANDS, parseScript } from '../kit/src/stage/script.js';

const bytes = (s) => Buffer.byteLength(s);

test('说明里提到学生不用「他」「她」', () => {
  for (const t of [STAGE_TEACH, STAGE_DOC, ...Object.values(TOPICS).map((x) => x.topic + x.material)]) assert.doesNotMatch(t, /[他她]/);
});

test('说明不长（每一轮都带）：教法 + 指令 ≤ 24 KB（说明长短不影响出第一个字的快慢，docs/talk-plan.md 量过；这里防的是写成长篇）', () => {
  assert.ok(bytes(STAGE_TEACH + STAGE_DOC) <= 24 * 1024, `现在 ${bytes(STAGE_TEACH + STAGE_DOC)} 字节`);
});

test('说明里的例子照抄就能演：例子那一轮；共用的每一条写法；每一种东西那一节的每一条写法', () => {
  const ex = STAGE_DOC.split('例子（一轮）：\n')[1];
  assert.deepEqual(dryRun(new Scene(), ex), []);
  // 一条说明的第一段（「 / 」前、两个空格前）都能演
  // 引号外面的第一个「两个以上空格」或「 / 」之前是写法，后面是说明
  const head = (l) => { let q = null; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === q) q = null; continue; } if (ch === '"') { q = '"'; continue; } if (ch === '「') { q = '」'; continue; } if (l.startsWith('  ', i) || l.startsWith(' / ', i)) return l.slice(0, i).trim(); } return l.trim(); };
  // 造东西的那一行（matrix m = 1 2 / 3 4）里的「 / 」是分行，不是另一种写法：只按两个空格切
  // @g1 / @t.done 开头的预写也照抄能演（在前面先写了 goal、open 的舞台上）：看 @ 后面那一行的指令
  const cmdOf = (l) => (l.startsWith('@') ? l.split(' ')[1] : l.split(' ')[0]);
  const firsts = (doc) => doc.split('\n').map((l) => (CREATE[l.split(' ')[0]] ? l.split(/\s{2,}/)[0].trim() : head(l))).filter((l) => COMMANDS.has(cmdOf(l)));
  const ready = (src) => { const sc = new Scene(); for (const c of parseScript(src)) if (c.cmd !== 'ask') sc.apply(c); return sc; };
  const bad = [];
  // 共用的：在一排格子上演（先造好拨数、贴好字、说一句带 [词] 的话）
  const base = ready('array a = 49 38 65 97 76 13 27 49′ 55 04\ndial d = 5 range=1-5 at=a\nlabel t a.1 "字"\nsay "看 [不稳定]"');
  // 要前面先做的（先 open 再 close、先 goal 再 @g1）：在照说明先后一条接一条演下来的舞台上也试一次
  const cum = base.clone();
  for (const l of firsts(STAGE_COMMON)) {
    const e = dryRun(base, l);
    const e2 = e.length ? dryRun(cum, l) : [];
    if (e.length && e2.length) bad.push(`${l} → ${e[0].error}`);
    // 拿掉东西的（remove、clear）不往下累：后面的写法还要用那一排格子
    if ((!e.length || !e2.length) && !/^(remove|clear)\b/.test(l)) { try { for (const c of parseScript(l)) if (c.cmd !== 'ask') cum.apply(c); } catch { /* 只在 base 上能演 */ } }
  }
  // 每一种东西：在它自己的例子演完的舞台上演（造它的那一行另外再演一遍也行）
  let n = 0;
  for (const t of Object.values(TYPES)) {
    if (!t.doc) continue;
    assert.ok(t.example, `${t.label}要有能照抄的例子`);
    assert.deepEqual(dryRun(new Scene(), t.example), [], `${t.label}的例子`);
    // 只演例子的第一行（造出来）：后面的写法各自在刚造好的东西上演，互不干扰（比如插过 35 再插一次就该报错）
    const sc = ready(`${t.example.split('\n')[0]}\ndial d = 5 range=1-5`);
    // 每一条在刚造好的东西上演；要前面先做的（先 tag 距离再 relax），在照说明先后一条接一条演下来的舞台上演，两种有一种能演就行
    const fresh = sc.clone();
    // 第三种：整个例子演完的舞台（要好几样东西的写法：两个矩阵相乘、两个向量相加）
    const full = ready(`${t.example}\ndial d = 5 range=1-5\ndial k = 2 range=-3..3`);
    // 第四种：那种东西给测试备的舞台（例子里没有、说明里要的，比如已经是阶梯形的矩阵）
    const more = t.docSetup ? ready(t.docSetup) : null;
    for (const l of firsts(t.doc)) {
      n++;
      const e = dryRun(fresh, l);
      const e2 = e.length ? dryRun(sc, l) : [];
      const e3 = e.length && e2.length ? dryRun(full, l) : [];
      const e4 = e.length && e2.length && e3.length && more ? dryRun(more, l) : [];
      if (e.length && e2.length && e3.length && (!more || e4.length)) bad.push(`${t.label}：${l} → ${e[0].error}`);
      if (!e2.length || !e.length) { try { for (const c of parseScript(l)) if (c.cmd !== 'ask') sc.apply(c); } catch { /* 这一条只在刚造好的上能演 */ } }
    }
  }
  // 上面只演第一个词认得的行：拼错的（rowopp m …、@t.done sayy …）会被当成说明文字跳过。看着像指令的行，指令都要认得
  const looks = /^(@[\w.]+\s+)?([a-z]+)(\s|$)/;
  const sections = [['共用', STAGE_COMMON], ...Object.values(TYPES).flatMap((t) => [[t.label, t.doc || ''], [`${t.label}的例子`, t.example || '']])];
  for (const [name, doc] of sections) for (const l of doc.split('\n')) { const m = l.match(looks); if (m && !COMMANDS.has(m[2]) && !CREATE[m[2]]) bad.push(`${name}：「${l.slice(0, 40)}」看着像指令，却不认得「${m[2]}」`); }
  assert.deepEqual(bad, []);
  assert.ok(n >= 10, `各种东西的说明里一共 ${n} 条写法`);
});

test('第一轮：教法、指令、这节课、资料都在；舞台是空的、要以 ask 结尾', () => {
  const m = firstMessage(TOPICS.bsearch);
  assert.ok(m.includes(STAGE_TEACH) && m.includes(STAGE_DOC));
  assert.match(m, /## 这节课\n数据结构 · 折半查找/);
  assert.match(m, /## 资料/);
  assert.match(m, /舞台现在是空的/);
  assert.doesNotMatch(stageSystem({ topic: 'x' }), /## 资料/);
});

test('每一轮：学生做了什么、上一轮没演的行（第几行、原文、为什么）、舞台现在', () => {
  const m = turnMessage({ act: '学生点了 a.4（97）', state: '一排格子 a', errors: [{ line: 3, src: 'swap a.1', error: 'swap 要正好两格' }] });
  assert.match(m, /^\[学生\]\n学生点了 a\.4（97）/);
  assert.match(m, /第 3 行「swap a\.1」：swap 要正好两格/);
  assert.match(m, /\[舞台现在\]\n一排格子 a/);
  assert.match(m, /写下一轮。$/);
  assert.doesNotMatch(turnMessage({ act: 'x', state: 'y' }), /没演的行/);
});

test('按科目只带用得上的东西：英语课不带一排格子（只列名字），例子换成那门课的', async () => {
  const { stageDoc } = await import('../kit/src/stage/doc.js');
  const en = stageDoc('英语');
  assert.doesNotMatch(en, /array a = 49/);
  assert.match(en, /说明没带的：一排格子（array）/);
  assert.match(stageDoc('数据结构'), /array a = 49/);
  assert.match(stageDoc(''), /array a = 49/);
});


// 缺口单「说明写得不清楚」那一节（docs/stage-gaps.md）：助手照说明写错过、要试好几次才对的 10 条，说明里逐条写明
test('说明不清楚的 10 条都写明了', () => {
  const C = STAGE_COMMON;
  const lineOf = (doc, re) => doc.split('\n').find((l) => re.test(l)) || '';
  // 1. ask value 不一定要写 answer=（只收不判）
  assert.match(lineOf(C, /^ask value /), /answer= 可以不写/);
  // 2. tag 最多 8 个字（树、图、句子都有 tag）
  for (const k of ['tree', 'graph', 'sentence']) assert.match(lineOf(TYPES[k].doc, /^tag /), /最多 8 个字/, `${TYPES[k].label}的 tag`);
  // 3. goal 的 when= 能写什么：部件比部件、每种东西的判断式
  assert.match(lineOf(C, /^when= /), /部件比部件[^\n]*判断式/);
  // 4. expect= 只能写一个部件
  assert.match(lineOf(C, /expect=/), /只写一个部件/);
  // 5. 拨数能驱动的是写成 {式子} 的值
  assert.match(lineOf(C, /^dial /), /能写进 \{式子\} 里驱动任何量/);
  // 6. retex 换掉最后一行、next 留着上一行
  assert.match(lineOf(TYPES.tex.doc, /^retex /), /换掉[^\n]*next/);
  assert.match(lineOf(TYPES.tex.doc, /^next /), /留着/);
  // 7. 预写的行写下那一刻就在今天的舞台上试
  assert.match(C, /写下时就在今天的舞台上试一遍/);
  // 8. 题卡里的 $x$ 只是斜体字母，矩阵写不了
  assert.match(lineOf(TYPES.card.doc, /\$x\$/), /矩阵[^\n]*写不了/);
  // 9. 句子留空位现在没有写法（第 3 个子项目）
  assert.match(TYPES.sentence.doc, /留空位[^\n]*现在没有/);
  // 10. relax 前先 tag g ∞；贴的字跟着部件消失，拿掉字用 unlabel
  assert.match(lineOf(TYPES.graph.doc, /^relax /), /tag g ∞/);
  assert.match(lineOf(C, /字跟着消失/), /unlabel/);
});

test('底座的新写法都在说明里：open 的 wrong= / call= / undo=、预写 @名字.done / .right、{式子}、type=；三个样板各列出手势表和判断式', async () => {
  const C = STAGE_COMMON;
  for (const w of ['wrong=quiet', 'wrong=mark', 'wrong=block', 'call=wrong', 'call=done', 'undo=on', '@t.done', '@t.right', '走偏不能预写', '{式子}', 'type=', 'input=keypad']) assert.ok((C + STAGE_TEACH + STAGE_DOC).includes(w), `说明里要有「${w}」`);
  for (const k of ['matrix', 'plane', 'graph']) assert.match(TYPES[k].doc, /\{[^{}\s]+( [^{}]+)?\}/, `${TYPES[k].label}那一节要有 {式子} 的写法`);
  // 页面不做教学决定：默认照做、只记下
  assert.match(C, /wrong=quiet[^\n]*默认/);
  // 每种交了规则的东西：手势表里的每个动作都有一行 open（学生怎么动、翻成哪一行），每个判断式都写了
  const { rulesOf } = await import('../kit/src/stage/rules.js');
  for (const t of Object.values(TYPES)) {
    const r = rulesOf({ type: t.type });
    if (!r || !t.doc) continue;
    for (const a of Object.keys(r.gestures)) assert.match(t.doc, new RegExp(`^open \\w+ ${a}\\b[^\\n]*= `, 'm'), `${t.label}的 open … ${a}：写学生怎么动、翻成哪一行`);
    for (const p of Object.keys(r.predicates)) assert.match(t.doc, new RegExp(`^判断式[^\\n]*\\b${p}\\b`, 'm'), `${t.label}的判断式 ${p}`);
  }
  // type= 能写的每一种
  const { ANSWER_TYPES } = await import('../kit/src/stage/answer.js');
  for (const k of ANSWER_TYPES) assert.match(C, new RegExp(`type=[^\\n]*\\b${k}\\b`), `type=${k}`);
});

// 说明文字里（两个空格后面）写的写法和说法，上面那条照抄测试不演：这里一条条演，说的报错真的报、说的样子真的是那样
test('说明文字里写的写法也成立：行内的写法照抄能演、说会报错的真报错、三个样板「学生怎么动 = 翻成哪一行」和页面真交出的一样', async () => {
  const { gestureAct } = await import('../kit/src/stage/gestures.js');
  const run = (src) => { const s = new Scene(); for (const c of parseScript(src)) s.apply(c); return s; };
  const A = 'array a = 49 38 65 97 76 13 27 49′ 55 04\ndial d = 5 range=1-5 at=a';
  const M = 'matrix A = 1 1 / -1 -1\nmatrix B = 1 -1 / -1 1 beside=A\ndial k = 2 range=-3..3\nmatrix m = 2 4 / 1 3';
  const S = 'sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] a doctor."';
  const T = 'tree t = 50 30 _ 20';
  const P = 'plane p range=-4..4\nmatrix A = 1 1 / 0 1 beside=p\nvec p v = 1 2\ndial k = 1 range=-3..3';
  const plays = [
    [P, 'vec p w = {A v}'], [P, 'vec p w = {A v + v}'], [M, 'ask value "A + B？" type=matrix answer={A + B}'], ['dial k = 2 range=1..5', 'graph g = A-B:{k + 1} B-C:4'],
    [`${A}\nopen a`, 'close a drag'], [A, 'open a undo=on'], [`${A}\nmatrix A = 1 2 / 3 4`, 'matrix S = {d A}'], [A, 'array b = {d} 3 5'],
    [A, 'goal g1 "x" when="a.1 < a#6"'], [A, 'goal g1 "x" when="a sorted desc"'], [A, 'goal g1 "x" when="a.1 < d"'], [M, 'goal g1 "x" when="B = O, A != I"'],
    [`${T}\nopen t rotate`, '@t.right say "对。"'], [T, 'open t rotate wrong=block call=done'],
    [M, 'ask value "A + B？" type=matrix answer="{A + B}"'], [A, 'ask value "?" answer=4 wrong="3=漏了 E; 0=当成数 0"'], [A, 'ask value "你怎么想？"'],
    [A, 'ask value "?" type=formula answer=n free=n'], [A, 'ask value "?" type=set answer="(1, 3]"'], [A, 'ask value "?" type=equation answer="x + y = 1"'],
    [A, 'ask value "?" type=seq answer="1 2 3"'], [A, 'ask value "?" type=en answer="has been"'],
    [M, 'matrix N = 1 {A.1,2} / 0 1'], ['matrix A = 1 2 / 3 4\nmatrix B = 0 1 / 1 0', "matrix P = {A B}\nmatrix U = {2A}\nmatrix V = {A^-1}\nmatrix W = {A'}\narray x = {det(A)} 1"],
    ['dial k = 2 range=1..5', 'graph g = A-B:{k} B-C:4'], ['graph g = A-B:4\ntag g ∞\ntag g.A 0', 'relax g.A -> g.B'],
    [`${A}\nlabel x a.1 "字"`, 'unlabel x'], [T, 'goal g1 "x" when="t avl, t height=2"'],
    [M, 'goal g1 "x" when="m stairs, m rref, m rank=2, m rankA=2, m same A"'], [S, 'goal g1 "x" when="s parsed, s main, s span s.1-6 = S"'], [S, 'mark s.3-6 从句'],
  ];
  const bad = [];
  for (const [setup, line] of plays) { const e = dryRun(run(setup), line); if (e.length) bad.push(`${line} → ${e[0].error}`); }
  // 说明里说「会报错」「不能写」「写不进去」的
  const fails = [
    [A, 'goal g1 "x" when="a.1 = ago"', /不是舞台上的东西/], [`${T}\nopen t rotate`, '@t.wrong say "x"', /不能预写/],
    [`${M}\ngoal g1 "x" when="m stairs"`, '@g1 stairs m', /阶梯形/], ['sentence s = "The man is a doctor."\nopen s mark', '@s.done say "x"', /key/],
    ['tree t = 50 30 70\nopen t', 'open t rotate', /一次开一种/], [M, 'open m edit wrong=mark', /判不了对错/],
    [M, 'rowop m r2 + k r1', /看不懂/], [P, 'transform p = 1 {k} / 0 1', /2×2 矩阵/],
    [P, 'vec p w = A v', /vec p w = \{A v\}/], [A, 'ask value "?" type=en', /没写 answer=/], [M, 'matrix N = 1 {k / 0 1', /没有收尾/],
    [`${M}\nmatrix N = 1 {k} / 0 1`, 'open N edit', /跟着算的/], [M, 'matrix N = 1 {det(A)} / 0 1', /只能写拨数/],
    [`${M}\nmatrix S = {A + B}`, 'open S edit', /跟着算的/], [`${M}\nproduct C = A B`, 'open C rowop', /乘积/],
    ['graph g = A-B:4\ntag g ?\ntag g.A 0', 'relax g.A -> g.B', /不是数/], ['tree t = 50 30', 'tag t.50 "一二三四五六七八九"', /8 个字/],
    [S, 'tag s.7 "一二三四五六七八九"', /8 个字/], [`${A}\nlabel x a.1 "字"`, 'remove x', /舞台上没有/],
  ];
  for (const [setup, line, re] of fails) { const e = dryRun(run(setup), line); if (!e.length || !re.test(e[0].error)) bad.push(`${line} 应当报错（${re}），实际：${e[0]?.error || '照演了'}`); }
  assert.deepEqual(bad, []);
  // 三个样板：学生动一下，页面交出的那一行就是说明里「= 」后面写的
  const said = (t, src) => assert.ok(TYPES[t].doc.includes(src), `${TYPES[t].label}的说明里要写「${src}」（页面真交出的）`);
  let s = run('tree t = 50 30 _ 20 tray="47"\nopen t rotate\nopen t insert');
  said('tree', gestureAct(s, s.opens.get('t:rotate'), { from: s.parts('t.30')[0], to: s.parts('t.50')[0] }).src);
  said('tree', gestureAct(s, s.opens.get('t:insert'), { value: '47' }).src);
  s = run('tree t = 50 30 tray="47"\nopen t place');
  said('tree', gestureAct(s, s.opens.get('t:place'), { value: '47', to: { slot: { parent: 2, side: 'right' } } }).src);
  s = run('matrix m = 2 4 1 / 6 3 0\nopen m rowop\nopen m edit input=keypad');
  said('matrix', gestureAct(s, s.opens.get('m:rowop'), { from: { row: 1 }, to: { row: 2 }, value: '-3' }).src);
  said('matrix', gestureAct(s, s.opens.get('m:rowop'), { from: { row: 1 }, to: { label: 2 } }).src);
  said('matrix', gestureAct(s, s.opens.get('m:rowop'), { from: { label: 1 }, value: '−1/2' }).src);
  said('matrix', gestureAct(s, s.opens.get('m:edit'), { to: { r: 2, c: 3 }, value: '-3/2' }).src);
  s = run(`${S}\nopen s mark`);
  said('sentence', gestureAct(s, s.opens.get('s:mark'), { from: s.parts('s.1')[0], to: s.parts('s.6')[0], role: 'S' }).src);
  s = run('sentence s = "The man who lives next door is a doctor."\nmark s.3-6 RC\nopen s fold');
  said('sentence', gestureAct(s, s.opens.get('s:fold'), { to: s.parts('s.4')[0] }).src);
  // 说法：默认 wrong=quiet 照做只记下；乘 0、没有孩子能转上来永远不演；@t.right 只演一次；贴的部件没了字跟着消失
  s = run(`${T}\nopen t rotate\n@t.right say "对。"`);
  const quiet = s.apply(parseScript('rotate t.30 right')[0], { by: 'student', open: 'rotate' });
  assert.ok(!quiet.blocked && quiet.judged.verdict.right === false && !quiet.judged.mark, '默认照做、只记下');
  s = run(`${T}\nopen t rotate\n@t.right say "对。"`);
  assert.equal(s.apply(parseScript('rotate t.50 right')[0], { by: 'student', open: 'rotate' }).reactions.length, 1);
  assert.equal(s.reactions.get('t.right'), undefined, '@t.right 只演一次');
  assert.equal(run('matrix m = 2 4 / 6 3\nopen m rowop').judgeLine(parseScript('rowop m 0r1')[0], { by: 'student', open: 'rowop' }).apply, false);
  assert.equal(run('tree t = 50 30\nopen t rotate').judgeLine(parseScript('rotate t.30 right')[0], { by: 'student', open: 'rotate' }).verdict.legal, false);
  assert.equal(run('array a = 1 2 3\nlabel x a.1 "字"\nremove a').labels.size, 0);
  assert.equal(run('tree t = 50 30 70\nlabel x t.30 "字"\ndelete t.30').labels.size, 0);
});
