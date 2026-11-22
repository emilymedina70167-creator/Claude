// 老师的眼睛（黑板课，第十三轮，docs/superpowers/specs/2026-11-16-mirror-design.md 6.2）：页面把当前这块板拍成图，
// 跟着每一轮发给老师。以前老师是闭着眼写的：写一段标记文字，页面排出来什么样它从没见过——例句和译文被并成一行、
// 一行蓝字被框切掉，它都不知道；看不见画面的人不会去设计，只会写字。舞台课给老师看截图以后画面好了一大截（stage/snap.js）。
import { framesForSnap } from '../htmlsnap.js';
// 拍法照舞台：html2canvas-pro 照计算后的样式画，不压在回话的路上——板静下来就在后台先拍好，要发的时候没再变就直接用。
// 板比一屏长：照学生一屏一屏看到的切，最多 maxTiles 张（再长的写明后面没拍）。平台一次最多 4 张图，学生附的图优先。

/**
 * 一块板切成几张：{ w, h } 是板的宽和总高（CSS 像素），viewH 是学生一屏看得到多高。
 * 返回 { scale（每张长边不超过 maxEdge）, tiles: [{ y, h }], more（板比拍到的还长）}
 */
export function tilesOf({ w, h }, { viewH = 0, maxTiles = 3, maxEdge = 1280 } = {}) {
  const W = Math.max(1, Math.round(w) || 1);
  const H = Math.max(1, Math.round(h) || 1);
  const vh = Math.max(240, Math.round(viewH) || H);
  // 只多出一点点（十几像素的留白）不另起一张
  const n = Math.min(maxTiles, Math.max(1, Math.ceil((H - 16) / vh)));
  const tiles = [];
  for (let i = 0; i < n; i++) tiles.push({ y: i * vh, h: Math.min(vh, H - i * vh) });
  return { scale: Math.min(1, maxEdge / Math.max(W, vh)), tiles, more: H > n * vh + 16 };
}

/** 跟着图写给老师的一句（接在发出去的最后一条消息后面） */
export function eyeNote({ n, more = false } = {}) {
  if (!n) return '';
  return `[画面] ${n > 1 ? `前 ${n} 张图是` : '第 1 张图是'}页面拍的学生现在看到的这块板${n > 1 ? '（从上往下一屏一张）' : ''}${more ? '；板更长，后面的没拍' : ''}。`;
}

function background() {
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    return bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff';
  } catch { return '#ffffff'; }
}
const toBlob = (canvas) => new Promise((resolve, reject) => {
  try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布取不出图'))), 'image/png'); } catch (e) { reject(e); }
});

/** 默认的拍法：把整块板画到一张画布上，再照 tilesOf 切。返回 { blobs, more } */
async function defaultRender(el, { viewH, maxTiles, maxEdge }) {
  const { default: html2canvas } = await import('html2canvas-pro');
  const w = el.offsetWidth;
  const plan = tilesOf({ w, h: el.scrollHeight }, { viewH, maxTiles, maxEdge });
  const total = plan.tiles.reduce((s, t) => s + t.h, 0);
  const onclone = await framesForSnap(el);
  const canvas = await html2canvas(el, { scale: plan.scale, backgroundColor: background(), logging: false, useCORS: true, width: w, height: total, windowWidth: document.documentElement.clientWidth, ...(onclone ? { onclone } : {}) });
  const blobs = [];
  for (const t of plan.tiles) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * plan.scale));
    c.height = Math.max(1, Math.round(t.h * plan.scale));
    c.getContext('2d').drawImage(canvas, 0, Math.round(t.y * plan.scale), c.width, c.height, 0, 0, c.width, c.height);
    blobs.push(await toBlob(c));
  }
  return { blobs, more: plan.more };
}

/**
 * target()：要拍的那块板的元素（没有板返回 null）；viewH()：学生一屏看得到多高；
 * render(el, { viewH, maxTiles, maxEdge }) → { blobs, more }（测试里换假的）；timer：{ setTimeout, clearTimeout, now }。
 * 返回 { dirty(), latest(), fresh(maxWait), lastError(), stop() }
 */
