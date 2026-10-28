// 英语（语法）组件：cloze（填空）、errfind（点出用错的词再改）、parse（句子成分标注，能套从句）、drill（句型操练）。
// 判分都在 entext.js（纯函数）；这里是画面、作答记录（session.record，课堂里自动发给课堂 Claude）、草稿（drafts.js）。
// 答错两次以后才出现「看答案」；不对时只说哪里不对（第几个词、哪一处），不说应该是什么。
import { session } from '../session.js';
import { markDraft } from '../drafts.js';
import { parseFields } from '../parse.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import {
  ROLES, matchText, textHint, parseCloze, tokenizeSentence, findWrong, parseAlts, parseBrackets, judgeSpans, spanText, spansHint, parseRoles, parseDrill, joinWords,
} from '../entext.js';

const inline = (s) => mdToHtml(String(s ?? ''), { inline: true });
const short = (s, n = 120) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const on = (v) => /^(on|true|yes|1|是)$/i.test(String(v ?? '').trim());
const verdict = (ok, text) => `<div class="q-verdict">${ok ? '✓ 对了' : '✗ 再想想'}</div>${text ? `<div>${escapeHtml(text)}</div>` : ''}`;

/* ---------------- cloze：填空 ---------------- */

export function cloze(el, src) {
  const { fields } = parseFields(src);
  const { parts, blanks } = parseCloze(fields.text || '');
  const title = fields.title || '填空';
  const opts = { caseSensitive: on(fields.case) };
  const body = widget(el, { title, cls: 'en-cloze' });
  const width = (alts) => Math.max(4, Math.min(28, Math.max(...alts.map((a) => a.length)) + 2));
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="en-text">${parts.map((p) => (p.text !== undefined ? inline(p.text).replace(/\n/g, '<br>') : `<input class="en-blank" data-i="${p.blank}" size="${width(p.alts)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="第 ${p.blank + 1} 个空">`)).join('')}</div>
    <div class="ans-actions"><button type="button" class="btn btn-primary en-check">检查</button><button type="button" class="btn en-show" hidden>看答案</button></div>
    <div class="q-feedback" hidden></div>`;
  const inputs = [...body.querySelectorAll('.en-blank')];
  const fb = body.querySelector('.q-feedback');
  const done = session.gate(el, title);
  const q = short(`${fields.q || ''} ${parts.map((p) => (p.text !== undefined ? p.text : '___')).join('')}`, 300);
  let attempts = 0, closed = false, lastChecked = '';
  const values = () => inputs.map((x) => x.value.trim());
  markDraft(body, () => { const v = values(); return !closed && v.some(Boolean) && v.join(' | ') !== lastChecked ? v.map((x, i) => `${i + 1}:${x || '（空）'}`).join(' ') : ''; });
  const finish = (ok, revealed = false) => {
    if (closed) return;
    closed = true;
    done();
    inputs.forEach((x) => { x.readOnly = true; });
    session.record({ type: 'cloze', final: true, title, q, ok, attempts, revealed: revealed || undefined, value: values().join(' | '), expected: blanks.map((b) => b[0]).join(' | '), el });
  };
  const check = () => {
    if (closed) return;
    attempts++;
    lastChecked = values().join(' | ');
    const res = inputs.map((x, i) => matchText(x.value, blanks[i], opts));
    res.forEach((r, i) => { inputs[i].classList.toggle('is-right', r.ok); inputs[i].classList.toggle('is-wrong', !r.ok); });
    const ok = res.every((r) => r.ok);
    session.record({ type: 'cloze', liveOnly: true, title, q, value: lastChecked, ok, attempts, detail: ok ? '' : res.map((r, i) => (r.ok ? '' : `第 ${i + 1} 空${textHint(r, { what: '' })}`)).filter(Boolean).join('；'), el });
    fb.hidden = false;
    fb.className = `q-feedback ${ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(ok, ok ? '' : res.map((r, i) => (r.ok ? '' : `第 ${i + 1} 空：${textHint(r, { what: '' }) || '不对'}`)).filter(Boolean).join('；')) + (ok && fields.explain ? mdToHtml(fields.explain) : '');
    if (ok) finish(true);
    else if (attempts >= 2) body.querySelector('.en-show').hidden = false;
  };
  body.querySelector('.en-check').addEventListener('click', check);
  inputs.forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); }));
  body.querySelector('.en-show').addEventListener('click', () => {
    inputs.forEach((x, i) => { x.value = blanks[i][0]; x.classList.remove('is-wrong'); x.classList.add('is-answer'); });
    fb.hidden = false;
    fb.className = 'q-feedback is-reveal';
    fb.innerHTML = `${blanks.some((b) => b.length > 1) ? `<div class="muted">也对：${blanks.map((b, i) => (b.length > 1 ? `第 ${i + 1} 空 ${b.slice(1).map(escapeHtml).join(' / ')}` : '')).filter(Boolean).join('；')}</div>` : ''}${fields.explain ? mdToHtml(fields.explain) : ''}`;
    body.querySelector('.en-show').hidden = true;
    finish(false, true);
  });
}

