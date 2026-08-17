// ============================================================
//  STAGE 9 — RENDER (pura ffmpeg, koi editor nahi)
//
//  timeline.json = sach. Har slot ka apna file hai, apne seconds hain.
//  Har slot ka ek chhota mp4 banta hai (bilkul slot ki lambai ka),
//  phir sab concat, phir upar master voiceover + captions.
//
//  Slot kism:
//    image  → zoompan (halka, seedha push — jhatka nahi)
//    stock  → trimmed clip, scale+pad 1920x1080
//    avatar → aadha full-screen, aadha right-side (70% image / 30% avatar)
//
//  Avatar ki apni awaaz MUTE — awaaz sirf ek master voiceover.mp3 se aati hai,
//  is liye lip-sync kabhi nahi phisalta.
// ============================================================
const { execFileSync, execSync, execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs'), path = require('path');
const U = require('../lib/util.js');
const { subSlots } = require('../lib/subslots.js');

const W = 1920, H = 1080;
// ek sath kitne slot clips — pehle hardcoded 3 tha aur config.json ka
// concurrency.render (jo isi maqsad ke liye tha) kabhi padha hi nahi jata
// tha. Ab config se aata hai (env var RENDER_CONC still override kar sakta
// hai).
const ENV_RENDER_CONC = +(process.env.RENDER_CONC || 0);
// ASLI BUG (2026-08-17, render kabhi khatam hi nahi hua — 90 min timeout):
// ye pehle execFileSync tha, jo Node ke poore single-threaded event loop ko
// BLOCK karta hai jab tak ffmpeg khatam na ho. "CONC ek sath" workers
// (Promise.all + async loop) mein koi bhi await point nahi tha is blocking
// call ke ilawa — is liye pehla worker akela hi PURI queue chaba jata tha
// (uska async function kabhi yield hi nahi karta tha), baaki CONC-1 workers
// ko kaam milta hi nahi tha jab tak pehla poora khatam na ho. Matlab CONC
// jo bhi ho (6 ho ya 128), asal mein hamesha 1 hi tha — sab render hamesha
// sequential rahe (isi wajah se aaj raat 183 slots 90 min mein khatam nahi
// huay). Fix: execFile (async, promisified) — ab har await asli OS process
// ko chalne deta hai bina Node ka event loop roke, is liye CONC workers
// GENUINELY parallel chalte hain.
const execFileP = promisify(execFile);
const ff = (args, to = 900000) => execFileP('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { timeout: to, maxBuffer: 1 << 26 });

// Is machine mein Intel Quick Sync (iGPU hardware encoder) hai — CPU x264 se
// tez, aur AHEM: CPU cores khaali chhod deta hai jo isi waqt parallel clip-
// building/Whisper jaisi cheezon ke kaam aate hain. Ek dafa test karte hain,
// warna CPU (libx264) par wapas — dono taraf render chalti rahe.
function detectQSV() {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.2',
      '-c:v', 'h264_qsv', '-f', 'null', '-'], { timeout: 15000 });
    return true;
  } catch { return false; }
}
let _qsv = null;
function useQSV() { if (_qsv === null) _qsv = detectQSV(); return _qsv; }
// crf (CPU) aur global_quality (QSV) ek jaisa scale nahi hain, lekin dono
// "kam = behtar quality" hain is liye seedha number pass karna theek hai.
// threads=0 matlab ffmpeg apna default (saare visible cores) istemal karega —
// akela/aakhri encode (jaise final concat mux) ke liye theek hai. Per-slot
// PARALLEL encode ke liye (CONC clips ek sath) explicit cap zaroori hai —
// warna har ek process khud saare pod cores maangta hai (Kokoro workers wali
// wahi thread-oversubscription ghalti, 2026-08-17 ka fix dekho), jitne bhi
// concurrent clips hon sab aapas mein thread ke liye larte reh jate hain.
function videoEnc(fps, crf, threads = 0) {
  const t = threads > 0 ? ['-threads', String(threads)] : [];
  return useQSV()
    ? ['-c:v', 'h264_qsv', '-preset', 'fast', '-global_quality', String(crf), '-pix_fmt', 'nv12', '-r', String(fps), ...t]
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), ...t];
}

