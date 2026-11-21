// 演示组件的名字 → 引擎（纯函数，不碰 DOM）。blocks/index.js 用它注册组件，
// practice 的 use:（演示组件当练习题）、测试也按名字找引擎。elim、pv 另有学生自己动手的写法，组件在 blocks/index.js 里分流
import { sortEngine } from './sort.js';
import { treeEngine } from './tree.js';
import { kmpEngine, hashEngine, bsearchEngine, blocksearchEngine } from './search.js';
import { netEngine } from './graph.js';
import { traceEngine } from './trace.js';
import { schedEngine, pagingEngine, bankerEngine, diskEngine } from './os.js';
import { addrEngine } from './addr.js';
import { bitsEngine, cacheEngine, pipeEngine } from './co.js';
import { subnetEngine, tcpEngine, windowEngine } from './net4.js';
import { framesEngine } from './frames.js';
import { elimEngine } from './elim.js';
import { pvEngine } from './pv.js';
import { detEngine } from './det.js';
import { eigEngine, schmidtEngine } from './eig.js';
import { quadEngine } from './quad.js';
import { crcEngine, hammingEngine } from './codes.js';
import { allocEngine } from './osmem.js';
import { memexpEngine } from './comem.js';
import { faddEngine } from './cofloat.js';
import { mulEngine } from './comul.js';
import { asmEngine } from './coasm.js';
import { divEngine } from './codiv.js';
import { fileidxEngine } from './osfile.js';
import { pagetableEngine } from './ospt.js';
import { fragEngine } from './netfrag.js';
import { encodeEngine } from './netcode.js';
import { huffmanEngine } from './huffman.js';
import { ufEngine } from './uf.js';
import { buildtreeEngine } from './buildtree.js';
import { threadEngine } from './thread.js';
import { forestEngine } from './forest.js';
import { storeEngine } from './store.js';
import { dequeEngine } from './deque.js';
import { slistEngine } from './slist.js';
import { avlEngine, rbtEngine } from './balanced.js';
import { btreeEngine } from './btree.js';
import { stackEngine } from './stack.js';
import { cqueueEngine } from './cqueue.js';
import { compressEngine } from './compress.js';
import { extsortEngine } from './extsort.js';
import { memEngine } from './osvm.js';
import { bitmapEngine } from './osbitmap.js';
import { deadlockEngine } from './osdeadlock.js';
import { eaEngine } from './coea.js';
import { opcodeEngine } from './coopcode.js';
import { layoutEngine } from './colayout.js';
import { irqEngine } from './coirq.js';
import { csmaEngine, switchEngine } from './netmac.js';
import { dvEngine } from './netdv.js';
import { utilEngine, rttEngine } from './netperf.js';

export const ENGINES = {
  sort: sortEngine,
  tree: treeEngine,
  kmp: kmpEngine,
  hash: hashEngine,
  bsearch: bsearchEngine,
  blocksearch: blocksearchEngine,
  net: netEngine,
  trace: traceEngine,
  sched: schedEngine,
  paging: pagingEngine,
  banker: bankerEngine,
  disk: diskEngine,
  addr: addrEngine,
  bits: bitsEngine,
  cache: cacheEngine,
  pipe: pipeEngine,
  subnet: subnetEngine,
  tcp: tcpEngine,
  window: windowEngine,
  frames: framesEngine,
  det: detEngine,
  eig: eigEngine,
  schmidt: schmidtEngine,
  quad: quadEngine,
  crc: crcEngine,
  hamming: hammingEngine,
  alloc: allocEngine,
  memexp: memexpEngine,
  fadd: faddEngine,
  mul: mulEngine,
  asm: asmEngine,
  div: divEngine,
  fileidx: fileidxEngine,
  pagetable: pagetableEngine,
  frag: fragEngine,
  encode: encodeEngine,
  huffman: huffmanEngine,
  uf: ufEngine,
  buildtree: buildtreeEngine,
  thread: threadEngine,
  forest: forestEngine,
  store: storeEngine,
  deque: dequeEngine,
  slist: slistEngine,
  avl: avlEngine,
  rbt: rbtEngine,
  btree: btreeEngine,
  stack: stackEngine,
  cqueue: cqueueEngine,
  compress: compressEngine,
  extsort: extsortEngine,
  mem: memEngine,
  bitmap: bitmapEngine,
  deadlock: deadlockEngine,
  ea: eaEngine,
  opcode: opcodeEngine,
  layout: layoutEngine,
  irq: irqEngine,
  csma: csmaEngine,
  dv: dvEngine,
  switch: switchEngine,
  util: utilEngine,
  rtt: rttEngine,
  elim: elimEngine,
  pv: pvEngine,
};
