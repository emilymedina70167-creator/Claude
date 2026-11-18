// board widget（需求 R5 的设计层）：外部写一小段 JS，调用底座的 la.* 接口，只写这一次的设计逻辑。
// 这里是不碰 DOM 的那一半：读围栏里的字、写法检查（ext-check --lint 也用）。tests/widgetspec.test.js
//
//   ```widget
//   id: w1
//   title: 拖着排
//   ---
//   const d = la.drag({ items: ['$A^2$', '$AB$', '$BA$', '$B^2$'], slots: 4 });
//   la.button('排好了', () => la.goal('四项按左右顺序', d.order().join() === '$A^2$,$AB$,$BA$,$B^2$'));
//   ```
export const WIDGET_MAX = 16 * 1024; // 一段最多多长（字节）：再长就是该进底座的东西了

/** 围栏里的字 → { id, title, code }；写错 { error } */
export function parseWidget(src = '') {
  const text = String(src ?? '').replace(/\r/g, '');
  const lines = text.split('\n');
  const cut = lines.findIndex((l) => /^-{3,}\s*$/.test(l));
  let id = '', title = '';
  let code = text;
  if (cut >= 0) {
    for (const l of lines.slice(0, cut)) {
      const m = l.match(/^\s*(id|title)\s*[:：]\s*(.*?)\s*$/);
      if (m) { if (m[1] === 'id') id = m[2]; else title = m[2]; } else if (l.trim()) return { error: `「---」上面只写 id: 和 title:，看不懂「${l.trim().slice(0, 40)}」` };
    }
    code = lines.slice(cut + 1).join('\n');
  }
  if (!code.trim()) return { error: 'widget 里没写代码：「---」下面写调用 la.* 的 JS' };
  if (new TextEncoder().encode(code).length > WIDGET_MAX) return { error: `widget 的代码超过 ${WIDGET_MAX / 1024} KiB` };
  return { id, title, code };
}

/** 写法检查：读得懂、JS 语法对（在 node 里用 Function 只编译不运行）。返回问题的数组 */
export function widgetProblems(src = '') {
  const w = parseWidget(src);
  if (w.error) return [w.error];
  try { new Function('la', w.code); } catch (e) { return [`JS 写错了：${e.message}`]; }
  return [];
}

/** 学生动了的顺序和要的顺序比（la.drag 的结果用）：几个位置对上了、第一处不对的在哪 */
export function compareOrder(got = [], want = []) {
  const n = Math.max(got.length, want.length);
  let right = 0, first = -1;
  for (let i = 0; i < n; i++) {
    if (String(got[i] ?? '') === String(want[i] ?? '')) right++;
    else if (first < 0) first = i;
  }
  return { ok: right === n, right, n, first };
}
