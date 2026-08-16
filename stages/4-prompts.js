// ============================================================
//  STAGE 4 — IMAGE PROMPTS  (timeline ke har "image" slot ke liye ek)
//
//  Niche: werewolf-alpha-romance (fiction romance illustration, NOT documentary).
//
//  Koi avatar/reference photo nahi is niche mein (config.images.characterConsistency
//  = false) — is liye Gemini ka photo-lock "character mode" istemal nahi hota.
//  Consistency DESCRIPTION se aati hai: pehle ek chhota "character sheet" banta
//  hai (naam + fixed physical description har kirdaar ka), phir har slot ka
//  prompt usi description ko follow karta hai taake alag-alag generate hone ke
//  bawajood wahi kirdaar wahi dikhe.
//
//  Agar kisi doosri niche mein avatar/reference photo ho (config.images.
//  characterConsistency = true), to purana photo-lock tareeqa chalta hai
//  (character/normal split, stage 6 Gemini CC toggle istemal karta hai).
//
//  Nateeja timeline.json mein wapas likha jata hai (har slot par prompt + mode),
//  aur prompt file(s) banti hain — stage 6 tool ko chalata hai.
// ============================================================
const fs = require('fs');
const path = require('path');
const U = require('../lib/util.js');
const AI = require('../lib/ai.js');

const tag = s => `${String(Math.floor(s.start)).padStart(5, '0')}_${String(Math.floor(s.end)).padStart(5, '0')}`;

