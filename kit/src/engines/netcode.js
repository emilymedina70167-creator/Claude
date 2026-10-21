// 计算机网络的编码波形：encode（NRZ、NRZI、曼彻斯特、差分曼彻斯特；编码画波形，或者看波形读出比特）。
// 口径按王道 / 谢希仁：曼彻斯特每一位中间都跳变，默认 1 是中间向下跳（前高后低）、0 是向上跳（`manchester: 1=up` 反过来）；
// 差分曼彻斯特中间也都跳变，位开始处有跳变是 0、没有是 1；NRZI 电平翻转是 0、不变是 1。电平：1 高、0 低。
// 纯函数（tests/netcode-engine.test.js）。

const NAMES = { nrz: '不归零 NRZ', nrzi: '反向不归零 NRZI', manchester: '曼彻斯特', diffman: '差分曼彻斯特' };
const ALIAS = { nrz: 'nrz', 不归零: 'nrz', nrzi: 'nrzi', 反向不归零: 'nrzi', manchester: 'manchester', 曼彻斯特: 'manchester', diffman: 'diffman', 差分曼彻斯特: 'diffman', 'diff-manchester': 'diffman' };
const LEVEL = { 1: '高', 0: '低' };
const SHORT = { nrz: 'NRZ', nrzi: 'NRZI', manchester: '曼彻斯特', diffman: '差分曼彻斯特' };

// 一位位编出来：每位两个半码元的电平 [前, 后]。prev：上一位后半的电平（开头用 start）
export function encodeBits(bits, code, { start = 0, up = false, mistake = '' } = {}) {
  let p = start;
  return bits.map((b) => {
    let h;
    if (code === 'nrz') h = [b, b];
    else if (code === 'nrzi') { const flip = mistake === 'nrziOne' ? b === 1 : b === 0; const v = flip ? 1 - p : p; h = [v, v]; }
    else if (code === 'manchester') { const one = mistake === 'flip' ? !up : up; h = (b === 1) !== one ? [1, 0] : [0, 1]; }
    else { const jump = mistake === 'diffInvert' ? b === 1 : b === 0; const a = jump ? 1 - p : p; h = [a, 1 - a]; }
    p = h[1];
    return h;
  });
}
// 反过来：半码元电平 → 比特
export function decodeLevels(halves, code, { start = 0, up = false, mistake = '' } = {}) {
  let p = start;
  return halves.map(([a, b]) => {
    let bit;
    if (code === 'nrz') bit = a;
    else if (code === 'nrzi') bit = (a !== p) === (mistake === 'nrziOne') ? 1 : 0;
    else if (code === 'manchester' || mistake === 'asMan') { const down = a === 1 && b === 0; bit = down !== (mistake === 'flip' ? !up : up) ? 1 : 0; }
    else bit = (a !== p) === (mistake === 'diffInvert') ? 1 : 0;
    p = b;
    return bit;
  });
}

const codeOf = (s) => {
  const k = ALIAS[String(s).trim().toLowerCase()];
  if (!k) throw new Error(`code: 写 nrz、nrzi、manchester（曼彻斯特）或 diffman（差分曼彻斯特）（现在是「${s}」）`);
  return k;
};
// 「10 01 10」「HL LH HL」「高低 低高」→ [[1,0],[0,1],[1,0]]
function parseHalves(src) {
  const s = String(src ?? '').toUpperCase().replace(/H|高/g, '1').replace(/L|低/g, '0').replace(/[^01]/g, '');
  if (!s || s.length % 2) throw new Error(`levels: 每一位写两个半码元的电平（1 / H / 高，0 / L / 低），比如 levels: 10 01 10（现在是「${src}」）`);
  if (s.length > 32) throw new Error('levels: 最多 16 位');
  return Array.from({ length: s.length / 2 }, (_, i) => [Number(s[2 * i]), Number(s[2 * i + 1])]);
}

