// 舞台上自己练（主线第四轮，设计第 3 节）：黑板组件 stage。嵌一块没有老师的舞台，页面换一组数、学生动手、页面照引擎判（follow.js）。
// 是黑板组件，所以「练一练」的挑题、证据、掌握都不用改；取数、拼指令、记什么在 stagedrillspec.js（纯函数，有测试）。
import { parseStageDrill, drawStageDrill, trackDrill, trackTableDrill } from '../stagedrillspec.js';
import { Stage } from '../stage/stage.js';
import { whereOf, followInfo, nextText, restText } from '../stage/follow.js';
import { rulesOf } from '../stage/rules.js';
import { wrongCells, isBlank, cellName, answerOf } from '../stage/types/table.js';
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
    <div class="sd-q"></div>
    <div class="sd-lead"></div>
    <div class="sd-stage"></div>
    <div class="sd-bar">
      <button type="button" class="btn sd-peek">看这一趟该是什么样</button>
      <button type="button" class="btn sd-giveup">做不出来</button>
    </div>
    <div class="sd-note" aria-live="polite"></div>`;
  const $ = (s) => el.querySelector(s);
  el.dataset.sdOpen = '1'; // 还没做完（「练一练」里没做完就走，照它补记放弃）
  // 只有一排格子的题用不着那么高（一块空着的灰底）：造舞台以前就定好高——造了以后再改，镜头是照原来的高摆的，牌被裁到框外面
  if (/^\s*array\b/m.test(drawn.script) && !/^\s*(graph|table|tree|matrix|plane|timeline|sentence)\b/m.test(drawn.script)) el.classList.add('is-row');
  const st = new Stage($('.sd-stage'), { input: true, bare: true, onAct: () => { el.dataset.sdTouched = '1'; Promise.resolve(st.studentChain).then(check, check); } });
  el.__stage = st; // 自动测试、调试时找得到这块舞台
  const followed = () => [...st.scene.objects.values()].filter((o) => o.follow);
  const tablesOf = () => [...st.scene.objects.values()].filter((o) => o.engine); // 引擎造的表（table T engine=…）：填表的题
  let tracks = null; // 东西 id → trackDrill（填表的题是 trackTableDrill）
  let closed = false;

  // 一道题 = 走完一遍：题面不带第几趟（同一道题的几次作答要落在一处），哪一趟的事写在 wrong 里
  const qOf = (o) => `照 ${followInfo(o).title} 走一遍`;
  const emit = (o, r) => session.record({
    type: 'stage', q: qOf(o), ok: r.ok, el,
    ...(r.wrong ? { wrong: [`第 ${r.k} ${followInfo(o).unit}：${r.wrong}`] } : {}), ...(r.giveup ? { giveup: true } : {}),
  });
  const finish = (text) => {
    closed = true;
    delete el.dataset.sdOpen;
    $('.sd-bar').hidden = true;
    $('.sd-note').textContent = text;
  };
  // 填表的题：填满了才判。全对算做完；有错指出第一处（没有老师在旁边，页面得说哪里不对），学生接着改
  const tq = (o) => `填 ${o.engine.title} 的过程表`;
  const temit = (o, r) => session.record({ type: 'stage', q: tq(o), ok: r.ok, el, ...(r.wrong ? { wrong: [r.wrong] } : {}), ...(r.giveup ? { giveup: true } : {}) });
  function checkTables() {
    let all = true, slips = 0, note = '';
    for (const o of tablesOf()) {
      const t = tracks.get(o.id);
      if (!t) continue;
      const bad = wrongCells(o);
      const first = bad[0] ? `${cellName(o, bad[0])} 写了 ${bad[0].value}（${answerOf(o, bad[0]) === '空着' ? '这一格该空着' : `答案是 ${answerOf(o, bad[0])}`}）` : '';
      const r = t.after({ blank: o.cells.filter((x) => isBlank(o, x)).length, wrong: bad.length, first });
      for (const rec of r.records) temit(o, rec);
      if (r.judged && !r.done) note = `填满了，有 ${bad.length} 格不对。先看这一格：${cellName(o, bad[0])}。`;
      if (!r.done) all = false;
      slips += t.slips;
    }
    if (all) { session.event('final', el); finish(slips ? '填完了。中间有不对的地方，改对了（记成改对了）。' : '填完了，每一格都对。'); } else if (note) $('.sd-note').textContent = note;
  }
  function check() {
    ready();
    if (closed || !tracks) return;
    if (!followed().length) { checkTables(); return; }
    let all = true, slips = 0;
    for (const o of followed()) {
      const t = tracks.get(o.id);
      if (!t) continue;
      const { records, done, step } = t.after(whereOf(o, st.scene));
      for (const r of records) emit(o, r);
      if (step && !done) $('.sd-note').textContent = `第 ${step} ${followInfo(o).unit}做完了，对的。接着做第 ${step + 1} ${followInfo(o).unit}。`;
      if (!done) all = false;
      slips += t.slips;
    }
    if (all) {
      session.event('final', el);
      finish(slips ? `走完了。中间有 ${slips} 处不是一次做对（记成改对了）。` : '走完了，每一步都一次做对。');
    }
  }

  $('.sd-peek').addEventListener('click', () => {
    if (closed) return;
    const lines = [];
    for (const o of followed()) { for (const r of tracks?.get(o.id)?.peek() || []) emit(o, r); const t = nextText(o, st.scene); if (t) lines.push(t); }
    $('.sd-note').textContent = lines.join('；') || '已经做完了。';
  });
  $('.sd-giveup').addEventListener('click', () => {
    if (closed) return;
    if (!followed().length && tablesOf().length) {
      // 填表的题：记放弃，把答案写进去给学生看（还空着的、写得不对的格）
      const lines = [];
      for (const o of tablesOf()) {
        for (const r of tracks?.get(o.id)?.giveup() || []) temit(o, r);
        const bad = new Set(wrongCells(o).map((x) => x.key));
        for (const x of o.cells) if (!x.fixed && (isBlank(o, x) || bad.has(x.key))) { const a = answerOf(o, x); lines.push(`write ${o.id}.${x.r},${x.c} ${a === '空着' ? '_' : /^(-?\d+(\.\d+)?(\/\d+)?|∞)$/.test(a) ? a : `"${a}"`}`); }
      }
      session.event('giveup', el, { why: '点了做不出来' });
      // 不演动画，一下子写完（一格一格演，二三十格要等十来秒）
      st.instant = true;
      st.play(lines.join('\n'), { by: 'teacher' }).catch(() => {}).finally(() => { st.instant = false; });
      finish('先放一放。答案写在表里了，对着看一遍。');
      return;
    }
    for (const o of followed()) for (const r of tracks?.get(o.id)?.giveup() || []) emit(o, r);
    session.event('giveup', el, { why: '点了做不出来' });
    // 完整的答案：还没做的每一趟该是什么样，一趟一行
    const lines = followed().map((o) => restText(o, st.scene)).filter(Boolean).join('；').split('；');
    finish(['先放一放。', ...lines].join('\n'));
  });

  // 演镜头指令（没有老师：不等回答；演完才开始记）
  st.play(drawn.script, { by: 'teacher' }).catch(() => {});
  const ready = () => {
    if (tracks) return;
    const objs = followed();
    if (!objs.length && tablesOf().length) {
      const ts = tablesOf();
      tracks = new Map(ts.map((o) => [o.id, trackTableDrill()]));
      $('.sd-q').textContent = tq(ts[0]);
      $('.sd-lead').textContent = `点一格写${ts[0].engine.marks.length ? '（打勾的那一行点 √ 或 ×）' : ''}；该空着的格留空。都填上页面就判。`;
      $('.sd-peek').hidden = true; // 填表没有「这一趟」：只有做不出来
      return;
    }
    if (!objs.length) return;
    // 指令是一行一行演的：open 那一行还没演到就先等等（不然「手怎么动」那一句写不出来）
    if (/^\s*open\b/m.test(drawn.script) && ![...st.scene.opens.values()].some((e) => e.obj === objs[0].id)) return;
    tracks = new Map(objs.map((o) => [o.id, trackDrill(whereOf(o, st.scene))]));
    const i = followInfo(objs[0]);
    $('.sd-q').textContent = `照 ${i.title} 走一遍`;
    // 手怎么动：照这样东西开着的那几种动作各自的一句（规则文件的 gestures[动作].brief），不另写
    const how = [...st.scene.opens.values()].filter((e) => e.obj === objs[0].id).map((e) => rulesOf(objs[0])?.gestures?.[e.action]?.brief).filter(Boolean);
    $('.sd-lead').textContent = `${how.length ? `${how.join('；')}。` : ''}每做完一${i.unit}页面会看对不对。`;

  };
  // 指令是一行一行演的（带动画）：等照着走的东西出来
  // 换下一题时这道题被移出页面：舞台清掉（不然 ResizeObserver、键盘的监听一直留着）
  const timer = setInterval(() => { ready(); if (!el.isConnected) { clearInterval(timer); st.destroy(); } }, 300);
}
