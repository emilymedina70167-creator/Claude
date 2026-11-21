// 英语（语法）组件：cloze（填空）、errfind（点出用错的词再改）、parse（句子成分标注，能套从句）、drill（句型操练）。
// 判分都在 entext.js（纯函数）；这里是画面、作答记录（session.record，课堂里自动发给课堂 Claude）、草稿（drafts.js）。
// 答错两次以后才出现「看答案」；不对时只说哪里不对（第几个词、哪一处），不说应该是什么。
import { session } from '../session.js';
import { markDraft } from '../drafts.js';
import { parseFields } from '../parse.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import {
  ROLES, matchText, textHint, parseCloze, tokenizeSentence, findWrong, parseAlts, parseBrackets, judgeSpans, spanText, spansHint, parseRoles, parseDrill, joinWords,
  parseAnswer, diagnose, parseDecoys, parseSteps, parseChunk, judgeChunks, chunkHint, chunksOf, parseLink, judgeLinks, linkHint, regradePrompt, parseRegrade,
  parsePoints, judgeTranslation, translationHint, roleName, joinsOf, judgeJoins, joinTarget,
} from '../entext.js';
import { getAI } from '../ai.js';
import { bracketHtml, spanPicker, wordPicker } from './enpick.js';
import { layersView, clauseDepth } from './enlayers.js';

// 复核用的模型：和课堂讲课一样只用 Opus 5.5（课堂里不许别的模型「讲课」），回来的不是它就当没复核
const REGRADE_MODEL = 'claude-opus-5-5';
async function regrade(args) {
  try {
    const ai = await getAI();
    if (!ai?.call || ai.legacy) return null;
    const res = await ai.call([{ role: 'user', content: regradePrompt(args) }], { model: REGRADE_MODEL, effort: 'low', cache: false });
    if (res?.modelApplied && res.modelApplied !== REGRADE_MODEL) return null;
    return parseRegrade(res?.text);
  } catch { return null; }
}

// errfind 的「删掉」（多了一个词的错：which I bought it 里的 it）：fix: 删掉；学生点「删掉这个词」或者写「删」都算
const DEL = /^[（(]?\s*(删掉|删去|删除|删|去掉|delete|del|-|—)\s*[)）]?$/i;
const delNorm = (s) => (DEL.test(String(s ?? '').trim()) ? '（删掉）' : s);

const inline = (s) => mdToHtml(String(s ?? ''), { inline: true });
const short = (s, n = 120) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const on = (v) => /^(on|true|yes|1|是)$/i.test(String(v ?? '').trim());
const verdict = (ok, text) => `<div class="q-verdict">${ok ? '✓ 对了' : '✗ 再想想'}</div>${text ? `<div>${escapeHtml(text)}</div>` : ''}`;

/* ---------------- cloze：填空 ---------------- */

