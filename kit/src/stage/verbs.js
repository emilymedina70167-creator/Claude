// 英语动词的各种形式和拼谓语（主线第五轮，设计第 2 节）。纯函数。
// 老师只说「哪个词、什么时间、什么状态、主语是谁」，页面拼出谓语（{verb: go on | t | z | 单}，pick.js 接进句子、话、答案）。
// 页面只管拼得对；这一句该用哪种时态是教学，归老师。
//
// 不规则动词表：原形 → [过去式, 过去分词]。两种写法都行的取考研语法书上常见的那一种（got / got、shown、lit、woke / woken）；
// 规则、不规则两可而规则的更常见的（learn burn dream smell spell spill spoil lean leap prove dive）不列，照规则变。
const RAW = `
arise arose arisen|awake awoke awoken|be was been|bear bore borne|beat beat beaten|become became become|befall befell befallen|begin began begun|
behold beheld beheld|bend bent bent|beset beset beset|bet bet bet|bid bid bid|bind bound bound|bite bit bitten|bleed bled bled|blow blew blown|
break broke broken|broadcast broadcast broadcast|breed bred bred|bring brought brought|build built built|burst burst burst|buy bought bought|cast cast cast|catch caught caught|
choose chose chosen|cling clung clung|come came come|cost cost cost|creep crept crept|cut cut cut|deal dealt dealt|dig dug dug|do did done|
draw drew drawn|drink drank drunk|drive drove driven|dwell dwelt dwelt|eat ate eaten|fall fell fallen|feed fed fed|feel felt felt|fight fought fought|
find found found|flee fled fled|fling flung flung|fly flew flown|forbid forbade forbidden|forecast forecast forecast|forego forewent foregone|
foresee foresaw foreseen|foretell foretold foretold|forget forgot forgotten|forgive forgave forgiven|forgo forwent forgone|forsake forsook forsaken|
freeze froze frozen|get got got|give gave given|go went gone|grind ground ground|grow grew grown|hang hung hung|have had had|hear heard heard|
hide hid hidden|hit hit hit|hold held held|hurt hurt hurt|keep kept kept|kneel knelt knelt|know knew known|lay laid laid|lead led led|
leave left left|lend lent lent|let let let|lie lay lain|light lit lit|lose lost lost|make made made|mean meant meant|meet met met|
mislead misled misled|mistake mistook mistaken|misunderstand misunderstood misunderstood|offset offset offset|outdo outdid outdone|
outgrow outgrew outgrown|outrun outran outrun|overcome overcame overcome|overdo overdid overdone|overhear overheard overheard|
override overrode overridden|overrun overran overrun|oversee oversaw overseen|overtake overtook overtaken|overthrow overthrew overthrown|
partake partook partaken|pay paid paid|put put put|quit quit quit|read read read|rebuild rebuilt rebuilt|redo redid redone|repay repaid repaid|
reset reset reset|rewrite rewrote rewritten|rid rid rid|ride rode ridden|ring rang rung|rise rose risen|run ran run|say said said|see saw seen|
seek sought sought|sell sold sold|send sent sent|set set set|sew sewed sewn|shake shook shaken|shed shed shed|shine shone shone|shoot shot shot|
show showed shown|shrink shrank shrunk|shut shut shut|sing sang sung|sink sank sunk|sit sat sat|slay slew slain|sleep slept slept|slide slid slid|
sling slung slung|slit slit slit|sow sowed sown|speak spoke spoken|speed sped sped|spend spent spent|spin spun spun|spit spat spat|
split split split|spread spread spread|spring sprang sprung|stand stood stood|steal stole stolen|stick stuck stuck|sting stung stung|
stink stank stunk|stride strode stridden|strike struck struck|string strung strung|strive strove striven|swear swore sworn|sweep swept swept|
swell swelled swollen|swim swam swum|swing swung swung|take took taken|teach taught taught|tear tore torn|tell told told|think thought thought|
throw threw thrown|thrust thrust thrust|tread trod trodden|undergo underwent undergone|understand understood understood|
undertake undertook undertaken|undo undid undone|unwind unwound unwound|uphold upheld upheld|upset upset upset|wake woke woken|wear wore worn|
weave wove woven|weep wept wept|win won won|wind wound wound|withdraw withdrew withdrawn|withhold withheld withheld|
withstand withstood withstood|wring wrung wrung|write wrote written`;
export const IRREGULAR = Object.fromEntries(RAW.split('|').map((x) => x.trim().split(/\s+/)).map(([b, p, pp]) => [b, [p, pp]]));

