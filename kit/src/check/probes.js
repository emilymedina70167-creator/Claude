// 检验里一道题的画面（设计 5.1、5.2）：六种探题各怎么作答。输入框照现有的（mathInput、formulaInput、findbug 的行），不另起一套。
// 不判对错（judge.js 判）；这里只收作答：answer() 给 judge.js 的样子，problem() 交之前还差什么（judge.js 的 notReady），empty() 一个字也没写。
import { mathInput } from '../mathinput.js';
import { formulaInput } from '../formulainput.js';
import { mdToHtml, tex2html, escapeHtml } from '../blocks/common.js';
import { markDraft } from '../drafts.js';
import { pen } from '../ink/engine.js';
import { timedPad } from './inkpad.js';
import { uploadAll } from './judgekit.js';
import { notReady } from './judge.js';
import { hasInk, dropInk } from './inkstore.js';

const shapeOf = (s) => (s.kind === 'mat' ? { kind: 'matrix', r: s.r, c: s.c } : s.kind === 'vec' ? { kind: 'vector', n: s.n } : { kind: 'number' });
const md = (t) => mdToHtml(String(t ?? ''));

// 一个格子输入（mathInput）里写着的原文：二维 / 一维 / 一个，空格照空串留着（judge.js 的 blankCells 数）
function rawCells(box, slot) {
  const v = [...box.querySelectorAll('.mi-cell')].map((c) => c.value.trim().replace(/−/g, '-'));
  if (slot.kind === 'mat') return Array.from({ length: slot.r }, (_, i) => v.slice(i * slot.c, (i + 1) * slot.c));
  if (slot.kind === 'vec') return v;
  return v[0] ?? '';
}

function choice(host, labels, onPick) {
  const row = document.createElement('div');
  row.className = 'ck-choice';
  row.setAttribute('role', 'group');
  row.innerHTML = labels.map(([v, t]) => `<button type="button" class="btn ck-pick" data-v="${v}">${t}</button>`).join('');
  let val = null;
  row.addEventListener('click', (e) => {
    const b = e.target.closest('.ck-pick');
    if (!b) return;
    val = b.dataset.v;
    row.querySelectorAll('.ck-pick').forEach((x) => x.classList.toggle('is-on', x === b));
    onPick?.(val);
  });
  host.appendChild(row);
  return { get value() { return val; }, set(v) { const b = row.querySelector(`[data-v="${v}"]`); if (b) b.click(); } };
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
    mathInput(box, shapeOf(s));
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
 * onChange：作答变了（外壳拿它决定「交」亮不亮、登记草稿）
 */
export function probeView(host, probe, { onChange = () => {}, inkKey = '', pause } = {}) {
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

  if (probe.type === 'construct') {
    const boxes = slotBoxes(work, probe.slots);
    const names = probe.slots.map((s) => s.name);
    const ex = exprBoxes(work, probe.exprs || [], names);
    get = () => ({ slots: Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, rawCells(b.box, b.slot)])), exprs: Object.fromEntries(Object.entries(ex).map(([k, f]) => [k, f.partial()])) });
    problem = () => notReady(probe, get());
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
    // recall、solve：整段写
    const w = writer({ label: probe.type === 'solve' ? '整道题的过程（每一步写依据）' : '', rows: probe.type === 'solve' ? 8 : 6, placeholder: probe.type === 'recall' ? '合上板书，自己写' : '' });
    get = () => ({ text: w.text() });
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
    lock() { locked = true; el.classList.add('is-locked'); el.querySelectorAll('input, textarea, button').forEach((x) => { x.disabled = true; }); },
    destroy() { active?.destroy?.(); el.remove(); },
  };
}
