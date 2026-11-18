// 堆的对应关系（kit/src/stage/follows/heap.js，主线第五轮）：黑板的 tree 引擎（heap：建堆、堆排序）接到舞台的树上。
// 堆的知识全在引擎里；学生的手是树本来就有的「拖一个结点到另一个上，两个换值」（open h）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { whereOf } from '../kit/src/stage/follow.js';

const run = (s, src, opt) => { let fx; for (const c of parseScript(src)) fx = s.apply(c, opt); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const stu = (s, src) => s.apply(parseScript(src)[0], { by: 'student', open: 'drag' });
const said = (fx) => [...(fx.judged?.facts || []), ...(fx.judged?.after || [])].join('\n');
const level = (s) => { const o = s.objects.get('h'); const out = []; const q = [o.root]; while (q.length) { const k = q.shift(); const n = o.nodes.find((x) => x.key === k); out.push(n.value); if (n.left != null) q.push(n.left); if (n.right != null) q.push(n.right); } return out.join(' '); };
// 王道的例子：53 17 78 09 45 65 87 32 建大根堆 → 87 45 78 32 17 65 53 09
const HEAP = 'tree h = 53 17 78 09 45 65 87 32 layout=compact\nfollow h heap build\nopen h';

test('建堆：现状里写每一次调整做完该是什么样；学生照着换，到一次调整做完页面知道对', () => {
  const s = make(HEAP);
  assert.match(s.stateText(), /h 照 建大根堆 走：还没做完第 1 次调整（共 4 次调整）。第 1 次调整做完该是：53 17 78 32 45 65 87 09/);
  let fx = stu(s, 'swap h.09 h.32'); // 第 4 个结点 09 和它的孩子 32 换
  assert.equal(fx.judged.verdict.right, true);
  assert.match(said(fx), /到了第 1 次调整做完的样子/);
  fx = stu(s, 'swap h.78 h.87'); // 第 3 个：78 和 87
  assert.equal(fx.judged.verdict.right, true);
  // 第 2 个：17 往下坠要两步（先和 45 换，45 那棵子树已经没孩子比它大）
  fx = stu(s, 'swap h.17 h.45');
  assert.equal(whereOf(s.objects.get('h'), s).passed, 3);
  // 根 53：和 87 换，再和 78 换
  stu(s, 'swap h.53 h.87');
  assert.equal(whereOf(s.objects.get('h'), s).passed, 3, '一次调整中间不算');
  fx = stu(s, 'swap h.53 h.78');
  assert.equal(level(s), '87 45 78 32 17 65 53 09');
  assert.equal(whereOf(s.objects.get('h'), s).done, true);
  assert.match(s.stateText(), /h 照 建大根堆 走：4 次调整都做完了/);
});

test('像引擎认得的错法：换成了「一个个插进去上浮」建出来的样子——告诉老师像哪种', () => {
  const s = make(HEAP);
  for (const x of ['swap h.09 h.32', 'swap h.17 h.45', 'swap h.53 h.87']) stu(s, x); // 87 45 78 32 17 65 53 09（正好是建好的）
  const fx = stu(s, 'swap h.65 h.53'); // 87 45 78 32 17 53 65 09：一个个插入建出来是这样
  assert.equal(level(s), '87 45 78 32 17 53 65 09');
  assert.equal(fx.judged.verdict.right, false);
  assert.match(s.stateText(), /h 照 建大根堆 走：像是[^\n]*插入/);
});

test('小根堆、堆排序也接得上；不是完全二叉树、引擎不收的照实报；只接 build / sort', () => {
  const s = make('tree h = 53 17 78 09 45 layout=compact\nfollow h heap build type=min\nopen h');
  assert.match(s.stateText(), /h 照 建小根堆 走/);
  const t = make('tree h = 87 45 78 32 17 65 53 09 layout=compact\nfollow h heap sort\nopen h');
  assert.match(t.stateText(), /h 照 堆排序（大根堆） 走：还没做完第 1 趟（共 7 趟）。第 1 趟做完该是：78 45 65 32 17 09 53 87/);
  const e = (src) => dryRun(new Scene(), src).at(-1)?.error || '';
  assert.match(e('tree h = 50 30 70 _ 40 layout=compact\nfollow h heap build'), /完全二叉树/);
  assert.match(e('tree h = 53 17 78 layout=compact\nfollow h heap insert'), /只接建堆和堆排序/);
  assert.match(e('tree h = 53 17 78 layout=compact\nfollow h heap sort'), /还不是大根堆/);
  assert.match(e('tree h = 53 17 78 layout=compact\nfollow h heap build typ=min'), /没有「typ」这个字段/);
});

test('老写法的 open h（拖着换值）也算学生手上的动作：@h.right / @h.done 写得进去，走完了算做完', () => {
  const s = make(HEAP);
  assert.deepEqual(dryRun(s, '@h.right say "这棵子树调好了。"\n@h.done say "堆建好了。"'), []);
  run(s, '@h.done say "堆建好了。"');
  let fx;
  for (const x of ['swap h.09 h.32', 'swap h.78 h.87', 'swap h.17 h.45', 'swap h.53 h.87', 'swap h.53 h.78']) fx = stu(s, x);
  assert.deepEqual(fx.done, ['h']);
});
