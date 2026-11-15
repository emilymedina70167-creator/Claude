// 按分钟量真课（tools/lesson-audit-lib.mjs）。目录约定和 tools/stage-lesson.mjs 一样：
//   <目录>/sessions/<课号>.json、<目录>/sessions/<课号>/class_turns/<seq>.json、<目录>/evidence/<id>.json
//   node tools/lesson-audit.mjs <存数据的目录> [课号…] [--json]
// 数据是私人的：目录放 .superpowers/ 下面，不进 git。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { auditLesson, auditText } from './lesson-audit-lib.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const [dir, ...ids] = args.filter((a) => !a.startsWith('--'));
if (!dir || !existsSync(join(dir, 'sessions'))) { console.error('用法：node tools/lesson-audit.mjs <存数据的目录> [课号…] [--json]（目录下要有 sessions/）'); process.exit(2); }

// 每个文件可能是 { id, data: {...} }，也可能直接是文档
const readColl = (p) => (existsSync(p) && statSync(p).isDirectory()
  ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => {
    const raw = JSON.parse(readFileSync(join(p, f), 'utf8'));
    return { id: f.slice(0, -5), ...(raw && typeof raw.data === 'object' && raw.data ? raw.data : raw) };
  }) : []);

const evidence = readColl(join(dir, 'evidence'));
const sessions = readColl(join(dir, 'sessions'))
  .filter((s) => (!s.kind || ['class', 'talk', 'stage'].includes(s.kind)) && (!ids.length || ids.includes(s.id)))
  .sort((a, b) => String(a.id).localeCompare(String(b.id)));
const audits = sessions.map((s) => auditLesson({
  session: s,
  turns: readColl(join(dir, 'sessions', s.id, 'class_turns')).sort((a, b) => (a.seq || 0) - (b.seq || 0)),
  evidence,
}));
if (json) console.log(JSON.stringify(audits, null, 1));
else console.log(audits.length ? auditText(audits) : '没有找到黑板课或舞台课（sessions 里 kind: class / stage 的）');
