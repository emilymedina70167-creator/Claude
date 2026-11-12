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

test('打标签：tagprep 出两份一样的单子 → 写假的甲乙 → tagmerge 算一致率 → tagapply 写回、门课照主考点', () => {
  const out = mkdtempSync(join(tmpdir(), 'exam-'));
  run('split', '--subject', '408', '--year', '2019', '--paper', join(FX, '408-2019.paper.txt'), '--answers', join(FX, '408-2019.answers.txt'), '--out', out);
  const syl = join(out, 'syl');
  run('syllabus', '--course', 'DS', '--year', '2026', '--text', join(FX, 'ds-2026.syllabus.txt'), '--out', syl);
  const tg = join(out, 'tag');
  const p = run('tagprep', out, '--syllabus', syl, '--out', tg, '--per', '50', '--course', 'DS');
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const prompt = readFileSync(join(tg, 'b001.prompt.txt'), 'utf8');
  assert.match(prompt, /Q-408-2019-1\b/);
  const ids = JSON.parse(readFileSync(join(tg, 'b001.json'), 'utf8')).ids;
  assert.ok(ids.includes('Q-408-2019-1') && !ids.includes('Q-408-2019-30'), '只出数据结构那几道');
  const line = (id, s) => `题 ${id}｜${s}｜process｜3｜一般｜坑：`;
  writeFileSync(join(tg, 'b001.a.txt'), ids.map((id) => line(id, 'G-DS-1.2.1')).join('\n'));
  writeFileSync(join(tg, 'b001.b.txt'), ids.map((id, i) => line(id, i === 0 ? 'G-DS-1.1' : 'G-DS-1.2.1')).join('\n'));
  const m = run('tagmerge', tg);
  assert.equal(m.status, 0, m.stdout + m.stderr);
  assert.match(m.stdout, /一致率/);
  assert.ok(existsSync(join(tg, 'conflicts.prompt.txt')));
  writeFileSync(join(tg, 'conflicts.out.txt'), line(ids[0], 'G-DS-1.1'));
  const a = run('tagapply', tg, out);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  const j = JSON.parse(readFileSync(join(out, 'X-408-2019.json'), 'utf8'));
  assert.deepEqual(j.questions.find((q) => q.id === ids[0]).tags.syl, ['G-DS-1.1']);
  assert.deepEqual(j.questions.find((q) => q.id === ids[1]).tags.syl, ['G-DS-1.2.1']);
  assert.equal(j.questions.find((q) => q.id === ids[1]).course, 'DS');
});

test('split 自动验算：题上写了 check 的算一遍，对不上的报出来', () => {
  const out = mkdtempSync(join(tmpdir(), 'exam-'));
  const paper = readFileSync(join(FX, '408-2019.paper.txt'), 'utf8').replace('假题 23：', '假题 23：【check: 2^10】');
  const ans = readFileSync(join(FX, '408-2019.answers.txt'), 'utf8');
  const pf = join(out, 'p.txt');
  writeFileSync(pf, paper.replace('C. 选项 C23', 'C. 1024'));
  const r = run('split', '--subject', '408', '--year', '2019', '--paper', pf, '--answers', join(FX, '408-2019.answers.txt'), '--out', out);
  assert.equal(r.status, 0, r.stdout);
  const j = JSON.parse(readFileSync(join(out, 'X-408-2019.json'), 'utf8'));
  const q = j.questions.find((x) => x.n === 23);
  assert.deepEqual(q.check, { expr: '2^10' });
  assert.ok(!q.stem.includes('check'));
  assert.deepEqual(q.verified, { how: 'exact', ok: true });
  writeFileSync(pf, paper);
  const r2 = run('split', '--subject', '408', '--year', '2019', '--paper', pf, '--answers', join(FX, '408-2019.answers.txt'), '--out', out);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /Q-408-2019-23.*算出来是 1024/);
});
