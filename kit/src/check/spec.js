// 检验（二类组件：学完以后的吸收检验，dev_requests/dr-plan2，设计 docs/superpowers/specs/2026-11-18-check-design.md）：
// board check 和六种探题的写法、自检。不碰 DOM，tests/check-spec.test.js。
//
//   ````board check id=k1 title="…" limit=15m pause=30s
//   block L2.1.1 must=p1,p2
//   block L2.1.4 must=p3,p4 optional=p7 fast=90s
//   spare p8
//   <<<
//   （可选）外部没预料到的错法时，给页面里的 Claude 的话
//   >>>
//   ```construct
//   id: p1
//   …
//   ```
//   ````
//
// 题的 retry: 写同构小题的 id（也写在这个块里，开始时不出现）；没排进 block / spare、也不是谁的 retry 的题报写法错误。
// 模板（外部 review 的可选那条）：题里写 pick / where（照 practice custom 的写法），每次用到都取一组新数——
// retry 可以写同一个模板两次、也可以写这道题自己（retry: p1, p1）：局部 id 照用的先后叫 p1、p1~2、p1~3（template.js 的 materialize）。
// retry: self × 2（× x * 都认）就是 retry: p1, p1；取到的数分不开 against 的错法、用到的量有并列，和 where 不满足一样重取。
// 题目、要点、错法、补讲、同构题都由外部写；这里只读写法、拿外部写的 example 先验一遍条件（写错了页面报，不静默）。
//
// 408（计划 4）：construct 多 seq(n) / text / procs(n[, prio]) 格子和 run 行（run r: sort algo=shell array=A：格子名换成学生写的，
// 引擎跑一遍，engines/measures.js 交的量在条件里写 r.unstable、r.flipped）；条件多比大小（>= <= > <）和字的 == != in
// （P in r.flipped：不论先后、不管空格逗号大小写撇号）。predict 写 run、expect 标签: 值、带 => 的 wrong（错答案，挂在上面最近的
// expect）、against:（这组数要分得开的引擎错法）。固定的数用到靠并列定的量（OPT 的 victims）自检报，学生造的那组有并列交 judge 待核。
// 英语（Task 6）：parse 写 key:（括号写法）+ 可选 roles:；translate 写 text: + must / may / wrong + answer:（参考译文）；rewrite 写 text: +
// has: 片段 => 话 / not: 片段 => 话 + example:（自检用）+ 可选 must；errfind 写 text: word:（are#2）fix:（a | !错的=为什么 | 删掉）+ 可选 decoys: must；
// discriminate 多 options: A | B（只收两个）+ answer:，和 can: 只写一个。英语题不做模板。
// trace 写 use: 演示组件 + 它自己的字段（algo: shell、array: …）+ 可选 rows / given / cols / against：学生填引擎 mode: fill 的那张表（traceTable）。
import { tokenize } from '../tokens.js';
import { compile } from '../expr.js';
import { parseConditions } from '../anscheck.js';
import { parseSolve } from '../solvespec.js';
import { parseCodeSpec, runTests } from '../codejudge.js';
import { commandLine, instantiate, pickedText } from '../practicespec.js';
import { calcValue, expandCalc, floatVars } from '../exact.js';
import { MEASURES, measure, markDuplicates, variantsOf, variantValues } from '../engines/measures.js';
import { ENGINES } from '../engines/registry.js';
import { roundTable, sortAlgo } from '../engines/sort.js';
import { fillSpec, checkFill, normCell, trackFields } from '../stepperspec.js';
import { spaceOfId } from '../memory/space.js';
import { parseBrackets, parseRoles, ROLES, findWrong, parseDecoys, parseAnswer, normText } from '../entext.js';
import { bigO } from './values.js'; // values.js 也 import 这里：互相只在函数里用，不在模块顶层调用

// 408、英语一的题型（计划 4，docs/superpowers/plans/2026-11-19-check-408-en.md）：trace predict code parse translate rewrite errfind 是新的，
// tradeoff 是 recall 的别名、calc 是 solve 的别名（读法、判法照原来的，type 存自己的名字，BASE_OF / baseType）
export const PROBE_TYPES = ['recall', 'construct', 'claim', 'discriminate', 'locate', 'solve',
  'trace', 'predict', 'tradeoff', 'code', 'calc', 'parse', 'translate', 'rewrite', 'errfind'];
export const BASE_OF = { tradeoff: 'recall', calc: 'solve' };
/** 一道题照哪一种读、判：别名换成原来的那一种 */
export const baseType = (probe) => BASE_OF[probe?.type] || probe?.type;
export const FACET_OF = {
  recall: '重建', construct: '能用', claim: '边界', solve: '能用', discriminate: '能辨', locate: '能辨',
  trace: '能用', predict: '能用', tradeoff: '重建', code: '能用', calc: '能用', parse: '能用', translate: '能用', rewrite: '能用', errfind: '边界',
};
/** 没写 facet 时默认测哪一面：408 的块（DS- OS- CO- CN-）里的 construct 测边界（造一组让算法露出毛病的输入），别的照 FACET_OF */
export function facetDefault(type, block) {
  if (type === 'construct' && block && spaceOfId(block) === 'cs') return '边界';
  return FACET_OF[type];
}
export const FACETS = ['重建', '能用', '边界', '能辨'];
export const LEVELS = ['基础', '方法', '核心'];
export const MUST_MAX = 3; // recall 每题最多几条必写要点（任务书：只问 2～3 个关键点）
export const RETRY_MIN = 2; // 必做题至少几道同构小题
export const PAUSE_DEFAULT = 30000;

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,64}$/;
const BLOCK_RE = /^(?:[A-Z]{2}-)?L\d+(?:\.\d+){0,2}(?:#[A-Za-z0-9_-]+)?$/;
const FIELD = /^\s*([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/;
const POINT = /^\s*(must|may|wrong)(?:\s+([A-Za-z]\w{0,15}))?\s*[:：]\s?(.*)$/;
const TEACH = /^\s*teach\s+(\S+?)\s*[:：]\s?(.*)$/;
const EXPR = /^\s*expr\s+(.+?)\s*[:：]\s*(.+)$/;
const IF = /^\s*if\s*[:：]\s*(.+)$/;
const LET = /^\s*let\s+([A-Za-z]\w*)\s*=\s*(.+)$/;
// run r: sort algo=shell gaps="4 2 1" array=A（名字不带下划线：量写成 r__faults，下划线留给它）
const RUN = /^\s*run\s+(\S+?)\s*[:：]\s*([A-Za-z]\w*)\s*(.*)$/;
const RUN_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
// predict 的 expect 标签: 值（标签前可以写编号 x1）
const EXPECT = /^\s*expect(?:\s+([^:：]*?))?\s*[:：]\s*(.*)$/;
const RESERVED_IDS = { rewrite: /^[hn]\d+$/, errfind: /^(?:word|fix)$/, discriminate: /^pick$/, parse: /^extra$/ };
// rewrite 的 has: 片段 => 话 / not: 片段 => 话（一行一条，h1、n1…）
const HASNOT = /^\s*(has|not)\s*[:：]\s?(.*)$/;
// 模板的命令只认小写、整行像命令的（pick 名字 = …；where 带比较或是一个函数调用）：英语题的续行
// 「Where did you go?」「where the river meets the sea」照旧是续行
const TPL = /^\s*(?:pick\s+[A-Za-z_]\w*\s*=\s*\S|where\s+(?=.*(?:[=!<>]=|[<>]))\S|where\s+[A-Za-z_]\w*\s*\(.*\)\s*$)/;
/** 一道题的围栏原文里有 pick / where（模板：每次用另取一组数）：题库里不用另存标记 */
export const isTplFence = (fence) => String(fence ?? '').split('\n').some((l) => TPL.test(l));
export const TPL_ROUNDS = 8; // 模板自检取几组数
export const DRAW_TRIES = 20; // 一道取了数自检不过（某一组数下 example 不满足、\calc 算不出来、有并列、分不开错法），最多重取几次
// 共用的字段、各题型自己的字段（不在里面的报「看不懂」）
const COMMON = ['id', 'q', 'title', 'target', 'level', 'facet', 'family', 'retry', 'note', 'exam', 'like'];
const OWN = {
  recall: ['answer'],
  construct: ['slots', 'example', 'against'],
  predict: ['answer', 'against'],
  // trace：use 写演示组件的名字，rows / given / cols 照 mode: fill（rows 还能写 2-3：只填第 2～3 行）；别的字段一律交给引擎。
  // by: round 只给快排：按真题说的趟（一层划分做完）一行，不写是一次划分一行
  trace: ['use', 'against', 'rows', 'given', 'cols', 'by'],
  claim: ['claim', 'truth', 'slots', 'example', 'proof', 'start', 'goal', 'vars'],
  // 英语的两个按钮（谓语 / 非谓语）：options: A | B + answer:，和 can: 只写一个
  discriminate: ['can', 'result', 'options', 'answer'],
  locate: ['line', 'bug', 'fix'],
  solve: ['result'],
  // code：字段照 blocks/code.js（codejudge.js 的 parseCodeSpec 读）；ref / starter / check / tests 是几行的代码
  code: ['fn', 'call', 'tests', 'ref', 'starter', 'scale', 'check', 'check_call'],
  // 英语（计划 4 Task 6）：parse 的句子从 key: 的括号里取；translate、rewrite、errfind 的原句写 text:；errfind 错的词写 word:（are#2）
  parse: ['key', 'roles'],
  translate: ['text', 'answer'],
  rewrite: ['text', 'example'],
  errfind: ['text', 'word', 'fix', 'decoys'],
};
const CODE_MULTI = new Set(['tests', 'ref', 'starter', 'check']);

/** 2s / 90s / 15m / 1500ms / 15分钟 → 毫秒；读不懂 NaN */
export function msOf(v) {
  const m = String(v ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|秒|m|min|分钟?)?$/i);
  if (!m) return NaN;
  const n = Number(m[1]), u = (m[2] || 's').toLowerCase();
  return Math.round(u === 'ms' ? n : u === 'm' || u === 'min' || u.startsWith('分') ? n * 60000 : n * 1000);
}

const list = (v) => String(v ?? '').split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
// retry: self × 2（× x * 都认，有无空格都行；单写 self 是一次）= 写两次这道题自己：只给带 pick 的模板（每次另取一组数）。
// 照写的先后展开（retry: p1c, self × 2 → p1c, p1, p1）；N 不是正整数、没有 pick 的题写 self 抛中文原因
const SELF = /(?<![\w~.-])self(?:\s*([×xX*])\s*(\d*))?(?![\w~.-])/g;
export const SELF_MAX = 6; // self × N 最多几次：再多一道题拆得太碎，学生一直在做同一种
function retryOf(v, id, isTpl) {
  let bad = null;
  const text = String(v ?? '').replace(SELF, (all, times, n) => {
    if (times !== undefined && n === '') { bad = 'self × 后面写个数'; return ' '; }
    const k = n === undefined ? 1 : Number(n);
    if (!(k >= 1)) bad = `retry 的「${all.trim()}」：self × N 的 N 写 1 以上`;
    else if (k > SELF_MAX) bad = `self × 最多 ${SELF_MAX}`;
    return ` ${Array(Math.min(Math.max(k, 0), SELF_MAX)).fill('\u0000').join(' ')} `;
  });
  if (bad) throw new Error(bad);
  const out = list(text);
  if (out.includes('\u0000') && !isTpl) throw new Error('self 只能写在带 pick 的题里（每次另取一组数）');
  return out.map((x) => (x === '\u0000' ? id : x));
}

/** slots: A=mat(2) B=mat(2,3) v=vec(3) k=num；408 的 S=seq(8)（不写个数最多 24 个）、T=text、Q=procs(3) / procs(3, prio) */
export const SEQ_MAX = 24;
const STR_KINDS = new Set(['seq', 'text', 'procs']);
const SLOT_HELP = '写 A=mat(2)、M=mat(2,3)、v=vec(3)、k=num、S=seq(8)、T=text、Q=procs(3) 或 procs(3, prio)';
function parseSlots(src) {
  const out = [];
  const s = String(src).trim();
  const re = /([A-Za-z]\w*)\s*=\s*([A-Za-z]+)(?:\s*\(([^)]*)\))?(?=\s|$)/y;
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new Error(`slots 里「${s.slice(i).split(/\s+/)[0]}」看不懂：${SLOT_HELP}`);
    i = re.lastIndex;
    const [all, name, kind] = m;
    const args = m[3] === undefined ? [] : m[3].split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    const int = (x) => (/^\d+$/.test(x) ? Number(x) : NaN);
    const [a, b] = args.map(int);
    if ((kind === 'mat' || kind === 'vec') && args.some((x) => !(int(x) >= 1))) throw new Error(`slots 里「${all.trim()}」看不懂：${SLOT_HELP}`);
    if (kind === 'mat') { if (!args.length) throw new Error(`${name}=mat 要写阶数：mat(2) 或 mat(2,3)`); out.push({ name, kind, r: a, c: args[1] ? b : a }); }
    else if (kind === 'vec') { if (!args.length) throw new Error(`${name}=vec 要写维数：vec(3)`); out.push({ name, kind, n: a }); }
    else if (kind === 'num' && !args.length) out.push({ name, kind });
    else if (kind === 'seq' && args.length <= 1) {
      if (args.length && !(a >= 1 && a <= SEQ_MAX)) throw new Error(`${name}=seq(n) 的 n 写 1 到 ${SEQ_MAX}`);
      out.push({ name, kind, n: args.length ? a : null });
    } else if (kind === 'text' && !args.length) out.push({ name, kind });
    else if (kind === 'procs') {
      if (!(a >= 1 && a <= 10) || args.length > 2 || (args[1] && args[1] !== 'prio')) throw new Error(`${name}=procs 写几个进程（1 到 10）：procs(3)，要优先级写 procs(3, prio)`);
      out.push({ name, kind, n: a, prio: args[1] === 'prio' });
    } else throw new Error(`slots 里「${all.trim()}」看不懂：${SLOT_HELP}`);
  }
  if (!out.length) throw new Error('slots: 要写学生填的东西，比如 A=mat(2) B=mat(2)');
  return out;
}

