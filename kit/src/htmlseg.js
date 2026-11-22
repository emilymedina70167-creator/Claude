// 自由段 html（去限制设计，2026-11-22）：主讲自己写的一页小网页，放在板上一个隔离框里跑。
// 页面不查它的写法、不规定它画什么；只给一座桥 lab：记作答（record）、没交的草稿（draft）、借精确计算和判等（calc / same）、
// 页面替它判（check）、这一段自己的状态（state，刷新不丢）、给 board mark 留位置（anchor）。
// 隔离框是 sandbox="allow-scripts" 的 srcdoc iframe：框里的代码碰不到学习台的页面和数据库，只能经桥新加作答；
// 2026-11-22 在 iPad 上实测过：脚本、cdnjs 上的库、Pencil、postMessage、高度、卡住不拖累外面都行。
// 这个文件是纯函数（拼框里的页面、读桥上来的消息、判 check），画面在 blocks/html.js。
import { calcValue, exactText } from './exact.js';
import { equivalent } from './ncalg.js';
import { normalizeFormula } from './formula.js';
import { compareFx, parseDomain } from './fx/sample.js';

// 段的开头可以写几行字段（id: / exam: / like:），之后是 HTML。只认开头：HTML、CSS、JS 里同样的字不当字段
export const HTML_HEAD_FIELDS = ['id', 'exam', 'like'];
const HEAD = new RegExp(`^\\s*(${HTML_HEAD_FIELDS.join('|')})\\s*[:：]\\s*(\\S.*?)\\s*$`);

// 框里的 lab 桥有哪些函数（接口卡 meta/interface 照它写；tests/project-iface.test.js 核对和 frameBoot 里的 window.lab 一致）
export const LAB_API = [
  { name: 'record', call: 'record({ q, value, text, ok })', does: '记一条作答进证据、进下一份 ext_out；ok 是你的代码判的（true / false，不写就是没判），记成 judgedBy: author' },
  { name: 'draft', call: 'draft({ q, value })', does: '没交的草稿，跟着下一份 ext_out；value 空了就是交了或删了' },
  { name: 'calc', call: 'calc(式子)', does: 'Promise，精确计算（分数、矩阵、根号）的结果文字，比如 calc("1/3+1/6") 得 "1/2"' },
  { name: 'same', call: 'same(a, b[, { loose }])', does: 'Promise，两个式子相等吗（矩阵不交换）：true / false / "unknown"' },
  { name: 'check', call: 'check(value, 答案, how[, { q, domain }])', does: 'Promise，页面判对错并记一条作答（judgedBy: page）；how：value 精确值 / expr 矩阵式子 / fx 实数函数式 / text 文字' },
  { name: 'state', call: 'state.get(键) / state.set(键, 值)', does: '这一段自己的状态，存在 html_state，刷新、翻旧课都放回' },
  { name: 'anchor', call: 'anchor(名字, 元素)', does: '之后 board mark target=<段的 id>-<名字> 指得到这个元素' },
];

/** 一段 html 的原文 → { fields: { id?, exam?, like? }, html } */
export function parseHtmlSeg(src) {
  const lines = String(src ?? '').split('\n');
  const fields = {};
  let i = 0;
  for (; i < lines.length; i++) {
    if (!lines[i].trim() && !Object.keys(fields).length) continue;
    const m = lines[i].match(HEAD);
    if (!m) break;
    fields[m[1]] = m[2];
  }
  return { fields, html: lines.slice(i).join('\n') };
}

