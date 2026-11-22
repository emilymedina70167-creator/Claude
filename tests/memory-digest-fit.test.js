// 记忆摘要装得下这节课真正要用的（2026-11-03 用真数据量出来的毛病）：
// 通用规则再多，这一块（和最近两节课）的错题、弱点、掌握、关于我一定在全文里；规则装不下的进目录；
// 提到学生不用「他」「她」；失误按它那节课分科；点进课看一眼不算「有动静」
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { memoryDigest, neutral } = await import('../kit/src/memory/digest.js');
const { MEMORY_BUDGET } = await import('../kit/src/class/prompt.js');
const { slipsToFold } = await import('../kit/src/memory/memo.js');
const { lastActivity } = await import('../kit/src/memory/report.js');
const { sharedFor } = await import('../kit/src/memory/space.js');
const enc = (s) => new TextEncoder().encode(s).length;

// 和真数据一样重：66 条通用规则（每条 250 字节左右）、12 条守则、关于我 25 条
function heavy() {
  const filler = (n) => '这是一条很长的通用规则，讲怎么讲课、怎么出题、怎么记录，'.repeat(n);
  const cats = ['红线', '讲解', '教法', '黑板', '掌握', '检验', '细则', '来源'];
  const rules = Array.from({ length: 66 }, (_, i) => ({ id: `rule-g-${i + 1}`, cat: cats[i % cats.length], text: `第 ${i + 1} 条：${filler(3)}`, since: '2026-10-01', source: '我', status: 'active' }));
  rules.push({ id: 'rule-g-red7', cat: '检验', text: '【红线7】检验题必须同时满足三条，缺一作废。', since: '2026-10-01', source: '我', status: 'active' });
  const lessons = Array.from({ length: 12 }, (_, i) => ({ id: `T-${i + 1}`, text: `守则 ${i + 1}：${filler(4)}`, since: '2026-10-01', status: 'active' }));
  const profile = Array.from({ length: 25 }, (_, i) => ({ id: `p-x${i}`, topic: '讲法', text: `关于我 ${i}：喜欢先看例子再看规则。` }));
  profile.push({ id: 'p-en-vocab', topic: '习惯', text: '在用闪卡背词，三档。' });
  profile.push({ id: 'p-cs-log', topic: '讲法', text: '他对 log 没有直觉，其他的还好。' });
  const curriculum = [{ id: 'EN-L1.1.1', title: '五种句型', level: 'block' }, { id: 'EN-L1.2.1', title: '时态', level: 'block' }, { id: 'EN-L3.1.1', title: '非谓语', level: 'block' }];
  // 这一块的 3 道错题；上一节课记错了块（记在第三章）的 6 道
  const err = (id, block, session, date) => ({ id, block, session, date, source: '课堂', q: `题面 ${id}：${'The computer is the culture machine. '.repeat(6)}`, mine: `写的 ${id}`, step: '判句型', cause: `根因 ${id}：${'没先查系动词表，'.repeat(8)}` });
  const errors = [
    err('EN-L1-01', 'EN-L1.2.1', null, '2026-08-28'), err('EN-L1-02', 'EN-L1.2.1', null, '2026-08-28'), err('EN-L1-03', 'EN-L1.2.1', null, '2026-08-29'),
    ...[2, 3, 4, 5, 6, 7].map((n) => err(`EN-L3-0${n}`, 'EN-L3.1.1', 'c-20261102-1', '2026-11-02')),
  ];
  const weaknesses = [
    { id: 'W40', title: '谓语认不准', scope: '通用', level: 'L0', errors: ['EN-L1-01'], blocks: ['EN-L1.2.1'], space: 'en' },
    { id: 'W44', title: '判句型不先查系动词表', scope: '链条', level: 'L0', blocks: ['EN-L3.1.1'], basis: ['ev-1'], space: 'en' },
  ];
  const sessions = [
    { id: 'c-20261102-1', date: '2026-11-02', block: 'EN-L3.1.1', space: 'en', status: 'closed', startedAt: 2, report: { items: 28, line: '28 题' }, skills: { items: [{ k: 'a', p: 'EN-L1.1.1#linking', w: 'W44' }], sum: {} } },
    { id: 'c-20261103-1', date: '2026-11-03', block: 'EN-L1.2.1', space: 'en', status: 'open', startedAt: 3 },
  ];
  const mastery = [{ id: 'EN-L1.2.1', state: '讲过', basis: ['x'] }];
  const position = [{ id: 'now-en', block: 'EN-L1.2.1', next: '接着讲一般现在时' }];
  const slips = [{ id: 'S-20261103-1-1', by: 'class', date: '2026-11-03', text: '一下子写了太多', session: 'c-20261103-1' }];
  return { rules, lessons, profile, curriculum, errors, weaknesses, sessions, mastery, position, slips };
}

