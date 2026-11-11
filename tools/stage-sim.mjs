// 模拟一节舞台课（docs/stage-mainline.md：真课太少时拿它量「老师写了什么、卡在哪」）。
// 页面是真的舞台和真的课堂循环（tools/stage-try.mjs）；老师、学生各是一个子代理，隔着这个脚本轮流走，互相看不到对方的文件：
//   老师只看 system.md（真的 firstMessage：说明 + 这节课 + 资料）和每一轮页面发来的 to-teacher-N.md（真的那一条）；
//   学生只看 view.md / view.png（屏幕上看得见的）和自己的设定 persona.md。
// 量不出来的：等的时间（出第一个字之前那一段是平台上的事）。量得出的：没演上的行、用了哪些写法、哪里想做做不成。
//
//   node tools/stage-sim.mjs init <目录> --subject 数据结构 --topic "…" --material 文件.md [--turns 10]
//   node tools/stage-sim.mjs teacher <目录> <老师这一轮写的文件>
//   node tools/stage-sim.mjs student <目录> <学生这一下写的文件>
//   node tools/stage-sim.mjs wait <目录> teacher|student      等轮到自己（最多 100 秒，没到就再跑一次）
//   node tools/stage-sim.mjs report <目录…>
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { firstMessage } from '../kit/src/stage/doc.js';
import { STUDENT_FORMS } from './stage-try-lib.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, dirArg, ...rest] = process.argv.slice(2);
if (!cmd || !dirArg) { console.error('用法见文件开头'); process.exit(2); }
const dir = resolve(dirArg);
const P = (f) => join(dir, f);
const read = (f) => readFileSync(P(f), 'utf8');
const state = () => JSON.parse(read('state.json'));
const save = (s) => writeFileSync(P('state.json'), JSON.stringify(s, null, 2));
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : ''; };

/** 把现在的 scene.txt 放到真的舞台上演一遍（只演竖屏），返回那一个朝向的结果 */
function play() {
  const r = spawnSync('node', [join(ROOT, 'tools/stage-try.mjs'), P('scene.txt'), '--json', '--shots', P('shots')], { encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, STAGE_TRY_VIEWS: '竖屏' } });
  let out;
  try { out = JSON.parse(r.stdout); } catch { throw new Error(`试演没跑成：${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' / ')}`); }
  return out[0].views[0];
}

/** 学生看得到的：屏幕上的字、能动什么、怎么写（现状里带答案的行——答案、挑战的条件、预写、页面算的——不给） */
function studentView(step, { note = '' } = {}) {
  const keep = (l) => /^\S/.test(l) && !/^(预写|盯着|挑战|页面|答案|你|最后说的话|（离)/.test(l);
  const st = String(step?.state || '').split('\n').filter(keep).join('\n');
  writeFileSync(P('view.md'), [
    note ? `## 页面刚才告诉你\n${note}` : '',
    `## 屏幕上的字（从上到下；画面见 view.png）\n${step?.screen || '（空的）'}`,
    `## 舞台上有什么、你能动什么（名字是写动作用的）\n${st || '（没有）'}`,
    `## 你能写的动作（一行一下；写在一个文件里交给页面）\n${STUDENT_FORMS}`,
  ].filter(Boolean).join('\n\n') + '\n');
  if (step?.shot && existsSync(step.shot)) copyFileSync(step.shot, P('view.png'));
}

const errText = (e) => `第 ${e.line} 行「${e.src}」：${e.error}`;