// 放进 <script> 里的 JSON：</script> 和 <!-- 不能出现
const scriptJson = (v) => JSON.stringify(v ?? null).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// 框里的底座：lab 桥、报错、量高度、锚点。写成普通函数再取源码，免得一大段字符串里的引号出错；
// 取源码时 N（这一框的暗号）和 S（刷新前的状态）由 frameDoc 换成真的值
/* eslint-disable no-undef */
function frameBoot() {
  const N = __N__;
  let state = __S__ || {};
  let seq = 0;
  const wait = {};
  const send = (type, data) => { try { parent.postMessage({ lab: N, type, data }, '*'); } catch (e) { /* 数据带了传不过去的东西 */ } };
  // 交出去的数据只留能复制的（DOM 元素、函数去掉）
  const plain = (v) => { try { return JSON.parse(JSON.stringify(v ?? null)); } catch (e) { return String(v); } };
  const ask = (type, data) => new Promise((ok, no) => { const id = ++seq; wait[id] = { ok, no }; send(type, Object.assign({}, data, { id })); });
  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data || {};
    if (m.lab !== N) return;
    if (m.type === 'shot') { shoot().then((url) => send('shot', { id: m.data && m.data.id, url }), (err) => send('shot', { id: m.data && m.data.id, err: String((err && err.message) || err) })); return; }
    if (m.type === 'reply') {
      const w = wait[m.data && m.data.id];
      if (!w) return;
      delete wait[m.data.id];
      if (m.data.error) w.no(new Error(m.data.error)); else w.ok(m.data.value);
    }
  });
  const anchors = new Map();
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const tellAnchors = () => { const list = []; anchors.forEach((el, name) => { if (el.isConnected) list.push({ name, rect: rectOf(el) }); }); if (list.length) send('anchors', { list }); };
  window.lab = {
    /** 记一条作答：{ q, value, text, ok }。ok 是你的代码判的（不写就是没判） */
    record: (r) => send('record', plain(r || {})),
    /** 没交的草稿：{ q, value }；value 空了就是交了或删了 */
    draft: (d) => send('draft', plain(d || {})),
    /** 精确计算（分数、矩阵、根号）：回结果的文字，比如 '1/2' */
    calc: (src) => ask('calc', { src: String(src) }),
    /** 两个式子相等吗（矩阵不交换）：true / false / 'unknown' */
    same: (a, b, opts) => ask('same', { a: String(a), b: String(b), loose: !!(opts && opts.loose) }),
    /** 页面替你判并记下来：how 是 value（精确值）/ expr（矩阵式子）/ fx（实数函数式，opts.domain）/ text（文字） */
    check: (value, answer, how, opts) => ask('check', { value: plain(value), answer: plain(answer), how: how || 'value', opts: plain(opts || {}) }),
    state: {
      get: (k) => (k === undefined ? plain(state) : plain(state[k])),
      set: (k, v) => { if (k && typeof k === 'object' && v === undefined) state = plain(k) || {}; else state[k] = plain(v); send('state', { state }); },
    },
    /** 给 board mark 留位置：之后 mark target=<这一段的 id>-<名字> 指得到这个元素 */
    anchor: (name, el) => { if (el && el.getBoundingClientRect) { anchors.set(String(name), el); tellAnchors(); } return el; },
  };
  addEventListener('error', (e) => send('error', { text: `${e.message || '出错了'}${e.lineno ? `（第 ${e.lineno} 行）` : ''}` }));
  addEventListener('unhandledrejection', (e) => send('error', { text: `没接住的 Promise：${(e.reason && e.reason.message) || e.reason}` }));
  // 自己拍成图（板的截图要用）：框外面的 html2canvas 看不进隔离框，框里把自己连同现在的样子（输入框里写的、画布上画的）
  // 套进 SVG 的 foreignObject 画到画布上。2026-11-22 iPad 实测这样拍得出来（html2canvas 在隔离框里拍不了）
  const shoot = () => new Promise((ok, no) => {
    const live = document.documentElement;
    const doc = live.cloneNode(true);
    const a = live.querySelectorAll('canvas, input, textarea, select'), b = doc.querySelectorAll('canvas, input, textarea, select');
    a.forEach((x, i) => {
      const y = b[i];
      if (!y) return;
      if (x.tagName === 'CANVAS') { try { const im = document.createElement('img'); im.src = x.toDataURL(); im.setAttribute('style', x.getAttribute('style') || ''); im.width = x.clientWidth; im.height = x.clientHeight; y.replaceWith(im); } catch (e) { /* 画布读不出来就留空 */ } }
      else if (x.type === 'checkbox' || x.type === 'radio') { if (x.checked) y.setAttribute('checked', ''); else y.removeAttribute('checked'); }
      else if (x.tagName === 'TEXTAREA') y.textContent = x.value;
      else if (x.tagName === 'SELECT') { [...y.options].forEach((o, j) => { if (j === x.selectedIndex) o.setAttribute('selected', ''); else o.removeAttribute('selected'); }); }
      else y.setAttribute('value', x.value);
    });
    doc.querySelectorAll('script').forEach((x) => x.remove());
    const w = Math.max(1, live.clientWidth), h = Math.max(1, Math.ceil(document.body.getBoundingClientRect().height));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(doc)}</foreignObject></svg>`;
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(2, 4000 / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        const x = c.getContext('2d');
        x.scale(k, k);
        x.drawImage(img, 0, 0);
        ok(c.toDataURL('image/png'));
      } catch (e) { no(e); }
    };
    img.onerror = () => no(new Error('拍不出来'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  let lastH = -1, wide = 0;
  const measure = () => {
    const b = document.body;
    if (!b) return;
    const h = Math.ceil(Math.max(b.scrollHeight, b.getBoundingClientRect().height));
    if (h !== lastH) { lastH = h; send('height', { h }); }
    // 内容比框宽（右边被裁掉）：报给主讲，同一个宽度只报一次
    const sw = document.documentElement.scrollWidth, vw = innerWidth;
    if (vw > 0 && sw > vw + 1 && sw !== wide) { wide = sw; send('wide', { content: sw, frame: vw }); }
    tellAnchors();
  };
  addEventListener('DOMContentLoaded', () => { new ResizeObserver(measure).observe(document.body); measure(); });
  addEventListener('load', measure);
  addEventListener('scroll', tellAnchors, { passive: true });
}
/* eslint-enable no-undef */

/**
 * 框里的整页（srcdoc）。nonce：这一框的暗号（桥上的消息要带着）；state：刷新前存的状态；
 * look：页面现在的字色、字体，框里默认跟着（主讲写的 CSS 盖得住）。
 * 不写 color-scheme：框里和外面的 color-scheme 不一样时浏览器给框铺一层不透明的底色（深色风格里是一块黑）
 */
export function frameDoc({ html = '', nonce = '', state = null, look = {} } = {}) {
  const boot = `(${frameBoot.toString()})();`.replace('__N__', scriptJson(String(nonce))).replace('__S__', scriptJson(state && typeof state === 'object' ? state : {}));
  const css = [
    `html,body{margin:0;background:transparent}`,
    `body{color:${cssSafe(look.color) || 'inherit'};font:16px/1.6 ${cssSafe(look.font) || 'system-ui,sans-serif'};overflow-wrap:anywhere}`,
    'img,svg,canvas,video{max-width:100%}',
  ].join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><script>${boot}</scr${''}ipt></head><body>${html}</body></html>`;
}

