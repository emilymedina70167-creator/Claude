import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK, MAX_IMAGES, MODEL_TAG, CONFIRM_MS, LONG_WAIT_MS,
  statusView, isSendKey, keyboardLift, mergePrefill, createConfirm,
  addImages, clipboardImages, htmlImageSrcs, growHeight, elapsedText,
  clearScroll, FIELD, waitText, placeholderFor,
} from '../kit/src/class/bar.js';

// 输入框的 DOM 行为在浏览器里实际操作验证；这里测不碰 DOM 的部分

test('常量：快捷按钮、模型标记、附图上限', () => {
  assert.deepEqual(QUICK, ['没懂', '想不出来', '换个说法', '继续']);
  assert.equal(MODEL_TAG, 'Opus 5.5 · high');
  assert.equal(MAX_IMAGES, 4);
  assert.equal(CONFIRM_MS, 3000);
  // 「想得细，要等一会儿」在已经显示秒数之后才出现
  assert.ok(LONG_WAIT_MS >= 6000 && LONG_WAIT_MS <= 20000);
});

test('statusView：默认文字、未知状态、重试按钮', () => {
  assert.deepEqual(statusView('thinking'), { state: 'thinking', text: 'Claude 在想…', retry: false, live: true });
  assert.deepEqual(statusView('writing', ''), { state: 'writing', text: 'Claude 正在写黑板…', retry: false, live: true });
  assert.equal(statusView('thinking', 'Claude 在改写黑板上没画出来的段…').text, 'Claude 在改写黑板上没画出来的段…');
  assert.deepEqual(statusView('error', 'Opus 5.5 暂时用不了，稍后点重试。'), { state: 'error', text: 'Opus 5.5 暂时用不了，稍后点重试。', retry: true, live: false });
  assert.equal(statusView('error').text, '这一轮没成功。');
  assert.deepEqual(statusView('notice', '  这一轮太长，被截断了。 '), { state: 'notice', text: '这一轮太长，被截断了。', retry: false, live: false });
  assert.deepEqual(statusView('idle', ''), { state: 'idle', text: '', retry: false, live: false });
  assert.deepEqual(statusView('idle'), { state: 'idle', text: '', retry: false, live: false });
  assert.equal(statusView('bogus', 'x').state, 'idle');
  assert.equal(statusView(undefined).state, 'idle');
  assert.equal(statusView('notice', null).text, '');
});

test('isSendKey：回车发送，Shift+回车换行，输入法组字的回车不发', () => {
  assert.equal(isSendKey({ key: 'Enter' }), true);
  assert.equal(isSendKey({ key: 'Enter', keyCode: 13 }), true);
  assert.equal(isSendKey({ key: 'Enter', shiftKey: true }), false);
  assert.equal(isSendKey({ key: 'Enter', isComposing: true }), false); // Chrome / Firefox 拼音选词
  assert.equal(isSendKey({ key: 'Enter', keyCode: 229 }), false); // Safari 组字结束的回车
  assert.equal(isSendKey({ key: 'a' }), false);
  assert.equal(isSendKey({ key: 'Process', keyCode: 229 }), false);
  assert.equal(isSendKey(null), false);
});

test('keyboardLift：iPad 软键盘弹出时抬高对话条', () => {
  assert.equal(keyboardLift(1180, null), 0);
  assert.equal(keyboardLift(1180, { height: 1180, offsetTop: 0, scale: 1 }), 0);
  assert.equal(keyboardLift(1180, { height: 780, offsetTop: 0, scale: 1 }), 400);
  // 键盘弹出后页面被系统往上推了一段：offsetTop 也要扣掉
  assert.equal(keyboardLift(1180, { height: 780, offsetTop: 120, scale: 1 }), 280);
  assert.equal(keyboardLift(820, { height: 455.6, offsetTop: 0 }), 364);
  assert.equal(keyboardLift(1180, { height: 1179.6, offsetTop: 0 }), 0); // 舍入误差不算键盘
  assert.equal(keyboardLift(1180, { height: 1200, offsetTop: 0 }), 0); // 不会是负数
  assert.equal(keyboardLift(1180, { height: 600, offsetTop: 0, scale: 2 }), 0); // 双指放大不是键盘
  assert.equal(keyboardLift(0, { height: 600 }), 0);
  assert.equal(keyboardLift(1180, { height: 0 }), 0);
});