if (cmd === 'init') {
  mkdirSync(P('shots'), { recursive: true });
  const material = flag('material') ? readFileSync(resolve(flag('material')), 'utf8') : '';
  writeFileSync(P('system.md'), firstMessage({ topic: flag('topic'), material, subject: flag('subject') }) + '\n');
  writeFileSync(P('scene.txt'), '');
  save({ who: 'teacher', n: 1, max: Number(flag('turns')) || 10, log: [] });
  console.log(`建好了 ${dir}：老师读 system.md 写第 1 轮`);
} else if (cmd === 'wait') {
  const role = rest[0];
  const t0 = Date.now();
  for (;;) {
    const s = state();
    if (s.who === 'done') { console.log('下课了：这节课到此为止，不用再写。'); break; }
    if (s.who === role) { console.log(role === 'teacher' ? `轮到你了：读 to-teacher-${s.n}.md，写第 ${s.n} 轮` : '轮到你了：看 view.md 和 view.png，写你要做的动作'); break; }
    if (Date.now() - t0 > 100000) { console.log('还没轮到你：再跑一次这条命令接着等。'); break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
} else if (cmd === 'teacher') {
  const s = state();
  if (s.who !== 'teacher') { console.error(s.who === 'done' ? '下课了' : '还没轮到老师：先 wait'); process.exit(1); }
  const src = readFileSync(resolve(rest[0]), 'utf8').replace(/\r/g, '').trim();
  if (/^\s*学生\s*[:：]/m.test(src)) { console.error('老师的这一轮里不能写「学生:」的行（学生的动作由学生自己做）'); process.exit(1); }
  if (!src) { console.error('这一轮是空的'); process.exit(1); }
  writeFileSync(P(`t-${s.n}.txt`), src + '\n');
  const before = read('scene.txt');
  writeFileSync(P('scene.txt'), `${before}# —— 老师第 ${s.n} 轮 ——\n${src}\n`);
  const view = play();
  const step = view.steps.at(-1);
  const errs = step?.errors || [];
  s.log.push({ n: s.n, by: 'teacher', lines: src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length, played: step?.played ?? 0, errors: errs.map(errText), issues: (step?.issues || []).map((i) => `${i.what}：${i.a}${i.b ? ` 和 ${i.b}` : ''}`), stopped: view.stopped || null });
  s.who = 'student';
  save(s);
  studentView(step);
  // 和真课一样：老师这时候不知道哪几行没演上，下一轮页面那一条里才写
  console.log(`第 ${s.n} 轮交给页面了。现在等学生：node tools/stage-sim.mjs wait ${dirArg} teacher`);
} else if (cmd === 'student') {
  const s = state();
  if (s.who !== 'student') { console.error(s.who === 'done' ? '下课了' : '还没轮到你：先 wait'); process.exit(1); }
  const lines = readFileSync(resolve(rest[0]), 'utf8').replace(/\r/g, '').split('\n').map((l) => l.trim().replace(/^学生\s*[:：]\s*/, '')).filter(Boolean);
  if (!lines.length) { console.error('没写动作'); process.exit(1); }
  const before = read('scene.txt');
  const nSteps0 = play().steps.length;
  writeFileSync(P('scene.txt'), before + lines.map((l) => `学生: ${l}`).join('\n') + '\n');
  let view;
  try { view = play(); } catch (e) { writeFileSync(P('scene.txt'), before); console.log(`这几行页面读不懂，没做：${e.message}`); process.exit(0); }
  if (view.tag === '读文件') { writeFileSync(P('scene.txt'), before); console.log(`这几行页面读不懂，一下也没做（照 view.md 里「你能写的动作」的写法改）：${view.stopped}`); process.exit(0); }
  const mine = view.steps.slice(nSteps0);
  const done = [], failed = [];
  mine.forEach((st, i) => { const bad = (st.errors || []).length || st.untouched; (bad ? failed : done).push({ line: lines[i], why: bad ? [...(st.errors || []).map((e) => e.error), st.untouched].filter(Boolean).join('；') : '' }); });
  const skipped = lines.slice(mine.length); // 页面叫了老师以后的几下没做
  // 没做成的、没轮到的几行不留在 scene.txt 里（下一次重放不再试）
  writeFileSync(P('scene.txt'), before + done.map((d) => `学生: ${d.line}`).join('\n') + (done.length ? '\n' : ''));
  const called = [...mine].reverse().find((st) => st.called)?.called || null;
  const note = [
    done.length ? `做了：${done.map((d) => d.line).join('；')}` : '',
    failed.length ? `没做成：${failed.map((d) => `${d.line}（${d.why}）`).join('；')}` : '',
    skipped.length ? `没轮到（老师已经在回应了）：${skipped.join('；')}` : '',
  ].filter(Boolean).join('\n');
  s.log.push({ n: s.n, by: 'student', done: done.map((d) => d.line), failed: failed.map((d) => `${d.line}（${d.why}）`), called: called?.why || null });
  if (called) {
    s.n += 1;
    if (s.n > s.max) { s.who = 'done'; writeFileSync(P('last-to-teacher.md'), called.msg + '\n'); }
    else { s.who = 'teacher'; writeFileSync(P(`to-teacher-${s.n}.md`), called.msg + '\n'); }
    save(s);
    console.log(`${note}\n页面叫老师了（${called.why}）。${s.who === 'done' ? '下课了。' : `等老师写完：node tools/stage-sim.mjs wait ${dirArg} student`}`);
  } else {
    save(s);
    studentView(mine.at(-1) || view.steps.at(-1), { note });
    console.log(`${note}\n页面没叫老师（你手上还有事，或者这一下不算答完）：看 view.md 接着做；实在不知道做什么就写 say 加你想说的话，或者 next。`);
  }
} else if (cmd === 'report') {
  for (const d of [dirArg, ...rest]) {
    const s = JSON.parse(readFileSync(join(resolve(d), 'state.json'), 'utf8'));
    const T = s.log.filter((x) => x.by === 'teacher'), U = s.log.filter((x) => x.by === 'student');
    const lines = T.reduce((n, x) => n + x.lines, 0), bad = T.reduce((n, x) => n + x.errors.length, 0);
    console.log(`## ${d}\n老师 ${T.length} 轮、${lines} 行，没演上 ${bad} 行（${lines ? Math.round(bad / lines * 100) : 0}%）；学生 ${U.length} 次、做成 ${U.reduce((n, x) => n + x.done.length, 0)} 下、没做成 ${U.reduce((n, x) => n + x.failed.length, 0)} 下`);
    for (const x of T) { for (const e of x.errors) console.log(`- 第 ${x.n} 轮没演上：${e}`); for (const i of x.issues) console.log(`- 第 ${x.n} 轮排版：${i}`); if (x.stopped) console.log(`- 第 ${x.n} 轮：${x.stopped}`); }
    for (const x of U) for (const f of x.failed) console.log(`- 学生第 ${x.n} 轮没做成：${f}`);
    console.log(`叫老师的原因：${U.filter((x) => x.called).map((x) => x.called).join('、')}`);
  }
} else { console.error(`不认识的命令：${cmd}`); process.exit(2); }
