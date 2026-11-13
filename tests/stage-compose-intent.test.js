// 第八轮：构图意图（place、say at= / near=、preview）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';

const BASE = `sentence s = "He had never gambled before."
array gl = 1 2 3
array A = 1 2
array B = 3 4`;
const run = (src, s = new Scene()) => { let fx; for (const c of parseScript(src)) fx = s.apply(c); return { s, fx }; };
const err = (s, line) => s.check(parseScript(line)[0]);

test('place 存成关系；同一样再写 place 换掉', () => {
  const { s } = run(BASE + '\nplace gl right-of s align=top');
  assert.deepEqual(s.layout.get('gl'), [{ kind: 'right-of', a: 'gl', b: 's', align: 'top' }]);
  run('place gl below s', s);
  assert.deepEqual(s.layout.get('gl'), [{ kind: 'below', a: 'gl', b: 's' }]);
});

test('row / col 存在第一个名字上', () => {
  const { s } = run(BASE + '\nplace A B row gap=l');
  assert.deepEqual(s.layout.get('A'), [{ kind: 'row', a: ['A', 'B'], gap: 'l' }]);
});

test('main、at=、weight=', () => {
  const { s } = run(BASE + '\nplace s main weight=strong\nplace gl at=6,4-40,12');
  assert.deepEqual(s.layout.get('s'), [{ kind: 'main', a: 's', weight: 'strong' }]);
  assert.deepEqual(s.layout.get('gl'), [{ kind: 'at', a: 'gl', at: { c0: 6, r0: 4, c1: 40, r1: 12 } }]);
});

test('remove 以后指着它的关系都没了', () => {
  const { s } = run(BASE + '\nplace gl right-of s\nplace A B row\nplace s main');
  run('remove s', s);
  assert.equal(s.layout.has('gl'), false);
  assert.equal(s.layout.has('s'), false);
  run('remove B', s);
  assert.equal(s.layout.has('A'), false, 'row 只剩一样就不算了');
});

test('写错当场报', () => {
  const { s } = run(BASE);
  assert.match(err(s, 'place zz main'), /place 写的「zz」舞台上没有/);
  assert.match(err(s, 'place gl right-of zz'), /place 写的「zz」舞台上没有/);
  assert.match(err(s, 'place gl at=40,4-6,12'), /at= 写成 6,4-40,12/);
  assert.match(err(s, 'place gl A right-of s'), /right-of 前面写一样东西/);
  assert.match(err(s, 'place gl'), /place/);
  assert.match(err(s, 'place gl right-of s gap=xl'), /gap=/);
  assert.match(err(s, 'place gl near s.zz'), /zz|s\.zz/);
  assert.equal(err(s, 'place gl near s.2'), null);
});

test('say near= / at= 存在 say 上；preview 演得上', () => {
  const { s } = run(BASE + '\nsay "看这里" near=s.2');
  assert.deepEqual(s.layout.get('say'), [{ kind: 'near', a: 'say', b: 's.2' }]);
  run('say "下一句"', s);
  assert.equal(s.layout.has('say'), false, '不写就照默认贴');
  const { fx } = run('preview', s);
  assert.equal(fx.preview, true);
});

test('scene 换幕：拿下的东西的关系、话的位置都清掉，keep 的留着', () => {
  const { s } = run(BASE + '\nplace gl right-of s\nplace s main\nsay "x" near=s.2\nscene "下一幕" keep=s');
  assert.equal(s.layout.has('gl'), false);
  assert.equal(s.layout.has('say'), false);
  assert.ok(s.layout.has('s'));
});

test('clone 带着构图', () => {
  const { s } = run(BASE + '\nplace gl right-of s');
  const c = s.clone();
  assert.deepEqual(c.layout.get('gl'), s.layout.get('gl'));
  c.layout.delete('gl');
  assert.ok(s.layout.has('gl'));
});
