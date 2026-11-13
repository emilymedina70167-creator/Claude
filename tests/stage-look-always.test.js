// 第九轮 Task 8：一直用的样子（look … always 存 meta/look，开课先叠上）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alwaysLooks, baseLooksOf, resolveLook, DEFAULT_LOOK } from '../kit/src/stage/look/spec.js';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';

test('加两条、同目标合并、reset 撤掉', () => {
  let l = alwaysLooks([], { always: [{ target: '*', props: { frame: 'none' }, hide: null }] });
  l = alwaysLooks(l, { always: [{ target: 'say', props: { text: '24' }, hide: null }] });
  l = alwaysLooks(l, { always: [{ target: '*', props: { color: 'ink' }, hide: null }] });
  assert.deepEqual(l, [{ target: '*', props: { frame: 'none', color: 'ink' }, hide: null }, { target: 'say', props: { text: '24' }, hide: null }]);
  l = alwaysLooks(l, { reset: true, targets: ['*'] });
  assert.deepEqual(l.map((x) => x.target), ['say']);
});

test('开课叠上：题卡一出来就不带框；这节课写的盖在上面', () => {
  const base = baseLooksOf([{ target: 'card', props: { frame: 'none' } }]);
  assert.equal(resolveLook([...DEFAULT_LOOK, ...base], { name: 'q', kind: 'card' }).props.frame, 'none');
  const sc = new Scene();
  for (const c of parseScript('card q = "x"\nlook q frame=card')) sc.apply(c);
  assert.equal(resolveLook([...DEFAULT_LOOK, ...base, ...sc.looks], { name: 'q', kind: 'card' }).props.frame, 'card');
});

test('look … reset always 交出要撤的目标', () => {
  const sc = new Scene();
  const fx = sc.apply(parseScript('look card reset always')[0]);
  assert.equal(fx.look.reset, true);
  assert.deepEqual(fx.look.targets, ['card']);
  assert.ok(fx.look.always);
});
