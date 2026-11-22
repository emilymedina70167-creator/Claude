// 板的截图里的自由段（blocks/html.js 的隔离框）：html2canvas 看不进隔离框，框里各自拍好（frame._shot，框里的底座套 SVG 拍），
// 复制出来的页面里换成图。单独一个文件、不 import 别的：class/boardeye.js 用它，不把整个组件库拖进来
/**
 * 板的截图用（class/boardeye.js）：el 里的自由段先各自拍一张，回一个给 html2canvas 的 onclone——
 * 复制出来的页面里把这些框换成它们自己拍的图（框外面看不进隔离框）。没有自由段回 undefined
 */
export async function framesForSnap(el) {
  const list = [...(el?.querySelectorAll?.('iframe.hs-frame') || [])];
  if (!list.length) return undefined;
  const urls = await Promise.all(list.map((f) => (typeof f._shot === 'function' ? f._shot() : Promise.resolve(null))));
  const all = [...document.querySelectorAll('iframe.hs-frame')];
  return (doc) => {
    const copies = [...doc.querySelectorAll('iframe.hs-frame')];
    list.forEach((f, i) => {
      const c = copies[all.indexOf(f)];
      if (!c) return;
      const img = doc.createElement('img');
      img.style.cssText = `display:block;width:${f.offsetWidth}px;height:${f.offsetHeight}px`;
      if (urls[i]) img.src = urls[i]; else img.alt = '（这一段没拍出来）';
      c.replaceWith(img);
    });
  };
}