export function cloze(el, src) {
  const { fields } = parseFields(src);
  const { parts, blanks, specs } = parseCloze(fields.text || '');
  const title = fields.title || '填空';
  const opts = { caseSensitive: on(fields.case) };
  const body = widget(el, { title, cls: 'en-cloze' });
  const width = (alts) => Math.max(4, Math.min(28, Math.max(...alts.map((a) => a.length)) + 2));
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="en-text">${parts.map((p) => (p.text !== undefined ? inline(p.text).replace(/\n/g, '<br>')
    // 选择式的空（{{[that|*which]}}）：下拉选；打字的空：输入框
    : p.choices ? `<select class="en-blank en-choice" data-i="${p.blank}" aria-label="第 ${p.blank + 1} 个空"><option value="">选…</option>${p.choices.map((c) => `<option value="${escapeHtml(c.text)}">${escapeHtml(c.text)}</option>`).join('')}</select>`
      : `<input class="en-blank" data-i="${p.blank}" size="${width(p.alts)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="第 ${p.blank + 1} 个空">`)).join('')}</div>
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
    inputs.forEach((x) => { x.readOnly = true; if (x.tagName === 'SELECT') x.disabled = true; });
    session.record({ type: 'cloze', final: true, title, q, ok, attempts, revealed: revealed || undefined, value: values().join(' | '), expected: blanks.map((b) => b[0]).join(' | '), el });
  };
  const check = () => {
    if (closed) return;
    attempts++;
    lastChecked = values().join(' | ');
    const res = inputs.map((x, i) => matchText(x.value, blanks[i], opts));
    // 常见错答：学生看到针对的那句提示，记录里写给老师「页面看出来」
    const diags = inputs.map((x, i) => (res[i].ok ? null : diagnose(x.value, specs[i].wrongs, opts)));
    res.forEach((r, i) => { inputs[i].classList.toggle('is-right', r.ok); inputs[i].classList.toggle('is-wrong', !r.ok); });
    const ok = res.every((r) => r.ok);
    const why = (r, i) => (diags[i]?.why ? diags[i].why : specs[i].choices ? (r.empty ? '还没选' : '选得不对') : textHint(r, { what: '' }) || '不对');
    const misread = diags.map((d, i) => (d ? `第 ${i + 1} 空写成「${d.text}」${d.why ? `：${d.why}` : '（常见错答）'}` : '')).filter(Boolean).join('；');
    session.record({ type: 'cloze', liveOnly: true, title, q, value: lastChecked, ok, attempts, detail: ok ? '' : res.map((r, i) => (r.ok ? '' : `第 ${i + 1} 空${specs[i].choices || diags[i] ? `：${why(r, i)}` : textHint(r, { what: '' })}`)).filter(Boolean).join('；'), misread: misread || undefined, el });
    fb.hidden = false;
    fb.className = `q-feedback ${ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(ok, ok ? '' : res.map((r, i) => (r.ok ? '' : `第 ${i + 1} 空：${why(r, i)}`)).filter(Boolean).join('；')) + (ok && fields.explain ? mdToHtml(fields.explain) : '');
    if (ok) finish(true);
    else if (attempts >= 2) body.querySelector('.en-show').hidden = false;
  };
  body.querySelector('.en-check').addEventListener('click', check);
  inputs.forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter' && x.tagName !== 'SELECT') check(); }));
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
  // fix: 对的改法 | !常见的错改法=提示；decoys: 常见的点错的词=为什么它没错（第 2 批：错法诊断）
  const { alts: fixes0, wrongs: fixWrongs } = parseAnswer(fields.fix || '');
  const fixes = fixes0.map(delNorm);
  const canDelete = fixes.includes('（删掉）');
  const decoys = parseDecoys(text, fields.decoys);
  const title = fields.title || '改错';
  const body = widget(el, { title, cls: 'en-errfind' });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : '<div class="w-q">点出用错的那个词。</div>'}
    <div class="en-pick"></div>
    ${fixes.length ? `<label class="en-fix" hidden><span>改成</span><input class="en-fix-in" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${canDelete ? '改成什么；多了就写「删」' : ''}"><button type="button" class="btn btn-sm en-del">删掉这个词</button></label>` : ''}
    <div class="ans-actions"><button type="button" class="btn btn-primary en-check" disabled>提交</button><button type="button" class="btn en-show" hidden>看答案</button></div>
    <div class="q-feedback" hidden></div>`;
  const fb = body.querySelector('.q-feedback');
  const fixIn = body.querySelector('.en-fix-in');
  const done = session.gate(el, title);
  let pick = -1, attempts = 0, closed = false, tried = '';
  const word = (i) => toks[i]?.w || '';
  const now = () => `点了「${word(pick)}」${fixIn ? `，改成「${fixIn.value.trim()}」` : ''}`;
  markDraft(body, () => (!closed && pick >= 0 && now() !== tried ? `${now()}，还没提交` : ''));
  // 点词（enpick.js，检验里的 errfind 也用它）：换成一排词放回原来的位置
  const holder = body.querySelector('.en-pick');
  const words = wordPicker(holder, toks, {
    onPick: (i) => {
      if (closed) return;
      pick = i;
      if (fixIn) { body.querySelector('.en-fix').hidden = false; fixIn.focus({ preventScroll: true }); }
      body.querySelector('.en-check').disabled = false;
    },
  });
  holder.replaceWith(words.el);
  const finish = (ok, revealed = false) => {
    if (closed) return;
    closed = true;
    done();
    words.lock();
    session.record({ type: 'errfind', final: true, title, q: short(text, 200), ok, attempts, revealed: revealed || undefined, value: pick >= 0 ? now() : '', expected: `${word(wrongAt)}${fixes.length ? ` → ${fixes[0]}` : ''}`, el });
  };
  const check = () => {
    if (closed || pick < 0) return;
    attempts++;
    tried = now();
    const spot = pick === wrongAt;
    const fixR = spot && fixIn ? matchText(delNorm(fixIn.value), fixes) : { ok: true };
    const ok = spot && fixR.ok;
    const decoy = spot ? null : decoys.find((d) => d.i === pick);
    const badFix = spot && !fixR.ok && fixIn ? diagnose(fixIn.value, fixWrongs) : null;
    const misread = decoy ? `点了常见的错处「${decoy.w}」：${decoy.why}` : badFix ? `改成了常见的错法「${badFix.text}」${badFix.why ? `：${badFix.why}` : ''}` : '';
    session.record({ type: 'errfind', liveOnly: true, title, q: short(text, 200), value: tried, ok, attempts, detail: spot ? (fixR.ok ? '' : '找对了，改得不对') : '这个词没错', misread: misread || undefined, el });
    words.toggle('is-wrong', (i) => i === pick && !spot);
    words.toggle('is-right', (i) => i === pick && spot);
    fb.hidden = false;
    fb.className = `q-feedback ${ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(ok, ok ? '' : !spot ? `「${word(pick)}」用得没错${decoy ? `：${decoy.why}` : '，错的是别的词'}` : fixR.empty ? '找对了，写一下改成什么' : `找对了，改得不对${badFix?.why ? `：${badFix.why}` : ''}`) + (ok && fields.explain ? mdToHtml(fields.explain) : '');
    if (ok) finish(true);
    else if (attempts >= 2) body.querySelector('.en-show').hidden = false;
  };
  body.querySelector('.en-check').addEventListener('click', check);
  fixIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  body.querySelector('.en-del')?.addEventListener('click', () => { if (!closed && fixIn) { fixIn.value = '（删掉）'; fixIn.focus({ preventScroll: true }); } });
  body.querySelector('.en-show').addEventListener('click', () => {
    words.toggle('is-answer', (i) => i === wrongAt);
    fb.hidden = false;
    fb.className = 'q-feedback is-reveal';
    fb.innerHTML = `<div>错在「${escapeHtml(word(wrongAt))}」${fixes.length ? `，改成「${escapeHtml(fixes.join(' / '))}」` : ''}</div>${fields.explain ? mdToHtml(fields.explain) : ''}`;
    body.querySelector('.en-show').hidden = true;
    finish(false, true);
  });
}

/* ---------------- parse：句子成分标注 ---------------- */

