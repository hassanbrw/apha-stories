// ============================================================
//  STAGE 1b — FACT CHECK (web search ke sath)
//
//  Kyun zaroori hai: pehle hi test mein script ne likha
//  "A typical Amish farm in Lancaster County spans just 5 acres" —
//  jabke asli aankra ~40 acres hai (USDA 2022 county profile).
//  Aisa ek jhoota adad poori video ko be-etibaar kar deta hai.
//
//  Tareeqa:
//    1) script se woh jumle nikalo jin mein ADAD ya thos daawa hai
//    2) OpenRouter ke ":online" model se (asli web search) har daawe ki tasdeeq
//    3) ghalat/be-saboot daawe ko theek karo ya narm karo ("roughly", "in some cases")
//    4) facts.md mein poori report — daawa, faisla, source URL
// ============================================================
const fs = require('fs');
const U = require('../lib/util.js');
const AI = require('../lib/ai.js');

// jumle jin mein adad, percent, dollar, acre, saal ya "most/all/every" jaisa daawa ho
const CLAIMY = /(\$\s?[\d,]+|\b\d[\d,.]*\s*(percent|%|acres?|dollars?|years?|months?|times|hectares?|cows?|people|families|members)\b|\b(all|every|most|never|always|only)\b)/i;

function sentences(text) {
  return text.split(/\n\s*\n/).flatMap(p =>
    p.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean));
}

module.exports = async function (spec, cfg, st) {
  const src = U.p(spec.id, 'script.txt');
  const script = fs.readFileSync(src, 'utf8');
  const all = sentences(script);
  const claims = [...new Set(all.filter(s => CLAIMY.test(s) && s.split(/\s+/).length > 4))];

  if (!claims.length) { U.ok('koi adad wala daawa nahi mila — kuch check karne ko nahi'); return true; }
  U.log(`   ${all.length} jumle, un mein ${claims.length} par adad/thos daawa hai`);

  const model = cfg.models.facts || ['or:deepseek/deepseek-v4-pro:online'];
  const results = [];
  const batchSize = 5;

  for (let i = 0; i < claims.length; i += batchSize) {
    const batch = claims.slice(i, i + batchSize);
    U.log(`   [${i + 1}-${Math.min(i + batchSize, claims.length)}/${claims.length}] web par check...`);

    let out;
    try {
      out = await AI.chatJson(model,
`You are fact-checking a documentary script about Amish / plain-community farming.
Search the web and check EACH claim below.

For each claim return:
{"i": <index>, "verdict": "supported" | "wrong" | "unverified",
 "fact": "<the correct figure/fact in under 20 words, or empty if supported>",
 "source": "<url>",
 "fix": "<the sentence rewritten to be accurate — hedge with 'roughly'/'in some cases' when the exact figure is uncertain; keep the same tone and length. Empty if supported.>"}

Rules:
- "wrong" only when a real source contradicts the claim
- "unverified" when no source confirms it (then "fix" must hedge or drop the number)
- keep the rewritten sentence in ENGLISH, plain narration, no markdown
- return a JSON array, one object per claim

CLAIMS:
${batch.map((c, k) => `${i + k}. ${c}`).join('\n')}`,
        { maxTokens: 4000, temperature: 0.2 });
    } catch (e) {
      U.warn(`batch fail: ${e.message.slice(0, 80)} — aage barh raha hun`);
      continue;
    }

    for (const r of (Array.isArray(out) ? out : [])) {
      const idx = Number(r.i);
      const claim = claims[idx] ?? batch[0];
      if (!claim) continue;
      results.push({ claim, ...r });
      const mark = r.verdict === 'supported' ? '✓' : r.verdict === 'wrong' ? '✗' : '?';
      U.log(`      ${mark} ${claim.slice(0, 62)}`);
      if (r.verdict !== 'supported' && r.fact) U.log(`         asli: ${String(r.fact).slice(0, 70)}`);
    }
  }

  // ---------- script theek karo ----------
  let fixed = script;
  let changed = 0;
  for (const r of results) {
    if (r.verdict === 'supported') continue;
    const fix = String(r.fix || '').trim();
    if (!fix || fix === r.claim) continue;
    if (fixed.includes(r.claim)) { fixed = fixed.replace(r.claim, fix); changed++; }
  }

  if (changed) {
    fs.writeFileSync(U.p(spec.id, 'script.raw.txt'), script);   // asli bhi rakh lo
    fs.writeFileSync(src, fixed);
  }

  // ---------- report ----------
  const bad = results.filter(r => r.verdict === 'wrong');
  const unv = results.filter(r => r.verdict === 'unverified');
  const md = [
    `# Fact check — ${spec.id}`, '',
    `checked: ${results.length} daawe  |  ghalat: ${bad.length}  |  be-saboot: ${unv.length}  |  theek kiye: ${changed}`, '',
    ...results.filter(r => r.verdict !== 'supported').flatMap(r => [
      `## ${r.verdict === 'wrong' ? '✗ GHALAT' : '? BE-SABOOT'}`,
      `**daawa:** ${r.claim}`,
      r.fact ? `**asli:** ${r.fact}` : '',
      r.source ? `**source:** ${r.source}` : '',
      r.fix ? `**badla gaya:** ${r.fix}` : '',
      '',
    ]),
    '## Supported', '',
    ...results.filter(r => r.verdict === 'supported').map(r => `- ${r.claim}`),
  ].filter(x => x !== '').join('\n');
  fs.writeFileSync(U.p(spec.id, 'facts.md'), md + '\n');

  st.meta.facts = { checked: results.length, wrong: bad.length, unverified: unv.length, fixed: changed };
  U.ok(`${results.length} daawe check hue — ${bad.length} ghalat, ${unv.length} be-saboot, ${changed} theek kiye`);
  U.log(`   poori report: work/${spec.id}/facts.md`);
  if (changed) U.log(`   asli script bhi rakhi hai: work/${spec.id}/script.raw.txt`);
  return true;
};