module.exports = async function (spec, cfg, st) {
  const id = spec.id;
  const tlFile = U.p(id, 'timeline.json');
  if (!fs.existsSync(tlFile)) throw new Error('timeline.json nahi mila (stage 3 pehle chalao)');
  const timeline = JSON.parse(fs.readFileSync(tlFile, 'utf8'));
  const slots = timeline.filter(s => s.kind === 'image');
  if (!slots.length) throw new Error('timeline mein koi image slot nahi');

  const ccOn = cfg.images?.characterConsistency === true;   // photo-lock (avatar reference) wala purana tareeqa
  const BATCH = 12;
  let made = 0;

  if (!ccOn) {
    // ---------- DESCRIPTION-based consistency (koi reference photo nahi) ----------
    // STRUCTURED character sheet (JSON, naam+age+appearance) — sirf LLM ki
    // "yaad" par bharosa nahi karte. Har prompt mein jis kirdaar ka naam
    // narration mein aaye, uski age+appearance PROGRAMMATICALLY jabri daali
    // jati hai (ensureCharacterDetails) — LLM bhool bhi jaye to bhi lagta hai.
    const scriptFile = U.p(id, 'script.txt');
    const sample = fs.existsSync(scriptFile) ? fs.readFileSync(scriptFile, 'utf8').slice(0, 6000)
      : (spec.topic_text || spec.topic || '');
    let characters = [];
    try {
      characters = await AI.chatJson(cfg.models.prompts,
`Neeche ek fiction werewolf/Alpha-King paranormal romance story ka shuru hai.
2-4 main kirdaaron ki list banao. Har kirdaar ke liye:
- "name"
- "age" (ek number ya "mid-20s" jaisi approximation)
- "appearance": 1-2 jumlon ki THOS physical description (baal ka rang,
  aankhen, qad-o-qamat, libas ka andaz) — ye POORI kahani mein WAHI rahegi.
  **MARD/male lead (Alpha King/hero) ki appearance mein lafz "handsome"
  zaroor shamil karo. AURAT/female lead (heroine) ki appearance mein lafz
  "beautiful" zaroor shamil karo.** (ye har image prompt mein automatically
  chala jayega, is liye character sheet mein hi likhna zaroori hai.)

JSON array do: [{"name":"...", "age":"...", "appearance":"..."}]
Sirf ENGLISH mein.

${sample}`, { maxTokens: 500, temperature: 0.4 }).catch(() => []);
    } catch {}
    characters = (Array.isArray(characters) ? characters : [])
      .filter(c => c && c.name && c.appearance)
      .map(c => ({ name: String(c.name).trim(), age: String(c.age || '').trim(), appearance: String(c.appearance).trim() }));

    const sheetText = characters.map(c => `${c.name}${c.age ? ` (age ${c.age})` : ''}: ${c.appearance}`).join('\n');
    if (characters.length) U.log(`   character sheet (age+appearance, jabri har prompt mein lagega):\n   ${sheetText.split('\n').map(l => '   ' + l).join('\n')}`);
    else U.warn('character sheet nahi bana — prompts descriptions apne aap se banayenge (thora kam consistent)');

    // narration ya prompt mein kirdaar ka naam mile aur uska appearance
    // snippet abhi tak prompt mein na ho — to age+appearance JABRI daal do
    const descOf = c => `${c.name}${c.age ? `, age ${c.age}` : ''}: ${c.appearance}`;
    function ensureCharacterDetails(prompt, narrationText) {
      let out = prompt;
      for (const c of characters) {
        const esc = c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameRe = new RegExp(`\\b${esc}\\b`, 'i');
        if (!nameRe.test(narrationText) && !nameRe.test(out)) continue;
        const snippet = c.appearance.slice(0, 24).toLowerCase();
        if (out.toLowerCase().includes(snippet)) continue;   // already has real detail
        out = out.replace(/,?\s*no text\s*$/i, '') + `, ${descOf(c)}, no text`;
      }
      return out;
    }

    // ASLI OPTIMIZATION: pehle har batch EK EK karke, agle se pehle wale
    // khatam hone ka intezaar karta tha — 13 batches x ~4 min average = ~56
    // min, jab ke ye sab ALAG-ALAG, EK DOOSRE SE BE-NIYAZ API calls hain
    // (koi local CPU kaam nahi, sirf network wait). Kokoro/multiprocessing
    // wale Windows masle yahan lagoo nahi hote — ye sirf JS ke concurrent
    // network requests hain, koi OS process nahi banta. Ab sab batches ek
    // sath bhej dete hain (Promise.all).
    const batchStarts = [];
    for (let i = 0; i < slots.length; i += BATCH) batchStarts.push(i);
    U.log(`   ${batchStarts.length} batches ek sath bhej raha hun...`);

    await Promise.all(batchStarts.map(async i => {
      const part = slots.slice(i, i + BATCH);
      let out;
      try {
        out = await AI.chatJson(cfg.models.prompts,
`Write ONE cinematic image prompt for each narration slot below, from a
werewolf/Alpha-King paranormal romance FICTION story (medieval-fantasy court
setting — castles, furs, torchlight, snow, wolves — NOT a documentary, NOT
modern day, NOT real people).

${sheetText ? `CHARACTER SHEET (MANDATORY — every time one of these characters appears in a prompt, you MUST literally include their age and physical appearance description inline in that prompt, every single time, not just the first time. Do not assume the image model remembers earlier prompts — each image is generated independently):\n${sheetText}\n\nExample of correct usage: "Aelyn, age 22, dark hair and pale unseeing eyes in a grey wool dress, kneeling in a torch-lit hall, no text" — NOT just "a blind maid kneeling in a hall, no text".\n` : ''}
Prompt rules:
- 20-40 words, English, cinematic PHOTOREALISTIC dark-fantasy romance-novel-cover
  style — like a movie still shot on a real camera. NOT a painting, NOT a
  digital illustration, NOT cartoon/anime/CGI-render style. Real-looking human
  skin texture, hair, and lighting.
- must match what the narration says at that moment
- when a named character from the sheet appears, ALWAYS include their age + appearance inline (see above)
- rich atmosphere: lighting (torchlight/moonlight/winter light), texture, mood
- end every prompt with "no text"

Return JSON array: {"i": <slot number>, "prompt": "..."}

SLOTS:
${part.map((s, k) => `${i + k}. [${Math.round(s.start)}s] ${s.text.slice(0, 220)}`).join('\n')}`,
          { maxTokens: 6000, temperature: 0.75 });
      } catch (e) {
        U.warn(`batch [${i + 1}-${Math.min(i + BATCH, slots.length)}] fail: ${e.message.slice(0, 70)}`);
        return;
      }

      for (const r of (Array.isArray(out) ? out : [])) {
        const s = slots[Number(r.i)];
        if (!s || !r.prompt) continue;
        s.prompt = ensureCharacterDetails(String(r.prompt).trim(), s.text);
        s.mode = 'normal';
        made++;
      }
      U.log(`   [${i + 1}-${Math.min(i + BATCH, slots.length)}/${slots.length}] done`);
    }));

    // jin slots ka prompt na aaya — unhe narration se seedha bana do
    for (const s of slots) {
      if (!s.prompt) {
        s.prompt = ensureCharacterDetails(
          `Cinematic photorealistic dark-fantasy romance movie still, 16:9: ${s.text.slice(0, 110)}, torchlit atmosphere, no text`,
          s.text);
        s.mode = 'normal';
      }
    }

    const pdir = U.p(id, 'prompts');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, 'normal.txt'),
      `# normal — ${slots.length} prompts (har line = ek image, tarteeb = timeline)\n`
      + slots.map(s => s.prompt).join('\n') + '\n');
    fs.writeFileSync(path.join(pdir, 'normal.map.json'),
      JSON.stringify(slots.map(s => ({ i: s.i, tag: tag(s), start: s.start, end: s.end })), null, 1));

    fs.writeFileSync(tlFile, JSON.stringify(timeline, null, 1));
    st.meta.prompts = { total: slots.length, character: 0, normal: slots.length };
    U.ok(`${made}/${slots.length} prompts bane`);
    U.log(`   sab normal mode (description-based consistency)  →  prompts/normal.txt`);
    U.log(`   namoona: ${(slots[0] || {}).prompt?.slice(0, 78) || '—'}`);
    return true;
  }

  // ============================================================
  //  PURANA TAREEQA — avatar/reference photo maujood ho (config.images.
  //  characterConsistency = true). Character/normal split, Gemini CC toggle.
  // ============================================================
  const share = cfg.images?.characterShare ?? 0.5;
  U.log(`   ${slots.length} image slots — ~${Math.round(share * 100)}% character wale`);

  for (let i = 0; i < slots.length; i += BATCH) {
    const part = slots.slice(i, i + BATCH);
    U.log(`   [${i + 1}-${Math.min(i + BATCH, slots.length)}/${slots.length}] prompts...`);

    let out;
    try {
      out = await AI.chatJson(cfg.models.prompts,
`Write ONE image prompt for each narration slot below.

For each slot also choose a mode:
- "character" — the narration is about the recurring on-screen person themself
  (their hands, their face, them working, walking, deciding). The same
  recurring person will be shown via a reference photo, so do NOT describe
  their face or clothes — just say "the person" and describe the ACTION,
  place and light.
- "normal" — the narration is about a place, object, or process where no
  specific person is needed.

IMPORTANT BALANCE: roughly HALF of the slots must be "character". Whenever the
narration involves work being done, a decision, or anyone present in the
scene — choose "character".

Prompt rules:
- 18-35 words, English, cinematic, photorealistic, 16:9 landscape
- must match what the narration says at that moment
- end every prompt with "no text"

Return JSON array: {"i": <slot number>, "mode": "character"|"normal", "prompt": "..."}

SLOTS:
${part.map((s, k) => `${i + k}. [${Math.round(s.start)}s] ${s.text.slice(0, 220)}`).join('\n')}`,
        { maxTokens: 6000, temperature: 0.7 });
    } catch (e) {
      U.warn(`batch fail: ${e.message.slice(0, 70)}`);
      continue;
    }

    for (const r of (Array.isArray(out) ? out : [])) {
      const s = slots[Number(r.i)];
      if (!s || !r.prompt) continue;
      s.prompt = String(r.prompt).trim();
      s.mode = r.mode === 'character' ? 'character' : 'normal';
      made++;
    }
  }

  // jin slots ka prompt na aaya — unhe narration se seedha bana do
  for (const s of slots) {
    if (!s.prompt) {
      s.prompt = `Cinematic photorealistic 16:9 still: ${s.text.slice(0, 110)}, natural light, no text`;
      s.mode = 'normal';
    }
  }

  // ---------- character ka hissa theek karo ----------
  const want = Math.round(slots.length * share);
  let chars = slots.filter(s => s.mode === 'character');
  if (chars.length > want) {
    chars.slice(want).forEach(s => { s.mode = 'normal'; });
  } else if (chars.length < want) {
    const human = /\b(man|men|hands?|he |his |worker|family|buyer|boy|son|figure|person|people)\b/i;
    for (const s of slots) {
      if (chars.length >= want) break;
      if (s.mode === 'normal' && human.test(s.prompt)) { s.mode = 'character'; chars.push(s); }
    }
    if (chars.length < want) {
      const pool = slots.filter(s => s.mode === 'normal');
      const need = want - chars.length;
      const step = Math.max(1, Math.floor(pool.length / Math.max(1, need)));
      for (let k = 0; k < pool.length && chars.length < want; k += step) {
        const s = pool[k];
        s.mode = 'character';
        s.prompt = s.prompt.replace(/,?\s*no text\s*$/i, '') + ', the person present in the scene, no text';
        chars.push(s);
      }
    }
  }

  // character images poori video mein barabar phaili hon (ek sath na aayein)
  {
    const imgs = slots;
    const want2 = Math.round(imgs.length * share);
    imgs.forEach(s => { s.mode = 'normal'; });
    if (want2 > 0) {
      const human = /\b(man|men|hands?|he |his |worker|family|buyer|boy|son|figure|person|people)\b/i;
      const step = imgs.length / want2;
      for (let k = 0; k < want2; k++) {
        const idx = Math.min(imgs.length - 1, Math.round(k * step + step / 2));
        const s = imgs[idx];
        s.mode = 'character';
        if (!human.test(s.prompt)) s.prompt = s.prompt.replace(/,?\s*no text\s*$/i, '') + ', the person present, no text';
      }
    }
  }

  const pdir = U.p(id, 'prompts');
  fs.mkdirSync(pdir, { recursive: true });
  const byMode = m => slots.filter(s => s.mode === m);
  for (const mode of ['character', 'normal']) {
    const list = byMode(mode);
    if (!list.length) continue;
    fs.writeFileSync(path.join(pdir, `${mode}.txt`),
      `# ${mode} — ${list.length} prompts (har line = ek image, tarteeb = timeline)\n`
      + list.map(s => s.prompt).join('\n') + '\n');
    fs.writeFileSync(path.join(pdir, `${mode}.map.json`),
      JSON.stringify(list.map(s => ({ i: s.i, tag: tag(s), start: s.start, end: s.end })), null, 1));
  }

  fs.writeFileSync(tlFile, JSON.stringify(timeline, null, 1));
  st.meta.prompts = { total: slots.length, character: byMode('character').length, normal: byMode('normal').length };
  U.ok(`${made}/${slots.length} prompts bane`);
  U.log(`   character: ${byMode('character').length}  →  prompts/character.txt`);
  U.log(`   normal   : ${byMode('normal').length}  →  prompts/normal.txt`);
  return true;
};
