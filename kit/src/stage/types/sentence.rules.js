// 句子（拆成分）的规则（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 1 节）：照老师造句子时给的正确拆法
// （key="[S The man [RC who lives next door]] [V is] a doctor."，sentence.js 的 parseKey 读成 o.key）逐词比学生拉的括号、
// 认四种错法；下一步、挑战用的判断式、手势表。纯函数，有测试（tests/stage-sentence-rules.test.js）；在 types/index.js 里登记。
//
// 页面不自己分析英语语法：拉得对不对只看 key。说「像哪种错」时用到一点词形（to、-ing、-ed、be / have），只用来挑说法，不改判对错。
// 一段 = 现在连着的几个词（从第几个到第几个）。拉对一段：舞台上有一道括号正好是 key 里的这一段、成分一样
// （成分名照 roleName 对：V 和「谓语」是一个；括号下写中文、写缩写都认）。拉错了的括号留着也不碍事（舞台上没有让学生收括号的手势），
// 只看 key 里的每一段有没有拉对。
import { ROLES, judgeSpans } from '../../entext.js';
import { sentence } from './sentence.js';

// —— 成分名 ——

// 舞台上写的成分名 → 成分；表里没有的照 entext.js 的 ROLES（缩写 → 中文名），中文名就是它自己
export const ROLE_NAMES = { V: '谓语', 谓语: '谓语', S: '主语', 主语: '主语', O: '宾语', 宾语: '宾语', RC: '定语从句', 定语从句: '定语从句' };
const CODES = new Map(Object.keys(ROLES).map((k) => [k.toLowerCase(), k]));
/** 成分名 → 成分（「谓语1」「V2」这种编了号的去掉号；缩写不管大小写） */
export function roleName(label) {
  const base = String(label ?? '').trim().replace(/(\D)\d+$/, '$1');
  if (Object.hasOwn(ROLE_NAMES, base)) return ROLE_NAMES[base];
  const code = CODES.get(base.toLowerCase());
  if (code) return Object.hasOwn(ROLE_NAMES, code) ? ROLE_NAMES[code] : ROLES[code];
  return base;
}
// 主干：最外层的主语、谓语、宾语、表语（和作这几种成分的从句）
const MAIN = new Set(['主语', '谓语', '宾语', '间接宾语', '直接宾语', '表语', '补语', '宾补', '主语从句', '宾语从句', '表语从句']);

// —— 词 ——

const ordered = (o) => [...o.words].sort((a, b) => a.slot - b.slot);
const lower = (w) => String(w ?? '').toLowerCase().replace(/’/g, "'");
const at = (o, a, b) => (a === b ? `${o.id}.${a}` : `${o.id}.${a}-${b}`);
const textOf = (o, a, b) => ordered(o).filter((w) => w.slot >= a && w.slot <= b).map((w) => w.value).join(' ');
const slotMap = (o) => new Map(o.words.map((w) => [w.key, w.slot]));

/** key 里的每一段按现在的位置：{ role（key 里写的）, name（成分）, keys, depth, from, to, ok（现在还连着、拉得成一段）}，从外到里；没写 key 是 null */
function keySpans(o) {
  if (!o?.key?.spans?.length) return null;
  const slot = slotMap(o);
  return o.key.spans.map((sp) => {
    const slots = sp.keys.map((k) => slot.get(k)).filter((v) => v != null);
    const from = Math.min(...slots), to = Math.max(...slots);
    return { role: sp.role, name: roleName(sp.role), keys: sp.keys, depth: sp.depth, from, to, ok: slots.length === sp.keys.length && to - from + 1 === slots.length };
  }).sort((p, q) => p.depth - q.depth || p.from - q.from);
}
/** 舞台上现在的括号（连着的才算一段）：[{ role（成分）, from, to }] */
function markSpans(o) {
  const slot = slotMap(o);
  const out = [];
  for (const m of o.marks || []) {
    const slots = m.keys.map((k) => slot.get(k)).filter((v) => v != null);
    if (!slots.length) continue;
    const from = Math.min(...slots), to = Math.max(...slots);
    if (to - from + 1 === slots.length) out.push({ role: roleName(m.label), from, to });
  }
  return out;
}
/** key 里还没拉对的段（照 keySpans 的顺序，从外到里）：拿 judgeSpans 比，范围一样、成分一样才算拉对，多拉的不算 */
function leftOf(o, ks) {
  const r = judgeSpans(markSpans(o), ks.filter((k) => k.ok).map((k) => ({ role: k.name, from: k.from, to: k.to })));
  const right = new Set(r.right.map((x) => `${x.from}-${x.to}`));
  return ks.filter((k) => !k.ok || !right.has(`${k.from}-${k.to}`));
}

