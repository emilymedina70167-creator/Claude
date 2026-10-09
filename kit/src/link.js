// steps 和 scene 的联动：steps 揭开一步，绑定它的图跟着变。
// 两边谁先渲染都可以：按 id 取同一个联动对象。
const links = new Map();

export function link(id) {
  if (!links.has(id)) {
    const listeners = new Set();
    links.set(id, {
      step: 0, // 已经揭开的步数
      on(f) { listeners.add(f); return () => listeners.delete(f); },
      set(n) { this.step = n; listeners.forEach((f) => f(n)); },
    });
  }
  return links.get(id);
}
