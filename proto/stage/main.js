// 舞台样子页的入口：选「看剧本」（A 段，不调用 Claude）或「Opus 5.5 上课」（B 段，当场写）。
// 地址：?mock 模拟老师（本地）、?dev 给检查脚本留 window.LAStage、?blank 一块空舞台、#shell / #bsearch / #insert 直接开那一节
import { Stage } from '../../kit/src/stage/stage.js';
import { TOPICS, turnMessage } from '../../kit/src/stage/doc.js';
import { actText, HELP } from '../../kit/src/stage/stage.js';
import { createLoop } from '../../kit/src/stage/loop.js';
import { eventsText } from '../../kit/src/stage/events.js';
import { goalStatus } from '../../kit/src/stage/goal.js';
import { dryRun } from '../../kit/src/stage/scene.js';
import css from '../../kit/src/stage/stage.css';
import { viewCss } from '../../kit/src/stage/types/views.js';
import katexCss from 'virtual:katex-css';
import { scriptedLesson } from './scripted.js';
import { liveLesson } from './live.js';

const style = document.createElement('style');
style.textContent = `${css}\n${viewCss()}`;
document.head.appendChild(style);
// 式子（types/tex）用的 KaTeX 样式和字体
const katexStyle = document.createElement('style');
katexStyle.textContent = katexCss;
document.head.appendChild(katexStyle);

const $ = (id) => document.getElementById(id);
const host = $('stage');
const q = new URLSearchParams(location.search);
const MOCK = q.has('mock');
let stage = null;
let run = 0;
// ?dev：检查脚本用（tools/stage-try.mjs 拿 createLoop 照学习台的课堂循环演一幕）
if (q.has('dev')) window.LAStageDev = { acts: [], Stage, actText, turnMessage, createLoop, eventsText, goalStatus, HELP, dryRun };

function fresh({ input }) {
  stage?.destroy();
  host.querySelectorAll('.st-error').forEach((n) => n.remove());
  stage = new Stage(host, { input, onAct: (a) => window.LAStageDev?.acts.push(a) });
  window.LAStage = stage;
  return stage;
}

function showError(err) {
  if (err?.message === 'stop') return;
  console.error(err);
  const p = document.createElement('pre');
  p.className = 'st-error';
  p.textContent = `演不下去了：${err?.message || err}`;
  host.appendChild(p);
}

async function startScripted() {
  const my = ++run;
  hideMenu();
  hud(null);
  const st = fresh({ input: false });
  try { await scriptedLesson(st, () => my === run); if (my === run) startScripted(); } catch (err) { showError(err); }
}

async function startLive(topic) {
  const my = ++run;
  hideMenu();
  hud({ title: topic.title });
  const st = fresh({ input: true });
  try {
    await liveLesson(st, topic, { alive: () => my === run, mock: MOCK, status: (s) => my === run && hud({ title: topic.title, ...s }), thinking: (on, round) => my === run && think(on, round) });
  } catch (err) { think(false); showError(err); }
}

// —— 角上的两样：老师在想（计时）、每一轮多快 ——
let thinkTimer = null;
function think(on, round) {
  const el = $('think');
  clearInterval(thinkTimer);
  if (!on) { el.hidden = true; return; }
  const t0 = performance.now();
  el.hidden = false;
  const paint = () => { el.textContent = `${MOCK ? '模拟老师' : 'Opus 5.5'} 在想${round > 1 ? '' : '第一轮'}… ${((performance.now() - t0) / 1000).toFixed(0)} 秒`; };
  paint();
  thinkTimer = setInterval(paint, 500);
}
function hud(s) {
  const el = $('hud');
  if (!s) { el.hidden = true; return; }
  el.hidden = false;
  const sec = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} 秒`);
  const parts = [`<b>${s.title}</b>`];
  if (s.round) parts.push(`第 ${s.round} 轮`);
  if (s.firstLine != null || s.total != null) parts.push(`第一个镜头 ${sec(s.firstLine)}`, `写完 ${sec(s.total)}`);
  if (s.stats?.length > 1) parts.push(`平均第一个镜头 ${sec(s.stats.reduce((a, x) => a + (x.firstLine ?? x.total), 0) / s.stats.length)}`);
  if (s.model) parts.push(s.model);
  if (s.voided) parts.push(`<span class="bad">作废了一轮（${s.voided}）</span>`);
  if (s.error) parts.push(`<span class="bad">${s.error}</span>`);
  if (s.errors?.length) parts.push(`<span class="bad" title="${s.errors.map((e) => `第 ${e.line} 行 ${e.src}：${e.error}`).join('\n').replace(/"/g, '&quot;')}">跳过 ${s.errors.length} 行</span>`);
  el.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
}

// —— 开头的菜单 ——
function showMenu() { ++run; stage?.destroy(); stage = null; think(false); hud(null); $('menu').hidden = false; }
function hideMenu() { $('menu').hidden = true; }

$('pick-script').addEventListener('click', startScripted);
for (const [key, t] of Object.entries(TOPICS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'm-topic';
  b.textContent = t.title;
  b.addEventListener('click', () => startLive(t));
  $('topics').appendChild(b);
  if (location.hash === `#${key}`) queueMicrotask(() => startLive(t));
}
$('own').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('own-text').value.trim();
  if (!text) return;
  startLive({ title: text.slice(0, 16), topic: text, material: '' });
});
$('again').addEventListener('click', showMenu);
if (MOCK) $('menu-note').textContent = '本地模拟：老师照剧本回，不调用 Claude。';

if (q.has('blank')) { hideMenu(); fresh({ input: true }); } else if (q.has('script')) startScripted();
