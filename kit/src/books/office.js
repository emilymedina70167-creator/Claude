// 从 Word（.docx，视频课文稿）、PowerPoint（.pptx，讲义 / 板书）里取文字和图。纯函数（输入是 unzip 出来的文件表），有测试。
// 不用 DOMParser：node 测试里没有，Office 的 XML 也规整，用正则取 <w:t> / <a:t> 就够。

const decode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');
const text = (files, name) => (files.get(name) ? new TextDecoder('utf-8').decode(files.get(name)) : '');

/** .docx 的正文：一段一行（空段去掉）。表格的格子也是段落，照顺序出来 */
export function docxParagraphs(files) {
  const xml = text(files, 'word/document.xml');
  if (!xml) throw new Error('这个 .docx 里没有正文（word/document.xml）');
  const paras = [];
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    // 按出现顺序取 <w:t> 的字，<w:tab/> 换成空格、<w:br/> 换成换行
    const parts = [...m[0].matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((x) => (x[1] !== undefined ? x[1] : x[0].startsWith('<w:tab') ? ' ' : '\n'));
    const t = decode(parts.join('')).trim();
    if (t) paras.push(t);
  }
  return paras;
}

const num = (name) => Number(name.match(/(\d+)\.xml$/)?.[1] || 0);

/**
 * .pptx 的每一页：[{ n, title, text, media: ['ppt/media/image3.png', …] }]。
 * title 是第一个标题占位符里的字（没有就是第一段），text 是整页的字（一段一行）
 */
export function pptxSlides(files) {
  const slides = [...files.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  if (!slides.length) throw new Error('这个 .pptx 里没有幻灯片');
  return slides.map((name) => {
    const xml = text(files, name);
    const paras = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((m) => decode([...m[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => x[1]).join('')).trim()).filter(Boolean);
    // 标题占位符：<p:ph type="title"/> 或 ctrTitle 所在的那个形状
    const titleShape = xml.match(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:ph type="(?:title|ctrTitle)"[\s\S]*?<\/p:sp>/)?.[0] || '';
    const title = decode([...titleShape.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => x[1]).join('')).trim() || paras[0] || '';
    const rels = text(files, name.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'));
    const media = [...rels.matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((x) => `ppt/media/${x[1]}`).filter((m) => /\.(png|jpe?g|gif|bmp|webp)$/i.test(m));
    return { n: num(name), title, text: paras.join('\n'), media: [...new Set(media)] };
  });
}
