// 解答题 solve（dr-batch4 第 1 条）：数一按步骤给分，学生在纸上写过程。外部预写参考步骤，学生打字或交照片交整道题，
// 主讲（外部）或页面里的 Claude 照参考步骤一步一步判，写 board judge；结论进证据、错题本、meta/state 的作答行。
// 这里是不碰 DOM 的部分（读写法、读判定、汇总成一行），tests/solve.test.js；画面在 blocks/solve.js。
//
//   ```solve
//   id: p1
//   title: 求 A^n
//   q: 设 $A=\begin{bmatrix}1&1\\0&1\end{bmatrix}$，求 $A^n$。
//   steps:
//   s1 setup: 写成 A = E + B，B = [[0,1],[0,0]]
//   s2 rule: B² = O，E 和 B 可交换，用二项式定理
//   s3 calc: A^n = E + nB
//   s4 conclude: A^n = [[1,n],[0,1]]
//   judge: ext
//   ```
//
// 判定（board judge target=p1）一行一步：`s1 ok`、`s3 wrong tag=规则用错 why="把 (A+B)² 当成 A²+2AB+B²"`、`s4 missing`。

import { tokenize } from './tokens.js';

const FIELD = /^\s*([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/;
const FIELDS = new Set(['id', 'title', 'q', 'steps', 'judge', 'upload', 'note', 'exam', 'like']);
export const STEP_KINDS = { setup: '设、列式', rule: '用规则', calc: '计算', conclude: '结论' };
// 错法的词（可扩：写别的照存，判定里报一句提醒）
export const STEP_TAGS = ['符号', '漏条件', '规则用错', '计算', '记号', '没写依据', '步骤缺', '别的'];
export const JUDGES = ['ext', 'claude', 'none'];
const STEP_LINE = /^\s*[-*]?\s*([A-Za-z]\w{0,15})\s+(setup|rule|calc|conclude)\s*[:：]\s*(.+)$/;
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,64}$/;

/**
 * 读 solve 的写法。返回 { fields, steps: [{ id, kind, text }], judge, problems: [写法错误] }。
 * ext：这节课是不是外部主讲的课（judge 不写时的默认：外部的课 ext、别的 claude）
 */
export function parseSolve(src, { ext = false } = {}) {
  const fields = {};
  const steps = [];
  const problems = [];
  let inSteps = false;
  for (const raw of String(src ?? '').split('\n')) {
    if (!raw.trim()) continue;
    const st = raw.match(STEP_LINE);
    if (inSteps && st) { steps.push({ id: st[1], kind: st[2], text: st[3].trim() }); continue; }
    const m = raw.match(FIELD);
    if (m && FIELDS.has(m[1].toLowerCase())) {
      const k = m[1].toLowerCase();
      inSteps = k === 'steps';
      if (k === 'steps') {
        const v = m[2].trim();
        if (v.startsWith('[')) {
          try {
            for (const s of JSON.parse(v)) steps.push({ id: String(s.id ?? ''), kind: String(s.kind ?? ''), text: String(s.text ?? '').trim() });
          } catch (e) { problems.push(`steps: 的 JSON 读不懂：${e.message}`); }
          inSteps = false;
        } else if (v) problems.push('steps: 后面另起一行，一行一步：s1 setup: …');
        continue;
      }
      fields[k] = m[2].trim();
      continue;
    }
    if (inSteps) { problems.push(`参考步骤这一行看不懂：「${raw.trim().slice(0, 40)}」（写成 s1 setup: …，kind 是 ${Object.keys(STEP_KINDS).join(' / ')}）`); continue; }
    // 字段以外的行接在题面后面（题面可以写几行）
    if (fields.q !== undefined && !steps.length) { fields.q = `${fields.q}\n${raw}`; continue; }
    problems.push(`看不懂这一行：「${raw.trim().slice(0, 40)}」（字段是 ${[...FIELDS].join('、')}）`);
  }
  if (!fields.q) problems.push('solve 要写 q:（题面）');
  if (!steps.length) problems.push('solve 要写参考步骤：steps: 下面一行一步 s1 setup: …（kind 是 setup / rule / calc / conclude）');
  const seen = new Set();
  for (const s of steps) {
    if (!ID_RE.test(s.id)) problems.push(`步骤的编号「${s.id}」不合法：写 s1、s2 这样`);
    else if (seen.has(s.id)) problems.push(`步骤 ${s.id} 写了两次`);
    seen.add(s.id);
    if (!STEP_KINDS[s.kind]) problems.push(`步骤 ${s.id} 的 kind「${s.kind}」不认识：只认 ${Object.keys(STEP_KINDS).join(' / ')}`);
    if (!s.text) problems.push(`步骤 ${s.id} 没写内容`);
  }
  if (steps.length > 20) problems.push('参考步骤最多 20 步');
  const judge = String(fields.judge || (ext ? 'ext' : 'claude')).toLowerCase();
  if (!JUDGES.includes(judge)) problems.push(`judge: 只能写 ${JUDGES.join(' / ')}（不写：外部的课是 ext，别的是 claude）`);
  return { fields, steps, judge: JUDGES.includes(judge) ? judge : (ext ? 'ext' : 'claude'), problems };
}

const OK_WORDS = { ok: true, right: true, '对': true, '✓': true, wrong: false, bad: false, '错': false, '✗': false, missing: 'missing', miss: 'missing', '缺': 'missing', '没写': 'missing' };

/**
 * 读 board judge 块里的行：一行一步 `s3 wrong tag=规则用错 why="…"`。refSteps：这道题的参考步骤（核编号）。
 * 返回 { steps: [{ id, ok: true | false | 'missing', why, tag }], errors: [], notes: [] }；参考步骤里没判的那几步 ok: null
 */
export function parseJudge(body, refSteps = []) {
  const errors = [], notes = [];
  const ids = refSteps.map((s) => s.id);
  const got = new Map();
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.trim().replace(/^[-*]\s+/, '');
    if (!line || line.startsWith('//')) continue;
    const toks = tokenize(line);
    const id = toks[0] && !toks[0].key ? toks[0].value : '';
    const word = toks[1] && !toks[1].key ? toks[1].value.toLowerCase() : '';
    if (!id || !(word in OK_WORDS)) { errors.push(`「${line.slice(0, 50)}」：写成 s3 wrong tag=… why="…"（ok / wrong / missing）`); continue; }
    if (ids.length && !ids.includes(id)) { errors.push(`参考步骤里没有 ${id}（有 ${ids.join('、')}）`); continue; }
    const kv = Object.fromEntries(toks.slice(2).filter((t) => t.key).map((t) => [t.key, t.value]));
    const ok = OK_WORDS[word];
    const tag = kv.tag ? String(kv.tag) : ok === 'missing' ? '步骤缺' : '';
    if (tag && !STEP_TAGS.includes(tag)) notes.push(`${id} 的 tag「${tag}」不在常用的几种里（${STEP_TAGS.join('、')}），照存`);
    if (ok === false && !kv.why) notes.push(`${id} 判了错，没写 why：错题本里只记得到 tag`);
    got.set(id, { id, ok, why: String(kv.why || '').slice(0, 400), tag });
  }
  const steps = (ids.length ? ids : [...got.keys()]).map((id) => got.get(id) || { id, ok: null, why: '', tag: '' });
  if (ids.length && got.size && got.size < ids.length) notes.push(`没判的步：${ids.filter((x) => !got.has(x)).join('、')}（记成没判）`);
  if (!got.size) errors.push('board judge 里一步都没判');
  return { steps, errors, notes };
}

