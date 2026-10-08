// 打包成单个文件 kit/dist/la-kit.js（Claude artifact 通过 jsDelivr 加载它）
import { build } from 'esbuild';

const banner = `/*! 线代学习台 la-kit | https://github.com/emilymedina70167-creator/Claude
 *  bundles markdown-it (MIT) and KaTeX (MIT) */`;

await build({
  entryPoints: ['kit/src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['safari16', 'chrome110', 'firefox110'],
  loader: { '.css': 'text' },
  banner: { js: banner },
  outfile: 'kit/dist/la-kit.js',
  logLevel: 'info',
});
