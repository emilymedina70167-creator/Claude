// 云端教研室在开发这边的工具（docs/lab-plan.md）：
//
//   node tools/lab.mjs briefs <存数据的目录> [--out 目录]
//     照真数据算工作单，拼教研室的单子（补收尾、出新题、探题；备课要读教材，只在学习台里拼），
//     每张存成 <out>/<单子编号>.json（ArtifactData set 的 file_path 直接用），打出每张多大。学习台没打开过、
//     又想先让教研室做一晚的时候用（学习台以后打开，材料没变就不重拼：srcOf 一样）。
//
//   node tools/lab.mjs check <存数据的目录> <回答的目录>
//     教研室交回来的回答（lab_inbox 存下来的 JSON），按学习台并进来时的同一条路先走一遍（替身数据库里装上真数据，
//     memops.applyMemo 走守卫，author: lab）：会收哪些、暂存哪些、拒哪些，题有没有写法问题。只读本地文件，不碰学习台。
//
// 存数据：用 ArtifactData 的 list（out_dir）把学习台各类存到一个目录，结构是 <目录>/<集合>/<id>.json，
// 每节课的 class_turns、report 在 <目录>/sessions/<课号>/ 下面（和 tools/guard-audit.mjs 一样）。
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };

const { MEMORY_COLLECTIONS, toDate } = await import('../kit/src/memory/schema.js');
const { workOrder } = await import('../kit/src/memory/sentry.js');
const lab = await import('../kit/src/memory/lab.js');
const { componentDocs } = await import('../kit/build-docs.js');
const { parseOutput } = await import('../kit/src/class/protocol.js');

const [cmd, dir, ...rest] = process.argv.slice(2);
const opt = { out: '' };
for (let i = 0; i < rest.length; i++) if (rest[i] === '--out') opt.out = resolve(rest[++i]);
if (!cmd || !dir || !existsSync(dir)) { console.error('用法：node tools/lab.mjs briefs <目录> [--out 目录] | check <目录> <回答的目录>'); process.exit(2); }

