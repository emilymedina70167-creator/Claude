// 动词的各种形式和拼谓语（kit/src/stage/verbs.js，主线第五轮）：页面只管拼得对，该用哪种时态归老师
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IRREGULAR, formsOf, conjugate } from '../kit/src/stage/verbs.js';

const F = (b) => { const f = formsOf(b); return `${f.s} ${f.ing} ${f.past} ${f.part}`; };

test('规则变化：加 s / es / ies，加 ing（去 e、ie 变 y、双写），加 ed（加 d、y 变 ied、双写）', () => {
  assert.equal(F('walk'), 'walks walking walked walked');
  assert.equal(F('study'), 'studies studying studied studied');
  assert.equal(F('play'), 'plays playing played played');
  assert.equal(F('stop'), 'stops stopping stopped stopped');
  assert.equal(F('plan'), 'plans planning planned planned');
  assert.equal(F('visit'), 'visits visiting visited visited'); // 重音在前：不双写
  assert.equal(F('prefer'), 'prefers preferring preferred preferred');
  assert.equal(F('occur'), 'occurs occurring occurred occurred');
  assert.equal(F('refer'), 'refers referring referred referred');
  assert.equal(F('offer'), 'offers offering offered offered');
  assert.equal(F('open'), 'opens opening opened opened');
  assert.equal(F('live'), 'lives living lived lived');
  assert.equal(F('die'), 'dies dying died died');
  assert.equal(F('agree'), 'agrees agreeing agreed agreed');
  assert.equal(F('watch'), 'watches watching watched watched');
  assert.equal(F('fix'), 'fixes fixing fixed fixed'); // x 不双写
  assert.equal(F('panic'), 'panics panicking panicked panicked');
  assert.equal(F('pass'), 'passes passing passed passed');
  assert.equal(F('carry'), 'carries carrying carried carried');
  assert.equal(F('enjoy'), 'enjoys enjoying enjoyed enjoyed');
  assert.equal(F('show').split(' ')[0], 'shows'); // w 不双写
  assert.equal(formsOf('walk').regular, true);
});

test('不规则动词：照表；do / go / have 的第三人称单数', () => {
  assert.equal(F('go'), 'goes going went gone');
  assert.equal(F('do'), 'does doing did done');
  assert.equal(F('have'), 'has having had had');
  assert.equal(F('write'), 'writes writing wrote written');
  assert.equal(F('become'), 'becomes becoming became become');
  assert.equal(F('run'), 'runs running ran run');
  assert.equal(F('begin'), 'begins beginning began begun');
  assert.equal(F('put'), 'puts putting put put');
  assert.equal(F('read'), 'reads reading read read');
  assert.equal(F('take'), 'takes taking took taken');
  assert.equal(F('get'), 'gets getting got got');
  assert.equal(F('lie'), 'lies lying lay lain');
  assert.equal(F('see'), 'sees seeing saw seen');
  assert.equal(F('show'), 'shows showing showed shown');
  assert.equal(formsOf('go').regular, false);
});

test('短语动词只变第一个词；带前缀的先去前缀查表；老师自己给三种形式', () => {
  assert.equal(F('go on'), 'goes on going on went on gone on');
  assert.equal(F('give up'), 'gives up giving up gave up given up');
  assert.equal(F('look at'), 'looks at looking at looked at looked at');
  assert.equal(F('overcome'), 'overcomes overcoming overcame overcome');
  assert.equal(F('rewrite'), 'rewrites rewriting rewrote rewritten');
  assert.equal(F('undergo'), 'undergoes undergoing underwent undergone');
  assert.equal(F('misunderstand'), 'misunderstands misunderstanding misunderstood misunderstood');
  assert.equal(formsOf('overcome').regular, false);
  const b = formsOf('proofread/proofread/proofread');
  assert.equal(`${b.base} ${b.s} ${b.ing} ${b.past} ${b.part} ${b.regular}`, 'proofread proofreads proofreading proofread proofread false');
  assert.equal(formsOf('proofread').past, 'proofreaded'); // 不在表里照规则变（regular: true，现状里要说一声）
  assert.equal(formsOf('proofread').regular, true);
  assert.throws(() => formsOf(''), /原形/);
  assert.throws(() => formsOf('go/went'), /三种形式/);
});

