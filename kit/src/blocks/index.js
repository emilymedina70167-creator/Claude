import { transform2d } from './transform2d.js';
import { vectors } from './vectors.js';
import { rref } from './rref.js';
import { matmul } from './matmul.js';
import { quiz } from './quiz.js';
import { callouts, folds, card, context } from './content.js';
import { scene } from './scene.js';
import { predict } from './predict.js';
import { answer } from './answer.js';
import { conjecture } from './conjecture.js';
import { practice } from './practice.js';
import { summary } from './summary.js';
import { draft } from './draft.js';
import { array, shellsort, sortpass } from './sorting.js';
import { steps } from './steps.js';
import { recognize } from './recognize.js';
import { findbug } from './findbug.js';
import { graph, space } from './figures.js';
import { letBlock } from './letblock.js';
import { matrix } from './matrix.js';
import { sketch } from './sketch.js';
import { derive } from './derive.js';
import { image } from './image.js';
import { code } from './code.js';
import { stepperBlock } from '../stepper.js';
import { sortEngine } from '../engines/sort.js';
import { treeEngine } from '../engines/tree.js';
import { kmpEngine, hashEngine, bsearchEngine } from '../engines/search.js';
import { netEngine } from '../engines/graph.js';
import { traceEngine } from '../engines/trace.js';
import { schedEngine, pagingEngine, bankerEngine, diskEngine } from '../engines/os.js';
import { addrEngine } from '../engines/addr.js';
import { bitsEngine, cacheEngine, pipeEngine } from '../engines/co.js';
import { subnetEngine, tcpEngine, windowEngine } from '../engines/net4.js';
import { framesEngine } from '../engines/frames.js';
import { elimEngine } from '../engines/elim.js';
import { elimDo } from './elimdo.js';
import { parseFields } from '../parse.js';
import { detEngine } from '../engines/det.js';
import { eigEngine, schmidtEngine } from '../engines/eig.js';
import { quadEngine } from '../engines/quad.js';
import { crcEngine, hammingEngine } from '../engines/codes.js';
import { allocEngine } from '../engines/osmem.js';
import { memexpEngine } from '../engines/comem.js';
import { faddEngine } from '../engines/cofloat.js';
import { fileidxEngine } from '../engines/osfile.js';
import { fragEngine } from '../engines/netfrag.js';

// 代码块语言名 → 组件
export const blocks = {
  transform2d, vectors, rref, matmul, quiz, card, ...callouts, ...folds,
  scene, predict, answer, conjecture, practice, summary, context, draft,
  array, shellsort, sortpass, steps, recognize, findbug, graph, space,
  let: letBlock, matrix, sketch, derive, image, code,
  // 一步步走的演示（stepper.js 外壳 + engines/ 里的纯函数引擎）
  sort: stepperBlock(sortEngine),
  tree: stepperBlock(treeEngine),
  kmp: stepperBlock(kmpEngine),
  hash: stepperBlock(hashEngine),
  bsearch: stepperBlock(bsearchEngine),
  net: stepperBlock(netEngine),
  trace: stepperBlock(traceEngine),
  sched: stepperBlock(schedEngine),
  paging: stepperBlock(pagingEngine),
  banker: stepperBlock(bankerEngine),
  disk: stepperBlock(diskEngine),
  addr: stepperBlock(addrEngine),
  bits: stepperBlock(bitsEngine),
  cache: stepperBlock(cacheEngine),
  pipe: stepperBlock(pipeEngine),
  subnet: stepperBlock(subnetEngine),
  tcp: stepperBlock(tcpEngine),
  window: stepperBlock(windowEngine),
  frames: stepperBlock(framesEngine),
  elim: elimBlock(),
  det: stepperBlock(detEngine),
  eig: stepperBlock(eigEngine),
  schmidt: stepperBlock(schmidtEngine),
  quad: stepperBlock(quadEngine),
  crc: stepperBlock(crcEngine),
  hamming: stepperBlock(hammingEngine),
  alloc: stepperBlock(allocEngine),
  memexp: stepperBlock(memexpEngine),
  fadd: stepperBlock(faddEngine),
  fileidx: stepperBlock(fileidxEngine),
  frag: stepperBlock(fragEngine),
};

// elim：mode: do 是学生自己做行变换（blocks/elimdo.js），其余照演示组件（演示 / quiz / fill）
function elimBlock() {
  const demo = stepperBlock(elimEngine);
  const f = (el, src) => (/^do$/i.test(String(parseFields(src).fields.mode ?? '').trim()) ? elimDo(el, src) : demo(el, src));
  f.stepper = true;
  return f;
}
