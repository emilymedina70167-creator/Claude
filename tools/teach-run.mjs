// 教学尺子（evals/teaching/）：用命令行自动跑完一节模拟课、课后测验和评卷。
// 以前是开发的人手工轮流派子代理扮老师和学生；现在这个脚本轮流调用 `claude -p`，中间每一步都交给 tools/teach-sim.mjs（页面）。
//
//   node tools/teach-run.mjs <目录> <场景.json> [--system 文件] [--memory 文件]
//        [--teacher claude-opus-5-5] [--student claude-sonnet-5-5] [--grader claude-opus-5-5] [--fake 目录]
//
// 目录里留下：t-N.txt（老师第 N 轮）、s-N.json（学生第 N 轮）、transcript.md、posttest-answers.md、metrics.json、grade.json、
// run.json（成没成、停在第几轮、每次调用花了多少）；还有 teach-sim 自己的 state.json、view.md、notebook.md、posttest.md 等。
//
// 每个角色一个会话（老师、学生、课后测验的学生、评卷人），各自在仓库外的一个空临时目录里跑：模型没有工具、读不到任何文件，
// 扮学生的看不到 scenario.json 里的答案，学生需要的东西全在提示词里。续会话要在同一个目录里（会话按目录存），所以一个角色一直用它那个目录。
// 一次调用返回空、超时（10 分钟）、退出码非 0、不是 JSON、用的不是要的模型：重试一次；再不成这节课算失败（run.json 的 ok: false，写停在哪），
// 不把半节课交给评卷——半节课的分数混进一整套里会把结果拉偏。
//
// --fake 目录：不调用命令行（测试用）。老师读 目录/t-N.txt、学生读 目录/s-N.json、课后测验读 目录/post.md、评卷读 目录/grade.txt；
// 老师、学生的文件没了就当「到时间了」。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cliArgs, studentSystem, posttestSystem, studentReply, graderPrompt, parseGrade } from './teach-run-lib.mjs';

const SIM = new URL('./teach-sim.mjs', import.meta.url).pathname;
const TIMEOUT = 10 * 60 * 1000;
// 学生一直被预案接住、老师一直不跑时的保险：钟本来会让它下课，这里只防 teach-sim 出毛病时死循环
const MAX_STUDENT = 150;

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [dirArg, scenarioArg] = pos;
if (!dirArg || !scenarioArg) { console.error('用法：node tools/teach-run.mjs <目录> <场景.json> [--system 文件] [--memory 文件] [--teacher 模型] [--student 模型] [--grader 模型] [--fake 目录]'); process.exit(2); }
const dir = path.resolve(dirArg);
const fake = opt('--fake') ? path.resolve(opt('--fake')) : null;
const models = { teacher: opt('--teacher', 'claude-opus-5-5'), student: opt('--student', 'claude-sonnet-5-5'), grader: opt('--grader', 'claude-opus-5-5') };
const P = (f) => path.join(dir, f);
const read = (f) => fs.readFileSync(f, 'utf8');
const sc = JSON.parse(read(scenarioArg));

const run = { ok: false, scenario: sc.id, models, startedAt: new Date().toISOString(), teacherTurns: 0, studentTurns: 0, studentFallbacks: 0, calls: [], costUsd: 0, timeline: [] };
const saveRun = () => fs.writeFileSync(P('run.json'), JSON.stringify(run, null, 1));
const t0 = Date.now();

class Stop extends Error { constructor(what, msg) { super(msg); this.what = what; } }
// 正常下课（到时间了、假的回复用完了）
class Over extends Error {}

/* ---------------- 调用模型 ---------------- */

const tmpDirs = [];
/** 一个角色一个会话：第一轮带系统提示词文件，之后 --resume */
function conversation(role, model, effort, systemText) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `teach-${role}-`));
  tmpDirs.push(cwd);
  // 系统提示词文件放在跑课目录里（方便事后看发了什么），命令行自己读它，模型读不到
  const systemFile = P(`${role}-system.md`);
  if (systemText !== undefined && !fs.existsSync(systemFile)) fs.writeFileSync(systemFile, systemText);
  return { role, model, effort, cwd, systemFile, session: null };
}