/** 整道题算不算对：每一步都判了对 */
export const allRight = (steps = []) => steps.length > 0 && steps.every((s) => s.ok === true);

/** 第几步（照参考步骤的先后，从 1 数） */
const nth = (steps, id) => Math.max(0, steps.findIndex((s) => s.id === id)) + 1;

/** 逐步的结论写成一行：「第 3 步 规则用错：把 … 当成 …；第 4 步 缺」；全对写「每一步都对」 */
export function judgedLine(steps = []) {
  const bad = steps.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => s.ok !== true);
  if (!bad.length) return steps.length ? `${steps.length} 步都对` : '';
  return bad.map((s) => (s.ok === null ? `第 ${s.n} 步 没判` : s.ok === 'missing' ? `第 ${s.n} 步 缺${s.why ? `：${s.why}` : ''}` : `第 ${s.n} 步${s.tag ? ` ${s.tag}` : ' 错'}${s.why ? `：${s.why}` : ''}`)).join('；');
}

/**
 * 判出来有错 / 缺的步：记一道错题要写的几样（memo.js 的 error 那一条路）。没有错的返回 null。
 * 返回 { step: '第 3 步（规则用错）', cause, tag, steps }
 */
export function errorOfJudged(steps = [], refSteps = []) {
  const first = steps.find((s) => s.ok === false || s.ok === 'missing');
  if (!first) return null;
  const n = nth(steps, first.id);
  const ref = refSteps.find((s) => s.id === first.id);
  const tag = first.tag || (first.ok === 'missing' ? '步骤缺' : '');
  return {
    step: `第 ${n} 步（${tag || (first.ok === 'missing' ? '缺' : '错')}）${ref ? `：应为「${ref.text.slice(0, 60)}」` : ''}`,
    cause: (first.why || judgedLine(steps)).slice(0, 300) || `第 ${n} 步${tag ? ` ${tag}` : ''}`,
    tag,
    steps,
  };
}

/** 交上来的那一下写成一行（ext_out、meta/state 用）：打字的前几十个字、照片几张 */
export function submittedLine({ text = '', images = [] } = {}) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return [t ? `打字：${t.length > 160 ? `${t.slice(0, 159)}…` : t}` : '', images?.length ? `照片 ${images.length} 张（${images.join('、')}）` : ''].filter(Boolean).join('；') || '（空的）';
}
