// ============================================================
//  STAGE 1 — script (deepseek-v4-pro via OpenRouter)
//  Niche: werewolf-alpha-romance (fiction audiobook narration, NOT documentary)
//
//  SEEKHA HUA (asli test se): ek call mein 2250 words ki script NAHI aati —
//  480 words de kar chhod deta hai, aur "**Hook (First 20 Seconds):**" jaise
//  headings bhi ghusa deta hai. Isliye PAANCH PASS:
//     pass 1 → outline (N beats, money-beat tags ke sath — koi chapter labels
//              nahi) + ek CHHOTA "cast" (fixed character names, topic se)
//     pass 1.5 → cold-open TEASER (dramatized shuruaat se pehle, 150-250 words)
//     pass 2 → har beat ka narration, apni alag call mein, cast ke naam jabri
//              har call mein diye jate hain (character-drift na ho)
//     pass 3 → CTA/outro (competitor-style sign-off, koi rhetorical sawal nahi)
//  Phir defensive safai: markdown, headings, [scene], "Host:", em-dash,
//  duplicate paragraphs, premature CTA-leak — sab nikal dete hain.
//
//  SEEKHA HUA #2 (asli run se, video 2): do bade masle mile —
//    1. Outline ka generic "poison plot" example literal repeat ho raha tha
//       har topic mein, chahe topic kuch bhi ho. Ab outline STRICTLY topic
//       se banta hai, generic formula sirf SHAPE deta hai (setup/crisis/
//       resolution), maloomat topic se aati hai.
//    2. Character naam drift (Kael → Kaius → Rorik beech mein) — ab ek
//       "cast" list outline ke sath hi banta hai aur HAR beat call mein
//       jabri diya jata hai, taake naam kabhi na badlein.
//
//  YE SAB script-comparison-report.md (niches/werewolf-alpha-romance/) ki
//  tehqeeq se aaya hai — hamari script aur competitor ke top video ka
//  mukammal comparison. Ahem faislay:
//    - kam se kam 30% dialogue, natural contractions ke sath
//    - saadi, aam-fahm zubaan (competitor ki "middle-class vocabulary" jaisi)
//      — mushkil/adabi lafz nahi
//    - em-dash bilkul nahi
//    - chhote jumle zyada (30%+ <=6 words), lambe jumle kam
//    - motif/phrase dohrav max 2 dafa
//    - "money beats" (bonding, near-death, climax) ko zyada waqt milta hai
//    - har scene-jump apna time/place marker de
//    - outro mein koi rhetorical sawal audience se nahi
//
//  Word count SAKHT hai — config.wordCount (default 9000-10000) — kam ho to
//  barhaya jata hai, zyada ho to trim.
// ============================================================
const fs = require('fs');
const U = require('../lib/util.js');
const AI = require('../lib/ai.js');

const WORDS_PER_BEAT = 240;
const CTA_WORDS = 110;       // outro ke liye reserve
const TEASER_WORDS = 200;    // cold-open teaser ke liye reserve

// ZUBAAN — sab jagah yehi register (outline, beats, extend, CTA sab mein use hota hai)
const REGISTER = `
ZUBAAN — SAADI, AAM-FAHM (BAHUT AHEM):
- Plain, conversational, middle-school reading level — jaisa koi kahani sunata
  hai, novel nahi likhta. Common words use karo: big, cold, warm, said, felt,
  wanted — NA ke adabi/mushkil lafz jaise "threadbare," "psychic amputation,"
  "iceberg heartwood," "glacial granite." Agar ek lafz kisi ko google karna
  pade, wo lafz mat likho.
- Dialogue mein NATURAL CONTRACTIONS lazmi: don't, won't, I'm, you're, it's,
  can't, I'll — "I will not" ki jagah "I won't", "you are" ki jagah "you're".
  Sirf jab koi kirdaar jaan-boojh kar bahut formal/cold bol raha ho tab hi
  uncontracted rakho (rare).
- EM-DASH (—) BILKUL ISTEMAL NA KARO. Interruption ya appositive ke liye comma
  ya naya jumla likho.
- Jumlon ki lambai badalti rahe: kam az kam 30% jumle 6 lafz ya us se chhote
  hon ("Silence." "He froze." "She didn't move."). 25+ lafz ke jumle bahut kam
  rakho — agar itni maloomat honi zaroori hai to do jumlon mein tor do.
- Kisi bhi descriptive phrase/metaphor/sensory comparison ko POORI script mein
  DO DAFA se zyada mat dohrao (misal: "winter stone eyes" ek dafa theek hai,
  baar baar wahi jumla mat likho — har dafa naya tareeqa dhoondo usi cheez ko
  bayan karne ka).`;

// LLM jo kachra daale — headings, bullets, [scene], "Host:", timestamps — sab saaf
function clean(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => !/^#{1,6}\s/.test(l))
    .filter(l => !/^-{3,}$|^\*{3,}$|^_{3,}$/.test(l))
    .filter(l => !/^\*\*[^*]{0,80}\*\*:?\s*$/.test(l))
    .filter(l => !/^\(.*\)$/.test(l))
    .filter(l => !/^\[[^\]]*\]$/.test(l))
    .filter(l => !/^(host|narrator|voice ?over|vo|scene|section|part|chapter|beat|hook|outro|intro)\s*\d*\s*:/i.test(l))
    .filter(l => !/^\d{1,2}:\d{2}/.test(l))
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    // em-dash defensive cleanup — model kabhi qaide ke bawajood laga deta hai
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const countWords = t => String(t).split(/\s+/).filter(Boolean).length;

