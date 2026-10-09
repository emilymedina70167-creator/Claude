// 课堂模式的开发面板（地址带 ?dev 时出现）：扮演项目对话里的 Claude 写资料包、看课堂记录，
// 也可以让模拟老师假装「Opus 5.5 用不了」，测试整段作废的流程。
import { escapeHtml } from '../render.js';

const SAMPLE_PACK = {
  unit: '第2讲 §2 · 秩一方阵（示范）',
  goal: '看到行（或列）成比例的方阵能认出秩一，写成 A = αβᵀ，并用 βᵀα = tr A 写出 Aⁿ = (tr A)ⁿ⁻¹ A，能说清为什么。',
  scope: '只讲秩一方阵的幂。不讲一般矩阵的对角化、特征值的完整理论；考试只考 3 阶以内、数字简单的题。',
  textbook: '若 A 的秩为 1，则 A 可写成 A = αβᵀ（α、β 为非零列向量）。\nA² = α(βᵀα)βᵀ = (βᵀα)A，其中 βᵀα 是一个数，且 βᵀα = tr A。\n一般地 Aⁿ = (tr A)ⁿ⁻¹ A。\n例：A = [[1,-1,1],[-1,1,-1],[1,-1,1]]，三行成比例，tr A = 3，A¹⁰ = 3⁹ A。',
  plan: '1. 从学生卡住的地方开始：Ax 本身也是一个向量，A 再作用一次，它还在那条线上（配图）。\n2. 让学生自己发现 A² = (βᵀα)A。\n3. 认出 βᵀα = tr A。\n4. 一道逐步撤掉提示的练习。\n5. 一轮认方法快练。',
  student: '上次在实时黑板第二段卡住：没想到 Ax 落在 α 所在的直线上。常见错误：把 βᵀα 当成矩阵；忘记 n−1 次方。',
};
const SAMPLE_PROBLEMS = {
  items: [
    { q: 'A = [[1,2],[2,4]]，求 A⁵', answer: '5⁴A', point: '秩一公式，tr A = 5', source: '文稿04 练习1' },
    { q: 'A = [[2,-2],[1,-1]]，求 A¹⁰⁰', answer: 'A（tr A = 1）', point: 'tr A = 1 时幂不变', source: '文稿04 练习3' },
  ],
};
const FIELDS = ['unit', 'goal', 'scope', 'textbook', 'plan', 'student', 'rules'];

export function initClassDevPanel({ db, setFallback, history }) {
  const el = document.createElement('div');
  el.className = 'dev-panel';
  el.innerHTML = `
    <button type="button" class="dev-toggle">开发面板</button>
    <div class="dev-body" hidden>
      <div class="dev-tabs"><button type="button" data-tab="pack" class="on">资料包</button><button type="button" data-tab="turns">课堂记录</button><button type="button" data-tab="teacher">模拟老师</button></div>
      <div class="dev-tab" data-tab="pack">
        ${FIELDS.map((f) => `<label>${f}<textarea class="dev-f" data-f="${f}" rows="${f === 'textbook' || f === 'plan' ? 4 : 2}"></textarea></label>`).join('')}
        <label>problems（JSON）<textarea class="dev-problems" rows="4"></textarea></label>
        <div class="dev-row"><button type="button" class="btn btn-sm btn-primary dev-save">保存资料包</button><button type="button" class="btn btn-sm dev-sample">填入示例</button></div>
      </div>
      <div class="dev-tab" data-tab="turns" hidden><div class="dev-list dev-turns"></div></div>
      <div class="dev-tab" data-tab="teacher" hidden>
        <p class="muted">本地打开时由「模拟老师」按剧本回放，不调用 Claude。地址加 <code>&teacher=real</code> 可以改用真的 Claude（需要在 claude.ai 里打开）。</p>
        <label class="dev-check"><input type="checkbox" class="dev-fallback"> 模拟「Opus 5.5 用不了」（平台换成退路模型，这一轮应当整段作废）</label>
        <div class="dev-row"><button type="button" class="btn btn-sm btn-danger dev-clear">清空这节课的全部数据</button></div>
      </div>
    </div>`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  $('.dev-toggle').addEventListener('click', () => { $('.dev-body').hidden = !$('.dev-body').hidden; if (!$('.dev-body').hidden) showTurns(); });
  el.querySelector('.dev-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    el.querySelectorAll('.dev-tabs button').forEach((b) => b.classList.toggle('on', b === t));
    el.querySelectorAll('.dev-tab').forEach((p) => (p.hidden = p.dataset.tab !== t.dataset.tab));
    if (t.dataset.tab === 'turns') showTurns();
  });

  const fill = (main, problems) => {
    el.querySelectorAll('.dev-f').forEach((t) => { t.value = main?.[t.dataset.f] || ''; });
    $('.dev-problems').value = problems ? JSON.stringify(problems, null, 1) : '';
  };
  Promise.all([db.doc('pack/main').get(), db.doc('pack/problems').get()]).then(([m, p]) => fill(m.data(), p.data()));
  $('.dev-sample').addEventListener('click', () => fill(SAMPLE_PACK, SAMPLE_PROBLEMS));
  $('.dev-save').addEventListener('click', async () => {
    const main = { updatedAt: Date.now() };
    el.querySelectorAll('.dev-f').forEach((t) => { if (t.value.trim()) main[t.dataset.f] = t.value.trim(); });
    await db.doc('pack/main').set(main);
    const raw = $('.dev-problems').value.trim();
    if (raw) {
      try { await db.doc('pack/problems').set(JSON.parse(raw)); } catch { alert('problems 不是合法的 JSON'); return; }
    }
    $('.dev-save').textContent = '已保存 ✓';
    setTimeout(() => { $('.dev-save').textContent = '保存资料包'; }, 1500);
  });

  function showTurns() {
    const rows = history().slice(-60).reverse();
    $('.dev-turns').innerHTML = rows.length ? rows.map((t) => `<div class="dev-item"><div><b>#${t.seq} ${escapeHtml(t.role)}</b>${t.kind ? ` <code>${escapeHtml(t.kind)}</code>` : ''}${t.discarded ? ' <span class="muted">（作废）</span>' : ''} <span class="muted">${new Date(t.at).toLocaleTimeString()}</span></div><div class="muted">${escapeHtml(String(t.text || '').slice(0, 220))}</div>${t.boardOps?.length ? `<div>${t.boardOps.map((o) => `<code>${escapeHtml(`${o.op} ${o.id || ''}${o.ok ? '' : ' ✗'}`)}</code>`).join(' ')}</div>` : ''}</div>`).join('') : '<p class="muted">还没有课堂记录。</p>';
  }

  $('.dev-fallback').addEventListener('change', (e) => setFallback(e.target.checked));
  $('.dev-clear').addEventListener('click', () => { if (confirm('清空本地这节课的黑板、对话和作答？')) { db._clear?.(); location.reload(); } });
}
