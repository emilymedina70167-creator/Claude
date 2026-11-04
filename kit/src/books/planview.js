// 学习台自己备课的画面（docs/textbook-plan.md 第 3 批）：
// - 挂课程地图（教材页「挂到课程地图」）：Claude 看一本资料的目录和现有的课程地图，提出每块挂哪些条目、要不要加新块；我勾了才写
// - 备课（首页「上课」卡）：选一块 → Claude 按这块的范围、挂着的原文、全部规则和记忆写资料包，写进 pack/main（这一科的），我看过再开课
// 都用 Opus 5.5（和课堂同一个模型）；一次调用，花了多少记在书 / 资料包上
import { escapeHtml, mdToHtml } from '../render.js';
import { toast } from '../record.js';
import { assertWrite, toDate, dueList } from '../memory/schema.js';
import { mapPrompt, parseMap, mapDoc, prepPrompt, parsePrep, parsePages, openTodos } from './plan.js';
import { loadBooks } from './importer.js';
import { blockChunks, chunkLine } from './textbook.js';
import { memoryDigest } from '../memory/digest.js';
import { prefixOf, packIds, subjectOf, sharedFor, spaceOfId, filterSpace, COURSES } from '../memory/space.js';
import { activeLessons } from '../memory/memo.js';
import { rehearsePrompt, parseRehearsal } from './rehearse.js';
import { debriefText } from '../memory/debrief.js';
import { reviewRank, plainTitle } from '../memory/views.js';
import { COMPONENT_DOCS } from '../class/docs.js';
import { allNames } from '../subject.js';
import { CORE_COMPONENTS } from '../class/prompt.js';

const esc = escapeHtml;
const docsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const enc = new TextEncoder();

