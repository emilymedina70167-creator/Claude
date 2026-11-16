// 这节课要拿下的事（docs/superpowers/specs/2026-11-15-root-design.md 6.2）：一节课从「考试要学生做到什么」出发，
// 每节课 2～5 件。老师写 board aims 定下来（一行一件），板上的题用 aim=a1 挂到某一件上；
// 每件事到了没有由页面按学生的作答算，老师不宣布（老师说「会了」不算数，要有学生自己做出来的题）。
// 纯函数，不碰 DOM，有测试（tests/class-aims.test.js）。叫 aims 是因为 goal 这个名字舞台的挑战和教案的一句话目标已经占了。

export const AIMS_MIN = 2;
export const AIMS_MAX = 5;
// 能做的事要写成一个动作：少于 4 个字的（「会」「掌握」）说不清要做到什么，太长的是把好几件写成了一件
const CAN_MIN = 4;
const CAN_MAX = 80;

// 编号：a 加数字。大写的认成小写（段上的 aim= 也这样认，两边对得上）
export const AIM_ID_RE = /^a\d{1,2}$/;
/** 写的编号 → 存的编号；不是编号返回 '' */
export const aimId = (s) => { const t = String(s ?? '').trim().toLowerCase(); return AIM_ID_RE.test(t) ? t : ''; };

const HOW = '一行一件，写成：a1 | 学生要能做的事 | 什么算做到 | exam=真题题号（后两格可以不写）';
const short = (s, n = 40) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const len = (s) => [...String(s ?? '')].length;

/**
 * board aims 块的正文 → { aims, errors }。一行一件，格子用「 | 」隔开：
 *   a1 | 给一个引用串，手算 LRU 的缺页次数 | 独立做一道没见过的同类题 | exam=Q-408-2023-45
 * 第一格编号，第二格能做的事，后面的格子里 exam= 开头的是对着哪道真题，别的是「什么算做到」。
 * 读不懂的行放进 errors，别的照收（重号、件数这些归 checkAims：这里只管读）。
 */
