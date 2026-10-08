import { transform2d } from './transform2d.js';
import { vectors } from './vectors.js';
import { rref } from './rref.js';
import { matmul } from './matmul.js';
import { quiz } from './quiz.js';
import { callouts, folds, card } from './content.js';

// 代码块语言名 → 组件
export const blocks = { transform2d, vectors, rref, matmul, quiz, card, ...callouts, ...folds };