// 不是原形的形式 → 原形（went → go）。自己也是一个动词原形的不算：表里的原形（come、read、lay），
// 和另有其词的规则动词（found 建立、saw 锯、wound 弄伤、ground 搁浅、fell 砍倒、bore 使厌烦、bound 跳）
const ALSO_BASE = new Set(['found', 'saw', 'wound', 'ground', 'fell', 'bore', 'bound', 'lay', 'shed', 'left']);
const NOT_BASE = { is: 'be', am: 'be', are: 'be', was: 'be', were: 'be', been: 'be', has: 'have', had: 'have', does: 'do', did: 'do', done: 'do' };
for (const [b, forms] of Object.entries(IRREGULAR)) for (const x of forms) if (!IRREGULAR[x] && !ALSO_BASE.has(x) && !NOT_BASE[x]) NOT_BASE[x] = b;

// 带前缀的（re- over- under- out- mis- fore- with- un- up-）去了前缀在表里：照表变（overcome → overcame）
const PREFIXES = ['under', 'over', 'fore', 'with', 'out', 'mis', 're', 'un', 'up'];
// 多音节、重音在最后一个音节的：加 ed / ing 双写末尾的辅音字母（单音节的看字形就知道，不用列）
const STRESS_LAST = new Set('prefer refer infer confer defer deter occur incur recur admit commit permit submit omit emit transmit regret begin forget forbid control patrol compel expel propel excel rebel equip transfer upset format program acquit unplug unpin unzip unclog unwrap unsnap rewrap replan remap recap overlap overstep outwit outstrip underpin kidnap worship handicap'.split(' '));

