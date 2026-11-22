// 生成点词查义用的英汉词典 kit/dist/dict/en.json（设计四，2026-11-22）。
// 来源：ECDICT（https://github.com/skywind3000/ECDICT，MIT 协议）。只留考研、四六级、中高考的词和常用的前四万词，
// 加上 ECDICT 里标了考试、柯林斯、牛津的词组，和全由最常用的 1500 个词组成的两三个词的词组（as well as、in terms of），
// 每条意思最多三行。学习台第一次点词时才取这个文件，不进 la-kit.js。
//
//   curl -L -o ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
//   node tools/dict-build.mjs ecdict.csv
//
// 产物要提交（和 kit/dist/la-kit.js 一样），发布学习台时作为附带文件 dict/en.json 一起传。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('用法：node tools/dict-build.mjs ecdict.csv'); process.exit(1); }
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kit', 'dist', 'dict', 'en.json');

// 最小的 CSV 读法（ECDICT 的字段里有逗号、换行写成 \n、双引号成对）
function* rows(text) {
  let i = 0, row = [], cell = '', q = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); yield row; row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); yield row; }
}

const EXAM = new Set(['ky', 'cet4', 'cet6', 'zk', 'gk']);
const RANK = 40000;
const text = fs.readFileSync(src, 'utf8');
const it = rows(text);
const head = it.next().value;
const col = Object.fromEntries(head.map((h, i) => [h, i]));

// 意思：去掉专业领域的长串，最多三行、每行最多 60 个字
function meaning(t) {
  const lines = String(t || '').split(/\\n|\n/).map((l) => l.trim()).filter(Boolean);
  const plain = lines.filter((l) => !/^\[(网络|计|医|化|经|法|电|机|生|地|物|数|农|建|军|天|矿|动|植|航|语|心|宗|史|体|艺|乐|哲|商|管|政|社|统|信|环|测|冶|海|气|纺|食|林|水|石|核|交|邮|印|摄|影|电影|计算机)\]/.test(l));
  const keep = (plain.length ? plain : lines).slice(0, 3).map((l) => (l.length > 60 ? `${l.slice(0, 59)}…` : l));
  return keep.join('\n');
}
const rankOf = (r) => {
  const v = [r[col.frq], r[col.bnc]].map(Number).filter((n) => n > 0);
  return v.length ? Math.min(...v) : Infinity;
};

const all = [...it];
// 最常用的 1500 个词：两三个词的词组全由它们组成才收（as well as、in terms of；以 a / an / the 开头的不收）
const common = new Set(all.filter((r) => /^[a-z]+$/.test(r[col.word]) && rankOf(r) <= 1500).map((r) => r[col.word]));
const commonPhrase = (w) => /^[a-z]+( [a-z]+){1,2}$/.test(w) && !/^(a|an|the) /.test(w) && w.split(' ').every((x) => common.has(x));
const words = {}; // 小写的词 → 意思
const phrases = {}; // 词组 → 意思
const forms = {}; // 变形 → 原形
const exchanges = []; // [原形, exchange]
for (const r of all) {
  const w = r[col.word];
  const trans = r[col.translation];
  if (!w || !trans || !trans.trim()) continue;
  const tags = new Set(String(r[col.tag] || '').split(/\s+/).filter(Boolean));
  const exam = [...tags].some((t) => EXAM.has(t));
  if (/^[A-Za-z][A-Za-z'-]*$/.test(w)) {
    if (!exam && rankOf(r) > RANK) continue;
    const key = w.toLowerCase();
    // 同一个词大小写各一条（Polish / polish）：小写的那条优先
    if (words[key] && w !== key) continue;
    words[key] = meaning(trans);
    if (r[col.exchange]) exchanges.push([key, r[col.exchange]]);
  } else if (/^[a-z][a-z'-]*( [a-z][a-z'-]*){1,3}$/.test(w) && (tags.size || r[col.collins] || r[col.oxford] || commonPhrase(w))) {
    phrases[w] = meaning(trans);
  }
}
// 变形表：exchange 里 p 过去式、d 过去分词、i 现在分词、3 三单、s 复数、r 比较级、t 最高级
for (const [lemma, ex] of exchanges) {
  for (const part of ex.split('/')) {
    const m = part.match(/^([pdi3srt]):(.+)$/);
    if (!m) continue;
    const f = m[2].toLowerCase();
    // 自己也是一个词的变形（known、found）也记：查的时候两条都给
    if (f === lemma || forms[f]) continue;
    forms[f] = lemma;
  }
}
const doc = { v: 1, src: 'ECDICT (MIT, https://github.com/skywind3000/ECDICT)', w: words, p: phrases, x: forms };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc));
console.log(`词 ${Object.keys(words).length}、词组 ${Object.keys(phrases).length}、变形 ${Object.keys(forms).length}；${(fs.statSync(out).size / 1e6).toFixed(2)} MB → ${out}`);