// PARALLELISM processes ki tadaad se aata hai (CONC), har process ke andar
// bahut zyada threading se nahi — CONC jitna bara ho, har ek process utna hi
// kam thread mange (min 1). Local 12-core machine par CONC=6 pehle se test
// ho chuka (auto-threads ke sath 3.5x speedup) — pod ke bare core count par
// bina cap ke har process pura pod maangta to hai, is liye yahan explicit.
function threadsPerJob(conc) {
  const cores = os.cpus().length || conc;
  return Math.max(1, Math.floor(cores / Math.max(1, conc)));
}

function pick(dir, tag) {
  for (const e of ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'mov', 'mkv', 'webm'])
    { const f = path.join(dir, `${tag}.${e}`); if (fs.existsSync(f)) return f; }
  return null;
}
// us waqt ke sab se qareeb maujood image (missing asset ke liye — hamesha
// pehli image lagana repeat banata tha; ye har jagah alag image deta hai)
let _imgCache = null;
function nearestImage(dirs, tSec) {
  if (!_imgCache) {
    const fs2 = require('fs'), p2 = require('path');
    _imgCache = (fs2.existsSync(dirs.images) ? fs2.readdirSync(dirs.images) : [])
      .map(f => { const m = f.match(/^img_(\d+)_(\d+)\.(png|jpe?g|webp)$/i); return m ? { f: p2.join(dirs.images, f), t: +m[1] } : null; })
      .filter(Boolean).sort((a, b) => a.t - b.t);
  }
  if (!_imgCache.length) return null;
  let best = _imgCache[0];
  for (const x of _imgCache) if (Math.abs(x.t - tSec) < Math.abs(best.t - tSec)) best = x;
  return best.f;
}
const tagOf = s => `${String(Math.floor(s.start)).padStart(5, '0')}_${String(Math.floor(s.end)).padStart(5, '0')}`;

