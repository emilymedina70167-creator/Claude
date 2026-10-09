// findbug：找错。给一份有错的解答，学生先点第一处错的那一行，再写错在哪（打字或手写）。
// 点对了显示 why；点错了提示「这一行是对的」，第二次错后可以看答案。
// 「错在哪」的文字只记录，由对话里的 Claude 看；写了 rubric: 时页面 Claude 可以给一句提示。
import { session } from '../session.js';
import { getAI } from '../ai.js';
import { widget, mdToHtml } from './common.js';
import { plain } from './answer.js';
import { thinkBox } from './thinkbox.js';

export function parseFindbug(src) {
  const fields = {};
  const lines = [];
  let last = null;
  for (const raw of String(src).split('\n')) {
    const m = raw.match(/^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/);
    if (m) {
      last = m[1].toLowerCase();
      if (last === 'line') { lines.push(m[2]); last = '_line'; continue; }
      fields[last] = m[2];
    } else if (last === '_line') lines[lines.length - 1] += '\n' + raw;
    else if (last) fields[last] += '\n' + raw;
  }
  for (const k in fields) fields[k] = fields[k].trim();
  const ls = lines.map((l) => l.trim());
  if (ls.length < 2) throw new Error('findbug 至少要有两行 line:');
  const bug = Number(fields.bug);
  if (!Number.isInteger(bug) || bug < 1 || bug > ls.length) throw new Error(`findbug 的 bug: 要写错的是第几行（1 到 ${ls.length}）`);
  return { fields, lines: ls, bug };
}

export function findbug(el, src) {
  const { fields, lines, bug } = parseFindbug(src);
  const title = fields.title || '找错';
  const body = widget(el, { title, cls: 'findbug' });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    <div class="fb-lab">下面这份解答哪一行<strong>第一次</strong>出错？点那一行。</div>
    <ol class="fb-lines">${lines.map((l, i) => `<li><button type="button" class="fb-line" data-i="${i + 1}"><span class="fb-n">${i + 1}</span><span class="fb-t">${mdToHtml(l, { inline: true })}</span></button></li>`).join('')}</ol>
    <div class="fb-explain" hidden><div class="fb-lab">错在哪？为什么？</div></div>
    <div class="ans-actions fb-actions" hidden><button type="button" class="btn btn-primary fb-submit">提交</button><button type="button" class="btn fb-show" hidden>看答案</button></div>
    <div class="fb-fb" hidden></div>`;
  const done = session.gate(el, title);
  const explain = body.querySelector('.fb-explain');
  const fb = body.querySelector('.fb-fb');
  const tb = thinkBox(explain, { placeholder: '比如：这里应该是……，因为……', q: `${fields.q || ''}\n错误的解答：\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`, owner: el });
  let pick = 0, attempts = 0, finished = false;
  const firstPicks = [];

  body.querySelectorAll('.fb-line').forEach((b) => b.addEventListener('click', () => {
    if (finished) return;
    pick = +b.dataset.i;
    body.querySelectorAll('.fb-line').forEach((x) => x.classList.toggle('is-picked', x === b));
    explain.hidden = false;
    body.querySelector('.fb-actions').hidden = false;
    fb.hidden = true;
  }));

  body.querySelector('.fb-submit').addEventListener('click', async () => {
    if (!pick || finished) return;
    const text = tb.value;
    if (!text) { tb.focus(); tb.ta.classList.add('is-need'); return; }
    attempts++;
    firstPicks.push(pick);
    const ok = pick === bug;
    session.record({ type: 'findbug', title, q: plain((fields.q || title).replace(/\$/g, '')), value: `第 ${pick} 行`, ok, attempts, text, via: tb.via || undefined, expected: `第 ${bug} 行`, liveOnly: !ok && attempts < 2, el });
    const line = body.querySelector(`.fb-line[data-i="${pick}"]`);
    if (!ok) {
      line.classList.add('is-fine');
      fb.hidden = false;
      fb.className = 'fb-fb is-bad';
      fb.innerHTML = attempts >= 2 ? '这一行是对的。可以再看看，或者点「看答案」。' : '这一行是对的，再看看。';
      if (attempts >= 2) body.querySelector('.fb-show').hidden = false;
      return;
    }
    finish(true, text);
  });
  body.querySelector('.fb-show').addEventListener('click', () => {
    session.record({ type: 'findbug', title, q: plain((fields.q || title).replace(/\$/g, '')), value: `看了答案（点过第 ${firstPicks.join('、')} 行）`, ok: false, attempts, text: tb.value || undefined, expected: `第 ${bug} 行`, revealed: true, el });
    finish(false, tb.value);
  });

  async function finish(ok, text) {
    finished = true;
    done();
    tb.lock();
    body.querySelector('.fb-actions').hidden = true;
    body.querySelectorAll('.fb-line').forEach((b) => { b.disabled = true; });
    body.querySelector(`.fb-line[data-i="${bug}"]`).classList.add('is-bug');
    fb.hidden = false;
    fb.className = `fb-fb ${ok ? 'is-ok' : 'is-reveal'}`;
    fb.innerHTML = `<div class="q-verdict">${ok ? '✓ 找对了，就是这一行' : `错在第 ${bug} 行`}</div>${fields.why ? `<div class="fb-why"><strong>对照：</strong>${mdToHtml(fields.why)}</div>` : ''}<div class="muted fb-note">你写的「错在哪」已记下，对话里的 Claude 会看。</div>`;
    if (!fields.rubric || !text) return;
    const ai = await getAI();
    if (!ai) return;
    const hint = document.createElement('div');
    hint.className = 'fb-hint muted';
    hint.textContent = 'Claude 正在看你的说明…';
    fb.appendChild(hint);
    try {
      const r = await ai.ask(`学生在做「找错」练习：一份解答第 ${bug} 行有错。
题目：${fields.q || ''}
解答：
${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}
错误要点：${fields.rubric}
学生对错误的说明：${text}

用一句中文给学生提示：说明里抓住了什么、还缺什么。只给提示，不给完整答案；不要说学生已经掌握。公式用 $...$。只输出这一句。`, { modelTier: 'quick' });
      hint.className = 'fb-hint';
      hint.innerHTML = mdToHtml(r);
      session.record({ type: 'findbug-hint', liveOnly: true, title, q: plain(fields.q || title), text, aiFeedback: r.slice(0, 600), el });
    } catch { hint.remove(); }
  }
}