test('mergePrefill：不覆盖已经写了的字', () => {
  assert.equal(mergePrefill('', '请看看我的草稿'), '请看看我的草稿');
  assert.equal(mergePrefill('   \n', '请看看我的草稿'), '请看看我的草稿');
  assert.equal(mergePrefill('我自己写的', '请看看我的草稿'), '我自己写的');
  assert.equal(mergePrefill(undefined, '你好'), '你好');
  assert.equal(mergePrefill('', undefined), '');
});

test('createConfirm：「下课」要 3 秒内点两次', () => {
  let t = 1000;
  const c = createConfirm(3000, () => t);
  assert.equal(c.armed, false);
  assert.equal(c.tap(), 'arm');
  assert.equal(c.armed, true);
  t += 2999;
  assert.equal(c.tap(), 'fire');
  assert.equal(c.armed, false); // 触发后复位
  assert.equal(c.tap(), 'arm');
  t += 3001;
  assert.equal(c.armed, false);
  assert.equal(c.tap(), 'arm'); // 超时后重新上膛，不触发
  t += 3000;
  assert.equal(c.tap(), 'fire'); // 正好 3 秒还算
  assert.equal(c.tap(), 'arm');
  c.reset();
  assert.equal(c.armed, false);
  assert.equal(c.tap(), 'arm');
});

test('clearScroll：黑板上获得焦点的东西滚到对话条上面、进度条下面', () => {
  // 藏在对话条后面：往下滚，露出整个，离对话条留空
  assert.equal(clearScroll({ top: 1000, bottom: 1046 }, 80, 960), 86);
  // 已经在可见区域里：不动
  assert.equal(clearScroll({ top: 300, bottom: 400 }, 80, 960), 0);
  // 藏在顶上进度条后面：往上滚
  assert.equal(clearScroll({ top: 40, bottom: 90 }, 80, 960), -40);
  // 比可见区域还高：先保证上沿看得见
  assert.equal(clearScroll({ top: 500, bottom: 1500 }, 80, 960), 420);
  // 不合理的输入不滚
  assert.equal(clearScroll(null, 80, 960), 0);
  assert.equal(clearScroll({ top: 10, bottom: 10 }, 80, 960), 0);
  assert.equal(clearScroll({ top: 10, bottom: 50 }, 900, 100), 0);
  assert.equal(clearScroll({ top: 959.6, bottom: 960.4 }, 80, 960), 0);
});

test('FIELD：会弹软键盘的才算输入框', () => {
  assert.match(FIELD, /textarea/);
  assert.match(FIELD, /contenteditable/);
  for (const t of ['button', 'submit', 'checkbox', 'radio', 'range', 'file', 'hidden']) assert.ok(FIELD.includes(`:not([type="${t}"])`), t);
});

test('addImages：最多 4 张，多的丢掉并报数', () => {
  const a = { n: 1 }, b = { n: 2 }, c = { n: 3 }, d = { n: 4 }, e = { n: 5 };
  assert.deepEqual(addImages([], [a, b]), { list: [a, b], dropped: 0 });
  assert.deepEqual(addImages([a, b, c], [d, e]), { list: [a, b, c, d], dropped: 1 });
  assert.deepEqual(addImages([a, b, c, d], [e]), { list: [a, b, c, d], dropped: 1 });
  assert.deepEqual(addImages([a], [null, undefined, b]), { list: [a, b], dropped: 0 });
  assert.deepEqual(addImages([], undefined), { list: [], dropped: 0 });
  assert.deepEqual(addImages([], [a, b, c], 2), { list: [a, b], dropped: 1 });
});

