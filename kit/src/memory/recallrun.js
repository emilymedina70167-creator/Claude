// 首页「要记的」（docs/review-plan.md）：到期的记忆点一条一条想一遍。排期、结果在 recall.js（纯函数），这里是画面。
// 先自己写出来（Apple Pencil 在框里直接写，iPad 的随手写会转成字），再看答案，自己点「想起来了 / 模糊 / 没想起」——
// 不让页面替我判：要背的东西说法不一，意思对就算；写过的留在证据里，以后能对着看当时写的什么。不调用 Claude。
import { mdToHtml, escapeHtml } from '../render.js';
import { toast } from '../record.js';
import { assertWrite, applyChange, toDate } from './schema.js';
import { RATINGS, rateRecall, recallEvidence, sameText } from './recall.js';
import { SPRING, SHEET } from './feel.js';

// 一叠卡（2026-11-04，照「学习台手感」原型）：正面是问题和写的框，点「看答案」翻过来，背面是答案和三个按钮；
// 评完那张飞走（想起来了往右、没想起往左、模糊往上），后面那张跟上来。只是画面，排期和记录照旧
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const anim = (el, frames, opts) => (el?.animate && !still() ? el.animate(frames, opts) : { finished: Promise.resolve() });

const inline = (s) => { try { return mdToHtml(String(s ?? ''), { inline: true }); } catch { return escapeHtml(String(s ?? '')); } };

/**
 * host：画在哪（首页那张卡的身体）；items：这次要想的记忆点（recall.js 的 recallToday）；db：学习台的数据库；
 * titleOf(block)：块的标题；onDone()：想完了 / 先到这（回到卡片的样子）
 */