// ---------- ek slot ka clip ----------
async function buildSlot(s, i, dirs, cfg, tmp, avatarPool, jobThreads = 0) {
  const fps = cfg.canvas.fps, dur = Math.max(0.5, s.dur);
  const out = path.join(tmp, `s${String(i).padStart(4, '0')}.mp4`);
  if (fs.existsSync(out)) return out;
  const tag = tagOf(s);
  // Ye sirf beech ke tukre hain — aakhri mux mein sab dobara encode hota hai,
  // is liye yahan ultrafast/crf18 (tez + quality mehfooz). medium par 7 guna
  // zyada waqt lagta tha (naapa gaya: 70s vs 10.5s per clip).
  // ultrafast/crf18 par 179 clips = 23 GB ban gaye the aur disk bhar gayi.
  // veryfast/crf21 wahi dikhta hai lekin ~15 guna chhota. Captions band hain,
  // is liye aakhri mux mein video dobara encode nahi hota — yehi clips
  // seedha final.mp4 bante hain, koi quality nuqsan nahi.
  const enc = [...videoEnc(fps, 21, jobThreads), '-an'];
  // Har clip ki apni sahi awaaz us par mux karne ka helper. LIP-SYNC FIX:
  // pehle sab avatar clips mute the aur upar ek master voiceover chalta tha —
  // HeyGen Avatar III ki apni chhoti latency master se match nahi karti thi,
  // is liye hont aur awaaz alag lagte the. Ab har clip apni awaaz khud le
  // jata hai: avatar = HeyGen ki apni awaaz (bilkul synced), image/stock =
  // voiceover.mp3 ka theek us waqt ka tukra. Koi master mux nahi.
  // GLITCH FIX: per-clip audio bilkul nahi. Pehle har clip ki audio MP3 se
  // -ss se kaati jati thi — MP3 seek sample-accurate nahi, har clip ke shuru
  // mein pop/glitch aata tha. Ab sab clips VIDEO-ONLY, aur poore video par ek
  // hi continuous voiceover.mp3 (pura ai33) ek dafa mux hota hai — koi seam,
  // koi glitch nahi. Duration bilkul match karti hai (deterministic timeline),
  // aur avatar clips apne sahi waqt par hain, is liye lip-sync bhi theek.
  const withAudio = (v) => v;

  // ---- IMAGE ----
  if (s.kind === 'image') {
    const img = s._forceImg || pick(dirs.images, `img_${tag}`) || nearestImage(dirs, s.start) || dirs.fallbackImage;
    if (!img) return null;
    const n = Math.round(dur * fps);
    const num = String(i).split('_').reduce((a, x) => a + (+x || 0), 0);

    // Side by side — kabhi kabhi 2 images aadha-aadha (config.sideBySide)
    const every = cfg.sideBySide?.everyNthImage || 0;
    if (every > 0 && s.sbsWith) {
      const gap = cfg.sideBySide.gapPx ?? 8;
      const half = Math.round((W - gap) / 2 / 2) * 2;
      await ff(['-loop', '1', '-i', img, '-loop', '1', '-i', s.sbsWith,
          '-filter_complex',
          `color=black:s=${W}x${H}:r=${fps}[bg];` +
          `[0:v]scale=${half}:${H}:force_original_aspect_ratio=increase,crop=${half}:${H}[L];` +
          `[1:v]scale=${half}:${H}:force_original_aspect_ratio=increase,crop=${half}:${H}[R];` +
          `[bg][L]overlay=0:0[b1];[b1][R]overlay=${half + gap}:0,setsar=1[v]`,
          '-map', '[v]', '-frames:v', String(n), ...enc, out]);
      return withAudio(out);
    }

    // MOTION: har tasveer par smooth harkat — bari bari zoom-in, zoom-out,
    // pan-left, pan-right. SHAKE ka ilaaj: 2x bade canvas par zoompan chala
    // kar lanczos se ghata do — pixel-jitter subpixel ho kar ghayab. zoom=0
    // ho to bilkul static.
    const z = cfg.render.zoom || 0;
    if (z <= 0.001) {
      await ff(['-loop', '1', '-i', img,
          '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`,
          '-frames:v', String(n), ...enc, out]);
      return withAudio(out);
    }
    // 3x = kam jitter, zyada CPU-heavy (isi liye pehle 2x par wapas gaye the
    // jab render local machine par 2h18m le raha tha) — ab render pod ke
    // multi-core box par hoti hai, extra compute afford ho jata hai, is liye
    // 3x par wapas (2026-08-17, user faisla — smoothness ko priority).
    const SS = 3, CW = W * SS, CH = H * SS;
    const mode = num % 4;                             // 0 zoomIn 1 zoomOut 2 panL 3 panR
    // thora bara scale taake pan ki gunjaish rahe
    const base = 1 + z;
    let zexpr, xexpr, yexpr;
    if (mode === 0) { zexpr = `1+${z}*on/${n}`;            xexpr = `iw/2-(iw/zoom/2)`; yexpr = `ih/2-(ih/zoom/2)`; }
    else if (mode === 1) { zexpr = `${base}-${z}*on/${n}`; xexpr = `iw/2-(iw/zoom/2)`; yexpr = `ih/2-(ih/zoom/2)`; }
    else if (mode === 2) { zexpr = `${base}`;              xexpr = `(iw-iw/zoom)*(1-on/${n})`; yexpr = `ih/2-(ih/zoom/2)`; }  // pan left
    else                 { zexpr = `${base}`;              xexpr = `(iw-iw/zoom)*(on/${n})`;   yexpr = `ih/2-(ih/zoom/2)`; }  // pan right
    await ff(['-loop', '1', '-i', img,
        '-vf', `scale=${CW}:${CH}:force_original_aspect_ratio=increase,crop=${CW}:${CH},` +
               `zoompan=z='${zexpr}':x='${xexpr}':y='${yexpr}':d=${n}:s=${CW}x${CH}:fps=${fps},` +
               `scale=${W}:${H}:flags=lanczos,setsar=1`,
        '-frames:v', String(n), ...enc, out]);
    return withAudio(out);
  }

  // ---- STOCK: pehle se trimmed clip ----
  if (s.kind === 'stock') {
    const v = pick(dirs.stock, `stk_${tag}`);
    if (!v) return null;
    // Downloaded clip 4-6s ka hota hai; agar slot us se lamba hai to clip
    // chhota reh jata tha aur sab aage ke shots pehle aa jate the — poori
    // video ki sync 18 second khisak gayi thi. tpad aakhri frame ko rok kar
    // slot ki poori lambai bhar deta hai.
    await ff(['-i', v,
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},` +
               `tpad=stop_mode=clone:stop_duration=${dur.toFixed(3)},setsar=1`,
        '-t', dur.toFixed(3), ...enc, out]);
    return out;
  }

  // ---- AVATAR: kabhi full-screen, kabhi right-side 70/30 ----
  const av = pick(dirs.avatar, `avatar_${tag}`);
  if (!av) return null;
  const side = avatarPool.next();           // true = right-side layout
  if (!side) {
    await ff(['-i', av,
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1`,
        '-t', dur.toFixed(3), ...enc, out]);
  } else {
    const bg = dirs.fallbackImage;
    const sp = cfg.avatarLayout.sideSplit || { image: 70, avatar: 30 };
    const aw = Math.round(W * sp.avatar / 100 / 2) * 2, ah = H;
    const iw = W - aw;
    await ff(['-loop', '1', '-t', dur.toFixed(3), '-i', bg, '-i', av,
        '-filter_complex',
        `[0:v]scale=${iw}:${ah}:force_original_aspect_ratio=increase,crop=${iw}:${ah},fps=${fps}[L];` +
        `[1:v]scale=${aw}:${ah}:force_original_aspect_ratio=increase,crop=${aw}:${ah},fps=${fps}[R];` +
        `[L][R]hstack=inputs=2,setsar=1[v]`,
        '-map', '[v]', '-t', dur.toFixed(3), ...enc, out]);
  }
  return withAudio(out);
}

