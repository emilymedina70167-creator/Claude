// 舞台试演（docs/superpowers/specs/2026-11-06-stage-gap-ruler-design.md 第 4 节）：一幕镜头指令和几步学生动作，放到真的舞台上演，
// 输出老师那一端会看到的全部东西——每一行演没演上、「舞台现在」、挑战判成什么样、页面叫没叫老师、叫的时候发过去的整条、排版、截图。
//
// 用的是学习台同一份课堂循环（kit/src/stage/loop.js 的 createLoop），只把「叫老师」换成假的：叫老师时交出文件里下一段老师的行。
// 所以页面什么时候叫老师、发过去什么，和真上课一样。只读舞台、不改舞台。
//
//   node tools/stage-try.mjs 文件.txt …     不给文件就跑 tools/stage-try-examples/ 下的全部
//   --shots 目录                            每一步之后竖屏、横屏各存一张
//   --json                                  打印 JSON（不打印报告）
// 页面报错或工具自己出错退出码 2，否则 0（没演上的行、排版问题只写进报告：这是量东西的工具，不是检查）
import { chromium } from './playwright.mjs';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measure } from './stage-measure.mjs';
import { parseTry, formatReport } from './stage-try-lib.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'proto/stage/dist/local.html');
const EXAMPLES = join(ROOT, 'tools/stage-try-examples');
const VIEWS = [{ w: 820, h: 1180, tag: '竖屏' }, { w: 1180, h: 820, tag: '横屏' }];
const SETTLE = 900; // 动画走完再量、再截图
const IDLE_MAX = 30000; // 等课堂循环停下来最多多久

const args = process.argv.slice(2);
const opt = { shots: '', json: false, files: [] };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--shots') opt.shots = resolve(args[++i]);
  else if (args[i] === '--json') opt.json = true;
  else opt.files.push(resolve(args[i]));
}
if (!existsSync(PAGE)) { console.error('没有 proto/stage/dist/local.html：先 node proto/stage/build.mjs'); process.exit(2); }
if (!opt.files.length) opt.files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.txt')).sort().map((f) => join(EXAMPLES, f));
if (opt.shots) mkdirSync(opt.shots, { recursive: true });

