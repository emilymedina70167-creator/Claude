// 教学尺子（evals/teaching/）：用命令行自动跑完一节模拟课、课后测验和评卷。
// 以前是开发的人手工轮流派子代理扮老师和学生；现在这个脚本轮流调用 `claude -p`，中间每一步都交给 tools/teach-sim.mjs（页面）。
//
//   node tools/teach-run.mjs <目录> <场景.json> [--system 文件] [--memory 文件]
//        [--teacher claude-opus-5-5] [--student claude-sonnet-5-5] [--grader claude-opus-5-5] [--fake 目录] [--cli 命令]
//   node tools/teach-run.mjs <目录> --continue          从停下的那一步接着跑（参数都从 run.json 读）
//
// 目录里留下：t-N.txt（老师第 N 轮）、s-N.json（学生第 N 轮）、transcript.md、posttest-answers.md、metrics.json、grade.json、
// run.json（成没成、停在哪、每个角色的会话、每次调用花了多少）；还有 teach-sim 自己的 state.json、view.md、notebook.md、posttest.md 等。
//
// 每个角色一个会话（老师、学生、课后测验的学生、评卷人），各自在仓库外的一个空临时目录里跑，环境变量只留登录和代理要的：
// 模型没有工具、读不到任何文件，扮学生的看不到 scenario.json 里的答案，学生需要的东西全在提示词里。
// 续会话一律 --resume <上一次成功的会话> --fork-session（teach-run-lib.mjs 的 cliArgs）：失败的那一次留在它自己的分叉里，重试和下一轮都从成功的那个点接，
// 作废的回复（空的、模型不对的）不会进老师的上下文。
//
// 出错：
// - 撞了用量上限（429、rate_limit、「hit your … limit」）：不重试、不算失败，run.json 写 paused: true、停在哪一步、各角色的会话、已经花的钱，退出码 2。
// - 别的错（返回空、超时 10 分钟、退出码非 0、不是 JSON、用的不是要的模型）重试一次，再不成 failed: true，同样记下停在哪，退出码 1。
//   两种都能 --continue：那一步还没完成的调用重新发。没跑完的课不评卷——半节课的分数混进一整套会把结果拉偏。
// 「停在哪」只在每一轮交给页面（teach-sim）之后才往前记，所以接着跑时页面的状态和会话的状态对得上。
//
// --fake 目录：不调用命令行（测试用）。老师读 目录/t-N.txt、学生读 目录/s-N.json、课后测验读 目录/post.md、评卷读 目录/grade.txt；
// 老师、学生的文件没了就当「到时间了」。--cli：换一个和 claude 同样参数、同样输出的程序（测试里用假的命令行）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cliArgs, cleanEnv, isUsageLimit, projectDirOf, studentSystem, posttestSystem, studentReply, graderPrompt, parseGrade } from './teach-run-lib.mjs';

const SIM = new URL('./teach-sim.mjs', import.meta.url).pathname;
const TIMEOUT = 10 * 60 * 1000;
// 学生一直被预案接住、老师一直不跑时的保险：钟本来会让它下课，这里只防 teach-sim 出毛病时死循环
const MAX_STUDENT = 150;
const USAGE = '用法：node tools/teach-run.mjs <目录> <场景.json> [--system 文件] [--memory 文件] [--teacher 模型] [--student 模型] [--grader 模型] [--fake 目录] [--cli 命令]\n      node tools/teach-run.mjs <目录> --continue';

const argv = process.argv.slice(2);
const FLAGS = new Set(['--continue']);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !FLAGS.has(argv[i - 1])));
const cont = argv.includes('--continue');
if (!pos[0] || (!cont && !pos[1])) { console.error(USAGE); process.exit(2); }
const dir = path.resolve(pos[0]);
const P = (f) => path.join(dir, f);
const read = (f) => fs.readFileSync(f, 'utf8');
const readJson = (f) => { try { return JSON.parse(read(f)); } catch { return null; } };

/* ---------------- run.json：这一节跑到哪了 ---------------- */

