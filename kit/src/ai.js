// 页面里调用 Claude：新版 artifact 用 claude.use("sample")，
// 旧版对话 artifact 用 window.claude.complete。都没有就返回 null（相关功能隐藏）。
import { session } from './session.js';

let pending = null;

// 课堂模式：讲课只能是 Opus 5.5（课堂控制器用 call，自己检查 modelApplied）。组件自己发起的小活里，
// 只有带图的转写（手写 / 截图 → 文字）可以用别的档；找错的提示、猜想批改这类等于别的模型在讲课，一律不发。
// 拒绝码用 capability_disabled：组件把它当「这个页面没有 Claude」，安静地收起相关按钮
const classBlocked = (opts) => session.mode === 'class' && !(opts && opts.images);
const blocked = () => Promise.reject({ code: 'capability_disabled', message: '课堂模式里只有课堂 Claude（Opus 5.5）讲课' });

export function getAI() {
  if (pending) return pending;
  pending = (async () => {
    const c = window.claude;
    if (!c) return null;
    if (typeof c.use === 'function') {
      let sample = null;
      try { sample = await c.use('sample'); } catch { sample = null; }
      if (!sample) return null;
      let limits = null;
      try { limits = await sample.limits(); } catch { limits = null; }
      return {
        tools: !!limits?.tools,
        // 能发图片时是 {maxCount, mediaTypes, ...}；课件要声明 capabilities: {"sample": {"images": true}}
        images: limits?.images || null,
        ask: (input, opts = {}) => (classBlocked(opts) ? blocked() : sample(input, opts).then((r) => r.text)),
        // 完整结果（含 modelApplied / modelTierApplied），课堂模式要据此判断是不是指定的模型在讲课
        call: (input, opts = {}) => sample(input, opts),
        limits,
        json: (input, opts = {}) => (classBlocked(opts) ? blocked() : sample.json(input, opts)),
      };
    }
    if (typeof c.complete === 'function') {
      const flat = (input) => (typeof input === 'string' ? input : input.map((t) => `${t.role === 'user' ? '学生/页面' : '助教'}：${t.content}`).join('\n\n'));
      const ask = async (input, opts = {}) => {
        const text = await c.complete(flat(input));
        opts.onText?.({ text, delta: text });
        return text;
      };
      return {
        // 旧接口：不能指定模型，也不告诉页面是哪个模型答的（课堂模式据此不开课）
        legacy: true,
        tools: false,
        images: null,
        ask,
        call: async (input, opts = {}) => ({ text: await ask(input, opts), truncated: false, modelTierApplied: 'default' }),
        json: async (input) => {
          const text = await c.complete(flat(input));
          const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (!m) throw { code: 'invalid_json', message: 'no json', text };
          return JSON.parse(m[0]);
        },
      };
    }
    return null;
  })();
  return pending;
}

export function errorText(e) {
  const code = e?.code;
  if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled') return '这个页面没有获得调用 Claude 的权限。';
  if (code === 'rate_limited') return '请求太频繁，等一下再说。';
  if (code === 'session_expired') return '登录已过期，请重新登录 Claude。';
  if (code === 'refused') return 'Claude 没有回答这个问题，换个问法试试。';
  if (code === 'invalid_json') return 'Claude 的回复格式不对，请再试一次。';
  if (code === 'cancelled') return '已停止。';
  if (code === 'prompt_too_large') return '内容太长，发不出去。';
  if (code === 'image_rejected') return '图片发不出去（格式或大小不对），换一张再试。';
  if (code === 'empty_completion') return 'Claude 这次什么也没写，换个说法再试。';
  return '连接出了问题，请再试一次。';
}

export const AI_PERMANENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);
