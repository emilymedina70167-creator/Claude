// 把 JS 源码里原样的控制字符（换行、Tab、回车以外）换成 \xNN：只用于构建时处理 pdf.js 的 worker。
// 控制字符只可能出现在字符串、模板字符串、正则、注释里，在这些地方 \xNN 和原字符等价；
// 例外是前面紧挨奇数个反斜杠（那是转义它本身）和 String.raw，遇到就报错，不悄悄改坏
export function escapeControls(src) {
  if (/String\.raw/.test(src) && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(src)) throw new Error('源码里有 String.raw，控制字符不能直接换');
  return src.replace(/(\\*)([\x00-\x08\x0b\x0c\x0e-\x1f\x7f])/g, (m, bs, c) => {
    if (bs.length % 2) throw new Error(`控制字符 ${c.charCodeAt(0)} 前面是反斜杠，不能直接换`);
    return `${bs}\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`;
  });
}
