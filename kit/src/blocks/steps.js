// steps：一步步揭开的例题。每一步揭开前，学生先写下（或选出）下一步要做什么、为什么，
// 然后才看到真实的一步；学生的想法留在原处，和真实步骤并排对照。
// do: true 的步骤不揭开，要学生自己做出来（逐步撤掉脚手架）。
import { compile, isNum, isVec, isMat, valueTeX } from '../expr.js';
import { session } from '../session.js';
import { link } from '../link.js';
import { widget, mdToHtml, escapeHtml, tex2html } from './common.js';
import { answerWidget, plain } from './answer.js';
import { thinkBox } from './thinkbox.js';

const KEY = /^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/;

// 解析：开头是题目字段（id/title/q），每个 step: 开始新的一步
export function parseSteps(src) {
  const fields = {};
  const steps = [];
  let target = fields, last = null;
  for (const raw of String(src).split('\n')) {
    const m = raw.match(KEY);
    if (m) {
      const k = m[1].toLowerCase();
      if (k === 'step') { target = { title: m[2].trim() }; steps.push(target); last = null; continue; }
      target[k] = m[2];
      last = k;
    } else if (last) target[last] += '\n' + raw;
  }
  const trim = (o) => { for (const k in o) if (typeof o[k] === 'string') o[k] = o[k].trim(); };
  trim(fields);
  steps.forEach(trim);
  if (!steps.length) throw new Error('steps 至少要有一个 step:');
  steps.forEach((s, i) => {
    s.do = /^(true|yes|1|是)$/i.test(s.do || '');
    s.choices = s.choices ? s.choices.split('|').map((x) => x.trim()).filter(Boolean) : null;
    if (s.choices && s.answer && !s.choices.includes(s.answer)) throw new Error(`第 ${i + 1} 步的 answer:「${s.answer}」不在 choices 里`);
    if (!s.show && !s.answer) throw new Error(`第 ${i + 1} 步需要 show:（揭开后显示的真实步骤）`);
    if (!s.do && !s.ask && !s.choices) throw new Error(`第 ${i + 1} 步需要 ask:（揭开前问学生的问题）`);
    s.num = s.do && s.answer && !s.choices ? numericAnswer(s.answer) : null;
  });
  return { fields, steps };
}

// do 步骤的 answer 能算出数 / 向量 / 矩阵时，用格子作答、程序判对错；否则自由作答、对照答案
function numericAnswer(src) {
  try {
    const v = compile(src)({});
    return isNum(v) || isVec(v) || isMat(v) ? v : null;
  } catch { return null; }
}

