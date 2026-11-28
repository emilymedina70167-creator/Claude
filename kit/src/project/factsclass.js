// 课堂里也写 meta/facts：学生从入口链接（#课号）直接进课时首页的代码不跑，这份事实就停在上一次开首页的那天
// （2026-11-24 到 11-28 四天上了课没变过），上课的 Claude 开课读到的到期数、最近一节都是旧的。
// 算法就是首页那一份（facts.js），这里只管「够不够算」。纯函数，tests/project-facts-class.test.js。
import { factsDoc } from './facts.js';

/** 算这份事实要读全的几类（课堂里记忆是一类一类订阅到的） */
export const FACTS_NEED = ['reviews', 'recall', 'sessions', 'absorb'];

/**
 * mem：课堂订阅着的记忆；loaded：已经读到的类；probes：题库（课堂不订阅它，另读一次；null 是还没读到）；
 * prev：库里现在那份 meta/facts（体检、后台活课堂里不重算，沿用它的）。
 * 返回要写的文档（不带 at）；还不够算返回 null。
 */
export function classFacts({ mem = {}, loaded = new Set(), probes = null, today = '', prev = null } = {}) {
  if (!today || !Array.isArray(probes) || FACTS_NEED.some((c) => !loaded.has(c))) return null;
  const f = factsDoc({ ...mem, probes }, today, { health: Number(prev?.health) || 0 });
  return prev?.jobs ? { ...f, jobs: prev.jobs } : f;
}