let run;
if (cont) {
  run = readJson(P('run.json'));
  if (!run || !(run.paused || run.failed) || !run.phase) { console.error(`${P('run.json')} 不是一节停下的课，接不了`); process.exit(2); }
  run.paused = false; run.failed = false; delete run.error; delete run.stoppedAt; delete run.stoppedWhat;
  run.continued = (run.continued || 0) + 1;
} else {
  // 从头跑：上一次留下的产物先删掉，免得失败时被当成这一次的
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^(t-\d+\.txt|s-\d+\.json|metrics\.json|grade\.json|run\.json|posttest-answers\.md|notebook\.md|transcript\.md)$/.test(f)) fs.rmSync(P(f));
  run = {
    ok: false, paused: false, failed: false, scenario: null, scenarioFile: path.resolve(pos[1]),
    opts: { system: opt('--system') ? path.resolve(opt('--system')) : null, memory: opt('--memory') ? path.resolve(opt('--memory')) : null, fake: opt('--fake') ? path.resolve(opt('--fake')) : null, cli: opt('--cli') || 'claude' },
    models: { teacher: opt('--teacher', 'claude-opus-5-5'), student: opt('--student', 'claude-sonnet-5-5'), grader: opt('--grader', 'claude-opus-5-5') },
    phase: 'init', next: 'teacher', teacherTurns: 0, studentTurns: 0, studentFallbacks: 0,
    sessions: {}, calls: [], costUsd: 0, timeline: [], startedAt: new Date().toISOString(), ms: 0,
  };
}
const sc = JSON.parse(read(cont ? P('scenario.json') : run.scenarioFile));
run.scenario = sc.id;
const fake = run.opts.fake;
const saveRun = () => fs.writeFileSync(P('run.json'), JSON.stringify(run, null, 1));
const t0 = Date.now();

class Stop extends Error { constructor(what, msg) { super(msg); this.what = what; } }
class Pause extends Stop {}
// 正常下课（到时间了、假的回复用完了）
class Over extends Error {}

/* ---------------- 调用模型 ---------------- */

const convs = {};
/** 一个角色一个会话；接着跑时用 run.json 里记着的会话和目录 */
function conversation(role, model, effort, systemFile) {
  const was = run.sessions[role];
  const cwd = was?.cwd || fs.mkdtempSync(path.join(os.tmpdir(), `teach-${role}-`));
  fs.mkdirSync(cwd, { recursive: true }); // 接着跑时目录被清掉了：同一个路径再建一个，会话还在 ~/.claude/projects/ 下
  const c = { role, model, effort, cwd, systemFile, session: was?.session || null };
  convs[role] = c;
  if (!was) run.sessions[role] = { session: null, cwd };
  return c;
}
/** 记一个点：这个角色接下去从这个会话分叉（只在这一轮交给页面以后记，接着跑时页面和会话对得上） */
const commit = (c) => { run.sessions[c.role] = { session: c.session, cwd: c.cwd }; };

