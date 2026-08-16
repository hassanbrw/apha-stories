// ============================================================
//  STAGE 7 — AVATAR (HeyGen, browser automation)
//
//  Chalaki: timeline mein avatar ke 10-16 alag tukre hote hain. Har tukre ka
//  alag HeyGen render 2-4 ghante le leta. Is liye:
//     1) sab avatar tukron ki AUDIO ek file mein jodo (kul ~3 min)
//     2) HeyGen par SIRF EK render
//     3) us video ko wapas tukron mein kaat lo (wahi tarteeb, wahi lambai)
//  Lip-sync theek rehta hai kyunki awaaz bilkul wahi hai.
//
//  "Generate" kabhi nahi dabate — render ke baad preview ka mp4 URL
//  DOM se uthate hain (credit kharch nahi hota).
// ============================================================
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const U = require('../lib/util.js');

const HEY = path.resolve(U.ROOT, '..', 'heygen-tool');
const ff = (a, to = 900000) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], { timeout: to });
const tagOf = s => `${String(Math.floor(s.start)).padStart(5, '0')}_${String(Math.floor(s.end)).padStart(5, '0')}`;

module.exports = async function (spec, cfg, st) {
  const id = spec.id;
  const timeline = JSON.parse(fs.readFileSync(U.p(id, 'timeline.json'), 'utf8'));
  const slots = timeline.filter(s => s.kind === 'avatar');
  if (!slots.length) { U.warn('koi avatar slot nahi'); return true; }
  const vo = U.p(id, 'voice', 'voiceover.mp3');
  const dest = U.p(id, 'avatar');
  fs.mkdirSync(dest, { recursive: true });

  const done = slots.filter(s => fs.existsSync(path.join(dest, `avatar_${tagOf(s)}.mp4`)));
  if (done.length === slots.length) { U.ok(`${done.length} avatar clips pehle se`); return true; }

  const tmp = U.p(id, 'avatar', '_tmp');
  fs.mkdirSync(tmp, { recursive: true });

  // ---------- 1. avatar tukron ki audio jodo ----------
  U.log(`   ${slots.length} avatar tukre — audio jod raha hun`);
  const pieces = [];
  for (const s of slots) {
    const f = path.join(tmp, `a_${tagOf(s)}.wav`);
    ff(['-ss', s.start.toFixed(3), '-t', s.dur.toFixed(3), '-i', vo, '-ar', '44100', '-ac', '1', f]);
    pieces.push(f);
  }
  const listF = path.join(tmp, 'a.txt');
  fs.writeFileSync(listF, pieces.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const joined = path.join(tmp, 'avatar_audio.mp3');
  ff(['-f', 'concat', '-safe', '0', '-i', listF, '-c:a', 'libmp3lame', '-b:a', '192k', joined]);
  const totalA = U.seconds(joined);
  U.log(`   kul avatar awaaz: ${Math.floor(totalA / 60)}m ${Math.round(totalA % 60)}s → HeyGen`);

  // ---------- 2. HeyGen par ek render ----------
  const big = path.join(tmp, 'avatar_full.mp4');
  if (!fs.existsSync(big)) {
    U.log('   HeyGen browser khul raha hai (Generate nahi dabega)...');
    execFileSync('node', [path.join(HEY, 'lib', 'render-test.js')], {
      cwd: HEY, stdio: 'inherit', timeout: 2400000,
      // "Naveed" pehle ka TEST avatar tha. Asli avatar user ki apni tasveer
      // se bana hai — spec mein "HeyGenAvatar:" se badla ja sakta hai.
      env: { ...process.env, HEYGEN_AUDIO: joined, HEYGEN_OUT: big,
             HEYGEN_AVATAR_NAME: spec.heygenavatar || 'AmishFarmer' },
    });
    // tool apne output/ mein rakhta hai — sab se nayi mp4 utha lo
    if (!fs.existsSync(big)) {
      const od = path.join(HEY, 'output');
      const mp4 = fs.existsSync(od) ? fs.readdirSync(od).filter(f => f.endsWith('.mp4'))
        .map(f => ({ f, t: fs.statSync(path.join(od, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0] : null;
      if (!mp4) throw new Error('HeyGen se video nahi mili');
      fs.copyFileSync(path.join(od, mp4.f), big);
    }
  }
  const gotLen = U.seconds(big);
  U.log(`   HeyGen video: ${Math.round(gotLen)}s (chahiye tha ${Math.round(totalA)}s)`);
  if (gotLen < totalA * 0.8) U.warn('HeyGen video chhoti hai — aakhri tukre adhoore reh sakte hain');

  // ---------- 3. wapas tukron mein kaato ----------
  let off = 0, n = 0;
  for (const s of slots) {
    const out = path.join(dest, `avatar_${tagOf(s)}.mp4`);
    if (!fs.existsSync(out)) {
      try {
        // LIP-SYNC + AWAAZ EK JAISI:
        //   VIDEO  = HeyGen (avatar_full) us offset par
        //   AUDIO  = ORIGINAL ai33 awaaz (avatar_audio.mp3 = wahi jo HeyGen ko
        //            upload ki thi) usi offset par
        // HeyGen ne isi ai33 audio par hont banaye the, is liye lip match karta
        // hai; aur audio khud ai33 hai (HeyGen ka re-encode/pitch-shift nahi) —
        // to avatar ki awaaz baqi video (image/stock) se bilkul milti hai.
        if (process.env.AVATAR_AUDIO === 'heygen') {
          // HeyGen ki apni awaaz (re-encoded) — muqabala ke liye
          ff(['-ss', off.toFixed(3), '-t', s.dur.toFixed(3), '-i', big,
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-b:a', '192k', out]);
        } else {
          // ai33 asli awaaz (default) — pitch baqi video se milta hai
          ff(['-ss', off.toFixed(3), '-t', s.dur.toFixed(3), '-i', big,
              '-ss', off.toFixed(3), '-t', s.dur.toFixed(3), '-i', joined,
              '-map', '0:v:0', '-map', '1:a:0',
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-b:a', '192k', '-shortest', out]);
        }
        n++;
      } catch (e) { U.warn(`tukra ${tagOf(s)} kat nahi saka: ${String(e.message).slice(0, 60)}`); }
    } else n++;
    off += s.dur;
    const sl = timeline.find(x => x.i === s.i); if (sl) sl.file = `avatar/avatar_${tagOf(s)}.mp4`;
  }
  fs.writeFileSync(U.p(id, 'timeline.json'), JSON.stringify(timeline, null, 1));
  st.meta.avatar = n;
  U.ok(`${n}/${slots.length} avatar clips → avatar/`);
  return true;
};
