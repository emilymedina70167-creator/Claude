// 守卫（kit/src/memory/guard.js，docs/guard-plan.md）：Claude 写的话不改，只判断收不收、挂不挂提醒、要不要暂存
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardCandidate, buildCorpus, findQuotes, normText, containment, turnRefs, compRefs, authorOf } from '../kit/src/memory/guard.js';

const SID = 'c-20261102-1';
const turns = [
  { seq: 41, role: 'student', say: '我刚刚就是判断后面一个是前面的补充就判断是宾补' },
  { seq: 42, role: 'claude', text: '你说的这条判据用不了。\n````board new id=b18 title="只看加「是」"\n```conjecture\nid: cj-b18\n```\n````', boardOps: [{ id: 'b18', op: 'new' }] },
  { seq: 43, role: 'student', say: 'cat with owner is operant conditioning' },
];
const evidence = [
  { id: 'ev-1', session: SID, comp: 'qz-b29', src: 'record', ok: false, value: 'are', q: 'Prices are rising 的谓语', at: 100, block: 'EN-L3.1.1' },
  { id: 'ev-2', session: SID, comp: 'ps-b26r', src: 'record', ok: true, value: '[S the word habit] [V carries] [O a negative implication]', at: 200, block: 'EN-L3.1.1' },
];
const corpus = buildCorpus({ turns, evidence });
const mem = { evidence, sessions: [{ id: SID, startedAt: 50 }], errors: [], weaknesses: [], observations: [], slips: [] };
const obs = (text, extra = {}) => ({ coll: 'observations', id: 'ob-x', doc: { kind: 'note', text, at: 1, session: SID, ...extra }, author: 'class', session: SID });

test('normText / containment：不管空格、全角半角、引号；缩写了几个字还算大体对得上', () => {
  assert.equal(normText('A, B ：「好」'), normText('a,b:"好"'));
  assert.ok(containment('介词短语作定语', '介词短语，作定语修饰 cat') >= 0.8);
  assert.ok(containment('完全编出来的一句话', '介词短语，作定语修饰 cat') < 0.3);
});

test('findQuotes：挨着轮次、「写 / 说 / 问过 / 抗议」的引号是引原话；起名字的不是', () => {
  const q = findQuotes('#43 学生原话「后面一个是前面的补充」；误解叫「补充就判宾补」；#77 qz-b29「Prices are rising」；#81 主动问过「这节课怎么学」');
  assert.deepEqual(q.map((x) => [x.quote.slice(0, 4), x.cited]), [['后面一个', true], ['补充就判', false], ['Pric', true], ['这节课怎', true]]);
  assert.equal(q[0].turn, 43);
  assert.deepEqual(turnRefs('见 #8、#12 和第 30 轮'), [8, 12, 30]);
  assert.deepEqual(compRefs('qz-b29 选错，ps-b26r 对，b8 的标题'), ['qz-b29', 'ps-b26r', 'b8']);
});

test('引的原话找得到：收下；编的、改了字的：挂提醒（课堂当场写的）', () => {
  assert.equal(guardCandidate(obs('#41 学生原话「后面一个是前面的补充就判断是宾补」'), { mem, corpus }).verdict, 'accept');
  const fake = guardCandidate(obs('#41 学生原话「这题太简单了不用讲」'), { mem, corpus });
  assert.equal(fake.verdict, 'flag');
  assert.equal(fake.checks[0].code, 'quote-miss');
  // 中间省略了一段：每一截都找得到就算
  assert.equal(guardCandidate(obs('#43 写成「cat with owner … operant conditioning」'), { mem, corpus }).verdict, 'accept');
});

test('事后写的（lab）对不上：先暂存，不直接收', () => {
  const r = guardCandidate({ ...obs('#41 学生说「我觉得应该先算行列式」'), author: 'lab', doc: { kind: 'note', text: '#41 学生说「我觉得应该先算行列式」', at: 1, session: SID, backfill: true } }, { mem, corpus });
  assert.equal(r.verdict, 'hold');
});

test('轮次、板上编号对不上：挂提醒；别的课里有的编号只记一笔', () => {
  assert.equal(guardCandidate(obs('见 #999 的作答'), { mem, corpus }).checks[0].code, 'turn-missing');
  assert.equal(guardCandidate(obs('学生在 qz-b777 选错'), { mem, corpus }).checks[0].code, 'comp-missing');
  const other = guardCandidate(obs('上一节 ps-b15 那题'), { mem, corpus, allComps: new Set(['ps-b15']) });
  assert.equal(other.verdict, 'accept');
  assert.equal(other.checks[0].code, 'comp-other');
});