// 分裂结构（ask: join）：成分都清楚了以后，让学生点出本来连着、被隔开的两段。host 里画层次图（先不画弧），连对一对画一条
// step：前面还有标成分的几步时，这一步是第几步（记录里写「第 N 步」，另算一道题）；结构直接给出来的只有这一步（0）
function joinStage(host, { ans, roles, title, el, onDone, step = 0 }) {
  const tagOf = step ? `第 ${step} 步：分裂结构` : '分裂结构';
  const joins = joinsOf(ans.spans);
  const box = document.createElement('div');
  box.className = 'pz-join';
  box.innerHTML = `<div class="pz-join-q">这句话里有 ${joins.length} 处被隔开的结构：先点一段，再点和它本来连着的那一段。</div><div class="pz-join-ly"></div><div class="pz-join-fb" aria-live="polite"></div>`;
  host.appendChild(box);
  const fb = box.querySelector('.pz-join-fb');
  const found = new Set();
  let first = null, attempts = 0, closed = false;
  const wrongPairs = new Set();
  const say = (i) => `${roleName(ans.spans[i].role)}「${short(spanText(ans.tokens, ans.spans[i]), 40)}」`;
  const finish = (ok, revealed = false) => {
    closed = true;
    view.showArcs(new Set(joins.map((j) => j.id))); view.choose([]);
    if (revealed) session.record({ type: 'parse', final: true, title, q: short(ans.text, 200), detail: tagOf, ok: false, attempts, revealed: true, expected: joins.map((j) => j.parts.map(say).join(' — ')).join('；'), el });
    onDone(ok);
  };
  const view = layersView(box.querySelector('.pz-join-ly'), {
    tokens: ans.tokens, spans: ans.spans, roles, arcsFor: found,
    onPick(picked, token) {
      if (closed) return;
      // 点从句里的词就是点那个从句（joinTarget）；主干上没标的词不选
      const i = joinTarget(ans.spans, picked, token);
      if (i < 0) return;
      if (first === null || first === i) { first = first === i ? null : i; view.choose(first === null ? [] : [first]); return; }
      const pair = [first, i];
      first = null;
      // 已经连上的那一对再连一次：说一句，不算新的一次
      if (joins.some((j) => found.has(j.id) && judgeJoins([pair], [j]).ok)) {
        view.choose([]); fb.className = 'pz-join-fb is-ok'; fb.textContent = `这一对已经连上了${found.size < joins.length ? `，还有 ${joins.length - found.size} 处` : ''}。`;
        return;
      }
      const hit = joins.find((j) => !found.has(j.id) && judgeJoins([pair], [j]).ok);
      // 同一对连错的再连一次：不算新的一次（两段的先后不论）
      const sig = [...pair].sort((x, y) => x - y).join('-');
      if (!hit && wrongPairs.has(sig)) { view.choose([]); return; }
      if (!hit) wrongPairs.add(sig);
      attempts++;
      session.record({ type: 'parse', liveOnly: true, title, q: short(ans.text, 200), detail: tagOf, value: pair.map(say).join(' — '), ok: !!hit, attempts, el });
      view.choose([]);
      if (hit) {
        found.add(hit.id); view.showArcs(found);
        fb.className = 'pz-join-fb is-ok';
        fb.textContent = found.size === joins.length ? '✓ 对：这两段本来是连着的，中间被别的成分隔开了。' : `✓ 对了一处，还有 ${joins.length - found.size} 处。`;
        if (found.size === joins.length) { session.record({ type: 'parse', final: true, title, q: short(ans.text, 200), detail: tagOf, ok: true, attempts, value: joins.map((j) => j.parts.map(say).join(' — ')).join('；'), el }); finish(true); }
        return;
      }
      fb.className = 'pz-join-fb is-bad';
      fb.innerHTML = `✗ 这两段不是一家。${attempts >= 3 ? ' <button type="button" class="link-btn pz-join-show">看答案</button>' : ''}`;
      fb.querySelector('.pz-join-show')?.addEventListener('click', () => { fb.className = 'pz-join-fb'; fb.textContent = '连起来的就是本来挨着的两段。'; finish(false, true); });
    },
  });
}

// 层次图的位置：不用层次图的题什么都不画；用的题，有成分可画时才露出来
function layerSlot(host, ans, roles, layered) {
  let view = null;
  return {
    show(spans) {
      if (!layered || !host || !spans.length) return;
      host.hidden = false;
      if (view) view.update(spans); else view = layersView(host, { tokens: ans.tokens, spans, roles });
    },
  };
}

