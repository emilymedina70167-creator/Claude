// 老师的眼睛（第九轮）：页面把舞台画面重画成一张图，跟着下一条消息发给老师，它先看图再写。
// 用 html2canvas-pro：它自己照计算后的样式把节点画到画布上，不走 SVG foreignObject，在 iPad 的 Safari 上取得出像素
// （2026-11-13 在 iPad 上试过：93 毫秒，深色样子也一样）；原版 html2canvas 读不懂 color-mix() 算出来的 color(srgb …)。
// 不压在回话的路上：画面静下来（最后一次变化之后 quietMs 没再变）就在后台先拍好；要发的时候画面没再变就直接用，
// 变了当场再拍、最多等 maxWait，等不到给上一张（注明是几秒前的）。拍不出来（抛错、超时）照常叫老师，那一条写没截到。

/** 长边缩到 max（不放大） */
export function fitEdge({ w, h }, max = 1024) {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.round(w * k), h: Math.round(h * k), k };
}

/** 跟着图写给老师的一句 */
export function snapNote({ ok, ageMs = 0, reason = '' }) {
  if (!ok) return `[画面] 这一轮没截到图（${reason || '没拍成'}）：下面是字画的版面`;
  const s = Math.round(ageMs / 1000);
  return s >= 2 ? `[画面] 附了一张 ${s} 秒前的画面图（先看图再写）` : '[画面] 附了一张这一刻的画面图（先看图再写）';
}

/** 默认的拍法：html2canvas-pro 把舞台那一块画到画布上（按 fitEdge 缩好） */
async function defaultRender(el, { scale, background }) {
  const { default: html2canvas } = await import('html2canvas-pro');
  // 盖着的「老师在调画面」不拍（第十轮）：交给老师看的是它摆出来的样子
  return html2canvas(el, { scale, backgroundColor: background, logging: false, useCORS: true, ignoreElements: (n) => !!n.classList?.contains('st-veil') });
}

/**
 * stage：{ root }（拍它）。render(el, { scale, background }) → 画布（测试里换假的）；timer：{ setTimeout, clearTimeout, now }（测试里换假时钟）
 * 返回 { dirty(), latest(), fresh(maxWait), lastError(), stop() }
 */
export function createSnapper(stage, { quietMs = 600, maxEdge = 1024, timeoutMs = 800, render = defaultRender, timer = null } = {}) {
  const T = timer || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t), now: () => Date.now() };
  let version = 0;
  let latest = null; // { blob, at, v, w, h }
  let inflight = null;
  let quiet = null;
  let err = '';
  let stopped = false;
  const sleep = (ms) => new Promise((r) => T.setTimeout(r, ms));

  function size() {
    const el = stage.root;
    return { w: el?.clientWidth || 1180, h: el?.clientHeight || 820 };
  }
  function background() {
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      return bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : null;
    } catch { return null; }
  }
  function shoot() {
    if (inflight) return inflight;
    const v = version;
    const fit = fitEdge(size(), maxEdge);
    let timedOut = null;
    const work = (async () => {
      const canvas = await render(stage.root, { scale: fit.k, background: background() });
      const blob = await new Promise((resolve, reject) => {
        try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布取不出图'))), 'image/png'); } catch (e) { reject(e); }
      });
      return { blob, w: canvas.width, h: canvas.height };
    })();
    const limit = new Promise((_, reject) => { timedOut = T.setTimeout(() => reject(new Error('超时')), timeoutMs); });
    inflight = Promise.race([work, limit])
      .then((r) => { latest = { ...r, at: T.now(), v }; err = ''; })
      .catch((e) => { err = e?.message || String(e); })
      .finally(() => { T.clearTimeout(timedOut); inflight = null; if (version !== v && !stopped) schedule(); });
    return inflight;
  }
  function schedule() {
    if (quiet) T.clearTimeout(quiet);
    quiet = T.setTimeout(() => { quiet = null; if (!stopped) shoot(); }, quietMs);
  }
  return {
    /** 画面变了：静下来以后再拍 */
    dirty() { version++; if (!stopped) schedule(); },
    latest() { return latest; },
    lastError() { return err; },
    /** 要发了：画面没再变就给最新那张；变了当场拍，最多等 maxWait，等不到给上一张（可能是 null） */
    async fresh(maxWait = 500) {
      if (latest && latest.v === version) return latest;
      if (quiet) { T.clearTimeout(quiet); quiet = null; }
      await Promise.race([shoot(), sleep(maxWait)]);
      return latest;
    },
    stop() { stopped = true; if (quiet) T.clearTimeout(quiet); },
  };
}
