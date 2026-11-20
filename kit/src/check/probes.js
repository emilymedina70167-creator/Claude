// 检验里一道题的画面（设计 5.1、5.2）：每种探题各怎么作答。输入框照现有的（mathInput、formulaInput、findbug 的行），不另起一套。
// 计划 4 加的：408 的 trace（填过程表 filltable.js）、predict（每个结果一格 + 理由）、construct 的 seq / text / procs 格子、code（等宽框）、
// calc（solve 的写字框 + 最后的值）、tradeoff（recall 的样子）；英语的 parse / errfind（点词，blocks/enpick.js 和一类组件同一份）、
// rewrite（只打字）、translate（能手写）、discriminate 的两个按钮（options:）。格式不对（seq 少一个数、表还有空格）交之前挡住、写原因。
// 不判对错（judge.js 判）；这里只收作答：answer() 给 judge.js 的样子，problem() 交之前还差什么（judge.js 的 notReady），empty() 一个字也没写。
import { mathInput } from '../mathinput.js';
import { formulaInput } from '../formulainput.js';
import { mdToHtml, tex2html, escapeHtml } from '../blocks/common.js';
import { markDraft } from '../drafts.js';
import { pen } from '../ink/engine.js';
import { timedPad } from './inkpad.js';
import { uploadAll } from './judgekit.js';
import { notReady, expectProblems } from './judge.js';
import { hasInk, dropInk } from './inkstore.js';
import { baseType, slotProblems, seqTokens, traceTable } from './spec.js';
import { markDuplicates } from '../engines/measures.js';
import { parseCodeSpec } from '../codejudge.js';
import { tokenizeSentence } from '../entext.js';
import { textAnswerInput } from '../textinput.js';
import { fillTable } from './filltable.js';
import { spanPicker, wordPicker } from '../blocks/enpick.js';

const STR_SLOTS = new Set(['seq', 'text', 'procs']);
const shapeOf = (s) => (s.kind === 'mat' ? { kind: 'matrix', r: s.r, c: s.c } : s.kind === 'vec' ? { kind: 'vector', n: s.n } : { kind: 'number' });
const md = (t) => mdToHtml(String(t ?? ''));

// 一个格子输入（mathInput）里写着的原文：二维 / 一维 / 一个，空格照空串留着（judge.js 的 blankCells 数）
function rawCells(box, slot) {
  if (STR_SLOTS.has(slot.kind)) return box.querySelector('.ti-input, .ck-text')?.value.trim() ?? '';
  const v = [...box.querySelectorAll('.mi-cell')].map((c) => c.value.trim().replace(/−/g, '-'));
  if (slot.kind === 'mat') return Array.from({ length: slot.r }, (_, i) => v.slice(i * slot.c, (i + 1) * slot.c));
  if (slot.kind === 'vec') return v;
  return v[0] ?? '';
}

function choice(host, labels, onPick) {
  const row = document.createElement('div');
  row.className = 'ck-choice';
  row.setAttribute('role', 'group');
  row.innerHTML = labels.map(([v, t]) => `<button type="button" class="btn ck-pick" data-v="${escapeHtml(v)}">${escapeHtml(t)}</button>`).join('');
  let val = null;
  row.addEventListener('click', (e) => {
    const b = e.target.closest('.ck-pick');
    if (!b) return;
    val = b.dataset.v;
    row.querySelectorAll('.ck-pick').forEach((x) => x.classList.toggle('is-on', x === b));
    onPick?.(val);
  });
  host.appendChild(row);
  return { get value() { return val; }, set(v) { const b = [...row.querySelectorAll('.ck-pick')].find((x) => x.dataset.v === String(v)); if (b) b.click(); } };
}

function textArea(host, { placeholder = '', rows = 4, label = '' } = {}) {
  const wrap = document.createElement('label');
  wrap.className = 'ck-field';
  wrap.innerHTML = `${label ? `<span class="ck-label">${escapeHtml(label)}</span>` : ''}<textarea class="ck-text" rows="${rows}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" spellcheck="false"></textarea>`;
  host.appendChild(wrap);
  return wrap.querySelector('textarea');
}

