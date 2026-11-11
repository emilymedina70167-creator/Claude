// 句子（拆成分）的规则（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 1 节）：照老师造句子时给的正确拆法
// （key="[S The man [RC who lives next door]] [V is] [P a doctor]."，sentence.js 的 parseKey 读成 o.key）逐词比学生拉的括号、
// 认四种错法；下一步、写给老师的事实、挑战用的判断式、手势表。纯函数，有测试（tests/stage-sentence-rules.test.js）；在 types/index.js 里登记。
//
// 页面不自己分析英语语法：拉得对不对只看 key，说「像哪种错」也只说 key 印证得了的（「把非谓语当成了谓语」要那几个词落在 key 的非谓语里；
// 只有「谓语只圈了一半」挑说法时看一眼 be / have 后面是不是分词）。认不出就不说，宁可 misread 是 null，也不给老师写错的事实。
// 一段 = 现在连着的几个词（从第几个到第几个）。拉对一段：舞台上有一道括号正好是 key 里的这一段、成分一样
// （成分名照 sentence.js 的 roleName / sameRole 对：V 和「谓语」是一个，分词、to do 是非谓语，只写「从句」对得上任何一种从句）。
// 拉错了的括号留着也不碍事（学生也能点 ✕ 收掉自己拉的，不判），只看 key 里的每一段有没有拉对。
// key 可以不全（老师只拉了要讲的几段）：学生拉了 key 没拉、也不和 key 冲突的一段，页面不判（right 是 null），不说「不对」。
// key 的一段可以写几种成分（[Attr/NF …]）：哪一种都算对，给老师写成「定语或非谓语」。
// 拉一条线（refer：that 指的是谁）照老师造句子时给的 links=（sentence.js 的 parseLinks）判，用 entext.js 的 judgeLinks；没写 links= 不判。
import { judgeSpans, judgeLinks } from '../../entext.js';
import { sentence, ordered, voidBy, roleName, sameRole, phraseOf, restText, roleColor, spanText, brokenMarks, targetKey, outerFolds, foldClash, hookWords, ROLE_NAMES, CLAUSE_ROLES } from './sentence.js';

export { roleName, roleAbbr, ROLE_NAMES } from './sentence.js';

// 学生写的成分对得上 key 里的这一种吗：一样，或者学生写的是泛称——「从句」对任何一种从句（sameRole），
// 「定语」（Attr）对定语从句（定语从句也是定语；反过来 key 写定语、学生写定语从句不放宽：key 没说那一段是从句）
const fits = (keyName, mine) => sameRole(keyName, mine) || (mine === '定语' && keyName === '定语从句');

// 主干：最外层的主语、谓语、宾语、表语（和作这几种成分的从句）
const MAIN = new Set(['主语', '谓语', '宾语', '间接宾语', '直接宾语', '表语', '补语', '宾补', '主语从句', '宾语从句', '表语从句']);
// key 的一段是不是这种成分 / 学生写的对不对得上它（写了几种的，哪一种都算）；给老师写的成分名（几种写成「定语或非谓语」）
const has = (k, n) => k.names.includes(n);
const fitsK = (k, mine) => k.names.some((n) => fits(n, mine));
const nameText = (k) => k.names.join('或');

// —— 词 ——

const lower = (w) => String(w ?? '').toLowerCase().replace(/’/g, "'");
const at = (o, a, b) => (a === b ? `${o.id}.${a}` : `${o.id}.${a}-${b}`);
const textOf = (o, a, b) => phraseOf(ordered(o).filter((w) => w.slot >= a && w.slot <= b));
const slotMap = (o) => new Map(o.words.map((w) => [w.key, w.slot]));

/**
 * key 里的每一段按现在的位置：{ role（key 里写的第一种）, name（它的成分）, names（写了的每一种的成分：[Attr/NF …] 是定语、非谓语）,
 * keys, depth, from, to, ok（现在还连着、拉得成一段）}，从外到里；没写 key、key 作废了是 null
 */
export function keySpans(o) {
  if (!o?.key?.spans?.length || o.key.void) return null;
  const slot = slotMap(o);
  return o.key.spans.map((sp) => {
    const slots = sp.keys.map((k) => slot.get(k)).filter((v) => v != null);
    const from = Math.min(...slots), to = Math.max(...slots);
    const names = (sp.roles || [sp.role]).map(roleName);
    return { role: sp.role, name: names[0], names, keys: sp.keys, depth: sp.depth, from, to, ok: slots.length === sp.keys.length && to - from + 1 === slots.length };
  }).sort((p, q) => p.depth - q.depth || p.from - q.from);
}

// —— 一层一层：key 里的从句 ——
// 一段从句：成分是某种从句（RC、Cl……），或者 key 在它里面直接标了谓语（[S What [S he] [V said]] 的 S）。
// 套在从句里的一段只和同一层的比：定语从句里的 who 标成主语，不拿去和外面那个主语（The man who lives next door）比——
// key 没拆这个从句，页面就不知道从句里面对不对（以前说「这一段不对」，照 wrong=mark / call=wrong 还圈出来、马上叫老师）
const isClause = (ks, k) => k.names.some((n) => CLAUSE_ROLES.includes(n) || n === '从句') || ks.some((v) => v.ok && has(v, '谓语') && v.depth === k.depth + 1 && v.from >= k.from && v.to <= k.to);
/** a–b 最里层的从句：key 里把它严格包在里面（不是正好这一段）的、最深的一段从句；在顶层是 null */
function clauseOf(ks, a, b) {
  let best = null;
  for (const k of ks) if (k.ok && isClause(ks, k) && k.from <= a && b <= k.to && !(k.from === a && k.to === b) && (!best || k.depth > best.depth)) best = k;
  return best;
}
/** 学生拉的 a–b 和 key 里哪几段在同一层（最里层的从句一样）：只有它们拿来比「同一种成分、范围不一样」 */
function peersOf(ks, a, b) {
  const c = clauseOf(ks, a, b);
  return { clause: c, peer: (k) => k.ok && clauseOf(ks, k.from, k.to) === c };
}
/** 判不了的时候怎么说：没写 key，还是写了但被 rewrite 作废了 */
const noKeyWhy = (o) => (o?.key?.void ? `${o.id} 的 key 跟着 ${voidBy(o.key)} 作废了，要判就重写 key（重新造这句、带上新的 key=）` : `${o.id} 没写 key=（正确拆法），页面不判`);

/**
 * 舞台上现在的括号（连着的才算一段）：[{ role（成分）, from, to }]。
 * 成分写的是泛称（「从句」）、key 里同一段是某种从句时，记成 key 的那种，judgeSpans 才比得上
 */
