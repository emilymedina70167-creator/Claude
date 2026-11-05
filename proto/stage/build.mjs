// 舞台样子页的构建：demo.js（连同 kit/src/stage/）打成一个文件，页面 page.html 原样拷过去。
// dist/index.html 是发布用的（claude.ai 自己补 doctype 和 head），dist/local.html 是本地开浏览器看的
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = 'proto/stage/dist';
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ['proto/stage/demo.js'], bundle: true, minify: !process.env.DEBUG, format: 'iife',
  target: ['safari16', 'chrome110'], loader: { '.css': 'text' }, outfile: `${out}/stage-demo.js`, logLevel: 'info',
});
const page = readFileSync('proto/stage/page.html', 'utf8');
writeFileSync(`${out}/index.html`, page);
writeFileSync(`${out}/local.html`, `<!doctype html>\n<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n${page}\n</body></html>\n`);
