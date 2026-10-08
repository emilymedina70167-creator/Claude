// 排序课组件：
//   array     数组示意（可按增量 d 给子表着色、分行）
//   shellsort 希尔排序演示：mode: pass 按趟看；mode: code 按王道代码逐行看
//   sortpass  自己写出若干趟（或代码执行到某个 i）之后的序列，自动判分
import { parseFields } from '../parse.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { answerWidget, plain } from './answer.js';
import {
  parseArray, parseGaps, shellTrace, shellRun, arrayHtml, explainPass, explainUpto,
  SHELL_CODE, groupOf, values, fmt,
} from '../sorting.js';

const intField = (s, name, min, max) => {
  if (s === undefined || s === '') return undefined;
  const x = Number(s);
  if (!Number.isInteger(x) || x < min || x > max) throw new Error(`${name}: 要写 ${min} 到 ${max} 之间的整数（现在是「${s}」）`);
  return x;
};

// —— array：静态示意 ——
export function array(el, src) {
  const { fields } = parseFields(src);
  if (!fields.array) throw new Error('array 需要 array:（如 49 38 65 97）');
  const items = parseArray(fields.array);
  const gap = intField(fields.gap ?? fields.d, 'gap', 1, items.length - 1) || 0;
  const split = /^(true|yes|1|是)$/i.test(fields.split || '');
  const body = widget(el, { title: fields.title, cls: 'sortarr' });
  body.innerHTML = `${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="arr-box">${arrayHtml(items, { gap, split, zero: /^(true|yes|1|是)$/i.test(fields.zero || '') })}</div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}`;
  if (!fields.title) el.querySelector('.widget').classList.add('no-title');
}

