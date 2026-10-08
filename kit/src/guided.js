// 引导模式：按 ## 分成小节，完成本节的练习后才解锁下一节
import { renderLesson, splitStages, mdToHtml, escapeHtml } from './render.js';
import { session } from './session.js';
import { copyRecord, toast } from './record.js';

export function renderGuided(src, root, meta) {
  const stages = splitStages(src);
  session.stages = stages.map((s) => ({ ...s }));
  const unitName = meta.unit || session.title;

  root.innerHTML = `
    <div class="g-bar">
      <div class="g-name">${mdToHtml(unitName, { inline: true })}</div>
      <div class="g-dots" role="list"></div>
      <div class="g-tools">
        <button type="button" class="btn btn-sm g-copy">复制学习记录</button>
        <button type="button" class="btn btn-sm g-reset" title="清空本单元的进度和记录">重来</button>
      </div>
    </div>
    <div class="g-stages"></div>`;
  const box = root.querySelector('.g-stages');
  const dots = root.querySelector('.g-dots');

  stages.forEach((st, i) => {
    const sec = document.createElement('section');
    sec.className = 'stage';
    sec.dataset.stage = i;
    sec.innerHTML = `<div class="stage-body"></div>
      <div class="stage-foot">
        <button type="button" class="link-btn stage-ask" hidden>这一节有疑问？问 Claude</button>
        ${i < stages.length - 1 ? '<span class="stage-wait muted">完成上面的练习后继续</span><button type="button" class="btn btn-primary stage-next" hidden>继续 →</button>' : ''}
      </div>`;
    box.appendChild(sec);
    session.stages[i].el = sec;
    renderLesson(st.src, sec.querySelector('.stage-body'));
  });

  let unlocked = Math.min(stages.length - 1, Math.max(0, session.progress));
  const secs = [...box.querySelectorAll('.stage')];

  function update() {
    secs.forEach((sec, i) => {
      sec.hidden = i > unlocked;
      const next = sec.querySelector('.stage-next');
      const wait = sec.querySelector('.stage-wait');
      if (!next) return;
      const done = session.stageDone(i);
      const passed = i < unlocked;
      next.hidden = !done || passed;
      wait.hidden = done || passed;
    });
    dots.innerHTML = stages.map((st, i) => {
      const cls = i < unlocked ? 'done' : i === unlocked ? 'current' : 'locked';
      const name = st.title || '开始';
      return `<button type="button" role="listitem" class="g-dot ${cls}" data-i="${i}" ${i > unlocked ? 'disabled' : ''} title="${escapeHtml(name)}" aria-label="${escapeHtml(`第 ${i + 1} 节：${name}`)}"><span>${i + 1}</span></button>`;
    }).join('');
  }

  box.addEventListener('click', (e) => {
    const next = e.target.closest('.stage-next');
    if (next) {
      const i = Number(next.closest('.stage').dataset.stage);
      unlocked = Math.max(unlocked, i + 1);
      session.progress = unlocked;
      update();
      secs[i + 1].classList.add('stage-enter');
      secs[i + 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const ask = e.target.closest('.stage-ask');
    if (ask) session.openTutor?.(Number(ask.closest('.stage').dataset.stage));
  });
  dots.addEventListener('click', (e) => {
    const d = e.target.closest('.g-dot');
    if (d && !d.disabled) secs[Number(d.dataset.i)].scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  root.querySelector('.g-copy').addEventListener('click', () => copyRecord(toast));
  const reset = root.querySelector('.g-reset');
  reset.addEventListener('click', () => {
    if (reset.dataset.armed) { session.clear(); location.reload(); return; }
    reset.dataset.armed = '1';
    reset.textContent = '确定清空？';
    reset.classList.add('btn-danger');
    setTimeout(() => { delete reset.dataset.armed; reset.textContent = '重来'; reset.classList.remove('btn-danger'); }, 3000);
  });

  session.on(update);
  update();
}
