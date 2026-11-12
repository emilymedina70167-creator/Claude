// 主线第五轮收尾的只读审查查出来的：一条一个测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { wrongCells } from '../kit/src/stage/types/table.js';

const run = (s, src, opt) => { let fx; for (const c of parseScript(src)) fx = s.apply(c, opt); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const stu = (s, src, open = 'edit') => s.apply(parseScript(src)[0], { by: 'student', open });

test('一组先后不论的格：只有对不上的那一格算不一样，不按位置说答案（以前一格错、三格都报错）', () => {
  const s = make('table T engine=paging algo=fifo frames=3 refs="7 0 1 2 0 3 0 4"\nopen T edit');
  const T = () => s.objects.get('T');
  // 第 3 列该是 {7,0,1}：学生写 2 7 0
  stu(s, 'write T.1,3 2'); stu(s, 'write T.2,3 7');
  const fx = stu(s, 'write T.3,3 0');
  const bad = wrongCells(T()).filter((x) => x.c === 3);
  assert.deepEqual(bad.map((x) => `${x.r},${x.c}`), ['1,3']);
  const t = s.stateText();
  assert.match(t, /写了 2，这一组该是 7 0 1，先后不论/);
  assert.doesNotMatch(t, /写了 7，答案是 0|写了 0，答案是 1/);
  assert.doesNotMatch(JSON.stringify(fx), /答案是 1/);
  // 换个先后全写对：一格都不算不一样
  stu(s, 'write T.1,3 1');
  assert.equal(wrongCells(T()).filter((x) => x.c === 3).length, 0);
});

test('{verb: be able to …}：be 后面带词也照 be 变（以前 They be able to / does not be able to）', async () => {
  const { conjugate } = await import('../kit/src/stage/verbs.js');
  assert.equal(conjugate('be able to', { subject: '复' }), 'are able to');
  assert.equal(conjugate('be able to', { time: '过去', subject: '复' }), 'were able to');
  assert.equal(conjugate('be able to', { negative: true }), 'is not able to');
  assert.equal(conjugate('be able to', { aspect: '完成' }), 'has been able to');
  assert.equal(conjugate('be going to', { time: '过去', subject: 'I', negative: true }), 'was not going to');
});

test('动词的规则变化不乱猜前缀：render / reckon 不双写、relay 不照 lay 变、offset / beset 照词根双写、quiz / radio 的第三人称', async () => {
  const { formsOf } = await import('../kit/src/stage/verbs.js');
  const f = (w) => { const x = formsOf(w); return `${x.s} ${x.ing} ${x.past}`; };
  assert.equal(f('render'), 'renders rendering rendered');
  assert.equal(f('reckon'), 'reckons reckoning reckoned');
  assert.equal(f('relay'), 'relays relaying relayed');
  assert.equal(f('offset'), 'offsets offsetting offset');
  assert.equal(f('beset'), 'besets besetting beset');
  assert.equal(f('visit'), 'visits visiting visited');
  assert.equal(f('reset'), 'resets resetting reset');
  assert.equal(f('unplug'), 'unplugs unplugging unplugged');
  assert.equal(f('quiz'), 'quizzes quizzing quizzed');
  assert.equal(f('radio'), 'radios radioing radioed');
  assert.equal(f('broadcast'), 'broadcasts broadcasting broadcast');
});

test('{verb: …} 的第一格写了不是原形的（went、is）：当场报、说原形是什么（以前拼出 wented）；另有其词的（found）不报', () => {
  assert.throws(() => make('sentence s = "He {verb: went | 过去}."'), /「went」是 go 的变化形式.*写原形 go/);
  assert.throws(() => make('sentence s = "He {verb: is | 过去}."'), /写原形 be/);
  make('sentence s = "They {verb: found | 过去} a school."');
  make('sentence s = "He {verb: went/wented/wented | 过去}."'); // 老师自己给了三种形式：不查
});

test('话、贴的字、标准答案里的 {verb: …}：现状里也写拼成了什么，照规则变的标出来（以前只有句子里的写）', () => {
  const s = make('array a = 1 2\nsay "昨天：{verb: proofread | 过去}"\nlabel L1 a.1 "{verb: proofread | 过去}"');
  const t = s.stateText();
  assert.match(t, /页面拼的谓语：\n  话里：proofread，过去 × 一般，主语单数 → proofreaded（照规则变）/);
  // 同一个谓语在贴的字里又用了一次：不重复写
  assert.equal((t.match(/→ proofreaded/g) || []).length, 1);
  const s1 = make('ask value "过去式？" answer="{verb: proofread | 过去}" type=en');
  assert.match(s1.stateText(), /标准答案里：proofread，过去 × 一般，主语单数 → proofreaded（照规则变）/);
  const s2 = make('ask value "写出谓语" answer="{verb: go on | 现在 | 完成进行}" type=en');
  assert.match(s2.stateText(), /标准答案里：go on，现在 × 完成进行，主语单数 → has been going on/);
});

test('认错法：几种都对得上就都列出来；舞台上的一整行也比；一组先后不论的照集合比', () => {
  const after = (fx) => (fx.judged?.after || []).join('\n');
  // KMP 的表一步一列：j = 3 这一列写 1 1，PM 和「nextval 照抄 next」都对得上——都列
  let s = make('table T engine=kmp pattern=abaabc show=nextval\nopen T edit');
  stu(s, 'write T.2,3 1');
  assert.match(after(stu(s, 'write T.3,3 1')), /j = 3这一列像是：.*部分匹配值 PM.*，或者.*照抄了 next/);
  // 学生把 next 那一整行照 PM 填（0 0 1 1 2 0）：以前只按列比，认不出
  s = make('table T engine=kmp pattern=abaabc show=nextval\nopen T edit');
  let fx;
  '0 0 1 1 2 0'.split(' ').forEach((v, i) => { fx = stu(s, `write T.2,${i + 1} ${v}`); });
  assert.match(after(fx), /next\[j\]这一行像是：.*部分匹配值 PM/);
  // 页面置换：第 6 次访问照 LRU 换（该是 {2,0,3}），块的先后和引擎不一样（3 2 0）也认得出
  s = make('table P engine=paging algo=fifo frames=3 refs="7 0 1 2 0 3 0 4"\nopen P edit');
  stu(s, 'write P.1,6 3'); stu(s, 'write P.2,6 2'); stu(s, 'write P.3,6 0'); stu(s, 'write P.4,6 √');
  assert.match(after(stu(s, 'write P.5,6 1')), /像是：按 最近最久未使用 LRU 换的/);
});

test('引擎的表：报错里的字段写成舞台的写法（frames=）；黑板外壳的字段（title= q=）当场报；关键字 01 写 1 也对', () => {
  assert.throws(() => make('table P engine=paging algo=fifo frame=3 refs="7 0 1"'), (e) => !/[a-z]+[:：]/.test(e.message) && /frames=/.test(e.message));
  assert.throws(() => make('table P engine=paging algo=fifo frames=3 refs="7 0 1" title="页面置换"'), /「title=」是黑板组件的字段，舞台的表上不起作用/);
  const s = make('table H engine=hash hash="19 01 23 14" p=13\nopen H edit');
  const H = s.objects.get('H');
  const x = H.cells.find((c) => !c.fixed && H.key[c.r - 1][c.c - 1] === '01');
  assert.ok(x, '有一格的答案是 01');
  const fx = stu(s, `write H.${x.r},${x.c} 1`);
  assert.match(fx.judged.verdict.why, /和答案一样/);
});

test('引擎的表里的小数格：分数和两位小数都算对，一位小数不算（计划的 Review Focus 第 3 条，以前没有用例）', async () => {
  const { cellRight } = await import('../kit/src/stage/types/table.js');
  const s = make('table S engine=sched algo="rr q=2" procs="P1 0 5, P2 2 4, P3 4 1"\nopen S edit');
  const S = s.objects.get('S');
  // 找一格答案是分数或小数的
  const x = S.cells.find((c) => !c.fixed && /[./]/.test(S.key[c.r - 1][c.c - 1] || ''));
  const extra = s.stateText();
  if (x) {
    const ans = S.key[x.r - 1][x.c - 1];
    const val = ans.includes('/') ? Number(ans.split('/')[0]) / Number(ans.split('/')[1]) : Number(ans);
    assert.equal(cellRight(S, x, ans), true);
    assert.equal(cellRight(S, x, val.toFixed(2)), true);
    assert.equal(cellRight(S, x, String(Math.round(val * 10) / 10 + 0.3)), false);
  } else {
    // 这张表里没有小数格：平均周转时间在表外的答案里（只写给老师）
    assert.match(extra, /表外的答案（学生看不到）/);
  }
});