function slotBoxes(host, slots) {
  const out = {};
  const grid = document.createElement('div');
  grid.className = 'ck-slots';
  for (const s of slots) {
    const cell = document.createElement('div');
    cell.className = 'ck-slot';
    cell.innerHTML = `<span class="ck-slot-name">${tex2html(`${s.name} =`)}</span><div class="ck-slot-box"></div>`;
    grid.appendChild(cell);
    const box = cell.querySelector('.ck-slot-box');
    // 408 的格子：一排数（下面回显切成几个、数一数）、一段字、几个进程（一行一个）
    // 一排数的回显和交之前的格式检查用同一个切法（spec.js 的 seqTokens：括号、全角逗号、顿号都一样），数出来的个数才对得上
    if (s.kind === 'seq') textAnswerInput(box, { kind: 'line', ph: '按顺序写，用空格或逗号隔开', echo: (v) => { const t = seqTokens(v); return t.length ? `${t.join(' → ')}　${t.length} 个` : ''; } });
    else if (s.kind === 'text') textAnswerInput(box, { kind: 'line', ph: '写在这里' });
    else if (s.kind === 'procs') { cell.classList.add('ck-slot-wide'); textArea(box, { rows: Math.min(10, s.n + 1), placeholder: `一行一个进程：名字 到达时间 运行时间${s.prio ? ' 优先级' : ''}（比如 P1 0 3${s.prio ? ' 2' : ''}）` }); }
    else mathInput(box, shapeOf(s));
    if (STR_SLOTS.has(s.kind)) cell.classList.add('ck-slot-str');
    out[s.name] = { box, slot: s };
  }
  host.appendChild(grid);
  return out;
}

function exprBoxes(host, exprs, names) {
  const out = {};
  for (const e of exprs) {
    const row = document.createElement('div');
    row.className = 'ck-expr';
    row.innerHTML = `<span class="ck-label">${escapeHtml(e.label)}</span><div class="ck-expr-box"></div>`;
    host.appendChild(row);
    out[e.id] = formulaInput(row.querySelector('.ck-expr-box'), { names, keys: names, placeholder: `用 ${names.join('、')} 写` });
  }
  return out;
}

/**
 * 画一道题。host 里画；vars 是题里的量（题面的 \calc 用）。返回 { answer(), problem(), empty(), lock(), destroy(), el }。
 * onChange：作答变了（外壳拿它决定「交」亮不亮、登记草稿）；base：整节课的量（predict 交之前照对的值的样子查读不读得懂）
 */
