// 课堂模式（mode: class）：页面底部是对话框，课堂里的 Claude 一边说话、一边用组件库现场画黑板。
// 学生在黑板上的作答会自动发给它，它接着往下教。只用 Opus 5.5（effort high）讲课：
// 返回的不是 Opus 5.5 时，这一轮整段作废（不显示、不执行黑板指令、不进对话历史）。
// 数据都在这个 artifact 的数据库里：黑板段落 steps、作答 answers / events、课堂记录 class_turns、课后小结 class_notes、资料包 pack。
import { renderLesson, mdToHtml, escapeHtml } from '../render.js';
import { session } from '../session.js';
import { compile } from '../expr.js';
import { getAI, errorText } from '../ai.js';
import { getStore, isDev } from '../live/store.js';
import { createSink } from '../live/sync.js';
import { copyRecord, toast } from '../record.js';
import { parseOutput } from './protocol.js';
import { buildSystem, actionText, actionsMessage, buildTurns, needsCompaction, compactionPrompt, summaryTurn, closingPrompt } from './prompt.js';
import { COMPONENT_DOCS } from './docs.js';
import { createDevTeacher } from './devteacher.js';
import { createClassBar } from './bar.js';
import { initClassDevPanel } from './devpanel.js';

export const MODEL = 'claude-opus-5-5';
// 学生明确要求：讲课只能是 Opus 5.5、effort high；modelTier 只是平台要求的退路（退路的输出会被丢弃）
export const TEACH = { model: MODEL, effort: 'high', modelTier: 'complex' };
const DEBOUNCE = 1500;
const MAX_REWRITES = 2;
const pad6 = (n) => String(n).padStart(6, '0');

