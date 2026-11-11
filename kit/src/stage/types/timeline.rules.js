// 时间轴的规则（接口见 rules.js；主线第三轮 B）。纯函数，有测试（tests/stage-timeline.test.js）。
//
// 只有手势表：学生按住小人拖到一个停靠点上（open tl.me move）、拖事件条能动的那一头（open tl.war stretch）。
// 交出去的那一行就是拨拨盘（set me 现在），交给课堂的那一下也和拨拨盘一样（type: 'dial'：课堂写「学生拨了 me：1830 → 现在」、
// 挑战每一停照判）。页面不判对错；做不做得到只有一条：条的右端不能跑到左端前面（timeline.js 的 checkVar，set 那一行自己报）。
import { itemPos } from './timeline.js';

const nameAt = (o, i) => o.stops[i - 1];
function setTo(o, scene, dial, stop, why) {
  const x = scene?.vars?.get(dial);
  if (!x) return { error: `${dial} 不在了` };
  if (!stop || stop < 1 || stop > o.stops.length) return { error: '拖到一个停靠点上' };
  if (x.v === stop) return { error: '还在原处：拖到别的停靠点上' };
  if (why) return { error: why };
  return { act: { type: 'dial', name: dial, value: nameAt(o, stop), from: nameAt(o, x.v) }, src: `set ${dial} ${nameAt(o, stop)}` };
}

const gestures = {
  // 按住小人拖到一个停靠点上
  move: {
    gesture: 'drop-at', from: 'stand', to: ['stop'], live: true, brief: '按住小人拖到一个停靠点上',
    toAct(o, { from, to, scene } = {}) {
      const it = o.items.find((x) => x.kind === 'stand' && x.name === from?.stand);
      if (!it) return { error: '按住小人再拖' };
      return setTo(o, scene, it.name, to?.stop);
    },
  },
  // 拖事件条能动的那一头（造的时候写了 start= / end= 的）
  stretch: {
    gesture: 'drop-at', from: 'end', to: ['stop'], live: true, brief: '拖事件条能动的那一头',
    toAct(o, { from, to, scene } = {}) {
      const it = o.items.find((x) => x.kind === 'bar' && x.name === from?.end);
      const dial = it && (from.side === 'from' ? it.startDial : it.endDial);
      if (!dial) return { error: '按住条能动的那一头再拖' };
      const p = itemPos(scene, o, it);
      const stop = to?.stop;
      const why = from.side === 'to' && stop < p.from ? `右端不能在左端（${nameAt(o, p.from)}）前面` : from.side === 'from' && stop > p.to ? `左端不能在右端（${nameAt(o, p.to)}）后面` : '';
      return setTo(o, scene, dial, stop, why);
    },
  },
};

export const timelineRules = { gestures };
