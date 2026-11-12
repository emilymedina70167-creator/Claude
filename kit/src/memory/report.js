// 课后报告（docs/desk-plan.md 3.1）：下课时由页面代码把这节课整理成一份 sessions/{编号}/report/main，不调用 Claude。
// 结果只由输入决定（同样的证据出同样的报告），纯函数，有测试（tests/memory-report.test.js）。
// 用处：课后整理、「以前的课」页面、外部的 Claude 课后只读这一份就够（不用把整节课的证据和课堂记录读一遍）。
//
// 输入：这节课的 sessions 文档、evidence（这节课的）、observations / slips（这节课的）、课堂轮次 class_turns、黑板的段 steps，
// 以及上一节课下课以后的补记（src: manual，不属于哪节课，跟着下一份报告一起看）。
import { sceneSpans } from '../stage/scenes.js';
import { lessonSheet } from './sheet.js';
import { usageOf } from '../class/usage.js';

// 2：试出来的选择题（guess）、版本号记进 sessions.report.v（旧版算的报告首页打开时按新的算法重算）
export const REPORT_VERSION = 2;
export const IDLE_GAP = 10 * 60 * 1000; // 两个动静之间超过 10 分钟：算走开了，不计进时长
export const REPORT_MAX = 200 * 1024; // 数据库一个文档最多 256 KiB，留点余量

