// 检验 408：trace 手推（计划 4 Task 4；kit/src/check/spec.js 的写法和 traceTable、judge.js 的整张表一次判）。
// 下面每一张「对的表」「错法的表」都是照引擎跑出来再抄的（希尔 49 38 65 97 76 13 27 49′、增量 4 2 1 和王道的例子一样）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe, parseCheck, selfCheck, traceTable, ENGINE_CHECK_FIELDS } from '../kit/src/check/spec.js';
import { judgeMachine, teachFor, outcomeOf, itemLabel, fallbackPrompt } from '../kit/src/check/judge.js';
import { sortPass } from '../kit/src/engines/measures.js';

const P = (src) => { const r = parseProbe('trace', src.trim()); if (r.error) throw new Error(r.error); return r.probe; };
const item = (r, id) => r.items.find((x) => x.id === id);
const row = (s) => s.split(' ');

const SHELL_SRC = `
id: p1
q: 对下面的序列做希尔排序，写出每一趟结束后的序列
target: 希尔排序分组
level: 方法
use: sort
algo: shell
array: 49 38 65 97 76 13 27 49′
gaps: 4 2 1
teach r1: 第 1 趟 d = 4：第 1、5 个一组，第 2、6 个一组……
teach slip: 这一处是抄错了，不是不会：再对一遍第 1 趟。
teach tag=shellBlock: 相隔 d 的元素才是一组（第 1、1+d、1+2d……个）。
teach default: 一组一组地做直接插入。`;
const SHELL = P(SHELL_SRC);
// 引擎跑出来的三趟
const R1 = '49 13 27 49 76 38 65 97';
const R2 = '27 13 49 38 65 49 76 97';
const R3 = '13 27 38 49 49 65 76 97';

test('trace 的写法：use + 引擎自己的字段；检验共用的字段归检验', () => {
  assert.equal(SHELL.type, 'trace');
  assert.equal(SHELL.use, 'sort');
  assert.deepEqual(SHELL.fields, { algo: 'shell', array: '49 38 65 97 76 13 27 49′', gaps: '4 2 1' });
  assert.equal(SHELL.q, '对下面的序列做希尔排序，写出每一趟结束后的序列');
  assert.equal(SHELL.facet, '能用');
  assert.deepEqual(Object.keys(SHELL.teach), ['r1', 'slip', 'tag=shellBlock', 'default']);
  assert.deepEqual(SHELL.against, []);
});

test('traceTable：引擎的填表、错法（短名 + 说法 + 表）、有并列的行', () => {
  const T = traceTable(SHELL);
  assert.equal(T.table.rows.length, 3);
  assert.deepEqual(T.table.rows.map((r) => r.cells.map((c) => [].concat(c.v)[0]).join(' ')), [R1, R2, R3]);
  assert.deepEqual(T.ties, []);
  const v = T.variants.find((x) => x.key === 'shellBlock');
  assert.ok(v);
  assert.match(v.label, /相邻的元素分成了一组/);
  assert.deepEqual(v.table.rows.map((r) => r.cells.map((c) => [].concat(c.v)[0]).join(' ')), ['38 49 65 97 13 76 27 49', '38 49 65 97 13 27 49 76', R3]);
});

test('希尔全对：三项都 ok、过了；49 49′ 49’ 都认', () => {
  const r = judgeMachine(SHELL, { cells: [row(R1), row(R2), row(R3)] });
  assert.deepEqual(r.items.map((x) => [x.id, x.ok]), [['r1', true], ['r2', true], ['r3', true]]);
  assert.equal(r.stop, false);
  assert.equal(r.needsClaude, false);
  assert.equal(outcomeOf(SHELL, r.items).outcome, 'pass');
  const marks = judgeMachine(SHELL, { cells: [row('49 13 27 49’ 76 38 65 97'), row("27 13 49 38 65 49' 76 97"), row('13 27 38 49 49′ 65 76 97')] });
  assert.deepEqual(marks.items.map((x) => x.ok), [true, true, true]);
});

