// 组件下面的「截图」入口开不开（外部主讲的修改需求 R11，2026-11-18 学生说：「把截图那里去掉，我要上传截图我知道在这里上传」）。
// 两层：整节课的开关 session.upload（外部的课默认关，board set upload=on 打开）；组件自己写 upload: on / off 盖过它。
// 组件的 upload: 和 exam: 一样挂在组件外面（render.js 拿掉这一行、写进 data-upload），组件不用认这个字段。纯函数 + 一个读 DOM 的小函数。
const LINE = /^\s*upload\s*[:：]\s*(on|off|开|关|true|false|yes|no)\s*$/i;
const ON = /^(on|开|true|yes)$/i;

/** 组件原文里拿掉 upload: 那一行：{ upload: 'on' | 'off' | '', body } */
export function takeUploadField(body) {
  let upload = '';
  const keep = [];
  for (const line of String(body ?? '').split('\n')) {
    const m = line.match(LINE);
    if (m) upload = ON.test(m[1]) ? 'on' : 'off';
    else keep.push(line);
  }
  return { upload, body: upload ? keep.join('\n') : String(body ?? '') };
}

/** 这个组件里放不放截图入口：组件写了的听组件；没写的听整节课（on 默认开） */
export function uploadAllowed(node, lesson) {
  const own = node?.closest?.('[data-upload]')?.dataset?.upload;
  if (own === 'on' || own === 'off') return own === 'on';
  return lesson !== false;
}
