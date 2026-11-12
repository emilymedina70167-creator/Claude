// tools/exam.mjs：split / syllabus / check / apply 四个子命令（用假的转写跑）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { planInbox } from '../kit/src/exam/inbox.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FX = join(ROOT, 'tests/fixtures/exam');
const run = (...args) => spawnSync('node', [join(ROOT, 'tools/exam.mjs'), ...args], { encoding: 'utf8' });

test('split：好的卷写出 47 题，退出码 0；少一题退出码 1、说少了哪一题', () => {
  const out = mkdtempSync(join(tmpdir(), 'exam-'));
  const r = run('split', '--subject', '408', '--year', '2019', '--paper', join(FX, '408-2019.paper.txt'), '--answers', join(FX, '408-2019.answers.txt'), '--out', out, '--source', 'repo/408-2019.pdf');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(readFileSync(join(out, 'X-408-2019.json'), 'utf8'));
  assert.equal(j.questions.length, 47);
  assert.equal(j.paper.source, 'repo/408-2019.pdf');
  const cut = join(out, 'cut.txt');
  writeFileSync(cut, readFileSync(join(FX, '408-2019.paper.txt'), 'utf8').replace(/--- 题 47[\s\S]*$/, ''));
  const r2 = run('split', '--subject', '408', '--year', '2018', '--paper', cut, '--answers', join(FX, '408-2019.answers.txt'), '--out', out);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /少了第 47 题/);
});

test('syllabus、check、apply：考点树、检查报每卷几题几分、收件箱记录照 planInbox 预演会收', () => {
  const out = mkdtempSync(join(tmpdir(), 'exam-'));
  assert.equal(run('split', '--subject', '408', '--year', '2019', '--paper', join(FX, '408-2019.paper.txt'), '--answers', join(FX, '408-2019.answers.txt'), '--out', out).status, 0);
  const s = run('syllabus', '--course', 'DS', '--year', '2026', '--text', join(FX, 'ds-2026.syllabus.txt'), '--out', out);
  assert.equal(s.status, 0, s.stdout + s.stderr);
  assert.ok(existsSync(join(out, 'syllabus-DS-2026.json')));
  const c = run('check', out);
  assert.equal(c.status, 0, c.stdout + c.stderr);
  assert.match(c.stdout, /X-408-2019：47 题 150 分/);
  assert.match(c.stdout, /DS 2026：8 个考点/);
  const inbox = join(out, 'inbox');
  const a = run('apply', out, '--out', inbox, '--by', 'dev');
  assert.equal(a.status, 0, a.stdout + a.stderr);
  const rec = JSON.parse(readFileSync(join(inbox, 'X-408-2019.json'), 'utf8'));
  assert.equal(rec.kind, 'paper');
  assert.equal(rec.by, 'dev');
  assert.equal(planInbox(rec, { have: new Map() }).log.ok, true);
  const batches = JSON.parse(readFileSync(join(inbox, 'batches.json'), 'utf8'));
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].map((w) => w.doc_id).sort(), ['X-408-2019', 'syllabus-DS-2026']);
  assert.ok(batches[0].every((w) => w.op === 'set' && w.collection === 'exam_inbox'));
});

test('check：一卷被改坏了不放行', () => {
  const out = mkdtempSync(join(tmpdir(), 'exam-'));
  run('split', '--subject', '408', '--year', '2019', '--paper', join(FX, '408-2019.paper.txt'), '--answers', join(FX, '408-2019.answers.txt'), '--out', out);
  const f = join(out, 'X-408-2019.json');
  const j = JSON.parse(readFileSync(f, 'utf8'));
  j.questions[0].points = 5;
  writeFileSync(f, JSON.stringify(j));
  const c = run('check', out);
  assert.equal(c.status, 1);
  assert.match(c.stdout, /第 1 题是 5 分/);
  assert.equal(run('apply', out, '--out', join(out, 'inbox')).status, 1);
});