/** 调一次命令行；返回回复的文字。坏一次重试一次，再坏抛 Stop */
function callOnce(conv, message) {
  const args = cliArgs({ model: conv.model, effort: conv.effort, systemFile: conv.session ? undefined : conv.systemFile, resume: conv.session || undefined });
  const t = Date.now();
  // 话从标准输入给：老师第一轮之后每轮的现状、评卷的整份材料都可能超过命令行一个参数的上限
  const r = spawnSync('claude', args, { cwd: conv.cwd, input: message, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024 });
  const ms = Date.now() - t;
  let out = null;
  try { out = JSON.parse(r.stdout || ''); } catch { /* 下面按「不是 JSON」处理 */ }
  const err = r.error?.code === 'ETIMEDOUT' ? '超时' : r.error ? r.error.message
    // 退出码非 0 时输出常常还是 JSON，真正的原因（比如用量到了上限）在 result 里
    : r.status !== 0 ? `退出码 ${r.status}：${String(out?.result || r.stderr || r.stdout || '').slice(0, 300)}`
      : !out ? `输出不是 JSON：${String(r.stdout || '').slice(0, 200)}`
        : out.is_error ? `命令行报错：${String(out.result || out.subtype || '').slice(0, 300)}`
          : !String(out.result || '').trim() ? '回复是空的'
            // 讲课的老师只能是要的那个模型：平台换了模型就不算这一轮
            : Object.keys(out.modelUsage || {}).some((m) => m !== conv.model) ? `用的模型不对：${Object.keys(out.modelUsage).join(', ')}`
              : '';
  const cost = Number(out?.total_cost_usd) || 0;
  run.calls.push({ role: conv.role, ok: !err, ms, cost, session: out?.session_id || null, ...(err ? { error: err } : {}) });
  run.costUsd = Math.round((run.costUsd + cost) * 1e4) / 1e4;
  if (err) return { err };
  conv.session = out.session_id || conv.session;
  return { text: String(out.result) };
}
function call(conv, message, what) {
  let r = callOnce(conv, message);
  if (r.err) { console.error(`${what}：${r.err}，重试一次`); r = callOnce(conv, message); }
  if (r.err) throw new Stop(what, r.err);
  return r.text;
}
/** 假的回复：文件没了就当到时间了（老师、学生），或者这节课失败（课后测验、评卷） */
function fakeReply(file, what, overIfMissing) {
  const f = path.join(fake, file);
  if (fs.existsSync(f)) return read(f);
  if (overIfMissing) throw new Over();
  throw new Stop(what, `假的回复 ${file} 没有`);
}

/* ---------------- 页面（teach-sim） ---------------- */

