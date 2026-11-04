// 学习台给我看的页面（docs/desk-plan.md 第 3 批，统计是第 4 批）：课程地图、弱点表、错题本、以前的课、统计。
// 都只读、不调用 Claude；数据是首页一直订阅着的那份记忆库（desk.js 传进来），算的部分在 views.js。
// 地址用 # 区分：#map、#weak、#errors、#classes、#classes/c-…（一节课的报告）、#stats。翻看以前的课的黑板是 #view/c-…（整页刷新进只读的课堂）。
import { sheetMd } from './sheet.js';
import { ask } from '../dialog.js';
import { mdToHtml, escapeHtml } from '../render.js';
import { toast } from '../record.js';
import { assetUrl } from '../live/store.js';
import { scopeDb, SESSION_KINDS as KIND_TEXT } from './session.js';
import { OUTCOME_TEXT } from './report.js';
import { tokenText } from '../class/usage.js';
import {
  curriculumTree, blockDetail, blockTimeline, weaknessRows, errorRows, classRows, learningStats, evidenceLine, MASTERY_KEY, cmpId,
} from './views.js';
import { toDate } from './schema.js';
import { hitText, lessonLines, pointCatalog } from './skills.js';
import { debriefView } from './debrief.js';

const inline = (s) => { try { return mdToHtml(String(s ?? ''), { inline: true }); } catch { return escapeHtml(String(s ?? '')); } };
const esc = escapeHtml;
const ERR_PAGE = 20;
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
const stateChip = (state, tier) => `<span class="dk-st st-${MASTERY_KEY[state] || 'none'}">${esc(state || '未学')}${state === '复现通过' && tier ? ` ${esc(tier)} 天档` : ''}</span>`;
// 给我看的变化记录：字段换成中文，编号一串（依据、挂的错题）只说几条，课号换成日期
const FIELD_TEXT = { state: '掌握', tier: '档位', level: '证据级', last: '最近一次', result: '结果', status: '状态', basis: '依据', errors: '挂的错题', blocks: '相关的块', title: '标题', next: '下一节', block: '块', debts: '欠账', text: '内容', q: '问法', a: '答案', lapses: '没想起的次数' };
const ID_LISTS = new Set(['basis', 'errors', 'blocks', 'weaknesses', 'evidence']);
export const noSessionIds = (s) => String(s ?? '').replace(/\bc-\d{4}(\d{2})(\d{2})-\d+\b/g, (_, m, d) => `${Number(m)}/${Number(d)} 那节课`);
const logVal = (f, v) => (ID_LISTS.has(f) ? (Array.isArray(v) ? `${v.length} 条` : v ? '1 条' : '无') : noSessionIds(fmt(v)));
const logLines = (log) => (Array.isArray(log) ? log : []).slice(-8).reverse().map((l) => `<li><b>${esc(l.date || '')}</b> ${esc(({ chat: '开发那边', class: '课堂里的 Claude', me: '我', page: '页面' })[l.by] || l.by || '')}：${esc(FIELD_TEXT[l.field] || l.field || '')} ${esc(logVal(l.field, l.from))} → ${esc(logVal(l.field, l.to))}${list(l.basis).length ? `<span class="muted">（依据 ${list(l.basis).length} 条作答）</span>` : ''}${l.note ? `<span class="muted"> · ${esc(noSessionIds(l.note))}</span>` : ''}</li>`).join('');
const evRow = (e) => ({ id: e.id, at: e.at, date: toDate(e.at), session: e.session || null, ok: e.ok ?? null, line: evidenceLine(e), images: list(e.images) });
const fmt = (v) => (v === null || v === undefined ? '无' : Array.isArray(v) ? v.join('、') : String(v));

/**
 * host：放页面的元素；getData()：这一科的记忆库各类的数组（一直在更新）；db：学习台的数据库；ops：memops.js；
 * goto(hash)：整页刷新跳到地址（进课堂、翻看黑板）。返回 { show(route), refresh() }
 */