const cut = (s, n) => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s === undefined || s === null ? '' : String(s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const byAt = (a, b) => (num(a.at) ?? 0) - (num(b.at) ?? 0) || String(a.id ?? '').localeCompare(String(b.id ?? ''));
const uniq = (xs) => [...new Set(xs.filter((x) => x !== undefined && x !== null && x !== ''))];

/** 一道题（一个作答组件里的一处）的键：组件 id + 「第几步」（steps、演示组件的每一步分开算），没有步就用题面 */
export function itemKey(ev) {
  // 舞台上的一问带着指纹（stage/evidence.js 的 askSig）：同一个空重问一次是同一道题（主线第七轮）
  if (ev.type === 'stage' && ev.sig) return `${ev.sig}|舞台`;
  const comp = String(ev.comp ?? '');
  // 一问一答的活板（type: huoban）：编号 L12 / L12.2 / L12#2 就是一道题（第几行、第几个控件、重开第几次）。
  // 题面 q 里带着行里活的值（现在 t = 2……），同一个空前后两次作答之间学生拨了一下，q 就不一样了，不能拿它分题
  if (ev.type === 'huoban' && /^L\d+(?:\.\d+)?(?:#\d+)?$/.test(comp)) return `${comp}|活板`;
  if (ev.src === 'event') {
    const k = num(ev.detail?.step);
    return k ? `${comp}|第 ${k} 步` : `${comp}|`;
  }
  const d = typeof ev.detail === 'string' ? ev.detail : '';
  const step = /第 \d+ 步/.exec(d)?.[0] || /第 \d+ 步/.exec(String(ev.q || ''))?.[0];
  return `${comp}|${step || cut(ev.q || ev.title || '', 60)}`;
}

/**
 * 一道题的结果：first（一次就对）/ ok（改了几次后对了）/ wrong（最后还是错的）/ giveup（想不出来）/ revealed（没做出来，看了答案）/
 * open（程序判不了对错的：猜想、自由写的理由）
 */
export const OUTCOMES = ['first', 'ok', 'wrong', 'giveup', 'revealed', 'open'];
export const OUTCOME_TEXT = { first: '一次对', ok: '改对了', wrong: '错', giveup: '想不出来', revealed: '看了答案', open: '没判' };

/**
 * 单选题把选项差不多试遍了才对（三个选项第二次才对、四个选项第三次才对）：这次「改对」证明不了会，是试出来的。
 * 选项数记在作答里（quiz 的 options）；旧的记录没有选项数，按试了三次以上算。多选题、填空不算
 */
export function guessed({ kind, multi, options, attempts, ok } = {}) {
  if (kind !== 'quiz' || multi || ok !== true) return false;
  const n = Number(attempts) || 0;
  const opts = Number(options) || 0;
  if (n < 2) return false;
  return opts >= 2 ? n >= opts - 1 : n >= 3;
}

const sureOf = (evs) => { const s = evs.filter((e) => e.kind === 'sure').at(-1); const v = s?.detail?.sure ?? s?.sure; return typeof v === 'boolean' ? v : null; };

function itemOf(key, list, segs) {
  const recs = list.filter((e) => e.src === 'record').sort(byAt);
  const evs = list.filter((e) => e.src === 'event').sort(byAt);
  const head = recs[0] || evs[0];
  const final = [...recs].reverse().find((r) => r.final);
  const judged = recs.filter((r) => !r.final && typeof r.ok === 'boolean');
  // 每次尝试的对错：有逐次的记录就用它；只有一条最终结果（选择题、预测）就按次数补出前面的错
  let tries = judged.map((r) => r.ok);
  if (!tries.length && typeof final?.ok === 'boolean') {
    const n = Math.max(1, num(final.attempts) || 1);
    tries = [...Array(n - 1).fill(false), final.ok];
  }
  if (!tries.length) tries = recs.filter((r) => typeof r.ok === 'boolean').map((r) => r.ok);
  const attempts = Math.max(tries.length, ...recs.map((r) => num(r.attempts) || 0));
  // 只记了最后一次（选择题点错的几次不单独记）：前面没记到的那几次都是错的
  if (tries.length && tries.length < attempts) tries = [...Array(attempts - tries.length).fill(false), ...tries];
  const giveup = recs.some((r) => r.giveup) || evs.some((e) => e.kind === 'giveup');
  const revealed = !giveup && (!!final?.revealed || (recs.some((r) => r.revealed) && !(final?.ok === true)));
  const lastOk = typeof final?.ok === 'boolean' ? final.ok : tries.length ? tries.at(-1) : null;
  const outcome = giveup ? 'giveup' : revealed ? 'revealed' : lastOk === true ? (tries[0] === true && attempts <= 1 ? 'first' : 'ok') : lastOk === false ? 'wrong' : 'open';
  const ms = Math.max(0, ...recs.map((r) => num(r.ms) || 0)) || null;
  const step = head?.step ?? null;
  const seg = step ? segs.get(String(step)) : null;
  const at = list.map((e) => num(e.at)).filter((x) => x !== null);
  return {
    key,
    comp: head?.comp ?? null,
    kind: String(recs[0]?.kind || head?.kind || ''),
    q: cut(recs.find((r) => r.q)?.q || recs[0]?.title || '', 120),
    seg: step,
    page: seg?.page ?? null,
    segTitle: seg?.title ? cut(seg.title, 60) : '',
    tags: uniq(list.flatMap((e) => (Array.isArray(e.tags) ? e.tags : []))),
    tries: tries.length,
    attempts,
    seq: tries.map((ok) => (ok ? '✓' : '✗')).join(''),
    outcome,
    ...(outcome === 'ok' && guessed({ ...(final || recs.at(-1) || {}), kind: String(recs[0]?.kind || ''), ok: true, attempts }) ? { guess: true } : {}),
    final: !!final,
    giveup,
    revealed,
    reveals: evs.filter((e) => e.kind === 'reveal').length,
    // 有没有把握（学生点的，最后一次为准）：true / false / null（没点）
    sure: sureOf(evs),
    ms,
    last: cut(final?.last ?? recs.at(-1)?.value ?? recs.at(-1)?.text ?? '', 200),
    // 写错的那几次写了什么（选择题记在 wrong 里）：这节课的一页（sheet.js）里「当时是怎么错的」
    wrongs: uniq([...recs.filter((r) => r.ok === false).map((r) => cut(r.value ?? r.text ?? '', 80)), ...recs.flatMap((r) => (Array.isArray(r.wrong) ? r.wrong.map((w) => cut(w, 80)) : []))].filter(Boolean)).slice(0, 3),
    expected: final?.expected !== undefined ? cut(final.expected, 120) : undefined,
    images: uniq(recs.flatMap((r) => (Array.isArray(r.images) ? r.images : []))),
    turn: Math.min(...list.map((e) => num(e.turn) ?? Infinity)),
    first: at.length ? Math.min(...at) : null,
    end: at.length ? Math.max(...at) : null,
    evidence: list.sort(byAt).map((e) => e.id).filter(Boolean).slice(0, 30),
  };
}

/**
 * 证据 → 一道道题（作答记录和揭开 / 放弃 / 有没有把握按「组件 + 第几步」归到一起）。
 * bySession：跨好几节课算的时候（mastery.js），不同课里同名的组件（都叫 q1）分开算。
 */
export function itemsOf(evs, segs = new Map(), { bySession = false } = {}) {
  const groups = new Map();
  for (const e of evs || []) {
    if (!e || !['record', 'event'].includes(e.src) || !e.comp) continue;
    if (e.src === 'event' && !['giveup', 'reveal', 'sure'].includes(e.kind)) continue;
    // 「有把握吗」记的是那道题的键（confidence.js 照 itemKey 算好的）
    const k0 = e.kind === 'sure' && e.detail?.key ? String(e.detail.key) : itemKey(e);
    const k = bySession ? `${e.session || ''}§${k0}` : k0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  // 只有「揭开」、没有作答的步（老师的例题一步步揭开看）不算一道题；有作答的步，揭开记在它的 reveals 上
  const items = [...groups].filter(([, list]) => list.some((e) => e.src === 'record' || e.kind === 'giveup'))
    .map(([k, list]) => ({ ...itemOf(k, list, segs), ...(bySession ? { session: list[0].session || null } : {}) }))
    .sort((a, b) => (a.first ?? 0) - (b.first ?? 0) || a.key.localeCompare(b.key));
  for (const it of items) if (!Number.isFinite(it.turn)) delete it.turn;
  return items;
}

/**
 * 这节课最后一次有动静是什么时候（首页判断「挂着没下课、好几个小时没动静」用）：作答、说话、揭开这些算；
 * 只是点进去看一眼（open）、下课（end）不算——不然翻看一下挂着的课，它就又要等 3 小时才算报告
 */
export function lastActivity(session = {}, evidence = []) {
  const sid = String(session.id || '');
  return Math.max(Number(session.startedAt) || 0, ...(evidence || [])
    .filter((e) => e && String(e.session || '') === sid && !(e.src === 'event' && ['open', 'end'].includes(e.kind)))
    .map((e) => Number(e.at) || 0));
}

/** 这节课的时长：开课到下课（没下课就到最后一个动静），去掉两次动静之间超过 IDLE_GAP 的空档 */
export function activeTime(points, { start, end, idle = IDLE_GAP } = {}) {
  const pts = [start, ...(points || []), end].map(num).filter((x) => x !== null && x > 0).sort((a, b) => a - b);
  if (!pts.length) return { wallMs: 0, activeMs: 0, gaps: 0 };
  const from = num(start) ?? pts[0];
  const to = num(end) ?? pts.at(-1);
  let activeMs = 0, gaps = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = Math.max(pts[i - 1], from), b = Math.min(pts[i], to);
    if (b <= a) continue;
    const d = b - a;
    if (d > idle) gaps++;
    else activeMs += d;
  }
  return { wallMs: Math.max(0, to - from), activeMs, gaps };
}

/** 按块、按知识点（证据的 tags）汇总；没打标签的题算在 '' 下面 */
export function tagSummary(items) {
  const m = new Map();
  for (const it of items) {
    for (const tag of it.tags.length ? it.tags : ['']) {
      if (!m.has(tag)) m.set(tag, { tag, point: tag.includes('#'), items: 0, first: 0, ok: 0, wrong: 0, giveup: 0, revealed: 0, open: 0, ms: 0 });
      const s = m.get(tag);
      s.items++;
      s[it.outcome === 'first' ? 'first' : it.outcome]++;
      s.ms += it.ms || 0;
    }
  }
  return [...m.values()].sort((a, b) => (a.tag === '' ? 1 : b.tag === '' ? -1 : a.tag.localeCompare(b.tag)));
}

/**
 * 这节课的报告。
 * session：sessions/{编号} 文档（带 id）；evidence：这节课的证据；manual：上一节课以后的补记；
 * observations、slips：这节课的；turns：class_turns；steps：黑板的段（id、page、title）。now：报告的时间。
 */
export function buildReport({ session = {}, evidence = [], manual = [], observations = [], slips = [], turns = [], steps = [], now = Date.now() } = {}) {
  const sid = String(session.id || '');
  const segs = new Map((steps || []).filter((s) => s && s.id).map((s) => [String(s.id), s]));
  const evs = (evidence || []).filter((e) => e && (!sid || !e.session || e.session === sid));

  const items = itemsOf(evs, segs);

  const drafts = evs.filter((e) => e.kind === 'draft').sort(byAt).map((e) => ({
    id: e.id, comp: e.comp ?? null, compKind: e.compKind || '', seg: e.step ?? null, label: e.label || '', text: cut(e.text, 300), at: e.at,
  }));
  const says = evs.filter((e) => e.src === 'say').sort(byAt).map((e) => ({
    id: e.id, at: e.at, ...(num(e.turn) !== null ? { turn: num(e.turn) } : {}), kind: e.kind, text: cut(e.text, 500),
    images: Array.isArray(e.images) ? e.images : [], ...(e.ink ? { ink: e.ink } : {}),
  }));
  const manualRows = (manual || []).filter((e) => e && e.src === 'manual').sort(byAt).map((e) => ({
    id: e.id, at: e.at, text: cut(e.text, 300), verdict: e.verdict || '', block: e.block ?? null, images: Array.isArray(e.images) ? e.images : [],
  }));
  const unfinished = items.filter((it) => !it.final && it.outcome === 'wrong').map((it) => it.key);

  const obs = (observations || []).filter((o) => o && (!sid || o.session === sid)).sort(byAt);
  const sl = (slips || []).filter((s) => s && (!sid || s.session === sid));

  const time = activeTime([...evs.map((e) => e.at), ...(turns || []).map((t) => t?.at)], { start: session.startedAt, end: session.endedAt });
  const count = (o) => items.filter((it) => it.outcome === o).length;
  const report = {
    v: REPORT_VERSION,
    session: sid || null,
    block: session.block ?? null,
    title: cut(session.title || '', 120),
    date: session.date || null,
    status: session.status || null,
    startedAt: num(session.startedAt),
    endedAt: num(session.endedAt),
    time,
    totals: {
      items: items.length, unsure: items.filter((it) => it.sure === false).length, guess: items.filter((it) => it.guess).length, first: count('first'), ok: count('ok'), wrong: count('wrong'), giveup: count('giveup'), revealed: count('revealed'), open: count('open'),
      evidence: evs.length, says: says.filter((s) => s.kind === 'say').length, photos: says.filter((s) => s.kind === 'photo' || s.images.length).length, drafts: drafts.length,
      turns: (turns || []).filter((t) => t?.role === 'student' || t?.role === 'claude').length,
    },
    items,
    byTag: tagSummary(items),
    unfinished,
    drafts,
    says,
    manual: manualRows,
    notes: obs.map((o) => ({ id: o.id, kind: o.kind, text: cut(o.text, 160), ...(num(o.turn) !== null ? { turn: num(o.turn) } : {}) })),
    summary: session.summary || obs.find((o) => o.kind === 'summary')?.id || null,
    slips: sl.map((s) => ({ id: s.id, text: cut(s.text, 160) })),
    usage: usageOf(turns),
    verify: session.verify || null,
    // 点开看过意思的生词（gloss）：学生不认识的词
    words: evs.filter((e) => e.src === 'event' && e.kind === 'gloss').map((e) => (e.detail && typeof e.detail === 'object' ? e.detail : e)).filter((d) => d.word)
      .filter((d, i, all) => all.findIndex((x) => String(x.word).toLowerCase() === String(d.word).toLowerCase()) === i).slice(0, 60).map((d) => ({ word: cut(d.word, 60), gloss: cut(d.gloss, 80) })),
    // 这节课的一页：记号、重点框、做错又改对的、还没拿下的（页面自己拼，不调用 Claude）
    sheet: lessonSheet({ steps, items }),
    // 舞台课分了几幕（老师写的 scene，主线第六轮 3.6）：一幕一个标题、它的重点卡。只有一幕（旧课、没写 scene）不写
    ...scenesOf(turns, session),
    at: now,
  };
  return fitReport(report);
}

/** 舞台课的几幕：照课堂刷新时拼 log 的办法（stage/classroom.js：作废的轮不要，老师、学生的轮各自的 log 接起来）推出来 */
function scenesOf(turns, session) {
  const log = (turns || []).filter((t) => t && !t.discarded && (t.role === 'claude' || t.role === 'student')).flatMap((t) => (Array.isArray(t.log) ? t.log : []));
  if (!log.length) return {};
  const sp = sceneSpans(log, { title: session.title || '开头' });
  return sp.length > 1 ? { scenes: sp.map((x) => ({ n: x.n, title: cut(x.title, 60), keys: x.keys.map((k) => cut(k, 120)).slice(0, 6) })) } : {};
}

/** 太大了（几百道题、说了很多话）：先缩短文字，再截掉最早的条目，在 more 里记截掉了几条 */
export function fitReport(r, max = REPORT_MAX) {
  const size = (x) => new TextEncoder().encode(JSON.stringify(x)).length;
  if (size(r) <= max) return r;
  const out = { ...r, more: {} };
  out.items = r.items.map((it) => ({ ...it, q: cut(it.q, 40), last: cut(it.last, 40), evidence: it.evidence.slice(0, 5) }));
  out.says = r.says.map((s) => ({ ...s, text: cut(s.text, 120) }));
  out.notes = r.notes.map((n) => ({ ...n, text: cut(n.text, 60) }));
  for (const k of ['says', 'items', 'manual', 'drafts', 'notes']) {
    while (out[k].length > 1 && size(out) > max) {
      const n = Math.ceil(out[k].length / 4);
      out[k] = out[k].slice(n);
      out.more[k] = (out.more[k] || 0) + n;
    }
  }
  return out;
}

/** 首页「上一节」那一行：时长、做了几题一次对几题、花了多少 */
export function reportLine(r) {
  if (!r) return '';
  const min = Math.round((r.time?.activeMs || 0) / 60000);
  const t = r.totals || {};
  return [min ? `${min} 分钟` : '', t.items ? `${t.items} 题，一次对 ${t.first}${t.guess ? `，试出来的 ${t.guess}` : ''}${t.wrong ? `，错 ${t.wrong}` : ''}${t.giveup + t.revealed ? `，没做出 ${t.giveup + t.revealed}` : ''}` : '没做题',
    t.drafts ? `${t.drafts} 处草稿没交` : ''].filter(Boolean).join(' · ');
}

/**
 * 下课时给课堂 Claude 看的报告（closingPrompt 里的那段）：一道题一行，带组件 id 和证据 id，整理单的 basis 照着写。
 * 最多 max 字节左右（题多的课只留最近的）。
 */
export function reportText(r, { max = 8 * 1024 } = {}) {
  if (!r) return '';
  const t = r.totals || {};
  const min = Math.round((r.time?.activeMs || 0) / 60000);
  const head = [`## 课后报告（${r.session || ''}${r.block ? `，块 ${r.block}` : ''}）`,
    `- 时长约 ${min} 分钟；做了 ${t.items || 0} 题：一次对 ${t.first || 0}、改对 ${t.ok || 0}、错 ${t.wrong || 0}、想不出来 ${t.giveup || 0}、看了答案 ${t.revealed || 0}、程序判不了 ${t.open || 0}。`];
  const tags = (r.byTag || []).filter((x) => x.tag).map((x) => `${x.tag} ${x.items} 题一次对 ${x.first}`);
  if (tags.length) head.push(`- 按块 / 知识点：${tags.join('；')}`);
  const items = (r.items || []).map((it) => `- ${it.comp}${it.seg ? `（${it.seg}）` : ''}「${cut(it.q, 60)}」：${it.seq || '·'} ${it.guess ? '把选项试遍了才对（不算会）' : OUTCOME_TEXT[it.outcome] || it.outcome}${it.sure === false ? '（学生标了没把握）' : it.sure === true ? '（有把握）' : ''}${it.last ? `，最后写的 ${cut(it.last, 40)}` : ''}${it.ms ? `，${Math.round(it.ms / 1000)} 秒` : ''}；证据 ${it.evidence.slice(-3).join(',')}`);
  const tail = [];
  if (r.drafts?.length) tail.push(`- 没交的草稿：${r.drafts.map((d) => `${d.comp || ''}「${cut(d.text, 40)}」（${d.id}）`).join('；')}`);
  if (r.says?.length) tail.push(`- 学生说的话：${r.says.filter((s) => s.text).slice(-12).map((s) => `「${cut(s.text, 60)}」（${s.id}）`).join('；')}`);
  if (r.words?.length) tail.push(`- 学生点开看过意思的生词（不认识的）：${r.words.map((w) => w.word).join('、')}（页面下课后收进「要记的」）`);
  if (r.manual?.length) tail.push(`- 学习台外面补记的：${r.manual.map((m) => `「${cut(m.text, 60)}」${m.verdict ? ` ${m.verdict}` : ''}（${m.id}）`).join('；')}`);
  const size = (xs) => new TextEncoder().encode(xs.join('\n')).length;
  let kept = items;
  while (kept.length > 1 && size([...head, ...kept, ...tail]) > max) kept = kept.slice(1);
  if (kept.length < items.length) head.push(`- （题太多，只列了最近的 ${kept.length} 道）`);
  return [...head, ...(kept.length ? ['', '每道题：', ...kept] : []), ...(tail.length ? ['', ...tail] : [])].join('\n');
}