// —— shellsort：可逐步播放的演示 ——
export function shellsort(el, src) {
  const { fields } = parseFields(src);
  if (!fields.array) throw new Error('shellsort 需要 array:（如 49 38 65 97 76 13 27 49\'）');
  const items = parseArray(fields.array);
  const n = items.length;
  const gaps = parseGaps(fields.gaps ?? fields.d, n);
  const mode = (fields.mode || 'pass').toLowerCase();
  if (!['pass', 'code'].includes(mode)) throw new Error('mode: 只能是 pass（按趟）或 code（按代码逐行）');
  const goal = /^(end|finish|结束|看完)$/i.test(fields.goal || '');
  const title = fields.title || (mode === 'code' ? '代码逐行演示 Code trace' : '希尔排序演示 Shell sort');

  const trace = shellTrace(items, gaps);
  const steps = mode === 'code' ? trace : passSteps(items, gaps);
  const body = widget(el, { title, cls: `shellsort ss-mode-${mode}` });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="ss-wrap">
      ${mode === 'code' ? `<pre class="ss-code">${SHELL_CODE.map((l, k) => `<span class="ss-line" data-line="${k}">${escapeHtml(l)}</span>`).join('')}</pre>` : ''}
      <div class="ss-main">
        <div class="ss-gaps muted">增量序列 d：${gaps.join(', ')}</div>
        <div class="arr-box ss-arr"></div>
        <div class="ss-vars"></div>
        <div class="ss-msg" aria-live="polite"></div>
        <div class="ss-ctrl">
          <button type="button" class="btn btn-sm ss-reset" title="回到开头">⏮</button>
          <button type="button" class="btn btn-sm ss-prev">◀ 上一步</button>
          <button type="button" class="btn btn-sm btn-primary ss-next">下一步 ▶</button>
          <button type="button" class="btn btn-sm ss-play">自动播放</button>
          <span class="ss-count muted"></span>
        </div>
        ${mode === 'code' ? '<div class="ss-jump"><span class="muted">跳到：</span>' + gaps.map((d, k) => `<button type="button" class="link-btn" data-pass="${k + 1}">第 ${k + 1} 趟开头</button>`).join('') + '<button type="button" class="link-btn" data-pass="end">最后</button></div>' : ''}
        ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}
      </div>
    </div>`;

  const arrBox = body.querySelector('.ss-arr');
  const vars = body.querySelector('.ss-vars');
  const msg = body.querySelector('.ss-msg');
  const count = body.querySelector('.ss-count');
  const btnPrev = body.querySelector('.ss-prev');
  const btnNext = body.querySelector('.ss-next');
  const btnPlay = body.querySelector('.ss-play');
  const lines = [...body.querySelectorAll('.ss-line')];
  const done = goal ? session.gate(el, title) : null;
  let k = 0;
  let timer = null;

  function draw() {
    const s = steps[k];
    if (mode === 'code') {
      const cls = {};
      const ptr = {};
      if (s.cmp) s.cmp.forEach((p) => (cls[p] = 'arr-cmp'));
      if (s.moved) cls[s.moved] = 'arr-moved';
      if (s.placed) cls[s.placed] = 'arr-placed';
      if (s.i) ptr[s.i] = 'i';
      if (s.j !== undefined && s.j >= 0 && s.j <= n) ptr[s.j] = s.i === s.j ? 'i,j' : 'j';
      // 当前子表着色：只给 i 所在的子表上色，其余淡化
      const d = s.d;
      const focus = s.i && d ? groupOf(s.i, d) : 0;
      if (focus) for (let p = 1; p <= n; p++) if (groupOf(p, d) !== focus) cls[p] = (cls[p] ? cls[p] + ' ' : '') + 'arr-dim';
      arrBox.innerHTML = arrayHtml(s.A.slice(1), { zero: true, temp: s.A[0], gap: focus ? d : 0, cls, ptr, done: s.kind === 'passEnd' && k === steps.length - 1 });
      lines.forEach((l) => l.classList.toggle('on', Number(l.dataset.line) === s.line));
      const on = lines.find((l) => l.classList.contains('on'));
      on?.parentElement && (on.parentElement.scrollTop = Math.max(0, on.offsetTop - on.parentElement.clientHeight / 2));
      vars.innerHTML = varChips([['d', s.d], ['i', s.i], ['j', s.j], ['A[0]', s.A[0] ? fmt(s.A[0]) : undefined], ['后移次数', s.moves]]);
    } else {
      arrBox.innerHTML = arrayHtml(s.A, { gap: s.gap, split: s.gap > 1, done: s.final });
      vars.innerHTML = varChips([['趟', s.pass || undefined], ['d', s.d], ['本趟后移', s.passMoves], ['累计后移', s.moves]]);
    }
    msg.innerHTML = mdToHtml(s.msg, { inline: true });
    count.textContent = `第 ${k + 1} / ${steps.length} 步`;
    btnPrev.disabled = k === 0;
    btnNext.disabled = k === steps.length - 1;
    if (k === steps.length - 1) {
      stop();
      if (done) { done(); session.record({ type: 'scene', title, ok: true, stage: session.stageOf(el) }); }
    }
  }
  const go = (to) => { k = Math.max(0, Math.min(steps.length - 1, to)); draw(); };
  function stop() { clearInterval(timer); timer = null; btnPlay.textContent = '自动播放'; }
  btnPrev.addEventListener('click', () => { stop(); go(k - 1); });
  btnNext.addEventListener('click', () => { stop(); go(k + 1); });
  body.querySelector('.ss-reset').addEventListener('click', () => { stop(); go(0); });
  btnPlay.addEventListener('click', () => {
    if (timer) { stop(); return; }
    if (k === steps.length - 1) go(0);
    btnPlay.textContent = '暂停';
    timer = setInterval(() => (k >= steps.length - 1 ? stop() : go(k + 1)), mode === 'code' ? 900 : 1600);
  });
  body.querySelector('.ss-jump')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pass]');
    if (!b) return;
    stop();
    if (b.dataset.pass === 'end') go(steps.length - 1);
    else go(steps.findIndex((s) => s.kind === 'pass' && s.pass === Number(b.dataset.pass)));
  });
  draw();
}

function varChips(pairs) {
  return pairs.filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `<span class="ss-chip"><b>${escapeHtml(k)}</b> ${escapeHtml(String(v))}</span>`).join('');
}

// 按趟：开始 →（第 k 趟分子表 → 第 k 趟排好）…
function passSteps(items, gaps) {
  const steps = [{ A: items, gap: 0, msg: '初始序列。点「下一步」开始第一趟。', moves: 0 }];
  let cur = items;
  let total = 0;
  gaps.forEach((d, k) => {
    const last = k === gaps.length - 1;
    steps.push({ A: cur, gap: d, pass: k + 1, d, moves: total,
      msg: d === 1 ? `第 ${k + 1} 趟，d = 1：所有元素属于同一个子表。` : `第 ${k + 1} 趟，d = ${d}：相距 ${d} 的元素归为同一个子表（同色），共 ${Math.min(d, items.length)} 个子表。` });
    const r = shellRun(cur, [d]);
    total += r.moves;
    cur = r.result;
    steps.push({ A: cur, gap: d, pass: k + 1, d, passMoves: r.moves, moves: total, final: last,
      msg: d === 1 ? `对整个表做一次直接插入排序，本趟只后移了 ${r.moves} 次。${last ? '排序完成。' : ''}` : `每个子表**各自**做直接插入排序，再放回原来的位置。本趟后移 ${r.moves} 次。` });
  });
  return steps;
}

// —— sortpass：自己写出结果 ——
export function sortpass(el, src) {
  const { fields } = parseFields(src);
  if (!fields.array) throw new Error('sortpass 需要 array:（初始序列）');
  const items = parseArray(fields.array);
  const n = items.length;
  if (fields.gaps === undefined && fields.gap === undefined && fields.d === undefined) throw new Error('sortpass 需要 gap:（一趟的增量）或 gaps:（几趟的增量，如 4, 2）');
  const gaps = parseGaps(fields.gaps ?? fields.gap ?? fields.d, n);
  const last = gaps[gaps.length - 1];
  const upto = intField(fields.upto, 'upto', last + 1, n);
  const run = shellRun(items, gaps, { upto });
  const title = fields.title || '自己排一趟 Your turn';
  let explain = fields.explain;
  if (!explain) {
    const before = gaps.length > 1 ? shellRun(items, gaps.slice(0, -1)).result : items;
    explain = upto ? explainUpto(before, last, upto) : explainPass(before, last);
    if (gaps.length > 1) explain = `前面几趟（d = ${gaps.slice(0, -1).join(', ')}）之后是 $${before.map((x) => (x.mark ? `\\underline{${x.v}}` : x.v)).join(',\\ ')}$。最后一趟 d = ${last}：\n\n${explain}`;
  }
  const defaultQ = upto
    ? `按王道代码做增量 $d = ${last}$ 的这一趟，**i 从 ${last + 1} 处理到 ${upto} 为止**（还没处理后面的 i）。此时数组是什么？`
    : gaps.length > 1 ? `依次用增量 ${gaps.map((d) => `$d=${d}$`).join('、')} 做希尔排序，写出最后一趟结束后的序列。`
      : `用增量 $d = ${last}$ 做**一趟**希尔排序（升序），写出这一趟结束后的序列。`;
  const body = widget(el, { title, cls: 'answer sortpass' });
  const done = session.gate(el, title);
  const q = fields.q || defaultQ;
  answerWidget(body, {
    q,
    qhtml: `<div class="arr-box">${arrayHtml(items, {})}</div>`,
    answer: values(run.result),
    type: 'array',
    hint: fields.hint,
    explain,
    before: fields.before,
  }, (r) => {
    session.record({ type: 'answer', title, q: plain(`${q.replace(/\$/g, '')}｜初始：${items.map(fmt).join(' ')}`), ok: r.ok, attempts: r.attempts, first: r.first, expected: `(${run.result.map(fmt).join(', ')})`, revealed: r.revealed, stage: session.stageOf(el) });
    done();
  });
}
