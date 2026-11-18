// 每个组件在学生屏幕上的时间（dr-batch4 第 3、4 条）：一道题出现在屏幕上到第一次交用了多久（ms）、到这一次交（msTotal），
// 切走、锁屏、翻到别的板、滚出屏幕的时间都不算；外部预写的 stuck= 也按它算「那题在学生屏幕上多久没动静」，
// 学生不在那块板上不计时。纯的那一半（区间、累计）有测试 tests/timing.test.js；DOM 的那一半（IntersectionObserver）在 watchTiming。

/** 纯的计时器：每个 id 一串「在屏幕上」的区间 [开始, 结束]（结束 null 是现在还在） */
export function createTimer({ now = () => Date.now(), maxSpans = 400 } = {}) {
  const spans = new Map(); // id → [[from, to|null]]
  const firsts = new Map(); // id → 第一次交的时刻
  const on = (id) => { const l = spans.get(id); return !!l && l.length > 0 && l[l.length - 1][1] === null; };
  return {
    /** 这个组件现在在不在屏幕上 */
    set(id, visible, at = now()) {
      if (!id) return;
      const l = spans.get(id) || spans.set(id, []).get(id);
      if (visible && !on(id)) { l.push([at, null]); if (l.length > maxSpans) l.splice(0, l.length - maxSpans); }
      if (!visible && on(id)) l[l.length - 1][1] = at;
    },
    /** 全部收起（页面切到后台、锁屏） */
    hideAll(at = now()) { for (const id of spans.keys()) this.set(id, false, at); },
    isOn: on,
    firstSeen(id) { return spans.get(id)?.[0]?.[0] ?? null; },
    /** 在 [from, to] 里，这个组件在屏幕上一共多久 */
    visibleMs(id, from = 0, to = now()) {
      let ms = 0;
      for (const [a, b] of spans.get(id) || []) {
        const x = Math.max(a, from), y = Math.min(b ?? to, to);
        if (y > x) ms += y - x;
      }
      return ms;
    },
    /** 学生交了一次：{ ms（到第一次交）, msTotal（到这一次） }；这个组件从没在屏幕上过返回 null */
    submit(id, at = now()) {
      if (!spans.get(id)?.length) return null;
      if (!firsts.has(id)) firsts.set(id, at);
      return { ms: this.visibleMs(id, 0, firsts.get(id)), msTotal: this.visibleMs(id, 0, at) };
    },
    /** 刷新以后：以前交过（证据里有）的第一次交的时刻放回去，ms 不会被当成又一次第一次 */
    seedFirst(id, at) { if (id && at && !firsts.has(id)) firsts.set(id, at); },
  };
}

/**
 * 照屏幕看：root 里每个带 data-bid 的组件进出屏幕（露出来三成以上算在）就记一笔；页面切到后台全部收起，回来再按现在看得见的记。
 * 返回 { timer, stop }
 */
export function watchTiming(root, timer = createTimer()) {
  if (typeof IntersectionObserver === 'undefined' || !root) return { timer, stop() {} };
  const seen = new Map(); // id → 现在交叉着没有（页面在前台时）
  const shown = () => document.visibilityState !== 'hidden';
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const id = e.target.dataset.bid;
      if (!id) continue;
      // 组件里套着组件（舞台里的图、演示组件）：只按最外层的那个记
      // 露出三成以上，或者比屏幕还高的组件占了屏幕三成以上，算在屏幕上
      const vis = e.isIntersecting && (e.intersectionRatio >= 0.3 || e.intersectionRect.height >= 0.3 * (window.innerHeight || 800)) && !e.target.closest('[hidden]');
      seen.set(id, vis);
      timer.set(id, vis && shown());
    }
  }, { threshold: [0, 0.1, 0.2, 0.3, 0.6, 1] });
  const watched = new WeakSet();
  const scan = () => root.querySelectorAll('.block[data-bid]').forEach((n) => { if (!watched.has(n)) { watched.add(n); io.observe(n); } });
  scan();
  const mo = new MutationObserver(() => scan());
  mo.observe(root, { childList: true, subtree: true });
  const vis = () => {
    if (!shown()) { timer.hideAll(); return; }
    for (const [id, v] of seen) timer.set(id, v);
  };
  document.addEventListener('visibilitychange', vis);
  window.addEventListener('pagehide', () => timer.hideAll());
  return { timer, stop() { io.disconnect(); mo.disconnect(); document.removeEventListener('visibilitychange', vis); } };
}
