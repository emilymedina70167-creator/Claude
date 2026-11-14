#!/usr/bin/env node
// 模拟学生的尺子（docs/superpowers/specs/2026-11-14-round10-measure-design.md 6.7）：测量对不对，先拿模拟学生量。
// 生成的那一边故意不用测量自己的模型（不然是自己验自己）：遗忘是指数衰减（三种快慢）、课堂题和真题的难度差取先验以外的值、
// 底子有好有零、每题 5% 粗心。每个学生按学习台的规则学 13 个月（讲 → 当堂几道 → 1/3/7/14/30 天复现，后几个月夹真题级的题），
// 在第 0、3、8、13 个月各「当天真考一次」，和测量那天的「如果今天考」比：80% 范围罩没罩住、中位数偏多少、范围多宽。
//   node tools/forecast-sim.mjs [--students 240] [--draws 400] [--json]
import { forecast } from '../kit/src/forecast/forecast.js';
import { units, synthPaper, SUBJECT_CODE } from '../kit/src/forecast/paper.js';
import { structureOf } from '../kit/src/exam/structure.js';
import { GUESS, PARTIAL, PART_PRIORS } from '../kit/src/forecast/priors.js';
import { rng, seedOf } from '../kit/src/forecast/rng.js';
import { toEvidence } from '../kit/src/memory/session.js';
import { toAnswer } from '../kit/src/live/sync.js';
import { addDays, daysBetween } from '../kit/src/memory/schema.js';
import { SUBJECTS } from '../kit/src/memory/score.js';
import { spaceOfId } from '../kit/src/memory/space.js';

const START = '2026-11-14';
const CHECKS = [0, 3, 8, 13].map((m) => [m, addDays(START, Math.round(m * 30.4))]);
const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// 一份课程地图：每门课几章、每章几块（够让卷面落到块上，又跑得动）
const COURSES = [['LA', '', 6], ['HM', 'HM-', 10], ['PS', 'PS-', 6], ['DS', 'DS-', 8], ['CO', 'CO-', 7], ['OS', 'OS-', 6], ['CN', 'CN-', 5], ['EN', 'EN-', 5]];
const BLOCKS_PER_CH = 4;
export function simCurriculum() {
  const out = [];
  for (const [, pre, chs] of COURSES) for (let c = 1; c <= chs; c++) {
    out.push({ id: `${pre}L${c}`, level: 'lecture', title: `第${c}章` });
    for (let b = 1; b <= BLOCKS_PER_CH; b++) out.push({ id: `${pre}L${c}.1.${b}`, level: 'block', title: `块${b}` });
  }
  return out;
}
const partOfBlock = (id) => { const m = /^([A-Z]{2})-/.exec(id); return m ? m[1] : 'LA'; };

// 设定：遗忘（指数衰减的时间常数，天）× 难度差 × 底子
const FORGET = { fsrs: 90, slow: 180, fast: 45 };
const DELTAS = { half: 0.6, double: 2.4 };
const BASES = { good: 1.8, zero: 0.4 }; // 底子：先验均值乘这个倍数当真实的起点
export const SETTINGS = Object.keys(FORGET).flatMap((f) => Object.keys(DELTAS).flatMap((d) => Object.keys(BASES).map((b) => ({ f, d, b, name: `${f}/${d}/${b}` }))));