const NUM_MARK = /^-?\d+(?:\.\d+)?['’′_]*$/;
const stripBrackets = (raw) => String(raw ?? '').trim().replace(/^\[([\s\S]*)\]$/, '$1').trim();
export const seqTokens = (raw) => stripBrackets(raw).split(/[\s,，、;；]+/).filter(Boolean);
const procEntries = (raw) => stripBrackets(raw).split(/[;；\n]+|,(?=\s*[A-Za-z一-龥])/).map((x) => x.trim()).filter(Boolean);

/**
 * 408 的格子学生写的格式对不对（只查格式：对了才交、才算第一次作答；格式对而引擎不收的另判没过）。
 * 返回要说的话（空数组是对的）；矩阵、向量、数的格子不归这里管（返回空）
 */
export function slotProblems(slot, raw) {
  if (!STR_KINDS.has(slot?.kind)) return [];
  const out = [];
  if (slot.kind === 'text') return stripBrackets(raw) ? [] : ['要写'];
  if (slot.kind === 'seq') {
    const toks = seqTokens(raw);
    if (slot.n && toks.length !== slot.n) out.push(`要 ${slot.n} 个数，写了 ${toks.length} 个`);
    else if (!slot.n && toks.length > SEQ_MAX) out.push(`最多 ${SEQ_MAX} 个数，写了 ${toks.length} 个`);
    else if (!toks.length) out.push('要写数');
    const bad = toks.find((t) => !NUM_MARK.test(t));
    if (bad !== undefined) out.push(`「${bad}」不是数`);
    return out;
  }
  // procs：一个进程一组「名字 到达时间 运行时间 [优先级]」，逗号、分号或换行隔开（和 sched 的 procs: 一样）
  const entries = procEntries(raw);
  const want = slot.prio ? 4 : 3;
  const cols = slot.prio ? '名字 到达时间 运行时间 优先级' : '名字 到达时间 运行时间';
  if (entries.length !== slot.n) out.push(`要 ${slot.n} 个进程，写了 ${entries.length} 个`);
  const names = [];
  for (const e of entries) {
    const t = e.split(/[\s,，]+/).filter(Boolean);
    names.push(t[0]);
    if (t.length < want) out.push(`${t[0]} 少一格：一个进程写 ${cols}`);
    else if (t.length > want) out.push(`${t[0]} 多写了一格：一个进程写 ${cols}`);
    else { const bad = t.slice(1).find((x) => !/^\d+(?:\.\d+)?$/.test(x)); if (bad) out.push(`${t[0]} 的「${bad}」不是数`); }
  }
  const twice = names.find((x, k) => names.indexOf(x) !== k);
  if (twice) out.push(`进程名字 ${twice} 写了两次`);
  return out;
}

/**
 * example: A=[[0,1],[0,0]] B=[[1, 0], [0, 0]] k=2（值里可以有空格：按括号配对切）；模板里的 example 能用取到的数（vars）。
 * slots 里 seq / text / procs 的格子收原文（[ ] 可写可不写）：A=49 38 65 P=[49 49']
 */
export function parseNamed(src, vars = {}, slots = []) {
  const asText = new Set(slots.filter((x) => STR_KINDS.has(x.kind)).map((x) => x.name));
  const s = String(src ?? '');
  const out = {};
  const re = /([A-Za-z]\w*)\s*=\s*/g;
  let m;
  const starts = [];
  while ((m = re.exec(s))) {
    // 只认在括号外面的「名字=」
    const before = s.slice(0, m.index);
    const depth = (before.match(/\[/g) || []).length - (before.match(/\]/g) || []).length;
    if (depth === 0) starts.push({ name: m[1], from: m.index + m[0].length, at: m.index });
  }
  starts.forEach((st, i) => {
    const raw = s.slice(st.from, i + 1 < starts.length ? starts[i + 1].at : s.length).trim();
    out[st.name] = asText.has(st.name) ? stripBrackets(raw) : compile(raw)(vars);
  });
  return out;
}

const truthOf = (v, yes, no) => { const t = String(v ?? '').trim().toLowerCase(); if (yes.includes(t)) return true; if (no.includes(t)) return false; return null; };

/**
 * 读一道探题（围栏里的内容）。返回 { probe } 或 { error }。
 * probe 共有：{ id, type, q, target, level, facet, family, teach, retry, lets, src }；各题型另有的见设计 5.1
 */
export function parseProbe(type, src) {
  if (!PROBE_TYPES.includes(type)) return { error: `不认识的题型「${type}」：只认 ${PROBE_TYPES.join(' / ')}` };
  const base = BASE_OF[type] || type; // 别名照原来的那一种读
  const f = {};
  const teach = {};
  const pts = { must: [], may: [], wrong: [] };
  const ifs = [], exprs = [], lets = [], lines = [];
  const solveLines = [];
  const runs = [], expects = []; // run 行（construct、predict）；predict 的 expect
  const hasNot = { has: [], not: [] }; // rewrite
  const efields = {}; // trace：交给引擎的字段
  let ewrongs = 0; // 挂在 expect 下面的错答案几条（和理由里的 wrong 共用 w1、w2…）
  const tpl = { picks: [], lets: [], wheres: [] }; // pick / where（模板）
  let last = null; // 续行接到哪里
  let n = 0; // 要点自动编号（must、may 共用 m1、m2…）
  const errors = [];
  for (const raw of String(src ?? '').replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) {
      // code 的几行代码里的空行留着（起始代码、参考解法里隔开两段）
      if (base === 'code' && last?.into === f && CODE_MULTI.has(last.key)) f[last.key] += `\n${raw}`; else last = null; // 只有空格的行也照原样留（光标缩进）
      continue;
    }
    let m;
    if (base === 'code' && POINT.test(raw)) { errors.push('code 不写要点：要判思路写成 calc（s1 思想、s2 代码、s3 复杂度）'); continue; }
    if (base === 'code' && last?.into === f && CODE_MULTI.has(last.key) && (m = raw.match(FIELD)) && !COMMON.includes(m[1].toLowerCase()) && !OWN.code.includes(m[1].toLowerCase())) {
      f[last.key] += `\n${raw.replace(/\s+$/, '')}`; continue; // default: / case 1: / 标号这样像字段的代码行
    }
    if ((m = raw.match(TEACH))) { teach[m[1]] = m[2].trim(); last = { into: teach, key: m[1] }; continue; }
    // trace：引擎的字段和检验的撞名（tree 的 level、sched 的 q、kmp 的 use……）写成 use.名字:，原样交给引擎
    if (base === 'trace' && (m = raw.match(USE_FIELD))) { const k = m[1].toLowerCase(); efields[k] = m[2].trim(); last = { into: efields, key: k }; continue; }
    // run 行只在 construct、predict 里认：别的题型（英语的 recall）里「run out: …」这样的续行照旧是续行
    if ((base === 'construct' || base === 'predict' || base === 'solve') && (m = raw.match(RUN))) {
      const [, name, engine, rest] = m;
      if (!RUN_NAME.test(name)) { errors.push(`run 的名字「${name}」只用字母和数字（r、t1）`); continue; }
      if (runs.some((r) => r.name === name)) { errors.push(`run ${name} 写了两次`); continue; }
      const fields = {};
      for (const t of tokenize(rest)) {
        if (!t.key) { errors.push(`run ${name} 里「${t.value}」看不懂：写 字段=值，比如 run r: sort algo=shell array=A`); continue; }
        fields[t.key] = t.value;
      }
      runs.push({ name, engine, fields }); last = null; continue;
    }
    if (base === 'rewrite' && (m = raw.match(HASNOT))) {
      const kind = m[1];
      const at = m[2].indexOf('=>');
      const frag = (at < 0 ? m[2] : m[2].slice(0, at)).trim();
      if (!frag) { errors.push(`${kind}: 后面写一段字：${kind}: were …ed => 被动语态的谓语是 be + 过去分词`); continue; }
      hasNot[kind].push({ id: `${kind === 'has' ? 'h' : 'n'}${hasNot[kind].length + 1}`, frag, msg: at < 0 ? '' : m[2].slice(at + 2).trim() });
      last = null; continue;
    }
    if (base === 'predict' && (m = raw.match(EXPECT))) {
      const head = (m[1] || '').trim();
      const own = head.match(/^(x\d+)(?:\s+(.*))?$/);
      let k = expects.length + 1;
      while (expects.some((e) => e.id === `x${k}`)) k++; // 手写过的编号跳过
      const id = own ? own[1] : `x${k}`;
      const label = own ? (own[2] || '').trim() : head;
      expects.push({ id, label: label || id, value: m[2].trim(), wrongs: [] }); last = null; continue;
    }
    if ((m = raw.match(POINT))) {
      const kind = m[1];
      // predict 里带 => 的 wrong 是错答案（式子 => 说明），挂在上面最近的 expect；不带的照旧是理由里的常见错说法
      if (kind === 'wrong' && base === 'predict' && m[3].includes('=>')) {
        const id = m[2] || `w${pts.wrong.length + ewrongs + 1}`;
        if (!expects.length) { errors.push(`wrong ${id} 带 => 的是错答案，要写在某个 expect 下面`); continue; }
        const at = m[3].indexOf('=>');
        const item = { id, expr: m[3].slice(0, at).trim(), msg: m[3].slice(at + 2).trim() };
        expects.at(-1).wrongs.push(item); ewrongs++;
        last = { into: item, key: 'msg' }; continue;
      }
      const id = m[2] || (kind === 'wrong' ? `w${pts.wrong.length + ewrongs + 1}` : `m${++n}`);
      if (m[2] && kind !== 'wrong') { const k = Number(String(m[2]).replace(/^\D+/, '')); if (k > n) n = k; }
      const item = { id, text: m[3].trim() };
      pts[kind].push(item); last = { item }; continue;
    }
    if ((m = raw.match(EXPR))) { const item = { id: `e${exprs.length + 1}`, label: m[1].trim(), expected: m[2].trim() }; exprs.push(item); last = null; continue; }
    if ((m = raw.match(IF))) {
      const [body, msg = ''] = m[1].split('=>').map((x) => x.trim());
      ifs.push({ id: `if${ifs.length + 1}`, text: body, msg }); last = null; continue;
    }
    if ((m = raw.match(LET))) { lets.push({ name: m[1], src: m[2].trim() }); last = null; continue; }
    if (TPL.test(raw)) { try { commandLine(raw.trim(), tpl); } catch (e) { errors.push(e.message); } last = null; continue; }
    if ((m = raw.match(FIELD))) {
      const k = m[1].toLowerCase();
      if (base === 'solve' && k === 'result') { f[k] = m[2].trim(); last = { into: f, key: k }; continue; }
      if (base === 'solve' && !COMMON.includes(k) || base === 'solve' && k === 'q') { solveLines.push(raw); last = { solve: true }; continue; }
      if (k === 'line' && base === 'locate') { lines.push(m[2].trim()); last = { line: lines.length - 1 }; continue; }
      // trace：不是检验的字段都是引擎的（algo: shell、array: …、refs: …），原样交给引擎
      if (base === 'trace' && !COMMON.includes(k) && !OWN.trace.includes(k)) { efields[k] = m[2].trim(); last = { into: efields, key: k }; continue; }
      // trace 里检验的字段写了两次：多半第二个是引擎的同名字段
      if (base === 'trace' && f[k] !== undefined) { errors.push(`${k} 写了两次：${k} 是检验的字段；引擎的 ${k} 写成 use.${k}:`); continue; }
      if (!COMMON.includes(k) && !OWN[base].includes(k)) { errors.push(`看不懂「${raw.trim().slice(0, 40)}」：${type} 的字段是 ${[...COMMON, ...OWN[base]].join('、')}、must / may / wrong / teach / let / if / expr${base === 'construct' || base === 'predict' ? ' / run' : ''}${base === 'predict' ? ' / expect' : ''}`); continue; }
      f[k] = m[2].trim(); last = { into: f, key: k }; continue;
    }
    // 续行
    if (last?.solve) { solveLines.push(raw); continue; }
    if (last?.into) { last.into[last.key] += `\n${base === 'code' && last.into === f && CODE_MULTI.has(last.key) ? raw.replace(/\s+$/, '') : raw.trim()}`; continue; }
    if (last?.item) { last.item.text += `\n${raw.trim()}`; continue; }
    if (last?.line !== undefined) { lines[last.line] += `\n${raw.trim()}`; continue; }
    errors.push(`看不懂这一行：「${raw.trim().slice(0, 40)}」`);
  }
  if (errors.length) return { error: errors[0] };
  // 自动编号（must: …）和手写编号（must m1: …）撞了：报出来，不静默出两个 m1（teach、判分都按编号对）
  const pointIds = [...pts.must, ...pts.may, ...pts.wrong, ...expects.flatMap((e) => e.wrongs)].map((x) => x.id);
  const twice = pointIds.find((x, i) => pointIds.indexOf(x) !== i);
  if (twice) return { error: `${f.id || type}：要点编号 ${twice} 用了两次（自动编号和手写编号撞了：要么都写编号，要么都不写）` };
  // 手写的要点编号和页面判的项撞了（rewrite 的 h1 / n1、errfind 的 word / fix、两个按钮的 pick、parse 的 extra）：补讲、判分都按编号对
  const clashId = RESERVED_IDS[base] && pointIds.find((x) => RESERVED_IDS[base].test(x));
  if (clashId) return { error: `${f.id || type}：要点编号 ${clashId} 和页面判的项撞了，换一个（m1、w1 这样）` };
  const id = f.id || '';
  if (!id) return { error: `${type} 要写 id:` };
  // trace 的引擎正好有这个名字的字段（tree 的 level）：检验读不懂时提醒一句怎么交给引擎
  const clash = (k) => (base === 'trace' && engineHas(f.use, k) ? `；${k} 是检验的字段；引擎的 ${k} 写成 use.${k}:` : '');
  if (!ID_RE.test(id)) return { error: `id「${id}」不合法：只能用字母、数字和 _ - . ~ : @ +${clash('id')}` };
  const at = (msg) => ({ error: `${id}：${msg}` });
  if (!f.target) return at('要写 target:（打的是哪个典型错法：错题、误解的编号或一句话）');
  if (!LEVELS.includes(f.level)) return at(`level: 只能写 ${LEVELS.join(' / ')}${clash('level')}`);
  if (f.facet && !FACETS.includes(f.facet)) return at(`facet: 只能写 ${FACETS.join(' / ')}${clash('facet')}`);
  if (pts.must.length > MUST_MAX && (base === 'recall' || base === 'translate')) return at(`must 最多 3 条（现在 ${pts.must.length} 条）`);
  const xIds = expects.map((e) => e.id);
  const xTwice = xIds.find((x, i) => xIds.indexOf(x) !== i);
  if (xTwice) return at(`expect 的编号 ${xTwice} 用了两次`);
  if (tpl.wheres.length && !tpl.picks.length) return at('where 要和 pick 一起写（模板：pick 取数，where 不满足就重取）');
  let retry;
  try { retry = retryOf(f.retry, id, tpl.picks.length > 0); } catch (e) { return at(e.message); }
  const probe = {
    id, type, q: f.q || '', target: f.target, level: f.level, facet: f.facet || FACET_OF[type], family: f.family || null,
    teach, retry, lets, src: String(src ?? ''), tpl: tpl.picks.length ? { picks: tpl.picks, wheres: tpl.wheres } : null,
  };
  const runNames = runs.map((r) => r.name);
  if (runs.length) probe.runs = runs;
  try {
    if (type === 'construct' && f.against !== undefined) return at('construct 不写 against:（认错法只给 predict、trace）');
    if (type === 'construct' || (type === 'claim' && truthOf(f.truth, ['假', 'false', 'f', 'no', '错'], ['真', 'true', 't', 'yes', '对']) === true)) {
      if (!f.slots) return at('要写 slots:（学生填的东西，比如 A=mat(2) B=mat(2)）');
      if (!ifs.length) return at('要写 if:（一行一条条件）');
      if (!f.example) return at('要写 example:（一组满足全部条件的，页面先拿它验一遍）');
      // 模板的 example 用取到的数写（A=[[k,0],[0,0]]）：取了数再算（drawProbe）
      const slots = parseSlots(f.slots);
      const clash = runNames.find((r) => slots.some((x) => x.name === r));
      if (clash) return at(`run ${clash} 和格子 ${clash} 撞名了：换一个名字`);
      Object.assign(probe, { slots, ifs: ifs.map((c) => ({ ...c })), exprs, example: probe.tpl ? null : parseNamed(f.example, {}, slots), exampleSrc: f.example });
      for (const c of ifs) checkCond(c.text, runNames); // 写法不对在这里抛
    }
  } catch (e) { return at(e.message); }
  const points = () => ({ must: pts.must, may: pts.may, wrong: pts.wrong });
  if (base === 'recall') {
    if (!pts.must.length) return at('要写 must:（必写要点）');
    Object.assign(probe, points(), { answer: f.answer || '' });
  }
  if (type === 'claim') {
    const truth = truthOf(f.truth, ['真', 'true', 't', 'yes', '对'], ['假', 'false', 'f', 'no', '错']);
    if (truth === null) return at('truth: 写 真 或 假');
    if (!f.claim) return at('要写 claim:（命题）');
    Object.assign(probe, { claim: f.claim, truth });
    if (truth) {
      if (f.proof) {
        if (f.proof !== 'derive') return at('proof: 只能写 derive（照 derive mode: do 逐行核）');
        if (!f.start || !f.goal) return at('proof: derive 要写 start: 和 goal:');
        probe.proof = { start: f.start, goal: f.goal, ...(f.vars ? { vars: f.vars } : {}) };
      } else if (!pts.must.length) return at('判真的命题要写证明要点 must:，或 proof: derive');
      Object.assign(probe, points());
    }
  }
  if (type === 'discriminate' && f.options !== undefined) {
    // 两个按钮（谓语 / 非谓语、真 / 假）：只收两个、只配理由（不出选择题）
    if (f.can !== undefined) return at('options: 和 can: 只写一个（can: 是能 / 不能，options: 是自己写的两个按钮）');
    const options = f.options.split(/[|｜]/).map((x) => x.trim()).filter(Boolean);
    if (options.length !== 2) return at(`options: 只收两个（谓语 | 非谓语 这样的两个按钮，配理由），现在 ${options.length} 个`);
    if (normText(options[0]) === normText(options[1])) return at('options: 两个按钮写成了一样的');
    if (f.answer === undefined || !f.answer.trim()) return at('要写 answer:（两个选项里对的那一个）');
    const pick = options.find((o) => normText(o) === normText(f.answer));
    if (!pick) return at(`answer: 写两个选项里的一个（${options.join(' 或 ')}），现在是「${f.answer}」`);
    if (f.result !== undefined) return at('options: 不和 result: 一起写（result: 只给 can: 的题）');
    if (!pts.must.length) return at('要写理由的要点 must:');
    Object.assign(probe, { options, answer: pick }, points());
  } else if (type === 'discriminate') {
    if (f.answer !== undefined) return at('answer: 只和 options: 一起写（两个按钮里对的那一个）；can: 的题不写 answer:');
    const can = truthOf(f.can, ['能', 'yes', 'true', '可以'], ['不能', 'no', 'false', '不可以']);
    if (can === null) return at('can: 写 能 或 不能');
    if (!pts.must.length) return at('要写理由的要点 must:');
    Object.assign(probe, { can }, points(), f.result ? { result: f.result } : {});
  }
  if (type === 'locate') {
    if (lines.length < 2) return at('locate 至少要有两行 line:');
    const bug = Number(f.bug);
    if (!Number.isInteger(bug) || bug < 1 || bug > lines.length) return at(`bug: 写错的是第几行（1 到 ${lines.length}）`);
    if (!pts.must.length) return at('要写为什么错的要点 must:');
    Object.assign(probe, { lines, bug }, points(), f.fix ? { fix: f.fix } : {});
  }
  if (base === 'predict') {
    if (!runs.length) return at('要写 run 行：run r: 引擎 字段=值 …（比如 run r: paging algo=lru frames=3 refs="1 2 3 4"）');
    if (!expects.length) return at('要写 expect：expect 缺页次数: r.faults（一行一个要学生写出来的结果）');
    Object.assign(probe, { expects, against: list(f.against) }, points(), f.answer ? { answer: f.answer } : {});
  }
  if (base === 'trace') {
    if (pts.must.length || pts.may.length || pts.wrong.length) return at('trace 不写 must / may / wrong：整张表由页面照引擎判');
    if (ifs.length || exprs.length) return at('trace 不写 if / expr：整张表由页面照引擎判');
    const use = String(f.use || '').trim().toLowerCase();
    if (!use) return at('要写 use:（演示组件的名字：sort、paging、disk……，下面接它自己的字段）');
    if (!ENGINES[use]) return at(`use: 不认识「${f.use}」：写演示组件的名字（${TRACE_HINT}）`);
    if (!traceable(use)) return at(`${use} 没有填表：trace 照 408 演示组件 mode: fill 的那张表判（${TRACE_HINT}……）`);
    const fill = {};
    if (f.rows !== undefined) {
      const r = rowsOf(f.rows);
      if (!r) return at(`rows: 写只填前几行（rows: 2），或第几到第几行（rows: 2-3），现在是「${f.rows}」`);
      if (r.from > 1 && f.given !== undefined) return at('rows: 写了从第几行起，就不再写 given:（前面的行直接给出）');
      fill.rows = r;
    }
    if (f.given !== undefined) fill.given = f.given;
    if (f.cols !== undefined) fill.cols = f.cols;
    if (f.by !== undefined) {
      if (!/^(rounds?|趟)$/i.test(String(f.by).trim())) return at(`by: 只能写 round（快排按真题说的趟：一层划分做完一行；不写是一次划分一行），现在是「${f.by}」`);
      if (use !== 'sort' || sortAlgo(efields.algo ?? efields.algorithm) !== 'quick') return at('by: round 只给快排（use: sort、algo: quick）：别的排序一趟本来就是一行');
      fill.by = 'round';
    }
    Object.assign(probe, { use, fields: efields, fill, against: list(f.against) });
  }
  if (base === 'solve') {
    const r = parseSolve([`id: ${id}`, ...solveLines].join('\n'));
    if (r.problems.length) return at(r.problems[0]);
    Object.assign(probe, { q: r.fields.q, steps: r.steps, solveFields: r.fields }, f.result ? { result: f.result } : {});
  }
  if (base === 'code') {
    if (tpl.picks.length || tpl.wheres.length) return at('code 不做模板（不写 pick / where）');
    const fields = Object.fromEntries(OWN.code.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));
    try { parseCodeSpec(fields); } catch (e) { return at(e.message); }
    Object.assign(probe, { code: fields });
  }
  if (['parse', 'translate', 'rewrite', 'errfind'].includes(base)) {
    const r = englishProbe(base, f, pts, hasNot, tpl);
    if (r.error) return at(r.error);
    Object.assign(probe, r.fields, points());
  }
  return { probe };
}