function sim(...args) {
  const r = spawnSync('node', [SIM, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Stop(`页面 ${args[0]}`, String(r.stderr || r.stdout).trim().slice(0, 500));
  return r.stdout;
}
const lastLine = (out) => String(out).trim().split('\n').at(-1).trim();
const clockMin = () => { try { const st = JSON.parse(read(P('state.json'))); return { seq: st.seq, min: Math.round((st.clock?.s || 0) / 6) / 10 }; } catch { return null; } };

/* ---------------- 一节课 ---------------- */

function lesson() {
  fs.mkdirSync(dir, { recursive: true });
  const initArgs = ['init', dir, path.resolve(scenarioArg)];
  if (opt('--system')) initArgs.push('--system', path.resolve(opt('--system')));
  if (opt('--memory')) initArgs.push('--memory', path.resolve(opt('--memory')));
  process.stdout.write(sim(...initArgs));

  // 老师读的整份说明就是 teach-sim 写的 system.md（真的 buildSystem 拼的，或 --system 原样抄的）
  const teacher = fake ? null : conversation('teacher', models.teacher, 'high');
  if (teacher) teacher.systemFile = P('system.md');
  const student = fake ? null : conversation('student', models.student, undefined, studentSystem(sc));

  try {
    for (;;) {
      const tn = run.teacherTurns + 1;
      const msg = read(P('to-teacher.md'));
      const text = fake ? fakeReply(`t-${tn}.txt`, `第 ${tn} 轮老师`, true) : call(teacher, msg, `第 ${tn} 轮老师`);
      run.teacherTurns = tn;
      fs.writeFileSync(P(`t-${tn}.txt`), text);
      const out = sim('teacher', dir, P(`t-${tn}.txt`));
      process.stdout.write(out);
      run.timeline.push({ who: 'teacher', ...clockMin() });
      saveRun();
      if (lastLine(out) === '到时间了') throw new Over();

      // 学生答；页面按预案接住了就不跑老师，学生接着答
      for (;;) {
        const sn = run.studentTurns + 1;
        if (sn > MAX_STUDENT) throw new Stop(`第 ${sn} 轮学生`, `学生答了 ${MAX_STUDENT} 轮还没下课，页面可能出了毛病`);
        const view = read(P('view.md'));
        let reply;
        if (fake) reply = studentReply(fakeReply(`s-${sn}.json`, `第 ${sn} 轮学生`, true));
        else {
          reply = studentReply(call(student, view, `第 ${sn} 轮学生`));
          // 不是合法 JSON：带着报错重问一次（同一个会话，学生记得自己刚才说了什么）
          if (reply.error) reply = studentReply(call(student, `你上一条回复页面读不出来：${reply.error}。照规矩只回一个 JSON，前后不要别的字。`, `第 ${sn} 轮学生（重问）`));
        }
        let value = reply.value;
        if (!value) { value = { say: '', acts: [] }; run.studentFallbacks++; console.error(`第 ${sn} 轮学生的回复读不出来（${reply.error}），记成学生没有作答`); }
        run.studentTurns = sn;
        fs.writeFileSync(P(`s-${sn}.json`), JSON.stringify(value, null, 1));
        const sOut = sim('student', dir, P(`s-${sn}.json`));
        process.stdout.write(sOut);
        run.timeline.push({ who: 'student', ...clockMin() });
        saveRun();
        if (lastLine(sOut) === '到时间了') throw new Over();
        if (!sOut.includes('页面按预案接了')) break;
      }
    }
  } catch (e) {
    if (!(e instanceof Over)) throw e;
  }
  console.log(`下课：老师 ${run.teacherTurns} 轮，学生 ${run.studentTurns} 轮`);

  sim('transcript', dir);
  sim('posttest', dir);
  // 课后测验：新开一个学生会话，只给人设、原来会的、笔记
  const notebook = fs.existsSync(P('notebook.md')) ? read(P('notebook.md')) : '';
  const post = read(P('posttest.md'));
  const answers = fake ? fakeReply('post.md', '课后测验') : call(conversation('posttest', models.student, undefined, posttestSystem(sc, notebook)), post, '课后测验');
  fs.writeFileSync(P('posttest-answers.md'), answers);

  const metrics = JSON.parse(sim('score', dir))[0];
  fs.writeFileSync(P('metrics.json'), JSON.stringify(metrics, null, 1));

  // 评卷：clockByTurn 让评卷人能把「第几轮」换成「第几分钟」
  const clockByTurn = run.timeline.filter((x) => x.seq !== undefined).map(({ seq, min }) => ({ seq, min }));
  const prompt = graderPrompt({ transcript: read(P('transcript.md')), scenario: sc, key: read(P('posttest-key.md')), answers, metrics: { ...metrics, clockByTurn } });
  let grade;
  if (fake) grade = parseGrade(fakeReply('grade.txt', '评卷'));
  else {
    const grader = conversation('grader', models.grader, 'high', '你是教学评卷人。照用户给的细则打分，只回一个 JSON。');
    grade = parseGrade(call(grader, prompt, '评卷'));
    if (!grade) grade = parseGrade(call(grader, '上一条回复读不出来：字段不对，或者分数不在 0、0.5、1 里，或者总体分不是 1～5 的整数。照细则只回一个 JSON，前后不要别的字。', '评卷（重问）'));
  }
  if (!grade) throw new Stop('评卷', '评卷的回复读不出来');
  fs.writeFileSync(P('grade.json'), JSON.stringify(grade, null, 1));
}

let code = 0;
try {
  lesson();
  run.ok = true;
} catch (e) {
  run.ok = false;
  run.stoppedAt = run.teacherTurns || 0;
  run.stoppedWhat = e instanceof Stop ? e.what : '脚本出错';
  run.error = e.message;
  console.error(`这节课没跑完：停在第 ${run.stoppedAt} 轮（${run.stoppedWhat}）：${e.message}`);
  code = 1;
}
run.ms = Date.now() - t0;
fs.mkdirSync(dir, { recursive: true });
saveRun();
for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
console.log(`run.json：${run.ok ? '跑完了' : '没跑完'}，${(run.ms / 60000).toFixed(1)} 分钟，约 $${run.costUsd.toFixed(2)}`);
process.exit(code);