// —— 下一步 ——

const actOf = (k) => ({ type: 'mark', from: k.from, to: k.to, role: k.role });
const spreadText = (o, k) => k.keys.map((key) => o.words.find((w) => w.key === key)?.value).filter(Boolean).join(' ');
const spanLine = (o, k) => (k.ok ? `${at(o, k.from, k.to)} ${k.name}（${textOf(o, k.from, k.to)}）` : `${k.name}（${spreadText(o, k)}）的词被挪开了，拉不成一段`);
// 写话时拉得成的在前（挪开了的放最后说一声）
const okFirst = (list) => [...list.filter((k) => k.ok), ...list.filter((k) => !k.ok)];

function next(o) {
  const ks = keySpans(o);
  // 没写正确拆法：页面不判，也不算做完（next 是 null 就是做完了）
  if (!ks) return { acts: [], why: `${o.id} 没写 key=（正确拆法），页面不判` };
  const left = okFirst(leftOf(o, ks));
  if (!left.length) return null;
  const [first, ...rest] = left;
  const why = rest.length
    ? `还有 ${left.length} 段没拉对，从外到里先拉 ${spanLine(o, first)}；还有 ${rest.map((k) => spanLine(o, k)).join('、')}`
    : `还差一段：${spanLine(o, first)}`;
  return { acts: left.filter((k) => k.ok).map(actOf), why };
}

/** check 的 next：「现在正确的是……」；rel 是学生这一下最像在拉的那一段，先说它 */
function nowRight(o, ks, rel = null) {
  const left = okFirst(leftOf(o, ks));
  if (!left.length) return { why: '正确拆法里的每一段都拉对了', acts: [] };
  const first = rel && left.includes(rel) ? rel : null;
  const rest = left.filter((k) => k !== first);
  const head = first ? `${first.name}是 ${at(o, first.from, first.to)}（${textOf(o, first.from, first.to)}）` : '';
  const tail = rest.length ? `${first ? '；还没拉对的还有' : '还没拉对'}：${rest.map((k) => spanLine(o, k)).join('、')}` : '';
  return { why: head + tail, acts: (first ? [first, ...rest] : rest).filter((k) => k.ok).map(actOf) };
}

// —— 像哪种错 ——

const BE_HAVE = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'having']);
// 常见的不规则过去分词（-ed 结尾的另认）
const DONE = new Set(('been done gone seen known given taken written shown grown drawn born borne chosen spoken broken driven eaten fallen '
  + 'forgotten hidden ridden risen stolen thrown worn frozen beaten bitten blown flown made built held found brought bought caught taught '
  + 'thought left kept felt lost meant met paid said sold sent spent stood told understood won begun sung swum drunk').split(' '));
// 词尾像 -ing / -ed 却不是分词的常见词
const NOT_FORM = /thing$|^(during|morning|evening|ceiling|string|spring|hundred|indeed|speed|proceed|succeed|exceed|sacred|naked|wicked)$/;
const looksIng = (w) => /^[a-z]{3,}ing$/.test(w) && !NOT_FORM.test(w);
const looksDone = (w) => DONE.has(w) || (/^[a-z]{3,}ed$/.test(w) && !NOT_FORM.test(w));

/** 这几个词像不像非谓语（to do / doing / done）：像就说出是哪一种，不像是 null。before 是这几个词前面那个词 */
function nonFinite(ws, before) {
  const first = lower(ws[0]);
  const text = ws.join(' ');
  if (first === 'to' && ws.length > 1) return `${text} 是 to do`;
  if (lower(before) === 'to') return `to ${text} 是 to do`;
  if (looksIng(first)) return `${text} 是 doing`;
  if (looksDone(first)) return `${text} 是 done`;
  return null;
}