const readColl = (p) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => ({ id: f.slice(0, -5), ...JSON.parse(readFileSync(join(p, f), 'utf8')) })) : []);
const mem = Object.fromEntries([...MEMORY_COLLECTIONS, 'drills'].map((c) => [c, readColl(join(dir, c))]));
const turnsOf = (sid) => readColl(join(dir, 'sessions', sid, 'class_turns'));
const reportOf = (sid) => readColl(join(dir, 'sessions', sid, 'report'))[0] || null;
const DOCS = componentDocs(readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8'));
const KB = (n) => `${Math.round(n / 1024)} KB`;

if (cmd === 'briefs') {
  const items = workOrder(mem, { today: toDate(Date.now()) });
  const picks = lab.labPicks(items).filter((x) => x.kind !== 'prep');
  const out = opt.out || join(dir, '..', 'lab-briefs');
  mkdirSync(out, { recursive: true });
  for (const it of picks) {
    const got = it.kind === 'backfill'
      ? lab.backfillMaterial(mem, mem.sessions.find((s) => s.id === it.ref), { turns: turnsOf(it.ref), rep: reportOf(it.ref) })
      : lab.problemsMaterial(mem, it, { docs: DOCS });
    if (!got) { console.log(`跳过 ${it.kind} ${it.ref}：没有材料`); continue; }
    const id = lab.briefId(it);
    const doc = lab.briefDoc(it, got, lab.srcOf(it, mem, {}));
    writeFileSync(join(out, `${id}.json`), JSON.stringify(doc));
    console.log(`${id}\t${KB(lab.bytesOf(doc.prompt))}\t${it.title}`);
  }
  console.log(`\n存在 ${out}（ArtifactData set：collection lab_brief，doc_id 是文件名，file_path 是文件）`);
} else if (cmd === 'check') {
  const inboxDir = rest[0];
  if (!inboxDir || !existsSync(inboxDir)) { console.error('要给回答的目录'); process.exit(2); }
  const { createMemOps } = await import('../kit/src/memory/memops.js');
  const { fakeDb } = await import('../kit/src/live/store.js');
  const { guardCandidate, buildCorpus, guardReason } = await import('../kit/src/memory/guard.js');
  const db = fakeDb(`lab-check-${Date.now()}`);
  db._clear();
  for (const [c, docs] of Object.entries(mem)) for (const d of docs) { const { id, ...x } = d; await db.doc(`${c}/${id}`).set(x); }
  const ops = createMemOps({ db, mem: () => mem });
  const briefs = new Map(readColl(join(dir, '..', 'lab-briefs')).concat(readColl(join(dir, 'lab_brief'))).map((b) => [b.id, b]));
  for (const d of readColl(inboxDir)) {
    const b = briefs.get(d.brief);
    console.log(`\n=== ${d.id}（${d.brief}）`);
    const chk = lab.checkReply(d, b);
    if (!chk.ok) { console.log(`  不收：${chk.why}`); continue; }
    if (b.kind === 'backfill') {
      const sid = b.ctx.session;
      const got = lab.parseBackfill(d.text, { parseOutput });
      const turns = turnsOf(sid);
      const corpus = buildCorpus({ turns, evidence: mem.evidence.filter((e) => e.session === sid) });
      const g = guardCandidate({ coll: 'observations', id: 'ob-x', doc: { kind: 'summary', text: got.summary, session: sid, at: 1, by: 'lab', backfill: true }, author: 'lab', session: sid }, { mem, corpus });
      console.log(`  小结 ${got.summary.length} 字：${g.verdict}${g.verdict === 'accept' ? '' : `（${guardReason(g)}）`}`);
      for (const p of got.problems.concat(got.errors)) console.log(`  问题：${p}`);
      const r = await ops.applyMemo(got.entries, { session: sid, block: b.ctx.block, space: b.ctx.space, turns, author: 'lab' });
      console.log(`  整理单 ${got.entries.length} 条：收 ${r.pds.length}，暂存 ${r.rejected.filter((x) => x.held).length}，拒 ${r.rejected.filter((x) => !x.held).length}`);
      for (const x of r.rejected) console.log(`    - ${x.held ? '暂存' : '拒'}：${String(x.line).slice(0, 80)}\n      ${x.error}`);
      for (const p of r.pds) console.log(`    + ${p.coll} ${p.target}：${String(p.line || '').slice(0, 90)}`);
    } else if (b.kind === 'newproblems' || b.kind === 'probe') {
      const got = lab.parseProblems(d.text, { brief: b.id, block: b.ctx.block, target: b.ctx.target });
      // 学习台收题时还要在页面上画一遍：这里先拼一页，交给 check-lesson 在浏览器里画（每道题一节）
      const pages = join(inboxDir, '..', 'lab-pages');
      mkdirSync(pages, { recursive: true });
      writeFileSync(join(pages, `${b.id}.html`), `<!doctype html>\n<meta charset="utf-8">\n<script src="la-kit.js"></script>\n<script type="text/markdown">\n---\nsubject: ${b.ctx.subject}\nunit: ${b.id}\n---\n\n${got.items.map((it) => `## 题 ${it.n}\n\n${it.doc.md}`).join('\n\n')}\n</script>\n`);
      for (const p of got.problems) console.log(`  问题：${p}`);
      for (const it of got.items) {
        const errs = lab.problemLint(it, { subject: b.ctx.subject });
        const twin = lab.twinOf(it, mem.drills);
        console.log(`  题 ${it.n}（${it.kind}）${errs.length || twin ? `不收：${[...errs, twin ? `和 ${twin.id} 几乎一样` : ''].filter(Boolean).join('；')}` : '写法过了（页面上还要画一遍）'}　针对：${it.why.slice(0, 60)}`);
      }
    } else console.log(`  ${b.kind}：只在学习台里并（要读资料包）`);
  }
  console.log(`\n题拼成的页在 ${join(inboxDir, '..', 'lab-pages')}：node tools/check-lesson.mjs 那个目录/*.html（在浏览器里画一遍，和学习台收题时一样）`);
} else {
  console.error(`不认识 ${cmd}`);
  process.exit(2);
}