export function parse(el, src) {
  const { fields } = parseFields(src);
  const ans = parseBrackets(fields.answer || '');
  const roles = parseRoles(fields.roles, [...new Set(ans.spans.map((s) => s.role))]);
  for (const s of ans.spans) if (!roles.some((r) => r.key === s.role)) roles.push({ key: s.role, name: roleName(s.role) });
  // 层次图（视觉第 5 批）：view: layers 明着要；不写时，从句套了两层以上、有分裂结构（~n）的才用。view: line 照旧一行
  const layered = /^layers$/i.test(fields.view || '') || (!/^line$/i.test(fields.view || '') && (clauseDepth(ans.spans) >= 2 || ans.spans.some((s) => s.join)));
  fields.layered = layered;
  // ask: join：让学生把分裂结构被隔开的两段连起来（answer 里要有 ~n）
  const askJoin = /^join$/i.test(fields.ask || '');
  if (askJoin && !ans.spans.some((s) => s.join)) throw new Error('ask: join 要 answer 里有分裂结构的记号：[S~1 The rumor] … [AppC~1 that …]');
  // mode: show：老师把句子结构直接画在板上（不作答、不拦人）
  if (/^show$/i.test(fields.mode || '')) {
    const b = widget(el, { title: fields.title || '', cls: 'en-parse-show' });
    b.innerHTML = `${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}${layered ? '<div class="pz-layers"></div>' : `<div class="en-words pz-ans">${bracketHtml(ans.tokens, ans.spans, roles)}</div>`}${fields.explain ? mdToHtml(fields.explain) : ''}`;
    if (askJoin) {
      // 结构直接给出来，只问「哪两段本来连着」
      b.querySelector('.pz-layers')?.remove();
      const gate = session.gate(el, fields.title || '分裂结构');
      joinStage(b, { ans, roles, title: fields.title || '分裂结构', el, onDone: () => gate() });
    } else if (layered) layersView(b.querySelector('.pz-layers'), { tokens: ans.tokens, spans: ans.spans, roles });
    return;
  }
  // steps: V | S O | RC：一层层拆（第 4 批）。每一步只标这几种成分，对了固定下来再下一步
  const groups = fields.steps ? parseSteps(fields.steps, ans.spans) : null;
  if (groups) return parseByStep(el, fields, ans, roles, groups);
  const title = fields.title || '句子成分';
  const body = widget(el, { title, cls: 'en-parse' });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="pz-slot"></div>
    <div class="ans-actions"><button type="button" class="btn btn-primary en-check" disabled>检查</button><button type="button" class="btn pz-clear">清空</button><button type="button" class="btn en-show" hidden>看答案</button></div>
    <div class="q-feedback" hidden></div>
    <div class="pz-layers" hidden></div>`;
  const fb = body.querySelector('.q-feedback');
  const done = session.gate(el, title);
  let attempts = 0, closed = false, last = null, tried = '';
  // 层次图：标对的那几段先长出来，做完（或者看了答案）是完整的
  const layers = layerSlot(body.querySelector('.pz-layers'), ans, roles, layered);
  // 点词标成分（enpick.js，检验里的 parse 也用它）：说明、句子、成分按钮放回原来的位置
  const slot = body.querySelector('.pz-slot');
  const pick = spanPicker(slot, { tokens: ans.tokens, roles, onChange: () => { last = null; sync(); } });
  slot.replaceWith(...pick.el.childNodes);
  const sync = () => { body.querySelector('.en-check').disabled = closed || pick.empty(); };
  const mine = () => pick.raw();
  const markup = (spans) => {
    // 学生标的写回括号写法（记录、草稿里给老师看）
    const words = ans.tokens.map((t) => t.w);
    const open = words.map(() => []), close = words.map(() => 0);
    for (const s of [...spans].sort((a, b) => a.from - b.from || b.to - a.to)) { open[s.from].push(s.role); close[s.to]++; }
    return joinWords(words.map((w, i) => `${open[i].map((r) => `[${r} `).join('')}${w}${']'.repeat(close[i])}`));
  };
  markDraft(body, () => (!closed && mine().length && markup(mine()) !== tried ? `标了 ${markup(mine())}，还没检查` : ''));
  body.querySelector('.pz-clear').addEventListener('click', () => { if (!closed) pick.clear(); });
  const finish = (ok, revealed = false) => {
    if (closed) return;
    closed = true;
    if (!(askJoin && ok)) done(); // 后面还有连分裂结构的那一步：连完才算做完
    session.record({ type: 'parse', final: true, title, q: short(ans.text, 200), ok, attempts, revealed: revealed || undefined, value: markup(mine()), expected: markup(ans.spans), more: (askJoin && ok) || undefined, el });
    pick.lock();
    sync();
    // 连分裂结构的那一步用自己的层次图：上面那张（答错时长出来的半张）收掉，不留两张
    if (askJoin && ok) { body.querySelector('.pz-layers')?.remove(); joinStage(body, { ans, roles, title, el, onDone: () => done(), step: 2 }); }
    else layers.show(ans.spans);
  };
  body.querySelector('.en-check').addEventListener('click', () => {
    if (closed || pick.empty()) return;
    attempts++;
    tried = markup(mine());
    last = judgeSpans(mine(), ans.spans);
    session.record({ type: 'parse', liveOnly: true, title, q: short(ans.text, 200), value: tried, ok: last.ok, attempts, detail: spansHint(last, roles), el });
    fb.hidden = false;
    fb.className = `q-feedback ${last.ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(last.ok, last.ok ? '' : spansHint(last, roles)) + (last.ok && fields.explain ? mdToHtml(fields.explain) : '');
    const res = last;
    pick.mark((s) => (res.right.includes(s) ? 'is-right' : 'is-wrong'));
    if (!last.ok) layers.show(res.right);
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
  sync();
}

// 分步拆句：第 k 步只标 groups[k] 里的成分；前面几步的答案固定在句子上（不能删）。哪一步错了停在哪一步
function parseByStep(el, fields, ans, roles, groups) {
  const title = fields.title || '一层层拆';
  const nameOf = (k) => roles.find((r) => r.key === k)?.name || ROLES[k] || k;
  const body = widget(el, { title, cls: 'en-parse en-parse-steps' });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="pz-step"></div>
    <div class="pz-help muted">点一个词定起点，再点一个词定终点，然后点成分；点板上的「[成分」能去掉你标的那一段。</div>
    <div class="pz-sent en-words"></div>
    <div class="pz-roles"></div>
    <div class="ans-actions"><button type="button" class="btn btn-primary en-check" disabled>检查这一步</button><button type="button" class="btn pz-clear">清空这一步</button><button type="button" class="btn en-show" hidden>看这一步的答案</button></div>
    <div class="q-feedback" hidden></div>
    <div class="pz-layers" hidden></div>`;
  const layers = layerSlot(body.querySelector('.pz-layers'), ans, roles, fields.layered);
  const sent = body.querySelector('.pz-sent');
  const fb = body.querySelector('.q-feedback');
  const done = session.gate(el, title);
  let k = 0, mine = [], fixed = [], sel = null, attempts = 0, last = null, closed = false, tried = '';
  const target = () => ans.spans.filter((sp) => groups[k].includes(sp.role));
  const stepName = (i) => groups[i].map(nameOf).join('、');
  const markup = (spans) => {
    const words = ans.tokens.map((t) => t.w);
    const open = words.map(() => []), close = words.map(() => 0);
    for (const sp of [...spans].sort((a, b) => a.from - b.from || b.to - a.to)) { open[sp.from].push(sp.role); close[sp.to]++; }
    return joinWords(words.map((w, i) => `${open[i].map((r) => `[${r} `).join('')}${w}${']'.repeat(close[i])}`));
  };
  markDraft(body, () => (!closed && mine.length && markup(mine) !== tried ? `第 ${k + 1} 步标了 ${markup(mine)}，还没检查` : ''));
  function paintStep() {
    body.querySelector('.pz-step').innerHTML = `<b>第 ${k + 1} / ${groups.length} 步</b>：标出${escapeHtml(stepName(k))}${k ? '<span class="muted">（前面几步已经固定在句子上）</span>' : ''}`;
    body.querySelector('.pz-roles').innerHTML = groups[k].map((r) => `<button type="button" class="btn btn-sm pz-role pz-c${Math.max(0, roles.findIndex((x) => x.key === r)) % 6}" data-role="${escapeHtml(r)}" disabled>${escapeHtml(nameOf(r))}</button>`).join('');
  }
  function draw() {
    const all = [...fixed.map((sp) => ({ ...sp, fixed: true })), ...mine];
    const cls = (sp) => (sp.fixed ? 'is-fixed' : last ? (last.right.includes(sp) ? 'is-right' : 'is-wrong') : '');
    sent.innerHTML = closed ? bracketHtml(ans.tokens, ans.spans, roles) : bracketHtml(ans.tokens, all, roles, { cls });
    sent.querySelectorAll('.pz-w').forEach((b) => { const i = +b.dataset.i; b.classList.toggle('is-sel', !!sel && i >= sel.from && i <= (sel.to ?? sel.from)); });
    body.querySelectorAll('.pz-role').forEach((b) => { b.disabled = closed || !sel || sel.to === undefined; });
    body.querySelector('.en-check').disabled = closed || !mine.length;
  }
  sent.addEventListener('click', (e) => {
    if (closed) return;
    const open = e.target.closest('.pz-open');
    if (open) {
      if (open.classList.contains('is-fixed')) return;
      const all = [...fixed.map((sp) => ({ ...sp, fixed: true })), ...mine].sort((a, b) => a.from - b.from || b.to - a.to);
      const hit = all[[...sent.querySelectorAll('.pz-open')].indexOf(open)];
      mine = mine.filter((sp) => !(sp.from === hit?.from && sp.to === hit?.to && sp.role === hit?.role));
      last = null; draw(); return;
    }
    const w = e.target.closest('.pz-w');
    if (!w) return;
    const i = +w.dataset.i;
    sel = !sel || sel.to !== undefined ? { from: i } : { from: Math.min(sel.from, i), to: Math.max(sel.from, i) };
    draw();
  });
  body.querySelector('.pz-roles').addEventListener('click', (e) => {
    const b = e.target.closest('.pz-role');
    if (!b || closed || !sel || sel.to === undefined) return;
    let { from, to } = sel;
    while (from < to && !ans.tokens[from].word) from++;
    while (to > from && !ans.tokens[to].word) to--;
    mine = [...mine.filter((sp) => !(sp.from === from && sp.to === to)), { role: b.dataset.role, from, to }];
    sel = null; last = null; draw();
  });
  body.querySelector('.pz-clear').addEventListener('click', () => { if (closed) return; mine = []; sel = null; last = null; draw(); });
  // 这一步结束（对了，或者看了答案）：答案固定在句子上，进下一步；最后一步完了整道题结束
  function nextStep(ok, revealed = false) {
    session.record({ type: 'parse', final: true, title, q: short(ans.text, 200), detail: `第 ${k + 1} 步（${stepName(k)}）`, ok, attempts, revealed: revealed || undefined, value: markup(mine), expected: markup(target()), el });
    fixed = [...fixed, ...target()];
    layers.show(k < groups.length - 1 ? fixed : ans.spans);
    mine = []; sel = null; last = null; attempts = 0; tried = '';
    body.querySelector('.en-show').hidden = true;
    if (k < groups.length - 1) { k++; paintStep(); draw(); return; }
    closed = true;
    body.querySelector('.pz-step').innerHTML = '<b>拆完了</b>';
    body.querySelector('.pz-roles').innerHTML = '';
    draw();
    if (fields.explain) { fb.hidden = false; fb.className = 'q-feedback is-ok'; fb.innerHTML = mdToHtml(fields.explain); }
    // ask: join：成分都拆完了，再连分裂结构（是最后一步）
    if (/^join$/i.test(fields.ask || '')) { body.querySelector('.pz-layers')?.remove(); joinStage(body, { ans, roles, title, el, onDone: () => done(), step: groups.length + 1 }); }
    else done();
  }
  body.querySelector('.en-check').addEventListener('click', () => {
    if (closed || !mine.length) return;
    attempts++;
    tried = markup(mine);
    last = judgeSpans(mine, target());
    const hint = spansHint(last, roles);
    // more：这一步对了、后面还有步（课堂里不为它单独叫老师：学生接着做下一步，跟着下一条一起告诉老师）
    session.record({ type: 'parse', liveOnly: true, title, q: short(ans.text, 200), detail: `第 ${k + 1} 步（${stepName(k)}）`, value: tried, ok: last.ok, attempts, check: last.ok ? undefined : hint, more: (last.ok && k < groups.length - 1) || undefined, el });
    fb.hidden = false;
    fb.className = `q-feedback ${last.ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(last.ok, last.ok ? '' : hint);
    draw();
    if (last.ok) nextStep(true);
    else if (attempts >= 2) body.querySelector('.en-show').hidden = false;
  });
  body.querySelector('.en-show').addEventListener('click', () => {
    fb.hidden = false;
    fb.className = 'q-feedback is-reveal';
    fb.innerHTML = `<div class="muted">第 ${k + 1} 步的答案已经标在句子上了</div>`;
    nextStep(false, true);
  });
  paintStep();
  draw();
}

/* ---------------- chunk：意群断句（长难句、翻译最常练的一步） ---------------- */

export function chunk(el, src) {
  const { fields } = parseFields(src);
  const spec = parseChunk(fields.text || '');
  const title = fields.title || '意群断句';
  const translate = on(fields.translate);
  const body = widget(el, { title, cls: 'en-chunk' });
  const gapSet = new Set(spec.gaps);
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : '<div class="w-q">在该停顿的地方点一下，把句子切成意群。</div>'}
    <div class="ck-sent en-words">${spec.tokens.map((t, i) => `${gapSet.has(i) ? `<button type="button" class="ck-gap" data-g="${i}" aria-label="在 ${escapeHtml(spec.tokens[i - 1]?.w || '')} 和 ${escapeHtml(t.w)} 之间切开" aria-pressed="false"></button>` : ''}<span class="${t.word ? 'ck-w' : 'en-punct'}">${escapeHtml(t.w)}</span>`).join('')}</div>
    <div class="ans-actions"><button type="button" class="btn btn-primary en-check">检查</button><button type="button" class="btn en-show" hidden>看答案</button></div>
    <div class="q-feedback" hidden></div>
    <div class="ck-tr" hidden></div>`;
  const sentEl = body.querySelector('.ck-sent');
  const fb = body.querySelector('.q-feedback');
  const done = session.gate(el, title);
  const cuts = new Set();
  let attempts = 0, closed = false, tried = '';
  const now = () => chunksOf(spec.tokens, [...cuts]).join(' / ');
  markDraft(body, () => (!closed && cuts.size && now() !== tried ? `切成：${short(now(), 300)}，还没检查` : ''));
  const paint = (marks = null) => sentEl.querySelectorAll('.ck-gap').forEach((b) => {
    const g = +b.dataset.g;
    b.classList.toggle('is-cut', cuts.has(g));
    b.setAttribute('aria-pressed', String(cuts.has(g)));
    b.classList.toggle('is-wrong', !!marks && marks.extra.includes(g));
    b.classList.toggle('is-miss', !!marks && marks.missing.includes(g));
  });
  sentEl.addEventListener('click', (e) => {
    const b = e.target.closest('.ck-gap');
    if (!b || closed) return;
    const g = +b.dataset.g;
    if (cuts.has(g)) cuts.delete(g); else cuts.add(g);
    paint();
  });
  function finish(ok, revealed = false) {
    if (closed) return;
    closed = true;
    sentEl.querySelectorAll('.ck-gap').forEach((b) => { b.disabled = true; });
    session.record({ type: 'chunk', final: true, title, q: short(spec.text, 200), ok, attempts, revealed: revealed || undefined, value: now(), expected: chunksOf(spec.tokens, spec.must).join(' / '), el });
    if (!translate) { done(); return; }
    // 译文：每个意群下面写一句（判不了分，交给老师看）
    const tr = body.querySelector('.ck-tr');
    const parts = chunksOf(spec.tokens, [...cuts]);
    tr.hidden = false;
    tr.innerHTML = `<div class="ck-tr-head">按意群写译文（交给老师看，页面不判）</div>${parts.map((p, i) => `<label class="ck-tr-row"><span>${escapeHtml(p)}</span><textarea rows="1" data-i="${i}" aria-label="第 ${i + 1} 个意群的译文"></textarea></label>`).join('')}<div class="ans-actions"><button type="button" class="btn btn-primary ck-tr-ok">交译文</button></div>`;
    const tas = [...tr.querySelectorAll('textarea')];
    let sent = false;
    markDraft(tr, () => (!sent && tas.some((t) => t.value.trim()) ? `译文写着：${short(tas.map((t) => t.value.trim()).join(' / '), 300)}` : ''));
    tr.querySelector('.ck-tr-ok').addEventListener('click', () => {
      if (!tas.some((t) => t.value.trim())) return;
      sent = true;
      session.record({ type: 'chunk', title, q: short(spec.text, 200), detail: '译文', text: parts.map((p, i) => `${p} → ${tas[i].value.trim() || '（空）'}`).join('\n'), ok: null, el });
      tr.querySelector('.ck-tr-ok').disabled = true;
      tr.querySelector('.ck-tr-ok').textContent = '交了';
      done();
    });
  }
  body.querySelector('.en-check').addEventListener('click', () => {
    if (closed) return;
    attempts++;
    tried = now();
    const r = judgeChunks([...cuts], spec);
    const hint = chunkHint(r, spec.tokens);
    session.record({ type: 'chunk', liveOnly: true, title, q: short(spec.text, 200), value: tried, ok: r.ok, attempts, detail: r.ok ? '' : hint, el });
    paint(r.ok ? null : { missing: [], extra: r.extra });
    fb.hidden = false;
    fb.className = `q-feedback ${r.ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(r.ok, r.ok ? '' : hint) + (r.ok && fields.explain ? mdToHtml(fields.explain) : '');
    if (r.ok) finish(true);
    else if (attempts >= 2) body.querySelector('.en-show').hidden = false;
  });
  body.querySelector('.en-show').addEventListener('click', () => {
    cuts.clear();
    spec.must.forEach((g) => cuts.add(g));
    paint();
    sentEl.querySelectorAll('.ck-gap').forEach((b) => b.classList.toggle('is-may', spec.may.includes(+b.dataset.g)));
    fb.hidden = false;
    fb.className = 'q-feedback is-reveal';
    fb.innerHTML = `<div>${escapeHtml(chunksOf(spec.tokens, spec.must).join(' / '))}</div>${spec.may.length ? '<div class="muted">虚线的地方切不切都行</div>' : ''}${fields.explain ? mdToHtml(fields.explain) : ''}`;
    body.querySelector('.en-show').hidden = true;
    finish(false, true);
  });
}

