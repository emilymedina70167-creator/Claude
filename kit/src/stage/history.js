// 舞台课发给老师的对话放不下时怎么省（纯函数，classroom.js 的 messages 用；tests/stage-mainline7.test.js）。
// 以前一放不下就从最早成对丢掉，没有摘要：第一节真课（72 分钟）到后三分之一，老师只看得到第 40 轮以后的。
// 每一轮学生那一条都带着一整份「舞台现在」，那节课一共占了对话的一半多——而老师只用得着最近的几份：
// 所以先把最早几轮的舞台样子换成一句「省略了」（[学生] 那一段学生做了什么照留），还放不下才照旧丢轮。放得下时一字不改。

export const STATE_STUB = '[舞台现在]（这一轮的舞台现在页面省略了：对话放不下）\n\n写下一轮。';
const MARK = '[舞台现在]';
const B = (s) => (typeof Buffer !== 'undefined' ? Buffer.byteLength(String(s ?? '')) : new TextEncoder().encode(String(s ?? '')).length);

/**
 * msgs：[{ role, content }]（一问一答交替，第一条是 user，它前面拼着整份说明的话 sysBytes 算在里面）；max：整份的字节上限。
 * keep：最近几条 user 的舞台样子不省。返回 { msgs, stripped（省了几条）, dropped（丢了几对） }
 */
export function fitHistory(msgs, { max, sysBytes = 0, keep = 3 } = {}) {
  let size = sysBytes + msgs.reduce((n, m) => n + B(m.content), 0);
  let stripped = 0, dropped = 0;
  if (size <= max) return { msgs, stripped, dropped };
  const users = msgs.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i > 0);
  for (const i of users.slice(0, Math.max(0, users.length - keep))) {
    if (size <= max) break;
    const c = msgs[i].content;
    const at = c.lastIndexOf(MARK);
    if (at < 0 || c.slice(at) === STATE_STUB) continue;
    const next = c.slice(0, at) + STATE_STUB;
    size -= B(c) - B(next);
    msgs[i] = { ...msgs[i], content: next };
    stripped += 1;
  }
  // 还放不下：照旧成对丢最早的（第一条 user 留着：说明拼在它前面）
  while (msgs.length > 3 && size > max) {
    size -= B(msgs[1].content) + B(msgs[2].content);
    msgs.splice(1, 2);
    dropped += 1;
  }
  return { msgs, stripped, dropped };
}
