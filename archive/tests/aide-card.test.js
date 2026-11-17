// 第九轮第 1 批：学生卡（kit/src/aide/card.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_MAX, CARD_SECTIONS, parseCard, cardText, cardIdsFor, cardSrc, cardStale, checkCardLines, acceptCard } from '../kit/src/aide/card.js';
import { buildCorpus } from '../kit/src/memory/guard.js';

const curriculum = [
  { id: 'DS-L8.1.1', level: 'block', parent: 'DS-L8.1', title: '排序的基本概念' },
  { id: 'DS-L8.2.1', level: 'block', parent: 'DS-L8.2', title: '直接插入排序', requires: ['DS-L8.1.1'] },
  { id: 'DS-L8.2.2', level: 'block', parent: 'DS-L8.2', title: '折半插入排序' },
];
const mem = {
  curriculum,
  errors: [{ id: 'DS-L8-T09', block: 'DS-L8.1.1', mine: '答「不稳定，输出和输入不一致」；追问中说「不就是后进先出吗」', date: '2026-09-28' }],
  weaknesses: [{ id: 'W39', title: '下标基准', blocks: ['DS-L8.2.1'], status: 'active' }],
  sessions: [{ id: 'c-20261102-1', block: 'DS-L8.2.1' }],
};
const corpora = { 'c-20261102-1': buildCorpus({ turns: [{ seq: 12, role: 'student', text: '前后没变就是稳定' }] }) };

test('读卡：每行「段名｜内容」，段名不认的不收', () => {
  const r = parseCard('概括｜稳定性没过关\n- 误解｜把稳定当后进先出（DS-L8-T09）\n乱写｜x\n\n');
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.lines[0], { sec: '概括', text: '稳定性没过关' });
  assert.equal(r.problems.length, 1);
  assert.equal(CARD_SECTIONS[0], '概括');
});

test('这一块要读哪几张卡：自己、前置、挨着的、跨块的', () => {
  const ids = cardIdsFor('DS-L8.2.1', curriculum, 'cs');
  assert.ok(ids.includes('DS-L8.2.1'));
  assert.ok(ids.includes('DS-L8.1.1'));
  assert.equal(ids.at(-1), 'x-cs');
  assert.ok(ids.length <= 8);
});

test('出处对不上的行丢掉，对得上的留下', () => {
  const lines = [
    { sec: '误解', text: '把稳定当后进先出（DS-L8-T09）' },
    { sec: '误解', text: '下标从 1 数（W99）' },
    { sec: '原话', text: '学生说过「不就是后进先出吗」（DS-L8-T09）' },
    { sec: '原话', text: '学生说过「稳定就是每次都一样快」（c-20261102-1#12）' },
    { sec: '原话', text: '「前后没变就是稳定」（c-20261102-1#12）' },
    { sec: '先测', text: '（c-20261102-1#99）里那道再测一次' },
  ];
  const r = checkCardLines(lines, { mem, corpora });
  assert.deepEqual(r.keep.map((l) => l.text), [lines[0].text, lines[2].text, lines[4].text]);
  assert.equal(r.dropped.length, 3);
});

test('卡超 2 KiB 不收、旧卡原样加几行不收', () => {
  assert.equal(CARD_MAX, 2048);
  assert.equal(acceptCard('概括｜' + '字'.repeat(700), '').ok, false);
  const old = '概括｜稳定性没过关\n误解｜把稳定当后进先出';
  assert.equal(acceptCard(`${old}\n先测｜再问一次稳定`, old).ok, false);
  assert.equal(acceptCard('概括｜稳定性还差一点\n先测｜再问一次稳定', old).ok, true);
});

test('原始记录变了卡就过时', () => {
  const card = { block: 'DS-L8.2.1', src: cardSrc('DS-L8.2.1', mem) };
  assert.equal(cardStale(card, mem), false);
  const more = { ...mem, errors: [...mem.errors, { id: 'DS-L8-T20', block: 'DS-L8.2.1', mine: 'x' }] };
  assert.equal(cardStale(card, more), true);
});

test('给老师看的样子', () => {
  const t = cardText({ block: 'DS-L8.2.1', text: '误解｜把稳定当后进先出\n概括｜稳定性没过关' }, { title: '直接插入排序' });
  assert.match(t, /^### 学生卡：DS-L8\.2\.1 直接插入排序/);
  assert.ok(t.indexOf('概括') < t.indexOf('误解'));
});
