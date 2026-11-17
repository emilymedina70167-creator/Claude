// 验题的后一半（碰 DOM）：先过 problemcheck.js 的写法检查，再在页面上藏着画一遍。纯函数的部分在 problemcheck.js。
import { renderLesson } from '../render.js';
import { session as kitSession } from '../session.js';
import { parseProblems, problemLint, twinOf } from './problemcheck.js';

// 首页和收件箱共用同一把尺子，检查这一步不写库。
export async function checkProblems(text, ctx = {}) {
  const got = parseProblems(text, ctx);
  const bad = [...got.problems], ok = [];
  for (const it of got.items) {
    const errs = problemLint(it, ctx);
    const twin = twinOf(it, [...(ctx.existing || []), ...ok.map(k => ({ id: k.id, ...k.doc }))]);
    if (twin) errs.push(`和题库里的 ${twin.id} 几乎一样`);
    if (!errs.length) errs.push(...await renderCheck(it.doc.md));
    if (errs.length) bad.push(`题 ${it.n}：${errs.join('；')}`); else ok.push(it);
  }
  return { ok, bad };
}

// 两处后台工作都可能验题，不能同时改组件库的临时变量和写法错误列表。
let rendering = Promise.resolve();
export function renderCheck(md) {
  const result = rendering.then(() => renderOne(md));
  rendering = result.catch(() => {});
  return result;
}

// 在页面上画一遍（藏在屏幕外面）：组件写法错误、取数自检不过都会进 session.problems；画完马上拿掉
async function renderOne(md) {
  if (typeof document === 'undefined') return [];
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;visibility:hidden;pointer-events:none';
  document.body.appendChild(host);
  const before = kitSession.problems.length;
  // 一道题单独画（练一练里也是一道一道画）：前面几道题 let 定义的量、登记的图不能借给这一道
  const vars0 = kitSession.vars;
  const scenes0 = new Map(kitSession.scenes);
  kitSession.vars = {};
  // 写坏的组件 render.js 会往控制台报一次错：这里本来就是在找错（收在 session.problems 里），不让它算成页面出错
  const err0 = console.error;
  console.error = () => {};
  try {
    renderLesson(String(md), host);
    await new Promise((r) => setTimeout(r, 60));
    return kitSession.problems.slice(before).filter((p) => !p.soft).map((p) => `写法错误：${p.msg}`).slice(0, 3);
  } catch (err) {
    return [`画不出来：${err?.message || err}`];
  } finally {
    console.error = err0;
    host.remove();
    kitSession.vars = vars0;
    kitSession.scenes.clear();
    for (const [k, v] of scenes0) kitSession.scenes.set(k, v);
    kitSession.problems.splice(before);
  }
}