// —— 页面里的那一半：建课堂循环（老师是假的），演老师段、做学生的一下、看现在的样子 ——
function setup(segments) {
  const st = window.LAStage;
  const { createLoop, eventsText, goalStatus } = window.LAStageDev;
  const T = window.__try = { queue: segments.map((src, i) => ({ src, i })), played: new Map(), called: null, turns: [], seq: 0 };
  const WHY = { answer: '答了', goal: '做到了挑战', help: '点了提示', stuck: '很久没动', tries: '试了好多下' };
  const never = new Promise(() => {});
  const host = {
    stage: st, model: 'claude-opus-5-5', teach: {}, mock: false, quietMs: 1e9,
    messages: ({ next } = {}) => [{ role: 'user', content: next ? 'SPEC' : 'TURN' }],
    // 叫老师：交出下一段还没演的老师行（只看不拿走：抢跑先要的那一份和真叫的那一份是同一段）；没有了就一直等
    call: async (input, { onText } = {}) => {
      const seg = T.queue[0];
      if (!seg) return never;
      onText?.({ text: seg.src });
      return { text: seg.src, modelApplied: 'claude-opus-5-5' };
    },
    addTurn: (row) => {
      const r = { ...row, seq: ++T.seq };
      if (r.role === 'claude' && T.queue[0] && T.queue[0].src === r.text) { r.segment = T.queue.shift().i; }
      T.turns.push(r);
      return r;
    },
    putTurn: (row) => {
      if (row.role === 'claude' && row.segment != null && row.log) {
        T.played.set(row.segment, { played: row.log.filter((x) => x.by === 'teacher').length, errors: [...st.errors].map((e) => ({ line: e.line, src: e.src, error: e.error })) });
      }
      if (row.role === 'student' && !row.pending) {
        const ev = [...(row.events || [])].reverse().find((e) => !e.quiet && WHY[e.kind]);
        T.called = { why: WHY[ev?.kind] || '（没认出来）', msg: row.msg, state: st.scene.stateText(), goals: T.goals() };
      }
    },
    thinking: () => {}, note: () => {}, cost: (c) => c, report: (err) => { T.reportErr = String(err?.message || err); },
  };
  T.loop = createLoop(host);
  st.onAct = (a) => T.loop.onAct(a);
  T.goals = () => [...st.scene.goals.values()].map((g) => ({ id: g.id, text: g.text, status: goalStatus(st.scene, g) }));
  T.pending = () => eventsText(T.loop.pending?.events || [], { goals: st.scene.goals });
  // 课堂循环停下来了：不在叫老师、不在演；或者在等一个永远不会来的老师（文件里没有老师段了）
  T.idle = () => {
    const S = T.loop.state;
    if (S.flight && !T.queue.length) return 'waiting';
    return !S.busy && !S.flight && !S.flushing ? 'idle' : '';
  };
  T.settle = async (max) => {
    const t0 = Date.now();
    for (;;) {
      const s = T.idle();
      if (s === 'waiting') return s;
      if (s === 'idle') {
        // 做到挑战以后预写的行是另起的一串（stage.react 换掉 st.reacting），学生那一下落定后才判挑战：
        // 等到这几样一段时间里都没换、循环也没动，才算停下来
        const marks = [T.loop.state.playing, st.studentChain, st.reacting];
        await Promise.all(marks).catch(() => {});
        await new Promise((r) => setTimeout(r, 150));
        const same = [T.loop.state.playing, st.studentChain, st.reacting].every((p, i) => p === marks[i]);
        if (same && T.idle() === 'idle') return 'idle';
        continue;
      }
      if (Date.now() - t0 > max) return 'timeout';
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  // 学生直接动画面：照各自画法里造出的那一下（types/*.view.js），走交给学生的那一项（stage.openDone）
  const NEED = { write: 'edit', mul: 'explain', swap: 'drag', move: 'drag', vec: 'drag' };
  T.studentDo = (cmd, rest) => {
    const sc = st.scene;
    const first = rest.split(/\s+/)[0];
    const obj = first.split(/[.#]/)[0];
    const o = sc.objects.get(obj);
    if (!o) return { error: `舞台上没有「${obj}」` };
    const need = NEED[cmd];
    const e = [...sc.opens.values()].find((x) => x.obj === obj && x.action === need);
    if (!e) return { untouched: `${obj} 没有交给学生 ${need}，学生动不了` };
    const one = (ref) => sc.parts(ref)[0];
    let act, src;
    if (cmd === 'write') {
      const [ref, to] = rest.split(/\s+/);
      act = { type: 'edit', ref, from: one(ref).value, to };
      src = `write ${ref} ${to}`;
    } else if (cmd === 'mul') {
      act = { type: 'explain', ref: first, value: one(first).value };
      src = `mul ${first}`;
    } else if (cmd === 'swap') {
      const [ra, rb] = rest.split(/\s+/);
      const a = one(ra), b = one(rb);
      act = o.type === 'tree'
        ? { type: 'drag', text: `学生把 ${a.value}（${sc.refOf(a)}）拖到 ${b.value}（${sc.refOf(b)}）上，两个结点换了值（舞台已经照做了）`, from: sc.refOf(a), to: sc.refOf(b) }
        : { type: 'drag', a: { key: a.key, value: a.value, slot: a.slot }, b: { key: b.key, value: b.value, slot: b.slot } };
      src = `swap ${obj}#${a.key} ${obj}#${b.key}`;
    } else if (cmd === 'move') {
      const w = one(first);
      act = { type: 'drag', text: `学生把「${w.value}」拖到了 ${rest.slice(first.length).trim()}（舞台已经照做了）`, word: w.value };
      src = `move ${rest}`;
    } else if (cmd === 'vec') {
      const m = rest.match(/^(\w+)\s+(\w+)\s*=\s*(\S+)\s+(\S+)$/);
      if (!m) return { error: '要写成 学生: vec p u = 3 1' };
      const it = (o.items || []).find((x) => x.key === m[2] || x.name === m[2]) || {};
      act = { type: 'drag', ref: `${m[1]}.${m[2]}`, from: [it.x, it.y], to: [m[3], m[4]], text: `学生把向量 ${m[1]}.${m[2]} 的末端拖到了 (${m[3]}, ${m[4]})（原来在 (${it.x}, ${it.y})），舞台已经照做了` };
      src = `vec ${rest}`;
    }
    st.openDone(e, act, src);
    return {};
  };
  // 回答正在等的那一问：next / value / say 照真的按钮和输入框；tap / drag 给出部件在屏幕上的中心，手指在外面按
  T.answer = (cmd, rest) => {
    const w = st.scene.waiting;
    if (!w) return { error: '现在没有在等的那一问' };
    if (cmd === 'next') {
      const b = [...st.dock.querySelectorAll('.st-next')].at(-1);
      if (!b) return { error: '底下没有按钮' };
      b.click();
      return {};
    }
    if (cmd === 'value' || cmd === 'say') {
      const input = st.dock.querySelector('#st-say-input');
      if (!input) return { error: '底下没有输入框' };
      input.value = rest;
      input.form.requestSubmit();
      return {};
    }
    const center = (ref) => {
      const p = st.scene.parts(ref)[0];
      const n = p && st.nodes.get(`${p.obj}:${p.key}`);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const refs = rest.split(/\s+/).filter(Boolean);
    const pts = refs.map(center);
    if (pts.some((p) => !p)) return { error: `找不到「${refs.join(' ')}」画在哪` };
    return { touch: pts };
  };
  T.state = () => st.scene.stateText();
}

const browser = await chromium.launch();
let crashed = false;
const results = [];
for (const file of opt.files) {
  const steps = parseTry(readFileSync(file, 'utf8'));
  const segments = steps.filter((s) => s.kind === 'teacher').map((s) => s.src);
  const r = { file: basename(file), views: [] };
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, hasTouch: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${pathToFileURL(PAGE).href}?dev&blank`);
    await page.waitForFunction(() => window.LAStage && window.LAStageDev?.createLoop);
    await page.evaluate(`window.__measure = ${measure.toString()}`);
    await page.evaluate(setup, segments);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const view = { tag: v.tag, steps: [], stopped: null };
    let seg = -1;
    for (let k = 0; k < steps.length; k++) {
      const step = steps[k];
      const out = { step, played: 0, errors: [], state: '', goals: [], called: null, pending: '', untouched: null, issues: [], shot: '' };
      await page.evaluate(() => { window.__try.called = null; });
      if (step.kind === 'teacher') {
        seg++;
        // 学生前面的动作已经让页面叫了老师，这一段就已经演了；没有的话，工具自己叫一次（报告里写明）
        const done = await page.evaluate((i) => window.__try.played.has(i), seg);
        if (!done) {
          if (k > 0) out.note = '这一段前面学生的动作没有让页面叫老师，工具自己叫了一次';
          await page.evaluate(() => { window.__try.loop.teach('turn'); });
        }
        const s = await page.evaluate((max) => window.__try.settle(max), IDLE_MAX);
        const got = await page.evaluate((i) => window.__try.played.get(i) || null, seg);
        if (got) Object.assign(out, got);
        else out.errors.push({ line: step.line, src: '', error: `这一段没演完（${s}）` });
      } else {
        const res = step.how === 'do'
          ? await page.evaluate(([c, a]) => window.__try.studentDo(c, a), [step.cmd, step.args])
          : await page.evaluate(([c, a]) => window.__try.answer(c, a), [step.cmd, step.args]);
        if (res.error) out.errors.push({ line: step.line, src: step.src, error: res.error });
        if (res.untouched) out.untouched = res.untouched;
        if (res.touch) {
          const [a, b = a] = res.touch;
          await touch('touchStart', a.x, a.y);
          if (b !== a) for (let i = 1; i <= 8; i++) { await touch('touchMove', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8); await page.waitForTimeout(16); }
          await touch('touchEnd');
        }
        await page.waitForTimeout(80);
        await page.evaluate((max) => window.__try.settle(max), IDLE_MAX);
      }
      await page.waitForTimeout(SETTLE);
      const snap = await page.evaluate(() => { const T = window.__try; return { called: T.called, state: T.state(), goals: T.goals(), pending: T.pending(), idle: T.idle() }; });
      if (snap.called) out.called = { why: snap.called.why, msg: snap.called.msg };
      out.state = snap.called?.state || snap.state;
      out.goals = snap.called?.goals || snap.goals;
      out.pending = snap.pending;
      if (out.note) out.state = `（${out.note}）\n${out.state}`;
      out.issues = (await page.evaluate(() => window.__measure()))?.issues || [];
      if (opt.shots) { out.shot = join(opt.shots, `${basename(file, '.txt')}-${v.tag}-${k + 1}.png`); await page.screenshot({ path: out.shot }); }
      for (const e of errs.splice(0)) { out.errors.push({ line: 0, src: '', error: `页面报错：${e}` }); crashed = true; }
      view.steps.push(out);
      // 页面在等老师，文件里又没有老师段了：后面的不跑
      if (snap.idle === 'waiting' && k < steps.length - 1) { view.stopped = `后面的步没跑：页面在等老师（第 ${k + 2} 步起还有 ${steps.length - k - 1} 步）`; break; }
    }
    const rep = await page.evaluate(() => window.__try.reportErr || null);
    if (rep) { view.stopped = [view.stopped, `课堂循环报错：${rep}`].filter(Boolean).join('\n'); crashed = true; }
    r.views.push(view);
    await ctx.close();
  }
  results.push(r);
  if (!opt.json) console.log(`${formatReport(r)}\n`);
}
await browser.close();
if (opt.json) console.log(JSON.stringify(results, null, 2));
process.exit(crashed ? 2 : 0);
