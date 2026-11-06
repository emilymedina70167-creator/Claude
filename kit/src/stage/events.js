// 活的舞台上学生做的事（docs/stage-plan.md E 段）：哪些要马上叫老师、哪些攒着；攒下来的怎么写给老师看。纯函数，有测试（tests/stage-events.test.js）。
//
// 学生在舞台上随时能动（拨格子、拖、点开看怎么算），这些是「试」：一下一下都告诉老师太碎、也太慢（每叫一次老师就是一整轮），
// 所以攒着，等到有要老师接的事——答了老师问的、做到了挑战、打字、点「给个提示」、试了好多下还没做到、很久没动——
// 一起写成一段发过去。老师照它看学生是怎么试的、卡在哪，再当场写下一步。
import { actText } from './stage.js';

/** 试了几下还没做到就叫老师（不等学生自己点提示） */
export const TRY_MAX = 8;
/** 挑战还没做到、学生多久没动就叫老师（毫秒） */
export const QUIET_MS = 45000;
/** 发给老师的 [学生] 一块最多多少字节（UTF-8，连那一行标题）：学生在老师想的时候试了好多下，前面的并成一句，不整段发过去 */
export const STUDENT_MAX = 2048;
const HEAD = '[学生]\n';
const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null;
const bytesOf = (t) => (enc ? enc.encode(String(t)).length : String(t).length);
const text = (x) => (typeof x === 'string' ? x : x?.why || '');

/**
 * 一件事要不要马上叫老师。做到挑战（做完了交给学生的东西）时老师预写的行又给了学生下一件事（新的一问、新的挑战）：这件事 quiet，
 * 先不叫（叫了老师的新一轮会盖掉学生正在做的），跟着学生下一次要老师接的事一起发。
 * 试的一下本来攒着；老师在 open 那一行写了 call=wrong、学生这一下走偏了（now）：马上叫
 */
export const triggers = (e) => !e.quiet && (!!e.now || ['answer', 'goal', 'done', 'help', 'stuck', 'tries'].includes(e.kind));

/**
 * 一个动作 → 一件事：{ kind: 'answer' | 'help' | 'try' | 'goal' | 'done' | 'stuck' | 'tries', act?, text?, at }。
 * 试的一下：裁判说马上叫老师（act.call === 'now'）记 now；老师写了 call=done（做完才叫）的东西上试的记 patient，不算进「试了好多下」
 */
export function eventOf(act, { help = '', at = 0 } = {}) {
  if (act.type === 'next' && help && act.button === help) return { kind: 'help', act: slim(act), at };
  if (act.open || act.type === 'dial') return { kind: 'try', act: slim(act), at, ...(act.call === 'now' || act.verdict?.call === 'now' ? { now: true } : {}), ...(act.patient ? { patient: true } : {}) };
  return { kind: 'answer', act: slim(act), at };
}

/**
 * 裁判的结论（stage.js 挂在动作上的 act.verdict）写成跟在这一下后面的半句：对不对、像哪种错、正确的是什么、没让做 / 圈了一下。
 * 不判的（right 是 null）、没过裁判的是空的
 */
export function verdictText(a) {
  const v = a?.verdict;
  if (!v) return '';
  if (a.failed) return '——页面这一下没判成（照做了）';
  if (v.legal === false) return `——做不到：${v.why || '这一下做不到'}（没演，弹回去了）`;
  if (v.right === true) return '——是正确的下一步';
  if (v.right !== false) return '';
  const nx = text(v.next);
  const how = a.blocked ? '；照你写的 wrong=block 没让做，弹回去了' : a.marked ? '；照做了，画面上那一处淡淡圈了一下（wrong=mark）' : '';
  return `——不是正确的下一步${v.misread ? `，像是${v.misread}` : ''}${nx ? `；正确的是${nx}` : ''}${how}`;
}
/** 存得下的样子（不带 tries 里的大东西） */
export const slim = (a) => JSON.parse(JSON.stringify({ ...a, tries: a.tries?.map((t) => ({ type: t.type, name: t.name, path: t.path })) }));

/**
 * 试的几下 → 一行一行：同一格连着拨的几下并成一条路（B.1,1：1 → 2 → 3）；点开看的几格并成一句；
 * 过了裁判的一下后面跟结论和这一下以后的事实。{ text, n（这一行是几下）, right, wrong（其中判对、判错几下）}
 */