function parse(fields) {
  const codes = String(fields.code ?? 'manchester').split(/[,，、\s]+/).filter(Boolean).map(codeOf);
  if (codes.length > 4) throw new Error('code: 最多 4 种');
  const start = /^(high|高|1)$/i.test(String(fields.start ?? 'low').trim()) ? 1 : 0;
  const up = /^1\s*=\s*up$|^1\s*=\s*上/i.test(String(fields.manchester ?? '').replace(/\s+/g, ''));
  let bits = null, halves = null;
  if (fields.levels !== undefined) {
    if (codes.length > 1) throw new Error('levels:（看波形读比特）时 code: 只写一种');
    halves = parseHalves(fields.levels);
    if (codes[0] === 'manchester' || codes[0] === 'diffman') for (const [i, [a, b]] of halves.entries()) if (a === b) throw new Error(`levels: 第 ${i + 1} 位中间没有跳变，不是${NAMES[codes[0]]}`);
    if (codes[0] === 'nrz' || codes[0] === 'nrzi') for (const [i, [a, b]] of halves.entries()) if (a !== b) throw new Error(`levels: 第 ${i + 1} 位中间跳变了，不是${NAMES[codes[0]]}（不归零一位里电平不变）`);
  } else {
    const s = String(fields.bits ?? '').replace(/[\s_]/g, '');
    if (!/^[01]{1,16}$/.test(s)) throw new Error(`bits: 写要编码的比特（0 和 1，最多 16 位），或者写 levels: 看波形读比特（现在是「${fields.bits ?? ''}」）`);
    bits = [...s].map(Number);
  }
  const rate = fields.rate !== undefined ? String(fields.rate).trim() : null;
  if (rate !== null && !/^\d+(\.\d+)?\s*[KMG]?(b\/s|bps)$/i.test(rate)) throw new Error(`rate: 写数据率，比如 10Mb/s（现在是「${rate}」）`);
  return { codes, start, up, bits, halves, rate, mistake: '' };
}

const ruleText = (code, up) => ({
  nrz: '1 是高电平、0 是低电平，一位里不变',
  nrzi: '0 让电平翻转、1 保持不变',
  manchester: up ? '每位中间都跳变：1 是向上跳（前低后高），0 是向下跳（前高后低）' : '每位中间都跳变：1 是向下跳（前高后低），0 是向上跳（前低后高）',
  diffman: '每位中间都跳变；位开始处有跳变是 0，没有跳变是 1',
}[code]);
const pair = (h) => `${LEVEL[h[0]]}${LEVEL[h[1]]}`;