// —— 英语的四种（计划 4 Task 6）：读法照一类组件（entext.js），宽严一样 ——
// rewrite 的片段按整词比：先照 normText 规范（大小写、弯引号、缩写展开、句末标点），再去掉标点、空白压成一个，
// 片段里贴着字母的 … 是这个词里的几个字母（…ed 是以 ed 结尾的词、be…ing），单独的 … 是中间隔 0～3 个词，| 隔开几种写法；
// 整段两头不能接着字母、数字、撇号（has: is 不会对上 This）
const WCH = "[\\p{L}\\p{N}']";
const GAP = `(?: ${WCH}+){0,3}`;
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsOnly = (t) => t.replace(/[^\p{L}\p{N}'…]+/gu, ' ').replace(/\s+/g, ' ').trim();
/** rewrite 的一个片段 → 整词比的正则；片段里一个词都没有 null */
export function fragRe(frag) {
  const alts = String(frag ?? '').replace(/\.{3,}|⋯+/g, '…').split(/[|｜]/).flatMap((alt) => {
    const toks = wordsOnly(normText(alt, { sentence: true })).replace(/…+/g, '…').split(' ').filter(Boolean);
    while (toks[0] === '…') toks.shift();
    while (toks.at(-1) === '…') toks.pop();
    if (!toks.length) return [];
    let out = '';
    for (const t of toks) {
      if (t === '…') { if (!out.endsWith(GAP)) out += GAP; continue; }
      out += `${out ? ' ' : ''}${t.split('…').map(esc).join(`${WCH}*`)}`;
    }
    return [out];
  });
  return alts.length ? new RegExp(`(?<!${WCH})(?:${alts.join('|')})(?!${WCH})`, 'u') : null;
}
/** rewrite：学生写的（或 example）对上了哪几条 has、哪几条 not：{ has: [bool], not: [bool] } */
export function rewriteHits(probe, text) {
  const t = wordsOnly(normText(text, { sentence: true })).replace(/…/g, ' ').replace(/\s+/g, ' ').trim();
  const hit = (list) => (list || []).map((h) => !!t && !!fragRe(h.frag)?.test(t));
  return { has: hit(probe.has), not: hit(probe.not) };
}

function englishProbe(base, f, pts, hasNot, tpl) {
  if (tpl.picks.length || tpl.wheres.length) return { error: `${base} 不做模板（不写 pick / where）` };
  const pointsAny = pts.must.length || pts.may.length || pts.wrong.length;
  if (base === 'parse') {
    if (pointsAny) return { error: 'parse 不写 must / may / wrong：成分由页面照 key 判（要问理由另出一道 recall）' };
    if (!f.key) return { error: '要写 key:（括号写法：[S The man [RC who lives next door]] [V gave] [O me] [O a book].）' };
    let ans;
    try { ans = parseBrackets(f.key); } catch (e) { return { error: `key: ${e.message}` }; }
    const roles = parseRoles(f.roles, [...new Set(ans.spans.map((s) => s.role))]);
    for (const s of ans.spans) if (!roles.some((r) => r.key === s.role)) roles.push({ key: s.role, name: ROLES[s.role] || s.role });
    return { fields: { text: ans.text, tokens: ans.tokens, spans: ans.spans, roles } };
  }
  if (!f.text) return { error: `要写 text:（${base === 'translate' ? '要翻译的英文原句' : base === 'rewrite' ? '要改写的原句' : '有一处错的英文句子'}）` };
  if (base === 'translate') {
    if (!pts.must.length) return { error: '要写采分点 must:（一行一条，页面里的 Claude 照它判）' };
    return { fields: { text: f.text, answer: f.answer || '' } };
  }
  if (base === 'rewrite') {
    if (!hasNot.has.length && !hasNot.not.length) return { error: '要写 has: 片段 => 话（改写以后一定有的字，一行一条；不该有的写 not:）' };
    // 只写 not: 的：随便写一句没有那些字的都「过」了——要么写一条 has:，要么写 must 交给页面里的 Claude 判
    if (!hasNot.has.length && !pts.must.length) return { error: 'rewrite 至少写一条 has:（要出现的写法）；只写 not: 时要写 must' };
    if (!f.example) return { error: '要写 example:（一句满足全部 has、没有 not 的改写，页面先拿它验一遍）' };
    for (const k of ['has', 'not']) {
      const bad = hasNot[k].find((h) => !fragRe(h.frag));
      if (bad) return { error: `${k}: 的片段里没有字（${bad.frag}）` };
    }
    return { fields: { text: f.text, has: hasNot.has, not: hasNot.not, example: f.example } };
  }
  // errfind
  if (!f.word) return { error: '要写 word:（句子里用错的那个词，第二次出现的写 are#2）' };
  if (!f.fix) return { error: '要写 fix:（改成什么：known | !knew=为什么错；多了一个词写 删掉）' };
  let wordAt, decoys, fix;
  const asWord = (e) => String(e.message).replace(/wrong:/g, 'word:');
  try { wordAt = findWrong(f.text, f.word); } catch (e) { return { error: asWord(e) }; }
  try { fix = parseAnswer(f.fix, { sentence: true }); } catch (e) { return { error: `fix: ${e.message}` }; }
  if (!fix.alts.length) return { error: 'fix: 要写对的改法（! 开头的是常见的错改法）' };
  try { decoys = parseDecoys(f.text, f.decoys); } catch (e) { return { error: asWord(e) }; }
  if (decoys.some((d) => d.i === wordAt)) return { error: `decoys 里的「${f.word}」就是错的那个词` };
  return { fields: { text: f.text, word: f.word, wordAt, fix: fix.alts, fixWrongs: fix.wrongs, decoys } };
}

const tok = (head) => {
  const kv = {}, loose = [];
  for (const t of tokenize(String(head ?? ''))) { if (t.key) kv[t.key.toLowerCase()] = t.value; else loose.push(t.value); }
  return { kv, loose };
};

/**
 * board check 的开头那行（`check id=k1 …`，前面的 check 可写可不写）+ 块里的内容。
 * 返回 { check, errors }；check 为 null 时 errors 至少一条
 */
export function parseCheck(head, body) {
  const errors = [];
  const { kv, loose } = tok(String(head ?? '').replace(/^\s*check\b/i, ''));
  const id = kv.id || loose[0];
  if (!id || !ID_RE.test(id)) return { check: null, errors: ['要写 id：board check id=k1 …（只能用字母、数字和 _ - . ~ : @ +）'] };
  const limit = kv.limit !== undefined ? msOf(kv.limit) : 0;
  const pause = kv.pause !== undefined ? msOf(kv.pause) : PAUSE_DEFAULT;
  if (!(limit >= 0)) errors.push('limit= 写多久：比如 limit=15m');
  if (!(pause >= 5000)) errors.push('pause= 写停多久算停顿，至少 5s：比如 pause=30s');
  const blocks = [], spare = [], probes = {}, order = [];
  const promptLines = [];
  let inPrompt = false, fence = null;
  const dup = new Set();
  const broken = [];
  for (const raw of String(body ?? '').replace(/\r/g, '').split('\n')) {
    if (fence) {
      if (/^\s*```\s*$/.test(raw)) {
        const r = parseProbe(fence.type, fence.lines.join('\n'));
        if (r.error) {
          errors.push(r.error);
          // 读不懂的题记下 id 和 retry：自检不再因为它连带报「没写这道题」「没排进任何一块」（一处写错只报一条）
          const bid = fence.lines.map((l) => l.match(/^\s*id\s*[:：]\s*(\S+)/)?.[1]).find(Boolean);
          const br = fence.lines.map((l) => l.match(/^\s*retry\s*[:：]\s*(.+)$/)?.[1]).find(Boolean);
          if (bid) broken.push({ id: bid, retry: br ? br.split(/[,，、\s]+/).filter((x) => /^[A-Za-z]/.test(x) && x !== 'self') : [] });
        } else if (probes[r.probe.id]) dup.add(r.probe.id);
        else { probes[r.probe.id] = r.probe; order.push(r.probe.id); }
        fence = null;
      } else fence.lines.push(raw);
      continue;
    }
    if (inPrompt) { if (/^\s*>>>\s*$/.test(raw)) inPrompt = false; else promptLines.push(raw); continue; }
    const line = raw.trim();
    if (!line) continue;
    if (line === '<<<') { inPrompt = true; continue; }
    let m;
    if ((m = line.match(/^```\s*([A-Za-z]\w*)\s*$/))) {
      if (!PROBE_TYPES.includes(m[1])) { errors.push(`块里的「${m[1]}」不是探题：只认 ${PROBE_TYPES.join(' / ')}`); fence = { type: '_skip', lines: [] }; continue; }
      fence = { type: m[1], lines: [] }; continue;
    }
    if ((m = line.match(/^block\s+(\S+)\s*(.*)$/))) {
      const b = m[1];
      if (!BLOCK_RE.test(b)) { errors.push(`block 后面写课程地图的块：比如 block L2.1.4 must=p3,p4（看不懂「${b}」）`); continue; }
      const { kv: bk } = tok(m[2]);
      const fast = bk.fast !== undefined ? msOf(bk.fast) : 0;
      if (!(fast >= 0)) errors.push(`block ${b} 的 fast= 写多久：比如 fast=90s`);
      const must = list(bk.must);
      if (!must.length) errors.push(`block ${b} 要写 must=（必做题的 id，逗号隔开）`);
      blocks.push({ block: b, must, optional: list(bk.optional), fast: fast || 0 });
      continue;
    }
    if ((m = line.match(/^spare\s+(.+)$/))) { spare.push(...list(m[1])); continue; }
    errors.push(`看不懂这一行：「${line.slice(0, 40)}」（块里写 block / spare 行、<<< >>>、探题的围栏）`);
  }
  if (fence && fence.type !== '_skip') errors.push(`${fence.type} 的围栏没有收（少了一行 \`\`\`）`);
  for (const d of dup) errors.push(`${d} 写了两次：一次检验里 id 不能重`);
  if (!blocks.length) errors.push('要写 block 行：block L2.1.4 must=p3,p4 optional=p7');
  // 每道题属于哪一块：block 行里的；retry 跟着本题；spare 照它 retry 的、或第一块
  const blockOf = {};
  for (const b of blocks) for (const pid of [...b.must, ...b.optional]) blockOf[pid] ??= b.block;
  for (let pass = 0; pass < 3; pass++) for (const pid of order) for (const r of probes[pid].retry) if (blockOf[pid] && !blockOf[r]) blockOf[r] = blockOf[pid];
  for (const pid of order) {
    const p = probes[pid];
    p.block = blockOf[pid] || blocks[0]?.block || null;
    if (!/^\s*facet\s*[:：]/m.test(p.src)) p.facet = facetDefault(p.type, p.block); // 没写 facet：照这一块是哪一科
    p.family = p.family || `${p.block}/${p.target}`;
  }
  const check = { id, title: kv.title || '', limit: limit || 0, pause: pause || PAUSE_DEFAULT, blocks, spare, prompt: promptLines.join('\n').trim(), probes, order, src: String(body ?? '') };
  if (broken.length) check.broken = broken;
  // 没有 block 行就没法开：整条不收（别的写法错误照列，check 照给，外壳不开、预检照报）
  return { check: blocks.length ? check : null, errors };
}

/**
 * 题里的量：let 一行一行算（浮点，和 answer 的条件一样），base 是整节课的量；probe.base 是这道题自己带的课上的量
 * （复测从题库出的题：存题库时抄下的，bank.js 的 attachBases）；模板取过数的题带着 vals（取到的数和算好的 let）
 */
export function probeVars(probe, base = {}) {
  const vars = { ...base, ...(probe.base || {}), ...(probe.vals || {}) };
  for (const l of probe.lets || []) vars[l.name] = compile(l.src)(vars);
  return vars;
}

/** 条件里的 O、E：没定义时按第一个方阵的阶数给（零矩阵、单位矩阵） */
export function withDefaults(vars, slots = []) {
  const sq = slots.find((s) => s.kind === 'mat' && s.r === s.c);
  const n = sq ? sq.r : 2;
  const out = { ...vars };
  if (out.O === undefined) out.O = Array.from({ length: n }, () => Array(n).fill(0));
  if (out.E === undefined) out.E = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  return out;
}

const close = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => close(x, b[i]));
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
};
const toNum = (x) => (Array.isArray(x) ? x.map(toNum) : Number(x));