function tryLines(tries) {
  const out = [];
  const edits = new Map(); // ref → { path }
  const order = [];
  const explained = [];
  for (const e of tries) {
    const a = e.act;
    if (a.type === 'edit') {
      let x = edits.get(a.ref);
      if (!x) { x = { ref: a.ref, path: [a.from === '' ? '空' : a.from] }; edits.set(a.ref, x); order.push({ k: 'edit', ref: a.ref }); }
      x.path.push(a.to);
    } else if (a.type === 'explain') {
      if (!explained.length) order.push({ k: 'explain' });
      if (!explained.includes(a.ref)) explained.push(a.ref);
    } else {
      const facts = (a.facts || []).filter(Boolean);
      const main = actText(a);
      order.push({ k: 'other', text: main ? `${main}${verdictText(a)}${facts.length ? `。${facts.join('；')}` : ''}` : '', right: a.verdict?.right === true ? 1 : 0, wrong: a.verdict?.right === false ? 1 : 0 });
    }
  }
  const nExplain = tries.filter((e) => e.act.type === 'explain').length;
  for (const o of order) {
    if (o.k === 'edit') { const x = edits.get(o.ref); out.push({ text: `学生拨了 ${x.ref}：${x.path.join(' → ')}`, n: x.path.length - 1 }); }
    else if (o.k === 'explain') out.push({ text: `学生点开看了 ${explained.join('、')} 怎么算出来`, n: nExplain });
    else if (o.text) out.push({ text: o.text, n: 1, right: o.right, wrong: o.wrong });
  }
  return out;
}

/** 试的那几行太长：从前面起并成「之前又试了 N 下」，留最近几下的细节（rest 是叫老师的那几件事，一字不动） */
function capTries(items, rest) {
  const fits = (lines) => bytesOf(HEAD + lines.join('\n')) <= STUDENT_MAX;
  const all = items.map((x) => x.text);
  if (fits([...all, ...rest])) return all;
  let n = 0, right = 0, wrong = 0, k = 0;
  const head = () => `之前又试了 ${n} 下${right + wrong ? `（页面判了 ${right + wrong} 下：${right} 下是正确的下一步，${wrong} 下不是）` : ''}，细节省了`;
  while (k < items.length) {
    n += items[k].n || 1; right += items[k].right || 0; wrong += items[k].wrong || 0; k++;
    if (fits([head(), ...all.slice(k), ...rest])) break;
  }
  return [head(), ...all.slice(k)];
}

/**
 * 攒下的事 → 写给老师看的一段（先写学生怎么试的，再写叫老师的那件事）。
 * goals：挑战 id → { text }（写「做到了挑战 g1「…」」用）；reacted：做到时演了几行预写的。
 * 连 [学生] 那一行不超过 STUDENT_MAX：试得多时只留最近几下的细节，前面的并成「之前又试了 N 下」（叫老师的那件事一字不动）
 */
export function eventsText(events, { goals = new Map(), secs = null } = {}) {
  const tries = events.filter((e) => e.kind === 'try');
  const lines = [];
  for (const e of events) {
    if (e.kind === 'try') continue;
    if (e.kind === 'goal') for (const id of e.ids || []) {
      const g = goals.get(id);
      lines.push(`学生做到了挑战 ${id}${g ? `「${g.text}」` : ''}${e.reacted ? `（页面已经演了你预写的 ${e.reacted} 行）` : '（你没预写做到以后的行）'}`);
    }
    else if (e.kind === 'goal-by-teacher') for (const id of e.ids || []) {
      const g = goals.get(id);
      lines.push(`你这一轮让挑战 ${id}${g ? `「${g.text}」` : ''}成立了（不是学生做到的）`);
    }
    else if (e.kind === 'done') {
      const ids = (e.ids || []).join('、');
      lines.push(`学生把 ${ids} 做完了（页面算出来没有下一步了）${e.reacted ? `（页面已经演了你预写的 ${e.reacted} 行）` : '（你没预写做完以后的行）'}`);
    }
    else if (e.kind === 'help') lines.push(`学生点了「${e.act.button}」`);
    else if (e.kind === 'stuck') lines.push(e.text || `学生 ${Math.round(QUIET_MS / 1000)} 秒没动，挑战还没做到`);
    else if (e.kind === 'tries') lines.push(e.text || `学生试了 ${TRY_MAX} 下还没做到`);
    else if (e.act) lines.push(actText(e.act));
  }
  // 老师写了 call=wrong、学生走偏了才叫的：说一声为什么这时候叫
  if (events.some((e) => e.now)) lines.push('（你在 open 那一行写了 call=wrong：学生走偏了，页面马上叫你）');
  if (secs != null && secs >= 5) lines.push(`（离你上一轮演完过了 ${secs} 秒）`);
  const rest = lines.filter(Boolean);
  return [...(tries.length ? capTries(tryLines(tries), rest) : []), ...rest].filter(Boolean).join('\n');
}

/** 自从上一次叫老师，学生试了几下（拨、拖、点开看都算；老师写了 call=done 的东西上试的不算） */
export const tryCount = (events) => events.filter((e) => e.kind === 'try' && !e.patient).length;
