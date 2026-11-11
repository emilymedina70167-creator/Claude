// 舞台试演（docs/superpowers/specs/2026-11-06-stage-gap-ruler-design.md 第 4 节）：一幕镜头指令和几步学生动作，放到真的舞台上演，
// 输出老师那一端会看到的全部东西——每一行演没演上、「舞台现在」、挑战判成什么样、页面叫没叫老师、叫的时候发过去的整条、排版、截图。
//
// 用的是学习台同一份课堂循环（kit/src/stage/loop.js 的 createLoop），只把「叫老师」换成假的：叫老师时交出文件里下一段老师的行。
// 所以页面什么时候叫老师、发过去什么，和真上课一样。只读舞台、不改舞台。
//
//   node tools/stage-try.mjs 文件.txt …     不给文件就跑 tools/stage-try-examples/ 下的全部
//   --shots 目录                            每一步之后竖屏、横屏各存一张
//   --json                                  打印 JSON（不打印报告；每一步带 events：那一刻还没发出去的那一段事件）
// 学生的行（「学生:」开头）能写的见 tools/stage-try-lib.js 的 STUDENT_FORMS：write / swap / move / vec / mul 照各自的画法；
// rotate t.30 left、insert t 47、insert t.45 right 47、rowop M r3 - 2r1 / r1 <-> r3 / 3r2、mark s.2-4 V、fold s.3-6 先翻成手势的输入
// （在 30 往左转 = 30 的右孩子拖到 30 上；倍加 = r1 的把手拖到 r3 上、倍数框写 -2），照东西现在的样子找到手指按得到的把手，
// 走规则文件的手势表（gestures.js 的 gestureAct）和真的 openDone；undo 是「撤一步」（先问 stage.undoPlan），dial k 3 是拨数器一格一格拨。
// 翻不成手势的（结点没有那边的孩子、托盘里没有这个数、老师没有 open 这个动作）记成没演上、写明为什么，不交给课堂循环。
// 第二轮的写法是真的触摸（CDP 的 touchStart / touchMove / touchEnd，和 iPad 上一样走 pointer.js、gesturedom.js）：
// pick t.45 t.50 点几个再点「点好了」、refer s.23 -> s.15 从钩上滑出一条线、unrefer / unmark 点 ✕、move s.1-6 after s.11 按住括号 0.4 秒再拖、
// unfold 点小方块、delete 点结点、compare / put / merge 按住括号拖到另一张上、back t "插入后" 点「回到插入后」、按格的 value 一格一格点进去写。
// 按之前照 pointer.js 挑把手的办法核过手指真按得到；按完照舞台交给课堂循环的那一下说交成了哪一行（交成了别的一种也照实写）
// 页面报错或工具自己出错退出码 2，否则 0（没演上的行、排版问题只写进报告：这是量东西的工具，不是检查）
import { chromium } from './playwright.mjs';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, basename, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measure } from './stage-measure.mjs';
import { parseTry, formatReport, HANDS } from './stage-try-lib.js';

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
  const WHY = { answer: '答了', goal: '做到了挑战', done: '做完了', help: '点了提示', stuck: '很久没动', tries: '试了好多下', now: '走偏了（call=wrong）' };
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
        T.played.set(row.segment, { played: row.log.filter((x) => x.by === 'teacher').length, errors: [...st.errors].map((e) => ({ line: e.line, src: e.src, error: e.error, ...(e.kept ? { kept: true } : {}) })) });
      }
      if (row.role === 'student' && !row.pending) {
        // 叫老师的那几件事（做到挑战和做完了常常是同一下）：都写上
        const whys = [...new Set((row.events || []).filter((e) => !e.quiet && (e.now || WHY[e.kind])).map((e) => (e.now ? WHY.now : WHY[e.kind])))];
        T.called = { why: whys.join('、') || '（没认出来）', msg: row.msg, state: st.scene.stateText(), goals: T.goals() };
      }
    },
    thinking: () => {}, note: () => {}, cost: (c) => c, report: (err) => { T.reportErr = String(err?.message || err); },
  };
  T.loop = createLoop(host);
  st.onAct = (a) => T.loop.onAct(a);
  T.goals = () => [...st.scene.goals.values()].map((g) => ({ id: g.id, text: g.text, status: goalStatus(st.scene, g) }));
  // 攒着的：和叫老师时发过去的 [学生] 一样，跟着变的（拨数、行变换以后页面重算的）也一起，照 turnMessage 的写法
  T.pending = () => {
    const evs = T.loop.pending?.events || [];
    const said = eventsText(evs, { goals: st.scene.goals });
    const derived = evs.flatMap((e) => (e.undone ? [] : e.act?.derived || [])); // 撤回了的那一下不算（和 loop.js 的 derivedOf 一样）
    if (!derived.length) return said;
    const msg = window.LAStageDev.turnMessage({ act: said, derived, grids: window.LAStageDev.gridsOf(st.scene) });
    const at = msg.indexOf('[跟着变的]'), end = msg.indexOf('\n\n[舞台现在]');
    return [said, at >= 0 ? msg.slice(at, end >= 0 ? end : undefined) : ''].filter(Boolean).join('\n');
  };
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
  // 学生的一下交给舞台（stage.openDone），照真页面先过裁判（scene.judgeLine）：裁判不让做的（这个世界做不到、wrong=block 走偏了）
  // 舞台自己弹回去、记事实、照样告诉课堂循环——这正是要量的，不能在这里拦掉。裁判放过的才在场景的副本上试一遍（dryRun）：
  // 写法本身演不上的（读不懂、东西不存在）记成没演上、不交给课堂循环（不然发给老师的会写「舞台已经照做了」）
  T.send = async (e, act, src) => {
    const sc = st.scene;
    let j = null;
    try { const [c] = window.LAStageDev.parseScript(src); j = c ? sc.judgeLine(c, { by: 'student', open: e.action }) : null; } catch { j = null; }
    if (!(j && !j.apply)) {
      const bad = window.LAStageDev.dryRun(sc, src)[0]?.error || null;
      if (bad) return { error: `「${src}」演不上：${bad}` };
    }
    const a = await st.openDone(e, act, src);
    return a?.blocked ? { blocked: (j?.facts || []).join('；') || '这一下没让做' } : {};
  };

  // —— 通用手势（手势表里的动作：rotate、insert、rowop、mark、fold，键盘写一格）：照真的手指走 ——
  // 手指按得到的是画法交的把手（types/*.view.js 的 grips：open 只交了几个部件的、折起来的词、托盘里有的数、空着的位置都照画面），
  // 按下、放下的把手交给手势表（gestures.js 的 gestureAct）；放下以后要先写倍数、点成分的照 askFor 问（gesturedom.js 一样）
  const D = window.LAStageDev;
  const gripsOf = (o, e, name, role = 'from') => { const fn = D.VIEWS[o.type]?.grips?.[name]; if (!fn) return []; try { return fn(st, o, e, { role }) || []; } catch { return []; } };
  const partOf = (gr) => { try { return gr.part(); } catch { return null; } };
  const find = (o, e, names, test) => {
    for (const n of [].concat(names || [])) for (const gr of gripsOf(o, e, n)) { const p = partOf(gr); if (p != null && test(p, gr)) return gr; }
    return null;
  };
  const ZH = { left: '左', right: '右' };
  const onePart = (ref) => {
    let ps;
    try { ps = st.scene.parts(ref); } catch (err) { return { error: err.message }; }
    return ps.length === 1 ? { p: ps[0] } : { error: `「${ref}」要是一个部件` };
  };
  const nameOf = (o, k) => { const x = st.scene.partOf(o.id, k); return x ? st.scene.refOf(x) : `${o.id}#${k}`; };
  const notOpen = (o, action) => {
    const have = [...st.scene.opens.values()].filter((x) => x.obj === o.id).map((x) => x.action);
    return { error: `老师没有 open 这个动作（open ${o.id} ${action}），学生动不了${have.length ? `（${o.id} 开着的是 ${have.join('、')}）` : ''}` };
  };
  // 一下手势：kind 是 drop-on / drop-at / tap / span / write，from / to 是按下、放下的把手，value 是倍数框、键盘里写的，role 是点的成分
  T.gestureRun = async (o, e, kind, { from, to = null, value = null, role = null, what }) => {
    const g = e.gesture;
    if (![].concat(g?.gesture || []).includes(kind)) return { error: `${o.id} 的 ${e.action} 没有这种手势` };
    const ctx = kind === 'write' ? { to: partOf(from) } : kind === 'tap' ? { from: partOf(from) } : kind === 'span' ? { from: partOf(from), to: partOf(to) } : { from: partOf(from), to: partOf(to), value: from.value ?? null };
    const ask = D.askFor(g, o, kind, ctx);
    let extra = {};
    let shown = what;
    if (ask?.pick) {
      // 成分那一排交的是中文（学生点「谓语」）：写 V、谓语、V1 都照 roleName 挑那一个按钮（真页面上也只有这一个）
      const same = (x) => [x.value, x.text, x.sub].some((t) => t != null && String(t) === String(role));
      const c = (ask.choices || []).find(same) || (ask.choices || []).find((x) => D.roleName && D.roleName(role) && D.roleName(x.value) === D.roleName(role));
      if (!c) return { error: `${what}以后，成分那一排点不到「${role}」（那一排是：${(ask.choices || []).map((x) => (x.text && x.text !== x.value ? `${x.text} ${x.value}` : x.value)).join('、')}）` };
      extra = { role: c.value };
      shown += `，点「${c.text || c.value}」`;
    } else if (ask) {
      if (value == null) return { error: `${what}以后要先写一个数（${ask.prompt || '写一个数'}）` };
      if (kind === 'write') { const bad = D.writeRange(e, value); if (bad) return { error: `${what}：${bad}` }; }
      extra = { value };
      shown += `，${ask.prompt ? `「${ask.prompt}」` : '键盘上'}写 ${value}`;
    }
    const r = D.gestureAct(st.scene, e, { ...ctx, ...extra });
    // 翻不成一行：真页面在那儿浮一句、什么也不交
    if (r.error) return { error: `${shown}：${r.error}` };
    const res = await T.send(e, { ...r.act, gesture: kind, src: r.src }, r.src);
    return { ...res, did: `${shown} → ${r.src}` };
  };
  // 撤一步：先问舞台能不能撤（stage.undoPlan，和按钮下面那一句同一处）；撤不了的记成没演上
  T.undo = async () => {
    if (![...st.scene.opens.values()].some((e) => e.policy?.undo)) return { error: '老师没有写 undo=on：没有「撤一步」' };
    const plan = st.undoPlan();
    if (!plan.gone) return { error: `撤不了：${plan.why || '这一回合学生还没做过'}` };
    await st.undo();
    return { undone: plan.gone.src, did: '点「撤一步」' };
  };
  // 拨数器：照真页面的 ‹ › 一下 ±1（stage.js 的 dialNode：studentDo('set k 3', { type: 'dial', … })），到头按不动
  T.dial = async (name, target) => {
    const v = st.scene.vars.get(name);
    if (!v) return { error: `舞台上没有能拨的数「${name}」` };
    if (!v.shown || !st.scene.labels.has(`dial:${name}`)) return { error: `${name} 的拨数器收起来了，学生拨不了` };
    // 拨词的拨盘（options=）：学生: dial t 将来。里面是第几个词，照 ‹ › 一下一格拨过去，交出去的是词
    const W = (k) => (v.options ? v.options[k - 1] : k);
    if (v.options) {
      const k = v.options.indexOf(String(target));
      if (k < 0) return { error: `拨不到「${target}」：${name} 只能拨到 ${v.options.join('、')}` };
      target = k + 1;
    } else if (typeof target !== 'number') return { error: `拨不到「${target}」：${name} 是拨数的（${v.lo}～${v.hi}）` };
    if (target < v.lo || target > v.hi) return { error: `拨不到 ${target}：${name} 只能在 ${v.lo}～${v.hi} 里拨（拨到头按钮就按不动了）` };
    const diff = target - v.v;
    if (diff === 0) return { error: `${name} 已经是 ${W(target)}，没有拨` };
    if (!Number.isInteger(diff)) return { error: `拨不到 ${target}：拨数器一下 ±1，${name} 现在是 ${v.v}` };
    const path = [W(v.v)];
    for (let i = 0; i < Math.abs(diff); i++) {
      const cur = st.scene.vars.get(name);
      const nv = Math.max(cur.lo, Math.min(cur.hi, cur.v + Math.sign(diff)));
      await st.studentDo(`set ${name} ${W(nv)}`, { type: 'dial', name, value: W(nv), from: W(cur.v) });
      path.push(W(nv));
    }
    return { did: `拨数器 ${name}：${path.join(' → ')}（按了 ${Math.abs(diff)} 下）` };
  };
  // 学生的一行翻好的手势输入（stage-try-lib.js 的 studentGesture）→ 手指按哪一个把手、放到哪一个上
  T.gesture = async (g) => {
    if (g.undo) return T.undo();
    if (g.dial) return T.dial(g.dial, g.value);
    const sc = st.scene;
    const o = sc.objects.get(g.obj);
    if (!o) return { error: `舞台上没有「${g.obj}」` };
    try {
      if (g.action === 'rotate') {
        const e = sc.opens.get(`${o.id}:rotate`);
        if (!e) return notOpen(o, 'rotate');
        const at = onePart(g.at);
        if (at.error) return at;
        // 在 X 往左转 = X 的右孩子拖到 X 上（右孩子转上来）；往右转是左孩子
        const side = g.dir === 'left' ? 'right' : 'left';
        const ck = o.nodes.find((n) => n.key === at.p.key)?.[side];
        const xn = nameOf(o, at.p.key);
        if (ck == null) return { error: `${String(at.p.value ?? xn)} 没有${ZH[side]}孩子：在它那里${ZH[g.dir]}旋是把它的${ZH[side]}孩子拖到它上面，手指没有可拖的` };
        const from = find(o, e, e.gesture.from, (p) => p.key === ck);
        if (!from) return { error: `${nameOf(o, ck)} 没有交给学生（open 只交了 ${e.refs.join(' ')}），手指拿不起来` };
        const to = find(o, e, e.gesture.to, (p, gr) => p.key === at.p.key && gr.key !== from.key);
        if (!to) return { error: `${xn} 不是能放上去的地方` };
        return await T.gestureRun(o, e, 'drop-on', { from, to, what: `把 ${nameOf(o, ck)} 拖到 ${xn} 上` });
      }
      if (g.action === 'insert' || g.action === 'place') {
        let action = g.action;
        let e = sc.opens.get(`${o.id}:${action}`);
        const other = sc.opens.get(`${o.id}:${action === 'insert' ? 'place' : 'insert'}`);
        // 空树上只开了 place：拖到根的那个空位上
        if (!e && action === 'insert' && other && o.root == null) { action = 'place'; e = other; }
        if (!e) {
          if (!other) return notOpen(o, g.action);
          return { error: action === 'insert' ? `老师开的是 place（学生自己摆到空位）：写成 insert ${o.id}.某个结点 left ${g.value}` : `老师开的是 insert（拖进树里，页面从根比下去）：写成 insert ${o.id} ${g.value}` };
        }
        const from = find(o, e, e.gesture.from, (p, gr) => String(gr.value) === String(g.value));
        if (!from) return { error: `托盘里没有 ${g.value}，手指拖不了（托盘里${o.tray?.length ? `有：${o.tray.join(' ')}` : '是空的'}）` };
        if (action === 'insert') {
          const to = find(o, e, e.gesture.to, () => true);
          if (!to) return { error: '树上没有能放的地方' };
          return await T.gestureRun(o, e, 'drop-at', { from, to, what: `把托盘里的 ${g.value} 拖进树里` });
        }
        let parent = null;
        if (g.at) {
          const at = onePart(g.at);
          if (at.error) return at;
          parent = at.p.key;
        }
        const where = parent == null ? '根的位置' : `${nameOf(o, parent)} 的${ZH[g.side]}边`;
        const to = find(o, e, e.gesture.to, (p) => p.slot && p.slot.parent === parent && (parent == null || p.slot.side === g.side));
        if (!to) return { error: `${where}没有空位（已经有结点了，或者再长就超过 8 层），手指放不上去` };
        return await T.gestureRun(o, e, 'drop-at', { from, to, what: `把托盘里的 ${g.value} 拖到 ${where}` });
      }
      if (g.action === 'rowop') {
        const e = sc.opens.get(`${o.id}:rowop`);
        if (!e) return notOpen(o, 'rowop');
        const G = e.gesture;
        const bad = [g.from, g.to, g.row].find((i) => i != null && !(Number.isInteger(i) && i >= 1 && i <= o.rows));
        if (bad != null) return { error: `${o.id} 只有 ${o.rows} 行，没有 r${bad}` };
        const row = (i) => (p) => p.row === i && p.label == null;
        const lab = (i) => (p) => p.label === i;
        if (g.op === 'scale') {
          const at = find(o, e, G.tap || G.on, lab(g.row));
          if (!at) return { error: `第 ${g.row} 行的行号点不到` };
          return await T.gestureRun(o, e, 'tap', { from: at, value: g.value, what: `点第 ${g.row} 行的行号` });
        }
        const from = find(o, e, G.from, row(g.from));
        if (!from) return { error: `r${g.from} 的把手拿不起来` };
        const to = find(o, e, G.to, (p, gr) => gr.key !== from.key && (g.op === 'swap' ? lab(g.to)(p) : row(g.to)(p)));
        if (!to) return { error: g.op === 'swap' ? `第 ${g.to} 行的行号放不上去` : `r${g.to} 放不上去` };
        return await T.gestureRun(o, e, 'drop-on', { from, to, value: g.op === 'add' ? g.value : null, what: g.op === 'swap' ? `把 r${g.from} 的把手拖到第 ${g.to} 行的行号上` : `把 r${g.from} 的把手拖到 r${g.to} 上` });
      }
      if (g.action === 'mark' || g.action === 'fold') {
        const e = sc.opens.get(`${o.id}:${g.action}`);
        if (!e) return notOpen(o, g.action);
        let ps;
        try { ps = sc.parts(g.span); } catch (err) { return { error: err.message }; }
        if (!ps.length) return { error: `「${g.span}」一个词也没有` };
        const G = e.gesture;
        if (g.action === 'mark') {
          // 从这一段最前面的词拉到最后面的词（手指拉过去，中间的都在里面）
          const by = [...ps].sort((p, q) => p.slot - q.slot);
          const [pa, pb] = [by[0], by.at(-1)];
          const from = find(o, e, G.from, (p) => p.key === pa.key);
          if (!from) return { error: `${sc.refOf(pa)}（${pa.value}）手指拉不到：折起来了，或者 open 没交这个词` };
          const to = find(o, e, [].concat(G.to || G.from), (p) => p.key === pb.key);
          if (!to) return { error: `${sc.refOf(pb)}（${pb.value}）手指拉不到：折起来了，或者 open 没交这个词` };
          return await T.gestureRun(o, e, 'span', { from, to, role: g.role, what: pa === pb ? `按住 ${sc.refOf(pa)}（${pa.value}）` : `从 ${sc.refOf(pa)}（${pa.value}）拉到 ${sc.refOf(pb)}（${pb.value}）` });
        }
        // fold：点正好是这一段的那道括号；写的是一个词就点这个词（折起它所在的最里层）
        const names = [].concat(G.tap || G.on || []);
        const keys = new Set(ps.map((p) => p.key));
        const br = find(o, e, names, (p) => { if (p.mark == null) return false; const m = (o.marks || []).find((x) => x.id === p.mark); return !!m && m.keys.length === keys.size && m.keys.every((k) => keys.has(k)); });
        if (br) return await T.gestureRun(o, e, 'tap', { from: br, what: `点 ${g.span} 的括号` });
        if (ps.length === 1) {
          const w = find(o, e, names, (p) => p.key === ps[0].key);
          if (w) return await T.gestureRun(o, e, 'tap', { from: w, what: `点 ${g.span}（${ps[0].value}）这个词` });
        }
        return { error: `${g.span} 这一段上没有括号：手指点括号（或括号里的一个词）才折得起来` };
      }
    } catch (err) { return { error: err.message }; }
    return { error: `不认得「${g.action}」` };
  };

  // 学生直接动画面（write / mul / swap / move / vec）：照各自画法里造出的那一下（types/*.view.js），走交给学生的那一项。
  // 真页面能做多少这里就做多少：只动交给了学生的部件；矩阵的格照拨数器一格一格 ±1、限在 range 里（写了 input=keypad 的走通用手势：键盘一下写成）
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
    // 图（主线第二轮 D）：点一条边选进 / 拿掉、点一个结点编访问号、点一个结点键盘写数，走通用手势
    if (['choose', 'unchoose', 'visit', 'tag'].includes(cmd)) {
      const action = cmd === 'unchoose' ? 'choose' : cmd;
      const e = sc.opens.get(`${obj}:${action}`);
      if (!e) return { untouched: `${obj} 没有交给学生 ${action}（open ${obj} ${action}），学生动不了` };
      let p;
      try { [p] = sc.parts(first); } catch (err) { return { error: err.message }; }
      const kind = action === 'choose' ? 'edge' : 'node';
      if (!p || p.kind !== kind) return { error: `学生: ${cmd} 后面写${kind === 'edge' ? `一条边（${obj}.A~B）` : `一个结点（${obj}.A）`}` };
      const gr = find(o, e, kind, (q) => q.kind === kind && q.key === p.key);
      if (!gr) return { untouched: `${first} 点不到（open 没交这个部件，或者拿掉了），学生动不了` };
      if (cmd === 'choose' && p.chosen) return { error: `${first} 已经选着了：再点一下是拿掉（学生: unchoose ${first}）` };
      if (cmd === 'unchoose' && !p.chosen) return { error: `${first} 没有选：点一下是选进（学生: choose ${first}）` };
      if (cmd === 'tag') return await T.gestureRun(o, e, 'write', { from: gr, value: rest.split(/\s+/)[1] ?? null, what: `点 ${first}` });
      return await T.gestureRun(o, e, 'tap', { from: gr, what: `点 ${first}` });
    }
    const need = NEED[cmd];
    // 一排格子开的是 open a move（按住拖：放到另一张上对调）：对调走通用手势
    if (cmd === 'swap' && o.type === 'array' && !sc.opens.has(`${obj}:drag`) && sc.opens.has(`${obj}:move`)) {
      const e = sc.opens.get(`${obj}:move`);
      const [ra, rb] = rest.split(/\s+/);
      let a, b;
      try { a = sc.parts(ra)[0]; b = sc.parts(rb)[0]; } catch (err) { return { error: err.message }; }
      if (!a || !b) return { error: '要写成 学生: swap a#6 a#1' };
      const from = find(o, e, 'cell', (p) => p.key === a.key);
      const to = gripsOf(o, { ...e, refs: [] }, 'cell', 'to').find((t) => partOf(t)?.key === b.key);
      if (!from || !to) return { untouched: `${!from ? ra : rb} 拿不起来（空格子，或者 open 没交这一格），学生动不了` };
      return await T.gestureRun(o, e, 'drop-at', { from, to, what: `按住 ${ra}（${a.value}）拖到 ${rb}（${b.value === '' ? '空格子' : b.value}）上` });
    }
    const e = [...sc.opens.values()].find((x) => x.obj === obj && x.action === need);
    if (!e) return { untouched: `${obj} 没有交给学生 ${need}，学生动不了` };
    let one;
    try { one = (ref) => { const p = sc.parts(ref)[0]; if (!p) throw new Error(`「${ref}」不是一个部件`); return p; }; one(first); } catch (err) { return { error: err.message }; }
    // 只交了几个部件（open B.1,1 edit）：别的部件学生碰不到
    const allowed = e.refs.length ? new Set(e.refs.flatMap((r) => sc.parts(r)).map((x) => x.key)) : null;
    const mine = (p) => !allowed || allowed.has(p.key);
    // 交出去以后：没演上、被拦下的照原样往外交；演上了是 null（几下连着拨，前一下没演上就停）
    const go = async (act, src) => { const r = await T.send(e, act, src); return r.error || r.blocked ? r : null; };
    try {
      if (cmd === 'write') {
        const [ref, to] = rest.split(/\s+/);
        const x = one(ref);
        if (!mine(x)) return { untouched: `${ref} 没有交给学生 edit（只交了 ${e.refs.join(' ')}），学生动不了` };
        // open … input=keypad（或者那种东西没有自己的拨数器）：点一格、键盘上一下写成，走通用手势
        if (e.input || !D.VIEWS[o.type]?.affords?.[e.action]) {
          const gr = find(o, e, e.gesture?.on, (p) => p.key === x.key);
          if (!gr) return { untouched: `${ref} 点不到（不是能写的格），学生动不了` };
          return await T.gestureRun(o, e, 'write', { from: gr, value: to, what: `点 ${ref}` });
        }
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

  // —— 真的手指（第二轮的写法，stage-try-lib.js 的 HANDS 和按格的 value）：这里只找手指按哪儿、松在哪儿，外面照 CDP 的触摸按、滑、按住再拖 ——
  // 按的那一点照 pointer.js 挑把手的办法核一遍（layout.js 的 pressGroup：prio 高的先、落在里面最小的那个，这一处每种按法各是哪一个；
  // 按在按钮、输入框、底下那一条上 pointer.js 不收），
  // 松的那一点照 gesturedom.js 找落点的办法核（离手指 28 像素以内、落在里面最小的那个）：真的手指按不到（被别的盖住、被正在等的那一问抢走）
  // 就说按不到，不替手指另找一条路。按完以后学生这一下交没交、交成哪一行，照舞台交给课堂循环的那几下（onAct）说
  T.acts = [];
  T.notes = [];
  st.onAct = (a) => { T.acts.push(a); T.loop.onAct(a); };
  // 浮出来的那一句（gesturedom.js 的 noteAt：翻不成一行、这一下没认出来……）：手指什么都没交时写进报告
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('st-g-note') && !n.classList.contains('is-hint')) T.notes.push(n.textContent || ''); })
    .observe(st.view, { childList: true });
  T.mark = () => ({ acts: T.acts.length, notes: T.notes.length });
  const toClient = (p) => { const v = st.view.getBoundingClientRect(); return { x: v.left + p.x, y: v.top + p.y }; };
  const scr = (b) => { if (!b) return null; const p = st.toScreenLive({ x: b.x, y: b.y }), s = st.liveCam().s; return { x: p.x, y: p.y, w: b.w * s, h: b.h * s }; };
  const gRect = (g) => { try { return g.rect?.() || st.screenRect(g.node?.()) || scr(g.box?.()); } catch { return null; } };
  const gArea = (g) => { try { return g.area?.() || gRect(g); } catch { return null; } };
  const sameR = (a, b) => a && b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1;
  const NOPE = 'button, input, textarea, select, a, .st-dock, .mx-step, .st-dial, .st-gpop'; // pointer.js 的 down 不收按在这些上的
  // 一个框里手指按哪儿：先正中，再在框里一格格找
  const samples = (r) => {
    const out = [{ x: r.x + r.w / 2, y: r.y + r.h / 2 }];
    for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95]) out.push({ x: r.x + r.w * fx, y: r.y + r.h * fy });
    return out;
  };
  // 框 r 里手指照 how（tap 点、slide 滑、hold 按住再拖）按下去，pointer.js 交给的是 mine 认的那一个的一点（屏幕坐标）；哪儿都不是就 null
  const reach = (r, mine, how) => {
    if (!r || !(r.w > 0) || !(r.h > 0)) return null;
    const cands = [];
    for (const [id, t] of st.pointer.targets) { let rect = null; try { rect = t.rect(); } catch { rect = null; } if (rect) cands.push({ id, t, prio: t.prio || 0, rect }); }
    for (const p of samples(r)) {
      const c = toClient(p);
      const under = document.elementFromPoint(c.x, c.y);
      if (!under || !st.view.contains(under) || under.closest?.(NOPE)) continue;
      const c2 = D.pressGroup(p, cands, { radius: 30 })?.by.get(how);
      if (c2 && mine(c2)) return c;
    }
    return null;
  };
  // 画法交的一个把手（gripsOf）：手指照 how 按得到它的一点；inside 是只在这一块里找（整张矩阵按括号那一条）
  const pressGrip = (g, how, inside = null) => { const r = gRect(g); return reach(inside || r, (hit) => hit.t.name === g.key && sameR(hit.rect, r), how); };
  // 拖着、拉着松在 want 上：照 gesturedom.js 在这一组落点里挑（targets 和它拖起来那一刻挂的一样）
  const dropAt = (targets, want) => {
    const r = gArea(want);
    if (!r) return null;
    const cands = targets.map((t, i) => ({ id: i, t, rect: gArea(t) }));
    for (const p of samples(r)) { const hit = D.pickTarget(p, cands, { radius: 28 }); if (hit?.t === want) return toClient(p); }
    return null;
  };
  // 底下那一条、右上角的按钮：按得到（没被盖住、不是灰的）的正中
  const btnAt = (b) => {
    if (!b || b.disabled) return null;
    const r = b.getBoundingClientRect();
    if (!r.width) return null;
    const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    const top = document.elementFromPoint(c.x, c.y);
    return top && (top === b || b.contains(top)) ? c : null;
  };
  const say = (p) => `${st.scene.tapRef(p)}（${p.value ?? ''}）`;
  const keysOf = (ref) => new Set(st.scene.parts(ref).map((p) => p.key));
  const sameKeys = (m, ks) => m.keys.length === ks.size && m.keys.every((k) => ks.has(k));
  T.loc = (k) => { try { return T.locs?.[k]?.() || null; } catch { return null; } };
  T.focused = (i) => document.activeElement === T.cells?.[i];
  /**
   * 一下真的手指 → 怎么按：{ what（写进报告：手指做的）, expect（交出的该是哪一种）, moves: [{ how: tap | slide | hold | type, a, b, ms, text, focus }] }；
   * a / b 是 T.locs 里的名字（外面按之前现找：点进一格以后底下那一条会让到符号小键盘上面，格子跟着挪）；
   * { error } 是手指做不到（老师没开、没有这个部件、按不到）；{ fallback } 是走第一轮的画法（只开了 open s 的拖词、只有一个输入框的 value）
   */
  T.plan = (g) => {
    const sc = st.scene;
    T.locs = {};
    T.cells = null;
    const ready = (names) => names.find((n) => !T.loc(n));
    if (g.action === 'value') {
      const form = [...st.dock.querySelectorAll('.st-fgrid')].at(-1);
      if (!form) return { fallback: true };
      const cells = T.cells = [...form.querySelectorAll('.fi-text')];
      const ok = form.querySelector('.st-say-go');
      const one = form.classList.contains('st-fone');
      const rows = one ? [[g.text.trim()]] : D.formulaRows(g.text);
      const flat = rows.flat();
      if (!one) {
        const pos = cells.map((c) => (c.getAttribute('aria-label') || '').match(/第 (\d+) 行第 (\d+) 列/)).filter(Boolean);
        const R = Math.max(0, ...pos.map((m) => Number(m[1]))), Cn = Math.max(0, ...pos.map((m) => Number(m[2])));
        if (rows.length !== R || rows.some((r) => r.length !== Cn)) return { error: `这一问是 ${R}×${Cn} 的格子，「${g.text}」切出来是 ${rows.map((r) => r.length).join('、')} 格一行（「 / 」分行、空格分格）` };
      }
      const moves = [];
      flat.forEach((text, i) => {
        T.locs[`c${i}`] = () => btnAt(cells[i]);
        moves.push({ how: 'tap', a: `c${i}`, focus: i }, { how: 'type', text });
      });
      T.locs.ok = () => btnAt(ok);
      moves.push({ how: 'tap', a: 'ok' });
      if (!T.loc('c0')) return { error: '第一格手指点不到（被盖住了）' };
      return { what: one ? `点进式子框写 ${g.text}，再点「对吗」` : `一格一格写 ${rows.map((r) => r.join(' ')).join(' / ')}，再点「对吗」`, expect: 'value', moves };
    }
    if (g.action === 'pick') {
      const w = sc.waiting;
      if (!w || w.kind !== 'pick') return { error: `现在等的不是 ask pick（${w ? `在等 ask ${w.kind}` : '没有在等的那一问'}）` };
      const allowed = w.refs?.length ? new Set(w.refs.flatMap((r) => sc.parts(r)).map((p) => `${p.obj}:${p.key}`)) : null;
      const moves = [];
      for (const [i, ref] of g.refs.entries()) {
        const one = onePart(ref);
        if (one.error) return one;
        const pid = `${one.p.obj}:${one.p.key}`;
        if (allowed && !allowed.has(pid)) return { error: `${ref} 不在这一问能点的里面` };
        T.locs[`p${i}`] = () => { const r = st.screenRect(st.nodes.get(pid)); return reach(r, (hit) => (hit.prio || 0) >= 2 && sameR(hit.rect, r), 'tap'); };
        if (!T.loc(`p${i}`)) return { error: `手指点不到 ${ref}（被别的盖住了）` };
        moves.push({ how: 'tap', a: `p${i}` });
      }
      T.locs.go = () => btnAt([...st.dock.querySelectorAll('.st-pick-go')].at(-1));
      moves.push({ how: 'tap', a: 'go' });
      return { what: `点 ${g.refs.join('、')}，再点「${w.button || '点好了'}」`, expect: 'pick', moves };
    }
    if (g.action === 'back') {
      const b = [...st.view.querySelectorAll('.st-back')].find((x) => x.dataset.obj === g.obj && x.dataset.name === g.name);
      if (!b) return { error: `没有「回到${g.name}」按钮：老师没写 open ${g.obj} back="${g.name}"` };
      if (b.disabled) return { error: `「回到${g.name}」还按不了（还没存过，或者正在撤一步）` };
      T.locs.a = () => btnAt(b);
      if (!T.loc('a')) return { error: `「回到${g.name}」被盖住了，手指点不到` };
      return { what: `点「回到${g.name}」`, expect: 'back', moves: [{ how: 'tap', a: 'a' }] };
    }
    const o = sc.objects.get(g.obj);
    if (!o) return { error: `舞台上没有「${g.obj}」` };
    const open = (action) => sc.opens.get(`${o.id}:${action}`);
    const gr = (e, name, role = 'from') => gripsOf(o, role === 'to' ? { ...e, refs: [] } : e, name, role);
    let p;
    if (g.action === 'refer' || g.action === 'unrefer') {
      const e = open('refer');
      if (!e) return notOpen(o, 'refer');
      const a = onePart(g.action === 'refer' ? g.from : g.at);
      if (a.error) return a;
      if (g.action === 'unrefer') {
        const x = gr(e, 'xrefer').find((t) => partOf(t)?.refer === a.p.key);
        if (!x) return { error: `${say(a.p)}连出去的线上没有 ✕：学生自己连的线才有` };
        T.locs.a = () => pressGrip(x, 'tap');
        if (ready(['a'])) return { error: `${say(a.p)}线上的 ✕ 手指点不到（被别的盖住了）` };
        return { what: `点 ${say(a.p)}连出去那条线上的 ✕`, expect: 'unrefer', moves: [{ how: 'tap', a: 'a' }] };
      }
      const hook = gr(e, 'hook').find((t) => partOf(t)?.key === a.p.key);
      if (!hook) return { error: `${say(a.p)}上没有钩：老师 open 的是 ${e.refs.join(' ') || o.id} refer，或者这个词折起来了` };
      // 落点和 gesturedom.js 拉起来那一刻挂的一样：词、括号、句子外框（不跟着 open 写的部件走），钩挂着的那个词不算
      const targets = [...gr(e, 'word', 'to'), ...gr(e, 'bracket', 'to'), ...gr(e, 'sentence', 'to')].filter((t) => { const q = partOf(t); return !(q && q.obj === a.p.obj && q.key === a.p.key); });
      let want, where;
      if (g.to === o.id) { want = targets.find((t) => t.key === 'frame:b'); where = '句子外框'; } else {
        const ks = keysOf(g.to);
        if (!ks.size) return { error: `「${g.to}」一个词也没有` };
        if (ks.size === 1) { want = targets.find((t) => ks.has(partOf(t)?.key)); where = say(sc.parts(g.to)[0]); } else {
          want = targets.find((t) => { const id = partOf(t)?.mark; const m = id != null && (o.marks || []).find((x) => x.id === id); return m && sameKeys(m, ks); });
          where = `${g.to} 那道括号`;
          if (!want) return { error: `${g.to} 上没有括号：线只能松在一个词、一道括号或句子外框上` };
        }
      }
      if (!want) return { error: `${g.to} 不是线能松的地方` };
      T.locs.a = () => pressGrip(hook, 'slide');
      T.locs.b = () => dropAt(targets, want);
      const miss = ready(['a', 'b']);
      if (miss) return { error: miss === 'a' ? `${say(a.p)}的钩手指按不到（被别的盖住了）` : `${where}手指松不到（离别的落点太近）` };
      return { what: `从 ${say(a.p)}的钩拉线，松在${where}上`, expect: 'refer', moves: [{ how: 'slide', a: 'a', b: 'b' }] };
    }
    if (g.action === 'unmark') {
      const e = open('mark');
      if (!e) return notOpen(o, 'mark');
      const ks = keysOf(g.span);
      const mine = (o.marks || []).filter((m) => m.by === 'student');
      const m = mine.find((x) => sameKeys(x, ks)) || (ks.size === 1 ? mine.filter((x) => x.keys.some((k) => ks.has(k))).sort((x, y) => x.keys.length - y.keys.length)[0] : null);
      if (!m) return { error: `${g.span} 上没有学生拉的括号（✕ 只在学生自己拉的括号上）` };
      const x = gr(e, 'xmark').find((t) => partOf(t)?.mark === m.id);
      if (!x) return { error: `${g.span} 那道括号上没有 ✕` };
      T.locs.a = () => pressGrip(x, 'tap');
      if (ready(['a'])) return { error: `${g.span} 那道括号上的 ✕ 手指点不到（被别的盖住了）` };
      return { what: `点 ${g.span} 那道括号上的 ✕`, expect: 'unmark', moves: [{ how: 'tap', a: 'a' }] };
    }
    if (g.action === 'move' && o.type === 'array') {
      // 一排格子（主线第二轮 A）：open a move 按住一张 0.4 秒，拖到两张之间（插进去）。-> a.5 是插到第 5 格；before a.5 / after a.4 是那个空隙
      const e = open('move');
      if (!e) return { error: `老师没有 open ${o.id} move（按住一张拖到两张之间）：只开了 open ${o.id} 的话学生只能两格对调（学生: swap ${o.id}#1 ${o.id}#6）` };
      const a = onePart(g.span);
      if (a.error) return a;
      const at = onePart(g.at);
      if (at.error) return at;
      const line = [...o.cells].filter((c) => (c.row || 0) === (a.p.row || 0)).sort((x, y) => x.slot - y.slot);
      // 落在哪个空隙：空隙后面那一格现在是第几格（这条线的最后是 null）
      const nextOf = (slot) => line.find((c) => c.slot > slot)?.slot ?? null;
      const before = g.where === 'before' ? at.p.slot : g.where === 'after' ? nextOf(at.p.slot) : at.p.slot > a.p.slot ? nextOf(at.p.slot) : at.p.slot;
      const from = gr(e, 'cell').find((t) => partOf(t)?.key === a.p.key);
      if (!from) return { error: `${say(a.p)}手指拿不起来（空格子，或者 open 没交这一格）` };
      const targets = [...gr(e, 'cell', 'to').filter((t) => partOf(t)?.key !== a.p.key), ...gr(e, 'gap', 'to')];
      const want = targets.find((t) => { const q = partOf(t)?.gap; return q && (q.row || 0) === (a.p.row || 0) && q.before === before; });
      if (!want) return { error: `${say(at.p)}那里没有空隙` };
      T.locs.a = () => pressGrip(from, 'hold');
      T.locs.b = () => dropAt(targets, want);
      const miss = ready(['a', 'b']);
      const where = before == null ? '最后面' : `第 ${before} 格前面的空隙`;
      if (miss) return { error: miss === 'a' ? `${say(a.p)}手指按不到（被别的盖住了）` : `${where}手指松不到（离别的落点太近）` };
      return { what: `按住 ${say(a.p)} 0.4 秒，拖到${where}`, expect: 'move', moves: [{ how: 'hold', a: 'a', b: 'b', ms: 400 }] };
    }
    if (g.action === 'move') {
      const e = open('move');
      if (!e) return { fallback: true }; // 只开了 open s（拖一个词）：照第一轮的画法
      if (g.where === 'to') return { error: 'open s move 是拖到两个词之间：写 move s.1-6 after s.11（或 before s.1）' };
      let ps;
      try { ps = sc.parts(g.span); } catch (err) { return { error: err.message }; }
      if (!ps.length) return { error: `「${g.span}」一个词也没有` };
      const ks = new Set(ps.map((x) => x.key));
      // 一段按它的括号（正好是这一段的那一道；括号折了行是几截，哪一截按得到都行），一个词按这个词
      const from = ps.length > 1
        ? gr(e, 'bracket').filter((t) => { const id = partOf(t)?.mark; const m = id != null && (o.marks || []).find((x) => x.id === id); return m && sameKeys(m, ks); })
        : gr(e, 'word').filter((t) => partOf(t)?.key === ps[0].key);
      if (!from.length) return { error: ps.length > 1 ? `${g.span} 上没有括号：整段挪要按住它的括号（先拉一道括号）` : `${say(ps[0])}手指拿不起来（折起来了，或者 open 没交这个词）` };
      const at = onePart(g.at);
      if (at.error) return at;
      const after = g.where === 'after' ? at.p.slot : at.p.slot - 1;
      const gaps = gr(e, 'gap', 'to');
      const want = gaps.find((t) => partOf(t)?.gap?.after === after);
      if (!want) return { error: `${say(at.p)}${g.where === 'after' ? '后面' : '前面'}没有空隙（折起来的那一段里面放不下）` };
      T.locs.a = () => from.map((t) => pressGrip(t, 'hold')).find(Boolean) || null;
      T.locs.b = () => dropAt(gaps, want);
      const miss = ready(['a', 'b']);
      if (miss) return { error: miss === 'a' ? `${ps.length > 1 ? `${g.span} 的括号` : say(ps[0])}手指按不到（被别的盖住了）` : `${say(at.p)}${g.where === 'after' ? '后面' : '前面'}的空隙手指松不到` };
      return { what: `按住 ${ps.length > 1 ? `${g.span} 的括号` : say(ps[0])} 0.4 秒，拖到 ${say(at.p)}${g.where === 'after' ? '后面' : '前面'}`, expect: 'move', moves: [{ how: 'hold', a: 'a', b: 'b', ms: 400 }] };
    }
    if (g.action === 'unfold') {
      const e = open('fold');
      if (!e) return notOpen(o, 'fold');
      const one = onePart(g.at);
      if (one.error) return one;
      p = one.p;
      const pill = gr(e, 'pill').find((t) => { const id = partOf(t)?.pill; const f = id != null && (o.folds || []).find((x) => x.id === id); return f && f.keys.includes(p.key); });
      if (!pill) return { error: `${say(p)}没有折起来：没有小方块可点` };
      T.locs.a = () => pressGrip(pill, 'tap');
      if (ready(['a'])) return { error: `${say(p)}所在的小方块手指点不到（被别的盖住了）` };
      return { what: `点 ${say(p)}所在的小方块`, expect: 'unfold', moves: [{ how: 'tap', a: 'a' }] };
    }
    if (g.action === 'delete') {
      const e = open('pluck') || open('delete');
      if (!e) return notOpen(o, 'pluck（或 delete）');
      const one = onePart(g.at);
      if (one.error) return one;
      p = one.p;
      const n = gr(e, 'node').find((t) => partOf(t)?.key === p.key);
      if (!n) return { error: `${say(p)}没有交给学生（open 只交了 ${e.refs.join(' ')}）` };
      T.locs.a = () => pressGrip(n, 'tap');
      if (ready(['a'])) return { error: `${say(p)}手指点不到（被别的盖住了）` };
      return { what: `点 ${say(p)}`, expect: 'delete', moves: [{ how: 'tap', a: 'a' }] };
    }
    if (g.action === 'compare' || g.action === 'put' || g.action === 'merge') {
      const e = open(g.action);
      if (!e) return notOpen(o, g.action);
      // 按住括号那一条（格上开着别的时，格是格自己的）：两道括号哪一道按得到都行
      const from = gr(e, 'whole');
      const zones = gr(e, 'whole', 'to');
      const want = zones.find((t) => partOf(t)?.obj === g.to);
      if (!want) return { error: `「${g.to}」不是舞台上能放的矩阵（藏着的、不是矩阵的放不上去）` };
      T.locs.a = () => from.map((t) => pressGrip(t, 'hold', st.screenRect(st.decor(o.id, t.key.split(':')[1]))) || pressGrip(t, 'hold')).find(Boolean) || null;
      T.locs.b = () => dropAt(zones, want);
      const miss = ready(['a', 'b']);
      if (miss) return { error: miss === 'a' ? `${o.id} 的括号手指按不到（被别的盖住了，或者被正在等的那一问抢走）` : `${g.to} 上手指松不到` };
      return { what: `按住 ${o.id} 的括号 0.4 秒，拖到 ${g.to} 上`, expect: g.action, moves: [{ how: 'hold', a: 'a', b: 'b', ms: 400 }] };
    }
    return { error: `不认得「${g.action}」` };
  };
  // 按完以后：这一下交没交、交成哪一行（照舞台交给课堂循环的 act）；没让做的照裁判说为什么
  T.since = (m, plan) => {
    const acts = T.acts.slice(m.acts);
    const notes = T.notes.slice(m.notes);
    if (!acts.length) return { error: `${plan.what}：页面什么都没交${notes.length ? `（浮了一句「${notes.at(-1)}」）` : ''}` };
    // pick、填的答案没有一行指令（回答一问）：写成学生交的样子
    const lineOf = (a) => a.line || a.src || (a.type === 'pick' ? `pick ${(a.refs || []).join(' ')}` : a.type === 'value' ? `value ${a.text}` : a.type);
    const out = { did: `${plan.what} → ${acts.map(lineOf).join('；')}` };
    const bad = acts.find((a) => a.error);
    if (bad) out.error = `「${lineOf(bad)}」没演上：${bad.error}`;
    const blk = acts.find((a) => a.blocked);
    if (blk) {
      let facts = [];
      try { const [c] = D.parseScript(lineOf(blk)); facts = st.scene.judgeLine(c, { by: 'student', open: blk.open })?.facts || []; } catch { facts = []; }
      out.blocked = facts.join('；') || [blk.verdict?.why, blk.verdict?.misread && `像是${blk.verdict.misread}`].filter(Boolean).join('；') || '这一下没让做';
    }
    const cmdOf = (a) => (['pick', 'value', 'back'].includes(a.type) ? a.type : String(lineOf(a)).split(/\s+/)[0]);
    if (!acts.some((a) => cmdOf(a) === plan.expect)) out.kept = `手指这一下页面认成了「${acts.map(lineOf).join('；')}」，不是 ${plan.expect}（照那一下演了）`;
    return out;
  };
}