test('第 2 趟写成了直接插入（一趟排完）：r1 ok、r2 false，why 指到那一格', () => {
  const r = judgeMachine(SHELL, { cells: [row(R1), row(R3), row(R3)] });
  assert.equal(item(r, 'r1').ok, true);
  assert.equal(item(r, 'r2').ok, false);
  assert.match(item(r, 'r2').why, /^第 2 趟（d = 2）第 1 格不对/);
  // 第 3 趟 d = 1 怎么写都排得齐、「按上一行推」也对：但这一行整行做错了，不是笔误（笔误只认差一两格）
  assert.equal(item(r, 'r3').carried, true);
  assert.notEqual(item(r, 'r2').tag, 'slip');
  assert.equal(r.stop, true);
  assert.equal(outcomeOf(SHELL, r.items).outcome, 'fail');
});

test('第 1 趟换错一个数、后两趟照它推都对：r1 false、r2 r3 carried 而且 ok，tag slip、笔误那句', () => {
  const bad1 = '49 13 27 49 76 38 97 65'; // 65 97 写反了
  const g = { gaps: [4, 2, 1] };
  const c2 = sortPass('shell', bad1.split(' ').map(Number), 2, g);
  const c3 = sortPass('shell', c2, 3, g);
  assert.equal(c2.join(' '), '27 13 49 38 76 49 97 65'); // 照引擎的一趟作用在学生写的上一行上
  assert.equal(c3.join(' '), R3);
  const r = judgeMachine(SHELL, { cells: [row(bad1), c2.map(String), c3.map(String)] });
  assert.deepEqual(r.items.map((x) => [x.id, x.ok, !!x.carried]), [['r1', false, false], ['r2', true, true], ['r3', true, true]]);
  const e = item(r, 'r1');
  assert.equal(e.tag, 'slip');
  assert.equal(e.why, '后面按你自己的上一行推都对，第 1 趟这一处写错了');
  assert.equal(e.keys[0], 'slip');
  assert.ok(e.keys.includes('tag=slip'));
  assert.ok(e.keys.includes('r1'));
  const o = outcomeOf(SHELL, r.items);
  assert.equal(o.outcome, 'fail'); // 照样没过：错的那一行是 false
  assert.deepEqual(o.failed, ['r1']);
  assert.equal(teachFor(SHELL, o.failed, r.items).key, 'slip');
  // 后面推得也不对：不是笔误
  const r2 = judgeMachine(SHELL, { cells: [row(bad1), row(R2), row(R3)] });
  assert.equal(item(r2, 'r2').carried, true);
  assert.equal(item(r2, 'r2').ok, false);
  assert.notEqual(item(r2, 'r1').tag, 'slip');
  assert.equal(teachFor(SHELL, ['r1', 'r2'], r2.items).key, 'r1');
});

test('对上错法 shellBlock：tag 是短名、why 是错法的说法，补讲先找 tag=shellBlock', () => {
  const r = judgeMachine(SHELL, { cells: [row('38 49 65 97 13 76 27 49'), row('38 49 65 97 13 27 49 76'), row(R3)] });
  const e = item(r, 'r1');
  assert.equal(e.ok, false);
  assert.equal(e.tag, 'shellBlock');
  assert.match(e.why, /相邻的元素分成了一组/);
  assert.deepEqual(e.keys, ['tag=shellBlock', 'r1']);
  assert.equal(teachFor(SHELL, outcomeOf(SHELL, r.items).failed, r.items).key, 'tag=shellBlock');
});

