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

/**
 * 一件事要不要马上叫老师。做到挑战时老师预写的行又给了学生下一件事（新的一问、新的挑战）：这件事 quiet，
 * 先不叫（叫了老师的新一轮会盖掉学生正在做的），跟着学生下一次要老师接的事一起发
 */
export const triggers = (e) => !e.quiet && ['answer', 'goal', 'help', 'stuck', 'tries'].includes(e.kind);

/** 一个动作 → 一件事：{ kind: 'answer' | 'help' | 'try' | 'goal' | 'stuck' | 'tries', act?, text?, at } */
export function eventOf(act, { help = '', at = 0 } = {}) {
  if (act.type === 'next' && help && act.button === help) return { kind: 'help', act: slim(act), at };
  if (act.open || act.type === 'dial') return { kind: 'try', act: slim(act), at };
  return { kind: 'answer', act: slim(act), at };
}
/** 存得下的样子（不带 tries 里的大东西） */
export const slim = (a) => JSON.parse(JSON.stringify({ ...a, tries: a.tries?.map((t) => ({ type: t.type, name: t.name, path: t.path })) }));

/** 同一格连着拨的几下并成一条路（B.1,1：1 → 2 → 3）；点开看的几格并成一句 */
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
    } else order.push({ k: 'other', text: actText(a) });
  }
  for (const o of order) {
    if (o.k === 'edit') { const x = edits.get(o.ref); out.push(`学生拨了 ${x.ref}：${x.path.join(' → ')}`); }
    else if (o.k === 'explain') out.push(`学生点开看了 ${explained.join('、')} 怎么算出来`);
    else if (o.text) out.push(o.text);
  }
  return out;
}

/**
 * 攒下的事 → 写给老师看的一段（先写学生怎么试的，再写叫老师的那件事）。
 * goals：挑战 id → { text }（写「做到了挑战 g1「…」」用）；reacted：做到时演了几行预写的
 */
export function eventsText(events, { goals = new Map(), secs = null } = {}) {
  const tries = events.filter((e) => e.kind === 'try');
  const lines = [];
  if (tries.length) lines.push(...tryLines(tries));
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
    else if (e.kind === 'help') lines.push(`学生点了「${e.act.button}」`);
    else if (e.kind === 'stuck') lines.push(e.text || `学生 ${Math.round(QUIET_MS / 1000)} 秒没动，挑战还没做到`);
    else if (e.kind === 'tries') lines.push(e.text || `学生试了 ${TRY_MAX} 下还没做到`);
    else if (e.act) lines.push(actText(e.act));
  }
  if (secs != null && secs >= 5) lines.push(`（离你上一轮演完过了 ${secs} 秒）`);
  return lines.filter(Boolean).join('\n');
}

/** 自从上一次叫老师，学生试了几下（拨、拖、点开看都算） */
export const tryCount = (events) => events.filter((e) => e.kind === 'try').length;
