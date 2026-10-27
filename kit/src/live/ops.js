// 实时黑板的教具指令（ops 集合）里不碰 DOM 的部分：读懂一条指令、要等哪些目标画出来、结果写成一行、
// 刷新后按时间线把标注和图的状态放回去。纯函数，有测试（tests/live-ops.test.js）。
//
// ops/{id}：{ seq, cmd, body }。cmd 和课堂模式 board 块的第一行一样写，只收 mark / unmark / figure；
// body 是 mark 块里的多行。seq 和 steps 的 seq 是同一条序列（同一次 batch 里先写段、再写指令）。
// 段的指令（new / add / replace / hide / pin / unpin）不收：实时黑板写段用 steps。
import { blockCommand, SEGMENT_OPS } from '../class/protocol.js';

export const OP_KINDS = ['mark', 'unmark', 'figure'];
// 指令指向的段、组件还不在黑板上时最多等多久（同一次 batch 里段可能比指令晚到，或者还在画）
export const OP_WAIT = 5000;
// 新指令到了先等一小会儿再执行：同一次 batch 里改写的段（seq 不变）可能晚一步到，免得标在旧内容上又被擦掉
export const OP_SETTLE = 400;
// 黑板现状里留最近几条指令的结果
export const OPS_KEEP = 10;

const oneLine = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** 指令写在结果行里的样子：一行、去掉开头的 board、太长截短 */
export function cmdText(cmd) {
  return oneLine(String(cmd ?? '').replace(/^\s*board\s+/i, ''), 60);
}

/**
 * 读懂 ops 里的一条：doc = { id, seq, cmd, body }。
 * 返回 { id, seq, cmd, body, op } 或 { id, seq, cmd, body, error }（error 是写进黑板现状的中文原因）。
 * 抄课堂写法时多写的 board、围栏的反引号都认。
 */
export function parseLiveOp(doc) {
  const id = String(doc?.id ?? '');
  const seq = Number(doc?.seq);
  const raw = String(doc?.cmd ?? '');
  const body = String(doc?.body ?? '');
  const base = { id, seq: Number.isFinite(seq) ? seq : 0, cmd: cmdText(raw), body };
  const head = raw.replace(/^\s*[`~]{3,}\s*/, '').replace(/^\s*board\s+/i, '').replace(/\s*[`~]{3,}\s*$/, '').trim();
  if (!head) return { ...base, error: 'cmd 是空的：写 mark …、unmark … 或 figure target=… set / play / highlight …' };
  if (!Number.isFinite(seq)) return { ...base, error: '缺少 seq（和 steps 共用一条序列的数字），页面不知道它排在哪' };
  const name = head.split(/\s+/)[0].toLowerCase();
  if (SEGMENT_OPS.includes(name)) return { ...base, error: `${name} 是写段的指令，ops 里不收：段用 steps 写，新的一段 set 一个 steps 文档，改它用 update，撤回写 hidden: true` };
  if (!OP_KINDS.includes(name)) return { ...base, error: `看不懂的指令「${head.split(/\s+/)[0].slice(0, 20)}」：ops 里只收 mark / unmark / figure` };
  const op = blockCommand(head, body);
  if (op.error) return { ...base, error: op.error };
  return { ...base, op };
}

/** 一条指令要等哪些东西画出来（段的 id 或组件的 id:）。unmark 不用等：擦的是已经画上的 */
export function opTargets(op) {
  if (!op) return [];
  if (op.op === 'figure') return [op.target];
  if (op.op === 'mark') return [...new Set((op.marks || []).map((m) => m.target).filter(Boolean))];
  return [];
}

/** 还没执行的指令，按 seq（一样时按 id）排好。done：执行过的 id（Set），或者 (doc) => 执行过没有 */
export function nextOps(docs, done = new Set()) {
  const isDone = typeof done === 'function' ? done : (d) => done.has(String(d.id));
  return (docs || []).filter((d) => d && d.id !== undefined && !isDone(d))
    .slice().sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0) || (String(a.id) > String(b.id) ? 1 : String(a.id) < String(b.id) ? -1 : 0));
}

