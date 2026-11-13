// 第九轮第 2 批：课上接上旁听（kit/src/aide/watcher.js、stage/doc.js 的 turnMessage）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatcher } from '../kit/src/aide/watcher.js';
import { turnMessage } from '../kit/src/stage/doc.js';

const ok = { ended: false, flight: null, spec: null, canPlay: true, pending: '', upTo: 2 };
const tick = () => new Promise((r) => setTimeout(r, 0));

test('能开时发一次；在跑时不发第二个；同一个样子不重发', async () => {
  let n = 0;
  let release;
  const call = () => { n++; return new Promise((r) => { release = () => r({ text: '以前｜x', modelApplied: 'claude-opus-5-5' }); }); };
  const w = createWatcher({ call, material: () => 'p', check: (t) => ({ lines: [{ kind: '以前', text: t.slice(3) }], dropped: [] }), record: () => {} });
  w.kick(ok); w.kick(ok);
  assert.equal(n, 1);
  release(); await tick(); await tick();
  assert.equal(w.note().lines[0].text, 'x');
  assert.equal(w.note().upTo, 2);
  w.kick(ok);
  assert.equal(n, 1, '学生、老师都没新动作：不重发');
  w.kick({ ...ok, pending: '又拖了一下' });
  assert.equal(n, 2);
});

test('不能开的时候不发', () => {
  let n = 0;
  const w = createWatcher({ call: () => { n++; return Promise.resolve({}); }, material: () => 'p', check: () => ({ lines: [] }), record: () => {} });
  w.kick({ ...ok, spec: {} }); w.kick({ ...ok, flight: {} }); w.kick({ ...ok, canPlay: false });
  assert.equal(n, 0);
});

test('回的不是 Opus、出错：note 还是旧的，记一条', async () => {
  const rows = [];
  let mode = 'sonnet';
  const call = () => (mode === 'throw' ? Promise.reject(new Error('断了')) : Promise.resolve({ text: '以前｜y', modelApplied: 'claude-sonnet-5-5' }));
  const w = createWatcher({ call, material: () => 'p', check: () => ({ lines: [{ kind: '以前', text: 'y' }], dropped: [] }), record: (r) => rows.push(r) });
  w.set({ upTo: 1, lines: [{ kind: '以前', text: '旧的' }] });
  w.kick(ok); await tick(); await tick();
  assert.equal(w.note().lines[0].text, '旧的');
  mode = 'throw';
  w.kick({ ...ok, upTo: 3 }); await tick(); await tick();
  assert.equal(w.note().lines[0].text, '旧的');
  assert.ok(rows.length >= 2 && rows.every((r) => r.error));
});

test('turnMessage：没有旁听那一节时和以前一字不差；有就放在舞台现在前面', () => {
  const base = { act: '点了 a.3', state: '一排格子' };
  assert.equal(turnMessage({ ...base, aide: '' }), turnMessage(base));
  const m = turnMessage({ ...base, aide: '[助手看到的]（看到第 2 轮为止）\n- 以前：x' });
  assert.ok(m.indexOf('[助手看到的]') < m.indexOf('[舞台现在]'));
});
