// 测量：如果某一天考，大约几分、80% 范围、过目标的概率、几成是测出来的（spec 第六节）。
// 一张卷 = 一串题；一题落在哪一块 × 我在那一块做对的概率 × 分值；整张卷抽很多遍得到分布。
// 一题做对的概率 P = g + (1 − g)·K·R·τ：K 是记得的前提下会的程度（knowledge.js），R 是到那天还记得几成（fsrs.js），
// g 是蒙对的底，τ 是考场折扣。全是页面算的，不调用 Claude，不进课堂的说明。固定种子：同样的数据一模一样的数。
import { SUBJECTS } from '../memory/score.js';
import { addDays, toDate } from '../memory/schema.js';
import { targetOf, goalOf, examDateOf } from '../exam/target.js';
import { structureOf } from '../exam/structure.js';
import { PART_PRIORS, TAUGHT_MIN, GUESS, PARTIAL, TAU, DRAWS, MEASURED_N, PART_SPREAD, PERSON_SHARE } from './priors.js';
import { rng, seedOf } from './rng.js';
import { memoryOf, rOn, step } from './fsrs.js';
import { priorGrid, posterior, meanOf, GRID } from './knowledge.js';
import { blockEvidence, upTo } from './evidence.js';
import { SUBJECT_CODE, units as unitsOf, synthPaper, realPapers, pickPaper } from './paper.js';

const list = (v) => (Array.isArray(v) ? v : []);
const quant = (xs, q) => xs[Math.min(xs.length - 1, Math.max(0, Math.floor(q * xs.length)))];