/** 谓语只圈了一半时怎么说：key 里的谓语是 be / have 加分词的，点出这两样合起来才是一个谓语 */
function halfText(o, k) {
  const ws = ordered(o).filter((w) => w.slot >= k.from && w.slot <= k.to).map((w) => lower(w.value));
  const aux = ws.findIndex((w) => BE_HAVE.has(w));
  const part = aux >= 0 && ws.slice(aux + 1).some((w) => looksIng(w) || looksDone(w));
  const text = textOf(o, k.from, k.to);
  return part ? `谓语只圈了一半（be/have 和后面的分词合起来是一个谓语：${text}）` : `谓语只圈了一半（谓语是「${text}」这一整段）`;
}

/** 断早、断晚怎么说：断在哪里比 key 早了（往左）还是晚了（往右），开头、结尾各差哪几个词 */
function edgeText(o, k, a, b) {
  const who = /从句$/.test(k.name) ? '从句' : `${k.name}这一段`;
  const dirs = [], bits = [];
  if (a !== k.from) {
    const early = a < k.from;
    dirs.push(early ? '早' : '晚');
    bits.push(early ? `开头多圈了 ${textOf(o, a, k.from - 1)}` : `开头漏了 ${textOf(o, k.from, a - 1)}`);
  }
  if (b !== k.to) {
    const early = b < k.to;
    dirs.push(early ? '早' : '晚');
    bits.push(early ? `结尾还差 ${textOf(o, b + 1, k.to)}` : `结尾多圈了 ${textOf(o, k.to + 1, b)}`);
  }
  const head = dirs.length === 2 && dirs[0] !== dirs[1] ? `${who}开头断${dirs[0]}了、结尾断${dirs[1]}了` : `${who}断${dirs[0]}了`;
  return `${head}：${k.name}是「${textOf(o, k.from, k.to)}」（${bits.join('，')}）`;
}

/** [a, b] 里不在这几段谓语里的几截 */
function runsOutside(a, b, vs) {
  const runs = [];
  let p = null;
  for (let i = a; i <= b + 1; i++) {
    const free = i <= b && !vs.some((k) => i >= k.from && i <= k.to);
    if (free && p == null) p = i;
    if (!free && p != null) { runs.push([p, i - 1]); p = null; }
  }
  return runs;
}

// 不是 key 里的那一段：像哪种错（docs/superpowers/plans/2026-11-06-stage-base.md 第 7 个任务的表；认不出来的给 null）。
// rel 是 key 里学生最像在拉的那一段（「现在正确的」先说它）
function misreadOf(o, ks, a, b, name) {
  const ws = ordered(o);
  const words = (p, q) => ws.slice(p - 1, q).map((w) => w.value);
  const overlaps = (k) => k.from <= b && a <= k.to;
  if (name === '谓语') {
    const vs = ks.filter((k) => k.ok && k.name === '谓语');
    // 谓语只圈了一半：拉的是 key 里一个谓语里面的一部分（一样的那段已经判对了）
    const half = vs.find((k) => a >= k.from && b <= k.to);
    if (half) return { rel: half, misread: halfText(o, half) };
    // 把非谓语当成了谓语：拉的这一段和谓语不沾边，或者整个包住了谓语，多出来的那几个词是 to do / doing / done（或者在 key 的非谓语里）
    const touched = vs.filter(overlaps);
    if (touched.every((k) => a <= k.from && b >= k.to)) {
      for (const [p, q] of runsOutside(a, b, touched)) {
        const nfSpan = ks.find((k) => k.name === '非谓语' && k.ok && p >= k.from && q <= k.to);
        const nf = nonFinite(words(p, q), ws[p - 2]?.value) || (nfSpan && `${words(p, q).join(' ')} 在非谓语「${textOf(o, nfSpan.from, nfSpan.to)}」里`);
        if (nf) return { rel: touched[0] || vs[0] || null, misread: `把非谓语当成了谓语：${nf}，不是谓语` };
      }
    }
  }
  // 段对了，成分不对
  const same = ks.find((k) => k.ok && k.from === a && k.to === b);
  if (same) return { rel: same, misread: `成分标错了：这一段是${same.name}，不是${name}` };
  // 断早、断晚：和 key 里的一段沾边、两头各差不过两个词。先找同一成分的；
  // 学生写的成分 key 里根本没有（写成了「从句」）才看别的成分，而且不看把这一段整个包在里面的——
  // 把 lives 标成谓语（从句里的谓语，key 没拉）、把 has been running 的 running 标成非谓语，都不是断错了地方，宁可不说
  const dist = (k) => Math.abs(a - k.from) + Math.abs(b - k.to);
  const near = (list) => list.filter((k) => k.ok && overlaps(k) && Math.abs(a - k.from) <= 2 && Math.abs(b - k.to) <= 2).sort((p, q) => dist(p) - dist(q))[0];
  const strictlyIn = (k) => a >= k.from && b <= k.to;
  const k = near(ks.filter((x) => x.name === name)) || (ks.some((x) => x.name === name) ? null : near(ks.filter((x) => !strictlyIn(x))));
  if (k) return { rel: k, misread: edgeText(o, k, a, b) };
  return { rel: null, misread: null };
}

