// 舞台上自己练（主线第四轮，设计第 3 节）：黑板组件 stage。嵌一块没有老师的舞台，页面换一组数、学生动手、页面照引擎判（follow.js）。
// 是黑板组件，所以「练一练」的挑题、证据、掌握都不用改；取数、拼指令、记什么在 stagedrillspec.js（纯函数，有测试）。
import { parseStageDrill, drawStageDrill, trackDrill } from '../stagedrillspec.js';
import { Stage } from '../stage/stage.js';
import { whereOf, followInfo, nextText } from '../stage/follow.js';
import { session } from '../session.js';

const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function stage(el, src) {
  const spec = parseStageDrill(src);
  const drawn = drawStageDrill(spec);
  el.classList.add('block-stagedrill');
  if (drawn.error) {
    // 取不出能练的数、指令写错：照黑板组件的规矩报出来（「练一练」把它标成坏题不再挑）
    el.innerHTML = `<div class="block-error">这道舞台题出不了：${escapeHtml(drawn.error)}</div>`;
    session.problem(el, 'stage', drawn.error);
    return;
  }
  el.innerHTML = `
    <div class="sd-lead"></div>
    <div class="sd-stage"></div>
    <div class="sd-bar">
      <button type="button" class="btn sd-peek">看这一趟该是什么样</button>
      <button type="button" class="btn sd-giveup">做不出来</button>
    </div>
    <div class="sd-note" aria-live="polite"></div>`;
  const $ = (s) => el.querySelector(s);
  el.dataset.sdOpen = '1'; // 还没做完（「练一练」里没做完就走，照它补记放弃）
  const st = new Stage($('.sd-stage'), { input: true, onAct: () => { Promise.resolve(st.studentChain).then(check, check); } });
  el.__stage = st; // 自动测试、调试时找得到这块舞台
  const followed = () => [...st.scene.objects.values()].filter((o) => o.follow);
  let tracks = null; // 东西 id → trackDrill
  let closed = false;

  const qOf = (o, k) => { const i = followInfo(o); return `照 ${i.title} 走：第 ${k} ${i.unit}`; };
  const finish = (text) => {
    closed = true;
    delete el.dataset.sdOpen;
    $('.sd-bar').hidden = true;
    $('.sd-note').textContent = text;
  };
  let steps = 0, slips = 0; // 到了几个检查点、其中几个不是一次做对
  function check() {
    if (closed || !tracks) return;
    let all = true;
    for (const o of followed()) {
      const t = tracks.get(o.id);
      if (!t) continue;
      const { records, done } = t.after(whereOf(o, st.scene));
      for (const r of records) {
        session.record({ type: 'stage', q: qOf(o, r.k), ok: r.ok, ...(r.wrong ? { wrong: [r.wrong] } : {}), el });
        if (r.ok) steps++; else slips++;
      }
      if (!done) all = false;
    }
    if (all) {
      session.event('final', el);
      finish(`做完了：${steps} 步里 ${steps - slips} 步一次做对。`);
    }
  }

  $('.sd-peek').addEventListener('click', () => {
    if (closed) return;
    const lines = [];
    for (const o of followed()) { tracks?.get(o.id)?.peek(); const t = nextText(o, st.scene); if (t) lines.push(t); }
    $('.sd-note').textContent = lines.join('；') || '已经做完了。';
  });
  $('.sd-giveup').addEventListener('click', () => {
    if (closed) return;
    for (const o of followed()) for (const r of tracks?.get(o.id)?.giveup() || []) session.record({ type: 'stage', q: qOf(o, r.k), ok: false, giveup: true, el });
    session.event('giveup', el, { why: '点了做不出来' });
    const lines = followed().map((o) => nextText(o, st.scene)).filter(Boolean);
    finish(`先放一放。${lines.join('；')}`);
  });

  // 演镜头指令（没有老师：不等回答；演完才开始记）
  st.play(drawn.script, { by: 'teacher' }).catch(() => {});
  const ready = () => {
    if (tracks) return;
    const objs = followed();
    if (!objs.length) return;
    tracks = new Map(objs.map((o) => [o.id, trackDrill(whereOf(o, st.scene))]));
    const i = followInfo(objs[0]);
    $('.sd-lead').textContent = `照 ${i.title} 走一遍：自己动手，每做完一${i.unit}页面会看对不对。`;
  };
  // 指令是一行一行演的（带动画）：等照着走的东西出来
  const timer = setInterval(() => { ready(); if (tracks || !el.isConnected) clearInterval(timer); }, 120);
}
