// 表的规则（接口见 rules.js、docs/stage-types.md；主线第三轮 A）。纯函数，有测试（tests/stage-table.test.js）。
//
// 学生点一格写（open T edit：数字键盘、输入框或一排选项）。页面不判对错（right 永远是 null，不当场给学生标）：
// 老师给了答案（key=）的，每写一格在话里说「和答案一样 / 不一样（答案是几）」，写满时说一共几格不一样——只告诉老师。
// 写满算做完（@T.done）。只做「做不做得到」：给定的格（造的时候就有值的、老师写进去的）学生写不了。
import { cellName, keyed, answerOf, wrongCells, openCells, valueAfter, cellRight, misreadLines, isBlank } from './table.js';

const cellOf = (o, x) => (x?.r != null ? o.cells.find((c) => c.r === x.r && c.c === x.c) || null : x?.key != null ? o.cells.find((c) => c.key === x.key) || null : null);
const blanks = (o) => o.cells.filter((c) => isBlank(o, c));
const isNum = (v) => v === '∞' || /^-?\d+(\.\d+)?(\/\d+(\.\d+)?)?$/.test(v);
// 学生那一行指令里的值：纯数、∞ 照写；别的一律写在引号里（箭头、花括号、和舞台上东西同名的字，不加引号会被读成别的；
// 里面的直引号、弯引号去掉——引号套不了引号）
const quoted = (v) => (/^(-?\d+(\.\d+)?(\/\d+)?|∞)$/.test(v) ? v : `"${v.replace(/["“”]/g, '')}"`);
// 这一项是怎么开的：一排选项 / 输入框 / 数字键盘
const modeOf = (e) => (e?.choices ? 'pick' : e?.input === 'text' ? 'text' : 'keypad');
// 引擎造的表：打勾的格（缺页）从 √ × 里挑；答案不是数的格（进程名、顶点名）给输入框——老师不用为了这几格另开一种
const MARKS = ['√', '×'];
const isMark = (o, x) => !!x && !!o.engine?.marks.includes(x.key);
const cellMode = (o, x, open) => (isMark(o, x) ? 'pick' : open?.choices ? 'pick' : open?.input === 'text' || (o.engine && x && !isNum(answerOf(o, x))) ? 'text' : 'keypad');
const choicesOf = (o, x, open) => (isMark(o, x) ? MARKS : open.choices);

const gestures = {
  // 点一格写一个值。inputs：open T edit input=text 也认；choices：open T edit choices="能 不能" 是点一个选项
  edit: {
    gesture: 'write', on: 'cell', makes: 'write', inputs: ['text'], choices: true, brief: '点一格写',
    ask(o, { to, from, open } = {}) {
      const x = cellOf(o, to || from);
      const prompt = x ? `${cellName(o, x)} 写什么？` : '写什么？';
      const mode = cellMode(o, x, open);
      if (mode === 'pick') return { pick: true, prompt, choices: choicesOf(o, x, open).map((v) => ({ value: v, text: v })) };
      if (mode === 'text') return { input: 'text', prompt };
      return { input: 'keypad', prompt, extra: '∞' };
    },
    toAct(o, { to, from, value, role, open } = {}) {
      const x = cellOf(o, to || from);
      if (!x) return { error: `点 ${o.id} 的一格再写` };
      if (x.given) return { error: '这一格是给定的，不用填' };
      const mode = cellMode(o, x, open);
      const v = String((mode === 'pick' ? role : value) ?? '').replace(/\s+/g, ' ').trim();
      if (v === '') return { error: mode === 'pick' ? '点一个选项' : '写点什么再交' };
      if (mode === 'pick' && !choicesOf(o, x, open).includes(v)) return { error: `选项里没有「${v}」` };
      if (mode === 'keypad' && !isNum(v.replace(/[−–]/g, '-'))) return { error: `「${v}」不是数（写成 7、0.5，或者 ∞）` };
      if ([...v].length > 24) return { error: '太长了：一格最多 24 个字' };
      const val = mode === 'keypad' ? v.replace(/[−–]/g, '-') : v;
      return { act: { type: 'write', key: x.key, value: val }, src: `write ${o.id}.${x.r},${x.c} ${quoted(val)}` };
    },
  },
};

/** 一行镜头指令 → check 认的动作：学生从 open T edit 写的那一格（老师自己写的不过裁判） */
function actOf(o, c, h, { by = null, open = null } = {}) {
  if (by !== 'student' || open !== 'edit' || c.cmd !== 'write') return null;
  let ps;
  try { ps = h.partsIn(); } catch { return null; }
  if (ps.length !== 1 || ps[0].obj !== o.id) return null;
  let v;
  try { v = valueAfter(h, h.refsIn()[0]); } catch { return null; }
  if (v == null) return null;
  const t = String(v).trim();
  return { type: 'write', key: ps[0].key, value: t === '_' ? '' : t };
}