// —— 判一下 ——

// mark { from, to, role }：from / to 是现在第几个词（和 mark s.2-5 V 一样），role 是括号下写的成分
function check(o, act) {
  if (act?.type !== 'mark') return { legal: true, right: null }; // 折起来、挪词这些不判
  const n = o.words.length;
  const ks = keySpans(o);
  const no = (why) => ({ legal: false, right: false, misread: null, why, next: ks ? nowRight(o, ks) : null });
  const a0 = Number(act.from), b0 = Number(act.to ?? act.from);
  if (!Number.isInteger(a0) || !Number.isInteger(b0)) return no('拉一段要写从第几个词到第几个词');
  const bad = [a0, b0].find((x) => x < 1 || x > n);
  if (bad != null) return no(`${o.id} 只有 ${n} 个词，没有第 ${bad} 个`);
  const [a, b] = a0 <= b0 ? [a0, b0] : [b0, a0];
  const label = String(act.role ?? '').trim();
  if (!label) return no('拉好一段还要写它是什么成分（主语、谓语……）');
  if (label.length > 16) return no('成分的名字要短（16 个字以内）');
  if (!ks) return { legal: true, right: null }; // 没写正确拆法：不判
  const why = `${at(o, a, b)} 标成${label}（${textOf(o, a, b)}）`;
  const name = roleName(label);
  if (ks.some((k) => k.ok && k.from === a && k.to === b && k.name === name)) return { legal: true, right: true, misread: null, why, next: null };
  const { misread, rel } = misreadOf(o, ks, a, b, name);
  return { legal: true, right: false, misread, why, next: nowRight(o, ks, rel) };
}

// —— 手势表（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）——

