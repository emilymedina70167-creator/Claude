// 检验的题库和复测（设计 5.5、5.6；外部 review 必改 1）。不碰 DOM，tests/check-bank.test.js。
//
// 题库 probes/{pr-…}：board check 执行时页面把里面每道题（含 retry、spare）存进去，同一道题（去掉局部 id 以后原文一样）一个编号。
// retry: 写的是一次检验里的局部 id（p1a），换了检验就对不上、不同检验的 p1 还会撞：存进题库时改存成题库编号 retryBank。
// 复测从题库拼一条 check：题连它的 retryBank 一起取出来，局部 id 重起（r1、r1a、r1b、r2…），证据里记 bank（题库编号）。
import { parseCheck, selfCheck } from './spec.js';

export const RETEST_DAYS = [1, 7];

/** 一道题的围栏原文（存进题库的就是它） */
export const fenceOf = (probe) => `\`\`\`${probe.type}\n${String(probe.src ?? '').replace(/\s+$/, '')}\n\`\`\``;

// 认「同一道题」：去掉 id:、retry: 两行（局部的），每行去掉行尾空白
const normal = (fence) => String(fence ?? '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => !/^\s*(id|retry)\s*[:：]/.test(l)).join('\n').trim();

function fnv(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** 题库编号：pr- + 12 位十六进制（两个 FNV-1a 拼起来） */
export function bankId(fence) {
  const s = normal(fence);
  const a = fnv(s, 2166136261).toString(16).padStart(8, '0');
  const b = fnv(s, 0x811c9dc5 ^ 0x5bd1e995).toString(16).padStart(8, '0').slice(0, 4);
  return `pr-${a}${b}`;
}

// 题里用到的课上的量（let 块定义的，不是题自己 let、pick 的）：存进题库时抄下来，复测时当这道题自己带的量（probe.base，
// 在 pick 之前就有：pick k = int(1, n) 的 n 也取得到；复测那一页没有那节课的量）。
// 值是浮点（检验本来就按浮点判，和 base 一样）；带参数的（Sym）、算不出 JSON 的不抄，复测那道照实自检不过、拿掉
function lessonLets(probe, base = {}) {
  const own = new Set([...(probe.lets || []).map((l) => l.name), ...(probe.tpl?.picks || []).map((x) => x.name)]);
  const used = new Set(String(probe.src ?? '').match(/[A-Za-z_]\w*/g) || []);
  const out = {};
  for (const name of Object.keys(base || {}).sort()) {
    if (own.has(name) || !used.has(name)) continue;
    const v = base[name];
    const ok = (x) => (Array.isArray(x) ? x.every(ok) : typeof x === 'number' && Number.isFinite(x));
    if (ok(v)) out[name] = JSON.stringify(v);
  }
  return out;
}

/** 一次检验里的每道题 → 题库的文档：[{ id, doc }]。base：这节课 let 的量（浮点，classcheck.js 给） */
export function bankDocs(check, { session = null, at = Date.now(), base = {} } = {}) {
  const placed = new Set(check.blocks.flatMap((b) => [...b.must, ...b.optional]));
  const spare = new Set(check.spare || []);
  const idOf = Object.fromEntries(check.order.map((pid) => [pid, bankId(fenceOf(check.probes[pid]))]));
  return check.order.map((pid) => {
    const p = check.probes[pid];
    const as = placed.has(pid) ? 'probe' : spare.has(pid) ? 'spare' : 'retry';
    return {
      id: idOf[pid],
      doc: {
        fence: fenceOf(p), type: p.type, block: p.block, target: p.target, level: p.level, facet: p.facet, family: p.family,
        ...(Object.keys(lessonLets(p, base)).length ? { lets: lessonLets(p, base) } : {}),
        retryBank: p.retry.map((r) => idOf[r]).filter(Boolean),
        src: 'ext', from: { session, check: check.id, as }, seen: [], at,
      },
    };
  });
}

/** 学生见过这道题一次：追加一条 seen */
export const seenPatch = (doc, { session = null, at = Date.now(), as = 'first' } = {}) => ({ seen: [...(Array.isArray(doc?.seen) ? doc.seen : []), { at, session, as }] });

const addDays = (date, n) => {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** 检验那天 → 两次复测（1 天、7 天） */
export const retestDates = (today) => RETEST_DAYS.map((days) => ({ days, due: addDays(today, days), done: null }));

/** 到期的复测：每块只取最早一次还没做的 → [{ block, days, due }] */
export function dueRetests(absorbs = [], today) {
  const out = [];
  for (const a of absorbs || []) {
    const r = (a?.retests || []).filter((x) => !x.done).sort((x, y) => String(x.due).localeCompare(String(y.due)))[0];
    if (r && String(r.due) <= String(today)) out.push({ block: a.block, days: r.days, due: r.due });
  }
  return out;
}

const unseen = (d) => !(Array.isArray(d.seen) && d.seen.length) && !d.broken;

/**
 * 给到期的块挑题：每个 family 一道没见过的（不挑这块最新一次检验里的 retry：同构小题测掌握偏弱）；retryOwed 先放（外部改判以后欠着的）。
 * 返回 { items: [题库编号], missing: [{ block, family, why }] }
 */
export function pickRetest({ due = [], bank = [], absorbs = [] } = {}) {
  const items = [], missing = [];
  const byId = new Map(bank.map((d) => [d.id, d]));
  for (const d of due) {
    const a = absorbs.find((x) => x.block === d.block);
    if (!a) continue;
    const covered = new Set();
    for (const id of a.retryOwed || []) {
      const doc = byId.get(id);
      if (doc && unseen(doc) && !items.includes(id)) { items.push(id); covered.add(doc.family); }
    }
    for (const fam of a.families || []) {
      if (covered.has(fam)) continue;
      const cand = bank.find((x) => x.family === fam && unseen(x) && !items.includes(x.id)
        && !(x.from?.as === 'retry' && x.from?.check === a.check && x.from?.session === a.session));
      if (cand) items.push(cand.id);
      else missing.push({ block: d.block, family: fam, why: '题库里没有没见过的同类题' });
    }
  }
  return { items, missing };
}

// 改写围栏里的 id:、retry: 两行
function rewrite(fence, id, retry) {
  const lines = String(fence).split('\n').filter((l) => !/^\s*retry\s*[:：]/.test(l)).map((l) => (/^\s*id\s*[:：]/.test(l) ? `id: ${id}` : l));
  if (retry.length) lines.splice(lines.length - 1, 0, `retry: ${retry.join(', ')}`);
  return lines.join('\n');
}

// 题库里存的 lets（{ 名字: JSON 文字 }）→ 值；读不了的那一个不要（自检照实报算不出来）
const basesOfDoc = (doc) => Object.fromEntries(Object.entries(doc?.lets || {}).flatMap(([k, v]) => { try { return [[k, JSON.parse(v)]]; } catch { return []; } }));

/** 复测拼出来的 check：每道题挂上它自己带的课上的量（retestCheck 回的 bases：{ 局部 id: { 名字: 值 } }） */
export function attachBases(check, bases = {}) {
  if (!check) return check;
  for (const [id, b] of Object.entries(bases || {})) if (check.probes[id] && Object.keys(b).length) check.probes[id].base = b;
  return check;
}

/**
 * 复测拼一条 check：每道挑出来的题连它的 retryBank 一起取，局部 id 重起；每道单独过一遍写法和自检，不过的连它的 retry 拿掉记 dropped。
 * retests：[{ block, days }]（block 行照它们，题照题库里写的块）。返回 { head, body, bankOf: { 局部 id: 题库编号 }, bases（每道题带的课上的量，attachBases 挂上）, dropped: [{ id, why }] }
 */
export function retestCheck({ id = 'rt', title = '复测', items = [], bank = [], retests = [] } = {}) {
  const byId = new Map(bank.map((d) => [d.id, d]));
  const dropped = [];
  const kept = []; // { block, local, fences, map }
  let k = 0;
  for (const bid of items) {
    const doc = byId.get(bid);
    if (!doc) { dropped.push({ id: bid, why: `题库里没有 ${bid}` }); continue; }
    const lost = (doc.retryBank || []).filter((r) => !byId.has(r));
    if (lost.length) { dropped.push({ id: bid, why: `retry 的 ${lost.join('、')} 题库里没有` }); continue; }
    const local = `r${k + 1}`;
    const rids = (doc.retryBank || []).map((_, i) => `${local}${String.fromCharCode(97 + i)}`);
    const fences = [rewrite(doc.fence, local, rids), ...(doc.retryBank || []).map((r, i) => rewrite(byId.get(r).fence, rids[i], []))];
    const map = { [local]: bid, ...Object.fromEntries((doc.retryBank || []).map((r, i) => [rids[i], r])) };
    const bases = { [local]: basesOfDoc(doc), ...Object.fromEntries((doc.retryBank || []).map((r, i) => [rids[i], basesOfDoc(byId.get(r))])) };
    const block = doc.block;
    const one = parseCheck(`check id=${id}`, [`block ${block} must=${local}`, ...fences].join('\n'));
    const errs = [...one.errors, ...(one.check ? selfCheck(attachBases(one.check, bases), {}, { lenient: true }) : [])];
    if (errs.length) { dropped.push({ id: bid, why: errs[0] }); continue; }
    kept.push({ block, local, fences, map, bases });
    k++;
  }
  const blocks = [...new Set([...retests.map((r) => r.block), ...kept.map((x) => x.block)])].filter((b) => kept.some((x) => x.block === b));
  const body = [
    ...blocks.map((b) => `block ${b} must=${kept.filter((x) => x.block === b).map((x) => x.local).join(',')}`),
    ...kept.flatMap((x) => x.fences),
  ].join('\n');
  return { head: `check id=${id} title="${String(title).replace(/"/g, '')}"`, body, bankOf: Object.assign({}, ...kept.map((x) => x.map)), bases: Object.assign({}, ...kept.map((x) => x.bases)), dropped };
}
