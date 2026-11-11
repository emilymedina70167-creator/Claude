// 查「叫老师的那一条里必须有」（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 13 节的表）：页面算得出的事实
// （秩、读回的矛盾行、拨数的路、量、错法……）真的到了老师手上。照表跑那几幕（tools/stage-try.mjs --json），在每一步叫老师时发过去的整条
// （called.msg）和最后一步还攒着没发出去的那一段（pending：幕末尾学生最后几下没叫老师时，事实只在这里）里查；竖屏、横屏都要有。
// 表和查法在 tools/stage-try-lib.js（MUST、mustHits、goalsMetWhere，有测试）；表里一行写了几幕、标了 anyOf 的（E2 第 6 幕、分支 1，E3 第 8 幕），
// 每一条几幕里有一幕有就算。
//   node tools/stage-must.mjs 目录                    目录下是 L2/分支3.txt、D2/幕5.txt……（evals/stage-gaps/try3）
//   --from 结果.json                                  不重跑：拿已经跑好的 tools/stage-try.mjs --json（照 path 认是哪一幕）
//   --save 结果.json                                  跑完把试演的结果存下来（之后改了表、查法可以 --from 再查，不用重跑）
//   --jobs 4                                          同时开几个试演（每个开一个浏览器；默认 4）
// 每条打 ✓ / ✗；有 ✗（或者表里的那一幕不在目录里、没跑完）退出码 1，都过了 0，用法写错 2
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUST, FIX1, mustHits, mustNotHits, seenHits, auditHits, screenHits, goalsMetWhere } from './stage-try-lib.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = { dir: '', from: '', save: '', jobs: 4, table: 'must' };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from') opt.from = resolve(args[++i]);
  else if (args[i] === '--save') opt.save = resolve(args[++i]);
  else if (args[i] === '--jobs') opt.jobs = Math.max(1, Number(args[++i]) || 1);
  else if (args[i] === '--table') opt.table = args[++i];
  else opt.dir = resolve(args[i]);
}
if (!opt.dir) { console.error('用法：node tools/stage-must.mjs 目录 [--from 结果.json | --save 结果.json] [--jobs 4]'); process.exit(2); }

const fileOf = (f) => join(opt.dir, ...f.split('/'));
if (!['must', 'fix1'].includes(opt.table)) { console.error('--table 只有 must（默认）和 fix1'); process.exit(2); }
const TABLE = opt.table === 'fix1' ? FIX1 : MUST;
const names = [...new Set(TABLE.flatMap((m) => m.files))];
const have = names.filter((f) => existsSync(fileOf(f)));
// 一幕的结果照 path 认（tools/stage-try.mjs 写的是对仓库根目录的相对路径）
const norm = (p) => String(p || '').split(sep).join('/');

// 跑试演：几幕分成几组同时跑（一幕两种朝向、一步一秒多，一组一个浏览器）。页面报错时 stage-try 退出码 2，JSON 照样在
const runTry = (files) => new Promise((done) => {
  execFile('node', [join(ROOT, 'tools/stage-try.mjs'), ...files, '--json'], { encoding: 'utf8', maxBuffer: 1 << 30 }, (err, out, errOut) => {
    try { done(JSON.parse(out)); } catch { done(files.map((f) => ({ file: f, path: norm(relative(ROOT, f)), views: [], failed: String(errOut || err?.message || '没有输出').trim().split('\n')[0] }))); }
  });
});
let results;
if (opt.from) {
  try { results = JSON.parse(readFileSync(opt.from, 'utf8')); } catch (err) { console.error(`读不了 ${opt.from}：${err.message}`); process.exit(2); }
} else {
  const groups = Array.from({ length: Math.min(opt.jobs, have.length) }, () => []);
  have.forEach((f, i) => groups[i % groups.length].push(fileOf(f)));
  results = (await Promise.all(groups.map(runTry))).flat();
  if (opt.save) writeFileSync(opt.save, JSON.stringify(results, null, 2));
}
const byPath = new Map(results.map((r) => [norm(r.path), r]));
// --from 的那一份可能是从别的目录跑的：照目录里的相对路径（L2/分支3.txt）认
const find = (f) => byPath.get(norm(relative(ROOT, fileOf(f)))) || results.find((r) => norm(r.path).endsWith(`/${f}`));