/* ---------------- errfind：点出用错的词，再改 ---------------- */

export function errfind(el, src) {
  const { fields } = parseFields(src);
  const text = fields.text || '';
  const toks = tokenizeSentence(text);
  const wrongAt = findWrong(text, fields.wrong);
  const fixes = parseAlts(fields.fix || '');
  const title = fields.title || '改错';
  const body = widget(el, { title, cls: 'en-errfind' });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : '<div class="w-q">点出用错的那个词。</div>'}
    <div class="en-words">${toks.map((t) => (t.word ? `<button type="button" class="en-word" data-i="${t.i}">${escapeHtml(t.w)}</button>` : `<span class="en-punct">${escapeHtml(t.w)}</span>`)).join(' ')}</div>
    ${fixes.length ? '<label class="en-fix" hidden><span>改成</span><input class="en-fix-in" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>' : ''}
    <div class="ans-actions"><button type="button" class="btn btn-primary en-check" disabled>提交</button><button type="button" class="btn en-show" hidden>看答案</button></div>
    <div class="q-feedback" hidden></div>`;
  const fb = body.querySelector('.q-feedback');
  const fixIn = body.querySelector('.en-fix-in');
  const done = session.gate(el, title);
  let pick = -1, attempts = 0, closed = false, tried = '';
  const word = (i) => toks[i]?.w || '';
  const now = () => `点了「${word(pick)}」${fixIn ? `，改成「${fixIn.value.trim()}」` : ''}`;
  markDraft(body, () => (!closed && pick >= 0 && now() !== tried ? `${now()}，还没提交` : ''));
  body.querySelectorAll('.en-word').forEach((b) => b.addEventListener('click', () => {
    if (closed) return;
    pick = +b.dataset.i;
    body.querySelectorAll('.en-word').forEach((x) => x.classList.toggle('is-picked', x === b));
    if (fixIn) { body.querySelector('.en-fix').hidden = false; fixIn.focus({ preventScroll: true }); }
    body.querySelector('.en-check').disabled = false;
  }));
  const finish = (ok, revealed = false) => {
    if (closed) return;
    closed = true;
    done();
    session.record({ type: 'errfind', final: true, title, q: short(text, 200), ok, attempts, revealed: revealed || undefined, value: pick >= 0 ? now() : '', expected: `${word(wrongAt)}${fixes.length ? ` → ${fixes[0]}` : ''}`, el });
  };
  const check = () => {
    if (closed || pick < 0) return;
    attempts++;
    tried = now();
    const spot = pick === wrongAt;
    const fixR = spot && fixIn ? matchText(fixIn.value, fixes) : { ok: true };
    const ok = spot && fixR.ok;
    session.record({ type: 'errfind', liveOnly: true, title, q: short(text, 200), value: tried, ok, attempts, detail: spot ? (fixR.ok ? '' : '找对了，改得不对') : '这个词没错', el });
    body.querySelectorAll('.en-word').forEach((x) => { x.classList.toggle('is-wrong', +x.dataset.i === pick && !spot); x.classList.toggle('is-right', +x.dataset.i === pick && spot); });
    fb.hidden = false;
    fb.className = `q-feedback ${ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(ok, ok ? '' : !spot ? `「${word(pick)}」用得没错，错的是别的词` : fixR.empty ? '找对了，写一下改成什么' : '找对了，改得不对') + (ok && fields.explain ? mdToHtml(fields.explain) : '');
    if (ok) finish(true);
    else if (attempts >= 2) body.querySelector('.en-show').hidden = false;
  };
  body.querySelector('.en-check').addEventListener('click', check);
  fixIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  body.querySelector('.en-show').addEventListener('click', () => {
    body.querySelectorAll('.en-word').forEach((x) => x.classList.toggle('is-answer', +x.dataset.i === wrongAt));
    fb.hidden = false;
    fb.className = 'q-feedback is-reveal';
    fb.innerHTML = `<div>错在「${escapeHtml(word(wrongAt))}」${fixes.length ? `，改成「${escapeHtml(fixes.join(' / '))}」` : ''}</div>${fields.explain ? mdToHtml(fields.explain) : ''}`;
    body.querySelector('.en-show').hidden = true;
    finish(false, true);
  });
}