test('rows: 1-2 只填前两趟；rows: 2-3 第 1 趟直接给出、r1 是第 2 趟；超出范围自检报', () => {
  const a = P(`${SHELL_SRC}\nrows: 1-2`);
  const ta = traceTable(a).table;
  assert.equal(ta.rows.length, 2);
  const r = judgeMachine(a, { cells: [row(R1), row(R2)] });
  assert.deepEqual(r.items.map((x) => [x.id, x.ok]), [['r1', true], ['r2', true]]);
  const b = P(`${SHELL_SRC}\nrows: 2-3`);
  const tb = traceTable(b).table;
  assert.equal(tb.rows.length, 3);
  assert.ok(tb.rows[0].cells.every((c) => c.given));
  assert.equal(itemLabel(b, 'r1'), '第 2 趟（d = 2）');
  assert.equal(itemLabel(b, 'r2'), '第 3 趟（d = 1）');
  const rb = judgeMachine(b, { cells: [[], row(R2), row(R3)] });
  assert.deepEqual(rb.items.map((x) => [x.id, x.ok]), [['r1', true], ['r2', true]]);
  assert.equal(itemLabel(SHELL, 'r3'), '第 3 趟（d = 1）');
  // 自检
  const chk = (extra) => {
    const { check, errors } = parseCheck('check id=k1', ['block DS-L8.3 must=p1', '```trace', `${SHELL_SRC.trim()}\nretry: q1, q2${extra}`, '```',
      '```trace', SHELL_SRC.trim().replace('id: p1', 'id: q1'), '```', '```trace', SHELL_SRC.trim().replace('id: p1', 'id: q2'), '```'].join('\n'));
    assert.deepEqual(errors, []);
    return selfCheck(check);
  };
  assert.deepEqual(chk(''), []);
  assert.deepEqual(chk('\nrows: 1-2'), []);
  assert.ok(chk('\nrows: 2-5').some((m) => /p1 的.*rows:.*3/.test(m)), chk('\nrows: 2-5').join('\n'));
  assert.match(parseProbe('trace', `${SHELL_SRC}\nrows: 两趟`).error, /rows:/);
  assert.match(parseProbe('trace', `${SHELL_SRC}\nrows: 3-2`).error, /rows:/);
  assert.match(parseProbe('trace', `${SHELL_SRC}\nrows: 2-3\ngiven: 1`).error, /given/);
});

test('use: elim 报没有填表；不认识的引擎、没写 use、写了 must 都报', () => {
  assert.match(parseProbe('trace', 'id: q\ntarget: x\nlevel: 基础\nuse: elim\nmatrix: [[1,2],[3,4]]').error, /elim.*没有填表/);
  assert.match(parseProbe('trace', 'id: q\ntarget: x\nlevel: 基础\nuse: frames').error, /没有填表/);
  assert.match(parseProbe('trace', 'id: q\ntarget: x\nlevel: 基础\nuse: sortt\narray: 3 1 2').error, /不认识/);
  assert.match(parseProbe('trace', 'id: q\ntarget: x\nlevel: 基础\nalgo: shell\narray: 3 1 2').error, /use:/);
  assert.match(parseProbe('trace', `${SHELL_SRC}\nmust: 写出分组`).error, /trace 不写 must/);
});

test('字段读不懂、写错名字：自检报出来', () => {
  const bad = P(SHELL_SRC.replace('algo: shell', 'algo: shel'));
  assert.throws(() => traceTable(bad));
  const msgs = (src) => {
    const { check } = parseCheck('check id=k1', ['block DS-L8.3 must=p1', '```trace', src.trim(), '```'].join('\n'));
    return selfCheck(check, {}, { lenient: true });
  };
  assert.ok(msgs(SHELL_SRC.replace('algo: shell', 'algo: shel')).some((m) => /p1 的/.test(m)));
  assert.ok(msgs(SHELL_SRC.replace('gaps: 4 2 1', 'gapz: 4 2 1')).some((m) => /gapz/.test(m)));
  // 判的时候引擎跑不了：待核，不当过也不当错
  const r = judgeMachine(bad, { cells: [] });
  assert.equal(r.items[0].ok, null);
  assert.equal(outcomeOf(bad, r.items).outcome, 'pending');
});