// —— run 行跑出来的量：条件里写 r.faults，读之前换成变量 r__faults ——

/** 条件、式子里的 r.faults 换成 r__faults（只换 run 声明过的名字；0.5 这种小数不碰） */
export function runRefs(text, runNames = []) {
  return String(text ?? '').replace(/\b([A-Za-z]\w*)\.([A-Za-z_]\w*)/g, (all, a, b) => (runNames.includes(a) ? `${a}__${b}` : all));
}
// vars 里有哪些 run（r__faults → r）：调用方没给 runs 时照它认
const runNamesIn = (vars = {}) => [...new Set(Object.keys(vars).map((k) => /^([A-Za-z][A-Za-z0-9]*)__[A-Za-z]/.exec(k)?.[1]).filter(Boolean))];

/** 题里用到了哪些量：[{ run, name, key: 'r.faults' }]（条件、expr、expect、wrong 的式子、result；去重） */
export function measuresUsed(probe) {
  const names = (probe.runs || []).map((r) => r.name);
  const texts = [
    ...(probe.ifs || []).map((c) => c.text), ...(probe.exprs || []).map((e) => e.expected),
    ...(probe.expects || []).flatMap((e) => [e.value, ...e.wrongs.map((w) => w.expr)]), probe.result,
  ];
  const out = new Map();
  for (const t of texts) for (const m of String(t ?? '').matchAll(/\b([A-Za-z]\w*)\.([A-Za-z_]\w*)/g)) {
    if (names.includes(m[1])) out.set(`${m[1]}.${m[2]}`, { run: m[1], name: m[2], key: `${m[1]}.${m[2]}` });
  }
  return [...out.values()];
}