// dialogue % naapo (quotes ke andar wale lafz / kul lafz) — sirf visibility ke liye
function dialoguePct(text) {
  const quoted = (String(text).match(/["“][^"”]{2,}["”]/g) || []).join(' ');
  const qw = countWords(quoted), tw = countWords(text);
  return tw ? Math.round((qw / tw) * 100) : 0;
}

// sab se zyada dohraya gaya 3-lafzi phrase dhoondo (motif-repetition ki nazar
// rakhne ke liye — sirf warning, khud theek nahi karta)
function topRepeatedPhrase(text) {
  const words = String(text).toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean);
  const counts = {};
  for (let i = 0; i + 2 < words.length; i++) {
    const g = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    counts[g] = (counts[g] || 0) + 1;
  }
  let best = null;
  for (const [g, n] of Object.entries(counts)) if (n > 3 && (!best || n > best.n)) best = { g, n };
  return best;
}

// EXACT duplicate paragraphs girao — model kabhi kabhi tail-continuity ke
// bawajood wahi paragraph dobara likh deta hai. NEAR-duplicate bhi pakadte
// hain: model kabhi pichle jumle ko subject badal kar dobara likh deta hai
// ("She nodded..." phir kisi BAAD wale paragraph mein "Elara nodded..." wahi
// jumla) — pehla lafz chhod kar agle 8 lafz compare karte hain. ASLI BUG
// (video 3): pehle sirf IMMEDIATE PICHLE paragraph se compare hota tha, is
// liye 2-3 beats door ka near-dup bilkul nahi pakda jata tha — ab pichle 60
// paragraphs ke signatures yaad rakhte hain.
function dedupeParagraphs(parts) {
  const seen = new Set();
  const recentSignatures = [];
  const out = [];
  let dropped = 0;
  for (const part of parts) {
    const paras = part.split(/\n\s*\n/);
    const kept = [];
    for (const p of paras) {
      const norm = p.trim().toLowerCase().replace(/\s+/g, ' ');
      const words = norm.split(' ');
      const isExactDup = norm.length > 30 && seen.has(norm);
      const sig = words.length > 8 ? words.slice(1, 9).join(' ') : null;
      const isNearDup = sig && recentSignatures.includes(sig);
      if (isExactDup || isNearDup) { dropped++; continue; }
      if (norm.length > 30) seen.add(norm);
      if (sig) { recentSignatures.push(sig); if (recentSignatures.length > 60) recentSignatures.shift(); }
      kept.push(p);
    }
    out.push(kept.join('\n\n'));
  }
  return { parts: out, dropped };
}

// PORA BEAT kisi PICHLE beat ka dobara-kaha hua SCENE ho sakta hai — jumle
// mukhtalif likhe gaye hon (isliye upar wala paragraph-dedup nahi pakadta)
// lekin wahi scene/waqia dobara ho raha ho (asli bug: assassination attempt,
// wolf-bonding ritual, aur Varys ki giraftari — teeno DO DAFA likhe gaye,
// alfaz badal kar). Poore beat ka 5-word shingle overlap kisi bhi PICHLE
// beat se naapte hain — zyada overlap ho to baad wala beat scene-duplicate
// hai, poora gira dete hain (hook aur aakhri beat kabhi nahi girate).
function shingles(text, n = 5) {
  const words = String(text).toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(' '));
  return set;
}
function dedupeDuplicateScenes(parts, protectedIdx) {
  const sets = parts.map(p => shingles(p));
  const drop = new Set();
  for (let i = 1; i < parts.length; i++) {
    if (protectedIdx.has(i)) continue;
    for (let j = 0; j < i; j++) {
      if (drop.has(j)) continue;
      const a = sets[i], b = sets[j];
      if (a.size < 6 || b.size < 6) continue;
      const small = a.size < b.size ? a : b;
      const big = a.size < b.size ? b : a;
      let overlap = 0;
      for (const s of small) if (big.has(s)) overlap++;
      const ratio = overlap / small.size;
      if (overlap >= 5 && ratio > 0.1) { drop.add(i); break; }
    }
  }
  return drop;
}

// beat ka aakhri jumla ADHOORA reh gaya ho (maxTokens hit ho gaya beech
// dialogue mein — asli bug: unclosed quote mark "We don't have much time
// before the dinner.) to us adhoore jumle ko kaat do, pichla poora jumla
// (band quote ke sath) tak wapas jao.
function closeSentence(text) {
  const t = String(text).trim();
  if (!t) return t;
  const endsOk = /[.?!]["”]?\s*$/.test(t);
  const balanced = ((t.match(/"/g) || []).length % 2) === 0;
  if (endsOk && balanced) return t;
  const sentences = t.split(/(?<=[.?!]["”]?)\s+/);
  while (sentences.length > 1) {
    sentences.pop();
    const candidate = sentences.join(' ').trim();
    const q = (candidate.match(/"/g) || []).length;
    if (/[.?!]["”]?\s*$/.test(candidate) && q % 2 === 0) return candidate;
  }
  return t;
}

// aakhri beat mein LLM kabhi khud "thank you for listening / like and
// comment" jaisa CTA likh deta hai (asli bug: do CTA ban gaye the) — is
// tarah ke jumle pakro aur nikaalo, real CTA baad mein alag se lagta hai
function stripLeakedCta(text) {
  const sentences = text.split(/(?<=[.?!])\s+/);
  const ctaLike = /thank you for (listening|watching)|don'?t forget to (like|comment)|leave a comment|subscribe|see you (in|next) the next/i;
  const kept = sentences.filter(s => !ctaLike.test(s));
  return kept.join(' ').trim();
}

// beats ki list ko max tak trim karo. ASLI BUG (video 2): purana tareeqa
// SHURU se count karta tha aur jahan budget khatam hota wahin ROK deta tha —
// matlab AAKHRI beat (resolution/epilogue) hi sab se pehle qurbaan hota tha,
// aur kahani anjaam tak pahunchne se pehle CTA par kood jati thi.
//
// Naya tareeqa: AAKHRI beat (aur money beats) HAMESHA poore rakhta hai —
// wahi kahani ka anjaam/sab se ahem lamhe hain. Zyada lafz sab se BADE
// (zyada overshoot wale) baaki beats se kaate jate hain, jab tak budget na
// milay. Story kabhi bhi bina anjaam ke nahi rukti.
function trimToMax(parts, max, protectedIdx = new Set()) {
  const n = parts.length;
  const protect = new Set(protectedIdx);
  protect.add(n - 1);   // aakhri beat hamesha mehfooz

  const protectedTotal = [...protect].reduce((a, i) => a + countWords(parts[i] || ''), 0);
  const budgetForRest = Math.max(0, max - protectedTotal);

  const kept = parts.map(p => p);
  const restIdx = kept.map((_, i) => i).filter(i => !protect.has(i));
  let restTotal = restIdx.reduce((a, i) => a + countWords(kept[i]), 0);

  // sab se bada (zyada overshoot) beat pehle kaato, jab tak budget na milay
  const order = restIdx.map(i => ({ i, w: countWords(kept[i]) })).sort((a, b) => b.w - a.w);
  for (const { i } of order) {
    if (restTotal <= budgetForRest) break;
    const over = restTotal - budgetForRest;
    const w = countWords(kept[i]);
    const targetW = Math.max(50, w - over);
    if (targetW >= w) continue;
    const sentences = kept[i].split(/(?<=[.?!])\s+/);
    let acc = [], accW = 0;
    for (const s of sentences) {
      const sw = countWords(s);
      if (accW + sw > targetW && acc.length) break;
      acc.push(s); accW += sw;
    }
    const trimmed = closeSentence(acc.join(' '));
    restTotal += countWords(trimmed) - w;
    kept[i] = trimmed;
  }

  const total = kept.reduce((a, p) => a + countWords(p), 0);
  return { parts: kept, total };
}

module.exports = async function (spec, cfg, st) {
  const id = spec.id;
  const dest = U.p(id, 'script.txt');
  const WC = cfg.wordCount || { min: 9000, max: 10000 };
  const STORY_MAX = WC.max - CTA_WORDS - TEASER_WORDS;
  const STORY_MIN = Math.min(WC.min, STORY_MAX - 500);
  const target = Math.round((STORY_MIN + STORY_MAX) / 2);
  const topic = spec.topic_text || spec.topic || spec.title || '';
  if (!topic) throw new Error('videos/<file>.md mein "Topic:" ya "## Topic" nahi mila');

  // spec mein "ScriptModel:" ho to wahi model (kuch videos GPT se, kuch deepseek se)
  const model = spec.scriptmodel ? [spec.scriptmodel, ...cfg.models.script] : cfg.models.script;
  const beats = Math.max(3, Math.round(target / WORDS_PER_BEAT));
  U.log(`   topic: ${topic.slice(0, 66)}`);
  U.log(`   target: ${WC.min}-${WC.max} words (teaser ~${TEASER_WORDS} + story ~${target} + CTA ~${CTA_WORDS}) → ${beats} beats`);

  // ---------- PASS 1: outline + cast (STRICTLY is topic se, generic nahi) ----------
  const outlineResp = await AI.chatJson(model,
`Werewolf/Alpha-King paranormal romance audiobook ke liye ${beats} BEATS ka
outline banao. Ye FICTION hai — asli waqiya nahi, kahani ban rahi hai.

TOPIC / PREMISE (POORI OUTLINE ISI SE BANEGI — GHAUR SE PARHO):
${topic}

BAHUT AHEM — TOPIC FIDELITY (pichli dafa ye fail hua tha — ghaur se parho):
Pehle, TOPIC ke upar diye jumlon mein se 3-5 KHAAS, THOS PLOT EVENTS nikaalo
(misal: "she poses as his fake fiancée," "an engagement ball," "an
assassination attempt," "she saves his life") — inhe "keyEvents" mein likho.
Phir HAR ek keyEvent ko EK KHAAS BEAT mein zaroor daalo — koi bhi keyEvent
chhootna nahi chahiye, AUR koi bhi keyEvent DO beats ko mat do (har event
sirf EK beat mein hota hai, dobara kisi aur beat mein nahi). Agar topic
"engagement ball" aur "assassination
attempt" bolta hai, to kahani mein WAHI engagement ball scene aur WAHI
assassination attempt hona ZAROORI hai — koi generic "mate-bond pulls him to
a stranger" jaisa alag/default plot mat likho. Har beat is topic ke seedha
andar se aana chahiye — heroine kaun hai, uska kaam/haalat kya hai, Alpha
King se uska taluq kaisa shuru hota hai, kya khatra/scheme hai — SAB isi
topic se aayega, GENERIC TROPE se nahi.

Neeche diya "SHAPE" sirf structure batata hai (kahani kis tarah aage badhti
hai) — ye maloomat NAHI deta ke kya HOTA hai, wo sirf topic/keyEvents se
aata hai.

SHAPE (structure, maloomat nahi):
setup → inciting incident (topic ke mutabiq) → Alpha King ke sath forced
proximity → escalating danger/tension (topic ke mutabiq) → claiming/bonding
scene → crisis/near-loss (topic ke mutabiq — agar topic mein ek khaas khatra
diya hai jaise "assassination attempt at an engagement ball," to WAHI khatra
istemal karo) → resolution (villain qanooni/samaji tareeqe se saza pata hai)
→ natural anjaam (seasons-passed time-skip, symbolic callback).

Qaide:
- beat 1 = HOOK (kahani ki dramatized shuruaat): seedha in-media-res
  cold-open scene, chhota chaunkane wala pehla jumla — koi sawal nahi, koi
  "imagine" nahi, koi "in this story" nahi
- YE EK MUSALSAL, BEHTA HUA COMPLETE STORY hai — koi "Chapter 1", "Chapter 2"
  jaisa spoken marker BILKUL NAHI.
- BILKUL 2-3 beats ko "moneyBeat": true do — ye wahi lamhe hain jinke liye
  audience rukti hai: (a) bonding/claiming/mate-mark scene, (b) topic ka apna
  near-death/crisis lamha, (c) climactic confrontation/reveal. Baaki sab
  "moneyBeat": false.
- HAR beat mein (money ho ya na ho) kam se kam ek REAL dialogue exchange ka
  mauqa rakho
- tarteeb aisi ho ke baat qadam ba qadam khulti jaye, dohrav na ho
- aakhri beat = resolution + time-skip natural anjaam (koi "Epilogue" spoken
  label nahi)
- har beat: {"n":1,"title":"...","covers":"is beat mein kya hota hai (kis
  kirdaar ke darmiyan kya dialogue/tension hai bhi batao), 30 words","moneyBeat":false,"keyEvent":""}
  — agar ye beat kisi keyEvent ko cover karta hai, uska EXACT text "keyEvent"
  mein likho (jaisa upar "keyEvents" list mein likha), warna khaali "" rakho

CAST — is topic ke MUKHYA kirdaaron ke FIXED naam do (poori kahani mein YEHI
naam istemal honge, kabhi nahi badlenge):
{"heroine":"naam","alphaKing":"naam","antagonist":"naam ya khaali agar is topic mein koi khaas villain na ho"}

Jawab is shape mein do:
{"keyEvents": ["...", "...", "..."], "cast": {"heroine":"...","alphaKing":"...","antagonist":"..."}, "beats": [ ... ${beats} beats ... ]}

title, covers, cast ke naam ANGREZI (ENGLISH) mein likho.
BAHUT AHEM: jawab sirf ENGLISH mein. Hindi/Urdu script (Devanagari) BILKUL nahi.`,
    { maxTokens: 4800, temperature: 0.85 });

  const list = (Array.isArray(outlineResp?.beats) ? outlineResp.beats : Array.isArray(outlineResp) ? outlineResp : [])
    .filter(b => b && (b.covers || b.title));
  if (list.length < 3) throw new Error(`outline mein sirf ${list.length} beats aaye`);
  const cast = outlineResp?.cast && outlineResp.cast.heroine && outlineResp.cast.alphaKing ? outlineResp.cast : null;
  const keyEvents = Array.isArray(outlineResp?.keyEvents) ? outlineResp.keyEvents.filter(Boolean) : [];

  // ASLI BUG (video 3): model kabhi EK hi keyEvent DO beats ko de deta tha
  // (misal "assassination attempt" beat 10 AUR beat 11 dono ko) — dono beats
  // ko phir "ye tumhara khaas kaam hai" bol diya jata tha, is liye scene do
  // dafa likhi gayi. Ab har keyEvent sirf PEHLE beat ke paas rehta hai.
  {
    const seenKE = new Set();
    for (const b of list) {
      if (!b.keyEvent) continue;
      const norm = String(b.keyEvent).trim().toLowerCase();
      if (seenKE.has(norm)) b.keyEvent = '';
      else seenKE.add(norm);
    }
  }

  const moneyCount = list.filter(b => b.moneyBeat).length;
  U.ok(`outline — ${list.length} beats, ${moneyCount} money beats, cast: ${cast ? `${cast.heroine} / ${cast.alphaKing}${cast.antagonist ? ' / ' + cast.antagonist : ''}` : 'nahi bana (naam drift ka khatra)'}`);
  if (keyEvents.length) {
    U.log(`   topic ke key events (${keyEvents.length}): ${keyEvents.join(' | ')}`);
    const covered = new Set(list.filter(b => b.keyEvent).map(b => b.keyEvent));
    const missed = keyEvents.filter(k => ![...covered].some(c => c.toLowerCase().includes(k.toLowerCase().slice(0, 15)) || k.toLowerCase().includes(c.toLowerCase().slice(0, 15))));
    if (missed.length) U.warn(`ye key events kisi beat ko assign nahi hue: ${missed.join(' | ')} (topic fidelity khatre mein)`);
  } else U.warn('outline ne koi keyEvents nahi diye — topic fidelity check nahi ho saka');

  const castLine = cast
    ? `FIXED CAST (ye naam kabhi mat badlo, poori kahani mein YEHI istemal karo — koi doosra naam mat banao in kirdaaron ke liye): heroine = ${cast.heroine}, Alpha King = ${cast.alphaKing}${cast.antagonist ? `, antagonist = ${cast.antagonist}` : ''}.`
    : '';
  const keyEventsLine = keyEvents.length
    ? `IS TOPIC KE MANDATORY PLOT EVENTS (in mein se koi bhi skip mat karo poori kahani mein): ${keyEvents.join('; ')}.`
    : '';

  // ---------- PASS 1.5: cold-open TEASER (hook se pehle) ----------
  U.log('   teaser (cold-open, hook se pehle)...');
  const teaserRaw = await AI.chat(model,
`Is werewolf/Alpha-King paranormal romance audiobook ka COLD-OPEN TEASER likho
(${TEASER_WORDS - 50}-${TEASER_WORDS + 50} words) — poori kahani ki DRAMATIZED
SHURUAAT se PEHLE aata hai. Ye is niche ke top-performing scripts ka tareeqa
hai: poori kahani ka MARKAZI IRONY/HOOK saaf saaf bata do — jaise ek movie
trailer — phir agla hissa wahi scene dobara, tafseel se, dramatize kar ke
sunayega.

TOPIC/PREMISE (teaser ISI kahani ka ho, koi doosri kahani/kirdaar mat banao):
${topic}
${castLine}
${keyEventsLine}

Qaide:
- Poora premise/twist SAAF bata do — kya hoga, kaun kis se milega, kya khatra
  hai. Kuch chhupao mat, ye trailer hai. SIRF is topic ki kahani — koi alag
  scenario, alag kirdaar, alag setting mat banao.
- Khatam ek inciting-incident lamhe par (jahan se dramatized kahani shuru hogi)
- Plain, punchy, kam-adverb zubaan — koi rhetorical sawal audience se nahi
- SIRF narration, koi heading, "Teaser:" jaisa label mat likho, koi "Chapter"
  lafz kahin nahi
${REGISTER}

Sirf ENGLISH mein likho.`,
    { system: 'You write fiction romance-audiobook cold-open teasers in ENGLISH only, plain conversational language. No headings, no markdown, no labels. Stay strictly on the given topic — never invent an unrelated scenario or different characters.',
      maxTokens: 700, temperature: 0.75 }).catch(() => '');
  const teaser = clean(teaserRaw);
  if (teaser) U.ok(`teaser — ${countWords(teaser)} words`);
  else U.warn('teaser nahi bani — bina teaser ke chalta hun');

  // ---------- PASS 2: beat ba beat narration ----------
  const parts = [];
  const moneyIdx = new Set();   // trim se mehfooz rakhne ke liye (money beats jaan boojh kar lambe hain)
  // ASLI BUG (video 3): sirf pichle 3 jumlon ka "tail" context beat ko diya
  // jata tha — is se model ko pata hi nahi chalta tha ke assassination
  // attempt, wolf-bonding ritual, ya Varys ki giraftari PEHLE HI ho chuki
  // hai, is liye wahi scene dobara likh deta tha (alfaz badal kar). Ab har
  // beat se pehle ek CHHOTI history (kya ho chuka hai) di jati hai.
  const historyLines = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const isHook = i === 0;
    const isLast = i === list.length - 1;
    const isMoney = !!b.moneyBeat;
    if (isMoney) moneyIdx.add(i);
    // tail thora zyada context (3 jumle, pehle 2 the) — beat-to-beat continuity behtar
    const tail = parts.length ? parts[parts.length - 1].split(/(?<=\.)\s+/).slice(-3).join(' ') : '';
    const wordTarget = isHook ? '60-90' : isMoney ? '400-480' : '210-260';
    const wordMax = isHook ? 100 : isMoney ? 500 : 270;

    const historyBlock = historyLines.length
      ? `IS KAHANI MEIN AB TAK YE SAB HO CHUKA HAI (beats 1-${i}) — IN MEIN SE KOI BHI SCENE/WAQIA DOBARA MAT DIKHAO ya dobara mat sunao, sirf inke BAAD ka react/consequence/agla qadam dikhao:\n${historyLines.map((h, idx) => `${idx + 1}. ${h}`).join('\n')}`
      : '';
    const threeDaysCount = parts.reduce((a, p) => a + (p.match(/\bthree days later\b/gi) || []).length, 0);
    const transitionNote = threeDaysCount >= 2
      ? `AHEM: "Three days later" pehle hi ${threeDaysCount} dafa likha ja chuka — IS BEAT MEIN YE PHRASE BILKUL MAT LIKHO. Koi doosra scene-jump transition istemal karo: "The next morning," "That night," "By dawn," "A week passed before," "Within the hour," "Later that evening," "Days blurred together until."`
      : (i > 0 ? `Scene-jump transition har baar alag rakho — "Three days later" zyada se zyada 2 dafa poori kahani mein istemal ho.` : '');

    const chunk = await AI.chat(model,
`Tum ek werewolf/Alpha-King paranormal romance audiobook ki narration likh rahe
ho (FICTION — kahani, kirdaar, jagah sab tumhare banaye hue). SIRF is beat ka
hissa likho.

POORA TOPIC/PREMISE: ${topic}
${castLine}
${keyEventsLine}
${b.keyEvent ? `IS BEAT KA KHAAS KAAM: "${b.keyEvent}" ko yahan dikhana ZAROORI hai — ye topic ka mandatory event hai.` : ''}

IS BEAT KA KAAM (${i + 1}/${list.length}): ${b.title || ''} — ${b.covers || ''}
${tail ? `PICHHLE HISSE KA AAKHIR (isi se baat jori jaye, dohrav na ho, EXACT wahi jumle dobara mat likho):\n"${tail}"` : ''}
${historyBlock}

QAIDE:
- ${wordTarget} words hai TARGET. **${wordMax} words se ZYADA KABHI NAHI —
  ye SAKHT UPPER LIMIT hai.** Is se kam BILKUL nahi, lekin agar shaq ho to
  CHHOTA likho, ZYADA mat likho (model aksar zyada likh deta hai — is dafa
  nahi).
${transitionNote ? `- ${transitionNote}` : ''}
${isHook ? '- Ye HOOK hai (kahani ki dramatized shuruaat, teaser ke BAAD aata hai): seedha in-media-res cold-open scene se shuru karo. Pehla jumla 12 lafz se chhota, koi sawal nahi, koi "imagine" nahi, koi "in this story/video" nahi. Foran ek thos scene/tafseel do.' : ''}
${isMoney ? '- YE MONEY BEAT HAI — jaldi mat guzaro. Poora scene REAL-TIME mein dikhao, dialogue-heavy (kam se kam 4-6 lines ka back-and-forth exchange), jazbaat ko saans lene do. Ye wahi lamha hai jis ke liye audience yahan hai.' : ''}
${isLast ? '- Ye KAHANI KA AAKHRI HISSA hai: villain qanooni/samaji tareeqe se bhugte (tribunal, exile, exposure) — sirf tashaddud se nahi. Ek symbolic bonding object ka callback do. "Seasons passed" jaisa time-skip. Aakhri jumla shuru ke zakhm ko ab theek dikhaye. **BAHUT AHEM: is beat mein "thank you for listening", "like and comment", "subscribe" ya koi bhi audience-facing sign-off/CTA BILKUL mat likho — kahani ke andar hi raho, CTA alag se automatically lagta hai. Agar tum ne CTA jaisa jumla likha to VIDEO KA DO ENDINGS BAN JAYENGE.**' : ''}
- Third-person, past-tense (jab tak topic khud first-person na maange).
- HAR beat mein REAL dialogue rakho jab tak scene bilkul tanha na ho — kam se
  kam ek do-kirdaaron ka exchange, natural contractions ke sath (don't, won't,
  I'm — "I will not" nahi).
- Shock/realization ke lamhe mein NARRATED statement ("she should not know
  this") ki jagah kirdaar ki apni awaaz mein SEEDHA sawal socho ("Why did she
  know this?") — bina quotation marks ke, seedha unspoken thought ki tarah.
- Agar ye beat kisi nayi jagah/waqt mein shuru ho raha hai (scene-jump), pehle
  jumle mein hi saaf time/place marker do ("The next morning," "Three days
  later," "That night") — kabhi bare paragraph-break par mat kudo.
- Alpha King ko winter/ice imagery se describe karo (eyes like winter stone,
  cold as ice) — LEKIN yehi EXACT jumla baar baar mat dohrao, har dafa naya
  angle dhoondo. Heroine hamesha kam-hesiyat se shuru hoti hai.
- Naye jagah/tareekhen/aadad khud bana sakte ho (fiction hai) — LEKIN kirdaaron
  ke naam UPAR diye FIXED CAST se hi lo, naya naam kabhi mat banao unke liye.
- SIRF narration. Koi heading, koi **, koi [scene], koi "Host:", koi bullet,
  koi timestamp, koi "Chapter"/"Epilogue" jaisa spoken label — YE EK
  MUSALSAL COMPLETE STORY hai, chapters mein nahi bati hui.
${spec.style ? `- style: ${spec.style}` : ''}
${REGISTER}

============ ZUBAAN — SAB SE AHEM ============
Narration BILKUL ENGLISH mein likho. Ye video angrezi bolne walon ke liye hai.
Hindi ya Urdu (Devanagari/Arabic) script mein ek lafz bhi nahi. Sirf English.`,
      { system: 'You write fiction romance-audiobook narration in ENGLISH only, in PLAIN, '
              + 'conversational, middle-school-reading-level language (never literary/elevated '
              + 'vocabulary). Never reply in Hindi, Urdu or Devanagari script. Dialogue always '
              + 'uses natural contractions. Never use em-dashes. Output plain narration text '
              + 'only — no headings, no markdown, no commentary. Always meet the requested '
              + 'word count. Invent places, dates and numbers freely, but NEVER rename the '
              + 'fixed cast characters given in the prompt — this is fiction, not a factual '
              + 'documentary, but character names must stay perfectly consistent throughout.',
        // maxTokens EK HARD BACKSTOP hai — asli run mein model ne 400+ words
        // likhe jahan 210-260 manga tha, is se poori script budget se bahut
        // zyada ho gayi thi. LEKIN bahut tang cap (500) beech dialogue mein
        // hi kaat deta tha (unclosed quote wale jumle) — ab thora zyada
        // saans di hai, aur closeSentence() adhoore jumle ko khud kaat deta
        // hai chahe cap lag jaye.
        maxTokens: isMoney ? 1100 : isHook ? 220 : 620, temperature: 0.8 });

    let c = closeSentence(clean(chunk));

    // PEHRA: model kabhi Hindi/Urdu mein likh deta hai (asli bug tha) — pakro aur dobara mango
    if (/[ऀ-ॿ؀-ۿ]/.test(c)) {
      U.warn(`beat ${i + 1} Hindi/Urdu mein aaya — English mein dobara maang raha hun`);
      const again = await AI.chat(model,
`Rewrite this fiction romance narration in ENGLISH. Same meaning, same length,
plain narration only — no headings, no markdown. English only.

${c}`, { maxTokens: 2000, temperature: 0.4 }).catch(() => '');
      const fixed = clean(again);
      if (fixed && !/[ऀ-ॿ؀-ۿ]/.test(fixed)) c = fixed;
      else throw new Error(`beat ${i + 1} English mein nahi aaya — model badlo (config.models.script)`);
    }

    // aakhri beat mein CTA leak ho gaya ho to nikaal do (real CTA alag se lagta hai)
    if (isLast) {
      const before = countWords(c);
      c = stripLeakedCta(c);
      if (countWords(c) < before) U.warn(`aakhri beat mein CTA-jaisa jumla mila — nikaal diya`);
    }

    parts.push(c);
    historyLines.push(`${b.title || 'beat ' + (i + 1)}: ${(b.keyEvent || b.covers || '').slice(0, 90)}`);
    U.log(`      beat ${i + 1}/${list.length}${isMoney ? ' [MONEY]' : ''}: ${countWords(c)} words — ${(b.title || '').slice(0, 38)}`);
  }

  // ---------- pura beat kisi pichle beat ka dobara-scene ho to gira do ----------
  {
    const protectedForScene = new Set([0, parts.length - 1]);
    const dropSet = dedupeDuplicateScenes(parts, protectedForScene);
    if (dropSet.size) {
      U.warn(`${dropSet.size} beat(s) kisi pichle beat ka dobara-scene the — gira diye: ${[...dropSet].map(i => i + 1).join(', ')}`);
      for (const i of dropSet) parts[i] = '';
    }
  }

  // ---------- exact duplicate paragraphs girao ----------
  {
    const d = dedupeParagraphs(parts);
    if (d.dropped) U.warn(`${d.dropped} duplicate paragraph(s) mile aur nikaal diye`);
    for (let i = 0; i < parts.length; i++) parts[i] = d.parts[i];
  }

  // ---------- kam pade to sab se chhote beats barhao (STORY_MIN tak) ----------
  let total = countWords(parts.join('\n\n'));
  let rounds = 0;
  while (total < STORY_MIN && rounds < 3) {
    rounds++;
    U.warn(`${total}/${STORY_MIN} words (story) — kam hai, chhote hisson ko barha raha hun (pass ${rounds})`);
    const order = parts.map((p, i) => ({ i, w: countWords(p) })).sort((a, b) => a.w - b.w);
    for (const { i } of order) {
      if (countWords(parts.join('\n\n')) >= STORY_MIN) break;
      const more = await AI.chat(model,
`Ye werewolf/Alpha-King romance audiobook narration ka ek hissa hai. ${castLine}
Isi scene mein 150-200 words ka NAYA DIALOGUE-HEAVY tafseel likho (kirdaar
baat karein, natural contractions ke sath, FIXED CAST ke naam hi istemal
karo) — dohrav BILKUL nahi. Sirf naya matn do (purana na dohrao), koi heading
nahi. Fiction hai, naye tafseel khud banao.
${REGISTER}

Sirf ENGLISH mein likho — Hindi/Urdu script bilkul nahi.

MOJOODA HISSA:
${parts[i]}`, { maxTokens: 1200, temperature: 0.85 }).catch(() => '');
      const add = clean(more);
      if (countWords(add) > 40) {
        parts[i] += '\n\n' + add;
        U.log(`      beat ${i + 1} barhaya: +${countWords(add)} words`);
      }
    }
    total = countWords(parts.join('\n\n'));
  }

  // ---------- zyada ho to STORY_MAX tak trim ----------
  let finalParts = parts;
  if (total > STORY_MAX) {
    U.warn(`${total}/${STORY_MAX} words (story) — zyada hai, trim kar raha hun`);
    const trimmed = trimToMax(parts, STORY_MAX, moneyIdx);
    finalParts = trimmed.parts;
    total = trimmed.total;
  }

  // teaser sab se aage lagao
  if (teaser) finalParts = [teaser, ...finalParts];
  total += countWords(teaser);

  // ---------- PASS 3: CTA / outro (competitor-style — KOI rhetorical sawal nahi) ----------
  const cta = await AI.chat(model,
`Is werewolf/Alpha-King romance audiobook story ka OUTRO likho (~${CTA_WORDS} words).

QAIDE (is niche ke competitor channels ki tehqeeq se — GHAUR SE PARHO):
- "Thank you for listening to this story..." jaise garmjoshi wale jumle se shuru karo
- Like/comment karne ki halki si guzarish karo ("if you enjoyed this story,
  don't forget to like and leave a comment — it really helps support the channel")
- "Let me know what you thought in the comments" jaisa AAM guzarish theek hai
- **KOI DIRECT rhetorical sawal audience se MAT PUCHHO jo kisi kirdaar/faisle
  ke bare mein ho** (misal "did you believe his surrender was..." jaisa kuch
  BILKUL NAHI likhna — ye is niche ka rule tod deta hai)
- Garmjoshi wale sign-off par khatam karo (koi naam mat lo, generic "Much
  love" jaisa chhoro)
- Koi "subscribe" button jaisa hard-sell nahi — sirf comment/engagement CTA
- SIRF plain narration text, koi heading, koi markdown
- **SIRF EK PARAGRAPH do, bas.** Garmjoshi wale thanks se seedha sign-off tak
  ek hi paragraph mein jao. Doosra paragraph, kahani ka recap, ya ek aur
  "their story ended..." jaisa dobara wrap-up BILKUL mat likho — is se video
  ke DO ENDINGS ban jate hain.
- Neeche diya "kahani ka aakhri hissa" SIRF TONE/LEHJA samajhne ke liye hai —
  in EXACT jumlon ko, poore ya adhoore, CTA ke andar KAHIN BHI dobara mat
  likhna. Apna NAYA, ALAG CTA likho jo sirf usi lehje se match kare.
${REGISTER}

KAHANI KA AAKHRI HISSA (sirf tone ke liye parho — verbatim mat dohrana):
${finalParts[finalParts.length - 1].split(/(?<=\.)\s+/).slice(-3).join(' ')}

Sirf ENGLISH mein likho.`,
    { maxTokens: 400, temperature: 0.8 }).catch(() => '');
  let ctaClean = clean(cta);
  // ASLI BUG (video 3): model kabhi CTA ke sath EK AUR paragraph jorta tha
  // (kahani ka dobara-recap "their story ended..." jaisa) — do endings ban
  // jate the. Sirf PEHLA paragraph rakhte hain, chahe model ne 2 diye ho.
  if (ctaClean) {
    const ctaParas = ctaClean.split(/\n\s*\n/).filter(Boolean);
    if (ctaParas.length > 1) {
      U.warn(`CTA mein ${ctaParas.length} paragraphs aaye — sirf pehla rakh raha hun (double-ending se bachne ke liye)`);
      ctaClean = ctaParas[0];
    }
  }
  // ASLI BUG (video 4): prompt mein tone-reference ke liye diye gaye story
  // ke AAKHRI jumle, model ne CTA ke BEECH mein hu-ba-hu dobara likh diye
  // (paragraph ek hi tha, is liye upar wala check nahi pakda). Yahan un
  // exact jumlon ko CTA se dhoond kar nikal dete hain agar phir bhi aa jayen.
  if (ctaClean) {
    const tailForCta = finalParts[finalParts.length - 1].split(/(?<=\.)\s+/).slice(-3).join(' ');
    const tailSentences = new Set(
      tailForCta.split(/(?<=[.?!])\s+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 15));
    if (tailSentences.size) {
      const before = countWords(ctaClean);
      ctaClean = ctaClean.split(/(?<=[.?!])\s+/)
        .filter(s => !tailSentences.has(s.trim().toLowerCase()))
        .join(' ').trim();
      if (countWords(ctaClean) < before) U.warn('CTA mein story ka aakhri jumla verbatim mila — nikaal diya');
    }
  }
  if (ctaClean && !/[ऀ-ॿ؀-ۿ]/.test(ctaClean)) {
    finalParts = [...finalParts, ctaClean];
    total += countWords(ctaClean);
    U.ok(`CTA/outro — ${countWords(ctaClean)} words`);
  } else U.warn('CTA generate nahi hui — script CTA ke bagair chhod raha hun');

  const text = finalParts.filter(p => p && p.trim()).join('\n\n');
  fs.writeFileSync(dest, text + '\n');
  st.meta.scriptWords = total;
  st.meta.beats = list.length;
  U.ok(`script.txt — ${total} words (target ${WC.min}-${WC.max}), ${text.split(/\n\s*\n/).length} paragraph`);
  if (total < WC.min * 0.95 || total > WC.max * 1.05)
    U.warn(`target range se bahar — chaho to: --only=script --redo`);

  // ---- QA visibility (script-comparison-report.md ke metrics) ----
  const dPct = dialoguePct(text);
  U.log(`   dialogue: ~${dPct}% (target 30-40%+, competitor tha ~50%)`);
  if (dPct < 20) U.warn('dialogue % kaafi kam hai — agla run mein zyada dialogue-heavy beats banenge');
  const em = (text.match(/[—–]/g) || []).length;
  if (em) U.warn(`${em} em-dash reh gaye (clean() ke bawajood) — check karo`);
  const rep = topRepeatedPhrase(text);
  if (rep) U.warn(`motif dohrav: "${rep.g}" ${rep.n} dafa istemal hua (max 2-3 acha hai)`);
  if (cast) {
    for (const [role, name] of Object.entries(cast)) {
      if (!name) continue;
      const n = (text.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')) || []).length;
      U.log(`   cast check — ${role} "${name}": ${n} dafa mila${n < 3 ? '  (! kam lag raha, naam drift ho sakta hai)' : ''}`);
    }
  }

  // ---- Claude ke liye kaam (config.claudeWrites) ----
  const CW = cfg.claudeWrites || {};
  if (CW.hook || CW.humanPass) {
    const todo = U.p(id, 'CLAUDE-TODO.md');
    fs.writeFileSync(todo,
`# Claude — ye script tumhe theek karni hai

DeepSeek ne poora script likh diya hai: \`work/${id}/script.txt\`
Structure: **TEASER** (cold-open, ~${TEASER_WORDS} words) → **HOOK** (dramatized
shuruaat, 60-90 words) → poori musalsal story (koi chapter labels nahi) →
natural anjaam → CTA. Ab do kaam tumhare hain. **Seedha usi file ko edit karo.**
${cast ? `\nCAST (ye naam CONSISTENT hone chahiye poori script mein — parhte waqt check karo): heroine = ${cast.heroine}, Alpha King = ${cast.alphaKing}${cast.antagonist ? `, antagonist = ${cast.antagonist}` : ''}. Agar kahin naam badla mila (jaise "${cast.alphaKing}" achanak kisi aur naam se likha ho), theek kar do.\n` : ''}
## 1. HOOK (dramatized shuruaat, teaser ke BAAD — pehle 60-90 lafz) — poora naya likho
${CW.hook ? `
DeepSeek ke hook ko **mita kar apna likho** (teaser ko chhero, wo theek hai).
Is niche (werewolf/Alpha-King romance) ki tehqeeq se pata chala hai ke best
hooks aise hote hain — inhi ka lehja pakdo:

- "The mating auction was where you went when no one wanted you..."
- "In the halls of the Alpha King's palace, piercing screams echo without end..."
- "The blizzard howls like a living thing, rattling the windows of Anna's
  isolated cabin..."
- "The scream never left her throat. It lived there, burned there, as Alpha
  King Cayden Thorne sank his fangs into another woman's neck."

Qaide:
- pehla jumla 12 lafz se chhota — koi sawal nahi, koi "imagine" nahi
- seedha in-media-res scene mein girao, koi "in this story" nahi
- ek thos physical detail ya action foran (ice/winter imagery Alpha King ke
  liye, kam-hesiyat heroine ka scene-setting)
- doosre-teesre jumle tak core premise/conflict saaf ho
- koi rhetorical sawal audience se nahi (documentary style nahi, ye fiction hai)
- SAADI zubaan — mushkil/adabi lafz nahi, koi em-dash nahi
` : '(band hai — config.claudeWrites.hook = false)'}

## 2. INSANI LEHJA — poore script mein
${CW.humanPass ? `
**Zyada se zyada ${CW.humanPassMaxWords || 500} lafz** badal sakte ho. Kya karna hai:
- jahan jumle ek jaise lambe hain, ek chhota jumla daal do
- AI wale lafz nikaalo: "moreover", "furthermore", "it's worth noting",
  "in conclusion", "delve", "testament to", "stands as"
- **koi em-dash reh gaya ho to comma ya naya jumla banao**
- **uncontracted dialogue** ("I will not") mile to contract karo ("I won't")
- koi ek hi phrase 3+ dafa dohraya mila (log mein "motif dohrav" warning
  dekho) to us mein se kam se kam ek-do jagah alfaz badal do
- **cast ke naam consistent hain ya nahi zaroor check karo** (log mein "cast
  check" lines dekho — jis naam ki ginti kam ho usay dhoond kar theek karo)
- prose ko is niche ke andaz ke qareeb rakho: SAADI, aam-fahm — adabi/mushkil
  lafz mat daalo, competitor ki "middle-class vocabulary" jaisa rakho
- lambi list ko chalte hue jumle mein badal do
- kul lafzon ki tadaad wahi rehni chahiye (±5%) — **script SAKHT ${WC.min}-${WC.max} words ke andar rehni chahiye**
` : '(band hai)'}

## Kya NAHI karna
- script ki lambai mat badlo bahut zyada (VO ka waqt is par chalta hai, aur
  word count range sakht hai)
- \`[scene]\`, \`Host:\`, headings, markdown — kuch mat daalo, sirf saada nasr
- CTA/outro (script ke aakhir mein) mat chhero — wo pehle se niche ke CTA
  style se likha ja chuka hai (koi rhetorical sawal nahi)
- teaser mat chhero (wo already premise khol chuka hai, hook use dramatize
  karta hai — dono alag kaam karte hain)

## Ho jaye to
\`\`\`bash
node run.js --video=${id} --from=2
\`\`\`
`);
    U.warn('script tayyar — ab HOOK aur insani lehja Claude ko likhna hai');
    U.log(`   parho: work/${id}/CLAUDE-TODO.md`);
  }

  return true;
};