export function createBoardEye({ target, viewH = () => 0, render = defaultRender, timer = null, quietMs = 600, timeoutMs = 2500, maxTiles = 3, maxEdge = 1280 } = {}) {
  const T = timer || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t), now: () => Date.now() };
  let version = 0;
  let latest = null; // { blobs, more, v, at, ms（拍这一次花了多久）}
  let inflight = null;
  let quiet = null;
  let err = '';
  let stopped = false;

  function shoot() {
    if (inflight) return inflight;
    const v = version;
    const el = target();
    if (!el) { latest = null; return Promise.resolve(); }
    let timedOut = null;
    const t0 = T.now();
    const limit = new Promise((_, reject) => { timedOut = T.setTimeout(() => reject(new Error('超时')), timeoutMs); });
    inflight = Promise.race([Promise.resolve().then(() => render(el, { viewH: viewH(), maxTiles, maxEdge })), limit])
      .then((r) => { latest = r?.blobs?.length ? { blobs: r.blobs, more: !!r.more, v, at: T.now(), ms: T.now() - t0 } : null; err = ''; })
      .catch((e) => { err = e?.message || String(e); })
      .finally(() => { T.clearTimeout(timedOut); inflight = null; if (version !== v && !stopped) schedule(); });
    return inflight;
  }
  function schedule() {
    if (quiet) T.clearTimeout(quiet);
    quiet = T.setTimeout(() => { quiet = null; if (!stopped) shoot(); }, quietMs);
  }

  return {
    /** 板变了：静下来以后再拍 */
    dirty() { version++; if (!stopped) schedule(); },
    latest() { return latest; },
    lastError() { return err; },
    /**
     * 要发了：板没再变就给最新那一份；变了当场拍，最多等 maxWait。等不到给上一份（学生刚答了一道题，板的样子差不了多少）；
     * 一份都没有就是 null（照常调用老师，不附图）
     */
    async fresh(maxWait = 400) {
      if (stopped) return null;
      if (latest && latest.v === version) return latest;
      if (quiet) { T.clearTimeout(quiet); quiet = null; }
      const p = shoot();
      await Promise.race([p, new Promise((r) => T.setTimeout(r, maxWait))]);
      return latest;
    },
    stop() { stopped = true; if (quiet) T.clearTimeout(quiet); quiet = null; },
  };
}

// —— board snap（外部的课，dr-ext-live-fixes 1）：外部要的是「这一轮画完以后学生看到的整块板」——
// 以前跟老师的眼睛一样板静 0.4 秒就拍：舞台还在出场、段还在淡入（半透明），切成一屏一张。现在先等画好，再拍一张长图。

/** 长图怎么切：整块板一张；比 maxH 还高才切成几张（照实写各是哪一段）。返回 { scale, parts: [{ y, h }], note } */
export function longTiles({ w, h }, { maxH = 4800, maxEdge = 1280 } = {}) {
  const W = Math.max(1, Math.round(w) || 1), H = Math.max(1, Math.round(h) || 1);
  const n = Math.max(1, Math.ceil(H / maxH));
  const parts = [];
  for (let i = 0; i < n; i++) parts.push({ y: i * maxH, h: Math.min(maxH, H - i * maxH) });
  const note = n === 1 ? `整块板一张（${W}×${H}）` : `整块板 ${W}×${H}，太长切成 ${n} 张：${parts.map((p, i) => `第 ${i + 1} 张是 ${p.y}–${p.y + p.h}`).join('，')}`;
  return { scale: Math.min(1, maxEdge / W), parts, note };
}

/**
 * 等这块板画好：字体载完、这块板里的动画（段的淡入、舞台出场、拍子）走完、舞台演完（stage 组件的 __ready）、
 * KaTeX 画好、板上一会儿不再变。最多等 max 毫秒（等不完照拍，在说明里写一句）。返回 { waited, settled }
 */
export async function settleBoard(el, { max = 6000, quiet = 350 } = {}) {
  const t0 = Date.now();
  const left = () => Math.max(0, max - (Date.now() - t0));
  const within = (p) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, left()))]);
  try { if (document.fonts?.ready) await within(document.fonts.ready); } catch { /* */ }
  // 舞台演完、widget 第一次跑完（组件挂 __ready）
  await within(Promise.all([...el.querySelectorAll('.block')].map((b) => b.__ready).filter(Boolean)));
  // 动画走完（只等有限的；无限循环的跳过）
  const anims = () => (el.getAnimations ? el.getAnimations({ subtree: true }) : []).filter((a) => { const t = a.effect?.getTiming?.(); return t && t.iterations !== Infinity; });
  for (let k = 0; k < 4 && anims().length && left() > 0; k++) await within(Promise.all(anims().map((a) => a.finished)));
  // 板上一会儿不再变（MutationObserver 安静 quiet 毫秒）
  await within(new Promise((resolve) => {
    let timer = setTimeout(done, quiet);
    const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
    function done() { mo.disconnect(); resolve(); }
    mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
  }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { waited: Date.now() - t0, settled: left() > 0 };
}

/** 拍一张长图（照 longTiles 切）：{ blobs, note } */
export async function snapLong(el, { maxH = 4800, maxEdge = 1280 } = {}) {
  const { default: html2canvas } = await import('html2canvas-pro');
  const w = el.offsetWidth, h = el.scrollHeight;
  const plan = longTiles({ w, h }, { maxH, maxEdge });
  const blobs = [];
  // 自由段（隔离框）html2canvas 看不进去：框里各自拍好，复制出来的页面里换成图
  const onclone = await framesForSnap(el);
  for (const p of plan.parts) {
    const canvas = await html2canvas(el, { scale: plan.scale, backgroundColor: background(), logging: false, useCORS: true, width: w, height: p.h, y: el.getBoundingClientRect().top + window.scrollY + p.y, windowWidth: document.documentElement.clientWidth, ...(onclone ? { onclone } : {}) });
    blobs.push(await toBlob(canvas));
  }
  return { blobs, note: plan.note };
}
