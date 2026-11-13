// 学习台里放考试资料（2026-11-13 我问：资料放哪？放了它知道吗）：我没有私有仓库，真题又不能放进公开的开发仓库，
// 所以在「管理 → 考试」直接传 PDF（真题卷、解析、大纲）：文件存进学习台的 assets（不存成教材：存成书会被当教材带进课堂），
// 记一条 exam_uploads/{up-…}（status: waiting）。开发那边（Claude Code）每次开工先看这一类，有等着的就照 docs/exam-ingest.md 入库，
// 入完标 done。纯函数，有测试（tests/exam-uploads.test.js）。

// 学习台的 asset 一份最多 15 MB（artifact 的上限）：大的整本拆成几份传
export const UPLOAD_MAX = 15 * 1024 * 1024;
export const UPLOAD_KINDS = { paper: '真题卷', answers: '解析 / 答案', syllabus: '考试大纲', other: '别的' };

/** 照文件名猜是什么 */
export function guessKind(name = '') {
  const s = String(name);
  if (/大纲/.test(s)) return 'syllabus';
  if (/解析|答案|详解/.test(s)) return 'answers';
  if (/真题|试卷|试题|统考/.test(s)) return 'paper';
  return 'other';
}

/** 传之前查一遍：不收的说为什么（不是 PDF、太大）；收的返回 '' */
export function uploadProblem(file = {}) {
  if (!/pdf$/i.test(String(file.type || '')) && !/\.pdf$/i.test(String(file.name || ''))) return `「${file.name}」不是 PDF：真题、解析、大纲都传 PDF`;
  if (Number(file.size) > UPLOAD_MAX) return `「${file.name}」有 ${Math.round(Number(file.size) / 1048576)} MB，超过 15 MB：拆成几份（每份 15 MB 以内）再传`;
  return '';
}

const SUBJECT = [[/408|计算机/, '408'], [/数学\s*[一1]|数一|301/, '301'], [/英语\s*[一1]|英一|201/, '201'], [/政治|101/, '101']];

/** 一条记录：{ id, name, kind, asset, size, subject?, year?, note, status: 'waiting', at } */
export function uploadDoc({ name, size, asset, kind, note = '', now = Date.now(), seq = 1 }) {
  const s = `${name} ${note}`;
  const subject = SUBJECT.find(([re]) => re.test(s))?.[1] || '';
  const year = Number(s.match(/(20\d{2})/)?.[1]) || null;
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return {
    id: `up-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${now % 100000}-${seq}`,
    name: String(name).slice(0, 200), kind, asset: String(asset), size: Number(size) || 0,
    ...(subject ? { subject } : {}), ...(year ? { year } : {}), note: String(note || '').slice(0, 200), status: 'waiting', at: now,
  };
}

/** 卡上的一行：还有几份等入库 */
export function waitingLine(docs = []) {
  const n = docs.filter((d) => d?.status === 'waiting').length;
  return n ? `${n} 份等入库：下次开 Claude Code 说一句「入库考试资料」` : '';
}
