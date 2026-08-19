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
const { generateAssCaptions } = require('../lib/ass-captions.js');

// ffmpeg filtergraph mini-language mein `:` special hai (filter-option
// separator) — Windows drive-letter paths ('C:\...') isay tod dete. Forward
// slashes hamesha chalte hain (Windows par bhi), is liye pehle unify karo,
// phir bacha hua koi bhi ':' escape karo.
function escapeFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// ASS "H:MM:SS.CS" <-> seconds. Dialogue line format ke 9 commas Text se
// PEHLE aate hain (Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,
// Effect) — Text khud commas rakh sakta hai (misal "SERVANT GIRL, HE SAID"),
// is liye naive split(',') Text ko tor deta — 9th comma tak hi manually
// split karte hain, baaki sab Text hai.
function assTimeToSec(t) {
  const m = t.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) return 0;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 100;
}
function secToAssTime(sec) {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
// Poori .ass ko [segStart,segEnd) time-window ke liye chhota, REBASED
// (times ko segStart se shift kiya gaya) .ass banata hai — parallel render
// segments ke liye, taake har segment ka apna sahi-waqt-par-caption ho.
function sliceAssFile(srcPath, destPath, segStart, segEnd) {
  const content = fs.readFileSync(srcPath, 'utf8');
  const lines = content.split('\n');
  const eventsIdx = lines.findIndex(l => l.trim() === '[Events]');
  const header = lines.slice(0, eventsIdx + 2);   // [Events] + "Format:" line
  const kept = [];
  for (let i = eventsIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('Dialogue:')) continue;
    let commaCount = 0, cut = -1;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === ',') { commaCount++; if (commaCount === 9) { cut = c; break; } }
    }
    if (cut === -1) continue;
    const fields = line.slice(0, cut).split(',');
    const text = line.slice(cut + 1);
    const start = assTimeToSec(fields[1]), end = assTimeToSec(fields[2]);
    if (end <= segStart || start >= segEnd) continue;
    fields[1] = secToAssTime(Math.max(0, start - segStart));
    fields[2] = secToAssTime(Math.min(segEnd - segStart, end - segStart));
    kept.push(fields.join(',') + ',' + text);
  }
  fs.writeFileSync(destPath, header.join('\n') + '\n' + kept.join('\n') + '\n', 'utf8');
}

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

// QSV DISABLED (2026-08-20): same failure class as NVENC below — the 64x64
// null-output probe passed on a rented AMD EPYC host (h264_qsv registered in
// this ffmpeg build), but the REAL per-slot clip encode failed live with
// "Error initializing an internal MFX session: unsupported (-3)" — no real
// Intel Quick Sync silicon on that host, the probe just checks the encoder
// is compiled in, not that working hardware backs it. Since rented pods can
// land on Intel or AMD hosts unpredictably, and videoEnc() has no per-call
// fallback if the probed encoder fails at actual encode time (same gap
// documented for NVENC), a false-positive here hangs the whole render
// (128 concurrent clip encodes all failing identically). Disabled entirely
// — libx264 (CPU) is already proven reliable via the segmented-render fix
// (65.96% CPU, ~14min render on a real run). function kept for reference.
// function detectQSV() {
//   try {
//     execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.2',
//       '-c:v', 'h264_qsv', '-f', 'null', '-'], { timeout: 15000 });
//     return true;
//   } catch { return false; }
// }
// let _qsv = null;
function useQSV() { return false; }

