// 证据 → 每一块的作答序列（给 K）和复习序列（给 R）（spec 6.2）。
// 判对错照掌握的那一套（mastery.js 的 cleanItem / failItem），保证测量和掌握说的是同一件事；
// 一道题只看第一次碰到的那一次（再做是记住了题，规则 rule-rev-2），原题再做不算。纯函数。
import { itemsOf } from '../memory/report.js';
import { retagEvidence } from '../memory/skills.js';
import { markFresh, isOriginal, cleanItem, failItem } from '../memory/mastery.js';
import { toDate } from '../memory/schema.js';

const list = (v) => (Array.isArray(v) ? v : []);
const blockOf = (t) => String(t || '').split('#')[0];
const same = (k) => String(k).split('§').pop();
const isBlock = (b) => b?.level === 'block' || String(b?.id || '').replace(/^[A-Z]{2}-/, '').split('.').length === 3;

/** 真题级：原题（exam=）、教研室对标出的新题（like= 且 d-lab-）、真题做成的练习（d-q-） */
const levelOf = (it) => (it.exam || (it.like && /^d-lab-/.test(String(it.comp || ''))) || /^d-q-/.test(String(it.comp || '')) ? 'exam' : 'class');

/**
 * Map<块, { obs: [{ day, ok, level, g }], reviews: [{ day, ok }], taught }>。
 * 只有课程地图里有的块；asOf（毫秒）只看那以前的证据。
 */
export function blockEvidence(mem = {}, { asOf = null } = {}) {
  const blocks = list(mem.curriculum).filter((b) => b?.id && b.status !== 'void' && isBlock(b)).map((b) => String(b.id));
  const known = new Set(blocks);
  const out = new Map(blocks.map((b) => [b, { obs: [], reviews: [], taught: false }]));
  const evs0 = list(mem.evidence).filter((e) => e && (e.src === 'record' || e.src === 'event') && (asOf == null || Number(e.at) <= asOf));
  const evs = retagEvidence(evs0, list(mem.sessions));
  const items = markFresh(itemsOf(evs, new Map(), { bySession: true }));
  const seen = new Map(); // 块 → 见过的题
  const lastReview = new Map(); // 块 → { session, day }
  for (const it of items) {
    const ok = cleanItem(it) ? true : failItem(it) ? false : null;
    const day = toDate(it.first || it.end || 0);
    for (const b of new Set(list(it.tags).map(blockOf).filter((t) => known.has(t)))) {
      const slot = out.get(b);
      if (ok === null) continue;
      slot.taught = true;
      // 复习：每节课第一道判得出的题；同一天只留第一节
      const lr = lastReview.get(b);
      if (!lr || (lr.session !== it.session && lr.day !== day)) {
        slot.reviews.push({ day, ok });
        lastReview.set(b, { session: it.session, day });
      }
      if (isOriginal(it)) continue;
      const s = seen.get(b) || seen.set(b, new Set()).get(b);
      const k = same(it.key);
      if (s.has(k)) continue;
      s.add(k);
      slot.obs.push({ day, ok, level: levelOf(it), g: it.kind === 'quiz' ? 0.25 : 0 });
    }
  }
  for (const s of list(mem.sessions)) if (s?.block && out.has(String(s.block)) && (asOf == null || (Number(s.startedAt) || 0) <= asOf)) out.get(String(s.block)).taught = true;
  return out;
}
