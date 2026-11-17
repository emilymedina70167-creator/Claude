// 舞台样子页的构建：main.js（剧本 scripted.js、Opus 上课 live.js，连同 kit/src/stage/）打成一个文件，页面 page.html 原样拷过去。
// dist/index.html 是发布用的（claude.ai 自己补 doctype 和 head），dist/local.html 是本地开浏览器看的
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// 舞台上的式子用 KaTeX 画：样式和字体打进页面（字体换成 woff2 的 data URI，照 kit/build.js 的 katexCssPlugin）
const katexDist = path.dirname(createRequire(import.meta.url).resolve('katex/dist/katex.min.css'));
const katexCss = () => readFileSync(path.join(katexDist, 'katex.min.css'), 'utf8').replace(/src:url\(fonts\/([\w-]+)\.woff2\)[^;}]*/g, (_, name) =>
  `src:url(data:font/woff2;base64,${readFileSync(path.join(katexDist, 'fonts', `${name}.woff2`)).toString('base64')}) format("woff2")`);
const katexCssPlugin = {
  name: 'katex-css',
  setup(b) {
    b.onResolve({ filter: /^virtual:katex-css$/ }, () => ({ path: 'katex-css', namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: katexCss(), loader: 'text' }));
  },
};

const out = 'proto/stage/dist';
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ['proto/stage/main.js'], bundle: true, minify: !process.env.DEBUG, format: 'iife',
  target: ['safari16', 'chrome110'], loader: { '.css': 'text' }, outfile: `${out}/stage-demo.js`, logLevel: 'info', plugins: [katexCssPlugin],
});
const page = readFileSync('proto/stage/page.html', 'utf8');
writeFileSync(`${out}/index.html`, page);
writeFileSync(`${out}/local.html`, `<!doctype html>\n<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n${page}\n</body></html>\n`);
