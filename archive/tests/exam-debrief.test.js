// 复盘对坑（考情第 5 批 5.4）：复盘提示词带这一块的坑表；误解那一行写 坑=…，单独读出来；守卫核坑真有
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debriefPrompt, parseDebrief, trapsTable, debriefTraps } from '../kit/src/memory/debrief.js';

const traps = [{ id: 'G-OS-3.2#t1', text: '把 FIFO 当 LRU', qs: ['Q-408-2019-26'] }];

test('提示词带坑表、写法；不提他她', () => {
  const p = debriefPrompt({ session: { id: 'c-1', block: 'OS-L3.2.1' }, transcript: '', traps });
  assert.match(p, /G-OS-3\.2#t1：把 FIFO 当 LRU（Q-408-2019-26）/);
  assert.match(p, /坑=/);
  assert.doesNotMatch(p, /[他她]/);
  assert.equal(trapsTable([]), '');
});

test('误解那一行的 坑= 单独读出来，依据照旧', () => {
  const d = parseDebrief('误解｜还在｜把先进的先换出当成最久没用的｜#12 学生写 7 0 1 坑=G-OS-3.2#t1');
  assert.equal(d.mis[0].trap, 'G-OS-3.2#t1');
  assert.equal(d.mis[0].basis, '#12 学生写 7 0 1');
  assert.equal(parseDebrief('误解｜消了｜x｜#3').mis[0].trap, undefined);
});

test('对上的坑：只认坑表里真有的（编的去掉）', () => {
  const d = parseDebrief('误解｜还在｜a｜#1 坑=G-OS-3.2#t1\n误解｜新冒出｜b｜#2 坑=G-OS-9.9#t7');
  assert.deepEqual(debriefTraps(d, new Set(['G-OS-3.2#t1'])), ['G-OS-3.2#t1']);
  assert.equal(d.mis[1].trap, undefined, '编的坑从复盘里去掉');
});