const VOWEL = /[aeiou]/;
// 看着像「前缀 + 表里的词」其实不是的：relay（转播）是规则动词，不是 re + lay
const NOT_PREFIXED = new Set(['relay']);
function irregularOf(w) {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (NOT_PREFIXED.has(w)) return null;
  for (const p of PREFIXES) {
    const rest = w.slice(p.length);
    if (w.startsWith(p) && rest.length >= 2 && IRREGULAR[rest] && rest !== 'be') return IRREGULAR[rest].map((x) => p + x);
  }
  return null;
}
// 加 ed / ing 要不要双写末尾的辅音字母
function doubles(w) {
  if (!/[^aeiouwxy]$/.test(w) || !VOWEL.test(w.at(-2)) || VOWEL.test(w.at(-3) || '')) return /qu[aeiou][^aeiouwxy]$/.test(w) && (w.length <= 5 || STRESS_LAST.has(w)); // quit、equip、acquit：qu 当一个辅音
  if (STRESS_LAST.has(w)) return true;
  // 单音节：整个词只有一段元音字母（stop plan run；visit open 有两段）
  if ((w.match(/[aeiouy]+/g) || []).length === 1) return true;
  // 前缀 + 表里一个要双写的单音节词（reset offset beset input outrun overrun：照词根双写；visit 不是 vi + sit）；别的多音节词不猜
  // （以前「前缀 + 单音节」都双写：render 被当成 re + nder，成了 renderred）。规则动词里要双写的列在 STRESS_LAST
  for (const p of [...PREFIXES, 'off', 'be', 'in']) { const root = w.slice(p.length); if (w.startsWith(p) && IRREGULAR[root] && (root.match(/[aeiouy]+/g) || []).length === 1) return doubles(root); }
  return false;
}
// 元音字母 + o 只加 s（radio → radios）；一个元音字母 + z 双写（quiz → quizzes）
const sOf = (w) => (w === 'have' ? 'has' : /[aeiou]o$/.test(w) ? `${w}s` : /[^aeiou][aeiou]z$/.test(w) || /qu[aeiou]z$/.test(w) ? `${w}zes` : /(s|x|z|ch|sh|o)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
function ingOf(w) {
  if (w === 'be') return 'being';
  if (/ie$/.test(w)) return `${w.slice(0, -2)}ying`;
  if (/(ee|oe|ye)$/.test(w)) return `${w}ing`;
  if (/e$/.test(w)) return `${w.slice(0, -1)}ing`;
  if (/ic$/.test(w)) return `${w}king`;
  return doubles(w) ? `${w}${w.at(-1)}ing` : `${w}ing`;
}
function edOf(w) {
  if (/e$/.test(w)) return `${w}d`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ied`;
  if (/ic$/.test(w)) return `${w}ked`;
  return doubles(w) ? `${w}${w.at(-1)}ed` : `${w}ed`;
}

/**
 * 一个动词的各种形式：{ base, s（第三人称单数）, ing, past, part, regular }。
 * base 可以是短语动词（go on：只变第一个词）；可以是老师自己给的三种形式 原形/过去式/过去分词（表里没有的不规则动词）。
 * regular：照规则变的（不在表里）——现状里要说一声「照规则变的」，老师看得到页面没查到这个词
 */
export function formsOf(base) {
  const src = String(base ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!src) throw new Error('{verb: …} 的第一格写动词原形（go、look at）');
  const [head, ...tail] = src.split(' ');
  const rest = tail.length ? ` ${tail.join(' ')}` : '';
  let w = head, own = null;
  if (head.includes('/')) {
    const three = head.split('/');
    if (three.length !== 3 || three.some((x) => !/^[a-z]+$/.test(x))) throw new Error(`「${base}」：自己给形式要写全三种形式 原形/过去式/过去分词（overcome/overcame/overcome）`);
    [w] = three;
    own = three.slice(1);
  }
  if (!/^[a-z]+$/.test(w)) throw new Error(`「${base}」不像一个动词原形（只写英文字母，短语动词用空格隔开：look at）`);
  // 第一格写的不是原形（went、is、has）：照规则变会拼出 wented。当场报，说原形是什么；自己给了三种形式的不查
  if (!own && NOT_BASE[w]) throw new Error(`「${w}」是 ${NOT_BASE[w]} 的变化形式：{verb: …} 的第一格写原形 ${NOT_BASE[w]}`);
  const irr = own || irregularOf(w);
  const [past, part] = irr || [edOf(w), edOf(w)];
  return { head: w, rest, base: `${w}${rest}`, s: `${w === 'be' ? 'is' : sOf(w)}${rest}`, ing: `${ingOf(w)}${rest}`, past: `${past}${rest}`, part: `${part}${rest}`, regular: !irr };
}

// —— 拼谓语 ——
export const TIMES = ['过去', '现在', '将来', '过去将来'];
export const ASPECTS = ['一般', '进行', '完成', '完成进行'];
export const MODALS = ['can', 'could', 'may', 'might', 'must', 'should', 'would', 'will', 'shall', 'ought to'];
export const SUBJECTS = ['I', 'you', 'he', 'she', 'it', 'we', 'they', '单', '复'];
const TIME_ALIAS = { past: '过去', present: '现在', future: '将来', 'past future': '过去将来', 'future in the past': '过去将来' };
const ASPECT_ALIAS = { simple: '一般', progressive: '进行', continuous: '进行', perfect: '完成', 'perfect progressive': '完成进行', 'perfect continuous': '完成进行' };
const low = (x) => String(x ?? '').trim().replace(/\s+/g, ' ');

/** 时间那一格读成 { time } 或 { modal }；不认得抛错（话里列出能写的） */
export function readTime(x) {
  const t = low(x) || '现在';
  if (TIMES.includes(t)) return { time: t };
  const a = t.toLowerCase();
  if (TIME_ALIAS[a]) return { time: TIME_ALIAS[a] };
  if (MODALS.includes(a)) return { modal: a };
  throw new Error(`时间写 ${TIMES.join(' / ')}（或者一个情态动词：${MODALS.join(' ')}），没有「${x}」`);
}
export function readAspect(x) {
  const t = low(x) || '一般';
  if (ASPECTS.includes(t)) return t;
  if (ASPECT_ALIAS[t.toLowerCase()]) return ASPECT_ALIAS[t.toLowerCase()];
  throw new Error(`状态写 ${ASPECTS.join(' / ')}，没有「${x}」`);
}
/** 主语读成人称：'I' | 'you' | '3s'（第三人称单数）| 'pl' */
export function readSubject(x) {
  const t = low(x) || '单';
  const k = t.toLowerCase();
  if (k === 'i') return 'I';
  if (k === 'you') return 'you';
  if (['he', 'she', 'it'].includes(k) || t === '单') return '3s';
  if (['we', 'they'].includes(k) || t === '复') return 'pl';
  throw new Error(`主语写 I / you / he / she / it / we / they，或者 单 / 复（第三人称单数 / 复数），没有「${x}」：名词主语看它是单数还是复数`);
}

const BE = { past: { I: 'was', '3s': 'was', you: 'were', pl: 'were' }, now: { I: 'am', '3s': 'is', you: 'are', pl: 'are' } };

/**
 * 拼出谓语：conjugate('go on', { time: '现在', aspect: '完成进行', subject: '单' }) → 'has been going on'。
 * time 也可以写一个情态动词（must + 完成 → must have gone）。passive 被动、negative 否定（not 不缩写）。
 * 这种说法一般不用的（完成进行的被动、将来进行的被动）、不认得的词：抛错，话给老师看
 */
export function conjugate(base, { time = '现在', aspect = '一般', subject = '单', passive = false, negative = false } = {}) {
  const f = formsOf(base);
  const T = readTime(time), A = readAspect(aspect), who = readSubject(subject);
  const isBe = f.head === 'be'; // be able to、be going to：照 be 变，后面的词原样接上
  if (passive && isBe) throw new Error('be 没有被动');
  const perfect = A === '完成' || A === '完成进行', prog = A === '进行' || A === '完成进行';
  const lead = T.modal || (T.time === '将来' ? 'will' : T.time === '过去将来' ? 'would' : null);
  // unsayable：词都认得，只是这种说法一般不用——舞台上不拦着写，拨到那儿时写「一般不这么说」（pick.js）
  if (passive && prog && (perfect || lead)) throw Object.assign(new Error(`「${T.modal || T.time}${A}」的被动一般不用（will be being done、has been being done）：换成一般、完成，或者过去 / 现在的进行`), { unsayable: true });
  const past = T.time === '过去';
  // 一串动词：每一个决定后面那个用什么形式（have 后面过去分词，进行的 be 后面 ing，被动的 be 后面过去分词）
  const chain = [...(perfect ? [{ v: 'have', next: 'part' }] : []), ...(prog ? [{ v: 'be', next: 'ing' }] : []), ...(passive ? [{ v: 'be', next: 'part' }] : []), { v: 'main' }];
  const form = (v, need) => {
    if (v === 'be' || (v === 'main' && isBe)) {
      const be = need === 'base' ? 'be' : need === 'part' ? 'been' : need === 'ing' ? 'being' : BE[past ? 'past' : 'now'][who];
      return v === 'main' ? `${be}${f.rest}` : be;
    }
    if (v === 'have') return need === 'base' ? 'have' : need === 'part' ? 'had' : need === 'ing' ? 'having' : past ? 'had' : who === '3s' ? 'has' : 'have';
    return need === 'base' ? f.base : need === 'part' ? f.part : need === 'ing' ? f.ing : past ? f.past : who === '3s' ? f.s : f.base;
  };
  let need = lead ? 'base' : 'finite';
  const words = [];
  for (const x of chain) { words.push(form(x.v, need)); need = x.next; }
  if (lead) words.unshift(lead);
  if (negative) {
    if (words.length === 1 && !isBe) {
      // 一般现在 / 一般过去的主动：借 do
      words.splice(0, 1, past ? 'did' : who === '3s' ? 'does' : 'do', 'not', f.base);
    } else if (words[0] === 'can') words[0] = 'cannot';
    else if (words[0] === 'ought to') words[0] = 'ought not to';
    else if (words.length === 1) words[0] = words[0].replace(/^(\S+)/, '$1 not'); // 只有 be 自己（is able to → is not able to）
    else words.splice(1, 0, 'not');
  }
  return words.join(' ');
}