function run(input) {
  const { codes, start, up, mistake } = input;
  const steps = [];
  if (input.halves) {
    // 看波形读比特
    const code = codes[0];
    const bits = decodeLevels(input.halves, code, { start, up, mistake });
    const right = decodeLevels(input.halves, code, { start, up });
    steps.push({ view: { n: 0, decode: true }, msg: `这是${NAMES[code]}的波形（${ruleText(code, up)}${code === 'nrzi' || code === 'diffman' ? `，开始之前是${LEVEL[start]}电平` : ''}）。一位一位读出比特。` });
    input.halves.forEach((h, i) => {
      const prev = i ? input.halves[i - 1][1] : start;
      const why = code === 'nrz' ? `${LEVEL[h[0]]}电平` : code === 'nrzi' ? (h[0] !== prev ? '电平翻转了' : '电平没变') : code === 'manchester' ? `中间${h[0] === 1 ? '向下' : '向上'}跳` : `位开始处${h[0] !== prev ? '有' : '没有'}跳变`;
      steps.push({ view: { n: i + 1, decode: true, cur: i }, msg: `第 ${i + 1} 位：${why}，是 ${right[i]}。`, ask: { tag: 'bit', kind: 'choice', q: `第 ${i + 1} 位是几？`, choices: ['0', '1'], answer: String(bits[i]) } });
    });
    steps.push({ view: { n: input.halves.length, decode: true, done: true }, msg: `读出来是 ${right.join('')}。` });
    return { steps, bits: right, halves: input.halves };
  }
  const waves = Object.fromEntries(codes.map((c) => [c, encodeBits(input.bits, c, { start, up, mistake })]));
  const real = Object.fromEntries(codes.map((c) => [c, encodeBits(input.bits, c, { start, up })]));
  steps.push({ view: { n: 0 }, msg: `把 ${input.bits.join('')} 编成${codes.map((c) => NAMES[c]).join('、')}：${codes.map((c) => `${NAMES[c]}${ruleText(c, up)}`).join('；')}${codes.some((c) => c === 'nrzi' || c === 'diffman') ? `。开始之前是${LEVEL[start]}电平` : ''}。` });
  const main = codes[0];
  input.bits.forEach((b, i) => {
    const h = real[main][i];
    const prev = i ? real[main][i - 1][1] : start;
    const why = main === 'nrz' ? `${b} 是${LEVEL[b]}电平` : main === 'nrzi' ? (b === 0 ? `0：翻转，从${LEVEL[prev]}变成${LEVEL[h[0]]}` : `1：不变，还是${LEVEL[h[0]]}`) : main === 'manchester' ? `${b}：中间${h[0] === 1 ? '向下' : '向上'}跳，前${LEVEL[h[0]]}后${LEVEL[h[1]]}` : `${b}：位开始处${b === 0 ? '跳变' : '不跳'}，前半是${LEVEL[h[0]]}，中间再跳到${LEVEL[h[1]]}`;
    steps.push({ view: { n: i + 1, cur: i }, msg: `第 ${i + 1} 位 ${why}。`, ask: { tag: 'level', kind: 'choice', q: `第 ${i + 1} 位（${b}）的${NAMES[main]}，前半个码元是高电平还是低电平？`, choices: ['高', '低'], answer: LEVEL[waves[main][i][0]] } });
  });
  let baud = null;
  if (input.rate) {
    const m = /^(\d+(?:\.\d+)?)\s*([KMG]?)/i.exec(input.rate);
    const twice = main === 'manchester' || main === 'diffman';
    baud = `${+(Number(m[1]) * (twice ? 2 : 1)).toFixed(6)}${m[2].toUpperCase()}Baud`;
    steps.push({ view: { n: input.bits.length, done: true }, msg: twice ? `${NAMES[main]}每一位要两个码元（中间跳一次）：数据率 ${input.rate} 时码元速率是 2 倍，${baud}（编码效率 50%）。` : `${NAMES[main]}一位一个码元：码元速率等于数据率，${baud}。`, ask: { tag: 'baud', kind: 'number', q: `数据率 ${input.rate}，码元速率是多少 ${m[2].toUpperCase()}Baud？`, answer: Number(m[1]) * (twice && mistake !== 'baud1' ? 2 : 1) } });
  } else steps.push({ view: { n: input.bits.length, done: true }, msg: `${codes.map((c) => `${NAMES[c]}：${real[c].map(pair).join(' ')}`).join('；')}。` });
  return { steps, waves: real, baud };
}

// —— 画面：每种编码一条波形（SVG），上面一排比特；一位两个半格，位边界画虚线 ——
function wave(halves, n, total, y0, hgt, slot) {
  if (!n) return '';
  const pts = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
    const x = (2 * i + j) * slot, y = halves[i][j] ? y0 : y0 + hgt;
    if (pts.length) pts.push(`${x},${pts[pts.length - 1].split(',')[1]}`);
    pts.push(`${x},${y}`, `${x + slot},${y}`);
  }
  return `<polyline points="${pts.join(' ')}" class="ec-line"/>`;
}
function view(s, input) {
  const total = input.halves ? input.halves.length : input.bits.length;
  const slot = 22, W = total * 2 * slot, rowH = 62, top = 26;
  const rows = input.halves ? [{ code: input.codes[0], name: SHORT[input.codes[0]], halves: input.halves, show: total }] : input.codes.map((c) => ({ code: c, name: SHORT[c], halves: encodeBits(input.bits, c, { start: input.start, up: input.up }), show: s.n }));
  const H = top + rows.length * rowH;
  const lab = 112;
  let g = `<svg class="ec-svg" viewBox="${-lab} 0 ${W + lab + 4} ${H}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="编码波形">`;
  // 比特（读波形时揭晓到第 n 位）和位边界
  for (let i = 0; i < total; i++) {
    const x = (2 * i + 1) * slot;
    const bit = input.halves ? (i < s.n ? decodeLevels(input.halves, input.codes[0], { start: input.start, up: input.up })[i] : '?') : input.bits[i];
    g += `<text x="${x}" y="17" class="ec-bit${s.cur === i ? ' ec-curbit' : ''}" data-cmd="${i + 1}" data-label="第 ${i + 1} 位">${bit}</text>`;
    g += `<line x1="${2 * i * slot}" y1="${top - 4}" x2="${2 * i * slot}" y2="${H - 4}" class="ec-grid"/>`;
    if (s.cur === i) g += `<rect x="${2 * i * slot}" y="${top - 4}" width="${2 * slot}" height="${H - top}" class="ec-cur"/>`;
  }
  g += `<line x1="${W}" y1="${top - 4}" x2="${W}" y2="${H - 4}" class="ec-grid"/>`;
  rows.forEach((r, k) => {
    const y0 = top + k * rowH + 8, hgt = rowH - 24;
    g += `<text x="-22" y="${y0 + hgt / 2 + 5}" class="ec-name">${r.name}</text>`;
    g += `<line x1="0" y1="${y0 + hgt / 2}" x2="${W}" y2="${y0 + hgt / 2}" class="ec-mid"/>`;
    // NRZI、差分曼彻斯特要看前一位：开头之前的电平画一小段虚线
    if (r.code === 'nrzi' || r.code === 'diffman') { const y = input.start ? y0 : y0 + hgt; g += `<polyline points="-16,${y} 0,${y}${r.show ? ` 0,${r.halves[0][0] ? y0 : y0 + hgt}` : ''}" class="ec-pre"/>`; }
    g += wave(r.halves, r.show, total, y0, hgt, slot);
  });
  return `${g}</svg>`;
}

