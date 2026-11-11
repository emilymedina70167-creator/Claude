// 舞台课 → 题库（主线第四轮，设计 3.2）：舞台课里没有黑板的组件，下课时抄不出题。这里把这节课老师照引擎走过的每一种
// （follow：哪类算法、哪几个字段；数据不抄）抄成一道「舞台上自己练」的题（黑板组件 stage，blocks/stagedrill.js）。
// 纯函数，有测试（tests/memory-drills.test.js）。同一块同一种只有一道：上几次课都是它。
import { Scene } from '../stage/scene.js';
import { parseScript } from '../stage/script.js';
import '../stage/types/index.js';
import { followOf, followInfo } from '../stage/follow.js';
import { spaceOfId } from './space.js';
import { parseStageDrill, drawStageDrill } from '../stagedrillspec.js';

const safe = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const numOf = (v) => { const t = String(v ?? '').replace(/[′'’]/g, ''); return /^-?\d+$/.test(t) ? Number(t) : null; };

/** 这一种的编号：d-stage-{块}-{哪类算法}-{字段的指纹} */
export function stageDrillId(block, name, fields) {
  const sig = Object.keys(fields || {}).sort().map((k) => `${k}_${fields[k]}`).join('_');
  // 块的编号里的横线留着（DS-L8.2.3 → DS-L8_2_3）
  return `d-stage-${String(block || 'x').replace(/[^A-Za-z0-9-]+/g, '_')}-${safe(name)}${sig ? `-${safe(sig)}` : ''}`.slice(0, 120);
}

/**
 * 一节舞台课 → 抄进题库的题 [{ id, doc }]。session：sessions 文档（带 id）；turns：这节课的每一轮（老师的那几轮是 role: 'claude'，
 * 作废的 discarded 不看）；existing：题库里已经有的（按编号，不重复抄）。
 */
export function stageDrillsOf({ session = {}, turns = [], existing = [], now = Date.now() } = {}) {
  const sid = String(session.id || '');
  const block = session.block || null;
  if (!sid) return [];
  const have = new Set((existing || []).map((d) => String(d.id)));
  const s = new Scene();
  const made = new Map(); // 东西 id → 造它的那一行
  const extra = new Map(); // 东西 id → follow 以后老师接着摆的几行（分组）
  const opens = new Map(); // 东西 id → 老师开过的动作
  const found = new Map(); // 题的编号 → 那一刻记下的 { o（副本）, id }
  const rows = (turns || []).filter((t) => t && t.role === 'claude' && !t.discarded && t.text).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  for (const t of rows) {
    for (const c of parseScript(String(t.text))) {
      if (!c.cmd || c.on) continue;
      let fx;
      try { fx = s.apply({ ...c, lenient: true }); } catch { continue; } // 课上没演上的行这里也演不上：跳过
      const src = String(c.src || '').trim();
      if (fx?.created && fx.id) { made.set(fx.id, src); extra.delete(fx.id); }
      const target = (c.args || []).find((a) => a.t === 'word')?.v?.match(/^[A-Za-z_]\w*/)?.[0];
      // follow 以后老师接着摆的分组：只留最后一次（课上隔 5、隔 3、隔 1 分了三次，题一开始照最后那一次摆）
      if (c.cmd === 'group' && target && s.objects.get(target)?.follow) extra.set(target, [src]);
      if (c.cmd === 'open' && target) { const act = (c.args || []).filter((a) => a.t === 'word')[1]?.v; if (act) opens.set(target, new Set([...(opens.get(target) || []), act])); }
      if (c.cmd === 'follow' && fx?.follow && s.objects.get(fx.id)?.follow) {
        const o = s.objects.get(fx.id);
        found.set(stageDrillId(block, o.follow.name, o.follow.fields), { o: structuredClone(o), id: fx.id, at: found.size });
      }
    }
  }
  const out = [];
  for (const [id, f] of found) {
    if (have.has(id)) continue;
    const { o } = f;
    const a = followOf(o.follow.name);
    const fields = o.follow.fields || {};
    const head = a.head && fields[a.head] != null ? ` ${fields[a.head]}` : '';
    const rest = Object.keys(fields).filter((k) => k !== a.head).map((k) => { const v = String(fields[k]); return `${k}=${/\s/.test(v) ? `"${v}"` : v}`; }).join(' ');
    const followLine = `follow ${f.id} ${o.follow.name}${head}${rest ? ` ${rest}` : ''}`;
    // 一排数：换数（个数、范围照那节课那一排；范围太窄取不出不重复的就放宽）。别的（图）照原样造，不换
    let pick = '', create = made.get(f.id) || '';
    const nums = o.type === 'array' ? o.cells.map((x) => numOf(x.value)) : null;
    const random = !!nums && nums.length >= 2 && nums.every((v) => v != null);
    if (random) {
      const n = nums.length;
      let lo = Math.min(...nums), hi = Math.max(...nums);
      if (hi - lo + 1 < n * 2) { lo = 1; hi = 99; }
      pick = `pick a = seq(${n}, ${lo}, ${hi}) distinct\n`;
      create = `array ${f.id} = {a}`;
    }
    if (!create) continue;
    const acts = [...(opens.get(f.id) || [])].filter((x) => !/=/.test(x));
    if (!acts.length) acts.push(a.drillOpen ? a.drillOpen(fields) : 'move');
    // 抄之前先试一遍（取数、在不画的场景里演）：出不了的题不抄——同一块同一种只有一个编号，抄了一道坏的这一种就再也没有了。
    // 带着分组那一行不成（课上写的是拨盘名，题里没有拨盘）就去掉它再试
    const body = (more) => `id: ${id}\n${pick}---\n${[create, followLine, ...more, ...acts.map((x) => `open ${f.id} ${x}`)].join('\n')}`;
    const works = (text) => { try { return !drawStageDrill(parseStageDrill(text)).error; } catch { return false; } };
    const text = [body(extra.get(f.id) || []), body([])].find(works);
    if (!text) continue;
    out.push({
      id,
      doc: {
        block, kind: 'stage', md: `\`\`\`stage\n${text}\n\`\`\``, q: `照 ${followInfo(o).title} 走一遍`, title: followInfo(o).title,
        src: 'stage', random, from: { session: sid }, fromSession: sid, ...(block ? { space: session.space || spaceOfId(block) } : {}), status: 'active', at: now,
      },
    });
  }
  return out;
}