// 真的手指（第二轮的写法）：照 T.plan 一下一下按（点、滑、按住再拖、键盘写一格），按完等课堂循环停下来，再看交了什么。
// 走第一轮画法的（fallback）给 null
async function hands(page, touch, step) {
  const g = step.cmd === 'value' ? { action: 'value', text: step.args } : step.gesture;
  const m = await page.evaluate(() => window.__try.mark());
  const plan = await page.evaluate((x) => window.__try.plan(x), g);
  if (plan.fallback) return null;
  if (plan.error) return { error: plan.error };
  const at = (k) => page.evaluate((k) => window.__try.loc(k), k);
  for (const mv of plan.moves) {
    if (mv.how === 'type') { await page.keyboard.type(mv.text, { delay: 15 }); await page.waitForTimeout(80); continue; }
    const a = await at(mv.a);
    if (!a) return { error: `${plan.what}：${mv.a === 'go' || mv.a === 'ok' ? '那个按钮还按不了（灰着，或者被盖住了）' : '手指按不到那一处（被别的盖住了）'}` };
    if (mv.how === 'tap') {
      await touch('touchStart', a.x, a.y);
      await page.waitForTimeout(40);
      await touch('touchEnd');
      await page.waitForTimeout(160);
      if (mv.focus != null && !(await page.evaluate((i) => window.__try.focused(i), mv.focus))) return { error: `${plan.what}：点了第 ${mv.focus + 1} 格，没点进去` };
      continue;
    }
    // 滑：按下就拉；按住再拖：按满 HOLD_MS（0.35 秒）再挪，同一处还能点、滑时才认成拖
    await touch('touchStart', a.x, a.y);
    if (mv.how === 'hold') await page.waitForTimeout(mv.ms || 400);
    const b = await at(mv.b);
    if (!b) { await touch('touchEnd'); return { error: `${plan.what}：松手的那一处找不到了` }; }
    const n = 12;
    for (let i = 1; i <= n; i++) { await touch('touchMove', a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n); await page.waitForTimeout(16); }
    await page.waitForTimeout(60);
    await touch('touchEnd');
  }
  await page.waitForTimeout(80);
  await page.evaluate((max) => window.__try.settle(max), IDLE_MAX);
  return page.evaluate(([mk, p]) => window.__try.since(mk, p), [m, plan]);
}