test('不规则动词表：每条两种形式都有、全小写、常用的都在', () => {
  for (const [k, v] of Object.entries(IRREGULAR)) {
    assert.ok(Array.isArray(v) && v.length === 2 && v.every((x) => /^[a-z]+$/.test(x)), `${k}: ${v}`);
    assert.match(k, /^[a-z]+$/);
  }
  assert.ok(Object.keys(IRREGULAR).length >= 180);
  for (const k of ['be', 'bear', 'beat', 'bring', 'build', 'buy', 'catch', 'choose', 'come', 'deal', 'draw', 'drive', 'eat', 'fall', 'feel', 'find', 'fly', 'forget', 'give', 'grow', 'hold', 'keep', 'know', 'lead', 'leave', 'lose', 'make', 'mean', 'meet', 'pay', 'rise', 'say', 'seek', 'sell', 'send', 'set', 'shake', 'speak', 'spend', 'stand', 'steal', 'strike', 'teach', 'tell', 'think', 'throw', 'understand', 'wear', 'win', 'withdraw']) assert.ok(IRREGULAR[k], k);
});

const C = (base, o = {}) => conjugate(base, o);

test('拼谓语：write 的 16 种时态（主语第三人称单数）', () => {
  const T = ['过去', '现在', '将来', '过去将来'];
  const want = {
    一般: ['wrote', 'writes', 'will write', 'would write'],
    进行: ['was writing', 'is writing', 'will be writing', 'would be writing'],
    完成: ['had written', 'has written', 'will have written', 'would have written'],
    完成进行: ['had been writing', 'has been writing', 'will have been writing', 'would have been writing'],
  };
  for (const [aspect, row] of Object.entries(want)) T.forEach((time, i) => assert.equal(C('write', { time, aspect }), row[i], `${time} ${aspect}`));
});

test('拼谓语：被动（一般、进行的过去和现在、完成）；没有的组合当场报', () => {
  const P = (time, aspect) => C('write', { time, aspect, passive: true });
  assert.deepEqual(['过去', '现在', '将来', '过去将来'].map((t) => P(t, '一般')), ['was written', 'is written', 'will be written', 'would be written']);
  assert.equal(P('过去', '进行'), 'was being written');
  assert.equal(P('现在', '进行'), 'is being written');
  assert.deepEqual(['过去', '现在', '将来', '过去将来'].map((t) => P(t, '完成')), ['had been written', 'has been written', 'will have been written', 'would have been written']);
  assert.throws(() => P('现在', '完成进行'), /一般不用/);
  assert.throws(() => P('将来', '进行'), /一般不用/);
  assert.throws(() => P('过去将来', '进行'), /一般不用/);
  assert.equal(C('look at', { time: '现在', passive: true }), 'is looked at');
});

test('拼谓语：否定——not 插在第一个助动词后面，没有助动词用 do', () => {
  const N = (time, aspect, extra = {}) => C('write', { time, aspect, negative: true, ...extra });
  assert.equal(N('过去', '一般'), 'did not write');
  assert.equal(N('现在', '一般'), 'does not write');
  assert.equal(N('将来', '一般'), 'will not write');
  assert.equal(N('现在', '进行'), 'is not writing');
  assert.equal(N('现在', '完成'), 'has not written');
  assert.equal(N('过去', '完成进行'), 'had not been writing');
  assert.equal(N('现在', '一般', { passive: true }), 'is not written');
  assert.equal(N('过去', '进行', { passive: true }), 'was not being written');
  assert.equal(N('将来', '完成', { passive: true }), 'will not have been written');
});