/* ---------------- parse：句子成分标注 ---------------- */

// 一句话按成分画成「[主语 The man [定语从句 who lives next door]] [谓语 gave] …」：括号随着换行走，套几层都看得清
function bracketHtml(tokens, spans, roles, { cls = () => '' } = {}) {
  const color = (k) => `pz-c${Math.max(0, roles.findIndex((r) => r.key === k)) % 6}`;
  const name = (k) => roles.find((r) => r.key === k)?.name || k;
  const out = [];
  tokens.forEach((t, i) => {
    for (const s of spans.filter((x) => x.from === i).sort((a, b) => b.to - a.to)) out.push(`<span class="pz-open ${color(s.role)} ${cls(s)}">[<small>${escapeHtml(name(s.role))}</small></span>`);
    out.push(t.word ? `<button type="button" class="pz-w" data-i="${i}">${escapeHtml(t.w)}</button>` : `<span class="en-punct">${escapeHtml(t.w)}</span>`);
    for (const s of spans.filter((x) => x.to === i).sort((a, b) => a.from - b.from)) out.push(`<span class="pz-close ${color(s.role)} ${cls(s)}">]</span>`);
  });
  return out.join(' ');
}

export function parse(el, src) {
  const { fields } = parseFields(src);
  const ans = parseBrackets(fields.answer || '');
  const roles = parseRoles(fields.roles, [...new Set(ans.spans.map((s) => s.role))]);
  for (const s of ans.spans) if (!roles.some((r) => r.key === s.role)) roles.push({ key: s.role, name: ROLES[s.role] || s.role });
  // mode: show：老师把句子结构直接画在板上（不作答、不拦人）
  if (/^show$/i.test(fields.mode || '')) {
    const b = widget(el, { title: fields.title || '', cls: 'en-parse-show' });
    b.innerHTML = `${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}<div class="en-words pz-ans">${bracketHtml(ans.tokens, ans.spans, roles)}</div>${fields.explain ? mdToHtml(fields.explain) : ''}`;
    return;
  }
  const title = fields.title || '句子成分';
  const body = widget(el, { title, cls: 'en-parse' });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="pz-help muted">点一个词定起点，再点一个词定终点，然后点成分；点板上的「[成分」能去掉那一段。从句里的成分可以再标一层。</div>
    <div class="pz-sent en-words"></div>
    <div class="pz-roles">${roles.map((r, k) => `<button type="button" class="btn btn-sm pz-role pz-c${k % 6}" data-role="${escapeHtml(r.key)}" disabled>${escapeHtml(r.name)}</button>`).join('')}</div>
    <div class="ans-actions"><button type="button" class="btn btn-primary en-check" disabled>检查</button><button type="button" class="btn pz-clear">清空</button><button type="button" class="btn en-show" hidden>看答案</button></div>
    <div class="q-feedback" hidden></div>`;
  const sent = body.querySelector('.pz-sent');
  const fb = body.querySelector('.q-feedback');
  const done = session.gate(el, title);
  let mine = [], sel = null, attempts = 0, closed = false, last = null, tried = '';
  const markup = (spans) => {
    // 学生标的写回括号写法（记录、草稿里给老师看）
    const words = ans.tokens.map((t) => t.w);
    const open = words.map(() => []), close = words.map(() => 0);
    for (const s of [...spans].sort((a, b) => a.from - b.from || b.to - a.to)) { open[s.from].push(s.role); close[s.to]++; }
    return joinWords(words.map((w, i) => `${open[i].map((r) => `[${r} `).join('')}${w}${']'.repeat(close[i])}`));
  };
  markDraft(body, () => (!closed && mine.length && markup(mine) !== tried ? `标了 ${markup(mine)}，还没检查` : ''));
  function draw() {
    const cls = (s) => (last ? (last.right.includes(s) ? 'is-right' : 'is-wrong') : '');
    sent.innerHTML = bracketHtml(ans.tokens, mine, roles, { cls });
    sent.querySelectorAll('.pz-w').forEach((b) => {
      const i = +b.dataset.i;
      b.classList.toggle('is-sel', !!sel && i >= sel.from && i <= (sel.to ?? sel.from));
    });
    body.querySelectorAll('.pz-role').forEach((b) => { b.disabled = closed || !sel || sel.to === undefined; });
    body.querySelector('.en-check').disabled = closed || !mine.length;
  }
  sent.addEventListener('click', (e) => {
    if (closed) return;
    const open = e.target.closest('.pz-open');
    if (open) {
      // 去掉这一段：按它在板上的位置找（同一个词前面可能开了几段）
      const opens = [...sent.querySelectorAll('.pz-open')];
      const k = opens.indexOf(open);
      const order = [...mine].sort((a, b) => a.from - b.from || b.to - a.to);
      mine = mine.filter((s) => s !== order[k]);
      last = null;
      draw();
      return;
    }
    const w = e.target.closest('.pz-w');
    if (!w) return;
    const i = +w.dataset.i;
    if (!sel || sel.to !== undefined) sel = { from: i };
    else sel = { from: Math.min(sel.from, i), to: Math.max(sel.from, i) };
    draw();
  });
  body.querySelector('.pz-roles').addEventListener('click', (e) => {
    const b = e.target.closest('.pz-role');
    if (!b || closed || !sel || sel.to === undefined) return;
    // 头尾的标点不算进去
    let { from, to } = sel;
    while (from < to && !ans.tokens[from].word) from++;
    while (to > from && !ans.tokens[to].word) to--;
    mine = [...mine.filter((s) => !(s.from === from && s.to === to)), { role: b.dataset.role, from, to }];
    sel = null;
    last = null;
    draw();
  });
  body.querySelector('.pz-clear').addEventListener('click', () => { if (closed) return; mine = []; sel = null; last = null; draw(); });
  const finish = (ok, revealed = false) => {
    if (closed) return;
    closed = true;
    done();
    session.record({ type: 'parse', final: true, title, q: short(ans.text, 200), ok, attempts, revealed: revealed || undefined, value: markup(mine), expected: markup(ans.spans), el });
    draw();
  };
  body.querySelector('.en-check').addEventListener('click', () => {
    if (closed || !mine.length) return;
    attempts++;
    tried = markup(mine);
    last = judgeSpans(mine, ans.spans);
    session.record({ type: 'parse', liveOnly: true, title, q: short(ans.text, 200), value: tried, ok: last.ok, attempts, detail: spansHint(last, roles), el });
    fb.hidden = false;
    fb.className = `q-feedback ${last.ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(last.ok, last.ok ? '' : spansHint(last, roles)) + (last.ok && fields.explain ? mdToHtml(fields.explain) : '');
    draw();
    if (last.ok) finish(true);
    else if (attempts >= 2) body.querySelector('.en-show').hidden = false;
  });
  body.querySelector('.en-show').addEventListener('click', () => {
    fb.hidden = false;
    fb.className = 'q-feedback is-reveal';
    fb.innerHTML = `<div class="en-words pz-ans">${bracketHtml(ans.tokens, ans.spans, roles)}</div>${fields.explain ? mdToHtml(fields.explain) : ''}`;
    body.querySelector('.en-show').hidden = true;
    finish(false, true);
  });
  draw();
}

