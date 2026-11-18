// 外部交给页面的后台活（需求 R2）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkJob, pendingJobs, jobPrompt, jobOutDoc, jobCounts, JOB_STALE_MS } from '../kit/src/project/jobs.js';

test('写法：prompt、out、see、tools', () => {
  const r = checkJob({ prompt: '改编', out: 'drafts/a1', see: ['books/B43/chunks/B43-1'] });
  assert.deepEqual(r.job, { prompt: '改编', see: ['books/B43/chunks/B43-1'], out: 'drafts/a1', tools: ['read', 'list', 'search'] });
  assert.match(checkJob({ out: 'a/b' }).error, /prompt/);
  assert.match(checkJob({ prompt: 'x', out: 'a' }).error, /双数/);
  assert.match(checkJob({ prompt: 'x', out: 'a/b', see: ['books'] }).error, /路径/);
  assert.match(checkJob({ prompt: 'x', out: 'a/b', tools: ['write'] }).error, /只读/);
});

test('该跑的：新的、queued、断在中间的', () => {
  const now = 10 * JOB_STALE_MS;
  const docs = [{ id: 'b', at: 2 }, { id: 'a', at: 1, status: 'queued' }, { id: 'c', status: 'done' }, { id: 'd', status: 'running', startedAt: now - 1000 }, { id: 'e', status: 'running', startedAt: 0, at: 3 }];
  assert.deepEqual(pendingJobs(docs, now).map((d) => d.id), ['a', 'b', 'e']);
  assert.deepEqual(jobCounts(docs), { queued: 2, running: 2, done: 1, failed: 0 });
});

test('给它的那一条和存下的', () => {
  const p = jobPrompt({ prompt: '读 5 条改编成题', out: 'drafts/x', tools: ['read'] }, [{ path: 'books/B43/chunks/B43-1', data: { text: '原文' } }, { path: 'a/b', data: null }]);
  assert.match(p, /读 5 条改编成题/);
  assert.match(p, /原文/);
  assert.match(p, /没有这一条/);
  assert.match(p, /drafts\/x/);
  assert.doesNotMatch(p, /[他她]/);
  assert.deepEqual(jobOutDoc({ id: 'j1', text: 'md', model: 'm', at: 1 }), { text: 'md', job: 'j1', by: 'ext-delegate', model: 'm', at: 1 });
});
