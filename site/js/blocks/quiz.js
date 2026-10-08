// 练习题：选择题（单选/多选）或填空（数字、分数、文字）
import { parseFields } from '../parse.js';
import { Frac } from '../linalg.js';
import { widget, mdToHtml } from './common.js';

export function quiz(el, src) {
  const { fields, lines } = parseFields(src);
  const options = lines
    .map((l) => l.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/))
    .filter(Boolean)
    .map((m) => ({ correct: m[1].toLowerCase() === 'x', text: m[2] }));
  const q = fields.q || fields.question || '';
  if (!q) throw new Error('需要 q: 题目');
  if (!options.length && fields.answer === undefined) throw new Error('需要选项（- [x] / - [ ]）或 answer:');

  const body = widget(el, { cls: 'quiz', title: fields.title || '练习 Check' });
  const multi = options.filter((o) => o.correct).length > 1;
  body.innerHTML = `
    <div class="q-text">${mdToHtml(q)}</div>
    ${options.length ? `<div class="q-options">${options.map((o, i) => `<button type="button" class="q-opt" data-i="${i}"><span class="q-mark">${String.fromCharCode(65 + i)}</span><span class="q-label">${mdToHtml(o.text, { inline: true })}</span></button>`).join('')}</div>
      ${multi ? '<div class="q-actions"><span class="muted">多选题</span><button type="button" class="btn btn-primary q-submit">提交</button></div>' : ''}`
    : `<div class="q-fill"><input class="q-input" placeholder="输入答案，可以写分数如 3/4" autocomplete="off" autocapitalize="off"><button type="button" class="btn btn-primary q-check">检查</button></div>`}
    <div class="q-feedback" hidden></div>`;

  const fb = body.querySelector('.q-feedback');
  const explain = fields.explain || fields.explanation || '';
  const feedback = (ok, extra = '') => {
    fb.hidden = false;
    fb.className = `q-feedback ${ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = `<div class="q-verdict">${ok ? '✓ 正确' : '✗ 再想想'}</div>${extra}${explain && ok ? mdToHtml(explain) : ''}${!ok ? '<button type="button" class="link-btn q-reveal">看解析</button>' : ''}`;
    fb.querySelector('.q-reveal')?.addEventListener('click', () => reveal());
  };
  const reveal = () => {
    body.querySelectorAll('.q-opt').forEach((b, i) => options[i].correct && b.classList.add('is-answer'));
    if (fields.answer !== undefined) {
      fb.innerHTML = `<div>答案：${mdToHtml(fields.answer, { inline: true })}</div>${explain ? mdToHtml(explain) : ''}`;
    } else {
      fb.innerHTML = explain ? mdToHtml(explain) : '<div class="muted">（没有解析）</div>';
    }
    fb.className = 'q-feedback is-reveal';
  };

  if (options.length && !multi) {
    body.querySelectorAll('.q-opt').forEach((btn) => btn.addEventListener('click', () => {
      const ok = options[+btn.dataset.i].correct;
      body.querySelectorAll('.q-opt').forEach((b) => b.classList.remove('is-right', 'is-wrong'));
      btn.classList.add(ok ? 'is-right' : 'is-wrong');
      feedback(ok);
    }));
  } else if (multi) {
    body.querySelectorAll('.q-opt').forEach((btn) => btn.addEventListener('click', () => {
      btn.classList.toggle('is-picked');
      body.querySelectorAll('.q-opt').forEach((b) => b.classList.remove('is-right', 'is-wrong'));
    }));
    body.querySelector('.q-submit').addEventListener('click', () => {
      let ok = true;
      body.querySelectorAll('.q-opt').forEach((b, i) => {
        const picked = b.classList.contains('is-picked');
        if (picked !== options[i].correct) ok = false;
        if (picked) b.classList.add(options[i].correct ? 'is-right' : 'is-wrong');
      });
      feedback(ok);
    });
  } else {
    const input = body.querySelector('.q-input');
    const check = () => {
      const ok = matches(input.value, fields.answer);
      input.classList.toggle('is-wrong', !ok);
      input.classList.toggle('is-right', ok);
      feedback(ok);
    };
    body.querySelector('.q-check').addEventListener('click', check);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  }
}

// 数字按数值比较（1/2 = 0.5），否则忽略大小写和空格比较；答案可用 | 分隔多个可接受写法
function matches(given, answer) {
  const norm = (s) => String(s).replace(/\$/g, '').replace(/\s+/g, '').toLowerCase();
  return String(answer).split('|').some((ans) => {
    try {
      return Math.abs(Number(Frac.from(norm(given))) - Number(Frac.from(norm(ans)))) < 1e-9;
    } catch {
      return norm(given) === norm(ans) && norm(given) !== '';
    }
  });
}

export const _test = { matches };
