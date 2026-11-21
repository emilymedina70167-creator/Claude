// 视觉交互第 5 批 Task 8：英语示例页和手册里的层次图、分裂结构、parallel、shift 照抄就能用；英语的课拿得到它们的写法
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBrackets, parseParallel } from '../kit/src/entext.js';
import { parseShift, shiftFieldProblems } from '../kit/src/enshift.js';
import { parseFields } from '../kit/src/parse.js';
import { docsForSubject, componentDoc } from '../kit/src/subject.js';

const manual = readFileSync('CLAUDE-PROJECT.md', 'utf8');
const third = manual.slice(manual.indexOf('## 三、组件参考'), manual.indexOf('\n## 四、'));
const blocksIn = (text) => [...text.matchAll(/```(parse|parallel|shift)\n([\s\S]*?)```/g)].map((m) => ({ kind: m[1], src: m[2], fields: parseFields(m[2]).fields }));
const demo = blocksIn(readFileSync('kit/examples/en2-demo.html', 'utf8'));
// board check 里的探题（写 key:）是另一种写法，不在这里核
const inManual = blocksIn(third).filter((b) => !b.fields.key);
// 方括号最多套几层
const depthOf = (src) => { let d = 0, max = 0; for (const c of String(src)) { if (c === '[') max = Math.max(max, ++d); else if (c === ']') d--; } return max; };

// 每一种照页面的读法读一遍：读不懂就抛错
function read(b) {
  const f = b.fields;
  if (b.kind === 'parse') {
    const p = parseBrackets(f.answer);
    if (/^join$/i.test(f.ask || '')) assert.ok(p.spans.some((s) => s.join), `${f.id}：ask: join 要有 ~n`);
    return p;
  }
  if (b.kind === 'parallel') {
    const p = parseParallel(f.text);
    if (f.ask === 'odd') assert.ok(Number(f.answer) >= 1 && Number(f.answer) <= p.items.length, `${f.id}：answer 在 1 到 ${p.items.length}`);
    return p;
  }
  assert.deepEqual(shiftFieldProblems(f), [], `${f.id}：字段`);
  return parseShift({ from: f.from, to: f.to });
}

test('示例页：至少 16 张，每张都读得懂，编号不重', () => {
  assert.ok(demo.length >= 16, `只有 ${demo.length} 张`);
  for (const b of demo) assert.doesNotThrow(() => read(b), `${b.fields.id}`);
  const ids = demo.map((b) => b.fields.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('示例页按考纲：第三节英语表里第 5 批要盖住的每一行至少两张', () => {
  const n = (pred) => demo.filter(pred).length;
  const deep = (b) => b.kind === 'parse' && depthOf(b.fields.answer) >= 4; // 主语里套从句、从句里再套从句（再带一层成分）
  assert.ok(n((b) => b.kind === 'parse' && /\[(SC|ObC|PC|RC|AdvC)\b/.test(b.fields.answer)) >= 2, '三大从句');
  assert.ok(n(deep) >= 2, '嵌套结构（套三层以上）');
  assert.ok(n((b) => b.kind === 'parse' && /\[(App|AppC|Par)\b/.test(b.fields.answer)) >= 2, '同位语、插入语');
  assert.ok(n((b) => b.kind === 'parse' && /~\d/.test(b.fields.answer)) >= 2, '分裂结构');
  assert.ok(n((b) => b.kind === 'parallel') >= 2 && n((b) => b.kind === 'parallel' && b.fields.ask) >= 2, '并列、平行结构');
  assert.ok(n((b) => b.kind === 'shift' && /by /.test(b.fields.to + b.fields.from)) >= 2, '语态：主动变被动');
  assert.ok(n((b) => b.kind === 'shift' && /^It was/.test(b.fields.to)) >= 2, '强调句');
  assert.ok(n((b) => b.kind === 'shift' && /倒装/.test(b.fields.title)) >= 2, '倒装');
  assert.ok(n((b) => b.fields.mode === 'do' || (b.kind !== 'shift' && b.fields.mode !== 'show') || b.fields.ask) >= 10, '要学生动手的占多数');
});

test('手册里的例子照抄就能用，新写法都写到了', () => {
  for (const k of ['parse', 'parallel', 'shift']) assert.ok(inManual.some((b) => b.kind === k), `手册里有 ${k} 的例子`);
  for (const b of inManual) assert.doesNotThrow(() => read(b), `手册 ${b.fields.id}`);
  for (const w of ['view: layers', 'view: line', '~n', 'ask: join', '`Par`', '`Emp`', 'ask: starts', 'ask: odd', 'fix:', 'decoys:', 'from:', 'to:', 'mode: do', 'figure set step=']) assert.ok(third.includes(w), `手册里没写 ${w}`);
});

test('英语的课拿得到 parallel、shift；线代、计算机的课拿不到', () => {
  const en = docsForSubject(third, '英语');
  for (const k of ['parallel', 'shift']) {
    assert.match(en, new RegExp(`### ${k}：`));
    assert.ok(componentDoc(third, k, '英语').length > 300, `${k} 的完整写法取得到`);
    assert.doesNotMatch(docsForSubject(third, '线代'), new RegExp(`### ${k}：`));
    assert.doesNotMatch(docsForSubject(third, '数据结构'), new RegExp(`### ${k}：`));
  }
  // parse 的完整写法里有层次图、分裂结构
  assert.match(componentDoc(third, 'parse', '英语'), /ask: join/);
});