/** 一个学生：真实的参数和一年的证据 */
export function simStudent(setting, seed) {
  const R = rng(seed);
  const cur = simCurriculum();
  const blocks = cur.filter((x) => x.level === 'block').map((x) => x.id);
  const delta = DELTAS[setting.d];
  const tau0 = FORGET[setting.f];
  const truth = new Map();
  // 没讲之前的会：先验均值 × 底子倍数 × 随机；讲过以后的会：好学生高一些，都有个体差异
  for (const b of blocks) {
    const pm = PART_PRIORS[partOfBlock(b)]?.mean ?? 0.05;
    truth.set(b, { k0: clamp(pm * BASES[setting.b] * (0.5 + R()), 0.01, 0.9), k: null, tau: tau0, last: null, taughtOn: null, hist: [] });
  }
  // 学习台里没有课的部分（阅读、写作、政治）：真实水平在先验附近乱一点
  const star = {};
  for (const s of SUBJECTS) for (const p of s.parts) if (!p.course) star[p.key] = clamp((PART_PRIORS[p.key]?.mean ?? 0.1) * (0.4 + 1.4 * R()), 0.01, 0.9);
  const care = 0.95;
  const evidence = [];
  let qn = 0;
  const ans = (b, day, level) => {
    const t = truth.get(b);
    const k = t.k ?? t.k0;
    const r = t.last ? Math.exp(-daysBetween(t.last, day) / t.tau) : 1;
    const p = care * r * (level === 'exam' ? k : sig(logit(clamp(k, 0.01, 0.99)) + delta));
    const ok = R() < p;
    const at = Date.parse(`${day}T10:00:00`) + (qn % 600) * 1000;
    const ev = toEvidence('record', toAnswer({ type: 'answer', block: `q${++qn}`, q: '题', ok, attempts: 1, final: true, at }), { session: `c-${day}`, block: b });
    evidence.push({ ...ev, id: `ev-${qn}`, ...(level === 'exam' ? { exam: `Q-sim-${qn}` } : {}) });
    return ok;
  };
  // 课表：按门课交错，一周讲 4 块；每块讲完当堂 3 道，之后 1/3/7/14/30 天各复现一道（第 3 个月起一半是真题级）
  const order = [];
  const byCourse = COURSES.map(([c]) => blocks.filter((b) => partOfBlock(b) === c));
  for (let i = 0; order.length < blocks.length; i++) for (const list of byCourse) if (list[i]) order.push(list[i]);
  const plan = new Map(); // 日子 → [[块, 种类]]
  const add = (day, x) => (plan.get(day) || plan.set(day, []).get(day)).push(x);
  order.forEach((b, i) => {
    const day = addDays(START, Math.floor(i / 4) * 7 + (i % 4));
    add(day, [b, 'teach']);
    let d = day;
    for (const gap of [1, 3, 7, 14, 30]) { d = addDays(d, gap); add(d, [b, 'review']); }
  });
  const end = addDays(START, 400);
  for (let day = START; day <= end; day = addDays(day, 1)) {
    for (const [b, kind] of plan.get(day) || []) {
      const t = truth.get(b);
      if (kind === 'teach') {
        t.k = clamp(Math.max(t.k0, (setting.b === 'good' ? 0.55 : 0.4) + 0.4 * R()), 0.05, 0.95);
        t.taughtOn = day;
        for (let j = 0; j < 3; j++) ans(b, day, 'class');
        t.last = day;
        t.hist.push({ day, tau: t.tau, last: day });
      } else {
        const level = daysBetween(START, day) > 90 && R() < 0.5 ? 'exam' : 'class';
        const ok = ans(b, day, level);
        t.tau = ok ? t.tau * 2.5 : t.tau * 0.6;
        t.last = day;
        t.hist.push({ day, tau: t.tau, last: day });
      }
    }
  }
  return { cur, evidence, truth, star, R };
}

/** 那一天真考一次：同一张卷面、真实的 K 和指数遗忘、真实的考场折扣 */
function trueExam(st, day) {
  const { cur, truth, star, R } = st;
  const out = {};
  for (const s of SUBJECTS) {
    const us = units(cur, s.key);
    const paper = synthPaper(s.key, us, structureOf(SUBJECT_CODE[s.key], Number(day.slice(0, 4)) + 1));
    const tau = 0.85 + 0.1 * R();
    let sum = 0;
    const ks = new Map();
    for (const it of paper) {
      const acc = []; let tot = 0;
      for (const u of it.pool) acc.push(tot += u.points);
      const x = R() * tot; const u = it.pool[acc.findIndex((a) => x < a)] || it.pool.at(-1);
      let know = ks.get(u.id);
      if (know === undefined) {
        const t = truth.get(u.id);
        if (t) {
          const learned = t.taughtOn && t.taughtOn <= day;
          const k = learned ? t.k : t.k0;
          // 截到那一天的记忆：那天以前最后一次学 / 复习之后的时间常数
          const h = learned ? t.hist.filter((x) => x.day <= day).at(-1) : null;
          const r = h ? Math.exp(-daysBetween(h.last, day) / h.tau) : 1;
          know = k * r;
        } else know = star[u.part] ?? star[u.id.split(':')[0]] ?? 0.05;
        ks.set(u.id, know);
      }
      const p = know * tau * 0.95;
      if (PARTIAL.has(it.type)) { const m = Math.max(1, Math.round(2 * it.points)); let g = 0; for (let j = 0; j < m; j++) if (R() < p) g++; sum += (it.points * g) / m; }
      else { const g = GUESS[it.type] ?? 0; if (R() < g + (1 - g) * p) sum += it.points; }
    }
    out[s.key] = sum;
  }
  return out;
}