test('这节课只有证据没有轮次的记录：不核原话（不冤枉）', () => {
  const thin = buildCorpus({ turns: [], evidence });
  assert.equal(guardCandidate(obs('学生说「这句话记录里没有」'), { mem, corpus: thin }).verdict, 'accept');
});

test('依据：像编号的必须找得到（拒收）；写成一段话的不算编号', () => {
  const bad = guardCandidate({ ...obs('学生选错了'), basis: ['ev-notreal'] }, { mem, corpus });
  assert.equal(bad.verdict, 'reject');
  assert.equal(bad.checks[0].code, 'basis-missing');
  const prose = guardCandidate({ ...obs('学生选错了'), doc: { kind: 'note', text: '学生选错了', at: 1, session: SID, basis: ['旧记录：第7章整章测试 09-19'] } }, { mem, corpus });
  assert.equal(prose.verdict, 'accept');
});

test('错题的「我写的」要对得上挂的作答', () => {
  const e = (mine) => ({ coll: 'errors', id: 'EN-L3-20', author: 'class', session: SID, doc: { source: '课堂', q: '谓语', mine, step: '1', cause: '只认 be', date: '2026-11-02', session: SID, evidence: ['ev-1'], block: 'EN-L3.1.1' } });
  assert.equal(guardCandidate(e('are'), { mem }).verdict, 'accept');
  assert.equal(guardCandidate(e('我写的是 A 可逆所以秩为 n'), { mem }).checks[0].code, 'mine-mismatch');
});

test('归属：课堂当场写的、我改过的，事后写的和页面不能改它的话；课堂自己能改', () => {
  const before = { kind: 'note', text: '学生把 are 当成整个谓语', at: 1, session: SID, by: 'class' };
  const after = { ...before, text: '学生完全掌握了进行时' };
  assert.equal(guardCandidate({ coll: 'observations', id: 'ob-1', before, doc: after, author: 'lab', session: SID }, { mem }).verdict, 'reject');
  assert.notEqual(guardCandidate({ coll: 'observations', id: 'ob-1', before, doc: after, author: 'class', session: SID }, { mem }).verdict, 'reject');
  const mine = { ...before, log: [{ by: 'me', field: 'text' }] };
  assert.equal(authorOf(mine), 'me');
  assert.equal(guardCandidate({ coll: 'observations', id: 'ob-1', before: mine, doc: after, author: 'page', session: SID }, { mem }).verdict, 'reject');
  // 只挂「有疑问」不改话：可以
  assert.equal(guardCandidate({ coll: 'observations', id: 'ob-1', before, doc: { ...before, doubt: '后来 #43 又错了' }, author: 'lab', session: SID }, { mem }).checks.some((c) => c.code === 'not-yours'), false);
});

test('一致：几乎照抄已有的拒收；弱点标修好了但之后还在错、复现组记过但这节课做错：挂提醒', () => {
  const m2 = { ...mem, observations: [{ id: 'ob-0', kind: 'note', text: '学生把 are 当成整个谓语，没看后面的 rising', session: SID }] };
  assert.equal(guardCandidate(obs('学生把 are 当成整个谓语，没看后面的 rising。'), { mem: m2 }).checks[0].code, 'duplicate');
  const w = { coll: 'weaknesses', id: 'W40', author: 'class', session: SID, doc: { title: 'be + -ing 只认 be', scope: '局部', level: 'L3', status: 'closed', blocks: ['EN-L3.1.1'], last: '1969-12-31', basis: ['ev-2'] } };
  assert.equal(guardCandidate(w, { mem }).checks.find((c) => c.gate === 'consistency').code, 'contradicts-evidence');
  const r = { coll: 'reviews', id: 'R30', author: 'class', session: SID, doc: { title: '进行时', tier: 3, result: '过', blocks: ['EN-L3.1.1'] } };
  assert.equal(guardCandidate(r, { mem }).verdict, 'flag');
});

test('格式不对（缺必填）：拒收', () => {
  const r = guardCandidate({ coll: 'recall', id: 'K9', doc: { q: '问' }, author: 'class' }, { mem });
  assert.equal(r.verdict, 'reject');
  assert.equal(r.checks[0].gate, 'format');
});
