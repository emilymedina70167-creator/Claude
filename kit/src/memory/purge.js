// 删掉一节课（学习台「以前的课」、首页没下课的那一行）：开了很多测试的课，要能删干净。纯函数，有测试（tests/memory-purge.test.js）。
//
// 删什么：这节课本身（sessions/{编号} 和它下面的黑板、对话、资料包、报告……，SESSION_SCOPED）、它的证据、
// 这节课记下的观察、失误、改动单、抄进题库的题、这节课记的错题。
// 留什么（删了别处会断）：
// - 守则（lessons）归纳时用到的失误：守则还指着它
// - 还挂在弱点上、或者被别的错题更正（corrects）指着的错题
// - 这节课新建、改过的弱点、复现组、守则、规则、偏好、位置：它们是记忆本身，不只属于这一节；不对在「我改记忆」里改
// - 掌握：页面按剩下的证据接着算（页面自己算出来的结论会按新的证据重算）
import { SESSION_SCOPED } from './session.js';

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
const of = (mem, c) => (Array.isArray(mem?.[c]) ? mem[c] : []).filter((d) => d && d.id !== undefined && d.id !== null);

/**
 * mem：整个记忆库（desk.js 的 data）；sid：要删的课。
 * 返回 { docs: ['evidence/ev-…', …]（记忆库里要删的文档）, scoped: ['steps', …]（sessions/{sid}/ 下面要清空的集合）,
 *   kept: [{ path, why }]（这节课记的、但留着的）, unlink: [{ path, doc }]（留着的、要去掉课号重写的，doc 不带 id）,
 *   counts: { 类: 条数 }, ledger: ['observations/ob-…']（自检指纹里要去掉的）}
 */
// keepWords（第十一轮）：这节课我说的话还没过完账（话的账没做成）——我说的话（src: say）先留着，别的照删，过完账下次再删
export function purgePlan(mem = {}, sid, { keepWords = false } = {}) {
  const id = String(sid || '');
  const docs = [];
  const kept = [];
  const counts = {};
  const del = (c, d) => { docs.push(`${c}/${d.id}`); counts[c] = (counts[c] || 0) + 1; };
  if (!id) return { docs, scoped: [], kept, counts, ledger: [] };
  const mine = (c, f = 'session') => of(mem, c).filter((d) => String(d[f] ?? '') === id);

  for (const d of mine('evidence')) {
    if (keepWords && d.src === 'say') kept.push({ path: `evidence/${d.id}`, why: '还没过账，我说的话先留着' });
    else del('evidence', d);
  }
  for (const d of mine('observations')) del('observations', d);
  for (const d of mine('pending')) del('pending', d);
  for (const d of mine('drills', 'fromSession')) del('drills', d);
  // 失误：守则（不管还用不用）指着的留着
  const inLessons = new Set(of(mem, 'lessons').flatMap((l) => list(l.slips)));
  // 留着的失误还写着这节课的编号：去掉（不然自检报「指向的课找不到」），原来是哪节课记在 wasSession
  const unlink = [];
  for (const d of mine('slips')) {
    if (inLessons.has(String(d.id))) {
      kept.push({ path: `slips/${d.id}`, why: '教学守则归纳时用到了' });
      const { id: _, session: __, ...rest } = d;
      unlink.push({ path: `slips/${d.id}`, doc: { ...rest, wasSession: id } });
    } else del('slips', d);
  }
  // 记忆点（这节课收的生词、要背的）留着，去掉课号（自检的 session 指向要查得到）
  for (const d of mine('recall')) {
    const { id: _, session: __, ...rest } = d;
    unlink.push({ path: `recall/${d.id}`, doc: { ...rest, wasSession: id } });
  }
  // 错题：弱点挂着的、别的错题更正指着的留着
  const errs = mine('errors');
  const gone = new Set(errs.map((e) => String(e.id)));
  const inWeak = new Set(of(mem, 'weaknesses').flatMap((w) => list(w.errors)));
  const corrected = new Set(of(mem, 'errors').filter((e) => !gone.has(String(e.id))).flatMap((e) => list(e.corrects)));
  for (const d of errs) {
    if (inWeak.has(String(d.id))) kept.push({ path: `errors/${d.id}`, why: '还挂在弱点上' });
    else if (corrected.has(String(d.id))) kept.push({ path: `errors/${d.id}`, why: '有别的错题更正它' });
    else del('errors', d);
  }
  docs.push(`sessions/${id}`);
  const ledger = docs.filter((p) => /^(errors|observations|slips)\//.test(p));
  return { docs, scoped: [...SESSION_SCOPED], kept, unlink, counts, ledger };
}

const LABEL = { evidence: '作答和说的话', observations: '老师的笔记', pending: '改动记录', drills: '题库里的题', slips: '教学失误', errors: '错题' };

/** 确认框里的那一段：删掉哪些、留下哪些 */
export function purgeText(plan, { title = '' } = {}) {
  const parts = Object.entries(plan.counts || {}).filter(([, n]) => n).map(([c, n]) => `${LABEL[c] || c} ${n} 条`);
  const lines = [`删掉「${title}」？`, `黑板、对话、课后报告一起删${parts.length ? `，还有${parts.join('、')}` : ''}。删了不能恢复（要留底先在「管理」里导出备份）。`];
  if (plan.kept?.length) lines.push(`留着 ${plan.kept.length} 条别处还用着的（${[...new Set(plan.kept.map((k) => k.why))].join('、')}）。`);
  return lines.join('\n');
}