// 成分名里有空格、等号（"to do"）就加引号，mark 照样读得懂
const labelSrc = (label) => (/[\s="]/.test(label) ? (label.includes('"') ? `「${label}」` : `"${label}"`) : label);
/** 一个动作 → 学生那一行镜头指令 */
export function actSrc(o, act) {
  if (act.type === 'mark') return `mark ${at(o, act.from, act.to)} ${labelSrc(act.role)}`;
  if (act.type === 'fold') return `fold ${at(o, act.from, act.to)}`;
  throw new Error(`句子没有「${act.type}」这个动作`);
}
const made = (o, act) => ({ act, src: actSrc(o, act) });

// 手势里的一个词：部件（句子的词，带 key、slot）或者 { slot: 第几个 }；返回现在第几个
function slotOf(o, x) {
  if (x == null) return null;
  if (x.key != null) return o.words.find((w) => w.key === x.key)?.slot ?? null;
  return Number.isInteger(x.slot) && x.slot >= 1 && x.slot <= o.words.length ? x.slot : null;
}

function markAct(o, { from, to, value, role } = {}) {
  const a = slotOf(o, from), b = slotOf(o, to ?? from);
  if (a == null || b == null) return { error: '从一个词拉到另一个词，再点它是什么成分' };
  const [p, q] = a <= b ? [a, b] : [b, a];
  const label = String(role ?? value ?? '').trim();
  if (!label) return { error: `拉好了 ${at(o, p, q)}，再点它是什么成分（主语、谓语……）` };
  if (label.length > 16) return { error: '成分的名字要短（16 个字以内）' };
  return made(o, { type: 'mark', from: p, to: q, role: label });
}

// 点一道括号（{ mark: 括号的 id }）或者括号里的一个词（折起含这个词的最里层那一段）
function foldAct(o, { from, to } = {}) {
  const x = to ?? from;
  let m;
  if (x?.mark != null) {
    m = (o.marks || []).find((mk) => mk.id === x.mark);
    if (!m) return { error: `${o.id} 上没有这道括号` };
  } else {
    const k = x?.key ?? o.words.find((w) => w.slot === x?.slot)?.key;
    if (k == null) return { error: '点一段括号，把它折起来' };
    m = (o.marks || []).filter((mk) => mk.keys.includes(k) && mk.keys.length < o.words.length).sort((p, q) => p.keys.length - q.keys.length)[0];
    if (!m) return { error: '这个词不在哪一道括号里：先拉一段括号，再点它折起来' };
  }
  const slot = slotMap(o);
  const slots = m.keys.map((k) => slot.get(k)).filter((v) => v != null);
  const p = Math.min(...slots), q = Math.max(...slots);
  if (q - p + 1 !== m.keys.length) return { error: '这道括号的词不连着，折不起来' };
  if (m.keys.length >= o.words.length) return { error: '整句都折起来就什么都看不见了：只折修饰的那一段' };
  if ((o.folds || []).some((f) => f.keys.some((k) => m.keys.includes(k)))) return { error: '这一段里有已经折起来的词' };
  return made(o, { type: 'fold', from: p, to: q });
}

const gestures = {
  // 从一个词拉到另一个词，再点成分标签（value 是点的那个成分）：mark s.2-5 V
  mark: { gesture: 'span', from: 'word', to: 'word', pick: 'role', toAct: markAct },
  // open s fold：点一段（括号或括号里的词）折起来：fold s.3-6
  fold: { gesture: 'tap', on: ['bracket', 'word'], toAct: foldAct },
};

// —— 挑战用的判断式（when="s parsed, s main, s span s.2-5 = V"）——

const predicates = {
  // key 里的每一段都拉对了
  parsed: (o) => {
    const ks = keySpans(o);
    return ks ? leftOf(o, ks).length === 0 : null;
  },
  // 主干（最外层的主语、谓语、宾语 / 表语）拉对了
  main: (o) => {
    const ks = keySpans(o);
    if (!ks) return null;
    const trunk = ks.filter((k) => k.depth === 0 && MAIN.has(k.name));
    if (!trunk.length) return null;
    const left = new Set(leftOf(o, ks));
    return trunk.every((k) => !left.has(k));
  },
  // 这一段现在挂着这个成分（看舞台上的括号，不靠 key）；参数照 goal.js 拆出来的原样：s span s.2-5 = V → ['s.2-5', '=', 'V']
  span: (o, args = []) => {
    const src = args.join(' ').trim();
    const m = src.match(/^(\S+?)\s*=\s*(\S.*)$/) || src.match(/^(\S+)\s+(\S.*)$/);
    if (!m) throw new Error(`span 要写哪一段是什么成分：${o.id} span ${o.id}.2-5 = V`);
    const ref = m[1].match(/^([A-Za-z_]\w*)([.#])(.+)$/);
    if (ref && ref[1] !== o.id) throw new Error(`span ${m[1]}：写 ${o.id} 里的词（${o.id} span ${o.id}.2-5 = V）`);
    const keys = new Set(sentence.pick(o, ref ? ref[2] : '.', ref ? ref[3] : m[1], m[1]).map((w) => w.key));
    const role = roleName(m[2]);
    return (o.marks || []).some((mk) => mk.keys.length === keys.size && mk.keys.every((k) => keys.has(k)) && roleName(mk.label) === role);
  },
};

export const sentenceRules = { next, check, predicates, gestures };
