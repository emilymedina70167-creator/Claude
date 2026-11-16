// 预案（docs/board-plan.md 第 1 节）：课堂 Claude 出题时顺手写好答案固定时接什么，学生作答以后页面当场接上，不调用、不用等。
// 每调用一次要重发整份说明（2～6 万 token），学生还要等几十秒，省下来的是整轮。
// 界线（2026-11-03 学生说的）：教学不预制——答错了怎么引导、想不出来怎么提示、下一步讲什么，都要 Claude 看着这一次的作答当场写，
// 预制就是模版化；只有答案固定、它当场写也几乎一样的才预写：答对了（一句确认 + 揭开这一轮已经写好的下一小问）、例题看完了。
// 所以 wrong / misread / giveup 读得懂但不收（写了告诉它为什么），页面只接 right / done。
// 预案没写到的、学生打字说话、附图、板书、「没把握」，照旧叫 Claude。纯函数，不碰 DOM（tests/class-react.test.js）。
import { tokenize } from '../tokens.js';

// 情况：答对、答错、页面认出来的错法、想不出来 / 看了答案、steps 揭开了最后一步
export const REACT_KINDS = ['right', 'wrong', 'misread', 'giveup', 'done'];
// 页面能替它接的：答案固定、当场写也一样的
export const LOCAL_KINDS = ['right', 'done'];
export const LIVE_NOTE = '答错、错法、想不出来怎么接，要看学生这一次的作答当场写（学生要实时的教学，不要预制好的引导），页面不替你接：这一行没用。预案只写答对（right）和看完（done）';
const ALIAS = { 对: 'right', 答对: 'right', 错: 'wrong', 答错: 'wrong', 错法: 'misread', 想不出来: 'giveup', 放弃: 'giveup', 看完: 'done' };
// 一条预案说的话最多多长：是一句接话，不是一段讲解（讲解写成藏着的段，用 show= 揭开）
export const REACT_TEXT_MAX = 300;
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,64}$/;

/**
 * board react target=q1 的块：一行一条「情况 [选项]: 说的话」。
 *   right show=b4: 对。那换一组数呢？
 *   done step=3: 例题看完了，下面这道你来。
 * 返回 { op: 'react', target, cases: [{ kind, key?, step?, show: [], text }], errors? }；一条都没写就是撤掉这个组件的预案（cases 为空）。
 * 开头那行看不懂、一条也没读懂时返回 { error }。
 */
export function parseReact(rest, body = '') {
  let target;
  for (const t of tokenize(String(rest ?? ''))) {
    if (t.key === 'target' || t.key === 'id') target = t.value;
    else if (!t.key && target === undefined) target = t.value;
  }
  if (!target) return { error: 'react 缺少 target（组件的 id），比如 react target=q-b3' };
  if (!ID_RE.test(target)) return { error: `react 的 target「${target}」不合法` };
  const cases = [];
  const errors = [];
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.trim().replace(/^[-*]\s+/, '');
    if (!line) continue;
    const r = parseCaseLine(line);
    if (r.error) errors.push(`「${line.slice(0, 40)}」：${r.error}`);
    else cases.push(r);
  }
  if (!cases.length && errors.length) return { error: errors[0] };
  return { op: 'react', target, cases, ...(errors.length ? { errors } : {}) };
}

function parseCaseLine(line) {
  // 冒号前是情况和选项，后面是说的话（话里可以再有冒号）。冒号可以写在引号里的错法关键词里，所以跳过引号找
  const at = headEnd(line);
  if (at < 0) return { error: '要写成「情况: 说的话」，比如 right: 对。' };
  const head = line.slice(0, at).trim();
  const text = line.slice(at + 1).trim();
  const toks = tokenize(head);
  if (!toks.length || toks[0].key) return { error: '开头要写情况：right / wrong / misread "…" / giveup / done' };
  const w = toks[0].value.toLowerCase();
  const kind = REACT_KINDS.includes(w) ? w : ALIAS[toks[0].value];
  if (!kind) return { error: `看不懂的情况「${toks[0].value}」：只认 right / wrong / misread / giveup / done` };
  const out = { kind, show: [], text: text.slice(0, REACT_TEXT_MAX) };
  for (const t of toks.slice(1)) {
    if (t.key === 'show') out.show.push(...t.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean));
    else if (t.key === 'step') {
      const n = Number(t.value);
      if (!(Number.isInteger(n) && n >= 1)) return { error: `step 要写第几步（从 1 数），不是「${t.value}」` };
      out.step = n;
    } else if (!t.key && kind === 'misread' && out.key === undefined) out.key = t.value;
    else return { error: `看不懂「${t.key ? `${t.key}=` : ''}${t.value}」` };
  }
  if (!LOCAL_KINDS.includes(kind)) return { error: LIVE_NOTE };
  for (const id of out.show) if (!ID_RE.test(id)) return { error: `show 的段 id「${id}」不合法` };
  if (!out.text && !out.show.length) return { error: '冒号后面没写要说的话' };
  return out;
}