function markSpans(o, ks) {
  const slot = slotMap(o);
  const out = [];
  for (const m of o.marks || []) {
    const slots = m.keys.map((k) => slot.get(k)).filter((v) => v != null);
    if (!slots.length) continue;
    const from = Math.min(...slots), to = Math.max(...slots);
    if (to - from + 1 !== slots.length) continue;
    const name = roleName(m.label);
    const k = ks.find((x) => x.ok && x.from === from && x.to === to && fitsK(x, name));
    out.push({ role: k ? k.name : name ?? m.label, from, to });
  }
  return out;
}
/** key 里还没拉对的段（照 keySpans 的顺序，从外到里）：拿 judgeSpans 比，范围一样、成分一样才算拉对，多拉的不算 */
function leftOf(o, ks) {
  const r = judgeSpans(markSpans(o, ks), ks.filter((k) => k.ok).map((k) => ({ role: k.name, from: k.from, to: k.to })));
  const right = new Set(r.right.map((x) => `${x.from}-${x.to}`));
  return ks.filter((k) => !k.ok || !right.has(`${k.from}-${k.to}`));
}

// —— 下一步 ——

const actOf = (k) => ({ type: 'mark', from: k.from, to: k.to, role: k.role });
const spreadText = (o, k) => phraseOf(o.words.filter((w) => k.keys.includes(w.key)).sort((a, b) => a.key - b.key));
const spanLine = (o, k) => (k.ok ? `${at(o, k.from, k.to)} ${nameText(k)}（${textOf(o, k.from, k.to)}）` : `${nameText(k)}（${spreadText(o, k)}）被 move 拆散了，拉不成一段`);
// 写话时拉得成的在前（拆散了的放最后说一声）
const okFirst = (list) => [...list.filter((k) => k.ok), ...list.filter((k) => !k.ok)];

function next(o) {
  const ks = keySpans(o);
  // 没写正确拆法（或者作废了）：页面不判，也不算做完（next 是 null 就是做完了）
  if (!ks) return { acts: [], why: noKeyWhy(o) };
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
  const head = first ? `${nameText(first)}是 ${at(o, first.from, first.to)}（${textOf(o, first.from, first.to)}）` : '';
  const tail = rest.length ? `${first ? '；还没拉对的还有' : '还没拉对'}：${rest.map((k) => spanLine(o, k)).join('、')}` : '';
  return { why: head + tail, acts: (first ? [first, ...rest] : rest).filter((k) => k.ok).map(actOf) };
}

// —— 像哪种错 ——

// 「谓语只圈了一半」挑说法用：key 里的谓语是不是 be / have 加分词（只挑说法；那一段是一个谓语，是 key 说的）
const BE_HAVE = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'having']);
const DONE = new Set(('been done gone seen known given taken written shown grown drawn born borne chosen spoken broken driven eaten fallen '
  + 'forgotten hidden ridden risen stolen thrown worn frozen beaten bitten blown flown made built held found brought bought caught taught '
  + 'thought left kept felt lost meant met paid said sold sent spent stood told understood won begun sung swum drunk').split(' '));
const looksPart = (w) => DONE.has(w) || /^[a-z]{3,}(ing|ed)$/.test(w);

/** 谓语只圈了一半时怎么说：key 里的谓语是 be / have 加分词的，点出这两样合起来才是一个谓语 */
function halfText(o, k) {
  const ws = ordered(o).filter((w) => w.slot >= k.from && w.slot <= k.to).map((w) => lower(w.value));
  const aux = ws.findIndex((w) => BE_HAVE.has(w));
  const part = aux >= 0 && ws.slice(aux + 1).some(looksPart);
  const text = textOf(o, k.from, k.to);
  return part ? `谓语只圈了一半（be/have 和后面的分词合起来是一个谓语：${text}）` : `谓语只圈了一半（谓语是「${text}」这一整段）`;
}

