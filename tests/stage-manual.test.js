// 黑板组件 stage 的手册（stage/doc.js 的 stageManual）和组件不碰 DOM 的那一半（stageboxspec.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { TYPES } from '../kit/src/stage/types/index.js';
import { rulesOf } from '../kit/src/stage/rules.js';
import { stageManual, MANUAL_ORDER_EXAMPLE } from '../kit/src/stage/doc.js';
import { parseStageBox, problemsOf, callLine, HEIGHT } from '../kit/src/stageboxspec.js';

const WORDS = ['你应该', '必须先', '最重要', '推荐', '照做'];
const blocksIn = (md) => [...md.matchAll(/```stage\n([\s\S]*?)\n```/g)].map((m) => m[1]);
/** 一段 stage 在不画的场景里演一遍：每一行都不报错（prewrite: all 的照开） */
function play(src) {
  const spec = parseStageBox(src);
  const s = new Scene();
  s.prewriteAll = spec.prewrite === 'all';
  const errs = [...spec.problems];
  for (const c of parseScript(spec.script)) {
    try { s.apply(c); } catch (e) { errs.push(`第 ${c.line + spec.offset - 1} 行「${String(c.src).trim()}」：${e.message}`); }
  }
  return { s, errs };
}

test('手册：开头说清是 ```stage 的写法；没有讲做法的词', () => {
  const md = stageManual();
  assert.match(md, /^# 黑板组件 stage/);
  assert.match(md, /```stage/);
  for (const k of ['id:', 'title:', 'prewrite: all', 'height:', '@g1.wrong', '@t.miss', '@ask.wrong', 'stage-call', 'stage-act', '舞台现在']) assert.ok(md.includes(k), `手册里要有「${k}」`);
  for (const w of WORDS) assert.ok(!md.includes(w), `手册里有「${w}」：${md.slice(Math.max(0, md.indexOf(w) - 40), md.indexOf(w) + 20)}`);
});

test('手册列全了：每种东西的造法、每种交了规则的东西的每个 open 动作和判断式', () => {
  const md = stageManual();
  for (const t of Object.values(TYPES)) {
    if (!t.doc || !t.create.length) continue;
    for (const c of t.create) assert.match(md, new RegExp(`^${c} `, 'm'), `${t.label}：${c}`);
    const r = rulesOf({ type: t.type });
    if (!r) continue;
    for (const a of Object.keys(r.gestures)) assert.match(md, new RegExp(`^open \\S+ ${a}\\b`, 'm'), `${t.label} 的 open … ${a}`);
    for (const p of Object.keys(r.predicates)) assert.ok(md.includes(p), `${t.label} 的判断式 ${p}`);
  }
  assert.match(md, /alg=on/);
  assert.match(md, /follow a sort/);
  assert.match(md, /table T engine=/);
});

test('手册里每个 ```stage 例子照抄能演', () => {
  const list = blocksIn(stageManual());
  assert.ok(list.length >= 10, `例子 ${list.length} 个`);
  for (const src of list) {
    const { errs } = play(src);
    assert.deepEqual(errs, [], src.slice(0, 120));
  }
});

test('把 (A+B)(A+B) 拆开的四项排进格子：不超过 40 行；排对了按按钮做到，排错了演 @g1.wrong；换成 (A−B)² 只改那几行的字', () => {
  assert.ok(MANUAL_ORDER_EXAMPLE.split('\n').length <= 40);
  const { s, errs } = play(MANUAL_ORDER_EXAMPLE);
  assert.deepEqual(errs, []);
  const stu = (l, open) => s.apply(parseScript(l)[0], { by: 'student', open });
  // 先后错：BA 放在第二格
  stu('swap a#3 a#5', 'move'); stu('swap a#1 a#6', 'move'); stu('swap a#4 a#7', 'move'); stu('swap a#2 a#8', 'move');
  const bad = stu('press "排好了"');
  assert.deepEqual(bad.goalsMet || [], []);
  assert.deepEqual(bad.reactions.map((r) => r.src), ['say "再看先后：第二项是左边的 A 乘右边的 B。"']);
  stu('swap a#1 a#4', 'move');
  const ok = stu('press "排好了"');
  assert.deepEqual(ok.goalsMet, ['g1']);
  // (A−B)²
  const minus = MANUAL_ORDER_EXAMPLE.replace('"(A+B)(A+B)"', '"(A-B)(A-B)"').replace('array a = BA B² A² AB _ _ _ _', 'array a = A² -BA B² -AB _ _ _ _').replace('array k = A² AB BA B² hide=on', 'array k = A² -AB -BA B² hide=on');
  assert.deepEqual(play(minus).errs, []);
});

test('读字段：id、title、prewrite、height；字段以后全是镜头指令，行号照这一段数', () => {
  const p = parseStageBox('id: s1\ntitle: 先排两个\nprewrite: all\nheight: 9999\narray a = 3 1 2\nopen a');
  assert.equal(p.id, 's1');
  assert.equal(p.title, '先排两个');
  assert.equal(p.prewrite, 'all');
  assert.equal(p.height, HEIGHT.max);
  assert.equal(p.offset, 5);
  assert.equal(p.script, 'array a = 3 1 2\nopen a');
  assert.deepEqual(p.problems, []);
  assert.equal(parseStageBox('array a = 1').height, HEIGHT.def);
  assert.match(parseStageBox('prewrite: maybe\narray a = 1').problems[0], /prewrite:/);
  assert.match(parseStageBox('id: x').problems[0], /还没有镜头指令/);
  // 没演上的行：行号换成这一段里的第几行；照演了的是软提醒；同一句只报一次
  const ps = problemsOf([{ line: 2, src: 'glw a.1', error: '没有「glw」这个指令' }, { line: 2, src: 'glw a.1', error: '没有「glw」这个指令' }, { line: 3, src: '整句话', error: '要写 say', kept: true }], 5);
  assert.deepEqual(ps, [{ msg: '第 6 行「glw a.1」：没有「glw」这个指令', soft: false }, { msg: '第 7 行「整句话」：要写 say', soft: true }]);
  assert.equal(callLine('s1', 'goal', '学生做到了挑战 g1'), '[舞台 s1] 学生做到了挑战：\n学生做到了挑战 g1');
});