module.exports = async function (spec, cfg, st) {
  const id = spec.id;
  const CONC = ENV_RENDER_CONC || cfg.concurrency?.render || 4;
  const timeline = JSON.parse(fs.readFileSync(U.p(id, 'timeline.json'), 'utf8'));
  const vo = U.p(id, 'voice', 'voiceover.mp3');
  if (!fs.existsSync(vo)) throw new Error('voiceover.mp3 nahi mila');
  const total = U.seconds(vo);

  const dirs = {
    images: U.p(id, 'images'), stock: U.p(id, 'stock'), avatar: U.p(id, 'avatar'),
    fallbackImage: null,
    vo,                                              // master voiceover (image/stock ka audio yahin se)
    avatarFull: U.p(id, 'avatar', '_tmp', 'avatar_full.mp4'),  // HeyGen ki apni synced awaaz
  };
  const anyImg = fs.existsSync(dirs.images) ? fs.readdirSync(dirs.images).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort() : [];
  dirs.fallbackImage = anyImg.length ? path.join(dirs.images, anyImg[0]) : null;
  if (!dirs.fallbackImage) throw new Error('ek bhi image nahi — stage 6 pehle chalao');

  const tmp = U.p(id, 'render');
  fs.mkdirSync(tmp, { recursive: true });

  // avatar_full ke andar har avatar tukre ka offset (stage 7 ne isi tarteeb
  // se audio jodi thi) — LIP-SYNC ke liye zaroori.
  let avoff = 0;
  for (const s of timeline) if (s.kind === 'avatar') { s._avoff = avoff; avoff += s.dur; }

  // avatar layout: aadhe full-screen, aadhe side (config se)
  // aadhe avatar shots full-screen, aadhe right-side 70/30 — bari bari,
  // taake poori video mein ek hi tarah ka talking head na rahe.
  // ASLI BUG (2026-08-17): ye line har render mein chalti hai (avatar ho ya
  // na ho — line 228 ka .forEach hi avatar-specific hai), lekin
  // config.json se avatarLayout hata diya gaya tha (werewolf-alpha-romance
  // mein avatar kabhi hota hi nahi) — "Cannot read properties of undefined"
  // se render har baar crash + pod restart-loop mein phans gaya. Optional
  // chaining se safe kar diya (avatar is niche mein kabhi bane ga hi nahi,
  // is liye fallback value ka koi asar nahi padta).
  const shareFull = cfg.avatarLayout?.fullScreenShare ?? 0.5;
  let k = -1;
  const avatarPool = { next: () => { k++; return shareFull >= 1 ? false : (k % 2 === 1); } };

  // avatar layout pehle hi tay kar lo — parallel mein tarteeb bigad jati hai
  const layout = new Map();
  timeline.forEach(s => { if (s.kind === 'avatar') layout.set(s.i, avatarPool.next()); });
  const poolFor = s => ({ next: () => layout.get(s.i) === true });

  // FIX #3: side-by-side sirf 5-8 dafa (config.sideBySide.randomCount),
  // poori video mein bikhri hui. Partner = pichli image.
  {
    const sb = cfg.sideBySide || {};
    const imgs = timeline.filter(x => x.kind === 'image' && x.file);
    const picks = [];
    if (sb.randomCount > 0 && imgs.length > 4) {
      const step = imgs.length / (sb.randomCount + 1);
      for (let k = 1; k <= sb.randomCount; k++) {
        let idx = Math.round(k * step + ((k * 37) % 5) - 2);   // halka jitter (Math.random mana hai)
        idx = Math.max(1, Math.min(imgs.length - 1, idx));
        picks.push(idx);
      }
    } else if (sb.everyNthImage > 0) {
      for (let k = sb.everyNthImage; k < imgs.length; k += sb.everyNthImage) picks.push(k);
    }
    let pairs = 0;
    for (const k of picks) {
      const partner = imgs[k - 1];
      const f = partner && partner.file ? path.join(U.ROOT, 'work', id, partner.file) : null;
      if (f && fs.existsSync(f) && !imgs[k].sbsWith) { imgs[k].sbsWith = f; pairs++; }
    }
    if (pairs) U.log(`   ${pairs} jagah 2 images side by side`);
  }

  const jobThreads = threadsPerJob(CONC);
  U.log(`   ${timeline.length} slots → clips banate hain (${CONC} ek sath, ${jobThreads} thread/clip)`);
  const parts = new Array(timeline.length).fill(null);
  const miss = { image: 0, stock: 0, avatar: 0 };
  let cursor = 0, finished = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (cursor < timeline.length) {
      const i = cursor++;
      const s = timeline[i];
      let f = null;
      try { f = await buildSlot(s, i, dirs, cfg, tmp, poolFor(s), jobThreads); }
      catch (e) { U.warn(`slot ${i} (${s.kind}) fail: ${String(e.message).slice(0, 70)}`); }
      if (!f) {
        miss[s.kind]++;
        // Avatar ki video nahi mili (HeyGen login nahi) — us block ko 4-4
        // second ki character images se bhar do, ek hi tasveer 17 second nahi.
        if (s.kind === 'avatar') {
          const subs = subSlots(s);
          const made = [];
          for (let k = 0; k < subs.length; k++) {
            try {
              const one = await buildSlot({ ...s, kind: 'image', start: subs[k].start, end: subs[k].end, dur: subs[k].dur },
                                    `${i}_${k}`, dirs, cfg, tmp, poolFor(s), jobThreads);
              if (one) made.push(one);
            } catch {}
          }
          if (made.length) { parts[i] = made; if (++finished % 25 === 0) U.log(`   ...${finished}/${timeline.length}`); continue; }
        }
        // missing stock/image → us WAQT ke qareeb wali image (pehli nahi = repeat nahi)
        try { f = await buildSlot({ ...s, kind: 'image', _forceImg: nearestImage(dirs, s.start) }, i, dirs, cfg, tmp, poolFor(s), jobThreads); } catch {}
      }
      parts[i] = f;
      if (++finished % 25 === 0) U.log(`   ...${finished}/${timeline.length}`);
    }
  }));
  const clips = parts.filter(Boolean).flat();
  if (!clips.length) throw new Error('ek bhi clip nahi bana');

  // Har clip ki asli lambai naap lo. Ek dafa zoompan ki wajah se har image
  // clip 308 second ka ban gaya tha aur concat 12 ghante ka — pata tab chala
  // jab final video mein sirf pehle shots dikhe. Ab pehle hi pakad lete hain.
  const want = timeline.reduce((a, s) => a + s.dur, 0);
  let real = 0;
  for (const c of clips) real += U.seconds(c);
  U.log(`   clips ki kul lambai ${Math.round(real)}s (chahiye ${Math.round(want)}s)`);
  if (real > want * 1.02 || real < want * 0.98)
    throw new Error(`clips ki lambai ghalat: ${Math.round(real)}s vs ${Math.round(want)}s — render rok diya`);
  if (miss.image + miss.stock + miss.avatar)
    U.warn(`gayab assets — image ${miss.image}, stock ${miss.stock}, avatar ${miss.avatar} (fallback lagaya)`);

  // ---------- concat (video-only) + EK master voiceover ----------
  const listF = path.join(tmp, 'list.txt');
  fs.writeFileSync(listF, clips.map(p => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const silent = path.join(tmp, 'video_silent.mp4');
  U.log('   concat (video-only)...');
  await ff(['-f', 'concat', '-safe', '0', '-i', listF, '-c', 'copy', silent], 1800000);

  // ---------- particles + captions EK HI PASS mein (pehle 2 alag re-encode the) ----------
  // ASLI OPTIMIZATION: particles aur captions har video par DO poore-frame
  // re-encode passes leti thi (particles → intermediate file → captions →
  // dusra intermediate file). Ek 60min video ke liye ye do bar poora encode
  // karna sab se bada waqt-zaya tha. Ab dono overlay EK HI ffmpeg call mein
  // (ek filter_complex chain), sirf ek encode pass — roughly aadha waqt.
  let current = silent;
  const intermediates = [];
  const inputs = ['-i', silent];
  const filterParts = [];
  let curLabel = '0:v';
  let nextInput = 1;

  if (cfg.particles?.enabled) {
    const assetsDir = path.join(U.ROOT, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const loopMov = path.join(assetsDir, 'particles_loop.mov');
    if (!fs.existsSync(loopMov)) {
      U.log('   particles loop generate ho raha hai (ek dafa, phir sab videos mein reuse)...');
      execFileSync('python', [path.join(U.ROOT, 'tools', 'particles.py'),
        loopMov, String(W), String(H), String(cfg.canvas.fps),
        String(cfg.particles.loopSeconds || 20),
        String(cfg.particles.count || 45), String(cfg.particles.opacity || 60)],
        { stdio: 'inherit', timeout: 1800000 });
    }
    inputs.push('-stream_loop', '-1', '-i', loopMov);
    filterParts.push(`[${nextInput}:v]format=rgba[p]`);
    filterParts.push(`[${curLabel}][p]overlay=0:0:shortest=1[vp]`);
    curLabel = 'vp';
    nextInput++;
  }

  if (cfg.captions?.enabled) {
    const wordsFile = U.p(id, 'voice', 'words.json');
    if (!fs.existsSync(wordsFile)) {
      U.warn('words.json nahi mila — captions skip (stage 2 dobara chalao)');
    } else {
      U.log('   captions (word-highlight) generate ho rahi hain...');
      const capsDir = U.p(id, 'captions');
      fs.mkdirSync(capsDir, { recursive: true });
      const capsMov = path.join(capsDir, 'caps.mov');
      const capYFile = path.join(capsDir, 'cap_y.txt');
      if (!fs.existsSync(capsMov) || !fs.existsSync(capYFile)) {
        // captions.py sirf ek CHHOTI strip banata hai (poora frame nahi) —
        // bahut tez hoti hai. stdout ki aakhri line "CAP_Y=<n>" batati hai
        // ye strip poore frame par kahan (kis Y par) chipkegi.
        const out = execFileSync('python', [path.join(U.ROOT, 'tools', 'captions.py'),
          wordsFile, capsDir, total.toFixed(3), String(W), String(H), String(cfg.canvas.fps),
          cfg.captions.highlightColor || '#FFD700', cfg.captions.position || 'left-bottom'],
          { encoding: 'utf8', timeout: 3600000 });
        U.log('   ' + out.trim().split('\n').join('\n   '));
        const m = out.match(/CAP_Y=(\d+)/);
        fs.writeFileSync(capYFile, m ? m[1] : '0');
      }
      const capY = fs.readFileSync(capYFile, 'utf8').trim() || '0';
      inputs.push('-i', capsMov);
      filterParts.push(`[${curLabel}][${nextInput}:v]overlay=0:${capY}[vc]`);
      curLabel = 'vc';
      nextInput++;
    }
  }

  if (filterParts.length) {
    filterParts.push(`[${curLabel}]format=yuv420p[vout]`);
    const merged = path.join(tmp, 'video_merged.mp4');
    U.log('   particles + captions overlay (ek hi encode pass)...');
    // ASLI BUG: 30 min timeout kaafi nahi tha — poore overlay/caption compositing
    // (pixel-level blend, encoder se pehle) ek 60min video ke liye 30 min se
    // zyada le sakta hai (naapa gaya: 27+ min par abhi bhi chal raha tha jab
    // timeout lag gaya). 90 min budget de diya.
    await ff([...inputs, '-filter_complex', filterParts.join(';'), '-map', '[vout]',
        ...videoEnc(cfg.canvas.fps, 20), merged], 5400000);
    intermediates.push(merged);
    current = merged;
    U.ok('particles + captions overlay ho gayi');
  }

  const final = U.p(id, 'final.mp4');
  U.log('   ek continuous voiceover (ai33) mux — koi glitch nahi, lip-sync barqarar');
  // -shortest se truncation ka khatra nahi: video aur audio dono ~barabar
  await ff(['-i', current, '-i', vo,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest',
      '-movflags', '+faststart', final], 1800000);
  fs.rmSync(silent, { force: true });
  for (const f of intermediates) fs.rmSync(f, { force: true });

  const len = U.seconds(final);
  st.meta.render = { seconds: Math.round(len), slots: clips.length, mb: Math.round(fs.statSync(final).size / 1048576) };
  U.ok(`final.mp4 — ${Math.floor(len / 60)}m ${Math.round(len % 60)}s, ${st.meta.render.mb} MB`);
  return true;
};