/** 这个引擎交不交这个量（pass2、cmp3 算在 pass#、cmp# 那一族里） */
export function measureKnown(engine, name) {
  const all = MEASURES[engine];
  if (!all) return false;
  if (all.includes(name)) return true;
  const fam = /^([A-Za-z]+)\d+$/.exec(name);
  return !!fam && all.includes(`${fam[1]}#`);
}

// run 的字段值写的是格子名：换成学生写的原文（[ ] 去掉；seq 的分隔统一成空格，撇号留着给 markDuplicates）
function fieldOf(slot, raw) {
  if (slot.kind === 'seq') return seqTokens(raw).join(' ');
  if (STR_KINDS.has(slot.kind)) return stripBrackets(raw);
  return String(raw ?? '');
}
/** 一个 run 照学生写的（或 example）代进去以后的字段 */
export function runFields(probe, run, slotValues = {}) {
  const slots = Object.fromEntries((probe.slots || []).map((x) => [x.name, x]));
  return Object.fromEntries(Object.entries(run.fields).map(([k, v]) => [k, Object.hasOwn(slots, v) ? fieldOf(slots[v], slotValues[v]) : v]));
}

/**
 * 题里的量加上每个 run 跑出来的量（r__faults、r__pass2……）：{ vars, ties, notes, error? }。
 *   ties：靠并列定下来的量（'r.victims'）；用到它的那一项页面判不了（待核，不当过也不当错）
 *   notes：页面替学生做了的事（「页面把第二个 49 记成 49′」），作答下面写一行
 *   error：{ run, msg }——引擎不收这组输入（AVL 里有重复的数），msg 是引擎原话；这一项判没过，后面的 run 不再跑；
 *          { run, msg, page: true }——不是引擎的话（TypeError 这些）：页面这边算不了，判的时候待核
 * slotValues：学生写的（seq / text / procs 是原文）；base：整节课的量
 */
export function runVars(probe, slotValues = {}, base = {}) {
  const vars = probeVars(probe, base);
  const ties = [], notes = [];
  for (const run of probe.runs || []) {
    let m;
    try { m = measure(run.engine, runFields(probe, run, slotValues)); } catch (e) {
      // 引擎不收这组数时抛的是普通的 Error（中文原话）；TypeError、ReferenceError 这些是页面这边的毛病，记 page：判的时候待核，不怪学生
      const page = !(e instanceof Error) || e.constructor !== Error;
      return { vars, ties, notes, error: { run: run.name, msg: e?.message ?? String(e), ...(page ? { page: true } : {}) } };
    }
    for (const [k, v] of Object.entries(m.values)) vars[`${run.name}__${k}`] = v;
    for (const t of m.ties) ties.push(`${run.name}.${t}`);
    if (m.marked && !notes.includes(m.marked)) notes.push(m.marked);
  }
  return { vars, ties, notes };
}

// —— 比字：r.flipped、r.order、r.victims 这类量，seq / text / procs 的格子 ——

/**
 * 一个值切成比较用的词：不管空格、逗号、括号、大小写；' ’ ′ _ 都写成 ′；全是数时一样的数后出现的记成 49′（和跑排序前一样），
 * 所以 49 49、49 49'、49 49’、49 49′ 是一个意思
 */
