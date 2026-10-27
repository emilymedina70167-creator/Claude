// 学习台首页的「补记」（docs/desk-plan.md 3.2）：在学习台外面做的（纸上、Notability、外部对话里），
// 贴截图或者写一句话，可选挂到某一块、标「对 / 错 / 不会」，记成一条证据（src: manual，memory/session.js 的 manualEvidence）。
// 贴图和课堂输入条一样要绕 iPad 的坑：Notability 圈选「拷贝」后 paste 事件里什么都没有，Safari 只往可编辑的框里插 <img src="blob:…">，
// 所以粘贴框是 contenteditable，空的 paste 不拦，图从插进来的 <img> 里取（class/bar.js 的 toPng、srcToPng 转成白底 PNG）。
import { escapeHtml } from '../render.js';
import { clipboardImages, htmlImageSrcs, toPng, srcToPng } from '../class/bar.js';
import { MANUAL_VERDICTS } from './session.js';

const MAX_UP = 4;

/**
 * box：放表单的元素；blocks()：可挂的块 [{ id, title }]；images：能不能存图（有 assets 才能）；
 * onSave({ text, blobs, block, verdict })：存（抛错时表单留着、显示原因）。
 */
export function createManualForm(box, { blocks = () => [], images = true, onSave }) {
  box.innerHTML = `
    <div class="dk-mform">
      <textarea class="dk-mtext" rows="2" placeholder="在哪做的、做了什么、卡在哪（比如：纸上做了例 2.3，第二步换括号又错了）" aria-label="补记的内容"></textarea>
      ${images ? `<div class="dk-mshot">
        <div class="dk-mzone cb-paste-zone" contenteditable="true" data-hint="在这里长按，粘贴截图（Notability 圈选拷贝的也行）" aria-label="粘贴截图"></div>
        <button type="button" class="btn dk-mpick">选图</button>
        <input type="file" class="dk-mfile" accept="image/*" multiple hidden>
      </div>
      <div class="dk-mthumbs" hidden></div>` : ''}
      <div class="dk-mrow">
        <label class="dk-mblock"><span class="dk-k">挂到</span><select aria-label="挂到哪一块"></select></label>
        <div class="dk-mverdict" role="group" aria-label="结果">${MANUAL_VERDICTS.map((v) => `<button type="button" class="btn dk-mv" data-v="${v}" aria-pressed="false">${v}</button>`).join('')}</div>
      </div>
      <div class="dk-mrow dk-mfoot"><span class="dk-mnote muted" role="status"></span><button type="button" class="btn btn-primary dk-msave" disabled>记下来</button></div>
    </div>`;
  const $ = (s) => box.querySelector(s);
  const ta = $('.dk-mtext');
  const sel = $('.dk-mblock select');
  const save = $('.dk-msave');
  const note = $('.dk-mnote');
  const zone = $('.dk-mzone');
  const thumbs = $('.dk-mthumbs');
  let picked = []; // { blob, url }
  let verdict = '';
  let busy = false;

  function fillBlocks() {
    const cur = sel.value;
    const list = blocks();
    sel.innerHTML = `<option value="">不挂</option>${list.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.id)} ${escapeHtml(String(b.title || '').slice(0, 30))}</option>`).join('')}`;
    if (list.some((b) => b.id === cur)) sel.value = cur;
  }
  fillBlocks();
  const say = (msg, warn = false) => { note.textContent = msg; note.classList.toggle('is-warn', warn); };
  const sync = () => { save.disabled = busy || (!ta.value.trim() && !picked.length); };
  ta.addEventListener('input', sync);
  box.querySelectorAll('.dk-mv').forEach((b) => b.addEventListener('click', () => {
    verdict = verdict === b.dataset.v ? '' : b.dataset.v;
    box.querySelectorAll('.dk-mv').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === verdict)));
  }));

  function renderPicked() {
    if (!thumbs) return;
    thumbs.hidden = !picked.length;
    thumbs.innerHTML = picked.map((p, i) => `<figure class="cb-thumb"><img src="${p.url}" alt="第 ${i + 1} 张"><button type="button" class="cb-unattach" data-i="${i}" aria-label="去掉第 ${i + 1} 张">×</button></figure>`).join('');
    sync();
  }
  async function take(list) {
    const room = MAX_UP - picked.length;
    if (room <= 0) { say(`一次最多 ${MAX_UP} 张`, true); return; }
    const out = [];
    for (const f of [...list].slice(0, room)) {
      try { out.push(await (typeof f === 'string' ? srcToPng(f) : toPng(f))); } catch { /* 读不出来的跳过 */ }
    }
    if (!out.length) { say('这张图读不出来，换成系统截图「拷贝并删除」再粘贴试试', true); return; }
    picked = [...picked, ...out.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))];
    say('');
    renderPicked();
  }
  if (zone) {
    const file = $('.dk-mfile');
    $('.dk-mpick').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => { await take(file.files || []); file.value = ''; });
    // 剪贴板里有图片文件（系统截图）就直接拿；没有就不拦，等浏览器把图插进框里再从框里取
    zone.addEventListener('paste', (e) => {
      const files = clipboardImages(e.clipboardData);
      const srcs = files.length ? [] : htmlImageSrcs(e.clipboardData?.getData?.('text/html'));
      if (!files.length && !srcs.length) return;
      e.preventDefault();
      take(files.length ? files : srcs);
    });
    zone.addEventListener('beforeinput', (e) => { if (!/^insertFrom(Paste|Drop)/.test(e.inputType || '')) e.preventDefault(); }); // 只收图
    zone.addEventListener('input', async () => {
      const srcs = [...zone.querySelectorAll('img')].map((n) => n.src).filter(Boolean);
      const jobs = srcs.slice(0, Math.max(0, MAX_UP - picked.length)).map((src) => srcToPng(src).catch(() => null));
      const typed = !srcs.length && zone.textContent.trim();
      zone.innerHTML = '';
      if (!srcs.length) { if (typed) say('这个框只收图片，文字写在上面', true); return; }
      const blobs = (await Promise.all(jobs)).filter(Boolean);
      if (!blobs.length) { say('框里出现了图片，但读不出来。换成系统截图「拷贝并删除」再粘贴试试', true); return; }
      picked = [...picked, ...blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))];
      say('');
      renderPicked();
    });
    thumbs.addEventListener('click', (e) => {
      const b = e.target.closest('.cb-unattach');
      if (!b) return;
      const [gone] = picked.splice(Number(b.dataset.i), 1);
      if (gone) URL.revokeObjectURL(gone.url);
      renderPicked();
    });
  }

  save.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    sync();
    save.textContent = '正在记…';
    try {
      await onSave({ text: ta.value.trim(), blobs: picked.map((p) => p.blob), block: sel.value || null, verdict });
      picked.forEach((p) => setTimeout(() => URL.revokeObjectURL(p.url), 1000));
      picked = [];
      ta.value = '';
      verdict = '';
      box.querySelectorAll('.dk-mv').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      renderPicked();
      say('记下了，下一节课的课后报告里会列出来。');
    } catch (err) {
      say(err?.message || '没记上，再试一次', true);
    } finally {
      busy = false;
      save.textContent = '记下来';
      sync();
    }
  });
  return { refreshBlocks: fillBlocks };
}
