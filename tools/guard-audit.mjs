// 守卫的量法（docs/guard-plan.md 第 1 步）：拿真实学习台的数据，把已经写进去的每一条当成候选重跑一遍守卫，
// 只记不拦，看它会拒哪些、提醒哪些、是不是冤枉，好调准规则。
//
// 用法：
//   1. 用 ArtifactData 的 list（out_dir）把学习台各类存到一个目录（结构是 <目录>/<集合>/<id>.json，
//      每节课的 class_turns 在 <目录>/sessions/<课号>/class_turns/）；
//   2. node tools/guard-audit.mjs <目录> [--show 8] [--only errors,debrief] [--json 结果.json]
//
// 不碰学习台，只读本地文件。
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { guardCandidate, buildCorpus, authorOf } from '../kit/src/memory/guard.js';
import { MEMORY_COLLECTIONS } from '../kit/src/memory/schema.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const opt = { show: 6, only: null, json: '', mutate: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--show') opt.show = Number(args[++i]);
  else if (args[i] === '--only') opt.only = new Set(args[++i].split(','));
  else if (args[i] === '--json') opt.json = args[++i];
  else if (args[i] === '--mutate') opt.mutate = true;
}
if (!dir || !existsSync(dir)) { console.error('用法：node tools/guard-audit.mjs <存数据的目录>'); process.exit(2); }

// 存下来的文件名就是编号（文件里不一定带 id）
const readColl = (p) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => ({ id: f.slice(0, -5), ...JSON.parse(readFileSync(join(p, f), 'utf8')) })) : []);
const mem = Object.fromEntries(MEMORY_COLLECTIONS.map((c) => [c, readColl(join(dir, c))]));

// 每节课的记录：class_turns + 这节课的证据
const corpora = new Map();
for (const s of mem.sessions) {
  const turns = readColl(join(dir, 'sessions', s.id, 'class_turns'));
  const evidence = mem.evidence.filter((e) => e.session === s.id);
  if (turns.length || evidence.length) corpora.set(s.id, { corpus: buildCorpus({ turns, evidence }), turns: turns.length, evidence: evidence.length });
}

// 候选：记忆库里 Claude 写的那几类的每一条，加每节课的复盘（拆成一条条误解、节奏、习惯、建议、开场）
const COLLS = ['errors', 'weaknesses', 'observations', 'slips', 'lessons', 'reviews', 'recall', 'position', 'profile', 'rules', 'mastery'];
const cands = [];
for (const coll of COLLS) {
  for (const d of mem[coll]) {
    const { id, ...doc } = d;
    const session = doc.session || null;
    // 重跑时把自己从「已有的」里拿掉（不然每一条都和自己重复）
    cands.push({ coll, id, doc, before: null, author: authorOf(d) === 'me' ? 'me' : doc.by === 'chat' ? 'chat' : session ? 'class' : 'chat', session });
  }
}
for (const s of mem.sessions) {
  const db = s.debrief;
  if (!db) continue;
  const parts = [...(db.mis || []).map((x, i) => ['mis', i, x]), ...(db.habit || []).map((x, i) => ['habit', i, x]), ...(db.pace || []).map((x, i) => ['pace', i, x]), ...(db.advice || []).map((x, i) => ['advice', i, { advice: x }]), ...(db.opening ? [['opening', 0, db.opening]] : [])];
  for (const [k, i, x] of parts) cands.push({ coll: 'debrief', id: `${s.id}.${k}${i}`, doc: x, before: null, author: 'lab', session: s.id });
}

const allComps = new Set([...corpora.values()].flatMap((v) => [...v.corpus.comps]));
const results = [];
for (const c of cands) {
  if (opt.only && !opt.only.has(c.coll)) continue;
  const others = { ...mem, [c.coll]: (mem[c.coll] || []).filter((d) => String(d.id) !== String(c.id)) };
  const corpus = c.session ? corpora.get(c.session)?.corpus : null;
  const r = guardCandidate(c, { mem: others, corpus, allComps });
  results.push({ ...c, ...r, verifiable: !!corpus });
}