export function normTokens(v) {
  const s = (Array.isArray(v) ? v.flat(Infinity) : [v]).map((x) => String(x ?? '')).join(' ');
  let toks = s.replace(/[[\]()（）【】"“”「」]/g, ' ').split(/[\s,，、;；]+/).filter(Boolean).map((t) => t.replace(/['’′_]/g, '′').toLowerCase());
  if (toks.length && toks.every((t) => NUM_MARK.test(t))) {
    toks = markDuplicates(toks.join(' ')).text.split(' ').map((t) => t.replace(/^-?\d+(?:\.\d+)?/, (x) => String(Number(x))));
  }
  return toks;
}
const sameToks = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sorted = (a) => [...a].sort();
const hasStr = (v) => (Array.isArray(v) ? v.some(hasStr) : typeof v === 'string');
/** 两个值一样不一样：都是数（或数组）照浮点比，有字的照 normTokens 比（先后算数） */
export function sameValue(a, b) {
  if (!hasStr(a) && !hasStr(b)) { try { return close(toNum(a), toNum(b)); } catch { return false; } }
  return sameToks(normTokens(a), normTokens(b));
}

const QUOTED = /^(?:"[^"]*"|“[^”]*”|「[^」]*」)$/;
const SIMPLE = /^(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|"[^"]*"|“[^”]*”|「[^」]*」)$/;
// 条件切成两边：in（有空格隔开的词）→ == / != → >= <= > <；引号里的不算
function condParts(text) {
  const s = String(text ?? '');
  const masked = s.replace(/"[^"]*"|“[^”]*”|「[^」]*」/g, (m) => '\u0001'.repeat(m.length));
  let m = /\s+in\s+/.exec(masked);
  if (m) return { lhs: s.slice(0, m.index).trim(), op: 'in', rhs: s.slice(m.index + m[0].length).trim() };
  m = /==|!=/.exec(masked) || /<=|>=|<|>/.exec(masked);
  if (!m) return null;
  return { lhs: s.slice(0, m.index).trim(), op: m[0], rhs: s.slice(m.index + m[0].length).trim() };
}

/** 读的时候先验一遍条件的写法（不对就抛）：== != 两边式子；>= <= > < 比大小；字的 ==、!=、in */
export function checkCond(text, runNames = []) {
  const sp = condParts(text);
  if (!sp || !sp.lhs || !sp.rhs) throw new Error(`「${text}」要写成「式子 == 式子」「式子 != 式子」、比大小（r.cmp >= 10），或「P in r.flipped」`);
  const simple = SIMPLE.test(sp.lhs) && SIMPLE.test(sp.rhs);
  if (sp.op === 'in') { if (!simple) throw new Error(`「${text}」：in 两边写格子、量或 "字"，比如 P in r.flipped`); return; }
  if (simple) return;
  if (QUOTED.test(sp.lhs) || QUOTED.test(sp.rhs)) throw new Error(`「${text}」：和 "字" 比时另一边只写格子或量`);
  if (sp.op === '==' || sp.op === '!=') parseConditions(runRefs(text, runNames));
  else compile(runRefs(text, runNames));
}

// 一条条件代进去：对 true、不对 false（算不了抛）
function condOk(text, scope, values, kinds, runNames) {
  const sp = condParts(text);
  if (!sp) throw new Error(`「${text}」看不懂`);
  const isStrSlot = (side) => STR_KINDS.has(kinds[side]);
  const val = (side) => {
    if (QUOTED.test(side)) return side.slice(1, -1);
    if (isStrSlot(side)) return values[side];
    return compile(runRefs(side, runNames))(scope);
  };
  if (sp.op === 'in') {
    const want = sorted(normTokens(val(sp.lhs)));
    const pool = val(sp.rhs);
    const list = Array.isArray(pool) ? pool : String(pool ?? '').split('|');
    return list.some((x) => sameToks(sorted(normTokens(x)), want));
  }
  const both = SIMPLE.test(sp.lhs) && SIMPLE.test(sp.rhs);
  // 一串（r.flipped、r.victims、r.final）和一个数比：close 永远不等，r.flipped != 0 会一直算满足——不静默，报写法
  // （只管用到 run 的量、或 seq / text / procs 格子的条件：数学的格子、矩阵和数比的照旧）
  const isRun = (side) => runRefs(side, runNames) !== side;
  const strSlotIn = (side) => [...String(side).matchAll(/(?<![.\w])([A-Za-z_]\w*)/g)].some((m) => isStrSlot(m[1]));
  const touches = (side) => isRun(side) || strSlotIn(side);
  const isSeq = (v) => Array.isArray(v) || typeof v === 'string';
  const mixed = (a, b) => {
    if (isSeq(a) === isSeq(b)) return;
    const side = isSeq(a) ? sp.lhs : sp.rhs;
    throw new Error(`${side} 是一串，和格子、量或 "字" 比（比如 P in ${side}），不和一个数比`);
  };
  if ((sp.op === '==' || sp.op === '!=') && both) {
    const a = val(sp.lhs), b = val(sp.rhs);
    const quoted = QUOTED.test(sp.lhs) || QUOTED.test(sp.rhs);
    const str = quoted || isStrSlot(sp.lhs) || isStrSlot(sp.rhs);
    if (!quoted && (touches(sp.lhs) || touches(sp.rhs))) mixed(a, b);
    const asText = str || hasStr(a) || hasStr(b);
    return (asText ? sameToks(normTokens(a), normTokens(b)) : close(toNum(a), toNum(b))) === (sp.op === '==');
  }
  if (sp.op === '==' || sp.op === '!=') {
    const [cond] = parseConditions(runRefs(text, runNames));
    const a = cond.lhs(scope), b = cond.rhs(scope);
    if (touches(sp.lhs) || touches(sp.rhs)) {
      mixed(a, b);
      if (hasStr(a) || hasStr(b)) throw new Error(`${hasStr(a) ? sp.lhs : sp.rhs} 是字，算式里不能算：直接写 ${hasStr(a) ? sp.lhs : sp.rhs} == "…" 或 P == ${hasStr(a) ? sp.lhs : sp.rhs}`);
    }
    return close(a, b) === (cond.op === '==');
  }
  return !!compile(runRefs(text, runNames))(scope);
}

// 格子的值放进算式里：seq 全是数时成一排数（撇号去掉），text / procs 留原文；别的照旧换成浮点
function numOf(slot, v) {
  if (slot?.kind === 'seq') {
    const toks = Array.isArray(v) ? null : seqTokens(v);
    if (toks && toks.length && toks.every((t) => NUM_MARK.test(t))) return toks.map((t) => Number(t.replace(/['’′_]+$/, '')));
    return Array.isArray(v) ? toNum(v) : v;
  }
  if (STR_KINDS.has(slot?.kind)) return v;
  return toNum(v);
}
/** 题里的量 + 格子里写的（seq 读成一排数）：条件、expr 代进去算的那一份（judge.js 的 construct 408 也用） */
export const slotScope = (values, vars, slots) => scopeOf(values, vars, slots);
const scopeOf = (values, vars, slots) => {
  const by = Object.fromEntries(slots.map((x) => [x.name, x]));
  return withDefaults({ ...vars, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, numOf(by[k], v)])) }, slots);
};

/**
 * 一组值逐条代进 if 里：[{ id, ok, error? }]（judge.js 判学生的也用它）。
 * vars 里有 run 跑出来的量（runVars 的 vars）时，条件里的 r.faults 照它读；runs 不给就从 vars 的 r__… 认
 */
export function evalIfs(ifs, values, vars = {}, slots = [], { runs } = {}) {
  const runNames = runs ?? runNamesIn(vars);
  const kinds = Object.fromEntries(slots.map((x) => [x.name, x.kind]));
  const scope = scopeOf(values, vars, slots);
  return ifs.map((c) => {
    try { return { id: c.id, ok: condOk(c.text, scope, values, kinds, runNames) }; } catch (e) { return { id: c.id, ok: false, error: e.message }; }
  });
}

/**
 * predict 的 expect（和挂着的 wrong 式子）算出来的值：一个量照原样（数、序列、字），式子照算，
 * 都不是的当字面的数 / 序列 / 字（7 1 0、"P1 P2"）。用到了 run 的量却算不出来就抛
 */
export function expectValue(text, vars = {}, runNames = runNamesIn(vars)) {
  const src = String(text ?? '').trim();
  if (QUOTED.test(src)) return src.slice(1, -1);
  const key = runRefs(src, runNames);
  const usesRun = key !== src;
  if (usesRun && /^[A-Za-z_]\w*$/.test(key)) {
    if (vars[key] === undefined) throw new Error(`${src} 这组数没算出来`);
    return vars[key];
  }
  try { return compile(key)(vars); } catch (e) {
    if (usesRun) throw e;
    return stripBrackets(src);
  }
}

/**
 * 自检：外部写的检验自己对不对（每条一句，空数组是好的）。
 * lenient：复测从题库拼的 check（bank.js 的 retestCheck）——备用题本来就可以没有 retry、teach，不按「必做题至少 2 道 retry、1 条 teach」要求
 */
export function selfCheck(check, base = {}, { lenient = false } = {}) {
  const out = [];
  const P = check.probes;
  const bad = new Set((check.broken || []).map((b) => b.id)); // 读不懂、已经报过的题
  const placed = new Set([...check.blocks.flatMap((b) => [...b.must, ...b.optional]), ...check.spare]);
  for (const b of check.blocks) for (const pid of [...b.must, ...b.optional]) if (!P[pid] && !bad.has(pid)) out.push(`block ${b.block} 里的 ${pid} 没写这道题`);
  for (const pid of check.spare) if (!P[pid] && !bad.has(pid)) out.push(`spare 里的 ${pid} 没写这道题`);
  const retried = new Set([...Object.values(P).flatMap((p) => p.retry), ...(check.broken || []).flatMap((b) => b.retry)]);
  const isTpl = (id) => !!P[id]?.tpl;
  // 一道 retry 只给一道题用；retry 不再排进 block / spare（不然出到它时已经交过，学生卡住）。
  // 模板不受这两条管：每用一次都是另取一组数的一道新题（p1~2…）
  const usedBy = new Map();
  for (const pid of check.order) for (const r of new Set(P[pid].retry)) usedBy.set(r, [...(usedBy.get(r) || []), pid]);
  for (const [r, by] of usedBy) {
    if (isTpl(r)) continue;
    if (by.length > 1) out.push(`${r} 是 ${by.join('、')} 两道题的 retry：一道 retry 只给一道题用`);
    if (placed.has(r)) out.push(`${r} 是 ${by[0]} 的 retry，又排进了 block / spare：retry 不单独出`);
  }
  for (const pid of check.order) {
    const rs = P[pid].retry;
    for (const r of new Set(rs)) {
      if (isTpl(r)) continue;
      if (r === pid) out.push(`${pid} 的 retry 写了它自己：只有带 pick 的题（每次取新数的模板）能这么写`);
      else if (rs.filter((x) => x === r).length > 1) out.push(`${pid} 的 retry 写了两次 ${r}：只有带 pick 的题（每次取新数的模板）能写两次`);
    }
  }
  const must = new Set(check.blocks.flatMap((b) => b.must));
  for (const pid of check.order) {
    const p = P[pid];
    if (!placed.has(pid) && !retried.has(pid)) out.push(`${pid} 没排进任何一块，也不是谁的 retry（不出现的题写进 spare）`);
    for (const r of p.retry) {
      if (!P[r] && bad.has(r)) continue;
      if (!P[r]) out.push(`${pid} 的 retry 写了 ${r}，块里没有这道题${p.type === 'trace' && engineHas(p.use, 'retry') ? '；retry 是检验的字段；引擎的 retry 写成 use.retry:' : ''}`);
      else if (P[r].type !== p.type) out.push(`${pid} 的 retry ${r} 是 ${P[r].type}，和本题的题型 ${p.type} 不一样`);
    }
    if (must.has(pid) && !lenient) {
      if (p.retry.length < RETRY_MIN) out.push(`${pid} 是必做题，retry 至少 2 道（现在 ${p.retry.length} 道）`);
      if (!Object.keys(p.teach).length) out.push(`${pid} 是必做题，至少写一条 teach（判出没过时显示的一两句）`);
    }
    if (!p.tpl) { for (const msg of probeProblems(p, base)) out.push(`${pid} 的 ${msg}`); continue; }
    // 模板：取几组数，每一组都要算得出来、example 都要满足（只报第一处）。按检验 id 和题 id 取数：预检和页面开检验时结论一样。
    // 只靠这组数的（用到的量有并列、against 的错法分不开）当成 where 不满足：重取，最多 DRAW_TRIES 次（和 materialize 一样），一直这样才报
    let avoid = null;
    const rand = seeded(`${check.id}:${pid}`);
    rounds: for (let k = 0; k < TPL_ROUNDS; k++) {
      for (let t = 0; t < DRAW_TRIES; t++) {
        let d;
        try { d = drawProbe(p, { base, avoid, rand }); } catch (e) { out.push(`${pid}：${e.message}`); break rounds; }
        avoid = d.raw;
        const is = probeIssues(d.probe, base);
        const hard = [...d.probe.calcErrors, ...is.hard];
        if (hard.length) { out.push(`${pid}（取 ${d.picked} 时）的 ${hard[0]}`); break rounds; }
        if (!is.redraw.length) continue rounds;
        if (t === DRAW_TRIES - 1) { out.push(`${pid}（取 ${d.picked} 时）的 ${is.redraw[0]}（连着取了 ${DRAW_TRIES} 组都这样）`); break rounds; }
      }
    }
  }
  return out;
}

/** 固定种子的随机数（mulberry32，种子是字符串的 FNV-1a） */
export function seeded(str) {
  let a = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) { a ^= String(str).charCodeAt(i); a = Math.imul(a, 16777619) >>> 0; }
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一道题的量算不算得出来、example 满不满足条件（selfCheck 的那一半；每条前面由调用方加「p1 的」）：probeIssues 的两种合起来 */
export function probeProblems(p, base = {}) {
  const { hard, redraw } = probeIssues(p, base);
  return [...hard, ...redraw];
}

/**
 * 同 probeProblems，分成两种：{ hard, redraw }。redraw 是靠这组数本身的那几条——用到的量有并列、against 的错法分不开
 * （或这组数上没列出来）：模板取到这样的数当成 where 不满足、重取（materialize、selfCheck 的模板那一段）；固定的题两种都是写法错误
 */
export function probeIssues(p, base = {}) {
  const soft = new Set();
  const all = problemsOf(p, base, soft);
  return { hard: all.filter((m) => !soft.has(m)), redraw: all.filter((m) => soft.has(m)) };
}

// 全部问题一句一句排；靠这组数的那几条同时放进 soft
function problemsOf(p, base, soft) {
  const out = [];
  let vars;
  try { vars = probeVars(p, base); } catch (e) { return [`let 算不出来：${e.message}`]; }
  const runOut = runProblems(p);
  if (runOut.length) return runOut; // 引擎、量名不对，后面代进去算也是白算
  const used = measuresUsed(p).map((x) => x.key);
  const tieLines = (ties, what) => [...new Set(used.filter((k) => ties.includes(k)))].map((k) => `${what}用到的 ${k} 这组数有并列（几种做法一样好，页面判不了）：换一组数，或者不问 ${k}`).map((m) => (soft.add(m), m));
  if (p.ifs && p.example) {
    const missing = p.slots.filter((s) => p.example[s.name] === undefined).map((s) => s.name);
    const fmt = p.slots.flatMap((s) => (missing.includes(s.name) ? [] : slotProblems(s, p.example[s.name]).map((m) => `example 的 ${s.name}：${m}`)));
    if (missing.length) out.push(`example 少了 ${missing.join('、')}`);
    else if (fmt.length) out.push(...fmt);
    else {
      const rv = p.runs ? runVars(p, p.example, base) : { vars, ties: [] };
      if (rv.error) out.push(`example 跑不了 run ${rv.error.run}：${rv.error.msg}`);
      else {
        out.push(...tieLines(rv.ties, 'example '));
        for (const r of evalIfs(p.ifs, p.example, rv.vars, p.slots)) if (!r.ok) out.push(`example 不满足 ${r.id}（${p.ifs.find((c) => c.id === r.id).text}）${r.error ? `：${r.error}` : ''}`);
        const names = (p.runs || []).map((r) => r.name);
        for (const e of p.exprs || []) {
          if (oUnread(e.expected)) { out.push(`expr「${e.label}」「${e.expected}」：${O_UNREAD}`); continue; }
          try { compile(runRefs(e.expected, names))(scopeOf(p.example, rv.vars, p.slots)); } catch (err) { out.push(`expr「${e.label}」算不了：${err.message}`); }
        }
      }
    }
  } else if (p.ifs && p.exampleSrc && !p.tpl) out.push('example 算不出来');
  if (p.expects) out.push(...predictProblems(p, base, tieLines, soft));
  if (p.use) out.push(...traceProblems(p, soft));
  if (p.type === 'rewrite') out.push(...rewriteProblems(p));
  if (p.code) out.push(...codeProblems(p));
  else if (p.result && baseType(p) === 'solve' && p.runs?.length) out.push(...solveResultProblems(p, base, vars, tieLines));
  else if (p.result) { try { compile(p.result)(withDefaults(vars)); } catch (e) { out.push(`result 算不了：${e.message}`); } }
  return out;
}

// solve / calc 的 result 带 run：照固定的字段跑一遍，算得出来、用到的量没有并列
function solveResultProblems(p, base, vars, tieLines) {
  const rv = runVars(p, {}, base);
  if (rv.error) return [`跑不了 run ${rv.error.run}：${rv.error.msg}`];
  const out = tieLines(rv.ties, 'result ');
  try {
    const v = expectValue(p.result, rv.vars, p.runs.map((r) => r.name));
    if (typeof v === 'number' && !Number.isFinite(v)) out.push('result 算出来不是一个数');
  } catch (e) { out.push(`result 算不了：${e.message}`); }
  return out;
}

// rewrite：example 要对上每一条 has、一条 not 都不写（不然学生写对了也判不过）
function rewriteProblems(p) {
  const r = rewriteHits(p, p.example);
  return [
    ...p.has.filter((_, i) => !r.has[i]).map((h) => `example 不满足 ${h.id}（${h.frag}）`),
    ...p.not.filter((_, i) => r.not[i]).map((h) => `example 写了 ${h.id} 不该有的（${h.frag}）`),
  ];
}

// code：没 ref 时每个测试要写期望；ref 要过自己的全部测试（否则题本身错了）
function codeProblems(p) {
  let spec;
  try { spec = parseCodeSpec(p.code); } catch (e) { return [e.message]; }
  if (!spec.ref) return spec.tests.some((t) => !t.expect) ? ['没写 ref:（参考解法）时，每个测试都要写 -> 期望，页面才知道对的是什么'] : [];
  let res;
  try { res = runTests(p.code.ref, spec); } catch (e) { return [`ref 跑不了：${e.message}`]; }
  return res.flatMap((r, i) => (r.ok ? [] : [`ref（参考解法）过不了自己的测试 t${i + 1}：${r.error || (r.diff || []).map((d) => `${d.what} 想要 ${d.want}，得到 ${d.got}`).join('；')}`]));
}

// C-SCAN / C-LOOK 跳回去的那一段算不算距离，各书不一样（引擎不写 jump: 时不算）：用到距离的题不猜，要写明
export const JUMP_MSG = '写明 jump: count 或 jump: skip，题面也写清楚跳回去算不算';
const jumpAlgo = (algo) => /^c-?(scan|look)$/i.test(String(algo ?? '').trim());

// run 行自己的：引擎交不交量、题里用到的量是不是这个引擎的
function runProblems(p) {
  const out = [];
  for (const r of p.runs || []) if (!MEASURES[r.engine]) out.push(`run ${r.name} 的引擎 ${r.engine} 不交量：run 只认 ${Object.keys(MEASURES).join('、')}`);
  if (out.length) return out;
  const runOf = Object.fromEntries((p.runs || []).map((r) => [r.name, r]));
  const slotNames = new Set((p.slots || []).map((x) => x.name));
  for (const u of measuresUsed(p)) {
    const r = runOf[u.run], e = r.engine;
    if (!measureKnown(e, u.name)) { out.push(`${u.key} 不是 ${e} 的量：${u.run}（${e}）的量有 ${MEASURES[e].join('、')}（pass#、cmp# 写成 pass2、cmp1）`); continue; }
    const algo = r.fields.algo ?? r.fields.algorithm;
    const literal = algo !== undefined && !slotNames.has(algo);
    // rounds / round# 只有快排有（别的排序一趟就是 pass#）；algo 是学生写的格子时页面跑出来没有就是待核
    if (e === 'sort' && /^round(s|\d+)$/.test(u.name) && literal && sortAlgo(algo) !== 'quick') out.push(`${u.key}：round#、rounds 只有快排有（真题说的趟：一层划分做完），别的排序一趟就是 pass#`);
    // algo 写成格子（学生自己选）也算：学生选了 C-SCAN 一样说不清
    if (e === 'disk' && (u.name === 'dist' || u.name === 'avg') && r.fields.jump === undefined && (jumpAlgo(algo) || (algo !== undefined && slotNames.has(algo)))) {
      out.push(`run ${u.run}（disk algo=${algo}）用到 ${u.key}：C-SCAN / C-LOOK 跳回去的距离算不算各书不一样，${JUMP_MSG}（run 行写 jump=count 或 jump=skip）`);
    }
  }
  return [...new Set(out)];
}

// 写成 O(…) 的复杂度页面读不懂：学生写对了也判不过（values.js 的 valueMatch 退回去比字），交之前报给外部
const O_UNREAD = '复杂度写法页面读不懂：写成 O(n log n)、O(n^2) 这样化简后的';
const oUnread = (v) => typeof v === 'string' && /^\s*[oOΘθ]\s*[(（]/.test(v) && bigO(v) === null;

// predict：照固定的字段跑一遍，每个 expect、wrong 的式子都算得出来；用到的量没有并列；against 的错法在、这组数分得开
function predictProblems(p, base, tieLines, soft = new Set()) {
  const out = [];
  const rv = runVars(p, {}, base);
  if (rv.error) return [`run ${rv.error.run} 跑不了：${rv.error.msg}`];
  out.push(...tieLines(rv.ties, ''));
  const names = p.runs.map((r) => r.name);
  const right = {};
  // 少写了「r.」的量名（expect 缺页: faults）会被当成字面的字，判的时候永远对不上：报出来
  const bare = (text) => {
    const plain = String(text ?? '').replace(/"[^"]*"|“[^”]*”|「[^」]*」/g, ' '); // 引号里的是字，不查
    for (const m of plain.matchAll(/(?<![.\w])([A-Za-z_]\w*)/g)) {
      const run = p.runs.find((r) => measureKnown(r.engine, m[1]));
      if (run && rv.vars[m[1]] === undefined) return `${m[1]} 是量的名字：写 ${run.name}.${m[1]}`;
    }
    return null;
  };
  for (const e of p.expects) {
    const b = bare(e.value);
    if (b) out.push(`expect ${e.id}（${e.label}）的 ${b}`);
    else {
      try { right[e.id] = expectValue(e.value, rv.vars, names); } catch (err) { out.push(`expect ${e.id}（${e.label}）算不出来：${err.message}`); }
      if (oUnread(right[e.id])) out.push(`expect ${e.id}（${e.label}）「${right[e.id]}」：${O_UNREAD}`);
    }
    for (const w of e.wrongs) {
      const bw = bare(w.expr);
      if (bw) { out.push(`wrong ${w.id} 的 ${bw}`); continue; }
      let wv;
      try { wv = expectValue(w.expr, rv.vars, names); } catch (err) { out.push(`wrong ${w.id} 算不出来：${err.message}`); continue; }
      if (oUnread(wv)) out.push(`wrong ${w.id}「${wv}」：${O_UNREAD}`);
    }
  }
  if (!p.against?.length) return out;
  // 错法照第一个 run 认：换成那种错法跑出来的量，看有没有哪一个 expect 和对的不一样
  const again = (m) => (soft.add(m), m); // 靠这组数的：模板重取
  const r0 = p.runs[0];
  const fields = runFields(p, r0, {});
  let keys = [];
  try { keys = variantsOf(r0.engine, fields).map((v) => v.key); } catch { keys = []; }
  for (const a of p.against) {
    // 引擎只列这组数上和对的不一样的错法、没有整张错法名单：不在里面的，要么不是这个引擎的错法，要么这组数分不开，两种都说
    if (!keys.includes(a)) { out.push(again(`against 写了「${a}」：要么不是 ${r0.engine} 的错法，要么这组数上照它算和对的做法一样（分不开）；${r0.name}（${r0.engine}）这组数列出来的错法有 ${keys.join('、') || '（没有：这组数上每种错法都和对的一样）'}`)); continue; }
    const wv = variantValues(r0.engine, fields, a);
    const vv = Object.fromEntries(Object.entries(rv.vars).filter(([k]) => !k.startsWith(`${r0.name}__`)));
    for (const [k, v] of Object.entries(wv?.values || {})) vv[`${r0.name}__${k}`] = v;
    const apart = p.expects.some((e) => {
      if (!(e.id in right)) return false;
      try { const x = expectValue(e.value, vv, names); return x !== undefined && !sameValue(x, right[e.id]); } catch { return false; }
    });
    if (!apart) out.push(again(`against 的 ${a} 这组数分不开：照这种错法算，${p.expects.map((e) => e.id).join('、')} 都和对的一样（换一组数）`));
  }
  return out;
}

// —— trace 手推：学生填引擎的那张表（stepperspec.js 的 mode: fill），页面整张一次判 ——

// 线代的演示组件也有 table（求秩、求逆写结果的表），不是一步步的过程：trace 不接；trace、frames 没有填表
const NO_TRACE = new Set(['elim', 'det', 'eig', 'schmidt', 'quad']);
const traceable = (use) => !!ENGINES[use]?.table && !NO_TRACE.has(use);
const TRACE_HINT = 'sort、paging、disk、sched、tree、hash、banker';
const USE_FIELD = /^\s*use\.([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/;
// 引擎自己有、名字和检验的字段一样的（tests/check-trace.test.js 照引擎的源码核这张表）：写成 use.名字:
export const ENGINE_CHECK_FIELDS = {
  sched: ['q'], memexp: ['target'], util: ['target'], tree: ['level'], thread: ['level'],
  csma: ['retry'], mem: ['retry'], net: ['use'], kmp: ['use'],
};
const engineHas = (use, k) => (ENGINE_CHECK_FIELDS[String(use ?? '').trim().toLowerCase()] || []).includes(k);
// rows / given / cols 写的不对（不是引擎的字段）：自检照原话报，不加「字段读不懂」
const specError = (msg) => Object.assign(new Error(msg), { spec: true });

// rows: 2（只填前 2 行）/ rows: 2-3（第 1 行直接给出，只填第 2～3 行）→ { from, to }；写错 null
function rowsOf(v) {
  const s = String(v ?? '').trim();
  let m = /^(\d+)$/.exec(s);
  if (m) return Number(m[1]) >= 1 ? { from: 1, to: Number(m[1]) } : null;
  m = /^(\d+)\s*[-–—~～到]\s*(\d+)$/.exec(s);
  if (!m) return null;
  const from = Number(m[1]), to = Number(m[2]);
  return from >= 1 && from <= to ? { from, to } : null;
}

// 有并列的那一步以后，块里放着什么、磁头接着去哪都看前面选了哪一种：从第一处并列起往后都算有并列（只要这几个引擎能对上表的行）
const TIE_ROWS = {
  paging: (tieAt) => tieAt.victims, // 第几个访问 = 第几列
  disk: (tieAt) => tieAt.order, // 第几个服务 = 第几行
};

const traceCache = new WeakMap();
/**
 * trace 的那张表：照 probe.use 的引擎跑 probe.fields，取引擎的 table（mode: fill 那一张），套上 rows / given / cols。
 * 返回 { table, variants: [{ key, label, table }]（引擎的错法，短名照 measures.js 的 variantsOf）, ties（有并列的行：table.rows 的下标，从 0 数）,
 *   input（引擎读出来的输入）, unknown（写了却没用上的字段）}。字段读不懂、引擎不收、rows 超出抛中文原因
 */
export function traceTable(probe) {
  if (traceCache.has(probe)) return traceCache.get(probe);
  const use = probe.use;
  const engine = ENGINES[use];
  if (!engine || !traceable(use)) throw new Error(`${use} 没有填表`);
  const raw = { ...probe.fields };
  if (use === 'sort' && raw.array !== undefined) raw.array = markDuplicates(raw.array).text; // 和 measure 一样先标撇号
  const tracked = trackFields(raw);
  const input = engine.parse(tracked.fields, '');
  const run = engine.run(input);
  const fill = probe.fill || {};
  // by: round：快排一层划分做完一行（真题说的趟），错法那几张也照层出
  const tableOf = (inp, r) => (fill.by === 'round' ? roundTable(inp, r) : engine.table(inp, r, tracked.fields));
  const full = tableOf(input, run);
  if (!full) throw new Error(`${use} 这组字段没有填表（换一种写法，或者用 predict 问结果）`);
  const unit = full.dir === 'col' ? '列' : '行';
  const spec = {};
  if (fill.rows) {
    if (fill.rows.to > full.rows.length) throw specError(`rows: 写到第 ${fill.rows.to} ${unit}，这张表只有 ${full.rows.length} ${unit}`);
    spec.rows = String(fill.rows.to);
    if (fill.rows.from > 1) spec.given = String(fill.rows.from - 1);
  }
  if (fill.given !== undefined) spec.given = fill.given;
  if (fill.cols !== undefined) spec.cols = fill.cols;
  const made = fillSpec(full, spec);
  if (made.errors.length) throw specError(made.errors[0]);
  const table = made.table;
  // 错法：每一种照它的输入再跑一遍、出同样套过 rows / given / cols 的表（算不了的那种跳过）
  const variants = [];
  let list = [];
  try { list = variantsOf(use, probe.fields); } catch { list = []; }
  for (const v of list) {
    try {
      const vt = tableOf(v.input, engine.run(v.input));
      if (vt) variants.push({ key: v.key, label: v.label, table: fillSpec(vt, spec).table });
    } catch { /* 这种错法在这组数上算不了 */ }
  }
  let ties = [];
  if (TIE_ROWS[use]) {
    let tieAt = {};
    try { tieAt = measure(use, probe.fields).tieAt || {}; } catch { tieAt = {}; }
    const at = TIE_ROWS[use](tieAt) || [];
    if (at.length) { const from = Math.min(...at); ties = table.rows.map((_, r) => r).filter((r) => r >= from); }
  }
  const out = { table, variants, ties, input, unknown: tracked.unknown() };
  traceCache.set(probe, out);
  return out;
}

/** 这张表的第 k 个要填的行（r1、r2…从 1 数，只数有要填的格的行）：[{ r（table.rows 的下标）, id }] */
export function traceRows(table) {
  return table.rows.map((row, r) => ({ r, row })).filter((x) => x.row.cells.some((c) => !c.given)).map((x, k) => ({ r: x.r, id: `r${k + 1}` }));
}

/** 一行叫什么：引擎写的行名（「第 2 趟（d = 2）」）；横着写的表（每一步一列）是「第 10 列「3」」；没有名字「第 k 行」 */
export function traceRowName(table, r) {
  const label = table.rows[r]?.label;
  const has = label !== undefined && String(label) !== '';
  if (table.dir === 'col') return has ? `第 ${r + 1} 列「${label}」` : `第 ${r + 1} 列`;
  return has ? String(label) : `第 ${r + 1} 行`;
}

// 照某张表填出来的作答（每格取第一个答案；打勾的格写 √）：看错法和对的分不分得开
const valuesOf = (t) => Object.assign(t.rows.map((row) => row.cells.map((c) => { const a = [].concat(c.v)[0]; return c.mark ? (normCell(a) ? '√' : '') : String(a ?? ''); })), { extra: (t.extra || []).map((x) => String([].concat(x.v)[0] ?? '')) });

// trace：字段读得懂、没有写错名字的字段、要填的行没有并列、against 的错法这组数分得开
function traceProblems(p, soft = new Set()) {
  const again = (m) => (soft.add(m), m); // 靠这组数的（并列、分不开）：模板重取
  let T;
  try { T = traceTable(p); } catch (e) {
    if (e.spec) return [e.message]; // rows / given / cols 写的不对，不是引擎的字段
    // 引擎要的字段可能被检验拿走了（sched 的 q、memexp 的 target）：没写 use.名字: 的提醒一句
    const lost = (ENGINE_CHECK_FIELDS[p.use] || []).filter((k) => p.fields?.[k] === undefined).map((k) => `${k} 是检验的字段；引擎的 ${k} 写成 use.${k}:`);
    return [`${p.use} 的字段读不懂：${e.message}${lost.length ? `（${lost.join('；')}）` : ''}`];
  }
  const out = [...T.unknown];
  if (p.use === 'disk' && jumpAlgo(p.fields?.algo) && p.fields?.jump === undefined) out.push(`trace 的 disk（algo: ${p.fields.algo}）要填移动距离：C-SCAN / C-LOOK 跳回去的距离算不算各书不一样，${JUMP_MSG}`);
  const tied = traceRows(T.table).filter((x) => T.ties.includes(x.r));
  if (tied.length) {
    const first = tied[0].r;
    // 写了 rows: 2-9 这种的，提示照样从原来那一行起
    const from = p.fill?.rows?.from || 1;
    const unit = T.table.dir === 'col' ? '列' : '行';
    const fix = first < from ? '' : from > 1 ? `，或者用 rows: ${from}-${first} 只填第 ${from}～${first} ${unit}` : `，或者用 rows: ${first} 只填前 ${first} ${unit}`;
    out.push(again(`${traceRowName(T.table, first)}起有并列（几种做法一样好，页面判不了）：换一组数${fix}`));
  }
  for (const a of p.against || []) {
    const v = T.variants.find((x) => x.key === a);
    if (!v) { out.push(again(`against 写了「${a}」：要么不是 ${p.use} 的错法，要么这组数上照它做和对的一样（分不开）；这组数列出来的错法有 ${T.variants.map((x) => x.key).join('、') || '（没有：这组数上每种错法都和对的一样）'}`)); continue; }
    if (checkFill(T.table, valuesOf(v.table)).ok) out.push(again(`against 的 ${a} 这组数分不开：照这种错法填出来，要填的格子都和对的一样（换一组数，或者多填几${T.table.dir === 'col' ? '列' : '行'}）`));
  }
  return out;
}

// 题里的文字换数：$…$ 里的 \calc 写成 TeX、外面加 {}（和 practice 一样）；公式外面的写成文字（1/2，不是 \tfrac）。
// expr：要当式子算的字段（expect 的值、wrong 的式子、result）——不是非负整数的单个数加括号（2^\calc{h}、h=1/3 → 2^(1/3)，
// 负数也加：x - \calc{h} 不写成 x - -1）；一串数（list(v)）、矩阵照原样
function fillMixed(text, vars, { expr = false } = {}) {
  const errors = [];
  const parts = String(text ?? '').split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/);
  const out = parts.map((part, i) => {
    if (!part.includes('\\calc')) return part;
    const inMath = i % 2 === 1;
    const r = expandCalc(part, (e) => {
      const c = calcValue(e, vars);
      if (inMath) return c.tex;
      return expr && !Array.isArray(c.value) && !/^\d+$/.test(c.text) ? `(${c.text})` : c.text;
    }, { wrap: inMath });
    errors.push(...r.errors);
    return r.tex;
  }).join('');
  return { text: out, errors };
}

/**
 * 模板取一组数（照 practice custom：pick → let → where，不满足就重取）：返回 { probe（取了数的这一道：文字里的 \calc 换成数、
 * example 算好、vals 是取到的数和算好的 let，lets 清空）, picked（「k=5」，记进证据）, raw（取到的原值，下一次 avoid 用）}。
 * base：整节课的量（精确值、浮点都行）。取不到（where 太严）抛出中文原因
 */
export function drawProbe(probe, { base: lesson = {}, rand = Math.random, avoid = null } = {}) {
  const base = { ...lesson, ...(probe.base || {}) };
  const { vars, picked } = instantiate({ picks: probe.tpl.picks, lets: probe.lets || [], wheres: probe.tpl.wheres }, { base, rand, avoid });
  const own = [...probe.tpl.picks.map((x) => x.name), ...(probe.lets || []).map((x) => x.name)];
  const vals = floatVars(Object.fromEntries(own.map((n) => [n, vars[n]])));
  const errors = [];
  const fillWith = (t, expr) => { if (t === undefined || t === null) return t; const r = fillMixed(t, vars, { expr }); errors.push(...r.errors); return r.text; };
  const fill = (t) => fillWith(t, false);
  const fillExpr = (t) => fillWith(t, true); // 式子：非整数的数加括号
  const inst = { ...probe, q: fill(probe.q), lets: [], vals, tpl: null, tplOf: probe.id, picked: pickedText(picked) };
  if (probe.claim !== undefined) inst.claim = fill(probe.claim);
  if (probe.answer !== undefined) inst.answer = fill(probe.answer);
  for (const k of ['must', 'may', 'wrong']) if (probe[k]) inst[k] = probe[k].map((x) => ({ ...x, text: fill(x.text) }));
  inst.teach = Object.fromEntries(Object.entries(probe.teach || {}).map(([k, v]) => [k, fill(v)]));
  if (probe.lines) inst.lines = probe.lines.map(fill);
  if (probe.steps) inst.steps = probe.steps.map((x) => ({ ...x, text: fill(x.text) }));
  if (probe.solveFields) inst.solveFields = { ...probe.solveFields, q: fill(probe.solveFields.q) };
  if (probe.ifs) inst.ifs = probe.ifs.map((c) => ({ ...c, msg: fill(c.msg) }));
  if (probe.exprs) inst.exprs = probe.exprs.map((e) => ({ ...e, label: fill(e.label) }));
  // 408 的新字段（计划 4 Task 7）：都在公式外面，\calc 写成纯文字（refs="\calc{list(v)}" → refs="3 1 4 …"）。
  // 每一道是新的对象、新的 fields：traceTable 按 probe 对象缓存，换了数不能读到模板那一份
  const fillAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? fill(v) : v]));
  if (probe.runs) inst.runs = probe.runs.map((r) => ({ ...r, fields: fillAll(r.fields) }));
  if (probe.fields) inst.fields = fillAll(probe.fields);
  if (probe.fill) inst.fill = fillAll(probe.fill);
  if (probe.expects) inst.expects = probe.expects.map((e) => ({ ...e, label: fill(e.label), value: fillExpr(e.value), wrongs: e.wrongs.map((w) => ({ ...w, expr: fillExpr(w.expr), msg: fill(w.msg) })) }));
  if (probe.result !== undefined) inst.result = fillExpr(probe.result);
  if (probe.text !== undefined) inst.text = fill(probe.text);
  if (probe.slots && probe.exampleSrc) {
    // seq / text / procs 的格子收原文：先把 \calc 换成数（S=\calc{list(v)} 5），矩阵、数的格子照旧用取到的量算
    inst.exampleSrc = fill(probe.exampleSrc);
    try { inst.example = parseNamed(inst.exampleSrc, withDefaults({ ...floatVars(base), ...vals }, probe.slots), probe.slots); } catch (e) { inst.example = null; errors.push({ expr: 'example', msg: e.message }); }
  }
  inst.calcErrors = errors.map((e) => (e.expr === 'example' ? `example 算不出来：${e.msg}` : `\\calc{${String(e.expr).trim().slice(0, 40)}} 算不出来：${e.msg}`));
  return { probe: inst, picked: inst.picked, raw: picked };
}
