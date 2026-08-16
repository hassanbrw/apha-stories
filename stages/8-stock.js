// ============================================================
//  STAGE 8 — STOCK (YouTube + yt-dlp, Gemini trim point chunta hai)
//
//  User ka usool: HAR clip ALAG video se aaye (copyright se bachne ke liye
//  ek hi video se poori doc nahi bhari ja sakti), aur clip narration se mile.
//
//  Har stock slot par:
//    1) keyword se YouTube search (yt-dlp, koi API key nahi)
//    2) jo video pehle kisi slot mein use ho chuki — chhod do
//    3) beech se ~40s utaro (poori video nahi)
//    4) Gemini us tukre ko dekh kar behtareen 4-6s ka lamha batata hai
//    5) wahi lamha kaat kar stock/stk_SSSSS_EEEEE.mp4
// ============================================================
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const U = require('../lib/util.js'), AI = require('../lib/ai.js');

const tagOf = s => `${String(Math.floor(s.start)).padStart(5, '0')}_${String(Math.floor(s.end)).padStart(5, '0')}`;
const ff = (a, to = 600000) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], { timeout: to });
const ytdlp = (a, to = 600000) => execFileSync('yt-dlp', a, { timeout: to, encoding: 'utf8', maxBuffer: 1 << 26 });

// Aise videos jo B-roll ke KAAM KE NAHI — banda camera ke saamne baat kar
// raha hai, khabrein, tutorial, review, ya screen par likhai/logo.
// (Asli natija: pehli koshish mein gardening vlog, news interview aur
//  "COMPOST TUMBLER" likha hua clip aa gaya tha.)
const BAD_TITLE = /(how to|tutorial|guide|vlog|interview|podcast|review|reaction|explained|episode|ep\.?\s*\d|top \d+|q&a|tips|mistakes|why i |my |our |story|news|report|update|live|webinar|lecture|sermon|talk|discussion|part \d|day \d|challenge|shorts?)\b/i;
const GOOD_TITLE = /(b[- ]?roll|stock footage|no copyright|copyright free|free footage|royalty[- ]free|cinematic|drone|aerial|4k|timelapse|time lapse|footage)/i;

// Query ko FOOTAGE wali query banao — warna YouTube content videos deta hai
const footageQ = q => `${q} b roll no copyright stock footage`;

function search(q, n) {
  try {
    const out = ytdlp(['--flat-playlist', '--print', '%(id)s\t%(duration)s\t%(title)s\t%(channel)s',
      '--playlist-end', String(n), `ytsearch${n}:${q}`]);
    return out.trim().split('\n').filter(Boolean).map(l => {
      const [id, dur, title, channel] = l.split('\t');
      return { id, dur: +dur || 0, title: title || '', channel: channel || '' };
    }).filter(v => v.id && v.dur > 15 && v.dur < 1800);
  } catch { return []; }
}