export const encodeEngine = {
  name: 'encode', title: '编码波形', parse, run, view,
  quiz(input, r) {
    if (input.halves) return { q: `下面是${NAMES[input.codes[0]]}的波形，读出比特串。`, type: 'bin', width: r.bits.length, answer: `0b${r.bits.join('')}` };
    const c = input.codes[0];
    return { q: `把 ${input.bits.join('')} 编成${NAMES[c]}${c === 'nrzi' || c === 'diffman' ? `（开始之前是${LEVEL[input.start]}电平）` : ''}，按顺序写出每个半码元的电平（高写 1、低写 0，一位两个）。`, type: 'bin', width: 2 * input.bits.length, answer: `0b${r.waves[c].flat().join('')}` };
  },
  // 考卷上那张表：每一位的两个半码元（编码），或者每一位是几（读波形）
  table(input, r) {
    if (input.halves) return { q: '每一位是几？', qhtml: '', dir: 'col', head: r.bits.map((_, i) => `${i + 1}`), rows: [{ label: '比特', cells: r.bits.map((b) => ({ v: String(b), num: true })) }] };
    return {
      q: '每一位的两个半码元是高还是低？（写「高低」或「10」）', qhtml: '', dir: 'col',
      head: input.bits.map((b, i) => `${i + 1}（${b}）`),
      rows: input.codes.map((c) => ({ label: NAMES[c], cells: r.waves[c].map((h) => ({ v: [pair(h), h.join('')] })) })),
    };
  },
  // 常见错法：曼彻斯特的约定反了、差分曼彻斯特把「有跳变」当成 1、NRZI 按「1 翻转」、差分曼彻斯特当成曼彻斯特读、码元速率没乘 2（和对的一样时不列）
  variants(input) {
    const sig = (r) => JSON.stringify(r.steps.map((s) => String(s.ask?.answer ?? '')));
    const right = sig(run(input));
    const has = (c) => input.codes.includes(c);
    const list = [
      ...(has('manchester') ? [['flip', '像是曼彻斯特的约定反过来了（这里 1 是中间向' + (input.up ? '上' : '下') + '跳）']] : []),
      ...(has('diffman') ? [['diffInvert', '像是把差分曼彻斯特的「位开始处有跳变」当成了 1（有跳变是 0，没有是 1）'], ...(input.halves ? [['asMan', '像是按曼彻斯特读了（差分曼彻斯特看的是位开始处有没有跳变，不看中间往哪跳）']] : [])] : []),
      ...(has('nrzi') ? [['nrziOne', '像是按「1 翻转」做的 NRZI（这里 0 翻转、1 不变）']] : []),
      ...(input.rate ? [['baud1', '像是码元速率没乘 2（曼彻斯特一位两个码元）']] : []),
    ];
    const out = [];
    for (const [m, label] of list) {
      const v = { ...input, mistake: m };
      try { if (sig(run(v)) !== right) out.push({ label, input: v }); } catch { /* */ }
    }
    return out;
  },
};