// —— 汇总 ——
const by = (f) => results.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`候选 ${results.length} 条（能核原话的课 ${corpora.size} 节：${[...corpora].map(([k, v]) => `${k} ${v.turns} 轮 ${v.evidence} 条证据`).join('；')}）\n`);
const table = {};
for (const r of results) { const t = (table[r.coll] ||= { 条数: 0, 收下: 0, 挂提醒: 0, 暂存: 0, 拒收: 0, 能核原话: 0 }); t.条数++; t[{ accept: '收下', flag: '挂提醒', hold: '暂存', reject: '拒收' }[r.verdict]]++; if (r.verifiable) t.能核原话++; }
console.table(table);
const codes = {};
for (const r of results) for (const c of r.checks) { const k = `${{ fail: '拒', warn: '提', info: '记' }[c.level]} ${c.gate}/${c.code}`; (codes[k] ||= []).push({ r, c }); }
console.log('\n每种问题有几条：');
for (const [k, v] of Object.entries(codes).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${k.padEnd(34)} ${v.length}`);
console.log('\n例子（每种前几条）：');
for (const [k, v] of Object.entries(codes).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n■ ${k}`);
  for (const { r, c } of v.slice(0, opt.show)) console.log(`  - ${r.coll}/${r.id}${r.session ? `（${r.session}）` : ''}：${c.msg}`);
}
// —— 改坏了还能不能抓到（--mutate）：在能核原话的真内容里造几种假的，看守卫抓到几成 ——
if (opt.mutate) {
  const FAKE = ['学生说这题太简单了不用讲', '我觉得应该先算行列式', 'because it is passive voice'];
  const kinds = {
    '编一句原话': (c) => { const t = JSON.stringify(c.doc); if (!/#\d+/.test(t)) return null; return { ...c, doc: { ...c.doc, _fake: `#${firstTurn(t)} 学生原话「${FAKE[0]}」` } }; },
    '原话里换掉几个字': (c) => { const t = JSON.stringify(c.doc); const m = t.match(/(#\d+[^「]{0,12})「([^」]{6,40})」/); if (!m) return null; const changed = m[2].slice(0, 2) + '完全不是这样说的' + m[2].slice(-2); return { ...c, doc: { ...c.doc, _fake: `${m[1]}「${changed}」` } }; },
    '指一个没有的轮次': (c) => ({ ...c, doc: { ...c.doc, _fake: '见 #999 的作答' } }),
    '指一个没有的板上编号': (c) => ({ ...c, doc: { ...c.doc, _fake: '学生在 qz-b777 选错了' } }),
    '依据写一个没有的证据': (c) => ({ ...c, basis: ['ev-notreal-00000'] }),
  };
  const firstTurn = (t) => t.match(/#(\d+)/)[1];
  // _fake 当成这一类的文字（错题放 cause，别的放 text）
  const field = (coll) => (coll === 'errors' ? 'cause' : coll === 'debrief' ? 'basis' : 'text');
  console.log('\n改坏了还能不能抓到（只用能核原话的课的真内容）：');
  for (const [name, f] of Object.entries(kinds)) {
    let n = 0, caught = 0;
    for (const r of results.filter((x) => x.verifiable && corpora.get(x.session)?.turns)) {
      const m = f(r);
      if (!m) continue;
      const doc = m.doc._fake ? { ...m.doc, [field(m.coll)]: `${m.doc[field(m.coll)] ?? ''}\n${m.doc._fake}` } : m.doc;
      delete doc._fake;
      const others = { ...mem, [m.coll]: (mem[m.coll] || []).filter((d) => String(d.id) !== String(m.id)) };
      const v = guardCandidate({ ...m, doc }, { mem: others, corpus: corpora.get(m.session).corpus, allComps });
      n++;
      if (v.verdict !== 'accept') caught++;
      else if (process.env.GUARD_DEBUG) console.log('    没抓到：', m.coll, m.id, JSON.stringify(doc[field(m.coll)]).slice(-90));
    }
    console.log(`  ${name.padEnd(12)} ${caught} / ${n} 抓到`);
  }
  // 错题的「我写的」换成别的话
  let n = 0, caught = 0;
  for (const e of mem.errors.filter((x) => x.mine && (x.evidence || []).length)) {
    const { id, ...doc } = e;
    const v = guardCandidate({ coll: 'errors', id, doc: { ...doc, mine: '我写的是 A 是可逆矩阵所以秩等于 n' }, author: 'class', session: doc.session }, { mem: { ...mem, errors: mem.errors.filter((x) => x.id !== id) }, allComps });
    n++; if (v.verdict !== 'accept') caught++;
  }
  console.log(`  ${'「我写的」换掉'.padEnd(12)} ${caught} / ${n} 抓到`);
}
if (opt.json) writeFileSync(opt.json, JSON.stringify(results.map(({ doc, ...r }) => r), null, 1));