export function runRecall(host, { items = [], db, titleOf = () => '', onDone = () => {} } = {}) {
  const list = items.slice();
  const tally = { got: 0, vague: 0, miss: 0 };
  let at = 0;
  let busy = false;
  let stopped = false; // 评分还在写、卡还在飞时点了「先到这」：写完这张就停，不再翻出下一张
  const evIds = new Map(); // 一条记忆点这一叠里只记一条证据：写记忆点失败重试时不再多出一条

  function show() {
    if (at >= list.length) return done();
    const k = list[at];
    const left = list.length - at;
    host.innerHTML = `
      <div class="rc-run">
        <div class="rc-top"><span class="muted">第 ${at + 1} / ${list.length} 条</span><button type="button" class="btn btn-sm rc-stop">先到这</button></div>
        <div class="rc-deck${left > 1 ? ' has-2' : ''}${left > 2 ? ' has-3' : ''}">
          <div class="rc-card">
            <div class="rc-front">
              <div class="rc-q">${inline(k.q)}</div>
              <textarea class="rc-typed" rows="3" placeholder="先自己写出来（Apple Pencil 可以直接在框里写）"></textarea>
              <div class="rc-acts"><button type="button" class="btn btn-primary rc-show">翻过来看答案</button></div>
            </div>
            <div class="rc-back" hidden></div>
          </div>
        </div>
      </div>`;
    host.querySelector('.rc-stop').addEventListener('click', () => { if (busy) stopped = true; else done(); });
    host.querySelector('.rc-show').addEventListener('click', reveal);
    // 不是第一张：从后面那一叠里跟上来
    if (at > 0) anim(host.querySelector('.rc-card'), [{ transform: 'translateY(14px) scale(.95)', opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: SPRING });
    window.scrollTo({ top: Math.max(0, host.getBoundingClientRect().top + window.scrollY - 80), behavior: 'smooth' });
  }

  function reveal() {
    const k = list[at];
    const typed = host.querySelector('.rc-typed').value;
    host.querySelector('.rc-typed').readOnly = true;
    const card = host.querySelector('.rc-card');
    const back = host.querySelector('.rc-back');
    const t = k.block ? titleOf(k.block) : '';
    // 翻面：转到侧面那一刻把正面换成背面，再转回来（不靠 backface-visibility，几张叠着的卡也不会透）
    const flip = () => { host.querySelector('.rc-front').hidden = true; back.hidden = false; };
    if (still()) flip();
    else anim(card, [{ transform: 'perspective(1200px) rotateY(0)' }, { transform: 'perspective(1200px) rotateY(90deg)' }], { duration: 200, easing: 'ease-in' }).finished.then(() => { flip(); anim(card, [{ transform: 'perspective(1200px) rotateY(-90deg)' }, { transform: 'perspective(1200px) rotateY(0)' }], { duration: 520, easing: SPRING }); });
    back.innerHTML = `
      <p class="rc-q-small">${inline(k.q)}</p>
      <div class="rc-a"><span class="dk-k">答案</span>${inline(k.a)}</div>
      ${typed.trim() ? `<p class="rc-mine"><span class="dk-k">我写的</span>${escapeHtml(typed)}</p>` : ''}
      <p class="rc-where muted">${t ? `${inline(t)} · ` : ''}${k.result ? `上次${{ got: '想起来了', vague: '模糊', miss: '没想起' }[k.result] || '想过'}` : '第一次想'}${Number(k.lapses) ? `，没想起过 ${Number(k.lapses)} 次` : ''}${sameText(typed, k.a) ? '　<b class="rc-same">写得和答案一样</b>' : ''}</p>
      <div class="rc-rate">${Object.entries(RATINGS).map(([v, r]) => `<button type="button" class="btn rc-r is-${v}" data-r="${v}"><b>${r.label}</b><span class="muted">${r.hint}</span></button>`).join('')}</div>`;
    back.querySelectorAll('.rc-r').forEach((b) => b.addEventListener('click', () => rate(b.dataset.r, typed)));
  }

  async function rate(rating, typed) {
    if (busy) return;
    busy = true;
    host.querySelectorAll('.rc-r').forEach((b) => { b.disabled = true; });
    const k = list[at];
    const today = toDate(Date.now());
    try {
      // 读最新的再改（课堂里可能刚改过问法，别的设备今天可能已经想过这条）：档位按最新的那份算
      const cur = await db.doc(`recall/${k.id}`).get().then((s) => (s.exists ? s.data() : null)).catch(() => null);
      const { id: _, ...base } = cur ? { id: k.id, ...cur } : k;
      const { patch, note } = rateRecall({ id: k.id, ...base }, rating, { today });
      const { id: evNew, ...evDoc } = recallEvidence(k, { typed, rating });
      const evId = evIds.get(k.id) || evNew;
      evIds.set(k.id, evId);
      assertWrite('page', 'evidence');
      assertWrite('page', 'recall');
      await db.doc(`evidence/${evId}`).set(evDoc);
      await db.doc(`recall/${k.id}`).set(applyChange(base, patch, { date: today, by: 'page', basis: [evId], note: `我自己想了一遍：${note}` }));
      tally[rating]++;
      // 评完那张飞走：想起来了往右、没想起往左、模糊往上
      const dir = rating === 'got' ? 1 : rating === 'miss' ? -1 : 0;
      await anim(host.querySelector('.rc-card'), [{ transform: 'none', opacity: 1 }, { transform: dir ? `translateX(${dir * 120}%) rotate(${dir * 10}deg)` : 'translateY(-40px) scale(.92)', opacity: 0 }], { duration: 380, easing: SHEET, fill: 'forwards' }).finished.catch(() => {});
      at++;
      if (stopped) done(); else show();
    } catch (err) {
      toast(`没记上：${err?.message || err}`);
      host.querySelectorAll('.rc-r').forEach((b) => { b.disabled = false; });
    } finally { busy = false; }
  }

  function done() {
    const n = tally.got + tally.vague + tally.miss;
    if (!n) { onDone(); return; }
    host.innerHTML = `
      <div class="rc-run">
        <svg class="rc-tick" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="38"/><path d="M26 43 37 54 59 31"/></svg>
        <p class="rc-sum">想了 ${n} 条：想起来了 ${tally.got}、模糊 ${tally.vague}、没想起 ${tally.miss}。</p>
        <p class="muted">${tally.miss ? '没想起的明天再来；' : ''}想起来的隔得更久再问，隔 30 天还想得起来就算记牢了。</p>
        <div class="rc-acts"><button type="button" class="btn btn-primary rc-ok">好</button></div>
      </div>`;
    host.querySelector('.rc-ok').addEventListener('click', onDone);
  }

  show();
}
