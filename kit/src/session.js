// 一节课的运行状态：关卡（必须完成的练习）、学习记录、图形注册表
const listeners = new Set();

export const session = {
  title: '',
  unit: '',
  stages: [], // {title, src, el}
  gates: [], // {stage, label, done}
  log: [], // 学习记录
  scenes: new Map(), // id -> {api, title, stage}
  ai: null, // 可用时是 ask 函数
  problems: [], // 课件本身的错误（写法不对），集中显示给作者
  context: '', // context 块：给页面里的 Claude 的背景资料
  subject: '线性代数', // 课件开头 subject: 可改（如 数据结构）
  mode: 'plain', // plain | guided | live | class
  replaying: false, // 课堂刷新后把学生的作答重放回组件时为 true：这期间不记录、不发给 Claude
  live: false, // 实时黑板模式（作答同时写进数据库，由对话里的 Claude 决定往下讲什么）
  sink: null, // live 模式下接收每条作答 / 事件 / 手写原图：{ record(entry), event(e), images(key, blobs) }

  reset(title) {
    this.title = title;
    this.stages = [];
    this.gates = [];
    this.scenes.clear();
    this.sceneSeq = 0;
    this.problems = [];
    this.context = '';
    this.log = load(title)?.log || [];
  },

  stageOf(el) {
    const s = el.closest?.('[data-stage]');
    return s ? Number(s.dataset.stage) : 0;
  },

  // 注册一个关卡，返回「完成」函数
  gate(el, label) {
    const g = { stage: this.stageOf(el), label, done: false };
    this.gates.push(g);
    emit();
    return () => {
      if (g.done) return;
      g.done = true;
      emit();
    };
  },

  // 记一条作答。entry.el：组件所在元素（自动补上小节、组件 id、用时）；
  // entry.liveOnly：只写进数据库（比如每一次尝试），不进本地学习记录
  record(entry) {
    if (this.replaying) return; // 刷新后照着记录把作答重放回组件：不再记一遍
    const { el, liveOnly, ...rest } = entry;
    if (el) {
      rest.stage ??= this.stageOf(el);
      rest.block ??= this.blockOf(el);
      rest.step ??= this.stepOf(el);
      const t0 = Number(el.closest?.('[data-t0]')?.dataset.t0);
      if (rest.ms === undefined && t0) rest.ms = Date.now() - t0;
    }
    const e = { ...rest, stage: rest.stage ?? null, at: Date.now() };
    if (!liveOnly) {
      this.log.push(e);
      if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
      save(this.title, { log: this.log });
    }
    this.sink?.record(e);
    emit();
  },

  // 学生的动作（这段做完了、揭开一步、想不出来、提问……），只在 live 模式下写进数据库
  event(type, el, detail) {
    if (this.replaying) return;
    this.sink?.event({ type, step: el ? this.stepOf(el) : undefined, block: el ? this.blockOf(el) : undefined, detail });
  },

  // 交给 Claude 识别的手写 / 截图原图：live 模式下存进 assets，附在这个组件的下一条作答上
  keepImages(key, blobs) {
    if (this.replaying) return;
    const list = (Array.isArray(blobs) ? blobs : [blobs]).filter(Boolean);
    if (list.length) this.sink?.images(typeof key === 'string' ? key : this.blockOf(key) || 'page', list);
  },

  blockOf(el) { return el?.closest?.('[data-bid]')?.dataset.bid; },
  stepOf(el) { return el?.closest?.('[data-step]')?.dataset.step; },

  registerScene(el, api, title) {
    // 编号只增不减：段落被替换、图被移除后，新图不会和还在的图撞号
    this.sceneSeq = Math.max(this.sceneSeq || 0, this.scenes.size) + 1;
    const id = `图${this.sceneSeq}`;
    this.scenes.set(id, { api, title: title || id, stage: this.stageOf(el), el });
    return id;
  },

  stageDone(i) {
    return this.gates.filter((g) => g.stage === i).every((g) => g.done);
  },

  // soft：只是提醒（比如组件没写 id，已自动生成），不算写错，课堂模式不会因此要求重写
  problem(el, kind, msg, { soft = false } = {}) {
    const i = this.stageOf(el);
    this.problems.push({ stage: i, title: this.stages[i]?.title || '', kind, msg, soft, bid: el?.closest?.('[data-bid]')?.dataset.bid });
    emit();
  },

  on(f) { listeners.add(f); return () => listeners.delete(f); },

  // 存取：进度（已解锁到第几节）
  get progress() { return load(this.title)?.unlocked || 0; },
  set progress(n) { save(this.title, { unlocked: n }); },
  clear() {
    try { localStorage.removeItem(key(this.title)); } catch { /* 无痕模式 */ }
    this.log = [];
  },
};

function emit() { listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }

const key = (t) => 'la-kit:' + t;
function load(t) {
  try { return JSON.parse(localStorage.getItem(key(t)) || 'null'); } catch { return null; }
}
function save(t, patch) {
  try { localStorage.setItem(key(t), JSON.stringify({ ...(load(t) || {}), ...patch })); } catch { /* 无痕模式下不保存 */ }
}
