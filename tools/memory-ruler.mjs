#!/usr/bin/env node
// 记忆的尺子（第十一轮，docs/superpowers/specs/2026-11-14-round11-design.md 第九节；说明 evals/memory/README.md）：
// 话的账在真课上重放——我打过的每一句，照真实的先后一批一批交给话的账（页面同一套函数 kit/src/memory/said.js 拼提示词、读回、算），
// 和开发标的标准答案比：每句有没有去处、要求漏了几件、把不是要求的记成要求几句、说了几遍的同一件事有没有并成一条。
//
//   node tools/memory-ruler.mjs next  <存数据的目录> --out <工作目录>   # 写出下一批的提示词（bNN.prompt.txt），交一个助手写 bNN.out.txt；
//                                                                         # 缺句的写 bNN.re.prompt.txt（只问缺的），写 bNN.re.out.txt
//   node tools/memory-ruler.mjs score <存数据的目录> --out <工作目录> [--gold 标准答案.json] [--note 这一次改了什么]
//
// 存数据的目录：ArtifactData list 存下来的（evidence/、sessions/{课}/class_turns/、lessons/），私人数据，放在 .superpowers/ 下面。
// 一批 = 时间上连着、同一节课的一串话（我会回到前几天的课接着上，所以按时间切，不按课）。每一批的「现在的要求」是前面几批
// 照助手的回答算出来的（和页面上线以后一样：前一节记错了，后一节就在错的上面接着记）。不给「关于我」：今天的 profile 里有后来才补的要求，
// 给了等于把答案递过去；上线以后 profile 只记事实。
import fs from 'node:fs';
import path from 'node:path';
import { saidItems, saidPrompt, parseSaid, planSaid, saidRecord } from '../kit/src/memory/said.js';

const [cmd, dataDir] = process.argv.slice(2);
const opt = {};
for (let i = 4; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) opt[process.argv[i].slice(2)] = process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i];
if (!['next', 'score'].includes(cmd) || !dataDir || !opt.out) { console.error('用法：node tools/memory-ruler.mjs next|score <存数据的目录> --out <工作目录>'); process.exit(2); }

const readDir = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) })) : []);
const evidence = readDir(path.join(dataDir, 'evidence')).map((e) => ({ ...e, id: e.id }));
const lessons = readDir(path.join(dataDir, 'lessons')).filter((l) => (l.status || 'active') === 'active');
const turnsOf = new Map();
const turns = (sid) => { if (!turnsOf.has(sid)) turnsOf.set(sid, readDir(path.join(dataDir, 'sessions', sid, 'class_turns')).map((t) => ({ ...t, seq: Number(t.seq || t.id) }))); return turnsOf.get(sid); };
fs.mkdirSync(opt.out, { recursive: true });
const file = (n, ext) => path.join(opt.out, `b${String(n).padStart(2, '0')}.${ext}`);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

// 按时间切成一批一批：换了一节课就是新的一批
const says = evidence.filter((e) => e.src === 'say').sort((a, b) => (a.at || 0) - (b.at || 0));
const batches = [];
for (const e of says) {
  const last = batches.at(-1);
  if (last && last.sid === e.session) last.evs.push(e);
  else batches.push({ sid: e.session, evs: [e] });
}

// 照已有的回答一批一批往下算：现在的要求、每句的去处
let recent = [];
function replay(upTo) {
  recent = [];
  let asks = [];
  const lines = {};
  const missing = [];
  const problems = [];
  for (let i = 0; i < upTo; i++) {
    const b = batches[i];
    const { items, photos } = saidItems(b.evs, b.sid, 0);
    for (const p of photos) lines[p] = [{ to: 'photo' }];
    const ids = new Set(items.map((x) => x.ev));
    const p1 = parseSaid(read(file(i, 'out.txt')) || '', { ids, asks });
    let got = p1.lines;
    let miss = p1.missing;
    problems.push(...p1.problems.map((x) => `b${i}：${x}`));
    const re = read(file(i, 're.out.txt'));
    if (miss.length && re != null) {
      const p2 = parseSaid(re, { ids: new Set(miss), asks });
      got = { ...got, ...p2.lines };
      miss = p2.missing;
      problems.push(...p2.problems.map((x) => `b${i} 补问：${x}`));
    }
    const plan = planSaid({ lines: got }, { items, asks, sid: b.sid, startedAt: items[0]?.at ?? 0, today: new Date(items[0]?.at || Date.now()).toISOString().slice(0, 10) });
    const byId = new Map(asks.map((a) => [a.id, a]));
    for (const a of plan.asks) byId.set(a.id, { id: a.id, ...a.doc });
    asks = [...byId.values()];
    Object.assign(lines, got);
    missing.push(...miss);
    b.record = saidRecord({ items, photos, lines: got, missing: miss, once: plan.once });
    recent.push(...plan.once.map((o) => ({ text: o.text, date: new Date(items[0]?.at || 0).toISOString().slice(0, 10) })));
    b.broken = plan.broken;
  }
  return { asks, lines, missing, problems };
}

