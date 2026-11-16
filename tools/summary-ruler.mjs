#!/usr/bin/env node
// 连着重写的尺子（清点第三节；说明 evals/memory/README.md）：记忆摘要一节课一节课重写下去，丢不丢事实、长不长规矩、
// 会不会越写越长、引的学生原话有没有被改字。提示词和核法是页面同一套（tools/summary-ruler-lib.mjs）。
//
//   node tools/summary-ruler.mjs next  <存数据的目录> --state <工作目录>      # 写出下一步的提示词 NN.prompt.txt
//   （请一个不知情的 Opus 照提示词作答，写到 NN.out.txt）
//   node tools/summary-ruler.mjs apply <存数据的目录> --state <工作目录> NN <回答文件>
//        # 收下 / 要重来（写出 NN.retry.prompt.txt，答到 NN.retry.out.txt 再 apply 一次）/ 没收
//   node tools/summary-ruler.mjs score <存数据的目录> --state <工作目录> [--facts 清单.json …]
//
// 存数据的目录：ArtifactData list 存下来的（evidence/、sessions/*.json、sessions/{课}/class_turns/、sessions/{课}/report/main.json，
// 还有第一次重写当原料的 rules/、lessons/、asks/、profile/），私人数据，放在 .superpowers/ 下面。
// 事实清单：evals/memory/summary-facts.json（能公开的）；带学生原话的另放在 <存数据的目录>/facts-private.json，有就一起读。
import fs from 'node:fs';
import path from 'node:path';
import { stepsOf, emptyState, stepPrompt, applyAnswer, scoreState, scoreTable } from './summary-ruler-lib.mjs';

const args = process.argv.slice(2);
const [cmd, dataDir] = args;
const opt = { facts: [] };
const rest = [];
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--state') opt.state = args[++i];
  else if (args[i] === '--facts') opt.facts.push(args[++i]);
  else rest.push(args[i]);
}
if (!['next', 'apply', 'score'].includes(cmd) || !dataDir || !opt.state) {
  console.error('用法：node tools/summary-ruler.mjs next|apply|score <存数据的目录> --state <工作目录> [NN 回答文件] [--facts 清单.json]');
  process.exit(2);
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const readDir = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => ({ id: f.replace(/\.json$/, ''), ...readJson(path.join(d, f)) })) : []);
function loadData(dir) {
  const sessions = readDir(path.join(dir, 'sessions'));
  const turns = {}, reports = {};
  for (const s of sessions) {
    turns[s.id] = readDir(path.join(dir, 'sessions', s.id, 'class_turns')).map((t) => ({ ...t, seq: Number(t.seq ?? t.id) })).sort((a, b) => a.seq - b.seq);
    const rep = path.join(dir, 'sessions', s.id, 'report', 'main.json');
    if (fs.existsSync(rep)) reports[s.id] = readJson(rep);
  }
  return { sessions, turns, reports, evidence: readDir(path.join(dir, 'evidence')), rules: readDir(path.join(dir, 'rules')), lessons: readDir(path.join(dir, 'lessons')), asks: readDir(path.join(dir, 'asks')), profile: readDir(path.join(dir, 'profile')) };
}

fs.mkdirSync(opt.state, { recursive: true });
const stateFile = path.join(opt.state, 'state.json');
const state = fs.existsSync(stateFile) ? readJson(stateFile) : emptyState();
const save = (st) => fs.writeFileSync(stateFile, JSON.stringify(st, null, 1));
const nn = (n) => String(n).padStart(2, '0');
const data = loadData(dataDir);
const steps = stepsOf(data);

if (cmd === 'next') {
  const waiting = state.steps.find((s) => s.status === 'retry');
  if (waiting) { console.log(`第 ${waiting.n} 步在等重来：照 ${path.join(opt.state, `${nn(waiting.n)}.retry.prompt.txt`)} 再答一次，然后 apply`); process.exit(0); }
  const step = steps.find((s) => !state.steps.some((x) => x.n === s.n));
  if (!step) { console.log(`${steps.length} 步都做完了：score 出表`); process.exit(0); }
  const p = stepPrompt(data, state, step.n);
  const file = path.join(opt.state, `${nn(step.n)}.prompt.txt`);
  fs.writeFileSync(file, p.prompt);
  console.log(`第 ${step.n} / ${steps.length} 步：${step.sid}（${step.space}，${step.date}）提示词 ${Buffer.byteLength(p.prompt)} 字节 → ${file}`);
} else if (cmd === 'apply') {
  const n = Number(rest[0]);
  const ansFile = rest[1];
  if (!n || !ansFile || !fs.existsSync(ansFile)) { console.error('apply 要写第几步和回答文件'); process.exit(2); }
  const p = stepPrompt(data, state, n);
  // 核引号的材料是当时给它的那一份提示词（state 没变，重拼出来的一样；有存下的就用存下的）
  const saved = path.join(opt.state, `${nn(n)}.prompt.txt`);
  const prompt = fs.existsSync(saved) ? fs.readFileSync(saved, 'utf8') : p.prompt;
  const r = applyAnswer(state, { ...p, prompt, text: fs.readFileSync(ansFile, 'utf8') });
  save(r.state);
  const st = r.state.steps.find((s) => s.n === n);
  if (r.status === 'retry') {
    const file = path.join(opt.state, `${nn(n)}.retry.prompt.txt`);
    fs.writeFileSync(file, r.retryPrompt);
    console.log(`第 ${n} 步要重来一次（${st.why}）→ ${file}`);
  } else console.log(`第 ${n} 步${r.status === 'done' ? '收下' : '没收'}：共用 ${st.bytes.shared} 字节，这一科 ${st.bytes.subject} 字节，试了 ${st.tries} 次${st.why ? `；${st.why}` : ''}`);
} else {
  const privateFacts = path.join(dataDir, 'facts-private.json');
  const files = opt.facts.length ? opt.facts : ['evals/memory/summary-facts.json', ...(fs.existsSync(privateFacts) ? [privateFacts] : [])];
  const facts = files.flatMap((f) => readJson(f).map((x) => ({ ...x, private: f === privateFacts || x.private })));
  console.log(scoreTable(scoreState(state, facts)));
}