// 放进 <style> 的字色、字体：只留不会断开规则的字
const cssSafe = (s) => String(s ?? '').replace(/[;{}<>\\]/g, '').slice(0, 300);

/** 桥上来的作答 → session.record 的一条（不带 el）。ok 是主讲代码写的，标 judgedBy: author */
export function recordOf(d = {}) {
  const ok = typeof d.ok === 'boolean' ? d.ok : null;
  const out = { type: 'html', q: textOf(d.q), ok };
  if (d.value !== undefined && d.value !== null && d.value !== '') out.value = textOf(d.value);
  if (d.text !== undefined && d.text !== null && d.text !== '') out.text = textOf(d.text);
  if (ok !== null) out.judgedBy = 'author';
  return out;
}

const textOf = (v) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));

/** lab.calc：精确地算，回 { value: 文字 } 或 { error } */
export function bridgeCalc(src, scope = {}) {
  try {
    const r = calcValue(String(src), scope);
    return { value: r.text ?? exactText(r.value) };
  } catch (e) { return { error: e?.message || String(e) }; }
}

/** lab.same：回 { value: true | false | 'unknown' } */
export function bridgeSame(a, b, { loose = false } = {}) {
  try { return { value: equivalent(String(a), String(b), { loose }) }; } catch (e) { return { error: e?.message || String(e) }; }
}

const CHECK_HOWS = ['value', 'expr', 'fx', 'text'];
const norm = (s) => String(s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * lab.check：页面判。回 { ok: true | false | null, why? }（null 是判不了，照实说为什么）。
 * value：学生给的；answer：主讲写的答案；how：value | expr | fx | text；opts.domain（fx 的取值范围，默认 x in (-3, 3)）
 */
export function judgeCheck(value, answer, how = 'value', opts = {}, scope = {}) {
  if (!CHECK_HOWS.includes(how)) return { ok: null, why: `lab.check 的判法「${how}」不认识：写 ${CHECK_HOWS.join(' / ')}` };
  const v = textOf(value), a = textOf(answer);
  if (!v.trim()) return { ok: false, why: '没写' };
  if (how === 'text') return { ok: norm(v) === norm(a) };
  if (how === 'expr') {
    const r = equivalent(v, a, { loose: !!opts.loose });
    return r === 'unknown' ? { ok: null, why: '这两个式子页面判不了（含逆、转置、函数或读不懂）' } : { ok: r };
  }
  if (how === 'fx') {
    let domain;
    try { domain = parseDomain(opts.domain || 'x in (-3, 3)'); } catch (e) { return { ok: null, why: e.message }; }
    let given;
    try { given = normalizeFormula(v, { names: [...domain.map((d) => d.name), ...Object.keys(scope)], real: true, fx: true }); } catch (e) { return { ok: false, why: `读不懂：${e.message}` }; }
    try {
      const r = compareFx(a, given, { domain, scope, seed: `html|${a}` });
      return { ok: r.ok, ...(r.ok === true ? {} : { why: r.note || r.msg }) };
    } catch (e) { return { ok: null, why: e?.message || String(e) }; }
  }
  // value：两边各算出精确值再比
  let want, got;
  try { want = calcValue(a, scope); } catch (e) { return { ok: null, why: `答案算不出来：${e.message}` }; }
  try { got = calcValue(v.normalize('NFKC'), scope); } catch (e) { return { ok: false, why: `读不懂：${e.message}` }; }
  if (want.exact && got.exact) return { ok: (want.text ?? exactText(want.value)) === (got.text ?? exactText(got.value)) };
  const x = Number(got.float), y = Number(want.float);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: null, why: '有一边不是有限的数，页面判不了' };
  return { ok: Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y)) };
}