// achha lagne wale pehle
function rank(list) {
  return list
    .filter(v => !BAD_TITLE.test(v.title))
    .map(v => ({ ...v, score: (GOOD_TITLE.test(v.title) ? 2 : 0) + (GOOD_TITLE.test(v.channel) ? 1 : 0) + (v.dur < 300 ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);
}

module.exports = async function (spec, cfg, st) {
  const id = spec.id;
  const tlF = U.p(id, 'timeline.json');
  const timeline = JSON.parse(fs.readFileSync(tlF, 'utf8'));
  const slots = timeline.filter(s => s.kind === 'stock');
  if (!slots.length) { U.warn('koi stock slot nahi'); return true; }
  const dest = U.p(id, 'stock');
  const tmp = path.join(dest, '_tmp');
  fs.mkdirSync(tmp, { recursive: true });

  const usedF = U.p(id, 'stock', 'used.json');
  const used = new Set(fs.existsSync(usedF) ? JSON.parse(fs.readFileSync(usedF, 'utf8')) : []);
  const save = () => fs.writeFileSync(usedF, JSON.stringify([...used], null, 1));

  U.log(`   ${slots.length} stock clips — har ek ALAG video se`);
  let ok = 0, fail = 0, tries = 0;

  const MINH = cfg.stock.minHeight || 1080;
  const CONC = +(process.env.STOCK_CONC || cfg.concurrency?.stock || 3);
  let cursor = 0;
  const worker = async () => {
   while (cursor < slots.length) {
    const n = cursor++;
    const s = slots[n];
    const tag = tagOf(s);
    const out = path.join(dest, `stk_${tag}.mp4`);
    if (fs.existsSync(out)) { ok++; s.file = `stock/stk_${tag}.mp4`; continue; }
    const q = s.q || s.text.split(/\s+/).slice(0, 4).join(' ');
    const want = Math.min(cfg.stock.maxClipSeconds || 6, Math.max(4, s.dur));

    // candidates ek dafa nikaalo, phir ek ek kar ke azmao
    let cands = rank(search(footageQ(q), 10)).filter(v => !used.has(v.id));
    if (cands.length < 3) cands = cands.concat(rank(search(q + ' footage 4k', 10)).filter(v => !used.has(v.id)));
    if (!cands.length) { U.warn(`[${n + 1}/${slots.length}] "${q}" — koi footage nahi mili`); fail++; continue; }

    let got = false;
    for (const v of cands.slice(0, 5)) {
      used.add(v.id); save();                       // azmayi hui video dobara nahi
      const from = Math.max(5, Math.floor(v.dur * 0.3));
      const raw = path.join(tmp, `${v.id}.mp4`);
      try {
        // SIRF 1080p ya us se behtar. Chhoti quality wali video 1920x1080 par
        // phaila kar dhundhli lagti hai.
        if (!fs.existsSync(raw))
          ytdlp(['-f', `bv*[height>=${MINH}][ext=mp4]/bv*[height>=${MINH}]`,
            '--download-sections', `*${from}-${from + 40}`, '--force-keyframes-at-cuts',
            '--merge-output-format', 'mp4', '-o', raw, '--no-playlist', '--quiet', '--no-warnings',
            `https://www.youtube.com/watch?v=${v.id}`], 420000);
      } catch { continue; }                          // 1080p nahi mili to agla
      if (!fs.existsSync(raw)) continue;

      // ---- trim (jo asal mein video mein jayega) ----
      const at = Math.max(2, (40 - want) * 0.35);
      try {
        ff(['-ss', at.toFixed(2), '-i', raw, '-t', want.toFixed(2), '-an',
            '-vf', `scale=${cfg.canvas.width}:${cfg.canvas.height}:force_original_aspect_ratio=increase,crop=${cfg.canvas.width}:${cfg.canvas.height},fps=${cfg.canvas.fps},setsar=1`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', out]);
      } catch { fs.rmSync(raw, { force: true }); continue; }

      // ---- Gemini TRIMMED clip ko dekhti hai (yehi video mein jayega) ----
      let verdict = 'ok', why = '';
      if (cfg.stock.verifyWithGemini !== false) try {
        const small = path.join(tmp, `chk_${tag}.mp4`);
        ff(['-i', out, '-vf', 'scale=480:-2,fps=6', '-an', '-c:v', 'libx264', '-crf', '32', '-preset', 'veryfast', small]);
        const ans = await AI.analyzeVideo(cfg.models.video, small,
`This ${want.toFixed(0)}-second clip will be used as-is as documentary B-roll for:
"${s.text.slice(0, 180)}"

Answer BAD if ANY of these appear anywhere in it:
- a person talking to the camera (talking head, vlogger, interview, presenter)
- burned-in text, captions, titles, "subscribe" graphics, big logos, watermarks
- split screen or picture-in-picture
- screen recording, photo slideshow, or cartoon

Small corner channel logos are acceptable. The subject only has to be broadly
related (farm, animals, crops, land, tools).

Answer with ONE word, then a short reason:
  GOOD
  or
  BAD <reason>`);
        fs.rmSync(small, { force: true });
        if (/^\s*BAD/i.test(String(ans))) { verdict = 'bad'; why = String(ans).slice(0, 60).replace(/\s+/g, ' '); }
      } catch { /* Gemini na chale to rakh lete hain */ }

      fs.rmSync(raw, { force: true });
      if (verdict === 'bad') {
        fs.rmSync(out, { force: true });
        U.log(`      [${n + 1}] reject: ${why}`);
        continue;                                    // agla candidate
      }
      s.file = `stock/stk_${tag}.mp4`;
      got = true;
      ok++;
      if (ok % 5 === 0) U.log(`   ...${ok}/${slots.length}`);
      break;
    }
    if (!got) { U.warn(`[${n + 1}/${slots.length}] "${q}" — 5 candidates reject`); fail++; }
    fs.writeFileSync(tlF, JSON.stringify(timeline, null, 1));
   }
  };
  U.log(`   ${CONC} slots ek sath`);
  await Promise.all(Array.from({ length: Math.min(CONC, slots.length) }, worker));

  fs.writeFileSync(tlF, JSON.stringify(timeline, null, 1));
  st.meta.stock = { ok, fail, uniqueVideos: used.size };
  U.ok(`${ok}/${slots.length} stock clips — ${used.size} alag YouTube videos`);
  if (fail) U.warn(`${fail} nahi mile (render mein unki jagah image lag jayegi)`);
  return true;
};