export function probeView(host, probe, { onChange = () => {}, inkKey = '', pause, base = {} } = {}) {
  const el = document.createElement('div');
  el.className = `ck-probe ck-${probe.type}`;
  el.dataset.probe = probe.id;
  el.innerHTML = `<div class="ck-q">${md(probe.type === 'claim' ? `**判断：**${probe.claim}` : probe.q)}</div>${probe.type === 'claim' && probe.q ? `<div class="ck-q ck-q2">${md(probe.q)}</div>` : ''}<div class="ck-work"></div>`;
  host.appendChild(el);
  const work = el.querySelector('.ck-work');
  const changed = () => onChange();
  let locked = false;
  el.addEventListener('input', changed);
  el.addEventListener('click', (e) => { if (e.target.closest('.ck-pick, .ck-line')) changed(); });
  let get = () => ({});
  let problem = () => ''; // 交之前还差什么（格子没填、读不懂、式子框空着）：'' 是能交
  let empty = () => false;

  // 写字的地方：「手写 / 打字」两个页签（手写是检验手写板 inkpad.js，记每一笔的时间、划掉留痕）。
  // 见过 Pencil 默认手写，不然默认打字；逐行推的证明只能打字（页面要逐行核）
  let active = null; // 现在要交的那一个写字的地方（claim 换了判断会换一个）
  const keys = new Set(); // 这道题用过的本地存档（交了、想不出来了都删）
  const store = (() => { try { return localStorage; } catch { return null; } })();
  // claim 判真、判假各一块手写板：各存各的（以前共用一个 key，换了判断，另一边写的字跑过来）
  const writer = (opts, { hand = true, part = '' } = {}) => {
    const key = inkKey ? `${inkKey}${part ? `-${part}` : ''}` : '';
    if (key) keys.add(key);
    const wrap = document.createElement('div');
    wrap.className = 'ck-writer';
    work.appendChild(wrap);
    let pad = null;
    let useHand = hand && pen.seen;
    if (hand) {
      wrap.innerHTML = '<div class="ck-tabs" role="tablist"><button type="button" class="btn btn-sm ck-tab" data-tab="hand">手写</button><button type="button" class="btn btn-sm ck-tab" data-tab="type">打字</button></div>';
      wrap.querySelector('.ck-tabs').addEventListener('click', (e) => { const b = e.target.closest('.ck-tab'); if (b) { useHand = b.dataset.tab === 'hand'; show(); } });
    }
    const ta = textArea(wrap, opts);
    const taWrap = ta.closest('.ck-field');
    const show = () => {
      if (useHand && !pad) pad = timedPad(wrap, { key, ...(pause ? { pause } : {}) });
      if (pad) pad.el.hidden = !useHand;
      taWrap.hidden = useHand;
      wrap.querySelectorAll('.ck-tab').forEach((b) => b.classList.toggle('is-on', (b.dataset.tab === 'hand') === useHand));
      changed();
    };
    // 这台设备上存着没交的笔画：直接打开手写
    if (hand && hasInk(store, key)) useHand = true;
    show();
    const w = {
      text: () => ta.value.trim(),
      pad: () => (useHand && pad && !pad.isEmpty() ? pad : null),
      blank: () => !ta.value.trim() && !(useHand && pad && !pad.isEmpty()),
      destroy: () => pad?.destroy(),
    };
    active = w;
    return w;
  };

  const locks = []; // 点词、填表这些自己记着能不能改的：lock() 时一起锁上
  const lineIn = (host, { label = '', ph = '' } = {}) => {
    const wrap = document.createElement('label');
    wrap.className = 'ck-field ck-line-field';
    wrap.innerHTML = `${label ? `<span class="ck-label">${escapeHtml(label)}</span>` : ''}<input type="text" class="ck-in" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${escapeHtml(ph)}">`;
    host.appendChild(wrap);
    return wrap.querySelector('input');
  };
  // 英语的原句（translate、rewrite 照着写）
  const original = (text) => { if (!text) return; const d = document.createElement('div'); d.className = 'ck-orig'; d.lang = 'en'; d.textContent = text; work.appendChild(d); };
  const firstOf = (...xs) => xs.find(Boolean) || '';

  if (baseType(probe) === 'construct') {
    const boxes = slotBoxes(work, probe.slots);
    const names = probe.slots.map((s) => s.name);
    const ex = exprBoxes(work, probe.exprs || [], names);
    // 一排数里有一样的（49 38 49）：排序跑之前页面把后出现的记成 49′，作答下面当场写一行（判的时候照这样跑）
    const sortArrays = new Set((probe.runs || []).filter((r) => r.engine === 'sort').map((r) => r.fields.array));
    const note = document.createElement('p');
    note.className = 'ck-note';
    note.hidden = true;
    work.appendChild(note);
    const strSlots = probe.slots.filter((s) => STR_SLOTS.has(s.kind));
    const paintNote = () => {
      const lines = strSlots.filter((s) => s.kind === 'seq' && sortArrays.has(s.name)).map((s) => {
        const raw = rawCells(boxes[s.name].box, s);
        if (slotProblems(s, raw).length) return '';
        const m = markDuplicates(seqTokens(raw).join(' '));
        return m.changed ? `页面把${m.notes.join('、')}` : '';
      }).filter(Boolean);
      note.textContent = lines.join('；');
      note.hidden = !lines.length;
    };
    work.addEventListener('input', paintNote);
    get = () => ({ slots: Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, rawCells(b.box, b.slot)])), exprs: Object.fromEntries(Object.entries(ex).map(([k, f]) => [k, f.partial()])) });
    // 408 的格子先查格式（slotProblems：「要 8 个数，写了 7 个」），矩阵、数的格子照旧（notReady）
    problem = () => {
      const a = get();
      const many = probe.slots.length > 1;
      for (const sl of strSlots) { const m = slotProblems(sl, a.slots[sl.name]); if (m.length) return `${many ? `${sl.name}：` : ''}${m[0]}`; }
      return notReady({ ...probe, slots: probe.slots.filter((x) => !STR_SLOTS.has(x.kind)) }, a);
    };
  } else if (probe.type === 'trace') {
    let T = null;
    try { T = traceTable(probe).table; } catch (e) { work.insertAdjacentHTML('beforeend', `<p class="ck-warn">这道题的表画不出来：${escapeHtml(e.message)}</p>`); }
    if (T) {
      const ft = fillTable(work, T, { onChange: changed });
      locks.push(ft);
      // 表下面那几格单独放（数组上挂的 extra 存进 JSON 会丢）
      get = () => { const v = ft.values(); return { cells: v.map((row) => [...row]), extra: [...v.extra] }; };
      problem = () => { const n = ft.blanks(); return n ? `还有 ${n} 格没填（该空着的格写 -）` : ''; };
      empty = () => ft.empty();
    } else { problem = () => '这道题画不出来'; empty = () => true; }
  } else if (probe.type === 'predict') {
    const ins = (probe.expects || []).map((e) => [e, lineIn(work, { label: e.label })]);
    const hasWhy = (probe.must || []).length || (probe.may || []).length;
    const w = hasWhy ? writer({ label: '理由', rows: 3 }) : null;
    get = () => ({ expects: Object.fromEntries(ins.map(([e, x]) => [e.id, x.value.trim()])), ...(w ? { text: w.text() } : {}) });
    // 没写的、读不懂的（带了单位、O(n2)、一串数里夹了字）挡在交之前，不算第一次作答；全角、末尾的句号逗号照读（judge.js 的 expectProblems）
    problem = () => firstOf(...expectProblems(probe, get().expects, base), w && w.blank() ? '还没写理由' : '');
    empty = () => ins.every(([, x]) => !x.value.trim()) && (!w || w.blank());
  } else if (probe.type === 'code') {
    let starter = '';
    try { starter = parseCodeSpec(probe.code || {}).starter || ''; } catch { starter = ''; }
    const wrap = document.createElement('label');
    wrap.className = 'ck-field';
    wrap.innerHTML = '<span class="ck-label">代码（C）</span><textarea class="ck-text ck-code" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>';
    work.appendChild(wrap);
    const ta = wrap.querySelector('textarea');
    ta.value = starter;
    ta.rows = Math.max(8, Math.min(24, starter.split('\n').length + 3));
    // Tab 写缩进（外接键盘），不跳出去
    ta.addEventListener('keydown', (e) => { if (e.key !== 'Tab' || e.shiftKey) return; e.preventDefault(); const a = ta.selectionStart; ta.setRangeText('    ', a, ta.selectionEnd, 'end'); changed(); });
    get = () => ({ code: ta.value });
    empty = () => !ta.value.trim() || (!!starter && ta.value.trim() === starter.trim()); // 还是原样的起头代码：算没写
  } else if (probe.type === 'parse') {
    const sp = spanPicker(work, { tokens: probe.tokens || [], roles: probe.roles || [], onChange: changed });
    locks.push(sp);
    work.insertAdjacentHTML('beforeend', '<div class="ck-row"><button type="button" class="btn ck-clear">清空</button></div>');
    work.querySelector('.ck-clear').addEventListener('click', () => sp.clear());
    get = () => ({ spans: sp.spans() });
    empty = () => sp.empty();
  } else if (probe.type === 'errfind') {
    let fixIn = null;
    const wp = wordPicker(work, tokenizeSentence(probe.text || ''), { onPick: () => { fixRow.hidden = false; changed(); } });
    locks.push(wp);
    const fixRow = document.createElement('div');
    fixRow.className = 'ck-fixrow';
    fixRow.hidden = true;
    work.appendChild(fixRow);
    fixIn = lineIn(fixRow, { label: '改成', ph: '改成什么；多了一个词就写「删」' });
    fixRow.insertAdjacentHTML('beforeend', '<button type="button" class="btn ck-del">删掉这个词</button>');
    fixRow.querySelector('.ck-del').addEventListener('click', () => { fixIn.value = '删'; changed(); });
    const hasWhy = (probe.must || []).length || (probe.may || []).length;
    const w = hasWhy ? writer({ label: '为什么错', rows: 3 }) : null;
    get = () => ({ word: wp.picked() < 0 ? null : wp.picked(), fix: fixIn.value.trim(), ...(w ? { text: w.text() } : {}) });
    problem = () => (wp.picked() < 0 ? '' : firstOf(fixIn.value.trim() ? '' : '还没写改成什么', w && w.blank() ? '还没写为什么' : ''));
    empty = () => wp.picked() < 0;
  } else if (probe.type === 'rewrite') {
    original(probe.text);
    const w = writer({ label: '改写成', rows: 2 }, { hand: false }); // 页面要逐词核 has / not：只打字
    get = () => ({ text: w.text() });
    empty = () => w.blank();
  } else if (probe.type === 'translate') {
    original(probe.text);
    const w = writer({ label: '译文', rows: 4 });
    get = () => ({ text: w.text() });
    empty = () => w.blank();
  } else if (probe.type === 'claim') {
    const area = document.createElement('div');
    let boxes = null, ex = null, w = null;
    const pick = choice(work, [['true', '真'], ['false', '假']], (v) => {
      w?.destroy();
      area.innerHTML = '';
      boxes = ex = w = null;
      active = null;
      if (v === 'false' && probe.slots) {
        area.insertAdjacentHTML('beforeend', '<p class="ck-hint">给一个反例：</p>');
        boxes = slotBoxes(area, probe.slots);
        ex = exprBoxes(area, probe.exprs || [], probe.slots.map((s) => s.name));
      } else if (v === 'true' && probe.proof) {
        w = writer({ label: `从 ${probe.proof.start} 一行一行推（一行一个式子）`, rows: 5 }, { hand: false });
      } else w = writer({ label: v === 'true' ? '为什么成立（证明的要点）' : '反例（写出来、说明为什么不成立）', rows: 5 }, { part: v });
      if (w) area.appendChild(work.querySelector(':scope > .ck-writer:last-child'));
    });
    work.appendChild(area);
    get = () => {
      const truth = pick.value === null ? null : pick.value === 'true';
      const out = { truth };
      if (boxes) { out.slots = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, rawCells(b.box, b.slot)])); out.exprs = Object.fromEntries(Object.entries(ex || {}).map(([k, f]) => [k, f.partial()])); }
      if (w) { if (probe.proof && truth) out.proof = w.text().split('\n').map((x) => x.trim()).filter(Boolean); else out.text = w.text(); }
      return out;
    };
    problem = () => (boxes ? notReady({ ...probe, exprs: probe.exprs || [] }, get()) : '');
    empty = () => pick.value === null || (w && w.blank());
  } else if (probe.type === 'discriminate' && probe.options) {
    // 英语的两个按钮（谓语 / 非谓语）：作答写选的那个字
    const pick = choice(work, probe.options.map((o) => [o, o]));
    const w = writer({ label: '为什么', rows: 4 });
    get = () => ({ pick: pick.value, text: w.text() });
    problem = () => (pick.value !== null && w.blank() ? '还没写为什么' : '');
    empty = () => pick.value === null;
  } else if (probe.type === 'discriminate') {
    const pick = choice(work, [['true', '能'], ['false', '不能']]);
    const w = writer({ label: '为什么；能用的话怎么用，不能用的话用什么', rows: 5 });
    const res = probe.result ? exprBoxes(work, [{ id: 'result', label: '最后结果' }], ['A', 'B', 'E', 'n']).result : null;
    get = () => ({ can: pick.value === null ? null : pick.value === 'true', text: w.text(), ...(res ? { result: res.partial() } : {}) });
    empty = () => pick.value === null || w.blank();
  } else if (probe.type === 'locate') {
    const list = document.createElement('ol');
    list.className = 'ck-lines';
    list.innerHTML = probe.lines.map((l, i) => `<li><button type="button" class="ck-line" data-n="${i + 1}"><span class="ck-ln">${i + 1}</span><span class="ck-lt">${md(l)}</span></button></li>`).join('');
    work.appendChild(list);
    let line = null;
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.ck-line');
      if (!b) return;
      line = Number(b.dataset.n);
      list.querySelectorAll('.ck-line').forEach((x) => x.classList.toggle('is-on', x === b));
    });
    const w = writer({ label: '这一行为什么错', rows: 3 });
    const fix = probe.fix ? textArea(work, { label: '改成什么', rows: 1 }) : null;
    get = () => ({ line, text: w.text(), ...(fix ? { fix: fix.value.trim() } : {}) });
    empty = () => line === null || w.blank();
  } else {
    // recall、solve（tradeoff、calc 是它们的别名）：整段写；solve 写了 result: 的另有一格最后的值（页面判）
    const solve = baseType(probe) === 'solve';
    const w = writer({ label: solve ? '整道题的过程（每一步写依据）' : '', rows: solve ? 8 : 6, placeholder: baseType(probe) === 'recall' ? '合上板书，自己写' : '' });
    const res = solve && probe.result ? lineIn(work, { label: '最后的值' }) : null;
    get = () => ({ text: w.text(), ...(res ? { result: res.value.trim() } : {}) });
    problem = () => (res && !w.blank() && !res.value.trim() ? '还没写最后的值' : '');
    empty = () => w.blank();
  }
  // 写着还没交的（drafts.js：下课那一刻没交的记成草稿证据）
  markDraft(el, () => { if (locked || empty()) return ''; try { return `检验 ${probe.id}：${JSON.stringify(get()).slice(0, 400)}`; } catch { return ''; } });
  return {
    el,
    answer: () => get(),
    /**
     * 交：作答 + 手写（有的话）。upload(blob) → 资源编号（失败回 null）；手写的整页图、快照传上去，答案里带 ink: { final, shots, timeline }，
     * 返回 { answer, images: [整页图]（给页面里的 Claude 判）, strokes, events }
     */
    async collect(upload = async () => null) {
      const answer = get();
      const pad = active?.pad?.();
      if (!pad) return { answer, images: [] };
      const out = await pad.export();
      // 整页图和快照一起传，每张最多等 10 秒；传不上的记 null（判分照样用手上的整页图）
      const [final, ...ids] = await uploadAll([out.final, ...out.shots.map((x) => x.blob)], upload);
      const shots = out.shots.map((x, i) => ({ at: x.t, why: x.why, asset: ids[i] }));
      return { answer: { ...answer, ink: { final, shots, timeline: out.timeline, lines: out.lines.length } }, images: out.final ? [out.final] : [], strokes: out.strokes, events: out.events };
    },
    problem: () => problem(),
    /** 交了、想不出来了：这道题在这台设备上存着的笔画都删掉（交了打字版也删，不再越积越多） */
    clearInk() { for (const k of keys) dropInk(store, k); },
    empty: () => empty(),
    lock() { locked = true; locks.forEach((x) => x.lock()); el.classList.add('is-locked'); el.querySelectorAll('input, textarea, button').forEach((x) => { x.disabled = true; }); },
    destroy() { active?.destroy?.(); el.remove(); },
  };
}
