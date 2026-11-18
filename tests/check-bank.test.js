// 检验：题库（同一道题一个编号、retry 存成题库编号）、复测排期、挑题、拼复测的 check（kit/src/check/bank.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck, selfCheck } from '../kit/src/check/spec.js';
import { bankId, bankDocs, seenPatch, retestDates, dueRetests, pickRetest, retestCheck, fenceOf } from '../kit/src/check/bank.js';

const F = '```';
const rec = (id, text, { retry = [] } = {}) => `${F}recall\nid: ${id}\nq: ${text}\ntarget: L2-56\nlevel: 核心\nmust m1: 要点 ${text}\nteach default: 补讲 ${text}\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const checkWith = (tag) => {
  const body = ['block L2.1.4 must=p1', 'spare p9', rec('p1', `${tag} 本题`, { retry: ['p1a', 'p1b'] }), rec('p1a', `${tag} 同构一`), rec('p1b', `${tag} 同构二`), rec('p9', `${tag} 备用`)].join('\n');
  const { check, errors } = parseCheck(`check id=${tag}`, body);
  assert.deepEqual(errors, []);
  return check;
};
const asBank = (docs) => docs.map(({ id, doc }) => ({ id, ...doc }));

test('bankId：同一道题多一个尾随空格、换了局部 id 还是同一个编号；12 位十六进制', () => {
  const a = '```recall\nid: p1\nq: 题\ntarget: x\nlevel: 核心\nmust m1: 一\n```';
  const b = '```recall\nid: q7   \nq: 题  \ntarget: x\nlevel: 核心\nmust m1: 一\n```\n';
  assert.match(bankId(a), /^pr-[0-9a-f]{12}$/);
  assert.equal(bankId(a), bankId(b));
  assert.notEqual(bankId(a), bankId(a.replace('题', '别的题')));
});

test('bankDocs：每道题一条，retry 存成题库编号，标出是本题、retry 还是备用', () => {
  const k1 = checkWith('k1');
  const docs = bankDocs(k1, { session: 'c-1', at: 1 });
  assert.equal(docs.length, 4);
  const p1 = docs.find((d) => d.doc.fence.includes('k1 本题'));
  const p1a = docs.find((d) => d.doc.fence.includes('k1 同构一'));
  assert.deepEqual(p1.doc.from, { session: 'c-1', check: 'k1', as: 'probe' });
  assert.equal(p1a.doc.from.as, 'retry');
  assert.equal(docs.find((d) => d.doc.fence.includes('k1 备用')).doc.from.as, 'spare');
  assert.equal(p1.doc.retryBank.length, 2);
  assert.equal(p1.doc.retryBank[0], p1a.id);
  assert.equal(p1.doc.family, 'L2.1.4/L2-56');
  assert.deepEqual(p1.doc.seen, []);
  assert.equal(fenceOf(k1.probes.p1), p1.doc.fence);
});

test('两次检验都有 p1：retry 的编号各是各的；复测同时挑到两道，拼出来的 check 没错、retry 都在', () => {
  const d1 = bankDocs(checkWith('k1'), { session: 'c-1', at: 1 });
  const d2 = bankDocs(checkWith('k2'), { session: 'c-2', at: 2 });
  const all = [...d1, ...d2];
  assert.equal(new Set(all.map((d) => d.id)).size, 8);
  const p1k1 = d1.find((d) => d.doc.fence.includes('k1 本题'));
  const p1k2 = d2.find((d) => d.doc.fence.includes('k2 本题'));
  assert.notDeepEqual(p1k1.doc.retryBank, p1k2.doc.retryBank);
  const bank = asBank(all);
  const r = retestCheck({ id: 'rt1', items: [p1k1.id, p1k2.id], bank, retests: [{ block: 'L2.1.4', days: 1 }] });
  assert.deepEqual(r.dropped, []);
  const { check, errors } = parseCheck(r.head, r.body);
  assert.deepEqual(errors, []);
  assert.deepEqual(selfCheck(check), []);
  assert.deepEqual(check.blocks[0].must, ['r1', 'r2']);
  assert.deepEqual(check.probes.r1.retry, ['r1a', 'r1b']);
  assert.deepEqual(check.probes.r2.retry, ['r2a', 'r2b']);
  assert.match(check.probes.r1b.q, /k1 同构二/);
  assert.match(check.probes.r2a.q, /k2 同构一/);
  assert.equal(r.bankOf.r1, p1k1.id);
  assert.equal(r.bankOf.r2b, p1k2.doc.retryBank[1]);
});

test('retestCheck：retry 指到题库里没有的题 → 那一道拿掉、记原因，别的照拼', () => {
  const d1 = asBank(bankDocs(checkWith('k1'), { session: 'c-1', at: 1 }));
  const p1 = d1.find((d) => d.fence.includes('k1 本题'));
  const spare = d1.find((d) => d.fence.includes('k1 备用'));
  const broken = { ...p1, id: 'pr-000000000000', retryBank: ['pr-ffffffffffff', p1.retryBank[1]] };
  const r = retestCheck({ id: 'rt1', items: [broken.id, spare.id], bank: [...d1, broken], retests: [{ block: 'L2.1.4', days: 1 }] });
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].id, 'pr-000000000000');
  assert.match(r.dropped[0].why, /pr-ffffffffffff/);
  const { check, errors } = parseCheck(r.head, r.body);
  assert.deepEqual(errors, []);
  // 备用题没有 retry：复测里照样能出（不要求 retry 至少 2 道）
  assert.deepEqual(check.blocks[0].must, ['r1']);
  assert.deepEqual(selfCheck(check, {}, { lenient: true }), []);
});

test('seenPatch 追加一次', () => {
  assert.deepEqual(seenPatch({ seen: [{ at: 1, session: 'a', as: 'first' }] }, { at: 2, session: 'b', as: 'retest' }).seen.length, 2);
  assert.deepEqual(seenPatch({}, { at: 2, session: 'b', as: 'retry' }).seen, [{ at: 2, session: 'b', as: 'retry' }]);
});

test('retestDates：1 天、7 天，跨月', () => {
  assert.deepEqual(retestDates('2026-11-18'), [{ days: 1, due: '2026-11-19', done: null }, { days: 7, due: '2026-11-25', done: null }]);
  assert.deepEqual(retestDates('2026-11-28').map((x) => x.due), ['2026-11-29', '2026-12-05']);
});

test('dueRetests：到期的、每块只取最早一次没做的', () => {
  const absorbs = [
    { block: 'L2.1.4', retests: [{ days: 1, due: '2026-11-19', done: null }, { days: 7, due: '2026-11-25', done: null }] },
    { block: 'L2.1.1', retests: [{ days: 1, due: '2026-11-19', done: '2026-11-19' }, { days: 7, due: '2026-11-25', done: null }] },
  ];
  assert.deepEqual(dueRetests(absorbs, '2026-11-18'), []);
  assert.deepEqual(dueRetests(absorbs, '2026-11-19'), [{ block: 'L2.1.4', days: 1, due: '2026-11-19' }]);
  assert.deepEqual(dueRetests(absorbs, '2026-11-26'), [{ block: 'L2.1.4', days: 1, due: '2026-11-19' }, { block: 'L2.1.1', days: 7, due: '2026-11-25' }]);
});

test('pickRetest：不挑这次检验的 retry、挑备用；retryOwed 先放；一类没有就记缺', () => {
  const docs = asBank(bankDocs(checkWith('k1'), { session: 'c-1', at: 1 }));
  const seenOf = (frag) => docs.find((d) => d.fence.includes(frag));
  // 本题见过了
  seenOf('k1 本题').seen = [{ at: 1, session: 'c-1', as: 'first' }];
  const absorbs = [{ block: 'L2.1.4', check: 'k1', session: 'c-1', families: ['L2.1.4/L2-56'], retryOwed: [] }];
  const due = [{ block: 'L2.1.4', days: 1, due: '2026-11-19' }];
  const r = pickRetest({ due, bank: docs, absorbs });
  assert.deepEqual(r.items, [seenOf('k1 备用').id]);
  assert.deepEqual(r.missing, []);
  // retryOwed 里的在最前（它是这次检验的 retry，外部改判以后欠着的，照样出）
  const owed = seenOf('k1 同构二').id;
  const r2 = pickRetest({ due, bank: docs, absorbs: [{ ...absorbs[0], retryOwed: [owed] }] });
  assert.equal(r2.items[0], owed);
  // 备用也见过了：缺新题
  seenOf('k1 备用').seen = [{ at: 2 }];
  const r3 = pickRetest({ due, bank: docs, absorbs });
  assert.deepEqual(r3.items, []);
  assert.equal(r3.missing[0].family, 'L2.1.4/L2-56');
});