test('against: shellBlock 这组数分得开不报；只填第 1 趟时分不开、照它填出来和对的一样就报', () => {
  const msgs = (src) => {
    const { check } = parseCheck('check id=k1', ['block DS-L8.3 must=p1', '```trace', src.trim(), '```'].join('\n'));
    return selfCheck(check, {}, { lenient: true });
  };
  assert.deepEqual(msgs(`${SHELL_SRC}\nagainst: shellBlock`), []);
  // 32 57 13 43 33 99 83 90：shellBlock 的第 1 趟和对的一样，后面才不一样（照引擎找的）
  const SAME1 = SHELL_SRC.replace('49 38 65 97 76 13 27 49′', '32 57 13 43 33 99 83 90');
  assert.deepEqual(msgs(`${SAME1}\nagainst: shellBlock`), []);
  assert.ok(msgs(`${SAME1}\nagainst: shellBlock\nrows: 1`).some((m) => /shellBlock.*分不开/.test(m)));
  // 已经有序：引擎连这种错法都不列
  assert.ok(msgs(`${SHELL_SRC.replace('49 38 65 97 76 13 27 49′', '1 2 3 4 5 6 7 8')}\nagainst: shellBlock`).some((m) => /shellBlock/.test(m)));
  assert.ok(msgs(`${SHELL_SRC}\nagainst: shellBlok`).some((m) => /shellBlok/.test(m)));
  // 写了 against：只认那几种错法
  const only = P(`${SHELL_SRC}\nagainst: shellBlock`);
  assert.equal(item(judgeMachine(only, { cells: [row('38 49 65 97 13 76 27 49'), row('38 49 65 97 13 27 49 76'), row(R3)] }), 'r1').tag, 'shellBlock');
});

// —— 页面置换 OPT：第 10、11 次访问换哪一页靠并列定（1 和 2、再往后 X 和 3 以后都不再用）——
const OPT_SRC = `
id: o1
target: OPT 换以后最久不用的
level: 方法
use: paging
algo: opt
refs: 1 2 3 4 1 2 5 1 2 3 4 5
frames: 3`;
// 引擎的表（一次访问一列）：块 1 块 2 块 3（不论先后）、缺页、换出
const OPT_ROWS = [
  ['1', '', '', '√', ''], ['1', '2', '', '√', ''], ['1', '2', '3', '√', ''], ['1', '2', '4', '√', '3'],
  ['1', '2', '4', '', ''], ['1', '2', '4', '', ''], ['1', '2', '5', '√', '4'], ['1', '2', '5', '', ''],
  ['1', '2', '5', '', ''], ['3', '2', '5', '√', '1'], ['3', '4', '5', '√', '2'], ['3', '4', '5', '', ''],
];

test('OPT 有并列的那几步：照引擎写的照样 ok；写了另一种对的换法不是 false（待核）', () => {
  const opt = P(OPT_SRC);
  const T = traceTable(opt);
  assert.equal(T.table.rows.length, 12);
  assert.deepEqual(T.ties, [9, 10, 11]); // 第 10 次访问起，往后的块里放什么都看前面换了谁
  assert.deepEqual(judgeMachine(opt, { cells: OPT_ROWS }).items.map((x) => x.ok), Array(12).fill(true));
  // 第 10 次换 2（不换 1）、第 11 次换 3：也是 OPT
  const alt = OPT_ROWS.map((r) => r.slice());
  alt[9] = ['1', '3', '5', '√', '2'];
  alt[10] = ['1', '4', '5', '√', '3'];
  alt[11] = ['1', '4', '5', '', ''];
  const r = judgeMachine(opt, { cells: alt });
  assert.ok(r.items.every((x) => x.ok !== false), JSON.stringify(r.items));
  assert.deepEqual(r.items.slice(0, 9).map((x) => x.ok), Array(9).fill(true));
  assert.equal(item(r, 'r10').ok, null);
  assert.equal(outcomeOf(opt, r.items).outcome, 'pending');
  assert.match(itemLabel(opt, 'r10'), /第 10 列/);
  // 自检：要填的列有并列
  const { check } = parseCheck('check id=k1', ['block OS-L3.2 must=o1', '```trace', OPT_SRC.trim(), '```'].join('\n'));
  assert.ok(selfCheck(check, {}, { lenient: true }).some((m) => /o1 的.*并列/.test(m)));
  // 只填前 9 列：没有并列
  const { check: c9 } = parseCheck('check id=k1', ['block OS-L3.2 must=o1', '```trace', `${OPT_SRC.trim()}\nrows: 9`, '```'].join('\n'));
  assert.deepEqual(selfCheck(c9, {}, { lenient: true }), []);
});

