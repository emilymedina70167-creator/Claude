// 句子（拆成分）的规则（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 1 节）：照老师造句子时给的正确拆法
// （key="[S The man [RC who lives next door]] [V is] a doctor."，sentence.js 的 parseKey 读成 o.key）逐词比学生拉的括号、
// 认四种错法；下一步、写给老师的事实、挑战用的判断式、手势表。纯函数，有测试（tests/stage-sentence-rules.test.js）；在 types/index.js 里登记。
//
// 页面不自己分析英语语法：拉得对不对只看 key，说「像哪种错」也只说 key 印证得了的（「把非谓语当成了谓语」要那几个词落在 key 的非谓语里；
// 只有「谓语只圈了一半」挑说法时看一眼 be / have 后面是不是分词）。认不出就不说，宁可 misread 是 null，也不给老师写错的事实。
// 一段 = 现在连着的几个词（从第几个到第几个）。拉对一段：舞台上有一道括号正好是 key 里的这一段、成分一样
// （成分名照 sentence.js 的 roleName / sameRole 对：V 和「谓语」是一个，分词、to do 是非谓语，只写「从句」对得上任何一种从句）。
// 拉错了的括号留着也不碍事（舞台上没有让学生收括号的手势），只看 key 里的每一段有没有拉对。
import { judgeSpans } from '../../entext.js';
import { sentence, ordered, roleName, sameRole, phraseOf, restText } from './sentence.js';

export { roleName, ROLE_NAMES } from './sentence.js';

// 主干：最外层的主语、谓语、宾语、表语（和作这几种成分的从句）
const MAIN = new Set(['主语', '谓语', '宾语', '间接宾语', '直接宾语', '表语', '补语', '宾补', '主语从句', '宾语从句', '表语从句']);

// —— 词 ——

const lower = (w) => String(w ?? '').toLowerCase().replace(/’/g, "'");
const at = (o, a, b) => (a === b ? `${o.id}.${a}` : `${o.id}.${a}-${b}`);
const textOf = (o, a, b) => phraseOf(ordered(o).filter((w) => w.slot >= a && w.slot <= b));
const slotMap = (o) => new Map(o.words.map((w) => [w.key, w.slot]));

/** key 里的每一段按现在的位置：{ role（key 里写的）, name（成分）, keys, depth, from, to, ok（现在还连着、拉得成一段）}，从外到里；没写 key、key 作废了是 null */
function keySpans(o) {
  if (!o?.key?.spans?.length || o.key.void) return null;
  const slot = slotMap(o);
  return o.key.spans.map((sp) => {
    const slots = sp.keys.map((k) => slot.get(k)).filter((v) => v != null);
    const from = Math.min(...slots), to = Math.max(...slots);
    return { role: sp.role, name: roleName(sp.role), keys: sp.keys, depth: sp.depth, from, to, ok: slots.length === sp.keys.length && to - from + 1 === slots.length };
  }).sort((p, q) => p.depth - q.depth || p.from - q.from);
}
/** 判不了的时候怎么说：没写 key，还是写了但被 rewrite 作废了 */
const noKeyWhy = (o) => (o?.key?.void ? `${o.id} 的 key 跟着 rewrite 作废了，要判就重写 key（重新造这句、带上新的 key=）` : `${o.id} 没写 key=（正确拆法），页面不判`);

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
    const k = ks.find((x) => x.ok && x.from === from && x.to === to && sameRole(x.name, name));
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
const spanLine = (o, k) => (k.ok ? `${at(o, k.from, k.to)} ${k.name}（${textOf(o, k.from, k.to)}）` : `${k.name}（${spreadText(o, k)}）被 move 拆散了，拉不成一段`);
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
  const head = first ? `${first.name}是 ${at(o, first.from, first.to)}（${textOf(o, first.from, first.to)}）` : '';
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

/**
 * 把非谓语当成了谓语：标成谓语的这一截落在 key 的非谓语里（[NF …]，或者 key 里写成 doing / done 的一段）。
 * 只引落在那一段里的词；key 没说是非谓语的（从句里 key 没拉的谓语、to + 名词、名词）不说
 */
function nonFiniteText(o, ks, p, q) {
  const nf = ks.filter((k) => k.ok && k.name === '非谓语' && k.from <= q && p <= k.to).sort((x, y) => (x.to - x.from) - (y.to - y.from))[0];
  if (!nf) return null;
  const lo = Math.max(p, nf.from), hi = Math.min(q, nf.to);
  const whole = textOf(o, nf.from, nf.to);
  return lo === nf.from && hi === nf.to ? `「${whole}」是非谓语，不是谓语` : `${textOf(o, lo, hi)} 在非谓语「${whole}」里，不是谓语`;
}

