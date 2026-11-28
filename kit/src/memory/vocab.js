// 生词本：课上点开看过意思的词（gloss 组件，证据里 kind: gloss），下课写报告时页面收进记忆点（recall），
// 和别的要背的一样按 1 → 3 → 7 → 14 → 30 天在首页「要记的」里想一遍。纯函数，有测试（tests/english-gloss.test.js）。
// 不调用 Claude；同一个词已经在记的不再加；一节课最多 VOCAB_PER_SESSION 个（点得太多多半是在随手点，不全收）。
import { toDate } from './schema.js';
import { nextRecallId } from './recall.js';
import { spaceOfId } from './space.js';

export const VOCAB_PER_SESSION = 20;
const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const key = (w) => String(w ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** 这节课点开过的生词（按先后，一个词一条）：[{ word, gloss, ev }] */
export function glossedWords(evidence = [], sid = '') {
  const out = new Map();
  for (const e of [...evidence].filter((x) => x && x.src === 'event' && x.kind === 'gloss' && (!sid || x.session === sid)).sort((a, b) => (a.at || 0) - (b.at || 0))) {
    const d = e.detail && typeof e.detail === 'object' ? e.detail : e;
    const word = cut(d.word, 60);
    if (!word || out.has(key(word))) continue;
    out.set(key(word), { word, gloss: cut(d.gloss, 120), ev: e.id });
  }
  return [...out.values()];
}

/**
 * 要新加的记忆点：[{ id, doc }]。recall：现有的全部记忆点（编号不撞、同一个词不重复加：作废了的不算）；
 * session：sessions/{编号}（带 id、block、space）
 */
export function vocabRecalls({ evidence = [], recall = [], session = {}, now = Date.now() } = {}) {
  const sid = String(session.id || '');
  const have = new Set(recall.filter((d) => d && d.status !== 'void').map((d) => key(d.kind === 'word' ? d.q : '')).filter(Boolean));
  const date = toDate(now);
  const block = session.block || null;
  const space = session.space || (block ? spaceOfId(block) : 'en');
  const out = [];
  let all = [...recall];
  for (const w of glossedWords(evidence, sid)) {
    if (out.length >= VOCAB_PER_SESSION) break;
    if (have.has(key(w.word))) continue;
    have.add(key(w.word));
    const id = nextRecallId(all);
    const doc = {
      q: w.word, a: w.gloss || '（课上点开看过，意思见那节课）', kind: 'word', tier: 1, last: date, lapses: 0, status: 'active', space,
      ...(block ? { block } : {}), ...(sid ? { session: sid } : {}), ...(w.ev ? { basis: [w.ev] } : {}),
      log: ['tier', 'last', 'status'].map((f) => ({ date, by: 'page', field: f, from: null, to: { tier: 1, last: date, status: 'active' }[f], basis: w.ev ? [w.ev] : [], note: '课上点开看过意思的生词' })),
    };
    out.push({ id, doc });
    all = [...all, { id }];
  }
  return out;
}

/**
 * 「以前的课」里那节课查过的生词，一个词一个：[{ word, gloss, in }]。in：已经在「要记的」里了（问法就是这个词、没作废的）。
 * 收不收由学生自己点（或主讲课后写），页面不替人定
 */
export function wordChips(words = [], recall = []) {
  const have = new Set((recall || []).filter((d) => d && d.status !== 'void').map((d) => key(d.q)));
  const seen = new Set();
  const out = [];
  for (const w of words || []) {
    const k = key(w?.word);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ word: cut(w.word, 60), gloss: cut(w.gloss, 120), in: have.has(k) });
  }
  return out;
}