/**
 * 一条指令的结果，写进黑板现状的 ops（一行）：
 *   o7 mark target=s3：画上了 m2
 *   o8 figure target=m-prod play t：没执行（m-prod 在第 2 块板上，不在当前板上……）
 * res：执行结果（boardtools.js 的 markOp / unmarkOp / figureOp 返回的那样），或 { ok: false, error }；notes：附带的提醒
 */
export function resultLine(id, cmd, res, notes = []) {
  const head = `${id} ${cmdText(cmd)}`;
  const tail = notes.length ? `；${notes.join('；')}` : '';
  if (!res?.ok) return oneLine(`${head}：没执行（${res?.error || '不知道为什么'}）${tail}`, 300);
  let what = '执行了';
  if (res.op === 'mark') what = `画上了 ${(res.marks || []).map((m) => m.id).join('、')}`;
  else if (res.op === 'unmark') what = res.ids?.length ? `擦掉了 ${res.ids.join('、')}` : '板上没有标注，没擦什么';
  else if (res.op === 'figure') what = res.action === 'play' && res.jumped ? '执行了（学生在看旧板，直接跳到了终点）' : '执行了';
  const part = res.error ? `；没画上的：${res.error}` : '';
  return oneLine(`${head}：${what}${part}${tail}`, 300);
}

// 短指纹（FNV-1a）：只用来比「变没变」
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** 一段现在的样子（板、位置、标题、内容）的指纹：标注记下标的时候段是什么样，刷新后段变了就不再放回去 */
export function segSig({ page = 0, place = 'board', title = '', md = '' } = {}) {
  return hash(`${Number(page) || 0}|${place}|${title}|${md}`);
}

/** 一条指令这一版的指纹：同一个 doc_id 被改写成别的指令（改错），算一条新的、再执行一次 */
export function opKey(doc) {
  return hash(`${Number(doc?.seq) || 0}|${String(doc?.cmd ?? '')}|${String(doc?.body ?? '')}`);
}

/**
 * 刷新后要放回去的东西。recs：页面执行过的指令（ops_done 里的记录）：
 *   { id, seq, kind: 'mark', marks: [{ id, seg, spec, sig }] } / { kind: 'unmark', ids: [] } /
 *   { kind: 'figure', action, target, args, seg, sig }（只记执行成功的 set / play）
 * sigOf(段 id)：段现在的指纹（段撤回了、没有了是 undefined）。
 * 返回 { marks: [{ id, seg, spec }]（现在还在的标注，按标的先后）, figures: [{ target, action, args }]（按先后）, ids: [用过的标注 id] }
 */
export function restorePlan(recs, sigOf = () => undefined) {
  const list = (recs || []).filter(Boolean).slice().sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0) || (Number(a.at) || 0) - (Number(b.at) || 0));
  const kept = new Map();
  const figures = [];
  const ids = [];
  for (const r of list) {
    if (r.kind === 'mark') {
      for (const m of r.marks || []) {
        if (!m?.id || !m.spec) continue;
        ids.push(m.id);
        kept.delete(m.id); // 同一个 id 再标一次：排到最后
        kept.set(m.id, m);
      }
    } else if (r.kind === 'unmark') {
      for (const id of r.ids || []) kept.delete(id);
    } else if (r.kind === 'figure' && (r.action === 'set' || r.action === 'play') && r.target) {
      if (sigOf(r.seg) === r.sig) figures.push({ target: r.target, action: r.action, args: r.args || {} });
    }
  }
  // 标的时候段是一个样，现在变了（改了内容、挪了板、撤回了）：标注指着的东西已经不在了
  const marks = [...kept.values()].filter((m) => m.sig !== undefined && sigOf(m.seg) === m.sig).map((m) => ({ id: m.id, seg: m.seg, spec: m.spec }));
  return { marks, figures, ids };
}
