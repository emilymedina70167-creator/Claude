// 第八轮补：样子也由老师定（style：带不带框、多大、什么颜色、粗细、对齐）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';

const BASE = `sentence s = "The company makes a quick decision."
card q = "第 10 句" "生词：folk 人们"
label n s.3 "谓语" side=below`;
const run = (src, sc = new Scene()) => { let fx; for (const c of parseScript(src)) fx = sc.apply(c); return { sc, fx }; };
const err = (sc, line) => sc.check(parseScript(line)[0]);

test('style 存在名字上，再写一次合并', () => {
  const { sc } = run(BASE + '\nstyle say frame=on size=l\nstyle say color=brand\nstyle q n frame=off\nstyle all frame=off');
  assert.deepEqual(sc.styles.get('say'), { frame: 'on', size: 'l', color: 'brand' });
  assert.deepEqual(sc.styles.get('q'), { frame: 'off' });
  assert.deepEqual(sc.styles.get('n'), { frame: 'off' });
  assert.deepEqual(sc.styles.get('all'), { frame: 'off' });
});

test('写错当场报；大小只给字的东西', () => {
  const { sc } = run(BASE);
  assert.match(err(sc, 'style zz frame=off'), /舞台上没有「zz」/);
  assert.match(err(sc, 'style say frame=maybe'), /frame= 只能写 on \/ off/);
  assert.match(err(sc, 'style say'), /style/);
  assert.match(err(sc, 'style s size=l'), /size=/);
  assert.equal(err(sc, 'style s frame=off'), null);
  assert.equal(err(sc, 'style q size=xl color=g2'), null);
});

test('东西拿掉了它的样子跟着没了；换幕留着；clone 带着', () => {
  const { sc } = run(BASE + '\nstyle q frame=off\nstyle say frame=on');
  const c = sc.clone();
  assert.deepEqual(c.styles.get('q'), { frame: 'off' });
  run('remove q\nscene "下一幕"', sc);
  assert.equal(sc.styles.has('q'), false);
  assert.ok(sc.styles.has('say'));
});

test('现状里写一句样子', () => {
  const { sc } = run(BASE + '\nstyle say frame=on size=l\nstyle q frame=off');
  assert.match(sc.stateText(), /样子：话 带框、大字；q 不带框/);
});
