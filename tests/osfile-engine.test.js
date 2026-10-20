// 混合索引（kit/src/engines/osfile.js）：王道的 10 个直接 + 一级 + 二级 + 三级间接
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileidxEngine as A, locate, sizeText } from '../kit/src/engines/osfile.js';

test('最大文件长度、字节在哪一级、访问几次磁盘、要几个索引块', () => {
  const input = A.parse({ block: '1KB', entry: '4B', direct: 10, single: 1, double: 1, triple: 1, offset: '9000, 10240, 300000', size: '1MB' });
  const r = A.run(input);
  assert.equal(input.n, 256);
  assert.equal(r.total, 10 + 256 + 65536 + 16777216);
  assert.match(r.steps[2].msg, /10KB \+ 256KB \+ 64MB \+ 16GB/);
  assert.deepEqual(r.results.map((x) => [x.lb, x.level, x.reads]), [[8, '直接', 1], [10, '一级间接', 2], [292, '二级间接', 3]]);
  assert.deepEqual(locate(input, 292).path, [0, 26]);
  // 1MB：1024 个数据块 = 直接 10 + 一级 256 + 二级 758（1 个一级索引块 + 3 个二级索引块）
  assert.equal(r.used.idx, 5);
  assert.equal(A.variants(input).length, 2);
  assert.equal(sizeText(3 * 1024), '3KB');
  assert.throws(() => A.parse({ block: '1KB', entry: '3B' }), /整数倍/);
  assert.throws(() => A.parse({ direct: 10, single: 0, double: 0, offset: '20000' }), /超出/);
});