/** 断早、断晚怎么说：断在哪里比 key 早了（往左）还是晚了（往右），开头、结尾各差哪几个词 */
function edgeText(o, k, a, b) {
  const who = k.names.some((n) => /从句$/.test(n)) ? '从句' : `${nameText(k)}这一段`;
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
  return `${head}：${nameText(k)}是「${textOf(o, k.from, k.to)}」（${bits.join('，')}）`;
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

/**
 * 把非谓语当成了谓语：标成谓语的这一截落在 key 的非谓语里（[NF …]，或者 key 里写成 doing / done 的一段）。
 * 只引落在那一段里的词；key 没说是非谓语的（从句里 key 没拉的谓语、to + 名词、名词）不说
 */
function nonFiniteText(o, ks, p, q, peer = () => true) {
  const nf = ks.filter((k) => k.ok && peer(k) && has(k, '非谓语') && k.from <= q && p <= k.to).sort((x, y) => (x.to - x.from) - (y.to - y.from))[0];
  if (!nf) return null;
  const lo = Math.max(p, nf.from), hi = Math.min(q, nf.to);
  const whole = textOf(o, nf.from, nf.to);
  return lo === nf.from && hi === nf.to ? `「${whole}」是非谓语，不是谓语` : `${textOf(o, lo, hi)} 在非谓语「${whole}」里，不是谓语`;
}

// 不是 key 里的那一段：像哪种错（docs/superpowers/plans/2026-11-06-stage-base.md 第 7 个任务的表；认不出来的给 null）。
// rel 是 key 里学生最像在拉的那一段（「现在正确的」先说它）；shown 是学生写的成分（认得出写中文名）
function misreadOf(o, ks, a, b, name, shown) {
  const overlaps = (k) => k.from <= b && a <= k.to;
  const { clause, peer } = peersOf(ks, a, b);
  if (name === '谓语') {
    const vs = ks.filter((k) => k.ok && has(k, '谓语'));
    // 谓语只圈了一半：拉的是 key 里一个谓语里面的一部分（一样的那段已经判对了）
    const half = vs.find((k) => a >= k.from && b <= k.to);
    if (half) return { rel: half, misread: halfText(o, half) };
    // 拉的这一段和谓语不沾边，或者整个包住了谓语：多出来的那几截落在 key 的非谓语里
    const touched = vs.filter(overlaps);
    if (touched.every((k) => a <= k.from && b >= k.to)) {
      for (const [p, q] of runsOutside(a, b, touched)) {
        const nf = nonFiniteText(o, ks, p, q, peer);
        if (nf) return { rel: touched[0] || vs[0] || null, misread: `把非谓语当成了谓语：${nf}` };
      }
    }
  }
  // 段对了，成分不对
  const same = ks.find((k) => k.ok && k.from === a && k.to === b);
  if (same) return { rel: same, misread: `成分标错了：这一段是${nameText(same)}，不是${shown}` };
  // 断早、断晚：同一成分（写泛称「从句」的对得上任何一种从句）的一段，沾边、两头各差不过两个词；成分也不一样的不说。
  // 只比同一层的（从句里的 I 不说成外面那个主语断晚了）；包住它的那个从句本身，学生写的正是这种从句时也比（从句断早了）
  const dist = (k) => Math.abs(a - k.from) + Math.abs(b - k.to);
  const near = (x) => peer(x) || (x === clause && has(x, name));
  const k = ks.filter((x) => x.ok && near(x) && fitsK(x, name) && overlaps(x) && Math.abs(a - x.from) <= 2 && Math.abs(b - x.to) <= 2).sort((p, q) => dist(p) - dist(q))[0];
  if (k) return { rel: k, misread: edgeText(o, k, a, b) };
  // 两种错一起：成分不对、范围也差一两个词
  const both = bothWrong(o, ks, a, b, name, peer);
  if (both) return both;
  return { rel: null, misread: null };
}

/**
 * 两种错一起出（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 5 节）：成分对不上 key 的那一段、范围又和它差一两个词（多的、少的加起来）。
 * 同一层（peer）里挑重叠最多的那一段，先说它是什么、再说范围差在哪：「成分标错了，范围也差一点：这一段是表语（…），学生拉的少了 better」。
 * 不说假话：key 只说了那一段是什么，没说它里面、外面一层是什么。学生拉的跨过了那一段的边（本来就和 key 冲突）才照说；
 * 整个落在那一段里、或者整个包住它的，要两样都成立才说：
 *   - 和它从同一个词起头（学生是在拉这一段、只是尾巴差了）。不从同一个词起头的可能正是 key 没拆的那一层：
 *     [P directing these funds] 里的 these funds 是 directing 的宾语；
 *   - 成分和它是一类（roleColor 的同一种颜色：宾语表语补语一类……）。不是一类的可能是换了个角度说同一段：
 *     [O to pay attention] 里拉 to pay 标非谓语，说的是动词的样子，不一定错。
 * 也要大半是那一段的词（重叠的比那一段、学生拉的都多一半）
 */
function bothWrong(o, ks, a, b, name, peer) {
  const len = (p, q) => q - p + 1;
  const hits = [];
  for (const k of ks) {
    if (!k.ok || !peer(k) || fitsK(k, name)) continue;
    const lo = Math.max(a, k.from), hi = Math.min(b, k.to);
    if (lo > hi) continue;
    const common = len(lo, hi), diff = len(a, b) + len(k.from, k.to) - 2 * common;
    if (diff < 1 || diff > 2) continue;
    if (common * 2 <= len(k.from, k.to) || common * 2 <= len(a, b)) continue;
    const cross = (a < k.from && b < k.to) || (a > k.from && b > k.to);
    const kin = !!name && k.names.some((n) => roleColor(n) && roleColor(n) === roleColor(name));
    if (cross || (a === k.from && kin)) hits.push({ k, common, diff });
  }
  const best = hits.sort((p, q) => q.common - p.common || p.diff - q.diff)[0];
  if (!best) return null;
  const { k } = best;
  const less = [k.from < a ? textOf(o, k.from, a - 1) : '', k.to > b ? textOf(o, b + 1, k.to) : ''].filter(Boolean);
  const more = [a < k.from ? textOf(o, a, k.from - 1) : '', b > k.to ? textOf(o, k.to + 1, b) : ''].filter(Boolean);
  const bits = [less.length ? `少了 ${less.join('、')}` : '', more.length ? `多了 ${more.join('、')}` : ''].filter(Boolean).join('，');
  return { rel: k, misread: `成分标错了，范围也差一点：这一段是${nameText(k)}（${textOf(o, k.from, k.to)}），学生拉的${bits}` };
}

/**
 * 学生拉的这一段和 key 冲突在哪（不冲突是 null）：跨过了 key 里一段的边界（一头在里面、一头在外面）；
 * 和 key 里一段是同一段词、成分不一样；和 key 里同一层（peersOf）同一种成分的一段沾边、范围不一样。
 * key 只说了它拉的那几段：不冲突的段（key 没拉的 a doctor、从句里 key 没拉的谓语、key 没拆的从句里的主语）页面不知道对不对，不判（硬说不对就是假话）
 */
function conflictOf(o, ks, a, b, name) {
  const { peer } = peersOf(ks, a, b);
  for (const k of ks) {
    if (!k.ok) continue;
    const text = textOf(o, k.from, k.to);
    if ((a < k.from && b >= k.from && b < k.to) || (a > k.from && a <= k.to && b > k.to)) return `和 key 里的${nameText(k)}「${text}」交叉`;
    if (a === k.from && b === k.to) return `key 里这一段是${nameText(k)}`;
    if (peer(k) && fitsK(k, name) && k.from <= b && a <= k.to) return `key 里${nameText(k)}是「${text}」`;
  }
  return null;
}

// —— 判一下 ——

// mark { from, to, role }：from / to 是现在第几个词（和 mark s.2-5 V 一样），role 是括号下写的成分；refer 见 referCheck
function check(o, act) {
  if (act?.type === 'refer') return referCheck(o, act);
  if (act?.type === 'unmark') return unmarkCheck(o, act);
  if (act?.type === 'unrefer') return unreferCheck(o, act);
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
  if (!ks) return { legal: true, right: null }; // 没写正确拆法（或者作废了）：不判
  const why = `${at(o, a, b)} 标成${label}（${textOf(o, a, b)}）`;
  const name = roleName(label);
  if (ks.some((k) => k.ok && k.from === a && k.to === b && fitsK(k, name))) return { legal: true, right: true, misread: null, why, next: null };
  const { misread, rel } = misreadOf(o, ks, a, b, name, name ?? label);
  // 认得出的四种错法都落在和 key 重叠的段上；别的段和 key 不冲突就不判（key 没拉的，页面不知道对不对）
  if (!misread && !conflictOf(o, ks, a, b, name)) return { legal: true, right: null, misread: null, why, next: null };
  return { legal: true, right: false, misread, why, next: nowRight(o, ks, rel) };
}

// —— 收掉（unmark / unrefer：学生点 ✕）：不判，交一句「收掉了…」给老师（stage.js 的 actText 照它写「学生收掉了自己拉的 …」）——

const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
const wordsOf = (o, keys) => phraseOf(ordered(o).filter((w) => keys.includes(w.key)));
// 收掉了自己拉的 s.21 V（language-acquisition；这一道 key 里没有 / 这一道 key 里有，是 V）：照括号上写的写；没写 key 括号里只写那几个词
function unmarkCheck(o, act) {
  const keys = act.keys || [];
  const m = (o.marks || []).find((mk) => sameSet(mk.keys, keys));
  if (!m) return { legal: true, right: null }; // 没有正好这几个词的一道（unmark 自己会收里面的或报错）：不说什么
  const sp = o.key && !o.key.void ? o.key.spans.find((x) => sameSet(x.keys, m.keys)) : null;
  const note = o.key && !o.key.void ? (sp ? `；这一道 key 里有，是 ${(sp.roles || [sp.role]).join('/')}` : '；这一道 key 里没有') : '';
  return { legal: true, right: null, misread: null, why: `收掉了${m.by === 'student' ? '自己' : '老师'}拉的 ${spanText(o, m.keys)} ${m.label}（${wordsOf(o, m.keys)}${note}）`, next: null };
}
// 收掉了自己连的 s.6 → s.5（that → shelf；links= 里有这一条 / 是你在 links= 里列的错连 / links= 里没有这一条）；没写 links= 只写两头
function unreferCheck(o, act) {
  const ws = ordered(o);
  const w = ws[Number(act.from) - 1];
  const r = w && (o.refers || []).find((x) => x.from === w.key);
  if (!r) return { legal: true, right: null };
  // 这一行收的不只这一条（unrefer s.4 还收指着 s.4 的线；unrefer s.4 -> s.2 没有正好这一条，照旧收两头的每一条）：不说「收掉了…」这一句
  const hits = (x) => x.from === w.key || x.to === w.key || (x.toKeys || []).includes(w.key);
  if (!act.to && (o.refers || []).some((x) => x !== r && hits(x))) return { legal: true, right: null };
  if (act.to) {
    const want = act.to.whole ? null : ws.slice(act.to.from - 1, act.to.to).map((x) => x.key);
    const same = act.to.whole ? r.whole : !r.whole && sameSet(r.toKeys || [r.to], want);
    if (!same) return { legal: true, right: null };
  }
  const toKeys = r.whole ? null : r.toKeys || [r.to];
  const end = r.whole ? `${o.id}（整句）` : spanText(o, toKeys);
  const L = o.links;
  let note = '';
  if (L && !L.void) {
    const key = referKey(r);
    if (L.pairs.some((p) => p.from === r.from && targetKey(p.to) === key)) note = '；links= 里有这一条';
    else if (L.wrongs.some((x) => x.from === r.from && targetKey(x.to) === key)) note = '；是你在 links= 里列的错连';
    else note = '；links= 里没有这一条';
  }
  return { legal: true, right: null, misread: null, why: `收掉了${r.by === 'student' ? '自己' : '老师'}连的 ${o.id}.${w.slot} → ${end}（${w.value} → ${r.whole ? '整句' : wordsOf(o, toKeys)}${note}）`, next: null };
}

// —— 拉一条线（refer：that 指的是谁）——

/** 一条线的落点（refer 的记录：词 to、一段 toKeys、整句 whole）写成 targetKey 的样子，和 links= 的比 */
const referKey = (r) => (r.whole ? 's' : targetKey({ keys: r.toKeys || [r.to] }));
/** links= 交给 judgeLinks 的样子（两头都写成字：from 是词的 key，to 是 targetKey） */
const linkAnswer = (L) => ({
  pairs: L.pairs.map((p) => ({ from: String(p.from), to: targetKey(p.to) })),
  wrongs: L.wrongs.map((w) => ({ from: String(w.from), to: targetKey(w.to), why: w.why })),
});
/** 舞台上现在的线和 links= 比：{ ok, right, wrong, missing }（judgeLinks） */
const linksNow = (o) => judgeLinks((o.refers || []).map((r) => ({ from: String(r.from), to: referKey(r) })), linkAnswer(o.links));
/** links= 的一头写给老师：s.2（books）、s.1-2（The books）、s（整句） */
function endText(o, t) {
  if (t.whole) return `${o.id}（整句）`;
  const ws = o.words.filter((w) => t.keys.includes(w.key)).sort((a, b) => a.slot - b.slot);
  return `${spanText(o, t.keys)}（${phraseOf(ws)}）`;
}
/** links= 的一条 → refer 的动作（现在的位置）；那一段被挪得不连着了是 null（连不过去） */
function pairAct(o, p) {
  const slot = slotMap(o);
  const a = slot.get(p.from);
  if (a == null) return null;
  if (p.to.whole) return { type: 'refer', from: a, to: { whole: true } };
  const xs = p.to.keys.map((k) => slot.get(k)).filter((v) => v != null);
  if (xs.length !== p.to.keys.length) return null;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return hi - lo + 1 === xs.length ? { type: 'refer', from: a, to: { from: lo, to: hi } } : null;
}
const linkVoid = (o) => `${o.id} 的 links= 跟着 ${voidBy(o.links)} 作废了`;

// refer { from（第几个词）, to: { from, to }（第几个到第几个）| { whole: true } }：照 links= 判（没写不判）。
// 对上正确的那一条是对的；对上 ! 那一条说像哪种错（老师写在 links= 里的，说明是老师的话）；别的连错页面说不出像什么。
// links= 没写这个词连谁的：不判（页面不自己分析英语）
function referCheck(o, act) {
  const n = o.words.length;
  const no = (why) => ({ legal: false, right: false, misread: null, why, next: null });
  const ws = ordered(o);
  const a = Number(act.from);
  if (!Number.isInteger(a) || a < 1 || a > n) return no(`${o.id} 只有 ${n} 个词，没有第 ${act.from} 个`);
  const w = ws[a - 1];
  let to, toText;
  if (act.to?.whole) { to = { whole: true }; toText = '整句'; }
  else {
    const p0 = Number(act.to?.from), q0 = Number(act.to?.to ?? act.to?.from);
    if (!Number.isInteger(p0) || !Number.isInteger(q0)) return no('拉线要松在一个词、一道括号或句子外框上');
    const bad = [p0, q0].find((x) => x < 1 || x > n);
    if (bad != null) return no(`${o.id} 只有 ${n} 个词，没有第 ${bad} 个`);
    const [p, q] = p0 <= q0 ? [p0, q0] : [q0, p0];
    if (p === a && q === a) return no('线的两头是同一个词');
    if (p <= a && a <= q) return no(`线指到的那一段不能含 ${w.value} 自己`);
    to = { keys: ws.slice(p - 1, q).map((x) => x.key) };
    toText = textOf(o, p, q);
  }
  const why = to.whole ? `${w.value} 连到整句` : `${w.value} 连到 ${toText}`;
  const L = o.links;
  if (!L || L.void) return { legal: true, right: null, misread: null, why, next: null };
  const r = judgeLinks([{ from: String(w.key), to: targetKey(to) }], linkAnswer(L));
  if (r.right.length) return { legal: true, right: true, misread: null, why, next: null };
  const pair = L.pairs.find((x) => x.from === w.key);
  const listed = L.wrongs.find((x) => x.from === w.key && targetKey(x.to) === targetKey(to));
  if (!pair && !listed) return { legal: true, right: null, misread: null, why, next: null };
  const misread = listed ? (r.wrong[0]?.why ? `${r.wrong[0].why}（你在 links= 里写的）` : '是你在 links= 里列的错连') : null;
  const act2 = pair && pairAct(o, pair);
  return { legal: true, right: false, misread, why, next: pair ? { why: `把 ${w.value} 连到 ${endText(o, pair.to)}`, acts: act2 ? [act2] : [] } : null };
}

// 连了一条以后：连到 links= 的每一条都对了说一声；links= 不只一条时说还差哪几条（这一条对不对、像哪种错，裁判的结论里已经写了）
function referFacts(before, after) {
  if (!after?.links || after.links.void || !before?.links) return [];
  const was = linksNow(before), now = linksNow(after);
  if (!now.missing) return was.missing ? ['links= 的每一条都连对了'] : [];
  if (after.links.pairs.length < 2) return [];
  const left = after.links.pairs.filter((p) => !(after.refers || []).some((r) => r.from === p.from && referKey(r) === targetKey(p.to)));
  const word = (k) => after.words.find((x) => x.key === k)?.value ?? `#${k}`;
  return [`links= 里还差 ${left.length} 条没连对：${left.map((p) => `${word(p.from)} → ${endText(after, p.to)}`).join('、')}`];
}

// —— 写给老师的事实 ——

/**
 * 学生拉的括号（m.by 是 student）那几行（舞台现状每一轮写，拉了一道以后只写变了的）：
 *   学生的括号：s.3-6 定语从句（who lives next door）里有 key 的谓语 1 个；括号外有 key 的谓语 1 个
 *   多拉的：s.1-2 S（The man；key 里没有这一段）       key 标了这种成分、没有这一段：真是多拉的
 *   key 里没有的：s.8-9 O（a doctor）                  key 一道这种成分都没标：页面不知道对不对，只说 key 里没有
 *   拆散的：s.2 s.8-9 那道 O 被挪开拆散了，不算一段
 * 成分照括号上写的（学生点的是什么就写什么）。谓语照 key 数（整段落在括号里才算在里面），key 一个谓语都没标就不说谓语几个（key 说不了）；
 * 没写 key、key 作废了只说拆散的
 */
export function bracketFacts(o) {
  const mine = (o?.marks || []).filter((m) => m.by === 'student');
  if (!mine.length) return [];
  const broken = new Set(brokenMarks(o));
  const slot = slotMap(o);
  const span = (m) => { const xs = m.keys.map((k) => slot.get(k)); return { m, from: Math.min(...xs), to: Math.max(...xs), keys: new Set(m.keys) }; };
  const whole = mine.filter((m) => !broken.has(m.id)).map(span).sort((p, q) => p.from - q.from || q.to - p.to);
  const out = [];
  const ks = keySpans(o);
  if (ks && whole.length) {
    const verbs = ks.filter((k) => has(k, '谓语'));
    if (verbs.length) {
      const inside = (b, k) => k.keys.every((x) => b.keys.has(x));
      const touches = (k) => whole.some((b) => k.keys.some((x) => b.keys.has(x)));
      const outer = verbs.filter((k) => !touches(k)).length;
      const across = verbs.filter((k) => touches(k) && !whole.some((b) => inside(b, k))).length;
      const each = whole.map((b) => `${at(o, b.from, b.to)} ${b.m.label}（${textOf(o, b.from, b.to)}）里有 key 的谓语 ${verbs.filter((k) => inside(b, k)).length} 个`);
      out.push(`学生的括号：${[...each, `括号外有 key 的谓语 ${outer} 个`, ...(across ? [`跨着括号边的 ${across} 个`] : [])].join('；')}`);
    }
    // key 里没有这一段的：key 标过这种成分（key 是全的那一种）才是多拉的；一道都没标的，页面不知道学生拉得对不对
    const extra = whole.filter((b) => !ks.some((k) => k.ok && k.from === b.from && k.to === b.to));
    const known = (b) => { const name = roleName(b.m.label); return !!name && ks.some((k) => fitsK(k, name)); };
    const real = extra.filter(known), unknown = extra.filter((b) => !known(b));
    if (real.length) out.push(`多拉的：${real.map((b) => `${at(o, b.from, b.to)} ${b.m.label}（${textOf(o, b.from, b.to)}；key 里没有这一段）`).join('、')}`);
    if (unknown.length) out.push(`key 里没有的：${unknown.map((b) => `${at(o, b.from, b.to)} ${b.m.label}（${textOf(o, b.from, b.to)}）`).join('、')}`);
  }
  const split = mine.filter((m) => broken.has(m.id));
  if (split.length) out.push(`拆散的：${split.map((m) => `${spanText(o, m.keys)} 那道 ${m.label}`).join('、')} 被挪开拆散了，不算一段`);
  return out;
}

// 拉了一段以后：这一段对不对（不对的说像哪种错），key 里还差哪几段（判对的时候裁判不写话，还差什么就靠这里告诉老师）；
// 学生的括号那几行（bracketFacts）只写这一下变了的
function facts(before, after, act) {
  if (act?.type === 'refer') return referFacts(before, after);
  if (!before || !after || act?.type !== 'mark') return [];
  const was = new Set(bracketFacts(before));
  const changed = bracketFacts(after).filter((f) => !was.has(f));
  const kb = keySpans(before), ka = keySpans(after);
  if (!kb || !ka) return changed;
  const v = check(before, act);
  if (!v.legal) return [];
  const name = roleName(String(act.role ?? '').trim());
  const out = [v.right ? `这一段对了：${v.why}`
    : v.right == null ? `${v.why}：页面不判（key 里没有这一段）`
      : `这一段不对：${v.why}（${v.misread || conflictOf(before, kb, Math.min(act.from, act.to ?? act.from), Math.max(act.from, act.to ?? act.from), name) || 'key 里没有这一段'}）`];
  const left = okFirst(leftOf(after, ka));
  out.push(left.length ? `key 里还差 ${left.length} 段没拉对：${left.map((k) => spanLine(after, k)).join('、')}` : '正确拆法的每一段都拉对了');
  return [...out, ...changed];
}

// —— 手势表（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）——

// 成分名里有空格、等号（"to do"）就加引号，mark 照样读得懂
const labelSrc = (label) => (/[\s="]/.test(label) ? (label.includes('"') ? `「${label}」` : `"${label}"`) : label);
/** 一个动作 → 学生那一行镜头指令 */
export function actSrc(o, act) {
  if (act.type === 'mark') return `mark ${at(o, act.from, act.to)} ${labelSrc(act.role)}`;
  if (act.type === 'fold') return `fold ${at(o, act.from, act.to)}`;
  if (act.type === 'unfold') return `unfold ${o.id}.${act.at}`;
  if (act.type === 'refer') return `refer ${at(o, act.from, act.from)} -> ${act.to?.whole ? o.id : at(o, act.to.from, act.to.to)}`;
  // 挪到两个词之间：after 是挪到第几个词后面（照挪之前的位置），0 是挪到第一个词前面
  if (act.type === 'move') return `move ${at(o, act.from, act.to)} ${act.after === 0 ? `before ${o.id}.1` : `after ${o.id}.${act.after}`}`;
  if (act.type === 'unmark') return `unmark ${spanText(o, act.keys)}`;
  // 收一条线：只写起头的词（unrefer s.23）；别的线也指着这个词时写到它连的那头，只收这一条（unrefer s.4 -> s.1）
  if (act.type === 'unrefer') return `unrefer ${o.id}.${act.from}${act.to ? ` -> ${act.to.whole ? o.id : at(o, act.to.from, act.to.to)}` : ''}`;
  throw new Error(`句子没有「${act.type}」这个动作`);
}
const made = (o, act) => ({ act, src: actSrc(o, act) });

/**
 * 一行镜头指令 → check 认的动作（actSrc 倒过来）：mark s.2-4 V（连着的一段）、refer s.6 -> s.2 / s.1-2 / s；
 * unmark s.2-5、unrefer s.23（学生点 ✕ 收掉自己拉的：不判，check 交一句「收掉了…」）。折起来、挪词这些不判，给 null
 */
function lineAct(o, c, h) {
  if (c.cmd === 'refer') return referLineAct(o, h);
  if (c.cmd === 'unmark') return unmarkLineAct(o, h);
  if (c.cmd === 'unrefer') return unreferLineAct(o, h);
  if (c.cmd !== 'mark') return null;
  const refs = h.refsIn().filter((w) => String(w).match(/^[A-Za-z_]\w*/)?.[0] === o.id);
  if (!refs.length || refs.includes(o.id)) return null;
  const slots = [...new Set(refs.flatMap((r) => h.scene.parts(r)).map((p) => p.slot))].sort((a, b) => a - b);
  if (!slots.length || slots.at(-1) - slots[0] + 1 !== slots.length) return null; // 不连着的几个词不是一段
  const role = restText(h, refs).trim();
  return role ? { type: 'mark', from: slots[0], to: slots.at(-1), role } : null;
}

// refer s.6 -> s.1-2：箭头前一个词（写了几个照 refer 指令取最前面那个），箭头后一个词、连着的一段，或者整句 s
function referLineAct(o, h) {
  if (h.arrow == null || h.arrow < 0) return null;
  const own = (w) => String(w).match(/^[A-Za-z_]\w*/)?.[0] === o.id;
  const left = h.refsIn(h.args.slice(0, h.arrow)).filter(own), right = h.refsIn(h.args.slice(h.arrow + 1)).filter(own);
  if (!left.length || !right.length || left.includes(o.id)) return null;
  const from = Math.min(...left.flatMap((r) => h.scene.parts(r)).map((p) => p.slot));
  if (right.every((r) => r === o.id)) return { type: 'refer', from, to: { whole: true } };
  const slots = [...new Set(right.flatMap((r) => h.scene.parts(r)).map((p) => p.slot))].sort((a, b) => a - b);
  if (!slots.length || slots.at(-1) - slots[0] + 1 !== slots.length) return null; // 不连着的几个词不是一段
  return { type: 'refer', from, to: { from: slots[0], to: slots.at(-1) } };
}

const ownRefs = (o, h, args) => h.refsIn(args).filter((w) => String(w).match(/^[A-Za-z_]\w*/)?.[0] === o.id);
// unmark s.2-5：收掉正好这几个词的那一道（整句、按成分收的 unmark s 主语 不是 ✕ 那种一道，给 null）
function unmarkLineAct(o, h) {
  const refs = ownRefs(o, h);
  if (!refs.length || refs.includes(o.id) || restText(h, refs).trim()) return null;
  const keys = [...new Set(refs.flatMap((r) => h.scene.parts(r)).map((p) => p.key))];
  return keys.length ? { type: 'unmark', keys } : null;
}
// unrefer s.23 / unrefer s.4 -> s.1：从一个词起头的那条线（写了好几个词、整句的不是 ✕ 那种一条，给 null）
function unreferLineAct(o, h) {
  const arrow = h.arrow ?? -1;
  const left = ownRefs(o, h, arrow >= 0 ? h.args.slice(0, arrow) : undefined);
  if (left.length !== 1 || left[0] === o.id) return null;
  const ps = h.scene.parts(left[0]);
  if (ps.length !== 1) return null;
  if (arrow < 0) return { type: 'unrefer', from: ps[0].slot };
  const r = referLineAct(o, h);
  return r ? { type: 'unrefer', from: r.from, to: r.to } : null;
}

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

// 点一道括号（{ mark: 括号的 id }）或者括号里的一个词（折起含这个词的最里层那一段）；点小方块（{ pill: 折的 id }）是展开：
// unfold 这一段的第一个词（看得见的小方块都是最外层的那一段，unfold 照它展开，里层照旧折着）
function foldAct(o, { from, to } = {}) {
  const x = to ?? from;
  if (x?.pill != null) {
    const f = (o.folds || []).find((fd) => fd.id === x.pill);
    if (!f) return { error: `${o.id} 上没有这个小方块` };
    if (!outerFolds(o).includes(f)) return { error: '这个小方块折在外面那一段里：先展开外面的' };
    const slot = slotMap(o);
    return made(o, { type: 'unfold', at: Math.min(...f.keys.map((k) => slot.get(k))) });
  }
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
  // 套着折：里层折着也能折外层（里层留在外层的小方块里）；正好是折起来的那一段、和折起来的交叉的，和 fold 指令一样说
  const clash = foldClash(o, m.keys);
  if (clash) return { error: clash };
  return made(o, { type: 'fold', from: p, to: q });
}

// 按住一道括号（{ mark: 括号的 id }，整段挪）或一个词（挪一个）拖到两个词之间（{ gap: { after: 第几个词 } }，0 是第一个词前面）：
// move s.1-6 after s.11 / move s.3 before s.1（sentence.js 的 move 本来就能挪一段）
function moveAct(o, { from, to } = {}) {
  let p, q;
  if (from?.mark != null) {
    const m = (o.marks || []).find((mk) => mk.id === from.mark);
    if (!m) return { error: `${o.id} 上没有这道括号` };
    const slot = slotMap(o);
    const xs = m.keys.map((k) => slot.get(k)).filter((v) => v != null);
    p = Math.min(...xs); q = Math.max(...xs);
    if (q - p + 1 !== m.keys.length) return { error: '这道括号的词不连着，整段挪不了' };
  } else {
    const a = slotOf(o, from);
    if (a == null) return { error: '按住一道括号或一个词，拖到两个词之间' };
    p = q = a;
  }
  const ws = ordered(o);
  const inFold = (w) => w && outerFolds(o).find((f) => f.keys.includes(w.key));
  if (ws.slice(p - 1, q).some(inFold)) return { error: '折起来的词不能挪：先展开' };
  const k = to?.gap?.after;
  if (!Number.isInteger(k) || k < 0 || k > ws.length) return { error: '拖到两个词之间' };
  if (k >= p && k < q) return { error: '落点在要挪的那一段里面' };
  if (k === p - 1 || k === q) return { error: '还在原处：拖到别的两个词之间' };
  const f = inFold(ws[k - 1]);
  if (f && f === inFold(ws[k])) return { error: '不能挪进折起来的那一段：先展开' };
  return made(o, { type: 'move', from: p, to: q, after: k });
}

// —— 学生做的自己收掉（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 2.4 节）：学生拉的括号、连的线头上的 ✕ ——
// 老师画的不带 ✕，收不了；开着 mark 才收得了括号、开着 refer 才收得了线（gestures.js 的 closeAct 照 open 的那一项找 close）

// 点括号上的 ✕（{ mark: 括号的 id }）：unmark 这道括号的词（拆散了的照样写得出：unmark s.2 s.8-9）
function unmarkAct(o, { from } = {}) {
  const m = from?.mark != null ? (o.marks || []).find((mk) => mk.id === from.mark) : null;
  if (!m) return { error: `${o.id} 上没有这道括号` };
  if (m.by !== 'student') return { error: '老师画的括号收不了' };
  return made(o, { type: 'unmark', keys: [...m.keys] });
}
// 点线头上的 ✕（{ refer: 线的 from 的 key }）：unrefer 起头的那个词；别的线也指着这个词（unrefer s.4 会连带收掉）时写到它连的那头
function unreferAct(o, { from } = {}) {
  const r = from?.refer != null ? (o.refers || []).find((x) => x.from === from.refer) : null;
  if (!r) return { error: `${o.id} 上这个词没有连出去的线` };
  if (r.by !== 'student') return { error: '老师画的线收不了' };
  const slot = slotMap(o);
  const a = slot.get(r.from);
  if (a == null) return { error: `${o.id} 上这个词没有连出去的线` };
  const others = (o.refers || []).some((x) => x !== r && (x.from === r.from || x.to === r.from || (x.toKeys || []).includes(r.from)));
  if (!others) return made(o, { type: 'unrefer', from: a });
  const xs = (r.whole ? [] : r.toKeys || [r.to]).map((k) => slot.get(k));
  if (xs.some((v) => v == null)) return { error: '这条线连的那头不在了' };
  return made(o, { type: 'unrefer', from: a, to: r.whole ? { whole: true } : { from: Math.min(...xs), to: Math.max(...xs) } });
}

// 从钩上拉一条线（from 是钩挂着的那个词）松在：一个词、一道括号（{ mark: 括号的 id }）、句子外框（{ whole: true }）→ refer s.6 -> s.5 / s.4-5 / s
function referAct(o, { from, to } = {}) {
  const a = slotOf(o, from);
  if (a == null) return { error: '从一个词上的钩拉出一条线' };
  if (to == null) return { error: '把线松在它指的词、括号或句子外框上' };
  let t;
  if (to.whole) t = { whole: true };
  else if (to.mark != null) {
    const m = (o.marks || []).find((mk) => mk.id === to.mark);
    if (!m) return { error: `${o.id} 上没有这道括号` };
    const slot = slotMap(o);
    const xs = m.keys.map((k) => slot.get(k)).filter((v) => v != null);
    const p = Math.min(...xs), q = Math.max(...xs);
    if (q - p + 1 !== m.keys.length) return { error: '这道括号的词不连着，线连不过去' };
    t = { from: p, to: q };
  } else {
    const b = slotOf(o, to);
    if (b == null) return { error: '把线松在它指的词、括号或句子外框上' };
    t = { from: b, to: b };
  }
  const w = ordered(o)[a - 1];
  if (!t.whole && t.from === a && t.to === a) return { error: '线要连到别的词上' };
  if (!t.whole && t.from <= a && a <= t.to) return { error: `${w.value} 在这一段里面：连到别处` };
  return made(o, { type: 'refer', from: a, to: t });
}

// 拉好一段以后点的那一排成分：常用的几个（只列 key 里有的，等于把答案告诉了学生），key 里还有别的成分也补上（不然拉对了也点不出来）。
// 按钮上写中文、小字是缩写，颜色和画出来的括号一样（roleColor）；点了交中文（mark s.2-4 谓语）：学生点的是什么，括号上就画什么
const SPAN_ROLES = ['S', 'V', 'O', 'P', 'A', 'Attr', 'RC', 'NF'];
function spanChoices(o) {
  const out = [];
  const add = (r) => {
    const name = roleName(r);
    if (!r || out.some((c) => c.sub === r || (name && roleName(c.value) === name))) return; // V1、V2 和 V 是同一个按钮
    const zh = ROLE_NAMES[r.replace(/(\D)\d+$/, '$1')] || name || r;
    out.push({ value: zh, text: zh, sub: r, paint: roleColor(r) });
  };
  SPAN_ROLES.forEach(add);
  if (o?.key && !o.key.void) for (const sp of o.key.spans) for (const r of sp.roles || [sp.role]) add(r);
  return out;
}

// 同一句上这几项能一起开：拉括号是在词上滑、折是点、挪是按住再拖（gestures.js 的 PRESS_OF），一下只认成一种
const gestures = {
  // 从一个词拉到另一个词，再点成分标签（value 是点的那个成分）：mark s.2-5 V；学生拉的括号上的 ✕：unmark s.2-5
  mark: { gesture: 'span', from: 'word', to: 'word', pick: 'role', choices: spanChoices, toAct: markAct, close: { on: 'xmark', toAct: unmarkAct } },
  // open s fold：点一段（括号或括号里的词）折起来：fold s.3-6；点小方块展开：unfold s.3
  fold: { gesture: 'tap', on: ['bracket', 'word', 'pill'], toAct: foldAct },
  // open s move：按住一道括号或一个词拖到两个词之间：move s.1-6 after s.11
  move: { gesture: 'drop-at', from: ['bracket', 'word'], to: 'gap', toAct: moveAct },
  // open s.6 refer：从词上的钩拉一条线，松在词、括号、句子外框上：refer s.6 -> s.2 / s.4-5 / s（钩是单独的把手，和在词上拉括号不抢）；
  // 学生连的线头上的 ✕：unrefer s.6
  refer: { gesture: 'line', from: 'hook', to: ['word', 'bracket', 'sentence'], toAct: referAct, close: { on: 'xrefer', toAct: unreferAct }, idle: referIdle },
};

// 钩挂在折起来的词上就没有钩（画面不画、学生拉不了）：舞台现状照实说（gestures.js 的 idleOf）。all：老师点了名的钩一个都挂不上
function referIdle(o, e, scene) {
  const { keys, folded } = hookWords(o, e, (r) => scene.parts(r));
  if (!folded.length) return null;
  const slot = new Map(o.words.map((w) => [w.key, w.slot]));
  return { all: !keys.length, text: `${folded.map((k) => `${o.id}.${slot.get(k)}`).join(' ')} 折着，展开以后才能拉` };
}

// —— 挑战用的判断式（when="s parsed, s main, s span s.2-5 = V"）——

// 没写 key、key 作废了：这句话本身永远判不了（不是「还没做到」），抛错——写下挑战时当场报，舞台现状里写「判不了」和原因
const cannot = (o, what) => new Error(o?.key?.void ? `${o.id} 的 key 跟着 ${voidBy(o.key)} 作废了，页面判不了 ${what}（要判就重新造这句、带上新的 key=）` : `${o.id} 没写 key=（正确拆法），页面判不了 ${what}`);
const predicates = {
  // key 里的每一段都拉对了
  parsed: (o) => {
    const ks = keySpans(o);
    if (!ks) throw cannot(o, 'parsed');
    return leftOf(o, ks).length === 0;
  },
  // key 里的每一段都拉对了，学生也没多拉 key 里没有的括号（老师自己拉的不算多拉的；拆散了的算）
  exact: (o) => {
    const ks = keySpans(o);
    if (!ks) throw cannot(o, 'exact');
    if (leftOf(o, ks).length) return false;
    const slot = slotMap(o);
    const inKey = (m) => {
      const xs = m.keys.map((k) => slot.get(k)).filter((v) => v != null);
      const from = Math.min(...xs), to = Math.max(...xs);
      return to - from + 1 === m.keys.length && ks.some((k) => k.ok && k.from === from && k.to === to && fitsK(k, roleName(m.label)));
    };
    return !(o.marks || []).some((m) => m.by === 'student' && !inKey(m));
  },
  // links= 的每一条都连对了（别的词上多连的线不管）
  linked: (o) => {
    if (!o?.links) throw new Error(`${o?.id} 没写 links=，页面判不了 linked（造句子时写 links="that -> books"）`);
    if (o.links.void) throw new Error(`${linkVoid(o)}，页面判不了 linked（要判就重新造这句、带上新的 links=）`);
    return linksNow(o).missing === 0;
  },
  // 主干（最外层的主语、谓语、宾语 / 表语）拉对了
  main: (o) => {
    const ks = keySpans(o);
    if (!ks) throw cannot(o, 'main');
    const trunk = ks.filter((k) => k.depth === 0 && k.names.some((n) => MAIN.has(n)));
    if (!trunk.length) throw new Error(`${o.id} 的 key 里没有主干（最外层的主语、谓语、宾语、表语），页面判不了 main`);
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
    if (!role) throw new Error(`span 的成分「${m[2]}」认不出（写 V、谓语、S、主语、RC、定语从句……）`);
    return (o.marks || []).some((mk) => mk.keys.length === keys.size && mk.keys.every((k) => keys.has(k)) && fits(role, roleName(mk.label)));
  },
};

// —— 量（verbs(s)、verbs(s.4-14)、left(s)；rules.js 的 measures）——
// 照 key 数（页面不自己分析英语）：写一段时，key 的段整个落在这一段里才算。没写 key、key 作废了这句话本身数不了，抛错
const noKey = (o) => new Error(o?.key?.void ? `${o.id} 的 key 跟着 ${voidBy(o.key)} 作废了` : `${o.id} 没写 key`);
function spansIn(o, parts) {
  const ks = keySpans(o);
  if (!ks) throw noKey(o);
  const keys = parts && new Set(parts.map((w) => w.key));
  return { ks, inside: (k) => !keys || k.keys.every((x) => keys.has(x)) };
}
const measures = {
  // key 里的谓语几段
  verbs: (o, parts) => { const { ks, inside } = spansIn(o, parts); return ks.filter((k) => has(k, '谓语') && inside(k)).length; },
  // key 里还没拉对的几段
  left: (o, parts) => { const { ks, inside } = spansIn(o, parts); return leftOf(o, ks).filter(inside).length; },
};

/**
 * tally s V 标的数（sentence.js 的 layout 画、describe 写）：{ name（数的成分）, each: Map(学生括号的 id → 里面 key 的这种成分几段), rest（不在哪道学生括号里的几段）}。
 * 照 key 数（整段落在括号里才算在里面；拆散了的括号不算一段）；没开 tally、没写 key、key 作废了是 null
 */
export function tallyOf(o) {
  if (!o?.tally) return null;
  const ks = keySpans(o);
  if (!ks) return null;
  const name = roleName(o.tally);
  const want = ks.filter((k) => fitsK(k, name));
  const broken = new Set(brokenMarks(o));
  const mine = (o.marks || []).filter((m) => m.by === 'student' && !broken.has(m.id));
  const inside = (m, k) => k.keys.every((x) => m.keys.includes(x));
  // 学生自己标成这个成分的（「一件事一盏灯」的灯）不是装东西的括号：不给它写数（写了 0 等于当场告诉学生标错了），
  // 也不算进「括号外」——以前学生一点灯，「括号外」就一直是 0（底座第二轮留下的第 1 条）。灯另外数：每道括号里几处、括号外几处
  const lamp = (m) => roleName(m.label) === name;
  const lamps = mine.filter(lamp), boxes = mine.filter((m) => !lamp(m));
  const each = new Map(boxes.map((m) => [m.id, want.filter((k) => inside(m, k)).length]));
  const eachMine = new Map(boxes.map((m) => [m.id, lamps.filter((l) => inside(m, l)).length]));
  return { name, each, eachMine, rest: want.filter((k) => !boxes.some((m) => inside(m, k))).length, lamps: lamps.length, restMine: lamps.filter((l) => !boxes.some((m) => inside(m, l))).length };
}

// 拉括号、拉线的每一下都判（折起来不判）；做完了（key 里每一段都拉对了）只对交给了学生拉括号的句子算（线连完了要判写 when="s linked"）
/**
 * 这一下挪了的词（ask pick 交了以后和真变了的比，rules.js 的 changedKeys）：前后都在、字变了的，和这一行真挪了的，照现在的先后。
 * 挪了的照这一行指令交的 fx.moved（move、rewrite 都交）：只有前后两份分不出哪一段是挪的那一段（move s.1-5 after s.6 和
 * move s.6 before s.1 挪完一模一样），给它让位、往前往后错了一格的词不算「变了」——学生只点了挪的那个词，不该看到让位的词是
 * 「变了却没点的」。挪了却落回原处的（move s.3 after s.2）也不算
 */
function changed(before, after, fx) {
  const was = new Map((before?.words || []).map((w) => [w.key, w]));
  const moved = new Set(fx && fx.id === after?.id && Array.isArray(fx.moved) ? fx.moved : []);
  return ordered(after || { words: [] }).filter((w) => {
    const m = was.get(w.key);
    // 只换了大小写的不算字变了（挪到句首 / 从句首挪走，页面替它换的大小写）
    const recased = m && (m.slot === 1 || w.slot === 1) && m.value !== w.value && m.value.toLowerCase() === w.value.toLowerCase();
    return !!m && ((m.value !== w.value && !recased) || (moved.has(w.key) && m.slot !== w.slot));
  }).map((w) => w.key);
}

export const sentenceRules = { next, check, predicates, measures, facts, changed, gestures, actOf: lineAct, judges: ['mark', 'refer'], doneBy: ['mark'] };
