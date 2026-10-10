// 把作答、事件、手写原图写进数据库（live 模式）。
// 写失败不打断学生：角落里标一个「这条没存上」，自动重试一次，还可以手动再试。
import { session } from '../session.js';

const cut = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '…' : s);
const newId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

export function createSink(store) {
  const pending = new Map(); // 组件 id → 正在上传的原图（Promise<id|null>）
  const failed = [];
  let badge = null;

  function showBadge() {
    if (!failed.length) { badge?.remove(); badge = null; return; }
    if (!badge) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'live-unsaved';
      badge.addEventListener('click', retryAll);
      document.body.appendChild(badge);
    }
    badge.textContent = `${failed.length} 条没存上 · 点这里再试`;
  }

  // 同一个文档的写入排队一个一个来（数据库要求；而且课堂里同一轮先 add 再 hide 同一段时，
  // 两次写入要是并发，后发的可能先到，刷新后那段又出现了）
  const chains = new Map(); // 'coll/id' → 最后一次写入的 Promise
  const versions = new Map(); // 'coll/id' → 最新一次写入的编号（旧的写失败了不再进「没存上」）

  function put(coll, data, retry = true) {
    const body = JSON.parse(JSON.stringify(data)); // 去掉 undefined
    const id = body.id || newId();
    const key = `${coll}/${id}`;
    // 这个文档之前没存上的旧版本：已经被这次的新内容取代，别在「再试」时把新内容盖回去
    dropFailed(key);
    const v = (versions.get(key) || 0) + 1;
    versions.set(key, v);
    const prev = chains.get(key) || Promise.resolve();
    const p = prev.then(() => write(coll, id, key, body, retry, v));
    chains.set(key, p);
    p.then(() => {
      if (chains.get(key) !== p) return;
      chains.delete(key);
      versions.delete(key);
    });
    return p;
  }

  async function write(coll, id, key, body, retry, v) {
    try {
      await store.db.collection(coll).doc(id).set(body);
      return true;
    } catch (e) {
      if (retry && !['invalid_argument', 'quota_exceeded', 'revoked', 'not_granted'].includes(e?.code)) {
        await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800));
        return write(coll, id, key, body, false, v);
      }
      if (versions.get(key) === v) failed.push({ coll, id, key, body });
      showBadge();
      return false;
    }
  }

  function dropFailed(key) {
    const n = failed.length;
    for (let i = failed.length - 1; i >= 0; i--) if (failed[i].key === key) failed.splice(i, 1);
    if (failed.length !== n) showBadge();
  }

  async function retryAll() {
    const list = failed.splice(0);
    showBadge();
    for (const f of list) await put(f.coll, f.body, false);
  }

  return {
    // 返回每张图上传后的 asset id（Promise，失败为 null），课堂模式记进 class_turns
    images(key, blobs) {
      if (!store.assets) return [];
      const list = pending.get(key) || [];
      const ups = blobs.map((b) => store.assets.upload(b, { type: b.type || 'image/png' }).then((r) => r.id).catch(() => null));
      list.push(...ups);
      pending.set(key, list);
      return ups;
    },

    async record(e) {
      const key = e.block || 'page';
      const ups = pending.get(key) || [];
      pending.delete(key);
      const images = (await Promise.all(ups)).filter(Boolean);
      return put('answers', toAnswer(e, images));
    },

    event(e) {
      return put('events', { ...e, detail: e.detail ?? null, at: Date.now() });
    },

    // 课堂模式：黑板段落、课堂记录、课后小结（失败同样标「没存上」）
    put,
  };
}

// 本地记录 → 数据库里一条作答（字段见 docs/live-board-spec.md 1.4）
export function toAnswer(e, images = []) {
  const kind = String(e.type || 'answer').replace(/-try$/, '');
  const { type, answer, work, feedback, question, last, guess, stage, el, ...rest } = e;
  const studentText = kind === 'conjecture' ? answer : kind === 'ask' ? question : e.text;
  return {
    ...rest,
    id: newId(),
    step: e.step ?? session.stages[stage]?.id ?? null,
    block: e.block ?? null,
    kind,
    q: cut(e.q ?? e.title ?? '', 600),
    text: cut(studentText ?? null, 4000),
    value: e.value ?? last ?? (guess !== undefined ? String(guess) : null),
    ok: typeof e.ok === 'boolean' ? e.ok : null,
    transcript: cut(e.transcript ?? work ?? null, 4000),
    aiFeedback: cut(kind === 'ask' ? answer ?? null : feedback ?? e.aiFeedback ?? null, 2000),
    images,
    at: e.at || Date.now(),
  };
}
