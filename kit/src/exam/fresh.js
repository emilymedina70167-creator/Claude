// 过时（docs/exam-plan.md 第三节、第六节）：画像、映射各自记着上游的指纹，上游一变就知道过时了，交给教研室重写、体检记一笔，
// 不靠人记得去改。纯函数，有测试（tests/exam-block.test.js）。
import { mapSig } from './mapping.js';
import { usable } from './reserve.js';

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

/** 一个考点的画像的上游：挂在它下面能用的题的编号、每道题标签改过几次、留作模考的年份（年份变了画像也要重写：引的题可能不能用了） */
export const profileSrc = (sylId, questions = [], years = []) => hash(`${[...years].sort().join(',')}#${questions.filter((q) => (q.tags?.syl || []).includes(sylId) && usable(q, years)).map((q) => `${q.id}:${(q.tagLog || []).length}`).sort().join('|')}`);

/** 要（重）写画像的考点：有题、却没有画像或画像的上游对不上的 */
export function staleProfiles(profiles = [], questions = [], syllabus = [], years = []) {
  const by = new Map(profiles.map((p) => [p.id, p]));
  return syllabus.filter((n) => n.status !== 'void' && questions.some((q) => (q.tags?.syl || []).includes(n.id) && usable(q, years)))
    .filter((n) => by.get(n.id)?.src !== profileSrc(n.id, questions, years)).map((n) => n.id);
}

/** 映射过时的考点：挂了块，可是挂的时候课程地图的指纹和现在的不一样（块改过标题、换过编号） */
export function staleMaps(syllabus = [], curriculum = []) {
  const sig = new Map();
  return syllabus.filter((n) => n.status !== 'void' && (n.blocks || []).length).filter((n) => {
    if (!sig.has(n.course)) sig.set(n.course, mapSig(curriculum, n.course));
    return n.mapSig !== sig.get(n.course);
  }).map((n) => n.id);
}
