// 第九轮 Task 2：look 的写法（目标、属性档、合并顺序、默认样式表），场景里存、现状里写
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { resolveLook, DEFAULT_LOOK } from '../kit/src/stage/look/spec.js';

const BASE = `sentence s = "The company makes a quick decision."
card q = "第 10 句" "生词：folk 人们"
card r = "另一张"
label n s.3 "谓语" side=below`;
const run = (src, sc = new Scene()) => { let fx; for (const c of parseScript(src)) fx = sc.apply(c); return { sc, fx }; };
const err = (sc, line) => sc.check(parseScript(line)[0]);
const look = (sc, name, kind, part) => resolveLook([...DEFAULT_LOOK, ...sc.looks], { name, kind, part }).props;

test('look 存在目标上，后写的盖前写的', () => {
  const { sc } = run(BASE + '\nlook say frame=none text=24\nlook say color=brand');
  assert.deepEqual(look(sc, 'say'), { frame: 'none', text: '24', color: 'brand' });
});

test('合并顺序：* < 种类 < 具体的 < 部件', () => {
  const { sc } = run(BASE + '\nlook q frame=card\nlook * frame=none\nlook card bg=soft\nlook s.3 color=g2\nlook s color=ink');
  assert.equal(look(sc, 'q', 'card').frame, 'card', '具体的盖过 *（哪怕 * 写在后面）');
  assert.equal(look(sc, 'r', 'card').frame, 'none');
  assert.equal(look(sc, 'r', 'card').bg, 'soft');
  assert.equal(look(sc, 's', 'sentence', 's.3').color, 'g2');
  assert.equal(look(sc, 's', 'sentence', 's.4').color, 'ink');
  assert.equal(look(sc, 'say').frame, 'none');
});

test('默认样式表：话不带框', () => {
  const { sc } = run(BASE);
  assert.equal(look(sc, 'say').frame, 'none');
  run('look say frame=card', sc);
  assert.equal(look(sc, 'say').frame, 'card');
});

test('写错当场报', () => {
  const { sc } = run(BASE);
  assert.match(err(sc, 'look zz frame=none'), /舞台上没有「zz」/);
  assert.match(err(sc, 'look say frame=maybe'), /frame= 只能写 none \/ line \/ card/);
  assert.match(err(sc, 'look say text=200'), /text= 写 10 到 64/);
  assert.match(err(sc, 'look say opacity=0.1'), /opacity= 写 0.2 到 1/);
  assert.match(err(sc, 'look say'), /look/);
  assert.match(err(sc, 'look q frame=none always'), /always 只收种类名和 say \/ goals \/ dock \/ bar \/ \*/);
  assert.equal(err(sc, 'look s.3 color=g2 weight=bold'), null);
});

test('hide / show、always、reset', () => {
  const { sc, fx } = run(BASE + '\nlook goals hide\nlook * frame=none always');
  assert.equal(resolveLook([...DEFAULT_LOOK, ...sc.looks], { name: 'goals' }).hide, true);
  assert.deepEqual(fx.look.always, [{ target: '*', props: { frame: 'none' }, hide: null }]);
  run('look goals show', sc);
  assert.equal(resolveLook(sc.looks, { name: 'goals' }).hide, false);
  const r = run('look * reset always', sc).fx;
  assert.equal(r.look.reset, true);
  assert.equal(look(sc, 'r', 'card').frame, undefined, 'reset 撤掉 * 上的');
});

test('东西拿掉了指着它的样子跟着没；clone 带着；现状写一句', () => {
  const { sc } = run(BASE + '\nlook q frame=none\nlook say frame=card text=24\nlook s.3 color=g2');
  assert.match(sc.stateText(), /样子：q 不带框；话 卡片、字 24；s\.3 g2 色/);
  const c = sc.clone();
  assert.equal(c.looks.length, sc.looks.length);
  run('remove q\nremove s', sc);
  assert.equal(sc.looks.some((l) => l.target === 'q' || l.target === 's.3'), false);
});

test('style 照旧收（换成等价的 look）', () => {
  const { sc } = run(BASE + '\nstyle say frame=on size=l\nstyle q frame=off');
  assert.deepEqual(look(sc, 'say'), { frame: 'card', text: '24' });
  assert.equal(look(sc, 'q', 'card').frame, 'none');
});

test('旧课的 log（place、pos、style）放回不报错', () => {
  const sc = new Scene();
  for (const c of parseScript(BASE + '\nplace s main\npos s=10,20\nstyle q frame=off')) sc.apply({ ...c, lenient: true, replay: true });
  assert.ok(sc.objects.has('s'));
});
