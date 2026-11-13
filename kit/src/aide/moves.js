// 讲法打分（docs/superpowers/specs/2026-11-13-aide-design.md 5.5）：课后助手给老师的每一轮标用了什么讲法（只能用 MOVES 里的词），
// 页面按学生在那一轮之后的下一次作答算有没有用（事实归页面：不让 Claude 自己说哪种有效），攒在每块上，学生卡里给老师看。
// 纯函数，有测试（tests/aide-moves.test.js）。
export const MOVES = ['先猜再揭晓', '反例', '动手试', '画图', '类比', '直接讲规则', '追问', '换数再做', '对比两种', '拆小步'];
export const MOVES_MIN = 3; // 同一种讲法在这一块用过这么多次才下结论（少了看不出是讲法的功劳还是题简单）
const HELP = '给个提示'; // 舞台上页面替老师挂的「要提示」按钮（stage/stage.js 的 HELP）

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/** 读课后助手标的讲法：每行「讲法｜#轮｜词」。turns：这节课老师那几轮的编号 */
export function parseMoves(text, { turns = new Set() } = {}) {
  const out = [];
  for (const raw of String(text ?? '').split('\n')) {
    const m = raw.trim().replace(/^[-*•]\s*/, '').match(/^讲法\s*[｜|]\s*#?(\d{1,4})\s*[｜|]\s*(\S+)/);
    if (!m) continue;
    const turn = Number(m[1]);
    if (!turns.has(turn) || !MOVES.includes(m[2])) continue;
    if (!out.some((x) => x.turn === turn && x.move === m[2])) out.push({ turn, move: m[2] });
  }
  return out;
}

const isHint = (e) => e?.src === 'event' && e?.detail?.button === HELP;

/** 一轮讲法之后学生的下一次作答：那一轮名下（证据的 turn）第一条有对错的；一次对、之前没要提示 → ok，否则 miss；没有作答 → null */
export function moveOutcome(move, evidence = []) {
  const mine = list(evidence).filter((e) => Number(e?.turn) === Number(move.turn)).sort((a, b) => (a.at || 0) - (b.at || 0));
  const first = mine.findIndex((e) => e.src !== 'event' && typeof e.ok === 'boolean');
  if (first < 0) return null;
  if (mine.slice(0, first).some(isHint)) return 'miss';
  return mine[first].ok ? 'ok' : 'miss';
}

/** 这一块所有课的讲法：{ 讲法: { n（有作答的次数）, ok } } */
export function moveStats(sessions = [], evidence = [], block = '') {
  const out = {};
  for (const s of list(sessions)) {
    if (!list(s?.moves).length || !(s.block === block || list(s.blocks).includes(block))) continue;
    const evs = list(evidence).filter((e) => e?.session === s.id);
    for (const m of s.moves) {
      const r = moveOutcome(m, evs);
      if (!r) continue;
      const x = (out[m.move] ||= { n: 0, ok: 0 });
      x.n++;
      if (r === 'ok') x.ok++;
    }
  }
  return out;
}

/** 写成学生卡「讲法」那一段的字（页面算的数） */
export function movesText(stats = {}) {
  const rows = Object.entries(stats).sort((a, b) => b[1].n - a[1].n);
  if (!rows.length) return '';
  const firm = rows.filter(([, x]) => x.n >= MOVES_MIN).map(([m, x]) => `${m}：${x.n} 次里 ${x.ok} 次讲完一次做对`);
  const few = rows.filter(([, x]) => x.n < MOVES_MIN).map(([m, x]) => `${m} ${x.n} 次`);
  return [firm.join('；'), few.length ? `次数还少：${few.join('、')}` : ''].filter(Boolean).join('；');
}