/** 调一次命令行；返回 { text, session } 或 { err, limit } */
function callOnce(conv, message) {
  const args = cliArgs({ model: conv.model, effort: conv.effort, systemFile: conv.session ? undefined : conv.systemFile, resume: conv.session || undefined });
  const t = Date.now();
  // 话从标准输入给：老师第一轮之后每轮的现状、评卷的整份材料都可能超过命令行一个参数的上限
  const r = spawnSync(run.opts.cli, args, { cwd: conv.cwd, input: message, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024, env: cleanEnv(process.env) });
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
  const limit = !!err && isUsageLimit(`${err}\n${r.stderr || ''}`);
  run.calls.push({ role: conv.role, ok: !err, ms, cost, session: out?.session_id || null, ...(err ? { error: err } : {}), ...(limit ? { limit: true } : {}) });
  run.costUsd = Math.round((run.costUsd + cost) * 1e4) / 1e4;
  if (err) return { err, limit };
  return { text: String(out.result), session: out.session_id || null };
}
function call(conv, message, what) {
  let r = callOnce(conv, message);
  if (r.limit) throw new Pause(what, r.err);
  if (r.err) { console.error(`${what}：${r.err}，重试一次`); r = callOnce(conv, message); }
  if (r.limit) throw new Pause(what, r.err);
  if (r.err) throw new Stop(what, r.err);
  // 成功了才换到新的分叉；失败的分叉没人再接
  if (r.session) conv.session = r.session;
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
const clockMin = () => { const st = readJson(P('state.json')); return st ? { seq: st.seq, min: Math.round((st.clock?.s || 0) / 6) / 10 } : {}; };

/* ---------------- 一节课，分几步，每步做完记一下 ---------------- */

function lessonLoop() {
  // 老师读的整份说明就是 teach-sim 写的 system.md（真的 buildSystem 拼的，或 --system 原样抄的）
  const teacher = fake ? null : conversation('teacher', run.models.teacher, 'high', P('system.md'));
  let student = null;
  if (!fake) {
    if (!fs.existsSync(P('student-system.md'))) fs.writeFileSync(P('student-system.md'), studentSystem(sc));
    student = conversation('student', run.models.student, undefined, P('student-system.md'));
  }
  try {
    for (;;) {
      if (run.next === 'teacher') {
        const tn = run.teacherTurns + 1;
        const text = fake ? fakeReply(`t-${tn}.txt`, `第 ${tn} 轮老师`, true) : call(teacher, read(P('to-teacher.md')), `第 ${tn} 轮老师`);
        fs.writeFileSync(P(`t-${tn}.txt`), text);
        const out = sim('teacher', dir, P(`t-${tn}.txt`));
        process.stdout.write(out);
        run.teacherTurns = tn;
        run.next = 'student';
        if (teacher) commit(teacher);
        run.timeline.push({ who: 'teacher', ...clockMin() });
        saveRun();
        if (lastLine(out) === '到时间了') throw new Over();
      }
      // 学生答；页面按预案接住了就不跑老师，学生接着答
      const sn = run.studentTurns + 1;
      if (sn > MAX_STUDENT) throw new Stop(`第 ${sn} 轮学生`, `学生答了 ${MAX_STUDENT} 轮还没下课，页面可能出了毛病`);
      const view = read(P('view.md'));
      let reply;
      if (fake) reply = studentReply(fakeReply(`s-${sn}.json`, `第 ${sn} 轮学生`, true));
      else {
        reply = studentReply(call(student, view, `第 ${sn} 轮学生`));
        // 不是合法 JSON：带着报错重问一次（接着刚才那条回复问，学生记得自己说了什么）
        if (reply.error) reply = studentReply(call(student, `你上一条回复页面读不出来：${reply.error}。照规矩只回一个 JSON，前后不要别的字。`, `第 ${sn} 轮学生（重问）`));
      }
      let value = reply.value;
      if (!value) { value = { say: '', acts: [] }; run.studentFallbacks++; console.error(`第 ${sn} 轮学生的回复读不出来（${reply.error}），记成学生没有作答`); }
      fs.writeFileSync(P(`s-${sn}.json`), JSON.stringify(value, null, 1));
      const sOut = sim('student', dir, P(`s-${sn}.json`));
      process.stdout.write(sOut);
      run.studentTurns = sn;
      run.next = sOut.includes('页面按预案接了') ? 'student' : 'teacher';
      if (student) commit(student);
      run.timeline.push({ who: 'student', ...clockMin() });
      saveRun();
      if (lastLine(sOut) === '到时间了') throw new Over();
    }
  } catch (e) {
    if (!(e instanceof Over)) throw e;
  }
  // 假的回复一轮老师都没有：不是一节课
  if (!run.teacherTurns) throw new Stop('第 1 轮老师', '一轮老师都没有');
  console.log(`下课：老师 ${run.teacherTurns} 轮，学生 ${run.studentTurns} 轮`);
}

function posttestStep() {
  sim('transcript', dir);
  sim('posttest', dir);
  // 课后测验：新开一个学生会话，只给人设、原来会的、笔记；每次都从头开（接着跑也一样，没有要续的）
  const notebook = fs.existsSync(P('notebook.md')) ? read(P('notebook.md')) : '';
  fs.writeFileSync(P('posttest-system.md'), posttestSystem(sc, notebook));
  delete run.sessions.posttest;
  const answers = fake ? fakeReply('post.md', '课后测验') : call(conversation('posttest', run.models.student, undefined, P('posttest-system.md')), read(P('posttest.md')), '课后测验');
  fs.writeFileSync(P('posttest-answers.md'), answers);
}

function gradeStep() {
  const metrics = JSON.parse(sim('score', dir))[0];
  fs.writeFileSync(P('metrics.json'), JSON.stringify(metrics, null, 1));
  // 评卷：clockByTurn 让评卷人能把「第几轮」换成「第几分钟」
  const clockByTurn = run.timeline.filter((x) => x.seq !== undefined).map(({ seq, min }) => ({ seq, min }));
  const prompt = graderPrompt({ transcript: read(P('transcript.md')), scenario: sc, key: read(P('posttest-key.md')), answers: read(P('posttest-answers.md')), metrics: { ...metrics, clockByTurn } });
  let grade;
  if (fake) grade = parseGrade(fakeReply('grade.txt', '评卷'));
  else {
    fs.writeFileSync(P('grader-system.md'), '你是教学评卷人。照用户给的细则打分，只回一个 JSON。');
    delete run.sessions.grader;
    const grader = conversation('grader', run.models.grader, 'high', P('grader-system.md'));
    grade = parseGrade(call(grader, prompt, '评卷'));
    if (!grade) grade = parseGrade(call(grader, '上一条回复读不出来：字段不对，或者分数不在 0、0.5、1 里，或者总体分不是 1～5 的整数。照细则只回一个 JSON，前后不要别的字。', '评卷（重问）'));
  }
  if (!grade) throw new Stop('评卷', '评卷的回复读不出来');
  fs.writeFileSync(P('grade.json'), JSON.stringify(grade, null, 1));
}

/** 跑完了：这一节自己的临时目录和命令行存在 ~/.claude/projects/ 下的会话都删掉（暂停、失败的不删，接着跑要用） */
function cleanup() {
  for (const { cwd } of Object.values(run.sessions)) {
    if (!cwd || !path.basename(cwd).startsWith('teach-')) continue;
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(path.join(os.homedir(), '.claude', 'projects', projectDirOf(cwd)), { recursive: true, force: true });
  }
}

let code = 0;
try {
  if (run.phase === 'init') {
    const initArgs = ['init', dir, run.scenarioFile];
    if (run.opts.system) initArgs.push('--system', run.opts.system);
    if (run.opts.memory) initArgs.push('--memory', run.opts.memory);
    process.stdout.write(sim(...initArgs));
    run.phase = 'lesson'; saveRun();
  }
  if (run.phase === 'lesson') { lessonLoop(); run.phase = 'posttest'; saveRun(); }
  if (run.phase === 'posttest') { posttestStep(); run.phase = 'grade'; saveRun(); }
  if (run.phase === 'grade') { gradeStep(); run.phase = 'done'; }
  run.ok = true;
} catch (e) {
  run.ok = false;
  const pause = e instanceof Pause;
  run[pause ? 'paused' : 'failed'] = true;
  run.stoppedAt = run.next === 'teacher' && run.phase === 'lesson' ? run.teacherTurns + 1 : run.teacherTurns || 0;
  run.stoppedWhat = e instanceof Stop ? e.what : '脚本出错';
  run.error = e.message;
  console.error(`这节课${pause ? '暂停了（用量上限）' : '没跑完'}：停在第 ${run.stoppedAt} 轮（${run.stoppedWhat}）：${e.message}${run.phase !== 'init' ? `\n接着跑：node tools/teach-run.mjs ${dir} --continue` : ''}`);
  code = pause ? 2 : 1;
}
run.ms = (run.ms || 0) + (Date.now() - t0);
saveRun();
if (run.ok) cleanup();
console.log(`run.json：${run.ok ? '跑完了' : run.paused ? '暂停了' : '没跑完'}，${(run.ms / 60000).toFixed(1)} 分钟，约 $${run.costUsd.toFixed(2)}`);
process.exit(code);
