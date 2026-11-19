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
import { cloze, errfind, parse, drill, chunk, link as enLink, translate } from './english.js';
import { gloss } from './gloss.js';
import { stage } from './stagebox.js';
import { widgetBlock } from './widget.js';
import { solve } from './solve.js';
import { previewBlock } from '../check/preview.js';
import { stepperBlock } from '../stepper.js';
import { ENGINES } from '../engines/registry.js';
import { elimEngine } from '../engines/elim.js';
import { elimDo } from './elimdo.js';
import { parseFields } from '../parse.js';
import { pvBlock } from './pvdo.js';
import { encodeDo } from './encodedo.js';

// 代码块语言名 → 组件
export const blocks = {
  transform2d, vectors, rref, matmul, quiz, card, ...callouts, ...folds,
  scene, predict, answer, conjecture, practice, summary, context, draft,
  array, shellsort, sortpass, steps, recognize, findbug, graph, space,
  let: letBlock, matrix, sketch, derive, image, code,
  // 英语（语法）：填空、改错、句子成分、句型操练（判分在 entext.js）
  cloze, errfind, parse, drill, chunk, link: enLink, translate, gloss,
  // 黑板上的一块舞台（2026-11-18 从 archive/ 恢复的舞台引擎）：外部主讲写镜头指令，学生动手、挑战当场判、预写当场演
  stage,
  // 外部设计的交互：一小段 JS 调 la.*（blocks/widget.js）
  widget: widgetBlock,
  // 解答题：按步骤判（blocks/solve.js，dr-batch4）
  solve,
  // 检验题（二类组件，check/）：单独写在板上只画预览，放进 board check 才能作答
  recall: previewBlock('recall'),
  construct: previewBlock('construct'),
  claim: previewBlock('claim'),
  discriminate: previewBlock('discriminate'),
  locate: previewBlock('locate'),
  // 408、英语的检验题里只有这三种单独写在板上画预览；trace predict code parse translate errfind 单独写照旧是一类组件
  tradeoff: previewBlock('tradeoff'),
  rewrite: previewBlock('rewrite'),
  calc: previewBlock('calc'),
  // 一步步走的演示（stepper.js 外壳 + engines/ 里的纯函数引擎，名字在 engines/registry.js）
  ...Object.fromEntries(Object.entries(ENGINES).filter(([k]) => k !== 'elim' && k !== 'pv').map(([k, e]) => [k, stepperBlock(e)])),
  elim: elimBlock(),
  // encode：mode: do 是学生自己画波形（blocks/encodedo.js）
  encode: doBlock(ENGINES.encode, encodeDo),
  // 进程同步：信号量 P/V（写了 run: 是演示；没写是学生自己点进程，blocks/pvdo.js）
  pv: pvBlock(),
};

// elim：mode: do 是学生自己做行变换（blocks/elimdo.js），其余照演示组件（演示 / quiz / fill）
function elimBlock() {
  const demo = stepperBlock(elimEngine);
  const f = (el, src, opts) => (/^do$/i.test(String(parseFields(src).fields.mode ?? '').trim()) ? elimDo(el, src) : demo(el, src, opts));
  f.stepper = true;
  return f;
}

// 别的有「学生自己动手」写法的演示组件：mode: do 走自己的画面，其余照演示组件
function doBlock(engine, doFn) {
  const demo = stepperBlock(engine);
  const f = (el, src, opts) => (/^do$/i.test(String(parseFields(src).fields.mode ?? '').trim()) ? doFn(el, src) : demo(el, src, opts));
  f.stepper = true;
  return f;
}
