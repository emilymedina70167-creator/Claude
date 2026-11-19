// 检验的模板（外部 review 的可选那条）：题里写了 pick / where 的，每用一次另取一组数（spec.js 的 drawProbe）。
// 开检验那一刻（mountCheck、classcheck.start、复测）把一条 check 里的模板全取好数：之后存进进度的就是取好数的，刷新、改判都照它，
// 数不会在学生写到一半时变。不碰 DOM，tests/check-template.test.js。
//
// 局部 id：模板排进 block / spare 的那一次叫它自己（p1），retry 里每多用一次叫 p1~2、p1~3（只当 retry 用的，第一次叫它自己）。
// 每一道取好数的题 src 还是模板的原文：题库编号照旧（见过一次就算见过：换数不算新题，rule-rev-2）。
import { drawProbe, probeProblems } from './spec.js';

export const DRAW_TRIES = 20; // 一道取了数自检不过（某一组数下 example 不满足、\calc 算不出来），最多重取几次

/** 一条 check 里的模板都取好数：返回 { check（没有模板的原样还回去）, errors } */
export function materialize(check, { base = {}, rand = Math.random } = {}) {
  const P = check.probes;
  if (!check.order.some((id) => P[id]?.tpl)) return { check, errors: [] };
  const errors = [];
  const placed = new Set([...check.blocks.flatMap((b) => [...b.must, ...b.optional]), ...(check.spare || [])]);
  const count = {};
  const useId = (id) => { const n = (count[id] = (count[id] || 0) + 1); return n === 1 ? id : `${id}~${n}`; };
  for (const id of check.order) if (P[id].tpl && placed.has(id)) useId(id); // 排进去的那一次先占它自己的 id
  const extra = {}; // 模板 → [{ id, of }]（retry 里多用的几次）
  const retry = {};
  for (const pid of check.order) {
    retry[pid] = P[pid].retry.map((r) => {
      if (!P[r]?.tpl) return r;
      const u = useId(r);
      if (u !== r) (extra[r] ||= []).push({ id: u, of: pid });
      return u;
    });
  }
  const probes = {};
  const order = [];
  for (const pid of check.order) {
    const p = P[pid];
    if (!p.tpl) { probes[pid] = { ...p, retry: retry[pid] }; order.push(pid); continue; }
    if (!count[pid]) { probes[pid] = p; order.push(pid); continue; } // 没人用（自检会报）：原样留着
    let avoid = null;
    const draw = (id) => {
      let last = null;
      for (let k = 0; k < DRAW_TRIES; k++) {
        try { last = drawProbe(p, { base, rand, avoid }); } catch (e) { errors.push(`${id}：${e.message}`); return null; }
        const bad = [...last.probe.calcErrors, ...probeProblems(last.probe, base)];
        if (!bad.length) break;
        if (k === DRAW_TRIES - 1) errors.push(`${id}（取 ${last.picked} 时）的 ${bad[0]}`);
      }
      avoid = last.raw;
      return last.probe;
    };
    const first = draw(pid);
    if (first) { probes[pid] = { ...first, id: pid, retry: placed.has(pid) ? retry[pid] : [] }; order.push(pid); }
    for (const x of extra[pid] || []) {
      const inst = draw(x.id);
      if (inst) { probes[x.id] = { ...inst, id: x.id, retry: [], block: P[x.of].block || inst.block }; order.push(x.id); }
    }
  }
  return { check: { ...check, probes, order }, errors };
}