test('别的引擎：第一处错以后的行不列', () => {
  const opt = P(`${OPT_SRC}\nrows: 9`);
  const bad = OPT_ROWS.slice(0, 9).map((r) => r.slice());
  bad[3] = ['1', '2', '4', '√', '1'];
  const r = judgeMachine(opt, { cells: bad });
  assert.deepEqual(r.items.map((x) => [x.id, x.ok]), [['r1', true], ['r2', true], ['r3', true], ['r4', false]]);
  assert.match(item(r, 'r4').why, /第 4 列「4」的「换出」不对/);
  assert.equal(r.items.some((x) => x.carried), false);
});

test('磁盘 SSTF 两边一样远：从那一步起都有并列，另一种走法待核', () => {
  const d = P('id: d1\ntarget: SSTF 找最近的\nlevel: 基础\nuse: disk\nalgo: sstf\nhead: 50\nrequests: 40 60 100');
  assert.deepEqual(traceTable(d).ties, [0, 1, 2]);
  assert.deepEqual(judgeMachine(d, { cells: [['40', '10'], ['60', '20'], ['100', '40']] }).items.map((x) => x.ok), [true, true, true]);
  const alt = judgeMachine(d, { cells: [['60', '10'], ['40', '20'], ['100', '60']] });
  assert.deepEqual(alt.items.map((x) => x.ok), [null, null, null]);
});

test('散列表：表下面那几格（ASL）表都对了才判，叫外部写的名字；补讲的提示词抄着学生填的表', () => {
  const h = P('id: h1\ntarget: 线性探测\nlevel: 基础\nuse: hash\nhash: 1 12 23\nsize: 11\np: 11');
  const { table } = traceTable(h);
  const right = table.rows.map((r) => r.cells.map((c) => String([].concat(c.v)[0] ?? '')));
  const r = judgeMachine(h, { cells: Object.assign(right.map((x) => x.slice()), { extra: ['2', '1.5'] }) });
  assert.equal(r.items.filter((x) => /^r/.test(x.id)).every((x) => x.ok === true), true);
  assert.deepEqual(r.items.filter((x) => /^x/.test(x.id)).map((x) => [x.id, x.ok]), [['x1', true], ['x2', false]]);
  assert.equal(itemLabel(h, 'x2'), 'ASL失败');
  const ins = P('id: i1\ntarget: 插入第几个\nlevel: 基础\nuse: sort\nalgo: insert\narray: 3 1 2');
  const bad = { cells: [['1', '3', '2'], ['2', '1', '3']] };
  const j = judgeMachine(ins, bad);
  assert.deepEqual(j.items.map((x) => [x.id, x.ok]), [['r1', true], ['r2', false]]);
  const fp = fallbackPrompt({ probe: ins, answer: bad, items: j.items });
  assert.match(fp, /第 2 趟：2 \| 1 \| 3/);
  assert.doesNotMatch(fp, /[他她]/);
});

// —— 复查修正 ——

test('OPT 有并列的那几列空着：不是另一种做法，照常判没写（没过，不是待核）', () => {
  const opt = P(OPT_SRC);
  const blank = OPT_ROWS.map((r, k) => (k < 9 ? r.slice() : ['', '', '', '', '']));
  const r = judgeMachine(opt, { cells: blank });
  assert.equal(item(r, 'r10').ok, false);
  assert.match(item(r, 'r10').why, /还空着/);
  assert.equal(outcomeOf(opt, r.items).outcome, 'fail');
});

