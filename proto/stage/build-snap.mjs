// 截图试验页的构建（第九轮第一步）：snaptest.js 连同舞台打成一个文件，页面 snaptest.html 原样拷过去
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const katexDist = path.dirname(createRequire(import.meta.url).resolve('katex/dist/katex.min.css'));
const katexCss = () => readFileSync(path.join(katexDist, 'katex.min.css'), 'utf8').replace(/src:url\(fonts\/([\w-]+)\.woff2\)[^;}]*/g, (_, name) =>
  `src:url(data:font/woff2;base64,${readFileSync(path.join(katexDist, 'fonts', `${name}.woff2`)).toString('base64')}) format("woff2")`);
const katexCssPlugin = { name: 'katex-css', setup(b) {
  b.onResolve({ filter: /^virtual:katex-css$/ }, () => ({ path: 'katex-css', namespace: 'virtual' }));
  b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: katexCss(), loader: 'text' }));
} };
const out = 'proto/stage/dist/snap';
mkdirSync(out, { recursive: true });
await build({ entryPoints: ['proto/stage/snaptest.js'], bundle: true, minify: true, format: 'iife', target: ['safari16', 'chrome110'], loader: { '.css': 'text' }, outfile: `${out}/snaptest.js`, logLevel: 'warning', plugins: [katexCssPlugin] });
const page = readFileSync('proto/stage/snaptest.html', 'utf8') + '\n<script src="snaptest.js"></script>\n';
writeFileSync(`${out}/index.html`, page);
writeFileSync(`${out}/local.html`, `<!doctype html>\n<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n${page}\n</body></html>\n`);
