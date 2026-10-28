// 学习台自己备课的画面（docs/textbook-plan.md 第 3 批）：
// - 挂课程地图（教材页「挂到课程地图」）：Claude 看一本资料的目录和现有的课程地图，提出每块挂哪些条目、要不要加新块；我勾了才写
// - 备课（首页「上课」卡）：选一块 → Claude 按这块的范围、挂着的原文、全部规则和记忆写资料包，写进 pack/main（这一科的），我看过再开课
// 都用 Opus 5.5（和课堂同一个模型）；一次调用，花了多少记在书 / 资料包上
import { escapeHtml, mdToHtml } from '../render.js';
import { toast } from '../record.js';
import { assertWrite, toDate } from '../memory/schema.js';
import { mapPrompt, parseMap, mapDoc, prepPrompt, parsePrep } from './plan.js';
import { loadBooks } from './importer.js';
import { blockChunks, chunkLine } from './textbook.js';
import { memoryDigest } from '../memory/digest.js';
import { prefixOf, packIds, subjectOf, sharedFor, spaceOfId, COURSES } from '../memory/space.js';
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
  async function prep(blockId, { onStep = () => {} } = {}) {
    const data = getData();
    const sp = space();
    const block = data.curriculum.find((b) => b.id === blockId);
    if (!block) throw new Error(`课程地图里没有 ${blockId}`);
    onStep('读资料…');
    const { books, chunks } = await loadBooks(db, sp);
    const material = blockChunks(block, chunks);
    const subject = subjectOf(blockId);
    const today = toDate(Date.now());
    // 记忆：和课堂里带的同一份（全文 + 目录）；规则：全部（备课和资料包的规矩是给对话里的 Claude 的，现在备课的就是它的活）
    const mem = memoryDigest(data, { block: blockId, budget: 24 * 1024, tools: false, today });
    const rules = sharedFor(data.rules, sp).filter((r) => r.status !== 'void').map((r) => `- ［${r.cat || ''}］${r.text}`).join('\n');
    const recent = data.sessions.filter((s) => s.status === 'closed' && s.report?.line).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0)).slice(0, 3).map((s) => `- ${s.id}（${s.block || ''}）：${s.report.line}`).join('\n');
    const components = [...new Set([...CORE_COMPONENTS, ...allNames(COMPONENT_DOCS, subject)])];
    onStep('Claude 在备课（一次调用，一两分钟）…');
    const r = await ask(prepPrompt({ block, material, books, memoryText: `${mem.rules ? `${mem.rules}\n\n` : ''}${mem.text}`, rulesText: rules, components, subject, recent }));
    const { main, problems } = parsePrep(r.text, { block, chunkIds: material.map((c) => c.id), components, today });
    main.cost = { bytes: r.bytes, model: r.model };
    const ids = packIds(sp);
    await db.doc(`pack/${ids.main}`).set(main);
    await db.doc(`pack/${ids.problems}`).set(problems);
    onStep('备好了');
    return main;
  }

  /** 首页「上课」卡里的备课区：选块、备课、看备好的 */
  function prepHtml({ suggested = '', blocks = [], main = null, busy = false, msg = '' } = {}) {
    return `<div class="dk-prep">
        <div class="dk-mrow"><label class="mm-f" style="flex:1"><span>下一节讲哪一块</span><select class="dk-prep-block">${blocks.map((b) => `<option value="${esc(b.id)}"${b.id === suggested ? ' selected' : ''}>${esc(b.id)} ${esc(b.title || '')}${b.chunks?.length ? '' : '（没挂资料）'}</option>`).join('')}</select></label>
        <button type="button" class="btn dk-prep-go"${busy ? ' disabled' : ''}>${main ? '重新备课' : '让 Claude 备课'}</button></div>
        ${msg ? `<p class="muted dk-prep-msg">${esc(msg)}</p>` : ''}
        ${main?.plan ? `<details class="dk-soft"><summary>看备好的推进计划和题</summary><div class="dk-summary">${mdToHtml(String(main.plan))}</div>${main.chunks?.length ? `<p class="muted">照着讲的资料：${esc(main.chunks.join('、'))}</p>` : ''}</details>` : ''}
      </div>`;
  }

  return { openMap, prep, prepHtml };
}
