// 草稿：学生在黑板上写了、还没点「检查」「提交」的东西（填了一半的格子、打了字的理由框、多选题勾了还没提交……）。
// 组件用 markDraft 登记「现在写着什么」；课堂模式发下一轮时一起告诉老师，学生不点检查老师也看得到。

/** el：放草稿的那个元素（作答区、理由框）；read()：返回现在写着的文字，没写或已经交了就返回 ''。 */
export function markDraft(el, read) {
  el.dataset.draft = '';
  el._draft = read;
}

const MAX = 600;

function hiddenWithin(el, block) {
  for (let x = el; x && x !== block.parentElement; x = x.parentElement) if (x.hidden) return true;
  return false;
}

/** 一个组件里所有的草稿：[{ el, label, text }]。label 是组件里的哪一处（steps 的「第 2 步」），没有就是 '' */
export function draftsIn(block) {
  if (!block?.querySelectorAll) return [];
  const els = [...(block.matches?.('[data-draft]') ? [block] : []), ...block.querySelectorAll('[data-draft]')];
  const out = [];
  for (const el of els) {
    // 组件里收起来的部分（还没到的步骤）不算；整块板翻走了（板是 hidden）照样算：学生可能翻回去看了一眼旧板
    if (typeof el._draft !== 'function' || hiddenWithin(el, block)) continue;
    let text = '';
    try { text = String(el._draft() ?? '').trim(); } catch { text = ''; }
    if (!text) continue;
    const n = el.closest('.st-item')?.querySelector('.st-n')?.textContent?.trim();
    out.push({ el, label: n ? `第 ${n} 步` : '', text: text.length > MAX ? text.slice(0, MAX) + '…' : text });
  }
  return out;
}