test('通用规则再多，这一块和最近两节课的错题、弱点、掌握、关于我都在全文里；整份不超预算', () => {
  const mem = heavy();
  const d = memoryDigest(mem, { block: 'EN-L1.2.1', session: 'c-20261104-1', budget: MEMORY_BUDGET });
  assert.ok(d.bytes <= MEMORY_BUDGET, `${d.bytes} 字节超过 ${MEMORY_BUDGET}`);
  // 错题原文最多 8 道（ERRORS_FULL）：这一块的和最近一节课的，最新的在前；最早的那道进目录
  for (const id of ['EN-L1-02', 'EN-L1-03', 'EN-L3-02', 'EN-L3-03', 'EN-L3-04', 'EN-L3-05', 'EN-L3-06', 'EN-L3-07']) assert.match(d.text, new RegExp(`题面 ${id}`), `${id} 的原文不在全文里`);
  assert.doesNotMatch(d.text, /题面 EN-L1-01/);
  assert.match(d.text, /EN-L1-01/, '最早的那道在目录里');
  assert.match(d.text, /- W40 谓语认不准/);
  assert.match(d.text, /- W44 判句型不先查系动词表/, '最近一节课挂上的弱点（块记在别处）也在');
  assert.match(d.text, /## 掌握状态[\s\S]*EN-L1\.2\.1：讲过/);
  assert.match(d.text, /## 学生（profile）[\s\S]*在用闪卡背词/);
  assert.match(d.text, /## 上一节停在哪[\s\S]*接着讲一般现在时/);
  // 规则装不下的进目录，不是丢了
  assert.ok(d.cut.some((c) => c.coll === 'rules'), '规则太多时有一部分进目录');
  assert.match(d.text, /rule-g-/, '目录里有进不了全文的规则的编号');
  // 正文写着【红线…】的按红线排：一定在全文里
  assert.match(d.rules, /【红线7】/);
});

test('提到学生不用「他」「她」：记忆原文里的换成「学生」，「其他」「他们」不动；408 的关于我不进英语课', () => {
  assert.equal(neutral('他对 log 没有直觉，其他的还好；他们说她也会'), '学生对 log 没有直觉，其他的还好；他们说学生也会');
  const mem = heavy();
  const en = memoryDigest(mem, { block: 'EN-L1.2.1', budget: MEMORY_BUDGET });
  assert.doesNotMatch(en.text + en.rules, /log 没有直觉/, '408 的不进英语课');
  const cs = memoryDigest({ ...mem, curriculum: [{ id: 'DS-L8.2.1', title: '排序', level: 'block' }], position: [] }, { block: 'DS-L8.2.1', budget: MEMORY_BUDGET });
  assert.match(cs.text, /学生对 log 没有直觉，其他的还好/);
  assert.doesNotMatch(cs.text + cs.rules, /(?<![其吉利])[他她](?![们人])/);
});

test('失误按它那节课分科：英语课记的不跟着数学、408 下课整理', () => {
  const mem = heavy();
  assert.match(slipsToFold(mem, 'en'), /一下子写了太多/);
  assert.equal(slipsToFold(mem, 'math'), '');
  assert.equal(sharedFor(mem.slips, 'cs', mem).length, 0);
  assert.equal(sharedFor(mem.slips, 'cs').length, 1, '不给 mem 时照旧当不分科');
});

test('点进课看一眼不算有动静：只看作答、说话这些', () => {
  const s = { id: 'c-1', startedAt: 1000 };
  const evs = [{ session: 'c-1', src: 'record', at: 5000 }, { session: 'c-1', src: 'event', kind: 'open', at: 9000 }, { session: 'c-1', src: 'event', kind: 'end', at: 9500 }, { session: 'c-2', src: 'say', at: 99999 }];
  assert.equal(lastActivity(s, evs), 5000);
  assert.equal(lastActivity(s, [{ session: 'c-1', src: 'say', at: 7000 }, ...evs]), 7000);
  assert.equal(lastActivity(s, []), 1000);
});

test('记忆的预算只许降、不许涨：每一轮都要带，多 1 KB 每一轮都多读 1 KB（会拖慢回复）', () => {
  assert.ok(MEMORY_BUDGET <= 28 * 1024, `MEMORY_BUDGET 是 ${MEMORY_BUDGET} 字节，不能超过 28 KiB`);
});
