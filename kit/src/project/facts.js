// 页面能算的事实（第十五轮，外部主 Claude 的修改意见 3.5、3.6）：写进 meta/facts，谁要谁读，不调用 Claude。
// 只是数，不写建议、不排先后。纯函数，tests/project-facts.test.js。
import { dueList, addDays } from '../memory/schema.js';
import { SPACE_KEYS, spaceOfDoc, spaceOfId } from '../memory/space.js';
import { recallToday } from '../memory/recall.js';
import { dueRetests, pickRetest } from '../check/bank.js';

/**
 * data：学习台的数据（reviews、recall、sessions）；today：YYYY-MM-DD（上海时间）；health：体检拿不准的几条（meta/health 的 notes 数）
 * 返回 { today, spaces: { 科: { due, recall, open, minutes7, last } }, health }
 */
export function factsDoc(data = {}, today, { health = 0 } = {}) {
  const spaces = Object.fromEntries(SPACE_KEYS.map((k) => [k, { due: [], recall: 0, open: [], minutes7: 0, last: null, retest: [], missing: [] }]));
  const at = (k) => spaces[k] || spaces[SPACE_KEYS[0]];
  for (const d of dueList(data.reviews || [], today).filter((x) => x.days <= 0)) {
    const r = (data.reviews || []).find((x) => String(x.id) === d.id);
    at(spaceOfDoc('reviews', r, data)).due.push({ id: d.id, title: d.title, days: d.days });
  }
  for (const [k, n] of Object.entries(recallToday(data.recall || [], { today, n: 1e9 }).bySpace || {})) at(k).recall = n;
  // 检验以后的复测（check/bank.js）：到期的块、挑不到没见过的同类题的（缺新题）
  const retest = dueRetests(data.absorb || [], today);
  const sp = (b) => { try { return spaceOfId(b); } catch { return SPACE_KEYS[0]; } };
  for (const r of retest) at(sp(r.block)).retest.push(r);
  if (retest.length) for (const m of pickRetest({ due: retest, bank: data.probes || [], absorbs: data.absorb || [] }).missing) at(sp(m.block)).missing.push({ block: m.block, family: m.family });
  const from = addDays(today, -6);
  const sessions = (data.sessions || []).filter((s) => s && !s.deleting);
  for (const s of sessions) {
    const sp = at(spaceOfDoc('sessions', s, data));
    if (s.status === 'open') sp.open.push({ id: s.id, title: s.title || '', date: s.date || '' });
    if (s.date >= from && s.date <= today) sp.minutes7 += Math.round((Number(s.report?.activeMs) || 0) / 60000);
  }
  for (const k of SPACE_KEYS) {
    const last = sessions.filter((s) => s.status === 'closed' && s.kind !== 'drill' && spaceOfDoc('sessions', s, data) === k).sort((a, b) => (Number(b.endedAt) || 0) - (Number(a.endedAt) || 0))[0];
    if (last) spaces[k].last = { id: last.id, title: last.title || '', date: last.date || '' };
  }
  return { today, spaces, health: Number(health) || 0 };
}