test('拼谓语：人称和数', () => {
  const S = (subject, o = {}) => C('write', { subject, ...o });
  assert.equal(S('I'), 'write');
  assert.equal(S('I', { aspect: '进行' }), 'am writing');
  assert.equal(S('I', { aspect: '完成' }), 'have written');
  assert.equal(S('I', { time: '过去', aspect: '进行' }), 'was writing');
  assert.equal(S('I', { negative: true }), 'do not write');
  for (const subject of ['they', '复', 'we', 'you']) {
    assert.equal(S(subject), 'write');
    assert.equal(S(subject, { aspect: '进行' }), 'are writing');
    assert.equal(S(subject, { aspect: '完成' }), 'have written');
    assert.equal(S(subject, { time: '过去', aspect: '进行' }), 'were writing');
    assert.equal(S(subject, { negative: true }), 'do not write');
  }
  for (const subject of ['he', 'she', 'it', '单']) assert.equal(S(subject, { aspect: '完成进行' }), 'has been writing');
  assert.equal(C('write'), 'writes'); // 都不写：现在、一般、第三人称单数
});

test('拼谓语：be、have 自己当动词；短语动词', () => {
  assert.deepEqual([C('be'), C('be', { time: '过去' }), C('be', { time: '将来' }), C('be', { aspect: '完成' }), C('be', { aspect: '进行' })], ['is', 'was', 'will be', 'has been', 'is being']);
  assert.deepEqual([C('be', { subject: 'I' }), C('be', { subject: 'I', time: '过去' }), C('be', { subject: 'they' }), C('be', { subject: 'they', time: '过去' })], ['am', 'was', 'are', 'were']);
  assert.deepEqual([C('be', { negative: true }), C('be', { time: '过去', negative: true }), C('be', { time: '将来', negative: true })], ['is not', 'was not', 'will not be']);
  assert.throws(() => C('be', { passive: true }), /be 没有被动/);
  assert.deepEqual([C('have'), C('have', { time: '过去' }), C('have', { aspect: '进行' }), C('have', { aspect: '完成' }), C('have', { negative: true })], ['has', 'had', 'is having', 'has had', 'does not have']);
  assert.equal(C('go on', { time: '现在', aspect: '完成进行' }), 'has been going on');
  assert.equal(C('go on', { time: '过去' }), 'went on');
  assert.equal(C('go on', { time: '将来', aspect: '完成' }), 'will have gone on');
});

test('拼谓语：情态动词写在「时间」那一格', () => {
  assert.equal(C('go', { time: 'must', aspect: '完成' }), 'must have gone');
  assert.equal(C('go', { time: 'should', aspect: '进行' }), 'should be going');
  assert.equal(C('write', { time: 'can', passive: true }), 'can be written');
  assert.equal(C('go', { time: 'must', negative: true }), 'must not go');
  assert.equal(C('go', { time: 'can', negative: true }), 'cannot go');
  assert.equal(C('go', { time: 'ought to' }), 'ought to go');
  assert.equal(C('go', { time: 'may', aspect: '完成进行' }), 'may have been going');
});

test('拼谓语：英文的别名也认；不认得的当场报并列出能写的', () => {
  assert.equal(C('write', { time: 'past', aspect: 'perfect' }), 'had written');
  assert.equal(C('write', { time: 'future', aspect: 'progressive' }), 'will be writing');
  assert.equal(C('write', { time: 'present', aspect: 'simple' }), 'writes');
  assert.throws(() => C('write', { time: 'past perfect' }), /过去 \/ 现在 \/ 将来 \/ 过去将来/);
  assert.throws(() => C('write', { aspect: '完了' }), /一般 \/ 进行 \/ 完成 \/ 完成进行/);
  assert.throws(() => C('write', { subject: 'the boy' }), /单 \/ 复/);
});
