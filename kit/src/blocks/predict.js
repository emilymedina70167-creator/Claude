// predict：先猜再看。拖动问号点到你认为的位置 → 确定 → 显示真实位置（可配合动画）
import { createScene, parseScene } from '../scene.js';
import { compile, numText } from '../expr.js';
import { session } from '../session.js';
import { widget, mdToHtml, tex2html } from './common.js';

export function predict(el, src) {
  const parsed = parseScene(src);
  const { fields } = parsed;
  if (!fields.answer) throw new Error('predict 需要 answer:（正确位置的表达式）');
  const answer = compile(fields.answer);
  const tol = Number(fields.tol) || 0.3;
  const titleText = fields.title || '先猜一猜 Predict';

  const extra = { t: 0, guess: [0.5, 0.5] };
  let target = null;
  const body = widget(el, { title: titleText, cls: 'predict' });
  body.insertAdjacentHTML('beforebegin', fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : '');
  // 课堂里 figure target=<predict 的 id> 也能 set / play / highlight（揭晓前后都行）；
  // 只有 guess 是学生自己放的，课堂 Claude 不能替学生挪
  const api = createScene(body, parsed, {
    extraVars: extra,
    locked: { guess: 'guess 是学生自己拖的猜测，不能替学生改；要指给学生看，用 highlight' },
    dragTargets: { guess: (p) => { if (!target) extra.guess = p.map((x) => Math.round(x * 10) / 10); } },
    afterDraw(plane) {
      if (target) {
        plane.line(extra.guess, target, 'guide');
        plane.dot(target, 'target-dot', 8);
      }
      plane.dot(extra.guess, 'guess-dot', 7);
      plane.text([extra.guess[0] + 0.25 * plane.range / 5, extra.guess[1] + 0.3 * plane.range / 5], target ? '你的猜测' : '?', 'plot-text guess-label');
      if (!target) plane.handle(extra.guess, 'guess', 'var(--v4)');
    },
  });
  const side = body.querySelector('.w-side');
  side.insertAdjacentHTML('afterbegin', `<div class="pred-status muted">拖动紫色圆点到你猜的位置，然后点「确定」。</div><button type="button" class="btn btn-primary pred-go">确定</button>`);
  const status = side.querySelector('.pred-status');
  const go = side.querySelector('.pred-go');
  const done = session.gate(el, titleText);
  const id = session.registerScene(el, api, titleText);
  el.dataset.scene = id;

  go.addEventListener('click', async () => {
    go.disabled = true;
    let v;
    try { v = { ...extra, ...api.snapshot() }; target = answer({ ...v, t: 1 }); } catch (e) { status.textContent = '答案表达式有误：' + e.message; return; }
    const dist = Math.hypot(extra.guess[0] - target[0], extra.guess[1] - target[1]);
    api.reveal();
    await api.animate('t', 0, 1, 1500);
    const close = dist <= tol;
    status.className = `pred-status ${close ? 'ok' : 'warn'}`;
    status.innerHTML = `${close ? '猜得很准！' : '和真实位置差了一些。'}真实位置是 ${tex2html(`(${target.map(numText).join(', ')})`)}，你猜的是 ${tex2html(`(${extra.guess.map((x) => Number(x.toFixed(1))).join(', ')})`)}。`;
    if (fields.explain) status.insertAdjacentHTML('afterend', `<div class="w-note">${mdToHtml(fields.explain)}</div>`);
    go.remove();
    session.record({ type: 'predict', title: titleText, q: plain(fields.q), guess: extra.guess, answer: target, ok: close, el });
    done();
  });
}

const plain = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 160);
