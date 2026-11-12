// 学习台的「考情」页 #exam（docs/exam-plan.md 4.6）：考试档案、每门课的考点热度（和我攒到几成并排）、真题库（按门课、按年份；
// 点开是题面、答案、解析、原页图；留着的卷只显示「留作模考」）、考情动态、怎么算的。少放编号、长列表先列几条。
// 热度读首页的缓存 meta/exam（不读整类）；真题库点开某一门课时才按门课读（load.js）。
import { mdToHtml, escapeHtml } from '../render.js';
import { targetOf, schoolLine, examDateOf } from './target.js';
import { reserveYears, usable } from './reserve.js';
import { loadExamCourse } from './load.js';
import { TYPES, HOW } from './taxonomy.js';
import { daysLeft } from '../memory/journey.js';
import { toDate } from '../memory/schema.js';
import { assetUrl } from '../live/store.js';

const COURSE_NAME = { LA: '线代', HM: '高数', PS: '概率', DS: '数据结构', CO: '组成原理', OS: '操作系统', CN: '计网', EN: '英语', PO: '政治' };
const SPACE_COURSES = { math: ['HM', 'LA', 'PS'], cs: ['DS', 'CO', 'OS', 'CN'], en: ['EN'] };
const fmt = (x) => (Math.round(x * 10) / 10).toString();
const md = (s) => { try { return mdToHtml(String(s ?? '')); } catch { return escapeHtml(String(s ?? '')); } };
const trendText = { up: '最近考得多了', down: '最近考得少了', flat: '' };

export function createExamPage(host, { db, getData, getMeta, getBoard, space }) {
  let open = null; // 真题库开着哪一门课：{ course, data, year, q }
  const loaded = new Map();

  function heatCard(course, st, board) {
    const got = new Map();
    for (const s of board?.subjects || []) for (const p of s.parts) for (const c of p.chapters) for (const b of c.blocks) got.set(b, c);
    const rows = (st?.heat || []).slice(0, 8).map((h) => `<li><span>${escapeHtml(h.title)}</span><small class="muted">${h.n} 次 · 平均每年 ${fmt(h.perYear)} 分${trendText[h.trend] ? ` · ${trendText[h.trend]}` : ''}</small></li>`).join('');
    const rest = (st?.heat || []).length - 8;
    return `<section class="dk-card ex-heat"><h2 class="dk-h">${COURSE_NAME[course]}</h2>
      <p class="dk-sub muted">${st ? `${st.span?.[0] || ''}–${st.span?.[1] || ''} 年 ${st.n} 道真题${st.untagged ? `（${st.untagged} 道还没打标签）` : ''}` : '还没有真题'}</p>
      ${rows ? `<ol class="ex-list">${rows}</ol>${rest > 0 ? `<p class="muted">还有 ${rest} 个考点</p>` : ''}` : ''}
      ${st ? `<button type="button" class="btn ex-bank" data-course="${course}">看真题</button>` : ''}</section>`;
  }

  function bank() {
    const { course, data, year, q } = open;
    const t = targetOf(getData());
    const years = reserveYears(t, toDate(Date.now()));
    const byYear = new Map();
    for (const x of data.questions) { const y = Number(x.year); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(x); }
    const ys = [...byYear.keys()].sort((a, b) => b - a);
    const cur = year || ys[0];
    const list = (byYear.get(cur) || []).sort((a, b) => a.n - b.n);
    const reserved = years.includes(cur) || list.some((x) => x.reserve);
    const one = q ? data.questions.find((x) => x.id === q) : null;
    return `<section class="dk-card ex-bankcard"><div class="dk-mrow"><h2 class="dk-h">${COURSE_NAME[course]} · 真题</h2><button type="button" class="btn btn-sm ex-close">收起</button></div>
      <div class="dk-spaces ex-years" role="tablist">${ys.map((y) => `<button type="button" class="dk-space ex-year" data-year="${y}" aria-selected="${y === cur}">${y}</button>`).join('')}</div>
      ${reserved ? `<p class="muted">留作模考 · ${cur}：冲刺阶段整套做，现在不看。</p>` : `<ul class="ex-qs">${list.map((x) => `<li><button type="button" class="ex-q" data-q="${x.id}" aria-expanded="${x.id === q}">第 ${x.n} 题 · ${TYPES[x.type] || x.type} · ${x.points} 分${x.tags?.how ? ` · ${HOW[course]?.[x.tags.how] || ''}` : ''}</button></li>`).join('')}</ul>`}
      ${one && usable(one, years) ? `<div class="ex-detail">${md(one.stem)}${one.options ? `<ol class="ex-opts" type="A">${Object.entries(one.options).map(([k, v]) => `<li>${md(`${k}. ${v}`)}</li>`).join('')}</ol>` : ''}
        <details class="dk-soft"><summary>答案和解析</summary>${one.answer ? `<p><b>答案：</b>${escapeHtml(one.answer)}</p>` : ''}${md(one.analysis || '')}</details>
        ${one.img ? `<div class="ex-img"><img src="${escapeHtml(assetUrl(String(one.img)))}" alt="原页" loading="lazy"></div>` : ''}</div>` : ''}</section>`;
  }

  function paint() {
    const t = targetOf(getData());
    const meta = getMeta() || {};
    const n = daysLeft(toDate(Date.now()), examDateOf(t));
    const lines = (t.lines || []).filter((l) => (l.src?.checks || 0) >= 2);
    const courses = SPACE_COURSES[space()] || [];
    host.innerHTML = `<section class="dk-card ex-target"><h2 class="dk-h">${escapeHtml(schoolLine(t))}</h2>
        <p class="dk-sub muted">考 ${(t.subjects || []).join('、')} · 离考试 ${n} 天 · 目标 ${t.goal} 分</p>
        ${lines.length ? `<ul class="ex-list">${lines.map((l) => `<li><span>${l.year} 年${escapeHtml(l.kind || '')}</span><b>${escapeHtml(String(l.value))}</b></li>`).join('')}</ul>` : '<p class="muted">历年分数线还没核过（教研室查到两次一样的数才写上）。</p>'}</section>
      ${courses.map((c) => heatCard(c, meta.stats?.[c], getBoard?.())).join('')}
      ${open ? bank() : ''}
      <section class="dk-card"><details class="dk-fold"><summary><h2 class="dk-h">怎么算的</h2></summary>
        <p>考情的数都是页面从带标签的真题里算的：一道题的分，主考点算全分、次考点各算一半；「平均每年」是这几年的分加起来除以年数；最近五年平均每年的分比以前多出四分之一算「考得多了」。留作模考的卷算进次数和分数，题面不给看。</p>
        <p>410 分里，一章的分分到块时，三成平分、七成按这一块真题平均每年几分。</p></details></section>`;
  }

  host.addEventListener('click', async (e) => {
    const b = e.target.closest('.ex-bank, .ex-year, .ex-q, .ex-close');
    if (!b) return;
    if (b.matches('.ex-close')) open = null;
    else if (b.matches('.ex-bank')) {
      const course = b.dataset.course;
      b.disabled = true;
      if (!loaded.has(course)) loaded.set(course, await loadExamCourse(db, course));
      open = { course, data: loaded.get(course), year: 0, q: '' };
    } else if (b.matches('.ex-year')) open = { ...open, year: Number(b.dataset.year), q: '' };
    else open = { ...open, q: open.q === b.dataset.q ? '' : b.dataset.q };
    paint();
  });
  return { show: paint, refresh: paint };
}
