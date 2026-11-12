// 舞台上的课发给老师的说明（kit/src/stage/doc.js）：说明里的例子照抄就能演；不用「他」「她」；每一轮的那条写清楚学生做了什么、舞台现在什么样、哪几行没演
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_TEACH, STAGE_DOC, STAGE_COMMON, stageSystem, firstMessage, turnMessage, TOPICS, derivedLines, gridsOf, DERIVED_MAX, stageDoc, SUBJECT_TYPES } from '../kit/src/stage/doc.js';
import { gridText } from '../kit/src/stage/value.js';
import { TYPES, CREATE } from '../kit/src/stage/types/index.js';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { COMMANDS, parseScript } from '../kit/src/stage/script.js';

const bytes = (s) => Buffer.byteLength(s);

test('说明里提到学生不用「他」「她」', () => {
  for (const t of [STAGE_TEACH, STAGE_DOC, ...Object.values(TOPICS).map((x) => x.topic + x.material)]) assert.doesNotMatch(t, /[他她]/);
});

test('说明不长（每一轮都带）：每门课的教法 + 这门课的说明 ≤ 24 KB（说明长短不影响出第一个字的快慢，docs/talk-plan.md 量过；这里防的是写成长篇）', () => {
  // 量的是真发出去的那一份：学习台里每一节都有块，照块的科目带说明（stageDoc(科目)）；全带的那份只给测试照抄例子，不再限长
  const over = Object.keys(SUBJECT_TYPES).map((s) => [s, bytes(STAGE_TEACH + stageDoc(s))]).filter(([, n]) => n > 24 * 1024);
  assert.deepEqual(over.map(([s, n]) => `${s} ${n} 字节`), []);
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
    // 拿掉东西的（remove、clear）、藏起来的（hide）不往下累：后面的写法还要用那一排格子（藏着的学生看不见，open 不了）
    if ((!e.length || !e2.length) && !/^(remove|clear|hide)\b/.test(l)) { try { for (const c of parseScript(l)) if (c.cmd !== 'ask') cum.apply(c); } catch { /* 只在 base 上能演 */ } }
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
  // 样子页的三节都是数据结构：带的是这门课的那一份（真发出去的），不是全带的那份
  assert.ok(m.includes(STAGE_TEACH) && m.includes(stageDoc('数据结构')));
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

test('样子页带科目：三节课都是数据结构，第一轮带树那一节、不带句子那一节；没写科目（自己写的题目）照旧全带', () => {
  for (const [k, t] of Object.entries(TOPICS)) assert.equal(t.subject, '数据结构', k);
  const m = firstMessage(TOPICS.shell);
  // 发出去的那一份压了对齐的空格（主线第三轮）：照压过的样子找
  const sq = (d) => d.replace(/ {3,}/g, '  ');
  assert.ok(m.includes(sq(TYPES.tree.doc)), '带树那一节');
  assert.ok(!m.includes(sq(TYPES.sentence.doc)), '不带句子那一节');
  assert.ok(stageSystem({ topic: 'x', subject: '英语' }).includes(sq(TYPES.sentence.doc)));
  assert.ok(firstMessage({ topic: '自己写的题目' }).includes(STAGE_DOC), '推不出科目：全带');
});

// 第二轮（docs/superpowers/specs/2026-11-08-stage-base-2-design.md）加的写法：每门课真发出去的那一份里都找得到。
// 查的字要别处没有（on= 在 button= 里就有、put 在 input= 里就有、compare / merge / move 这种光秃秃的词查了等于没查）
test('这一轮的新写法都在说明里：共用的每门课都有，树的在数据结构、矩阵的在线代、句子的在英语', () => {
  const doc = (s) => STAGE_TEACH + stageDoc(s);
  const has = (d, w) => (w instanceof RegExp ? w.test(d) : d.includes(w));
  const common = [/^ask pick /m, 'reveal=on', 'unpick', /^keep /m, /^back /m, 'after=', 'after=off', /^@ask\.right /m, 'collect=', /(?<![a-z])on="/, 'call=now',
    'hide=on', /^hide \S+ \/ show /m, '按住再拖', /when="[^"\n]*\|[^"\n]*"/, '最多三层', '做到过；现在不成立',
    // 量那一行带一个话里写 rank 的例子（引号里的 rank、det 也是量，复核时改的）
    /^量：[^\n]*say "[^"\n]*\{rank\(/m];
  const own = {
    数据结构: ['pluck', 'open t delete', /^heights t/m, 'count(', 'height(', 'tray(', /堆[^\n]*layout=compact/],
    线代: ['open AB compare', 'put AB Sum', 'merge X Y', 'collect', 'coef(', 'rhs(', 'from=', 'vars=', 'rank(', 'rankA(', 'free(', 'det(m)', /= _ _/, 'solve=on'],
    英语: ['links=', 'refer s.', 'exact', 'linked', 'Attr/NF', /^tally s/m, 'verbs(', 'left(', 'open s move'],
  };
  const miss = [];
  for (const s of Object.keys(SUBJECT_TYPES)) for (const w of [...common, ...(own[s] || [])]) if (!has(doc(s), w)) miss.push(`${s}：${w}`);
  assert.deepEqual(miss, []);
});

test('每种东西的量在它那一节里都有（写成 名字(…)）', async () => {
  const { rulesOf } = await import('../kit/src/stage/rules.js');
  const miss = [];
  for (const t of Object.values(TYPES)) {
    const ms = Object.keys(rulesOf({ type: t.type })?.measures || {});
    for (const m of ms) if (!new RegExp(`\\b${m}\\(`).test(t.doc || '')) miss.push(`${t.label}：${m}(…)`);
  }
  assert.deepEqual(miss, []);
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
  // 4. expect= 写整样东西或一段，点到里面哪一个都算（第二轮改了意思：以前只认一个部件）
  assert.match(lineOf(C, /expect=/), /写整样东西或一段/);
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
    for (const a of Object.keys(r.gestures)) assert.match(t.doc, new RegExp(`^open \\S+ ${a}\\b[^\\n]*= `, 'm'), `${t.label}的 open … ${a}：写学生怎么动、翻成哪一行（可以只开几个部件：open s.6 refer）`);
    for (const p of Object.keys(r.predicates)) assert.match(t.doc, new RegExp(`^判断式[^\\n]*\\b${p}\\b`, 'm'), `${t.label}的判断式 ${p}`);
  }
  // type= 能写的每一种
  const { ANSWER_TYPES } = await import('../kit/src/stage/answer.js');
  for (const k of ANSWER_TYPES) assert.match(C, new RegExp(`type=[^\\n]*\\b${k}\\b`), `type=${k}`);
});

// 说明文字里（两个空格后面）写的写法和说法，上面那条照抄测试不演：这里一条条演，说的报错真的报、说的样子真的是那样
test('说明文字里写的写法也成立：行内的写法照抄能演、说会报错的真报错、三个样板「学生怎么动 = 翻成哪一行」和页面真交出的一样', async () => {
  const { gestureAct, askFor } = await import('../kit/src/stage/gestures.js');
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
    // 第二轮：说明文字里写的几种写法
    [A, 'goal g1 "x" when="a.1 < a.2 | a.9 < a.10" call=now'], [A, 'goal g1 "x" when="a sorted" on="就这样"'], [A, 'goal g1 "x" when="a.1 < a.2" collect=a n=3'],
    [A, 'ask pick a#1 a#3 a#5 "哪几个？"'], [A, 'ask pick a "哪几格？" expect="a.2-3 a.6" reveal=on'], [A, 'unpick'],
    [`${A}\nopen a`, 'keep a "换过" after=swap'], [`${A}\nopen a\nkeep a "换过" after=swap`, 'keep a "换过" after=off'], [A, 'array R = 1 2 3 hide=on'],
    [M, 'matrix M = 1 2 | 3 / 2 4 | 7\nmatrix P = 1 / 1\nmatrix Q = {coef(M) P - rhs(M)}'],
    [M, 'matrix m0 = 1 2 | 3 / 2 4 | 7\nmatrix m1 = _ _ | _ / _ _ | _ from=m0 vars="x y"'], ['dial l = 1 range=-3..3', 'matrix N = 1 {l - 1} / 0 {2 l}'],
    [M, 'goal g1 "x" when="rank(m) = 1, rankA(m) = 1, free(m) = 1, det(m) = 3"'], [M, 'ask value "秩是几？" answer={rank(m)}'], [M, 'say "自由变量 {free(m)} 个"'], [M, 'say "秩是 {rank(m)}"'],
    [T, 'goal g1 "x" when="count(t) = 4, height(t) = 4, height(t.30) = 2"'], ['tree t = 50 30 tray="20"', 'label n t "还剩 {tray(t)} 个"'], [T, 'unheights t'], ['', 'tree h = 10 layout=compact'],
    [S, 'goal g1 "x" when="verbs(s.1-6) = 1, verbs(s) = 2, left(s) = 3, s exact"'], [S, 'untally s'],
    ['sentence s = "The man who lives next door is a doctor." links="who -> s.1-2"', 'goal g1 "x" when="s linked"'],
  ];
  const bad = [];
  for (const [setup, line] of plays) { const e = dryRun(run(setup), line); if (e.length) bad.push(`${line} → ${e[0].error}`); }
  // 话里的 {rank(m)} 是量（画成现在的数），不是拨数的名字：说明不再写「在话里照原样写出来」
  const { parseRich } = await import('../kit/src/stage/script.js');
  assert.ok(parseRich('秩是 {rank(m)}').some((p) => p.k === 'measure'));
  assert.doesNotMatch(STAGE_COMMON, /照原样写出来/);
  // 说明里说「会报错」「不能写」「写不进去」的
  const fails = [
    [A, 'goal g1 "x" when="a.1 = ago"', /不是舞台上的东西/], [`${T}\nopen t rotate`, '@t.wrong say "x"', /不能预写/],
    [`${M}\ngoal g1 "x" when="m stairs"`, '@g1 stairs m', /阶梯形/], ['sentence s = "The man is a doctor."\nopen s mark', '@s.done say "x"', /key/],
    ['tree t = 50 30 70\nopen t', 'open t rotate', /都是按住再拖/], ['tree t = 50 30 70\nopen t pluck', 'open t delete', /都是点/], ['tree t = 50 30 70 tray="47"\nopen t insert', 'open t place', /都是按住再拖/], [M, 'open m edit wrong=mark', /判不了对错/],
    [M, 'rowop m r2 + k r1', /看不懂/], [P, 'transform p = 1 {k} / 0 1', /2×2 矩阵/],
    [P, 'vec p w = A v', /vec p w = \{A v\}/], [A, 'ask value "?" type=en', /没写 answer=/], [M, 'matrix N = 1 {k / 0 1', /没有收尾/],
    [`${M}\nmatrix N = 1 {k} / 0 1`, 'open N edit', /跟着算的/], [M, 'matrix X = 1 {2 A}', /算出来是矩阵/],
    [`${M}\nmatrix S = {A + B}`, 'open S edit', /跟着算的/], [`${M}\nproduct C = A B`, 'open C rowop', /乘积/],
    ['graph g = A-B:4\ntag g ?\ntag g.A 0', 'relax g.A -> g.B', /不是数/], ['tree t = 50 30', 'tag t.50 "一二三四五六七八九"', /8 个字/],
    [S, 'tag s.7 "一二三四五六七八九"', /8 个字/], [`${A}\nlabel x a.1 "字"`, 'remove x', /舞台上没有/],
    // 第二轮：说明里说「会报错」的
    [A, '@ask.wrong say "x"', /不能预写/], [A, 'ask tap a "x" reveal=on', /reveal= 只用在 ask pick/], [`${M}\nmatrix X = {-2 A}`, 'open X merge undo=on', /撤不了/],
    [`${M}\nmatrix S = {A + B}`, 'keep S "x"', /跟着算的/], [S, 'tally s.3-6 V', /整句|tally s V/],
    [`${A}\ngoal g1 "x" when="a sorted"\n@g1 goal g2 "y" when="a sorted desc"\n@g2 goal g3 "z" when="a.1 = 9"\n@g3 goal g4 "w" when="a.1 = 8"`, '@g4 say "x"', /最多三层/],
    [`${M}\ngoal g1 "x" when="m stairs"\ngoal g2 "y" when="m rref"`, '@g1 goal g2 "z" when="m rank=1"', /撞名/],
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
  // 整张拖：拖去比、放进收集用的、并同类项（跟着算的也能开，学生拨不了它的数）
  const W = (id) => ({ obj: id, whole: true });
  s = run(`${M}\nmatrix AB = {A B}\nmatrix BA = {B A}\nmatrix Sum = collect\nmatrix X = {-2 A}\nmatrix Y = {-A}\nopen AB compare\nopen X merge`);
  said('matrix', gestureAct(s, s.opens.get('AB:compare'), { from: W('AB'), to: W('BA') }).src);
  said('matrix', gestureAct(s, s.opens.get('X:merge'), { from: W('X'), to: W('Y') }).src);
  s.apply(parseScript('close AB compare')[0]);
  s.apply(parseScript('open AB put')[0]);
  said('matrix', gestureAct(s, s.opens.get('AB:put'), { from: W('AB'), to: W('Sum') }).src);
  assert.doesNotMatch(TYPES.matrix.doc, /学生 open 不了|跟着算的学生动不了/);
  assert.equal(TYPES.matrix.doc.match(/学生拨不了，只能 open compare \/ put \/ merge/g)?.length, 2, '格里的 {k}、整张 {A + B} 两行都改');
  s = run(`${S}\nopen s mark`);
  // 成分按钮交的是中文（学生点「主语」）：照那一排里「S」那个按钮交的
  const subj = askFor(s.opens.get('s:mark').gesture, s.objects.get('s'), 'span', {}).choices.find((c) => c.sub === 'S');
  said('sentence', gestureAct(s, s.opens.get('s:mark'), { from: s.parts('s.1')[0], to: s.parts('s.6')[0], role: subj.value }).src);
  s = run('sentence s = "The man who lives next door is a doctor."\nmark s.3-6 RC\nopen s fold');
  said('sentence', gestureAct(s, s.opens.get('s:fold'), { to: s.parts('s.4')[0] }).src);
  // 点小方块展开；同一句上拉、折、挪能一起开（说明里写的按法）
  s = run('sentence s = "The man who lives next door is a doctor."\nfold s.3-6\nopen s fold');
  said('sentence', gestureAct(s, s.opens.get('s:fold'), { from: { pill: s.objects.get('s').folds[0].id } }).src);
  assert.deepEqual(dryRun(run('sentence s = "The man who lives next door is a doctor."\nopen s mark\nopen s fold'), 'open s move'), []);
  s = run('sentence s = "The man who lives next door is a doctor."\nmark s.3-6 RC\nopen s move');
  said('sentence', gestureAct(s, s.opens.get('s:move'), { from: { mark: s.objects.get('s').marks[0].id }, to: { gap: { after: 9 } } }).src);
  said('sentence', gestureAct(s, s.opens.get('s:move'), { from: s.parts('s.7')[0], to: { gap: { after: 0 } } }).src);
  // ✕：学生拉的括号点了收掉
  s = run('sentence s = "The man who lives next door is a doctor."\nopen s mark');
  s.apply(parseScript('mark s.1-6 主语')[0], { by: 'student', open: 'mark' });
  const { closeAct } = await import('../kit/src/stage/gestures.js');
  said('sentence', closeAct(s, s.opens.get('s:mark'), { from: { mark: s.objects.get('s').marks[0].id } }).src);
  // 树：摘叶子、删
  s = run('tree t = 50 30 70 20 40 _ 80\nopen t pluck');
  said('tree', gestureAct(s, s.opens.get('t:pluck'), { from: s.parts('t.20')[0] }).src);
  assert.match(gestureAct(s, s.opens.get('t:pluck'), { from: s.parts('t.30')[0] }).error, /只能摘叶子/);
  assert.match(TYPES.tree.doc, /^open t pluck[^\n]*只能摘叶子/m);
  s = run('tree t = 50 30 70 20 40 _ 80\nopen t delete');
  said('tree', gestureAct(s, s.opens.get('t:delete'), { from: s.parts('t.30')[0] }).src);
  // 说明的例句里 s.3 是 who（指 The man）：从它的钩拉到 man、拉到 The man 那一段，页面交出的两行都写在说明里
  s = run('sentence s = "The man who lives next door is a doctor."\nopen s.3 refer\nmark s.1-2 主语');
  said('sentence', gestureAct(s, s.opens.get('s:refer'), { from: s.parts('s.3')[0], to: s.parts('s.2')[0] }).src);
  assert.equal(gestureAct(s, s.opens.get('s:refer'), { from: s.parts('s.3')[0], to: { mark: s.objects.get('s').marks[0].id } }).src, 'refer s.3 -> s.1-2');
  assert.ok(TYPES.sentence.doc.includes('= refer s.3 -> s.2 / s.1-2 / s（整句）'), '拉到一段、整句的写法也在那一行');
  // 说明里 links= 的例子照抄到例句上能演（指的是 The man）
  assert.deepEqual(dryRun(new Scene(), 'sentence s = "The man who lives next door is a doctor." links="who -> s.1-2; !who -> door=连到了从句里的名词"'), []);
  // 共用里「页面判对错的动作」把句子的 refer 也列上（refer 能写 wrong=）
  assert.match(STAGE_COMMON, /页面判对错的动作（[^）]*句子的 mark refer）/);
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

test('说明里写的两条开法：同一项再开一次是换掉它（照新写的 wrong= / range= / undo=）；预写的行照写的先后排着', () => {
  assert.match(STAGE_COMMON, /同一项再开一次是换掉它：再写一遍 open，照新写的 wrong=、range=、undo= 办/);
  // 第二轮：同一处按法不一样的能一起开（以前「一次开一种」），按法一样的第二项照旧当场报
  assert.match(STAGE_COMMON, /同一处按法不一样的（点、滑、按住再拖）能一起开[^\n]*按法一样的[^\n]*第二项当场报错，先 close 前一项/);
  assert.doesNotMatch(STAGE_COMMON, /一次开一种/);
  assert.doesNotMatch(TYPES.sentence.doc, /一次开一种/, '句子的 fold 能和 mark、move 一起开');
  assert.match(TYPES.tree.doc, /open t place[^\n]*和 insert 一次开一种/, '放托盘和插托盘都是按住托盘拖：照旧一次开一种');
  // 第三次量 B 批：摆不按托盘先后判；同名重造乘积在原处换槽
  assert.match(TYPES.tree.doc, /open t place[^\n]*不管托盘先后：摆完还是二叉排序树就对/);
  assert.match(TYPES.matrix.doc, /product C = A B[^\n]*再写 product C = B A 就在原处换槽翻成 BA/);
  assert.match(STAGE_COMMON, /预写的行照先后演，say 要等读完：换 open、出新 goal 写在 say 前面/);
  const run = (src) => { const s = new Scene(); for (const c of parseScript(src)) s.apply(c); return s; };
  // 再写一遍：不报「一次开一种」，换成新的办法
  let s = run('tree t = 30 20 40 _ _ _ 45 tray="47"\nopen t insert\nopen t rotate wrong=block');
  assert.deepEqual(dryRun(s, 'open t rotate wrong=mark undo=on'), []);
  s.apply(parseScript('open t rotate wrong=mark undo=on')[0]);
  assert.deepEqual(s.opens.get('t:rotate').policy, { wrong: 'mark', call: null, undo: true });
  s = run('matrix B = 1 2 / 3 4\nopen B edit range=-3..3\nopen B edit range=0..5');
  assert.deepEqual([s.opens.get('B:edit').lo, s.opens.get('B:edit').hi], [0, 5]);
  // 预写在 g1 下面照写的先后排着（舞台做到时一行一行照这个先后演）
  s = run('tree t = 30 20 40 _ _ _ 45 tray="47"\nopen t insert\nopen t rotate wrong=block\ngoal g1 "插进去" when="t height=4"\n@g1 open t rotate wrong=mark undo=on\n@g1 goal g2 "转平" when="t avl"\n@g1 say "失衡了。"');
  assert.deepEqual(s.reactions.get('g1'), ['open t rotate wrong=mark undo=on', 'goal g2 "转平" when="t avl"', 'say "失衡了。"']);
});

// —— [跟着变的] 按东西写（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 4 节）——
test('跟着变的按东西写：一张矩阵一半以上的格变了写整张；只变了一格照旧一格一行；太长了后面的只写名字', () => {
  const grids = new Map([['Dd', [['0', '0'], ['0', '0']]]]);
  const derived = [{ id: 'Dd', changed: [{ ref: 'Dd.1,1', from: '2', to: '0' }, { ref: 'Dd.2,2', from: '-2', to: '0' }] }];
  assert.deepEqual(derivedLines(derived, { grids }), ['Dd：(2 0; 0 −2) → (0 0; 0 0)']);
  assert.match(turnMessage({ act: 'x', state: 'y', derived, grids }), /\n- Dd：\(2 0; 0 −2\) → \(0 0; 0 0\)\n/);
  // 没给 grids（旧的调用）照旧一格一行
  assert.deepEqual(derivedLines(derived), ['Dd.1,1 从 2 变成 0', 'Dd.2,2 从 -2 变成 0']);
  // 只变了一格
  assert.deepEqual(derivedLines([{ id: 'Dd', changed: [{ ref: 'Dd.1,1', from: '2', to: '0' }] }], { grids }), ['Dd.1,1 从 2 变成 0']);
  // 30 张 3×3 都变了：整块 ≤ 1.5 KB，多一行尾巴说后面的名字
  const g30 = new Map(), d30 = [];
  for (let i = 1; i <= 30; i++) {
    const id = `M${i}`;
    g30.set(id, [['0', '0', '0'], ['0', '0', '0'], ['0', '0', '0']]);
    d30.push({ id, changed: Array.from({ length: 9 }, (_, k) => ({ ref: `${id}.${Math.floor(k / 3) + 1},${(k % 3) + 1}`, from: String(10 + k), to: '0' })) });
  }
  const out = derivedLines(d30, { grids: g30 });
  assert.equal(DERIVED_MAX, 1536);
  const tail = out.at(-1);
  assert.match(tail, /也跟着变了（现在的数见舞台现在）$/);
  assert.match(tail, /M30/);
  assert.ok(bytes(out.slice(0, -1).map((l) => `- ${l}`).join('\n')) <= 1536, `${bytes(out.slice(0, -1).join('\n'))}`);
  assert.equal(out[0], 'M1：(10 11 12; 13 14 15; 16 17 18) → (0 0 0; 0 0 0; 0 0 0)');
  // 写了的和只写名字的加起来正好 30 张、一张不少
  const named = tail.replace(/ 也跟着变了.*$/, '').split('、');
  assert.equal(out.length - 1 + named.length, 30);
  // 算不出来的那一句不并进名字（「跟着变了」是假话）
  const err = derivedLines([...d30, { id: 'P', changed: [], error: '「{A^-1}」算不出来：A 不可逆' }], { grids: g30 });
  assert.ok(err.includes('P 算不出来：A 不可逆'));
  assert.doesNotMatch(err.at(-1), /、P 也跟着变了|^P 也/);
});

test('gridsOf、gridText：舞台上每张矩阵现在的数；空格子写 _，负号写 −', () => {
  assert.equal(gridsOf({}).size, 0);
  assert.equal(gridText([['1', ''], ['', '-2']]), '(1 _; _ −2)');
  assert.equal(gridText([['2', '0'], ['0', '-2']]), '(2 0; 0 −2)');
  const s = new Scene();
  for (const c of parseScript('matrix A = 1 2 / 3 -4\narray a = 1 2\nmatrix B = 1 _ / _ 2')) s.apply(c);
  const g = gridsOf(s);
  assert.deepEqual([...g.keys()], ['A', 'B']);
  assert.deepEqual(g.get('A'), [['1', '2'], ['3', '-4']]);
  assert.equal(gridText(g.get('B')), '(1 _; _ 2)');
});

// —— 舞台主线第一轮 D1-14：说明没写的两处 ——
test('D1-14：说明写了矩阵最多几行几列；compare 写了整排格子时报错说清楚能比什么', async () => {
  assert.match(stageDoc('线代'), /最多 6 行 8 列/);
  const { Scene, dryRun } = await import('../kit/src/stage/scene.js');
  const { parseScript } = await import('../kit/src/stage/script.js');
  const s = new Scene();
  for (const c of parseScript('array a = 1 2 3\narray b = 1 2 3')) s.apply(c);
  assert.match(dryRun(s, 'compare a b')[0].error, /compare 比的是两个部件（compare a\.3 a\.8）或者两张矩阵（compare A B）.*一排格子不能整排比/);
});

test('主线第三轮 0：拼出来的说明把对齐用的连续空格压成两个（内容一个字不少），引号里的不动；每门课还在上限里', () => {
  for (const s of ['', ...Object.keys(SUBJECT_TYPES)]) {
    const d = stageDoc(s);
    assert.doesNotMatch(d, / {3,}/, `${s || '全带的'}里没有三个以上连着的空格`);
  }
  // 压的只是空格：去掉所有空格以后和没压的一样
  const raw = [STAGE_COMMON, ...Object.values(TYPES).filter((t) => t.doc && t.create.length).map((t) => t.doc)].join('').replace(/ /g, '');
  for (const piece of [STAGE_COMMON, TYPES.matrix.doc, TYPES.tree.doc]) assert.ok(stageDoc().replace(/ /g, '').includes(piece.replace(/ /g, '')));
  assert.ok(raw.length > 0);
  // 源码里引号里没有这样的空格（有的话压了会改掉老师要照抄的字）
  for (const t of [STAGE_COMMON, ...Object.values(TYPES).map((x) => `${x.doc || ''}\n${x.example || ''}`)]) for (const m of t.matchAll(/"[^"\n]*"|「[^」\n]*」/g)) assert.doesNotMatch(m[0], / {3,}/);
});

test('主线第四轮：照引擎走（follow）的说明只按科目带——数据结构有，操作系统没有（只剩 70 字节）；每门课还在上限里', async () => {
  const { STAGE_TEACH } = await import('../kit/src/stage/doc.js');
  const ds = stageDoc('数据结构');
  assert.match(ds, /## 照引擎走/);
  assert.match(ds, /follow a sort shell gaps="5 3 1"/);
  assert.match(ds, /follow g net dijkstra from=1/);
  assert.match(ds, /pass\(a\)/);
  for (const s of ['操作系统', '组成原理', '计网', '线代', '英语']) assert.doesNotMatch(stageDoc(s), /follow/, s);
  assert.match(stageDoc(), /## 照引擎走/); // 全带的那一份也有
  const bytes = (t) => new TextEncoder().encode(t).length;
  for (const s of Object.keys(SUBJECT_TYPES)) assert.ok(bytes(`${STAGE_TEACH}\n\n${stageDoc(s)}`) <= 24576, `${s}：${bytes(`${STAGE_TEACH}\n\n${stageDoc(s)}`)}`);
  // 说明里的例子照抄就能演
  const { Scene } = await import('../kit/src/stage/scene.js');
  const { parseScript } = await import('../kit/src/stage/script.js');
  const sc = new Scene();
  for (const c of parseScript('array a = 49 38 65 97 76 13 27 49\ngraph g = 1>2:10 1>5:5 5>2:3\ntable T = _ _ / _ _ rows="2 5" cols="第1轮 第2轮"\nfollow a sort shell gaps="5 3 1"\nfollow g net dijkstra from=1\nfollow T net dijkstra on=g from=1\nfollow a off')) sc.apply(c);
});

test('主线第五轮腾地方：只有个别科目带的行真认得到；别的科目不带、在「说明没带的」里说了；操作系统的矩阵只带摆数的那一段', async () => {
  const { ONLY_LINES, stageDoc } = await import('../kit/src/stage/doc.js');
  const lines = STAGE_COMMON.split('\n');
  for (const x of ONLY_LINES) assert.ok(lines.some((l) => x.test(l)), `共用那一段里找不到「${x.name}」的行（改了措辞？）`);
  const en = stageDoc('英语'), ds = stageDoc('数据结构'), la = stageDoc('线代'), os = stageDoc('操作系统');
  assert.match(en, /^dial t = 现在 options=/m);
  assert.doesNotMatch(ds, /^dial t = 现在 options=/m);
  assert.match(ds, /说明没带的：[^\n]*拨词的拨盘和 \{t: 甲 \| 乙\}/);
  assert.match(la, /^when= 两边、collect= 能直接写/m);
  assert.doesNotMatch(os, /^when= 两边、collect= 能直接写/m);
  assert.match(os, /^matrix m = /m);
  assert.doesNotMatch(os, /open m rowop/);
  assert.match(os, /说明没带的：[^\n]*矩阵的 open（rowop \/ edit：要学生填数用表）/);
  assert.match(la, /open m rowop/);
  // 全带的那一份一行不少
  for (const x of ONLY_LINES) assert.ok(stageDoc('').split('\n').some((l) => x.test(l)));
});

test('引擎的过程表：每门课说明里列的每一个引擎，照例子的字段真造得出舞台的表；写法那一行照抄能演；每门课都不超', async () => {
  const { ENGINE_TABLES, stageDoc } = await import('../kit/src/stage/doc.js');
  const { engineTable } = await import('../kit/src/stage/enginetable.js');
  const { Scene, dryRun } = await import('../kit/src/stage/scene.js');
  const { parseScript } = await import('../kit/src/stage/script.js');
  for (const [subject, list] of Object.entries(ENGINE_TABLES)) {
    assert.ok(list.length >= 3 && list.length <= 12, subject);
    for (const eg of list) {
      const c = parseScript(`table T engine=${eg}`)[0];
      const { engine, ...fields } = c.opts;
      assert.doesNotThrow(() => engineTable(engine, fields), `${subject}：${eg}`);
    }
    const doc = stageDoc(subject);
    assert.match(doc, /引擎的过程表/);
    const line = doc.split('\n').find((l) => /^table T engine=/.test(l));
    assert.ok(line, `${subject} 的说明里有一行照抄能演的例子`);
    assert.deepEqual(dryRun(new Scene(), line.split('  ')[0]), []);
    // 别的引擎写成 名字(字段…)
    for (const eg of list.slice(1)) assert.ok(doc.includes(`${eg.split(' ')[0]}(`), `${subject}：${eg.split(' ')[0]}`);
    assert.ok(Buffer.byteLength(STAGE_TEACH + doc) <= 24576, `${subject} 超了：${Buffer.byteLength(STAGE_TEACH + doc)}`);
  }
  assert.doesNotMatch(stageDoc('英语'), /引擎的过程表/);
  assert.doesNotMatch(stageDoc('线代'), /引擎的过程表/);
});