const out = [`# ${opt.table === 'fix1' ? '修好的页面毛病不许回来' : '叫老师的那一条里必须有'}（${norm(relative(ROOT, opt.dir)) || opt.dir}）`];
let bad = 0;
const line = (ok, text) => { out.push(`${ok ? '✓' : '✗'} ${text}`); if (!ok) bad++; };
const where = (h) => `第 ${h.step + 1} 步${h.where === 'called' ? '叫老师' : '还攒着'}`;
// 一幕在不在、跑没跑完：跑完了交它的几个视口
const viewsOf = (f) => {
  if (!existsSync(fileOf(f))) { line(false, `${f}：目录里没有这一幕`); return null; }
  const r = find(f);
  const views = r?.views || [];
  if (!views.length || views.some((v) => !v.steps?.length)) { line(false, `${f}：试演没跑完${r?.failed ? `：${r.failed}` : ''}`); return null; }
  const stopped = views.filter((v) => v.stopped).map((v) => `${v.tag}：${v.stopped}`);
  if (stopped.length) out.push(`（${f} ${stopped.join('；')}）`);
  return views;
};
// 一幕里一条事实：每个视口都要有（竖屏、横屏）
const hitsIn = (views, re) => views.map((v) => ({ tag: v.tag, hits: mustHits(v.steps, re) }));
const hitText = (per) => per.map((p) => (p.hits.length ? `${p.tag}${where(p.hits[0])}${p.hits.length > 1 ? `（共 ${p.hits.length} 处）` : ''}` : `${p.tag}没有`)).join('；');
// fix1 的表：一行一条毛病。每个视口都要过
const stepsText = (list) => `第 ${list.map((i) => i + 1).join('、')} 步`;
for (const m of opt.table === 'fix1' ? FIX1 : []) {
  out.push('', `## ${m.id}（${m.files.join('、')}）`);
  let views = m.files.flatMap((f) => viewsOf(f) || [null]);
  if (views.some((v) => !v)) continue;
  if (m.views) views = views.filter((v) => m.views.includes(v.tag));
  const each = (list, name, fn) => { for (const c of list || []) { const per = views.map((v) => ({ tag: v.tag, r: fn(v.steps, c.re) })); line(per.every((p) => p.r.ok), `${name}${c.what}：${per.map((p) => `${p.tag}${p.r.text}`).join('；')}`); } };
  each(m.checks, '必须有 ', (steps, re) => { const h = seenHits(steps, re); return { ok: h.length > 0, text: h.length ? stepsText(h) : '没有' }; });
  each(m.called, '发给老师的那条里必须有 ', (steps, re) => { const h = mustHits(steps, re); return { ok: h.length > 0, text: h.length ? where(h[0]) : '没有' }; });
  each(m.nots, '不许有 ', (steps, re) => { const h = mustNotHits(steps, re); return { ok: !h.length, text: h.length ? `${stepsText([...new Set(h.map((x) => x.step))])}有（${h[0].where}）` : '没有' }; });
  each(m.audit, '排版必须报 ', (steps, re) => { const h = auditHits(steps, re); return { ok: h.length > 0, text: h.length ? stepsText(h) : '没报' }; });
  each(m.screen, '屏幕上必须有 ', (steps, re) => { const h = screenHits(steps, re, { last: true }); return { ok: h.length > 0, text: h.length ? '有' : '没有' }; });
  each(m.noScreen, '屏幕上不许有 ', (steps, re) => { const h = screenHits(steps, re, { last: true }); return { ok: !h.length, text: h.length ? '有' : '没有' }; });
  each(m.noAudit, '排版不许报 ', (steps, re) => { const h = auditHits(steps, re); return { ok: !h.length, text: h.length ? `${stepsText(h)}报了` : '没报' }; });
}
for (const m of opt.table === 'must' ? MUST : []) {
  out.push('', `## ${m.files.join('、')}${m.anyOf ? `（每一条 ${m.files.length} 幕里有一幕有就算）` : ''}`);
  const runs = m.files.map((f) => ({ f, views: viewsOf(f) }));
  if (runs.some((x) => !x.views)) continue;
  for (const c of m.checks) {
    const per = runs.map((x) => ({ f: x.f, per: hitsIn(x.views, c.re) }));
    const okOf = (x) => x.per.every((p) => p.hits.length);
    if (m.anyOf) {
      const got = per.filter(okOf);
      line(got.length > 0, `${c.what}：${got.length ? got.map((x) => `${x.f}（${hitText(x.per)}）`).join('；') : `${m.files.length} 幕都没有（${per.map((x) => `${x.f}：${hitText(x.per)}`).join('；')}）`}`);
    } else line(okOf(per[0]), `${c.what}：${hitText(per[0].per)}`);
  }
  if (m.noMetAt) {
    for (const x of runs) {
      const per = x.views.map((v) => ({ tag: v.tag, at: goalsMetWhere(v.steps, m.noMetAt.re) }));
      line(per.every((p) => !p.at.length), `${m.noMetAt.what}：${per.map((p) => (p.at.length ? `${p.tag}第 ${p.at.map((i) => i + 1).join('、')} 步做到了` : `${p.tag}没有`)).join('；')}`);
    }
  }
}
out.push('', bad ? `${bad} 条 ✗` : '都 ✓');
// 写完了再退出（写进管道时 stdout 是异步的，直接 process.exit 会截掉后面的）
process.stdout.write(`${out.join('\n')}\n`, () => process.exit(bad ? 1 : 0));
