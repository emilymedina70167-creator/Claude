// 信心标定（docs/learning-plan.md 2.1）：作答组件第一次判出对错以后，底下出一行「这题有把握吗？ 有把握 / 没把握」。
// 点了记一条动作 sure（detail：{ sure, key, ok }），进证据；key 是课后报告里那道题的键（report.js 的 itemKey），报告、掌握按它对上。
// 不点就是不知道，不打扰：一道题只问一次，换到下一道题时没点的那行收起来。
// 两种最要紧的情况：错了但有把握（真误解，最该先处理）、对了但没把握（红线 5：不能算过）。
import { session } from './session.js';
import { itemKey } from './memory/report.js';
import { FEATURES } from './features.js';

// 页面能判对错的组件（作答记录里的 type）；猜想、代码、拖图、预测这些不问
const KINDS = new Set(['answer', 'practice', 'quiz', 'stepper', 'steps', 'cloze', 'errfind', 'parse', 'drill', 'chunk', 'link', 'recognize', 'findbug']);

/** 这条作答在报告里是哪道题（和 report.js 的 itemKey 对得上） */
export function sureKey(entry) {
  return itemKey({ src: 'record', comp: entry?.block ?? '', type: entry?.type, q: entry?.q ?? '', title: entry?.title ?? '', detail: entry?.detail });
}

/** 这条作答要不要问「有把握吗」：判出了对错、不是看答案 / 想不出来、这道题还没问过 */
export function wantsSure(entry, asked = new Set()) {
  if (FEATURES.confidence === false || !entry || !entry.block) return false;
  const type = String(entry.type || '').replace(/-try$/, '');
  if (!KINDS.has(type) || typeof entry.ok !== 'boolean' || entry.revealed || entry.giveup) return false;
  return !asked.has(sureKey(entry));
}

const asked = new Set();

function offer(entry, el) {
  if (!el?.isConnected || !session.sink || !wantsSure(entry, asked)) return;
  const key = sureKey(entry);
  asked.add(key);
  const host = el.querySelector(':scope > .widget > .w-body') || el;
  // 同一个组件里上一道题没点的那行收起来（steps 一步一问）
  host.querySelectorAll(':scope > .sure-ask:not(.is-done)').forEach((x) => x.remove());
  const box = document.createElement('div');
  box.className = 'sure-ask';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', '这题有没有把握');
  box.innerHTML = '<span class="sure-q">这题有把握吗？</span><button type="button" class="btn sure-btn" data-sure="1">有把握</button><button type="button" class="btn sure-btn" data-sure="0">没把握</button>';
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.sure-btn');
    if (!b || box.classList.contains('is-done')) return;
    const sure = b.dataset.sure === '1';
    session.event('sure', el, { sure, key, ok: entry.ok, title: entry.title || undefined });
    box.classList.add('is-done');
    box.innerHTML = `<span class="sure-q">记下了：${sure ? '有把握' : '没把握'}${!sure && entry.ok ? '（这题先不算过，再来一道同类的）' : ''}</span>`;
  });
  host.appendChild(box);
}

// 接在 session.record 后面（session.js 的 hooks）：组件不用各自加
session.hooks.push(offer);