export function createPages(host, { getData, db, ops, goto, purge = null }) {
  let route = '';
  let data = getData(); // 当前这一科的记忆（desk.js 的 filterSpace），每次重画时重新取
  const open = new Set(); // 展开着的详情（页面重画时保持）
  let errFilter = { block: '', weakness: '', state: 'open' };
  let errShown = ERR_PAGE; // 错题本一次列多少道（一下列一百多道太长）
  // 编号换成名字：块、弱点都显示标题，编号只在没有标题时用（2026-11-03：各种编号看着头大）
  const blockName = (id) => { const b = (data.curriculum || []).find((d) => String(d.id) === String(id)); return b?.title || String(id || ''); };
  const weakName = (id) => { const w = (data.weaknesses || []).find((d) => String(d.id) === String(id)); return w?.title || String(id || ''); };
  const reports = new Map(); // 课号 → 课后报告（读过的缓存）

  host.addEventListener('click', onClick);
  host.addEventListener('change', (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f) return;
    errFilter = { ...errFilter, [f.dataset.filter]: f.value };
    errShown = ERR_PAGE;
    paint();
  });

  function show(r) { route = r; paint(); }
  function refresh() { if (route) paint(); }

  function paint() {
    const [page, arg] = route.split('/');
    data = getData();
    // 正在打字（错题本的筛选不算）时不重画
    if (host.contains(document.activeElement) && document.activeElement.matches('textarea, input:not([type])')) return;
    const y = window.scrollY;
    host.innerHTML = page === 'map' ? mapPage() : page === 'weak' ? weakPage() : page === 'errors' ? errorsPage() : page === 'classes' ? (arg ? classPage(arg) : classesPage()) : page === 'stats' ? statsPage() : '';
    window.scrollTo(0, y);
  }

  /* —— 课程地图 —— */
  function mapPage() {
    const tree = curriculumTree(data);
    if (!tree.length) return '<p class="muted">课程地图还是空的：对话里的 Claude 备课时会把讲、节、块写进 curriculum。</p>';
    const legend = `<div class="dk-legend">${['未学', '讲过', '基础题过', '复现通过', '掉了'].map((s) => stateChip(s)).join('')}</div>`;
    const blk = (b) => `<div class="dk-blk" data-open="map:${esc(b.id)}">
        <button type="button" class="dk-blk-row" data-toggle="map:${esc(b.id)}" aria-expanded="${open.has(`map:${b.id}`)}"><span>${inline(b.title || b.id)}</span>${stateChip(b.state, b.tier)}</button>
        ${b.points?.length ? `<div class="dk-pts">${b.points.map((p) => `<span class="dk-pt">${inline(p.title || p.id.split('#')[1])} ${stateChip(p.state, p.tier)}</span>`).join('')}</div>` : ''}
        ${open.has(`map:${b.id}`) ? blockPanel(b.id) : ''}
      </div>`;
    const sec = (n) => `<div class="dk-sec"><div class="dk-sec-h">${inline(n.title || n.id)}${counts(n.count)}</div>${n.children.map((c) => (c.level === 'block' ? blk(c) : sec(c))).join('')}</div>`;
    return `${legend}${tree.map((l) => `<section class="dk-card dk-lec"><h2 class="dk-h">${inline(l.title || l.id)}</h2>${counts(l.count)}${l.children.map((c) => (c.level === 'block' ? blk(c) : sec(c))).join('') || '<p class="muted">还没有节和块。</p>'}</section>`).join('')}`;
  }
  const counts = (c) => (c && Object.keys(c).length ? `<span class="dk-counts">${Object.entries(c).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</span>` : '');

  function blockPanel(id) {
    const d = blockDetail(data, id);
    const tl = blockTimeline(data.evidence || [], id, { limit: 40 });
    const m = d.mastery;
    return `<div class="dk-panel">
      ${d.block?.scope ? `<p><span class="dk-k">范围</span>${inline(d.block.scope)}</p>` : ''}
      ${d.block?.exam ? `<p><span class="dk-k">考试</span>${inline(d.block.exam)}</p>` : ''}
      ${m.length ? m.map((x) => `<div class="dk-sub-card"><p><b>${String(x.id).includes('#') ? inline(x.title || pointCatalog(data.sessions || [], data.mastery || [])[x.id]?.title || String(x.id).split('#')[1]) : '这一块'}</b> ${stateChip(x.state, x.tier)}</p>${Array.isArray(x.log) && x.log.length ? `<ul class="dk-log">${logLines(x.log)}</ul>` : ''}</div>`).join('') : '<p class="muted">还没有掌握状态（未学）。</p>'}
      ${d.weaknesses.length ? `<p><span class="dk-k">弱点</span>${d.weaknesses.map((w) => inline(w.title)).join('；')} <a href="#weak" class="dk-link">弱点表</a></p>` : ''}
      ${d.errors.length ? `<p><span class="dk-k">错题</span>${d.errors.length} 道${d.errors.some((e) => e.resolved) ? `（已解决 ${d.errors.filter((e) => e.resolved).length}）` : ''} <a href="#errors" class="dk-link">错题本</a></p>` : ''}
      ${d.reviews.length ? `<p><span class="dk-k">复现组</span>${d.reviews.map((r) => inline(r.title)).join('；')}</p>` : ''}
      <div class="dk-memo-sub" role="heading" aria-level="3">这一块的作答（最近的在前）</div>
      ${timeline(tl)}
    </div>`;
  }

  function timeline(rows) {
    if (!rows.length) return '<p class="muted">还没有作答。</p>';
    return `<ol class="dk-tl">${rows.map((r) => `<li class="${r.ok === true ? 'is-ok' : r.ok === false ? 'is-bad' : ''}"><span class="dk-tl-d">${esc(r.date.slice(5))}</span><span>${inline(r.line)}${r.images.length ? ` ${r.images.slice(0, 3).map((id) => `<img class="dk-thumb" src="${esc(assetUrl(id))}" alt="原图" loading="lazy">`).join('')}` : ''}${r.session ? ` <a class="dk-link muted" href="#classes/${esc(r.session)}">那节课</a>` : ''}</span></li>`).join('')}</ol>`;
  }

  /* —— 弱点表 —— */
  function weakPage() {
    const rows = weaknessRows(data);
    if (!rows.length) return '<p class="muted">弱点表还是空的。</p>';
    return `<section class="dk-card"><h2 class="dk-h">弱点表</h2><p class="dk-sub muted">影响面大的在前（通用 → 链条 → 局部）。L0 是还没修好，L3 是隔了很久还对。点一条看挂的错题。</p>
      ${rows.map((w) => `<div class="dk-blk${w.closed ? ' is-closed' : ''}">
        <button type="button" class="dk-blk-row" data-toggle="weak:${esc(w.id)}" aria-expanded="${open.has(`weak:${w.id}`)}"><span>${inline(w.title)}</span><span class="dk-tag">${esc(w.scope || '')}</span><span class="dk-tag lv-${esc(w.level || '')}">${esc(w.level || '')}</span>${w.hits?.n > 1 ? `<span class="dk-tag is-warn">出现 ${w.hits.n} 次</span>` : ''}${w.closed ? '<span class="dk-tag">关了</span>' : ''}</button>
        ${open.has(`weak:${w.id}`) ? `<div class="dk-panel">
          ${w.hits?.n ? `<p>${esc(hitText(w.hits))}</p>` : w.last ? `<p><span class="dk-k">最近</span>${esc(w.last)}</p>` : ''}
          ${list(w.blocks).length ? `<p><span class="dk-k">相关的块</span>${list(w.blocks).map((b) => inline(blockName(b))).join('、')}</p>` : ''}
          ${w.errorDocs.length ? `<div class="dk-memo-sub" role="heading" aria-level="3">挂的错题</div>${w.errorDocs.map((e) => errorCard(e, false)).join('')}` : ''}
          ${Array.isArray(w.log) && w.log.length ? `<div class="dk-memo-sub" role="heading" aria-level="3">怎么变过来的</div><ul class="dk-log">${logLines(w.log)}</ul>` : ''}
          <div class="dk-memo-sub" role="heading" aria-level="3">最近相关的作答</div>
          ${timeline(list(w.blocks).flatMap((b) => blockTimeline(data.evidence || [], b, { limit: 15 })).sort((a, b) => b.at - a.at).slice(0, 20))}
        </div>` : ''}
      </div>`).join('')}</section>`;
  }

  /* —— 错题本 —— */
  function errorsPage() {
    const all = errorRows(data, { state: 'all' });
    if (!all.length) return '<p class="muted">还没有错题。</p>';
    const blocks = [...new Set(all.map((e) => String(e.block || '')).filter(Boolean))].sort(cmpId);
    const weaks = [...new Set(all.map((e) => String(e.weakness || '')).filter(Boolean))].sort(cmpId);
    // 题面只写了「见 L2-52」的（以前迁移时一道题记了两条，指向原题）：不单列，提一句
    const pointer = (e) => /^见\s*(?:[A-Z]{2}-)?L\d/.test(String(e.q || '').trim());
    const all0 = errorRows(data, errFilter);
    const rows = all0.filter((e) => !pointer(e));
    const pointers = all0.length - rows.length;
    const shown = rows.slice(0, errShown);
    const sel = (name, opts, label) => `<label class="dk-mblock"><span class="dk-k">${label}</span><select data-filter="${name}">${opts.map(([v, t]) => `<option value="${esc(v)}"${errFilter[name] === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    return `<section class="dk-card"><h2 class="dk-h">错题本</h2>
      <div class="dk-mrow dk-filters">${sel('state', [['open', '没解决的'], ['resolved', '已解决的'], ['all', '全部']], '看')}${sel('block', [['', '全部块'], ...blocks.map((b) => [b, blockName(b)])], '块')}${sel('weakness', [['', '全部弱点'], ...weaks.map((w) => [w, weakName(w)])], '弱点')}</div>
      <p class="muted">${rows.length} 道${rows.length > shown.length ? `，先列 ${shown.length} 道` : ''}。点一道看全文。${pointers ? `（另有 ${pointers} 条只写了「见某道题」，是同一道题记了两次，不单列）` : ''}</p>
      ${shown.map((e) => errorCard(e, true)).join('') || '<p class="muted">没有符合的。</p>'}
      ${rows.length > shown.length ? `<div class="mm-acts"><button type="button" class="btn" data-more="1">再列 ${Math.min(ERR_PAGE, rows.length - shown.length)} 道</button></div>` : ''}</section>`;
  }

  // 一道错题：收起时一行（错在哪 + 日期），点开看题面、我的答案、根因和按钮
  function errorCard(e, actions) {
    const key = `err:${e.id}`;
    const full = `full:${e.id}`;
    const evs = list(e.evidence);
    // 一行：题面；根因写的是「见 L2-52」这种指向别处的就不列
    const short = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
    const head = short(e.q || e.step || e.cause, 64);
    const why = /^见/.test(String(e.cause || '').trim()) || e.cause === e.q ? '' : short(e.cause, 50);
    if (!open.has(full)) return `<div class="dk-err is-short${e.resolved ? ' is-resolved' : ''}"><button type="button" class="dk-err-row" data-toggle="${esc(full)}" aria-expanded="false"><span>${inline(head)}${why ? `<br><span class="muted">${inline(why)}</span>` : ''}</span><span class="muted">${esc(String(e.date || '').slice(5))}</span>${e.resolved ? '<span class="dk-tag is-ok">已解决</span>' : ''}</button></div>`;
    return `<div class="dk-err${e.resolved ? ' is-resolved' : ''}">
      <button type="button" class="dk-err-row" data-toggle="${esc(full)}" aria-expanded="true"><span class="muted">${e.source ? inline(noSessionIds(e.source)) : ''}${e.date ? ` · ${esc(e.date)}` : ''}${e.weakness ? ` · ${inline(weakName(e.weakness))}` : ''}</span><span class="dk-link">收起</span></button>
      ${e.q ? `<p><span class="dk-k">题面</span>${inline(e.q)}</p>` : ''}
      ${e.mine ? `<p><span class="dk-k">我的答案</span>${inline(e.mine)}</p>` : ''}
      ${e.step ? `<p><span class="dk-k">错在</span>${inline(e.step)}</p>` : ''}
      ${e.cause ? `<p><span class="dk-k">根因</span>${inline(e.cause)}</p>` : ''}
      ${e.fixes?.length ? `<ul class="dk-log">${e.fixes.map((f) => `<li>${f.resolved ? '标了已解决' : f.void ? '作废' : '更正'}${f.note ? `：${inline(f.note)}` : f.cause ? `：${inline(f.cause)}` : ''}</li>`).join('')}</ul>` : ''}
      ${actions ? `<div class="mm-acts">${evs.length ? `<button type="button" class="btn btn-sm" data-toggle="${esc(key)}">${open.has(key) ? '收起作答原文' : '看作答原文'}</button>` : ''}${!e.resolved ? `<button type="button" class="btn btn-sm" data-solve="${esc(e.id)}">标已解决</button>` : ''}</div>` : ''}
      ${actions && open.has(key) ? `<div class="dk-panel">${timeline((data.evidence || []).filter((x) => evs.includes(x.id)).sort((a, b) => (b.at || 0) - (a.at || 0)).map(evRow))}</div>` : ''}
    </div>`;
  }

  /* —— 以前的课 —— */
  function classesPage() {
    const rows = classRows(data);
    if (!rows.length) return '<p class="muted">还没有上过课。</p>';
    return `<section class="dk-card"><h2 class="dk-h">以前的课</h2><p class="dk-sub muted">测试开的、不要的课：点进去，最下面「删掉这节课」。</p>${rows.map((r) => `<a class="dk-class-row" href="#classes/${esc(r.id)}">
      <span class="dk-cr-d"><b>${esc((r.date || '').slice(5).replace('-', '/') || r.id)}</b></span>
      <span class="dk-cr-m">${r.kind !== 'class' ? `<span class="dk-tag is-ok">${KIND_TEXT[r.kind]}</span>` : ''}${r.review ? '<span class="dk-tag">复现课</span>' : ''}${r.drill ? '<span class="dk-tag">练习</span>' : ''}${r.status === 'open' ? '<span class="dk-tag is-warn">没下课</span>' : ''} ${inline(r.title)}<br><span class="muted">${inline(r.summary || r.line || '')}</span></span>
      <span class="dk-cr-n">${r.minutes !== null ? `${r.minutes} 分钟` : ''}${r.usage?.calls ? `<br><span class="muted">${esc(tokenText(r.usage.bytes))}</span>` : ''}${r.verify ? `<br><span class="muted">核验 ${r.verify.turns}${r.verify.discarded ? ` · 作废 ${r.verify.discarded}` : ''}</span>` : ''}</span>
    </a>`).join('')}</section>`;
  }

  function classPage(sid) {
    const r = classRows(data).find((x) => x.id === sid);
    if (!r) return `<p class="muted">没有 ${esc(sid)} 这节课。</p><p><a class="dk-link" href="#classes">回到以前的课</a></p>`;
    const rep = reports.get(sid);
    if (rep === undefined) {
      reports.set(sid, null);
      scopeDb(db, sid).doc('report/main').get().then((s) => { reports.set(sid, s.exists ? s.data() : false); refresh(); }, () => { reports.set(sid, false); refresh(); });
    }
    const obs = (data.observations || []).filter((o) => o.session === sid);
    const sum = obs.find((o) => o.kind === 'summary');
    return `<p><a class="dk-link" href="#classes">← 以前的课</a></p>
      <section class="dk-card"><h2 class="dk-h">${esc(r.date)} ${inline(r.title)}</h2>
        <p class="muted">${KIND_TEXT[r.kind]}${r.block ? ` · ${inline(blockName(r.block))}` : ''}${r.minutes !== null ? ` · ${r.minutes} 分钟` : ''}${r.usage?.calls ? ` · 调用 ${r.usage.calls} 轮，${esc(tokenText(r.usage.bytes))}` : ''}</p>
        <div class="mm-acts"><button type="button" class="btn btn-primary" data-goto="${r.status === 'open' ? esc(sid) : `view/${esc(sid)}`}">${r.status === 'open' ? (r.kind === 'class' ? '接着上课' : '进去') : r.kind === 'unit' ? '翻看这个单元' : '翻看这节课的黑板'}</button>${purge ? `<button type="button" class="btn btn-danger" data-purge="${esc(sid)}">删掉这节课</button>` : ''}</div>
        ${debriefHtml(r.debrief)}
        ${skillsHtml(r.skills)}
        ${sum ? `<div class="dk-memo-sub" role="heading" aria-level="3">下课小结</div><div class="dk-summary">${mdToHtml(sum.text || '')}</div>` : ''}
        ${rep && sheetMd(rep.sheet) ? `<div class="dk-memo-sub" role="heading" aria-level="3">这节课的一页</div><div class="dk-summary dk-sheet">${mdToHtml(sheetMd(rep.sheet))}</div>` : ''}
        ${rep ? reportHtml(rep) : rep === false ? '<p class="muted">这节课还没有课后报告（下课以后才有；回首页会补写）。</p>' : '<p class="muted">正在读课后报告…</p>'}
        ${obs.filter((o) => o.kind !== 'summary').length ? `<details class="dk-soft"><summary>老师当堂的笔记（${obs.filter((o) => o.kind !== 'summary').length} 条）</summary><ul class="dk-log">${obs.filter((o) => o.kind !== 'summary').map((o) => `<li>${o.kind === 'proposal' ? '<b>提议</b> ' : ''}${inline(o.text)}</li>`).join('')}</ul></details>` : ''}
      </section>`;
  }

  // 下课后的复盘（debrief.js）：误解消了没有、思维习惯、下节先测；给老师的依据和建议收起来
  function debriefHtml(d) {
    const rows = debriefView(d);
    if (!rows.length) return '';
    const more = [...(d.pace || []).map((p) => `节奏：${p.where}${p.how ? `——${p.how}` : ''}`), ...(d.opening?.q ? [`开场的题：${d.opening.q}`] : []), ...(d.advice || []).map((a) => `给下一节老师：${a}`)];
    return `<div class="dk-memo-sub" role="heading" aria-level="3">下课后的复盘</div>
      ${rows.map((x) => `<p>${inline(x.text)}</p>`).join('')}
      ${more.length ? `<details class="dk-soft"><summary>节奏和给老师的建议</summary><ul class="dk-log">${more.map((t) => `<li>${inline(t)}</li>`).join('')}</ul></details>` : ''}`;
  }

  // 这节课的三行和按知识点的表（skills.js：下课后页面让 Claude 把每道题归到知识点）
  function skillsHtml(sk) {
    if (!sk?.sum || !Object.keys(sk.sum).length) return '';
    const cat = pointCatalog(data.sessions || [], data.mastery || []);
    const ll = lessonLines(sk, cat);
    const row = (k, xs, f) => (xs.length ? `<p><span class="dk-k">${k}</span>${xs.map(f).join('；')}</p>` : '');
    const name = (p) => cat[p]?.title || sk.points?.[p] || p.split('#')[1];
    return `<div class="dk-memo-sub" role="heading" aria-level="3">这节课学到哪了</div>
      ${row('会了', ll.solid, (x) => inline(x.name))}
      ${row('还不稳', ll.shaky, (x) => `${inline(x.name)}<span class="muted">（错 ${x.fail} 道${x.fixed ? '，当堂改过来了，隔天再测' : ''}${x.w.length ? `；${x.w.map((w) => inline(weakName(w))).join('、')}` : ''}）</span>`)}
      ${row('下次先测', ll.next, (x) => inline(x.name))}
      <details class="dk-soft"><summary>按知识点（${Object.keys(sk.sum).length} 个）</summary><div class="dk-tablewrap"><table class="dk-table2"><thead><tr><th>知识点</th><th>题</th><th>一次对</th><th>失手</th></tr></thead><tbody>${Object.entries(sk.sum).sort((a, b) => cmpId(a[0], b[0])).map(([p, x]) => `<tr><td>${inline(name(p))}<span class="muted">（${inline(blockName(p.split('#')[0]))}）</span></td><td>${x.n}</td><td>${x.first}</td><td>${x.fail}</td></tr>`).join('')}</tbody></table></div></details>`;
  }

  function reportHtml(rep) {
    const t = rep.totals || {};
    const items = rep.items || [];
    return `<div class="dk-memo-sub" role="heading" aria-level="3">课后报告</div>
      <p>做了 ${t.items || 0} 题：一次对 ${t.first || 0}、改对 ${t.ok || 0}${t.guess ? `（其中 ${t.guess} 道是把选项试遍了才对）` : ''}、错 ${t.wrong || 0}、想不出来 ${t.giveup || 0}、看了答案 ${t.revealed || 0}${t.open ? `、没判 ${t.open}` : ''}${t.drafts ? `；${t.drafts} 处草稿没交` : ''}。</p>
      ${items.length ? `<div class="dk-tablewrap"><table class="dk-table2"><thead><tr><th>题</th><th>每次</th><th>结果</th><th>用时</th></tr></thead><tbody>${items.map((it) => `<tr><td>${inline(it.q)}${it.page ? `<span class="muted">（第 ${it.page} 块板）</span>` : ''}</td><td class="dk-seq">${esc(it.seq || '·')}</td><td>${esc(it.guess ? '试出来的' : OUTCOME_TEXT[it.outcome] || it.outcome)}</td><td>${it.ms ? `${Math.round(it.ms / 1000)} 秒` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${(rep.byTag || []).filter((x) => x.tag).length ? `<p><span class="dk-k">按块 / 知识点</span>${rep.byTag.filter((x) => x.tag).map((x) => `${inline(blockName(x.tag))}：${x.items} 题一次对 ${x.first}`).join('；')}</p>` : ''}
      ${rep.words?.length ? `<p><span class="dk-k">查过的生词</span>${rep.words.map((w) => `${esc(w.word)}<span class="muted"> ${esc(w.gloss)}</span>`).join('；')}</p>` : ''}
      ${rep.drafts?.length ? `<p><span class="dk-k">没交的草稿</span>${rep.drafts.map((d) => `「${esc(d.text)}」`).join('；')}</p>` : ''}
      ${rep.says?.length ? `<p><span class="dk-k">我说的</span>${rep.says.filter((s) => s.text).map((s) => `「${esc(s.text)}」`).join(' ')}</p>` : ''}
      ${rep.manual?.length ? `<p><span class="dk-k">补记</span>${rep.manual.map((m) => `「${esc(m.text)}」${m.verdict ? `（${esc(m.verdict)}）` : ''}`).join(' ')}</p>` : ''}`;
  }

  /* —— 统计 —— */
  function statsPage() {
    const st = learningStats(data, { days: 14 });
    const max = Math.max(30, ...st.daily.map((d) => d.minutes));
    // 一个系列（每天学了几分钟）：细柱，主题色，悬停看数；下面另有表
    return `<section class="dk-card"><h2 class="dk-h">最近两周</h2>
      ${!st.total && !st.daily.some((d) => d.items) ? '<p class="dk-empty">最近两周还没上过课。上完一节，这里每天一根柱子。</p>' : `<p>一共 ${st.total} 分钟，学了 ${st.studyDays} 天。</p>
      <div class="dk-bars" role="img" aria-label="最近 14 天每天学习的分钟数">${st.daily.map((d) => `<div class="dk-bar" title="${esc(d.date)}：${d.minutes} 分钟，${d.items} 题一次对 ${d.first}"><i${d.minutes ? '' : ' class="is-zero"'} style="height:${Math.round((d.minutes / max) * 100)}%"></i><span>${esc(d.date.slice(8))}</span></div>`).join('')}</div>
      <details class="dk-soft"><summary>看表</summary><div class="dk-tablewrap"><table class="dk-table2"><thead><tr><th>日期</th><th>分钟</th><th>题</th><th>一次对</th></tr></thead><tbody>${st.daily.filter((d) => d.minutes || d.items).map((d) => `<tr><td>${esc(d.date)}</td><td>${d.minutes}</td><td>${d.items}</td><td>${d.first}</td></tr>`).join('') || '<tr><td colspan="4">这两周还没有课后报告。</td></tr>'}</tbody></table></div></details>`}
    </section>
    <section class="dk-card"><h2 class="dk-h">每一块</h2>${st.blocks.length ? `<div class="dk-tablewrap"><table class="dk-table2"><thead><tr><th>块</th><th>分钟</th><th>节数</th><th>一次做对</th></tr></thead><tbody>${st.blocks.map((b) => `<tr><td>${inline(blockName(b.block))}</td><td>${b.minutes}</td><td>${b.sessions}</td><td>${b.items ? `${b.first} / ${b.items}` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">还没有。</p>'}</section>
    <section class="dk-card"><h2 class="dk-h">一次做对率（每节课）</h2>${st.trend.length ? `<div class="dk-tablewrap"><table class="dk-table2"><tbody>${st.trend.map((x) => `<tr><td>${esc(x.date)}</td><td class="dk-rate"><i style="width:${x.rate}%"></i><span>${x.rate}%</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">还没有做过题的课。</p>'}</section>`;
  }

  async function onClick(e) {
    const t = e.target.closest('[data-toggle], [data-solve], [data-goto], [data-more], [data-purge]');
    if (!t) return;
    if (t.dataset.purge) { purge?.(t.dataset.purge, t); return; }
    if (t.dataset.more) { errShown += ERR_PAGE; paint(); return; }
    if (t.dataset.goto) { goto(t.dataset.goto); return; }
    if (t.dataset.toggle) {
      const k = t.dataset.toggle;
      if (open.has(k)) open.delete(k); else open.add(k);
      paint();
      return;
    }
    if (t.dataset.solve) {
      if (!await ask('把这道错题标成已解决？（原条不动，加一条更正；7 天内能撤）', { ok: '已解决' })) return;
      t.disabled = true;
      try { await ops.me('resolve', { id: t.dataset.solve }); toast('标了已解决'); } catch (err) { toast(`没成：${err?.message || err}`); t.disabled = false; }
    }
  }

  return { show, refresh };
}
