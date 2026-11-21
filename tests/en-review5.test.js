// 视觉交互第 5 批独立复查以后一次修完的：一条一个能重现的测试（画面上的另有 .superpowers/audit-visual/en/v5-rev.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrackets, joinTarget, roleName } from '../kit/src/entext.js';
import { parseShift, shiftPlan, shiftDecoys } from '../kit/src/enshift.js';
import { itemsOf } from '../kit/src/memory/report.js';

test('C1 两步的题（先标成分再连分裂结构 / 先挑再改 / 先排再选形式）一次做对是「一上来就对」：第 2 步另算一道', () => {
  const rec = (o) => ({ src: 'record', comp: 'j1', type: 'parse', q: 'The rumor spread', at: 1, ...o });
  const evs = [
    rec({ ok: true, attempts: 1, more: true }),
    rec({ final: true, ok: true, attempts: 1, more: true }),
    rec({ ok: true, attempts: 1, detail: '第 2 步：分裂结构' }),
    rec({ final: true, ok: true, attempts: 1, detail: '第 2 步：分裂结构' }),
  ];
  const items = itemsOf(evs);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((it) => it.outcome), ['first', 'first']);
});

test('I1 连分裂结构：点从句里的词（不管是成分还是没标的词）选中的是带 ~n 的那个从句', () => {
  const ans = parseBrackets('[S~1 The rumor] [V spread] [A quickly] [AppC~1 that [S the manager] [V had resigned]].');
  const appc = ans.spans.findIndex((s) => s.role === 'AppC');
  const inner = ans.spans.findIndex((s) => s.role === 'V' && s.from > ans.spans[appc].from);
  assert.equal(joinTarget(ans.spans, inner, ans.spans[inner].from), appc, '点从句里的谓语');
  assert.equal(joinTarget(ans.spans, -1, ans.spans[appc].from), appc, '点 that（没标成分的词）');
  const s = ans.spans.findIndex((x) => x.role === 'S' && x.join);
  assert.equal(joinTarget(ans.spans, s, ans.spans[s].from), s, '本身带 ~n 的照旧是它');
  const v = ans.spans.findIndex((x) => x.role === 'V');
  assert.equal(joinTarget(ans.spans, v, ans.spans[v].from), v, '外面没有带 ~n 的：照旧是点的那一段');
  const plain = parseBrackets('[S~1 The rumor] soon [V spread] [AppC~1 that [S he] [V left]].');
  assert.equal(joinTarget(plain.spans, -1, 2), -1, '主干上没标的词（soon）：什么都不选');
});

test('I4 shift 的框架词按词比：一段里只有一个词变了，只说那一个', () => {
  const p = shiftPlan(parseShift({ from: '[S He] said that [S#2 she] [V left].', to: '[S He] said [S#2 she] [V left].' }));
  assert.deepEqual(p.added, []);
  assert.deepEqual(p.dropped, ['that']);
  const q = shiftPlan(parseShift({ from: '[S Tom] [V broke] [O it].', to: 'It was [S Tom] that [V broke] [O it].' }));
  assert.deepEqual(q.added, ['It was', 'that']);
});

test('I5 弯撇号和直撇号不算词变了', () => {
  const p = shiftPlan(parseShift({ from: '[S He] [V doesn\'t] [O care].', to: '[S He] [V doesn’t] [O care].' }));
  assert.deepEqual(p.changed, []);
});

test('M5 decoys 写错报出来：没有这个成分、这个成分没变、写成冒号', () => {
  const s = parseShift({ from: '[S The committee] [V approved] [O the plan].', to: '[O=S The plan] [V was approved] [S=A by the committee].' });
  const plan = shiftPlan(s);
  assert.deepEqual(shiftDecoys('V = approved | has approved', s, plan), { decoys: { V: 'approved | has approved' }, problems: [] });
  assert.match(shiftDecoys('X = a | b', s, plan).problems[0], /没有成分 X/);
  assert.match(shiftDecoys('O = the plans', s, plan).problems[0], /O.*没变/);
  assert.match(shiftDecoys('V: approved', s, plan).problems[0], /V = /);
});

test('M8 Aux 有中文名', () => {
  assert.equal(roleName('Aux'), '助动词');
});
