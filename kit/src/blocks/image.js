// image：讲义原图（课前存进这个 artifact 的幻灯片、教材页）贴上黑板，点一下放大看。
//   name: 定义2.1        资料包（pack/main 的 images）里登记的图
//   src: /_blob/…        或者直接写图的地址（上传到这个 artifact 以后给的地址；guided 课件也可以写一起发布的文件名）
//   caption: 教材里的定义 2.1
// 只认这个 artifact 自己的文件：外面网站的图在 artifact 里本来也打不开
import { parseFields } from '../parse.js';
import { session } from '../session.js';
import { assetUrl } from '../live/store.js';
import { widget, mdToHtml, escapeHtml } from './common.js';

/** 图的地址合不合规矩：本 artifact 的文件、assets（/_blob/…）、本地调试的 dev- 图。返回出错原因或 '' */
export function imageSrcProblem(src) {
  const s = String(src ?? '').trim();
  if (!s) return '没写图的地址';
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(s)) return ''; // 本地调试的图（dev- 存的就是这种）
  if (/^(https?:)?\/\//i.test(s) || /^[a-z][\w+.-]*:/i.test(s)) return `图只能用这个 artifact 自己的文件（上传到 assets 以后给的地址，或者一起发布的文件名），「${s.slice(0, 40)}」打不开`;
  if (/[<>"'\s]/.test(s)) return `图的地址「${s.slice(0, 40)}」里有不该有的字符`;
  return '';
}

export function image(el, src) {
  const { fields } = parseFields(src);
  let url = '';
  let caption = fields.caption || fields.title || '';
  if (fields.name) {
    const list = Array.isArray(session.packImages) ? session.packImages : [];
    const img = list.find((x) => x && String(x.name) === fields.name);
    if (!img) throw new Error(`资料包里没有叫「${fields.name}」的图${list.length ? `（有的是：${list.map((x) => x.name).filter(Boolean).slice(0, 8).join('、')}）` : '（资料包的 images 是空的）'}`);
    url = img.src || img.url || (img.id ? assetUrl(String(img.id)) : '');
    caption ||= img.title || '';
  } else if (fields.src) url = fields.src;
  else throw new Error('image 要写 name:（资料包里登记的图）或 src:（图的地址）');
  // 只写了 asset id（或者本地调试的 dev- 图）：换成能打开的地址
  if (/^dev-[\w-]+$/.test(url) || /^[0-9a-f]{16,64}$/i.test(url)) url = assetUrl(url);
  const bad = imageSrcProblem(url);
  if (bad) throw new Error(bad);
  const body = widget(el, { title: null, cls: 'image' });
  body.innerHTML = `<figure class="im-fig"><button type="button" class="im-open" aria-label="放大看"><img class="im-img" src="${escapeHtml(url)}" alt="${escapeHtml(caption || fields.name || '讲义原图')}" loading="lazy" decoding="async"></button>${caption ? `<figcaption class="im-cap">${mdToHtml(caption, { inline: true })}</figcaption>` : ''}</figure>`;
  const img = body.querySelector('img');
  // 图打不开：显示一句说明（不能静默空着）
  img.addEventListener('error', () => {
    body.querySelector('.im-open').replaceWith(Object.assign(document.createElement('div'), { className: 'block-error', textContent: `这张图没打开（${fields.name ? `资料包里的「${fields.name}」` : url}）` }));
    session.problem(el, 'image', `图没打开：${fields.name ? `资料包里的「${fields.name}」` : url}`, { soft: true });
  });
  body.querySelector('.im-open').addEventListener('click', () => openLightbox(url, caption));
}

// 放大看：盖满一屏，点哪里都关
function openLightbox(url, caption) {
  const box = document.createElement('div');
  box.className = 'im-light';
  box.setAttribute('role', 'dialog');
  box.innerHTML = `<img src="${escapeHtml(url)}" alt="">${caption ? `<div class="im-light-cap">${mdToHtml(caption, { inline: true })}</div>` : ''}<button type="button" class="im-close" aria-label="关闭">×</button>`;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(box);
}