const browser = await chromium.launch();
let crashed = false;
const results = [];
for (const file of opt.files) {
  // path：照仓库根目录的相对路径（tools/stage-try-diff.mjs 拿它对基线里同一个文件；不同目录下同名的「分支1.txt」分得开）
  const r = { file: basename(file), path: relative(ROOT, file), views: [] };
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
      const out = { step, played: 0, errors: [], state: '', goals: [], called: null, pending: '', events: [], untouched: null, issues: [], shot: '' };
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
        // 手势的那几种：写法本身就翻不成手势的（parseTry 已经说了为什么）不用开页面；第二轮的写法照真的手指按（hands），
        // 只开了 open s 的拖词、只有一个输入框的 value 照第一轮的画法
        let res = step.gesture?.error ? { error: step.gesture.error } : HANDS.has(step.cmd) || step.cmd === 'value' ? await hands(page, touch, step) : null;
        if (!res) {
          res = step.how !== 'do' ? await page.evaluate(([c, a]) => window.__try.answer(c, a), [step.cmd, step.args])
            : step.gesture && !HANDS.has(step.cmd) ? await page.evaluate((g) => window.__try.gesture(g), step.gesture)
              : await page.evaluate(([c, a]) => window.__try.studentDo(c, a), [step.cmd, step.args]);
        }
        if (res.error) out.errors.push({ line: step.line, src: step.src, error: res.error });
        if (res.kept) out.errors.push({ line: step.line, src: step.src, error: res.kept, kept: true });
        if (res.untouched) out.untouched = res.untouched;
        if (res.did) out.did = res.did;
        if (res.blocked) out.blocked = res.blocked;
        if (res.undone) out.undone = res.undone;
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
      // events：那一刻还没发出去的那一段事件（存得下的样子，和课堂循环存进学生轮的一样），给测试取样（tests/fixtures/stage-tries-*.json）
      const snap = await page.evaluate(() => { const T = window.__try; return { called: T.called, state: T.state(), goals: T.goals(), pending: T.pending(), idle: T.idle(), events: JSON.parse(JSON.stringify(T.loop.pending?.events || [])) }; });
      // 学生屏幕上看得到的字（fix1 查「画的和说的对得上」：边上的权、算不出来的「?」、按钮上的字）
      out.screen = await page.evaluate(() => (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 4000));
      if (snap.called) out.called = { why: snap.called.why, msg: snap.called.msg };
      out.state = snap.called?.state || snap.state;
      out.goals = snap.called?.goals || snap.goals;
      out.pending = snap.pending;
      out.events = snap.events;
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
// 写进管道时（检查脚本 execFile 读它）stdout 是异步的：写完了再退出，直接 process.exit 会把一大段 JSON 截掉、读不全
process.stdout.write(opt.json ? `${JSON.stringify(results, null, 2)}\n` : '', () => process.exit(crashed ? 2 : 0));