function headEnd(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === '“') { q = c === '"' ? '"' : '”'; continue; }
    if (c === '「') { q = '」'; continue; }
    if (c === ':' || c === '：') return i;
  }
  return -1;
}

const typeOf = (a) => String(a?.type ?? a?.kind ?? '').replace(/-try$/, '');
const okOf = (a) => (typeof a?.ok === 'boolean' ? a.ok : typeof a?.detail?.ok === 'boolean' ? a.detail.ok : null);

// 作答在多步组件（steps、演示）里的第几步：事件里 detail 摊开后 step 是数；记录里写在 detail「第 n 步」
export function stepOf(a) {
  if (typeof a?.detail?.step === 'number') return a.detail.step;
  if (a?.source === 'event' && typeof a.step === 'number') return a.step;
  const m = /第\s*(\d+)\s*步/.exec(typeof a?.detail === 'string' ? a.detail : '');
  return m ? Number(m[1]) : undefined;
}

/**
 * 一条排着的动作归到哪种情况。trig 是课堂算好的（prompt.js 的 actionTrigger）：
 * 'later'（揭开中间一步、拖一拖、标了有把握）不用老师 → { kind: 'passive' }；
 * 归不进任何情况（打字说的、没判对错的、「没把握」、停久了的提醒）→ null，要叫 Claude。
 */
export function classify(a, trig) {
  if (!a || typeof a !== 'object') return null;
  const type = typeOf(a);
  // 'later' 的（拖一拖、揭开中间一步、点开预写的「为什么」）不用老师，跟着下一条走
  if (trig === 'later') return { kind: 'passive' };
  if (a.source === 'page') return null;
  if (type === 'sure') return null; // 答对了却没把握：根本规则里没把握按没会处理，老师要马上知道
  const step = stepOf(a);
  if (a.source === 'event' && type === 'reveal') return { kind: 'done', step };
  if (a.giveup || a.revealed || (a.source === 'event' && type === 'giveup')) return { kind: 'giveup', step };
  const ok = okOf(a);
  // 选择题答错不单独发（quiz 只在答对时记一条，前面错选的在 wrong 里）：错选过再对的，可能是试出来的，交给老师
  if (ok === true && type === 'quiz' && Array.isArray(a.wrong) && a.wrong.length) return null;
  if (ok === true) return { kind: 'right', step };
  if (ok === false) return { kind: 'wrong', step, misread: typeof a.misread === 'string' ? a.misread : '' };
  return null;
}

// 一个组件的预案里，这一种情况用哪一条（used：这一批里已经用掉的下标）
function pick(rule, cls, used) {
  const ok = (c, i) => !c.used && !used.has(i) && (c.step === undefined || c.step === cls.step);
  if (cls.kind === 'wrong' && cls.misread) {
    const low = cls.misread.toLowerCase();
    const i = rule.cases.findIndex((c, k) => c.kind === 'misread' && ok(c, k) && low.includes(String(c.key).toLowerCase()));
    if (i >= 0) return i;
  }
  return rule.cases.findIndex((c, k) => c.kind === cls.kind && ok(c, k));
}

/**
 * 这一批排着的动作能不能页面自己接。
 * items：[{ a, trig }]；rules：Map 组件 id → { target, seq, seg, cases: [{ kind, key, step, show, text, used }] }；
 * other：这一批还有学生打的字、附的图、板书 → 一定叫 Claude。present(id)：组件还在黑板上（没撤回）。
 * 返回 null（要叫 Claude）或 { fired: [{ target, index, kind, text, show }], talk, show }。不改 rules。
 */
