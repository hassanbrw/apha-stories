// STAGE 5 — stock keywords: timeline ke har "stock" slot ke liye ek search term
const fs = require('fs');
const U = require('../lib/util.js'), AI = require('../lib/ai.js');

module.exports = async function (spec, cfg, st) {
  const tlFile = U.p(spec.id, 'timeline.json');
  const timeline = JSON.parse(fs.readFileSync(tlFile, 'utf8'));
  const slots = timeline.filter(s => s.kind === 'stock');
  if (!slots.length) { U.warn('koi stock slot nahi — kuch karne ko nahi'); return true; }
  U.log(`   ${slots.length} stock slots`);

  // config.claudeWrites.stockKeywords = true ho to model nahi, CLAUDE likhta hai
  if (cfg.claudeWrites?.stockKeywords) {
    const f = U.p(spec.id, 'CLAUDE-KEYWORDS.md');
    fs.writeFileSync(f,
`# Claude — stock footage ke search keywords tumhe likhne hain

Neeche har wo lamha hai jahan asli footage aani hai. Har ek ke liye **ek**
YouTube search term likho.

Qaide:
- 2-5 lafz, English, aam bol chaal (film ke naam nahi, mushkil istilah nahi)
- wo cheez YouTube par WAKAI maujood ho (kheti, janwar, mandi, mashinri, mausam)
- narration us waqt jo keh raha hai, usi se mile
- mujarrad baat ko theek theek manzar mein badlo
  ("integrated farm system" ✗  →  "mixed farm cows crops aerial" ✓)

Likhne ka tareeqa — \`work/${spec.id}/keywords.json\` banao:

\`\`\`json
[
${slots.slice(0, 3).map(s => `  { "i": ${s.i}, "q": "<search term>" }`).join(',\n')},
  ...
]
\`\`\`

Phir chalao:  \`node run.js --video=${spec.id} --only=keywords\`
(us waqt file mil jayegi aur seedha timeline mein lag jayegi)

---

## Slots (${slots.length})

${slots.map(s => `- **i=${s.i}**  [${Math.round(s.start)}s]  ${s.text.slice(0, 150)}`).join('\n')}
`);
    // agar Claude pehle hi likh chuka hai to laga do
    const kf = U.p(spec.id, 'keywords.json');
    if (fs.existsSync(kf)) {
      const list = JSON.parse(fs.readFileSync(kf, 'utf8'));
      let n = 0;
      for (const r of list) { const s = timeline.find(x => x.i === Number(r.i)); if (s && r.q) { s.q = String(r.q).trim(); n++; } }
      fs.writeFileSync(tlFile, JSON.stringify(timeline, null, 1));
      st.meta.keywords = n;
      U.ok(`${n} keywords (Claude ke likhe huye) lag gaye`);
      return true;
    }
    U.warn('stock keywords Claude ko likhne hain');
    U.log(`   parho: work/${spec.id}/CLAUDE-KEYWORDS.md`);
    return true;
  }

  const BATCH = 15;
  for (let i = 0; i < slots.length; i += BATCH) {
    const part = slots.slice(i, i + BATCH);
    U.log(`   [${i + 1}-${Math.min(i + BATCH, slots.length)}/${slots.length}] keywords...`);
    let out;
    try {
      out = await AI.chatJson(cfg.models.keywords,
`For each narration slot below, give ONE YouTube search term to find real B-roll.

Rules:
- 2-5 words, English, plain everyday words (no film titles, no rare jargon)
- must be footage that actually exists on YouTube (farming, animals, markets, machinery, landscapes)
- it must match what the narration says at that moment
- return JSON array: {"i": <slot number>, "q": "search term"}

SLOTS:
${part.map((s, k) => `${i + k}. ${s.text.slice(0, 200)}`).join('\n')}`,
        { maxTokens: 4000, temperature: 0.4 });
    } catch (e) { U.warn(`batch fail: ${e.message.slice(0, 70)}`); continue; }
    for (const r of (Array.isArray(out) ? out : [])) {
      const s = slots[Number(r.i)];
      if (s && r.q) s.q = String(r.q).trim();
    }
  }
  for (const s of slots) if (!s.q) s.q = s.text.split(/\s+/).slice(0, 4).join(' ');

  fs.writeFileSync(tlFile, JSON.stringify(timeline, null, 1));
  st.meta.keywords = slots.length;
  U.ok(`${slots.length} keywords timeline mein likh diye`);
  slots.slice(0, 6).forEach(s => U.log(`      ${String(Math.floor(s.start)).padStart(4)}s  ${s.q}`));
  return true;
};