// NVENC DISABLED (2026-08-17): probe (64x64 test clip) reported NVENC
// usable on a real pod, but the REAL merge encode (full 1920x1080 filter
// chain — particles overlay + ass captions) then failed live with
// "Frame Dimension less than the minimum supported value" — the trivial
// probe passing does NOT guarantee the real multi-filter chain works,
// and videoEnc() has no per-call fallback if the probed encoder fails at
// actual encode time (unlike a failed slot, which just becomes a missing-
// asset fallback — a failed SINGLE merge pass has nowhere to fall back
// to mid-stream). Cost: a live pod run that had already gotten through
// 175/183 slots + particles + captions successfully, right before this
// hit. Disabled entirely rather than debug blind on another paid attempt
// — revisit with real dimension-matching investigation in a future
// session, not tonight. function kept (not deleted) so the investigation
// starting point is preserved.
// function detectNVENC() {
//   try {
//     execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.2',
//       '-c:v', 'h264_nvenc', '-f', 'null', '-'], { timeout: 15000 });
//     return true;
//   } catch { return false; }
// }
// let _nvenc = null;
// function useNVENC() { if (_nvenc === null) _nvenc = detectNVENC(); return _nvenc; }

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
    // ASLI BUG #1 (2026-08-18, "shake" complaint — isolated aur reproduce kiya
    // gaya, sirf ek image + zoompan filter, poore pipeline se bilkul alag):
    // motion (zoom ya pan) poori slot duration (aksar 15-20+ second, 450-
    // 600+ frames) par phaila hua tha. z=0.12 par total pan range sirf
    // ~617px (3x supersampled canvas par) hoti hai — 600 frames par phaila
    // do to per-frame movement ~1px supersampled / ~0.33px native se bhi
    // kam reh jata hai. zoompan apni crop position ko whole-pixel par hi
    // rakh sakta hai, is liye itni chhoti per-frame harkat "kabhi hilo mat,
    // phir 1px chalo" staircase ban jaati hai — yehi "halka sa shake" tha.
    //
    // ASLI BUG #2 (2026-08-18, "image poori tarah frozen/static" complaint —
    // user ne screen-recording bheji: EK image 21+ second tak bilkul static
    // rahi jab k caption 4-5 alag lines cycle kar chuki thi): pehla fix
    // (motionN=120, 4s window) motion ko fixed 4s mein mukammal kar deta,
    // phir BAAQI POORI slot duration (is niche mein aksar 15-20+ second) ke
    // liye bilkul ruk jata — chhote slots ke liye theek tha, lekin lambe
    // slots ka 80%+ hissa completely frozen dikhta.
    //
    // ASLI FIX: har slot ke liye zoom/pan MIQDAAR (z) ko UPAR badhao (Z_MAX
    // tak) taake poori slot duration (n frames) par phaila kar bhi per-frame
    // movement safe (>=SAFE_PXPERFRAME) rahe — motion poori duration mein
    // CHALTI rehti hai, koi lamba freeze nahi. Agar konsa slot itna lamba ho
    // ke Z_MAX (natural-looking zoom ki hadd) par bhi poori duration cover
    // nahi hoti, tab hi baaki hisse mein hold hota hai — lekin ab hold
    // hamesha bohot chhota hissa hai, dominant nahi.
    const SAFE_PXPERFRAME = 5.14;     // supersampled px/frame — 2026-08-18 ke pehle fix se verified safe threshold
    const Z_MAX = 0.35;               // zyada se zyada zoom/pan miqdaar — is se aage "Ken Burns" natural nahi lagta
    const pixelRangeForZ = zz => CW * zz / (1 + zz);   // == iw - iw/(1+zz), exact (approx nahi)
    const target = SAFE_PXPERFRAME * n;
    // pixelRangeForZ(neededZ) = target ko zz ke liye solve kiya (algebra: upar comment dekho)
    const neededZ = target / (CW - target);
    const zEff = Math.min(Z_MAX, Math.max(z, neededZ > 0 ? neededZ : z));
    const baseEff = 1 + zEff;
    const motionN = Math.min(n, Math.max(1, Math.round(pixelRangeForZ(zEff) / SAFE_PXPERFRAME)));
    const prog = `min(on\\,${motionN})/${motionN}`;   // 0→1 within motionN frames, phir wahin ruka rehta hai (ab n ke bohot qareeb, chhota hold)
    let zexpr, xexpr, yexpr;
    if (mode === 0) { zexpr = `1+${zEff}*${prog}`;               xexpr = `iw/2-(iw/zoom/2)`; yexpr = `ih/2-(ih/zoom/2)`; }
    else if (mode === 1) { zexpr = `${baseEff}-${zEff}*${prog}`; xexpr = `iw/2-(iw/zoom/2)`; yexpr = `ih/2-(ih/zoom/2)`; }
    else if (mode === 2) { zexpr = `${baseEff}`;                 xexpr = `(iw-iw/zoom)*(1-${prog})`; yexpr = `ih/2-(ih/zoom/2)`; }  // pan left
    else                 { zexpr = `${baseEff}`;                 xexpr = `(iw-iw/zoom)*${prog}`;   yexpr = `ih/2-(ih/zoom/2)`; }  // pan right
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

  // ---------- particles + captions, PARALLEL TIME-SEGMENTS mein (2026-08-18) ----------
  // ASLI BUG: ek hi ffmpeg process mein poore video (15-20+ min) par particles
  // overlay + ass burn-in — isolated test se confirmed (threads=1 vs 4 vs 12
  // par sirf 1.44x speedup, phir flat) ke ye filter chain (overlay + libass)
  // EK PROCESS ke andar ~4 threads se zyada scale hi nahi karti, chahe
  // -threads 0 (auto) do ya 384. Pod par isi wajah se sirf ~1.2% CPU (4-5
  // cores/384) use hota tha poori is step ke dauran — encoder ke paas
  // sainkron idle threads thay lekin filter stage unhen kabhi kaam nahi de
  // pati thi. FIX: poore video ko N chhote TIME-SEGMENTS mein baanto (jitne
  // bhi pod cores hon, unke hisaab se — chhoti local machine par bhi 1-3
  // segments milte hain, koi crash nahi), har segment apna ALAG ffmpeg
  // process (per-slot clip-building wale HI proven concurrency pattern se) —
  // phir sab segments concat. Har segment ka apna rebased .ass (sirf usi
  // waqt-range ke Dialogue lines, times shift kiye gaye) aur particles loop
  // ka phase bhi (segStart % loopSeconds) se offset kiya gaya taake segment
  // boundary par particles ka koi visible "jump" na ho.
  let current = silent;
  const intermediates = [];

  if (cfg.particles?.enabled || cfg.captions?.enabled) {
    const assetsDir = path.join(U.ROOT, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const loopMov = path.join(assetsDir, 'particles_loop.mov');
    const loopSeconds = cfg.particles?.loopSeconds || 20;
    if (cfg.particles?.enabled && !fs.existsSync(loopMov)) {
      U.log('   particles loop generate ho raha hai (ek dafa, phir sab videos mein reuse)...');
      execFileSync('python', [path.join(U.ROOT, 'tools', 'particles.py'),
        loopMov, String(W), String(H), String(cfg.canvas.fps),
        String(loopSeconds), String(cfg.particles.count || 45), String(cfg.particles.opacity || 60)],
        { stdio: 'inherit', timeout: 1800000 });
    }

    let assFile = null;
    if (cfg.captions?.enabled) {
      const wordsFile = U.p(id, 'voice', 'words.json');
      if (!fs.existsSync(wordsFile)) {
        U.warn('words.json nahi mila — captions skip (stage 2 dobara chalao)');
      } else {
        const capsDir = U.p(id, 'captions');
        fs.mkdirSync(capsDir, { recursive: true });
        assFile = path.join(capsDir, 'captions.ass');
        const info = generateAssCaptions(wordsFile, assFile, {
          W, H, total, highlightHex: cfg.captions.highlightColor || '#FFD700',
        });
        U.log(`   captions.ass — ${info.groups} groups, ${info.lines} word-highlight lines`);
      }
    }

    // segment count: cores/4 (isolated test se ~4 threads/process ke baad
    // returns flat ho jate hain), 1-32 ke beech clamp (chhoti machine par
    // bhi kaam kare, bohot bare host par bhi sensible tadaad rahe).
    const fps = cfg.canvas.fps;
    const cores = os.cpus().length || 1;
    const segCount = Math.max(1, Math.min(32, Math.floor(cores / 4)));
    const segThreads = Math.max(1, Math.min(6, Math.floor(cores / segCount)));
    const segLen = real / segCount;
    U.log(`   particles + captions — ${segCount} parallel segments (${segThreads} thread/segment, ${cores} cores)...`);

    const merged = path.join(tmp, 'video_merged.mp4');
    const segFiles = await Promise.all(Array.from({ length: segCount }, async (_, seg) => {
      const segStart = seg * segLen;
      const segEnd = seg === segCount - 1 ? real : (seg + 1) * segLen;
      const segFrames = Math.round((segEnd - segStart) * fps);
      if (segFrames <= 0) return null;

      const inputs = ['-ss', String(segStart), '-i', silent];
      const filterParts = [];
      let curLabel = '0:v';
      let nextInput = 1;

      if (cfg.particles?.enabled) {
        const phase = segStart % loopSeconds;
        inputs.push('-ss', String(phase), '-stream_loop', '-1', '-i', loopMov);
        filterParts.push(`[${nextInput}:v]format=rgba[p]`);
        filterParts.push(`[${curLabel}][p]overlay=0:0:shortest=1[vp]`);
        curLabel = 'vp';
        nextInput++;
      }

      if (assFile) {
        const segAss = path.join(tmp, `seg_${seg}.ass`);
        sliceAssFile(assFile, segAss, segStart, segEnd);
        filterParts.push(`[${curLabel}]ass='${escapeFilterPath(segAss)}'[vc]`);
        curLabel = 'vc';
      }

      filterParts.push(`[${curLabel}]format=yuv420p[vout]`);
      const segOut = path.join(tmp, `seg_${seg}.mp4`);
      await ff([...inputs, '-filter_complex', filterParts.join(';'), '-map', '[vout]',
          '-frames:v', String(segFrames), ...videoEnc(fps, 20, segThreads), segOut], 5400000);
      return segOut;
    }));

    const okSegs = segFiles.filter(Boolean);
    if (!okSegs.length) throw new Error('koi bhi particles/captions segment nahi bana');
    const segListF = path.join(tmp, 'seg_list.txt');
    fs.writeFileSync(segListF, okSegs.map(p => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    await ff(['-f', 'concat', '-safe', '0', '-i', segListF, '-c', 'copy', merged], 1800000);
    for (const s of okSegs) fs.rmSync(s, { force: true });

    intermediates.push(merged);
    current = merged;
    U.ok(`particles + captions overlay ho gayi (${okSegs.length} parallel segments)`);
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