export function steps(el, src) {
  const { fields, steps: list } = parseSteps(src);
  const title = fields.title || '一步一步来';
  const body = widget(el, { title, cls: 'steps' });
  const L = fields.id ? link(fields.id) : null;
  L?.set(0);
  body.innerHTML = `${fields.q ? `<div class="w-q st-q">${mdToHtml(fields.q)}</div>` : ''}<ol class="st-list"></ol><div class="st-end" hidden>这道题的每一步都走完了。</div>`;
  const ol = body.querySelector('.st-list');
  const done = session.gate(el, title);
  let revealed = 0;

  list.forEach((s, k) => {
    const li = document.createElement('li');
    li.className = 'st-item';
    li.hidden = k > 0;
    li.innerHTML = `
      <div class="st-head"><span class="st-n">${k + 1}</span><span class="st-title">${mdToHtml(s.title || `第 ${k + 1} 步`, { inline: true })}</span>${s.do ? '<span class="st-tag">自己做</span>' : ''}</div>
      ${s.ask ? `<div class="st-ask">${mdToHtml(s.ask)}</div>` : ''}
      <div class="st-input"></div>
      <div class="ans-actions st-actions"></div>
      <div class="st-fb" hidden></div>
      <div class="st-compare" hidden></div>`;
    ol.appendChild(li);
    s.li = li;
  });
  mount(0);

  function mount(k) {
    const s = list[k];
    const li = s.li;
    li.hidden = false;
    li.classList.add('is-current');
    s.t0 = Date.now();
    const input = li.querySelector('.st-input');
    const actions = li.querySelector('.st-actions');
    const fb = li.querySelector('.st-fb');
    const q = plain(`${s.title}｜${s.ask || ''}`.replace(/\$/g, ''));
    const base = { type: 'steps', title, q, detail: `第 ${k + 1} 步`, el };
    const rec = (extra) => session.record({ ...base, ms: Date.now() - s.t0, ...extra });

    const revealBtn = button(s.do ? '对照答案' : '揭开这一步', 'btn-primary st-reveal');
    revealBtn.disabled = true;
    revealBtn.addEventListener('click', () => reveal(k));

    if (s.choices) {
      input.innerHTML = `<div class="st-choices">${s.choices.map((c, i) => `<button type="button" class="btn st-choice" data-i="${i}">${mdToHtml(c, { inline: true })}</button>`).join('')}</div>`;
      input.querySelectorAll('.st-choice').forEach((b) => b.addEventListener('click', () => {
        if (s.mine) return;
        const pick = s.choices[+b.dataset.i];
        const ok = s.answer ? pick === s.answer : null;
        s.mine = { choice: pick, ok };
        b.classList.add(ok === false ? 'is-wrong' : 'is-picked');
        if (ok === false) input.querySelector(`.st-choice[data-i="${s.choices.indexOf(s.answer)}"]`)?.classList.add('is-right');
        input.querySelectorAll('.st-choice').forEach((x) => (x.disabled = true));
        if (ok !== null) { fb.hidden = false; fb.className = `st-fb ${ok ? 'is-ok' : 'is-bad'}`; fb.textContent = ok ? '✓ 对' : `✗ 应该是「${s.answer}」，揭开看看为什么`; }
        rec({ value: pick, ok });
        revealBtn.disabled = false;
      }));
      actions.appendChild(revealBtn);
      return;
    }

    if (s.do && s.num !== null) {
      // 格子作答：程序判对错，答对或看了答案之后显示完整的这一步
      const box = document.createElement('div');
      input.appendChild(box);
      answerWidget(box, {
        answer: s.num,
        before: s.before,
        hint: s.hint,
        onTry: (t) => rec({ liveOnly: true, value: t.text, ok: t.ok, attempts: t.attempts, transcript: t.work || undefined }),
      }, (r) => {
        s.mine = { text: r.last, ok: r.ok, revealed: r.revealed };
        rec({ value: r.last, ok: r.ok, attempts: r.attempts, first: r.first, revealed: r.revealed, final: true });
        reveal(k);
      });
      return;
    }

    // 自由作答：打字、手写或截图；不判对错，只记录
    const tb = thinkBox(input, { placeholder: s.do ? '写出你的这一步' : '先写下你打算怎么做、为什么', q: `${fields.q || ''}\n这一步：${s.title}\n${s.ask || ''}`, owner: el, padHeight: s.do ? 240 : 190 });
    const submit = button('写好了', 'st-submit');
    const giveup = button('想不出来', 'st-giveup');
    actions.append(submit, giveup, revealBtn);
    submit.addEventListener('click', () => {
      const text = tb.value;
      if (!text) { fb.hidden = false; fb.className = 'st-fb is-bad'; fb.textContent = '先写一点，哪怕只是猜。想不出来就点「想不出来」。'; return; }
      s.mine = { text, via: tb.via };
      tb.lock();
      submit.hidden = true;
      giveup.hidden = true;
      fb.hidden = true;
      rec({ text, via: tb.via || undefined, ok: null });
      revealBtn.disabled = false;
      revealBtn.focus({ preventScroll: true });
    });
    giveup.addEventListener('click', () => {
      s.mine = { giveup: true, text: tb.value };
      tb.lock();
      rec({ text: tb.value || undefined, giveup: true, ok: null });
      session.event('giveup', el, { step: k + 1, title: s.title });
      reveal(k);
    });
  }

  function reveal(k) {
    const s = list[k];
    const li = s.li;
    if (li.classList.contains('is-revealed')) return;
    li.classList.remove('is-current');
    li.classList.add('is-revealed');
    li.querySelector('.st-actions').hidden = true;
    const cmp = li.querySelector('.st-compare');
    const m = s.mine || {};
    const mine = m.giveup ? `<div class="muted">想不出来${m.text ? `，写了：${escapeHtml(m.text)}` : ''}</div>`
      : m.choice ? `<div>选了「${mdToHtml(m.choice, { inline: true })}」${m.ok === true ? ' <span class="ok-mark">✓</span>' : m.ok === false ? ' <span class="bad-mark">✗</span>' : ''}</div>`
      : m.text !== undefined ? `<div class="st-mine-text">${mdToHtml(m.text)}</div>` : '';
    const real = (s.show ? mdToHtml(s.show) : '') + (s.do && s.answer && s.num === null && !s.show ? mdToHtml(s.answer) : '');
    cmp.hidden = false;
    cmp.innerHTML = s.num !== null && s.do
      ? `<div class="st-real st-real-only"><div class="st-lab">完整的这一步</div>${real || tex2html(valueTeX(s.num), true)}</div>`
      : `<div class="st-mine"><div class="st-lab">你的想法</div>${mine || '<div class="muted">（没有写）</div>'}</div><div class="st-real"><div class="st-lab">${s.do ? '参考答案' : '实际这一步'}</div>${real}</div>`;
    revealed = k + 1;
    session.event('reveal', el, { step: k + 1, title: s.title });
    L?.set(revealed);
    if (k + 1 < list.length) {
      mount(k + 1);
      requestAnimationFrame(() => list[k + 1].li.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    } else {
      body.querySelector('.st-end').hidden = false;
      done();
    }
  }
}

function button(text, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}`;
  b.textContent = text;
  return b;
}
