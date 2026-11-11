// 表的规则（接口见 rules.js、docs/stage-types.md；主线第三轮 A）。纯函数，有测试（tests/stage-table.test.js）。
//
// 学生点一格写（open T edit：数字键盘、输入框或一排选项）。页面不判对错（right 永远是 null，不当场给学生标）：
// 老师给了答案（key=）的，每写一格在话里说「和答案一样 / 不一样（答案是几）」，写满时说一共几格不一样——只告诉老师。
// 写满算做完（@T.done）。只做「做不做得到」：给定的格（造的时候就有值的、老师写进去的）学生写不了。
import { cellName, keyed, answerOf, sameValue, wrongCells } from './table.js';

const cellOf = (o, x) => (x?.r != null ? o.cells.find((c) => c.r === x.r && c.c === x.c) || null : x?.key != null ? o.cells.find((c) => c.key === x.key) || null : null);
const blanks = (o) => o.cells.filter((c) => c.value === '');
const isNum = (v) => v === '∞' || /^-?\d+(\.\d+)?(\/\d+(\.\d+)?)?$/.test(v);
// 学生那一行指令里的值：一个词照写；有空格、引号、等号的写在引号里
const quoted = (v) => (/^[^\s"“”=]+$/.test(v) ? v : `"${v.replace(/["“”]/g, '')}"`);
// 这一项是怎么开的：一排选项 / 输入框 / 数字键盘
const modeOf = (e) => (e?.choices ? 'pick' : e?.input === 'text' ? 'text' : 'keypad');

const gestures = {
  // 点一格写一个值。inputs：open T edit input=text 也认；choices：open T edit choices="能 不能" 是点一个选项
  edit: {
    gesture: 'write', on: 'cell', makes: 'write', inputs: ['text'], choices: true, brief: '点一格写',
    ask(o, { to, from, open } = {}) {
      const x = cellOf(o, to || from);
      const prompt = x ? `${cellName(o, x)} 写什么？` : '写什么？';
      const mode = modeOf(open);
      if (mode === 'pick') return { pick: true, prompt, choices: open.choices.map((v) => ({ value: v, text: v })) };
      if (mode === 'text') return { input: 'text', prompt };
      return { input: 'keypad', prompt, extra: '∞' };
    },
    toAct(o, { to, from, value, role, open } = {}) {
      const x = cellOf(o, to || from);
      if (!x) return { error: `点 ${o.id} 的一格再写` };
      if (x.given) return { error: '这一格是给定的，不用填' };
      const mode = modeOf(open);
      const v = String((mode === 'pick' ? role : value) ?? '').replace(/\s+/g, ' ').trim();
      if (v === '') return { error: mode === 'pick' ? '点一个选项' : '写点什么再交' };
      if (mode === 'pick' && !open.choices.includes(v)) return { error: `选项里没有「${v}」` };
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
  const v = h.str != null ? h.str : h.words.filter((w) => !h.scene?.isRef?.(w)).at(-1);
  if (v == null) return null;
  const t = String(v).trim();
  return { type: 'write', key: ps[0].key, value: t === '_' ? '' : t };
}

// 和答案比的那半句（没写答案、这一格不比：空的）
function versus(o, x, value) {
  if (!keyed(o, x) || value === '') return '';
  return sameValue(value, answerOf(o, x)) ? '，和答案一样' : `，和答案不一样（答案是 ${answerOf(o, x)}）`;
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
function facts(before, after) {
  if (!blanks(before).length || blanks(after).length) return [];
  if (!after.key) return ['写满了'];
  const n = after.cells.filter((x) => keyed(after, x)).length;
  const bad = wrongCells(after);
  return [bad.length ? `写满了：比的 ${n} 格里 ${bad.length} 格和答案不一样：${bad.map((x) => `${cellName(after, x)}（写了 ${x.value}，答案是 ${answerOf(after, x)}）`).join('、')}` : `写满了：比的 ${n} 格都和答案一样`];
}
// 下一步：还有空格就是「写一格」（哪一格不说：页面不替老师定先填哪格）；写满了是 null（做完了）
function next(o) { return blanks(o).length ? { acts: [{ type: 'write' }], blank: true } : null; }

const measures = {
  // 还空着几格
  blank: Object.assign((o, parts) => (parts || o.cells).filter((c) => c.value === '').length, { listed: (o) => o.cells.some((c) => c.value === '') }),
  // 和答案不一样几格（填了的才算）；没写 key= 的表没有这个量
  wrong: Object.assign((o) => (o.key ? wrongCells(o).length : undefined), { none: '没写 key=', listed: (o) => !!o.key }),
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
