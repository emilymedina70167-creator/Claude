// 舞台上自己练（黑板组件 stage，blocks/stagedrill.js）不碰 DOM 的那一半（主线第四轮，设计第 3 节）。有测试（tests/stagedrillspec.test.js）。
//
//   id: d-stage-DS-L8.2.3-sort-shell
//   pick a = seq(8, 1, 99) distinct        ← 随机取数（practicespec.js 现成的 pick / let / where）；不取数的题不写
//   ---
//   array a = {a}                           ← 下面是镜头指令，{取数的名字} 换成取到的数
//   follow a sort shell gaps="5 3 1"
//   open a move
//
// 每次打开重新取。取出来的数先在一个不画的场景里演一遍：引擎不收、或者一上来就已经是做完的样子，换一组。
import { commandLine, instantiate } from './practicespec.js';
import { Scene } from './stage/scene.js';
import { parseScript } from './stage/script.js';
import './stage/types/index.js';
import { whereOf } from './stage/follow.js';

/** 读围栏里的字 → { id, tpl: { picks, lets, wheres }, lines }；写错了抛出中文原因 */
export function parseStageDrill(src) {
  const text = String(src ?? '').replace(/\r/g, '');
  const cut = text.split('\n').findIndex((l) => /^-{3,}\s*$/.test(l));
  if (cut < 0) throw new Error('stage 组件要有一行「---」：上面写 id: 和 pick，下面写镜头指令');
  const head = text.split('\n').slice(0, cut), lines = text.split('\n').slice(cut + 1).join('\n').trim();
  const tpl = { picks: [], lets: [], wheres: [] };
  let id = '';
  for (const raw of head) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^id\s*[:：]\s*(\S+)$/);
    if (m) { id = m[1]; continue; }
    if (!commandLine(t, tpl)) throw new Error(`「---」上面只写 id: 和 pick / let / where：看不懂「${t.slice(0, 60)}」`);
  }
  if (!lines) throw new Error('「---」下面要写镜头指令（造东西、follow、open）');
  return { id, tpl, lines };
}

// 取到的数写进镜头指令：一个数照写，一串数拿空格隔开
const textOf = (v) => (Array.isArray(v) ? v.map(textOf).join(' ') : v != null && typeof v === 'object' && typeof v.toString === 'function' ? v.toString() : String(v));

/** 把一组数换进指令，在不画的场景里先演一遍：{ scene } 或者 { error, retry（换一组数可能就好了） } */
function tryOnce(script) {
  const s = new Scene();
  for (const c of parseScript(script)) {
    try { s.apply(c); } catch (err) { return { error: `第 ${c.line} 行「${String(c.src || '').trim()}」：${err.message}`, retry: c.cmd === 'follow' }; }
  }
  const followed = [...s.objects.values()].filter((o) => o.follow);
  if (!followed.length) return { error: '这道题里没有照引擎走的东西：要有一行 follow（页面靠它判）', retry: false };
  const ws = followed.map((o) => whereOf(o, s));
  const bad = ws.find((w) => w.error);
  if (bad) return { error: bad.error, retry: true };
  if (ws.every((w) => w.done)) return { error: '一上来就已经是做完的样子', retry: true };
  return { scene: s };
}

/**
 * 取一组数、拼成镜头指令：{ script, vars } 或者 { error }。
 * 引擎不收、一上来就做完的换一组，tries 组都不成交 error（页面上报出来，「练一练」把这道题标成坏的）
 */
export function drawStageDrill(spec, { rand = Math.random, tries = 12 } = {}) {
  const names = new Set(spec.tpl.picks.map((p) => p.name).concat(spec.tpl.lets.map((l) => l.name)));
  let last = '';
  for (let t = 0; t < (names.size ? tries : 1); t++) {
    let vars = {};
    if (spec.tpl.picks.length) { try { vars = instantiate(spec.tpl, { rand }).vars; } catch (err) { return { error: err.message }; } }
    // 只换取数的名字：指令里别的 {式子}（{a.1}、{d}）是舞台自己的，不动
    const script = spec.lines.replace(/\{([A-Za-z_]\w*)\}/g, (m, k) => (names.has(k) ? textOf(vars[k]) : m));
    const r = tryOnce(script);
    if (r.scene) return { script, vars };
    if (!r.retry || !names.size) return { error: r.error };
    last = r.error;
  }
  return { error: `取了 ${tries} 组数都不成（${last}）` };
}

/**
 * 一道舞台题做的过程 → 要记的作答（组件照它 session.record）。w 是 follow.js 的 whereOf。
 * 一道题 = 从头走完一遍（不是一趟一道：一遍希尔三趟都对，算做对一道题，不算三道）。
 * 走完记一次对；中间到过错法的样子、看过「这一趟该是什么样」，当时记一次错（一趟只记一次）——报告里这道题就是「改对了」，不算一次做对。
 * 没做完就走：记一次放弃。返回的每条 { ok, k（第几趟的事）, wrong?, final?, giveup? }；step（到了新的一趟）只给画面说一声，不记
 */
export function trackDrill(w0) {
  let passed = w0?.passed || 0;
  let over = !!w0?.done;
  let total = w0?.total || 0;
  const slipped = new Set(); // 哪几趟已经记过一次错
  const slip = (k, wrong) => { if (slipped.has(k)) return []; slipped.add(k); return [{ k, ok: false, wrong }]; };
  return {
    peek() { return over ? [] : slip(passed + 1, '看了这一趟该是什么样'); },
    after(w) {
      const records = [];
      let step = 0;
      if (!w || w.error || over) return { records, done: over, step };
      total = w.total || total;
      if (w.like) records.push(...slip(passed + 1, w.like));
      if (w.at != null && w.passed > passed) { passed = w.passed; step = passed; }
      if (w.done) { over = true; records.push({ k: passed, ok: true, final: true }); }
      return { records, done: over, step };
    },
    giveup() {
      if (over) return [];
      over = true;
      return [{ k: passed + 1, ok: false, giveup: true }];
    },
    get slips() { return slipped.size; },
  };
}