export async function renderClass(root, meta) {
  session.mode = 'class';
  session.live = true; // 共用 live 的行为：猜想默认不批改、作答逐次记录、组件要有 id
  session.stages = [];
  const unitName = meta.unit || session.title;
  root.classList.add('is-live', 'is-class');
  root.innerHTML = `
    <div class="g-bar">
      <div class="g-name">${mdToHtml(unitName, { inline: true })}</div>
      <div class="g-dots" role="list"></div>
      <div class="g-tools">
        <span class="live-chip" data-state="wait"><i></i><span>连接中</span></span>
        <button type="button" class="btn btn-sm g-copy">复制学习记录</button>
      </div>
    </div>
    <div class="g-stages class-board"></div>
    <div class="class-welcome">
      <div class="live-empty-art" aria-hidden="true"><i></i><i></i><i></i></div>
      <p class="class-welcome-text">正在准备课堂…</p>
      <button type="button" class="btn btn-primary btn-lg class-start" hidden>开始上课</button>
    </div>`;
  const board = root.querySelector('.class-board');
  const dots = root.querySelector('.g-dots');
  const welcome = root.querySelector('.class-welcome');
  const welcomeText = root.querySelector('.class-welcome-text');
  const chip = root.querySelector('.live-chip');
  const setChip = (state, text) => { chip.dataset.state = state; chip.querySelector('span').textContent = text; };
  root.querySelector('.g-copy').addEventListener('click', () => copyRecord(toast));

  const store = await getStore({ title: session.title });
  if (!store) {
    setChip('off', '没连上');
    welcomeText.innerHTML = '这个页面没有拿到课堂的数据库权限。<br>发布时要声明 <code>capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}</code>；本地试用请在地址后面加 <code>?dev</code>。';
    return;
  }
  const { db } = store;
  const sink = createSink(store);

  // —— 谁来讲课：claude.ai 里是真的 Claude；本地 ?dev 用模拟老师（剧本回放，不花额度）——
  const ai = await getAI();
  const dev = store.dev || isDev();
  const useMock = dev && !/[?&]teacher=real\b/.test(location.search);
  let mock = useMock ? createDevTeacher() : null;
  const teacher = {
    get available() { return !!(mock || ai?.call); },
    call: (input, opts) => (mock ? mock(input, opts) : ai.call(input, opts)),
    get tools() { return !mock && !!ai?.tools; },
  };
  const imagesOk = !!(ai?.images || mock);
  const maxImages = ai?.images?.maxCount || 4;

  // —— 状态 ——
  const segs = new Map(); // id → { id, seq, title, md, hidden, failed, sec, rewrites }
  let segSeq = 0;
  const history = []; // { seq, role, text, kind, discarded, ... } 和数据库 class_turns 一一对应
  let turnSeq = 0;
  const results = new Map(); // 组件 id → 作答摘要（给课堂 Claude 看的黑板现状）
  const pack = { main: null, problems: null };
  const localImages = new Map(); // asset id → Blob（这次打开页面时上传的原图，view_handwriting 用）
  const queue = { texts: [], images: [], actions: [], immediate: false };
  let busy = false;
  let ctl = null;
  let timer = null;
  let draftMsg = null;
  let draftBox = null;
  let started = false;
  let compactNext = false;

  const bar = createClassBar({
    images: imagesOk,
    onSend: ({ text, images }) => enqueueStudent(text, images),
    onQuick: (label) => enqueueStudent(QUICK[label] || label, [], true),
    onStop: () => ctl?.abort(),
    onRetry: () => { if (!busy) retryRun(); },
    onEnd: () => endClass(),
  });
  const QUICK = { 没懂: '没懂。', 想不出来: '想不出来。', 换个说法: '换个说法讲讲？', 继续: '继续。' };
  if (!teacher.available) {
    bar.setEnabled(false);
    bar.setStatus('error', ai === null ? '需要允许这个页面使用 Claude，课堂才能开始。' : '这个页面现在用不了 Claude。');
  }

  // 草稿区「拿给 Claude 看」、手写附件：都进底部对话框
  session.openTutor = (i, prefill, image) => {
    if (image) bar.attach(image);
    if (prefill) bar.prefill(prefill);
    bar.focus();
  };

  // —— 作答和动作：写进数据库（同 live），同时攒起来自动发给课堂 Claude ——
  session.sink = {
    record(e) { sink.record(e); onAction({ source: 'record', ...e }); },
    event(e) { sink.event(e); onAction({ source: 'event', ...e, ...(e.detail && typeof e.detail === 'object' ? e.detail : {}) }); },
    images(key, blobs) {
      const ups = sink.images(key, blobs);
      ups.forEach((p, i) => p.then((id) => id && localImages.set(id, blobs[i])));
      queue.images.push(...blobs.map((blob, i) => ({ blob, id: ups[i] || Promise.resolve(null) })));
      return ups;
    },
  };

  setChip('on', mock ? '课堂 · 模拟老师' : '课堂');
  if (dev) initClassDevPanel({ db, root, setFallback: (on) => { if (mock) mock = createDevTeacher({ fallback: on }); }, history: () => history });

  // —— 资料包（课前由项目对话写入；课中改了，下一轮自动用新版）——
  db.doc('pack/main').onSnapshot((s) => {
    pack.main = s.exists ? s.data() : null;
    if (pack.main?.unit) root.querySelector('.g-name').innerHTML = mdToHtml(String(pack.main.unit), { inline: true });
    session.context = pack.main ? [pack.main.goal, pack.main.scope].filter(Boolean).join('\n') : '';
  }, () => {});
  db.doc('pack/problems').onSnapshot((s) => { pack.problems = s.exists ? s.data() : null; }, () => {});

  // —— 恢复：黑板段落、课堂记录、作答 ——
  await restore();
  session.event('open', null, { title: session.title, unit: unitName, mode: 'class' });

  async function restore() {
    try {
      const [st, tu, an] = await Promise.all([db.collection('steps').get(), db.collection('class_turns').get(), db.collection('answers').get()]);
      st.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.seq || 0) - (b.seq || 0)).forEach((d) => {
        segSeq = Math.max(segSeq, d.seq || 0);
        const seg = { id: d.id, seq: d.seq || 0, title: d.title || '', md: String(d.md || ''), hidden: !!d.hidden, failed: !!d.failed, rewrites: 0, sec: null };
        segs.set(seg.id, seg);
        if (!seg.hidden) mountRestored(seg);
      });
      tu.docs.map((d) => d.data()).sort((a, b) => a.seq - b.seq).forEach((t) => { history.push(t); turnSeq = Math.max(turnSeq, t.seq); });
      an.docs.map((d) => d.data()).sort((a, b) => a.at - b.at).forEach((r) => {
        const a = { source: 'record', ...r, type: r.kind, answer: r.kind === 'conjecture' ? r.text : undefined };
        if (reportable(a)) addResult(a);
      });
    } catch (e) {
      console.error(e);
      toast('课堂记录没读出来，先从头开始');
    }
    history.slice(-30).forEach(showTurn);
    started = history.length > 0;
    refresh();
    const last = history.filter((t) => !t.discarded && t.kind !== 'summary').at(-1);
    if (last && last.role !== 'claude') bar.setStatus('error', '上一轮 Claude 还没回完，点重试接着上。');
  }

  function showTurn(t) {
    if (t.role === 'student') {
      if (t.actions?.length) bar.addMessage({ role: 'action', html: escapeHtml(t.actions.join('\n')).replace(/\n/g, '<br>') });
      if (t.say) bar.addMessage({ role: 'student', html: escapeHtml(t.say) + (t.images?.length ? ` <span class="muted">（附图 ${t.images.length} 张）</span>` : '') });
    } else if (t.role === 'claude' && !t.discarded) {
      const speech = parseOutput(t.text, { final: true }).segments.filter((s) => s.type === 'speech').map((s) => s.text).join('\n\n');
      if (speech.trim()) bar.addMessage({ role: 'claude', html: mdToHtml(speech) });
    } else if (t.role === 'system' && t.kind === 'closing') {
      bar.addMessage({ role: 'system', html: '下课了，小结已经存好。' });
    }
  }

  // —— 黑板段落 ——
  function segSource(seg) {
    return !/^##\s+/m.test(seg.md) && seg.title ? `## ${seg.title}\n\n${seg.md}` : seg.md;
  }

  // 渲染一段：先隐藏着画，自检通过才显示。返回 { sec, errors, soft }
  function renderSeg(seg) {
    const idx = session.stages.length;
    const sec = document.createElement('section');
    sec.className = 'stage live-step class-seg class-pending';
    sec.dataset.step = seg.id;
    sec.dataset.stage = idx;
    sec.innerHTML = '<div class="stage-body"></div>';
    const src = segSource(seg);
    session.stages.push({ id: seg.id, title: seg.title || (seg.md.match(/^##\s+(.+)$/m)?.[1] || '').trim(), src, el: sec });
    place(seg, sec);
    const before = session.problems.length;
    renderLesson(src, sec.querySelector('.stage-body'));
    const probs = session.problems.slice(before).filter((p) => p.stage === idx);
    return { sec, errors: probs.filter((p) => !p.soft), soft: probs.filter((p) => p.soft) };
  }

  // 按 seq 放进黑板（替换时放在原位置）
  function place(seg, sec) {
    if (seg.sec?.isConnected) { seg.sec.after(sec); return; }
    const after = [...segs.values()].filter((o) => o !== seg && o.sec?.isConnected && o.seq > seg.seq).sort((a, b) => a.seq - b.seq)[0];
    if (after) board.insertBefore(sec, after.sec); else board.appendChild(sec);
  }

  function dropScenesOf(sec) {
    for (const [k, sc] of session.scenes) if (sec.contains(sc.el)) session.scenes.delete(k);
  }

  function mountRestored(seg) {
    if (seg.failed) { seg.sec = failedSec(seg); return; }
    const { sec } = renderSeg(seg);
    sec.classList.remove('class-pending');
    seg.sec = sec;
  }

  function failedSec(seg) {
    const sec = document.createElement('section');
    sec.className = 'stage live-step class-seg class-failed';
    sec.dataset.step = seg.id;
    sec.innerHTML = `<div class="class-failed-box">这段没画出来${seg.title ? `（${escapeHtml(seg.title)}）` : ''}。课堂接着往下。</div>`;
    place(seg, sec);
    return sec;
  }

  // 执行一条黑板指令。返回 { op, id, ok, error? }；画不出来的 add/replace 记进 failures 等着重写
  function execOp(op, failures) {
    if (op.op === 'add' || op.op === 'replace') {
      let seg = segs.get(op.id);
      const isNew = !seg;
      if (!seg) { seg = { id: op.id, seq: ++segSeq, title: '', md: '', hidden: false, failed: false, rewrites: 0, sec: null }; }
      const next = { ...seg, title: op.title ?? seg.title, md: op.body || '' };
      const { sec, errors, soft } = renderSeg(next);
      if (errors.length) {
        dropScenesOf(sec);
        sec.remove();
        if (isNew) segs.set(seg.id, seg); // 记住 id 和顺序，重写时放回原位
        failures.push({ id: op.id, title: next.title, errors, isNew });
        return { op: op.op, id: op.id, ok: false, error: errors.map((p) => `${p.kind}：${p.msg}`).join('；') };
      }
      if (seg.sec) { dropScenesOf(seg.sec); seg.sec.remove(); }
      sec.classList.remove('class-pending');
      Object.assign(seg, next, { sec, hidden: false, failed: false });
      segs.set(seg.id, seg);
      saveSeg(seg);
      if (soft.length) seg.softNotes = soft.map((p) => p.msg);
      return { op: op.op, id: op.id, ok: true, title: seg.title, isNew };
    }
    if (op.op === 'hide') {
      const seg = segs.get(op.id);
      if (!seg) return { op: 'hide', id: op.id, ok: false, error: `黑板上没有 ${op.id}` };
      seg.hidden = true;
      if (seg.sec) seg.sec.hidden = true;
      saveSeg(seg);
      return { op: 'hide', id: op.id, ok: true };
    }
    if (op.op === 'figure') return figureOp(op);
    return { op: op.op, ok: false, error: '看不懂的指令' };
  }

  function figureOp(op) {
    const el = [...document.querySelectorAll(`[data-bid="${CSS.escape(op.target)}"]`)].find((e) => e.dataset.scene && !e.closest('[hidden]'));
    const sc = el && session.scenes.get(el.dataset.scene);
    if (!sc) return { op: 'figure', id: op.target, ok: false, error: `黑板上没有 id 为 ${op.target} 的图` };
    const api = sc.api;
    try {
      if (op.action === 'set') {
        const vars = (api.vars || api.snapshot)?.call(api) || {};
        for (const [name, src] of Object.entries(op.assigns || {})) api.set(name, compile(src)(vars));
      } else if (op.action === 'play') {
        if (api.play) api.play(op.name, op.from ?? 0, op.to ?? 1, op.ms ?? 1200);
        else api.animate?.(op.name, op.from ?? 0, op.to ?? 1, op.ms ?? 1200);
      } else if (op.action === 'highlight') {
        api.highlight?.(op.index);
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return { op: 'figure', id: op.target, action: op.action, ok: true };
    } catch (e) {
      return { op: 'figure', id: op.target, action: op.action, ok: false, error: e.message };
    }
  }

  function saveSeg(seg) {
    sink.put('steps', { id: seg.id, seq: seg.seq, md: seg.md, title: seg.title || '', hidden: !!seg.hidden, failed: !!seg.failed, by: 'class', at: Date.now() });
  }

  function refresh() {
    const vis = [...board.querySelectorAll('.class-seg')].filter((s) => !s.hidden);
    welcome.hidden = vis.length > 0 || busy;
    if (!vis.length && !busy) {
      welcomeText.innerHTML = started ? '黑板现在是空的。在下面说一句话，Claude 会接着讲。' : '准备好了就点「开始上课」。<br>Claude 会一边讲，一边在黑板上出题、画图；你在黑板上作答，它马上接着教。';
      root.querySelector('.class-start').hidden = started || !teacher.available;
    }
    vis.forEach((sec, k) => {
      const h = sec.querySelector('.stage-body > h2');
      if (h && !h.querySelector('.h-num')) h.innerHTML = `<span class="h-num">${k + 1}</span><span>${h.innerHTML}</span>`;
    });
    dots.innerHTML = vis.map((sec, k) => `<button type="button" role="listitem" class="g-dot ${k === vis.length - 1 ? 'current' : 'seen'}" data-step="${escapeHtml(sec.dataset.step)}" title="${escapeHtml(segs.get(sec.dataset.step)?.title || '')}"><span>${k + 1}</span></button>`).join('');
  }
  dots.addEventListener('click', (e) => {
    const d = e.target.closest('.g-dot');
    if (d) segs.get(d.dataset.step)?.sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  root.querySelector('.class-start').addEventListener('click', () => enqueueStudent('开始上课。', [], true));

  // —— 黑板现状（每轮都告诉课堂 Claude）——
  function boardState() {
    return [...segs.values()].sort((a, b) => a.seq - b.seq).map((seg) => {
      const blocks = seg.sec ? [...seg.sec.querySelectorAll('.block[data-bid]')].map((b) => ({
        id: b.dataset.bid,
        kind: [...b.classList].find((c) => c.startsWith('block-'))?.slice(6) || '',
        results: (results.get(b.dataset.bid) || []).slice(-6),
      })) : [];
      const text = seg.sec?.querySelector('.stage-body > p')?.textContent?.trim() || '';
      const summary = [seg.failed ? '（这段没画出来）' : '', text.slice(0, 80), seg.softNotes?.length ? `（${seg.softNotes.join('；')}）` : ''].filter(Boolean).join(' ');
      return { id: seg.id, title: seg.title || seg.sec?.querySelector('h2')?.textContent?.replace(/^\d+/, '').trim() || '', summary, hidden: seg.hidden, blocks };
    });
  }

  function addResult(a) {
    if (!a.block) return;
    const list = results.get(a.block) || [];
    list.push(actionText(a).replace(/^\[(作答|动作)\]\s*/, ''));
    results.set(a.block, list.slice(-12));
  }

  // 哪些记录要告诉课堂 Claude（同一道题的「最终结果」只在看了答案、放弃时说，每次尝试已经说过了）
  function reportable(a) {
    if (a.source === 'event') return ['reveal', 'drag'].includes(a.type);
    if (['ask', 'findbug-hint'].includes(a.type)) return false;
    if (a.final && !a.revealed && !a.giveup) return false;
    return true;
  }

  function onAction(a) {
    const urgent = a.giveup || (a.source === 'event' && a.type === 'giveup');
    if (!reportable(a)) { if (urgent) schedule(true); return; }
    addResult(a);
    // 连着拖同一个点，只留最后一次
    if (a.type === 'drag') {
      const i = queue.actions.findIndex((x) => x.type === 'drag' && x.block === a.block && x.name === a.name);
      if (i >= 0) queue.actions.splice(i, 1);
    }
    queue.actions.push(a);
    schedule(urgent);
  }

  function enqueueStudent(text, images = [], urgent = true) {
    if (!teacher.available) return;
    if (text) queue.texts.push(text);
    for (const blob of images) {
      const ups = store.assets ? [store.assets.upload(blob, { type: blob.type || 'image/png' }).then((r) => { localImages.set(r.id, blob); return r.id; }).catch(() => null)] : [Promise.resolve(null)];
      queue.images.push({ blob, id: ups[0] });
    }
    schedule(urgent);
  }

  function schedule(urgent) {
    clearTimeout(timer);
    if (busy) return; // 正在讲：等这一轮说完再发
    if (!queue.texts.length && !queue.actions.length && !queue.images.length) return;
    timer = setTimeout(flush, urgent ? 0 : DEBOUNCE);
  }

  async function flush() {
    if (busy) return;
    const actions = queue.actions.splice(0);
    const texts = queue.texts.splice(0);
    const imgs = queue.images.splice(0).slice(-maxImages);
    if (!actions.length && !texts.length && !imgs.length) return;
    started = true;
    const actionLines = actions.map(actionText);
    const say = texts.join('\n');
    const ids = (await Promise.all(imgs.map((x) => x.id))).filter(Boolean);
    let text = [actions.length ? actionsMessage(actions) : '', say].filter(Boolean).join('\n\n');
    if (imgs.length) text += `\n（附了 ${imgs.length} 张图：学生的手写或截图，白底黑字。）`;
    const turn = addTurn({ role: 'student', text: text || '（学生附了图）', say, actions: actionLines, images: ids });
    showTurn(turn);
    await runClaude(imgs.map((x) => x.blob));
  }

  function addTurn(t) {
    const turn = { seq: ++turnSeq, at: Date.now(), ...t };
    history.push(turn);
    sink.put('class_turns', { id: pad6(turn.seq), ...turn });
    return turn;
  }

  // 给课堂 Claude 的对话：最近一次摘要 + 摘要之后的原文；作废的轮不算
  function promptHistory() {
    const live = history.filter((t) => !t.discarded && t.kind !== 'closing');
    const s = live.filter((t) => t.kind === 'summary').at(-1);
    if (!s) return live;
    return [s, ...live.filter((t) => t.kind !== 'summary' && t.seq > s.upTo)];
  }

  async function compact() {
    const ph = promptHistory();
    const prev = ph[0]?.kind === 'summary' ? ph[0] : null;
    const body = prev ? ph.slice(1) : ph;
    const old = body.slice(0, -20);
    if (!old.length) return;
    bar.setStatus('thinking', '对话有点长了，先整理一下前面的内容…');
    try {
      const r = await teacher.call(compactionPrompt({ summary: prev?.text || '', turns: old }), { modelTier: 'default', cache: false });
      addTurn({ ...summaryTurn(r.text), upTo: old.at(-1).seq });
    } catch (e) {
      console.warn('摘要失败', e);
    }
  }

  // —— 讲课：一次调用（画不出来的段会自动再要一轮重写，同一段最多 2 次）——
  async function runClaude(images = []) {
    if (busy || !teacher.available) return;
    busy = true;
    refresh();
    bar.setBusy(true);
    try {
      let imgs = images;
      for (let round = 0; round < 6; round++) {
        bar.setStatus('thinking', round ? 'Claude 在改写黑板上没画出来的段…' : 'Claude 在想…');
        if (compactNext || needsCompaction(promptHistory())) { compactNext = false; await compact(); }
        const system = buildSystem({ rules: pack.main?.rules, componentDocs: COMPONENT_DOCS, pack, board: boardState() });
        const { turns } = buildTurns({ system, history: promptHistory() });
        ctl = new AbortController();
        const opts = { ...TEACH, cache: false, signal: ctl.signal, onText: ({ text }) => drawDraft(text) };
        if (imgs.length && imagesOk) opts.images = imgs;
        if (teacher.tools) opts.tools = classTools();
        let res;
        try {
          res = await teacher.call(turns, opts);
        } catch (e) {
          clearDraft();
          handleError(e);
          return;
        }
        clearDraft();
        if (res.modelApplied !== MODEL) {
          // 平台换了退路模型：整段作废（不显示、不执行、不进对话历史），只留一条记录
          addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，这一轮作废', modelApplied: res.modelApplied || null, modelTierApplied: res.modelTierApplied || null });
          bar.setStatus('error', 'Opus 5.5 暂时用不了，稍后点重试。');
          return;
        }
        if (!finishTurn(res)) break;
        imgs = [];
      }
    } finally {
      busy = false;
      ctl = null;
      bar.setBusy(false);
      refresh();
      schedule(false);
    }
  }

  async function retryRun() {
    const last = history.filter((t) => !t.discarded && t.kind !== 'summary').at(-1);
    if (!last) return;
    if (last.role === 'claude') { bar.setStatus('idle', ''); return; } // 已经回过了，不用重试
    runClaude();
  }

  // 执行一轮的输出。返回 true 表示还要一轮（把没画出来的段发回去重写）
  function finishTurn(res) {
    const { segments, ops } = parseOutput(res.text, { final: true });
    const speech = segments.filter((s) => s.type === 'speech').map((s) => s.text).join('\n\n');
    if (speech.trim()) bar.addMessage({ role: 'claude', html: mdToHtml(speech) });
    const failures = [];
    const boardOps = ops.map((op) => execOp(op, failures));
    refresh();
    const firstNew = boardOps.find((o) => o.ok && (o.op === 'add' || o.op === 'replace'));
    if (firstNew) setTimeout(() => segs.get(firstNew.id)?.sec?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    addTurn({ role: 'claude', text: res.text, boardOps, modelApplied: res.modelApplied, truncated: !!res.truncated });
    bar.setStatus(res.truncated ? 'notice' : 'idle', res.truncated ? '这一轮太长，被截断了。' : '');

    const retry = [];
    for (const f of failures) {
      const seg = segs.get(f.id);
      seg.rewrites = (seg.rewrites || 0) + 1;
      if (seg.rewrites <= MAX_REWRITES) { retry.push(f); continue; }
      // 重写了还不行：原来画好的段保留原样；新段显示「这段没画出来」，课堂继续
      if (!seg.sec?.isConnected) {
        seg.failed = true;
        seg.title = f.title || seg.title;
        seg.sec = failedSec(seg);
        saveSeg(seg);
        refresh();
      }
    }
    const figErrors = boardOps.filter((o) => !o.ok && o.op !== 'add' && o.op !== 'replace');
    if (!retry.length && !figErrors.length) return false;
    const lines = [];
    for (const f of retry) lines.push(`${f.id}${f.title ? `「${f.title}」` : ''}有写法错误，没有显示：\n${f.errors.map((p, i) => `  ${i + 1}. ${p.kind}：${p.msg}`).join('\n')}`);
    for (const o of figErrors) lines.push(`指令 ${o.op} ${o.id || ''} 没执行：${o.error}`);
    const ask = retry.length ? '\n请用 board replace（id 不变）把上面没显示的段重新写对。只写这几段，不用再对学生说别的。' : '';
    addTurn({ role: 'system', kind: retry.length ? 'lint' : 'note', text: `[系统] ${lines.join('\n')}${ask}` });
    return retry.length > 0;
  }

  function handleError(e) {
    const code = e?.code;
    if (code === 'cancelled') return bar.setStatus('error', '已停止这一轮。点重试让 Claude 重新回答，或者直接再说一句。');
    if (code === 'rate_limited') return bar.setStatus('error', '请求太频繁，等一下再说。');
    if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared') return bar.setStatus('error', '需要允许这个页面使用 Claude：在页面的权限设置里打开，然后点重试。');
    if (code === 'session_expired') return bar.setStatus('error', '登录过期了：重新登录 Claude 后点重试。');
    if (code === 'prompt_too_large') { compactNext = true; return bar.setStatus('error', '这节课的记录太长了，点重试会先整理前面的内容。'); }
    if (code === 'refused') return bar.setStatus('error', 'Claude 没有回答这一轮，换个说法再试。');
    if (code === 'image_rejected') return bar.setStatus('error', '图片发不出去（格式或大小不对），换一张再试。');
    bar.setStatus('error', errorText(e));
  }

  // —— 流式草稿：话和黑板内容边生成边出现（确认是 Opus 5.5 之前都是草稿，不执行指令）——
  let raf = 0, pendingText = '';
  function drawDraft(text) {
    pendingText = text;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const { segments } = parseOutput(pendingText);
      const speech = segments.filter((s) => s.type === 'speech').map((s) => s.text).join('\n\n');
      const boards = segments.filter((s) => s.type === 'board');
      bar.setStatus('writing', boards.some((b) => !b.closed) ? 'Claude 正在写黑板…' : 'Claude 在说…');
      if (speech.trim()) {
        if (!draftMsg) draftMsg = bar.addMessage({ role: 'claude', html: '', draft: true });
        draftMsg.setHtml(mdToHtml(speech));
      }
      if (boards.length) {
        if (!draftBox) {
          draftBox = document.createElement('div');
          draftBox.className = 'class-draft';
          board.appendChild(draftBox);
          welcome.hidden = true;
        }
        draftBox.innerHTML = boards.map(draftCard).join('');
      }
    });
  }

  function draftCard(b) {
    const op = b.op || {};
    const label = op.op === 'add' ? '新的一段' : op.op === 'replace' ? `改 ${escapeHtml(op.id || '')}` : op.op === 'hide' ? `撤回 ${escapeHtml(op.id || '')}` : op.op === 'figure' ? `动图 ${escapeHtml(op.target || '')}` : '黑板';
    const body = op.op === 'add' || op.op === 'replace' ? mdToHtml(previewMd(b.body || '')) : '';
    return `<section class="class-draft-card${b.closed ? '' : ' is-writing'}"><div class="class-draft-tag">草稿 · ${label}${op.title ? `「${escapeHtml(op.title)}」` : ''}</div>${body}</section>`;
  }

  // 草稿里的组件先显示成占位（确认之后才真正画出来）
  function previewMd(md) {
    return md.replace(/^(\s{0,3})(`{3,}|~{3,})\s*([\w-]+)[^\n]*\n[\s\S]*?(?:^\s{0,3}\2\s*$|$(?![\s\S]))/gm, (m, sp, f, name) => `\n> ⏳ ${name}（确认后出现）\n`);
  }

  function clearDraft() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    draftMsg?.remove();
    draftMsg = null;
    draftBox?.remove();
    draftBox = null;
  }

  // —— 可选工具（这个查看方式支持 tools 时才给）——
  function classTools() {
    return [
      {
        name: 'get_answers',
        description: '读黑板上某个组件（按组件 id）的全部作答记录，包括每次尝试、手写转写和用时。返回最近 30 条。',
        inputSchema: { type: 'object', properties: { blockId: { type: 'string' } }, required: ['blockId'] },
        async execute({ blockId }) {
          const s = await db.collection('answers').where('block', '==', String(blockId)).get();
          return s.docs.map((d) => d.data()).sort((a, b) => a.at - b.at).slice(-30).map((a) => ({ id: a.id, kind: a.kind, q: a.q, text: a.text, value: a.value, ok: a.ok, attempts: a.attempts, transcript: a.transcript, detail: a.detail, giveup: a.giveup, ms: a.ms, images: a.images }));
        },
      },
      {
        name: 'view_handwriting',
        description: '把某条作答（answerId）的手写原图在下一轮附给你看。返回这条作答的转写和图片数量。',
        inputSchema: { type: 'object', properties: { answerId: { type: 'string' } }, required: ['answerId'] },
        async execute({ answerId }) {
          const s = await db.collection('answers').doc(String(answerId)).get();
          if (!s.exists) throw new Error('没有这条作答');
          const a = s.data();
          const blobs = (a.images || []).map((id) => localImages.get(id)).filter(Boolean);
          blobs.forEach((blob) => queue.images.push({ blob, id: Promise.resolve(null) }));
          return { transcript: a.transcript || a.text || '', images: (a.images || []).length, attachedNextTurn: blobs.length };
        },
      },
      {
        name: 'lesson_note',
        description: '记一条给课后看的观察（比如学生反复出现的错误），项目对话里的 Claude 课后会读。',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        async execute({ text }) {
          await sink.put('class_notes', { kind: 'note', text: String(text).slice(0, 2000), at: Date.now() });
          return 'ok';
        },
      },
    ];
  }

  // —— 下课：让课堂 Claude 写一份小结，存进 class_notes ——
  async function endClass() {
    if (busy) { toast('等 Claude 说完这一轮再下课'); return; }
    if (!history.length) { toast('还没开始上课'); return; }
    busy = true;
    bar.setBusy(true);
    bar.setStatus('thinking', 'Claude 在写这节课的小结…');
    try {
      const system = buildSystem({ rules: pack.main?.rules, componentDocs: COMPONENT_DOCS, pack, board: boardState() });
      const { turns } = buildTurns({ system, history: [...promptHistory(), { role: 'system', text: closingPrompt() }] });
      const res = await teacher.call(turns, { ...TEACH, cache: false });
      if (res.modelApplied !== MODEL) {
        addTurn({ role: 'system', kind: 'fallback', discarded: true, text: 'Opus 5.5 不可用，下课小结作废', modelApplied: res.modelApplied || null });
        bar.setStatus('error', 'Opus 5.5 暂时用不了，小结没写成，稍后再点「下课」。');
        return;
      }
      await sink.put('class_notes', { kind: 'summary', text: res.text, at: Date.now() });
      addTurn({ role: 'system', kind: 'closing', text: res.text });
      bar.addMessage({ role: 'claude', html: mdToHtml(res.text) });
      bar.setStatus('notice', '下课了。小结已经存好，回对话告诉 Claude「下课了」。');
      session.event('end', null, { turns: history.length });
    } catch (e) {
      handleError(e);
    } finally {
      busy = false;
      bar.setBusy(false);
    }
  }

  window.LAKit = { ...(window.LAKit || {}), classroom: { history, segs, queue, boardState, runClaude, flush, get busy() { return busy; } } };
  refresh();
}
