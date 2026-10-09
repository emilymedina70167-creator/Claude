// recognize：认方法快练。只认方法、不计算：一次一题，点一个方法（可要求写一句理由），
// 马上看对错、标准方法和原因。每题计时（不扣分），做完有小结，可以只重做错的。
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { plain } from './answer.js';
import { thinkBox } from './thinkbox.js';

const KEY = /^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/;
const yes = (v) => /^(true|yes|1|是)$/i.test(String(v || '').trim());

export function parseRecognize(src) {
  const fields = {};
  const items = [];
  let target = fields, last = null;
  for (const raw of String(src).split('\n')) {
    const m = raw.match(KEY);
    if (m) {
      const k = m[1].toLowerCase();
      if (k === 'item') { target = { q: m[2] }; items.push(target); last = 'q'; continue; }
      target[k] = m[2];
      last = k;
    } else if (last) target[last] += '\n' + raw;
  }
  for (const o of [fields, ...items]) for (const k in o) if (typeof o[k] === 'string') o[k] = o[k].trim();
  const methods = (fields.methods || '').split('|').map((x) => x.trim()).filter(Boolean);
  if (methods.length < 2) throw new Error('recognize 需要 methods:（至少两个方法，用 | 分隔）');
  if (!items.length) throw new Error('recognize 至少要有一个 item:');
  items.forEach((it, i) => {
    it.answers = (it.answer || '').split('|').map((x) => x.trim()).filter(Boolean);
    if (!it.answers.length) throw new Error(`第 ${i + 1} 题需要 answer:`);
    const bad = it.answers.filter((a) => !methods.includes(a));
    if (bad.length) throw new Error(`第 ${i + 1} 题的 answer「${bad.join('、')}」不在 methods 里`);
  });
  return { fields, methods, items, reason: yes(fields.reason), shuffle: yes(fields.shuffle) };
}