if (cmd === 'next') {
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const out = read(file(i, 'out.txt'));
    const { asks } = replay(i);
    const { items } = saidItems(b.evs, b.sid, 0);
    if (out == null) {
      if (!items.length) { fs.writeFileSync(file(i, 'out.txt'), ''); continue; }
      fs.writeFileSync(file(i, 'prompt.txt'), saidPrompt({ items, asks, profile: [], lessons, turns: turns(b.sid), recent: [...recent] }));
      console.log(`下一批：${file(i, 'prompt.txt')}（${b.sid}，${items.length} 句）→ 回答写进 ${file(i, 'out.txt')}`);
      process.exit(0);
    }
    const p = parseSaid(out, { ids: new Set(items.map((x) => x.ev)), asks });
    if (p.missing.length && read(file(i, 're.out.txt')) == null) {
      const left = items.filter((x) => p.missing.includes(x.ev));
      fs.writeFileSync(file(i, 're.prompt.txt'), saidPrompt({ items: left, asks, profile: [], lessons, turns: turns(b.sid), earlier: p.lines, recent: [...recent] }));
      console.log(`第 ${i} 批缺 ${left.length} 句：${file(i, 're.prompt.txt')} → 回答写进 ${file(i, 're.out.txt')}`);
      process.exit(0);
    }
  }
  console.log(`${batches.length} 批都答完了：跑 score`);
}

if (cmd === 'score') {
  const gold = JSON.parse(fs.readFileSync(opt.gold || path.join(path.dirname(opt.out), 'gold.json'), 'utf8'));
  const r = replay(batches.length);
  const ASKY = new Set(['new', 'again', 'known', 'change']);
  const all = says.map((e) => e.id);
  const textOnly = all.filter((id) => !(r.lines[id] || []).some((l) => l.to === 'photo'));
  const covered = textOnly.filter((id) => r.lines[id]?.length);
  // 每句记成了哪几条要求（新建的、又说了的、改了的都算）：从最后的要求里按原话反查
  const askOf = new Map();
  for (const a of r.asks) for (const q of a.quotes || []) { if (!askOf.has(q.ev)) askOf.set(q.ev, new Set()); askOf.get(q.ev).add(a.id); }
  const asky = (id) => (r.lines[id] || []).some((l) => ASKY.has(l.to));
  const captured = new Set();
  for (const [id, g] of Object.entries(gold.labels)) if (g.cls !== 'not' && asky(id)) for (const n of g.names || []) captured.add(n);
  const missed = gold.required.filter((n) => !captured.has(n));
  const falseAsks = Object.entries(gold.labels).filter(([id, g]) => g.cls === 'not' && asky(id)).map(([id]) => id);
  const merge = (gold.merge || []).map((name) => {
    // 只看一定要记成要求的那几句（either 记不记、记到哪条都行，不算并没并）
    const evs = Object.entries(gold.labels).filter(([, g]) => g.cls === 'ask' && (g.names || [])[0] === name).map(([id]) => id);
    const live = new Set(evs.flatMap((id) => [...(askOf.get(id) || [])]).map((aid) => { let a = r.asks.find((x) => x.id === aid); while (a?.status === 'replaced' && a.into) a = r.asks.find((x) => x.id === a.into); return a?.status === 'active' ? a.id : null; }).filter(Boolean));
    return { name, said: evs.filter(asky).length, of: evs.length, asks: [...live] };
  });
  const brokenN = batches.reduce((s, b) => s + (b.broken || []).length, 0);
  const pass = covered.length === textOnly.length && !missed.length && falseAsks.length <= 2 && merge.every((m) => m.asks.length === 1);
  const say = (id) => (says.find((e) => e.id === id)?.text || '').slice(0, 40);
  console.log(`每句有去处：${covered.length}/${textOnly.length}${r.missing.length ? `（缺：${r.missing.join('、')}）` : ''}`);
  console.log(`要求漏了：${missed.length} 件${missed.length ? `（${missed.join('、')}）` : ''}`);
  console.log(`不是要求记成要求：${falseAsks.length} 句${falseAsks.length ? `\n${falseAsks.map((id) => `  - ${id} ${say(id)}`).join('\n')}` : ''}`);
  for (const m of merge) console.log(`「${m.name}」：${m.of} 句里 ${m.said} 句记成要求，落在 ${m.asks.length} 条在用的要求上（${m.asks.join('、') || '无'}）`);
  console.log(`记成「说第二遍、没照做」：${brokenN} 次`);
  console.log(`最后在用的要求 ${r.asks.filter((a) => a.status === 'active').length} 条：`);
  for (const a of r.asks.filter((x) => x.status === 'active')) console.log(`  - ${a.id}（${a.quotes.length} 句）${a.text}`);
  if (r.problems.length) console.log(`读回答时没收的：\n${r.problems.map((p) => `  - ${p}`).join('\n')}`);
  console.log(pass ? '\n合格' : '\n不合格');
  const res = path.resolve('evals/memory/results.md');
  if (fs.existsSync(res)) {
    const row = `| ${new Date().toISOString().slice(0, 10)} | ${path.basename(opt.out)} | ${covered.length}/${textOnly.length} | ${missed.length} | ${falseAsks.length} | ${merge.map((m) => `${m.name} ${m.asks.length}`).join('；')} | ${brokenN} | ${pass ? '合格' : '不合格'} | ${opt.note || ''} |\n`;
    fs.appendFileSync(res, row);
  }
  process.exit(pass ? 0 : 1);
}