export function run({ students = 240, draws = 400 } = {}) {
  const rows = [];
  const per = Math.max(1, Math.round(students / SETTINGS.length));
  for (const setting of SETTINGS) for (let i = 0; i < per; i++) {
    const st = simStudent(setting, seedOf(setting.name, i));
    for (const [month, day] of CHECKS) {
      const asOf = Date.parse(`${day}T23:59:59`);
      const f = forecast({ curriculum: st.cur, evidence: st.evidence }, { day, asOf, seed: seedOf(setting.name, i, day), draws });
      const truthScore = trueExam(st, day);
      const examN = {};
      for (const e of st.evidence) if (e.exam && e.at <= asOf) { const sp = spaceOfId(e.tags?.[0] || ''); examN[sp] = (examN[sp] || 0) + 1; }
      for (const s of f.subjects) rows.push({ setting: setting.name, month, subject: s.key, lo: s.lo, hi: s.hi, median: s.median, truth: truthScore[s.key], examN: examN[s.key] || 0 });
      // 同一时点、少给七成证据：数据越多范围应该越窄（不和第 0 个月比——那时大家都接近零，本来就窄）
      if (month === 13) {
        const keep = st.evidence.filter((e, k) => (k * 2654435761 >>> 0) % 10 < 3);
        const thin = forecast({ curriculum: st.cur, evidence: keep }, { day, asOf, seed: seedOf(setting.name, i, day), draws });
        // 「数据越多越确定」直接量会的程度 K 的后验有多宽（讲过的 408 块平均）：按分数的范围比不出来——证据少时 K 停在
        // 低的先验附近，接近零的地方分数本来就不怎么动；证据多了 K 到中间，同样的不确定摆出来的分更多
        const sd = (ff) => { const us = Object.entries(ff.units).filter(([id, u]) => u.subject === 'cs' && st.truth.get(id)?.taughtOn && st.truth.get(id).taughtOn <= day); return us.reduce((n, [, u]) => n + u.ksd, 0) / Math.max(1, us.length); };
        const full = forecast({ curriculum: st.cur, evidence: st.evidence }, { day, asOf, seed: seedOf(setting.name, i, day), draws: 1 });
        rows.push({ setting: setting.name, month, subject: 'cs-ksd', thin: sd(thin), full: sd(full) });
      }
      const tt = Object.values(truthScore).reduce((a, b) => a + b, 0);
      rows.push({ setting: setting.name, month, subject: 'total', lo: f.total.lo, hi: f.total.hi, median: f.total.median, truth: tt, examN: 0 });
    }
  }
  return rows;
}

const stat = (rs) => ({ n: rs.length, cover: rs.filter((r) => r.truth >= r.lo && r.truth <= r.hi).length / Math.max(1, rs.length), bias: rs.reduce((n, r) => n + (r.median - r.truth), 0) / Math.max(1, rs.length), width: rs.reduce((n, r) => n + (r.hi - r.lo), 0) / Math.max(1, rs.length) });

/** 合格线：数据够了的 75%～85%（数学、408 各自判）；第 0 个月覆盖 ≥ 80% 且不算高；同一时点证据多的，会的程度更确定 */
export function judge(rows) {
  const enough = stat(rows.filter((r) => !['total', 'cs-ksd'].includes(r.subject) && r.examN >= 20));
  // 按科判（几科混在一起会让先验占大头的英语把数据驱动的科目盖住：审查拆开量过 math 71%、cs 66%）
  const bySubject = Object.fromEntries(['math', 'cs'].map((k) => [k, stat(rows.filter((r) => r.subject === k && r.examN >= 20))]));
  const m0 = stat(rows.filter((r) => r.month === 0 && r.subject === 'total'));
  const kr = rows.filter((r) => r.subject === 'cs-ksd');
  const w0 = kr.reduce((n, r) => n + r.thin, 0) / Math.max(1, kr.length);
  const w13 = kr.reduce((n, r) => n + r.full, 0) / Math.max(1, kr.length);
  return {
    enough, bySubject, m0, w0, w13,
    pass: {
      enough: Object.values(bySubject).every((x) => x.n === 0 || (x.cover >= 0.75 && x.cover <= 0.85)),
      m0: m0.cover >= 0.8 && m0.bias <= 0, narrower: w13 < w0,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
  const rows = run({ students: arg('--students', 240), draws: arg('--draws', 400) });
  const j = judge(rows);
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ judge: j, rows }, null, 1)); process.exit(0); }
  const f = (x) => (x * 100).toFixed(0) + '%';
  console.log('| 设定 | 月 | 科 | 几个 | 覆盖 | 中位数偏（正 = 算高） | 范围宽 |\n|---|---|---|---|---|---|---|');
  for (const s of SETTINGS) for (const [m] of CHECKS) for (const sub of ['math', 'cs', 'en', 'pol', 'total']) {
    const x = stat(rows.filter((r) => r.setting === s.name && r.month === m && r.subject === sub));
    console.log(`| ${s.name} | ${m} | ${sub} | ${x.n} | ${f(x.cover)} | ${x.bias.toFixed(1)} | ${x.width.toFixed(1)} |`);
  }
  console.log(`\n数据够了（这一科 ≥ 20 道真题级），按科：${Object.entries(j.bySubject).map(([k, x]) => `${k} ${x.n} 个、覆盖 ${f(x.cover)}、偏 ${x.bias.toFixed(1)}`).join('；')} → ${j.pass.enough ? '合格' : '不合格'}（几科合起来 ${f(j.enough.cover)}）`);
  console.log(`第 0 个月总分：覆盖 ${f(j.m0.cover)}，偏 ${j.m0.bias.toFixed(1)} → ${j.pass.m0 ? '合格' : '不合格'}`);
  console.log(`408 讲过的块会的程度有多不确定（后验标准差，第 13 个月）：只给三成证据 ${j.w0.toFixed(3)}，全部证据 ${j.w13.toFixed(3)} → ${j.pass.narrower ? '合格' : '不合格'}`);
}
