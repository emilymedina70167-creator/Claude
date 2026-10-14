// 找 Playwright：仓库不把它列进依赖（CI 只跑单元测试），本地或云端会话用全局装的那份（预装了 Chromium）。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

function load() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 本地没装，找全局的 */ }
  let root = '';
  try { root = execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { /* */ }
  try { return createRequire(join(root, 'noop.js'))('playwright'); } catch {
    throw new Error('找不到 Playwright：npm i -g playwright（云端会话里是预装的）');
  }
}

export const { chromium } = load();