test('clipboardImages：图在 items 或 files 里都能取到，只要图片', () => {
  const png = { type: 'image/png', name: 'a.png' };
  const heic = { type: 'image/heic', name: 'b.heic' };
  const item = (kind, type, file) => ({ kind, type, getAsFile: () => file });
  assert.deepEqual(clipboardImages({ items: [item('string', 'text/plain', null), item('file', 'image/png', png)], files: [] }), [png]);
  // iOS：items 里没有文件，图在 files 里
  assert.deepEqual(clipboardImages({ items: [item('string', 'text/html', null)], files: [heic] }), [heic]);
  // 不是图片的文件不要
  assert.deepEqual(clipboardImages({ items: [item('file', 'application/pdf', { type: 'application/pdf' })], files: [{ type: 'text/plain' }] }), []);
  // getAsFile 拿不到时跳过
  assert.deepEqual(clipboardImages({ items: [item('file', 'image/png', null)], files: [png] }), [png]);
  assert.deepEqual(clipboardImages(null), []);
  assert.deepEqual(clipboardImages({}), []);
});

test('htmlImageSrcs：剪贴板只有 html 时，从 <img> 里取图', () => {
  const html = '<meta charset="utf-8"><p>x</p><img alt="a" src="data:image/png;base64,AAA"><IMG SRC=\'blob:https://claude.ai/1\'>'
    + '<img width="3" src="https://a.com/b.png?x=1&amp;y=2"><img src="file:///etc/passwd"><img src="javascript:alert(1)"><img data-src="x.png">';
  assert.deepEqual(htmlImageSrcs(html), ['data:image/png;base64,AAA', 'blob:https://claude.ai/1', 'https://a.com/b.png?x=1&y=2']);
  assert.deepEqual(htmlImageSrcs('<p>只有文字</p>'), []);
  assert.deepEqual(htmlImageSrcs(''), []);
  assert.deepEqual(htmlImageSrcs(undefined), []);
});

test('growHeight：输入框随内容增高，最多 4 行', () => {
  const lh = 25.6, pad = 20;
  assert.deepEqual(growHeight({ scrollHeight: 0, lineHeight: lh, padding: pad }), { height: 46, scroll: false });
  assert.deepEqual(growHeight({ scrollHeight: 46, lineHeight: lh, padding: pad }), { height: 46, scroll: false });
  assert.deepEqual(growHeight({ scrollHeight: 71, lineHeight: lh, padding: pad }), { height: 71, scroll: false });
  assert.deepEqual(growHeight({ scrollHeight: 122, lineHeight: lh, padding: pad }), { height: 122, scroll: false });
  assert.deepEqual(growHeight({ scrollHeight: 300, lineHeight: lh, padding: pad }), { height: 122, scroll: true });
  assert.deepEqual(growHeight({ scrollHeight: 60, lineHeight: 20, padding: 0, maxLines: 2 }), { height: 40, scroll: true });
});

test('elapsedText：等太久才显示已经等了多久', () => {
  assert.equal(elapsedText(0), '');
  assert.equal(elapsedText(5999), '');
  assert.equal(elapsedText(6000), '6 秒');
  assert.equal(elapsedText(42500), '42 秒');
  assert.equal(elapsedText(65000), '1 分 5 秒');
  assert.equal(elapsedText(undefined), '');
});

test('waitText：等太久时把默认的「在想」换成「想得细」；别的说法照原样', () => {
  assert.equal(waitText('', 0), 'Claude 在想…');
  assert.equal(waitText('Claude 在想…', LONG_WAIT_MS - 1), 'Claude 在想…');
  assert.equal(waitText('Claude 在想…', LONG_WAIT_MS), 'Claude 想得细，第一句话要等一会儿…');
  assert.equal(waitText(undefined, LONG_WAIT_MS + 5000), 'Claude 想得细，第一句话要等一会儿…');
  assert.equal(waitText('对话有点长了，先整理一下前面的内容…', LONG_WAIT_MS * 3), '对话有点长了，先整理一下前面的内容…');
});

test('placeholderFor：停用、窄屏、能不能粘贴截图', () => {
  assert.equal(placeholderFor({ enabled: false, images: true }), '现在没法和 Claude 说话');
  assert.equal(placeholderFor({ narrow: true, images: true }), '和 Claude 说点什么…');
  assert.match(placeholderFor({ images: true }), /粘贴截图/);
  assert.doesNotMatch(placeholderFor({ images: false }), /截图/);
  assert.equal(placeholderFor(), placeholderFor({ enabled: true, narrow: false, images: false }));
});
