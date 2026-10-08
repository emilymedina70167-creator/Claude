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

  reset(title) {
    this.title = title;
    this.stages = [];
    this.gates = [];
    this.scenes.clear();
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

  record(entry) {
    this.log.push({ ...entry, stage: entry.stage ?? null, at: Date.now() });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
    save(this.title, { log: this.log });
    emit();
  },

  registerScene(el, api, title) {
    const id = `图${this.scenes.size + 1}`;
    this.scenes.set(id, { api, title: title || id, stage: this.stageOf(el), el });
    return id;
  },

  stageDone(i) {
    return this.gates.filter((g) => g.stage === i).every((g) => g.done);
  },

  problem(el, kind, msg) {
    const i = this.stageOf(el);
    this.problems.push({ stage: i, title: this.stages[i]?.title || '', kind, msg });
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
