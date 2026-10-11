// 把截图、手写图转成发给 Claude 的白底 PNG。
// Notability 圈选「拷贝」出来的是透明底的笔迹图，笔迹颜色就是学生用的笔（常是深色纸上的浅色笔，比如青色、白色）：
// 直接铺到白底上几乎看不见。所以透明底的图先把浅色笔迹压暗（保留色相），再铺到白底上。
// 本来就有底色的图（系统截图、照片）一个像素都不改，只是去掉透明。

// sRGB 0-255 → 相对亮度（WCAG）
function luminance(r, g, b) {
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// 笔迹在白底上至少要有这么暗（亮度 0.12 对白底约 6:1，和深灰差不多）
export const INK_MAX_LUMINANCE = 0.12;
// 透明像素占到这么多才算「透明底的笔迹图」
export const CUTOUT_MIN_TRANSPARENT = 0.2;

/**
 * 原地把 RGBA 像素铺到白底上（结果全不透明）。透明底的图先把比 INK_MAX_LUMINANCE 亮的笔迹压暗。
 * data：Uint8ClampedArray（canvas 的 ImageData.data）或普通数组，长度是 4 的倍数。
 * 返回 { cutout, darkened }：是不是透明底的图、压暗了多少个像素。
 */
export function flattenOnWhite(data) {
  const n = Math.floor(data.length / 4);
  let transparent = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 16) transparent++;
  const cutout = n > 0 && transparent / n >= CUTOUT_MIN_TRANSPARENT;
  let darkened = 0;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    let r = data[p], g = data[p + 1], b = data[p + 2];
    const a = data[p + 3] / 255;
    if (cutout && a > 0) {
      const L = luminance(r, g, b);
      if (L > INK_MAX_LUMINANCE) {
        // 亮度大致随 sRGB 值的 2.2 次方变：三个通道同乘一个系数，色相不变、亮度降到上限
        const k = (INK_MAX_LUMINANCE / L) ** (1 / 2.2);
        r *= k; g *= k; b *= k;
        darkened++;
      }
    }
    data[p] = Math.round(r * a + 255 * (1 - a));
    data[p + 1] = Math.round(g * a + 255 * (1 - a));
    data[p + 2] = Math.round(b * a + 255 * (1 - a));
    data[p + 3] = 255;
  }
  return { cutout, darkened };
}

// 解码好的图片 → 白底 PNG（太大的按比例缩到最长边 maxSide）。读不了像素（跨域图）时退回简单的白底铺图
export function imageToPng(im, maxSide = 2400) {
  return new Promise((resolve, reject) => {
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    if (!w || !h) { reject(new Error('empty image')); return; }
    const k = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0, c.width, c.height);
    try {
      const img = g.getImageData(0, 0, c.width, c.height);
      flattenOnWhite(img.data);
      g.putImageData(img, 0, 0);
    } catch {
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
    }
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
