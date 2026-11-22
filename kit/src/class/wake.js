// 叫醒主讲（2026-11-22）：外部的课里主讲写了 sessions/{编号}.wake = 'comments' 时，学生打字、交作答、点「叫主讲」，
// 页面借 claude.ai 的 comments 能力在学习台上发一条「发给 Claude」的评论；正 watch 着学习台的那个 Claude 会话被叫醒，
// 去读 ext_out / meta/since。评论只是门铃：作答、说的话照旧走 ext_out，评论里只写一行指路。
// 实测（2026-11-22，测试页）：iPad Safari 里打开的完整页面能发，Claude App 里嵌着的视图回 claude_unavailable；
// sendToClaude 要在学生自己的手势里调用（点了以后马上，不能先等写库），所以门铃在手势那一刻按，ext_out 随后写——
// 主讲被叫醒以后自己读，晚一两秒写好的也读得到。
// 同一节课的门铃都回同一个评论串（threadId 存在这台设备上），不一按一个新串（评论串有条数上限）。

/** 这一下值不值得叫醒主讲：打了字、附了图、交了作答（actionTrigger 判成 now 的）、点了叫主讲。纯函数 */
export function wakeWorthy({ texts = 0, images = 0, now = false, call = false } = {}) {
  return !!(call || texts > 0 || images > 0 || now);
}

/** 门铃里那一行字（≤ 4 KiB；只指路，内容在 ext_out）。纯函数 */
export function wakeText({ session = '', why = '', at = Date.now() } = {}) {
  const t = new Date(at).toISOString();
  return `[学习台] ${session} ${why || '学生有新动作'}（${t}）。读 sessions/${session}/meta/since。`;
}

/** 两次门铃至少隔多久：连点、连交几道只叫一次（主讲醒来读的是 meta/since 的全部）。纯函数 */
export const WAKE_GAP = 8000;
export function wakeDue(last, now = Date.now(), gap = WAKE_GAP) {
  return !last || now - last >= gap;
}

/**
 * 碰 DOM 的那一半。session：这节课的编号；anchorEl：评论挂在哪个元素上（板）。
 * 返回 { ring(why), state() }：ring 在学生的手势里同步调用；没开、拿不到能力、视图不支持时什么都不做，state 里写原因。
 */
export function createWaker({ session, anchorEl, enabled }) {
  const KEY = `la-wake-thread-${session}`;
  const st = { on: !!enabled, cm: null, last: 0, status: enabled ? '准备中' : '没开', error: '' };
  let thread = '';
  try { thread = localStorage.getItem(KEY) || ''; } catch { /* 拿不到就每节课新开一串 */ }
  if (st.on) {
    Promise.resolve(window.claude?.use?.('comments')).then(async (cm) => {
      st.cm = cm || null;
      if (!cm) { st.status = '这个视图没有评论能力'; return; }
      try { st.status = await cm.canSendToClaude(); } catch (e) { st.status = e?.code || 'unknown'; }
    }, () => { st.status = '这个视图没有评论能力'; });
  }
  function ring(why) {
    if (!st.on || !st.cm) return false;
    const now = Date.now();
    if (!wakeDue(st.last, now)) return false;
    st.last = now;
    const text = wakeText({ session, why, at: now });
    const send = (target) => st.cm.sendToClaude(target).then((r) => {
      st.error = '';
      if (r?.threadId && r.threadId !== thread) { thread = r.threadId; try { localStorage.setItem(KEY, thread); } catch { /* 下次另开一串 */ } }
      return true;
    });
    // 有串先回那一串；串没了（删了、换了设备）再新开一串——新开要 anchor，anchorFor 也在这一刻调用
    const fresh = () => Promise.resolve(st.cm.anchorFor(anchorEl || document.body)).then((anchor) => send({ anchor, text }));
    (thread ? send({ threadId: thread, text }).catch((e) => (e?.code === 'not_found' || e?.code === 'invalid' ? (thread = '', fresh()) : Promise.reject(e))) : fresh())
      .catch((e) => { st.error = `${e?.code || ''} ${e?.message || ''}`.trim(); st.last = 0; });
    return true;
  }
  return { ring, state: () => ({ ...st, thread }) };
}