/* ---------------- drill：句型操练，一题一题做 ---------------- */

export function drill(el, src) {
  // 题目行（- 原句 => 答案）先挑出来：不然会被当成上一个字段的续行
  const itemRe = /^\s*[-*]\s+.*(?:=>|⇒|→)/;
  const srcLines = String(src).split('\n');
  const { fields } = parseFields(srcLines.filter((l) => !itemRe.test(l)).join('\n'));
  const all = parseDrill(srcLines.filter((l) => itemRe.test(l)));
  const count = Math.max(1, Math.min(all.length, Number(fields.count) || all.length));
  // 打乱顺序（shuffle: off 照原样）
  const items = (/^off$/i.test(fields.shuffle || '') ? all : [...all].sort(() => Math.random() - 0.5)).slice(0, count);
  const title = fields.title || '操练';
  const opts = { caseSensitive: on(fields.case), sentence: true };
  const body = widget(el, { title, cls: 'en-drill' });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="dr-n muted"></div>
    <div class="dr-q"></div>
    <textarea class="dr-in" rows="2" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="写答案"></textarea>
    <div class="ans-actions"><button type="button" class="btn btn-primary en-check">检查</button><button type="button" class="btn en-show" hidden>看答案</button><button type="button" class="btn dr-next" hidden>下一题</button></div>
    <div class="q-feedback" hidden></div>`;
  const fb = body.querySelector('.q-feedback');
  const input = body.querySelector('.dr-in');
  const done = session.gate(el, title);
  let k = 0, attempts = 0, settled = false, firstTry = 0, lastChecked = '';
  markDraft(body, () => { const v = input.value.trim(); return k < items.length && !settled && v && v !== lastChecked ? `第 ${k + 1} 题写着：${short(v, 200)}` : ''; });
  function show() {
    const it = items[k];
    body.querySelector('.dr-n').textContent = `第 ${k + 1} / ${items.length} 题`;
    body.querySelector('.dr-q').innerHTML = mdToHtml(it.q);
    input.value = '';
    input.readOnly = false;
    input.classList.remove('is-right', 'is-wrong');
    attempts = 0;
    settled = false;
    lastChecked = '';
    fb.hidden = true;
    body.querySelector('.en-check').hidden = false;
    body.querySelector('.en-show').hidden = true;
    body.querySelector('.dr-next').hidden = true;
  }
  const settle = (ok, revealed = false) => {
    settled = true;
    input.readOnly = true;
    if (ok && attempts === 1) firstTry++;
    session.record({ type: 'drill', final: true, title, q: short(items[k].q, 200), ok, attempts, revealed: revealed || undefined, value: input.value.trim(), expected: items[k].alts[0], el });
    body.querySelector('.en-check').hidden = true;
    body.querySelector('.en-show').hidden = true;
    const lastOne = k === items.length - 1;
    body.querySelector('.dr-next').hidden = lastOne;
    if (lastOne) {
      done();
      fb.insertAdjacentHTML('beforeend', `<div class="dr-sum">做完了：${items.length} 题，一次就对 ${firstTry} 题。</div>`);
    }
  };
  const check = () => {
    if (settled) return;
    attempts++;
    lastChecked = input.value.trim();
    const r = matchText(input.value, items[k].alts, opts);
    input.classList.toggle('is-right', r.ok);
    input.classList.toggle('is-wrong', !r.ok);
    session.record({ type: 'drill', liveOnly: true, title, q: short(items[k].q, 200), value: lastChecked, ok: r.ok, attempts, detail: r.ok ? '' : textHint(r), el });
    fb.hidden = false;
    fb.className = `q-feedback ${r.ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(r.ok, r.ok ? '' : textHint(r)) + (r.ok && items[k].alts.length > 1 ? `<div class="muted">也可以：${items[k].alts.filter((a) => matchText(a, [input.value], opts).ok === false).map(escapeHtml).join(' / ')}</div>` : '');
    if (r.ok) settle(true);
    else if (attempts >= 2) body.querySelector('.en-show').hidden = false;
  };
  body.querySelector('.en-check').addEventListener('click', check);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(); } });
  body.querySelector('.en-show').addEventListener('click', () => {
    fb.hidden = false;
    fb.className = 'q-feedback is-reveal';
    fb.innerHTML = `<div>答案：${items[k].alts.map(escapeHtml).join(' / ')}</div>${fields.explain ? mdToHtml(fields.explain) : ''}`;
    settle(false, true);
  });
  body.querySelector('.dr-next').addEventListener('click', () => { if (k < items.length - 1) { k++; show(); } });
  show();
}
