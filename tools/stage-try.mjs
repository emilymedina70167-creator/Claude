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
  // 学生直接动画面：照各自画法里造出的那一下（types/*.view.js），走交给学生的那一项（stage.openDone）。
  // 真页面能做多少这里就做多少：只动交给了学生的部件；矩阵的格照拨数器一格一格 ±1、限在 range 里；
  // 写错、舞台演不上的那一下先在场景的副本上试（dryRun），演不上就记成没演上、不交给课堂循环（不然发给老师的会写「舞台已经照做了」）
  const NEED = { write: 'edit', mul: 'explain', swap: 'drag', move: 'drag', vec: 'drag' };
  // 分数 a/b 加整数 k（矩阵里存的是字符串：'-3/2'、'4'）
  const frac = (v) => { const m = String(v ?? '').replace(/[−–]/g, '-').trim().match(/^(-?\d+)(?:\/(\d+))?$/); return m ? [Number(m[1]), Number(m[2] || 1)] : null; };
  const fstr = ([a, b]) => { const g = (x, y) => (y ? g(y, x % y) : Math.abs(x)); const d = g(a, b) || 1; return b / d === 1 ? String(a / d) : `${a / d}/${b / d}`; };
  T.studentDo = async (cmd, rest) => {
    const sc = st.scene;
    const first = rest.split(/\s+/)[0];
    const obj = first.split(/[.#]/)[0];
    const o = sc.objects.get(obj);
    if (!o) return { error: `舞台上没有「${obj}」` };
    const need = NEED[cmd];
    const e = [...sc.opens.values()].find((x) => x.obj === obj && x.action === need);
    if (!e) return { untouched: `${obj} 没有交给学生 ${need}，学生动不了` };
    let one;
    try { one = (ref) => { const p = sc.parts(ref)[0]; if (!p) throw new Error(`「${ref}」不是一个部件`); return p; }; one(first); } catch (err) { return { error: err.message }; }
    // 只交了几个部件（open B.1,1 edit）：别的部件学生碰不到
    const allowed = e.refs.length ? new Set(e.refs.flatMap((r) => sc.parts(r)).map((x) => x.key)) : null;
    const mine = (p) => !allowed || allowed.has(p.key);
    const tryLine = (src) => window.LAStageDev.dryRun(sc, src)[0]?.error || null;
    const go = async (act, src) => {
      const bad = tryLine(src);
      if (bad) return { error: `「${src}」演不上：${bad}` };
      await st.openDone(e, act, src);
      return null;
    };
    try {
      if (cmd === 'write') {
        const [ref, to] = rest.split(/\s+/);
        const x = one(ref);
        if (!mine(x)) return { untouched: `${ref} 没有交给学生 edit（只交了 ${e.refs.join(' ')}），学生动不了` };
        const from = frac(x.value === '' ? '0' : x.value), t = frac(to);
        if (!from || !t) return { error: `拨不到「${to}」：拨数器只能一格一格 ±1 地拨` };
        // 差要是整数才拨得到：from + k = to
        const k = (t[0] * from[1] - from[0] * t[1]) / (t[1] * from[1]);
        if (!Number.isInteger(k)) return { error: `拨不到 ${to}：${ref} 现在是 ${x.value}，拨数器一下只能 ±1` };
        const tv = t[0] / t[1];
        if (tv < e.lo || tv > e.hi) return { error: `拨不到 ${to}：这一格只能在 ${e.lo}～${e.hi} 里拨（range）` };
        let cur = from;
        for (let i = 0; i < Math.abs(k); i++) {
          const nx = [cur[0] + Math.sign(k) * cur[1], cur[1]];
          const r = await go({ type: 'edit', ref, from: fstr(cur), to: fstr(nx) }, `write ${ref} ${fstr(nx)}`);
          if (r) return r;
          cur = nx;
        }
        return { steps: Math.abs(k) };
      }
      if (cmd === 'mul') {
        const x = one(first);
        if (!mine(x)) return { untouched: `${first} 没有交给学生 explain，学生动不了` };
        return (await go({ type: 'explain', ref: first, value: x.value }, `mul ${first}`)) || {};
      }
      if (cmd === 'swap') {
        const [ra, rb] = rest.split(/\s+/);
        const a = one(ra), b = one(rb);
        if (!mine(a) || !mine(b)) return { untouched: `${ra} ${rb} 没有都交给学生，学生动不了` };
        const act = o.type === 'tree'
          ? { type: 'drag', text: `学生把 ${a.value}（${sc.refOf(a)}）拖到 ${b.value}（${sc.refOf(b)}）上，两个结点换了值（舞台已经照做了）`, from: sc.refOf(a), to: sc.refOf(b) }
          : { type: 'drag', a: { key: a.key, value: a.value, slot: a.slot }, b: { key: b.key, value: b.value, slot: b.slot } };
        return (await go(act, `swap ${obj}#${a.key} ${obj}#${b.key}`)) || {};
      }
      if (cmd === 'move') {
        // 照 sentence.view.js 的 drop()：落在第几个词前面 → 发给老师「拖到了「…」后面 / 句首」，场景照 move s#k -> s.N 改
        const m = rest.match(/^(\S+)\s+(?:(after|before)\s+(\S+)|(?:->|→)\s*\S+?\.(\d+))$/);
        if (!m) return { error: '要写成 学生: move s.7 after s.1（或 before s.1、-> s.2）' };
        const x = one(m[1]);
        if (sc.parts(m[1]).length !== 1) return { error: '学生一次只能拖一个词' };
        const ws = [...o.words].sort((p, q) => p.slot - q.slot).filter((w) => w.key !== x.key);
        let count;
        if (m[2]) { const y = one(m[3]); const i = ws.findIndex((w) => w.key === y.key); if (i < 0) return { error: '不能拖到自己旁边' }; count = m[2] === 'after' ? i + 1 : i; }
        else count = Math.max(0, Math.min(ws.length, Number(m[4]) - 1));
        const after = ws[count - 1];
        const where = after ? `「${after.value}」后面` : '句首';
        return (await go({ type: 'drag', text: `学生把「${x.value}」拖到了${where}（舞台已经照做了）`, word: x.value, to: count + 1 }, `move ${obj}#${x.key} -> ${obj}.${count + 1}`)) || {};
      }
      if (cmd === 'vec') {
        // 照 plane.view.js 的 drop()：点写成 point、向量写成 vec；只有平面上已经有的、不是算出来的（u + v、{A v}）才能拖
        const m = rest.match(/^(\w+)\s+(\w+)\s*=\s*(\S+)\s+(\S+)$/);
        if (!m) return { error: '要写成 学生: vec p u = 3 1' };
        const it = (o.items || []).find((x) => x.key === m[2] || x.name === m[2]);
        if (!it) return { error: `平面 ${m[1]} 上没有「${m[2]}」，学生拖不了` };
        if (it.expr || it.live) return { error: `${m[1]}.${m[2]} 是算出来的，学生拖不了` };
        const what = it.kind === 'vec' ? '向量' : '点';
        const act = { type: 'drag', ref: `${m[1]}.${it.name}`, from: [it.x, it.y], to: [m[3], m[4]], text: `学生把${what} ${m[1]}.${it.name}${it.kind === 'vec' ? ' 的末端' : ''}拖到了 (${m[3]}, ${m[4]})（原来在 (${it.x}, ${it.y})），舞台已经照做了` };
        return (await go(act, `${it.kind === 'vec' ? 'vec' : 'point'} ${m[1]} ${it.name} = ${m[3]} ${m[4]}`)) || {};
      }
    } catch (err) { return { error: err.message }; }
    return { error: `不认得「${cmd}」` };
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
      let p;
      try { p = st.scene.parts(ref)[0]; } catch { return null; }
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
  const r = { file: basename(file), views: [] };
  let steps;
  // 一个文件写错（学生那一行的动作不认得）：报出来，接着跑下一个文件
  try { steps = parseTry(readFileSync(file, 'utf8')); } catch (err) {
    crashed = true;
    r.views.push({ tag: '读文件', steps: [], stopped: `读不懂这个文件：${err.message}` });
    results.push(r);
    if (!opt.json) console.log(`${formatReport(r)}\n`);
    continue;
  }
  const segments = steps.filter((s) => s.kind === 'teacher').map((s) => s.src);
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, hasTouch: true, deviceScaleFactor: 1 });
    const view = { tag: v.tag, steps: [], stopped: null };
    try {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${pathToFileURL(PAGE).href}?dev&blank`);
    await page.waitForFunction(() => window.LAStage && window.LAStageDev?.createLoop);
    await page.evaluate(`window.__measure = ${measure.toString()}`);
    await page.evaluate(setup, segments);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
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
    } catch (err) {
      // 工具自己出错：已经演过的步照样交出去，退出码 2
      crashed = true;
      view.stopped = [view.stopped, `工具出错，后面的步没跑：${err.message.split('\n')[0]}`].filter(Boolean).join('\n');
    } finally {
      r.views.push(view);
      await ctx.close().catch(() => {});
    }
  }
  results.push(r);
  if (!opt.json) console.log(`${formatReport(r)}\n`);
}
await browser.close();
if (opt.json) console.log(JSON.stringify(results, null, 2));
process.exit(crashed ? 2 : 0);
