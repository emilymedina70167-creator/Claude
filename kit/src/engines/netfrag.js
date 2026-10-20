// 计算机网络的 IP 分片：frag（每片最多带多少数据、几片、每片的总长度 / 片偏移 / MF，路上 MTU 更小时再分）。
// 口径按王道：除了最后一片，每片的数据部分是 8 字节的整数倍（片偏移以 8 字节为单位）；每片都带一个首部（默认 20 字节）；
// 片偏移 = 这一片数据在原数据报数据部分里的字节位置 ÷ 8；MF：后面还有分片就是 1，最后一片是 0；DF = 1 又要分片就丢弃，发 ICMP。
// 纯函数（tests/netfrag-engine.test.js）。

const int = (src, what, lo = 1, hi = 65535) => {
  const n = Number(String(src).trim().replace(/B$/i, ''));
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${what}写 ${lo}～${hi} 的整数（字节）（现在是「${src}」）`);
  return n;
};

function parse(fields) {
  const header = int(fields.header ?? 20, 'header: 首部长度', 20, 60);
  if (header % 4) throw new Error('header: 首部长度要是 4 的整数倍（20～60）');
  let total;
  if (fields.total !== undefined) total = int(fields.total, 'total: 数据报总长度', header + 1);
  else if (fields.data !== undefined) total = int(fields.data, 'data: 数据部分长度', 1) + header;
  else throw new Error('写 total:（数据报总长度，含首部）或 data:（数据部分长度）');
  if (total > 65535) throw new Error('IP 数据报总长度最多 65535 字节');
  const mtus = String(fields.mtu ?? '').split(/[,，、\s]+/).filter(Boolean).map((x) => int(x, 'mtu: ', 68, 65535));
  if (!mtus.length) throw new Error('mtu: 写链路的 MTU（字节），路上有几段就写几个，比如 mtu: 1500, 576');
  if (mtus.length > 3) throw new Error('mtu: 最多 3 段');
  for (const m of mtus) if (m - header < 8) throw new Error(`mtu: ${m} 去掉首部放不下 8 字节数据`);
  const df = /^(1|yes|是|true)$/i.test(String(fields.df ?? '0').trim());
  return { header, total, data: total - header, mtus, df, mistake: '' };
}

// 一组分片（{ off: 数据起点（字节）, len: 数据长度, mf }）经过 MTU 为 mtu 的链路
export function fragment(frags, mtu, header, mistake = '') {
  const room = mtu - header;
  const max = mistake === 'no8' ? room : Math.floor(room / 8) * 8;
  const out = [];
  for (const f of frags) {
    if (f.len + header <= mtu) { out.push({ ...f, from: f }); continue; }
    for (let a = 0; a < f.len; a += max) {
      const len = Math.min(max, f.len - a);
      out.push({ off: f.off + a, len, mf: a + len < f.len ? 1 : f.mf, from: f, split: true });
    }
  }
  return { max, out };
}
const offOf = (f, mistake) => (mistake === 'byteOff' ? f.off : f.off / 8);

function run(input) {
  const { header, total, mtus, df, mistake } = input;
  const data = mistake === 'noHead' ? total : input.data; // 错法：总长度当成了数据长度（没减首部）
  const steps = [];
  let frags = [{ off: 0, len: data, mf: 0 }];
  const hops = [];
  steps.push({ view: { frags, hop: -1 }, msg: `IP 数据报总长度 ${total} 字节，首部 ${header} 字节，数据部分 ${input.data} 字节。要经过 MTU ${mtus.join('、')} 字节的链路${mtus.length > 1 ? '（依次）' : ''}。` });
  for (const [h, mtu] of mtus.entries()) {
    const big = frags.filter((f) => f.len + header > mtu);
    if (!big.length) { steps.push({ view: { frags, hop: h }, msg: `MTU ${mtu}：每片都不超过 ${mtu} 字节，不用再分。` }); hops.push({ mtu, frags }); continue; }
    if (df) {
      steps.push({ view: { frags, hop: h, drop: true }, msg: `DF = 1（不许分片），可数据报比 MTU ${mtu} 大：路由器丢弃它，向源主机发 ICMP 差错报告（终点不可达，需要分片但 DF 置 1）。`, ask: { tag: 'df', kind: 'choice', q: '这个数据报会怎样？', choices: ['分片后转发', '丢弃，发 ICMP 差错报告', '原样转发'], answer: '丢弃，发 ICMP 差错报告' } });
      return { steps, hops, frags: [], dropped: true };
    }
    const { max, out } = fragment(frags, mtu, header, mistake);
    const room = mtu - header;
    steps.push({ view: { frags, hop: h, max }, msg: `MTU ${mtu}：每片最多 ${mtu} − ${header} = ${room} 字节数据${room % 8 ? `，还要是 8 的整数倍（片偏移以 8 字节为单位）：⌊${room} ÷ 8⌋ × 8 = ${Math.floor(room / 8) * 8}` : '，正好是 8 的整数倍'}。`, ask: { tag: 'max', kind: 'number', q: `经过 MTU ${mtu} 的链路时，每片最多带多少字节数据？`, answer: max } });
    const n = out.length;
    steps.push({ view: { frags: out, hop: h, fresh: true }, msg: `${h === 0 ? `数据 ${data} 字节 ÷ ${max}，向上取整：分成 ${n} 片` : `超过 ${mtu} 的分片再分，分完一共 ${n} 片（片偏移还是相对原数据报算的）`}。`, ask: { tag: 'count', kind: 'number', q: h === 0 ? '要分成几片？' : `经过 MTU ${mtu} 以后一共几片？`, answer: n } });
    out.forEach((f, i) => {
      const len = f.len + header;
      const off = offOf(f, mistake);
      let ask;
      if (i === 0) ask = { tag: 'len', kind: 'number', q: `第 1 片的总长度是多少字节？`, answer: len };
      else ask = { tag: 'offset', kind: 'number', q: `第 ${i + 1} 片的片偏移是多少？`, answer: off };
      steps.push({ view: { frags: out, hop: h, cur: i }, msg: `第 ${i + 1} 片：数据是原数据报的第 ${f.off}～${f.off + f.len - 1} 字节（${f.len} 字节），总长度 ${f.len} + ${header} = ${len}，片偏移 ${f.off} ÷ 8 = ${f.off / 8}，MF = ${f.mf}${f.mf ? '（后面还有）' : '（最后一片）'}。`, ask });
    });
    const last = out[out.length - 1];
    steps.push({ view: { frags: out, hop: h, done: true }, msg: `各片的片偏移：${out.map((f) => offOf(f, '')).join('、')}；只有最后一片 MF = 0，其余都是 1；DF 都是 0；标识和原数据报一样。`, ask: { tag: 'mf', kind: 'choice', q: '最后一片的 MF 是？', choices: ['0', '1'], answer: String(last.mf) } });
    frags = out;
    hops.push({ mtu, frags: out, max });
  }
  return { steps, hops, frags };
}

function view(s, input) {
  const { header } = input;
  const data = input.data;
  if (s.drop) return `<div class="nf-drop">数据报 ${input.total} 字节 &gt; MTU ${input.mtus[s.hop]}，DF = 1：丢弃</div>`;
  // 原数据报的数据部分画成一条，按分片切开
  let h = `<div class="nf-bar">${s.frags.map((f, i) => `<div class="nf-seg${s.cur === i ? ' nf-cur' : ''}${f.split && s.fresh ? ' sv-new' : ''}" style="flex:${Math.max(f.len, data / 40)}" data-cmd="${i + 1}" data-label="第 ${i + 1} 片"><b>${s.frags.length > 1 ? `片 ${i + 1}` : '数据'}</b><small>${f.off}～${f.off + f.len - 1}</small></div>`).join('')}</div>`;
  if (s.hop >= 0 && s.frags.length > 1 || s.cur !== undefined) {
    h += `<table class="nf-tab sv-tab"><thead><tr><th>分片</th><th>总长度</th><th>数据</th><th>片偏移</th><th>MF</th></tr></thead><tbody>${s.frags.map((f, i) => `<tr${s.cur === i ? ' class="nf-on"' : ''}><td>${i + 1}</td><td>${s.cur === undefined || i <= s.cur || s.done ? f.len + header : ''}</td><td>${f.len}</td><td>${s.cur === undefined || i <= s.cur || s.done ? f.off / 8 : ''}</td><td>${s.cur === undefined || i <= s.cur || s.done ? f.mf : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  if (s.max) h += `<div class="nf-note">MTU ${input.mtus[s.hop]}：每片最多 ${s.max} 字节数据 + ${header} 字节首部</div>`;
  return h;
}

export const fragEngine = {
  name: 'frag', title: 'IP 分片', parse, run, view,
  quiz(input, r) {
    if (r.dropped) return { q: `IP 数据报总长度 ${input.total} 字节，DF = 1，要经过 MTU ${input.mtus.join('、')} 的链路。会怎样？（写「丢弃」或「分片」）`, type: 'seq', answer: '丢弃' };
    return { q: `IP 数据报总长度 ${input.total} 字节（首部 ${input.header} 字节），要经过 MTU ${input.mtus.join('、')} 字节的链路。按顺序写出最后各片的片偏移（用空格隔开）。`, type: 'seq', answer: r.frags.map((f) => f.off / 8).join(' ') };
  },
  // 考卷上那张表：每片的总长度、片偏移、MF
  table(input, r) {
    if (r.dropped) throw new Error('DF = 1 时不分片，没有表可填（mode: fill 去掉，或者 df: 0）');
    return {
      q: '把最后各片的总长度、片偏移、MF 填进表里。', qhtml: '', dir: 'row',
      head: ['总长度', '片偏移', 'MF'],
      rows: r.frags.map((f, i) => ({ label: `第 ${i + 1} 片`, cells: [{ v: String(f.len + input.header), num: true }, { v: String(f.off / 8), num: true }, { v: String(f.mf), num: true }] })),
      extra: [{ label: '一共几片', v: String(r.frags.length), num: true }],
    };
  },
  // 常见错法：每片数据没取 8 的整数倍、片偏移写成字节数、总长度当成数据长度（没减首部）（和对的一样时不列）
  variants(input) {
    const sig = (r) => JSON.stringify([r.frags?.map((f) => [f.off, f.len, f.mf]), r.steps.map((s) => String(s.ask?.answer ?? ''))]);
    const right = sig(run(input));
    const out = [];
    for (const [m, label] of [['no8', '像是每片的数据没取 8 的整数倍（片偏移以 8 字节为单位，除了最后一片都要是 8 的倍数）'], ['byteOff', '像是片偏移写成了字节数（要再除以 8）'], ['noHead', '像是把总长度当成了数据长度（数据部分 = 总长度 − 首部）']]) {
      const v = { ...input, mistake: m };
      try { if (sig(run(v)) !== right) out.push({ label, input: v }); } catch { /* */ }
    }
    return out;
  },
};