/** db、getAI、model：同教材页；getData()：整个记忆库（desk.js 的 data）；space()：现在看着哪一科 */
export function createPlanner({ db, getAI, model, getData, space }) {
  async function ask(prompt) {
    const ai = await getAI();
    if (!ai) throw new Error('这个页面现在调用不了 Claude');
    const res = await ai.call(prompt, { model, effort: 'high', modelTier: 'complex', cache: false });
    return { text: res.text, bytes: enc.encode(prompt).length, model: res.modelApplied || '' };
  }

  /* —— 挂课程地图 —— */
  async function openMap(host, bookId) {
    if (!host) return;
    host.innerHTML = '<p class="muted">Claude 在看这本资料的目录和现有的课程地图（一次调用，一两分钟）…</p>';
    try {
      const book = (await db.doc(`books/${bookId}`).get()).data();
      const chunks = docsOf(await db.collection(`books/${bookId}/chunks`).get()).sort((a, b) => (a.seq || 0) - (b.seq || 0));
      if (!chunks.length) throw new Error('这本还没有条目');
      const sp = book.space || space();
      const curriculum = getData().curriculum.filter((b) => spaceOfId(b.id) === sp);
      // 新块的编号前缀：英语 EN-；408 看这本资料是哪门课（数据结构 DS- 等），数学不带
      const course = Object.entries(COURSES).find(([, c]) => c.space === sp && (sp !== 'cs' || c.name === book.subject))?.[0];
      const r = await ask(mapPrompt({ book: { id: bookId, ...book }, chunks, curriculum, prefix: prefixOf(course) }));
      const { rows, notes } = parseMap(r.text, { chunks, curriculum });
      render(host, { bookId, rows, notes, chunks, curriculum });
    } catch (e) {
      host.innerHTML = `<p class="dk-warn">没挂成：${esc(e?.message || e?.code || e)}</p>`;
    }
  }

  function render(host, st) {
    const name = (id) => st.chunks.find((c) => c.id === id);
    host.innerHTML = `<div class="dk-memo-sub" role="heading" aria-level="3">Claude 提的（勾上的写进课程地图）</div>
      ${st.rows.length ? st.rows.map((r, i) => `<label class="bk-maprow${r.problems.length ? ' is-bad' : ''}">
          <input type="checkbox" data-i="${i}" ${r.problems.length ? '' : 'checked'}>
          <span><b>${esc(r.id)}</b> ${r.isNew ? '<span class="dk-tag is-warn">新</span>' : ''} ${esc(r.title)}
            ${r.isNew && r.scope ? `<br><span class="muted">${esc(r.scope)}</span>` : ''}
            ${(r.isNew ? r.chunks : r.add).length ? `<br><span class="muted">${r.isNew ? '' : '加挂 '}${(r.isNew ? r.chunks : r.add).slice(0, 6).map((id) => esc(name(id) ? chunkLine(name(id)) : id)).join('；')}${(r.isNew ? r.chunks : r.add).length > 6 ? `……一共 ${(r.isNew ? r.chunks : r.add).length} 条` : ''}</span>` : ''}
            ${r.problems.length ? `<br><span class="dk-warn">${esc(r.problems.join('；'))}</span>` : ''}</span>
        </label>`).join('') : '<p class="muted">没有要改的：现有的块都挂好了。</p>'}
      ${st.notes ? `<p class="muted">Claude 说：${esc(st.notes)}</p>` : ''}
      ${st.rows.length ? '<div class="mm-acts"><button type="button" class="btn btn-primary bk-map-ok">写进课程地图</button><button type="button" class="btn bk-map-x">不要</button></div>' : ''}`;
    host.querySelector('.bk-map-x')?.addEventListener('click', () => { host.innerHTML = ''; });
    host.querySelector('.bk-map-ok')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const picked = [...host.querySelectorAll('input[type=checkbox]')].filter((x) => x.checked).map((x) => st.rows[Number(x.dataset.i)]);
      // 先写讲、节，再写块（上一级先有）
      picked.sort((a, b) => ['lecture', 'section', 'block'].indexOf(a.level) - ['lecture', 'section', 'block'].indexOf(b.level));
      try {
        assertWrite('me', 'curriculum');
        for (const r of picked) {
          const old = st.curriculum.find((b) => b.id === r.id) || null;
          const doc = mapDoc(r, old, { today: toDate(Date.now()), book: st.bookId });
          delete doc.id;
          await db.doc(`curriculum/${r.id}`).set(doc);
        }
        toast(`写进去了：${picked.length} 块`);
        host.innerHTML = `<p class="dk-ok">课程地图改好了（${picked.length} 块）。</p>`;
      } catch (err) {
        toast(`没写成：${err?.message || err}`);
        e.currentTarget.disabled = false;
      }
    });
  }

  /* —— 备课 —— */
  /** 给 block 备课，写进这一科的 pack/main、pack/problems。onStep(msg) 报进度 */
  async function prep(blockId, { onStep = () => {}, pages = '' } = {}) {
    const data = getData();
    const sp = space();
    const block = data.curriculum.find((b) => b.id === blockId);
    if (!block) throw new Error(`课程地图里没有 ${blockId}`);
    onStep('读资料…');
    const { books, chunks } = await loadBooks(db, sp);
    // 这一块挂着的条目，加上我写的教材页范围里的（课程地图还没挂好、或者想按书页备的时候）
    const range = parsePages(pages);
    const byPage = range ? chunks.filter((c) => Number(c.page) >= range[0] && Number(c.page) <= range[1]) : [];
    const material = [...new Map([...blockChunks(block, chunks), ...byPage].map((c) => [c.id, c])).values()].sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const subject = subjectOf(blockId);
    const today = toDate(Date.now());
    // 记忆：和课堂里带的同一份（全文 + 目录）；规则：全部（备课和资料包的规矩是给对话里的 Claude 的，现在备课的就是它的活）
    const mem = memoryDigest(data, { block: blockId, budget: 24 * 1024, tools: false, today });
    const rules = sharedFor(data.rules, sp).filter((r) => r.status !== 'void').map((r) => `- ［${r.cat || ''}］${r.text}`).join('\n');
    const recent = data.sessions.filter((s) => s.status === 'closed' && s.report?.line).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0)).slice(0, 3).map((s) => `- ${s.id}（${s.block || ''}）：${s.report.line}`).join('\n');
    const components = [...new Set([...CORE_COMPONENTS, ...allNames(COMPONENT_DOCS, subject)])];
    // 到期的复现组（这一科的）：从没复现过的、上次没过的在前，再按过期久排；教学守则全带
    const mine = filterSpace(data, sp);
    const revs = new Map(mine.reviews.map((x) => [String(x.id), x]));
    const due = dueList(mine.reviews, today).filter((d) => d.days <= 0)
      .map((d) => ({ ...d, r: revs.get(d.id) })).sort((a, b) => reviewRank(a.r) - reviewRank(b.r) || a.days - b.days);
    const dueText = due.map((d) => `- ${d.id} ${d.title}（${d.days < 0 ? `过期 ${-d.days} 天` : '今天到期'}；${d.r?.result ? `上次${d.r.result}` : '从没复现过'}${d.r?.content?.length ? `；内容：${[].concat(d.r.content).slice(0, 3).join('；')}` : ''}）`).join('\n');
    const lessons = activeLessons(data.lessons, sp).map((l) => `- ${l.id} ${l.text}`).join('\n');
    // 上课时记下的待办（学生问了教案以外的）：还没补的带上，补上了的记进 meta/todos（页面自己的）
    const todoSnap = await db.doc('meta/todos').get().catch(() => null);
    const doneTodos = todoSnap?.exists ? (todoSnap.data().done || []) : [];
    const todos = openTodos(data, sp, doneTodos).slice(-20);
    onStep('Claude 在备课（一次调用，一两分钟）…');
    const r = await ask(prepPrompt({ block, material, books, memoryText: mem.text, rulesText: rules, components, subject, recent, due: dueText, lessons, todos }));
    const { main, problems } = parsePrep(r.text, { block, chunkIds: material.map((c) => c.id), components, today, reviewIds: due.map((d) => d.id), todos });
    if (range) main.pages = `${range[0]}-${range[1]}`;
    main.cost = { bytes: r.bytes, model: r.model };
    const ids = packIds(sp);
    await db.doc(`pack/${ids.main}`).set(main);
    await db.doc(`pack/${ids.problems}`).set(problems);
    // 补上的待办等开课时才记成补了（desk.js 的 newClass）：备了没上、又重新备别的块，待办不丢
    onStep('备好了；后台在按你的记录把教案预演一遍（不用等，可以直接开课）');
    // 上一节（这一科）下课后的复盘：预演时对照还没消的误解
    const lastDebrief = mine.sessions.filter((x) => x.debrief).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0]?.debrief;
    rehearse({ main, problems, memoryText: mem.text, debrief: lastDebrief ? debriefText(lastDebrief) : '', subject, packId: ids.main })
      .catch((e) => console.warn('课前预演没做成', e?.message || e?.code || e));
    return main;
  }

  // —— 课前预演（rehearse.js，docs/smart-plan.md 第 2 批）：备好教案以后，后台（lane: 'bg'）再调用一次 Opus 5.5 high，
  // 按学生的记录把教案走一遍，哪一步会卡、拿什么题探，写回教案的 rehearsal。这期间又重新备了课（教案换了）就不写
  async function rehearse({ main, problems, memoryText, debrief, subject, packId }) {
    const ai = await getAI();
    if (!ai) return;
    const prompt = rehearsePrompt({ main, problems, memoryText, debrief, subject });
    const res = await ai.call(prompt, { model, effort: 'high', modelTier: 'complex', cache: false, lane: 'bg' });
    if (res?.modelApplied && res.modelApplied !== model) return;
    const got = parseRehearsal(res.text);
    if (got.problems.includes('回的不是预演')) { console.warn('预演回的不是预演', String(res.text).slice(0, 200)); return; }
    const ref = db.doc(`pack/${packId}`);
    const cur = await ref.get().then((r) => (r.exists ? r.data() : null));
    if (!cur || cur.at !== main.at) return;
    const rehearsal = { steps: got.steps, fixes: got.fixes, at: Date.now(), model: res.modelApplied || '', bytes: enc.encode(prompt).length };
    await ref.set({ ...cur, rehearsal });
    // 预演写好以前已经开了课（备好时就说了「不用等，可以直接开课」）：开课时抄走的是那节课自己的一份资料包，
    // 写进那一份，课堂订阅着 pack/main，下一轮就看得到；不然这一次调用白花了
    if (cur.usedBy) {
      const sref = db.doc(`sessions/${cur.usedBy}/pack/main`);
      const sp = await sref.get().then((r) => (r.exists ? r.data() : null)).catch(() => null);
      if (sp && sp.at === main.at && !sp.rehearsal) await sref.set({ ...sp, rehearsal }).catch(() => {});
    }
  }

  /** 首页「上课」卡里的备课区：选块、备课、看备好的 */
  function prepHtml({ suggested = '', blocks = [], main = null, busy = false, msg = '' } = {}) {
    return `<div class="dk-prep">
        <div class="dk-mrow"><label class="mm-f" style="flex:1"><span>下一节讲哪一块</span><select class="dk-prep-block">${blocks.map((b) => `<option value="${esc(b.id)}"${b.id === suggested ? ' selected' : ''}>${esc(plainTitle(b.title) || b.id)}${b.chunks?.length ? '' : '（没挂资料）'}</option>`).join('')}</select></label>
        <label class="mm-f" style="width:9em"><span>教材页（可选）</span><input class="dk-prep-pages" inputmode="numeric" placeholder="比如 10-17" value="${esc(main?.pages || '')}"></label>
        <button type="button" class="btn dk-prep-go"${busy ? ' disabled' : ''}>${main ? '重新备课' : '让 Claude 备课'}</button></div>
        ${msg ? `<p class="muted dk-prep-msg">${esc(msg)}</p>` : ''}
        ${main?.prepCheck?.length ? `<p class="dk-warn">备课检查：${esc(main.prepCheck.join('；'))}（课堂里的 Claude 会看到，上课时绕开）</p>` : ''}
        ${main && (main.route || main.sequence || main.plan) ? `<details class="dk-soft"><summary>看备好的教案</summary><div class="dk-summary">${planHtml(main)}</div>${main.chunks?.length ? `<p class="muted">照着讲的资料：${esc(main.chunks.join('、'))}</p>` : ''}</details>` : ''}
      </div>`;
  }

  // 教案给我看：路线、开头复现、规则、讲解顺序，补充说明放最后
  function planHtml(main) {
    const parts = [];
    if (main.route) parts.push(`<p><b>路线</b></p>${mdToHtml(String(main.route))}`);
    if (main.review?.length) parts.push(`<p><b>开头复现</b></p><ul>${main.review.map((r) => `<li><b>${esc(r.id)}</b> ${esc(r.how)}</li>`).join('')}</ul>`);
    if (main.methods?.length) parts.push(`<p><b>这节课的规则</b></p><ul>${main.methods.map((m) => `<li><b>${esc(m.title || m.id)}</b>：${mdToHtml(String(m.steps || ''), { inline: true })}</li>`).join('')}</ul>`);
    if (main.sequence?.length) parts.push(`<p><b>讲解顺序</b></p><ol>${main.sequence.map((x) => `<li>${mdToHtml(String(x.point || ''), { inline: true })}</li>`).join('')}</ol>`);
    if (main.plan) parts.push(`<p><b>补充</b></p>${mdToHtml(String(main.plan))}`);
    // 课前预演：哪一步多半会卡（老师上课时也带着）
    const rh = main.rehearsal;
    if (rh?.steps?.length || rh?.fixes?.length) parts.push(`<p><b>课前预演</b></p><ul>${(rh.steps || []).map((x) => `<li>第 ${x.step} 步：${mdToHtml(String(x.issue || ''), { inline: true })}${x.probe ? `<br><span class="muted">探题：${mdToHtml(String(x.probe), { inline: true })}</span>` : ''}</li>`).join('')}${(rh.fixes || []).map((f) => `<li>${mdToHtml(String(f), { inline: true })}</li>`).join('')}</ul>`);
    return parts.join('');
  }

  return { openMap, prep, prepHtml };
}