const fmtS = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`);

export function recognize(el, src) {
  const { fields, methods, items, reason, shuffle } = parseRecognize(src);
  const title = fields.title || '认方法';
  const body = widget(el, { title, cls: 'recognize' });
  const done = session.gate(el, title);
  let queue = [];
  let pos = 0;
  let round = 0;
  const results = new Map(); // item → {ok, ms, pick}
  let timer = null;

  function start(list) {
    queue = shuffle ? list.slice().sort(() => Math.random() - 0.5) : list.slice();
    pos = 0;
    round++;
    show();
  }

  function show() {
    clearInterval(timer);
    const it = queue[pos];
    const t0 = Date.now();
    body.innerHTML = `
      <div class="rc-top"><span class="rc-count">第 ${pos + 1} / ${queue.length} 题${round > 1 ? '（重做错题）' : ''}</span><span class="rc-time">0 秒</span></div>
      <div class="rc-stem">${mdToHtml(it.q)}</div>
      <div class="rc-ask">该用什么方法？</div>
      <div class="rc-methods">${methods.map((m, i) => `<button type="button" class="btn rc-m" data-i="${i}">${mdToHtml(m, { inline: true })}</button>`).join('')}</div>
      <div class="rc-reason" hidden><div class="rc-lab">凭题目里的什么特征？一句话就行</div></div>
      <div class="ans-actions rc-actions" hidden><button type="button" class="btn btn-primary rc-submit">提交</button></div>
      <div class="rc-fb" hidden></div>`;
    const timeEl = body.querySelector('.rc-time');
    timer = setInterval(() => { timeEl.textContent = fmtS(Date.now() - t0); }, 1000);
    let pick = null;
    let tb = null;
    if (reason) tb = thinkBox(body.querySelector('.rc-reason'), { placeholder: '比如：三行成比例', rows: 1, q: it.q, owner: el, padHeight: 150 });
    const submit = () => {
      if (pick === null) return;
      if (tb && !tb.value) { tb.focus(); tb.ta.classList.add('is-need'); return; }
      finish(it, methods[pick], tb?.value, tb?.via, Date.now() - t0);
    };
    body.querySelectorAll('.rc-m').forEach((b) => b.addEventListener('click', () => {
      if (body.querySelector('.rc-fb:not([hidden])')) return;
      pick = +b.dataset.i;
      body.querySelectorAll('.rc-m').forEach((x) => x.classList.toggle('is-picked', x === b));
      if (!reason) return submit();
      body.querySelector('.rc-reason').hidden = false;
      body.querySelector('.rc-actions').hidden = false;
      tb.focus();
    }));
    body.querySelector('.rc-submit').addEventListener('click', submit);
    tb?.ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  }

  function finish(it, pick, why, via, ms) {
    clearInterval(timer);
    const ok = it.answers.includes(pick);
    const prev = results.get(it);
    results.set(it, { ok, ms, pick, tries: (prev?.tries || 0) + 1 });
    session.record({ type: 'recognize', title, q: plain(it.q.replace(/\$/g, '')), value: pick, ok, text: why || undefined, via: via || undefined, expected: it.answers.join(' / '), ms, attempts: (prev?.tries || 0) + 1, detail: round > 1 ? '重做' : undefined, el });
    body.querySelectorAll('.rc-m').forEach((b) => {
      const m = methods[+b.dataset.i];
      b.disabled = true;
      if (it.answers.includes(m)) b.classList.add('is-right');
      else if (m === pick) b.classList.add('is-wrong');
    });
    body.querySelector('.rc-actions').hidden = true;
    const fb = body.querySelector('.rc-fb');
    fb.hidden = false;
    fb.className = `rc-fb ${ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = `<div class="q-verdict">${ok ? '✓ 认对了' : '✗ 没认出来'}<span class="muted">　用时 ${fmtS(ms)}</span></div>
      <div><strong>标准方法：</strong>${it.answers.map((a) => mdToHtml(a, { inline: true })).join(' 或 ')}</div>
      ${it.why ? `<div class="rc-why">${mdToHtml(it.why)}</div>` : ''}
      <div class="ans-actions"><button type="button" class="btn btn-primary rc-next">${pos + 1 < queue.length ? '下一题' : '看小结'}</button></div>`;
    fb.querySelector('.rc-next').addEventListener('click', () => { pos++; if (pos < queue.length) show(); else summary(); });
    fb.querySelector('.rc-next').focus({ preventScroll: true });
  }

  function summary() {
    const all = items.map((it) => ({ it, r: results.get(it) }));
    const right = all.filter((x) => x.r?.ok).length;
    const avg = all.reduce((s, x) => s + (x.r?.ms || 0), 0) / all.length;
    const wrong = all.filter((x) => !x.r?.ok);
    body.innerHTML = `
      <div class="rc-sum">
        <div class="rc-big">${right} / ${items.length}</div>
        <div class="muted">认对的题　·　平均每题 ${fmtS(avg)}</div>
      </div>
      ${wrong.length ? `<div class="rc-lab">没认出来的：</div><ol class="rc-wrong">${wrong.map(({ it, r }) => `<li>${mdToHtml(it.q, { inline: true })}<div class="muted">你选「${escapeHtml(r?.pick || '')}」，应该是「${escapeHtml(it.answers.join(' / '))}」</div></li>`).join('')}</ol>` : '<p>全部认对了。</p>'}
      <div class="ans-actions">${wrong.length ? '<button type="button" class="btn btn-primary rc-redo">只重做错的</button>' : ''}<button type="button" class="btn rc-all">全部再来一轮</button></div>`;
    session.record({ type: 'recognize-sum', title, q: title, value: `${right}/${items.length}`, ok: right === items.length, ms: Math.round(avg), detail: `平均 ${fmtS(avg)}，错 ${wrong.length} 题`, el });
    done();
    body.querySelector('.rc-redo')?.addEventListener('click', () => start(wrong.map((x) => x.it)));
    body.querySelector('.rc-all').addEventListener('click', () => start(items));
  }

  start(items);
}