test('引擎的字段和检验的撞名：写成 use.名字: 交给引擎；只写了检验那一个时报怎么写', () => {
  const s = P('id: s1\ntarget: RR 的时间片\nlevel: 方法\nuse: sched\nalgo: rr\nuse.q: 2\nprocs: P1 0 3, P2 1 2');
  assert.deepEqual(s.fields, { algo: 'rr', q: '2', procs: 'P1 0 3, P2 1 2' });
  assert.equal(s.q, '');
  assert.deepEqual(traceTable(s).table.rows.map((r) => r.cells.map((c) => c.v)), [['5', '5', '5/3', '2'], ['4', '3', '3/2', '1']]);
  assert.match(parseProbe('trace', 'id: t1\ntarget: x\nlevel: A B C\nuse: tree').error, /level 是检验的字段；引擎的 level 写成 use\.level:/);
  assert.match(parseProbe('trace', 'id: t1\ntarget: x\nlevel: 基础\nuse: tree\nlevel: A B C').error, /level 写了两次.*use\.level:/);
  // 引擎缺了被检验拿走的字段：自检的话里提醒
  const { check } = parseCheck('check id=k1', ['block OS-L2.2 must=s2', '```trace', 'id: s2\ntarget: x\nlevel: 基础\nuse: sched\nalgo: rr\nprocs: P1 0 3, P2 1 2', '```'].join('\n'));
  assert.ok(selfCheck(check, {}, { lenient: true }).some((m) => /q 是检验的字段；引擎的 q 写成 use\.q:/.test(m)));
});

test('ENGINE_CHECK_FIELDS 照引擎的源码：每一项那个引擎真读这个字段', async () => {
  const { readFileSync } = await import('node:fs');
  const reg = readFileSync(new URL('../kit/src/engines/registry.js', import.meta.url), 'utf8');
  const fileOf = {};
  for (const m of reg.matchAll(/import \{([^}]+)\} from '\.\/([\w]+\.js)'/g)) for (const n of m[1].split(',')) fileOf[n.trim()] = m[2];
  for (const [e, ks] of Object.entries(ENGINE_CHECK_FIELDS)) {
    const src = readFileSync(new URL(`../kit/src/engines/${fileOf[`${e}Engine`]}`, import.meta.url), 'utf8');
    for (const k of ks) assert.ok(new RegExp(`fields\\.${k}\\b`).test(src), `${e} 的 ${k}`);
  }
});

test('后面的行空着、读不懂：照实说，不说「推也不对」；并列的提示留着 rows: a-b 的起点；rows 写错不算字段读不懂', () => {
  const bad1 = '49 13 27 49 76 38 97 65';
  const r = judgeMachine(SHELL, { cells: [row(bad1), ['', '', '', '', '', '', '', ''], row('1 2 x 4 5 6 7 8')] });
  assert.match(item(r, 'r2').why, /第 2 趟（d = 2）还空着/);
  assert.match(item(r, 'r3').why, /第 3 趟（d = 1）读不懂/);
  const msgs = (src) => {
    const { check } = parseCheck('check id=k1', ['block OS-L3.2 must=o1', '```trace', src.trim(), '```'].join('\n'));
    return selfCheck(check, {}, { lenient: true });
  };
  assert.ok(msgs(`${OPT_SRC}\nrows: 2-12`).some((m) => /rows: 2-9/.test(m)), msgs(`${OPT_SRC}\nrows: 2-12`).join('\n'));
  const over = msgs(`${OPT_SRC}\nrows: 2-13`);
  assert.ok(over.some((m) => /^o1 的 rows: 写到第 13 列/.test(m)), over.join('\n'));
  assert.ok(over.every((m) => !/字段读不懂/.test(m)));
});
