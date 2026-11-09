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
// 翻不成手势的（结点没有那边的孩子、托盘里没有这个数、老师没有 open 这个动作）记成没演上、写明为什么，不交给课堂循环
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
        T.played.set(row.segment, { played: row.log.filter((x) => x.by === 'teacher').length, errors: [...st.errors].map((e) => ({ line: e.line, src: e.src, error: e.error })) });
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
  const gripsOf = (o, e, name) => { const fn = D.VIEWS[o.type]?.grips?.[name]; if (!fn) return []; try { return fn(st, o, e) || []; } catch { return []; } };
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
    if (target < v.lo || target > v.hi) return { error: `拨不到 ${target}：${name} 只能在 ${v.lo}～${v.hi} 里拨（拨到头按钮就按不动了）` };
    const diff = target - v.v;
    if (diff === 0) return { error: `${name} 已经是 ${target}，没有拨` };
    if (!Number.isInteger(diff)) return { error: `拨不到 ${target}：拨数器一下 ±1，${name} 现在是 ${v.v}` };
    const path = [v.v];
    for (let i = 0; i < Math.abs(diff); i++) {
      const cur = st.scene.vars.get(name);
      const nv = Math.max(cur.lo, Math.min(cur.hi, cur.v + Math.sign(diff)));
      await st.studentDo(`set ${name} ${nv}`, { type: 'dial', name, value: nv, from: cur.v });
      path.push(nv);
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
    const need = NEED[cmd];
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
        // 手势的那几种：写法本身就翻不成手势的（parseTry 已经说了为什么）不用开页面
        const res = step.how !== 'do' ? await page.evaluate(([c, a]) => window.__try.answer(c, a), [step.cmd, step.args])
          : step.gesture?.error ? { error: step.gesture.error }
            : step.gesture ? await page.evaluate((g) => window.__try.gesture(g), step.gesture)
              : await page.evaluate(([c, a]) => window.__try.studentDo(c, a), [step.cmd, step.args]);
        if (res.error) out.errors.push({ line: step.line, src: step.src, error: res.error });
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
if (opt.json) console.log(JSON.stringify(results, null, 2));
process.exit(crashed ? 2 : 0);