export function parseAims(body) {
  const aims = [], errors = [];
  for (const raw of String(body ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    // 列表记号、表格那样开头的竖线不算内容
    const line = raw.trim().replace(/^(?:[-*•·]\s+)?(?:[|｜]\s*)?/, '');
    if (!line) continue;
    // 编号后面的第一个分隔不挑空格（a1|…）；再往后半角的竖线两边都有空格才算分隔：线代里 |A| 是行列式
    const m = line.match(/^(\S+?)\s*[|｜]\s*(.*)$/);
    const id = aimId(m?.[1]);
    if (!m || !id) { errors.push(`看不懂这一行「${short(raw.trim())}」：${HOW}`); continue; }
    // 表格那样收尾的竖线（前面有空格的才是：「算出 |A|」最后那个竖线是行列式的）
    const cells = m[2].replace(/(^|\s)\|$/, '').split(/\s+\|\s+|\s*｜\s*/).map((c) => c.trim()).filter(Boolean);
    const aim = { id };
    const proof = [];
    for (const c of cells) {
      const ex = c.match(/^exam\s*[=＝:：]\s*(.*)$/i);
      if (ex) { const v = ex[1].trim().replace(/^["'“「](.*)["'”」]$/, '$1').trim(); if (v && !aim.exam) aim.exam = v; }
      else if (aim.can === undefined) aim.can = c;
      else proof.push(c);
    }
    if (!aim.can) { errors.push(`${id} 没写学生要能做的事：${HOW}`); continue; }
    // 多写了几格的都算「什么算做到」，不丢
    if (proof.length) aim.proof = proof.join('；');
    // 字段的先后固定（id, can, proof, exam）：存进这节课的文档、放进说明，前后两次要一模一样
    aims.push({ id: aim.id, can: aim.can, ...(aim.proof ? { proof: aim.proof } : {}), ...(aim.exam ? { exam: aim.exam } : {}) });
  }
  return { aims, errors };
}

/**
 * 这几件事能不能存进这节课：返回问题的列表（空的就是可以）。
 * 件数不在 2～5、编号重了、能做的事太短或太长，各一条。
 * examCheck(题号)：给了时用它问真题题号能不能用，返回空字符串是可以，否则是原因（没有这道题、留作模考）。
 */
export function checkAims(aims, { examCheck = null } = {}) {
  const list = Array.isArray(aims) ? aims.filter((a) => a && typeof a === 'object') : [];
  const out = [];
  if (list.length < AIMS_MIN || list.length > AIMS_MAX) out.push(`要拿下的事要 ${AIMS_MIN}～${AIMS_MAX} 件，现在是 ${list.length} 件${list.length > AIMS_MAX ? '：挑考试最要的几件，别的并进去或者留到下一节' : ''}`);
  const seen = new Set(), dup = new Set();
  for (const a of list) { const id = String(a.id ?? ''); if (seen.has(id)) dup.add(id); seen.add(id); }
  for (const id of dup) out.push(`编号 ${id || '（空）'} 写了不止一次：一件事一个编号`);
  list.forEach((a, i) => {
    const name = a.id ? String(a.id) : `第 ${i + 1} 件`;
    const n = len(String(a.can ?? '').trim());
    if (n < CAN_MIN) out.push(`${name} 写得太短（「${String(a.can ?? '').trim()}」）：写成学生要能做的一件具体的事，比如「给一个引用串，手算 LRU 的缺页次数」`);
    else if (n > CAN_MAX) out.push(`${name} 写得太长（${n} 个字，最多 ${CAN_MAX}）：一件事一句话，怎样算做到写在后面一格`);
    if (examCheck && a.exam) {
      const why = examCheck(a.exam);
      if (why) out.push(`${name} 写的真题 ${a.exam} 不能用：${why}`);
    }
  });
  return out;
}

// 这道题算不算做对了：把选项试遍了才对的（report.js 的 guess）结果也是 ok，但证明不了会，掌握那边也当失手（mastery.js）。
// 改对了（同一道题先错后对）算做对，只是够不上独立
const right = (it) => (it.outcome === 'first' || it.outcome === 'ok') && !it.guess;
// 这几种题一次对也最多算带着做到。steps：分步例题是老师把路铺好、一步一步带着走的，走对一步不等于自己会走。
// 以后有别的「路是铺好的」的题，加在这里
const LED_KINDS = new Set(['steps']);
// 独立：第一次作答就对，没揭开过、没点想不出来，也不是带着走的那几种题
const solo = (it) => it.outcome === 'first' && !it.revealed && !it.giveup && !(it.reveals > 0) && !LED_KINDS.has(String(it.kind || ''));
// 页面没判的作答（猜想、自由写的理由，outcome 是 open）既不算做到也不算没到
const judged = (it) => it.outcome !== 'open';

// 按时间排（题上的 first：第一条证据的时间）。没有 first 的题留在原来的位置，有的在它们占的那几个位置里排：
// 都没有时就是传进来的先后
function inOrder(items) {
  const timed = (it) => Number.isFinite(it.first);
  const sorted = items.filter(timed).sort((x, y) => x.first - y.first);
  let k = 0;
  return items.map((it) => (timed(it) ? sorted[k++] : it));
}

/**
 * 一件事现在的状态，按挂在它上面的题（报告的题：report.js 的 itemsOf）算：
 * solo 独立做到 / led 带着做到（做对了，但改过、看过提示，或者是分步例题的一步）/ miss 做了没到 / none 还没证据。
 * 状态是页面对学生说的话，宁可说少不可说满：只看最后一次失手以后的（和 mastery.js 的 walk 一个道理）——
 * 前面独立做对过、后来同一件事的另一道做错了，就是做了没到；失手以后又做对了，按后面做对的那几道算。
 * 失手 = 页面判过但不算做对（错、想不出来、看了答案、把选项试遍了才对）。
 * 只有页面没判的作答时还是 none：页面判不了，不能替学生说「没到」。
 */
export function aimStatus(aim, items) {
  const mine = inOrder((Array.isArray(items) ? items : []).filter((it) => it && aim?.id && it.aim === aim.id && judged(it)));
  if (!mine.length) return 'none';
  const after = mine.slice(mine.findLastIndex((it) => !right(it)) + 1);
  if (after.some(solo)) return 'solo';
  return after.some(right) ? 'led' : 'miss';
}

/** 每件事带上状态和挂在它上面的题数 n。没有要拿下的事（旧课、练一练、复现课、舞台课）返回 [] */
export function aimsSummary(aims, items) {
  if (!Array.isArray(aims)) return [];
  const its = Array.isArray(items) ? items : [];
  return aims.filter((a) => a && typeof a === 'object' && a.id).map((a) => ({ ...a, status: aimStatus(a, its), n: its.filter((it) => it && it.aim === a.id).length }));
}

// 状态是页面对学生说的话：只有这四个词
export const STATUS_TEXT = { none: '还没证据', led: '带着做到', solo: '独立做到', miss: '做了没到' };
const proven = (s) => s.status === 'led' || s.status === 'solo';

/** 板上方收着的那一行：这节课要拿下的 · 1/3 有证据（带着做到、独立做到算有证据）。没有要拿下的事返回 '' */
export function aimsLine(summary) {
  const list = Array.isArray(summary) ? summary : [];
  return list.length ? `这节课要拿下的 · ${list.filter(proven).length}/${list.length} 有证据` : '';
}

/**
 * 给老师看的几行（黑板现状、下课的小结、课后报告里），一件一行：
 *   - a1（独立做到，2 道题）：给一个引用串，手算 LRU 的缺页次数｜算做到：独立做一道没见过的同类题｜对着 Q-408-2023-45
 */
export function aimsText(summary) {
  return (Array.isArray(summary) ? summary : []).map((s) => {
    // 挂了题却还没证据：只可能是页面判不了的作答，照实告诉老师（不然「还没证据，1 道题」读不通）
    const n = s.n ? `，${s.n} 道题${s.status === 'none' ? '页面没判' : ''}` : '';
    return `- ${s.id}（${STATUS_TEXT[s.status] || STATUS_TEXT.none}${n}）：${s.can || ''}${s.proof ? `｜算做到：${s.proof}` : ''}${s.exam ? `｜对着 ${s.exam}` : ''}`;
  }).join('\n');
}
