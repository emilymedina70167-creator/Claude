// 考试收件箱的重放（2026-11-15：真的学习台里 37 份只并进了第一份，原件没删、后面的没有回执）。
// 把存下来的 exam_inbox（ArtifactData list 存到本地的那份，私人数据，不进 git）照页面的顺序喂给同一套
// createExamInbox（planInbox 和写入逻辑都是页面那一份），数据库是 live/store.js 的 ?dev 替身（这里给它垫一个内存的 localStorage），
// 外面再包一层首页用的 guardDb。打印每一份收没收、写了几条、哪一步抛错。
//
//   node tools/exam-inbox-replay.mjs <存数据的目录>        （目录下有 exam_inbox/*.json，可选 papers/、exam_inbox_log/）
//   node tools/exam-inbox-replay.mjs <目录> --fail 'exam_inbox/'   让某个路径的写一直失败，看页面报不报
// 只在本地跑，不碰真的数据库。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const failAt = args.includes('--fail') ? args[args.indexOf('--fail') + 1] : '';
if (!dir) { console.error('用法：node tools/exam-inbox-replay.mjs <存数据的目录> [--fail 路径里的字]'); process.exit(1); }

// 替身要 window 和 localStorage：给一个只在内存里的
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; } };
globalThis.window = globalThis.window || { addEventListener() {} };

const { fakeDb } = await import('../kit/src/live/store.js');
const { guardDb } = await import('../kit/src/memory/writer.js');
const { createExamInbox } = await import('../kit/src/exam/examdesk.js');
const errlog = await import('../kit/src/errlog.js');

const reported = [];
errlog.onError?.((e) => reported.push(e));

const raw = fakeDb('replay');
// 已经在库里的（papers、回执）先放进去，和真的学习台当时一样
const read = (sub) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).filter((f) => f.endsWith('.json')).map((f) => {
  const j = JSON.parse(readFileSync(join(dir, sub, f), 'utf8'));
  // ArtifactData 存下来的有两种样子：{ id, data, version } 或者直接是文档
  const id = j.id && j.data ? j.id : f.replace(/\.json$/, '');
  return { id, data: j.id && j.data ? j.data : j };
}) : []);
const inbox = read('exam_inbox');
let bytes = 0;
for (const d of inbox) { bytes += JSON.stringify(d.data).length; await raw.doc(`exam_inbox/${d.id}`).set(d.data); }
console.log(`收件箱 ${inbox.length} 份，一共约 ${Math.round(bytes / 1024)} KiB`);

if (failAt) window.LAKitDev.failWrites(1e9, failAt);
const db = guardDb(raw, { waits: [] });
const box = createExamInbox({ db, waits: [], curriculum: () => [] });

// 等收件箱空了，或者 progress 说不忙了且没东西可做，最多 60 秒
const t0 = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, 200));
  const left = (await raw.collection('exam_inbox').get()).size;
  const p = box.progress?.();
  if (!left || (p && !p.busy && p.done >= p.total)) break;
  if (Date.now() - t0 > 60000) { console.log('60 秒还没做完，停'); break; }
}
box.stop();

const dump = raw._dump();
const logs = Object.keys(dump).filter((k) => k.startsWith('exam_inbox_log/'));
const left = Object.keys(dump).filter((k) => k.startsWith('exam_inbox/'));
const by = (prefix) => Object.keys(dump).filter((k) => k.startsWith(prefix)).length;
console.log(`回执 ${logs.length} 份；收件箱还剩 ${left.length} 份；库里 papers ${by('papers/')}、questions ${by('questions/')}、passages ${by('passages/')}、drills ${by('drills/')}、syllabus ${by('syllabus/')}`);
for (const d of inbox) {
  const log = dump[`exam_inbox_log/${d.id}`];
  const kind = d.data.kind;
  const n = log ? Object.entries(log.counts || {}).map(([c, k]) => `${c} ${k}`).join('、') : '';
  const why = log && !log.ok ? `：${[...(log.problems || []), ...(log.rejected || []).map((r) => `${r.id} ${r.error}`)].slice(0, 3).join('；')}` : '';
  console.log(`${d.id.padEnd(22)} ${kind.padEnd(8)} ${log ? (log.ok ? '收了' : '没收') : '没回执'} ${n}${why}${dump[`exam_inbox/${d.id}`] ? '（原件还在）' : ''}`);
}
const p = box.progress?.();
if (p) console.log('progress：', JSON.stringify({ ...p, failed: p.failed.map((f) => ({ id: f.id, why: String(f.why).slice(0, 120) })) }));
if (reported.length) console.log(`报进出错记录 ${reported.length} 条：`, [...new Set(reported.map((e) => `${e.what || ''} ${e.path || ''} ${e.msg}`.slice(0, 160)))].slice(0, 8));
process.exit(0);
