// ============================================================
//  ASS (libass) word-highlight captions — 2026-08-17 rewrite
//
//  Purana tareeqa (tools/captions.py): har active-word state ki ek alag PNG
//  (~10,000 PNGs for a 55min/10K-word video), phir unhein ek alpha-video
//  (qtrle) mein concat+encode kar ke overlay karna — do bhaari steps
//  (~10min PNG-gen + ~41min ka merge-encode jisme ye overlay shamil tha).
//
//  Naya tareeqa: seedha ek .ass subtitle file likho (word timing se, PIL
//  bilkul nahi chahiye), aur usay ffmpeg ke NATIVE `ass=` filter se seedha
//  poore frame par burn karo — usi EK merge-encode pass mein jo particles
//  overlay ke liye pehle se ho raha tha. Koi PNG generation, koi separate
//  alpha-video intermediate, koi separate overlay step nahi — captions ab
//  is single-pass encode ka LAGBHAG FREE hissa hain.
//
//  Bonus: purani duration-inflation class ki bug (cumulative concat-list
//  drift) is design se hi nahi ho sakti — ASS Dialogue lines absolute
//  Start/End timestamps use karti hain, koi cumulative reconstruction nahi.
// ============================================================
const fs = require('fs');

function hexToBGR(hex) {
  const h = hex.replace('#', '');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `${b}${g}${r}`.toUpperCase();
}

function toAssTime(sec) {
  // ASLI BUG (2026-08-20): centiseconds ko alag Math.round karne se cs=100
  // ban jata tha (e.g. 41.996s -> h/m/s = 41, cs = round(0.996*100) = 100),
  // jo "0:00:41.100" jaisa GHALAT timestamp banata (cs hamesha 2-digit,
  // 00-99 hona chahiye). Ye malformed string phir render.js ke strict
  // assTimeToSec() parser ko "0" bana deti thi -> wo caption line har
  // segment mein leak ho kar poore frame par stack ho jati thi. Fix: pehle
  // poore time ko centiseconds mein round karo, PHIR h/m/s/cs nikalo — is
  // tarah carry khud-ba-khud second/minute/hour mein chala jata hai.
  const totalCs = Math.round(Math.max(0, sec) * 100);
  const cs = totalCs % 100;
  const totalSec = (totalCs - cs) / 100;
  const s = totalSec % 60;
  const totalMin = (totalSec - s) / 60;
  const m = totalMin % 60;
  const h = (totalMin - m) / 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(t) {
  // { } curly braces ASS override-tag syntax hain — literal text mein aayen
  // to escape karna zaroori hai warna filter/style break ho jata hai.
  return t.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

// tools/captions.py jaisi hi grouping: ~1.6s ya 10 lafz tak ek group,
// competitor-jaisa 2-line block banane ke liye kaafi lafz.
function groupWords(words) {
  const groups = [];
  let cur = [];
  for (const w of words) {
    const t0 = w.start ?? w.begin, t1 = w.end ?? w.stop, tx = w.word ?? w.text;
    if (t0 == null || t1 == null || !tx) continue;
    cur.push({ start: +t0, end: +t1, text: String(tx).trim() });
    if (cur.length >= 10 || (cur[cur.length - 1].end - cur[0].start) > 1.6) {
      groups.push(cur); cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// wordsFile, outPath: .ass banayega. Returns {groups: N}.
function generateAssCaptions(wordsFile, outPath, { W = 1920, H = 1080, total, highlightHex = '#FFD700', fontName = 'DejaVu Sans' } = {}) {
  const words = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));
  const groups = groupWords(words);
  const hiliteBGR = hexToBGR(highlightHex);

  // 2026-08-17: user ne bold aur size dono thora bara maangey — font size
  // 0.044→0.052 (~18% bara), Outline (stroke) 3→4 taake text aur bhaari/
  // bold nazar aaye style level par bhi (Bold=-1 flag pehle se tha).
  const fontSize = Math.round(H * 0.052);
  const marginLR = Math.round(W * 0.07);   // ~86% max text width jaisa purana MAX_TEXT_W
  const marginV = Math.round(H * 0.035);   // BOTTOM_GAP jaisa

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,${marginLR},${marginLR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = [];
  for (const g of groups) {
    const groupEnd = Math.min(g[g.length - 1].end + 0.06, total);
    if (groupEnd <= g[0].start) continue;
    const fullText = g.map(w => w.text.toUpperCase()).join(' ');
    for (let i = 0; i < g.length; i++) {
      const segStart = g[i].start;
      const segEnd = i + 1 < g.length ? g[i + 1].start : groupEnd;
      if (segEnd <= segStart) continue;
      // Har lafz ka apna override: active lafz gold, baaki style-default
      // (white) — poora group text har baar dobara likhte hain taake
      // wrap/layout HAMESHA same rahe (koi word line-jump na kare jab
      // highlight move ho).
      const parts = g.map((w, idx) => {
        const t = escapeAssText(w.text.toUpperCase());
        return idx === i ? `{\\c&H${hiliteBGR}&}${t}{\\c&H00FFFFFF&}` : t;
      });
      lines.push(`Dialogue: 0,${toAssTime(segStart)},${toAssTime(segEnd)},Default,,0,0,0,,${parts.join(' ')}`);
    }
  }

  fs.writeFileSync(outPath, header + lines.join('\n') + '\n', 'utf8');
  return { groups: groups.length, lines: lines.length };
}

module.exports = { generateAssCaptions };