/** 一个单位的 K 后验、R、给面板的几个数 */
function unitState(u, ev, day, tau) {
  const pr = PART_PRIORS[u.part] || { mean: 0.05, n: 2 };
  const slot = ev.get(u.id);
  const mean = slot?.taught ? Math.max(pr.mean, TAUGHT_MIN.mean) : pr.mean;
  const reviews = [...(slot?.reviews || [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  // 每一次作答的 R 按作答那天以前的复习算（遗忘只扣一次：spec 6.2）；作答按天排好，复习一路往下走
  const raw = [...(slot?.obs || [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const obs = [];
  let mem = null, j = 0;
  for (const o of raw) {
    while (j < reviews.length && reviews[j].day < o.day) mem = step(mem, reviews[j++]);
    obs.push({ ...o, r: rOn(mem, o.day) });
  }
  const post = posterior(priorGrid(mean, pr.n), obs);
  const cdf = new Float64Array(post.length);
  let c = 0;
  for (let i = 0; i < post.length; i++) { c += post[i]; cdf[i] = c; }
  const r = rOn(memoryOf(reviews), day);
  const k = meanOf(post);
  // w：这一块还有几成靠先验（部分的共同因子按它推这一块）
  return { cdf, r, k, n: obs.length, w: pr.n / (pr.n + obs.length), measured: obs.length >= MEASURED_N, p: GUESS.single + (1 - GUESS.single) * k * r * tau };
}

// 按步给分：m 个半分里拿到几个（二项分布）。m 大时用正态近似（一题 20 个半分逐个抽太慢），夹在 0..m
const gauss = (rand) => Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand());
function steps(m, p, rand) {
  if (m < 8) { let got = 0; for (let j = 0; j < m; j++) if (rand() < p) got++; return got; }
  const z = gauss(rand);
  return Math.min(m, Math.max(0, Math.round(m * p + z * Math.sqrt(m * p * (1 - p)))));
}

const drawK = (cdf, u) => { for (let i = 0; i < cdf.length; i++) if (u < cdf[i]) return GRID[i]; return GRID[GRID.length - 1]; };

/** 一个 pool（单位的数组）按分值比例抽一个：先算好累计 */
const poolCache = new WeakMap();
function pickUnit(pool, u) {
  let acc = poolCache.get(pool);
  if (!acc) {
    let s = 0;
    acc = pool.map((x) => (s += x.points));
    poolCache.set(pool, acc);
  }
  // 二分：一科几百个单位，合成卷的每一题都要抽一次
  const t = u * acc[acc.length - 1];
  let lo = 0, hi = acc.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t < acc[mid]) hi = mid; else lo = mid + 1; }
  return pool[lo].id;
}

/**
 * 某一天考的分布。day：R 按这一天算；asOf：证据截到哪一刻（毫秒）；exam：首页的考情缓存 meta/exam（有 papers 就用真卷）。
 * 返回 { subjects: [{ key, label, full, target, median, lo, hi, mean }], total, pGoal, pLines, measured, units }
 */
export function forecast(mem = {}, { day = toDate(Date.now()), exam = null, asOf = null, draws = DRAWS, seed = 1, ev: given = null } = {}) {
  const target = targetOf(mem);
  const { goal, split } = goalOf(target);
  // ev：同一份证据算两个日子时（今天、考试那天）只整理一次
  const ev = given || blockEvidence(mem, { asOf });
  const rand = rng(seed);
  const year = Number(String(day).slice(0, 4)) + 1;
  const unitsOut = {};
  const perSubject = [];
  let measuredPts = 0, allPts = 0;
  // 整个人的那一份共同因子：每一遍抽卷一个，四科共用（各科一起高一起低）
  const person = Float64Array.from({ length: draws }, () => gauss(rand));
  for (const s of SUBJECTS) {
    const tau = TAU[s.key] ?? 0.9;
    const us = unitsOf(mem.curriculum, s.key);
    const st = new Map(us.map((u) => [u.id, unitState(u, ev, day, tau)]));
    for (const u of us) {
      const x = st.get(u.id);
      unitsOut[u.id] = { subject: s.key, part: u.part, title: u.title, points: u.points, p: x.p, k: x.k, n: x.n, r: x.r, measured: x.measured };
      allPts += u.points;
      if (x.measured) measuredPts += u.points;
    }
    const real = realPapers(exam?.papers?.[SUBJECT_CODE[s.key]] || {}, us, s.key);
    const synth = synthPaper(s.key, us, structureOf(SUBJECT_CODE[s.key], year));
    // 单位按下标排好：抽卷的内层循环里不查 Map（一次首页要抽几千遍卷）
    const index = new Map(us.map((u, i) => [u.id, i]));
    const states = us.map((u) => st.get(u.id));
    const ks = new Float64Array(us.length);
    const unitSum = new Float64Array(us.length); // 每一块抽卷时拿到的分，平均下来是这一块的期望分（面板上各块加起来就是这一科的平均分）
    const parts = [...new Set(us.map((u) => u.part))];
    const partOf = us.map((u) => parts.indexOf(u.part));
    const shift = new Float64Array(parts.length);
    const scores = new Float64Array(draws);
    for (let d = 0; d < draws; d++) {
      const items = pickPaper(rand, real) || synth;
      ks.fill(-1); // 同一次抽里同一单位共用一个 K（会就一起会）
      for (let j = 0; j < parts.length; j++) shift[j] = PART_SPREAD * (Math.sqrt(PERSON_SHARE) * person[d] + Math.sqrt(1 - PERSON_SHARE) * gauss(rand)); // 同一部分一起高一起低
      let sum = 0;
      for (const it of items) {
        const i = index.get(it.unit ?? pickUnit(it.pool, rand()));
        if (i === undefined) continue;
        const x = states[i];
        if (ks[i] < 0) {
          const k0 = drawK(x.cdf, rand());
          ks[i] = x.w > 0 ? 1 / (1 + Math.exp(-(Math.log(k0 / (1 - k0)) + x.w * shift[partOf[i]]))) : k0;
        }
        const know = ks[i] * x.r * tau;
        let got = 0;
        if (PARTIAL.has(it.type)) { const m = Math.max(1, Math.round(2 * it.points)); got = (it.points * steps(m, know, rand)) / m; }
        else {
          const g = GUESS[it.type] ?? 0;
          if (rand() < g + (1 - g) * know) got = it.points;
        }
        sum += got;
        unitSum[i] += got;
      }
      scores[d] = sum;
    }
    us.forEach((u, i) => { unitsOut[u.id].exp = unitSum[i] / draws; });
    perSubject.push({ s, scores });
  }
  const total = new Float64Array(draws);
  for (const { scores } of perSubject) for (let d = 0; d < draws; d++) total[d] += scores[d];
  // 单科线：档案里最近一年的（两处来源核过才写进去）；没有就不算这一项
  const lines = list(target.lines);
  const ly = Math.max(0, ...lines.map((l) => Number(l.year) || 0));
  const singles = lines.filter((l) => Number(l.year) === ly && l.kind === 'single' && l.subject);
  let pass = 0, passLines = 0;
  for (let d = 0; d < draws; d++) {
    if (total[d] >= goal) {
      pass++;
      if (singles.every((l) => { const i = SUBJECTS.findIndex((x) => SUBJECT_CODE[x.key] === String(l.subject)); return i < 0 || perSubject[i].scores[d] >= Number(l.value); })) passLines++;
    }
  }
  const summary = (xs) => {
    const a = Float64Array.from(xs).sort();
    return { median: quant(a, 0.5), lo: quant(a, 0.1), hi: quant(a, 0.9), mean: a.reduce((n, x) => n + x, 0) / a.length };
  };
  return {
    goal,
    subjects: perSubject.map(({ s, scores }) => ({ key: s.key, label: s.label, full: s.full, target: split[s.key], rgb: s.rgb, ...summary(scores) })),
    total: summary(total),
    pGoal: pass / draws,
    pLines: singles.length ? passLines / draws : null,
    measured: allPts ? measuredPts / allPts : 0,
    units: unitsOut,
  };
}

/**
 * 首页那张卡和面板要的：今天考、不再学到考试那天（只有遗忘，是下限）、7 天前那样算的差、还能多拿几分的块。
 * 三次用同一个种子，差只来自数据，不来自随机数。
 */
export function forecastBoard(mem = {}, { today = toDate(Date.now()), exam = null, draws = DRAWS } = {}) {
  const ev = list(mem.evidence);
  const lastAt = ev.reduce((m, e) => Math.max(m, Number(e?.at) || 0), 0);
  const seed = seedOf(today, ev.length, lastAt, list(mem.curriculum).length, exam?.statsAt || 0);
  const examDay = examDateOf(targetOf(mem));
  const ev0 = blockEvidence(mem);
  const now = forecast(mem, { day: today, exam, seed, draws, ev: ev0 });
  const atExam = forecast(mem, { day: examDay > today ? examDay : today, exam, seed, draws, ev: ev0 });
  const day7 = addDays(today, -7);
  const then = forecast(mem, { day: day7, exam, seed, draws, ev: upTo(ev0, day7) });
  const gain = Object.entries(now.units).map(([id, u]) => ({ id, title: u.title, subject: u.subject, part: u.part, points: u.points, gain: Math.max(0, u.points - u.exp) })).sort((a, b) => b.gain - a.gain);
  return { goal: now.goal, now, exam: atExam, examDay, week: { delta: now.total.median - then.total.median, then: then.total }, measured: now.measured, gain };
}
