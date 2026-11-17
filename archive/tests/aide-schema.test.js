// 第九轮第 1 批：学生卡、课前档案两类集合（kit/src/aide/schema.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAide, canWriteAide, AIDE_COLLECTIONS, cardId, crossId, AIDE_SPACES } from '../kit/src/aide/schema.js';
import { validateWrite } from '../kit/src/memory/writer.js';
import { canWrite } from '../kit/src/memory/schema.js';
import { backupFile } from '../kit/src/memory/backup.js';

test('学生卡守规矩时没有问题，编号不对报出来', () => {
  assert.deepEqual(validateAide('cards', 'DS-L8.2.1', { block: 'DS-L8.2.1', text: 'x', at: 1, src: 'a' }), []);
  assert.deepEqual(validateAide('cards', 'x-cs', { space: 'cs', text: 'x', at: 1, src: 'a' }), []);
  assert.match(validateAide('cards', 'foo', { block: 'foo', text: 'x', at: 1, src: 'a' }).join(), /编号/);
  assert.match(validateAide('aide_briefs', 'cs', { space: 'cs', blocks: ['DS-L8.2.1'], at: 1, sig: 's' }).join(), /text/);
  assert.deepEqual(validateAide('errors', 'L1-01', {}), []);
});

test('谁能写：页面、开发那边能写，课堂不能；不是助手的集合交给别处', () => {
  assert.equal(canWriteAide('class', 'cards'), false);
  assert.equal(canWriteAide('page', 'cards'), true);
  assert.equal(canWriteAide('chat', 'aide_briefs'), true);
  assert.equal(canWriteAide('page', 'errors'), null);
  assert.equal(canWrite('class', 'cards'), false);
  assert.equal(canWrite('page', 'aide_briefs'), true);
  assert.deepEqual(Object.keys(AIDE_COLLECTIONS).sort(), ['aide_briefs', 'cards']);
});

test('编号的写法', () => {
  assert.equal(cardId('DS-L8.2.1'), 'DS-L8.2.1');
  assert.equal(crossId('cs'), 'x-cs');
  assert.deepEqual(AIDE_SPACES, ['math', 'cs', 'en']);
});

test('写数据库的出口认学生卡', () => {
  assert.match(validateWrite('cards/x-cs', { space: 'cs', text: '', at: 1, src: '' }).join(), /text/);
  assert.deepEqual(validateWrite('cards/L2.1.4', { block: 'L2.1.4', text: 'y', at: 1, src: 'z' }), []);
});

test('备份带上学生卡和课前档案', () => {
  const b = backupFile({ aide: { cards: [{ id: 'L2.1.4', block: 'L2.1.4', text: 'y', at: 1, src: 'z' }], aide_briefs: [{ id: 'math', space: 'math', blocks: [], text: 't', at: 1, sig: 's' }] } });
  assert.ok(b.docs.some((d) => d.collection === 'cards' && d.doc_id === 'L2.1.4'));
  assert.ok(b.docs.some((d) => d.collection === 'aide_briefs' && d.doc_id === 'math'));
});