/* ---------------- link：连线（点一个词，再点它连着的那个词）---------------- */

export function link(el, src) {
  const { fields } = parseFields(src);
  const text = fields.text || '';
  const spec = parseLink(text, fields.pairs);
  const title = fields.title || '连线';
  const body = widget(el, { title, cls: 'en-link' });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : '<div class="w-q">先点一个词，再点它连着的那个词。</div>'}
    <div class="lk-wrap"><svg class="lk-svg" aria-hidden="true"><defs><marker id="lk-ar-${escapeHtml(el.dataset.bid || 'x')}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs></svg>
      <div class="lk-sent en-words">${spec.tokens.map((t) => (t.word ? `<button type="button" class="en-word lk-w" data-i="${t.i}">${escapeHtml(t.w)}</button>` : `<span class="en-punct">${escapeHtml(t.w)}</span>`)).join(' ')}</div></div>
    <div class="pz-help muted lk-help">连了 0 / ${spec.pairs.length} 条。点一条线起点的词能把它去掉。</div>
    <div class="ans-actions"><button type="button" class="btn btn-primary en-check" disabled>检查</button><button type="button" class="btn pz-clear">清空</button><button type="button" class="btn en-show" hidden>看答案</button></div>
    <div class="q-feedback" hidden></div>`;
  const wrap = body.querySelector('.lk-wrap');
  const svg = body.querySelector('.lk-svg');
  const fb = body.querySelector('.q-feedback');
  const done = session.gate(el, title);
  const marker = `lk-ar-${el.dataset.bid || 'x'}`;
  let mine = [], from = null, attempts = 0, closed = false, last = null, tried = '';
  const w = (i) => spec.tokens[i]?.w || '';
  const now = (list = mine) => list.map((p) => `${w(p.from)} → ${w(p.to)}`).join('；');
  markDraft(body, () => (!closed && mine.length && now() !== tried ? `连了 ${now()}，还没检查` : ''));
  function draw(show = null) {
    const list = show || mine;
    const box = wrap.getBoundingClientRect();
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    const at = (i) => { const r = wrap.querySelector(`.lk-w[data-i="${i}"]`)?.getBoundingClientRect(); return r ? { x: r.left - box.left + r.width / 2, y: r.top - box.top + 4 } : null; };
    const paths = list.map((p) => {
      const a = at(p.from), b = at(p.to);
      if (!a || !b) return '';
      const lift = 16 + Math.min(40, Math.abs(b.x - a.x) * 0.15);
      const cy = Math.min(a.y, b.y) - lift;
      const cls = last ? (last.right.includes(p) ? 'is-right' : last.wrong.some((x) => x.from === p.from && x.to === p.to) ? 'is-wrong' : '') : show ? 'is-answer' : '';
      return `<path class="lk-line ${cls}" d="M${a.x} ${a.y} Q${(a.x + b.x) / 2} ${cy} ${b.x} ${b.y}" marker-end="url(#${marker})"/>`;
    }).join('');
    svg.querySelectorAll('.lk-line').forEach((x) => x.remove());
    svg.insertAdjacentHTML('beforeend', paths);
    wrap.querySelectorAll('.lk-w').forEach((b) => {
      const i = +b.dataset.i;
      b.classList.toggle('is-picked', from === i);
      b.classList.toggle('is-linked', list.some((p) => p.from === i || p.to === i));
    });
    body.querySelector('.lk-help').firstChild.textContent = `连了 ${mine.length} / ${spec.pairs.length} 条。点一条线起点的词能把它去掉。`;
    body.querySelector('.en-check').disabled = closed || !mine.length;
  }
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.lk-w');
    if (!b || closed) return;
    const i = +b.dataset.i;
    last = null;
    if (from === null) {
      // 点了已经连出去的词：去掉那条线
      if (mine.some((p) => p.from === i)) { mine = mine.filter((p) => p.from !== i); draw(); return; }
      from = i;
    } else if (from === i) from = null;
    else { mine = [...mine.filter((p) => p.from !== from), { from, to: i }]; from = null; }
    draw();
  });
  body.querySelector('.pz-clear').addEventListener('click', () => { if (closed) return; mine = []; from = null; last = null; draw(); });
  const finish = (ok, revealed = false) => {
    if (closed) return;
    closed = true;
    done();
    session.record({ type: 'link', final: true, title, q: short(text, 200), ok, attempts, revealed: revealed || undefined, value: now(), expected: now(spec.pairs), el });
  };
  body.querySelector('.en-check').addEventListener('click', () => {
    if (closed || !mine.length) return;
    attempts++;
    tried = now();
    last = judgeLinks(mine, spec);
    const hint = linkHint(last, spec.tokens);
    const misread = last.wrong.filter((x) => x.why).map((x) => `把「${w(x.from)}」连到了「${w(x.to)}」：${x.why}`).join('；');
    session.record({ type: 'link', liveOnly: true, title, q: short(text, 200), value: tried, ok: last.ok, attempts, detail: hint, misread: misread || undefined, el });
    fb.hidden = false;
    fb.className = `q-feedback ${last.ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(last.ok, hint) + (last.ok && fields.explain ? mdToHtml(fields.explain) : '');
    draw();
    if (last.ok) finish(true);
    else if (attempts >= 2) body.querySelector('.en-show').hidden = false;
  });
  body.querySelector('.en-show').addEventListener('click', () => {
    last = null;
    draw(spec.pairs);
    fb.hidden = false;
    fb.className = 'q-feedback is-reveal';
    fb.innerHTML = `<div>${escapeHtml(now(spec.pairs))}</div>${fields.explain ? mdToHtml(fields.explain) : ''}`;
    body.querySelector('.en-show').hidden = true;
    finish(false, true);
  });
  // 换行、横竖屏：线跟着词走
  try { new ResizeObserver(() => draw(closed && !last ? spec.pairs : null)).observe(wrap); } catch { /* 老浏览器：不跟 */ }
  requestAnimationFrame(() => draw());
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
  let checking = false;
  const check = async () => {
    if (settled || checking) return;
    attempts++;
    lastChecked = input.value.trim();
    let r = matchText(input.value, items[k].alts, opts);
    const d = r.ok ? null : diagnose(input.value, items[k].wrongs, opts);
    // 页面判错、又不是已知的错答：可能只是换了个说法，问一次 Claude（一两千 token）。它说对就算对，证据里记「Claude 复核」
    let review = null;
    if (!r.ok && !d && !r.empty && !r.near) {
      checking = true;
      const btn = body.querySelector('.en-check');
      btn.disabled = true;
      fb.hidden = false;
      fb.className = 'q-feedback';
      fb.innerHTML = '<div class="muted">和标准答案写得不一样，问一下 Claude 是不是也对……</div>';
      review = await regrade({ q: items[k].q, task: fields.q || title, alts: items[k].alts, given: lastChecked });
      checking = false;
      btn.disabled = false;
      if (review?.ok) r = { ok: true };
    }
    input.classList.toggle('is-right', r.ok);
    input.classList.toggle('is-wrong', !r.ok);
    session.record({ type: 'drill', liveOnly: true, title, q: short(items[k].q, 200), value: lastChecked, ok: r.ok, attempts, detail: review ? `Claude 复核：${review.why}` : r.ok ? '' : textHint(r), misread: d ? `写成了常见的错法${d.why ? `：${d.why}` : ''}` : undefined, el });
    fb.hidden = false;
    fb.className = `q-feedback ${r.ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = verdict(r.ok, review?.why ? `${review.ok ? '和标准答案写法不同，' : ''}${review.why}` : r.ok ? '' : d?.why || textHint(r)) + (r.ok && items[k].alts.length > 1 ? `<div class="muted">也可以：${items[k].alts.filter((a) => matchText(a, [input.value], opts).ok === false).map(escapeHtml).join(' / ')}</div>` : '');
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

/* ---------------- translate：翻译，页面按要点判（docs/english-plan.md 第 7 批） ----------------
 * 以前翻译只能用 conjecture 写，页面判不了，课后报告里全是「没判」，掌握、弱点都用不上。现在老师写下这句的要点，
 * 页面查译文里有没有；没译出来的只说是哪几个英文词，不给中文答案。通不通顺照旧由课堂 Claude 看（作答原样发给它）。
 */
export function translate(el, src) {
  const lines = String(src).split('\n');
  // 要点行（- … = …）先挑出来，不然会被当成上一个字段的续行
  const pointRe = /^\s*[-*]\s+.+[=＝]/;
  const { fields } = parseFields(lines.filter((l) => !pointRe.test(l)).join('\n'));
  const text = String(fields.src || fields.text || fields.q || '').trim();
  if (!text) throw new Error('translate 要写 src:（要翻译的英文句子）');
  const spec = parsePoints(lines.filter((l) => pointRe.test(l)), fields.order);
  if (spec.problems.length) throw new Error(spec.problems.join('；'));
  const title = fields.title || '翻译';
  const n = spec.points.length;
  const body = widget(el, { title, cls: 'en-translate' });
  body.innerHTML = `
    ${fields.q && fields.src ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="en-text tr-src">${inline(text)}</div>
    <textarea class="tr-in" rows="3" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(fields.placeholder || '写出完整的中文译文')}" aria-label="写译文"></textarea>
    <div class="ans-actions"><button type="button" class="btn btn-primary en-check">检查</button><button type="button" class="btn en-show" hidden>看参考译文</button></div>
    <div class="q-feedback" hidden></div>`;
  const fb = body.querySelector('.q-feedback');
  const input = body.querySelector('.tr-in');
  const done = session.gate(el, title);
  let attempts = 0, closed = false, tried = '';
  markDraft(body, () => { const v = input.value.trim(); return !closed && v && v !== tried ? `译文写着：${short(v, 300)}` : ''; });
  const ref = fields.answer ? `<div class="tr-ref"><span class="muted">参考译文：</span>${inline(fields.answer)}</div>` : '';
  const settle = (ok, revealed = false) => {
    closed = true;
    input.readOnly = true;
    body.querySelector('.en-check').hidden = true;
    body.querySelector('.en-show').hidden = true;
    session.record({ type: 'translate', final: true, title, q: short(text, 200), ok, attempts, revealed: revealed || undefined, value: input.value.trim(), text: input.value.trim(), expected: fields.answer ? short(fields.answer, 200) : undefined, el });
    done();
  };
  const check = () => {
    if (closed) return;
    const r = judgeTranslation(input.value, spec);
    if (r.empty) { fb.hidden = false; fb.className = 'q-feedback is-bad'; fb.innerHTML = verdict(false, '先写出译文。'); return; }
    attempts++;
    tried = input.value.trim();
    const hint = translationHint(r, n);
    input.classList.toggle('is-right', r.ok);
    input.classList.toggle('is-wrong', !r.ok);
    session.record({ type: 'translate', liveOnly: true, title, q: short(text, 200), value: tried, text: tried, ok: r.ok, attempts, detail: r.ok ? `要点 ${n} / ${n} 都译出来了` : hint, misread: r.misread || undefined, el });
    fb.hidden = false;
    fb.className = `q-feedback ${r.ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = r.ok
      ? `<div class="q-verdict">✓ 要点都译出来了</div><div class="muted">通不通顺、像不像中文，老师会看。</div>${ref}${fields.explain ? mdToHtml(fields.explain) : ''}`
      : verdict(false, hint);
    if (r.ok) settle(true);
    else if (attempts >= 2) body.querySelector('.en-show').hidden = false;
  };
  body.querySelector('.en-check').addEventListener('click', check);
  body.querySelector('.en-show').addEventListener('click', () => {
    fb.hidden = false;
    fb.className = 'q-feedback is-reveal';
    fb.innerHTML = `${ref || '<div class="muted">老师没写参考译文。</div>'}<div class="muted">要点：${spec.points.map((p) => `${escapeHtml(p.label)} → ${escapeHtml(p.alts[0])}`).join('；')}</div>${fields.explain ? mdToHtml(fields.explain) : ''}`;
    settle(false, true);
  });
}