// 和答案比的那半句（没写答案、这一格不比：空的）
function versus(o, x, value) {
  if (!keyed(o, x) || value === '') return '';
  const r = cellRight(o, x, value);
  if (r == null) return ''; // 它那一组（先后不论的几格）还没填完：填完那一下再说
  return r ? '，和答案一样' : `，和答案不一样（${answerOf(o, x) === '空着' ? '这一格该空着' : `答案是 ${answerOf(o, x)}`}）`;
}
// 只判这个世界做不做得到，不判对错。why 写这一下做了什么、和答案比的结果
function check(o, act) {
  const no = (why) => ({ legal: false, right: null, misread: null, why, next: null });
  const ok = (why) => ({ legal: true, right: null, misread: null, why, next: null });
  if (act.type !== 'write') return ok(null);
  const x = cellOf(o, { key: act.key });
  if (!x) return ok(null);
  if (x.given) return no(`${cellName(o, x)} 是给定的格，学生写不了`);
  if (act.value === '') return ok(`${cellName(o, x)} 擦掉了${x.value !== '' ? `（原来是 ${x.value}）` : ''}`);
  return ok(`${cellName(o, x)} 写了 ${act.value}${x.value !== '' && x.value !== act.value ? `（原来是 ${x.value}）` : ''}${versus(o, x, act.value)}`);
}
/** 学生这一下以后写给老师的事实：刚写满时说一共几格和答案不一样 */
function facts(before, after, act, scene) {
  return [...fillFacts(before, after, act, scene), ...misreadFacts(before, after, act)];
}
// 这一下填完（或者改了）的那一行像引擎认得的哪种错法：只告诉老师
function misreadFacts(before, after, act) {
  if (!after.engine || act?.type !== 'write') return [];
  return misreadLines(after).filter((m) => m.keys.includes(act.key)).map((m) => `${m.name}像是：${m.label}`);
}
function fillFacts(before, after, act, scene) {
  // 写满没写满看交给学生的那几格（只开一列时是这一列）
  const mine = (o) => (openCells(scene, o) || o.cells);
  const left = (o) => mine(o).some((c) => isBlank(o, c));
  if (!left(before) || left(after)) return [];
  const all = !blanks(after).length;
  const head = all ? '写满了' : '开着的格写满了';
  if (!after.key) return [head];
  const scope = new Set((all ? after.cells : mine(after)).map((c) => c.key));
  const n = after.cells.filter((x) => scope.has(x.key) && keyed(after, x)).length;
  if (!n) return [`${head}（这几格答案里没有要比的）`];
  const bad = wrongCells(after).filter((x) => scope.has(x.key));
  return [bad.length ? `${head}：比的 ${n} 格里 ${bad.length} 格和答案不一样：${bad.map((x) => `${cellName(after, x)}（写了 ${x.value}，答案是 ${answerOf(after, x)}）`).join('、')}` : `${head}：比的 ${n} 格都和答案一样`];
}
// 下一步：还有空格就是「写一格」（哪一格不说：页面不替老师定先填哪格）；写满了是 null（做完了）
function next(o, scene) { return (openCells(scene, o) || o.cells).some((c) => isBlank(o, c)) ? { acts: [{ type: 'write' }], blank: true } : null; }

const measures = {
  // 还空着几格
  blank: Object.assign((o, parts) => (parts || o.cells).filter((c) => isBlank(o, c)).length, { listed: (o) => o.cells.some((c) => isBlank(o, c)) }),
  // 和答案不一样几格（填了的才算）；没写 key= 的表没有这个量
  wrong: Object.assign((o, parts) => { if (!o.key) return undefined; const ks = parts ? new Set(parts.map((p) => p.key)) : null; return wrongCells(o).filter((x) => !ks || ks.has(x.key)).length; }, { none: '没写 key=', listed: (o) => !!o.key }),
};
const predicates = {
  // 都填了
  full: (o) => blanks(o).length === 0,
  // 都填了、都和答案一样
  right: (o) => { if (!o.key) throw new Error(`${o.id} 没写 key=（答案），页面判不了 right：造表时写 key="…"，或者用 ${o.id} full`); return blanks(o).length === 0 && wrongCells(o).length === 0; },
};
/** 这一下改了哪几格 */
function changed(before, after) {
  if (!before || !after) return [];
  return after.cells.filter((c) => { const q = before.cells.find((x) => x.key === c.key); return q && q.value !== c.value; }).map((c) => c.key);
}

export const tableRules = { next, check, facts, measures, predicates, gestures, changed, actOf, doneBy: ['edit'] };