// 不是 key 里的那一段：像哪种错（docs/superpowers/plans/2026-11-06-stage-base.md 第 7 个任务的表；认不出来的给 null）。
// rel 是 key 里学生最像在拉的那一段（「现在正确的」先说它）；shown 是学生写的成分（认得出写中文名）
function misreadOf(o, ks, a, b, name, shown) {
  const overlaps = (k) => k.from <= b && a <= k.to;
  if (name === '谓语') {
    const vs = ks.filter((k) => k.ok && k.name === '谓语');
    // 谓语只圈了一半：拉的是 key 里一个谓语里面的一部分（一样的那段已经判对了）
    const half = vs.find((k) => a >= k.from && b <= k.to);
    if (half) return { rel: half, misread: halfText(o, half) };
    // 拉的这一段和谓语不沾边，或者整个包住了谓语：多出来的那几截落在 key 的非谓语里
    const touched = vs.filter(overlaps);
    if (touched.every((k) => a <= k.from && b >= k.to)) {
      for (const [p, q] of runsOutside(a, b, touched)) {
        const nf = nonFiniteText(o, ks, p, q);
        if (nf) return { rel: touched[0] || vs[0] || null, misread: `把非谓语当成了谓语：${nf}` };
      }
    }
  }
  // 段对了，成分不对
  const same = ks.find((k) => k.ok && k.from === a && k.to === b);
  if (same) return { rel: same, misread: `成分标错了：这一段是${same.name}，不是${shown}` };
  // 断早、断晚：同一成分（写泛称「从句」的对得上任何一种从句）的一段，沾边、两头各差不过两个词；成分也不一样的不说
  const dist = (k) => Math.abs(a - k.from) + Math.abs(b - k.to);
  const k = ks.filter((x) => x.ok && sameRole(x.name, name) && overlaps(x) && Math.abs(a - x.from) <= 2 && Math.abs(b - x.to) <= 2).sort((p, q) => dist(p) - dist(q))[0];
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
  if (!ks) return { legal: true, right: null }; // 没写正确拆法（或者作废了）：不判
  const why = `${at(o, a, b)} 标成${label}（${textOf(o, a, b)}）`;
  const name = roleName(label);
  if (ks.some((k) => k.ok && k.from === a && k.to === b && sameRole(k.name, name))) return { legal: true, right: true, misread: null, why, next: null };
  const { misread, rel } = misreadOf(o, ks, a, b, name, name ?? label);
  return { legal: true, right: false, misread, why, next: nowRight(o, ks, rel) };
}

// —— 写给老师的事实 ——

// 拉了一段以后：这一段对不对（不对的说像哪种错），key 里还差哪几段（判对的时候裁判不写话，还差什么就靠这里告诉老师）
function facts(before, after, act) {
  if (!before || !after || act?.type !== 'mark') return [];
  const kb = keySpans(before), ka = keySpans(after);
  if (!kb || !ka) return [];
  const v = check(before, act);
  if (!v.legal) return [];
  const out = [v.right ? `这一段对了：${v.why}` : `这一段不对：${v.why}（${v.misread || 'key 里没有这一段'}）`];
  const left = okFirst(leftOf(after, ka));
  out.push(left.length ? `key 里还差 ${left.length} 段没拉对：${left.map((k) => spanLine(after, k)).join('、')}` : '正确拆法的每一段都拉对了');
  return out;
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

/** 一行镜头指令 → check 认的动作（actSrc 倒过来）：mark s.2-4 V（连着的一段）。折起来、挪词这些不判，给 null */
function lineAct(o, c, h) {
  if (c.cmd !== 'mark') return null;
  const refs = h.refsIn().filter((w) => String(w).match(/^[A-Za-z_]\w*/)?.[0] === o.id);
  if (!refs.length || refs.includes(o.id)) return null;
  const slots = [...new Set(refs.flatMap((r) => h.scene.parts(r)).map((p) => p.slot))].sort((a, b) => a - b);
  if (!slots.length || slots.at(-1) - slots[0] + 1 !== slots.length) return null; // 不连着的几个词不是一段
  const role = restText(h, refs).trim();
  return role ? { type: 'mark', from: slots[0], to: slots.at(-1), role } : null;
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
  // key 里的每一段都拉对了（没写 key、key 作废了是 null：判不了）
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
    if (!role) throw new Error(`span 的成分「${m[2]}」认不出（写 V、谓语、S、主语、RC、定语从句……）`);
    return (o.marks || []).some((mk) => mk.keys.length === keys.size && mk.keys.every((k) => keys.has(k)) && sameRole(roleName(mk.label), role));
  },
};

// 拉括号的每一下都判（折起来不判）；做完了（key 里每一段都拉对了）只对交给了学生拉括号的句子算
export const sentenceRules = { next, check, predicates, facts, gestures, actOf: lineAct, judges: ['mark'], doneBy: ['mark'] };