export function planLocal({ items = [], rules, other = false, present = () => true } = {}) {
  if (other || !rules?.size) return null;
  const fired = [];
  const usedBy = new Map();
  for (const { a, trig } of items) {
    const cls = classify(a, trig);
    if (!cls) return null;
    if (cls.kind === 'passive') continue;
    if (!LOCAL_KINDS.includes(cls.kind)) return null; // 答错、想不出来：叫 Claude 当场看着作答写
    const rule = a.block ? rules.get(a.block) : null;
    if (!rule || !present(a.block)) return null;
    const used = usedBy.get(a.block) || new Set();
    const i = pick(rule, cls, used);
    if (i < 0) return null;
    used.add(i);
    usedBy.set(a.block, used);
    const c = rule.cases[i];
    fired.push({ target: a.block, seq: rule.seq, index: i, kind: c.kind, key: c.key, text: c.text, show: c.show || [] });
  }
  if (!fired.length) return null;
  return {
    fired,
    talk: fired.map((f) => f.text).filter(Boolean).join('\n\n'),
    show: [...new Set(fired.flatMap((f) => f.show))],
  };
}

const KIND_TEXT = { right: '答对', wrong: '答错', misread: '错法', giveup: '想不出来', done: '看完了' };

/** 页面接了以后记给 Claude 的一行（下一次调用时它看得到自己预写的哪条用掉了） */
export function reactNote(plan) {
  const what = plan.fired.map((f) => `${f.target} ${KIND_TEXT[f.kind]}${f.kind === 'misread' ? `「${f.key}」` : ''}`).join('、');
  const said = plan.talk ? `板顶换成「${plan.talk.replace(/\s+/g, ' ').slice(0, 200)}」` : '';
  const shown = plan.show.length ? `揭开了 ${plan.show.join('、')}` : '';
  return `[系统] 页面按你预写的预案接了（${what}）：${[said, shown].filter(Boolean).join('；') || '什么也没说'}。这一次没有调用你。`;
}

/** 用掉了：答对了这个组件的预案全部收起；别的每条只用一次 */
export function markFired(rules, plan) {
  for (const f of plan.fired) {
    const rule = rules.get(f.target);
    if (!rule) continue;
    // 答对整组收起；但只管某一步的（steps 上的 right step=2）只用掉那一条，后面几步的预案、done 照常
    if (f.kind === 'right' && rule.cases[f.index]?.step === undefined) { rules.delete(f.target); continue; }
    if (rule.cases[f.index]) rule.cases[f.index].used = true;
    if (rule.cases.every((c) => c.used)) rules.delete(f.target);
  }
}

/** 一条还没用的预案的简写（黑板现状里列给 Claude） */
export function armedText(rule) {
  const left = (rule?.cases || []).filter((c) => !c.used);
  if (!left.length) return '';
  return left.map((c) => `${c.kind}${c.key ? ` "${c.key}"` : ''}${c.step ? ` step=${c.step}` : ''}${c.show?.length ? ` show=${c.show.join(',')}` : ''}`).join('、');
}

/**
 * 刷新后重建预案：按顺序走 class_turns。Claude 那一轮的 boardOps 里 react 记着整条预案（seq、所在段），
 * 改写 / 撤回 / 揭开同一段之前的预案作废；页面接过的那一轮（kind react）记着用掉了哪几条。
 */
export function rebuildRules(history = []) {
  const rules = new Map();
  for (const t of history) {
    if (!t || t.discarded) continue;
    if (t.role === 'claude' && Array.isArray(t.boardOps)) {
      for (const o of t.boardOps) {
        if (!o) continue;
        if (o.op === 'react' && o.ok) {
          if (o.cases?.length) rules.set(o.target, { target: o.target, seq: t.seq, seg: o.seg, by: o.by, cases: o.cases.map((c) => ({ ...c, used: false })) });
          else rules.delete(o.target);
        } else if (o.ok && ['replace', 'hide', 'unpin'].includes(o.op)) dropForSeg(rules, o.id, t.seq);
      }
    } else if (t.kind === 'react' && Array.isArray(t.fired)) {
      markFired(rules, { fired: t.fired.filter((f) => rules.get(f.target)?.seq === f.seq) });
    }
  }
  return rules;
}

/** 段被改写 / 撤回：之前几轮挂在这一段组件上的预案作废（这一轮自己写的不算：常见写法是先 replace 再 react） */
export function dropForSeg(rules, segId, seq) {
  for (const [k, r] of rules) if (r.seg === segId && r.seq < seq) rules.delete(k);
}
